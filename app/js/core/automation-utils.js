(() => {
  "use strict";

  const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,220}$/;
  const AUTOMATION_MAX_ITEMS = 1000;
  const AUTOMATION_NAME_MAX_CHARS = 160;
  const AUTOMATION_TEXT_MAX_CHARS = 1000;
  const AUTOMATION_RUN_KEY_MAX_CHARS = 220;
  const AUTOMATION_MAX_CONDITIONS = 20;
  const AUTOMATION_MAX_ACTIONS = 20;
  const AUTOMATION_QUEUE_MAX_ITEMS = 500;
  const AUTOMATION_HISTORY_MAX_ITEMS = 200;
  const AUTOMATION_CHECKPOINT_MAX_ITEMS = 500;
  const AUTOMATION_KNOWN_FILE_MAX_ITEMS = 5000;
  const AUTOMATION_ACTION_RESULT_MAX_ITEMS = 20;
  const AUTOMATION_RETRY_MAX_ATTEMPTS = 5;
  const AUTOMATION_RATE_WINDOW_MS = 60 * 1000;
  const AUTOMATION_RATE_PER_RULE = 10;
  const AUTOMATION_RATE_GLOBAL = 30;
  const AUTOMATION_CHAIN_MAX_DEPTH = 8;
  const AUTOMATION_TYPES = Object.freeze([
    "weekly", "daily", "monthly", "event_before", "event_relative", "file_added",
    "task_completed", "task_overdue", "note_created", "note_changed", "event_created", "startup"
  ]);
  const AUTOMATION_CONDITIONS = Object.freeze([
    "file_name_contains", "file_extension", "file_size", "file_source_folder",
    "event_title_contains", "event_category", "event_datetime", "object_exists",
    "task_title_contains", "task_project", "task_status", "note_name_contains", "note_content_contains"
  ]);
  const AUTOMATION_ACTION_TYPES = Object.freeze(["notify", "create_note", "move_file", "link_objects"]);
  const AUTOMATION_HISTORY_STATUSES = Object.freeze(["success", "skipped", "warning", "error"]);
  const AUTOMATION_TEMPLATES = Object.freeze([
    Object.freeze({ id: "event-reminder", title: "Напомнить перед событием", needs: "Выберите событие и время напоминания.", draft: Object.freeze({ name: "Напомнить перед событием", type: "event_relative", offsetMinutes: -15, actions: [{ type: "notify", title: "Скоро: {event.title}", text: "{event.date}" }] }) }),
    Object.freeze({ id: "move-new-pdf", title: "Перемещать новые PDF", needs: "Выберите исходную и конечную папки.", draft: Object.freeze({ name: "Перемещать новые PDF", type: "file_added", conditions: [{ type: "file_extension", value: "pdf" }], actions: [{ type: "move_file", collisionPolicy: "rename" }] }) }),
    Object.freeze({ id: "weekly-plan", title: "Еженедельный план", needs: "Проверьте день, время и папку заметки.", draft: Object.freeze({ name: "Еженедельный план", type: "weekly", weekday: 1, time: "09:00", actions: [{ type: "create_note", name: "План на неделю", content: "План на неделю от {automation.name}" }] }) }),
    Object.freeze({ id: "note-after-event", title: "Заметка после события", needs: "Выберите событие и папку заметки.", draft: Object.freeze({ name: "Заметка после события", type: "event_relative", offsetMinutes: 0, actions: [{ type: "create_note", name: "Итоги: {event.title}", content: "Дата события: {event.date}" }] }) }),
    Object.freeze({ id: "new-file-notification", title: "Сообщать о новом файле", needs: "При необходимости выберите папку.", draft: Object.freeze({ name: "Сообщать о новом файле", type: "file_added", actions: [{ type: "notify", title: "Новый файл", text: "{file.name} добавлен в ZeTer OS" }] }) })
  ]);
  const TYPE_SET = new Set(AUTOMATION_TYPES);
  const CONDITION_SET = new Set(AUTOMATION_CONDITIONS);
  const ACTION_SET = new Set(AUTOMATION_ACTION_TYPES);
  const HISTORY_STATUS_SET = new Set(AUTOMATION_HISTORY_STATUSES);
  const COLLISION_SET = new Set(["skip", "rename", "replace"]);
  const ERROR_POLICY_SET = new Set(["stop", "continue"]);
  const CONDITION_MODE_SET = new Set(["all", "any"]);
  const COMPARISON_SET = new Set(["eq", "ne", "contains", "gt", "gte", "lt", "lte", "before", "after"]);
  const VARIABLE_KEYS = new Set(["file.name", "file.folder", "event.title", "event.date", "task.title", "note.name", "automation.name"]);

  function boundedString(value, max, fallback = "") {
    const raw = typeof value === "string" ? value.trim() : "";
    return (raw || fallback).slice(0, max);
  }

  function textValue(value, max = AUTOMATION_TEXT_MAX_CHARS) {
    return typeof value === "string" ? value.slice(0, max) : "";
  }

  function safeId(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    return SAFE_ID_RE.test(raw) ? raw : "";
  }

  function boundedInteger(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }

  function boundedNumber(value, min, max, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function normalizeClockTime(value, fallback = "09:00") {
    const raw = String(value || "").trim();
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (!match) return fallback;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function normalizeActionRef(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const mode = ["trigger", "selected", "previous_note"].includes(source.mode) ? source.mode : "trigger";
    const result = { mode };
    if (mode === "selected") {
      result.kind = ["fs", "event", "task"].includes(source.kind) ? source.kind : "fs";
      result.id = safeId(source.id);
    }
    return result;
  }

  function normalizeAutomationAction(value, fallbackSource = {}, options = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {
        ...(fallbackSource?.actionData && typeof fallbackSource.actionData === "object" ? fallbackSource.actionData : {}),
        type: typeof value === "string" ? value : fallbackSource?.actionType
      };
    const type = ACTION_SET.has(source.type) ? source.type : "notify";
    const index = Math.max(0, Math.floor(Number(options.index) || 0));
    const ownerId = safeId(options.ownerId) || "automation";
    const common = {
      id: safeId(source.id) || `${ownerId}_action_${index + 1}`.slice(0, 220),
      type,
      onError: ERROR_POLICY_SET.has(source.onError) ? source.onError : "stop"
    };

    if (type === "create_note") {
      return {
        ...common,
        name: boundedString(source.name, 300, "Новая заметка"),
        content: textValue(source.content, 2 * 1024 * 1024),
        parentId: safeId(source.parentId)
      };
    }
    if (type === "move_file") {
      const collisionPolicy = COLLISION_SET.has(source.collisionPolicy) ? source.collisionPolicy : "skip";
      return {
        ...common,
        targetFolderId: safeId(source.targetFolderId),
        collisionPolicy,
        replaceAcknowledged: collisionPolicy === "replace" && source.replaceAcknowledged === true
      };
    }
    if (type === "link_objects") {
      return {
        ...common,
        left: normalizeActionRef(source.left),
        right: normalizeActionRef(source.right?.mode ? source.right : { mode: "selected", kind: source.targetKind, id: source.targetId }),
        label: boundedString(source.label, 160)
      };
    }
    return {
      ...common,
      type: "notify",
      title: boundedString(source.title, AUTOMATION_NAME_MAX_CHARS, "Автоматизация ZeTer OS"),
      text: textValue(source.text, AUTOMATION_TEXT_MAX_CHARS)
    };
  }

  function normalizeAutomationCondition(value, index = 0, ownerId = "automation") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const type = CONDITION_SET.has(value.type) ? value.type : "";
    if (!type) return null;
    const result = {
      id: safeId(value.id) || `${safeId(ownerId) || "automation"}_condition_${index + 1}`.slice(0, 220),
      type,
      operator: COMPARISON_SET.has(value.operator) ? value.operator : "eq",
      value: textValue(value.value, 500)
    };
    if (type === "file_size") result.number = boundedNumber(value.number ?? value.value, 0, Number.MAX_SAFE_INTEGER, 0);
    if (["file_source_folder", "task_project"].includes(type)) result.value = safeId(value.value || value.folderId || value.projectId);
    if (type === "task_status") result.value = ["todo", "doing", "review", "done"].includes(value.value) ? value.value : "done";
    if (type === "object_exists") {
      result.mode = ["trigger", "selected"].includes(value.mode) ? value.mode : "trigger";
      result.kind = ["fs", "event", "task"].includes(value.kind) ? value.kind : "fs";
      result.value = result.mode === "selected" ? safeId(value.value || value.id) : "";
    }
    return result;
  }

  function uniqueOwnedId(preferred, fallback, usedIds) {
    let candidate = safeId(preferred) || fallback;
    if (!usedIds.has(candidate)) return candidate;
    let suffix = 2;
    const base = candidate.slice(0, 205) || fallback.slice(0, 205);
    while (usedIds.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }

  function cloneValue(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeAutomationCategories(value) {
    const used = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 200).flatMap(entry => {
      const id = safeId(entry?.id);
      const name = boundedString(entry?.name, 160);
      if (!id || !name || used.has(id)) return [];
      used.add(id);
      return [{ id, name }];
    });
  }

  function automationCategoryScope(workspace = {}, categoryId = "*") {
    const categories = normalizeAutomationCategories(workspace.automationCategories);
    const validIds = new Set(categories.map(item => item.id));
    const effectiveId = id => validIds.has(id) ? id : "";
    const automations = normalizeAutomations(workspace.automations);
    const byId = new Map(automations.map(item => [item.id, item]));
    const runtime = normalizeAutomationRuntime(workspace.automationRuntime);
    return {
      automations: automations.filter(item => categoryId === "*" || effectiveId(item.categoryId) === categoryId),
      history: runtime.history.filter(entry => categoryId === "*" || effectiveId(byId.has(entry.automationId) ? byId.get(entry.automationId).categoryId : entry.categoryId) === categoryId)
    };
  }

  function changeAutomationCategory(workspace, change = {}) {
    const categories = normalizeAutomationCategories(workspace.automationCategories);
    const id = safeId(change.id);
    const current = categories.find(item => item.id === id);
    if (!["create", "rename", "delete"].includes(change.type)) throw new Error("Неизвестное действие с категорией.");
    if (change.type !== "create" && !current) throw new Error("Категория уже удалена. Обнови список.");
    if (change.type === "create" && (!id || current || categories.length >= 200)) throw new Error("Не удалось создать категорию: проверь ID и лимит 200 категорий.");
    if (change.type !== "delete") {
      const name = String(change.name || "").trim();
      if (!name || name.length > 160) throw new Error("Название категории должно содержать от 1 до 160 символов.");
      if (categories.some(item => item.id !== id && item.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) throw new Error("Категория с таким названием уже существует.");
      workspace.automationCategories = change.type === "create" ? [...categories, { id, name }] : categories.map(item => item.id === id ? { id, name } : item);
      return id;
    }
    const rules = normalizeAutomations(workspace.automations);
    const removed = new Set(change.deleteAutomations === true ? rules.filter(item => item.categoryId === id).map(item => item.id) : []);
    workspace.automations = rules.filter(item => !removed.has(item.id)).map(item => item.categoryId === id ? { ...item, categoryId: "" } : item);
    workspace.automationCategories = categories.filter(item => item.id !== id);
    const runtime = normalizeAutomationRuntime(workspace.automationRuntime);
    const removedQueueIds = new Set(runtime.queue.filter(item => removed.has(item.automationId)).map(item => item.id));
    runtime.queue = runtime.queue.filter(item => !removed.has(item.automationId));
    runtime.checkpoints = runtime.checkpoints.filter(item => !removedQueueIds.has(item.queueId));
    workspace.automationRuntime = runtime;
    return id;
  }

  function normalizeAutomation(value, index = 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fallbackIndex = Math.max(0, Math.floor(Number(index) || 0)) + 1;
    const type = TYPE_SET.has(value.type) ? value.type : "weekly";
    const id = safeId(value.id) || `automation_${fallbackIndex}`;
    const conditionSource = Array.isArray(value.conditions) ? value.conditions.slice(0, AUTOMATION_MAX_CONDITIONS) : [];
    const conditions = conditionSource
      .map((entry, conditionIndex) => normalizeAutomationCondition(entry, conditionIndex, id))
      .filter(Boolean);
    const actionSource = Array.isArray(value.actions) && value.actions.length
      ? value.actions.slice(0, AUTOMATION_MAX_ACTIONS)
      : [value.action || value.actionType || { type: "notify" }];
    const usedActionIds = new Set();
    const actions = actionSource.map((entry, actionIndex) => {
      const action = normalizeAutomationAction(entry, value, { ownerId: id, index: actionIndex });
      action.id = uniqueOwnedId(action.id, `${id}_action_${actionIndex + 1}`.slice(0, 220), usedActionIds);
      usedActionIds.add(action.id);
      return action;
    });
    const result = {
      id,
      name: boundedString(value.name, AUTOMATION_NAME_MAX_CHARS, `Автоматизация ${fallbackIndex}`),
      categoryId: safeId(value.categoryId),
      enabled: value.enabled !== false,
      type,
      condition: "always",
      conditionMode: CONDITION_MODE_SET.has(value.conditionMode) ? value.conditionMode : "all",
      conditions,
      action: cloneValue(actions[0]),
      actions,
      lastRunKey: boundedString(value.lastRunKey, AUTOMATION_RUN_KEY_MAX_CHARS),
      pausedReason: boundedString(value.pausedReason, 160),
      lastError: textValue(value.lastError, 500)
    };

    if (["weekly", "daily", "monthly"].includes(type)) result.time = normalizeClockTime(value.time, "09:00");
    if (type === "weekly") result.weekday = boundedInteger(value.weekday, 0, 6, 1);
    if (type === "monthly") result.monthday = boundedInteger(value.monthday, 1, 31, 1);
    if (type === "event_before") {
      result.eventId = safeId(value.eventId);
      result.minutesBefore = boundedInteger(value.minutesBefore, 0, 7 * 24 * 60, 15);
    }
    if (type === "event_relative") {
      result.eventId = safeId(value.eventId);
      result.offsetMinutes = boundedInteger(value.offsetMinutes, -7 * 24 * 60, 7 * 24 * 60, 0);
    }
    if (type === "file_added") result.folderId = safeId(value.folderId);
    if (["task_completed", "task_overdue"].includes(type)) result.projectId = safeId(value.projectId);
    if (["note_created", "note_changed"].includes(type)) result.noteFolderId = safeId(value.noteFolderId);
    return result;
  }

  function uniqueAutomationId(preferred, index, usedIds) {
    let candidate = safeId(preferred) || `automation_${index + 1}`;
    if (!usedIds.has(candidate)) return candidate;
    let suffix = 2;
    const base = candidate.slice(0, 205) || `automation_${index + 1}`;
    while (usedIds.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }

  function normalizeAutomations(value, options = {}) {
    const max = Number.isFinite(Number(options.maxItems))
      ? Math.max(0, Math.min(AUTOMATION_MAX_ITEMS, Math.floor(Number(options.maxItems))))
      : AUTOMATION_MAX_ITEMS;
    const source = Array.isArray(value) ? value.slice(0, max) : [];
    const usedIds = new Set();
    const result = [];
    source.forEach((entry, index) => {
      const normalized = normalizeAutomation(entry, index);
      if (!normalized) return;
      normalized.id = uniqueAutomationId(normalized.id, index, usedIds);
      usedIds.add(normalized.id);
      result.push(normalized);
    });
    return result;
  }

  function normalizeActionResult(value, index = 0) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const status = ["success", "skipped", "warning", "error"].includes(source.status) ? source.status : "error";
    return {
      actionId: safeId(source.actionId) || `action_${index + 1}`,
      actionType: ACTION_SET.has(source.actionType) ? source.actionType : "notify",
      status,
      message: textValue(source.message, 500),
      objectKind: ["fs", "event", "task"].includes(source.objectKind) ? source.objectKind : "",
      objectId: safeId(source.objectId)
    };
  }

  function normalizeHistoryEntry(value, index = 0) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const status = HISTORY_STATUS_SET.has(source.status) ? source.status : "error";
    return {
      id: safeId(source.id) || `automation_history_${index + 1}`,
      automationId: safeId(source.automationId),
      automationName: boundedString(source.automationName, AUTOMATION_NAME_MAX_CHARS),
      categoryId: safeId(source.categoryId),
      runKey: boundedString(source.runKey, AUTOMATION_RUN_KEY_MAX_CHARS),
      status,
      message: textValue(source.message, 500),
      triggerKind: ["fs", "event", "task", "system"].includes(source.triggerKind) ? source.triggerKind : "system",
      triggerId: safeId(source.triggerId),
      createdAt: Math.max(0, Math.floor(Number(source.createdAt) || 0)),
      actionResults: (Array.isArray(source.actionResults) ? source.actionResults : [])
        .slice(0, AUTOMATION_ACTION_RESULT_MAX_ITEMS)
        .map(normalizeActionResult)
    };
  }

  function normalizeQueueEntry(value, index = 0) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const automationId = safeId(source.automationId);
    const runKey = boundedString(source.runKey, AUTOMATION_RUN_KEY_MAX_CHARS);
    if (!automationId || !runKey) return null;
    const triggerType = TYPE_SET.has(source.triggerType) ? source.triggerType : "startup";
    return {
      id: safeId(source.id) || `automation_queue_${index + 1}`,
      automationId,
      runKey,
      triggerType,
      triggerKind: ["fs", "event", "task", "system"].includes(source.triggerKind) ? source.triggerKind : "system",
      triggerId: safeId(source.triggerId),
      eventDate: textValue(source.eventDate, 10),
      scheduledAt: Math.max(0, Math.floor(Number(source.scheduledAt) || 0)),
      createdAt: Math.max(0, Math.floor(Number(source.createdAt) || 0)),
      attempts: boundedInteger(source.attempts, 0, AUTOMATION_RETRY_MAX_ATTEMPTS, 0),
      status: ["pending", "retry"].includes(source.status) ? source.status : "pending",
      originAutomationId: safeId(source.originAutomationId),
      chainId: safeId(source.chainId),
      chainDepth: boundedInteger(source.chainDepth, 0, AUTOMATION_CHAIN_MAX_DEPTH + 1, 0),
      chainAutomationIds: (Array.isArray(source.chainAutomationIds) ? source.chainAutomationIds : [])
        .map(safeId).filter(Boolean).slice(0, AUTOMATION_CHAIN_MAX_DEPTH + 1)
    };
  }

  function normalizeCheckpoint(value, index = 0) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const queueId = safeId(source.queueId);
    if (!queueId) return null;
    return {
      id: safeId(source.id) || `automation_checkpoint_${index + 1}`,
      queueId,
      automationId: safeId(source.automationId),
      runKey: boundedString(source.runKey, AUTOMATION_RUN_KEY_MAX_CHARS),
      completedActionIds: (Array.isArray(source.completedActionIds) ? source.completedActionIds : [])
        .map(safeId).filter(Boolean).slice(0, AUTOMATION_MAX_ACTIONS),
      actionResults: (Array.isArray(source.actionResults) ? source.actionResults : [])
        .slice(0, AUTOMATION_ACTION_RESULT_MAX_ITEMS).map(normalizeActionResult),
      updatedAt: Math.max(0, Math.floor(Number(source.updatedAt) || 0))
    };
  }

  function normalizeAutomationRuntime(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const queueMap = new Map();
    (Array.isArray(source.queue) ? source.queue : [])
      .slice(-AUTOMATION_QUEUE_MAX_ITEMS).map(normalizeQueueEntry).filter(Boolean)
      .forEach(entry => queueMap.set(`${entry.automationId}::${entry.runKey}`, entry));
    const queue = [...queueMap.values()].slice(-AUTOMATION_QUEUE_MAX_ITEMS);
    const history = (Array.isArray(source.history) ? source.history : [])
      .slice(-AUTOMATION_HISTORY_MAX_ITEMS).map(normalizeHistoryEntry);
    const checkpointMap = new Map();
    (Array.isArray(source.checkpoints) ? source.checkpoints : [])
      .slice(-AUTOMATION_CHECKPOINT_MAX_ITEMS).map(normalizeCheckpoint).filter(Boolean)
      .forEach(entry => checkpointMap.set(entry.queueId, entry));
    const checkpoints = [...checkpointMap.values()].slice(-AUTOMATION_CHECKPOINT_MAX_ITEMS);
    const rateLog = (Array.isArray(source.rateLog) ? source.rateLog : []).slice(-AUTOMATION_RATE_GLOBAL).map(entry => ({
      automationId: safeId(entry?.automationId),
      at: Math.max(0, Math.floor(Number(entry?.at) || 0))
    })).filter(entry => entry.automationId && entry.at);
    const normalized = {
      paused: source.paused === true,
      baselineSeeded: source.baselineSeeded === true,
      knownFileIds: [...new Set((Array.isArray(source.knownFileIds) ? source.knownFileIds : [])
        .map(safeId).filter(Boolean))].slice(-AUTOMATION_KNOWN_FILE_MAX_ITEMS),
      queue,
      history,
      checkpoints,
      rateLog
    };
    Object.assign(source, normalized);
    return source;
  }

  function automationTemplateDraft(templateId, id = "") {
    const template = AUTOMATION_TEMPLATES.find(entry => entry.id === templateId);
    if (!template) return null;
    return normalizeAutomation({ id: safeId(id) || `automation_${Date.now()}`, ...cloneValue(template.draft), enabled: false });
  }

  function readPath(source, path) {
    return String(path || "").split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, source);
  }

  function automationVariableValues(automation, context = {}) {
    const file = context.file || {};
    const event = context.event || {};
    const task = context.task || {};
    const note = context.note || {};
    return {
      "file.name": file.name,
      "file.folder": context.fileFolderName || file.folderName || file.parentName,
      "event.title": event.title,
      "event.date": context.eventDate || event.date,
      "task.title": task.title,
      "note.name": note.name,
      "automation.name": automation?.name
    };
  }

  function renderAutomationText(value, automation, context = {}) {
    const values = automationVariableValues(automation, context);
    const unknownVariables = [];
    const text = textValue(value, 2 * 1024 * 1024).replace(/\{([a-z]+\.[a-z]+)\}/gi, (match, key) => {
      if (!VARIABLE_KEYS.has(key) || values[key] == null || values[key] === "") {
        if (!unknownVariables.includes(key)) unknownVariables.push(key);
        return match;
      }
      return String(values[key]);
    });
    return { text, unknownVariables };
  }

  function comparable(value) {
    return typeof value === "string" ? value.trim().toLocaleLowerCase("ru-RU") : value;
  }

  function comparableFileExtension(value) {
    return String(value ?? "").trim().replace(/^\.+/, "").toLocaleLowerCase("ru-RU");
  }

  function compareValues(actual, expected, operator) {
    if (["gt", "gte", "lt", "lte"].includes(operator)) {
      const left = Number(actual);
      const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (operator === "gt") return left > right;
      if (operator === "gte") return left >= right;
      if (operator === "lt") return left < right;
      return left <= right;
    }
    if (["before", "after"].includes(operator)) {
      const left = new Date(actual).getTime();
      const right = new Date(expected).getTime();
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return operator === "before" ? left < right : left > right;
    }
    const left = comparable(actual);
    const right = comparable(expected);
    if (operator === "contains") return String(left ?? "").includes(String(right ?? ""));
    if (operator === "ne") return left !== right;
    return left === right;
  }

  function endpointExists(kind, id, state = {}, workspace = {}) {
    if (!safeId(id)) return false;
    if (kind === "fs") return Boolean(state?.fs?.[id]);
    if (kind === "event") return (Array.isArray(workspace?.events) ? workspace.events : []).some(entry => entry?.id === id);
    if (kind === "task") {
      if ((Array.isArray(workspace?.tasks) ? workspace.tasks : []).some(entry => entry?.id === id)) return true;
      return Object.values(state?.fs || {}).some(item => (
        item?.type === "tasklist" && (Array.isArray(item.tasks) ? item.tasks : []).some(entry => entry?.id === id)
      ));
    }
    return false;
  }

  function conditionActualValue(condition, context = {}) {
    const file = context.file || {};
    const event = context.event || {};
    const task = context.task || {};
    const note = context.note || {};
    const type = condition.type;
    if (type === "file_name_contains") return file.name || "";
    if (type === "file_extension") return file.extension || String(file.name || "").split(".").pop() || "";
    if (type === "file_size") return file.size ?? file.managedFile?.size ?? 0;
    if (type === "file_source_folder") return file.parent || "";
    if (type === "event_title_contains") return event.title || "";
    if (type === "event_category") return event.category || "";
    if (type === "event_datetime") return `${event.date || ""}T${event.start || "00:00"}`;
    if (type === "task_title_contains") return task.title || "";
    if (type === "task_project") return task.projectId || "";
    if (type === "task_status") return task.status || "";
    if (type === "note_name_contains") return note.name || "";
    if (type === "note_content_contains") return note.content || "";
    if (type === "object_exists") {
      if (condition.mode === "trigger") return Boolean(context.file || context.event || context.task || context.note);
      return endpointExists(condition.kind, condition.value, context.state, context.workspace);
    }
    return undefined;
  }

  function evaluateAutomationConditions(value, context = {}) {
    const automation = normalizeAutomation(value);
    if (!automation) return { passed: false, mode: "all", results: [] };
    const results = automation.conditions.map(condition => {
      const actual = conditionActualValue(condition, context);
      const expected = condition.type === "file_size" ? condition.number : condition.value;
      const operator = ["file_name_contains", "event_title_contains", "task_title_contains", "note_name_contains", "note_content_contains"].includes(condition.type)
        ? "contains"
        : condition.operator;
      const passed = condition.type === "object_exists"
        ? Boolean(actual)
        : condition.type === "file_extension"
          ? compareValues(comparableFileExtension(actual), comparableFileExtension(expected), operator)
          : compareValues(actual, expected, operator);
      return { id: condition.id, type: condition.type, operator, actual, expected, passed };
    });
    const passed = !results.length || (automation.conditionMode === "any" ? results.some(result => result.passed) : results.every(result => result.passed));
    return { passed, mode: automation.conditionMode, results };
  }

  function findBrokenAutomationReferences(value, state = {}, workspace = {}, context = {}) {
    const automation = normalizeAutomation(value);
    if (!automation) return ["Некорректное правило"];
    const broken = [];
    const requireFs = (id, label) => {
      const desktopRoot = id === "desktop" || (Array.isArray(state?.desktops) && state.desktops.some(entry => entry?.id === id));
      if (id && !desktopRoot && !state?.fs?.[id]) broken.push(`${label}: ${id}`);
    };
    if (["event_before", "event_relative"].includes(automation.type)) {
      if (!automation.eventId) broken.push("Не выбрано событие");
      else if (!endpointExists("event", automation.eventId, state, workspace)) broken.push(`Событие не найдено: ${automation.eventId}`);
    }
    if (automation.type === "file_added") requireFs(automation.folderId, "Исходная папка не найдена");
    automation.conditions.forEach(condition => {
      if (["file_source_folder", "task_project"].includes(condition.type) && condition.value) {
        if (condition.type === "file_source_folder") requireFs(condition.value, "Папка условия не найдена");
      }
      if (condition.type === "object_exists" && condition.mode === "selected" && !endpointExists(condition.kind, condition.value, state, workspace)) {
        broken.push(`Объект условия не найден: ${condition.value}`);
      }
    });
    automation.actions.forEach(action => {
      if (action.type === "create_note") requireFs(action.parentId, "Папка заметки не найдена");
      if (action.type === "move_file") {
        if (!action.targetFolderId) broken.push("Не выбрана целевая папка");
        else requireFs(action.targetFolderId, "Целевая папка не найдена");
      }
      if (action.type === "link_objects") [action.left, action.right].forEach(ref => {
        if (ref?.mode === "selected" && !endpointExists(ref.kind, ref.id, state, workspace)) broken.push(`Связанный объект не найден: ${ref.id}`);
      });
    });
    return [...new Set(broken)];
  }

  function actionPreview(action, automation, context = {}) {
    const rendered = [];
    ["title", "text", "name", "content"].forEach(field => {
      if (typeof action[field] !== "string") return;
      const result = renderAutomationText(action[field], automation, context);
      rendered.push({ field, text: result.text, unknownVariables: result.unknownVariables });
    });
    const warnings = rendered.flatMap(entry => entry.unknownVariables.map(key => `Переменная {${key}} недоступна`));
    if (action.type === "move_file" && action.collisionPolicy === "replace" && !action.replaceAcknowledged) {
      warnings.push("Замена файла требует подтверждения");
    }
    return { id: action.id, type: action.type, onError: action.onError, rendered, warnings };
  }

  function previewAutomation(value, context = {}) {
    const automation = normalizeAutomation(cloneValue(value));
    if (!automation) return { valid: false, safe: false, verdict: "Нужно исправить", warnings: ["Некорректное правило"], conditions: { passed: false, results: [] }, actions: [] };
    const state = context.state || {};
    const workspace = context.workspace || {};
    const resolvedContext = { ...context, state, workspace };
    if (!resolvedContext.event && automation.eventId) {
      resolvedContext.event = (workspace.events || []).find(entry => entry?.id === automation.eventId) || null;
    }
    const brokenReferences = findBrokenAutomationReferences(automation, state, workspace, resolvedContext);
    const missingSample = automation.type === "file_added" && !resolvedContext.file;
    if (["task_completed", "task_overdue"].includes(automation.type) && !resolvedContext.task) brokenReferences.push("Не выбрана задача для проверки");
    if (["note_created", "note_changed"].includes(automation.type) && !resolvedContext.note) brokenReferences.push("Не выбрана заметка для проверки");
    if (automation.type === "event_created" && !resolvedContext.event) brokenReferences.push("Не выбрано событие для проверки");
    const conditions = evaluateAutomationConditions(automation, resolvedContext);
    const actions = automation.actions.map(action => actionPreview(action, automation, resolvedContext));
    const warnings = [...brokenReferences, ...(missingSample ? ["Выбери файл в списке «Файл для проверки». Если список пуст, открой папку и добавь файл в ZeTer OS."] : []), ...actions.flatMap(action => action.warnings)];
    const dangerous = automation.actions.some(action => action.type === "move_file" && action.collisionPolicy === "replace" && !action.replaceAcknowledged);
    const valid = automation.actions.length > 0 && !brokenReferences.length && !dangerous && !missingSample;
    const safe = valid && conditions.passed;
    return {
      valid,
      safe,
      missingSample,
      verdict: missingSample && !brokenReferences.length && !dangerous ? "Нужен файл для проверки" : !valid ? (dangerous ? "Опасное действие" : "Нужно исправить") : (conditions.passed ? "Готово" : "Условие не выполнено"),
      automation,
      conditions,
      actions,
      warnings,
      brokenReferences,
      sample: {
        kind: resolvedContext.file ? "fs" : resolvedContext.event ? "event" : resolvedContext.task ? "task" : resolvedContext.note ? "fs" : "system",
        id: missingSample ? "" : safeId(resolvedContext.file?.id || resolvedContext.event?.id || resolvedContext.task?.id || resolvedContext.note?.id),
        name: missingSample ? "" : (resolvedContext.file?.name || resolvedContext.event?.title || resolvedContext.task?.title || resolvedContext.note?.name || ""),
        folder: resolvedContext.file ? resolvedContext.fileFolderName || "" : ""
      }
    };
  }

  function asDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now());
    return Number.isFinite(date.getTime()) ? date : new Date(0);
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
    return localDateKey(date) === value ? date : null;
  }

  function dateWithTime(day, time) {
    const [hours, minutes] = normalizeClockTime(time, "00:00").split(":").map(Number);
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
  }

  function eventOccursOnDate(event, day) {
    const base = parseLocalDate(event?.date);
    if (!base || day.getTime() < base.getTime()) return false;
    const repeat = String(event?.repeat || "none");
    if (repeat === "daily") return true;
    if (repeat === "weekly") return day.getDay() === base.getDay();
    if (repeat === "monthly") return day.getDate() === base.getDate();
    return localDateKey(day) === localDateKey(base);
  }

  function weeklyDueRun(automation, now) {
    if (now.getDay() !== automation.weekday) return null;
    const scheduledAt = dateWithTime(now, automation.time);
    if (now.getTime() < scheduledAt.getTime()) return null;
    return Object.freeze({
      runKey: `weekly:${localDateKey(now)}:${automation.time}`,
      type: "weekly",
      scheduledAt: scheduledAt.getTime()
    });
  }

  function dailyDueRun(automation, now) {
    const scheduledAt = dateWithTime(now, automation.time);
    if (now.getTime() < scheduledAt.getTime()) return null;
    return Object.freeze({
      runKey: `daily:${localDateKey(now)}:${automation.time}`,
      type: "daily",
      scheduledAt: scheduledAt.getTime()
    });
  }

  function monthlyDueRun(automation, now) {
    if (now.getDate() !== automation.monthday) return null;
    const scheduledAt = dateWithTime(now, automation.time);
    if (now.getTime() < scheduledAt.getTime()) return null;
    return Object.freeze({
      runKey: `monthly:${localDateKey(now)}:${automation.time}`,
      type: "monthly",
      scheduledAt: scheduledAt.getTime()
    });
  }

  function eventBeforeDueRun(automation, now, events) {
    const event = (Array.isArray(events) ? events : []).find(item => item?.id === automation.eventId);
    if (!event) return null;
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const searchDays = Math.min(8, Math.ceil(automation.minutesBefore / (24 * 60)) + 1);
    for (let offset = 0; offset <= searchDays; offset += 1) {
      const day = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate() + offset, 0, 0, 0, 0);
      if (!eventOccursOnDate(event, day)) continue;
      const eventAt = dateWithTime(day, event.start || "00:00");
      const dueAt = eventAt.getTime() - automation.minutesBefore * 60 * 1000;
      if (now.getTime() < dueAt || now.getTime() > eventAt.getTime()) continue;
      return Object.freeze({
        runKey: `event_before:${event.id}:${localDateKey(day)}:${normalizeClockTime(event.start || "00:00", "00:00")}:${automation.minutesBefore}`.slice(0, AUTOMATION_RUN_KEY_MAX_CHARS),
        type: "event_before",
        eventId: event.id,
        eventDate: localDateKey(day),
        scheduledAt: dueAt
      });
    }
    return null;
  }

  function eventRelativeDueRun(automation, now, events) {
    const event = (Array.isArray(events) ? events : []).find(item => item?.id === automation.eventId);
    if (!event) return null;
    const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const searchDays = Math.min(8, Math.ceil(Math.abs(automation.offsetMinutes) / (24 * 60)) + 1);
    for (let offset = -1; offset <= searchDays; offset += 1) {
      const day = new Date(nowDay.getFullYear(), nowDay.getMonth(), nowDay.getDate() + offset, 0, 0, 0, 0);
      if (!eventOccursOnDate(event, day)) continue;
      const eventAt = dateWithTime(day, event.start || "00:00");
      const dueAt = eventAt.getTime() + automation.offsetMinutes * 60 * 1000;
      if (now.getTime() < dueAt) continue;
      if (now.getTime() > dueAt + 24 * 60 * 60 * 1000) continue;
      return Object.freeze({
        runKey: `event_relative:${event.id}:${localDateKey(day)}:${automation.offsetMinutes}`.slice(0, AUTOMATION_RUN_KEY_MAX_CHARS),
        type: "event_relative",
        eventId: event.id,
        eventDate: localDateKey(day),
        scheduledAt: dueAt
      });
    }
    return null;
  }

  function fileAddedDueRun(automation, context = {}) {
    const fileId = safeId(context.addedFileId || context.file?.id);
    if (!fileId) return null;
    const item = context.file || context.state?.fs?.[fileId];
    if (!item) return null;
    if (automation.folderId && item.parent !== automation.folderId) return null;
    return Object.freeze({
      runKey: `file_added:${fileId}`,
      type: "file_added",
      fileId
    });
  }

  function eventContextDueRun(automation, context = {}) {
    if (context.triggerType !== automation.type) return null;
    const trigger = context.task || context.note || context.event || context.file || {};
    const triggerId = safeId(context.triggerId || trigger.id);
    if (!triggerId) return null;
    if (automation.projectId && context.task?.projectId !== automation.projectId) return null;
    if (automation.noteFolderId && context.note?.parent !== automation.noteFolderId) return null;
    const run = {
      runKey: `${automation.type}:${triggerId}:${String(context.eventKey || context.updatedAt || context.at || Date.now()).slice(0, 80)}`.slice(0, AUTOMATION_RUN_KEY_MAX_CHARS),
      type: automation.type,
      triggerId,
      scheduledAt: Math.max(0, Math.floor(Number(context.at) || Date.now()))
    };
    if (automation.type === "event_created") run.eventId = triggerId;
    return Object.freeze(run);
  }

  function dueRunForAutomation(value, context = {}) {
    const automation = normalizeAutomation(value);
    if (!automation || !automation.enabled || automation.pausedReason) return null;
    const now = asDate(context.now);
    if (automation.type === "weekly") return weeklyDueRun(automation, now);
    if (automation.type === "daily") return dailyDueRun(automation, now);
    if (automation.type === "monthly") return monthlyDueRun(automation, now);
    if (automation.type === "event_before") {
      return eventBeforeDueRun(automation, now, context.events || context.workspace?.events);
    }
    if (automation.type === "event_relative") {
      return eventRelativeDueRun(automation, now, context.events || context.workspace?.events);
    }
    if (automation.type === "file_added") return fileAddedDueRun(automation, context);
    if (automation.type === "startup") {
      const startupKey = boundedString(context.startupKey, 80);
      return startupKey ? Object.freeze({ runKey: `startup:${startupKey}`, type: "startup", scheduledAt: now.getTime() }) : null;
    }
    return eventContextDueRun(automation, context);
  }

  function pendingRunForAutomation(value, context = {}) {
    const candidate = dueRunForAutomation(value, context);
    if (!candidate) return null;
    return String(value?.lastRunKey || "") === candidate.runKey ? null : candidate;
  }

  function markAutomationRun(automation, run) {
    if (!automation || typeof automation !== "object" || !run?.runKey) return false;
    automation.lastRunKey = boundedString(run.runKey, AUTOMATION_RUN_KEY_MAX_CHARS);
    return Boolean(automation.lastRunKey);
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function resolveActionRef(ref, context = {}, previousNote = null) {
    if (ref?.mode === "previous_note") return previousNote;
    if (ref?.mode === "selected") return ref.id ? { kind: ref.kind, id: ref.id } : null;
    if (context.file?.id) return { kind: "fs", id: context.file.id };
    if (context.note?.id) return { kind: "fs", id: context.note.id };
    if (context.event?.id) return { kind: "event", id: context.event.id };
    if (context.task?.id) return { kind: "task", id: context.task.id };
    return null;
  }

  function callbackObjectResult(result) {
    if (!result || typeof result !== "object") return { objectKind: "", objectId: "" };
    return {
      objectKind: ["fs", "event", "task"].includes(result.kind || result.objectKind) ? (result.kind || result.objectKind) : "",
      objectId: safeId(result.id || result.objectId)
    };
  }

  async function executeOneAction(automation, action, run, context, options = {}, previousNote = null) {
    const meta = { automationId: automation.id, actionId: action.id, run, origin: context.origin || null };
    if (action.type === "notify") {
      if (typeof options.notify !== "function") throw new Error("Automation notify callback is required.");
      const title = renderAutomationText(action.title, automation, context).text;
      const text = renderAutomationText(action.text, automation, context).text;
      const result = await options.notify(title, text, meta);
      if (result === false) throw new Error(`Automation action rejected: ${automation.id}`);
      return { actionId: action.id, actionType: action.type, status: "success", message: "Уведомление создано", ...callbackObjectResult(result) };
    }
    if (action.type === "create_note") {
      if (typeof options.createNote !== "function") throw new Error("Automation createNote callback is required.");
      const result = await options.createNote({
        name: renderAutomationText(action.name, automation, context).text,
        content: renderAutomationText(action.content, automation, context).text,
        parentId: action.parentId
      }, meta);
      if (result === false) throw new Error(`Automation action rejected: ${automation.id}`);
      const object = callbackObjectResult(result);
      return { actionId: action.id, actionType: action.type, status: "success", message: "Заметка создана", objectKind: object.objectKind || "fs", objectId: object.objectId };
    }
    if (action.type === "move_file") {
      if (typeof options.moveFile !== "function") throw new Error("Automation moveFile callback is required.");
      if (!action.targetFolderId) throw new Error("Automation move_file requires targetFolderId.");
      if (action.collisionPolicy === "replace" && !action.replaceAcknowledged) throw new Error("Замена файла не подтверждена.");
      const fileId = safeId(run?.fileId || context.file?.id || options.fileId || "");
      if (!fileId) throw new Error("Automation move_file requires a file ID.");
      const result = await options.moveFile(fileId, action.targetFolderId, { ...meta, collisionPolicy: action.collisionPolicy, replaceAcknowledged: action.replaceAcknowledged });
      if (result === false) throw new Error(`Automation action rejected: ${automation.id}`);
      const skipped = result && typeof result === "object" && result.status === "skipped";
      return { actionId: action.id, actionType: action.type, status: skipped ? "skipped" : "success", message: skipped ? "Файл пропущен из-за совпадения имени" : "Файл перемещён", objectKind: "fs", objectId: fileId };
    }
    if (typeof options.linkObjects !== "function") throw new Error("Automation linkObjects callback is required.");
    const left = resolveActionRef(action.left, context, previousNote);
    const right = resolveActionRef(action.right, context, previousNote);
    if (!left?.id || !right?.id) throw new Error("Для связи не выбран объект.");
    const result = await options.linkObjects(left, right, { ...meta, label: action.label });
    if (result === false) throw new Error(`Automation action rejected: ${automation.id}`);
    return { actionId: action.id, actionType: action.type, status: "success", message: "Объекты связаны", objectKind: right.kind, objectId: right.id };
  }

  async function executeAutomationAction(automation, run, options = {}) {
    const normalized = normalizeAutomation(automation);
    if (!normalized) throw new Error("Некорректная автоматизация.");
    const context = options.context || {};
    const result = await executeOneAction(normalized, normalized.actions[0], run, context, options);
    return result.status !== "error";
  }

  function createAutomationRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({});
    const getWorkspace = typeof options.getWorkspace === "function" ? options.getWorkspace : () => ({});
    const now = typeof options.now === "function" ? options.now : Date.now;
    const resolveFileFolderName = typeof options.resolveFileFolderName === "function"
      ? options.resolveFileFolderName
      : (file, state) => state?.fs?.[file?.parent]?.name || "";

    function current() {
      const state = getState() || {};
      const workspace = getWorkspace() || {};
      workspace.automations = normalizeAutomations(workspace.automations);
      workspace.automationRuntime = normalizeAutomationRuntime(workspace.automationRuntime);
      return { state, workspace, runtime: workspace.automationRuntime };
    }

    function queueKey(automationId, runKey) { return `${automationId}::${runKey}`; }

    function queueEntryFor(runtime, automationId, runKey) {
      return runtime.queue.find(entry => queueKey(entry.automationId, entry.runKey) === queueKey(automationId, runKey)) || null;
    }

    function enqueueRun(automation, run, context = {}) {
      const { runtime } = current();
      const existing = queueEntryFor(runtime, automation.id, run.runKey);
      if (existing || automation.lastRunKey === run.runKey) return existing;
      const rawKey = queueKey(automation.id, run.runKey);
      const entry = normalizeQueueEntry({
        id: `aq_${stableHash(rawKey)}`,
        automationId: automation.id,
        runKey: run.runKey,
        triggerType: run.type || automation.type,
        triggerKind: run.fileId ? "fs" : run.eventId ? "event" : run.triggerId && automation.type.startsWith("task_") ? "task" : "system",
        triggerId: run.fileId || run.eventId || run.triggerId || "",
        eventDate: run.eventDate || "",
        scheduledAt: run.scheduledAt || 0,
        createdAt: now(),
        originAutomationId: context.originAutomationId,
        chainId: context.chainId,
        chainDepth: context.chainDepth,
        chainAutomationIds: context.chainAutomationIds
      }, runtime.queue.length);
      runtime.queue.push(entry);
      runtime.queue = runtime.queue.slice(-AUTOMATION_QUEUE_MAX_ITEMS);
      return entry;
    }

    function syncFileBaseline(state, workspace, runtime) {
      const currentIds = Object.keys(state?.fs && typeof state.fs === "object" ? state.fs : {}).map(safeId).filter(Boolean);
      if (!runtime.baselineSeeded) {
        runtime.baselineSeeded = true;
        runtime.knownFileIds = currentIds.slice(-AUTOMATION_KNOWN_FILE_MAX_ITEMS);
        return [];
      }
      const known = new Set(runtime.knownFileIds);
      const added = currentIds.filter(id => !known.has(id));
      runtime.knownFileIds = currentIds.slice(-AUTOMATION_KNOWN_FILE_MAX_ITEMS);
      added.forEach(fileId => {
        const file = state.fs[fileId];
        workspace.automations.forEach(automation => {
          if (automation.type !== "file_added") return;
          const run = pendingRunForAutomation(automation, { now: now(), state, workspace, file, addedFileId: fileId });
          if (run) enqueueRun(automation, run);
        });
      });
      return added;
    }

    function collectDueRuns() {
      const { state, workspace, runtime } = current();
      syncFileBaseline(state, workspace, runtime);
      const at = now();
      workspace.automations.forEach(automation => {
        if (automation.type === "file_added" || !["weekly", "daily", "monthly", "event_before", "event_relative"].includes(automation.type)) return;
        const run = pendingRunForAutomation(automation, { now: at, state, workspace, events: workspace.events });
        if (run) enqueueRun(automation, run);
      });
      runtime.queue = runtime.queue.filter(entry => {
        const automation = workspace.automations.find(item => item.id === entry.automationId);
        if (!automation || automation.lastRunKey === entry.runKey) return false;
        if (entry.attempts >= AUTOMATION_RETRY_MAX_ATTEMPTS) {
          automation.pausedReason = "retry_limit";
          automation.lastError = "Превышено число повторных попыток";
          addHistory(runtime, automation, entry, "error", automation.lastError);
          runtime.checkpoints = runtime.checkpoints.filter(checkpoint => checkpoint.queueId !== entry.id);
          return false;
        }
        return true;
      });
      return runtime.queue.map(queueEntry => {
        const automation = workspace.automations.find(item => item.id === queueEntry.automationId);
        const run = {
          runKey: queueEntry.runKey,
          type: queueEntry.triggerType,
          fileId: queueEntry.triggerKind === "fs" ? queueEntry.triggerId : "",
          eventId: queueEntry.triggerKind === "event" ? queueEntry.triggerId : "",
          triggerId: queueEntry.triggerId,
          eventDate: queueEntry.eventDate,
          scheduledAt: queueEntry.scheduledAt
        };
        return { automation, run, queueEntry };
      }).filter(entry => entry.automation);
    }

    function eventContextFor(entry, state, workspace) {
      const context = { state, workspace, eventDate: entry.queueEntry?.eventDate || entry.run?.eventDate || "" };
      if (entry.run?.fileId) {
        context.file = state.fs?.[entry.run.fileId];
        context.fileFolderName = resolveFileFolderName(context.file, state, workspace);
      }
      if (entry.run?.eventId) context.event = (workspace.events || []).find(item => item?.id === entry.run.eventId);
      if (entry.automation.type.startsWith("task_")) {
        context.task = (workspace.tasks || []).find(item => item?.id === entry.run?.triggerId) || null;
        if (!context.task) {
          context.task = Object.values(state?.fs || {})
            .filter(item => item?.type === "tasklist")
            .flatMap(item => Array.isArray(item.tasks) ? item.tasks : [])
            .find(item => item?.id === entry.run?.triggerId) || null;
        }
      }
      if (entry.automation.type.startsWith("note_")) context.note = state.fs?.[entry.run?.triggerId];
      context.origin = {
        automationId: entry.queueEntry?.originAutomationId || "",
        chainId: entry.queueEntry?.chainId || "",
        depth: entry.queueEntry?.chainDepth || 0,
        automationIds: entry.queueEntry?.chainAutomationIds || []
      };
      return context;
    }

    function checkpointFor(runtime, queueEntry) {
      let checkpoint = runtime.checkpoints.find(entry => entry.queueId === queueEntry.id);
      if (!checkpoint) {
        checkpoint = normalizeCheckpoint({
          id: `ac_${stableHash(queueEntry.id)}`,
          queueId: queueEntry.id,
          automationId: queueEntry.automationId,
          runKey: queueEntry.runKey,
          completedActionIds: [],
          actionResults: [],
          updatedAt: now()
        }, runtime.checkpoints.length);
        runtime.checkpoints.push(checkpoint);
        runtime.checkpoints = runtime.checkpoints.slice(-AUTOMATION_CHECKPOINT_MAX_ITEMS);
      }
      return checkpoint;
    }

    function addHistory(runtime, automation, run, status, message, actionResults = []) {
      const entry = normalizeHistoryEntry({
        id: `ah_${stableHash(`${automation.id}:${run.runKey}:${now()}:${runtime.history.length}`)}`,
        automationId: automation.id,
        automationName: automation.name,
        categoryId: automation.categoryId,
        runKey: run.runKey,
        status,
        message,
        triggerKind: run.fileId ? "fs" : run.eventId ? "event" : run.triggerId && automation.type.startsWith("task_") ? "task" : "system",
        triggerId: run.fileId || run.eventId || run.triggerId || "",
        createdAt: now(),
        actionResults
      }, runtime.history.length);
      runtime.history.push(entry);
      runtime.history = runtime.history.slice(-AUTOMATION_HISTORY_MAX_ITEMS);
      return entry;
    }

    function markCompletedRun(entry) {
      markAutomationRun(entry.automation, entry.run);
      const { workspace } = current();
      const stored = workspace.automations.find(item => item.id === entry.automation.id);
      if (stored) {
        markAutomationRun(stored, entry.run);
        stored.lastError = "";
      }
    }

    function clearQueueEntry(runtime, queueEntry) {
      runtime.queue = runtime.queue.filter(entry => entry.id !== queueEntry.id);
      runtime.checkpoints = runtime.checkpoints.filter(entry => entry.queueId !== queueEntry.id);
    }

    function guardReason(automation, queueEntry, runtime) {
      const chainIds = queueEntry.chainAutomationIds || [];
      if (queueEntry.chainDepth > AUTOMATION_CHAIN_MAX_DEPTH || chainIds.includes(automation.id)) return "loop_guard";
      const cutoff = now() - AUTOMATION_RATE_WINDOW_MS;
      runtime.rateLog = runtime.rateLog.filter(entry => entry.at >= cutoff);
      const perRule = runtime.rateLog.filter(entry => entry.automationId === automation.id).length;
      if (perRule >= AUTOMATION_RATE_PER_RULE || runtime.rateLog.length >= AUTOMATION_RATE_GLOBAL) return "rate_limit";
      runtime.rateLog.push({ automationId: automation.id, at: now() });
      runtime.rateLog = runtime.rateLog.slice(-AUTOMATION_RATE_GLOBAL);
      return "";
    }

    async function executeEntry(entry, manual = false, manualContext = null) {
      const { state, workspace, runtime } = current();
      const automation = workspace.automations.find(item => item.id === entry.automation.id) || entry.automation;
      const liveQueueEntry = manual ? null : (runtime.queue.find(item => item.id === entry.queueEntry?.id) || entry.queueEntry);
      const liveEntry = liveQueueEntry ? { ...entry, queueEntry: liveQueueEntry } : entry;
      const context = manualContext || eventContextFor(liveEntry, state, workspace);
      const preview = previewAutomation(automation, context);
      if (!manual) {
        const guard = guardReason(automation, liveQueueEntry, runtime);
        if (guard) {
          automation.pausedReason = guard;
          const message = guard === "loop_guard" ? "Правило остановлено защитой от цикла" : "Правило остановлено из-за слишком частых запусков";
          addHistory(runtime, automation, entry.run, "error", message);
          clearQueueEntry(runtime, liveQueueEntry);
          return { status: "error", message, actionResults: [] };
        }
      }
      if (!preview.valid) {
        const message = preview.warnings[0] || "Правило нужно исправить";
        automation.lastError = message;
        addHistory(runtime, automation, entry.run, "error", message);
        if (!manual) clearQueueEntry(runtime, liveQueueEntry);
        return { status: "error", message, actionResults: [] };
      }
      if (!preview.conditions.passed) {
        const message = "Условия правила не выполнены";
        addHistory(runtime, automation, entry.run, "skipped", message);
        if (!manual) {
          markCompletedRun(entry);
          clearQueueEntry(runtime, liveQueueEntry);
        }
        return { status: "skipped", message, actionResults: [] };
      }

      const manualCheckpoint = { completedActionIds: [], actionResults: [] };
      const getCheckpoint = () => manual
        ? manualCheckpoint
        : checkpointFor(runtime, runtime.queue.find(item => item.id === liveQueueEntry.id) || liveQueueEntry);
      let previousNote = null;
      let failed = false;
      for (const action of automation.actions) {
        let checkpoint = getCheckpoint();
        if (checkpoint.completedActionIds.includes(action.id)) {
          const prior = checkpoint.actionResults.find(result => result.actionId === action.id);
          if (prior?.actionType === "create_note" && prior.objectId) previousNote = { kind: "fs", id: prior.objectId };
          continue;
        }
        try {
          const result = await executeOneAction(automation, action, entry.run, context, options, previousNote);
          checkpoint = getCheckpoint();
          checkpoint.actionResults = checkpoint.actionResults.filter(item => item.actionId !== action.id);
          checkpoint.actionResults.push(result);
          checkpoint.completedActionIds.push(action.id);
          checkpoint.updatedAt = now();
          if (action.type === "create_note" && result.objectId) previousNote = { kind: "fs", id: result.objectId };
        } catch (error) {
          failed = true;
          checkpoint = getCheckpoint();
          const result = {
            actionId: action.id,
            actionType: action.type,
            status: "error",
            message: textValue(error?.message || "Ошибка действия", 500),
            objectKind: "",
            objectId: ""
          };
          checkpoint.actionResults = checkpoint.actionResults.filter(item => item.actionId !== action.id);
          checkpoint.actionResults.push(result);
          checkpoint.updatedAt = now();
          if (action.onError !== "continue") break;
        }
      }

      const checkpoint = getCheckpoint();
      const successes = checkpoint.actionResults.filter(result => result.status === "success").length;
      const status = failed ? (successes ? "warning" : "error") : (checkpoint.actionResults.some(result => result.status === "skipped") ? "warning" : "success");
      const message = status === "success" ? "Все действия выполнены" : status === "warning" ? "Часть действий выполнена" : "Запуск завершился ошибкой";
      addHistory(runtime, automation, entry.run, status, message, checkpoint.actionResults);
      if (failed && !manual) {
        const retryEntry = runtime.queue.find(item => item.id === liveQueueEntry.id) || liveQueueEntry;
        retryEntry.attempts += 1;
        retryEntry.status = "retry";
        automation.lastError = checkpoint.actionResults.find(result => result.status === "error")?.message || message;
        throw new Error(`Automation action rejected: ${automation.id}`);
      }
      if (!manual) {
        markCompletedRun(entry);
        clearQueueEntry(runtime, liveQueueEntry);
      }
      return { status, message, actionResults: cloneValue(checkpoint.actionResults), history: runtime.history[runtime.history.length - 1] };
    }

    async function executeDueRuns() {
      const entries = collectDueRuns();
      const { runtime } = current();
      if (runtime.paused) return 0;
      let executed = 0;
      for (const entry of entries) {
        const live = current();
        if (live.runtime.paused) break;
        const automation = live.workspace.automations.find(item => item.id === entry.automation.id);
        if (!automation?.enabled || automation.pausedReason) continue;
        await executeEntry(entry, false);
        executed += 1;
      }
      return executed;
    }

    function enqueueEvent(event = {}) {
      const { state, workspace } = current();
      const triggerType = TYPE_SET.has(event.type) ? event.type : "";
      if (!triggerType) return [];
      const context = {
        ...event,
        triggerType,
        state,
        workspace,
        file: event.fileId ? state.fs?.[event.fileId] : event.file,
        event: event.eventId ? (workspace.events || []).find(item => item?.id === event.eventId) : event.event,
        task: event.taskId ? (workspace.tasks || []).find(item => item?.id === event.taskId) : event.task,
        note: event.noteId ? state.fs?.[event.noteId] : event.note
      };
      const queued = [];
      workspace.automations.forEach(automation => {
        if (automation.type !== triggerType) return;
        const run = pendingRunForAutomation(automation, { ...context, now: event.at || now(), triggerId: event.fileId || event.eventId || event.taskId || event.noteId });
        if (!run) return;
        queued.push(enqueueRun(automation, run, {
          originAutomationId: event.originAutomationId,
          chainId: event.chainId,
          chainDepth: event.chainDepth,
          chainAutomationIds: event.chainAutomationIds
        }));
      });
      return queued.filter(Boolean);
    }

    async function manualRun(automationOrId, context = {}) {
      const { workspace } = current();
      const automation = typeof automationOrId === "string"
        ? workspace.automations.find(item => item.id === automationOrId)
        : normalizeAutomation(automationOrId);
      if (!automation) throw new Error("Автоматизация не найдена.");
      const run = {
        runKey: `manual:${automation.id}:${now()}`.slice(0, AUTOMATION_RUN_KEY_MAX_CHARS),
        type: automation.type,
        fileId: safeId(context.file?.id),
        eventId: safeId(context.event?.id),
        triggerId: safeId(context.task?.id || context.note?.id),
        eventDate: context.eventDate || context.event?.date || "",
        scheduledAt: now()
      };
      return executeEntry({ automation, run, queueEntry: null }, true, { ...context, state: context.state || getState(), workspace: context.workspace || workspace });
    }

    function preview(value, context = {}) {
      const { state, workspace } = current();
      return previewAutomation(value, { ...context, state, workspace });
    }

    function setGlobalPaused(paused) {
      const { runtime } = current();
      runtime.paused = paused === true;
      return runtime.paused;
    }

    function clearHistory() {
      const { runtime } = current();
      runtime.history = [];
      return true;
    }

    function resetFileAddedSeenIds() {
      const { runtime } = current();
      runtime.baselineSeeded = false;
      runtime.knownFileIds = [];
      return true;
    }

    return Object.freeze({
      collectDueRuns,
      executeDueRuns,
      enqueueEvent,
      manualRun,
      preview,
      setGlobalPaused,
      clearHistory,
      resetFileAddedSeenIds
    });
  }

  window.ZETER_AUTOMATION_UTILS = Object.freeze({
    AUTOMATION_MAX_ITEMS,
    AUTOMATION_NAME_MAX_CHARS,
    AUTOMATION_TEXT_MAX_CHARS,
    AUTOMATION_RUN_KEY_MAX_CHARS,
    AUTOMATION_TYPES,
    AUTOMATION_CONDITIONS,
    AUTOMATION_ACTION_TYPES,
    AUTOMATION_TEMPLATES,
    AUTOMATION_QUEUE_MAX_ITEMS,
    AUTOMATION_HISTORY_MAX_ITEMS,
    AUTOMATION_CHECKPOINT_MAX_ITEMS,
    normalizeAutomationAction,
    normalizeAutomationCondition,
    normalizeAutomation,
    normalizeAutomations,
    normalizeAutomationCategories,
    automationCategoryScope,
    changeAutomationCategory,
    normalizeAutomationRuntime,
    automationTemplateDraft,
    renderAutomationText,
    evaluateAutomationConditions,
    findBrokenAutomationReferences,
    previewAutomation,
    dueRunForAutomation,
    pendingRunForAutomation,
    markAutomationRun,
    executeAutomationAction,
    createAutomationRuntimeController
  });
})();
