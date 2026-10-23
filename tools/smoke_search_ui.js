"use strict";

// Pure VM fixtures; no application startup, native API or real state.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sandbox = { window: {
  ZETER_CORE_UTILS: { escapeHtml },
  ZETER_ASSET_UTILS: { isDataImage: value => /^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(value) },
  ZETER_VISUAL_UTILS: {},
  ZETER_TABLE_UTILS: {}
}, console };
vm.createContext(sandbox);
for (const name of ["shortcut-utils", "item-customization-utils", "item-metadata", "search-utils", "search-ui-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name + ".js"), "utf8"), sandbox);
}
const w = sandbox.window;
const utils = w.ZETER_SEARCH_UTILS;
const ui = w.ZETER_SEARCH_UI_UTILS;
const folder = { id: "folder", type: "folder", name: "Проекты <важное>", parent: "desktop", appearance: { color: "#4f8fe8" } };
const options = { fs: { folder }, isDesktopRoot: id => ["desktop", "other"].includes(id), currentDesktopId: "desktop", itemIcon: item => w.ZETER_ITEM_METADATA.itemIconForApps({}, item) };
const result = utils.buildItemSearchResult(folder, "Проекты", options);
const html = ui.searchResultHTML(result);
assert.match(html, /<i[^>]*><svg /, "Folder icon must be an SVG, not escaped markup");
assert.match(html, /&lt;важное&gt;/, "User title must remain text");
folder.appearance.icon = { dataURL: "data:image/png;base64,AAAA" };
assert.match(ui.searchResultHTML(utils.buildItemSearchResult(folder, "", options)), /<i[^>]*><img /, "Custom image must render as an image");
assert.match(ui.searchResultHTML({ kind: "app", icon: '<img src=x onerror="bad()">', title: "<script>bad()</script>" }), /&lt;img/, "Plain app icons must remain escaped");
folder.appearance = { color: '" onload="bad()' };
assert.doesNotMatch(ui.searchResultHTML(utils.buildItemSearchResult(folder, "", options)), /onload=/, "Invalid folder color must not create attributes");
assert.equal(utils.buildItemSearchResult({ ...folder, parent: "other" }, "", options), null, "Other desktop must be excluded");
assert.equal(utils.highlightSearchText('" & <', "quot"), "&quot; &amp; &lt;", "Highlight must not match inside HTML entities");
assert.match(utils.highlightSearchText("Ёлка", "елка"), /<mark class="search-hit">Ёлка<\/mark>/, "Highlight must agree with е/ё search");
assert.equal(utils.searchCandidateMatches("ПРОЕКТ   план", "план проекта"), true);
assert.equal(utils.searchCandidateMatches("проект отсутствует", "план проекта"), false);
console.log("search UI smoke: ok");
