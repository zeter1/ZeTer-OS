"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = vm.createContext({ window: {
  ZETER_CORE_UTILS: { clamp: (n, min, max) => Math.max(min, Math.min(max, n)), uid: () => "fixture", todayISO: () => "2026-10-18" },
  ZETER_VISUAL_UTILS: { defaultDesktopDescription: () => "" },
  ZETER_SYSTEM_SETTINGS_UTILS: { normalizeSystemSettings: () => ({}) },
  ZETER_PINNING_UTILS: { DEFAULT_TASKBAR_PINNED_APPS: [] }, ZETER_SEARCH_UTILS: { SEARCH_FILTER_IDS: [] }
} });
for (const name of ["config", "desktop-layout-utils", "fs-item-utils", "app-catalog", "initial-state-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", `${name}.js`), "utf8"), context);
}
const items = context.window.ZETER_FS_ITEM_UTILS;
const existing = { a: { id: "a", type: "folder", parent: "desktop", name: "Новая папка" } };
const copy = items.createFsItemRecord(existing, "folder", "Новая папка", "desktop");
assert.equal(copy.item?.name, "Новая папка (2)");
existing.b = { ...copy.item, id: "b" };
assert.equal(items.createFsItemRecord(existing, "folder", "новая папка", "desktop").item?.name, "новая папка (3)");
assert.equal(items.createFsItemRecord(existing, "folder", "Новая папка", "other").item.name, "Новая папка");
assert.equal(existing.a.name, "Новая папка");
const initial = context.window.ZETER_INITIAL_STATE_UTILS.defaultState();
assert.equal(Object.values(initial.fs).some(item => item.type !== "app"), false, "new desktop has no sample files/folders");
assert.equal(initial.events.length, 0);
assert.equal(initial.notifications.length, 0);
for (const appId of context.window.ZETER_OS_CONFIG.DEFAULT_DESKTOP_APP_IDS) {
  assert.ok(Object.values(initial.fs).some(item => item.appId === appId), `missing default app ${appId}`);
}
assert.equal(context.window.ZETER_APP_CATALOG.APP_CATALOG_DEFINITIONS.notes.hidden, true);
const layout = context.window.ZETER_DESKTOP_LAYOUT_UTILS;
const scrolled = layout.createDesktopLayoutRuntimeController({
  getScrollOffset: () => ({ x: 0, y: 700 }),
  getViewportSize: () => ({ width: 460, height: 1800 })
});
assert.equal(scrolled.groupMovePlan([{ id: "overflow", x: 24, y: 1000 }], 12, 8).positions[0].y, 1008);
assert.equal(scrolled.clientToPosition(140, 300).y, 960);
const occupied = [];
for (let i = 0; i < 90; i++) {
  const rect = { x: 30, y: 30, w: i % 2 ? 180 : 150, h: i % 3 ? 138 : 230 };
  const position = layout.resolveIconPosition(rect, occupied, { width: 460 });
  const placed = { ...rect, ...position };
  assert.equal(occupied.some(other => placed.x < other.x + other.w + 4 && other.x < placed.x + placed.w + 4 && placed.y < other.y + other.h + 4 && other.y < placed.y + placed.h + 4), false, `collision at ${i}`);
  assert.ok(placed.x >= 0 && placed.x + placed.w <= 460);
  occupied.push(placed);
}
assert.equal(layout.DESKTOP_ICON_WIDTH, 80);
assert.equal(layout.DESKTOP_ICON_HEIGHT, 82);
const dense = layout.resolveIconPosition({ x: 84, y: 0, w: 80, h: 82 }, [{ x: 0, y: 0, w: 80, h: 82 }]);
assert.equal(dense.x, 84, "80px icons can be placed with a 4px gap");
assert.equal(dense.y, 0);
const longLabel = layout.resolveIconPosition({ x: 0, y: 85, w: 80, h: 110 }, [{ x: 0, y: 0, w: 80, h: 120 }], { width: 80 });
assert.ok(longLabel.y >= 124, "actual long-label height remains protected");
// Measured cloud-apply regression: menu bottom=36, collision search used 4px,
// then the next render's 8px forbidden-area clamp moved saved y=40 to y=46.
const menu={x:0,y:0,w:1400,h:36},firstIcon={x:32,y:46,w:80,h:82};
const belowMenu=layout.resolveIconPosition({...firstIcon},[firstIcon],{width:1400,gap:4,forbiddenRects:[menu]});
assert.ok(belowMenu.y>=44,'collision search must preserve at least 8px below the 36px system menu');
const nextRender=layout.clampDesktopPosition(belowMenu.x,belowMenu.y,{viewportWidth:1400,viewportHeight:1100,forbiddenRects:[menu]});
assert.deepEqual(plainPosition(nextRender),plainPosition(belowMenu),'the next render must not move ACKed coordinates out of the menu clearance');
function plainPosition(value){return {x:value.x,y:value.y};}
console.log("icon layout, empty defaults, numbered folders: ok");
