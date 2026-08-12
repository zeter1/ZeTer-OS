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
  "pinning-utils.js",
  "trash-utils.js",
  "asset-utils.js",
  "security-protection-utils.js",
  "visual-utils.js",
  "item-customization-utils.js",
  "data-normalizers.js",
  "window-session-utils.js",
  "workspace-utils.js",
  "state-maintenance-utils.js"
].forEach(loadCore);

sandbox.ZETER_EXPORT_UTILS = Object.freeze({ tablePageToCSV: () => "" });
loadCore("managed-file-utils.js");
loadCore("table-utils.js");
loadCore("security-utils.js");
loadCore("search-utils.js");
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

const defaults = migrate(sandbox.ZETER_INITIAL_STATE_UTILS.defaultState());
assert.equal(defaults.version, OS_VERSION_NUMBER);
assert.equal(defaults.osVersion, OS_VERSION);
assert.equal(defaults.currentDesktop, "desktop");
assert.ok(defaults.desktops.some(desktop => desktop.id === "desktop"));
assert.equal(defaults.systemSettings.startup.restoreWindows, true);
assert.equal(defaults.systemSettings.notifications.calendar, true);
assert.equal(defaults.systemSettings.hotkeys.search, "Ctrl+Space");
assert.equal(defaults.desktops[0].data.events.length, defaults.events.length);
assert.equal(defaults.desktops[0].data.tasks.length, defaults.tasks.length);

const staleLegacyAliases = migrate({
  settings: {},
  fs: {},
  currentDesktop: "desktop",
  desktops: [{
    id: "desktop",
    name: "Основной",
    data: { tasks: [], taskProjects: [], activeTaskProjectId: null, events: [], notifications: [] }
  }],
  tasks: [{ id: "old-task", title: "Удалённая задача" }],
  events: [{ id: "old-event", title: "Удалённое событие", date: "2026-07-18" }],
  notifications: [{ id: "old-notification", title: "Старое уведомление" }]
});
assert.deepEqual(plain(staleLegacyAliases.tasks), []);
assert.deepEqual(plain(staleLegacyAliases.events), []);
assert.deepEqual(plain(staleLegacyAliases.notifications), []);

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

smokePersistedDeletion().then(() => {
  console.log(`state migration smoke: ok (${fs.existsSync(MIGRATION_PATH) ? "core" : "app baseline"})`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
