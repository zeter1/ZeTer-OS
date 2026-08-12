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
4. Добавь его в `ZETER_ASSETS` и `REQUIRED_SCRIPT_ORDER`.
5. Добавь ручную строку core-таблицы `CODEMAP.md`.
6. Добавь поддерживаемый smoke в `tools/`, если появился постоянный риск регрессии.
7. Выполни `python tools/update_docs.py --write`, `--check` и полный strict-check.

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
3. Сохрани envelope `{ ok, error }`, атомарную запись и диагностический лог.
4. Проверь `py_compile`, JavaScript-call, error-path и отдельно native/browser режимы.

## Быстрый поиск

```powershell
python tools/find_owner.py "имя сценария, функции, selector или state-пути"
rg -n "имяФункции|имяПоля" app/js/core app/js/app.js run_zeter_os.py
rg -n "ZETER_[A-Z0-9_]+" app/index.html app/js
rg -n "class-name|data-action" app/css app/js app/index.html
rg -n "nativeStorageCall|load_state|save_state" app/js run_zeter_os.py
```

В PowerShell передавай `rg` папку, а не glob `app/js/core/*.js`. Generated-блоки обновляй через `python tools/update_docs.py --write`.

## Не совмещать попутно

Не смешивай локальную функцию с массовым форматированием, state-schema, migration, bridge, cache-name, общим редизайном или несвязанным рефакторингом.
