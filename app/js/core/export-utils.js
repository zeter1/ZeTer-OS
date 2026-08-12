(() => {
  "use strict";

  const protectionUtils = window.ZETER_SECURITY_PROTECTION_UTILS;
  if (!protectionUtils) throw new Error("ZeTer OS export utils require security protection utils.");
  const { createBackupManifest, verifyBackupBlob, validateBackupStatePayload, checksum, stateSummary } = protectionUtils;

  function fastStringHash(value = "") {
    const str = String(value);
    let h = 2166136261;
    const step = Math.max(1, Math.floor(str.length / 12000));
    for (let i = 0; i < str.length; i += step) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function escapeXml(value = "") {
    return String(value ?? "").replace(/[<>&'\"]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch]));
  }

  function sanitizeExportPathPart(name = "file", fallback = "file") {
    const cleaned = String(name || fallback || "file")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);
    return cleaned || fallback || "file";
  }

  function stripKnownExtension(name = "") {
    return String(name || "").replace(/\.(txt|docx|html|md|csv|table)$/i, "");
  }

  function uniqueExportPath(path, seen) {
    const normalized = String(path || "file").replace(/^\/+/, "").replace(/\/+/g, "/");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      return normalized;
    }
    const slash = normalized.lastIndexOf("/");
    const folder = slash >= 0 ? normalized.slice(0, slash + 1) : "";
    const file = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const dot = file.lastIndexOf(".");
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";
    let n = 2;
    let candidate = `${folder}${base} (${n})${ext}`;
    while (seen.has(candidate)) {
      n++;
      candidate = `${folder}${base} (${n})${ext}`;
    }
    seen.add(candidate);
    return candidate;
  }

  function humanDateTime() {
    return new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function tablePageToCSV(page = {}) {
    const rows = Array.isArray(page.rows) ? page.rows : [];
    return rows.map(row => row.map(csvCell).join(";")).join("\r\n") + "\r\n";
  }

  function syncLiveExportSources(options = {}) {
    const {
      windows = [],
      stickyCards = [],
      getItem = () => null,
      query = () => null,
      cleanRichHtml = value => value,
      plainToRichHtml = value => value,
      now = () => Date.now()
    } = options;
    const editablePlainText = element => {
      const clone = element?.cloneNode?.(true);
      if (!clone) return String(element?.innerText ?? element?.textContent ?? "").replace(/\u00a0/g, " ");
      clone.querySelectorAll?.("[data-managed-file-inline]").forEach(marker => marker.remove());
      return String(clone.innerText ?? clone.textContent ?? "").replace(/\u00a0/g, " ");
    };
    let changed = false;
    windows.forEach(record => {
      const itemId = record?.params?.itemId;
      const item = itemId ? getItem(itemId) : null;
      if (!item || !record.el) return;

      if (record.appId === "editor") {
        const title = query(".editor-title", record.el);
        const area = query(".rich-editor-area", record.el);
        if (!area) return;
        item.name = title?.value?.trim() || item.name;
        item.richContent = cleanRichHtml(area.innerHTML);
        item.content = editablePlainText(area);
        item.updatedAt = now();
        changed = true;
      }

      if (record.appId === "markdown") {
        const title = query(".editor-title", record.el);
        const area = query("textarea", record.el);
        if (!area) return;
        item.name = title?.value?.trim() || item.name;
        item.content = area.value;
        item.updatedAt = now();
        changed = true;
      }

      if (record.appId === "table") {
        const title = query(".table-title", record.el);
        if (title?.value?.trim()) {
          item.name = title.value.trim();
          item.updatedAt = now();
          changed = true;
        }
      }
    });

    stickyCards.forEach(card => {
      const note = getItem(card?.dataset?.noteId);
      if (!note || note.type !== "note") return;
      const title = query("[data-sticky-title]", card);
      const text = query("[data-sticky-text]", card);
      if (!text) return;
      note.name = title?.value?.trim() || note.name;
      if (text.getAttribute?.("contenteditable") !== null) {
        note.content = editablePlainText(text);
        note.richContent = cleanRichHtml(text.innerHTML);
      } else {
        note.content = text.value;
        note.richContent = plainToRichHtml(text.value);
      }
      note.updatedAt = now();
      changed = true;
    });
    return changed;
  }

  function buildExternalSavePayloadModel(prepared = {}, options = {}) {
    const nativeMode = Boolean(options.nativeMode);
    return JSON.stringify({
      app: options.appName || "ZeTer OS",
      version: options.version,
      versionNumber: options.versionNumber,
      savedAt: (options.nowIso || (() => new Date().toISOString()))(),
      backupMode: "json-plus-external-images-and-readable-data",
      storageMode: nativeMode ? "python-data-folder" : "indexeddb-primary",
      storageStateBytes: options.storageStateBytes ?? 0,
      assetRoot: options.assetRoot || "zeter-os-assets",
      note: nativeMode
        ? "Автоматическая копия ZeTer OS. Основное состояние хранится в data/zeter-os-state.json рядом с программой; этот JSON можно использовать для восстановления или переноса."
        : "Автоматическая копия ZeTer OS. JSON хранит полную структуру ОС и служебные поля совместимости старых версий; изображения вынесены в zeter-os-assets/images, обои — в zeter-os-assets/wallpapers, иконки рабочих столов — в zeter-os-assets/desktop-icons, а человекочитаемые заметки, календарь и задачи сохраняются в zeter-os-data. В старом браузерном режиме основное состояние хранится в IndexedDB; localStorage используется только для маленьких настроек.",
      assets: prepared.assets,
      state: prepared.state
    }, null, 2);
  }

  async function buildDownloadOsDataZipModel(target = {}, options = {}) {
    const {
      syncBeforeBackup = () => {},
      buildReadableEntries = async () => [],
      createZipBlob = async entries => new Blob(entries.map(entry => entry.blob)),
      BlobClass = globalThis.Blob,
      nowIso = () => new Date().toISOString()
    } = options;
    const nativeMode = Boolean(options.nativeMode);
    syncBeforeBackup();
    const payload = {
      app: options.appName || "ZeTer OS",
      version: options.version,
      versionNumber: options.versionNumber,
      exportedAt: nowIso(),
      backupMode: "zip-with-readable-folders",
      storageMode: nativeMode ? "python-data-folder" : "indexeddb-primary",
      storageStateBytes: options.storageStateBytes ?? 0,
      note: nativeMode
        ? "ZIP содержит zeter-os-state.json для восстановления ОС и отдельные человекочитаемые папки с заметками, календарём, задачами, обоями и иконками. Основное автосохранение выполняется в папку data рядом с программой."
        : "ZIP содержит zeter-os-state.json для восстановления ОС, включая служебные поля совместимости старых версий, а также отдельные папки с заметками, календарём, задачами, загруженными обоями и иконками рабочих столов. В старом браузерном режиме основное состояние хранится в IndexedDB; localStorage используется только для маленьких настроек.",
      state: target
    };
    const entries = [
      { path: "zeter-os-state.json", blob: new BlobClass([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }) },
      ...(await buildReadableEntries())
    ];
    const manifest = await createBackupManifest(entries, {
      createdAt: payload.exportedAt,
      osVersion: payload.version,
      versionNumber: payload.versionNumber,
      backupMode: payload.backupMode,
      stateSummary: stateSummary(target)
    });
    entries.push({ path: "zeter-backup-manifest.json", blob: new BlobClass([JSON.stringify(manifest, null, 2)], { type: "application/json;charset=utf-8" }) });
    const zip = await createZipBlob(entries);
    const verification = await verifyBackupBlob(zip);
    if (!verification.ok || !verification.verified) throw new Error("Не удалось проверить собранный ZIP-бэкап.");
    try { Object.defineProperty(zip, "zeterVerification", { value: verification, configurable: true }); } catch {}
    return zip;
  }

  async function runExternalBackupSaveAction(options = {}) {
    const reason = options.reason || "auto";
    const notify = typeof options.notify === "function" ? options.notify : () => {};
    if (!options.hasDirectory) {
      if (options.nativeMode) {
        await options.persistNativeState?.();
        let dataDir = "data";
        try { dataDir = (await options.getNativeStorageInfo?.())?.dataDir || dataDir; } catch {}
        if (reason !== "silent") notify("Состояние сохранено", `Файл data/zeter-os-state.json обновлён, а Windows-копии лежат в data/Рабочие столы. Папка: ${dataDir}`);
        return true;
      }
      if (reason !== "silent") notify("Папка не выбрана", "Сначала выбери одну папку для автосохранения.");
      return false;
    }
    if (options.busy) return false;
    options.setBusy?.(true);
    try {
      const allowed = await options.verifyPermission?.();
      if (!allowed) throw new Error("Нет разрешения на запись в выбранную папку.");
      options.syncLiveEditors?.();
      for (const root of options.assetRoots || []) await options.clearDirectory?.(root);
      const writeResult = await options.writeStateFile?.();
      await options.writeReadableData?.();
      const verification = await options.verifyWritten?.(writeResult);
      if (verification && !verification.ok) throw new Error(verification.error || "Записанный бэкап не прошёл проверку.");
      const timeLabel = (options.timeLabel || (() => new Date().toLocaleTimeString("ru-RU")))();
      options.markSaved?.(timeLabel, verification);
      if (reason !== "silent") notify("ZeTer OS сохранена и проверена", "JSON перечитан после записи; изображения и папка zeter-os-data с заметками, календарём и задачами обновлены.");
      options.persistStatus?.();
      return true;
    } catch (error) {
      options.logError?.(error);
      const message = error?.message || error;
      options.markFailed?.(message);
      options.persistStatus?.();
      if (reason !== "silent") notify("Не удалось сохранить в папку", error?.message || "Проверь разрешение браузера.");
      return false;
    } finally {
      options.setBusy?.(false);
    }
  }

  async function runExternalFolderPickerAction(options = {}) {
    const notify = typeof options.notify === "function" ? options.notify : () => {};
    if (options.pickerOpen) return;
    if (options.nativeMode) {
      try {
        const info = await options.openNativeDataFolder?.();
        notify("Папка data открыта", `Основной JSON и Windows-копии лежат здесь: ${info?.dataDir || "data"}`);
      } catch (error) {
        try {
          const info = await options.getNativeStorageInfo?.();
          notify("Папка data подключена", `JSON, DOC/DOCX/TXT/CSV и изображения автоматически сохраняются рядом с программой: ${info?.dataDir || "data"}`);
        } catch {
          notify("Python-хранилище недоступно", error?.message || "Запусти ZeTer OS через run_zeter_os.py.");
        }
      }
      return;
    }
    if (!options.supported) {
      notify("Браузер не поддерживает автосохранение в папку", "Нужен Chrome/Edge/Brave с File System Access API. Для file:// может потребоваться разрешение браузера.");
      return;
    }
    options.setPickerOpen?.(true);
    try {
      const handle = await options.pickDirectory?.();
      const allowed = await options.verifyPermission?.(handle);
      if (!allowed) return notify("Нет разрешения", "Разреши запись только в одну выбранную папку.");
      await options.activateDirectory?.(handle);
      await options.saveBackup?.("manual");
      options.refresh?.();
    } catch (error) {
      options.logError?.(error);
      notify("Папка не выбрана", "Автосохранение в папку не включено.");
    } finally {
      options.setPickerOpen?.(false);
    }
  }

  async function initializeExternalSaveAction(options = {}) {
    if (options.nativeMode) {
      try {
        const info = await options.getNativeStorageInfo?.();
        options.markNativeConnected?.(info?.dataDir || "data");
      } catch (error) {
        options.logError?.(error);
      }
      return;
    }
    if (!options.supported) return;
    try {
      const handle = await options.loadDirectory?.();
      options.setDirectory?.(handle || null);
      if (handle) await options.rememberDirectory?.(handle);
      const saveEnabled = typeof options.saveEnabled === "function" ? options.saveEnabled() : options.saveEnabled;
      if (handle && saveEnabled) {
        const allowed = await options.verifyPermission?.(handle);
        if (allowed) options.scheduleBackup?.();
      }
    } catch (error) {
      options.logError?.(error);
    }
  }

  function createExternalBackupRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const getWorkspace = typeof options.getWorkspace === "function" ? options.getWorkspace : () => ({});
    const getDirectoryHandle = typeof options.getDirectoryHandle === "function" ? options.getDirectoryHandle : () => null;
    const setDirectoryHandle = typeof options.setDirectoryHandle === "function" ? options.setDirectoryHandle : () => {};
    const nativeMode = typeof options.nativeMode === "function" ? options.nativeMode : () => Boolean(options.nativeMode);
    const storageStateBytes = typeof options.storageStateBytes === "function" ? options.storageStateBytes : () => Number(options.storageStateBytes || 0);
    const buildExternalStateModel = typeof options.buildExternalBackupStateModel === "function" ? options.buildExternalBackupStateModel : async target => ({ state: target, assets: [] });
    const syncOpenWindows = typeof options.syncOpenWindows === "function" ? options.syncOpenWindows : () => {};
    const saveDataImageAsset = typeof options.saveDataImageAsset === "function" ? options.saveDataImageAsset : async () => {};
    const createRichContentAdapter = typeof options.createRichContentAdapter === "function" ? options.createRichContentAdapter : () => ({ images: [], serialize: () => "" });
    const pad = typeof options.pad === "function" ? options.pad : value => String(value).padStart(2, "0");
    const collectVisualSettingsHolders = typeof options.collectVisualSettingsHolders === "function" ? options.collectVisualSettingsHolders : () => [];
    const normalizeCustomWallpaper = typeof options.normalizeCustomWallpaper === "function" ? options.normalizeCustomWallpaper : value => value;
    const normalizeDesktopIcon = typeof options.normalizeDesktopIcon === "function" ? options.normalizeDesktopIcon : value => value;
    const buildReadableEntries = typeof options.buildReadableEntries === "function" ? options.buildReadableEntries : async () => [];
    const createZipBlob = typeof options.createZipBlob === "function" ? options.createZipBlob : async entries => new Blob(entries.map(entry => entry.blob));
    const clearDirectory = typeof options.clearDirectory === "function" ? options.clearDirectory : async () => {};
    const writeBlobByPath = typeof options.writeBlobByPath === "function" ? options.writeBlobByPath : async () => {};
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const verifyPermission = typeof options.verifyPermission === "function" ? options.verifyPermission : async () => false;
    const storeDirectory = typeof options.storeDirectory === "function" ? options.storeDirectory : async () => {};
    const loadDirectory = typeof options.loadDirectory === "function" ? options.loadDirectory : async () => null;
    const openNativeDataFolder = typeof options.openNativeDataFolder === "function" ? options.openNativeDataFolder : async () => ({});
    const getNativeStorageInfo = typeof options.getNativeStorageInfo === "function" ? options.getNativeStorageInfo : async () => ({});
    const pickDirectory = typeof options.pickDirectory === "function" ? options.pickDirectory : async () => null;
    const refresh = typeof options.refresh === "function" ? options.refresh : () => {};
    const notify = typeof options.notify === "function" ? options.notify : () => {};
    const warn = typeof options.warn === "function" ? options.warn : () => {};
    const logExternalSaveError = typeof options.logExternalSaveError === "function" ? options.logExternalSaveError : () => {};
    const logPickerError = typeof options.logPickerError === "function" ? options.logPickerError : () => {};
    const logInitError = typeof options.logInitError === "function" ? options.logInitError : () => {};
    const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
    const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
    const windowRef = options.windowRef || globalThis.window || {};
    const assetRoots = Array.isArray(options.assetRoots) ? options.assetRoots : [];
    const assetRoot = options.assetRoot || "zeter-os-assets";
    const version = options.version;
    const versionNumber = options.versionNumber;
    let saveTimer = null;
    let busy = false;
    let pickerOpen = false;

    function supportsExternalFolderSave() {
      if (nativeMode()) return false;
      return "showDirectoryPicker" in windowRef && "indexedDB" in windowRef;
    }

    async function buildExternalBackupState() {
      return buildExternalStateModel(getState(), {
        syncBeforeBackup: syncOpenWindows,
        saveDataImageAsset,
        createRichContentAdapter,
        fastStringHash,
        pad,
        collectVisualSettingsHolders,
        normalizeCustomWallpaper,
        normalizeDesktopIcon,
        warn
      });
    }

    async function externalSavePayload() {
      return buildExternalSavePayloadModel(await buildExternalBackupState(), {
        version,
        versionNumber,
        nativeMode: nativeMode(),
        storageStateBytes: storageStateBytes(),
        assetRoot
      });
    }

    async function writeSeparatedOsDataFiles(rootHandle) {
      await clearDirectory(rootHandle, "zeter-os-data");
      const entries = await buildReadableEntries();
      for (const entry of entries) {
        await writeBlobByPath(rootHandle, `zeter-os-data/${entry.path}`, entry.blob);
      }
    }

    async function buildDownloadOsDataZip(target = getState()) {
      return buildDownloadOsDataZipModel(target, {
        version,
        versionNumber,
        nativeMode: nativeMode(),
        storageStateBytes: storageStateBytes(),
        syncBeforeBackup: syncOpenWindows,
        buildReadableEntries,
        createZipBlob
      });
    }

    async function writeExternalBackup(reason = "auto") {
      let writtenPayload = "";
      return runExternalBackupSaveAction({
        reason,
        hasDirectory: Boolean(getDirectoryHandle()),
        nativeMode: nativeMode(),
        busy,
        setBusy: value => { busy = value; },
        persistNativeState: () => saveState({ skipExternalBackup: true, silentStorageError: true }),
        getNativeStorageInfo,
        notify,
        verifyPermission: () => verifyPermission(getDirectoryHandle(), true),
        syncLiveEditors: options.syncLiveEditors,
        assetRoots,
        clearDirectory: path => clearDirectory(getDirectoryHandle(), path),
        writeStateFile: async () => {
          const fileHandle = await getDirectoryHandle().getFileHandle("zeter-os-state.json", { create: true });
          const writable = await fileHandle.createWritable();
          writtenPayload = await externalSavePayload();
          await writable.write(writtenPayload);
          await writable.close();
          return writtenPayload;
        },
        writeReadableData: () => writeSeparatedOsDataFiles(getDirectoryHandle()),
        verifyWritten: async () => {
          const fileHandle = await getDirectoryHandle().getFileHandle("zeter-os-state.json");
          const file = await fileHandle.getFile();
          const text = await file.text();
          const payload = JSON.parse(text);
          validateBackupStatePayload(payload);
          const digest = await checksum(text);
          return { ok: true, bytes: file.size || new TextEncoder().encode(text).byteLength, ...digest };
        },
        markSaved: (time, verification) => Object.assign(getWorkspace(), {
          externalSaveEnabled: true,
          externalSaveStatus: `Сохранено и проверено: ${time}`,
          externalSaveVerifiedAt: Date.now(),
          externalSaveBytes: Number(verification?.bytes || new TextEncoder().encode(writtenPayload).byteLength),
          externalSaveChecksum: verification?.value || ""
        }),
        markFailed: message => { getWorkspace().externalSaveStatus = `Ошибка сохранения: ${message}`; },
        persistStatus: () => saveState({ skipExternalBackup: true }),
        logError: logExternalSaveError
      });
    }

    function scheduleExternalBackup() {
      const workspace = getWorkspace();
      if (!workspace.externalSaveEnabled || !getDirectoryHandle()) return false;
      clearTimer(saveTimer);
      saveTimer = setTimer(() => writeExternalBackup("silent"), 900);
      return true;
    }

    async function chooseExternalSaveFolder() {
      return runExternalFolderPickerAction({
        pickerOpen,
        nativeMode: nativeMode(),
        supported: supportsExternalFolderSave(),
        setPickerOpen: value => { pickerOpen = value; },
        openNativeDataFolder,
        getNativeStorageInfo,
        pickDirectory,
        verifyPermission: handle => verifyPermission(handle, true),
        activateDirectory: async handle => {
          setDirectoryHandle(handle);
          await storeDirectory(handle);
          getWorkspace().externalSaveEnabled = true;
        },
        saveBackup: writeExternalBackup,
        refresh,
        notify,
        logError: logPickerError
      });
    }

    async function initExternalSaveFolder() {
      return initializeExternalSaveAction({
        nativeMode: nativeMode(),
        supported: supportsExternalFolderSave(),
        getNativeStorageInfo,
        markNativeConnected: dataDir => Object.assign(getWorkspace(), { externalSaveEnabled: true, externalSaveStatus: `Папка data подключена автоматически: ${dataDir}` }),
        loadDirectory,
        setDirectory: setDirectoryHandle,
        rememberDirectory: storeDirectory,
        saveEnabled: () => getWorkspace().externalSaveEnabled,
        verifyPermission: handle => verifyPermission(handle, true),
        scheduleBackup: scheduleExternalBackup,
        logError: logInitError
      });
    }

    function clearRuntimeState() {
      setDirectoryHandle(null);
      clearTimer(saveTimer);
      saveTimer = null;
      try {
        const workspace = getWorkspace();
        workspace.externalSaveEnabled = false;
        workspace.externalSaveStatus = "";
      } catch {}
    }

    function runtimeState() {
      return Object.freeze({ hasDirectory: Boolean(getDirectoryHandle()), busy, pickerOpen, scheduled: Boolean(saveTimer) });
    }

    return Object.freeze({
      supportsExternalFolderSave,
      buildExternalBackupState,
      externalSavePayload,
      writeSeparatedOsDataFiles,
      buildDownloadOsDataZip,
      writeExternalBackup,
      scheduleExternalBackup,
      chooseExternalSaveFolder,
      initExternalSaveFolder,
      clearRuntimeState,
      runtimeState
    });
  }

  async function runDownloadBackupAction(options = {}) {
    try {
      options.syncBeforeExport?.();
      const zip = await options.buildZip?.();
      const verification = zip?.zeterVerification || await verifyBackupBlob(zip);
      if (!verification?.ok || !verification?.verified) throw new Error("ZIP создан, но не прошёл проверку манифеста и контрольных сумм.");
      const fileName = options.fileName?.();
      const downloadResult = await options.download?.(fileName, zip);
      if (downloadResult?.cancelled) return null;
      options.markBackup?.({ name: fileName, size: Number(zip?.size || 0), verification });
      await options.persistBackup?.();
      const sizeText = options.formatBytes?.(zip?.size || 0) || String(zip?.size || 0);
      options.notify?.("Полный бэкап создан и проверен", `${sizeText} · Манифест и контрольные суммы в порядке. ZIP содержит JSON для восстановления и человекочитаемые данные.`);
      return { name: fileName, size: zip?.size || 0, verification, downloadResult };
    } catch (error) {
      options.logError?.(error);
      options.notify?.("Ошибка сохранения", error?.message || "Не удалось собрать данные ОС.");
      return null;
    }
  }

  window.ZETER_EXPORT_UTILS = Object.freeze({
    fastStringHash,
    escapeXml,
    sanitizeExportPathPart,
    stripKnownExtension,
    uniqueExportPath,
    humanDateTime,
    tablePageToCSV,
    syncLiveExportSources,
    buildExternalSavePayloadModel,
    buildDownloadOsDataZipModel,
    runExternalBackupSaveAction,
    runExternalFolderPickerAction,
    initializeExternalSaveAction,
    createExternalBackupRuntimeController,
    runDownloadBackupAction
  });
})();
