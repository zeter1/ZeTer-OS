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
    ZETER_CORE_UTILS: {
      escapeHtml,
      clamp(value, min, max) { return Math.max(min, Math.min(max, value)); },
      $() { return null; },
      $$() { return []; }
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
const shortcut = sandbox.window.ZETER_SHORTCUT_UTILS;
assert.deepEqual(
  JSON.parse(JSON.stringify(shortcut.normalizeShortcutTarget("zeter://item/note-1"))),
  { kind: "zeter", target: "zeter://item/note-1", itemId: "note-1" }
);
assert.equal(shortcut.normalizeShortcutTarget("C:\\Видео\\ролик.mp4").kind, "windows");
assert.equal(shortcut.normalizeShortcutTarget("\\\\server\\share\\folder").kind, "windows");
assert.equal(shortcut.normalizeShortcutTarget("www.example.com").target, "https://www.example.com/");
assert.equal(shortcut.normalizeShortcutTarget("javascript:alert(1)"), null);
assert.equal(shortcut.normalizeShortcutTarget("relative/file.txt"), null);
assert.equal(shortcut.shortcutTargetForItem("bad/item"), "");

const state = {
  fs: {
    link: {
      id: "link",
      type: "shortcut",
      name: "Справка",
      shortcut: { target: "https://example.com/help" },
      createdAt: 10
    }
  }
};
shortcut.normalizeShortcutItems(state);
assert.equal(state.fs.link.shortcut.kind, "url");
assert.equal(state.fs.link.managedFile.kind, "shortcut");
assert.equal(state.fs.link.managedFile.shortcutTarget, "https://example.com/help");

load("app/js/core/context-menu-ui-utils.js");
const menus = sandbox.window.ZETER_CONTEXT_MENU_UI_UTILS;
assert.ok(menus.buildDesktopMenuEntries().some(entry => entry.action?.type === "create-shortcut"));
assert.ok(menus.buildExplorerEmptyAreaMenuEntries().some(entry => entry.action?.type === "create-shortcut"));
assert.ok(menus.buildItemContextMenuEntries({ item: { id: "note-1", type: "note", parent: "desktop" }, desktopRootId: "desktop" })
  .some(entry => entry.action?.type === "copy-location"));

sandbox.window.ZETER_OS_CONFIG = { RICH_TEXT_IMAGE_MIME_TYPES: [] };
sandbox.window.ZETER_ASSET_UTILS = {
  isDataImage() { return false; },
  isExternalAssetPath() { return false; }
};
load("app/js/core/rich-text-utils.js");
const rich = sandbox.window.ZETER_RICH_TEXT_UTILS;
assert.match(rich.plainToRichHtml("Документация: https://example.com/docs"), /<a href="https:\/\/example\.com\/docs"/);
assert.doesNotMatch(rich.plainToRichHtml("javascript:alert(1)"), /<a /);

console.log("shortcut runtime smoke: ok");
