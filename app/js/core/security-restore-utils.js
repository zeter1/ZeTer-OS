(() => {
  "use strict";

  // Pure planning only. The caller validates, stages payloads and commits the detached state.
  const SAFE_ID = /^[A-Za-z0-9_-]{1,220}$/;
  const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
  const ITEM_TYPES = new Set(["folder", "note", "text", "markdown", "table", "image", "paint", "managedFile"]);
  const ALIASES = ["tasks", "taskProjects", "activeTaskProjectId", "events", "calendarCategories", "notifications", "automations", "automationCategories", "automationRuntime", "objectLinks"];
  const array = value => Array.isArray(value) ? value : [];
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function safeId(value) {
    if (typeof value !== "string" || !SAFE_ID.test(value) || FORBIDDEN.has(value)) throw new Error("Небезопасный ID объекта восстановления.");
    return value;
  }

  function detached(value, seen = new Set()) {
    if (value == null || typeof value !== "object") return value;
    if (seen.has(value)) throw new Error("Состояние восстановления содержит циклическую ссылку.");
    seen.add(value);
    const out = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach(key => {
      if (FORBIDDEN.has(key)) throw new Error("Небезопасный ключ в состоянии восстановления.");
      out[key] = detached(value[key], seen);
    });
    seen.delete(value);
    return out;
  }

  function desktops(state) {
    return array(state.desktops).length ? state.desktops : [{ id: "desktop", name: "Основной", data: state }];
  }

  function workspace(state, id) {
    const desk = desktops(state).find(entry => entry.id === id);
    if (!desk) throw new Error("Рабочий стол для восстановления не найден.");
    if (desk.data) return desk.data;
    return id === "desktop" ? state : {};
  }

  function ownerOf(state, id) {
    const desks = desktops(state), roots = new Map(desks.map(desk => [desk.id, desk.id]));
    desks.forEach(desk => { if (desk.data?.explorerRootId) roots.set(desk.data.explorerRootId, desk.id); });
    const seen = new Set();
    let cursor = id;
    while (cursor && !seen.has(cursor)) {
      if (roots.has(cursor)) return roots.get(cursor);
      seen.add(cursor);
      cursor = state.fs?.[cursor]?.parent;
    }
    return "";
  }

  function descendants(state, root, includeRoot = true) {
    const ids = new Set(includeRoot ? [root] : []), queue = [root];
    const children = new Map();
    Object.entries(state.fs || {}).forEach(([id, item]) => {
      if (!children.has(item.parent)) children.set(item.parent, []);
      children.get(item.parent).push(id);
    });
    while (queue.length) {
      for (const id of children.get(queue.shift()) || []) {
        if (!ids.has(id)) { ids.add(id); queue.push(id); }
      }
    }
    return ids;
  }

  function desktopFiles(state, id) {
    const ids = descendants(state, id, false), root = workspace(state, id).explorerRootId;
    if (root && state.fs?.[root]) descendants(state, root).forEach(key => ids.add(key));
    return ids;
  }

  function choiceKey(kind, desktopId, id) { return `${kind}:${safeId(desktopId)}:${safeId(id)}`; }

  function listRestoreChoices(incoming) {
    const state = detached(incoming);
    if (!state || !state.fs || typeof state.fs !== "object") throw new Error("В копии не найдены данные для восстановления.");
    const choices = [];
    for (const desk of desktops(state)) {
      safeId(desk.id);
      choices.push({ key: choiceKey("desktop", desk.id, desk.id), kind: "desktop", id: desk.id, desktopId: desk.id, label: desk.name || desk.id, detail: "Рабочий стол целиком: данные, файлы и настройки" });
      array(workspace(state, desk.id).taskProjects).forEach(project => {
        choices.push({ key: choiceKey("project", desk.id, project.id), kind: "project", id: project.id, desktopId: desk.id, label: project.name || "Проект", detail: desk.name || desk.id });
      });
    }
    Object.entries(state.fs).forEach(([id, item]) => {
      if (!ITEM_TYPES.has(item?.type) || item.deletedAt != null || item.system) return;
      const desktopId = ownerOf(state, id);
      if (!desktopId) return;
      choices.push({ key: choiceKey("item", desktopId, id), kind: "item", id, desktopId, label: item.name || id, detail: item.type === "folder" ? "Папка со всем содержимым" : item.type });
    });
    return choices;
  }

  function endpoint(link, side) { return side === "a" ? link.a || link.from || link.source : link.b || link.to || link.target; }

  function collectSelection(source, choice) {
    const data = workspace(source, choice.desktopId), fsIds = new Set(), eventIds = new Set();
    const projects = choice.kind === "desktop" ? array(data.taskProjects) : choice.kind === "project" ? array(data.taskProjects).filter(row => row.id === choice.id) : [];
    const projectIds = new Set(projects.map(row => row.id));
    const tasks = choice.kind === "desktop" ? array(data.tasks) : array(data.tasks).filter(row => projectIds.has(row.projectId));
    const taskIds = new Set(tasks.map(row => row.id));
    const addReference = (ref, allowMissingFile = false) => {
      safeId(ref?.id);
      const kind = ref.kind || ref.type;
      if (kind === "fs") {
        if (!source.fs?.[ref.id]) {
          if (allowMissingFile) return;
          throw new Error("Связанный файл в копии не найден. Выборочное восстановление отменено.");
        }
        if (ownerOf(source, ref.id) !== choice.desktopId) throw new Error("Связь ведёт на другой рабочий стол. Восстановите связанные данные отдельно.");
        descendants(source, ref.id).forEach(id => fsIds.add(id));
      } else if (kind === "event") {
        if (!array(data.events).some(row => row.id === ref.id)) throw new Error("Связанное событие в копии не найдено.");
        eventIds.add(ref.id);
      } else throw new Error("Неподдерживаемая связь в выбранных данных.");
    };
    if (choice.kind === "desktop") desktopFiles(source, choice.desktopId).forEach(id => fsIds.add(id));
    if (choice.kind === "item") addReference({ kind: "fs", id: choice.id });
    if (choice.kind === "desktop") array(data.events).forEach(row => eventIds.add(row.id));
    if (choice.kind === "project") array(data.events).forEach(row => {
      if (projectIds.has(row.projectId) || taskIds.has(row.taskId)) eventIds.add(row.id);
    });
    const scanAttachments = (value, allowMissingFile = false) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value.attachments)) value.attachments.forEach(ref => addReference(ref, allowMissingFile));
      Object.entries(value).forEach(([key, entry]) => { if (key !== "attachments" && typeof entry === "object") scanAttachments(entry, allowMissingFile); });
    };
    projects.forEach(row => scanAttachments(row)); tasks.forEach(row => scanAttachments(row));
    let previous = "";
    while (previous !== `${fsIds.size}:${eventIds.size}`) {
      previous = `${fsIds.size}:${eventIds.size}`;
      [...fsIds].forEach(id => scanAttachments(source.fs[id]));
      array(data.events).filter(event => eventIds.has(event.id)).forEach(event => scanAttachments(event, true));
      array(data.objectLinks).forEach(link => {
        const a = endpoint(link, "a"), b = endpoint(link, "b");
        const selected = ref => (ref?.kind || ref?.type) === "fs" ? fsIds.has(ref.id) : (ref?.kind || ref?.type) === "event" && eventIds.has(ref.id);
        if (selected(a) || selected(b)) { addReference(a); addReference(b); }
      });
    }
    const files = {};
    fsIds.forEach(id => { safeId(id); files[id] = detached(source.fs[id]); });
    const selectedData = choice.kind === "desktop" ? detached(data) : {
      taskProjects: detached(projects), tasks: detached(tasks),
      events: detached(array(data.events).filter(row => eventIds.has(row.id))),
      calendarCategories: detached(array(data.calendarCategories).filter(category => array(data.events).some(event => eventIds.has(event.id) && event.category === category.id))),
      objectLinks: detached(array(data.objectLinks).filter(link => {
        const ref = endpoint(link, "a");
        return (ref?.kind || ref?.type) === "fs" ? fsIds.has(ref.id) : eventIds.has(ref?.id);
      })),
      timeTracking: { entries: detached(array(data.timeTracking?.entries).filter(row => projectIds.has(row.projectId) || taskIds.has(row.taskId))), active: null }
    };
    if (choice.kind !== "desktop" && data.timeTracking?.active && (projectIds.has(data.timeTracking.active.projectId) || taskIds.has(data.timeTracking.active.taskId))) selectedData.timeTracking.active = detached(data.timeTracking.active);
    return { files, data: selectedData, fsIds };
  }

  function collectUsedIds(value, used) {
    if (!value || typeof value !== "object") return;
    if (typeof value.id === "string") used.add(value.id);
    Object.values(value).forEach(entry => { if (entry && typeof entry === "object") collectUsedIds(entry, used); });
  }

  function idAllocator(current, source, createId) {
    const used = new Set();
    collectUsedIds(current, used); collectUsedIds(source, used);
    Object.keys(current.fs || {}).forEach(id => used.add(id));
    let serial = 0;
    return kind => {
      const generated = typeof createId === "function" ? safeId(createId(kind)) : `restore_${kind}`;
      const maxLength = kind === "calendarCategory" ? 180 : 220;
      const preferred = (kind === "calendarCategory" && !/^calcat_[A-Za-z0-9_-]+$/.test(generated) ? `calcat_${generated}` : generated).slice(0, maxLength);
      let id = preferred;
      while (used.has(id)) id = `${preferred.slice(0, maxLength - 20)}_${++serial}`;
      used.add(id);
      return id;
    };
  }

  function restoredName(name, existing) {
    const base = `${String(name || "Объект").slice(0, 260)} — восстановлено`;
    const names = new Set(existing.map(value => String(value || "").toLocaleLowerCase("ru-RU")));
    let result = base, suffix = 2;
    while (names.has(result.toLocaleLowerCase("ru-RU"))) result = `${base} (${suffix++})`;
    return result;
  }

  const REFERENCE_FIELDS = new Set(["projectId", "taskId", "categoryId", "eventId", "itemId", "fileId", "folderId", "sourceFolderId", "targetFolderId", "noteFolderId", "parentId", "targetId", "automationId", "originAutomationId", "actionId", "triggerId", "objectId", "queueId", "activeTaskProjectId", "explorerRootId", "originalParent"]);
  const REFERENCE_ARRAYS = new Set(["dependencies", "dependsOn", "taskIds", "fileIds", "knownFileIds", "expandedExplorerFolders", "chainAutomationIds", "completedActionIds"]);

  function remapCopy(selection, sourceDesktopId, targetDesktopId, allocate) {
    const map = new Map([[sourceDesktopId, targetDesktopId]]), records = new Map();
    const selectedRefs = { taskId: new Set(array(selection.data.tasks).map(row => row.id)), projectId: new Set(array(selection.data.taskProjects).map(row => row.id)) };
    const selectedFiles = new Set(Object.keys(selection.files));
    function register(value, path) {
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string") {
        const endpointOnly = (["fs", "event", "task"].includes(value.kind || value.type) && Object.keys(value).every(key => ["id", "kind", "type"].includes(key)))
          || (value.mode === "selected" && ["fs", "event", "task"].includes(value.kind) && Object.keys(value).every(key => ["id", "kind", "mode"].includes(key)));
        if (!endpointOnly) {
          safeId(value.id);
          if (records.has(value.id)) throw new Error(`Повтор ID «${value.id}» в выбранных данных: однозначная копия невозможна. Выберите меньший объект.`);
          records.set(value.id, path);
          map.set(value.id, allocate(path.includes(".calendarCategories.") ? "calendarCategory" : "object"));
        }
      }
      Object.entries(value).forEach(([key, entry]) => {
        // normalizeAutomation owns a legacy action alias of actions[0], not a second entity.
        if (key === "action" && entry?.id && array(value.actions).some(action => action.id === entry.id)) return;
        register(entry, `${path}.${key}`);
      });
    }
    register(selection, "selection");
    const historical = new Map();
    function reference(id, key, history) {
      if (!id || ["none", "all", "last"].includes(id)) return id;
      // Time entries intentionally retain snapshots of deleted task/project identities.
      if (history && ["taskId", "projectId"].includes(key)) {
        if (selectedRefs[key].has(id) && map.has(id)) return map.get(id);
        safeId(id);
        const identity = `${key}:${id}`;
        if (!historical.has(identity)) historical.set(identity, allocate("history"));
        return historical.get(identity);
      }
      if (map.has(id)) return map.get(id);
      if (key === "calendarCategory" && /^calcat_[A-Za-z0-9_-]+$/.test(id)) {
        safeId(id);
        if (!historical.has(id)) historical.set(id, allocate("calendarCategory"));
        return historical.get(id);
      }
      throw new Error(`Связь «${key}» ведёт к недоступному объекту «${id}». Выберите рабочий стол целиком.`);
    }
    function rewrite(value, history = false, role = "") {
      if (!value || typeof value !== "object") return value;
      const isHistory = history || Array.isArray(value.segments) || role === "calendar-event";
      Object.keys(value).forEach(key => {
        const entry = value[key];
        if (key === "id" && role === "event-attachment" && (value.kind || value.type) === "fs" && !selectedFiles.has(entry)) {
          safeId(entry);
          const identity = `missing-file:${entry}`;
          if (!historical.has(identity)) historical.set(identity, allocate("history"));
          value[key] = historical.get(identity);
        }
        else if (key === "id" && typeof entry === "string") value[key] = reference(entry, key, isHistory);
        else if (key === "parent" && typeof entry === "string") value[key] = map.get(entry) || targetDesktopId;
        else if (key === "desktopId" && entry === sourceDesktopId) value[key] = targetDesktopId;
        else if (key === "category" && role === "calendar-event" && typeof entry === "string" && entry.startsWith("calcat_")) value[key] = reference(entry, "calendarCategory", false);
        else if (REFERENCE_FIELDS.has(key) && typeof entry === "string") value[key] = reference(entry, key, isHistory);
        else if (key === "value" && role === "condition" && typeof entry === "string" && (["file_source_folder", "task_project"].includes(value.type) || value.type === "object_exists" && value.mode === "selected")) value[key] = reference(entry, `condition.${value.type}`, isHistory);
        else if ((key === "target" && value.kind === "zeter" || key === "shortcutTarget" && value.kind === "shortcut") && typeof entry === "string" && /^zeter:\/\/item\//i.test(entry)) {
          const match = /^zeter:\/\/item\/([A-Za-z0-9_-]{1,220})$/i.exec(entry);
          if (!match) throw new Error("Небезопасная внутренняя ссылка ярлыка.");
          const id = reference(match[1], "shortcut", isHistory);
          if (id.length > 160) throw new Error("ID копии слишком длинный для внутреннего ярлыка.");
          value[key] = `zeter://item/${id}`;
        }
        else if (REFERENCE_ARRAYS.has(key) && Array.isArray(entry)) value[key] = entry.map(id => typeof id === "string" ? reference(id, key, isHistory) : rewrite(id, isHistory));
        else if (entry && typeof entry === "object") {
          const nextRole = key === "events" ? "calendar-event-list" : role === "calendar-event-list" ? "calendar-event" : role === "calendar-event" && key === "attachments" ? "event-attachment-list" : role === "event-attachment-list" ? "event-attachment" : key === "automations" ? "automation-list" : role === "automation-list" ? "automation" : role === "automation" && key === "conditions" ? "condition-list" : role === "condition-list" ? "condition" : "";
          rewrite(entry, isHistory, nextRole);
        }
      });
      return value;
    }
    rewrite(selection);
    const files = {};
    Object.values(selection.files).forEach(item => { files[item.id] = item; });
    selection.files = files;
    return map;
  }

  function stopRecoveredTimer(data, warnings) {
    const active = data.timeTracking?.active;
    if (!active) return;
    const end = array(active.segments).at(-1)?.end || active.createdAt || 0;
    active.runningSince = null;
    active.runtimeId = "";
    active.finishedAt = end;
    data.timeTracking.entries = [...array(data.timeTracking.entries), active];
    data.timeTracking.active = null;
    warnings.push("Незавершённый таймер восстановлен остановленным; учтены только записанные интервалы.");
  }

  function mergeRecords(target, incoming, mode, kind, changes) {
    const result = array(target).slice();
    incoming.forEach(row => {
      const index = mode === "replace" ? result.findIndex(existing => existing.id === row.id) : -1;
      if (index >= 0) {
        const old = result[index];
        if (kind === "project") {
          row.categories = [...array(row.categories), ...array(old.categories).filter(category => !array(row.categories).some(restored => restored.id === category.id))];
          row.attachments = [...array(row.attachments), ...array(old.attachments).filter(ref => !array(row.attachments).some(restored => restored.kind === ref.kind && restored.id === ref.id))];
        }
        result[index] = row;
      } else result.push(row);
      changes.push({ kind, label: row.name || row.title || row.id, action: index >= 0 ? "update" : "add" });
    });
    return result;
  }

  function protectDesktopRemoval(state, sourceId, removedIds) {
    // Refuse deletion when another desktop or archive still depends on a removed file.
    function scan(value) {
      if (!value || typeof value !== "object") return;
      const endpointId = (value.kind || value.type) === "fs" ? value.id : null;
      if (endpointId && removedIds.has(endpointId)) throw new Error("Другие данные содержат связь с заменяемым рабочим столом. Замена отменена.");
      for (const [key, entry] of Object.entries(value)) {
        if (["itemId", "fileId", "folderId", "sourceFolderId", "targetFolderId", "parent"].includes(key) && removedIds.has(entry)) throw new Error("Данные другого рабочего стола ссылаются на удаляемый файл. Замена отменена.");
        if (typeof entry === "object") scan(entry);
      }
    }
    desktops(state).filter(desk => desk.id !== sourceId).forEach(scan);
    Object.entries(state.fs || {}).forEach(([id, item]) => { if (!removedIds.has(id)) scan(item); });
    scan(state.archivedDesktops);
  }

  function prepareSelectiveRestore(current, incoming, options = {}) {
    const state = detached(current), source = detached(incoming);
    const choice = listRestoreChoices(source).find(row => row.key === options.key);
    if (!choice) throw new Error("Выбранный объект восстановления не найден.");
    const mode = options.mode || "copy";
    if (!["copy", "replace"].includes(mode)) throw new Error("Неизвестный режим восстановления.");
    if (!Array.isArray(state.desktops) || !state.desktops.length) {
      const data = {};
      ["settings", ...ALIASES, "timeTracking"].forEach(key => { if (has(state, key)) data[key] = state[key]; });
      state.desktops = [{ id: "desktop", name: "Основной", data }];
    }
    if (!state.fs || typeof state.fs !== "object") throw new Error("Текущая файловая система недоступна.");
    state.desktops.forEach(desk => {
      if (!desk.data) {
        desk.data = {};
        if (desk.id === "desktop") ["settings", ...ALIASES, "timeTracking"].forEach(key => { if (has(state, key)) desk.data[key] = state[key]; });
      }
    });
    const allocate = idAllocator(state, source, options.createId), warnings = [], changes = [];
    let targetDesktopId = options.targetDesktopId || (mode === "replace" ? choice.desktopId : state.currentDesktop || "desktop");
    safeId(targetDesktopId);
    if (mode === "replace" && targetDesktopId !== choice.desktopId) throw new Error("Замена допустима только на исходном рабочем столе. Выберите восстановление копией.");
    const selection = collectSelection(source, choice);
    if (choice.kind === "desktop" && mode === "copy") targetDesktopId = allocate("desktop");
    else workspace(state, targetDesktopId);
    if (mode === "copy") remapCopy(selection, choice.desktopId, targetDesktopId, allocate);
    else {
      // Deleted source identities must not bind to unrelated objects created since the backup.
      const sourceData = workspace(source, choice.desktopId), historical = new Map();
      array(selection.data.events).forEach(event => {
        if (typeof event.category === "string" && event.category.startsWith("calcat_") && !array(sourceData.calendarCategories).some(row => row.id === event.category)) {
          safeId(event.category);
          const identity = `calendarCategory:${event.category}`;
          if (!historical.has(identity)) historical.set(identity, allocate("calendarCategory"));
          event.category = historical.get(identity);
        }
        array(event.attachments).forEach(ref => {
          if ((ref.kind || ref.type) !== "fs" || source.fs?.[ref.id]) return;
          safeId(ref.id);
          const identity = `missing-file:${ref.id}`;
          if (!historical.has(identity)) historical.set(identity, allocate("history"));
          ref.id = historical.get(identity);
        });
        for (const [key, records] of [["taskId", sourceData.tasks], ["projectId", sourceData.taskProjects]]) {
          if (!event[key] || array(records).some(row => row.id === event[key])) continue;
          safeId(event[key]);
          const identity = `${key}:${event[key]}`;
          if (!historical.has(identity)) historical.set(identity, allocate("history"));
          event[key] = historical.get(identity);
        }
      });
    }
    stopRecoveredTimer(selection.data, warnings);
    if (choice.kind === "desktop" && array(selection.data.automations).length) {
      selection.data.automations.forEach(rule => { rule.enabled = false; });
      warnings.push("Восстановленные автоматизации выключены. Проверь правила и включи их вручную.");
    }

    if (mode === "replace") {
      Object.keys(selection.files).forEach(id => {
        if (state.fs[id] && ownerOf(state, id) !== choice.desktopId) throw new Error("Файл с таким ID уже принадлежит другому рабочему столу. Замена отменена.");
        if (state.fs[id] && state.fs[id].type !== selection.files[id].type) throw new Error("Тип существующего файла или папки изменился. Выберите восстановление копией.");
      });
      if (choice.kind !== "desktop") selection.data.tasks.forEach(task => {
        const existing = array(workspace(state, targetDesktopId).tasks).find(row => row.id === task.id);
        if (existing && existing.projectId !== task.projectId) throw new Error("Задача теперь принадлежит другому проекту. Выберите восстановление копией.");
      });
    }
    if (choice.kind === "desktop") {
      const sourceDesk = detached(desktops(source).find(desk => desk.id === choice.desktopId));
      sourceDesk.id = targetDesktopId;
      sourceDesk.data = selection.data;
      if (mode === "copy") {
        sourceDesk.name = restoredName(sourceDesk.name, state.desktops.map(desk => desk.name));
        state.desktops.push(sourceDesk);
        changes.push({ kind: "desktop", label: sourceDesk.name, action: "add" });
      } else {
        const old = desktopFiles(state, targetDesktopId);
        protectDesktopRemoval(state, targetDesktopId, old);
        old.forEach(id => {
          if (!has(selection.files, id)) changes.push({ kind: "item", label: state.fs[id].name || id, action: "remove" });
          delete state.fs[id];
        });
        const oldData = workspace(state, targetDesktopId);
        ["tasks", "taskProjects", "events", "notifications", "objectLinks", "automations"].forEach(key => array(oldData[key]).forEach(row => {
          if (!array(selection.data[key]).some(restored => restored.id === row.id)) changes.push({ kind: key, label: row.name || row.title || row.id, action: "remove" });
        }));
        for (const [group, key] of [["timeTracking", "entries"], ["library", "entries"], ["library", "categories"], ["promptLibrary", "entries"], ["promptLibrary", "projects"], ["promptLibrary", "categories"], ["contacts", "entries"], ["contacts", "projects"], ["contacts", "categories"]]) {
          array(oldData[group]?.[key]).forEach(row => {
            if (!array(selection.data[group]?.[key]).some(restored => restored.id === row.id)) changes.push({ kind: group, label: row.name || row.title || row.id, action: "remove" });
          });
        }
        if (oldData.timeTracking?.active) changes.push({ kind: "time", label: oldData.timeTracking.active.title || "Текущий таймер", action: "remove" });
        changes.push({ kind: "settings", label: "Настройки выбранного рабочего стола", action: "update" });
        state.desktops[state.desktops.findIndex(desk => desk.id === targetDesktopId)] = sourceDesk;
        changes.push({ kind: "desktop", label: sourceDesk.name, action: "update" });
      }
    } else {
      const target = workspace(state, targetDesktopId);
      if (mode === "copy") selection.data.taskProjects.forEach(project => { project.name = restoredName(project.name, array(target.taskProjects).map(row => row.name)); });
      for (const [key, kind] of [["taskProjects", "project"], ["tasks", "task"], ["events", "event"], ["calendarCategories", "calendarCategory"], ["objectLinks", "link"]]) {
        if (array(selection.data[key]).length) target[key] = mergeRecords(target[key], selection.data[key], mode, kind, changes);
      }
      if (array(selection.data.timeTracking?.entries).length) {
        target.timeTracking = target.timeTracking || { entries: [], active: null, dailyGoalMinutes: 0 };
        if (mode === "replace" && target.timeTracking.active && selection.data.timeTracking.entries.some(row => row.id === target.timeTracking.active.id)) throw new Error("Текущий таймер использует восстанавливаемую запись. Сначала остановите таймер.");
        target.timeTracking.entries = mergeRecords(target.timeTracking.entries, selection.data.timeTracking.entries, mode, "time", changes);
      }
    }
    Object.entries(selection.files).forEach(([id, item]) => {
      const exists = has(state.fs, id);
      if (mode === "copy") item.name = restoredName(item.name, Object.values(state.fs).filter(row => row.parent === item.parent).map(row => row.name));
      // A missing original parent is restored at the desktop root; never attach to another desktop.
      if (mode === "replace" && !has(selection.files, item.parent) && item.parent !== targetDesktopId && (!state.fs[item.parent] || ownerOf(state, item.parent) !== targetDesktopId)) item.parent = targetDesktopId;
      state.fs[id] = item;
      changes.push({ kind: "item", label: item.name || id, action: exists ? "update" : "add" });
    });
    const primary = state.desktops.find(desk => desk.id === "desktop");
    if (primary?.data) ALIASES.forEach(key => { if (has(primary.data, key)) state[key] = primary.data[key]; });
    const summary = { added: 0, updated: 0, removed: 0, files: Object.keys(selection.files).length, tasks: array(selection.data.tasks).length, events: array(selection.data.events).length, projects: array(selection.data.taskProjects).length };
    changes.forEach(row => { if (row.action === "add") summary.added++; else if (row.action === "update") summary.updated++; else summary.removed++; });
    return { state, summary, changes, warnings, key: choice.key, mode };
  }

  window.ZETER_SECURITY_RESTORE_UTILS = Object.freeze({ listRestoreChoices, prepareSelectiveRestore });
})();
