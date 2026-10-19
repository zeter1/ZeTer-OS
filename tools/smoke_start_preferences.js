"use strict";

// Pure VM fixtures only: never imports the Python launcher or opens real data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/system-settings-utils.js"), "utf8"), context);
const utils = context.window.ZETER_SYSTEM_SETTINGS_UTILS;
const plain = value => JSON.parse(JSON.stringify(value));

assert.equal(typeof utils.normalizeStartMenuPreferences, "function", "Start settings require a bounded normalizer");
const defaults = utils.normalizeSystemSettings().startMenu;
assert.equal(defaults.layout, "balanced");
assert.equal(defaults.showPinned, true);
assert.equal(defaults.showRecent, true);
assert.deepEqual(plain(defaults.quickActions), ["note", "task", "explorer"]);
const malformed = utils.normalizeStartMenuPreferences({
  layout: "oversized", iconSize: "huge", showPinned: "false", showRecent: false,
  quickActions: ["task", "evil", "task", "note"],
  pinOrder: ["app:tasks", "app:tasks", {}, "item:заметка"],
  recentItems: [{ id: "a", openedAt: 8 }, { id: "a", openedAt: 2 }, { id: "b", openedAt: 9 }, { id: "bad", openedAt: -1 }],
  futureField: "preserved"
});
assert.equal(malformed.layout, "balanced");
assert.equal(malformed.iconSize, "normal");
assert.equal(malformed.showPinned, true);
assert.equal(malformed.showRecent, false);
assert.equal(malformed.futureField, "preserved");
assert.deepEqual(plain(malformed.quickActions), ["task", "note"]);
assert.deepEqual(plain(malformed.pinOrder), ["app:tasks", "item:заметка"]);
assert.deepEqual(plain(malformed.recentItems), [{ id: "b", openedAt: 9 }, { id: "a", openedAt: 8 }]);
assert.doesNotThrow(() => utils.normalizeStartMenuPreferences({ recentItems: [null, [], "bad"], pinOrder: null }));
assert.equal(utils.normalizeStartMenuPreferences({ recentItems: Array.from({ length: 60 }, (_, i) => ({ id: `id${i}`, openedAt: i + 1 })) }).recentItems.length, 20);
const imported = utils.normalizeSystemSettings({ startMenu: malformed, unrelated: { keep: true } });
assert.deepEqual(plain(utils.normalizeSystemSettings(imported)), plain(imported), "normalization must survive reload without mutation");
assert.equal(imported.unrelated.keep, true);
assert.deepEqual(plain(defaults.recentItems), [], "normalization must not mutate defaults");
console.log("start preferences smoke: ok");
