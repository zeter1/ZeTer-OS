(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const windowMetricsUtils = window.ZETER_WINDOW_METRICS_UTILS;
  if (!coreUtils || !windowMetricsUtils) throw new Error("ZeTer OS sticky utils require core and window metrics utils.");

  const { clamp, escapeHtml } = coreUtils;
  const { topMenuHeight, taskbarSpace } = windowMetricsUtils;
  const safeAttr = escapeHtml;

  const STICKY_MIN_W = 220;
  const STICKY_MIN_H = 180;
  const STICKY_DEFAULT_COLOR = "purple";
  const STICKY_DEFAULT_TEXT = "light";
  const STICKY_DEFAULT_FONT_SIZE = 14;
  const STICKY_DEFAULT_OPACITY = 1;
  const STICKY_COLORS = Object.freeze({
    purple: { name: "Фиолетовый", bg: "linear-gradient(155deg, rgba(126,105,255,.78), rgba(76,59,154,.62))" },
    blue: { name: "Синий", bg: "linear-gradient(155deg, rgba(72,151,255,.76), rgba(39,77,148,.62))" },
    mint: { name: "Мятный", bg: "linear-gradient(155deg, rgba(74,211,170,.74), rgba(34,123,106,.62))" },
    yellow: { name: "Жёлтый", bg: "linear-gradient(155deg, rgba(255,218,103,.84), rgba(191,129,35,.68))" },
    pink: { name: "Розовый", bg: "linear-gradient(155deg, rgba(255,126,188,.78), rgba(154,61,118,.62))" },
    graphite: { name: "Графит", bg: "linear-gradient(155deg, rgba(84,90,122,.82), rgba(32,35,59,.72))" }
  });
  const STICKY_TEXT_COLORS = Object.freeze({
    light: { name: "Светлый", value: "#f7f8ff" },
    dark: { name: "Тёмный", value: "#1d1830" }
  });

  function stickyBounds(sticky = {}) {
    const maxW = Math.max(STICKY_MIN_W, window.innerWidth - 16);
    const maxH = Math.max(STICKY_MIN_H, window.innerHeight - topMenuHeight() - taskbarSpace() - 16);
    const w = clamp(Number.isFinite(sticky.w) ? sticky.w : 270, STICKY_MIN_W, maxW);
    const h = clamp(Number.isFinite(sticky.h) ? sticky.h : 270, STICKY_MIN_H, maxH);
    return { w, h };
  }

  function clampStickyPosition(sticky) {
    const { w, h } = stickyBounds(sticky);
    sticky.w = w;
    sticky.h = h;
    sticky.x = clamp(Number.isFinite(sticky.x) ? sticky.x : 120, 8, Math.max(8, window.innerWidth - w - 8));
    sticky.y = clamp(Number.isFinite(sticky.y) ? sticky.y : topMenuHeight() + 24, topMenuHeight() + 8, Math.max(topMenuHeight() + 8, window.innerHeight - taskbarSpace() - h - 8));
    return sticky;
  }

  function stickySelectOptions(map, selected) {
    return Object.entries(map).map(([value, meta]) => `<option value="${safeAttr(value)}"${value === selected ? " selected" : ""}>${escapeHtml(meta.name)}</option>`).join("");
  }

  function normalizeStickySettings(sticky = {}) {
    sticky.color = STICKY_COLORS[sticky.color] ? sticky.color : STICKY_DEFAULT_COLOR;
    sticky.textColor = STICKY_TEXT_COLORS[sticky.textColor] ? sticky.textColor : STICKY_DEFAULT_TEXT;
    sticky.fontSize = Math.round(clamp(Number(sticky.fontSize) || STICKY_DEFAULT_FONT_SIZE, 12, 22));
    sticky.opacity = clamp(Number(sticky.opacity) || STICKY_DEFAULT_OPACITY, .7, 1);
    return sticky;
  }

  function applyStickyVisual(card, sticky) {
    normalizeStickySettings(sticky);
    const color = STICKY_COLORS[sticky.color] || STICKY_COLORS[STICKY_DEFAULT_COLOR];
    const textColor = STICKY_TEXT_COLORS[sticky.textColor] || STICKY_TEXT_COLORS[STICKY_DEFAULT_TEXT];
    card.style.setProperty("--sticky-bg", color.bg);
    card.style.setProperty("--sticky-text", textColor.value);
    card.style.setProperty("--sticky-font-size", `${sticky.fontSize}px`);
    card.style.setProperty("--sticky-opacity", String(sticky.opacity));
    return sticky;
  }

  function normalizeDesktopStickies(stickies = [], options = {}) {
    const getNote = typeof options.getNote === "function" ? options.getNote : () => null;
    const isInWorkspace = typeof options.isInWorkspace === "function" ? options.isInWorkspace : () => true;
    return (Array.isArray(stickies) ? stickies : []).filter(sticky => {
      const note = getNote(sticky?.noteId);
      return note?.type === "note" && isInWorkspace(note);
    });
  }

  function removeNoteStickiesFromDesktops(desktops = [], noteIds = []) {
    const blocked = new Set(noteIds);
    (Array.isArray(desktops) ? desktops : []).forEach(desktop => {
      if (!desktop?.data) return;
      desktop.data.noteStickies = (Array.isArray(desktop.data.noteStickies) ? desktop.data.noteStickies : [])
        .filter(sticky => sticky && !blocked.has(sticky.noteId));
    });
    return desktops;
  }

  function upsertNoteSticky(stickies = [], noteId, options = {}) {
    const target = Array.isArray(stickies) ? stickies : [];
    const z = Number(options.z) || 1;
    let sticky = target.find(item => item?.noteId === noteId);
    const created = !sticky;
    if (created) {
      sticky = {
        noteId,
        x: 120 + target.length * 28,
        y: topMenuHeight() + 36 + target.length * 28,
        w: 270,
        h: 270,
        z
      };
      clampStickyPosition(sticky);
      target.push(sticky);
    } else {
      sticky.z = z;
    }
    return { sticky, created, stickies: target };
  }

  function removeNoteSticky(stickies = [], noteId) {
    return (Array.isArray(stickies) ? stickies : []).filter(sticky => sticky?.noteId !== noteId);
  }

  function resizeStickyFromPointer(sticky, start = {}, clientX = 0, clientY = 0) {
    const maxW = Math.max(STICKY_MIN_W, window.innerWidth - (sticky.x || 0) - 8);
    const maxH = Math.max(STICKY_MIN_H, window.innerHeight - taskbarSpace() - (sticky.y || topMenuHeight()) - 8);
    sticky.w = Math.round(clamp((start.w || STICKY_MIN_W) + clientX - (start.sx || 0), STICKY_MIN_W, maxW));
    sticky.h = Math.round(clamp((start.h || STICKY_MIN_H) + clientY - (start.sy || 0), STICKY_MIN_H, maxH));
    return sticky;
  }

  window.ZETER_STICKY_UTILS = Object.freeze({
    STICKY_MIN_W,
    STICKY_MIN_H,
    STICKY_DEFAULT_COLOR,
    STICKY_DEFAULT_TEXT,
    STICKY_DEFAULT_FONT_SIZE,
    STICKY_DEFAULT_OPACITY,
    STICKY_COLORS,
    STICKY_TEXT_COLORS,
    stickyBounds,
    clampStickyPosition,
    stickySelectOptions,
    normalizeStickySettings,
    applyStickyVisual,
    normalizeDesktopStickies,
    removeNoteStickiesFromDesktops,
    upsertNoteSticky,
    removeNoteSticky,
    resizeStickyFromPointer
  });
})();
