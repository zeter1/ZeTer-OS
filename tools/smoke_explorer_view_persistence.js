"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const base = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(base, name), "utf8");
const context = vm.createContext({ window: { ZETER_CORE_UTILS: {
  $() {}, $$() { return []; }, escapeHtml: String
} }, TextEncoder, Date, console });
for (const name of ["explorer-tab-utils", "explorer-ui-utils", "storage-utils"]) {
  vm.runInContext(read(`app/js/core/${name}.js`), context);
}
const normalize = context.window.ZETER_EXPLORER_UI_UTILS.normalizeExplorerView;
const adapter = read("app/js/app.js").match(/saveView: (\(folderId, patch\) => persistSearchAwareTransaction\(async write => \{[\s\S]*?\n      \}\)),/);
assert.ok(adapter, "exercise the real adapter rather than a duplicate");
const state = {
  fs: { f: { id: "f", type: "folder", name: "keep", explorerView: { mode: "large" } }, child: { id: "child", type: "folder" } },
  settings: {}, currentDesktop: "desktop",
  desktops: [
    { id: "desktop", data: { settings: { explorerView: normalize({ mode: "medium" }) } } },
    { id: "second", data: { settings: { explorerView: normalize({ mode: "small" }) } } }
  ]
};
let allowed = true, refusal = false, hold = null, entered = null, writes = 0;
let persisted = structuredClone(state);
const queue = context.window.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({
  getState: () => state, cloneState: structuredClone, writesAllowed: () => allowed,
  nativeStorage: true,
  writePrimaryRecord: async snapshot => {
    writes++; entered?.();
    if (hold) await hold;
    if (refusal) throw new Error("fixture refusal");
    persisted = structuredClone(snapshot);
    return { updatedAt: 1 };
  }
});
// Legacy aliases do not own visual settings; all storage and view logic is real.
const save = new Function("state", "viewDesktopId", "persistSearchAwareTransaction",
  "syncLegacyWorkspaceAliases", "cloneForBackup", "isDesktopRoot", "explorerUiUtils",
  "return " + adapter[1])(
  state, "desktop", operation => queue.transaction(operation), () => {}, structuredClone,
  id => state.desktops.some(desktop => desktop.id === id), { normalizeExplorerView: normalize }
);
(async () => {
  await save("desktop", { mode: "table", columnWidths: { name: 400 }, sortBy: "size", sortDirection: "asc" });
  await save("desktop", { extensions: false, columnWidths: { type: 160 } });
  assert.equal(state.desktops[0].data.settings.explorerView.mode, "table");
  assert.equal(persisted.desktops[0].data.settings.explorerView.extensions, false);
  assert.equal(persisted.desktops[0].data.settings.explorerView.columnWidths.name, 400);
  assert.equal(persisted.desktops[0].data.settings.explorerView.sortBy, "size");
  assert.equal(persisted.desktops[0].data.settings.explorerView.sortDirection, "asc");
  const before = JSON.stringify(state), disk = JSON.stringify(persisted);
  refusal = true;
  await assert.rejects(save("desktop", { columnWidths: { name: 800 }, sortBy: "created" }), /fixture refusal/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(JSON.stringify(persisted), disk);
  refusal = false;
  await save("desktop", { mode: "list" });
  allowed = false;
  const count = writes;
  await assert.rejects(save("f", { mode: "huge" }), /Не удалось сохранить/);
  assert.equal(writes, count);
  assert.equal(state.fs.f.explorerView.mode, "large");
  allowed = true;
  await save("f", { mode: "huge", columnWidths: { size: 180 } });
  assert.equal(persisted.fs.f.explorerView.mode, "huge");
  assert.equal(state.fs.f.name, "keep");
  await save("child", { mode: "table" });
  assert.deepEqual(JSON.parse(JSON.stringify(state.fs.child.explorerView.columnWidths)), {}, "new folder does not inherit desktop column widths");
  let release, signal;
  hold = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { signal = resolve; });
  entered = signal;
  const first = save("desktop", { mode: "content", columnWidths: { name: 500 } });
  await started;
  const second = save("desktop", { compact: true, columnWidths: { type: 200 }, pinnedFirst: false });
  state.currentDesktop = "second";
  assert.equal(state.desktops[0].data.settings.explorerView.mode, "list");
  release();
  await Promise.all([first, second]);
  const current = state.desktops[0].data.settings.explorerView;
  assert.equal(current.mode, "content");
  assert.equal(current.compact, true);
  assert.equal(current.extensions, false);
  assert.equal(current.columnWidths.name, 500);
  assert.equal(current.columnWidths.type, 200);
  assert.equal(current.sortBy, "size");
  assert.equal(current.sortDirection, "asc");
  assert.equal(current.pinnedFirst, false);
  assert.equal(state.fs.f.explorerView.pinnedFirst, true);
  assert.equal(persisted.desktops[0].data.settings.explorerView.compact, true);
  assert.equal(state.desktops[1].data.settings.explorerView.mode, "small");
  assert.equal(state.settings.explorerView, undefined);
  await save("desktop", { columnWidths: { type: null } });
  assert.equal(state.desktops[0].data.settings.explorerView.columnWidths.type, undefined);
  assert.equal(state.desktops[0].data.settings.explorerView.columnWidths.name, 500);
  console.log("explorer view persistence smoke: ok (column merge, refusal/retry, folder isolation, pending desktop switch)");
})().catch(error => { console.error(error); process.exitCode = 1; });
