(() => {
  "use strict";
  const { escapeHtml: e } = window.ZETER_CORE_UTILS;
  const { buildProjectOverview, validProjectDue, PROJECT_ATTACHMENT_LIMIT } = window.ZETER_PROJECT_OVERVIEW_UTILS;
  const { formatTimeDuration: duration } = window.ZETER_TIME_TRACKING_UTILS;

  function createProjectOverview(options = {}) {
    const doc = options.documentRef, root = doc.createElement("div");
    root.className = "project-overview-content";
    let busy = false, query = "", message = "", failed = false, renderedProjectId = "";
    const context = () => options.getContext() || {};
    const key = ref => `${ref.kind}:${ref.id}`;
    const refFrom = value => { const [kind, id] = String(value || "").split(":"); return { kind, id }; };
    const dateLabel = value => validProjectDue(value) ? new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU") : "Без срока";
    const timeLabel = value => duration(value).slice(0, -3);
    function taskRows(stats, data) {
      const statusNames = { todo: "Нужно сделать", doing: "В работе", review: "На проверке", done: "Готово" };
      return stats.pending.slice(0, 6).map(task => {
        const due = !task.indefinite && validProjectDue(task.due) ? task.due : "", urgent = due && due < stats.today;
        const category = data.project.categories?.find(item => item.id === task.categoryId);
        return `<li class="project-resource-row project-task-row"><div><div class="project-task-labels"><span class="project-stage-dot" data-stage="${e(task.status)}"></span><span>${e(statusNames[task.status] || "Нужно сделать")}</span>${task.pinned ? `<span>Закреплено</span>` : ""}</div><button type="button" class="project-task-title" data-project-action="task" data-project-task="${e(task.id)}">${e(task.title)}</button><div class="project-task-labels"><span class="${urgent ? "project-label-overdue" : due === stats.today ? "project-label-today" : ""}">${e(due === stats.today ? "Сегодня" : dateLabel(due))}</span><span class="project-priority" data-priority="${e(task.priority)}">${e(({ high: "Высокий", medium: "Средний", low: "Низкий" })[task.priority] || "Средний")} приоритет</span>${category ? `<span>${e(category.name)}</span>` : ""}</div></div>${!options.isTaskList ? `<button type="button" data-project-action="timer" data-project-task="${e(task.id)}" ${busy || data.workspace?.timeTracking?.active ? "disabled" : ""} title="Начать отсчёт времени задачи">Начать</button>` : ""}</li>`;
      }).join("") || `<li class="project-overview-empty"><strong>${stats.total ? "Отличная работа — всё готово" : "Здесь появятся ближайшие дела"}</strong><p>${stats.total ? "Все задачи выбранной категории завершены. Можно добавить следующий шаг." : "Добавьте задачу и укажите срок или приоритет. Обзор поможет выбрать, с чего начать."}</p><button type="button" data-project-action="create">+ Добавить задачу</button></li>`;
    }
    function weekChart(stats) {
      const max = Math.max(1, ...stats.weekDays.map(day => day.ms));
      return `<div class="project-week-chart" role="img" aria-label="${e(`Время проекта за неделю: ${stats.weekDays.map(day => `${day.label}: ${timeLabel(day.ms)}`).join(", ")}`)}">${stats.weekDays.map(day => `<div class="project-week-day ${day.isToday ? "is-today" : ""}" title="${e(dateLabel(day.date))}: ${timeLabel(day.ms)}"><span class="project-week-value">${day.ms ? timeLabel(day.ms) : "—"}</span><div class="project-week-track"><span data-project-day-bar="${day.date}" style="--day-height:${Math.round(day.ms / max * 100)}%"></span></div><span>${e(day.label)}</span></div>`).join("")}</div>`;
    }
    function choices() {
      const data = context(), attached = new Set((data.project?.attachments || []).map(key));
      return (data.candidates || []).filter(item => !attached.has(key(item.endpoint)) && `${item.label} ${item.typeLabel}`.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru"))).slice(0, 100);
    }
    function updateChoices() {
      const select = root.querySelector("[data-project-attachment-choice]");
      if (!select) return;
      select.innerHTML = `<option value="">Выберите материал или событие…</option>${choices().map(item => `<option value="${e(key(item.endpoint))}">${e(item.typeLabel)} · ${e(item.label)}</option>`).join("")}`;
      select.disabled = busy || choices().length === 0;
    }
    function attachmentRows(refs, data) {
      if (!refs.length) return `<li class="project-overview-empty project-resource-empty"><strong>Всё нужное — рядом с задачами</strong><p>Прикрепите материал или событие, чтобы открывать его прямо из проекта.</p><button type="button" data-project-action="find-attachment">+ Выбрать объект</button></li>`;
      return refs.map(ref => {
        const item = data.resolveAttachment?.(ref), value = key(ref);
        return `<li class="project-resource-row"><div><strong>${e(item?.label || "Объект недоступен")}</strong><small>${e(item?.typeLabel || "Удалён или находится на другом рабочем столе")}</small></div><div class="project-row-actions"><button type="button" data-project-action="open" data-project-ref="${e(value)}" ${item ? "" : "disabled"}>Открыть</button><button type="button" data-project-action="remove" data-project-ref="${e(value)}" aria-label="Открепить ${e(item?.label || "недоступный объект")}" ${busy ? "disabled" : ""}>Открепить</button></div></li>`;
      }).join("");
    }
    function render() {
      const data = context();
      if (!data.project) { root.innerHTML = `<p class="project-empty">Проект недоступен. Выберите другой проект.</p>`; return; }
      const previousChoice = root.querySelector("[data-project-attachment-choice]")?.value;
      const searchFocused = doc.activeElement === root.querySelector("[data-project-attachment-search]");
      const choiceFocused = doc.activeElement === root.querySelector("[data-project-attachment-choice]");
      const changedProject = renderedProjectId !== data.project.id;
      if (changedProject) { query = ""; message = ""; failed = false; renderedProjectId = data.project.id; if (root.parentElement) root.parentElement.scrollTop = 0; }
      const stats = buildProjectOverview(data), refs = stats.attachments;
      const focusTitle = !stats.total ? "Начните с первой задачи" : !stats.pending.length ? "Все задачи выполнены" : stats.overdue ? "Есть задачи, требующие внимания" : stats.todayCount ? "Сосредоточьтесь на сегодняшних делах" : "Проект в работе";
      const focusText = !stats.total ? "Создайте первый шаг — здесь появятся прогресс, сроки и ближайшие дела." : !stats.pending.length ? "Все дела выбранной категории завершены. Результат сохранён в проекте." : `Открытых задач: ${stats.pending.length}. ${stats.overdue ? `Просрочено: ${stats.overdue}. ` : ""}${stats.highPriorityCount ? `С высоким приоритетом: ${stats.highPriorityCount}.` : ""}`;
      const focusFilter = stats.overdue ? "overdue" : stats.todayCount ? "today" : "all";
      const maxStage = Math.max(1, stats.total);
      root.innerHTML = `
        <div class="project-stat-grid project-summary"><div class="project-summary-main"><div class="project-progress-ring" style="--project-progress:${stats.progress}%"><strong>${stats.progress}<span>%</span></strong></div><div class="project-summary-copy"><small>ПРОГРЕСС ПРОЕКТА${data.categoryId && data.categoryId !== "all" ? " · ВЫБРАННАЯ КАТЕГОРИЯ" : ""}</small><h3>${focusTitle}</h3><p>${focusText}</p><progress max="100" value="${stats.progress}" aria-label="Выполнено ${stats.progress}% задач"></progress><span>${stats.done} из ${stats.total} задач выполнено</span></div></div><div class="project-summary-next"><small>Ближайший срок</small><strong class="project-date-stat">${e(dateLabel(stats.nextDue))}</strong><span>${stats.nextDue ? "среди открытых задач" : "Добавьте дату в задаче, чтобы видеть сроки"}</span><button type="button" data-project-action="${stats.pending.length ? "board" : "create"}" data-project-deadline="${focusFilter}">${stats.pending.length ? stats.overdue ? "Разобрать просроченные →" : stats.todayCount ? "Задачи на сегодня →" : "Открыть задачи →" : "+ Добавить задачу"}</button></div></div>
        <div class="project-metric-grid">${[["today", "На сегодня", stats.todayCount, "Срок наступает сегодня"], ["overdue", "Просрочено", stats.overdue, "Требуют нового срока или завершения"], ["week", "На 7 дней", stats.weekDueCount, "Сегодня и следующие шесть дней"], ["undated", "Без срока", stats.undatedCount, "Можно запланировать позже"]].map(([filter, label, count, hint]) => `<button type="button" class="project-metric ${filter === "overdue" && count ? "is-warning" : ""}" data-project-action="board" data-project-deadline="${filter}"><span>${label}<b aria-hidden="true">↗</b></span><strong>${count}</strong><small>${hint}</small></button>`).join("")}</div>
        <div class="project-overview-grid"><section class="project-panel project-focus-panel"><header><div><h3>Следующие задачи</h3><p class="project-panel-subtitle">Сначала ближайшие сроки, затем приоритет</p></div><button type="button" data-project-action="board">Все задачи →</button></header><ul class="project-resource-list">${taskRows(stats, data)}</ul>${stats.pending.length > 6 ? `<button type="button" class="project-show-more" data-project-action="board">Ещё задач: ${stats.pending.length - 6} →</button>` : ""}</section>
        <section class="project-panel project-stages-panel"><header><div><h3>По этапам</h3><p class="project-panel-subtitle">Где сейчас находятся задачи</p></div><span class="project-count-badge">${stats.total}</span></header><div class="project-stage-stack" aria-hidden="true">${stats.stages.map(stage => `<span data-stage="${stage.id}" style="--stage-width:${stage.count / maxStage * 100}%"></span>`).join("")}</div><ul class="project-stage-list">${stats.stages.map(stage => `<li><span><i class="project-stage-dot" data-stage="${stage.id}"></i>${stage.name}</span><strong>${stage.count}</strong><small>${Math.round(stage.count / maxStage * 100)}%</small></li>`).join("")}</ul><p class="project-time-hint">${stats.pending.length ? `Осталось завершить: ${stats.pending.length}. Меняйте этап на доске или в списке.` : stats.total ? "Все этапы пройдены — проект завершён по задачам." : "Добавьте задачи, чтобы видеть распределение работы."}</p></section>
        <section class="project-panel project-time-panel"><header><div><h3>Время проекта</h3><p class="project-panel-subtitle">Фактическая работа без пауз</p></div>${!options.isTaskList ? `<button type="button" data-project-action="time">Учёт времени →</button>` : ""}</header>${options.isTaskList ? `<p class="project-empty">Учёт времени доступен для проектов приложения «Задачи» на рабочем столе. Этот файловый список хранит задачи отдельно.</p>` : `<div class="project-time-layout"><div><dl class="project-time-totals"><div><dt>За эту неделю</dt><dd data-project-time="week">${timeLabel(stats.weekMs)}</dd></div><div><dt>За всё время</dt><dd data-project-time="all">${timeLabel(stats.totalMs)}</dd></div></dl><p class="project-time-hint">Часы : минуты${data.needsRecovery ? ". Подтвердите незавершённый отсчёт в «Учёте времени»." : data.workspace?.timeTracking?.active ? ". Таймер уже занят — управление в «Учёте времени»." : ". Нажмите «Начать» у задачи, чтобы записать время работы."}</p></div><div data-project-week-chart>${weekChart(stats)}</div></div>`}</section>
        <section class="project-panel"><header><h3>Материалы</h3><span>${refs.filter(ref => ref.kind === "fs").length}</span></header><ul class="project-resource-list">${attachmentRows(refs.filter(ref => ref.kind === "fs"), data)}</ul></section><section class="project-panel"><header><h3>События и встречи</h3><span>${refs.filter(ref => ref.kind === "event").length}</span></header><ul class="project-resource-list">${attachmentRows(refs.filter(ref => ref.kind === "event"), data)}</ul></section></div>
        <section class="project-panel project-attach-panel"><h3>Прикрепить к проекту</h3><p class="project-time-hint">Связь ведёт к исходному объекту. Открепление сохраняет сам материал или событие. До ${PROJECT_ATTACHMENT_LIMIT} связей.</p><div class="project-attach-form"><input type="search" data-project-attachment-search aria-label="Найти материал или событие" placeholder="Найти материал или событие…" value="${e(query)}" ${busy ? "disabled" : ""}><select data-project-attachment-choice aria-label="Материал или событие" ${busy ? "disabled" : ""}></select><button type="button" class="app-btn" data-project-action="add" ${busy || refs.length >= PROJECT_ATTACHMENT_LIMIT ? "disabled" : ""}>${busy ? "Сохраняем…" : "Прикрепить"}</button></div><p class="project-time-hint">Показаны первые 100 совпадений текущего рабочего стола. Для точного выбора уточните поиск.</p><p class="project-save-status ${failed ? "error" : ""}" role="status" aria-live="polite">${e(message)}</p></section>`;
      updateChoices();
      const select = root.querySelector("[data-project-attachment-choice]");
      if (!changedProject && [...(select?.options || [])].some(option => option.value === previousChoice)) select.value = previousChoice;
      if (!busy && searchFocused) root.querySelector("[data-project-attachment-search]")?.focus({ preventScroll: true });
      if (!busy && choiceFocused && !select?.disabled) select?.focus({ preventScroll: true });
    }
    root.addEventListener("input", event => { if (event.target.matches("[data-project-attachment-search]")) { query = event.target.value; updateChoices(); } });
    root.addEventListener("click", async event => {
      const button = event.target.closest("[data-project-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.projectAction, data = context();
      if (action === "board") return options.showBoard?.(button.dataset.projectDeadline || "all");
      if (action === "create") return options.createTask?.();
      if (action === "find-attachment") { root.querySelector("[data-project-attachment-search]")?.focus(); root.querySelector(".project-attach-panel")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
      if (action === "task") return options.openTask?.(button.dataset.projectTask);
      if (action === "time") return options.openTime?.();
      if (action === "open") return options.openAttachment?.(refFrom(button.dataset.projectRef));
      if (busy || !data.project) return;
      const selected = action === "add" ? root.querySelector("[data-project-attachment-choice]")?.value : button.dataset.projectRef;
      if (action === "add" && !selected) { message = "Выберите материал или событие из списка."; failed = true; render(); return; }
      const projectId = data.project.id, taskId = button.dataset.projectTask;
      busy = true; message = "Сохраняем…"; failed = false; render();
      try {
        if (action === "timer") await options.startTimer(taskId, projectId);
        else if (action === "add") await options.controller.add(projectId, refFrom(selected));
        else if (action === "remove") await options.controller.remove(projectId, refFrom(selected));
        message = action === "timer" ? "Таймер задачи запущен." : action === "remove" ? "Связь удалена. Объект сохранён." : "Объект прикреплён к проекту.";
        options.onChange?.();
      } catch (error) { failed = true; message = error.message || "Не удалось сохранить. Повторите действие."; }
      finally { busy = false; render(); const status = root.querySelector(".project-save-status"); status?.setAttribute("tabindex", "-1"); status?.focus({ preventScroll: true }); }
    });
    root.refreshProjectOverview = () => { if (!busy) render(); };
    render();
    const view = doc.defaultView;
    if (view?.setInterval) {
      const interval = view.setInterval(() => {
        if (!root.isConnected) { view.clearInterval(interval); return; }
        if (busy || root.closest("[hidden]")) return;
        const stats = buildProjectOverview(context());
        const week = root.querySelector('[data-project-time="week"]'), total = root.querySelector('[data-project-time="all"]');
        if (week) week.textContent = timeLabel(stats.weekMs);
        if (total) total.textContent = timeLabel(stats.totalMs);
        const chart = root.querySelector("[data-project-week-chart]");
        if (chart) chart.innerHTML = weekChart(stats);
      }, 60000);
    }
    return root;
  }
  window.ZETER_PROJECT_OVERVIEW_UI_UTILS = Object.freeze({ createProjectOverview });
})();
