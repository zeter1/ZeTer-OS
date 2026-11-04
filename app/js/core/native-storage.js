(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS config is not loaded.");

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS core utils are not loaded.");

  const {
    OS_VERSION,
    OS_VERSION_NUMBER,
    PRIMARY_STATE_ID
  } = config;

  const { byteSize } = coreUtils;
  const nativeStorageQuery = new URLSearchParams(window.location?.search || "").get("native") === "1";
  let nativeStorageReadyPromise = null;

  function shouldUseNativeStorage() {
    if (window.ZETER_TRAINING_RUNTIME?.active) return false;
    return Boolean(nativeStorageQuery || window.ZETER_PYTHON_STORAGE || window.pywebview?.api?.load_state);
  }

  function nativeStorageLabel() {
    return "Папка data";
  }

  function waitForNativeStorage(timeoutMs = 3000) {
    if (window.ZETER_TRAINING_RUNTIME?.active) return Promise.resolve(false);
    if (window.pywebview?.api) return Promise.resolve(true);
    if (!shouldUseNativeStorage()) return Promise.resolve(false);
    if (!nativeStorageReadyPromise) {
      nativeStorageReadyPromise = new Promise(resolve => {
        let done = false;
        const finish = value => {
          if (done) return;
          done = true;
          resolve(Boolean(value && window.pywebview?.api));
        };
        window.addEventListener("pywebviewready", () => finish(true), { once: true });
        setTimeout(() => finish(false), timeoutMs);
      });
    }
    return nativeStorageReadyPromise;
  }

  async function nativeStorageCall(method, ...args) {
    if (window.ZETER_TRAINING_RUNTIME?.active) throw new Error("Системные действия недоступны в учебной среде.");
    const ready = await waitForNativeStorage();
    const api = ready ? window.pywebview?.api : null;
    if (!api || typeof api[method] !== "function") {
      throw new Error("Связь с настольным приложением недоступна или оно не поддерживает это действие. Перезапустите ZeTer OS; в браузере используйте готовую Windows-сборку или Python-версию с pywebview.");
    }
    const result = await api[method](...args);
    if (result && result.ok === false) {
      const error = new Error(result.error || `Ошибка Python-хранилища: ${method}`);
      if (typeof result.code === "string") error.code = result.code;
      throw error;
    }
    return result;
  }

  function normalizeNativeStateRecord(raw) {
    if (!raw) return null;
    if (raw.ok === true && Object.prototype.hasOwnProperty.call(raw, "record")) raw = raw.record;
    if (!raw) return null;
    const record = raw.record || raw;
    if (record.ok === true && Object.prototype.hasOwnProperty.call(record, "record")) return normalizeNativeStateRecord(record.record);
    const loadedState = record.state || record.data || record;
    if (!loadedState || typeof loadedState !== "object") return null;
    return {
      id: PRIMARY_STATE_ID,
      app: "ZeTer OS",
      osVersion: record.osVersion || record.version || OS_VERSION,
      versionNumber: Number(record.versionNumber || record.version || OS_VERSION_NUMBER) || OS_VERSION_NUMBER,
      storageMode: "python-data-folder",
      updatedAt: Number(record.updatedAt || record.savedAt || Date.now()) || Date.now(),
      stateBytes: Number(record.stateBytes || 0) || byteSize(JSON.stringify(loadedState)),
      state: loadedState
    };
  }

  window.ZETER_NATIVE_STORAGE = Object.freeze({
    shouldUseNativeStorage,
    nativeStorageLabel,
    waitForNativeStorage,
    nativeStorageCall,
    normalizeNativeStateRecord
  });
})();
