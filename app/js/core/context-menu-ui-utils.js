(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS context menu UI utils require core utils.");

  const { escapeHtml, clamp } = coreUtils;

  function contextMenuButtonHTML({ icon = "", label = "" } = {}) {
    return `<span>${icon} ${escapeHtml(label)}</span>`;
  }

  function contextMenuCloseButtonHTML() {
    return `<span>✕ Закрыть</span>`;
  }

  function buildItemContextMenuEntries({
    item,
    icon = "",
    canPinToStart = false,
    pinAppId = null,
    taskbarAppName = "",
    taskbarPinned = false,
    desktopRootId = null
  } = {}) {
    if (!item) return [];
    const entries = [
      { icon, label: "Открыть", action: { type: "open" } },
      { icon: "✏️", label: item.type === "folder" ? "Переименовать папку" : "Переименовать", action: { type: "rename" } },
      { icon: "📋", label: "Дублировать", action: { type: "duplicate" } }
    ];

    if (item.type === "folder") entries.push({ icon: "⚙️", label: "Настройка папки", action: { type: "item-settings" } });
    if (item.type === "shortcut") entries.push({ icon: "⚙️", label: "Настройка ярлыка", action: { type: "item-settings" } });

    if (canPinToStart) {
      entries.push({
        icon: "⭐",
        label: item.pinnedInStart ? "Открепить из Пуска" : "Закрепить в Пуске",
        action: { type: "set-start-pinned", pinned: !item.pinnedInStart }
      });
    }

    if (pinAppId) {
      entries.push({
        icon: "📌",
        label: taskbarPinned ? `Открепить ${taskbarAppName} от нижней панели` : `Закрепить ${taskbarAppName} на нижней панели`,
        action: { type: "set-taskbar-pinned", appId: pinAppId, pinned: !taskbarPinned }
      });
    }

    if (item.type === "folder") entries.push({ icon: "☑️", label: "Создать список задач в папке", action: { type: "create-task-list" } });
    if (item.type === "note") entries.push({ icon: "🗒️", label: "Сделать стикером на рабочем столе", action: { type: "make-sticky" } });
    if (item.parent !== desktopRootId) entries.push({ icon: "🖥️", label: "На рабочий стол", action: { type: "move-to-desktop" } });
    if (item.type !== "app") entries.push({ icon: "🔗", label: "Скопировать путь расположения", action: { type: "copy-location" } });

    entries.push(
      { icon: "ℹ️", label: "Свойства", action: { type: "properties" } },
      { type: "separator" },
      { icon: "🗑️", label: "Удалить", action: { type: "delete" } }
    );
    return entries;
  }

  function buildStartAppContextMenuEntries({ app, appId = "", taskbarPinned = false } = {}) {
    if (!app) return [];
    const entries = [{ icon: app.icon, label: "Открыть", action: { type: "open" } }];
    if (appId === "search") {
      entries.push({ icon: "⌕", label: "Поиск уже закреплён", action: { type: "search-pinned" } });
    } else {
      entries.push({
        icon: "📌",
        label: taskbarPinned ? "Открепить от нижней панели" : "Закрепить на нижней панели",
        action: { type: "set-taskbar-pinned", pinned: !taskbarPinned }
      });
    }
    return entries;
  }

  function buildStartItemContextMenuEntries({ item, icon = "" } = {}) {
    if (!item) return [];
    return [
      { icon, label: "Открыть", action: { type: "open" } },
      { icon: "⭐", label: "Открепить из Пуска", action: { type: "set-start-pinned", pinned: false } }
    ];
  }

  function buildRunningTaskbarWindowMenuEntries({ app = null, canPinToTaskbar = false, taskbarPinned = false } = {}) {
    const entries = [{ icon: app?.icon || "□", label: "Показать окно", action: { type: "show-window" } }];
    if (app && canPinToTaskbar) {
      entries.push({
        icon: "📌",
        label: taskbarPinned ? "Открепить приложение от панели" : "Закрепить приложение на панели",
        action: { type: "set-taskbar-pinned", pinned: !taskbarPinned }
      });
    }
    entries.push({ type: "separator" }, { icon: "×", label: "Закрыть окно", action: { type: "close-window" } });
    return entries;
  }

  function buildTaskbarPinnedAppMenuEntries({ app = null } = {}) {
    if (!app) return [];
    return [
      { icon: app.icon, label: "Открыть", action: { type: "open" } },
      { icon: "📌", label: "Открепить от нижней панели", action: { type: "set-taskbar-pinned", pinned: false } }
    ];
  }

  function buildSnapMenuEntries() {
    return [
      { icon: "◧", label: "Левая половина", action: { type: "snap", mode: "left" } },
      { icon: "◨", label: "Правая половина", action: { type: "snap", mode: "right" } },
      { icon: "▣", label: "На весь экран", action: { type: "snap", mode: "max" } },
      { icon: "□", label: "Восстановить", action: { type: "restore" } }
    ];
  }

  function buildLockedTaskbarMenuEntries(kind = "") {
    if (kind === "start") return [{ icon: "⊞", label: "Меню Пуск закреплено", action: { type: "locked-start" } }];
    if (kind === "search") return [{ icon: "⌕", label: "Поиск закреплён", action: { type: "locked-search" } }];
    return [];
  }

  function buildDesktopMenuEntries() {
    return [
      { icon: "🔄", label: "Обновить", action: { type: "refresh" } },
      { icon: "📁", label: "Новая папка", action: { type: "create-folder" } },
      { icon: "📄", label: "Создать файл", action: { type: "create-file" } },
      { icon: "🔗", label: "Создать ярлык", action: { type: "create-shortcut" } },
      { icon: "▦", label: "Новая таблица", action: { type: "create-table" } },
      { icon: "☑️", label: "Создать список задач", action: { type: "create-task-list" } },
      { icon: "🗒️", label: "Новая заметка", action: { type: "create-note" } },
      { type: "separator" },
      { icon: "↶", label: "Отменить последнее действие", action: { type: "undo" } },
      { icon: "💾", label: "Экспорт ZIP-бэкапа", action: { type: "export" } },
      { icon: "📥", label: "Импорт ZIP/JSON-бэкапа", action: { type: "import" } },
      { icon: "⚙️", label: "Настройки", action: { type: "settings" } }
    ];
  }

  function buildDesktopMenuActionEntries(actionHandlers = {}) {
    const handlers = actionHandlers && typeof actionHandlers === "object" ? actionHandlers : {};
    return buildDesktopMenuEntries().map(entry => {
      if (entry.type === "separator") return ["", "hr"];
      return [entry.icon, entry.label, () => handlers[entry.action.type]?.(entry.action)];
    });
  }

  function mapContextActionEntries(entries = [], onAction = () => {}) {
    return entries.map(entry => {
      if (entry.type === "separator") return ["", "hr"];
      return [entry.icon, entry.label, () => onAction(entry.action)];
    });
  }

  function createDesktopContextMenuController(options = {}) {
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const getItem = typeof options.getItem === "function" ? options.getItem : () => null;
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "";
    const canPinToStart = typeof options.canPinToStart === "function" ? options.canPinToStart : () => false;
    const itemTaskbarAppId = typeof options.itemTaskbarAppId === "function" ? options.itemTaskbarAppId : () => null;
    const getAppName = typeof options.getAppName === "function" ? options.getAppName : () => "";
    const isTaskbarPinned = typeof options.isTaskbarPinned === "function" ? options.isTaskbarPinned : () => false;
    const showContext = typeof options.showContext === "function" ? options.showContext : () => {};
    const refreshDesktop = typeof options.refreshDesktop === "function" ? options.refreshDesktop : () => {};
    const createFolder = typeof options.createFolder === "function" ? options.createFolder : () => {};
    const createFile = typeof options.createFile === "function" ? options.createFile : () => {};
    const createShortcut = typeof options.createShortcut === "function" ? options.createShortcut : () => {};
    const createTable = typeof options.createTable === "function" ? options.createTable : () => {};
    const createTaskList = typeof options.createTaskList === "function" ? options.createTaskList : () => {};
    const createNote = typeof options.createNote === "function" ? options.createNote : () => {};
    const undo = typeof options.undo === "function" ? options.undo : () => {};
    const exportData = typeof options.exportData === "function" ? options.exportData : () => {};
    const openImport = typeof options.openImport === "function" ? options.openImport : () => {};
    const openSettings = typeof options.openSettings === "function" ? options.openSettings : () => {};
    const itemActions = options.itemActions && typeof options.itemActions === "object" ? options.itemActions : {};

    function showDesktopMenu(event) {
      if (event.target.closest(".desktop-icon,.desktop-sticky,.window,.taskbar,.start-menu")) return false;
      event.preventDefault();
      const desktopRoot = getDesktopRoot();
      const point = { x: event.clientX, y: event.clientY };
      const entries = buildDesktopMenuActionEntries({
        refresh: refreshDesktop,
        "create-folder": () => createFolder(desktopRoot, point),
        "create-file": () => createFile(desktopRoot, point),
        "create-shortcut": () => createShortcut(desktopRoot, point),
        "create-table": () => createTable(desktopRoot, point),
        "create-task-list": () => createTaskList(desktopRoot, point),
        "create-note": () => createNote(desktopRoot, point),
        undo,
        export: exportData,
        import: openImport,
        settings: openSettings
      });
      showContext(event.clientX, event.clientY, entries);
      return true;
    }

    function showItemMenu(event, itemId) {
      event.preventDefault();
      event.stopPropagation();
      const item = getItem(itemId);
      if (!item) return false;
      const pinAppId = itemTaskbarAppId(item);
      const entries = mapContextActionEntries(buildItemContextMenuEntries({
        item,
        icon: itemIcon(item),
        canPinToStart: canPinToStart(item),
        pinAppId,
        taskbarAppName: pinAppId ? getAppName(pinAppId) : "",
        taskbarPinned: pinAppId ? isTaskbarPinned(pinAppId) : false,
        desktopRootId: getDesktopRoot()
      }), action => itemActions[action.type]?.(itemId, action, item));
      showContext(event.clientX, event.clientY, entries);
      return true;
    }

    return Object.freeze({ showDesktopMenu, showItemMenu });
  }

  function buildExplorerEmptyAreaMenuEntries({ showInExplorerTree = false } = {}) {
    return [
      { icon: "🔄", label: "Обновить", action: { type: "refresh" } },
      { icon: "☑️", label: "Выделить всё", action: { type: "select-all" } },
      { icon: "📁", label: "Новая папка", action: { type: "create-folder", showInExplorerTree } },
      { icon: "📄", label: "Создать файл", action: { type: "create-file" } },
      { icon: "🔗", label: "Создать ярлык", action: { type: "create-shortcut" } },
      { icon: "▦", label: "Новая таблица", action: { type: "create-table" } },
      { icon: "☑️", label: "Создать список задач", action: { type: "create-task-list" } },
      { icon: "🗒️", label: "Новая заметка", action: { type: "create-note" } },
      { icon: "📘", label: "Markdown файл", action: { type: "create-markdown" } }
    ];
  }

  function buildExplorerFolderMenuEntries() {
    return [
      { icon: "📂", label: "Открыть", action: { type: "open" } },
      { icon: "＋", label: "Открыть во вкладке", action: { type: "open-in-tab" } },
      { icon: "🪟", label: "Открыть отдельным окном", action: { type: "open-in-window" } },
      { icon: "✏️", label: "Переименовать папку", action: { type: "rename" } },
      { icon: "📋", label: "Дублировать", action: { type: "duplicate" } },
      { icon: "⚙️", label: "Настройка папки", action: { type: "item-settings" } },
      { icon: "☑️", label: "Создать список задач в папке", action: { type: "create-task-list" } },
      { icon: "🔗", label: "Скопировать путь расположения", action: { type: "copy-location" } },
      { icon: "ℹ️", label: "Свойства", action: { type: "properties" } },
      { type: "separator" },
      { icon: "🗑️", label: "Удалить", action: { type: "delete" } }
    ];
  }

  function renderContextMenu({ menu, x, y, entries = [], anchorEl = null, placement, viewport = window } = {}) {
    if (!menu) return false;
    const documentRef = menu.ownerDocument || document;
    const safeEntries = Array.isArray(entries) ? entries : [];
    menu.innerHTML = "";

    for (const entry of safeEntries) {
      if (entry?.[1] === "hr") {
        menu.appendChild(documentRef.createElement("hr"));
        continue;
      }

      const button = documentRef.createElement("button");
      button.innerHTML = contextMenuButtonHTML({ icon: entry?.[0], label: entry?.[1] });
      button.addEventListener("click", () => {
        menu.classList.add("hidden");
        entry?.[2]?.();
      });
      menu.appendChild(button);
    }

    menu.appendChild(documentRef.createElement("hr"));

    const closeButton = documentRef.createElement("button");
    closeButton.className = "context-close-btn";
    closeButton.innerHTML = contextMenuCloseButtonHTML();
    closeButton.addEventListener("click", () => menu.classList.add("hidden"));
    menu.appendChild(closeButton);

    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.visibility = "hidden";
    menu.classList.remove("hidden");

    const gap = 8;
    const menuWidth = menu.offsetWidth || 250;
    const menuHeight = menu.offsetHeight || 180;
    let left = Number.isFinite(x) ? x : gap;
    let top = Number.isFinite(y) ? y : gap;

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      left = rect.left + rect.width / 2 - menuWidth / 2;

      const placeAbove = placement === "above" || (placement !== "below" && rect.top > viewport.innerHeight / 2);
      if (placeAbove) {
        top = rect.top - menuHeight - gap;
        if (top < gap) top = rect.bottom + gap;
      } else {
        top = rect.bottom + gap;
        if (top + menuHeight > viewport.innerHeight - gap) top = rect.top - menuHeight - gap;
      }
    }

    left = clamp(left, gap, Math.max(gap, viewport.innerWidth - menuWidth - gap));
    top = clamp(top, gap, Math.max(gap, viewport.innerHeight - menuHeight - gap));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "";
    return true;
  }

  window.ZETER_CONTEXT_MENU_UI_UTILS = Object.freeze({
    contextMenuButtonHTML,
    contextMenuCloseButtonHTML,
    buildItemContextMenuEntries,
    buildStartAppContextMenuEntries,
    buildStartItemContextMenuEntries,
    buildRunningTaskbarWindowMenuEntries,
    buildTaskbarPinnedAppMenuEntries,
    buildSnapMenuEntries,
    buildLockedTaskbarMenuEntries,
    buildDesktopMenuEntries,
    buildDesktopMenuActionEntries,
    mapContextActionEntries,
    createDesktopContextMenuController,
    buildExplorerEmptyAreaMenuEntries,
    buildExplorerFolderMenuEntries,
    renderContextMenu
  });
})();
