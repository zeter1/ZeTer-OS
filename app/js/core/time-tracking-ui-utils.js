(() => {
  "use strict";
  const { escapeHtml: e } = window.ZETER_CORE_UTILS;
  const { sessionDuration, timeInRange, localRanges, formatTimeDuration: duration, isTimeEntryDeleted, timeFilterRange,
    selectTimeEntries, summarizeTimeRows, timeWeekBuckets, timeReportRows } = window.ZETER_TIME_TRACKING_UTILS;
  const pad = n => String(n).padStart(2, "0");
  function localDateInput(at, time = true) {
    const date = new Date(at), day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return time ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` : day;
  }
  const dateLabel = at => new Date(at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const timeTaskChoices = (workspace, projectId) => (workspace.tasks || []).filter(task => task.projectId === projectId);
  function timeEntryTiming(entry) {
    const start = new Date(entry.createdAt), end = new Date(entry.finishedAt), workMs = sessionDuration(entry);
    const date = value => value.toLocaleDateString("ru-RU");
    const time = value => value.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    return { workMs, pauseMs: Math.max(0, entry.finishedAt - entry.createdAt - workMs),
      dateText: date(start) === date(end) ? date(start) : `${date(start)} — ${date(end)}`,
      periodText: `${time(start)} — ${time(end)}` };
  }
  function timePlanDraft(value, workspace, now = Date.now()) {
    const task = workspace.tasks?.find(task => task.id === value.taskId), project = workspace.taskProjects?.find(project => project.id === (task?.projectId || value.projectId));
    const start = Number.isFinite(value.startedAt) ? value.startedAt : now + 3600000;
    const minutes = Number.isFinite(value.durationMs) && value.durationMs > 0 ? value.durationMs : 1800000;
    const end = start + minutes;
    const sameDay = localDateInput(start, false) === localDateInput(end, false);
    return { title: value.title || task?.title || "", date: localDateInput(start, false), start: localDateInput(start).slice(11, 16), end: sameDay ? localDateInput(end).slice(11, 16) : "", sourceEnd: sameDay ? "" : localDateInput(end),
      description: [project ? `Проект: ${project.name}` : "", task ? `Задача: ${task.title}` : "", value.notes || ""].filter(Boolean).join("\n"),
      category: "work", repeat: "none", reminder: "0", location: "" };
  }
  function createTimeTrackingApp(params = {}, options = {}) {
    const doc = options.documentRef || document, view = doc.defaultView || window, controller = options.controller;
    const root = doc.createElement("div"); root.className = "time-tracking-app";
    const dialogId = `time-dialog-${Math.random().toString(36).slice(2)}`;
    let busy = false, message = "", error = false, editor = null, journalLimit = 30, base = null;
    let recoveryEnd = "", restoreFocus = null, transferredManualDraft = null;
    const pendingTrash = new Map(), trashFailures = new Map();
    const draft = { taskId: params.taskId || "", projectId: "", title: "", notes: "" };
    const filters = { period: "week", query: "", project: "all", fromDate: localDateInput(localRanges().weekStart, false), toDate: localDateInput(Date.now(), false), deleted: false, grouping: "projects" };
    const field = name => root.querySelector(`[name="${name}"]`);
    const workspace = () => options.getWorkspace?.() || {};
    if (draft.taskId) draft.projectId = workspace().tasks?.find(task => task.id === draft.taskId)?.projectId || "";
    function capture() {
      for (const key of ["title", "taskId", "projectId", "notes"]) if (field(key)) draft[key] = field(key).value;
      if (editor) {
        for (const name of ["editTitle", "editNotes", "editTaskId", "editProjectId", "editStart", "editMinutes", "goalMinutes", "createName", "createProjectId"]) if (field(name)) editor[name] = field(name).value;
        if (field("correctTime")) editor.correctTime = field("correctTime").checked;
        if (field("allowOverlap")) editor.allowOverlap = field("allowOverlap").checked;
        if (field("confirmPurge")) editor.confirmPurge = field("confirmPurge").checked;
      }
      if (field("recoveryEnd")) recoveryEnd = field("recoveryEnd").value;
    }
    function focusSnapshot() {
      const node = doc.activeElement;
      return node && root.contains(node) ? { name: node.name, action: node.dataset?.timeAction, id: node.dataset?.timeId, start: node.selectionStart, end: node.selectionEnd } : null;
    }
    function focusBack(snapshot) {
      const found = snapshot?.name ? field(snapshot.name) : snapshot?.action ? [...root.querySelectorAll("[data-time-action]")].find(node => node.dataset.timeAction === snapshot.action && node.dataset.timeId === snapshot.id) : null;
      const node = found || (snapshot ? root.querySelector('[data-time-action="pause"],[data-time-action="resume"],[name="title"]') : null);
      if (!node || node.disabled) return;
      node.focus({ preventScroll: true });
      if (["text", "search", "textarea"].includes(node.type) && snapshot.start !== null && snapshot.start !== undefined) node.setSelectionRange(snapshot.start, snapshot.end);
    }
    function showStatus(text, failed = false) {
      message = text; error = failed;
      const node = root.querySelector("[data-time-status]");
      if (node) { node.textContent = text; node.classList.toggle("error", failed); }
    }
    function disableControls() { root.querySelectorAll("button,input,select,textarea").forEach(node => { node.disabled = true; }); }
    async function commit(operation, success, accepted = () => {}, change = null) {
      if (busy) return;
      capture(); const focused = focusSnapshot(); busy = true; disableControls(); showStatus("Сохраняем…");
      try { const result = await operation(); accepted(result); showStatus(success); options.onChange?.(change); }
      catch (failure) { showStatus(failure.message || "Не удалось сохранить. Повторите действие.", true); }
      finally { busy = false; render(focused); }
    }
    function pendingTrashHTML(item) {
      return `<article class="time-entry time-entry-pending" data-time-row="${e(item.id)}" data-time-pending-id="${e(item.id)}" aria-busy="true"><strong>${e(item.title)}</strong><p role="status">Перемещаем в корзину… После сохранения запись появится в корзине.</p><progress aria-label="Сохранение перемещения"></progress></article>`;
    }
    function refreshEntryViews() {
      if (busy) return; // The other commit will render the accepted state when it finishes.
      const region = root.querySelector("[data-time-results]"), focused = region?.contains(doc.activeElement) ? focusSnapshot() : null;
      const tracking = controller.read();
      updateBase(tracking); refreshJournal(tracking); updateLive();
      const tab = root.querySelector('[data-time-action="trash"]');
      if (tab) tab.textContent = `Корзина · ${tracking.entries.filter(isTimeEntryDeleted).length}`;
      const clear = root.querySelector('[data-time-action="purge-all"]');
      if (clear) clear.disabled = !tracking.entries.some(isTimeEntryDeleted);
      if (focused) focusBack(focused);
    }
    async function moveToTrash(item) {
      if (busy || pendingTrash.has(item.id)) return;
      pendingTrash.set(item.id, item); trashFailures.delete(item.id);
      const card = [...root.querySelectorAll("[data-time-row]")].find(node => node.dataset.timeRow === item.id);
      if (card) {
        const hadFocus = card.contains(doc.activeElement);
        card.outerHTML = pendingTrashHTML(item);
        if (hadFocus) (root.querySelector('[data-time-action="delete"]') || root.querySelector('[data-time-action="trash"]'))?.focus({ preventScroll: true });
      }
      showStatus(`Перемещаем в корзину: ${pendingTrash.size}…`);
      let accepted = false;
      try { await controller.removeEntry(item.id); accepted = true; }
      catch (failure) { trashFailures.set(item.id, failure.message || "Не удалось сохранить перемещение."); }
      pendingTrash.delete(item.id);
      refreshEntryViews();
      if (trashFailures.size) showStatus(`Не удалось перенести ${trashFailures.size} записей: ${[...trashFailures.values()].join("; ")}. Проверьте оставшиеся карточки в журнале.`, true);
      else showStatus(pendingTrash.size ? `Запись перемещена в корзину. Ещё сохраняются: ${pendingTrash.size}…` : "Запись перемещена в корзину");
      if (accepted) {
        try { options.onChange?.(); }
        catch (failure) { showStatus(`Запись уже в корзине. Не удалось обновить другие окна: ${failure.message || "неизвестная ошибка"}.`, true); }
      }
    }
    function choices(kind, value, previous = null, projectId = "") {
      const items = kind === "task" ? timeTaskChoices(workspace(), projectId) : workspace().taskProjects || [];
      return `<option value="">${kind === "task" ? "Без задачи — просто записать занятие" : "Без проекта"}</option>${value && !items.some(item => item.id === value) ? `<option value="${e(value)}" selected>${e(kind === "task" ? "Прежняя задача (недоступна)" : previous?.projectName || "Прежний проект (удалён)")}</option>` : ""}${items.map(item => `<option value="${e(item.id)}"${item.id === value ? " selected" : ""}>${e(kind === "task" ? item.title : item.name)}</option>`).join("")}`;
    }
    function bindingHTML(value, editing = false) {
      const project = editing ? "editProjectId" : "projectId", task = editing ? "editTaskId" : "taskId";
      const projectId = editing ? value.editProjectId : value.projectId, taskId = editing ? value.editTaskId : value.taskId;
      return `<div class="time-form-pair time-binding"><label>Проект · необязательно<select class="app-input" name="${project}">${choices("project", projectId, value.expected)}</select></label><div class="time-task-picker"><label>Задача в проекте · необязательно<select class="app-input" name="${task}"${!projectId && !taskId ? " disabled" : ""}>${choices("task", taskId, value.expected, projectId)}</select></label>${!editing ? `<button class="app-btn" type="button" data-time-action="task"${projectId ? ' title="Добавить задачу в выбранный проект"' : ' disabled title="Сначала выберите проект"'}>＋ Добавить задачу в проект</button>` : ""}</div></div><p class="time-hint time-binding-hint">${projectId ? timeTaskChoices(workspace(), projectId).length ? "Выберите задачу проекта или оставьте занятие без задачи." : "В этом проекте пока нет задач. Можно записать занятие без задачи или создать её кнопкой «Добавить задачу в проект» под списком." : "Можно начать без проекта и задачи. Чтобы добавить задачу в проект, сначала выберите проект. Пример: проект «Сайт» → задача «Главная страница»."}</p>`;
    }
    function startHTML(tracking) {
      const active = tracking.active, recovery = controller.needsRecovery(active);
      const recent = [], seen = new Set();
      for (const item of tracking.entries.slice().sort((a, b) => b.finishedAt - a.finishedAt)) {
        const key = `${item.taskId}\n${item.projectId}\n${item.title}`;
        if (isTimeEntryDeleted(item) || seen.has(key)) continue;
        seen.add(key); recent.push(item); if (recent.length === 3) break;
      }
      return `<section class="time-timer-card${active && !recovery && active.runningSince !== null ? " running" : ""}" aria-label="Таймер занятия">
        <div class="time-timer-head"><span class="time-state">${recovery ? "Нужно уточнить время" : active ? active.runningSince === null ? "На паузе" : "Идёт отсчёт" : "Новое занятие"}</span><output data-time-clock aria-live="off" aria-label="Длительность занятия">00:00:00</output></div>
        ${active ? `<h2>${e(active.title)}</h2><p class="time-active-meta">${e(active.projectName || "Без проекта")} · с ${e(dateLabel(active.createdAt))}</p>${active.notes ? `<p class="time-active-notes">${e(active.notes)}</p>` : ""}
          ${recovery ? `<form data-time-recovery><p class="time-recovery-note">Таймер остался включённым перед перезапуском. Укажите окончание работы. Неподтверждённое время пока исключено из итогов.</p><label>Работа закончилась<input class="app-input" name="recoveryEnd" type="datetime-local" step="1" value="${e(recoveryEnd || localDateInput(Date.now()))}" required></label><div class="time-actions"><button class="app-btn primary" type="submit" value="finish">Подтвердить и завершить</button><button class="app-btn" type="submit" value="resume">Подтвердить и продолжить сейчас</button></div></form>` : `<div class="time-actions"><button class="app-btn" type="button" data-time-action="${active.runningSince === null ? "resume" : "pause"}">${active.runningSince === null ? "▶ Продолжить" : "Ⅱ Пауза"}</button><button class="app-btn primary" type="button" data-time-action="finish">✓ Завершить</button><button class="app-btn" type="button" data-time-action="edit-active" data-time-id="${e(active.id)}">Описание</button></div><p class="time-hint">Окно можно закрыть — отсчёт продолжится. Паузы не учитываются.</p>`}` : `<form data-time-start><p class="time-hint">Работаете сейчас? Выберите занятие и запустите таймер.</p>${bindingHTML(draft)}<div class="time-start-grid"><label>Что делаем?<input class="app-input" name="title" maxlength="500" value="${e(draft.title)}" placeholder="Например, разработка сайта"${draft.taskId ? "" : " required"}></label>${draft.taskId ? `<p class="time-hint">Название можно оставить пустым — возьмём его из задачи.</p>` : ""}</div><details class="time-note-input"${draft.notes ? " open" : ""}><summary>Заметка к занятию</summary><label><span class="time-sr-only">Заметка к занятию</span><textarea class="app-input" name="notes" maxlength="5000" rows="2" placeholder="Что планируете сделать?">${e(draft.notes)}</textarea></label></details><button class="app-btn primary time-start-button" type="submit">▶ Начать работу</button></form>
          ${recent.length ? `<div class="time-recent"><span>Повторить недавнее</span>${recent.map(item => `<button class="app-btn" type="button" data-time-action="repeat" data-time-id="${e(item.id)}" title="Начать заново: ${e(item.title)}">↻ ${e(item.title)}</button>`).join("")}</div>` : ""}`}</section>`;
    }
    function overviewHTML(tracking) {
      return `<aside class="time-overview" aria-label="Обзор всего рабочего стола"><div class="time-overview-title"><span>Весь рабочий стол</span><button class="app-btn" type="button" data-time-action="goal">${tracking.dailyGoalMinutes ? "Изменить цель" : "Задать цель"}</button></div><div class="time-stats"><div><span>Сегодня</span><strong data-time-today>00:00:00</strong></div><div><span>Эта неделя</span><strong data-time-week>00:00:00</strong></div></div><div class="time-goal"><progress data-time-goal max="1" value="0" aria-label="Дневная цель"></progress><span data-time-goal-label></span></div><div class="time-week-chart" aria-label="Время по дням текущей недели">${base.buckets.map((bucket, index) => `<button type="button" class="time-day${localDateInput(bucket.start, false) === localDateInput(Date.now(), false) ? " today" : ""}" data-time-day="${localDateInput(bucket.start, false)}"><span class="time-day-value" data-time-day-value="${index}">0:00</span><span class="time-bar-track"><i data-time-bar="${index}"></i></span><span>${e(new Date(bucket.start).toLocaleDateString("ru-RU", { weekday: "short" }))}</span></button>`).join("")}</div><p class="time-hint">С понедельника · нажмите день, чтобы увидеть записи.<br><span data-time-live-note></span></p></aside>`;
    }
    function journalFilter() {
      return { ...timeFilterRange(filters.period, Date.now(), filters.fromDate, filters.toDate), query: filters.query,
        projectId: filters.project === "all" ? null : filters.project === "none" ? "" : filters.project.slice(3), deleted: filters.deleted };
    }
    function projectChoices(tracking) {
      const projects = new Map();
      for (const item of [...(workspace().taskProjects || []).map(project => ({ projectId: project.id, projectName: project.name })), ...tracking.entries]) if (item.projectId) projects.set(item.projectId, item.projectName || "Проект без названия");
      return `<option value="all"${filters.project === "all" ? " selected" : ""}>Все проекты</option><option value="none"${filters.project === "none" ? " selected" : ""}>Без проекта</option>${[...projects].map(([id, name]) => `<option value="id:${e(id)}"${filters.project === `id:${id}` ? " selected" : ""}>${e(name)}</option>`).join("")}`;
    }
    function journalHTML(tracking) {
      return `<section class="time-history" aria-label="Журнал времени"><header class="time-history-heading"><div class="time-tabs"><button class="app-btn" type="button" data-time-action="journal" aria-pressed="${!filters.deleted}">Журнал</button><button class="app-btn" type="button" data-time-action="trash" aria-pressed="${filters.deleted}">Корзина · ${tracking.entries.filter(isTimeEntryDeleted).length}</button></div><div class="time-heading-actions"><button class="app-btn" type="button" data-time-action="reset-filters">Сбросить фильтры</button></div></header><div class="time-filters"><label>Найти занятие<input class="app-input" type="search" name="query" value="${e(filters.query)}" placeholder="Название, проект или заметка"></label><label>Период<select class="app-input" name="period">${[["today", "Сегодня"], ["yesterday", "Вчера"], ["week", "Эта неделя"], ["month", "Этот месяц"], ["all", "Всё время"], ["custom", "Выбрать даты"]].map(([value, label]) => `<option value="${value}"${filters.period === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Проект<select class="app-input" name="filterProject">${projectChoices(tracking)}</select></label></div>${filters.period === "custom" ? `<div class="time-date-range"><label>С даты<input class="app-input" type="date" name="fromDate" value="${e(filters.fromDate)}"></label><label>По дату включительно<input class="app-input" type="date" name="toDate" value="${e(filters.toDate)}"></label></div>` : ""}<div class="time-results-toolbar"><span data-time-results-count></span>${filters.deleted ? `<button class="app-btn time-danger" type="button" data-time-action="purge-all"${tracking.entries.some(isTimeEntryDeleted) ? "" : " disabled"}>Очистить корзину</button>` : ""}<label>Группировка<select class="app-input" name="grouping"><option value="projects"${filters.grouping === "projects" ? " selected" : ""}>По проектам</option><option value="tasks"${filters.grouping === "tasks" ? " selected" : ""}>По задачам и занятиям</option></select></label><button class="app-btn" type="button" data-time-action="export"${filters.deleted ? " disabled" : ""}>↓ CSV выбранных записей</button></div><div data-time-results></div></section>`;
    }
    function refreshJournal(tracking = controller.read()) {
      const region = root.querySelector("[data-time-results]"); if (!region) return;
      const exportButton = root.querySelector('[data-time-action="export"]');
      let rows;
      try { rows = selectTimeEntries(tracking, journalFilter()); }
      catch (failure) { region.innerHTML = `<p class="time-filter-error" role="alert">${e(failure.message)}</p>`; root.querySelector("[data-time-results-count]").textContent = "Проверьте период"; if (exportButton) exportButton.disabled = true; return; }
      const summary = summarizeTimeRows(rows, filters.grouping), visible = rows.slice(0, journalLimit);
      root.querySelector("[data-time-results-count]").textContent = `${rows.length} записей · ${duration(summary.totalMs)} за период${filters.deleted ? " · исключено из итогов" : ""}`;
      if (exportButton) exportButton.disabled = busy || filters.deleted || !rows.length;
      let day = "";
      const entries = visible.map(row => {
        if (pendingTrash.has(row.entry.id)) return pendingTrashHTML(row.entry);
        const item = row.entry, timing = timeEntryTiming(item), task = workspace().tasks?.find(task => task.id === item.taskId), key = localDateInput(item.createdAt, false), heading = day === key ? "" : `<h3 class="time-entry-day">${e(new Date(item.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" }))}</h3>`; day = key;
        return `${heading}<article class="time-entry" data-time-row="${e(item.id)}"><div class="time-entry-description"><span class="time-entry-kind">Занятие</span><strong>${e(item.title)}</strong><small class="time-entry-context">Проект: ${e(item.projectName || "не выбран")}<br>${item.taskId ? `Задача в проекте: ${e(task?.title || "удалена или недоступна")}` : "Задача: не выбрана"}</small><small>Дата выполнения: ${e(timing.dateText)}</small><small>Промежуток: ${e(timing.periodText)}${timing.pauseMs > 0 ? " (включая паузы)" : ""}</small><small>${timing.pauseMs > 0 ? `Паузы: ${duration(timing.pauseMs)} · не входят во время работы` : "Без пауз"}${item.manual ? " · добавлено вручную" : ""}</small>${!filters.deleted && trashFailures.has(item.id) ? `<p class="time-row-error" role="alert">Не удалось переместить: ${e(trashFailures.get(item.id))}. Запись осталась в журнале; можно повторить.</p>` : ""}${item.notes ? `<details class="time-entry-notes"><summary>Заметка</summary><p>${e(item.notes)}</p></details>` : ""}</div><div class="time-entry-duration"><small>Время работы без пауз</small><b>${duration(timing.workMs)}</b>${row.durationMs !== row.fullDurationMs ? `<small>В выбранном периоде:<br>${duration(row.durationMs)}</small>` : ""}</div><div class="time-entry-actions">${filters.deleted ? `<button class="app-btn" type="button" data-time-action="restore" data-time-id="${e(item.id)}">Восстановить</button><button class="app-btn time-danger" type="button" data-time-action="purge" data-time-id="${e(item.id)}">Удалить навсегда</button>` : `<button class="app-btn" type="button" data-time-action="repeat" data-time-id="${e(item.id)}"${tracking.active ? ' disabled title="Сначала завершите текущий таймер"' : ""}>↻ Повторить</button><button class="app-btn" type="button" data-time-action="edit" data-time-id="${e(item.id)}">Изменить</button><button class="app-btn time-delete-button" type="button" data-time-action="delete" data-time-id="${e(item.id)}" aria-label="В корзину: ${e(item.title)}">В корзину</button>`}</div></article>`;
      }).join("");
      const empty = filters.deleted ? "Корзина пуста для выбранных фильтров" : tracking.entries.some(item => !isTimeEntryDeleted(item)) ? "По этим фильтрам ничего не найдено" : "Первое занятие — начало вашей истории";
      region.innerHTML = rows.length ? `<div class="time-history-grid"><div class="time-entry-list">${entries}${rows.length > visible.length ? `<button class="app-btn time-load-more" type="button" data-time-action="more">Показать ещё 30 · осталось ${rows.length - visible.length}</button>` : ""}</div><aside class="time-breakdown"><h3>Распределение за период</h3>${summary.groups.map(item => `<div class="time-total-row"><span>${e(item.name)}<small>${item.count} записей</small></span><b>${duration(item.ms)}</b></div>`).join("")}</aside></div>` : `<div class="time-empty"><strong>${e(empty)}</strong><p>${filters.deleted ? "Здесь можно восстановить записи или удалить их навсегда." : tracking.entries.length ? "Измените период, проект или строку поиска." : "Запустите таймер или добавьте уже выполненную работу вручную."}</p></div>`;
    }
    function editorHTML() {
      if (!editor) return "";
      if (["project", "task"].includes(editor.mode)) {
        const task = editor.mode === "task", projects = workspace().taskProjects || [];
        return `<dialog class="time-dialog" aria-labelledby="${dialogId}"><h2 id="${dialogId}">${task ? "Добавить задачу в проект" : "Новый проект"}</h2><p class="time-hint">${task ? "Задача появится в выбранном проекте и в приложении «Задачи» этого рабочего стола. Вы сможете возвращаться к ней и учитывать время за несколько подходов. После создания она будет выбрана здесь; отсчёт включается кнопкой «Начать работу»." : "Проект объединяет задачи и занятия. После создания он будет выбран для нового занятия."}</p><form data-time-create><label>${task ? "Название задачи" : "Название проекта"}<input class="app-input" name="createName" maxlength="${task ? 500 : 160}" value="${e(editor.createName)}" placeholder="${task ? "Например, подготовить макет" : "Например, Личный сайт"}" required></label>${task ? `<label>Проект<select class="app-input" name="createProjectId" required>${projects.map(item => `<option value="${e(item.id)}"${item.id === editor.createProjectId ? " selected" : ""}>${e(item.name)}</option>`).join("")}</select></label><p class="time-hint">Без срока и напоминаний. Остальные настройки доступны в приложении «Задачи».</p>` : ""}<div class="time-actions"><button class="app-btn primary" type="submit"${task && !projects.length ? " disabled" : ""}>${task ? "Создать задачу" : "Создать проект"}</button><button class="app-btn" type="button" data-time-action="cancel">Отмена</button></div></form><p class="time-dialog-status" data-time-dialog-status role="status"></p></dialog>`;
      }
      if (editor.mode === "purge") return `<dialog class="time-dialog" aria-labelledby="${dialogId}"><h2 id="${dialogId}">Удалить навсегда?</h2><p class="time-hint">Будут удалены перечисленные записи из корзины этого рабочего стола (${editor.expected.length}). Фильтры журнала не ограничивают очистку корзины.</p><ul class="time-purge-list">${editor.expected.map(item => `<li><strong>${e(item.title)}</strong><small>${e(item.projectName || "Без проекта")} · ${e(dateLabel(item.createdAt))} · ${duration(sessionDuration(item))}</small></li>`).join("")}</ul><p class="time-hint">Записи будут удалены из текущего журнала без возможности восстановления через корзину. Ранее созданные резервные копии могут содержать эти записи.</p><form data-time-purge><label class="time-check"><input type="checkbox" name="confirmPurge"${editor.confirmPurge ? " checked" : ""}>Понимаю, что восстановить эти записи через корзину будет нельзя</label><div class="time-actions"><button class="app-btn time-danger" type="submit"${editor.confirmPurge ? "" : " disabled"}>Удалить навсегда · ${editor.expected.length}</button><button class="app-btn" type="button" data-time-action="cancel">Отмена</button></div></form><p class="time-dialog-status" data-time-dialog-status role="status"></p></dialog>`;
      if (editor.mode === "goal") return `<dialog class="time-dialog" aria-labelledby="${dialogId}"><h2 id="${dialogId}">Дневная цель</h2><p class="time-hint">Личная цель для этого рабочего стола. 0 — без цели. Она не останавливает таймер и не создаёт уведомлений.</p><form data-time-goal-form><label>Минут в день<input class="app-input" name="goalMinutes" type="number" min="0" max="1440" step="1" value="${e(editor.goalMinutes)}" required></label><div class="time-actions"><button class="app-btn primary" type="submit">Сохранить цель</button><button class="app-btn" type="button" data-time-action="cancel">Отмена</button></div></form><p class="time-dialog-status" data-time-dialog-status role="status"></p></dialog>`;
      const manual = editor.mode === "manual", active = editor.mode === "active";
      return `<dialog class="time-dialog" aria-labelledby="${dialogId}"><h2 id="${dialogId}">${manual ? "Записать выполненную работу" : active ? "Описание текущего занятия" : "Изменить запись"}</h2><p class="time-hint">${manual ? "Уже поработали, но не включили таймер? Укажите фактическое начало и сколько времени работали. Эта запись сразу войдёт в итоги. Будущие занятия планируются отдельно в календаре." : "Название, проект и заметка меняются с сохранением всех интервалов и пауз."}</p><form ${manual ? "data-time-manual" : "data-time-edit"}><label>Название<input class="app-input" name="editTitle" maxlength="500" value="${e(editor.editTitle)}" required></label>${bindingHTML(editor, true)}<label>Заметка<textarea class="app-input" name="editNotes" maxlength="5000" rows="3">${e(editor.editNotes)}</textarea></label>${!manual && !active ? `<label class="time-check"><input type="checkbox" name="correctTime"${editor.correctTime ? " checked" : ""}>Исправить также время</label>` : ""}${manual || editor.correctTime ? `<div class="time-edit-time"><div class="time-form-pair"><label>Когда начали работу<input class="app-input" name="editStart" type="datetime-local" step="1" value="${e(editor.editStart)}" required></label><label>Сколько работали, минут<input class="app-input" name="editMinutes" inputmode="decimal" value="${e(editor.editMinutes)}" required></label></div><p class="time-hint">${manual ? "Например, 90 минут = 1 час 30 минут." : "Изменение времени заменит прежние интервалы и паузы одним интервалом. Дни пересчитаются."}</p><p class="time-end-preview" data-time-end-preview aria-live="polite"></p>${manual ? `<button class="app-btn time-plan-instead" type="button" data-time-action="plan-instead">Это будущая работа? Запланировать занятие →</button><p class="time-hint">Откроется форма календаря. Ввод из этой формы перенесётся; в отработанные часы план не попадёт.</p>` : ""}<label class="time-check"><input type="checkbox" name="allowOverlap"${editor.allowOverlap ? " checked" : ""}>Разрешить пересечение с другими записями</label></div>` : ""}<div class="time-actions"><button class="app-btn primary" type="submit">${manual ? "Записать в журнал" : "Сохранить изменения"}</button><button class="app-btn" type="button" data-time-action="cancel">Отмена</button></div></form><p class="time-dialog-status" data-time-dialog-status role="status"></p></dialog>`;
    }
    function updateLive() {
      if (!base) return;
      const at = Date.now(), active = controller.activeSession(), recovery = controller.needsRecovery(active);
      const included = active ? { ...active, runningSince: recovery ? null : active.runningSince } : null;
      const dayMs = base.dayMs + (included ? timeInRange(included, base.ranges.dayStart, base.ranges.dayEnd, at) : 0);
      const weekMs = base.weekMs + (included ? timeInRange(included, base.ranges.weekStart, base.ranges.weekEnd, at) : 0);
      root.querySelector("[data-time-clock]").textContent = duration(active ? sessionDuration(included, at) : 0);
      root.querySelector("[data-time-today]").textContent = duration(dayMs); root.querySelector("[data-time-week]").textContent = duration(weekMs);
      const goal = base.goal * 60000, progress = root.querySelector("[data-time-goal]"); progress.max = goal || 1; progress.value = Math.min(dayMs, goal || 0);
      root.querySelector("[data-time-goal-label]").textContent = goal ? `${duration(dayMs)} из ${duration(goal)} · ${Math.floor(dayMs / goal * 100)}%` : "Цель необязательна — задайте удобный ориентир";
      root.querySelector("[data-time-live-note]").textContent = active ? recovery ? "Учтены только сохранённые интервалы до перезапуска." : "Включая текущий таймер; паузы исключены." : "Сумма завершённых занятий.";
      const days = base.buckets.map(item => ({ ...item, total: item.ms + (included ? timeInRange(included, item.start, item.end, at) : 0) })), max = Math.max(60000, ...days.map(item => item.total));
      days.forEach((item, index) => {
        root.querySelector(`[data-time-bar="${index}"]`).style.setProperty("--time-bar", `${Math.max(0, item.total / max * 100)}%`);
        root.querySelector(`[data-time-day-value="${index}"]`).textContent = duration(item.total).slice(0, -3);
        root.querySelectorAll("[data-time-day]")[index].setAttribute("aria-label", `${new Date(item.start).toLocaleDateString("ru-RU")}: ${duration(item.total)}. Показать записи дня.`);
      });
    }
    function updateBase(tracking) {
      const ranges = localRanges(), entries = tracking.entries.filter(item => !isTimeEntryDeleted(item));
      base = { ranges, dayKey: localDateInput(Date.now(), false), goal: tracking.dailyGoalMinutes, buckets: timeWeekBuckets(entries), dayMs: entries.reduce((sum, item) => sum + timeInRange(item, ranges.dayStart, ranges.dayEnd), 0), weekMs: entries.reduce((sum, item) => sum + timeInRange(item, ranges.weekStart, ranges.weekEnd), 0) };
    }
    function render(focused = focusSnapshot()) {
      const scroll = root.scrollTop, tracking = controller.read();
      updateBase(tracking);
      root.innerHTML = `<header class="time-heading"><div><span>ВАШЕ ВРЕМЯ В ДЕЛЕ</span><h1>Учёт времени</h1><p>Таймер — для работы сейчас. Журнал — для выполненной работы.</p></div><div class="time-heading-actions"><button class="app-btn" type="button" data-time-action="project">＋ Новый проект</button><button class="app-btn" type="button" data-time-action="manual">＋ Записать выполненную работу</button><button class="app-btn" type="button" data-time-action="plan">Запланировать занятие →</button></div></header><div class="time-main-grid">${startHTML(tracking)}${overviewHTML(tracking)}</div><p class="time-status${error ? " error" : ""}" data-time-status role="status">${e(message)}</p>${journalHTML(tracking)}${editorHTML()}`;
      refreshJournal(tracking); updateLive(); updateEndPreview(); root.scrollTop = scroll;
      const dialog = root.querySelector("dialog");
      if (dialog && root.isConnected) { dialog.showModal(); dialog.addEventListener("cancel", event => { event.preventDefault(); closeEditor(); }); }
      if (error && dialog) { const node = dialog.querySelector("[data-time-dialog-status]"); node.textContent = message; node.classList.add("error"); }
      if (restoreFocus && !editor) { focusBack(restoreFocus); restoreFocus = null; } else focusBack(focused);
    }
    function closeEditor() { if (busy) return; editor = null; render(); }
    function launchPlan(fromEditor = false) {
      capture();
      const value = fromEditor && editor ? { title: editor.editTitle, notes: editor.editNotes, taskId: editor.editTaskId, projectId: editor.editProjectId,
        startedAt: new Date(editor.editStart).getTime(), durationMs: Math.round(Number(editor.editMinutes.trim().replace(",", ".")) * 60000) } : { ...draft };
      const previous = editor;
      if (fromEditor) transferredManualDraft = { ...editor };
      editor = null; render();
      try { options.onPlan(timePlanDraft(value, workspace())); }
      catch (failure) { editor = previous; showStatus(failure.message || "Не удалось открыть планирование.", true); render(); }
    }
    function openEditor(mode, item = null) {
      capture(); if (editor && !options.confirm("Заменить несохранённую форму?")) return;
      showStatus("");
      restoreFocus = focusSnapshot();
      editor = ["project", "task"].includes(mode) ? { mode, createName: "", createProjectId: draft.projectId || workspace().activeTaskProjectId || workspace().taskProjects?.[0]?.id || "" }
        : mode === "manual" && transferredManualDraft ? { ...transferredManualDraft }
        : mode === "purge" ? { mode, expected: JSON.parse(JSON.stringify(item)), confirmPurge: false }
        : mode === "goal" ? { mode, goalMinutes: String(controller.read().dailyGoalMinutes) } : { mode, id: item?.id || "", expected: item || null,
        editTitle: item?.title || "", editNotes: item?.notes || "", editTaskId: item?.taskId || "", editProjectId: item?.projectId || "",
        editStart: localDateInput(item?.createdAt ?? Date.now() - 30 * 60000), editMinutes: String(item ? sessionDuration(item) / 60000 : 30), correctTime: mode === "manual", allowOverlap: false };
      render(null); field(mode === "goal" ? "goalMinutes" : ["project", "task"].includes(mode) ? "createName" : mode === "purge" ? "confirmPurge" : "editTitle")?.focus();
    }
    function updateEndPreview() {
      const node = root.querySelector("[data-time-end-preview]"); if (!node) return;
      const start = new Date(field("editStart")?.value).getTime(), minutes = Number((field("editMinutes")?.value || "").trim().replace(",", ".")), end = start + minutes * 60000;
      const valid = Number.isFinite(end) && minutes > 0 && end <= 8640000000000000;
      const future = valid && end > Date.now();
      node.textContent = valid ? `Работа закончилась бы ${new Date(end).toLocaleString("ru-RU")}.${future ? " Это будущее время: такая запись ещё не является выполненной работой. Исправьте начало или длительность либо запланируйте занятие в календаре." : " Это прошедшее время — можно записать в журнал."}` : "Укажите начало и длительность — здесь появится время окончания.";
      node.classList.toggle("error", future);
    }
    async function exportSelection() {
      if (busy || filters.deleted) return;
      capture(); let rows;
      try { rows = selectTimeEntries(controller.read(), journalFilter()); if (!rows.length) return; }
      catch (failure) { showStatus(failure.message, true); return; }
      busy = true; disableControls(); showStatus("Готовим отчёт…");
      try { const result = await options.exportReport(timeReportRows(rows)); if (result?.cancelled) showStatus("Скачивание отменено"); else if (result?.ok !== true) throw new Error(result?.error || "Не удалось передать отчёт на сохранение."); else showStatus("Отчёт выбранных записей передан на сохранение"); }
      catch (failure) { showStatus(failure.message || "Не удалось скачать отчёт.", true); }
      finally { busy = false; render(); }
    }
    root.addEventListener("submit", event => {
      if (!event.target.matches("[data-time-start],[data-time-recovery],[data-time-edit],[data-time-manual],[data-time-goal-form],[data-time-create],[data-time-purge]")) return;
      event.preventDefault(); if (busy) return; capture();
      if (event.target.matches("[data-time-start]")) commit(() => controller.start({ ...draft }), "Таймер запущен", () => Object.assign(draft, { title: "", taskId: "", projectId: "", notes: "" }));
      else if (event.target.matches("[data-time-recovery]")) { const resume = event.submitter?.value === "resume"; commit(() => controller.recover(new Date(recoveryEnd).getTime(), resume), resume ? "Время уточнено, отсчёт продолжен" : "Сессия завершена", () => { recoveryEnd = ""; }); }
      else if (event.target.matches("[data-time-goal-form]")) commit(() => controller.setDailyGoal(Number(editor.goalMinutes)), "Дневная цель сохранена", () => { editor = null; });
      else if (event.target.matches("[data-time-create]")) {
        const submitted = { ...editor }, task = submitted.mode === "task";
        commit(() => task ? options.taskCreator.createTask(submitted.createName, submitted.createProjectId) : options.taskCreator.createProject(submitted.createName), task ? "Задача создана и выбрана" : "Проект создан и выбран", item => {
          draft.taskId = task ? item.id : ""; draft.projectId = task ? item.projectId : item.id; editor = null;
        }, { tasksChanged: true });
      }
      else if (event.target.matches("[data-time-purge]")) {
        if (!editor?.confirmPurge) return;
        const expected = editor.expected;
        commit(() => controller.purgeEntries(expected), `Удалено навсегда: ${expected.length}`, () => { editor = null; });
      }
      else {
        const submitted = editor, value = { title: submitted.editTitle, notes: submitted.editNotes, taskId: submitted.editTaskId, projectId: submitted.editProjectId, expected: submitted.expected };
        if (submitted.mode === "manual" || submitted.correctTime) Object.assign(value, { startedAt: new Date(submitted.editStart).getTime(), durationMs: Math.round(Number(submitted.editMinutes.trim().replace(",", ".")) * 60000), allowOverlap: submitted.allowOverlap });
        const operation = submitted.mode === "manual" ? () => controller.addManual(value) : submitted.mode === "active" ? () => controller.editActive(submitted.id, value) : () => controller.edit(submitted.id, value);
        commit(operation, submitted.mode === "manual" ? "Запись добавлена" : "Изменения сохранены", () => { if (submitted.mode === "manual") transferredManualDraft = null; editor = null; });
      }
    });
    root.addEventListener("click", event => {
      if (busy) return;
      const day = event.target.closest("[data-time-day]");
      if (day) { capture(); filters.period = "custom"; filters.fromDate = filters.toDate = day.dataset.timeDay; filters.deleted = false; journalLimit = 30; render(); root.querySelector(".time-history").scrollIntoView({ block: "start" }); return; }
      const button = event.target.closest("[data-time-action]"); if (!button) return;
      const action = button.dataset.timeAction, tracking = controller.read(), item = tracking.entries.find(item => item.id === button.dataset.timeId);
      if (["pause", "resume", "finish"].includes(action)) commit(() => controller[action](), action === "pause" ? "Таймер на паузе" : action === "resume" ? "Отсчёт продолжен" : "Занятие сохранено в журнале");
      else if (["manual", "goal", "project", "task"].includes(action)) openEditor(action);
      else if (action === "plan" || action === "plan-instead") launchPlan(action === "plan-instead");
      else if (action === "cancel") closeEditor();
      else if (action === "edit-active" && tracking.active) openEditor("active", tracking.active);
      else if (action === "edit" && item) openEditor("entry", item);
      else if (action === "repeat" && item) commit(() => controller.repeat(item.id), "Начато новое занятие");
      else if (action === "delete" && item) moveToTrash(item);
      else if (action === "restore" && item) commit(() => controller.restoreEntry(item.id, item.deletedAt), "Запись восстановлена");
      else if (action === "purge" && item && isTimeEntryDeleted(item)) openEditor("purge", [item]);
      else if (action === "purge-all" && tracking.entries.some(isTimeEntryDeleted)) openEditor("purge", tracking.entries.filter(isTimeEntryDeleted));
      else if (action === "journal" || action === "trash") { capture(); filters.deleted = action === "trash"; if (filters.deleted) Object.assign(filters, { period: "all", query: "", project: "all" }); journalLimit = 30; render(); }
      else if (action === "reset-filters") { capture(); Object.assign(filters, { period: "week", query: "", project: "all" }); journalLimit = 30; render(); }
      else if (action === "more") { journalLimit += 30; refreshJournal(); }
      else if (action === "export") exportSelection();
    });
    root.addEventListener("input", event => {
      if (!busy && ["editStart", "editMinutes"].includes(event.target.name)) { capture(); updateEndPreview(); return; }
      if (busy || event.target.name !== "query") return;
      filters.query = event.target.value; journalLimit = 30; refreshJournal();
    });
    root.addEventListener("change", event => {
      if (busy) return; capture(); const name = event.target.name;
      if (name === "confirmPurge") { root.querySelector('[data-time-purge] button[type="submit"]').disabled = !editor.confirmPurge; return; }
      if (["taskId", "editTaskId", "projectId", "editProjectId", "correctTime"].includes(name)) {
        if (name === "projectId") draft.taskId = "";
        if (name === "editProjectId" && editor) editor.editTaskId = "";
        if (name === "editTaskId" && editor?.editTaskId) {
          const task = workspace().tasks?.find(task => task.id === editor.editTaskId);
          if (task) editor.editProjectId = task.projectId;
        }
        render(); return;
      }
      if (name === "period") { filters.period = event.target.value; journalLimit = 30; render(); return; }
      if (name === "filterProject") filters.project = event.target.value;
      else if (name === "grouping") filters.grouping = event.target.value;
      else if (["fromDate", "toDate"].includes(name)) filters[name] = event.target.value;
      else return;
      journalLimit = 30; refreshJournal();
    });
    root.refreshTimeTracking = () => { if (!busy) { capture(); render(); } };
    render();
    const timer = view.setInterval(() => {
      if (!root.isConnected) { view.clearInterval(timer); return; }
      if (base.dayKey !== localDateInput(Date.now(), false)) { capture(); render(); return; }
      updateLive();
    }, 1000);
    return root;
  }
  window.ZETER_TIME_TRACKING_UI_UTILS = Object.freeze({ createTimeTrackingApp, timeTaskChoices, timePlanDraft, timeEntryTiming });
})();
