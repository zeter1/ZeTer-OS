"use strict";

// Hermetic source/VM fixtures. The small DOM double checks controller contracts;
// layout, native focus and browser event ordering require the separate UI smoke.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sandbox = { window: { ZETER_CORE_UTILS: { escapeHtml }, ZETER_TABLE_UTILS: {
  normalizeTableData: value => value, tablePlainText: () => ""
} } };
vm.createContext(sandbox);
for (const name of ["search-utils", "search-ui-utils"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name + ".js"), "utf8"), sandbox);
const ui = sandbox.window.ZETER_SEARCH_UI_UTILS;
const calls = [], saves = [];
let revision = 0, rejectSave = false, rejectAction = false, saveGate = null, saveStarted = null, actionError = null;
const workspace = { taskProjects: [], tasks: [], events: [] };
let state = { sentinel: "preserve", fs: {
  alpha: { id: "alpha", parent: "desktop", type: "note", name: "Alpha", content: "<script>unsafe()</script>", updatedAt: 1000 },
  other: { id: "other", parent: "second", type: "text", name: "Other needle", content: "foreign" }
} };
const root = {
  innerHTML: "", isConnected: true, listeners: {}, classList: { add() {} },
  status: { textContent: "" }, preview: { innerHTML: "" },
  contains: () => false, querySelectorAll: () => [],
  querySelector(selector) { return selector === ".search-status" ? this.status : selector === ".search-preview" ? this.preview : null; },
  addEventListener(name, callback) { this.listeners[name] = callback; },
  setAttribute() {}, removeAttribute() {}
};
const field = { value: "", focus() {} };
const document = { querySelector: selector => selector === "#global-search-results" ? root : selector === "#global-search-field" ? field : null };
const integration = {
  document, getState: () => state, getFs: () => state.fs,
  getCurrentDesktopId: () => "desktop", getWorkspace: () => workspace,
  getDesktopStores: () => [{ desktopId: "desktop", title: "Main", data: workspace }, { desktopId: "second", title: "Second", data: workspace }],
  getRevision: () => revision, isDesktopRoot: id => ["desktop", "second"].includes(id),
  saveState: async () => { saves.push(true); saveStarted?.(); if (saveGate) await saveGate; if (rejectSave) throw new Error("fixture refusal"); return { saved: true }; },
  runResultAction: async (result, action) => { calls.push({ id: result.id, title: result.title, action }); if (actionError) throw actionError; return !rejectAction; }
};
const controller = ui.createSearchController(integration);
const element = (result, query = "Alpha") => ({ dataset: { searchKind: result.kind, searchKey: result.key, id: result.id, desktopId: result.desktopId, query } });

(async () => {
  assert.equal(controller.search("Other").total, 0, "scope defaults to current desktop");
  const alpha = controller.results("Alpha")[0];
  assert.equal(alpha.id, "alpha");
  const normalized = controller.getStats().normalizationCount;
  for (const query of ["A", "Al", "Alp", "Alpha"]) controller.results(query);
  assert.equal(controller.getStats().normalizationCount, normalized, "typing reuses normalized index");
  assert.equal(controller.getStats().rebuildCount, 1);
  assert.equal(saves.length, 0, "typing never writes search history");
  controller.settings().scope = "all";
  assert.equal(controller.search("Other").total, 1);
  controller.setFilters(["tasks"], { save: false });
  assert.equal(controller.results("Alpha").length, 0);
  assert.equal(controller.results("Alpha", { ignoreFilters: true }).length, 1, "Start can ignore type filters");
  controller.setFilters(undefined, { save: false });

  // Project keys are desktop-scoped; an invisible old key must not hide a new desktop.
  let scopeDesktop = "desktop", scopeRevision = 0;
  const scopeState = { fs: {
    a: { id: "a", type: "note", parent: "desktop", name: "DeskAlpha", content: "" },
    b: { id: "b", type: "note", parent: "second", name: "DeskBeta", content: "" }
  } };
  const scopeStores = [{ desktopId: "desktop", title: "First", data: { taskProjects: [{ id: "p", name: "Project A" }], tasks: [] } },
    { desktopId: "second", title: "Second", data: { taskProjects: [{ id: "p", name: "Project B" }], tasks: [] } }];
  const scoped = ui.createSearchController({ ...integration, getState: () => scopeState, getFs: () => scopeState.fs,
    getDesktopStores: () => scopeStores, getCurrentDesktopId: () => scopeDesktop, getRevision: () => scopeRevision, saveState: async () => ({ saved: true }) });
  scoped.settings().projectId = scoped.results("Project A")[0].projectKey;
  scoped.settings().dateFrom = "2099-01-01";
  assert.equal(scoped.results("DeskAlpha", { ignoreFilters: true }).length, 1, "Start must ignore hidden project/date restrictions as well as types");
  scoped.settings().dateFrom = "";
  scopeDesktop = "second";
  assert.equal(scoped.results("DeskBeta").length, 1, "A stale project filter from another desktop must not hide all results");
  assert.equal(scoped.settings().projectId, "", "Unavailable project selection must be reconciled");
  scopeDesktop = "desktop";scopeRevision++;
  scoped.settings().projectId = scoped.results("Project A")[0].projectKey;
  scopeStores[0].data.taskProjects = [];scopeRevision++;
  assert.equal(scoped.results("DeskAlpha").length, 1, "Deleted project filters must be removed");

  controller.setFilters(["notes"], { save: false });
  let releaseFirst;
  const firstStarted = new Promise(resolve => { saveStarted = resolve; });
  saveGate = new Promise(resolve => { releaseFirst = resolve; }); rejectSave = true;
  const firstRejected = controller.setFilters(["tasks"]); await firstStarted;
  const secondRejected = controller.setFilters(["images"]);
  releaseFirst(); saveStarted = null;
  assert.equal(await firstRejected, false); assert.equal(await secondRejected, false);
  assert.deepEqual([...controller.activeFilters()], ["notes"], "Two refused edits must restore the confirmed filter, not the first pending draft");
  saveGate = null; rejectSave = false;
  assert.equal(await controller.setFilters(["tasks"]), true, "Explicit retry after refusal persists");
  assert.deepEqual([...controller.activeFilters()], ["tasks"]);
  controller.setFilters(undefined, { save: false });
  controller.renderGlobal("Alpha");
  assert.match(root.innerHTML, /Лучшее совпадение/);
  assert.equal((root.innerHTML.match(/data-search-kind="item"/g) || []).length, 1, "best match is rendered only once");
  assert.match(root.preview.innerHTML, /&lt;script&gt;/, "preview remains plain text");
  assert.doesNotMatch(root.preview.innerHTML, /<script>/);
  assert.match(root.preview.innerHTML, /data-search-action="copy"/);
  assert.equal(await controller.openSelected(root), true);
  assert.equal(state.searchSettings.history[0].query, "Alpha");
  assert.deepEqual(Object.keys(state.searchSettings.recent[0]).sort(), ["at", "key"], "recent stores references, not content");
  assert.equal(calls.length, 1);

  let refusePending;
  saveGate = new Promise((_resolve, reject) => { refusePending = reject; });
  // Attach immediately, so the deliberately pending rejection is fully owned.
  saveGate.catch(() => {});
  const pendingHistoryBefore = JSON.stringify(state.searchSettings.history);
  const pendingStarted = new Promise(resolve => { saveStarted = resolve; });
  const pendingOpen = controller.openResultElement(element(alpha, "pending history"));
  await pendingStarted;
  saveStarted = null;
  assert.equal(state.searchSettings.history[0].query, "pending history", "fixture reached optimistic mutation before ACK");
  controller.renderGlobal("Alpha");
  controller.search("Al");
  state.sentinel = "edited during pending save";
  refusePending(new Error("pending fixture refusal"));
  await pendingOpen;
  saveGate = null;
  assert.equal(JSON.stringify(state.searchSettings.history), pendingHistoryBefore, "pending save -> render/search -> rejection restores only owned history");
  assert.equal(state.sentinel, "edited during pending save");

  rejectSave = true;
  const oldHistory = JSON.stringify(state.searchSettings.history), oldRecent = JSON.stringify(state.searchSettings.recent);
  assert.equal(await controller.openResultElement(element(alpha, "failed query")), true, "opening remains successful when optional history save fails");
  assert.equal(JSON.stringify(state.searchSettings.history), oldHistory, "failed history save rolls back only history");
  assert.equal(JSON.stringify(state.searchSettings.recent), oldRecent);
  assert.match(root.status.textContent, /Не удалось сохранить/);
  assert.equal(state.sentinel, "edited during pending save");
  rejectSave = false;
  await controller.openResultElement(element(alpha, "retry query"));
  assert.equal(state.searchSettings.history[0].query, "retry query", "explicit retry persists after failed save");

  rejectAction = true;
  const saveCount = saves.length;
  assert.equal(await controller.openResultElement(element(alpha, "rejected open")), false);
  assert.equal(saves.length, saveCount, "rejected open is never added to history");
  rejectAction = false;
  actionError = new Error("Не удалось сохранить <fixture>.");
  assert.equal(await controller.openResultElement(element(alpha, "thrown action")), false);
  assert.match(root.status.textContent, /Не удалось сохранить <fixture>/, "action error is safely announced through textContent");
  assert.match(root.status.textContent, /Повторите попытку/);
  actionError = null;

  for (let i = 0; i < 15; i++) await controller.openResultElement(element(alpha, "query " + i));
  assert.equal(state.searchSettings.history.length, 12);
  assert.equal(state.searchSettings.history[0].query, "query 14");
  assert.equal(state.searchSettings.recent.length, 1, "repeat open does not duplicate recent references");
  await Promise.all([controller.openResultElement(element(alpha, "parallel one")), controller.openResultElement(element(alpha, "parallel two"))]);
  assert.equal(state.searchSettings.history[0].query, "parallel two");
  assert.equal(state.searchSettings.history[1].query, "parallel one", "serialized preference updates retain concurrent opens");

  // A queued reset must never replay its older filter draft over a newer choice.
  let releaseClear, enteredClear;
  const clearStarted = new Promise(resolve => { enteredClear = resolve; });
  saveGate = new Promise(resolve => { releaseClear = resolve; }); saveStarted = enteredClear;
  const click = attrs => ({ target: { closest: selector => Object.hasOwn(attrs, selector) ? attrs[selector] : null }, preventDefault() {} });
  const clearing = root.listeners.click(click({ "[data-search-clear]": { dataset: { searchClear: "history" } } }));
  await clearStarted;
  await root.listeners.click(click({ "[data-search-reset]": {} }));
  controller.setFilters(["tasks"]);
  releaseClear(); saveGate = null; saveStarted = null; await clearing;
  await controller.openResultElement(element(alpha, "flush preference queue"));
  assert.deepEqual([...state.searchSettings.filters], ["tasks"], "A delayed reset must preserve the newer type selection");
  controller.setFilters(undefined, { save: false });

  state.fs.alpha.name = "Renamed"; revision++;
  await controller.openResultElement(element(alpha));
  assert.equal(calls.at(-1).title, "Renamed", "open re-resolves accepted current record");
  const beforeDelete = calls.length;
  delete state.fs.alpha; revision++;
  assert.equal(await controller.openResultElement(element(alpha)), false);
  assert.equal(calls.length, beforeDelete, "deleted reference cannot perform an action");
  assert.equal(controller.results("Renamed").length, 0);
  const beforeInvalidate = controller.getStats().rebuildCount;
  controller.invalidate(); controller.results("Other");
  assert.equal(controller.getStats().rebuildCount, beforeInvalidate + 1);
  state = { ...state, sentinel: "replacement" };
  controller.results("Other");
  assert.equal(controller.getStats().rebuildCount, beforeInvalidate + 2, "state replacement invalidates even with same revision/fs");
  const fallback = ui.createSearchController({ ...integration, getRevision: undefined });
  fallback.results("Other"); fallback.results("Other");
  assert.equal(fallback.getStats().rebuildCount, 2, "without revision contract rebuild conservatively");

  controller.renderGlobal("");
  assert.match(root.innerHTML, /История запросов/);
  assert.doesNotMatch(root.innerHTML, /data-search-kind="app"/, "empty query avoids an app catalogue");

  const manyTasks = Array.from({ length: 601 }, (_unused, number) => ({
    id: "task-" + number, title: number === 600 ? "ZZZ distant recent" : "AAA task " + String(number).padStart(3, "0"),
    projectId: "p", status: "todo", updatedAt: new Date(2026, 9, 20, 12).getTime()
  }));
  const manyWorkspace = { tasks: manyTasks, taskProjects: [{ id: "p", name: "Project P" }, { id: "q", name: "Project Q" }], events: [] };
  const manyState = { fs: {}, searchSettings: {} };
  const manyController = ui.createSearchController({ ...integration, getState: () => manyState, getFs: () => manyState.fs,
    getDesktopStores: () => [{ desktopId: "desktop", title: "Main", data: manyWorkspace },
      { desktopId: "second", title: "Other", data: { tasks: [{ id: "foreign-recent", title: "Foreign recent", status: "todo" }], taskProjects: [], events: [] } }], getRevision: () => 0 });
  const distant = manyController.results("ZZZ distant recent")[0];
  assert.equal(distant.id, "task-600");
  assert.equal(manyController.search("", { limit: 500 }).results.some(item => item.key === distant.key), false, "fixture recent lies outside normal engine cap");
  manyController.settings().recent = [{ key: distant.key, at: Date.now() }];
  manyController.renderGlobal("");
  assert.match(root.innerHTML, /data-id="task-600"/, "saved recent beyond first 500 remains visible");
  assert.match(root.innerHTML, /data-search-kind="command"/, "commands use unrestricted normal query beside selected recents");
  manyController.settings().scope = "all";
  manyController.settings().projectId = distant.projectKey;
  manyController.settings().dateFrom = "2026-10-20";
  manyController.settings().dateTo = "2026-10-20";
  manyController.setFilters(["tasks"], { save: false });
  manyController.renderGlobal("");
  assert.match(root.innerHTML, /data-id="task-600"/, "recent key lookup preserves matching scope/type/project/date");
  for (const [fieldName, excluded, reset] of [["dateFrom", "2026-10-21", "2026-10-20"], ["projectId", '["desktop","tasks","","q"]', distant.projectKey]]) {
    manyController.settings()[fieldName] = excluded;
    manyController.renderGlobal("");
    assert.doesNotMatch(root.innerHTML, /data-id="task-600"/, fieldName + " still excludes a saved recent");
    manyController.settings()[fieldName] = reset;
  }
  manyController.setFilters(["notes"], { save: false }); manyController.renderGlobal("");
  assert.doesNotMatch(root.innerHTML, /data-id="task-600"/, "type filter still excludes recent task");
  manyController.setFilters(undefined, { save: false });
  Object.assign(manyController.settings(), { recent: [], projectId: "", dateFrom: "", dateTo: "" });
  manyController.renderGlobal("");
  assert.match(root.innerHTML, /data-search-kind="command"/, "empty recent selection must not remove useful commands");
  const foreignRecent = manyController.results("Foreign recent")[0];
  manyController.settings().recent = [{ key: foreignRecent.key, at: Date.now() }];
  manyController.settings().scope = "current"; manyController.renderGlobal("");
  assert.doesNotMatch(root.innerHTML, /data-id="foreign-recent"/, "current scope still excludes saved foreign recent");
  manyController.settings().scope = "all"; manyController.renderGlobal("");
  assert.match(root.innerHTML, /data-id="foreign-recent"/, "all scope reveals saved foreign recent");
  const legacySeven = ["files", "folders", "tasks", "calendar", "notes", "tables", "images"];
  manyController.setFilters(legacySeven, { save: false });
  assert.deepEqual(Array.from(manyController.activeFilters()), legacySeven, "runtime seven-filter selection never silently enables new four");
  for (const [number, expected] of [[1, "1 результат"], [5, "5 результатов"], [11, "11 результатов"], [21, "21 результат"], [32, "32 результата"]]) {
    assert.equal(ui.searchResultCountLabel(number), expected);
  }
  let extended = "";
  const navigator = ui.createSearchResultNavigator({ openExtendedResult: value => { extended = value.dataset.searchKind; } });
  let navigationDesktop = "desktop", delayedCallback;
  const delayedItem = { id: "delayed-note", type: "note", parent: "second" }, delayedOpens = [];
  const delayedNavigator = ui.createSearchResultNavigator({ getCurrentDesktopId: () => navigationDesktop,
    desktopExists: id => ["desktop", "second"].includes(id), switchDesktop: id => { navigationDesktop = id; },
    schedule: callback => { delayedCallback = callback; }, getItem: () => delayedItem,
    validateResult: () => { if (delayedItem.deletedAt || delayedItem.parent === "trash") throw new Error("Материал удалён."); },
    openApp: (...args) => { delayedOpens.push(args); return true; }, getCalendarEvent: () => ({date:"2026-10-22"}), setCalendarEventDate() {} });
  const delayedElement = kind => ({ dataset: { searchKind: kind, id: "delayed-note", desktopId: "second" } });
  const movedOpen = delayedNavigator.openResult(delayedElement("calendar"));
  assert.equal(typeof movedOpen?.then, "function", "Delayed navigation must resolve after its callback, not report immediate success");
  navigationDesktop = "desktop"; delayedCallback();
  await assert.rejects(movedOpen, /стол|отмен/); assert.equal(delayedOpens.length, 0);
  const deletedOpen = delayedNavigator.openResult(delayedElement("item"));
  delayedItem.deletedAt = 1; delayedItem.parent = "trash"; delayedCallback();
  await assert.rejects(deletedOpen, /удал/); assert.equal(delayedOpens.length, 0);
  navigator.openResult({ dataset: { searchKind: "prompt", id: "p" } });
  assert.equal(extended, "prompt");

  const focusCalls = [];
  const viewport = { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, bottom: 100 }) };
  const row = { focus: options => focusCalls.push(options), closest: selector => selector === ".search-result-list" ? viewport : null,
    getBoundingClientRect: () => ({ top: 120, bottom: 140 }),
    scrollIntoView: () => { throw new Error("search must never scroll desktop ancestors"); } };
  const keys = {};
  const overlayInput = { value: "Alpha", focus: options => focusCalls.push(options), setSelectionRange() {}, addEventListener() {} };
  const overlayBox = { dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener: (name, fn) => { keys[name] = fn; } };
  const overlayResults = { querySelectorAll: () => [row] };
  const overlayDocument = { addEventListener() {}, querySelector: selector => ({ "#global-search": overlayBox, "#global-search-field": overlayInput, "#global-search-results": overlayResults })[selector] || null };
  const overlay = ui.createGlobalSearchOverlayController({ document: overlayDocument, schedule: callback => callback() });
  overlay.bind();
  keys.keydown({ key: "ArrowDown", target: overlayInput, preventDefault() {} });
  assert.equal(viewport.scrollTop, 40, "arrow navigation scrolls only owning results viewport");
  overlay.open("Alpha");
  assert.equal(focusCalls.length, 2);
  assert.ok(focusCalls.every(options => options.preventScroll === true), "keyboard and delayed input focus prohibit ancestor scrolling");
  console.log("search controller smoke: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
