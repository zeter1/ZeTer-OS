"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const filePath = path.join(ROOT, "app", "js", "core", "notification-utils.js");
const sandbox = { console, Date, setInterval, clearInterval };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });

const utils = sandbox.ZETER_NOTIFICATION_UTILS;
assert.ok(utils, "notification utils must load");

assert.equal(utils.notificationFilterKind({ source: "automation:rule-1" }), "automations");
assert.equal(
  utils.notificationFilterKind({ source: "automation:rule-1", action: "open-task" }),
  "automations",
  "automation source must own filter classification"
);
assert.equal(utils.notificationMatchesFilter({ source: "automation:rule-1" }, "automations"), true);
assert.equal(utils.notificationMatchesFilter({ source: "automation:rule-1" }, "tasks"), false);
assert.equal(utils.notificationFilterKind({ source: "task:task-1" }), "tasks");
assert.equal(utils.notificationFilterKind({ source: "calendar:event-1:2026-08-31" }), "calendar");
assert.equal(utils.NOTIFICATION_OPTION_FIELDS.includes("linkedObjectKind"), true);
assert.equal(utils.NOTIFICATION_OPTION_FIELDS.includes("linkedObjectId"), true);
assert.equal(utils.NOTIFICATION_OPTION_FIELDS.includes("linkedEventDate"), true);

const generic = utils.createNotificationRecord("Automation", "Done", {
  source: "automation:rule-1",
  linkedObjectKind: "file",
  linkedObjectId: "file-42",
  linkedEventDate: "2026-08-31"
}, {
  id: "notif-1",
  desktopId: "desktop",
  time: 1
});
assert.equal(generic.linkedObjectKind, "file");
assert.equal(generic.linkedObjectId, "file-42");
assert.equal(generic.linkedEventDate, "2026-08-31");
assert.equal(utils.notificationCanOpen(generic), true);
assert.deepEqual(
  JSON.parse(JSON.stringify(utils.notificationLinkedObject(generic))),
  { kind: "file", id: "file-42", eventDate: "2026-08-31" }
);

assert.deepEqual(
  JSON.parse(JSON.stringify(utils.notificationLinkedObject({ source: "task:task-2" }))),
  { kind: "task", id: "task-2", eventDate: "" }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(utils.notificationLinkedObject({
    source: "calendar:event-2:2026-09-01",
    action: "open-calendar"
  }))),
  { kind: "calendar", id: "event-2", eventDate: "2026-09-01" }
);
assert.equal(utils.notificationCanOpen({ source: "automation:rule-2" }), false);
assert.equal(utils.notificationCanOpen({ linkedObjectKind: "file" }), false);

console.log("notification feature 7 core smoke: ok");
