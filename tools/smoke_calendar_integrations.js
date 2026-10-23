"use strict";
// Pure VM fixtures: no application startup, browser, native API or persisted data.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const box = { console, Date, setTimeout, clearTimeout }; box.window = box;
vm.createContext(box);
function load(name) {
  const file = path.join(__dirname, "../app/js/core", name);
  vm.runInContext(fs.readFileSync(file, "utf8"), box, { filename: file });
}
["version.js", "config.js", "utils.js", "data-normalizers.js", "automation-utils.js", "calendar-utils.js", "notification-utils.js", "security-restore-utils.js", "time-tracking-utils.js", "time-tracking-ui-utils.js"].forEach(load);
const calendar = box.ZETER_CALENDAR_UTILS, notifications = box.ZETER_NOTIFICATION_UTILS, automation = box.ZETER_AUTOMATION_UTILS;
const event = { id: "meeting", title: "План", date: "2026-10-19", endDate: "2026-10-21", start: "10:00", end: "11:00", reminder: "15", repeat: "weekly", repeatInterval: 2, repeatWeekdays: [1, 3], repeatUntil: "2026-11-04", excludedDates: ["2026-10-21"] };
const at = (iso, h, m) => new Date(`${iso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime();
const due = (row, day, h = 9, m = 45) => notifications.dueCalendarOccurrence(row, { now: at(day, h, m) });
assert.ok(due(event, "2026-10-19"));
assert.equal(due(event, "2026-10-20"), null, "multi-day continuation must not send a start reminder");
assert.equal(due(event, "2026-10-21"), null, "excluded weekly start must not send a reminder");
assert.equal(due(event, "2026-10-26"), null, "alternate week must not send a reminder");
assert.ok(due(event, "2026-11-04"), "inclusive final start must send a reminder");
assert.equal(due(event, "2026-11-16"), null, "series after until must not send a reminder");
const allDay = { ...event, id: "all", repeat: "none", allDay: true, start: "", end: "", excludedDates: [] };
assert.ok(due(allDay, "2026-10-19", 8, 45), "all-day reminders use local 09:00");
assert.equal(due(allDay, "2026-10-20", 8, 45), null);
const stores = [{ desktopId: "desktop", events: [{ ...allDay }] }];
assert.equal(notifications.collectDueCalendarReminderNotifications(stores, { now: at("2026-10-19", 8, 45) }).notifications.length, 1);
assert.equal(notifications.collectDueCalendarReminderNotifications(stores, { now: at("2026-10-19", 8, 46) }).notifications.length, 0, "delivery marker prevents a duplicate");
assert.ok(due({ ...event, repeat: "none", reminder: "2880" }, "2026-10-17", 10, 0), "reminder lead can reach two calendar days ahead");
const dailyStores = [{ events: [{ ...event, repeat: "daily", repeatInterval: 1, reminder: "2880", excludedDates: [] }] }];
const deliveredDates = [];
for (let pass = 0; pass < 7; pass++) deliveredDates.push(...notifications.collectDueCalendarReminderNotifications(dailyStores, { now: at("2026-10-19", 10, 0) }).notifications.map(row => row.occurrence.iso));
assert.equal(new Set(deliveredDates).size, deliveredDates.length, "long-lead daily reminders never bounce the single delivery marker between occurrences");
assert.ok(due({ ...event, date: "2026-10-19", endDate: "2026-10-19", repeat: "none", start: "23:59" }, "2026-10-20", 0, 2), "five-minute grace survives midnight");
const rule = { id: "before", enabled: true, type: "event_before", eventId: event.id, minutesBefore: 15, actions: [{ type: "notify", title: "План" }] };
const run = (row, day, h = 9, m = 45) => automation.dueRunForAutomation({ ...rule, eventId: row.id }, { now: new Date(at(day, h, m)), events: [row] });
assert.ok(run(event, "2026-10-19"));
for (const date of ["2026-10-20", "2026-10-21", "2026-10-26", "2026-11-16"]) assert.equal(run(event, date), null, `automation must honor start/skip/interval/until on ${date}`);
assert.ok(run(allDay, "2026-10-19", 8, 45));
assert.ok(calendar.occursOn(event, "2026-11-04"));

// Event-relative offsets are elapsed minutes; occurrence dates stay local across DST.
function relativeAutomationRegressions() {
  const previousZone = process.env.TZ, failures = [];
  let cases = 0;
  const check = (name, operation) => { cases++; try { operation(); } catch (error) { failures.push(new Error(`${name}: ${error.message}`)); } };
  const relativeRule = (row, offsetMinutes) => ({ id: "relative", enabled: true, type: "event_relative", eventId: row.id, offsetMinutes, actions: [{ type: "notify", title: "Проверка" }] });
  try {
    for (const zone of ["Europe/Minsk", "Europe/Berlin"]) {
      process.env.TZ = zone;
      assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, zone);
      for (const date of ["2027-01-04", "2027-03-27", "2027-10-30"]) for (const hour of [0, 10, 23]) {
        const row = { id: "relative-event", title: "Проверка", date, endDate: date, start: `${String(hour).padStart(2, "0")}:30`, end: "", repeat: "none" };
        const eventAt = at(date, hour, 30), before = JSON.stringify(row);
        for (const days of [-7, -2, -1, 0, 1, 2, 7]) for (const grace of [-1, 0, 60, 1439, 1440, 1441]) check(`${zone} ${date} ${row.start} offset ${days}d grace ${grace}m`, () => {
          const offsetMinutes = days * 1440, scheduledAt = eventAt + offsetMinutes * 60000;
          const result = automation.dueRunForAutomation(relativeRule(row, offsetMinutes), { now: new Date(scheduledAt + grace * 60000), events: [row] });
          assert.equal(Boolean(result), grace >= 0 && grace <= 1440);
          if (result) { assert.equal(result.scheduledAt, scheduledAt); assert.equal(result.eventDate, date); }
          assert.equal(JSON.stringify(row), before, "polling must not mutate event data");
        });
      }
      check(`${zone} daily positive offset keeps occurrence identity without duplicates`, () => {
        const row = { id: "daily-relative", title: "Серия", date: "2027-03-26", endDate: "2027-03-26", start: "10:00", end: "11:00", repeat: "daily" };
        const rule = relativeRule(row, 2880), keys = new Set();
        for (const date of ["2027-03-27", "2027-03-28", "2027-03-29", "2027-03-30"]) {
          // Poll after the prior occurrence's 24h grace, including the 23h DST day.
          const now = new Date(at(date, 10, 0) + (2880 + 90) * 60000);
          const result = automation.pendingRunForAutomation(rule, { now, events: [row] });
          assert.ok(result); assert.equal(result.eventDate, date); assert.ok(!keys.has(result.runKey)); keys.add(result.runKey);
          assert.equal(automation.markAutomationRun(rule, result), true);
          assert.equal(automation.pendingRunForAutomation(rule, { now, events: [row] }), null);
        }
      });
      check(`${zone} positive offsets respect exclusions and all-day local start`, () => {
        const row = { id: "excluded-relative", title: "Серия", date: "2027-01-04", start: "10:00", end: "11:00", repeat: "weekly", repeatWeekdays: [1], repeatUntil: "2027-01-18", excludedDates: ["2027-01-11"] };
        const rule = relativeRule(row, 10080);
        for (const [date, expected] of [["2027-01-04", true], ["2027-01-11", false], ["2027-01-18", true], ["2027-01-25", false]]) assert.equal(Boolean(automation.dueRunForAutomation(rule, { now: new Date(at(date, 10, 0) + 10080 * 60000), events: [row] })), expected);
        const untimed = { ...row, id: "all-relative", repeat: "none", allDay: true, start: "", end: "", excludedDates: [] };
        const result = automation.dueRunForAutomation(relativeRule(untimed, 2880), { now: new Date(at(untimed.date, 9, 0) + 2880 * 60000), events: [untimed] });
        assert.ok(result); assert.equal(result.scheduledAt, at(untimed.date, 9, 0) + 2880 * 60000);
      });
    }
  } finally { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; }
  if (failures.length) throw new AggregateError(failures, `${failures.length}/${cases} event-relative cases failed; ${failures.slice(0, 3).map(error => error.message).join("; ")}`);
  console.log(`calendar relative automation: ok (${cases} offset/grace/DST/recurrence cases)`);
}
relativeAutomationRegressions();

const restore = box.ZETER_SECURITY_RESTORE_UTILS;
const sourceData = { tasks: [{ id: "task", title: "Задача", projectId: "project" }], taskProjects: [{ id: "project", name: "Проект" }], calendarCategories: [{ id: "calcat_focus", name: "Фокус", color: "#aabbcc" }], events: [
  { ...event, id: "block1", taskId: "task", projectId: "project", category: "calcat_focus", attachments: [{ kind: "fs", id: "note" }] },
  { ...event, id: "block2", taskId: "task", projectId: "project", category: "calcat_missing" },
  { ...event, id: "historical", taskId: "deleted", projectId: "project", projectName: "Проект" }
], objectLinks: [] };
const incoming = { fs: { note: { id: "note", type: "note", name: "Материал", parent: "desktop", content: "synthetic" } }, desktops: [{ id: "desktop", name: "Исходный", data: sourceData }], currentDesktop: "desktop" };
const current = { fs: {}, desktops: [{ id: "desktop", name: "Текущий", data: { tasks: [{ id: "deleted", title: "Другая задача", projectId: "project" }], taskProjects: [{ id: "project", name: "Другой проект" }], events: [], calendarCategories: [{ id: "calcat_focus", name: "Другой цвет", color: "#000000" }, { id: "calcat_missing", name: "Посторонняя", color: "#ffffff" }] } }], currentDesktop: "desktop" };
const before = JSON.stringify(current), incomingBefore = JSON.stringify(incoming);
const key = restore.listRestoreChoices(incoming).find(row => row.kind === "project").key;
let serial = 0;
const result = restore.prepareSelectiveRestore(current, incoming, { key, mode: "copy", createId: kind => `${kind}_${++serial}` });
const target = result.state.desktops[0].data, copiedTask = target.tasks.find(row => row.id !== "deleted"), copiedProject = target.taskProjects.find(row => row.id !== "project");
assert.equal(target.events.length, 3, "project restores all time blocks without explicit project attachments");
assert.ok(target.events.every(row => row.projectId === copiedProject.id));
assert.equal(target.events.filter(row => row.taskId === copiedTask.id).length, 2);
const historical = target.events.find(row => row.taskId !== copiedTask.id);
assert.notEqual(historical.taskId, "deleted", "deleted source task must not bind to target same-ID task");
const attachment = target.events.flatMap(row => row.attachments || [])[0];
assert.ok(result.state.fs[attachment.id], "event attachment is included and remapped");
assert.equal(result.state.fs[attachment.id].content, "synthetic");
const category = target.calendarCategories.find(row => row.name === "Фокус");
assert.match(category.id, /^calcat_/);
assert.notEqual(category.id, "calcat_focus");
assert.equal(target.events.find(row => row.attachments).category, category.id);
assert.ok(target.events.some(row => row.category.startsWith("calcat_") && !["calcat_focus", "calcat_missing", category.id].includes(row.category)), "missing category identity cannot bind to target category");
assert.equal(JSON.stringify(current), before); assert.equal(JSON.stringify(incoming), incomingBefore);
const replaced = restore.prepareSelectiveRestore(current, incoming, { key, mode: "replace", createId: kind => `${kind}_${++serial}` });
assert.notEqual(replaced.state.desktops[0].data.events.find(row => row.id === "historical").taskId, "deleted");
const missingCategorySource = JSON.parse(JSON.stringify(incoming));
missingCategorySource.desktops[0].data.calendarCategories = [];
missingCategorySource.desktops[0].data.events.slice(0, 2).forEach(row => { row.category = "calcat_missing"; row.title = "Историческая категория"; });
for (const mode of ["copy", "replace"]) {
  const restored = restore.prepareSelectiveRestore(current, missingCategorySource, { key, mode, createId: kind => `${kind}_${++serial}` });
  const restoredData = restored.state.desktops[0].data;
  const events = restoredData.events.filter(row => row.title === "Историческая категория");
  assert.equal(events.length, 2);
  assert.equal(events[0].category, events[1].category, `${mode}: missing source category keeps one shared identity`);
  assert.match(events[0].category, /^calcat_[A-Za-z0-9_-]{1,180}$/);
  assert.notEqual(events[0].category, "calcat_missing", `${mode}: missing source category cannot bind to unrelated target definition`);
  assert.ok(!restoredData.calendarCategories.some(row => row.id === events[0].category), `${mode}: historical category remains unavailable`);
  assert.equal(restoredData.calendarCategories.find(row => row.id === "calcat_missing").name, "Посторонняя");
}
const missingSource = JSON.parse(JSON.stringify(incoming));
missingSource.desktops[0].data.events[0].attachments.push({ kind: "fs", id: "gone" });
const withForeign = JSON.parse(JSON.stringify(current));
withForeign.fs.gone = { id: "gone", name: "Посторонний материал", type: "note", parent: "desktop" };
for (const mode of ["copy", "replace"]) {
  const restored = restore.prepareSelectiveRestore(withForeign, missingSource, { key, mode, createId: kind => `${kind}_${++serial}` });
  const refs = restored.state.desktops[0].data.events.flatMap(row => row.attachments || []);
  assert.ok(refs.some(ref => ref.id !== "gone" && !restored.state.fs[ref.id]), "missing attachment remains unavailable with an independent identity");
  assert.equal(restored.state.fs.gone.name, "Посторонний материал");
}
const longIds = restore.prepareSelectiveRestore(current, incoming, { key, mode: "copy", createId: () => "x".repeat(220) });
const longCategory = longIds.state.desktops[0].data.calendarCategories.find(row => row.name === "Фокус");
assert.match(longCategory.id, /^calcat_[A-Za-z0-9_-]{1,180}$/);

const draft = box.ZETER_TIME_TRACKING_UI_UTILS.timePlanDraft({ taskId: "task", startedAt: at("2026-10-19", 23, 30), durationMs: 7200000 }, sourceData);
assert.equal(draft.taskId, "task"); assert.equal(draft.projectId, "project"); assert.equal(draft.projectName, "Проект");
assert.equal(draft.date, "2026-10-19"); assert.equal(draft.endDate, "2026-10-20"); assert.equal(draft.end, "01:30");
box.ZETER_ASSET_UTILS = {}; box.ZETER_RICH_TEXT_UTILS = {}; box.ZETER_EXPORT_UTILS = { humanDateTime: () => "synthetic" };
load("readable-export-utils.js");
const text = box.ZETER_READABLE_EXPORT_UTILS.formatEventsAsText([{ ...event, category: "calcat_focus", taskId: "task", projectId: "project", projectName: "Проект", attachments: [{ kind: "fs", id: "note" }] }], "Стол", sourceData.calendarCategories);
for (const value of ["21.10.2026", "Интервал повтора: 2", "2026-10-21", "Фокус", "Задача: task", "Проект: Проект", "Материалы: fs:note"]) assert.ok(text.includes(value), `readable export contains ${value}`);
console.log("calendar integrations smoke: ok");
