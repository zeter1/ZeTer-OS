"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "app", "js", "core");
const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

function createSandbox(extra = {}) {
  const sandbox = { console, Date, setTimeout, clearTimeout, ...extra };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function load(sandbox, name) {
  const file = path.join(CORE, name);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const automationSandbox = createSandbox();
automationSandbox.ZETER_CORE_UTILS = { escapeHtml };
load(automationSandbox, "automation-utils.js");
load(automationSandbox, "automation-ui-utils.js");
const automationUi = automationSandbox.ZETER_AUTOMATION_UI_UTILS;

assert.equal(
  automationUi.automationRuleSummary({
    id: "weekly_1",
    name: "Среда",
    type: "weekly",
    weekday: 3,
    time: "09:30",
    action: { type: "notify", title: "Пора", text: "" }
  }),
  "Когда каждую среду в 09:30 → показать уведомление «Пора»"
);
const automationEditor = automationUi.automationEditorHTML({
  id: "invalid_move",
  name: "Нельзя запускать",
  type: "weekly",
  action: { type: "move_file", targetFolderId: "archive" }
});
assert.match(automationEditor, /data-automation-move-file-option selected disabled hidden/);
assert.match(automationEditor, /data-automation-editor-error/);
assert.deepEqual(
  plain(automationUi.validateAutomationDraft({ name: "Правило", type: "weekly", action: { type: "move_file", targetFolderId: "archive" } })),
  {
    valid: false,
    selector: "[data-automation-action]",
    message: "Перемещение файла доступно только для триггера «При добавлении файла»."
  }
);
assert.equal(automationUi.validateAutomationDraft({
  name: "Перенос",
  type: "file_added",
  folderId: "inbox",
  action: { type: "move_file", targetFolderId: "archive" }
}).valid, true);

const trigger = { value: "weekly" };
const actionSelect = { value: "move_file" };
const moveFileOption = { disabled: false, hidden: false };
const triggerGroups = [
  { dataset: { triggerFields: "weekly" }, hidden: true },
  { dataset: { triggerFields: "file_added" }, hidden: false }
];
const actionGroups = [
  { dataset: { actionFields: "notify" }, hidden: true },
  { dataset: { actionFields: "move_file" }, hidden: false }
];
const automationRoot = {
  querySelector(selector) {
    return {
      "[data-automation-trigger]": trigger,
      "[data-automation-action]": actionSelect,
      "[data-automation-move-file-option]": moveFileOption
    }[selector] || null;
  },
  querySelectorAll(selector) {
    if (selector === "[data-trigger-fields]") return triggerGroups;
    if (selector === "[data-action-fields]") return actionGroups;
    return [];
  }
};
assert.equal(automationUi.syncAutomationEditorFields(automationRoot), true);
assert.equal(actionSelect.value, "notify", "incompatible move_file action must fall back to notify");
assert.equal(moveFileOption.disabled, true);
assert.equal(moveFileOption.hidden, true);
assert.equal(actionGroups[0].hidden, false);
assert.equal(actionGroups[1].hidden, true);
trigger.value = "file_added";
automationUi.syncAutomationEditorFields(automationRoot);
assert.equal(moveFileOption.disabled, false);
assert.equal(moveFileOption.hidden, false);

const linkSandbox = createSandbox();
linkSandbox.ZETER_CORE_UTILS = { escapeHtml };
load(linkSandbox, "object-link-utils.js");
load(linkSandbox, "object-link-ui-utils.js");
const linkUi = linkSandbox.ZETER_OBJECT_LINK_UI_UTILS;
const sourceEndpoint = { kind: "fs", id: "note_1" };
const links = [{ id: "link_1", a: sourceEndpoint, b: { kind: "event", id: "event_1" } }];
const candidates = [
  { endpoint: sourceEndpoint, label: "Эта заметка", typeLabel: "Заметка" },
  { endpoint: { kind: "event", id: "event_1" }, label: "Уже связано", typeLabel: "Событие" },
  { endpoint: { kind: "fs", id: "table_1" }, label: "План", typeLabel: "Таблица" }
];
assert.deepEqual(
  plain(linkUi.availableObjectLinkCandidates(candidates, sourceEndpoint, links).map(item => item.endpoint)),
  [{ kind: "fs", id: "table_1" }]
);
assert.match(linkUi.objectLinkRowsHTML(links, sourceEndpoint, { candidates }), />Открыть</);
assert.match(linkUi.objectLinkRowsHTML(links, sourceEndpoint, { candidates }), />Удалить связь</);
assert.match(linkUi.objectLinksPanelHTML({ endpoint: sourceEndpoint, links, candidates }), /Таблица · План/);

let panelRenderCount = 0;
let addAccepted = false;
let clickHandler = null;
const candidateSelect = { value: "fs:table_1" };
const panelRoot = {
  className: "",
  dataset: {},
  get innerHTML() { return ""; },
  set innerHTML(_value) { panelRenderCount += 1; },
  querySelector: selector => selector === "[data-object-link-candidate]" ? candidateSelect : null,
  addEventListener: (type, handler) => { if (type === "click") clickHandler = handler; }
};
linkUi.createObjectLinksPanel({
  document: { createElement: () => panelRoot },
  endpoint: sourceEndpoint,
  getLinks: () => [],
  getCandidates: () => candidates,
  addLink: () => addAccepted
});
const addTarget = { closest: selector => selector === "[data-add-object-link]" ? {} : null };
clickHandler({ target: addTarget });
assert.equal(panelRenderCount, 1, "rejected add callback must not claim success by redrawing");
addAccepted = true;
clickHandler({ target: addTarget });
assert.equal(panelRenderCount, 2, "accepted add callback must redraw the local panel");

const notificationSandbox = createSandbox();
notificationSandbox.ZETER_CORE_UTILS = { escapeHtml };
load(notificationSandbox, "notification-utils.js");
load(notificationSandbox, "notification-ui-utils.js");
const notificationUi = notificationSandbox.ZETER_NOTIFICATION_UI_UTILS;
const actionTarget = attribute => ({ closest: selector => selector === `[${attribute}]` ? {} : null });
assert.deepEqual(plain(notificationUi.notificationCenterAction(actionTarget("data-mark-all-notifications-read"))), { type: "mark-all-read" });
assert.deepEqual(plain(notificationUi.notificationCenterAction(actionTarget("data-clear-read-notifications"))), { type: "clear-read" });

let notifications = [
  { id: "read", title: "Прочитано", text: "", read: true },
  { id: "new", title: "Новое", text: "", read: false }
];
let notificationSaves = 0;
const notificationController = notificationUi.createNotificationCenterController({
  document: { querySelector: () => null, querySelectorAll: () => [] },
  getNotifications: () => notifications,
  setNotifications: value => { notifications = value; },
  saveState: () => { notificationSaves += 1; }
});
assert.equal(notificationController.markRead(), true);
assert.equal(notifications.every(item => item.read), true);
assert.equal(notificationController.clearRead(), true);
assert.equal(notifications.length, 0);
assert.equal(notificationSaves, 2);
assert.equal(notificationController.clearRead(), false, "repeat clear must not save again");
assert.equal(notificationSaves, 2);

const markButton = {};
const clearButton = {};
notificationUi.renderNotificationCenterView({
  notifications: [{ read: false }, { read: true }],
  markAllReadButton: markButton,
  clearReadButton: clearButton
});
assert.equal(markButton.disabled, false);
assert.equal(clearButton.disabled, false);
notificationUi.renderNotificationCenterView({ notifications: [], markAllReadButton: markButton, clearReadButton: clearButton });
assert.equal(markButton.disabled, true);
assert.equal(clearButton.disabled, true);

let openedEndpoint = null;
const genericNotification = {
  id: "generic",
  title: "Связанный объект",
  text: "Открыть заметку",
  linkedObjectKind: "fs",
  linkedObjectId: "note_1"
};
const notificationOpener = notificationUi.createTaskNotificationController({
  getNotifications: () => [genericNotification],
  openLinkedObject: endpoint => { openedEndpoint = endpoint; return true; }
});
assert.equal(notificationOpener.openById("generic"), true);
assert.deepEqual(plain(openedEndpoint), { kind: "fs", id: "note_1", eventDate: "" });
assert.match(notificationUi.notificationListHTML([genericNotification], {
  matchesFilter: () => true,
  canOpen: notificationSandbox.ZETER_NOTIFICATION_UTILS.notificationCanOpen
}), /class="notification unread openable"/);

const editorSandbox = createSandbox();
editorSandbox.ZETER_CORE_UTILS = {
  escapeHtml,
  $: (selector, root) => root?.querySelector?.(selector) || null
};
editorSandbox.ZETER_RICH_TEXT_UTILS = {
  RICH_TEXT_FONT_SIZE_MIN: 8,
  RICH_TEXT_FONT_SIZE_MAX: 200,
  plainToRichHtml: value => value,
  cleanRichHtml: value => value,
  normalizeRichTextFontSize: value => Number(value) || 0,
  normalizeRichTextLink: value => String(value || "")
};
editorSandbox.ZETER_MARKDOWN_UTILS = { markdown: value => value };
editorSandbox.ZETER_MANAGED_FILE_UTILS = {
  ensureManagedFileInlineMarkers: () => false,
  plainTextWithoutManagedFiles: value => String(value || "")
};
load(editorSandbox, "editor-ui-utils.js");
const editorUi = editorSandbox.ZETER_EDITOR_UI_UTILS;
assert.match(editorUi.richEditorHTML("Заметка"), /data-editor-object-links-host hidden/);
const editorHost = {
  hidden: true,
  innerHTML: "old",
  child: null,
  appendChild(value) { this.child = value; },
  setAttribute(name, value) { this[name] = value; }
};
const editorRoot = { querySelector: selector => selector === "[data-editor-object-links-host]" ? editorHost : null };
const editorPanel = { id: "editor-links" };
assert.equal(editorUi.mountEditorObjectLinksPanel(editorRoot, editorPanel), true);
assert.equal(editorHost.child, editorPanel);
assert.equal(editorHost.hidden, false);

let editorEndpoint = null;
let richEditorOptions = null;
const editorController = editorUi.createDocumentEditorRuntimeController({
  getState: () => ({ fs: { note_1: { id: "note_1", name: "Заметка", parent: "desktop", content: "", richContent: "" } } }),
  createRichEditor: options => { richEditorOptions = options; return { dataset: {} }; },
  objectLinksPanelFor: endpoint => { editorEndpoint = endpoint; return editorPanel; }
});
editorController.renderRichEditorApp({ itemId: "note_1" }, "editor_window");
assert.deepEqual(plain(editorEndpoint), { kind: "fs", id: "note_1" });
assert.equal(richEditorOptions.objectLinksPanel, editorPanel);

const calendarSandbox = createSandbox({ crypto: require("node:crypto").webcrypto });
["version.js", "config.js", "utils.js", "data-normalizers.js", "calendar-utils.js", "calendar-ui-utils.js"].forEach(name => load(calendarSandbox, name));
const calendarUi = calendarSandbox.ZETER_CALENDAR_UI_UTILS;
assert.match(calendarUi.calendarEventEditorHTML(), /data-calendar-event-object-links-host hidden/);
const calendarHost = {
  hidden: true,
  innerHTML: "old",
  child: null,
  appendChild(value) { this.child = value; },
  setAttribute(name, value) { this[name] = value; }
};
const calendarControls = {
  "[data-form-title]": { textContent: "" },
  "[data-ev-title]": { value: "", focus() {} },
  "[data-ev-date]": { value: "", min: "" },
  "[data-ev-start]": { value: "" },
  "[data-ev-end]": { value: "" },
  "[data-ev-location]": { value: "" },
  "[data-ev-category]": { value: "" },
  "[data-ev-repeat]": { value: "" },
  "[data-ev-reminder]": { value: "" },
  "[data-ev-desc]": { value: "" },
  "[data-save-event]": { textContent: "" },
  "[data-calendar-event-object-links-host]": calendarHost
};
const calendarRoot = {
  className: "",
  innerHTML: "",
  querySelector: selector => calendarControls[selector] || null,
  addEventListener() {}
};
let calendarEndpoint = null;
const calendarPanel = { id: "calendar-links" };
calendarUi.createCalendarEventEditorApp({ eventId: "event_1", date: "2026-08-31" }, "calendar_window", {
  document: { createElement: () => calendarRoot },
  getCalendar: () => ({ selected: "2026-08-31" }),
  getEvents: () => [{
    id: "event_1",
    title: "Встреча",
    date: "2026-08-31",
    start: "09:00",
    end: "10:00",
    category: "work",
    repeat: "none",
    reminder: 15
  }],
  objectLinksPanelFor: endpoint => { calendarEndpoint = endpoint; return calendarPanel; }
});
assert.deepEqual(plain(calendarEndpoint), { kind: "event", id: "event_1" });
assert.equal(calendarHost.child, calendarPanel);
assert.equal(calendarHost.hidden, false);

console.log("feature7 UI smoke: ok");
