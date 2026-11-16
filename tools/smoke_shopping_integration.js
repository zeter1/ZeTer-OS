"use strict";
// Hermetic VM / in-memory ZIP. No startup, native API, network or real data.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const plain = value => JSON.parse(JSON.stringify(value));
const box = { console, Blob, URL, TextDecoder, TextEncoder, atob, btoa, Uint8Array, structuredClone, crypto: require("node:crypto").webcrypto, setTimeout, clearTimeout,
  document: { createElement: () => ({ getContext: () => null, querySelector: () => null, querySelectorAll: () => [] }), querySelector: () => null, querySelectorAll: () => [] } };
box.window = box; vm.createContext(box);
for (const file of ["version.js", "config.js", "utils.js", "system-settings-utils.js", "shortcut-utils.js", "link-library-utils.js", "prompt-library-utils.js", "contacts-utils.js", "shopping-utils.js", "expenses-utils.js", "business-calculations-utils.js", "time-tracking-utils.js", "pinning-utils.js", "deletion-utils.js", "asset-utils.js", "security-protection-utils.js", "visual-utils.js", "item-customization-utils.js", "data-normalizers.js", "window-session-utils.js", "automation-utils.js", "object-link-utils.js", "workspace-utils.js", "storage-utils.js", "import-utils.js", "export-utils.js", "rich-text-utils.js", "state-import-validator.js", "security-restore-utils.js"]) {
  const filename = path.join(__dirname, "../app/js/core", file); vm.runInContext(fs.readFileSync(filename, "utf8"), box, { filename });
}
async function main() {
  const api = box.ZETER_SHOPPING_UTILS, work = box.ZETER_WORKSPACE_UTILS;
  const fixture = () => ({ fs: {}, settings: {}, currentDesktop: "second", desktops: [{ id: "desktop", name: "Основной", data: work.workspaceDefaults() }, { id: "second", name: "Второй", data: work.workspaceDefaults() }] });
  const state = fixture(), workspace = state.desktops[1].data;
  work.syncLegacyWorkspaceAliases(state); const sentinel = JSON.stringify(state.desktops[0]);
  const queue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
  let id = 0;
  const controller = api.createShoppingController({ getWorkspace: () => workspace, createId: prefix => `${prefix}_${++id}`, persistTransaction: operation => queue.transaction(operation),
    saveSnapshot: (write, shopping) => { const snapshot = plain(state); snapshot.desktops[1].data.shopping = shopping; return write(snapshot); } });
  const project = await controller.saveProject({ name: "Ремонт" });
  const category = await controller.saveCategory({ projectId: project.id, name: "Инструменты" });
  const item = await controller.saveItem({ projectId: project.id, categoryId: category.id, name: "Молоток", quantity: "1 шт", notes: "Для дома" });
  await controller.setBought(item.id, true);
  await controller.setPreferences({density:"compact",groupByCategory:false,showDescriptions:true}, controller.data().preferences);
  const shopping = plain(workspace.shopping), validate = box.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport;
  assert.equal(JSON.stringify(state.desktops[0]), sentinel); validate(state);
  const bad = plain(state); bad.desktops[1].data.shopping.items[0].categoryId = "missing";
  assert.throws(() => validate(bad), /категор/i);
  const old = fixture(); delete old.desktops[1].data.shopping; work.normalizeWorkspaceData(old.desktops[1].data); api.validateShopping(old.desktops[1].data.shopping);
  assert.equal(old.desktops[1].data.shopping.projects.length, 0);
  let zipEntries;
  const zip = await box.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(state, { createZipBlob: async entries => { zipEntries = entries; return box.ZETER_ASSET_UTILS.createZipBlob(entries); } });
  assert.equal(zip.zeterVerification.verified, true);
  const payload = JSON.parse(await zipEntries.find(row => row.path === "zeter-os-state.json").blob.text());
  assert.deepEqual(payload.state.desktops[1].data.shopping, shopping); validate(payload.state);
  assert.deepEqual(plain(work.desktopBackupSnapshot(state, "second").desktop.data.shopping), shopping);
  const recovery = box.ZETER_SECURITY_RESTORE_UTILS, key = recovery.listRestoreChoices(state).find(row => row.kind === "desktop" && row.desktopId === "second").key;
  const plan = recovery.prepareSelectiveRestore(fixture(), state, { key, mode: "copy", createId: prefix => `restored_${prefix}_${++id}` });
  const restored = plan.state.desktops.find(row => !["desktop", "second"].includes(row.id)).data.shopping;
  api.validateShopping(restored);
  assert.notEqual(restored.projects[0].id, project.id);
  assert.equal(restored.items[0].projectId, restored.projects[0].id);
  assert.equal(restored.categories[0].projectId, restored.projects[0].id);
  assert.equal(restored.items[0].categoryId, restored.categories[0].id);
  for (const selected of [[], ["shopping"]]) {
    const target = plain(state), before = JSON.stringify(target.desktops[0]);
    const saves = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => target, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
    const desktops = work.createVirtualDesktopController({ getState: () => target, requestDeletion: (model, execute) => { assert.ok(model.groups.some(row => row.id === "shopping" && row.count === 3)); return execute(selected); }, persistTransaction: operation => saves.transaction(operation), saveState: () => saves.queue() });
    await desktops.remove("second"); assert.equal(JSON.stringify(target.desktops[0]), before);
    if (selected.length) assert.equal(target.archivedDesktops[0]?.desktop.data.shopping, undefined);
    else {
      assert.deepEqual(plain(target.archivedDesktops[0].desktop.data.shopping), shopping); validate(target);
      target.archivedDesktops[0].desktop.data.shopping.items[0].projectId = "missing";
      assert.throws(() => validate(target), /проект/i);
    }
  }
  console.log("shopping integration smoke: PASS (defaults, ACK queue, isolated desktops, strict active/archive import, ZIP, project/category recovery remap, archive/selective deletion)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
