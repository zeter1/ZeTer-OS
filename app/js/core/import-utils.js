(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS config is not loaded.");

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS core utils are not loaded.");

  const assetUtils = window.ZETER_ASSET_UTILS;
  if (!assetUtils) throw new Error("ZeTer OS asset utils are not loaded.");

  const protectionUtils = window.ZETER_SECURITY_PROTECTION_UTILS;
  if (!protectionUtils) throw new Error("ZeTer OS import utils require security protection utils.");

  const {
    BACKUP_IMPORT_MAX_BYTES,
    BACKUP_IMPORT_MAX_STATE_BYTES,
    BACKUP_IMPORT_MAX_TEXT_CHARS,
    BACKUP_IMPORT_MAX_DATA_URL_CHARS,
    BACKUP_IMPORT_MAX_TOTAL_DATA_URL_CHARS
  } = config;

  const { byteSize, bytesToHuman, isSafeId } = coreUtils;
  const {
    isDataImage,
    isExternalAssetPath,
    stateHasExternalAssets,
    blobToDataURL,
    readStoredZipEntries
  } = assetUtils;
  const {
    verifyBackupEntries,
    decryptBackupBlob,
    isEncryptedBackupFile
  } = protectionUtils;

  function assertImportFileSize(file, maxBytes, label) {
    const size = Number(file?.size || 0);
    if (size > maxBytes) throw new Error(`${label} слишком большой: ${bytesToHuman(size)}. Максимум: ${bytesToHuman(maxBytes)}.`);
  }

  function parseBackupJsonText(text = "", label = "JSON") {
    const size = byteSize(text);
    if (size > BACKUP_IMPORT_MAX_STATE_BYTES) throw new Error(`${label} слишком большой для безопасного импорта: ${bytesToHuman(size)}.`);
    return JSON.parse(text);
  }

  function parseBackupJsonBytes(bytes, label = "JSON") {
    const size = Number(bytes?.byteLength || bytes?.length || 0);
    if (size > BACKUP_IMPORT_MAX_STATE_BYTES) throw new Error(`${label} слишком большой для безопасного импорта: ${bytesToHuman(size)}.`);
    return parseBackupJsonText(new TextDecoder().decode(bytes), label);
  }

  function attachBackupMetadata(data, metadata = {}) {
    if (!data || typeof data !== "object") return data;
    try { Object.defineProperty(data, "__zeterBackup", { value: metadata, configurable: true }); } catch {}
    return data;
  }

  async function readSavedOsDataFile(file, options = {}) {
    assertImportFileSize(file, BACKUP_IMPORT_MAX_BYTES, "Файл бэкапа");
    if (isEncryptedBackupFile(file)) {
      const passphrase = await options.requestPassphrase?.(file);
      if (passphrase == null || passphrase === "") {
        const error = new Error("Импорт зашифрованного бэкапа отменён.");
        error.cancelled = true;
        throw error;
      }
      const decrypted = await (options.decryptBackupBlob || decryptBackupBlob)(file, passphrase);
      try { Object.defineProperty(decrypted.blob, "name", { value: decrypted.header?.originalName || "decrypted-backup.zip" }); } catch {}
      const data = await readSavedOsDataFile(decrypted.blob, { ...options, requestPassphrase: null });
      return attachBackupMetadata(data, { ...(data?.__zeterBackup || {}), encrypted: true, encryptionHeader: decrypted.header });
    }
    const isZip = /\.zip$/i.test(file.name || "") || /zip/i.test(file.type || "");
    if (!isZip) {
      assertImportFileSize(file, BACKUP_IMPORT_MAX_STATE_BYTES, "JSON-бэкап");
      return attachBackupMetadata(parseBackupJsonText(await file.text(), file.name || "JSON-бэкап"), {
        encrypted: false,
        verification: { ok: true, verified: false, legacy: true, status: "JSON-бэкап без манифеста" }
      });
    }

    const entries = await readStoredZipEntries(await file.arrayBuffer());
    const verification = await verifyBackupEntries(entries);
    const direct = entries.get("zeter-os-state.json") || entries.get("backup/zeter-os-state.json");
    if (direct) return attachBackupMetadata(parseBackupJsonBytes(direct, "zeter-os-state.json"), { encrypted: false, verification });
    for (const [path, bytes] of entries) {
      if (!/\.json$/i.test(path)) continue;
      try {
        const data = parseBackupJsonBytes(bytes, path);
        if (data?.app === "ZeTer OS" || data?.state?.fs) return attachBackupMetadata(data, { encrypted: false, verification });
      } catch {}
    }
    throw new Error("В этом ZIP не найден zeter-os-state.json. Загрузи архив, созданный кнопкой «Экспорт ZIP-бэкапа», или отдельный JSON-файл ZeTer OS.");
  }

  function validateImportArrayLimit(value, label, max) {
    if (Array.isArray(value) && value.length > max) throw new Error(`${label}: слишком много записей (${value.length}). Максимум: ${max}.`);
  }

  function validateImportString(value, label, max = BACKUP_IMPORT_MAX_TEXT_CHARS) {
    if (typeof value === "string" && value.length > max) throw new Error(`${label}: слишком длинный текст.`);
  }

  function validateImportSafeId(value, label, options = {}) {
    const raw = String(value ?? "").trim();
    if (!raw) {
      if (options.optional) return;
      throw new Error(`${label}: отсутствует безопасный ID.`);
    }
    if (!isSafeId(raw)) {
      throw new Error(`${label}: ID содержит недопустимые символы. Разрешены только латиница, цифры, _ и -.`);
    }
  }

  function validateImportEnum(value, allowed, label, options = {}) {
    const raw = String(value ?? "").trim();
    if (!raw && options.optional) return;
    if (!allowed.has(raw)) throw new Error(`${label}: недопустимое значение.`);
  }

  function validateImportDataImage(value, label, usage) {
    if (typeof value !== "string" || !value) return;
    if (value.length > BACKUP_IMPORT_MAX_DATA_URL_CHARS) throw new Error(`${label}: изображение слишком большое.`);
    if (!isDataImage(value)) throw new Error(`${label}: неподдерживаемый тип изображения.`);
    usage.totalDataUrlChars += value.length;
    if (usage.totalDataUrlChars > BACKUP_IMPORT_MAX_TOTAL_DATA_URL_CHARS) {
      throw new Error("В бэкапе слишком много встроенных изображений для безопасного импорта.");
    }
  }

  function createExternalAssetImportController(options = {}) {
    const collectVisualSettingsHolders = typeof options.collectVisualSettingsHolders === "function"
      ? options.collectVisualSettingsHolders
      : () => [];
    const getDirectoryHandle = typeof options.getDirectoryHandle === "function"
      ? options.getDirectoryHandle
      : () => null;
    const setDirectoryHandle = typeof options.setDirectoryHandle === "function"
      ? options.setDirectoryHandle
      : () => {};
    const supportsExternalFolderSave = typeof options.supportsExternalFolderSave === "function"
      ? options.supportsExternalFolderSave
      : () => false;
    const verifyPermission = typeof options.verifyPermission === "function"
      ? options.verifyPermission
      : async () => false;
    const pickDirectory = typeof options.pickDirectory === "function"
      ? options.pickDirectory
      : async () => null;
    const readBlobByPath = typeof options.readBlobByPath === "function"
      ? options.readBlobByPath
      : async () => { throw new Error("Не удалось прочитать внешний файл."); };
    const createRichContentAdapter = typeof options.createRichContentAdapter === "function"
      ? options.createRichContentAdapter
      : () => ({ images: [], serialize: () => "" });
    const notify = typeof options.notify === "function" ? options.notify : () => {};
    const warn = typeof options.warn === "function" ? options.warn : () => {};

    function hasExternalAssets(incoming) {
      return stateHasExternalAssets(incoming, { collectVisualSettingsHolders });
    }

    async function getImportAssetDirectoryHandle(incoming) {
      if (!hasExternalAssets(incoming)) return null;
      const currentHandle = getDirectoryHandle();
      if (currentHandle) {
        try {
          const ok = await verifyPermission(currentHandle, false);
          if (ok) return currentHandle;
        } catch {}
      }
      if (!supportsExternalFolderSave()) return null;
      notify("Нужна папка с картинками", "Выбери папку старого бэкапа, внутри которой лежат zeter-os-state.json и zeter-os-assets.");
      try {
        const picked = await pickDirectory();
        const ok = await verifyPermission(picked, false);
        if (!ok) return null;
        setDirectoryHandle(picked);
        return picked;
      } catch (error) {
        warn("[ZeTer OS import assets folder]", error);
        return null;
      }
    }

    async function hydrateExternalAssets(incoming) {
      const rootHandle = await getImportAssetDirectoryHandle(incoming);
      let total = 0;
      let restored = 0;
      let missing = 0;
      const fs = incoming?.fs || {};
      if (!rootHandle && hasExternalAssets(incoming)) {
        throw new Error("Для этого бэкапа нужна папка zeter-os-assets с картинками.");
      }

      for (const holder of collectVisualSettingsHolders(incoming)) {
        const wallpaper = holder.settings?.customWallpaper;
        const wallpaperPath = wallpaper?.externalWallpaper?.path || wallpaper?.path;
        if (wallpaperPath && !isDataImage(wallpaper.dataURL)) {
          total++;
          try {
            const file = await readBlobByPath(rootHandle, wallpaperPath);
            wallpaper.dataURL = await blobToDataURL(file);
            wallpaper.mime = wallpaper.mime || file.type || wallpaper.externalWallpaper?.mime;
            wallpaper.size = wallpaper.size || file.size || 0;
            restored++;
          } catch (error) {
            warn("[ZeTer OS wallpaper restore]", wallpaperPath, error);
            missing++;
          }
        }
      }

      for (const desktop of incoming?.desktops || []) {
        const icon = desktop?.icon;
        const iconPath = icon?.externalDesktopIcon?.path || icon?.path;
        if (iconPath && !isDataImage(icon.dataURL)) {
          total++;
          try {
            const file = await readBlobByPath(rootHandle, iconPath);
            icon.dataURL = await blobToDataURL(file);
            icon.mime = icon.mime || file.type || icon.externalDesktopIcon?.mime;
            icon.size = icon.size || file.size || 0;
            restored++;
          } catch (error) {
            warn("[ZeTer OS desktop icon restore]", iconPath, error);
            missing++;
          }
        }
      }

      for (const item of Object.values(fs)) {
        if (!item) continue;

        const imagePath = item.externalImage?.path;
        if (imagePath && !isDataImage(item.dataURL)) {
          total++;
          try {
            const file = await readBlobByPath(rootHandle, imagePath);
            item.dataURL = await blobToDataURL(file);
            item.mime = item.mime || file.type || item.externalImage.mime;
            restored++;
          } catch (error) {
            warn("[ZeTer OS image restore]", imagePath, error);
            missing++;
          }
        }

        if (typeof item.richContent === "string" && /(?:data-zeter-external-src|zeter-os-assets\/images)/i.test(item.richContent)) {
          const adapter = createRichContentAdapter(item.richContent);
          let changed = false;
          for (const image of adapter.images || []) {
            const path = image.getAttribute("data-zeter-external-src") || image.getAttribute("src") || "";
            if (!isExternalAssetPath(path)) continue;
            total++;
            try {
              const file = await readBlobByPath(rootHandle, path);
              image.setAttribute("src", await blobToDataURL(file));
              restored++;
              changed = true;
            } catch (error) {
              warn("[ZeTer OS editor image restore]", path, error);
              missing++;
            }
          }
          if (changed) item.richContent = adapter.serialize();
        }
      }

      return { total, restored, missing };
    }

    return Object.freeze({
      hasExternalAssets,
      getImportAssetDirectoryHandle,
      hydrateExternalAssets
    });
  }

  async function runOsImportAction(event, options = {}) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (!file) return null;
    const validateImportedState = typeof options.validateImportedState === "function"
      ? options.validateImportedState
      : value => value;
    const hydrateExternalAssets = typeof options.hydrateExternalAssets === "function"
      ? options.hydrateExternalAssets
      : async () => ({ total: 0, restored: 0, missing: 0 });
    const replaceState = typeof options.replaceState === "function" ? options.replaceState : () => {};
    const saveState = typeof options.saveState === "function" ? options.saveState : async () => {};
    const notify = typeof options.notify === "function" ? options.notify : () => {};
    const scheduleReload = typeof options.scheduleReload === "function" ? options.scheduleReload : () => {};
    const logError = typeof options.logError === "function" ? options.logError : () => {};
    const preflightImport = typeof options.preflightImport === "function" ? options.preflightImport : async () => ({ approved: true });
    const createSafetyPoint = typeof options.createSafetyPoint === "function" ? options.createSafetyPoint : async () => null;
    const requireSafetyPoint = options.requireSafetyPoint === true;
    const captureCurrentState = typeof options.captureCurrentState === "function" ? options.captureCurrentState : () => null;
    const rollbackState = typeof options.rollbackState === "function" ? options.rollbackState : () => {};
    const verifyAppliedState = typeof options.verifyAppliedState === "function" ? options.verifyAppliedState : async () => true;
    const onImported = typeof options.onImported === "function" ? options.onImported : async () => {};
    const onImportFailed = typeof options.onImportFailed === "function" ? options.onImportFailed : async () => {};
    let previousState = null;
    let replaced = false;

    try {
      const data = await readSavedOsDataFile(file, {
        requestPassphrase: options.requestPassphrase,
        decryptBackupBlob: options.decryptBackupBlob
      });
      const incoming = validateImportedState(data.state || data);
      const backupMetadata = data?.__zeterBackup || {};
      const preflight = await preflightImport(incoming, { file, data, backupMetadata });
      if (preflight === false || preflight?.approved === false) return { ok: false, cancelled: true, preflight };
      const assetReport = await hydrateExternalAssets(incoming);
      if (assetReport?.missing) {
        throw new Error(`Не найдены картинки из бэкапа: ${assetReport.missing}. Проверь, что рядом с JSON есть папка zeter-os-assets с изображениями, обоями и иконками, и выбери папку старого бэкапа целиком.`);
      }
      previousState = captureCurrentState();
      const safetyPoint = await createSafetyPoint({ file, incoming, backupMetadata, preflight });
      if (requireSafetyPoint && !safetyPoint) {
        throw new Error("Импорт остановлен: не удалось создать аварийную точку текущего состояния.");
      }
      replaceState(incoming);
      replaced = true;
      await saveState();
      const appliedOk = await verifyAppliedState(incoming);
      if (appliedOk === false) throw new Error("Новое состояние записано, но не прошло контрольное чтение.");
      const imageText = assetReport?.total
        ? ` Картинки восстановлены: ${assetReport.restored}/${assetReport.total}.`
        : "";
      await onImported({ file, incoming, backupMetadata, preflight, assetReport, safetyPoint });
      notify("Импорт проверен и выполнен", `Состояние ZeTer OS восстановлено.${imageText} Перед заменой создана аварийная точка.`);
      scheduleReload();
      return { ok: true, assetReport, preflight, backupMetadata, safetyPoint };
    } catch (error) {
      logError(error);
      let rolledBack = false;
      if (replaced && previousState) {
        try {
          rollbackState(previousState);
          await saveState();
          rolledBack = true;
        } catch (rollbackError) {
          logError(rollbackError);
        }
      }
      await onImportFailed(error, { rolledBack });
      if (error?.cancelled) return { ok: false, cancelled: true, error };
      notify(
        rolledBack ? "Импорт отменён, старые данные возвращены" : "Ошибка импорта",
        error?.message && error.message !== "bad"
          ? error.message
          : "Файл не похож на резервную копию ZeTer OS."
      );
      return { ok: false, error };
    } finally {
      input.value = "";
    }
  }

  window.ZETER_IMPORT_UTILS = Object.freeze({
    assertImportFileSize,
    parseBackupJsonText,
    parseBackupJsonBytes,
    attachBackupMetadata,
    readSavedOsDataFile,
    validateImportArrayLimit,
    validateImportString,
    validateImportSafeId,
    validateImportEnum,
    validateImportDataImage,
    createExternalAssetImportController,
    runOsImportAction
  });
})();
