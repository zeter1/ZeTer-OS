(() => {
  "use strict";
  // Reserved parent of legacy deleted records; no trash feature or automatic cleanup.
  const { LEGACY_DELETED_ROOT } = window.ZETER_OS_CONFIG;
  function asIdSet(ids) {
    if (ids instanceof Set) return ids;
    if (Array.isArray(ids)) return new Set(ids.filter(Boolean));
    return new Set();
  }

  function activeItemIdsForPermanentDelete(target = {}, ids = []) {
    const fs = target?.fs || {};
    return [...asIdSet(ids)].filter(id => fs[id] && !fs[id].deletedAt && fs[id].parent !== LEGACY_DELETED_ROOT);
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

  function createDeletionController(options = {}) {
    const getState = options.getState || (() => ({ fs: {} }));
    const clone = options.cloneState || (value => JSON.parse(JSON.stringify(value)));
    const expand = options.expandItemIdsInTarget || ((target, ids) => ids);
    const cleanup = options.cleanupRemovedItemReferences || (() => {});
    const render = options.renderAllFileSurfaces || (() => {});
    const notify = options.toast || (() => {});
    const confirm = options.confirm || (() => false);
    const transaction = options.persistTransaction || (operation => operation(snapshot => options.saveState?.({ snapshot })));
    let queue = Promise.resolve();
    const pendingIds = new Map();

    const remove = (target, ids, extra = {}) => permanentlyRemoveItemsFromTarget(target, ids, {
      ...extra,
      expandItemIdsInTarget: extra.expandItemIdsInTarget || expand,
      rememberDeletedIdsForNativePurge: deleted => options.rememberDeletedIdsInTarget?.(target, deleted),
      pruneTargetReferencesForRemovedItems: options.pruneTargetReferencesForRemovedItems,
      normalizeStartPinnedState: options.normalizeStartPinnedState
    });

    // Low-level mutation belongs to the caller's existing transaction (automation).
    function permanentlyRemoveItems(ids, extra = {}) {
      return remove(getState(), ids, extra).count;
    }

    function commit(ids) {
      const owner = getState();
      const roots = activeItemIdsForPermanentDelete(owner, ids).filter(id => !pendingIds.has(id));
      if (!roots.length) return Promise.resolve(0);
      const records = roots.map(id => owner.fs[id]);
      const preview = new Set(expand(owner, roots));
      preview.forEach(id => pendingIds.set(id, (pendingIds.get(id) || 0) + 1));
      options.showPending?.(new Set(pendingIds.keys()));
      const pending = queue.catch(() => {}).then(() => transaction(async write => {
        if (getState() !== owner || roots.some((id, index) => owner.fs[id] !== records[index])) return 0;
        const selected = activeItemIdsForPermanentDelete(owner, roots);
        if (!selected.length) return 0;
        const candidate = clone(owner);
        const result = remove(candidate, selected, { dropActionHistory: false });
        const saved = await write(candidate);
        if (saved === false || saved?.saved === false || saved?.fallback === true) throw new Error("Хранилище не подтвердило удаление.");
        if (getState() !== owner) throw new Error("Состояние изменилось. Обновите рабочий стол.");
        // Only now close live windows, while their source metadata still exists.
        cleanup([...result.deletedIds]);
        remove(owner, [...result.deletedIds], { dropActionHistory: false, expandItemIdsInTarget: (target, fixed) => fixed });
        options.clearSelection?.();
        render();
        return result.count;
      })).finally(() => {
        preview.forEach(id => {
          const remaining = pendingIds.get(id) - 1;
          if (remaining) pendingIds.set(id, remaining);
          else pendingIds.delete(id);
        });
        options.showPending?.(new Set(pendingIds.keys()));
      });
      queue = pending;
      return pending;
    }

    async function deleteItem(id, extra = {}) {
      const item = getState().fs[id];
      if (extra.expectedItem && item !== extra.expectedItem) return false;
      if (!activeItemIdsForPermanentDelete(getState(), [id]).length) return false;
      const name = item.name || "Элемент";
      if (!extra.skipConfirm && !await confirm(`Удалить «${name}»? Объект исчезнет из текущего состояния ZeTer OS. Физическая копия в data может временно сохраняться для точек восстановления и JSON-автокопий.`)) return false;
      if (getState().fs[id] !== item) return false;
      try {
        const count = await commit([id]);
        if (!count) return false;
        notify("Удалено", `${name} · элементов: ${count}`);
        return true;
      } catch (error) {
        notify("Удаление не сохранено", `${name} оставлен на месте. ${error?.message || "Хранилище недоступно."}`);
        return false;
      }
    }

    async function deleteItems(ids = []) {
      const selected = activeItemIdsForPermanentDelete(getState(), ids);
      if (!selected.length) return false;
      const records = selected.map(id => getState().fs[id]);
      const label = selected.length === 1 ? `Удалить «${getState().fs[selected[0]].name}»?` : `Удалить выбранные элементы (${selected.length})?`;
      if (!await confirm(`${label} Объекты исчезнут из текущего состояния ZeTer OS. Физические копии в data могут временно сохраняться для точек восстановления и JSON-автокопий.`)) return false;
      if (selected.some((id, index) => getState().fs[id] !== records[index])) return false;
      try {
        const count = await commit(selected);
        if (!count) return false;
        notify("Удалено", `Элементов: ${count}`);
        return true;
      } catch (error) {
        notify("Удаление не сохранено", `Элементы оставлены на месте. ${error?.message || "Хранилище недоступно."}`);
        return false;
      }
    }
    return Object.freeze({ permanentlyRemoveItems, deleteItem, deleteItems });
  }
  window.ZETER_DELETION_UTILS = Object.freeze({ activeItemIdsForPermanentDelete, permanentlyRemoveItemsFromTarget, createDeletionController });
})();
