"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(ROOT, "app", "js", "core");
const sandbox = {
  console,
  crypto: require("node:crypto").webcrypto,
  setTimeout,
  clearTimeout
};
sandbox.window = sandbox;
vm.createContext(sandbox);

function loadCore(name) {
  const filePath = path.join(CORE_DIR, name);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
}

["version.js", "config.js", "utils.js", "data-normalizers.js", "calendar-utils.js", "calendar-ui-utils.js"].forEach(loadCore);

const calendarUi = sandbox.ZETER_CALENDAR_UI_UTILS;
assert.ok(calendarUi, "calendar UI runtime must load");

const shell = calendarUi.calendarShellHTML("Основной");
assert.match(shell, /calendar-selected-day-card/, "selected-day panel must occupy the calendar side column");
assert.doesNotMatch(shell, /data-ev-title/, "event form must not remain inside the calendar window");

const selectedDay = calendarUi.calendarMonthDayHTML(15, [], { date: "2026-07-15" });
const anotherDay = calendarUi.calendarMonthDayHTML(16, [], { date: "2026-07-16" });
assert.match(selectedDay, /data-add-event="2026-07-15"/, "selected date must show the add-event button");
assert.match(selectedDay, />Добавить событие</, "add-event button must have a clear label");
assert.match(anotherDay, /data-add-event="2026-07-16"/, "every month date must show its own add-event button");

const addTarget = {
  closest(selector) {
    if (selector === "[data-add-event]") return { dataset: { addEvent: "2026-07-15" } };
    if (selector === "[data-day]") return { dataset: { day: "2026-07-15" } };
    return null;
  }
};
assert.deepEqual(
  JSON.parse(JSON.stringify(calendarUi.calendarClickAction(addTarget))),
  { type: "add-event", date: "2026-07-15" },
  "add-event action must win over the parent day selection"
);

const editor = calendarUi.calendarEventEditorHTML();
assert.match(editor, /data-save-event/, "separate event editor must expose save action");
assert.match(editor, /data-cancel-event-editor/, "separate event editor must expose cancel action");

const fields = {
  "[data-ev-title]": { value: "Встреча" },
  "[data-ev-date]": { value: "2026-07-15" },
  "[data-ev-start]": { value: "12:00" },
  "[data-ev-end]": { value: "13:00" },
  "[data-ev-location]": { value: "Офис" },
  "[data-ev-category]": { value: "work" },
  "[data-ev-repeat]": { value: "weekly" },
  "[data-ev-reminder]": { value: "15" },
  "[data-ev-desc]": { value: "Обсудить проект" }
};
const formRoot = { querySelector: selector => fields[selector] || null };
const events = [];
const created = calendarUi.saveCalendarEventFromForm(formRoot, { selected: "2026-07-15", editing: null }, events);
assert.equal(created.saved, true, "valid event must save");
assert.equal(events.length, 1, "new event must be appended once");
assert.equal(events[0].title, "Встреча");
assert.equal(created.calendar.editing, null);

fields["[data-ev-title]"].value = "Встреча обновлена";
const updated = calendarUi.saveCalendarEventFromForm(formRoot, { selected: "2026-07-15", editing: events[0].id }, events);
assert.equal(updated.saved, true, "existing event must update");
assert.equal(events.length, 1, "editing must not duplicate the event");
assert.equal(events[0].title, "Встреча обновлена");

fields["[data-ev-title]"].value = "Удалённая встреча";
const missing = calendarUi.saveCalendarEventFromForm(formRoot, { selected: "2026-07-15", editing: "event_deleted" }, events);
assert.equal(missing.saved, false, "deleted event must not be silently recreated or reported as saved");
assert.equal(missing.reason, "missing-event");

assert.deepEqual(
  JSON.parse(JSON.stringify(calendarUi.calendarEventEditorKeyAction({ key: "Enter", ctrlKey: true }))),
  { type: "save" },
  "Ctrl+Enter must save the separate editor"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(calendarUi.calendarEventEditorKeyAction({ key: "Escape" }))),
  { type: "cancel" },
  "Escape must close the separate editor"
);

console.log("calendar runtime smoke: ok");
