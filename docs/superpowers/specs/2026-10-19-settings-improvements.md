# Улучшения настроек

Пользователь согласовал весь предложенный список, кроме смены темы всей ZeTer OS. Тёмное оформление сохраняется; акцентный цвет меняет выделения и основные кнопки.

## Требования и проверка

| ID | Результат | Проверка |
|---|---|---|
| R01 | Поиск параметров с переходом и фокусом на поле | Русские запросы, синонимы, пустой результат, Escape, narrow |
| R02 | Область действия у карточек: стол / вся ОС / Windows | Windows autorun отдельно от restore/startup |
| R03 | Статус saving/saved/fallback/error и ручной retry | Held ACK A→B, error→retry, unrelated fields, desktop capture |
| R04 | Живые примеры подписи значка и текста/кнопок | Выбор меняет пример до ACK, ошибка явно остаётся несохранённой |
| R05 | Сброс только preference paths текущего раздела | Sentinel fs/profile/customWallpaper/unknown unchanged |
| R06 | Фокус/курсор сохраняются при обновлении | Tab/Shift+Tab, typing while pending, hotkey cancel |
| R07 | Пять акцентных цветов | Preview, ACK/reload, контраст основных кнопок |
| R08 | Размер подписи 10/12/14 px и строки все/1/2/3 | Старый default 12/unlimited, DOM bounds/collision/ghost |
| R09 | Масштаб 90–150% с шагом 10 | 150%, крупные контролы, narrow, keyboard |
| R10 | Открытие desktop icons single/double | Default double, modifiers/drag suppress, no duplicate open |
| R11 | Новые окна center/cascade/last per app | Existing focus и restored rect не меняются, close→reopen, clamp |
| R12 | Часы 12/24, секунды и дата | Midnight/noon, live apply, reload, tray/calendar |
| R13 | Popup 3.5/5/8/12 сек | Fake timers, только новые popup; quiet hours неизменны |
| R14 | Календарь Mon/Sun | 2026-11 month grid, week title/rows, сохранность ISO events |

## Данные и интерфейсы

- Новые поля совместимы со старыми состояниями; schema не повышается, unknown fields сохраняются.
- Desktop: существующий `settings.accent`; `desktopAppearance.labelSize`, `labelLines` (0 = все), `openMode`.
- Global: `windows.placement`, `windows.lastPositions`; `clock.format/showSeconds/showDate`; `calendar.weekStart`; `notifications.popupDuration`; дополнительные textScale.
- Общий revision-aware writer сохраняет только allowlisted patch, сериализует batches, удерживает свежий draft при старом ACK. Настройки используют primary transaction и публикуют только подтверждённые поля. Существующий writer Пуска становится адаптером того же алгоритма.
- Сессия настроек привязана к desktop ID, переживает смену раздела/перерисовку. Async upload захватывает адрес стола до ожидания.
- Сброс не удаляет файлы, профиль, загруженные обои, неизвестные поля, историю или Windows autorun. Windows autorun остаётся отдельным явным действием.
- Week-start относится к календарю; статистическая неделя Учёта времени не меняется.
- Последнее положение окна хранит только геометрию по app ID, не пользовательские документы.

## Границы

Root — единственный writer общих настроек/UI/state/adapters/docs. Calendar writer владеет только двумя calendar core и calendar smoke. Установка EXE, запуск на реальных data, commit и публикация не входят в задачу.
