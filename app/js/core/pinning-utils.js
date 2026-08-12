(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS pinning utils require config.");

  const { TRASH_ROOT } = config;

  const DEFAULT_TASKBAR_PINNED_APPS = Object.freeze(["tasks", "calendar"]);
  const LOCKED_TASKBAR_ITEMS = new Set(["start", "search"]);
  const STATIC_TASKBAR_APP_IDS = new Set(["tasks", "calendar"]);
  const TASKBAR_PINNABLE_HIDDEN_APP_IDS = new Set(["table"]);
  const START_PINNABLE_ITEM_TYPES = new Set(["app", "folder", "text", "note", "markdown", "table", "tasklist", "shortcut", "image", "paint"]);

  function canPinAppToTaskbar(apps = {}, appId = "") {
    const app = apps?.[appId];
    if (!app) return false;
    if (LOCKED_TASKBAR_ITEMS.has(appId)) return false;
    return !app.hidden || TASKBAR_PINNABLE_HIDDEN_APP_IDS.has(appId);
  }

  function itemTaskbarAppId(item, apps = {}) {
    if (!item) return null;
    if (item.type === "app") return canPinAppToTaskbar(apps, item.appId) ? item.appId : null;
    if (item.type === "table") return canPinAppToTaskbar(apps, "table") ? "table" : null;
    if (item.type === "markdown") return canPinAppToTaskbar(apps, "markdown") ? "markdown" : null;
    if (["text", "note"].includes(item.type)) return canPinAppToTaskbar(apps, "editor") ? "editor" : null;
    if (["image", "paint"].includes(item.type)) return canPinAppToTaskbar(apps, "photos") ? "photos" : null;
    return null;
  }

  function canPinItemToStart(item) {
    if (!item || !START_PINNABLE_ITEM_TYPES.has(item.type)) return false;
    if (item.deletedAt || item.parent === TRASH_ROOT) return false;
    return item.systemRole !== "explorerRoot";
  }

  function normalizeStartPinnedState(target = {}) {
    const fs = target?.fs || {};
    Object.values(fs).forEach(item => {
      if (!item || typeof item !== "object") return;
      if (!canPinItemToStart(item)) {
        delete item.pinnedInStart;
        delete item.startPinnedAt;
        delete item.startPinned;
        return;
      }
      item.pinnedInStart = Boolean(item.pinnedInStart || item.startPinned);
      item.startPinnedAt = item.pinnedInStart
        ? (Number(item.startPinnedAt) || Number(item.updatedAt) || Number(item.createdAt) || Date.now())
        : 0;
      delete item.startPinned;
    });
  }

  function normalizeTaskbarPinnedApps(list = [], apps = {}) {
    const out = [];
    const add = id => {
      if (!id || out.includes(id)) return;
      if (!canPinAppToTaskbar(apps, id)) return;
      out.push(id);
    };
    (Array.isArray(list) ? list : []).forEach(add);
    return out;
  }

  window.ZETER_PINNING_UTILS = Object.freeze({
    DEFAULT_TASKBAR_PINNED_APPS,
    LOCKED_TASKBAR_ITEMS,
    STATIC_TASKBAR_APP_IDS,
    TASKBAR_PINNABLE_HIDDEN_APP_IDS,
    START_PINNABLE_ITEM_TYPES,
    canPinAppToTaskbar,
    itemTaskbarAppId,
    canPinItemToStart,
    normalizeStartPinnedState,
    normalizeTaskbarPinnedApps
  });
})();
