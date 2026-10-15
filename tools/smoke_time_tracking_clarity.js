"use strict";
// Only VM objects and injected persistence. No startup, profiles or user files.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const sandbox = { console, structuredClone, crypto: require("node:crypto").webcrypto };
sandbox.window = sandbox; vm.createContext(sandbox);
for (const file of ["config", "utils", "data-normalizers", "calendar-utils", "time-tracking-utils", "time-tracking-ui-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../app/js/core/${file}.js`), "utf8"), sandbox);
}
async function main() {
  const ui = sandbox.ZETER_TIME_TRACKING_UI_UTILS;
  const workspace = { tasks: [{ id: "a", projectId: "p", title: "Главная" }, { id: "b", projectId: "q", title: "Меню" }],
    taskProjects: [{ id: "p", name: "Сайт" }, { id: "q", name: "Приложение" }], events: [], timeTracking: { entries: [], active: null, dailyGoalMinutes: 0 } };
  assert.deepEqual(JSON.parse(JSON.stringify(ui.timeTaskChoices(workspace, "p"))).map(item => item.id), ["a"]);
  assert.equal(ui.timeTaskChoices(workspace, "").length, 0);
  const start = +new Date(2026, 9, 14, 23), midnight = +new Date(2026, 9, 15), end = midnight + 3600000;
  const pausedEntry = { createdAt: start, finishedAt: end, runningSince: null, segments: [{ start, end: start + 1800000 }, { start: midnight + 1800000, end }] };
  const timing = ui.timeEntryTiming(pausedEntry);
  assert.equal(timing.workMs, 3600000); assert.equal(timing.pauseMs, 3600000);
  assert.equal(timing.dateText, "14.10.2026 — 15.10.2026"); assert.equal(timing.periodText, "23:00:00 — 01:00:00");
  assert.equal(ui.timeEntryTiming({ ...pausedEntry, createdAt: midnight + 1800000, segments: [{ start: midnight + 1800000, end }] }).pauseMs, 0);
  const transfer = ui.timePlanDraft({ taskId: "a", notes: "Точный ввод", startedAt: +new Date(2026, 9, 23, 23, 30), durationMs: 7200000 }, workspace);
  assert.equal(transfer.end, "", "cross-midnight transfer must not silently truncate a planned session");
  assert.equal(transfer.sourceEnd, "2026-10-24T01:30:00"); assert.match(transfer.description, /Проект: Сайт\nЗадача: Главная\nТочный ввод/);
  let fail = false, release = null, writes = 0, saved;
  const now = +new Date(2026, 9, 15, 12), untouched = JSON.stringify(workspace.timeTracking);
  const options = { getWorkspace: () => workspace, now: () => now, createId: () => "plan1",
    persistTransaction: operation => operation(async value => { writes++; saved = structuredClone(value); if (release) await release; return { saved: !fail }; }),
    saveSnapshot: (write, events) => write(events) };
  const controller = sandbox.ZETER_CALENDAR_UTILS.createCalendarPlanController(options);
  const draft = { title: "Вёрстка", date: "2026-10-23", start: "08:30", end: "09:30", description: "Проект: Сайт", reminder: "0" };
  const before = JSON.stringify(workspace); fail = true;
  await assert.rejects(controller.createPlan(draft), /сохран/i); assert.equal(JSON.stringify(workspace), before); fail = false;
  for (const invalid of [{ ...draft, date: "2026-10-14" }, { ...draft, date: "2026-02-31" }, { ...draft, end: "08:00" }, { ...draft, start: "25:00" }, { ...draft, title: " " }]) {
    const count = writes; await assert.rejects(controller.createPlan(invalid)); assert.equal(writes, count);
  }
  let finish; release = new Promise(resolve => { finish = resolve; });
  const pending = controller.createPlan(draft); await new Promise(resolve => setImmediate(resolve));
  assert.equal(workspace.events.length, 0, "plan is private until saved:true");
  workspace.events.push({ id: "concurrent", title: "Другое изменение календаря" });
  finish(); const plan = await pending; release = null;
  assert.equal(plan.id, "plan1"); assert.equal(plan.repeat, "none"); assert.equal(plan.category, "work"); assert.equal(plan.reminder, "0");
  assert.equal(workspace.events[1].date, "2026-10-23"); assert.equal(saved[0].title, "Вёрстка");
  assert.equal(workspace.events[0].id, "concurrent", "append accepted plan without replacing concurrent calendar edits");
  assert.equal(JSON.stringify(workspace.timeTracking), untouched, "a future plan must never enter actual time or totals");
  const previousWrites = writes; await assert.rejects(controller.createPlan(draft), /ID/i); assert.equal(writes, previousWrites);
  let enter; const gate = new Promise(resolve => { enter = resolve; }); let available = workspace;
  const disappearing = sandbox.ZETER_CALENDAR_UTILS.createCalendarPlanController({ ...options, getWorkspace: () => available, persistTransaction: async operation => { await gate; return options.persistTransaction(operation); } });
  const disappearingSave = disappearing.createPlan(draft); available = null; enter(); await assert.rejects(disappearingSave, /стол/i);
  console.log("time clarity smoke PASS: project-scoped tasks, future calendar plan isolation, date/time validation, private pending save, refusal/retry, concurrent edit preservation, ID collision and missing workspace");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
