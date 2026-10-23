"use strict";
// Hermetic VM + in-memory ZIP. No app startup, native API or real data access.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const plain = value => JSON.parse(JSON.stringify(value));
const box = { console, Blob, URL, TextDecoder, TextEncoder, atob, btoa, Uint8Array, structuredClone,
  crypto: require("node:crypto").webcrypto, setTimeout, clearTimeout,
  document: { createElement: () => ({ getContext: () => null, querySelector: () => null, querySelectorAll: () => [] }), querySelector: () => null, querySelectorAll: () => [] } };
box.window = box; vm.createContext(box);
for (const file of ["version.js", "config.js", "utils.js", "system-settings-utils.js", "shortcut-utils.js", "link-library-utils.js", "prompt-library-utils.js", "contacts-utils.js", "business-calculations-utils.js", "time-tracking-utils.js", "pinning-utils.js", "deletion-utils.js", "asset-utils.js", "security-protection-utils.js", "visual-utils.js", "item-customization-utils.js", "data-normalizers.js", "window-session-utils.js", "automation-utils.js", "object-link-utils.js", "workspace-utils.js", "storage-utils.js", "import-utils.js", "export-utils.js", "rich-text-utils.js", "state-import-validator.js", "security-restore-utils.js"]) {
  const filename = path.join(__dirname, "../app/js/core", file);
  vm.runInContext(fs.readFileSync(filename, "utf8"), box, { filename });
}
async function main() {
  const model = box.ZETER_CONTACTS_UTILS, work = box.ZETER_WORKSPACE_UTILS;
  const contacts = model.normalizeContacts({ projects: [{ id: "contactproject", name: "Работа" }], categories: [{ id: "contactcategory", projectId: "contactproject", name: "Партнёры" }],
    entries: [{ id: "contactperson", projectId: "contactproject", categoryId: "contactcategory", name: "Алёна Тестовая", company: "Тестовая компания", role: "Инженер", email: "test@example.invalid", phone: "+375 (29) 123-45-67", notes: "  Описание\r\nс пробелами  ", favorite: true,
      fields: [{ id: "fieldphone1", type: "phone", label: "Рабочий", value: "+375 (33) 765-43-21" }, { id: "fieldphone2", type: "phone", label: "Личный", value: "+375 25 111 22 33" }, { id: "fieldsocial", type: "social", label: "Профиль", value: "https://example.invalid/user" }, { id: "fieldnotes", type: "multiline", label: "Договорённости", value: "  Точный\r\nмногострочный текст  " }] }] });
  model.validateContacts(contacts);
  const fixture = () => ({ fs: {}, settings: {}, currentDesktop: "second", desktops: [
    { id: "desktop", name: "Основной", data: work.workspaceDefaults() },
    { id: "second", name: "Второй", data: work.workspaceDefaults({ contacts: plain(contacts) }) }
  ] });
  const state = fixture(); work.syncLegacyWorkspaceAliases(state);
  assert.deepEqual(plain(state.desktops[0].data.contacts), { projects: [], categories: [], entries: [] });
  assert.deepEqual(plain(state.desktops[1].data.contacts), plain(contacts));
  const validate = box.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport;
  validate(state);
  const bad = plain(state); bad.desktops[1].data.contacts.entries[0].categoryId = "missing";
  assert.throws(() => validate(bad), /категори/i);
  let zipEntries;
  const zip = await box.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(state, {
    createZipBlob: async entries => { zipEntries = entries; return box.ZETER_ASSET_UTILS.createZipBlob(entries); }
  });
  assert.equal(zip.zeterVerification.verified, true);
  const payload = JSON.parse(await zipEntries.find(row => row.path === "zeter-os-state.json").blob.text());
  assert.deepEqual(payload.state.desktops[1].data.contacts, plain(contacts));
  validate(payload.state);
  const desktopSnapshot = work.desktopBackupSnapshot(state, "second");
  assert.deepEqual(plain(desktopSnapshot.desktop.data.contacts), plain(contacts));
  const recovery = box.ZETER_SECURITY_RESTORE_UTILS;
  const key = recovery.listRestoreChoices(state).find(row => row.kind === "desktop" && row.desktopId === "second").key;
  let id = 0;
  const plan = recovery.prepareSelectiveRestore(fixture(), state, { key, mode: "copy", createId: kind => `recovered_${kind}_${++id}` });
  const restored = plan.state.desktops.find(row => row.id !== "desktop" && row.id !== "second").data.contacts;
  model.validateContacts(restored);
  assert.equal(restored.entries[0].notes, contacts.entries[0].notes);
  assert.equal(restored.entries[0].projectId, restored.projects[0].id);
  assert.equal(restored.entries[0].categoryId, restored.categories[0].id);
  assert.deepEqual(plain(restored.entries[0].fields.map(({ id, ...field }) => field)), plain(contacts.entries[0].fields.map(({ id, ...field }) => field)));
  assert.notEqual(restored.entries[0].fields[0].id, contacts.entries[0].fields[0].id);
  for (const selected of [[], ["contacts"]]) {
    const target = fixture(); work.syncLegacyWorkspaceAliases(target);
    const mainBefore = JSON.stringify(target.desktops[0]);
    const queue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => target, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
    const controller = work.createVirtualDesktopController({ getState: () => target,
      requestDeletion: (model, execute) => { assert.equal(model.groups.find(row => row.id === "contacts").count, 3); return execute(selected); },
      persistTransaction: operation => queue.transaction(operation), saveState: () => queue.queue() });
    await controller.remove("second");
    assert.equal(JSON.stringify(target.desktops[0]), mainBefore);
    if (selected.length) assert.equal(target.archivedDesktops?.[0]?.desktop.data.contacts, undefined);
    else {
      assert.deepEqual(plain(target.archivedDesktops[0].desktop.data.contacts), plain(contacts));
      validate({ fs: {}, settings: {}, desktops: target.desktops, archivedDesktops: target.archivedDesktops });
      const brokenArchive = plain(target); brokenArchive.archivedDesktops[0].desktop.data.contacts.entries[0].projectId = "missing";
      assert.throws(() => validate(brokenArchive), /проект/i);
    }
  }
  console.log("contacts integration smoke: ok (defaults, migration, ZIP round-trip, desktop snapshot, recovery remap, archive/selective deletion, import validation)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
