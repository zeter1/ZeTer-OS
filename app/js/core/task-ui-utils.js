(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS task UI utils require core utils.");

  const { escapeHtml } = coreUtils;
  const { validProjectDue } = window.ZETER_PROJECT_OVERVIEW_UTILS;
  const safeAttr = escapeHtml;

  const TASK_BOARD_COLUMNS = Object.freeze([
    Object.freeze(["todo", "Нужно сделать"]),
    Object.freeze(["doing", "В работе"]),
    Object.freeze(["review", "На проверке"]),
    Object.freeze(["done", "Готово"])
  ]);

  function taskStoreFromParams(params = {}, options = {}) {
    const state = options.state || {};
    const fs = state.fs || {};
    const currentWorkspace = typeof options.currentWorkspace === "function" ? options.currentWorkspace : () => ({});
    const normalizeTaskStore = typeof options.normalizeTaskStore === "function" ? options.normalizeTaskStore : store => store;
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : () => "Рабочий стол";
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const item = params.itemId ? fs[params.itemId] : null;
    if (item?.type === "tasklist") {
      normalizeTaskStore(item);
      return {
        kind: "tasklist",
        item,
        title: item.name || "Список задач",
        tasks: () => item.tasks,
        setTasks: next => { item.tasks = Array.isArray(next) ? next : []; normalizeTaskStore(item); },
        projects: () => item.taskProjects,
        activeProjectId: () => item.activeTaskProjectId,
        setActiveProjectId: id => { item.activeTaskProjectId = id; normalizeTaskStore(item); },
        touch: () => { item.updatedAt = Date.now(); }
      };
    }
    const ws = currentWorkspace();
    normalizeTaskStore(ws);
    return {
      kind: "workspace",
      item: null,
      workspace: ws,
      title: desktopName(getDesktopRoot()),
      tasks: () => ws.tasks,
      setTasks: next => { ws.tasks = Array.isArray(next) ? next : []; normalizeTaskStore(ws); },
      projects: () => ws.taskProjects,
      activeProjectId: () => ws.activeTaskProjectId,
      setActiveProjectId: id => { ws.activeTaskProjectId = id; normalizeTaskStore(ws); },
      touch: () => {}
    };
  }

  function taskEditorStoreFromParams(params = {}, options = {}) {
    if (params.itemId) {
      const item = options.state?.fs?.[params.itemId];
      if (!item || item.type !== "tasklist") return null;
      return taskStoreFromParams({ itemId: params.itemId }, options);
    }
    return taskStoreFromParams({}, options);
  }

  function uniqueTaskTags(tasks = []) {
    return [...new Set(tasks.map(task => task?.tag).filter(Boolean))];
  }

  function taskMatchesBoardFilter(task = {}, filter = {}) {
    if (filter.hideCompleted && task.status === "done") return false;
    const q = String(filter.q || "").toLowerCase();
    const priority = filter.priority || "all";
    const tag = filter.tag || "all";
    if (filter.categoryId === "none" && task.categoryId) return false;
    if (filter.categoryId && !["all", "none"].includes(filter.categoryId) && task.categoryId !== filter.categoryId) return false;
    const haystack = `${task.title || ""} ${task.description || ""} ${task.tag || ""}`.toLowerCase();
    const today = filter.today || new Date().toLocaleDateString("sv-SE");
    const hasDue = !task.indefinite && validProjectDue(task.due);
    if (filter.deadline === "overdue" && (!hasDue || task.status === "done" || task.due >= today)) return false;
    if (filter.deadline === "today" && (!hasDue || task.status === "done" || task.due !== today)) return false;
    if (filter.deadline === "undated" && (hasDue || task.status === "done")) return false;
    if (filter.deadline === "week") {
      const end = new Date(`${today}T12:00:00`); end.setDate(end.getDate() + 6);
      const lastDay = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
      if (!hasDue || task.status === "done" || task.due < today || task.due > lastDay) return false;
    }
    return (!q || haystack.includes(q)) &&
      (priority === "all" || task.priority === priority) &&
      (tag === "all" || task.tag === tag);
  }

  function filterTasksForBoard(tasks = [], filter = {}) {
    return (Array.isArray(tasks) ? tasks : []).filter(task => taskMatchesBoardFilter(task, filter));
  }

  function sortTasksForBoard(tasks = [], filter = {}) {
    return [...(Array.isArray(tasks) ? tasks : [])].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return (Number(b.pinnedAt) || 0) - (Number(a.pinnedAt) || 0);
      let order = 0;
      if (filter.sortBy === "due") {
        const due = task => !task.indefinite && /^\d{4}-\d{2}-\d{2}$/.test(task.due || "") ? task.due : "9999-99-99";
        order = due(a).localeCompare(due(b));
      }
      if (filter.sortBy === "priority") order = ({ high: 0, medium: 1, low: 2 }[a.priority] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority] ?? 1);
      if (filter.sortBy === "title") order = String(a.title || "").localeCompare(String(b.title || ""), "ru", { numeric: true, sensitivity: "base" });
      if (order) return order;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  }

  function taskBoardColumnTasks(tasks = [], status = "", filter = {}) {
    return sortTasksForBoard(filterTasksForBoard(tasks, filter).filter(task => task.status === status), filter);
  }

  function taskBoardGroups(tasks = [], filter = {}, includeEmpty = true) {
    const visible = sortTasksForBoard(filterTasksForBoard(tasks, filter), filter);
    return TASK_BOARD_COLUMNS.map(([status, name]) => ({ status, name, tasks: visible.filter(task => task.status === status) }))
      .filter(group => includeEmpty || group.tasks.length);
  }

  function taskTagOptionsHTML(tags = []) {
    return `<option value="all">Все теги</option>${tags
      .map(tag => `<option value="${safeAttr(tag)}">${escapeHtml(tag)}</option>`)
      .join("")}`;
  }

  function taskProjectTabsHTML(projects = [], activeId = "", tasks = []) {
    return projects.map(project => {
      const count = tasks.filter(task => task.projectId === project.id).length;
      const completed = tasks.filter(task => task.projectId === project.id && task.status === "done").length;
      return `<button type="button" class="task-project-tab ${project.id === activeId ? "active" : ""}" aria-pressed="${project.id === activeId}" data-project-color="${safeAttr(project.color || "default")}" data-project-id="${safeAttr(project.id)}"><span>${escapeHtml(project.name)}</span><b title="Всего задач: ${count}; выполнено: ${completed}">${count}</b></button>`;
    }).join("");
  }

  function taskProjectOptionsHTML(projects = [], selectedId = "") {
    return projects
      .map(project => `<option value="${safeAttr(project.id)}" ${project.id === selectedId ? "selected" : ""}>${escapeHtml(project.name)}</option>`)
      .join("");
  }

  function taskCategoryOptionsHTML(categories = [], selectedId = "", filter = false) {
    const options = filter ? [{ id: "all", name: "Все категории" }, { id: "none", name: "Без категории" }, ...categories] : [{ id: "", name: "Без категории" }, ...categories];
    return options.map(category => `<option value="${safeAttr(category.id)}" ${category.id === selectedId ? "selected" : ""}>${escapeHtml(category.name)}</option>`).join("");
  }

  function tasksAppShellHTML() {
    return `
      <aside class="task-projects" aria-label="Проекты">
        <div class="task-projects-head"><b>Проекты</b><button type="button" data-project-add aria-label="Создать проект" title="Создать проект">Создать проект</button></div>
        <div class="task-project-list"></div>
      </aside>
      <main class="task-workspace">
        <header class="task-workspace-head"><div class="task-project-heading"><small>ТЕКУЩИЙ ПРОЕКТ</small><h2 data-current-project-name></h2><p data-current-project-summary></p><p class="task-project-description" data-project-description hidden></p></div><div class="task-header-actions"><details class="task-project-settings"><summary title="Настройки выбранного проекта">⚙ Настройки проекта</summary><div class="task-project-actions"><button type="button" data-project-configure>Все настройки…</button><button type="button" data-project-rename>Переименовать</button><button type="button" data-project-delete>Удалить проект</button></div></details><button class="app-btn primary" data-open-task-create>+ Добавить задачу</button></div></header>
        <div class="task-view-bar"><div class="task-view-switch" role="group" aria-label="Представление проекта"><button type="button" data-project-view="overview" aria-pressed="false">Обзор</button><button type="button" data-project-view="board" aria-pressed="true">Доска</button><button type="button" data-project-view="list" aria-pressed="false">Список</button></div><button type="button" class="task-export" data-export-tasks title="Скачать все проекты и задачи этого списка">Скачать все задачи</button></div>
        <div class="task-category-bar"><label>Категория задач<select data-filter-category aria-label="Категория задач"></select></label><button type="button" class="app-btn" data-category-add>+ Создать категорию</button></div>
        <div class="task-filters" data-task-filters>
          <div class="toolbar"><input type="search" data-filter-q aria-label="Поиск задач в проекте" placeholder="Найти задачу…"><select data-filter-priority aria-label="Фильтр приоритета"><option value="all">Все приоритеты</option><option value="high">Высокий</option><option value="medium">Средний</option><option value="low">Низкий</option></select><select data-filter-tag aria-label="Фильтр тега"><option value="all">Все теги</option></select></div>
          <div class="task-deadline-filters" role="group" aria-label="Фильтр срока"><button type="button" data-task-deadline="all" aria-pressed="true">Все задачи</button><button type="button" data-task-deadline="today" aria-pressed="false">На сегодня</button><button type="button" data-task-deadline="week" aria-pressed="false">На 7 дней</button><button type="button" data-task-deadline="overdue" aria-pressed="false">Просрочено</button><button type="button" data-task-deadline="undated" aria-pressed="false">Без срока</button><span data-task-visible-count role="status"></span></div>
        </div>
        <div class="task-board" aria-label="Задачи проекта"></div>
        <section class="project-overview" data-project-overview hidden aria-label="Обзор проекта"></section>
      </main>`;
  }

  function taskColumnHeaderHTML(name, count) {
    return `<h3>${escapeHtml(name)}<span class="pill">${count}</span></h3><div class="task-list"></div>`;
  }

  function taskPriorityOptionsHTML(selectedPriority, priorityName) {
    const label = typeof priorityName === "function" ? priorityName : value => value;
    return ["low", "medium", "high"]
      .map(priority => `<option value="${priority}" ${selectedPriority === priority ? "selected" : ""}>${escapeHtml(label(priority))}</option>`)
      .join("");
  }

  function taskCardPointerLocksDrag(target) {
    return Boolean(target?.closest?.("button,input,select,label,summary,.task-reminder-editor"));
  }

  function taskCardClickAction(target) {
    if (target?.closest?.("[data-priority-button]")) return { type: "show-priority-select" };
    if (target?.closest?.("[data-delete]")) return { type: "delete" };
    if (target?.closest?.("[data-edit]")) return { type: "edit" };
    if (target?.closest?.("[data-pin]")) return { type: "pin" };
    if (target?.closest?.("[data-toggle-indefinite]")) return { type: "toggle-indefinite" };
    if (target?.closest?.("[data-reminder]")) return { type: "toggle-reminder-editor" };
    if (target?.closest?.("[data-reminder-save]")) return { type: "save-reminder" };
    if (target?.closest?.("[data-reminder-remove]")) return { type: "remove-reminder" };
    return null;
  }

  function taskBoardClickAction(target) {
    const projectBtn = target?.closest?.("[data-project-id]");
    if (projectBtn) return { type: "select-project", projectId: projectBtn.dataset.projectId || "" };
    if (target?.closest?.("[data-open-task-create]")) return { type: "open-create" };
    if (target?.closest?.("[data-project-add]")) return { type: "add-project" };
    if (target?.closest?.("[data-project-rename]")) return { type: "rename-project" };
    if (target?.closest?.("[data-project-configure]")) return { type: "configure-project" };
    if (target?.closest?.("[data-project-delete]")) return { type: "delete-project" };
    if (target?.closest?.("[data-export-tasks]")) return { type: "export-tasks" };
    return null;
  }

  function taskBoardInputAction(target) {
    if (target?.matches?.("[data-filter-q]")) return { type: "filter-query", value: target.value || "" };
    return null;
  }

  function taskBoardChangeAction(target) {
    if (target?.matches?.("[data-filter-priority]")) return { type: "filter-priority", value: target.value || "all" };
    if (target?.matches?.("[data-filter-tag]")) return { type: "filter-tag", value: target.value || "all" };
    if (target?.matches?.("[data-filter-category]")) return { type: "filter-category", value: target.value || "all" };
    return null;
  }

  function taskReminderPillHTML(task = {}, helpers = {}) {
    const taskReminderTime = typeof helpers.taskReminderTime === "function" ? helpers.taskReminderTime : () => 0;
    const taskReminderLabel = typeof helpers.taskReminderLabel === "function" ? helpers.taskReminderLabel : value => value || "";
    const normalizeRepeatDays = typeof helpers.normalizeTaskReminderRepeatDays === "function"
      ? helpers.normalizeTaskReminderRepeatDays
      : () => 0;
    const taskReminderRepeatLabel = typeof helpers.taskReminderRepeatLabel === "function" ? helpers.taskReminderRepeatLabel : () => "";

    const reminderTime = taskReminderTime(task.reminderAt);
    const reminderLabel = taskReminderLabel(task.reminderAt);
    const reminderRepeatDays = normalizeRepeatDays(task.reminderRepeatDays);
    const reminderRepeatText = taskReminderRepeatLabel(reminderRepeatDays);
    const reminderDone = reminderTime && !reminderRepeatDays && Number(task.reminderNotifiedAt || 0) >= reminderTime;
    const reminderPast = reminderTime && reminderTime <= Date.now();

    if (!reminderLabel) return "";
    return `<span class="pill task-reminder-pill ${reminderDone ? "sent" : reminderPast ? "due" : ""}">🔔 ${escapeHtml(reminderLabel)}${reminderRepeatText ? ` · ${escapeHtml(reminderRepeatText)}` : ""}${reminderDone ? " · отправлено" : ""}</span>`;
  }

  function taskCardContentHTML(task = {}, helpers = {}) {
    const priorityName = typeof helpers.priorityName === "function" ? helpers.priorityName : value => value;
    const formatDate = typeof helpers.formatDate === "function" ? helpers.formatDate : value => value;
    const normalizeRepeatDays = typeof helpers.normalizeTaskReminderRepeatDays === "function"
      ? helpers.normalizeTaskReminderRepeatDays
      : () => 0;
    const defaultTaskReminderValue = typeof helpers.defaultTaskReminderValue === "function" ? helpers.defaultTaskReminderValue : () => "";

    const checklist = Array.isArray(task.checklist) ? task.checklist : [];
    const doneSubs = checklist.filter(item => item.done).length;
    const subs = checklist.length;
    const reminderRepeatDays = normalizeRepeatDays(task.reminderRepeatDays);
    const repeatInputValue = reminderRepeatDays ? String(reminderRepeatDays) : "";
    const priorityOptions = taskPriorityOptionsHTML(task.priority, priorityName);
    const reminderPill = taskReminderPillHTML(task, helpers);
    const indefinitePill = task.indefinite ? `<span class="pill task-endless-pill">∞ Бессрочная</span>` : "";
    const progress = subs ? `<div class="progress"><span style="width:${doneSubs / subs * 100}%"></span></div>` : "";
    const checklistHTML = checklist
      .map(item => `<label><input type="checkbox" data-sub="${safeAttr(item.id)}" ${item.done ? "checked" : ""}>${escapeHtml(item.text)}</label>`)
      .join("");

    const statusOptions = TASK_BOARD_COLUMNS.map(([id, label]) => `<option value="${id}" ${task.status === id ? "selected" : ""}>${label}</option>`).join("");
    return `<h4><button type="button" class="task-card-title" data-edit>${escapeHtml(task.title)}</button></h4><select class="task-card-status" data-task-status aria-label="Статус задачи ${safeAttr(task.title)}">${statusOptions}</select><p>${escapeHtml(task.description || "")}</p><div class="task-meta">${task.pinned ? `<span class="pill pinned-pill">📌 Закреплена</span>` : ""}<span class="task-priority-wrap"><button type="button" class="pill task-priority-pill ${safeAttr(task.priority)}" data-priority-button title="Изменить приоритет">${escapeHtml(priorityName(task.priority))}</button><select class="task-priority-select hidden ${safeAttr(task.priority)}" data-priority-select aria-label="Приоритет задачи">${priorityOptions}</select></span>${task.due && !task.indefinite ? `<span class="pill">📅 ${escapeHtml(formatDate(task.due))}</span>` : ""}${indefinitePill}${reminderPill}${task.tag ? `<span class="pill">#${escapeHtml(task.tag)}</span>` : ""}</div>${subs ? `<small class="task-checklist-count">Чек-лист: ${doneSubs} из ${subs}</small>` : ""}${progress}<div class="checklist">${checklistHTML}</div><div class="task-actions" role="group" aria-label="Действия задачи"><button data-edit>Редактировать</button><button data-pin>${task.pinned ? "Открепить" : "Закрепить"}</button><button data-toggle-indefinite>${task.indefinite ? "Поставить срок" : "Бессрочная"}</button><button data-reminder>${task.reminderAt ? "Изменить уведомление" : "Уведомить"}</button><button data-delete>Удалить</button></div><div class="task-reminder-editor hidden" data-reminder-editor><label>Дата и время уведомления<input type="datetime-local" data-reminder-input value="${escapeHtml(defaultTaskReminderValue(task))}"></label><label>Повтор через дней<input type="number" min="0" max="3650" step="1" data-reminder-repeat value="${escapeHtml(repeatInputValue)}" placeholder="0"></label><button data-reminder-save>Сохранить</button>${task.reminderAt ? `<button data-reminder-remove>Убрать</button>` : ""}</div>`;
  }

  function taskMissingStoreHTML(title, text, closeLabel = "Закрыть") {
    return `<div class="workspace-note"><b>${escapeHtml(title)}</b><br>${escapeHtml(text)}</div><div class="task-editor-actions"><button class="app-btn" data-cancel>${escapeHtml(closeLabel)}</button></div>`;
  }

  function taskCreateEditorHTML(projectOptionsHTML = "", defaultDue = "") {
    return `
        <div class="task-editor-grid">
          <label class="task-editor-field full">Название задачи
            <input data-task-title value="" placeholder="Новая задача">
          </label>
          <label class="task-editor-field">Проект
            <select data-task-project>${projectOptionsHTML}</select>
          </label>
          <label class="task-editor-field">Приоритет
            <select data-task-priority><option value="low">Низкий</option><option value="medium" selected>Средний</option><option value="high">Высокий</option></select>
          </label>
          <label class="task-editor-field">Срок
            <div class="task-due-control">
              <input data-task-due type="date" value="${escapeHtml(defaultDue)}">
              <button type="button" data-create-indefinite aria-pressed="false" title="Сделать задачу бессрочной">Бессрочная</button>
            </div>
          </label>
          <label class="task-editor-field">Статус
            <select data-task-status><option value="todo">Нужно сделать</option><option value="doing">В работе</option><option value="review">На проверке</option><option value="done">Готово</option></select>
          </label>
          <label class="task-editor-field full">Тег
            <input data-task-tag value="" placeholder="Тег">
          </label>
          <label class="task-editor-field full">Категория<select data-task-category></select></label>
          <label class="task-editor-field full">Описание задачи
            <textarea data-task-description placeholder="Описание задачи"></textarea>
          </label>
        </div>
        <div class="editor-status task-editor-status">
          <span>Ctrl+Enter — добавить · Esc — отменить</span>
          <div class="task-editor-actions">
            <button class="app-btn primary" data-save>Добавить</button>
            <button class="app-btn" data-cancel>Отменить</button>
          </div>
        </div>`;
  }

  function taskEditEditorHTML(task = {}, categories = []) {
    return `
      <input class="editor-title task-editor-title" data-task-title value="${escapeHtml(task.title || "")}" placeholder="Название задачи">
      <label class="task-editor-category">Категория<select data-task-category>${taskCategoryOptionsHTML(categories, task.categoryId)}</select></label>
      <textarea class="editor-area task-editor-description" data-task-description placeholder="Описание задачи">${escapeHtml(task.description || "")}</textarea>
      <div class="editor-status task-editor-status">
        <span>Ctrl+Enter — сохранить · Esc — отменить</span>
        <div class="task-editor-actions">
          <button class="app-btn primary" data-save>Сохранить</button>
          <button class="app-btn" data-cancel>Отменить</button>
        </div>
      </div>`;
  }

  function taskCreateFormData(root, fallbackProjectId = "") {
    const find = selector => root?.querySelector?.(selector);
    const indefinite = find("[data-create-indefinite]")?.dataset.active === "1";
    return {
      title: String(find("[data-task-title]")?.value || "").trim(),
      projectId: find("[data-task-project]")?.value || fallbackProjectId,
      description: String(find("[data-task-description]")?.value || "").trim(),
      priority: find("[data-task-priority]")?.value || "medium",
      due: indefinite ? "" : (find("[data-task-due]")?.value || ""),
      tag: String(find("[data-task-tag]")?.value || "").trim(),
      categoryId: find("[data-task-category]")?.value || "",
      status: find("[data-task-status]")?.value || "todo",
      indefinite
    };
  }

  function taskEditFormData(root) {
    const find = selector => root?.querySelector?.(selector);
    return {
      title: String(find("[data-task-title]")?.value || "").trim(),
      description: find("[data-task-description]")?.value || "",
      categoryId: find("[data-task-category]")?.value || ""
    };
  }

  function taskEditorClickAction(target) {
    if (target?.closest?.("[data-save]")) return { type: "save" };
    if (target?.closest?.("[data-cancel]")) return { type: "cancel" };
    if (target?.closest?.("[data-create-indefinite]")) return { type: "toggle-create-indefinite" };
    return null;
  }

  function taskEditorKeyAction(event) {
    if (event?.key === "Escape") return { type: "cancel" };
    if ((event?.ctrlKey || event?.metaKey) && event?.key === "Enter") return { type: "save" };
    return null;
  }

  function toggleTaskCreateIndefinite(root, fallbackDue = "", nextActive = null) {
    const button = root?.querySelector?.("[data-create-indefinite]");
    const dueInput = root?.querySelector?.("[data-task-due]");
    if (!button) return false;
    const wasActive = button.dataset.active === "1";
    const active = nextActive === null ? !wasActive : Boolean(nextActive);
    button.dataset.active = active ? "1" : "0";
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    if (dueInput) {
      if (active && !wasActive && dueInput.value) dueInput.dataset.lastDue = dueInput.value;
      dueInput.disabled = false;
      dueInput.value = active ? "" : (dueInput.value || dueInput.dataset.lastDue || fallbackDue);
      if (!active) dueInput.focus();
    }
    return active;
  }

  window.ZETER_TASK_UI_UTILS = Object.freeze({
    TASK_BOARD_COLUMNS,
    taskStoreFromParams,
    taskEditorStoreFromParams,
    uniqueTaskTags,
    taskMatchesBoardFilter,
    filterTasksForBoard,
    sortTasksForBoard,
    taskBoardColumnTasks,
    taskBoardGroups,
    taskTagOptionsHTML,
    taskProjectTabsHTML,
    taskProjectOptionsHTML,
    taskCategoryOptionsHTML,
    tasksAppShellHTML,
    taskColumnHeaderHTML,
    taskPriorityOptionsHTML,
    taskCardPointerLocksDrag,
    taskCardClickAction,
    taskBoardClickAction,
    taskBoardInputAction,
    taskBoardChangeAction,
    taskReminderPillHTML,
    taskCardContentHTML,
    taskMissingStoreHTML,
    taskCreateEditorHTML,
    taskEditEditorHTML,
    taskCreateFormData,
    taskEditFormData,
    taskEditorClickAction,
    taskEditorKeyAction,
    toggleTaskCreateIndefinite
  });
})();
