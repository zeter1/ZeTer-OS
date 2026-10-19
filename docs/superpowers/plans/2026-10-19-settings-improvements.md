# Settings improvements Implementation Plan

> Execution: root + one isolated calendar writer; read-only specialists установили owners. Сохранять текущие незакоммиченные изменения. Без commit.

**Goal:** реализовать R01–R14 из согласованного списка, сохранив тёмную тему и пользовательские данные.

**Architecture:** существующие владельцы normalizers/renderers/controllers; один общий preferences writer для Пуска и Настроек. Composition root передаёт captured desktop и primary transaction, а не дублирует UI/domain logic.

**Tech Stack:** текущие vanilla JS/CSS, Node VM smokes, Python checker, isolated Playwright.

**Spec:** [требования](../specs/2026-10-19-settings-improvements.md).

## Global constraints

- Существующая dark theme, без новых зависимостей и изменения schema.
- Ровно один writer на файл; calendar files принадлежат calendar writer до terminal handoff.
- До запуска читать docs/TESTING.md; браузер — отдельный context/synthetic state/blocked external network и SW.
- Save ACK обязателен; ошибка удерживает draft, retry явный, неизвестные поля и чужие правки сохраняются.
- Один следующий PATCH и timestamped CHANGELOG-block после проверки результата.

## Review focus

- Поздний ACK не сбрасывает новое значение или фокус; разные desktop IDs не смешиваются.
- Reset не удаляет profile/custom assets/fs и не меняет Windows registry.
- Длинные подписи/150%/узкое окно/drag не перекрывают соседей и сохраняют доступный scroll.
- Restored windows и существующие окна не принимают правила размещения новых окон.
- Calendar dates/notification filtering/clock tray сохраняют прежние действия.

## Tasks

- [x] 1. Generic writer: новый `preferences-writer-utils.js`, adapter существующего `createStartPreferencesWriter`, unit RED→PASS для revisions/ACK/retry/object isolation. Подключения index/PWA/checker/owners.
- [x] 2. Defaults/normalizers: system-settings-utils, visual-utils; RED→PASS для legacy/invalid/unknown/roundtrip новых полей. Основные цвета и clock formatting — pure helpers у владельцев.
- [x] 3. Desktop: datasets до DOM measurement, scoped CSS labels; safe single/double activation. Проверки measured bounds, modifiers и drag guards.
- [x] 4. Window runtime: placement helpers + cache hooks; tests restore precedence, center/cascade/last close/reopen and narrow clamp.
- [x] 5. Calendar writer: Mon/Sun optional arguments/getter и старые defaults; RED→PASS calendar runtime. Root подключает getter/refresh.
- [x] 6. Settings controller: flattened allowlisted prefs/model/patch/reset/search; app adapter builds current snapshot in transaction, ACK publishes field patches, captured desktop. UI подписывается без уничтожения фокуса; async uploads/retry и scope notices.
- [x] 7. Settings view: search/results/deep links/status/reset confirmation/previews/new controls в существующем CSS owner. Browser failure→retry, rapid changes, reload, narrow320/390, large150%, calendar/clock/desktop/windows.
- [x] 8. Help/README/contracts/manifest/CODEMAP/generated docs + version/cache/CHANGELOG; independent verifier/reviewer и strict `0 warnings / 0 failures`, final task diff.

Результаты проверок сохраняются под `work/settings-improvements-qa/`. Независимый source review не заменяет browser/native evidence. Настоящие registry/pywebview/installed EXE остаются отдельной границей.

## Результат

Реализованы R01–R14, версия 4.0.61. Финальный strict: 158 ok, 0 warnings, 0 failures (`work/settings-improvements-qa/strict-final.log`); JS suite 53 files; расширенный Chromium UI PASS. Independent source/unit verifier подтвердил safe reset и сохранение draft/ACK. Известный review gap cleanup при смене стола исправлен и закреплён regression; поиск включает hotkeys и действия хранения. Два browser harness отказа были вызваны скрытой кнопкой календаря и оставшимся открытым меню Пуск; селекторы/закрытие меню исправлены, продуктовые asserts после этого пройдены. Дополнительный независимый adapter harness не получил общий PASS из-за неправильного fixture accent mint; корректные предшествующие asserts не подменяют общий результат. Настоящие pywebview/autorun/installed EXE и настоящий отказ IndexedDB для fallback не проверялись; fallback UI проверялся искусственным ACK.
