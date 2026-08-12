(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS config is not loaded.");

  const {
    BACKUP_IMPORT_MAX_ZIP_ENTRIES,
    ALLOWED_IMAGE_MIME_TYPES: ALLOWED_IMAGE_MIME_TYPE_LIST
  } = config;

  const ALLOWED_IMAGE_MIME_TYPES = new Set(ALLOWED_IMAGE_MIME_TYPE_LIST);
  const EXTERNAL_ASSET_ROOT = "zeter-os-assets";
  const EXTERNAL_IMAGE_ROOT = `${EXTERNAL_ASSET_ROOT}/images`;
  const EXTERNAL_WALLPAPER_ROOT = `${EXTERNAL_ASSET_ROOT}/wallpapers`;
  const EXTERNAL_DESKTOP_ICON_ROOT = `${EXTERNAL_ASSET_ROOT}/desktop-icons`;

  function cloneForBackup(value) {
    try { return structuredClone(value); }
    catch { return JSON.parse(JSON.stringify(value)); }
  }

  function normalizeMimeType(mime = "") {
    return String(mime || "").split(";")[0].trim().toLowerCase();
  }

  function imageMimeAllowed(mime = "", allowed = ALLOWED_IMAGE_MIME_TYPES) {
    const clean = normalizeMimeType(mime);
    if (!clean) return false;
    return allowed.has(clean) || (clean === "image/jpg" && allowed.has("image/jpeg"));
  }

  function extensionImageMime(name = "") {
    const ext = String(name || "").split(".").pop().toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "bmp") return "image/bmp";
    return "";
  }

  function isDataImage(src, allowed = ALLOWED_IMAGE_MIME_TYPES) {
    const match = String(src || "").match(/^data:([^;,]+)(?:;base64)?,/i);
    return Boolean(match && imageMimeAllowed(match[1], allowed));
  }

  function isExternalAssetPath(src) {
    const normalized = String(src || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized.startsWith(EXTERNAL_ASSET_ROOT + "/")) return false;
    const parts = normalized.split("/").filter(Boolean);
    if (parts[0] !== EXTERNAL_ASSET_ROOT || parts.length < 2 || parts.length > 12) return false;
    return parts.every(part => part !== "." && part !== ".." && part.length <= 120 && !/[\0<>:"|?*]/.test(part));
  }

  function stateHasExternalAssets(target = {}, options = {}) {
    const collectVisualSettingsHolders = typeof options.collectVisualSettingsHolders === "function"
      ? options.collectVisualSettingsHolders
      : () => [];
    const hasExternalWallpaper = collectVisualSettingsHolders(target).some(holder => {
      const wallpaper = holder?.settings?.customWallpaper;
      return Boolean((wallpaper?.externalWallpaper?.path || wallpaper?.path) && !isDataImage(wallpaper?.dataURL));
    });
    if (hasExternalWallpaper) return true;

    const hasExternalDesktopIcon = (target?.desktops || []).some(desk => {
      const icon = desk?.icon;
      return Boolean((icon?.externalDesktopIcon?.path || icon?.path) && !isDataImage(icon?.dataURL));
    });
    if (hasExternalDesktopIcon) return true;

    return Object.values(target?.fs || {}).some(item => {
      if (!item) return false;
      if (item.externalImage?.path && !isDataImage(item.dataURL)) return true;
      return typeof item.richContent === "string" && /(?:data-zeter-external-src|zeter-os-assets\/images)/i.test(item.richContent);
    });
  }

  function parseDataUrl(dataURL = "") {
    const match = String(dataURL).match(/^data:([^;,]+)(;base64)?,(.*)$/i);
    if (!match) return null;
    return { mime: match[1] || "application/octet-stream", body: match[3] || "", base64: !!match[2] };
  }

  function mimeToExtension(mime = "", fallback = "png") {
    const m = String(mime).toLowerCase();
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
    if (m.includes("png")) return "png";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    if (m.includes("bmp")) return "bmp";
    return fallback;
  }

  function sanitizePathPart(name = "file") {
    const cleaned = String(name || "file")
      .replace(/\.[a-z0-9]{1,6}$/i, "")
      .replace(/[\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 70);
    return cleaned || "file";
  }

  function safeRelativePathParts(path = "") {
    const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (!parts.length) throw new Error("Некорректный путь файла.");
    if (parts.length > 16 || parts.some(part => part === "." || part === ".." || part.length > 120 || /[\0<>:"|?*]/.test(part))) {
      throw new Error("Небезопасный путь файла.");
    }
    return parts;
  }

  function dataUrlToBlob(dataURL) {
    const parsed = parseDataUrl(dataURL);
    if (!parsed) throw new Error("Не удалось прочитать изображение.");
    if (!imageMimeAllowed(parsed.mime)) throw new Error("Этот тип изображения не поддерживается.");
    if (!parsed.base64) return new Blob([decodeURIComponent(parsed.body)], { type: parsed.mime });
    const binary = atob(parsed.body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: parsed.mime });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlByteLength(dataURL = "") {
    const parsed = parseDataUrl(dataURL);
    if (!parsed) return String(dataURL || "").length;
    if (!parsed.base64) return decodeURIComponent(parsed.body || "").length;
    const clean = String(parsed.body || "").replace(/=+$/, "");
    return Math.floor(clean.length * 3 / 4);
  }

  function dataUrlWithMime(dataURL = "", mime = "") {
    const parsed = parseDataUrl(dataURL);
    const safeMime = normalizeMimeType(mime);
    if (!parsed || imageMimeAllowed(parsed.mime) || !imageMimeAllowed(safeMime)) return dataURL;
    return `data:${safeMime}${parsed.base64 ? ";base64" : ""},${parsed.body}`;
  }

  function loadImageFromDataURL(dataURL = "") {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось прочитать изображение обоев."));
      img.src = dataURL;
    });
  }

  async function blobToUint8Array(blob) {
    if (blob instanceof Uint8Array) return blob;
    if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
    if (blob instanceof Blob) return new Uint8Array(await blob.arrayBuffer());
    return new TextEncoder().encode(String(blob ?? ""));
  }

  function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  }

  const CRC32_TABLE = makeCrc32Table();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function bytes16(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255]);
  }

  function bytes32(value) {
    return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  async function createZipBlob(entries = []) {
    const encoder = new TextEncoder();
    const now = dosDateTime();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of entries) {
      const path = String(entry.path || "file").replace(/^\/+/, "");
      const nameBytes = encoder.encode(path);
      const data = await blobToUint8Array(entry.blob ?? entry.data ?? "");
      const crc = crc32(data);
      const localHeader = [
        bytes32(0x04034b50), bytes16(20), bytes16(0x0800), bytes16(0), bytes16(now.time), bytes16(now.day),
        bytes32(crc), bytes32(data.length), bytes32(data.length), bytes16(nameBytes.length), bytes16(0), nameBytes
      ];
      localChunks.push(...localHeader, data);

      const centralHeader = [
        bytes32(0x02014b50), bytes16(20), bytes16(20), bytes16(0x0800), bytes16(0), bytes16(now.time), bytes16(now.day),
        bytes32(crc), bytes32(data.length), bytes32(data.length), bytes16(nameBytes.length), bytes16(0), bytes16(0),
        bytes16(0), bytes16(0), bytes32(0), bytes32(offset), nameBytes
      ];
      centralChunks.push(...centralHeader);
      offset += localHeader.reduce((sum, chunk) => sum + chunk.length, 0) + data.length;
    }

    const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const centralOffset = offset;
    const end = [bytes32(0x06054b50), bytes16(0), bytes16(0), bytes16(entries.length), bytes16(entries.length), bytes32(centralSize), bytes32(centralOffset), bytes16(0)];
    return new Blob([...localChunks, ...centralChunks, ...end], { type: "application/zip" });
  }

  async function inflateZipEntry(bytes) {
    if (!("DecompressionStream" in window)) {
      throw new Error("Браузер не умеет распаковывать сжатые ZIP. Сохрани ZIP без сжатия или импортируй zeter-os-state.json.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readStoredZipEntries(buffer) {
    const view = new DataView(buffer);
    const decoder = new TextDecoder();
    const entries = new Map();
    let offset = 0;
    while (offset + 30 <= buffer.byteLength) {
      const sig = view.getUint32(offset, true);
      if (sig === 0x02014b50 || sig === 0x06054b50) break;
      if (sig !== 0x04034b50) break;
      const method = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.byteLength) break;
      const path = decoder.decode(new Uint8Array(buffer, nameStart, nameLength));
      const normalizedPath = path.replace(/\\/g, "/");
      const pathParts = normalizedPath.split("/").filter(Boolean);
      if (path.length > 240 || normalizedPath.startsWith("/") || pathParts.some(part => part === "." || part === ".." || /[\0<>:"|?*]/.test(part))) throw new Error("ZIP содержит небезопасный путь файла.");
      if (method === 0) entries.set(path, new Uint8Array(buffer.slice(dataStart, dataEnd)));
      else if (method === 8) entries.set(path, await inflateZipEntry(new Uint8Array(buffer.slice(dataStart, dataEnd))));
      else if (!path.endsWith("/")) throw new Error("ZIP использует неподдерживаемый метод сжатия.");
      if (entries.size > BACKUP_IMPORT_MAX_ZIP_ENTRIES) throw new Error("В ZIP слишком много файлов для безопасного импорта.");
      offset = dataEnd;
    }
    return entries;
  }

  async function buildExternalBackupStateModel(target = {}, options = {}) {
    const {
      syncBeforeBackup = () => {},
      saveDataImageAsset = async () => {},
      createRichContentAdapter = () => ({ images: [], serialize: () => "" }),
      fastStringHash = value => String(value || "").length.toString(36),
      pad = value => String(value).padStart(2, "0"),
      collectVisualSettingsHolders = () => [],
      normalizeCustomWallpaper = value => value,
      normalizeDesktopIcon = value => value,
      warn = () => {},
      nowIso = () => new Date().toISOString()
    } = options;
    syncBeforeBackup();
    const backupState = cloneForBackup(target);
    const assets = [];
    const savedAt = nowIso();
    const fs = backupState.fs || {};

    for (const item of Object.values(fs)) {
      if (!item) continue;
      if (item.type === "image" && isDataImage(item.dataURL)) {
        try {
          const parsed = parseDataUrl(item.dataURL) || {};
          const ext = mimeToExtension(parsed.mime, (String(item.name).split(".").pop() || "png"));
          const fileName = `${sanitizePathPart(item.id)}_${sanitizePathPart(item.name)}.${ext}`;
          const path = `${EXTERNAL_IMAGE_ROOT}/files/${fileName}`;
          await saveDataImageAsset(path, item.dataURL);
          item.externalImage = { path, mime: parsed.mime || item.mime || `image/${ext}`, originalName: item.name, savedAt };
          delete item.dataURL;
          assets.push({ kind: "file-image", itemId: item.id, path, mime: item.externalImage.mime, name: item.name });
        } catch (err) {
          warn("[ZeTer OS image backup]", item.name, err);
          item.externalImageError = String(err?.message || err);
        }
      }

      if (typeof item.richContent === "string" && item.richContent.includes("data:image/")) {
        const adapter = createRichContentAdapter(item.richContent);
        let changed = false;
        let index = 0;
        for (const image of adapter.images || []) {
          const src = image.getAttribute("src") || "";
          if (!isDataImage(src)) continue;
          try {
            const parsed = parseDataUrl(src) || {};
            const ext = mimeToExtension(parsed.mime, "png");
            const hash = fastStringHash(src);
            const fileName = `img_${pad(index + 1)}_${hash}.${ext}`;
            const path = `${EXTERNAL_IMAGE_ROOT}/editor/${sanitizePathPart(item.id)}/${fileName}`;
            await saveDataImageAsset(path, src);
            image.setAttribute("src", path);
            image.setAttribute("data-zeter-external-src", path);
            image.setAttribute("data-zeter-mime", parsed.mime || `image/${ext}`);
            assets.push({ kind: "editor-image", itemId: item.id, path, mime: parsed.mime || `image/${ext}`, name: item.name });
            changed = true;
            index++;
          } catch (err) {
            warn("[ZeTer OS editor image backup]", item.name, err);
          }
        }
        if (changed) item.richContent = adapter.serialize();
      }
    }

    for (const holder of collectVisualSettingsHolders(backupState)) {
      const wallpaper = normalizeCustomWallpaper(holder.settings.customWallpaper);
      if (!wallpaper || !isDataImage(wallpaper.dataURL)) continue;
      try {
        const parsed = parseDataUrl(wallpaper.dataURL) || {};
        const ext = mimeToExtension(parsed.mime || wallpaper.mime, "jpg");
        const hash = fastStringHash(wallpaper.dataURL);
        const fileName = `${sanitizePathPart(holder.desktopId)}_${sanitizePathPart(wallpaper.name)}_${hash}.${ext}`;
        const path = `${EXTERNAL_WALLPAPER_ROOT}/${fileName}`;
        await saveDataImageAsset(path, wallpaper.dataURL);
        holder.settings.customWallpaper = {
          ...wallpaper,
          mime: parsed.mime || wallpaper.mime || `image/${ext}`,
          externalWallpaper: { path, mime: parsed.mime || wallpaper.mime || `image/${ext}`, originalName: wallpaper.name, savedAt }
        };
        delete holder.settings.customWallpaper.dataURL;
        assets.push({ kind: "custom-wallpaper", desktopId: holder.desktopId, path, mime: holder.settings.customWallpaper.mime, name: wallpaper.name });
      } catch (err) {
        warn("[ZeTer OS wallpaper backup]", wallpaper.name, err);
        holder.settings.customWallpaperError = String(err?.message || err);
      }
    }

    for (const desktop of backupState.desktops || []) {
      const icon = normalizeDesktopIcon(desktop.icon);
      if (!icon || !isDataImage(icon.dataURL)) continue;
      try {
        const parsed = parseDataUrl(icon.dataURL) || {};
        const ext = mimeToExtension(parsed.mime || icon.mime, "png");
        const hash = fastStringHash(icon.dataURL);
        const fileName = `${sanitizePathPart(desktop.id)}_${sanitizePathPart(icon.name)}_${hash}.${ext}`;
        const path = `${EXTERNAL_DESKTOP_ICON_ROOT}/${fileName}`;
        await saveDataImageAsset(path, icon.dataURL);
        desktop.icon = {
          ...icon,
          mime: parsed.mime || icon.mime || `image/${ext}`,
          externalDesktopIcon: { path, mime: parsed.mime || icon.mime || `image/${ext}`, originalName: icon.name, savedAt }
        };
        delete desktop.icon.dataURL;
        assets.push({ kind: "desktop-icon", desktopId: desktop.id, path, mime: desktop.icon.mime, name: icon.name });
      } catch (err) {
        warn("[ZeTer OS desktop icon backup]", desktop.name, err);
        desktop.iconBackupError = String(err?.message || err);
      }
    }

    backupState.externalAssets = { root: EXTERNAL_ASSET_ROOT, savedAt, count: assets.length };
    return { state: backupState, assets };
  }

  async function clearDirectoryByPathModel(rootHandle, path, options = {}) {
    const getDirectoryByPath = typeof options.getDirectoryByPath === "function" ? options.getDirectoryByPath : null;
    const warn = typeof options.warn === "function" ? options.warn : () => {};
    try {
      if (!getDirectoryByPath) return;
      const directory = await getDirectoryByPath(rootHandle, String(path).split("/").filter(Boolean), true);
      if (!directory || !directory.entries || !directory.removeEntry) return;
      for await (const [name] of directory.entries()) {
        try { await directory.removeEntry(name, { recursive: true }); } catch {}
      }
    } catch (error) {
      warn("[ZeTer OS clear export folder]", path, error);
    }
  }

  function createExternalAssetIoController(options = {}) {
    const getRootHandle = typeof options.getRootHandle === "function" ? options.getRootHandle : () => null;
    const warn = typeof options.warn === "function" ? options.warn : () => {};

    async function getDirectoryByPath(rootHandle, parts, create = false) {
      let directory = rootHandle;
      for (const part of (Array.isArray(parts) ? parts : []).filter(Boolean)) {
        directory = await directory.getDirectoryHandle(part, { create });
      }
      return directory;
    }

    async function writeBlobByPath(rootHandle, path, blob) {
      const parts = safeRelativePathParts(path);
      const fileName = parts.pop();
      const directory = await getDirectoryByPath(rootHandle, parts, true);
      const fileHandle = await directory.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    }

    async function readBlobByPath(rootHandle, path) {
      const parts = safeRelativePathParts(path);
      const fileName = parts.pop();
      const directory = await getDirectoryByPath(rootHandle, parts, false);
      const fileHandle = await directory.getFileHandle(fileName, { create: false });
      return fileHandle.getFile();
    }

    async function saveDataImageAsset(path, dataURL) {
      return writeBlobByPath(getRootHandle(), path, dataUrlToBlob(dataURL));
    }

    async function clearDirectory(rootHandle, path) {
      return clearDirectoryByPathModel(rootHandle, path, { getDirectoryByPath, warn });
    }

    async function writeEntries(rootHandle, rootPath, entries = []) {
      await clearDirectory(rootHandle, rootPath);
      for (const entry of Array.isArray(entries) ? entries : []) {
        await writeBlobByPath(rootHandle, `${rootPath}/${entry.path}`, entry.blob);
      }
    }

    return Object.freeze({
      getDirectoryByPath,
      writeBlobByPath,
      readBlobByPath,
      saveDataImageAsset,
      clearDirectory,
      writeEntries
    });
  }

  window.ZETER_ASSET_UTILS = Object.freeze({
    EXTERNAL_ASSET_ROOT,
    EXTERNAL_IMAGE_ROOT,
    EXTERNAL_WALLPAPER_ROOT,
    EXTERNAL_DESKTOP_ICON_ROOT,
    cloneForBackup,
    normalizeMimeType,
    imageMimeAllowed,
    extensionImageMime,
    isDataImage,
    isExternalAssetPath,
    stateHasExternalAssets,
    parseDataUrl,
    mimeToExtension,
    sanitizePathPart,
    safeRelativePathParts,
    dataUrlToBlob,
    blobToDataURL,
    dataUrlByteLength,
    dataUrlWithMime,
    loadImageFromDataURL,
    blobToUint8Array,
    makeCrc32Table,
    crc32,
    bytes16,
    bytes32,
    dosDateTime,
    createZipBlob,
    inflateZipEntry,
    readStoredZipEntries,
    buildExternalBackupStateModel,
    clearDirectoryByPathModel,
    createExternalAssetIoController
  });
})();
