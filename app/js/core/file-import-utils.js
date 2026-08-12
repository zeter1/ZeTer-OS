(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const coreUtils = window.ZETER_CORE_UTILS;
  const assetUtils = window.ZETER_ASSET_UTILS;
  if (!config || !coreUtils || !assetUtils) throw new Error("ZeTer OS file import utils require config, core and asset utils.");

  const {
    NATIVE_IMPORT_MAX_FILES,
    NATIVE_IMPORT_MAX_TOTAL_READ_BYTES,
    NATIVE_IMPORT_MAX_IMAGE_BYTES,
    NATIVE_IMPORT_MAX_TEXT_BYTES
  } = config;
  const { bytesToHuman } = coreUtils;
  const { normalizeMimeType, extensionImageMime, imageMimeAllowed } = assetUtils;

  function nativeFileMime(file) {
    return normalizeMimeType(file?.type) || extensionImageMime(file?.name || "");
  }

  function isNativeImageCandidate(file) {
    const name = String(file?.name || "");
    return String(file?.type || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name);
  }

  function isSupportedNativeImage(file) {
    return isNativeImageCandidate(file) && imageMimeAllowed(nativeFileMime(file));
  }

  function isNativeTextCandidate(file) {
    const name = String(file?.name || "");
    return String(file?.type || "").startsWith("text/") || /\.(txt|md|json|csv|html|css|js)$/i.test(name);
  }

  function prepareNativeFilesForImport(fileList) {
    const source = Array.from(fileList || []);
    const files = [];
    const skipped = [];
    let readableBytes = 0;

    if (source.length > NATIVE_IMPORT_MAX_FILES) {
      skipped.push(`выбрано больше ${NATIVE_IMPORT_MAX_FILES} файлов`);
    }

    source.slice(0, NATIVE_IMPORT_MAX_FILES).forEach(file => {
      const size = Number(file?.size || 0);
      const name = file?.name || "файл";
      const isImage = isNativeImageCandidate(file);
      const isText = isNativeTextCandidate(file);
      const readBytes = isSupportedNativeImage(file) || isText ? size : 0;

      if (isImage && !isSupportedNativeImage(file)) {
        skipped.push(`${name}: неподдерживаемый тип изображения`);
        return;
      }
      if (isSupportedNativeImage(file) && size > NATIVE_IMPORT_MAX_IMAGE_BYTES) {
        skipped.push(`${name}: изображение больше ${bytesToHuman(NATIVE_IMPORT_MAX_IMAGE_BYTES)}`);
        return;
      }
      if (isText && size > NATIVE_IMPORT_MAX_TEXT_BYTES) {
        skipped.push(`${name}: текстовый файл больше ${bytesToHuman(NATIVE_IMPORT_MAX_TEXT_BYTES)}`);
        return;
      }
      if (readBytes && readableBytes + readBytes > NATIVE_IMPORT_MAX_TOTAL_READ_BYTES) {
        skipped.push(`${name}: превышен общий лимит импортируемого содержимого`);
        return;
      }

      readableBytes += readBytes;
      files.push(file);
    });

    return { files, skipped };
  }

  function nativeImportSkippedSummary(skipped = [], limit = 3) {
    if (!Array.isArray(skipped) || !skipped.length) return "";
    const visibleLimit = Math.max(1, Number(limit) || 3);
    const details = skipped.slice(0, visibleLimit).join("; ");
    return `${skipped.length}: ${details}${skipped.length > visibleLimit ? "…" : ""}`;
  }

  function nativeImportReadMode(file) {
    if (isSupportedNativeImage(file)) return "image";
    if (isNativeTextCandidate(file)) return "text";
    return "binary";
  }

  function nativeImportBaseItem(file, options = {}) {
    const now = Number(options.now || Date.now());
    return {
      id: options.id || "",
      name: options.name || file?.name || "Файл",
      parent: options.parent || "desktop",
      x: Number(options.x) || 0,
      y: Number(options.y) || 0,
      createdAt: now,
      updatedAt: now,
      size: Number(file?.size || 0),
      mime: nativeFileMime(file) || file?.type || "application/octet-stream"
    };
  }

  function unsupportedImageImportContent(file = {}) {
    return `Изображение не импортировано: ${file.name}\nТип: ${file.type || "неизвестно"}\n\nZeTer OS поддерживает PNG, JPEG, WebP, GIF и BMP.`;
  }

  function imageReadErrorContent(file = {}) {
    return `Не удалось прочитать изображение: ${file.name}`;
  }

  function textReadErrorContent(file = {}) {
    return `Не удалось прочитать текстовый файл: ${file.name}`;
  }

  function binaryPlaceholderContent(file = {}) {
    return `Импортированный файл: ${file.name}\nТип: ${file.type || "неизвестно"}\nРазмер: ${file.size} байт\n\nБинарные файлы ZeTer OS хранит как карточку-заглушку. Текстовые файлы и изображения импортируются с содержимым.`;
  }

  function nativeBinaryImportItem(base = {}, file = {}) {
    return { ...base, type: "text", content: binaryPlaceholderContent(file) };
  }

  function nativeImageImportItem(base = {}, file = {}, rawDataUrl = "", helpers = {}) {
    const normalizeDataUrl = typeof helpers.dataUrlWithMime === "function"
      ? helpers.dataUrlWithMime
      : value => String(value || "");
    const isDataImage = typeof helpers.isDataImage === "function" ? helpers.isDataImage : () => true;
    const dataURL = normalizeDataUrl(String(rawDataUrl || ""), nativeFileMime(file));
    if (!isDataImage(dataURL)) {
      return { ...base, type: "text", content: unsupportedImageImportContent(file) };
    }
    return { ...base, type: "image", dataURL, content: "" };
  }

  function nativeImportReadErrorItem(base = {}, file = {}, mode = "") {
    const content = mode === "image" ? imageReadErrorContent(file) : textReadErrorContent(file);
    return { ...base, type: "text", content };
  }

  function readNativeFileContent(file, mode = "", handlers = {}) {
    if (!["image", "text"].includes(mode)) return false;
    const reader = new FileReader();
    reader.onload = () => handlers.onload?.(String(reader.result || ""));
    reader.onerror = () => handlers.onerror?.();
    if (mode === "image") reader.readAsDataURL(file);
    else reader.readAsText(file);
    return true;
  }

  function nativeTextImportItem(base = {}, file = {}, text = "", helpers = {}) {
    const lower = String(file.name || "").toLowerCase();
    if (lower.endsWith(".csv") && helpers.parseCSVRows && helpers.normalizeTableData && helpers.spreadsheetColumnName) {
      const rows = helpers.parseCSVRows(text).filter(row => row.some(cell => String(cell || "").trim()));
      const colCount = Math.max(1, ...rows.map(row => row.length));
      return {
        ...base,
        type: "table",
        table: helpers.normalizeTableData({
          rows,
          columns: Array.from({ length: colCount }, (_, index) => helpers.spreadsheetColumnName(index))
        }),
        content: text,
        extension: "csv"
      };
    }
    const isMarkdown = lower.endsWith(".md");
    return {
      ...base,
      type: isMarkdown ? "markdown" : "text",
      content: text,
      richContent: isMarkdown ? "" : (helpers.plainToRichHtml ? helpers.plainToRichHtml(text) : ""),
      extension: lower.split(".").pop()
    };
  }

  function importNativeFilesBatch(fileList, options = {}) {
    const prepared = prepareNativeFilesForImport(fileList);
    const files = prepared.files;
    const parent = options.parent || "desktop";
    const x = Number(options.x || 0);
    const y = Number(options.y || 0);
    if (prepared.skipped.length) options.onSkipped?.(prepared.skipped);
    if (!files.length) return { files, skipped: prepared.skipped, total: 0 };

    const uid = typeof options.uid === "function" ? options.uid : prefix => `${prefix || "file"}_${Date.now()}`;
    const uniqueName = typeof options.uniqueName === "function" ? options.uniqueName : name => String(name || "Файл");
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const findFreeDesktopPosition = typeof options.findFreeDesktopPosition === "function" ? options.findFreeDesktopPosition : () => ({ x, y });
    const findFreeFolderPosition = typeof options.findFreeFolderPosition === "function" ? options.findFreeFolderPosition : () => ({ x, y });
    const importHelpers = options.helpers || {};
    let imported = 0;

    const finish = (id, item) => {
      imported += 1;
      options.onItem?.(id, item);
      options.onProgress?.({ id, item, imported, total: files.length });
      if (imported === files.length) options.onComplete?.({ imported, total: files.length });
    };

    files.forEach((file, index) => {
      const id = uid("file");
      const pos = isDesktopRoot(parent)
        ? findFreeDesktopPosition(parent, (x || 80) + index * 118, y || 80, id)
        : findFreeFolderPosition(parent, (x || 48) + index * 18, (y || 48) + index * 18, id);
      const base = nativeImportBaseItem(file, {
        id,
        name: uniqueName(file.name, parent),
        parent,
        x: pos.x,
        y: pos.y
      });
      const readMode = nativeImportReadMode(file);
      if (readMode === "image") {
        const reading = readNativeFileContent(file, readMode, {
          onload: result => finish(id, nativeImageImportItem(base, file, result, importHelpers)),
          onerror: () => finish(id, nativeImportReadErrorItem(base, file, readMode))
        });
        if (!reading) finish(id, nativeImportReadErrorItem(base, file, readMode));
      } else if (readMode === "text") {
        const reading = readNativeFileContent(file, readMode, {
          onload: text => finish(id, nativeTextImportItem(base, file, text, importHelpers)),
          onerror: () => finish(id, nativeImportReadErrorItem(base, file, readMode))
        });
        if (!reading) finish(id, nativeImportReadErrorItem(base, file, readMode));
      } else {
        finish(id, nativeBinaryImportItem(base, file));
      }
    });

    return { files, skipped: prepared.skipped, total: files.length };
  }

  window.ZETER_FILE_IMPORT_UTILS = Object.freeze({
    nativeFileMime,
    isNativeImageCandidate,
    isSupportedNativeImage,
    isNativeTextCandidate,
    prepareNativeFilesForImport,
    nativeImportSkippedSummary,
    nativeImportReadMode,
    nativeImportBaseItem,
    unsupportedImageImportContent,
    imageReadErrorContent,
    textReadErrorContent,
    binaryPlaceholderContent,
    nativeBinaryImportItem,
    nativeImageImportItem,
    nativeImportReadErrorItem,
    readNativeFileContent,
    nativeTextImportItem,
    importNativeFilesBatch
  });
})();
