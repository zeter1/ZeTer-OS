(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const visualUtils = window.ZETER_VISUAL_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const windowSessionUtils = window.ZETER_WINDOW_SESSION_UTILS;
  if (!config || !visualUtils || !dataNormalizers || !windowSessionUtils) {
    throw new Error("ZeTer OS workspace utils require config, visual, data normalizer and window session modules.");
  }

  const { OPEN_WINDOWS_MAX } = config;
  const {
    baseDesktopSettings,
    defaultDesktopDescription,
    normalizeDesktopRecord,
    normalizeVisualSettings
  } = visualUtils;
  const {
    normalizeTaskStore,
    normalizeCalendarEvents,
    normalizeNotifications
  } = dataNormalizers;
  const {
    normalizeWindowSessionList
  } = windowSessionUtils;

  const DEFAULT_DESKTOP_ID = "desktop";
  const DEFAULT_DESKTOP_NAME = "\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439";

  function workspaceDefaults(seed = {}) {
    const source = seed && typeof seed === "object" ? seed : {};
    return {
      settings: normalizeVisualSettings({ ...baseDesktopSettings(), ...(source.settings || {}) }),
      tasks: Array.isArray(source.tasks) ? source.tasks : [],
      taskProjects: Array.isArray(source.taskProjects) ? source.taskProjects : [],
      activeTaskProjectId: source.activeTaskProjectId || null,
      events: normalizeCalendarEvents(source.events),
      notifications: normalizeNotifications(source.notifications),
      expandedExplorerFolders: Array.isArray(source.expandedExplorerFolders) ? source.expandedExplorerFolders : [],
      openWindows: Array.isArray(source.openWindows) ? source.openWindows.slice(0, OPEN_WINDOWS_MAX) : [],
      noteStickies: Array.isArray(source.noteStickies) ? source.noteStickies : [],
      explorerRootId: source.explorerRootId || null,
      externalSaveEnabled: Boolean(source.externalSaveEnabled),
      externalSaveStatus: source.externalSaveStatus || ""
    };
  }

  function normalizeWorkspaceData(data = {}, legacySeed = {}, options = {}) {
    const workspace = data && typeof data === "object" ? data : {};
    const legacy = legacySeed && typeof legacySeed === "object" ? legacySeed : {};

    workspace.settings = normalizeVisualSettings({
      ...baseDesktopSettings(),
      ...(legacy.settings || {}),
      ...(workspace.settings || {})
    });
    workspace.tasks = Array.isArray(workspace.tasks) ? workspace.tasks : (Array.isArray(legacy.tasks) ? legacy.tasks : []);
    workspace.taskProjects = Array.isArray(workspace.taskProjects) ? workspace.taskProjects : (Array.isArray(legacy.taskProjects) ? legacy.taskProjects : []);
    workspace.activeTaskProjectId = workspace.activeTaskProjectId || legacy.activeTaskProjectId || null;
    normalizeTaskStore(workspace);
    workspace.events = normalizeCalendarEvents(Array.isArray(workspace.events) ? workspace.events : (Array.isArray(legacy.events) ? legacy.events : []));
    workspace.notifications = normalizeNotifications(Array.isArray(workspace.notifications) ? workspace.notifications : (Array.isArray(legacy.notifications) ? legacy.notifications : []));
    workspace.expandedExplorerFolders = Array.isArray(workspace.expandedExplorerFolders) ? workspace.expandedExplorerFolders : [];
    workspace.openWindows = Array.isArray(workspace.openWindows) ? workspace.openWindows.slice(0, OPEN_WINDOWS_MAX) : [];
    workspace.noteStickies = Array.isArray(workspace.noteStickies) ? workspace.noteStickies : [];
    workspace.externalSaveEnabled = Boolean(workspace.externalSaveEnabled);
    workspace.externalSaveStatus = workspace.externalSaveStatus || "";

    const state = options.state && typeof options.state === "object" ? options.state : null;
    const ensureWorkspaceExplorerRoot = typeof options.ensureWorkspaceExplorerRoot === "function"
      ? options.ensureWorkspaceExplorerRoot
      : null;
    if (state && ensureWorkspaceExplorerRoot) {
      const fs = state.fs && typeof state.fs === "object" ? state.fs : {};
      if (!workspace.explorerRootId || !fs[workspace.explorerRootId]) {
        workspace.explorerRootId = ensureWorkspaceExplorerRoot(options.desktopId || DEFAULT_DESKTOP_ID);
      }
    } else {
      workspace.explorerRootId = workspace.explorerRootId || null;
    }

    return workspace;
  }

  function defaultDesktopRecord() {
    return {
      id: DEFAULT_DESKTOP_ID,
      name: DEFAULT_DESKTOP_NAME,
      description: defaultDesktopDescription(DEFAULT_DESKTOP_ID)
    };
  }

  function ensureDesktopRecords(state = {}, options = {}) {
    if (!state || typeof state !== "object") return [];
    if (!state.fs || typeof state.fs !== "object") state.fs = {};
    if (!Array.isArray(state.desktops) || !state.desktops.length) {
      state.desktops = [defaultDesktopRecord()];
    }
    if (!state.desktops.some(desk => desk?.id === DEFAULT_DESKTOP_ID)) {
      state.desktops.unshift(defaultDesktopRecord());
    }
    if (!state.currentDesktop || !state.desktops.some(desk => desk?.id === state.currentDesktop)) {
      state.currentDesktop = DEFAULT_DESKTOP_ID;
    }

    state.desktops = state.desktops.map((desk, index) => normalizeDesktopRecord(desk, index));
    state.desktops.forEach(desk => {
      const legacySeed = desk.id === DEFAULT_DESKTOP_ID
        ? {
          settings: state.settings,
          tasks: state.tasks,
          taskProjects: state.taskProjects,
          activeTaskProjectId: state.activeTaskProjectId,
          events: state.events,
          notifications: state.notifications
        }
        : {};
      desk.data = normalizeWorkspaceData(desk.data || {}, legacySeed, {
        state,
        desktopId: desk.id,
        ensureWorkspaceExplorerRoot: options.ensureWorkspaceExplorerRoot
      });
    });

    return state.desktops;
  }

  function syncLegacyWorkspaceAliases(target = {}, options = {}) {
    if (!target || typeof target !== "object") return target;
    ensureDesktopRecords(target, options);
    const desktops = Array.isArray(target.desktops) ? target.desktops : [];
    const primary = desktops.find(desk => desk?.id === DEFAULT_DESKTOP_ID) || desktops[0];
    const data = primary?.data && typeof primary.data === "object" ? primary.data : null;
    if (!data) return target;

    target.tasks = data.tasks;
    target.taskProjects = data.taskProjects;
    target.activeTaskProjectId = data.activeTaskProjectId;
    target.events = data.events;
    target.notifications = data.notifications;
    return target;
  }

  function sanitizeWorkspaceWindowSessions(target = {}, apps = {}, options = {}) {
    if (!target || typeof target !== "object") return [];
    const ensureDesktops = typeof options.ensureDesktops === "function"
      ? options.ensureDesktops
      : () => ensureDesktopRecords(target, options);
    ensureDesktops();

    const maxWindows = Number.isFinite(Number(options.maxWindows))
      ? Math.max(0, Math.floor(Number(options.maxWindows)))
      : OPEN_WINDOWS_MAX;
    const defaults = typeof options.workspaceDefaults === "function"
      ? options.workspaceDefaults
      : workspaceDefaults;

    (Array.isArray(target.desktops) ? target.desktops : []).forEach(desk => {
      desk.data = desk.data || defaults();
      desk.data.openWindows = normalizeWindowSessionList(desk.data.openWindows, apps, maxWindows);
    });
    return target.desktops || [];
  }

  function workspaceDataForDesktopId(target = {}, desktopId = DEFAULT_DESKTOP_ID, options = {}) {
    if (!target || typeof target !== "object") return workspaceDefaults();
    const ensureDesktops = typeof options.ensureDesktops === "function"
      ? options.ensureDesktops
      : () => ensureDesktopRecords(target, options);
    ensureDesktops();

    const desktops = Array.isArray(target.desktops) ? target.desktops : [];
    const fallbackDesk = typeof options.currentDesktopRecord === "function"
      ? options.currentDesktopRecord()
      : (desktops.find(desk => desk?.id === target.currentDesktop) || desktops[0]);
    const desk = desktops.find(item => item?.id === desktopId) || fallbackDesk;
    if (!desk) return workspaceDefaults();

    desk.data = desk.data || workspaceDefaults();
    desk.data.notifications = normalizeNotifications(desk.data.notifications);
    desk.data.tasks = Array.isArray(desk.data.tasks) ? desk.data.tasks : [];
    desk.data.taskProjects = Array.isArray(desk.data.taskProjects) ? desk.data.taskProjects : [];
    desk.data.events = normalizeCalendarEvents(desk.data.events);
    return desk.data;
  }

  function createWorkspaceRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const ensureWorkspaceExplorerRoot = typeof options.ensureWorkspaceExplorerRoot === "function" ? options.ensureWorkspaceExplorerRoot : () => null;
    const getExplorerRoot = typeof options.getExplorerRoot === "function" ? options.getExplorerRoot : () => null;
    const createWorkspaceSystemFolders = typeof options.createWorkspaceSystemFolders === "function" ? options.createWorkspaceSystemFolders : () => {};
    const sanitizeExplorerSpacesInState = typeof options.sanitizeExplorerSpacesInState === "function" ? options.sanitizeExplorerSpacesInState : () => [];
    const getApps = typeof options.getApps === "function" ? options.getApps : () => ({});
    const desktopRecordById = typeof options.desktopRecordById === "function" ? options.desktopRecordById : (desktops, id) => desktops.find(desk => desk?.id === id) || null;
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : (_desktops, id) => String(id || "");
    const desktopDescription = typeof options.desktopDescription === "function" ? options.desktopDescription : () => "";
    const desktopIconData = typeof options.desktopIconData === "function" ? options.desktopIconData : () => null;
    const desktopAvatarHTML = typeof options.desktopAvatarHTML === "function" ? options.desktopAvatarHTML : () => "";

    function ensureDesktops() {
      return ensureDesktopRecords(getState(), { ensureWorkspaceExplorerRoot });
    }

    function currentDesktopRecord() {
      const state = getState();
      ensureDesktops();
      return state.desktops.find(desk => desk.id === state.currentDesktop) || state.desktops[0];
    }

    function currentWorkspace() {
      const desk = currentDesktopRecord();
      desk.data = normalizeWorkspaceData(desk.data || {});
      return desk.data;
    }

    function deskSettings() { return currentWorkspace().settings; }
    function deskTasks() { return currentWorkspace().tasks; }
    function deskTaskProjects() { return currentWorkspace().taskProjects; }
    function deskEvents() {
      const workspace = currentWorkspace();
      workspace.events = normalizeCalendarEvents(workspace.events);
      return workspace.events;
    }
    function deskNotifications() {
      const workspace = currentWorkspace();
      workspace.notifications = normalizeNotifications(workspace.notifications);
      return workspace.notifications;
    }
    function setDeskTasks(tasks) {
      const workspace = currentWorkspace();
      workspace.tasks = tasks;
      normalizeTaskStore(workspace);
    }
    function setDeskEvents(events) { currentWorkspace().events = normalizeCalendarEvents(events); }
    function setDeskNotifications(notifications) { currentWorkspace().notifications = normalizeNotifications(notifications); }

    function deskOpenWindows() {
      const workspace = currentWorkspace();
      workspace.openWindows = Array.isArray(workspace.openWindows) ? workspace.openWindows : [];
      return workspace.openWindows;
    }

    function sanitizeWindowSessions() {
      return sanitizeWorkspaceWindowSessions(getState(), getApps(), {
        ensureDesktops,
        workspaceDefaults,
        maxWindows: OPEN_WINDOWS_MAX
      });
    }

    function sanitizeExplorerSpaces() {
      return sanitizeExplorerSpacesInState(getState(), {
        ensureDesktops,
        getExplorerRoot,
        createWorkspaceSystemFolders
      });
    }

    function getDesktopRoot() {
      const state = getState();
      ensureDesktops();
      return state.currentDesktop || DEFAULT_DESKTOP_ID;
    }

    function isDesktopRoot(id) {
      ensureDesktops();
      return getState().desktops.some(desk => desk.id === id);
    }

    function runtimeDesktopRecordById(id) {
      ensureDesktops();
      return desktopRecordById(getState().desktops, id);
    }

    function runtimeDesktopName(id) {
      ensureDesktops();
      return desktopName(getState().desktops, id);
    }

    function runtimeDesktopDescription(id) {
      ensureDesktops();
      return desktopDescription(getState().desktops, id);
    }

    function runtimeDesktopIconData(id) {
      ensureDesktops();
      return desktopIconData(getState().desktops, id);
    }

    function runtimeDesktopAvatarHTML(id, active = false) {
      ensureDesktops();
      return desktopAvatarHTML(getState().desktops, id, active);
    }

    return Object.freeze({
      workspaceDefaults,
      ensureDesktops,
      currentDesktopRecord,
      currentWorkspace,
      deskSettings,
      deskTasks,
      deskTaskProjects,
      deskEvents,
      deskNotifications,
      setDeskTasks,
      setDeskEvents,
      setDeskNotifications,
      deskOpenWindows,
      sanitizeWorkspaceWindowSessions: sanitizeWindowSessions,
      sanitizeExplorerSpaces,
      getDesktopRoot,
      isDesktopRoot,
      desktopRecordById: runtimeDesktopRecordById,
      desktopName: runtimeDesktopName,
      desktopDescription: runtimeDesktopDescription,
      desktopIconData: runtimeDesktopIconData,
      desktopAvatarHTML: runtimeDesktopAvatarHTML
    });
  }

  function createVirtualDesktopController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const createId = typeof options.createId === "function" ? options.createId : () => `desktop_${Date.now()}`;
    const requestName = typeof options.requestName === "function" ? options.requestName : () => "";
    const confirmDelete = typeof options.confirmDelete === "function" ? options.confirmDelete : () => false;
    const addDesktopShortcut = typeof options.addDesktopShortcut === "function" ? options.addDesktopShortcut : () => null;
    const ensureWorkspaceExplorerRoot = typeof options.ensureWorkspaceExplorerRoot === "function" ? options.ensureWorkspaceExplorerRoot : () => null;
    const createWorkspaceSystemFolders = typeof options.createWorkspaceSystemFolders === "function" ? options.createWorkspaceSystemFolders : () => {};
    const findFreeDesktopPosition = typeof options.findFreeDesktopPosition === "function" ? options.findFreeDesktopPosition : () => ({ x: 80, y: 80 });
    const persistOpenWindows = typeof options.persistOpenWindows === "function" ? options.persistOpenWindows : () => {};
    const clearRuntimeWindows = typeof options.clearRuntimeWindows === "function" ? options.clearRuntimeWindows : () => {};
    const restoreWindows = typeof options.restoreWindows === "function" ? options.restoreWindows : () => {};
    const resetSelection = typeof options.resetSelection === "function" ? options.resetSelection : () => {};
    const applySettings = typeof options.applySettings === "function" ? options.applySettings : () => {};
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderDesktop = typeof options.renderDesktop === "function" ? options.renderDesktop : () => {};
    const renderStart = typeof options.renderStart === "function" ? options.renderStart : () => {};
    const renderNotifications = typeof options.renderNotifications === "function" ? options.renderNotifications : () => {};
    const getDesktopName = typeof options.getDesktopName === "function" ? options.getDesktopName : () => "Рабочий стол";
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const now = typeof options.now === "function" ? options.now : Date.now;

    function create() {
      const state = getState();
      ensureDesktops();
      const next = state.desktops.length + 1;
      const name = String(requestName("Название нового рабочего стола:", `Рабочий стол ${next}`) || "").trim();
      if (!name) return null;

      const id = createId("desktop");
      state.desktops.push({ id, name, description: defaultDesktopDescription(id), data: workspaceDefaults() });
      state.currentDesktop = id;

      addDesktopShortcut("tasks", id, 128, 24);
      addDesktopShortcut("calendar", id, 224, 24);
      addDesktopShortcut("settings", id, 32, 132);
      addDesktopShortcut("editor", id, 128, 132);
      const explorerRoot = ensureWorkspaceExplorerRoot(id);
      createWorkspaceSystemFolders(explorerRoot);

      saveState();
      renderDesktop();
      renderStart();
      toast("Рабочий стол создан", name);
      return id;
    }

    function switchTo(id) {
      const state = getState();
      ensureDesktops();
      if (!state.desktops.some(desktop => desktop.id === id)) return false;
      if (id === state.currentDesktop) {
        renderDesktop();
        renderStart();
        return true;
      }

      persistOpenWindows();
      state.currentDesktop = id;
      resetSelection();
      applySettings();
      saveState();
      renderDesktop();
      renderStart();
      renderNotifications();
      restoreWindows();
      toast("Рабочий стол", getDesktopName(id));
      return true;
    }

    function remove(id) {
      const state = getState();
      ensureDesktops();
      if (id === DEFAULT_DESKTOP_ID) {
        toast("Нельзя удалить", "Основной рабочий стол нужен системе.");
        return false;
      }
      const desktop = state.desktops.find(item => item.id === id);
      if (!desktop) return false;
      if (!confirmDelete(`Удалить рабочий стол «${desktop.name}»? Его файлы будут перенесены на основной рабочий стол.`)) return false;

      const moved = Object.values(state.fs || {}).filter(item => item.parent === id);
      moved.forEach((item, index) => {
        item.parent = DEFAULT_DESKTOP_ID;
        const position = findFreeDesktopPosition(DEFAULT_DESKTOP_ID, 80 + index * 24, 80 + index * 24, item.id);
        item.x = position.x;
        item.y = position.y;
        item.updatedAt = now();
      });

      const main = state.desktops.find(item => item.id === DEFAULT_DESKTOP_ID);
      if (main && desktop.data) {
        main.data = main.data || workspaceDefaults();
        main.data.tasks = [...(main.data.tasks || []), ...(desktop.data.tasks || [])];
        main.data.events = [...(main.data.events || []), ...(desktop.data.events || [])];
        main.data.notifications = [...(main.data.notifications || []), ...(desktop.data.notifications || [])];
      }

      state.desktops = state.desktops.filter(item => item.id !== id);
      if (state.currentDesktop === id) {
        state.currentDesktop = DEFAULT_DESKTOP_ID;
        clearRuntimeWindows();
        restoreWindows();
      }
      applySettings();
      saveState();
      renderDesktop();
      renderStart();
      renderNotifications();
      toast("Рабочий стол удалён", `Файлы перенесены: ${moved.length}`);
      return true;
    }

    return Object.freeze({ create, switchTo, remove });
  }

  window.ZETER_WORKSPACE_UTILS = {
    workspaceDefaults,
    normalizeWorkspaceData,
    ensureDesktopRecords,
    syncLegacyWorkspaceAliases,
    sanitizeWorkspaceWindowSessions,
    workspaceDataForDesktopId,
    createWorkspaceRuntimeController,
    createVirtualDesktopController
  };
})();
