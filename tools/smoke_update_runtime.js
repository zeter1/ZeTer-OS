"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { window: { ZETER_CORE_UTILS: { escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])) } } };
vm.createContext(sandbox);
for (const file of ["update-ui-utils.js", "notification-utils.js", "notification-ui-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", file), "utf8"), sandbox);
}
const updates = sandbox.window.ZETER_UPDATE_UI_UTILS;
const notifications = sandbox.window.ZETER_NOTIFICATION_UTILS;
const notificationUI = sandbox.window.ZETER_NOTIFICATION_UI_UTILS;
const available = { supported: true, phase: "available", available: true, currentVersion: "4.0.11", version: "4.0.12", message: "Доступна новая версия" };

function fixture(extra = {}) {
  const calls = [], timers = new Map(), children = [], handlers = {};
  const anchor = { title: "", classList: { toggle() {} }, getBoundingClientRect: () => ({ right: 900, bottom: 60 }) };
  const panel = { innerHTML: "" };
  const doc = {
    querySelectorAll: selector => selector === "[data-update-panel]" ? [panel] : [],
    querySelector: selector => selector === '[data-top-action="about"]' ? anchor : null,
    addEventListener(name, callback) { handlers[name] = callback; }, removeEventListener() {},
    body: { appendChild: node => children.push(node) },
    createElement() {
      const content = { innerHTML: "" }, later = { disabled: false };
      const node = { style: {}, innerHTML: "", setAttribute() {}, querySelector: selector => selector === "[data-update-later]" ? later : content,
        remove() { children.splice(children.indexOf(node), 1); } };
      return node;
    }
  };
  const controller = updates.createUpdateController({
    documentRef: doc, windowRef: { innerWidth: 1000, addEventListener() {}, removeEventListener() {} }, native: true,
    setTimer: (callback, delay) => { const id = timers.size + 1; timers.set(id, { callback, delay }); return id; }, clearTimer: id => timers.delete(id),
    callNative: async method => {
      calls.push(method);
      if (method === "check_app_updates") return available;
      if (method === "get_app_update_status") return { supported: true, phase: "idle", available: false };
      if (method === "prepare_app_update") return { ...available, phase: "ready" };
      if (method === "install_app_update") return { ...available, phase: "awaiting_exit" };
      return { supported: true, phase: "idle", available: false };
    },
    notifyAvailable: async () => calls.push("notify"), saveBeforeInstall: async () => calls.push("saved"), setLocked: locked => calls.push(locked ? "locked" : "unlocked"),
    openExternalLink: async url => calls.push(`external:${url}`), openManualUpdate: () => calls.push("manual-window"), ...extra
  });
  return { controller, calls, timers, children, panel, anchor, handlers };
}

async function main() {
  const manualHTML = updates.manualUpdateHTML();
  for (const [key, href] of [["repository", "https://github.com/zeter1/ZeTer-OS"], ["releases", "https://github.com/zeter1/ZeTer-OS/releases"]]) {
    assert.ok(manualHTML.includes(`<a href="${href}" target="_blank" rel="noopener noreferrer" data-manual-update-link="${key}">`), "manual guide footer must contain real external links");
  }
  const manualHandlers = {}, manualCalls = [], textNode = {};
  let selectedText = "  Выделенный текст\nсо второй строкой  ", copyResult = true;
  const selection = { isCollapsed: false, anchorNode: textNode, focusNode: textNode,
    toString: () => selectedText, getRangeAt: () => ({ getClientRects: () => [{ left: 10, right: 100, top: 10, bottom: 30 }] }) };
  const manualRoot = { contains: node => node === textNode || node?.inside === true,
    addEventListener: (name, handler) => { manualHandlers[name] = handler; } };
  updates.manualUpdateElement({ documentRef: { createElement: () => manualRoot }, getSelection: () => selection,
    showContext: (x, y, entries) => manualCalls.push({ x, y, entries }), copyText: async text => { manualCalls.push(text); return copyResult; },
    toast: title => manualCalls.push(title), openExternalLink: href => manualCalls.push(href) });
  const target = { closest: () => null };
  const mouse = (extra = {}) => ({ target, button: 0, clientX: 20, clientY: 20, prevented: false,
    preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra });
  const press = mouse();
  manualHandlers.pointerdown(press);
  assert.equal(press.prevented, true, "left press inside selection must preserve it");
  manualHandlers.click(mouse());
  assert.equal(manualCalls[0].entries[0][1], "Копировать");
  selectedText = "";
  await manualCalls[0].entries[0][2]();
  assert.equal(manualCalls[1], "  Выделенный текст\nсо второй строкой  ", "menu must copy captured text including whitespace");
  assert.equal(manualCalls[2], "Текст скопирован");
  selectedText = "Повторное выделение";
  manualCalls.length = 0;
  manualHandlers.contextmenu(mouse({ button: 2 }));
  copyResult = false;
  await manualCalls[0].entries[0][2]();
  assert.equal(manualCalls[2], "Не удалось скопировать");
  manualCalls.length = 0;
  const outside = mouse({ clientX: 150 });
  manualHandlers.pointerdown(outside);
  manualHandlers.click(outside);
  assert.equal(outside.prevented, false, "click outside selection must allow a new selection");
  assert.equal(manualCalls.length, 0);
  selection.focusNode = {};
  manualHandlers.contextmenu(mouse({ button: 2 }));
  assert.equal(manualCalls.length, 0, "selection crossing another app must not be copied");
  const link = { inside: true, dataset: { manualUpdateLink: "releases" } };
  manualHandlers.click(mouse({ target: { closest: () => link } }));
  assert.equal(manualCalls[0], "https://github.com/zeter1/ZeTer-OS/releases");

  const actions = fixture();
  await actions.controller.start();
  for (const attribute of ["data-update-news", "data-update-manual"]) {
    const button = { disabled: false, hasAttribute: value => value === attribute };
    actions.handlers.click({ target: { closest: () => button }, preventDefault() {}, stopPropagation() {} });
  }
  assert.deepEqual(actions.calls.slice(-2), ["external:https://github.com/zeter1/ZeTer-OS/blob/main/CHANGELOG.md", "manual-window"], "news must open the changelog and manual action its own guide window");
  actions.controller.stop();
  const success = fixture();
  await success.controller.start();
  assert.equal([...success.timers.values()][0].delay, 6 * 60 * 60 * 1000, "automatic discovery must wait six hours");
  assert.equal(success.children.length, 1, "available update must appear as an offer");
  assert.equal(success.children[0].style.left, "510px", "offer must be anchored below the About button");
  assert.equal(success.children[0].style.top, "70px");
  await success.controller.install();
  assert.deepEqual(success.calls.slice(3), ["prepare_app_update", "locked", "saved", "install_app_update", "close_app"], "successful close must keep mutations frozen until process exits");
  const frozenCalls = success.calls.length;
  success.handlers.click({ target: { closest: () => ({ disabled: false, hasAttribute: value => value === "data-update-manual" }) }, preventDefault() {}, stopPropagation() {} });
  assert.equal(success.calls.length, frozenCalls, "manual window must not mutate window state while the installer is waiting for exit");
  success.controller.stop();
  assert.equal(success.timers.size, 0, "stopping must clear timers");

  const failure = fixture({ saveBeforeInstall: async () => { throw new Error("Storage refused"); } });
  await failure.controller.start();
  assert.equal(await failure.controller.install(), false);
  assert.equal(failure.calls.includes("install_app_update"), false, "save failure must never arm installer");
  assert.equal(failure.calls.includes("close_app"), false, "save failure must keep app open");
  assert.equal(failure.calls.at(-1), "unlocked");
  assert.equal(failure.controller.getStatus().error, "Storage refused");
  failure.controller.stop();

  let releaseDownload;
  const raced = fixture({ callNative: async method => {
    if (method === "check_app_updates") return available;
    if (method === "get_app_update_status") return { supported: true };
    if (method === "prepare_app_update") return new Promise(resolve => { releaseDownload = resolve; });
    if (method === "cancel_app_update") return { ...available, phase: "available" };
    throw new Error(`Unexpected action: ${method}`);
  } });
  await raced.controller.start();
  const first = raced.controller.install();
  assert.equal(await raced.controller.install(), false, "double-click must not start another update");
  await raced.controller.cancel();
  releaseDownload({ ...available, phase: "ready" });
  assert.equal(await first, false, "cancel before response must prevent installation even if backend reached ready");
  assert.equal(raced.calls.includes("saved"), false);
  raced.controller.stop();

  let finishPrepare, finishStatus;
  let preparing = false;
  const lateCalls = [];
  const late = fixture({ callNative: async method => {
    lateCalls.push(method);
    if (method === "check_app_updates") return available;
    if (method === "get_app_update_status") {
      if (preparing) return new Promise(resolve => { finishStatus = resolve; });
      return { supported: true, phase: "idle" };
    }
    if (method === "prepare_app_update") { preparing = true; return new Promise(resolve => { finishPrepare = resolve; }); }
    if (method === "install_app_update") return { ...available, phase: "awaiting_exit" };
    return { ok: true };
  } });
  await late.controller.start();
  const lateInstall = late.controller.install();
  const progressCallback = [...late.timers.values()].find(timer => timer.delay === 1000).callback;
  const lateProgress = progressCallback();
  finishPrepare({ ...available, phase: "ready" });
  assert.equal(await lateInstall, true);
  finishStatus({ ...available, phase: "ready" });
  await lateProgress;
  assert.equal(late.controller.getStatus().phase, "awaiting_exit", "late download status cannot replace installer handoff");
  assert.equal(await late.controller.install(), false, "successful close cannot start/cancel another installer");
  assert.equal(lateCalls.includes("cancel_app_update"), false);
  late.controller.stop();

  const source = fixture({ native: false });
  await source.controller.start();
  assert.equal(await source.controller.install(), false);
  assert.deepEqual(source.calls, [], "browser/source without support must not invoke installer APIs");
  source.controller.stop();

  const centerRecord = { id: "update-1", title: "Новая версия", text: "Обновить", source: "update:4.0.12", action: "open-update" };
  assert.equal(notifications.notificationMatchesFilter(centerRecord, "system"), true);
  assert.equal(notifications.notificationCanOpen(centerRecord), true);
  const restored = JSON.parse(JSON.stringify(centerRecord));
  assert.equal(notifications.notificationCanOpen(restored), true, "restored update notification must remain openable");
  assert.match(notificationUI.notificationCardHTML(restored, { openable: true }), /data-update-install/);
  assert.match(notificationUI.notificationCardHTML(restored, { openable: true }), /data-update-news/);
  assert.match(notificationUI.notificationCardHTML(restored, { openable: true }), /data-update-manual/);
  assert.match(notificationUI.notificationCardHTML(restored, { openable: true }), /ZeTer OS перезапустится автоматически/);
  assert.match(notificationUI.notificationCardHTML(restored, { openable: true }), /Не запускайте программу вручную/);
  for (const phase of ["available", "downloading", "preparing", "ready", "installing", "awaiting_exit"]) {
    assert.match(updates.updatePanelHTML({ ...available, phase }), /ZeTer OS перезапустится автоматически/, `restart notice must remain visible in ${phase}`);
  }
  assert.doesNotMatch(updates.updatePanelHTML({ supported: false }), /ZeTer OS перезапустится автоматически/, "manual update cannot promise automatic restart");
  assert.doesNotMatch(notificationUI.notificationCardHTML({ title: "Задача", text: "Проверка" }), /ZeTer OS перезапустится автоматически/);
  assert.match(updates.updatePanelHTML(available), /data-update-news/);
  assert.match(updates.updatePanelHTML({ supported: false }), /data-update-manual/, "manual guide stays available without auto installation support");
  assert.equal(notifications.notificationCanOpen({ ...centerRecord, source: "update:javascript:bad" }), false);
  assert.doesNotMatch(notificationUI.notificationCardHTML({ ...centerRecord, source: "update:javascript:bad" }), /data-update-install/);
  assert.doesNotMatch(updates.updatePanelHTML({ ...available, error: '<img src=x onerror="bad">' }), /<img/);
  console.log("update UI: manual links/selection/copy, offer anchor, save barrier, cancel race, duplicate start, source boundary and notification center: ok");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
