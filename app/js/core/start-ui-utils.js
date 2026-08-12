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
    return showAll ? "Закреплено" : "Все";
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
    onShowItemMenu = () => {}
  } = {}) {
    if (!container) return;
    container.innerHTML = "";

    startAppEntries(apps, { query, showAll })
      .forEach(([id, app]) => {
        const button = document.createElement("button");
        button.className = "start-app";
        button.dataset.startApp = id;
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
        button.title = showKind ? `${item.name} · ${kind}` : (item.name || "");
        button.innerHTML = startFileButtonHTML({ icon: itemIcon(item), name: item.name, kind, showKind });
        button.addEventListener("click", () => onOpenItem(item.id));
        button.addEventListener("contextmenu", event => onShowItemMenu(event, item.id));
        container.appendChild(button);
      });

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
        <button class="start-desktop-main" data-switch-desktop="${safeAttr(id)}">
          <span class="start-desktop-titleline">${avatarHTML}<b>${escapeHtml(name)}</b></span>
          <span class="start-desktop-description">${escapeHtml(description)}</span>
          <span class="start-desktop-meta">${Number(count) || 0} элементов · ${active ? "активен" : `стол ${Number(index) + 1}`}</span>
        </button>
        ${deletable ? `<button class="start-desktop-delete" data-delete-desktop="${safeAttr(id)}" title="Удалить рабочий стол">×</button>` : ""}`;
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
    onDeleteDesktop = () => {}
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
    $$('[data-delete-desktop]', container).forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        onDeleteDesktop(button.dataset.deleteDesktop);
      });
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
      const query = normalizeStartQuery(filter);
      const title = $(".start-section-title h2");
      const toggleAll = $("#start-all-apps");
      if (title) title.textContent = startTitleText({ showAll: getShowAll(), query });
      if (toggleAll) {
        toggleAll.textContent = startToggleAllText(getShowAll());
        toggleAll.classList.toggle("active", getShowAll());
      }

      const state = getState();
      renderStartItems({
        container,
        apps: getApps(),
        items: Object.values(state.fs || {}),
        query,
        showAll: getShowAll(),
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
        onDeleteDesktop: deleteDesktop
      });
    }

    function bindControls() {
      $("#start-search-input")?.addEventListener("input", event => render(event.target.value));
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
        render(currentFilter());
        setTimeout(() => {
          renderDesktops();
          $("#start-search-input")?.focus();
        }, 50);
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
    startAppButtonHTML,
    startFileButtonHTML,
    startEmptyText,
    startItemSearchText,
    startAppEntries,
    startItemEntries,
    renderStartItems,
    startDesktopCardHTML,
    renderStartDesktops,
    createStartMenuController
  });
})();
