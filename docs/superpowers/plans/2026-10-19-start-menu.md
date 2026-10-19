# Меню Пуск — принятый объём и проверка

Цель: выполнить согласованный в чате редизайн меню с отдельной постоянно доступной кнопкой «Настройки», открывающей параметры самого Пуска.

Работа идёт в текущей рабочей копии с сохранением прежних изменений, без commit/push, установки или публикации. UI имеет одного writer; root интегрирует существующие поиск/storage/workspace adapters. Отдельный verifier проверяет корректность.

| Требование | Владелец и проверка |
|---|---|
| R01: высота по содержимому, две колонки/узкое окно | start-ui-utils.js, 10-shell.css, Start-правила 40-app-foundation.css, index.html; browser rect и снимки |
| R02: закрепления, мышь/клавиатура, одинаковая геометрия | start-ui-utils.js; pinOrder, drag и Alt+стрелки, reload |
| R03: каталог по алфавиту и категориям | существующий start owner; browser каталог/фильтр |
| R04: общий поиск, стрелки/Enter | search-ui-utils.js + adapters app.js; shared engine без влияния фильтров другого окна |
| R05: карточки столов, текущий стол, ⋯ | start owner; существующее удаление с backup/диалогом сохраняется; rename/settings adapters |
| R06: недавние документы и очистка | app.js; ссылки на документы, безопасное переключение стола, без удаления файлов |
| R07: быстрые действия | start owner и существующие createItem/taskedit/folder adapters |
| R08: встроенные настройки, предпросмотр, сохранение/отказ | system-settings normalizer; primary transaction snapshot→ACK→publication; browser refusal/retry/reload |
| R09: справка, версия/cache и документация | existing canonical owners, update_docs generator и strict-check |

Порядок: чистая VM-проверка настроек (RED→GREEN) → UI и adapters → изолированный browser → независимая проверка → точечные исправления → generated docs/strict-check/diff.

Схема данных и OS_VERSION_NUMBER сохраняются. Параметры глобальны в systemSettings.startMenu; неизвестные поля сохраняются. Windows/EXE/native и размещённый uCoz остаются отдельными границами проверки.
