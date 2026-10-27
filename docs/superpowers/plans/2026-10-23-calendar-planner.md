# Calendar Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать утверждённую полную переделку календаря, сохранив существующие данные и подтверждённое сохранение.

**Architecture:** Расширить текущие calendar model/UI owners. app.js остаётся adapter для workspace, primary queue, задач и таймера. Один владелец каждого файла; независимые model/UI lanes работают по общему контракту, parent интегрирует и обновляет docs.

**Tech Stack:** Vanilla JavaScript, существующий CSS, Python tooling; без новых зависимостей.

**Spec:** ../specs/2026-10-23-calendar-planner-design.md

## Global Constraints

- Сохранять dirty baseline, ID, unknown fields, отдельность рабочих столов и запрет новых событий на прошлую дату.
- Только синтетическое состояние и существующая primary queue; не запускать приложение с настоящими data/.
- Нет новых dependencies/services/trash, commits/push/deploy/EXE build без запроса.
- Текущий workspace выбран для сохранения незакоммиченной рабочей базы; imported branch/approval/model правила адаптированы по SYSTEM_WORKFLOW.
- Models наследуются; изменения готовой правки возвращаются тому же writer.

## Review Focus

- Событие из предыдущего дня/серии остаётся видимым в диапазоне; 00:00 и конец суток не теряются.
- Цепочки пересечений не перекрывают карточки; фильтр не выдаёт скрытую занятость за свободное время.
- Stale editor и отказ split/delete не меняют ни исходную серию, ни соседние данные.
- Удалённая/перенесённая задача не запускает чужой таймер; calendar task binding remap в backup сохраняет источник.
- Старые consumers/экспорт/напоминания не обходят repeatUntil/excludedDates и расширенную длительность.

## Interfaces

Model: calendarOccurrences(events, fromISO, toISO, {limit}) возвращает bounded фактические вхождения, включая пересекающие границы. id/eventId — исходный ID, occurrenceDate/occurrenceKey — идентичность вхождения; date/endDate — фактические даты. calendarEventsForDate использует ту же модель.

calendarDayLayout(occurrences, iso, {workStart, workEnd}) возвращает segments [{event,startMinute,endMinute,lane,lanes,continuesBefore,continuesAfter}], allDay, busyMinutes, freeSlots [{start,end}], conflicts [{start,end,ids}]. Минуты 0..1440.

Controller: сохранить saveEvent(draft,id,original,options), удалить removeEvent(id,options,original). options={scope:'all'|'one'|'future',occurrenceDate}; default all обратно совместим. Несколько изменённых записей публикуются только после ACK.

UI integrations: getTasks/getTaskProjects, getCalendarPreferences/saveCalendarPreferences, saveEventRecord, removeEvent, openTask, startEventTimer, openEventEditor. Все callbacks привязаны к исходному workspace. Неявные необязательные callbacks безопасны для legacy fixtures.

## Tasks / ledger

- [x] Model writer: calendar-utils, data-normalizers, state-import-validator; planner/persistence synthetic tests. R02/R03/R06/R08/R09.
- [x] UI writer: calendar-ui-utils, календарная часть CSS 60, runtime smoke + новый browser planner smoke. R01–R07/R09/R11/R12.
- [x] Parent integration: app.js, reminders/export, restore binding, preferences, task/timer callbacks; integration synthetic checks. R05/R07/R08/R09/R11/R12.
- [x] Parent docs/resources: help, README, DATA_MODEL/TESTING/CODEMAP/manifest, версия/PWA; генерация индексов/manifest. R10.
- [x] Независимая проверка текущих исходников, material-risk review и профильные браузерные проверки; полный strict-check, diff scope.

## Evidence / resume

READ baseline: версия 4.0.78; git main dirty, calendar already modified before task. Прототип из прошлого хода находится вне project app и не является реализацией. Пользовательские data/settings/env не читаются. Новые VM smoke не выполняют app startup. Browser запускается отдельным context с synthetic API/primary queue, блокировкой внешней сети и service worker.

2026-10-23: task accepted; calendar_contracts READ_ONLY, calendar_model WRITE rev2 (кроме runtime UI smoke); UI lane pending. Parent owns all remaining integrations/docs/resources. Команды и результаты дополняются после выполнения; список требований не доказывает PASS.

Scope update: user R11 custom categories. Model rev3, UI rev2, integration rev2; parent workspace.calendarCategories persistence/defaults + category ACK adapter. Category IDs calcat_ + safe suffix, max100, trimmed name1..80, validated HEX color; legacy category IDs retained. Создание/rename/color без удаления.

2026-10-23: user pause/resume. Работа сохранена; попытка записать checkpoint во время паузы не исполнилась из-за usage limit auto-review, никаких обходов не было. User явно возобновил задачу. Модель rev5 и интеграции rev5 реализованы. Independent review закрыл category-restore/ICS findings. Test verifier phase1 PASS: VM/AST + production callback distinguishing checks timer missingtask/crossworkspace/refusal и native partialimportretry. Unit suite66PASS. UI rev4 исправляет найденные browser failure stages: focus BODY после mount (microtask connected focus), dblclick target replaced (preserve same-month cells), category ownwindow remount (drawself/refreshexclude), resize status row shifts trackTop23px without scroll (snapshot minute+pointerdelta). First FAIL и diagnostics сохранены отдельно в work/calendar-planner-qa/{planner,keyboard-diagnostic,resumed-ui,all-cases,resize-diagnostic,resize-stage}; full current browser final pending после R01capacity. Версия пока4.0.78; CHANGELOG/web-release/full strict не завершены. Не объявлять готовность до final checks.

## Completion evidence — 2026-10-23

Приведённая выше запись resume — исторический checkpoint, заменён следующим результатом. Версия4.0.79, cache согласован, generated docs/current web manifest проверены (build4faa1efdaa670416192022f502848c56f41e275af1c200d1b1b7f604877073c0). Все R01–R12 реализованы. Один CHANGELOG-блок фиксирует задачу. Ранние snapshot-копии work/calendar-redesign-baseline были сняты во время начала работы writers и не являются полной границей до всех первых model-изменений; не использовать их для автоматического rollback чужой dirty базы.

UI: work/calendar-planner-qa/accepted/planner/results.json — 12PASS; persistence/results.json — 8PASS, zero pageErrors. Independent verifier подтвердил совпадение всех fingerprints с current source. Просмотрены реальные month/week/editor screenshots wide/narrow. Исправления подтверждены distinguishing evidence, включая resize +23px status shift и named container queries для видимости времени. Финальный browser прогон после этих правок полностью PASS.

Canonical command .\check_project.cmd --strict-node --no-pause: первый sandbox run166OK/0warnings/2FAIL (junction fixtures document/updater, updater Access denied), источник unchanged; разрешённый parent run — **168OK/0warnings/0failures**, exit0. Лог work/calendar-planner-qa/strict-authorized.log. Первый результат сохранён отдельно в task visualization calendar-final-verification/strict-first.log. Ни приложение с пользовательским state, ни публикация, ни EXE build не запускались.

NOT_VERIFIED: реальные native upload/open/диалоги, установленный EXE, импорт ICS сторонним календарём, сайт. Ручной путь: собственная категория → событие через полночь с описанием/файлом → сохранить/открыть файл → запустить связанный таймер → повторно открыть; при FAIL нужны версия/размер окна/шаги и видимое сообщение без личного содержимого. Код не закоммичен и не опубликован.
