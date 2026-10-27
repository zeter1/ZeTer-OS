# Карта кода ZeTer OS

Этот файл отвечает на вопрос «где находится код». Он не хранит историю рефакторинга и не использует номера строк, которые меняются после каждого выноса.

<!-- BEGIN GENERATED CORE SUMMARY -->
> Этот блок обновляется командой `python tools/update_docs.py --write`.

- Core-модулей: 95.
- Публичных глобалов: 95.
- Статических зависимостей: 218.
- Подробный порядок: [MODULE_DEPENDENCIES.md](MODULE_DEPENDENCIES.md).
<!-- END GENERATED CORE SUMMARY -->

Раскладка значков: `desktop-layout-utils.js#resolveIconPosition` использует фактические размеры карточок; desktop-owner — `desktop-ui-utils.js#renderDesktopIcons`, Проводник — `explorer-ui-utils.js#drawExplorerGrid` (повторное измерение после mount/resize). Scroll-координаты desktop drag/drop переводит `createDesktopLayoutRuntimeController`; стартовые приложения задаёт `config.js#DEFAULT_DESKTOP_APP_IDS`.

## Точки входа

| Файл | Ответственность |
|---|---|
| `tools/prepare_web.py`, `prepare_web.cmd`, `app/web-release.json`, `app/js/web-bootstrap.js`, `app/service-worker.js` | Прямая публикация содержимого app: generated SHA-256 manifest последним, ранний gate, целые комплекты кэша и привязка вкладок; контракт в [UCOZ.md](UCOZ.md) |
| `app/assets/icons/zeter-mark.svg`, `tools/build_brand_assets.ps1` | Исходник знака из двух синих плоскостей, цвет подложки и генератор общих SVG/PNG/ICO; потребители и контракт в [BRANDING.md](BRANDING.md) |
| `run_zeter_os.py` | Python launcher, локальный сервер, pywebview API, пользовательский автозапуск Windows, уникальные атомарные записи, транзакционная primary-запись, синхронизированные restore points, `data/`, резервные и Windows-копии, объединённое удержание/GC payload и preflight локального восстановления; runtime-сеанс diagnostics создаёт в `_run_normal_app()` |
| `google_drive_backup.py` | Desktop Google OAuth/PKCE, private per-user DPAPI и узкий Drive HTTP transport |
| `google_drive_sync.py` | Собственные обычные Drive-файлы, immutable upload/readback, operation dedupe, metadata-only move, account-bound CAS broker; private per-install sync metadata и локальные конфликтные ветки |
| `document_converter.py` | Изолированное преобразование DOC/DOCX через LibreOffice, безопасный HTML и встроенные картинки, проверка содержимого DOCX, durable pending-маркеры; native-публикация принадлежит `NativeStorageApi` |
| `app_updater.py`, `update_runner.py` | Проверка канала и пакета EXE, staging, manifest-owned замена, журнал, gates установки и rollback; контракт в [UPDATES.md](UPDATES.md) |
| `build_exe.bat`, `build_support/package_runtime.py` | Сборка Windows EXE и runtime hook для `--self-test`; инструкция в [BUILD_EXE.md](../BUILD_EXE.md) |
| `tools/build_update_package.py`, `tools/build_update_feed.py` | Пакет обновления EXE и Pages feed; отдельны от portable ZIP исходников |
| `problem_logs.py` | Дневные компактные content-free `Логи проблем` для CODEX: run identity, safe stages/evidence, fingerprints, timeline, improvement signals, caps, 120-дневное retention и emergency health |
| `start_zeter_os.cmd` | Пользовательский запуск на Windows |
| `build_release.cmd`, `tools/build_release.py` | Многоразовая воспроизводимая сборка проверенного portable ZIP по белому списку, без `data`, логов и служебных файлов |
| `build_ucoz.cmd`, `tools/build_ucoz.py` | Веб-ZIP: неизменяемые папки сборок, постоянный вход, release.json и общий Service Worker; порядок ручной передачи — [UCOZ.md](UCOZ.md) |
| `app/index.html` | DOM-оболочка и порядок подключения ресурсов |
| `app/js/app.js` | Интеграция core-модулей, текущего state, окон, событий и сохранения |
| `app/css/style.css` | Единственная CSS-точка входа |
| `app/service-worker.js` | PWA cache-name и список offline-ресурсов |
| `check_project.cmd` | Windows-wrapper поиска Python/Node и единого запуска checker’а |
| `tools/check_project.py` | Проверка структуры, документации, ресурсов, синтаксиса, JavaScript suite, Python native/problem-logs smokes и smoke сборщика релиза |
| `tools/run_smokes.js` | Последовательный запуск постоянных сценарных smoke-тестов, включая пользовательскую справку |
| `tools/smoke_release_builder.py` | Герметичная проверка воспроизводимости, исключений, распаковки и безопасной публикации portable ZIP |
| `tools/smoke_problem_logs.py` | Герметичная проверка schema, privacy, pointers, retention, deduplication и degraded health подсистемы `Логи проблем` |
| `tools/update_docs.py` | Проверка и атомарное обновление генерируемой документации |
| `tools/code_owners.json` | Машиночитаемые владельцы сценариев, UI-hooks, жизненного цикла state и Python-модулей |
| `tools/navigation_index.py` | Разбор публичного core API и Python AST без импорта приложения, проверка manifest и генерация навигационных карт |
| `tools/find_owner.py` | Быстрый поиск владельцев по словам, JS/Python-функции, selector/data-hook или state-пути |
| `tools/smoke_documentation.py` | Герметичные регрессии Python-поиска и Markdown-ссылок/якорей; включён в Python-checker |

## Core-модули

Порядок строк ниже соответствует смысловым областям, а не обязательно порядку загрузки. Фактический порядок задают `app/index.html` и `REQUIRED_SCRIPT_ORDER` в `tools/check_project.py`.

### Основа

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/boot-guard.js` | `ZETER_BOOT_GUARD` | Ранний перехват фатальных ошибок и boot-timeout, блокирующий storage-recovery с безопасными действиями и native-диагностика |
| `app/js/core/version.js` | `ZETER_OS_VERSION` | Версия интерфейса |
| `app/js/core/config.js` | `ZETER_OS_CONFIG` | Storage IDs, лимиты, cache-name и общие константы |
| `app/js/core/utils.js` | `ZETER_CORE_UTILS` | Базовые DOM, text, date, ID и math helpers |
| `app/js/core/preferences-writer-utils.js` | `ZETER_PREFERENCES_WRITER_UTILS` | Общая revision-aware очередь параметров Пуска и Настроек: объединение intent, последовательные ACK, error/retry/discard, подписки; adapter владеет публикацией |
| `app/js/core/system-settings-utils.js` | `ZETER_SYSTEM_SETTINGS_UTILS` | Defaults и совместимая нормализация глобальных настроек, горячие клавиши, тихие часы и решение о доставке уведомлений |

### Shell, окна и рабочие столы

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/shell-ui-utils.js` | `ZETER_SHELL_UI_UTILS` | Boot/first-run lifecycle, глобальные shell-события, floating-панели, top-menu dispatch, часы, toast, controllers панели задач; мобильное меню переполнения, выбор стола из шапки и перенос существующей кнопки уведомлений |
| `app/js/core/first-run-ui-utils.js` | `ZETER_FIRST_RUN_UI_UTILS` | Приветствие, шесть этапов настроек/приложений/запуска, staged snapshot, первый ZIP-бэкап и обучение на рабочем столе |
| `app/js/core/context-menu-ui-utils.js` | `ZETER_CONTEXT_MENU_UI_UTILS` | Модели и action-dispatchers desktop/item-меню, меню Пуска, окон, панели задач и Проводника, разметка, literal-заголовок мобильного меню, Escape/фокус, callbacks и позиционирование контекстного меню |
| `app/js/core/pinning-utils.js` | `ZETER_PINNING_UTILS` | Закрепления taskbar и меню Пуск |
| `app/js/core/desktop-layout-utils.js` | `ZETER_DESKTOP_LAYOUT_UTILS` | Геометрия, запрещённые зоны, свободные позиции, единый delta группового перемещения и runtime-controller координат desktop-иконок |
| `app/js/core/item-drag-ui-utils.js` | `ZETER_ITEM_DRAG_UI_UTILS` | Runtime-controller pointer drag/drop: threshold, точный delta от точки захвата, ghost, широкие fallback-зоны текущей папки, подсветка folder/inline/table целей и перенос managed-файлов без создания дубля через callbacks |
| `app/js/core/window-metrics-utils.js` | `ZETER_WINDOW_METRICS_UTILS` | Размеры новых окон по настройке и ограничение восстановленной геометрии |
| `app/js/core/window-session-utils.js` | `ZETER_WINDOW_SESSION_UTILS` | Сбор runtime-сессий и нормализация сохранённых окон |
| `app/js/core/window-ui-utils.js` | `ZETER_WINDOW_UI_UTILS` | DOM-фабрика и полный runtime lifecycle окон: open/focus/actions, синхронизация app-инструментов в шапке, collect/persist/restore/cycle сессий, fallback восстановления, pointer drag/resize и геометрия |
| `app/js/core/sticky-utils.js` | `ZETER_STICKY_UTILS` | Модели lifecycle стикеров: нормализация, открытие/закрытие, размеры, цвета, стиль и resize-геометрия |
| `app/js/core/visual-utils.js` | `ZETER_VISUAL_UTILS` | Обои, иконки, visual settings и normalizeDesktopAppearance для размеров/плотности/расширений рабочего стола |
| `app/js/core/item-customization-utils.js` | `ZETER_ITEM_CUSTOMIZATION_UTILS` | Модель и отдельное окно настройки папок/ярлыков: цвет, свои значки, фон папки, изменение имени/цели ярлыка и переносимые asset-пути |
| `app/js/core/desktop-profile-utils.js` | `ZETER_DESKTOP_PROFILE_UTILS` | Имя, описание и аватар рабочего стола |
| `app/js/core/desktop-ui-utils.js` | `ZETER_DESKTOP_UI_UTILS` | Контроллеры desktop-поверхности и item runtime: одиночное, Ctrl- и рамочное выделение, групповое перемещение выбранных значков, workspace membership, ярлыки/open dispatch, layout/drag/menu orchestration, визуальные копии значков с сохранением точки захвата и rich-text lifecycle стикеров с позиционируемыми inline-файлами |
| `app/js/core/start-ui-utils.js` | `ZETER_START_UI_UTILS` | Меню Пуск: каталог и категории, порядок закреплений, общий поиск, недавние документы, действия столов и встроенные настройки; `createStartPreferencesWriter` объединяет быстрый выбор без блокировки, с draft/retry/discard; сохранение — adapter `app.js#updateStartPreferences`, нормализация — `system-settings-utils.js` |

### Хранение, импорт и экспорт

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/native-storage.js` | `ZETER_NATIVE_STORAGE` | Адаптер к `window.pywebview.api` |
| `app/js/core/shortcut-utils.js` | `ZETER_SHORTCUT_UTILS` | Нормализация Windows/URL/внутренних целей, модель и вложения ярлыков, окно создания и безопасные подписи/стандартные иконки |
| `app/js/core/link-library-utils.js` | `ZETER_LINK_LIBRARY_UTILS` | Библиотека рабочего стола: нормализация/импорт, ключи дублей, категории, CRUD и подтверждённое сохранение с захваченным workspace и откатом только его library |
| `app/js/core/link-library-ui-utils.js` | `ZETER_LINK_LIBRARY_UI_UTILS` | Приложение Ссылки: категории с шестерёнкой и закреплением, поиск, карточки с кликабельным адресом, форма, избранное, ошибки и явные действия |
| `app/js/core/prompt-library-utils.js` | `ZETER_PROMPT_LIBRARY_UTILS` | Библиотека промптов рабочего стола: проекты и общие промпты, категории, импорт, перенос/удаление проекта, staged snapshot и подтверждённая публикация под transaction barrier |
| `app/js/core/time-tracking-utils.js` | `ZETER_TIME_TRACKING_UTILS` | Интервалы и паузы, ручные записи/пересечения, заметки, stale-edit guard, повтор/recovery, цель, прямое удаление после подтверждённой записи, локальные периоды, общая выборка сводки/CSV и staged сохранение |
| `app/js/core/time-tracking-ui-utils.js` | `ZETER_TIME_TRACKING_UI_UTILS` | Таймер и live-сводка, график/цель, недавние занятия, фильтруемый журнал по 30 записей, modal-формы с фокусом и черновиками, порядок проект→задача, создание общих задач/проектов, перенос будущей работы в календарь, карточки с подписями проекта/задачи/дат/промежутка/пауз, pending-удаление без блокировки формы, подтверждение и повтор после отказа и CSV через adapter |
| `app/js/core/business-calculations-utils.js` | `ZETER_BUSINESS_CALCULATIONS_UTILS` | 10 формул BizPilot, поля и ограничения, выбранные карточки, перенос на позицию цели и размеры, валидация импорта и staged сохранение под transaction barrier |
| `app/js/core/business-calculations-ui-utils.js` | `ZETER_BUSINESS_CALCULATIONS_UI_UTILS` | Подсчёты: каталог, живой пересчёт, ввод с автосохранением, локальное pointer-перетаскивание с движущейся карточкой, resize/сброс размера, кнопки выше/ниже и ошибки записи |
| `app/js/core/prompt-library-ui-utils.js` | `ZETER_PROMPT_LIBRARY_UI_UTILS` | Промпты: выбор проекта или общего раздела, категории, поиск, избранное, название/текст, копирование текста, черновик и themed dialogs создания/удаления |
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
| `app/js/core/state-migration-utils.js` | `ZETER_STATE_MIGRATION_UTILS` | Оркестрация миграции загруженного state: defaults, normalizers, очистка ссылок, сохранение legacy-данных и установка версии в неизменном порядке |

### Файлы, проводник и редакторы

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/fs-item-utils.js` | `ZETER_FS_ITEM_UTILS` | Имена, пути, descendants и item-controller: создание, rename, deep duplicate, properties и typed creators |
| `app/js/core/explorer-tab-utils.js` | `ZETER_EXPLORER_TAB_UTILS` | View-model, переходы и сохранение сессии вкладок |
| `app/js/core/explorer-utils.js` | `ZETER_EXPLORER_UTILS` | Runtime-controller Проводника: корни/системные папки, Windows-подобное дерево рабочего стола и пространства файлов, закрепления, layout, вкладки, адрес, поиск, перемещения, preview и download flow |
| `app/js/core/explorer-ui-utils.js` | `ZETER_EXPLORER_UI_UTILS` | Полный view-model/controller Проводника: shell, настраиваемая навигация и preview, вкладки, восемь видов папки, меню сортировки и сортировка заголовками таблицы, сохранение предпочтений и синхронизация окон, упорядоченная сетка и свободная раскладка, меню, selection, ожидание подтверждённого удаления, filter/keyboard и широкие внутренние/Windows drag-drop зоны |
| `app/js/core/item-metadata.js` | `ZETER_ITEM_METADATA` | Иконки и подписи типов items |
| `app/js/core/item-properties-ui-utils.js` | `ZETER_ITEM_PROPERTIES_UI_UTILS` | Текст окна свойств item |
| `app/js/core/rich-text-utils.js` | `ZETER_RICH_TEXT_UTILS` | Безопасный rich-text HTML с каноническими маркерами inline-файлов и проверенным горизонтальным смещением |
| `app/js/core/markdown-utils.js` | `ZETER_MARKDOWN_UTILS` | Markdown renderer |
| `app/js/core/editor-ui-utils.js` | `ZETER_EDITOR_UI_UTILS` | HTML/UI и runtime-controller rich-text, Markdown и Notes: компактные файловые действия в шапке, контекстное форматирование выделения, inline-файлы в позиции текста, navigation/grid, actions, Promise-aware autosave status и save/download dispatchers |
| `app/js/core/object-link-utils.js` | `ZETER_OBJECT_LINK_UTILS` | Нормализация, дедупликация, поиск и очистка двусторонних связей `fs`/`event` внутри рабочего стола |
| `app/js/core/object-link-ui-utils.js` | `ZETER_OBJECT_LINK_UI_UTILS` | Компактная панель «Связи», выбор кандидата, открытие и удаление только связи без удаления объекта |

### Предметные данные и приложения

| Файл | Публичный глобал | Назначение |
|---|---|---|
| `app/js/core/contacts-utils.js` | `ZETER_CONTACTS_UTILS` | Контакты: проекты, категории, повторяемые пользовательские поля, поиск и staged CRUD после подтверждения записи |
| `app/js/core/contacts-ui-utils.js` | `ZETER_CONTACTS_UI_UTILS` | Справочник: проекты слева, категории внутри проекта, список/карточка, редактор полей и действия |
| `app/js/core/data-normalizers.js` | `ZETER_DATA_NORMALIZERS` | Задачи, календарь, уведомления и таблицы; удаление предложений уже установленной версии из `normalizeNotifications` |
| `app/js/core/workspace-utils.js` | `ZETER_WORKSPACE_UTILS` | Рабочие пространства, runtime-доступ к desktop data/profile/openWindows, sanitation окон и Explorer spaces, action-controller создания, переключения и удаления виртуальных рабочих столов; desktopBackupSnapshot выделяет данные одного стола, выборочное удаление сохраняет невыбранные группы в state.archivedDesktops без переноса на основной стол |
| `app/js/core/deletion-utils.js` | `ZETER_DELETION_UTILS` | Прямое подтверждённое удаление, descendants/ссылки, откат при отказе записи и закрытие окон после ACK; корзины, восстановления и срока хранения нет |
| `app/js/core/task-ui-utils.js` | `ZETER_TASK_UI_UTILS` | Store adapters с исходным workspace owner, фильтр/сортировка/группировка доски и списка, цвет проектов, категории задач, карточки и формы |
| `app/js/core/project-overview-utils.js` | `ZETER_PROJECT_OVERVIEW_UTILS` | Bounded ссылки проекта, общий validProjectDue, сводка задач/сроков/этапов и дневной график времени с локальной неделей/паузами/recovery |
| `app/js/core/project-overview-ui-utils.js` | `ZETER_PROJECT_OVERVIEW_UI_UTILS` | Панель Обзора: прогресс, карточки сроков с переходом на доску, этапы, недельный график, материалы/события, pending/error и действия таймера |
| `app/js/core/task-app-ui-utils.js` | `ZETER_TASK_APP_UI_UTILS` | Runtime-controller задач: доска, редактор, snapshot/lock/rollback исходного store, staged создание общих проектов/задач, обновление открытых окон и единая навигация из поиска/уведомлений |
| `app/js/core/calendar-utils.js` | `ZETER_CALENDAR_UTILS` | Диапазоны фактических повторений, all-day/multi-day, раскладка пересечений и свободного времени; staged операции серии all/one/future и планирование задач с ACK/проверкой снимка |
| `app/js/core/calendar-ui-utils.js` | `ZETER_CALENDAR_UI_UTILS` | Месяц, 24-часовая неделя/день, повестка, поиск/категории/проекты, отдельные создание и автосохранение настроек выбранной категории (описание/значок), создание и настройки общего с задачами проекта через adapter, удаление собственных категорий с сохранением событий, рабочие часы, drag/range/resize, редактор с описанием/файлами до сохранения; запрет новых прошлых дат при сохранённом редактировании старых записей |
| `app/js/core/automation-utils.js` | `ZETER_AUTOMATION_UTILS` | Нормализация правил, пользовательских категорий и истории, удаление категории с отменой ожидающих запусков её правил; run-once runtime триггеров с действиями уведомления, заметки и перемещения |
| `app/js/core/automation-ui-utils.js` | `ZETER_AUTOMATION_UI_UTILS` | Приложение и отдельное окно `automationedit` с переиспользованием редактора «Когда → Условие → Действие»; `app.js` связывает открытие, подтверждённое сохранение и возврат к списку. Выбор файла для проверки и ручного запуска, подписи места хранения и переходы к объекту/папке, объяснение переменных, список, включение, изменение и удаление |
| `app/js/core/notification-utils.js` | `ZETER_NOTIFICATION_UTILS` | Записи уведомлений, сбор напоминаний задач/календаря и lifecycle watchers |
| `app/js/core/notification-ui-utils.js` | `ZETER_NOTIFICATION_UI_UTILS` | Центр уведомлений, фильтр автоматизаций, массовое прочтение/очистка, мини-повестка и переходы к связанным объектам |
| `app/js/core/security-protection-utils.js` | `ZETER_SECURITY_PROTECTION_UTILS` | Политики защиты, журнал, сводки state, manifest и контрольные суммы ZIP, проверка восстановления и переносимое AES-GCM-шифрование `.zeterbak` |
| `app/js/core/security-utils.js` | `ZETER_SECURITY_UTILS` | Снимки browser/native-хранилища, validators, полная integrity-проверка, безопасный ремонт и расчёт риска |
| `app/js/core/security-restore-utils.js` | `ZETER_SECURITY_RESTORE_UTILS` | Чистый план выборочного восстановления, зависимости и переназначение ID |
| `app/js/core/security-vault-utils.js` | `ZETER_SECURITY_VAULT_UTILS` | Browser-история полных ZIP, Web Locks, pin и безопасное ограничение истории |
| `app/js/core/cloud-payload-utils.js` | `ZETER_CLOUD_PAYLOAD_UTILS` | Неизменяемые browser Blob, проверка путей/hash, collision remap, сохранение локальных веток и локальная сборка проверяемого архива |
| `app/js/core/google-drive-sync-utils.js` | `ZETER_GOOGLE_DRIVE_SYNC_UTILS` | Общий incremental sync engine: baseline, новые обычные файлы, D1 CAS, конфликты устройств и согласование видимой папки data |
| `app/js/core/google-drive-backup-utils.js` | `ZETER_GOOGLE_DRIVE_BACKUP_UTILS` | Google native/web/broker adapters и панель подключения/правил синхронизации; прежний ZIP transport остаётся внутренним |
| `app/js/core/security-recovery-utils.js` | `ZETER_SECURITY_RECOVERY_UTILS` | Проверка выбранного архива, preview/apply и расписание полных копий |
| `app/js/core/security-ui-utils.js` | `ZETER_SECURITY_UI_UTILS` | Data-safety runtime-controller: четыре раздела Центра безопасности, независимая загрузка статусов/истории/очистки, read deadline и operation busy guard, snapshot/integrity/fix, storage pressure/cleanup/reset, restore points с native payload-preflight и откатом state при отказе сохранения, внешний browser folder handle |
| `app/js/core/table-utils.js` | `ZETER_TABLE_UTILS` | Табличные данные, стили и импорт CSV с автоопределением разделителей `;`/`,` |
| `app/js/core/xlsx-utils.js` | `ZETER_XLSX_UTILS` | Генерация настоящей книги Excel: страницы → листы, размеры столбцов/строк и безопасные XML-имена |
| `app/js/core/table-ui-utils.js` | `ZETER_TABLE_UI_UTILS` | HTML и UI-helpers таблицы: layout, формат, навигация, resize ячеек и ширины файлов с раскрытием имени и автоматическим сжатием по столбцу |
| `app/js/core/table-app-interactions.js` | `ZETER_TABLE_APP_INTERACTIONS` | Runtime-controller таблицы: lifecycle, автосохранение, активная ячейка, страницы, форматирование, структура и экспорт Excel |
| `app/js/core/calculator-utils.js` | `ZETER_CALCULATOR_UTILS` | Безопасный расчёт выражений |
| `app/js/core/calculator-ui-utils.js` | `ZETER_CALCULATOR_UI_UTILS` | UI и action parsing калькулятора |
| `app/js/core/app-catalog.js` | `ZETER_APP_CATALOG` | Каталог приложений и свойства окон |
| `app/js/core/help-content.js` | `ZETER_HELP_CONTENT` | Данные, главная руководства, поиск слов в любом порядке с е/ё, оглавления, раскрытие тем, переходы разделов и меню узкого окна; browser-проверка — `tools/smoke_help_ui.js` |
| `app/js/core/monitor-utils.js` | `ZETER_MONITOR_UTILS` | Метрики Windows/WebView, история 1/5/15 минут, подтверждаемые предупреждения, диагностический отчёт и разделы монитора с сохранением DOM-контролов |
| `app/js/core/photo-ui-utils.js` | `ZETER_PHOTO_UI_UTILS` | Сбор изображений и UI галереи |
| `app/js/core/settings-ui-utils.js` | `ZETER_SETTINGS_UI_UTILS` | Семь разделов, поиск с переходом/фокусом, scope, safe reset, status/retry/discard и живые примеры. `settingsPreferences`/`applySettingsPreferencePatch` ограничивают patch; `renderSettingsApp` привязывает сессию к desktop ID и primary transaction. `disposeSettingsView` снимает подписку при close/refresh/смене стола |
| `app/js/core/about-ui-utils.js` | `ZETER_ABOUT_UI_UTILS` | Окно «О ZeTer OS»: описание, открытие руководства пользователя, текущая версия, ссылки на изменения/сборки, инструкции запуска в браузере/EXE/Python, контакты и копирование выделения через контекстное меню |
| `app/js/core/update-ui-utils.js` | `ZETER_UPDATE_UI_UTILS` | Pages feed без REST API через native bridge, проверка при запуске/6 часов, предложение рядом с «О ZeTer OS», загрузка/отмена и save barrier; инструкция `manualUpdateElement`, внешние ссылки и меню копирования выделенного текста |
| `app/js/core/app-center-ui-utils.js` | `ZETER_APP_CENTER_UI_UTILS` | Карточки центра приложений с описаниями, статусами и сводкой установки, поиск ярлыков и install/uninstall controller текущего рабочего стола |
| `app/js/core/search-utils.js` | `ZETER_SEARCH_UTILS` | Сбор всех источников, индекс нормализованного текста, scoped ключи, фильтры/рейтинг, исправления и snippets поиска |
| `app/js/core/initial-state-utils.js` | `ZETER_INITIAL_STATE_UTILS` | Стартовое состояние первого запуска/сброса |
| `app/js/core/search-ui-utils.js` | `ZETER_SEARCH_UI_UTILS` | Общий search controller, группы/preview/actions, scope/filters, bounded history, клавиатура, result navigation и overlay |

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
| Таблицы, задачи, календарь, автоматизации и связи | `tableAppRuntimeController`, `taskAppRuntimeController`, `renderCalendarApp`, `renderAutomationsApp`, `objectLinksPanelFor`, `runAutomationCheck` |
| Монитор и безопасность | `renderMonitorApp`, `securityRuntimeController` |
| Поиск, настройки и уведомления | `renderSearchApp`, `renderGlobalSearch`, `renderSettingsApp`, `systemSettings`, `renderNotifications`, `openNotification` |
| Native import и запуск | `importNativeFiles`, `initExternalSaveFolder`, `bootZeTerOs` |

## CSS-модули

| Файл | Область |
|---|---|
| `app/css/00-base.css` | Переменные, base tags, boot и обои |
| `app/css/10-shell.css` | Рабочий стол, taskbar, Пуск и поиск |
| `app/css/20-windows.css` | Окна, snap, меню, toast и lock screen |
| `app/css/30-app-common.css` | Общие формы, кнопки и стили приложений |
| `app/css/40-app-foundation.css` | Пользовательская справка, Settings, monitor, photo, paint и rich editor |
| `app/css/41-first-run.css` | Приветствие, мастер настройки и подсказки первого запуска |
| `app/css/45-form-controls.css` | Контрастные select, form controls и общие цвета состояний основных кнопок |
| `app/css/50-explorer.css` | Базовый проводник и sidebar |
| `app/css/60-apps-calendar-notes-tables.css` | Calendar, app center, Notes и tables |
| `app/css/61-tasks.css` | Задачи: sidebar, меню настроек проекта, три представления, карточки, обзор и адаптация по ширине внутреннего окна |
| `app/css/65-link-library.css` | Компактная библиотека ссылок, формы, категории и адаптация к ширине окна |
| `app/css/66-prompt-library.css` | Промпты: оформление проектов, настроек категорий и раскрываемого текста; общий layout использует `65-link-library.css` |
| `app/css/67-business-calculations.css` | Подсчёты: два столбца, компактные карточки, движущийся preview/resize, каталог, ввод/результаты, графики и узкая ширина |
| `app/css/68-time-tracking.css` | Учёт времени: timer/overview grid, график недели, цель, фильтры/журнал, modal-формы и узкие окна |
| `app/css/69-contacts.css` | Контакты: проекты, категории, список/детали и адаптивный редактор своих полей |
| `app/css/80-overrides.css` | Поздние shell/app overrides |
| `app/css/85-explorer-plus.css` | Tabs, address, preview и selection |
| `app/css/90-security.css` | Центр безопасности |
| `app/css/95-mobile.css` | Автоматическая телефонная оболочка: панели, сетка значков, полноэкранные окна, touch-контролы и safe-area; кнопка выбора стола и компактный плюс в шапке, маленькие меню на углах ярлыков; заголовки меню и «Ещё» редактора; компактная панель Проводника, кнопки действий материалов и закрытия вкладок; media query синхронизирована с `ZETER_CORE_UTILS.isMobileLayout` |

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

### Создание и навигация проектов Задач

`app/js/core/task-app-ui-utils.js`: `showTaskProjectDialog`, staged `createTaskCreationController`, `createTaskProjectSettingsController` и `showTaskProjectSettingsDialog`, общий по store `createTaskProjectNavigationController` и runtime-ревизия rollback. `app/js/app.js#createTaskProjectPersistence` связывает desktop/item identity с primary transaction. Вёрстка диалога и кнопки — `app/css/61-tasks.css`, hooks — `task-ui-utils.js#tasksAppShellHTML`. Контракт и проверки: [DATA_MODEL.md](DATA_MODEL.md), [TESTING.md](TESTING.md#создание-и-быстрая-смена-проекта).
