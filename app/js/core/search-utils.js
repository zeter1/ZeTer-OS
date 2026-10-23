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
    Object.freeze({ id: "images", label: "Изображения", icon: "🖼️" }),
    Object.freeze({ id: "projects", label: "Проекты", icon: "🗂️" }),
    Object.freeze({ id: "links", label: "Ссылки", icon: "🔗" }),
    Object.freeze({ id: "prompts", label: "Промпты", icon: "💬" }),
    Object.freeze({ id: "time", label: "Занятия", icon: "⏱️" })
  ]);
  const SEARCH_FILTER_IDS = Object.freeze(SEARCH_FILTERS.map(filter => filter.id));
  const SEARCH_FILTER_LABELS = Object.freeze(Object.fromEntries(SEARCH_FILTERS.map(filter => [filter.id, filter.label])));

  function normalizeSearchFilterSelection(filters = SEARCH_FILTER_IDS) {
    const selected = Array.isArray(filters) ? filters.filter(id => SEARCH_FILTER_IDS.includes(id)) : [...SEARCH_FILTER_IDS];
    const unique = [...new Set(selected)];
    return unique.length ? unique : [...SEARCH_FILTER_IDS];
  }

  function normalizeSearchSettings(settings = {}) {
    const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    const filters = normalizeSearchFilterSelection(source.filters);
    const legacyAll = ["files", "folders", "tasks", "calendar", "notes", "tables", "images"];
    const migrateLegacyAll = !(source.filtersVersion >= 2) && filters.length === legacyAll.length && legacyAll.every(id => filters.includes(id));
    const result = { ...source, filters: migrateLegacyAll ? [...SEARCH_FILTER_IDS] : filters, filtersVersion: 2 };
    if (Object.hasOwn(source, "scope")) result.scope = source.scope === "all" ? "all" : "current";
    for (const [field, key, max] of [["history", "query", 300], ["recent", "key", 1200]]) {
      if (!Object.hasOwn(source, field)) continue;
      const seen = new Set();
      result[field] = (Array.isArray(source[field]) ? source[field] : [])
        .filter(item => item && typeof item[key] === "string" && item[key].trim() && item[key].length <= max && Number.isFinite(item.at) && item.at >= 0)
        .map(item => ({ [key]: item[key].trim(), at: item.at }))
        .sort((a, b) => b.at - a.at)
        .filter(item => { const identity = key === "query" ? searchNormalize(item[key]) : item[key]; if (seen.has(identity)) return false; seen.add(identity); return true; })
        .slice(0, 12);
    }
    return result;
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
    const visited = new Set();
    while (current) {
      if (visited.has(current)) break;
      visited.add(current);
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
    const visited = new Set();
    while (current && current.parent && !isDesktopRoot(current.parent) && !isExplorerRoot(current.parent)) {
      if (visited.has(current)) break;
      visited.add(current);
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

  // The collector reads accepted source state only. It intentionally does not call
  // mutating normalizers or apply query/scope filters; update() owns normalization.
  function buildSearchDocuments(options = {}) {
    const fs = options.fs || {};
    const stores = (Array.isArray(options.stores) ? options.stores : []).filter(searchRecordVisible);
    const activeDesktops = new Set(stores.map(store => store.desktopId));
    const desktopTitles = new Map(stores.map(store => [store.desktopId, store.title || store.desktopId]));
    const adapters = { ...options.builderOptions, fs, currentDesktopId: undefined, filtersAllow: () => true, normalizeTaskStore: undefined };
    const desktopName = id => desktopTitles.get(id) || (typeof adapters.desktopName === "function" ? adapters.desktopName(id) : id);
    const documents = [];
    const add = (result, source = {}) => {
      const updatedAt = source.updatedAt ?? source.createdAt ?? null;
      const title = String(result.title || "Без названия");
      const text = String(result.text || "");
      const previewText = String(result.previewText || "");
      const desktopId = result.desktopId || "";
      documents.push({ path: "", projectId: "", projectName: "", projectKey: "", itemId: "", ...result,
        title, text, previewText, desktopId, desktopName: desktopId ? desktopName(desktopId) : "",
        key: JSON.stringify([result.kind, desktopId, result.itemId || "", result.projectType || "", String(result.id)]),
        updatedAt, date: result.date ?? searchDocumentDate(updatedAt),
        snippet: searchSnippet(previewText), query: "", score: 0 });
    };
    for (const [id, app] of Object.entries(options.apps || {})) {
      if (id === "search" || !searchRecordVisible(app)) continue;
      add({ kind: "app", id, title: app.name, icon: app.icon, sub: "Приложение", categories: [],
        text: typeof options.appSearchText === "function" ? options.appSearchText(id, app) : [id, app.name, app.description].join(" "), previewText: app.description || "" });
    }
    for (const command of options.commands || []) {
      if (!searchRecordVisible(command)) continue;
      add({ kind: "command", id: command.id, title: command.title, icon: command.icon, sub: command.sub || "Команда", categories: [],
        text: [command.title, command.text, command.sub].join(" "), previewText: command.text || command.sub || "" });
    }
    const projectKey = (desktopId, domain, itemId, id) => id ? JSON.stringify([desktopId, domain, itemId || "", id]) : "";
    const visibleTaskStore = data => {
      const projects = Array.isArray(data.taskProjects) ? data.taskProjects : Array.isArray(data.projects) ? data.projects : [];
      const hiddenIds = new Set(projects.filter(project => !searchRecordVisible(project)).map(project => project.id));
      return { ...data, taskProjects: projects.filter(searchRecordVisible), tasks: (data.tasks || []).filter(task => searchRecordVisible(task) && !hiddenIds.has(task.projectId)) };
    };
    function collectTasks(data, desktopId, itemId = "", path = "") {
      const projects = Array.isArray(data.taskProjects) ? data.taskProjects : Array.isArray(data.projects) ? data.projects : [];
      const projectMap = new Map(projects.map(project => [project.id, project]));
      for (const project of projects.filter(searchRecordVisible)) {
        add({ kind: "project", id: project.id, projectType: "tasks", desktopId, itemId, title: project.name,
          projectId: project.id, projectName: project.name, projectKey: projectKey(desktopId, "tasks", itemId, project.id),
          path, icon: "🗂️", sub: ["Проект задач", desktopName(desktopId), path].filter(Boolean).join(" · "), categories: ["projects"],
          text: project.description || "", previewText: project.description || "" }, project);
      }
      for (const task of (data.tasks || []).filter(searchRecordVisible)) {
        const project = projectMap.get(task.projectId);
        if (project && !searchRecordVisible(project)) continue;
        const name = project?.name || adapters.defaultTaskProjectName || "Основной";
        const status = typeof adapters.statusName === "function" ? adapters.statusName(task.status) : task.status;
        add({ kind: "task", id: task.id, desktopId, itemId, projectId: task.projectId || "", projectName: name,
          projectKey: projectKey(desktopId, "tasks", itemId, task.projectId), title: task.title, status: task.status,
          completed: task.status === "done", icon: "✅", path, sub: ["Задача", status, name, desktopName(desktopId), path].filter(Boolean).join(" · "),
          categories: ["tasks"], text: taskSearchText(task, adapters), previewText: taskSearchSnippetText(task) }, task);
      }
    }
    for (const item of Object.values(fs)) {
      if (!searchableFsAncestry(item, fs, options.trashRoot, adapters)) continue;
      const desktopId = itemDesktopIdForSearch(item, adapters);
      if (Array.isArray(options.stores) && options.stores.length && !activeDesktops.has(desktopId)) continue;
      const path = itemPathForSearch(item, adapters);
      const description = typeof adapters.itemDescription === "function" ? adapters.itemDescription(item) : "";
      const textItem = item.type === "tasklist" ? visibleTaskStore(item) : item;
      add({ kind: "item", id: item.id, desktopId, title: item.name, path, categories: itemSearchCategories(item),
        icon: typeof adapters.itemIcon === "function" ? adapters.itemIcon(item) : "📄",
        sub: [typeof adapters.itemResultSubtype === "function" ? adapters.itemResultSubtype(item) : item.type, desktopName(desktopId), path].filter(Boolean).join(" · "),
        text: itemSearchText(textItem, adapters), previewText: itemSearchSnippetSource(textItem, adapters) || description }, item);
      if (item.type === "tasklist") collectTasks(item, desktopId, item.id, [path, item.name].filter(Boolean).join(" / "));
    }
    for (const store of stores) {
      const data = store.data || {}, desktopId = store.desktopId;
      collectTasks(data, desktopId);
      for (const event of (data.events || []).filter(searchRecordVisible)) {
        const category = typeof adapters.categoryName === "function" ? adapters.categoryName(event.category) : event.category;
        add({ kind: "calendar", id: event.id, desktopId, title: event.title || "Событие", icon: "📅", categories: ["calendar"],
          date: searchDocumentDate(event.date), sub: ["Событие", event.date, event.start, desktopName(desktopId)].filter(Boolean).join(" · "),
          text: [event.description, event.location, event.date, event.start, event.end, category, event.repeat, event.reminder].join(" "),
          previewText: [event.description, event.location].filter(Boolean).join(" · ") }, event);
      }
      const library = data.library || {};
      for (const link of (library.entries || []).filter(searchRecordVisible)) {
        const category = (library.categories || []).find(item => item.id === link.categoryId);
        if (category && !searchRecordVisible(category)) continue;
        add({ kind: "link", id: link.id, desktopId, title: link.name, target: link.target, address: link.target || "", icon: "🔗", categories: ["links"],
          path: category?.name || "", sub: ["Ссылка", category?.name, desktopName(desktopId)].filter(Boolean).join(" · "),
          text: [link.description, link.target].filter(Boolean).join(" "), previewText: link.description || link.target || "" }, link);
      }
      const prompts = data.promptLibrary || {}, promptProjects = new Map((prompts.projects || []).map(project => [project.id, project]));
      for (const project of (prompts.projects || []).filter(searchRecordVisible)) {
        add({ kind: "project", id: project.id, desktopId, projectType: "prompts", title: project.name, projectId: project.id, projectName: project.name,
          projectKey: projectKey(desktopId, "prompts", "", project.id), icon: "🗂️", categories: ["projects"],
          sub: `Проект промптов · ${desktopName(desktopId)}`, text: "", previewText: "" }, project);
      }
      for (const prompt of (prompts.entries || []).filter(searchRecordVisible)) {
        const project = promptProjects.get(prompt.projectId);
        const category = (prompts.categories || []).find(item => item.id === prompt.categoryId);
        if ((project && !searchRecordVisible(project)) || (category && !searchRecordVisible(category))) continue;
        add({ kind: "prompt", id: prompt.id, desktopId, title: prompt.name, projectId: prompt.projectId || "", projectName: project?.name || "",
          projectKey: projectKey(desktopId, "prompts", "", prompt.projectId), path: category?.name || "", icon: "💬", categories: ["prompts"],
          sub: ["Промпт", project?.name, category?.name, desktopName(desktopId)].filter(Boolean).join(" · "),
          text: prompt.text || "", previewText: prompt.text || "" }, prompt);
      }
      for (const entry of (data.timeTracking?.entries || []).filter(searchRecordVisible)) {
        const project = (data.taskProjects || []).find(project => project.id === entry.projectId);
        if (project && !searchRecordVisible(project)) continue;
        add({ kind: "time", id: entry.id, desktopId, title: entry.title, projectId: entry.projectId || "", projectName: entry.projectName || project?.name || "",
          projectKey: projectKey(desktopId, "tasks", "", entry.projectId), taskId: entry.taskId || "", icon: "⏱️", categories: ["time"],
          date: searchDocumentDate(entry.finishedAt ?? entry.createdAt), sub: ["Занятие", entry.projectName, desktopName(desktopId)].filter(Boolean).join(" · "),
          text: entry.notes || "", previewText: entry.notes || "" }, entry);
      }
      for (const notification of (data.notifications || []).filter(searchRecordVisible)) {
        add({ kind: "notification", id: notification.id, desktopId, title: notification.title || "Уведомление", icon: "🔔", categories: [],
          sub: `Уведомление · ${desktopName(desktopId)}`, text: notification.text || "", previewText: notification.text || "",
          date: searchDocumentDate(notification.time) }, notification);
      }
    }
    return documents;
  }

  function searchRecordVisible(record) {
    return Boolean(record) && record.deletedAt == null && record.archivedAt == null && !record.archived && !record.hidden && !record.hiddenInExplorer && !record.hiddenFromDesktop;
  }

  function searchFsRecordVisible(record) {
    // Older active FS records may use zero. Time entries use a
    // different tombstone contract and keep the strict check above.
    return record?.deletedAt === 0 ? searchRecordVisible({ ...record, deletedAt: null }) : searchRecordVisible(record);
  }

  function searchableFsAncestry(item, fs, trashRoot, options) {
    const visited = new Set();
    let current = item;
    while (current) {
      if (!searchFsRecordVisible(current) || current.id === trashRoot || current.parent === trashRoot || (current === item && current.systemRole) || visited.has(current)) return false;
      visited.add(current);
      if (typeof options.isDesktopRoot === "function" ? options.isDesktopRoot(current.parent) : current.parent === defaultDesktopId(options)) return !fs[current.parent] || searchFsRecordVisible(fs[current.parent]);
      if (typeof options.isExplorerRoot === "function" && options.isExplorerRoot(current.parent)) return searchFsRecordVisible(fs[current.parent] || {});
      current = fs[current.parent];
    }
    return false;
  }

  function searchDocumentDate(value) {
    if (value == null || value === "") return "";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(`${value}T12:00:00`);
      return Number.isFinite(+date) && date.getFullYear() === +value.slice(0, 4) && date.getMonth() + 1 === +value.slice(5, 7) && date.getDate() === +value.slice(8, 10) ? value : "";
    }
    if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "number" && value < 0)) return "";
    const date = new Date(value);
    return Number.isFinite(+date) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "";
  }

  function convertSearchLayout(query) {
    const english = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.", russian = "ёйцукенгшщзхъфывапролджэячсмитьбю";
    const toRussian = /[a-z]/i.test(query) && !/[а-яё]/i.test(query);
    const from = toRussian ? english : russian, to = toRussian ? russian : english;
    return String(query).split("").map(char => { const index = from.indexOf(char.toLowerCase()); return index < 0 ? char : to[index]; }).join("");
  }

  // One insertion/deletion/replacement or adjacent transposition; never fuzzy body matching.
  function singleSearchEdit(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let index = 0;
    while (index < a.length && a[index] === b[index]) index++;
    if (index === a.length) return b.length === a.length + 1;
    if (a.length === b.length) return a.slice(index + 1) === b.slice(index + 1) || (a[index] === b[index + 1] && a[index + 1] === b[index] && a.slice(index + 2) === b.slice(index + 2));
    return a.length > b.length ? a.slice(index + 1) === b.slice(index) : a.slice(index) === b.slice(index + 1);
  }

  function createSearchIndex() {
    let rows = [], vocabulary = [];
    const stats = { documentCount: 0, rebuildCount: 0, queryCount: 0, normalizationCount: 0 };
    const titleTokens = value => value.match(/[\p{L}\p{N}]+/gu) || [];
    function update(documents = []) {
      const seen = new Set(), words = new Set();
      rows = (Array.isArray(documents) ? documents : []).filter(document => document?.key && !seen.has(document.key) && seen.add(document.key)).map(document => {
        const copy = { ...document, categories: [...(document.categories || [])] };
        const fields = Object.fromEntries(["title", "text", "previewText", "address", "path", "projectName", "desktopName"].map(field => [field, searchNormalize(copy[field])]));
        const tokens = titleTokens(fields.title);
        tokens.forEach(token => { if (token.length >= 4 && words.size < 5000) words.add(token); });
        stats.normalizationCount++;
        return { document: copy, fields, tokens, haystack: Object.values(fields).join(" ") };
      });
      vocabulary = [...words]; stats.documentCount = rows.length; stats.rebuildCount++;
      return getStats();
    }
    function getStats() { return { ...stats }; }
    function search(query = "", options = {}) {
      stats.queryCount++;
      const rawQuery = String(query || "").trim(), q = searchNormalize(rawQuery);
      const queryTokens = new Map();
      const matches = (text, needle) => {
        if (!needle || text.includes(needle)) return true;
        if (!queryTokens.has(needle)) queryTokens.set(needle, searchTerms(needle));
        const tokens = queryTokens.get(needle);
        return tokens.length > 0 && tokens.every(term => text.includes(term));
      };
      const allowedKeys = Array.isArray(options.keys) ? new Set(options.keys.filter(key => typeof key === "string")) : null;
      const available = rows.filter(row => {
        const doc = row.document;
        return (!allowedKeys || allowedKeys.has(doc.key))
          && (options.scope === "all" || !options.currentDesktopId || !doc.desktopId || doc.desktopId === options.currentDesktopId)
          && searchFiltersAllowCategories(doc.categories, options.filters)
          && (!options.projectId || doc.projectKey === options.projectId)
          && (!options.dateFrom || (doc.date && doc.date >= options.dateFrom))
          && (!options.dateTo || (doc.date && doc.date <= options.dateTo));
      });
      let chosen = available.filter(row => matches(row.haystack, q)), matchType = "exact", suggestion = null, effective = q;
      if (!chosen.length && q.length >= 2 && q.length <= 100) {
        const converted = searchNormalize(convertSearchLayout(rawQuery));
        if (converted !== q) {
          const layout = available.filter(row => matches(row.haystack, converted));
          if (layout.length) { chosen = layout; matchType = "layout"; effective = converted; suggestion = { query: converted, kind: "layout" }; }
        }
        const tokens = titleTokens(q);
        if (!chosen.length && q.length <= 80 && tokens.length > 0 && tokens.length <= 6 && tokens.every(token => token.length >= 4)) {
          // Bound correction work to the vocabulary built during update, not the full text corpus.
          const corrections = tokens.map(token => vocabulary.includes(token) ? [token] : vocabulary.filter(word => singleSearchEdit(token, word)).slice(0, 8));
          if (corrections.every(words => words.length)) {
            chosen = available.filter(row => corrections.every(words => row.tokens.some(token => words.includes(token))));
            if (chosen.length) { matchType = "typo"; effective = corrections.map((words, i) => chosen[0].tokens.find(token => words.includes(token)) || tokens[i]).join(" "); suggestion = { query: effective, kind: "typo" }; }
          }
        }
      }
      const terms = searchTerms(effective), counts = Object.fromEntries(SEARCH_FILTER_IDS.map(id => [id, 0]));
      const results = chosen.map(row => {
        const { document, fields } = row;
        document.categories.forEach(category => { if (Object.hasOwn(counts, category)) counts[category]++; });
        const titleHit = matches(fields.title, effective);
        const matchReason = !effective ? "Материал" : titleHit ? "Название" : matches(fields.address, effective) ? "Адрес" : matches(fields.previewText, effective) || matches(fields.text, effective) ? "В тексте" : matches(fields.projectName, effective) ? "Проект" : matches(fields.path, effective) ? "Путь" : matches(fields.desktopName, effective) ? "Рабочий стол" : "В тексте";
        const score = (fields.title === effective && effective ? 300 : fields.title.startsWith(effective) && effective ? 220 : titleHit && effective ? 180 : 60)
          + terms.filter(term => fields.title.includes(term)).length * 12 + ({ command: 30, app: 20, project: 10 }[document.kind] || 0);
        return { ...document, categories: [...document.categories], query: rawQuery, matchType, matchReason, score, snippet: searchSnippet(document.previewText, effective, 150, fields.previewText) };
      });
      const limit = options.limit == null ? 50 : Math.max(0, Math.min(500, Math.floor(Number(options.limit) || 0)));
      return { results: sortSearchResults(results, limit), total: results.length, counts, suggestion, query: rawQuery };
    }
    return Object.freeze({ update, search, getStats });
  }

  function searchSnippet(text = "", query = "", max = 150, normalizedText) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const q = searchNormalize(query);
    const normalized = normalizedText ?? searchNormalize(clean);
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
    const source = String(text ?? "");
    const needles = searchHighlightNeedles(query);
    if (!needles.length) return escapeHtml(source);
    const patterns = needles.map(needle => escapeRegExp(needle).replace(/[её]/gi, "[её]").replace(/\s+/g, "\\s+"));
    const rx = new RegExp(patterns.join("|"), "gi");
    let last = 0;
    let html = "";
    for (const match of source.matchAll(rx)) {
      html += escapeHtml(source.slice(last, match.index)) + `<mark class="search-hit">${escapeHtml(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
    return html + escapeHtml(source.slice(last));
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
    buildSearchDocuments,
    createSearchIndex,
    searchSnippet,
    escapeRegExp,
    searchHighlightNeedles,
    highlightSearchText,
    firstSearchIndex,
    findTableSearchHit
  });
})();
