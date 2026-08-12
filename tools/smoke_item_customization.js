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

const customization = sandbox.window.ZETER_ITEM_CUSTOMIZATION_UTILS;
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

console.log("item customization smoke: ok");
