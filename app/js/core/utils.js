(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pad = value => String(value).padStart(2, "0");
  const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const todayISO = () => {
    const date = new Date();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const dateISO = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const parseISO = iso => {
    const [year, month, day] = String(iso).split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  };

  const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));

  const cssEscape = value => (window.CSS && CSS.escape)
    ? CSS.escape(value)
    : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");

  const safeIdPattern = window.ZETER_OS_CONFIG?.SAFE_ID_PATTERN || "^[A-Za-z0-9_-]{1,220}$";
  const safeIdRe = new RegExp(safeIdPattern);
  const isSafeId = value => typeof value === "string" && safeIdRe.test(value);
  const normalizeSafeId = (value, prefix = "id") => {
    const raw = String(value || "").trim();
    return isSafeId(raw) ? raw : uid(prefix);
  };
  const truncateText = (value = "", max = window.ZETER_OS_CONFIG?.BACKUP_IMPORT_MAX_TEXT_CHARS || 0) => {
    const text = String(value ?? "");
    const limit = Math.max(0, Number(max) || 0);
    return limit && text.length > limit ? text.slice(0, limit) : text;
  };

  const clamp = (value, min, max) => Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

  const debounce = (fn, ms) => {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  };

  const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

  function byteSize(text) {
    try { return new TextEncoder().encode(String(text ?? "")).length; }
    catch { return new Blob([String(text ?? "")]).size; }
  }

  function bytesToHuman(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
    let n = Math.max(0, bytes);
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  }

  Object.defineProperty(window, "ZETER_CORE_UTILS", {
    value: Object.freeze({
      $,
      $$,
      pad,
      uid,
      todayISO,
      dateISO,
      parseISO,
      escapeHtml,
      cssEscape,
      isSafeId,
      normalizeSafeId,
      truncateText,
      clamp,
      debounce,
      rand,
      byteSize,
      bytesToHuman
    }),
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
