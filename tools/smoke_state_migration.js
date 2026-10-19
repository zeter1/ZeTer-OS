"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE_DIR = path.join(ROOT, "app", "js", "core");
const APP_PATH = path.join(ROOT, "app", "js", "app.js");
const MIGRATION_PATH = path.join(CORE_DIR, "state-migration-utils.js");

const sandbox = {
  console,
  Blob,
  TextDecoder,
  TextEncoder,
  URL,
  atob,
  btoa,
  crypto: require("node:crypto").webcrypto,
  structuredClone,
  setTimeout,
  clearTimeout,
  document: {
    createElement: () => ({
      getContext: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    }),
    querySelector: () => null,
    querySelectorAll: () => []
  }
};
sandbox.window = sandbox;
sandbox.CSS = { escape: value => String(value) };
vm.createContext(sandbox);

function loadCore(name) {
  const filePath = path.join(CORE_DIR, name);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
}

[
  "version.js",
  "config.js",
  "utils.js",
  "system-settings-utils.js",
  "shortcut-utils.js",
  "link-library-utils.js",
  "prompt-library-utils.js", "business-calculations-utils.js", "time-tracking-utils.js",
  "pinning-utils.js",
  "trash-utils.js",
  "asset-utils.js",
  "security-protection-utils.js",
  "visual-utils.js",
  "item-customization-utils.js",
  "data-normalizers.js",
  "window-session-utils.js",
  "automation-utils.js",
  "object-link-utils.js",
  "workspace-utils.js",
  "state-maintenance-utils.js",
  "storage-utils.js"
].forEach(loadCore);

sandbox.ZETER_EXPORT_UTILS = Object.freeze({ tablePageToCSV: () => "" });
loadCore("managed-file-utils.js");
loadCore("table-utils.js");
loadCore("security-utils.js");
loadCore("search-utils.js");
loadCore("app-catalog.js");
loadCore("initial-state-utils.js");

const appDefinitions = {
  folder: { hidden: true },
  editor: {},
  notes: {},
  markdown: {},
  table: { hidden: true },
  tasks: {},
  tasklist: { hidden: true },
  taskedit: { hidden: true },
  calendar: {},
  calendaredit: { hidden: true },
  automations: {},
  shortcutedit: { hidden: true },
  itemsettings: { hidden: true },
  calculator: {},
  photos: {},
  settings: {},
  security: {},
  monitor: {},
  appcenter: { name: "Приложения" },
  help: {},
  search: {}
};

function migrationRuntimeOptions() {
  const pinning = sandbox.ZETER_PINNING_UTILS;
  const trash = sandbox.ZETER_TRASH_UTILS;
  const maintenance = sandbox.ZETER_STATE_MAINTENANCE_UTILS;
  const normalizeStartPinnedState = target => pinning.normalizeStartPinnedState(target);
  const normalizeTaskbarPinnedApps = list => pinning.normalizeTaskbarPinnedApps(list, appDefinitions);
  const pruneReferences = (target, ids, options = {}) => maintenance.pruneTargetReferencesForRemovedItems(target, ids, {
    ...options,
    normalizeTaskbarPinnedApps
  });

  return {
    apps: appDefinitions,
    appCenterName: appDefinitions.appcenter.name,
    normalizeTrashState: target => trash.normalizeTrashState(target, { normalizeStartPinnedState }),
    purgeExpiredTrashItems: (target, options = {}) => trash.purgeExpiredTrashItemsFromTarget(target, {
      ...options,
      expandItemIdsInTarget: maintenance.expandItemIdsInTarget,
      pruneTargetReferencesForRemovedItems: pruneReferences,
      normalizeStartPinnedState
    })
  };
}

function currentAppMigrator() {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const start = source.indexOf("  function migrate(s) {");
  if (start < 0) return null;
  const end = source.indexOf("\n  function ensureSystemAppShortcut", start);
  assert.ok(end > start, "migrate boundary was not found in app.js");
  const functionSource = source.slice(start, end).trim();
  const runtime = migrationRuntimeOptions();

  const bindings = {
    defaultState: () => sandbox.ZETER_INITIAL_STATE_UTILS.defaultState(),
    normalizeVisualSettings: sandbox.ZETER_VISUAL_UTILS.normalizeVisualSettings,
    normalizeTrashRetentionDays: sandbox.ZETER_TRASH_UTILS.normalizeTrashRetentionDays,
    normalizeTaskbarPinnedApps: list => sandbox.ZETER_PINNING_UTILS.normalizeTaskbarPinnedApps(list, appDefinitions),
    normalizeSearchSettings: sandbox.ZETER_SEARCH_UTILS.normalizeSearchSettings,
    normalizeStartPinnedState: sandbox.ZETER_PINNING_UTILS.normalizeStartPinnedState,
    defaultDesktopDescription: sandbox.ZETER_VISUAL_UTILS.defaultDesktopDescription,
    normalizeDesktopRecord: sandbox.ZETER_VISUAL_UTILS.normalizeDesktopRecord,
    removeExplorerAppShortcutsFromState: sandbox.ZETER_STATE_MAINTENANCE_UTILS.removeExplorerAppShortcutsFromState,
    removeWorkspaceDocumentsFoldersFromState: sandbox.ZETER_STATE_MAINTENANCE_UTILS.removeWorkspaceDocumentsFoldersFromState,
    normalizeNotesData: target => sandbox.ZETER_STATE_MAINTENANCE_UTILS.normalizeNotesData(target, { appCenterName: appDefinitions.appcenter.name }),
    normalizeTablesData: sandbox.ZETER_TABLE_UTILS.normalizeTablesData,
    normalizeTaskStore: sandbox.ZETER_DATA_NORMALIZERS.normalizeTaskStore,
    normalizeCalendarStore: sandbox.ZETER_DATA_NORMALIZERS.normalizeCalendarStore,
    normalizeNotificationStore: sandbox.ZETER_DATA_NORMALIZERS.normalizeNotificationStore,
    normalizeTaskListsData: sandbox.ZETER_DATA_NORMALIZERS.normalizeTaskListsData,
    normalizeTrashState: runtime.normalizeTrashState,
    purgeExpiredTrashItemsFromTarget: runtime.purgeExpiredTrashItems,
    normalizeSecurityMeta: sandbox.ZETER_SECURITY_UTILS.normalizeSecurityMeta,
    OS_VERSION_NUMBER: sandbox.ZETER_OS_CONFIG.OS_VERSION_NUMBER,
    OS_VERSION: sandbox.ZETER_OS_CONFIG.OS_VERSION
  };

  sandbox.__migrationBindings = bindings;
  vm.runInContext(`(() => {
    const {
      defaultState, normalizeVisualSettings, normalizeTrashRetentionDays,
      normalizeTaskbarPinnedApps, normalizeSearchSettings, normalizeStartPinnedState,
      defaultDesktopDescription, normalizeDesktopRecord,
      removeExplorerAppShortcutsFromState, removeWorkspaceDocumentsFoldersFromState,
      normalizeNotesData, normalizeTablesData, normalizeTaskStore, normalizeCalendarStore,
      normalizeNotificationStore, normalizeTaskListsData, normalizeTrashState,
      purgeExpiredTrashItemsFromTarget, normalizeSecurityMeta, OS_VERSION_NUMBER, OS_VERSION
    } = window.__migrationBindings;
    ${functionSource}
    window.__currentAppMigrate = migrate;
  })();`, sandbox, { filename: APP_PATH });
  delete sandbox.__migrationBindings;
  return sandbox.__currentAppMigrate;
}

function migratorUnderTest() {
  if (fs.existsSync(MIGRATION_PATH)) {
    loadCore("state-migration-utils.js");
    assert.ok(sandbox.ZETER_STATE_MIGRATION_UTILS, "state migration public global is missing");
    assert.equal(typeof sandbox.ZETER_STATE_MIGRATION_UTILS.migrateState, "function");
    const options = migrationRuntimeOptions();
    return state => sandbox.ZETER_STATE_MIGRATION_UTILS.migrateState(state, options);
  }
  const migrate = currentAppMigrator();
  assert.equal(typeof migrate, "function", "current app.js migrate function is missing");
  return migrate;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const migrate = migratorUnderTest();
const { OS_VERSION, OS_VERSION_NUMBER, TRASH_ROOT, DAY_MS } = sandbox.ZETER_OS_CONFIG;

function smokeInstalledUpdateNotifications() {
  const [major, minor, patch] = OS_VERSION.split(".").map(Number);
  const future = `${major}.${minor}.${patch + 1}`;
  const records = [
    { id: "installed_update", source: `update:${OS_VERSION}`, action: "open-update", read: false },
    { id: "older_update", source: "update:3.99.99", action: "open-update", read: true },
    { id: "old_patch", source: "update:4.0.9", action: "open-update", read: false },
    { id: "future_update", source: `update:${future}`, action: "open-update", read: false },
    { id: "future_minor", source: "update:4.10.0", action: "open-update", read: true },
    { id: "task_reminder", source: "task:task_1", action: "open-task", read: false },
    { id: "update_completed", source: "system", title: "ZeTer OS обновлена", read: true },
    { id: "unknown_update", source: "update:invalid", action: "open-update", read: false },
    { id: "other_action", source: `update:${OS_VERSION}`, action: "other", read: false }
  ];
  const expected = ["future_update", "future_minor", "task_reminder", "update_completed", "unknown_update", "other_action"];
  const input = { fs: {}, settings: {}, currentDesktop: "second", notifications: plain(records), desktops: [
    { id: "desktop", name: "Основной" },
    { id: "second", name: "Второй", data: { notifications: plain(records) } }
  ] };
  const restored = migrate(input);
  for (const desktop of restored.desktops) {
    assert.deepEqual(Array.from(desktop.data.notifications, item => item.id), expected, "boot must remove only installed/older update offers from every desktop");
  }
  assert.deepEqual(Array.from(restored.notifications, item => item.id), expected, "legacy alias must not restore old offers");
  const reloaded = migrate(plain(restored));
  for (const desktop of reloaded.desktops) {
    assert.deepEqual(Array.from(desktop.data.notifications, item => item.id), expected, "save/reload must preserve future and unrelated notifications");
  }
  const imported = sandbox.ZETER_DATA_NORMALIZERS.normalizeNotifications(plain(records));
  assert.deepEqual(Array.from(imported, item => item.id), expected, "import/shared normalization must also remove installed offers");
}
smokeInstalledUpdateNotifications();

const defaults = migrate(sandbox.ZETER_INITIAL_STATE_UTILS.defaultState());
{
  const fixture = { desktops: [{ id: "desktop", name: "Основной" }], fs: {} };
  const installed = [];
  let reset = false;
  const controller = sandbox.ZETER_WORKSPACE_UTILS.createVirtualDesktopController({
    getState: () => fixture, requestName: () => "Новый", createId: () => "new-desktop",
    resetSelection: () => { reset = true; },
    addDesktopShortcut: appId => { assert.ok(reset, "reset scroll/selection before placing new shortcuts"); installed.push(appId); }
  });
  assert.equal(controller.create(), "new-desktop");
  assert.deepEqual(installed, plain(sandbox.ZETER_OS_CONFIG.DEFAULT_DESKTOP_APP_IDS));
  assert.deepEqual(plain(fixture.desktops[1].data.events), []);
  assert.deepEqual(plain(fixture.desktops[1].data.notifications), []);
}
assert.deepEqual(plain(defaults.desktops[0].data.library), { entries: [], categories: [] });
const linkLegacy = migrate({ fs: {}, settings: {}, future: "keep" });
assert.deepEqual(plain(linkLegacy.desktops[0].data.library), { entries: [], categories: [] });
linkLegacy.desktops[0].data.library.entries.push({ id: "site_link", name: "Сайт", target: "https://example.org/", kind: "url", categoryId: "", description: "Текст", favorite: true });
const linkReload = migrate(JSON.parse(JSON.stringify(linkLegacy)));
assert.equal(linkReload.desktops[0].data.library.entries[0].name, "Сайт");
assert.equal(linkReload.future, "keep");
assert.ok(!Object.hasOwn(linkReload, "library"), "library must live only in workspace data");
const globalLegacyLibrary = { entries: [{ id: "legacy_site", name: "Old", target: "https://legacy.example/" }], categories: [] };
const globalLegacyState = migrate({ fs: {}, settings: {}, currentDesktop: "second", desktops: [{ id: "desktop", name: "Основной" }, { id: "second", name: "Второй" }], library: globalLegacyLibrary });
assert.equal(globalLegacyState.desktops[1].data.library.entries[0].id, "legacy_site", "legacy library moves to original active desktop");
assert.equal(globalLegacyState.desktops[0].data.library.entries.length, 0, "legacy must not be cloned to every desktop");
globalLegacyState.currentDesktop = "desktop";
const legacyAgain = migrate(JSON.parse(JSON.stringify(globalLegacyState)));
assert.equal(legacyAgain.desktops[0].data.library.entries.length, 0, "switch/reload cannot re-seed legacy library");
assert.equal(legacyAgain.desktops[1].data.library.entries[0].id, "legacy_site");
const conflictLegacy = migrate({ fs: {}, settings: {}, library: globalLegacyLibrary, desktops: [{ id: "desktop", name: "Основной", data: { library: { entries: [], categories: [{ id: "own_category", name: "Своя" }] } } }] });
assert.equal(conflictLegacy.desktops[0].data.library.categories[0].id, "own_category");
assert.equal(conflictLegacy.legacyLinkLibrary.entries[0].id, "legacy_site", "conflicting old library must remain recoverable");
assert.equal(defaults.version, OS_VERSION_NUMBER);
assert.equal(defaults.osVersion, OS_VERSION);
assert.equal(defaults.currentDesktop, "desktop");
assert.ok(defaults.desktops.some(desktop => desktop.id === "desktop"));
assert.equal(defaults.systemSettings.startup.restoreWindows, true);
assert.equal(defaults.systemSettings.notifications.calendar, true);
assert.equal(defaults.systemSettings.hotkeys.search, "Ctrl+Space");
assert.equal(defaults.desktops[0].data.events.length, defaults.events.length);
assert.equal(defaults.desktops[0].data.tasks.length, defaults.tasks.length);
assert.deepEqual(plain(defaults.desktops[0].data.automations), []);
assert.deepEqual(plain(defaults.desktops[0].data.objectLinks), []);

const legacyAutomationAliases = migrate({
  settings: {},
  fs: {
    note1: { id: "note1", type: "note", name: "План", parent: "desktop" }
  },
  currentDesktop: "desktop",
  desktops: [{
    id: "desktop",
    name: "Основной",
    data: { tasks: [], taskProjects: [], activeTaskProjectId: null }
  }],
  tasks: [],
  events: [{ id: "event1", title: "Встреча", date: "2026-08-31", start: "10:00" }],
  notifications: [],
  automations: [{
    id: "weekly1",
    name: "План недели",
    type: "weekly",
    weekday: 1,
    time: "09:00",
    action: { type: "notify", title: "План", text: "Открыть план" }
  }],
  objectLinks: [{ id: "link1", a: { kind: "fs", id: "note1" }, b: { kind: "event", id: "event1" } }]
});
assert.equal(legacyAutomationAliases.desktops[0].data.automations[0].id, "weekly1");
assert.equal(legacyAutomationAliases.desktops[0].data.objectLinks[0].id, "link1");
assert.equal(legacyAutomationAliases.automations[0].id, "weekly1");
assert.equal(legacyAutomationAliases.objectLinks[0].id, "link1");

const staleLegacyAliases = migrate({
  settings: {},
  fs: {},
  currentDesktop: "desktop",
  desktops: [{
    id: "desktop",
    name: "Основной",
    data: {
      tasks: [],
      taskProjects: [],
      activeTaskProjectId: null,
      events: [],
      notifications: [],
      automations: [],
      objectLinks: []
    }
  }],
  tasks: [{ id: "old-task", title: "Удалённая задача" }],
  events: [{ id: "old-event", title: "Удалённое событие", date: "2026-07-18" }],
  notifications: [{ id: "old-notification", title: "Старое уведомление" }],
  automations: [{ id: "old-automation", type: "weekly", weekday: 1, time: "09:00", action: { type: "notify" } }],
  objectLinks: [{ id: "old-link", a: { kind: "fs", id: "missing-a" }, b: { kind: "fs", id: "missing-b" } }]
});
assert.deepEqual(plain(staleLegacyAliases.tasks), []);
assert.deepEqual(plain(staleLegacyAliases.events), []);
assert.deepEqual(plain(staleLegacyAliases.notifications), []);
assert.deepEqual(plain(staleLegacyAliases.automations), []);
assert.deepEqual(plain(staleLegacyAliases.objectLinks), []);

const sparseLegacy = migrate({
  futurePayload: { preserved: true },
  settings: { volume: 21, futureVisual: "keep" },
  systemSettings: {
    futureSystemField: "keep",
    accessibility: { textScale: 110, futureAccessibility: "keep" },
    hotkeys: { search: "Ctrl+Alt+F", nextDesktop: "broken key" }
  },
  fs: {
    custom_note_1: {
      id: "custom_note_1",
      type: "note",
      name: "Пользовательская заметка",
      content: "Не менять этот текст",
      parent: "desktop",
      pinnedInStart: true,
      createdAt: 123,
      updatedAt: 456,
      futureItemField: "keep"
    }
  },
  taskbarPinnedApps: ["tasks", "unknown-app", "calendar", "tasks"],
  searchSettings: { filters: ["notes", "unknown-filter"] },
  desktops: [{ id: "work", name: "Работа", description: "Мой стол", futureDesktopField: "keep" }],
  currentDesktop: "missing-desktop",
  tasks: [],
  events: [],
  notifications: [],
  actionHistory: Array.from({ length: 25 }, (_, index) => ({ index }))
});
assert.deepEqual(plain(sparseLegacy.futurePayload), { preserved: true });
assert.equal(sparseLegacy.settings.futureVisual, "keep");
assert.equal(sparseLegacy.systemSettings.futureSystemField, "keep");
assert.equal(sparseLegacy.systemSettings.accessibility.futureAccessibility, "keep");
assert.equal(sparseLegacy.systemSettings.accessibility.textScale, 110);
assert.equal(sparseLegacy.systemSettings.hotkeys.search, "Ctrl+Alt+F");
assert.equal(sparseLegacy.systemSettings.hotkeys.nextDesktop, "");
assert.equal(sparseLegacy.fs.custom_note_1.id, "custom_note_1");
assert.equal(sparseLegacy.fs.custom_note_1.content, "Не менять этот текст");
assert.equal(sparseLegacy.fs.custom_note_1.futureItemField, "keep");
assert.equal(sparseLegacy.desktops.find(desktop => desktop.id === "work").futureDesktopField, "keep");
assert.deepEqual(plain(sparseLegacy.taskbarPinnedApps), ["tasks", "calendar"]);
assert.deepEqual(plain(sparseLegacy.searchSettings.filters), ["notes"]);
assert.equal(sparseLegacy.desktops[0].id, "desktop");
assert.equal(sparseLegacy.currentDesktop, "desktop");
assert.equal(sparseLegacy.actionHistory.length, 20);

const repeatable = plain(sparseLegacy);
migrate(repeatable);
const firstPass = JSON.stringify(repeatable);
migrate(repeatable);
assert.equal(JSON.stringify(repeatable), firstPass, "repeated migration must be stable");

const saved = JSON.stringify(repeatable);
const reloaded = migrate(JSON.parse(saved));
assert.equal(JSON.stringify(reloaded), saved, "load -> save -> load must be stable");

const expiredAt = Date.now() - 45 * DAY_MS;
const expiredTrash = migrate({
  settings: { trashRetentionDays: 30 },
  fs: {
    expired_root: { id: "expired_root", type: "folder", name: "Старое", parent: TRASH_ROOT, deletedAt: expiredAt },
    expired_child: { id: "expired_child", type: "text", name: "Вложенное", parent: "expired_root", deletedAt: expiredAt }
  },
  tasks: [],
  events: [],
  notifications: [],
  actionHistory: [{ type: "delete", items: [{ id: "expired_root" }] }]
});
assert.equal(expiredTrash.fs.expired_root, undefined);
assert.equal(expiredTrash.fs.expired_child, undefined);
assert.deepEqual(plain(expiredTrash.actionHistory), []);

async function smokePersistedDeletion() {
  const deleteState = {
    fs: { note: { id: "note", type: "note", name: "Черновик", parent: "desktop" } },
    actionHistory: []
  };
  let deletePrompt = "";
  const deleteController = sandbox.ZETER_TRASH_UTILS.createTrashActionController({
    getState: () => deleteState,
    saveState: async () => ({ saved: true, fallback: false }),
    cloneState: value => structuredClone(value),
    replaceState: restored => {
      Object.keys(deleteState).forEach(key => delete deleteState[key]);
      Object.assign(deleteState, restored);
    },
    confirm: message => {
      deletePrompt = message;
      return true;
    }
  });
  assert.equal(await deleteController.deleteItem("note"), true);
  assert.equal(deleteState.fs.note, undefined);
  assert.match(deletePrompt, /исчезнет из текущего состояния ZeTer OS/);
  assert.match(deletePrompt, /может временно сохраняться для точек восстановления и JSON-автокопий/);
  assert.doesNotMatch(deletePrompt, /из папки data при сохранении/);

  const failedState = {
    fs: { note: { id: "note", type: "note", name: "Важный файл", parent: "desktop" } },
    actionHistory: []
  };
  const notifications = [];
  const failedController = sandbox.ZETER_TRASH_UTILS.createTrashActionController({
    getState: () => failedState,
    saveState: async () => { throw new Error("disk full"); },
    cloneState: value => structuredClone(value),
    replaceState: restored => {
      Object.keys(failedState).forEach(key => delete failedState[key]);
      Object.assign(failedState, restored);
    },
    confirm: () => true,
    toast: (title, detail) => notifications.push({ title, detail })
  });
  assert.equal(await failedController.deleteItem("note"), false);
  assert.equal(failedState.fs.note.name, "Важный файл");
  assert.equal(notifications.at(-1).title, "Удаление не сохранено");
  assert.match(notifications.at(-1).detail, /оставлен на месте/);
}

const categoryWorkspace = sandbox.ZETER_WORKSPACE_UTILS.workspaceDefaults({ automationCategories: [{ id: "screen", name: "Запись экрана" }], automations: [{ id: "rule", type: "startup", categoryId: "screen" }] });
const restoredCategoryWorkspace = sandbox.ZETER_WORKSPACE_UTILS.normalizeWorkspaceData(JSON.parse(JSON.stringify(categoryWorkspace)));
assert.equal(restoredCategoryWorkspace.automationCategories[0].name, "Запись экрана");
assert.equal(restoredCategoryWorkspace.automations[0].categoryId, "screen");
const legacyCategoryState = { desktops: [{ id: "desktop" }, { id: "other" }], automationCategories: [{ id: "legacy", name: "Старая группа" }], fs: {} };
sandbox.ZETER_WORKSPACE_UTILS.ensureDesktopRecords(legacyCategoryState);
assert.equal(legacyCategoryState.desktops[0].data.automationCategories[0].id, "legacy");
assert.equal(legacyCategoryState.desktops[1].data.automationCategories.length, 0, "categories must not leak to another workspace");

async function smokeSelectiveDesktopDeletion() {
  const workspace = sandbox.ZETER_WORKSPACE_UTILS;
  const fixture = () => ({ currentDesktop: "second", marker: "initial", actionHistory: [], fs: {
    mainRoot: { id: "mainRoot", parent: "desktop", type: "folder", name: "Основное", systemRole: "explorerRoot" },
    hiddenRoot: { id: "hiddenRoot", parent: "second", type: "folder", name: "Скрытая структура", hiddenFromDesktop: true, systemRole: "explorerRoot" },
    note: { id: "note", parent: "hiddenRoot", type: "text", name: "Документ", content: "Keep contents" },
    child: { id: "child", parent: "note", type: "text", name: "Вложенное", content: "Keep child" }
  }, desktops: [
    { id: "desktop", name: "Основной", data: workspace.workspaceDefaults({ explorerRootId: "mainRoot", taskProjects: [{ id: "project", name: "Проект" }], library: { entries: [], categories: [{ id: "cat", name: "Категория" }] } }) },
    { id: "second", name: "Второй <img>", data: workspace.workspaceDefaults({ explorerRootId: "hiddenRoot", tasks: [{ id: "task", title: "Сохранить задачу", projectId: "project" }], taskProjects: [{ id: "project", name: "Проект" }], events: [{ id: "event", title: "Удалить событие", date: "2030-01-01" }], library: { categories: [{ id: "cat", name: "Категория" }], entries: [{ id: "link", name: "Путь", target: "C:\\Keep\\file.txt", favorite: true, categoryId: "cat" }] } }) },
    { id: "third", name: "Третий", data: workspace.workspaceDefaults() }
  ] });
  const make = (state, selected, write) => {
    const queue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true, writePrimaryRecord: write || (async () => ({ updatedAt: 1 })) });
    return workspace.createVirtualDesktopController({ getState: () => state,
      requestDeletion: async (model, execute) => { assert.equal(model.groups.find(group => group.id === "files").count, 3); return selected === null ? false : execute(selected); },
      persistTransaction: operation => queue.transaction(operation),
      pruneReferences: (target, ids) => sandbox.ZETER_STATE_MAINTENANCE_UTILS.pruneTargetReferencesForRemovedItems(target, ids),
      saveState: () => queue.queue()
    });
  };
  let state = fixture(), before = JSON.stringify(state), writes = 0;
  assert.equal(await make(state, null, async () => { writes++; }).remove("second"), false);
  assert.equal(JSON.stringify(state), before); assert.equal(writes, 0);
  assert.equal(await make(state, [], async () => { writes++; }).remove("desktop"), false);
  workspace.syncLegacyWorkspaceAliases(state);
  const source = plain(state.desktops[1]), mainBefore = plain(state.desktops[0]);
  const snapshot = workspace.desktopBackupSnapshot(state, "second");
  assert.deepEqual(plain(snapshot.desktop), source);
  assert.deepEqual(Object.keys(snapshot.fs).sort(), ["child", "hiddenRoot", "note"]);
  snapshot.desktop.name = "Detached"; assert.equal(state.desktops[1].name, source.name);
  let persisted;
  await make(state, ["calendar"], async candidate => { persisted = plain(candidate); assert.equal(state.desktops.length, 3); return { updatedAt: 1 }; }).remove("second");
  assert.deepEqual(plain(state.desktops[0]), mainBefore, "primary must never receive archived groups");
  const archive = state.archivedDesktops[0];
  assert.equal(archive.desktop.data.events, undefined);
  assert.deepEqual(plain(archive.desktop.data.library), source.data.library);
  assert.deepEqual(plain(archive.desktop.data.tasks), source.data.tasks);
  assert.deepEqual(plain(archive.desktop.data.taskProjects), source.data.taskProjects);
  assert.equal(archive.fs.note.content, "Keep contents"); assert.equal(archive.fs.hiddenRoot.parent, "second");
  assert.equal(state.fs.note, undefined); assert.equal(persisted.archivedDesktops[0].fs.child.content, "Keep child");
  assert.deepEqual(plain(archive.desktop.data.calculations), source.data.calculations, "archive retains calculations and their order");
  const archivedBefore = JSON.stringify(state.archivedDesktops);
  workspace.syncLegacyWorkspaceAliases(state);
  assert.equal(JSON.stringify(state.archivedDesktops), archivedBefore, "normalization must not truncate inactive archive data");
  state = fixture(); before = JSON.stringify(state);
  await assert.rejects(make(state, ["files", "links"], async () => { throw new Error("refusal"); }).remove("second"), /refusal/);
  assert.equal(JSON.stringify(state), before);
  await make(state, ["files", "links"]).remove("second");
  assert.deepEqual(plain(state.archivedDesktops[0].fs), {});
  assert.equal(state.archivedDesktops[0].desktop.data.library, undefined);
  assert.equal(state.archivedDesktops[0].desktop.data.events[0].id, "event");
  assert.equal(state.desktops[0].data.events.length, 0);
  state = fixture(); state.desktops[0].data.library.entries = [{ id: "duplicate", name: "Other", target: "C:\\Keep\\file.txt" }];
  await make(state, []).remove("second");
  assert.equal(state.desktops[0].data.library.entries[0].name, "Other");
  assert.equal(state.archivedDesktops[0].desktop.data.library.entries[0].name, "Путь", "archives allow same target without merging");
  state = fixture(); await make(state, ["files","tasks","calendar","links","prompts","calculations","automation","notifications"]).remove("second");
  assert.equal(state.archivedDesktops, undefined, "explicit selection of all groups leaves no retained archive");
  state = fixture(); state.desktops[1].data.calculations.selected = [];
  state.desktops[1].data.calculations.inputs.margin.cost = "987";
  await make(state, ["files","tasks","calendar","links","prompts","automation","notifications"]).remove("second");
  assert.equal(state.archivedDesktops?.[0]?.desktop.data.calculations.inputs.margin.cost, "987", "hidden calculations are retained when their deletion group is not selected");
  state = fixture(); await make(state, ["calculations"]).remove("second");
  assert.equal(state.archivedDesktops[0].desktop.data.calculations, undefined);
  assert.equal(state.desktops[0].data.calculations.selected[0], "margin", "deleting calculations affects only the chosen desktop");
  for (const compensationFails of [false, true]) {
    state = fixture(); let count = 0;
    const controller = make(state, [], async snapshot => {
      count++;
      if (count === 1) { state.desktops[1].data.library.entries[0].name = "Changed concurrently"; return { updatedAt: 1 }; }
      assert.equal(snapshot.desktops[1].data.library.entries[0].name, "Changed concurrently", "compensation writes latest live state");
      if (compensationFails) throw new Error("compensation denied");
      return { updatedAt: 2 };
    });
    await assert.rejects(controller.remove("second"), compensationFails ? /состояние в хранилище неизвестно.*compensation denied/ : /актуальные данные записаны/);
    assert.equal(count, 2); assert.equal(state.desktops.length, 3); assert.equal(state.desktops[1].data.library.entries[0].name, "Changed concurrently");
  }
  state = fixture();
  await make(state, [], async () => { state.marker = "independent"; state.currentDesktop = "third"; state.desktops[2].data.library.entries.push({ id: "independent", name: "Третий", target: "https://third.example/" }); return { updatedAt: 1 }; }).remove("second");
  assert.equal(state.marker, "independent"); assert.equal(state.currentDesktop, "third"); assert.equal(state.desktops[1].data.library.entries[0].id, "independent");
  // Use the actual app save adapter: its post-barrier alias normalization must
  // not swallow cleanup of the formerly active desktop.
  state = fixture(); let release, began, clears = 0, restores = 0, writesCount = 0;
  const started = new Promise(resolve => { began = resolve; });
  const queue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true,
    writePrimaryRecord: async () => { if (++writesCount === 1) { began(); await new Promise(resolve => { release = resolve; }); } return { updatedAt: writesCount }; }
  });
  sandbox.state = state;
  sandbox.primaryStateSaveQueue = queue;
  sandbox.syncLegacyWorkspaceAliases = workspace.syncLegacyWorkspaceAliases;
  sandbox.storageStateRuntimeController = sandbox.ZETER_STORAGE_UTILS.createStorageStateRuntimeController({ getState: () => state,
    runtime: { writesAllowed: true }, queuePrimarySave: options => queue.queue(options) });
  const app = fs.readFileSync(APP_PATH, "utf8");
  vm.runInContext(app.slice(app.indexOf("  function saveState(options = {}) {"), app.indexOf("  function storedStateSizeBytes()")), sandbox);
  const active = workspace.createVirtualDesktopController({ getState: () => state,
    requestDeletion: (model, execute) => execute([]), persistTransaction: operation => queue.transaction(operation),
    saveState: () => sandbox.saveState(), clearRuntimeWindows: () => { clears++; }, restoreWindows: () => { restores++; }
  });
  const pending = active.remove("second"); await started;
  const ordinary = sandbox.saveState(); release(); await pending; await ordinary;
  assert.deepEqual([clears, restores], [1, 1], "active runtime must reconcile before deferred alias normalization");
  assert.equal(state.currentDesktop, "desktop");
  console.log("selective desktop deletion: cancel, save refusal/retry, archive, recursive deletion, no primary transfer, concurrent compensation smoke: ok");
}

async function smokeScopedLibraryRollbackWithNormalization() {
  const fixture = { fs: {}, currentDesktop: "second", marker: "before", desktops: [
    { id: "desktop", name: "Основной", data: sandbox.ZETER_WORKSPACE_UTILS.workspaceDefaults() },
    { id: "second", name: "Второй", data: sandbox.ZETER_WORKSPACE_UTILS.workspaceDefaults({ library: {
      entries: [{ id: "persisted_link", name: "Ссылка", target: "https://preserve.example/", favorite: false }], categories: []
    } }) }
  ] };
  sandbox.ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(fixture);
  const before = JSON.stringify(fixture.desktops[1].data.library);
  const mainBefore = JSON.stringify(fixture.desktops[0].data.library);
  let reject = true;
  const controller = sandbox.ZETER_LINK_LIBRARY_UTILS.createLinkLibraryController({
    getWorkspace: () => fixture.desktops[1].data,
    createId: () => "unused",
    saveState: async () => {
      sandbox.ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(fixture);
      fixture.marker = "independent-change";
      if (reject) throw new Error("normalized storage refusal");
      return { saved: true };
    }
  });
  await assert.rejects(controller.toggleFavorite("persisted_link"), /normalized storage refusal/);
  assert.equal(JSON.stringify(fixture.desktops[1].data.library), before, "real save normalizer must not prevent scoped rollback");
  assert.equal(JSON.stringify(fixture.desktops[0].data.library), mainBefore);
  assert.equal(fixture.marker, "independent-change");
  reject = false;
  await controller.toggleFavorite("persisted_link");
  assert.equal(fixture.desktops[1].data.library.entries[0].favorite, true, "retry after normalized refusal must save once");
}

async function smokePromptWorkspacePersistence() {
  const workspace = sandbox.ZETER_WORKSPACE_UTILS, prompts = sandbox.ZETER_PROMPT_LIBRARY_UTILS;
  const text = "\n\n  exact\r\nbody  ";
  const library = { projects: [{ id: "promptproject", name: "Проект" }], categories: [{ id: "promptcat", projectId: "promptproject", name: "Код" }],
    entries: [{ id: "prompt", projectId: "promptproject", categoryId: "promptcat", name: "Название", text, favorite: false }] };
  const fixture = () => ({ fs: {}, currentDesktop: "second", desktops: [
    { id: "desktop", name: "Основной", data: workspace.workspaceDefaults() },
    { id: "second", name: "Второй", data: workspace.workspaceDefaults({ promptLibrary: JSON.parse(JSON.stringify(library)) }) }
  ] });
  const state = fixture(); workspace.syncLegacyWorkspaceAliases(state);
  assert.deepEqual(plain(state.desktops[0].data.promptLibrary), { projects: [], categories: [], entries: [] });
  let reject = true;
  const controller = prompts.createPromptLibraryController({ getWorkspace: () => state.desktops[1].data, createId: kind => `${kind}_new`, saveState: async () => {
    workspace.syncLegacyWorkspaceAliases(state); state.marker = "independent";
    if (reject) throw new Error("normalized prompt refusal"); return { saved: true };
  } });
  const before = JSON.stringify(state.desktops[1].data.promptLibrary);
  await assert.rejects(controller.toggleFavorite("prompt"), /normalized prompt refusal/);
  assert.equal(JSON.stringify(state.desktops[1].data.promptLibrary), before); assert.equal(state.marker, "independent");
  reject = false; await controller.toggleFavorite("prompt");
  assert.equal(state.desktops[1].data.promptLibrary.entries[0].text, text);
  assert.equal(state.desktops[1].data.promptLibrary.entries[0].favorite, true);
  for (const selected of [[], ["prompts"]]) {
    const target = fixture(); workspace.syncLegacyWorkspaceAliases(target);
    const mainBefore = JSON.stringify(target.desktops[0]);
    const queue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => target, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
    const deletion = workspace.createVirtualDesktopController({ getState: () => target, requestDeletion: (model, execute) => {
      assert.equal(model.groups.find(group => group.id === "prompts").count, 3); return execute(selected);
    }, persistTransaction: operation => queue.transaction(operation), saveState: () => queue.queue() });
    const backup = workspace.desktopBackupSnapshot(target, "second");
    assert.equal(backup.desktop.data.promptLibrary.entries[0].text, text);
    await deletion.remove("second");
    assert.equal(JSON.stringify(target.desktops[0]), mainBefore);
    if (selected.length) assert.equal(target.archivedDesktops?.[0]?.desktop.data.promptLibrary, undefined);
    else assert.deepEqual(plain(target.archivedDesktops[0].desktop.data.promptLibrary), library);
  }
  console.log("prompt workspace smoke: ok (normalized refusal/retry, exact text, desktop ZIP snapshot, retained archive/selective removal)");
}

async function smokeTimeTrackingWorkspace() {
  const workspace = sandbox.ZETER_WORKSPACE_UTILS;
  const tracking = { dailyGoalMinutes: 0, entries: [{ id: "time1", title: "Работа", taskId: "oldtask", projectId: "oldproject", projectName: "Старый проект", createdAt: 1000,
    segments: [{ start: 1000, end: 61000 }], runningSince: null, finishedAt: 61000, runtimeId: "oldboot" }], active: null };
  for (const selected of [[], ["timeTracking"]]) {
    const target = { fs: {}, currentDesktop: "desktop", desktops: [
      { id: "desktop", name: "Основной", data: workspace.workspaceDefaults() },
      { id: "second", name: "Второй", data: workspace.workspaceDefaults({ timeTracking: tracking }) }
    ] };
    workspace.syncLegacyWorkspaceAliases(target);
    assert.deepEqual(plain(target.desktops[0].data.timeTracking), { entries: [], active: null, dailyGoalMinutes: 0 });
    const snapshot = workspace.desktopBackupSnapshot(target, "second");
    assert.deepEqual(plain(snapshot.desktop.data.timeTracking), tracking);
    const queue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => target, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
    const deletion = workspace.createVirtualDesktopController({ getState: () => target,
      requestDeletion: (model, execute) => execute(selected), persistTransaction: operation => queue.transaction(operation), saveState: () => queue.queue() });
    await deletion.remove("second");
    if (selected.length) assert.equal(target.archivedDesktops?.[0]?.desktop.data.timeTracking, undefined);
    else assert.deepEqual(plain(target.archivedDesktops[0].desktop.data.timeTracking), tracking);
  }
  const goalOnly = { fs: {}, currentDesktop: "desktop", desktops: [
    { id: "desktop", name: "Основной", data: workspace.workspaceDefaults() },
    { id: "second", name: "Цель", data: workspace.workspaceDefaults({ timeTracking: { entries: [], active: null, dailyGoalMinutes: 90 } }) }
  ] };
  workspace.syncLegacyWorkspaceAliases(goalOnly);
  const deletionModel = workspace.desktopDeletionModel(goalOnly, "second");
  assert.equal(deletionModel.groups.find(group => group.id === "timeTracking").count, 1);
  const goalQueue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => goalOnly, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
  const goalDeletion = workspace.createVirtualDesktopController({ getState: () => goalOnly,
    requestDeletion: (model, execute) => execute(model.groups.map(group => group.id).filter(id => id !== "timeTracking")),
    persistTransaction: operation => goalQueue.transaction(operation), saveState: () => goalQueue.queue() });
  await goalDeletion.remove("second"); assert.equal(goalOnly.archivedDesktops[0].desktop.data.timeTracking.dailyGoalMinutes, 90);
  console.log("time workspace: defaults, normalization, desktop backup, goal-only retention and selective archive PASS");
}

smokeSelectiveDesktopDeletion().then(smokeScopedLibraryRollbackWithNormalization).then(smokePromptWorkspacePersistence).then(smokeTimeTrackingWorkspace).then(smokePersistedDeletion).then(() => {
  console.log(`state migration smoke: ok (${fs.existsSync(MIGRATION_PATH) ? "core" : "app baseline"})`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
