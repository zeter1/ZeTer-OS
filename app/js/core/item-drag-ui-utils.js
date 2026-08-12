(() => {
  "use strict";

  function bindItemPointerDrag(element, itemId, options = {}) {
    const source = options.source;
    const threshold = Math.max(0, Number(options.threshold) || 6);
    const ignoreSelector = String(options.ignoreSelector || "");
    const onDragStart = typeof options.onDragStart === "function" ? options.onDragStart : () => {};
    const onDragMove = typeof options.onDragMove === "function" ? options.onDragMove : () => {};
    const onDrop = typeof options.onDrop === "function" ? options.onDrop : () => {};
    const onDragEnd = typeof options.onDragEnd === "function" ? options.onDragEnd : () => {};
    const onCancel = typeof options.onCancel === "function" ? options.onCancel : () => {};
    const eventTarget = options.eventTarget || element.ownerDocument || element;
    let down = null;

    function clearActiveListeners() {
      eventTarget.removeEventListener?.("pointermove", handlePointerMove);
      eventTarget.removeEventListener?.("pointerup", handlePointerUp);
      eventTarget.removeEventListener?.("pointercancel", handlePointerCancel);
    }

    function matchesActivePointer(event) {
      return Boolean(down && (down.pointerId == null || event.pointerId == null || event.pointerId === down.pointerId));
    }

    function handlePointerMove(event) {
      if (!matchesActivePointer(event)) return;
      const dx = event.clientX - down.startX;
      const dy = event.clientY - down.startY;
      const dragEvent = {
        element,
        itemId,
        source,
        event,
        startX: down.startX,
        startY: down.startY,
        dx,
        dy
      };
      if (!down.moved && Math.hypot(dx, dy) > threshold) {
        down.moved = true;
        onDragStart(dragEvent);
      }
      if (down.moved) onDragMove(dragEvent);
    }

    function handlePointerUp(event) {
      if (!matchesActivePointer(event)) return;
      try { element.releasePointerCapture(event.pointerId); } catch {}
      if (down.moved) {
        const dragEvent = {
          element,
          itemId,
          source,
          event,
          startX: down.startX,
          startY: down.startY,
          dx: event.clientX - down.startX,
          dy: event.clientY - down.startY
        };
        onDrop(dragEvent);
        element.dataset.dragJustEnded = "1";
        setTimeout(() => { delete element.dataset.dragJustEnded; }, 80);
        onDragEnd(dragEvent);
        event.preventDefault();
        event.stopPropagation();
      }
      down = null;
      clearActiveListeners();
    }

    function handlePointerCancel(event) {
      if (!matchesActivePointer(event)) return;
      down = null;
      clearActiveListeners();
      onCancel({ element, itemId, source, event });
    }

    element.addEventListener("pointerdown", event => {
      if (event.button !== 0 || (ignoreSelector && event.target?.closest(ignoreSelector))) return;
      clearActiveListeners();
      down = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
      try { element.setPointerCapture(event.pointerId); } catch {}
      eventTarget.addEventListener("pointermove", handlePointerMove);
      eventTarget.addEventListener("pointerup", handlePointerUp);
      eventTarget.addEventListener("pointercancel", handlePointerCancel);
    });
  }

  function bindItemPointerDragLifecycle(element, itemId, options = {}) {
    const source = options.source;
    const setDrag = typeof options.setDrag === "function" ? options.setDrag : () => {};
    const setDragging = typeof options.setDragging === "function" ? options.setDragging : () => {};
    const showGhost = typeof options.showGhost === "function" ? options.showGhost : () => {};
    const moveGhost = typeof options.moveGhost === "function" ? options.moveGhost : () => {};
    const markDropTargets = typeof options.markDropTargets === "function" ? options.markDropTargets : () => {};
    const handleItemDrop = typeof options.handleItemDrop === "function" ? options.handleItemDrop : () => {};
    const hideGhost = typeof options.hideGhost === "function" ? options.hideGhost : () => {};
    const clearDropMarks = typeof options.clearDropMarks === "function" ? options.clearDropMarks : () => {};
    return bindItemPointerDrag(element, itemId, {
      source,
      ignoreSelector: options.ignoreSelector,
      onDragStart: ({ element: draggedElement, itemId: draggedItemId }) => {
        setDrag({ itemId: draggedItemId, source });
        setDragging(draggedElement, true);
        showGhost(draggedItemId);
      },
      onDragMove: ({ event, itemId: draggedItemId }) => {
        moveGhost(event.clientX, event.clientY);
        markDropTargets(event.clientX, event.clientY, draggedItemId);
      },
      onDrop: ({ event, itemId: draggedItemId }) => {
        handleItemDrop(draggedItemId, event.clientX, event.clientY);
      },
      onDragEnd: ({ element: draggedElement }) => {
        setDragging(draggedElement, false);
        hideGhost();
        clearDropMarks();
        setDrag(null);
      },
      onCancel: ({ element: draggedElement }) => {
        setDrag(null);
        setDragging(draggedElement, false);
        hideGhost();
        clearDropMarks();
      }
    });
  }

  function showDragGhost(element, html) {
    if (!element) return false;
    element.innerHTML = html;
    element.classList?.remove("hidden");
    return true;
  }

  function hideDragGhost(element) {
    if (!element) return false;
    element.classList?.add("hidden");
    return true;
  }

  function moveDragGhost(element, x, y, offset = 14) {
    if (!element?.style) return false;
    element.style.left = x + offset + "px";
    element.style.top = y + offset + "px";
    return true;
  }

  function resolveItemDropElements(element) {
    const folder = element?.closest?.("[data-folder-target]") || null;
    let drop = element?.closest?.("[data-folder-drop]") || null;
    if (!drop) {
      const explorer = element?.closest?.(".explorer");
      drop = explorer?.querySelector?.(".explorer-main .explorer-free-grid[data-folder-drop]")
        || explorer?.querySelector?.(".explorer-sidebar[data-folder-drop]")
        || null;
    }
    return { folder, drop };
  }

  function handleItemDrop(itemId, x, y, options = {}) {
    const documentRef = options.document;
    const getItem = typeof options.getItem === "function" ? options.getItem : () => null;
    const canMoveInto = typeof options.canMoveInto === "function" ? options.canMoveInto : () => false;
    const moveItemToFolder = typeof options.moveItemToFolder === "function" ? options.moveItemToFolder : () => false;
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => null;
    const clientToDesktopPosition = typeof options.clientToDesktopPosition === "function" ? options.clientToDesktopPosition : () => null;
    const positionInFolderGrid = typeof options.positionInFolderGrid === "function" ? options.positionInFolderGrid : () => null;
    const applyItemPosition = typeof options.applyItemPosition === "function" ? options.applyItemPosition : () => {};
    const item = getItem(itemId);
    if (!item || !documentRef || typeof documentRef.elementFromPoint !== "function") return false;

    const under = documentRef.elementFromPoint(x, y);
    const { folder: folderEl, drop: dropEl } = resolveItemDropElements(under);
    if (folderEl) {
      const folderId = folderEl.dataset.folderTarget;
      if (folderId && folderId !== itemId && isDesktopRoot(folderId)) {
        const position = clientToDesktopPosition(x, y);
        if (position) applyItemPosition({ item, parentId: folderId, position });
        return true;
      }
      if (folderId && folderId !== itemId && canMoveInto(itemId, folderId)) {
        if (moveItemToFolder(itemId, folderId)) return true;
      }
    }
    if (dropEl) {
      const folderId = dropEl.dataset.folderDrop;
      if (folderId) {
        if (dropEl.classList?.contains("explorer-sidebar")) {
          if (getItem(folderId)?.type === "folder" && folderId !== item.parent && canMoveInto(itemId, folderId)) {
            moveItemToFolder(itemId, folderId);
          }
          return true;
        }
        if (isDesktopRoot(folderId)) {
          if (dropEl.dataset?.layoutMode === "ordered" && item.parent === folderId) return true;
          const position = clientToDesktopPosition(x, y);
          if (position) applyItemPosition({ item, parentId: folderId, position });
          return true;
        }
        if (getItem(folderId)?.type === "folder") {
          const position = positionInFolderGrid(dropEl, x, y, item.id);
          if (folderId === item.parent) {
            if (position) applyItemPosition({ item, parentId: folderId, position });
            return true;
          }
          if (moveItemToFolder(itemId, folderId, position?.x, position?.y)) return true;
        }
      }
    }
    if (under?.closest("#desktop-items,#desktop")) {
      const desktopRoot = getDesktopRoot();
      const position = clientToDesktopPosition(x, y);
      if (desktopRoot && position) applyItemPosition({ item, parentId: desktopRoot, position });
      return true;
    }
    return false;
  }

  function clearDropMarks(elements = []) {
    Array.from(elements).forEach(element => element.classList?.remove("folder-drop-hover"));
  }

  function markDropTargets(itemId, options = {}) {
    const folder = options.folder;
    const drop = options.drop;
    const canMoveInto = typeof options.canMoveInto === "function" ? options.canMoveInto : () => false;
    const clearMarks = typeof options.clearDropMarks === "function" ? options.clearDropMarks : () => {};
    clearMarks();
    if (folder) {
      const targetId = folder.dataset?.folderTarget;
      if (targetId && targetId !== itemId && canMoveInto(itemId, targetId)) {
        folder.classList?.add("folder-drop-hover");
        return "folder";
      }
    }
    if (drop) {
      const targetId = drop.dataset?.folderDrop;
      if (!targetId || targetId !== itemId) {
        drop.classList?.add("folder-drop-hover");
        return "drop";
      }
    }
    return null;
  }

  function createItemDragRuntimeController(options = {}) {
    const documentRef = options.documentRef || document;
    const getFs = typeof options.getFs === "function" ? options.getFs : () => ({});
    const getItem = typeof options.getItem === "function" ? options.getItem : itemId => getFs()[itemId];
    const setDrag = typeof options.setDrag === "function" ? options.setDrag : () => {};
    const getDragGhost = typeof options.getDragGhost === "function" ? options.getDragGhost : () => null;
    const getDropMarkElements = typeof options.getDropMarkElements === "function" ? options.getDropMarkElements : () => [];
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const dragGhostHTML = typeof options.dragGhostHTML === "function" ? options.dragGhostHTML : () => "";
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => null;
    const clientToDesktopPosition = typeof options.clientToDesktopPosition === "function" ? options.clientToDesktopPosition : () => null;
    const positionInFolderGrid = typeof options.positionInFolderGrid === "function" ? options.positionInFolderGrid : () => null;
    const applyItemPosition = typeof options.applyItemPosition === "function" ? options.applyItemPosition : () => false;
    const createMovePlan = typeof options.createMovePlan === "function" ? options.createMovePlan : () => ({ valid: false });
    const applyMovePlan = typeof options.applyMovePlan === "function" ? options.applyMovePlan : () => ({ applied: false });
    const canMoveIntoFolder = typeof options.canMoveIntoFolder === "function" ? options.canMoveIntoFolder : () => false;
    const findFreeFolderPosition = typeof options.findFreeFolderPosition === "function" ? options.findFreeFolderPosition : () => null;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const moveManagedFileAtPoint = typeof options.moveManagedFileAtPoint === "function" ? options.moveManagedFileAtPoint : () => false;
    const markManagedFileTarget = typeof options.markManagedFileTarget === "function" ? options.markManagedFileTarget : () => false;
    const clearManagedFileTarget = typeof options.clearManagedFileTarget === "function" ? options.clearManagedFileTarget : () => {};

    function canMoveInto(itemId, folderId) {
      return canMoveIntoFolder(getFs(), itemId, folderId, { isDesktopRoot });
    }

    function moveItemToFolder(itemId, folderId, targetX = null, targetY = null) {
      const fs = getFs();
      const movePlan = createMovePlan(fs, itemId, folderId, { isDesktopRoot });
      if (!movePlan.valid) {
        if (movePlan.reason !== "forbidden-target") return false;
        toast("Нельзя переместить", "Папку нельзя положить саму в себя или в свою вложенную папку.");
        return false;
      }
      const result = applyMovePlan(fs, movePlan, { targetX, targetY, findFreeFolderPosition });
      if (!result.applied) return false;
      saveState();
      renderFileSurfaces();
      return true;
    }

    function applyPosition({ item, parentId, position }) {
      if (!applyItemPosition(item, parentId, position)) return false;
      saveState();
      renderFileSurfaces();
      return true;
    }

    function clearRuntimeDropMarks() {
      clearManagedFileTarget();
      return clearDropMarks(getDropMarkElements());
    }

    function markRuntimeDropTargets(x, y, itemId) {
      if (markManagedFileTarget(itemId, x, y)) return "managed-file";
      const element = documentRef.elementFromPoint(x, y);
      const { folder, drop } = resolveItemDropElements(element);
      return markDropTargets(itemId, { folder, drop, canMoveInto, clearDropMarks: clearRuntimeDropMarks });
    }

    function handleRuntimeItemDrop(itemId, x, y) {
      if (moveManagedFileAtPoint(itemId, x, y)) return true;
      return handleItemDrop(itemId, x, y, {
        document: documentRef,
        getItem,
        canMoveInto,
        moveItemToFolder,
        isDesktopRoot,
        getDesktopRoot,
        clientToDesktopPosition,
        positionInFolderGrid,
        applyItemPosition: applyPosition
      });
    }

    function enableItemPointerDrag(element, itemId, runtimeOptions = {}) {
      return bindItemPointerDragLifecycle(element, itemId, {
        source: runtimeOptions.source,
        ignoreSelector: "input,textarea,select,[data-delete-item],[data-toggle-folder],.tree-delete,.pinned-delete,.pinned-unpin,.tree-toggle",
        setDrag,
        setDragging: (draggedElement, isDragging) => draggedElement.classList.toggle("dragging-source", isDragging),
        showGhost: draggedItemId => {
          const item = getItem(draggedItemId);
          showDragGhost(getDragGhost(), dragGhostHTML({ icon: itemIcon(item), name: item?.name || "" }));
        },
        moveGhost: (x, y) => moveDragGhost(getDragGhost(), x, y),
        markDropTargets: markRuntimeDropTargets,
        handleItemDrop: handleRuntimeItemDrop,
        hideGhost: () => hideDragGhost(getDragGhost()),
        clearDropMarks: clearRuntimeDropMarks
      });
    }

    return Object.freeze({
      canMoveInto,
      moveItemToFolder,
      clearDropMarks: clearRuntimeDropMarks,
      markDropTargets: markRuntimeDropTargets,
      handleItemDrop: handleRuntimeItemDrop,
      enableItemPointerDrag
    });
  }

  window.ZETER_ITEM_DRAG_UI_UTILS = Object.freeze({
    bindItemPointerDrag,
    bindItemPointerDragLifecycle,
    showDragGhost,
    hideDragGhost,
    moveDragGhost,
    resolveItemDropElements,
    handleItemDrop,
    clearDropMarks,
    markDropTargets,
    createItemDragRuntimeController
  });
})();
