"use strict";
// Synthetic state only; no native API or user storage.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const box = { console, Date, structuredClone, setTimeout, clearTimeout, crypto: require("node:crypto").webcrypto };
box.window = box; vm.createContext(box);
for (const file of ["utils.js", "config.js", "time-tracking-utils.js", "project-overview-utils.js", "data-normalizers.js", "task-ui-utils.js", "task-app-ui-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", file), "utf8"), box, { filename: file });
}
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  const data = box.ZETER_DATA_NORMALIZERS, ui = box.ZETER_TASK_UI_UTILS;
  assert.deepEqual(plain(data.normalizeTaskStore({}).taskProjects[0].categories), [], "empty stores get a valid default project");
  const store = { taskProjects: [{ id: "p", name: "Проект", categories: [{ id: "c", name: "Учёба" }] }, { id: "q", name: "Другой" }], tasks: [
    { id: "one", projectId: "p", categoryId: "c", title: "Один" },
    { id: "two", projectId: "p", title: "Два" },
    { id: "foreign", projectId: "q", categoryId: "c", title: "Другой" }
  ] };
  data.normalizeTaskStore(store);
  assert.equal(store.tasks[1].categoryId, "", "legacy tasks remain uncategorized");
  assert.equal(store.tasks[2].categoryId, "", "categories cannot leak across projects");
  assert.deepEqual(plain(ui.filterTasksForBoard(store.tasks.slice(0, 2), { categoryId: "c" })).map(t => t.id), ["one"]);
  assert.deepEqual(plain(ui.filterTasksForBoard(store.tasks.slice(0, 2), { categoryId: "none" })).map(t => t.id), ["two"]);
  assert.equal(data.makeTask({ title: "Новая", projectId: "p", categoryId: "c" }).categoryId, "c");
  assert.equal(box.ZETER_PROJECT_OVERVIEW_UTILS.buildProjectOverview({ project: store.taskProjects[0], tasks: store.tasks, categoryId: "c" }).total, 1);
  const controller = box.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({
    getWorkspace: () => store, persistTransaction: operation => operation(async () => {}),
    saveSnapshot: async (write, candidate) => { if (refuse) throw new Error("refused"); saved = structuredClone(candidate); if (hold) await hold; return { saved: true }; }
  });
  let refuse = true, saved, hold;
  await assert.rejects(controller.createCategory("p", "Работа"), /refused/);
  assert.equal(store.taskProjects[0].categories.length, 1, "failed write must preserve categories");
  refuse = false;
  let release; hold = new Promise(resolve => { release = resolve; });
  const pending = controller.createCategory("p", "Работа");
  assert.equal(store.taskProjects[0].categories.length, 1, "pending write cannot publish live state");
  release(); const category = await pending; hold = null;
  assert.equal(store.taskProjects[0].categories.length, 2);
  assert.equal(saved.taskProjects[0].categories[1].id, category.id);
  await assert.rejects(controller.createCategory("p", " работа "), /существует/);
  await assert.rejects(controller.createCategory("missing", "Имя"), /Проект/);
  assert.equal(store.taskProjects[1].categories.length, 0);
  const roundTrip = data.normalizeTaskStore(JSON.parse(JSON.stringify(store)));
  assert.equal(roundTrip.taskProjects[0].categories[1].id, category.id);
  assert.equal(roundTrip.tasks[0].categoryId, "c");
  console.log("TASK_CATEGORIES_SMOKE_PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
