"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("app/js/core/storage-utils.js", "utf8");
const appSource = fs.readFileSync("app/js/app.js", "utf8");
const context = vm.createContext({ window: {}, console, Date, JSON, Promise, TextEncoder, globalThis: null });
context.globalThis = context;
vm.runInContext(source, context, { filename: "app/js/core/storage-utils.js" });
const storage = context.window.ZETER_STORAGE_UTILS;
assert.match(appSource, /writesAllowed:\s*\(\)\s*=>\s*storageRuntime\.writesAllowed/, "app save queue must use the storage write gate");
assert.match(appSource, /showStorageRecovery[\s\S]*onRetry:\s*loadStorageAndInitialize/, "native boot failure must expose a retry that rereads storage");
assert.match(appSource, /open_logs_folder[\s\S]*close_app/, "native recovery must expose logs and safe close actions");

async function smokePrimaryRecords() {
  const runtime = storage.createStorageRuntimeState();
  assert.strictEqual(runtime.mode, "Папка data");
  assert.strictEqual(runtime.ready, false);
  assert.strictEqual(runtime.loadStatus, "pending");
  assert.strictEqual(runtime.writesAllowed, false);

  const browserState = { value: 1 };
  let browserWrite = null;
  const browserRecord = await storage.writePrimaryStateRecord(browserState, {
    id: "primary",
    osVersion: "3.55",
    versionNumber: 3.55,
    byteSize: value => String(value).length,
    putIndexedDbRecord: async (dbName, storeName, record, options) => {
      browserWrite = { dbName, storeName, record, options };
    },
    dbName: "db",
    storeName: "store"
  });
  assert.strictEqual(browserRecord.storageMode, "indexeddb-primary");
  assert.strictEqual(browserWrite.record, browserRecord);
  assert.strictEqual(browserWrite.options.keyPath, "id");
  assert.strictEqual(browserRecord.state, browserState);

  const browserRead = await storage.readPrimaryStateRecord({
    dbName: "db",
    storeName: "store",
    id: "primary",
    readIndexedDbRecord: async (dbName, storeName, id, options) => ({ dbName, storeName, id, options })
  });
  assert.strictEqual(browserRead.id, "primary");
  assert.strictEqual(browserRead.options.keyPath, "id");

  const nativeCalls = [];
  const nativeRecord = await storage.writePrimaryStateRecord({ native: true }, {
    nativeStorage: true,
    id: "primary",
    osVersion: "3.55",
    versionNumber: 3.55,
    byteSize: value => String(value).length,
    nativeStorageCall: async (method, record) => {
      nativeCalls.push([method, record]);
      return { updatedAt: 42, stateBytes: 84 };
    }
  });
  assert.strictEqual(nativeCalls[0][0], "save_state");
  assert.strictEqual(nativeRecord.storageMode, "python-data-folder");
  assert.strictEqual(nativeRecord.updatedAt, 42);
  assert.strictEqual(nativeRecord.stateBytes, 84);

  const nativeRead = await storage.readPrimaryStateRecord({
    nativeStorage: () => true,
    nativeStorageCall: async method => ({ ok: true, record: { method, state: { ok: true } } }),
    normalizeNativeStateRecord: value => ({ ...value.record, normalized: true })
  });
  assert.strictEqual(nativeRead.method, "load_state");
  assert.strictEqual(nativeRead.normalized, true);
  const nativeMissing = await storage.readPrimaryStateRecord({
    nativeStorage: true,
    nativeStorageCall: async () => ({ ok: true, record: null })
  });
  assert.strictEqual(nativeMissing, null);
  await assert.rejects(storage.readPrimaryStateRecord({
    nativeStorage: true,
    nativeStorageCall: async () => undefined
  }), /некорректный результат чтения/);
  console.log("storage primary record smoke: ok");
}

function smokeLocalStoragePaths() {
  class FakeStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }

  const fake = new FakeStorage();
  const runtime = storage.createStorageRuntimeState();
  const target = { firstRunCompleted: true, desktops: [], settings: {} };
  assert.strictEqual(storage.writeSmallSettingsToLocalStorage(target, {
    storage: fake,
    smallSettingsKey: "small",
    runtime,
    byteSize: value => String(value).length,
    buildSnapshot: value => ({ fullState: false, firstRunCompleted: value.firstRunCompleted })
  }), true);
  assert.strictEqual(JSON.parse(fake.getItem("small")).fullState, false);
  assert.ok(runtime.localSettingsBytes > 0);

  fake.setItem("state", JSON.stringify({ currentDesktop: "desk2" }));
  assert.strictEqual(storage.readLegacyLocalStorageState({ storage: fake, storageKey: "state" }).currentDesktop, "desk2");
  fake.setItem("state", JSON.stringify({ fullState: false }));
  assert.strictEqual(storage.readLegacyLocalStorageState({ storage: fake, storageKey: "state" }), null);

  const fallbackState = { fs: { one: { id: "one" } } };
  assert.strictEqual(storage.saveFullStateToLocalStorageFallback(fallbackState, {
    storage: fake,
    storageKey: "state",
    runtime,
    byteSize: value => String(value).length
  }), true);
  assert.strictEqual(runtime.mode, "localStorage fallback");
  assert.strictEqual(runtime.fallback, true);
  assert.strictEqual(JSON.parse(fake.getItem("state")).fs.one.id, "one");
  assert.strictEqual(storage.removeLegacyFullStateFromLocalStorage({ storage: fake, storageKey: "state" }), true);
  assert.strictEqual(fake.getItem("state"), null);

  let toastCount = 0;
  const broken = { setItem() { throw new Error("quota"); } };
  assert.strictEqual(storage.saveFullStateToLocalStorageFallback({}, {
    storage: broken,
    storageKey: "state",
    runtime,
    toast: () => { toastCount++; }
  }), false);
  assert.strictEqual(runtime.lastError, "quota");
  assert.strictEqual(toastCount, 1);
  assert.strictEqual(storage.saveFullStateToLocalStorageFallback({}, {
    storage: broken,
    storageKey: "state",
    runtime,
    silentStorageError: true,
    toast: () => { toastCount++; }
  }), false);
  assert.strictEqual(toastCount, 1);
  console.log("storage local snapshot and fallback smoke: ok");
}

async function smokePrimarySaveQueue() {
  let state = { revision: 1 };
  const writes = [];
  const runtime = storage.createStorageRuntimeState();
  let legacyRemovals = 0;
  let storageChecks = 0;
  const queue = storage.createPrimaryStateSaveQueue({
    getState: () => state,
    cloneState: value => JSON.parse(JSON.stringify(value)),
    writePrimaryRecord: async snapshot => {
      writes.push(snapshot.revision);
      return { updatedAt: snapshot.revision * 10, stateBytes: snapshot.revision * 100 };
    },
    removeLegacyState: () => { legacyRemovals++; },
    runtime,
    byteSize: value => String(value).length,
    scheduleStorageCheck: () => { storageChecks++; }
  });

  const first = queue.queue();
  state = { revision: 2 };
  const second = queue.queue();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(firstResult.saved, true);
  assert.strictEqual(firstResult.fallback, false);
  assert.strictEqual(secondResult.saved, true);
  assert.deepStrictEqual(writes, [1, 2]);
  assert.strictEqual(legacyRemovals, 2);
  assert.strictEqual(storageChecks, 2);
  assert.strictEqual(runtime.mode, "IndexedDB");
  assert.strictEqual(runtime.lastSavedAt, 20);
  assert.strictEqual(runtime.stateBytes, 200);

  let gateOpen = false;
  let gatedWrites = 0;
  const gatedRuntime = storage.createStorageRuntimeState();
  const gatedQueue = storage.createPrimaryStateSaveQueue({
    getState: () => ({ guarded: true }),
    writePrimaryRecord: async () => {
      gatedWrites++;
      return { updatedAt: 1, stateBytes: 1 };
    },
    writesAllowed: () => gateOpen,
    runtime: gatedRuntime
  });
  const blocked = await gatedQueue.queue();
  assert.strictEqual(blocked.skipped, true);
  assert.strictEqual(blocked.reason, "storage-not-loaded");
  assert.strictEqual(gatedWrites, 0);
  gateOpen = true;
  await gatedQueue.queue();
  assert.strictEqual(gatedWrites, 1);

  const fallbackSnapshots = [];
  const toasts = [];
  const failedRuntime = storage.createStorageRuntimeState();
  const failedQueue = storage.createPrimaryStateSaveQueue({
    getState: () => ({ failed: true }),
    writePrimaryRecord: async () => { throw new Error("offline"); },
    saveFallback: snapshot => {
      fallbackSnapshots.push(snapshot);
      return true;
    },
    runtime: failedRuntime,
    byteSize: value => String(value).length,
    toast: (...args) => toasts.push(args)
  });
  const fallbackResult = await failedQueue.queue();
  assert.strictEqual(fallbackResult.saved, true);
  assert.strictEqual(fallbackResult.fallback, true);
  assert.strictEqual(failedRuntime.lastError, "offline");
  assert.ok(failedRuntime.lastSavedAt > 0);
  assert.strictEqual(fallbackSnapshots.length, 1);
  assert.strictEqual(toasts[0][0], "IndexedDB недоступен");

  const unavailableRuntime = storage.createStorageRuntimeState();
  const unavailableQueue = storage.createPrimaryStateSaveQueue({
    getState: () => ({ failed: "both" }),
    writePrimaryRecord: async () => { throw new Error("indexeddb offline"); },
    saveFallback: () => false,
    runtime: unavailableRuntime,
    toast: (...args) => toasts.push(args)
  });
  await assert.rejects(unavailableQueue.queue(), /Основное хранилище: indexeddb offline/);
  assert.strictEqual(unavailableRuntime.lastSavedAt, 0);
  assert.match(unavailableRuntime.lastError, /резервное хранилище/);
  assert.strictEqual(toasts.at(-1)[0], "Данные не сохранены");

  let nativeUnavailable = true;
  let nativeFallbackCalls = 0;
  const nativeRuntime = storage.createStorageRuntimeState();
  const nativeQueue = storage.createPrimaryStateSaveQueue({
    getState: () => ({ native: true }),
    nativeStorage: () => true,
    writePrimaryRecord: async () => {
      if (nativeUnavailable) throw new Error("disk full");
      return { updatedAt: 99, stateBytes: 7 };
    },
    saveFallback: () => {
      nativeFallbackCalls++;
      return true;
    },
    runtime: nativeRuntime
  });
  await assert.rejects(nativeQueue.queue(), /disk full/);
  assert.strictEqual(nativeRuntime.lastSavedAt, 0);
  assert.strictEqual(nativeFallbackCalls, 0);
  nativeUnavailable = false;
  const recoveredResult = await nativeQueue.queue();
  assert.strictEqual(recoveredResult.saved, true);
  assert.strictEqual(nativeRuntime.lastSavedAt, 99);
  console.log("storage serialized save queue smoke: ok");
}

async function smokeStorageStateRuntime() {
  let state = { source: "initial" };
  const runtime = storage.createStorageRuntimeState();
  const queued = [];
  let smallWrites = 0;
  let externalSchedules = 0;
  let storageChecks = 0;
  const controller = storage.createStorageStateRuntimeController({
    getState: () => state,
    setState: value => { state = value; },
    runtime,
    readPrimaryRecord: async () => null,
    readLegacyState: () => ({ source: "legacy" }),
    migrateState: value => ({ ...value, migrated: true }),
    defaultState: () => ({ source: "default" }),
    queuePrimarySave: options => { queued.push(options); return Promise.resolve(); },
    writeSmallSettings: () => { smallWrites++; },
    scheduleExternalBackup: () => { externalSchedules++; },
    scheduleStorageCheck: () => { storageChecks++; },
    byteSize: value => String(value).length
  });

  const loaded = await controller.loadState();
  assert.strictEqual(loaded.source, "legacy");
  assert.strictEqual(loaded.migrated, true);
  assert.strictEqual(state, loaded);
  assert.strictEqual(runtime.mode, "migration from localStorage");
  assert.strictEqual(runtime.loadStatus, "loaded");
  assert.strictEqual(runtime.writesAllowed, true);
  assert.strictEqual(queued[0].silentStorageError, true);

  await controller.saveState();
  assert.strictEqual(smallWrites, 1);
  assert.strictEqual(externalSchedules, 1);
  assert.strictEqual(storageChecks, 1);
  runtime.stateBytes = 321;
  assert.strictEqual(controller.storedStateSizeBytes(), 321);

  const loadedRuntime = storage.createStorageRuntimeState();
  const loadedController = storage.createStorageStateRuntimeController({
    getState: () => state,
    runtime: loadedRuntime,
    readPrimaryRecord: async () => ({ state: { source: "primary" }, updatedAt: 77, stateBytes: 88 }),
    migrateState: value => ({ ...value, migrated: true })
  });
  const primary = await loadedController.loadState();
  assert.strictEqual(primary.source, "primary");
  assert.strictEqual(loadedRuntime.mode, "IndexedDB");
  assert.strictEqual(loadedRuntime.ready, true);
  assert.strictEqual(loadedRuntime.loadStatus, "loaded");
  assert.strictEqual(loadedRuntime.writesAllowed, true);
  assert.strictEqual(loadedRuntime.lastSavedAt, 77);
  assert.strictEqual(loadedRuntime.stateBytes, 88);

  const failedInitialRuntime = storage.createStorageRuntimeState();
  const initialWarnings = [];
  const failedInitialController = storage.createStorageStateRuntimeController({
    runtime: failedInitialRuntime,
    readPrimaryRecord: async () => null,
    readLegacyState: () => null,
    defaultState: () => ({ source: "first-run" }),
    queuePrimarySave: async () => { throw new Error("initial write failed"); },
    warn: (...args) => initialWarnings.push(args)
  });
  await failedInitialController.loadState();
  await Promise.resolve();
  assert.strictEqual(failedInitialRuntime.lastError, "initial write failed");
  assert.strictEqual(initialWarnings[0][0], "[ZeTer OS initial primary state save]");
  console.log("storage load save and size runtime smoke: ok");
}

async function smokeStorageBootLifecycle() {
  let state = null;
  let waitCount = 0;
  let smallWrites = 0;
  let storageChecks = 0;
  const controller = storage.createStorageStateRuntimeController({
    getState: () => state,
    setState: value => { state = value; },
    nativeStorage: true,
    waitForNativeStorage: async () => { waitCount++; },
    readPrimaryRecord: async () => ({ state: { source: "native" } }),
    migrateState: value => ({ ...value, migrated: true }),
    writeSmallSettings: () => { smallWrites++; },
    scheduleStorageCheck: () => { storageChecks++; }
  });
  const loaded = await controller.loadStateForBoot();
  assert.strictEqual(waitCount, 1);
  assert.strictEqual(loaded.source, "native");
  assert.strictEqual(state, loaded);
  assert.strictEqual(smallWrites, 1);
  assert.strictEqual(storageChecks, 1);

  let firstRunState = null;
  let firstRunQueued = 0;
  const firstRunRuntime = storage.createStorageRuntimeState();
  const firstRun = storage.createStorageStateRuntimeController({
    setState: value => { firstRunState = value; },
    runtime: firstRunRuntime,
    nativeStorage: true,
    readPrimaryRecord: async () => null,
    defaultState: () => ({ source: "default" }),
    migrateState: value => ({ ...value, migrated: true }),
    queuePrimarySave: () => { firstRunQueued++; return Promise.resolve(); }
  });
  const created = await firstRun.loadStateForBoot();
  assert.strictEqual(created.source, "default");
  assert.strictEqual(firstRunState, created);
  assert.strictEqual(firstRunRuntime.loadStatus, "first-run");
  assert.strictEqual(firstRunRuntime.writesAllowed, true);
  assert.strictEqual(firstRunQueued, 1);

  let failedState = { source: "existing-runtime-state" };
  let readAttempts = 0;
  let failedQueued = 0;
  let failedSmallWrites = 0;
  let failedStorageChecks = 0;
  let failedProtectionChecks = 0;
  let nativeWarning = "";
  const failedRuntime = storage.createStorageRuntimeState();
  let bootError = "";
  const failed = storage.createStorageStateRuntimeController({
    getState: () => failedState,
    setState: value => { failedState = value; },
    runtime: failedRuntime,
    nativeStorage: true,
    readPrimaryRecord: async () => {
      readAttempts++;
      if (readAttempts === 1) throw new Error("access denied");
      return { state: { source: "recovered-native" } };
    },
    defaultState: () => ({ source: "default" }),
    migrateState: value => ({ ...value, migrated: true }),
    queuePrimarySave: () => { failedQueued++; return Promise.resolve(); },
    writeSmallSettings: () => { failedSmallWrites++; },
    scheduleStorageCheck: () => { failedStorageChecks++; },
    scheduleProtectionCheck: () => { failedProtectionChecks++; },
    warn: (label, error) => { nativeWarning = `${label}: ${error.message}`; },
    logBootError: (label, error) => { bootError = `${label}: ${error.message}`; }
  });
  await assert.rejects(failed.loadStateForBoot(), /access denied/);
  assert.strictEqual(failedState.source, "existing-runtime-state", "native read failure replaced the working state");
  assert.strictEqual(failedRuntime.ready, false);
  assert.strictEqual(failedRuntime.loadStatus, "error");
  assert.strictEqual(failedRuntime.writesAllowed, false);
  assert.strictEqual(failedRuntime.lastError, "access denied");
  assert.match(nativeWarning, /native storage load.*access denied/);
  assert.match(bootError, /boot storage.*access denied/);
  const blockedSave = await failed.saveState();
  assert.strictEqual(blockedSave.skipped, true);
  assert.strictEqual(blockedSave.reason, "storage-not-loaded");
  assert.strictEqual(failedQueued, 0);
  assert.strictEqual(failedSmallWrites, 0);
  assert.strictEqual(failedStorageChecks, 0);
  assert.strictEqual(failedProtectionChecks, 0);

  const recovered = await failed.loadStateForBoot();
  assert.strictEqual(recovered.source, "recovered-native");
  assert.strictEqual(failedState, recovered);
  assert.strictEqual(failedRuntime.loadStatus, "loaded");
  assert.strictEqual(failedRuntime.writesAllowed, true);
  await failed.saveState();
  assert.strictEqual(failedQueued, 1);
  assert.strictEqual(failedSmallWrites, 2);
  assert.strictEqual(failedStorageChecks, 2);
  assert.strictEqual(failedProtectionChecks, 2);

  let corruptState = { source: "preserve-me" };
  let corruptQueued = 0;
  const corruptRuntime = storage.createStorageRuntimeState();
  const corrupt = storage.createStorageStateRuntimeController({
    setState: value => { corruptState = value; },
    runtime: corruptRuntime,
    nativeStorage: true,
    readPrimaryRecord: async () => { throw new SyntaxError("damaged JSON"); },
    defaultState: () => ({ source: "default" }),
    migrateState: value => ({ ...value, migrated: true }),
    queuePrimarySave: () => { corruptQueued++; return Promise.resolve(); }
  });
  await assert.rejects(corrupt.loadStateForBoot(), /damaged JSON/);
  await corrupt.saveState();
  assert.strictEqual(corruptState.source, "preserve-me");
  assert.strictEqual(corruptRuntime.writesAllowed, false);
  assert.strictEqual(corruptQueued, 0);
  console.log("storage boot load, write gate and recovery smoke: ok");
}

const target = process.argv[2] || "all";
Promise.resolve()
  .then(() => target === "primary" || target === "all" ? smokePrimaryRecords() : null)
  .then(() => target === "local" || target === "all" ? smokeLocalStoragePaths() : null)
  .then(() => target === "queue" || target === "all" ? smokePrimarySaveQueue() : null)
  .then(() => target === "state" || target === "all" ? smokeStorageStateRuntime() : null)
  .then(() => target === "boot" || target === "all" ? smokeStorageBootLifecycle() : null)
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
