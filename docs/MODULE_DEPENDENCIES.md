# Зависимости core-модулей ZeTer OS

> Этот файл генерируется командой `python tools/update_docs.py --write`. Не редактируй таблицу вручную.

- Core-модулей: 103.
- Публичных глобалов: 103.
- Статических зависимостей: 235.
- Порядок взят из `app/index.html`; каждая зависимость должна загружаться раньше потребителя.

Назначение модулей описано в [CODEMAP.md](CODEMAP.md), правила направления зависимостей — в [ARCHITECTURE.md](ARCHITECTURE.md).

| № | Модуль | Публичный глобал | Зависимости | Строк |
|---:|---|---|---|---:|
| 1 | `app/js/core/training-runtime-utils.js` | `ZETER_TRAINING_RUNTIME` | — | 536 |
| 2 | `app/js/core/boot-guard.js` | `ZETER_BOOT_GUARD` | `ZETER_TRAINING_RUNTIME` | 207 |
| 3 | `app/js/core/version.js` | `ZETER_OS_VERSION` | — | 1 |
| 4 | `app/js/core/config.js` | `ZETER_OS_CONFIG` | `ZETER_OS_VERSION` | 65 |
| 5 | `app/js/core/utils.js` | `ZETER_CORE_UTILS` | `ZETER_OS_CONFIG` | 150 |
| 6 | `app/js/core/dialog-utils.js` | `ZETER_DIALOG_UTILS` | — | 84 |
| 7 | `app/js/core/runtime-capabilities-utils.js` | `ZETER_RUNTIME_CAPABILITIES_UTILS` | `ZETER_CORE_UTILS` | 74 |
| 8 | `app/js/core/system-settings-utils.js` | `ZETER_SYSTEM_SETTINGS_UTILS` | — | 325 |
| 9 | `app/js/core/shortcut-utils.js` | `ZETER_SHORTCUT_UTILS` | `ZETER_CORE_UTILS` | 235 |
| 10 | `app/js/core/link-library-utils.js` | `ZETER_LINK_LIBRARY_UTILS` | `ZETER_SHORTCUT_UTILS` | 159 |
| 11 | `app/js/core/link-library-ui-utils.js` | `ZETER_LINK_LIBRARY_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SHORTCUT_UTILS`, `ZETER_LINK_LIBRARY_UTILS` | 189 |
| 12 | `app/js/core/prompt-library-utils.js` | `ZETER_PROMPT_LIBRARY_UTILS` | — | 93 |
| 13 | `app/js/core/contacts-utils.js` | `ZETER_CONTACTS_UTILS` | — | 129 |
| 14 | `app/js/core/shopping-utils.js` | `ZETER_SHOPPING_UTILS` | — | 150 |
| 15 | `app/js/core/shopping-ui-utils.js` | `ZETER_SHOPPING_UI_UTILS` | `ZETER_CORE_UTILS` | 309 |
| 16 | `app/js/core/expenses-utils.js` | `ZETER_EXPENSES_UTILS` | — | 197 |
| 17 | `app/js/core/expenses-ui-utils.js` | `ZETER_EXPENSES_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_EXPENSES_UTILS` | 328 |
| 18 | `app/js/core/contacts-ui-utils.js` | `ZETER_CONTACTS_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_CONTACTS_UTILS` | 215 |
| 19 | `app/js/core/prompt-library-ui-utils.js` | `ZETER_PROMPT_LIBRARY_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_PROMPT_LIBRARY_UTILS` | 173 |
| 20 | `app/js/core/business-calculations-utils.js` | `ZETER_BUSINESS_CALCULATIONS_UTILS` | — | 169 |
| 21 | `app/js/core/business-calculations-ui-utils.js` | `ZETER_BUSINESS_CALCULATIONS_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_BUSINESS_CALCULATIONS_UTILS` | 301 |
| 22 | `app/js/core/time-tracking-utils.js` | `ZETER_TIME_TRACKING_UTILS` | — | 222 |
| 23 | `app/js/core/project-overview-utils.js` | `ZETER_PROJECT_OVERVIEW_UTILS` | `ZETER_TIME_TRACKING_UTILS` | 61 |
| 24 | `app/js/core/time-tracking-ui-utils.js` | `ZETER_TIME_TRACKING_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_TIME_TRACKING_UTILS` | 326 |
| 25 | `app/js/core/first-run-ui-utils.js` | `ZETER_FIRST_RUN_UI_UTILS` | `ZETER_CORE_UTILS` | 516 |
| 26 | `app/js/core/context-menu-ui-utils.js` | `ZETER_CONTEXT_MENU_UI_UTILS` | `ZETER_CORE_UTILS` | 353 |
| 27 | `app/js/core/explorer-tab-utils.js` | `ZETER_EXPLORER_TAB_UTILS` | — | 368 |
| 28 | `app/js/core/desktop-layout-utils.js` | `ZETER_DESKTOP_LAYOUT_UTILS` | `ZETER_CORE_UTILS` | 399 |
| 29 | `app/js/core/explorer-ui-utils.js` | `ZETER_EXPLORER_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_EXPLORER_TAB_UTILS`, `ZETER_DESKTOP_LAYOUT_UTILS` | 2039 |
| 30 | `app/js/core/pinning-utils.js` | `ZETER_PINNING_UTILS` | `ZETER_OS_CONFIG` | 79 |
| 31 | `app/js/core/deletion-utils.js` | `ZETER_DELETION_UTILS` | `ZETER_OS_CONFIG` | 140 |
| 32 | `app/js/core/item-drag-ui-utils.js` | `ZETER_ITEM_DRAG_UI_UTILS` | — | 377 |
| 33 | `app/js/core/window-metrics-utils.js` | `ZETER_WINDOW_METRICS_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SYSTEM_SETTINGS_UTILS` | 146 |
| 34 | `app/js/core/window-session-utils.js` | `ZETER_WINDOW_SESSION_UTILS` | `ZETER_OS_CONFIG` | 63 |
| 35 | `app/js/core/window-ui-utils.js` | `ZETER_WINDOW_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_WINDOW_METRICS_UTILS`, `ZETER_WINDOW_SESSION_UTILS` | 617 |
| 36 | `app/js/core/sticky-utils.js` | `ZETER_STICKY_UTILS` | `ZETER_CORE_UTILS`, `ZETER_WINDOW_METRICS_UTILS` | 154 |
| 37 | `app/js/core/sticker-library-utils.js` | `ZETER_STICKER_LIBRARY_UTILS` | `ZETER_STICKY_UTILS` | 218 |
| 38 | `app/js/core/sticker-library-ui-utils.js` | `ZETER_STICKER_LIBRARY_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_STICKY_UTILS`, `ZETER_STICKER_LIBRARY_UTILS` | 372 |
| 39 | `app/js/core/native-storage.js` | `ZETER_NATIVE_STORAGE` | `ZETER_TRAINING_RUNTIME`, `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS` | 91 |
| 40 | `app/js/core/managed-file-utils.js` | `ZETER_MANAGED_FILE_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SHORTCUT_UTILS` | 1054 |
| 41 | `app/js/core/storage-utils.js` | `ZETER_STORAGE_UTILS` | `ZETER_TRAINING_RUNTIME` | 593 |
| 42 | `app/js/core/asset-utils.js` | `ZETER_ASSET_UTILS` | `ZETER_OS_CONFIG` | 509 |
| 43 | `app/js/core/security-protection-utils.js` | `ZETER_SECURITY_PROTECTION_UTILS` | `ZETER_OS_CONFIG`, `ZETER_ASSET_UTILS` | 319 |
| 44 | `app/js/core/visual-utils.js` | `ZETER_VISUAL_UTILS` | `ZETER_CORE_UTILS`, `ZETER_ASSET_UTILS` | 282 |
| 45 | `app/js/core/shell-ui-utils.js` | `ZETER_SHELL_UI_UTILS` | `ZETER_BOOT_GUARD`, `ZETER_CORE_UTILS`, `ZETER_VISUAL_UTILS` | 965 |
| 46 | `app/js/core/item-customization-utils.js` | `ZETER_ITEM_CUSTOMIZATION_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SHORTCUT_UTILS`, `ZETER_ASSET_UTILS`, `ZETER_VISUAL_UTILS` | 469 |
| 47 | `app/js/core/desktop-profile-utils.js` | `ZETER_DESKTOP_PROFILE_UTILS` | `ZETER_CORE_UTILS`, `ZETER_VISUAL_UTILS` | 45 |
| 48 | `app/js/core/desktop-ui-utils.js` | `ZETER_DESKTOP_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_CONTEXT_MENU_UI_UTILS`, `ZETER_DESKTOP_LAYOUT_UTILS`, `ZETER_EXPLORER_UI_UTILS`, `ZETER_ITEM_DRAG_UI_UTILS`, `ZETER_STICKY_UTILS`, `ZETER_MANAGED_FILE_UTILS`, `ZETER_VISUAL_UTILS` | 1070 |
| 49 | `app/js/core/preferences-writer-utils.js` | `ZETER_PREFERENCES_WRITER_UTILS` | — | 62 |
| 50 | `app/js/core/start-ui-utils.js` | `ZETER_START_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_PREFERENCES_WRITER_UTILS` | 600 |
| 51 | `app/js/core/file-import-utils.js` | `ZETER_FILE_IMPORT_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_ASSET_UTILS` | 255 |
| 52 | `app/js/core/file-template-utils.js` | `ZETER_FILE_TEMPLATE_UTILS` | — | 19 |
| 53 | `app/js/core/rich-text-utils.js` | `ZETER_RICH_TEXT_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_SHORTCUT_UTILS`, `ZETER_ASSET_UTILS` | 236 |
| 54 | `app/js/core/markdown-utils.js` | `ZETER_MARKDOWN_UTILS` | `ZETER_CORE_UTILS` | 24 |
| 55 | `app/js/core/data-normalizers.js` | `ZETER_DATA_NORMALIZERS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_PROJECT_OVERVIEW_UTILS` | 510 |
| 56 | `app/js/core/calendar-utils.js` | `ZETER_CALENDAR_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_DATA_NORMALIZERS` | 412 |
| 57 | `app/js/core/automation-utils.js` | `ZETER_AUTOMATION_UTILS` | `ZETER_CALENDAR_UTILS` | 1301 |
| 58 | `app/js/core/automation-ui-utils.js` | `ZETER_AUTOMATION_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_AUTOMATION_UTILS` | 820 |
| 59 | `app/js/core/object-link-utils.js` | `ZETER_OBJECT_LINK_UTILS` | — | 141 |
| 60 | `app/js/core/object-link-ui-utils.js` | `ZETER_OBJECT_LINK_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_OBJECT_LINK_UTILS` | 164 |
| 61 | `app/js/core/editor-ui-utils.js` | `ZETER_EDITOR_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_MANAGED_FILE_UTILS`, `ZETER_RICH_TEXT_UTILS`, `ZETER_MARKDOWN_UTILS` | 1790 |
| 62 | `app/js/core/workspace-utils.js` | `ZETER_WORKSPACE_UTILS` | `ZETER_OS_CONFIG`, `ZETER_LINK_LIBRARY_UTILS`, `ZETER_PROMPT_LIBRARY_UTILS`, `ZETER_CONTACTS_UTILS`, `ZETER_SHOPPING_UTILS`, `ZETER_EXPENSES_UTILS`, `ZETER_BUSINESS_CALCULATIONS_UTILS`, `ZETER_TIME_TRACKING_UTILS`, `ZETER_WINDOW_SESSION_UTILS`, `ZETER_VISUAL_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_AUTOMATION_UTILS`, `ZETER_OBJECT_LINK_UTILS` | 681 |
| 63 | `app/js/core/state-maintenance-utils.js` | `ZETER_STATE_MAINTENANCE_UTILS` | — | 283 |
| 64 | `app/js/core/task-ui-utils.js` | `ZETER_TASK_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_PROJECT_OVERVIEW_UTILS` | 406 |
| 65 | `app/js/core/project-overview-ui-utils.js` | `ZETER_PROJECT_OVERVIEW_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_TIME_TRACKING_UTILS`, `ZETER_PROJECT_OVERVIEW_UTILS` | 115 |
| 66 | `app/js/core/task-app-ui-utils.js` | `ZETER_TASK_APP_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_PROJECT_OVERVIEW_UTILS`, `ZETER_PREFERENCES_WRITER_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_TASK_UI_UTILS` | 1298 |
| 67 | `app/js/core/calendar-ui-utils.js` | `ZETER_CALENDAR_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_PREFERENCES_WRITER_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_CALENDAR_UTILS` | 721 |
| 68 | `app/js/core/notification-utils.js` | `ZETER_NOTIFICATION_UTILS` | `ZETER_CALENDAR_UTILS` | 463 |
| 69 | `app/js/core/notification-ui-utils.js` | `ZETER_NOTIFICATION_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SYSTEM_SETTINGS_UTILS`, `ZETER_NOTIFICATION_UTILS` | 432 |
| 70 | `app/js/core/import-utils.js` | `ZETER_IMPORT_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_ASSET_UTILS`, `ZETER_SECURITY_PROTECTION_UTILS` | 382 |
| 71 | `app/js/core/state-import-validator.js` | `ZETER_STATE_IMPORT_VALIDATOR` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_LINK_LIBRARY_UTILS`, `ZETER_PROMPT_LIBRARY_UTILS`, `ZETER_CONTACTS_UTILS`, `ZETER_SHOPPING_UTILS`, `ZETER_EXPENSES_UTILS`, `ZETER_BUSINESS_CALCULATIONS_UTILS`, `ZETER_TIME_TRACKING_UTILS`, `ZETER_STICKER_LIBRARY_UTILS`, `ZETER_ASSET_UTILS`, `ZETER_ITEM_CUSTOMIZATION_UTILS`, `ZETER_RICH_TEXT_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_IMPORT_UTILS` | 580 |
| 72 | `app/js/core/export-utils.js` | `ZETER_EXPORT_UTILS` | `ZETER_SECURITY_PROTECTION_UTILS` | 566 |
| 73 | `app/js/core/download-utils.js` | `ZETER_DOWNLOAD_UTILS` | `ZETER_NATIVE_STORAGE`, `ZETER_ASSET_UTILS`, `ZETER_EXPORT_UTILS` | 74 |
| 74 | `app/js/core/security-utils.js` | `ZETER_SECURITY_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_SECURITY_PROTECTION_UTILS` | 521 |
| 75 | `app/js/core/security-restore-utils.js` | `ZETER_SECURITY_RESTORE_UTILS` | — | 448 |
| 76 | `app/js/core/security-vault-utils.js` | `ZETER_SECURITY_VAULT_UTILS` | `ZETER_SECURITY_PROTECTION_UTILS` | 408 |
| 77 | `app/js/core/cloud-payload-utils.js` | `ZETER_CLOUD_PAYLOAD_UTILS` | `ZETER_ASSET_UTILS`, `ZETER_SECURITY_PROTECTION_UTILS` | 46 |
| 78 | `app/js/core/google-drive-sync-utils.js` | `ZETER_GOOGLE_DRIVE_SYNC_UTILS` | `ZETER_CLOUD_PAYLOAD_UTILS` | 238 |
| 79 | `app/js/core/security-recovery-utils.js` | `ZETER_SECURITY_RECOVERY_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_ASSET_UTILS`, `ZETER_SECURITY_PROTECTION_UTILS`, `ZETER_SECURITY_UTILS`, `ZETER_SECURITY_RESTORE_UTILS`, `ZETER_CLOUD_PAYLOAD_UTILS`, `ZETER_GOOGLE_DRIVE_SYNC_UTILS` | 295 |
| 80 | `app/js/core/security-ui-utils.js` | `ZETER_SECURITY_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SECURITY_PROTECTION_UTILS`, `ZETER_SECURITY_UTILS` | 1469 |
| 81 | `app/js/core/readable-export-utils.js` | `ZETER_READABLE_EXPORT_UTILS` | `ZETER_CORE_UTILS`, `ZETER_ASSET_UTILS`, `ZETER_RICH_TEXT_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_EXPORT_UTILS` | 722 |
| 82 | `app/js/core/table-utils.js` | `ZETER_TABLE_UTILS` | `ZETER_CORE_UTILS`, `ZETER_MANAGED_FILE_UTILS`, `ZETER_EXPORT_UTILS` | 346 |
| 83 | `app/js/core/xlsx-utils.js` | `ZETER_XLSX_UTILS` | `ZETER_ASSET_UTILS`, `ZETER_EXPORT_UTILS` | 176 |
| 84 | `app/js/core/table-ui-utils.js` | `ZETER_TABLE_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SHORTCUT_UTILS`, `ZETER_MANAGED_FILE_UTILS`, `ZETER_TABLE_UTILS` | 399 |
| 85 | `app/js/core/table-app-interactions.js` | `ZETER_TABLE_APP_INTERACTIONS` | `ZETER_CORE_UTILS`, `ZETER_EDITOR_UI_UTILS`, `ZETER_TABLE_UTILS`, `ZETER_XLSX_UTILS`, `ZETER_TABLE_UI_UTILS` | 322 |
| 86 | `app/js/core/calculator-utils.js` | `ZETER_CALCULATOR_UTILS` | — | 74 |
| 87 | `app/js/core/calculator-ui-utils.js` | `ZETER_CALCULATOR_UI_UTILS` | `ZETER_CORE_UTILS` | 42 |
| 88 | `app/js/core/app-catalog.js` | `ZETER_APP_CATALOG` | — | 65 |
| 89 | `app/js/core/item-metadata.js` | `ZETER_ITEM_METADATA` | `ZETER_SHORTCUT_UTILS`, `ZETER_MANAGED_FILE_UTILS`, `ZETER_ITEM_CUSTOMIZATION_UTILS` | 54 |
| 90 | `app/js/core/item-properties-ui-utils.js` | `ZETER_ITEM_PROPERTIES_UI_UTILS` | — | 27 |
| 91 | `app/js/core/fs-item-utils.js` | `ZETER_FS_ITEM_UTILS` | `ZETER_OS_CONFIG` | 411 |
| 92 | `app/js/core/explorer-utils.js` | `ZETER_EXPLORER_UTILS` | `ZETER_ASSET_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_EXPORT_UTILS`, `ZETER_READABLE_EXPORT_UTILS`, `ZETER_TABLE_UTILS` | 1201 |
| 93 | `app/js/core/help-content.js` | `ZETER_HELP_CONTENT` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS` | 1382 |
| 94 | `app/js/core/monitor-utils.js` | `ZETER_MONITOR_UTILS` | `ZETER_CORE_UTILS` | 1064 |
| 95 | `app/js/core/photo-ui-utils.js` | `ZETER_PHOTO_UI_UTILS` | `ZETER_CORE_UTILS` | 127 |
| 96 | `app/js/core/settings-ui-utils.js` | `ZETER_SETTINGS_UI_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_SYSTEM_SETTINGS_UTILS`, `ZETER_VISUAL_UTILS`, `ZETER_SHELL_UI_UTILS`, `ZETER_PREFERENCES_WRITER_UTILS` | 719 |
| 97 | `app/js/core/about-ui-utils.js` | `ZETER_ABOUT_UI_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_RUNTIME_CAPABILITIES_UTILS`, `ZETER_APP_CATALOG` | 162 |
| 98 | `app/js/core/update-ui-utils.js` | `ZETER_UPDATE_UI_UTILS` | `ZETER_CORE_UTILS` | 282 |
| 99 | `app/js/core/app-center-ui-utils.js` | `ZETER_APP_CENTER_UI_UTILS` | `ZETER_CORE_UTILS` | 183 |
| 100 | `app/js/core/search-utils.js` | `ZETER_SEARCH_UTILS` | `ZETER_CORE_UTILS`, `ZETER_TABLE_UTILS` | 850 |
| 101 | `app/js/core/initial-state-utils.js` | `ZETER_INITIAL_STATE_UTILS` | `ZETER_OS_CONFIG`, `ZETER_CORE_UTILS`, `ZETER_SYSTEM_SETTINGS_UTILS`, `ZETER_PINNING_UTILS`, `ZETER_VISUAL_UTILS`, `ZETER_APP_CATALOG`, `ZETER_SEARCH_UTILS` | 131 |
| 102 | `app/js/core/state-migration-utils.js` | `ZETER_STATE_MIGRATION_UTILS` | `ZETER_OS_CONFIG`, `ZETER_SYSTEM_SETTINGS_UTILS`, `ZETER_SHORTCUT_UTILS`, `ZETER_PINNING_UTILS`, `ZETER_VISUAL_UTILS`, `ZETER_ITEM_CUSTOMIZATION_UTILS`, `ZETER_DATA_NORMALIZERS`, `ZETER_WORKSPACE_UTILS`, `ZETER_STATE_MAINTENANCE_UTILS`, `ZETER_SECURITY_UTILS`, `ZETER_TABLE_UTILS`, `ZETER_SEARCH_UTILS`, `ZETER_INITIAL_STATE_UTILS` | 88 |
| 103 | `app/js/core/search-ui-utils.js` | `ZETER_SEARCH_UI_UTILS` | `ZETER_CORE_UTILS`, `ZETER_SEARCH_UTILS` | 1070 |

При добавлении, удалении, переименовании core-модуля или изменении порядка загрузки обнови `app/index.html`, `app/service-worker.js` и `REQUIRED_SCRIPT_ORDER`. После любых изменений core-модулей запусти генератор документации и строгую проверку проекта.
