"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "app", "js", "core");
const sandbox = { console, Date, setTimeout, clearTimeout };
sandbox.window = sandbox;
sandbox.ZETER_CORE_UTILS = {
  escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[character]);
  }
};
vm.createContext(sandbox);

function load(name) {
  const file = path.join(CORE, name);
  vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

load("automation-utils.js");
load("automation-ui-utils.js");

const core = sandbox.ZETER_AUTOMATION_UTILS;
const ui = sandbox.ZETER_AUTOMATION_UI_UTILS;
assert.ok(core && ui, "Automation core and UI globals must load");

const shell = ui.automationShellHTML();
[
  "data-create-automation",
  "data-pause-all",
  "data-automation-search",
  "data-automation-status-filter",
  "data-automation-templates",
  "data-automation-list",
  "data-automation-preview-host",
  "data-automation-history",
  "data-history-filter",
  "data-clear-history"
].forEach(hook => assert.match(shell, new RegExp(hook), `${hook} hook is required`));
assert.match(shell, /<option value="active">Активные<\/option>/);
assert.match(shell, /<option value="broken">Нужно исправить<\/option>/);

const templateHtml = ui.templateCardsHTML(core.AUTOMATION_TEMPLATES);
assert.equal((templateHtml.match(/data-template-id=/g) || []).length, 5, "five template cards are required");
core.AUTOMATION_TEMPLATES.forEach(template => assert.match(templateHtml, new RegExp(template.id)));

const complex = core.normalizeAutomation({
  id: "complex_rule",
  name: "Разобрать PDF",
  type: "file_added",
  folderId: "inbox",
  conditionMode: "any",
  conditions: [
    { id: "c1", type: "file_extension", value: "pdf" },
    { id: "c2", type: "file_name_contains", value: "отчёт" }
  ],
  actions: [
    { id: "a1", type: "create_note", name: "{file.name}", content: "{automation.name}", parentId: "notes", onError: "continue" },
    { id: "a2", type: "link_objects", left: { mode: "previous_note" }, right: { mode: "trigger" }, onError: "stop" },
    { id: "a3", type: "move_file", targetFolderId: "archive", collisionPolicy: "replace", replaceAcknowledged: true, onError: "stop" }
  ]
});
const editor = ui.automationEditorHTML(complex, {
  fileOptions: [{ id: "report", label: "Отчёт.pdf — Входящие" }, { id: "report2", label: "<второй>.pdf — Входящие" }],
  sampleFileId: "report2",
  eventOptions: [{ id: "event_1", label: "Событие" }],
  folderOptions: [{ id: "inbox", label: "Входящие" }, { id: "notes", label: "Заметки" }, { id: "archive", label: "Архив" }]
});
assert.equal((editor.match(/data-automation-condition-row/g) || []).length, 2);
assert.equal((editor.match(/data-automation-action-row/g) || []).length, 3);
[
  "data-condition-mode",
  "data-add-condition",
  "data-add-action",
  "data-move-action-up",
  "data-move-action-down",
  "data-action-on-error",
  "data-action-collision",
  "data-action-replace-ack",
  "data-action-ref-mode",
  "data-preview-editor",
  "{file.name}",
  "{automation.name}"
].forEach(hook => assert.match(editor, new RegExp(hook.replace(/[{}]/g, "\\$&"))));
assert.match(editor, /value="any" selected/);
assert.match(editor, /value="replace" selected/);
assert.match(editor, /data-action-replace-ack checked/);
assert.match(editor, /data-automation-sample-file/);
assert.match(editor, /value="report2" selected/);
assert.match(editor, /&lt;второй&gt;\.pdf/);
assert.match(editor, /data-open-source-folder/);
assert.match(editor, /data-refresh-sample-files/);
const emptyFileEditor = ui.automationEditorHTML(complex);
assert.match(emptyFileEditor, /Нет файлов и заметок для проверки/);
assert.match(emptyFileEditor, /Содержимое подпапок не включено/);
assert.match(emptyFileEditor, /Проводника Windows/);
assert.match(emptyFileEditor, /Создать файл/);

const locations = [{ id: "desktop", isDesktop: true, label: "Рабочий стол «Личный»" }, { id: "articles", label: "Папка «Статьи»" }];
const nestedNote = { id: "note", type: "note", parentId: "articles", folderLabel: "Папка «Статьи»", label: "Заметка: <Статья> — Статьи" };
const noteEditor = ui.automationEditorHTML({ ...complex, folderId: "" }, { folderOptions: locations, fileOptions: [nestedNote], sampleFileId: "note" });
assert.match(noteEditor, /Рабочий стол «Личный»/);
assert.match(noteEditor, /data-open-sample-file>Открыть заметку/);
assert.match(noteEditor, /data-open-source-folder>Открыть папку объекта/);
assert.match(noteEditor, /Расположение выбранного объекта:<\/b> Папка «Статьи»/);
assert.match(noteEditor, /&lt;Статья&gt;/);
const desktopEditor = ui.automationEditorHTML({ ...complex, folderId: "desktop" }, { folderOptions: locations });
assert.match(desktopEditor, /Где искать:<\/b> Рабочий стол «Личный»/);
assert.match(desktopEditor, /data-open-source-folder>Открыть рабочий стол/);
assert.doesNotMatch(desktopEditor, /data-open-sample-file/);
assert.match(noteEditor, /Как пользоваться:/);
assert.match(noteEditor, /вместе с фигурными скобками/);
assert.match(noteEditor, /Добавлен файл \{file.name\}/);
assert.match(noteEditor, /Даже если выбранный файл — заметка/);
for (const [type, key] of [["file_added", "file.name"], ["event_created", "event.title"], ["task_completed", "task.title"], ["note_changed", "note.name"], ["weekly", "automation.name"]]) {
  const html = ui.automationEditorHTML({ ...complex, type });
  const currentVariables = html.split("Для выбранного триггера</h4>")[1].split("<details>")[0];
  assert.ok(currentVariables.includes(`{${key}}`), `${type} must explain ${key}`);
  if (type !== "file_added") assert.ok(!currentVariables.includes("{file.name}"));
}

assert.deepEqual(
  JSON.parse(JSON.stringify(ui.validateAutomationDraft({
    name: "Опасная замена",
    type: "file_added",
    actions: [{ type: "move_file", targetFolderId: "archive", collisionPolicy: "replace", replaceAcknowledged: false }]
  }))),
  { valid: false, selector: "[data-action-replace-ack]", message: "Подтвердите безопасную замену существующего объекта." }
);
assert.equal(ui.validateAutomationDraft({ name: "Готово", type: "startup", actions: [{ type: "notify" }] }).valid, true);
assert.equal(ui.validateAutomationDraft({ name: "Пусто", type: "startup", actions: [] }).valid, false);

const runtime = core.normalizeAutomationRuntime({
  history: [{
    id: "history_1",
    automationId: "complex_rule",
    automationName: "Разобрать PDF",
    status: "warning",
    message: "Часть действий выполнена",
    createdAt: 1000,
    actionResults: [
      { actionId: "a1", actionType: "create_note", status: "success", message: "Заметка создана" },
      { actionId: "a3", actionType: "move_file", status: "error", message: "Папка недоступна" }
    ]
  }]
});
const card = ui.automationCardHTML(complex, {
  runtime,
  previewAutomation: () => ({ valid: false, brokenReferences: ["Целевая папка не найдена: archive"] }),
  resolveLabel: (_kind, id) => id
});
assert.match(card, /Когда/);
assert.match(card, /Если/);
assert.match(card, /Тогда/);
assert.match(card, /data-run-automation/);
assert.match(card, /data-preview-automation/);
assert.match(card, /data-duplicate-automation/);
assert.match(card, /Целевая папка не найдена/);

const preview = ui.previewHTML({
  safe: true,
  valid: true,
  verdict: "Готово",
  sample: { kind: "fs", id: "file_1" },
  conditions: { results: [{ type: "file_extension", passed: true }] },
  actions: [{ type: "notify", rendered: [{ field: "title", text: "report.pdf" }] }],
  warnings: []
}, complex);
assert.match(preview, /data-run-preview="complex_rule"/);
assert.match(preview, /report\.pdf/);
assert.match(preview, /выполнено/);
assert.doesNotMatch(preview, /Пример объекта:<\/b> file_1/);
const namedPreview = ui.previewHTML({ safe: true, sample: { name: "<Отчёт>.pdf", folder: "Входящие" } }, complex, { isDraft: true });
assert.match(namedPreview, /&lt;Отчёт&gt;\.pdf/);
assert.match(namedPreview, /сначала сохрани правило/);
assert.doesNotMatch(namedPreview, /data-run-preview=/);
const missingSamplePreview = core.previewAutomation({ ...complex, folderId: "", actions: [{ type: "notify" }] }, { note: { id: "unrelated_note", name: "Чужой пример" } });
assert.equal(missingSamplePreview.missingSample, true);
assert.equal(missingSamplePreview.sample.id, "");
assert.equal(missingSamplePreview.sample.name, "");
assert.equal(missingSamplePreview.verdict, "Нужен файл для проверки");
const missingSampleCard = ui.automationCardHTML({ ...complex, enabled: true }, { previewAutomation: () => missingSamplePreview });
assert.match(missingSampleCard, /data-automation-status="active"/);

const history = ui.historyHTML(runtime, "warning");
assert.match(history, /Часть действий выполнена/);
assert.match(history, /Заметка создана/);
assert.match(history, /Папка недоступна/);
assert.doesNotMatch(ui.historyHTML(runtime, "success"), /Часть действий выполнена/);

const source = fs.readFileSync(path.join(CORE, "automation-ui-utils.js"), "utf8");
assert.match(source, /await operation\(\)/, "UI mutation lock must await the mutation");
assert.match(source, /if \(busy\) return false/, "concurrent UI mutations must be locked");
assert.match(source, /await Promise\.resolve\(saveState\(\)\)/, "fallback persistence must await acknowledgement");
assert.match(source, /setAutomations\(previous\)/, "fallback persistence must restore the prior automation list");
assert.match(source, /commitAutomations/, "app persistence adapter must be supported");
assert.match(source, /setGlobalPaused/, "persisted global pause adapter must be supported");
assert.match(source, /clearHistory/, "persisted history clear adapter must be supported");
assert.match(source, /runAutomation/, "manual run adapter must be supported");

async function verifyCategoryAndSampleEvents() {
  const nodes = new Map();
  const listeners = {};
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: "", value: "", textContent: "", hidden: false, disabled: false, querySelector: () => null, scrollIntoView() {} });
    return nodes.get(selector);
  };
  const fakeRoot = {
    innerHTML: "", className: "", classList: { add() {}, remove() {} },
    querySelector: node,
    querySelectorAll: selector => selector.split(", ").map(node),
    addEventListener: (name, handler) => { listeners[name] = handler; },
    setAttribute() {}, removeAttribute() {}
  };
  const target = (selector, properties = {}) => ({
    ...properties, dataset: properties.dataset || {},
    matches(query) { return query.split(/,\s*/).includes(selector); },
    closest(query) { return query === "[data-automation-editor]" && properties.editor ? properties.editor : this.matches(query) ? this : null; }
  });
  const click = (selector, properties) => listeners.click({ target: target(selector, properties) });
  const change = (selector, value) => listeners.change({ target: target(selector, { value }) });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const workspace = {
    automationCategories: [{ id: "screen", name: "Screen" }, { id: "other", name: "Other" }],
    automations: [{ id: "a", name: "Rule A", categoryId: "screen", type: "file_added", actions: [{ type: "notify" }] }, { id: "b", name: "Rule B", categoryId: "other", type: "startup" }],
    automationRuntime: { history: [{ id: "h1", automationId: "a", automationName: "Run A", status: "success" }, { id: "h2", automationId: "b", automationName: "Run B", status: "error" }] }
  };
  let failSave = false;
  let confirmation = false;
  let actualRuns = 0;
  let checks = 0;
  const openedEditors = [];
  ui.createAutomationApp({
    document: { createElement: () => fakeRoot },
    getAutomations: () => workspace.automations,
    getCategories: () => workspace.automationCategories,
    getRuntime: () => workspace.automationRuntime,
    uid: () => "new_category",
    openEditor: draft => openedEditors.push(draft),
    confirmUser: () => confirmation,
    mutateCategory: async command => {
      if (failSave) throw new Error("save refused");
      return core.changeAutomationCategory(workspace, command);
    },
    getFileOptions: () => [{ id: "sample", type: "note", label: "Sample note" }],
    getSampleContext: (_rule, selection) => ({ ...selection, file: selection.fileId === "sample" ? { id: "sample", name: "Sample note" } : null }),
    previewAutomation: (rule, context) => { checks += 1; return core.previewAutomation(rule, context); },
    runAutomation: async () => { actualRuns += 1; }
  });
  change("[data-category-filter]", "screen");
  click("[data-create-automation]");
  click("[data-edit-automation]", { dataset: { editAutomation: "a" } });
  click("[data-template-id]", { dataset: { templateId: core.AUTOMATION_TEMPLATES[0].id } });
  assert.equal(openedEditors.length, 3, "new, edit and template must open a separate editor");
  assert.equal(openedEditors[0].categoryId, "screen");
  assert.equal(openedEditors[1].id, "a");
  assert.equal(openedEditors[2].categoryId, "screen");
  assert.equal(node("[data-automation-editor-host]").innerHTML, "", "list must not embed the editor");
  assert.match(node("[data-automation-list]").innerHTML, /Rule A/);
  assert.doesNotMatch(node("[data-automation-list]").innerHTML, /Rule B/);
  assert.match(node("[data-automation-history]").innerHTML, /Run A/);
  assert.doesNotMatch(node("[data-automation-history]").innerHTML, /Run B/);
  node("[data-category-name]").value = "Screen renamed";
  click("[data-rename-category]");
  await settle();
  assert.equal(workspace.automationCategories[0].name, "Screen renamed");
  node("[data-category-name]").value = "New group";
  click("[data-create-category]");
  await settle();
  assert.equal(workspace.automationCategories[2].name, "New group");
  failSave = true;
  node("[data-category-name]").value = "Must not save";
  click("[data-rename-category]");
  await settle();
  assert.equal(workspace.automationCategories[0].name, "Screen renamed");
  assert.match(node("[data-automation-global-error]").textContent, /save refused/);
  failSave = false;
  // Saved-rule sample sequence exercises real registered event handlers, not just markup.
  click("[data-run-automation]", { dataset: { runAutomation: "a" } });
  change("[data-automation-sample-file]", "sample");
  assert.match(node("[data-automation-preview-host]").innerHTML, /value="sample" selected/);
  const dataBeforeCheck = JSON.stringify(workspace);
  click("[data-check-sample]");
  const report = node("[data-automation-preview-host]").innerHTML;
  assert.match(report, /Sample note/);
  assert.match(report, /Выбор файла очищен/);
  assert.doesNotMatch(report, /value="sample" selected/);
  assert.doesNotMatch(report, /data-run-preview=/);
  const afterCheckCount = checks;
  click("[data-check-sample]");
  assert.equal(checks, afterCheckCount, "second explicit check requires a new selection");
  click("[data-run-preview]", { dataset: { runPreview: "a" } });
  assert.equal(actualRuns, 0, "consumed sample must never be executed");
  assert.equal(JSON.stringify(workspace), dataBeforeCheck, "check must not change rules, files or run history");
  change("[data-automation-sample-file]", "sample");
  click("[data-check-sample]");
  assert.ok(checks > afterCheckCount, "reselection enables another check");
  const draftNodes = new Map();
  const draftNode = selector => {
    if (!draftNodes.has(selector)) draftNodes.set(selector, { value: "", innerHTML: "", textContent: "" });
    return draftNodes.get(selector);
  };
  draftNode("[data-automation-trigger]").value = "file_added";
  const actionRow = { dataset: { actionId: "notify" }, querySelector: selector => ({ value: selector === "[data-action-type]" ? "notify" : "" }) };
  const draftEditor = { dataset: { automationEditingId: "a" }, querySelector: draftNode, querySelectorAll: selector => selector === "[data-automation-action-row]" ? [actionRow] : [] };
  node("[data-automation-editor-host]").querySelector = () => draftEditor;
  listeners.change({ target: target("[data-automation-sample-file]", { value: "sample", editor: draftEditor }) });
  const beforeInvalidCheck = checks;
  click("[data-check-sample]", { editor: draftEditor });
  assert.equal(checks, beforeInvalidCheck, "local check must validate the draft just like the bottom check button");
  assert.match(draftNode("[data-automation-editor-error]").textContent, /название/);
  draftNode("[data-automation-name]").value = "Valid draft";
  click("[data-check-sample]", { editor: draftEditor });
  assert.match(node("[data-automation-preview-host]").innerHTML, /Выбор файла очищен/);
  assert.doesNotMatch(draftNode("[data-file-sample-host]").innerHTML, /value="sample" selected/);
  const validDraftChecks = checks;
  click("[data-check-sample]", { editor: draftEditor });
  assert.equal(checks, validDraftChecks);
  node("[data-automation-editor-host]").querySelector = () => null;
  click("[data-delete-category-rules]");
  await settle();
  assert.equal(workspace.automations.length, 2, "cancelled confirmation must preserve rules");
  confirmation = true;
  click("[data-delete-category-rules]");
  await settle();
  assert.equal(workspace.automations.length, 1);
  assert.equal(workspace.automations[0].id, "b");
  assert.equal(workspace.automationRuntime.history.length, 2);
  change("[data-category-filter]", "other");
  click("[data-delete-category]");
  await settle();
  assert.equal(workspace.automations.length, 1, "category-only deletion must keep rules");
  assert.equal(workspace.automations[0].categoryId, "");
}

async function verifySeparateEditor(uiUnderTest = ui) {
  const nodes = new Map();
  const listeners = {};
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: "", textContent: "", value: "", hidden: false, querySelector: () => null, scrollIntoView() {} });
    return nodes.get(selector);
  };
  const field = new Map();
  const fieldNode = selector => {
    if (!field.has(selector)) field.set(selector, { value: "", textContent: "", innerHTML: "", focus() {} });
    return field.get(selector);
  };
  let editorRevision = 0;
  let editorMarkup = "";
  Object.defineProperty(node("[data-automation-editor-host]"), "innerHTML", {
    get: () => editorMarkup,
    set: html => {
      editorMarkup = html;
      editorRevision++;
      // Replacing a DOM subtree destroys its inputs and their unsaved values.
      field.clear();
      fieldNode("[data-automation-name]").value = html.match(/data-automation-name value="([^"]*)"/)?.[1] || "";
      fieldNode("[data-automation-trigger]").value = "startup";
    }
  });
  const row = { dataset: { actionId: "notify" }, querySelector: fieldNode, querySelectorAll: () => [] };
  const editor = { dataset: { automationEditingId: "new" }, querySelector: fieldNode, querySelectorAll: s => s === "[data-automation-action-row]" ? [row] : [] };
  node("[data-automation-editor-host]").querySelector = () => editor;
  const root = { innerHTML: "", querySelector: node, querySelectorAll: () => [], classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, addEventListener: (name, callback) => { listeners[name] = callback; } };
  const click = selector => listeners.click({ target: { closest: s => s === selector ? { dataset: {} } : null } });
  let complete;
  let reject;
  let saves = 0;
  let closed = 0;
  let returned = 0;
  const integration = {
    document: { createElement: () => root }, editorOnly: true,
    initialDraft: { id: "new", name: "Initial", type: "startup" },
    saveDraft: () => { saves++; return new Promise((resolve, fail) => { complete = resolve; reject = fail; }); },
    onSaved: () => { returned++; }, closeEditor: () => { closed++; }
  };
  uiUnderTest.createAutomationApp(integration);
  assert.match(root.innerHTML, /automation-editor-window/);
  assert.doesNotMatch(root.innerHTML, /data-automation-list|data-automation-history|data-create-automation/);
  assert.match(node("[data-automation-editor-host]").innerHTML, /Initial/);
  fieldNode("[data-automation-name]").value = "My draft";
  const revisionBeforeSave = editorRevision;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  click("[data-save-automation]");
  assert.equal(saves, 1);
  assert.equal(returned, 0, "must await storage acknowledgement before closing/returning");
  assert.equal(node("[data-automation-editor-host]").inert, true);
  click("[data-save-automation]");
  assert.equal(saves, 1, "pending save must not submit twice");
  reject(new Error("disk unavailable"));
  await settle();
  assert.equal(returned, 0);
  assert.equal(closed, 0);
  assert.equal(editorRevision, revisionBeforeSave, "failed save must retain the editor DOM subtree");
  assert.equal(fieldNode("[data-automation-name]").value, "My draft");
  assert.match(node("[data-automation-global-error]").textContent, /disk unavailable/);
  assert.equal(node("[data-automation-editor-host]").inert, false);
  click("[data-save-automation]");
  complete(true);
  await settle();
  assert.equal(returned, 1, "successful save returns to main app");
  click("[data-cancel-automation]");
  assert.equal(closed, 1);
  assert.equal(saves, 2, "cancel must not save");
  uiUnderTest.createAutomationApp({ ...integration, initialError: "Автоматизация удалена" });
  assert.match(node("[data-automation-global-error]").textContent, /удалена/);
  assert.doesNotMatch(node("[data-automation-editor-host]").innerHTML, /data-save-automation/);
}

async function verifyEditorResetMutationIsCaught() {
  const marker = 'setError(error?.message || "Изменение не сохранено.';
  assert.ok(source.includes(marker));
  // Mutate only the in-memory module, never the repository: a redraw in the error
  // path must fail the same acceptance test that the real module passes.
  vm.runInContext(source.replace(marker, `drawEditor(); ${marker}`), sandbox);
  try {
    await assert.rejects(verifySeparateEditor(sandbox.ZETER_AUTOMATION_UI_UTILS), /failed save must retain the editor DOM subtree/);
  } finally {
    vm.runInContext(source, sandbox);
  }
}

verifyCategoryAndSampleEvents().then(() => verifySeparateEditor()).then(verifyEditorResetMutationIsCaught).then(() => console.log("automation v2 UI smoke: ok (categories, sample reset, separate editor save/cancel/error; reset mutation rejected)")).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
