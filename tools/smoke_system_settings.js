"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(ROOT, "app", "js", "core");
const sandbox = { console, Date, setInterval, clearInterval };
sandbox.window = sandbox;
vm.createContext(sandbox);

function loadCore(name) {
  const filePath = path.join(CORE_DIR, name);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
}

loadCore("system-settings-utils.js");
loadCore("notification-utils.js");

const settingsUtils = sandbox.ZETER_SYSTEM_SETTINGS_UTILS;
const notificationUtils = sandbox.ZETER_NOTIFICATION_UTILS;
assert.ok(settingsUtils && notificationUtils, "system settings and notification contracts must load");

const defaults = settingsUtils.normalizeSystemSettings();
assert.equal(defaults.startup.restoreWindows, true);
assert.equal(defaults.startup.desktop, "last");
assert.equal(defaults.startup.windowMode, "maximized");
assert.equal(defaults.notifications.enabled, true);
assert.equal(defaults.accessibility.textScale, 100);
assert.equal(defaults.hotkeys.search, "Ctrl+Space");

const normalized = settingsUtils.normalizeSystemSettings({
  futureField: "keep",
  startup: { windowMode: "windowed" },
  accessibility: { textScale: 120, futureAccessibility: true },
  notifications: { quietHoursEnabled: true, quietFrom: "22:00", quietTo: "08:00" },
  hotkeys: { search: "control+space", calendar: "invalid" }
});
assert.equal(normalized.futureField, "keep");
assert.equal(normalized.startup.windowMode, "windowed");
assert.equal(normalized.accessibility.futureAccessibility, true);
assert.equal(normalized.accessibility.textScale, 120);
assert.equal(normalized.hotkeys.search, "Ctrl+Space");
assert.equal(normalized.hotkeys.calendar, "");

assert.equal(settingsUtils.keyboardEventHotkey({ ctrlKey: true, code: "Space", key: " " }), "Ctrl+Space");
assert.equal(settingsUtils.hotkeyActionForEvent({ ctrlKey: true, code: "Space", key: " " }, normalized), "search");
assert.equal(settingsUtils.isHotkeyAssignable("Ctrl+Alt+K"), true);
assert.equal(settingsUtils.isHotkeyAssignable("Alt+Tab"), false);
assert.equal(settingsUtils.isHotkeyAssignable("Ctrl+Z"), false);
assert.equal(settingsUtils.hotkeyConflict("calendar", "Ctrl+Space", normalized).id, "search");

const quietDate = new Date(2026, 6, 18, 23, 30);
const daytimeDate = new Date(2026, 6, 18, 12, 0);
assert.equal(settingsUtils.quietHoursActive(normalized.notifications, quietDate), true);
assert.equal(settingsUtils.quietHoursActive(normalized.notifications, daytimeDate), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(settingsUtils.notificationDeliveryDecision(normalized, "tasks", quietDate))),
  { store: true, popup: false, quiet: true }
);

const now = new Date(2026, 6, 18, 10, 0).getTime();
const stores = [{
  desktopId: "desktop",
  events: [{ id: "event_1", title: "Встреча", date: "2026-07-18", start: "10:15", reminder: "15", repeat: "none" }]
}];
const firstCalendarPass = notificationUtils.collectDueCalendarReminderNotifications(stores, {
  now,
  occursOn: (event, iso) => event.date === iso
});
assert.equal(firstCalendarPass.changed, true);
assert.equal(firstCalendarPass.notifications.length, 1);
assert.equal(firstCalendarPass.notifications[0].notification.options.action, "open-calendar");
assert.equal(firstCalendarPass.notifications[0].notification.options.calendarDate, "2026-07-18");
const secondCalendarPass = notificationUtils.collectDueCalendarReminderNotifications(stores, {
  now,
  occursOn: (event, iso) => event.date === iso
});
assert.equal(secondCalendarPass.changed, false, "calendar reminder must not repeat for the same occurrence");

console.log("system settings smoke: ok");
