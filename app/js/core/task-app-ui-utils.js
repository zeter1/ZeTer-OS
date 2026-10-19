(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  const taskUiUtils = window.ZETER_TASK_UI_UTILS;
  if (!coreUtils || !dataNormalizers || !taskUiUtils) {
    throw new Error("ZeTer OS task app UI utils require core, data normalizers and task UI utils.");
  }

  const { $ } = coreUtils;
  const {
    normalizeTaskReminderValue,
    taskReminderTime,
    taskReminderLabel,
    priorityName,
    normalizeTaskReminderRepeatDays,
    taskReminderRepeatLabel,
    defaultTaskReminderValue,
    makeTaskProject,
    makeTask,
    updateTaskTitleDescription,
    updateTaskPriority,
    updateTaskChecklistItem,
    toggleTaskPinned,
    setTaskIndefinite,
    setTaskReminder,
    clearTaskReminder,
    normalizeTaskStore
  } = dataNormalizers;
  const { normalizeTaskProjectSettings, normalizeTaskProjectColor, taskProjectColorCSS } = dataNormalizers;
  const {
    TASK_BOARD_COLUMNS,
    taskStoreFromParams,
    taskEditorStoreFromParams,
    uniqueTaskTags,
    taskBoardGroups,
    taskTagOptionsHTML,
    taskProjectTabsHTML,
    taskProjectOptionsHTML,
    taskCategoryOptionsHTML,
    tasksAppShellHTML,
    taskColumnHeaderHTML,
    taskCardPointerLocksDrag,
    taskCardClickAction,
    taskBoardClickAction,
    taskBoardInputAction,
    taskBoardChangeAction,
    taskCardContentHTML,
    taskMissingStoreHTML,
    taskCreateEditorHTML,
    taskEditEditorHTML,
    taskCreateFormData,
    taskEditFormData,
    taskEditorClickAction,
    taskEditorKeyAction,
    toggleTaskCreateIndefinite
  } = taskUiUtils;

  function taskProjectDeletionPlan(projects = [], tasks = [], projectId = "") {
    const currentProjects = Array.isArray(projects) ? projects : [];
    const currentTasks = Array.isArray(tasks) ? tasks : [];
    const project = currentProjects.find(item => item?.id === projectId) || null;
    if (!project || currentProjects.length <= 1) return null;
    const nextProjects = currentProjects.filter(item => item?.id !== projectId);
    return {
      project,
      count: currentTasks.filter(task => task?.projectId === projectId).length,
      nextProjects,
      nextActive: nextProjects[0],
      nextTasks: currentTasks.filter(task => task?.projectId !== projectId)
    };
  }

  function applyTaskBoardFilterAction(filter = {}, action = null) {
    if (!action) return false;
    if (action.type === "filter-query") filter.q = action.value;
    else if (action.type === "filter-priority") filter.priority = action.value;
    else if (action.type === "filter-tag") filter.tag = action.value;
    else if (action.type === "filter-category") filter.categoryId = action.value;
    else return false;
    return true;
  }

  function taskStoreSnapshot(store, currentWorkspace = () => ({})) {
    const target = store?.item || currentWorkspace();
    return {
      tasks: structuredClone(target.tasks || []),
      taskProjects: structuredClone(target.taskProjects || []),
      activeTaskProjectId: target.activeTaskProjectId,
      updatedAt: target.updatedAt,
      navigationRevision: taskProjectNavigationStates.get(target)?.revision || 0
    };
  }

  function restoreTaskStoreSnapshot(store, snapshot, currentWorkspace = () => ({})) {
    if (!store || !snapshot) return;
    const target = store.item || currentWorkspace();
    target.tasks = snapshot.tasks;
    target.taskProjects = snapshot.taskProjects;
    if ((taskProjectNavigationStates.get(target)?.revision || 0) === (snapshot.navigationRevision || 0)) target.activeTaskProjectId = snapshot.activeTaskProjectId;
    if (store.item) target.updatedAt = snapshot.updatedAt;
  }

  const taskProjectNavigationStates = new WeakMap();
  const taskSaveCompletions = new WeakMap();
  const taskStoreSaveLocks = {
    has: target => taskSaveCompletions.has(target),
    add(target) {
      if (taskSaveCompletions.has(target)) return;
      let finish;
      const done = new Promise(resolve => { finish = resolve; });
      taskSaveCompletions.set(target, { done, finish });
    },
    delete(target) {
      const pending = taskSaveCompletions.get(target);
      taskSaveCompletions.delete(target);
      pending?.finish();
    },
    wait: target => taskSaveCompletions.get(target)?.done || Promise.resolve()
  };

  // Navigation is immediate; only the last pending preference is written.
  function createTaskProjectNavigationController(options) {
    function select(projectId) {
      const target = options.getStore();
      if (!target?.taskProjects?.some(project => project.id === projectId)) return Promise.resolve(false);
      let shared = taskProjectNavigationStates.get(target);
      if (!shared) { shared = { revision: 0, pending: null, saving: null }; taskProjectNavigationStates.set(target, shared); }
      shared.revision += 1;
      target.activeTaskProjectId = projectId;
      shared.pending = { projectId, options };
      options.onSelect?.(projectId);
      if (!shared.saving) {
        shared.saving = Promise.resolve().then(async () => {
          while (shared.pending) {
            await taskStoreSaveLocks.wait(target);
            const request = shared.pending;
            if (!request) continue;
            shared.pending = null;
            try {
              const result = await request.options.persistTransaction(async write => {
                if (request.options.getStore() !== target) throw new Error("Список задач недоступен. Откройте приложение заново.");
                // Never wait for a task save while holding the primary transaction barrier.
                if (taskStoreSaveLocks.has(target)) return "deferred";
                if (target.activeTaskProjectId !== request.projectId) return false; // A later creation/deletion or selection superseded this request.
                if (!target.taskProjects.some(project => project.id === request.projectId)) throw new Error("Проект уже удалён.");
                const saved = await request.options.saveSnapshot(write, request.projectId);
                if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение выбранного проекта.");
                return true;
              });
              if (result === "deferred" && !shared.pending) shared.pending = request;
            } catch (error) { request.options.onError?.(error); }
          }
          return true;
        }).finally(() => { shared.saving = null; });
      }
      return shared.saving;
    }
    return Object.freeze({ select });
  }

  function showTaskProjectDialog(documentRef, createProject, onCreated, category = false) {
    const existing = documentRef.querySelector("[data-task-project-dialog][open]");
    if (existing) { existing.querySelector("input")?.focus(); return; }
    const previousFocus = documentRef.activeElement;
    const dialog = documentRef.createElement("dialog");
    dialog.className = "desktop-delete-dialog task-project-dialog";
    dialog.setAttribute("data-task-project-dialog", "");
    dialog.setAttribute("aria-label", "Создать проект");
    dialog.innerHTML = `<form><header><span class="desktop-delete-eyebrow">Задачи · ZeTer OS</span><h2>Создать проект</h2></header><div class="desktop-delete-body"><label>Название проекта<input name="projectName" type="text" required maxlength="160" autocomplete="off" placeholder="Например, Изучение Python"></label><p>Объедините задачи, материалы и встречи в одном проекте.</p></div><footer><p class="desktop-delete-error" role="alert" hidden></p><div class="desktop-delete-actions"><button type="button" class="app-btn" data-project-cancel>Отмена</button><button type="submit" class="app-btn primary">Создать проект</button></div></footer></form>`;
    if (category) {
      dialog.setAttribute("aria-label", "Создать категорию задач");
      dialog.setAttribute("data-task-category-dialog", "");
      dialog.querySelector("h2").textContent = "Создать категорию";
      dialog.querySelector("label").firstChild.textContent = "Название категории";
      dialog.querySelector("input").placeholder = "Например, Разработка";
      dialog.querySelector(".desktop-delete-body p").textContent = "Категория будет доступна для задач выбранного проекта.";
      dialog.querySelector('[type="submit"]').textContent = "Создать категорию";
    }
    documentRef.body.append(dialog);
    const input = dialog.querySelector("input"), submit = dialog.querySelector('[type="submit"]'), cancel = dialog.querySelector("[data-project-cancel]"), errorText = dialog.querySelector('[role="alert"]');
    let busy = false;
    const close = () => { dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); };
    cancel.addEventListener("click", () => { if (!busy) close(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!busy) close(); });
    dialog.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key === "Tab") {
        const nodes = [...dialog.querySelectorAll("input, button")].filter(node => !node.disabled);
        if (!nodes.length) { event.preventDefault(); return; }
        if (event.shiftKey && documentRef.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && documentRef.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
      }
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    dialog.querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      if (busy) return;
      const name = input.value.trim();
      if (!name) { input.setCustomValidity(category ? "Введите название категории." : "Введите название проекта."); input.reportValidity(); return; }
      busy = true; input.disabled = submit.disabled = cancel.disabled = true;
      submit.textContent = "Создание…"; errorText.hidden = true;
      let project;
      try { project = await createProject(name); }
      catch (error) { errorText.textContent = error?.message || "Не удалось сохранить. Повторите попытку."; errorText.hidden = false; }
      busy = false; input.disabled = submit.disabled = cancel.disabled = false; submit.textContent = category ? "Создать категорию" : "Создать проект";
      if (project) { close(); onCreated(project); } else input.focus();
    });
    dialog.showModal(); input.focus();
  }

  // Uses the same store lock and canonical factories as the task board/editor.
  function createTaskCreationController(options) {
    async function create(kind, title, projectId = "") {
      const workspace = options.getWorkspace();
      const clean = String(title || "").trim();
      if (!clean || clean.length > (kind === "task" ? 500 : 160)) throw new Error("Укажите название допустимой длины.");
      if (!workspace) throw new Error("Рабочий стол недоступен.");
      if (taskStoreSaveLocks.has(workspace)) throw new Error("Сохранение задач выполняется. Дождитесь завершения и повторите.");
      const navigationRevision = taskProjectNavigationStates.get(workspace)?.revision || 0;
      taskStoreSaveLocks.add(workspace);
      try {
        return await options.persistTransaction(async write => {
          if (options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте приложение заново.");
          const candidate = { tasks: structuredClone(workspace.tasks || []), taskProjects: structuredClone(workspace.taskProjects || []), activeTaskProjectId: workspace.activeTaskProjectId };
          const project = candidate.taskProjects.find(project => project.id === projectId);
          if (kind !== "project" && !project) throw new Error("Проект уже удалён или недоступен.");
          let item;
          if (kind === "category") {
            project.categories ||= [];
            if (project.categories.some(category => category.name.toLocaleLowerCase("ru") === clean.toLocaleLowerCase("ru"))) throw new Error("Категория с таким названием уже существует.");
            if (project.categories.length >= 200) throw new Error("В проекте может быть не больше 200 категорий.");
            item = { id: coreUtils.uid("category"), name: clean };
            project.categories.push(item);
            project.updatedAt = Date.now();
          } else {
            item = kind === "project" ? makeTaskProject(clean) : makeTask({ title: clean, projectId, priority: project.defaultPriority, indefinite: true }, { fallbackProjectId: projectId });
            candidate[kind === "project" ? "taskProjects" : "tasks"].push(item);
          }
          if (kind === "project") candidate.activeTaskProjectId = item.id;
          const saved = await options.saveSnapshot(write, candidate);
          if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение задач.");
          if ((taskProjectNavigationStates.get(workspace)?.revision || 0) !== navigationRevision) candidate.activeTaskProjectId = workspace.activeTaskProjectId;
          Object.assign(workspace, candidate);
          return structuredClone(item);
        });
      } finally { taskStoreSaveLocks.delete(workspace); }
    }
    return Object.freeze({ createProject: name => create("project", name), createTask: (title, projectId) => create("task", title, projectId), createCategory: (projectId, name) => create("category", name, projectId) });
  }

  function createTaskProjectSettingsController(options = {}) {
    const signature = project => JSON.stringify({ name: project.name, ...normalizeTaskProjectSettings(project) });
    async function save(projectId, input, expected = null) {
      const store = options.getStore();
      if (!store) throw new Error("Список задач недоступен. Откройте его заново.");
      const name = String(input.name || "").trim();
      if (!name || name.length > 160) throw new Error("Укажите название проекта: от 1 до 160 символов.");
      if (String(input.description || "").length > 2000) throw new Error("Описание должно содержать не больше 2000 символов.");
      if (taskStoreSaveLocks.has(store)) throw new Error("Сохранение задач выполняется. Дождитесь завершения и повторите.");
      taskStoreSaveLocks.add(store);
      try {
        return await options.persistTransaction(async write => {
          if (options.getStore() !== store) throw new Error("Список задач недоступен. Откройте его заново.");
          const projects = structuredClone(store.taskProjects || []);
          const project = projects.find(item => item.id === projectId);
          if (!project) throw new Error("Проект удалён или недоступен.");
          if (expected && signature(project) !== signature(expected)) throw new Error("Проект изменён в другом окне. Закройте настройки и откройте их заново.");
          Object.assign(project, normalizeTaskProjectSettings(input), { name, updatedAt: Date.now() });
          const saved = await options.saveSnapshot(write, { taskProjects: projects });
          if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение настроек.");
          store.taskProjects = projects;
          return structuredClone(project);
        });
      } finally { taskStoreSaveLocks.delete(store); }
    }
    return Object.freeze({ save });
  }

  const PROJECT_COLOR_PRESETS = Object.freeze([
    ["default", "По умолчанию"], ["blue", "Синий"], ["#2563eb", "Кобальт"], ["#38bdf8", "Небесный"], ["#22d3ee", "Голубой"], ["#2dd4bf", "Бирюзовый"],
    ["green", "Зелёный"], ["#34d399", "Изумрудный"], ["#a3e635", "Лайм"], ["#facc15", "Жёлтый"], ["orange", "Оранжевый"], ["#fb923c", "Мандарин"],
    ["#f87171", "Красный"], ["#fb7185", "Коралловый"], ["pink", "Розовый"], ["#e879f9", "Фуксия"], ["purple", "Фиолетовый"], ["#818cf8", "Индиго"],
    ["#a78bfa", "Лаванда"], ["#c4a484", "Песочный"], ["#94a3b8", "Серый"], ["#cbd5e1", "Серебряный"]
  ]);

  function showTaskProjectSettingsDialog(documentRef, project, controller, onSaved) {
    const existing = documentRef.querySelector("[data-project-settings-dialog][open]");
    if (existing) { existing.querySelector("input")?.focus(); return; }
    const expected = structuredClone(project), previousFocus = documentRef.activeElement;
    const dialog = documentRef.createElement("dialog");
    dialog.className = "desktop-delete-dialog task-project-dialog task-project-settings-dialog";
    dialog.setAttribute("data-project-settings-dialog", "");
    dialog.setAttribute("aria-label", "Настройки проекта");
    dialog.innerHTML = `<form><header><span class="desktop-delete-eyebrow">Задачи · Параметры проекта</span><h2>Настройки проекта</h2></header>
      <div class="desktop-delete-body">
        <fieldset><legend>О проекте</legend><label>Название проекта<input name="name" required maxlength="160" autocomplete="off"></label>
        <label>Описание<textarea name="description" maxlength="2000" rows="3" placeholder="Цель проекта и важные подробности"></textarea></label>
        <fieldset class="task-project-color-section"><legend>Цвет проекта</legend><p>Выберите готовый оттенок или создайте свой в палитре.</p>
        <div class="task-project-colors">${PROJECT_COLOR_PRESETS.map(([value, label]) => `<label data-project-color="${value}" title="${label}"><input type="radio" name="color" value="${value}" aria-label="${label}"><span aria-hidden="true"></span><small>${label}</small></label>`).join("")}</div>
        <div class="task-project-custom-color"><label class="task-project-custom-toggle"><input type="radio" name="color" value="custom">Свой цвет</label><input type="color" name="customPicker" aria-label="Выбрать цвет в палитре"><label class="task-project-hex-label">HEX<input type="text" name="customHex" aria-label="Код цвета HEX" pattern="#[0-9a-fA-F]{6}" maxlength="7" required spellcheck="false" autocomplete="off" title="Введите # и шесть символов: 0–9, A–F"></label></div>
        <div class="task-project-color-preview"><span data-project-color-preview>Пример проекта</span><output data-project-color-value aria-live="polite"></output></div>
        </fieldset></fieldset>
        <fieldset><legend>Отображение задач</legend><div class="task-project-settings-grid">
          <label>Начальное представление<select name="defaultView"><option value="overview">Обзор</option><option value="board">Доска</option><option value="list">Список</option></select></label>
          <label>Сортировка задач<select name="sortBy"><option value="created">По дате создания</option><option value="due">По ближайшему сроку</option><option value="priority">По приоритету</option><option value="title">По названию</option></select></label>
        </div><p>Представление открывается при выборе проекта. Сортировка действует внутри статусов; закреплённые задачи остаются сверху.</p>
        <label class="task-project-setting-check"><input type="checkbox" name="hideCompleted"><span>Скрывать выполненные задачи<small>На доске и в списке. Итоги в обзоре учитывают все задачи.</small></span></label></fieldset>
        <fieldset><legend>Новые задачи</legend><label>Приоритет по умолчанию<select name="defaultPriority"><option value="low">Низкий</option><option value="medium">Средний</option><option value="high">Высокий</option></select></label><p>Подставляется при выборе проекта в форме новой задачи. Приоритет уже созданных задач сохраняется.</p></fieldset>
      </div><footer><p class="desktop-delete-error" role="alert" hidden></p><div class="desktop-delete-actions"><button type="button" class="app-btn" data-settings-cancel>Отмена</button><button type="submit" class="app-btn primary">Сохранить настройки</button></div></footer></form>`;
    const form = dialog.querySelector("form");
    const fields = form.elements;
    fields.namedItem("name").value = project.name;
    const settings = normalizeTaskProjectSettings(project);
    for (const key of ["description", "defaultView", "sortBy", "defaultPriority"]) fields.namedItem(key).value = settings[key];
    const preset = PROJECT_COLOR_PRESETS.some(([value]) => value === settings.color);
    fields.namedItem("color").value = preset ? settings.color : "custom";
    const accent = documentRef.defaultView?.getComputedStyle(documentRef.documentElement).getPropertyValue("--accent").trim();
    const colorHex = color => /^#[0-9a-f]{6}$/i.test(taskProjectColorCSS(color)) ? taskProjectColorCSS(color) : /^#[0-9a-f]{6}$/i.test(accent || "") ? accent : "#8a9fff";
    fields.namedItem("customHex").value = colorHex(settings.color);
    fields.namedItem("customPicker").value = colorHex(settings.color);
    dialog.querySelectorAll(".task-project-colors label").forEach(label => label.style.setProperty("--project-color", taskProjectColorCSS(label.dataset.projectColor)));
    const previewColor = () => {
      const color = fields.namedItem("color").value === "custom" ? fields.namedItem("customHex").value : fields.namedItem("color").value;
      dialog.querySelector("[data-project-color-preview]").style.setProperty("--project-color", taskProjectColorCSS(color));
      dialog.querySelector("[data-project-color-value]").textContent = color === "default" ? "Цвет интерфейса" : taskProjectColorCSS(color).toUpperCase();
    };
    previewColor();
    form.addEventListener("input", event => {
      if (event.target.name === "customPicker") { fields.namedItem("customHex").value = event.target.value; fields.namedItem("color").value = "custom"; previewColor(); }
      if (event.target.name === "customHex") {
        fields.namedItem("color").value = "custom";
        if (/^#[0-9a-f]{6}$/i.test(event.target.value)) { fields.namedItem("customPicker").value = event.target.value; previewColor(); }
      }
    });
    form.addEventListener("change", event => {
      if (event.target.name !== "color") return;
      if (event.target.value !== "custom") { fields.namedItem("customHex").value = colorHex(event.target.value); fields.namedItem("customPicker").value = colorHex(event.target.value); }
      previewColor();
    });
    fields.namedItem("hideCompleted").checked = settings.hideCompleted;
    let pending = false;
    const close = () => { if (!pending) { dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); } };
    dialog.querySelector("[data-settings-cancel]").addEventListener("click", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (pending) return;
      const input = { name: fields.namedItem("name").value, hideCompleted: fields.namedItem("hideCompleted").checked };
      for (const key of ["description", "color", "defaultView", "sortBy", "defaultPriority"]) input[key] = fields.namedItem(key).value;
      if (input.color === "custom") input.color = normalizeTaskProjectColor(fields.namedItem("customHex").value);
      pending = true;
      const errorBox = dialog.querySelector("[role=alert]"); errorBox.hidden = true;
      const controls = [...dialog.querySelectorAll("input,textarea,select,button")];
      controls.forEach(control => { control.disabled = true; });
      dialog.setAttribute("aria-busy", "true");
      const submit = dialog.querySelector("[type=submit]"); submit.textContent = "Сохранение…";
      try {
        const saved = await controller.save(project.id, input, expected);
        pending = false; close(); onSaved(saved, expected);
      } catch (error) {
        pending = false;
        controls.forEach(control => { control.disabled = false; });
        dialog.removeAttribute("aria-busy"); submit.textContent = "Сохранить настройки";
        errorBox.textContent = error?.message || "Не удалось сохранить настройки."; errorBox.hidden = false;
        submit.focus();
      }
    });
    documentRef.body.append(dialog); dialog.showModal(); fields.namedItem("name").focus();
  }

  function createTaskProjectAttachmentController(options = {}) {
    async function change(projectId, ref, removing) {
      const store = options.getStore();
      if (!store) throw new Error("Список задач недоступен.");
      if (taskStoreSaveLocks.has(store)) throw new Error("Сохранение задач выполняется. Повторите после завершения.");
      const model = window.ZETER_PROJECT_OVERVIEW_UTILS;
      const normalized = model.normalizeProjectAttachments([ref])[0];
      if (!normalized) throw new Error("Некорректная ссылка на материал или событие.");
      taskStoreSaveLocks.add(store);
      try {
        return await options.persistTransaction(async write => {
          if (options.getStore() !== store) throw new Error("Список задач недоступен. Откройте обзор заново.");
          const projects = structuredClone(store.taskProjects || []);
          const project = projects.find(item => item.id === projectId);
          if (!project) throw new Error("Проект уже удалён.");
          const refs = model.normalizeProjectAttachments(project.attachments);
          const same = item => item.kind === normalized.kind && item.id === normalized.id;
          if (!removing) {
            if (!options.resolveAttachment(normalized)) throw new Error("Материал или событие недоступны.");
            if (refs.some(same)) throw new Error("Объект уже прикреплён к проекту.");
            if (refs.length >= model.PROJECT_ATTACHMENT_LIMIT) throw new Error("В проекте уже 200 связей. Открепите ненужную.");
          }
          project.attachments = removing ? refs.filter(item => !same(item)) : [...refs, normalized];
          project.updatedAt = Date.now();
          const saved = await options.saveSnapshot(write, projects);
          if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение связи.");
          store.taskProjects = projects;
        });
      } finally { taskStoreSaveLocks.delete(store); }
    }
    return Object.freeze({ add: (id, ref) => change(id, ref, false), remove: (id, ref) => change(id, ref, true) });
  }

  function taskStoreSaveTarget(store, currentWorkspace = () => ({})) {
    const target = store?.item || currentWorkspace();
    return target && typeof target === "object" ? target : null;
  }

  function createTaskTargetNavigator(integration = {}) {
    const {
      getCurrentDesktopId = () => "",
      desktopExists = () => false,
      switchDesktop = () => {},
      getTaskListItem = () => null,
      getWorkspace = () => ({}),
      getWindows = () => new Map(),
      setTaskFilter = () => {},
      setTaskFocusTarget = () => {},
      getTaskFocusTarget = () => null,
      saveState = () => {},
      closeFloating = () => {},
      refreshWindow = () => {},
      focusWindow = () => {},
      persistOpenWindows = () => {},
      openApp = () => {},
      schedule = callback => setTimeout(callback, 0),
      scheduleLater = (callback, delay) => setTimeout(callback, delay)
    } = integration;

    function focusMatchingTaskWindow(appId, params = {}) {
      const sourceParams = ({ projectView, ...source } = {}) => source;
      const windows = getWindows();
      const records = windows?.values ? [...windows.values()] : [];
      const rec = records.find(windowRecord =>
        windowRecord.appId === appId &&
        windowRecord.desktopId === getCurrentDesktopId() &&
        JSON.stringify(sourceParams(windowRecord.params)) === JSON.stringify(sourceParams(params))
      );
      if (!rec) return false;
      rec.el?.classList?.remove("minimized");
      refreshWindow(rec.winId);
      focusWindow(rec.winId);
      persistOpenWindows();
      return true;
    }

    function scheduleFocusClear(taskId) {
      scheduleLater(() => {
        if (getTaskFocusTarget() === taskId) setTaskFocusTarget(null);
      }, 2500);
    }

    function openTaskTarget(target = {}) {
      const taskId = String(target.taskId || "");
      if (!taskId) return false;
      const desktopId = target.desktopId || getCurrentDesktopId();
      const openTarget = () => {
        setTaskFilter({ q: "", priority: "all", tag: "all" });
        setTaskFocusTarget(taskId);
        if (target.focusClear === "start") scheduleFocusClear(taskId);

        let storeKind = "workspace";
        let storeTitle = "";
        let task = null;
        let params = {};
        if (target.taskStoreKind === "tasklist" || target.taskListItemId) {
          const item = getTaskListItem(target.taskListItemId);
          if (!item || item.type !== "tasklist") {
            target.onMissing?.();
            return false;
          }
          normalizeTaskStore(item);
          task = item.tasks.find(candidate => candidate.id === taskId) || null;
          const projectId = task?.projectId || target.projectId;
          if (projectId && item.taskProjects.some(project => project.id === projectId)) item.activeTaskProjectId = projectId;
          storeKind = "tasklist";
          storeTitle = item.name || "Список задач";
          params = { itemId: item.id };
        } else {
          const workspace = getWorkspace();
          normalizeTaskStore(workspace);
          task = workspace.tasks.find(candidate => candidate.id === taskId) || null;
          const projectId = task?.projectId || target.projectId;
          if (projectId && workspace.taskProjects.some(project => project.id === projectId)) workspace.activeTaskProjectId = projectId;
        }

        if (target.saveOptions === undefined) saveState();
        else saveState(target.saveOptions);
        if (target.closeBeforeOpen) closeFloating();
        const appId = storeKind === "tasklist" ? "tasklist" : "tasks";
        if (!focusMatchingTaskWindow(appId, params)) openApp(appId, params);
        if (target.focusClear !== false && target.focusClear !== "start") scheduleFocusClear(taskId);
        target.onOpened?.({ task, storeKind, storeTitle, params });
        return true;
      };

      if (desktopId && desktopId !== getCurrentDesktopId() && desktopExists(desktopId)) {
        switchDesktop(desktopId);
        schedule(openTarget);
        return true;
      }
      return openTarget();
    }

    return Object.freeze({ focusMatchingTaskWindow, openTaskTarget });
  }

  function setTaskWindowView(params, windows, winId, view) {
    if (!["overview", "board", "list"].includes(view)) return false;
    params.projectView = view;
    const record = windows?.get?.(winId);
    if (record) record.params = { ...(record.params || {}), projectView: view };
    return true;
  }

  function createTaskBoardApp(params = {}, winId = "", integration = {}) {
    const {
      document,
      ui,
      storeOptions = {},
      currentWorkspace = () => ({}),
      saveState = () => {},
      renderAllFileSurfaces = () => {},
      renderStart = () => {},
      refreshWindowTitle = () => {},
      taskWindowTitleFromParams = () => "",
      toast = () => {},
      openApp = () => {},
      scheduleTaskReminderCheck = () => {},
      downloadFile = () => {},
      todayISO = () => "",
      formatDate = value => String(value || ""),
      promptUser = () => null,
      confirmUser = () => false,
      createProjectOverview = null,
      refreshOpenTaskBoards = () => {},
      persistProjectView = () => {},
      createProjectPersistence = null
    } = integration;
    const store = taskStoreFromParams(params, storeOptions);
    const root = document.createElement("div");
    root.className = "tasks-app";
    const isTaskList = store.kind === "tasklist";
    root.innerHTML = tasksAppShellHTML();
    const initialProject = store.projects().find(project => project.id === store.activeProjectId()) || store.projects()[0];
    let projectView = ["overview", "board", "list"].includes(params.projectView) ? params.projectView : normalizeTaskProjectSettings(initialProject).defaultView;
    let categoryId = "all", categoryProjectId = "";
    let lastFocusTarget = "";
    const selectProjectView = value => {
      if (!setTaskWindowView(params, ui.windows, winId, value)) return;
      projectView = value;
      if (ui.windows?.has(winId)) persistProjectView();
    };
    let overview = null;

    const allTasks = () => store.tasks();
    const projects = () => store.projects();
    const activeProject = () => {
      return projects().find(project => project.id === store.activeProjectId()) || projects()[0];
    };
    const projectTasks = () => allTasks().filter(task => task.projectId === activeProject().id);
    const saveTasks = async (snapshot, onSaved = () => {}) => {
      const saveTarget = taskStoreSaveTarget(store, currentWorkspace);
      if (saveTarget && taskStoreSaveLocks.has(saveTarget)) {
        restoreTaskStoreSnapshot(store, snapshot, currentWorkspace);
        renderAllFileSurfaces();
        renderStart($("#start-search-input")?.value || "");
        if (isTaskList) refreshWindowTitle(winId, taskWindowTitleFromParams({ itemId: store.item.id }));
        draw();
        toast("Сохранение выполняется", "Дождитесь завершения предыдущего изменения.");
        return false;
      }
      if (saveTarget) taskStoreSaveLocks.add(saveTarget);
      store.touch();
      try {
        await Promise.resolve(saveState());
        renderAllFileSurfaces();
        renderStart($("#start-search-input")?.value || "");
        if (isTaskList) refreshWindowTitle(winId, taskWindowTitleFromParams({ itemId: store.item.id }));
        draw();
        onSaved();
        refreshOpenTaskBoards(winId);
        return true;
      } catch (error) {
        restoreTaskStoreSnapshot(store, snapshot, currentWorkspace);
        renderAllFileSurfaces();
        renderStart($("#start-search-input")?.value || "");
        if (isTaskList) refreshWindowTitle(winId, taskWindowTitleFromParams({ itemId: store.item.id }));
        draw();
        toast("Изменения не сохранены", error?.message || "Не удалось записать данные.");
        return false;
      } finally {
        if (saveTarget) taskStoreSaveLocks.delete(saveTarget);
      }
    };

    let draw = () => {};
    const taskCard = task => {
      const card = document.createElement("article");
      const isReminderTarget = ui.taskFocusTarget && ui.taskFocusTarget === task.id;
      card.className = `task-card${task.pinned ? " pinned" : ""}${isReminderTarget ? " reminder-target" : ""}`;
      card.draggable = true;
      card.dataset.taskId = task.id;
      if (isReminderTarget) setTimeout(() => card.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
      card.innerHTML = taskCardContentHTML(task, {
        priorityName,
        formatDate,
        taskReminderTime,
        taskReminderLabel,
        normalizeTaskReminderRepeatDays,
        taskReminderRepeatLabel,
        defaultTaskReminderValue
      });
      const category = activeProject().categories?.find(category => category.id === task.categoryId);
      if (category) {
        const badge = document.createElement("span"); badge.className = "pill";
        badge.textContent = category.name; badge.title = "Категория задачи";
        $(".task-meta", card).appendChild(badge);
      }
      card.addEventListener("pointerdown", event => { if (taskCardPointerLocksDrag(event.target)) card.draggable = false; });
      card.addEventListener("pointerup", () => { card.draggable = true; });
      card.addEventListener("dragstart", event => event.dataTransfer.setData("task/id", task.id));
      card.addEventListener("change", event => {
        if (event.target.matches("[data-task-status]")) {
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          if (!TASK_BOARD_COLUMNS.some(([id]) => id === event.target.value)) return;
          task.status = event.target.value; task.updatedAt = Date.now();
          void saveTasks(snapshot);
          return;
        }
        if (event.target.matches("[data-priority-select]")) {
          const nextPriority = event.target.value;
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          if (updateTaskPriority(task, nextPriority)) {
            void saveTasks(snapshot, () => toast("Приоритет изменён", `${task.title} → ${priorityName(nextPriority)}`));
          } else draw();
          return;
        }
        const subId = event.target.dataset.sub;
        if (subId) {
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          if (updateTaskChecklistItem(task, subId, event.target.checked)) void saveTasks(snapshot);
        }
      });
      card.addEventListener("focusout", event => {
        if (!event.target.matches("[data-priority-select]")) return;
        setTimeout(() => {
          if (!document.body.contains(card)) return;
          event.target.classList.add("hidden");
          $("[data-priority-button]", card)?.classList.remove("hidden");
        }, 0);
      });
      card.addEventListener("click", event => {
        const action = taskCardClickAction(event.target);
        if (!action) return;
        if (action.type === "show-priority-select") {
          const button = $("[data-priority-button]", card);
          const select = $("[data-priority-select]", card);
          if (button && select) { button.classList.add("hidden"); select.classList.remove("hidden"); select.focus(); }
          return;
        }
        if (action.type === "delete") {
          if (confirmUser("Удалить задачу?")) {
            const snapshot = taskStoreSnapshot(store, currentWorkspace);
            store.setTasks(allTasks().filter(item => item.id !== task.id));
            void saveTasks(snapshot);
          }
          return;
        }
        if (action.type === "edit") {
          openApp("taskedit", { taskId: task.id, ...(isTaskList ? { itemId: store.item.id } : {}) });
          return;
        }
        if (action.type === "pin") {
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          toggleTaskPinned(task);
          void saveTasks(snapshot, () => toast(task.pinned ? "Задача закреплена" : "Задача откреплена", task.title));
          return;
        }
        if (action.type === "toggle-indefinite") {
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          if (task.indefinite) {
            const due = promptUser("Дата выполнения задачи:", task.due || todayISO());
            if (due === null) return;
            const normalizedDue = /^\d{4}-\d{2}-\d{2}$/.test(String(due).trim()) ? String(due).trim() : "";
            if (!normalizedDue) return toast("Срок не сохранён", "Введите дату в формате ГГГГ-ММ-ДД.");
            setTaskIndefinite(task, false, normalizedDue);
          } else setTaskIndefinite(task, true);
          void saveTasks(snapshot, () => toast(task.indefinite ? "Задача стала бессрочной" : "Срок задачи возвращён", task.title));
          return;
        }
        if (action.type === "toggle-reminder-editor") {
          const editor = $("[data-reminder-editor]", card);
          editor?.classList.toggle("hidden");
          const input = $("[data-reminder-input]", card);
          if (editor && !editor.classList.contains("hidden") && input) setTimeout(() => input.focus(), 0);
          return;
        }
        if (action.type === "save-reminder") {
          const value = normalizeTaskReminderValue($("[data-reminder-input]", card)?.value || "");
          const time = taskReminderTime(value);
          const repeatDays = normalizeTaskReminderRepeatDays($("[data-reminder-repeat]", card)?.value || 0);
          if (!value || !time) return toast("Уведомление не сохранено", "Выберите дату и время.");
          if (time <= Date.now()) return toast("Уведомление не сохранено", "Поставьте будущее время.");
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          setTaskReminder(task, value, repeatDays);
          void saveTasks(snapshot, () => {
            scheduleTaskReminderCheck();
            toast("Уведомление поставлено", `${task.title} · ${taskReminderLabel(value)}${repeatDays ? ` · ${taskReminderRepeatLabel(repeatDays)}` : ""}`);
          });
          return;
        }
        if (action.type === "remove-reminder") {
          const snapshot = taskStoreSnapshot(store, currentWorkspace);
          clearTaskReminder(task);
          void saveTasks(snapshot, () => {
            scheduleTaskReminderCheck();
            toast("Уведомление убрано", task.title);
          });
        }
      });
      return card;
    };

    const drawProjects = () => {
      const box = $(".task-project-list", root);
      box.innerHTML = taskProjectTabsHTML(projects(), activeProject().id, allTasks());
      box.querySelectorAll("[data-project-id]").forEach(button => button.style.setProperty("--project-color", taskProjectColorCSS(projects().find(project => project.id === button.dataset.projectId)?.color)));
    };
    draw = () => {
      const focused = document.activeElement;
      const focusedTask = focused?.closest?.("[data-task-id]")?.dataset.taskId;
      const focusedProjectId = focused?.closest?.("[data-project-id]")?.dataset.projectId;
      const focusedHook = ["data-sub", "data-task-status", "data-priority-select", "data-priority-button", "data-edit", "data-pin", "data-toggle-indefinite", "data-reminder", "data-reminder-save", "data-reminder-remove", "data-delete"].find(attr => focused?.hasAttribute?.(attr));
      const focusedValue = focusedHook ? focused.getAttribute(focusedHook) : null;
      const restoreProjectFocus = () => {
        if (focusedProjectId) [...root.querySelectorAll("[data-project-id]")].find(button => button.dataset.projectId === focusedProjectId)?.focus({ preventScroll: true });
      };
      const previousScroll = $(".task-board", root).scrollTop;
      drawProjects();
      const currentTasks = projectTasks();
      if (ui.taskFocusTarget && ui.taskFocusTarget !== lastFocusTarget && currentTasks.some(task => task.id === ui.taskFocusTarget)) {
        selectProjectView("board");
      }
      lastFocusTarget = ui.taskFocusTarget || "";
      const project = activeProject(), completed = currentTasks.filter(task => task.status === "done").length;
      if (categoryProjectId !== project.id || !["all", "none", ...(project.categories || []).map(category => category.id)].includes(categoryId)) categoryId = "all";
      categoryProjectId = project.id;
      const categorySelect = $("[data-filter-category]", root);
      categorySelect.innerHTML = taskCategoryOptionsHTML(project.categories, categoryId, true);
      categorySelect.value = categoryId;
      $("[data-current-project-name]", root).textContent = project.name;
      $("[data-current-project-summary]", root).textContent = `${completed} из ${currentTasks.length} задач выполнено`;
      const settings = normalizeTaskProjectSettings(project);
      root.dataset.projectColor = settings.color;
      root.style.setProperty("--project-color", taskProjectColorCSS(settings.color));
      const description = $("[data-project-description]", root);
      description.textContent = settings.description;
      description.hidden = !settings.description;
      root.querySelectorAll("[data-project-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.projectView === projectView)));
      $("[data-project-overview]", root).hidden = projectView !== "overview";
      $("[data-task-filters]", root).hidden = projectView === "overview";
      $(".task-board", root).hidden = projectView === "overview";
      root.classList.toggle("task-view-overview", projectView === "overview");
      $(".task-board", root).classList.toggle("task-board-list", projectView === "list");
      if (projectView === "overview") {
        if (!overview) {
          overview = createProjectOverview?.(store, params, winId, (deadline = "all") => { Object.assign(ui.taskFilter, { q: "", priority: "all", tag: "all", deadline }); selectProjectView("board"); draw(); }, () => categoryId);
          if (overview) $("[data-project-overview]", root).appendChild(overview);
        } else overview.refreshProjectOverview?.();
        restoreProjectFocus(); return;
      }
      const tagSelect = $("[data-filter-tag]", root);
      const tags = uniqueTaskTags(currentTasks);
      const currentTag = ui.taskFilter.tag || "all";
      ui.taskFilter.tag = tags.includes(currentTag) ? currentTag : "all";
      tagSelect.innerHTML = taskTagOptionsHTML(tags);
      tagSelect.value = ui.taskFilter.tag;
      const board = $(".task-board", root);
      $("[data-filter-q]", root).value = ui.taskFilter.q || "";
      $("[data-filter-priority]", root).value = ui.taskFilter.priority || "all";
      ui.taskFilter.today = todayISO();
      root.querySelectorAll("[data-task-deadline]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.taskDeadline === (ui.taskFilter.deadline || "all"))));
      board.innerHTML = "";
      let visibleCount = 0;
      for (const { status, name, tasks: visibleTasks } of taskBoardGroups(currentTasks, { ...ui.taskFilter, categoryId, sortBy: settings.sortBy, hideCompleted: settings.hideCompleted && !ui.taskFocusTarget }, projectView !== "list")) {
        const column = document.createElement("section");
        column.className = "task-column";
        column.dataset.status = status;
        visibleCount += visibleTasks.length;
        column.innerHTML = taskColumnHeaderHTML(name, visibleTasks.length);
        const list = $(".task-list", column);
        visibleTasks.forEach(task => list.appendChild(taskCard(task)));
        if (!visibleTasks.length) list.innerHTML = `<p class="task-column-empty">Задач нет</p>`;
        column.addEventListener("dragover", event => { event.preventDefault(); column.classList.add("drop-hover"); });
        column.addEventListener("dragleave", () => column.classList.remove("drop-hover"));
        column.addEventListener("drop", event => {
          event.preventDefault();
          column.classList.remove("drop-hover");
          const task = allTasks().find(item => item.id === event.dataTransfer.getData("task/id"));
          if (task && task.projectId === activeProject().id) {
            const snapshot = taskStoreSnapshot(store, currentWorkspace);
            task.status = status;
            task.updatedAt = Date.now();
            void saveTasks(snapshot, () => toast("Статус изменён", `${task.title} → ${name}`));
          }
        });
        board.appendChild(column);
      }
      $("[data-task-visible-count]", root).textContent = `Показано ${visibleCount} из ${currentTasks.length}`;
      if (!visibleCount) {
        const empty = document.createElement("div"); empty.className = "task-board-empty";
        empty.innerHTML = currentTasks.length ? `<strong>Нет задач для отображения</strong>${settings.hideCompleted ? `<span>Выполненные задачи скрыты в настройках проекта.</span><button type="button" data-project-configure>Настройки проекта</button>` : ""}<button type="button" data-task-reset-filters>Сбросить фильтры</button>` : `<strong>В проекте пока нет задач</strong><button type="button" data-open-task-create>Добавить первую задачу</button>`;
        board.prepend(empty);
      }
      board.scrollTop = previousScroll;
      if (focusedTask && focusedHook) {
        const card = [...board.querySelectorAll("[data-task-id]")].find(node => node.dataset.taskId === focusedTask);
        let next = [...(card?.querySelectorAll(`[${focusedHook}]`) || [])].find(node => node.getAttribute(focusedHook) === focusedValue);
        if (next?.closest(".hidden") && focusedHook === "data-priority-select") next = card.querySelector("[data-priority-button]");
        next?.focus({ preventScroll: true });
      }
      restoreProjectFocus();
    };

    const persistence = createProjectPersistence?.(store, params, winId);
    const navigation = persistence && createTaskProjectNavigationController({
      ...persistence,
      saveSnapshot: (write, projectId) => persistence.saveSnapshot(write, { activeTaskProjectId: projectId }),
      onSelect: () => { selectProjectView(normalizeTaskProjectSettings(activeProject()).defaultView); draw(); refreshOpenTaskBoards(winId); },
      onError: error => toast("Выбор проекта не сохранён", error?.message || "Повторите выбор проекта.")
    });
    const creation = persistence && createTaskCreationController({ ...persistence, getWorkspace: persistence.getStore });
    const settingsController = persistence && createTaskProjectSettingsController(persistence);

    root.addEventListener("click", event => {
      const projectSettings = $(".task-project-settings", root);
      if (projectSettings && !projectSettings.contains(event.target)) projectSettings.open = false;
      const viewButton = event.target.closest?.("[data-project-view]");
      if (viewButton) { selectProjectView(viewButton.dataset.projectView); draw(); return; }
      const deadlineButton = event.target.closest?.("[data-task-deadline]");
      if (deadlineButton) { ui.taskFilter.deadline = deadlineButton.dataset.taskDeadline; draw(); return; }
      if (event.target.closest?.("[data-task-reset-filters]")) { categoryId = "all"; Object.assign(ui.taskFilter, { q: "", priority: "all", tag: "all", deadline: "all" }); draw(); return; }
      if (event.target.closest?.("[data-category-add]")) {
        const projectId = activeProject().id;
        if (creation) showTaskProjectDialog(document, name => creation.createCategory(projectId, name), category => {
          categoryId = category.id;
          persistence.afterCreate?.(); draw(); refreshOpenTaskBoards(winId);
          toast("Категория создана", category.name);
        }, true);
        return;
      }
      const action = taskBoardClickAction(event.target);
      if (!action) return;
      if (["configure-project", "rename-project", "delete-project"].includes(action.type) && projectSettings) projectSettings.open = false;
      if (action.type === "configure-project") {
        if (settingsController) showTaskProjectSettingsDialog(document, activeProject(), settingsController, (project, previous) => {
          if (activeProject().id === project.id && project.defaultView !== normalizeTaskProjectSettings(previous).defaultView) selectProjectView(project.defaultView);
          persistence.afterCreate?.(); draw(); refreshOpenTaskBoards(winId);
          toast("Настройки сохранены", project.name);
        });
        return;
      }
      if (action.type === "select-project") {
        if (navigation) void navigation.select(action.projectId);
        return;
      }
      if (action.type === "open-create") {
        const project = activeProject();
        openApp("taskedit", { mode: "create", projectId: project.id, categoryId: ["all", "none"].includes(categoryId) ? "" : categoryId, ...(isTaskList ? { itemId: store.item.id } : {}) });
        return;
      }
      if (action.type === "add-project") {
        if (creation) showTaskProjectDialog(document, creation.createProject, project => {
          persistence.afterCreate?.();
          void navigation.select(project.id);
          toast("Проект создан", project.name);
        });
        return;
      }
      if (action.type === "rename-project") {
        const project = activeProject();
        const name = promptUser("Новое название проекта:", project.name);
        if (name === null) return;
        const snapshot = taskStoreSnapshot(store, currentWorkspace);
        project.name = name.trim() || project.name;
        project.updatedAt = Date.now();
        void saveTasks(snapshot);
        return;
      }
      if (action.type === "delete-project") {
        const project = activeProject();
        const plan = taskProjectDeletionPlan(projects(), allTasks(), project.id);
        if (!plan) return toast("Нельзя удалить", "В списке должен остаться хотя бы один проект.");
        if (!confirmUser(`Удалить проект «${project.name}» и ${plan.count} задач?`)) return;
        const snapshot = taskStoreSnapshot(store, currentWorkspace);
        if (store.item) { store.item.taskProjects = plan.nextProjects; store.item.activeTaskProjectId = plan.nextActive.id; }
        else { currentWorkspace().taskProjects = plan.nextProjects; currentWorkspace().activeTaskProjectId = plan.nextActive.id; }
        store.setTasks(plan.nextTasks);
        void saveTasks(snapshot);
        return;
      }
      if (action.type === "export-tasks") {
        downloadFile(`zeter_tasks_${store.title}.json`, JSON.stringify({ tasks: allTasks(), taskProjects: projects(), activeTaskProjectId: store.activeProjectId() }, null, 2), "application/json");
      }
    });
    root.addEventListener("input", event => {
      if (applyTaskBoardFilterAction(ui.taskFilter, taskBoardInputAction(event.target))) draw();
    });
    root.addEventListener("change", event => {
      if (event.target.matches?.("[data-filter-category]")) { categoryId = event.target.value || "all"; draw(); return; }
      if (applyTaskBoardFilterAction(ui.taskFilter, taskBoardChangeAction(event.target))) draw();
    });
    root.addEventListener("keydown", event => {
      const menu = $(".task-project-settings[open]", root);
      if (event.key === "Escape" && menu) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector("summary").focus(); }
    });
    root.refreshTaskBoard = draw;
    draw();
    return root;
  }

  function createTaskEditorApp(params = {}, winId = "", integration = {}) {
    const {
      document,
      storeOptions = {},
      currentWorkspace = () => ({}),
      closeWindow = () => {},
      saveState = () => {},
      renderAllFileSurfaces = () => {},
      renderStart = () => {},
      refreshOpenTaskBoards = () => {},
      toast = () => {},
      todayISO = () => ""
    } = integration;
    const root = document.createElement("div");
    root.className = "task-editor-app editor";
    const store = taskEditorStoreFromParams(params, storeOptions);
    const isCreate = params?.mode === "create";
    const closeEditor = () => closeWindow(winId);
    const saveStoreAfterTaskChange = async snapshot => {
      const saveTarget = taskStoreSaveTarget(store, currentWorkspace);
      if (saveTarget && taskStoreSaveLocks.has(saveTarget)) {
        restoreTaskStoreSnapshot(store, snapshot, currentWorkspace);
        renderAllFileSurfaces();
        renderStart($("#start-search-input")?.value || "");
        refreshOpenTaskBoards(winId);
        toast("Сохранение выполняется", "Дождитесь завершения предыдущего изменения.");
        return false;
      }
      if (saveTarget) taskStoreSaveLocks.add(saveTarget);
      store.touch();
      try {
        await Promise.resolve(saveState());
        renderAllFileSurfaces();
        renderStart($("#start-search-input")?.value || "");
        refreshOpenTaskBoards(winId);
        return true;
      } catch (error) {
        restoreTaskStoreSnapshot(store, snapshot, currentWorkspace);
        renderAllFileSurfaces();
        renderStart($("#start-search-input")?.value || "");
        refreshOpenTaskBoards(winId);
        toast("Задача не сохранена", error?.message || "Не удалось записать данные.");
        return false;
      } finally {
        if (saveTarget) taskStoreSaveLocks.delete(saveTarget);
      }
    };
    if (isCreate) {
      if (!store) {
        root.innerHTML = taskMissingStoreHTML("Список задач не найден.", "Он мог быть удалён или находится в другом рабочем столе.");
        root.addEventListener("click", event => { if (taskEditorClickAction(event.target)?.type === "cancel") closeEditor(); });
        return root;
      }
      normalizeTaskStore(store.item || currentWorkspace());
      root.classList.add("task-editor-create");
      const projects = store.projects();
      const fallbackProject = projects.find(project => project.id === params.projectId) || projects.find(project => project.id === store.activeProjectId()) || projects[0];
      root.innerHTML = taskCreateEditorHTML(taskProjectOptionsHTML(projects, fallbackProject.id), todayISO());
      const updateCategoryChoices = (selectedId = "") => {
        const projectId = $("[data-task-project]", root).value;
        const project = store.projects().find(project => project.id === projectId);
        $("[data-task-category]", root).innerHTML = taskCategoryOptionsHTML(project?.categories, selectedId);
        $("[data-task-priority]", root).value = normalizeTaskProjectSettings(project).defaultPriority;
      };
      updateCategoryChoices(params.categoryId || "");
      root.addEventListener("change", event => { if (event.target.matches?.("[data-task-project]")) updateCategoryChoices(); });
      let saveInFlight = false;
      const saveNewTask = async () => {
        if (saveInFlight) return;
        const form = taskCreateFormData(root, fallbackProject.id);
        if (!store.projects().some(project => project.id === form.projectId && (!form.categoryId || project.categories?.some(category => category.id === form.categoryId)))) { toast("Задача не сохранена", "Проект или категория уже недоступны. Выберите их заново."); return; }
        if (!form.title) { toast("Нужен заголовок", "Введите название задачи."); $("[data-task-title]", root)?.focus(); return; }
        const snapshot = taskStoreSnapshot(store, currentWorkspace);
        store.tasks().push(makeTask(form, { fallbackProjectId: fallbackProject.id }));
        store.setActiveProjectId(form.projectId);
        saveInFlight = true;
        const saved = await saveStoreAfterTaskChange(snapshot);
        saveInFlight = false;
        if (!saved) return;
        toast("Задача добавлена", form.title);
        closeEditor();
      };
      root.addEventListener("click", event => {
        const action = taskEditorClickAction(event.target);
        if (action?.type === "save") return saveNewTask();
        if (action?.type === "cancel") return closeEditor();
        if (action?.type === "toggle-create-indefinite") toggleTaskCreateIndefinite(root, todayISO());
      });
      const restoreDatedMode = event => {
        if (event.target.matches?.("[data-task-due]") && $("[data-create-indefinite]", root)?.dataset.active === "1") {
          toggleTaskCreateIndefinite(root, todayISO(), false);
        }
      };
      root.addEventListener("focusin", restoreDatedMode);
      root.addEventListener("input", restoreDatedMode);
      root.addEventListener("keydown", event => {
        const action = taskEditorKeyAction(event);
        if (!action) return;
        event.preventDefault();
        if (action.type === "cancel") closeEditor();
        if (action.type === "save") saveNewTask();
      });
      setTimeout(() => $("[data-task-title]", root)?.focus(), 0);
      return root;
    }
    const task = store?.tasks().find(item => item.id === params.taskId);
    if (!store || !task) {
      root.innerHTML = taskMissingStoreHTML("Задача не найдена.", "Она могла быть удалена или находится в другом списке.");
      root.addEventListener("click", event => { if (taskEditorClickAction(event.target)?.type === "cancel") closeEditor(); });
      return root;
    }
    root.innerHTML = taskEditEditorHTML(task, store.projects().find(project => project.id === task.projectId)?.categories);
    let saveInFlight = false;
    const saveTask = async () => {
      if (saveInFlight) return;
      const form = taskEditFormData(root);
      if (!form.title) { toast("Нужен заголовок", "Введите название задачи."); $("[data-task-title]", root)?.focus(); return; }
      const currentTask = store.tasks().find(item => item.id === params.taskId);
      if (!currentTask) { toast("Задача не сохранена", "Задача была удалена из списка."); return; }
      if (form.categoryId && !store.projects().find(project => project.id === currentTask.projectId)?.categories?.some(category => category.id === form.categoryId)) { toast("Задача не сохранена", "Категория уже недоступна. Откройте задачу заново."); return; }
      const snapshot = taskStoreSnapshot(store, currentWorkspace);
      updateTaskTitleDescription(currentTask, form);
      currentTask.categoryId = form.categoryId;
      saveInFlight = true;
      const saved = await saveStoreAfterTaskChange(snapshot);
      saveInFlight = false;
      if (!saved) return;
      toast("Задача сохранена", form.title);
      closeEditor();
    };
    root.addEventListener("click", event => {
      const action = taskEditorClickAction(event.target);
      if (action?.type === "save") return saveTask();
      if (action?.type === "cancel") return closeEditor();
    });
    root.addEventListener("keydown", event => {
      const action = taskEditorKeyAction(event);
      if (!action) return;
      event.preventDefault();
      if (action.type === "cancel") closeEditor();
      if (action.type === "save") saveTask();
    });
    setTimeout(() => { const input = $("[data-task-title]", root); input?.focus(); input?.select(); }, 0);
    return root;
  }

  function createTaskAppRuntimeController(options = {}) {
    const {
      getState = () => ({}),
      currentWorkspace = () => ({}),
      normalizeTaskStoreValue = normalizeTaskStore,
      desktopName = () => "",
      getDesktopRoot = () => null,
      documentRef = document,
      getUi = () => ({}),
      getApps = () => ({}),
      windowBodyEl = () => null,
      saveState = () => {},
      renderAllFileSurfaces = () => {},
      renderStart = () => {},
      refreshWindowTitle = () => {},
      taskWindowTitleFromParams = () => "",
      toast = () => {},
      openApp = () => {},
      scheduleTaskReminderCheck = () => {},
      downloadFile = () => {},
      todayISO = () => "",
      formatDate = value => String(value || ""),
      promptUser = () => null,
      confirmUser = () => false,
      closeWindow = () => {},
      createTaskBoard = createTaskBoardApp,
      createTaskEditor = createTaskEditorApp,
      createProjectOverview = null,
      persistProjectView = () => {},
      createProjectPersistence = null
    } = options;

    function taskStoreOptions() {
      return {
        state: getState(),
        currentWorkspace,
        normalizeTaskStore: normalizeTaskStoreValue,
        desktopName,
        getDesktopRoot
      };
    }

    function renderTasksApp(params = {}, winId = "") {
      return createTaskBoard(params, winId, {
        document: documentRef,
        ui: getUi(),
        storeOptions: taskStoreOptions(),
        currentWorkspace,
        saveState,
        renderAllFileSurfaces,
        renderStart,
        refreshWindowTitle,
        taskWindowTitleFromParams,
        toast,
        openApp,
        scheduleTaskReminderCheck,
        downloadFile,
        todayISO,
        formatDate,
        promptUser,
        confirmUser,
        createProjectOverview,
        refreshOpenTaskBoards,
        persistProjectView,
        createProjectPersistence
      });
    }

    function refreshOpenTaskBoards(excludeWinId = "") {
      const ui = getUi();
      const apps = getApps();
      ui.windows?.forEach(rec => {
        if (rec.winId === excludeWinId || !["tasks", "tasklist"].includes(rec.appId)) return;
        if (rec.desktopId && rec.desktopId !== getDesktopRoot()) return;
        const app = apps[rec.appId];
        const body = windowBodyEl(rec.el);
        if (!app || !body) return;
        const mounted = body.querySelector?.(".tasks-app");
        if (mounted?.refreshTaskBoard) {
          mounted.refreshTaskBoard();
          if (rec.appId === "tasklist") refreshWindowTitle(rec.winId, taskWindowTitleFromParams(rec.params));
          return;
        }
        body.innerHTML = "";
        body.appendChild(app.render(rec.params || {}, rec.winId));
        if (rec.appId === "tasklist") refreshWindowTitle(rec.winId, taskWindowTitleFromParams(rec.params));
      });
    }

    function renderTaskEditorApp(params = {}, winId = "") {
      return createTaskEditor(params, winId, {
        document: documentRef,
        storeOptions: taskStoreOptions(),
        currentWorkspace,
        closeWindow,
        saveState,
        renderAllFileSurfaces,
        renderStart,
        refreshOpenTaskBoards,
        toast,
        todayISO
      });
    }

    return Object.freeze({
      taskStoreOptions,
      renderTasksApp,
      refreshOpenTaskBoards,
      renderTaskEditorApp
    });
  }

  window.ZETER_TASK_APP_UI_UTILS = Object.freeze({
    taskProjectDeletionPlan,
    applyTaskBoardFilterAction,
    taskStoreSnapshot,
    restoreTaskStoreSnapshot,
    createTaskCreationController,
    createTaskProjectNavigationController,
    showTaskProjectDialog,
    createTaskProjectAttachmentController,
    createTaskProjectSettingsController,
    showTaskProjectSettingsDialog,
    setTaskWindowView,
    createTaskTargetNavigator,
    createTaskBoardApp,
    createTaskEditorApp,
    createTaskAppRuntimeController
  });
})();
