"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = {
  console, document: { documentElement: { clientWidth: 1600 } },
  innerWidth: 1600, innerHeight: 1000,
  getComputedStyle: () => ({ getPropertyValue: () => "0" }),
  ZETER_CORE_UTILS: {
    $: selector => selector === "#window-layer" ? { clientHeight: 900 } : null,
    $$: () => [], clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    cssEscape: String
  },
  ZETER_WINDOW_SESSION_UTILS: {
    serializableParams: v => v, normalizeWindowSessionList: v => v,
    collectWindowSessionsFromRuntime: () => []
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const name of ["system-settings-utils", "window-metrics-utils", "window-ui-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", `${name}.js`), "utf8"), sandbox);
}
const settings = sandbox.ZETER_SYSTEM_SETTINGS_UTILS;
const metrics = sandbox.ZETER_WINDOW_METRICS_UTILS;
assert.equal(settings.normalizeSystemSettings().windows.openingSize, "full");
assert.equal(settings.normalizeSystemSettings({ windows: { openingSize: "bad", future: 1 } }).windows.openingSize, "full");
assert.equal(settings.normalizeSystemSettings({ windows: { openingSize: "compact", future: 1 } }).windows.future, 1);
for (const [size, width, height] of [["full", 1600, 900], ["large", 1360, 765], ["medium", 1120, 630], ["compact", 880, 495]]) {
  const rect = metrics.openingWindowRect(size);
  assert.equal(parseFloat(rect.width), width);
  assert.equal(parseFloat(rect.height), height);
  assert.equal(parseFloat(rect.left), (1600 - width) / 2);
}
const saved = { left: "45px", top: "50px", width: "500px", height: "300px" };
assert.deepEqual(JSON.parse(JSON.stringify(metrics.normalizeOpeningWindowRect(saved))), saved, "restored small windows retain geometry");
sandbox.innerWidth = 390;
assert.equal(metrics.openingWindowRect("compact").width, "330px");
assert.equal(parseFloat(metrics.normalizeOpeningWindowRect({ ...saved, width: "2000px", left: "1800px" }).width), 390);
sandbox.innerWidth = 1600;
const classes = new Set(["maximized"]);
const record = { maximized: true, lastRect: saved, el: {
  style: {}, classList: { remove: name => classes.delete(name) }
} };
let persisted = 0;
const controller = sandbox.ZETER_WINDOW_UI_UTILS.createWindowRuntimeController({
  getWindows: () => new Map([["settings", record]]), persistWindows: () => { persisted++; }
});
assert.equal(controller.applyOpeningSize("settings", "medium"), true);
assert.equal(record.el.style.width, "1120px");
assert.equal(record.maximized, false);
assert.equal(classes.has("maximized"), false);
assert.equal(record.lastRect, null);
assert.equal(persisted, 1);

// Runtime-only DOM doubles: no browser storage, native API or user data paths.
function checkOpeningPlacement() {
  const previousQuery = sandbox.ZETER_CORE_UTILS.$;
  const previousTimeout = sandbox.setTimeout;
  const windows = new Map();
  const remembered = new Map();
  const persistedRects = [];
  let placement = "center";
  let openingSize = "compact";
  let desktop = "desktop";
  let sequence = 0;
  let disposed = 0;
  const plain = value => JSON.parse(JSON.stringify(value));
  function node() {
    const listeners = {};
    const flags = new Set();
    return {
      style: {}, dataset: {}, listeners,
      addEventListener(type, callback) { listeners[type] = callback; },
      setPointerCapture() {}, remove() {}, appendChild() {},
      classList: {
        add: value => flags.add(value), remove: value => flags.delete(value),
        contains: value => flags.has(value), toggle() {}
      },
      querySelector: () => null
    };
  }
  sandbox.ZETER_CORE_UTILS.$ = (selector, element) => element?.parts?.[selector] || previousQuery(selector);
  // The controller module captures core helpers at load time.
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/window-ui-utils.js"), "utf8"), sandbox);
  sandbox.setTimeout = callback => { callback(); };
  const runtime = sandbox.ZETER_WINDOW_UI_UTILS.createWindowRuntimeController({
    getWindows: () => windows, getDesktopRoot: () => desktop,
    getApps: () => ({ one: { name: "one", render: () => node() }, two: { name: "two" } }),
    getCurrentWorkspace: () => ({}), createId: () => `fixture-${++sequence}`,
    getWindowLayer: () => ({ appendChild() {} }),
    getOpeningSize: () => openingSize, getOpeningPlacement: () => placement,
    getLastOpeningRect: appId => remembered.get(appId),
    rememberOpeningRect: (appId, rect) => remembered.set(appId, plain(rect)),
    persistWindows: () => persistedRects.push(plain([...remembered])),
    createWindowForApp: ({ openingRect }) => {
      const element = node();
      Object.assign(element.style, openingRect);
      element.parts = Object.fromEntries(["[data-win='close']", "[data-win='min']", "[data-win='max']", "[data-win='snap']", ".window-titlebar", ".resize-handle", ".window-body", ".window-title b"].map(selector => [selector, node()]));
      element.parts[".window-body"].querySelector = selector => selector === "[data-settings-root]" ? { disposeSettingsView: () => { disposed++; } } : null;
      return element;
    }
  });
  function open(appId = "one", params = {}, opts = {}) {
    runtime.openApp(appId, params, opts);
    return [...windows.values()].at(-1);
  }
  try {
    const first = open();
    assert.equal(first.el.style.left, "360px", "legacy default still centers new windows");
    assert.equal(first.el.style.top, "203px");
    placement = "cascade";
    const second = open("one", { another: true });
    assert.equal(second.el.style.left, "384px", "cascade offsets a new window by 24px per current desktop window");
    assert.equal(second.el.style.top, "227px");
    desktop = "other";
    assert.equal(open("two").el.style.left, "360px", "cascade excludes windows on other desktops");
    desktop = "desktop";
    placement = "last";
    remembered.set("one", { left: "99px", top: "77px", width: "400px", height: "250px" });
    remembered.set("two", { left: "12px", top: "13px", width: "400px", height: "250px" });
    const last = open("one", { last: true });
    assert.equal(last.el.style.left, "99px", "last position belongs to the selected application");
    assert.equal(last.el.style.width, "880px", "opening size remains independent of last position");
    assert.equal(open("two", { last: true }).el.style.left, "12px");
    runtime.openApp("one", { last: true });
    assert.equal(last.el.style.left, "99px", "focusing an existing window leaves its geometry unchanged");
    const restored = open("one", { restored: true }, { restoring: true, session: { rect: saved } });
    assert.deepEqual(plain(restored.el.style), { ...saved, zIndex: 1 }, "session geometry has priority over new-window preferences");
    Object.assign(last.el.style, { left: "123px", top: "88px" });
    const bar = last.el.parts[".window-titlebar"];
    const target = { closest: () => null };
    bar.listeners.pointerdown({ button: 0, clientX: 300, clientY: 300, target });
    bar.listeners.pointerup({ clientX: 300, clientY: 300 });
    assert.equal(remembered.get("one").left, "123px", "drag captures the normal position before saving");
    assert.equal(persistedRects.at(-1).find(([id]) => id === "one")[1].left, "123px");
    runtime.toggleMax(last.winId);
    runtime.closeWindow(last.winId);
    assert.equal(remembered.get("one").left, "123px", "closing maximized window remembers its normal rect");
    assert.equal(disposed, 1, "closing Settings disposes its view subscription");
    assert.equal(open("one", { last: true }).el.style.left, "123px", "close then reopen uses the remembered position");
    runtime.refreshWindow(first.winId);
    assert.equal(disposed, 2, "refresh disposes the previous Settings view subscription");
    const remaining = windows.size;
    runtime.restoreWindowsForCurrentDesktop();
    assert.equal(disposed, 2 + remaining, "switching desktops disposes every Settings view before clearing DOM");
    openingSize = "medium";
    sandbox.innerWidth = 390;
    remembered.set("one", { left: "1500px", top: "4000px", width: "400px", height: "250px" });
    const narrow = open("one", { narrow: true });
    assert.equal(narrow.el.style.left, "60px", "last position is clamped for a narrow viewport");
    assert.equal(narrow.el.style.width, "330px");
    assert.equal(parseFloat(narrow.el.style.top) + parseFloat(narrow.el.style.height), 900);
    openingSize = "full";
    placement = "cascade";
    const full = open("one", { full: true });
    assert.equal(full.el.style.left, "0px", "full-size cascade cannot move outside the available area");
    assert.equal(full.el.style.top, "0px");
  } finally {
    sandbox.innerWidth = 1600;
    sandbox.ZETER_CORE_UTILS.$ = previousQuery;
    sandbox.setTimeout = previousTimeout;
  }
}
checkOpeningPlacement();
async function checkSettingsControl() {
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../app/js/core/preferences-writer-utils.js"),"utf8"),sandbox);
  let current=settings.normalizeSystemSettings(), resolveSave, previews=0, fail=false;
  const writer=sandbox.ZETER_PREFERENCES_WRITER_UTILS.createPreferencesWriter({keys:["system.windows.openingSize"],requireAck:true,
    getPreferences:()=>({"system.windows.openingSize":current.windows.openingSize}),
    save:async patch=>{if(fail)throw new Error("fixture write failure");await new Promise(resolve=>{resolveSave=resolve;});current.windows.openingSize=patch["system.windows.openingSize"];previews++;return {saved:true};}});
  const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  writer.update({"system.windows.openingSize":"medium"});await tick();
  assert.equal(writer.getState().pending,true);assert.equal(current.windows.openingSize,"full");assert.equal(previews,0,"pending must not publish preview as saved");
  resolveSave();await tick();assert.equal(current.windows.openingSize,"medium");assert.equal(previews,1);
  fail=true;writer.update({"system.windows.openingSize":"compact"});await tick();
  assert.equal(current.windows.openingSize,"medium");assert.equal(previews,1,"failed writes preserve accepted window size");
  assert.ok(writer.getState().error);assert.equal(writer.getState().preferences["system.windows.openingSize"],"compact","retry intent remains visible");
}
checkSettingsControl().then(()=>console.log("window sizes smoke: ok")).catch(error=>{console.error(error);process.exitCode=1;});
