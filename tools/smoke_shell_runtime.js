"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fakeElement() {
  const classes = new Set();
  return {
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

let visualSaves = 0;
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
