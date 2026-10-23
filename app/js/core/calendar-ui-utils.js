(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const calendarUtils = window.ZETER_CALENDAR_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS calendar UI utils require core utils.");
  if (!dataNormalizers) throw new Error("ZeTer OS calendar UI utils require data normalizers.");
  if (!calendarUtils) throw new Error("ZeTer OS calendar UI utils require calendar utils.");

  const { escapeHtml, parseISO, dateISO, todayISO: localTodayISO, pad, uid } = coreUtils;
  const {
    normalizeCalendarCategory,
    normalizeCalendarRepeat,
    normalizeCalendarReminder,
    normalizeCalendarEvent
  } = dataNormalizers;
  const {
    startOfWeek,
    addDays,
    categoryName,
    calendarEventsForDate,
    calendarOccurrences,
    calendarDayLayout,
    calendarDateAdd,
    calendarTimeMinutes,
    calendarEventDurationMinutes,
    validateCalendarEventDraft,
    removeCalendarEventById,
    calendarTitleText,
    moveCalendarState,
    upsertCalendarEvent
  } = calendarUtils;
  const safeAttr = escapeHtml;

  const CALENDAR_WEEKDAY_NAMES = Object.freeze(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);
  const timeText = minute => minute === 1440 ? "24:00" : `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
  const durationText = minutes => minutes > 0 ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} ч ` : ""}${minutes % 60 ? `${minutes % 60} мин` : ""}`.trim() : "Без времени";
  const eventTimeText = event => event.allDay || !event.start ? "Весь день / без времени" : `${event.start}–${event.end || "…"}${event.endDate && event.endDate !== event.date ? ` (${event.date} → ${event.endDate})` : ""}`;
  const eventAttrs = event => `data-edit-event="${safeAttr(event.eventId || event.id || "")}" data-occurrence-date="${safeAttr(event.occurrenceDate || event.date || "")}"`;
  const categoryOptions = categories => `<option value="work">Работа</option><option value="personal">Личное</option><option value="health">Здоровье</option><option value="important">Важное</option>${(categories || []).map(category => `<option value="${safeAttr(category.id)}">${escapeHtml(category.icon ? `${category.icon} ${category.name}` : category.name)}</option>`).join("")}`;
  const categoryColor = (id, categories = []) => { const color = categories.find(category => category.id === id)?.color; return /^#[0-9a-f]{6}$/i.test(color || "") ? color : ""; };
  const categoryStyle = (id, categories = []) => { const color = categoryColor(id, categories); return color ? ` style="--calendar-category:${color}"` : ""; };

  function calendarShellHTML(desktopTitle = "Рабочий стол") {
    return `<div class="workspace-note">Календарь · <b>${escapeHtml(desktopTitle)}</b></div>
      <div class="calendar-toolbar"><div class="calendar-navigation"><button type="button" data-cal="prev" aria-label="Предыдущий период">←</button><button type="button" data-cal="today">Сегодня</button><button type="button" data-cal="next" aria-label="Следующий период">→</button></div><h2 class="calendar-title"></h2><div class="calendar-view-actions"><select data-view aria-label="Вид календаря"><option value="month">Месяц</option><option value="week">Неделя</option><option value="day">День</option><option value="agenda">Повестка</option></select><button type="button" class="app-btn primary" data-add-event="">+ Создать событие</button></div></div>
      <div class="calendar-tools"><label class="calendar-search">Поиск<input type="search" data-calendar-search placeholder="Название, место, задача…"></label><div class="calendar-category-filter"><label>Категория<select data-calendar-category><option value="">Все категории</option>${categoryOptions()}</select></label><details class="calendar-category-manager"><summary class="calendar-category-settings-trigger">Настройки категории</summary><div class="calendar-category-body"><p data-category-settings-info>Выберите собственную категорию в списке рядом.</p><div class="calendar-category-settings-fields" data-category-settings-fields hidden><label>Название категории<input data-category-name maxlength="80"></label><label>Описание категории<textarea data-category-description maxlength="1000" rows="2" placeholder="Для каких событий эта категория?"></textarea></label><div class="two"><label>Цвет<input type="color" data-category-color value="#7aa8ff"></label><label>Значок<select data-category-icon>${dataNormalizers.CALENDAR_CATEGORY_ICONS.map(icon => `<option value="${safeAttr(icon)}">${escapeHtml(icon || "Без значка")}</option>`).join("")}</select></label></div><div class="event-actions"><button type="button" data-retry-category-settings hidden>Повторить сохранение</button><button type="button" data-discard-category-settings hidden>Отменить несохранённое</button></div><div class="calendar-category-removal" data-category-removal><p data-category-delete-info></p><label>Перенести события в<select data-category-replacement></select></label><button type="button" class="app-btn danger" data-delete-category>Удалить выбранную категорию</button></div></div><p data-category-status role="status"></p></div></details><details class="calendar-category-creator"><summary class="calendar-category-trigger">+ Создать категорию</summary><div class="calendar-category-create-body"><label>Название категории<input data-new-category-name maxlength="80"></label><label>Цвет<input type="color" data-new-category-color value="#7aa8ff"></label><button type="button" data-create-category>Создать категорию</button><p data-category-create-status role="status"></p></div></details></div><div class="calendar-project-filter"><label>Проект<select data-calendar-project><option value="">Все проекты</option></select></label><button type="button" data-project-settings>Настройки проекта</button><button type="button" data-create-project>+ Создать проект</button></div><details class="calendar-options"><summary>Параметры</summary><div class="calendar-options-body"><p>Рабочие часы — для расчёта свободного времени.</p><div class="two"><label>Начало<input data-work-start type="time" value="09:00"></label><label>Окончание<input data-work-end type="time" value="18:00"></label></div><label class="calendar-check"><input type="checkbox" data-show-deadlines checked> Сроки задач</label><button type="button" data-export-events>Скачать события JSON</button></div></details><p class="calendar-status" data-calendar-status role="status"></p></div>
      <div class="calendar-layout"><section class="calendar-main"><div class="calendar-agenda-range" hidden><label>С<input type="date" data-agenda-from></label><label>По<input type="date" data-agenda-to></label><span class="muted">До 366 дней</span></div><div class="calendar-board" aria-label="Планировщик"></div><p class="calendar-interaction-hint muted">Двойное нажатие на день — создать. На временной сетке выделите промежуток; событие можно перенести, нижний край — растянуть. Даты и время доступны в редакторе.</p></section><aside class="calendar-side"><section class="side-card calendar-selected-day-card"><h3 data-selected-heading>Выбранный день</h3><div class="calendar-day-summary"></div><div class="event-list"></div><div class="calendar-day-insights"></div></section></aside></div>`;
  }

  function calendarEventEditorHTML() {
    return `<section class="form-card calendar-event-editor-card"><h3 data-form-title>Новое событие</h3><p class="muted" data-series-context hidden></p><div class="form-grid">
      <label>Название события<input data-ev-title maxlength="500" placeholder="Например, встреча по проекту" autocomplete="off"></label>
      <label class="calendar-check"><input type="checkbox" data-ev-all-day> Весь день</label>
      <div class="two"><label>Дата начала<input data-ev-date type="date"></label><label>Дата окончания<input data-ev-end-date type="date"></label></div>
      <div class="two" data-time-fields><label>Начало<input data-ev-start type="time" value="09:00"></label><label>Окончание<input data-ev-end type="time" value="10:00"></label></div><p class="calendar-duration muted" data-ev-duration></p>
      <label data-series-scope-label hidden>Изменить<select data-ev-scope><option value="all">Всю серию</option><option value="one">Только это вхождение</option><option value="future">Это и последующие</option></select></label>
      <label>Задача<select data-ev-task><option value="">Без привязки к задаче</option></select></label><p class="muted calendar-task-help">Событие — план работы. Срок, статус и отработанное время задачи не меняются.</p>
      <label>Описание<textarea data-ev-desc rows="3" placeholder="Что нужно сделать?"></textarea></label><section class="calendar-attachments"><h4>Файлы</h4><div data-ev-attachments></div><div class="two"><label>Материал рабочего стола<select data-ev-file><option value="">Выберите материал</option></select></label><button type="button" data-attach-existing>Прикрепить материал</button></div><label class="calendar-file-upload">Добавить с компьютера<input type="file" data-ev-upload multiple></label><button type="button" data-retry-upload hidden>Повторить загрузку выбранных файлов</button><p class="muted">Снятие вложения убирает только связь. Сам файл сохраняется.</p></section>
      <details class="calendar-editor-details"><summary>Повтор, напоминание и подробности</summary><div class="form-grid"><div class="two"><label>Категория<select data-ev-category>${categoryOptions()}</select></label><label>Повтор<select data-ev-repeat><option value="none">Без повтора</option><option value="daily">Каждый день</option><option value="weekly">По дням недели</option><option value="monthly">Каждый месяц</option></select></label></div>
      <div class="calendar-repeat-settings" hidden><div class="two"><label>Интервал повторов<input data-ev-repeat-interval type="number" min="1" max="365" value="1"></label><label>Повторять по дату включительно<input data-ev-repeat-until type="date"></label></div><fieldset data-repeat-weekdays hidden><legend>Дни недели</legend><div class="calendar-weekday-checks">${[1,2,3,4,5,6,0].map((day, i) => `<label class="calendar-check"><input type="checkbox" data-ev-weekday value="${day}">${CALENDAR_WEEKDAY_NAMES[i]}</label>`).join("")}</div></fieldset><label>Исключённые даты<textarea data-ev-excluded placeholder="2026-12-25, 2026-12-31" rows="2"></textarea></label></div>
      <label>Напомнить<select data-ev-reminder><option value="0">Без напоминания</option><option value="5">За 5 минут</option><option value="15" selected>За 15 минут</option><option value="60">За час</option><option value="1440">За день</option></select></label><label>Место<input data-ev-location autocomplete="off"></label><div class="calendar-event-object-links-host" data-calendar-event-object-links-host hidden aria-hidden="true"></div></div></details>
      <p data-event-status role="status" class="calendar-editor-status"></p><div class="calendar-event-editor-actions"><button type="button" data-cancel-event-editor>Отмена</button><button type="button" class="app-btn primary" data-save-event>Добавить</button></div><p class="muted calendar-key-hint">Ctrl+Enter — сохранить · Escape — отменить</p></div></section>`;
  }

  function calendarEventEditorMissingHTML() {
    return `<section class="form-card calendar-event-editor-card"><h3>Событие не найдено</h3><p class="muted">Оно могло быть удалено в другом окне.</p><button type="button" data-cancel-event-editor>Закрыть</button></section>`;
  }
  function calendarTimePlanEditorHTML() {
    return calendarEventEditorHTML().replace("Новое событие</h3>", "Запланировать занятие</h3><p class=\"muted\">План не увеличивает отработанное время. Начав работу, запустите таймер.</p>").replace("data-event-status", "data-plan-status").replace(">Добавить</button>", ">Сохранить план в календаре</button>");
  }

  function mountCalendarObjectLinksPanel(root, panel, options = {}) {
    const host = root?.querySelector?.("[data-calendar-event-object-links-host]");
    if (!host) return false;
    host.innerHTML = "";
    if (panel) {
      host.appendChild(panel);
      host.hidden = false;
      host.setAttribute?.("aria-hidden", "false");
      return true;
    }
    const message = String(options.message || "").trim();
    if (message) {
      host.innerHTML = `<section class="object-links-panel object-links-panel-unavailable"><div class="object-links-heading"><h4>Связи</h4></div><p class="muted">${escapeHtml(message)}</p></section>`;
      host.hidden = false;
      host.setAttribute?.("aria-hidden", "false");
      return true;
    }
    host.hidden = true;
    host.setAttribute?.("aria-hidden", "true");
    return false;
  }

  function calendarWeekdayHeaderHTML(name) { return `<div class="weekday">${escapeHtml(name)}</div>`; }
  function calendarEventChipHTML(event = {}, options = {}) {
    return `<button type="button" class="event-chip ${normalizeCalendarCategory(event.category)}" ${eventAttrs(event)}${categoryStyle(event.category, options.categories)} title="${safeAttr(`${eventTimeText(event)} · ${event.title || ""}`)}"><span>${escapeHtml(event.allDay || !event.start ? "Весь день" : options.showEnd ? `${event.start}–${event.end}` : event.start)}</span> ${escapeHtml(event.title || "")}</button>`;
  }
  function calendarMonthDayHTML(dayNumber, events = [], options = {}) {
    const count = events.length + (options.tasks || []).length, max = 5;
    // Native size queries choose the visible capacity; all hidden items remain
    // counted, and selecting the day still opens its complete list.
    return `<span class="day-number">${escapeHtml(dayNumber)}</span><div class="calendar-cell-events">${events.slice(0, max).map(event => calendarEventChipHTML(event, options)).join("")}${(options.tasks || []).slice(0, Math.max(0, max - events.length)).map(task => `<button type="button" class="calendar-task-deadline" data-open-task="${safeAttr(task.id)}" title="Срок задачи: ${safeAttr(task.title)}">◇ ${escapeHtml(task.title)}</button>`).join("")}${[1,2,3,4,5].filter(capacity => count > capacity).map(capacity => `<span class="calendar-more calendar-capacity-${capacity}">+${count - capacity}</span>`).join("")}</div>`;
  }
  function calendarMonthViewElement({ calendarDateISO = "", selectedISO = "", todayISOValue = "", eventsForDate = () => [], tasksForDate = () => [], categories = [], weekStart = "monday" } = {}) {
    const wrap = document.createElement("div"); wrap.className = "month-grid";
    const names = weekStart === "sunday" ? ["Вс", ...CALENDAR_WEEKDAY_NAMES.slice(0, 6)] : CALENDAR_WEEKDAY_NAMES;
    names.forEach(name => { const header = document.createElement("div"); header.innerHTML = calendarWeekdayHeaderHTML(name); wrap.appendChild(header.firstElementChild); });
    const current = parseISO(calendarDateISO), month = current.getMonth(), start = startOfWeek(new Date(current.getFullYear(), month, 1), weekStart);
    for (let i = 0; i < 42; i++) {
      const day = addDays(start, i), iso = dateISO(day), cell = document.createElement("div");
      cell.className = `day-cell${day.getMonth() !== month ? " other" : ""}${iso === todayISOValue ? " today" : ""}${iso === selectedISO ? " selected" : ""}`;
      cell.dataset.day = iso; cell.tabIndex = iso === selectedISO ? 0 : -1; cell.setAttribute("role", "group");
      cell.setAttribute("aria-label", day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }));
      cell.setAttribute("aria-current", iso === todayISOValue ? "date" : "false");
      cell.innerHTML = calendarMonthDayHTML(day.getDate(), eventsForDate(iso), { date: iso, tasks: tasksForDate(iso), categories }); wrap.appendChild(cell);
    }
    return wrap;
  }
  function calendarWeekRowHTML(day, events = []) { return `<b>${escapeHtml(day.toLocaleDateString("ru-RU"))}</b><div>${events.map(event => calendarEventChipHTML(event)).join("")}</div>`; }
  function calendarDayHourHTML(hourLabel, events = []) { return `<b>${escapeHtml(hourLabel)}</b><div>${events.map(event => calendarEventChipHTML(event, { showEnd: true })).join("")}</div>`; }
  function calendarTimeGridElement(dates, eventsForDate, options = {}) {
    const wrap = document.createElement("div"); wrap.className = `calendar-time-grid ${dates.length > 1 ? "week-view" : "day-view"}`;
    wrap.style?.setProperty("--calendar-days", dates.length);
    const ruler = document.createElement("div"); ruler.className = "calendar-time-ruler";
    ruler.innerHTML = `<div class="calendar-time-ruler-head">Время</div><div class="calendar-ruler-hours">${Array.from({ length: 25 }, (_, h) => `<span style="top:${h * 60}px">${pad(h)}:00</span>`).join("")}</div>`; wrap.appendChild(ruler);
    for (const iso of dates) {
      const layout = calendarDayLayout(eventsForDate(iso), iso, options.preferences || {}), column = document.createElement("div");
      column.className = `calendar-time-column${iso === options.todayISOValue ? " today" : ""}`; column.dataset.day = iso;
      const deadlines = (options.tasksForDate?.(iso) || []).map(task => `<button type="button" class="calendar-task-deadline" data-open-task="${safeAttr(task.id)}">◇ ${escapeHtml(task.title)}</button>`).join("");
      column.innerHTML = `<div class="calendar-time-column-head"><button type="button" data-select-day="${iso}" aria-label="Выбрать ${iso}">${escapeHtml(parseISO(iso).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" }))}</button><div class="calendar-all-day">${layout.allDay.map(event => calendarEventChipHTML(event, options)).join("")}${deadlines}</div></div><div class="calendar-time-track" data-time-day="${iso}" aria-label="Время ${iso}">${Array.from({ length: 48 }, (_, slot) => `<button type="button" class="calendar-time-slot" data-time-slot="${slot * 30}" data-slot-date="${iso}" aria-label="Создать ${iso} в ${timeText(slot * 30)}"></button>`).join("")}${layout.segments.map(segment => {
        const color = categoryColor(segment.event.category, options.categories);
        return `<div class="calendar-timed-event ${normalizeCalendarCategory(segment.event.category)}" ${eventAttrs(segment.event)} role="button" tabindex="0" aria-label="${safeAttr(`${eventTimeText(segment.event)} ${segment.event.title}. Enter — изменить`)}" style="${color ? `--calendar-category:${color};` : ""}top:${segment.startMinute}px;height:${Math.max(18, segment.endMinute - segment.startMinute)}px;left:calc(${segment.lane / segment.lanes * 100}% + 2px);width:calc(${100 / segment.lanes}% - 4px)"><span class="calendar-timed-time">${segment.continuesBefore ? "↥ " : ""}${escapeHtml(segment.event.start || "")}–${escapeHtml(segment.event.end || "")}${segment.continuesAfter ? " ↧" : ""}</span><strong>${escapeHtml(segment.event.title)}</strong><span class="calendar-resize-handle" data-resize-event aria-hidden="true"></span></div>`;
      }).join("")}${iso === (options.todayISOValue || localTodayISO()) ? `<div class="calendar-now" style="top:${new Date().getHours() * 60 + new Date().getMinutes()}px" aria-label="Текущее время"></div>` : ""}</div>`;
      wrap.appendChild(column);
    }
    return wrap;
  }
  function calendarWeekViewElement(calendarDateISO = "", eventsForDate = () => [], weekStart = "monday", options = {}) { const start = startOfWeek(parseISO(calendarDateISO), weekStart); return calendarTimeGridElement(Array.from({ length: 7 }, (_, i) => dateISO(addDays(start, i))), eventsForDate, options); }
  function calendarDayViewElement(iso = "", events = [], options = {}) { return calendarTimeGridElement([iso], () => events, options); }
  function calendarAgendaRowHTML(event = {}, formatDate) { return `<div class="calendar-agenda-date">${escapeHtml(typeof formatDate === "function" ? formatDate(event.date) : event.date)}<small>${escapeHtml(eventTimeText(event))}</small></div><button type="button" class="calendar-agenda-open" ${eventAttrs(event)}><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.location || event.description || "")}</small></button>`; }
  function calendarAgendaEmptyHTML() { return `<p class="muted calendar-empty">В этом периоде событий нет. Измените даты или создайте событие.</p>`; }
  function calendarAgendaViewElement(events = [], formatDate) {
    const wrap = document.createElement("div"); wrap.className = "agenda-view";
    [...events].sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start))).forEach(event => { const row = document.createElement("div"); row.className = "agenda-row"; row.innerHTML = calendarAgendaRowHTML(event, formatDate); wrap.appendChild(row); });
    if (!events.length) wrap.innerHTML = calendarAgendaEmptyHTML(); return wrap;
  }
  function calendarSelectedEventCardHTML(event = {}, options = {}) {
    const occurrence = safeAttr(event.occurrenceDate || event.date || ""), id = safeAttr(event.eventId || event.id || ""), repeat = normalizeCalendarRepeat(event.repeat) !== "none";
    return `<h4>${escapeHtml(event.title)}</h4><p>${escapeHtml(eventTimeText(event))} · ${escapeHtml(durationText(calendarEventDurationMinutes(event)))}</p><p class="muted">${escapeHtml(categoryName(event.category, options.categories || []))}${repeat ? " · повтор" : ""}${event.projectName ? ` · ${escapeHtml(event.projectName)}` : ""}</p>${event.location ? `<p>${escapeHtml(event.location)}</p>` : ""}${event.description ? `<p class="calendar-event-description">${escapeHtml(event.description)}</p>` : ""}${(event.attachments || []).length ? `<div class="calendar-attachment-list">${event.attachments.map(ref => { const file = options.resolveAttachment?.(ref); return `<button type="button" data-open-attachment="${safeAttr(ref.id)}" ${file ? "" : "disabled"}>▧ ${escapeHtml(file?.title || "Файл недоступен")}</button>`; }).join("")}</div>` : ""}<div class="event-actions"><button type="button" ${eventAttrs(event)}>Изменить</button>${event.taskId ? `<button type="button" data-open-task="${safeAttr(event.taskId)}">К задаче</button>` : ""}${event.taskId || event.projectId || event.timeTrackingProjectId ? `<button type="button" data-start-event-timer="${id}" data-occurrence-date="${occurrence}">Начать таймер</button>` : ""}<button type="button" class="calendar-delete-event" data-delete-event="${id}" data-occurrence-date="${occurrence}">${repeat ? "Удалить…" : "Удалить"}</button></div>`;
  }
  function calendarSelectedEmptyHTML() { return `<p class="muted calendar-empty">На выбранный день событий нет. Ниже — свободное время и ближайшие дела.</p>`; }
  function calendarSelectedEventsHTML(events = [], options = {}) { return events.length ? [...events].sort((a,b) => String(a.start || "").localeCompare(String(b.start || ""))).map(event => `<article class="event-card"${categoryStyle(event.category, options.categories)}>${calendarSelectedEventCardHTML(event, options)}</article>`).join("") : calendarSelectedEmptyHTML(); }
  function renderCalendarAppView(root, calendar = {}, options = {}) {
    const find = selector => root?.querySelector?.(selector), selected = calendar.selected || calendar.date || localTodayISO(), view = calendar.view || "month";
    const eventsForDate = options.eventsForDate || (iso => calendarEventsForDate(options.events || [], iso));
    if (find("[data-view]")) find("[data-view]").value = view;
    if (find(".calendar-title")) find(".calendar-title").textContent = options.title || "";
    const range = find(".calendar-agenda-range"); if (range) range.hidden = view !== "agenda";
    const board = find(".calendar-board"); if (!board) return;
    const preserveMonth = view === "month" && options.preserveMonth && board.querySelector?.(".month-grid");
    if (!preserveMonth) board.innerHTML = "";
    const gridOptions = { ...options, tasksForDate: options.tasksForDate || (() => []) };
    if (view === "month" && !preserveMonth) board.appendChild(calendarMonthViewElement({ calendarDateISO: calendar.date, selectedISO: selected, todayISOValue: options.todayISOValue, eventsForDate, tasksForDate: gridOptions.tasksForDate, categories: options.categories, weekStart: options.weekStart }));
    if (preserveMonth) for (const cell of board.querySelectorAll(".day-cell")) {
      const isSelected = cell.dataset.day === selected;
      cell.classList.toggle("selected", isSelected); cell.tabIndex = isSelected ? 0 : -1;
    }
    if (view === "week") board.appendChild(calendarWeekViewElement(calendar.date, eventsForDate, options.weekStart, gridOptions));
    if (view === "day") board.appendChild(calendarDayViewElement(selected, eventsForDate(selected), gridOptions));
    if (view === "agenda") board.appendChild(calendarAgendaViewElement(options.agendaEvents || calendarOccurrences(options.events || [], selected, calendarDateAdd(selected, 30)), options.formatDate));
    if (find(".event-list")) find(".event-list").innerHTML = calendarSelectedEventsHTML(eventsForDate(selected), options);
    if (find("[data-selected-heading]")) find("[data-selected-heading]").textContent = parseISO(selected).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
    const summary = find(".calendar-day-summary"), insights = find(".calendar-day-insights");
    const all = options.allEventsForDate?.(selected) || calendarEventsForDate(options.events || [], selected), layout = calendarDayLayout(all, selected, options.preferences || {});
    if (summary) summary.innerHTML = `<span>${all.length} событий</span><span>Занято ${escapeHtml(durationText(layout.busyMinutes))}</span>${options.filtered ? '<p class="calendar-filter-context">Включён фильтр. Занятость и пересечения учитывают все события.</p>' : ""}`;
    if (insights) {
      const future = options.upcoming || [], tasks = gridOptions.tasksForDate(selected);
      insights.innerHTML = `${tasks.length ? `<section><h4>Сроки задач</h4>${tasks.map(task => `<button type="button" class="calendar-task-deadline" data-open-task="${safeAttr(task.id)}">◇ ${escapeHtml(task.title)}</button>`).join("")}</section>` : ""}<section><h4>Свободное время</h4><p class="muted">${escapeHtml(options.preferences?.workStart || "09:00")}–${escapeHtml(options.preferences?.workEnd || "18:00")}${layout.allDay.length ? " · есть события без времени" : ""}</p>${layout.allDay.length ? '<p class="muted">Есть события на весь день или без времени: проверьте их перед планированием.</p>' : layout.freeSlots.length ? layout.freeSlots.map(slot => `<button type="button" class="calendar-free-slot" data-free-date="${selected}" data-free-start="${slot.start}" data-free-end="${slot.end}">${timeText(slot.start)}–${timeText(slot.end)} <span>${durationText(slot.end - slot.start)}</span></button>`).join("") : '<p class="muted">Свободных промежутков нет.</p>'}</section>${layout.conflicts.length ? `<section class="calendar-conflicts"><h4>Пересечения · ${layout.conflicts.length}</h4>${layout.conflicts.map(conflict => `<p>${timeText(conflict.start)}–${timeText(conflict.end)} · ${conflict.ids.length} события</p>`).join("")}</section>` : ""}${!eventsForDate(selected).length ? `<section><h4>Ближайшие события · 30 дней</h4>${future.length ? future.slice(0, 4).map(event => `<button type="button" class="calendar-upcoming" ${eventAttrs(event)}><small>${escapeHtml(event.date)} · ${escapeHtml(event.start || "Весь день")}</small>${escapeHtml(event.title)}</button>`).join("") : '<p class="muted">Пока нет событий. Можно спланировать задачу.</p>'}</section>` : ""}`;
    }
  }

  function calendarClickAction(target) {
    let button = target?.closest?.("[data-cal]"); if (button) return { type: "move", action: button.dataset.cal || "" };
    button = target?.closest?.("[data-add-event]"); if (button) return { type: "add-event", date: button.dataset.addEvent || "" };
    button = target?.closest?.("[data-edit-event]"); if (button) return { type: "edit-event", eventId: button.dataset.editEvent || "", occurrenceDate: button.dataset.occurrenceDate || "" };
    button = target?.closest?.("[data-delete-event]"); if (button) return { type: "delete-event", eventId: button.dataset.deleteEvent || "", occurrenceDate: button.dataset.occurrenceDate || "" };
    button = target?.closest?.("[data-select-day]"); if (button) return { type: "select-day", day: button.dataset.selectDay };
    button = target?.closest?.("[data-day]"); if (button) return { type: "select-day", day: button.dataset.day || "" };
    if (target?.closest?.("[data-export-events]")) return { type: "export-events" }; return null;
  }

  function calendarChangeAction(target) {
    if (target?.matches?.("[data-view]")) return { type: "view", view: target.value || "month" };
    return null;
  }

  function calendarKeyAction(event = {}) {
    if (event.key !== "Enter" && event.key !== " ") return null;
    if (event.target?.closest?.("button,input,select,textarea,[data-edit-event]")) return null;
    const day = event.target?.closest?.("[data-day]");
    return day ? { type: "select-day", day: day.dataset.day || "" } : null;
  }

  function calendarEventEditorClickAction(target) {
    if (target?.closest?.("[data-save-event]")) return { type: "save" };
    if (target?.closest?.("[data-cancel-event-editor]")) return { type: "cancel" };
    return null;
  }

  function calendarEventEditorKeyAction(event = {}) {
    if (event.key === "Escape") return { type: "cancel" };
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) return { type: "save" };
    return null;
  }

  function calendarEventFormData(root, options = {}) {
    const find = selector => root?.querySelector?.(selector), date = find("[data-ev-date]")?.value || options.fallbackDate || "";
    return { id: options.id || "", title: String(find("[data-ev-title]")?.value || "").trim(), date, endDate: find("[data-ev-end-date]")?.value || date, allDay: Boolean(find("[data-ev-all-day]")?.checked), start: find("[data-ev-start]")?.value || "", end: find("[data-ev-end]")?.value || "", location: String(find("[data-ev-location]")?.value || "").trim(), category: find("[data-ev-category]")?.value || "", repeat: find("[data-ev-repeat]")?.value || "none", repeatInterval: Number(find("[data-ev-repeat-interval]")?.value || 1), repeatUntil: find("[data-ev-repeat-until]")?.value || "", repeatWeekdays: Array.from(root?.querySelectorAll?.("[data-ev-weekday]:checked") || []).map(field => Number(field.value)), excludedDates: String(find("[data-ev-excluded]")?.value || "").split(/[,\s]+/).filter(Boolean), taskId: find("[data-ev-task]")?.value || "", reminder: find("[data-ev-reminder]")?.value || "", description: String(find("[data-ev-desc]")?.value || "").trim() };
  }
  function fillCalendarEventForm(root, event = {}) {
    const normalized = normalizeCalendarEvent({ ...event }), map = { title: "title", date: "date", endDate: "end-date", start: "start", end: "end", location: "location", category: "category", repeat: "repeat", repeatInterval: "repeat-interval", repeatUntil: "repeat-until", reminder: "reminder", description: "desc", taskId: "task" };
    for (const [key, selector] of Object.entries(map)) { const field = root?.querySelector?.(`[data-ev-${selector}]`); if (field) field.value = normalized[key] ?? ""; }
    const allDay = root?.querySelector?.("[data-ev-all-day]"); if (allDay) allDay.checked = Boolean(normalized.allDay);
    const excluded = root?.querySelector?.("[data-ev-excluded]"); if (excluded) excluded.value = (normalized.excludedDates || []).join(", ");
    for (const field of Array.from(root?.querySelectorAll?.("[data-ev-weekday]") || [])) field.checked = (normalized.repeatWeekdays || []).includes(Number(field.value));
    if (root?.querySelector?.("[data-form-title]")) root.querySelector("[data-form-title]").textContent = "Редактирование события";
    if (root?.querySelector?.("[data-save-event]")) root.querySelector("[data-save-event]").textContent = "Сохранить";
  }
  function clearCalendarEventForm(root, selectedDate = "") {
    fillCalendarEventForm(root, { title: "", date: selectedDate, endDate: selectedDate, start: "09:00", end: "10:00", category: "work", repeat: "none", reminder: "15" });
    if (root?.querySelector?.("[data-form-title]")) root.querySelector("[data-form-title]").textContent = "Новое событие";
    if (root?.querySelector?.("[data-save-event]")) root.querySelector("[data-save-event]").textContent = "Добавить";
  }

  function saveCalendarEventFromForm(root, calendar = {}, events = []) {
    const data = calendarEventFormData(root, {
      id: calendar.editing || uid("event"),
      fallbackDate: calendar.selected
    });
    if (!data.title) return { saved: false, reason: "missing-title", calendar };
    if (calendar.editing && !events.some(event => event.id === calendar.editing)) {
      return { saved: false, reason: "missing-event", calendar };
    }
    if (!calendar.editing && data.date < localTodayISO()) {
      return { saved: false, reason: "past-date", calendar };
    }
    const event = upsertCalendarEvent(events, data, calendar.editing);
    const nextCalendar = { ...calendar, selected: event.date, date: event.date, editing: null };
    clearCalendarEventForm(root, nextCalendar.selected);
    return { saved: true, event, calendar: nextCalendar };
  }

  function fillCalendarEventFormById(root, events = [], id = "", calendar = {}) {
    const event = (Array.isArray(events) ? events : []).find(item => item.id === id);
    if (!event) return { found: false, calendar };
    fillCalendarEventForm(root, event);
    return { found: true, event, calendar: { ...calendar, editing: id } };
  }

  function clearCalendarEventEditing(root, calendar = {}) {
    const nextCalendar = { ...calendar, editing: null };
    clearCalendarEventForm(root, nextCalendar.selected);
    return nextCalendar;
  }

  function createCalendarApp(integration = {}) {
    const { document, desktopTitle = "Рабочий стол", getCalendar = () => ({}), setCalendar = () => {}, getWeekStart = () => "monday", getEvents = () => [], getTasks = () => [], getTaskProjects = () => [], getCategories = () => [], getCalendarPreferences = () => ({}), saveCalendarPreferences = async () => {}, saveCategory = async () => { throw new Error("Сохранение категорий недоступно"); }, deleteCategory = async () => { throw new Error("Удаление категорий недоступно"); }, resolveAttachment = () => null, openAttachment = () => {}, openTask = () => {}, openProjectCreator = () => { throw new Error("Создание проектов недоступно"); }, openProjectSettings = () => { throw new Error("Настройки проекта недоступны"); }, startEventTimer = async () => {}, openEventEditor = () => {}, saveEventRecord = async () => { throw new Error("Сохранение недоступно"); }, removeEvent = async () => { throw new Error("Сохранение недоступно"); }, onEventSaved = () => {}, refreshOpenCalendars = () => {}, renderNotifications = () => {}, toast = () => {}, confirmUser = () => false, downloadFile = () => {}, todayISO = localTodayISO, formatDate = value => String(value || "") } = integration;
    const root = document.createElement("div"); root.className = "calendar-app"; root.innerHTML = calendarShellHTML(desktopTitle);
    let filters = { query: "", category: "", project: "" }, deleting = false, moving = false, pointer = null, suppressClick = false, pendingDelete = null;
    const find = selector => root.querySelector(selector), selected = () => getCalendar().selected || getCalendar().date || todayISO();
    root.addEventListener("toggle", event => {
      if (!event.target?.open) return;
      if (event.target.matches?.(".calendar-category-creator")) {
        find(".calendar-category-manager").open = false;
        find("[data-new-category-name]").focus();
      }
      if (event.target.matches?.(".calendar-category-manager")) {
        if (find(".calendar-category-settings-trigger")?.getAttribute("aria-disabled") === "true") { event.target.open = false; return; }
        find(".calendar-category-creator").open = false;
        loadSelectedCategory();
        if (categoryOriginal) find("[data-category-name]").focus();
      }
    }, true);
    const initialView = integration.initialView || getCalendarPreferences().view;
    if (["month", "week", "day", "agenda"].includes(initialView)) setCalendar({ ...getCalendar(), view: initialView });
    let agendaFrom = selected(), agendaTo = calendarDateAdd(agendaFrom, 30), preferenceBusy = false, categoryBusy = false, categoryOriginal = null;
    let categorySelectionId = null, categoryWriter = null, categorySaveTimer = null, categoryLastQueued = "";
    const categorySettingsUnsaved = () => Boolean(categorySaveTimer || categoryWriter?.getState().dirty || categoryWriter?.getState().pending);
    const categoryDraft = () => ({ name: find("[data-category-name]").value, color: find("[data-category-color]").value, description: find("[data-category-description]").value, icon: find("[data-category-icon]").value });
    const showCategorySaveState = () => {
      const state = categoryWriter?.getState();
      if (!state) return;
      const busy = categorySettingsUnsaved();
      find("[data-category-status]").textContent = state.error ? `${state.error.message || "Не удалось сохранить."} Ввод сохранён для повтора.` : state.pending ? "Сохранение…" : categorySaveTimer || state.dirty ? "Ожидание сохранения…" : state.lastSavedAt ? "Сохранено" : "Изменения сохраняются автоматически.";
      find("[data-retry-category-settings]").hidden = !state.error;
      find("[data-retry-category-settings]").disabled = state.pending;
      find("[data-discard-category-settings]").hidden = !state.error;
      find("[data-discard-category-settings]").disabled = state.pending;
      find("[data-calendar-category]").disabled = categoryBusy || busy;
      find("[data-delete-category]").disabled = categoryBusy || busy;
    };
    const flushCategorySettings = () => {
      if (categorySaveTimer) clearTimeout(categorySaveTimer);
      categorySaveTimer = null;
      if (categoryWriter && categoryOriginal) {
        const draft = categoryDraft(), signature = JSON.stringify(draft);
        if (signature !== categoryLastQueued) { categoryLastQueued = signature; categoryWriter.update({ settings: draft }); }
        else showCategorySaveState();
      }
    };
    const scheduleCategorySettings = () => {
      if (!categoryWriter || categoryBusy) return;
      if (categorySaveTimer) clearTimeout(categorySaveTimer);
      categorySaveTimer = setTimeout(flushCategorySettings, 450);
      showCategorySaveState();
    };
    const loadSelectedCategory = (force = false, message = "") => {
      const fields = find("[data-category-settings-fields]");
      if (!fields || !force && categorySelectionId === filters.category) return;
      if (categorySaveTimer) clearTimeout(categorySaveTimer);
      categorySaveTimer = null; categoryWriter = null;
      categorySelectionId = filters.category;
      const category = getCategories().find(item => item.id === filters.category);
      categoryOriginal = category ? JSON.parse(JSON.stringify(category)) : null;
      fields.hidden = !category;
      find("[data-category-settings-info]").textContent = category ? `Выбрана категория «${category.name}».` : filters.category ? "Стандартные категории нельзя изменить или удалить." : "Выберите собственную категорию в списке рядом.";
      find("[data-category-status]").textContent = message;
      if (!category) return;
      find("[data-category-name]").value = category.name;
      find("[data-category-color]").value = category.color;
      find("[data-category-description]").value = category.description || "";
      find("[data-category-icon]").value = category.icon || "";
      const count = getEvents().filter(event => event.category === category.id).length;
      find("[data-category-delete-info]").textContent = count ? `Событий: ${count}. Выберите категорию для переноса. События и файлы сохранятся.` : "Событий в этой категории нет. Можно удалить только категорию.";
      find("[data-category-replacement]").innerHTML = `<option value="">Выберите категорию</option>${categoryOptions(getCategories().filter(item => item.id !== category.id))}`;
      const id = category.id;
      let baseline = JSON.parse(JSON.stringify(category));
      const writer = window.ZETER_PREFERENCES_WRITER_UTILS.createPreferencesWriter({
        keys: ["settings"], getPreferences: () => ({ settings: baseline }), requireAck: true,
        save: async ({ settings }) => {
          const saved = await saveCategory(settings, id, baseline);
          baseline = JSON.parse(JSON.stringify(saved));
          if (categorySelectionId === id) { categoryOriginal = JSON.parse(JSON.stringify(saved)); find("[data-category-settings-info]").textContent = `Выбрана категория «${saved.name}».`; draw(); }
          return { saved: true };
        },
        onChange: () => { if (categoryWriter === writer) showCategorySaveState(); }
      });
      categoryWriter = writer; categoryLastQueued = JSON.stringify(categoryDraft()); showCategorySaveState();
    };
    const setCategoryBusy = busy => {
      categoryBusy = busy;
      ["[data-create-category]", "[data-new-category-name]", "[data-new-category-color]", "[data-calendar-category]", "[data-category-name]", "[data-category-color]", "[data-category-description]", "[data-category-icon]", "[data-retry-category-settings]", "[data-discard-category-settings]", "[data-delete-category]", "[data-category-replacement]"].map(find).filter(Boolean).forEach(field => { field.disabled = busy; });
      if (!busy && categorySettingsUnsaved()) showCategorySaveState();
    };
    const prefs = () => ({ workStart: "09:00", workEnd: "18:00", showTaskDeadlines: true, ...getCalendarPreferences() });
    const projectOf = event => event.projectId || getTasks().find(task => task.id === event.taskId)?.projectId || "";
    const accepts = event => (!filters.category || event.category === filters.category) && (!filters.project || projectOf(event) === filters.project) && (!filters.query || [event.title, event.description, event.location, event.projectName, getTasks().find(task => task.id === event.taskId)?.title].join(" ").toLocaleLowerCase("ru-RU").includes(filters.query));
    const tasksForDate = iso => prefs().showTaskDeadlines ? getTasks().filter(task => task.due === iso && !task.indefinite && task.status !== "done" && !task.deletedAt && (!filters.project || task.projectId === filters.project) && !filters.category && (!filters.query || String(task.title || "").toLocaleLowerCase("ru-RU").includes(filters.query))) : [];
    const draw = (options = {}) => {
      const calendar = getCalendar(), preferences = prefs(), weekStart = getWeekStart(), current = { ...calendar, date: calendar.date || selected(), selected: selected(), view: calendar.view || preferences.view || "month" };
      if (filters.project && !getTaskProjects().some(project => project.id === filters.project)) filters.project = "";
      if (filters.category && !["work", "personal", "health", "important"].includes(filters.category) && !getCategories().some(category => category.id === filters.category)) filters.category = "";
      const projectSelect = find("[data-calendar-project]"), categorySelect = find("[data-calendar-category]");
      if (projectSelect) { projectSelect.innerHTML = `<option value="">Все проекты</option>${getTaskProjects().map(project => `<option value="${safeAttr(project.id)}">${escapeHtml(project.name || "Проект")}</option>`).join("")}`; projectSelect.value = filters.project; }
      if (categorySelect) { categorySelect.innerHTML = `<option value="">Все категории</option>${categoryOptions(getCategories())}`; categorySelect.value = filters.category; }
      const projectSettings = find("[data-project-settings]");
      if (projectSettings) { projectSettings.disabled = !getTaskProjects().some(project => project.id === filters.project); projectSettings.title = projectSettings.disabled ? "Выберите проект в списке" : "Настройки выбранного проекта"; }
      const categorySettings = find(".calendar-category-settings-trigger");
      if (categorySettings) {
        const available = getCategories().some(category => category.id === filters.category);
        categorySettings.setAttribute("aria-disabled", String(!available));
        categorySettings.tabIndex = available ? 0 : -1;
        categorySettings.title = available ? "Настройки выбранной категории" : filters.category ? "Стандартные категории нельзя изменить или удалить" : "Выберите собственную категорию в списке";
        if (!available) find(".calendar-category-manager").open = false;
      }
      loadSelectedCategory();
      if (find("[data-work-start]")) find("[data-work-start]").value = preferences.workStart;
      if (find("[data-work-end]")) find("[data-work-end]").value = preferences.workEnd;
      if (find("[data-show-deadlines]")) find("[data-show-deadlines]").checked = preferences.showTaskDeadlines;
      if (find("[data-agenda-from]")) find("[data-agenda-from]").value = agendaFrom;
      if (find("[data-agenda-to]")) find("[data-agenda-to]").value = agendaTo;
      const allEventsForDate = iso => calendarEventsForDate(getEvents(), iso);
      const filteredEvents = getEvents().map(event => normalizeCalendarEvent({ ...event })).filter(accepts);
      renderCalendarAppView(root, current, { preserveMonth: options.preserveMonth, title: current.view === "agenda" ? "Повестка" : calendarTitleText(current, formatDate, weekStart), weekStart, todayISOValue: todayISO(), events: getEvents(), eventsForDate: iso => allEventsForDate(iso).filter(accepts), allEventsForDate, tasksForDate, agendaEvents: calendarOccurrences(filteredEvents, agendaFrom, agendaTo, { limit: 5000 }), upcoming: calendarOccurrences(filteredEvents, calendarDateAdd(current.selected, 1), calendarDateAdd(current.selected, 30), { limit: 5000 }), preferences, categories: getCategories(), resolveAttachment, filtered: Boolean(filters.query || filters.category || filters.project), formatDate });
    };
    const status = message => { const el = find("[data-calendar-status]"); if (el) el.textContent = message; };
    const selectDay = (day, focus = false) => {
      const previous = getCalendar(), preserveMonth = previous.view === "month" && String(previous.date || "").slice(0, 7) === day.slice(0, 7);
      setCalendar({ ...previous, selected: day, date: day }); draw({ preserveMonth });
      if (focus) find(`[data-day="${day}"]`)?.focus?.();
    };
    const create = (date = selected(), initialEvent = {}) => {
      if (date < localTodayISO()) { toast("Дата уже прошла", "Новое событие можно добавить только на сегодня или будущую дату."); return; }
      selectDay(date); openEventEditor({ mode: "create", date, initialEvent });
    };
    const saved = () => { onEventSaved(); draw(); refreshOpenCalendars(); renderNotifications(); };
    const savePreferences = async patch => {
      if (preferenceBusy) return false; preferenceBusy = true; status("Сохраняем параметры…");
      const preferenceFields = ["[data-view]", "[data-work-start]", "[data-work-end]", "[data-show-deadlines]"].map(find).filter(Boolean); preferenceFields.forEach(field => { field.disabled = true; });
      try { await saveCalendarPreferences(patch); status(""); return true; }
      catch (error) { status(`Параметры не сохранены: ${error.message || "повторите изменение"}`); toast("Не удалось сохранить параметры", "Повторите выбор. Прежние параметры сохранены."); return false; }
      finally { preferenceBusy = false; preferenceFields.forEach(field => { field.disabled = false; }); }
    };
    const findOccurrence = (id, date) => calendarOccurrences(getEvents().filter(event => event.id === id), date || selected(), date || selected()).find(event => event.occurrenceDate === (date || selected()));
    const remove = async (id, occurrenceDate, scope = "all") => {
      const original = getEvents().find(event => event.id === id); if (!original || deleting) return;
      if (!confirmUser(scope === "one" ? "Удалить только это вхождение?" : scope === "future" ? "Удалить это и последующие вхождения?" : "Удалить событие целиком, включая повторы?")) return;
      deleting = true;
      try { await removeEvent(id, { scope, occurrenceDate }, JSON.parse(JSON.stringify(original))); pendingDelete = null; saved(); }
      catch (error) { toast("Не удалось удалить событие", error.message || "Повторите попытку."); }
      finally { deleting = false; }
    };
    root.addEventListener("click", async event => {
      if (suppressClick) { suppressClick = false; return; }
      if (event.target?.closest?.('.calendar-category-settings-trigger[aria-disabled="true"]')) { event.preventDefault(); return; }
      if (event.target?.closest?.("[data-project-settings]")) {
        if (!filters.project) return;
        try { openProjectSettings(filters.project, () => draw()); }
        catch (error) { toast("Не удалось открыть настройки проекта", error.message); }
        return;
      }
      if (event.target?.closest?.("[data-create-project]")) {
        try { openProjectCreator(project => { filters.project = project.id; draw(); }); }
        catch (error) { toast("Не удалось создать проект", error.message); }
        return;
      }
      if (event.target?.closest?.("[data-create-category]")) {
        if (categoryBusy) return;
        const name = find("[data-new-category-name]").value.trim(), color = find("[data-new-category-color]").value;
        if (!name) { find("[data-category-create-status]").textContent = "Введите название категории."; find("[data-new-category-name]").focus(); return; }
        setCategoryBusy(true);
        try { await saveCategory({ name, color }, "", null); find("[data-new-category-name]").value = ""; find("[data-category-create-status]").textContent = "Категория создана."; draw(); }
        catch (error) { find("[data-category-create-status]").textContent = error.message || "Не удалось создать категорию. Ввод сохранён для повтора."; }
        finally { setCategoryBusy(false); }
        return;
      }
      if (event.target?.closest?.("[data-retry-category-settings]")) { if (categoryWriter) { if (categorySaveTimer) flushCategorySettings(); categoryWriter.retry(); } return; }
      if (event.target?.closest?.("[data-discard-category-settings]")) {
        if (!categoryBusy && categoryWriter?.discard()) { loadSelectedCategory(true); showCategorySaveState(); }
        return;
      }
      if (event.target?.closest?.("[data-delete-category]")) {
        if (categoryBusy || categorySettingsUnsaved() || !categoryOriginal) return;
        const original = JSON.parse(JSON.stringify(categoryOriginal)), replacementId = find("[data-category-replacement]").value;
        if (getEvents().some(event => event.category === original.id) && !replacementId) {
          find("[data-category-status]").textContent = "Выберите, в какую категорию перенести события. События не будут удалены.";
          find("[data-category-replacement]").focus(); return;
        }
        const consequence = replacementId ? `Все её события будут перенесены в «${categoryName(replacementId, getCategories())}».` : "Связанных событий нет.";
        if (!confirmUser(`Удалить категорию «${original.name}»?\n${consequence}\nСобытия и файлы не удаляются.`)) return;
        setCategoryBusy(true);
        try {
          await deleteCategory(original.id, replacementId, original);
          if (filters.category === original.id) filters.category = "";
          loadSelectedCategory(true, "Категория удалена. События сохранены."); draw();
        } catch (error) { find("[data-category-status]").textContent = error.message || "Не удалось удалить категорию. Повторите попытку."; }
        finally { setCategoryBusy(false); }
        return;
      }
      const attachment = event.target?.closest?.("[data-open-attachment]"); if (attachment) { try { await openAttachment({ kind: "fs", id: attachment.dataset.openAttachment }); } catch (error) { toast("Файл недоступен", error.message); } return; }
      const task = event.target?.closest?.("[data-open-task]"); if (task) { try { await openTask(task.dataset.openTask); } catch (error) { toast("Задача недоступна", error.message || "Откройте календарь заново."); } return; }
      const timer = event.target?.closest?.("[data-start-event-timer]"); if (timer) { if (timer.disabled) return; const occurrence = findOccurrence(timer.dataset.startEventTimer, timer.dataset.occurrenceDate); if (!occurrence) return; timer.disabled = true; try { await startEventTimer(occurrence); } catch (error) { toast("Таймер не запущен", error.message || "Повторите попытку."); } finally { timer.disabled = false; } return; }
      const free = event.target?.closest?.("[data-free-date]"); if (free) { const start = Number(free.dataset.freeStart), end = Math.min(Number(free.dataset.freeEnd), start + 60); create(free.dataset.freeDate, { date: free.dataset.freeDate, endDate: end === 1440 ? calendarDateAdd(free.dataset.freeDate, 1) : free.dataset.freeDate, start: timeText(start), end: end === 1440 ? "00:00" : timeText(end) }); return; }
      const scopeButton = event.target?.closest?.("[data-delete-scope]"); if (scopeButton && pendingDelete) { const target = pendingDelete; await remove(target.id, target.occurrenceDate, scopeButton.dataset.deleteScope); return; }
      if (event.target?.closest?.("[data-cancel-delete-scope]")) { pendingDelete = null; draw(); return; }
      const action = calendarClickAction(event.target); if (!action) return;
      if (action.type === "move") { const calendar = moveCalendarState(getCalendar(), action.action); setCalendar(calendar); if (calendar.view === "agenda") { agendaFrom = calendar.date; agendaTo = calendarDateAdd(agendaFrom, 30); } draw(); return; }
      if (action.type === "select-day") { selectDay(action.day); return; }
      if (action.type === "add-event") { create(action.date || selected()); return; }
      if (action.type === "edit-event") { openEventEditor({ mode: "edit", eventId: action.eventId, occurrenceDate: action.occurrenceDate }); return; }
      if (action.type === "delete-event") {
        const original = getEvents().find(item => item.id === action.eventId);
        if (original && normalizeCalendarRepeat(original.repeat) !== "none") {
          root.querySelectorAll(".calendar-delete-scopes").forEach(menu => menu.remove());
          pendingDelete = { id: action.eventId, occurrenceDate: action.occurrenceDate };
          const host = event.target.closest?.(".event-card");
          if (host && !host.querySelector("[data-delete-scope]")) host.insertAdjacentHTML("beforeend", '<div class="calendar-delete-scopes" role="group" aria-label="Удаление повтора"><button type="button" data-delete-scope="one">Это вхождение</button><button type="button" data-delete-scope="future">Это и последующие</button><button type="button" data-delete-scope="all">Всю серию</button><button type="button" data-cancel-delete-scope>Отмена</button></div>');
        } else await remove(action.eventId, action.occurrenceDate);
        return;
      }
      if (action.type === "export-events") downloadFile("zeter_calendar_events.json", JSON.stringify(getEvents(), null, 2), "application/json");
    });
    root.addEventListener("dblclick", event => { if (event.target?.closest?.("[data-edit-event],button,input,select")) return; const cell = event.target?.closest?.("[data-day]"); if (cell) create(cell.dataset.day); });
    root.addEventListener("input", event => {
      if (event.target?.matches?.("[data-category-name],[data-category-description],[data-category-color],[data-category-icon]")) { scheduleCategorySettings(); return; } if (event.target?.matches?.("[data-calendar-search]")) { filters.query = event.target.value.trim().toLocaleLowerCase("ru-RU"); draw(); } });
    root.addEventListener("change", async event => {
      const target = event.target, action = calendarChangeAction(target);
      if (target?.matches?.("[data-category-name],[data-category-description],[data-category-color],[data-category-icon]")) { flushCategorySettings(); return; }
      if (action) { if (preferenceBusy) { draw(); return; } const previous = getCalendar().view; setCalendar({ ...getCalendar(), view: action.view }); draw(); const accepted = await savePreferences({ view: action.view }); if (!accepted) setCalendar({ ...getCalendar(), view: previous }); draw(); return; }
      if (target?.matches?.("[data-calendar-category]")) { if (categoryBusy || categorySettingsUnsaved()) { target.value = filters.category; return; } filters.category = target.value; draw(); }
      if (target?.matches?.("[data-calendar-project]")) { filters.project = target.value; draw(); }
      if (target?.matches?.("[data-show-deadlines]")) { await savePreferences({ showTaskDeadlines: target.checked }); draw(); }
      if (target?.matches?.("[data-work-start],[data-work-end]")) {
        const start = find("[data-work-start]")?.value, end = find("[data-work-end]")?.value;
        if (calendarTimeMinutes(start) === null || calendarTimeMinutes(end) === null || start >= end) { status("Рабочие часы: окончание должно быть позже начала."); return; }
        await savePreferences({ workStart: start, workEnd: end }); draw();
      }
      if (target?.matches?.("[data-agenda-from],[data-agenda-to]")) {
        const from = find("[data-agenda-from]")?.value, to = find("[data-agenda-to]")?.value;
        if (!calendarUtils.isCalendarDate(from) || !calendarUtils.isCalendarDate(to) || to < from || to > calendarDateAdd(from, 365)) { status("Выберите период от 1 до 366 дней."); return; }
        agendaFrom = from; agendaTo = to; status(""); draw();
      }
    });
    root.addEventListener("keydown", event => {
      if (["Enter", " "].includes(event.key) && event.target?.closest?.('.calendar-category-settings-trigger[aria-disabled="true"]')) { event.preventDefault(); return; }
      const timed = event.target?.closest?.(".calendar-timed-event"); if (timed && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openEventEditor({ mode: "edit", eventId: timed.dataset.editEvent, occurrenceDate: timed.dataset.occurrenceDate }); return; }
      const cell = event.target?.closest?.(".day-cell");
      if (cell && !event.target?.closest?.("button,input,select,textarea")) {
        const shift = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (shift) { event.preventDefault(); selectDay(calendarDateAdd(cell.dataset.day, shift), true); return; }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); create(cell.dataset.day); return; }
      }
      const slot = event.target?.closest?.("[data-time-slot]"); if (slot && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); const start = Number(slot.dataset.timeSlot), end = Math.min(start + 60, 1440); create(slot.dataset.slotDate, { date: slot.dataset.slotDate, endDate: end === 1440 ? calendarDateAdd(slot.dataset.slotDate, 1) : slot.dataset.slotDate, start: timeText(start), end: end === 1440 ? "00:00" : timeText(end) }); return; }
      const action = calendarKeyAction(event); if (action) { event.preventDefault(); selectDay(action.day, true); }
    });
    const minuteAt = (track, y) => Math.max(0, Math.min(1440, Math.round((y - track.getBoundingClientRect().top) / 30) * 30));
    // Status text can move the grid while a gesture is in progress. Keep the
    // original time origin; only pointer movement and intentional scroll count.
    const pointerMinuteDelta = (gesture, y) => Math.round((y - gesture.y + (gesture.scrollHost?.scrollTop || 0) - gesture.scrollStart) / 30) * 30;
    const pointerMinute = (gesture, y) => Math.max(0, Math.min(1440, gesture.minute + pointerMinuteDelta(gesture, y)));
    root.addEventListener("pointerdown", event => {
      if (event.target?.closest?.('.calendar-category-settings-trigger[aria-disabled="true"]')) { event.preventDefault(); return; }
      if (event.button !== 0 || moving) return;
      const track = event.target?.closest?.("[data-time-day]"); if (!track) return;
      const card = event.target?.closest?.(".calendar-timed-event"), occurrence = card ? findOccurrence(card.dataset.editEvent, card.dataset.occurrenceDate) : null;
      if (card && !occurrence) return;
      const original = card ? getEvents().find(item => item.id === card.dataset.editEvent) : null;
      const scrollHost = track.closest?.(".calendar-board");
      pointer = { id: event.pointerId, track, scrollHost, scrollStart: scrollHost?.scrollTop || 0, date: track.dataset.timeDay, minute: minuteAt(track, event.clientY), x: event.clientX, y: event.clientY, occurrence, original: original ? JSON.parse(JSON.stringify(original)) : null, resize: Boolean(event.target.closest?.("[data-resize-event]")), changed: false };

    });
    root.addEventListener("pointermove", event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (Math.abs(event.clientY - pointer.y) + Math.abs(event.clientX - pointer.x) < 5) return;
      if (!pointer.changed) root.setPointerCapture?.(event.pointerId);
      pointer.changed = true; event.preventDefault();
      if (!pointer.occurrence) {
        let overlay = pointer.track.querySelector(".calendar-range-selection"); if (!overlay) { overlay = document.createElement("div"); overlay.className = "calendar-range-selection"; pointer.track.appendChild(overlay); }
        const end = pointerMinute(pointer, event.clientY); overlay.style.top = `${Math.min(end, pointer.minute)}px`; overlay.style.height = `${Math.max(30, Math.abs(end - pointer.minute))}px`; overlay.textContent = `${timeText(Math.min(end, pointer.minute))}–${timeText(Math.max(end, pointer.minute))}`;
      } else status(pointer.resize ? "Изменение длительности · отпустите для сохранения" : "Перенос события · отпустите для сохранения");
    });
    const clearPointer = () => { if (!pointer) return; pointer.track.querySelector(".calendar-range-selection")?.remove(); try { root.releasePointerCapture?.(pointer.id); } catch (_) { /* Capture may have ended when the window closed. */ } pointer = null; };
    root.addEventListener("pointercancel", () => { clearPointer(); status(""); });
    root.addEventListener("pointerup", async event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const current = pointer, hit = document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.("[data-time-day]") || current.track, endMinute = pointerMinute(current, event.clientY); clearPointer();
      if (!current.changed) return; suppressClick = true;
      if (!current.occurrence) {
        const start = Math.min(current.minute, endMinute), end = Math.max(current.minute, endMinute); if (end <= start || start >= 1440) return;
        create(current.date, { date: current.date, endDate: end === 1440 ? calendarDateAdd(current.date, 1) : current.date, start: timeText(start), end: end === 1440 ? "00:00" : timeText(end) }); return;
      }
      const occurrence = current.occurrence, draft = { ...occurrence }, duration = calendarEventDurationMinutes(occurrence);
      if (current.resize) {
        const offset = Math.round((Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${occurrence.date}T00:00:00Z`)) / 86400000), length = offset * 1440 + endMinute - (calendarTimeMinutes(occurrence.start) || 0);
        if (length <= 0) { status("Окончание должно быть позже начала. Даты также можно изменить в редакторе."); return; }
        draft.endDate = endMinute === 1440 ? calendarDateAdd(current.date, 1) : current.date; draft.end = endMinute === 1440 ? "00:00" : timeText(endMinute);
      } else {
        const delta = pointerMinuteDelta(current, event.clientY), base = (calendarTimeMinutes(occurrence.start) || 0) + delta;
        const dateDelta = Math.round((Date.parse(`${hit.dataset.timeDay}T00:00:00Z`) - Date.parse(`${current.date}T00:00:00Z`)) / 86400000);
        draft.date = calendarDateAdd(occurrence.date, dateDelta + Math.floor(base / 1440)); const start = (base % 1440 + 1440) % 1440;
        draft.start = timeText(start); draft.endDate = calendarDateAdd(draft.date, Math.floor((start + duration) / 1440)); draft.end = timeText((start + duration) % 1440);
      }
      if (normalizeCalendarRepeat(current.original.repeat) !== "none") { status(""); openEventEditor({ mode: "edit", eventId: current.original.id, occurrenceDate: occurrence.occurrenceDate, scope: "one", initialEvent: draft }); return; }
      moving = true; status("Сохраняем событие… Прежнее положение сохранится до подтверждения.");
      try { await saveEventRecord(draft, current.original.id, current.original, { scope: "all", occurrenceDate: occurrence.occurrenceDate }); status(""); saved(); }
      catch (error) { status("Перенос не сохранён. В редакторе сохранён новый вариант для повтора."); toast("Не удалось сохранить событие", error.message || "Повторите в редакторе."); openEventEditor({ mode: "edit", eventId: current.original.id, occurrenceDate: occurrence.occurrenceDate, initialEvent: draft }); }
      finally { moving = false; }
    });
    draw();
    root.refreshCalendar = () => draw();
    const updateNow = () => {
      if (!root.isConnected) return;
      const minute = new Date().getHours() * 60 + new Date().getMinutes();
      for (const line of root.querySelectorAll(".calendar-now")) line.style.top = `${minute}px`;
      setTimeout(updateNow, 60000);
    };
    setTimeout(updateNow, 0);
    return root;
  }

  function createCalendarEventEditorApp(params = {}, winId = "", integration = {}) {
    const { document, getCalendar = () => ({}), setCalendar = () => {}, getEvents = () => [], getTasks = () => [], getTaskProjects = () => [], getCategories = () => [], getAttachmentCandidates = () => [], resolveAttachment = () => null, openAttachment = () => {}, canUploadEventFiles = () => false, importEventFiles = async () => { throw new Error("Загрузка с компьютера доступна в Windows/Python. Выберите файл из рабочего стола."); }, renderNotifications = () => {}, refreshOpenCalendars = () => {}, closeWindow = () => {}, toast = () => {}, todayISO = localTodayISO, objectLinksPanelFor = null, saveNewPlan = null, saveEventRecord = async () => { throw new Error("Сохранение календаря недоступно."); }, onEventSaved = () => {}, onPlanSaved = () => {} } = integration;
    const root = document.createElement("div"); root.className = "calendar-event-editor-app";
    const find = selector => root.querySelector(selector), editingId = String(params.eventId || "");
    const originalEvent = editingId ? JSON.parse(JSON.stringify(getEvents().find(item => item.id === editingId) || null)) : null;
    const planning = Boolean(params.timeTrackingPlan && !editingId && typeof saveNewPlan === "function"), repeated = originalEvent && normalizeCalendarRepeat(originalEvent.repeat) !== "none";
    let uploadSelection = [];
    let busy = false, accepted = false, importing = false, attachments = JSON.parse(JSON.stringify((params.initialEvent || originalEvent)?.attachments || [])), scope = repeated && ["one", "future"].includes(params.scope) ? params.scope : "all";
    const selectedDate = params.date || getCalendar().selected || todayISO(), occurrenceDate = params.occurrenceDate || originalEvent?.date || selectedDate;
    const closeEditor = () => { if (!busy && !importing) closeWindow(winId); };
    root.innerHTML = planning ? calendarTimePlanEditorHTML() : calendarEventEditorHTML();
    if (editingId && !originalEvent) {
      root.innerHTML = calendarEventEditorMissingHTML(); root.addEventListener("click", event => { if (calendarEventEditorClickAction(event.target)?.type === "cancel") closeEditor(); }); return root;
    }
    const categories = getCategories(), categorySelect = find("[data-ev-category]");
    if (categorySelect) { categorySelect.innerHTML = categoryOptions(categories); const initialCategory = (params.initialEvent || originalEvent)?.category; if (initialCategory && !["work", "personal", "health", "important", ...categories.map(item => item.id)].includes(initialCategory)) categorySelect.innerHTML += `<option value="${safeAttr(initialCategory)}">Категория недоступна</option>`; }
    const taskSelect = find("[data-ev-task]");
    if (taskSelect) {
      taskSelect.innerHTML = `<option value="">Без привязки к задаче</option>${getTasks().filter(task => !task.deletedAt).map(task => `<option value="${safeAttr(task.id)}">${escapeHtml(task.title)} · ${escapeHtml(getTaskProjects().find(project => project.id === task.projectId)?.name || "Без проекта")}${task.status === "done" ? " · завершена" : ""}</option>`).join("")}`;
      const bound = (params.initialEvent || originalEvent)?.taskId; if (bound && !getTasks().some(task => task.id === bound)) taskSelect.innerHTML += `<option value="${safeAttr(bound)}">Задача недоступна</option>`;
    }
    const occurrence = repeated ? calendarOccurrences([originalEvent], occurrenceDate, occurrenceDate).find(item => item.occurrenceDate === occurrenceDate) : originalEvent;
    const base = editingId ? originalEvent : { date: selectedDate, endDate: selectedDate, title: "", start: "09:00", end: "10:00", repeat: "none", category: "work", reminder: planning ? "0" : "15" };
    fillCalendarEventForm(root, { ...base, ...(scope !== "all" ? occurrence : {}), ...(params.initialEvent || {}) });
    if (!editingId) { if (find("[data-form-title]")) find("[data-form-title]").textContent = planning ? "Запланировать занятие" : "Новое событие"; if (find("[data-save-event]")) find("[data-save-event]").textContent = planning ? "Сохранить план в календаре" : "Добавить"; find("[data-ev-date]").min = localTodayISO(); }
    if (repeated) { if (find("[data-series-scope-label]")) find("[data-series-scope-label]").hidden = false; if (find("[data-ev-scope]")) find("[data-ev-scope]").value = scope; }
    const editorStatus = message => { const node = find(planning ? "[data-plan-status]" : "[data-event-status]"); if (node) node.textContent = message; };
    const updateDetails = () => {
      const categoryColorValue = categoryColor(find("[data-ev-category]")?.value, getCategories());
      if (categorySelect?.style) categorySelect.style.borderLeftColor = categoryColorValue;
      const draft = calendarEventFormData(root), allDay = Boolean(find("[data-ev-all-day]")?.checked), repeat = draft.repeat;
      const singleOccurrence = repeated && scope === "one";
      if (find("[data-time-fields]")) find("[data-time-fields]").hidden = allDay;
      if (find("[data-ev-repeat]")) find("[data-ev-repeat]").disabled = Boolean(singleOccurrence);
      if (find(".calendar-repeat-settings")) find(".calendar-repeat-settings").hidden = singleOccurrence || repeat === "none";
      if (find("[data-repeat-weekdays]")) find("[data-repeat-weekdays]").hidden = repeat !== "weekly";
      if (find("[data-ev-duration]")) find("[data-ev-duration]").textContent = `Длительность: ${durationText(calendarEventDurationMinutes(draft))}${draft.endDate !== draft.date ? " · несколько дней" : ""}`;
      const context = find("[data-series-context]"); if (context && repeated) { context.hidden = false; context.textContent = scope === "all" ? `Вся серия: даты ниже относятся к исходному событию ${originalEvent.date}. Выбрано вхождение ${occurrenceDate}.` : `${scope === "one" ? "Только вхождение" : "Это и последующие вхождения"} ${occurrenceDate}. Исходная серия сохранится до подтверждения.`; }
    };
    const renderAttachments = () => {
      const host = find("[data-ev-attachments]"); if (host) host.innerHTML = attachments.length ? attachments.map(ref => { const file = resolveAttachment(ref) || getAttachmentCandidates().find(item => item.id === ref.id); return `<div class="calendar-attachment-row"><button type="button" data-open-attachment="${safeAttr(ref.id)}" ${file ? "" : "disabled"}>▧ ${escapeHtml(file?.title || "Файл недоступен")}</button><button type="button" data-remove-attachment="${safeAttr(ref.id)}" aria-label="Снять вложение ${safeAttr(file?.title || "файл")}">Снять</button></div>`; }).join("") : '<p class="muted">Пока нет вложений.</p>';
      const picker = find("[data-ev-file]"); if (picker) picker.innerHTML = `<option value="">Выберите материал</option>${getAttachmentCandidates().filter(item => item.kind === "fs" && !attachments.some(ref => ref.id === item.id)).map(item => `<option value="${safeAttr(item.id)}">${escapeHtml(item.title || item.id)}</option>`).join("")}`;
    };
    const appendAttachments = refs => { for (const ref of refs || []) if (ref?.kind === "fs" && /^[A-Za-z0-9_-]{1,220}$/.test(ref.id || "") && !attachments.some(item => item.id === ref.id)) { if (attachments.length >= 200) throw new Error("Можно прикрепить не больше 200 файлов."); attachments.push({ kind: "fs", id: ref.id }); } renderAttachments(); };
    const upload = find("[data-ev-upload]"); if (upload && !canUploadEventFiles()) { upload.disabled = true; upload.title = "Загрузка с компьютера доступна в Windows/Python. Выберите файл из рабочего стола."; const label = upload.closest?.("label"); if (label) label.insertAdjacentHTML("beforeend", '<small>Загрузка с компьютера доступна в Windows/Python. В браузере выберите материал рабочего стола.</small>'); }
    if (typeof objectLinksPanelFor === "function" && editingId) mountCalendarObjectLinksPanel(root, objectLinksPanelFor({ kind: "event", id: editingId }));
    const importSelected = async () => {
      if (!uploadSelection.length || importing || busy) return;
      // The adapter caches each File identity after ACK, so explicit retry cannot duplicate successful materials.
      if (attachments.length + uploadSelection.length > 200) { editorStatus("Можно прикрепить не больше 200 файлов. Снимите лишние вложения перед загрузкой."); return; }
      importing = true; editorStatus("Сохраняем файлы в материалы рабочего стола…");
      try { appendAttachments(await importEventFiles(uploadSelection)); uploadSelection = []; if (upload) upload.value = ""; if (find("[data-retry-upload]")) find("[data-retry-upload]").hidden = true; editorStatus("Файлы сохранены в материалах. При отмене события они останутся на рабочем столе."); }
      catch (error) { if (Array.isArray(error.attachments)) { appendAttachments(error.attachments); uploadSelection = uploadSelection.slice(error.attachments.length); } if (find("[data-retry-upload]")) find("[data-retry-upload]").hidden = false; editorStatus(`${error.message || "Не удалось загрузить файлы."} Сохранённые файлы уже прикреплены; выбор оставлен для явного повтора.`); }
      finally { importing = false; }
    };
    const dateDrafts = new Map();
    root.addEventListener("change", async event => {
      if (event.target?.matches?.("[data-ev-scope]") && repeated) {
        const current = calendarEventFormData(root); dateDrafts.set(scope, { date: current.date, endDate: current.endDate, start: current.start, end: current.end }); scope = event.target.value;
        const next = dateDrafts.get(scope) || (scope === "all" ? originalEvent : occurrence || originalEvent);
        for (const [key, selector] of Object.entries({ date: "date", endDate: "end-date", start: "start", end: "end" })) { const field = find(`[data-ev-${selector}]`); if (field) field.value = next[key] || next.date || ""; }
      }
      if (event.target?.matches?.("[data-ev-repeat]") && event.target.value === "weekly" && !Array.from(root.querySelectorAll("[data-ev-weekday]:checked")).length) { const weekday = parseISO(find("[data-ev-date]").value).getDay(); const field = find(`[data-ev-weekday][value="${weekday}"]`); if (field) field.checked = true; }
      if (event.target?.matches?.("[data-ev-date]") && !editingId && find("[data-ev-end-date]")?.value < event.target.value) find("[data-ev-end-date]").value = event.target.value;
      if (event.target?.matches?.("[data-ev-upload]") && !importing && !busy) { uploadSelection = Array.from(event.target.files || []); await importSelected(); return; }
      updateDetails();
    });
    root.addEventListener("input", updateDetails);
    const saveEvent = async () => {
      if (busy || accepted || importing) return;
      const draft = { ...calendarEventFormData(root), attachments: attachments.map(ref => ({ ...ref })) };
      // Hidden recurrence settings must not constrain a detached or non-repeating event.
      if (draft.repeat === "none" || repeated && scope === "one") Object.assign(draft, { repeat: "none", repeatInterval: 1, repeatWeekdays: [], repeatUntil: "", excludedDates: [] });
      const task = getTasks().find(item => item.id === draft.taskId);
      if (task && task.id !== originalEvent?.taskId) { draft.projectId = task.projectId || ""; draft.projectName = getTaskProjects().find(project => project.id === task.projectId)?.name || ""; }
      else if (!draft.taskId && originalEvent?.taskId) { draft.projectId = ""; draft.projectName = ""; }
      if (!draft.title) { toast("Нужен заголовок", "Введите название события"); find("[data-ev-title]")?.focus(); return; }
      if (!editingId && draft.date && draft.date < localTodayISO()) { toast("Дата уже прошла", "Новое событие можно добавить только на сегодня или будущую дату."); const field = find("[data-ev-date]"); field.min = localTodayISO(); field.focus(); return; }
      try { validateCalendarEventDraft(draft); } catch (error) { editorStatus(error.message); toast("Не удалось сохранить событие", error.message); return; }
      const fields = [...root.querySelectorAll("input,select,textarea,button")], disabled = fields.map(field => field.disabled); busy = true; fields.forEach(field => { field.disabled = true; }); editorStatus("Сохраняем…");
      let savedEvent;
      try { savedEvent = planning ? await saveNewPlan(draft) : await saveEventRecord(draft, editingId, originalEvent, { scope, occurrenceDate }); accepted = true; }
      catch (error) { editorStatus(error.message || "Не удалось сохранить. Ввод и вложения сохранены для повтора."); toast(planning ? "Не удалось сохранить план" : "Не удалось сохранить событие", error.message || "Ввод остался в форме. Повторите попытку."); return; }
      finally { busy = false; fields.forEach((field, index) => { field.disabled = disabled[index]; }); }
      try { if (planning) onPlanSaved(savedEvent); else onEventSaved(); setCalendar({ ...getCalendar(), selected: savedEvent.date, date: savedEvent.date, editing: null }); refreshOpenCalendars(winId); renderNotifications(); toast(planning ? "План сохранён в календаре" : "Событие сохранено", planning ? "В отработанные часы он не включён. Для работы запустите таймер." : savedEvent.title); closeEditor(); }
      catch (error) { editorStatus("Сохранено. Не удалось обновить интерфейс; повторно добавлять событие не нужно."); toast(planning ? "План сохранён" : "Событие сохранено", "Не удалось обновить интерфейс. Откройте календарь заново; повторно добавлять событие не нужно."); }
    };
    root.addEventListener("click", async event => {
      if (event.target?.closest?.("[data-retry-upload]")) { await importSelected(); return; }
      const attach = event.target?.closest?.("[data-attach-existing]"); if (attach && !busy && !importing) { const id = find("[data-ev-file]")?.value; if (id) { try { appendAttachments([{ kind: "fs", id }]); editorStatus(""); } catch (error) { editorStatus(error.message); } } return; }
      const remove = event.target?.closest?.("[data-remove-attachment]"); if (remove && !busy && !importing) { attachments = attachments.filter(ref => ref.id !== remove.dataset.removeAttachment); renderAttachments(); return; }
      const open = event.target?.closest?.("[data-open-attachment]"); if (open) { try { await openAttachment({ kind: "fs", id: open.dataset.openAttachment }); } catch (error) { editorStatus(error.message || "Файл недоступен."); } return; }
      const action = calendarEventEditorClickAction(event.target); if (action?.type === "save") return saveEvent(); if (action?.type === "cancel") closeEditor();
    });
    root.addEventListener("keydown", event => { const action = calendarEventEditorKeyAction(event); if (!action) return; event.preventDefault(); if (action.type === "save") return saveEvent(); if (action.type === "cancel") closeEditor(); });
    updateDetails(); renderAttachments();
    // Window rendering appends the returned root synchronously. Focus at that
    // mount checkpoint, before the next keyboard event; a timer may run later.
    Promise.resolve().then(() => { if (root.isConnected) find("[data-ev-title]")?.focus(); });
    return root;
  }

  window.ZETER_CALENDAR_UI_UTILS = Object.freeze({
    CALENDAR_WEEKDAY_NAMES,
    calendarShellHTML,
    calendarEventEditorHTML,
    calendarEventEditorMissingHTML,
    calendarTimePlanEditorHTML,
    mountCalendarObjectLinksPanel,
    calendarWeekdayHeaderHTML,
    calendarEventChipHTML,
    calendarMonthDayHTML,
    calendarMonthViewElement,
    calendarWeekRowHTML,
    calendarDayHourHTML,
    calendarAgendaRowHTML,
    calendarAgendaEmptyHTML,
    calendarSelectedEventCardHTML,
    calendarSelectedEmptyHTML,
    calendarWeekViewElement,
    calendarDayViewElement,
    calendarAgendaViewElement,
    calendarSelectedEventsHTML,
    renderCalendarAppView,
    calendarClickAction,
    calendarChangeAction,
    calendarKeyAction,
    calendarEventEditorClickAction,
    calendarEventEditorKeyAction,
    calendarEventFormData,
    fillCalendarEventForm,
    clearCalendarEventForm,
    saveCalendarEventFromForm,
    fillCalendarEventFormById,
    clearCalendarEventEditing,
    createCalendarApp,
    createCalendarEventEditorApp
  });
})();
