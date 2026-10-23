"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
assert.equal(fs.existsSync(path.join(root, "app/js/core/trash-utils.js")), false, "obsolete trash owner must be removed");
for (const file of ["app/js/app.js", "app/js/core/state-migration-utils.js", "app/js/core/shell-ui-utils.js", "app/js/core/security-ui-utils.js"])
  assert.doesNotMatch(read(file), /createTrashActionController|restoreTrashItem|moveItemsToTrash|purgeExpiredTrash|refreshRecycleBinWindows/, file);
const native = read("run_zeter_os.py");
assert.doesNotMatch(native, /purged_deleted = purge_deleted_items_from_state/, "normal native startup/save must preserve legacy records");
const sandbox = { window: { ZETER_OS_CONFIG: { LEGACY_DELETED_ROOT: "__zeter_trash__" } } };
vm.createContext(sandbox);
vm.runInContext(read("app/js/core/deletion-utils.js"), sandbox);
const utils = sandbox.window.ZETER_DELETION_UTILS;
assert.deepEqual(Object.keys(utils).sort(), ["activeItemIdsForPermanentDelete", "createDeletionController", "permanentlyRemoveItemsFromTarget"].sort());
async function run() {
  const legacy = { id: "legacy", parent: "__zeter_trash__", deletedAt: 1 };
  const state = { fs: { note: { id: "note", name: "Заметка", parent: "desktop" }, legacy }, actionHistory: [] };
  let allow = false, fail = false;
  const controller = utils.createDeletionController({ getState: () => state, confirm: () => allow,
    saveState: async () => { if (fail) throw Error("disk full"); return { saved: true }; } });
  assert.equal(await controller.deleteItem("note"), false);
  assert.ok(state.fs.note, "cancel keeps data");
  allow = true; fail = true;
  assert.equal(await controller.deleteItem("note"), false);
  assert.ok(state.fs.note, "save refusal restores data");
  fail = false;
  assert.equal(await controller.deleteItem("note"), true);
  assert.equal(state.fs.note, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(state.fs.legacy)), legacy, "legacy data remains untouched");
  assert.equal(state.actionHistory.length, 0, "no reversible deletion or trash created");
  vm.runInContext(read("app/js/core/state-maintenance-utils.js"), sandbox);
  const maintenance = sandbox.window.ZETER_STATE_MAINTENANCE_UTILS;
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const live = { fs: { a: { id: "a", type: "app", appId: "calculator", parent: "desktop" }, b: { id: "b", name: "before", parent: "desktop" } }, taskbarPinnedApps: ["calculator"] };
  let closed = 0, rejectWrite = true, written;
  const staged = utils.createDeletionController({ getState: () => live, confirm: () => true,
    pruneTargetReferencesForRemovedItems: maintenance.pruneTargetReferencesForRemovedItems,
    cleanupRemovedItemReferences: () => { assert.ok(live.fs.a, "runtime cleanup still has source metadata"); closed++; },
    persistTransaction: async operation => operation(async snapshot => {
      written = snapshot;
      if (rejectWrite) { started(); await new Promise(resolve => { release = resolve; }); throw Error("disk full"); }
      return { saved: true };
    }) });
  const pending = staged.deleteItem("a"); await began;
  assert.ok(live.fs.a, "live deletion waits for ACK"); assert.equal(closed, 0);
  live.fs.b.name = "new concurrent text"; live.sentinel = "keep";
  release(); assert.equal(await pending, false);
  assert.equal(live.fs.b.name, "new concurrent text"); assert.equal(live.sentinel, "keep");
  assert.ok(live.fs.a); assert.equal(closed, 0);
  rejectWrite = false;
  assert.equal(await staged.deleteItem("a"), true); assert.equal(closed, 1);
  assert.equal(live.fs.a, undefined); assert.equal(live.fs.b.name, "new concurrent text");
  assert.equal(live.taskbarPinnedApps.length, 0); assert.equal(written.taskbarPinnedApps.length, 0);
  const menu = read("app/js/core/context-menu-ui-utils.js");
  assert.doesNotMatch(menu, /Отменить последнее действие/);
  console.log("deletion smoke: ok");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
