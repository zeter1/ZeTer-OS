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
      <div class="global-search-input"><span>⌕</span><input placeholder="Искать на этом рабочем столе: файлы, задачи, события, заметки" autofocus></div>
      <div class="global-search-filters"></div>
      <div class="global-search-results"></div>`;
  }

  function searchAppEmptyHTML() {
    return `<p class="muted search-empty">Ничего не найдено на этом рабочем столе. Попробуй другое слово или отключи часть фильтров.</p>`;
  }

  function globalSearchEmptyHTML() {
    return `<p class="muted search-empty">Введите запрос, команду или выберите другой фильтр. Поиск идёт только по текущему рабочему столу.</p>`;
  }

  function searchFiltersHTML(filters = [], active = [], allActive = false) {
    const activeIds = Array.isArray(active) ? active : [];
    const chips = filters.map(filter => {
      const selected = allActive || activeIds.includes(filter.id);
      return `<button type="button" class="search-filter-chip ${selected ? "active" : ""}" data-search-filter="${safeAttr(filter.id)}">${escapeHtml(filter.icon)} ${escapeHtml(filter.label)}</button>`;
    }).join("");
    return `<button type="button" class="search-filter-chip search-filter-all ${allActive ? "active" : ""}" data-search-filter="all">Все</button>${chips}`;
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

    return `<button class="search-result ${result.kind === "command" ? "search-command-result" : ""}" data-search-kind="${safeAttr(result.kind)}" data-id="${safeAttr(result.id)}" data-desktop-id="${safeAttr(result.desktopId || "")}" data-item-id="${safeAttr(result.itemId || "")}" data-project-id="${safeAttr(result.projectId || "")}" data-query="${safeAttr(result.query || "")}"><i>${escapeHtml(result.icon)}</i><span><b>${highlightSearchText(result.title, result.query)}</b><br><small>${escapeHtml(result.sub)}</small>${snippet}<span class="search-category-tags">${categoryLabels}</span></span><small>${action}</small></button>`;
  }

  function searchResultsListHTML(results = [], emptyHTML = "") {
    return results.map(searchResultHTML).join("") || emptyHTML;
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
    input?.addEventListener("input", draw);
    input?.addEventListener("keydown", event => {
      if (searchPanelKeyAction(event)?.type === "open-first") {
        event.preventDefault();
        openFirst(firstSearchResultElement(root));
      }
    });
    draw();
    if (focus && input) setTimeout(() => input.focus(), 0);
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

    const runForDesktop = (desktopId, callback) => {
      if (desktopId && desktopId !== getCurrentDesktopId() && desktopExists(desktopId)) {
        switchDesktop(desktopId);
        schedule(callback);
        return true;
      }
      return callback();
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
      if (!item) return undefined;
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
        if (event) setCalendarEventDate(event.date);
        return openApp("calendar");
      });
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
        return runForDesktop(element.dataset.desktopId || "", () => openItemResult(id, query));
      }
      if (kind === "task") return openTaskResult(element);
      if (kind === "tasks") return openApp("tasks");
      if (kind === "calendar") return openCalendarResult(element);
      if (kind === "notification") return toggleNotifications();
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
      openResult = () => {}
    } = integration;

    function settings() {
      const state = getState();
      state.searchSettings = normalizeSearchSettings(state.searchSettings);
      return state.searchSettings;
    }

    function activeFilters() {
      return activeSearchFilterIds(settings());
    }

    function allFiltersActive(filters = activeFilters()) {
      return searchAllFiltersActive(filters);
    }

    function setFilters(filters = SEARCH_FILTER_IDS, options = {}) {
      settings().filters = normalizeSearchFilterSelection(filters);
      if (options.save !== false) saveState({ skipExternalBackup: true, silentStorageError: true });
    }

    function toggleFilter(filterId) {
      setFilters(toggleSearchFilterSelection(activeFilters(), filterId));
    }

    function filtersHTML() {
      const active = activeFilters();
      return searchFiltersHTML(SEARCH_FILTERS, active, allFiltersActive(active));
    }

    function renderGlobal(query = "") {
      const root = document.querySelector("#global-search-results");
      renderGlobalSearchPanel(root, query, {
        getResults: results,
        getFiltersHTML: filtersHTML,
        getQuery: () => document.querySelector("#global-search-field")?.value || query,
        handleClick
      });
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
        openResult(action.element);
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
      const desktopId = getCurrentDesktopId();
      return [{ desktopId, title: desktopName(desktopId), data: getWorkspace() }];
    }

    function results(query = "") {
      return buildCombinedSearchResults(query, {
        apps,
        fs: getFs(),
        stores: workspaceStores(),
        commands: searchCommandDefinitions(),
        trashRoot,
        limit: resultLimit,
        allFiltersActive: allFiltersActive(),
        appSearchText,
        builderOptions: builderOptions()
      });
    }

    function createApp() {
      return searchAppElement({
        getResults: results,
        getFiltersHTML: filtersHTML,
        handleClick,
        openFirst: openResult
      });
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
      results,
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
          field.focus();
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
          taskbarField.focus();
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
      globalField?.addEventListener("input", event => syncQuery(event.target.value, "global"));
      globalField?.addEventListener("keydown", event => {
        if (event.key === "Enter") openFirst();
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
      taskbarField?.addEventListener("input", event => openFromTaskbar(event.target.value));
      taskbarField?.addEventListener("keydown", event => {
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
