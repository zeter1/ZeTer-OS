(() => {
  "use strict";

  function indexedDbUnavailableError(message = "IndexedDB недоступен в этом браузере.") {
    return new Error(message);
  }

  function compactVisualSettings(settings = {}, options = {}) {
    const clean = { ...(settings || {}) };
    if (clean.customWallpaper) {
      const { dataURL, preview, ...meta } = clean.customWallpaper;
      clean.customWallpaper = { ...meta, storedIn: options.wallpaperStorage || "IndexedDB" };
    }
    return clean;
  }

  function buildSmallSettingsSnapshot(target = {}, options = {}) {
    const nativeStorage = Boolean(options.nativeStorage);
    const wallpaperStorage = options.wallpaperStorage || (nativeStorage ? "data/zeter-os-state.json" : "IndexedDB");
    const normalizeTaskbarPinnedApps = typeof options.normalizeTaskbarPinnedApps === "function" ? options.normalizeTaskbarPinnedApps : value => value;
    const defaultTaskbarPinnedApps = Array.isArray(options.defaultTaskbarPinnedApps) ? options.defaultTaskbarPinnedApps : [];
    return {
      app: "ZeTer OS",
      fullState: false,
      storageMode: nativeStorage ? "python-data-folder" : "indexeddb-primary",
      note: nativeStorage ? "Основные данные ZeTer OS хранятся в папке data рядом с run_zeter_os.py. localStorage используется только для маленьких настроек интерфейса." : "Основные данные ZeTer OS хранятся в IndexedDB. Этот localStorage-ключ содержит только маленькие настройки для быстрой диагностики.",
      osVersion: options.osVersion,
      versionNumber: options.versionNumber,
      savedAt: options.savedAt || new Date().toISOString(),
      firstRunCompleted: Boolean(target.firstRunCompleted),
      currentDesktop: target.currentDesktop || "desktop",
      settings: compactVisualSettings(target.settings || {}, { wallpaperStorage }),
      systemSettings: target.systemSettings && typeof target.systemSettings === "object" ? structuredClone(target.systemSettings) : {},
      taskbarPinnedApps: normalizeTaskbarPinnedApps(target.taskbarPinnedApps || defaultTaskbarPinnedApps),
      desktops: (target.desktops || []).map(desk => ({
        id: desk.id,
        name: desk.name,
        description: desk.description,
        data: {
          settings: compactVisualSettings(desk.data?.settings || {}, { wallpaperStorage }),
          externalSaveEnabled: Boolean(desk.data?.externalSaveEnabled),
          externalSaveStatus: desk.data?.externalSaveStatus || ""
        }
      }))
    };
  }

  function createStorageRuntimeState(seed = {}) {
    return {
      mode: "Папка data",
      ready: false,
      loadStatus: "pending",
      writesAllowed: false,
      fallback: false,
      lastError: "",
      lastSavedAt: 0,
      lastLoadedAt: 0,
      stateBytes: 0,
      localSettingsBytes: 0,
      usage: null,
      quota: null,
      pressurePct: null,
      warningShownAt: 0,
      ...(seed || {})
    };
  }

  function buildPrimaryStateRecord(snapshot = {}, options = {}) {
    const json = JSON.stringify(snapshot);
    const byteSize = typeof options.byteSize === "function" ? options.byteSize : value => new TextEncoder().encode(String(value || "")).length;
    return {
      id: options.id,
      app: "ZeTer OS",
      osVersion: options.osVersion,
      versionNumber: options.versionNumber,
      storageMode: options.nativeStorage ? "python-data-folder" : "indexeddb-primary",
      updatedAt: options.updatedAt || Date.now(),
      stateBytes: byteSize(json),
      state: snapshot
    };
  }

  function openIndexedDb(dbName, storeName, options = {}) {
    return new Promise((resolve, reject) => {
      const indexedDb = window.indexedDB;
      if (!indexedDb) return reject(indexedDbUnavailableError(options.unavailableMessage));
      const req = indexedDb.open(dbName, options.version || 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          if (options.keyPath) db.createObjectStore(storeName, { keyPath: options.keyPath });
          else db.createObjectStore(storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error(options.openErrorMessage || "Не удалось открыть IndexedDB."));
    });
  }

  function transactionDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function readIndexedDbRecord(dbName, storeName, key, options = {}) {
    const db = await openIndexedDb(dbName, storeName, options);
    return new Promise((resolve, reject) => {
      let result = null;
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => { result = req.result || null; };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  async function putIndexedDbRecord(dbName, storeName, value, options = {}) {
    const db = await openIndexedDb(dbName, storeName, options);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      if (Object.prototype.hasOwnProperty.call(options, "key")) store.put(value, options.key);
      else store.put(value);
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  async function readPrimaryStateRecord(options = {}) {
    const nativeStorage = typeof options.nativeStorage === "function" ? options.nativeStorage() : Boolean(options.nativeStorage);
    const nativeStorageCall = typeof options.nativeStorageCall === "function" ? options.nativeStorageCall : async () => null;
    if (nativeStorage) {
      const result = await nativeStorageCall("load_state");
      if (
        result?.ok === true
        && Object.prototype.hasOwnProperty.call(result, "record")
        && result.record === null
      ) {
        return null;
      }
      const normalizeRecord = typeof options.normalizeNativeStateRecord === "function" ? options.normalizeNativeStateRecord : value => value;
      const record = normalizeRecord(result);
      if (!record?.state || typeof record.state !== "object") {
        throw new Error("Python-хранилище вернуло некорректный результат чтения state.");
      }
      return record;
    }
    const readRecord = typeof options.readIndexedDbRecord === "function" ? options.readIndexedDbRecord : readIndexedDbRecord;
    return readRecord(options.dbName, options.storeName, options.id, {
      keyPath: "id",
      unavailableMessage: options.unavailableMessage || "IndexedDB недоступен в этом браузере.",
      openErrorMessage: options.openErrorMessage || "Не удалось открыть IndexedDB."
    });
  }

  async function writePrimaryStateRecord(snapshot = {}, options = {}) {
    const nativeStorage = typeof options.nativeStorage === "function" ? options.nativeStorage() : Boolean(options.nativeStorage);
    const nativeStorageCall = typeof options.nativeStorageCall === "function" ? options.nativeStorageCall : async () => null;
    const record = buildPrimaryStateRecord(snapshot, { ...options, nativeStorage });
    if (nativeStorage) {
      const result = await nativeStorageCall("save_state", record);
      record.updatedAt = Number(result?.updatedAt || record.updatedAt);
      record.stateBytes = Number(result?.stateBytes || record.stateBytes);
      return record;
    }
    const putRecord = typeof options.putIndexedDbRecord === "function" ? options.putIndexedDbRecord : putIndexedDbRecord;
    await putRecord(options.dbName, options.storeName, record, {
      keyPath: "id",
      unavailableMessage: options.unavailableMessage || "IndexedDB недоступен в этом браузере.",
      openErrorMessage: options.openErrorMessage || "Не удалось открыть IndexedDB."
    });
    return record;
  }

  function readLegacyLocalStorageState(options = {}) {
    const storage = options.storage || window.localStorage;
    try {
      const raw = storage?.getItem(options.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.storageMode === "indexeddb-primary" || parsed?.fullState === false) return null;
      return parsed;
    } catch (error) {
      options.warn?.("[ZeTer OS legacy localStorage load]", error);
      return null;
    }
  }

  function writeSmallSettingsToLocalStorage(target = {}, options = {}) {
    const storage = options.storage || window.localStorage;
    const runtime = options.runtime || {};
    const byteSize = typeof options.byteSize === "function" ? options.byteSize : value => new TextEncoder().encode(String(value || "")).length;
    const buildSnapshot = typeof options.buildSnapshot === "function" ? options.buildSnapshot : value => buildSmallSettingsSnapshot(value, options);
    try {
      const raw = JSON.stringify(buildSnapshot(target));
      storage?.setItem(options.smallSettingsKey, raw);
      runtime.localSettingsBytes = byteSize(raw);
      return true;
    } catch (error) {
      options.warn?.("[ZeTer OS small settings save]", error);
      return false;
    }
  }

  function removeLegacyFullStateFromLocalStorage(options = {}) {
    const storage = options.storage || window.localStorage;
    try {
      storage?.removeItem(options.storageKey);
      return true;
    } catch (error) {
      options.warn?.("[ZeTer OS legacy localStorage remove]", error);
      return false;
    }
  }

  function saveFullStateToLocalStorageFallback(snapshot = {}, options = {}) {
    const storage = options.storage || window.localStorage;
    const runtime = options.runtime || {};
    const byteSize = typeof options.byteSize === "function" ? options.byteSize : value => new TextEncoder().encode(String(value || "")).length;
    try {
      const raw = JSON.stringify(snapshot);
      storage?.setItem(options.storageKey, raw);
      runtime.mode = "localStorage fallback";
      runtime.fallback = true;
      runtime.stateBytes = byteSize(raw);
      return true;
    } catch (error) {
      runtime.lastError = error?.message || String(error);
      options.warn?.("[ZeTer OS localStorage fallback save]", error);
      if (!options.silentStorageError) {
        try { options.toast?.("Ошибка сохранения", "Браузер не смог сохранить состояние ZeTer OS."); } catch {}
      }
      return false;
    }
  }

  function createPrimaryStateSaveQueue(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const cloneState = typeof options.cloneState === "function" ? options.cloneState : value => JSON.parse(JSON.stringify(value));
    const writePrimaryRecord = typeof options.writePrimaryRecord === "function" ? options.writePrimaryRecord : async () => ({ updatedAt: Date.now(), stateBytes: 0 });
    const removeLegacyState = typeof options.removeLegacyState === "function" ? options.removeLegacyState : () => {};
    const saveFallback = typeof options.saveFallback === "function" ? options.saveFallback : () => false;
    const nativeStorage = typeof options.nativeStorage === "function" ? options.nativeStorage : () => Boolean(options.nativeStorage);
    const nativeStorageLabel = typeof options.nativeStorageLabel === "function" ? options.nativeStorageLabel : () => "Папка data";
    const scheduleStorageCheck = typeof options.scheduleStorageCheck === "function" ? options.scheduleStorageCheck : () => {};
    const writesAllowed = typeof options.writesAllowed === "function" ? options.writesAllowed : () => options.writesAllowed !== false;
    const runtime = options.runtime || createStorageRuntimeState();
    const byteSize = typeof options.byteSize === "function" ? options.byteSize : value => new TextEncoder().encode(String(value || "")).length;
    const warn = typeof options.warn === "function" ? options.warn : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    let saveChain = Promise.resolve();

    function queue(queueOptions = {}) {
      if (!writesAllowed()) {
        return Promise.resolve({ skipped: true, reason: "storage-not-loaded" });
      }
      const snapshot = cloneState(getState());
      runtime.stateBytes = byteSize(JSON.stringify(snapshot));
      saveChain = saveChain
        .catch(() => {})
        .then(async () => {
          if (!writesAllowed()) return { skipped: true, reason: "storage-not-loaded" };
          const record = await writePrimaryRecord(snapshot);
          runtime.mode = nativeStorage() ? nativeStorageLabel() : "IndexedDB";
          runtime.ready = true;
          runtime.fallback = false;
          runtime.lastError = "";
          runtime.lastSavedAt = record.updatedAt || Date.now();
          runtime.stateBytes = record.stateBytes || runtime.stateBytes;
          removeLegacyState();
          return { saved: true, fallback: false, record };
        })
        .catch(async error => {
          const primaryMessage = error?.message || String(error);
          runtime.lastError = primaryMessage;
          warn("[ZeTer OS primary state save]", error);

          if (!nativeStorage()) {
            let fallbackSaved = false;
            let fallbackError = null;
            try {
              fallbackSaved = Boolean(await saveFallback(snapshot, { silentStorageError: true }));
            } catch (currentError) {
              fallbackError = currentError;
              warn("[ZeTer OS localStorage fallback save]", currentError);
            }
            if (fallbackSaved) {
              runtime.mode = "localStorage fallback";
              runtime.ready = true;
              runtime.fallback = true;
              runtime.lastError = primaryMessage;
              runtime.lastSavedAt = Date.now();
              if (!queueOptions.silentStorageError) {
                try {
                  toast("IndexedDB недоступен", "Данные сохранены аварийно в localStorage. Освободи место или проверь настройки браузера.");
                } catch {}
              }
              return { saved: true, fallback: true, record: null, primaryError: error };
            }
            const fallbackMessage = fallbackError?.message || "аварийный localStorage не принял данные";
            const combinedError = new Error(`Основное хранилище: ${primaryMessage}; резервное хранилище: ${fallbackMessage}`);
            combinedError.cause = error;
            runtime.lastError = combinedError.message;
            if (!queueOptions.silentStorageError) {
              try { toast("Данные не сохранены", "Не удалось записать состояние ни в IndexedDB, ни в аварийный localStorage."); } catch {}
            }
            throw combinedError;
          }

          if (!queueOptions.silentStorageError) {
            try { toast("Python-хранилище недоступно", "Не удалось сохранить данные в папку data. Проверь запуск через run_zeter_os.py."); } catch {}
          }
          throw error;
        })
        .finally(scheduleStorageCheck);
      return saveChain;
    }

    return Object.freeze({ queue, pending: () => saveChain });
  }

  function createStorageStateRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const setState = typeof options.setState === "function" ? options.setState : () => {};
    const runtime = options.runtime || createStorageRuntimeState();
    const nativeStorage = typeof options.nativeStorage === "function" ? options.nativeStorage : () => Boolean(options.nativeStorage);
    const nativeStorageLabel = typeof options.nativeStorageLabel === "function" ? options.nativeStorageLabel : () => "Папка data";
    const readPrimaryRecord = typeof options.readPrimaryRecord === "function" ? options.readPrimaryRecord : async () => null;
    const readLegacyState = typeof options.readLegacyState === "function" ? options.readLegacyState : () => null;
    const migrateState = typeof options.migrateState === "function" ? options.migrateState : value => value;
    const defaultState = typeof options.defaultState === "function" ? options.defaultState : () => ({});
    const queuePrimarySave = typeof options.queuePrimarySave === "function" ? options.queuePrimarySave : () => Promise.resolve();
    const writeSmallSettings = typeof options.writeSmallSettings === "function" ? options.writeSmallSettings : () => {};
    const scheduleExternalBackup = typeof options.scheduleExternalBackup === "function" ? options.scheduleExternalBackup : () => {};
    const scheduleStorageCheck = typeof options.scheduleStorageCheck === "function" ? options.scheduleStorageCheck : () => {};
    const scheduleProtectionCheck = typeof options.scheduleProtectionCheck === "function" ? options.scheduleProtectionCheck : () => {};
    const waitForNativeStorage = typeof options.waitForNativeStorage === "function" ? options.waitForNativeStorage : async () => {};
    const byteSize = typeof options.byteSize === "function" ? options.byteSize : value => new TextEncoder().encode(String(value || "")).length;
    const warn = typeof options.warn === "function" ? options.warn : () => {};
    const logBootError = typeof options.logBootError === "function" ? options.logBootError : warn;

    async function loadState() {
      const nativeMode = nativeStorage();
      runtime.ready = false;
      runtime.loadStatus = "loading";
      runtime.writesAllowed = false;
      let loaded = null;
      try {
        const record = await readPrimaryRecord();
        if (record?.state) {
          loaded = record.state;
          runtime.mode = nativeMode ? nativeStorageLabel() : "IndexedDB";
          runtime.fallback = false;
          runtime.lastLoadedAt = Date.now();
          runtime.lastSavedAt = Number(record.updatedAt || 0);
          runtime.stateBytes = Number(record.stateBytes || 0) || byteSize(JSON.stringify(record.state));
        }
      } catch (error) {
        runtime.lastError = error?.message || String(error);
        runtime.loadStatus = "error";
        runtime.writesAllowed = false;
        warn(nativeMode ? "[ZeTer OS native storage load]" : "[ZeTer OS IndexedDB load]", error);
        if (nativeMode) throw error;
      }

      if (!loaded && !nativeMode) {
        try {
          const legacy = readLegacyState();
          if (legacy) {
            loaded = legacy;
            runtime.mode = "migration from localStorage";
          }
        } catch (error) {
          runtime.lastError = error?.message || String(error);
          warn("[ZeTer OS legacy localStorage load]", error);
        }
      }

      const migrated = migrateState(loaded || defaultState());
      setState(migrated);
      runtime.mode = loaded ? runtime.mode : (nativeMode ? nativeStorageLabel() : runtime.mode);
      runtime.ready = true;
      runtime.loadStatus = loaded ? "loaded" : "first-run";
      runtime.writesAllowed = true;
      runtime.lastLoadedAt = Date.now();
      if (loaded) runtime.lastError = "";
      if (!loaded || runtime.mode === "migration from localStorage") {
        try {
          const initialSave = Promise.resolve(queuePrimarySave({ silentStorageError: true }));
          initialSave.catch(error => {
            runtime.lastError = error?.message || String(error);
            warn("[ZeTer OS initial primary state save]", error);
          });
        } catch (error) {
          runtime.lastError = error?.message || String(error);
          warn("[ZeTer OS initial primary state save]", error);
        }
      }
      return migrated;
    }

    function saveState(saveOptions = {}) {
      if (!runtime.writesAllowed) {
        return Promise.resolve({ skipped: true, reason: "storage-not-loaded" });
      }
      writeSmallSettings();
      const savePromise = queuePrimarySave({ silentStorageError: saveOptions.silentStorageError });
      if (!saveOptions.skipExternalBackup) {
        try { scheduleExternalBackup(); } catch {}
      }
      if (!saveOptions.skipStorageCheck) scheduleStorageCheck();
      if (!saveOptions.skipProtectionCheck) scheduleProtectionCheck();
      return savePromise;
    }

    function storedStateSizeBytes() {
      if (Number.isFinite(runtime.stateBytes) && runtime.stateBytes > 0) return runtime.stateBytes;
      try { return byteSize(JSON.stringify(getState())); }
      catch { return 0; }
    }

    async function loadStateForBoot() {
      try {
        if (nativeStorage()) await waitForNativeStorage();
        const loaded = await loadState();
        setState(loaded);
        writeSmallSettings();
        scheduleStorageCheck();
        scheduleProtectionCheck();
        return loaded;
      } catch (error) {
        logBootError("[ZeTer OS boot storage]", error);
        runtime.lastError = error?.message || String(error);
        runtime.ready = false;
        runtime.loadStatus = "error";
        runtime.writesAllowed = false;
        if (nativeStorage()) throw error;
        const fallback = migrateState(defaultState());
        setState(fallback);
        runtime.ready = true;
        runtime.loadStatus = "first-run";
        runtime.writesAllowed = true;
        return fallback;
      }
    }

    return Object.freeze({ loadState, saveState, storedStateSizeBytes, loadStateForBoot });
  }

  async function getAllIndexedDbRecords(dbName, storeName, options = {}) {
    const db = await openIndexedDb(dbName, storeName, options);
    return new Promise((resolve, reject) => {
      let result = [];
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => { result = req.result || []; };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  async function clearIndexedDbStore(dbName, storeName, options = {}) {
    const db = await openIndexedDb(dbName, storeName, options);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  }

  function deleteIndexedDatabaseByName(name) {
    return new Promise(resolve => {
      const indexedDb = window.indexedDB;
      if (!name || !indexedDb) return resolve(false);
      const req = indexedDb.deleteDatabase(name);
      req.onsuccess = () => resolve(true);
      req.onerror = () => { console.warn("[ZeTer OS cleanup IndexedDB]", name, req.error); resolve(false); };
      req.onblocked = () => { console.warn("[ZeTer OS cleanup IndexedDB blocked]", name); resolve(false); };
    });
  }

  function clearLegacyLocalStorageData(options = {}) {
    const removed = [];
    try {
      const oldKeys = Array.isArray(options.oldKeys) ? options.oldKeys : [];
      const smallSettingsKey = options.smallSettingsKey || "";
      const storageKey = options.storageKey || "";
      const keepStorageKey = Boolean(options.keepStorageKey);
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.filter(key => {
        if (!key || key === smallSettingsKey) return false;
        if (key === storageKey && keepStorageKey) return false;
        return oldKeys.includes(key);
      }).forEach(key => {
        localStorage.removeItem(key);
        removed.push(key);
      });
    } catch (err) {
      console.warn("[ZeTer OS cleanup localStorage]", err);
    }
    return removed.length;
  }

  async function clearOldIndexedDbData(options = {}) {
    if (!window.indexedDB) return 0;
    const names = new Set(Array.isArray(options.names) ? options.names : []);
    const exclude = new Set(Array.isArray(options.excludeNames) ? options.excludeNames.filter(Boolean) : []);
    const deleteDatabase = typeof options.deleteDatabase === "function" ? options.deleteDatabase : deleteIndexedDatabaseByName;

    let removed = 0;
    for (const name of names) {
      if (name && !exclude.has(name) && await deleteDatabase(name)) removed++;
    }
    return removed;
  }

  async function clearOldPwaCaches(options = {}) {
    if (!window.caches) return 0;
    const activeCacheName = options.activeCacheName || "";
    const matchCacheName = typeof options.matchCacheName === "function"
      ? options.matchCacheName
      : key => /^zeter-os-/i.test(key);
    try {
      const keys = await caches.keys();
      const oldKeys = keys.filter(key => matchCacheName(key) && key !== activeCacheName);
      await Promise.all(oldKeys.map(key => caches.delete(key)));
      return oldKeys.length;
    } catch (err) {
      console.warn("[ZeTer OS cleanup caches]", err);
      return 0;
    }
  }

  window.ZETER_STORAGE_UTILS = Object.freeze({
    createStorageRuntimeState,
    buildSmallSettingsSnapshot,
    buildPrimaryStateRecord,
    openIndexedDb,
    transactionDone,
    readIndexedDbRecord,
    putIndexedDbRecord,
    readPrimaryStateRecord,
    writePrimaryStateRecord,
    readLegacyLocalStorageState,
    writeSmallSettingsToLocalStorage,
    removeLegacyFullStateFromLocalStorage,
    saveFullStateToLocalStorageFallback,
    createPrimaryStateSaveQueue,
    createStorageStateRuntimeController,
    getAllIndexedDbRecords,
    clearIndexedDbStore,
    deleteIndexedDatabaseByName,
    clearLegacyLocalStorageData,
    clearOldIndexedDbData,
    clearOldPwaCaches
  });
})();
