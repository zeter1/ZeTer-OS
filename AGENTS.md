# Repository Guidelines

Отвечай по-русски, просто и по делу. Источник истины — текущий проект.

## Режим задачи

- **Аудит или объяснение** — изучи код и не изменяй его.
- **Диагностика** — подтверди причину; исправляй только по просьбе.
- **Изменить или исправить** — выбери безопасную реализацию и доведи сценарий до проверки. Остановись только при конкретном блокере.

## Перед работой

- Начни с `git status --short`, diff и [docs/README.md](docs/README.md). Не откатывай чужую работу.
- До import/startup/test/build проверь изоляцию по [docs/TESTING.md](docs/TESTING.md): cwd/TEMP не перенаправляют `data/`.
- Владелец: `python tools/find_owner.py "запрос"`; frontend: [docs/FRONTEND_WORKFLOW.md](docs/FRONTEND_WORKFLOW.md). Сверь [docs/CODEMAP.md](docs/CODEMAP.md) и `rg`: вызовы, глобалы, selectors, `data-*`, state-пути.
- Запуск/storage/bridge: сначала [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) и актуальный журнал.
- Диагностика: соблюдай [контракт](<Логи проблем/README_FOR_CODEX.md>).
- uCoz/MCP: [инструкция](docs/UCOZ.md). Backup/проверка файлов до переключения; конечный адрес — постоянный `index.html`, без `releases`.
- Не делай массовое форматирование, несвязанный рефакторинг и удаление возможностей. Уточняй существенный выбор или риск для данных.

## JavaScript, CSS и данные

- `app/js/app.js` — composition root для state, DOM, запуска, сохранения, окон, native-вызовов и adapters. Не сокращай ради счётчика строк.
- Предметную логику меняй у владельца в `app/js/core/`. Новый core допустим для отдельной ответственности и одного `window.ZETER_*`; не дублируй код.
- `app/css/style.css` содержит только упорядоченные `@import`. Статику держи в тематическом CSS, inline-style — для runtime-значений.
- Перед state/import/storage читай [docs/DATA_MODEL.md](docs/DATA_MODEL.md), перед pywebview API — [docs/NATIVE_BRIDGE.md](docs/NATIVE_BRIDGE.md). Не тестируй на реальных `data/`.
- Сохраняй schema, ID, пользовательские данные/тексты; учитывай Windows 11/UTF-8, кириллицу, пробелы, другой cwd.
- После изменения видимого сценария, названия, hotkey, формата, удаления, storage, import/export или backup сверь [app/js/core/help-content.js](app/js/core/help-content.js) по [docs/HELP_MAINTENANCE.md](docs/HELP_MAINTENANCE.md); внутренний рефакторинг этого не требует.

## Проверка и сдача

- После правки обнови версию, CHANGELOG и PWA-кэш по [правилам версий](README.md#версии-и-история-изменений).

- JS: `node --check` и профильный smoke; suite: `node tools/run_smokes.js`. Справка: `node tools/smoke_help_content.js` и UI.
- Полная команда: `.\check_project.cmd --strict-node --no-pause`; допустимы только `0 warnings` и `0 failures`.
- После core-изменения выполни `python tools/update_docs.py --write`, затем `--check`; при изменении владельца, сценария, контракта или якоря обнови manifest и `CODEMAP.md`.
- UI: [docs/TESTING.md](docs/TESTING.md) или передай непроверенные шаги.
- Перед сдачей: `git diff --check`, `git status --short`, `git diff --stat` и просмотр diff. Не коммить без просьбы.
