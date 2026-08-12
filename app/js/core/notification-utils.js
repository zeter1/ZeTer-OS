(() => {
  "use strict";

  const TASK_SOURCE_PREFIX = "task:";
  const CALENDAR_SOURCE_PREFIX = "calendar:";
  const NOTIFICATION_OPTION_FIELDS = Object.freeze([
    "action",
    "taskId",
    "taskTitle",
    "taskDescription",
    "taskProjectId",
    "taskProjectTitle",
    "taskListItemId",
    "taskStoreKind",
    "taskStoreTitle",
    "taskDesktopId",
    "calendarEventId",
    "calendarDate"
  ]);

  function notificationSource(notification = {}) {
    return String(notification.source || "");
  }

  function notificationCanOpen(notification = {}) {
    const source = notificationSource(notification);
    return notification.action === "open-task" || notification.action === "open-calendar" || source.startsWith(TASK_SOURCE_PREFIX) || source.startsWith(CALENDAR_SOURCE_PREFIX);
  }

  function notificationFilterKind(notification = {}) {
    const source = notificationSource(notification);
    if (notification.action === "open-task" || source.startsWith(TASK_SOURCE_PREFIX)) return "tasks";
    if (source.startsWith(CALENDAR_SOURCE_PREFIX)) return "calendar";
    return "system";
  }

  function notificationMatchesFilter(notification = {}, filter = "all") {
    const normalizedFilter = String(filter || "all");
    return normalizedFilter === "all" || notificationFilterKind(notification) === normalizedFilter;
  }

  function taskIdFromNotification(notification = {}) {
    if (notification.taskId) return String(notification.taskId);
    const match = notificationSource(notification).match(/^task:(.+)$/);
    return match ? match[1] : "";
  }

  function applyNotificationOptions(notification = {}, options = {}) {
    NOTIFICATION_OPTION_FIELDS.forEach(key => {
      if (options[key] !== undefined && options[key] !== null) notification[key] = options[key];
    });
    return notification;
  }

  function createNotificationRecord(title = "", text = "", options = {}, helpers = {}) {
    const id = typeof helpers.id === "function" ? helpers.id("notif") : helpers.id;
    const desktopId = options.desktopId || helpers.desktopId || "desktop";
    const normalizeNotificationRecord = typeof helpers.normalizeNotificationRecord === "function" ? helpers.normalizeNotificationRecord : item => item;
    const notification = normalizeNotificationRecord({
      id,
      title,
      text,
      time: helpers.time || Date.now(),
      read: false,
      source: options.source || "",
      desktopId
    });
    return applyNotificationOptions(notification, options);
  }

  function taskReminderNotificationDetails(task = {}, store = {}, helpers = {}) {
    const formatDate = typeof helpers.formatDate === "function" ? helpers.formatDate : value => value;
    const taskProjectTitle = typeof helpers.taskProjectTitle === "function" ? helpers.taskProjectTitle : () => "";
    const normalizeTaskReminderRepeatDays = typeof helpers.normalizeTaskReminderRepeatDays === "function" ? helpers.normalizeTaskReminderRepeatDays : value => Number(value) || 0;
    const taskReminderRepeatLabel = typeof helpers.taskReminderRepeatLabel === "function" ? helpers.taskReminderRepeatLabel : () => "";
    const taskDescriptionPreview = typeof helpers.taskDescriptionPreview === "function" ? helpers.taskDescriptionPreview : value => String(value || "");
    const title = task.title || "Без названия";
    const dueText = task.due && !task.indefinite ? ` · срок ${formatDate(task.due)}` : "";
    const projectTitle = taskProjectTitle(store.projects, task.projectId);
    const projectText = projectTitle ? ` · проект ${projectTitle}` : "";
    const repeatDays = normalizeTaskReminderRepeatDays(task.reminderRepeatDays);
    const repeatText = repeatDays ? ` · ${taskReminderRepeatLabel(repeatDays)}` : "";
    const endlessText = task.indefinite ? " · бессрочная" : "";
    const descriptionText = taskDescriptionPreview(task.description);
    return {
      title,
      text: `${descriptionText}${dueText}${projectText}${repeatText}${endlessText}`,
      repeatDays,
      options: {
        desktopId: store.desktopId,
        source: `task:${task.id}`,
        action: "open-task",
        taskId: task.id,
        taskTitle: title,
        taskDescription: descriptionText,
        taskProjectId: task.projectId || "",
        taskProjectTitle: projectTitle,
        taskListItemId: store.kind === "tasklist" ? store.itemId : "",
        taskStoreKind: store.kind,
        taskStoreTitle: store.title || "",
        taskDesktopId: store.desktopId,
        save: false
      }
    };
  }

  function collectTaskReminderStores(options = {}) {
    const {
      state = {},
      ensureDesktops = () => {},
      workspaceDefaults = () => ({}),
      normalizeTaskStore = () => {},
      desktopName = value => value,
      exportDesktopIdForItem = () => "desktop"
    } = options;
    ensureDesktops();
    const stores = [];
    const desktops = Array.isArray(state.desktops) ? state.desktops : [];
    desktops.forEach(desk => {
      desk.data = desk.data || workspaceDefaults();
      normalizeTaskStore(desk.data);
      stores.push({
        desktopId: desk.id,
        title: desktopName(desk.id),
        kind: "workspace",
        itemId: "",
        tasks: desk.data.tasks,
        projects: desk.data.taskProjects
      });
    });
    Object.values(state.fs || {}).forEach(item => {
      if (!item || item.type !== "tasklist") return;
      normalizeTaskStore(item);
      stores.push({
        desktopId: exportDesktopIdForItem(item),
        title: item.name || "Список задач",
        kind: "tasklist",
        itemId: item.id,
        tasks: item.tasks,
        projects: item.taskProjects
      });
    });
    return stores;
  }

  function collectDueTaskReminderNotifications(stores = [], options = {}) {
    const now = Number(options.now || Date.now());
    const taskReminderTime = typeof options.taskReminderTime === "function" ? options.taskReminderTime : () => 0;
    const nextTaskReminderValue = typeof options.nextTaskReminderValue === "function" ? options.nextTaskReminderValue : () => "";
    const notifications = [];
    (Array.isArray(stores) ? stores : []).forEach(store => {
      (store.tasks || []).forEach(task => {
        const time = taskReminderTime(task.reminderAt);
        if (!time || time > now) return;
        if (task.status === "done") return;
        if (Number(task.reminderNotifiedAt || 0) >= time) return;
        const notification = taskReminderNotificationDetails(task, store, options);
        const repeatDays = notification.repeatDays;
        notifications.push({ task, store, notification, reminderTime: time, repeatDays });
        if (repeatDays) {
          const nextReminder = nextTaskReminderValue(task.reminderAt, repeatDays, now);
          task.reminderAt = nextReminder || task.reminderAt;
          task.reminderNotifiedAt = 0;
        } else {
          task.reminderNotifiedAt = time;
        }
        task.updatedAt = now;
      });
    });
    return { changed: notifications.length > 0, notifications, now };
  }

  function localDateISO(date = new Date()) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function calendarOccurrenceTime(iso = "", time = "") {
    const dateMatch = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatch = String(time).match(/^(\d{2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) return 0;
    const value = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]),
      Number(timeMatch[2]),
      0,
      0
    ).getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function collectCalendarReminderStores(options = {}) {
    const {
      state = {},
      ensureDesktops = () => {},
      workspaceDefaults = () => ({}),
      desktopName = value => value
    } = options;
    ensureDesktops();
    return (Array.isArray(state.desktops) ? state.desktops : []).map(desktop => {
      desktop.data = desktop.data || workspaceDefaults();
      desktop.data.events = Array.isArray(desktop.data.events) ? desktop.data.events : [];
      return {
        desktopId: desktop.id,
        title: desktopName(desktop.id),
        events: desktop.data.events
      };
    });
  }

  function dueCalendarOccurrence(event = {}, options = {}) {
    const now = Number(options.now || Date.now());
    const occursOn = typeof options.occursOn === "function" ? options.occursOn : () => false;
    const reminderMinutes = Number(event.reminder);
    if (!event.start || !Number.isFinite(reminderMinutes) || reminderMinutes <= 0) return null;
    const nowDate = new Date(now);
    const candidates = [0, 1].map(offset => {
      const date = new Date(nowDate);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + offset);
      const iso = localDateISO(date);
      if (!occursOn(event, iso)) return null;
      const occurrenceTime = calendarOccurrenceTime(iso, event.start);
      const notifyAt = occurrenceTime - reminderMinutes * 60 * 1000;
      const key = `${iso}|${event.start}|${reminderMinutes}`;
      if (!occurrenceTime || event.reminderNotifiedOccurrence === key) return null;
      if (now < notifyAt || now > occurrenceTime + 5 * 60 * 1000) return null;
      return { iso, key, occurrenceTime, notifyAt, reminderMinutes };
    }).filter(Boolean).sort((left, right) => left.occurrenceTime - right.occurrenceTime);
    return candidates[0] || null;
  }

  function collectDueCalendarReminderNotifications(stores = [], options = {}) {
    const now = Number(options.now || Date.now());
    const notifications = [];
    (Array.isArray(stores) ? stores : []).forEach(store => {
      (Array.isArray(store.events) ? store.events : []).forEach(event => {
        const occurrence = dueCalendarOccurrence(event, { ...options, now });
        if (!occurrence) return;
        const location = event.location ? ` · ${event.location}` : "";
        notifications.push({
          event,
          store,
          occurrence,
          notification: {
            title: event.title || "Событие календаря",
            text: `${occurrence.iso} в ${event.start}${location}`,
            options: {
              desktopId: store.desktopId,
              source: `calendar:${event.id}:${occurrence.iso}`,
              action: "open-calendar",
              calendarEventId: event.id,
              calendarDate: occurrence.iso,
              save: false
            }
          }
        });
        event.reminderNotifiedOccurrence = occurrence.key;
        event.updatedAt = now;
      });
    });
    return { changed: notifications.length > 0, notifications, now };
  }

  function createTaskReminderWatcher(integration = {}) {
    const {
      getState = () => ({}),
      ensureDesktops = () => {},
      workspaceDefaults = () => ({}),
      normalizeTaskStore = () => {},
      desktopName = value => value,
      exportDesktopIdForItem = () => "desktop",
      taskReminderTime = () => 0,
      nextTaskReminderValue = () => "",
      formatDate = value => value,
      taskProjectTitle = () => "",
      normalizeTaskReminderRepeatDays = value => Number(value) || 0,
      taskReminderRepeatLabel = () => "",
      taskDescriptionPreview = value => String(value || ""),
      addNotification = () => {},
      getCurrentDesktopId = () => "desktop",
      shouldPopupNotification = () => true,
      toast = () => {},
      saveState = () => {},
      renderNotifications = () => {},
      refreshWorkspaceWindows = () => {},
      safeInitStep = (_name, callback) => callback(),
      now = () => Date.now(),
      setTimer = (callback, delay) => setInterval(callback, delay),
      clearTimer = timer => clearInterval(timer),
      intervalMs = 30000
    } = integration;
    let timer = null;

    function stores() {
      return collectTaskReminderStores({
        state: getState(),
        ensureDesktops,
        workspaceDefaults,
        normalizeTaskStore,
        desktopName,
        exportDesktopIdForItem
      });
    }

    function check() {
      const result = collectDueTaskReminderNotifications(stores(), {
        now: now(),
        taskReminderTime,
        nextTaskReminderValue,
        formatDate,
        taskProjectTitle,
        normalizeTaskReminderRepeatDays,
        taskReminderRepeatLabel,
        taskDescriptionPreview
      });
      result.notifications.forEach(({ notification }) => {
        addNotification(notification.title, notification.text, notification.options);
      });
      const visible = result.notifications.find(entry => entry.store.desktopId === getCurrentDesktopId() && shouldPopupNotification(entry.notification.options));
      if (visible) toast("Напоминание о задаче", visible.task.title);
      if (result.changed) {
        saveState();
        renderNotifications();
        refreshWorkspaceWindows();
      }
      return result;
    }

    function schedule() {
      if (timer) clearTimer(timer);
      timer = setTimer(() => safeInitStep("checkTaskReminders", check), intervalMs);
      return timer;
    }

    function start() {
      check();
      schedule();
    }

    return Object.freeze({ stores, check, schedule, start });
  }

  function createCalendarReminderWatcher(integration = {}) {
    const {
      getState = () => ({}),
      ensureDesktops = () => {},
      workspaceDefaults = () => ({}),
      desktopName = value => value,
      occursOn = () => false,
      addNotification = () => {},
      getCurrentDesktopId = () => "desktop",
      shouldPopupNotification = () => true,
      toast = () => {},
      saveState = () => {},
      renderNotifications = () => {},
      refreshWorkspaceWindows = () => {},
      safeInitStep = (_name, callback) => callback(),
      now = () => Date.now(),
      setTimer = (callback, delay) => setInterval(callback, delay),
      clearTimer = timer => clearInterval(timer),
      intervalMs = 30000
    } = integration;
    let timer = null;

    function stores() {
      return collectCalendarReminderStores({ state: getState(), ensureDesktops, workspaceDefaults, desktopName });
    }

    function check() {
      const result = collectDueCalendarReminderNotifications(stores(), { now: now(), occursOn });
      result.notifications.forEach(({ notification }) => addNotification(notification.title, notification.text, notification.options));
      const visible = result.notifications.find(entry => entry.store.desktopId === getCurrentDesktopId() && shouldPopupNotification(entry.notification.options));
      if (visible) toast("Напоминание календаря", visible.event.title || "Событие");
      if (result.changed) {
        saveState();
        renderNotifications();
        refreshWorkspaceWindows();
      }
      return result;
    }

    function schedule() {
      if (timer) clearTimer(timer);
      timer = setTimer(() => safeInitStep("checkCalendarReminders", check), intervalMs);
      return timer;
    }

    function start() {
      check();
      schedule();
    }

    return Object.freeze({ stores, check, schedule, start });
  }

  window.ZETER_NOTIFICATION_UTILS = Object.freeze({
    NOTIFICATION_OPTION_FIELDS,
    applyNotificationOptions,
    createNotificationRecord,
    notificationCanOpen,
    notificationFilterKind,
    notificationMatchesFilter,
    taskIdFromNotification,
    taskReminderNotificationDetails,
    collectTaskReminderStores,
    collectDueTaskReminderNotifications,
    createTaskReminderWatcher,
    localDateISO,
    calendarOccurrenceTime,
    collectCalendarReminderStores,
    dueCalendarOccurrence,
    collectDueCalendarReminderNotifications,
    createCalendarReminderWatcher
  });
})();
