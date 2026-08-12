# Карта кода ZeTer OS

Этот файл отвечает на вопрос «где находится код». Он не хранит историю рефакторинга и не использует номера строк, которые меняются после каждого выноса.

<!-- BEGIN GENERATED CORE SUMMARY -->
> Этот блок обновляется командой `python tools/update_docs.py --write`.

- Core-модулей: 70.
- Публичных глобалов: 70.
- Статических зависимостей: 152.
- Подробный порядок: [MODULE_DEPENDENCIES.md](MODULE_DEPENDENCIES.md).
<!-- END GENERATED CORE SUMMARY -->

## Точки входа

| Файл | Ответственность |
|---|---|
| `run_zeter_os.py` | Python launcher, локальный сервер, pywebview API, пользовательский автозапуск Windows, уникальные атомарные записи, транзакционная primary-запись, синхронизированные restore points, `data/`, резервные и Windows-копии, объединённое удержание/GC payload и preflight локального восстановления |
| `start_zeter_os.cmd` | Пользовательский запуск на Windows |
| `build_release.cmd`, `tools/build_release.py` | Многоразовая воспроизводимая сборка проверенного portable ZIP по белому списку, без `data`, логов и служебных файлов |
| `app/index.html` | DOM-оболочка и порядок подключения ресурсов |
| `app/js/app.js` | Интеграция core-модулей, текущего state, окон, событий и сохранения |
| `app/css/style.css` | Единственная CSS-точка входа |
| `app/service-worker.js` | PWA cache-name и список offline-ресурсов |
| `check_project.cmd` | Windows-wrapper поиска Python/Node и единого запуска checker’а |
| `tools/check_project.py` | Проверка структуры, документации, ресурсов, синтаксиса, JavaScript suite, Python native-smoke и smoke сборщика релиза |
| `tools/run_smokes.js` | Последовательный запуск постоянных сценарных smoke-тестов, включая пользовательскую справку |
| `tools/smoke_release_builder.py` | Герметичная проверка воспроизводимости, исключений, распаковки и безопасной публикации portable ZIP |
| `tools/update_docs.py` | Проверка и атомарное обновление генерируемой документации |
| `tools/code_owners.json` | Машиночитаемые владельцы сценариев, UI-hooks и жизненного цикла state |
| `tools/navigation_index.py` | Разбор публичного core API, проверка manifest и генерация навигационных карт |
| `tools/find_owner.py` | Быстрый поиск владельцев по словам, функции, selector/data-hook или state-пути |

## Core-модули

Порядок строк ниже соответствует смысловым областям, а не обязательно порядку загрузки. Фактический порядок задают `app/index.html` и `required_order` в проверяющем скрипте.

### Основа

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/boot-guard.js` | `ZETER_BOOT_GUARD` | Ранний перехват фатальных ошибок и boot-timeout, блокирующий storage-recovery с безопасными действиями и native-диагностика |
| `app/js/core/version.js` | `ZETER_OS_VERSION` | Версия интерфейса |
| `app/js/core/config.js` | `ZETER_OS_CONFIG` | Storage IDs, лимиты, cache-name и общие константы |
| `app/js/core/utils.js` | `ZETER_CORE_UTILS` | Базовые DOM, text, date, ID и math helpers |
| `app/js/core/system-settings-utils.js` | `ZETER_SYSTEM_SETTINGS_UTILS` | Defaults и совместимая нормализация глобальных настроек, горячие клавиши, тихие часы и решение о доставке уведомлений |

### Shell, окна и рабочие столы

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/shell-ui-utils.js` | `ZETER_SHELL_UI_UTILS` | Boot/first-run lifecycle, глобальные shell-события, floating-панели, top-menu dispatch, часы, toast и controllers закреплённых/running-приложений панели задач |
| `app/js/core/first-run-ui-utils.js` | `ZETER_FIRST_RUN_UI_UTILS` | Экран первого запуска |
| `app/js/core/context-menu-ui-utils.js` | `ZETER_CONTEXT_MENU_UI_UTILS` | Модели и action-dispatchers desktop/item-меню, меню Пуска, окон, панели задач и Проводника, разметка, callbacks и позиционирование контекстного меню |
| `app/js/core/pinning-utils.js` | `ZETER_PINNING_UTILS` | Закрепления taskbar и меню Пуск |
| `app/js/core/desktop-layout-utils.js` | `ZETER_DESKTOP_LAYOUT_UTILS` | Геометрия, запрещённые зоны, свободные позиции, единый delta группового перемещения и runtime-controller координат desktop-иконок |
| `app/js/core/item-drag-ui-utils.js` | `ZETER_ITEM_DRAG_UI_UTILS` | Runtime-controller pointer drag/drop: threshold, точный delta от точки захвата, ghost, широкие fallback-зоны текущей папки, подсветка folder/inline/table целей и перенос managed-файлов без создания дубля через callbacks |
| `app/js/core/window-metrics-utils.js` | `ZETER_WINDOW_METRICS_UTILS` | Начальная геометрия окон |
| `app/js/core/window-session-utils.js` | `ZETER_WINDOW_SESSION_UTILS` | Сбор runtime-сессий и нормализация сохранённых окон |
| `app/js/core/window-ui-utils.js` | `ZETER_WINDOW_UI_UTILS` | DOM-фабрика и полный runtime lifecycle окон: open/focus/actions, collect/persist/restore/cycle сессий, fallback восстановления, pointer drag/resize и геометрия |
| `app/js/core/sticky-utils.js` | `ZETER_STICKY_UTILS` | Модели lifecycle стикеров: нормализация, открытие/закрытие, размеры, цвета, стиль и resize-геометрия |
| `app/js/core/visual-utils.js` | `ZETER_VISUAL_UTILS` | Обои, иконки и visual settings |
| `app/js/core/item-customization-utils.js` | `ZETER_ITEM_CUSTOMIZATION_UTILS` | Модель и отдельное окно настройки папок/ярлыков: цвет, свои значки, фон папки, изменение имени/цели ярлыка и переносимые asset-пути |
| `app/js/core/desktop-profile-utils.js` | `ZETER_DESKTOP_PROFILE_UTILS` | Имя, описание и аватар рабочего стола |
| `app/js/core/desktop-ui-utils.js` | `ZETER_DESKTOP_UI_UTILS` | Контроллеры desktop-поверхности и item runtime: одиночное, Ctrl- и рамочное выделение, групповое перемещение выбранных значков, workspace membership, ярлыки/open dispatch, layout/drag/menu orchestration и rich-text lifecycle стикеров с позиционируемыми inline-файлами |
| `app/js/core/start-ui-utils.js` | `ZETER_START_UI_UTILS` | Фильтры, разметка и controller меню Пуск: pinning файлов, поиск, приложения и карточки рабочих столов |

### Хранение, импорт и экспорт

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/native-storage.js` | `ZETER_NATIVE_STORAGE` | Адаптер к `window.pywebview.api` |
| `app/js/core/shortcut-utils.js` | `ZETER_SHORTCUT_UTILS` | Нормализация Windows/URL/внутренних целей, модель и вложения ярлыков, окно создания и безопасные подписи/стандартные иконки |
| `app/js/core/managed-file-utils.js` | `ZETER_MANAGED_FILE_UTILS` | Полные chunked-копии Windows-файлов в `data`, позиционируемые inline-маркеры, перенос ссылок через drag/drop, копирование через Ctrl+C/Ctrl+V, координаты и размер файлов в ячейках, открытие и lifecycle удаления |
| `app/js/core/storage-utils.js` | `ZETER_STORAGE_UTILS` | Полный storage runtime: явные результаты native/IndexedDB load/save, запрет записи до успеха, primary records, малый localStorage snapshot, legacy/подтверждённый fallback, отклонение Promise при полном отказе, последовательная очередь, size/boot lifecycle и очистка старых browser-хранилищ |
| `app/js/core/asset-utils.js` | `ZETER_ASSET_UTILS` | Data URL, Blob, изображения, пути, ZIP, подготовка внешних backup-assets и runtime-controller чтения, записи и очистки export-каталогов |
| `app/js/core/file-import-utils.js` | `ZETER_FILE_IMPORT_UTILS` | Импорт обычных файлов и лимиты чтения |
| `app/js/core/file-template-utils.js` | `ZETER_FILE_TEMPLATE_UTILS` | Стартовое содержимое новых файлов |
| `app/js/core/import-utils.js` | `ZETER_IMPORT_UTILS` | Чтение и validation JSON/ZIP backup, выбор папки и hydration внешних assets, dispatcher полного restore-действия |
| `app/js/core/state-import-validator.js` | `ZETER_STATE_IMPORT_VALIDATOR` | Глубокая проверка импортируемого state |
| `app/js/core/export-utils.js` | `ZETER_EXPORT_UTILS` | Export paths, Excel-совместимый CSV с разделителем `;`, JSON/ZIP payload, скачиваемый бэкап и полный runtime lifecycle внешнего browser/native-сохранения: permission, picker, запись, status и scheduler |
| `app/js/core/download-utils.js` | `ZETER_DOWNLOAD_UTILS` | Скачивание Blob/data URL в браузере и текстовых файлов через native-диалог «Сохранить как» |
| `app/js/core/readable-export-utils.js` | `ZETER_READABLE_EXPORT_UTILS` | Ownership, синхронизация открытых редакторов и полная runtime-сборка человекочитаемого экспорта: DOCX заметок, CSV таблиц, TXT рабочих столов, календаря, задач и профилей |
| `app/js/core/state-maintenance-utils.js` | `ZETER_STATE_MAINTENANCE_UTILS` | Миграционная уборка, action history и controller очистки runtime/saved ссылок удаляемых items |
| `app/js/core/state-migration-utils.js` | `ZETER_STATE_MIGRATION_UTILS` | Оркестрация миграции загруженного state: defaults, normalizers, очистка ссылок, trash callbacks и установка версии в неизменном порядке |

### Файлы, проводник и редакторы

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/fs-item-utils.js` | `ZETER_FS_ITEM_UTILS` | Имена, пути, descendants и item-controller: создание, rename, deep duplicate, properties и typed creators |
| `app/js/core/explorer-tab-utils.js` | `ZETER_EXPLORER_TAB_UTILS` | View-model, переходы и сохранение сессии вкладок |
| `app/js/core/explorer-utils.js` | `ZETER_EXPLORER_UTILS` | Runtime-controller Проводника: корни/системные папки, Windows-подобное дерево рабочего стола и пространства файлов, закрепления, layout, вкладки, адрес, поиск, перемещения, preview и download flow |
| `app/js/core/explorer-ui-utils.js` | `ZETER_EXPLORER_UI_UTILS` | Полный view-model/controller Проводника: shell, постоянная левая навигация, вкладки, preview, упорядоченная прокручиваемая сетка корня рабочего стола без изменения desktop-координат, меню, selection, ожидание подтверждённого удаления, filter/keyboard и широкие внутренние/Windows drag-drop зоны |
| `app/js/core/item-metadata.js` | `ZETER_ITEM_METADATA` | Иконки и подписи типов items |
| `app/js/core/item-properties-ui-utils.js` | `ZETER_ITEM_PROPERTIES_UI_UTILS` | Текст окна свойств item |
| `app/js/core/rich-text-utils.js` | `ZETER_RICH_TEXT_UTILS` | Безопасный rich-text HTML с каноническими маркерами inline-файлов и проверенным горизонтальным смещением |
| `app/js/core/markdown-utils.js` | `ZETER_MARKDOWN_UTILS` | Markdown renderer |
| `app/js/core/editor-ui-utils.js` | `ZETER_EDITOR_UI_UTILS` | HTML/UI и runtime-controller rich-text, Markdown и Notes: inline-файлы в позиции текста, navigation/grid, actions, Promise-aware autosave status и save/download dispatchers |

### Предметные данные и приложения

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/data-normalizers.js` | `ZETER_DATA_NORMALIZERS` | Задачи, календарь, уведомления и таблицы |
| `app/js/core/workspace-utils.js` | `ZETER_WORKSPACE_UTILS` | Рабочие пространства, runtime-доступ к desktop data/profile/openWindows, sanitation окон и Explorer spaces, action-controller создания, переключения и удаления виртуальных рабочих столов |
| `app/js/core/trash-utils.js` | `ZETER_TRASH_UTILS` | Legacy-модель отложенного удаления: normalizer, retention, move/undo/restore и permanent delete для совместимости старых state; текущий UI удаляет после подтверждения записи и откатывает state при её отказе |
| `app/js/core/task-ui-utils.js` | `ZETER_TASK_UI_UTILS` | Store adapters, доска, карточки и формы задач |
| `app/js/core/task-app-ui-utils.js` | `ZETER_TASK_APP_UI_UTILS` | Runtime-controller задач: доска, редактор, обновление открытых окон и единая навигация из поиска/уведомлений |
| `app/js/core/calendar-utils.js` | `ZETER_CALENDAR_UTILS` | Даты, повторы и операции событий |
| `app/js/core/calendar-ui-utils.js` | `ZETER_CALENDAR_UI_UTILS` | Формы, представления и полная UI-оркестрация приложения календаря |
| `app/js/core/notification-utils.js` | `ZETER_NOTIFICATION_UTILS` | Записи уведомлений, сбор напоминаний задач/календаря и lifecycle watchers |
| `app/js/core/notification-ui-utils.js` | `ZETER_NOTIFICATION_UI_UTILS` | Центр уведомлений, DOM-binding, мини-повестка и переходы к задаче или дню календаря |
| `app/js/core/security-protection-utils.js` | `ZETER_SECURITY_PROTECTION_UTILS` | Политики защиты, журнал, сводки state, manifest и контрольные суммы ZIP, проверка восстановления и переносимое AES-GCM-шифрование `.zeterbak` |
| `app/js/core/security-utils.js` | `ZETER_SECURITY_UTILS` | Снимки browser/native-хранилища, validators, полная integrity-проверка, безопасный ремонт и расчёт риска |
| `app/js/core/security-ui-utils.js` | `ZETER_SECURITY_UI_UTILS` | Data-safety runtime-controller: security shell/actions, snapshot/integrity/fix, storage pressure/cleanup/reset, restore points с native payload-preflight и откатом state при отказе сохранения, внешний browser folder handle |
| `app/js/core/table-utils.js` | `ZETER_TABLE_UTILS` | Табличные данные, стили и импорт CSV с автоопределением разделителей `;`/`,` |
| `app/js/core/xlsx-utils.js` | `ZETER_XLSX_UTILS` | Генерация настоящей книги Excel: страницы → листы, размеры столбцов/строк и безопасные XML-имена |
| `app/js/core/table-ui-utils.js` | `ZETER_TABLE_UI_UTILS` | HTML и UI-helpers таблицы: layout, формат, навигация, resize ячеек и ширины файлов с раскрытием имени и автоматическим сжатием по столбцу |
| `app/js/core/table-app-interactions.js` | `ZETER_TABLE_APP_INTERACTIONS` | Runtime-controller таблицы: lifecycle, автосохранение, активная ячейка, страницы, форматирование, структура и экспорт Excel |
| `app/js/core/calculator-utils.js` | `ZETER_CALCULATOR_UTILS` | Безопасный расчёт выражений |
| `app/js/core/calculator-ui-utils.js` | `ZETER_CALCULATOR_UI_UTILS` | UI и action parsing калькулятора |
| `app/js/core/app-catalog.js` | `ZETER_APP_CATALOG` | Каталог приложений и свойства окон |
| `app/js/core/help-content.js` | `ZETER_HELP_CONTENT` | Данные, HTML, поиск, навигация и действия интерактивной пользовательской справки |
| `app/js/core/monitor-utils.js` | `ZETER_MONITOR_UTILS` | Метрики Windows/WebView, предупреждения, диагностический отчёт и UI монитора |
| `app/js/core/photo-ui-utils.js` | `ZETER_PHOTO_UI_UTILS` | Сбор изображений и UI галереи |
| `app/js/core/settings-ui-utils.js` | `ZETER_SETTINGS_UI_UTILS` | UI профиля/обоев, storage-status, общего автозапуска Windows, уведомлений, запуска, доступности и настраиваемых горячих клавиш |
| `app/js/core/app-center-ui-utils.js` | `ZETER_APP_CENTER_UI_UTILS` | Карточки и UI центра приложений, поиск ярлыков и install/uninstall controller текущего рабочего стола |
| `app/js/core/search-utils.js` | `ZETER_SEARCH_UTILS` | Агрегация, фильтры, рейтинг и snippets поиска |
| `app/js/core/initial-state-utils.js` | `ZETER_INITIAL_STATE_UTILS` | Стартовое состояние первого запуска/сброса |
| `app/js/core/search-ui-utils.js` | `ZETER_SEARCH_UI_UTILS` | Фильтры, команды, result navigation, overlay и подсветка поиска |

## Области app.js

Ищи по стабильным функциям, а не по номерам строк:

| Область | Поисковые якоря |
|---|---|
| Загрузка и сохранение | `defaultState`, `readPrimaryStateRecord`, `loadState`, `saveState`, `migrate` |
| Backup, restore и import/export | `securityRuntimeController`, `exportOS`, `importOS` |
| Boot и глобальные события | `bootZeTerOs`, `shellRuntimeController`, `safeInitStep` |
| Рабочие столы и окна | `currentWorkspace`, `switchDesktop`, `openApp`, `refreshWindow` |
| Проводник и файловые действия | `renderExplorer`, `navigateFolderWindow`, `bulkMoveItemsToFolder` |
| Редакторы и Notes | `documentEditorRuntimeController`, `refreshOpenEditors` |
| Таблицы, задачи, календарь | `tableAppRuntimeController`, `taskAppRuntimeController`, `renderCalendarApp` |
| Монитор и безопасность | `renderMonitorApp`, `securityRuntimeController` |
| Поиск, настройки и уведомления | `renderSearchApp`, `renderGlobalSearch`, `renderSettingsApp`, `systemSettings`, `renderNotifications` |
| Native import и запуск | `importNativeFiles`, `initExternalSaveFolder`, `bootZeTerOs` |

## CSS-модули

| Файл | Область |
|---|---|
| `app/css/00-base.css` | Переменные, base tags, boot и обои |
| `app/css/10-shell.css` | Рабочий стол, taskbar, Пуск и поиск |
| `app/css/20-windows.css` | Окна, snap, меню, toast и lock screen |
| `app/css/30-app-common.css` | Общие формы, кнопки и стили приложений |
| `app/css/40-app-foundation.css` | Пользовательская справка, Settings, monitor, photo, paint и rich editor |
| `app/css/45-form-controls.css` | Контрастные select и form controls |
| `app/css/50-explorer.css` | Базовый проводник и sidebar |
| `app/css/60-apps-calendar-notes-tables.css` | Calendar, app center, Notes и tables |
| `app/css/80-overrides.css` | Поздние shell/app overrides |
| `app/css/85-explorer-plus.css` | Tabs, address, preview и selection |
| `app/css/90-security.css` | Центр безопасности |

## Данные и проверки

- Формат состояния: [DATA_MODEL.md](DATA_MODEL.md).
- Python API: [NATIVE_BRIDGE.md](NATIVE_BRIDGE.md).
- Команды проверок: [TESTING.md](TESTING.md).
- Актуализация пользовательской справки: [HELP_MAINTENANCE.md](HELP_MAINTENANCE.md).
- Повседневная работа с JS/CSS: [FRONTEND_WORKFLOW.md](FRONTEND_WORKFLOW.md).
- Фактический граф загрузки: [MODULE_DEPENDENCIES.md](MODULE_DEPENDENCIES.md).
- Полные пользовательские сценарии: [SCENARIO_MAP.md](SCENARIO_MAP.md).
- Публичный API и consumers: [CORE_API_INDEX.md](CORE_API_INDEX.md).
- DOM/data-hooks: [UI_CONTRACTS.md](UI_CONTRACTS.md).
- Defaults → storage для state: [STATE_LIFECYCLE.md](STATE_LIFECYCLE.md).
- Безопасная диагностика: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
- Термины проекта: [GLOSSARY.md](GLOSSARY.md).

## Быстрый поиск

```powershell
python tools/find_owner.py "preview проводника"
rg -n "function имяФункции|имяФункции" app/js/core app/js/app.js
rg -n "ZETER_ИМЯ_ГЛОБАЛА" app/index.html app/js
rg -n "нужный-css-class" app/css app/index.html
rg -n "nativeStorageCall|def имя_метода" app/js run_zeter_os.py
```
