(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const assetUtils = window.ZETER_ASSET_UTILS;
  if (!coreUtils || !assetUtils) throw new Error("ZeTer OS visual utils require core and asset utils.");

  const { uid, clamp } = coreUtils;
  const {
    imageMimeAllowed,
    extensionImageMime,
    isDataImage,
    isExternalAssetPath,
    parseDataUrl,
    blobToDataURL,
    dataUrlByteLength,
    loadImageFromDataURL
  } = assetUtils;

  const CUSTOM_WALLPAPER_MAX_SOURCE_BYTES = 24 * 1024 * 1024;
  const CUSTOM_WALLPAPER_MAX_DATA_URL_CHARS = 4200000;
  const CUSTOM_WALLPAPER_MAX_WIDTH = 2560;
  const CUSTOM_WALLPAPER_MAX_HEIGHT = 1440;
  const DESKTOP_ICON_MAX_SOURCE_BYTES = 6 * 1024 * 1024;
  const DESKTOP_ICON_MAX_DATA_URL_CHARS = 650000;
  const DESKTOP_ICON_SIZE = 256;

  function baseDesktopSettings() {
    return { theme: "dark", wallpaper: "aurora", accent: "blue", blur: 0, brightness: 100, volume: 74, iconSize: 1 };
  }

  function normalizeDesktopIcon(icon = null) {
    if (!icon || typeof icon !== "object") return null;
    const dataURL = String(icon.dataURL || "");
    const external = icon.externalDesktopIcon && typeof icon.externalDesktopIcon === "object" ? icon.externalDesktopIcon : null;
    const path = String(icon.path || external?.path || "");
    if (!isDataImage(dataURL) && !isExternalAssetPath(path)) return null;

    const clean = {
      name: String(icon.name || icon.originalName || external?.originalName || "Иконка рабочего стола").trim() || "Иконка рабочего стола",
      mime: String(icon.mime || icon.type || external?.mime || "image/png"),
      size: Number(icon.size) || 0,
      originalSize: Number(icon.originalSize) || Number(icon.size) || 0,
      updatedAt: Number(icon.updatedAt) || Date.now()
    };
    if (isDataImage(dataURL)) clean.dataURL = dataURL;
    if (path) {
      clean.externalDesktopIcon = {
        path,
        mime: clean.mime,
        originalName: clean.name,
        savedAt: external?.savedAt || icon.savedAt || ""
      };
    }
    return clean;
  }

  function defaultDesktopDescription() {
    return "У этого рабочего стола свои настройки, задачи, календарь, уведомления и файлы.";
  }

  function normalizeDesktopRecord(desk = {}, index = 0) {
    const record = desk && typeof desk === "object" ? desk : {};
    const fallbackId = index === 0 ? "desktop" : uid("desktop");
    record.id = String(record.id || fallbackId).trim() || fallbackId;
    const fallbackName = record.id === "desktop" ? "Основной" : `Рабочий стол ${index + 1}`;
    record.name = String(record.name || fallbackName).trim() || fallbackName;
    if (record.description === undefined || record.description === null) record.description = defaultDesktopDescription(record.id);
    else record.description = String(record.description).slice(0, 520);
    const icon = normalizeDesktopIcon(record.icon || record.desktopIcon || record.customDesktopIcon);
    if (icon) record.icon = icon;
    else delete record.icon;
    delete record.desktopIcon;
    delete record.customDesktopIcon;
    return record;
  }

  function normalizeCustomWallpaper(wallpaper = null) {
    if (!wallpaper || typeof wallpaper !== "object") return null;
    const dataURL = String(wallpaper.dataURL || "");
    const external = wallpaper.externalWallpaper && typeof wallpaper.externalWallpaper === "object" ? wallpaper.externalWallpaper : null;
    const path = String(wallpaper.path || external?.path || "");
    if (!isDataImage(dataURL) && !isExternalAssetPath(path)) return null;

    const clean = {
      name: String(wallpaper.name || wallpaper.originalName || external?.originalName || "Свои обои").trim() || "Свои обои",
      mime: String(wallpaper.mime || wallpaper.type || external?.mime || "image/jpeg"),
      size: Number(wallpaper.size) || 0,
      originalSize: Number(wallpaper.originalSize) || Number(wallpaper.size) || 0,
      updatedAt: Number(wallpaper.updatedAt) || Date.now()
    };
    if (isDataImage(dataURL)) clean.dataURL = dataURL;
    if (path) {
      clean.externalWallpaper = {
        path,
        mime: clean.mime,
        originalName: clean.name,
        savedAt: external?.savedAt || wallpaper.savedAt || ""
      };
    }
    return clean;
  }

  function collectVisualSettingsHolders(target = {}) {
    const holders = [];
    if (target?.settings) holders.push({ settings: target.settings, desktopId: "desktop", title: "Основной" });
    (target?.desktops || []).forEach(desk => {
      if (desk?.data?.settings) holders.push({ settings: desk.data.settings, desktopId: desk.id || "desktop", title: desk.name || desk.id || "Рабочий стол" });
    });
    return holders;
  }

  function customWallpaperCssUrl(wallpaper = null) {
    const dataURL = wallpaper?.dataURL || "";
    return isDataImage(dataURL) ? `url("${dataURL}")` : "none";
  }

  function normalizeVisualSettings(settings = {}) {
    const clean = settings && typeof settings === "object" ? settings : {};
    clean.theme = "dark";
    clean.blur = 0;
    clean.wallpaper = ["aurora", "silk", "mint", "graphite", "custom"].includes(clean.wallpaper) ? clean.wallpaper : "aurora";
    clean.customWallpaper = normalizeCustomWallpaper(clean.customWallpaper);
    if (!clean.customWallpaper) delete clean.customWallpaper;
    if (clean.wallpaper === "custom" && !clean.customWallpaper) clean.wallpaper = "aurora";
    clean.brightness = 100;
    clean.volume = clamp(Number(clean.volume) || 74, 0, 100);
    return clean;
  }

  function nextWallpaperValue(settings = {}) {
    const list = ["aurora", "silk", "mint", "graphite"];
    if (settings?.customWallpaper?.dataURL) list.push("custom");
    const index = Math.max(0, list.indexOf(settings?.wallpaper));
    return list[(index + 1) % list.length];
  }

  function isSupportedVisualImageFile(file) {
    const lowerName = String(file?.name || "").toLowerCase();
    return imageMimeAllowed(file?.type || extensionImageMime(file?.name || "")) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(lowerName);
  }

  async function optimizeCustomWallpaperDataURL(dataURL = "", sourceMime = "") {
    const mime = String(sourceMime || "").toLowerCase();
    if (/image\/gif/i.test(mime)) return dataURL;

    const img = await loadImageFromDataURL(dataURL);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return dataURL;

    const scale = Math.min(1, CUSTOM_WALLPAPER_MAX_WIDTH / width, CUSTOM_WALLPAPER_MAX_HEIGHT / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    if (scale >= 1 && dataURL.length <= CUSTOM_WALLPAPER_MAX_DATA_URL_CHARS && /image\/(jpe?g|webp)/i.test(mime)) {
      return dataURL;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#080d1c";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const optimized = canvas.toDataURL("image/jpeg", 0.88);
    if (optimized.length < dataURL.length || dataURL.length > CUSTOM_WALLPAPER_MAX_DATA_URL_CHARS) return optimized;
    return dataURL;
  }

  async function createCustomWallpaperFromFile(file) {
    if (!file || !isSupportedVisualImageFile(file)) {
      throw new Error("Выбери файл изображения: PNG, JPG, WebP, GIF или BMP.");
    }
    if (file.size > CUSTOM_WALLPAPER_MAX_SOURCE_BYTES) {
      throw new Error("Файл слишком большой. Выбери изображение до 24 МБ.");
    }

    const originalDataURL = await blobToDataURL(file);
    const dataURL = await optimizeCustomWallpaperDataURL(originalDataURL, file.type || "");
    if (!isDataImage(dataURL)) throw new Error("Не удалось подготовить изображение для обоев.");
    if (dataURL.length > CUSTOM_WALLPAPER_MAX_DATA_URL_CHARS) {
      throw new Error("Обои получились слишком большими для сохранения в браузере. Попробуй изображение меньшего размера.");
    }

    const parsed = parseDataUrl(dataURL) || {};
    return {
      name: file.name || "Свои обои",
      mime: parsed.mime || file.type || "image/jpeg",
      size: dataUrlByteLength(dataURL),
      originalSize: file.size || 0,
      dataURL,
      updatedAt: Date.now()
    };
  }

  async function optimizeDesktopIconDataURL(dataURL = "") {
    const img = await loadImageFromDataURL(dataURL);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) return dataURL;

    const canvas = document.createElement("canvas");
    canvas.width = DESKTOP_ICON_SIZE;
    canvas.height = DESKTOP_ICON_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, DESKTOP_ICON_SIZE, DESKTOP_ICON_SIZE);
    const side = Math.min(width, height);
    const sx = Math.max(0, (width - side) / 2);
    const sy = Math.max(0, (height - side) / 2);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, DESKTOP_ICON_SIZE, DESKTOP_ICON_SIZE);
    return canvas.toDataURL("image/png");
  }

  async function createDesktopIconFromFile(file) {
    if (!file || !isSupportedVisualImageFile(file)) {
      throw new Error("Выбери файл изображения: PNG, JPG, WebP, GIF или BMP.");
    }
    if (file.size > DESKTOP_ICON_MAX_SOURCE_BYTES) {
      throw new Error("Файл иконки слишком большой. Выбери изображение до 6 МБ.");
    }

    const originalDataURL = await blobToDataURL(file);
    const dataURL = await optimizeDesktopIconDataURL(originalDataURL, file.type || "");
    if (!isDataImage(dataURL)) throw new Error("Не удалось подготовить изображение для иконки рабочего стола.");
    if (dataURL.length > DESKTOP_ICON_MAX_DATA_URL_CHARS) {
      throw new Error("Иконка получилась слишком большой для сохранения. Попробуй изображение меньшего размера.");
    }

    const parsed = parseDataUrl(dataURL) || {};
    return {
      name: file.name || "Иконка рабочего стола",
      mime: parsed.mime || "image/png",
      size: dataUrlByteLength(dataURL),
      originalSize: file.size || 0,
      dataURL,
      updatedAt: Date.now()
    };
  }

  window.ZETER_VISUAL_UTILS = Object.freeze({
    baseDesktopSettings,
    normalizeDesktopIcon,
    defaultDesktopDescription,
    normalizeDesktopRecord,
    normalizeCustomWallpaper,
    collectVisualSettingsHolders,
    customWallpaperCssUrl,
    normalizeVisualSettings,
    nextWallpaperValue,
    optimizeCustomWallpaperDataURL,
    createCustomWallpaperFromFile,
    optimizeDesktopIconDataURL,
    createDesktopIconFromFile
  });
})();
