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

// Catch a missing week-start parameter at the real date, grid and controller boundaries.
const isoDate = value => sandbox.ZETER_CORE_UTILS.dateISO(value);
const wednesday = new Date(2026, 6, 15, 12);
assert.equal(isoDate(calendar.startOfWeek(wednesday)), "2026-07-13", "legacy callers must keep Monday");
assert.equal(isoDate(calendar.startOfWeek(wednesday, "sunday")), "2026-07-12", "Sunday week must include the preceding Sunday");
assert.equal(wednesday.getDate(), 15, "week alignment must not change its input date");
for (const invalid of [null, "", "Saturday", {}, 0]) {
  assert.equal(isoDate(calendar.startOfWeek(wednesday, invalid)), "2026-07-13", "invalid preferences must safely use Monday");
}
assert.equal(calendar.calendarTitleText({ view: "week", date: "2026-07-15" }, isoDate), "Неделя 2026-07-13 — 2026-07-19");
assert.equal(calendar.calendarTitleText({ view: "week", date: "2026-07-15" }, isoDate, "sunday"), "Неделя 2026-07-12 — 2026-07-18");

class CalendarElement {
  constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this._html = ""; }
  set innerHTML(value) {
    this._html = value;
    this.children = [];
    this.firstElementChild = value.startsWith('<div class="weekday">') ? { innerHTML: value } : null;
  }
  get innerHTML() { return this._html; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  querySelector(selector) { return this.controls?.[selector] || null; }
}
const calendarDocument = { createElement: () => new CalendarElement() };
sandbox.document = calendarDocument;
const daysOf = grid => grid.children.filter(child => child.dataset?.day).map(child => child.dataset.day);
const headerNames = grid => grid.children.slice(0, 7).map(child => child.innerHTML.match(/>([^<]+)</)[1]);
const expectedMondayWeek = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18", "2026-07-19"];
const expectedSundayWeek = ["2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17", "2026-07-18"];
assert.deepEqual(daysOf(calendarUi.calendarWeekViewElement("2026-07-15")), expectedMondayWeek);
assert.deepEqual(daysOf(calendarUi.calendarWeekViewElement("2026-07-15", () => [], "sunday")), expectedSundayWeek);
const sundayEvent = { id: "week-start-event", title: "Воскресная встреча", date: "2026-11-01", start: "10:00", end: "11:00", repeat: "none" };
const eventSnapshot = JSON.stringify(sundayEvent);
const monthDates = "2026-10-26 2026-10-27 2026-10-28 2026-10-29 2026-10-30 2026-10-31 2026-11-01 2026-11-02 2026-11-03 2026-11-04 2026-11-05 2026-11-06 2026-11-07 2026-11-08 2026-11-09 2026-11-10 2026-11-11 2026-11-12 2026-11-13 2026-11-14 2026-11-15 2026-11-16 2026-11-17 2026-11-18 2026-11-19 2026-11-20 2026-11-21 2026-11-22 2026-11-23 2026-11-24 2026-11-25 2026-11-26 2026-11-27 2026-11-28 2026-11-29 2026-11-30 2026-12-01 2026-12-02 2026-12-03 2026-12-04 2026-12-05 2026-12-06 2026-12-07 2026-12-08 2026-12-09 2026-12-10 2026-12-11 2026-12-12".split(" ");
for (const [weekStart, expectedOffset, headers] of [
  [undefined, 0, ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]],
  ["monday", 0, ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]],
  ["sunday", 6, ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]],
  ["invalid", 0, ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]]
]) {
  const month = calendarUi.calendarMonthViewElement({
    calendarDateISO: "2026-11-01", selectedISO: sundayEvent.date, weekStart,
    eventsForDate: iso => calendar.calendarEventsForDate([sundayEvent], iso)
  });
  assert.deepEqual(headerNames(month), headers, "headers must follow the selected week start");
  assert.deepEqual(daysOf(month), monthDates.slice(expectedOffset, expectedOffset + 42), "month must contain 42 consecutive correctly aligned dates");
  const eventCells = month.children.filter(child => child.innerHTML?.includes(sundayEvent.title));
  assert.equal(eventCells.length, 1);
  assert.equal(eventCells[0].dataset.day, "2026-11-01", "week preference must not move an event to a different date");
}
assert.equal(JSON.stringify(sundayEvent), eventSnapshot, "rendering must not mutate event data");
assert.deepEqual(Array.from(calendarUi.CALENDAR_WEEKDAY_NAMES), ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], "legacy weekday export must remain Monday-based");

const liveRoot = new CalendarElement();
liveRoot.controls = Object.fromEntries(["[data-view]", ".calendar-title", ".calendar-board", ".event-list"].map(selector => [selector, new CalendarElement()]));
let liveCalendar = { view: "week", date: "2026-07-15", selected: "2026-07-15" };
let weekPreference = "sunday", weekPreferenceReads = 0;
calendarUi.createCalendarApp({
  document: { createElement: () => liveRoot },
  getCalendar: () => liveCalendar,
  setCalendar: value => { liveCalendar = value; },
  getWeekStart: () => { weekPreferenceReads++; return weekPreference; },
  formatDate: isoDate
});
const liveBoard = liveRoot.controls[".calendar-board"];
assert.equal(liveRoot.controls[".calendar-title"].textContent, "Неделя 2026-07-12 — 2026-07-18");
assert.deepEqual(daysOf(liveBoard.children[0]), expectedSundayWeek, "controller must use the same preference for title and grid");
weekPreference = "monday";
liveRoot.listeners.change({ target: { matches: selector => selector === "[data-view]", value: "week" } });
assert.equal(liveRoot.controls[".calendar-title"].textContent, "Неделя 2026-07-13 — 2026-07-19");
assert.deepEqual(daysOf(liveBoard.children[0]), expectedMondayWeek, "next draw must read the current preference");
assert.equal(weekPreferenceReads, 2, "one consistent preference snapshot is required for each draw");

const shell = calendarUi.calendarShellHTML("Основной");
assert.match(shell, /calendar-selected-day-card/, "selected-day panel must occupy the calendar side column");
assert.doesNotMatch(shell, /data-ev-title/, "event form must not remain inside the calendar window");

const selectedDay = calendarUi.calendarMonthDayHTML(15, [], { date: "2026-07-15" });
const anotherDay = calendarUi.calendarMonthDayHTML(16, [], { date: "2026-07-16" });
const pastDay = calendarUi.calendarMonthDayHTML(14, [], { date: "2026-07-14" });
assert.doesNotMatch(selectedDay, /data-add-event/, "month cells must not repeat the primary creation action");
assert.doesNotMatch(anotherDay, /data-add-event/, "future cells stay uncluttered");
assert.doesNotMatch(pastDay, /data-add-event/, "past cells remain selectable without a misleading creation button");
assert.equal((shell.match(/data-add-event=/g) || []).length, 1, "calendar must have one primary create action");
assert.match(calendarUi.calendarDayViewElement("2026-07-15").children[0].innerHTML, /24:00/, "ruler includes the entire day");
assert.match(calendarUi.calendarEventEditorHTML(), /data-ev-end-date/, "editor exposes multi-day end date");
assert.match(calendarUi.calendarEventEditorHTML(), /data-ev-scope/, "recurrence edits expose scope");

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
async function verifyControllers() {
function controllerHarness(initialEvents = [], params = { date: "2026-07-15" }, overrides = {}) {
  let state = { selected: "2026-07-15", date: "2026-07-15", view: "month" };
  let storedEvents = initialEvents;
  const calls = { setEvents: 0, setCalendar: 0, save: 0, refresh: 0, notify: 0, close: 0, opened: [], toasts: [] };
  const controls = {};
  Object.entries(fields).forEach(([selector, field]) => {
    controls[selector] = { value: field.value, min: "", focused: false, focus() { this.focused = true; } };
  });
  const listeners = {};
  const root = { querySelector: selector => controls[selector] || null, querySelectorAll: selector => selector === "input,select,textarea,button" ? Object.values(controls) : [], addEventListener: (type, fn) => { listeners[type] = fn; } };
  const integration = {
    document: { createElement: () => root },
    getCalendar: () => state,
    setCalendar: value => { state = value; calls.setCalendar++; },
    getEvents: () => storedEvents,
    setEvents: value => { storedEvents = value; calls.setEvents++; },
    saveState: () => { calls.save++; },
    saveEventRecord: (draft, editingId) => {
      const event = calendar.upsertCalendarEvent(storedEvents, { ...draft, id: editingId || "fixture-event" }, editingId);
      calls.save++;
      return Promise.resolve(event);
    },
    removeEvent: id => { storedEvents = calendar.removeCalendarEventById(storedEvents, id); calls.save++; return Promise.resolve(true); },
    refreshOpenCalendars: () => { calls.refresh++; },
    renderNotifications: () => { calls.notify++; },
    closeWindow: () => { calls.close++; },
    openEventEditor: value => calls.opened.push(value),
    confirmUser: () => true,
    toast: (...args) => calls.toasts.push(args),
    todayISO: sandbox.ZETER_CORE_UTILS.todayISO,
    ...overrides
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
  await save();
  assert.equal(harness.getEvents().length, 0, `${saveBy}: past date must not create an event`);
  for (const effect of ["setEvents", "setCalendar", "save", "refresh", "notify", "close"]) {
    assert.equal(harness.calls[effect], 0, `${saveBy}: rejected save must not trigger ${effect}`);
  }
  assert.equal(harness.controls["[data-ev-title]"].value, "Не терять черновик");
  assert.equal(harness.controls["[data-ev-date]"].focused, true);
  assert.equal(harness.calls.toasts[0][0], "Дата уже прошла");
  harness.controls["[data-ev-date]"].value = saveBy === "button" ? "2026-07-15" : "2026-07-16";
  await save();
  assert.equal(harness.getEvents().length, 1, `${saveBy}: valid retry must create exactly one event`);
  assert.equal(harness.getEvents()[0].date, harness.controls["[data-ev-date]"].value);
  assert.equal(harness.calls.save, 1);
  assert.equal(harness.calls.close, 1);
}

const staleEditor = controllerHarness();
staleEditor.controls["[data-ev-title]"].value = "Начато вчера";
localNow = new Date(2026, 6, 16, 0, 1).getTime();
await staleEditor.key("Enter");
assert.equal(staleEditor.getEvents().length, 0, "editor opened before midnight must use the current date when saving");
assert.equal(staleEditor.calls.close, 0);
assert.equal(staleEditor.controls["[data-ev-date]"].min, "2026-07-16");
staleEditor.controls["[data-ev-date]"].value = "2026-07-16";
await staleEditor.key("Enter");
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
await editHarness.click("[data-save-event]");
assert.equal(editHarness.getEvents().length, 1);
assert.equal(editHarness.getEvents()[0].id, oldEvent.id);
assert.equal(editHarness.getEvents()[0].date, "2026-07-14");
assert.equal(editHarness.getEvents()[0].title, "История исправлена");
assert.equal(editHarness.calls.save, 1);
assert.match(calendarUi.calendarSelectedEventsHTML([oldEvent]), /data-edit-event="event_old"/, "past event must remain viewable and editable");
const oldCalendar = controllerHarness([{ ...oldEvent }], null);
oldCalendar.click("[data-edit-event]", { editEvent: oldEvent.id });
assert.equal(oldCalendar.calls.opened[0].eventId, oldEvent.id);
await oldCalendar.click("[data-delete-event]", { deleteEvent: oldEvent.id });
assert.equal(oldCalendar.getEvents().length, 0, "past event deletion must remain available");
assert.equal(oldCalendar.calls.save, 1);

async function verifyPendingSave() {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const harness = controllerHarness([], { date: "2026-07-17" }, {
    saveState: () => pending,
    saveEventRecord: () => pending
  });
  harness.controls["[data-ev-title]"].value = "Черновик до подтверждения";
  harness.click("[data-save-event]");
  assert.equal(harness.calls.close, 0, "pending storage must not close the event editor");
  assert.equal(harness.controls["[data-ev-title]"].value, "Черновик до подтверждения", "pending storage must preserve the draft");
  assert.equal(harness.calls.toasts.length, 0, "pending storage must not report success");
  release({ id: "pending", title: "Черновик до подтверждения", date: "2026-07-17" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.close, 1);
}
await verifyPendingSave();
}
verifyControllers().then(() => console.log("calendar runtime smoke: ok")).catch(error => { console.error(error); process.exitCode = 1; });
