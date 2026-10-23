(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const searchUtils = window.ZETER_SEARCH_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS search UI utils require core utils.");
  if (!searchUtils) throw new Error("ZeTer OS search UI utils require search utils.");

  const { $, $$, escapeHtml } = coreUtils;
  const {
    SEARCH_FILTERS,
    SEARCH_FILTER_IDS,
    SEARCH_FILTER_LABELS,
    normalizeSearchFilterSelection,
    normalizeSearchSettings,
    activeSearchFilterIds,
    searchAllFiltersActive,
    toggleSearchFilterSelection,
    searchFiltersAllowCategories,
    searchNormalize,
    searchCandidateMatches,
    escapeRegExp,
    searchHighlightNeedles,
    highlightSearchText,
    firstSearchIndex,
    buildCombinedSearchResults
  } = searchUtils;
  const safeAttr = escapeHtml;

  const APP_SEARCH_EXTRA = Object.freeze({
    settings: "настройки параметры обои данные ос скачать загрузить сохраненные автосохранение папка горячие клавиши яркость система открыть настройки безопасность центр безопасности данных бэкап целостность восстановление",
    appcenter: "приложении приложения установить удалить открыть ярлык рабочий стол",
    calendar: "календарь события дата день неделя месяц список напоминания встреча",
    tasks: "задачи задача статус приоритет тег работа готово нужно сделать создать задачу",
    notes: "заметки заметка стикер блокнот текст новая заметка",
    editor: "текстовый редактор документ файл печать новый файл",
    markdown: "markdown маркдаун студио редактор предпросмотр документ",
    photos: "фото изображения картинки просмотр найти фото",
    calculator: "калькулятор расчёт посчитать",
    monitor: "монитор системы память fps хранилище производительность",
    help: "справка помощь инструкция"
  });

  const SEARCH_COMMAND_DEFINITIONS = Object.freeze([
    Object.freeze({ id: "create-task", icon: "✅", title: "Создать задачу", sub: "Быстрая команда · откроет форму новой задачи", text: "создать задачу новая задача добавить задачу todo task" }),
    Object.freeze({ id: "open-settings", icon: "⚙️", title: "Открыть настройки", sub: "Быстрая команда · настройки ZeTer OS", text: "открыть настройки настройки параметры система settings" }),
    Object.freeze({ id: "new-note", icon: "🗒️", title: "Новая заметка", sub: "Быстрая команда · создаст заметку на рабочем столе", text: "новая заметка создать заметку заметка note notes" }),
    Object.freeze({ id: "find-photo", icon: "🖼️", title: "Найти фото", sub: "Быстрая команда · включит фильтр изображений", text: "найти фото найти картинку изображения фотографии image photo pictures" })
  ]);

  function searchShellHTML() {
    return `
      <div class="global-search-input"><span aria-hidden="true">⌕</span><input aria-label="Поиск в ZeTer OS" placeholder="Файлы, задачи, ссылки и другие материалы" autofocus></div>
      <div class="global-search-filters"></div>
      <div class="global-search-results"></div>`;
  }

  function searchAppEmptyHTML() {
    return `<p class="muted search-empty">Ничего не найдено на этом рабочем столе. Попробуй другое слово или отключи часть фильтров.</p>`;
  }

  function globalSearchEmptyHTML() {
    return `<p class="muted search-empty">Введите запрос, команду или выберите другой фильтр. Поиск идёт только по текущему рабочему столу.</p>`;
  }

  function searchFiltersHTML(filters = [], active = [], allActive = false, counts = null) {
    const activeIds = Array.isArray(active) ? active : [];
    const chips = filters.map(filter => {
      const selected = allActive || activeIds.includes(filter.id);
      return `<button type="button" class="search-filter-chip ${selected ? "active" : ""}" aria-pressed="${selected}" data-search-filter="${safeAttr(filter.id)}">${escapeHtml(filter.icon)} ${escapeHtml(filter.label)}${counts && Number.isFinite(counts[filter.id]) ? ` <span class="search-filter-count">${counts[filter.id]}</span>` : ""}</button>`;
    }).join("");
    return `<button type="button" class="search-filter-chip search-filter-all ${allActive ? "active" : ""}" aria-pressed="${allActive}" data-search-filter="all">Все типы</button>${chips}`;
  }

  function appSearchText(id, app) {
    return `${id} ${app?.name || ""} ${APP_SEARCH_EXTRA[id] || ""}`;
  }

  function searchCommandDefinitions() {
    return SEARCH_COMMAND_DEFINITIONS.map(command => ({ ...command }));
  }

  function itemResultSubtype(item = {}) {
    if (item.type === "folder") return "Папка";
    if (item.type === "note") return "Заметка";
    if (item.type === "table") return "Таблица";
    if (item.type === "tasklist") return "Список задач";
    if (["image", "paint"].includes(item.type)) return "Изображение";
    if (item.type === "app") return "Ярлык приложения";
    if (item.type === "markdown") return "Markdown";
    return "Файл";
  }

  function searchResultHTML(result = {}) {
    const categoryLabels = (result.categories || [])
      .filter(id => SEARCH_FILTER_LABELS[id])
      .map(id => `<em>${escapeHtml(SEARCH_FILTER_LABELS[id])}</em>`)
      .join("");
    const snippet = result.snippet ? `<span class="search-snippet">${highlightSearchText(result.snippet, result.query)}</span>` : "";
    const action = result.kind === "command" ? "Выполнить" : "Открыть";
    // Item icons come from itemIconForApps and its validated SVG/image builders.
    // Other result icons are plain text; user titles/snippets stay escaped below.
    const icon = result.kind === "item" ? (result.icon || "") : escapeHtml(result.icon);

    return `<button type="button" class="search-result ${result.kind === "command" ? "search-command-result" : ""}" data-search-kind="${safeAttr(result.kind)}" data-search-key="${safeAttr(result.key || "")}" data-id="${safeAttr(result.id)}" data-desktop-id="${safeAttr(result.desktopId || "")}" data-item-id="${safeAttr(result.itemId || "")}" data-project-id="${safeAttr(result.projectId || "")}" data-project-type="${safeAttr(result.projectType || "")}" data-query="${safeAttr(result.query || "")}"><i aria-hidden="true">${icon}</i><span><b>${highlightSearchText(result.title, result.query)}</b><br><small>${escapeHtml(result.sub)}</small>${snippet}<span class="search-category-tags">${categoryLabels}</span>${result.matchReason ? `<span class="search-match-reason">${escapeHtml(result.matchReason)}</span>` : ""}</span><small>${action}</small></button>`;
  }

  function searchResultsListHTML(results = [], emptyHTML = "") {
    return results.map(searchResultHTML).join("") || emptyHTML;
  }

  function searchResultCountLabel(count) {
    const number = Math.abs(Number(count) || 0), last = number % 10, hundred = number % 100;
    return `${number} ${hundred >= 11 && hundred <= 14 ? "результатов" : last === 1 ? "результат" : last >= 2 && last <= 4 ? "результата" : "результатов"}`;
  }

  function globalSearchResultsHTML(filtersHTML = "", results = []) {
    return `<div class="global-search-filters">${filtersHTML}</div>${searchResultsListHTML(results, globalSearchEmptyHTML())}`;
  }

  function searchPanelAction(target) {
    const filter = target?.closest?.("[data-search-filter]");
    if (filter) return { type: "filter", filterId: filter.dataset.searchFilter || "" };
    const result = target?.closest?.("[data-search-kind]");
    if (result) return { type: "result", element: result };
    return null;
  }

  function searchPanelKeyAction(event) {
    if (event?.key !== "Enter") return null;
    return { type: "open-first" };
  }

  function renderSearchAppResults(root, options = {}) {
    const filters = $(".global-search-filters", root);
    const results = $(".global-search-results", root);
    if (filters) filters.innerHTML = options.filtersHTML || "";
    if (results) results.innerHTML = searchResultsListHTML(options.results || [], options.emptyHTML || searchAppEmptyHTML());
  }

  function renderGlobalSearchResults(root, options = {}) {
    if (!root) return;
    root.innerHTML = globalSearchResultsHTML(options.filtersHTML || "", options.results || []);
  }

  function firstSearchResultElement(root) {
    return root?.querySelector?.("[data-search-kind]") || null;
  }

  function moveSearchResultFocus(event, root, input) {
    if (event.isComposing || !["ArrowDown", "ArrowUp"].includes(event.key)) return false;
    const results = Array.from(root?.querySelectorAll("[data-search-kind]") || []);
    if (!results.length) return false;
    const index = results.indexOf(event.target?.closest?.("[data-search-kind]"));
    if (event.target !== input && index < 0) return false;
    event.preventDefault();
    const next = index < 0 ? (event.key === "ArrowDown" ? results[0] : results.at(-1))
      : results[index + (event.key === "ArrowDown" ? 1 : -1)] || input;
    next?.focus({ preventScroll: true });
    if (next && next !== input) {
      // scrollIntoView also scrolls overflow:hidden desktop/window ancestors.
      // Search owns only its results viewport, even in a short window.
      const viewport = next.closest?.(".search-result-list") || root;
      const bounds = viewport?.getBoundingClientRect?.();
      const row = next.getBoundingClientRect?.();
      if (bounds && row) {
        if (row.top < bounds.top) viewport.scrollTop += row.top - bounds.top;
        else if (row.bottom > bounds.bottom) viewport.scrollTop += row.bottom - bounds.bottom;
      }
    }
    return true;
  }

  function searchAppElement(options = {}) {
    const {
      getResults = () => [],
      getFiltersHTML = () => "",
      handleClick = () => false,
      openFirst = () => {},
      emptyHTML = searchAppEmptyHTML,
      focus = true
    } = options;
    const root = document.createElement("div");
    root.className = "app-shell search-app-shell";
    root.innerHTML = searchShellHTML();
    const input = $("input", root);
    const draw = () => {
      const query = input?.value || "";
      renderSearchAppResults(root, {
        filtersHTML: getFiltersHTML(),
        results: getResults(query),
        emptyHTML: typeof emptyHTML === "function" ? emptyHTML() : emptyHTML
      });
    };
    root.addEventListener("click", event => handleClick(event, () => input?.value || "", draw));
    root.addEventListener("keydown", event => moveSearchResultFocus(event, root, input));
    input?.addEventListener("input", draw);
    input?.addEventListener("keydown", event => {
      if (!event.isComposing && searchPanelKeyAction(event)?.type === "open-first") {
        event.preventDefault();
        openFirst(firstSearchResultElement(root));
      }
    });
    draw();
    if (focus && input) setTimeout(() => input.focus({ preventScroll: true }), 0);
    return root;
  }

  function renderGlobalSearchPanel(root, query = "", options = {}) {
    if (!root) return;
    const {
      getResults = () => [],
      getFiltersHTML = () => "",
      getQuery = () => query,
      handleClick = () => false
    } = options;
    renderGlobalSearchResults(root, {
      filtersHTML: getFiltersHTML(),
      results: getResults(query)
    });
    root.onclick = event => handleClick(event, getQuery, () => renderGlobalSearchPanel(root, getQuery(), options));
  }

  function createSearchResultNavigator(integration = {}) {
    const {
      closeFloating = () => {},
      openApp = () => {},
      createItem = () => "",
      getCurrentDesktopId = () => "",
      desktopExists = () => false,
      switchDesktop = () => {},
      schedule = callback => setTimeout(callback, 0),
      getItem = () => null,
      openItem = () => {},
      setSearchFilters = () => {},
      openGlobalSearch = () => {},
      renderGlobalSearch = () => {},
      toast = () => {},
      taskNavigator = null,
      getCalendarEvent = () => null,
      setCalendarEventDate = () => {},
      toggleNotifications = () => {}
    } = integration;

    const runForDesktop = (desktopId, callback, element) => {
      const run = () => {
        if (desktopId && (!desktopExists(desktopId) || desktopId !== getCurrentDesktopId())) throw new Error("Рабочий стол изменён. Открытие отменено; выберите результат ещё раз.");
        integration.validateResult?.(element);
        return callback();
      };
      if (desktopId && desktopId !== getCurrentDesktopId()) {
        if (!desktopExists(desktopId)) throw new Error("Рабочий стол больше недоступен.");
        switchDesktop(desktopId);
        return new Promise((resolve, reject) => {
          schedule(() => { try { resolve(run()); } catch (error) { reject(error); } });
        });
      }
      return run();
    };

    function runCommand(id) {
      if (id === "create-task") return openApp("taskedit", { mode: "create" });
      if (id === "open-settings") return openApp("settings");
      if (id === "new-note") {
        const noteId = createItem("note", "Новая заметка", getCurrentDesktopId(), 120, 120, { content: "", richContent: "" });
        return openApp("editor", { itemId: noteId });
      }
      if (id === "find-photo") {
        setSearchFilters(["images"]);
        openGlobalSearch("", true);
        renderGlobalSearch("");
        return toast("Фильтр включён", "Показаны изображения и фото в ZeTer OS.");
      }
      return undefined;
    }

    function openItemResult(id, query = "") {
      const item = getItem(id);
      if (!item || item.deletedAt || item.hiddenInExplorer || item.hiddenFromDesktop) throw new Error("Материал удалён или больше недоступен.");
      if (item.type === "markdown") return openApp("markdown", { itemId: item.id, searchQuery: query });
      if (item.type === "table") return openApp("table", { itemId: item.id, searchQuery: query });
      if (["text", "note"].includes(item.type)) return openApp("editor", { itemId: item.id, searchQuery: query });
      return openItem(id);
    }

    function openTaskResult(element) {
      return taskNavigator?.openTaskTarget?.({
        taskId: element.dataset.id,
        desktopId: element.dataset.desktopId || getCurrentDesktopId(),
        taskListItemId: element.dataset.itemId || "",
        projectId: element.dataset.projectId || "",
        saveOptions: { skipExternalBackup: true, silentStorageError: true },
        focusClear: "start",
        onMissing: () => toast("Список задач не найден", "Он мог быть удалён или перемещён.")
      });
    }

    function openCalendarResult(element) {
      const eventId = element.dataset.id;
      const desktopId = element.dataset.desktopId || getCurrentDesktopId();
      return runForDesktop(desktopId, () => {
        const event = getCalendarEvent(eventId);
        if (!event) throw new Error("Событие удалено или больше недоступно.");
        setCalendarEventDate(event.date);
        return openApp("calendar");
      }, element);
    }

    function openResult(element) {
      if (!element) return undefined;
      const kind = element.dataset.searchKind;
      const id = element.dataset.id;
      const query = element.dataset.query || "";
      closeFloating();
      if (kind === "command") return runCommand(id);
      if (kind === "app") return openApp(id);
      if (kind === "item") {
        return runForDesktop(element.dataset.desktopId || "", () => openItemResult(id, query), element);
      }
      if (kind === "task") return runForDesktop(element.dataset.desktopId || "", () => openTaskResult(element), element);
      if (kind === "tasks") return openApp("tasks");
      if (kind === "calendar") return openCalendarResult(element);
      if (kind === "notification") return toggleNotifications();
      if (typeof integration.openExtendedResult === "function") return integration.openExtendedResult(element);
      return undefined;
    }

    function openFirst(root) {
      return openResult(firstSearchResultElement(root));
    }

    return Object.freeze({ runCommand, openItemResult, openTaskResult, openCalendarResult, openResult, openFirst });
  }

  function createSearchController(integration = {}) {
    const {
      document,
      getState = () => ({}),
      getFs = () => ({}),
      getCurrentDesktopId = () => "desktop",
      getWorkspace = () => ({}),
      apps = {},
      trashRoot = "trash",
      resultLimit = 80,
      isDesktopRoot = () => false,
      isExplorerRoot = () => false,
      normalizeTaskStore = () => {},
      statusName = value => value,
      priorityName = value => value,
      taskReminderLabel = value => value,
      taskReminderRepeatLabel = value => value,
      htmlPlainText = value => value,
      itemDescription = () => "",
      itemIcon = () => "",
      desktopName = value => value,
      categoryName = value => value,
      formatDate = value => value,
      defaultTaskProjectName = "Проект",
      saveState = () => {},
      openResult = () => {},
      getDesktopStores = null,
      getRevision = null,
      runResultAction = null,
      saveSearchSettings = null
    } = integration;

    const panels = new Map();
    const index = typeof searchUtils.createSearchIndex === "function" ? searchUtils.createSearchIndex() : null;
    let documents = [];
    let documentsByKey = new Map();
    let indexedState, indexedFs, indexedRevision, indexedDesktop;
    let dirty = true;
    let normalizedSettings = null;
    let settingsSaveQueue = Promise.resolve();
    let settingsEditRevision = 0;
    const settingsFieldRevisions = new Map();
    const settingsConfirmedValues = new WeakMap();
    const groupLabels = { item: "Файлы и папки", task: "Задачи", project: "Проекты", link: "Ссылки", prompt: "Промпты", time: "Занятия", calendar: "События", app: "Приложения", command: "Команды" };

    function settings() {
      const state = getState();
      if (state.searchSettings !== normalizedSettings) {
        state.searchSettings = normalizeSearchSettings(state.searchSettings);
        normalizedSettings = state.searchSettings;
      }
      return state.searchSettings;
    }

    function failed(result) {
      return result === false || result?.ok === false || result?.success === false || result?.saved === false || result?.skipped;
    }

    function announce(message, root = null) {
      for (const [panelRoot, panel] of panels) {
        if (root && root !== panelRoot) continue;
        panel.message = message;
        const status = panelRoot.querySelector(".search-status");
        if (status) status.textContent = message;
      }
    }

    // Serialize only our bounded preference updates. Failure restores only fields
    // still owned by this update; unrelated edits and replacement state survive.
    function persistSettings(update) {
      const ownerState = getState();
      const apply = patch => {
        const target = settings();
        let confirmed = settingsConfirmedValues.get(target);
        if (!confirmed) { confirmed = new Map(); settingsConfirmedValues.set(target, confirmed); }
        for (const key of Object.keys(patch)) if (!confirmed.has(key)) confirmed.set(key, target[key]);
        const revision = ++settingsEditRevision;
        for (const key of Object.keys(patch)) settingsFieldRevisions.set(key, revision);
        Object.assign(target, patch);
        return { target, patch, confirmed, revision };
      };
      // Controls publish their latest draft immediately. The queued write must
      // save that live choice rather than replay an obsolete object patch.
      const prepared = typeof update === "function" ? null : apply(update);
      settingsSaveQueue = settingsSaveQueue.then(async () => {
        if (getState() !== ownerState) return false;
        const { target, patch, confirmed, revision } = prepared || apply(update(settings()));
        const submitted = new Map([...confirmed.keys()].map(key => [key, target[key]]));
        try {
          const result = typeof saveSearchSettings === "function" ? await saveSearchSettings(ownerState, target)
            : await saveState({ skipExternalBackup: true, silentStorageError: true });
          if (failed(result)) throw new Error("Search preferences were not saved");
          for (const [key, value] of submitted) confirmed.set(key, result?.searchSettings ? result.searchSettings[key] : value);
          return true;
        } catch {
          if (getState() === ownerState && ownerState.searchSettings === target) {
            for (const key of Object.keys(patch)) {
              if (settingsFieldRevisions.get(key) === revision && target[key] === patch[key]) target[key] = confirmed.get(key);
            }
          }
          redrawAll();
          announce("Не удалось сохранить настройки поиска. Повторите действие.");
          return false;
        }
      });
      return settingsSaveQueue;
    }

    function activeFilters() {
      return activeSearchFilterIds(settings());
    }

    function allFiltersActive(filters = activeFilters()) {
      return searchAllFiltersActive(filters);
    }

    function setFilters(filters = SEARCH_FILTER_IDS, options = {}) {
      const patch = { filters: normalizeSearchFilterSelection(filters) };
      if (options.save !== false) return persistSettings(patch);
      settingsFieldRevisions.set("filters", ++settingsEditRevision);
      settings().filters = patch.filters;
      settingsConfirmedValues.get(settings())?.delete("filters");
      return Promise.resolve(true);
    }

    function toggleFilter(filterId) {
      setFilters(toggleSearchFilterSelection(activeFilters(), filterId));
    }

    function filtersHTML(counts = null) {
      const active = activeFilters();
      return searchFiltersHTML(SEARCH_FILTERS, active, allFiltersActive(active), counts);
    }

    function renderGlobal(query = "") {
      const root = document.querySelector("#global-search-results");
      if (!root) return;
      attachPanel(root, document.querySelector("#global-search-field"));
      drawPanel(root, query);
    }

    function handleClick(event, getQuery, redraw) {
      const action = searchPanelAction(event.target);
      if (action?.type === "filter") {
        event.preventDefault();
        if (action.filterId === "all") setFilters(SEARCH_FILTER_IDS);
        else toggleFilter(action.filterId);
        redraw?.();
        renderGlobal(document.querySelector("#global-search-field")?.value || getQuery?.() || "");
        return true;
      }
      if (action?.type === "result") {
        openResultElement(action.element);
        return true;
      }
      return false;
    }

    function filtersAllow(categories = []) {
      return searchFiltersAllowCategories(categories, activeFilters());
    }

    function builderOptions(extra = {}) {
      return {
        fs: getFs(),
        defaultDesktopId: getCurrentDesktopId,
        currentDesktopId: getCurrentDesktopId,
        isDesktopRoot,
        isExplorerRoot,
        normalizeTaskStore,
        statusName,
        priorityName,
        taskReminderLabel,
        taskReminderRepeatLabel,
        htmlPlainText,
        itemDescription,
        itemResultSubtype,
        itemIcon,
        desktopName,
        categoryName,
        formatDate,
        defaultTaskProjectName,
        filtersAllow,
        ...extra
      };
    }

    function workspaceStores() {
      if (typeof getDesktopStores === "function") return getDesktopStores();
      const desktopId = getCurrentDesktopId();
      return [{ desktopId, title: desktopName(desktopId), data: getWorkspace() }];
    }

    function legacyResults(query = "", options = {}) {
      return buildCombinedSearchResults(query, {
        apps,
        fs: getFs(),
        stores: workspaceStores(),
        commands: searchCommandDefinitions(),
        trashRoot,
        limit: resultLimit,
        allFiltersActive: options.ignoreFilters || allFiltersActive(),
        appSearchText,
        builderOptions: builderOptions(options.ignoreFilters ? { filtersAllow: () => true } : {})
      });
    }

    function invalidate() { dirty = true; }

    function ensureIndex() {
      if (!index) return;
      const state = getState(), fs = getFs(), revision = typeof getRevision === "function" ? getRevision() : null;
      const desktop = getCurrentDesktopId();
      if (!dirty && typeof getRevision === "function" && state === indexedState && fs === indexedFs && revision === indexedRevision && desktop === indexedDesktop) return;
      documents = searchUtils.buildSearchDocuments({
        apps, fs, stores: workspaceStores(), commands: searchCommandDefinitions(), trashRoot,
        appSearchText, builderOptions: builderOptions({ filtersAllow: () => true })
      });
      index.update(documents);
      documentsByKey = new Map(documents.map(result => [result.key, result]));
      indexedState = state; indexedFs = fs; indexedRevision = revision; indexedDesktop = desktop; dirty = false;
    }

    function search(query = "", options = {}) {
      ensureIndex();
      if (!index) {
        const found = legacyResults(query, options);
        return { results: found, total: found.length, counts: {}, suggestion: "", query };
      }
      const preferences = settings();
      if (!options.ignoreFilters && preferences.projectId && !documents.some(result =>
        result.kind === "project" && result.projectKey === preferences.projectId &&
        (preferences.scope === "all" || result.desktopId === getCurrentDesktopId()))) {
        // Reconcile an unavailable selection like normalized settings. Do not
        // start writes from a query or retry a stale persisted key on failure.
        preferences.projectId = "";
        settingsFieldRevisions.set("projectId", ++settingsEditRevision);
        settingsConfirmedValues.get(preferences)?.set("projectId", "");
        announce("Фильтр проекта сброшен: проект недоступен в выбранной области поиска.");
      }
      return index.search(query, {
        filters: options.ignoreFilters ? SEARCH_FILTER_IDS : activeFilters(),
        scope: preferences.scope || "current", currentDesktopId: getCurrentDesktopId(),
        projectId: options.ignoreFilters ? "" : preferences.projectId || "",
        dateFrom: options.ignoreFilters ? "" : preferences.dateFrom || "",
        dateTo: options.ignoreFilters ? "" : preferences.dateTo || "",
        limit: resultLimit, ...options
      });
    }

    function results(query = "", options = {}) { return search(query, options).results; }

    function resultElement(result) {
      return { dataset: { searchKind: result.kind, searchKey: result.key || "", id: result.id, desktopId: result.desktopId || "", itemId: result.itemId || "", projectId: result.projectId || "", projectType: result.projectType || "", query: result.query || "" } };
    }

    async function remember(result, query) {
      const text = String(query || "").trim().slice(0, 160);
      return persistSettings(current => {
        const history = (current.history || []).filter(entry => searchNormalize(typeof entry === "string" ? entry : entry.query) !== searchNormalize(text));
        if (text) history.unshift({ query: text, at: Date.now() });
        const recent = (current.recent || []).filter(entry => entry.key !== result.key);
        if (result.key && !["app", "command"].includes(result.kind)) recent.unshift({ key: result.key, at: Date.now() });
        return { history: history.slice(0, 12), recent: recent.slice(0, 12) };
      });
    }

    async function performAction(result, action = "open", root = null) {
      if (!result) return false;
      ensureIndex();
      const fresh = index ? documentsByKey.get(result.key) : result;
      if (!fresh) { announce("Материал больше недоступен. Обновите поиск.", root); return false; }
      try {
        const current = { ...fresh, query: result.query || "" };
        const response = typeof runResultAction === "function" ? await runResultAction(current, action)
          : action === "open" ? await openResult(resultElement(current)) : false;
        if (failed(response)) { announce("Действие не выполнено. Материал мог измениться; попробуйте снова.", root); return false; }
        if (action === "open") await remember(current, result.query);
        else announce(action === "copy" ? "Скопировано." : action === "complete" ? "Задача выполнена." : "Папка открыта.", root);
        if (action === "complete") invalidate();
        return true;
      } catch (error) {
        const detail = typeof error?.message === "string" ? error.message.trim().slice(0, 300) : "";
        announce(`Действие не выполнено.${detail ? ` ${detail}` : ""} Повторите попытку.`, root);
        return false;
      }
    }

    function openResultElement(element) {
      if (!element) return Promise.resolve(false);
      ensureIndex();
      const key = element.dataset.searchKey;
      const found = key ? documentsByKey.get(key) : documents.find(result => result.kind === element.dataset.searchKind && result.id === element.dataset.id && (!element.dataset.desktopId || result.desktopId === element.dataset.desktopId));
      if (!found && !index) return Promise.resolve(openResult(element));
      return performAction(found ? { ...found, query: element.dataset.query || "" } : null);
    }

    function previewHTML(result) {
      if (!result) return `<div class="search-preview-empty"><span aria-hidden="true">⌕</span><p>Выберите результат</p><small>Здесь появятся подробности и действия.</small></div>`;
      const action = (id, label, primary = false) => `<button type="button" class="search-preview-action${primary ? " search-preview-primary" : ""}" data-search-action="${id}" data-search-key="${safeAttr(result.key)}">${label}</button>`;
      const canCopy = ["link", "prompt", "time"].includes(result.kind) || (result.kind === "item" && ["text", "note", "markdown", "table"].includes(result.itemType || getFs()?.[result.id]?.type));
      const canComplete = result.kind === "task" && !result.completed && !["done", "completed"].includes(result.status);
      return `<div class="search-preview-content"><div class="search-eyebrow">${escapeHtml(groupLabels[result.kind] || "Материал")}</div><h3>${escapeHtml(result.title || "Без названия")}</h3><p class="search-preview-location">${escapeHtml([result.desktopName, result.projectName, result.path].filter(Boolean).join(" · ") || result.sub || "")}</p>${result.matchReason ? `<p class="search-preview-reason">${escapeHtml(result.matchReason)}</p>` : ""}<div class="search-preview-text">${escapeHtml(result.previewText || result.snippet || result.text || "Предпросмотр недоступен. Откройте материал, чтобы посмотреть его.")}</div><div class="search-preview-actions">${action("open", result.kind === "command" ? "Выполнить" : "Открыть", true)}${result.kind === "item" ? action("reveal", "Показать в папке") : ""}${canCopy ? action("copy", "Копировать") : ""}${canComplete ? action("complete", "Выполнить задачу") : ""}</div></div>`;
    }

    function projectOptions() {
      const values = new Map();
      for (const result of documents) {
        if (settings().scope !== "all" && result.desktopId && result.desktopId !== getCurrentDesktopId()) continue;
        if (result.projectKey) values.set(result.projectKey, [result.projectName || result.title, settings().scope === "all" ? result.desktopName : ""].filter(Boolean).join(" · "));
      }
      return [...values].sort((a, b) => a[1].localeCompare(b[1], "ru"));
    }

    function controlsHTML(open = false, counts = null) {
      const prefs = settings();
      const scoped = prefs.scope === "all";
      const projects = projectOptions();
      const count = (allFiltersActive() ? 0 : activeFilters().length) + Number(Boolean(prefs.projectId)) + Number(Boolean(prefs.dateFrom || prefs.dateTo));
      return `<div class="search-toolbar"><div class="search-scope" role="group" aria-label="Область поиска"><button type="button" data-search-scope="current" aria-pressed="${!scoped}" class="${!scoped ? "active" : ""}">Этот стол</button><button type="button" data-search-scope="all" aria-pressed="${scoped}" class="${scoped ? "active" : ""}">Все столы</button></div><span class="search-local-label">Локальный поиск</span></div><details class="search-refine" ${open ? "open" : ""}><summary>Фильтры${count ? ` · ${count}` : ""}</summary><div class="search-refine-body"><div class="global-search-filters" aria-label="Тип материала">${filtersHTML(counts)}</div><div class="search-filter-fields"><label>Проект<select data-search-setting="projectId"><option value="">Все проекты</option>${projects.map(([key, label]) => `<option value="${safeAttr(key)}" ${prefs.projectId === key ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label><label>С даты<input type="date" data-search-setting="dateFrom" value="${safeAttr(prefs.dateFrom || "")}"></label><label>По дату<input type="date" data-search-setting="dateTo" value="${safeAttr(prefs.dateTo || "")}"></label></div><button type="button" class="search-text-button" data-search-reset>Сбросить фильтры</button></div></details>`;
    }

    function emptyStartHTML() {
      const history = (settings().history || []).map(entry => typeof entry === "string" ? entry : entry.query).filter(Boolean);
      return `<div class="search-history"><div class="search-section-head"><h3>История запросов</h3>${history.length ? `<button type="button" class="search-text-button" data-search-clear="history">Очистить</button>` : ""}</div>${history.length ? `<div class="search-history-chips">${history.map(query => `<button type="button" data-search-history="${safeAttr(query)}">${escapeHtml(query)}</button>`).join("")}</div>` : `<p class="muted">Здесь будут запросы, по которым вы открывали материалы.</p>`}</div>`;
    }

    function rememberFocus(root) {
      const focused = document.activeElement;
      if (!root.contains?.(focused)) return null;
      return { action: focused.dataset?.searchAction, key: focused.dataset?.searchKey, setting: focused.dataset?.searchSetting, filter: focused.dataset?.searchFilter, scope: focused.dataset?.searchScope };
    }

    function restoreFocus(root, focus) {
      if (!focus) return;
      const match = Array.from(root.querySelectorAll("button,input,select")).find(element =>
        focus.action ? element.dataset.searchAction === focus.action && element.dataset.searchKey === focus.key
          : focus.setting ? element.dataset.searchSetting === focus.setting
          : focus.filter ? element.dataset.searchFilter === focus.filter
          : focus.scope ? element.dataset.searchScope === focus.scope
          : focus.key && element.dataset.searchKind && element.dataset.searchKey === focus.key);
      (match || panels.get(root)?.input)?.focus({ preventScroll: true });
    }

    function drawPanel(root, query = "") {
      const panel = panels.get(root);
      if (!panel) return;
      const nextQuery = String(query || "");
      const queryChanged = nextQuery !== panel.query;
      panel.query = nextQuery;
      const focus = rememberFocus(root);
      const filterOpen = root.querySelector(".search-refine")?.open || false;
      const scrollTop = queryChanged ? 0 : root.querySelector(".search-result-list")?.scrollTop || 0;
      const info = search(query);
      const blankQuery = !String(query).trim();
      const isEmpty = blankQuery && allFiltersActive() && !settings().projectId && !settings().dateFrom && !settings().dateTo;
      let shown = info.results;
      if (blankQuery && index) {
        const available = search("", { keys: (settings().recent || []).map(entry => entry.key), limit: 12 }).results;
        const byKey = new Map(available.map(result => [result.key, result]));
        const recent = (settings().recent || []).map(entry => byKey.get(entry.key)).filter(Boolean);
        const recentKeys = new Set(recent.map(result => result.key));
        shown = isEmpty ? [...recent, ...info.results.filter(result => result.kind === "command").slice(0, 4)]
          : [...recent, ...info.results.filter(result => !recentKeys.has(result.key))].slice(0, resultLimit);
      }
      panel.results = shown;
      if (!shown.some(result => result.key === panel.selectedKey)) panel.selectedKey = shown[0]?.key || "";
      const selected = shown.find(result => result.key === panel.selectedKey);
      const groups = new Map();
      const best = !isEmpty ? shown[0] : null;
      for (const result of shown) {
        if (result === best) continue;
        const label = isEmpty && result.kind !== "command" ? "Недавно открытые" : groupLabels[result.kind] || "Материалы";
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(result);
      }
      const row = result => `<div class="search-result-entry">${searchResultHTML(result)}<div class="search-inline-preview" data-search-inline="${safeAttr(result.key)}"></div></div>`;
      const section = (label, rows, extra = "") => `<section class="search-result-group"><div class="search-section-head"><h3>${escapeHtml(label)}</h3>${extra || `<span>${rows.length} показано</span>`}</div>${rows.map(row).join("")}</section>`;
      const groupHTML = [...groups].map(([label, rows]) => section(label, rows, label === "Недавно открытые" ? `<button type="button" class="search-text-button" data-search-clear="recent">Очистить</button>` : "")).join("");
      const suggestion = typeof info.suggestion === "string" ? info.suggestion : info.suggestion?.query || info.suggestion?.text || "";
      root.classList.add("search-pane");
      root.innerHTML = `${controlsHTML(filterOpen, isEmpty ? null : info.counts)}<div class="search-heading"><div><span class="search-eyebrow">${isEmpty ? "Быстрый доступ" : "Результаты поиска"}</span><h2>${isEmpty ? "Найдите нужное" : searchResultCountLabel(info.total)}</h2></div><small>${settings().scope === "all" ? "Все активные столы" : escapeHtml(desktopName(getCurrentDesktopId()))}</small></div>${suggestion ? `<div class="search-suggestion">Возможное исправление: <button type="button" data-search-history="${safeAttr(suggestion)}">${escapeHtml(suggestion)}</button><span>Исходный запрос сохранён</span></div>` : ""}<div class="search-status" role="status" aria-live="polite">${escapeHtml(panel.message || "")}</div><div class="search-workbench"><div class="search-result-list" aria-label="Результаты поиска">${isEmpty ? emptyStartHTML() : ""}${best ? section("Лучшее совпадение", [best]) : ""}${groupHTML}${!shown.length ? `<div class="search-empty"><b>${isEmpty ? "Начните с запроса" : "Ничего не найдено"}</b><p>${isEmpty ? "Ищите по названию или содержимому материалов." : "Попробуйте короче, выберите все столы или сбросьте фильтры."}</p><button type="button" class="search-preview-action" data-search-reset>Сбросить фильтры</button></div>` : ""}${!isEmpty && info.total > shown.length ? `<p class="search-limit">Показано ${shown.length} из ${info.total}. Уточните запрос.</p>` : ""}</div><aside class="search-preview" aria-label="Предпросмотр материала"></aside></div><div class="search-key-hints"><span>↑ ↓ выбор</span><span>Enter открыть</span><span>Esc закрыть</span></div>`;
      updateSelection(root, selected);
      const list = root.querySelector(".search-result-list");
      if (list) list.scrollTop = scrollTop;
      restoreFocus(root, focus);
    }

    function updateSelection(root, result) {
      const panel = panels.get(root);
      panel.selectedKey = result?.key || "";
      for (const row of root.querySelectorAll(".search-result")) {
        const selected = row.dataset.searchKey === panel.selectedKey;
        row.classList.toggle("is-selected", selected);
        row.setAttribute("aria-pressed", String(selected));
      }
      const preview = root.querySelector(".search-preview");
      if (preview) preview.innerHTML = previewHTML(result);
      for (const host of root.querySelectorAll("[data-search-inline]")) {
        host.innerHTML = host.dataset.searchInline === panel.selectedKey && result
          ? `<details><summary>Предпросмотр и действия</summary>${previewHTML(result)}</details>` : "";
      }
    }

    function setQuery(root, query) {
      const panel = panels.get(root);
      if (panel.input) {
        panel.input.value = query;
        if (panel.input.id === "global-search-field") {
          const taskbar = document.querySelector("#taskbar-search-field");
          if (taskbar) taskbar.value = query;
        }
      }
      panel.input?.focus({ preventScroll: true });
      drawPanel(root, query);
    }

    function redrawAll() {
      for (const [root, panel] of panels) {
        if (root.isConnected === false) { panels.delete(root); continue; }
        drawPanel(root, panel.input?.value ?? panel.query);
      }
    }

    function attachPanel(root, input) {
      if (panels.has(root)) { panels.get(root).input = input; return; }
      const panel = { input, query: "", selectedKey: "", results: [], message: "", busy: false };
      panels.set(root, panel);
      root.addEventListener("click", async event => {
        const target = event.target;
        const action = target.closest?.("[data-search-action]");
        if (action) {
          event.preventDefault();
          if (panel.busy) return;
          const result = panel.results.find(entry => entry.key === action.dataset.searchKey);
          panel.busy = true; action.disabled = true; root.setAttribute("aria-busy", "true");
          await performAction(result, action.dataset.searchAction, root);
          panel.busy = false; root.removeAttribute("aria-busy"); action.disabled = false;
          if (action.dataset.searchAction === "complete") drawPanel(root, panel.query);
          return;
        }
        const history = target.closest?.("[data-search-history]");
        if (history) { setQuery(root, history.dataset.searchHistory); return; }
        const clear = target.closest?.("[data-search-clear]");
        if (clear) {
          await persistSettings({ [clear.dataset.searchClear]: [] }); redrawAll(); return;
        }
        const scope = target.closest?.("[data-search-scope]");
        if (scope) {
          persistSettings({ scope: scope.dataset.searchScope, projectId: "" }); redrawAll(); return;
        }
        const filter = target.closest?.("[data-search-filter]");
        if (filter) { event.preventDefault(); filter.dataset.searchFilter === "all" ? setFilters() : toggleFilter(filter.dataset.searchFilter); redrawAll(); return; }
        if (target.closest?.("[data-search-reset]")) {
          persistSettings({ filters: [...SEARCH_FILTER_IDS], projectId: "", dateFrom: "", dateTo: "" }); redrawAll(); return;
        }
        const result = target.closest?.("[data-search-kind]");
        if (result) updateSelection(root, panel.results.find(entry => entry.key === result.dataset.searchKey));
      });
      root.addEventListener("dblclick", event => {
        const row = event.target.closest?.("[data-search-kind]");
        if (row) performAction(panel.results.find(result => result.key === row.dataset.searchKey), "open", root);
      });
      root.addEventListener("focusin", event => {
        const row = event.target.closest?.("[data-search-kind]");
        if (row && row.dataset.searchKey !== panel.selectedKey) updateSelection(root, panel.results.find(result => result.key === row.dataset.searchKey));
      });
      root.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (moveSearchResultFocus(event, root, panel.input)) return;
        const row = event.target.closest?.("[data-search-kind]");
        if (event.key === "Enter" && row) { event.preventDefault(); performAction(panel.results.find(result => result.key === row.dataset.searchKey), "open", root); }
      });
      root.addEventListener("change", event => {
        const key = event.target.dataset?.searchSetting;
        if (!["projectId", "dateFrom", "dateTo"].includes(key)) return;
        persistSettings({ [key]: event.target.value }); redrawAll();
      });
    }

    function openSelected(root = document.querySelector("#global-search-results")) {
      const panel = panels.get(root);
      return performAction(panel?.results.find(result => result.key === panel.selectedKey) || panel?.results[0], "open", root);
    }

    function createApp() {
      const root = document.createElement("div");
      root.className = "app-shell search-app-shell";
      root.innerHTML = `<div class="global-search-input"><span aria-hidden="true">⌕</span><input aria-label="Поиск в ZeTer OS" placeholder="Файлы, задачи, ссылки и другие материалы"></div><div class="global-search-results"></div>`;
      const input = root.querySelector("input");
      const pane = root.querySelector(".global-search-results");
      attachPanel(pane, input);
      input.addEventListener("input", event => { if (!event.isComposing) drawPanel(pane, input.value); });
      input.addEventListener("compositionend", () => drawPanel(pane, input.value));
      input.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (moveSearchResultFocus(event, pane, input)) return;
        if (event.key === "Enter") { event.preventDefault(); openSelected(pane); }
        if (event.key === "Escape") { input.value = ""; drawPanel(pane, ""); }
      });
      drawPanel(pane, "");
      return root;
    }

    return Object.freeze({
      settings,
      activeFilters,
      allFiltersActive,
      setFilters,
      toggleFilter,
      filtersHTML,
      handleClick,
      filtersAllow,
      builderOptions,
      workspaceStores,
      search,
      results,
      invalidate,
      openResultElement,
      openSelected,
      getStats: () => index?.getStats?.() || {},
      createApp,
      renderGlobal
    });
  }

  function createGlobalSearchOverlayController(integration = {}) {
    const {
      document,
      ElementCtor = null,
      closeFloating = () => {},
      renderGlobal = () => {},
      openFirst = () => {},
      schedule = callback => setTimeout(callback, 0)
    } = integration;

    function close() {
      document.querySelector("#global-search")?.classList.add("hidden");
    }

    function syncQuery(query = "", source = "") {
      const value = String(query || "");
      const globalField = document.querySelector("#global-search-field");
      const taskbarField = document.querySelector("#taskbar-search-field");
      if (globalField && source !== "global" && globalField.value !== value) globalField.value = value;
      if (taskbarField && source !== "taskbar" && taskbarField.value !== value) taskbarField.value = value;
      renderGlobal(value);
    }

    function setPlacement(placement = "top") {
      const box = document.querySelector("#global-search");
      if (!box) return;
      const isBottom = placement === "bottom";
      box.classList.toggle("global-search--bottom", isBottom);
      box.classList.toggle("global-search--top", !isBottom);
      box.dataset.searchPlacement = isBottom ? "bottom" : "top";
    }

    function open(query = "", focus = true, placement = "top") {
      const box = document.querySelector("#global-search");
      const field = document.querySelector("#global-search-field");
      if (!box || !field) return false;
      closeFloating();
      setPlacement(placement);
      box.classList.remove("hidden");
      syncQuery(query, "open");
      if (focus) {
        schedule(() => {
          field.focus({ preventScroll: true });
          const end = field.value.length;
          try { field.setSelectionRange(end, end); } catch {}
        });
      }
      return true;
    }

    function openFromTaskbar(query = "") {
      const taskbarField = document.querySelector("#taskbar-search-field");
      open(query, false, "bottom");
      if (taskbarField && document.activeElement !== taskbarField) {
        schedule(() => {
          taskbarField.focus({ preventScroll: true });
          const end = taskbarField.value.length;
          try { taskbarField.setSelectionRange(end, end); } catch {}
        });
      }
    }

    function toggle() {
      const box = document.querySelector("#global-search");
      if (!box) return false;
      if (box.classList.contains("hidden")) return open("", true, "top");
      closeFloating();
      return true;
    }

    function bind() {
      const globalField = document.querySelector("#global-search-field");
      globalField?.addEventListener("input", event => { if (!event.isComposing) syncQuery(event.target.value, "global"); });
      globalField?.addEventListener("compositionend", event => syncQuery(event.target.value, "global"));
      globalField?.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); openFirst(); }
      });
      document.querySelector("#global-search")?.addEventListener("keydown", event => {
        moveSearchResultFocus(event, document.querySelector("#global-search-results"), globalField);
      });
      document.querySelector("#global-search-close")?.addEventListener("click", event => {
        event.preventDefault();
        close();
      });
      document.addEventListener("pointerdown", event => {
        const box = document.querySelector("#global-search");
        if (!box || box.classList.contains("hidden")) return;
        const target = !ElementCtor || event.target instanceof ElementCtor ? event.target : null;
        if (!target?.closest) return;
        if (target.closest("#global-search,.taskbar-search,[data-top-action='search'],[data-app='search']")) return;
        close();
      }, true);

      const taskbarField = document.querySelector("#taskbar-search-field");
      taskbarField?.addEventListener("focus", event => {
        const query = event.target.value || "";
        if (query.trim()) openFromTaskbar(query);
      });
      taskbarField?.addEventListener("input", event => { if (!event.isComposing) openFromTaskbar(event.target.value); });
      taskbarField?.addEventListener("compositionend", event => openFromTaskbar(event.target.value));
      taskbarField?.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          if (document.querySelector("#global-search")?.classList.contains("hidden")) openFromTaskbar(event.target.value);
          moveSearchResultFocus(event, document.querySelector("#global-search-results"), taskbarField);
        }
        if (event.key === "Enter") {
          event.preventDefault();
          openFromTaskbar(event.target.value);
          openFirst();
        }
        if (event.key === "Escape") {
          event.target.value = "";
          syncQuery("", "taskbar");
          closeFloating();
        }
      });
      return true;
    }

    return Object.freeze({ close, syncQuery, setPlacement, open, openFromTaskbar, toggle, bind });
  }

  function highlightRichEditorSearch(area, query = "") {
    if (!area || !String(query || "").trim()) return;
    const needles = searchHighlightNeedles(query);
    if (!needles.length) return;
    const rx = new RegExp(`(${needles.map(escapeRegExp).join("|")})`, "gi");
    const nodes = [];
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !rx.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        rx.lastIndex = 0;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const text = node.nodeValue;
      rx.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      text.replace(rx, (match, _group, offset) => {
        if (offset > last) frag.appendChild(document.createTextNode(text.slice(last, offset)));
        const mark = document.createElement("mark");
        mark.className = "search-hit editor-search-hit";
        mark.textContent = match;
        frag.appendChild(mark);
        last = offset + match.length;
        return match;
      });
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    });
    setTimeout(() => $(".editor-search-hit", area)?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
  }

  function selectTextareaSearch(textarea, query = "") {
    if (!textarea || !String(query || "").trim()) return;
    const idx = firstSearchIndex(textarea.value || "", query);
    if (idx < 0) return;
    const needle = searchHighlightNeedles(query).find(part => searchNormalize(textarea.value).includes(searchNormalize(part))) || query;
    const length = Math.max(1, needle.length);
    setTimeout(() => {
      textarea.focus();
      try { textarea.setSelectionRange(idx, Math.min(textarea.value.length, idx + length)); } catch {}
      textarea.scrollTop = Math.max(0, (textarea.value.slice(0, idx).split("\n").length - 3) * 22);
    }, 80);
  }

  function applyTableSearchHighlight(root, query = "") {
    if (!root || !String(query || "").trim()) return;
    $$("td[data-cell]", root).forEach(cell => {
      const input = $("input[data-row][data-col]", cell);
      const match = input && searchCandidateMatches(query, input.value);
      cell.classList.toggle("table-search-hit", Boolean(match));
    });
    setTimeout(() => $(".table-search-hit input", root)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }), 80);
  }

  window.ZETER_SEARCH_UI_UTILS = Object.freeze({
    APP_SEARCH_EXTRA,
    SEARCH_COMMAND_DEFINITIONS,
    searchShellHTML,
    searchAppEmptyHTML,
    globalSearchEmptyHTML,
    searchFiltersHTML,
    appSearchText,
    searchCommandDefinitions,
    itemResultSubtype,
    searchResultHTML,
    searchResultCountLabel,
    searchResultsListHTML,
    globalSearchResultsHTML,
    searchPanelAction,
    searchPanelKeyAction,
    renderSearchAppResults,
    renderGlobalSearchResults,
    firstSearchResultElement,
    searchAppElement,
    renderGlobalSearchPanel,
    createSearchResultNavigator,
    createSearchController,
    createGlobalSearchOverlayController,
    highlightRichEditorSearch,
    selectTextareaSearch,
    applyTableSearchHighlight
  });
})();
