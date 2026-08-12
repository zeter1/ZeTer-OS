(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const notificationUtils = window.ZETER_NOTIFICATION_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS notification UI utils require core utils.");
  if (!notificationUtils) throw new Error("ZeTer OS notification UI utils require notification utils.");

  const { escapeHtml } = coreUtils;
  const {
    createNotificationRecord,
    notificationCanOpen,
    notificationMatchesFilter,
    taskIdFromNotification
  } = notificationUtils;

  function notificationCardHTML(notification = {}, options = {}) {
    const openable = Boolean(options.openable);
    const time = new Date(notification.time || Date.now()).toLocaleTimeString("ru-RU");
    return `<div class="notification ${notification.read ? "read" : "unread"}${openable ? " openable" : ""}" data-notification-id="${escapeHtml(notification.id)}" ${openable ? `role="button" tabindex="0" title="Открыть связанный объект"` : ""}><button class="notification-delete" data-delete-notification="${escapeHtml(notification.id)}" title="Удалить уведомление" aria-label="Удалить уведомление">×</button><b>${escapeHtml(notification.title)}</b><span class="notification-text">${escapeHtml(notification.text)} · ${time}</span></div>`;
  }

  function notificationsEmptyHTML() {
    return `<p class="muted">Уведомлений нет.</p>`;
  }

  function notificationListHTML(notifications = [], options = {}) {
    const filter = options.filter || "all";
    const matchesFilter = typeof options.matchesFilter === "function" ? options.matchesFilter : () => true;
    const canOpen = typeof options.canOpen === "function" ? options.canOpen : () => false;
    const filtered = notifications.filter(notification => matchesFilter(notification, filter));
    return filtered
      .slice()
      .reverse()
      .map(notification => notificationCardHTML(notification, { openable: canOpen(notification) }))
      .join("") || notificationsEmptyHTML();
  }

  function notificationCenterAction(target) {
    const deleteButton = target?.closest?.("[data-delete-notification]");
    if (deleteButton) return { type: "delete", id: deleteButton.dataset.deleteNotification || "" };
    const filterButton = target?.closest?.("[data-notification-filter]");
    if (filterButton) return { type: "filter", filter: filterButton.dataset.notificationFilter || "all" };
    const card = target?.closest?.("[data-notification-id]");
    if (card) return { type: "open", id: card.dataset.notificationId || "" };
    return null;
  }

  function notificationCenterKeyAction(event) {
    if (!["Enter", " "].includes(event?.key)) return null;
    const card = event.target?.closest?.("[data-notification-id]");
    if (!card) return null;
    return { type: "open", id: card.dataset.notificationId || "" };
  }

  function miniAgendaHTML(events = []) {
    const items = events
      .map(event => `<div class="agenda-mini-card"><b>${escapeHtml(event.start)}</b><span>${escapeHtml(event.title)}</span></div>`)
      .join("");
    return items || `<p class="muted">На сегодня событий нет.</p>`;
  }

  function miniAgendaTitle(date = new Date()) {
    return date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  }

  function renderNotificationCenterView(options = {}) {
    const list = options.list || null;
    const filterButtons = Array.isArray(options.filterButtons)
      ? options.filterButtons
      : Array.from(options.filterButtons || []);
    const agenda = options.agenda || null;
    const agendaTitle = options.agendaTitle || null;
    const filter = options.filter || "all";

    filterButtons.forEach(button => {
      button.classList.toggle("active", button.dataset.notificationFilter === filter);
    });
    if (list) {
      list.innerHTML = notificationListHTML(options.notifications || [], {
        filter,
        matchesFilter: options.matchesFilter,
        canOpen: options.canOpen
      });
    }
    if (agenda) agenda.innerHTML = miniAgendaHTML(options.events || []);
    if (agendaTitle) agendaTitle.textContent = miniAgendaTitle(options.date || new Date());
  }

  function createNotificationCenterController(integration = {}) {
    const {
      document,
      getFilter = () => "all",
      setFilter = () => {},
      getNotifications = () => [],
      setNotifications = () => {},
      getCurrentDesktopId = () => "desktop",
      getWorkspaceForDesktop = () => ({ notifications: [] }),
      getEventsForDate = () => [],
      todayISO = () => "",
      uid = () => "",
      normalizeNotificationRecord = item => item,
      saveState = () => {},
      random = Math.random
    } = integration;

    function updateBadge() {
      const badge = document.querySelector("#notif-count");
      if (!badge) return;
      const unread = getNotifications().filter(notification => !notification.read).length;
      badge.textContent = unread;
      badge.classList.toggle("hidden", unread === 0);
    }

    function markRead() {
      const notifications = getNotifications();
      let changed = false;
      notifications.forEach(notification => {
        if (!notification.read) {
          notification.read = true;
          changed = true;
        }
      });
      if (changed) saveState();
      updateBadge();
      return changed;
    }

    function render() {
      const list = document.querySelector("#notification-list");
      if (!list) return;
      updateBadge();
      renderNotificationCenterView({
        list,
        filterButtons: document.querySelectorAll("[data-notification-filter]"),
        agenda: document.querySelector("#mini-agenda"),
        agendaTitle: document.querySelector("#mini-date-title"),
        filter: getFilter() || "all",
        notifications: getNotifications(),
        matchesFilter: notificationMatchesFilter,
        canOpen: notificationCanOpen,
        events: getEventsForDate(todayISO()).slice(0, 5),
        date: new Date()
      });
    }

    function deleteNotification(id) {
      if (!id) return false;
      setNotifications(getNotifications().filter(notification => notification.id !== id));
      saveState();
      render();
      return true;
    }

    function addNotification(title, text, options = {}) {
      const desktopId = options.desktopId || getCurrentDesktopId();
      const workspace = getWorkspaceForDesktop(desktopId);
      const notification = createNotificationRecord(title, text, options, {
        id: uid,
        desktopId,
        normalizeNotificationRecord
      });
      workspace.notifications.push(notification);
      if (options.save !== false) saveState();
      if (desktopId === getCurrentDesktopId()) render();
      else updateBadge();
      return notification;
    }

    function selectFilter(filter = "all") {
      setFilter(filter);
      render();
    }

    function systemPulse() {
      const soon = getEventsForDate(todayISO()).length;
      if (soon && random() > 0.7) render();
    }

    return Object.freeze({ updateBadge, markRead, render, deleteNotification, addNotification, selectFilter, systemPulse });
  }

  function bindNotificationCenter(options = {}) {
    const notificationList = options.notificationList;
    const notificationCenter = options.notificationCenter;
    const controller = options.controller;
    const openNotification = typeof options.openNotification === "function" ? options.openNotification : () => {};
    if (!notificationList || !controller) return false;
    notificationList.addEventListener("click", event => {
      const action = notificationCenterAction(event.target);
      if (action?.type === "delete") {
        event.preventDefault();
        event.stopPropagation();
        controller.deleteNotification(action.id);
        return;
      }
      if (action?.type === "open") openNotification(action.id);
    });
    notificationCenter?.addEventListener("click", event => {
      const action = notificationCenterAction(event.target);
      if (action?.type === "filter") controller.selectFilter(action.filter);
    });
    notificationList.addEventListener("keydown", event => {
      const action = notificationCenterKeyAction(event);
      if (!action) return;
      event.preventDefault();
      openNotification(action.id);
    });
    return true;
  }

  function createTaskNotificationController(integration = {}) {
    const {
      getNotifications = () => [],
      getCurrentDesktopId = () => "desktop",
      taskNavigator = null,
      openCalendar = () => false,
      toast = () => {}
    } = integration;

    function openNotification(notification = {}) {
      if (notification.action === "open-calendar" || String(notification.source || "").startsWith("calendar:")) {
        return Boolean(openCalendar(notification));
      }
      const taskId = taskIdFromNotification(notification);
      if (!taskId || !notificationCanOpen(notification)) return false;
      return Boolean(taskNavigator?.openTaskTarget?.({
        taskId,
        desktopId: notification.taskDesktopId || notification.desktopId || getCurrentDesktopId(),
        taskStoreKind: notification.taskStoreKind || "",
        taskListItemId: notification.taskStoreKind === "tasklist" || notification.taskListItemId
          ? notification.taskListItemId
          : "",
        projectId: notification.taskProjectId,
        closeBeforeOpen: true,
        onMissing: () => toast("Список задач не найден", "Он мог быть удалён или перемещён."),
        onOpened: ({ task, storeKind, storeTitle }) => {
          if (storeKind === "tasklist") toast("Открыт список задач", storeTitle);
          else toast("Открыта задача", task?.title || notification.taskTitle || "Напоминание");
        }
      }));
    }

    function openById(id = "") {
      const notification = getNotifications().find(item => item.id === id);
      return notification ? openNotification(notification) : false;
    }

    return Object.freeze({ openNotification, openById });
  }

  window.ZETER_NOTIFICATION_UI_UTILS = Object.freeze({
    notificationCardHTML,
    notificationListHTML,
    notificationsEmptyHTML,
    notificationCenterAction,
    notificationCenterKeyAction,
    miniAgendaHTML,
    miniAgendaTitle,
    renderNotificationCenterView,
    createNotificationCenterController,
    bindNotificationCenter,
    createTaskNotificationController
  });
})();
