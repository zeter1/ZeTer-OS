(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  if (!coreUtils || !dataNormalizers) throw new Error("ZeTer OS calendar utils require core and data normalizers.");

  const { parseISO, dateISO, todayISO, pad } = coreUtils;
  const {
    normalizeCalendarCategory,
    normalizeCalendarRepeat,
    normalizeCalendarEvent
  } = dataNormalizers;

  const CALENDAR_CATEGORY_NAMES = Object.freeze({
    work: "Работа",
    personal: "Личное",
    health: "Здоровье",
    important: "Важное"
  });

  function startOfWeek(date, weekStart = "monday") {
    const x = new Date(date);
    const day = weekStart === "sunday" ? x.getDay() : (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(date, days) {
    const x = new Date(date);
    x.setDate(x.getDate() + days);
    return x;
  }

  function occursOn(event = {}, iso = "") {
    if (event.date === iso) return true;
    const repeat = normalizeCalendarRepeat(event.repeat);
    if (repeat === "none") return false;
    const base = parseISO(event.date);
    const day = parseISO(iso);
    if (day < base) return false;
    if (repeat === "daily") return true;
    if (repeat === "weekly") return base.getDay() === day.getDay();
    if (repeat === "monthly") return base.getDate() === day.getDate();
    return false;
  }

  function calendarEventsForDate(events = [], iso = "") {
    return (Array.isArray(events) ? events : []).filter(event => occursOn(event, iso));
  }

  function upsertCalendarEvent(events = [], event = {}, editingId = "") {
    const list = Array.isArray(events) ? events : [];
    const normalized = normalizeCalendarEvent(event);
    if (editingId) {
      const index = list.findIndex(item => item.id === editingId);
      if (index >= 0) list[index] = normalized;
    } else {
      list.push(normalized);
    }
    return normalized;
  }

  function removeCalendarEventById(events = [], id = "") {
    return (Array.isArray(events) ? events : []).filter(event => event.id !== id);
  }

  function categoryName(category) {
    return CALENDAR_CATEGORY_NAMES[normalizeCalendarCategory(category)] || CALENDAR_CATEGORY_NAMES.personal;
  }

  function calendarTitleText(calendar = {}, formatDate = value => String(value || ""), weekStart = "monday") {
    const view = calendar.view || "month";
    const date = parseISO(calendar.date || todayISO());
    if (view === "month") return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    if (view === "week") {
      const start = startOfWeek(date, weekStart);
      return `Неделя ${formatDate(start)} \u2014 ${formatDate(addDays(start, 6))}`;
    }
    if (view === "day") return formatDate(calendar.selected || calendar.date, true);
    return "Все события";
  }

  function moveCalendarState(calendar = {}, action = "") {
    const view = calendar.view || "month";
    if (action === "today") {
      const today = todayISO();
      return { ...calendar, date: today, selected: today };
    }
    const date = parseISO(calendar.date || todayISO());
    const direction = action === "next" ? 1 : -1;
    if (view === "month") {
      const day = date.getDate();
      date.setDate(1);
      date.setMonth(date.getMonth() + direction);
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      date.setDate(Math.min(day, lastDay));
    }
    else if (view === "week") date.setDate(date.getDate() + direction * 7);
    else date.setDate(date.getDate() + direction);
    const iso = dateISO(date);
    return { ...calendar, date: iso, selected: iso };
  }

  function createCalendarPlanController(options) {
    const now = options.now || Date.now;
    return Object.freeze({ createPlan: draft => {
      const submitted = structuredClone(draft), workspace = options.getWorkspace();
      return options.persistTransaction(async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте форму заново.");
        const title = String(submitted.title || "").trim();
        if (!title || title.length > 500) throw new Error("Укажите название занятия, до 500 символов.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(submitted.date || "") || ![submitted.start, submitted.end].every(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || ""))) throw new Error("Укажите дату, время начала и окончания.");
        const start = new Date(`${submitted.date}T${submitted.start}:00`), end = new Date(`${submitted.date}T${submitted.end}:00`);
        if (!Number.isFinite(+start) || dateISO(start) !== submitted.date || `${pad(start.getHours())}:${pad(start.getMinutes())}` !== submitted.start) throw new Error("Проверьте дату и время начала.");
        if (+start < now()) throw new Error("Начало плана уже прошло. Выберите время позже текущего.");
        if (+end <= +start || dateISO(end) !== submitted.date || `${pad(end.getHours())}:${pad(end.getMinutes())}` !== submitted.end) throw new Error("Окончание должно быть позже начала в пределах выбранного дня. Для следующего дня создайте отдельное занятие.");
        const events = workspace.events || [];
        if (events.length >= window.ZETER_OS_CONFIG.CALENDAR_MAX_EVENTS) throw new Error("В календаре достигнут лимит событий.");
        const item = normalizeCalendarEvent({ ...submitted, id: options.createId("event"), title, category: "work", repeat: "none", createdAt: now(), updatedAt: now() });
        if (events.some(event => event.id === item.id)) throw new Error("Повторный ID события.");
        const candidate = [...structuredClone(events), item];
        const saved = await options.saveSnapshot(write, candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение плана.");
        // Preserve concurrent calendar edits; their queued save follows this transaction.
        if (!Array.isArray(workspace.events)) workspace.events = [];
        workspace.events.push(item);
        return structuredClone(item);
      });
    } });
  }

  window.ZETER_CALENDAR_UTILS = Object.freeze({
    createCalendarPlanController,
    CALENDAR_CATEGORY_NAMES,
    startOfWeek,
    addDays,
    occursOn,
    calendarEventsForDate,
    upsertCalendarEvent,
    removeCalendarEventById,
    categoryName,
    calendarTitleText,
    moveCalendarState
  });
})();
