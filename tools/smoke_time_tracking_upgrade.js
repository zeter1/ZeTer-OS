"use strict";
// In-memory VM only. Neither native storage nor a user browser is opened.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const context = { console }; context.window = context; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/time-tracking-utils.js"), "utf8"), context);
const model = context.ZETER_TIME_TRACKING_UTILS, plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  let now = new Date(2026, 9, 15, 15).getTime(), serial = 0, fail = false;
  const workspace = { tasks: [{ id: "task", title: "Задача", projectId: "project" }], taskProjects: [{ id: "project", name: "Проект" }] };
  let chain = Promise.resolve();
  const options = { getWorkspace: () => workspace, now: () => now, createId: () => `entry${++serial}`, runtimeId: "boot1",
    persistTransaction: operation => { const result = chain.catch(() => {}).then(() => operation(async () => ({ saved: !fail }))); chain = result.catch(() => {}); return result; }, saveSnapshot: (write, candidate) => write(candidate) };
  const controller = model.createTimeTrackingController(options);
  await controller.start({ taskId: "task", notes: "Первая строка\nВторая" }); now += 60000; await controller.pause(); now += 300000; await controller.resume(); now += 120000; await controller.finish();
  let entry = controller.read().entries[0]; const segments = JSON.stringify(entry.segments), end = entry.finishedAt;
  await controller.edit(entry.id, { title: "Новое название", notes: "Описание" });
  entry = controller.read().entries[0]; assert.equal(JSON.stringify(entry.segments), segments, "metadata-only edits must preserve every pause"); assert.equal(entry.finishedAt, end);
  assert.equal(entry.notes, "Описание"); assert.equal(model.sessionDuration(entry, now), 180000);
  const stale = plain(entry); await controller.edit(entry.id, { title: "Свежее", expected: stale });
  await assert.rejects(controller.edit(entry.id, { title: "Старое", expected: stale }), /изменена/i);
  const manual = { title: "Забыл таймер", notes: "Вручную", startedAt: now - 3600000, durationMs: 600000, projectId: "project" };
  await controller.addManual(manual); entry = controller.read().entries.at(-1); assert.equal(entry.manual, true); assert.equal(model.sessionDuration(entry), 600000);
  await assert.rejects(controller.addManual(manual), /пересека/i); await controller.addManual({ ...manual, allowOverlap: true });
  await assert.rejects(controller.addManual({ ...manual, startedAt: now, durationMs: 1000 }), failure => /будущ/i.test(failure.message) && /текущее время/i.test(failure.message) && /длительность/i.test(failure.message));
  fail = true; const before = JSON.stringify(controller.read()); await assert.rejects(controller.removeEntry(entry.id), /сохран/i); assert.equal(JSON.stringify(controller.read()), before);
  fail = false; await controller.removeEntry(entry.id);
  assert.equal(controller.read().entries.some(item => item.id === entry.id), false, "accepted deletion removes the active entry");
  await assert.rejects(controller.edit(entry.id, { title: "Нельзя" }), /удален|удалён/i);
  const reloaded = model.normalizeTimeTracking(plain(controller.read())); model.validateTimeTracking(reloaded);
  await assert.rejects(controller.repeat(entry.id), /удален|удалён/i);
  entry = controller.read().entries[0];
  assert.equal(model.isTimeEntryDeleted({ deletedAt: 0 }), true, "timestamp zero is still a deletion marker");
  const corrupt = plain(controller.read()); corrupt.entries[0].deletedAt = "bad"; assert.throws(() => model.validateTimeTracking(corrupt), /удален|удалён/i);
  await controller.repeat(entry.id); assert.equal(controller.read().active.title, entry.title); assert.equal(controller.read().active.segments.length, 0); assert.equal(model.sessionDuration(controller.read().active, now), 0);
  await assert.rejects(controller.repeat(entry.id), /сесси/i);
  const current = controller.read().active; await controller.editActive(current.id, { title: "Текущая", notes: "Новая заметка", expected: current }); assert.equal(controller.read().active.runningSince, current.runningSince);
  now += 10000; const restarted = model.createTimeTrackingController({ ...options, runtimeId: "boot2" });
  await restarted.recover(now - 5000, true); assert.equal(restarted.needsRecovery(), false); assert.equal(restarted.read().active.runningSince, now);
  const activeCorrupt = plain(restarted.read()); activeCorrupt.active.deletedAt = 0; assert.throws(() => model.validateTimeTracking(activeCorrupt), /активн/i);
  await restarted.finish(); await controller.setDailyGoal(120); assert.equal(controller.read().dailyGoalMinutes, 120);
  await assert.rejects(controller.setDailyGoal(1441), /цел/i); await controller.setDailyGoal(0);
  const midnight = +new Date(2026, 9, 15), crossing = { id: "cross", title: "Ночь", projectId: "night", projectName: "Ночной", notes: "Точный поиск", taskId: "", createdAt: midnight - 7200000,
    finishedAt: midnight + 7200000, segments: [{ start: midnight - 7200000, end: midnight - 3600000 }, { start: midnight + 3600000, end: midnight + 7200000 }], runningSince: null };
  const tracking = { entries: [crossing, { ...crossing, id: "deleted", deletedAt: 0 }], active: { ...crossing, id: "active", runningSince: now } };
  const filter = { from: midnight, to: midnight + 86400000, query: "точный", projectId: "night" };
  const rows = model.selectTimeEntries(tracking, filter); assert.equal(rows.length, 1); assert.equal(rows[0].durationMs, 3600000); assert.equal(rows[0].fullDurationMs, 7200000);
  assert.equal(model.selectTimeEntries(tracking, { ...filter, projectId: "wrong" }).length, 0);
  assert.equal(model.selectTimeEntries(tracking, { ...filter, deleted: true })[0].entry.id, "cross", "legacy request cannot reveal tombstones");
  const summary = model.summarizeTimeRows(rows, "projects"); assert.equal(summary.totalMs, 3600000); assert.equal(summary.groups[0].ms, 3600000);
  const report = model.timeReportRows(rows); assert.equal(report.length, 2); assert.equal(report[1][6], 3600); assert.equal(report[1][7], 7200);
  for (const value of ["=1+1", "+1", "-1", "@SUM(1)", "＝1+1", " \t=1+1", "\uFEFF+1", "\u0001@1"]) assert.ok(model.safeTimeReportText(value).startsWith("'"), value);
  assert.equal(model.safeTimeReportText('Текст;"строка"\nещё'), 'Текст;"строка"\nещё');
  const range = model.timeFilterRange("custom", now, "2026-10-14", "2026-10-15"); assert.equal(range.from, +new Date(2026, 9, 14)); assert.equal(range.to, +new Date(2026, 9, 16));
  assert.throws(() => model.timeFilterRange("custom", now, "2026-02-31", "2026-10-15"), /дат/i);
  assert.throws(() => model.timeFilterRange("custom", now, "2026-10-16", "2026-10-15"), /дат/i);
  const days = model.timeWeekBuckets([crossing], now); assert.equal(days.length, 7); assert.equal(days.reduce((sum, item) => sum + item.ms, 0), 7200000);
  console.log("time upgrade smoke: metadata/pause preservation, stale editor, manual/overlap, permanent deletion, repeat/recovery, goal, filtered analytics and safe report rows PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
