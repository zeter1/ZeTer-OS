(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const windowMetricsUtils = window.ZETER_WINDOW_METRICS_UTILS;
  const windowSessionUtils = window.ZETER_WINDOW_SESSION_UTILS;
  if (!coreUtils || !windowMetricsUtils || !windowSessionUtils) throw new Error("ZeTer OS window UI utils require core, window metrics and window session utils.");

  const { $, $$, clamp, cssEscape } = coreUtils;
  const { topMenuHeight, taskbarSpace, availableWindowHeight, normalizeOpeningWindowRect } = windowMetricsUtils;
  const { serializableParams, normalizeWindowSessionList, collectWindowSessionsFromRuntime } = windowSessionUtils;

  function windowRestoreFailureHTML() {
    return `<div class="workspace-note"><b>Окно не удалось восстановить.</b><br>ZeTer OS пропустила повреждённое состояние этого окна, чтобы система загрузилась нормально.</div>`;
  }

  function windowIconEl(element) {
    return $(".window-icon", element) || $(".win-icon", element);
  }

  function windowTitleEl(element) {
    return $(".window-title b", element) || $(".win-title b", element);
  }

  function windowBodyEl(element) {
    return $(".window-body", element) || $(".win-body", element);
  }

  function createWindowElement(options = {}) {
    const template = options.template;
    const app = options.app;
    const params = options.params || {};
    const winId = String(options.winId || "");
    const desktopId = String(options.desktopId || "");
    const openingRect = options.openingRect || {};
    const onRenderError = typeof options.onRenderError === "function" ? options.onRenderError : () => {};
    if (!template?.content?.firstElementChild || !app) return null;

    const element = template.content.firstElementChild.cloneNode(true);
    element.dataset.winId = winId;
    element.dataset.appId = String(options.appId || "");
    element.dataset.desktopId = desktopId;
    element.style.width = openingRect.width;
    element.style.height = openingRect.height;
    element.style.left = openingRect.left;
    element.style.top = openingRect.top;

    const icon = windowIconEl(element);
    const title = windowTitleEl(element);
    const body = windowBodyEl(element);
    if (!icon || !title || !body) {
      throw new Error("Шаблон окна повреждён: не найдены .window-icon/.window-title/.window-body");
    }
    icon.textContent = app.icon;
    title.textContent = typeof app.title === "function" ? app.title(params) : app.name;

    let bodyNode;
    try {
      bodyNode = app.render(params, winId);
    } catch (error) {
      onRenderError(error);
      bodyNode = document.createElement("div");
      bodyNode.className = "app-shell";
      bodyNode.innerHTML = windowRestoreFailureHTML();
    }
    body.appendChild(bodyNode);
    return element;
  }

  function bindWindowInteractions(options = {}) {
    const element = options.element;
    const winId = options.winId;
    const getRecord = typeof options.getRecord === "function" ? options.getRecord : () => null;
    const focusWindow = typeof options.focusWindow === "function" ? options.focusWindow : () => {};
    const closeWindow = typeof options.closeWindow === "function" ? options.closeWindow : () => {};
    const minimizeWindow = typeof options.minimizeWindow === "function" ? options.minimizeWindow : () => {};
    const toggleMax = typeof options.toggleMax === "function" ? options.toggleMax : () => {};
    const showSnapMenu = typeof options.showSnapMenu === "function" ? options.showSnapMenu : () => {};
    const snapWindow = typeof options.snapWindow === "function" ? options.snapWindow : () => {};
    const persistWindows = typeof options.persistWindows === "function" ? options.persistWindows : () => {};
    const getSnapOverlay = typeof options.getSnapOverlay === "function" ? options.getSnapOverlay : () => null;
    const viewport = options.viewport || window;
    if (!element) return false;

    element.addEventListener("pointerdown", () => focusWindow(winId));
    $("[data-win='close']", element).addEventListener("click", () => closeWindow(winId));
    $("[data-win='min']", element).addEventListener("click", () => minimizeWindow(winId));
    $("[data-win='max']", element).addEventListener("click", () => toggleMax(winId));
    $("[data-win='snap']", element).addEventListener("click", event => showSnapMenu(winId, event));

    let drag = null;
    const bar = $(".window-titlebar", element);
    bar.addEventListener("dblclick", event => { if (!event.target.closest("button")) toggleMax(winId); });
    bar.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("button,input,select,textarea")) return;
      if (getRecord(winId)?.maximized) return;
      drag = { sx: event.clientX, sy: event.clientY, left: parseFloat(element.style.left), top: parseFloat(element.style.top) };
      bar.setPointerCapture(event.pointerId);
    });
    bar.addEventListener("pointermove", event => {
      if (!drag) return;
      const nextLeft = drag.left + event.clientX - drag.sx;
      const nextTop = drag.top + event.clientY - drag.sy;
      element.style.left = `${nextLeft}px`;
      element.style.top = `${Math.max(-topMenuHeight(), nextTop)}px`;
      getSnapOverlay()?.classList.toggle("hidden", event.clientY > 8);
    });
    bar.addEventListener("pointerup", event => {
      if (!drag) return;
      if (event.clientY <= 8) snapWindow(winId, "max");
      else if (event.clientX < 12) snapWindow(winId, "left");
      else if (event.clientX > viewport.innerWidth - 12) snapWindow(winId, "right");
      getSnapOverlay()?.classList.add("hidden");
      drag = null;
      persistWindows();
    });

    let resize = null;
    const handle = $(".resize-handle", element);
    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      resize = { sx: event.clientX, sy: event.clientY, w: element.offsetWidth, h: element.offsetHeight };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", event => {
      if (!resize) return;
      element.style.width = Math.max(330, resize.w + event.clientX - resize.sx) + "px";
      element.style.height = Math.max(240, resize.h + event.clientY - resize.sy) + "px";
    });
    handle.addEventListener("pointerup", () => {
      resize = null;
      persistWindows();
    });
    return true;
  }

  function createWindowRuntimeController(options = {}) {
    const getWindows = typeof options.getWindows === "function" ? options.getWindows : () => new Map();
    const getExplorerFolders = typeof options.getExplorerFolders === "function" ? options.getExplorerFolders : () => new Map();
    const getActiveWindow = typeof options.getActiveWindow === "function" ? options.getActiveWindow : () => null;
    const setActiveWindow = typeof options.setActiveWindow === "function" ? options.setActiveWindow : () => {};
    const nextZ = typeof options.nextZ === "function" ? options.nextZ : () => 1;
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const clearDesktopSelection = typeof options.clearDesktopSelection === "function" ? options.clearDesktopSelection : () => {};
    const getRestoringWindows = typeof options.getRestoringWindows === "function" ? options.getRestoringWindows : () => false;
    const setRestoringWindows = typeof options.setRestoringWindows === "function" ? options.setRestoringWindows : () => {};
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const getCurrentWorkspace = typeof options.getCurrentWorkspace === "function" ? options.getCurrentWorkspace : () => ({});
    const getOpenWindows = typeof options.getOpenWindows === "function" ? options.getOpenWindows : () => [];
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderDesktop = typeof options.renderDesktop === "function" ? options.renderDesktop : () => {};
    const syncLiveEditors = typeof options.syncLiveEditors === "function" ? options.syncLiveEditors : () => {};
    const maxWindows = Number(options.maxWindows) || 24;
    const persistWindows = typeof options.persistWindows === "function" ? options.persistWindows : persistOpenWindowsForCurrentDesktop;
    const createRunningTaskbarButton = typeof options.createRunningTaskbarButton === "function" ? options.createRunningTaskbarButton : () => null;
    const showRunningTaskbarWindowMenu = typeof options.showRunningTaskbarWindowMenu === "function" ? options.showRunningTaskbarWindowMenu : () => {};
    const buildSnapMenuEntries = typeof options.buildSnapMenuEntries === "function" ? options.buildSnapMenuEntries : () => [];
    const showContext = typeof options.showContext === "function" ? options.showContext : () => {};
    const getSnapOverlay = typeof options.getSnapOverlay === "function" ? options.getSnapOverlay : () => null;
    const getTaskbarApps = typeof options.getTaskbarApps === "function" ? options.getTaskbarApps : () => $("#taskbar-apps");
    const getWindowLayer = typeof options.getWindowLayer === "function" ? options.getWindowLayer : () => $("#window-layer") || $("#windows");
    const getWindowTemplate = typeof options.getWindowTemplate === "function" ? options.getWindowTemplate : () => $("#window-template");
    const createId = typeof options.createId === "function" ? options.createId : prefix => `${prefix}-${Date.now()}`;
    const isExplorerBlankTab = typeof options.isExplorerBlankTab === "function" ? options.isExplorerBlankTab : () => false;
    const getItem = typeof options.getItem === "function" ? options.getItem : () => null;
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const itemInWorkspace = typeof options.itemInWorkspace === "function" ? options.itemInWorkspace : () => false;
    const prepareExplorerOpenParams = typeof options.prepareExplorerOpenParams === "function" ? options.prepareExplorerOpenParams : params => params;
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const createWindowForApp = typeof options.createWindowForApp === "function" ? options.createWindowForApp : createWindowElement;
    const normalizeOpeningRect = typeof options.normalizeOpeningRect === "function" ? options.normalizeOpeningRect : normalizeOpeningWindowRect;
    const onOpenError = typeof options.onOpenError === "function" ? options.onOpenError : (appId, params, error) => console.error("[ZeTer OS openApp]", appId, params, error);
    const viewport = options.viewport || window;

    function collectCurrentWindowSessions() {
      syncLiveEditors();
      return collectWindowSessionsFromRuntime(getWindows(), getDesktopRoot());
    }

    function syncOpenWindowsBeforeBackup() {
      if (getRestoringWindows()) return false;
      getCurrentWorkspace().openWindows = collectCurrentWindowSessions();
      return true;
    }

    function persistOpenWindowsForCurrentDesktop() {
      if (getRestoringWindows()) return false;
      syncOpenWindowsBeforeBackup();
      saveState();
      return true;
    }

    function windowLayer() {
      return getWindowLayer();
    }

    function clearRuntimeWindows() {
      const layer = windowLayer();
      if (layer) layer.innerHTML = "";
      const taskbarApps = getTaskbarApps();
      if (taskbarApps) taskbarApps.innerHTML = "";
      getWindows().clear();
      setActiveWindow(null);
      getExplorerFolders().clear();
    }

    function taskbarButton(winId) {
      return $(`.taskbar-app[data-win-id="${cssEscape(winId)}"]`);
    }

    function focusWindow(winId) {
      const record = getWindows().get(winId);
      if (!record) return false;
      clearDesktopSelection();
      setActiveWindow(winId);
      $$(".window").forEach(element => element.classList.remove("active"));
      record.el.classList.add("active");
      record.el.style.zIndex = nextZ();
      $$(".taskbar-app").forEach(button => button.classList.toggle("active", button.dataset.winId === winId));
      return true;
    }

    function closeWindow(winId) {
      const record = getWindows().get(winId);
      if (record?.el) {
        record.el.classList.add("closing");
        setTimeout(() => record.el?.remove(), 120);
      }
      getWindows().delete(winId);
      taskbarButton(winId)?.remove();
      getExplorerFolders().delete(winId);
      persistWindows();
    }

    function minimizeWindow(winId) {
      const record = getWindows().get(winId);
      if (!record) return false;
      record.el.classList.add("minimized");
      taskbarButton(winId)?.classList.add("minimized");
      persistWindows();
      return true;
    }

    function restoreWindow(winId) {
      const record = getWindows().get(winId);
      if (!record?.lastRect) return false;
      Object.assign(record.el.style, record.lastRect);
      record.el.classList.remove("maximized");
      record.maximized = false;
      persistWindows();
      return true;
    }

    function snapWindow(winId, mode) {
      const record = getWindows().get(winId);
      if (!record) return false;
      const element = record.el;
      if (!record.maximized) {
        record.lastRect = {
          left: element.style.left,
          top: element.style.top,
          width: element.style.width,
          height: element.style.height
        };
      }
      const fullTop = `-${topMenuHeight()}px`;
      if (mode === "max") {
        Object.assign(element.style, { left: "0px", top: fullTop, width: "100vw", height: "100vh" });
        element.classList.add("maximized");
        record.maximized = true;
      }
      if (mode === "left") {
        Object.assign(element.style, { left: "0px", top: fullTop, width: "50vw", height: "100vh" });
        element.classList.remove("maximized");
        record.maximized = false;
      }
      if (mode === "right") {
        Object.assign(element.style, { left: "50vw", top: fullTop, width: "50vw", height: "100vh" });
        element.classList.remove("maximized");
        record.maximized = false;
      }
      focusWindow(winId);
      persistWindows();
      return true;
    }

    function toggleMax(winId) {
      const record = getWindows().get(winId);
      if (!record) return false;
      return record.maximized ? restoreWindow(winId) : snapWindow(winId, "max");
    }

    function showSnapMenu(winId, event) {
      const entries = buildSnapMenuEntries().map(entry => [entry.icon, entry.label, () => {
        if (entry.action.type === "snap") return snapWindow(winId, entry.action.mode);
        if (entry.action.type === "restore") return restoreWindow(winId);
      }]);
      showContext(event.clientX - 150, event.clientY + 20, entries);
    }

    function bindWindow(element, winId) {
      return bindWindowInteractions({
        element,
        winId,
        getRecord: id => getWindows().get(id),
        focusWindow,
        closeWindow,
        minimizeWindow,
        toggleMax,
        showSnapMenu,
        snapWindow,
        persistWindows,
        getSnapOverlay,
        viewport
      });
    }

    function addTaskbarApp(winId, app) {
      const button = createRunningTaskbarButton({ winId, name: app.name, icon: app.icon });
      if (!button) return null;
      button.addEventListener("click", () => {
        const record = getWindows().get(winId);
        if (!record) return;
        if (record.el.classList.contains("minimized") || getActiveWindow() !== winId) {
          record.el.classList.remove("minimized");
          focusWindow(winId);
        } else {
          minimizeWindow(winId);
        }
      });
      button.addEventListener("contextmenu", event => showRunningTaskbarWindowMenu(event, winId));
      getTaskbarApps()?.appendChild(button);
      return button;
    }

    function refreshWindow(winId) {
      const record = getWindows().get(winId);
      if (!record) return false;
      const body = windowBodyEl(record.el);
      const app = getApps()[record.appId];
      if (!body || !app) return false;
      const title = windowTitleEl(record.el);
      if (title) title.textContent = typeof app.title === "function" ? app.title(record.params || {}) : app.name;
      body.innerHTML = "";
      body.appendChild(app.render(record.params, winId));
      return true;
    }

    function restoreWindowsForCurrentDesktop() {
      const sessions = normalizeWindowSessionList(getOpenWindows(), getApps(), maxWindows);
      clearRuntimeWindows();
      setRestoringWindows(true);
      const survived = [];
      sessions.forEach((session, index) => {
        try {
          openApp(session.appId, session.params || {}, { restoring: true, session, offsetIndex: index });
          survived.push(session);
        } catch (error) {
          console.error("[ZeTer OS restore window]", session, error);
        }
      });
      setRestoringWindows(false);
      getCurrentWorkspace().openWindows = survived;
      saveState();
      if (!survived.length) renderDesktop();
    }

    function refreshWorkspaceWindows() {
      getWindows().forEach((record, winId) => {
        if (getApps()[record.appId]) refreshWindow(winId);
      });
    }

    function cycleWindows(reverse = false) {
      const windows = [...getWindows().values()].filter(record => record.desktopId === getDesktopRoot());
      if (!windows.length) return;
      windows.sort((a, b) => (parseInt(a.el.style.zIndex || "0", 10) || 0) - (parseInt(b.el.style.zIndex || "0", 10) || 0));
      const activeIndex = windows.findIndex(record => record.winId === getActiveWindow());
      const nextIndex = reverse
        ? (activeIndex <= 0 ? windows.length - 1 : activeIndex - 1)
        : (activeIndex >= windows.length - 1 ? 0 : activeIndex + 1);
      const record = windows[nextIndex];
      record.el.classList.remove("minimized");
      focusWindow(record.winId);
      persistOpenWindowsForCurrentDesktop();
    }

    function openApp(appId, params = {}, runtimeOptions = {}) {
      const app = getApps()[appId];
      if (!app) return;
      const desktopId = getDesktopRoot();

      if (!runtimeOptions.restoring) persistOpenWindowsForCurrentDesktop();

      if (appId === "folder") {
        const folderId = params?.folderId || params?.explorerAnchorFolderId || (isExplorerBlankTab(params?.activeTabId) ? null : params?.activeTabId);
        const folder = getItem(folderId);
        const validDesktopRoot = isDesktopRoot(folderId) && folderId === desktopId;
        if (!validDesktopRoot && (!folder || folder.type !== "folder" || !itemInWorkspace(folder, desktopId))) {
          toast("Папка не найдена", "Окно папки не было открыто, потому что папка удалена или находится на другом рабочем столе.");
          return;
        }
        params = prepareExplorerOpenParams(params, { restoring: Boolean(runtimeOptions.restoring) });
      }

      const existing = [...getWindows().values()].find(record => (
        record.appId === appId
        && JSON.stringify(record.params || {}) === JSON.stringify(params || {})
        && record.desktopId === desktopId
      ));
      if (existing) {
        existing.el.classList.remove("minimized");
        focusWindow(existing.winId);
        return;
      }

      const winId = createId("win");
      const openingRect = normalizeOpeningRect(runtimeOptions.session?.rect || null);
      const element = createWindowForApp({
        template: getWindowTemplate(),
        app,
        appId,
        params,
        winId,
        desktopId,
        openingRect,
        onRenderError: error => onOpenError(appId, params, error)
      });
      const layer = windowLayer();
      if (!layer) throw new Error("Не найден слой окон: #window-layer");
      layer.appendChild(element);
      getWindows().set(winId, { winId, appId, params: serializableParams(params), desktopId, el: element, maximized: false, lastRect: null });

      bindWindow(element, winId);
      addTaskbarApp(winId, app);
      if (runtimeOptions.session?.maximized) toggleMax(winId);
      if (runtimeOptions.session?.minimized) element.classList.add("minimized");
      focusWindow(winId);
      if (!runtimeOptions.restoring) persistOpenWindowsForCurrentDesktop();
    }

    function keepWindowsInBounds() {
      getWindows().forEach(record => {
        if (record.maximized) return;
        const element = record.el;
        element.style.left = clamp(parseFloat(element.style.left), 0, viewport.innerWidth - 90) + "px";
        element.style.top = clamp(parseFloat(element.style.top), -topMenuHeight(), availableWindowHeight() + taskbarSpace() - 44) + "px";
      });
    }

    return Object.freeze({
      bindWindow,
      addTaskbarApp,
      focusWindow,
      closeWindow,
      minimizeWindow,
      toggleMax,
      restoreWindow,
      snapWindow,
      showSnapMenu,
      refreshWindow,
      keepWindowsInBounds,
      collectCurrentWindowSessions,
      syncOpenWindowsBeforeBackup,
      persistOpenWindowsForCurrentDesktop,
      windowLayer,
      clearRuntimeWindows,
      restoreWindowsForCurrentDesktop,
      refreshWorkspaceWindows,
      cycleWindows,
      openApp
    });
  }

  window.ZETER_WINDOW_UI_UTILS = Object.freeze({
    windowRestoreFailureHTML,
    windowIconEl,
    windowTitleEl,
    windowBodyEl,
    createWindowElement,
    bindWindowInteractions,
    createWindowRuntimeController
  });
})();
