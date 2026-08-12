(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const calendarUtils = window.ZETER_CALENDAR_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS calendar UI utils require core utils.");
  if (!dataNormalizers) throw new Error("ZeTer OS calendar UI utils require data normalizers.");
  if (!calendarUtils) throw new Error("ZeTer OS calendar UI utils require calendar utils.");

  const { escapeHtml, parseISO, dateISO, pad, uid } = coreUtils;
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
    removeCalendarEventById,
    calendarTitleText,
    moveCalendarState,
    upsertCalendarEvent
  } = calendarUtils;
  const safeAttr = escapeHtml;

  const CALENDAR_WEEKDAY_NAMES = Object.freeze(["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);

  function calendarShellHTML(desktopTitle = "Рабочий стол") {
    return `
      <div class="workspace-note">Рабочий стол: <b>${escapeHtml(desktopTitle)}</b>. Календарь этого рабочего пространства отдельный.</div><div class="calendar-toolbar">
        <div class="toolbar"><button data-cal="prev">←</button><button data-cal="today">Сегодня</button><button data-cal="next">→</button><span class="calendar-title"></span></div>
        <div class="toolbar"><select data-view><option value="month">Месяц</option><option value="week">Неделя</option><option value="day">День</option><option value="agenda">Список</option></select><button data-export-events>Скачать события</button></div>
      </div>
      <div class="calendar-layout">
        <div class="calendar-board"></div>
        <aside class="calendar-side">
          <section class="side-card calendar-selected-day-card">
            <h3>События выбранного дня</h3>
            <div class="event-list" aria-live="polite"></div>
          </section>
        </aside>
      </div>`;
  }

  function calendarEventEditorHTML() {
    return `
      <section class="form-card calendar-event-editor-card">
        <h3 data-form-title>Новое событие</h3>
        <div class="form-grid">
          <input data-ev-title placeholder="Название события" autocomplete="off">
          <div class="two"><input data-ev-date type="date"><input data-ev-location placeholder="Место" autocomplete="off"></div>
          <div class="two"><input data-ev-start type="time" value="09:00"><input data-ev-end type="time" value="10:00"></div>
          <div class="two"><select data-ev-category><option value="work">Работа</option><option value="personal">Личное</option><option value="health">Здоровье</option><option value="important">Важное</option></select><select data-ev-repeat><option value="none">Без повтора</option><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option><option value="monthly">Каждый месяц</option></select></div>
          <select data-ev-reminder><option value="0">Без напоминания</option><option value="5">За 5 минут</option><option value="15" selected>За 15 минут</option><option value="60">За час</option><option value="1440">За день</option></select>
          <textarea data-ev-desc placeholder="Описание"></textarea>
          <div class="calendar-event-editor-actions">
            <button type="button" data-cancel-event-editor>Отмена</button>
            <button type="button" class="app-btn primary" data-save-event>Добавить</button>
          </div>
        </div>
      </section>`;
  }

  function calendarEventEditorMissingHTML() {
    return `<section class="form-card calendar-event-editor-card"><h3>Событие не найдено</h3><p class="muted">Оно могло быть удалено в другом окне.</p><button type="button" data-cancel-event-editor>Закрыть</button></section>`;
  }

  function calendarWeekdayHeaderHTML(name) {
    return `<div class="weekday">${escapeHtml(name)}</div>`;
  }

  function calendarEventChipHTML(event = {}, options = {}) {
    const category = normalizeCalendarCategory(event.category);
    const time = options.showEnd ? `${escapeHtml(event.start)}–${escapeHtml(event.end)}` : escapeHtml(event.start || "");
    return `<span class="event-chip ${category}">${time} ${escapeHtml(event.title)}</span>`;
  }

  function calendarMonthDayHTML(dayNumber, events = [], options = {}) {
    const maxEvents = 2;
    const chips = events.slice(0, maxEvents).map(event => calendarEventChipHTML(event)).join("");
    const more = events.length > maxEvents ? `<span class="event-chip">+${events.length - maxEvents}</span>` : "";
    const addButton = `<button type="button" class="calendar-add-event" data-add-event="${safeAttr(options.date || "")}">Добавить событие</button>`;
    return `<span class="day-number">${escapeHtml(dayNumber)}</span>${chips}${more}${addButton}`;
  }

  function calendarMonthViewElement({
    calendarDateISO = "",
    selectedISO = "",
    todayISOValue = "",
    eventsForDate = () => []
  } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "month-grid";
    CALENDAR_WEEKDAY_NAMES.forEach(name => {
      const header = document.createElement("div");
      header.innerHTML = calendarWeekdayHeaderHTML(name);
      wrap.appendChild(header.firstElementChild);
    });

    const currentDate = parseISO(calendarDateISO);
    const currentMonth = currentDate.getMonth();
    const firstDayOfMonth = new Date(currentDate.getFullYear(), currentMonth, 1);
    const start = startOfWeek(firstDayOfMonth);

    for (let i = 0; i < 42; i++) {
      const day = addDays(start, i);
      const iso = dateISO(day);
      const selected = iso === selectedISO;
      const cell = document.createElement("div");
      cell.className = "day-cell" +
        (day.getMonth() !== currentMonth ? " other" : "") +
        (iso === todayISOValue ? " today" : "") +
        (selected ? " selected" : "") +
        " has-add-event";
      cell.dataset.day = iso;
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }));
      cell.innerHTML = calendarMonthDayHTML(day.getDate(), eventsForDate(iso), { date: iso });
      wrap.appendChild(cell);
    }

    return wrap;
  }

  function calendarWeekRowHTML(day, events = []) {
    const label = day.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
    const eventsHTML = events.map(event => `<div class="event-chip ${normalizeCalendarCategory(event.category)}">${escapeHtml(event.start)}–${escapeHtml(event.end)} ${escapeHtml(event.title)}</div>`).join("");
    return `<b>${escapeHtml(label)}</b><div>${eventsHTML || `<span class="muted">Нет событий</span>`}</div>`;
  }

  function calendarDayHourHTML(hourLabel, events = []) {
    const eventsHTML = events.map(event => `<div class="event-chip ${normalizeCalendarCategory(event.category)}">${escapeHtml(event.start)}–${escapeHtml(event.end)} ${escapeHtml(event.title)}</div>`).join("");
    return `<b>${escapeHtml(hourLabel)}</b><div>${eventsHTML || `<span class="muted">Свободно</span>`}</div>`;
  }

  function calendarAgendaRowHTML(event = {}, formatDate) {
    const dateText = typeof formatDate === "function" ? formatDate(event.date) : event.date;
    return `<b>${escapeHtml(dateText)}<br>${escapeHtml(event.start)}–${escapeHtml(event.end)}</b><div><strong>${escapeHtml(event.title)}</strong><p class="muted">${escapeHtml(event.description || "")}</p></div><span class="pill">${escapeHtml(categoryName(event.category))}</span>`;
  }

  function calendarAgendaEmptyHTML() {
    return `<p class="muted">Событий пока нет.</p>`;
  }

  function calendarSelectedEventCardHTML(event = {}) {
    const repeatText = normalizeCalendarRepeat(event.repeat) !== "none" ? " · повтор" : "";
    return `<h4>${escapeHtml(event.title)}</h4><p>${escapeHtml(event.start)}–${escapeHtml(event.end)} · ${escapeHtml(categoryName(event.category))}${repeatText}</p><p>${escapeHtml(event.location || "")}</p><p>${escapeHtml(event.description || "")}</p><div class="event-actions"><button data-edit-event="${safeAttr(event.id)}">Редактировать</button><button data-delete-event="${safeAttr(event.id)}">Удалить</button></div>`;
  }

  function calendarSelectedEmptyHTML() {
    return `<p class="muted">На выбранный день событий нет.</p>`;
  }

  function calendarWeekViewElement(calendarDateISO = "", eventsForDate = () => []) {
    const wrap = document.createElement("div");
    wrap.className = "week-view";
    const start = startOfWeek(parseISO(calendarDateISO));
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const iso = dateISO(day);
      const row = document.createElement("div");
      row.className = "week-row";
      row.dataset.day = iso;
      row.innerHTML = calendarWeekRowHTML(day, eventsForDate(iso));
      wrap.appendChild(row);
    }
    return wrap;
  }

  function calendarDayViewElement(iso = "", events = []) {
    const wrap = document.createElement("div");
    wrap.className = "day-view";
    const sortedEvents = [...events].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    for (let h = 7; h <= 22; h++) {
      const row = document.createElement("div");
      row.className = "time-row";
      const hourLabel = `${pad(h)}:00`;
      const list = sortedEvents.filter(event => String(event.start || "").slice(0, 2) === pad(h));
      row.innerHTML = calendarDayHourHTML(hourLabel, list);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function calendarAgendaViewElement(events = [], formatDate) {
    const wrap = document.createElement("div");
    wrap.className = "agenda-view";
    const sortedEvents = [...events].sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start)));
    sortedEvents.forEach(event => {
      const row = document.createElement("div");
      row.className = "agenda-row";
      row.innerHTML = calendarAgendaRowHTML(event, formatDate);
      wrap.appendChild(row);
    });
    if (!sortedEvents.length) wrap.innerHTML = calendarAgendaEmptyHTML();
    return wrap;
  }

  function calendarSelectedEventsHTML(events = []) {
    const sortedEvents = [...events].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    if (!sortedEvents.length) return calendarSelectedEmptyHTML();
    return sortedEvents
      .map(event => `<div class="event-card">${calendarSelectedEventCardHTML(event)}</div>`)
      .join("");
  }

  function renderCalendarAppView(root, calendar = {}, options = {}) {
    const find = selector => root?.querySelector?.(selector);
    const view = calendar.view || "month";
    const selected = calendar.selected || "";
    const events = Array.isArray(options.events) ? options.events : [];
    const eventsForDate = typeof options.eventsForDate === "function" ? options.eventsForDate : () => [];
    const title = typeof options.title === "function" ? options.title() : (options.title || "");
    const viewSelect = find("[data-view]");
    const titleEl = find(".calendar-title");
    const board = find(".calendar-board");
    const eventList = find(".event-list");

    if (viewSelect) viewSelect.value = view;
    if (titleEl) titleEl.textContent = title;
    if (!board) return;

    board.innerHTML = "";
    if (view === "month") {
      board.appendChild(calendarMonthViewElement({
        calendarDateISO: calendar.date,
        selectedISO: selected,
        todayISOValue: options.todayISOValue || "",
        eventsForDate
      }));
    }
    if (view === "week") board.appendChild(calendarWeekViewElement(calendar.date, eventsForDate));
    if (view === "day") board.appendChild(calendarDayViewElement(selected, eventsForDate(selected)));
    if (view === "agenda") board.appendChild(calendarAgendaViewElement(events, options.formatDate));
    if (eventList) eventList.innerHTML = calendarSelectedEventsHTML(eventsForDate(selected));
  }

  function calendarClickAction(target) {
    const moveBtn = target?.closest?.("[data-cal]");
    if (moveBtn) return { type: "move", action: moveBtn.dataset.cal || "" };
    const addButton = target?.closest?.("[data-add-event]");
    if (addButton) return { type: "add-event", date: addButton.dataset.addEvent || "" };
    const dayBtn = target?.closest?.("[data-day]");
    if (dayBtn) return { type: "select-day", day: dayBtn.dataset.day || "" };
    const editBtn = target?.closest?.("[data-edit-event]");
    if (editBtn) return { type: "edit-event", eventId: editBtn.dataset.editEvent || "" };
    const deleteBtn = target?.closest?.("[data-delete-event]");
    if (deleteBtn) return { type: "delete-event", eventId: deleteBtn.dataset.deleteEvent || "" };
    if (target?.closest?.("[data-export-events]")) return { type: "export-events" };
    return null;
  }

  function calendarChangeAction(target) {
    if (target?.matches?.("[data-view]")) return { type: "view", view: target.value || "month" };
    return null;
  }

  function calendarKeyAction(event = {}) {
    if (event.key !== "Enter" && event.key !== " ") return null;
    if (event.target?.closest?.("[data-add-event]")) return null;
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
    const find = selector => root?.querySelector?.(selector);
    return {
      id: options.id || "",
      title: String(find("[data-ev-title]")?.value || "").trim(),
      date: find("[data-ev-date]")?.value || options.fallbackDate || "",
      start: find("[data-ev-start]")?.value || "",
      end: find("[data-ev-end]")?.value || "",
      location: String(find("[data-ev-location]")?.value || "").trim(),
      category: find("[data-ev-category]")?.value || "",
      repeat: find("[data-ev-repeat]")?.value || "",
      reminder: find("[data-ev-reminder]")?.value || "",
      description: String(find("[data-ev-desc]")?.value || "").trim()
    };
  }

  function fillCalendarEventForm(root, event = {}) {
    const find = selector => root?.querySelector?.(selector);
    const normalized = normalizeCalendarEvent(event);
    const formTitle = find("[data-form-title]");
    if (formTitle) formTitle.textContent = "Редактирование события";
    const title = find("[data-ev-title]");
    if (title) title.value = normalized.title;
    const date = find("[data-ev-date]");
    if (date) date.value = normalized.date;
    const start = find("[data-ev-start]");
    if (start) start.value = normalized.start;
    const end = find("[data-ev-end]");
    if (end) end.value = normalized.end;
    const location = find("[data-ev-location]");
    if (location) location.value = normalized.location || "";
    const category = find("[data-ev-category]");
    if (category) category.value = normalizeCalendarCategory(normalized.category);
    const repeat = find("[data-ev-repeat]");
    if (repeat) repeat.value = normalizeCalendarRepeat(normalized.repeat);
    const reminder = find("[data-ev-reminder]");
    if (reminder) reminder.value = normalizeCalendarReminder(normalized.reminder);
    const description = find("[data-ev-desc]");
    if (description) description.value = normalized.description || "";
    const saveButton = find("[data-save-event]");
    if (saveButton) saveButton.textContent = "Сохранить";
    find("[data-cancel-edit]")?.classList.remove("hidden");
  }

  function clearCalendarEventForm(root, selectedDate = "") {
    const find = selector => root?.querySelector?.(selector);
    const formTitle = find("[data-form-title]");
    if (formTitle) formTitle.textContent = "Новое событие";
    ["[data-ev-title]", "[data-ev-location]", "[data-ev-desc]"].forEach(selector => {
      const field = find(selector);
      if (field) field.value = "";
    });
    const date = find("[data-ev-date]");
    if (date) date.value = selectedDate || "";
    const start = find("[data-ev-start]");
    if (start) start.value = "09:00";
    const end = find("[data-ev-end]");
    if (end) end.value = "10:00";
    const saveButton = find("[data-save-event]");
    if (saveButton) saveButton.textContent = "Добавить";
    find("[data-cancel-edit]")?.classList.add("hidden");
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
    const {
      document,
      desktopTitle = "Рабочий стол",
      getCalendar = () => ({}),
      setCalendar = () => {},
      getEvents = () => [],
      setEvents = () => {},
      saveState = () => {},
      renderNotifications = () => {},
      toast = () => {},
      confirmUser = () => false,
      openEventEditor = () => {},
      downloadFile = () => {},
      todayISO = () => "",
      formatDate = value => String(value || "")
    } = integration;
    const root = document.createElement("div");
    root.className = "calendar-app";
    root.innerHTML = calendarShellHTML(desktopTitle);
    const eventsForDate = iso => calendarEventsForDate(getEvents(), iso);
    const draw = () => {
      const calendar = getCalendar();
      renderCalendarAppView(root, calendar, {
        title: calendarTitleText(calendar, formatDate),
        todayISOValue: todayISO(),
        events: getEvents(),
        eventsForDate,
        formatDate
      });
    };

    root.addEventListener("click", event => {
      const action = calendarClickAction(event.target);
      if (!action) return;
      if (action.type === "move") {
        setCalendar(moveCalendarState(getCalendar(), action.action));
        draw();
        return;
      }
      if (action.type === "select-day") {
        setCalendar({ ...getCalendar(), selected: action.day, date: action.day });
        draw();
        return;
      }
      if (action.type === "add-event") {
        const date = action.date || getCalendar().selected;
        setCalendar({ ...getCalendar(), selected: date, date });
        draw();
        openEventEditor({ mode: "create", date });
        return;
      }
      if (action.type === "edit-event") {
        openEventEditor({ mode: "edit", eventId: action.eventId });
        return;
      }
      if (action.type === "delete-event") {
        if (!confirmUser("Удалить событие?")) return;
        setEvents(removeCalendarEventById(getEvents(), action.eventId));
        saveState();
        draw();
        renderNotifications();
        return;
      }
      if (action.type === "export-events") {
        downloadFile("zeter_calendar_events.json", JSON.stringify(getEvents(), null, 2), "application/json");
      }
    });
    root.addEventListener("change", event => {
      const action = calendarChangeAction(event.target);
      if (!action) return;
      if (action.type === "view") {
        setCalendar({ ...getCalendar(), view: action.view });
        draw();
      }
    });
    root.addEventListener("keydown", event => {
      const action = calendarKeyAction(event);
      if (!action) return;
      event.preventDefault();
      setCalendar({ ...getCalendar(), selected: action.day, date: action.day });
      draw();
    });
    draw();
    return root;
  }

  function createCalendarEventEditorApp(params = {}, winId = "", integration = {}) {
    const {
      document,
      getCalendar = () => ({}),
      setCalendar = () => {},
      getEvents = () => [],
      setEvents = () => {},
      saveState = () => {},
      renderNotifications = () => {},
      refreshOpenCalendars = () => {},
      closeWindow = () => {},
      toast = () => {},
      todayISO = () => ""
    } = integration;
    const root = document.createElement("div");
    root.className = "calendar-event-editor-app";
    const editingId = String(params?.eventId || "");
    const selectedDate = params?.date || getCalendar().selected || todayISO();
    const closeEditor = () => closeWindow(winId);

    root.innerHTML = calendarEventEditorHTML();
    if (editingId) {
      const filled = fillCalendarEventFormById(root, getEvents(), editingId, { ...getCalendar(), selected: selectedDate, editing: editingId });
      if (!filled.found) {
        root.innerHTML = calendarEventEditorMissingHTML();
        root.addEventListener("click", event => {
          if (calendarEventEditorClickAction(event.target)?.type === "cancel") closeEditor();
        });
        return root;
      }
    } else {
      clearCalendarEventForm(root, selectedDate);
    }

    const saveEvent = () => {
      const events = getEvents();
      const editorCalendar = { ...getCalendar(), selected: selectedDate, date: selectedDate, editing: editingId || null };
      const result = saveCalendarEventFromForm(root, editorCalendar, events);
      if (!result.saved) {
        if (result.reason === "missing-event") {
          toast("Событие не найдено", "Оно было удалено в другом окне.");
        } else {
          toast("Нужен заголовок", "Введите название события");
          root.querySelector("[data-ev-title]")?.focus();
        }
        return;
      }
      setEvents(events);
      setCalendar(result.calendar);
      saveState();
      refreshOpenCalendars(winId);
      renderNotifications();
      toast("Событие сохранено", result.event.title);
      closeEditor();
    };

    root.addEventListener("click", event => {
      const action = calendarEventEditorClickAction(event.target);
      if (action?.type === "save") saveEvent();
      if (action?.type === "cancel") closeEditor();
    });
    root.addEventListener("keydown", event => {
      const action = calendarEventEditorKeyAction(event);
      if (!action) return;
      event.preventDefault();
      if (action.type === "save") saveEvent();
      if (action.type === "cancel") closeEditor();
    });
    setTimeout(() => root.querySelector("[data-ev-title]")?.focus(), 0);
    return root;
  }

  window.ZETER_CALENDAR_UI_UTILS = Object.freeze({
    CALENDAR_WEEKDAY_NAMES,
    calendarShellHTML,
    calendarEventEditorHTML,
    calendarEventEditorMissingHTML,
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
