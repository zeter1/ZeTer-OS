(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  if (!coreUtils || !dataNormalizers) throw new Error("ZeTer OS calendar utils require core and data normalizers.");

  const { parseISO, dateISO, todayISO } = coreUtils;
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

  function startOfWeek(date) {
    const x = new Date(date);
    const day = (x.getDay() + 6) % 7;
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

  function calendarTitleText(calendar = {}, formatDate = value => String(value || "")) {
    const view = calendar.view || "month";
    const date = parseISO(calendar.date || todayISO());
    if (view === "month") return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
    if (view === "week") return `Неделя ${formatDate(startOfWeek(date))} \u2014 ${formatDate(addDays(startOfWeek(date), 6))}`;
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
    if (view === "month") date.setMonth(date.getMonth() + direction);
    else if (view === "week") date.setDate(date.getDate() + direction * 7);
    else date.setDate(date.getDate() + direction);
    const iso = dateISO(date);
    return { ...calendar, date: iso, selected: iso };
  }

  window.ZETER_CALENDAR_UTILS = Object.freeze({
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
