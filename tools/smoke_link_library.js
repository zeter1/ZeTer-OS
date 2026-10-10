"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { console, URL, structuredClone, Blob, TextEncoder, TextDecoder, crypto: require("node:crypto").webcrypto, Uint8Array, atob, btoa };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const name of ["utils.js", "shortcut-utils.js", "link-library-utils.js", "link-library-ui-utils.js", "config.js", "asset-utils.js", "security-protection-utils.js", "import-utils.js", "export-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name), "utf8"), sandbox);
}
const lib = sandbox.ZETER_LINK_LIBRARY_UTILS;
sandbox.ZETER_DATA_NORMALIZERS = { TASK_TITLE_MAX_CHARS: 500, TASK_TAG_MAX_CHARS: 160, TASK_CHECKLIST_TEXT_MAX_CHARS: 500 };
sandbox.ZETER_RICH_TEXT_UTILS = { cleanRichHtml: value => value };
sandbox.ZETER_ITEM_CUSTOMIZATION_UTILS = { isItemAssetPath: () => false };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/state-import-validator.js"), "utf8"), sandbox);
async function main() {
  const state = { library: lib.normalizeLinkLibrary(), unrelated: { text: "keep" } };
  let fail = false, writes = 0;
  const controller = lib.createLinkLibraryController({ getState: () => state, createId: kind => `${kind}_${++writes}`,
    saveState: async () => { state.unrelated.text = "parallel"; if (fail) throw new Error("disk full"); return { saved: true }; } });
  const category = await controller.addCategory("Работа");
  const second = await controller.addCategory("Учёба");
  await controller.moveCategory(second.id, -1);
  assert.equal(state.library.categories[0].id, second.id);
  await controller.toggleCategoryPinned(category.id);
  assert.equal(state.library.categories.find(item => item.id === category.id).pinned, true);
  assert.deepEqual(Array.from(lib.orderedLinkCategories(state.library), item => item.id), [category.id, second.id], "pinned categories appear first without changing manual order");
  await controller.moveCategory(second.id, -1);
  assert.deepEqual(Array.from(lib.orderedLinkCategories(state.library), item => item.id), [category.id, second.id], "movement cannot cross pinned and ordinary groups");
  fail = true;
  const pinnedBefore = JSON.stringify(state.library);
  await assert.rejects(controller.toggleCategoryPinned(category.id), /disk full/);
  assert.equal(JSON.stringify(state.library), pinnedBefore, "pinning rollback must preserve category order and flags");
  fail = false;
  lib.validateLinkLibrary(JSON.parse(pinnedBefore));
  assert.throws(() => lib.validateLinkLibrary({ entries: [], categories: [{ id: "pin_bad", name: "Bad", pinned: "true" }] }));
  await controller.toggleCategoryPinned(category.id);
  assert.deepEqual(Array.from(lib.orderedLinkCategories(state.library), item => item.id), [second.id, category.id]);
  const entry = await controller.saveEntry({ name: "Документы", target: "C:\\Users\\User\\a.txt", categoryId: category.id, description: "<script>" });
  assert.equal(entry.kind, "windows");
  await controller.togglePinned(entry.id);
  assert.equal(lib.isLinkPinned(state.library.entries[0], "all"), true);
  assert.equal(state.library.entries[0].favorite, false, "pinning must not enable favorites");
  await controller.togglePinned(entry.id, category.id);
  assert.equal(lib.isLinkPinned(state.library.entries[0], "favorites"), false, "category pin cannot affect another view");
  const listFixture = { categories: [{ id: "cat", name: "Category" }], entries: [
    { id: "plain_free", categoryId: "", favorite: true }, { id: "plain_cat", categoryId: "cat", favorite: true },
    { id: "pin_free", categoryId: "", favorite: true, pinnedIn: ["all", "uncategorized"] }, { id: "pin_cat", categoryId: "cat", favorite: true, pinnedIn: ["cat"] }
  ] };
  const listBefore = JSON.stringify(listFixture);
  for (const [filter, expected] of [["all", ["pin_free", "plain_free", "plain_cat", "pin_cat"]], ["favorites", ["plain_free", "plain_cat", "pin_free", "pin_cat"]], ["uncategorized", ["pin_free", "plain_free"]], ["cat", ["pin_cat", "plain_cat"]]]) {
    assert.deepEqual(Array.from(lib.filterLinkEntries(listFixture, filter), item => item.id), expected, `pinned-first ordering in ${filter}`);
  }
  assert.equal(JSON.stringify(listFixture), listBefore, "view sorting must not mutate saved insertion order");
  fail = true;
  const pinBefore = JSON.stringify(state.library);
  await assert.rejects(controller.togglePinned(entry.id), /disk full/);
  assert.equal(JSON.stringify(state.library), pinBefore, "failed pinning must restore flag");
  fail = false;
  await assert.rejects(controller.saveEntry({ name: "Дубль", target: "c:/users/user/a.txt" }), error => error.code === "DUPLICATE" && error.existingId === entry.id);
  await assert.rejects(controller.saveEntry({ name: "Опасно", target: "javascript:alert(1)" }));
  await controller.toggleFavorite(entry.id);
  await controller.togglePinned(entry.id, "favorites");
  await controller.toggleFavorite(entry.id);
  assert.equal(lib.isLinkPinned(state.library.entries[0], "favorites"), false, "removing favorite clears its own pin only");
  assert.equal(lib.isLinkPinned(state.library.entries[0], category.id), true);
  await controller.toggleFavorite(entry.id);
  assert.equal(lib.filterLinkEntries(state.library, "favorites", "SCRIPT").length, 1);
  await controller.renameCategory(category.id, "Проекты");
  fail = true;
  const before = JSON.stringify(state.library);
  await assert.rejects(controller.removeCategory(category.id), /disk full/);
  assert.equal(JSON.stringify(state.library), before, "rejected save must restore library");
  assert.equal(state.unrelated.text, "parallel", "rollback must preserve parallel unrelated state");
  fail = false;
  await controller.removeCategory(category.id);
  assert.equal(state.library.entries[0].categoryId, "", "category removal must retain entry");
  assert.equal(lib.isLinkPinned(state.library.entries[0], category.id), false, "deleted category pin must not transfer to uncategorized");
  assert.equal(lib.isLinkPinned(state.library.entries[0], "all"), true);
  await controller.saveEntry({ ...entry, name: "Изменено", categoryId: "" }, entry.id);
  assert.equal(state.library.entries[0].name, "Изменено");
  await controller.toggleCategoryPinned(second.id);
  const roundTrip = JSON.parse(JSON.stringify(state));
  lib.validateLinkLibrary(roundTrip.library);
  assert.equal(roundTrip.library.categories.find(item => item.id === second.id).pinned, true, "pin survives JSON round-trip");
  assert.equal(roundTrip.library.entries[0].target, entry.target);
  assert.equal(lib.isLinkPinned(roundTrip.library.entries[0], "all"), true, "entry pin survives saved edit and JSON round-trip");
  assert.equal(lib.normalizeLinkLibrary({ ...roundTrip.library, future: "keep" }).future, "keep");
  const fullState = { fs: {}, settings: {}, currentDesktop: "desktop", desktops: [
    { id: "desktop", name: "Первый", data: { library: roundTrip.library } },
    { id: "second", name: "Второй", data: { library: { categories: [], entries: [{ id: "second_backup", name: "Своя", target: "https://second-backup.example/", favorite: true }] } } }
  ] };
  assert.equal(sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport(fullState), fullState);
  assert.throws(() => sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport({ ...fullState, library: { entries: [{ ...entry, target: "javascript:alert(1)" }], categories: [] } }));
  let backupEntries;
  const zip = await sandbox.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(fullState, { createZipBlob: async entries => { backupEntries = entries; return sandbox.ZETER_ASSET_UTILS.createZipBlob(entries); } });
  assert.equal(zip.zeterVerification.verified, true, "real ZIP manifest/checksums must verify");
  const backupPayload = JSON.parse(await backupEntries.find(item => item.path === "zeter-os-state.json").blob.text());
  assert.deepEqual(backupPayload.state.desktops, fullState.desktops, "full backup payload must retain distinct desktop libraries");
  sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport(backupPayload.state);
  assert.throws(() => sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport({ ...fullState, desktops: [{ id: "desktop", name: "x", data: { library: { entries: "bad", categories: [] } } }] }));
  assert.throws(() => sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport({ ...fullState, legacyLinkLibrary: { categories: [], entries: [{ name: "Missing ID", target: "https://example.org" }] } }));
  const ui = sandbox.ZETER_LINK_LIBRARY_UI_UTILS;
  const rows = ui.linkRowsHTML([{ ...entry, name: '<img src=x onerror="alert(1)">', description: "<script>alert(1)</script>" }]);
  assert.ok(!rows.includes("<img") && !rows.includes("<script>"), "entry text must be escaped");
  assert.match(rows, /&lt;script&gt;/);
  assert.match(rows, /<button[^>]*class="link-library-target"[^>]*data-link-action="open"/, "displayed address must use the same explicit opening action");
  assert.ok(!rows.includes('href="C:'), "Windows targets must remain behind the native opening boundary");
  const form = ui.linkEditorHTML({ name: '\" onfocus=\"alert(1)', target: "https://example.org", description: "</textarea><script>x</script>" }, [{ id: "cat", name: "<img>" }], false);
  assert.ok(!form.includes("<script>") && !form.includes("<img>"));
  assert.match(form, /&quot; onfocus=&quot;/);
  for (const invalid of [{ entries: "bad", categories: [] }, { entries: [{ ...entry, target: "file:///x" }], categories: [] },
    { entries: [{ ...entry, favorite: "yes" }], categories: [{ id: category.id, name: "x" }] },
    { entries: [entry, entry], categories: [{ id: category.id, name: "x" }] }]) assert.throws(() => lib.validateLinkLibrary(invalid));
  await controller.removeEntry(entry.id);
  assert.equal(state.library.entries.length, 0);
  for (const id of [undefined, 5, "all", "favorites", "uncategorized"]) assert.throws(() => lib.validateLinkLibrary({ categories: [{ id, name: "x" }], entries: [] }));
  assert.throws(() => lib.validateLinkLibrary({ categories: [], entries: [{ name: "x", target: "https://example.org" }] }));
  let persisted;
  const notifyController = lib.createLinkLibraryController({ getState: () => state, createId: () => "saved_link", saveState: async () => { persisted = JSON.stringify(state.library); return { saved: true }; }, onChange: () => { throw new Error("render failure"); } });
  await assert.rejects(notifyController.saveEntry({ name: "Saved", target: "https://example.org" }), /render failure/);
  assert.equal(JSON.stringify(state.library), persisted, "notification failure cannot roll back persisted data");
  const desktops = [{ library: lib.normalizeLinkLibrary() }, { library: lib.normalizeLinkLibrary() }];
  let active = 0, pendingSave, rejectSave, enteredSave;
  const entered = new Promise(resolve => { enteredSave = resolve; });
  const scoped = lib.createLinkLibraryController({ getWorkspace: () => desktops[active], createId: kind => `${kind}_${++writes}`,
    saveState: () => { enteredSave(); return new Promise((resolve, reject) => { pendingSave = resolve; rejectSave = reject; }); } });
  const firstPending = scoped.saveEntry({ name: "Первый", target: "https://first.example" });
  active = 1; // switch before the controller's Promise queue executes
  await entered;
  assert.equal(desktops[0].library.entries.length, 1);
  assert.equal(desktops[1].library.entries.length, 0);
  pendingSave({ saved: true }); await firstPending;
  const firstBytes = JSON.stringify(desktops[0]);
  const pendingCategory = scoped.addCategory("Второй стол");
  active = 0;
  await new Promise(resolve => setImmediate(resolve));
  rejectSave(new Error("scoped disk full"));
  await assert.rejects(pendingCategory, /scoped disk full/);
  assert.equal(desktops[1].library.categories.length, 0, "rollback belongs to captured second desktop");
  assert.equal(JSON.stringify(desktops[0]), firstBytes, "second desktop rollback cannot affect first");
  active = 1;
  const retryCategory = scoped.addCategory("Второй стол"); await new Promise(resolve => setImmediate(resolve)); pendingSave({ saved: true });
  const ownCategory = await retryCategory;
  const ownEntry = scoped.saveEntry({ name: "Второй", target: "https://second.example", categoryId: ownCategory.id }); await new Promise(resolve => setImmediate(resolve)); pendingSave({ saved: true });
  const secondEntry = await ownEntry;
  for (const action of [() => scoped.toggleCategoryPinned(ownCategory.id), () => scoped.togglePinned(secondEntry.id), () => scoped.toggleFavorite(secondEntry.id), () => scoped.saveEntry({ name: "Другой", target: "https://second.example", categoryId: ownCategory.id }, secondEntry.id), () => scoped.removeCategory(ownCategory.id)]) {
    const pending = action(); await new Promise(resolve => setImmediate(resolve)); pendingSave({ saved: true }); await pending;
    assert.equal(JSON.stringify(desktops[0]), firstBytes, "second desktop CRUD/favorite/category must not affect first");
  }
  assert.equal(desktops[1].library.entries[0].favorite, true);
  assert.equal(desktops[1].library.entries[0].categoryId, "");
  console.log("link library smoke: ok (CRUD, categories, duplicates, filter, rejected save -> retry, round-trip)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
