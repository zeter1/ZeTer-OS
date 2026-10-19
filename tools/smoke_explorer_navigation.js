"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const sandbox = {
  console,
  Blob,
  setTimeout(callback) { callback(); return 1; },
  document: {},
  window: {
    ZETER_CORE_UTILS: {
      $() { return null; },
      $$() { return []; },
      escapeHtml
    },
    ZETER_ASSET_UTILS: {
      isDataImage() { return false; },
      parseDataUrl() { return null; },
      mimeToExtension() { return "bin"; },
      dataUrlToBlob() { return new Blob(); },
      dataUrlByteLength() { return 0; }
    },
    ZETER_DATA_NORMALIZERS: { normalizeTaskStore() {} },
    ZETER_EXPORT_UTILS: {
      sanitizeExportPathPart(value) { return String(value || ""); },
      tablePageToCSV() { return ""; }
    },
    ZETER_TABLE_UTILS: {
      normalizeTableData() { return { pages: [] }; },
      activeTablePage() { return { rows: [], columns: [] }; }
    },
    ZETER_READABLE_EXPORT_UTILS: { formatTasksAsText() { return ""; } }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function loadCore(name) {
  const filePath = path.join(ROOT, "app", "js", "core", name);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
}

loadCore("explorer-tab-utils.js");
loadCore("explorer-ui-utils.js");
loadCore("explorer-utils.js");
loadCore("item-drag-ui-utils.js");

const explorer = sandbox.window.ZETER_EXPLORER_UTILS;
const explorerUi = sandbox.window.ZETER_EXPLORER_UI_UTILS;
const itemDrag = sandbox.window.ZETER_ITEM_DRAG_UI_UTILS;

const sortFixture = [
  { id: "10", type: "text", name: "Файл 10.txt", updatedAt: 300, createdAt: 100, bytes: 20 },
  { id: "2", type: "text", name: "Файл 2.txt", updatedAt: 200, createdAt: 300, bytes: 5 },
  { id: "1", type: "text", name: "Файл 1.txt", updatedAt: 100, createdAt: 200, bytes: 20 }
];
const sortIds = (items, options) => Array.from(explorer.sortExplorerItems(items, options, item => item.bytes), item => item.id);
assert.deepEqual(sortIds(sortFixture, { sortBy: "name", sortDirection: "asc" }), ["1", "2", "10"]);
assert.deepEqual(sortIds(sortFixture, { sortBy: "name", sortDirection: "desc" }), ["10", "2", "1"]);
assert.deepEqual(sortIds(sortFixture, { sortBy: "created", sortDirection: "desc" }), ["2", "1", "10"]);
assert.deepEqual(sortIds(sortFixture, { sortBy: "size", sortDirection: "asc" }), ["2", "1", "10"]);
const mixed = [...sortFixture, { id: "folder", type: "folder", name: "Я" }, { id: "pin", type: "text", name: "Я", pinnedInExplorer: true, bytes: 1 }];
assert.deepEqual(sortIds(mixed, { sortBy: "name", sortDirection: "desc" }).slice(0, 2), ["pin", "folder"]);
assert.equal(sortIds(mixed, { sortBy: "name", sortDirection: "asc", pinnedFirst: false, foldersFirst: false }).at(-1), "pin");
assert.deepEqual(sortIds([{ id: "none", name: "без даты" }, ...sortFixture], { sortBy: "updated", sortDirection: "asc" }), ["1", "2", "10", "none"]);
assert.deepEqual(sortFixture.map(item => item.id), ["10", "2", "1"], "sorting never mutates source order");
assert.equal(explorerUi.normalizeExplorerView({ sortBy: "bad", sortDirection: "bad" }).sortBy, "name");
assert.equal(explorerUi.normalizeExplorerView({ sortBy: "size" }).sortDirection, "desc");
assert.equal(explorerUi.normalizeExplorerView({ pinnedFirst: false }).pinnedFirst, false);
const sortMenuHTML = explorerUi.explorerSortMenuHTML({ sortBy: "updated" }, "fixture-sort");
assert.match(sortMenuHTML, /value="updated" checked/);
assert.match(sortMenuHTML, /value="desc" checked/);
assert.ok(sortMenuHTML.includes("Дата создания") && sortMenuHTML.includes("Папки сверху"));
const extensionFixture = [{ id: "b", type: "text", name: "b.TXT" }, { id: "a", type: "table", name: "a.table" }, { id: "dot", type: "text", name: ".config" }];
assert.deepEqual(sortIds(extensionFixture, { sortBy: "extension", sortDirection: "asc" }), ["dot", "a", "b"]);
assert.deepEqual(sortIds(extensionFixture, { sortBy: "extension", sortDirection: "desc" }), ["b", "a", "dot"]);
assert.equal(explorer.explorerItemSize({ type: "managedFile", managedFile: { size: 4096 } }), 4096);

assert.equal(explorerUi.explorerGridLayoutMode({ viewMode: "icons", orderedRootMode: true }), "ordered");
assert.equal(explorerUi.explorerGridLayoutMode({ viewMode: "large", orderedRootMode: true }), "ordered");
assert.equal(explorerUi.explorerGridLayoutMode({ viewMode: "list", orderedRootMode: true }), "flow");
assert.equal(explorerUi.explorerGridLayoutMode({ viewMode: "icons", orderedRootMode: true, searchMode: true }), "ordered");
for (const mode of ["huge", "large", "medium", "small", "icons", "content"]) {
  assert.equal(explorerUi.explorerGridLayoutMode({ viewMode: mode }), mode === "content" ? "flow" : "ordered", "folder items use a regular layout without changing desktop coordinates");
}
assert.equal(explorerUi.normalizeExplorerView({ mode: "unknown", compact: "yes", navigation: false }).mode, "icons");
assert.equal(explorerUi.normalizeExplorerView({ compact: "yes" }).compact, false);
assert.equal(explorerUi.normalizeExplorerView({ navigation: false }).navigation, false);
assert.equal(explorerUi.normalizeExplorerView(null).preview, true);
assert.deepEqual(JSON.parse(JSON.stringify(explorerUi.normalizeExplorerView({ columnWidths: { name: 380, type: 120, size: -1, date: Infinity, other: 5 } }).columnWidths)), { name: 380, type: 120, size: 64 });
assert.deepEqual(JSON.parse(JSON.stringify(explorerUi.normalizeExplorerView({ columnWidths: 'bad' }).columnWidths)), {});
assert.equal(explorerUi.normalizeExplorerView({ columnWidths: { name: 5000 } }).columnWidths.name, 1600);
assert.equal(explorerUi.normalizeExplorerView({ columnWidths: { name: null } }).columnWidths.name, undefined);
const gridHandlers = {};
const headerGrid = { dataset: {}, addEventListener: (name, fn) => { gridHandlers[name] = fn; } };
explorerUi.bindExplorerSelectionBox(headerGrid);
gridHandlers.pointerdown({ button: 0, target: { closest: selector => selector === ".explorer-table-header" ? {} : null }, preventDefault() { assert.fail("column headers must not start rectangle selection"); } });
const viewMenu = explorerUi.explorerViewMenuHTML({ mode: "table", compact: true }, "fixture");
for (const label of ["Огромные значки", "Крупные значки", "Обычные значки", "Мелкие значки", "Список", "Таблица", "Плитка", "Содержимое", "Область навигации", "Область просмотра", "Компактное представление"]) assert.ok(viewMenu.includes(label), label);
assert.match(viewMenu, /value="table" checked/);
assert.equal(explorerUi.explorerDisplayName({ name: "Отчёт.final.txt", type: "text" }, false), "Отчёт.final");
assert.equal(explorerUi.explorerDisplayName({ name: "Папка.2026", type: "folder" }, false), "Папка.2026");
assert.equal(explorerUi.explorerDisplayName({ name: ".config", type: "text" }, false), ".config");
const state = {
  explorerRoot: { id: "explorerRoot", type: "folder", parent: "desktop", name: "Скрытый корень", systemRole: "explorerRoot" },
  project: { id: "project", type: "folder", parent: "desktop", name: "Дела по развитию" },
  nested: { id: "nested", type: "folder", parent: "project", name: "Обучение" },
  leaf: { id: "leaf", type: "text", parent: "nested", name: "План.txt" },
  hidden: { id: "hidden", type: "folder", parent: "desktop", name: "Скрытая", hiddenInExplorer: true }
};

const tree = explorer.explorerTreeNodesForFs(state, "nested", "desktop", {
  expandedIds: [],
  isDesktopRoot: id => id === "desktop",
  includeRoot: true,
  rootName: "Рабочий стол",
  rootIcon: "🖥️"
});
const plainTree = JSON.parse(JSON.stringify(tree));
assert.equal(plainTree.length, 1);
assert.equal(plainTree[0].id, "desktop");
assert.equal(plainTree[0].root, true);
assert.equal(plainTree[0].expanded, true);
assert.deepEqual(plainTree[0].children.map(item => item.id), ["project"]);
assert.equal(plainTree[0].children[0].expanded, true, "ancestor of the open folder must be visible and expanded");
assert.equal(plainTree[0].children[0].children[0].id, "nested");
assert.equal(plainTree[0].children[0].children[0].expanded, true, "the open folder must expose its subfolder level");

const treeHtml = explorerUi.explorerTreeHTML(tree);
assert.match(treeHtml, /data-navigation-root="1"/);
assert.match(treeHtml, /Рабочий стол/);
assert.match(treeHtml, /Дела по развитию/);
assert.doesNotMatch(treeHtml, /data-delete-item=/, "Windows-like navigation rows must not show destructive buttons");
assert.equal(explorerUi.explorerPinnedHTML([]), "");
assert.doesNotMatch(explorerUi.explorerShellHTML({ treeHTML: treeHtml }), /data-action="new-folder"/);

let treeArgs = null;
let pinnedArgs = null;
const params = { activeTabId: "project", folderId: "project" };
const model = explorerUi.prepareExplorerAppModel({
  params,
  rootId: "explorerRoot",
  getItem: id => state[id],
  isDesktopRoot: id => id === "desktop",
  folderRootContext: () => "desktop",
  isExplorerRoot: id => id === "explorerRoot",
  isInExplorerSpace: () => true,
  explorerFolderIdForTab: id => id,
  explorerBaseRootForFolder: () => "desktop",
  normalizeExplorerTabs: () => ["project"],
  explorerPathText: () => "Дела по развитию",
  explorerFolderTitle: () => "Дела по развитию",
  explorerAddressText: () => "Дела по развитию",
  renderPinnedExplorer: (...args) => { pinnedArgs = args; return ""; },
  renderExplorerTree: (...args) => { treeArgs = args; return treeHtml; },
  explorerPreviewHTML: () => ""
});
assert.equal(model.desktopFolderMode, true);
assert.equal(model.navigationRootId, "desktop");
assert.equal(model.shell.canGoUp, true, "a desktop folder must allow navigation up to the desktop root");
assert.deepEqual(treeArgs, ["project", "desktop"]);
assert.deepEqual(pinnedArgs, ["project", "desktop"]);
assert.match(model.shell.treeHTML, /Дела по развитию/);

let navigatedTo = "";
assert.equal(explorerUi.runExplorerSidebarRowAction({ type: "folder", itemId: "desktop" }, {
  rootId: "desktop",
  getItem: id => state[id],
  navigateFolder: id => { navigatedTo = id; }
}), true);
assert.equal(navigatedTo, "desktop", "synthetic desktop root must remain navigable");

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

const grid = { dataset: { folderDrop: "project" }, classList: classList() };
const explorerRoot = {
  contains() { return true; },
  querySelector(selector) { return selector.includes("explorer-free-grid") ? grid : null; },
  querySelectorAll(selector) { return selector.includes("explorer-free-grid") ? [grid] : []; }
};
const preview = {
  closest(selector) { return selector === ".explorer" ? explorerRoot : null; }
};
assert.equal(itemDrag.resolveItemDropElements(preview).drop, grid, "preview and toolbar gaps must fall back to the current folder grid");

const selfFolder = { dataset: { folderTarget: "source" }, classList: classList() };
assert.equal(itemDrag.markDropTargets("source", {
  folder: selfFolder,
  drop: grid,
  canMoveInto: () => false,
  clearDropMarks() {}
}), "drop", "an invalid folder card target must still fall back to the surrounding current folder");
assert.equal(grid.classList.contains("folder-drop-hover"), true);

const desktopRootTarget = {
  dataset: { folderTarget: "desktop" },
  closest(selector) { return selector === "[data-folder-target]" ? this : null; }
};
let desktopDrop = null;
assert.equal(itemDrag.handleItemDrop("source", 140, 160, {
  document: { elementFromPoint() { return desktopRootTarget; } },
  getItem: id => id === "source" ? { id: "source", parent: "project" } : null,
  isDesktopRoot: id => id === "desktop",
  clientToDesktopPosition: () => ({ x: 100, y: 120 }),
  applyItemPosition(payload) { desktopDrop = payload; }
}), true);
assert.equal(desktopDrop.parentId, "desktop", "dropping on the synthetic desktop tree root must move the item to the desktop");

let orderedRootPositionWrites = 0;
const orderedRootGrid = {
  dataset: { folderDrop: "desktop", layoutMode: "ordered" },
  classList: classList()
};
const orderedRootHit = {
  closest(selector) {
    if (selector === "[data-folder-target]") return null;
    if (selector === "[data-folder-drop]") return orderedRootGrid;
    return null;
  }
};
assert.equal(itemDrag.handleItemDrop("desktopItem", 300, 320, {
  document: { elementFromPoint() { return orderedRootHit; } },
  getItem: id => id === "desktopItem" ? { id, parent: "desktop" } : null,
  isDesktopRoot: id => id === "desktop",
  clientToDesktopPosition: () => ({ x: 280, y: 300 }),
  applyItemPosition() { orderedRootPositionWrites += 1; }
}), true);
assert.equal(orderedRootPositionWrites, 0, "ordered Explorer view must not rewrite real desktop icon coordinates");

const folderRow = { dataset: { folderTarget: "nested" }, classList: classList() };
const folderRowChild = {
  closest(selector) {
    if (selector === "[data-folder-target]") return folderRow;
    return null;
  }
};
const externalFolderTarget = explorerUi.explorerFileDropTarget(folderRowChild, {
  root: explorerRoot,
  currentFolder: "project",
  isFolderId: id => id === "project" || id === "nested"
});
assert.equal(externalFolderTarget.folderId, "nested", "Windows files dropped on a tree or card folder must be imported into that folder");

async function smokeConfirmedExplorerDelete() {
  let finishDelete = null;
  const cleanupCalls = [];
  let navigationCalls = 0;
  const pendingDelete = explorerUi.runExplorerDeleteAction("project", {
    currentFolder: "nested",
    getItem: id => state[id],
    descendants: () => ["nested", "leaf"],
    confirmDelete: () => true,
    deleteItem: () => new Promise(resolve => { finishDelete = resolve; }),
    removeFolderReferences: ids => cleanupCalls.push(ids),
    navigateAfterDelete: () => { navigationCalls++; }
  });
  assert.deepEqual(cleanupCalls, [], "Explorer must wait for persisted deletion before cleanup");
  assert.equal(navigationCalls, 0, "Explorer must not navigate before persisted deletion");
  finishDelete(true);
  assert.equal(await pendingDelete, true);
  assert.deepEqual(JSON.parse(JSON.stringify(cleanupCalls)), [["project", "nested", "leaf"]]);
  assert.equal(navigationCalls, 1);

  const failedDelete = await explorerUi.runExplorerDeleteAction("project", {
    currentFolder: "nested",
    getItem: id => state[id],
    descendants: () => ["nested", "leaf"],
    confirmDelete: () => true,
    deleteItem: async () => false,
    removeFolderReferences: ids => cleanupCalls.push(ids),
    navigateAfterDelete: () => { navigationCalls++; }
  });
  assert.equal(failedDelete, false);
  assert.equal(cleanupCalls.length, 1, "Failed deletion must preserve Explorer references");
  assert.equal(navigationCalls, 1, "Failed deletion must keep the current folder");
}

smokeConfirmedExplorerDelete().then(() => {
  console.log("explorer navigation smoke: ok");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
