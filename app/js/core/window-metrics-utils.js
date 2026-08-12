(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS window metrics utils require core utils.");

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
    if (windowRectNeedsStandardSize(rect)) return standard;
    return {
      left: rect.left || standard.left,
      top: rect.top || standard.top,
      width: rect.width || standard.width,
      height: rect.height || standard.height
    };
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
    normalizeOpeningWindowRect
  });
})();
