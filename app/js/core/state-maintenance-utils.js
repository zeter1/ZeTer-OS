(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG || {};
  const TRASH_ROOT = config.TRASH_ROOT || "trash";

  const REMOVED_APP_IDS = new Set(["browser", "paint", "tools", "explorer", "recycle", "ter" + "minal"]);
  const REMOVED_APP_NAMES = new Set([
    "ZeTer " + "Browser",
    "Pa" + "int",
    "Инструменты",
    "Проводник",
    "Корзина",
    "Term" + "inal"
  ]);

  function asIdSet(ids = []) {
    if (ids instanceof Set) return new Set([...ids].filter(Boolean));
    if (Array.isArray(ids)) return new Set(ids.filter(Boolean));
    return new Set();
  }

  function ensureSystemAppShortcut(target = {}, appId, name, x = 320, y = 132) {
    if (!target?.fs || !appId) return target;
    const hasShortcut = Object.values(target.fs).some(item => item?.type === "app" && item.appId === appId && !item.deletedAt);
    if (hasShortcut) return target;
    const id = `app_${appId}`;
    if (target.fs[id]) return target;
    target.fs[id] = { id, type: "app", name, parent: "desktop", x, y, createdAt: Date.now(), updatedAt: Date.now(), appId };
    return target;
  }

  function removeExplorerAppShortcutsFromState(target = {}) {
    if (!target) return target;
    if (target.fs) {
      Object.keys(target.fs).forEach(id => {
        const item = target.fs[id];
        const isRemovedApp = item && item.type === "app" && (REMOVED_APP_IDS.has(item.appId) || REMOVED_APP_NAMES.has(item.name));
        if (isRemovedApp) delete target.fs[id];
      });
    }
    (target.desktops || []).forEach(desk => {
      if (desk?.data && Array.isArray(desk.data.openWindows)) {
        desk.data.openWindows = desk.data.openWindows.filter(session => session?.appId && !REMOVED_APP_IDS.has(session.appId));
      }
    });
    return target;
  }

  function removeWorkspaceDocumentsFoldersFromState(target = {}) {
    if (!target?.fs) return target;
    const fs = target.fs;
    const documentsFolders = Object.values(fs).filter(item =>
      item?.type === "folder" &&
      (item.id === "folder_docs" || item.systemRole === "documents")
    );

    documentsFolders.forEach(folder => {
      const fallbackParent = folder.parent || "desktop";
      let offset = 0;

      Object.values(fs).forEach(child => {
        if (child?.parent !== folder.id) return;
        child.parent = fallbackParent;
        child.x = (folder.x || 32) + offset * 24;
        child.y = (folder.y || 32) + 96 + offset * 24;
        child.updatedAt = Date.now();
        offset += 1;
      });

      delete fs[folder.id];
    });
    return target;
  }

  function windowSessionReferencesItems(session, ids = new Set()) {
    const deletedIds = asIdSet(ids);
    if (!session || !deletedIds.size) return false;
    const params = session.params || {};
    const explorerRefs = new Set([params.folderId, params.activeTabId, ...(Array.isArray(params.explorerTabs) ? params.explorerTabs : [])].filter(Boolean));
    return (session.appId === "folder" && [...explorerRefs].some(id => deletedIds.has(id))) ||
      (["editor", "markdown", "table", "tasklist", "photos"].includes(session.appId) && deletedIds.has(params.itemId)) ||
      (session.appId === "tasks" && deletedIds.has(params.shortcutItemId));
  }

  function expandItemIdsInTarget(target = {}, ids = []) {
    const fs = target?.fs || {};
    const out = new Set([...asIdSet(ids)].filter(id => fs[id]));
    let changed = true;
    while (changed) {
      changed = false;
      Object.values(fs).forEach(item => {
        if (!item?.id || out.has(item.id)) return;
        if (out.has(item.parent)) {
          out.add(item.id);
          changed = true;
        }
      });
    }
    return out;
  }

  function pushActionHistory(target = {}, action = {}, options = {}) {
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : 20;
    const timestamp = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

    target.actionHistory = Array.isArray(target.actionHistory) ? target.actionHistory : [];
    target.actionHistory.push({ ...action, at: timestamp });
    target.actionHistory = target.actionHistory.slice(-limit);
    return target.actionHistory;
  }

  function pruneTargetReferencesForRemovedItems(target = {}, deletedIds = new Set(), options = {}) {
    const ids = asIdSet(deletedIds);
    if (!target || !ids.size) return target;
    const blocked = id => ids.has(id);

    target.actionHistory = Array.isArray(target.actionHistory)
      ? (options.dropActionHistory ? [] : target.actionHistory.filter(action => !(action?.items || []).some(item => blocked(item?.id))))
      : [];

    if (Array.isArray(target.taskbarPinnedApps) && typeof options.normalizeTaskbarPinnedApps === "function") {
      target.taskbarPinnedApps = options.normalizeTaskbarPinnedApps(target.taskbarPinnedApps);
    }

    (target.desktops || []).forEach(desk => {
      if (!desk?.data) return;
      desk.data.openWindows = Array.isArray(desk.data.openWindows)
        ? desk.data.openWindows.filter(session => !windowSessionReferencesItems(session, ids))
        : [];
      desk.data.noteStickies = Array.isArray(desk.data.noteStickies)
        ? desk.data.noteStickies.filter(sticky => sticky && !blocked(sticky.noteId))
        : [];
      desk.data.expandedExplorerFolders = Array.isArray(desk.data.expandedExplorerFolders)
        ? desk.data.expandedExplorerFolders.filter(id => !blocked(id))
        : [];
    });
    return target;
  }

  function purgeDeletedItemsFromStorageState(target = {}, options = {}) {
    const fs = target?.fs || {};
    const baseIds = Object.values(fs)
      .filter(item => item && (item.deletedAt || item.parent === TRASH_ROOT))
      .map(item => item.id);
    const deletedIds = expandItemIdsInTarget(target, baseIds);

    if (!deletedIds.size) {
      if (options.dropActionHistory) target.actionHistory = [];
      return 0;
    }

    pruneTargetReferencesForRemovedItems(target, deletedIds, options);
    deletedIds.forEach(id => delete fs[id]);
    if (typeof options.normalizeStartPinnedState === "function") options.normalizeStartPinnedState(target);
    return deletedIds.size;
  }

  function rememberDeletedIdsForNativePurge(target = {}, deletedIds = new Set()) {
    const ids = asIdSet(deletedIds);
    if (!ids.size) return target;
    const remembered = new Set(Array.isArray(target._zeterDeletedIdsToPurge) ? target._zeterDeletedIdsToPurge.filter(Boolean) : []);
    ids.forEach(id => remembered.add(id));
    target._zeterDeletedIdsToPurge = [...remembered].slice(-5000);
    return target;
  }

  function normalizeNotesData(target = {}, options = {}) {
    const fs = target?.fs || {};
    const appCenterName = typeof options.appCenterName === "string" && options.appCenterName.trim()
      ? options.appCenterName
      : "Центр приложений";

    Object.values(fs).forEach(item => {
      if (item?.type === "app" && item.appId === "notes") item.name = "Заметки";
      if (item?.type === "app" && item.appId === "appcenter") item.name = appCenterName;
    });

    (target.desktops || []).forEach(desk => {
      desk.data = desk.data || {};
      desk.data.noteStickies = Array.isArray(desk.data.noteStickies)
        ? desk.data.noteStickies.filter(sticky => sticky && fs[sticky.noteId]?.type === "note")
        : [];
    });
    return target;
  }

  function createRemovedItemReferencesController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {}, desktops: [] });
    const getWindows = typeof options.getWindows === "function" ? options.getWindows : () => new Map();
    const getExplorerFolders = typeof options.getExplorerFolders === "function" ? options.getExplorerFolders : () => new Map();
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const getActiveWindow = typeof options.getActiveWindow === "function" ? options.getActiveWindow : () => null;
    const setActiveWindow = typeof options.setActiveWindow === "function" ? options.setActiveWindow : () => {};
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const workspaceDefaults = typeof options.workspaceDefaults === "function" ? options.workspaceDefaults : () => ({});
    const itemTaskbarAppId = typeof options.itemTaskbarAppId === "function" ? options.itemTaskbarAppId : () => null;
    const normalizeTaskbarPinnedApps = typeof options.normalizeTaskbarPinnedApps === "function" ? options.normalizeTaskbarPinnedApps : list => list;
    const taskbarPinnedApps = typeof options.taskbarPinnedApps === "function" ? options.taskbarPinnedApps : () => [];
    const removeTaskbarButton = typeof options.removeTaskbarButton === "function" ? options.removeTaskbarButton : () => {};

    function closeRuntimeWindowWithoutSaving(winId) {
      const windows = getWindows();
      const record = windows.get(winId);
      if (!record) return false;
      record.el?.remove();
      windows.delete(winId);
      removeTaskbarButton(winId);
      getExplorerFolders().delete(winId);
      if (getActiveWindow() === winId) setActiveWindow(null);
      return true;
    }

    function closeWindowsForRemovedItems(deletedIds) {
      [...getWindows().entries()]
        .filter(([, record]) => windowSessionReferencesItems(record, deletedIds))
        .forEach(([winId]) => closeRuntimeWindowWithoutSaving(winId));
    }

    function pruneSavedWindowsForRemovedItems(deletedIds) {
      ensureDesktops();
      getState().desktops.forEach(desktop => {
        desktop.data = desktop.data || workspaceDefaults();
        desktop.data.openWindows = Array.isArray(desktop.data.openWindows)
          ? desktop.data.openWindows.filter(session => !windowSessionReferencesItems(session, deletedIds))
          : [];
      });
    }

    function removeTaskbarPinsForRemovedItems(deletedIds) {
      const state = getState();
      const apps = getApps();
      const appIds = new Set();
      deletedIds.forEach(id => {
        const item = state.fs[id];
        const appId = itemTaskbarAppId(item);
        if (!appId) return;
        if (item?.type === "app" || apps[appId]?.hidden) appIds.add(appId);
      });
      if (!appIds.size) return;

      const hasLiveSource = appId => Object.values(state.fs || {}).some(item =>
        item &&
        !item.deletedAt &&
        !deletedIds.has(item.id) &&
        (item.type === "app" || apps[appId]?.hidden) &&
        itemTaskbarAppId(item) === appId
      );

      state.taskbarPinnedApps = normalizeTaskbarPinnedApps(taskbarPinnedApps().filter(appId =>
        !appIds.has(appId) || hasLiveSource(appId)
      ));
    }

    function cleanup(ids = []) {
      const deletedIds = new Set(ids.filter(Boolean));
      if (!deletedIds.size) return false;
      const state = getState();

      deletedIds.forEach(id => {
        const item = state.fs[id];
        if (!item) return;
        item.pinnedInStart = false;
        item.startPinnedAt = 0;
        delete item.startPinned;
      });

      removeTaskbarPinsForRemovedItems(deletedIds);
      closeWindowsForRemovedItems(deletedIds);
      pruneSavedWindowsForRemovedItems(deletedIds);
      return true;
    }

    return Object.freeze({
      closeRuntimeWindowWithoutSaving,
      closeWindowsForRemovedItems,
      pruneSavedWindowsForRemovedItems,
      removeTaskbarPinsForRemovedItems,
      cleanup
    });
  }

  window.ZETER_STATE_MAINTENANCE_UTILS = Object.freeze({
    ensureSystemAppShortcut,
    removeExplorerAppShortcutsFromState,
    removeWorkspaceDocumentsFoldersFromState,
    windowSessionReferencesItems,
    expandItemIdsInTarget,
    pushActionHistory,
    pruneTargetReferencesForRemovedItems,
    purgeDeletedItemsFromStorageState,
    rememberDeletedIdsForNativePurge,
    normalizeNotesData,
    createRemovedItemReferencesController
  });
})();
