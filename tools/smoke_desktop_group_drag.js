"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const sandbox = {
  console,
  setTimeout(callback) { callback(); return 1; },
  document: {},
  window: {
    innerWidth: 1280,
    innerHeight: 720,
    ZETER_CORE_UTILS: {
      $() { return null; },
      $$() { return []; },
      clamp(value, min, max) { return Math.min(max, Math.max(min, value)); },
      escapeHtml(value) { return String(value ?? ""); },
      debounce(callback) { return callback; }
    },
    ZETER_STICKY_UTILS: {},
    ZETER_CONTEXT_MENU_UI_UTILS: { createDesktopContextMenuController() { return {}; } },
    ZETER_MANAGED_FILE_UTILS: {}
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function loadCore(name) {
  const filePath = path.join(ROOT, "app", "js", "core", name);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
}

loadCore("desktop-layout-utils.js");
loadCore("item-drag-ui-utils.js");
loadCore("desktop-ui-utils.js");
loadCore("config.js");
loadCore("fs-item-utils.js");
loadCore("app-catalog.js");
loadCore("app-center-ui-utils.js");

const layout = sandbox.window.ZETER_DESKTOP_LAYOUT_UTILS;
const itemDrag = sandbox.window.ZETER_ITEM_DRAG_UI_UTILS;
const desktopUi = sandbox.window.ZETER_DESKTOP_UI_UTILS;

const baseItems = [
  { id: "folder", x: 100, y: 140 },
  { id: "file", x: 260, y: 310 }
];
const moved = layout.desktopGroupMovePlan(baseItems, 75, -40, { viewportWidth: 1280, viewportHeight: 720 });
assert.equal(moved.valid, true);
assert.equal(moved.dx, 75);
assert.equal(moved.dy, -40);
assert.deepEqual(
  JSON.parse(JSON.stringify(moved.positions)),
  [{ id: "folder", x: 175, y: 100 }, { id: "file", x: 335, y: 270 }],
  "all selected icons must receive one common delta"
);
assert.equal(
  moved.positions[1].x - moved.positions[0].x,
  baseItems[1].x - baseItems[0].x,
  "group drag must preserve relative horizontal spacing"
);
assert.equal(
  moved.positions[1].y - moved.positions[0].y,
  baseItems[1].y - baseItems[0].y,
  "group drag must preserve relative vertical spacing"
);

const bounded = layout.desktopGroupMovePlan([
  { id: "left", x: 100, y: 100 },
  { id: "right", x: 1100, y: 300 }
], 200, 500, { viewportWidth: 1280, viewportHeight: 720 });
assert.equal(bounded.dx, 100, "the whole group must stop when its rightmost icon reaches the desktop edge");
assert.equal(bounded.dy, 338, "the whole group must stop when its lowest icon reaches the desktop edge");

const measuredMembers = [
  { id: "large-long", x: 80, y: 160, w: 104, h: 152 },
  { id: "large-short", x: 260, y: 160, w: 104, h: 106 }
];
const measuredBounds = layout.desktopGroupMovePlan(measuredMembers, 1400, 900, {
  viewportWidth: 1440, viewportHeight: 800, gap: 16
});
assert.equal(measuredBounds.dx, 1060, "measured 104px tile plus 16px render clearance bounds the whole group");
assert.equal(measuredBounds.dy, 472, "the real 152px long label bounds the whole group vertically");
assert.equal(measuredBounds.positions[1].x - measuredBounds.positions[0].x, 180);
assert.equal(measuredBounds.positions[1].y - measuredBounds.positions[0].y, 0);
const reRendered = [];
measuredBounds.positions.forEach((position, index) => {
  const rect = { ...measuredMembers[index], ...position };
  const resolved = layout.resolveIconPosition(rect, reRendered, { width: 1440, gap: 16 });
  assert.equal(resolved.x, position.x, "post-drop render cannot move either member independently");
  assert.equal(resolved.y, position.y);
  reRendered.push(rect);
});
const partiallyOutside = layout.desktopGroupMovePlan([
  { id: "left", x: 1200, y: 160, w: 104, h: 152 },
  { id: "right", x: 1380, y: 160, w: 104, h: 106 }
], 0, 0, { viewportWidth: 1440, viewportHeight: 800, gap: 16 });
assert.equal(partiallyOutside.positions[1].x - partiallyOutside.positions[0].x, 180,
  "initial member normalization must use one delta even if a member starts beyond the boundary");
const tallObstacle = [{ x: 300, y: 250, w: 100, h: 100 }];
const tallAvoided = layout.desktopGroupMovePlan(measuredMembers.map(item => ({ ...item, y: 100 })), 120, 0, {
  viewportWidth: 1440, viewportHeight: 800, forbiddenRects: tallObstacle
});
assert.equal(tallAvoided.valid, true);
tallAvoided.positions.forEach((position, index) => {
  assert.equal(layout.rectsOverlap({ ...measuredMembers[index], ...position }, tallObstacle[0], 8), false,
    "forbidden-area avoidance must include measured label height");
});

const forbiddenRects = [{ x: 390, y: 0, w: 320, h: 190 }];
const avoided = layout.desktopGroupMovePlan(baseItems, 310, -140, {
  viewportWidth: 1280,
  viewportHeight: 720,
  forbiddenRects
});
assert.equal(avoided.valid, true);
avoided.positions.forEach(position => {
  assert.equal(
    layout.overlapsForbiddenDesktopArea(position.x, position.y, forbiddenRects),
    false,
    "no member of the moved group may overlap a forbidden desktop panel"
  );
});

const fsState = {
  folder: { id: "folder", parent: "desktop-1" },
  file: { id: "file", parent: "desktop-1" },
  other: { id: "other", parent: "desktop-2" }
};
assert.deepEqual(
  JSON.parse(JSON.stringify(desktopUi.desktopDragSelectionIds(fsState, new Set(["folder", "file", "other"]), "folder", "desktop-1"))),
  ["folder", "file"],
  "grabbing one selected desktop icon must pick up the complete visible selection"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(desktopUi.desktopDragSelectionIds(fsState, new Set(["folder", "file"]), "other", "desktop-2"))),
  ["other"],
  "grabbing an icon outside the current selection must drag only that icon"
);

assert.deepEqual(
  JSON.parse(JSON.stringify(desktopUi.desktopSelectionAfterClick("tasks", [], "calendar", true))),
  { selectedId: "calendar", selectedIds: ["tasks", "calendar"] },
  "Ctrl+click must add a new icon to an existing single selection"
);
assert.deepEqual(
  JSON.parse(JSON.stringify(desktopUi.desktopSelectionAfterClick("calendar", ["tasks", "calendar", "file"], "calendar", true))),
  { selectedId: "file", selectedIds: ["tasks", "file"] },
  "Ctrl+click on a selected icon must remove only that icon"
);

function fakeSelectionIcon(itemId) {
  return {
    dataset: { itemId },
    selected: false,
    classList: {
      toggle(name, active) { if (name === "selected") this.owner.selected = Boolean(active); },
      owner: null
    }
  };
}

const selectionIcons = ["tasks", "calendar", "file"].map(fakeSelectionIcon);
selectionIcons.forEach(icon => { icon.classList.owner = icon; });
let selectedDesktopId = "tasks";
const multiSelectedIds = new Set();
const surfaceController = desktopUi.createDesktopSurfaceController({
  getSelectedId: () => selectedDesktopId,
  setSelectedId: value => { selectedDesktopId = value; },
  getSelectedIds: () => multiSelectedIds,
  getIcons: () => selectionIcons
});

surfaceController.selectItem("calendar", { ctrlKey: true });
assert.deepEqual([...multiSelectedIds], ["tasks", "calendar"]);
assert.deepEqual(selectionIcons.map(icon => icon.selected), [true, true, false]);
surfaceController.selectItem("file", { ctrlKey: true });
assert.deepEqual([...multiSelectedIds], ["tasks", "calendar", "file"]);
surfaceController.selectItem("calendar", { ctrlKey: true });
assert.deepEqual([...multiSelectedIds], ["tasks", "file"]);
assert.deepEqual(selectionIcons.map(icon => icon.selected), [true, false, true]);
surfaceController.selectItem("tasks", { ctrlKey: true });
assert.equal(selectedDesktopId, "file");
assert.equal(multiSelectedIds.size, 0, "one remaining Ctrl-selected icon must become the normal single selection");
surfaceController.selectItem("file", { ctrlKey: true });
assert.equal(selectedDesktopId, null);
assert.equal(multiSelectedIds.size, 0, "Ctrl+click on the last selected icon must clear selection");
surfaceController.selectItem("tasks");
surfaceController.selectItem("calendar");
assert.equal(selectedDesktopId, "calendar");
assert.equal(multiSelectedIds.size, 0, "plain click must keep exactly one selected icon");
assert.deepEqual(selectionIcons.map(icon => icon.selected), [false, true, false]);

function fakeEventTarget() {
  const listeners = {};
  return {
    addEventListener(type, callback) { listeners[type] = callback; },
    removeEventListener(type, callback) { if (listeners[type] === callback) delete listeners[type]; },
    dispatch(type, event) { listeners[type]?.(event); }
  };
}

function fakePointerElement(ownerDocument) {
  return {
    ...fakeEventTarget(),
    ownerDocument,
    dataset: {},
    setPointerCapture() {},
    releasePointerCapture() { throw new Error("pointer capture was already released"); }
  };
}

const pointerDocument = fakeEventTarget();
const pointerElement = fakePointerElement(pointerDocument);
const events = [];
itemDrag.bindItemPointerDrag(pointerElement, "file", {
  threshold: 6,
  onDragStart(payload) { events.push(["start", payload.dx, payload.dy]); },
  onDragMove(payload) { events.push(["move", payload.dx, payload.dy]); },
  onDrop(payload) { events.push(["drop", payload.dx, payload.dy]); }
});
pointerElement.dispatch("pointerdown", { button: 0, clientX: 10, clientY: 20, pointerId: 1, target: null });
pointerDocument.dispatch("pointermove", { clientX: 13, clientY: 23, pointerId: 1 });
pointerDocument.dispatch("pointermove", { clientX: 25, clientY: 40, pointerId: 1 });
pointerDocument.dispatch("pointerup", {
  clientX: 30,
  clientY: 45,
  pointerId: 1,
  preventDefault() {},
  stopPropagation() {}
});
assert.deepEqual(events, [
  ["start", 15, 20],
  ["move", 15, 20],
  ["drop", 20, 25]
], "pointer drag lifecycle must expose the exact shared movement delta");

async function smokeAppShortcutNames() {
  const state = { fs: { folder: { id: "folder", type: "folder", name: "Промпты", parent: "second" } } };
  const originalFolder = JSON.stringify(state.fs.folder);
  let root = "desktop", sequence = 0;
  const items = desktopUi.createDesktopItemRuntimeController({
    getState: () => state, getApps: () => sandbox.window.ZETER_APP_CATALOG.APP_CATALOG_DEFINITIONS,
    getDesktopRoot: () => root, isDesktopRoot: parent => ["desktop", "second"].includes(parent),
    documentRef: { querySelector() { return null; } }, createId: prefix => `${prefix}_${++sequence}`,
    uniqueName: (name, parent) => sandbox.window.ZETER_FS_ITEM_UTILS.uniqueName(state.fs, name, parent)
  });
  const apps = sandbox.window.ZETER_APP_CENTER_UI_UTILS.createAppShortcutController({
    getState: () => state, getApps: () => sandbox.window.ZETER_APP_CATALOG.APP_CATALOG_DEFINITIONS,
    getRootId: () => root, itemInWorkspace: items.itemInWorkspace, addDesktopShortcut: items.addDesktopShortcut,
    saveState: async () => ({ saved: true })
  });
  assert.equal(await apps.install("prompts"), true);
  assert.equal(state.fs[apps.shortcutIds("prompts")[0]].name, "Промпты");
  assert.equal(await apps.uninstall("prompts"), true);
  root = "second";
  assert.equal(await apps.install("prompts"), true);
  assert.equal(state.fs[apps.shortcutIds("prompts")[0]].name, "Промпты", "same-named folder must not number an app label");
  assert.equal(await apps.install("prompts"), false, "app center still prevents duplicate installation in one workspace");
  assert.equal(JSON.stringify(state.fs.folder), originalFolder);
  assert.equal(sandbox.window.ZETER_FS_ITEM_UTILS.uniqueName(state.fs, "Промпты", "second"), "Промпты (2)", "ordinary filesystem naming still protects collisions");
  root = "desktop"; assert.equal(await apps.install("prompts"), true);
  assert.equal(state.fs[apps.shortcutIds("prompts")[0]].name, "Промпты", "another workspace keeps the plain app label");
  console.log("app shortcut names smoke: ok (install/delete/other desktop, same-name folder, independent labels, file collision protection)");
}
smokeAppShortcutNames().then(() => console.log("desktop group drag smoke: ok")).catch(error => { console.error(error); process.exitCode = 1; });
