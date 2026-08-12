# Документация ZeTer OS

Это основная точка входа в техническую документацию. Источник истины — текущий код. Выбирай документ по задаче и не читай весь комплект для небольшой локальной правки.

## Что читать

| Задача | Документ |
|---|---|
| Повседневно менять `app/js` и `app/css` с Codex | [FRONTEND_WORKFLOW.md](FRONTEND_WORKFLOW.md) |
| Выполнить конкретный рецепт правки | [EDITING_GUIDE.md](EDITING_GUIDE.md) |
| Понять слои и архитектурные границы | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Найти core-модуль, CSS-файл или поисковый якорь | [CODEMAP.md](CODEMAP.md) |
| Найти владельцев полного пользовательского сценария | [SCENARIO_MAP.md](SCENARIO_MAP.md) |
| Найти публичный метод core и его consumers | [CORE_API_INDEX.md](CORE_API_INDEX.md) |
| Найти DOM/data-hook и JS/CSS-владельцев | [UI_CONTRACTS.md](UI_CONTRACTS.md) |
| Проследить поле через default → storage | [STATE_LIFECYCLE.md](STATE_LIFECYCLE.md) |
| Проверить реальный порядок core-зависимостей | [MODULE_DEPENDENCIES.md](MODULE_DEPENDENCIES.md) |
| Изменить state, migration, import или storage | [DATA_MODEL.md](DATA_MODEL.md) |
| Изменить Python API или pywebview bridge | [NATIVE_BRIDGE.md](NATIVE_BRIDGE.md) |
| Обновить пользовательскую справку после изменения возможностей | [HELP_MAINTENANCE.md](HELP_MAINTENANCE.md) |
| Выбрать автоматические и ручные проверки | [TESTING.md](TESTING.md) |
| Диагностировать запуск, storage или PWA | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) |
| Уточнить desktop/workspace/root/state | [GLOSSARY.md](GLOSSARY.md) |
| Узнать обязательные правила Codex | [../AGENTS.md](../AGENTS.md) |
| Запустить Windows/Python-версию | [../README_PYTHON.md](../README_PYTHON.md) |

## Ответственность документов

- `FRONTEND_WORKFLOW.md` — решения по границам JS/CSS, выбор владельца и критерий законченного сценария.
- `EDITING_GUIDE.md` — точные механические рецепты и команды поиска.
- `ARCHITECTURE.md` — устойчивые слои и контракты, без истории рефакторингов.
- `CODEMAP.md` — ручная карта назначений и поисковых якорей; только отмеченная техническая сводка генерируется.
- `MODULE_DEPENDENCIES.md` — полностью генерируемый порядок, глобалы и зависимости core-модулей.
- `SCENARIO_MAP.md`, `CORE_API_INDEX.md`, `UI_CONTRACTS.md` и `STATE_LIFECYCLE.md` — генерируемые поисковые индексы; их источник — `tools/code_owners.json` и текущий JS.
- `DATA_MODEL.md` и `NATIVE_BRIDGE.md` — контракты совместимости данных и JavaScript ↔ Python.
- `HELP_MAINTENANCE.md` — обязательные триггеры, источники истины и проверка пользовательской справки.
- `TESTING.md` — единственный владелец команд, постоянных smoke-тестов и ручной матрицы.
- `TROUBLESHOOTING.md` и `GLOSSARY.md` — диагностика и единые термины.

Один факт должен иметь одно основное место. В остальных документах давай ссылку, а не копируй большой раздел.

## Когда обновлять

- Измени ручное описание `CODEMAP.md`, если изменился владелец функции, ответственность модуля, CSS-область или поисковый якорь.
- После изменения core-модулей или `tools/code_owners.json` выполни `python tools/update_docs.py --write`; генерируемые карты вручную не редактируй.
- Обнови `FRONTEND_WORKFLOW.md`, только если изменился общий JS/CSS-процесс; `EDITING_GUIDE.md` — если изменился конкретный рецепт.
- Обнови `ARCHITECTURE.md` при изменении устойчивой границы, `DATA_MODEL.md` — формата/миграции, `NATIVE_BRIDGE.md` — публичного Python API.
- Сверь пользовательскую справку по [HELP_MAINTENANCE.md](HELP_MAINTENANCE.md), если изменился видимый сценарий, приложение, название действия, горячая клавиша, путь данных, формат, backup/import или важное ограничение.
- Обнови `TESTING.md`, если изменилась команда checker’а, smoke или ручной сценарий; повторяющуюся диагностику добавляй в `TROUBLESHOOTING.md`.
- `AGENTS.md` меняй только при изменении правил агента, а не после обычной функции или визуальной правки.
