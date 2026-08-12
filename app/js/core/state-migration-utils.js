(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const visualUtils = window.ZETER_VISUAL_UTILS;
  const systemSettingsUtils = window.ZETER_SYSTEM_SETTINGS_UTILS;
  const pinningUtils = window.ZETER_PINNING_UTILS;
  const trashUtils = window.ZETER_TRASH_UTILS;
  const searchUtils = window.ZETER_SEARCH_UTILS;
  const stateMaintenanceUtils = window.ZETER_STATE_MAINTENANCE_UTILS;
  const tableUtils = window.ZETER_TABLE_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const securityUtils = window.ZETER_SECURITY_UTILS;
  const initialStateUtils = window.ZETER_INITIAL_STATE_UTILS;
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  const itemCustomizationUtils = window.ZETER_ITEM_CUSTOMIZATION_UTILS;
  const workspaceUtils = window.ZETER_WORKSPACE_UTILS;
  if (!config || !visualUtils || !systemSettingsUtils || !pinningUtils || !trashUtils || !searchUtils ||
      !stateMaintenanceUtils || !tableUtils || !dataNormalizers || !securityUtils || !initialStateUtils || !shortcutUtils || !itemCustomizationUtils || !workspaceUtils) {
    throw new Error("ZeTer OS state migration utils require config and state normalizer modules.");
  }

  const { OS_VERSION, OS_VERSION_NUMBER } = config;
  const { normalizeVisualSettings, defaultDesktopDescription, normalizeDesktopRecord } = visualUtils;
  const { normalizeSystemSettings } = systemSettingsUtils;
  const { normalizeStartPinnedState, normalizeTaskbarPinnedApps } = pinningUtils;
  const { normalizeTrashRetentionDays } = trashUtils;
  const { normalizeSearchSettings } = searchUtils;
  const {
    removeExplorerAppShortcutsFromState,
    removeWorkspaceDocumentsFoldersFromState,
    normalizeNotesData
  } = stateMaintenanceUtils;
  const { normalizeTablesData } = tableUtils;
  const {
    normalizeTaskStore,
    normalizeCalendarStore,
    normalizeNotificationStore,
    normalizeTaskListsData
  } = dataNormalizers;
  const { normalizeSecurityMeta } = securityUtils;
  const { defaultState } = initialStateUtils;
  const { normalizeShortcutItems } = shortcutUtils;
  const { normalizeItemCustomizations } = itemCustomizationUtils;
  const { syncLegacyWorkspaceAliases } = workspaceUtils;

  function migrateState(state, options = {}) {
    const normalizeTrashState = options.normalizeTrashState;
    const purgeExpiredTrashItems = options.purgeExpiredTrashItems;
    if (typeof normalizeTrashState !== "function" || typeof purgeExpiredTrashItems !== "function") {
      throw new Error("ZeTer OS state migration requires trash normalization callbacks.");
    }

    const apps = options.apps || {};
    const defaults = defaultState();
    state.settings = normalizeVisualSettings({ ...defaults.settings, ...(state.settings || {}) });
    state.settings.trashRetentionDays = normalizeTrashRetentionDays(state.settings.trashRetentionDays);
    state.systemSettings = normalizeSystemSettings({ ...defaults.systemSettings, ...(state.systemSettings || {}) });
    state.fs = state.fs || defaults.fs;
    state.tasks = Array.isArray(state.tasks) ? state.tasks : defaults.tasks;
    state.events = Array.isArray(state.events) ? state.events : defaults.events;
    state.notifications = Array.isArray(state.notifications) ? state.notifications : defaults.notifications;
    state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory.slice(-20) : [];
    state.firstRunCompleted = Boolean(state.firstRunCompleted);
    state.taskbarPinnedApps = normalizeTaskbarPinnedApps(state.taskbarPinnedApps || defaults.taskbarPinnedApps, apps);
    state.searchSettings = normalizeSearchSettings(state.searchSettings || defaults.searchSettings);
    normalizeStartPinnedState(state);
    state.desktops = Array.isArray(state.desktops) && state.desktops.length
      ? state.desktops
      : [{ id: "desktop", name: "Основной", description: defaultDesktopDescription("desktop") }];
    if (!state.desktops.some(desktop => desktop.id === "desktop")) {
      state.desktops.unshift({ id: "desktop", name: "Основной", description: defaultDesktopDescription("desktop") });
    }
    state.desktops = state.desktops.map((desktop, index) => normalizeDesktopRecord(desktop, index));
    state.currentDesktop = state.currentDesktop || "desktop";
    if (!state.desktops.some(desktop => desktop.id === state.currentDesktop)) state.currentDesktop = "desktop";
    removeExplorerAppShortcutsFromState(state);
    removeWorkspaceDocumentsFoldersFromState(state);
    normalizeNotesData(state, { appCenterName: apps.appcenter?.name });
    normalizeShortcutItems(state);
    normalizeItemCustomizations(state);
    normalizeTablesData(state);
    normalizeTaskStore(state);
    normalizeCalendarStore(state);
    normalizeNotificationStore(state);
    normalizeTaskListsData(state);
    syncLegacyWorkspaceAliases(state);
    normalizeTrashState(state);
    purgeExpiredTrashItems(state, { dropActionHistory: true });
    state.security = normalizeSecurityMeta(state.security);
    state.version = OS_VERSION_NUMBER;
    state.osVersion = OS_VERSION;
    return state;
  }

  window.ZETER_STATE_MIGRATION_UTILS = Object.freeze({
    migrateState
  });
})();
