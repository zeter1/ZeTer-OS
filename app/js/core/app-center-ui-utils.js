(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS app center UI utils require core utils.");

  const { escapeHtml } = coreUtils;
  const safeAttr = escapeHtml;

  function appCenterCardHTML(entry = {}) {
    const installed = Boolean(entry.installed);
    return `<article class="app-center-card ${installed ? "installed" : ""}"><b>${escapeHtml(entry.icon)} ${escapeHtml(entry.name)}</b><p class="muted">${installed ? "Установлено на этом рабочем столе" : "Не установлено на этом рабочем столе"}</p><div class="app-center-actions">${installed ? `<button class="app-btn" data-open-app="${safeAttr(entry.id)}">Открыть</button><button class="danger-btn" data-uninstall-app="${safeAttr(entry.id)}">Удалить</button>` : `<button class="app-btn primary" data-install-app="${safeAttr(entry.id)}">Установить</button>`}</div></article>`;
  }

  function appCenterEntries(appEntries = [], isInstalled = () => false) {
    return appEntries.map(([id, app]) => ({
      id,
      icon: app.icon,
      name: app.name,
      installed: Boolean(isInstalled(id))
    }));
  }

  function appCenterHTML(entries = []) {
    return `<h1>Приложения</h1><p class="muted">Устанавливай приложения на текущий рабочий стол. Установка создаёт ярлык, удаление убирает ярлык с рабочего стола.</p><div class="browser-cards app-center-grid">${entries.map(appCenterCardHTML).join("")}</div>`;
  }

  function appCenterAction(target) {
    const openBtn = target?.closest?.("[data-open-app]");
    if (openBtn) return { type: "open", appId: openBtn.dataset.openApp || "" };
    const installBtn = target?.closest?.("[data-install-app]");
    if (installBtn) return { type: "install", appId: installBtn.dataset.installApp || "" };
    const uninstallBtn = target?.closest?.("[data-uninstall-app]");
    if (uninstallBtn) return { type: "uninstall", appId: uninstallBtn.dataset.uninstallApp || "" };
    return null;
  }

  function createAppShortcutController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {} });
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const getRootId = typeof options.getRootId === "function" ? options.getRootId : () => "desktop";
    const itemInWorkspace = typeof options.itemInWorkspace === "function" ? options.itemInWorkspace : () => false;
    const addDesktopShortcut = typeof options.addDesktopShortcut === "function" ? options.addDesktopShortcut : () => null;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderAllFileSurfaces = typeof options.renderAllFileSurfaces === "function" ? options.renderAllFileSurfaces : () => {};
    const refreshWindows = typeof options.refreshWindows === "function" ? options.refreshWindows : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};

    function entries() {
      return Object.entries(getApps()).filter(([id, app]) => id !== "search" && !app.hidden);
    }

    function shortcutIds(appId, root = getRootId()) {
      const state = getState();
      return Object.values(state.fs || {})
        .filter(item => item?.type === "app" && item.appId === appId && itemInWorkspace(item, root))
        .map(item => item.id);
    }

    function isInstalled(appId, root = getRootId()) {
      return shortcutIds(appId, root).length > 0;
    }

    function install(appId) {
      const app = getApps()[appId];
      if (!app || app.hidden || appId === "search") return false;
      const root = getRootId();
      if (isInstalled(appId, root)) {
        toast("Уже установлено", app.name);
        refreshWindows();
        return false;
      }
      addDesktopShortcut(appId, root, null, null);
      saveState();
      renderAllFileSurfaces();
      refreshWindows();
      toast("Приложение установлено", app.name);
      return true;
    }

    function uninstall(appId) {
      const app = getApps()[appId];
      if (!app || app.hidden || appId === "search") return false;
      const state = getState();
      const root = getRootId();
      const ids = shortcutIds(appId, root);
      if (!ids.length) {
        toast("Не установлено", app.name);
        refreshWindows();
        return false;
      }
      ids.forEach(id => delete state.fs[id]);
      saveState();
      renderAllFileSurfaces();
      refreshWindows();
      toast("Приложение удалено", app.name);
      return true;
    }

    return Object.freeze({ entries, shortcutIds, isInstalled, install, uninstall });
  }

  function appCenterAppElement(options = {}) {
    const {
      getAppEntries = () => [],
      isInstalled = () => false,
      openApp = () => {},
      installApp = () => {},
      uninstallApp = () => {}
    } = options;
    const root = document.createElement("div");
    root.className = "browser-page app-center-page";
    root.innerHTML = appCenterHTML(appCenterEntries(getAppEntries(), isInstalled));
    root.addEventListener("click", event => {
      const action = appCenterAction(event.target);
      if (!action) return;
      if (action.type === "open") openApp(action.appId);
      if (action.type === "install") installApp(action.appId);
      if (action.type === "uninstall") uninstallApp(action.appId);
    });
    return root;
  }

  window.ZETER_APP_CENTER_UI_UTILS = Object.freeze({
    appCenterCardHTML,
    appCenterEntries,
    appCenterAction,
    appCenterHTML,
    appCenterAppElement,
    createAppShortcutController
  });
})();
