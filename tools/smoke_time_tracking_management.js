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
  const legacy = plain(controller.read().entries.slice(0, 2));
  const trackingBefore = JSON.stringify(workspace.timeTracking); rejectSave = true;
  await assert.rejects(controller.removeEntry("kept"), /сохран/i); assert.equal(JSON.stringify(workspace.timeTracking), trackingBefore); rejectSave = false;
  for (const id of ["missing", "zero", "trash"]) {
    const previousWrites = writes; await assert.rejects(controller.removeEntry(id), /удален|удалён|недоступ/i); assert.equal(writes, previousWrites);
  }
  assert.equal(controller.restoreEntry, undefined); assert.equal(controller.purgeEntries, undefined);
  // Two windows share the real transaction boundary; the candidate stays private until ACK.
  let transaction = Promise.resolve();
  const lockedTransaction = operation => {
    const result = transaction.catch(() => {}).then(() => persistTransaction(operation)); transaction = result.catch(() => {}); return result;
  };
  const createWindow = () => context.ZETER_TIME_TRACKING_UTILS.createTimeTrackingController({ getWorkspace: () => workspace,
    persistTransaction: lockedTransaction, saveSnapshot: (write, candidate) => write(candidate) });
  const first = createWindow(), second = createWindow();
  pending = new Promise(resolve => { release = resolve; });
  const deletion = first.removeEntry("kept");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(workspace.timeTracking), trackingBefore, "deletion must not publish before ACK");
  assert.deepEqual(saved.entries, legacy, "staged candidate removes exactly one active entry");
  const duplicate = assert.rejects(second.removeEntry("kept"), /удален|удалён|недоступ/i);
  const goal = second.setDailyGoal(45);
  release(); await deletion; await duplicate; await goal; pending = null;
  assert.deepEqual(plain(workspace.timeTracking.entries), legacy, "legacy tombstones remain byte-for-byte compatible");
  assert.equal(workspace.timeTracking.dailyGoalMinutes, 45, "next window mutation uses accepted state");
  assert.equal(context.ZETER_TIME_TRACKING_UTILS.selectTimeEntries(workspace.timeTracking).length, 0);
  assert.equal(JSON.stringify([workspace.tasks, workspace.taskProjects]), tasksBefore); assert.equal(JSON.stringify(unrelated), otherBefore);
  console.log("time management smoke PASS: canonical creation, save barrier/locks, permanent active deletion, refusal/retry, duplicate guard and unchanged legacy tombstones");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
