# Repository Guidelines

Отвечай просто по-русски. Источник истины — текущий проект.

## Режим задачи

- **Аудит/объяснение** — только чтение.
- **Диагностика** — подтверди причину; исправление требует просьбы.
- **Изменение** — безопасная реализация и проверка; остановка только при конкретном блокере.

## Перед работой

- Начни с `git status --short`, diff и [docs/README.md](docs/README.md). Не откатывай чужую работу.
- До import/startup/test/build проверь изоляцию по [docs/TESTING.md](docs/TESTING.md): cwd/TEMP не перенаправляют `data/`.
- Владелец: `python tools/find_owner.py "запрос"`; frontend: [workflow](docs/FRONTEND_WORKFLOW.md). Сверь [CODEMAP](docs/CODEMAP.md) и `rg`: вызовы, глобалы, selectors, `data-*`, state-пути.
- Запуск/storage/bridge: сначала [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) и актуальный журнал.
- Диагностика: соблюдай [контракт](<Логи проблем/README_FOR_CODEX.md>).
- uCoz/MCP: [инструкция](docs/UCOZ.md). Backup/проверка до переключения; постоянный `index.html`, без `releases`.
- Без массового форматирования, несвязанного рефакторинга и удаления возможностей. Уточняй существенный выбор/риск данных.

## Удаление материалов

Корзины нет, включая учёт времени: не возвращай UI, move/restore/undo API и автоочистку. Файлы удаляет `app/js/core/deletion-utils.js`; занятия — staged transaction своего controller. Проверяй подтверждение → отмена, отказ → повтор, сохранность соседних данных. `deletedAt`, `originalParent`, `LEGACY_DELETED_ROOT` — совместимость прежних сохранений: скрывай без автоуничтожения. Подробности — [DATA_MODEL](docs/DATA_MODEL.md#удаление-и-legacy-совместимость).

## JavaScript, CSS и данные

- `app/js/app.js` — composition root: state, DOM, запуск, сохранение, окна, native-вызовы, adapters. Не сокращай ради счётчика строк.
- Предметная логика — у владельца `app/js/core/`. Новый core: отдельная ответственность, один `window.ZETER_*`, без дублирования.
- `app/css/style.css` содержит только упорядоченные `@import`. Статику держи в тематическом CSS, inline-style — для runtime-значений.
- Перед state/import/storage читай [DATA_MODEL](docs/DATA_MODEL.md), pywebview API — [NATIVE_BRIDGE](docs/NATIVE_BRIDGE.md). Реальные `data/` для тестов запрещены.
- Сохраняй schema, ID, данные/тексты; учитывай Windows 11/UTF-8, кириллицу, пробелы, другой cwd.
- Видимый сценарий, название, hotkey, формат, удаление, storage, import/export, backup → [help-content.js](app/js/core/help-content.js) по [HELP_MAINTENANCE](docs/HELP_MAINTENANCE.md). Внутренний рефакторинг не требует правки справки.

## Проверка и сдача

- После правки обнови версию, CHANGELOG и PWA-кэш по [правилам версий](README.md#версии-и-история-изменений).

- JS: `node --check` и профильный smoke; suite: `node tools/run_smokes.js`. Справка: `node tools/smoke_help_content.js` и UI.
- Полная команда: `.\check_project.cmd --strict-node --no-pause`; допустимы только `0 warnings` и `0 failures`.
- Core → `python tools/update_docs.py --write`, затем `--check`; владелец/сценарий/контракт/якорь → manifest и `CODEMAP.md`.
- UI: [docs/TESTING.md](docs/TESTING.md) или передай непроверенные шаги.
- Перед сдачей: `git diff --check`, `git status --short`, `git diff --stat` и просмотр diff. Не коммить без просьбы.
