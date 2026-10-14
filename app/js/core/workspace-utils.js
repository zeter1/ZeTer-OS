(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const visualUtils = window.ZETER_VISUAL_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const windowSessionUtils = window.ZETER_WINDOW_SESSION_UTILS;
  const linkLibraryUtils = window.ZETER_LINK_LIBRARY_UTILS;
  const promptLibraryUtils = window.ZETER_PROMPT_LIBRARY_UTILS;
  const calculationsUtils = window.ZETER_BUSINESS_CALCULATIONS_UTILS;
  if (!config || !visualUtils || !dataNormalizers || !windowSessionUtils || !linkLibraryUtils || !promptLibraryUtils || !calculationsUtils) {
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

  function normalizeWorkspaceAutomations(value) {
    const automationUtils = window.ZETER_AUTOMATION_UTILS;
    return automationUtils?.normalizeAutomations
      ? automationUtils.normalizeAutomations(value)
      : (Array.isArray(value) ? value : []);
  }

  function normalizeWorkspaceAutomationCategories(value) {
    return window.ZETER_AUTOMATION_UTILS?.normalizeAutomationCategories?.(value) || [];
  }

  function normalizeWorkspaceAutomationRuntime(value) {
    const automationUtils = window.ZETER_AUTOMATION_UTILS;
    return automationUtils?.normalizeAutomationRuntime
      ? automationUtils.normalizeAutomationRuntime(value)
      : (value && typeof value === "object" && !Array.isArray(value) ? value : {
        paused: false,
        baselineSeeded: false,
        knownFileIds: [],
        queue: [],
        history: [],
        checkpoints: [],
        rateLog: []
      });
  }

  function normalizeWorkspaceObjectLinks(value, state = null, workspace = null) {
    const objectLinkUtils = window.ZETER_OBJECT_LINK_UTILS;
    let links = objectLinkUtils?.normalizeObjectLinks
      ? objectLinkUtils.normalizeObjectLinks(value)
      : (Array.isArray(value) ? value : []);
    if (state && objectLinkUtils?.pruneBrokenObjectLinks) {
      links = objectLinkUtils.pruneBrokenObjectLinks(links, state, workspace || {});
    }
    return links;
  }

  function workspaceDefaults(seed = {}) {
    const source = seed && typeof seed === "object" ? seed : {};
    return {
      settings: normalizeVisualSettings({ ...baseDesktopSettings(), ...(source.settings || {}) }),
      tasks: Array.isArray(source.tasks) ? source.tasks : [],
      taskProjects: Array.isArray(source.taskProjects) ? source.taskProjects : [],
      activeTaskProjectId: source.activeTaskProjectId || null,
      events: normalizeCalendarEvents(source.events),
      notifications: normalizeNotifications(source.notifications),
      automations: normalizeWorkspaceAutomations(source.automations),
      automationCategories: normalizeWorkspaceAutomationCategories(source.automationCategories),
      automationRuntime: normalizeWorkspaceAutomationRuntime(source.automationRuntime),
      objectLinks: normalizeWorkspaceObjectLinks(source.objectLinks),
      library: linkLibraryUtils.normalizeLinkLibrary(source.library),
      promptLibrary: promptLibraryUtils.normalizePromptLibrary(source.promptLibrary),
      calculations: calculationsUtils.normalizeBusinessCalculations(source.calculations),
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
    workspace.automations = normalizeWorkspaceAutomations(Array.isArray(workspace.automations) ? workspace.automations : legacy.automations);
    workspace.automationCategories = normalizeWorkspaceAutomationCategories(workspace.automationCategories ?? legacy.automationCategories);
    workspace.automationRuntime = normalizeWorkspaceAutomationRuntime(workspace.automationRuntime || legacy.automationRuntime);
    workspace.objectLinks = normalizeWorkspaceObjectLinks(
      Array.isArray(workspace.objectLinks) ? workspace.objectLinks : legacy.objectLinks,
      options.state,
      workspace
    );
    workspace.library = linkLibraryUtils.normalizeLinkLibrary(workspace.library ?? legacy.library);
    workspace.promptLibrary = promptLibraryUtils.normalizePromptLibrary(workspace.promptLibrary);
    workspace.calculations = calculationsUtils.normalizeBusinessCalculations(workspace.calculations);
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
    // The short-lived shared format moves once to its original current desktop.
    // Existing per-desktop data wins; retain a conflicting legacy library for recovery.
    if (Object.hasOwn(state, "library")) {
      const originalDesk = state.desktops.find(desk => desk.id === state.currentDesktop) || state.desktops[0];
      originalDesk.data = originalDesk.data || {};
      if (originalDesk.data.library == null) originalDesk.data.library = linkLibraryUtils.normalizeLinkLibrary(state.library);
      else if (state.library != null && state.legacyLinkLibrary == null) state.legacyLinkLibrary = state.library;
      delete state.library;
    }
    state.desktops.forEach(desk => {
      const legacySeed = desk.id === DEFAULT_DESKTOP_ID
        ? {
          settings: state.settings,
          tasks: state.tasks,
          taskProjects: state.taskProjects,
          activeTaskProjectId: state.activeTaskProjectId,
          events: state.events,
          notifications: state.notifications,
          automations: state.automations,
          automationCategories: state.automationCategories,
          automationRuntime: state.automationRuntime,
          objectLinks: state.objectLinks
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
    target.automations = data.automations;
    target.automationCategories = data.automationCategories;
    target.automationRuntime = data.automationRuntime;
    target.objectLinks = data.objectLinks;
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
    desk.data.automations = normalizeWorkspaceAutomations(desk.data.automations);
    desk.data.automationCategories = normalizeWorkspaceAutomationCategories(desk.data.automationCategories);
    desk.data.automationRuntime = normalizeWorkspaceAutomationRuntime(desk.data.automationRuntime);
    desk.data.objectLinks = normalizeWorkspaceObjectLinks(desk.data.objectLinks, target, desk.data);
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
      const state = getState();
      const desk = currentDesktopRecord();
      desk.data = normalizeWorkspaceData(desk.data || {}, {}, { state, desktopId: desk.id });
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

  const deletionClone = value => JSON.parse(JSON.stringify(value));
  const deletionJSON = value => JSON.stringify(value ?? null);
  const deletionArray = value => Array.isArray(value) ? value : [];

  function desktopOwnedFileIds(state, id) {
    const ids = new Set();
    const explorerRoot = state.desktops?.find(desk => desk.id === id)?.data?.explorerRootId;
    if (explorerRoot && state.fs?.[explorerRoot]) ids.add(explorerRoot);
    let changed = true;
    while (changed) {
      changed = false;
      Object.entries(state.fs || {}).forEach(([key, item]) => {
        if (!ids.has(key) && (item.parent === id || ids.has(item.parent))) { ids.add(key); changed = true; }
      });
    }
    return ids;
  }

  function desktopDeletionSignature(state, id) {
    return deletionJSON({
      source: state.desktops?.find(desk => desk.id === id),
      primary: state.desktops?.find(desk => desk.id === DEFAULT_DESKTOP_ID),
      primaryRoot: state.fs?.[state.desktops?.find(desk => desk.id === DEFAULT_DESKTOP_ID)?.data?.explorerRootId],
      files: [...desktopOwnedFileIds(state, id)].sort().map(key => [key, state.fs[key]])
    });
  }

  function desktopDeletionModel(state, id) {
    const desk = state.desktops?.find(item => item.id === id);
    if (!desk || id === DEFAULT_DESKTOP_ID) return null;
    const data = desk.data || {};
    const length = value => deletionArray(value).length;
    const runtime = data.automationRuntime || {};
    return { id, name: desk.name, signature: desktopDeletionSignature(state, id), groups: [
      { id: "files", label: "Виртуальные файлы, папки и документы приложений", count: desktopOwnedFileIds(state, id).size, detail: "Все вложенные объекты, ярлыки и скрытая структура Проводника. Адреса Windows и веб-сайты не удаляются." },
      { id: "tasks", label: "Задачи и проекты", count: length(data.tasks) + length(data.taskProjects), detail: `${length(data.tasks)} задач · ${length(data.taskProjects)} проектов. Отдельные файлы со списками задач входят в группу файлов.` },
      { id: "calendar", label: "События календаря", count: length(data.events), detail: "События и их напоминания в календаре этого рабочего стола." },
      { id: "links", label: "Ссылки, категории и избранное", count: length(data.library?.entries) + length(data.library?.categories), detail: `${length(data.library?.entries)} ссылок · ${length(data.library?.categories)} категорий. Избранное хранится вместе со ссылкой.` },
      { id: "calculations", label: "Подсчёты и введённые значения", count: Object.keys(data.calculations?.inputs || {}).length, detail: "Наборы введённых значений, включая убранные карточки, их порядок и валюта." },
      { id: "prompts", label: "Промпты, проекты и категории", count: length(data.promptLibrary?.entries) + length(data.promptLibrary?.projects) + length(data.promptLibrary?.categories), detail: `${length(data.promptLibrary?.entries)} промптов · ${length(data.promptLibrary?.projects)} проектов · ${length(data.promptLibrary?.categories)} категорий.` },
      { id: "automation", label: "Автоматизация и связи объектов", count: length(data.automations) + length(data.automationCategories) + length(data.objectLinks) + ["queue", "history", "checkpoints", "rateLog", "knownFileIds"].reduce((sum, key) => sum + length(runtime[key]), 0), detail: `${length(data.automations)} правил · ${length(data.automationCategories)} категорий · ${length(data.objectLinks)} связей; также очередь, история и служебные записи выполнения.` },
      { id: "notifications", label: "Уведомления", count: length(data.notifications), detail: "Сохранённые уведомления этого рабочего стола." }
    ] };
  }

  function desktopBackupSnapshot(state, id) {
    const desktop = state.desktops?.find(desk => desk.id === id);
    if (!desktop) throw new Error("Рабочий стол больше недоступен.");
    return deletionClone({ desktop, fs: Object.fromEntries([...desktopOwnedFileIds(state, id)].map(key => [key, state.fs[key]])) });
  }

  function buildDesktopDeletionPlan(state, id, selected = [], options = {}) {
    const before = deletionClone(state), candidate = deletionClone(state);
    const remove = new Set(selected);
    if ([...remove].some(key => !["files", "tasks", "calendar", "links", "prompts", "calculations", "automation", "notifications"].includes(key))) throw new Error("Некорректный выбор данных для удаления.");
    const snapshot = desktopBackupSnapshot(candidate, id), data = snapshot.desktop.data;
    const ids = desktopOwnedFileIds(candidate, id);
    const fields = { tasks: ["tasks", "taskProjects", "activeTaskProjectId"], calendar: ["events"],
      links: ["library"], prompts: ["promptLibrary"], calculations: ["calculations"], automation: ["automations", "automationCategories", "automationRuntime", "objectLinks"], notifications: ["notifications"],
      files: ["noteStickies", "openWindows", "expandedExplorerFolders", "explorerRootId"] };
    remove.forEach(group => fields[group].forEach(key => { delete data[key]; }));
    if (remove.has("files")) snapshot.fs = {};
    const retained = desktopDeletionModel(before, id).groups.some(group => !remove.has(group.id) && group.count > 0);
    let archive = null;
    if (retained) {
      const existing = new Set(deletionArray(candidate.archivedDesktops).map(entry => entry.id));
      let archiveId = options.createId?.("archive") || `archive_${Date.now()}`;
      while (existing.has(archiveId)) archiveId += "_2";
      archive = { id: archiveId, archivedAt: new Date().toISOString(), ...snapshot };
      candidate.archivedDesktops = [...deletionArray(candidate.archivedDesktops), archive];
    }
    // All owned objects leave the active filesystem. Only unchecked objects remain in the archive.
    ids.forEach(key => delete candidate.fs[key]);
    options.pruneReferences?.(candidate, ids);
    candidate.desktops = candidate.desktops.filter(desk => desk.id !== id);
    if (candidate.currentDesktop === id) candidate.currentDesktop = DEFAULT_DESKTOP_ID;
    candidate.desktops.forEach(desk => {
      desk.data.objectLinks = normalizeWorkspaceObjectLinks(desk.data.objectLinks, candidate, desk.data);
      deletionArray(desk.data.notifications).forEach(item => {
        if (item.taskDesktopId === id || ids.has(item.linkedObjectId) || ids.has(item.taskListItemId)) {
          item.detachedSource = item.detachedSource || item.source; item.source = "system";
          for (const key of ["action", "taskId", "taskProjectId", "taskListItemId", "taskDesktopId", "calendarEventId", "linkedObjectKind", "linkedObjectId"]) delete item[key];
        }
      });
    });
    syncLegacyWorkspaceAliases(candidate);
    const dataPatches = candidate.desktops.flatMap(desk => {
      const previous = before.desktops.find(item => item.id === desk.id)?.data || {};
      return Object.keys(desk.data).filter(key => deletionJSON(previous[key]) !== deletionJSON(desk.data[key])).map(key => ({ id: desk.id, key, before: previous[key], after: desk.data[key] }));
    });
    const historyChanged = deletionJSON(before.actionHistory) !== deletionJSON(candidate.actionHistory);
    const matches = target => deletionJSON(target.archivedDesktops) === deletionJSON(before.archivedDesktops)
      && dataPatches.every(patch => deletionJSON(target.desktops.find(desk => desk.id === patch.id)?.data?.[patch.key]) === deletionJSON(patch.before))
      && (!historyChanged || deletionJSON(target.actionHistory) === deletionJSON(before.actionHistory));
    return { candidate, removedIds: ids, matches, publish(target) {
      ids.forEach(key => delete target.fs[key]);
      dataPatches.forEach(patch => { target.desktops.find(desk => desk.id === patch.id).data[patch.key] = patch.after; });
      if (historyChanged) target.actionHistory = candidate.actionHistory;
      if (archive) target.archivedDesktops = [...deletionArray(target.archivedDesktops), archive];
      target.desktops = target.desktops.filter(desk => desk.id !== id);
      syncLegacyWorkspaceAliases(target);
    } };
  }

  function createVirtualDesktopController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const createId = typeof options.createId === "function" ? options.createId : () => `desktop_${Date.now()}`;
    const requestName = typeof options.requestName === "function" ? options.requestName : () => "";
    const requestDeletion = typeof options.requestDeletion === "function" ? options.requestDeletion : async () => false;
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

    async function remove(id) {
      if (id === DEFAULT_DESKTOP_ID) {
        toast("Нельзя удалить", "Основной рабочий стол нужен системе.");
        return false;
      }
      const model = desktopDeletionModel(getState(), id);
      if (!model) return false;
      const run = operation => options.queueMutation ? options.queueMutation(operation) : operation();
      return requestDeletion(model, selected => run(async () => {
        const state = getState();
        if (desktopDeletionSignature(state, id) !== model.signature) {
          throw new Error("Данные рабочего стола изменились. Отмените диалог и откройте удаление заново, чтобы проверить актуальные количества.");
        }
        const plan = buildDesktopDeletionPlan(state, id, selected, { createId, pruneReferences: options.pruneReferences });
        if (typeof options.persistTransaction !== "function") throw new Error("Хранилище не поддерживает безопасное удаление рабочего стола.");
        let runtimeError = "";
        await options.persistTransaction(async write => {
          const saved = await write(plan.candidate);
          if (saved?.saved !== true) throw new Error("Хранилище не подтвердило удаление. Рабочий стол оставлен на месте.");
          const live = getState();
          if (live !== state || desktopDeletionSignature(live, id) !== model.signature || !plan.matches(live)) {
            try {
              const restored = await write(live);
              if (restored?.saved !== true) throw new Error("Хранилище не подтвердило восстановление.");
            } catch (error) {
              throw new Error(`Данные изменились во время сохранения. Рабочий стол остаётся открытым, но состояние в хранилище неизвестно: ${error.message}. Сохраните резервную копию текущих данных и проверьте хранилище перед перезапуском.`);
            }
            throw new Error("Данные изменились во время сохранения. Удаление отменено, актуальные данные записаны. Отмените диалог и проверьте выбор заново.");
          }
          const removedActive = state.currentDesktop === id;
          plan.publish(state);
          // Reconcile runtime before deferred ordinary saves can normalize aliases.
          if (removedActive) {
            state.currentDesktop = DEFAULT_DESKTOP_ID;
            try { clearRuntimeWindows(); restoreWindows(); }
            catch (error) { runtimeError = error.message; }
          }
        });
        try {
          options.onRemovedItems?.(plan.removedIds);
          applySettings();
          renderDesktop();
          renderStart();
          renderNotifications();
        } catch (error) {
          runtimeError = error.message;
        }
        // Fresh snapshot also includes unrelated mutations made during the staged write.
        Promise.resolve(saveState({ silentStorageError: true })).catch(error => toast("Последующее сохранение не выполнено", error.message));
        toast("Рабочий стол удалён", runtimeError ? `Данные записаны, но интерфейс не обновился: ${runtimeError}. Перезапустите оболочку.` : "Невыбранные данные сохранены в архиве в папке данных.");
        return true;
      }));
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
    createVirtualDesktopController,
    desktopDeletionModel,
    desktopBackupSnapshot
  };
})();
