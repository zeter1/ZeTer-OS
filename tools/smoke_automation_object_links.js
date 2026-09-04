"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "app", "js", "core");
const sandbox = { console, Date, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(name) {
  const file = path.join(CORE, name);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

load("automation-utils.js");
load("object-link-utils.js");

const automationUtils = sandbox.ZETER_AUTOMATION_UTILS;
const linkUtils = sandbox.ZETER_OBJECT_LINK_UTILS;

const links = linkUtils.normalizeObjectLinks([
  { id: "l1", a: { kind: "fs", id: "note1" }, b: { kind: "event", id: "event1" } },
  { id: "l2", a: { kind: "event", id: "event1" }, b: { kind: "fs", id: "note1" } },
  { id: "broken", a: { kind: "fs", id: "missing" }, b: { kind: "event", id: "event1" } }
]);
assert.equal(links.length, 2, "reversed object links must dedupe semantically");
assert.deepEqual(
  plain(linkUtils.linkedObjectEndpoints(links, { kind: "event", id: "event1" })),
  [{ kind: "fs", id: "note1" }, { kind: "fs", id: "missing" }]
);
const prunedLinks = linkUtils.pruneBrokenObjectLinks(
  links,
  { fs: { note1: { id: "note1" } } },
  { events: [{ id: "event1" }] }
);
assert.equal(prunedLinks.length, 1);
assert.equal(linkUtils.linksForObjectEndpoint(prunedLinks, { kind: "fs", id: "note1" }).length, 1);
assert.equal(linkUtils.linksForObjectEndpoint(prunedLinks, { kind: "event", id: "event1" }).length, 1);

const weekly = automationUtils.normalizeAutomation({
  id: "weekly1",
  name: "Weekly",
  type: "weekly",
  weekday: 1,
  time: "09:00",
  condition: "always",
  action: { type: "notify", title: "Пора", text: "Проверка" }
});
const monday = new Date(2026, 7, 31, 9, 15, 0, 0);
const weeklyRun = automationUtils.pendingRunForAutomation(weekly, { now: monday });
assert.equal(weeklyRun.runKey, "weekly:2026-08-31:09:00");
automationUtils.markAutomationRun(weekly, weeklyRun);
assert.equal(automationUtils.pendingRunForAutomation(weekly, { now: monday }), null, "lastRunKey must make the run once-only");

const eventAutomation = automationUtils.normalizeAutomation({
  id: "event_auto",
  type: "event_before",
  eventId: "event1",
  minutesBefore: 30,
  action: { type: "create_note", name: "Встреча", content: "Подготовиться" }
});
const eventRun = automationUtils.pendingRunForAutomation(eventAutomation, {
  now: new Date(2026, 7, 31, 9, 40, 0, 0),
  events: [{ id: "event1", date: "2026-08-31", start: "10:00", repeat: "none" }]
});
assert.equal(eventRun.eventId, "event1");

const state = { fs: { existing: { id: "existing", parent: "desktop" } } };
const workspace = {
  events: [],
  automations: [{
    id: "file_auto",
    name: "Move",
    type: "file_added",
    folderId: "desktop",
    condition: "always",
    action: { type: "move_file", targetFolderId: "archive" }
  }]
};
const moved = [];
const controller = automationUtils.createAutomationRuntimeController({
  getState: () => state,
  getWorkspace: () => workspace,
  now: () => monday.getTime(),
  moveFile: (fileId, folderId) => { moved.push([fileId, folderId]); return true; }
});
assert.equal(controller.collectDueRuns().length, 0, "initial files must seed the in-memory baseline");
state.fs.new1 = { id: "new1", parent: "desktop" };
const firstFileRuns = controller.collectDueRuns();
assert.equal(firstFileRuns.length, 1);
assert.equal(firstFileRuns[0].run.fileId, "new1");
const retriedFileRuns = controller.collectDueRuns();
assert.equal(retriedFileRuns.length, 1, "unacknowledged file-added run must remain retryable");

automationUtils.markAutomationRun(retriedFileRuns[0].automation, retriedFileRuns[0].run);
assert.equal(controller.collectDueRuns().length, 0, "successful lastRunKey must settle the pending file ID");
assert.equal(controller.collectDueRuns().length, 0, "settled file ID must not run again");

const retryState = { fs: {
  baseline: { id: "baseline", parent: "desktop" },
  archive_a: { id: "archive_a", type: "folder", parent: "desktop" },
  archive_b: { id: "archive_b", type: "folder", parent: "desktop" }
} };
const retryWorkspace = {
  events: [],
  automations: [
    {
      id: "file_first",
      type: "file_added",
      folderId: "desktop",
      action: { type: "move_file", targetFolderId: "archive_a" }
    },
    {
      id: "file_second",
      type: "file_added",
      folderId: "desktop",
      action: { type: "move_file", targetFolderId: "archive_b" }
    }
  ]
};
const attempts = new Map();
let rejectSecondOnce = true;
const retryController = automationUtils.createAutomationRuntimeController({
  getState: () => retryState,
  getWorkspace: () => retryWorkspace,
  now: () => monday.getTime(),
  moveFile: (_fileId, _folderId, meta) => {
    attempts.set(meta.automationId, (attempts.get(meta.automationId) || 0) + 1);
    if (meta.automationId === "file_second" && rejectSecondOnce) {
      rejectSecondOnce = false;
      return false;
    }
    return true;
  }
});
retryController.collectDueRuns();
retryState.fs.new_retry = { id: "new_retry", parent: "desktop" };

async function verifyRuntimeRetry() {
  await assert.rejects(() => retryController.executeDueRuns(), /Automation action rejected: file_second/);
  assert.equal(attempts.get("file_first"), 1, "successful earlier action must not be duplicated after a later rejection");
  assert.equal(attempts.get("file_second"), 1);
  assert.equal(retryController.collectDueRuns().length, 1, "only the rejected file-added automation should remain pending");
  await retryController.executeDueRuns();
  assert.equal(attempts.get("file_first"), 1, "retry must preserve the already successful action");
  assert.equal(attempts.get("file_second"), 2);
  assert.equal(retryController.collectDueRuns().length, 0, "completed file-added group must settle in memory");

  retryState.fs.new_a = { id: "new_a", parent: "desktop" };
  retryState.fs.new_b = { id: "new_b", parent: "desktop" };
  assert.equal(retryController.collectDueRuns().length, 4, "two new files must produce two runs for each matching automation");
  await retryController.executeDueRuns();
  assert.equal(retryController.collectDueRuns().length, 0, "multiple file IDs must remain run-once despite a single persisted lastRunKey");
}

const replacingWorkspace = {
  events: [],
  automations: [{
    id: "weekly_replaced_during_action",
    name: "Weekly replacement regression",
    type: "weekly",
    weekday: 1,
    time: "09:00",
    action: { type: "notify", title: "Once", text: "" }
  }]
};
function normalizedReplacingWorkspace() {
  replacingWorkspace.automations = automationUtils.normalizeAutomations(replacingWorkspace.automations);
  return replacingWorkspace;
}
let replacementNotifications = 0;
const replacingController = automationUtils.createAutomationRuntimeController({
  getState: () => ({ fs: {} }),
  getWorkspace: normalizedReplacingWorkspace,
  now: () => monday.getTime(),
  notify: () => {
    replacementNotifications += 1;
    normalizedReplacingWorkspace();
    return true;
  }
});

async function verifyReplacementSafeRunKey() {
  await replacingController.executeDueRuns();
  assert.equal(replacementNotifications, 1);
  assert.equal(
    replacingWorkspace.automations[0].lastRunKey,
    "weekly:2026-08-31:09:00",
    "lastRunKey must be written to the current workspace object after action callbacks replace normalized records"
  );
  await replacingController.executeDueRuns();
  assert.equal(replacementNotifications, 1, "a scheduled automation must not repeat after its action replaced workspace records");
}

const explicitAction = automationUtils.normalizeAutomation({
  id: "notify1",
  type: "weekly",
  weekday: 1,
  time: "09:00",
  action: { type: "notify", title: "Title", text: "Text" }
});
let notified = false;
verifyRuntimeRetry().then(verifyReplacementSafeRunKey).then(() => automationUtils.executeAutomationAction(explicitAction, { runKey: "x" }, {
  notify: (title, text) => { notified = title === "Title" && text === "Text"; return true; }
})).then(() => {
  assert.equal(notified, true);
  assert.doesNotMatch(fs.readFileSync(path.join(CORE, "automation-utils.js"), "utf8"), /\beval\s*\(/);
  console.log("automation/object-links smoke: ok");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
