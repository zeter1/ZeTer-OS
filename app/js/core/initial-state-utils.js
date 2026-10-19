(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const coreUtils = window.ZETER_CORE_UTILS;
  const visualUtils = window.ZETER_VISUAL_UTILS;
  const systemSettingsUtils = window.ZETER_SYSTEM_SETTINGS_UTILS;
  const pinningUtils = window.ZETER_PINNING_UTILS;
  const searchUtils = window.ZETER_SEARCH_UTILS;
  const appCatalog = window.ZETER_APP_CATALOG;
  if (!config || !coreUtils || !visualUtils || !systemSettingsUtils || !pinningUtils || !searchUtils || !appCatalog) {
    throw new Error("ZeTer OS initial state utils require config, core, visual, system settings, pinning and search utils.");
  }

  const {
    OS_VERSION,
    OS_VERSION_NUMBER,
    DEFAULT_TRASH_RETENTION_DAYS
  } = config;
  const { uid, todayISO } = coreUtils;
  const { defaultDesktopDescription } = visualUtils;
  const { normalizeSystemSettings } = systemSettingsUtils;
  const { DEFAULT_TASKBAR_PINNED_APPS } = pinningUtils;
  const { SEARCH_FILTER_IDS } = searchUtils;

  function defaultState() {
    const now = todayISO();
    const fs = {};
    const add = item => { fs[item.id] = item; return item.id; };
    const item = (id, type, name, parent, x, y, extra = {}) => add({
      id,
      type,
      name,
      parent,
      x,
      y,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...extra
    });

    item("app_tasks", "app", "Задачи", "desktop", 32, 24, { appId: "tasks" });
    item("app_calendar", "app", "Календарь", "desktop", 224, 24, { appId: "calendar" });
    item("app_calculator", "app", "Калькулятор", "desktop", 32, 132, { appId: "calculator" });
    item("app_monitor", "app", "Монитор системы", "desktop", 128, 132, { appId: "monitor" });
    item("app_settings", "app", "Настройки", "desktop", 224, 132, { appId: "settings" });
    item("app_editor", "app", "Текстовый редактор", "desktop", 128, 240, { appId: "editor" });
    item("app_photos", "app", "Фото", "desktop", 224, 240, { appId: "photos" });
    (config.DEFAULT_DESKTOP_APP_IDS || []).forEach((appId, index) => {
      if (fs[`app_${appId}`]) return;
      const name = appCatalog.APP_CATALOG_DEFINITIONS[appId].name;
      item(`app_${appId}`, "app", name, "desktop", 32 + Math.floor(index / 4) * 112, 24 + (index % 4) * 112, { appId });
    });

    return {
      version: OS_VERSION_NUMBER,
      osVersion: OS_VERSION,
      firstRunCompleted: false,
      actionHistory: [],
      currentDesktop: "desktop",
      desktops: [{ id: "desktop", name: "Основной", description: defaultDesktopDescription("desktop") }],
      settings: { theme: "dark", wallpaper: "aurora", accent: "blue", blur: 0, brightness: 100, volume: 74, iconSize: 1, trashRetentionDays: DEFAULT_TRASH_RETENTION_DAYS },
      systemSettings: normalizeSystemSettings(),
      security: {
        lastFullBackupAt: 0,
        lastFullBackupSize: 0,
        lastFullBackupName: "",
        lastBackupVerifiedAt: 0,
        lastBackupVerified: false,
        lastEncryptedBackupAt: 0,
        lastRecoveryTestAt: 0,
        lastRecoveryTestStatus: "",
        lastIntegrityCheckAt: 0,
        lastIntegrityStatus: "",
        lastIntegrityOutcome: "not_checked",
        lastIntegrityBad: 0,
        lastIntegrityWarn: 0,
        lastAutoRestorePointAt: 0,
        protectionPolicy: { profile: "standard", autoRestoreHours: 24, restoreLimit: 8, verifiedBackupMaxAgeDays: 7 },
        journal: []
      },
      taskbarPinnedApps: [...DEFAULT_TASKBAR_PINNED_APPS],
      searchSettings: { filters: [...SEARCH_FILTER_IDS] },
      fs,
      automations: [],
      automationCategories: [],
      automationRuntime: {
        paused: false,
        baselineSeeded: false,
        knownFileIds: [],
        queue: [],
        history: [],
        checkpoints: [],
        rateLog: []
      },
      objectLinks: [],
      tasks: [
        {
          id: uid("task"),
          title: "Изучить ZeTer OS",
          description: "Открыть настройки, календарь и задачник",
          status: "done",
          priority: "medium",
          due: now,
          tag: "Система",
          checklist: [
            { id: uid("sub"), text: "Открыть Пуск", done: true },
            { id: uid("sub"), text: "Сделать бэкап", done: false }
          ],
          createdAt: Date.now()
        },
        {
          id: uid("task"),
          title: "Добавить свои файлы в папки",
          description: "Создать папки и перенести туда заметки",
          status: "doing",
          priority: "high",
          due: now,
          tag: "Файлы",
          checklist: [],
          createdAt: Date.now()
        }
      ],
      events: [],
      notifications: []
    };
  }

  window.ZETER_INITIAL_STATE_UTILS = Object.freeze({
    defaultState
  });
})();
