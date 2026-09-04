"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const sourcePath = path.join(ROOT, "app", "js", "core", "automation-utils.js");
const appSourcePath = path.join(ROOT, "app", "js", "app.js");
const sandbox = { console, Date, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });

const utils = sandbox.ZETER_AUTOMATION_UTILS;
const plain = value => JSON.parse(JSON.stringify(value));

assert.ok(utils, "Automation utils must load");
assert.equal(utils.AUTOMATION_TEMPLATES.length, 5, "five editable templates are required");

const legacy = utils.normalizeAutomation({
  id: "legacy_rule",
  name: "Legacy",
  type: "weekly",
  weekday: 1,
  time: "09:00",
  condition: "always",
  action: { type: "notify", title: "Legacy title", text: "Legacy text" },
  lastRunKey: "legacy:key"
});
assert.equal(legacy.id, "legacy_rule");
assert.equal(legacy.action.title, "Legacy title");
assert.equal(legacy.actions.length, 1);
assert.equal(legacy.actions[0].title, "Legacy title");
assert.equal(legacy.lastRunKey, "legacy:key");

const variableRule = utils.normalizeAutomation({
  id: "variables",
  name: "Variables",
  type: "file_added",
  conditions: [
    { type: "file_extension", value: "pdf" },
    { type: "file_name_contains", value: "отчёт" }
  ],
  actions: [{ type: "notify", title: "{file.name}", text: "{unknown.value} / {automation.name}" }]
});
const rendered = utils.renderAutomationText(variableRule.actions[0].text, variableRule, { file: { name: "отчёт.pdf" } });
assert.equal(rendered.text, "{unknown.value} / Variables", "unknown variables must remain visible");
assert.deepEqual(plain(rendered.unknownVariables), ["unknown.value"]);
assert.equal(utils.renderAutomationText("{file.folder}", variableRule, { file: { name: "отчёт.pdf" }, fileFolderName: "Документы" }).text, "Документы");
assert.doesNotMatch(fs.readFileSync(sourcePath, "utf8"), /\beval\s*\(/);

const conditionContext = { file: { id: "report", name: "Годовой отчёт.PDF", extension: "pdf", parent: "desktop", size: 2048 } };
assert.equal(utils.evaluateAutomationConditions(variableRule, conditionContext).passed, true);
const dottedExtensionRule = utils.normalizeAutomation({
  ...variableRule,
  id: "automation_dotted_extension",
  conditions: [{ type: "file_extension", value: ".PDF" }]
});
assert.equal(utils.evaluateAutomationConditions(dottedExtensionRule, conditionContext).passed, true, "file extensions must accept a leading dot and mixed case");
const anyRule = utils.normalizeAutomation({
  ...variableRule,
  id: "any_rule",
  conditionMode: "any",
  conditions: [
    { type: "file_extension", value: "docx" },
    { type: "file_name_contains", value: "отчёт" }
  ]
});
assert.equal(utils.evaluateAutomationConditions(anyRule, conditionContext).passed, true, "OR mode must accept one matching condition");

const state = {
  fs: {
    baseline: { id: "baseline", type: "text", name: "old.txt", parent: "desktop" },
    notes: { id: "notes", type: "folder", name: "Заметки", parent: "desktop" },
    archive: { id: "archive", type: "folder", name: "Архив", parent: "desktop" }
  },
  desktops: [{ id: "desktop" }]
};
const workspace = {
  events: [],
  tasks: [],
  automations: [{
    id: "file_chain",
    name: "File chain",
    type: "file_added",
    folderId: "desktop",
    conditionMode: "all",
    conditions: [{ type: "file_extension", value: "pdf" }],
    actions: [
      { id: "make_note", type: "create_note", name: "{file.name}", content: "Imported from {file.folder}", parentId: "notes", onError: "stop" },
      { id: "move_file", type: "move_file", targetFolderId: "archive", collisionPolicy: "rename", onError: "stop" }
    ]
  }]
};

const beforePreview = JSON.stringify(workspace);
const preview = utils.previewAutomation(workspace.automations[0], { state, workspace, file: { id: "sample", name: "sample.pdf", extension: "pdf", parent: "desktop" } });
assert.equal(preview.valid, true);
assert.equal(preview.safe, true);
assert.equal(JSON.stringify(workspace), beforePreview, "preview must not mutate source state");

const unsafeReplace = utils.normalizeAutomation({
  id: "unsafe_replace",
  name: "Unsafe replace",
  type: "file_added",
  actions: [{ type: "move_file", targetFolderId: "archive", collisionPolicy: "replace", replaceAcknowledged: false }]
});
const unsafePreview = utils.previewAutomation(unsafeReplace, { state, workspace, file: { id: "sample", name: "sample.pdf", parent: "desktop" } });
assert.equal(unsafePreview.valid, false);
assert.equal(unsafePreview.verdict, "Опасное действие");

let createdNotes = 0;
const createdNoteContents = [];
let movedFiles = 0;
let failMoveOnce = true;
const controllerOptions = {
  getState: () => state,
  getWorkspace: () => workspace,
  now: () => new Date(2026, 8, 1, 10, 0, 0, 0).getTime(),
  resolveFileFolderName: file => file?.parent === "desktop" ? "Рабочий стол" : "",
  createNote: model => {
    createdNotes += 1;
    createdNoteContents.push(model.content);
    const id = `created_${createdNotes}`;
    state.fs[id] = { id, type: "note", name: model.name, content: model.content, parent: model.parentId };
    return { kind: "fs", id };
  },
  moveFile: () => {
    movedFiles += 1;
    if (failMoveOnce) {
      failMoveOnce = false;
      return false;
    }
    return true;
  }
};

async function verifyPersistentQueueAndRetry() {
  const firstController = utils.createAutomationRuntimeController(controllerOptions);
  assert.equal(firstController.collectDueRuns().length, 0, "first collection seeds baseline only");
  assert.equal(workspace.automationRuntime.baselineSeeded, true);

  state.fs.new_pdf = { id: "new_pdf", type: "managedFile", name: "new.pdf", extension: "pdf", parent: "desktop" };
  assert.equal(firstController.collectDueRuns().length, 1);
  assert.equal(workspace.automationRuntime.queue.length, 1, "queue must persist in workspace");

  const recreatedController = utils.createAutomationRuntimeController(controllerOptions);
  assert.equal(recreatedController.collectDueRuns().length, 1, "queue must survive controller recreation");
  await assert.rejects(() => recreatedController.executeDueRuns(), /Automation action rejected: file_chain/);
  assert.equal(createdNotes, 1);
  assert.deepEqual(createdNoteContents, ["Imported from Рабочий стол"]);
  assert.equal(movedFiles, 1);
  assert.deepEqual(plain(workspace.automationRuntime.checkpoints[0].completedActionIds), ["make_note"]);
  assert.equal(workspace.automationRuntime.queue[0].status, "retry");

  const retryController = utils.createAutomationRuntimeController(controllerOptions);
  await retryController.executeDueRuns();
  assert.equal(createdNotes, 1, "completed action must not repeat during retry");
  assert.equal(movedFiles, 2);
  assert.equal(workspace.automationRuntime.queue.length, 0);
  assert.equal(workspace.automationRuntime.checkpoints.length, 0);
  assert.equal(workspace.automations[0].lastRunKey, "file_added:new_pdf");
  assert.ok(workspace.automationRuntime.history.some(entry => entry.status === "warning"));
  assert.ok(workspace.automationRuntime.history.some(entry => entry.status === "success"));

  state.fs.paused_pdf = { id: "paused_pdf", type: "managedFile", name: "paused.pdf", extension: "pdf", parent: "desktop" };
  retryController.collectDueRuns();
  retryController.setGlobalPaused(true);
  assert.equal(await retryController.executeDueRuns(), 0, "global pause blocks automatic execution");
  assert.equal(workspace.automationRuntime.queue.length, 1, "paused queue must remain persisted");
  retryController.setGlobalPaused(false);
  await retryController.executeDueRuns();
  assert.equal(workspace.automationRuntime.queue.length, 0);
}

async function verifyDisabledQueuedRun() {
  for (const blockedBy of ["enabled", "pausedReason"]) {
    const pausedWorkspace = {
      tasks: [], events: [],
      automations: [{ id: "queued_startup", name: "Queued", type: "startup", actions: [{ type: "notify", title: "Queued", text: "" }] }]
    };
    let calls = 0;
    const controller = utils.createAutomationRuntimeController({
      getState: () => state, getWorkspace: () => pausedWorkspace,
      now: () => 1500, notify: () => { calls += 1; return true; }
    });
    controller.setGlobalPaused(true);
    controller.enqueueEvent({ type: "startup", startupKey: "paused_boot" });
    assert.equal(pausedWorkspace.automationRuntime.queue.length, 1);
    pausedWorkspace.automations[0][blockedBy] = blockedBy === "enabled" ? false : "retry_limit";
    controller.setGlobalPaused(false);
    assert.equal(await controller.executeDueRuns(), 0, "a disabled or paused queued rule must not execute");
    assert.equal(calls, 0);
    assert.equal(pausedWorkspace.automationRuntime.history.length, 0);
    assert.equal(pausedWorkspace.automationRuntime.queue.length, 1, "blocked work remains pending");
    await controller.manualRun("queued_startup", {});
    assert.equal(calls, 1, "explicit manual runs keep their existing semantics");
    pausedWorkspace.automations[0][blockedBy] = blockedBy === "enabled" ? true : "";
    assert.equal(await controller.executeDueRuns(), 1);
    assert.equal(calls, 2);
    assert.equal(pausedWorkspace.automationRuntime.queue.length, 0);
    assert.equal(await controller.executeDueRuns(), 0);
    assert.equal(calls, 2, "completed work must not repeat");
  }
}

async function verifyOrderedActionsAndManualHistory() {
  const manualWorkspace = {
    events: [],
    tasks: [],
    automations: [{
      id: "continue_rule",
      name: "Continue",
      type: "startup",
      actions: [
        { id: "bad_notify", type: "notify", title: "Bad", text: "", onError: "continue" },
        { id: "good_note", type: "create_note", name: "Good", content: "", parentId: "notes", onError: "stop" }
      ]
    }]
  };
  let noteAfterError = 0;
  const controller = utils.createAutomationRuntimeController({
    getState: () => state,
    getWorkspace: () => manualWorkspace,
    now: () => 1000,
    notify: () => { throw new Error("notify failed"); },
    createNote: () => { noteAfterError += 1; return { kind: "fs", id: "manual_note" }; }
  });
  const result = await controller.manualRun("continue_rule", {});
  assert.equal(result.status, "warning");
  assert.equal(noteAfterError, 1, "continue policy must run the next action");
  assert.equal(manualWorkspace.automationRuntime.history.length, 1);
  assert.equal(manualWorkspace.automationRuntime.history[0].actionResults.length, 2);
}

async function verifyLoopGuard() {
  const loopWorkspace = {
    events: [],
    tasks: [],
    automations: [{ id: "loop_rule", name: "Loop", type: "note_created", actions: [{ type: "notify", title: "Loop", text: "" }] }]
  };
  state.fs.loop_note = { id: "loop_note", type: "note", name: "Loop", parent: "notes" };
  const controller = utils.createAutomationRuntimeController({
    getState: () => state,
    getWorkspace: () => loopWorkspace,
    now: () => 2000,
    notify: () => true
  });
  controller.enqueueEvent({
    type: "note_created",
    noteId: "loop_note",
    eventKey: "loop_event",
    chainDepth: 1,
    chainAutomationIds: ["loop_rule"]
  });
  await controller.executeDueRuns();
  assert.equal(loopWorkspace.automations[0].pausedReason, "loop_guard");
  assert.equal(loopWorkspace.automationRuntime.history.at(-1).status, "error");
  assert.equal(loopWorkspace.automationRuntime.queue.length, 0);
}

async function verifyEventCreatedContext() {
  const eventWorkspace = {
    events: [{ id: "created_event", title: "Новая встреча", date: "2026-09-01" }],
    tasks: [],
    automations: [{
      id: "event_created_rule",
      name: "Event created",
      type: "event_created",
      actions: [{ type: "notify", title: "{event.title}", text: "{event.date}" }]
    }]
  };
  let notification = null;
  const controller = utils.createAutomationRuntimeController({
    getState: () => state,
    getWorkspace: () => eventWorkspace,
    now: () => 3000,
    notify: (title, text) => { notification = { title, text }; return true; }
  });
  controller.enqueueEvent({ type: "event_created", eventId: "created_event", eventKey: "created_event:1" });
  await controller.executeDueRuns();
  assert.deepEqual(notification, { title: "Новая встреча", text: "2026-09-01" });
}

async function verifyTaskListAndStartupContexts() {
  const taskState = {
    fs: {
      list: {
        id: "list",
        type: "tasklist",
        tasks: [{ id: "list_task", title: "Задача из списка", status: "done", projectId: "project_1" }]
      }
    },
    desktops: [{ id: "desktop" }]
  };
  const taskWorkspace = {
    events: [],
    tasks: [],
    automations: [
      { id: "task_rule", name: "Task", type: "task_completed", actions: [{ type: "notify", title: "{task.title}", text: "" }] },
      { id: "startup_rule", name: "Startup", type: "startup", actions: [{ type: "notify", title: "Startup", text: "" }] }
    ]
  };
  const titles = [];
  const controller = utils.createAutomationRuntimeController({
    getState: () => taskState,
    getWorkspace: () => taskWorkspace,
    now: () => 4000,
    notify: title => { titles.push(title); return true; }
  });
  controller.enqueueEvent({ type: "task_completed", task: taskState.fs.list.tasks[0], eventKey: "completed:1" });
  controller.enqueueEvent({ type: "startup", startupKey: "boot_1" });
  await controller.executeDueRuns();
  assert.deepEqual(titles, ["Задача из списка", "Startup"]);
}

async function verifySelectedFileAdapters() {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const fixture = {
    fs: {
      inbox: { id: "inbox", type: "folder", name: "Входящие", parent: "desktop", root: "desktop" },
      archive: { id: "archive", type: "folder", name: "Статьи", parent: "desktop", root: "desktop" },
      note: { id: "note", type: "note", name: "Статья", parent: "archive", root: "desktop" },
      desktop_file: { id: "desktop_file", type: "text", name: "На столе.txt", parent: "desktop", root: "desktop" },
      first: { id: "first", type: "text", name: "Первый.txt", parent: "inbox", root: "desktop" },
      second: { id: "second", type: "text", name: "Второй.txt", parent: "inbox", root: "desktop" },
      elsewhere: { id: "elsewhere", type: "text", name: "Другой.txt", parent: "archive", root: "desktop" },
      foreign: { id: "foreign", type: "text", parent: "inbox", root: "other" },
      app: { id: "app", type: "app", parent: "inbox", root: "desktop" },
      deleted: { id: "deleted", type: "text", deletedAt: 1, parent: "inbox", root: "desktop" }
    }
  };
  let root = "desktop";
  const rule = utils.normalizeAutomation({ id: "selected_rule", name: "Выбор", type: "file_added", folderId: "inbox", action: { type: "notify" } });
  const calls = [];
  const openedFolders = [];
  const openedItems = [];
  const messages = [];
  const adapter = {
    state: fixture,
    normalizeAutomations: utils.normalizeAutomations,
    currentWorkspace: () => ({ events: [], automations: [rule] }),
    getDesktopRoot: () => root,
    desktopName: () => "Личный",
    openApp: (appId, params) => openedFolders.push([appId, params.folderId]),
    openItem: id => openedItems.push(id),
    toast: (title, text) => messages.push([title, text]),
    workspaceItems: id => Object.values(fixture.fs).filter(item => item.root === id),
    automationTaskRecords: () => [],
    automationFileFolderName: file => file?.parent === "inbox" ? "Входящие" : "",
    deskAutomations: () => [rule],
    persistAutomationMutation: operation => Promise.resolve().then(operation),
    automationRuntimeController: {
      preview: utils.previewAutomation,
      manualRun: (_rule, context) => { calls.push(context.file.id); return context; }
    }
  };
  vm.createContext(adapter);
  for (const name of ["automationFolderOptions", "automationFileOptions", "automationSampleContext", "previewAutomationForUi", "runAutomationManually", "openAutomationSourceFolder", "openAutomationSampleFile"]) {
    const source = appSource.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"))?.[0];
    assert.ok(source, `missing app adapter ${name}`);
    vm.runInContext(source, adapter);
  }
  assert.deepEqual(plain(adapter.automationFileOptions(rule)).map(file => file.id), ["first", "second"]);
  assert.equal(adapter.automationFolderOptions()[0].label, "Рабочий стол «Личный»");
  assert.equal(adapter.automationFolderOptions()[0].isDesktop, true);
  const noteOption = adapter.automationFileOptions({}).find(file => file.id === "note");
  assert.equal(noteOption.type, "note");
  assert.equal(noteOption.folderLabel, "Папка «Статьи»");
  assert.match(noteOption.label, /Заметка: Статья/);
  assert.deepEqual(plain(adapter.automationFileOptions({ folderId: "desktop" })).map(file => file.id), ["desktop_file"], "desktop selection must not silently include nested files");
  adapter.openAutomationSourceFolder("", "note");
  adapter.openAutomationSampleFile("", "note");
  adapter.openAutomationSourceFolder("inbox", "second");
  adapter.openAutomationSourceFolder("", "");
  assert.deepEqual(openedFolders, [["folder", "archive"], ["folder", "inbox"], ["folder", "desktop"]]);
  assert.deepEqual(openedItems, ["note"]);
  adapter.openAutomationSourceFolder("inbox", "note");
  adapter.openAutomationSampleFile("", "foreign");
  adapter.openAutomationSampleFile("", "");
  adapter.openAutomationSourceFolder("missing", "");
  assert.equal(openedFolders.length, 3, "invalid folder/selection must not open the desktop as fallback");
  assert.deepEqual(openedItems, ["note"]);
  assert.equal(messages.length, 4);
  fixture.fs.note.deletedAt = 1;
  adapter.openAutomationSourceFolder("", "note");
  adapter.openAutomationSampleFile("", "note");
  assert.equal(openedFolders.length, 3);
  assert.deepEqual(openedItems, ["note"], "deleted samples must not open");
  const previewBefore = JSON.stringify(fixture);
  const result = adapter.previewAutomationForUi(rule, { fileId: "second" });
  assert.equal(result.sample.name, "Второй.txt");
  assert.equal(JSON.stringify(fixture), previewBefore, "preview and selection must not change state");
  assert.equal(adapter.automationSampleContext(rule, { fileId: "" }).file, null, "empty explicit selection must not fall back to first file");
  assert.equal(adapter.automationSampleContext(rule, { fileId: "foreign" }).file, null);
  assert.equal(adapter.automationSampleContext(rule, { fileId: "elsewhere" }).file, null);
  await adapter.runAutomationManually(rule.id, { fileId: "second" });
  assert.deepEqual(calls, ["second"], "manual run must use the selected file");
  const pending = adapter.runAutomationManually(rule.id, { fileId: "second" });
  fixture.fs.second.parent = "archive";
  await assert.rejects(pending, /Выбери файл/);
  delete fixture.fs.second;
  await assert.rejects(adapter.runAutomationManually(rule.id, { fileId: "second" }), /Выбери файл/);
  await assert.rejects(adapter.runAutomationManually(rule.id), /Выбери файл/);
  const switched = adapter.runAutomationManually(rule.id, { fileId: "first" });
  root = "other";
  await assert.rejects(switched, /Рабочий стол изменился/);
  assert.deepEqual(calls, ["second"], "invalid selection must never run another file");
}

async function verifyCategories() {
  let workspace = { automations: [], automationCategories: [], automationRuntime: {} };
  utils.changeAutomationCategory(workspace, { type: "create", id: "screen", name: "Разработка программы Записи экрана" });
  utils.changeAutomationCategory(workspace, { type: "create", id: "other", name: "Другое" });
  assert.throws(() => utils.changeAutomationCategory(workspace, { type: "create", id: "duplicate", name: "другое" }), /уже существует/);
  workspace.automations = utils.normalizeAutomations([
    { id: "a", name: "Правило A", type: "startup", categoryId: "screen" },
    { id: "b", name: "Правило B", type: "startup", categoryId: "other" },
    { id: "c", name: "Без группы", type: "startup" }
  ]);
  const notices = [];
  const controller = utils.createAutomationRuntimeController({ getState: () => ({ fs: {} }), getWorkspace: () => workspace, now: () => 12345, notify: title => { notices.push(title); return true; } });
  await controller.manualRun(workspace.automations[0], {});
  assert.equal(workspace.automationRuntime.history[0].categoryId, "screen");
  workspace = plain(workspace);
  workspace.automations = utils.normalizeAutomations(workspace.automations);
  workspace.automationCategories = utils.normalizeAutomationCategories(workspace.automationCategories);
  workspace.automationRuntime = utils.normalizeAutomationRuntime(workspace.automationRuntime);
  assert.equal(utils.automationCategoryScope(workspace, "screen").history.length, 1);
  assert.deepEqual(plain(utils.automationCategoryScope(workspace, "screen").automations).map(item => item.id), ["a"]);
  utils.changeAutomationCategory(workspace, { type: "rename", id: "screen", name: "Запись экрана" });
  assert.equal(workspace.automations[0].categoryId, "screen");
  workspace.automationRuntime.queue = [
    { id: "qa", automationId: "a", runKey: "a_run", triggerType: "startup" },
    { id: "qb", automationId: "b", runKey: "b_run", triggerType: "startup" }
  ];
  workspace.automationRuntime.checkpoints = [{ id: "ca", queueId: "qa" }, { id: "cb", queueId: "qb" }];
  const before = plain(workspace);
  utils.changeAutomationCategory(workspace, { type: "delete", id: "screen", deleteAutomations: true });
  assert.deepEqual(plain(workspace.automations).map(item => item.id), ["b", "c"]);
  assert.deepEqual(plain(workspace.automationRuntime.queue).map(item => item.id), ["qb"]);
  assert.deepEqual(plain(workspace.automationRuntime.checkpoints).map(item => item.id), ["cb"]);
  assert.equal(workspace.automationRuntime.history.length, 1, "category deletion must retain audit history");
  assert.equal(utils.automationCategoryScope(workspace, "").history.length, 1);
  workspace = plain(before);
  utils.changeAutomationCategory(workspace, { type: "delete", id: "screen", deleteAutomations: false });
  assert.equal(workspace.automations.length, 3);
  assert.equal(workspace.automations[0].categoryId, "");
  assert.equal(workspace.automationRuntime.queue.length, 2);
  assert.equal(utils.automationCategoryScope(workspace, "other").history.length, 0);
  // Exercise the real composition transaction with an injected storage failure.
  const tx = {
    state: plain(before), cloneForBackup: plain,
    ui: { windows: new Map([["automations_window", { appId: "automations" }]]) },
    currentView: { error: "" },
    renderAllFileSurfaces: () => {}, renderNotifications: () => {},
    refreshWindow: () => { tx.currentView = { error: "" }; },
    saveState: () => Promise.reject(new Error("storage unavailable"))
  };
  vm.createContext(tx);
  vm.runInContext("let automationMutationChain = Promise.resolve();", tx);
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  for (const name of ["refreshAutomationSurfaces", "queueAutomationMutation", "restoreAutomationExactSnapshot", "persistAutomationMutation"]) {
    vm.runInContext(appSource.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"))[0], tx);
  }
  const initiatingView = tx.currentView;
  await assert.rejects(tx.persistAutomationMutation(() => utils.changeAutomationCategory(tx.state, { type: "delete", id: "screen", deleteAutomations: true })).catch(error => { initiatingView.error = error.message; throw error; }), /storage unavailable/);
  assert.deepEqual(plain(tx.state), before, "failed deletion save must restore categories, rules, queue and history");
  assert.equal(tx.currentView.error, "storage unavailable", "rollback must keep the initiating UI attached so the save error is visible");
}

async function verifySeparateWindowAdapters() {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  let root = "desktop";
  let failSave = false;
  const refreshed = [];
  const navigation = [];
  const tx = {
    state: { automations: utils.normalizeAutomations([{ id: "edit", name: "Existing", type: "startup", lastRunKey: "latest-run" }, { id: "other", type: "startup" }]), automationCategories: [] },
    normalizeAutomations: utils.normalizeAutomations, normalizeAutomationCategories: utils.normalizeAutomationCategories,
    cloneForBackup: plain, getDesktopRoot: () => root,
    ui: { windows: new Map() },
    renderAllFileSurfaces() {}, renderNotifications() {},
    refreshWindow: id => refreshed.push(id),
    saveState: async () => { if (failSave) throw new Error("storage unavailable"); },
    closeWindow: id => { navigation.push(["close", id]); tx.ui.windows.delete(id); },
    openApp: (id, params) => navigation.push(["open", id, plain(params)]),
    focusWindow: id => navigation.push(["focus", id]), persistOpenWindowsForCurrentDesktop() {}
  };
  tx.currentWorkspace = () => tx.state;
  tx.deskAutomations = () => tx.state.automations;
  tx.setDeskAutomations = next => (tx.state.automations = utils.normalizeAutomations(next));
  vm.createContext(tx);
  vm.runInContext("let automationMutationChain = Promise.resolve();", tx);
  for (const name of ["refreshAutomationSurfaces", "queueAutomationMutation", "restoreAutomationExactSnapshot", "persistAutomationMutation", "commitAutomationDraft", "openAutomationEditor", "returnToAutomations"]) {
    vm.runInContext(appSource.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  }`, "m"))[0], tx);
  }
  const record = (appId, params = {}) => ({ winId: appId, appId, params, desktopId: root, el: { classList: { remove: () => {} } } });
  tx.ui.windows.set("automations", record("automations"));
  tx.ui.windows.set("automationedit", record("automationedit", { automationId: "edit" }));
  tx.openAutomationEditor(tx.state.automations[0]);
  assert.deepEqual(navigation.pop(), ["focus", "automationedit"], "existing editor is focused without replacing its draft");
  const saved = await tx.commitAutomationDraft({ id: "edit", name: "Changed", type: "startup" }, { workspaceId: root, editingId: "edit" });
  assert.equal(saved.name, "Changed");
  assert.equal(saved.lastRunKey, "latest-run", "editor must retain runtime updates made while it was open");
  assert.equal(tx.state.automations.length, 2);
  assert.deepEqual(refreshed, ["automations"], "runtime refresh must not replace editor contents");
  failSave = true;
  const before = plain(tx.state);
  await assert.rejects(tx.commitAutomationDraft({ id: "new", name: "New", type: "startup" }, { workspaceId: root }), /storage unavailable/);
  assert.deepEqual(plain(tx.state), before);
  failSave = false;
  await assert.rejects(tx.commitAutomationDraft({ id: "deleted", type: "startup" }, { workspaceId: root, editingId: "deleted" }), /уже удалена/);
  await assert.rejects(tx.commitAutomationDraft({ id: "new", type: "startup", categoryId: "deleted" }, { workspaceId: root }), /Категория удалена/);
  const delayed = tx.commitAutomationDraft({ id: "new", type: "startup" }, { workspaceId: root });
  root = "other-desktop";
  await assert.rejects(delayed, /Рабочий стол изменился/);
  root = "desktop";
  await tx.commitAutomationDraft({ id: "new", name: "New", type: "startup" }, { workspaceId: root });
  assert.equal(tx.state.automations.length, 3);
  await assert.rejects(tx.commitAutomationDraft({ id: "new", type: "startup" }, { workspaceId: root }), /уже сохранено/);
  tx.returnToAutomations("automationedit", "category");
  assert.deepEqual(navigation, [["close", "automationedit"], ["focus", "automations"]]);
  assert.equal(tx.ui.windows.get("automations").params.categoryId, "category");
  tx.ui.windows.clear();
  tx.returnToAutomations("editor", "");
  assert.deepEqual(navigation.at(-1), ["open", "automations", { categoryId: "" }], "closed main app is reopened after save");
}

Promise.resolve()
  .then(verifySeparateWindowAdapters)
  .then(verifyCategories)
  .then(verifySelectedFileAdapters)
  .then(verifyPersistentQueueAndRetry)
  .then(verifyDisabledQueuedRun)
  .then(verifyOrderedActionsAndManualHistory)
  .then(verifyLoopGuard)
  .then(verifyEventCreatedContext)
  .then(verifyTaskListAndStartupContexts)
  .then(() => {
    const bounded = utils.normalizeAutomationRuntime({
      queue: Array.from({ length: 700 }, (_, index) => ({ id: `q_${index}`, automationId: "rule", runKey: `run_${index}`, triggerType: "startup" })),
      history: Array.from({ length: 300 }, (_, index) => ({ id: `h_${index}`, status: "success" }))
    });
    assert.equal(bounded.queue.length, 500);
    assert.equal(bounded.history.length, 200);
    const appSource = fs.readFileSync(appSourcePath, "utf8");
    assert.match(appSource, /createFsItemRecord\(state\.fs, "note"/, "automation notes must be created without an inner save");
    assert.match(appSource, /function queueAutomationMutation\(/, "automation mutations must share one lock");
    assert.match(appSource, /function restoreAutomationSnapshot\(/, "automatic runs need persistence rollback");
    assert.match(appSource, /commitAutomations: commitAutomationList/, "UI mutations must use the acknowledged persistence adapter");
    assert.match(appSource, /linkObjects: \(left, right, meta = \{\}\)/, "action chains need the object-link adapter");
    assert.match(appSource, /saveState: saveStateWithTaskAutomation/, "task completion events must reach automations");
    assert.match(appSource, /saveState: saveStateWithNoteAutomation/, "note change events must reach automations");
    assert.match(appSource, /saveState: saveStateWithCalendarAutomation/, "created events must reach automations");
    assert.match(appSource, /type: "startup", startupKey: automationStartupKey/, "startup rules must be queued once per boot");
    assert.doesNotMatch(appSource, /automationRuntimeController\.resetFileAddedSeenIds\(/, "persisted file baselines must survive startup and desktop switching");
    assert.doesNotMatch(appSource, /bulkMoveItemsToFolder\(\[fileId\]/, "automation move actions must not invoke an inner save");
    console.log("automation v2 core smoke: ok");
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
