(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const systemSettingsUtils = window.ZETER_SYSTEM_SETTINGS_UTILS;
  if (!coreUtils || !systemSettingsUtils) throw new Error("ZeTer OS window metrics utils require core and system settings utils.");

  const { $, clamp } = coreUtils;

  const STANDARD_WINDOW_TOP_OVERLAP = 14;
  const STANDARD_WINDOW_SIDE_GAP = 0;
  const STANDARD_WINDOW_MIN_FILL = 0.88;

  function cssNumberVar(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const value = parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function topMenuHeight() {
    return cssNumberVar("--topbar", 0);
  }

  function taskbarSpace() {
    const taskbar = $("#taskbar") || $(".taskbar");
    if (!taskbar) return cssNumberVar("--taskbar", 84);
    const rect = taskbar.getBoundingClientRect();
    const space = window.innerHeight - rect.top;
    return Number.isFinite(space) && space > 0 ? space : cssNumberVar("--taskbar", 84);
  }

  function availableWindowHeight() {
    const layer = $("#window-layer");
    if (layer && layer.clientHeight) return layer.clientHeight;
    return Math.max(240, window.innerHeight - topMenuHeight() - taskbarSpace());
  }

  function windowMetricToPx(value, axis = "x") {
    if (value == null || value === "") return NaN;
    if (typeof value === "number") return value;
    const raw = String(value).trim();
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) return NaN;
    if (raw.endsWith("vw")) return window.innerWidth * num / 100;
    if (raw.endsWith("vh")) return window.innerHeight * num / 100;
    if (raw.endsWith("%")) {
      return (axis === "y" ? availableWindowHeight() : window.innerWidth) * num / 100;
    }
    return num;
  }

  function standardWindowRect() {
    const viewportW = Math.max(330, window.innerWidth || document.documentElement.clientWidth || 1280);
    const areaH = availableWindowHeight();
    const topOverlap = Math.min(STANDARD_WINDOW_TOP_OVERLAP, Math.max(0, topMenuHeight() - 6));
    const width = Math.max(330, Math.round(viewportW - STANDARD_WINDOW_SIDE_GAP * 2));
    const height = Math.max(240, Math.round(areaH + topOverlap));
    return {
      left: `${STANDARD_WINDOW_SIDE_GAP}px`,
      top: `-${topOverlap}px`,
      width: `${width}px`,
      height: `${height}px`
    };
  }

  function windowRectNeedsStandardSize(rect = null) {
    if (!rect) return true;
    const standard = standardWindowRect();
    const width = windowMetricToPx(rect.width, "x");
    const height = windowMetricToPx(rect.height, "y");
    const standardWidth = windowMetricToPx(standard.width, "x");
    const standardHeight = windowMetricToPx(standard.height, "y");
    if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
    return width < standardWidth * STANDARD_WINDOW_MIN_FILL || height < standardHeight * STANDARD_WINDOW_MIN_FILL;
  }

  function normalizeOpeningWindowRect(rect = null) {
    const standard = standardWindowRect();
    if (!rect) return standard;
    const rawWidth = windowMetricToPx(rect.width, "x");
    const rawHeight = windowMetricToPx(rect.height, "y");
    if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) return standard;
    const width = clamp(rawWidth, 330, parseFloat(standard.width));
    const height = clamp(rawHeight, 240, parseFloat(standard.height));
    const left = windowMetricToPx(rect.left, "x");
    const top = windowMetricToPx(rect.top, "y");
    const minTop = parseFloat(standard.top);
    return {
      left: `${clamp(Number.isFinite(left) ? left : 0, 0, parseFloat(standard.width) - width)}px`,
      top: `${clamp(Number.isFinite(top) ? top : minTop, minTop, minTop + parseFloat(standard.height) - height)}px`,
      width: `${width}px`,
      height: `${height}px`
    };
  }

  function openingWindowRect(size = "full") {
    const standard = standardWindowRect();
    const preset = systemSettingsUtils.WINDOW_SIZE_PRESETS.find(item => item.id === size) || systemSettingsUtils.WINDOW_SIZE_PRESETS[0];
    if (preset.scale === 1) return standard;
    const areaW = parseFloat(standard.width);
    const areaH = parseFloat(standard.height);
    const width = Math.max(330, Math.round(areaW * preset.scale));
    const height = Math.max(240, Math.round(areaH * preset.scale));
    return {
      left: `${Math.round((areaW - width) / 2)}px`,
      top: `${parseFloat(standard.top) + Math.round((areaH - height) / 2)}px`,
      width: `${width}px`, height: `${height}px`
    };
  }

  function openingWindowPlacementRect(size = "full", placement = "center", options = {}) {
    const rect = openingWindowRect(size);
    if (placement === "last" && options.lastRect) {
      const left = windowMetricToPx(options.lastRect.left, "x");
      const top = windowMetricToPx(options.lastRect.top, "y");
      if (Number.isFinite(left)) rect.left = `${left}px`;
      if (Number.isFinite(top)) rect.top = `${top}px`;
    } else if (placement === "cascade") {
      const standard = standardWindowRect();
      const roomX = parseFloat(standard.width) - parseFloat(rect.width) - parseFloat(rect.left);
      const roomY = parseFloat(standard.top) + parseFloat(standard.height) - parseFloat(rect.height) - parseFloat(rect.top);
      const positions = Math.max(1, Math.floor(Math.min(roomX, roomY) / 24) + 1);
      const index = Math.max(0, Math.floor(Number(options.cascadeIndex) || 0));
      const offset = (index % positions) * 24;
      rect.left = `${parseFloat(rect.left) + offset}px`;
      rect.top = `${parseFloat(rect.top) + offset}px`;
    }
    return normalizeOpeningWindowRect(rect);
  }

  window.ZETER_WINDOW_METRICS_UTILS = Object.freeze({
    STANDARD_WINDOW_TOP_OVERLAP,
    STANDARD_WINDOW_SIDE_GAP,
    STANDARD_WINDOW_MIN_FILL,
    cssNumberVar,
    topMenuHeight,
    taskbarSpace,
    availableWindowHeight,
    windowMetricToPx,
    standardWindowRect,
    windowRectNeedsStandardSize,
    normalizeOpeningWindowRect,
    openingWindowRect,
    openingWindowPlacementRect
  });
})();
