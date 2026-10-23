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

  const isCalendarDate = dataNormalizers.isCalendarDate;
  const dayNumber = iso => isCalendarDate(iso) ? Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000) : NaN;
  const dayISO = day => { const date = new Date(day * 86400000); return Number.isFinite(+date) ? date.toISOString().slice(0, 10) : ""; };
  function calendarDateAdd(iso, days) { const result = dayISO(dayNumber(iso) + days); return isCalendarDate(result) ? result : ""; }
  function calendarTimeMinutes(value) {
    return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
  }
  function calendarEventDurationMinutes(event = {}) {
    const days = dayNumber(event.endDate || event.date) - dayNumber(event.date);
    if (!Number.isFinite(days) || days < 0) return 0;
    if (event.allDay) return (days + 1) * 1440;
    const start = calendarTimeMinutes(event.start), end = calendarTimeMinutes(event.end);
    if (start === null) return 0;
    return Math.max(0, days * 1440 + (end === null ? Math.min(1440, start + 60) : end) - start);
  }

  function calendarOccurrences(events = [], fromISO = "", toISO = "", options = {}) {
    if (!isCalendarDate(fromISO) || !isCalendarDate(toISO) || fromISO > toISO) return [];
    const from = dayNumber(fromISO), to = dayNumber(toISO);
    const result = [];
    const limit = Math.max(1, Math.min(50000, Math.trunc(Number(options.limit) || 5000)));
    const byOccurrence = (a, b) => a.date.localeCompare(b.date) || String(a.start || "").localeCompare(String(b.start || "")) || a.id.localeCompare(b.id);
    for (const raw of Array.isArray(events) ? events : []) {
      if (!raw || !isCalendarDate(raw.date)) continue;
      const event = normalizeCalendarEvent({ ...raw }), base = dayNumber(event.date);
      const span = Math.max(0, dayNumber(event.endDate) - base), lower = Math.max(base, from - span);
      const upper = Math.min(to, event.repeatUntil ? dayNumber(event.repeatUntil) : to, result.length === limit ? dayNumber(result.at(-1).date) : to);
      if (upper < lower) continue;
      const excluded = new Set(event.excludedDates), interval = event.repeatInterval, occurrences = [];
      const append = day => {
        const occurrenceDate = dayISO(day);
        if (day < lower || day > upper || excluded.has(occurrenceDate)) return;
        // A timed midnight end is exclusive; an all-day end date is inclusive.
        if (!event.allDay && day + span === from && span > 0 && calendarTimeMinutes(event.end) === 0) return;
        occurrences.push({ ...event, id: event.id, eventId: event.id, occurrenceDate, occurrenceKey: `${event.id}@${occurrenceDate}`, date: occurrenceDate, endDate: dayISO(day + span) });
      };
      if (event.repeat === "none") append(base);
      else if (event.repeat === "daily") {
        for (let day = base + Math.max(0, Math.ceil((lower - base) / interval)) * interval; day <= upper && occurrences.length < limit; day += interval) append(day);
      } else if (event.repeat === "weekly") {
        const weekday = new Date(`${event.date}T00:00:00Z`).getUTCDay();
        const anchor = base - (weekday + 6) % 7;
        const period = interval * 7;
        for (let week = anchor + Math.max(0, Math.floor((lower - anchor) / period)) * period; week <= upper && occurrences.length < limit; week += period) {
          for (const day of [...event.repeatWeekdays].sort((a, b) => (a + 6) % 7 - (b + 6) % 7)) {
            if (occurrences.length >= limit) break;
            append(week + (day + 6) % 7);
          }
        }
      } else {
        const baseMonth = Number(event.date.slice(0, 4)) * 12 + Number(event.date.slice(5, 7)) - 1;
        const lowerISO = dayISO(lower), lowerMonth = Number(lowerISO.slice(0, 4)) * 12 + Number(lowerISO.slice(5, 7)) - 1;
        const upperISO = dayISO(upper), endMonth = Number(upperISO.slice(0, 4)) * 12 + Number(upperISO.slice(5, 7)) - 1;
        for (let month = baseMonth + Math.max(0, Math.floor((lowerMonth - baseMonth) / interval)) * interval; month <= endMonth && occurrences.length < limit; month += interval) {
          const iso = `${String(Math.floor(month / 12)).padStart(4, "0")}-${pad(month % 12 + 1)}-${event.date.slice(8)}`;
          if (isCalendarDate(iso)) append(dayNumber(iso));
        }
      }
      // Each series is chronological. Insert only candidates that can enter the
      // bounded result, without sorting the complete retained list after every record.
      for (const occurrence of occurrences) {
        if (result.length === limit && byOccurrence(occurrence, result.at(-1)) >= 0) break;
        let lowerIndex = 0, upperIndex = result.length;
        while (lowerIndex < upperIndex) {
          const middle = Math.floor((lowerIndex + upperIndex) / 2);
          if (byOccurrence(result[middle], occurrence) <= 0) lowerIndex = middle + 1;
          else upperIndex = middle;
        }
        result.splice(lowerIndex, 0, occurrence);
        if (result.length > limit) result.pop();
      }
    }
    return result;
  }

  function occursOn(event = {}, iso = "") {
    // Reminder and automation consumers ask about starts, while calendar views include overlaps.
    return calendarOccurrences([{ ...event, endDate: event.date }], iso, iso, { limit: 1 }).some(item => item.occurrenceDate === iso);
  }
  function calendarEventsForDate(events = [], iso = "") { return calendarOccurrences(events, iso, iso); }

  function calendarDayLayout(occurrences = [], iso = "", { workStart = "09:00", workEnd = "18:00" } = {}) {
    const segments = [], allDay = [];
    if (!isCalendarDate(iso)) return { segments, allDay, busyMinutes: 0, freeSlots: [], conflicts: [] };
    for (const event of occurrences) {
      const offset = dayNumber(iso) - dayNumber(event.date), duration = calendarEventDurationMinutes(event);
      if (offset < 0 || iso > (event.endDate || event.date)) continue;
      if (event.allDay || calendarTimeMinutes(event.start) === null) { allDay.push(event); continue; }
      const start = calendarTimeMinutes(event.start) - offset * 1440, end = start + duration;
      if (end <= 0 || start >= 1440 || duration <= 0) continue;
      segments.push({ event, startMinute: Math.max(0, start), endMinute: Math.min(1440, end), lane: 0, lanes: 1, continuesBefore: start < 0, continuesAfter: end > 1440 });
    }
    segments.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
    let group = [], groupEnd = -1;
    const finishGroup = () => {
      const ends = [];
      for (const segment of group) {
        let lane = ends.findIndex(end => end <= segment.startMinute);
        if (lane < 0) lane = ends.length;
        ends[lane] = segment.endMinute; segment.lane = lane;
      }
      for (const segment of group) segment.lanes = ends.length;
      group = [];
    };
    for (const segment of segments) {
      if (segment.startMinute >= groupEnd) finishGroup();
      group.push(segment); groupEnd = Math.max(groupEnd, segment.endMinute);
    }
    finishGroup();
    const intervals = [];
    for (const segment of segments) {
      const last = intervals.at(-1);
      if (last && segment.startMinute <= last.end) last.end = Math.max(last.end, segment.endMinute);
      else intervals.push({ start: segment.startMinute, end: segment.endMinute });
    }
    const lower = calendarTimeMinutes(workStart) ?? 540, upper = calendarTimeMinutes(workEnd) ?? 1080;
    const freeSlots = []; let cursor = lower;
    for (const interval of intervals) {
      if (interval.end <= lower || interval.start >= upper) continue;
      if (interval.start > cursor) freeSlots.push({ start: cursor, end: Math.min(interval.start, upper) });
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < upper) freeSlots.push({ start: cursor, end: upper });
    const boundaries = [...new Set(segments.flatMap(segment => [segment.startMinute, segment.endMinute]))].sort((a, b) => a - b), conflicts = [];
    for (let index = 0; index < boundaries.length - 1; index++) {
      const start = boundaries[index], end = boundaries[index + 1];
      const active = segments.filter(segment => segment.startMinute < end && segment.endMinute > start);
      if (active.length > 1) conflicts.push({ start, end, ids: [...new Set(active.map(segment => segment.event.id))], occurrenceKeys: active.map(segment => segment.event.occurrenceKey || segment.event.id) });
    }
    return { segments, allDay, busyMinutes: intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0), freeSlots, conflicts };
  }

  function validateCalendarEventDraft(draft = {}) {
    const title = String(draft.title || "").trim();
    if (!title || title.length > 500) throw new Error("Укажите название события, до 500 символов.");
    if (!isCalendarDate(draft.date) || (draft.endDate && !isCalendarDate(draft.endDate))) throw new Error("Укажите существующую дату события.");
    const endDate = draft.endDate || draft.date;
    if (endDate < draft.date) throw new Error("Дата окончания должна быть не раньше начала.");
    if (!draft.allDay) {
      for (const key of ["start", "end"]) if (draft[key] && calendarTimeMinutes(draft[key]) === null) throw new Error("Проверьте время начала и окончания события.");
      if (draft.end && !draft.start) throw new Error("Укажите время начала события.");
      if (draft.start && draft.end && calendarEventDurationMinutes({ ...draft, endDate }) <= 0) throw new Error("Окончание должно быть позже начала. Для переноса через полночь выберите следующий день.");
    }
    if (draft.repeatUntil && (!isCalendarDate(draft.repeatUntil) || draft.repeatUntil < draft.date)) throw new Error("Дата окончания повторов должна быть не раньше начала.");
    if (draft.repeatInterval !== undefined && (!Number.isInteger(Number(draft.repeatInterval)) || Number(draft.repeatInterval) < 1 || Number(draft.repeatInterval) > 365)) throw new Error("Интервал повторов должен быть от 1 до 365.");
    if (draft.repeatWeekdays !== undefined && (!Array.isArray(draft.repeatWeekdays) || draft.repeatWeekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw new Error("Проверьте дни недели повторения.");
    if (draft.excludedDates !== undefined && (!Array.isArray(draft.excludedDates) || draft.excludedDates.some(iso => !isCalendarDate(iso)))) throw new Error("Проверьте исключённые даты: нужны существующие даты в формате ГГГГ-ММ-ДД.");
    if (draft.excludedDates && new Set(draft.excludedDates).size > 1000) throw new Error("Можно указать не больше 1000 исключённых дат.");
    return normalizeCalendarEvent({ ...draft, title, endDate });
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

  function categoryName(category, categories = []) {
    const id = normalizeCalendarCategory(category);
    if (CALENDAR_CATEGORY_NAMES[id]) return CALENDAR_CATEGORY_NAMES[id];
    return dataNormalizers.normalizeCalendarCategories(categories).find(item => item.id === id)?.name || "Категория недоступна";
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

  function calendarEventTaskBinding(draft, workspace, previous = null) {
    const taskId = String(draft.taskId ?? previous?.taskId ?? ""), changedTask = taskId !== String(previous?.taskId || "");
    const projectId = String(draft.projectId ?? (changedTask ? "" : previous?.projectId) ?? "");
    // Historical bindings are snapshots: deleting or moving a task cannot invalidate an unrelated edit.
    if (previous && taskId === String(previous.taskId || "") && projectId === String(previous.projectId || "")) return { taskId, projectId, projectName: previous.projectName || "" };
    const task = taskId ? workspace.tasks?.find(item => item.id === taskId) : null;
    if (taskId && !task) throw new Error("Задача уже удалена или недоступна на этом рабочем столе.");
    if (task && projectId && projectId !== String(task.projectId || "")) throw new Error("Выбранный проект не соответствует задаче.");
    const selectedProject = task?.projectId || projectId;
    const project = selectedProject ? workspace.taskProjects?.find(item => item.id === selectedProject) : null;
    if (selectedProject && !project) throw new Error("Проект уже удалён или недоступен на этом рабочем столе.");
    return { taskId: task?.id || "", projectId: project?.id || "", projectName: project?.name || String(draft.projectName || "") };
  }

  function createCalendarPlanController(options) {
    const now = options.now || Date.now;
    return Object.freeze({ createPlan: draft => {
      const submitted = structuredClone(draft), workspace = options.getWorkspace();
      return options.persistTransaction(async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте форму заново.");
        const validated = validateCalendarEventDraft(submitted);
        if (submitted.allDay || [submitted.start, submitted.end].some(value => calendarTimeMinutes(value) === null)) throw new Error("Укажите время начала и окончания занятия.");
        const start = new Date(`${validated.date}T${validated.start}:00`), end = new Date(`${validated.endDate}T${validated.end}:00`);
        if (!Number.isFinite(+start) || dateISO(start) !== submitted.date || `${pad(start.getHours())}:${pad(start.getMinutes())}` !== submitted.start) throw new Error("Проверьте дату и время начала.");
        if (+start < now()) throw new Error("Начало плана уже прошло. Выберите время позже текущего.");
        if (+end <= +start || dateISO(end) !== validated.endDate || `${pad(end.getHours())}:${pad(end.getMinutes())}` !== submitted.end) throw new Error("Проверьте дату и время окончания занятия.");
        const events = workspace.events || [];
        if (events.length >= window.ZETER_OS_CONFIG.CALENDAR_MAX_EVENTS) throw new Error("В календаре достигнут лимит событий.");
        const item = normalizeCalendarEvent({ ...validated, ...calendarEventTaskBinding(submitted, workspace), id: options.createId("event"), category: submitted.category || "work", createdAt: now(), updatedAt: now() });
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

  function createCalendarEventController(options) {
    const clone = value => JSON.parse(JSON.stringify(value));
    const contentSnapshot = event => {
      const { updatedAt, reminderNotifiedOccurrence, ...content } = event;
      return JSON.stringify(content);
    };
    const assertOriginal = (previous, baseline) => {
      if (baseline && contentSnapshot(previous) !== contentSnapshot(baseline)) throw new Error("Событие изменено в другом окне. Ввод остался в форме. Откройте событие заново, чтобы увидеть актуальные данные.");
    };
    const scopeFor = (event, settings) => {
      const scope = settings.scope || "all";
      if (!["all", "one", "future"].includes(scope)) throw new Error("Выберите область изменения события.");
      if (scope === "all" || normalizeCalendarRepeat(event.repeat) === "none") return "all";
      const date = settings.occurrenceDate;
      if (!isCalendarDate(date) || !calendarOccurrences([event], date, date).some(item => item.occurrenceDate === date)) throw new Error("Выбранное повторение больше не существует. Откройте событие заново.");
      return scope;
    };
    const excludeDate = (event, date) => {
      const excluded = [...new Set([...(event.excludedDates || []), date])].sort();
      if (excluded.length > 1000) throw new Error("Достигнут лимит исключений серии. Измените будущие повторения или всю серию.");
      event.excludedDates = excluded; event.updatedAt = Date.now();
    };
    const hasEarlierOccurrence = (event, date) => calendarOccurrences([event], event.date, calendarDateAdd(date, -1), { limit: 1 }).length > 0;
    const truncateSeries = (candidate, event, date) => {
      if (!hasEarlierOccurrence(event, date)) { candidate.splice(candidate.indexOf(event), 1); return [event.id]; }
      event.repeatUntil = calendarDateAdd(date, -1); event.updatedAt = Date.now();
      return [];
    };
    const mutate = operation => {
      const workspace = options.getWorkspace();
      const transaction = () => options.persistTransaction(async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте календарь заново.");
        const candidate = clone(workspace.events || []);
        const result = operation(candidate);
        const saved = await options.saveSnapshot(write, candidate, result);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение события. Повторите попытку.");
        const current = Array.isArray(workspace.events) ? workspace.events : [];
        const accepted = new Map(candidate.filter(event => result.affectedIds.includes(event.id)).map(event => [event.id, event]));
        for (const event of accepted.values()) {
          const latest = current.find(item => item.id === event.id);
          // Reminder delivery can update its marker while persistence is pending.
          if (latest && latest.date === event.date && latest.start === event.start) {
            event.reminderNotifiedOccurrence = latest.reminderNotifiedOccurrence || "";
            event.updatedAt = Math.max(event.updatedAt, Number(latest.updatedAt) || 0);
          }
        }
        const removed = new Set(result.removedIds || []), currentIds = new Set(current.map(event => event.id));
        workspace.events = current.filter(event => !removed.has(event.id)).map(event => accepted.get(event.id) || event);
        for (const [id, event] of accepted) if (!currentIds.has(id)) workspace.events.push(event);
        return result.returnTrue ? true : clone(result.event);
      });
      return options.queueMutation ? options.queueMutation(transaction) : transaction();
    };
    return Object.freeze({
      saveEvent: (draft, editingId = "", original = null, settings = {}) => {
        const submitted = clone(draft), baseline = original ? clone(original) : null, scopeSettings = clone(settings);
        return mutate(candidate => {
          const previous = editingId ? candidate.find(item => item.id === editingId) : null;
          if (editingId && !previous) throw new Error("Событие удалено в другом окне. Ввод остался в форме.");
          if (previous) assertOriginal(previous, baseline);
          const scope = previous ? scopeFor(previous, scopeSettings) : "all";
          const date = String(submitted.date || "");
          if (!editingId && date < todayISO()) throw new Error("Дата уже прошла. Новое событие можно добавить только на сегодня или будущую дату.");
          const created = !previous || scope !== "all";
          const replacesEmptySeries = previous && scope === "future" && !hasEarlierOccurrence(previous, scopeSettings.occurrenceDate);
          if (created && !replacesEmptySeries && candidate.length >= window.ZETER_OS_CONFIG.CALENDAR_MAX_EVENTS) throw new Error("В календаре достигнут лимит событий.");
          const now = Date.now();
          const fields = { ...previous, ...submitted, date, endDate: submitted.endDate || date, id: created ? options.createId("event") : previous.id, createdAt: created ? now : previous.createdAt ?? now, updatedAt: now };
          Object.assign(fields, calendarEventTaskBinding(submitted, options.getWorkspace(), previous));
          // Expanded occurrence fields are projections, never persistent records.
          for (const key of ["eventId", "occurrenceDate", "occurrenceKey"]) delete fields[key];
          if (scope === "one") { fields.repeat = "none"; fields.repeatUntil = ""; fields.excludedDates = []; fields.reminderNotifiedOccurrence = ""; }
          if (scope === "future") {
            fields.reminderNotifiedOccurrence = "";
          }
          const event = validateCalendarEventDraft(fields);
          if (scope === "future") event.excludedDates = event.excludedDates.filter(iso => iso >= event.date);
          const affectedIds = [event.id];
          let removedIds = [];
          if (previous && scope === "all") candidate[candidate.indexOf(previous)] = event;
          else {
            if (candidate.some(item => item.id === event.id)) throw new Error("Повторный ID события.");
            if (previous) {
              if (scope === "one") excludeDate(previous, scopeSettings.occurrenceDate);
              else removedIds = truncateSeries(candidate, previous, scopeSettings.occurrenceDate);
              affectedIds.push(previous.id);
            }
            candidate.push(event);
          }
          return { event, created, affectedIds, removedIds };
        });
      },
      removeEvent: (id, settings = {}, original = null) => {
        const scopeSettings = clone(settings), baseline = original ? clone(original) : null;
        return mutate(candidate => {
        const index = candidate.findIndex(item => item.id === id);
        if (index < 0) throw new Error("Событие уже удалено в другом окне.");
        const event = candidate[index]; assertOriginal(event, baseline);
        const scope = scopeFor(event, scopeSettings);
        if (scope === "all") { candidate.splice(index, 1); return { removedId: id, removedIds: [id], affectedIds: [], returnTrue: true }; }
        if (scope === "one") excludeDate(event, scopeSettings.occurrenceDate);
        const removedIds = scope === "future" ? truncateSeries(candidate, event, scopeSettings.occurrenceDate) : [];
        return { event, affectedIds: [id], removedIds, created: false, returnTrue: true };
        });
      }
    });
  }

  window.ZETER_CALENDAR_UTILS = Object.freeze({
    createCalendarPlanController,
    createCalendarEventController,
    CALENDAR_CATEGORY_NAMES,
    startOfWeek,
    addDays,
    isCalendarDate,
    calendarDateAdd,
    calendarTimeMinutes,
    calendarEventDurationMinutes,
    calendarOccurrences,
    calendarDayLayout,
    validateCalendarEventDraft,
    occursOn,
    calendarEventsForDate,
    upsertCalendarEvent,
    removeCalendarEventById,
    categoryName,
    calendarTitleText,
    moveCalendarState
  });
})();
