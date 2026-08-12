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
    validateImportedStateForImport
  });
})();
