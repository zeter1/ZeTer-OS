(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!coreUtils || !shortcutUtils) throw new Error("ZeTer OS managed file utils require core and shortcut utils.");

  const { escapeHtml } = coreUtils;
  const { normalizeShortcutRecord, shortcutIcon } = shortcutUtils;
  const safeAttr = escapeHtml;
  const DEFAULT_CHUNK_BYTES = 1024 * 1024;
  const MANAGED_FILE_DATA_TYPE = "application/x-zeter-managed-file";
  const MANAGED_FILE_MIN_WIDTH = 42;
  const MANAGED_FILE_MAX_WIDTH = 480;
  const MANAGED_FILE_DEFAULT_WIDTH = 128;
  const MANAGED_FILE_INLINE_MAX_X = 10000;
  let managedReferenceSequence = 0;
  const EXECUTABLE_EXTENSIONS = new Set([
    "appref-ms", "bat", "cmd", "com", "cpl", "exe", "hta", "js", "jse", "lnk",
    "msc", "msi", "msp", "ps1", "reg", "scr", "vbe", "vbs", "wsf", "wsh"
  ]);

  function fileExtension(name = "") {
    const match = String(name || "").trim().match(/\.([^./\\]+)$/);
    return match ? match[1].toLowerCase() : "";
  }

  function stableManagedFileId(path = "") {
    let hash = 2166136261;
    for (const char of String(path || "")) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `file-${(hash >>> 0).toString(16)}`;
  }

  function normalizeManagedPath(value = "") {
    const path = String(value || "").trim().replace(/\\+/g, "/").replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean);
    if (!parts.length || parts.some(part => part === "." || part === "..")) return "";
    if (parts[0].toLocaleLowerCase("ru-RU") !== "файлы zeter os") return "";
    return parts.join("/");
  }

  function normalizeManagedFile(raw = {}, options = {}) {
    if (!raw || typeof raw !== "object") return null;
    const managedPath = normalizeManagedPath(raw.managedPath);
    const shortcut = normalizeShortcutRecord(raw.shortcut || raw);
    if (!managedPath && !shortcut) return null;
    const name = String(raw.name || (managedPath ? managedPath.split("/").pop() : "Ярлык") || "Файл").trim() || "Файл";
    const result = shortcut && !managedPath ? {
      id: String(raw.id || stableManagedFileId(shortcut.target)),
      name,
      kind: "shortcut",
      shortcutTarget: shortcut.target,
      shortcutKind: shortcut.kind,
      size: 0,
      mime: "application/x-zeter-shortcut",
      extension: "shortcut",
      importedAt: Math.max(0, Math.round(Number(raw.importedAt) || Date.now()))
    } : {
      id: String(raw.id || stableManagedFileId(managedPath)),
      name,
      managedPath,
      size: Math.max(0, Math.round(Number(raw.size) || 0)),
      mime: String(raw.mime || "application/octet-stream").split(";", 1)[0].trim().toLowerCase(),
      extension: String(raw.extension || fileExtension(name)).replace(/^\./, "").toLowerCase(),
      importedAt: Math.max(0, Math.round(Number(raw.importedAt) || Date.now()))
    };
    const displayWidth = Math.round(Number(raw.displayWidth));
    if (Number.isFinite(displayWidth) && displayWidth > 0) {
      result.displayWidth = Math.max(MANAGED_FILE_MIN_WIDTH, Math.min(MANAGED_FILE_MAX_WIDTH, displayWidth));
    }
    const offsetX = Math.round(Number(raw.offsetX));
    const offsetY = Math.round(Number(raw.offsetY));
    if (Number.isFinite(offsetX) && offsetX >= 0) result.offsetX = Math.min(10000, offsetX);
    if (Number.isFinite(offsetY) && offsetY >= 0) result.offsetY = Math.min(10000, offsetY);
    if (Number.isInteger(Number(raw.row)) && Number.isInteger(Number(raw.col))) {
      const row = Number(raw.row);
      const col = Number(raw.col);
      const rowCount = Number.isInteger(options.rowCount) ? options.rowCount : Number.MAX_SAFE_INTEGER;
      const colCount = Number.isInteger(options.colCount) ? options.colCount : Number.MAX_SAFE_INTEGER;
      if (row >= 0 && col >= 0 && row < rowCount && col < colCount) {
        result.row = row;
        result.col = col;
      }
    }
    return result;
  }

  function normalizeManagedFiles(list = [], options = {}) {
    const seen = new Set();
    return (Array.isArray(list) ? list : []).map(file => normalizeManagedFile(file, options)).filter(file => {
      if (!file || seen.has(file.id)) return false;
      seen.add(file.id);
      return true;
    });
  }

  function managedFileIcon(file = {}) {
    if (file?.kind === "shortcut" || file?.shortcutTarget) return shortcutIcon({ target: file.shortcutTarget, kind: file.shortcutKind });
    const extension = String(file.extension || fileExtension(file.name)).toLowerCase();
    const mime = String(file.mime || "").toLowerCase();
    if (mime.startsWith("video/") || ["avi", "m2ts", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "mts", "ts", "webm", "wmv"].includes(extension)) return "🎬";
    if (mime.startsWith("audio/") || ["aac", "flac", "m4a", "mp3", "ogg", "wav", "wma"].includes(extension)) return "🎵";
    if (mime.startsWith("image/") || ["bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(extension)) return "🖼️";
    if (["zip", "7z", "rar", "tar", "gz"].includes(extension)) return "🗜️";
    if (extension === "pdf") return "📕";
    if (["doc", "docx", "odt", "rtf", "txt"].includes(extension)) return "📄";
    if (["csv", "ods", "xls", "xlsx"].includes(extension)) return "📊";
    if (EXECUTABLE_EXTENSIONS.has(extension)) return "⚙️";
    return "📎";
  }

  function copyManagedFileReference(file = {}, options = {}) {
    const normalized = normalizeManagedFile(file?.managedFile || file);
    if (!normalized) return null;
    managedReferenceSequence = (managedReferenceSequence + 1) % 0xFFFFFF;
    const id = String(options.id || `managed-ref-${Date.now().toString(36)}-${managedReferenceSequence.toString(36)}`);
    return { ...normalized, id };
  }

  function managedFileChipInnerHTML(normalized, options = {}) {
    const compact = options.compact === true;
    const title = `Открыть двойным кликом: ${normalized.name}`;
    const resize = options.resizable === true
      ? `<span class="managed-file-resize-handle" data-managed-file-resizer="${safeAttr(normalized.id)}" title="Изменить ширину файла" aria-hidden="true"></span>`
      : "";
    return `<button type="button" class="managed-file-open" data-managed-file-open="${safeAttr(normalized.id)}" aria-label="${safeAttr(title)}">${managedFileIcon(normalized)}${compact ? "" : `<span>${escapeHtml(normalized.name)}</span>`}</button>
      ${resize}<button type="button" class="managed-file-remove" data-managed-file-remove="${safeAttr(normalized.id)}" title="${normalized.kind === "shortcut" ? "Удалить ярлык" : "Удалить ярлык и его файл из data"}" aria-label="Удалить ${safeAttr(normalized.name)}">×</button>`;
  }

  function managedFileAttachmentHTML(file = {}, options = {}) {
    const normalized = normalizeManagedFile(file);
    if (!normalized) return "";
    const compact = options.compact === true;
    const resizable = options.resizable === true;
    const title = `Открыть двойным кликом: ${normalized.name}`;
    const width = resizable ? Math.max(MANAGED_FILE_MIN_WIDTH, Math.min(MANAGED_FILE_MAX_WIDTH, Number(normalized.displayWidth) || MANAGED_FILE_DEFAULT_WIDTH)) : 0;
    const className = `managed-file-chip${compact ? " compact" : ""}${resizable ? " table-managed-file" : ""}`;
    const positioned = options.positioned === true;
    const defaultTop = Math.max(0, Math.round(Number(options.containerHeight) || 30) - 30);
    const styles = [];
    if (width) styles.push(`width:${width}px`);
    if (positioned) {
      const left = Number.isFinite(Number(normalized.offsetX)) ? Number(normalized.offsetX) : 5;
      styles.push(`left:${Math.max(0, left)}px`);
      styles.push(`top:${Math.max(0, Number.isFinite(Number(normalized.offsetY)) ? Number(normalized.offsetY) : defaultTop)}px`);
    }
    return `<span class="${className}" data-managed-file-id="${safeAttr(normalized.id)}" title="${safeAttr(title)}" draggable="true"${styles.length ? ` style="${styles.join(";")}"` : ""}>${managedFileChipInnerHTML(normalized, options)}</span>`;
  }

  function managedFilesHTML(list = [], options = {}) {
    return normalizeManagedFiles(list, options).map(file => managedFileAttachmentHTML(file, options)).join("");
  }

  function managedFileInlineMarkerHTML(fileId = "") {
    const id = String(fileId || "").trim();
    return id ? `<span data-managed-file-inline="${safeAttr(id)}"></span>` : "";
  }

  function managedFileInlineOffset(marker) {
    const value = Math.round(Number(marker?.dataset?.managedFileInlineX));
    return Number.isFinite(value) && value >= 0 ? Math.min(MANAGED_FILE_INLINE_MAX_X, value) : null;
  }

  function hydrateManagedFileInlineMarkers(root, list = [], options = {}) {
    if (!root?.querySelectorAll) return 0;
    const files = new Map(normalizeManagedFiles(list).map(file => [file.id, file]));
    let hydrated = 0;
    root.querySelectorAll("[data-managed-file-inline]").forEach(marker => {
      const file = files.get(String(marker.dataset?.managedFileInline || ""));
      if (!file) {
        marker.remove();
        return;
      }
      marker.className = "managed-file-chip managed-file-inline";
      marker.dataset.managedFileId = file.id;
      marker.setAttribute("contenteditable", "false");
      marker.setAttribute("draggable", "true");
      marker.setAttribute("title", `Открыть двойным кликом: ${file.name}`);
      marker.innerHTML = managedFileChipInnerHTML(file, { compact: options.compact === true });
      const inlineOffset = managedFileInlineOffset(marker);
      if (marker.style) {
        if (inlineOffset === null) marker.style.removeProperty("margin-left");
        else marker.style.marginLeft = `${inlineOffset}px`;
      }
      hydrated++;
    });
    return hydrated;
  }

  function ensureManagedFileInlineMarkers(root, list = []) {
    if (!root?.querySelectorAll || !root.ownerDocument) return 0;
    const files = normalizeManagedFiles(list);
    const present = new Set([...root.querySelectorAll("[data-managed-file-inline]")].map(marker => String(marker.dataset?.managedFileInline || "")));
    let added = 0;
    files.forEach(file => {
      if (present.has(file.id)) return;
      if (root.childNodes?.length) root.appendChild(root.ownerDocument.createTextNode("\u00a0"));
      const marker = root.ownerDocument.createElement("span");
      marker.dataset.managedFileInline = file.id;
      root.appendChild(marker);
      root.appendChild(root.ownerDocument.createTextNode("\u00a0"));
      present.add(file.id);
      added++;
    });
    hydrateManagedFileInlineMarkers(root, files);
    return added;
  }

  function plainTextWithoutManagedFiles(root) {
    if (!root?.cloneNode) return "";
    const clone = root.cloneNode(true);
    clone.querySelectorAll?.("[data-managed-file-inline]").forEach(marker => marker.remove());
    return String(clone.innerText ?? clone.textContent ?? "").replace(/\u00a0/g, " ");
  }

  function shiftTableManagedFiles(page = {}, operation = {}) {
    const files = normalizeManagedFiles(page.managedFiles, {
      rowCount: Array.isArray(page.rows) ? page.rows.length + (operation.type === "delete-row" ? 1 : 0) : 0,
      colCount: Array.isArray(page.columns) ? page.columns.length + (operation.type === "delete-col" ? 1 : 0) : 0
    });
    const next = [];
    files.forEach(file => {
      let row = Number(file.row);
      let col = Number(file.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      if (operation.type === "insert-row" && row >= operation.index) row += 1;
      if (operation.type === "delete-row") {
        if (row === operation.index) return;
        if (row > operation.index) row -= 1;
      }
      if (operation.type === "insert-col" && col >= operation.index) col += 1;
      if (operation.type === "delete-col") {
        if (col === operation.index) return;
        if (col > operation.index) col -= 1;
      }
      if (row >= 0 && col >= 0 && row < page.rows.length && col < page.columns.length) next.push({ ...file, row, col });
    });
    page.managedFiles = next;
    return next;
  }

  function readBlobAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл Windows."));
      reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
      reader.readAsDataURL(blob);
    });
  }

  async function copyFileToManagedStorage(file, options = {}) {
    const nativeStorageCall = typeof options.nativeStorageCall === "function" ? options.nativeStorageCall : async () => null;
    let uploadId = "";
    try {
      const begin = await nativeStorageCall("begin_file_import", {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        directoryParts: Array.isArray(options.directoryParts) ? options.directoryParts : []
      });
      uploadId = String(begin?.uploadId || "");
      if (!uploadId) throw new Error("Python не создал сеанс копирования файла.");
      const chunkBytes = Math.max(64 * 1024, Math.min(Number(begin?.chunkBytes) || DEFAULT_CHUNK_BYTES, DEFAULT_CHUNK_BYTES));
      for (let offset = 0; offset < file.size; offset += chunkBytes) {
        const end = Math.min(file.size, offset + chunkBytes);
        const base64 = await readBlobAsBase64(file.slice(offset, end));
        await nativeStorageCall("append_file_chunk", { uploadId, offset, base64 });
        if (typeof options.onProgress === "function") options.onProgress(end, file.size);
      }
      const result = await nativeStorageCall("finish_file_import", { uploadId });
      const managedFile = normalizeManagedFile(result?.file);
      if (!managedFile) throw new Error("Python сохранил файл, но вернул некорректный ярлык.");
      return managedFile;
    } catch (error) {
      if (uploadId) {
        try { await nativeStorageCall("cancel_file_import", { uploadId }); } catch {}
      }
      throw error;
    }
  }

  function draggedFiles(dataTransfer) {
    const items = Array.from(dataTransfer?.items || []);
    if (items.length) {
      return items.filter(item => item.kind === "file" && !item.webkitGetAsEntry?.()?.isDirectory).map(item => item.getAsFile()).filter(Boolean);
    }
    return Array.from(dataTransfer?.files || []).filter(Boolean);
  }

  function managedFileTransferFromDataTransfer(dataTransfer) {
    try {
      const raw = dataTransfer?.getData?.(MANAGED_FILE_DATA_TYPE);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const file = normalizeManagedFile(parsed?.file || parsed);
      if (!file) return null;
      const rawSource = parsed?.source;
      const kind = ["inline", "table"].includes(rawSource?.kind) ? rawSource.kind : "";
      const itemId = String(rawSource?.itemId || "").trim();
      const fileId = String(rawSource?.fileId || file.id).trim();
      const pageIndex = Number(rawSource?.pageIndex);
      const source = kind && itemId && fileId === file.id
        ? {
            kind,
            itemId,
            fileId,
            ...(kind === "table" && Number.isInteger(pageIndex) && pageIndex >= 0 ? { pageIndex } : {})
          }
        : null;
      return { file, source };
    } catch {
      return null;
    }
  }

  function managedFileFromDataTransfer(dataTransfer) {
    return managedFileTransferFromDataTransfer(dataTransfer)?.file || null;
  }

  function findManagedFileLocation(state = {}, fileId = "", options = {}) {
    const allItems = Object.values(state.fs || {});
    const preferred = options.itemId ? state.fs?.[options.itemId] : null;
    const items = preferred ? [preferred, ...allItems.filter(item => item !== preferred)] : allItems;
    for (const item of items) {
      const itemFiles = Array.isArray(item?.managedFiles) ? item.managedFiles : [];
      const itemIndex = itemFiles.findIndex(file => String(file?.id || "") === fileId);
      if (itemIndex >= 0) return { item, files: itemFiles, index: itemIndex, page: null };
      const pages = Array.isArray(item?.table?.pages) ? item.table.pages : [];
      const preferredPage = item === preferred && options.page && pages.includes(options.page) ? options.page : null;
      const orderedPages = preferredPage ? [preferredPage, ...pages.filter(page => page !== preferredPage)] : pages;
      for (const page of orderedPages) {
        const pageFiles = Array.isArray(page?.managedFiles) ? page.managedFiles : [];
        const pageIndex = pageFiles.findIndex(file => String(file?.id || "") === fileId);
        if (pageIndex >= 0) return { item, files: pageFiles, index: pageIndex, page };
      }
    }
    return null;
  }

  function createManagedFileRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {}, desktops: [] });
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : id => id === getDesktopRoot();
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : id => String(id || "Рабочий стол");
    const createItem = typeof options.createItem === "function" ? options.createItem : () => null;
    const saveState = typeof options.saveState === "function" ? options.saveState : async () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const refreshHostWindows = typeof options.refreshHostWindows === "function" ? options.refreshHostWindows : () => {};
    const syncOpenEditors = typeof options.syncOpenEditors === "function" ? options.syncOpenEditors : () => {};
    const cleanupRemovedItemReferences = typeof options.cleanupRemovedItemReferences === "function" ? options.cleanupRemovedItemReferences : () => {};
    const nativeStorageCall = typeof options.nativeStorageCall === "function" ? options.nativeStorageCall : async () => null;
    const openShortcutTarget = typeof options.openShortcutTarget === "function" ? options.openShortcutTarget : async () => false;
    const nativeMode = typeof options.nativeMode === "function" ? options.nativeMode : () => false;
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const confirmUser = typeof options.confirm === "function" ? options.confirm : () => true;
    const documentRef = options.documentRef || document;
    let markedElement = null;
    let bound = false;
    let importing = false;
    let copiedManagedFile = null;
    let activeManagedDrag = null;

    function hasTransferType(dataTransfer, type) {
      return Array.from(dataTransfer?.types || []).includes(type);
    }

    function rootAndTrail(parentId) {
      const state = getState();
      const trail = [];
      let currentId = parentId;
      let rootId = isDesktopRoot(currentId) ? currentId : "";
      const visited = new Set();
      while (currentId && !rootId && !visited.has(currentId)) {
        visited.add(currentId);
        const current = state.fs?.[currentId];
        if (!current) break;
        if (current.type === "folder" && current.systemRole !== "explorerRoot") trail.unshift(current.name || "Папка");
        if (isDesktopRoot(current.parent)) rootId = current.parent;
        currentId = current.parent;
      }
      if (!rootId) {
        const explorerId = currentId || parentId;
        rootId = (state.desktops || []).find(desk => [desk?.data?.explorerRootId, desk?.data?.explorerRoot].includes(explorerId))?.id || getDesktopRoot();
      }
      return { rootId, trail };
    }

    function directoryParts(target) {
      const state = getState();
      const host = target.itemId ? state.fs?.[target.itemId] : null;
      const parentId = target.kind === "folder" ? target.parentId : host?.parent || getDesktopRoot();
      const { rootId, trail } = rootAndTrail(parentId);
      const parts = [desktopName(rootId) || "Рабочий стол", "Рабочий стол", ...trail];
      if (target.kind !== "folder") parts.push("Вложения", String(host?.name || "Файл").replace(/\.[^.]+$/, ""));
      return parts;
    }

    function resolveTarget(rawTarget) {
      const element = rawTarget?.nodeType === 1 ? rawTarget : rawTarget?.parentElement;
      if (!element?.closest) return null;
      const state = getState();
      const stickyText = element.closest("[data-sticky-text][contenteditable]");
      if (stickyText) {
        const sticky = stickyText.closest(".desktop-sticky[data-note-id]");
        if (sticky) return { kind: "inline", itemId: sticky.dataset.noteId, element: stickyText, hostRoot: sticky };
      }
      const table = element.closest(".table-app[data-managed-file-item-id]");
      if (table) {
        const cell = element.closest("td[data-cell]");
        return { kind: "table", itemId: table.dataset.managedFileItemId, row: Number(cell?.dataset.row), col: Number(cell?.dataset.col), element: cell || table };
      }
      const editorArea = element.closest(".rich-editor-area[contenteditable]");
      if (editorArea) {
        const editor = editorArea.closest(".rich-editor[data-managed-file-item-id]");
        if (editor) return { kind: "inline", itemId: editor.dataset.managedFileItemId, element: editorArea, hostRoot: editor };
      }
      const card = element.closest("[data-item-id]");
      if (card) {
        const item = state.fs?.[card.dataset.itemId];
        if (item?.type === "folder") return { kind: "folder", parentId: item.id, element: card };
        if (["note", "text"].includes(item?.type)) return { kind: "inline", itemId: item.id, element: null, hostRoot: card };
        if (item?.type === "table") return { kind: "table", itemId: item.id, row: NaN, col: NaN, element: card };
      }
      const folderTarget = element.closest("[data-folder-target]");
      if (folderTarget) return { kind: "folder", parentId: folderTarget.dataset.folderTarget, element: folderTarget };
      const drop = element.closest("[data-folder-drop]");
      if (drop) {
        const rawParent = drop.dataset.folderDrop;
        return { kind: "folder", parentId: !rawParent || rawParent === "desktop" ? getDesktopRoot() : rawParent, element: drop };
      }
      if (element.closest("#desktop, #desktop-items")) return { kind: "folder", parentId: getDesktopRoot(), element: documentRef.querySelector("#desktop-items") || element };
      return null;
    }

    function appendBlankRichTextLinesToPoint(element, y) {
      if (!Number.isFinite(y) || !element?.getBoundingClientRect || !element.ownerDocument) return null;
      const doc = element.ownerDocument;
      const rect = element.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) return null;
      const view = doc.defaultView;
      const computed = view?.getComputedStyle?.(element);
      const fontSize = Math.max(12, Number.parseFloat(computed?.fontSize) || 16);
      const lineHeight = Math.max(fontSize, Number.parseFloat(computed?.lineHeight) || fontSize * 1.4);
      const paddingTop = Math.max(0, Number.parseFloat(computed?.paddingTop) || 0);
      const lastElement = element.lastElementChild;
      const lastRect = lastElement?.getBoundingClientRect?.();
      const hasContent = Boolean(String(element.textContent || "").trim() || lastElement);
      const contentBottom = Number.isFinite(lastRect?.bottom)
        ? lastRect.bottom
        : rect.top + paddingTop + (hasContent ? lineHeight : 0);
      const lastComputed = lastElement ? view?.getComputedStyle?.(lastElement) : null;
      const marginBottom = Math.max(0, Number.parseFloat(lastComputed?.marginBottom) || fontSize * 0.7);
      const paragraphStep = Math.max(lineHeight, lineHeight + marginBottom);
      const gap = y - contentBottom;
      if (gap <= paragraphStep * 0.55) return null;
      const lineCount = Math.max(1, Math.min(120, Math.ceil(gap / paragraphStep)));
      let targetParagraph = null;
      for (let index = 0; index < lineCount; index++) {
        const paragraph = doc.createElement("p");
        if (index < lineCount - 1) paragraph.appendChild(doc.createElement("br"));
        element.appendChild(paragraph);
        targetParagraph = paragraph;
      }
      return targetParagraph;
    }

    function insertionRangeAtPoint(element, x, y) {
      const doc = element?.ownerDocument || documentRef;
      let range = null;
      const extendedTarget = appendBlankRichTextLinesToPoint(element, y);
      if (extendedTarget) {
        range = doc.createRange();
        range.selectNodeContents(extendedTarget);
        range.collapse(false);
        return range;
      }
      if (Number.isFinite(x) && Number.isFinite(y) && typeof doc.caretRangeFromPoint === "function") range = doc.caretRangeFromPoint(x, y);
      else if (Number.isFinite(x) && Number.isFinite(y) && typeof doc.caretPositionFromPoint === "function") {
        const caret = doc.caretPositionFromPoint(x, y);
        if (caret) {
          range = doc.createRange();
          range.setStart(caret.offsetNode, caret.offset);
          range.collapse(true);
        }
      }
      if (!range) {
        const selected = doc.getSelection?.();
        const selectedRange = selected?.rangeCount ? selected.getRangeAt(0) : null;
        if (selectedRange && element.contains(selectedRange.startContainer)) range = selectedRange.cloneRange();
      }
      if (!range || !element.contains(range.startContainer)) {
        range = doc.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
      }
      return range;
    }

    function positionInlineMarkerAtPoint(element, marker, targetX) {
      if (!Number.isFinite(targetX) || !element?.getBoundingClientRect || !marker?.getBoundingClientRect) return;
      const hostRect = element.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      if (![hostRect.left, hostRect.right, markerRect.left].every(Number.isFinite)) return;
      const view = element.ownerDocument?.defaultView;
      const hostStyle = view?.getComputedStyle?.(element);
      const markerStyle = view?.getComputedStyle?.(marker);
      const paddingLeft = Math.max(0, Number.parseFloat(hostStyle?.paddingLeft) || 0);
      const paddingRight = Math.max(0, Number.parseFloat(hostStyle?.paddingRight) || 0);
      const currentMargin = Math.max(0, Number.parseFloat(markerStyle?.marginLeft) || 0);
      const markerWidth = Math.max(0, Number(markerRect.width) || marker.offsetWidth || 0);
      const minLeft = hostRect.left + paddingLeft;
      const maxLeft = Math.max(minLeft, hostRect.right - paddingRight - markerWidth);
      const desiredLeft = Math.max(minLeft, Math.min(maxLeft, targetX));
      const naturalLeft = markerRect.left - currentMargin;
      let inlineOffset = Math.max(0, Math.min(MANAGED_FILE_INLINE_MAX_X, Math.round(desiredLeft - naturalLeft)));
      if (marker.style) marker.style.marginLeft = `${inlineOffset}px`;
      const placedLeft = marker.getBoundingClientRect?.().left;
      if (Number.isFinite(placedLeft)) {
        inlineOffset = Math.max(0, Math.min(MANAGED_FILE_INLINE_MAX_X, inlineOffset + Math.round(desiredLeft - placedLeft)));
        if (marker.style) marker.style.marginLeft = `${inlineOffset}px`;
      }
      marker.dataset.managedFileInlineX = String(inlineOffset);
    }

    function insertInlineMarker(target, file, x, y) {
      const item = getState().fs?.[target.itemId];
      if (!item) return false;
      const element = target.element;
      if (!element?.ownerDocument || element.getAttribute?.("contenteditable") === null) {
        const separator = String(item.richContent || "").trim() ? " " : "";
        item.richContent = `${item.richContent || ""}${separator}${managedFileInlineMarkerHTML(file.id)}`;
        return false;
      }
      const doc = element.ownerDocument;
      const marker = doc.createElement("span");
      marker.dataset.managedFileInline = file.id;
      const spacer = doc.createTextNode("\u00a0");
      const grabOffsetX = Number.isFinite(activeManagedDrag?.grabOffsetX) ? activeManagedDrag.grabOffsetX : 0;
      const targetX = Number.isFinite(x) ? x - grabOffsetX : x;
      const range = insertionRangeAtPoint(element, targetX, y);
      range.insertNode(spacer);
      range.insertNode(marker);
      hydrateManagedFileInlineMarkers(element, item.managedFiles);
      positionInlineMarkerAtPoint(element, marker, targetX);
      try {
        const selection = doc.getSelection?.();
        const after = doc.createRange();
        after.setStartAfter(spacer);
        after.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(after);
      } catch {}
      return true;
    }

    function clearMark() {
      markedElement?.classList.remove("managed-file-drop-target");
      markedElement = null;
      documentRef.body?.classList.remove("managed-file-drag-active");
    }

    function mark(target) {
      if (markedElement !== target?.element) clearMark();
      markedElement = target?.element || null;
      markedElement?.classList.add("managed-file-drop-target");
      documentRef.body?.classList.add("managed-file-drag-active");
    }

    function tableFilePosition(target, managedFile, x, y, rowHeight) {
      const fallback = {
        offsetX: Math.max(0, Number.isFinite(Number(managedFile.offsetX)) ? Math.round(Number(managedFile.offsetX)) : 5),
        offsetY: Math.max(0, Number.isFinite(Number(managedFile.offsetY)) ? Math.round(Number(managedFile.offsetY)) : Math.max(0, Number(rowHeight) - 30))
      };
      const cell = target.element?.matches?.("td[data-cell]") ? target.element : target.element?.closest?.("td[data-cell]");
      if (!cell?.getBoundingClientRect || !Number.isFinite(x) || !Number.isFinite(y)) return fallback;
      const rect = cell.getBoundingClientRect();
      const width = Math.max(MANAGED_FILE_MIN_WIDTH, Math.min(MANAGED_FILE_MAX_WIDTH, Number(managedFile.displayWidth) || MANAGED_FILE_DEFAULT_WIDTH));
      const grabOffsetX = Number.isFinite(activeManagedDrag?.grabOffsetX) ? activeManagedDrag.grabOffsetX : Math.min(16, width / 2);
      const grabOffsetY = Number.isFinite(activeManagedDrag?.grabOffsetY) ? activeManagedDrag.grabOffsetY : 13;
      return {
        offsetX: Math.max(0, Math.round(x - rect.left - grabOffsetX)),
        offsetY: Math.max(0, Math.round(y - rect.top - grabOffsetY))
      };
    }

    function placeManagedFile(target, managedFile, x, y) {
      const state = getState();
      const item = state.fs?.[target.itemId];
      if (!item) throw new Error("Элемент ZeTer OS для вложения больше не существует.");
      if (target.kind === "table") {
        const table = item.table;
        const page = Array.isArray(table?.pages) ? table.pages[Math.max(0, Math.min(Number(table.activePage) || 0, table.pages.length - 1))] : null;
        if (!page) throw new Error("Активная страница таблицы не найдена.");
        const row = Number.isInteger(target.row) ? target.row : Number(page.active?.row) || 0;
        const col = Number.isInteger(target.col) ? target.col : Number(page.active?.col) || 0;
        page.managedFiles = normalizeManagedFiles(page.managedFiles, { rowCount: page.rows.length, colCount: page.columns.length });
        const displayWidth = Math.max(MANAGED_FILE_MIN_WIDTH, Math.min(MANAGED_FILE_MAX_WIDTH, Number(managedFile.displayWidth) || MANAGED_FILE_DEFAULT_WIDTH));
        const position = tableFilePosition(target, managedFile, x, y, page.rowHeights?.[row]);
        page.managedFiles.push({ ...managedFile, row, col, displayWidth, ...position });
      } else if (target.kind === "inline") {
        item.managedFiles = normalizeManagedFiles(item.managedFiles);
        item.managedFiles.push(managedFile);
      } else throw new Error("В это место нельзя вложить файл.");
      const insertedLive = target.kind === "inline" ? insertInlineMarker(target, managedFile, x, y) : false;
      item.updatedAt = Date.now();
      return { item, insertedLive };
    }

    async function commitManagedPlacement(placement) {
      if (placement.insertedLive) syncOpenEditors();
      await Promise.resolve(saveState());
      renderFileSurfaces();
      return placement.item.id;
    }

    async function attachManagedFile(target, managedFile, x, y) {
      if (target.kind === "folder") {
        const isShortcut = managedFile.kind === "shortcut";
        return createItem(isShortcut ? "shortcut" : "managedFile", managedFile.name, target.parentId, x, y, {
          extension: isShortcut ? "shortcut" : managedFile.extension,
          managedFile,
          ...(isShortcut ? { shortcut: normalizeShortcutRecord({ target: managedFile.shortcutTarget }) } : {})
        });
      }
      const placement = placeManagedFile(target, managedFile, x, y);
      const itemId = await commitManagedPlacement(placement);
      const liveEditor = placement.insertedLive && target.hostRoot?.matches?.(".rich-editor[data-managed-file-item-id]");
      if (!liveEditor) refreshHostWindows(itemId);
      return itemId;
    }

    function cloneStateItem(item) {
      return item ? JSON.parse(JSON.stringify(item)) : null;
    }

    function restoreStateItems(snapshots = new Map()) {
      const state = getState();
      snapshots.forEach((snapshot, itemId) => {
        if (snapshot) state.fs[itemId] = snapshot;
        else delete state.fs[itemId];
      });
    }

    function removeInlineMarker(root, fileId) {
      root?.querySelectorAll?.("[data-managed-file-inline]").forEach(marker => {
        if (String(marker.dataset?.managedFileInline || "") === fileId) marker.remove();
      });
    }

    function removeInlineMarkerFromItem(item, fileId) {
      if (!item?.richContent || !documentRef.createElement) return;
      const box = documentRef.createElement("div");
      box.innerHTML = item.richContent;
      removeInlineMarker(box, fileId);
      item.richContent = box.innerHTML;
    }

    function liveHostRootForItem(itemId) {
      return Array.from(documentRef.querySelectorAll?.(".rich-editor[data-managed-file-item-id],.desktop-sticky[data-note-id]") || []).find(root =>
        String(root.dataset?.managedFileItemId || root.dataset?.noteId || "") === itemId
      ) || null;
    }

    function locationForDragSource(source = {}) {
      const item = getState().fs?.[source.itemId];
      if (!item) return null;
      if (source.kind === "inline") {
        const files = Array.isArray(item.managedFiles) ? item.managedFiles : [];
        const index = files.findIndex(file => String(file?.id || "") === source.fileId);
        return index >= 0 ? { item, files, index, page: null } : null;
      }
      if (source.kind !== "table") return null;
      const pages = Array.isArray(item.table?.pages) ? item.table.pages : [];
      const preferred = Number.isInteger(source.pageIndex) ? pages[source.pageIndex] : null;
      const ordered = preferred ? [preferred, ...pages.filter(page => page !== preferred)] : pages;
      for (const page of ordered) {
        const files = Array.isArray(page?.managedFiles) ? page.managedFiles : [];
        const index = files.findIndex(file => String(file?.id || "") === source.fileId);
        if (index >= 0) return { item, files, index, page };
      }
      return null;
    }

    async function moveManagedFileFromTransfer(transfer, target, x, y) {
      if (!transfer?.source) throw new Error("Источник переносимого файла не найден.");
      syncOpenEditors();
      const location = locationForDragSource(transfer.source);
      const managedFile = location ? normalizeManagedFile(location.files[location.index]) : null;
      if (!location || !managedFile) throw new Error("Исходный ярлык файла больше не существует.");
      const state = getState();
      const snapshots = new Map();
      snapshots.set(location.item.id, cloneStateItem(location.item));
      if (target.itemId && target.itemId !== location.item.id) snapshots.set(target.itemId, cloneStateItem(state.fs?.[target.itemId]));
      const sourceRoot = activeManagedDrag?.source?.fileId === transfer.source.fileId && activeManagedDrag?.source?.itemId === transfer.source.itemId
        ? activeManagedDrag.hostRoot
        : liveHostRootForItem(location.item.id);
      try {
        removeInlineMarker(sourceRoot, managedFile.id);
        removeInlineMarkerFromItem(location.item, managedFile.id);
        location.files.splice(location.index, 1);
        location.item.updatedAt = Date.now();
        if (target.kind === "folder") {
          const isShortcut = managedFile.kind === "shortcut";
          const createdId = createItem(isShortcut ? "shortcut" : "managedFile", managedFile.name, target.parentId, x, y, {
            extension: isShortcut ? "shortcut" : managedFile.extension,
            managedFile,
            ...(isShortcut ? { shortcut: normalizeShortcutRecord({ target: managedFile.shortcutTarget }) } : {})
          });
          if (!createdId) throw new Error("Не удалось переместить файл в выбранную папку.");
          refreshHostWindows(location.item.id);
          return createdId;
        }
        const placement = placeManagedFile(target, managedFile, x, y);
        const itemId = await commitManagedPlacement(placement);
        if (location.item.id !== itemId) refreshHostWindows(location.item.id);
        const liveEditor = placement.insertedLive && target.hostRoot?.matches?.(".rich-editor[data-managed-file-item-id]");
        if (!liveEditor) refreshHostWindows(itemId);
        return itemId;
      } catch (error) {
        restoreStateItems(snapshots);
        renderFileSurfaces();
        snapshots.forEach((_snapshot, itemId) => refreshHostWindows(itemId));
        throw error;
      }
    }

    function moveManagedFileAtPoint(itemId, x, y) {
      const state = getState();
      const item = state.fs?.[itemId];
      const managedFile = ["managedFile", "shortcut"].includes(item?.type) ? normalizeManagedFile(item.managedFile) : null;
      const target = resolveTarget(documentRef.elementFromPoint?.(x, y));
      if (!managedFile || !target || !["inline", "table"].includes(target.kind)) return false;
      let snapshots = null;
      Promise.resolve().then(() => {
        syncOpenEditors();
        snapshots = new Map([
          [itemId, cloneStateItem(state.fs?.[itemId])],
          [target.itemId, cloneStateItem(state.fs?.[target.itemId])]
        ]);
        const placement = placeManagedFile(target, managedFile, x, y);
        cleanupRemovedItemReferences([itemId]);
        delete state.fs[itemId];
        return commitManagedPlacement(placement).then(targetItemId => {
          const liveEditor = placement.insertedLive && target.hostRoot?.matches?.(".rich-editor[data-managed-file-item-id]");
          if (!liveEditor) refreshHostWindows(targetItemId);
          return targetItemId;
        });
      })
        .then(() => toast(managedFile.kind === "shortcut" ? "Ярлык перемещён" : "Файл перемещён", `${managedFile.name} перенесён в содержимое.`))
        .catch(error => {
          if (snapshots) restoreStateItems(snapshots);
          renderFileSurfaces();
          refreshHostWindows(target.itemId);
          console.error("[ZeTer OS managed file internal move]", error);
          toast(managedFile.kind === "shortcut" ? "Не удалось переместить ярлык" : "Не удалось переместить файл", error?.message || managedFile.name);
        });
      return true;
    }

    function markManagedFileTarget(itemId, x, y) {
      const item = getState().fs?.[itemId];
      const target = ["managedFile", "shortcut"].includes(item?.type) ? resolveTarget(documentRef.elementFromPoint?.(x, y)) : null;
      if (!target || !["inline", "table"].includes(target.kind)) {
        clearMark();
        return false;
      }
      mark(target);
      return true;
    }

    async function importDroppedFiles(event, target) {
      if (importing) return toast("Копирование уже идёт", "Дождись завершения текущих файлов.");
      const files = draggedFiles(event.dataTransfer);
      if (!files.length) return toast("Файлы не найдены", "Папки перетаскивать нельзя, выбери один или несколько файлов.");
      importing = true;
      syncOpenEditors();
      let imported = 0;
      const failures = [];
      try {
        for (let index = 0; index < files.length; index++) {
          const file = files[index];
          toast("Копирование файла", `${index + 1} из ${files.length}: ${file.name}`);
          try {
            const managedFile = await copyFileToManagedStorage(file, {
              nativeStorageCall,
              directoryParts: directoryParts(target)
            });
            const created = await attachManagedFile(target, managedFile, event.clientX + index * 18, event.clientY + index * 18);
            if (!created) throw new Error("Не удалось создать ярлык ZeTer OS.");
            imported++;
          } catch (error) {
            console.error("[ZeTer OS managed file import]", file.name, error);
            failures.push(`${file.name}: ${error?.message || "ошибка копирования"}`);
          }
        }
      } finally {
        importing = false;
      }
      if (imported) toast("Файлы скопированы в ZeTer OS", `Готово: ${imported} из ${files.length}. Открытие — двойным кликом.`);
      if (failures.length) toast("Не все файлы скопированы", failures.slice(0, 3).join(" · "));
    }

    async function openManagedFile(file) {
      const normalized = normalizeManagedFile(file?.managedFile || file);
      if (!normalized) return toast("Файл недоступен", "В ярлыке нет корректного пути к копии в data.");
      if (normalized.kind === "shortcut") return openShortcutTarget(normalized.shortcutTarget, normalized.name);
      if (EXECUTABLE_EXTENSIONS.has(normalized.extension) && !confirmUser(`Запустить потенциально исполняемый файл «${normalized.name}» из ZeTer OS\\data?`)) return false;
      try {
        await nativeStorageCall("open_managed_file", { managedPath: normalized.managedPath });
        return true;
      } catch (error) {
        console.error("[ZeTer OS managed file open]", error);
        toast("Не удалось открыть файл", error?.message || normalized.name);
        return false;
      }
    }

    function hostContext(element) {
      const state = getState();
      const tableRoot = element?.closest?.(".table-app[data-managed-file-item-id]");
      if (tableRoot) {
        const item = state.fs?.[tableRoot.dataset.managedFileItemId];
        const pages = Array.isArray(item?.table?.pages) ? item.table.pages : [];
        const page = pages[Math.max(0, Math.min(Number(item?.table?.activePage) || 0, pages.length - 1))] || null;
        return { itemId: item?.id || "", page, hostRoot: tableRoot };
      }
      const editor = element?.closest?.(".rich-editor[data-managed-file-item-id]");
      if (editor) return { itemId: editor.dataset.managedFileItemId, page: null, hostRoot: editor };
      const sticky = element?.closest?.(".desktop-sticky[data-note-id]");
      return { itemId: sticky?.dataset.noteId || "", page: null, hostRoot: sticky || null };
    }

    async function removeManagedFile(fileId, context = {}) {
      const location = findManagedFileLocation(getState(), fileId, context);
      if (!location) return false;
      const file = normalizeManagedFile(location.files[location.index]);
      if (!file) return false;
      const shortcutOnly = file.kind === "shortcut";
      if (!confirmUser(shortcutOnly
        ? `Удалить ярлык «${file.name}»? Исходный файл, папка или сайт не изменятся.`
        : `Удалить ярлык «${file.name}»? Если других ярлыков на эту копию нет, файл будет удалён из ZeTer OS\\data.`)) return false;
      context.hostRoot?.querySelectorAll?.("[data-managed-file-inline]").forEach(marker => {
        if (String(marker.dataset?.managedFileInline || "") === fileId) marker.remove();
      });
      if (context.hostRoot) syncOpenEditors();
      if (location.item.richContent && documentRef.createElement) {
        const box = documentRef.createElement("div");
        box.innerHTML = location.item.richContent;
        box.querySelectorAll("[data-managed-file-inline]").forEach(marker => {
          if (String(marker.dataset?.managedFileInline || "") === fileId) marker.remove();
        });
        location.item.richContent = box.innerHTML;
      }
      location.files.splice(location.index, 1);
      location.item.updatedAt = Date.now();
      await Promise.resolve(saveState());
      renderFileSurfaces();
      refreshHostWindows(location.item.id);
      toast(shortcutOnly ? "Ярлык удалён" : "Файл удалён", shortcutOnly
        ? `${file.name} · цель ярлыка не удалялась.`
        : `${file.name} · копия в data очищена, если больше нигде не используется.`);
      return true;
    }

    function handleDragOver(event) {
      const windowsFiles = nativeMode() && hasTransferType(event.dataTransfer, "Files");
      const managedFile = hasTransferType(event.dataTransfer, MANAGED_FILE_DATA_TYPE);
      if (!windowsFiles && !managedFile) return;
      event.preventDefault();
      event.stopPropagation();
      const target = resolveTarget(event.target);
      if (event.dataTransfer) event.dataTransfer.dropEffect = target ? (windowsFiles ? "copy" : "move") : "none";
      if (target) mark(target); else clearMark();
    }

    function handleDrop(event) {
      const windowsFiles = nativeMode() && hasTransferType(event.dataTransfer, "Files");
      const internalTransfer = managedFileTransferFromDataTransfer(event.dataTransfer);
      if (!windowsFiles && !internalTransfer) return;
      event.preventDefault();
      event.stopPropagation();
      const target = resolveTarget(event.target);
      clearMark();
      if (!target) return toast("Некуда добавить файл", "Перетащи его на рабочий стол, папку, заметку, таблицу или стикер.");
      if (internalTransfer) {
        return Promise.resolve(moveManagedFileFromTransfer(internalTransfer, target, event.clientX, event.clientY))
          .then(() => toast(internalTransfer.file.kind === "shortcut" ? "Ярлык перемещён" : "Файл перемещён", `${internalTransfer.file.name} перенесён в выбранное место.`))
          .catch(error => {
            console.error("[ZeTer OS managed file drag move]", error);
            toast("Не удалось переместить файл", error?.message || internalTransfer.file.name);
          });
      }
      importDroppedFiles(event, target);
    }

    function handleDragStart(event) {
      if (event.target?.closest?.("[data-managed-file-resizer],[data-managed-file-remove]")) {
        event.preventDefault();
        return;
      }
      const chip = event.target?.closest?.(".managed-file-chip[data-managed-file-id]");
      if (!chip || !event.dataTransfer) return;
      const context = hostContext(chip);
      const location = findManagedFileLocation(getState(), chip.dataset.managedFileId, context);
      const file = location ? normalizeManagedFile(location.files[location.index]) : null;
      if (!file) return;
      const pages = Array.isArray(location.item?.table?.pages) ? location.item.table.pages : [];
      const source = {
        kind: location.page ? "table" : "inline",
        itemId: location.item.id,
        fileId: file.id,
        ...(location.page ? { pageIndex: Math.max(0, pages.indexOf(location.page)) } : {})
      };
      const chipRect = chip.getBoundingClientRect?.();
      const grabOffsetX = Number.isFinite(event.clientX) && Number.isFinite(chipRect?.left)
        ? Math.max(0, Math.min(Number(chipRect.width) || MANAGED_FILE_DEFAULT_WIDTH, event.clientX - chipRect.left))
        : 16;
      const grabOffsetY = Number.isFinite(event.clientY) && Number.isFinite(chipRect?.top)
        ? Math.max(0, Math.min(Number(chipRect.height) || 27, event.clientY - chipRect.top))
        : 13;
      activeManagedDrag = { source, hostRoot: context.hostRoot || null, grabOffsetX, grabOffsetY };
      event.dataTransfer.setData(MANAGED_FILE_DATA_TYPE, JSON.stringify({ file, source }));
      event.dataTransfer.setData("text/plain", file.name);
      event.dataTransfer.effectAllowed = "move";
    }

    function managedFileFromElement(element) {
      const chip = element?.closest?.(".managed-file-chip[data-managed-file-id]");
      if (chip) {
        const context = hostContext(chip);
        const location = findManagedFileLocation(getState(), chip.dataset.managedFileId, context);
        return location ? normalizeManagedFile(location.files[location.index]) : null;
      }
      const itemElement = element?.closest?.("[data-item-id]");
      const item = itemElement ? getState().fs?.[itemElement.dataset.itemId] : null;
      return ["managedFile", "shortcut"].includes(item?.type) ? normalizeManagedFile(item.managedFile) : null;
    }

    function handleKeyDown(event) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = String(event.key || "").toLowerCase();
      if (key === "c") {
        const selectedElement = documentRef.querySelector?.([
          ".managed-file-chip.selected",
          ".desktop-icon.selected[data-item-id]",
          ".explorer-file-icon.selected[data-item-id]",
          ".file-card.selected[data-item-id]"
        ].join(","));
        const file = managedFileFromElement(event.target) || managedFileFromElement(documentRef.activeElement) || managedFileFromElement(selectedElement);
        copiedManagedFile = file ? copyManagedFileReference(file) : null;
        if (copiedManagedFile) {
          event.preventDefault();
          toast(copiedManagedFile.kind === "shortcut" ? "Ярлык скопирован" : "Файл скопирован", `${copiedManagedFile.name} можно вставить в текст, стикер или таблицу через Ctrl+V.`);
        }
        return;
      }
      if (key !== "v" || !copiedManagedFile) return;
      const target = resolveTarget(event.target) || resolveTarget(documentRef.activeElement);
      if (!target || !["inline", "table"].includes(target.kind)) return;
      event.preventDefault();
      const reference = copyManagedFileReference(copiedManagedFile);
      Promise.resolve(attachManagedFile(target, reference, NaN, NaN))
        .then(() => toast("Файл вставлен", reference.name))
        .catch(error => toast("Не удалось вставить файл", error?.message || reference.name));
    }

    function handleClick(event) {
      const remove = event.target?.closest?.("[data-managed-file-remove]");
      const open = event.target?.closest?.("[data-managed-file-open]");
      if (!remove && !open) return;
      event.preventDefault();
      event.stopPropagation();
      if (remove) removeManagedFile(remove.dataset.managedFileRemove, hostContext(remove));
      else open.closest(".managed-file-chip")?.classList.toggle("selected", true);
    }

    function handleDoubleClick(event) {
      const open = event.target?.closest?.("[data-managed-file-open]");
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      const location = findManagedFileLocation(getState(), open.dataset.managedFileOpen, hostContext(open));
      if (location) openManagedFile(location.files[location.index]);
    }

    function bind() {
      if (bound) return false;
      bound = true;
      documentRef.addEventListener("dragover", handleDragOver, true);
      documentRef.addEventListener("dragleave", event => { if (!event.relatedTarget) clearMark(); });
      documentRef.addEventListener("drop", handleDrop, true);
      documentRef.addEventListener("dragstart", handleDragStart);
      documentRef.addEventListener("dragend", () => { activeManagedDrag = null; clearMark(); });
      documentRef.addEventListener("keydown", handleKeyDown);
      documentRef.addEventListener("click", handleClick);
      documentRef.addEventListener("dblclick", handleDoubleClick);
      return true;
    }

    return Object.freeze({
      bind,
      resolveTarget,
      importDroppedFiles,
      openManagedFile,
      removeManagedFile,
      moveManagedFileAtPoint,
      markManagedFileTarget,
      clearManagedFileTarget: clearMark
    });
  }

  window.ZETER_MANAGED_FILE_UTILS = Object.freeze({
    EXECUTABLE_EXTENSIONS,
    MANAGED_FILE_DATA_TYPE,
    MANAGED_FILE_MIN_WIDTH,
    MANAGED_FILE_MAX_WIDTH,
    MANAGED_FILE_DEFAULT_WIDTH,
    fileExtension,
    normalizeManagedPath,
    normalizeManagedFile,
    normalizeManagedFiles,
    copyManagedFileReference,
    managedFileIcon,
    managedFileAttachmentHTML,
    managedFilesHTML,
    managedFileInlineMarkerHTML,
    hydrateManagedFileInlineMarkers,
    ensureManagedFileInlineMarkers,
    plainTextWithoutManagedFiles,
    shiftTableManagedFiles,
    copyFileToManagedStorage,
    draggedFiles,
    managedFileTransferFromDataTransfer,
    managedFileFromDataTransfer,
    findManagedFileLocation,
    createManagedFileRuntimeController
  });
})();
