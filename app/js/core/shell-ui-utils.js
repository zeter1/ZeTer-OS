(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS shell UI utils require core utils.");

  const { $, $$, parseISO, escapeHtml } = coreUtils;

  function formatDate(iso, full = false) {
    const d = typeof iso === "string" ? parseISO(iso) : iso;
    return d.toLocaleDateString("ru-RU", full
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
    $("#clock").textContent = time;
    $("#date-line").textContent = date;
    $("#lock-time").textContent = time;
    $("#lock-date").textContent = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  }

  function toast(title, text = "") {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span>`;
    $("#toast-stack").appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  function createRunningTaskbarButton({ winId = "", name = "", icon = "" } = {}) {
    const button = document.createElement("button");
    button.className = "task-button taskbar-app";
    button.dataset.winId = winId;
    button.title = name;
    button.textContent = icon;
    return button;
  }

  function createPinnedTaskbarButton({ appId = "", name = "", icon = "" } = {}) {
    const button = document.createElement("button");
    button.className = "task-button taskbar-pinned-app";
    button.dataset.taskbarPinnedApp = appId;
    button.title = name;
    button.textContent = icon;
    return button;
  }

  function createTaskbarController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const getWindows = typeof options.getWindows === "function" ? options.getWindows : () => new Map();
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderStart = typeof options.renderStart === "function" ? options.renderStart : () => {};
    const openByDataApp = typeof options.openByDataApp === "function" ? options.openByDataApp : () => {};
    const showContextNearElement = typeof options.showContextNearElement === "function" ? options.showContextNearElement : () => {};
    const focusWindow = typeof options.focusWindow === "function" ? options.focusWindow : () => {};
    const closeWindow = typeof options.closeWindow === "function" ? options.closeWindow : () => {};
    const closeFloating = typeof options.closeFloating === "function" ? options.closeFloating : () => {};
    const notify = typeof options.toast === "function" ? options.toast : toast;
    const normalizeTaskbarPinnedApps = typeof options.normalizeTaskbarPinnedApps === "function" ? options.normalizeTaskbarPinnedApps : list => list;
    const canPinAppToTaskbar = typeof options.canPinAppToTaskbar === "function" ? options.canPinAppToTaskbar : () => false;
    const lockedTaskbarItems = options.lockedTaskbarItems || new Set();
    const staticTaskbarAppIds = options.staticTaskbarAppIds || new Set();
    const buildLockedTaskbarMenuEntries = typeof options.buildLockedTaskbarMenuEntries === "function" ? options.buildLockedTaskbarMenuEntries : () => [];
    const buildTaskbarPinnedAppMenuEntries = typeof options.buildTaskbarPinnedAppMenuEntries === "function" ? options.buildTaskbarPinnedAppMenuEntries : () => [];
    const buildRunningTaskbarWindowMenuEntries = typeof options.buildRunningTaskbarWindowMenuEntries === "function" ? options.buildRunningTaskbarWindowMenuEntries : () => [];
    const buildStartAppContextMenuEntries = typeof options.buildStartAppContextMenuEntries === "function" ? options.buildStartAppContextMenuEntries : () => [];

    function ensurePinnedContainer() {
      let container = $("#taskbar-pinned-extra");
      if (container) return container;
      const taskbarApps = $("#taskbar-apps");
      const taskbar = $("#taskbar");
      if (!taskbar || !taskbarApps) return null;
      container = document.createElement("div");
      container.id = "taskbar-pinned-extra";
      container.className = "taskbar-pinned-extra";
      taskbar.insertBefore(container, taskbarApps);
      return container;
    }

    function pinnedApps() {
      const state = getState();
      state.taskbarPinnedApps = normalizeTaskbarPinnedApps(state.taskbarPinnedApps);
      return state.taskbarPinnedApps;
    }

    function isPinned(appId) {
      return pinnedApps().includes(appId);
    }

    function setPinned(appId, pinned) {
      const apps = getApps();
      const app = apps[appId];
      if (!app) return false;
      if (lockedTaskbarItems.has(appId)) {
        notify("Нельзя открепить", `${app.name} закреплён системно.`);
        return false;
      }
      if (!canPinAppToTaskbar(appId)) return false;
      const current = pinnedApps().filter(id => id !== appId);
      if (pinned) current.push(appId);
      getState().taskbarPinnedApps = normalizeTaskbarPinnedApps(current);
      saveState();
      renderPinned();
      renderStart($("#start-search-input")?.value || "");
      notify(pinned ? "Закреплено на панели" : "Откреплено от панели", app.name);
      return true;
    }

    function renderPinned() {
      const container = ensurePinnedContainer();
      if (!container) return false;
      const apps = getApps();
      const pinned = pinnedApps();
      container.innerHTML = "";

      $$("#taskbar [data-app]").forEach(button => {
        const appId = button.dataset.app;
        if (!apps[appId]) return;
        button.classList.add("taskbar-pinned-static");
        button.classList.toggle("hidden", !pinned.includes(appId));
        button.oncontextmenu = event => showPinnedAppMenu(event, appId);
      });

      pinned
        .filter(appId => !staticTaskbarAppIds.has(appId))
        .forEach(appId => {
          const app = apps[appId];
          if (!app || !canPinAppToTaskbar(appId)) return;
          const button = createPinnedTaskbarButton({ appId, name: app.name, icon: app.icon });
          button.addEventListener("click", () => openByDataApp(appId));
          button.addEventListener("contextmenu", event => showPinnedAppMenu(event, appId));
          container.appendChild(button);
        });
      return true;
    }

    function bindLockedContextMenus() {
      const start = $("#start-button");
      const search = $(".taskbar-search");
      start?.addEventListener("contextmenu", event => {
        event.preventDefault();
        const entries = buildLockedTaskbarMenuEntries("start").map(entry => [entry.icon, entry.label, () => notify("Нельзя открепить", "Меню Пуск всегда остаётся на панели.")]);
        showContextNearElement(event, entries);
      });
      search?.addEventListener("contextmenu", event => {
        event.preventDefault();
        const entries = buildLockedTaskbarMenuEntries("search").map(entry => [entry.icon, entry.label, () => notify("Нельзя открепить", "Поиск всегда остаётся на панели.")]);
        showContextNearElement(event, entries);
      });
    }

    function showPinnedAppMenu(event, appId) {
      event.preventDefault();
      event.stopPropagation();
      const app = getApps()[appId];
      if (!app) return false;
      const entries = buildTaskbarPinnedAppMenuEntries({ app }).map(entry => [entry.icon, entry.label, () => {
        if (entry.action.type === "open") return openByDataApp(appId);
        if (entry.action.type === "set-taskbar-pinned") return setPinned(appId, entry.action.pinned);
      }]);
      showContextNearElement(event, entries);
      return true;
    }

    function showRunningWindowMenu(event, winId) {
      event.preventDefault();
      event.stopPropagation();
      const record = getWindows().get(winId);
      if (!record) return false;
      const app = getApps()[record.appId];
      const entries = buildRunningTaskbarWindowMenuEntries({
        app,
        canPinToTaskbar: app && canPinAppToTaskbar(record.appId),
        taskbarPinned: app ? isPinned(record.appId) : false
      }).map(entry => {
        if (entry.type === "separator") return ["", "hr"];
        return [entry.icon, entry.label, () => {
          if (entry.action.type === "show-window") {
            record.el.classList.remove("minimized");
            return focusWindow(winId);
          }
          if (entry.action.type === "set-taskbar-pinned") return setPinned(record.appId, entry.action.pinned);
          if (entry.action.type === "close-window") return closeWindow(winId);
        }];
      });
      showContextNearElement(event, entries);
      return true;
    }

    function showStartAppMenu(event, appId) {
      event.preventDefault();
      event.stopPropagation();
      const app = getApps()[appId];
      if (!app) return false;
      const entries = buildStartAppContextMenuEntries({
        app,
        appId,
        taskbarPinned: appId === "search" ? false : isPinned(appId)
      }).map(entry => [entry.icon, entry.label, () => {
        if (entry.action.type === "open") {
          closeFloating();
          return openByDataApp(appId);
        }
        if (entry.action.type === "search-pinned") return notify("Поиск", "Поиск находится на панели постоянно.");
        if (entry.action.type === "set-taskbar-pinned") return setPinned(appId, entry.action.pinned);
      }]);
      showContextNearElement(event, entries, "auto");
      return true;
    }

    return Object.freeze({
      pinnedApps,
      isPinned,
      setPinned,
      renderPinned,
      bindLockedContextMenus,
      showPinnedAppMenu,
      showRunningWindowMenu,
      showStartAppMenu
    });
  }

  function createShellRuntimeController(options = {}) {
    const documentRef = options.documentRef || document;
    const windowRef = options.windowRef || window;
    const navigatorRef = options.navigatorRef || navigator;
    const locationRef = options.locationRef || location;
    const ElementCtor = options.ElementCtor || windowRef.Element;
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const getRuntimeUi = typeof options.getRuntimeUi === "function" ? options.getRuntimeUi : () => ({});
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const getDesktopName = typeof options.getDesktopName === "function" ? options.getDesktopName : id => String(id || "");
    const getSettings = typeof options.getSettings === "function" ? options.getSettings : () => ({});
    const getSystemSettings = typeof options.getSystemSettings === "function" ? options.getSystemSettings : () => ({});
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderDesktop = typeof options.renderDesktop === "function" ? options.renderDesktop : () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const toastMessage = typeof options.toast === "function" ? options.toast : () => {};
    const openApp = typeof options.openApp === "function" ? options.openApp : () => {};
    const closeWindow = typeof options.closeWindow === "function" ? options.closeWindow : () => false;
    const exportData = typeof options.exportData === "function" ? options.exportData : () => {};
    const importData = typeof options.importData === "function" ? options.importData : () => {};
    const chooseExternalSaveFolder = typeof options.chooseExternalSaveFolder === "function" ? options.chooseExternalSaveFolder : () => {};
    const importNativeFiles = typeof options.importNativeFiles === "function" ? options.importNativeFiles : () => {};
    const startMenuController = options.startMenuController || {};
    const globalSearchOverlay = options.globalSearchOverlay || {};
    const notificationCenterController = options.notificationCenterController || {};
    const bindNotificationCenter = typeof options.bindNotificationCenter === "function" ? options.bindNotificationCenter : () => {};
    const openNotification = typeof options.openNotification === "function" ? options.openNotification : () => {};
    const showDesktopMenu = typeof options.showDesktopMenu === "function" ? options.showDesktopMenu : () => {};
    const bindDesktopSelectionBox = typeof options.bindDesktopSelectionBox === "function" ? options.bindDesktopSelectionBox : () => {};
    const cycleWindows = typeof options.cycleWindows === "function" ? options.cycleWindows : () => {};
    const undoLastAction = typeof options.undoLastAction === "function" ? options.undoLastAction : () => {};
    const openItem = typeof options.openItem === "function" ? options.openItem : () => {};
    const deleteItems = typeof options.deleteItems === "function" ? options.deleteItems : () => {};
    const markNotificationsRead = typeof options.markNotificationsRead === "function" ? options.markNotificationsRead : () => {};
    const renderNotifications = typeof options.renderNotifications === "function" ? options.renderNotifications : () => {};
    const keepWindowsInBounds = typeof options.keepWindowsInBounds === "function" ? options.keepWindowsInBounds : () => {};
    const normalizeVisualSettings = typeof options.normalizeVisualSettings === "function" ? options.normalizeVisualSettings : settings => settings;
    const normalizeSystemSettings = typeof options.normalizeSystemSettings === "function" ? options.normalizeSystemSettings : settings => settings;
    const hotkeyActionForEvent = typeof options.hotkeyActionForEvent === "function" ? options.hotkeyActionForEvent : () => "";
    const switchRelativeDesktop = typeof options.switchRelativeDesktop === "function" ? options.switchRelativeDesktop : () => false;
    const customWallpaperCssUrl = typeof options.customWallpaperCssUrl === "function" ? options.customWallpaperCssUrl : () => "none";
    const firstRunScreenHTML = typeof options.firstRunScreenHTML === "function" ? options.firstRunScreenHTML : () => "";
    const osVersion = String(options.osVersion || "");
    const initSteps = options.initSteps && typeof options.initSteps === "object" ? options.initSteps : {};
    const purgeExpiredTrash = typeof options.purgeExpiredTrash === "function" ? options.purgeExpiredTrash : () => false;
    const refreshRecycleBinWindows = typeof options.refreshRecycleBinWindows === "function" ? options.refreshRecycleBinWindows : () => {};
    const updateClockAction = typeof options.updateClock === "function" ? options.updateClock : () => {};
    const prepareCalendarForTray = typeof options.prepareCalendarForTray === "function" ? options.prepareCalendarForTray : () => {};
    const systemPulse = typeof options.systemPulse === "function" ? options.systemPulse : () => {};
    const setIntervalAction = typeof options.setInterval === "function" ? options.setInterval : setInterval;
    const setTimeoutAction = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;

    function registerPWA() {
      if (initSteps.shouldUseNativeStorage?.()) return;
      if (!("serviceWorker" in navigatorRef)) return;
      if (!["http:", "https:"].includes(locationRef.protocol)) return;
      navigatorRef.serviceWorker.register("service-worker.js").catch(error => console.warn("[ZeTer OS PWA]", error));
    }

    function finishBoot() {
      window.ZETER_BOOT_GUARD?.markReady();
      $("#boot")?.classList.add("done");
    }

    function safeInitStep(label, action) {
      try {
        action();
      } catch (error) {
        console.error(`[ZeTer OS boot] ${label}:`, error);
        try { toastMessage("ZeTer OS", `Пропущена ошибка загрузки: ${label}`); } catch {}
      }
    }

    function showFirstRunScreen() {
      const state = getState();
      if (state.firstRunCompleted) return;
      const overlay = documentRef.createElement("section");
      overlay.className = "first-run-screen";
      overlay.innerHTML = firstRunScreenHTML(osVersion);
      documentRef.body.appendChild(overlay);
      const done = () => {
        state.firstRunCompleted = true;
        saveState();
        overlay.remove();
      };
      overlay.addEventListener("click", event => {
        if (event.target.closest("[data-first-create]")) {
          done();
          toastMessage("Рабочее пространство готово", getDesktopName(getDesktopRoot()));
        }
        if (event.target.closest("[data-first-import]")) {
          done();
          $("#import-file")?.click();
        }
        if (event.target.closest("[data-first-help]")) {
          done();
          openApp("help");
        }
      });
    }

    function applySettings() {
      const settings = normalizeVisualSettings(getSettings());
      const systemSettings = normalizeSystemSettings(getSystemSettings());
      const accessibility = systemSettings.accessibility || {};
      const activeWallpaper = settings.wallpaper === "custom" && settings.customWallpaper?.dataURL
        ? "custom"
        : (settings.wallpaper || "aurora");
      documentRef.body.classList.remove("light");
      documentRef.body.classList.remove("wall-aurora", "wall-silk", "wall-mint", "wall-graphite", "wall-custom");
      documentRef.body.classList.add(`wall-${activeWallpaper}`);
      documentRef.documentElement.style.setProperty("--custom-wallpaper-image", customWallpaperCssUrl(settings.customWallpaper));
      documentRef.documentElement.style.setProperty("--custom-wallpaper-preview", customWallpaperCssUrl(settings.customWallpaper));
      documentRef.documentElement.style.setProperty("--blur", "0px");
      documentRef.documentElement.style.setProperty("--zeter-text-scale", String((Number(accessibility.textScale) || 100) / 100));
      documentRef.body.classList.toggle("zeter-large-controls", Boolean(accessibility.largeControls));
      documentRef.body.classList.toggle("zeter-high-contrast", Boolean(accessibility.highContrast));
      documentRef.body.classList.toggle("zeter-reduced-motion", Boolean(accessibility.reducedMotion));
      $("#os").style.filter = "brightness(100%)";
      const volumeControl = $("#volume");
      if (volumeControl) volumeControl.value = settings.volume || 74;
      $$('[data-quick-wall]').forEach(button => button.classList.toggle("active", button.dataset.quickWall === activeWallpaper));
    }

    function init() {
      try {
        safeInitStep("ensureDesktops", initSteps.ensureDesktops || (() => {}));
        safeInitStep("applyStartupPreferences", initSteps.applyStartupPreferences || (() => {}));
        safeInitStep("removeWorkspaceDocumentsFolders", initSteps.removeWorkspaceDocumentsFolders || (() => {}));
        safeInitStep("normalizeNotesData", initSteps.normalizeNotesData || (() => {}));
        safeInitStep("purgeExpiredTrash", () => { if (purgeExpiredTrash()) saveState(); });
        safeInitStep("sanitizeWorkspaceWindowSessions", initSteps.sanitizeWorkspaceWindowSessions || (() => {}));
        safeInitStep("sanitizeExplorerSpaces", initSteps.sanitizeExplorerSpaces || (() => {}));
        safeInitStep("removeExplorerAppShortcuts", initSteps.removeExplorerAppShortcuts || (() => {}));
        safeInitStep("initExternalSaveFolder", initSteps.initExternalSaveFolder || (() => {}));
        safeInitStep("registerPWA", registerPWA);
        safeInitStep("applySettings", applySettings);
        safeInitStep("renderDesktop", renderDesktop);
        safeInitStep("renderStart", initSteps.renderStart || (() => {}));
        safeInitStep("renderTaskbarPinnedApps", initSteps.renderTaskbarPinnedApps || (() => {}));
        safeInitStep("renderNotifications", renderNotifications);
        safeInitStep("startTaskReminderWatcher", initSteps.startTaskReminderWatcher || (() => {}));
        if (initSteps.shouldRestoreWindows?.() !== false) {
          safeInitStep("restoreWindowsForCurrentDesktop", initSteps.restoreWindowsForCurrentDesktop || (() => {}));
        }
        safeInitStep("bindGlobal", bindGlobal);
        safeInitStep("updateClock", updateClockAction);
        safeInitStep("firstRunScreen", showFirstRunScreen);
        setIntervalAction(() => safeInitStep("updateClock", updateClockAction), 1000);
        setIntervalAction(() => safeInitStep("systemPulse", systemPulse), 4000);
        setIntervalAction(() => safeInitStep("purgeExpiredTrash", () => {
          if (purgeExpiredTrash()) {
            saveState();
            renderFileSurfaces();
            refreshRecycleBinWindows();
          }
        }), 60 * 60 * 1000);
      } finally {
        setTimeoutAction(finishBoot, 1050);
        setTimeoutAction(finishBoot, 2500);
      }
    }

    function isTextInputTarget(target) {
      const element = ElementCtor && target instanceof ElementCtor ? target : null;
      if (!element) return false;
      if (element.closest(".desktop-icon")) return false;
      return Boolean(element.closest("input, textarea, select, button, [contenteditable]"));
    }

    function closeGlobalSearch() {
      return globalSearchOverlay.close?.();
    }

    function closeFloating() {
      $("#start-menu").classList.add("hidden");
      $("#quick-panel").classList.add("hidden");
      $("#notification-center").classList.add("hidden");
      closeGlobalSearch();
      $("#context-menu").classList.add("hidden");
      $("#start-button").classList.remove("active");
    }

    function toggleStart() {
      return startMenuController.toggle?.();
    }

    function togglePanel(which) {
      const quick = $("#quick-panel");
      const notifications = $("#notification-center");
      const target = which === "quick" ? quick : notifications;
      const willOpen = target.classList.contains("hidden");
      closeFloating();
      if (which === "notifications" && willOpen) markNotificationsRead();
      if (which === "notifications") renderNotifications();
      target.classList.toggle("hidden", !willOpen);
    }

    function openGlobalSearch(query = "", focus = true, placement = "top") {
      return globalSearchOverlay.open?.(query, focus, placement);
    }

    function toggleGlobalSearch() {
      return globalSearchOverlay.toggle?.();
    }

    function toggleCalendarFromTray() {
      closeFloating();
      const windows = getRuntimeUi()?.windows;
      const desktopId = getDesktopRoot();
      const existing = windows?.values
        ? Array.from(windows.values()).find(record => record?.appId === "calendar" && record.desktopId === desktopId)
        : null;
      if (existing) return closeWindow(existing.winId);
      prepareCalendarForTray();
      return openApp("calendar");
    }

    function handleTopMenuAction(action) {
      if (action !== "search") closeFloating();
      if (action === "export") return exportData();
      if (action === "import") return $("#import-file")?.click();
      if (action === "settings") return openApp("settings");
      if (action === "security") return openApp("security");
      if (action === "monitor") return openApp("monitor");
      if (action === "calendar") return openApp("calendar");
      if (action === "appcenter") return openApp("appcenter");
      if (action === "search") return toggleGlobalSearch();
    }

    function runConfiguredHotkey(action = "") {
      if (action === "search") return toggleGlobalSearch();
      if (action === "start") return toggleStart();
      if (action === "settings") return openApp("settings");
      if (action === "calendar") return toggleCalendarFromTray();
      if (action === "notifications") return togglePanel("notifications");
      if (action === "previousDesktop") return switchRelativeDesktop(-1);
      if (action === "nextDesktop") return switchRelativeDesktop(1);
      return false;
    }

    function openByDataApp(appId) {
      if (appId === "search") return toggleGlobalSearch();
      openApp(appId);
    }

    function restartShell() {
      $("#boot").classList.remove("done");
      closeFloating();
      setTimeoutAction(() => {
        $("#boot").classList.add("done");
        toastMessage("ZeTer OS", "Оболочка перезапущена");
      }, 800);
    }

    function lock() {
      closeFloating();
      $("#lock-screen").classList.remove("hidden");
    }

    function bindGlobal() {
      documentRef.addEventListener("pointerdown", event => {
        const menu = $("#context-menu");
        if (!menu || menu.classList.contains("hidden") || event.button !== 0) return;
        if (!event.target.closest("#context-menu")) menu.classList.add("hidden");
      }, true);

      $("#start-button").addEventListener("click", toggleStart);
      $("#tray").addEventListener("click", toggleCalendarFromTray);
      $("#notifications-button").addEventListener("click", () => togglePanel("notifications"));
      bindNotificationCenter({
        notificationList: $("#notification-list"),
        notificationCenter: $("#notification-center"),
        controller: notificationCenterController,
        openNotification
      });
      startMenuController.bindControls?.();
      globalSearchOverlay.bind?.();
      $("#desktop").addEventListener("contextmenu", showDesktopMenu);
      $("#desktop").addEventListener("click", event => {
        if (!event.target.closest(".desktop-icon,.desktop-sticky,.context-menu,.start-menu,.quick-panel,.notification-center,.global-search,.window,.taskbar")) {
          getRuntimeUi().selectedDesktop = null;
          renderDesktop();
          closeFloating();
        }
      });
      bindDesktopSelectionBox();
      documentRef.addEventListener("keydown", event => {
        const targetElement = ElementCtor && event.target instanceof ElementCtor ? event.target : null;
        if (event.altKey && event.key === "Tab") { event.preventDefault(); cycleWindows(event.shiftKey); return; }
        if (event.key === "Escape") closeFloating();
        if (isTextInputTarget(event.target)) return;
        const configuredAction = hotkeyActionForEvent(event, getSystemSettings());
        if (configuredAction) {
          event.preventDefault();
          runConfiguredHotkey(configuredAction);
          return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoLastAction(); return; }
        if (event.key === "Enter" && getRuntimeUi().selectedDesktop) openItem(getRuntimeUi().selectedDesktop);
        if (event.key === "Delete") {
          if (targetElement?.closest(".window")) return;
          const runtimeUi = getRuntimeUi();
          const ids = runtimeUi.multiSelected?.size ? [...runtimeUi.multiSelected] : (runtimeUi.selectedDesktop ? [runtimeUi.selectedDesktop] : []);
          if (ids.length) { event.preventDefault(); deleteItems(ids); }
        }
      });
      $$("[data-close-panel]").forEach(button => button.addEventListener("click", closeFloating));
      $$("[data-app]").forEach(button => button.addEventListener("click", () => openByDataApp(button.dataset.app)));
      $$("[data-top-action]").forEach(button => button.addEventListener("click", () => handleTopMenuAction(button.dataset.topAction)));
      $("#lock-shortcut")?.addEventListener("click", lock);
      $("#restart-shortcut")?.addEventListener("click", restartShell);
      $("#export-shortcut")?.addEventListener("click", exportData);
      $("#quick-folder-save")?.addEventListener("click", chooseExternalSaveFolder);
      $("#quick-export")?.addEventListener("click", exportData);
      $("#quick-import")?.addEventListener("click", () => $("#import-file").click());
      $("#import-file").addEventListener("change", importData);
      $("#unlock").addEventListener("click", () => $("#lock-screen").classList.add("hidden"));
      $("#volume")?.addEventListener("input", event => {
        getSettings().volume = Number(event.target.value);
        applySettings();
        saveState();
      });
      $$('[data-quick-wall]').forEach(button => button.addEventListener("click", () => {
        getSettings().wallpaper = button.dataset.quickWall;
        applySettings();
        saveState();
      }));
      $("#desktop-items").addEventListener("dragover", event => { if (event.dataTransfer && event.dataTransfer.types.includes("Files")) event.preventDefault(); });
      $("#desktop-items").addEventListener("drop", event => {
        if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) {
          event.preventDefault();
          importNativeFiles(event.dataTransfer.files, getDesktopRoot(), event.clientX, event.clientY);
        }
      });
      windowRef.addEventListener("resize", () => {
        keepWindowsInBounds();
        renderDesktop();
      });
    }

    return Object.freeze({
      registerPWA,
      finishBoot,
      safeInitStep,
      init,
      showFirstRunScreen,
      applySettings,
      bindGlobal,
      isTextInputTarget,
      closeGlobalSearch,
      closeFloating,
      toggleStart,
      togglePanel,
      openGlobalSearch,
      toggleGlobalSearch,
      toggleCalendarFromTray,
      handleTopMenuAction,
      runConfiguredHotkey,
      openByDataApp,
      restartShell,
      lock
    });
  }

  window.ZETER_SHELL_UI_UTILS = Object.freeze({
    formatDate,
    updateClock,
    toast,
    createRunningTaskbarButton,
    createPinnedTaskbarButton,
    createTaskbarController,
    createShellRuntimeController
  });
})();
