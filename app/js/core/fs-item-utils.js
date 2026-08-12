(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS fs item utils require config.");

  const { TRASH_ROOT } = config;

  function fsItems(fs = {}) {
    return Array.isArray(fs) ? fs : Object.values(fs || {});
  }

  function folderNameExists(fs = {}, parent, name, excludeId = null) {
    const target = String(name || "").trim().toLowerCase();
    if (!target) return false;
    return fsItems(fs).some(item =>
      item &&
      item.id !== excludeId &&
      item.type === "folder" &&
      item.parent === parent &&
      !item.deletedAt &&
      String(item.name || "").trim().toLowerCase() === target
    );
  }

  function uniqueName(fs = {}, name, parent, excludeId = null) {
    const items = fsItems(fs);
    const cleanName = String(name || "Элемент");
    const exists = candidate => items.some(item =>
      item &&
      item.id !== excludeId &&
      !item.deletedAt &&
      item.parent === parent &&
      item.name === candidate
    );
    if (!exists(cleanName)) return cleanName;
    const dot = cleanName.lastIndexOf(".");
    const base = dot > -1 ? cleanName.slice(0, dot) : cleanName;
    const ext = dot > -1 ? cleanName.slice(dot) : "";
    let index = 2;
    while (exists(`${base} (${index})${ext}`)) index++;
    return `${base} (${index})${ext}`;
  }

  function itemPath(item = {}, fs = {}, options = {}) {
    const parts = [item.name || "Элемент"];
    let parent = fs?.[item.parent];
    while (parent) {
      parts.unshift(parent.name || parent.id);
      parent = fs[parent.parent];
    }
    if (typeof options.isDesktopRoot === "function" && options.isDesktopRoot(item.parent)) {
      const desktopName = typeof options.desktopName === "function" ? options.desktopName(item.parent) : item.parent;
      parts.unshift(desktopName || "Рабочий стол");
    }
    if (item.parent === (options.trashRoot || TRASH_ROOT)) parts.unshift("Удалённые записи старой версии");
    return parts.join(" / ");
  }

  function descendantIds(fs = {}, folderId) {
    const out = [];
    const walk = id => {
      fsItems(fs)
        .filter(item => item?.parent === id)
        .forEach(child => {
          out.push(child.id);
          if (child.type === "folder") walk(child.id);
        });
    };
    walk(folderId);
    return out;
  }

  function createFsItemRecord(fs = {}, type, name, parent = "desktop", options = {}) {
    const fallbackName = options.fallbackName || (type === "folder" ? "Новая папка" : "Элемент");
    const cleanName = String(name || fallbackName).trim() || fallbackName;
    if (type === "folder" && folderNameExists(fs, parent, cleanName)) {
      return { item: null, keyId: "", error: { code: "folder_exists", name: cleanName } };
    }

    const makeId = typeof options.uid === "function"
      ? options.uid
      : value => `${value || "item"}_${Date.now()}`;
    const makeUniqueName = typeof options.uniqueName === "function"
      ? options.uniqueName
      : value => uniqueName(fs, value, parent);
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const keyId = makeId(type);
    const fallbackPosition = {
      x: Number.isFinite(Number(options.x)) ? Number(options.x) : 40,
      y: Number.isFinite(Number(options.y)) ? Number(options.y) : 40
    };
    const position = typeof options.positionForItem === "function"
      ? options.positionForItem({ id: keyId, type, name: cleanName, parent, x: options.x, y: options.y })
      : fallbackPosition;

    const item = {
      id: keyId,
      type,
      name: type === "folder" ? cleanName : makeUniqueName(cleanName, parent),
      parent,
      x: Number.isFinite(Number(position?.x)) ? Number(position.x) : fallbackPosition.x,
      y: Number.isFinite(Number(position?.y)) ? Number(position.y) : fallbackPosition.y,
      createdAt: now,
      updatedAt: now,
      ...(options.extra || {})
    };
    return { item, keyId, error: null };
  }

  function duplicateFsItem(item = null, options = {}) {
    if (!item) return null;
    const makeId = typeof options.uid === "function"
      ? options.uid
      : type => `${type}_${Date.now()}`;
    const makeUniqueName = typeof options.uniqueName === "function"
      ? options.uniqueName
      : name => name;
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const copy = JSON.parse(JSON.stringify(item));

    copy.id = makeId(item.type);
    copy.name = makeUniqueName(`${item.name} — копия`, item.parent);

    const position = typeof options.positionForCopy === "function"
      ? options.positionForCopy(item, copy)
      : { x: (item.x || 0) + 24, y: (item.y || 0) + 24 };
    copy.x = Number.isFinite(Number(position?.x)) ? Number(position.x) : (item.x || 0) + 24;
    copy.y = Number.isFinite(Number(position?.y)) ? Number(position.y) : (item.y || 0) + 24;

    if (copy.type === "tasklist") {
      if (typeof options.normalizeTaskStore === "function") options.normalizeTaskStore(copy);
      const projectMap = new Map();
      copy.taskProjects = Array.isArray(copy.taskProjects) ? copy.taskProjects.map(project => {
        const nextId = makeId("project");
        projectMap.set(project.id, nextId);
        return { ...project, id: nextId, createdAt: now, updatedAt: now };
      }) : [];
      copy.tasks = Array.isArray(copy.tasks) ? copy.tasks.map(task => ({
        ...task,
        id: makeId("task"),
        projectId: projectMap.get(task.projectId) || copy.taskProjects[0]?.id,
        checklist: (task.checklist || []).map(sub => ({ ...sub, id: makeId("sub") })),
        createdAt: now,
        updatedAt: now
      })) : [];
      copy.activeTaskProjectId = projectMap.get(copy.activeTaskProjectId) || copy.taskProjects[0]?.id;
    }

    copy.pinnedInStart = false;
    copy.startPinnedAt = 0;
    copy.createdAt = now;
    copy.updatedAt = now;
    if (copy.type === "shortcut" && copy.managedFile) copy.managedFile.id = makeId("shortcut-ref");
    return copy;
  }

  function applyFsItemPosition(item = null, parentId = "", position = {}, options = {}) {
    if (!item || !parentId || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return false;
    item.parent = parentId;
    item.x = position.x;
    item.y = position.y;
    item.updatedAt = typeof options.now === "function" ? options.now() : Date.now();
    return true;
  }

  function itemDescription(item = {}, options = {}) {
    const fs = options.fs || {};
    if (item.type === "app") {
      const app = options.apps?.[item.appId];
      return app?.name || "Приложение";
    }
    if (item.type === "folder") return `${fsItems(fs).filter(child => child.parent === item.id).length} элементов`;
    if (item.type === "shortcut") {
      const kind = item.shortcut?.kind || item.managedFile?.shortcutKind;
      return kind === "url" ? "Ярлык сайта" : kind === "zeter" ? "Ярлык ZeTer OS" : "Ярлык Windows";
    }
    if (item.type === "table" && typeof options.normalizeTableData === "function" && typeof options.activeTablePage === "function") {
      const table = options.normalizeTableData(item.table || item);
      const page = options.activeTablePage(table);
      return `${page.rows.length}×${page.columns.length} · ${table.pages.length} стр. · таблица`;
    }
    if (item.type === "tasklist" && typeof options.normalizeTaskStore === "function") {
      options.normalizeTaskStore(item);
      return `${item.tasks.length} задач · ${item.taskProjects.length} проектов`;
    }
    const chars = String(item.content || "").length;
    return `${chars} символов · ${new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleDateString("ru-RU")}`;
  }

  function createFsItemController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {} });
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : id => id === "desktop";
    const createId = typeof options.createId === "function" ? options.createId : type => `${type}_${Date.now()}`;
    const clientToDesktopPosition = typeof options.clientToDesktopPosition === "function" ? options.clientToDesktopPosition : (x, y) => ({ x, y });
    const findFreeDesktopPosition = typeof options.findFreeDesktopPosition === "function" ? options.findFreeDesktopPosition : (parent, x, y) => ({ x, y });
    const findFreeFolderPosition = typeof options.findFreeFolderPosition === "function" ? options.findFreeFolderPosition : (parent, x, y) => ({ x, y });
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderAllFileSurfaces = typeof options.renderAllFileSurfaces === "function" ? options.renderAllFileSurfaces : () => {};
    const notify = typeof options.toast === "function" ? options.toast : () => {};
    const requestText = typeof options.prompt === "function" ? options.prompt : () => null;
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : id => id;
    const trashRoot = options.trashRoot || TRASH_ROOT;
    const normalizeTaskStore = typeof options.normalizeTaskStore === "function" ? options.normalizeTaskStore : () => {};
    const refreshOpenEditors = typeof options.refreshOpenEditors === "function" ? options.refreshOpenEditors : () => {};
    const refreshOpenTaskListTitles = typeof options.refreshOpenTaskListTitles === "function" ? options.refreshOpenTaskListTitles : () => {};
    const refreshOpenTaskShortcutTitles = typeof options.refreshOpenTaskShortcutTitles === "function" ? options.refreshOpenTaskShortcutTitles : () => {};
    const itemKind = typeof options.itemKind === "function" ? options.itemKind : () => "";
    const itemSize = typeof options.itemSize === "function" ? options.itemSize : () => "";
    const buildPropertiesText = typeof options.itemPropertiesText === "function" ? options.itemPropertiesText : () => "";
    const showAlert = typeof options.alert === "function" ? options.alert : () => {};
    const starterContentForExtension = typeof options.starterContentForExtension === "function" ? options.starterContentForExtension : () => "";
    const plainToRichHtml = typeof options.plainToRichHtml === "function" ? options.plainToRichHtml : value => String(value || "");
    const openItem = typeof options.openItem === "function" ? options.openItem : () => {};
    const ensureTableFileName = typeof options.ensureTableFileName === "function" ? options.ensureTableFileName : value => String(value || "");
    const makeDefaultTableData = typeof options.makeDefaultTableData === "function" ? options.makeDefaultTableData : () => ({});
    const tableToCSV = typeof options.tableToCSV === "function" ? options.tableToCSV : () => "";
    const makeTaskProject = typeof options.makeTaskProject === "function" ? options.makeTaskProject : name => ({ id: "project", name });
    const defaultTaskProjectName = options.defaultTaskProjectName || "Основные";

    function folderExists(parent, name, excludeId = null) {
      return folderNameExists(getState().fs, parent, name, excludeId);
    }

    function uniqueItemName(name, parent, excludeId = null) {
      return uniqueName(getState().fs, name, parent, excludeId);
    }

    function pathForItem(item = {}) {
      return itemPath(item, getState().fs, { isDesktopRoot, desktopName, trashRoot });
    }

    function createItem(type, name, parent = getDesktopRoot(), x = 40, y = 40, extra = {}) {
      const state = getState();
      const result = createFsItemRecord(state.fs, type, name, parent, {
        x,
        y,
        extra,
        uid: createId,
        uniqueName: uniqueItemName,
        positionForItem: draft => {
          let position = clientToDesktopPosition(Number.isFinite(x) ? x : 80, Number.isFinite(y) ? y : 80);
          if (isDesktopRoot(parent)) {
            position = findFreeDesktopPosition(parent, x, y, draft.id);
          } else if (state.fs[parent]?.type === "folder") {
            position = findFreeFolderPosition(parent, Number.isFinite(x) ? x : 36, Number.isFinite(y) ? y : 36, draft.id);
          }
          return position;
        }
      });
      if (result.error?.code === "folder_exists") {
        notify("Папка уже существует", `В этом месте уже есть папка «${result.error.name}». Выбери другое имя.`);
        return null;
      }
      const id = result.keyId;
      state.fs[id] = result.item;
      saveState();
      renderAllFileSurfaces();
      notify("Создано", state.fs[id].name);
      return id;
    }

    function createFolder(parent = getDesktopRoot(), createOptions = {}) {
      const defaultName = createOptions.defaultName || "Новая папка";
      let name = createOptions.prompt === false ? defaultName : requestText("Название папки:", defaultName);
      if (name === null) return null;
      name = String(name || "").trim() || defaultName;
      return createItem("folder", name, parent, createOptions.x ?? 40, createOptions.y ?? 40, createOptions.extra || {});
    }

    function renameItem(itemId) {
      const item = getState().fs[itemId];
      if (!item) return false;
      const name = requestText("Новое имя:", item.name);
      if (!name || !name.trim()) return false;
      const clean = name.trim();
      if (item.type === "folder" && folderExists(item.parent, clean, item.id)) {
        notify("Папка уже существует", `В этом месте уже есть папка «${clean}». Адреса папок должны быть уникальными.`);
        return false;
      }
      item.name = clean;
      item.updatedAt = Date.now();
      saveState();
      renderAllFileSurfaces();
      refreshOpenEditors(itemId);
      refreshOpenTaskListTitles(itemId);
      refreshOpenTaskShortcutTitles(itemId);
      return true;
    }

    function duplicateItem(itemId) {
      const state = getState();
      const item = state.fs[itemId];
      if (!item) return null;
      const copy = duplicateFsItem(item, {
        uid: createId,
        uniqueName: uniqueItemName,
        normalizeTaskStore,
        positionForCopy: (source, draft) => {
          if (isDesktopRoot(draft.parent)) {
            return findFreeDesktopPosition(draft.parent, (source.x || 0) + 118, source.y || 0, draft.id);
          }
          return { x: (source.x || 0) + 24, y: (source.y || 0) + 24 };
        }
      });
      if (!copy) return null;
      state.fs[copy.id] = copy;
      saveState();
      renderAllFileSurfaces();
      notify("Копия создана", copy.name);
      return copy.id;
    }

    function showProperties(itemId) {
      const item = getState().fs[itemId];
      if (!item) return false;
      showAlert(buildPropertiesText({
        name: item.name,
        kind: itemKind(item),
        size: itemSize(item),
        path: pathForItem(item),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        deletedAt: item.deletedAt
      }));
      return true;
    }

    function createFile(parent = "desktop", createOptions = {}) {
      const defaultName = createOptions.defaultName || "Новый файл.txt";
      let name = requestText(
        "Имя файла. Можно указать расширение: .txt, .md, .json, .html, .css, .js",
        defaultName
      );
      if (name === null) return null;
      name = name.trim();
      if (!name) name = defaultName;
      if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += ".txt";

      const extension = (name.split(".").pop() || "txt").toLowerCase();
      const type = extension === "md" ? "markdown" : "text";
      const starter = starterContentForExtension(extension, name);
      const id = createItem(type, name, parent, createOptions.x ?? 40, createOptions.y ?? 40, {
        content: starter,
        richContent: type === "text" ? plainToRichHtml(starter) : "",
        extension
      });
      if (createOptions.openAfter !== false) openItem(id);
      return id;
    }

    function createTable(parent = getDesktopRoot(), createOptions = {}) {
      let name = requestText("Название таблицы:", createOptions.defaultName || "Новая таблица.table");
      if (name === null) return null;
      name = ensureTableFileName(name);
      const id = createItem("table", name, parent, createOptions.x ?? 40, createOptions.y ?? 40, {
        table: makeDefaultTableData(createOptions.rows, createOptions.cols),
        content: "",
        extension: name.toLowerCase().endsWith(".csv") ? "csv" : "table"
      });
      getState().fs[id].content = tableToCSV(getState().fs[id]);
      saveState();
      if (createOptions.openAfter !== false) openItem(id);
      return id;
    }

    function createTaskList(parent = getDesktopRoot(), createOptions = {}) {
      let name = requestText("Название списка задач:", createOptions.defaultName || "Новый список задач");
      if (name === null) return null;
      name = String(name || "").trim() || "Новый список задач";
      const project = makeTaskProject(defaultTaskProjectName);
      const id = createItem("tasklist", name, parent, createOptions.x ?? 40, createOptions.y ?? 40, {
        tasks: [],
        taskProjects: [project],
        activeTaskProjectId: project.id,
        extension: "tasks"
      });
      if (createOptions.openAfter !== false) openItem(id);
      return id;
    }

    return Object.freeze({
      folderNameExists: folderExists,
      uniqueName: uniqueItemName,
      itemPath: pathForItem,
      createItem,
      createFolder,
      renameItem,
      duplicateItem,
      showProperties,
      createFile,
      createTable,
      createTaskList
    });
  }

  window.ZETER_FS_ITEM_UTILS = Object.freeze({
    folderNameExists,
    uniqueName,
    itemPath,
    descendantIds,
    createFsItemRecord,
    duplicateFsItem,
    applyFsItemPosition,
    itemDescription,
    createFsItemController
  });
})();
