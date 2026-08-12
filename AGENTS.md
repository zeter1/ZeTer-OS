# Repository Guidelines

Отвечай по-русски, просто и по делу. Источник истины — текущий проект.

## Режим задачи

- **Аудит или объяснение** — изучи код и не изменяй его.
- **Диагностика** — подтверди причину; исправляй только по просьбе.
- **Изменить или исправить** — выбери безопасную реализацию и доведи сценарий до проверки. Остановись только при конкретном блокере.

## Перед работой

- Начни с `git status --short`, относящегося diff и [docs/README.md](docs/README.md). Не откатывай чужую работу.
- Неизвестного владельца ищи через `python tools/find_owner.py "запрос"`; для структурной frontend-задачи читай [docs/FRONTEND_WORKFLOW.md](docs/FRONTEND_WORKFLOW.md). Подтверди результат через [docs/CODEMAP.md](docs/CODEMAP.md), вызовы и `rg` по функциям, глобалам, классам, `data-*` и state-путям.
- При проблемах запуска, storage или bridge сначала читай `data/logs/zeter-os.log` и [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).
- Не делай массовое форматирование, несвязанный рефакторинг и удаление возможностей. Уточняй существенный выбор или риск для данных.

## JavaScript, CSS и данные

- `app/js/app.js` — composition root для state, DOM, запуска, сохранения, окон, native-вызовов и adapters. Не уменьшай его ради счётчика строк.
- Предметную логику меняй у владельца в `app/js/core/`. Новый core допустим для отдельной ответственности и одного `window.ZETER_*`; не дублируй код.
- `app/css/style.css` содержит только упорядоченные `@import`. Статику держи в тематическом CSS, inline-style — для runtime-значений.
- Перед state/import/storage читай [docs/DATA_MODEL.md](docs/DATA_MODEL.md), перед pywebview API — [docs/NATIVE_BRIDGE.md](docs/NATIVE_BRIDGE.md). Не тестируй на реальных `data/`.
- Сохраняй schema, ID, пользовательские данные и тексты. Учитывай Windows 11, UTF-8, кириллицу, пробелы и другой cwd.
- После изменения видимого сценария, названия, hotkey, формата, удаления, storage, import/export или backup сверь [app/js/core/help-content.js](app/js/core/help-content.js). Устаревшую справку обнови по [docs/HELP_MAINTENANCE.md](docs/HELP_MAINTENANCE.md); внутренний рефакторинг этого не требует.

## Проверка и сдача

- Для изменённого JS выполни `node --check` и профильный smoke; весь набор — `node tools/run_smokes.js`. Для справки запусти `node tools/smoke_help_content.js` и проверь UI.
- Полная команда: `.\check_project.cmd --strict-node --no-pause`; допустимы только `0 warnings` и `0 failures`.
- После core-изменения выполни `python tools/update_docs.py --write`, затем `--check`; при изменении владельца, сценария, контракта или якоря обнови manifest и `CODEMAP.md`.
- UI проверяй по [docs/TESTING.md](docs/TESTING.md) либо явно передай непроверенные шаги.
- Перед сдачей: `git diff --check`, `git status --short`, `git diff --stat` и просмотр diff. Не коммить без просьбы.
