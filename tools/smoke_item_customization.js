"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const sandbox = {
  console,
  URL,
  setTimeout,
  window: {
    ZETER_CORE_UTILS: { escapeHtml },
    ZETER_ASSET_UTILS: {
      isDataImage(value) {
        return /^data:image\/(?:png|jpe?g|webp|gif|bmp)(?:;base64)?,/i.test(String(value || ""));
      }
    },
    ZETER_VISUAL_UTILS: {
      async createCustomWallpaperFromFile() { return null; },
      async createDesktopIconFromFile() { return null; }
    }
  },
  document: {}
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  vm.runInContext(source, sandbox, { filename: relativePath });
}

load("app/js/core/shortcut-utils.js");
load("app/js/core/item-customization-utils.js");
load("app/js/core/context-menu-ui-utils.js");

let customization = sandbox.window.ZETER_ITEM_CUSTOMIZATION_UTILS;
const menus = sandbox.window.ZETER_CONTEXT_MENU_UI_UTILS;
const dataURL = "data:image/png;base64,AAAA";

assert.equal(customization.normalizeFolderColor("#4F8FE8"), "#4f8fe8");
assert.equal(customization.normalizeFolderColor("red"), customization.DEFAULT_FOLDER_COLOR);
assert.equal(customization.isItemAssetPath("Оформление объектов/Папки/folder-1/значок.png"), true);
assert.equal(customization.isItemAssetPath("Оформление объектов/Папки/folder-1/фон.webp"), true);
assert.equal(customization.isItemAssetPath("Оформление объектов/Ярлыки/link-1/значок.jpg"), true);
assert.equal(customization.isItemAssetPath("../data/Оформление объектов/Папки/folder-1/значок.png"), false);
assert.equal(customization.isItemAssetPath("Оформление объектов/Ярлыки/link-1/фон.png"), false);

const folder = {
  id: "folder-1",
  type: "folder",
  name: "Проекты",
  appearance: {
    color: "#4F8FE8",
    futureAppearance: "keep",
    background: {
      dataURL,
      assetPath: "Оформление объектов/Папки/folder-1/фон.png"
    }
  }
};
customization.normalizeItemAppearance(folder);
assert.equal(folder.appearance.color, "#4f8fe8");
assert.equal(folder.appearance.futureAppearance, "keep");
assert.equal(customization.folderBackgroundDataURL(folder), dataURL);
assert.match(customization.itemIconHTML(folder, "📁"), /item-folder-color-icon/);
assert.match(customization.itemSettingsHTML(folder), /Сохранить настройки/);
assert.match(customization.itemSettingsHTML(folder), /Фон внутри папки/);

folder.appearance.icon = {
  dataURL,
  assetPath: "Оформление объектов/Папки/folder-1/значок.png"
};
assert.match(customization.itemIconHTML(folder, "📁"), /item-custom-image/);

const shortcut = {
  id: "link-1",
  type: "shortcut",
  name: "Старое имя",
  shortcut: { target: "https://example.com/old" },
  managedFile: { id: "link-ref", kind: "shortcut", shortcutTarget: "https://example.com/old" },
  createdAt: 10
};
assert.equal(customization.updateShortcutItem(shortcut, {
  name: "Новое имя",
  target: "https://example.com/new"
}), true);
assert.equal(shortcut.name, "Новое имя");
assert.equal(shortcut.shortcut.kind, "url");
assert.equal(shortcut.shortcut.target, "https://example.com/new");
assert.equal(shortcut.managedFile.shortcutTarget, "https://example.com/new");
assert.equal(customization.updateShortcutItem(shortcut, {
  name: "Сам на себя",
  target: "zeter://item/link-1"
}), false);
assert.match(customization.itemSettingsHTML(shortcut), /Ссылка или путь ярлыка/);

assert.ok(menus.buildItemContextMenuEntries({ item: folder, desktopRootId: "desktop" })
  .some(entry => entry.label === "Настройка папки" && entry.action?.type === "item-settings"));
assert.ok(menus.buildItemContextMenuEntries({ item: shortcut, desktopRootId: "desktop" })
  .some(entry => entry.label === "Настройка ярлыка" && entry.action?.type === "item-settings"));
assert.ok(menus.buildExplorerFolderMenuEntries()
  .some(entry => entry.label === "Настройка папки" && entry.action?.type === "item-settings"));

// Synthetic DOM and deferred decoders: no application startup or real storage.
class TestNode {
  constructor() {
    this.listeners = {}; this.style = {}; this.dataset = {}; this.value = "#e4ad43";
    this.isConnected = true; this.disabled = false;
    this.classList = { toggle() {} };
  }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  closest(selector) { return this.selector === selector ? this : null; }
  focus() {}
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function settingsFixture(overrides = {}) {
  const nodes = new Map();
  const root = new TestNode();
  root.querySelector = selector => {
    if (!nodes.has(selector)) {
      const node = new TestNode(); node.selector = selector; nodes.set(selector, node);
    }
    return nodes.get(selector);
  };
  root.querySelectorAll = selector => selector === "button, input, textarea"
    ? [...nodes.values()].filter(node => /save|clear|file|color|upload|cancel/.test(node.selector)) : [];
  const item = { id: "test-folder", type: "folder", name: "Тест", appearance: { color: "#e4ad43" } };
  let saves = 0, closes = 0, fail = false;
  customization.createItemSettingsApp({ itemId: item.id }, "test", {
    documentRef: { createElement: () => root }, getItem: () => item,
    // Support the old contract to reproduce premature live-state mutations.
    saveState: async () => { saves++; if (fail) throw new Error("fixture refusal"); },
    saveItem: async candidate => {
      saves++; if (fail) throw new Error("fixture refusal");
      Object.assign(item, candidate);
    },
    closeWindow: () => { closes++; }, ...overrides
  });
  return {
    root, item, node: selector => root.querySelector(selector),
    saves: () => saves, closes: () => closes, fail: value => { fail = value; },
    submit: () => root.querySelector("[data-item-settings-form]").listeners.submit({ preventDefault() {} }),
    click: selector => root.listeners.click({ target: root.querySelector(selector) }),
    load: (kind, name) => {
      const node = root.querySelector(`[data-item-${kind}-file]`);
      return node.listeners.change({ target: { files: [{ name }], value: name } });
    }
  };
}

async function runtimeChecks() {
  const expectedErrors = [];
  sandbox.console = { ...console, error: (...args) => expectedErrors.push(args) };
  const jobs = new Map();
  const decode = file => { const job = deferred(); jobs.set(file.name, job); return job.promise; };
  sandbox.window.ZETER_VISUAL_UTILS.createDesktopIconFromFile = decode;
  sandbox.window.ZETER_VISUAL_UTILS.createCustomWallpaperFromFile = decode;
  load("app/js/core/item-customization-utils.js");
  customization = sandbox.window.ZETER_ITEM_CUSTOMIZATION_UTILS;
  for (const kind of ["icon", "background"]) {
    const f = settingsFixture();
    const first = f.load(kind, `${kind}-first`);
    await f.submit();
    assert.equal(f.saves(), 0, "Saving must wait until image decoding completes");
    const second = f.load(kind, `${kind}-second`);
    jobs.get(`${kind}-second`).resolve({ name: "new.png", dataURL }); await second;
    jobs.get(`${kind}-first`).resolve({ name: "old.png", dataURL }); await first;
    assert.match(f.node(`[data-item-${kind}-info]`).textContent, /new.png/, "Latest selection wins");
    const third = f.load(kind, `${kind}-third`);
    f.click(`[data-item-${kind}-clear]`);
    jobs.get(`${kind}-third`).resolve({ name: "cleared.png", dataURL }); await third;
    assert.equal(f.node(`[data-item-${kind}-info]`).textContent, "Не загружено", "Clear invalidates an in-flight decode");
    const fourth = f.load(kind, `${kind}-fourth`);
    jobs.get(`${kind}-fourth`).resolve({ name: "draft.png", dataURL }); await fourth;
    const before = JSON.stringify(f.item);
    f.fail(true); await f.submit();
    assert.equal(JSON.stringify(f.item), before, "Refused save must leave accepted state unchanged");
    assert.equal(f.closes(), 0);
    assert.match(f.node(`[data-item-${kind}-info]`).textContent, /draft.png/, "Draft survives refusal");
    f.fail(false); await f.submit();
    assert.equal(f.item.appearance[kind === "icon" ? "icon" : "background"].name, "draft.png");
    assert.equal(f.closes(), 1);
  }
  const iconAsset = deferred(), backgroundAsset = deferred();
  const both = settingsFixture({ persistAsset: (_id, kind) => kind === "folder-icon" ? iconAsset.promise : backgroundAsset.promise });
  for (const kind of ["icon", "background"]) {
    const loading = both.load(kind, `both-${kind}`);
    jobs.get(`both-${kind}`).resolve({ name: `${kind}.png`, dataURL }); await loading;
  }
  const accepted = JSON.stringify(both.item);
  const saving = both.submit();
  iconAsset.reject(new Error("fixture asset refusal"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(both.node("[data-item-settings-save]").disabled, true, "One failed native asset must not unlock controls while another is still pending");
  assert.equal(both.node("[data-item-icon-clear]").disabled, true);
  backgroundAsset.resolve(null); await saving;
  assert.equal(JSON.stringify(both.item), accepted);
  assert.equal(both.node("[data-item-settings-save]").disabled, false);
  assert.equal(expectedErrors.length, 3, "Only the three deliberate save refusals should be logged");
  const visualSandbox = {
    window: {
      ZETER_CORE_UTILS: { clamp: value => value, uid: () => "fixture" },
      ZETER_ASSET_UTILS: {
        imageMimeAllowed: () => true, isDataImage: () => true,
        blobToDataURL: async () => "data:image/gif;base64,broken",
        loadImageFromDataURL: async () => { throw new Error("undecodable fixture"); },
        parseDataUrl: () => ({ mime: "image/gif" }), dataUrlByteLength: () => 6
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/js/core/visual-utils.js"), "utf8"), visualSandbox);
  await assert.rejects(visualSandbox.window.ZETER_VISUAL_UTILS.createCustomWallpaperFromFile({ name: "broken.gif", type: "image/gif", size: 6 }), /undecodable fixture/);
  await adapterChecks();
  console.log("item customization smoke: ok (decode races, clear, refused save and retry)");
}

async function adapterChecks() {
  const appSource = fs.readFileSync(path.join(__dirname, "../app/js/app.js"), "utf8");
  const adapterSource = appSource.slice(appSource.indexOf("  function renderItemSettingsApp("), appSource.indexOf("  function renderCalculatorApp("));
  const storageSandbox = { window: {}, console, TextEncoder };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/js/core/storage-utils.js"), "utf8"), storageSandbox);
  const item = { id: "adapter-folder", type: "folder", name: "Test", appearance: { color: "#e4ad43" }, updatedAt: 1 };
  const state = { fs: { [item.id]: item } };
  let captured, fail = true, gate = null;
  const snapshots = [];
  const queue = storageSandbox.window.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({
    getState: () => state, nativeStorage: true,
    writePrimaryRecord: async snapshot => {
      if (gate) await gate.promise;
      if (fail) throw new Error("fixture primary refusal");
      snapshots.push(snapshot); return { updatedAt: 1 };
    }
  });
  const context = {
    state, primaryStateSaveQueue: queue, persistSearchAwareTransaction: operation => queue.transaction(operation),
    createItemSettingsApp: (_params, _winId, options) => { captured = options; },
    cloneForBackup: value => JSON.parse(JSON.stringify(value)),
    document: {}, persistItemCustomizationAsset() {}, renderAllFileSurfaces() {},
    refreshOpenEditors() {}, refreshOpenTaskListTitles() {}, refreshOpenTaskShortcutTitles() {},
    closeWindow() {}, toast() {}, syncLegacyWorkspaceAliases() {},
    writeSmallSettingsToLocalStorage() {}, scheduleExternalBackup() {},
    securityRuntimeController: { scheduleProtectionCheck() {} }
  };
  vm.runInNewContext(`${adapterSource}\nrenderItemSettingsApp();`, context);
  const candidate = { ...item, appearance: { color: "#4f8fe8", icon: { dataURL } }, updatedAt: 2 };
  await assert.rejects(captured.saveItem(candidate), /fixture primary refusal/);
  assert.equal(item.appearance.color, "#e4ad43");
  fail = false; gate = deferred();
  const save = captured.saveItem(candidate);
  const concurrentSave = queue.queue();
  assert.equal(item.appearance.color, "#e4ad43", "Unconfirmed candidate must stay out of live state");
  gate.resolve(); await save; await concurrentSave;
  assert.equal(item.appearance.color, "#4f8fe8");
  assert.equal(snapshots.length, 2);
  assert.ok(snapshots.every(snapshot => snapshot.fs[item.id].appearance.color === "#4f8fe8"), "Queued save must not overwrite the newly committed image");
  const shortcut = { id: "adapter-shortcut", type: "shortcut", name: "Old", appearance: {}, updatedAt: 1 };
  state.fs[shortcut.id] = shortcut;
  gate = deferred();
  const renameSave = captured.saveItem({ ...shortcut, appearance: { icon: { dataURL } }, updatedAt: 2 });
  await new Promise(resolve => setImmediate(resolve));
  shortcut.name = "Concurrent rename"; shortcut.updatedAt = 3;
  const saveRenamed = queue.queue();
  gate.resolve(); await renameSave; await saveRenamed;
  assert.equal(shortcut.name, "Concurrent rename", "Icon commit must preserve concurrent rename");
  assert.equal(shortcut.updatedAt, 3);
  assert.equal(snapshots.at(-1).fs[shortcut.id].name, "Concurrent rename");
  assert.equal(snapshots.at(-1).fs[shortcut.id].appearance.icon.dataURL, dataURL);
  delete state.fs[item.id];
  await assert.rejects(captured.saveItem(candidate), /удалён/);
}
runtimeChecks().catch(error => { console.error(error); process.exitCode = 1; });
