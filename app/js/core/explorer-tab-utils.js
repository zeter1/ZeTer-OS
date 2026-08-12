(() => {
  "use strict";

  const EXPLORER_BLANK_TAB_PREFIX = "__zeter_explorer_blank__";
  const EXPLORER_FOLDER_TAB_PREFIX = "__zeter_explorer_folder_tab__";
  const EXPLORER_TAB_LIMIT = 12;

  function randomTabSuffix() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function makeExplorerBlankTabId() {
    return `${EXPLORER_BLANK_TAB_PREFIX}${randomTabSuffix()}`;
  }

  function isExplorerBlankTab(id) {
    return typeof id === "string" && id.startsWith(EXPLORER_BLANK_TAB_PREFIX);
  }

  function makeExplorerFolderTabId(folderId) {
    return `${EXPLORER_FOLDER_TAB_PREFIX}${encodeURIComponent(folderId || "")}_${randomTabSuffix()}`;
  }

  function isExplorerFolderTab(id) {
    return typeof id === "string" && id.startsWith(EXPLORER_FOLDER_TAB_PREFIX);
  }

  function explorerTabLinks(params = {}) {
    if (!params || typeof params !== "object") return {};
    if (!params.explorerTabLinks || typeof params.explorerTabLinks !== "object" || Array.isArray(params.explorerTabLinks)) {
      params.explorerTabLinks = {};
    }
    return params.explorerTabLinks;
  }

  function normalizeFolderId(id, rootId, params, options = {}) {
    return typeof options.normalizeFolderId === "function"
      ? options.normalizeFolderId(id, rootId, params)
      : (id || null);
  }

  function isUsableFolderId(id, rootId, params, options = {}) {
    return typeof options.isUsableFolderId === "function"
      ? Boolean(options.isUsableFolderId(id, rootId, params))
      : Boolean(id);
  }

  function explorerFolderIdForTab(tabId, params = {}, rootId = "", options = {}) {
    if (!tabId || isExplorerBlankTab(tabId)) return null;
    if (isExplorerFolderTab(tabId)) {
      const linkedId = explorerTabLinks(params)[tabId];
      const safeLinkedId = normalizeFolderId(linkedId, rootId, params, options);
      return safeLinkedId || rootId;
    }
    return normalizeFolderId(tabId, rootId, params, options);
  }

  function explorerTabIsUsable(id, rootId = "", params = {}, options = {}) {
    if (!id) return false;
    if (isExplorerBlankTab(id)) return true;
    if (isExplorerFolderTab(id)) {
      const linkedId = explorerTabLinks(params)[id];
      const safeId = normalizeFolderId(linkedId, rootId, params, options);
      return Boolean(linkedId && safeId && !isExplorerBlankTab(safeId) && isUsableFolderId(safeId, rootId, params, options));
    }
    const safeId = normalizeFolderId(id, rootId, params, options);
    return safeId === id && isUsableFolderId(id, rootId, params, options);
  }

  function normalizeExplorerAnchorId(folderId, rootId = "", params = {}, options = {}) {
    if (isExplorerBlankTab(folderId)) return rootId;
    if (isExplorerFolderTab(folderId)) folderId = explorerFolderIdForTab(folderId, params, rootId, options);
    const safeId = normalizeFolderId(folderId, rootId, params, options);
    return explorerTabIsUsable(safeId, rootId, params, options) && !isExplorerBlankTab(safeId) ? safeId : rootId;
  }

  function normalizeExplorerTabs(params = {}, activeFolder = "", rootId = "", options = {}) {
    explorerTabLinks(params);
    const ids = [];
    const add = id => {
      if (!id) return;
      if (isExplorerBlankTab(id)) {
        if (!ids.includes(id)) ids.push(id);
        return;
      }
      if (isExplorerFolderTab(id)) {
        if (explorerTabIsUsable(id, rootId, params, options) && !ids.includes(id)) ids.push(id);
        return;
      }
      const safeId = normalizeFolderId(id, rootId, params, options);
      if (safeId && !ids.includes(safeId)) ids.push(safeId);
    };
    const anchorId = normalizeExplorerAnchorId(
      params.explorerSessionRootId || params.explorerAnchorFolderId || params.folderId || activeFolder || rootId,
      rootId,
      params,
      options
    );
    if (Array.isArray(params.explorerTabs)) params.explorerTabs.forEach(add);
    // При восстановлении сохранённого набора params.folderId не должен
    // автоматически превращаться в дополнительную вкладку.
    add(params.activeTabId || activeFolder || params.folderId || anchorId);
    if (!ids.length) add(anchorId);
    if (!ids.length) ids.push(rootId);
    const requestedActive = activeFolder || params.activeTabId || params.folderId || anchorId;
    const normalizedActive = isExplorerBlankTab(requestedActive) || isExplorerFolderTab(requestedActive)
      ? requestedActive
      : normalizeFolderId(requestedActive, rootId, params, options);
    const ordered = ids
      .filter((id, index, list) => id && (isExplorerFolderTab(id) || list.indexOf(id) === index))
      .slice(0, EXPLORER_TAB_LIMIT);
    const active = ordered.includes(normalizedActive) ? normalizedActive : ordered[0];
    params.explorerAnchorFolderId = anchorId;
    params.explorerSessionRootId = anchorId;
    params.explorerTabs = ordered;
    params.activeTabId = params.explorerTabs.includes(active) ? active : params.explorerTabs[0];
    params.folderId = isExplorerBlankTab(params.activeTabId)
      ? ""
      : explorerFolderIdForTab(params.activeTabId, params, rootId, options);
    return params.explorerTabs;
  }

  function savedExplorerTabStateForFolder(target = {}, folderId, rootId = "", options = {}) {
    const fs = target?.fs || {};
    const anchorId = normalizeExplorerAnchorId(folderId, rootId, {}, options);
    const holder = fs[anchorId];
    const saved = Array.isArray(holder?.explorerTabs) ? holder.explorerTabs : [];
    const savedLinks = holder?.explorerTabLinks && typeof holder.explorerTabLinks === "object" && !Array.isArray(holder.explorerTabLinks)
      ? holder.explorerTabLinks
      : {};
    const tempParams = { explorerTabLinks: { ...savedLinks } };
    const tabs = [];
    const links = {};
    const add = id => {
      if (!explorerTabIsUsable(id, rootId, tempParams, options)) return;
      if (isExplorerBlankTab(id)) {
        if (!tabs.includes(id)) tabs.push(id);
        return;
      }
      if (isExplorerFolderTab(id)) {
        if (!tabs.includes(id)) {
          tabs.push(id);
          links[id] = explorerFolderIdForTab(id, tempParams, rootId, options);
        }
        return;
      }
      const safeId = normalizeFolderId(id, rootId, tempParams, options);
      if (safeId && !tabs.includes(safeId)) tabs.push(safeId);
    };

    // Восстанавливаем ровно оставленный пользователем набор вкладок, без
    // принудительного добавления якорной папки перед сохранёнными вкладками.
    if (saved.length) saved.forEach(add);
    if (!tabs.length) add(anchorId);
    return { tabs: tabs.slice(0, EXPLORER_TAB_LIMIT), links };
  }

  function savedExplorerTabsForFolder(target = {}, folderId, rootId = "", options = {}) {
    return savedExplorerTabStateForFolder(target, folderId, rootId, options).tabs;
  }

  function explorerLastFolderForSession(target = {}, folderId, rootId = "", params = {}, options = {}) {
    const holder = target?.fs?.[folderId];
    const lastId = holder?.explorerLastFolderId;
    if (!lastId || isExplorerBlankTab(lastId) || isExplorerFolderTab(lastId)) return null;
    const safeId = normalizeFolderId(lastId, rootId, params, options);
    return explorerTabIsUsable(safeId, rootId, params, options) && !isExplorerBlankTab(safeId) ? safeId : null;
  }

  function optionTimestamp(options = {}) {
    if (typeof options.now === "function") {
      const value = Number(options.now());
      if (Number.isFinite(value)) return value;
    }
    const value = Number(options.now);
    return Number.isFinite(value) ? value : Date.now();
  }

  function persistExplorerLastFolderForSession(target = {}, params = {}, folderId, rootId = "", options = {}) {
    if (!params || typeof params !== "object") return;
    explorerTabLinks(params);
    const sessionId = normalizeExplorerAnchorId(
      params.explorerSessionRootId || params.explorerOriginalFolderId || params.explorerAnchorFolderId || folderId || rootId,
      rootId,
      params,
      options
    );
    const activeFolderId = explorerFolderIdForTab(
      folderId || params.activeTabId || params.folderId || params.explorerAnchorFolderId,
      params,
      rootId,
      options
    );
    const holder = target?.fs?.[sessionId];
    if (!holder || holder.type !== "folder" || !activeFolderId || isExplorerBlankTab(activeFolderId)) return;
    holder.explorerLastFolderId = activeFolderId;
    holder.explorerLastActiveTabId = params.activeTabId || activeFolderId;
    holder.explorerLastUpdatedAt = optionTimestamp(options);
    holder.updatedAt = optionTimestamp(options);
  }

  function prepareExplorerOpenParams(target = {}, inputParams = {}, options = {}) {
    const rootId = options.rootId || "";
    const copyParams = typeof options.serializableParams === "function"
      ? options.serializableParams
      : value => ({ ...(value || {}) });
    const params = copyParams(inputParams || {});
    explorerTabLinks(params);

    const originalRequestedId = normalizeExplorerAnchorId(
      params.explorerAnchorFolderId || params.folderId || params.activeTabId || rootId,
      rootId,
      params,
      options
    );
    const sessionRootId = normalizeExplorerAnchorId(
      params.explorerSessionRootId || params.explorerOriginalFolderId || originalRequestedId,
      rootId,
      params,
      options
    );
    params.explorerSessionRootId = sessionRootId;
    params.explorerAnchorFolderId = sessionRootId;

    const hasExplicitTabs = Array.isArray(params.explorerTabs);
    const hasExplicitActiveTab = Boolean(params.activeTabId);
    let wantedActive = params.activeTabId || params.folderId || sessionRootId;

    if (!options.restoring && !hasExplicitTabs && !hasExplicitActiveTab) {
      const savedState = savedExplorerTabStateForFolder(target, sessionRootId, rootId, options);
      params.explorerTabs = savedState.tabs;
      params.explorerTabLinks = savedState.links;
      const holder = target?.fs?.[sessionRootId];
      const savedActive = holder?.explorerActiveTabId;
      const lastFolder = explorerLastFolderForSession(target, sessionRootId, rootId, params, options);
      wantedActive = explorerTabIsUsable(savedActive, rootId, params, options)
        ? savedActive
        : (lastFolder || params.explorerTabs[0] || sessionRootId);
    }

    const prepared = normalizeExplorerTabs(params, wantedActive, rootId, options);
    const safeActive = isExplorerBlankTab(wantedActive) || isExplorerFolderTab(wantedActive)
      ? wantedActive
      : normalizeFolderId(wantedActive, rootId, params, options);
    params.activeTabId = prepared.includes(safeActive) ? safeActive : (prepared[0] || sessionRootId);
    params.folderId = isExplorerBlankTab(params.activeTabId)
      ? ""
      : explorerFolderIdForTab(params.activeTabId, params, rootId, options);
    persistExplorerLastFolderForSession(target, params, params.folderId || params.activeTabId, rootId, options);
    return params;
  }

  function persistExplorerTabsForAnchor(target = {}, params = {}, rootId = "", options = {}) {
    explorerTabLinks(params);
    const anchorId = normalizeExplorerAnchorId(
      params.explorerSessionRootId || params.explorerOriginalFolderId || params.explorerAnchorFolderId || rootId,
      rootId,
      params,
      options
    );
    params.explorerAnchorFolderId = anchorId;
    params.explorerSessionRootId = anchorId;
    const tabs = normalizeExplorerTabs(params, params.activeTabId || params.folderId || anchorId, rootId, options);
    const ordered = tabs
      .filter((id, index, list) => id && (isExplorerFolderTab(id) || list.indexOf(id) === index))
      .slice(0, EXPLORER_TAB_LIMIT);
    if (!ordered.length) ordered.push(anchorId);
    const used = new Set(ordered.filter(isExplorerFolderTab));
    Object.keys(params.explorerTabLinks).forEach(key => {
      if (!used.has(key)) delete params.explorerTabLinks[key];
    });
    params.explorerTabs = ordered;
    const holder = target?.fs?.[anchorId];
    if (holder && holder.type === "folder") {
      holder.explorerTabs = ordered;
      holder.explorerTabLinks = { ...params.explorerTabLinks };
      holder.explorerActiveTabId = params.activeTabId || ordered[0] || anchorId;
      holder.updatedAt = optionTimestamp(options);
    }
    persistExplorerLastFolderForSession(target, params, params.activeTabId || params.folderId || anchorId, rootId, options);
  }

  function navigateExplorerTabs(params = {}, folderId = "", options = {}) {
    const rootId = options.rootId || "";
    explorerTabLinks(params);
    const targetId = explorerFolderIdForTab(folderId, params, rootId, options) || normalizeFolderId(folderId, rootId, params, options);
    const tabs = normalizeExplorerTabs(params, params.activeTabId || params.folderId || targetId, rootId, options);
    const activeBefore = params.activeTabId || params.folderId;
    let nextActiveTabId = targetId;

    if (options.newTab) {
      nextActiveTabId = makeExplorerFolderTabId(targetId);
      params.explorerTabLinks[nextActiveTabId] = targetId;
      tabs.push(nextActiveTabId);
    } else if (options.switchTab) {
      nextActiveTabId = folderId;
      if (!tabs.includes(nextActiveTabId)) tabs.push(nextActiveTabId);
    } else {
      const index = tabs.indexOf(activeBefore);
      if (isExplorerFolderTab(activeBefore)) {
        params.explorerTabLinks[activeBefore] = targetId;
        nextActiveTabId = activeBefore;
      } else if (isExplorerBlankTab(activeBefore)) {
        const replacementTabId = makeExplorerFolderTabId(targetId);
        params.explorerTabLinks[replacementTabId] = targetId;
        if (index >= 0) tabs[index] = replacementTabId;
        else tabs.push(replacementTabId);
        nextActiveTabId = replacementTabId;
      } else {
        if (index >= 0) tabs[index] = targetId;
        else if (!tabs.includes(targetId)) tabs.push(targetId);
        nextActiveTabId = targetId;
      }
    }

    params.explorerTabs = tabs.filter(Boolean).slice(0, EXPLORER_TAB_LIMIT);
    params.activeTabId = nextActiveTabId;
    params.folderId = targetId;
    return { targetId, activeTabId: nextActiveTabId, tabs: params.explorerTabs };
  }

  function explorerTabViewModels(tabs = [], activeTabId = "", options = {}) {
    const {
      anchorFolderId = "",
      rootId = "",
      folderIdForTab = id => id,
      pathText = id => String(id || ""),
      folderTitle = id => String(id || ""),
      blankTitle = "Вставь адрес папки и нажми Enter",
      blankLabel = "Пустая вкладка"
    } = options;
    return tabs.map(id => {
      const blank = isExplorerBlankTab(id);
      const tabFolderId = blank ? null : folderIdForTab(id, rootId);
      return {
        id,
        active: id === activeTabId,
        blank,
        title: blank ? blankTitle : pathText(tabFolderId, rootId),
        label: blank ? blankLabel : folderTitle(tabFolderId, rootId),
        canClose: tabs.length > 1 && id !== anchorFolderId
      };
    });
  }

  window.ZETER_EXPLORER_TAB_UTILS = Object.freeze({
    EXPLORER_BLANK_TAB_PREFIX,
    EXPLORER_FOLDER_TAB_PREFIX,
    EXPLORER_TAB_LIMIT,
    makeExplorerBlankTabId,
    isExplorerBlankTab,
    makeExplorerFolderTabId,
    isExplorerFolderTab,
    explorerTabLinks,
    explorerFolderIdForTab,
    explorerTabIsUsable,
    normalizeExplorerAnchorId,
    normalizeExplorerTabs,
    savedExplorerTabStateForFolder,
    savedExplorerTabsForFolder,
    explorerLastFolderForSession,
    persistExplorerLastFolderForSession,
    prepareExplorerOpenParams,
    persistExplorerTabsForAnchor,
    navigateExplorerTabs,
    explorerTabViewModels
  });
})();
