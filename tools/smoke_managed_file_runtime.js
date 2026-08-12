"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeFileReader {
  readAsDataURL(blob) {
    this.result = `data:application/octet-stream;base64,${Buffer.from(blob.bytes).toString("base64")}`;
    queueMicrotask(() => this.onload?.());
  }
}

const sandbox = {
  console,
  Buffer,
  URL,
  FileReader: FakeFileReader,
  queueMicrotask,
  document: {},
  window: {
    ZETER_CORE_UTILS: {
      $() { return null; },
      $$() { return []; },
      clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
      debounce(callback) { return callback; },
      escapeHtml(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const shortcutSource = fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", "shortcut-utils.js"), "utf8");
vm.runInContext(shortcutSource, sandbox, { filename: "shortcut-utils.js" });
const source = fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", "managed-file-utils.js"), "utf8");
vm.runInContext(source, sandbox, { filename: "managed-file-utils.js" });

const managed = sandbox.window.ZETER_MANAGED_FILE_UTILS;
assert.ok(managed);
assert.equal(managed.normalizeManagedPath("Файлы ZeTer OS\\Стол\\ролик.mp4"), "Файлы ZeTer OS/Стол/ролик.mp4");
assert.equal(managed.normalizeManagedPath("../outside.exe"), "");
assert.equal(managed.managedFileIcon({ name: "movie.mkv" }), "🎬");
const webShortcut = managed.normalizeManagedFile({
  id: "web-shortcut",
  name: "Сайт",
  kind: "shortcut",
  shortcutTarget: "https://example.com/docs"
});
assert.equal(webShortcut.kind, "shortcut");
assert.equal(webShortcut.shortcutKind, "url");
assert.equal(managed.managedFileIcon(webShortcut), "🌐");
const sizedFile = managed.normalizeManagedFile({
  id: "sized",
  name: "очень длинное название файла.xlsx",
  managedPath: "Файлы ZeTer OS/Стол/очень длинное название файла.xlsx",
  displayWidth: 175,
  offsetX: 0,
  offsetY: 21
});
assert.equal(sizedFile.displayWidth, 175);
assert.equal(sizedFile.offsetX, 0);
assert.equal(sizedFile.offsetY, 21);
const tableChip = managed.managedFileAttachmentHTML(sizedFile, { resizable: true, positioned: true, containerHeight: 80 });
assert.match(tableChip, /очень длинное название файла\.xlsx/);
assert.match(tableChip, /data-managed-file-resizer="sized"/);
assert.match(tableChip, /style="width:175px;left:0px;top:21px"/);
assert.equal(managed.managedFileInlineMarkerHTML("sized"), '<span data-managed-file-inline="sized"></span>');
const persistedInlineMarker = {
  dataset: { managedFileInline: "sized", managedFileInlineX: "640" },
  style: { marginLeft: "", removeProperty(name) { if (name === "margin-left") this.marginLeft = ""; } },
  setAttribute() {}
};
assert.equal(managed.hydrateManagedFileInlineMarkers({ querySelectorAll() { return [persistedInlineMarker]; } }, [sizedFile]), 1);
assert.equal(persistedInlineMarker.style.marginLeft, "640px");
const copiedReference = managed.copyManagedFileReference(sizedFile, { id: "copy-1" });
assert.equal(copiedReference.id, "copy-1");
assert.equal(copiedReference.managedPath, sizedFile.managedPath);
assert.equal(managed.managedFileFromDataTransfer({
  getData(type) { return type === managed.MANAGED_FILE_DATA_TYPE ? JSON.stringify(sizedFile) : ""; }
}).managedPath, sizedFile.managedPath);
const moveTransfer = managed.managedFileTransferFromDataTransfer({
  getData(type) {
    return type === managed.MANAGED_FILE_DATA_TYPE
      ? JSON.stringify({ file: sizedFile, source: { kind: "inline", itemId: "note-1", fileId: sizedFile.id } })
      : "";
  }
});
assert.equal(moveTransfer.file.id, sizedFile.id);
assert.deepEqual(JSON.parse(JSON.stringify(moveTransfer.source)), { kind: "inline", itemId: "note-1", fileId: sizedFile.id });

const nativeListeners = [];
const fakeClassList = { add() {}, remove() {} };
const nativeDocument = {
  body: { classList: fakeClassList },
  querySelector() { return null; },
  addEventListener(type, handler, capture = false) { nativeListeners.push({ type, handler, capture }); }
};
const dropController = managed.createManagedFileRuntimeController({
  documentRef: nativeDocument,
  nativeMode: () => true,
  getState: () => ({ fs: {}, desktops: [] })
});
assert.equal(dropController.bind(), true);
const dragOverListener = nativeListeners.find(listener => listener.type === "dragover");
const dropListener = nativeListeners.find(listener => listener.type === "drop");
assert.equal(dragOverListener.capture, true);
assert.equal(dropListener.capture, true);
let prevented = 0;
let stopped = 0;
dragOverListener.handler({
  dataTransfer: { types: ["Files"], dropEffect: "" },
  target: { nodeType: 1, closest() { return null; } },
  preventDefault() { prevented++; },
  stopPropagation() { stopped++; }
});
assert.equal(prevented, 1);
assert.equal(stopped, 1);

const selectedShortcut = {
  dataset: { itemId: "selected-shortcut" },
  closest(selector) {
    if (selector === "[data-item-id]") return this;
    return null;
  }
};
const keyboardListeners = [];
const keyboardToasts = [];
const keyboardDocument = {
  body: { classList: fakeClassList },
  activeElement: null,
  querySelector(selector) { return selector.includes(".desktop-icon.selected") ? selectedShortcut : null; },
  addEventListener(type, handler) { keyboardListeners.push({ type, handler }); }
};
const keyboardController = managed.createManagedFileRuntimeController({
  documentRef: keyboardDocument,
  getState: () => ({
    fs: {
      "selected-shortcut": {
        id: "selected-shortcut",
        type: "managedFile",
        managedFile: sizedFile
      }
    }
  }),
  toast(title, message) { keyboardToasts.push([title, message]); }
});
keyboardController.bind();
let keyboardPrevented = 0;
keyboardListeners.find(listener => listener.type === "keydown").handler({
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  key: "c",
  target: { closest() { return null; } },
  preventDefault() { keyboardPrevented++; }
});
assert.equal(keyboardPrevented, 1);
assert.match(keyboardToasts[0][1], /можно вставить/);

const itemDragSource = fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", "item-drag-ui-utils.js"), "utf8");
vm.runInContext(itemDragSource, sandbox, { filename: "item-drag-ui-utils.js" });
const internalMoves = [];
const internalMarks = [];
const itemDragController = sandbox.window.ZETER_ITEM_DRAG_UI_UTILS.createItemDragRuntimeController({
  documentRef: { elementFromPoint() { return null; } },
  getFs: () => ({ shortcut: { id: "shortcut", type: "managedFile" } }),
  moveManagedFileAtPoint(itemId, x, y) { internalMoves.push([itemId, x, y]); return true; },
  markManagedFileTarget(itemId, x, y) { internalMarks.push([itemId, x, y]); return true; }
});
assert.equal(itemDragController.markDropTargets(40, 60, "shortcut"), "managed-file");
assert.equal(itemDragController.handleItemDrop("shortcut", 40, 60), true);
assert.deepEqual(internalMarks, [["shortcut", 40, 60]]);
assert.deepEqual(internalMoves, [["shortcut", 40, 60]]);

sandbox.window.ZETER_STICKY_UTILS = {};
sandbox.window.ZETER_DESKTOP_LAYOUT_UTILS = {
  createDesktopLayoutRuntimeController() {
    return {
      forbiddenRects() { return []; },
      clampPosition(x = 20, y = 20) { return { x, y }; },
      clientToPosition(x = 20, y = 20) { return { x, y }; },
      findFreePosition(_root, x = 20, y = 20) { return { x: x ?? 20, y: y ?? 20 }; }
    };
  }
};
sandbox.window.ZETER_ITEM_DRAG_UI_UTILS = {
  createItemDragRuntimeController() {
    return {
      canMoveInto() { return false; },
      moveItemToFolder() { return false; },
      handleItemDrop() { return false; },
      enableItemPointerDrag() {}
    };
  }
};
sandbox.window.ZETER_CONTEXT_MENU_UI_UTILS = {
  createDesktopContextMenuController() {
    return { showDesktopMenu() {}, showItemMenu() {} };
  }
};
const desktopSource = fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", "desktop-ui-utils.js"), "utf8");
vm.runInContext(desktopSource, sandbox, { filename: "desktop-ui-utils.js" });
const shortcut = {
  id: "shortcut-1",
  type: "managedFile",
  name: "музыка.mp3",
  parent: "desktop",
  managedFile: { id: "file-1", name: "музыка.mp3", managedPath: "Файлы ZeTer OS/Стол/музыка.mp3" }
};
const opened = [];
const desktopController = sandbox.window.ZETER_DESKTOP_UI_UTILS.createDesktopItemRuntimeController({
  getState: () => ({ fs: { [shortcut.id]: shortcut }, desktops: [] }),
  getRuntimeUi: () => ({}),
  getDesktopRoot: () => "desktop",
  isDesktopRoot: id => id === "desktop",
  openManagedFile: file => opened.push(file.managedPath),
  documentRef: { querySelector() { return null; }, querySelectorAll() { return []; } },
  windowRef: { innerWidth: 1280, innerHeight: 720 }
});
desktopController.openItem(shortcut.id);
assert.deepEqual(opened, ["Файлы ZeTer OS/Стол/музыка.mp3"]);

const page = {
  rows: [[""], [""], [""]],
  columns: ["A"],
  managedFiles: [{ id: "a", name: "a.txt", managedPath: "Файлы ZeTer OS/a.txt", row: 1, col: 0 }]
};
managed.shiftTableManagedFiles(page, { type: "insert-row", index: 1 });
assert.equal(page.managedFiles[0].row, 2);
managed.shiftTableManagedFiles(page, { type: "delete-row", index: 2 });
assert.equal(page.managedFiles.length, 0);

(async () => {
  const dragMoveState = {
    fs: {
      sourceNote: {
        id: "sourceNote",
        type: "note",
        name: "Источник",
        richContent: "",
        managedFiles: [sizedFile]
      },
      targetNote: {
        id: "targetNote",
        type: "note",
        name: "Цель",
        richContent: "<p>Текст</p>",
        managedFiles: []
      }
    }
  };
  const dragMoveListeners = [];
  const targetNoteCard = { dataset: { itemId: "targetNote" } };
  const dragMoveTarget = {
    nodeType: 1,
    closest(selector) { return selector === "[data-item-id]" ? targetNoteCard : null; }
  };
  const dragMoveController = managed.createManagedFileRuntimeController({
    documentRef: {
      body: { classList: fakeClassList },
      querySelectorAll() { return []; },
      addEventListener(type, handler) { dragMoveListeners.push({ type, handler }); }
    },
    getState: () => dragMoveState
  });
  dragMoveController.bind();
  await dragMoveListeners.find(listener => listener.type === "drop").handler({
    clientX: 30,
    clientY: 40,
    target: dragMoveTarget,
    dataTransfer: {
      types: [managed.MANAGED_FILE_DATA_TYPE],
      getData(type) {
        return type === managed.MANAGED_FILE_DATA_TYPE
          ? JSON.stringify({ file: sizedFile, source: { kind: "inline", itemId: "sourceNote", fileId: sizedFile.id } })
          : "";
      }
    },
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(dragMoveState.fs.sourceNote.managedFiles.length, 0);
  assert.equal(dragMoveState.fs.targetNote.managedFiles.length, 1);
  assert.equal(dragMoveState.fs.targetNote.managedFiles[0].id, sizedFile.id);
  await dragMoveListeners.find(listener => listener.type === "drop").handler({
    clientX: 80,
    clientY: 90,
    target: dragMoveTarget,
    dataTransfer: {
      types: [managed.MANAGED_FILE_DATA_TYPE],
      getData(type) {
        return type === managed.MANAGED_FILE_DATA_TYPE
          ? JSON.stringify({ file: sizedFile, source: { kind: "inline", itemId: "targetNote", fileId: sizedFile.id } })
          : "";
      }
    },
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(dragMoveState.fs.targetNote.managedFiles.length, 1);
  assert.equal(dragMoveState.fs.targetNote.managedFiles[0].id, sizedFile.id);

  const tableDropState = {
    fs: {
      sourceNote: {
        id: "sourceNote",
        type: "note",
        name: "Источник",
        richContent: "",
        managedFiles: [sizedFile]
      },
      targetTable: {
        id: "targetTable",
        type: "table",
        name: "Таблица",
        table: {
          activePage: 0,
          pages: [{
            name: "Страница 1",
            columns: ["A"],
            rows: [[""]],
            columnWidths: [90],
            rowHeights: [80],
            managedFiles: []
          }]
        }
      }
    }
  };
  const tableDropListeners = [];
  const tableRoot = { dataset: { managedFileItemId: "targetTable" } };
  const tableCell = {
    dataset: { row: "0", col: "0" },
    matches(selector) { return selector === "td[data-cell]"; },
    closest(selector) { return selector === "td[data-cell]" ? this : null; },
    getBoundingClientRect() { return { left: 100, top: 200, width: 90, height: 80 }; }
  };
  const tableDropTarget = {
    nodeType: 1,
    closest(selector) {
      if (selector === ".table-app[data-managed-file-item-id]") return tableRoot;
      if (selector === "td[data-cell]") return tableCell;
      return null;
    }
  };
  const tableDropController = managed.createManagedFileRuntimeController({
    documentRef: {
      body: { classList: fakeClassList },
      querySelectorAll() { return []; },
      addEventListener(type, handler) { tableDropListeners.push({ type, handler }); }
    },
    getState: () => tableDropState
  });
  tableDropController.bind();
  await tableDropListeners.find(listener => listener.type === "drop").handler({
    clientX: 168,
    clientY: 247,
    target: tableDropTarget,
    dataTransfer: {
      types: [managed.MANAGED_FILE_DATA_TYPE],
      getData(type) {
        return type === managed.MANAGED_FILE_DATA_TYPE
          ? JSON.stringify({ file: sizedFile, source: { kind: "inline", itemId: "sourceNote", fileId: sizedFile.id } })
          : "";
      }
    },
    preventDefault() {},
    stopPropagation() {}
  });
  const positionedTableFile = tableDropState.fs.targetTable.table.pages[0].managedFiles[0];
  assert.equal(tableDropState.fs.sourceNote.managedFiles.length, 0);
  assert.equal(positionedTableFile.displayWidth, 175);
  assert.equal(positionedTableFile.offsetX, 52);
  assert.equal(positionedTableFile.offsetY, 34);

  const richDropState = {
    fs: {
      sourceNote: {
        id: "sourceNote",
        type: "note",
        name: "Источник",
        richContent: "",
        managedFiles: [sizedFile]
      },
      targetNote: {
        id: "targetNote",
        type: "note",
        name: "Цель",
        richContent: "<p>Верхняя строка</p>",
        managedFiles: []
      }
    }
  };
  const richChildren = [];
  const fakeRichDocument = {
    defaultView: {
      getComputedStyle(element) {
        return element === richEditorArea
          ? { fontSize: "16px", lineHeight: "22px", paddingTop: "12px" }
          : { marginBottom: "11px" };
      }
    },
    createElement(tagName) {
      return {
        tagName,
        children: [],
        dataset: {},
        style: { marginLeft: "", removeProperty(name) { if (name === "margin-left") this.marginLeft = ""; } },
        appendChild(child) { this.children.push(child); return child; },
        getBoundingClientRect() {
          return tagName === "span"
            ? { left: 30 + (Number.parseFloat(this.style.marginLeft) || 0), width: 200, bottom: 180 }
            : { bottom: 180 };
        }
      };
    },
    createTextNode(textContent) { return { nodeType: 3, textContent }; },
    createRange() {
      let container = null;
      return {
        selectNodeContents(node) { container = node; },
        collapse() {},
        insertNode(node) { container?.children?.push(node); },
        setStartAfter() {}
      };
    },
    getSelection() { return { removeAllRanges() {}, addRange() {} }; }
  };
  const richEditorRoot = { dataset: { managedFileItemId: "targetNote" } };
  const richEditorArea = {
    nodeType: 1,
    ownerDocument: fakeRichDocument,
    textContent: "Верхняя строка",
    get lastElementChild() { return richChildren[0] || null; },
    getAttribute(name) { return name === "contenteditable" ? "true" : null; },
    getBoundingClientRect() { return { left: 20, right: 1020, top: 100, bottom: 700 }; },
    appendChild(child) { richChildren.push(child); return child; },
    closest(selector) {
      if (selector === ".rich-editor-area[contenteditable]") return this;
      if (selector === ".rich-editor[data-managed-file-item-id]") return richEditorRoot;
      return null;
    }
  };
  const richDropListeners = [];
  let richSyncs = 0;
  const richDropController = managed.createManagedFileRuntimeController({
    documentRef: {
      body: { classList: fakeClassList },
      querySelectorAll() { return []; },
      addEventListener(type, handler) { richDropListeners.push({ type, handler }); }
    },
    getState: () => richDropState,
    syncOpenEditors() { richSyncs++; }
  });
  richDropController.bind();
  await richDropListeners.find(listener => listener.type === "drop").handler({
    clientX: 850,
    clientY: 520,
    target: richEditorArea,
    dataTransfer: {
      types: [managed.MANAGED_FILE_DATA_TYPE],
      getData(type) {
        return type === managed.MANAGED_FILE_DATA_TYPE
          ? JSON.stringify({ file: sizedFile, source: { kind: "inline", itemId: "sourceNote", fileId: sizedFile.id } })
          : "";
      }
    },
    preventDefault() {},
    stopPropagation() {}
  });
  assert.ok(richChildren.length > 5, JSON.stringify({ children: richChildren.length, source: richDropState.fs.sourceNote.managedFiles.length, target: richDropState.fs.targetNote.managedFiles.length, syncs: richSyncs }));
  const rightPositionedMarker = richChildren.at(-1).children.find(child => child?.dataset?.managedFileInline === sizedFile.id);
  assert.ok(rightPositionedMarker);
  assert.equal(rightPositionedMarker.dataset.managedFileInlineX, "790");
  assert.equal(rightPositionedMarker.style.marginLeft, "790px");
  assert.equal(richDropState.fs.sourceNote.managedFiles.length, 0);
  assert.equal(richDropState.fs.targetNote.managedFiles.length, 1);
  assert.ok(richSyncs >= 2);

  const moveState = {
    fs: {
      shortcut: {
        id: "shortcut",
        type: "managedFile",
        name: sizedFile.name,
        managedFile: sizedFile
      },
      note: {
        id: "note",
        type: "note",
        name: "Заметка",
        richContent: "<p>Текст</p>",
        managedFiles: []
      }
    }
  };
  const noteCard = { dataset: { itemId: "note" } };
  const moveTarget = {
    nodeType: 1,
    closest(selector) { return selector === "[data-item-id]" ? noteCard : null; }
  };
  let moveSaves = 0;
  let moveRenders = 0;
  const moveController = managed.createManagedFileRuntimeController({
    documentRef: {
      body: { classList: fakeClassList },
      elementFromPoint() { return moveTarget; },
      querySelectorAll() { return []; }
    },
    getState: () => moveState,
    saveState() { moveSaves++; },
    renderFileSurfaces() { moveRenders++; }
  });
  assert.equal(moveController.moveManagedFileAtPoint("shortcut", 10, 20), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(moveState.fs.shortcut, undefined);
  assert.equal(moveState.fs.note.managedFiles.length, 1);
  assert.equal(moveState.fs.note.managedFiles[0].id, sizedFile.id);
  assert.match(moveState.fs.note.richContent, /data-managed-file-inline="sized"/);
  assert.equal(moveSaves, 1);
  assert.equal(moveRenders, 1);

  const calls = [];
  const bytes = Buffer.from("complete managed file");
  const fakeFile = {
    name: "данные.bin",
    size: bytes.length,
    type: "application/octet-stream",
    slice(start, end) { return { bytes: bytes.subarray(start, end) }; }
  };
  const result = await managed.copyFileToManagedStorage(fakeFile, {
    directoryParts: ["Стол"],
    async nativeStorageCall(method, payload) {
      calls.push({ method, payload });
      if (method === "begin_file_import") return { ok: true, uploadId: "upload", chunkBytes: 8 };
      if (method === "append_file_chunk") return { ok: true };
      if (method === "finish_file_import") return {
        ok: true,
        file: { id: "file-1", name: fakeFile.name, managedPath: "Файлы ZeTer OS/Стол/данные.bin", size: bytes.length }
      };
      throw new Error(`Unexpected native method: ${method}`);
    }
  });
  assert.equal(result.managedPath, "Файлы ZeTer OS/Стол/данные.bin");
  assert.deepEqual(calls.map(call => call.method), ["begin_file_import", "append_file_chunk", "finish_file_import"]);
  assert.equal(Buffer.from(calls[1].payload.base64, "base64").toString(), bytes.toString());
  console.log("managed file runtime smoke: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
