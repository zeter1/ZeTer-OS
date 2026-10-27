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
    notificationLinkedObject,
    notificationMatchesFilter,
    taskIdFromNotification
  } = notificationUtils;

  function notificationCardHTML(notification = {}, options = {}) {
    const openable = Boolean(options.openable);
    const time = new Date(notification.time || Date.now()).toLocaleTimeString("ru-RU");
    const updateAction = notification.action === "open-update" && /^update:\d+\.\d+\.\d+$/.test(notification.source || "")
      ? `<p class="update-restart-notice"><strong>ZeTer OS перезапустится автоматически.</strong> Во время установки окно закроется, затем программа запустится сама. Дождитесь её открытия. Не запускайте программу вручную.</p><div class="notification-update-actions"><button type="button" class="notification-update-action" data-update-install>Обновить</button><button type="button" data-update-news>Что нового</button><button type="button" data-update-manual>Обновить вручную</button></div>` : "";
    return `<div class="notification ${notification.read ? "read" : "unread"}${openable ? " openable" : ""}" data-notification-id="${escapeHtml(notification.id)}" ${openable ? `role="button" tabindex="0" title="Открыть связанный объект"` : ""}><button class="notification-delete" data-delete-notification="${escapeHtml(notification.id)}" title="Удалить уведомление" aria-label="Удалить уведомление">×</button><b>${escapeHtml(notification.title)}</b><span class="notification-text">${escapeHtml(notification.text)} · ${time}</span>${updateAction}</div>`;
  }

  function notificationsEmptyHTML() {
    return `<p class="muted">Уведомлений нет.</p>`;
  }

  function driveIncomingHTML(incoming, popup = false) {
    if (!incoming?.key) return "";
    const busy = Boolean(incoming.busy);
    return `<section class="drive-incoming-notice${popup ? " drive-incoming-popup" : ""}" data-drive-incoming-notice data-incoming-key="${escapeHtml(incoming.key)}" aria-busy="${busy}"><b>Доступны новые данные</b><p>${escapeHtml(incoming.text || "На другом устройстве появились новые данные. Загрузить их сейчас?")}</p><div class="drive-incoming-actions"><button type="button" data-drive-incoming-action="accept" ${busy ? "disabled" : ""}>Загрузить новые данные</button><button type="button" data-drive-incoming-action="defer" ${busy ? "disabled" : ""}>Позже</button></div><span class="drive-incoming-progress" role="status">${busy ? "Проверяем и загружаем данные…" : ""}</span></section>`;
  }

  // This projection deliberately lives outside workspace notifications and synced state.
  function createDriveIncomingController(options = {}) {
    const document = options.document;
    let incoming = null, popup = null, popupKey = "", pendingKey = "";
    const announced = new Set();
    function getIncoming() { return incoming ? { ...incoming, busy: Boolean(incoming.busy || pendingKey === incoming.key) } : null; }
    function focusedAction() {
      const button = document.activeElement?.closest?.("[data-drive-incoming-action]");
      return button ? { name: button.dataset.driveIncomingAction, key: button.closest("[data-incoming-key]")?.dataset.incomingKey } : null;
    }
    function restoreFocus(target) {
      if (!target || (document.activeElement && document.activeElement !== document.body)) return;
      const button = [...document.querySelectorAll("[data-drive-incoming-action]")].find(item => !item.disabled && item.dataset.driveIncomingAction === target.name && item.closest("[data-incoming-key]")?.dataset.incomingKey === target.key);
      button?.focus();
    }
    function render() {
      const focused = focusedAction();
      if (popup) { popup.remove(); popup = null; }
      const offer = getIncoming();
      if (offer && popupKey === offer.key && !offer.deferred) {
        popup = document.createElement("div");
        popup.className = "drive-incoming-popup-host";
        popup.setAttribute("aria-live", "polite");
        popup.innerHTML = driveIncomingHTML(offer, true);
        document.body.append(popup);
      }
      options.onChange?.();
      restoreFocus(focused);
    }
    function setIncoming(value) {
      incoming = value?.key ? { ...value } : null;
      if (!incoming) { popupKey = ""; pendingKey = ""; }
      else if (!incoming.deferred && !announced.has(incoming.key)) {
        announced.add(incoming.key);
        popupKey = incoming.key;
      }
      render();
    }
    async function action(name, key) {
      if (!["accept", "defer"].includes(name) || !incoming || incoming.key !== key || incoming.busy || pendingKey) return false;
      const focused = focusedAction();
      if (name === "defer") {
        // Hide immediately while retaining the notification-center projection.
        popupKey = "";
        incoming = { ...incoming, deferred: true };
      }
      pendingKey = key;
      render();
      try {
        if (name === "accept") await options.acceptIncoming?.(key);
        else if (name === "defer") await options.deferIncoming?.(key);
        return true;
      } catch (error) {
        if (incoming?.key === key && !error?.cancelled) options.onError?.(error);
        return false;
      } finally {
        if (pendingKey === key) { pendingKey = ""; render(); restoreFocus(focused); }
      }
    }
    document.addEventListener("click", event => {
      const button = event.target?.closest?.("[data-drive-incoming-action]");
      if (!button || button.disabled) return;
      const card = button.closest("[data-incoming-key]");
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      void action(button.dataset.driveIncomingAction, card.dataset.incomingKey);
    });
    return Object.freeze({ setIncoming, getIncoming, action });
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
    if (target?.closest?.("[data-mark-all-notifications-read]")) return { type: "mark-all-read" };
    if (target?.closest?.("[data-clear-read-notifications]")) return { type: "clear-read" };
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
    const notifications = Array.isArray(options.notifications) ? options.notifications : [];

    filterButtons.forEach(button => {
      button.classList.toggle("active", button.dataset.notificationFilter === filter);
    });
    if (options.markAllReadButton) {
      options.markAllReadButton.disabled = !notifications.some(notification => !notification.read);
    }
    if (options.clearReadButton) {
      options.clearReadButton.disabled = !notifications.some(notification => notification.read);
    }
    if (list) {
      const transient = ["all", "unread"].includes(filter) ? driveIncomingHTML(options.incoming) : "";
      list.innerHTML = transient + (notifications.length ? notificationListHTML(notifications, {
        filter,
        matchesFilter: options.matchesFilter,
        canOpen: options.canOpen
      }) : transient ? "" : notificationsEmptyHTML());
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
      const unread = getNotifications().filter(notification => !notification.read).length + (integration.getIncoming?.() ? 1 : 0);
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

    function clearRead() {
      const notifications = getNotifications();
      const next = notifications.filter(notification => !notification.read);
      if (next.length === notifications.length) return false;
      setNotifications(next);
      saveState();
      render();
      return true;
    }

    function render() {
      const list = document.querySelector("#notification-list");
      if (!list) return;
      updateBadge();
      renderNotificationCenterView({
        list,
        filterButtons: document.querySelectorAll("[data-notification-filter]"),
        markAllReadButton: document.querySelector("[data-mark-all-notifications-read]"),
        clearReadButton: document.querySelector("[data-clear-read-notifications]"),
        agenda: document.querySelector("#mini-agenda"),
        agendaTitle: document.querySelector("#mini-date-title"),
        filter: getFilter() || "all",
        notifications: getNotifications(),
        incoming: integration.getIncoming?.(),
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

    return Object.freeze({ updateBadge, markRead, clearRead, render, deleteNotification, addNotification, selectFilter, systemPulse });
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
      if (action?.type === "mark-all-read") {
        if (controller.markRead()) controller.render();
      }
      if (action?.type === "clear-read") controller.clearRead();
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
      openLinkedObject = () => false,
      toast = () => {}
    } = integration;

    function openNotification(notification = {}) {
      if (notification.action === "open-calendar" || String(notification.source || "").startsWith("calendar:")) {
        return Boolean(openCalendar(notification));
      }
      const taskId = taskIdFromNotification(notification);
      if (taskId && notificationCanOpen(notification)) {
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
      if (!notificationCanOpen(notification)) return false;
      const endpoint = notificationLinkedObject(notification);
      return endpoint ? Boolean(openLinkedObject(endpoint, notification)) : false;
    }

    function openById(id = "") {
      const notification = getNotifications().find(item => item.id === id);
      return notification ? openNotification(notification) : false;
    }

    return Object.freeze({ openNotification, openById });
  }

  window.ZETER_NOTIFICATION_UI_UTILS = Object.freeze({
    notificationCardHTML,
    driveIncomingHTML,
    createDriveIncomingController,
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
