"use strict";
// Artificial in-memory state only; no application startup, storage, or user profile.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const context = { console, structuredClone, crypto: require("node:crypto").webcrypto };
context.window = context; context.ZETER_TASK_UI_UTILS = {}; vm.createContext(context);
for (const name of ["config", "utils", "data-normalizers", "task-app-ui-utils", "time-tracking-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../app/js/core/${name}.js`), "utf8"), context, { filename: name });
}
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  let rejectSave = false, pending = null, saved = null, writes = 0;
  const workspace = { tasks: [], taskProjects: [{ id: "inbox", name: "Входящие" }], activeTaskProjectId: "inbox" };
  const unrelated = { tasks: [{ id: "other", title: "Другой стол" }] }, otherBefore = JSON.stringify(unrelated);
  const persistTransaction = async operation => operation(async value => { writes++; saved = plain(value); if (pending) await pending; return { saved: !rejectSave }; });
  const creator = context.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({ getWorkspace: () => workspace, persistTransaction,
    saveSnapshot: (write, candidate) => write(candidate) });
  const project = await creator.createProject("  Новый проект  ");
  assert.equal(project.name, "Новый проект"); assert.equal(workspace.taskProjects.length, 2);
  const task = await creator.createTask("  Новая задача  ", project.id);
  assert.equal(task.title, "Новая задача"); assert.equal(task.projectId, project.id); assert.equal(task.status, "todo");
  assert.equal(task.indefinite, true); assert.equal(task.reminderAt, ""); assert.equal(workspace.tasks[0].id, task.id);
  const before = JSON.stringify(workspace); rejectSave = true;
  await assert.rejects(creator.createTask("Не сохранится", project.id), /сохран/i); assert.equal(JSON.stringify(workspace), before);
  rejectSave = false;
  await assert.rejects(creator.createProject(" "), /название/i);
  await assert.rejects(creator.createTask("Нельзя", "missing"), /проект/i);
  let release; pending = new Promise(resolve => { release = resolve; });
  const creation = creator.createTask("Ожидает", project.id);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(JSON.stringify(workspace), before, "pending candidate must stay private");
  await assert.rejects(creator.createProject("Параллельно"), /сохранение/i);
  release(); await creation; pending = null; assert.equal(workspace.tasks.length, 2);
  const entry = (id, deletedAt) => ({ id, title: `Запись ${id}`, taskId: task.id, projectId: project.id, projectName: project.name,
    createdAt: 1000, finishedAt: 2000, segments: [{ start: 1000, end: 2000 }], runningSince: null, ...(deletedAt === undefined ? {} : { deletedAt }) });
  workspace.timeTracking = { entries: [entry("zero", 0), entry("trash", 3000), entry("kept")], active: null, dailyGoalMinutes: 30 };
  const controller = context.ZETER_TIME_TRACKING_UTILS.createTimeTrackingController({ getWorkspace: () => workspace, persistTransaction,
    saveSnapshot: (write, candidate) => write(candidate), createId: () => "unused" });
  const tasksBefore = JSON.stringify([workspace.tasks, workspace.taskProjects]);
  const snapshot = controller.read().entries.filter(context.ZETER_TIME_TRACKING_UTILS.isTimeEntryDeleted);
  const trackingBefore = JSON.stringify(workspace.timeTracking); rejectSave = true;
  await assert.rejects(controller.purgeEntries(snapshot), /сохран/i); assert.equal(JSON.stringify(workspace.timeTracking), trackingBefore); rejectSave = false;
  for (const values of [[], [snapshot[0], snapshot[0]], [entry("missing", 0)], [entry("kept")]]) {
    const previousWrites = writes; await assert.rejects(controller.purgeEntries(values)); assert.equal(writes, previousWrites);
  }
  workspace.timeTracking.entries[1].notes = "Изменено другим окном";
  const previousWrites = writes; await assert.rejects(controller.purgeEntries(snapshot), /измен|недоступ/i); assert.equal(writes, previousWrites);
  assert.equal(workspace.timeTracking.entries.length, 3, "batch must reject atomically");
  delete workspace.timeTracking.entries[1].notes;
  await controller.restoreEntry("trash", 3000); await assert.rejects(controller.purgeEntries(snapshot));
  workspace.timeTracking.entries[1].deletedAt = 3000;
  // Snapshot is detached at call time; a later tombstone is outside the confirmed set.
  const expected = plain(snapshot); let enter;
  const gate = new Promise(resolve => { enter = resolve; });
  const queued = context.ZETER_TIME_TRACKING_UTILS.createTimeTrackingController({ getWorkspace: () => workspace,
    persistTransaction: async operation => { await gate; return persistTransaction(operation); }, saveSnapshot: (write, candidate) => write(candidate) });
  const purge = queued.purgeEntries(expected); expected[0].title = "Changed caller object";
  workspace.timeTracking.entries.push(entry("later", 4000)); enter(); await purge;
  assert.deepEqual(plain(workspace.timeTracking.entries).map(item => item.id), ["kept", "later"]);
  assert.deepEqual(saved.entries.map(item => item.id), ["kept", "later"]);
  assert.equal(JSON.stringify([workspace.tasks, workspace.taskProjects]), tasksBefore); assert.equal(JSON.stringify(unrelated), otherBefore);
  await controller.purgeEntries([controller.read().entries[1]]); assert.equal(workspace.timeTracking.entries.length, 1);
  console.log("time management smoke PASS: canonical creation, save barrier/locks, exact atomic purge, stale/restore guards, zero tombstone, late deletion and workspace isolation");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
