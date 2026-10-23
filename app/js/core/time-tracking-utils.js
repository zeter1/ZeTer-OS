(() => {
  "use strict";
  const RUNTIME_ID = `time-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
  const text = (value, max) => typeof value === "string" && value.length <= max;
  function normalizeTimeTracking(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return { ...source, entries: Array.isArray(source.entries) ? clone(source.entries) : [], active: source.active ? clone(source.active) : null, dailyGoalMinutes: source.dailyGoalMinutes ?? 0 };
  }
  function validateTimeTracking(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.entries) || value.entries.length > 10000 || (value.active !== null && (typeof value.active !== "object" || !value.active))) throw new Error("Учёт времени: повреждены данные или превышено 10000 записей.");
    if (value.dailyGoalMinutes !== undefined && (!Number.isInteger(value.dailyGoalMinutes) || value.dailyGoalMinutes < 0 || value.dailyGoalMinutes > 1440)) throw new Error("Учёт времени: цель должна быть от 0 до 1440 минут.");
    const ids = new Set();
    function session(item, active) {
      if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,220}$/.test(item.id) || ids.has(item.id)) throw new Error("Учёт времени: некорректный или повторный ID.");
      ids.add(item.id);
      if (item.notes !== undefined && !text(item.notes, 5000)) throw new Error("Учёт времени: заметка должна быть не длиннее 5000 символов.");
      if (item.manual !== undefined && typeof item.manual !== "boolean") throw new Error("Учёт времени: некорректный тип записи.");
      if (isTimeEntryDeleted(item) && !timestamp(item.deletedAt)) throw new Error("Учёт времени: некорректная дата удаления.");
      if (!text(item.title, 500) || !item.title.trim() || !text(item.taskId, 220) || !text(item.projectId, 220) || !text(item.projectName, 500) || !timestamp(item.createdAt) || !Array.isArray(item.segments) || item.segments.length > 1000) throw new Error("Учёт времени: некорректная сессия.");
      let end = item.createdAt;
      item.segments.forEach(segment => {
        if (!segment || !timestamp(segment.start) || !timestamp(segment.end) || segment.start < end || segment.end < segment.start) throw new Error("Учёт времени: некорректный интервал.");
        end = segment.end;
      });
      if (active) {
        if (isTimeEntryDeleted(item) || item.finishedAt !== null || !text(item.runtimeId, 220) || !item.runtimeId || (item.runningSince !== null && (!timestamp(item.runningSince) || item.runningSince < end))) throw new Error("Учёт времени: некорректная активная сессия.");
      } else if (item.runningSince !== null || !timestamp(item.finishedAt) || item.finishedAt < end) throw new Error("Учёт времени: некорректное окончание сессии.");
    }
    value.entries.forEach(item => session(item, false));
    if (value.active) session(value.active, true);
  }
  function timeInRange(session, start, end, now = Date.now()) {
    const overlap = (a, b) => Math.max(0, Math.min(end, b) - Math.max(start, a));
    let total = (session.segments || []).reduce((sum, part) => sum + overlap(part.start, part.end), 0);
    if (session.runningSince !== null && session.runningSince != null) total += overlap(session.runningSince, Math.max(session.runningSince, now));
    return total;
  }
  const sessionDuration = (session, now = Date.now()) => timeInRange(session, 0, 8640000000000000, now);
  function localRanges(now = Date.now()) {
    const day = new Date(now); day.setHours(0, 0, 0, 0);
    const tomorrow = new Date(day); tomorrow.setDate(tomorrow.getDate() + 1);
    const week = new Date(day); week.setDate(week.getDate() - (week.getDay() + 6) % 7);
    const nextWeek = new Date(week); nextWeek.setDate(nextWeek.getDate() + 7);
    return { dayStart: +day, dayEnd: +tomorrow, weekStart: +week, weekEnd: +nextWeek };
  }
  function formatTimeDuration(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const isTimeEntryDeleted = item => item?.deletedAt !== null && item?.deletedAt !== undefined;
  function timeFilterRange(period = "week", now = Date.now(), fromDate = "", toDate = "") {
    const ranges = localRanges(now), day = new Date(ranges.dayStart);
    if (period === "today") return { from: ranges.dayStart, to: ranges.dayEnd };
    if (period === "yesterday") { day.setDate(day.getDate() - 1); return { from: +day, to: ranges.dayStart }; }
    if (period === "month") return { from: +new Date(day.getFullYear(), day.getMonth(), 1), to: +new Date(day.getFullYear(), day.getMonth() + 1, 1) };
    if (period === "all") return { from: 0, to: 8640000000000000 };
    if (period === "custom") {
      const parse = text => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!match) throw new Error("Укажите обе даты периода.");
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (date.getFullYear() !== +match[1] || date.getMonth() !== +match[2] - 1 || date.getDate() !== +match[3]) throw new Error("Проверьте даты периода.");
        return date;
      };
      const from = parse(fromDate), to = parse(toDate);
      if (+from > +to) throw new Error("Дата начала позже даты окончания.");
      to.setDate(to.getDate() + 1); return { from: +from, to: +to };
    }
    return { from: ranges.weekStart, to: ranges.weekEnd };
  }
  function selectTimeEntries(tracking, filter = {}) {
    const { from = 0, to = 8640000000000000, projectId = null } = filter;
    const query = String(filter.query || "").trim().toLocaleLowerCase();
    return (tracking.entries || []).filter(item => !isTimeEntryDeleted(item) && (projectId === null || item.projectId === projectId)
      && (!query || `${item.title}\n${item.projectName}\n${item.notes || ""}`.toLocaleLowerCase().includes(query)))
      .map(entry => ({ entry, durationMs: timeInRange(entry, from, to), fullDurationMs: sessionDuration(entry) }))
      .filter(row => row.durationMs > 0 || (row.entry.finishedAt >= from && row.entry.finishedAt < to))
      .sort((a, b) => b.entry.createdAt - a.entry.createdAt || a.entry.id.localeCompare(b.entry.id));
  }
  function summarizeTimeRows(rows, grouping = "projects") {
    const groups = new Map(); let totalMs = 0;
    for (const row of rows) {
      totalMs += row.durationMs;
      const key = grouping === "projects" ? `project:${row.entry.projectId}` : row.entry.taskId ? `task:${row.entry.taskId}` : `title:${row.entry.title}`;
      const item = groups.get(key) || { key, name: grouping === "projects" ? row.entry.projectName || "Без проекта" : row.entry.title, ms: 0, count: 0 };
      item.ms += row.durationMs; item.count++; groups.set(key, item);
    }
    return { totalMs, count: rows.length, groups: [...groups.values()].sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name)) };
  }
  function timeWeekBuckets(entries, now = Date.now()) {
    const start = new Date(localRanges(now).weekStart), result = [];
    for (let index = 0; index < 7; index++) {
      const day = new Date(start), next = new Date(start); day.setDate(start.getDate() + index); next.setDate(start.getDate() + index + 1);
      result.push({ start: +day, end: +next, ms: entries.filter(item => !isTimeEntryDeleted(item)).reduce((sum, item) => sum + timeInRange(item, +day, +next, now), 0) });
    }
    return result;
  }
  function safeTimeReportText(value) {
    const text = String(value ?? "");
    return /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  }
  function reportDate(at) {
    const date = new Date(at), offset = -date.getTimezoneOffset(), pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  }
  function timeReportRows(rows) {
    return [["Начало (местное, UTC-смещение)", "Окончание (местное, UTC-смещение)", "Занятие", "Проект", "Заметка", "Источник", "Секунд в выбранном периоде", "Полная длительность, секунд"],
      ...rows.filter(row => !isTimeEntryDeleted(row.entry) && row.entry.runningSince === null && timestamp(row.entry.finishedAt)).map(row => [reportDate(row.entry.createdAt), reportDate(row.entry.finishedAt), safeTimeReportText(row.entry.title), safeTimeReportText(row.entry.projectName), safeTimeReportText(row.entry.notes), row.entry.manual ? "Вручную" : "Таймер", row.durationMs / 1000, row.fullDurationMs / 1000])];
  }
  function createTimeTrackingController(options) {
    const now = options.now || Date.now, runtimeId = options.runtimeId || RUNTIME_ID;
    let chain = Promise.resolve();
    const read = () => normalizeTimeTracking(options.getWorkspace()?.timeTracking);
    const activeSession = () => { const item = options.getWorkspace()?.timeTracking?.active; return item ? clone(item) : null; };
    const needsRecovery = (active = read().active) => Boolean(active && active.runningSince !== null && active.runtimeId !== runtimeId);
    function mutate(operation) {
      const workspace = options.getWorkspace();
      const execute = async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте приложение заново.");
        const candidate = normalizeTimeTracking(workspace.timeTracking);
        const result = operation(candidate, workspace, now()); validateTimeTracking(candidate);
        const saved = await options.saveSnapshot(write, candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение учёта времени.");
        workspace.timeTracking = candidate; return result;
      };
      const run = chain.catch(() => {}).then(() => options.persistTransaction(execute));
      chain = run.catch(() => {}); return run;
    }
    function active(candidate, allowRecovery = false) {
      if (!candidate.active) throw new Error("Нет активной сессии.");
      if (!allowRecovery && needsRecovery(candidate.active)) throw new Error("После перезапуска уточните время окончания сессии.");
      return candidate.active;
    }
    function stopSegment(item, end) {
      if (item.runningSince !== null) {
        if (end < item.runningSince) throw new Error("Часы переведены назад. Уточните время окончания.");
        item.segments.push({ start: item.runningSince, end }); item.runningSince = null;
      }
    }
    function finish(candidate, item, end) {
      stopSegment(item, end); item.finishedAt = Math.max(end, item.segments.at(-1)?.end || item.createdAt);
      candidate.entries.push(item); candidate.active = null;
    }
    function binding(draft, workspace, previous = null) {
      if (previous && (!Object.hasOwn(draft, "taskId") && !Object.hasOwn(draft, "projectId") || draft.taskId === previous.taskId && draft.projectId === previous.projectId)) return { taskId: previous.taskId, projectId: previous.projectId, projectName: previous.projectName };
      const task = draft.taskId ? workspace.tasks?.find(item => item.id === draft.taskId) : null;
      if (draft.taskId && !task) throw new Error("Задача уже удалена или недоступна.");
      const project = workspace.taskProjects?.find(item => item.id === (task?.projectId || draft.projectId));
      if (!task && draft.projectId && !project) throw new Error("Проект уже удалён или недоступен.");
      return { taskId: task?.id || "", projectId: task?.projectId || project?.id || "", projectName: project?.name || "" };
    }
    function details(item, draft, workspace) {
      if (draft.expected && JSON.stringify(item) !== JSON.stringify(draft.expected)) throw new Error("Запись изменена в другом окне. Закройте форму и откройте её заново; ваш ввод пока сохранён в форме.");
      Object.assign(item, binding(draft, workspace, item));
      if (Object.hasOwn(draft, "title")) item.title = String(draft.title || "").trim();
      if (Object.hasOwn(draft, "notes")) item.notes = String(draft.notes || "");
    }
    function findEntry(candidate, id) {
      const item = candidate.entries.find(entry => entry.id === id);
      if (!item || isTimeEntryDeleted(item)) throw new Error("Запись удалена или недоступна.");
      return item;
    }
    function validateManualTime(draft, at) {
      if (!timestamp(draft.startedAt) || !Number.isSafeInteger(draft.durationMs) || draft.durationMs <= 0 || draft.durationMs > 366 * 86400000) throw new Error("Проверьте начало и длительность: от 1 мс до 366 дней.");
      if (draft.startedAt + draft.durationMs > at) throw new Error(`Окончание получается в будущем: ${new Date(draft.startedAt + draft.durationMs).toLocaleString("ru-RU")}, а текущее время — ${new Date(at).toLocaleString("ru-RU")}. Уменьшите длительность или выберите более раннее начало.`);
    }
    function checkOverlap(candidate, draft, at, exceptId = "") {
      if (draft.allowOverlap === true) return;
      const start = draft.startedAt, end = start + draft.durationMs;
      if ([...candidate.entries, ...(candidate.active ? [candidate.active] : [])].some(item => item.id !== exceptId && !isTimeEntryDeleted(item) && timeInRange(item, start, end, at) > 0)) throw new Error("Время пересекается с другой записью или таймером. Проверьте ввод либо явно разрешите пересечение.");
    }
    function startSession(candidate, workspace, draft, at) {
        if (candidate.active) throw new Error("Сначала завершите текущую сессию.");
        const links = binding(draft, workspace), task = workspace.tasks?.find(item => item.id === links.taskId);
        const title = String(draft.title || task?.title || "").trim(); if (!title) throw new Error("Укажите название занятия.");
        candidate.active = { id: options.createId("timesession"), title, notes: String(draft.notes || ""), ...links, createdAt: at, segments: [], runningSince: at, finishedAt: null, runtimeId };
    }
    return Object.freeze({ read, activeSession, needsRecovery,
      start: draft => mutate((candidate, workspace, at) => startSession(candidate, workspace, draft, at)),
      repeat: id => mutate((candidate, workspace, at) => {
        const item = findEntry(candidate, id), task = workspace.tasks?.find(task => task.id === item.taskId), project = workspace.taskProjects?.find(project => project.id === item.projectId);
        startSession(candidate, workspace, { title: item.title, notes: item.notes || "", taskId: task?.id || "", projectId: project?.id || "" }, at);
      }),
      pause: () => mutate((candidate, workspace, at) => { const item = active(candidate); if (item.runningSince === null) throw new Error("Сессия уже на паузе."); stopSegment(item, at); }),
      resume: () => mutate((candidate, workspace, at) => { const item = active(candidate); if (item.runningSince !== null) throw new Error("Таймер уже запущен."); item.runningSince = Math.max(at, item.segments.at(-1)?.end || item.createdAt); item.runtimeId = runtimeId; }),
      finish: () => mutate((candidate, workspace, at) => { finish(candidate, active(candidate), at); }),
      recover: (end, resume = false) => mutate((candidate, workspace, at) => {
        const item = active(candidate, true);
        if (!needsRecovery(item)) throw new Error("Сессия не требует восстановления.");
        if (!timestamp(end) || end < item.runningSince || end > at) throw new Error("Укажите время окончания между запуском таймера и текущим временем.");
        if (resume) { stopSegment(item, end); item.runningSince = at; item.runtimeId = runtimeId; }
        else finish(candidate, item, end);
      }),
      editActive: (id, draft) => mutate((candidate, workspace) => { const item = active(candidate, true); if (item.id !== id) throw new Error("Активная сессия уже изменилась."); details(item, draft, workspace); }),
      addManual: draft => mutate((candidate, workspace, at) => {
        validateManualTime(draft, at); checkOverlap(candidate, draft, at);
        const links = binding(draft, workspace), task = workspace.tasks?.find(item => item.id === links.taskId);
        const title = String(draft.title || task?.title || "").trim(); if (!title) throw new Error("Укажите название занятия.");
        const item = { id: options.createId("timesession"), title, notes: String(draft.notes || ""), ...links, createdAt: draft.startedAt, finishedAt: draft.startedAt + draft.durationMs, segments: [{ start: draft.startedAt, end: draft.startedAt + draft.durationMs }], runningSince: null, runtimeId, manual: true };
        candidate.entries.push(item); return item;
      }),
      edit: (id, draft) => mutate((candidate, workspace, at) => {
        const item = findEntry(candidate, id); details(item, draft, workspace);
        if (Object.hasOwn(draft, "startedAt") || Object.hasOwn(draft, "durationMs")) {
          validateManualTime(draft, at);
          if (draft.startedAt !== item.createdAt || draft.durationMs !== sessionDuration(item, at)) {
            checkOverlap(candidate, draft, at, id);
            item.createdAt = draft.startedAt; item.finishedAt = draft.startedAt + draft.durationMs; item.segments = [{ start: item.createdAt, end: item.finishedAt }];
          }
        }
      }),
      removeEntry: id => mutate(candidate => {
        const item = findEntry(candidate, id);
        candidate.entries.splice(candidate.entries.indexOf(item), 1);
      }),
      setDailyGoal: minutes => mutate(candidate => { if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error("Цель: целое число от 0 до 1440 минут; 0 отключает цель."); candidate.dailyGoalMinutes = minutes; })
    });
  }
  window.ZETER_TIME_TRACKING_UTILS = Object.freeze({ normalizeTimeTracking, validateTimeTracking, timeInRange, sessionDuration, localRanges, formatTimeDuration, isTimeEntryDeleted, timeFilterRange, selectTimeEntries, summarizeTimeRows, timeWeekBuckets, safeTimeReportText, timeReportRows, createTimeTrackingController });
})();
