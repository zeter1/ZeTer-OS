"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function runScript(relativePath, sandbox) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  vm.runInContext(source, sandbox, { filename: relativePath });
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  structuredClone,
  window: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
runScript("app/js/core/config.js", sandbox);
runScript("app/js/core/utils.js", sandbox);
runScript("app/js/core/app-center-ui-utils.js", sandbox);

async function testAppCenterRollback() {
  const state = { fs: {} };
  const toasts = [];
  let nextId = 0;
  const controller = sandbox.window.ZETER_APP_CENTER_UI_UTILS.createAppShortcutController({
    getState: () => state,
    getApps: () => ({ notes: { name: "Заметки", icon: "N" } }),
    getRootId: () => "desktop",
    itemInWorkspace: item => item.parent === "desktop",
    addDesktopShortcut: appId => {
      const id = `app-${++nextId}`;
      state.fs[id] = { id, type: "app", appId, parent: "desktop" };
      return id;
    },
    saveState: async () => { throw new Error("disk full"); },
    toast: (...args) => toasts.push(args),
  });

  assert.equal(await controller.install("notes"), false);
  assert.deepEqual(Object.keys(state.fs), []);
  assert.equal(toasts.some(([title]) => title === "Приложение установлено"), false);
  assert.equal(toasts.at(-1)[0], "Приложение не установлено");

  state.fs.existing = { id: "existing", type: "app", appId: "notes", parent: "desktop" };
  assert.equal(await controller.uninstall("notes"), false);
  assert.equal(state.fs.existing.appId, "notes");
  assert.equal(toasts.some(([title]) => title === "Приложение удалено"), false);
  assert.equal(toasts.at(-1)[0], "Приложение не удалено");
}

async function testAppCenterBlocksConcurrentMutation() {
  const state = { fs: {} };
  const toasts = [];
  let nextId = 0;
  let rejectSave = null;
  const controller = sandbox.window.ZETER_APP_CENTER_UI_UTILS.createAppShortcutController({
    getState: () => state,
    getApps: () => ({
      notes: { name: "Заметки", icon: "N" },
      calc: { name: "Калькулятор", icon: "C" },
    }),
    getRootId: () => "desktop",
    itemInWorkspace: item => item.parent === "desktop",
    addDesktopShortcut: appId => {
      const id = `app-${++nextId}`;
      state.fs[id] = { id, type: "app", appId, parent: "desktop" };
      return id;
    },
    saveState: () => new Promise((resolve, reject) => {
      rejectSave = reject;
    }),
    toast: (...args) => toasts.push(args),
  });

  const firstInstall = controller.install("notes");
  assert.equal(await controller.install("calc"), false);
  assert.deepEqual(Object.values(state.fs).map(item => item.appId), ["notes"]);
  assert.equal(toasts.at(-1)[0], "Сохранение выполняется");
  rejectSave(new Error("disk full"));
  assert.equal(await firstInstall, false);
  assert.deepEqual(Object.keys(state.fs), []);
}

function testTaskSnapshotRollbackContract() {
  sandbox.window.ZETER_DATA_NORMALIZERS = {};
  sandbox.window.ZETER_TASK_UI_UTILS = {};
  runScript("app/js/core/task-app-ui-utils.js", sandbox);
  const taskUtils = sandbox.window.ZETER_TASK_APP_UI_UTILS;
  const workspace = {
    tasks: [{ id: "t1", title: "До" }],
    taskProjects: [{ id: "p1", name: "Проект" }],
    activeTaskProjectId: "p1",
  };
  const store = { item: null };
  const snapshot = taskUtils.taskStoreSnapshot(store, () => workspace);
  workspace.tasks[0].title = "После";
  workspace.taskProjects.push({ id: "p2", name: "Лишний" });
  workspace.activeTaskProjectId = "p2";
  taskUtils.restoreTaskStoreSnapshot(store, snapshot, () => workspace);
  assert.equal(workspace.tasks[0].title, "До");
  assert.equal(workspace.taskProjects.length, 1);
  assert.equal(workspace.activeTaskProjectId, "p1");

  const source = fs.readFileSync(path.join(projectRoot, "app/js/core/task-app-ui-utils.js"), "utf8");
  assert.match(source, /const saved = await saveStoreAfterTaskChange\(snapshot\);[\s\S]*?if \(!saved\) return;[\s\S]*?toast\("Задача добавлена"[\s\S]*?closeEditor\(\);/);
  assert.match(source, /const saved = await saveStoreAfterTaskChange\(snapshot\);[\s\S]*?if \(!saved\) return;[\s\S]*?toast\("Задача сохранена"[\s\S]*?closeEditor\(\);/);
}

async function testTaskEditorRetry() {
  runScript("app/js/core/data-normalizers.js", sandbox);
  runScript("app/js/core/task-ui-utils.js", sandbox);
  runScript("app/js/core/task-app-ui-utils.js", sandbox);
  for (const itemId of [undefined, "list"]) {
    const target = { tasks: [{ id: "t1", title: "Before", description: "Old" }], taskProjects: [] };
    const fields = {
      "[data-task-title]": { value: "After", focus() {}, select() {} },
      "[data-task-description]": { value: "New description" }
    };
    const listeners = {};
    const root = { querySelector: selector => fields[selector] || null, addEventListener: (type, callback) => { listeners[type] = callback; } };
    sandbox.document = { querySelector: () => null };
    const toasts = [];
    let saves = 0;
    let closed = 0;
    let persisted = null;
    sandbox.window.ZETER_TASK_APP_UI_UTILS.createTaskEditorApp({ taskId: "t1", itemId }, "editor", {
      document: { createElement: () => root },
      currentWorkspace: () => target,
      storeOptions: { currentWorkspace: () => target, state: { fs: { list: Object.assign(target, { type: "tasklist" }) } } },
      saveState: async () => {
        saves += 1;
        if (saves === 1) throw new Error("disk full");
        persisted = structuredClone(target);
      },
      closeWindow: () => { closed += 1; },
      toast: title => toasts.push(title)
    });
    const clickSave = () => listeners.click({ target: { closest: selector => selector === "[data-save]" } });
    await clickSave();
    assert.equal(target.tasks[0].title, "Before");
    assert.equal(closed, 0);
    assert.equal(toasts.includes("Задача сохранена"), false);
    await clickSave();
    assert.equal(persisted.tasks[0].title, "After", "retry must persist the live task after rollback");
    assert.equal(persisted.tasks[0].description, "New description");
    assert.equal(closed, 1);
    assert.equal(toasts.at(-1), "Задача сохранена");
    target.tasks = [];
    await clickSave();
    assert.equal(saves, 2, "a removed task must not report a successful save");
  }
}

(async () => {
  await testAppCenterRollback();
  await testAppCenterBlocksConcurrentMutation();
  testTaskSnapshotRollbackContract();
  await testTaskEditorRetry();
  console.log("persistence acknowledgement smoke: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
