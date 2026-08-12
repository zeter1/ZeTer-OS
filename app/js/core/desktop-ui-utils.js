(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const stickyUtils = window.ZETER_STICKY_UTILS;
  const desktopLayoutUtils = window.ZETER_DESKTOP_LAYOUT_UTILS;
  const itemDragUiUtils = window.ZETER_ITEM_DRAG_UI_UTILS;
  const contextMenuUiUtils = window.ZETER_CONTEXT_MENU_UI_UTILS;
  const managedFileUtils = window.ZETER_MANAGED_FILE_UTILS;
  if (!coreUtils || !stickyUtils || !desktopLayoutUtils || !itemDragUiUtils || !contextMenuUiUtils || !managedFileUtils) {
    throw new Error("ZeTer OS desktop UI utils require core, sticky, layout, item drag, context menu and managed file utils.");
  }

  const { $, $$, escapeHtml, clamp, debounce } = coreUtils;
  const {
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
    resizeStickyFromPointer,
    normalizeDesktopStickies,
    upsertNoteSticky,
    removeNoteSticky
  } = stickyUtils;
  const { createDesktopLayoutRuntimeController } = desktopLayoutUtils;
  const {
    bindItemPointerDrag,
    createItemDragRuntimeController,
    showDragGhost,
    hideDragGhost,
    moveDragGhost
  } = itemDragUiUtils;
  const { createDesktopContextMenuController } = contextMenuUiUtils;
  const { ensureManagedFileInlineMarkers, plainTextWithoutManagedFiles } = managedFileUtils;

  function desktopIconHTML({ icon = "", name = "" } = {}) {
    return `<span class="icon">${icon}</span><span class="label">${escapeHtml(name)}</span>`;
  }

  function dragGhostHTML({ icon = "", name = "" } = {}) {
    return `<b>${icon}</b><span>${escapeHtml(name)}</span>`;
  }

  function desktopDragSelectionIds(fs = {}, selectedIds = [], itemId = "", desktopRoot = "") {
    const selected = new Set(Array.from(selectedIds || []));
    const item = fs?.[itemId];
    if (!item || item.parent !== desktopRoot || !selected.has(itemId)) return item ? [itemId] : [];
    const group = [...selected].filter(id => fs?.[id]?.parent === desktopRoot && !fs[id].deletedAt && !fs[id].hiddenFromDesktop);
    return group.length > 1 ? group : [itemId];
  }

  function desktopSelectionAfterClick(selectedId = null, selectedIds = [], itemId = "", additive = false) {
    if (!itemId) return { selectedId: selectedId || null, selectedIds: Array.from(selectedIds || []) };
    if (!additive) return { selectedId: itemId, selectedIds: [] };

    const next = new Set(Array.from(selectedIds || []));
    if (!next.size && selectedId) next.add(selectedId);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    const ids = [...next];
    if (ids.length <= 1) return { selectedId: ids[0] || null, selectedIds: [] };
    return { selectedId: next.has(itemId) ? itemId : ids[ids.length - 1], selectedIds: ids };
  }

  function renderDesktopIcons({
    container,
    items = [],
    selectedId = "",
    selectedIds = new Set(),
    clampPosition = () => ({ x: 20, y: 20 }),
    itemIcon = () => "",
    onSelect = () => {},
    onOpen = () => {},
    onShowMenu = () => {},
    onEnableDrag = () => {}
  } = {}) {
    if (!container) return;
    container.innerHTML = "";

    items.forEach(item => {
      const icon = document.createElement("button");
      const selected = selectedId === item.id || selectedIds?.has(item.id);
      icon.className = "desktop-icon" + (selected ? " selected" : "");
      icon.dataset.itemId = item.id;
      if (item.type === "folder") icon.dataset.folderTarget = item.id;
      const position = clampPosition(item.x ?? 20, item.y ?? 20);
      icon.style.left = position.x + "px";
      icon.style.top = position.y + "px";
      icon.innerHTML = desktopIconHTML({ icon: itemIcon(item), name: item.name });
      icon.addEventListener("click", event => {
        event.stopPropagation();
        if (icon.dataset.dragJustEnded === "1") return;
        onSelect(item.id, event);
      });
      icon.addEventListener("dblclick", event => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(item.id);
      });
      icon.addEventListener("contextmenu", event => onShowMenu(event, item.id));
      onEnableDrag(icon, item.id);
      container.appendChild(icon);
    });
  }

  function createDesktopSurfaceController(options = {}) {
    const getSurface = typeof options.getSurface === "function" ? options.getSurface : () => null;
    const getSelectionBox = typeof options.getSelectionBox === "function" ? options.getSelectionBox : () => null;
    const getContainer = typeof options.getContainer === "function" ? options.getContainer : () => null;
    const getRootId = typeof options.getRootId === "function" ? options.getRootId : () => "desktop";
    const getItems = typeof options.getItems === "function" ? options.getItems : () => [];
    const getSelectedId = typeof options.getSelectedId === "function" ? options.getSelectedId : () => null;
    const setSelectedId = typeof options.setSelectedId === "function" ? options.setSelectedId : () => {};
    const getSelectedIds = typeof options.getSelectedIds === "function" ? options.getSelectedIds : () => new Set();
    const getSelectionDrag = typeof options.getSelectionDrag === "function" ? options.getSelectionDrag : () => null;
    const setSelectionDrag = typeof options.setSelectionDrag === "function" ? options.setSelectionDrag : () => {};
    const getIcons = typeof options.getIcons === "function" ? options.getIcons : () => [];
    const clampPosition = typeof options.clampPosition === "function" ? options.clampPosition : () => ({ x: 20, y: 20 });
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const onOpen = typeof options.onOpen === "function" ? options.onOpen : () => {};
    const onShowMenu = typeof options.onShowMenu === "function" ? options.onShowMenu : () => {};
    const onEnableDrag = typeof options.onEnableDrag === "function" ? options.onEnableDrag : () => {};
    const renderStickies = typeof options.renderStickies === "function" ? options.renderStickies : () => {};

    function selectItem(itemId, event = {}) {
      const selection = desktopSelectionAfterClick(
        getSelectedId(),
        getSelectedIds(),
        itemId,
        Boolean(event.ctrlKey || event.metaKey)
      );
      const selectedIds = getSelectedIds();
      selectedIds?.clear();
      selection.selectedIds.forEach(id => selectedIds?.add(id));
      setSelectedId(selection.selectedId);
      const selected = new Set(selection.selectedIds);
      if (selection.selectedId) selected.add(selection.selectedId);
      getIcons().forEach(icon => icon.classList.toggle("selected", selected.has(icon.dataset.itemId)));
      return selection;
    }

    function render() {
      const container = getContainer();
      if (!container) return;
      container.dataset.folderDrop = getRootId();
      renderDesktopIcons({
        container,
        items: getItems(),
        selectedId: getSelectedId(),
        selectedIds: getSelectedIds(),
        clampPosition,
        itemIcon,
        onSelect: selectItem,
        onOpen,
        onShowMenu,
        onEnableDrag
      });
      renderStickies(container);
    }

    function clear(options = {}) {
      const selectedIds = getSelectedIds();
      const hadSelection = Boolean(getSelectedId() || selectedIds?.size);
      setSelectedId(null);
      selectedIds?.clear();
      if (!hadSelection) return false;
      if (options.render) render();
      else getIcons().forEach(icon => icon.classList.remove("selected"));
      return true;
    }

    function bindSelectionBox() {
      const surface = getSurface();
      const box = getSelectionBox();
      if (!surface || !box || surface.dataset.selectionBound === "1") return false;
      surface.dataset.selectionBound = "1";
      surface.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.target.closest(".desktop-icon,.desktop-sticky,.window,.taskbar,.start-menu,.quick-panel,.notification-center,.global-search,.context-menu")) return;
        setSelectionDrag({ startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY });
        getSelectedIds()?.clear();
        setSelectedId(null);
        box.classList.remove("hidden");
        const surfaceRect = surface.getBoundingClientRect();
        box.style.left = (event.clientX - surfaceRect.left) + "px";
        box.style.top = (event.clientY - surfaceRect.top) + "px";
        box.style.width = "0px";
        box.style.height = "0px";
        surface.setPointerCapture?.(event.pointerId);
      });
      surface.addEventListener("pointermove", event => {
        const drag = getSelectionDrag();
        if (!drag) return;
        const left = Math.min(drag.startX, event.clientX);
        const top = Math.min(drag.startY, event.clientY);
        const width = Math.abs(event.clientX - drag.startX);
        const height = Math.abs(event.clientY - drag.startY);
        const surfaceRect = surface.getBoundingClientRect();
        Object.assign(box.style, { left: `${left - surfaceRect.left}px`, top: `${top - surfaceRect.top}px`, width: `${width}px`, height: `${height}px` });
        const rect = { left, top, right: left + width, bottom: top + height };
        const selectedIds = getSelectedIds();
        selectedIds?.clear();
        getIcons().forEach(icon => {
          const iconRect = icon.getBoundingClientRect();
          const hit = !(iconRect.right < rect.left || iconRect.left > rect.right || iconRect.bottom < rect.top || iconRect.top > rect.bottom);
          if (hit) selectedIds?.add(icon.dataset.itemId);
          icon.classList.toggle("selected", hit);
        });
      });
      const finish = event => {
        if (!getSelectionDrag()) return;
        setSelectionDrag(null);
        box.classList.add("hidden");
        const selectedIds = getSelectedIds();
        if (selectedIds?.size === 1) setSelectedId([...selectedIds][0]);
        try { surface.releasePointerCapture?.(event.pointerId); } catch {}
      };
      surface.addEventListener("pointerup", finish);
      surface.addEventListener("pointercancel", finish);
      return true;
    }

    return Object.freeze({ bindSelectionBox, clear, render, selectItem });
  }

  function createDesktopItemRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {}, desktops: [] });
    const getRuntimeUi = typeof options.getRuntimeUi === "function" ? options.getRuntimeUi : () => ({});
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const getExplorerRoot = typeof options.getExplorerRoot === "function" ? options.getExplorerRoot : () => null;
    const currentWorkspace = typeof options.currentWorkspace === "function" ? options.currentWorkspace : () => ({});
    const createId = typeof options.createId === "function" ? options.createId : prefix => `${prefix}-${Date.now()}`;
    const uniqueName = typeof options.uniqueName === "function" ? options.uniqueName : name => name;
    const openApp = typeof options.openApp === "function" ? options.openApp : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderDesktop = typeof options.renderDesktop === "function" ? options.renderDesktop : () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const refreshNotesWindows = typeof options.refreshNotesWindows === "function" ? options.refreshNotesWindows : () => {};
    const refreshOpenEditors = typeof options.refreshOpenEditors === "function" ? options.refreshOpenEditors : () => {};
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const openManagedFile = typeof options.openManagedFile === "function" ? options.openManagedFile : () => {};
    const openShortcut = typeof options.openShortcut === "function" ? options.openShortcut : () => {};
    const openExternalLink = typeof options.openExternalLink === "function" ? options.openExternalLink : () => {};
    const plainToRichHtml = typeof options.plainToRichHtml === "function" ? options.plainToRichHtml : value => String(value || "");
    const cleanRichHtml = typeof options.cleanRichHtml === "function" ? options.cleanRichHtml : value => String(value || "");
    const bulkMoveItemsToFolder = typeof options.bulkMoveItemsToFolder === "function" ? options.bulkMoveItemsToFolder : () => 0;
    const documentRef = options.documentRef || document;
    const windowRef = options.windowRef || window;

    function desktopRootOf(folderId) {
      if (isDesktopRoot(folderId) || isExplorerRoot(folderId)) return folderId;
      const fs = getState().fs;
      let current = fs[folderId];
      while (current && current.parent) {
        if (isExplorerRoot(current.parent) || isDesktopRoot(current.parent)) return current.parent;
        current = fs[current.parent];
      }
      return getExplorerRoot();
    }

    function itemInWorkspace(item, root = getDesktopRoot()) {
      if (!item || item.deletedAt || item.parent === options.trashRoot) return false;
      if (item.parent === root) return true;
      const fs = getState().fs;
      let parent = fs[item.parent];
      while (parent) {
        if (parent.parent === root || parent.id === root) return true;
        if (isDesktopRoot(parent.parent)) return parent.parent === root;
        parent = fs[parent.parent];
      }
      return false;
    }

    function workspaceItems(root = getDesktopRoot()) {
      return Object.values(getState().fs).filter(item => itemInWorkspace(item, root));
    }

    const layoutController = createDesktopLayoutRuntimeController({
      getItems: () => Object.values(getState().fs),
      getDesktopRoot,
      getForbiddenElements: () => [documentRef.querySelector("#top-menu"), documentRef.querySelector("#taskbar")],
      getViewportSize: () => ({ width: windowRef.innerWidth, height: windowRef.innerHeight })
    });

    function addDesktopShortcut(appId, parent, x, y) {
      const app = getApps()[appId];
      if (!app) return null;
      const id = createId("app");
      const position = isDesktopRoot(parent)
        ? layoutController.findFreePosition(parent, x, y, id)
        : { x: Number.isFinite(x) ? x : 40, y: Number.isFinite(y) ? y : 40 };
      getState().fs[id] = {
        id,
        type: "app",
        name: uniqueName(app.name, parent),
        parent,
        x: position.x,
        y: position.y,
        appId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      return id;
    }

    function openItem(itemId) {
      const item = getState().fs[itemId];
      if (!item) return;
      try {
        if (item.type === "app") return openApp(item.appId, item.appId === "tasks" ? { shortcutItemId: item.id } : {});
        if (item.type === "folder") return openApp("folder", { folderId: itemInWorkspace(item, getDesktopRoot()) ? item.id : getDesktopRoot() });
        if (item.type === "markdown") return openApp("markdown", { itemId: item.id });
        if (item.type === "table") return openApp("table", { itemId: item.id });
        if (item.type === "tasklist") return openApp("tasklist", { itemId: item.id });
        if (item.type === "managedFile") return openManagedFile(item.managedFile);
        if (item.type === "shortcut") return openShortcut(item);
        if (["text", "note"].includes(item.type)) return openApp("editor", { itemId: item.id });
        if (["image", "paint"].includes(item.type)) return openApp("photos", { itemId: item.id });
      } catch (error) {
        console.error("[ZeTer OS openItem]", itemId, item, error);
        toast("Ошибка открытия", item.name || "элемент");
      }
    }

    function deskNoteStickies() {
      const workspace = currentWorkspace();
      workspace.noteStickies = normalizeDesktopStickies(workspace.noteStickies, {
        getNote: noteId => getState().fs[noteId],
        isInWorkspace: note => itemInWorkspace(note, getDesktopRoot())
      });
      return workspace.noteStickies;
    }

    function makeNoteDesktopSticky(noteId) {
      const item = getState().fs[noteId];
      if (!item || item.type !== "note") return;
      const runtimeUi = getRuntimeUi();
      const result = upsertNoteSticky(deskNoteStickies(), noteId, { z: ++runtimeUi.stickyZ });
      toast(result.created ? "Стикер добавлен" : "Стикер уже открыт", item.name);
      saveState();
      renderDesktop();
    }

    function closeDesktopSticky(noteId) {
      const workspace = currentWorkspace();
      workspace.noteStickies = removeNoteSticky(deskNoteStickies(), noteId);
      saveState();
      renderDesktop();
    }

    function renderRuntimeDesktopStickies(root = documentRef.querySelector("#desktop-items")) {
      const runtimeUi = getRuntimeUi();
      return renderDesktopStickies({
        root,
        stickies: deskNoteStickies(),
        getNote: noteId => getState().fs[noteId],
        nextZ: () => ++runtimeUi.stickyZ,
        getCurrentZ: () => runtimeUi.stickyZ,
        plainToRichHtml,
        cleanRichHtml,
        saveState,
        renderAllFileSurfaces: renderFileSurfaces,
        refreshNotesWindows,
        refreshOpenEditors,
        openExternalLink,
        closeDesktopSticky
      });
    }

    const dragController = createItemDragRuntimeController({
      documentRef,
      getFs: () => getState().fs,
      setDrag: drag => { getRuntimeUi().drag = drag; },
      getDragGhost: () => documentRef.querySelector("#drag-ghost"),
      getDropMarkElements: () => documentRef.querySelectorAll(".folder-drop-hover"),
      itemIcon,
      dragGhostHTML,
      isDesktopRoot,
      getDesktopRoot,
      clientToDesktopPosition: layoutController.clientToPosition,
      positionInFolderGrid: options.positionInFolderGrid,
      applyItemPosition: options.applyItemPosition,
      canMoveIntoFolder: options.canMoveIntoFolder,
      createMovePlan: options.createMovePlan,
      applyMovePlan: options.applyMovePlan,
      findFreeFolderPosition: options.findFreeFolderPosition,
      moveManagedFileAtPoint: options.moveManagedFileAtPoint,
      markManagedFileTarget: options.markManagedFileTarget,
      clearManagedFileTarget: options.clearManagedFileTarget,
      saveState,
      renderFileSurfaces,
      toast
    });

    function desktopDragElements(ids = []) {
      const selected = new Set(ids);
      return Array.from(documentRef.querySelectorAll?.(".desktop-icon") || [])
        .filter(element => selected.has(element.dataset?.itemId));
    }

    function selectDesktopDragItems(ids = [], primaryId = "") {
      const runtimeUi = getRuntimeUi();
      const selected = new Set(ids);
      runtimeUi.multiSelected?.clear();
      if (ids.length > 1) ids.forEach(id => runtimeUi.multiSelected?.add(id));
      runtimeUi.selectedDesktop = primaryId || ids[0] || null;
      Array.from(documentRef.querySelectorAll?.(".desktop-icon") || []).forEach(element => {
        element.classList.toggle("selected", selected.has(element.dataset.itemId));
      });
    }

    function desktopFolderDropTargetAt(x, y, ids = []) {
      const under = documentRef.elementFromPoint?.(x, y);
      const selected = new Set(ids);
      const directFolder = under?.closest?.("[data-folder-target]");
      const directId = directFolder?.dataset?.folderTarget;
      if (directId && !selected.has(directId) && getState().fs[directId]?.type === "folder") {
        return { id: directId, element: directFolder };
      }
      const drop = under?.closest?.("[data-folder-drop]") || under?.closest?.(".explorer-main")?.querySelector?.("[data-folder-drop]");
      const dropId = drop?.dataset?.folderDrop;
      if (dropId && !selected.has(dropId) && getState().fs[dropId]?.type === "folder") {
        return { id: dropId, element: drop };
      }
      return null;
    }

    function canMoveDesktopGroupInto(ids = [], folderId = "") {
      return Boolean(folderId && ids.length && ids.every(id => dragController.canMoveInto(id, folderId)));
    }

    function markDesktopGroupDropTarget(x, y, ids = []) {
      dragController.clearDropMarks();
      const target = desktopFolderDropTargetAt(x, y, ids);
      if (!target || !canMoveDesktopGroupInto(ids, target.id)) return null;
      target.element.classList?.add("folder-drop-hover");
      return "folder";
    }

    function desktopDragCountText(count = 0) {
      const value = Math.max(0, Number(count) || 0);
      const mod100 = value % 100;
      const mod10 = value % 10;
      const noun = mod100 >= 11 && mod100 <= 14 ? "элементов" : (mod10 === 1 ? "элемент" : (mod10 >= 2 && mod10 <= 4 ? "элемента" : "элементов"));
      return `${value} ${noun}`;
    }

    function enableDesktopItemPointerDrag(element, itemId) {
      let session = null;

      function preview(deltaX, deltaY) {
        if (!session) return null;
        const plan = layoutController.groupMovePlan(session.items, deltaX, deltaY);
        if (!plan.valid) return null;
        session.plan = plan;
        return plan;
      }

      function commitDesktopPositions(deltaX, deltaY) {
        const plan = preview(deltaX, deltaY);
        const desktopRoot = getDesktopRoot();
        if (!plan?.valid || !desktopRoot) return false;
        const now = Date.now();
        let applied = 0;
        plan.positions.forEach(position => {
          const item = getState().fs[position.id];
          if (!item) return;
          if (options.applyItemPosition?.(item, desktopRoot, position, { now: () => now })) applied += 1;
        });
        if (applied !== plan.positions.length) return false;
        saveState();
        renderFileSurfaces();
        return true;
      }

      function finish() {
        if (!session) return;
        session.elements.forEach(source => source.classList?.remove("group-dragging-source"));
        hideDragGhost(documentRef.querySelector?.("#drag-ghost"));
        dragController.clearDropMarks();
        getRuntimeUi().drag = null;
        session = null;
      }

      return bindItemPointerDrag(element, itemId, {
        source: "desktop",
        ignoreSelector: "input,textarea,select,[data-delete-item],[data-toggle-folder],.tree-delete,.pinned-delete,.pinned-unpin,.tree-toggle",
        onDragStart: ({ event, dx, dy }) => {
          const fs = getState().fs;
          const ids = desktopDragSelectionIds(fs, getRuntimeUi().multiSelected, itemId, getDesktopRoot());
          if (!ids.length) return;
          selectDesktopDragItems(ids, itemId);
          const elements = new Map(desktopDragElements(ids).map(source => [source.dataset.itemId, source]));
          const items = ids.map(id => {
            const source = elements.get(id);
            const current = fs[id];
            const renderedX = Number.parseFloat(source?.style?.left);
            const renderedY = Number.parseFloat(source?.style?.top);
            return {
              id,
              x: Number.isFinite(renderedX) ? renderedX : (current?.x || 0),
              y: Number.isFinite(renderedY) ? renderedY : (current?.y || 0)
            };
          });
          session = { ids, items, elements, plan: null, committed: false, dropKind: null };
          getRuntimeUi().drag = { itemId, itemIds: [...ids], source: "desktop" };
          elements.forEach(source => source.classList?.add("group-dragging-source"));
          const item = fs[itemId];
          showDragGhost(documentRef.querySelector?.("#drag-ghost"), dragGhostHTML({
            icon: itemIcon(item),
            name: ids.length > 1 ? desktopDragCountText(ids.length) : (item?.name || "")
          }));
          moveDragGhost(documentRef.querySelector?.("#drag-ghost"), event.clientX, event.clientY);
          preview(dx, dy);
        },
        onDragMove: ({ event, dx, dy }) => {
          if (!session) return;
          preview(dx, dy);
          moveDragGhost(documentRef.querySelector?.("#drag-ghost"), event.clientX, event.clientY);
          if (session.ids.length > 1) {
            session.dropKind = markDesktopGroupDropTarget(event.clientX, event.clientY, session.ids);
          } else {
            session.dropKind = dragController.markDropTargets(event.clientX, event.clientY, itemId);
          }
        },
        onDrop: ({ event, dx, dy }) => {
          if (!session) return;
          const folderTarget = desktopFolderDropTargetAt(event.clientX, event.clientY, session.ids);
          if (folderTarget && canMoveDesktopGroupInto(session.ids, folderTarget.id)) {
            if (session.ids.length > 1) {
              session.committed = bulkMoveItemsToFolder(session.ids, folderTarget.id) > 0;
              if (session.committed) {
                getRuntimeUi().multiSelected?.clear();
                getRuntimeUi().selectedDesktop = null;
              }
            } else {
              session.committed = dragController.handleItemDrop(itemId, event.clientX, event.clientY);
            }
            return;
          }
          if (session.ids.length === 1 && session.dropKind === "managed-file") {
            session.committed = dragController.handleItemDrop(itemId, event.clientX, event.clientY);
            return;
          }
          const under = documentRef.elementFromPoint?.(event.clientX, event.clientY);
          if (under?.closest?.("#desktop-items,#desktop")) {
            session.committed = commitDesktopPositions(dx, dy);
            return;
          }
          if (session.ids.length === 1) {
            session.committed = dragController.handleItemDrop(itemId, event.clientX, event.clientY);
          }
        },
        onDragEnd: finish,
        onCancel: finish
      });
    }

    function moveItemToDesktop(itemId) {
      const item = getState().fs[itemId];
      if (!item) return false;
      const desktopRoot = getDesktopRoot();
      const position = layoutController.findFreePosition(desktopRoot, null, null, item.id);
      item.parent = desktopRoot;
      item.x = position.x;
      item.y = position.y;
      item.updatedAt = Date.now();
      saveState();
      renderFileSurfaces();
      return true;
    }

    const itemActions = options.itemActions && typeof options.itemActions === "object" ? options.itemActions : {};
    const menuController = createDesktopContextMenuController({
      getDesktopRoot,
      getItem: itemId => getState().fs[itemId],
      itemIcon,
      canPinToStart: options.canPinToStart,
      itemTaskbarAppId: options.itemTaskbarAppId,
      getAppName: appId => getApps()[appId]?.name || "",
      isTaskbarPinned: options.isTaskbarPinned,
      showContext: options.showContext,
      refreshDesktop: renderDesktop,
      createFolder: (root, point) => options.createFolder?.(root, { x: point.x, y: point.y }),
      createFile: (root, point) => options.createFile?.(root, { defaultName: "Новый файл.txt", openAfter: true, x: point.x, y: point.y }),
      createShortcut: (root, point) => options.createShortcut?.(root, { x: point.x, y: point.y }),
      createTable: (root, point) => options.createTable?.(root, { openAfter: true, x: point.x, y: point.y }),
      createTaskList: (root, point) => options.createTaskList?.(root, { openAfter: true, x: point.x, y: point.y }),
      createNote: (root, point) => options.createItem?.("note", "Новая заметка", root, point.x, point.y, { content: "" }),
      undo: options.undo,
      exportData: options.exportData,
      openImport: options.openImport,
      openSettings: () => openApp("settings"),
      itemActions: {
        open: openItem,
        rename: itemActions.rename,
        duplicate: itemActions.duplicate,
        "item-settings": itemActions.settings,
        "set-start-pinned": (itemId, action) => itemActions.setStartPinned?.(itemId, action.pinned),
        "set-taskbar-pinned": (_itemId, action) => itemActions.setTaskbarPinned?.(action.appId, action.pinned),
        "create-task-list": (_itemId, _action, item) => options.createTaskList?.(item.id, { openAfter: true, x: 72, y: 72 }),
        "make-sticky": makeNoteDesktopSticky,
        "move-to-desktop": moveItemToDesktop,
        "copy-location": itemActions.copyLocation,
        properties: itemActions.properties,
        delete: itemActions.delete
      }
    });

    return Object.freeze({
      desktopRootOf,
      itemInWorkspace,
      workspaceItems,
      desktopForbiddenRects: layoutController.forbiddenRects,
      clampDesktopPosition: layoutController.clampPosition,
      clientToDesktopPosition: layoutController.clientToPosition,
      findFreeDesktopPosition: layoutController.findFreePosition,
      addDesktopShortcut,
      openItem,
      renderDesktopStickies: renderRuntimeDesktopStickies,
      canMoveInto: dragController.canMoveInto,
      moveItemToFolder: dragController.moveItemToFolder,
      handleItemDrop: dragController.handleItemDrop,
      enableItemPointerDrag: dragController.enableItemPointerDrag,
      enableDesktopItemPointerDrag,
      showDesktopMenu: menuController.showDesktopMenu,
      showItemMenu: menuController.showItemMenu
    });
  }

  function desktopStickyHTML({
    name = "",
    contentHtml = "",
    colorOptionsHTML = "",
    textColorOptionsHTML = "",
    fontSize = 16,
    opacityPct = 95
  } = {}) {
    return `
        <header class="desktop-sticky-head">
          <span>🗒️</span>
          <input data-sticky-title value="${escapeHtml(name)}" aria-label="Название заметки">
          <button data-sticky-settings title="Настройки стикера" aria-label="Настройки стикера">⚙</button>
          <button data-close-sticky title="Закрыть стикер">×</button>
        </header>
        <div data-sticky-text contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Текст заметки">${contentHtml}</div>
        <div class="desktop-sticky-settings" data-sticky-settings-panel hidden>
          <label>Цвет заметки
            <select data-sticky-color>${colorOptionsHTML}</select>
          </label>
          <label>Цвет текста
            <select data-sticky-text-color>${textColorOptionsHTML}</select>
          </label>
          <label>Размер текста
            <input data-sticky-font-size type="range" min="12" max="22" step="1" value="${Number(fontSize) || 16}">
            <span data-sticky-font-size-value>${Number(fontSize) || 16}px</span>
          </label>
          <label>Непрозрачность
            <input data-sticky-opacity type="range" min="70" max="100" step="5" value="${Number(opacityPct) || 95}">
            <span data-sticky-opacity-value>${Number(opacityPct) || 95}%</span>
          </label>
          <div class="desktop-sticky-settings-actions">
            <button data-sticky-reset type="button">Сбросить</button>
            <button data-sticky-settings-close type="button">Закрыть</button>
          </div>
        </div>
        <i class="desktop-sticky-resize" data-sticky-resize title="Потяни, чтобы изменить размер"></i>`;
  }

  function bindDesktopStickyDrag(card, sticky, options = {}) {
    const nextZ = typeof options.nextZ === "function" ? options.nextZ : () => sticky.z || 1;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const head = $(".desktop-sticky-head", card);
    if (!head) return;
    let drag = null;
    head.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button,input,textarea,[contenteditable]")) return;
      drag = { sx: event.clientX, sy: event.clientY, x: sticky.x || 0, y: sticky.y || 0 };
      sticky.z = nextZ();
      card.style.zIndex = sticky.z;
      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    head.addEventListener("pointermove", event => {
      if (!drag) return;
      sticky.x = drag.x + event.clientX - drag.sx;
      sticky.y = drag.y + event.clientY - drag.sy;
      clampStickyPosition(sticky);
      card.style.left = `${sticky.x}px`;
      card.style.top = `${sticky.y}px`;
    });
    head.addEventListener("pointerup", event => {
      if (!drag) return;
      drag = null;
      try { head.releasePointerCapture(event.pointerId); } catch {}
      saveState();
    });
    head.addEventListener("pointercancel", () => {
      drag = null;
      saveState();
    });
  }

  function bindDesktopStickyResize(card, sticky, options = {}) {
    const nextZ = typeof options.nextZ === "function" ? options.nextZ : () => sticky.z || 1;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const handle = $("[data-sticky-resize]", card);
    if (!handle) return;
    let resize = null;

    handle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const { w, h } = stickyBounds(sticky);
      resize = { sx: event.clientX, sy: event.clientY, w, h };
      sticky.z = nextZ();
      card.style.zIndex = sticky.z;
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener("pointermove", event => {
      if (!resize) return;
      resizeStickyFromPointer(sticky, resize, event.clientX, event.clientY);
      card.style.width = `${sticky.w}px`;
      card.style.height = `${sticky.h}px`;
    });

    const finishResize = event => {
      if (!resize) return;
      resize = null;
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      saveState();
    };
    handle.addEventListener("pointerup", finishResize);
    handle.addEventListener("pointercancel", finishResize);
  }

  function bindDesktopStickySettings(card, sticky, options = {}) {
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const button = $("[data-sticky-settings]", card);
    const panel = $("[data-sticky-settings-panel]", card);
    if (!button || !panel) return;

    const color = $("[data-sticky-color]", panel);
    const textColor = $("[data-sticky-text-color]", panel);
    const fontSize = $("[data-sticky-font-size]", panel);
    const fontSizeValue = $("[data-sticky-font-size-value]", panel);
    const opacity = $("[data-sticky-opacity]", panel);
    const opacityValue = $("[data-sticky-opacity-value]", panel);
    const reset = $("[data-sticky-reset]", panel);
    const close = $("[data-sticky-settings-close]", panel);
    const persist = debounce(() => saveState(), 260);

    const update = () => {
      sticky.color = color?.value || STICKY_DEFAULT_COLOR;
      sticky.textColor = textColor?.value || STICKY_DEFAULT_TEXT;
      sticky.fontSize = Math.round(clamp(Number(fontSize?.value) || STICKY_DEFAULT_FONT_SIZE, 12, 22));
      sticky.opacity = clamp((Number(opacity?.value) || 100) / 100, .7, 1);
      if (fontSizeValue) fontSizeValue.textContent = `${sticky.fontSize}px`;
      if (opacityValue) opacityValue.textContent = `${Math.round(sticky.opacity * 100)}%`;
      applyStickyVisual(card, sticky);
      persist();
    };

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      $$("[data-sticky-settings-panel]").forEach(openPanel => {
        if (openPanel !== panel) openPanel.hidden = true;
      });
      panel.hidden = !panel.hidden;
    });

    panel.addEventListener("pointerdown", event => event.stopPropagation());
    [color, textColor].forEach(control => control?.addEventListener("change", update));
    [fontSize, opacity].forEach(control => control?.addEventListener("input", update));

    reset?.addEventListener("click", event => {
      event.preventDefault();
      sticky.color = STICKY_DEFAULT_COLOR;
      sticky.textColor = STICKY_DEFAULT_TEXT;
      sticky.fontSize = STICKY_DEFAULT_FONT_SIZE;
      sticky.opacity = STICKY_DEFAULT_OPACITY;
      if (color) color.value = sticky.color;
      if (textColor) textColor.value = sticky.textColor;
      if (fontSize) fontSize.value = sticky.fontSize;
      if (opacity) opacity.value = Math.round(sticky.opacity * 100);
      update();
    });

    close?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      panel.hidden = true;
    });
  }

  function renderDesktopStickies(options = {}) {
    const root = options.root;
    if (!root) return 0;
    const getNote = typeof options.getNote === "function" ? options.getNote : () => null;
    const nextZ = typeof options.nextZ === "function" ? options.nextZ : () => 1;
    const getCurrentZ = typeof options.getCurrentZ === "function" ? options.getCurrentZ : () => 1;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderAllFileSurfaces = typeof options.renderAllFileSurfaces === "function" ? options.renderAllFileSurfaces : () => {};
    const refreshNotesWindows = typeof options.refreshNotesWindows === "function" ? options.refreshNotesWindows : () => {};
    const refreshOpenEditors = typeof options.refreshOpenEditors === "function" ? options.refreshOpenEditors : () => {};
    const closeDesktopSticky = typeof options.closeDesktopSticky === "function" ? options.closeDesktopSticky : () => {};
    const openExternalLink = typeof options.openExternalLink === "function" ? options.openExternalLink : () => {};
    const plainToRichHtml = typeof options.plainToRichHtml === "function" ? options.plainToRichHtml : value => String(value || "");
    const cleanRichHtml = typeof options.cleanRichHtml === "function" ? options.cleanRichHtml : value => String(value || "");
    let rendered = 0;

    (Array.isArray(options.stickies) ? options.stickies : []).forEach(sticky => {
      const note = getNote(sticky.noteId);
      if (!note) return;
      clampStickyPosition(sticky);
      const { w, h } = stickyBounds(sticky);
      const card = document.createElement("article");
      card.className = "desktop-sticky glass";
      card.dataset.noteId = note.id;
      card.style.left = `${sticky.x}px`;
      card.style.top = `${sticky.y}px`;
      card.style.width = `${w}px`;
      card.style.height = `${h}px`;
      card.style.zIndex = sticky.z || getCurrentZ();
      normalizeStickySettings(sticky);
      applyStickyVisual(card, sticky);
      card.innerHTML = desktopStickyHTML({
        name: note.name,
        contentHtml: cleanRichHtml(note.richContent || plainToRichHtml(note.content || "")),
        colorOptionsHTML: stickySelectOptions(STICKY_COLORS, sticky.color),
        textColorOptionsHTML: stickySelectOptions(STICKY_TEXT_COLORS, sticky.textColor),
        fontSize: sticky.fontSize,
        opacityPct: Math.round(sticky.opacity * 100)
      });

      const title = $("[data-sticky-title]", card);
      const text = $("[data-sticky-text]", card);
      const migratedFiles = ensureManagedFileInlineMarkers(text, note.managedFiles);
      if (migratedFiles) {
        note.richContent = cleanRichHtml(text.innerHTML);
        note.content = plainTextWithoutManagedFiles(text);
        note.updatedAt = Date.now();
        saveState({ skipExternalBackup: true });
      }
      const saveStickyData = ({ refreshSurfaces = false } = {}) => {
        const current = getNote(note.id);
        if (!current) return;
        const nextName = title.value.trim();
        current.name = nextName || current.name;
        current.content = plainTextWithoutManagedFiles(text);
        current.richContent = cleanRichHtml(text.innerHTML);
        current.updatedAt = Date.now();
        saveState();
        if (refreshSurfaces) renderAllFileSurfaces();
        refreshNotesWindows();
        refreshOpenEditors(note.id);
      };
      const saveStickyLive = () => saveStickyData({ refreshSurfaces: false });
      const saveStickyNow = () => saveStickyData({ refreshSurfaces: true });
      const saveSticky = debounce(saveStickyLive, 220);

      title.addEventListener("input", saveSticky);
      title.addEventListener("change", saveStickyNow);
      title.addEventListener("blur", saveStickyNow);
      title.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        saveStickyNow();
        title.blur();
      });
      text.addEventListener("input", saveSticky);
      text.addEventListener("blur", saveStickyLive);
      text.addEventListener("paste", event => {
        const html = event.clipboardData?.getData("text/html") || "";
        const plain = event.clipboardData?.getData("text/plain") || "";
        if (!html && !plain) return;
        event.preventDefault();
        const cleanedHtml = html ? cleanRichHtml(html) : "";
        const pastedHtml = plain && /(?:https?:\/\/|www\.)/i.test(plain) && !/<a\b/i.test(cleanedHtml)
          ? plainToRichHtml(plain)
          : (cleanedHtml || plainToRichHtml(plain));
        document.execCommand("insertHTML", false, pastedHtml);
        saveStickyLive();
      });
      text.addEventListener("click", event => {
        const link = event.target.closest?.("a[href]");
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        openExternalLink(link.getAttribute("href") || "");
      });
      card.addEventListener("pointerdown", () => {
        sticky.z = nextZ();
        card.style.zIndex = sticky.z;
        saveState({ skipExternalBackup: true });
      });
      $("[data-close-sticky]", card).addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        closeDesktopSticky(note.id);
      });
      bindDesktopStickyDrag(card, sticky, { nextZ, saveState });
      bindDesktopStickyResize(card, sticky, { nextZ, saveState });
      bindDesktopStickySettings(card, sticky, { saveState });
      root.appendChild(card);
      rendered++;
    });
    return rendered;
  }

  window.ZETER_DESKTOP_UI_UTILS = Object.freeze({
    desktopIconHTML,
    dragGhostHTML,
    renderDesktopIcons,
    desktopDragSelectionIds,
    desktopSelectionAfterClick,
    createDesktopSurfaceController,
    createDesktopItemRuntimeController,
    desktopStickyHTML,
    bindDesktopStickyDrag,
    bindDesktopStickyResize,
    bindDesktopStickySettings,
    renderDesktopStickies
  });
})();
