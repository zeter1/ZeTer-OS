(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const assetUtils = window.ZETER_ASSET_UTILS;
  const richTextUtils = window.ZETER_RICH_TEXT_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const exportUtils = window.ZETER_EXPORT_UTILS;

  if (!coreUtils || !assetUtils || !richTextUtils || !dataNormalizers || !exportUtils) {
    throw new Error("ZeTer OS readable export utils require core modules.");
  }

  const {
    DEFAULT_TASK_PROJECT_NAME,
    TASK_PROJECT_UNASSIGNED,
    taskReminderLabel,
    taskReminderRepeatLabel,
    normalizeCalendarCategory
  } = dataNormalizers;
  const { parseISO, pad } = coreUtils;
  const { isDataImage, parseDataUrl, mimeToExtension, dataUrlToBlob, createZipBlob } = assetUtils;
  const { notePlainText, collectNoteImageSources } = richTextUtils;
  const { fastStringHash, escapeXml, sanitizeExportPathPart, stripKnownExtension, uniqueExportPath, humanDateTime, tablePageToCSV, syncLiveExportSources } = exportUtils;

  function formatReadableDate(iso, full = false) {
    const date = typeof iso === "string" ? parseISO(iso) : iso;
    return date.toLocaleDateString("ru-RU", full
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function priorityName(priority = "") {
    return { high: "Высокий", medium: "Средний", low: "Низкий" }[priority] || priority;
  }

  function statusName(status = "") {
    return { todo: "Нужно сделать", doing: "В работе", review: "На проверке", done: "Готово" }[status] || status;
  }

  function categoryName(category = "") {
    return { work: "Работа", personal: "Личное", health: "Здоровье", important: "Важное" }[normalizeCalendarCategory(category)] || "Личное";
  }

  function repeatName(value = "none") {
    return { none: "Без повтора", daily: "Каждый день", weekly: "Каждую неделю", monthly: "Каждый месяц" }[value] || value || "Без повтора";
  }

  function exportFolderTrailForItem(item = {}, options = {}) {
    const fs = options.fs || {};
    const sanitizeName = typeof options.sanitizeName === "function" ? options.sanitizeName : (value, fallback) => value || fallback;
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const parts = [];
    let parent = fs[item.parent];
    while (parent && parent.type === "folder") {
      if (!parent.systemRole) parts.unshift(sanitizeName(parent.name, "Папка"));
      if (isDesktopRoot(parent.parent) || isExplorerRoot(parent.parent)) break;
      parent = fs[parent.parent];
    }
    return parts;
  }

  function desktopIdByExplorerRoot(rootId, options = {}) {
    const desktops = Array.isArray(options.desktops) ? options.desktops : [];
    const fs = options.fs || {};
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const byData = desktops.find(desk => desk?.data?.explorerRootId === rootId);
    if (byData) return byData.id;
    const root = fs[rootId];
    if (root?.systemRole === "explorerRoot" && isDesktopRoot(root.parent)) return root.parent;
    return null;
  }

  function exportFallbackDesktopIdFromDesktops(desktops = [], fallbackId = "desktop") {
    const list = Array.isArray(desktops) ? desktops : [];
    return list.find(desk => desk?.id === fallbackId)?.id || list[0]?.id || fallbackId;
  }

  function exportExplicitDesktopIdForItem(item = {}, options = {}) {
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const candidates = [
      item.desktopId,
      item.workspaceId,
      item.workspaceRootId,
      item.desktopRootId,
      item.rootDesktopId,
      item.rootId,
      item.desktop,
      item.workspace
    ].filter(Boolean).map(String);
    return candidates.find(id => isDesktopRoot(id)) || null;
  }

  function exportDesktopIdForItem(item = {}, options = {}) {
    const fs = options.fs || {};
    const desktops = Array.isArray(options.desktops) ? options.desktops : [];
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const fallbackDesktop = options.fallbackDesktopId || exportFallbackDesktopIdFromDesktops(desktops);
    if (!item) return fallbackDesktop;

    const explicitDesktop = exportExplicitDesktopIdForItem(item, { isDesktopRoot });
    if (explicitDesktop) return explicitDesktop;

    let parentId = item.parent;
    const visited = new Set();

    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (isDesktopRoot(parentId)) return parentId;
      if (isExplorerRoot(parentId)) return desktopIdByExplorerRoot(parentId, { desktops, fs, isDesktopRoot }) || fallbackDesktop;

      const parent = fs[parentId];
      if (!parent) break;

      const explicitParentDesktop = exportExplicitDesktopIdForItem(parent, { isDesktopRoot });
      if (explicitParentDesktop) return explicitParentDesktop;
      parentId = parent.parent;
    }

    return fallbackDesktop;
  }

  function exportSortTrailForItem(item = {}, options = {}) {
    const fs = options.fs || {};
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const parts = [];
    const visited = new Set();
    let parent = fs[item.parent];
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      if (parent.type === "folder" && !parent.systemRole) parts.unshift(parent.name || "");
      if (isDesktopRoot(parent.parent) || isExplorerRoot(parent.parent)) break;
      parent = fs[parent.parent];
    }
    return parts.join("/");
  }

  function isActiveFsItem(item = {}, options = {}) {
    const trashRoot = options.trashRoot || "trash";
    return Boolean(item && !item.deletedAt && item.parent !== trashRoot);
  }

  function isExportableNoteItem(item = {}, options = {}) {
    const isActiveItem = typeof options.isActiveFsItem === "function" ? options.isActiveFsItem : isActiveFsItem;
    if (!isActiveItem(item, options) || item.systemRole) return false;
    if (item.type === "note") return true;

    const name = String(item.name || "");
    const hasNoteFlag = Boolean(item.isNote || item.noteId || item.note === true || item.kind === "note" || item.appType === "note");
    const hasNoteName = /(^|\s)(новая\s+)?заметк/i.test(name) || /^note[\s_-]/i.test(name);
    const hasEditorContent = typeof item.content === "string" || typeof item.richContent === "string";

    // Защита для старых и промежуточных сохранений: заметки могли лежать
    // как text/file/document/richtext, особенно на основном рабочем столе.
    if (["text", "file", "document", "richtext", "html"].includes(item.type)) {
      return Boolean(hasNoteFlag || hasNoteName);
    }

    return Boolean(hasNoteFlag || (hasNoteName && hasEditorContent));
  }

  function normalizeLegacyNoteForExport(raw = {}, desktopId = "desktop", index = 0, options = {}) {
    if (!raw || typeof raw !== "object") return null;
    const plainToRichHtml = typeof options.plainToRichHtml === "function" ? options.plainToRichHtml : value => String(value || "");
    const name = raw.name || raw.title || raw.heading || `Заметка ${index + 1}`;
    const content = raw.content ?? raw.text ?? raw.body ?? raw.value ?? "";
    const richContent = raw.richContent || raw.html || raw.markup || (typeof content === "string" ? plainToRichHtml(content) : "");
    return {
      id: raw.id || raw.noteId || `legacy_${desktopId}_${index}`,
      type: "note",
      name,
      parent: raw.parent || desktopId,
      content: String(content ?? ""),
      richContent,
      createdAt: raw.createdAt || raw.time || Date.now(),
      updatedAt: raw.updatedAt || raw.modifiedAt || raw.time || Date.now(),
      desktopId
    };
  }

  function collectLegacyNotesForExport(target = {}, options = {}) {
    const desktops = Array.isArray(target.desktops) ? target.desktops : [];
    const fallbackDesktopId = typeof options.exportFallbackDesktopId === "function" ? options.exportFallbackDesktopId : () => "desktop";
    const noteIsExportable = typeof options.isExportableNoteItem === "function" ? options.isExportableNoteItem : isExportableNoteItem;
    const result = [];
    const pushFromContainer = (container, desktopId) => {
      if (!container) return;
      const notes = Array.isArray(container) ? container : (typeof container === "object" ? Object.values(container) : []);
      notes.forEach((raw, index) => {
        const note = normalizeLegacyNoteForExport(raw, desktopId, index, options);
        if (note && noteIsExportable(note)) result.push({ note, desktopId });
      });
    };

    desktops.forEach(desk => {
      pushFromContainer(desk.notes, desk.id);
      pushFromContainer(desk.data?.notes, desk.id);
      pushFromContainer(desk.data?.noteItems, desk.id);
    });
    pushFromContainer(target.notes, fallbackDesktopId());

    return result;
  }

  function collectNotesForExport(target = {}, options = {}) {
    const desktops = Array.isArray(target.desktops) ? target.desktops : [];
    const fs = target.fs || {};
    const fallbackDesktopId = typeof options.exportFallbackDesktopId === "function" ? options.exportFallbackDesktopId : () => "desktop";
    const desktopIdForItem = typeof options.exportDesktopIdForItem === "function" ? options.exportDesktopIdForItem : () => fallbackDesktopId();
    const sortTrailForItem = typeof options.exportSortTrail === "function" ? options.exportSortTrail : () => "";
    const noteIsExportable = typeof options.isExportableNoteItem === "function" ? options.isExportableNoteItem : isExportableNoteItem;
    const desktopOrder = new Map(desktops.map((desk, index) => [desk.id, index]));
    const used = new Set();
    const result = [];

    const addNote = (note, desktopId = null) => {
      if (!note || !noteIsExportable(note)) return;
      const key = String(note.id || `${note.name || "note"}_${note.parent || "root"}_${note.createdAt || ""}`);
      if (used.has(key)) return;
      used.add(key);
      result.push({ note, desktopId: desktopId || desktopIdForItem(note) || fallbackDesktopId() });
    };

    const fsNotes = Object.values(fs).filter(noteIsExportable);

    // Сначала отдельно обходим каждый рабочий стол. Это важно для основного
    // рабочего стола: его id — «desktop», и в старых сохранениях такие заметки
    // могли не попадать в общий проход после переключения между столами.
    desktops.forEach(desk => {
      fsNotes.forEach(note => {
        if (desktopIdForItem(note) === desk.id) addNote(note, desk.id);
      });
    });

    // Затем добавляем всё, что не удалось привязать к конкретному столу.
    fsNotes.forEach(note => addNote(note, desktopIdForItem(note)));
    collectLegacyNotesForExport(target, options).forEach(({ note, desktopId }) => addNote(note, desktopId));

    return result.sort((a, b) => {
      const desktopA = desktopOrder.has(a.desktopId) ? desktopOrder.get(a.desktopId) : 9999;
      const desktopB = desktopOrder.has(b.desktopId) ? desktopOrder.get(b.desktopId) : 9999;
      if (desktopA !== desktopB) return desktopA - desktopB;

      const trailCompare = sortTrailForItem(a.note).localeCompare(sortTrailForItem(b.note), "ru");
      if (trailCompare) return trailCompare;

      return String(a.note.name || "").localeCompare(String(b.note.name || ""), "ru");
    });
  }

  function appendReadableDesktopDataEntries(target = {}, options = {}) {
    const desktops = Array.isArray(target.desktops) ? target.desktops : [];
    const addEntry = typeof options.addEntry === "function" ? options.addEntry : () => {};
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : id => String(id || "Рабочий стол");
    const desktopDescription = typeof options.desktopDescription === "function" ? options.desktopDescription : () => "";
    const collectVisualSettingsHolders = typeof options.collectVisualSettingsHolders === "function" ? options.collectVisualSettingsHolders : () => [];
    const normalizeCustomWallpaper = typeof options.normalizeCustomWallpaper === "function" ? options.normalizeCustomWallpaper : value => value;
    const normalizeDesktopIcon = typeof options.normalizeDesktopIcon === "function" ? options.normalizeDesktopIcon : value => value;
    const normalizeTaskStore = typeof options.normalizeTaskStore === "function" ? options.normalizeTaskStore : value => value || {};
    const workspaceDefaults = typeof options.workspaceDefaults === "function" ? options.workspaceDefaults : () => ({});

    const exportedWallpapers = new Set();
    collectVisualSettingsHolders(target).forEach(holder => {
      const wallpaper = normalizeCustomWallpaper(holder.settings?.customWallpaper);
      if (!wallpaper || !isDataImage(wallpaper.dataURL)) return;
      const hash = fastStringHash(wallpaper.dataURL);
      const key = `${holder.desktopId}:${hash}`;
      if (exportedWallpapers.has(key)) return;
      exportedWallpapers.add(key);
      const parsed = parseDataUrl(wallpaper.dataURL) || {};
      const ext = mimeToExtension(parsed.mime || wallpaper.mime, "jpg");
      const desktopPart = sanitizeExportPathPart(holder.title || desktopName(holder.desktopId), "Рабочий стол");
      const baseName = sanitizeExportPathPart(stripKnownExtension(wallpaper.name || "Свои обои"), "Свои обои");
      addEntry(["Обои", desktopPart, `${baseName}.${ext}`].join("/"), dataUrlToBlob(wallpaper.dataURL), parsed.mime || wallpaper.mime || `image/${ext}`);
    });

    const exportedDesktopIcons = new Set();
    desktops.forEach(desk => {
      const icon = normalizeDesktopIcon(desk.icon);
      if (!icon || !isDataImage(icon.dataURL)) return;
      const hash = fastStringHash(icon.dataURL);
      const key = `${desk.id}:${hash}`;
      if (exportedDesktopIcons.has(key)) return;
      exportedDesktopIcons.add(key);
      const parsed = parseDataUrl(icon.dataURL) || {};
      const ext = mimeToExtension(parsed.mime || icon.mime, "png");
      const desktopPart = sanitizeExportPathPart(desktopName(desk.id), "Рабочий стол");
      const baseName = sanitizeExportPathPart(stripKnownExtension(icon.name || "Иконка рабочего стола"), "Иконка рабочего стола");
      addEntry(["Иконки рабочих столов", desktopPart, `${baseName}.${ext}`].join("/"), dataUrlToBlob(icon.dataURL), parsed.mime || icon.mime || `image/${ext}`);
    });

    desktops.forEach(desk => {
      const title = desktopName(desk.id);
      const safeTitle = sanitizeExportPathPart(title, "Рабочий стол");
      const icon = normalizeDesktopIcon(desk.icon);
      addEntry(`Рабочие столы/${safeTitle}_profile.txt`, [
        "Профиль рабочего стола ZeTer OS",
        `Название: ${title}`,
        `Описание: ${desktopDescription(desk.id) || "—"}`,
        `Иконка: ${icon?.name || "стандартная"}`,
        `ID: ${desk.id}`,
        ""
      ].join("\n"));

      const data = normalizeTaskStore(desk.data || workspaceDefaults());
      addEntry(`Календарь/${safeTitle}_calendar.txt`, formatEventsAsText(Array.isArray(data.events) ? data.events : [], title));
      addEntry(`Задачи/${safeTitle}_tasks.txt`, formatTasksAsText(Array.isArray(data.tasks) ? data.tasks : [], title, data.taskProjects));
    });
  }

  function appendReadableTableEntries(target = {}, options = {}) {
    const fs = target.fs || {};
    const addEntry = typeof options.addEntry === "function" ? options.addEntry : () => {};
    const isActiveItem = typeof options.isActiveFsItem === "function" ? options.isActiveFsItem : isActiveFsItem;
    const exportSortTrail = typeof options.exportSortTrail === "function" ? options.exportSortTrail : () => "";
    const exportDesktopNameForItem = typeof options.exportDesktopNameForItem === "function" ? options.exportDesktopNameForItem : () => "Рабочий стол";
    const exportFolderTrailForItem = typeof options.exportFolderTrailForItem === "function" ? options.exportFolderTrailForItem : () => [];
    const normalizeTableData = typeof options.normalizeTableData === "function" ? options.normalizeTableData : value => value || {};
    const activeTablePage = typeof options.activeTablePage === "function" ? options.activeTablePage : table => table?.pages?.[0] || {};
    const tableItems = Object.values(fs)
      .filter(item => isActiveItem(item) && item?.type === "table" && !item.systemRole)
      .sort((a, b) => exportSortTrail(a).localeCompare(exportSortTrail(b), "ru") || String(a.name || "").localeCompare(String(b.name || ""), "ru"));

    for (const table of tableItems) {
      const desktopPart = sanitizeExportPathPart(exportDesktopNameForItem(table), "Рабочий стол");
      const folders = exportFolderTrailForItem(table);
      const baseName = sanitizeExportPathPart(stripKnownExtension(table.name || "Таблица"), "Таблица");
      const data = normalizeTableData(table.table || table);
      if (data.pages.length <= 1) {
        addEntry(["Таблицы", desktopPart, ...folders, `${baseName}.csv`].join("/"), tablePageToCSV(activeTablePage(data)), "text/csv;charset=utf-8");
      } else {
        data.pages.forEach((page, index) => {
          const pageName = sanitizeExportPathPart(page.name || `Страница ${index + 1}`, `Страница ${index + 1}`);
          addEntry(["Таблицы", desktopPart, ...folders, baseName, `${pad(index + 1)}_${pageName}.csv`].join("/"), tablePageToCSV(page), "text/csv;charset=utf-8");
        });
      }
    }
  }

  function readableTaskListItemsForExport(target = {}, options = {}) {
    const fs = target.fs || {};
    const isActiveItem = typeof options.isActiveFsItem === "function" ? options.isActiveFsItem : isActiveFsItem;
    const exportSortTrail = typeof options.exportSortTrail === "function" ? options.exportSortTrail : () => "";
    return Object.values(fs)
      .filter(item => isActiveItem(item) && item?.type === "tasklist")
      .sort((a, b) => exportSortTrail(a).localeCompare(exportSortTrail(b), "ru") || String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  }

  function appendReadableTaskListEntries(items = [], options = {}) {
    const addEntry = typeof options.addEntry === "function" ? options.addEntry : () => {};
    const exportDesktopNameForItem = typeof options.exportDesktopNameForItem === "function" ? options.exportDesktopNameForItem : () => "Рабочий стол";
    const exportFolderTrailForItem = typeof options.exportFolderTrailForItem === "function" ? options.exportFolderTrailForItem : () => [];
    (Array.isArray(items) ? items : []).forEach(item => {
      const desktopPart = sanitizeExportPathPart(exportDesktopNameForItem(item), "Рабочий стол");
      const folders = exportFolderTrailForItem(item);
      const baseName = sanitizeExportPathPart(stripKnownExtension(item.name || "Список задач"), "Список задач");
      addEntry(["Списки задач", desktopPart, ...folders, `${baseName}.txt`].join("/"), formatTasksAsText(item.tasks, item.name, item.taskProjects));
    });
  }

  function formatTasksAsText(tasks = [], desktopTitle = "Рабочий стол", projects = []) {
    const safeProjects = Array.isArray(projects) && projects.length ? projects : [{ id: TASK_PROJECT_UNASSIGNED, name: DEFAULT_TASK_PROJECT_NAME }];
    const lines = ["Задачи ZeTer OS", `Список: ${desktopTitle}`, `Сохранено: ${humanDateTime()}`, ""];
    if (!tasks.length) {
      lines.push("Задач нет.");
      return lines.join("\n");
    }
    let globalIndex = 1;
    safeProjects.forEach(project => {
      const projectTasks = tasks.filter(task => (task.projectId || safeProjects[0].id) === project.id);
      if (!projectTasks.length) return;
      lines.push(`Проект: ${project.name || DEFAULT_TASK_PROJECT_NAME}`);
      projectTasks.forEach(task => {
        lines.push(`${globalIndex++}. ${task.pinned ? "📌 " : ""}${task.title || "Без названия"}`);
        lines.push(`   Статус: ${statusName(task.status)}`);
        lines.push(`   Приоритет: ${priorityName(task.priority)}`);
        if (task.indefinite) lines.push("   Задача: бессрочная");
        if (task.due && !task.indefinite) lines.push(`   Дата: ${formatReadableDate(task.due)}`);
        if (task.reminderAt) lines.push(`   Уведомление: ${taskReminderLabel(task.reminderAt)}${task.reminderRepeatDays ? ` (${taskReminderRepeatLabel(task.reminderRepeatDays)})` : ""}${task.reminderNotifiedAt ? " (отправлено)" : ""}`);
        if (task.tag) lines.push(`   Тег: ${task.tag}`);
        if (task.description) lines.push(`   Описание: ${task.description}`);
        if (Array.isArray(task.checklist) && task.checklist.length) {
          lines.push("   Чек-лист:");
          task.checklist.forEach(sub => lines.push(`   ${sub.done ? "[x]" : "[ ]"} ${sub.text || ""}`));
        }
        lines.push("");
      });
    });
    return lines.join("\n");
  }

  function formatEventsAsText(events = [], desktopTitle = "Рабочий стол") {
    const sorted = [...events].sort((a, b) => `${a.date || ""} ${a.start || ""}`.localeCompare(`${b.date || ""} ${b.start || ""}`));
    const lines = ["Календарь ZeTer OS", `Рабочий стол: ${desktopTitle}`, `Сохранено: ${humanDateTime()}`, ""];
    if (!sorted.length) {
      lines.push("Событий нет.");
      return lines.join("\n");
    }
    sorted.forEach((event, index) => {
      const time = [event.start, event.end].filter(Boolean).join("–");
      lines.push(`${index + 1}. ${event.title || "Без названия"}`);
      if (event.date) lines.push(`   Дата: ${formatReadableDate(event.date)}`);
      if (time) lines.push(`   Время: ${time}`);
      if (event.category) lines.push(`   Категория: ${categoryName(event.category)}`);
      if (event.location) lines.push(`   Место: ${event.location}`);
      if (event.repeat) lines.push(`   Повтор: ${repeatName(event.repeat)}`);
      if (event.reminder) lines.push(`   Напоминание: ${event.reminder} мин.`);
      if (event.description) lines.push(`   Описание: ${event.description}`);
      lines.push("");
    });
    return lines.join("\n");
  }

  function docxImageParagraph(rId, index) {
    const cx = 5200000;
    const cy = 3300000;
    return `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index + 1}" name="Изображение ${index + 1}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${index + 1}" name="image${index + 1}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  function docxTextParagraph(text = "") {
    const safe = escapeXml(text);
    return `<w:p><w:r><w:t xml:space="preserve">${safe || " "}</w:t></w:r></w:p>`;
  }

  async function buildDocxForNote(item = {}) {
    const text = notePlainText(item);
    const imageSources = collectNoteImageSources(item);
    const imageEntries = [];
    const relationships = [];
    const body = [];
    body.push(docxTextParagraph(item.name || "Заметка"));
    body.push(docxTextParagraph(""));
    (text ? text.split(/\r?\n/) : [""]).forEach(line => body.push(docxTextParagraph(line)));

    for (let i = 0; i < imageSources.length; i++) {
      const parsed = parseDataUrl(imageSources[i]) || {};
      const ext = mimeToExtension(parsed.mime, "png");
      const rId = `rId${i + 1}`;
      const mediaPath = `word/media/image${i + 1}.${ext}`;
      imageEntries.push({ path: mediaPath, blob: dataUrlToBlob(imageSources[i]) });
      relationships.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.${ext}"/>`);
      body.push(docxImageParagraph(rId, i));
    }

    const imageContentTypes = [...new Set(imageEntries.map(entry => entry.path.split(".").pop().toLowerCase()))]
      .map(ext => {
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png";
        return `<Default Extension="${escapeXml(ext)}" ContentType="${mime}"/>`;
      }).join("");

    const entries = [
      { path: "[Content_Types].xml", blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageContentTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
      { path: "_rels/.rels", blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { path: "word/document.xml", blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>` },
      { path: "word/_rels/document.xml.rels", blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>` },
      ...imageEntries
    ];
    return createZipBlob(entries);
  }

  async function buildHumanReadableOsDataEntriesModel(target = {}, options = {}) {
    const {
      collectNotesForExport = () => [],
      desktopName = id => String(id || "Рабочий стол"),
      desktopDescription = () => "",
      exportFolderTrail = () => [],
      collectVisualSettingsHolders = () => [],
      normalizeCustomWallpaper = value => value,
      normalizeDesktopIcon = value => value,
      normalizeTaskStore = value => value || {},
      workspaceDefaults = () => ({}),
      isActiveFsItem = () => true,
      exportSortTrail = () => [],
      exportDesktopNameForItem = () => "Рабочий стол",
      normalizeTableData = value => value,
      activeTablePage = value => value,
      BlobClass = globalThis.Blob
    } = options;
    const entries = [];
    const seen = new Set();
    const addEntry = (path, blob, type = "text/plain;charset=utf-8") => {
      const finalPath = uniqueExportPath(path, seen);
      entries.push({ path: finalPath, blob: blob instanceof BlobClass ? blob : new BlobClass([String(blob ?? "")], { type }) });
    };

    const notes = collectNotesForExport();
    if (!notes.length) addEntry("Заметки/Нет заметок.txt", "В ZeTer OS пока нет заметок.\n");
    for (const { note, desktopId } of notes) {
      const desktopPart = sanitizeExportPathPart(desktopName(desktopId), "Рабочий стол");
      const baseName = sanitizeExportPathPart(stripKnownExtension(note.name || "Заметка"), "Заметка");
      const noteFolder = ["Заметки", desktopPart].join("/");
      addEntry(`${noteFolder}/${baseName}.docx`, await buildDocxForNote(note), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    }

    appendReadableDesktopDataEntries(target, {
      addEntry,
      desktopName,
      desktopDescription,
      collectVisualSettingsHolders,
      normalizeCustomWallpaper,
      normalizeDesktopIcon,
      normalizeTaskStore,
      workspaceDefaults
    });
    appendReadableTableEntries(target, {
      addEntry,
      isActiveFsItem,
      exportSortTrail,
      exportDesktopNameForItem,
      exportFolderTrailForItem: exportFolderTrail,
      normalizeTableData,
      activeTablePage
    });
    const taskListItems = readableTaskListItemsForExport(target, { isActiveFsItem, exportSortTrail });
    taskListItems.forEach(item => normalizeTaskStore(item));
    appendReadableTaskListEntries(taskListItems, {
      addEntry,
      exportDesktopNameForItem,
      exportFolderTrailForItem: exportFolderTrail
    });

    addEntry("README_экспорта.txt", [
      "ZeTer OS — сохранённые данные.",
      `Дата сохранения: ${humanDateTime()}`,
      "",
      "zeter-os-state.json — полный файл состояния ОС для восстановления через кнопку «Импорт ZIP/JSON-бэкапа».",
      "Папка «Заметки» — заметки каждого рабочего стола лежат прямо в его каталоге без дополнительных папок; изображения встроены внутрь .docx.",
      "Папка «Таблицы» — созданные таблицы в формате .csv.",
      "Папки «Календарь» и «Задачи» — данные календаря и задач в текстовом формате.",
      "Папка «Списки задач» — отдельные списки задач, созданные через правый клик на рабочем столе или в папке.",
      "Папка «Рабочие столы» — названия, описания и информация об иконках рабочих столов.",
      "Папка «Обои» — загруженные пользователем обои в виде обычных файлов изображений. Для восстановления ОС всё равно используй zeter-os-state.json.",
      "Папка «Иконки рабочих столов» — загруженные пользователем иконки рабочих столов.",
      "Служебные записи удаления из старых версий сохраняются внутри zeter-os-state.json только для совместимости и безопасной миграции.",
      ""
    ].join("\n"));
    return entries;
  }

  function createReadableExportRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const ensureDesktops = typeof options.ensureDesktops === "function" ? options.ensureDesktops : () => {};
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : () => false;
    const isExplorerRoot = typeof options.isExplorerRoot === "function" ? options.isExplorerRoot : () => false;
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : id => String(id || "Рабочий стол");
    const desktopDescription = typeof options.desktopDescription === "function" ? options.desktopDescription : () => "";
    const collectVisualSettingsHolders = typeof options.collectVisualSettingsHolders === "function" ? options.collectVisualSettingsHolders : () => [];
    const normalizeCustomWallpaper = typeof options.normalizeCustomWallpaper === "function" ? options.normalizeCustomWallpaper : value => value;
    const normalizeDesktopIcon = typeof options.normalizeDesktopIcon === "function" ? options.normalizeDesktopIcon : value => value;
    const normalizeTaskStore = typeof options.normalizeTaskStore === "function" ? options.normalizeTaskStore : value => value || {};
    const workspaceDefaults = typeof options.workspaceDefaults === "function" ? options.workspaceDefaults : () => ({});
    const normalizeTableData = typeof options.normalizeTableData === "function" ? options.normalizeTableData : value => value || {};
    const activeTablePage = typeof options.activeTablePage === "function" ? options.activeTablePage : value => value;
    const plainToRichHtml = typeof options.plainToRichHtml === "function" ? options.plainToRichHtml : value => String(value || "");
    const cleanRichHtml = typeof options.cleanRichHtml === "function" ? options.cleanRichHtml : value => String(value || "");
    const getWindows = typeof options.getWindows === "function" ? options.getWindows : () => [];
    const getStickyCards = typeof options.getStickyCards === "function" ? options.getStickyCards : () => [];
    const getItem = typeof options.getItem === "function" ? options.getItem : itemId => getState().fs?.[itemId];
    const query = typeof options.query === "function" ? options.query : () => null;
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const trashRoot = options.trashRoot || "trash";

    function folderTrail(item = {}) {
      return exportFolderTrailForItem(item, {
        fs: getState().fs || {},
        sanitizeName: sanitizeExportPathPart,
        isDesktopRoot,
        isExplorerRoot
      });
    }

    function desktopIdForExplorerRoot(rootId) {
      ensureDesktops();
      const state = getState();
      return desktopIdByExplorerRoot(rootId, {
        desktops: state.desktops,
        fs: state.fs,
        isDesktopRoot
      });
    }

    function fallbackDesktopId() {
      ensureDesktops();
      return exportFallbackDesktopIdFromDesktops(getState().desktops, "desktop");
    }

    function explicitDesktopId(item = {}) {
      ensureDesktops();
      return exportExplicitDesktopIdForItem(item, { isDesktopRoot });
    }

    function desktopIdForItem(item = {}) {
      ensureDesktops();
      const state = getState();
      return exportDesktopIdForItem(item, {
        fs: state.fs,
        desktops: state.desktops,
        isDesktopRoot,
        isExplorerRoot,
        fallbackDesktopId: fallbackDesktopId()
      });
    }

    function desktopNameForItem(item = {}) {
      return desktopName(desktopIdForItem(item));
    }

    function activeFsItem(item = {}) {
      return isActiveFsItem(item, { trashRoot });
    }

    function exportableNoteItem(item = {}) {
      return isExportableNoteItem(item, { trashRoot });
    }

    function sortTrail(item = {}) {
      return exportSortTrailForItem(item, {
        fs: getState().fs || {},
        isDesktopRoot,
        isExplorerRoot
      });
    }

    function collectNotes() {
      ensureDesktops();
      return collectNotesForExport(getState(), {
        exportFallbackDesktopId: fallbackDesktopId,
        exportDesktopIdForItem: desktopIdForItem,
        exportSortTrail: sortTrail,
        isExportableNoteItem: exportableNoteItem,
        plainToRichHtml
      });
    }

    function syncLiveEditors() {
      const changed = syncLiveExportSources({
        windows: getWindows(),
        stickyCards: getStickyCards(),
        getItem,
        query,
        cleanRichHtml,
        plainToRichHtml
      });
      if (changed) saveState({ skipExternalBackup: true });
      return changed;
    }

    async function buildEntries() {
      ensureDesktops();
      return buildHumanReadableOsDataEntriesModel(getState(), {
        collectNotesForExport: collectNotes,
        desktopName,
        desktopDescription,
        exportFolderTrail: folderTrail,
        collectVisualSettingsHolders,
        normalizeCustomWallpaper,
        normalizeDesktopIcon,
        normalizeTaskStore,
        workspaceDefaults,
        isActiveFsItem: activeFsItem,
        exportSortTrail: sortTrail,
        exportDesktopNameForItem: desktopNameForItem,
        normalizeTableData,
        activeTablePage
      });
    }

    return Object.freeze({
      folderTrail,
      desktopIdForExplorerRoot,
      fallbackDesktopId,
      explicitDesktopId,
      desktopIdForItem,
      desktopNameForItem,
      activeFsItem,
      exportableNoteItem,
      sortTrail,
      collectNotes,
      syncLiveEditors,
      buildEntries
    });
  }

  window.ZETER_READABLE_EXPORT_UTILS = Object.freeze({
    exportFolderTrailForItem,
    desktopIdByExplorerRoot,
    exportFallbackDesktopIdFromDesktops,
    exportExplicitDesktopIdForItem,
    exportDesktopIdForItem,
    exportSortTrailForItem,
    isActiveFsItem,
    isExportableNoteItem,
    normalizeLegacyNoteForExport,
    collectLegacyNotesForExport,
    collectNotesForExport,
    appendReadableDesktopDataEntries,
    appendReadableTableEntries,
    readableTaskListItemsForExport,
    appendReadableTaskListEntries,
    formatTasksAsText,
    repeatName,
    formatEventsAsText,
    docxImageParagraph,
    docxTextParagraph,
    buildDocxForNote,
    buildHumanReadableOsDataEntriesModel,
    createReadableExportRuntimeController
  });
})();
