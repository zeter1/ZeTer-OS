(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const explorerTabUtils = window.ZETER_EXPLORER_TAB_UTILS;
  if (!coreUtils || !explorerTabUtils) throw new Error("ZeTer OS explorer UI utils require core and explorer tab utils.");

  const { $, $$, escapeHtml } = coreUtils;
  const safeAttr = escapeHtml;
  const {
    EXPLORER_TAB_LIMIT,
    makeExplorerBlankTabId,
    isExplorerBlankTab,
    isExplorerFolderTab,
    explorerTabLinks,
    explorerTabViewModels
  } = explorerTabUtils;

  function explorerBlankTabHTML() {
    return `
      <div class="explorer-empty-tab">
        <b>Пустая вкладка</b>
        <span>Вставь адрес папки в строку пути и нажми Enter, чтобы открыть нужную папку.</span>
        <small>Например: Проекты / Клиент 1</small>
      </div>`;
  }

  function explorerTreeNodeHTML(node = {}) {
    const children = Array.isArray(node.children) ? node.children : [];
    const hasChildren = Boolean(node.hasChildren || children.length);
    const toggle = node.root
      ? `<span class="tree-toggle tree-toggle-root" aria-hidden="true">${hasChildren ? "▾" : "·"}</span>`
      : `<button class="tree-toggle ${hasChildren ? "" : "empty"}" data-toggle-folder="${safeAttr(node.id)}" title="${hasChildren ? "Развернуть/свернуть" : "Нет подпапок"}">${hasChildren ? (node.expanded ? "▾" : "▸") : "·"}</button>`;
    return `
        <div class="explorer-tree-row ${node.root ? "navigation-root" : ""} ${node.active ? "active" : ""}" style="--level:${Number(node.level) || 0}" data-folder-row="${safeAttr(node.id)}" data-folder-target="${safeAttr(node.id)}"${node.root ? ` data-navigation-root="1"` : ""}>
          ${toggle}
          <button class="tree-name" data-folder="${safeAttr(node.id)}" title="${escapeHtml(node.name)}"><span class="tree-icon" aria-hidden="true">${node.icon || "📁"}</span><span>${escapeHtml(node.name)}</span></button>
        </div>
        ${children.length && node.expanded ? `<div class="explorer-tree-children">${children.map(explorerTreeNodeHTML).join("")}</div>` : ""}
      `;
  }

  function explorerTreeHTML(nodes = []) {
    const foldersHtml = nodes.map(explorerTreeNodeHTML).join("");
    return `
      <div class="explorer-sidebar-section">
        <div class="explorer-side-title">Навигация</div>
        ${foldersHtml || `<div class="pinned-empty">В этом расположении пока нет папок.</div>`}
      </div>
    `;
  }

  function explorerPinnedHTML(items = []) {
    if (!items.length) return "";

    return `
      <div class="explorer-sidebar-section">
        <div class="explorer-side-title">Быстрый доступ</div>
        ${items.map(item => `
          <div class="explorer-pinned-row ${item.active ? "active" : ""}" data-pinned-item="${safeAttr(item.id)}" ${item.folder ? `data-folder-target="${safeAttr(item.id)}"` : ""}>
            <button class="pinned-name" data-open-pinned="${safeAttr(item.id)}" title="${escapeHtml(item.name)}">${item.icon || ""} <span>${escapeHtml(item.name)}</span></button>
            <button class="pinned-unpin" data-pin-toggle="${safeAttr(item.id)}" title="Открепить">📌</button>
          </div>
        `).join("")}
      </div>`;
  }

  function explorerTabsHTML(tabs = []) {
    return tabs.map(tab => `
      <button class="explorer-tab ${tab.active ? "active" : ""} ${tab.blank ? "empty" : ""}" data-open-tab="${safeAttr(tab.id)}" title="${escapeHtml(tab.title)}">
        <span>${escapeHtml(tab.label)}</span>${tab.canClose ? `<i data-close-tab="${safeAttr(tab.id)}" title="Закрыть вкладку">×</i>` : ""}
      </button>`).join("");
  }

  function explorerPathToolbarHTML({
    canGoUp = false,
    pathValue = "",
    activeBlankTab = false,
    showPinButton = false,
    pinButtonLabel = ""
  } = {}) {
    const placeholder = activeBlankTab ? "Вставь адрес папки и нажми Enter" : "Адрес папки";
    return `
        <div class="toolbar explorer-toolbar explorer-path-toolbar">
          <button data-nav="up"${canGoUp ? "" : " disabled"}>⬆ Вверх</button>
          <input class="explorer-path-input" data-path-input value="${escapeHtml(pathValue)}" placeholder="${escapeHtml(placeholder)}" title="Адрес папки. Вставь путь и нажми Enter.">
          ${showPinButton ? `<button data-action="pin-current">${escapeHtml(pinButtonLabel)}</button>` : ""}
          ${activeBlankTab ? "" : `<select data-sort title="Сортировка"><option value="name">Имя</option><option value="type">Тип</option><option value="updated">Дата</option><option value="size">Размер</option></select>
          <select data-view-mode title="Вид"><option value="icons">Плитка</option><option value="list">Список</option><option value="table">Таблица</option><option value="large">Большие иконки</option></select>
          <button data-bulk="select-all" title="Выделить все элементы в текущей папке">☑️ Все</button>
          <input data-search placeholder="Поиск в этой папке и подпапках" style="margin-left:auto;min-width:180px">`}
        </div>`;
  }

  function explorerBulkbarHTML() {
    return `
        <div class="toolbar explorer-bulkbar hidden" data-bulkbar>
          <b data-selection-count>0 выбрано</b>
          <button data-bulk="select-all">Выделить всё</button>
          <button data-bulk="move">Переместить</button>
          <button data-bulk="delete" class="danger-btn">Удалить</button>
          <button data-bulk="download">Скачать</button>
          <button data-bulk="pin">Закрепить</button>
          <button data-bulk="clear">Снять</button>
        </div>`;
  }

  function explorerPreviewEmptyHTML({ pathText = "" } = {}) {
    return `
        <div class="explorer-preview-empty">
          <b>Быстрое превью</b>
          <span>Выдели файл или папку, чтобы увидеть содержимое, размер, дату и быстрые действия.</span>
          <small>${escapeHtml(pathText)}</small>
        </div>`;
  }

  function explorerPreviewMultiHTML({
    count = 0,
    folderCount = 0,
    totalSizeText = "",
    items = [],
    extraCount = 0
  } = {}) {
    const folderText = folderCount ? `${folderCount} папок · ` : "";
    const itemList = items
      .map(item => `<span>${item.icon || ""} ${escapeHtml(item.name)}</span>`)
      .join("");
    return `
        <div class="explorer-preview-head"><span class="explorer-preview-icon">☑️</span><div><b>${count} выбрано</b><small>${escapeHtml(folderText + totalSizeText)}</small></div></div>
        <div class="explorer-preview-actions">
          <button data-preview-action="download">Скачать</button>
          <button data-preview-action="pin">Закрепить</button>
          <button data-preview-action="delete" class="danger-btn">Удалить</button>
        </div>
        <div class="explorer-preview-list">${itemList}${extraCount > 0 ? `<span>…ещё ${extraCount}</span>` : ""}</div>`;
  }

  function explorerPreviewImageBodyHTML({ src = "", name = "" } = {}) {
    return `<img class="explorer-preview-image" src="${safeAttr(src)}" alt="${escapeHtml(name)}">`;
  }

  function explorerPreviewFolderBodyHTML({ childCount = 0, children = [] } = {}) {
    const childList = children
      .map(child => `<span>${child.icon || ""} ${escapeHtml(child.name)}</span>`)
      .join("");
    return `<div class="explorer-preview-folder"><b>${childCount} элементов</b>${childList || `<span>Папка пустая</span>`}</div>`;
  }

  function explorerPreviewTableBodyHTML({ rows = 0, columns = 0, pages = 0 } = {}) {
    return `<div class="explorer-preview-text"><b>Таблица</b><p>${rows} строк · ${columns} столбцов · ${pages} стр.</p></div>`;
  }

  function explorerPreviewTasklistBodyHTML({ tasks = 0, projects = 0 } = {}) {
    return `<div class="explorer-preview-text"><b>Список задач</b><p>${tasks} задач · ${projects} проектов</p></div>`;
  }

  function explorerPreviewTextBodyHTML(text = "") {
    return `<pre class="explorer-preview-text">${escapeHtml(text || "Нет текстового содержимого для превью.")}</pre>`;
  }

  function explorerPreviewSingleHTML({
    icon = "",
    name = "",
    kind = "",
    bodyHTML = "",
    size = "",
    date = "",
    pathText = "",
    folder = false,
    pinned = false
  } = {}) {
    return `
      <div class="explorer-preview-head"><span class="explorer-preview-icon">${icon}</span><div><b>${escapeHtml(name)}</b><small>${escapeHtml(kind)}</small></div></div>
      ${bodyHTML}
      <dl class="explorer-preview-meta">
        <div><dt>Размер</dt><dd>${escapeHtml(size)}</dd></div>
        <div><dt>Изменено</dt><dd>${escapeHtml(date)}</dd></div>
        <div><dt>Путь</dt><dd>${escapeHtml(pathText)}</dd></div>
      </dl>
      <div class="explorer-preview-actions">
        <button data-preview-action="open">Открыть</button>
        ${folder ? `<button data-preview-action="open-tab">Во вкладке</button>` : ""}
        <button data-preview-action="download">Скачать</button>
        <button data-preview-action="pin">${pinned ? "Открепить" : "Закрепить"}</button>
        <button data-preview-action="delete" class="danger-btn">Удалить</button>
      </div>`;
  }

  function explorerGridEmptyHTML({ searchMode = false } = {}) {
    return `
          <b>${searchMode ? "Ничего не найдено" : "Папка пустая"}</b>
          <span>${searchMode ? "Поиск проверяет текущую папку и все вложенные папки. Попробуй другой запрос." : "Создай файл, заметку или папку через правый клик по свободной области. Можно также перетащить сюда файлы с компьютера."}</span>`;
  }

  function explorerFileCardHTML({
    icon = "",
    name = "",
    pinned = false,
    meta = ""
  } = {}) {
    return `<span class="file-emoji">${icon}</span><b>${pinned ? "📌 " : ""}${escapeHtml(name)}</b><small>${escapeHtml(meta)}</small>`;
  }

  function explorerContentHTML({
    activeBlankTab = false,
    currentFolder = "",
    previewHTML = ""
  } = {}) {
    return `
        <div class="explorer-content ${activeBlankTab ? "explorer-content--blank" : ""}">
          ${activeBlankTab ? explorerBlankTabHTML() : `<div class="file-grid explorer-free-grid" data-folder-drop="${safeAttr(currentFolder)}" tabindex="0"></div>
          <aside class="explorer-preview" data-preview>${previewHTML}</aside>`}
        </div>`;
  }

  function explorerShellHTML({
    sidebarDropId = "",
    sidebarHTML = "",
    treeHTML = "",
    tabs = [],
    canGoUp = false,
    pathValue = "",
    activeBlankTab = false,
    showPinButton = false,
    pinButtonLabel = "",
    currentFolder = "",
    previewHTML = ""
  } = {}) {
    return `
      <aside class="explorer-sidebar" data-folder-drop="${safeAttr(sidebarDropId)}">
        ${sidebarHTML}
        ${treeHTML}
      </aside>
      <main class="explorer-main">
        <div class="explorer-tabs" role="tablist">
          ${explorerTabsHTML(tabs)}
          <button class="explorer-tab-add" data-action="new-tab" title="Новая вкладка">+</button>
        </div>
        ${explorerPathToolbarHTML({ canGoUp, pathValue, activeBlankTab, showPinButton, pinButtonLabel })}
        ${explorerBulkbarHTML()}
        ${explorerContentHTML({ activeBlankTab, currentFolder, previewHTML })}
      </main>`;
  }

  function closestElement(target, selector) {
    return target && typeof target.closest === "function" ? target.closest(selector) : null;
  }

  function explorerTabAction(target) {
    const close = closestElement(target, "[data-close-tab]");
    if (close) return { type: "close", tabId: close.dataset.closeTab || "" };
    const tab = closestElement(target, "[data-open-tab]");
    if (tab) return { type: "open", tabId: tab.dataset.openTab || "" };
    return null;
  }

  function explorerBulkAction(target) {
    return closestElement(target, "[data-bulk]")?.dataset?.bulk || "";
  }

  function explorerPreviewAction(target) {
    return closestElement(target, "[data-preview-action]")?.dataset?.previewAction || "";
  }

  function explorerDeleteItemId(target) {
    return closestElement(target, "[data-delete-item]")?.dataset?.deleteItem || "";
  }

  function explorerPinToggleId(target) {
    return closestElement(target, "[data-pin-toggle]")?.dataset?.pinToggle || "";
  }

  function explorerToggleFolderId(target) {
    return closestElement(target, "[data-toggle-folder]")?.dataset?.toggleFolder || "";
  }

  function explorerOpenPinnedId(target) {
    return closestElement(target, "[data-open-pinned]")?.dataset?.openPinned || "";
  }

  function explorerFolderButtonId(target) {
    return closestElement(target, "[data-folder]")?.dataset?.folder || "";
  }

  function explorerCrumbId(target) {
    return closestElement(target, "[data-crumb]")?.dataset?.crumb || "";
  }

  function explorerCreateAction(target) {
    return closestElement(target, "[data-action]")?.dataset?.action || "";
  }

  function explorerNavUpRequested(target) {
    return Boolean(closestElement(target, "[data-nav='up']"));
  }

  function prepareExplorerAppModel(options = {}) {
    const {
      params = {},
      rootId = "",
      getItem = () => null,
      isDesktopRoot = () => false,
      folderRootContext = () => "",
      isExplorerRoot = () => false,
      isInExplorerSpace = () => false,
      explorerFolderIdForTab = () => null,
      explorerBaseRootForFolder = () => rootId,
      normalizeExplorerTabs = () => [],
      persistExplorerTabsForAnchor = () => {},
      explorerPathText = id => String(id || ""),
      explorerFolderTitle = id => String(id || ""),
      explorerAddressText = id => String(id || ""),
      renderPinnedExplorer = () => "",
      renderExplorerTree = () => "",
      explorerPreviewHTML = () => ""
    } = options;
    explorerTabLinks(params);
    const rawActiveTab = params.activeTabId || params.folderId || rootId;
    const requestedBlankTab = isExplorerBlankTab(rawActiveTab);
    let currentFolder = requestedBlankTab ? null : explorerFolderIdForTab(rawActiveTab, params, rootId);
    const requestedFolder = currentFolder;
    const requestedItem = getItem(requestedFolder);
    const desktopRootMode = Boolean(currentFolder && isDesktopRoot(requestedFolder));
    const desktopFolderMode = Boolean(currentFolder && (desktopRootMode || (requestedItem?.type === "folder" && folderRootContext(requestedFolder) === "desktop")));
    if (currentFolder && !desktopFolderMode && !isExplorerRoot(currentFolder)) {
      const folder = getItem(currentFolder);
      if (!folder || folder.type !== "folder" || !isInExplorerSpace(folder, rootId)) currentFolder = rootId;
    }

    const preferredPathRoot = currentFolder ? explorerBaseRootForFolder(currentFolder, rootId) : (params.explorerPathRootId || rootId);
    params.explorerPathRootId = preferredPathRoot;
    params.folderId = currentFolder || "";
    params.activeTabId = requestedBlankTab || isExplorerFolderTab(rawActiveTab) ? rawActiveTab : (currentFolder || rawActiveTab);
    const explorerTabs = normalizeExplorerTabs(params, params.activeTabId || currentFolder || rootId, rootId);
    persistExplorerTabsForAnchor(params, rootId);
    const activeTabId = params.activeTabId;
    const activeBlankTab = isExplorerBlankTab(activeTabId);
    currentFolder = activeBlankTab ? null : explorerFolderIdForTab(activeTabId, params, rootId);

    const pathRootId = currentFolder ? explorerBaseRootForFolder(currentFolder, rootId) : (params.explorerPathRootId || rootId);
    const currentParentId = currentFolder ? (getItem(currentFolder)?.parent || pathRootId) : null;
    const canGoUp = Boolean(currentFolder && currentFolder !== pathRootId && currentParentId && currentParentId !== currentFolder);
    const pathValue = currentFolder ? explorerAddressText(currentFolder, pathRootId) : "";
    const tabs = explorerTabViewModels(explorerTabs, activeTabId, {
      anchorFolderId: params.explorerAnchorFolderId,
      rootId,
      folderIdForTab: id => explorerFolderIdForTab(id, params, rootId),
      pathText: explorerPathText,
      folderTitle: explorerFolderTitle
    });
    const showPinButton = Boolean(!activeBlankTab && !desktopFolderMode);
    const pinButtonLabel = currentFolder === rootId ? "🗂️ Пространство" : (getItem(currentFolder)?.pinnedInExplorer ? "📌 Открепить" : "📌 Закрепить");
    const navigationRootId = currentFolder ? explorerBaseRootForFolder(currentFolder, rootId) : pathRootId;
    const sidebarHTML = renderPinnedExplorer(currentFolder || navigationRootId, navigationRootId);
    const treeHTML = renderExplorerTree(currentFolder || navigationRootId, navigationRootId);
    const previewHTML = activeBlankTab ? "" : explorerPreviewHTML([], currentFolder, rootId);
    return {
      currentFolder,
      preferredPathRoot,
      activeTabId,
      activeBlankTab,
      desktopRootMode,
      desktopFolderMode,
      navigationRootId,
      pathRootId,
      shell: {
        sidebarDropId: activeBlankTab ? "" : (currentFolder || navigationRootId),
        sidebarHTML,
        treeHTML,
        tabs,
        canGoUp,
        pathValue,
        activeBlankTab,
        showPinButton,
        pinButtonLabel,
        currentFolder,
        previewHTML
      }
    };
  }

  function createExplorerApp(options = {}) {
    const {
      model = {},
      params = {},
      winId = "",
      state = {},
      ui = {},
      document,
      window = {},
      serializableParams = value => value,
      isDesktopRoot = () => false,
      isExplorerRoot = () => false,
      enableItemPointerDrag = () => {},
      clearDesktopSelection = () => {},
      explorerPreviewHTML = () => "",
      explorerSearchableItems = () => [],
      sortExplorerItems = items => items,
      explorerItemSize = () => 0,
      explorerFlowLayout = () => ({}),
      explorerSearchGridPosition = () => ({ x: 0, y: 0 }),
      findFreeFolderPosition = () => ({ x: 0, y: 0 }),
      explorerResultLocationText = () => "",
      explorerCardMeta = () => ({}),
      itemDescription = () => "",
      bytesToHuman = value => String(value || 0),
      itemIcon = () => "",
      folderBackgroundDataURL = () => "",
      openItem = () => {},
      navigateFolder = () => {},
      buildExplorerFolderMenuEntries = () => [],
      renameItem = () => {},
      duplicateItem = () => {},
      openItemSettings = () => {},
      showItemProperties = () => {},
      copyItemLocation = () => {},
      deleteItem = () => {},
      showContext = () => {},
      showItemMenu = () => {},
      explorerGridMinSize = () => ({}),
      normalizeExplorerTabs = () => [],
      explorerBaseRootForFolder = () => "",
      persistExplorerTabsForAnchor = () => {},
      refreshWindow = () => {},
      persistOpenWindows = () => {},
      toast = () => {},
      creators = {},
      togglePinnedItem = () => {},
      deleteItems = () => {},
      downloadExplorerItems = async () => {},
      saveState = () => {},
      renderAllFileSurfaces = () => {},
      explorerFolderMoveTargets = () => [],
      explorerPathText = () => "",
      bulkMoveItemsToFolder = () => {},
      expandedExplorerSet = () => new Set(),
      saveExpandedExplorerSet = () => {},
      explorerFolderIdForTab = () => null,
      descendants = () => [],
      confirmDelete = () => false,
      removeFolderReferences = () => {},
      desktopRoot = "desktop",
      positionInFolderGrid = () => ({ x: 0, y: 0 }),
      buildExplorerEmptyAreaMenuEntries = () => [],
      resolveExplorerAddress = () => null,
      importNativeFiles = () => {},
      now = () => Date.now()
    } = options;
    if (!document?.createElement) throw new Error("Explorer app requires a document.");
    const {
      currentFolder,
      preferredPathRoot,
      activeTabId,
      activeBlankTab,
      desktopFolderMode,
      navigationRootId,
      pathRootId
    } = model;
    const rootId = options.rootId || "";
    const fs = state.fs || {};
    const createFolder = creators.folder || (() => {});
    const createFile = creators.file || (() => {});
    const createShortcut = creators.shortcut || (() => {});
    const createTable = creators.table || (() => {});
    const createTaskList = creators.taskList || (() => {});
    const createNote = creators.note || (() => "");
    const openEditor = creators.openEditor || (() => {});
    const updateWindowParams = nextParams => {
      const record = ui.windows?.get?.(winId);
      if (record) record.params = serializableParams(nextParams);
    };
    updateWindowParams(params);
    ui.explorerFolders?.set?.(winId, currentFolder || preferredPathRoot || rootId);

    const root = document.createElement("div");
    root.className = "explorer explorer-pro explorer-plus";
    root.innerHTML = explorerShellHTML(model.shell);
    const folderBackground = String(folderBackgroundDataURL(fs[currentFolder]) || "");
    if (/^data:image\/(?:png|jpe?g|webp|gif|bmp)(?:;base64)?,/i.test(folderBackground)) {
      root.classList.add("has-folder-background");
      root.style.setProperty("--folder-background-image", `url("${folderBackground}")`);
    }

    bindExplorerSidebarDrag(root, {
      listRows: target => $$("[data-folder-row], [data-pinned-item]", target),
      getItem: itemId => fs[itemId],
      isDesktopRoot,
      isExplorerRoot,
      enableDrag: enableItemPointerDrag
    });

    let currentDrawItems = [];
    const explorerSelection = createExplorerSelectionController({
      root,
      getCurrentItems: () => currentDrawItems,
      getItemById: id => fs[id],
      clearDesktopSelection,
      renderPreviewHTML: items => explorerPreviewHTML(items, currentFolder, rootId)
    });
    const { selected, selectedItems, syncSelectionUi, clearSelection, selectByClick, selectAll } = explorerSelection;

    const draw = (drawOptions = {}) => drawExplorerGrid({
      root, options: drawOptions, activeBlankTab, currentFolder, rootId, orderedRootMode: isDesktopRoot(currentFolder), selected,
      bindSelectionBox: bindExplorerSelectionBox,
      clearDesktopSelection, clearSelection, syncSelectionUi,
      setCurrentItems: items => { currentDrawItems = items; },
      getItems: (query, sortMode) => sortExplorerItems(explorerSearchableItems(currentFolder, query), sortMode, explorerItemSize),
      getFlowLayout: explorerFlowLayout,
      getSearchPosition: explorerSearchGridPosition,
      findFreePosition: (item, index) => findFreeFolderPosition(currentFolder, 24 + (index % 4) * 158, 24 + Math.floor(index / 4) * 146, item.id),
      applyPosition: (item, position) => { item.x = position.x; item.y = position.y; },
      getLocation: item => explorerResultLocationText(item, currentFolder, rootId),
      getCardMeta: (item, viewMode, locationText) => explorerCardMeta(item, { viewMode, locationText, itemDescription, itemSize: explorerItemSize, formatBytes: bytesToHuman }),
      getCardIcon: itemIcon,
      selectItem: selectByClick,
      openItem,
      openFolder: folderId => navigateFolder(folderId),
      showFolderMenu: (event, folderId) => {
        event.preventDefault();
        event.stopPropagation();
        const folderEntries = explorerContextMenuEntries(buildExplorerFolderMenuEntries(), action => runExplorerFolderMenuAction(action, {
          folderId,
          navigateFolder,
          openItem,
          renameItem,
          duplicateItem,
          openItemSettings,
          createTaskList,
          copyItemLocation,
          showProperties: showItemProperties,
          deleteItem
        }));
        showContext(event.clientX, event.clientY, folderEntries);
      },
      showItemMenu,
      enableDrag: enableItemPointerDrag,
      gridMinSize: explorerGridMinSize
    });

    const createByAction = action => runExplorerCreateAction(action, {
      currentFolder,
      rootId,
      activeTabId,
      desktopFolderMode,
      params,
      tabLimit: EXPLORER_TAB_LIMIT,
      makeBlankTabId: makeExplorerBlankTabId,
      normalizeTabs: normalizeExplorerTabs,
      explorerBaseRootForFolder,
      persistTabs: persistExplorerTabsForAnchor,
      updateWindowParams,
      refreshWindow,
      persistOpenWindows,
      toast,
      createFolder,
      createFile,
      createTable,
      createTaskList,
      createNote,
      openEditor,
      togglePinnedItem
    });

    const handleBulkAction = (action, event) => runExplorerBulkAction(action, event, {
      selectedItems,
      selectAll,
      clearSelection,
      deleteItems,
      downloadItems: downloadExplorerItems,
      setPinned: (items, shouldPin) => items.forEach(item => { item.pinnedInExplorer = shouldPin; item.updatedAt = now(); }),
      saveState,
      renderAllFileSurfaces,
      toast,
      moveTargets: ids => explorerFolderMoveTargets(ids, currentFolder, rootId),
      pathText: folderId => explorerPathText(folderId, rootId),
      moveItems: bulkMoveItemsToFolder,
      showMoveMenu: (entries, sourceEvent) => showContext(
        sourceEvent?.clientX || window.innerWidth / 2,
        sourceEvent?.clientY || window.innerHeight / 2,
        entries.map(entry => [entry.icon, entry.label, entry.run]),
        { anchorEl: sourceEvent?.target, placement: "below" }
      )
    });

    const runSidebarAction = action => runExplorerSidebarRowAction(action, {
      rootId: navigationRootId,
      getItem: itemId => fs[itemId],
      expandedIds: expandedExplorerSet,
      saveExpandedIds: saveExpandedExplorerSet,
      navigateFolder,
      openItem
    });

    root.addEventListener("click", async event => {
      if (event.target.closest("[data-folder-row][data-drag-just-ended='1'], [data-pinned-item][data-drag-just-ended='1']")) return;

      const tabAction = explorerTabAction(event.target);
      if (tabAction) {
        event.preventDefault();
        event.stopPropagation();
        if (runExplorerTabAction(tabAction, {
          params,
          activeTabId,
          currentFolder,
          rootId,
          normalizeTabs: normalizeExplorerTabs,
          isBlankTab: isExplorerBlankTab,
          folderIdForTab: tabId => explorerFolderIdForTab(tabId, params, rootId),
          tabLinks: explorerTabLinks,
          persistTabs: persistExplorerTabsForAnchor,
          updateWindowParams,
          refreshWindow,
          persistOpenWindows,
          navigateFolder: tabId => navigateFolder(tabId, { switchTab: true })
        })) return;
      }

      const bulkAction = explorerBulkAction(event.target);
      if (bulkAction) {
        event.preventDefault();
        event.stopPropagation();
        handleBulkAction(bulkAction, event);
        return;
      }

      const previewAction = explorerPreviewAction(event.target);
      if (previewAction) {
        event.preventDefault();
        event.stopPropagation();
        if (runExplorerPreviewAction(previewAction, {
          firstItem: selectedItems()[0],
          navigateFolder,
          openItem,
          runBulkAction: action => handleBulkAction(action, event)
        })) return;
      }

      const deleteItemId = explorerDeleteItemId(event.target);
      if (deleteItemId) {
        if (await runExplorerDeleteAction(deleteItemId, {
          currentFolder,
          getItem: itemId => fs[itemId],
          descendants,
          confirmDelete,
          deleteItem: itemId => deleteItem(itemId, { skipConfirm: true }),
          navigateAfterDelete: () => navigateFolder(desktopFolderMode ? desktopRoot : rootId)
        })) return;
      }

      const sidebarAction = explorerSidebarRowAction(event.target);
      if (sidebarAction && !explorerSidebarControlClick(event.target)) {
        if (runSidebarAction(sidebarAction)) return;
      }

      const action = explorerCreateAction(event.target);
      if (action) { createByAction(action); return; }

      runExplorerNavigationAction(explorerNavigationAction(event.target), {
        currentFolder,
        rootId,
        getItem: itemId => fs[itemId],
        isDesktopRoot,
        getExpandedIds: expandedExplorerSet,
        saveExpandedIds: saveExpandedExplorerSet,
        togglePinnedItem,
        refreshWindow,
        navigateFolder,
        openItem
      });
    });

    bindExplorerAuxiliaryEvents(root, {
      isSidebarControl: explorerSidebarControlClick,
      sidebarAction: explorerSidebarRowAction,
      runSidebarAction,
      isDesktopRoot,
      isExplorerRoot,
      getItem: itemId => fs[itemId],
      showItemMenu,
      getGridPosition: positionInFolderGrid,
      buildEmptyAreaMenu: local => explorerContextMenuEntries(buildExplorerEmptyAreaMenuEntries({
        showInExplorerTree: !desktopFolderMode && currentFolder !== rootId
      }), action => runExplorerEmptyAreaMenuAction(action, {
        currentFolder,
        position: local,
        refreshWindow,
        selectAll,
        createFolder,
        createFile,
        createShortcut,
        createTable,
        createTaskList,
        createNote,
        openEditor
      })),
      showContext: (event, entries) => showContext(event.clientX, event.clientY, entries)
    });

    bindExplorerKeyboardAndFilterEvents(root, {
      submitAddress: (rawPath, input) => {
        const targetFolderId = resolveExplorerAddress(rawPath, pathRootId, rootId);
        if (!targetFolderId) {
          toast("Папка не найдена", "Проверь адрес. Пример: Проекты / Клиент 1");
          input.select();
          return;
        }
        navigateFolder(targetFolderId);
      },
      clearDesktopSelection,
      selectAll,
      selectedIds: () => [...selected],
      deleteItems: async ids => {
        const deleted = await deleteItems(ids);
        if (deleted) selected.clear();
        return deleted;
      },
      clearSelection,
      redraw: draw
    });
    bindExplorerFileDropEvents(root, {
      currentFolder: () => currentFolder,
      getGrid: () => $(".file-grid", root),
      gridPosition: positionInFolderGrid,
      importFiles: importNativeFiles,
      isFolderId: folderId => Boolean(
        folderId &&
        (folderId === currentFolder || isDesktopRoot(folderId) || isExplorerRoot(folderId) || fs[folderId]?.type === "folder")
      )
    });
    draw();
    return root;
  }

  function runExplorerCreateAction(action, {
    currentFolder = "",
    rootId = "",
    activeTabId = "",
    desktopFolderMode = false,
    params = {},
    tabLimit = 12,
    makeBlankTabId = () => "",
    normalizeTabs = () => [],
    explorerBaseRootForFolder = () => "",
    persistTabs = () => {},
    updateWindowParams = () => {},
    refreshWindow = () => {},
    persistOpenWindows = () => {},
    toast = () => {},
    createFolder = () => {},
    createFile = () => {},
    createTable = () => {},
    createTaskList = () => {},
    createNote = () => "",
    openEditor = () => {},
    togglePinnedItem = () => {}
  } = {}) {
    if (action === "new-tab") {
      const tabs = normalizeTabs(params, activeTabId || currentFolder || rootId, rootId);
      const blankId = makeBlankTabId();
      tabs.push(blankId);
      params.explorerTabs = tabs.slice(-tabLimit);
      params.activeTabId = blankId;
      params.folderId = "";
      params.explorerPathRootId = currentFolder ? explorerBaseRootForFolder(currentFolder, rootId) : (params.explorerPathRootId || rootId);
      persistTabs(params, rootId);
      updateWindowParams(params);
      refreshWindow();
      persistOpenWindows();
      return true;
    }
    if (!currentFolder) {
      toast("Пустая вкладка", "Сначала вставь адрес папки и нажми Enter.");
      return false;
    }
    if (action === "new-folder") {
      createFolder(currentFolder, { x: 72, y: 72, extra: { showInExplorerTree: !desktopFolderMode && currentFolder !== rootId } });
    }
    if (action === "new-text") createFile(currentFolder, { defaultName: "Новый файл.txt", openAfter: true, x: 72, y: 72 });
    if (action === "new-table") createTable(currentFolder, { openAfter: true, x: 72, y: 72 });
    if (action === "new-tasklist") createTaskList(currentFolder, { openAfter: true, x: 72, y: 72 });
    if (action === "new-note") {
      const id = createNote(currentFolder, { x: 72, y: 72 });
      if (id) openEditor(id);
    }
    if (action === "new-markdown") createFile(currentFolder, { defaultName: "Новый markdown.md", openAfter: true, x: 72, y: 72 });
    if (action === "pin-current" && currentFolder !== rootId && !desktopFolderMode) togglePinnedItem(currentFolder);
    return true;
  }

  async function runExplorerBulkAction(action, event, {
    selectedItems = () => [],
    selectAll = () => {},
    clearSelection = () => {},
    deleteItems = () => {},
    downloadItems = async () => {},
    setPinned = () => {},
    saveState = () => {},
    renderAllFileSurfaces = () => {},
    toast = () => {},
    moveTargets = () => [],
    pathText = () => "",
    moveItems = () => {},
    showMoveMenu = () => {}
  } = {}) {
    const items = selectedItems();
    const ids = items.map(item => item.id);
    if (action === "select-all") {
      selectAll();
      return true;
    }
    if (action === "clear") {
      clearSelection();
      return true;
    }
    if (!items.length) {
      toast("Ничего не выбрано", "Выдели один или несколько элементов.");
      return false;
    }
    if (action === "delete") {
      const deleted = await deleteItems(ids);
      if (deleted) clearSelection();
      return deleted;
    }
    if (action === "download") {
      await downloadItems(items);
      return true;
    }
    if (action === "pin") {
      const shouldPin = !items.every(item => item.pinnedInExplorer);
      setPinned(items, shouldPin);
      saveState();
      renderAllFileSurfaces();
      toast(shouldPin ? "Закреплено" : "Откреплено", `Элементов: ${items.length}`);
      return true;
    }
    if (action === "move") {
      const targets = moveTargets(ids);
      if (!targets.length) {
        toast("Некуда переместить", "Нет подходящих папок для выбранных элементов.");
        return false;
      }
      const entries = targets.slice(0, 20).map(folder => ({
        icon: "📁",
        label: pathText(folder.id),
        run: () => { moveItems(ids, folder.id); clearSelection(); }
      }));
      if (targets.length > 20) entries.push({
        icon: "…",
        label: `Показаны первые 20 из ${targets.length}`,
        run: () => toast("Слишком много папок", "Уточни структуру или перемести через перетаскивание.")
      });
      showMoveMenu(entries, event);
      return true;
    }
    return false;
  }

  function runExplorerTabAction(tabAction, {
    params = {},
    activeTabId = "",
    currentFolder = "",
    rootId = "",
    normalizeTabs = () => [],
    isBlankTab = () => false,
    folderIdForTab = () => "",
    tabLinks = () => ({}),
    persistTabs = () => {},
    updateWindowParams = () => {},
    refreshWindow = () => {},
    persistOpenWindows = () => {},
    navigateFolder = () => {}
  } = {}) {
    if (tabAction?.type === "close") {
      const closeId = tabAction.tabId;
      const tabs = normalizeTabs(params, activeTabId || currentFolder || rootId, rootId).filter(id => id !== closeId);
      delete tabLinks(params)[closeId];
      params.explorerTabs = tabs.length ? tabs : [rootId];
      if (params.activeTabId === closeId) params.activeTabId = params.explorerTabs[0];
      params.folderId = isBlankTab(params.activeTabId) ? "" : folderIdForTab(params.activeTabId);
      persistTabs(params, rootId);
      updateWindowParams(params);
      refreshWindow();
      persistOpenWindows();
      return true;
    }
    if (tabAction?.type === "open") {
      const tabId = tabAction.tabId;
      if (isBlankTab(tabId)) {
        params.activeTabId = tabId;
        params.folderId = "";
        persistTabs(params, rootId);
        updateWindowParams(params);
        refreshWindow();
        persistOpenWindows();
      } else {
        navigateFolder(tabId);
      }
      return true;
    }
    return false;
  }

  function runExplorerPreviewAction(action, {
    firstItem = null,
    navigateFolder = () => {},
    openItem = () => {},
    runBulkAction = () => {}
  } = {}) {
    if (action === "open") {
      if (firstItem) {
        if (firstItem.type === "folder") navigateFolder(firstItem.id);
        else openItem(firstItem.id);
      }
      return true;
    }
    if (action === "open-tab") {
      if (firstItem?.type === "folder") navigateFolder(firstItem.id, { newTab: true });
      return true;
    }
    runBulkAction(action);
    return true;
  }

  function explorerContextMenuEntries(entries = [], onAction = () => {}) {
    return entries.map(entry => {
      if (entry?.type === "separator") return ["", "hr"];
      return [entry?.icon || "", entry?.label || "", () => onAction(entry?.action || {})];
    });
  }

  function runExplorerFolderMenuAction(action = {}, {
    folderId = "",
    navigateFolder = () => {},
    openItem = () => {},
    renameItem = () => {},
    duplicateItem = () => {},
    openItemSettings = () => {},
    createTaskList = () => {},
    copyItemLocation = () => {},
    showProperties = () => {},
    deleteItem = () => {}
  } = {}) {
    if (!folderId) return false;
    if (action.type === "open") navigateFolder(folderId);
    if (action.type === "open-in-tab") navigateFolder(folderId, { newTab: true });
    if (action.type === "open-in-window") openItem(folderId);
    if (action.type === "rename") renameItem(folderId);
    if (action.type === "duplicate") duplicateItem(folderId);
    if (action.type === "item-settings") openItemSettings(folderId);
    if (action.type === "create-task-list") createTaskList(folderId, { openAfter: true, x: 72, y: 72 });
    if (action.type === "copy-location") copyItemLocation(folderId);
    if (action.type === "properties") showProperties(folderId);
    if (action.type === "delete") deleteItem(folderId);
    return true;
  }

  function runExplorerEmptyAreaMenuAction(action = {}, {
    currentFolder = "",
    position = {},
    refreshWindow = () => {},
    selectAll = () => {},
    createFolder = () => {},
    createFile = () => {},
    createShortcut = () => {},
    createTable = () => {},
    createTaskList = () => {},
    createNote = () => "",
    openEditor = () => {}
  } = {}) {
    if (!currentFolder) return false;
    const x = position.x;
    const y = position.y;
    if (action.type === "refresh") refreshWindow();
    if (action.type === "select-all") selectAll();
    if (action.type === "create-folder") createFolder(currentFolder, { x, y, extra: { showInExplorerTree: action.showInExplorerTree } });
    if (action.type === "create-file") createFile(currentFolder, { defaultName: "Новый файл.txt", openAfter: true, x, y });
    if (action.type === "create-shortcut") createShortcut(currentFolder, { x, y });
    if (action.type === "create-table") createTable(currentFolder, { openAfter: true, x, y });
    if (action.type === "create-task-list") createTaskList(currentFolder, { openAfter: true, x, y });
    if (action.type === "create-note") openEditor(createNote(currentFolder, { x, y }));
    if (action.type === "create-markdown") createFile(currentFolder, { defaultName: "Новый markdown.md", openAfter: true, x, y });
    return true;
  }

  function explorerPreviewHTMLFromModel(model = {}, renderers = {}) {
    const {
      empty = () => "",
      multi = () => "",
      image = () => "",
      folder = () => "",
      table = () => "",
      tasklist = () => "",
      text = () => "",
      single = () => ""
    } = renderers;
    if (model.type === "empty") return empty({ pathText: model.pathText });
    if (model.type === "multi") {
      return multi({ count: model.count, folderCount: model.folderCount, totalSizeText: model.totalSizeText, items: model.items, extraCount: model.extraCount });
    }
    let body = "";
    if (model.body?.type === "image") body = image({ src: model.body.src, name: model.body.name });
    else if (model.body?.type === "folder") body = folder({ childCount: model.body.childCount, children: model.body.children });
    else if (model.body?.type === "table") body = table({ rows: model.body.rows, columns: model.body.columns, pages: model.body.pages });
    else if (model.body?.type === "tasklist") body = tasklist({ tasks: model.body.tasks, projects: model.body.projects });
    else body = text(model.body?.text || "");
    return single({
      icon: model.icon,
      name: model.name,
      kind: model.kind,
      bodyHTML: body,
      size: model.size,
      date: model.date,
      pathText: model.pathText,
      folder: model.folder,
      pinned: model.pinned
    });
  }

  function explorerSidebarControlClick(target) {
    return Boolean(closestElement(target, "[data-delete-item],[data-toggle-folder],[data-pin-toggle],.tree-delete,.tree-toggle,.pinned-delete,.pinned-unpin"));
  }

  function bindExplorerSidebarDrag(root, {
    listRows = () => [],
    getItem = () => null,
    isDesktopRoot = () => false,
    isExplorerRoot = () => false,
    enableDrag = () => {}
  } = {}) {
    if (!root || root.dataset.explorerSidebarDragBound === "1") return;
    root.dataset.explorerSidebarDragBound = "1";
    listRows(root).forEach(row => {
      const itemId = row?.dataset?.folderRow || row?.dataset?.pinnedItem;
      if (!getItem(itemId) || isDesktopRoot(itemId) || isExplorerRoot(itemId)) return;
      row.dataset.sidebarDraggable = "1";
      enableDrag(row, itemId, { source: "explorer-sidebar" });
    });
  }

  function explorerSidebarRowAction(target) {
    const folderRow = closestElement(target, "[data-folder-row]");
    if (folderRow) return { type: "folder", itemId: folderRow.dataset.folderRow || "" };
    const pinnedRow = closestElement(target, "[data-pinned-item]");
    if (pinnedRow) return { type: "pinned", itemId: pinnedRow.dataset.pinnedItem || "" };
    return null;
  }

  function runExplorerSidebarRowAction(action, {
    rootId = "",
    getItem = () => null,
    expandedIds = () => new Set(),
    saveExpandedIds = () => {},
    navigateFolder = () => {},
    openItem = () => {}
  } = {}) {
    const itemId = action?.itemId || "";
    const item = getItem(itemId);
    const expanded = expandedIds();
    if (action.type === "folder") {
      if (itemId !== rootId && item?.type !== "folder") return false;
      if (itemId !== rootId) expanded.add(itemId);
      saveExpandedIds(expanded);
      navigateFolder(itemId);
      return true;
    }
    if (action.type === "pinned") {
      if (!item) return false;
      if (item.type === "folder") {
        expanded.add(item.id);
        saveExpandedIds(expanded);
        navigateFolder(item.id);
      } else openItem(item.id);
      return true;
    }
    return false;
  }

  function explorerNavigationAction(target) {
    const pinId = explorerPinToggleId(target);
    if (pinId) return { type: "pin-toggle", itemId: pinId };
    const toggleId = explorerToggleFolderId(target);
    if (toggleId) return { type: "toggle-folder", itemId: toggleId };
    const pinnedId = explorerOpenPinnedId(target);
    if (pinnedId) return { type: "open-pinned", itemId: pinnedId };
    const folderId = explorerFolderButtonId(target);
    if (folderId) return { type: "open-folder", itemId: folderId };
    const crumbId = explorerCrumbId(target);
    if (crumbId) return { type: "crumb", itemId: crumbId };
    if (explorerNavUpRequested(target)) return { type: "up" };
    return null;
  }

  function runExplorerNavigationAction(action, {
    currentFolder = "",
    rootId = "",
    getItem = () => null,
    isDesktopRoot = () => false,
    getExpandedIds = () => new Set(),
    saveExpandedIds = () => {},
    togglePinnedItem = () => {},
    refreshWindow = () => {},
    navigateFolder = () => {},
    openItem = () => {}
  } = {}) {
    if (!action) return false;
    if (action.type === "pin-toggle") {
      togglePinnedItem(action.itemId);
      refreshWindow();
      return true;
    }
    if (action.type === "toggle-folder") {
      const expanded = getExpandedIds();
      expanded.has(action.itemId) ? expanded.delete(action.itemId) : expanded.add(action.itemId);
      saveExpandedIds(expanded);
      refreshWindow();
      return true;
    }
    if (action.type === "open-pinned") {
      const item = getItem(action.itemId);
      if (!item) return true;
      if (item.type === "folder") {
        const expanded = getExpandedIds();
        expanded.add(item.id);
        saveExpandedIds(expanded);
        navigateFolder(item.id);
      } else openItem(item.id);
      return true;
    }
    if (action.type === "open-folder") {
      const expanded = getExpandedIds();
      if (action.itemId !== rootId) expanded.add(action.itemId);
      saveExpandedIds(expanded);
      navigateFolder(action.itemId);
      return true;
    }
    if (action.type === "crumb") {
      navigateFolder(action.itemId);
      return true;
    }
    if (action.type === "up") {
      if (isDesktopRoot(currentFolder)) return true;
      const parent = getItem(currentFolder)?.parent || rootId;
      if (parent && parent !== currentFolder) navigateFolder(parent);
      return true;
    }
    return false;
  }

  async function runExplorerDeleteAction(itemId, {
    currentFolder = "",
    getItem = () => null,
    descendants = () => [],
    confirmDelete = () => false,
    deleteItem = () => {},
    removeFolderReferences = () => {},
    navigateAfterDelete = () => {}
  } = {}) {
    const item = getItem(itemId);
    if (!item) return false;
    const label = item.type === "folder" ? `Удалить папку «${item.name}»?` : `Удалить «${item.name}»?`;
    if (!confirmDelete(label)) return true;
    const removedIds = [itemId, ...descendants(itemId)];
    const deleted = await deleteItem(itemId);
    if (!deleted) return false;
    removeFolderReferences(removedIds);
    if (removedIds.includes(currentFolder)) navigateAfterDelete();
    return true;
  }

  function explorerGridLayoutMode({
    viewMode = "icons",
    searchMode = false,
    orderedRootMode = false
  } = {}) {
    if (viewMode === "list" || viewMode === "table") return "flow";
    if (orderedRootMode && !searchMode) return "ordered";
    return "free";
  }

  function drawExplorerGrid({
    root = null,
    options = {},
    activeBlankTab = false,
    currentFolder = "",
    rootId = "",
    orderedRootMode = false,
    selected = new Set(),
    bindSelectionBox = () => {},
    clearDesktopSelection = () => {},
    clearSelection = () => {},
    syncSelectionUi = () => {},
    setCurrentItems = () => {},
    getItems = () => [],
    getFlowLayout = () => false,
    getSearchPosition = () => ({ x: 0, y: 0 }),
    findFreePosition = () => ({ x: 16, y: 16 }),
    applyPosition = () => {},
    getLocation = () => "",
    getCardMeta = () => "",
    getCardIcon = () => "",
    selectItem = () => {},
    openItem = () => {},
    openFolder = () => {},
    showFolderMenu = () => {},
    showItemMenu = () => {},
    enableDrag = () => {},
    gridMinSize = () => ({ minWidth: "100%", minHeight: "520px" })
  } = {}) {
    const q = ($("[data-search]", root)?.value || "").trim().toLowerCase();
    const grid = $(".file-grid", root);
    if (!grid) return;
    bindSelectionBox(grid, { isDisabled: () => activeBlankTab, clearDesktopSelection, clearSelection, selected, syncSelectionUi });
    const resetScroll = Boolean(options.resetScroll);
    grid.innerHTML = "";
    const sortMode = $("[data-sort]", root)?.value || "name";
    const viewMode = $("[data-view-mode]", root)?.value || "icons";
    const searchMode = Boolean(q);
    const layoutMode = explorerGridLayoutMode({ viewMode, searchMode, orderedRootMode });
    const flowLayout = layoutMode === "flow" || getFlowLayout(viewMode);
    const orderedLayout = layoutMode === "ordered";
    const naturalLayout = flowLayout || orderedLayout;
    grid.dataset.viewMode = viewMode;
    grid.dataset.layoutMode = layoutMode;
    grid.classList.remove("is-empty", "is-searching", "is-ordered");
    if (searchMode) grid.classList.add("is-searching");
    if (orderedLayout) grid.classList.add("is-ordered");
    const items = getItems(q, sortMode);
    setCurrentItems(items);
    const visibleHeight = () => Math.max(520, grid.parentElement?.clientHeight || 0, grid.closest(".explorer-content")?.clientHeight || 0, grid.clientHeight || 0);
    if (!items.length) {
      grid.classList.add("is-empty");
      grid.style.minWidth = "100%";
      grid.style.minHeight = `${visibleHeight()}px`;
      const empty = document.createElement("div");
      empty.className = "explorer-empty";
      empty.innerHTML = explorerGridEmptyHTML({ searchMode });
      grid.appendChild(empty);
      if (resetScroll) { grid.scrollLeft = 0; grid.scrollTop = 0; }
      syncSelectionUi();
      return;
    }
    let maxBottom = 220;
    let maxRight = 620;
    items.forEach((item, index) => {
      const searchPosition = getSearchPosition(index);
      let cardX = Number.isFinite(item.x) ? item.x : null;
      let cardY = Number.isFinite(item.y) ? item.y : null;
      if (searchMode) { cardX = searchPosition.x; cardY = searchPosition.y; }
      else if (!naturalLayout && (cardX === null || cardY === null)) {
        const position = findFreePosition(item, index);
        applyPosition(item, position);
        cardX = position.x;
        cardY = position.y;
      }
      const card = document.createElement("button");
      card.className = "file-card explorer-file-icon";
      card.dataset.itemId = item.id;
      if (item.type === "folder") card.dataset.folderTarget = item.id;
      if (naturalLayout) { card.style.removeProperty("left"); card.style.removeProperty("top"); }
      else { card.style.left = `${cardX ?? 16}px`; card.style.top = `${cardY ?? 16}px`; }
      card.innerHTML = explorerFileCardHTML({ icon: getCardIcon(item), name: item.name, pinned: Boolean(item.pinnedInExplorer), meta: getCardMeta(item, viewMode, searchMode ? getLocation(item) : "") });
      card.addEventListener("click", event => {
        if (card.dataset.dragJustEnded === "1") return;
        event.stopPropagation();
        selectItem(item.id, event);
      });
      card.addEventListener("dblclick", event => {
        event.preventDefault();
        event.stopPropagation();
        if (item.type === "folder") openFolder(item.id);
        else openItem(item.id);
      });
      card.addEventListener("contextmenu", event => {
        if (!selected.has(item.id)) selectItem(item.id, event);
        if (item.type === "folder") showFolderMenu(event, item.id);
        else showItemMenu(event, item.id);
      });
      enableDrag(card, item.id, { source: "explorer" });
      grid.appendChild(card);
      if (!naturalLayout) {
        const cardW = Math.max(150, card.offsetWidth || card.scrollWidth || 150);
        const cardH = Math.max(124, card.offsetHeight || card.scrollHeight || 124);
        maxRight = Math.max(maxRight, (cardX || 0) + cardW + 20);
        maxBottom = Math.max(maxBottom, (cardY || 0) + cardH + 20);
      }
    });
    const size = orderedLayout
      ? { minWidth: "100%", minHeight: "100%" }
      : gridMinSize({ flowLayout, itemCount: items.length, visibleWidth: Math.max(grid.parentElement?.clientWidth || 0, grid.clientWidth || 0), visibleHeight: visibleHeight(), maxRight, maxBottom });
    grid.style.minWidth = size.minWidth;
    grid.style.minHeight = size.minHeight;
    if (resetScroll) { grid.scrollLeft = 0; grid.scrollTop = 0; }
    syncSelectionUi();
  }

  function bindExplorerAuxiliaryEvents(root, {
    isSidebarControl = () => false,
    sidebarAction = () => null,
    runSidebarAction = () => false,
    isDesktopRoot = () => false,
    isExplorerRoot = () => false,
    getItem = () => null,
    showItemMenu = () => {},
    getGridPosition = () => ({ x: 0, y: 0 }),
    buildEmptyAreaMenu = () => [],
    showContext = () => {}
  } = {}) {
    if (!root) return;
    root.addEventListener("dblclick", event => {
      if (isSidebarControl(event.target)) return;
      const action = sidebarAction(event.target);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      runSidebarAction(action);
    });
    root.addEventListener("contextmenu", event => {
      const sidebarActionValue = sidebarAction(event.target);
      if (sidebarActionValue?.itemId) {
        const item = getItem(sidebarActionValue.itemId);
        if (!isDesktopRoot(sidebarActionValue.itemId) && !isExplorerRoot(sidebarActionValue.itemId) && item) {
          event.preventDefault();
          event.stopPropagation();
          showItemMenu(event, sidebarActionValue.itemId);
        }
        return;
      }
      const grid = closestElement(event.target, ".explorer-free-grid");
      if (!grid || !root.contains(grid) || closestElement(event.target, ".explorer-file-icon,.file-card")) return;
      event.preventDefault();
      event.stopPropagation();
      const position = getGridPosition(grid, event.clientX, event.clientY);
      showContext(event, buildEmptyAreaMenu(position));
    });
  }

  function bindExplorerKeyboardAndFilterEvents(root, {
    submitAddress = () => {},
    clearDesktopSelection = () => {},
    selectAll = () => {},
    selectedIds = () => [],
    deleteItems = () => {},
    clearSelection = () => {},
    redraw = () => {}
  } = {}) {
    if (!root) return;
    root.addEventListener("click", event => {
      const grid = closestElement(event.target, ".explorer-free-grid");
      if (grid?.dataset.selectionJustEnded === "1") return;
      if (grid && !closestElement(event.target, ".explorer-file-icon,.file-card") && !closestElement(event.target, ".explorer-empty")) clearSelection();
    });
    root.addEventListener("keydown", event => {
      if (event.target.matches("[data-path-input]") && event.key === "Enter") {
        event.preventDefault();
        submitAddress(event.target.value || "", event.target);
        return;
      }
      if (event.target.matches("input,textarea,select")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        event.stopPropagation();
        clearDesktopSelection();
        selectAll();
        return;
      }
      if (event.key === "Delete") {
        event.stopPropagation();
        clearDesktopSelection();
        const ids = selectedIds();
        if (ids.length) {
          event.preventDefault();
          deleteItems(ids);
        }
        return;
      }
      if (event.key === "Escape") {
        event.stopPropagation();
        clearSelection();
      }
    });
    root.addEventListener("input", event => {
      if (!event.target.matches("[data-search]")) return;
      clearSelection();
      redraw({ resetScroll: true });
    });
    root.addEventListener("change", event => {
      if (!event.target.matches("[data-sort], [data-view-mode]")) return;
      clearSelection();
      redraw({ resetScroll: true });
    });
  }

  function explorerFileDropTarget(target, {
    root = null,
    currentFolder = "",
    isFolderId = () => false
  } = {}) {
    if (!target || !root || !root.contains?.(target)) return null;
    const folderTarget = closestElement(target, "[data-folder-target]");
    const folderId = folderTarget?.dataset?.folderTarget || "";
    if (folderId && isFolderId(folderId)) return { folderId, element: folderTarget, directFolder: true };

    const explicitDrop = closestElement(target, "[data-folder-drop]");
    const explicitFolderId = explicitDrop?.dataset?.folderDrop || "";
    if (explicitFolderId && isFolderId(explicitFolderId)) {
      return { folderId: explicitFolderId, element: explicitDrop, directFolder: false };
    }

    if (!currentFolder || !isFolderId(currentFolder)) return null;
    const grids = Array.from(root.querySelectorAll?.(".explorer-free-grid[data-folder-drop]") || []);
    const grid = grids.find(element => element.dataset?.folderDrop === currentFolder) || grids[0] || root;
    return { folderId: currentFolder, element: grid, directFolder: false };
  }

  function clearExplorerFileDropMarks(root) {
    Array.from(root?.querySelectorAll?.(".folder-drop-hover") || [])
      .forEach(element => element.classList?.remove("folder-drop-hover"));
  }

  function bindExplorerFileDropEvents(root, {
    currentFolder = () => "",
    getGrid = () => null,
    gridPosition = () => ({ x: 0, y: 0 }),
    importFiles = () => {},
    isFolderId = () => false
  } = {}) {
    if (!root) return;
    root.addEventListener("dragover", event => {
      if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
      const target = explorerFileDropTarget(event.target, { root, currentFolder: currentFolder(), isFolderId });
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      clearExplorerFileDropMarks(root);
      target.element?.classList?.add("folder-drop-hover");
    });
    root.addEventListener("dragleave", event => {
      if (!root.contains(event.relatedTarget)) clearExplorerFileDropMarks(root);
    });
    root.addEventListener("drop", event => {
      if (!event.dataTransfer?.files?.length) return;
      const target = explorerFileDropTarget(event.target, { root, currentFolder: currentFolder(), isFolderId });
      const grid = getGrid();
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      clearExplorerFileDropMarks(root);
      const position = grid && target.folderId === currentFolder()
        ? gridPosition(grid, event.clientX, event.clientY)
        : { x: 0, y: 0 };
      importFiles(event.dataTransfer.files, target.folderId, position.x + 72, position.y + 54);
    });
  }

  function bindExplorerSelectionBox(grid, {
    isDisabled = () => false,
    clearDesktopSelection = () => {},
    clearSelection = () => {},
    selected = new Set(),
    syncSelectionUi = () => {}
  } = {}) {
    if (!grid || grid.dataset.explorerSelectionBound === "1") return;
    grid.dataset.explorerSelectionBound = "1";
    let drag = null;
    let box = null;

    const removeBox = () => {
      if (box) box.remove();
      box = null;
    };

    const finish = event => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      removeBox();
      grid.classList.remove("is-selecting");
      if (moved) {
        grid.dataset.selectionJustEnded = "1";
        setTimeout(() => { delete grid.dataset.selectionJustEnded; }, 80);
      }
      try { grid.releasePointerCapture?.(event.pointerId); } catch {}
    };

    grid.addEventListener("pointerdown", event => {
      if (event.button !== 0 || isDisabled()) return;
      if (closestElement(event.target, ".explorer-file-icon,.file-card,.explorer-empty,.context-menu,input,textarea,select,button")) return;
      event.preventDefault();
      event.stopPropagation();
      clearDesktopSelection();
      grid.focus({ preventScroll: true });
      const rect = grid.getBoundingClientRect();
      drag = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: event.clientX - rect.left + grid.scrollLeft,
        startY: event.clientY - rect.top + grid.scrollTop,
        moved: false
      };
      clearSelection();
      box = document.createElement("div");
      box.className = "explorer-selection-box";
      box.style.left = `${drag.startX}px`;
      box.style.top = `${drag.startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      grid.appendChild(box);
      grid.classList.add("is-selecting");
      grid.setPointerCapture?.(event.pointerId);
    });

    grid.addEventListener("pointermove", event => {
      if (!drag || !box) return;
      const rect = grid.getBoundingClientRect();
      const x = event.clientX - rect.left + grid.scrollLeft;
      const y = event.clientY - rect.top + grid.scrollTop;
      const left = Math.min(drag.startX, x);
      const top = Math.min(drag.startY, y);
      const width = Math.abs(x - drag.startX);
      const height = Math.abs(y - drag.startY);
      drag.moved = drag.moved || Math.abs(event.clientX - drag.startClientX) > 3 || Math.abs(event.clientY - drag.startClientY) > 3;
      Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      const selectRect = {
        left: Math.min(drag.startClientX, event.clientX),
        top: Math.min(drag.startClientY, event.clientY),
        right: Math.max(drag.startClientX, event.clientX),
        bottom: Math.max(drag.startClientY, event.clientY)
      };
      selected.clear();
      $$(".explorer-file-icon", grid).forEach(card => {
        const rect = card.getBoundingClientRect();
        const hit = !(rect.right < selectRect.left || rect.left > selectRect.right || rect.bottom < selectRect.top || rect.top > selectRect.bottom);
        if (hit) selected.add(card.dataset.itemId);
      });
      syncSelectionUi();
    });

    grid.addEventListener("pointerup", finish);
    grid.addEventListener("pointercancel", finish);
  }

  function createExplorerSelectionController({
    root = null,
    getCurrentItems = () => [],
    getItemById = () => null,
    clearDesktopSelection = () => {},
    renderPreviewHTML = () => ""
  } = {}) {
    const selected = new Set();
    let lastSelectedId = null;

    const currentItems = () => {
      const items = typeof getCurrentItems === "function" ? getCurrentItems() : [];
      return Array.isArray(items) ? items.filter(Boolean) : [];
    };

    const selectedItems = () => {
      const visible = new Set(currentItems().map(item => item.id).filter(Boolean));
      return [...selected]
        .map(id => getItemById(id))
        .filter(item => item && visible.has(item.id) && !item.deletedAt);
    };

    const syncSelectionUi = () => {
      const valid = new Set(currentItems().map(item => item.id).filter(Boolean));
      [...selected].forEach(id => { if (!valid.has(id)) selected.delete(id); });
      if (!root) return;
      $$(".explorer-file-icon", root).forEach(card => card.classList.toggle("selected", selected.has(card.dataset.itemId)));
      const items = selectedItems();
      const bulkbar = $("[data-bulkbar]", root);
      if (bulkbar) bulkbar.classList.toggle("hidden", items.length < 2);
      const count = $("[data-selection-count]", root);
      if (count) count.textContent = `${items.length} выбрано`;
      const preview = $("[data-preview]", root);
      if (preview) preview.innerHTML = renderPreviewHTML(items);
    };

    const clearSelection = () => {
      selected.clear();
      lastSelectedId = null;
      syncSelectionUi();
    };

    const selectByClick = (itemId, event) => {
      clearDesktopSelection();
      const focusTarget = event?.currentTarget;
      if (focusTarget && typeof focusTarget.focus === "function") {
        focusTarget.focus({ preventScroll: true });
      }
      if (event?.shiftKey && lastSelectedId) {
        const ids = currentItems().map(item => item.id);
        const a = ids.indexOf(lastSelectedId);
        const b = ids.indexOf(itemId);
        if (a >= 0 && b >= 0) {
          selected.clear();
          ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(id => selected.add(id));
        } else {
          selected.add(itemId);
        }
      } else if (event?.ctrlKey || event?.metaKey) {
        selected.has(itemId) ? selected.delete(itemId) : selected.add(itemId);
        lastSelectedId = itemId;
      } else {
        selected.clear();
        selected.add(itemId);
        lastSelectedId = itemId;
      }
      syncSelectionUi();
    };

    const selectAll = () => {
      currentItems().forEach(item => selected.add(item.id));
      syncSelectionUi();
    };

    return {
      selected,
      selectedItems,
      syncSelectionUi,
      clearSelection,
      selectByClick,
      selectAll
    };
  }

  window.ZETER_EXPLORER_UI_UTILS = Object.freeze({
    explorerBlankTabHTML,
    explorerTreeHTML,
    explorerPinnedHTML,
    explorerTabsHTML,
    explorerPathToolbarHTML,
    explorerBulkbarHTML,
    explorerPreviewEmptyHTML,
    explorerPreviewMultiHTML,
    explorerPreviewImageBodyHTML,
    explorerPreviewFolderBodyHTML,
    explorerPreviewTableBodyHTML,
    explorerPreviewTasklistBodyHTML,
    explorerPreviewTextBodyHTML,
    explorerPreviewSingleHTML,
    explorerGridEmptyHTML,
    explorerFileCardHTML,
    explorerContentHTML,
    explorerShellHTML,
    explorerTabAction,
    explorerBulkAction,
    explorerPreviewAction,
    explorerDeleteItemId,
    explorerPinToggleId,
    explorerToggleFolderId,
    explorerOpenPinnedId,
    explorerFolderButtonId,
    explorerCrumbId,
    explorerCreateAction,
    explorerNavUpRequested,
    prepareExplorerAppModel,
    createExplorerApp,
    runExplorerCreateAction,
    runExplorerBulkAction,
    runExplorerTabAction,
    runExplorerPreviewAction,
    explorerContextMenuEntries,
    runExplorerFolderMenuAction,
    runExplorerEmptyAreaMenuAction,
    explorerPreviewHTMLFromModel,
    explorerSidebarControlClick,
    bindExplorerSidebarDrag,
    explorerSidebarRowAction,
    runExplorerSidebarRowAction,
    explorerNavigationAction,
    runExplorerNavigationAction,
    runExplorerDeleteAction,
    explorerGridLayoutMode,
    drawExplorerGrid,
    bindExplorerAuxiliaryEvents,
    bindExplorerKeyboardAndFilterEvents,
    explorerFileDropTarget,
    clearExplorerFileDropMarks,
    bindExplorerFileDropEvents,
    bindExplorerSelectionBox,
    createExplorerSelectionController
  });
})();
