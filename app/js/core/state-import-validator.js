(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const coreUtils = window.ZETER_CORE_UTILS;
  const assetUtils = window.ZETER_ASSET_UTILS;
  const importUtils = window.ZETER_IMPORT_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const richTextUtils = window.ZETER_RICH_TEXT_UTILS;
  const itemCustomizationUtils = window.ZETER_ITEM_CUSTOMIZATION_UTILS;

  if (!config || !coreUtils || !assetUtils || !importUtils || !dataNormalizers || !richTextUtils || !itemCustomizationUtils) {
    throw new Error("ZeTer OS state import validator requires core modules.");
  }

  const {
    BACKUP_IMPORT_MAX_STATE_BYTES,
    BACKUP_IMPORT_MAX_FS_ITEMS,
    BACKUP_IMPORT_MAX_DESKTOPS,
    BACKUP_IMPORT_MAX_TEXT_CHARS,
    BACKUP_IMPORT_MAX_DATA_URL_CHARS,
    BACKUP_IMPORT_MAX_TASK_CHECKLIST_ITEMS,
    BACKUP_IMPORT_MAX_TASK_PROJECTS,
    BACKUP_IMPORT_MAX_TASKS,
    CALENDAR_MAX_EVENTS,
    NOTIFICATION_MAX_ITEMS,
    OPEN_WINDOWS_MAX
  } = config;

  const CALENDAR_CATEGORY_IDS = new Set(config.CALENDAR_CATEGORY_IDS || []);
  const CALENDAR_REPEAT_IDS = new Set(config.CALENDAR_REPEAT_IDS || []);
  const CALENDAR_REMINDER_IDS = new Set(config.CALENDAR_REMINDER_IDS || []);
  const AUTOMATION_TYPE_IDS = new Set([
    "weekly", "daily", "monthly", "event_before", "event_relative", "file_added",
    "task_completed", "task_overdue", "note_created", "note_changed", "event_created", "startup"
  ]);
  const AUTOMATION_CONDITION_IDS = new Set([
    "file_name_contains", "file_extension", "file_size", "file_source_folder",
    "event_title_contains", "event_category", "event_datetime", "object_exists",
    "task_title_contains", "task_project", "task_status", "note_name_contains", "note_content_contains"
  ]);
  const AUTOMATION_ACTION_IDS = new Set(["notify", "create_note", "move_file", "link_objects"]);
  const AUTOMATION_CONDITION_MODE_IDS = new Set(["all", "any"]);
  const AUTOMATION_ERROR_POLICY_IDS = new Set(["stop", "continue"]);
  const AUTOMATION_COLLISION_POLICY_IDS = new Set(["skip", "rename", "replace"]);
  const AUTOMATION_HISTORY_STATUS_IDS = new Set(["success", "skipped", "warning", "error"]);
  const AUTOMATION_QUEUE_STATUS_IDS = new Set(["pending", "retry"]);
  const OBJECT_LINK_ENDPOINT_KIND_IDS = new Set(["fs", "event"]);
  const AUTOMATION_MAX_ITEMS = 1000;
  const AUTOMATION_MAX_CONDITIONS = 20;
  const AUTOMATION_MAX_ACTIONS = 20;
  const AUTOMATION_QUEUE_MAX_ITEMS = 500;
  const AUTOMATION_HISTORY_MAX_ITEMS = 200;
  const AUTOMATION_CHECKPOINT_MAX_ITEMS = 500;
  const AUTOMATION_KNOWN_FILE_MAX_ITEMS = 5000;
  const OBJECT_LINK_MAX_ITEMS = 5000;

  const { byteSize, bytesToHuman } = coreUtils;
  const { isExternalAssetPath } = assetUtils;
  const {
    validateImportArrayLimit,
    validateImportString,
    validateImportSafeId,
    validateImportEnum,
    validateImportDataImage
  } = importUtils;
  const {
    TASK_TITLE_MAX_CHARS,
    TASK_TAG_MAX_CHARS,
    TASK_CHECKLIST_TEXT_MAX_CHARS
  } = dataNormalizers;
  const { cleanRichHtml } = richTextUtils;
  const { isItemAssetPath } = itemCustomizationUtils;

  function collectVisualSettingsHolders(target = {}) {
    const holders = [];
    if (target?.settings) holders.push({ settings: target.settings, desktopId: "desktop", title: "Основной" });
    (target?.desktops || []).forEach(desk => {
      if (desk?.data?.settings) {
        holders.push({
          settings: desk.data.settings,
          desktopId: desk.id || "desktop",
          title: desk.name || desk.id || "Рабочий стол"
        });
      }
    });
    return holders;
  }

  function sanitizeImportedRichContent(item, label, usage) {
    if (typeof item.richContent !== "string") return;
    if (item.richContent.length > BACKUP_IMPORT_MAX_TEXT_CHARS + BACKUP_IMPORT_MAX_DATA_URL_CHARS) {
      throw new Error(`${label}: HTML-документ слишком большой.`);
    }
    item.richContent = cleanRichHtml(item.richContent);
    const box = document.createElement("div");
    box.innerHTML = item.richContent;
    [...box.querySelectorAll("img")].forEach((img, index) => {
      const src = img.getAttribute("src") || "";
      if (isExternalAssetPath(src)) return;
      validateImportDataImage(src, `${label}, картинка ${index + 1}`, usage);
    });
    item.richContent = box.innerHTML;
  }

  function validateImportedTaskStore(store, label) {
    validateImportArrayLimit(store?.tasks, `${label}: задачи`, BACKUP_IMPORT_MAX_TASKS);
    validateImportArrayLimit(store?.taskProjects, `${label}: проекты`, BACKUP_IMPORT_MAX_TASK_PROJECTS);
    (Array.isArray(store?.taskProjects) ? store.taskProjects : []).forEach((project, index) => {
      if (project?.id) validateImportSafeId(project.id, `${label}: ID проекта #${index + 1}`);
      validateImportString(project?.name, `${label}: имя проекта #${index + 1}`, 160);
    });
    (Array.isArray(store?.tasks) ? store.tasks : []).forEach((task, index) => {
      if (task?.id) validateImportSafeId(task.id, `${label}: ID задачи #${index + 1}`);
      if (task?.projectId) validateImportSafeId(task.projectId, `${label}: ID проекта задачи #${index + 1}`);
      validateImportEnum(task?.status || "todo", new Set(["todo", "doing", "review", "done"]), `${label}: статус задачи #${index + 1}`);
      validateImportEnum(task?.priority || "medium", new Set(["low", "medium", "high"]), `${label}: приоритет задачи #${index + 1}`);
      validateImportString(task?.title, `${label}: название задачи #${index + 1}`, TASK_TITLE_MAX_CHARS);
      validateImportString(task?.description, `${label}: описание задачи #${index + 1}`);
      validateImportString(task?.tag, `${label}: тег задачи #${index + 1}`, TASK_TAG_MAX_CHARS);
      validateImportArrayLimit(task?.checklist, `${label}: чек-лист задачи #${index + 1}`, BACKUP_IMPORT_MAX_TASK_CHECKLIST_ITEMS);
      (Array.isArray(task?.checklist) ? task.checklist : []).forEach((sub, subIndex) => {
        if (sub?.id) validateImportSafeId(sub.id, `${label}: ID подпункта #${index + 1}.${subIndex + 1}`);
        validateImportString(sub?.text, `${label}: текст подпункта #${index + 1}.${subIndex + 1}`, TASK_CHECKLIST_TEXT_MAX_CHARS);
      });
    });
  }

  function validateImportedEvents(events, label) {
    validateImportArrayLimit(events, label, CALENDAR_MAX_EVENTS);
    (Array.isArray(events) ? events : []).forEach((event, index) => {
      if (event?.id) validateImportSafeId(event.id, `${label}: ID события #${index + 1}`);
      validateImportString(event?.title, `${label}: название события #${index + 1}`, 500);
      validateImportString(event?.location, `${label}: место события #${index + 1}`, 500);
      validateImportString(event?.description, `${label}: описание события #${index + 1}`);
      if (event?.category) validateImportEnum(event.category, CALENDAR_CATEGORY_IDS, `${label}: категория события #${index + 1}`);
      if (event?.repeat) validateImportEnum(event.repeat, CALENDAR_REPEAT_IDS, `${label}: повтор события #${index + 1}`);
      if (event?.reminder) validateImportEnum(String(event.reminder), CALENDAR_REMINDER_IDS, `${label}: напоминание события #${index + 1}`);
      validateImportString(event?.reminderNotifiedOccurrence, `${label}: отметка напоминания события #${index + 1}`, 80);
    });
  }

  function validateImportedNotifications(notifications, label) {
    validateImportArrayLimit(notifications, label, NOTIFICATION_MAX_ITEMS);
    (Array.isArray(notifications) ? notifications : []).forEach((notification, index) => {
      if (notification?.id) validateImportSafeId(notification.id, `${label}: ID уведомления #${index + 1}`);
      validateImportString(notification?.title, `${label}: заголовок уведомления #${index + 1}`, 500);
      validateImportString(notification?.text, `${label}: текст уведомления #${index + 1}`, 1000);
      if (notification?.taskId) validateImportSafeId(notification.taskId, `${label}: ID задачи уведомления #${index + 1}`);
      if (notification?.taskProjectId) validateImportSafeId(notification.taskProjectId, `${label}: ID проекта уведомления #${index + 1}`);
      if (notification?.taskListItemId) validateImportSafeId(notification.taskListItemId, `${label}: ID списка задач уведомления #${index + 1}`);
      if (notification?.calendarEventId) validateImportSafeId(notification.calendarEventId, `${label}: ID события уведомления #${index + 1}`);
      validateImportString(notification?.calendarDate, `${label}: дата события уведомления #${index + 1}`, 10);
      const linkedObjectKind = String(notification?.linkedObjectKind || "").trim();
      const linkedObjectId = String(notification?.linkedObjectId || "").trim();
      if (linkedObjectKind || linkedObjectId) {
        validateImportEnum(linkedObjectKind, OBJECT_LINK_ENDPOINT_KIND_IDS, `${label}: тип связанного объекта #${index + 1}`);
        validateImportSafeId(linkedObjectId, `${label}: ID связанного объекта #${index + 1}`);
      }
      validateImportString(notification?.linkedEventDate, `${label}: дата связанного события #${index + 1}`, 10);
    });
  }

  function assertImportInteger(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: значение вне диапазона.`);
  }

  function validateAutomationReference(ref, label) {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error(`${label}: повреждена ссылка на объект.`);
    validateImportEnum(ref.mode || "trigger", new Set(["trigger", "selected", "previous_note"]), `${label}: режим ссылки`);
    if (ref.mode === "selected") {
      validateImportEnum(ref.kind, new Set(["fs", "event", "task"]), `${label}: тип объекта`);
      validateImportSafeId(ref.id, `${label}: ID объекта`);
    }
  }

  function validateAutomationAction(action, automation, label) {
    if (!action || typeof action !== "object" || Array.isArray(action)) throw new Error(`${label}: повреждено действие.`);
    if (action.id) validateImportSafeId(action.id, `${label}: ID действия`);
    validateImportEnum(action.type, AUTOMATION_ACTION_IDS, `${label}: тип действия`);
    validateImportEnum(action.onError || "stop", AUTOMATION_ERROR_POLICY_IDS, `${label}: поведение при ошибке`);
    if (action.type === "move_file" && automation.type !== "file_added") {
      throw new Error(`${label}: перемещение файла допустимо только для триггера добавления файла.`);
    }
    if (action.type === "notify") {
      validateImportString(action.title, `${label}: заголовок уведомления`, 160);
      validateImportString(action.text, `${label}: текст уведомления`, 1000);
      return;
    }
    if (action.type === "create_note") {
      validateImportString(action.name, `${label}: имя заметки`, 300);
      validateImportString(action.content, `${label}: текст заметки`);
      if (action.parentId) validateImportSafeId(action.parentId, `${label}: папка заметки`);
      return;
    }
    if (action.type === "move_file") {
      validateImportSafeId(action.targetFolderId, `${label}: целевая папка`);
      validateImportEnum(action.collisionPolicy || "skip", AUTOMATION_COLLISION_POLICY_IDS, `${label}: политика совпадения имён`);
      if (action.replaceAcknowledged != null && typeof action.replaceAcknowledged !== "boolean") {
        throw new Error(`${label}: подтверждение замены должно быть логическим.`);
      }
      return;
    }
    validateAutomationReference(action.left || { mode: "trigger" }, `${label}: левый объект`);
    validateAutomationReference(action.right, `${label}: правый объект`);
    validateImportString(action.label, `${label}: подпись связи`, 160);
  }

  function validateAutomationCategoryId(id, label, optional = false) {
    if (optional && (id == null || id === "")) return;
    if (typeof id !== "string" || id !== id.trim()) throw new Error(`${label}: ID категории должен быть строкой без пробелов по краям.`);
    validateImportSafeId(id, label);
  }

  function validateImportedAutomationCategories(categories, label) {
    validateImportArrayLimit(categories, label, 200);
    const ids = new Set();
    (categories || []).forEach(category => {
      if (!category || typeof category !== "object" || Array.isArray(category)) throw new Error(`${label}: повреждена категория.`);
      if (typeof category.name !== "string") throw new Error(`${label}: название категории должно быть текстом.`);
      validateAutomationCategoryId(category.id, `${label}: ID`);
      validateImportString(category.name, `${label}: название`, 160);
      if (!String(category.name || "").trim() || ids.has(category.id)) throw new Error(`${label}: пустое имя или повтор ID.`);
      ids.add(category.id);
    });
  }

  function validateImportedAutomations(automations, label) {
    validateImportArrayLimit(automations, label, AUTOMATION_MAX_ITEMS);
    (Array.isArray(automations) ? automations : []).forEach((automation, index) => {
      const automationLabel = `${label}: автоматизация #${index + 1}`;
      if (!automation || typeof automation !== "object" || Array.isArray(automation)) throw new Error(`${automationLabel} повреждена.`);
      validateImportSafeId(automation.id, `${automationLabel}: ID`);
      validateAutomationCategoryId(automation.categoryId, `${automationLabel}: категория`, true);
      validateImportString(automation.name, `${automationLabel}: имя`, 160);
      validateImportEnum(automation.type, AUTOMATION_TYPE_IDS, `${automationLabel}: тип`);
      if (automation.condition != null && automation.condition !== "always") throw new Error(`${automationLabel}: legacy-условие недопустимо.`);
      validateImportEnum(automation.conditionMode || "all", AUTOMATION_CONDITION_MODE_IDS, `${automationLabel}: режим условий`);
      validateImportString(automation.lastRunKey, `${automationLabel}: ключ запуска`, 220);
      validateImportString(automation.pausedReason, `${automationLabel}: причина паузы`, 160);
      validateImportString(automation.lastError, `${automationLabel}: последняя ошибка`, 500);
      if (automation.enabled != null && typeof automation.enabled !== "boolean") throw new Error(`${automationLabel}: флаг должен быть логическим.`);

      if (["weekly", "daily", "monthly"].includes(automation.type)) {
        validateImportString(automation.time, `${automationLabel}: время`, 5);
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(automation.time || ""))) throw new Error(`${automationLabel}: некорректное время.`);
      }
      if (automation.type === "weekly") assertImportInteger(automation.weekday, 0, 6, `${automationLabel}: день недели`);
      if (automation.type === "monthly") assertImportInteger(automation.monthday, 1, 31, `${automationLabel}: день месяца`);
      if (["event_before", "event_relative"].includes(automation.type)) validateImportSafeId(automation.eventId, `${automationLabel}: ID события`);
      if (automation.type === "event_before") assertImportInteger(automation.minutesBefore, 0, 7 * 24 * 60, `${automationLabel}: интервал до события`);
      if (automation.type === "event_relative") assertImportInteger(automation.offsetMinutes, -7 * 24 * 60, 7 * 24 * 60, `${automationLabel}: смещение события`);
      if (automation.folderId) validateImportSafeId(automation.folderId, `${automationLabel}: ID папки`);
      if (automation.projectId) validateImportSafeId(automation.projectId, `${automationLabel}: ID проекта`);
      if (automation.noteFolderId) validateImportSafeId(automation.noteFolderId, `${automationLabel}: ID папки заметок`);

      validateImportArrayLimit(automation.conditions, `${automationLabel}: условия`, AUTOMATION_MAX_CONDITIONS);
      (Array.isArray(automation.conditions) ? automation.conditions : []).forEach((condition, conditionIndex) => {
        const conditionLabel = `${automationLabel}: условие #${conditionIndex + 1}`;
        if (!condition || typeof condition !== "object" || Array.isArray(condition)) throw new Error(`${conditionLabel} повреждено.`);
        if (condition.id) validateImportSafeId(condition.id, `${conditionLabel}: ID`);
        validateImportEnum(condition.type, AUTOMATION_CONDITION_IDS, `${conditionLabel}: тип`);
        validateImportString(condition.value, `${conditionLabel}: значение`, 500);
        if (condition.type === "file_size" && (!Number.isFinite(Number(condition.number ?? condition.value)) || Number(condition.number ?? condition.value) < 0)) {
          throw new Error(`${conditionLabel}: размер файла должен быть неотрицательным числом.`);
        }
        if (["file_source_folder", "task_project"].includes(condition.type) && condition.value) validateImportSafeId(condition.value, `${conditionLabel}: ID`);
        if (condition.type === "object_exists" && condition.mode === "selected") {
          validateImportEnum(condition.kind, new Set(["fs", "event", "task"]), `${conditionLabel}: тип объекта`);
          validateImportSafeId(condition.value, `${conditionLabel}: ID объекта`);
        }
      });

      const actions = Array.isArray(automation.actions) && automation.actions.length ? automation.actions : [automation.action];
      validateImportArrayLimit(actions, `${automationLabel}: действия`, AUTOMATION_MAX_ACTIONS);
      if (!actions.length || !actions[0]) throw new Error(`${automationLabel}: отсутствует действие.`);
      actions.forEach((action, actionIndex) => validateAutomationAction(action, automation, `${automationLabel}: действие #${actionIndex + 1}`));
    });
  }

  function validateAutomationActionResults(results, label) {
    validateImportArrayLimit(results, label, AUTOMATION_MAX_ACTIONS);
    (Array.isArray(results) ? results : []).forEach((result, index) => {
      if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`${label}: повреждён результат #${index + 1}.`);
      validateImportSafeId(result.actionId, `${label}: ID действия #${index + 1}`);
      validateImportEnum(result.actionType, AUTOMATION_ACTION_IDS, `${label}: тип действия #${index + 1}`);
      validateImportEnum(result.status, AUTOMATION_HISTORY_STATUS_IDS, `${label}: статус #${index + 1}`);
      validateImportString(result.message, `${label}: сообщение #${index + 1}`, 500);
      if (result.objectId) validateImportSafeId(result.objectId, `${label}: ID объекта #${index + 1}`);
    });
  }

  function validateImportedAutomationRuntime(runtime, label) {
    if (runtime == null) return;
    if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) throw new Error(`${label}: повреждено состояние выполнения.`);
    if (runtime.paused != null && typeof runtime.paused !== "boolean") throw new Error(`${label}: общая пауза должна быть логической.`);
    if (runtime.baselineSeeded != null && typeof runtime.baselineSeeded !== "boolean") throw new Error(`${label}: флаг baseline должен быть логическим.`);
    validateImportArrayLimit(runtime.knownFileIds, `${label}: известные файлы`, AUTOMATION_KNOWN_FILE_MAX_ITEMS);
    (Array.isArray(runtime.knownFileIds) ? runtime.knownFileIds : []).forEach((id, index) => validateImportSafeId(id, `${label}: ID известного файла #${index + 1}`));
    validateImportArrayLimit(runtime.queue, `${label}: очередь`, AUTOMATION_QUEUE_MAX_ITEMS);
    (Array.isArray(runtime.queue) ? runtime.queue : []).forEach((entry, index) => {
      const entryLabel = `${label}: очередь #${index + 1}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${entryLabel} повреждена.`);
      validateImportSafeId(entry.id, `${entryLabel}: ID`);
      validateImportSafeId(entry.automationId, `${entryLabel}: ID автоматизации`);
      validateImportString(entry.runKey, `${entryLabel}: ключ запуска`, 220);
      validateImportEnum(entry.triggerType, AUTOMATION_TYPE_IDS, `${entryLabel}: триггер`);
      validateImportEnum(entry.status || "pending", AUTOMATION_QUEUE_STATUS_IDS, `${entryLabel}: статус`);
      if (entry.triggerId) validateImportSafeId(entry.triggerId, `${entryLabel}: ID объекта`);
      assertImportInteger(entry.attempts || 0, 0, 5, `${entryLabel}: число попыток`);
      assertImportInteger(entry.chainDepth || 0, 0, 9, `${entryLabel}: глубина цепочки`);
      validateImportArrayLimit(entry.chainAutomationIds, `${entryLabel}: цепочка`, 9);
    });
    validateImportArrayLimit(runtime.history, `${label}: история`, AUTOMATION_HISTORY_MAX_ITEMS);
    (Array.isArray(runtime.history) ? runtime.history : []).forEach((entry, index) => {
      const entryLabel = `${label}: история #${index + 1}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${entryLabel} повреждена.`);
      validateImportSafeId(entry.id, `${entryLabel}: ID`);
      if (entry.automationId) validateImportSafeId(entry.automationId, `${entryLabel}: ID автоматизации`);
      validateAutomationCategoryId(entry.categoryId, `${entryLabel}: категория`, true);
      validateImportEnum(entry.status, AUTOMATION_HISTORY_STATUS_IDS, `${entryLabel}: статус`);
      validateImportString(entry.message, `${entryLabel}: сообщение`, 500);
      validateAutomationActionResults(entry.actionResults, `${entryLabel}: результаты действий`);
    });
    validateImportArrayLimit(runtime.checkpoints, `${label}: checkpoints`, AUTOMATION_CHECKPOINT_MAX_ITEMS);
    (Array.isArray(runtime.checkpoints) ? runtime.checkpoints : []).forEach((entry, index) => {
      const entryLabel = `${label}: checkpoint #${index + 1}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${entryLabel} повреждён.`);
      validateImportSafeId(entry.id, `${entryLabel}: ID`);
      validateImportSafeId(entry.queueId, `${entryLabel}: ID очереди`);
      validateImportArrayLimit(entry.completedActionIds, `${entryLabel}: выполненные действия`, AUTOMATION_MAX_ACTIONS);
      validateAutomationActionResults(entry.actionResults, `${entryLabel}: результаты действий`);
    });
    validateImportArrayLimit(runtime.rateLog, `${label}: журнал частоты`, 30);
  }

  function validateImportedObjectLinks(objectLinks, label) {
    validateImportArrayLimit(objectLinks, label, OBJECT_LINK_MAX_ITEMS);
    (Array.isArray(objectLinks) ? objectLinks : []).forEach((link, index) => {
      if (!link || typeof link !== "object" || Array.isArray(link)) {
        throw new Error(`${label}: повреждена связь #${index + 1}.`);
      }
      validateImportSafeId(link.id, `${label}: ID связи #${index + 1}`);
      validateImportString(link.label, `${label}: подпись связи #${index + 1}`, 160);
      const endpoints = [link.a || link.from || link.source, link.b || link.to || link.target];
      endpoints.forEach((endpoint, endpointIndex) => {
        if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) {
          throw new Error(`${label}: повреждена сторона ${endpointIndex + 1} связи #${index + 1}.`);
        }
        validateImportEnum(endpoint.kind || endpoint.type, OBJECT_LINK_ENDPOINT_KIND_IDS, `${label}: тип стороны ${endpointIndex + 1} связи #${index + 1}`);
        validateImportSafeId(endpoint.id, `${label}: ID стороны ${endpointIndex + 1} связи #${index + 1}`);
      });
      const leftKey = `${endpoints[0].kind || endpoints[0].type}:${endpoints[0].id}`;
      const rightKey = `${endpoints[1].kind || endpoints[1].type}:${endpoints[1].id}`;
      if (leftKey === rightKey) throw new Error(`${label}: связь #${index + 1} не может ссылаться на тот же объект.`);
    });
  }

  function validateImportedStateForImport(incoming) {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("Файл не похож на состояние ZeTer OS.");
    if (!incoming.fs || typeof incoming.fs !== "object" || Array.isArray(incoming.fs)) throw new Error("В бэкапе нет файловой системы ZeTer OS.");
    if (!incoming.settings || typeof incoming.settings !== "object" || Array.isArray(incoming.settings)) throw new Error("В бэкапе нет настроек ZeTer OS.");
    if (incoming.systemSettings != null && (typeof incoming.systemSettings !== "object" || Array.isArray(incoming.systemSettings))) {
      throw new Error("В бэкапе повреждены системные настройки ZeTer OS.");
    }
    if (incoming.desktops != null && !Array.isArray(incoming.desktops)) throw new Error("В бэкапе повреждён список рабочих столов.");
    if (incoming.currentDesktop) validateImportSafeId(incoming.currentDesktop, "Текущий рабочий стол");
    if (incoming.systemSettings?.startup?.desktop && incoming.systemSettings.startup.desktop !== "last") {
      validateImportSafeId(incoming.systemSettings.startup.desktop, "Стартовый рабочий стол");
    }
    Object.entries(incoming.systemSettings?.hotkeys || {}).forEach(([action, hotkey]) => {
      validateImportString(action, "Действие горячей клавиши", 80);
      validateImportString(hotkey, `Горячая клавиша «${action}»`, 80);
    });

    const stateSize = byteSize(JSON.stringify(incoming));
    if (stateSize > BACKUP_IMPORT_MAX_STATE_BYTES) throw new Error(`Состояние ОС слишком большое: ${bytesToHuman(stateSize)}.`);

    const usage = { totalDataUrlChars: 0 };
    const fsEntries = Object.entries(incoming.fs);
    if (fsEntries.length > BACKUP_IMPORT_MAX_FS_ITEMS) {
      throw new Error(`В бэкапе слишком много элементов: ${fsEntries.length}. Максимум: ${BACKUP_IMPORT_MAX_FS_ITEMS}.`);
    }

    fsEntries.forEach(([key, item]) => {
      validateImportSafeId(key, `Ключ файловой системы «${key}»`);
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Повреждённая запись файловой системы: ${key}.`);
      const label = `Элемент «${item.name || item.id || key}»`;
      if (!item.id) item.id = key;
      validateImportString(item.id, `${label}: ID`, 220);
      validateImportSafeId(item.id, `${label}: ID`);
      if (item.id !== key) throw new Error(`${label}: ID не совпадает с ключом файловой системы.`);
      validateImportString(item.name, `${label}: имя`, 300);
      validateImportString(item.parent, `${label}: родитель`, 220);
      validateImportSafeId(item.parent, `${label}: родитель`, { optional: !item.parent });
      validateImportSafeId(item.originalParent, `${label}: исходная папка`, { optional: !item.originalParent });
      validateImportString(item.content, `${label}: содержимое`);
      validateImportDataImage(item.dataURL, `${label}: изображение`, usage);
      sanitizeImportedRichContent(item, label, usage);
      if (item.externalImage?.path && !isExternalAssetPath(item.externalImage.path)) throw new Error(`${label}: небезопасный путь внешней картинки.`);
      if (item.appearance != null && (typeof item.appearance !== "object" || Array.isArray(item.appearance))) {
        throw new Error(`${label}: повреждены настройки оформления.`);
      }
      if (item.appearance?.color != null && !/^#[0-9a-f]{6}$/i.test(String(item.appearance.color))) {
        throw new Error(`${label}: некорректный цвет папки.`);
      }
      ["icon", "background"].forEach(kind => {
        const image = item.appearance?.[kind];
        if (image == null) return;
        if (typeof image !== "object" || Array.isArray(image)) throw new Error(`${label}: повреждено изображение оформления.`);
        validateImportDataImage(image.dataURL, `${label}: ${kind === "icon" ? "значок" : "фон папки"}`, usage);
        if (image.assetPath && !isItemAssetPath(image.assetPath)) {
          throw new Error(`${label}: небезопасный путь изображения оформления.`);
        }
      });
      if (item.type === "tasklist") validateImportedTaskStore(item, label);
    });

    validateImportedTaskStore(incoming, "Основные задачи");
    validateImportedEvents(incoming.events, "Календарь");
    validateImportedNotifications(incoming.notifications, "Уведомления");
    validateImportedAutomations(incoming.automations, "Автоматизации");
    validateImportedAutomationCategories(incoming.automationCategories, "Категории автоматизаций");
    validateImportedAutomationRuntime(incoming.automationRuntime, "Автоматизации: выполнение");
    validateImportedObjectLinks(incoming.objectLinks, "Связи объектов");
    validateImportArrayLimit(incoming.desktops, "Рабочие столы", BACKUP_IMPORT_MAX_DESKTOPS);

    collectVisualSettingsHolders(incoming).forEach(holder => {
      const wallpaper = holder.settings?.customWallpaper;
      validateImportDataImage(wallpaper?.dataURL, `Обои «${holder.title || holder.desktopId || "рабочий стол"}»`, usage);
      if (wallpaper?.externalWallpaper?.path && !isExternalAssetPath(wallpaper.externalWallpaper.path)) {
        throw new Error("В бэкапе найден небезопасный путь внешних обоев.");
      }
    });

    (Array.isArray(incoming.desktops) ? incoming.desktops : []).forEach((desk, index) => {
      validateImportString(desk?.id, `Рабочий стол #${index + 1}: ID`, 220);
      validateImportSafeId(desk?.id, `Рабочий стол #${index + 1}: ID`);
      validateImportString(desk?.name, `Рабочий стол #${index + 1}: имя`, 300);
      validateImportDataImage(desk?.icon?.dataURL, `Иконка рабочего стола #${index + 1}`, usage);
      if (desk?.icon?.externalDesktopIcon?.path && !isExternalAssetPath(desk.icon.externalDesktopIcon.path)) {
        throw new Error(`Рабочий стол #${index + 1}: небезопасный путь внешней иконки.`);
      }
      validateImportedTaskStore(desk?.data, `Рабочий стол «${desk?.name || index + 1}»`);
      validateImportedEvents(desk?.data?.events, `Рабочий стол «${desk?.name || index + 1}»: календарь`);
      validateImportedNotifications(desk?.data?.notifications, `Рабочий стол «${desk?.name || index + 1}»: уведомления`);
      validateImportedAutomations(desk?.data?.automations, `Рабочий стол «${desk?.name || index + 1}»: автоматизации`);
      validateImportedAutomationCategories(desk?.data?.automationCategories, `Рабочий стол «${desk?.name || index + 1}»: категории автоматизаций`);
      validateImportedAutomationRuntime(desk?.data?.automationRuntime, `Рабочий стол «${desk?.name || index + 1}»: выполнение автоматизаций`);
      validateImportedObjectLinks(desk?.data?.objectLinks, `Рабочий стол «${desk?.name || index + 1}»: связи объектов`);
      validateImportArrayLimit(desk?.data?.openWindows, `Рабочий стол «${desk?.name || index + 1}»: окна`, OPEN_WINDOWS_MAX);
      validateImportArrayLimit(desk?.data?.noteStickies, `Рабочий стол «${desk?.name || index + 1}»: стикеры`, 1000);
    });

    return incoming;
  }

  window.ZETER_STATE_IMPORT_VALIDATOR = Object.freeze({
    sanitizeImportedRichContent,
    validateImportedTaskStore,
    validateImportedEvents,
    validateImportedNotifications,
    validateImportedAutomations,
    validateImportedAutomationCategories,
    validateImportedAutomationRuntime,
    validateImportedObjectLinks,
    validateImportedStateForImport
  });
})();
