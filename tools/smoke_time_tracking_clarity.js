"use strict";
// Only VM objects and injected persistence. No startup, profiles or user files.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const sandbox = { console, structuredClone, crypto: require("node:crypto").webcrypto };
sandbox.window = sandbox; vm.createContext(sandbox);
for (const file of ["config", "utils", "data-normalizers", "calendar-utils", "time-tracking-utils", "time-tracking-ui-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../app/js/core/${file}.js`), "utf8"), sandbox);
}
async function verifyPermanentDeleteUI() {
  const node = () => ({ innerHTML: "", textContent: "", dataset: {}, disabled: false, style: { setProperty() {} },
    classList: { toggle() {}, add() {} }, contains: () => false, setAttribute() {} });
  const nodes = new Map(), events = {}, days = Array.from({ length: 7 }, node);
  const root = { ...node(), scrollTop: 0, isConnected: false,
    querySelector(selector) {
      if (selector.startsWith("[name=") || selector === "dialog") return null;
      if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector);
    },
    querySelectorAll: selector => selector === "[data-time-day]" ? days : [],
    addEventListener: (type, handler) => { events[type] = handler; }
  };
  let accepted = false, fail = false, writes = 0, changed = 0, warning = "", release;
  const now = Date.now(), activeEntry = { id: "live-entry", title: "Синтетическая запись", projectId: "", projectName: "", taskId: "",
    createdAt: now - 120000, finishedAt: now - 60000, segments: [{ start: now - 120000, end: now - 60000 }], runningSince: null };
  const legacy = { ...activeEntry, id: "legacy-entry", deletedAt: 0 };
  const workspace = { timeTracking: { entries: [activeEntry, legacy], active: null, dailyGoalMinutes: 0 } };
  const controller = sandbox.ZETER_TIME_TRACKING_UTILS.createTimeTrackingController({ getWorkspace: () => workspace,
    persistTransaction: operation => operation(async () => { writes++; if (release) await new Promise(resolve => { release.resolve = resolve; }); return { saved: !fail }; }),
    saveSnapshot: (write, candidate) => write(candidate) });
  const doc = { createElement: () => root, activeElement: null, defaultView: { setInterval() {}, clearInterval() {}, confirm: text => { warning = text; return accepted; } } };
  sandbox.ZETER_TIME_TRACKING_UI_UTILS.createTimeTrackingApp({}, { documentRef: doc, controller, getWorkspace: () => workspace, onChange: () => { changed++; } });
  const rows = () => nodes.get("[data-time-results]").innerHTML;
  assert.doesNotMatch(root.innerHTML + rows(), /Корзина|В корзину|data-time-action="(?:trash|restore|purge|journal)"|data-time-purge/);
  assert.doesNotMatch(rows(), /data-time-row="legacy-entry"/);
  const click = () => events.click({ target: { closest: selector => selector === "[data-time-action]" ? { dataset: { timeAction: "delete", timeId: activeEntry.id } } : null } });
  const before = JSON.stringify(workspace);
  click(); await new Promise(resolve => setImmediate(resolve));
  assert.match(warning, /навсегда/); assert.match(warning, /невозможно/); assert.equal(writes, 0); assert.equal(JSON.stringify(workspace), before);
  accepted = true; fail = true; click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(workspace), before); assert.equal(changed, 0); assert.match(rows(), /data-time-row="live-entry"/); assert.match(rows(), /Не удалось удалить/);
  fail = false; release = {}; click(); await new Promise(resolve => setImmediate(resolve));
  root.refreshTimeTracking(); // A refresh during pending persistence must preserve the pending card.
  assert.equal(JSON.stringify(workspace), before); assert.match(rows(), /aria-busy="true"/); assert.equal(changed, 0);
  release.resolve(); release = null; await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(workspace.timeTracking.entries)), [legacy]); assert.equal(changed, 1);
  assert.doesNotMatch(rows(), /data-time-row="live-entry"|data-time-row="legacy-entry"/);
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
  assert.equal(transfer.end, "01:30", "cross-midnight transfer preserves the planned end clock");
  assert.equal(transfer.endDate, "2026-10-24", "cross-midnight transfer preserves the planned end date");
  assert.equal(transfer.taskId, "a"); assert.equal(transfer.projectId, "p"); assert.equal(transfer.projectName, "Сайт");
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
  await verifyPermanentDeleteUI();
  console.log("time clarity smoke PASS: permanent-delete UI native confirmation/cancel/refusal/retry/ACK, project-scoped tasks, future calendar plan isolation, date/time validation, private pending save, refusal/retry, concurrent edit preservation, ID collision and missing workspace");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
