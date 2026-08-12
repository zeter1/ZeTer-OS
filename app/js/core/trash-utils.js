(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const coreUtils = window.ZETER_CORE_UTILS;
  if (!config || !coreUtils) throw new Error("ZeTer OS trash utils require config and core utils.");

  const {
    TRASH_ROOT,
    DEFAULT_TRASH_RETENTION_DAYS,
    TRASH_RETENTION_MIN_DAYS,
    TRASH_RETENTION_MAX_DAYS,
    DAY_MS
  } = config;
  const { clamp } = coreUtils;

  function normalizeTrashRetentionDays(value) {
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return DEFAULT_TRASH_RETENTION_DAYS;
    return clamp(parsed, TRASH_RETENTION_MIN_DAYS, TRASH_RETENTION_MAX_DAYS);
  }

  function trashRetentionDays(target = {}) {
    target.settings = target.settings || {};
    target.settings.trashRetentionDays = normalizeTrashRetentionDays(target.settings.trashRetentionDays);
    return target.settings.trashRetentionDays;
  }

  function normalizeTrashState(target = {}, options = {}) {
    const fs = target?.fs || {};
    target.settings = target.settings || {};
    target.settings.trashRetentionDays = normalizeTrashRetentionDays(target.settings.trashRetentionDays);
    Object.values(fs).forEach(item => {
      if (!item || typeof item !== "object") return;
      if (item.parent === TRASH_ROOT) item.deletedAt = Number(item.deletedAt) || Date.now();
      if (!item.deletedAt) return;
      item.deletedAt = Number(item.deletedAt) || Date.now();
      item.pinnedInStart = false;
      item.startPinnedAt = 0;
      item.pinnedInExplorer = false;
      delete item.startPinned;
    });
    if (typeof options.normalizeStartPinnedState === "function") {
      options.normalizeStartPinnedState(target);
    }
  }

  function asIdSet(ids) {
    if (ids instanceof Set) return ids;
    if (Array.isArray(ids)) return new Set(ids.filter(Boolean));
    return new Set();
  }

  function rootTrashIds(target = {}, ids = [], options = {}) {
    const fs = target?.fs || {};
    const isDesktopRoot = typeof options.isDesktopRoot === "function"
      ? options.isDesktopRoot
      : id => id === "desktop";
    const unique = [...asIdSet(ids)].filter(id => fs[id] && !fs[id].deletedAt && fs[id].parent !== TRASH_ROOT);
    const selected = new Set(unique);
    return unique.filter(id => {
      let parentId = fs[id]?.parent;
      const visited = new Set();
      while (parentId && !visited.has(parentId)) {
        if (selected.has(parentId)) return false;
        visited.add(parentId);
        if (isDesktopRoot(parentId) || parentId === TRASH_ROOT) break;
        parentId = fs[parentId]?.parent;
      }
      return true;
    });
  }

  function activeItemIdsForPermanentDelete(target = {}, ids = []) {
    const fs = target?.fs || {};
    return [...asIdSet(ids)].filter(id => fs[id] && !fs[id].deletedAt && fs[id].parent !== TRASH_ROOT);
  }

  function trashedItems(target = {}) {
    const fs = target?.fs || {};
    return Object.values(fs)
      .filter(item => item?.deletedAt && item.parent === TRASH_ROOT)
      .sort((a, b) => Number(b.deletedAt || 0) - Number(a.deletedAt || 0));
  }

  function restoreTrashItemInTarget(target = {}, itemId, options = {}) {
    const fs = target?.fs || {};
    const item = fs[itemId];
    if (!item) return null;

    const isDesktopRoot = typeof options.isDesktopRoot === "function"
      ? options.isDesktopRoot
      : id => id === "desktop";
    const getDesktopRoot = typeof options.getDesktopRoot === "function"
      ? options.getDesktopRoot
      : () => "desktop";
    const uniqueName = typeof options.uniqueName === "function"
      ? options.uniqueName
      : name => name;
    const collectDescendants = typeof options.descendantIds === "function"
      ? options.descendantIds
      : () => [];

    const ids = [itemId, ...collectDescendants(itemId)].filter(id => fs[id]);
    const restoreParent = item.originalParent && fs[item.originalParent] && !fs[item.originalParent].deletedAt
      ? item.originalParent
      : (isDesktopRoot(item.originalParent) ? item.originalParent : getDesktopRoot());
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();

    ids.forEach(id => {
      const entry = fs[id];
      if (!entry) return;
      entry.deletedAt = 0;
      if (entry.id === itemId) entry.parent = restoreParent;
      delete entry.originalParent;
      entry.updatedAt = now;
    });

    if (isDesktopRoot(item.parent) || fs[item.parent]?.type === "folder") {
      item.name = uniqueName(item.name || "Элемент", item.parent, item.id);
    }
    return { item, ids, restoreParent };
  }

  function moveItemsToTrashInTarget(target = {}, ids = [], options = {}) {
    const fs = target?.fs || {};
    normalizeTrashState(target, { normalizeStartPinnedState: options.normalizeStartPinnedState });

    const roots = rootTrashIds(target, ids, { isDesktopRoot: options.isDesktopRoot });
    if (!roots.length) return { count: 0, roots, movedIds: new Set(), savedItems: [] };

    const expanded = typeof options.expandItemIdsInTarget === "function"
      ? options.expandItemIdsInTarget(target, roots)
      : roots;
    const movedIds = asIdSet(expanded);
    const rootSet = new Set(roots);
    const savedItems = [...movedIds]
      .map(id => fs[id] ? JSON.parse(JSON.stringify(fs[id])) : null)
      .filter(Boolean);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const getDesktopRoot = typeof options.getDesktopRoot === "function"
      ? options.getDesktopRoot
      : () => "desktop";

    if (typeof options.cleanupRemovedItemReferences === "function") {
      options.cleanupRemovedItemReferences([...movedIds]);
    }
    if (typeof options.pruneTargetReferencesForRemovedItems === "function") {
      options.pruneTargetReferencesForRemovedItems(target, movedIds, { dropActionHistory: false });
    }

    movedIds.forEach(id => {
      const entry = fs[id];
      if (!entry) return;
      if (rootSet.has(id)) {
        entry.originalParent = entry.parent || getDesktopRoot();
        entry.parent = TRASH_ROOT;
      }
      entry.deletedAt = now;
      entry.updatedAt = now;
      entry.pinnedInStart = false;
      entry.startPinnedAt = 0;
      entry.pinnedInExplorer = false;
      delete entry.startPinned;
    });

    if (typeof options.pushActionHistory === "function") {
      options.pushActionHistory({ type: "delete", items: savedItems });
    }
    if (typeof options.normalizeStartPinnedState === "function") {
      options.normalizeStartPinnedState(target);
    }
    return { count: movedIds.size, roots, movedIds, savedItems };
  }

  function purgeExpiredTrashItemsFromTarget(target = {}, options = {}) {
    const fs = target?.fs || {};
    const days = trashRetentionDays(target);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const cutoff = now - days * DAY_MS;
    const expiredRoots = Object.values(fs)
      .filter(item => item && item.parent === TRASH_ROOT && Number(item.deletedAt || 0) > 0 && Number(item.deletedAt) <= cutoff)
      .map(item => item.id);

    if (!expiredRoots.length) return 0;

    const expanded = typeof options.expandItemIdsInTarget === "function"
      ? options.expandItemIdsInTarget(target, expiredRoots)
      : expiredRoots;
    const deletedIds = asIdSet(expanded);
    if (!deletedIds.size) return 0;

    if (typeof options.pruneTargetReferencesForRemovedItems === "function") {
      options.pruneTargetReferencesForRemovedItems(target, deletedIds, { dropActionHistory: options.dropActionHistory !== false });
    } else if (options.dropActionHistory !== false) {
      target.actionHistory = [];
    }

    deletedIds.forEach(id => delete fs[id]);

    if (typeof options.normalizeStartPinnedState === "function") {
      options.normalizeStartPinnedState(target);
    }
    return deletedIds.size;
  }

  function permanentlyRemoveItemsFromTarget(target = {}, ids = [], options = {}) {
    const fs = target?.fs || {};
    const expanded = typeof options.expandItemIdsInTarget === "function"
      ? options.expandItemIdsInTarget(target, ids)
      : ids;
    const deletedIds = new Set([...asIdSet(expanded)].filter(id => fs[id]));
    if (!deletedIds.size) return { count: 0, deletedIds };

    if (typeof options.rememberDeletedIdsForNativePurge === "function") {
      options.rememberDeletedIdsForNativePurge(deletedIds);
    }
    if (typeof options.cleanupRemovedItemReferences === "function") {
      options.cleanupRemovedItemReferences([...deletedIds]);
    }
    if (typeof options.pruneTargetReferencesForRemovedItems === "function") {
      options.pruneTargetReferencesForRemovedItems(target, deletedIds, options);
    }

    deletedIds.forEach(id => delete fs[id]);

    if (typeof options.normalizeStartPinnedState === "function") {
      options.normalizeStartPinnedState(target);
    }
    return { count: deletedIds.size, deletedIds };
  }

  function createTrashActionController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {}, actionHistory: [] });
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : id => id === "desktop";
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const expandItemIdsInTarget = typeof options.expandItemIdsInTarget === "function" ? options.expandItemIdsInTarget : (target, ids) => ids;
    const cleanupRemovedItemReferences = typeof options.cleanupRemovedItemReferences === "function" ? options.cleanupRemovedItemReferences : () => {};
    const pruneTargetReferencesForRemovedItems = typeof options.pruneTargetReferencesForRemovedItems === "function" ? options.pruneTargetReferencesForRemovedItems : () => {};
    const appendActionHistory = typeof options.pushActionHistory === "function" ? options.pushActionHistory : () => {};
    const normalizeStartPinnedState = typeof options.normalizeStartPinnedState === "function" ? options.normalizeStartPinnedState : () => {};
    const descendantIds = typeof options.descendantIds === "function" ? options.descendantIds : () => [];
    const uniqueName = typeof options.uniqueName === "function" ? options.uniqueName : name => name;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const cloneState = typeof options.cloneState === "function" ? options.cloneState : value => JSON.parse(JSON.stringify(value));
    const replaceState = typeof options.replaceState === "function" ? options.replaceState : restored => {
      const target = getState();
      Object.keys(target).forEach(key => delete target[key]);
      Object.assign(target, restored);
    };
    const renderAllFileSurfaces = typeof options.renderAllFileSurfaces === "function" ? options.renderAllFileSurfaces : () => {};
    const refreshRecycleBinWindows = typeof options.refreshRecycleBinWindows === "function" ? options.refreshRecycleBinWindows : () => {};
    const notify = typeof options.toast === "function" ? options.toast : () => {};
    const requestConfirm = typeof options.confirm === "function" ? options.confirm : () => false;
    const rememberDeletedIdsForNativePurge = typeof options.rememberDeletedIdsForNativePurge === "function" ? options.rememberDeletedIdsForNativePurge : () => {};
    const clearSelection = typeof options.clearSelection === "function" ? options.clearSelection : () => {};

    function pushActionHistory(action) {
      return appendActionHistory(action);
    }

    function moveItemsToTrash(ids = []) {
      const result = moveItemsToTrashInTarget(getState(), ids, {
        isDesktopRoot,
        getDesktopRoot,
        expandItemIdsInTarget,
        cleanupRemovedItemReferences,
        pruneTargetReferencesForRemovedItems,
        pushActionHistory,
        normalizeStartPinnedState
      });
      return result.count;
    }

    function undoLastAction() {
      const state = getState();
      state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
      const action = state.actionHistory.pop();
      if (!action) return notify("Отменять нечего", "История действий пуста.");
      if (action.type === "delete" && Array.isArray(action.items)) {
        action.items.forEach(saved => { state.fs[saved.id] = saved; });
        saveState();
        renderAllFileSurfaces();
        notify("Удаление отменено", `${action.items.length} элементов восстановлено.`);
        return true;
      }
      notify("Действие не поддерживается", "Эту операцию пока нельзя отменить.");
      return false;
    }

    function currentTrashedItems() {
      return trashedItems(getState());
    }

    function restoreTrashItem(itemId) {
      const result = restoreTrashItemInTarget(getState(), itemId, {
        descendantIds,
        getDesktopRoot,
        isDesktopRoot,
        uniqueName
      });
      if (!result) return false;
      saveState();
      renderAllFileSurfaces();
      refreshRecycleBinWindows();
      notify("Восстановлено", result.item.name);
      return true;
    }

    function permanentlyRemoveItems(ids = [], removeOptions = {}) {
      return permanentlyRemoveItemsFromTarget(getState(), ids, {
        ...removeOptions,
        expandItemIdsInTarget,
        rememberDeletedIdsForNativePurge,
        cleanupRemovedItemReferences,
        pruneTargetReferencesForRemovedItems,
        normalizeStartPinnedState
      }).count;
    }

    function retentionDays(target = getState()) {
      return trashRetentionDays(target);
    }

    function normalizeState(target = getState()) {
      normalizeTrashState(target, { normalizeStartPinnedState });
    }

    function purgeExpired(target = getState(), purgeOptions = {}) {
      return purgeExpiredTrashItemsFromTarget(target, {
        ...purgeOptions,
        expandItemIdsInTarget,
        pruneTargetReferencesForRemovedItems,
        normalizeStartPinnedState
      });
    }

    function applyRetentionDays(value) {
      const days = normalizeTrashRetentionDays(value);
      const state = getState();
      state.settings = state.settings || {};
      state.settings.trashRetentionDays = days;
      const removed = purgeExpired(state, { dropActionHistory: true });
      saveState();
      renderAllFileSurfaces();
      refreshRecycleBinWindows();
      const suffix = removed ? ` Автоудалено сейчас: ${removed}.` : "";
      notify("Настройка старых удалений сохранена", `Автоочистка старых записей через ${days} дн.${suffix}`);
      return days;
    }

    async function deleteItem(itemId, deleteOptions = {}) {
      const item = getState().fs[itemId];
      if (!item || item.deletedAt) return false;
      const name = item.name || "Элемент";
      const promptText = deleteOptions.skipConfirm ? "" : `Удалить «${name}»? Объект исчезнет из текущего состояния ZeTer OS. Физическая копия в data может временно сохраняться для точек восстановления и JSON-автокопий.`;
      if (!deleteOptions.skipConfirm && !requestConfirm(promptText)) return false;
      const previousState = cloneState(getState());
      const removed = permanentlyRemoveItems([itemId], { dropActionHistory: false });
      if (!removed) return false;
      try {
        await saveState();
        renderAllFileSurfaces();
        refreshRecycleBinWindows();
        notify("Удалено", `${name} · элементов: ${removed}`);
        return true;
      } catch (error) {
        replaceState(previousState);
        renderAllFileSurfaces();
        refreshRecycleBinWindows();
        notify("Удаление не сохранено", `${name} оставлен на месте. ${error?.message || "Хранилище недоступно."}`);
        return false;
      }
    }

    function permanentlyDeleteTrashItem(itemId) {
      const item = getState().fs[itemId];
      if (!item || !requestConfirm(`Удалить «${item.name}» без возможности восстановления?`)) return false;
      const removed = permanentlyRemoveItems([itemId], { dropActionHistory: false });
      saveState();
      renderAllFileSurfaces();
      refreshRecycleBinWindows();
      notify("Старая запись удаления очищена", `${item.name} · удалено записей: ${removed}`);
      return true;
    }

    function emptyTrash() {
      const items = currentTrashedItems();
      if (!items.length) {
        notify("Старых удалённых записей нет", "Очищать нечего.");
        return false;
      }
      if (!requestConfirm(`Очистить следы удаления из старых версий? Будет удалено записей: ${items.length}.`)) return false;
      const removed = permanentlyRemoveItems(items.map(item => item.id), { dropActionHistory: false });
      saveState();
      renderAllFileSurfaces();
      refreshRecycleBinWindows();
      notify("Старые записи удаления очищены", `Удалено записей: ${removed}.`);
      return true;
    }

    async function deleteItems(ids = []) {
      const state = getState();
      const unique = activeItemIdsForPermanentDelete(state, ids);
      if (!unique.length) return false;
      const label = unique.length === 1 ? `Удалить «${state.fs[unique[0]].name}»?` : `Удалить выбранные элементы (${unique.length})?`;
      if (!requestConfirm(`${label} Объекты исчезнут из текущего состояния ZeTer OS. Физические копии в data могут временно сохраняться для точек восстановления и JSON-автокопий.`)) return false;
      const previousState = cloneState(state);
      const removed = permanentlyRemoveItems(unique, { dropActionHistory: false });
      try {
        await saveState();
        clearSelection();
        renderAllFileSurfaces();
        refreshRecycleBinWindows();
        notify("Удалено", `Элементов: ${removed}`);
        return true;
      } catch (error) {
        replaceState(previousState);
        renderAllFileSurfaces();
        refreshRecycleBinWindows();
        notify("Удаление не сохранено", `Элементы оставлены на месте. ${error?.message || "Хранилище недоступно."}`);
        return false;
      }
    }

    return Object.freeze({
      pushActionHistory,
      moveItemsToTrash,
      undoLastAction,
      trashedItems: currentTrashedItems,
      restoreTrashItem,
      permanentlyRemoveItems,
      retentionDays,
      normalizeState,
      purgeExpired,
      applyRetentionDays,
      deleteItem,
      permanentlyDeleteTrashItem,
      emptyTrash,
      deleteItems
    });
  }

  window.ZETER_TRASH_UTILS = Object.freeze({
    normalizeTrashRetentionDays,
    trashRetentionDays,
    normalizeTrashState,
    rootTrashIds,
    activeItemIdsForPermanentDelete,
    trashedItems,
    restoreTrashItemInTarget,
    moveItemsToTrashInTarget,
    purgeExpiredTrashItemsFromTarget,
    permanentlyRemoveItemsFromTarget,
    createTrashActionController
  });
})();
