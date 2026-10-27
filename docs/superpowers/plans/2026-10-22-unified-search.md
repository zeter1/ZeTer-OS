# Единый поиск ZeTer OS

Пользователь одобрил предложение целиком и улучшение дизайна. Рабочая база содержит прежние незакоммиченные изменения; используем текущий checkout без отката и коммитов.

## Приёмка

- R01: материалы текущего/всех активных столов: файлы, задачи, события, приложения, проекты, ссылки, промпты, занятия. Архивные столы и удалённые материалы исключены.
- R02: лучшее совпадение, группы и количество; видимая причина совпадения, предпросмотр plain text без исполнения содержимого.
- R03: область текущий/все, тип, проект, даты; возврат из пустой выдачи. По умолчанию текущий стол.
- R04: исправление раскладки/ограниченных опечаток явно помечено; точные результаты выше. Пользовательский запрос не заменяется незаметно.
- R05: открыть/показать в папке/копировать/выполнить задачу через действующих владельцев, обработка отказа записи; никаких вложенных кнопок.
- R06: локальная ограниченная история запросов и недавно открытых материалов, очистка; query/index без внешней сети.
- R07: локальный индекс нормализует текст при изменениях источника, а не на каждую букву; проверить update/delete/rename/transaction после ACK.
- R08: единое оформление поиска сверху/снизу/в отдельном окне, Пуск совместим. Клавиатура, контраст, 1440/760/390/320 px, низкое окно, длинные тексты.

## Интерфейсы и владельцы

1. Data writer: только `search-utils.js` и `tools/smoke_search_index.js`. Существующие API сохраняются. Новые `buildSearchDocuments(options)` и `createSearchIndex()` (`update(documents)`, `search(query, options)`, `getStats()`). Параметры коллектора: apps, fs, stores `{desktopId,title,data}`, commands, builderOptions существующего поиска. `search` возвращает `{results,total,counts,suggestion,query}`. Options: filters, scope current/all, currentDesktopId, projectId, dateFrom/dateTo (ISO), limit, now. Документ сохраняет прежний result shape плюс key/text/previewText/path/desktopName/projectName/updatedAt/date. Возвращаемые результаты имеют matchReason/matchType. Kind: item/task/calendar/app/command/project/link/prompt/time; categories расширяются projects/links/prompts/time.
2. UI writer: только `search-ui-utils.js`, поисковая область `10-shell.css`, новые UI unit tests при необходимости. Controller получает `getDesktopStores()`, `getRevision()`, `runResultAction(result, action)` от parent; открытие старых результатов через прежний navigator, новые виды через callback navigator `openExtendedResult`. Grouped preview layout только в global/app, Пуск использует совместимый compact list renderer. Действия preview вызываются по ключу документа, содержимое escaped. Scope/history/recent — optional fields searchSettings; максимум 12 запросов/12 refs, без копирования содержания документов.
3. Parent: `app.js`, точные переходы в `prompt-library-ui-utils.js`/`time-tracking-ui-utils.js`, интеграционные browser tests, docs/версия/manifest. Parent единственный writer этих файлов. Индекс инвалидируется ревизией общих сохранений, завершённых transactions и замены state; при переходе/открытии проверяет актуальность. Сохранение history не должно менять материал.
4. Independent verifier/reviewer: read-only после стабильной реализации; обнаруженные дефекты возвращаются исходному writer.

## Последовательность

1. Зафиксировать контракт, regression fixtures и исходные FAIL новых API.
2. Параллельно реализовать data engine и UI по согласованным API; parent изучает и подключает штатные действия.
3. Интегрировать и проверить реальные browser пути на synthetic state: все типы, cross-desktop, correction, filters, preview/actions, history/reload, stale/delete/save failure.
4. Исправить воспроизведённые дефекты у исходного владельца. Независимая проверка.
5. Обновить справку/README/DATA_MODEL/CODEMAP/manifest, PATCH и один CHANGELOG timestamp block; generated docs и web manifest.
6. Проверить node syntax/suite, строгий checker (junction fixtures требуют разрешённой среды), diff/status. Native/EXE/production оставить NOT_VERIFIED.

Решения реализации обратимы. Результаты проверки и ограничения фиксируются в финале и owning docs, артефакты — в игнорируемой `work/search-upgrade-qa/`.

## Закрытие реализации

Коллектор/индекс и UI реализованы отдельными владельцами; parent подключил безопасные действия и точные переходы. Ревизия общих сохранений/всех primary transaction adapters инвалидирует индекс. `search(options.keys)` разрешает recent до pagination; marker `filtersVersion:2` отделяет миграцию старого набора от runtime выбора. После ожидания записи открытия проекта повторно проверяется стол и identity. Первоначальные browser FAIL и исправления хранятся в QA-папке; текущая матрица содержит 26 сценариев. Native/EXE/production не входят в этот проход.
