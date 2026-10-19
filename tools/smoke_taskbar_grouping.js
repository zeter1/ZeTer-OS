"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function element() {
  const classes = new Set();
  const listeners = {};
  return {
    dataset: {}, children: [],
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name), remove: name => classes.delete(name),
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
    },
    set innerHTML(value) { assert.equal(value, ""); this.children = []; },
    appendChild(child) { this.children.push(child); },
    addEventListener(type, fn) { listeners[type] = fn; },
    click() { (this.onclick || listeners.click)?.(); },
    querySelector() { return { textContent: "Fixture window" }; }
  };
}
const pinnedContainer = element();
const staticPin = element(); staticPin.dataset.app = "calendar";
const running = [element(), element(), element()];
running.forEach((button, i) => { button.dataset.winId = `w${i}`; });
const state = { taskbarPinnedApps: ["calendar", "editor"] };
const windows = new Map();
let active = null;
let opens = 0;
let saves = 0;
let menu = [];
const sandbox = {
  document: { createElement: element },
  window: { ZETER_CORE_UTILS: {
    $(selector) { return selector === "#taskbar-pinned-extra" ? pinnedContainer : null; },
    $$(selector) {
      if (selector === "#taskbar [data-app]") return [staticPin];
      if (selector === "#taskbar-apps .taskbar-app") return running;
      if (selector.includes("taskbar-pinned-static")) return [staticPin, ...pinnedContainer.children];
      return [];
    }, parseISO: String, escapeHtml: String
  } }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/shell-ui-utils.js"), "utf8"), sandbox);
const controller = sandbox.window.ZETER_SHELL_UI_UTILS.createTaskbarController({
  getState: () => state,
  getWindows: () => windows,
  getActiveWindow: () => active,
  getApps: () => ({ calendar: { name: "Calendar" }, editor: { name: "Editor" } }),
  staticTaskbarAppIds: new Set(["calendar"]),
  canPinAppToTaskbar: () => true,
  normalizeTaskbarPinnedApps: list => [...new Set(list)],
  saveState() {}, renderStart() {}, toast() {},
  openByDataApp: () => { opens++; },
  focusWindow(id) { active = id; controller.syncWindows(); },
  minimizeWindow(id) { windows.get(id).el.classList.add("minimized"); controller.syncWindows(); },
  persistWindows() { saves++; },
  showContextNearElement(event, entries) { menu = entries; },
  buildRunningTaskbarWindowMenuEntries: () => [{ icon: "×", label: "Close", action: { type: "close-window" } }]
});
controller.renderPinned();
staticPin.click();
assert.equal(opens, 1, "idle pin launches application");
windows.set("w0", { winId: "w0", appId: "calendar", el: element() });
active = "w0";
controller.syncWindows();
assert(running[0].classList.contains("hidden"), "running duplicate is hidden");
assert(staticPin.classList.contains("taskbar-pinned-running"));
assert(staticPin.classList.contains("active"));
staticPin.click();
assert(windows.get("w0").el.classList.contains("minimized"));
assert(staticPin.classList.contains("minimized"));
assert(!staticPin.classList.contains("active"));
staticPin.click();
assert(!windows.get("w0").el.classList.contains("minimized"));
assert.equal(opens, 1, "running pin never launches another window");
assert.equal(saves, 1);
controller.setPinned("calendar", false);
assert(staticPin.classList.contains("hidden"));
assert(!running[0].classList.contains("hidden"), "unpin reveals existing window button");
controller.setPinned("calendar", true);
assert(!staticPin.classList.contains("hidden"));
assert(running[0].classList.contains("hidden"));
windows.set("w1", { winId: "w1", appId: "editor", el: element() });
windows.set("w2", { winId: "w2", appId: "editor", el: element() });
controller.syncWindows();
assert(running[1].classList.contains("hidden") && running[2].classList.contains("hidden"));
const editorPin = pinnedContainer.children[0];
editorPin.click();
assert.equal(active, "w2");
controller.showPinnedAppMenu({ preventDefault() {}, stopPropagation() {} }, "editor");
assert.equal(menu.length, 4, "both grouped windows remain reachable from menu");
menu[0][2]();
assert.equal(active, "w1");
windows.delete("w0");
controller.syncWindows();
assert(!staticPin.classList.contains("taskbar-pinned-running"), "last close leaves idle pin");
staticPin.click();
assert.equal(opens, 2);
windows.clear(); active = null;
controller.syncWindows();
assert(!editorPin.classList.contains("taskbar-pinned-running"), "workspace reset clears running state");
console.log("taskbar grouping smoke: ok");
