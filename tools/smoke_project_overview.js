"use strict";
// Synthetic VM state only: no application startup, native API or browser profile.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const box = { console, Date, setTimeout, clearTimeout, structuredClone, URL, Blob, TextEncoder, TextDecoder, Uint8Array, atob, btoa, crypto: require("node:crypto").webcrypto };
box.window = box;
vm.createContext(box);
const core = path.join(__dirname, "../app/js/core");
for (const file of ["utils.js", "config.js", "time-tracking-utils.js", "project-overview-utils.js", "data-normalizers.js", "task-ui-utils.js", "task-app-ui-utils.js"]) {
  if (fs.existsSync(path.join(core, file))) vm.runInContext(fs.readFileSync(path.join(core, file), "utf8"), box, { filename: file });
}
const plain = value => JSON.parse(JSON.stringify(value));
async function main() {
  const model = box.ZETER_PROJECT_OVERVIEW_UTILS;
  assert.equal(typeof model?.buildProjectOverview, "function", "project overview must aggregate the selected project");
  const refs = [{ kind: "fs", id: "note" }, { kind: "event", id: "meeting" }];
  assert.deepEqual(plain(model.normalizeProjectAttachments([...refs, refs[0], { kind: "fs", id: "../bad" }, { kind: "other", id: "bad" }])), refs);
  const project = { id: "p", name: "Учёба", attachments: refs };
  box.ZETER_DATA_NORMALIZERS.normalizeTaskProject(project);
  assert.deepEqual(plain(project.attachments), refs, "normalization must preserve project references");
  const now = +new Date(2026, 9, 18, 12), monday = +new Date(2026, 9, 12), hour = 3600000;
  const entry = (id, projectId, start, end, extra = {}) => ({ id, projectId, segments: [{ start, end }], runningSince: null, ...extra });
  const workspace = { timeTracking: { entries: [entry("cross", "p", monday - hour, monday + hour), entry("old", "p", monday - 3 * hour, monday - 2 * hour), entry("other", "q", monday, monday + 9 * hour), entry("trash", "p", monday, monday + 9 * hour, { deletedAt: 0 })], active: { projectId: "p", segments: [], runningSince: now - hour } } };
  const tasks = [{ id: "late", projectId: "p", title: "Просрочено", status: "todo", due: "2026-10-17" }, { id: "done", projectId: "p", status: "done", due: "2026-10-16" }, { id: "today", projectId: "p", status: "doing", due: "2026-10-18" }, { id: "none", projectId: "p", status: "todo", due: "2020-01-01", indefinite: true }, { id: "foreign", projectId: "q", status: "done" }];
  const result = model.buildProjectOverview({ project, tasks, workspace, now });
  assert.deepEqual(plain({ total: result.total, done: result.done, overdue: result.overdue, progress: result.progress, nextDue: result.nextDue }), { total: 4, done: 1, overdue: 1, progress: 25, nextDue: "2026-10-17" });
  assert.equal(result.weekMs, 2 * hour, "week boundary clips crossing entries and includes active work");
  assert.equal(result.totalMs, 4 * hour, "deleted/foreign work must not enter totals");
  assert.equal(model.buildProjectOverview({ project, tasks, workspace, now, needsRecovery: true }).totalMs, 3 * hour, "unconfirmed time after restart must not inflate totals");
  assert.equal(model.buildProjectOverview({ project, tasks: [], workspace, now }).progress, 0);
  assert.equal(result.todayCount, 1);
  assert.equal(result.undatedCount, 1);
  assert.equal(result.weekDueCount, 1, "seven-day window includes today, excludes overdue/done/foreign tasks");
  assert.deepEqual(plain(result.stages).map(stage => [stage.id, stage.count]), [["todo", 2], ["doing", 1], ["review", 0], ["done", 1]]);
  assert.equal(result.weekDays.length, 7);
  assert.equal(result.weekDays.reduce((sum, day) => sum + day.ms, 0), result.weekMs, "day bars and weekly total use exactly the same intervals");
  assert.equal(result.weekDays[0].ms, hour, "Monday clips the entry crossing midnight");
  assert.equal(result.weekDays[6].ms, hour, "Sunday includes the active hour before now");
  assert.equal(model.buildProjectOverview({ project, tasks, workspace, now, needsRecovery: true }).weekDays[6].ms, 0);
  assert.equal(model.buildProjectOverview({ project, tasks, categoryId: "none", workspace, now }).weekMs, result.weekMs, "category filtering never narrows project time");
  const sevenDays = model.buildProjectOverview({ project, now, tasks: [{ id: "end", projectId: "p", due: "2026-10-24" }, { id: "outside", projectId: "p", due: "2026-10-25" }, { id: "invalid", projectId: "p", due: "2026-02-30" }] });
  assert.equal(sevenDays.weekDueCount, 1);
  assert.equal(sevenDays.undatedCount, 1);
  const ui = box.ZETER_TASK_UI_UTILS;
  const dated = { ...tasks[0], priority: "high", tag: "Учёба" };
  assert.equal(ui.taskMatchesBoardFilter(dated, { deadline: "overdue", today: "2026-10-18" }), true);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, status: "done" }, { deadline: "overdue", today: "2026-10-18" }), false);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, due: "2026-10-18" }, { deadline: "today", today: "2026-10-18" }), true);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, indefinite: true }, { deadline: "today", today: "2026-10-17" }), false);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, indefinite: true }, { deadline: "undated" }), true);
  assert.equal(ui.taskMatchesBoardFilter(dated, { deadline: "undated" }), false);
  const invalidDue = { ...dated, due: "2026-02-30" };
  assert.equal(ui.taskMatchesBoardFilter(invalidDue, { deadline: "undated", today: "2026-10-18" }), true, "invalid saved date is consistently treated as undated");
  assert.equal(ui.taskMatchesBoardFilter(invalidDue, { deadline: "overdue", today: "2026-10-18" }), false);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, status: "done", indefinite: true }, { deadline: "undated" }), false, "overview undated counter and destination both select open tasks");
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, due: "2026-10-24" }, { deadline: "week", today: "2026-10-18" }), true);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, due: "2026-10-25" }, { deadline: "week", today: "2026-10-18" }), false);
  assert.equal(ui.taskMatchesBoardFilter({ ...dated, due: "2026-10-17" }, { deadline: "week", today: "2026-10-18" }), false);
  assert.equal(typeof ui.taskBoardGroups, "function", "list grouping must omit empty statuses without removing board drop targets");
  const groupTasks = [{ id: "a", status: "todo", tag: "A" }, { id: "b", status: "todo", tag: "A" }, { id: "c", status: "done", tag: "B" }];
  assert.deepEqual(plain(ui.taskBoardGroups(groupTasks, {}, false)).map(group => [group.status, group.tasks.map(task => task.id)]), [["todo", ["a", "b"]], ["done", ["c"]]]);
  assert.equal(ui.taskBoardGroups([], {}, false).length, 0, "empty list gets only the common empty state");
  assert.equal(ui.taskBoardGroups(groupTasks, { q: "missing" }, false).length, 0, "no matches must not create empty groups");
  assert.deepEqual(plain(ui.taskBoardGroups([], {}, true)).map(group => group.status), ["todo", "doing", "review", "done"], "empty board retains every drop target");
  let refreshed = 0, opened = 0;
  const navWorkspace = { taskProjects: [{ id: "p", name: "Проект" }], tasks: [{ id: "t", title: "Задача", projectId: "p" }] };
  const nav = box.ZETER_TASK_APP_UI_UTILS.createTaskTargetNavigator({
    getCurrentDesktopId: () => "desktop", getWorkspace: () => navWorkspace,
    getWindows: () => new Map([["w", { winId: "w", appId: "tasks", desktopId: "desktop", params: { projectView: "overview" }, el: { classList: { remove() {} } } }]]),
    refreshWindow: () => { refreshed++; }, openApp: () => { opened++; }, scheduleLater: () => {}
  });
  nav.openTaskTarget({ taskId: "t" });
  assert.equal(opened, 0, "navigation must reuse a task window regardless of its selected view");
  assert.equal(refreshed, 1);
  vm.runInContext(fs.readFileSync(path.join(core, "window-session-utils.js"), "utf8"), box);
  const windowSessions = box.ZETER_WINDOW_SESSION_UTILS;
  const rendererParams = {}, record = { appId: "tasks", desktopId: "desktop", params: windowSessions.serializableParams(rendererParams), el: { classList: { contains: () => false }, style: {} } };
  const records = new Map([["taskwin", record]]);
  assert.equal(typeof box.ZETER_TASK_APP_UI_UTILS.setTaskWindowView, "function", "selected view must reach runtime sessions");
  box.ZETER_TASK_APP_UI_UTILS.setTaskWindowView(rendererParams, records, "taskwin", "list");
  assert.equal(windowSessions.collectWindowSessionsFromRuntime(records, "desktop")[0].params.projectView, "list");
  assert.equal(rendererParams.projectView, "list");
  const createNavigation = box.ZETER_TASK_APP_UI_UTILS.createTaskProjectNavigationController;
  assert.equal(typeof createNavigation, "function", "navigation must update the view without waiting for persistence");
  let navStore = { taskProjects: [{ id: "a" }, { id: "b" }, { id: "c" }], tasks: [], activeTaskProjectId: "a" };
  let gate = null, refuseNavigation = false, selected = "", navFailure = "";
  const writtenProjects = [];
  const navigationOptions = { getStore: () => navStore,
    persistTransaction: operation => Promise.resolve().then(() => operation(async projectId => {
      writtenProjects.push(projectId);
      if (gate) await new Promise(resolve => { gate.resolve = resolve; });
      return { saved: !refuseNavigation };
    })), saveSnapshot: (write, projectId) => write(projectId),
    onSelect: id => { selected = id; }, onError: error => { navFailure = error.message; } };
  const navigation = createNavigation(navigationOptions), otherNavigation = createNavigation(navigationOptions);
  gate = {}; const firstSwitch = navigation.select("b");
  assert.equal(selected, "b", "selection renders before the primary write starts");
  assert.equal(navStore.activeTaskProjectId, "b");
  while (!gate.resolve) await Promise.resolve();
  otherNavigation.select("a"); otherNavigation.select("c");
  assert.equal(selected, "c", "rapid project switches stay interactive while the first write is pending");
  gate.resolve(); gate = null; await firstSwitch;
  assert.deepEqual(writtenProjects, ["b", "c"], "only the newest pending project is saved after an in-flight write");
  const navAdapter = { item: navStore };
  const beforeNavigation = box.ZETER_TASK_APP_UI_UTILS.taskStoreSnapshot(navAdapter);
  refuseNavigation = true; await navigation.select("a");
  assert.equal(navStore.activeTaskProjectId, "a", "failed preference save does not roll back the displayed project");
  assert.match(navFailure, /сохран/i);
  box.ZETER_TASK_APP_UI_UTILS.restoreTaskStoreSnapshot(navAdapter, beforeNavigation);
  assert.equal(navStore.activeTaskProjectId, "a", "older task rollback must not erase a newer navigation choice");
  refuseNavigation = false; await navigation.select("a");
  assert.equal(writtenProjects.at(-1), "a", "an explicit repeated selection retries a refused preference save");
  const lockedStore = { taskProjects: [{ id: "p", name: "Первый" }, { id: "q", name: "Второй" }], tasks: [], activeTaskProjectId: "p" };
  let finishCreation, beginCreation, navWrites = 0;
  const creationStarted = new Promise(resolve => { beginCreation = resolve; });
  const creator = box.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({ getWorkspace: () => lockedStore,
    persistTransaction: operation => operation(async () => { beginCreation(); await new Promise(resolve => { finishCreation = resolve; }); return { saved: true }; }),
    saveSnapshot: write => write() });
  const creating = creator.createProject("Новый"); await creationStarted;
  const lockedNavigation = createNavigation({ getStore: () => lockedStore,
    persistTransaction: operation => operation(async () => { navWrites++; return { saved: true }; }), saveSnapshot: write => write() });
  const switching = lockedNavigation.select("q"); await Promise.resolve(); await Promise.resolve();
  assert.equal(lockedStore.activeTaskProjectId, "q"); assert.equal(navWrites, 0, "navigation must wait outside the primary barrier for staged task changes");
  finishCreation(); await creating; await switching;
  assert.equal(lockedStore.activeTaskProjectId, "q", "creation commit must preserve a newer project selection"); assert.equal(navWrites, 1);
  let staleStore = lockedStore, staleError = "", staleWrites = 0;
  const stale = createNavigation({ getStore: () => staleStore,
    persistTransaction: operation => { staleStore = null; return operation(async () => { staleWrites++; return { saved: true }; }); },
    saveSnapshot: write => write(), onError: error => { staleError = error.message; } });
  await stale.select("p"); assert.equal(staleWrites, 0); assert.match(staleError, /недоступ/i);
  for (const file of ["storage-utils.js", "asset-utils.js", "security-protection-utils.js", "import-utils.js"]) vm.runInContext(fs.readFileSync(path.join(core, file), "utf8"), box);
  // Real primary queue: navigation enters the barrier before a later project creation.
  const raceStore = { taskProjects: [{ id: "a", name: "A" }, { id: "b", name: "B" }], tasks: [], activeTaskProjectId: "a" };
  const raceWrites = []; let releasePrior, priorStarted;
  const priorReady = new Promise(resolve => { priorStarted = resolve; });
  const queue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => raceStore, writesAllowed: () => true,
    writePrimaryRecord: async snapshot => { if (!raceWrites.length) { priorStarted(); await new Promise(resolve => { releasePrior = resolve; }); } raceWrites.push(plain(snapshot)); return { updatedAt: Date.now() }; } });
  const prior = queue.queue(); await priorReady;
  const raceNavigation = createNavigation({ getStore: () => raceStore, persistTransaction: operation => queue.transaction(operation),
    saveSnapshot: (write, projectId) => write({ ...raceStore, activeTaskProjectId: projectId }) });
  const raceSwitch = raceNavigation.select("b");
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const raceCreator = box.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({ getWorkspace: () => raceStore,
    persistTransaction: operation => queue.transaction(operation), saveSnapshot: (write, candidate) => write(candidate) });
  const raceCreation = raceCreator.createProject("Created from time tracking");
  releasePrior(); await prior; const raceProject = await raceCreation; await raceSwitch;
  assert.equal(raceStore.activeTaskProjectId, raceProject.id);
  assert.equal(raceWrites.at(-1).activeTaskProjectId, raceStore.activeTaskProjectId, "deferred older navigation must not overwrite a later creation preference on disk");
  const laterStore = { taskProjects: [{ id: "a", name: "A" }, { id: "b", name: "B" }], tasks: [], activeTaskProjectId: "a" };
  const laterWrites = []; let releaseLaterPrior, laterPriorStarted;
  const laterReady = new Promise(resolve => { laterPriorStarted = resolve; });
  const laterQueue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => laterStore, writesAllowed: () => true,
    writePrimaryRecord: async snapshot => { if (!laterWrites.length) { laterPriorStarted(); await new Promise(resolve => { releaseLaterPrior = resolve; }); } laterWrites.push(plain(snapshot)); return { updatedAt: Date.now() }; } });
  const laterPrior = laterQueue.queue(); await laterReady;
  const laterCreator = box.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({ getWorkspace: () => laterStore,
    persistTransaction: operation => laterQueue.transaction(operation), saveSnapshot: (write, candidate) => write(candidate) });
  const laterCreation = laterCreator.createProject("Queued creation");
  const laterNavigation = createNavigation({ getStore: () => laterStore, persistTransaction: operation => laterQueue.transaction(operation), saveSnapshot: (write, projectId) => write({ ...laterStore, activeTaskProjectId: projectId }) });
  const laterSwitch = laterNavigation.select("b");
  releaseLaterPrior(); await laterPrior; await laterCreation; await laterSwitch;
  assert.equal(laterStore.activeTaskProjectId, "b", "a user selection after creation was requested must win even while creation waits for the barrier");
  assert.equal(laterWrites.at(-1).activeTaskProjectId, "b");
  box.ZETER_RICH_TEXT_UTILS = { cleanRichHtml: value => value };
  box.ZETER_ITEM_CUSTOMIZATION_UTILS = { isItemAssetPath: () => false };
  vm.runInContext(fs.readFileSync(path.join(core, "state-import-validator.js"), "utf8"), box);
  const validate = box.ZETER_STATE_IMPORT_VALIDATOR.validateImportedTaskStore;
  validate({ taskProjects: [plain(project)] }, "Проекты");
  const configured = { ...plain(project), description: "Цель", color: "green", defaultView: "list", sortBy: "due", defaultPriority: "high", hideCompleted: true };
  validate({ taskProjects: [configured] }, "Проекты");
  validate({ taskProjects: [{ ...configured, color: "#d92b74" }] }, "Проекты");
  for (const [key, bad] of [["color", "url(evil)"], ["defaultView", "evil"], ["sortBy", "evil"], ["defaultPriority", "evil"], ["hideCompleted", "false"], ["description", "x".repeat(2001)]]) {
    assert.throws(() => validate({ taskProjects: [{ ...configured, [key]: bad }] }, "Проекты"), undefined, `invalid ${key} must be rejected before import`);
  }
  assert.throws(() => validate({ taskProjects: [{ id: "p", name: "Тест", attachments: { kind: "fs", id: "note" } }] }, "Проекты"), /связ|массив/i);
  assert.throws(() => validate({ taskProjects: [{ id: "p", name: "Тест", attachments: [{ kind: "fs", id: "../note" }] }] }, "Проекты"), /id|небезопас|связ/i);
  assert.throws(() => validate({ taskProjects: [{ id: "p", name: "Тест", attachments: [{ kind: "unknown", id: "note" }] }] }, "Проекты"), /тип|связ/i);
  const create = box.ZETER_TASK_APP_UI_UTILS.createTaskProjectAttachmentController;
  assert.equal(typeof create, "function");
  let stored = { taskProjects: [{ id: "p", name: "Проект" }], tasks: [] }, fail = false, release;
  const options = { getStore: () => stored, resolveAttachment: ref => ref.id !== "missing",
    persistTransaction: operation => operation(async candidate => { if (release) await new Promise(resolve => { release.resolve = resolve; }); return { saved: !fail }; }),
    saveSnapshot: (write, projects) => write(projects) };
  const controller = create(options), second = create(options);
  fail = true;
  await assert.rejects(controller.add("p", refs[0]), /сохран/i);
  assert.equal(stored.taskProjects[0].attachments, undefined, "refused save must preserve live state");
  fail = false; release = {};
  const saving = controller.add("p", refs[0]);
  assert.equal(stored.taskProjects[0].attachments, undefined, "pending save must stay staged");
  await assert.rejects(second.add("p", refs[1]), /сохран/i, "second window must respect the shared task lock");
  release.resolve(); await saving; release = null;
  await controller.add("p", refs[1]);
  await assert.rejects(controller.add("p", refs[1]), /уже/i);
  await assert.rejects(controller.add("p", { kind: "fs", id: "missing" }), /недоступ|найден/i);
  assert.deepEqual(plain(stored.taskProjects[0].attachments), refs);
  await controller.remove("p", refs[0]);
  assert.deepEqual(plain(stored.taskProjects[0].attachments), [refs[1]]);
  assert.equal(stored.tasks.length, 0);
  stored.taskProjects = [];
  await assert.rejects(controller.add("p", refs[0]), /проект/i);
  console.log("project overview smoke: scoped tasks/time, week clipping, recovery, reference normalization, staged save/refusal/retry and shared lock PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
