"use strict";

// Hermetic VM fixtures: source reads only, no app startup, data/, native or network.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sandbox = { window: { ZETER_CORE_UTILS: { escapeHtml }, ZETER_TABLE_UTILS: {
  tablePlainText: item => (item.pages || []).flatMap(page => page.rows.flat()).join(" "),
  normalizeTableData: item => item
} } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/search-utils.js"), "utf8"), sandbox);
const utils = sandbox.window.ZETER_SEARCH_UTILS;
assert.equal(typeof utils.buildSearchDocuments, "function", "collector API must exist");
assert.equal(typeof utils.createSearchIndex, "function", "cached index API must exist");
const at = new Date(2026, 9, 20, 12).getTime();
const workspace = (name = "Учёба") => ({ taskProjects: [{ id: "p", name }], tasks: [
  { id: "same", projectId: "p", title: "Русский план", description: "смета <script>unsafe</script>", updatedAt: at },
  { id: "removed", title: "скрытозадача", deletedAt: 0 }
], events: [{ id: "same", title: "Встреча", date: "2026-10-21", description: "аудитория" }],
library: { categories: [{ id: "cat", name: "Источники" }], entries: [{ id: "same", name: "Справочник", target: "https://example.test/needle-address", description: "описание ссылки", categoryId: "cat", createdAt: at }] },
promptLibrary: { projects: [{ id: "p", name: "Подсказки" }], categories: [], entries: [{ id: "same", projectId: "p", name: "Кодовый запрос", text: "<img src=x onerror=unsafe()> промптовый текст", updatedAt: at }] },
timeTracking: { entries: [{ id: "same", title: "Занятие", projectId: "p", projectName: name, notes: "времязаметка", createdAt: at, finishedAt: at }, { id: "gone", title: "удалённоезанятие", deletedAt: 0, createdAt: at }] } });
const options = { apps: { search: { name: "Поиск" }, editor: { name: "Редактор", icon: "✏️" }, secret: { name: "hiddenapp", hidden: true } },
  commands: [{ id: "settings", title: "Настройки", text: "параметры", icon: "⚙️" }],
  stores: [{ desktopId: "desktop", title: "Главный", data: workspace() }, { desktopId: "other", title: "Другой", data: workspace("Работа") },
    { desktopId: "archive", title: "Архив", archivedAt: at, data: workspace("скрытоархив") }],
  fs: {
    folder: { id: "folder", parent: "desktop", type: "folder", name: "Материалы" },
    note: { id: "note", parent: "folder", type: "note", name: "Заметка", content: "уникальноесодержимое", updatedAt: at },
    undated: { id: "undated", parent: "desktop", type: "text", name: "Без даты" },
    table: { id: "table", parent: "desktop", type: "table", name: "Расчёт", pages: [{ rows: [["табличноезначение"]] }] },
    list: { id: "list", parent: "desktop", type: "tasklist", name: "Мой список", ...workspace("Список проект") },
    hidden: { id: "hidden", parent: "desktop", type: "folder", name: "скрытопапка", hiddenInExplorer: true },
    hiddenChild: { id: "hiddenChild", parent: "hidden", type: "note", name: "скрытодочерний" },
    removed: { id: "removed", parent: "desktop", type: "folder", name: "скрытоудалено", deletedAt: at },
    removedChild: { id: "removedChild", parent: "removed", type: "note", name: "скрытоудалённыйребёнок" },
    archived: { id: "archived", parent: "archive", type: "note", name: "скрытоархивныйфайл" },
    a: { id: "a", parent: "b", name: "скрытоцикл", type: "folder" },
    b: { id: "b", parent: "a", name: "скрытоцикл", type: "folder" }
  }, builderOptions: { currentDesktopId: "desktop", filtersAllow: () => false,
    normalizeTaskStore: () => { throw new Error("collection must not normalize or mutate live state"); },
    isDesktopRoot: id => ["desktop", "other", "archive"].includes(id),
    itemIcon: () => "<svg></svg>" }
};
const before = JSON.stringify(options);
const documents = utils.buildSearchDocuments(options);
assert.equal(JSON.stringify(options), before, "collection preserves all source state");
assert.equal(new Set(documents.map(item => item.key)).size, documents.length, "keys unique across desktops, kinds, tasklist stores");
assert.ok(documents.every(item => typeof item.text === "string" && typeof item.previewText === "string"));
assert.equal(documents.filter(item => item.kind === "task" && item.id === "same").length, 3);
assert.equal(documents.filter(item => item.kind === "project").length, 5);
assert.equal(documents.some(item => item.desktopId === "archive" || item.text.includes("скрыто") || item.title === "hiddenapp"), false);
const projectKeys = documents.filter(item => item.kind === "project").map(item => item.projectKey);
assert.equal(new Set(projectKeys).size, 5, "project keys scoped by domain, desktop and tasklist");
const index = utils.createSearchIndex();
index.update(documents);
const all = query => index.search(query, { scope: "all" });
assert.equal(all("Русский план").total, 4, "three tasks plus their searchable tasklist file");
assert.equal(index.search("Русский план", { scope: "current", currentDesktopId: "desktop" }).total, 3);
assert.equal(index.search("", { scope: "all", filters: ["links"] }).total, 2);
const taskProject = documents.find(item => item.kind === "project" && item.desktopId === "other" && item.projectType === "tasks");
assert.equal(index.search("Русский", { scope: "all", projectId: taskProject.projectKey }).total, 1);
assert.equal(index.search("Встреча", { scope: "all", dateFrom: "2026-10-21", dateTo: "2026-10-21" }).total, 2);
assert.equal(index.search("Без даты", { scope: "all", dateFrom: "2020-01-01" }).total, 0, "unknown dates stay unknown");
assert.equal(all("уникальноесодержимое").results[0].matchReason, "В тексте");
assert.equal(all("needle-address").results[0].matchReason, "Адрес");
assert.equal(all("табличноезначение").total, 1);
assert.equal(all("промптовый текст").total, 2);
assert.equal(all("времязаметка").total, 2);
assert.equal(all("удалённоезанятие").total, 0);
assert.equal(all("pycrbq").total, 0, "no broad fuzzy matches");
const layout = all("Heccrbq gkfy");
assert.equal(layout.total, 4);
assert.equal(layout.suggestion.kind, "layout");
assert.equal(layout.results[0].matchType, "layout");
assert.equal(layout.query, "Heccrbq gkfy", "input remains unchanged");
const typo = all("Справочнки");
assert.equal(typo.total, 2);
assert.equal(typo.suggestion.kind, "typo");
assert.equal(all("Справочник").suggestion, null, "exact results suppress correction");
assert.equal(all("код").suggestion, null, "short tokens do not receive typo correction");
const limited = index.search("", { scope: "all", limit: 2 });
assert.equal(limited.results.length, 2);
assert.ok(limited.total > 2);
assert.equal(limited.counts.links, 2, "counts represent full filtered corpus before limit");
const stats = index.getStats();
all("Русский"); all("Русский п"); all("Русский пл");
assert.equal(index.getStats().rebuildCount, stats.rebuildCount);
assert.equal(index.getStats().normalizationCount, stats.normalizationCount, "source normalization cached between keypresses");
assert.equal(index.getStats().queryCount, stats.queryCount + 3);
options.fs.note.name = "Переименовано";
delete options.fs.table;
index.update(utils.buildSearchDocuments(options));
assert.equal(all("Переименовано").total, 1);
assert.equal(all("табличноезначение").total, 0);
assert.equal(index.getStats().rebuildCount, stats.rebuildCount + 1);
assert.equal(utils.buildSearchDocuments({ ...options, stores: [options.stores[2]] }).some(item => item.kind === "item"), false, "an all-archived source set cannot expose filesystem records");
const correctionIndex = utils.createSearchIndex();
correctionIndex.update([{ key: "browser", title: "Browser", text: "", previewText: "", categories: [] },
  { key: "reference", title: "Справочник", text: "", previewText: "", categories: [] }]);
assert.equal(correctionIndex.search("икщцыук").results[0].title, "Browser", "Russian keys can recover English titles");
assert.equal(correctionIndex.search("Справчник").results[0].matchType, "typo", "one omitted letter is recoverable");
assert.equal(correctionIndex.search("Спрвчник").total, 0, "two omitted letters must not match");
assert.equal(correctionIndex.search("ркт").total, 0, "short typo guesses are rejected");
assert.equal(correctionIndex.search("Неизвестный запрос").suggestion, null);
const recentIndex = utils.createSearchIndex();
const largeCorpus = Array.from({ length: 601 }, (_, n) => ({ key: `large-${n}`, title: `Материал ${String(n).padStart(3, "0")}`,
  desktopId: "other", categories: ["notes"], projectKey: "project-other", date: "2026-10-20", text: "", previewText: "" }));
recentIndex.update(largeCorpus);
assert.equal(recentIndex.search("", { scope: "all", limit: 601 }).results.length, 500, "global output cap remains bounded");
assert.equal(recentIndex.search("", { scope: "all", limit: 601 }).results.some(item => item.key === "large-600"), false);
const recentOptions = { scope: "all", keys: ["large-600"] };
assert.equal(recentIndex.search("", recentOptions).results[0]?.key, "large-600", "saved recent outside first 500 remains accessible");
assert.equal(recentIndex.search("", recentOptions).total, 1);
assert.equal(recentIndex.search("", { scope: "all", keys: [] }).total, 0, "explicit empty allowlist returns no documents");
assert.equal(recentIndex.search("", { scope: "all", keys: undefined }).total, 601, "omitted allowlist preserves ordinary search");
assert.equal(recentIndex.search("", { ...recentOptions, scope: "current", currentDesktopId: "desktop" }).total, 0, "keys cannot bypass scope");
assert.equal(recentIndex.search("", { ...recentOptions, filters: ["tasks"] }).total, 0, "keys cannot bypass type");
assert.equal(recentIndex.search("", { ...recentOptions, projectId: "another-project" }).total, 0, "keys cannot bypass project");
assert.equal(recentIndex.search("", { ...recentOptions, dateFrom: "2026-10-21" }).total, 0, "keys cannot bypass date range");
const unsafe = documents.find(item => item.kind === "prompt");
assert.ok(unsafe.previewText.includes("<img"), "plain source survives unchanged; UI escapes rendering");
assert.doesNotMatch(utils.highlightSearchText(unsafe.previewText, "img"), /<img/);
assert.ok(utils.itemPathForSearch(options.fs.a, options.builderOptions).length < 100, "legacy ancestry helpers cannot hang on cycles");
const oldFilters = ["files", "folders", "tasks", "calendar", "notes", "tables", "images"];
assert.equal(utils.normalizeSearchSettings({ filters: oldFilters }).filters.length, 11, "legacy all remains all");
let toggled = utils.SEARCH_FILTER_IDS;
for (const filter of oldFilters) toggled = utils.toggleSearchFilterSelection(toggled, filter);
assert.equal(toggled.length, 7, "runtime selection can contain exactly the seven older categories");
assert.equal(utils.normalizeSearchFilterSelection(toggled).length, 7, "runtime normalization never performs legacy migration");
const migrated = utils.normalizeSearchSettings({ filters: oldFilters });
assert.equal(migrated.filtersVersion, 2, "settings record migration version");
assert.equal(utils.normalizeSearchSettings({ ...migrated, filters: toggled }).filters.length, 7, "later deliberate seven-category selection survives normalization");
assert.equal(utils.normalizeSearchSettings().filters.length, 11, "new defaults include all types");
const settings = utils.normalizeSearchSettings({ filters: ["tasks"], scope: "all", sentinel: { keep: true },
  history: Array.from({ length: 30 }, (_, n) => ({ query: `запрос ${n}`, at: n })), recent: Array.from({ length: 30 }, (_, n) => ({ key: `key${n}`, at: n })) });
assert.equal(settings.history.length, 12); assert.equal(settings.recent.length, 12);
assert.equal(settings.scope, "all"); assert.equal(settings.sentinel.keep, true);
assert.equal(utils.normalizeSearchSettings({ history: [{ query: "", at: 1 }, { query: "ok", at: -1 }] }).history.length, 0);
assert.equal(utils.normalizeSearchSettings({ history: [{ query: "Ёлка", at: 1 }, { query: "елка", at: 2 }] }).history.length, 1);
// Older active records may have deletedAt=0; the retired deletion mechanism is not loaded.
const restoredState={fs:{restoredFolder:{id:"restoredFolder",type:"folder",name:"Прежняя папка",parent:"desktop",deletedAt:0},restoredNote:{id:"restoredNote",type:"note",name:"Прежняя заметка",parent:"restoredFolder",deletedAt:0}}};
const restoredDocs=utils.buildSearchDocuments({...options,fs:restoredState.fs});
assert.ok(restoredDocs.some(doc=>doc.id==="restoredFolder"),"A legacy active zero marker remains searchable");
assert.ok(restoredDocs.some(doc=>doc.id==="restoredNote"),"A legacy active descendant remains searchable");
console.log(`search index smoke: ok (${documents.length} fixture documents)`);
