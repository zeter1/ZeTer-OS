"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { console, URL, structuredClone, Blob, TextEncoder, TextDecoder, crypto: require("node:crypto").webcrypto, Uint8Array, atob, btoa }; sandbox.window = sandbox;
vm.createContext(sandbox);
const corePath = path.join(__dirname, "../app/js/core/prompt-library-utils.js");
assert.ok(fs.existsSync(corePath), "Prompts must have a production model");
vm.runInContext(fs.readFileSync(corePath, "utf8"), sandbox);
const lib = sandbox.ZETER_PROMPT_LIBRARY_UTILS;
for (const name of ["utils.js", "contacts-utils.js", "prompt-library-ui-utils.js", "shortcut-utils.js", "link-library-utils.js", "config.js", "storage-utils.js", "asset-utils.js", "security-protection-utils.js", "import-utils.js", "export-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name), "utf8"), sandbox);
}
sandbox.ZETER_DATA_NORMALIZERS = { TASK_TITLE_MAX_CHARS: 500, TASK_TAG_MAX_CHARS: 160, TASK_CHECKLIST_TEXT_MAX_CHARS: 500 };
sandbox.ZETER_RICH_TEXT_UTILS = { cleanRichHtml: value => value };
sandbox.ZETER_ITEM_CUSTOMIZATION_UTILS = { isItemAssetPath: () => false };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/state-import-validator.js"), "utf8"), sandbox);
async function main() {
  const a = { promptLibrary: lib.normalizePromptLibrary() }, b = { promptLibrary: lib.normalizePromptLibrary() };
  let id = 0, fail = false, unrelated = "old";
  const controller = workspace => lib.createPromptLibraryController({ getWorkspace: () => workspace, createId: prefix => `${prefix}_${++id}`,
    saveState: async () => { unrelated = "parallel"; if (fail) throw new Error("disk full"); return { saved: true }; } });
  const ca = controller(a), cb = controller(b);
  const project = await ca.addProject("Работа"), other = await ca.addProject("Учёба");
  const category = await ca.addCategory(project.id, "Код");
  await ca.addCategory(other.id, "Код");
  await assert.rejects(ca.addCategory(project.id, "код"), /уже/);
  const text = "  <script>alert(1)</script>\nТекст с пробелами  ";
  const entry = await ca.saveEntry({ name: "Проверка", text, projectId: project.id, categoryId: category.id });
  assert.equal(a.promptLibrary.entries[0].text, text, "prompt text must survive unchanged");
  await ca.toggleFavorite(entry.id);
  assert.equal(lib.filterPromptEntries(ca.library(), project.id, "favorites", "ПРОБЕЛАМИ").length, 1);
  assert.equal(lib.filterPromptEntries(ca.library(), other.id).length, 0);
  await cb.addProject("Работа");
  assert.equal(b.promptLibrary.entries.length, 0, "desktops have independent libraries");
  await assert.rejects(ca.saveEntry({ ...entry, projectId: other.id }, entry.id), /категор/i);
  await assert.rejects(ca.removeProject(project.id, "invalid"), /вариант/i, "unknown deletion choice cannot lose prompts");
  fail = true; const before = JSON.stringify(a.promptLibrary);
  await assert.rejects(ca.removeCategory(category.id), /disk full/);
  assert.equal(JSON.stringify(a.promptLibrary), before);
  assert.equal(unrelated, "parallel", "rollback affects only library");
  fail = false; await ca.removeCategory(category.id);
  assert.equal(a.promptLibrary.entries[0].text, text);
  assert.equal(a.promptLibrary.entries[0].categoryId, "");
  await ca.saveEntry({ ...entry, projectId: other.id, categoryId: "" }, entry.id);
  await ca.removeProject(project.id);
  lib.validatePromptLibrary(JSON.parse(JSON.stringify(a.promptLibrary)));
  const fullState = { fs: {}, settings: {}, currentDesktop: "desktop", desktops: [
    { id: "desktop", name: "Первый", data: a }, { id: "second", name: "Второй", data: b }
  ] };
  const validator = sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport;
  assert.equal(validator(fullState), fullState);
  assert.throws(() => validator({ ...fullState, desktops: [{ id: "desktop", name: "x", data: { promptLibrary: { ...a.promptLibrary, entries: [{ ...a.promptLibrary.entries[0], projectId: "missing" }] } } }] }), /проект/i);
  let backupEntries;
  const zip = await sandbox.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(fullState, { createZipBlob: async entries => { backupEntries = entries; return sandbox.ZETER_ASSET_UTILS.createZipBlob(entries); } });
  assert.equal(zip.zeterVerification.verified, true);
  const payload = JSON.parse(await backupEntries.find(item => item.path === "zeter-os-state.json").blob.text());
  assert.deepEqual(payload.state.desktops, JSON.parse(JSON.stringify(fullState.desktops)), "real ZIP retains each project hierarchy and exact body");
  validator(payload.state);
  const ui = sandbox.ZETER_PROMPT_LIBRARY_UI_UTILS;
  assert.ok(!ui.promptRowsHTML([{ ...entry, name: '<img onerror="x">' }]).includes("<img"));
  assert.ok(!ui.promptRowsHTML([entry]).includes("<script>"));
  assert.ok(!ui.promptEditorHTML({ ...entry, text: "</textarea><script>x</script>" }, a.promptLibrary, true).includes("<script>"));
  assert.throws(() => lib.validatePromptLibrary({ projects: [], categories: [], entries: [entry] }), /проект/i);
  await ca.removeEntry(entry.id); await ca.removeProject(other.id);
  assert.equal(a.promptLibrary.entries.length, 0);
  let reachable = a;
  const removedDesk = lib.createPromptLibraryController({ getWorkspace: () => reachable, createId: () => "removed_desk_project", saveState: async () => { throw new Error("save must not run"); } });
  const queued = removedDesk.addProject("Нельзя"); reachable = null;
  await assert.rejects(queued, /Рабочий стол недоступен/);
  assert.equal(a.promptLibrary.projects.length, 0, "deleted desktop must not fall back to another library");
  console.log("prompt library smoke: ok (hierarchy, exact text, CRUD, desktop isolation, rollback, validation)");
}
async function smokeProjectDeletion() {
  const fixture = () => ({ promptLibrary: { projects: [{ id: "p1", name: "Первый" }, { id: "p2", name: "Второй" }],
    categories: [{ id: "c1", projectId: "p1", name: "Код" }, { id: "c2", projectId: "p2", name: "Код" }], entries: [
      { id: "e1", name: "Сохранить", text: "\n\n  exact\r\nbody  ", projectId: "p1", categoryId: "c1", favorite: true },
      { id: "e2", name: "Другой", text: "keep", projectId: "p2", categoryId: "c2", favorite: false },
      { id: "free", name: "Общий", text: "free", projectId: "", categoryId: "", favorite: true }
    ] } });
  let sequence = 0, failure = false;
  const create = workspace => lib.createPromptLibraryController({ getWorkspace: () => workspace, createId: kind => `${kind}_${++sequence}`,
    saveState: async () => { workspace.marker = "independent"; return { saved: !failure }; } });
  const blank = { promptLibrary: lib.normalizePromptLibrary() }, blankController = create(blank);
  const free = await blankController.saveEntry({ name: "Без проекта", text: "  текст  ", projectId: "", categoryId: "" });
  assert.equal(lib.filterPromptEntries(blank.promptLibrary, "", "uncategorized")[0].id, free.id);
  lib.validatePromptLibrary(blank.promptLibrary);
  for (const mode of ["transfer", "delete"]) {
    const workspace = fixture(), controller = create(workspace), original = JSON.stringify(workspace.promptLibrary);
    const other = JSON.stringify(workspace.promptLibrary.entries[1]), general = JSON.stringify(workspace.promptLibrary.entries[2]);
    failure = true;
    await assert.rejects(controller.removeProject("p1", mode), /сохранение/i);
    assert.equal(JSON.stringify(workspace.promptLibrary), original, `${mode} refusal restores exact library`);
    assert.equal(workspace.marker, "independent");
    failure = false;
    // A second controller's new entry before confirmation must be handled with the entire current project.
    await create(workspace).saveEntry({ name: "Поздний", text: "new", projectId: "p1", categoryId: "c1" });
    await controller.removeProject("p1", mode);
    const result = workspace.promptLibrary;
    assert.equal(result.projects.some(item => item.id === "p1"), false);
    assert.equal(result.categories.some(item => item.id === "c1"), false);
    assert.equal(JSON.stringify(result.entries.find(item => item.id === "e2")), other);
    assert.equal(JSON.stringify(result.entries.find(item => item.id === "free")), general);
    if (mode === "transfer") {
      const entry = result.entries.find(item => item.id === "e1");
      assert.equal(entry.projectId, ""); assert.equal(entry.categoryId, ""); assert.equal(entry.favorite, true);
      assert.equal(entry.text, fixture().promptLibrary.entries[0].text);
      assert.equal(result.entries.filter(item => item.projectId === "").length, 3);
    } else assert.equal(result.entries.length, 2);
    lib.validatePromptLibrary(JSON.parse(JSON.stringify(result)));
    sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport({ fs: {}, settings: {}, desktops: [{ id: "desktop", name: "x", data: workspace }] });
  }
  const bad = fixture(); bad.promptLibrary.entries[2].categoryId = "c1";
  assert.throws(() => lib.validatePromptLibrary(bad.promptLibrary), /категория/i);
  console.log("prompt project deletion smoke: ok (no-project CRUD, transfer/delete, current entries, exact rollback, import)");
}
async function smokeAtomicPromptMutation() {
  const state = { promptLibrary: { projects: [{ id: "p", name: "Project" }], categories: [], entries: [
    { id: "e", projectId: "p", categoryId: "", name: "Keep", text: "\nexact  ", favorite: true }
  ] } };
  const original = JSON.stringify(state.promptLibrary);
  let entered, rejectFirst, persisted, writes = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const queue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true,
    writePrimaryRecord: async snapshot => {
      if (++writes === 1) { entered(); await new Promise((resolve, reject) => { rejectFirst = reject; }); }
      persisted = JSON.parse(JSON.stringify(snapshot)); return { updatedAt: 1 };
    } });
  const controller = lib.createPromptLibraryController({ getWorkspace: () => state, createId: () => "unused", saveState: () => queue.queue(),
    persistTransaction: operation => queue.transaction(operation), saveSnapshot: (write, candidate) => write({ ...state, promptLibrary: candidate }) });
  const rejected = controller.removeProject("p", "delete").catch(error => error); await started;
  assert.equal(JSON.stringify(state.promptLibrary), original, "live exports must see accepted library while candidate is pending");
  state.marker = "parallel";
  const parallelSave = queue.queue(); rejectFirst(new Error("synthetic first write failure"));
  assert.match((await rejected).message, /synthetic first write failure/); await parallelSave;
  assert.equal(JSON.stringify(state.promptLibrary), original);
  assert.equal(JSON.stringify(persisted.promptLibrary), original, "unrelated save must never persist a rejected deletion");
  assert.equal(persisted.marker, "parallel");
  console.log("prompt atomic save smoke: ok (rejected deletion + simultaneous save preserves live and persisted entries)");
}
smokeProjectDeletion().then(smokeAtomicPromptMutation).then(main).catch(error => { console.error(error); process.exitCode = 1; });
