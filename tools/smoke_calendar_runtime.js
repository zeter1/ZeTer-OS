"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(ROOT, "app", "js", "core");
let localNow = new Date(2026, 6, 15, 12).getTime();
class CalendarTestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [localNow])); }
  static now() { return localNow; }
}
const sandbox = {
  console,
  Date: CalendarTestDate,
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
const calendar = sandbox.ZETER_CALENDAR_UTILS;
assert.ok(calendarUi, "calendar UI runtime must load");
assert.equal(calendar.moveCalendarState({ view: "month", date: "2026-01-31", selected: "2026-01-31" }, "next").date, "2026-02-28");
assert.equal(calendar.moveCalendarState({ view: "month", date: "2026-03-31", selected: "2026-03-31" }, "previous").date, "2026-02-28");

const shell = calendarUi.calendarShellHTML("Основной");
assert.match(shell, /calendar-selected-day-card/, "selected-day panel must occupy the calendar side column");
assert.doesNotMatch(shell, /data-ev-title/, "event form must not remain inside the calendar window");

const selectedDay = calendarUi.calendarMonthDayHTML(15, [], { date: "2026-07-15" });
const anotherDay = calendarUi.calendarMonthDayHTML(16, [], { date: "2026-07-16" });
const pastDay = calendarUi.calendarMonthDayHTML(14, [], { date: "2026-07-14" });
assert.match(selectedDay, /data-add-event="2026-07-15"/, "selected date must show the add-event button");
assert.match(selectedDay, />Добавить событие</, "add-event button must have a clear label");
assert.match(anotherDay, /data-add-event="2026-07-16"/, "every month date must show its own add-event button");
assert.match(pastDay, / disabled title="Нельзя добавлять события на прошедшие даты"/, "past dates must explain their disabled add action");
assert.doesNotMatch(selectedDay, / disabled/, "today must allow creation");
assert.doesNotMatch(anotherDay, / disabled/, "future dates must allow creation");

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
fields["[data-ev-date]"].value = "2026-07-14";
const rejected = calendarUi.saveCalendarEventFromForm(formRoot, { selected: "2026-07-15", editing: null }, events);
assert.equal(rejected.reason, "past-date", "manual past date must be rejected before mutation");
assert.equal(events.length, 0);
assert.equal(fields["[data-ev-title]"].value, "Встреча", "rejection must preserve the draft");
fields["[data-ev-date]"].value = "2026-07-15";
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

// Exercise the owning controllers, including side effects and both save routes.
function controllerHarness(initialEvents = [], params = { date: "2026-07-15" }) {
  let state = { selected: "2026-07-15", date: "2026-07-15", view: "month" };
  let storedEvents = initialEvents;
  const calls = { setEvents: 0, setCalendar: 0, save: 0, refresh: 0, notify: 0, close: 0, opened: [], toasts: [] };
  const controls = {};
  Object.entries(fields).forEach(([selector, field]) => {
    controls[selector] = { value: field.value, min: "", focused: false, focus() { this.focused = true; } };
  });
  const listeners = {};
  const root = { querySelector: selector => controls[selector] || null, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const integration = {
    document: { createElement: () => root },
    getCalendar: () => state,
    setCalendar: value => { state = value; calls.setCalendar++; },
    getEvents: () => storedEvents,
    setEvents: value => { storedEvents = value; calls.setEvents++; },
    saveState: () => { calls.save++; },
    refreshOpenCalendars: () => { calls.refresh++; },
    renderNotifications: () => { calls.notify++; },
    closeWindow: () => { calls.close++; },
    openEventEditor: value => calls.opened.push(value),
    confirmUser: () => true,
    toast: (...args) => calls.toasts.push(args),
    todayISO: sandbox.ZETER_CORE_UTILS.todayISO
  };
  if (params) calendarUi.createCalendarEventEditorApp(params, "test-editor", integration);
  else calendarUi.createCalendarApp(integration);
  const click = (selector, dataset = {}) => listeners.click({ target: { closest: candidate => candidate === selector ? { dataset } : null } });
  const key = keyName => listeners.keydown({ key: keyName, ctrlKey: keyName === "Enter", preventDefault() {} });
  return { calls, controls, click, key, getEvents: () => storedEvents };
}

for (const saveBy of ["button", "Ctrl+Enter"]) {
  const harness = controllerHarness();
  assert.equal(harness.controls["[data-ev-date]"].min, "2026-07-15");
  harness.controls["[data-ev-title]"].value = "Не терять черновик";
  harness.controls["[data-ev-date]"].value = "2026-07-14";
  const save = () => saveBy === "button" ? harness.click("[data-save-event]") : harness.key("Enter");
  save();
  assert.equal(harness.getEvents().length, 0, `${saveBy}: past date must not create an event`);
  for (const effect of ["setEvents", "setCalendar", "save", "refresh", "notify", "close"]) {
    assert.equal(harness.calls[effect], 0, `${saveBy}: rejected save must not trigger ${effect}`);
  }
  assert.equal(harness.controls["[data-ev-title]"].value, "Не терять черновик");
  assert.equal(harness.controls["[data-ev-date]"].focused, true);
  assert.equal(harness.calls.toasts[0][0], "Дата уже прошла");
  harness.controls["[data-ev-date]"].value = saveBy === "button" ? "2026-07-15" : "2026-07-16";
  save();
  assert.equal(harness.getEvents().length, 1, `${saveBy}: valid retry must create exactly one event`);
  assert.equal(harness.getEvents()[0].date, harness.controls["[data-ev-date]"].value);
  assert.equal(harness.calls.save, 1);
  assert.equal(harness.calls.close, 1);
}

const staleEditor = controllerHarness();
staleEditor.controls["[data-ev-title]"].value = "Начато вчера";
localNow = new Date(2026, 6, 16, 0, 1).getTime();
staleEditor.key("Enter");
assert.equal(staleEditor.getEvents().length, 0, "editor opened before midnight must use the current date when saving");
assert.equal(staleEditor.calls.close, 0);
assert.equal(staleEditor.controls["[data-ev-date]"].min, "2026-07-16");
staleEditor.controls["[data-ev-date]"].value = "2026-07-16";
staleEditor.key("Enter");
assert.equal(staleEditor.getEvents().length, 1, "midnight rejection must allow correction and retry");

localNow = new Date(2026, 6, 15, 12).getTime();
const calendarHarness = controllerHarness([], null);
calendarHarness.click("[data-add-event]", { addEvent: "2026-07-14" });
assert.equal(calendarHarness.calls.opened.length, 0, "past-date action must not open the editor even if dispatched directly");
assert.equal(calendarHarness.calls.setCalendar, 0, "rejected action must not mutate selection");
calendarHarness.click("[data-add-event]", { addEvent: "2026-07-15" });
assert.equal(calendarHarness.calls.opened.length, 1, "today must open the editor");
localNow = new Date(2026, 6, 16, 0, 1).getTime();
calendarHarness.click("[data-add-event]", { addEvent: "2026-07-15" });
assert.equal(calendarHarness.calls.opened.length, 1, "stale button must be rejected after midnight");
calendarHarness.click("[data-add-event]", { addEvent: "2026-07-17" });
assert.equal(calendarHarness.calls.opened.length, 2, "future date must still open the editor");

const oldEvent = { id: "event_old", title: "Старое событие", date: "2026-07-14", start: "09:00", end: "10:00" };
const editHarness = controllerHarness([{ ...oldEvent }], { eventId: oldEvent.id });
assert.equal(editHarness.controls["[data-ev-date]"].min, "", "editing history must not acquire the creation restriction");
editHarness.controls["[data-ev-title]"].value = "История исправлена";
editHarness.click("[data-save-event]");
assert.equal(editHarness.getEvents().length, 1);
assert.equal(editHarness.getEvents()[0].id, oldEvent.id);
assert.equal(editHarness.getEvents()[0].date, "2026-07-14");
assert.equal(editHarness.getEvents()[0].title, "История исправлена");
assert.equal(editHarness.calls.save, 1);
assert.match(calendarUi.calendarSelectedEventsHTML([oldEvent]), /data-edit-event="event_old"/, "past event must remain viewable and editable");
const oldCalendar = controllerHarness([{ ...oldEvent }], null);
oldCalendar.click("[data-edit-event]", { editEvent: oldEvent.id });
assert.equal(oldCalendar.calls.opened[0].eventId, oldEvent.id);
oldCalendar.click("[data-delete-event]", { deleteEvent: oldEvent.id });
assert.equal(oldCalendar.getEvents().length, 0, "past event deletion must remain available");
assert.equal(oldCalendar.calls.save, 1);

console.log("calendar runtime smoke: ok");
