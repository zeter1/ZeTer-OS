(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const utils = window.ZETER_CORE_UTILS;
  if (!config || !utils) throw new Error("ZeTer OS data normalizers require config and utils.");

  const {
    BACKUP_IMPORT_MAX_TEXT_CHARS,
    BACKUP_IMPORT_MAX_TASK_CHECKLIST_ITEMS,
    CALENDAR_MAX_EVENTS,
    NOTIFICATION_MAX_ITEMS
  } = config;

  const {
    pad,
    uid,
    todayISO,
    normalizeSafeId,
    isSafeId,
    truncateText
  } = utils;

  const CALENDAR_CATEGORY_IDS = new Set(config.CALENDAR_CATEGORY_IDS);
  const CALENDAR_REPEAT_IDS = new Set(config.CALENDAR_REPEAT_IDS);
  const CALENDAR_REMINDER_IDS = new Set(config.CALENDAR_REMINDER_IDS);

  const DEFAULT_TASK_PROJECT_NAME = "Входящие";
  const TASK_TITLE_MAX_CHARS = 500;
  const TASK_DESCRIPTION_MAX_CHARS = BACKUP_IMPORT_MAX_TEXT_CHARS;
  const TASK_TAG_MAX_CHARS = 120;
  const TASK_CHECKLIST_MAX_ITEMS = BACKUP_IMPORT_MAX_TASK_CHECKLIST_ITEMS;
  const TASK_CHECKLIST_TEXT_MAX_CHARS = 500;
  const TASK_PROJECT_UNASSIGNED = "__unassigned__";
  const TASK_REMINDER_CHECK_MS = 30000;
  const TASK_STATUSES = new Set(["todo", "doing", "review", "done"]);
  const TASK_PRIORITIES = new Set(["low", "medium", "high"]);

  function taskWindowTitleFromName(name = "") {
    const clean = String(name || "").trim();
    if (!clean) return "Задачи";
    return clean.toLowerCase().startsWith("задачи") ? clean : `Задачи ${clean}`;
  }

  function taskDateTimeInputValue(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function normalizeTaskReminderValue(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (!match) {
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? "" : taskDateTimeInputValue(parsed);
    }
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const hh = Number(match[4] || 9);
    const mm = Number(match[5] || 0);
    const parsed = new Date(y, m - 1, d, hh, mm);
    return Number.isNaN(parsed.getTime()) ? "" : taskDateTimeInputValue(parsed);
  }

  function taskReminderTime(value = "") {
    const normalized = normalizeTaskReminderValue(value);
    if (!normalized) return 0;
    const parsed = new Date(normalized);
    const time = parsed.getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function taskReminderLabel(value = "") {
    const time = taskReminderTime(value);
    if (!time) return "";
    return new Date(time).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function taskDescriptionPreview(text = "", max = 120) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "Описание не указано";
    const limit = Math.max(32, Number(max) || 120);
    return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
  }

  function priorityName(priority = "") {
    return { high: "Высокий", medium: "Средний", low: "Низкий" }[priority] || priority;
  }

  function statusName(status = "") {
    return { todo: "Нужно сделать", doing: "В работе", review: "На проверке", done: "Готово" }[status] || status;
  }

  function normalizeTaskReminderRepeatDays(value = 0) {
    const number = Math.floor(Number(value) || 0);
    if (!Number.isFinite(number) || number < 1) return 0;
    return Math.min(number, 3650);
  }

  function taskReminderRepeatLabel(days = 0) {
    const count = normalizeTaskReminderRepeatDays(days);
    if (!count) return "";
    const lastTwo = count % 100;
    const last = count % 10;
    const word = lastTwo >= 11 && lastTwo <= 14 ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней";
    return `каждые ${count} ${word}`;
  }

  function nextTaskReminderValue(value = "", repeatDays = 0, after = Date.now()) {
    const days = normalizeTaskReminderRepeatDays(repeatDays);
    const baseTime = taskReminderTime(value);
    if (!days || !baseTime) return "";
    const next = new Date(baseTime);
    const dayMs = 24 * 60 * 60 * 1000;
    const elapsedPeriods = Math.max(1, Math.floor((Number(after) - baseTime) / (days * dayMs)) + 1);
    next.setDate(next.getDate() + elapsedPeriods * days);
    while (next.getTime() <= after) next.setDate(next.getDate() + days);
    return taskDateTimeInputValue(next);
  }

  function taskProjectTitle(projects = [], projectId = "") {
    const project = (projects || []).find(item => item.id === projectId);
    return String(project?.name || "").trim();
  }

  function defaultTaskReminderValue(task = {}) {
    if (task.reminderAt) return normalizeTaskReminderValue(task.reminderAt);
    const fallback = new Date(Date.now() + 30 * 60 * 1000);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(task.due || ""))) {
      const [y, m, d] = String(task.due).split("-").map(Number);
      const dueMorning = new Date(y, m - 1, d, 9, 0);
      if (dueMorning.getTime() > Date.now()) return taskDateTimeInputValue(dueMorning);
    }
    return taskDateTimeInputValue(fallback);
  }

  function makeTaskProject(name = DEFAULT_TASK_PROJECT_NAME) {
    return { id: uid("project"), name: String(name || DEFAULT_TASK_PROJECT_NAME).trim() || DEFAULT_TASK_PROJECT_NAME, createdAt: Date.now(), updatedAt: Date.now() };
  }

  function makeTask(input = {}, options = {}) {
    const now = Number(options.now) || Date.now();
    const fallbackProjectId = String(options.fallbackProjectId || input.projectId || TASK_PROJECT_UNASSIGNED);
    return normalizeTask({
      id: uid("task"),
      title: input.title || "Без названия",
      description: input.description || "",
      status: input.status || "todo",
      priority: input.priority || "medium",
      due: input.indefinite ? "" : (input.due || ""),
      tag: input.tag || "",
      projectId: input.projectId || fallbackProjectId,
      pinned: false,
      pinnedAt: 0,
      reminderAt: "",
      reminderNotifiedAt: 0,
      reminderRepeatDays: 0,
      indefinite: Boolean(input.indefinite),
      checklist: [],
      createdAt: now,
      updatedAt: now
    }, fallbackProjectId);
  }

  function updateTaskTitleDescription(task = {}, input = {}, now = Date.now()) {
    if (!task || typeof task !== "object") return task;
    task.title = truncateText(String(input.title || "Без названия").trim() || "Без названия", TASK_TITLE_MAX_CHARS);
    task.description = truncateText(input.description || "", TASK_DESCRIPTION_MAX_CHARS);
    task.updatedAt = Number(now) || Date.now();
    return task;
  }

  function updateTaskPriority(task = {}, priority = "", now = Date.now()) {
    if (!task || typeof task !== "object" || !TASK_PRIORITIES.has(priority) || task.priority === priority) return false;
    task.priority = priority;
    task.updatedAt = Number(now) || Date.now();
    return true;
  }

  function updateTaskChecklistItem(task = {}, subId = "", done = false, now = Date.now()) {
    const checklist = Array.isArray(task?.checklist) ? task.checklist : [];
    const item = checklist.find(entry => entry.id === subId);
    if (!item) return false;
    item.done = Boolean(done);
    task.updatedAt = Number(now) || Date.now();
    return true;
  }

  function toggleTaskPinned(task = {}, now = Date.now()) {
    if (!task || typeof task !== "object") return task;
    task.pinned = !task.pinned;
    task.pinnedAt = task.pinned ? (Number(now) || Date.now()) : 0;
    task.updatedAt = Number(now) || Date.now();
    return task;
  }

  function setTaskIndefinite(task = {}, indefinite = false, due = "", now = Date.now()) {
    if (!task || typeof task !== "object") return task;
    task.indefinite = Boolean(indefinite);
    task.due = task.indefinite ? "" : String(due || "");
    task.updatedAt = Number(now) || Date.now();
    return task;
  }

  function setTaskReminder(task = {}, value = "", repeatDays = 0, now = Date.now()) {
    if (!task || typeof task !== "object") return task;
    task.reminderAt = normalizeTaskReminderValue(value);
    task.reminderNotifiedAt = 0;
    task.reminderRepeatDays = normalizeTaskReminderRepeatDays(repeatDays);
    task.updatedAt = Number(now) || Date.now();
    return task;
  }

  function clearTaskReminder(task = {}, now = Date.now()) {
    return setTaskReminder(task, "", 0, now);
  }

  function normalizeTaskProject(project, fallbackName = DEFAULT_TASK_PROJECT_NAME) {
    const clean = project && typeof project === "object" ? project : {};
    clean.id = normalizeSafeId(clean.id, "project");
    clean.name = truncateText(String(clean.name || fallbackName).trim() || fallbackName, 160);
    clean.createdAt = Number(clean.createdAt) || Date.now();
    clean.updatedAt = Number(clean.updatedAt) || clean.createdAt;
    return clean;
  }

  function normalizeTask(task, fallbackProjectId) {
    const clean = task && typeof task === "object" ? task : {};
    clean.id = normalizeSafeId(clean.id, "task");
    clean.title = truncateText(String(clean.title || "Без названия").trim() || "Без названия", TASK_TITLE_MAX_CHARS);
    clean.description = truncateText(clean.description || "", TASK_DESCRIPTION_MAX_CHARS);
    clean.status = TASK_STATUSES.has(clean.status) ? clean.status : "todo";
    clean.priority = TASK_PRIORITIES.has(clean.priority) ? clean.priority : "medium";
    clean.due = clean.due || "";
    clean.tag = truncateText(clean.tag || "", TASK_TAG_MAX_CHARS);
    clean.checklist = Array.isArray(clean.checklist)
      ? clean.checklist.slice(0, TASK_CHECKLIST_MAX_ITEMS).map(sub => ({
        id: normalizeSafeId(sub?.id, "sub"),
        text: truncateText(sub?.text || "", TASK_CHECKLIST_TEXT_MAX_CHARS),
        done: Boolean(sub?.done)
      }))
      : [];
    clean.projectId = isSafeId(String(clean.projectId || "")) ? String(clean.projectId) : fallbackProjectId;
    clean.createdAt = Number(clean.createdAt) || Date.now();
    clean.updatedAt = Number(clean.updatedAt) || clean.createdAt;
    clean.pinned = Boolean(clean.pinned);
    clean.pinnedAt = clean.pinned ? (Number(clean.pinnedAt) || clean.updatedAt || clean.createdAt || Date.now()) : 0;
    clean.reminderAt = normalizeTaskReminderValue(clean.reminderAt || clean.reminder || "");
    clean.reminderNotifiedAt = clean.reminderAt ? (Number(clean.reminderNotifiedAt) || 0) : 0;
    clean.reminderRepeatDays = normalizeTaskReminderRepeatDays(clean.reminderRepeatDays || clean.repeatReminderDays || clean.reminderEveryDays || 0);
    clean.indefinite = Boolean(clean.indefinite || clean.endless || clean.isEndless);
    delete clean.reminder;
    delete clean.repeatReminderDays;
    delete clean.reminderEveryDays;
    delete clean.endless;
    delete clean.isEndless;
    return clean;
  }

  function normalizeTaskStore(store = {}) {
    if (!store || typeof store !== "object") return store;
    store.tasks = Array.isArray(store.tasks) ? store.tasks : [];
    store.taskProjects = Array.isArray(store.taskProjects) ? store.taskProjects : (Array.isArray(store.projects) ? store.projects : []);
    store.taskProjects = store.taskProjects.map((project, index) => normalizeTaskProject(project, index ? `Проект ${index + 1}` : DEFAULT_TASK_PROJECT_NAME));
    if (!store.taskProjects.length) store.taskProjects = [makeTaskProject(DEFAULT_TASK_PROJECT_NAME)];
    const fallbackProjectId = store.taskProjects[0].id;
    const projectIds = new Set(store.taskProjects.map(project => project.id));
    store.tasks = store.tasks.map(task => normalizeTask(task, fallbackProjectId));
    store.tasks.forEach(task => { if (!projectIds.has(task.projectId)) task.projectId = fallbackProjectId; });
    if (!projectIds.has(store.activeTaskProjectId)) store.activeTaskProjectId = fallbackProjectId;
    delete store.projects;
    return store;
  }

  function normalizeTaskListsData(target = {}) {
    const fs = target?.fs || {};
    Object.values(fs).forEach(item => {
      if (!item || item.type !== "tasklist") return;
      item.name = String(item.name || "Новый список задач").trim() || "Новый список задач";
      item.extension = item.extension || "tasks";
      normalizeTaskStore(item);
    });
    return target;
  }

  function normalizeCalendarCategory(value = "") {
    const category = String(value || "").trim();
    return CALENDAR_CATEGORY_IDS.has(category) ? category : "personal";
  }

  function normalizeCalendarRepeat(value = "") {
    const repeat = String(value || "").trim();
    return CALENDAR_REPEAT_IDS.has(repeat) ? repeat : "none";
  }

  function normalizeCalendarReminder(value = "") {
    const reminder = String(value || "").trim();
    return CALENDAR_REMINDER_IDS.has(reminder) ? reminder : "15";
  }

  function normalizeCalendarTime(value = "") {
    const raw = String(value || "").trim();
    return /^\d{2}:\d{2}$/.test(raw) ? raw : "";
  }

  function normalizeCalendarDate(value = "") {
    const raw = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayISO();
  }

  function normalizeCalendarEvent(event = {}) {
    const clean = event && typeof event === "object" ? event : {};
    clean.id = normalizeSafeId(clean.id, "event");
    clean.title = truncateText(String(clean.title || "Без названия").trim() || "Без названия", 500);
    clean.date = normalizeCalendarDate(clean.date);
    clean.start = normalizeCalendarTime(clean.start);
    clean.end = normalizeCalendarTime(clean.end);
    clean.category = normalizeCalendarCategory(clean.category);
    clean.repeat = normalizeCalendarRepeat(clean.repeat);
    clean.reminder = normalizeCalendarReminder(clean.reminder);
    clean.reminderNotifiedOccurrence = truncateText(String(clean.reminderNotifiedOccurrence || ""), 80);
    clean.location = truncateText(clean.location || "", 500);
    clean.description = truncateText(clean.description || "", BACKUP_IMPORT_MAX_TEXT_CHARS);
    return clean;
  }

  function normalizeCalendarEvents(events = []) {
    return Array.isArray(events) ? events.slice(0, CALENDAR_MAX_EVENTS).map(normalizeCalendarEvent) : [];
  }

  function normalizeCalendarStore(store = {}) {
    if (!store || typeof store !== "object") return store;
    store.events = normalizeCalendarEvents(store.events);
    return store;
  }

  function normalizeNotificationRecord(notification = {}) {
    const clean = notification && typeof notification === "object" ? notification : {};
    clean.id = normalizeSafeId(clean.id, "notif");
    clean.title = truncateText(clean.title || "ZeTer OS", 500);
    clean.text = truncateText(clean.text || "", 1000);
    clean.time = Number(clean.time) || Date.now();
    clean.read = Boolean(clean.read);
    if (clean.taskId) clean.taskId = normalizeSafeId(clean.taskId, "task");
    if (clean.taskProjectId) clean.taskProjectId = normalizeSafeId(clean.taskProjectId, "project");
    if (clean.taskListItemId) clean.taskListItemId = normalizeSafeId(clean.taskListItemId, "item");
    if (clean.calendarEventId) clean.calendarEventId = normalizeSafeId(clean.calendarEventId, "event");
    if (clean.calendarDate) clean.calendarDate = normalizeCalendarDate(clean.calendarDate);
    return clean;
  }

  function normalizeNotifications(notifications = []) {
    return Array.isArray(notifications) ? notifications.slice(-NOTIFICATION_MAX_ITEMS).map(normalizeNotificationRecord) : [];
  }

  function normalizeNotificationStore(store = {}) {
    if (!store || typeof store !== "object") return store;
    store.notifications = normalizeNotifications(store.notifications);
    return store;
  }

  Object.defineProperty(window, "ZETER_DATA_NORMALIZERS", {
    value: Object.freeze({
      DEFAULT_TASK_PROJECT_NAME,
      TASK_TITLE_MAX_CHARS,
      TASK_DESCRIPTION_MAX_CHARS,
      TASK_TAG_MAX_CHARS,
      TASK_CHECKLIST_MAX_ITEMS,
      TASK_CHECKLIST_TEXT_MAX_CHARS,
      TASK_PROJECT_UNASSIGNED,
      TASK_REMINDER_CHECK_MS,
      taskWindowTitleFromName,
      taskDateTimeInputValue,
      normalizeTaskReminderValue,
      taskReminderTime,
      taskReminderLabel,
      taskDescriptionPreview,
      priorityName,
      statusName,
      normalizeTaskReminderRepeatDays,
      taskReminderRepeatLabel,
      nextTaskReminderValue,
      taskProjectTitle,
      defaultTaskReminderValue,
      makeTaskProject,
      makeTask,
      updateTaskTitleDescription,
      updateTaskPriority,
      updateTaskChecklistItem,
      toggleTaskPinned,
      setTaskIndefinite,
      setTaskReminder,
      clearTaskReminder,
      normalizeTaskProject,
      normalizeTask,
      normalizeTaskStore,
      normalizeTaskListsData,
      normalizeCalendarCategory,
      normalizeCalendarRepeat,
      normalizeCalendarReminder,
      normalizeCalendarTime,
      normalizeCalendarDate,
      normalizeCalendarEvent,
      normalizeCalendarEvents,
      normalizeCalendarStore,
      normalizeNotificationRecord,
      normalizeNotifications,
      normalizeNotificationStore
    }),
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
