(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS start UI utils require core utils.");

  const { $, $$, escapeHtml } = coreUtils;
  const safeAttr = escapeHtml;

  function normalizeStartQuery(value = "") {
    return String(value || "").trim().toLowerCase();
  }

  function startTitleText({ showAll = false, query = "" } = {}) {
    if (query) return "Результаты";
    return showAll ? "Все приложения" : "Закреплено";
  }

  function startToggleAllText(showAll = false) {
    return showAll ? "← Закреплено" : "Все приложения →";
  }

  const START_CATEGORIES = Object.freeze({ all: "Все", work: "Работа", documents: "Документы", tools: "Инструменты", system: "Система" });
  const START_QUICK_ACTIONS = Object.freeze({ note: ["📝", "Создать заметку"], task: ["＋", "Добавить задачу"], explorer: ["📁", "Открыть проводник"] });

  function startAppCategory(id = "") {
    if (["tasks", "tasklist", "calendar", "timetracking", "prompts", "contacts"].includes(id)) return "work";
    if (["editor", "notes", "markdown", "table", "photos", "links", "folder"].includes(id)) return "documents";
    if (["calculator", "calculations", "automations"].includes(id)) return "tools";
    return "system";
  }

  function startAppButtonHTML({ icon = "", name = "" } = {}) {
    return `<b>${icon}</b><span>${escapeHtml(name)}</span>`;
  }

  function startFileButtonHTML({
    icon = "",
    name = "",
    kind = "",
    showKind = false
  } = {}) {
    return `<b>${icon}</b><span>${escapeHtml(name)}</span>${showKind ? `<small>${escapeHtml(kind)}</small>` : ""}`;
  }

  function startEmptyText({ query = "" } = {}) {
    return query ? "Ничего не найдено" : "Закреплённых элементов пока нет";
  }

  function startItemSearchText(item = {}, kind = "", description = "") {
    return [item?.name, kind, description].join(" ").toLowerCase();
  }

  function startAppEntries(apps = {}, options = {}) {
    const query = normalizeStartQuery(options.query);
    const showAll = Boolean(options.showAll);
    return Object.entries(apps)
      .filter(([, app]) => app && !app.hidden)
      .filter(([, app]) => !query || String(app.name || "").toLowerCase().includes(query))
      .filter(([, app]) => showAll || query || app.pinned);
  }

  function startItemEntries(items = [], options = {}) {
    const query = normalizeStartQuery(options.query);
    const showAll = Boolean(options.showAll);
    const canPinItem = typeof options.canPinItem === "function" ? options.canPinItem : () => false;
    const itemSearchText = typeof options.itemSearchText === "function" ? options.itemSearchText : startItemSearchText;
    return items
      .filter(item => canPinItem(item))
      .filter(item => query ? itemSearchText(item).includes(query) : (!showAll && item.pinnedInStart))
      .sort((a, b) => (Number(b.startPinnedAt) || 0) - (Number(a.startPinnedAt) || 0) || String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  }

  function renderStartItems({
    container,
    apps = {},
    items = [],
    query = "",
    showAll = false,
    canPinItem = () => false,
    itemSearchText = startItemSearchText,
    itemKind = () => "",
    itemIcon = () => "",
    onOpenApp = () => {},
    onShowAppMenu = () => {},
    onOpenItem = () => {},
    onShowItemMenu = () => {},
    category = "all",
    pinOrder = [],
    onMovePin = () => {}
  } = {}) {
    if (!container) return;
    container.innerHTML = "";

    startAppEntries(apps, { query, showAll })
      .filter(([id]) => !showAll || category === "all" || startAppCategory(id) === category)
      .sort((a, b) => showAll ? String(a[1].name).localeCompare(String(b[1].name), "ru") : 0)
      .forEach(([id, app]) => {
        const button = document.createElement("button");
        button.className = "start-app";
        button.dataset.startApp = id;
        button.dataset.startPin = `app:${id}`;
        button.title = app.name || "";
        button.innerHTML = startAppButtonHTML({ icon: app.icon, name: app.name });
        button.addEventListener("click", () => onOpenApp(id));
        button.addEventListener("contextmenu", event => onShowAppMenu(event, id));
        container.appendChild(button);
      });

    startItemEntries(items, { query, showAll, canPinItem, itemSearchText })
      .forEach(item => {
        const kind = itemKind(item);
        const showKind = !["app", "folder"].includes(item.type);
        const button = document.createElement("button");
        button.className = "start-app start-file" + (showKind ? "" : " start-file-compact");
        button.dataset.startItem = item.id;
        button.dataset.startPin = `item:${item.id}`;
        button.title = showKind ? `${item.name} · ${kind}` : (item.name || "");
        button.innerHTML = startFileButtonHTML({ icon: itemIcon(item), name: item.name, kind, showKind });
        button.addEventListener("click", () => onOpenItem(item.id));
        button.addEventListener("contextmenu", event => onShowItemMenu(event, item.id));
        container.appendChild(button);
      });

    if (!showAll && !query) {
      const buttons = Array.from(container.children);
      const rank = key => { const index = pinOrder.indexOf(key); return index < 0 ? pinOrder.length : index; };
      buttons.sort((a, b) => rank(a.dataset.startPin) - rank(b.dataset.startPin)).forEach(button => container.appendChild(button));
      buttons.forEach(button => {
        button.draggable = true;
        button.title += " · Alt+← / Alt+→: изменить порядок";
        button.addEventListener("keydown", event => {
          if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          onMovePin(button.dataset.startPin, event.key === "ArrowLeft" ? -1 : 1);
        });
        button.addEventListener("dragstart", event => {
          event.dataTransfer.setData("application/x-zeter-start-pin", button.dataset.startPin);
          event.dataTransfer.effectAllowed = "move";
        });
        button.addEventListener("dragover", event => {
          if (Array.from(event.dataTransfer.types || []).includes("application/x-zeter-start-pin")) event.preventDefault();
        });
        button.addEventListener("drop", event => {
          const key = event.dataTransfer.getData("application/x-zeter-start-pin");
          if (!key) return;
          event.preventDefault();
          event.stopPropagation();
          onMovePin(key, button.dataset.startPin);
        });
      });
    }

    if (!container.children.length) {
      const empty = document.createElement("div");
      empty.className = "start-empty";
      empty.textContent = startEmptyText({ query });
      container.appendChild(empty);
    }
  }

  function startDesktopCardHTML({
    id = "",
    avatarHTML = "",
    name = "",
    description = "",
    count = 0,
    active = false,
    index = 0,
    deletable = false
  } = {}) {
    return `
        <button class="start-desktop-main" data-switch-desktop="${safeAttr(id)}" title="${safeAttr(name)}"${active ? ' aria-current="true"' : ""}>
          <span class="start-desktop-titleline">${avatarHTML}<b>${escapeHtml(name)}</b></span>
          <span class="start-desktop-description">${escapeHtml(description)}</span>
          <span class="start-desktop-meta">${Number(count) || 0} элементов${active ? ' <em class="start-current-badge">Текущий</em>' : ` · стол ${Number(index) + 1}`}</span>
        </button>
        <button class="start-desktop-more" data-desktop-menu="${safeAttr(id)}" data-deletable="${deletable ? "true" : "false"}" aria-label="Действия: ${safeAttr(name)}" title="Действия с рабочим столом" aria-haspopup="menu">⋯</button>`;
  }

  function renderStartDesktops({
    container,
    desktops = [],
    currentDesktopId = "",
    itemCount = () => 0,
    desktopAvatarHTML = () => "",
    desktopName = () => "",
    desktopDescription = () => "",
    onSwitchDesktop = () => {},
    onDeleteDesktop = () => {},
    onDesktopMenu = null
  } = {}) {
    if (!container) return;
    container.innerHTML = "";

    desktops.forEach((desktop, index) => {
      const active = desktop.id === currentDesktopId;
      const card = document.createElement("div");
      card.className = "start-desktop-card" + (active ? " active" : "");
      card.innerHTML = startDesktopCardHTML({
        id: desktop.id,
        avatarHTML: desktopAvatarHTML(desktop.id, active),
        name: desktopName(desktop.id),
        description: desktopDescription(desktop.id),
        count: itemCount(desktop.id),
        active,
        index,
        deletable: desktop.id !== "desktop"
      });
      container.appendChild(card);
    });

    $$('[data-switch-desktop]', container).forEach(button => {
      button.addEventListener("click", () => onSwitchDesktop(button.dataset.switchDesktop));
    });
    $$('[data-desktop-menu]', container).forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        if (onDesktopMenu) onDesktopMenu(event, button.dataset.desktopMenu, button.dataset.deletable === "true");
        else if (button.dataset.deletable === "true") onDeleteDesktop(button.dataset.desktopMenu);
      });
    });
  }

  function createStartPreferencesWriter(options = {}) {
    return window.ZETER_PREFERENCES_WRITER_UTILS.createPreferencesWriter({
      ...options,
      keys: ["layout", "iconSize", "showPinned", "showRecent", "showDesktops", "showQuickActions", "quickActions", "pinOrder"]
    });
  }

  function createStartMenuController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {}, desktops: [] });
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const getShowAll = typeof options.getShowAll === "function" ? options.getShowAll : () => false;
    const setShowAll = typeof options.setShowAll === "function" ? options.setShowAll : () => {};
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const notify = typeof options.toast === "function" ? options.toast : () => {};
    const canPinItem = typeof options.canPinItem === "function" ? options.canPinItem : () => false;
    const itemKind = typeof options.itemKind === "function" ? options.itemKind : () => "";
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const itemDescription = typeof options.itemDescription === "function" ? options.itemDescription : () => "";
    const closeFloating = typeof options.closeFloating === "function" ? options.closeFloating : () => {};
    const openApp = typeof options.openApp === "function" ? options.openApp : () => {};
    const showAppMenu = typeof options.showAppMenu === "function" ? options.showAppMenu : () => {};
    const openItem = typeof options.openItem === "function" ? options.openItem : () => {};
    const buildItemMenuEntries = typeof options.buildItemMenuEntries === "function" ? options.buildItemMenuEntries : () => [];
    const showContextNearElement = typeof options.showContextNearElement === "function" ? options.showContextNearElement : () => {};
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const getCurrentDesktopId = typeof options.getCurrentDesktopId === "function" ? options.getCurrentDesktopId : () => "";
    const itemCount = typeof options.itemCount === "function" ? options.itemCount : () => 0;
    const desktopAvatarHTML = typeof options.desktopAvatarHTML === "function" ? options.desktopAvatarHTML : () => "";
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : () => "";
    const desktopDescription = typeof options.desktopDescription === "function" ? options.desktopDescription : () => "";
    const switchDesktop = typeof options.switchDesktop === "function" ? options.switchDesktop : () => {};
    const deleteDesktop = typeof options.deleteDesktop === "function" ? options.deleteDesktop : () => {};
    const createDesktop = typeof options.createDesktop === "function" ? options.createDesktop : () => {};
    const preferences = () => ({ layout: "balanced", iconSize: "normal", showPinned: true, showRecent: true, showDesktops: true, showQuickActions: true, quickActions: ["note", "task", "explorer"], pinOrder: [], ...preferencesWriter.getState().preferences });
    let preferencesOpen = false;
    let category = "all";
    let bound = false;
    const preferencesWriter = createStartPreferencesWriter({
      getPreferences: () => options.getPreferences?.() || {},
      save: options.updatePreferences,
      onChange: refreshPreferencesView,
      onError: () => notify("Настройки Пуска не сохранены", "Выбор пока показан в меню. Повторите запись или отмените изменения.")
    });

    function refreshPreferencesView() {
      if (preferencesOpen) { syncPreferences(); return; }
      const menu = $("#start-menu");
      const pins = $("#start-pinned");
      const focusedKey = menu && !menu.classList.contains("hidden") && pins?.contains(document.activeElement)
        ? document.activeElement?.dataset.startPin : "";
      render(currentFilter());
      if (focusedKey && !menu.classList.contains("hidden")) {
        Array.from(pins.querySelectorAll('[data-start-pin]')).find(button => button.dataset.startPin === focusedKey)?.focus();
      }
    }

    function updatePreferences(patch) { return preferencesWriter.update(patch); }

    function movePin(key, directionOrTarget) {
      const buttons = Array.from($("#start-pinned")?.querySelectorAll('[data-start-pin]') || []);
      const order = buttons.map(button => button.dataset.startPin);
      const index = order.indexOf(key);
      const target = typeof directionOrTarget === "number" ? index + directionOrTarget : order.indexOf(directionOrTarget);
      if (index < 0 || target < 0 || target >= order.length || target === index) return;
      order.splice(index, 1);
      order.splice(target, 0, key);
      updatePreferences({ pinOrder: order });
      Array.from($("#start-pinned")?.querySelectorAll('[data-start-pin]') || []).find(button => button.dataset.startPin === key)?.focus();
    }

    function renderPreferences() {
      const panel = $("#start-preferences");
      if (!panel) return;
      if (panel.querySelector("[data-start-settings-back]")) { syncPreferences(); return; }
      const prefs = preferences();
      panel.innerHTML = `<div class="start-settings-heading"><button type="button" data-start-settings-back>← Назад</button><div><h2>Настройки меню Пуск</h2><p data-start-settings-status aria-live="polite">Изменения применяются сразу</p></div></div><div class="start-settings-error hidden" data-start-settings-error role="alert"><p>Изменения не сохранены. Ваш выбор остаётся в меню.</p><button class="small-btn" data-start-settings-retry>Повторить</button> <button class="small-btn" data-start-settings-discard>Отменить изменения</button></div>
        <div class="start-settings-grid"><div class="start-settings-fields">
          <label class="start-setting-row"><span>Компоновка</span><select data-start-pref="layout"><option value="balanced"${prefs.layout === "balanced" ? " selected" : ""}>Сбалансированная</option><option value="compact"${prefs.layout === "compact" ? " selected" : ""}>Компактная</option></select></label>
          <label class="start-setting-row"><span>Размер значков</span><select data-start-pref="iconSize"><option value="normal"${prefs.iconSize === "normal" ? " selected" : ""}>Обычные</option><option value="large"${prefs.iconSize === "large" ? " selected" : ""}>Крупные</option></select></label>
          <fieldset><legend>Разделы меню</legend>${[["showPinned", "Закреплённые элементы"], ["showRecent", "Продолжить работу"], ["showDesktops", "Рабочие столы"], ["showQuickActions", "Быстрые действия"]].map(([key, label]) => `<label class="start-setting-check"><input type="checkbox" data-start-pref="${key}"${prefs[key] ? " checked" : ""}><span>${label}</span></label>`).join("")}</fieldset>
          <fieldset><legend>Состав быстрых действий</legend>${Object.entries(START_QUICK_ACTIONS).map(([key, [, label]]) => `<label class="start-setting-check"><input type="checkbox" data-start-quick-pref="${key}"${prefs.quickActions.includes(key) ? " checked" : ""}><span>${label}</span></label>`).join("")}</fieldset>
          <p class="start-settings-help">Если отключить «Продолжить работу», новые открытия не попадут в историю. Ранее сохранённую историю можно очистить кнопкой «Очистить» в этом разделе меню — документы останутся на месте.</p>
          <p class="start-settings-help">Порядок закреплённых элементов: перетаскивание или Alt+← / Alt+→ на выбранном значке.</p>
        </div><aside class="start-settings-preview" aria-label="Предпросмотр меню"><b>Предпросмотр</b><div class="start-preview-search">⌕ Поиск по ОС</div><div class="start-preview-body"><div><span data-start-preview="showPinned">Закреплено</span><div data-start-preview="showPinned" class="start-preview-pins">✅ 📅 🧮 ⚙️</div><span data-start-preview="showRecent">Продолжить работу</span><div data-start-preview="showRecent" class="start-preview-line">📝 Недавний документ</div><span data-start-preview="showQuickActions">Быстрые действия</span><div data-start-preview="showQuickActions" class="start-preview-line">＋ Создать</div></div><div data-start-preview="showDesktops" class="start-preview-workspace">Рабочие столы<div>▣ Текущий</div></div></div><div class="start-preview-footer">⚙ Настройки</div></aside></div>`;
      panel.querySelector("[data-start-settings-back]")?.addEventListener("click", () => setPreferencesOpen(false));
      panel.querySelector("[data-start-settings-retry]")?.addEventListener("click", () => preferencesWriter.retry());
      panel.querySelector("[data-start-settings-discard]")?.addEventListener("click", () => preferencesWriter.discard());
      $$('[data-start-pref]', panel).forEach(input => input.addEventListener("change", () => {
        const key = input.dataset.startPref;
        updatePreferences({ [key]: input.type === "checkbox" ? input.checked : input.value });
      }));
      $$('[data-start-quick-pref]', panel).forEach(input => input.addEventListener("change", () => {
        const quickActions = Object.keys(START_QUICK_ACTIONS).filter(key => key === input.dataset.startQuickPref ? input.checked : preferences().quickActions.includes(key));
        updatePreferences({ quickActions });
      }));
      syncPreferences();
    }

    function syncPreferenceAppearance() {
      const prefs = preferences();
      const menu = $("#start-menu");
      menu?.classList.toggle("start-layout-compact", prefs.layout === "compact");
      menu?.classList.toggle("start-icons-large", prefs.iconSize === "large");
      menu?.classList.toggle("start-with-workspaces", prefs.showDesktops && !currentFilter() && !preferencesOpen);
      $("#start-content")?.classList.toggle("hidden", preferencesOpen);
      $("#start-preferences")?.classList.toggle("hidden", !preferencesOpen);
      $("#start-settings")?.setAttribute("aria-expanded", String(preferencesOpen));
      $("#start-search-input")?.closest(".start-search")?.classList.toggle("hidden", preferencesOpen);
      const status = preferencesWriter.getState();
      const hint = $("#start-footer-hint");
      if (hint) hint.textContent = status.error ? "Не сохранено · откройте Настройки" : status.pending ? "Сохранение… Можно продолжать настройку" : preferencesOpen ? "Изменения применяются сразу" : "Ваше рабочее пространство";
      hint?.setAttribute("aria-live", "polite");
    }

    function syncPreferences() {
      syncPreferenceAppearance();
      const panel = $("#start-preferences");
      if (!panel) return;
      const prefs = preferences();
      const status = preferencesWriter.getState();
      panel.setAttribute("aria-busy", String(status.pending));
      $$('[data-start-pref]', panel).forEach(input => {
        if (input.type === "checkbox") input.checked = Boolean(prefs[input.dataset.startPref]);
        else input.value = prefs[input.dataset.startPref];
      });
      $$('[data-start-quick-pref]', panel).forEach(input => { input.checked = prefs.quickActions.includes(input.dataset.startQuickPref); });
      $$('[data-start-preview]', panel).forEach(element => element.classList.toggle("hidden", !prefs[element.dataset.startPreview]));
      $(".start-preview-body", panel)?.classList.toggle("is-compact", prefs.layout === "compact");
      $(".start-preview-pins", panel)?.classList.toggle("is-large", prefs.iconSize === "large");
      const text = $("[data-start-settings-status]", panel);
      if (text) text.textContent = status.error ? "Изменения не сохранены" : status.pending ? "Сохранение… Можно продолжать настройку" : "Изменения применяются сразу";
      $("[data-start-settings-error]", panel)?.classList.toggle("hidden", !status.error);
      const discard = $("[data-start-settings-discard]", panel);
      if (discard) discard.disabled = !status.canDiscard;
      const retry = $("[data-start-settings-retry]", panel);
      if (retry) retry.disabled = status.pending;
    }

    function setPreferencesOpen(open) {
      preferencesOpen = Boolean(open);
      render(currentFilter());
      if (preferencesOpen) $("[data-start-settings-back]", $("#start-preferences"))?.focus();
      else $("#start-settings")?.focus();
    }

    function renderSecondarySections(query) {
      const prefs = preferences();
      syncPreferenceAppearance();
      $("#start-desktops-section")?.classList.toggle("hidden", !prefs.showDesktops || Boolean(query));
      const pinned = $("#start-pinned");
      pinned?.classList.toggle("hidden", !query && !getShowAll() && !prefs.showPinned);
      const recentItems = options.getRecentItems?.() || [];
      $("#start-recent-section")?.classList.toggle("hidden", !prefs.showRecent || !recentItems.length || Boolean(query) || getShowAll());
      const recent = $("#start-recent");
      if (recent) {
        recent.innerHTML = recentItems.slice(0, 4).map(item => `<button class="start-recent-item" data-start-recent="${safeAttr(item.id)}"><i aria-hidden="true">${item.icon || "📝"}</i><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.desktopName || "Документ")}</small></span><span aria-hidden="true">↗</span></button>`).join("");
        $$('[data-start-recent]', recent).forEach(button => button.addEventListener("click", () => { closeFloating(); options.openRecent?.(button.dataset.startRecent); }));
      }
      $("#start-quick-section")?.classList.toggle("hidden", !prefs.showQuickActions || !prefs.quickActions.length || Boolean(query) || getShowAll());
      const actions = $("#start-quick-actions");
      if (actions) {
        actions.innerHTML = prefs.quickActions.filter(id => START_QUICK_ACTIONS[id]).map(id => `<button data-start-quick="${id}"><span aria-hidden="true">${START_QUICK_ACTIONS[id][0]}</span>${START_QUICK_ACTIONS[id][1]}</button>`).join("");
        $$('[data-start-quick]', actions).forEach(button => button.addEventListener("click", () => { closeFloating(); options.quickAction?.(button.dataset.startQuick); }));
      }
      if (preferencesOpen) renderPreferences();
    }

    function currentFilter() {
      return $("#start-search-input")?.value || "";
    }

    function setItemPinned(itemId, pinned) {
      const item = getState().fs?.[itemId];
      if (!canPinItem(item)) return false;
      item.pinnedInStart = Boolean(pinned);
      item.startPinnedAt = item.pinnedInStart ? (Number(item.startPinnedAt) || Date.now()) : 0;
      item.updatedAt = Date.now();
      saveState();
      render(currentFilter());
      notify(item.pinnedInStart ? "Закреплено в Пуске" : "Откреплено из Пуска", item.name);
      return true;
    }

    function showItemMenu(event, itemId) {
      event.preventDefault();
      event.stopPropagation();
      const item = getState().fs?.[itemId];
      if (!canPinItem(item)) return false;
      const entries = buildItemMenuEntries({ item, icon: itemIcon(item) }).map(entry => [entry.icon, entry.label, () => {
        if (entry.action.type === "open") {
          closeFloating();
          return openItem(itemId);
        }
        if (entry.action.type === "set-start-pinned") return setItemPinned(itemId, entry.action.pinned);
      }]);
      showContextNearElement(event, entries, "auto");
      return true;
    }

    function render(filter = "") {
      const container = $("#start-pinned");
      if (!container) return false;
      if (preferencesOpen) { renderPreferences(); return true; }
      const query = normalizeStartQuery(filter);
      const title = $("#start-apps-title") || $(".start-section-title h2");
      const toggleAll = $("#start-all-apps");
      if (title) title.textContent = startTitleText({ showAll: getShowAll(), query });
      if (toggleAll) {
        toggleAll.textContent = startToggleAllText(getShowAll());
        toggleAll.classList.toggle("active", getShowAll());
      }

      const categories = $("#start-categories");
      categories?.classList.toggle("hidden", !getShowAll() || Boolean(query));
      if (categories) {
        categories.innerHTML = Object.entries(START_CATEGORIES).map(([id, label]) => `<button type="button" data-start-category="${id}" class="${category === id ? "active" : ""}" aria-pressed="${category === id}">${label}</button>`).join("");
        $$('[data-start-category]', categories).forEach(button => button.addEventListener("click", () => {
          category = button.dataset.startCategory;
          render(currentFilter());
          $(`[data-start-category="${category}"]`, categories)?.focus();
        }));
      }

      renderSecondarySections(query);
      container.classList.toggle("start-search-results", Boolean(query && options.searchResults));
      container.classList.toggle("start-catalog", !query && getShowAll());
      if (query && typeof options.searchResults === "function") {
        const results = options.searchResults(query);
        container.innerHTML = options.searchResultsHTML?.(results) || `<div class="start-empty">${startEmptyText({ query })}</div>`;
        $$('[data-search-kind]', container).forEach(button => button.addEventListener("click", () => { closeFloating(); options.openSearchResult?.(button); }));
        if (toggleAll) toggleAll.classList.add("hidden");
        return true;
      }
      toggleAll?.classList.remove("hidden");

      const state = getState();
      renderStartItems({
        container,
        apps: getApps(),
        items: Object.values(state.fs || {}),
        query,
        showAll: getShowAll(),
        category,
        pinOrder: preferences().pinOrder,
        onMovePin: movePin,
        canPinItem,
        itemSearchText: item => startItemSearchText(item, itemKind(item), itemDescription(item)),
        itemKind,
        itemIcon,
        onOpenApp: appId => {
          closeFloating();
          openApp(appId);
        },
        onShowAppMenu: showAppMenu,
        onOpenItem: itemId => {
          closeFloating();
          openItem(itemId);
        },
        onShowItemMenu: showItemMenu
      });
      renderDesktops();
      return true;
    }

    function renderDesktops() {
      ensureDesktops();
      const state = getState();
      renderStartDesktops({
        container: $("#start-desktops"),
        desktops: state.desktops,
        currentDesktopId: getCurrentDesktopId(),
        itemCount,
        desktopAvatarHTML,
        desktopName,
        desktopDescription,
        onSwitchDesktop: switchDesktop,
        onDeleteDesktop: deleteDesktop,
        onDesktopMenu: (event, desktopId, deletable) => {
          const entries = [
            ["✎", "Переименовать", () => options.desktopAction?.("rename", desktopId)],
            ["⚙", "Настроить рабочий стол", () => options.desktopAction?.("settings", desktopId)]
          ];
          if (deletable) entries.push(["🗑", "Удалить рабочий стол…", () => deleteDesktop(desktopId)]);
          showContextNearElement(event, entries, "auto");
        }
      });
    }

    function bindControls() {
      if (bound) return;
      bound = true;
      $("#start-search-input")?.addEventListener("input", event => render(event.target.value));
      $("#start-settings")?.addEventListener("click", () => setPreferencesOpen(!preferencesOpen));
      $("#start-clear-recent")?.addEventListener("click", async event => {
        if (event.currentTarget.disabled) return;
        event.currentTarget.disabled = true;
        try { await options.clearRecent?.(); }
        catch (error) { notify("История не очищена", "Не удалось сохранить изменения. Повторите попытку."); }
        finally { render(currentFilter()); $("#start-clear-recent") && ($("#start-clear-recent").disabled = false); }
      });
      $("#start-menu")?.addEventListener("keydown", event => {
        if (event.key === "Escape" && preferencesOpen) {
          event.preventDefault();
          event.stopPropagation();
          setPreferencesOpen(false);
          return;
        }
        if (!currentFilter() || preferencesOpen) return;
        const results = $$('[data-search-kind]', $("#start-pinned"));
        if (!results.length) return;
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const index = results.indexOf(document.activeElement);
          const nextIndex = index < 0
            ? (event.key === "ArrowDown" ? 0 : results.length - 1)
            : (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
          results[nextIndex]?.focus();
        } else if (event.key === "Enter" && event.target === $("#start-search-input")) {
          event.preventDefault();
          results[0].click();
        }
      });
      $("#start-new-desktop")?.addEventListener("click", event => {
        event.preventDefault();
        createDesktop();
      });
      $("#start-all-apps")?.addEventListener("click", event => {
        event.preventDefault();
        setShowAll(!getShowAll());
        render(currentFilter());
      });
    }

    function toggle() {
      const menu = $("#start-menu");
      if (!menu) return false;
      const willOpen = menu.classList.contains("hidden");
      closeFloating();
      menu.classList.toggle("hidden", !willOpen);
      $("#start-button")?.classList.toggle("active", willOpen);
      if (willOpen) {
        preferencesOpen = false;
        render(currentFilter());
        $("#start-search-input")?.focus();
      }
      return willOpen;
    }

    return Object.freeze({
      setItemPinned,
      showItemMenu,
      render,
      renderDesktops,
      bindControls,
      toggle
    });
  }

  window.ZETER_START_UI_UTILS = Object.freeze({
    normalizeStartQuery,
    startTitleText,
    startToggleAllText,
    startAppCategory,
    startAppButtonHTML,
    startFileButtonHTML,
    startEmptyText,
    startItemSearchText,
    startAppEntries,
    startItemEntries,
    renderStartItems,
    startDesktopCardHTML,
    renderStartDesktops,
    createStartPreferencesWriter,
    createStartMenuController
  });
})();
