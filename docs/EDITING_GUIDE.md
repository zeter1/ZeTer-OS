# Практическое редактирование ZeTer OS

Здесь находятся только механические рецепты. Неизвестного владельца сначала ищи через `python tools/find_owner.py "запрос"`, затем подтверждай по [CODEMAP.md](CODEMAP.md). Решения по границам принимай по [FRONTEND_WORKFLOW.md](FRONTEND_WORKFLOW.md), архитектурные инварианты сверяй с [ARCHITECTURE.md](ARCHITECTURE.md).

## Обычная функция или исправление

1. Проверь `git status --short` и относящийся diff.
2. Найди сценарий/владельца через `find_owner.py`, затем функцию, class или `data-*` и все места использования.
3. Измени существующего JS/CSS-владельца от входа до пользовательского результата.
4. Проверь основной, пустой, граничный и ошибочный сценарии.
5. Выполни `node --check`, профильный smoke и нужный UI-сценарий.

Не меняй публичный `data-*`, class или callback contract без поиска всех потребителей. После переименования ищи старое имя во всём `app/`.

## Новый JS core-модуль

1. Убедись по `CODEMAP.md`, что подходящего владельца нет.
2. Создай `app/js/core/имя.js` с одной ответственностью и одним `window.ZETER_*`.
3. Подключи файл в `app/index.html` после зависимостей и до потребителей.
4. Добавь его в `ZETER_ASSETS` (`app/service-worker.js`) и `REQUIRED_SCRIPT_ORDER` (`tools/check_project.py`) в порядке зависимостей.
5. Добавь ручную строку core-таблицы `CODEMAP.md`. Обнови применимые записи сценария, UI и state в `tools/code_owners.json`, чтобы поиск возвращал нового владельца и его smoke.
6. Добавь поддерживаемый smoke в `tools/`, если появился постоянный риск регрессии.
7. Выполни `python tools/update_docs.py --write`, `--check` и полный strict-check.

## Новое приложение с сохраняемыми данными

Используй существующие «Промпты» или «Ссылки» как пример связывания слоёв: найди их через `find_owner.py`. Заимствуй нужный контракт, не копируй всё приложение и не создавай второй storage.

1. Зарегистрируй app-id и метаданные в `app/js/core/app-catalog.js`; найди обработку похожего app-id в `app.js`, открытие окна и renderer. Сохраняй общий механизм окон и маршрутизации.
2. Раздели предметную модель и UI у соответствующих владельцев по [FRONTEND_WORKFLOW.md](FRONTEND_WORKFLOW.md). Новые ресурсы подключи по рецептам core/CSS.
3. Проследи новое поле по [STATE_LIFECYCLE.md](STATE_LIFECYCLE.md): default → normalizer → migration → import validator → serializer → storage. Для данных рабочего стола проверь независимость столов, архив/удаление и восстановление по [DATA_MODEL.md](DATA_MODEL.md).
4. Свяжи действия с существующей очередью сохранения. Сообщение об успехе и публикация изменённого состояния должны соответствовать подтверждённой записи; при отказе сохрани черновик и возможность повтора. Повторно открытое окно и параллельное окно не должны возвращать устаревшие данные.
5. Добавь необходимые `scenarios`, `ui_contracts`, `state_lifecycle` в manifest по его текущей структуре. Постоянный JS smoke зарегистрируй в `tools/run_smokes.js`: отдельный файл сам по себе не включается в suite.
6. Обнови пользовательскую справку по [HELP_MAINTENANCE.md](HELP_MAINTENANCE.md), ручную карту и проверки. Выбери сценарии отказ → повтор и save → reload, импорт/экспорт и обычное/узкое окно по [TESTING.md](TESTING.md).

Новый PATCH, CHANGELOG и кэш оформляй один раз за завершённую задачу по [правилам версии](../README.md#версии-и-история-изменений), а не после каждого шага рецепта.

## Новый CSS-файл

1. Убедись, что область не помещается в существующий тематический файл.
2. Добавь `@import` в правильное место `app/css/style.css`.
3. Добавь файл в `ZETER_ASSETS` и CSS-таблицу `CODEMAP.md` в том же порядке.
4. Проверь cascade, обычное/узкое окно, длинный текст и scroll.
5. Выполни полный strict-check: он проверит точку входа, карту и PWA-кэш.

## State, migration, storage или import

1. Прочитай [DATA_MODEL.md](DATA_MODEL.md).
2. Найди default, normalizer, migration, validator и serializer поля.
3. Зафиксируй совместимость старого и нового состояния.
4. Используй искусственную фикстуру, а не реальные `data/`.
5. Проверь старый state → migrate → save → load и нужный import/export round-trip командой из [TESTING.md](TESTING.md).

## Python bridge

1. Прочитай [NATIVE_BRIDGE.md](NATIVE_BRIDGE.md).
2. Найди Python-метод и все `nativeStorageCall(...)` с его именем.
3. Сохрани envelope `{ ok, error }`, атомарную запись и диагностический лог. При изменении публичного метода синхронизируй таблицу `NATIVE_BRIDGE.md` и все JS-вызовы: checker сравнивает эти три стороны.
4. До import или создания API проверь effective paths и внешние действия по [TESTING.md](TESTING.md#безопасность-запуска-проверок). Затем проверь Python syntax, JavaScript-call, error-path и отдельно native/browser режимы.

## Быстрый поиск

```powershell
python tools/find_owner.py "имя сценария, функции, selector или state-пути"
python tools/find_owner.py get_system_metrics
python tools/find_owner.py DailyProblemLogs --json
rg -n "имяФункции|имяПоля" app/js/core app/js/app.js run_zeter_os.py
rg -n "ZETER_[A-Z0-9_]+" app/index.html app/js
rg -n "class-name|data-action" app/css app/js app/index.html
rg -n "nativeStorageCall|load_state|save_state" app/js run_zeter_os.py
```

В PowerShell передавай `rg` папку, а не glob `app/js/core/*.js`. Generated-блоки обновляй через `python tools/update_docs.py --write`.

Python-поиск использует `python_owners` в `tools/code_owners.json`: `path` — модуль, `anchors` — существующие определения верхнего уровня (класс раскрывается в публичные методы), `js`/`docs`/`smokes` — связанные файлы. Добавляй запись по ближайшему существующему примеру; checker проверяет файлы и определения через AST, не импортируя приложение. JS-связи здесь заданы вручную, их актуальность подтверждай реальными вызовами.

Если запрос ничего не нашёл, это не доказывает отсутствие реализации. Для Python API ищи `def имя` и `nativeStorageCall("имя"` в модуле и потребителях; затем дополни manifest у доказанного владельца. Для незарегистрированной внутренней функции используй `rg` в известном модуле. Не создавай новую реализацию только из-за пустого результата поиска.

## Не совмещать попутно

Не смешивай локальную функцию с массовым форматированием, state-schema, migration, bridge, cache-name, общим редизайном или несвязанным рефакторингом.
