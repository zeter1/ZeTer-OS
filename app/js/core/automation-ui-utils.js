(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const automationUtils = window.ZETER_AUTOMATION_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS automation UI utils require core utils.");
  if (!automationUtils) throw new Error("ZeTer OS automation UI utils require automation utils.");

  const { escapeHtml } = coreUtils;
  const {
    AUTOMATION_TEMPLATES = [],
    normalizeAutomation,
    normalizeAutomations,
    normalizeAutomationRuntime,
    normalizeAutomationCategories,
    automationCategoryScope,
    automationTemplateDraft
  } = automationUtils;
  const safeAttr = escapeHtml;
  const clone = value => JSON.parse(JSON.stringify(value));
  const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
  const TRIGGER_LABELS = Object.freeze({
    weekly: "Каждую неделю",
    daily: "Каждый день",
    monthly: "Каждый месяц",
    event_before: "Перед событием",
    event_relative: "Относительно события",
    file_added: "Файл добавлен в ZeTer OS",
    task_completed: "Задача завершена",
    task_overdue: "Задача просрочена",
    note_created: "Заметка создана",
    note_changed: "Заметка изменена",
    event_created: "Событие создано",
    startup: "Запуск ZeTer OS"
  });
  const CONDITION_LABELS = Object.freeze({
    file_name_contains: "Имя файла содержит",
    file_extension: "Расширение файла",
    file_size: "Размер файла",
    file_source_folder: "Исходная папка",
    event_title_contains: "Название события содержит",
    event_category: "Категория события",
    event_datetime: "Дата или время события",
    object_exists: "Объект существует",
    task_title_contains: "Название задачи содержит",
    task_project: "Проект задачи",
    task_status: "Статус задачи",
    note_name_contains: "Название заметки содержит",
    note_content_contains: "Текст заметки содержит"
  });
  const ACTION_LABELS = Object.freeze({
    notify: "Показать уведомление",
    create_note: "Создать заметку",
    move_file: "Переместить файл",
    link_objects: "Связать объекты"
  });

  function allowedConditionTypes(triggerType = "") {
    if (triggerType === "file_added") return new Set(["file_name_contains", "file_extension", "file_size", "file_source_folder", "object_exists"]);
    if (["event_before", "event_relative", "event_created"].includes(triggerType)) return new Set(["event_title_contains", "event_category", "event_datetime", "object_exists"]);
    if (["task_completed", "task_overdue"].includes(triggerType)) return new Set(["task_title_contains", "task_project", "task_status", "object_exists"]);
    if (["note_created", "note_changed"].includes(triggerType)) return new Set(["note_name_contains", "note_content_contains", "object_exists"]);
    return new Set(["object_exists"]);
  }

  function triggerSummary(value = {}, options = {}) {
    const automation = normalizeAutomation(value) || value;
    if (automation.type === "weekly") return `каждую ${WEEKDAYS[automation.weekday] || "неделю"} в ${automation.time || "09:00"}`;
    if (automation.type === "daily") return `каждый день в ${automation.time || "09:00"}`;
    if (automation.type === "monthly") return `${automation.monthday || 1}-го числа в ${automation.time || "09:00"}`;
    if (automation.type === "event_before") return `за ${automation.minutesBefore || 0} мин. до «${options.resolveLabel?.("event", automation.eventId) || automation.eventId || "события"}»`;
    if (automation.type === "event_relative") {
      const offset = Number(automation.offsetMinutes) || 0;
      const relation = offset < 0 ? `за ${Math.abs(offset)} мин. до` : offset > 0 ? `через ${offset} мин. после` : "сразу после";
      return `${relation} «${options.resolveLabel?.("event", automation.eventId) || automation.eventId || "события"}»`;
    }
    if (automation.type === "file_added") {
      const folder = automation.folderId ? options.resolveLabel?.("folder", automation.folderId) || automation.folderId : "любую папку";
      return `файл добавлен в ZeTer OS · ${folder}`;
    }
    return (TRIGGER_LABELS[automation.type] || automation.type || "Триггер").toLocaleLowerCase("ru-RU");
  }

  function conditionSummary(value = {}) {
    const automation = normalizeAutomation(value) || value;
    const conditions = Array.isArray(automation.conditions) ? automation.conditions : [];
    if (!conditions.length) return "без дополнительных условий";
    return `${automation.conditionMode === "any" ? "любое" : "все"}: ${conditions.map(item => CONDITION_LABELS[item.type] || item.type).join(", ")}`;
  }

  function actionSummary(value = {}, options = {}) {
    const action = value.type ? value : (value.action || value.actions?.[0] || {});
    if (action.type === "notify") return `показать уведомление «${action.title || "ZeTer OS"}»`;
    if (action.type === "create_note") return `создать заметку «${action.name || "Новая заметка"}»`;
    if (action.type === "move_file") return `переместить файл в «${options.resolveLabel?.("folder", action.targetFolderId) || action.targetFolderId || "папку"}»`;
    if (action.type === "link_objects") return "связать объекты";
    return ACTION_LABELS[action.type] || "выполнить действие";
  }

  function automationRuleSummary(value = {}, options = {}) {
    const automation = normalizeAutomation(value) || value;
    const actions = Array.isArray(automation.actions) && automation.actions.length ? automation.actions : [automation.action || {}];
    const when = triggerSummary(automation, options);
    const condition = (automation.conditions || []).length ? ` → если ${conditionSummary(automation)}` : "";
    const then = actions.length === 1 ? actionSummary(actions[0], options) : `${actions.length} действия`;
    return `Когда ${when}${condition} → ${then}`;
  }

  function statusForAutomation(automation, runtime = {}, preview = null) {
    if (runtime.paused) return { id: "global", label: "Все на паузе" };
    if (automation.pausedReason) return { id: "error", label: "Остановлено" };
    if (automation.lastError) return { id: "error", label: "С ошибкой" };
    if (preview && !preview.valid && (!preview.missingSample || preview.brokenReferences?.length)) return { id: "broken", label: "Нужно исправить" };
    if (!automation.enabled) return { id: "paused", label: "На паузе" };
    return { id: "active", label: "Активна" };
  }

  function nextRunText(automation) {
    if (["weekly", "daily", "monthly", "event_before", "event_relative"].includes(automation.type)) return triggerSummary(automation);
    if (automation.type === "startup") return "При следующем запуске ZeTer OS";
    return "После следующего подходящего события";
  }

  function lastHistoryFor(runtime, id) {
    return [...(runtime.history || [])].reverse().find(item => item.automationId === id) || null;
  }

  function automationCardHTML(value = {}, options = {}) {
    const automation = normalizeAutomation(value) || value;
    const runtime = normalizeAutomationRuntime(options.runtime || {});
    const preview = typeof options.previewAutomation === "function" ? options.previewAutomation(automation) : null;
    const status = statusForAutomation(automation, runtime, preview);
    const last = lastHistoryFor(runtime, automation.id);
    const warnings = preview?.brokenReferences || [];
    return `<article class="automation-card is-${safeAttr(status.id)}${automation.enabled ? "" : " is-disabled"}" data-automation-id="${safeAttr(automation.id)}" data-automation-status="${safeAttr(status.id)}">
      <div class="automation-card-main">
        <small class="automation-category-badge">${escapeHtml((options.categories || []).find(category => category.id === automation.categoryId)?.name || "Без категории")}</small>
        <div class="automation-card-title-row"><b>${escapeHtml(automation.name || "Без названия")}</b><div class="automation-card-status-tools"><span class="automation-status-badge is-${safeAttr(status.id)}">${escapeHtml(status.label)}</span><label class="automation-enabled-toggle"><input type="checkbox" data-automation-card-enabled="${safeAttr(automation.id)}"${automation.enabled ? " checked" : ""}> Включено</label></div></div>
        <p class="automation-rule-flow"><span>Когда</span> ${escapeHtml(triggerSummary(automation, options))} <b>→</b> <span>Если</span> ${escapeHtml(conditionSummary(automation))} <b>→</b> <span>Тогда</span> ${escapeHtml(automation.actions?.length === 1 ? actionSummary(automation.actions[0], options) : `${automation.actions?.length || 0} действия`)}</p>
        <div class="automation-card-facts"><small><b>Следующий запуск:</b> ${escapeHtml(nextRunText(automation))}</small><small><b>Последний результат:</b> ${last ? `${escapeHtml(last.message || last.status)} · ${escapeHtml(new Date(last.createdAt).toLocaleString("ru-RU"))}` : "ещё не запускалась"}</small></div>
        ${warnings.length ? `<p class="automation-reference-warning">⚠ ${escapeHtml(warnings[0])}</p>` : ""}
      </div>
      <div class="automation-card-actions">
        <button type="button" data-run-automation="${safeAttr(automation.id)}">Запустить</button>
        <button type="button" data-preview-automation="${safeAttr(automation.id)}">Проверить</button>
        <button type="button" data-edit-automation="${safeAttr(automation.id)}">Редактировать</button>
        <button type="button" data-duplicate-automation="${safeAttr(automation.id)}">Дублировать</button>
        <button type="button" class="danger-btn" data-delete-automation="${safeAttr(automation.id)}">Удалить</button>
      </div>
    </article>`;
  }

  function automationListHTML(values = [], options = {}) {
    const list = normalizeAutomations(values);
    if (!list.length) return `<div class="automation-empty"><b>Автоматизаций пока нет</b><p class="muted">Создай правило или начни с готового шаблона.</p></div>`;
    return list.map(item => automationCardHTML(item, options)).join("");
  }

  function selectOptions(values = [], selected = "", fallback = "Выбери объект") {
    return [`<option value="">${escapeHtml(fallback)}</option>`, ...(values || []).map(item => `<option value="${safeAttr(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.label || item.name || item.id)}</option>`)].join("");
  }

  function fileSampleHTML(options = {}) {
    const files = options.fileOptions || [];
    const selected = files.find(file => file.id === options.sampleFileId);
    const source = (options.folderOptions || []).find(folder => folder.id === options.sourceFolderId);
    const desktop = (options.folderOptions || []).find(folder => folder.isDesktop);
    const location = selected?.folderLabel || source?.label || desktop?.label || "Рабочий стол";
    const folderButton = selected ? "Открыть папку объекта" : source?.isDesktop || !options.sourceFolderId ? "Открыть рабочий стол" : "Открыть папку";
    return `<div class="automation-file-sample">
      <p><b>Где искать:</b> ${escapeHtml(source?.label || (options.sourceFolderId ? "Выбранная папка" : "Весь текущий рабочий стол, включая все его папки"))}</p>
      <label class="automation-field"><span>Файл для проверки (можно выбрать заметку)</span><select data-automation-sample-file aria-label="Файл для проверки"${files.length ? "" : " disabled"}>${selectOptions(files, options.sampleFileId || "", files.length ? "Выбери файл или заметку из списка" : "Нет файлов и заметок для проверки")}</select></label>
      <p class="muted">${options.sourceFolderId ? "Показаны только файлы и заметки непосредственно в выбранном месте. Содержимое подпапок не включено: выбери нужную подпапку или «Любая папка ZeTer OS»." : "Показаны файлы и заметки со всего текущего рабочего стола и из его папок."} Значки приложений и сами папки в этот список не входят.</p>
      <p><b>${selected ? "Расположение выбранного объекта" : "Кнопка ниже откроет"}:</b> ${escapeHtml(location)}</p>
      <div class="automation-file-sample-actions"><button type="button" data-check-sample${selected ? "" : " disabled"}>Проверить автоматизацию</button>${selected ? `<button type="button" data-open-sample-file>${selected.type === "note" ? "Открыть заметку" : "Открыть выбранный файл"}</button>` : ""}<button type="button" data-open-source-folder>${folderButton}</button><button type="button" data-refresh-sample-files>Обновить список</button></div>
      <p class="muted">«Проверить автоматизацию» не выполняет действия. После проверки выбор очищается; её результат остаётся ниже.</p>
      <p class="muted">Это пример для проверки и ручного запуска, а не вложение к правилу. Автоматически правило обрабатывает новые файлы в папке-источнике.</p>
      ${!files.length ? `<p class="automation-file-empty">Это не означает, что рабочий стол пуст. Открой нужную папку кнопкой выше. Перетащи туда файл из Проводника Windows или нажми правой кнопкой по пустому месту → «Создать файл». Затем вернись сюда и нажми «Обновить список». Папка ZeTer OS — не папка Windows.</p>` : ""}
    </div>`;
  }

  function variableHelpHTML(triggerType) {
    const rows = [
      ["file.name", "Имя добавленного файла или выбранной для проверки заметки", "Отчёт.pdf", ["file_added"], "Добавление файла"],
      ["file.folder", "Название папки, в которой находится этот файл", "Документы", ["file_added"], "Добавление файла"],
      ["event.title", "Название события календаря", "Встреча с командой", ["event_before", "event_relative", "event_created"], "События календаря"],
      ["event.date", "Дата события в формате ГГГГ-ММ-ДД", "2026-09-04", ["event_before", "event_relative", "event_created"], "События календаря"],
      ["task.title", "Название задачи, которая завершена или просрочена", "Подготовить отчёт", ["task_completed", "task_overdue"], "Завершение или просрочка задачи"],
      ["note.name", "Название созданной или изменённой заметки", "План недели", ["note_created", "note_changed"], "Создание или изменение заметки"],
      ["automation.name", "Название этого правила из поля «Название»", "Моё напоминание", null, "Любой триггер"]
    ];
    const available = row => !row[3] || row[3].includes(triggerType);
    const renderRows = values => `<dl class="automation-variable-list">${values.map(([key, description, example, , when]) => `<div><dt><code>{${key}}</code></dt><dd>${description}.<br><small>Пример: ${example}. Когда: ${when}.</small></dd></div>`).join("")}</dl>`;
    const example = triggerType === "file_added" ? ["Добавлен файл {file.name}", "Добавлен файл Отчёт.pdf"]
      : ["event_before", "event_relative", "event_created"].includes(triggerType) ? ["Подготовка к {event.title}", "Подготовка к Встреча с командой"]
      : ["task_completed", "task_overdue"].includes(triggerType) ? ["Задача: {task.title}", "Задача: Подготовить отчёт"]
      : ["note_created", "note_changed"].includes(triggerType) ? ["Заметка: {note.name}", "Заметка: План недели"]
      : ["Сработало правило {automation.name}", "Сработало правило Моё напоминание"];
    return `<h4>Переменные — автоматическая подстановка текста</h4>
      <p>Это необязательные метки: при запуске ZeTer OS заменит их данными файла, события или правила. Можно писать обычный текст без переменных.</p>
      <p><b>Как пользоваться:</b> скопируй метку целиком, вместе с фигурными скобками, и вставь в заголовок или текст уведомления, название или текст создаваемой заметки. Затем нажми «Проверить правило» и посмотри результат.</p>
      <p><b>Пример:</b> введи <code>${example[0]}</code> → получится «${example[1]}».</p>
      <h4>Для выбранного триггера</h4>${renderRows(rows.filter(available))}
      ${triggerType === "file_added" ? `<p>Даже если выбранный файл — заметка, здесь используй <code>{file.name}</code>. Метка <code>{note.name}</code> предназначена для триггеров «Заметка создана» и «Заметка изменена».</p>` : ""}
      <details><summary>Переменные для других триггеров</summary>${renderRows(rows.filter(row => !available(row)))}</details>
      <p class="muted">Если нужных данных нет или метка написана с ошибкой, она останется в тексте без замены, а проверка покажет предупреждение. Для файлового триггера сначала выбери файл для проверки. Эти метки не выполняют программный код.</p>`;
  }

  function triggerFieldsHTML(automation, options = {}) {
    const eventOptions = options.eventOptions || [];
    const folderOptions = options.folderOptions || [];
    return `<div class="automation-dependent-fields" data-trigger-fields="weekly"${automation.type === "weekly" ? "" : " hidden"}>
      <label class="automation-field"><span>День</span><select data-automation-weekday>${WEEKDAYS.map((day, index) => `<option value="${index}"${index === automation.weekday ? " selected" : ""}>${escapeHtml(day)}</option>`).join("")}</select></label>
      <label class="automation-field"><span>Время</span><input type="time" data-automation-time value="${safeAttr(automation.time || "09:00")}"></label>
    </div>
    <div class="automation-dependent-fields" data-trigger-fields="daily"${automation.type === "daily" ? "" : " hidden"}><label class="automation-field"><span>Время</span><input type="time" data-automation-daily-time value="${safeAttr(automation.time || "09:00")}"></label></div>
    <div class="automation-dependent-fields" data-trigger-fields="monthly"${automation.type === "monthly" ? "" : " hidden"}><label class="automation-field"><span>Число месяца</span><input type="number" min="1" max="31" data-automation-monthday value="${safeAttr(automation.monthday || 1)}"></label><label class="automation-field"><span>Время</span><input type="time" data-automation-monthly-time value="${safeAttr(automation.time || "09:00")}"></label></div>
    <div class="automation-dependent-fields" data-trigger-fields="event_before event_relative"${["event_before", "event_relative"].includes(automation.type) ? "" : " hidden"}><label class="automation-field"><span>Событие</span><select data-automation-event-id>${selectOptions(eventOptions, automation.eventId, "Выбери событие")}</select></label><label class="automation-field"><span>${automation.type === "event_before" ? "Минут до события" : "Смещение в минутах"}</span><input type="number" data-automation-event-offset value="${safeAttr(automation.type === "event_before" ? automation.minutesBefore ?? 15 : automation.offsetMinutes ?? 0)}"></label></div>
    <div class="automation-dependent-fields" data-trigger-fields="file_added"${automation.type === "file_added" ? "" : " hidden"}><label class="automation-field"><span>Где отслеживать новые файлы</span><select data-automation-folder-id>${selectOptions(folderOptions, automation.folderId, "Любая папка ZeTer OS")}</select></label><div class="automation-field-wide" data-file-sample-host>${fileSampleHTML({ ...options, sourceFolderId: automation.folderId || "" })}</div></div>
    <div class="automation-dependent-fields" data-trigger-fields="task_completed task_overdue"${["task_completed", "task_overdue"].includes(automation.type) ? "" : " hidden"}><label class="automation-field"><span>ID проекта (необязательно)</span><input data-automation-project-id value="${safeAttr(automation.projectId || "")}"></label></div>
    <div class="automation-dependent-fields" data-trigger-fields="note_created note_changed"${["note_created", "note_changed"].includes(automation.type) ? "" : " hidden"}><label class="automation-field"><span>Папка заметок</span><select data-automation-note-folder-id>${selectOptions(folderOptions, automation.noteFolderId, "Любая папка")}</select></label></div>`;
  }

  function conditionRowHTML(condition = {}, index = 0, triggerType = "") {
    const type = condition.type || "file_name_contains";
    const allowed = allowedConditionTypes(triggerType);
    return `<div class="automation-condition-row" data-automation-condition-row data-condition-id="${safeAttr(condition.id || `condition_${index + 1}`)}">
      <select data-condition-type aria-label="Тип условия">${Object.entries(CONDITION_LABELS).map(([id, label]) => `<option value="${id}"${id === type ? " selected" : ""}${!allowed.has(id) && id !== type ? " disabled hidden" : ""}>${escapeHtml(label)}</option>`).join("")}</select>
      <select data-condition-operator aria-label="Сравнение"><option value="eq"${condition.operator === "eq" ? " selected" : ""}>равно</option><option value="ne"${condition.operator === "ne" ? " selected" : ""}>не равно</option><option value="gt"${condition.operator === "gt" ? " selected" : ""}>больше</option><option value="gte"${condition.operator === "gte" ? " selected" : ""}>не меньше</option><option value="lt"${condition.operator === "lt" ? " selected" : ""}>меньше</option><option value="lte"${condition.operator === "lte" ? " selected" : ""}>не больше</option></select>
      <input data-condition-value value="${safeAttr(condition.type === "file_size" ? condition.number ?? condition.value ?? "" : condition.value || "")}" placeholder="Значение" aria-label="Значение условия">
      <button type="button" data-remove-condition="${index}" aria-label="Удалить условие ${index + 1}">Удалить</button>
    </div>`;
  }

  function objectRefFieldsHTML(action, side) {
    const ref = action[side] || { mode: side === "left" ? "trigger" : "previous_note" };
    return `<div class="automation-object-ref"><label class="automation-field"><span>${side === "left" ? "Первый объект" : "Второй объект"}</span><select data-action-ref-mode="${side}"><option value="trigger"${ref.mode === "trigger" ? " selected" : ""}>Объект триггера</option><option value="previous_note"${ref.mode === "previous_note" ? " selected" : ""}>Созданная ранее заметка</option><option value="selected"${ref.mode === "selected" ? " selected" : ""}>Выбранный объект</option></select></label><label class="automation-field"><span>Тип</span><select data-action-ref-kind="${side}"><option value="fs"${ref.kind === "fs" ? " selected" : ""}>Файл/заметка</option><option value="event"${ref.kind === "event" ? " selected" : ""}>Событие</option></select></label><label class="automation-field"><span>ID выбранного объекта</span><input data-action-ref-id="${side}" value="${safeAttr(ref.id || "")}"></label></div>`;
  }

  function actionRowHTML(action = {}, index = 0, options = {}, triggerType = "weekly") {
    const type = action.type || "notify";
    const moveDisabled = triggerType !== "file_added";
    const moveAttributes = `${type === "move_file" ? " selected" : ""}${moveDisabled ? " disabled hidden" : ""}`;
    return `<div class="automation-action-row" data-automation-action-row data-action-id="${safeAttr(action.id || `action_${index + 1}`)}">
      <div class="automation-action-row-head"><b>Действие ${index + 1}</b><div><button type="button" data-move-action-up="${index}" aria-label="Поднять действие ${index + 1}">↑</button><button type="button" data-move-action-down="${index}" aria-label="Опустить действие ${index + 1}">↓</button><button type="button" data-remove-action="${index}" aria-label="Удалить действие ${index + 1}">Удалить</button></div></div>
      <div class="automation-action-basics"><label class="automation-field"><span>Тип действия</span><select data-action-type data-automation-action><option value="notify"${type === "notify" ? " selected" : ""}>Показать уведомление</option><option value="create_note"${type === "create_note" ? " selected" : ""}>Создать заметку</option><option value="move_file" data-automation-move-file-option${moveAttributes}>Переместить файл</option><option value="link_objects"${type === "link_objects" ? " selected" : ""}>Связать объекты</option></select></label><label class="automation-field"><span>При ошибке</span><select data-action-on-error><option value="stop"${action.onError !== "continue" ? " selected" : ""}>Остановить цепочку</option><option value="continue"${action.onError === "continue" ? " selected" : ""}>Продолжить</option></select></label></div>
      <div class="automation-dependent-fields" data-action-fields="notify"${type === "notify" ? "" : " hidden"}><label class="automation-field"><span>Заголовок</span><input data-action-title value="${safeAttr(action.title || "Автоматизация ZeTer OS")}"></label><label class="automation-field"><span>Текст</span><textarea data-action-text>${escapeHtml(action.text || "")}</textarea></label></div>
      <div class="automation-dependent-fields" data-action-fields="create_note"${type === "create_note" ? "" : " hidden"}><label class="automation-field"><span>Название заметки</span><input data-action-note-name value="${safeAttr(action.name || "Новая заметка")}"></label><label class="automation-field"><span>Папка</span><select data-action-parent-id>${selectOptions(options.folderOptions || [], action.parentId, "Рабочий стол")}</select></label><label class="automation-field automation-field-wide"><span>Текст заметки</span><textarea data-action-content>${escapeHtml(action.content || "")}</textarea></label></div>
      <div class="automation-dependent-fields" data-action-fields="move_file"${type === "move_file" ? "" : " hidden"}><label class="automation-field"><span>Целевая папка</span><select data-action-target-folder>${selectOptions(options.folderOptions || [], action.targetFolderId, "Выбери папку")}</select></label><label class="automation-field"><span>Если имя совпало</span><select data-action-collision><option value="skip"${action.collisionPolicy === "skip" ? " selected" : ""}>Пропустить</option><option value="rename"${action.collisionPolicy === "rename" ? " selected" : ""}>Безопасно переименовать</option><option value="replace"${action.collisionPolicy === "replace" ? " selected" : ""}>Заменить существующий</option></select></label><label class="automation-replace-ack"><input type="checkbox" data-action-replace-ack${action.replaceAcknowledged ? " checked" : ""}> Я понимаю: существующий объект будет перемещён в восстановимое удаление</label></div>
      <div class="automation-dependent-fields" data-action-fields="link_objects"${type === "link_objects" ? "" : " hidden"}>${objectRefFieldsHTML(action, "left")}${objectRefFieldsHTML(action, "right")}<label class="automation-field"><span>Подпись связи</span><input data-action-link-label value="${safeAttr(action.label || "")}"></label></div>
    </div>`;
  }

  function defaultDraft(uid = prefix => `${prefix}_${Date.now()}`) {
    return { id: uid("automation"), name: "Новая автоматизация", enabled: true, type: "weekly", weekday: 1, time: "09:00", conditionMode: "all", conditions: [], actions: [{ id: uid("automation_action"), type: "notify", title: "Автоматизация ZeTer OS", text: "", onError: "stop" }] };
  }

  function automationEditorHTML(value = {}, options = {}) {
    const source = value && Object.keys(value).length ? value : defaultDraft(options.uid);
    const automation = normalizeAutomation(source) || source;
    automation.conditions = Array.isArray(automation.conditions) ? automation.conditions : [];
    automation.actions = Array.isArray(automation.actions) && automation.actions.length ? automation.actions : [automation.action || { type: "notify" }];
    const validation = validateAutomationDraft(automation);
    return `<section class="automation-editor-card" data-automation-editor data-automation-editing-id="${safeAttr(automation.id || "")}">
      <div class="automation-editor-heading"><div><h3>${options.isNew ? "Новая автоматизация" : "Редактирование"}</h3><p class="muted">Собери правило по шагам: Когда → Если → Тогда.</p></div><button type="button" data-cancel-automation aria-label="Закрыть редактор">Закрыть</button></div>
      <div class="automation-editor-section"><div class="automation-editor-grid"><label class="automation-field"><span>Название</span><input data-automation-name value="${safeAttr(automation.name || "")}" maxlength="160"></label><label class="automation-enabled-editor"><input type="checkbox" data-automation-enabled${automation.enabled !== false ? " checked" : ""}> Правило включено</label></div></div>
      <label class="automation-field"><span>Категория автоматизации</span><select data-automation-category>${selectOptions((options.categories || []).map(category => ({ id: category.id, label: category.name })), automation.categoryId, "Без категории")}</select></label>
      <div class="automation-editor-section"><h4>Когда</h4><label class="automation-field"><span>Триггер</span><select data-automation-trigger>${Object.entries(TRIGGER_LABELS).map(([id, label]) => `<option value="${id}"${id === automation.type ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>${triggerFieldsHTML(automation, options)}</div>
      <div class="automation-editor-section"><div class="automation-section-heading"><div><h4>Если</h4><p class="muted">Показаны только условия, которым доступен объект выбранного триггера. Пустой список означает «Без дополнительных условий».</p></div><button type="button" data-add-condition>Добавить условие</button></div><label class="automation-field"><span>Как объединять</span><select data-condition-mode><option value="all"${automation.conditionMode !== "any" ? " selected" : ""}>Все условия (И)</option><option value="any"${automation.conditionMode === "any" ? " selected" : ""}>Любое условие (ИЛИ)</option></select></label><div class="automation-condition-list" data-condition-list>${automation.conditions.map((condition, index) => conditionRowHTML(condition, index, automation.type)).join("") || `<p class="muted">Без дополнительных условий.</p>`}</div></div>
      <div class="automation-editor-section"><div class="automation-section-heading"><div><h4>Тогда</h4><p class="muted">Действия выполняются сверху вниз.</p></div><button type="button" data-add-action>Добавить действие</button></div><div class="automation-action-list" data-action-list>${automation.actions.map((action, index) => actionRowHTML(action, index, options, automation.type)).join("")}</div></div>
      <aside class="automation-variable-help" data-variable-help>${variableHelpHTML(automation.type)}</aside>
      <p class="automation-editor-error" data-automation-editor-error${validation.valid ? " hidden" : ""}>${escapeHtml(validation.valid ? "" : validation.message)}</p>
      <div class="automation-editor-actions"><button type="button" data-cancel-automation>Отмена</button><button type="button" data-preview-editor>Проверить правило</button><button type="button" class="app-btn primary" data-save-automation>Сохранить</button></div>
    </section>`;
  }

  function readAutomationDraft(root) {
    if (!root) return null;
    const value = selector => root.querySelector(selector)?.value || "";
    const checked = selector => root.querySelector(selector)?.checked === true;
    const type = value("[data-automation-trigger]") || "weekly";
    const draft = {
      id: root.dataset.automationEditingId || "",
      name: value("[data-automation-name]").trim(),
      categoryId: value("[data-automation-category]"),
      enabled: checked("[data-automation-enabled]"),
      type,
      conditionMode: value("[data-condition-mode]") === "any" ? "any" : "all",
      conditions: [...root.querySelectorAll("[data-automation-condition-row]")].map((row, index) => {
        const conditionType = row.querySelector("[data-condition-type]")?.value || "file_name_contains";
        const raw = row.querySelector("[data-condition-value]")?.value || "";
        return { id: row.dataset.conditionId || `condition_${index + 1}`, type: conditionType, operator: row.querySelector("[data-condition-operator]")?.value || "eq", value: raw, number: conditionType === "file_size" ? Number(raw) || 0 : undefined };
      }),
      actions: [...root.querySelectorAll("[data-automation-action-row]")].map((row, index) => {
        const actionType = row.querySelector("[data-action-type]")?.value || "notify";
        const action = { id: row.dataset.actionId || `action_${index + 1}`, type: actionType, onError: row.querySelector("[data-action-on-error]")?.value === "continue" ? "continue" : "stop" };
        if (actionType === "notify") Object.assign(action, { title: row.querySelector("[data-action-title]")?.value || "", text: row.querySelector("[data-action-text]")?.value || "" });
        if (actionType === "create_note") Object.assign(action, { name: row.querySelector("[data-action-note-name]")?.value || "", content: row.querySelector("[data-action-content]")?.value || "", parentId: row.querySelector("[data-action-parent-id]")?.value || "" });
        if (actionType === "move_file") Object.assign(action, { targetFolderId: row.querySelector("[data-action-target-folder]")?.value || "", collisionPolicy: row.querySelector("[data-action-collision]")?.value || "skip", replaceAcknowledged: row.querySelector("[data-action-replace-ack]")?.checked === true });
        if (actionType === "link_objects") {
          const ref = side => ({ mode: row.querySelector(`[data-action-ref-mode="${side}"]`)?.value || "trigger", kind: row.querySelector(`[data-action-ref-kind="${side}"]`)?.value || "fs", id: row.querySelector(`[data-action-ref-id="${side}"]`)?.value || "" });
          Object.assign(action, { left: ref("left"), right: ref("right"), label: row.querySelector("[data-action-link-label]")?.value || "" });
        }
        return action;
      })
    };
    if (type === "weekly") Object.assign(draft, { weekday: Number(value("[data-automation-weekday]")) || 0, time: value("[data-automation-time]") || "09:00" });
    if (type === "daily") draft.time = value("[data-automation-daily-time]") || "09:00";
    if (type === "monthly") Object.assign(draft, { monthday: Number(value("[data-automation-monthday]")) || 1, time: value("[data-automation-monthly-time]") || "09:00" });
    if (["event_before", "event_relative"].includes(type)) {
      draft.eventId = value("[data-automation-event-id]");
      if (type === "event_before") draft.minutesBefore = Math.max(0, Number(value("[data-automation-event-offset]")) || 0);
      else draft.offsetMinutes = Number(value("[data-automation-event-offset]")) || 0;
    }
    if (type === "file_added") draft.folderId = value("[data-automation-folder-id]");
    if (["task_completed", "task_overdue"].includes(type)) draft.projectId = value("[data-automation-project-id]");
    if (["note_created", "note_changed"].includes(type)) draft.noteFolderId = value("[data-automation-note-folder-id]");
    return draft;
  }

  function validateAutomationDraft(value = {}) {
    const actions = Array.isArray(value.actions) ? value.actions : (value.action ? [value.action] : []);
    if (!String(value.name || "").trim()) return { valid: false, selector: "[data-automation-name]", message: "Введите название автоматизации." };
    if (!actions.length) return { valid: false, selector: "[data-add-action]", message: "Добавьте хотя бы одно действие." };
    const invalidMove = actions.find(action => action.type === "move_file" && value.type !== "file_added");
    if (invalidMove) return { valid: false, selector: "[data-automation-action]", message: "Перемещение файла доступно только для триггера «При добавлении файла»." };
    const unsupportedCondition = (value.conditions || []).find(condition => !allowedConditionTypes(value.type).has(condition.type));
    if (unsupportedCondition) return { valid: false, selector: "[data-condition-type]", message: "Это условие недоступно для выбранного триггера." };
    if (value.type === "weekly" && value.weekday !== undefined && (!Number.isInteger(Number(value.weekday)) || Number(value.weekday) < 0 || Number(value.weekday) > 6)) return { valid: false, selector: "[data-automation-weekday]", message: "Выберите день недели." };
    if (["event_before", "event_relative"].includes(value.type) && !value.eventId) return { valid: false, selector: "[data-automation-event-id]", message: "Выберите событие." };
    const missingFolder = actions.find(action => action.type === "move_file" && !action.targetFolderId);
    if (missingFolder) return { valid: false, selector: "[data-action-target-folder]", message: "Выберите целевую папку для файла." };
    const unsafeReplace = actions.find(action => action.type === "move_file" && action.collisionPolicy === "replace" && action.replaceAcknowledged !== true);
    if (unsafeReplace) return { valid: false, selector: "[data-action-replace-ack]", message: "Подтвердите безопасную замену существующего объекта." };
    return { valid: true, selector: "", message: "" };
  }

  function showAutomationEditorError(root, validation) {
    if (!root) return false;
    const error = root.querySelector("[data-automation-editor-error]");
    root.querySelectorAll("[aria-invalid]").forEach(element => element.removeAttribute("aria-invalid"));
    if (validation?.valid) {
      if (error) { error.hidden = true; error.textContent = ""; }
      return true;
    }
    if (error) { error.hidden = false; error.textContent = validation?.message || "Проверьте правило."; }
    const field = validation?.selector ? root.querySelector(validation.selector) : null;
    field?.setAttribute?.("aria-invalid", "true");
    field?.focus?.();
    return false;
  }

  function syncAutomationEditorFields(root) {
    if (!root) return false;
    const trigger = root.querySelector("[data-automation-trigger]");
    const triggerType = trigger?.value || "weekly";
    const variableHelp = root.querySelector("[data-variable-help]");
    if (variableHelp) variableHelp.innerHTML = variableHelpHTML(triggerType);
    root.querySelectorAll("[data-trigger-fields]").forEach(group => {
      group.hidden = !String(group.dataset.triggerFields || "").split(/\s+/).includes(triggerType);
    });
    root.querySelectorAll("[data-automation-action-row]").forEach(row => {
      const select = row.querySelector("[data-action-type]");
      const moveOption = row.querySelector("[data-automation-move-file-option]");
      if (moveOption) { moveOption.disabled = triggerType !== "file_added"; moveOption.hidden = triggerType !== "file_added"; }
      if (select?.value === "move_file" && triggerType !== "file_added") select.value = "notify";
      const actionType = select?.value || "notify";
      row.querySelectorAll("[data-action-fields]").forEach(group => { group.hidden = group.dataset.actionFields !== actionType; });
    });
    const legacyAction = root.querySelector("[data-automation-action]");
    const legacyMoveOption = root.querySelector("[data-automation-move-file-option]");
    if (legacyMoveOption) { legacyMoveOption.disabled = triggerType !== "file_added"; legacyMoveOption.hidden = triggerType !== "file_added"; }
    if (legacyAction?.value === "move_file" && triggerType !== "file_added") legacyAction.value = "notify";
    root.querySelectorAll("[data-action-fields]").forEach(group => {
      const owner = group.closest?.("[data-automation-action-row]");
      if (!owner) group.hidden = group.dataset.actionFields !== (legacyAction?.value || "notify");
    });
    return true;
  }

  function automationClickAction(target) {
    const match = selector => target?.closest?.(selector);
    const value = (selector, key) => match(selector)?.dataset?.[key] || "";
    if (match("[data-create-automation]")) return { type: "create" };
    if (match("[data-cancel-automation]")) return { type: "cancel" };
    if (match("[data-save-automation]")) return { type: "save" };
    if (match("[data-preview-editor]")) return { type: "preview-editor" };
    if (match("[data-add-condition]")) return { type: "add-condition" };
    if (match("[data-add-action]")) return { type: "add-action" };
    if (match("[data-clear-history]")) return { type: "clear-history" };
    if (match("[data-template-id]")) return { type: "template", id: value("[data-template-id]", "templateId") };
    for (const [selector, type, key] of [["[data-edit-automation]", "edit", "editAutomation"], ["[data-delete-automation]", "delete", "deleteAutomation"], ["[data-duplicate-automation]", "duplicate", "duplicateAutomation"], ["[data-preview-automation]", "preview", "previewAutomation"], ["[data-run-automation]", "run", "runAutomation"], ["[data-run-preview]", "run", "runPreview"], ["[data-remove-condition]", "remove-condition", "removeCondition"], ["[data-remove-action]", "remove-action", "removeAction"], ["[data-move-action-up]", "move-action-up", "moveActionUp"], ["[data-move-action-down]", "move-action-down", "moveActionDown"]]) {
      if (match(selector)) return { type, id: value(selector, key) };
    }
    return null;
  }

  function automationChangeAction(target) {
    if (target?.matches?.("[data-automation-sample-file]")) return { type: "sample-file", value: target.value || "" };
    if (target?.matches?.("[data-automation-search]")) return { type: "search", value: target.value || "" };
    if (target?.matches?.("[data-automation-status-filter]")) return { type: "filter", value: target.value || "all" };
    if (target?.matches?.("[data-history-filter]")) return { type: "history-filter", value: target.value || "all" };
    if (target?.matches?.("[data-pause-all]")) return { type: "pause-all", paused: target.checked === true };
    if (target?.matches?.("[data-automation-card-enabled]")) return { type: "enabled", id: target.dataset.automationCardEnabled || "", enabled: target.checked === true };
    if (target?.closest?.("[data-automation-editor]")) return { type: "editor-change" };
    return null;
  }

  function templateCardsHTML(templates = []) {
    return templates.map(template => `<button type="button" class="automation-template-card" data-template-id="${safeAttr(template.id)}"><b>${escapeHtml(template.title)}</b><small>${escapeHtml(template.needs || "Шаблон можно изменить перед сохранением.")}</small></button>`).join("");
  }

  function historyHTML(runtime = {}, filter = "all") {
    const history = [...(runtime.history || [])].reverse().filter(item => filter === "all" || item.status === filter);
    if (!history.length) return `<p class="muted automation-history-empty">Подходящих запусков пока нет.</p>`;
    return history.map(item => `<article class="automation-history-item is-${safeAttr(item.status)}"><div><b>${escapeHtml(item.automationName || "Автоматизация")}</b><span>${escapeHtml(new Date(item.createdAt).toLocaleString("ru-RU"))}</span></div><p>${escapeHtml(item.message || item.status)}</p>${item.actionResults?.length ? `<ol>${item.actionResults.map(result => `<li class="is-${safeAttr(result.status)}">${escapeHtml(ACTION_LABELS[result.actionType] || result.actionType)} — ${escapeHtml(result.message || result.status)}</li>`).join("")}</ol>` : ""}</article>`).join("");
  }

  function previewHTML(preview = {}, automation = {}, options = {}) {
    const conditions = preview.conditions?.results || [];
    const actions = preview.actions || [];
    return `<section class="automation-preview-card is-${preview.safe ? "safe" : "warning"}" data-automation-preview-panel>
      <div class="automation-section-heading"><div><h3>Проверка правила</h3><p class="automation-preview-verdict">${escapeHtml(preview.verdict || "Нужно исправить")}</p></div><button type="button" data-close-preview>Закрыть</button></div>
      ${automation.type === "file_added" ? fileSampleHTML({ ...options, sourceFolderId: automation.folderId || "" }) : ""}
      <p><b>Пример объекта:</b> ${escapeHtml(preview.sample?.name || "не выбран")}${preview.sample?.folder ? ` · ${escapeHtml(preview.sample.folder)}` : ""}</p>
      ${options.checkedSample ? `<p>Проверка завершена без выполнения действий. Выбор файла очищен. Выше указан объект, для которого получен этот результат. Для новой проверки или ручного запуска выбери файл заново.</p>` : ""}
      <div class="automation-preview-flow"><section><h4>Условия</h4>${conditions.length ? `<ul>${conditions.map(item => `<li class="${item.passed ? "is-success" : "is-error"}">${escapeHtml(CONDITION_LABELS[item.type] || item.type)} — ${item.passed ? "выполнено" : "не выполнено"}</li>`).join("")}</ul>` : `<p>Без дополнительных условий.</p>`}</section><section><h4>Действия</h4><ol>${actions.map(action => `<li>${escapeHtml(ACTION_LABELS[action.type] || action.type)}${action.rendered?.length ? `<ul>${action.rendered.map(field => `<li>${escapeHtml(field.field)}: ${escapeHtml(field.text)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ol></section></div>
      ${preview.warnings?.length ? `<div class="automation-preview-warnings"><b>Нужно проверить</b><ul>${preview.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      ${options.isDraft ? `<p class="muted">Проверка ничего не меняет. Для ручного запуска сначала сохрани правило, затем нажми «Запустить» на его карточке.</p>` : preview.safe && !options.checkedSample ? `<p class="muted">«Запустить сейчас» действительно выполнит действия${automation.type === "file_added" ? " с выбранным файлом" : ""}.</p><button type="button" class="app-btn primary" data-run-preview="${safeAttr(automation.id)}">Запустить сейчас</button>` : ""}
    </section>`;
  }

  function automationShellHTML() {
    return `<div class="automation-app-shell">
      <div class="automation-app-heading"><div><h2>Автоматизации</h2><p class="muted">Понятные локальные правила: Когда → Если → Тогда.</p></div><div class="automation-heading-actions"><label class="automation-pause-all"><input type="checkbox" data-pause-all> Приостановить все</label><button type="button" class="app-btn primary" data-create-automation>Новая автоматизация</button></div></div>
      <p class="automation-global-error" data-automation-global-error hidden></p>
      <section class="automation-category-panel" aria-label="Категории автоматизаций">
        <label class="automation-field"><span>Категория — правила и история запусков</span><select data-category-filter aria-label="Категория автоматизаций"></select></label>
        <p data-category-summary aria-live="polite"></p>
        <details><summary>Создать, переименовать или удалить категорию</summary>
          <label class="automation-field"><span>Название новой категории или новое имя выбранной</span><input data-category-name maxlength="160" placeholder="Например: Разработка программы Записи экрана"></label>
          <div class="automation-category-actions"><button type="button" data-create-category>Создать категорию</button><button type="button" data-rename-category>Переименовать выбранную</button><button type="button" data-delete-category>Удалить только категорию</button><button type="button" class="danger-btn" data-delete-category-rules>Удалить категорию и правила</button></div>
          <p class="muted">Одно правило относится к одной категории. Удаление только категории переносит правила в «Без категории». Удаление вместе с правилами отменяет их ожидающие запуски, но не удаляет созданные файлы, заметки и прошлую историю.</p>
        </details>
      </section>
      <div class="automation-list-tools"><input type="search" data-automation-search placeholder="Найти автоматизацию" aria-label="Поиск автоматизаций"><select data-automation-status-filter aria-label="Фильтр автоматизаций"><option value="all">Все</option><option value="active">Активные</option><option value="paused">На паузе</option><option value="error">С ошибками</option><option value="broken">Нужно исправить</option></select></div>
      <section class="automation-templates"><div class="automation-section-heading"><div><h3>Шаблоны</h3><p class="muted">Выбери рецепт и заполни недостающие объекты.</p></div></div><div class="automation-template-row" data-automation-templates></div></section>
      <div data-automation-list></div>
      <div data-automation-editor-host hidden></div>
      <div data-automation-preview-host hidden></div>
      <section class="automation-history-panel"><div class="automation-section-heading"><div><h3>История запусков</h3><p class="muted">Результаты и ошибки каждого шага.</p></div><div><select data-history-filter aria-label="Фильтр истории"><option value="all">Все</option><option value="success">Успешно</option><option value="skipped">Пропущено</option><option value="warning">Частично</option><option value="error">Ошибки</option></select><button type="button" class="danger-btn" data-clear-history>Очистить историю</button></div></div><div data-automation-history></div></section>
    </div>`;
  }

  function createAutomationApp(integration = {}) {
    const editorOnly = integration.editorOnly === true;
    const documentRef = integration.document || globalThis.document;
    const getAutomations = typeof integration.getAutomations === "function" ? integration.getAutomations : () => [];
    const setAutomations = typeof integration.setAutomations === "function" ? integration.setAutomations : () => {};
    const saveState = typeof integration.saveState === "function" ? integration.saveState : () => Promise.resolve();
    const commitAutomations = typeof integration.commitAutomations === "function" ? integration.commitAutomations : null;
    const getRuntime = typeof integration.getRuntime === "function" ? integration.getRuntime : () => ({});
    const getCategories = () => normalizeAutomationCategories(integration.getCategories?.());
    let categoryFilter = integration.getCategoryFilter?.() ?? "*";
    const previewAutomation = typeof integration.previewAutomation === "function" ? integration.previewAutomation : value => ({ valid: Boolean(normalizeAutomation(value)), safe: Boolean(normalizeAutomation(value)), verdict: "Готово", conditions: { results: [] }, actions: [], warnings: [], brokenReferences: [], sample: { kind: "system", id: "" } });
    const runAutomation = typeof integration.runAutomation === "function" ? integration.runAutomation : () => Promise.reject(new Error("Ручной запуск недоступен."));
    const setGlobalPaused = typeof integration.setGlobalPaused === "function" ? integration.setGlobalPaused : paused => { getRuntime().paused = paused; return Promise.resolve(paused); };
    const clearHistory = typeof integration.clearHistory === "function" ? integration.clearHistory : () => { getRuntime().history = []; return Promise.resolve(true); };
    const confirmUser = typeof integration.confirmUser === "function" ? integration.confirmUser : () => false;
    const uid = typeof integration.uid === "function" ? integration.uid : prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const notify = typeof integration.toast === "function" ? integration.toast : () => {};
    const root = documentRef.createElement("div");
    root.className = "automation-app";
    root.innerHTML = editorOnly ? `<div class="automation-app-shell automation-editor-window">
      <p class="automation-editor-error" data-automation-global-error role="alert" hidden></p>
      <div data-automation-editor-host></div><div data-automation-preview-host hidden></div>
    </div>` : automationShellHTML();
    const listHost = root.querySelector("[data-automation-list]");
    const editorHost = root.querySelector("[data-automation-editor-host]");
    const previewHost = root.querySelector("[data-automation-preview-host]");
    const historyHost = root.querySelector("[data-automation-history]");
    const templateHost = root.querySelector("[data-automation-templates]");
    const errorHost = root.querySelector("[data-automation-global-error]");
    let search = "";
    let statusFilter = "all";
    let historyFilter = "all";
    let editingDraft = null;
    let previewDraft = null;
    const sampleFiles = new Map();
    let busy = false;

    const sampleKey = (automation, isDraft = false) => `${isDraft ? "draft" : "saved"}:${automation.id}`;
    const selectionFor = (automation, isDraft = false) => automation.type === "file_added" ? { fileId: sampleFiles.get(sampleKey(automation, isDraft)) || "" } : {};
    const contextFor = (automation, isDraft = false) => integration.getSampleContext?.(automation, selectionFor(automation, isDraft)) || selectionFor(automation, isDraft);
    const fileOptionsFor = (automation, isDraft = false) => ({ fileOptions: integration.getFileOptions?.(automation) || [], sampleFileId: sampleFiles.get(sampleKey(automation, isDraft)) || "", sourceFolderId: automation.folderId || "", folderOptions: integration.getFolderOptions?.() || [] });
    const hidePreview = () => { previewDraft = null; previewHost.hidden = true; previewHost.innerHTML = ""; };
    const refreshEditorSample = () => {
      const editor = editorHost.querySelector("[data-automation-editor]");
      if (!editor) return;
      const draft = readAutomationDraft(editor);
      const options = fileOptionsFor(draft, true);
      if (!options.fileOptions.some(file => file.id === options.sampleFileId)) {
        sampleFiles.delete(sampleKey(draft, true));
        options.sampleFileId = "";
      }
      editor.querySelector("[data-file-sample-host]").innerHTML = fileSampleHTML(options);
    };

    const editorOptions = () => ({
      uid,
      categories: getCategories(),
      isNew: !normalizeAutomations(getAutomations()).some(item => item.id === editingDraft?.id),
      eventOptions: integration.getEventOptions?.() || [],
      folderOptions: integration.getFolderOptions?.() || [],
      ...fileOptionsFor(editingDraft || {}, true),
      resolveLabel: integration.resolveLabel
    });
    const setError = message => {
      errorHost.hidden = !message;
      errorHost.textContent = message || "";
      if (message) errorHost.scrollIntoView?.({ block: "nearest" });
    };
    const filteredAutomations = () => normalizeAutomations(getAutomations()).filter(item => {
      const categoryId = getCategories().some(category => category.id === item.categoryId) ? item.categoryId : "";
      if (categoryFilter !== "*" && categoryId !== categoryFilter) return false;
      if (search && !`${item.name} ${automationRuleSummary(item, integration)}`.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU"))) return false;
      if (statusFilter === "all") return true;
      const preview = previewAutomation(item, contextFor(item));
      const status = statusForAutomation(item, normalizeAutomationRuntime(getRuntime()), preview).id;
      return status === statusFilter || (statusFilter === "paused" && status === "global");
    });
    const drawList = () => {
      if (editorOnly) return;
      const runtime = normalizeAutomationRuntime(getRuntime());
      const categories = getCategories();
      if (categoryFilter !== "*" && categoryFilter !== "" && !categories.some(category => category.id === categoryFilter)) {
        categoryFilter = "*";
        integration.setCategoryFilter?.(categoryFilter);
      }
      const all = normalizeAutomations(getAutomations());
      const scope = automationCategoryScope({ automations: all, automationCategories: categories, automationRuntime: runtime }, categoryFilter);
      const options = [{ id: "*", name: "Все категории", count: all.length }, { id: "", name: "Без категории", count: all.filter(item => !categories.some(category => category.id === item.categoryId)).length }, ...categories.map(category => ({ ...category, count: all.filter(item => item.categoryId === category.id).length }))];
      root.querySelector("[data-category-filter]").innerHTML = options.map(category => `<option value="${safeAttr(category.id)}"${category.id === categoryFilter ? " selected" : ""}>${escapeHtml(category.name)} (${category.count})</option>`).join("");
      const selected = categories.find(category => category.id === categoryFilter);
      root.querySelector("[data-category-summary]").textContent = `${selected?.name || (categoryFilter === "" ? "Без категории" : "Все категории")} · Правил: ${scope.automations.length} · Включено: ${scope.automations.filter(item => item.enabled).length}. В сохранённой истории: ${scope.history.length} запусков, успешно: ${scope.history.filter(item => item.status === "success").length}, с ошибками: ${scope.history.filter(item => ["error", "warning"].includes(item.status)).length}.`;
      root.querySelectorAll("[data-rename-category], [data-delete-category], [data-delete-category-rules]").forEach(button => { button.disabled = busy || !selected; });
      root.querySelector("[data-create-category]").disabled = busy;
      root.querySelector("[data-pause-all]").checked = runtime.paused;
      listHost.innerHTML = automationListHTML(filteredAutomations(), { runtime, categories, previewAutomation: item => previewAutomation(item, contextFor(item)), resolveLabel: integration.resolveLabel });
      historyHost.innerHTML = historyHTML({ ...runtime, history: scope.history }, historyFilter);
      root.querySelector("[data-clear-history]").textContent = categoryFilter === "*" ? "Очистить всю историю" : "Очистить историю категории";
      root.querySelector("[data-clear-history]").disabled = busy || !scope.history.length;
    };
    const drawEditor = () => {
      if (!editingDraft) { editorHost.hidden = true; editorHost.innerHTML = ""; return; }
      editorHost.hidden = false;
      editorHost.innerHTML = automationEditorHTML(editingDraft, editorOptions());
      syncAutomationEditorFields(editorHost.querySelector("[data-automation-editor]"));
    };
    const openEditor = value => {
      if (!editorOnly && integration.openEditor) return integration.openEditor(value);
      hidePreview();
      editingDraft = clone(normalizeAutomation(value) || value || defaultDraft(uid));
      sampleFiles.delete(sampleKey(editingDraft, true));
      drawEditor();
      editorHost.querySelector("[data-automation-name]")?.focus?.();
    };
    const hideEditor = () => {
      if (editorOnly) return integration.closeEditor?.();
      editingDraft = null; hidePreview(); drawEditor();
    };
    const mutateEditorRows = change => {
      hidePreview();
      const editor = editorHost.querySelector("[data-automation-editor]");
      if (!editor) return;
      const draft = readAutomationDraft(editor);
      change(draft);
      editingDraft = draft;
      drawEditor();
    };
    const runMutation = async operation => {
      if (busy) return false;
      busy = true;
      if (editorOnly) editorHost.inert = true;
      root.classList.add("is-busy");
      root.setAttribute("aria-busy", "true");
      setError("");
      drawList();
      try {
        const result = await operation();
        drawList();
        return result;
      } catch (error) {
        drawList();
        setError(error?.message || "Изменение не сохранено. Проверь хранилище ZeTer OS.");
        return false;
      } finally {
        busy = false;
        if (editorOnly) editorHost.inert = false;
        root.classList.remove("is-busy");
        root.removeAttribute("aria-busy");
        drawList();
      }
    };
    const commit = next => runMutation(async () => {
      const normalized = normalizeAutomations(next);
      if (commitAutomations) return commitAutomations(normalized);
      const previous = normalizeAutomations(getAutomations());
      setAutomations(normalized);
      try { await Promise.resolve(saveState()); return normalized; }
      catch (error) { setAutomations(previous); throw error; }
    });
    const showPreview = (automation, isDraft = false, scroll = true, consumeSample = false) => {
      const preview = previewAutomation(automation, contextFor(automation, isDraft));
      const checkedSample = consumeSample && automation.type === "file_added" && Boolean(selectionFor(automation, isDraft).fileId);
      if (checkedSample) {
        sampleFiles.delete(sampleKey(automation, isDraft));
        refreshEditorSample();
      }
      previewDraft = { automation: clone(automation), isDraft, checkedSample };
      previewHost.hidden = false;
      previewHost.innerHTML = previewHTML(preview, automation, { ...fileOptionsFor(automation, isDraft), isDraft, checkedSample });
      if (scroll) previewHost.scrollIntoView?.({ block: "nearest" });
      return preview;
    };

    if (templateHost) templateHost.innerHTML = templateCardsHTML(integration.templates || AUTOMATION_TEMPLATES);
    root.addEventListener("click", event => {
      if (busy) return;
      if (event.target?.closest?.("[data-check-sample]")) {
        const editor = event.target.closest("[data-automation-editor]");
        const automation = editor ? readAutomationDraft(editor) : previewDraft?.automation;
        const isDraft = Boolean(editor) || previewDraft?.isDraft === true;
        if (!automation || !selectionFor(automation, isDraft).fileId) return;
        if (editor && !showAutomationEditorError(editor, validateAutomationDraft(automation))) return;
        return showPreview(automation, isDraft, true, true);
      }
      const categoryAction = event.target?.closest?.("[data-create-category], [data-rename-category], [data-delete-category], [data-delete-category-rules]");
      if (categoryAction) {
        const current = getCategories().find(category => category.id === categoryFilter);
        const create = categoryAction.matches("[data-create-category]");
        if (!create && !current) return;
        const remove = categoryAction.matches("[data-delete-category], [data-delete-category-rules]");
        const deleteAutomations = categoryAction.matches("[data-delete-category-rules]");
        const count = normalizeAutomations(getAutomations()).filter(rule => rule.categoryId === current?.id).length;
        if (remove && !confirmUser(deleteAutomations ? `Удалить категорию «${current.name}» и ${count} автоматизаций? Их ожидающие запуски будут отменены. Для восстановления настроек правил потребуется резервная копия. Созданные файлы, заметки и история сохранятся.` : `Удалить только категорию «${current.name}»? ${count} автоматизаций перейдут в «Без категории», история сохранится.`)) return;
        const change = { type: create ? "create" : remove ? "delete" : "rename", id: create ? uid("automation_category") : current.id, name: root.querySelector("[data-category-name]").value, deleteAutomations };
        void runMutation(() => integration.mutateCategory ? integration.mutateCategory(change) : Promise.reject(new Error("Сохранение категорий недоступно."))).then(result => {
          if (result !== false) { root.querySelector("[data-category-name]").value = ""; notify("Категории обновлены", "Изменение сохранено."); }
        });
        return;
      }
      if (event.target?.closest?.("[data-close-preview]")) return hidePreview();
      if (event.target?.closest?.("[data-open-source-folder], [data-open-sample-file], [data-refresh-sample-files]")) {
        const editor = event.target.closest("[data-automation-editor]");
        const automation = editor ? readAutomationDraft(editor) : previewDraft?.automation;
        if (!automation) return;
        const fileId = selectionFor(automation, Boolean(editor) || previewDraft?.isDraft === true).fileId;
        if (event.target.closest("[data-open-source-folder]")) return integration.openSourceFolder?.(automation.folderId || "", fileId);
        if (event.target.closest("[data-open-sample-file]")) return integration.openSampleFile?.(automation.folderId || "", fileId);
        refreshEditorSample();
        if (previewDraft) showPreview(previewDraft.automation, previewDraft.isDraft, false);
        return;
      }
      const action = automationClickAction(event.target);
      if (!action || busy) return;
      const all = normalizeAutomations(getAutomations());
      const current = all.find(item => item.id === action.id);
      if (action.type === "create") return openEditor({ ...defaultDraft(uid), categoryId: categoryFilter === "*" ? "" : categoryFilter });
      if (action.type === "template") {
        const template = (integration.templates || AUTOMATION_TEMPLATES).find(item => item.id === action.id);
        const draft = typeof automationTemplateDraft === "function" ? automationTemplateDraft(action.id) : clone(template?.draft || {});
        return openEditor({ ...draft, id: uid("automation"), categoryId: categoryFilter === "*" ? "" : categoryFilter, name: draft?.name || template?.title || "Новая автоматизация" });
      }
      if (action.type === "edit" && current) return openEditor(current);
      if (action.type === "cancel") return hideEditor();
      if (action.type === "add-condition") return mutateEditorRows(draft => draft.conditions.push({ id: uid("automation_condition"), type: [...allowedConditionTypes(draft.type)][0] || "object_exists", operator: "eq", value: "" }));
      if (action.type === "remove-condition") return mutateEditorRows(draft => draft.conditions.splice(Number(action.id), 1));
      if (action.type === "add-action") return mutateEditorRows(draft => draft.actions.push({ id: uid("automation_action"), type: "notify", title: "ZeTer OS", text: "", onError: "stop" }));
      if (action.type === "remove-action") return mutateEditorRows(draft => { if (draft.actions.length > 1) draft.actions.splice(Number(action.id), 1); });
      if (["move-action-up", "move-action-down"].includes(action.type)) return mutateEditorRows(draft => {
        const from = Number(action.id);
        const to = action.type === "move-action-up" ? from - 1 : from + 1;
        if (to < 0 || to >= draft.actions.length) return;
        [draft.actions[from], draft.actions[to]] = [draft.actions[to], draft.actions[from]];
      });
      if (action.type === "preview-editor") {
        const editor = editorHost.querySelector("[data-automation-editor]");
        const draft = readAutomationDraft(editor);
        if (!showAutomationEditorError(editor, validateAutomationDraft(draft))) return;
        editingDraft = draft;
        return showPreview(draft, true, true, true);
      }
      if (action.type === "save") {
        const editor = editorHost.querySelector("[data-automation-editor]");
        const draft = readAutomationDraft(editor);
        if (!showAutomationEditorError(editor, validateAutomationDraft(draft))) return;
        const normalized = normalizeAutomation(draft);
        if (!normalized) return setError("Правило не прошло проверку.");
        const next = all.filter(item => item.id !== normalized.id).concat(normalized);
        const saving = integration.saveDraft
          ? runMutation(() => integration.saveDraft(draft))
          : commit(next);
        void saving.then(saved => {
          if (saved !== false) {
            if (editorOnly) integration.onSaved?.(normalized);
            else hideEditor();
            notify("Автоматизация сохранена", normalized.name);
          }
        });
        return;
      }
      if (action.type === "delete" && current && confirmUser(`Удалить автоматизацию «${current.name}»?`)) {
        void commit(all.filter(item => item.id !== current.id)).then(saved => { if (saved !== false && editingDraft?.id === current.id) hideEditor(); });
        return;
      }
      if (action.type === "duplicate" && current) {
        const copy = { ...clone(current), id: uid("automation"), name: `${current.name} — копия`, enabled: false, lastRunKey: "", lastError: "", pausedReason: "" };
        void commit([...all, copy]).then(saved => { if (saved !== false) notify("Автоматизация скопирована", copy.name); });
        return;
      }
      if (action.type === "preview" && current) return showPreview(current);
      if (action.type === "run" && current) {
        const fromPreview = Boolean(event.target.closest("[data-run-preview]"));
        if (current.type === "file_added" && !fromPreview) { showPreview(current); return; }
        if (fromPreview && (!previewDraft || previewDraft.isDraft || previewDraft.checkedSample || previewDraft.automation.id !== current.id)) return;
        const preview = showPreview(current);
        if (!preview.safe) return setError(preview.warnings?.[0] || "Сначала исправь правило.");
        const runContext = current.type === "file_added" ? selectionFor(current) : contextFor(current);
        hidePreview();
        void runMutation(() => runAutomation(current.id, runContext)).then(result => { if (result !== false) notify("Автоматизация запущена", result.message || current.name); });
        return;
      }
      if (action.type === "clear-history" && confirmUser(categoryFilter === "*" ? "Очистить всю историю запусков? Правила и объекты сохранятся." : "Очистить историю выбранной категории для всех статусов? Правила и объекты сохранятся.")) {
        void runMutation(() => clearHistory(categoryFilter));
      }
    });

    root.addEventListener("input", event => {
      if (event.target?.closest?.("[data-automation-editor]") && !event.target.matches("[data-automation-sample-file]")) hidePreview();
      const action = automationChangeAction(event.target);
      if (action?.type === "search") { search = action.value; drawList(); }
    });
    root.addEventListener("change", event => {
      if (event.target?.matches?.("[data-category-filter]")) {
        if (busy) return;
        categoryFilter = event.target.value;
        integration.setCategoryFilter?.(categoryFilter);
        root.querySelector("[data-category-name]").value = getCategories().find(category => category.id === categoryFilter)?.name || "";
        drawList();
        return;
      }
      const action = automationChangeAction(event.target);
      if (!action || busy) return;
      if (action.type === "sample-file") {
        const editor = event.target.closest("[data-automation-editor]");
        const automation = editor ? readAutomationDraft(editor) : previewDraft?.automation;
        if (!automation) return;
        sampleFiles.set(sampleKey(automation, Boolean(editor) || previewDraft?.isDraft === true), action.value);
        refreshEditorSample();
        if (previewDraft) showPreview(previewDraft.automation, previewDraft.isDraft, false);
        return;
      }
      if (action.type === "filter") { statusFilter = action.value; return drawList(); }
      if (action.type === "history-filter") { historyFilter = action.value; return drawList(); }
      if (action.type === "pause-all") {
        void runMutation(() => setGlobalPaused(action.paused)).then(result => { if (result !== false) notify(action.paused ? "Автоматизации приостановлены" : "Автоматизации продолжены", "Настройка сохранена."); });
        return;
      }
      if (action.type === "enabled") {
        const next = normalizeAutomations(getAutomations()).map(item => item.id === action.id ? { ...item, enabled: action.enabled } : item);
        void commit(next);
        return;
      }
      if (action.type === "editor-change") {
        hidePreview();
        syncAutomationEditorFields(editorHost.querySelector("[data-automation-editor]"));
        if (event.target.matches("[data-automation-folder-id], [data-automation-trigger]")) {
          sampleFiles.delete(sampleKey(editingDraft || {}, true));
          refreshEditorSample();
        }
      }
    });

    drawList();
    if (editorOnly) {
      if (integration.initialError) {
        setError(integration.initialError);
        editorHost.innerHTML = `<button type="button" data-cancel-automation>Вернуться к автоматизациям</button>`;
      } else openEditor(integration.initialDraft || defaultDraft(uid));
    }
    return root;
  }

  window.ZETER_AUTOMATION_UI_UTILS = Object.freeze({
    triggerSummary,
    conditionSummary,
    actionSummary,
    automationRuleSummary,
    automationCardHTML,
    automationListHTML,
    automationEditorHTML,
    readAutomationDraft,
    validateAutomationDraft,
    showAutomationEditorError,
    syncAutomationEditorFields,
    automationClickAction,
    automationChangeAction,
    automationShellHTML,
    templateCardsHTML,
    historyHTML,
    previewHTML,
    createAutomationApp
  });
})();
