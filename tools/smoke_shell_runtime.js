"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fakeElement() {
  const classes = new Set();
  return {
    addEventListener() {},
    focus() {},
    style: {},
    value: "",
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      toggle(name, force) {
        if (force === undefined) {
          if (classes.has(name)) classes.delete(name);
          else classes.add(name);
          return classes.has(name);
        }
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      },
      contains(name) { return classes.has(name); }
    }
  };
}

const elements = Object.fromEntries([
  "start-menu",
  "quick-panel",
  "notification-center",
  "context-menu",
  "start-button",
  "os",
  "volume"
].map(id => [`#${id}`, fakeElement()]));

const sandbox = {
  console,
  Date,
  setInterval() { return 1; },
  setTimeout() { return 1; },
  window: {
    Element: class {},
    ZETER_CORE_UTILS: {
      $(selector) { return elements[selector] || null; },
      $$() { return []; },
      parseISO(value) { return new Date(value); },
      escapeHtml(value) { return String(value ?? ""); }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const source = fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", "shell-ui-utils.js"), "utf8");
vm.runInContext(source, sandbox, { filename: "shell-ui-utils.js" });

const windows = new Map([
  ["calendar-window", { winId: "calendar-window", appId: "calendar", desktopId: "desktop-1" }],
  ["other-calendar", { winId: "other-calendar", appId: "calendar", desktopId: "desktop-2" }]
]);
const opened = [];
const closed = [];
let calendarState = { view: "agenda", date: "2024-01-15", selected: "2024-01-15", editing: "event_old" };
const controller = sandbox.window.ZETER_SHELL_UI_UTILS.createShellRuntimeController({
  documentRef: {},
  windowRef: sandbox.window,
  navigatorRef: {},
  locationRef: { protocol: "file:" },
  getRuntimeUi: () => ({ windows }),
  getDesktopRoot: () => "desktop-1",
  openApp(appId) { opened.push(appId); },
  closeWindow(winId) { closed.push(winId); windows.delete(winId); return true; },
  prepareCalendarForTray() {
    calendarState = { view: "month", date: "2026-07-15", selected: "2026-07-15", editing: null };
  },
  globalSearchOverlay: { close() {} },
  setInterval() { return 1; },
  setTimeout() { return 1; }
});

assert.equal(controller.toggleCalendarFromTray(), true);
assert.deepEqual(closed, ["calendar-window"]);
assert.deepEqual(opened, []);
assert.equal(windows.has("other-calendar"), true);
assert.equal(calendarState.view, "agenda", "closing through the tray must not reset calendar state");

controller.toggleCalendarFromTray();
assert.deepEqual(opened, ["calendar"]);
assert.deepEqual(closed, ["calendar-window"]);
assert.deepEqual(calendarState, { view: "month", date: "2026-07-15", selected: "2026-07-15", editing: null });
controller.handleTopMenuAction("monitor");
assert.deepEqual(opened, ["calendar", "monitor"], "top monitor action must open the system monitor");

elements["#notification-center"].classList.add("hidden");
let implicitReadCalls = 0;
let notificationRenders = 0;
const notificationController = sandbox.window.ZETER_SHELL_UI_UTILS.createShellRuntimeController({
  documentRef: {},
  windowRef: sandbox.window,
  navigatorRef: {},
  locationRef: { protocol: "file:" },
  globalSearchOverlay: { close() {} },
  markNotificationsRead() { implicitReadCalls += 1; },
  renderNotifications() { notificationRenders += 1; },
  setInterval() { return 1; },
  setTimeout() { return 1; }
});
notificationController.togglePanel("notifications");
assert.equal(implicitReadCalls, 0, "opening the notification center must preserve unread status for the explicit bulk action");
assert.equal(notificationRenders, 1);
assert.equal(elements["#notification-center"].classList.contains("hidden"), false);

let visualSaves = 0;
controller.handleTopMenuAction("about");
assert.equal(opened.at(-1), "about", "About button must open its own window");
controller.handleTopMenuAction("help");
assert.equal(opened.at(-1), "help", "User guide button must open the existing help application");
const visualDocument = {
  body: fakeElement(),
  documentElement: { style: { setProperty() {} } }
};
const visualController = sandbox.window.ZETER_SHELL_UI_UTILS.createShellRuntimeController({
  documentRef: visualDocument,
  windowRef: sandbox.window,
  navigatorRef: {},
  locationRef: { protocol: "file:" },
  getSettings: () => ({ wallpaper: "aurora", volume: 74 }),
  getSystemSettings: () => ({ accessibility: {} }),
  normalizeVisualSettings: value => value,
  normalizeSystemSettings: value => value,
  customWallpaperCssUrl: () => "none",
  saveState() { visualSaves++; },
  setInterval() { return 1; },
  setTimeout() { return 1; }
});
visualController.applySettings();
assert.equal(visualSaves, 0, "applying visual settings during boot must not save state");
assert.match(source, /#volume[\s\S]*?applySettings\(\);\s*saveState\(\);/, "volume changes must save explicitly");
assert.match(source, /data-quick-wall[\s\S]*?applySettings\(\);\s*saveState\(\);/, "quick wallpaper changes must save explicitly");

console.log("shell tray calendar toggle smoke: ok");

// Reach the registered production global keyboard handler, not a source regex.
for (const id of ["tray", "notifications-button", "desktop", "import-file", "unlock", "desktop-items"]) elements[`#${id}`] = fakeElement();
let modalPresent = true, globalKeydown, deletes = 0, hotkeyChecks = 0, opens = 0;
const modalKeyboardController = sandbox.window.ZETER_SHELL_UI_UTILS.createShellRuntimeController({
  navigatorRef: {}, locationRef: { protocol: "file:" },
  documentRef: { querySelector: () => modalPresent ? {} : null, addEventListener(type, handler) { if (type === "keydown") globalKeydown = handler; } },
  windowRef: { ...sandbox.window, addEventListener() {} },
  getRuntimeUi: () => ({ selectedDesktop: "owned-note", multiSelected: new Set() }),
  deleteItems() { deletes++; }, openItem() { opens++; },
  hotkeyActionForEvent() { hotkeyChecks++; return "lock"; }
});
modalKeyboardController.bindGlobal();
for (const key of ["Delete", "k", "Enter", " "]) {
  let prevented = false;
  globalKeydown({ key, ctrlKey: key === "k", target: {}, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, "modal Enter/Space native defaults must remain usable");
}
assert.deepEqual([deletes, opens, hotkeyChecks], [0, 0, 0], "underlying shell shortcuts must not act behind warning dialog");
modalPresent = false;
globalKeydown({ key: "k", target: {}, preventDefault() {} });
assert.equal(hotkeyChecks, 1, "guard must leave ordinary shell hotkeys available after modal closes");
console.log("desktop deletion modal keyboard isolation smoke: ok");

// First launch must be a real modal, and each route must finish exactly once.
(async () => {
for (const route of ["create", "import", "help"]) {
  const listeners = {};
  const firstState = { firstRunCompleted: false };
  let saves = 0, shown = 0, removed = 0, imports = 0;
  const firstOpened = [];
  const dialog = {
    setAttribute() {},
    addEventListener(type, handler) { listeners[type] = handler; },
    showModal() { shown++; }, close() {}, remove() { removed++; }
  };
  elements["#import-file"] = { click() { imports++; } };
  const firstController = sandbox.window.ZETER_SHELL_UI_UTILS.createShellRuntimeController({
    navigatorRef: {}, locationRef: { protocol: "file:" },
    documentRef: {
      querySelector() { return null; },
      createElement(tag) { assert.equal(tag, "dialog"); return dialog; },
      body: { appendChild() {} }
    },
    getState: () => firstState,
    firstRunScreenHTML: () => "<button data-first-create>Start</button>",
    saveState() { saves++; },
    openApp(app) { firstOpened.push(app); }
  });
  firstController.showFirstRunScreen();
  assert.equal(shown, 1, "first launch must isolate background focus with showModal");
  assert.equal(saves, 0, "viewing welcome must not complete first launch");
  let cancelPrevented = false;
  listeners.cancel({ preventDefault() { cancelPrevented = true; } });
  assert.equal(cancelPrevented, true, "Escape must not silently skip the first-launch choice");
  await listeners.click({ target: { closest: selector => selector.split(", ").includes(`[data-first-${route}]`) } });
  assert.equal(firstState.firstRunCompleted, true);
  assert.equal(saves, 1);
  assert.equal(removed, 1);
  assert.equal(imports, route === "import" ? 1 : 0);
  assert.deepEqual(firstOpened, route === "help" ? ["help"] : []);
  firstController.showFirstRunScreen();
  assert.equal(shown, 1, "completed first launch must not reopen");
}
console.log("first-run routes and modal isolation smoke: ok");
})().catch(error => { console.error(error); process.exitCode = 1; });
