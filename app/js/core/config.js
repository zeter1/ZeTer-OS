(() => {
  "use strict";

  const STORAGE_KEY = "zeter_os_state_v3";
  const OS_VERSION = String(window.ZETER_OS_VERSION || "unknown");
  // Версия формата данных не зависит от номера выпуска приложения.
  const OS_VERSION_NUMBER = 26;
  const DAY_MS = 24 * 60 * 60 * 1000;

  Object.defineProperty(window, "ZETER_OS_CONFIG", {
    value: Object.freeze({
      STORAGE_KEY,
      OS_VERSION,
      OS_VERSION_NUMBER,
      DEFAULT_DESKTOP_APP_IDS: Object.freeze(["tasks", "calendar", "links", "contacts", "settings", "about", "security", "monitor", "appcenter", "help"]),
      DEVELOPER: Object.freeze({
        name: "Дмитрий Колесниченко",
        email: "zeter11@gmail.com"
      }),
      LEGACY_DELETED_ROOT: "__zeter_trash__",
      DAY_MS,
      ACTIVE_CACHE_NAME: `zeter-os-${OS_VERSION}`,
      OLD_LOCAL_STORAGE_KEYS: Object.freeze(["zeter_os_state_v1", "zeter_os_state_v2", STORAGE_KEY]),
      OLD_RESTORE_DB_NAMES: Object.freeze(["zeter-os-restore-points", "zeter-os-restore", "zeter-os-backups", "zeter-os-snapshots"]),
      RESTORE_DB: "zeter-os-restore-points",
      RESTORE_STORE: "points",
      RESTORE_LIMIT: 12,
      PRIMARY_STATE_DB: "zeter-os-primary-state",
      PRIMARY_STATE_STORE: "osState",
      PRIMARY_STATE_ID: "current",
      SMALL_SETTINGS_KEY: "zeter_os_small_settings_v1",
      STORAGE_WARNING_RATIO: 0.85,
      STORAGE_WARNING_COOLDOWN_MS: 10 * 60 * 1000,
      STORAGE_CHECK_DEBOUNCE_MS: 1200,
      SEARCH_RESULT_LIMIT: 80,
      BACKUP_IMPORT_MAX_BYTES: 120 * 1024 * 1024,
      BACKUP_IMPORT_MAX_STATE_BYTES: 50 * 1024 * 1024,
      BACKUP_IMPORT_MAX_ZIP_ENTRIES: 1200,
      BACKUP_IMPORT_MAX_FS_ITEMS: 5000,
      BACKUP_IMPORT_MAX_DESKTOPS: 50,
      BACKUP_IMPORT_MAX_TEXT_CHARS: 2 * 1024 * 1024,
      BACKUP_IMPORT_MAX_DATA_URL_CHARS: 9 * 1024 * 1024,
      BACKUP_IMPORT_MAX_TOTAL_DATA_URL_CHARS: 42 * 1024 * 1024,
      BACKUP_IMPORT_MAX_TASK_CHECKLIST_ITEMS: 500,
      BACKUP_IMPORT_MAX_TASK_PROJECTS: 500,
      BACKUP_IMPORT_MAX_TASKS: 5000,
      SAFE_ID_PATTERN: "^[A-Za-z0-9_-]{1,220}$",
      NATIVE_IMPORT_MAX_FILES: 100,
      NATIVE_IMPORT_MAX_TOTAL_READ_BYTES: 40 * 1024 * 1024,
      NATIVE_IMPORT_MAX_IMAGE_BYTES: 8 * 1024 * 1024,
      NATIVE_IMPORT_MAX_TEXT_BYTES: 2 * 1024 * 1024,
      ALLOWED_IMAGE_MIME_TYPES: Object.freeze(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/bmp"]),
      RICH_TEXT_IMAGE_MIME_TYPES: Object.freeze(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]),
      CALENDAR_CATEGORY_IDS: Object.freeze(["work", "personal", "health", "important"]),
      CALENDAR_REPEAT_IDS: Object.freeze(["none", "daily", "weekly", "monthly"]),
      CALENDAR_REMINDER_IDS: Object.freeze(["0", "5", "15", "60", "1440"]),
      CALENDAR_MAX_EVENTS: 10000,
      NOTIFICATION_MAX_ITEMS: 10000,
      OPEN_WINDOWS_MAX: 200
    }),
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
