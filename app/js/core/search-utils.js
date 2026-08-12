(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const tableUtils = window.ZETER_TABLE_UTILS;
  if (!coreUtils || !tableUtils) throw new Error("ZeTer OS search utils require core and table utils.");

  const { escapeHtml } = coreUtils;
  const { normalizeTableData, tablePlainText } = tableUtils;

  const SEARCH_FILTERS = Object.freeze([
    Object.freeze({ id: "files", label: "Файлы", icon: "📄" }),
    Object.freeze({ id: "folders", label: "Папки", icon: "📁" }),
    Object.freeze({ id: "tasks", label: "Задачи", icon: "✅" }),
    Object.freeze({ id: "calendar", label: "Календарь", icon: "📅" }),
    Object.freeze({ id: "notes", label: "Заметки", icon: "🗒️" }),
    Object.freeze({ id: "tables", label: "Таблицы", icon: "▦" }),
    Object.freeze({ id: "images", label: "Изображения", icon: "🖼️" })
  ]);
  const SEARCH_FILTER_IDS = Object.freeze(SEARCH_FILTERS.map(filter => filter.id));
  const SEARCH_FILTER_LABELS = Object.freeze(Object.fromEntries(SEARCH_FILTERS.map(filter => [filter.id, filter.label])));

  function normalizeSearchFilterSelection(filters = SEARCH_FILTER_IDS) {
    const selected = Array.isArray(filters) ? filters.filter(id => SEARCH_FILTER_IDS.includes(id)) : [...SEARCH_FILTER_IDS];
    const unique = [...new Set(selected)];
    return unique.length ? unique : [...SEARCH_FILTER_IDS];
  }

  function normalizeSearchSettings(settings = {}) {
    const source = settings && typeof settings === "object" ? settings : {};
    return { filters: normalizeSearchFilterSelection(source.filters) };
  }

  function activeSearchFilterIds(settings = {}) {
    return normalizeSearchSettings(settings).filters;
  }

  function searchAllFiltersActive(filters = SEARCH_FILTER_IDS) {
    const active = Array.isArray(filters) ? filters.filter(id => SEARCH_FILTER_IDS.includes(id)) : [];
    return !active.length || active.length === SEARCH_FILTER_IDS.length;
  }

  function toggleSearchFilterSelection(currentFilters = SEARCH_FILTER_IDS, filterId = "") {
    if (!SEARCH_FILTER_IDS.includes(filterId)) return normalizeSearchFilterSelection(currentFilters);
    const current = Array.isArray(currentFilters) ? [...new Set(currentFilters.filter(id => SEARCH_FILTER_IDS.includes(id)))] : [...SEARCH_FILTER_IDS];
    const base = searchAllFiltersActive(current) ? [] : current;
    const next = base.includes(filterId) ? base.filter(id => id !== filterId) : [...base, filterId];
    return next.length ? next : [...SEARCH_FILTER_IDS];
  }

  function searchFiltersAllowCategories(categories = [], activeFilters = SEARCH_FILTER_IDS) {
    const active = Array.isArray(activeFilters) ? activeFilters.filter(id => SEARCH_FILTER_IDS.includes(id)) : [];
    if (searchAllFiltersActive(active)) return true;
    return categories.some(category => active.includes(category));
  }

  function itemSearchCategories(item = {}) {
    if (item.type === "folder") return ["folders"];
    if (item.type === "note") return ["notes", "files"];
    if (item.type === "table") return ["tables", "files"];
    if (item.type === "tasklist") return ["tasks", "files"];
    if (["image", "paint"].includes(item.type)) return ["images", "files"];
    if (["text", "markdown"].includes(item.type)) return ["files"];
    if (item.type === "shortcut") return ["files"];
    if (item.type === "app") return [];
    return ["files"];
  }

  function searchNormalize(value = "") {
    return String(value ?? "").toLowerCase().replace(/\u0451/g, "\u0435").replace(/\s+/g, " ").trim();
  }

  function searchTerms(query = "") {
    return searchNormalize(query).split(/[\s,.;:!?/\\|()[\]{}"'`]+/).map(t => t.trim()).filter(t => t.length >= 2);
  }

  function searchCandidateMatches(query = "", ...parts) {
    const q = searchNormalize(query);
    if (!q) return true;
    const haystack = searchNormalize(parts.join(" "));
    if (haystack.includes(q)) return true;
    const terms = searchTerms(q);
    if (!terms.length) return haystack.includes(q);
    return terms.every(term => haystack.includes(term));
  }

  function searchFieldScore(query = "", title = "", content = "") {
    const q = searchNormalize(query);
    if (!q) return 1;
    const name = searchNormalize(title);
    const hay = searchNormalize(`${title} ${content}`);
    const terms = searchTerms(q);
    let score = 0;
    if (name === q) score += 90;
    if (name.startsWith(q)) score += 70;
    if (name.includes(q)) score += 50;
    if (hay.includes(q)) score += 30;
    if (terms.length) {
      score += terms.filter(term => name.includes(term)).length * 12;
      score += terms.filter(term => hay.includes(term)).length * 5;
    }
    return score;
  }

  function searchMatch(query, ...parts) {
    if (!query) return true;
    const q = String(query || "").toLowerCase();
    return parts.some(part => String(part || "").toLowerCase().includes(q));
  }

  function mergeSearchTextParts(...parts) {
    const merged = [];
    parts.forEach(part => {
      const text = String(part || "").replace(/\s+/g, " ").trim();
      const normalized = searchNormalize(text);
      if (!normalized) return;
      const duplicateIndex = merged.findIndex(entry => entry.normalized === normalized || entry.normalized.includes(normalized) || normalized.includes(entry.normalized));
      if (duplicateIndex >= 0) {
        if (normalized.length > merged[duplicateIndex].normalized.length) merged[duplicateIndex] = { text, normalized };
        return;
      }
      merged.push({ text, normalized });
    });
    return merged.map(entry => entry.text).join(" ");
  }

  function resolveOptionValue(value, ...args) {
    return typeof value === "function" ? value(...args) : value;
  }

  function defaultDesktopId(options = {}) {
    return resolveOptionValue(options.defaultDesktopId) || "desktop";
  }

  function itemDesktopIdForSearch(item = {}, options = {}) {
    const fs = options.fs || {};
    const fallback = defaultDesktopId(options);
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : id => id === fallback;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    if (!item) return fallback;
    if (isDesktopRoot(item.parent)) return item.parent;
    if (isExplorerRoot(item.parent)) return fs[item.parent]?.parent || fallback;
    let current = fs[item.parent];
    while (current) {
      if (isDesktopRoot(current.id)) return current.id;
      if (isDesktopRoot(current.parent)) return current.parent;
      if (isExplorerRoot(current.id)) return current.parent || fallback;
      if (isExplorerRoot(current.parent)) return fs[current.parent]?.parent || fallback;
      current = fs[current.parent];
    }
    return fallback;
  }

  function itemPathForSearch(item = {}, options = {}) {
    const fs = options.fs || {};
    const fallback = defaultDesktopId(options);
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : id => id === fallback;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const parts = [];
    let current = item;
    while (current && current.parent && !isDesktopRoot(current.parent) && !isExplorerRoot(current.parent)) {
      const parent = fs[current.parent];
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(" / ");
  }

  function taskSearchText(task = {}, options = {}) {
    const statusName = typeof options.statusName === "function" ? options.statusName : value => value;
    const priorityName = typeof options.priorityName === "function" ? options.priorityName : value => value;
    const taskReminderLabel = typeof options.taskReminderLabel === "function" ? options.taskReminderLabel : value => value;
    const taskReminderRepeatLabel = typeof options.taskReminderRepeatLabel === "function" ? options.taskReminderRepeatLabel : value => value;
    const extraParts = Array.isArray(options.extraParts) ? options.extraParts : [];
    return [
      task.title,
      task.description,
      task.tag,
      statusName(task.status),
      priorityName(task.priority),
      task.reminderAt,
      taskReminderLabel(task.reminderAt),
      taskReminderRepeatLabel(task.reminderRepeatDays),
      ...(task.checklist || []).map(sub => sub.text),
      ...extraParts
    ].join(" ");
  }

  function taskListSearchText(item = {}, options = {}) {
    if (typeof options.normalizeTaskStore === "function") options.normalizeTaskStore(item);
    return [
      item.name,
      ...(item.taskProjects || []).map(project => project.name),
      ...(item.tasks || []).map(task => taskSearchText(task, options))
    ].join(" ");
  }

  function itemBodySearchText(item = {}, options = {}) {
    const htmlPlainText = typeof options.htmlPlainText === "function" ? options.htmlPlainText : () => "";
    return mergeSearchTextParts(item.content, htmlPlainText(item.richContent));
  }

  function itemSearchText(item = {}, options = {}) {
    const itemDescription = typeof options.itemDescription === "function" ? options.itemDescription : () => "";
    const parts = [item.name, item.type, item.mime, item.extension, item.appId, itemDescription(item), itemPathForSearch(item, options)];
    if (item.type === "table") parts.push(tablePlainText(item));
    else if (item.type === "tasklist") parts.push(taskListSearchText(item, options));
    else if (item.type === "shortcut") parts.push(item.shortcut?.target, item.managedFile?.shortcutTarget);
    else parts.push(itemBodySearchText(item, options));
    if (["image", "paint"].includes(item.type)) parts.push("фото картинка изображение image photo picture", item.alt, item.caption, item.fileName, item.originalName);
    return mergeSearchTextParts(...parts);
  }

  function itemSearchSnippetSource(item = {}, options = {}) {
    if (item.type === "table") return tablePlainText(item);
    if (item.type === "tasklist") return taskListSearchText(item, options);
    return itemBodySearchText(item, options);
  }

  function buildItemSearchResult(item = {}, query = "", options = {}) {
    const categories = itemSearchCategories(item);
    const filtersAllow = typeof options.filtersAllow === "function" ? options.filtersAllow : () => true;
    if (!filtersAllow(categories)) return null;
    const desktopId = itemDesktopIdForSearch(item, options);
    const currentDesktopId = resolveOptionValue(options.currentDesktopId);
    if (currentDesktopId && desktopId !== currentDesktopId) return null;
    const text = itemSearchText(item, options);
    if (!searchCandidateMatches(query, item.name, text)) return null;
    const path = itemPathForSearch(item, options);
    const subtype = typeof options.itemResultSubtype === "function" ? options.itemResultSubtype(item) : "";
    const icon = typeof options.itemIcon === "function" ? options.itemIcon(item) : "";
    const title = item.name || "";
    const desktopName = typeof options.desktopName === "function" ? options.desktopName(desktopId) : desktopId;
    const itemDescription = typeof options.itemDescription === "function" ? options.itemDescription(item) : "";
    const snippetSource = itemSearchSnippetSource(item, options);
    return {
      kind: "item",
      id: item.id,
      desktopId,
      icon,
      title,
      sub: [subtype, desktopName, path].filter(Boolean).join(" \u00b7 "),
      snippet: searchSnippet(snippetSource || itemDescription, query),
      categories,
      query,
      score: 70 + searchFieldScore(query, item.name, text)
    };
  }

  function buildSearchCommandResults(query = "", commands = [], options = {}) {
    const q = searchNormalize(query);
    const allFiltersActive = options.allFiltersActive !== false;
    if (!q && !allFiltersActive) return [];
    return (Array.isArray(commands) ? commands : [])
      .filter(cmd => !q || searchCandidateMatches(q, cmd.title, cmd.sub, cmd.text))
      .map(cmd => ({
        kind: "command",
        id: cmd.id,
        icon: cmd.icon,
        title: cmd.title,
        sub: cmd.sub,
        categories: [],
        query,
        score: q ? 140 + searchFieldScore(q, cmd.title, cmd.text) : 18
      }));
  }

  function buildAppSearchResults(apps = {}, query = "", options = {}) {
    if (options.filtersSpecific) return [];
    const appSearchText = typeof options.appSearchText === "function" ? options.appSearchText : (id, app) => [id, app?.name].join(" ");
    const appSubLabel = options.appSubLabel || "Приложение";
    return Object.entries(apps || {})
      .filter(([id, app]) => id !== "search" && app && !app.hidden)
      .flatMap(([id, app]) => {
        const text = appSearchText(id, app);
        if (!searchCandidateMatches(query, text)) return [];
        return [{
          kind: "app",
          id,
          icon: app.icon,
          title: app.name,
          sub: appSubLabel,
          categories: [],
          query,
          score: (query ? 95 : 20) + searchFieldScore(query, app.name, text)
        }];
      });
  }

  function taskSearchSnippetText(task = {}) {
    return `${task.description || ""} ${(task.checklist || []).map(sub => sub.text).join(" ")}`;
  }

  function buildTaskSearchResults(query = "", stores = [], taskItems = [], options = {}) {
    const filtersAllow = typeof options.filtersAllow === "function" ? options.filtersAllow : () => true;
    if (!filtersAllow(["tasks"])) return [];
    const normalizeTaskStore = typeof options.normalizeTaskStore === "function" ? options.normalizeTaskStore : () => {};
    const statusName = typeof options.statusName === "function" ? options.statusName : value => value;
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : value => value;
    const defaultTaskProjectName = options.defaultTaskProjectName || "Основной";
    const currentDesktopId = resolveOptionValue(options.currentDesktopId);
    const results = [];

    (Array.isArray(stores) ? stores : []).forEach(store => {
      normalizeTaskStore(store.data);
      (store.data?.tasks || []).forEach(task => {
        const project = (store.data?.taskProjects || []).find(item => item.id === task.projectId);
        const text = taskSearchText(task, options);
        if (!searchCandidateMatches(query, text)) return;
        results.push({
          kind: "task",
          id: task.id,
          desktopId: store.desktopId,
          projectId: task.projectId || "",
          itemId: "",
          icon: "\u2705",
          title: task.title || "Без названия",
          sub: `Задача · ${statusName(task.status)} · ${project?.name || defaultTaskProjectName} · ${store.title}`,
          snippet: searchSnippet(taskSearchSnippetText(task), query),
          categories: ["tasks"],
          query,
          score: 65 + searchFieldScore(query, task.title, text)
        });
      });
    });

    (Array.isArray(taskItems) ? taskItems : []).forEach(item => {
      const desktopId = itemDesktopIdForSearch(item, options);
      if (currentDesktopId && desktopId !== currentDesktopId) return;
      normalizeTaskStore(item);
      (item.tasks || []).forEach(task => {
        const project = (item.taskProjects || []).find(record => record.id === task.projectId);
        const text = taskSearchText(task, { ...options, extraParts: [item.name, project?.name] });
        if (!searchCandidateMatches(query, text)) return;
        results.push({
          kind: "task",
          id: task.id,
          desktopId,
          projectId: task.projectId || "",
          itemId: item.id,
          icon: "\u2705",
          title: task.title || "Без названия",
          sub: `Задача · ${statusName(task.status)} · ${item.name} · ${desktopName(desktopId)}`,
          snippet: searchSnippet(taskSearchSnippetText(task), query),
          categories: ["tasks"],
          query,
          score: 65 + searchFieldScore(query, task.title, text)
        });
      });
    });

    return results;
  }

  function buildCalendarSearchResults(query = "", stores = [], options = {}) {
    const filtersAllow = typeof options.filtersAllow === "function" ? options.filtersAllow : () => true;
    if (!filtersAllow(["calendar"])) return [];
    const categoryName = typeof options.categoryName === "function" ? options.categoryName : value => value;
    const formatDate = typeof options.formatDate === "function" ? options.formatDate : value => value;
    const results = [];
    (Array.isArray(stores) ? stores : []).forEach(store => {
      (store.data?.events || []).forEach(ev => {
        const text = [ev.title, ev.description, ev.location, ev.date, ev.start, ev.end, categoryName(ev.category), ev.repeat, ev.reminder].join(" ");
        if (!searchCandidateMatches(query, text)) return;
        results.push({
          kind: "calendar",
          id: ev.id,
          desktopId: store.desktopId,
          icon: "\ud83d\udcc5",
          title: ev.title || "Событие",
          sub: `Событие · ${formatDate(ev.date)} ${ev.start || ""} · ${store.title}`.trim(),
          snippet: searchSnippet(`${ev.description || ""} ${ev.location || ""}`, query),
          categories: ["calendar"],
          query,
          score: 60 + searchFieldScore(query, ev.title, text)
        });
      });
    });
    return results;
  }

  function buildNotificationSearchResults(query = "", stores = [], options = {}) {
    const filtersAllow = typeof options.filtersAllow === "function" ? options.filtersAllow : () => true;
    const allFiltersActive = options.allFiltersActive !== false;
    if (!allFiltersActive && !filtersAllow(["calendar", "tasks"])) return [];
    const q = searchNormalize(query);
    if (!q) return [];
    const results = [];
    (Array.isArray(stores) ? stores : []).forEach(store => {
      (store.data?.notifications || []).forEach(notification => {
        const text = [notification.title, notification.text, new Date(notification.time || Date.now()).toLocaleString("ru-RU")].join(" ");
        if (!searchCandidateMatches(query, text)) return;
        results.push({
          kind: "notification",
          id: notification.id,
          desktopId: store.desktopId,
          icon: "\ud83d\udd14",
          title: notification.title || "Уведомление",
          sub: `Уведомление · ${store.title}`,
          snippet: searchSnippet(notification.text || "", query),
          categories: [],
          query,
          score: 35 + searchFieldScore(query, notification.title, text)
        });
      });
    });
    return results;
  }

  function searchableFsItems(fs = {}, options = {}) {
    const trashRoot = options.trashRoot || "";
    return Object.values(fs || {}).filter(item =>
      item &&
      !item.deletedAt &&
      item.parent !== trashRoot &&
      !item.systemRole &&
      !item.hiddenInExplorer &&
      !item.hiddenFromDesktop
    );
  }

  function searchableTaskListItems(fs = {}, options = {}) {
    const trashRoot = options.trashRoot || "";
    return Object.values(fs || {}).filter(item =>
      item?.type === "tasklist" &&
      !item.deletedAt &&
      item.parent !== trashRoot &&
      !item.systemRole
    );
  }

  function sortSearchResults(results = [], limit = 50) {
    return [...results]
      .sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.title || "").localeCompare(String(b.title || ""), "ru"))
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  function buildCombinedSearchResults(query = "", options = {}) {
    const cleanQuery = String(query || "").trim();
    const {
      apps = {},
      fs = {},
      stores = [],
      commands = [],
      trashRoot = "",
      limit = 50,
      allFiltersActive = true,
      appSearchText = undefined,
      builderOptions = {}
    } = options;
    const results = [];
    const searchOptions = { ...builderOptions, fs };
    results.push(...buildAppSearchResults(apps, cleanQuery, { filtersSpecific: !allFiltersActive, appSearchText }));
    results.push(...buildSearchCommandResults(cleanQuery, commands, { allFiltersActive }));
    searchableFsItems(fs, { trashRoot }).forEach(item => {
      const result = buildItemSearchResult(item, cleanQuery, searchOptions);
      if (result) results.push(result);
    });
    const taskItems = Array.isArray(options.taskItems) ? options.taskItems : searchableTaskListItems(fs, { trashRoot });
    results.push(
      ...buildTaskSearchResults(cleanQuery, stores, taskItems, searchOptions),
      ...buildCalendarSearchResults(cleanQuery, stores, searchOptions),
      ...buildNotificationSearchResults(cleanQuery, stores, { ...searchOptions, allFiltersActive })
    );
    return sortSearchResults(results, limit);
  }

  function searchSnippet(text = "", query = "", max = 150) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const q = searchNormalize(query);
    const normalized = searchNormalize(clean);
    let idx = q ? normalized.indexOf(q) : -1;
    if (idx < 0) {
      const term = searchTerms(q).find(t => normalized.includes(t));
      if (term) idx = normalized.indexOf(term);
    }
    if (idx < 0) return clean.length > max ? `${clean.slice(0, max - 1)}\u2026` : clean;
    const start = Math.max(0, idx - Math.floor(max / 3));
    const end = Math.min(clean.length, start + max);
    return `${start > 0 ? "\u2026" : ""}${clean.slice(start, end)}${end < clean.length ? "\u2026" : ""}`;
  }

  function escapeRegExp(value = "") {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function searchHighlightNeedles(query = "") {
    const raw = String(query || "").trim();
    const needles = [];
    if (raw.length >= 2) needles.push(raw);
    searchTerms(raw).forEach(term => {
      if (!needles.some(x => searchNormalize(x) === term)) needles.push(term);
    });
    return needles.sort((a, b) => b.length - a.length).slice(0, 8);
  }

  function highlightSearchText(text = "", query = "") {
    const escaped = escapeHtml(text);
    const needles = searchHighlightNeedles(query);
    if (!needles.length) return escaped;
    const rx = new RegExp(`(${needles.map(escapeRegExp).join("|")})`, "gi");
    return escaped.replace(rx, '<mark class="search-hit">$1</mark>');
  }

  function firstSearchIndex(text = "", query = "") {
    const normalized = searchNormalize(text);
    const q = searchNormalize(query);
    if (!q) return -1;
    let idx = normalized.indexOf(q);
    if (idx >= 0) return idx;
    const term = searchTerms(q).find(t => normalized.includes(t));
    return term ? normalized.indexOf(term) : -1;
  }

  function findTableSearchHit(table = {}, query = "") {
    const data = normalizeTableData(table);
    const q = String(query || "").trim();
    if (!q) return null;
    for (let pageIndex = 0; pageIndex < data.pages.length; pageIndex += 1) {
      const page = data.pages[pageIndex];
      for (let row = 0; row < page.rows.length; row += 1) {
        for (let col = 0; col < page.rows[row].length; col += 1) {
          if (searchCandidateMatches(q, page.rows[row][col])) return { pageIndex, row, col };
        }
      }
    }
    return null;
  }

  window.ZETER_SEARCH_UTILS = Object.freeze({
    SEARCH_FILTERS,
    SEARCH_FILTER_IDS,
    SEARCH_FILTER_LABELS,
    normalizeSearchFilterSelection,
    normalizeSearchSettings,
    activeSearchFilterIds,
    searchAllFiltersActive,
    toggleSearchFilterSelection,
    searchFiltersAllowCategories,
    itemSearchCategories,
    searchNormalize,
    searchTerms,
    searchCandidateMatches,
    searchFieldScore,
    searchMatch,
    mergeSearchTextParts,
    itemDesktopIdForSearch,
    itemPathForSearch,
    taskSearchText,
    taskListSearchText,
    itemBodySearchText,
    itemSearchText,
    itemSearchSnippetSource,
    buildItemSearchResult,
    buildSearchCommandResults,
    buildAppSearchResults,
    buildTaskSearchResults,
    buildCalendarSearchResults,
    buildNotificationSearchResults,
    searchableFsItems,
    searchableTaskListItems,
    sortSearchResults,
    buildCombinedSearchResults,
    searchSnippet,
    escapeRegExp,
    searchHighlightNeedles,
    highlightSearchText,
    firstSearchIndex,
    findTableSearchHit
  });
})();
