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
  const {
    TASK_BOARD_COLUMNS,
    taskStoreFromParams,
    taskEditorStoreFromParams,
    uniqueTaskTags,
    taskBoardColumnTasks,
    taskTagOptionsHTML,
    taskProjectTabsHTML,
    taskProjectOptionsHTML,
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
    else return false;
    return true;
  }

  function taskStoreSnapshot(store, currentWorkspace = () => ({})) {
    const target = store?.item || currentWorkspace();
    return {
      tasks: structuredClone(target.tasks || []),
      taskProjects: structuredClone(target.taskProjects || []),
      activeTaskProjectId: target.activeTaskProjectId,
      updatedAt: target.updatedAt
    };
  }

  function restoreTaskStoreSnapshot(store, snapshot, currentWorkspace = () => ({})) {
    if (!store || !snapshot) return;
    const target = store.item || currentWorkspace();
    target.tasks = snapshot.tasks;
    target.taskProjects = snapshot.taskProjects;
    target.activeTaskProjectId = snapshot.activeTaskProjectId;
    if (store.item) target.updatedAt = snapshot.updatedAt;
  }

  const taskStoreSaveLocks = new WeakSet();

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
      const windows = getWindows();
      const records = windows?.values ? [...windows.values()] : [];
      const rec = records.find(windowRecord =>
        windowRecord.appId === appId &&
        windowRecord.desktopId === getCurrentDesktopId() &&
        JSON.stringify(windowRecord.params || {}) === JSON.stringify(params || {})
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
      confirmUser = () => false
    } = integration;
    const store = taskStoreFromParams(params, storeOptions);
    const root = document.createElement("div");
    root.className = "tasks-app";
    const isTaskList = store.kind === "tasklist";
    root.innerHTML = tasksAppShellHTML();

    const allTasks = () => store.tasks();
    const projects = () => store.projects();
    const activeProject = () => {
      normalizeTaskStore(store.item || currentWorkspace());
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
      card.addEventListener("pointerdown", event => { if (taskCardPointerLocksDrag(event.target)) card.draggable = false; });
      card.addEventListener("pointerup", () => { card.draggable = true; });
      card.addEventListener("dragstart", event => event.dataTransfer.setData("task/id", task.id));
      card.addEventListener("change", event => {
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
    };
    draw = () => {
      normalizeTaskStore(store.item || currentWorkspace());
      drawProjects();
      const currentTasks = projectTasks();
      const tagSelect = $("[data-filter-tag]", root);
      const currentTag = tagSelect.value || "all";
      const tags = uniqueTaskTags(currentTasks);
      tagSelect.innerHTML = taskTagOptionsHTML(tags);
      tagSelect.value = tags.includes(currentTag) ? currentTag : "all";
      const board = $(".task-board", root);
      board.innerHTML = "";
      for (const [status, name] of TASK_BOARD_COLUMNS) {
        const column = document.createElement("section");
        column.className = "task-column";
        column.dataset.status = status;
        const visibleTasks = taskBoardColumnTasks(currentTasks, status, ui.taskFilter);
        column.innerHTML = taskColumnHeaderHTML(name, visibleTasks.length);
        const list = $(".task-list", column);
        visibleTasks.forEach(task => list.appendChild(taskCard(task)));
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
    };

    root.addEventListener("click", event => {
      const action = taskBoardClickAction(event.target);
      if (!action) return;
      if (action.type === "select-project") {
        const snapshot = taskStoreSnapshot(store, currentWorkspace);
        store.setActiveProjectId(action.projectId);
        void saveTasks(snapshot);
        return;
      }
      if (action.type === "open-create") {
        const project = activeProject();
        openApp("taskedit", { mode: "create", projectId: project.id, ...(isTaskList ? { itemId: store.item.id } : {}) });
        return;
      }
      if (action.type === "add-project") {
        const name = promptUser("Название проекта:", "Новый проект");
        if (name === null) return;
        const clean = name.trim() || "Новый проект";
        const snapshot = taskStoreSnapshot(store, currentWorkspace);
        const project = makeTaskProject(clean);
        projects().push(project);
        store.setActiveProjectId(project.id);
        void saveTasks(snapshot, () => toast("Проект создан", clean));
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
      if (applyTaskBoardFilterAction(ui.taskFilter, taskBoardChangeAction(event.target))) draw();
    });
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
      let saveInFlight = false;
      const saveNewTask = async () => {
        if (saveInFlight) return;
        const form = taskCreateFormData(root, fallbackProject.id);
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
    root.innerHTML = taskEditEditorHTML(task);
    let saveInFlight = false;
    const saveTask = async () => {
      if (saveInFlight) return;
      const form = taskEditFormData(root);
      if (!form.title) { toast("Нужен заголовок", "Введите название задачи."); $("[data-task-title]", root)?.focus(); return; }
      const currentTask = store.tasks().find(item => item.id === params.taskId);
      if (!currentTask) { toast("Задача не сохранена", "Задача была удалена из списка."); return; }
      const snapshot = taskStoreSnapshot(store, currentWorkspace);
      updateTaskTitleDescription(currentTask, form);
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
      createTaskEditor = createTaskEditorApp
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
        confirmUser
      });
    }

    function refreshOpenTaskBoards(excludeWinId = "") {
      const ui = getUi();
      const apps = getApps();
      ui.windows?.forEach(rec => {
        if (rec.winId === excludeWinId || !["tasks", "tasklist"].includes(rec.appId)) return;
        const app = apps[rec.appId];
        const body = windowBodyEl(rec.el);
        if (!app || !body) return;
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
    createTaskTargetNavigator,
    createTaskBoardApp,
    createTaskEditorApp,
    createTaskAppRuntimeController
  });
})();
