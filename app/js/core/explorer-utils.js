(() => {
  "use strict";

  const assetUtils = window.ZETER_ASSET_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const exportUtils = window.ZETER_EXPORT_UTILS;
  const tableUtils = window.ZETER_TABLE_UTILS;
  const readableExportUtils = window.ZETER_READABLE_EXPORT_UTILS;

  if (!assetUtils || !dataNormalizers || !exportUtils || !tableUtils || !readableExportUtils) {
    throw new Error("ZeTer OS explorer utils require core modules.");
  }

  const {
    isDataImage,
    parseDataUrl,
    mimeToExtension,
    dataUrlToBlob,
    dataUrlByteLength
  } = assetUtils;
  const {
    normalizeTaskStore
  } = dataNormalizers;
  const {
    sanitizeExportPathPart,
    tablePageToCSV
  } = exportUtils;
  const {
    normalizeTableData,
    activeTablePage
  } = tableUtils;
  const {
    formatTasksAsText
  } = readableExportUtils;

  function normalizeExplorerAddressInput(value = "", desktopNames = []) {
    const desktopNameSet = new Set([
      "рабочий стол",
      "основной",
      ...desktopNames
    ].map(name => String(name || "").trim().toLowerCase()).filter(Boolean));
    const parts = String(value || "")
      .replace(/\\/g, "/")
      .replace(/>/g, "/")
      .split("/")
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => ![".", "корень"].includes(part.toLowerCase()));
    while (parts.length && desktopNameSet.has(parts[0].toLowerCase())) parts.shift();
    return parts;
  }

  function explorerPathPartsForFs(folderId, fs = {}, options = {}) {
    const {
      baseId = "",
      rootId = "",
      isBlank = () => false,
      isDesktopRoot = () => false,
      isExplorerRoot = () => false,
      folderLabel = "Папка"
    } = options;
    if (!folderId || isBlank(folderId)) return [];
    if (folderId === baseId || folderId === rootId || isDesktopRoot(folderId) || isExplorerRoot(folderId)) return [];

    const chain = [];
    let id = folderId;
    const guard = new Set();
    while (id && id !== baseId && id !== rootId && !guard.has(id)) {
      guard.add(id);
      const item = fs?.[id];
      if (!item || item.type !== "folder") break;
      chain.unshift({ id: item.id, name: item.name || folderLabel });
      id = item.parent;
    }
    return chain;
  }

  function explorerAddressTextFromParts(parts = []) {
    return parts.map(part => part.name).join(" / ");
  }

  function explorerPathTextFromParts(parts = [], rootLabel = "Корень") {
    return explorerAddressTextFromParts(parts) || rootLabel;
  }

  function findExplorerFolderChildByName(fs = {}, parentId, name) {
    const target = String(name || "").trim().toLowerCase();
    if (!target) return null;
    return Object.values(fs || {}).find(item =>
      item &&
      item.type === "folder" &&
      item.parent === parentId &&
      !item.deletedAt &&
      !item.hiddenInExplorer &&
      item.systemRole !== "explorerRoot" &&
      String(item.name || "").trim().toLowerCase() === target
    ) || null;
  }

  function resolveExplorerAddressParts(fs = {}, parts = [], roots = []) {
    const safeRoots = roots.filter((id, index, arr) => id && arr.indexOf(id) === index);
    if (!parts.length) return safeRoots[0] || null;
    for (const startRoot of safeRoots) {
      let current = startRoot;
      let ok = true;
      for (const part of parts) {
        const next = findExplorerFolderChildByName(fs, current, part);
        if (!next) { ok = false; break; }
        current = next.id;
      }
      if (ok) return current;
    }
    return null;
  }

  const EXPLORER_PINNED_ITEM_TYPES = Object.freeze([
    "folder",
    "text",
    "note",
    "markdown",
    "table",
    "tasklist",
    "shortcut",
    "image",
    "paint"
  ]);

  function explorerFolderChildrenForFs(fs = {}, parentId) {
    return Object.values(fs || {})
      .filter(item =>
        item?.type === "folder" &&
        item.parent === parentId &&
        !item.deletedAt &&
        !item.hiddenInExplorer &&
        item.systemRole !== "explorerRoot"
      )
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
  }

  function isExplorerRootInTarget(target = {}, id) {
    return Object.values(target?.desktops || {}).some(desktop => desktop?.data?.explorerRootId === id) ||
      target?.fs?.[id]?.systemRole === "explorerRoot";
  }

  function explorerFolderRootContextForFs(fs = {}, folderId, options = {}) {
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    if (isExplorerRoot(folderId)) return "explorer";
    if (isDesktopRoot(folderId)) return "desktop";
    let item = fs?.[folderId];
    while (item && item.parent) {
      if (isExplorerRoot(item.parent)) return "explorer";
      if (isDesktopRoot(item.parent)) return "desktop";
      item = fs?.[item.parent];
    }
    return "desktop";
  }

  function explorerItemIsInSpace(fs = {}, item, explorerRoot = "", options = {}) {
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    if (!item) return false;
    if (item.id === explorerRoot || item.parent === explorerRoot) return true;
    let parent = fs?.[item.parent];
    while (parent) {
      if (parent.id === explorerRoot || parent.parent === explorerRoot) return true;
      if (isDesktopRoot(parent.parent)) return false;
      parent = fs?.[parent.parent];
    }
    return false;
  }

  function explorerFolderAncestorIdsForFs(fs = {}, folderId, options = {}) {
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const ids = [];
    let current = fs?.[folderId];
    while (current && current.parent && !isDesktopRoot(current.parent)) {
      ids.push(current.parent);
      current = fs?.[current.parent];
    }
    return ids;
  }

  function explorerTreeNodesForFs(fs = {}, currentFolder = "", rootId = "", options = {}) {
    const expanded = options.expandedIds instanceof Set
      ? new Set(options.expandedIds)
      : new Set(Array.isArray(options.expandedIds) ? options.expandedIds : []);
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    explorerFolderAncestorIdsForFs(fs, currentFolder, { isDesktopRoot }).forEach(id => expanded.add(id));
    if (currentFolder) expanded.add(currentFolder);

    const buildNode = (folder, level = 0, nodeOptions = {}) => {
      const children = explorerFolderChildrenForFs(fs, folder.id);
      const isRoot = Boolean(nodeOptions.root);
      const isExpanded = isRoot || expanded.has(folder.id);
      return {
        id: folder.id,
        name: folder.name,
        icon: nodeOptions.icon || "📁",
        level,
        expanded: isExpanded,
        active: currentFolder === folder.id,
        root: isRoot,
        hasChildren: children.length > 0,
        children: children.length && isExpanded ? children.map(child => buildNode(child, level + 1)) : []
      };
    };

    const rootChildren = explorerFolderChildrenForFs(fs, rootId);
    if (!options.includeRoot) return rootChildren.map(folder => buildNode(folder, 0));
    return [buildNode({
      id: rootId,
      name: options.rootName || "Файлы ZeTer OS"
    }, 0, {
      root: true,
      icon: options.rootIcon || "🗂️"
    })];
  }

  function explorerPinnedEntriesForItems(items = [], currentFolder = "", explorerRoot = "", options = {}) {
    const fs = options.fs && typeof options.fs === "object" ? options.fs : {};
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const allowedTypes = new Set(Array.isArray(options.allowedTypes) ? options.allowedTypes : EXPLORER_PINNED_ITEM_TYPES);

    return items
      .filter(item => item?.pinnedInExplorer && explorerItemIsInSpace(fs, item, explorerRoot, { isDesktopRoot }) && allowedTypes.has(item.type))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"))
      .map(item => ({
        id: item.id,
        name: item.name,
        icon: itemIcon(item),
        folder: item.type === "folder",
        active: currentFolder === item.id
      }));
  }

  function explorerItemSize(item = {}) {
    try {
      if (item.dataURL) return dataUrlByteLength(item.dataURL);
      if (["text", "note", "markdown"].includes(item.type)) return new Blob([item.content || item.richContent || ""]).size;
      return new Blob([JSON.stringify(item)]).size;
    } catch {
      return 0;
    }
  }

  function explorerItemIsVisibleInGrid(item) {
    return item && !item.deletedAt && !item.hiddenInExplorer && !item.hiddenFromDesktop && item.systemRole !== "explorerRoot";
  }

  function explorerFlowLayout(viewMode = "icons") {
    return viewMode === "list" || viewMode === "table";
  }

  function sortExplorerItems(items = [], sortMode = "name", itemSize = explorerItemSize) {
    return [...items].sort((a, b) => {
      if (a.pinnedInExplorer && !b.pinnedInExplorer) return -1;
      if (!a.pinnedInExplorer && b.pinnedInExplorer) return 1;
      if (a.type === "folder" && b.type !== "folder") return -1;
      if (a.type !== "folder" && b.type === "folder") return 1;
      if (sortMode === "type") return String(a.type).localeCompare(String(b.type), "ru") || String(a.name).localeCompare(String(b.name), "ru");
      if (sortMode === "updated") return Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0);
      if (sortMode === "size") return itemSize(b) - itemSize(a);
      return String(a.name).localeCompare(String(b.name), "ru");
    });
  }

  function explorerSearchGridPosition(index = 0) {
    const safeIndex = Math.max(0, Math.round(Number(index) || 0));
    return {
      x: 24 + (safeIndex % 6) * 158,
      y: 24 + Math.floor(safeIndex / 6) * 146
    };
  }

  function explorerCardMeta(item = {}, options = {}) {
    const {
      viewMode = "icons",
      locationText = "",
      itemDescription = () => "",
      itemSize = explorerItemSize,
      formatBytes = value => String(value || 0)
    } = options;
    const baseMeta = viewMode === "table"
      ? `${itemDescription(item)} · ${formatBytes(itemSize(item))}`
      : itemDescription(item);
    return locationText ? `${baseMeta} · ${locationText}` : baseMeta;
  }

  function explorerGridMinSize(options = {}) {
    const {
      flowLayout = false,
      itemCount = 0,
      visibleWidth = 0,
      visibleHeight = 520,
      maxRight = 620,
      maxBottom = 220
    } = options;
    if (flowLayout) {
      return {
        minWidth: "100%",
        minHeight: `${Math.max(visibleHeight, itemCount * 72 + 24)}px`
      };
    }
    return {
      minWidth: `${Math.max(maxRight, visibleWidth)}px`,
      minHeight: `${Math.max(maxBottom, visibleHeight)}px`
    };
  }

  function explorerSearchableItemsForFs(fs = {}, folderId, query = "", options = {}) {
    const {
      descendantsForId = () => [],
      itemDescription = () => "",
      explorerAddressText = () => "",
      explorerBaseRootForFolder = () => "",
      searchMatch = () => false
    } = options;
    const q = String(query || "").trim().toLowerCase();
    const ids = q
      ? descendantsForId(folderId)
      : Object.values(fs || {}).filter(item => item && item.parent === folderId).map(item => item.id);
    return ids
      .map(id => fs[id])
      .filter(explorerItemIsVisibleInGrid)
      .filter(item => !q || searchMatch(
        q,
        item.name,
        item.content,
        item.richContent,
        item.type,
        itemDescription(item),
        explorerAddressText(item.parent || folderId, explorerBaseRootForFolder(folderId))
      ));
  }

  function explorerResultLocationTextForItem(item, currentFolder, options = {}) {
    const {
      rootId = "",
      rootLabel = "Корень",
      explorerBaseRootForFolder = () => rootId,
      explorerAddressText = () => ""
    } = options;
    if (!item || item.parent === currentFolder) return "";
    const pathRoot = explorerBaseRootForFolder(currentFolder, rootId);
    return explorerAddressText(item.parent, pathRoot) || rootLabel;
  }

  function explorerFolderMoveTargetsForFs(fs = {}, selectedIds = [], currentFolder = "", options = {}) {
    const {
      rootId = "",
      canMoveInto = () => false,
      isExplorerRoot = () => false,
      isInExplorerSpace = () => false,
      folderRootContext = () => "",
      explorerPathText = () => ""
    } = options;
    const selected = new Set(selectedIds);
    return Object.values(fs || {})
      .filter(item => item && item.type === "folder" && !item.deletedAt && !item.hiddenInExplorer && !selected.has(item.id))
      .filter(folder => folder.id !== currentFolder)
      .filter(folder => selectedIds.every(id => canMoveInto(id, folder.id)))
      .filter(folder => isExplorerRoot(folder.id) || isInExplorerSpace(folder, rootId) || folderRootContext(folder.id) === "desktop")
      .sort((a, b) => explorerPathText(a.id, rootId).localeCompare(explorerPathText(b.id, rootId), "ru"));
  }

  function canMoveExplorerItemIntoFolder(fs = {}, itemId, folderId, options = {}) {
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    if (itemId === folderId) return false;
    let current = fs?.[folderId];
    while (current && current.parent && !isDesktopRoot(current.parent)) {
      if (current.parent === itemId) return false;
      current = fs?.[current.parent];
    }
    return true;
  }

  function explorerSingleMovePlanForFs(fs = {}, itemId, folderId, options = {}) {
    const item = fs?.[itemId];
    if (!item) return { valid: false, reason: "missing-item" };
    const folder = fs?.[folderId];
    if (!folder || folder.type !== "folder") return { valid: false, reason: "invalid-folder" };
    if (!canMoveExplorerItemIntoFolder(fs, itemId, folderId, options)) {
      return { valid: false, reason: "forbidden-target" };
    }
    return { valid: true, itemId, folderId };
  }

  function applyExplorerSingleMovePlan(fs = {}, movePlan = {}, options = {}) {
    if (!movePlan?.valid) return { applied: false, reason: movePlan?.reason || "invalid-plan" };
    const item = fs?.[movePlan.itemId];
    const folder = fs?.[movePlan.folderId];
    if (!item) return { applied: false, reason: "missing-item" };
    if (!folder || folder.type !== "folder") return { applied: false, reason: "invalid-folder" };

    const findFreeFolderPosition = typeof options.findFreeFolderPosition === "function"
      ? options.findFreeFolderPosition
      : () => ({ x: 36, y: 36 });
    const preferredX = Number.isFinite(options.targetX) ? options.targetX : 36;
    const preferredY = Number.isFinite(options.targetY) ? options.targetY : 36;
    const position = findFreeFolderPosition(movePlan.folderId, preferredX, preferredY, movePlan.itemId);
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      return { applied: false, reason: "invalid-position" };
    }

    item.parent = movePlan.folderId;
    item.x = position.x;
    item.y = position.y;
    item.updatedAt = typeof options.now === "function" ? options.now() : Date.now();
    return { applied: true, item, position };
  }

  function explorerBulkMovePlanForFs(fs = {}, ids = [], folderId = "", options = {}) {
    const {
      descendantsForId = () => [],
      canMoveInto = () => false
    } = options;
    const uniqueIds = [...new Set(ids)].filter(id => fs?.[id]);
    const cleanIds = removeNestedExplorerIds(uniqueIds, descendantsForId)
      .filter(id => fs[id].parent !== folderId && canMoveInto(id, folderId));
    const folder = fs?.[folderId];
    if (!cleanIds.length || !folder || folder.type !== "folder") return [];
    return cleanIds.map((id, index) => ({
      id,
      preferredX: 36 + (index % 4) * 28,
      preferredY: 36 + Math.floor(index / 4) * 28
    }));
  }

  function applyExplorerBulkMovePlan(fs = {}, movePlan = [], folderId = "", options = {}) {
    const folder = fs?.[folderId];
    if (!Array.isArray(movePlan) || !movePlan.length || !folder || folder.type !== "folder") return [];
    const findFreeFolderPosition = typeof options.findFreeFolderPosition === "function"
      ? options.findFreeFolderPosition
      : () => ({ x: 36, y: 36 });
    const now = typeof options.now === "function" ? options.now : () => Date.now();
    const moved = [];

    movePlan.forEach(({ id, preferredX, preferredY }) => {
      const item = fs[id];
      if (!item) return;
      const position = findFreeFolderPosition(folderId, preferredX, preferredY, item.id);
      item.parent = folderId;
      item.x = position.x;
      item.y = position.y;
      item.updatedAt = now();
      moved.push(item);
    });
    return moved;
  }

  function explorerDownloadFilename(item = {}, fallbackExt = "txt") {
    const name = sanitizeExportPathPart(item.name || "file", "file");
    if (/\.[a-z0-9]{1,8}$/i.test(name)) return name;
    const ext = item.extension || fallbackExt;
    return `${name}.${ext}`;
  }

  function explorerItemBlob(item = {}) {
    if (item.dataURL) return dataUrlToBlob(item.dataURL);
    if (item.type === "markdown") return new Blob([String(item.content || "")], { type: "text/markdown;charset=utf-8" });
    if (["text", "note"].includes(item.type)) return new Blob([String(item.content || "")], { type: "text/plain;charset=utf-8" });
    if (item.type === "table") {
      const table = normalizeTableData(item.table || item);
      return new Blob([tablePageToCSV(activeTablePage(table))], { type: "text/csv;charset=utf-8" });
    }
    if (item.type === "tasklist") {
      normalizeTaskStore(item);
      return new Blob([formatTasksAsText(item.tasks, item.name, item.taskProjects)], { type: "text/plain;charset=utf-8" });
    }
    return new Blob([JSON.stringify(item, null, 2)], { type: "application/json;charset=utf-8" });
  }

  function explorerDownloadExtension(item = {}, fallbackExt = "txt") {
    if (item.dataURL) {
      const parsed = parseDataUrl(item.dataURL) || {};
      return mimeToExtension(parsed.mime || item.mime, "png");
    }
    if (item.type === "markdown") return "md";
    if (item.type === "table") return "csv";
    if (item.type === "tasklist") return "txt";
    if (!["text", "note"].includes(item.type)) return "json";
    return item.extension || fallbackExt;
  }

  async function collectExplorerDownloadEntries(item, options = {}) {
    const {
      fs = {},
      basePath = "",
      emptyFolderName = "Папка пуста.txt",
      emptyFolderText = "В этой папке пока нет файлов.\n"
    } = options;
    if (!item) return [];
    const safeName = sanitizeExportPathPart(item.name || item.id || "item", "item");
    if (item.type === "folder") {
      const children = Object.values(fs || {})
        .filter(child => child && child.parent === item.id && !child.deletedAt && !child.hiddenInExplorer && child.systemRole !== "explorerRoot")
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
      if (!children.length) return [{ path: `${basePath}${safeName}/${emptyFolderName}`, blob: emptyFolderText }];
      const nested = [];
      for (const child of children) nested.push(...await collectExplorerDownloadEntries(child, { ...options, fs, basePath: `${basePath}${safeName}/` }));
      return nested;
    }
    const ext = explorerDownloadExtension(item, "txt");
    return [{ path: `${basePath}${explorerDownloadFilename(item, ext)}`, blob: explorerItemBlob(item) }];
  }

  function removeNestedExplorerItems(items = [], descendantsForId = () => []) {
    const raw = items.filter(Boolean);
    const rawIds = new Set(raw.map(item => item.id).filter(Boolean));
    const nestedIds = new Set();
    rawIds.forEach(id => {
      const descendants = typeof descendantsForId === "function" ? descendantsForId(id) : [];
      descendants.forEach(childId => { if (rawIds.has(childId)) nestedIds.add(childId); });
    });
    return raw.filter(item => item && !nestedIds.has(item.id));
  }

  async function downloadExplorerSelection(items = [], options = {}) {
    const {
      fs = {},
      descendantsForId = () => [],
      createZipBlob = async () => null,
      downloadBlob = () => {},
      todayISO = () => new Date().toISOString().slice(0, 10),
      toast = () => {},
      logError = () => {},
      BlobClass = globalThis.Blob
    } = options;
    const clean = removeNestedExplorerItems(items, descendantsForId);
    if (!clean.length) return toast("Нечего скачать", "Выдели один или несколько элементов.");
    try {
      if (clean.length === 1 && clean[0].type !== "folder") {
        const entry = (await collectExplorerDownloadEntries(clean[0], { fs }))[0];
        const blob = entry.blob instanceof BlobClass ? entry.blob : new BlobClass([String(entry.blob || "")]);
        downloadBlob(entry.path, blob);
        return;
      }
      const entries = [];
      for (const item of clean) entries.push(...await collectExplorerDownloadEntries(item, { fs }));
      const zip = await createZipBlob(entries);
      downloadBlob(`ZeTer_OS_selection_${todayISO()}.zip`, zip);
    } catch (err) {
      logError(err);
      toast("Ошибка скачивания", err?.message || "Не удалось собрать выбранные элементы.");
    }
  }

  function removeNestedExplorerIds(ids = [], descendantsForId = () => []) {
    const uniqueIds = [...new Set(ids)].filter(Boolean);
    const selected = new Set(uniqueIds);
    const nestedIds = new Set();
    uniqueIds.forEach(id => {
      const descendants = typeof descendantsForId === "function" ? descendantsForId(id) : [];
      descendants.forEach(childId => { if (selected.has(childId)) nestedIds.add(childId); });
    });
    return uniqueIds.filter(id => !nestedIds.has(id));
  }

  function sanitizeExplorerSpaces(target = {}, options = {}) {
    if (!target || typeof target !== "object") return target;
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const getExplorerRoot = typeof options.getExplorerRoot === "function" ? options.getExplorerRoot : () => "";
    const createWorkspaceSystemFolders = typeof options.createWorkspaceSystemFolders === "function" ? options.createWorkspaceSystemFolders : () => {};
    const fs = target.fs && typeof target.fs === "object" ? target.fs : {};

    ensureDesktops();
    (Array.isArray(target.desktops) ? target.desktops : []).forEach(desk => {
      const explorerRoot = getExplorerRoot(desk.id);
      if (!explorerRoot) return;
      createWorkspaceSystemFolders(explorerRoot);

      Object.values(fs).forEach(item => {
        if (item?.parent === desk.id && item.systemRole === "explorerRoot") {
          item.hiddenFromDesktop = true;
          item.x = -9999;
          item.y = -9999;
        }
      });

      Object.values(fs).forEach(item => {
        if (item?.parent === explorerRoot && item.type === "app") {
          item.hiddenInExplorer = true;
        }
      });
    });
    return target;
  }

  function explorerPreviewModel(items = [], options = {}) {
    const selected = items.filter(Boolean);
    const {
      fs = {},
      currentFolder = "",
      rootId = "",
      itemIcon = () => "",
      itemKind = () => "",
      pathText = () => "",
      formatBytes = value => String(value || 0),
      formatDate = value => new Date(value || Date.now()).toLocaleString("ru-RU")
    } = options;

    if (!selected.length) {
      return {
        type: "empty",
        pathText: pathText(currentFolder, rootId)
      };
    }

    if (selected.length > 1) {
      const totalSize = selected.reduce((sum, item) => sum + explorerItemSize(item), 0);
      return {
        type: "multi",
        count: selected.length,
        folderCount: selected.filter(item => item.type === "folder").length,
        totalSizeText: formatBytes(totalSize),
        items: selected.slice(0, 8).map(item => ({ icon: itemIcon(item), name: item.name })),
        extraCount: Math.max(0, selected.length - 8)
      };
    }

    const item = selected[0];
    let body = { type: "text", text: String(item.content || "").slice(0, 900) };

    if (["image", "paint"].includes(item.type) && isDataImage(item.dataURL)) {
      body = { type: "image", src: item.dataURL, name: item.name };
    } else if (item.type === "folder") {
      const children = Object.values(fs || {}).filter(child => child && child.parent === item.id && !child.deletedAt && !child.hiddenInExplorer);
      body = {
        type: "folder",
        childCount: children.length,
        children: children.slice(0, 7).map(child => ({ icon: itemIcon(child), name: child.name }))
      };
    } else if (item.type === "table") {
      const table = normalizeTableData(item.table || item);
      const page = activeTablePage(table);
      body = { type: "table", rows: page.rows.length, columns: page.columns.length, pages: table.pages.length };
    } else if (item.type === "tasklist") {
      normalizeTaskStore(item);
      body = { type: "tasklist", tasks: item.tasks.length, projects: item.taskProjects.length };
    } else if (item.type === "shortcut") {
      body = { type: "text", text: String(item.shortcut?.target || item.managedFile?.shortcutTarget || "Цель ярлыка не указана") };
    }

    return {
      type: "single",
      icon: itemIcon(item),
      name: item.name,
      kind: itemKind(item),
      body,
      size: formatBytes(explorerItemSize(item)),
      date: formatDate(item.updatedAt || item.createdAt || Date.now()),
      pathText: pathText(item.parent || currentFolder, rootId),
      folder: item.type === "folder",
      pinned: Boolean(item.pinnedInExplorer)
    };
  }

  function ensureExplorerSystemFolders(fs = {}, rootId = "", options = {}) {
    const {
      specs = [{ role: "projects", name: "Проекты", x: 206, y: 32 }],
      uid = prefix => `${prefix}-${Date.now()}`,
      uniqueName = name => name,
      now = () => Date.now()
    } = options;
    const results = [];
    specs.forEach(spec => {
      const existing = Object.values(fs).find(item =>
        item?.type === "folder" &&
        item.parent === rootId &&
        (item.systemRole === spec.role || item.name === spec.name)
      );
      if (existing) {
        existing.systemRole = existing.systemRole || spec.role;
        existing.showInExplorerTree = true;
        results.push(existing);
        return;
      }
      const id = uid("folder");
      const item = {
        id,
        type: "folder",
        name: uniqueName(spec.name, rootId),
        parent: rootId,
        x: spec.x,
        y: spec.y,
        systemRole: spec.role,
        showInExplorerTree: true,
        createdAt: now(),
        updatedAt: now()
      };
      fs[id] = item;
      results.push(item);
    });
    return results;
  }

  function createExplorerRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const currentDesktopRecord = typeof options.currentDesktopRecord === "function" ? options.currentDesktopRecord : () => ({ data: {} });
    const workspaceDefaults = typeof options.workspaceDefaults === "function" ? options.workspaceDefaults : () => ({});
    const createId = typeof options.createId === "function" ? options.createId : prefix => `${prefix}-${Date.now()}`;
    const uniqueName = typeof options.uniqueName === "function" ? options.uniqueName : name => name;
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const currentWorkspace = typeof options.currentWorkspace === "function" ? options.currentWorkspace : () => ({});
    const workspaceItems = typeof options.workspaceItems === "function" ? options.workspaceItems : () => [];
    const renderTreeHTML = typeof options.renderTreeHTML === "function" ? options.renderTreeHTML : () => "";
    const renderPinnedHTML = typeof options.renderPinnedHTML === "function" ? options.renderPinnedHTML : () => "";
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const findFreeFolderPositionForItems = typeof options.findFreeFolderPositionForItems === "function"
      ? options.findFreeFolderPositionForItems
      : () => ({ x: 36, y: 36 });
    const positionInFolderGridForItems = typeof options.positionInFolderGridForItems === "function"
      ? options.positionInFolderGridForItems
      : () => ({ x: 36, y: 36 });
    const viewportSize = typeof options.viewportSize === "function" ? options.viewportSize : () => ({ width: 0, height: 0 });
    const tabUtils = options.tabUtils && typeof options.tabUtils === "object" ? options.tabUtils : {};
    const serializableParams = typeof options.serializableParams === "function" ? options.serializableParams : value => ({ ...(value || {}) });
    const itemInWorkspace = typeof options.itemInWorkspace === "function" ? options.itemInWorkspace : () => false;
    const getWindowRecord = typeof options.getWindowRecord === "function" ? options.getWindowRecord : () => null;
    const refreshWindow = typeof options.refreshWindow === "function" ? options.refreshWindow : () => {};
    const persistOpenWindows = typeof options.persistOpenWindows === "function" ? options.persistOpenWindows : () => {};
    const desktopRootOf = typeof options.desktopRootOf === "function" ? options.desktopRootOf : () => getDesktopRoot();
    const safeAttr = typeof options.safeAttr === "function" ? options.safeAttr : value => String(value || "");
    const escapeHtml = typeof options.escapeHtml === "function" ? options.escapeHtml : value => String(value || "");
    const descendantsForId = typeof options.descendantsForId === "function" ? options.descendantsForId : () => [];
    const itemDescription = typeof options.itemDescription === "function" ? options.itemDescription : () => "";
    const searchMatch = typeof options.searchMatch === "function" ? options.searchMatch : () => false;
    const canMoveInto = typeof options.canMoveInto === "function" ? options.canMoveInto : () => false;
    const createZipBlob = typeof options.createZipBlob === "function" ? options.createZipBlob : async () => null;
    const downloadBlob = typeof options.downloadBlob === "function" ? options.downloadBlob : () => {};
    const todayISO = typeof options.todayISO === "function" ? options.todayISO : () => new Date().toISOString().slice(0, 10);
    const logDownloadError = typeof options.logDownloadError === "function" ? options.logDownloadError : () => {};
    const itemKind = typeof options.itemKind === "function" ? options.itemKind : () => "";
    const formatBytes = typeof options.formatBytes === "function" ? options.formatBytes : value => String(value || 0);
    const previewHTMLFromModel = typeof options.previewHTMLFromModel === "function" ? options.previewHTMLFromModel : () => "";
    const previewRenderers = options.previewRenderers && typeof options.previewRenderers === "object" ? options.previewRenderers : {};

    function ensureWorkspaceExplorerRoot(desktopId = getDesktopRoot()) {
      const state = getState();
      const rootName = `ZeTer Files · ${desktopId}`;
      const existing = Object.values(state.fs).find(item =>
        item.type === "folder" &&
        item.parent === desktopId &&
        item.systemRole === "explorerRoot"
      );
      if (existing) {
        existing.hiddenFromDesktop = true;
        existing.showInExplorerTree = false;
        existing.name = existing.name || rootName;
        return existing.id;
      }

      const id = createId("folder");
      state.fs[id] = {
        id,
        type: "folder",
        name: rootName,
        parent: desktopId,
        x: -9999,
        y: -9999,
        systemRole: "explorerRoot",
        hiddenFromDesktop: true,
        showInExplorerTree: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      return id;
    }

    function getExplorerRoot(desktopId = getDesktopRoot()) {
      const state = getState();
      ensureDesktops();
      const desk = state.desktops.find(desktop => desktop.id === desktopId) || currentDesktopRecord();
      desk.data = desk.data || workspaceDefaults();
      if (!desk.data.explorerRootId || !state.fs[desk.data.explorerRootId]) {
        desk.data.explorerRootId = ensureWorkspaceExplorerRoot(desktopId);
      }
      return desk.data.explorerRootId;
    }

    function isExplorerRoot(id) {
      return isExplorerRootInTarget(getState(), id);
    }

    function folderRootContext(folderId) {
      return explorerFolderRootContextForFs(getState().fs, folderId, { isExplorerRoot, isDesktopRoot });
    }

    function isInExplorerSpace(item, explorerRoot = getExplorerRoot()) {
      return explorerItemIsInSpace(getState().fs, item, explorerRoot, { isDesktopRoot });
    }

    function createWorkspaceSystemFolders(root = getExplorerRoot()) {
      const explorerRoot = isExplorerRoot(root) ? root : getExplorerRoot(root);
      return ensureExplorerSystemFolders(getState().fs, explorerRoot, {
        uid: createId,
        uniqueName
      });
    }

    function getWorkspaceDocumentsFolder() {
      return getExplorerRoot();
    }

    function expandedExplorerSet() {
      const workspace = currentWorkspace();
      workspace.expandedExplorerFolders = Array.isArray(workspace.expandedExplorerFolders)
        ? workspace.expandedExplorerFolders
        : [];
      return new Set(workspace.expandedExplorerFolders);
    }

    function saveExpandedExplorerSet(set) {
      currentWorkspace().expandedExplorerFolders = [...set];
      saveState();
    }

    function renderExplorerTree(currentFolder, rootId = getDesktopRoot()) {
      const desktopMode = isDesktopRoot(rootId);
      return renderTreeHTML(explorerTreeNodesForFs(getState().fs, currentFolder, rootId, {
        expandedIds: expandedExplorerSet(),
        isDesktopRoot,
        includeRoot: true,
        rootName: desktopMode ? "Рабочий стол" : "Файлы ZeTer OS",
        rootIcon: desktopMode ? "🖥️" : "🗂️"
      }));
    }

    function renderPinnedExplorer(currentFolder, navigationRoot = getExplorerRoot()) {
      const state = getState();
      return renderPinnedHTML(explorerPinnedEntriesForItems(workspaceItems(), currentFolder, navigationRoot, {
        fs: state.fs,
        isDesktopRoot,
        itemIcon
      }));
    }

    function togglePinnedItem(itemId) {
      const item = getState().fs[itemId];
      if (!item) return;
      item.pinnedInExplorer = !item.pinnedInExplorer;
      item.updatedAt = Date.now();
      saveState();
      renderFileSurfaces();
      toast(item.pinnedInExplorer ? "Закреплено" : "Откреплено", item.name);
    }

    function removeFolderReferences(itemIds) {
      const expanded = expandedExplorerSet();
      itemIds.forEach(id => expanded.delete(id));
      saveExpandedExplorerSet(expanded);
    }

    function findFreeFolderPosition(parent, preferredX = 36, preferredY = 36, excludeId = null, bounds = {}) {
      const viewport = viewportSize();
      return findFreeFolderPositionForItems(Object.values(getState().fs), parent, preferredX, preferredY, excludeId, {
        ...bounds,
        viewportWidth: viewport.width - 360,
        viewportHeight: viewport.height - 230
      });
    }

    function positionInFolderGrid(grid, clientX, clientY, itemId = null) {
      const rect = grid.getBoundingClientRect();
      return positionInFolderGridForItems(Object.values(getState().fs), grid.dataset.folderDrop, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        clientWidth: grid.clientWidth,
        clientHeight: grid.clientHeight,
        scrollWidth: grid.scrollWidth,
        scrollHeight: grid.scrollHeight,
        scrollLeft: grid.scrollLeft,
        scrollTop: grid.scrollTop
      }, clientX, clientY, itemId);
    }

    function normalizeExplorerFolderId(folderId, rootId = getExplorerRoot()) {
      if (!folderId || tabUtils.isExplorerBlankTab(folderId)) return null;
      if (tabUtils.isExplorerFolderTab(folderId)) return null;

      const desktopRoot = getDesktopRoot();
      if (isExplorerRoot(folderId)) return folderId === rootId ? folderId : rootId;
      if (isDesktopRoot(folderId)) return folderId === desktopRoot ? folderId : desktopRoot;

      const item = getState().fs?.[folderId];
      if (!item || item.deletedAt || item.type !== "folder") return null;

      const context = folderRootContext(folderId);
      if (context === "explorer") return isInExplorerSpace(item, rootId) ? folderId : null;
      if (context === "desktop") return itemInWorkspace(item, desktopRoot) ? folderId : null;
      return null;
    }

    function explorerTabStateOptions(rootId = getExplorerRoot()) {
      return {
        normalizeFolderId: (folderId, candidateRootId = rootId) => normalizeExplorerFolderId(folderId, candidateRootId),
        isUsableFolderId: folderId => isExplorerRoot(folderId) || isDesktopRoot(folderId) || getState().fs[folderId]?.type === "folder",
        serializableParams,
        now: Date.now
      };
    }

    function explorerFolderIdForTab(tabId, params = {}, rootId = getExplorerRoot()) {
      return tabUtils.explorerFolderIdForTab(tabId, params, rootId, explorerTabStateOptions(rootId));
    }

    function explorerTabIsUsable(id, rootId = getExplorerRoot(), params = {}) {
      return tabUtils.explorerTabIsUsable(id, rootId, params, explorerTabStateOptions(rootId));
    }

    function normalizeExplorerAnchorId(folderId, rootId = getExplorerRoot(), params = {}) {
      return tabUtils.normalizeExplorerAnchorId(folderId, rootId, params, explorerTabStateOptions(rootId));
    }

    function savedExplorerTabStateForFolder(folderId, rootId = getExplorerRoot()) {
      return tabUtils.savedExplorerTabStateForFolder(getState(), folderId, rootId, explorerTabStateOptions(rootId));
    }

    function savedExplorerTabsForFolder(folderId, rootId = getExplorerRoot()) {
      return tabUtils.savedExplorerTabsForFolder(getState(), folderId, rootId, explorerTabStateOptions(rootId));
    }

    function explorerLastFolderForSession(folderId, rootId = getExplorerRoot(), params = {}) {
      return tabUtils.explorerLastFolderForSession(getState(), folderId, rootId, params, explorerTabStateOptions(rootId));
    }

    function persistExplorerLastFolderForSession(params = {}, folderId, rootId = getExplorerRoot()) {
      return tabUtils.persistExplorerLastFolderForSession(getState(), params, folderId, rootId, explorerTabStateOptions(rootId));
    }

    function prepareExplorerOpenParams(inputParams = {}, runtimeOptions = {}) {
      const rootId = getExplorerRoot();
      return tabUtils.prepareExplorerOpenParams(getState(), inputParams, {
        ...explorerTabStateOptions(rootId),
        rootId,
        restoring: Boolean(runtimeOptions.restoring)
      });
    }

    function persistExplorerTabsForAnchor(params = {}, rootId = getExplorerRoot()) {
      return tabUtils.persistExplorerTabsForAnchor(getState(), params, rootId, explorerTabStateOptions(rootId));
    }

    function navigateFolderWindow(winId, params, folderId, navigationOptions = {}) {
      const rootId = getExplorerRoot();
      tabUtils.navigateExplorerTabs(params, folderId, {
        ...explorerTabStateOptions(rootId),
        ...navigationOptions,
        rootId
      });
      persistExplorerTabsForAnchor(params, rootId);
      const record = getWindowRecord(winId);
      if (record) record.params = serializableParams({ ...(record.params || {}), ...params });
      refreshWindow(winId);
      persistOpenWindows();
    }

    function normalizeExplorerTabs(params = {}, activeFolder = getExplorerRoot(), rootId = getExplorerRoot()) {
      return tabUtils.normalizeExplorerTabs(params, activeFolder, rootId, explorerTabStateOptions(rootId));
    }

    function explorerFolderTitle(folderId) {
      if (tabUtils.isExplorerBlankTab(folderId)) return "Пустая вкладка";
      if (isDesktopRoot(folderId) || isExplorerRoot(folderId)) return "Корень";
      return getState().fs[folderId]?.name || "Папка";
    }

    function explorerBaseRootForFolder(folderId, rootId = getExplorerRoot()) {
      if (isDesktopRoot(folderId)) return folderId;
      if (folderRootContext(folderId) === "desktop") return desktopRootOf(folderId) || getDesktopRoot();
      return rootId;
    }

    function explorerPathParts(folderId, rootId = getExplorerRoot()) {
      const baseId = explorerBaseRootForFolder(folderId, rootId);
      return explorerPathPartsForFs(folderId, getState().fs, {
        baseId,
        rootId,
        isBlank: tabUtils.isExplorerBlankTab,
        isDesktopRoot,
        isExplorerRoot
      });
    }

    function explorerAddressText(folderId, rootId = getExplorerRoot()) {
      return explorerAddressTextFromParts(explorerPathParts(folderId, rootId));
    }

    function explorerPathText(folderId, rootId = getExplorerRoot()) {
      return explorerPathTextFromParts(explorerPathParts(folderId, rootId));
    }

    function explorerPathHTML(folderId, rootId = getExplorerRoot()) {
      const baseId = explorerBaseRootForFolder(folderId, rootId);
      const parts = explorerPathParts(folderId, rootId);
      const rootButton = `<button data-crumb="${safeAttr(baseId)}" title="Корень">Корень</button>`;
      return rootButton + parts.map(part =>
        `<span class="explorer-path-separator">/</span><button data-crumb="${safeAttr(part.id)}" title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</button>`
      ).join("");
    }

    function normalizeExplorerAddress(value = "") {
      ensureDesktops();
      return normalizeExplorerAddressInput(value, (getState().desktops || []).map(desktop => desktop.name));
    }

    function findFolderChildByName(parentId, name) {
      return findExplorerFolderChildByName(getState().fs, parentId, name);
    }

    function resolveExplorerAddress(value = "", preferredRootId = getExplorerRoot(), rootId = getExplorerRoot()) {
      const parts = normalizeExplorerAddress(value);
      return resolveExplorerAddressParts(getState().fs, parts, [preferredRootId, rootId, getDesktopRoot()]) || null;
    }

    function explorerSearchableItems(folderId, query = "") {
      return explorerSearchableItemsForFs(getState().fs, folderId, query, {
        descendantsForId,
        itemDescription,
        explorerAddressText,
        explorerBaseRootForFolder,
        searchMatch
      });
    }

    function explorerResultLocationText(item, currentFolder, rootId = getExplorerRoot()) {
      return explorerResultLocationTextForItem(item, currentFolder, {
        rootId,
        explorerBaseRootForFolder,
        explorerAddressText
      });
    }

    function explorerFolderMoveTargets(selectedIds = [], currentFolder = getExplorerRoot(), rootId = getExplorerRoot()) {
      return explorerFolderMoveTargetsForFs(getState().fs, selectedIds, currentFolder, {
        rootId,
        canMoveInto,
        isExplorerRoot,
        isInExplorerSpace,
        folderRootContext,
        explorerPathText
      });
    }

    function bulkMoveItemsToFolder(ids = [], folderId) {
      const state = getState();
      const movePlan = explorerBulkMovePlanForFs(state.fs, ids, folderId, { descendantsForId, canMoveInto });
      if (!movePlan.length) return 0;
      const moved = applyExplorerBulkMovePlan(state.fs, movePlan, folderId, { findFreeFolderPosition });
      if (!moved.length) return 0;
      saveState();
      renderFileSurfaces();
      toast("Перемещено", `Элементов: ${moved.length}`);
      return moved.length;
    }

    async function downloadExplorerItems(items = []) {
      return downloadExplorerSelection(items, {
        fs: getState().fs,
        descendantsForId,
        createZipBlob,
        downloadBlob,
        todayISO,
        toast,
        logError: logDownloadError
      });
    }

    function explorerPreviewHTML(items = [], currentFolder = getExplorerRoot(), rootId = getExplorerRoot()) {
      const model = explorerPreviewModel(items, {
        fs: getState().fs,
        currentFolder,
        rootId,
        itemIcon,
        itemKind,
        pathText: explorerPathText,
        formatBytes,
        formatDate: value => new Date(value || Date.now()).toLocaleString("ru-RU")
      });
      return previewHTMLFromModel(model, previewRenderers);
    }

    return Object.freeze({
      ensureWorkspaceExplorerRoot,
      getExplorerRoot,
      isExplorerRoot,
      folderRootContext,
      isInExplorerSpace,
      createWorkspaceSystemFolders,
      getWorkspaceDocumentsFolder,
      expandedExplorerSet,
      saveExpandedExplorerSet,
      renderExplorerTree,
      renderPinnedExplorer,
      togglePinnedItem,
      removeFolderReferences,
      findFreeFolderPosition,
      positionInFolderGrid,
      normalizeExplorerFolderId,
      explorerFolderIdForTab,
      explorerTabIsUsable,
      normalizeExplorerAnchorId,
      savedExplorerTabStateForFolder,
      savedExplorerTabsForFolder,
      explorerLastFolderForSession,
      persistExplorerLastFolderForSession,
      prepareExplorerOpenParams,
      persistExplorerTabsForAnchor,
      navigateFolderWindow,
      normalizeExplorerTabs,
      explorerFolderTitle,
      explorerBaseRootForFolder,
      explorerPathParts,
      explorerAddressText,
      explorerPathText,
      explorerPathHTML,
      normalizeExplorerAddressInput: normalizeExplorerAddress,
      findFolderChildByName,
      resolveExplorerAddress,
      explorerItemSize,
      explorerSearchableItems,
      explorerResultLocationText,
      explorerFolderMoveTargets,
      bulkMoveItemsToFolder,
      downloadExplorerItems,
      explorerPreviewHTML
    });
  }

  window.ZETER_EXPLORER_UTILS = Object.freeze({
    EXPLORER_PINNED_ITEM_TYPES,
    normalizeExplorerAddressInput,
    explorerPathPartsForFs,
    explorerAddressTextFromParts,
    explorerPathTextFromParts,
    findExplorerFolderChildByName,
    resolveExplorerAddressParts,
    explorerFolderChildrenForFs,
    isExplorerRootInTarget,
    explorerFolderRootContextForFs,
    explorerItemIsInSpace,
    explorerFolderAncestorIdsForFs,
    explorerTreeNodesForFs,
    explorerPinnedEntriesForItems,
    explorerItemSize,
    explorerItemIsVisibleInGrid,
    explorerFlowLayout,
    sortExplorerItems,
    explorerSearchGridPosition,
    explorerCardMeta,
    explorerGridMinSize,
    explorerSearchableItemsForFs,
    explorerResultLocationTextForItem,
    explorerFolderMoveTargetsForFs,
    canMoveExplorerItemIntoFolder,
    explorerSingleMovePlanForFs,
    applyExplorerSingleMovePlan,
    explorerBulkMovePlanForFs,
    applyExplorerBulkMovePlan,
    explorerDownloadFilename,
    explorerItemBlob,
    explorerDownloadExtension,
    collectExplorerDownloadEntries,
    removeNestedExplorerItems,
    downloadExplorerSelection,
    removeNestedExplorerIds,
    sanitizeExplorerSpaces,
    explorerPreviewModel,
    ensureExplorerSystemFolders,
    createExplorerRuntimeController
  });
})();
