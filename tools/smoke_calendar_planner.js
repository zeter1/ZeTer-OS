"use strict";
// Only source reads and synthetic VM state: no app startup, native bridge or user storage.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), now = Date.parse("2026-10-23T12:00:00Z");
class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const box = { console, Date: FixtureDate, crypto: require("node:crypto").webcrypto, structuredClone, TextEncoder };
box.window = box; vm.createContext(box);
box.ZETER_TIME_TRACKING_UTILS = {}; // Project reference normalization is pure and does not call time APIs.
vm.runInContext(fs.readFileSync(path.join(root, "app/js/core/project-overview-utils.js"), "utf8"), box);
for (const file of ["config", "utils", "data-normalizers", "calendar-utils"]) vm.runInContext(fs.readFileSync(path.join(root, `app/js/core/${file}.js`), "utf8"), box);
const model = box.ZETER_CALENDAR_UTILS, normalize = box.ZETER_DATA_NORMALIZERS.normalizeCalendarEvent;
const clone = value => JSON.parse(JSON.stringify(value));
const event = (fields = {}) => ({ id: "series", title: "Встреча", date: "2027-01-04", endDate: "2027-01-04", start: "09:00", end: "10:00", repeat: "none", ...fields });
const dates = (fields, from, to) => Array.from(model.calendarOccurrences([event(fields)], from, to), item => item.occurrenceDate);

const denseSeries = Array.from({ length:14 }, (_, index) => event({ id:`dense_${index}`, repeat:"daily" }));
const earlySingle = event({ id:"early_single", date:"2027-01-05", endDate:"2027-01-05" });
const capped = model.calendarOccurrences([...denseSeries, earlySingle], "2027-01-04", "2028-01-04");
assert.equal(capped.length,5000);
assert.ok(capped.some(item=>item.id==="early_single"),"the cap must retain early events regardless of record order");
assert.deepEqual(clone(capped),clone(model.calendarOccurrences([earlySingle,...denseSeries.slice().reverse()],"2027-01-04","2028-01-04")),"bounded expansion must be independent of storage order");
assert.deepEqual(Array.from(model.calendarOccurrences([earlySingle,...denseSeries],"2027-01-04","2028-01-04",{limit:2}),item=>item.occurrenceKey),["dense_0@2027-01-04","dense_1@2027-01-04"]);
let comparisons=0;
box.countCalendarComparison=()=>{comparisons++;};
vm.runInContext('window.originalCalendarCompare=String.prototype.localeCompare;String.prototype.localeCompare=function(...args){countCalendarComparison();return originalCalendarCompare.apply(this,args);};',box);
try {
  const manySingles=Array.from({length:1000},(_,index)=>event({id:`single_${String(index).padStart(4,"0")}`}));
  assert.equal(model.calendarOccurrences(manySingles,"2027-01-04","2027-01-04").length,1000);
  assert.ok(comparisons<40000,`bounded insertion must not repeatedly sort all retained events (${comparisons} comparisons)`);
} finally {
  vm.runInContext('String.prototype.localeCompare=originalCalendarCompare;delete window.originalCalendarCompare;delete window.countCalendarComparison;',box);
}

assert.deepEqual(dates({ repeat: "daily", repeatInterval: 2, repeatUntil: "2027-01-10", excludedDates: ["2027-01-06"] }, "2027-01-01", "2027-01-20"), ["2027-01-04", "2027-01-08", "2027-01-10"]);
assert.deepEqual(dates({ repeat: "weekly", repeatInterval: 2, repeatWeekdays: [1, 3, 5] }, "2027-01-01", "2027-01-24"), ["2027-01-04", "2027-01-06", "2027-01-08", "2027-01-18", "2027-01-20", "2027-01-22"]);
assert.deepEqual(dates({ date: "2027-01-31", endDate: "2027-01-31", repeat: "monthly" }, "2027-01-01", "2027-05-31"), ["2027-01-31", "2027-03-31", "2027-05-31"], "monthly 31 skips missing dates without rolling into next month");
assert.deepEqual(dates({ date: "2028-02-29", endDate: "2028-02-29", repeat: "monthly", repeatInterval: 12 }, "2028-01-01", "2032-03-01"), ["2028-02-29", "2032-02-29"]);
assert.deepEqual(dates({ date: "2027-03-12", endDate: "2027-03-12", repeat: "daily" }, "2027-03-13", "2027-03-16"), ["2027-03-13", "2027-03-14", "2027-03-15", "2027-03-16"], "civil dates remain consecutive across DST weekends");
assert.deepEqual(dates({ date: "2027-10-29", endDate: "2027-10-29", repeat: "daily" }, "2027-10-30", "2027-11-02"), ["2027-10-30", "2027-10-31", "2027-11-01", "2027-11-02"]);
assert.equal(model.isCalendarDate("2027-02-29"), false); assert.equal(model.isCalendarDate("2028-02-29"), true);
assert.equal(model.calendarDateAdd("2028-03-01", -1), "2028-02-29");
assert.equal(model.calendarOccurrences([event({ repeat: "daily" })], "2027-01-01", "2028-01-01", { limit: 3 }).length, 3);

const overnight = event({ date: "2027-01-04", endDate: "2027-01-05", start: "23:00", end: "02:00", repeat: "weekly" });
const preserved = clone(overnight), overlap = model.calendarEventsForDate([overnight], "2027-01-12");
assert.equal(overlap.length, 1); assert.equal(overlap[0].date, "2027-01-11"); assert.equal(overlap[0].endDate, "2027-01-12");
assert.equal(overlap[0].id, "series"); assert.equal(overlap[0].occurrenceKey, "series@2027-01-11");
assert.equal(model.occursOn(overnight, "2027-01-11"), true, "reminders see the occurrence start");
assert.equal(model.occursOn(overnight, "2027-01-12"), false, "overlap on a second day must not trigger another reminder or automation");
assert.equal(model.calendarEventDurationMinutes(overnight), 180);
assert.deepEqual(clone(overnight), preserved, "expansion never mutates persisted series");
const afterMidnight = model.calendarDayLayout(overlap, "2027-01-12");
assert.deepEqual(clone(afterMidnight.segments.map(({ startMinute, endMinute, continuesBefore, continuesAfter }) => ({ startMinute, endMinute, continuesBefore, continuesAfter }))), [{ startMinute: 0, endMinute: 120, continuesBefore: true, continuesAfter: false }]);
assert.equal(model.calendarEventsForDate([event({ endDate: "2027-01-05", end: "00:00" })], "2027-01-05").length, 0, "midnight end is exclusive");
const allDay = event({ allDay: true, endDate: "2027-01-06" });
assert.equal(model.calendarEventsForDate([allDay], "2027-01-06").length, 1);
assert.equal(model.calendarEventsForDate([allDay], "2027-01-07").length, 0);
assert.equal(model.calendarDayLayout(model.calendarEventsForDate([allDay], "2027-01-05"), "2027-01-05").allDay.length, 1);
assert.equal(model.calendarEventDurationMinutes(allDay), 4320);

const chain = [event({ id: "A", start: "09:00", end: "10:00" }), event({ id: "B", start: "09:30", end: "10:30" }), event({ id: "C", start: "10:00", end: "11:00" }), event({ id: "D", start: "13:00", end: "14:00" })];
const layout = model.calendarDayLayout(model.calendarEventsForDate(chain, "2027-01-04"), "2027-01-04");
assert.deepEqual(Array.from(layout.segments, segment => [segment.event.id, segment.lane, segment.lanes]), [["A", 0, 2], ["B", 1, 2], ["C", 0, 2], ["D", 0, 1]]);
assert.equal(layout.busyMinutes, 180, "overlapping minutes count once");
assert.deepEqual(clone(layout.freeSlots), [{ start: 660, end: 780 }, { start: 840, end: 1080 }]);
assert.deepEqual(clone(layout.conflicts.map(({ start, end, ids }) => ({ start, end, ids }))), [{ start: 570, end: 600, ids: ["A", "B"] }, { start: 600, end: 630, ids: ["B", "C"] }]);
for (const fields of [{ end: "08:00" }, { end: "09:00" }, { endDate: "2027-01-03" }, { date: "2027-02-29" }, { repeatUntil: "2027-01-01" }, { start: "24:00" }, { repeatInterval: 0 }]) assert.throws(() => model.validateCalendarEventDraft(event(fields)));
assert.equal(model.validateCalendarEventDraft(overnight).endDate, "2027-01-05");
const legacy = normalize({ id: "legacy", title: "Старое событие", date: "2020-01-01", start: "25:99", customMetadata: { keep: "да" } });
assert.equal(legacy.start, "25:99"); assert.equal(legacy.id, "legacy"); assert.equal(legacy.endDate, "2020-01-01"); assert.deepEqual(clone(legacy.customMetadata), { keep: "да" });
assert.deepEqual(clone(normalize(clone(legacy))), clone(legacy), "normalization and JSON roundtrip preserve additive fields");
const attached = normalize(event({ attachments: [{ kind: "fs", id: "missing_file" }, { kind: "fs", id: "missing_file" }, { kind: "event", id: "other_event" }, { kind: "fs", id: "unsafe/id" }, { kind: "fs", id: "file_2" }] }));
assert.deepEqual(clone(attached.attachments), [{ kind: "fs", id: "missing_file" }, { kind: "fs", id: "file_2" }], "existing refs dedupe, invalid refs drop, missing files remain addressable");

const normalizers = box.ZETER_DATA_NORMALIZERS;
const categories = normalizers.normalizeCalendarCategories([{ id: "calcat_family", name: "  Семья  ", color: "#AB23EF", extra: { keep: true } }, { id: "calcat_family", name: "Дубликат" }, { id: "bad id", name: "Неверная" }, { id: "calcat_project", name: "Проект" }]);
assert.deepEqual(clone(categories), [{ id: "calcat_family", name: "Семья", color: "#ab23ef", extra: { keep: true } }, { id: "calcat_project", name: "Проект", color: "#8b7dff" }]);
assert.equal(normalizers.normalizeCalendarCategory("calcat_missing"), "calcat_missing");
assert.equal(model.categoryName("calcat_family", categories), "Семья");
assert.equal(model.categoryName("calcat_missing", categories), "Категория недоступна");
assert.equal(normalizers.normalizeCalendarCategory("unknown"), "personal");
assert.equal(normalizers.normalizeCalendarCategories(Array.from({ length: 110 }, (_, index) => ({ id: `calcat_${index}`, name: `Категория ${index}` }))).length, 100);
// Non-calendar import boundaries are deliberately inert; the full validator below receives no files/images.
Object.assign(box, { ZETER_ASSET_UTILS: {}, ZETER_SECURITY_PROTECTION_UTILS: {}, ZETER_RICH_TEXT_UTILS: {}, ZETER_ITEM_CUSTOMIZATION_UTILS: {} });
for (const file of ["import-utils", "state-import-validator"]) vm.runInContext(fs.readFileSync(path.join(root, `app/js/core/${file}.js`), "utf8"), box);
const validator = box.ZETER_STATE_IMPORT_VALIDATOR;
validator.validateImportedEvents([clone(attached)], "Календарь");
assert.deepEqual(clone(normalize(clone(attached))).attachments, clone(attached.attachments));
for (const attachments of [[{ kind: "event", id: "other_event" }], [{ kind: "fs", id: "unsafe/id" }], Array.from({ length: 201 }, (_, index) => ({ kind: "fs", id: `file_${index}` }))]) assert.throws(() => validator.validateImportedEvents([event({ attachments })], "Календарь"));
const imported = { fs: {}, settings: {}, events: [normalize(event({ category: "calcat_missing", repeat: "weekly", repeatWeekdays: [1, 3], endDate: "2027-01-05", taskId: "task_1", projectId: "project_1" }))], calendarCategories: clone(categories), desktops: [{ id: "desktop", data: { events: [normalize(event({ category: "calcat_family" }))], calendarCategories: clone(categories) } }] };
imported.calendarCategories[0].description="Семейные события";imported.calendarCategories[0].icon="🏠";
imported.taskProjects=[{id:"project_meta",name:"План проекта",goal:"Ожидаемый результат",status:"paused",startDate:"2027-01-01",deadline:"2027-03-01"}];
const normalizedMeta=normalizers.normalizeCalendarCategories(imported.calendarCategories);
assert.equal(normalizedMeta[0].description,"Семейные события");assert.equal(normalizedMeta[0].icon,"🏠");
for(const fields of [{description:"x".repeat(1001)},{icon:"bad"}]) assert.throws(()=>validator.validateImportedCalendarCategories([{id:"calcat_meta",name:"Категория",...fields}],"Календарь"));
for(const fields of [{goal:"x".repeat(1001)},{status:"bad"},{startDate:"2027-02-30"},{deadline:"2026-01-01"}]) {
 const candidate=clone(imported);Object.assign(candidate.taskProjects[0],fields);assert.throws(()=>validator.validateImportedStateForImport(candidate));
}
const importedRoundtrip = clone(imported); validator.validateImportedStateForImport(importedRoundtrip);
assert.deepEqual(importedRoundtrip, clone(imported), "import and JSON preserve unknown custom category IDs and workspace definitions");
for (const fields of [{ repeatInterval: 0 }, { repeatWeekdays: [7] }, { excludedDates: ["2027-02-30"] }, { endDate: "2027-01-03" }, { allDay: "true" }, { category: "invalid category" }]) assert.throws(() => validator.validateImportedEvents([event(fields)], "Календарь"));
assert.throws(() => validator.validateImportedCalendarCategories([{ id: "calcat_a", name: "" }], "Календарь"));
assert.throws(() => validator.validateImportedCalendarCategories([{ id: "calcat_a", name: "А", color: "red" }], "Календарь"));
assert.throws(() => validator.validateImportedCalendarCategories([{ id: "calcat_a", name: "А" }, { id: "calcat_a", name: "Б" }], "Календарь"));

async function mutations() {
  let sequence = 0, refuse = false, disk, release, held = false;
  const workspace = { events: [normalize(event({ repeat: "daily", customMetadata: { retained: true } })), event({ id: "neighbor", date: "2027-02-01", endDate: "2027-02-01" })] };
  const controller = model.createCalendarEventController({
    getWorkspace: () => workspace, createId: () => `new_${++sequence}`,
    persistTransaction: operation => operation(async () => {}),
    saveSnapshot: async (_write, candidate) => { if (held) await new Promise(resolve => { release = resolve; }); if (refuse) throw new Error("fixture refused"); disk = clone(candidate); return { saved: true }; }
  });
  let baseline = clone(workspace.events[0]), before = clone(workspace);
  const one = { scope: "one", occurrenceDate: "2027-01-06" };
  refuse = true;
  await assert.rejects(controller.saveEvent(event({ title: "Разовая правка", date: "2027-01-06", endDate: "2027-01-06" }), "series", baseline, one), /refused/);
  assert.deepEqual(clone(workspace), before);
  refuse = false; held = true;
  const pending = controller.saveEvent(event({ title: "Разовая правка", date: "2027-01-06", endDate: "2027-01-06" }), "series", baseline, one);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(clone(workspace), before);
  workspace.events[0].reminderNotifiedOccurrence = "delivered-during-ack";
  workspace.events.push(event({ id: "parallel" }));
  held = false; release(); const detached = await pending;
  assert.notEqual(detached.id, "series"); assert.equal(detached.repeat, "none"); assert.equal(workspace.events[0].reminderNotifiedOccurrence, "delivered-during-ack");
  assert.equal(model.calendarOccurrences(workspace.events.filter(item => item.id !== "parallel"), "2027-01-06", "2027-01-06").length, 1);
  assert.equal(workspace.events.find(item => item.id === "parallel").title, "Встреча");
  assert.equal(disk.find(item => item.id === "series").excludedDates[0], "2027-01-06");
  await assert.rejects(controller.saveEvent(event(), "series", baseline), /другом окне/);
  await assert.rejects(controller.removeEvent("series", { scope: "all" }, baseline), /другом окне/);
  baseline = clone(workspace.events[0]); before = clone(workspace);
  refuse = true; await assert.rejects(controller.removeEvent("series", { scope: "one", occurrenceDate: "2027-01-07" }, baseline), /refused/);
  assert.deepEqual(clone(workspace), before); refuse = false;
  await controller.removeEvent("series", { scope: "one", occurrenceDate: "2027-01-07" }, baseline);
  assert.equal(model.occursOn(workspace.events[0], "2027-01-07"), false);
  baseline = clone(workspace.events[0]);
  const future = await controller.saveEvent(event({ title: "Будущая серия", date: "2027-01-09", endDate: "2027-01-09", repeat: "daily", repeatInterval: 2 }), "series", baseline, { scope: "future", occurrenceDate: "2027-01-09" });
  assert.equal(workspace.events[0].repeatUntil, "2027-01-08"); assert.notEqual(future.id, "series");
  assert.deepEqual(Array.from(model.calendarOccurrences(workspace.events.filter(item => ["series", future.id].includes(item.id)), "2027-01-08", "2027-01-13"), item => [item.id, item.date]), [["series", "2027-01-08"], [future.id, "2027-01-09"], [future.id, "2027-01-11"], [future.id, "2027-01-13"]]);
  await controller.removeEvent(future.id, { scope: "future", occurrenceDate: "2027-01-11" }, clone(workspace.events.find(item => item.id === future.id)));
  assert.deepEqual(Array.from(model.calendarOccurrences(workspace.events.filter(item => item.id === future.id), "2027-01-09", "2027-01-20"), item => item.date), ["2027-01-09"]);
  const neighborBefore = clone(workspace.events.find(item => item.id === "neighbor"));
  await controller.removeEvent("series"); assert.deepEqual(clone(workspace.events.find(item => item.id === "neighbor")), neighborBefore);
  await assert.rejects(controller.saveEvent(event(), "series", baseline), /удалено/);
  await assert.rejects(controller.saveEvent(event({ date: "2026-10-22", endDate: "2026-10-22" })), /прошла/);
  const legacyPast = normalize(event({ id: "past", date: "2020-01-01", endDate: "2020-01-01" })); workspace.events.push(legacyPast);
  assert.equal((await controller.saveEvent({ ...legacyPast, title: "История" }, "past", clone(legacyPast))).id, "past", "past edits retain original ID");
  console.log("calendar planner smoke: ok (recurrence, DST dates, overlaps, lanes, legacy, scoped ACK/failure/retry/stale/neighbor)");
}
async function futureExclusions() {
  let serial=0, refuse=false, disk;
  const original=normalize(event({repeat:"daily",repeatUntil:"2027-01-20",excludedDates:["2027-01-06","2027-01-10"]}));
  const workspace={events:[original,event({id:"neighbor"})]};
  const controller=model.createCalendarEventController({getWorkspace:()=>workspace,createId:()=>`split_${++serial}`,persistTransaction:operation=>operation(async()=>{}),saveSnapshot:async(_write,candidate)=>{if(refuse)throw new Error("refused");disk=clone(candidate);return{saved:true};}});
  const baseline=clone(original), draft={...baseline,date:"2027-01-08",endDate:"2027-01-08",excludedDates:["2027-01-06","2027-01-12"]}, before=clone(workspace);
  refuse=true;await assert.rejects(controller.saveEvent(draft,original.id,baseline,{scope:"future",occurrenceDate:"2027-01-08"}),/refused/);
  assert.deepEqual(clone(workspace),before,"failed future split must keep the old exceptions and neighbor");
  refuse=false;const split=await controller.saveEvent(draft,original.id,baseline,{scope:"future",occurrenceDate:"2027-01-08"});
  assert.deepEqual(clone(split.excludedDates),["2027-01-12"],"future split must keep submitted additions and removals");
  assert.equal(model.occursOn(split,"2027-01-10"),true);assert.equal(model.occursOn(split,"2027-01-12"),false);
  assert.equal(model.occursOn(workspace.events[0],"2027-01-06"),false,"past exceptions remain in the original series");
  assert.deepEqual(clone(workspace.events.find(item=>item.id==="neighbor")),before.events[1]);
  assert.deepEqual(disk,clone(workspace.events));
  console.log("calendar future exclusions smoke: ok (edited exceptions, refusal/retry, past and neighbor preservation)");
}
async function plansAndBindings() {
  let refuse = false, held = false, release, serial = 0, writes = 0, disk;
  const workspace = { events: [], tasks: [{ id: "task_a", title: "Работа", projectId: "project_a" }], taskProjects: [{ id: "project_a", name: "Проект А" }, { id: "project_b", name: "Проект Б" }], timeTracking: { entries: [], active: null } };
  const options = {
    getWorkspace: () => workspace, now: () => now, createId: () => `plan_${++serial}`,
    persistTransaction: operation => operation(async () => {}),
    saveSnapshot: async (_write, candidate) => { writes++; if (held) await new Promise(resolve => { release = resolve; }); if (refuse) return { saved: false }; disk = clone(candidate); return { saved: true }; }
  };
  const controller = model.createCalendarPlanController(options), editor = model.createCalendarEventController(options);
  const draft = { title: "Ночная работа", date: "2027-01-04", endDate: "2027-01-05", start: "23:00", end: "01:30", taskId: "task_a", projectId: "project_a", projectName: "Проект А", description: "Точный текст" };
  const untouched = clone(workspace); refuse = true;
  await assert.rejects(controller.createPlan(draft), /сохран/); assert.deepEqual(clone(workspace), untouched);
  refuse = false; held = true; const pending = controller.createPlan(draft);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(clone(workspace), untouched, "overnight plan remains private until ACK");
  workspace.events.push(event({ id: "parallel_plan" })); held = false; release(); const accepted = await pending;
  assert.equal(accepted.endDate, "2027-01-05"); assert.equal(model.calendarEventDurationMinutes(accepted), 150);
  assert.equal(accepted.taskId, "task_a"); assert.equal(accepted.projectId, "project_a"); assert.equal(accepted.projectName, "Проект А");
  assert.equal(disk[0].description, "Точный текст"); assert.equal(disk[0].taskId, "task_a");
  assert.equal(workspace.events[0].id, "parallel_plan");
  assert.deepEqual(clone(workspace.timeTracking), untouched.timeTracking); assert.deepEqual(clone(workspace.tasks), untouched.tasks);
  assert.deepEqual(clone(workspace.taskProjects), untouched.taskProjects);
  for (const fields of [{ endDate: "" }, { start: "" }, { end: "" }, { allDay: true }, { taskId: "foreign_task" }, { taskId: "task_a", projectId: "project_b" }, { taskId: "", projectId: "foreign_project" }]) {
    const count = writes; await assert.rejects(controller.createPlan({ ...draft, ...fields })); assert.equal(writes, count, "invalid plans/bindings reject before persistence");
  }
  const linked = await editor.saveEvent(event({ taskId: "task_a" }));
  assert.equal(linked.projectId, "project_a"); assert.equal(linked.projectName, "Проект А");
  await assert.rejects(editor.saveEvent({ ...linked, taskId: "foreign_task" }, linked.id, clone(linked)), /Задача/);
  await assert.rejects(editor.saveEvent({ ...linked, projectId: "project_b" }, linked.id, clone(linked)), /проект/);
  workspace.tasks = []; workspace.taskProjects = [];
  const historical = await editor.saveEvent({ ...linked, title: "Сохранённая история" }, linked.id, clone(linked));
  assert.equal(historical.taskId, "task_a"); assert.equal(historical.projectId, "project_a"); assert.equal(historical.projectName, "Проект А", "missing historical bindings survive edits");
  await assert.rejects(editor.saveEvent({ ...draft, title: "Новая чужая связь" }), /Задача/);
  console.log("calendar plan/binding smoke: ok (overnight staged ACK/refusal, workspace task binding, historical refs, untouched tasks/timer)");
}
async function scopeBoundaryRegressions() {
  const failures = [];
  const check = async (name, run) => { try { await run(); } catch (error) { failures.push(new Error(`${name}: ${error.message}`)); } };
  await check("invalid exclusions", () => {
    for (const excludedDates of [["2027-02-30"], ["bad-date"], "2027-01-04", Array.from({ length: 1001 }, (_, index) => model.calendarDateAdd("2027-01-04", index))]) assert.throws(() => model.validateCalendarEventDraft(event({ repeat: "daily", excludedDates })), /исключённ/);
    assert.deepEqual(clone(model.validateCalendarEventDraft(event({ excludedDates: ["2027-01-04", "2027-01-04"] })).excludedDates), ["2027-01-04"]);
  });
  await check("moved future exclusions", async () => {
    const original = normalize(event({ repeat: "daily", repeatUntil: "2027-01-12" }));
    const workspace = { events: [original, event({ id: "neighbor" })] };
    let refuse = true, disk;
    const controller = model.createCalendarEventController({ getWorkspace: () => workspace, createId: () => "moved_future", persistTransaction: run => run(), saveSnapshot: async (_write, candidate) => { if (refuse) throw new Error("refused"); disk = clone(candidate); return { saved: true }; } });
    const before = clone(workspace), draft = { ...clone(original), date: "2027-01-07", endDate: "2027-01-07", excludedDates: ["2027-01-07", "2027-01-10"] }, settings = { scope: "future", occurrenceDate: "2027-01-08" };
    await assert.rejects(controller.saveEvent(draft, "series", before.events[0], settings), /refused/); assert.deepEqual(clone(workspace), before);
    refuse = false;
    const moved = await controller.saveEvent(draft, "series", before.events[0], settings);
    assert.deepEqual(clone(moved.excludedDates), draft.excludedDates);
    assert.equal(model.occursOn(moved, "2027-01-07"), false);
    assert.deepEqual(clone(workspace.events[1]), before.events[1]); assert.deepEqual(disk, clone(workspace.events));
  });
  for (const [name, fields, first] of [
    ["daily first", { repeat: "daily" }, "2027-01-04"],
    ["weekly actual first", { repeat: "weekly", repeatWeekdays: [3] }, "2027-01-06"],
    ["excluded prefix", { repeat: "daily", excludedDates: ["2027-01-04", "2027-01-05"] }, "2027-01-06"]
  ]) for (const operation of ["delete", "edit"]) await check(`${name} ${operation}`, async () => {
    const original = normalize(event(fields)), workspace = { events: [original, event({ id: "neighbor" })] }, before = clone(workspace);
    let refuse = true, disk;
    const controller = model.createCalendarEventController({ getWorkspace: () => workspace, createId: () => "replacement", persistTransaction: run => run(), saveSnapshot: async (_write, candidate) => { if (refuse) throw new Error("refused"); disk = clone(candidate); return { saved: true }; } });
    const settings = { scope: "future", occurrenceDate: first }, draft = { ...clone(original), date: first, endDate: first, title: "Будущая часть" };
    const mutate = () => operation === "delete" ? controller.removeEvent("series", settings, before.events[0]) : controller.saveEvent(draft, "series", before.events[0], settings);
    await assert.rejects(mutate(), /refused/); assert.deepEqual(clone(workspace), before);
    refuse = false; await mutate();
    assert.equal(workspace.events.some(item => item.id === "series"), false, "empty past series must not consume event capacity");
    assert.deepEqual(clone(workspace.events.find(item => item.id === "neighbor")), before.events[1]);
    assert.deepEqual(disk, clone(workspace.events));
    assert.equal(workspace.events.length, operation === "delete" ? 1 : 2);
  });
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("\n"));
  console.log("calendar scope boundaries: ok (moved exclusions, first/prefix delete/edit, refusal/retry, neighbors)");
}
mutations().then(futureExclusions).then(plansAndBindings).then(scopeBoundaryRegressions).catch(error => { console.error(error); process.exitCode = 1; });
