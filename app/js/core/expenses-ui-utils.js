(() => {
  "use strict";
  const { escapeHtml: e } = window.ZETER_CORE_UTILS;
  const { CURRENCIES, CATEGORY_COLORS, localExpenseDate, expenseAmountInput, formatExpenseAmount, filterExpenses, summarizeExpenses, expensesCSVRows } = window.ZETER_EXPENSES_UTILS;
  let dialogSequence = 0;
  const kinds = Object.freeze({ expense: "Расход", income: "Доход", refund: "Возврат" });
  const money = (amount, currency) => e(formatExpenseAmount(amount, currency));
  const dateText = date => date.split("-").reverse().join(".");
  const monthText = value => new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${value}-15T12:00:00`));
  function shiftMonth(value, offset) {
    const [year, month] = value.split("-").map(Number), index = year * 12 + month - 1 + offset, nextYear = Math.floor(index / 12);
    return nextYear >= 1900 && nextYear <= 9999 ? `${nextYear}-${String(index % 12 + 1).padStart(2, "0")}` : "";
  }
  const option = (value, label, selected) => `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(label)}</option>`;
  const field = (label, input, wide = false) => `<label class="expenses-field${wide ? " expenses-wide" : ""}"><span>${label}</span>${input}</label>`;
  const button = (action, title, extra = "") => `<button class="app-btn" type="button" data-exp-action="${action}" ${extra}>${title}</button>`;
  function createExpensesApp(params = {}, options = {}) {
    const doc = options.documentRef || document, controller = options.controller, root = doc.createElement("div");
    root.className = "expenses-app";
    root.tabIndex = -1;
    let month = localExpenseDate().slice(0, 7), currency = controller.data().currency, view = "overview", busy = false, modal = null, limit = 80, savedEntry = null;
    let selectedEntryId = "", pendingRevealId = "";
    const filters = { query: "", categoryId: "", kind: "", projectId: "*", paymentMethod: "", period: "month", from: "", to: "" };
    root.innerHTML = `<header class="expenses-header"><div class="expenses-brand"><span class="expenses-brand-icon" aria-hidden="true">↗↘</span><div><h1>Расходы и Доходы</h1><p data-exp-workspace></p></div></div><div class="expenses-add-actions">${button("add-expense", "− Расход", 'data-exp-write')}${button("add-income", "+ Доход", 'data-exp-write')}</div></header>
      <div class="expenses-period"><div class="expenses-month-controls">${button("previous-month", "‹", 'aria-label="Предыдущий месяц"')}<label><span class="expenses-visually-hidden">Период</span><input class="app-input" aria-label="Месяц отчёта" type="month" min="1900-01" max="9999-12" data-exp-month value="${month}"></label>${button("next-month", "›", 'aria-label="Следующий месяц"')}</div><label>Валюта<select class="app-input" data-exp-currency>${CURRENCIES.map(code => option(code, code, currency)).join("")}</select></label>${button("current-month", "Сейчас", 'aria-label="Текущий месяц"')}<span>Итоги отдельно по каждой валюте</span></div>
      <nav class="expenses-tabs" aria-label="Разделы финансов">${[["overview", "Обзор"], ["history", "Операции"], ["categories", "Категории"], ["budgets", "Лимиты расходов"]].map(([id, label]) => button("tab", label, `data-exp-view="${id}" aria-current="${view === id ? "page" : "false"}"`)).join("")}</nav>
      <p class="expenses-status" data-exp-status role="status" aria-live="polite" hidden></p><main class="expenses-content" data-exp-content></main>`;
    const content = root.querySelector("[data-exp-content]");
    root.querySelector('[data-exp-action="add-expense"]').classList.add("primary");
    function status(text, error = false, action = null) {
      const node = root.querySelector("[data-exp-status]"); node.hidden = !text; node.textContent = text; node.classList.toggle("error", error);
      if (action) { const control = doc.createElement("button"); control.className = "app-btn"; control.type = "button"; control.dataset.expAction = action.name; control.textContent = action.label; node.append(control); }
    }
    function syncPeriod() {
      root.querySelector("[data-exp-month]").value = month;
      root.querySelector("[data-exp-currency]").value = currency;
      root.querySelector('[data-exp-action="previous-month"]').disabled = busy || !shiftMonth(month, -1);
      root.querySelector('[data-exp-action="next-month"]').disabled = busy || !shiftMonth(month, 1);
    }
    function resetFilters(period = "month") { Object.assign(filters, { query: "", categoryId: "", kind: "", projectId: "*", paymentMethod: "", period, from: "", to: "" }); limit = 80; selectedEntryId = ""; }
    function setBusy(value) {
      busy = value; root.setAttribute("aria-busy", String(value));
      root.querySelectorAll("button,input,select,textarea").forEach(node => { node.disabled = value; });
      if (!value && modal) modal.querySelectorAll("[data-exp-fixed]").forEach(node => { node.disabled = true; });
      syncPeriod();
    }
    function monthSummary() { return summarizeExpenses(controller.data(), { month, currency }); }
    function historyFilter() { return { currency, query: filters.query, categoryId: filters.categoryId, kind: filters.kind, projectId: filters.projectId === "*" ? null : filters.projectId, paymentMethod: filters.paymentMethod, ...(filters.period === "month" ? { month } : filters.period === "custom" ? { from: filters.from, to: filters.to } : {}) }; }
    function budgetHTML(item, data, summary) {
      const category = data.categories.find(row => row.id === item.categoryId), used = item.categoryId ? summary.categories.find(row => row.id === item.categoryId)?.amountMinor || 0 : summary.netMinor;
      const percent = Math.max(0, Math.round(used / item.limitMinor * 100)), over = used > item.limitMinor;
      return `<article class="expenses-budget${over ? " over" : percent >= 80 ? " near" : ""}"><div class="expenses-section-title"><strong>${e(category?.name || "Все расходы")}</strong>${button("budget", "Изменить", `data-exp-id="${e(item.categoryId)}"`)}</div><div class="expenses-budget-values"><span>${money(used, currency)} <small>из ${money(item.limitMinor, currency)}</small></span><b>${percent}%</b></div><progress max="100" value="${Math.min(100, percent)}" aria-label="Использовано ${percent}% лимита"></progress><p>${over ? `Превышение на ${money(used - item.limitMinor, currency)}` : `Осталось ${money(item.limitMinor - used, currency)}`}</p></article>`;
    }
    function categoryReport(summary, kind) {
      const rows = summary.categories.filter(item => item.kind === kind), max = Math.max(1, ...rows.map(item => Math.abs(item.amountMinor))), total = rows.reduce((sum, item) => sum + item.amountMinor, 0), shares = total > 0 && rows.every(item => item.amountMinor >= 0);
      return `<section class="expenses-panel"><div class="expenses-section-title"><h2>${kind === "income" ? "Доходы" : "Расходы"} по категориям</h2><span>${rows.length}</span></div>${rows.length ? rows.map(item => `<div class="expenses-report-row"><div><span><button type="button" class="expenses-report-link" data-exp-action="category-history" data-exp-id="${e(item.id)}" aria-label="Операции категории ${e(item.name)}">${e(item.name)}</button></span><strong>${money(item.amountMinor, currency)}${shares ? `<small>${Math.round(item.amountMinor / total * 100)}% от ${kind === "income" ? "доходов" : "расходов"}</small>` : ""}</strong></div><progress style="--expense-color:${item.color}" max="${max}" value="${Math.abs(item.amountMinor)}" aria-label="${e(item.name)}: ${money(item.amountMinor, currency)}"></progress></div>`).join("") : '<p class="expenses-muted">В этом месяце записей пока нет.</p>'}</section>`;
    }
    function emptyOverview(data) {
      if (!data.entries.length) return `<div class="expenses-welcome"><span aria-hidden="true">↗↘</span><div><h2>Начните с одной записи</h2><p>Добавьте покупку или доход — здесь появятся итоги и распределение денег.</p></div><div class="expenses-welcome-actions">${button("add-expense", "Записать расход")}${button("add-income", "Записать доход")}</div></div>`;
      const hasCurrency = data.entries.some(item => item.currency === currency);
      return `<div class="expenses-empty"><h2>За ${e(monthText(month))} в ${e(currency)} операций нет</h2><p>${hasCurrency ? "Записи за другие месяцы сохранены. Выберите другой месяц или откройте историю." : "История в других валютах сохранена. Выберите нужную валюту или покажите последнюю запись."}</p>${button(hasCurrency ? "all-history" : "show-latest", hasCurrency ? "Все даты · " + e(currency) : "Показать последнюю запись")}${button("add-expense", "Записать расход")}</div>`;
    }
    function comparisonHTML(data, summary) {
      const previousMonth = shiftMonth(month, -1);
      if (!previousMonth || !summary.count && !data.entries.some(item => item.currency === currency && item.date.slice(0, 7) === previousMonth)) return "";
      const previous = summarizeExpenses(data, { month: previousMonth, currency });
      if (!previous.count) return `<p class="expenses-muted expenses-comparison">Сравнение с ${e(monthText(previousMonth))}: записей в ${e(currency)} пока нет.</p>`;
      const difference = summary.netMinor - previous.netMinor;
      const percent = previous.netMinor > 0 && summary.netMinor >= 0 ? ` (${Math.round(Math.abs(difference) / previous.netMinor * 100)}%)` : "";
      return `<section class="expenses-panel expenses-comparison"><h2>Сравнение с прошлым месяцем</h2><p>${e(monthText(previousMonth))}: расходы ${money(previous.netMinor, currency)}.</p><p>${difference ? `В выбранном месяце на ${money(Math.abs(difference), currency)}${percent} ${difference > 0 ? "больше" : "меньше"}.` : "Расходы совпадают с прошлым месяцем."}</p><small>Сравниваются записанные операции; возвраты учитываются по своей дате.</small></section>`;
    }
    function renderOverview() {
      const data = controller.data(), summary = monthSummary(), budgets = data.budgets.filter(item => item.month === month && item.currency === currency), recent = filterExpenses(data, { month, currency }).slice(0, 5);
      content.innerHTML = `<div class="expenses-stats"><article class="expenses-stat income"><span>Доходы за месяц</span><strong>${money(summary.incomeMinor, currency)}</strong><small>Все поступления</small></article><article class="expenses-stat"><span>Расходы за месяц</span><strong>${money(summary.netMinor, currency)}</strong><small>${summary.refundMinor ? `Покупки ${money(summary.spentMinor, currency)} · возвраты ${money(summary.refundMinor, currency)}` : "С учётом возвратов"}</small></article><article class="expenses-stat balance${summary.balanceMinor < 0 ? " negative" : ""}"><span>Разница за месяц</span><strong>${money(summary.balanceMinor, currency)}</strong><small>Доходы минус расходы · не остаток счёта</small></article></div>
      ${!summary.count ? emptyOverview(data) : `<div class="expenses-report-grid">${categoryReport(summary, "expense")}${categoryReport(summary, "income")}</div>`}${comparisonHTML(data, summary)}
      <section class="expenses-panel${budgets.length ? "" : " expenses-budget-empty"}"><div class="expenses-section-title"><h2>Лимиты на месяц</h2>${button("budget", "+ Лимит", 'data-exp-id=""')}</div>${budgets.length ? `<div class="expenses-budget-grid">${budgets.map(item => budgetHTML(item, data, summary)).join("")}</div>` : '<p class="expenses-muted">Задайте общий лимит или ограничение для категории расходов.</p>'}</section>
      ${recent.length ? `<section class="expenses-panel"><div class="expenses-section-title"><h2>Последние операции</h2>${button("tab", "Все операции →", 'data-exp-view="history"')}</div>${rowsHTML(recent, data)}</section>` : ""}`;
      content.querySelectorAll('[data-exp-action="add-expense"]').forEach(node => node.classList.add("primary"));
    }
    function rowsHTML(entries, data) {
      return `<div class="expenses-rows">${entries.map(item => { const category = data.categories.find(row => row.id === item.categoryId), selected = item.id === selectedEntryId; return `<article class="expenses-row${selected ? " is-selected" : ""}" data-exp-entry="${e(item.id)}"${selected ? ' tabindex="-1"' : ""}><span class="expenses-kind ${item.kind}" aria-label="${kinds[item.kind]}">${item.kind === "expense" ? "↘" : "↗"}</span><div class="expenses-row-description"><strong>${e(item.title || category?.name || kinds[item.kind])}</strong><span>${e(dateText(item.date))} · ${e(kinds[item.kind])} · ${e(category?.name || "")}${item.projectName ? ` · ${e(item.projectName)}` : ""}${item.paymentMethod ? ` · ${e(item.paymentMethod)}` : ""}</span>${item.notes ? `<p>${e(item.notes)}</p>` : ""}</div><strong class="expenses-row-amount ${item.kind}">${item.kind === "expense" ? "−" : "+"}${money(item.amountMinor, item.currency)}</strong><div class="expenses-row-actions">${button("edit", "Изменить", `data-exp-id="${e(item.id)}" aria-label="Изменить: ${e(item.title || category?.name || kinds[item.kind])}"`)}${["expense", "income"].includes(item.kind) ? button("repeat", "Повторить", `data-exp-id="${e(item.id)}" aria-label="Повторить: ${e(item.title || category?.name || kinds[item.kind])}"`) : ""}${item.kind === "expense" ? button("refund", "Возврат", `data-exp-id="${e(item.id)}"`) : ""}${button("delete", "Удалить", `data-exp-id="${e(item.id)}"`)}</div></article>`; }).join("")}</div>`;
    }
    function renderHistoryRows() {
      const data = controller.data(), filter = historyFilter(), rows = filterExpenses(data, filter), summary = summarizeExpenses(data, filter);
      const invalidRange = filters.period === "custom" && filters.from && filters.to && filters.from > filters.to;
      const selection = [currency, filters.period === "month" ? monthText(month) : filters.period === "all" ? "Все даты" : `${filters.from ? dateText(filters.from) : "Без начала"} — ${filters.to ? dateText(filters.to) : "без конца"}`];
      if (filters.query) selection.push(`Поиск: ${filters.query}`);
      if (filters.kind) selection.push(kinds[filters.kind]);
      if (filters.categoryId) selection.push(`Категория: ${data.categories.find(item => item.id === filters.categoryId)?.name || "из истории"}`);
      if (filters.projectId !== "*") selection.push(`Проект: ${filters.projectId ? data.entries.find(item => item.projectId === filters.projectId)?.projectName || options.getWorkspace?.()?.taskProjects?.find(item => item.id === filters.projectId)?.name || "из истории" : "без проекта"}`);
      if (filters.paymentMethod) selection.push(`Оплата: ${filters.paymentMethod}`);
      root.querySelector("[data-exp-selection]").textContent = selection.join(" · ");
      root.querySelector("[data-exp-history-summary]").textContent = invalidRange ? "Начало периода должно быть не позже конца." : `Операций: ${rows.length} · Доходы: ${formatExpenseAmount(summary.incomeMinor, currency)} · Расходы: ${formatExpenseAmount(summary.netMinor, currency)} · Разница: ${formatExpenseAmount(summary.balanceMinor, currency)}`;
      root.querySelector("[data-exp-rows]").innerHTML = rows.length ? rowsHTML(rows.slice(0, limit), data) + (rows.length > limit ? button("more", `Показать ещё · осталось ${rows.length - limit}`) : "") : '<div class="expenses-empty"><h2>Операций не найдено</h2><p>Измените фильтры или добавьте новую запись.</p></div>';
    }
    function renderHistory() {
      const data = controller.data(), projects = new Map((options.getWorkspace?.()?.taskProjects || []).map(item => [item.id, item.name]));
      data.entries.forEach(item => { if (item.projectId && !projects.has(item.projectId)) projects.set(item.projectId, `${item.projectName || "Прежний проект"} (из истории)`); });
      content.innerHTML = `<div class="expenses-filters"><label class="expenses-search">Поиск<input class="app-input" type="search" data-exp-filter="query" placeholder="Название, комментарий, проект" value="${e(filters.query)}"></label><label>Вид<select class="app-input" data-exp-filter="kind">${option("", "Все операции", filters.kind)}${Object.entries(kinds).map(([id, name]) => option(id, name, filters.kind)).join("")}</select></label><label>Категория<select class="app-input" data-exp-filter="categoryId">${option("", "Все категории", filters.categoryId)}${data.categories.map(item => option(item.id, `${item.kind === "income" ? "Доход" : "Расход"} · ${item.name}`, filters.categoryId)).join("")}</select></label><label>Проект<select class="app-input" data-exp-filter="projectId">${option("*", "Все проекты", filters.projectId)}${option("", "Без проекта", filters.projectId)}${[...projects].map(([id, name]) => option(id, name, filters.projectId)).join("")}</select></label><label>Оплата<select class="app-input" data-exp-filter="paymentMethod">${option("", "Любой способ", filters.paymentMethod)}${[...new Set(data.entries.map(item => item.paymentMethod).filter(Boolean))].map(name => option(name, name, filters.paymentMethod)).join("")}</select></label><label>Даты<select class="app-input" data-exp-filter="period">${[["month", "Выбранный месяц"], ["all", "Все даты"], ["custom", "Свой период"]].map(([id, name]) => option(id, name, filters.period)).join("")}</select></label><label data-exp-custom${filters.period === "custom" ? "" : " hidden"}>С<input class="app-input" type="date" data-exp-filter="from" min="1900-01-01" max="9999-12-31" value="${e(filters.from)}"></label><label data-exp-custom${filters.period === "custom" ? "" : " hidden"}>По<input class="app-input" type="date" data-exp-filter="to" min="1900-01-01" max="9999-12-31" value="${e(filters.to)}"></label></div><div class="expenses-history-heading"><p data-exp-history-summary></p>${button("export", "Скачать CSV")}</div><div data-exp-rows></div>`;
      const heading = content.querySelector(".expenses-history-heading"), selection = doc.createElement("p"); selection.className = "expenses-selection"; selection.dataset.expSelection = "";
      heading.before(selection); heading.insertAdjacentHTML("beforeend", button("reset-filters", "Сбросить фильтры"));
      renderHistoryRows();
    }
    function renderCategories() {
      const data = controller.data();
      content.innerHTML = `<div class="expenses-section-title"><div><h2>Ваши категории</h2><p class="expenses-muted">Скрытые категории остаются в истории и отчётах.</p></div>${button("category", "+ Категория")}</div><div class="expenses-report-grid">${["expense", "income"].map(kind => `<section class="expenses-panel"><h2>${kind === "income" ? "Доходы" : "Расходы"}</h2>${data.categories.filter(item => item.kind === kind).map(item => `<div class="expenses-category"><span class="expenses-dot" style="--expense-color:${item.color}" aria-hidden="true"></span><div><strong>${e(item.name)}</strong>${item.archived ? '<small>Скрыта для новых записей</small>' : ""}</div>${button("category", "Изменить", `data-exp-id="${e(item.id)}" aria-label="Изменить категорию ${e(item.name)}"`)}</div>`).join("")}</section>`).join("")}</div>`;
    }
    function renderBudgets() {
      const data = controller.data(), summary = monthSummary(), rows = data.budgets.filter(item => item.month === month && item.currency === currency);
      content.innerHTML = `<div class="expenses-section-title"><div><h2>Лимиты расходов</h2><p class="expenses-muted">${e(month)} · ${e(currency)} · учитываются покупки за вычетом возвратов.</p></div><div class="expenses-inline-actions">${button("copy-budgets", "Из прошлого месяца")}${button("budget", "+ Лимит", 'data-exp-id=""')}</div></div><div class="expenses-budget-grid">${rows.map(item => budgetHTML(item, data, summary)).join("")}</div>${!rows.length ? '<div class="expenses-empty"><h2>Лимиты пока не заданы</h2><p>Установите общий лимит на месяц или выберите категорию расходов.</p></div>' : ""}<p class="expenses-muted">При 80% появляется предупреждение. Превышение лимита не мешает записывать покупки. Категории входят в общий лимит, а не прибавляются к нему.</p>`;
    }
    function render() {
      const scroll = content.scrollTop, focused = doc.activeElement, action = content.contains(focused) ? focused?.dataset?.expAction : null;
      const filterName = content.contains(focused) ? focused?.dataset?.expFilter : null;
      const selection = filterName && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
      const fieldScroll = filterName ? focused.scrollLeft : 0;
      root.querySelector("[data-exp-workspace]").textContent = `Рабочий стол: ${options.getWorkspaceName?.() || "Текущий"}`;
      syncPeriod();
      root.querySelectorAll("[data-exp-view]").forEach(node => node.setAttribute("aria-current", node.dataset.expView === view ? "page" : "false"));
      ({ overview: renderOverview, history: renderHistory, categories: renderCategories, budgets: renderBudgets })[view]();
      content.scrollTop = scroll;
      if (filterName) {
        const successor = [...content.querySelectorAll("[data-exp-filter]")].find(node => node.dataset.expFilter === filterName);
        if (successor && !successor.disabled) {
          successor.focus({ preventScroll: true });
          if (selection) successor.setSelectionRange(...selection);
          successor.scrollLeft = fieldScroll;
        }
      } else if (action) {
        const successor = [...content.querySelectorAll("[data-exp-action]")].find(node => node.dataset.expAction === action && node.dataset.expId === focused.dataset.expId && node.dataset.expView === focused.dataset.expView);
        (successor || root.querySelector('[data-exp-action="add-expense"]')).focus({ preventScroll: true });
      }
      if (busy) root.querySelectorAll("button,input,select,textarea").forEach(node => { node.disabled = true; });
      modal?.refreshEntryHints?.();
    }
    async function commit(operation, after, success = "Сохранено") {
      if (busy) return false;
      const focused = doc.activeElement;
      setBusy(true); status("Сохранение…");
      let result;
      try { result = await operation(); }
      catch (error) {
        setBusy(false); const message = error?.message || "Не удалось сохранить. Повторите попытку.";
        status(message, true); const node = modal?.querySelector("[data-exp-dialog-error]"); if (node) { node.hidden = false; node.textContent = message; }
        modal?.refreshEntryHints?.();
        if (focused?.isConnected && root.contains(focused) && !focused.disabled && (!modal || modal.contains(focused))) focused.focus({ preventScroll: true });
        else modal?.querySelector('[autofocus]:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [data-exp-submit]')?.focus({ preventScroll: true });
        return false;
      }
      setBusy(false);
      try { after?.(result); render(); const notice = typeof success === "function" ? success(result) : success; status(notice?.text || notice, false, notice?.action); options.onChange?.(); revealPendingEntry(); }
      catch (_) { status("Сохранено. Откройте приложение заново, если другие окна не обновились.", true); }
      return true;
    }
    function closeModal() {
      if (busy || !modal) return;
      const old = modal, focus = old.previousFocus; modal = null; old.close(); old.remove();
      status("");
      if (focus?.isConnected) focus.focus({ preventScroll: true }); else root.querySelector('[data-exp-action="add-expense"]').focus();
    }
    function openModal(title, body, submitLabel, submit, danger = false, allowNext = false) {
      if (modal || busy) return;
      const dialog = doc.createElement("dialog"), titleId = `expenses-dialog-${++dialogSequence}`;
      modal = dialog; dialog.previousFocus = doc.activeElement; dialog.className = "expenses-dialog"; dialog.setAttribute("aria-labelledby", titleId);
      dialog.innerHTML = `<form><header><h2 id="${titleId}">${e(title)}</h2><button type="button" class="app-btn" data-exp-close aria-label="Закрыть">×</button></header><div class="expenses-form-grid">${body}</div><p class="expenses-dialog-error" data-exp-dialog-error role="alert" hidden></p><footer><button type="button" class="app-btn" data-exp-close>Отмена</button><button type="submit" class="app-btn ${danger ? "expenses-danger" : "primary"}" data-exp-submit>${e(submitLabel)}</button></footer></form>`;
      if (allowNext) {
        dialog.querySelector("footer").insertAdjacentHTML("beforeend", '<button type="submit" class="app-btn" data-exp-submit-next>Сохранить и добавить ещё</button>');
        dialog.querySelector("footer").insertAdjacentHTML("beforebegin", '<p class="expenses-form-note" data-exp-dialog-status role="status" aria-live="polite" hidden></p>');
      }
      dialog.querySelectorAll("[data-exp-close]").forEach(node => node.addEventListener("click", closeModal));
      dialog.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });
      dialog.addEventListener("keydown", event => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
        const controls = [...dialog.querySelectorAll("button,input,select,textarea")].filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && doc.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && doc.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      });
      dialog.querySelector("form").addEventListener("submit", event => { event.preventDefault(); if (!busy) void submit(dialog.querySelector("form"), event.submitter); });
      root.append(dialog); dialog.showModal(); dialog.querySelector("[autofocus], input, select, textarea")?.focus();
    }
    function openEntry(kind, id = "", asRefund = false, initialDraft = null) {
      const data = controller.data(), original = id ? data.entries.find(item => item.id === id) : null;
      if (id && !original) { status("Запись уже удалена. Обновите список.", true); return; }
      const refund = asRefund, editing = Boolean(original && !refund), currentKind = editing ? original.kind : kind;
      const refundPurchase = refund ? original : currentKind === "refund" ? data.entries.find(item => item.id === original.originalEntryId) : null;
      const categoryKind = currentKind === "income" ? "income" : "expense", draft = editing ? { ...original } : initialDraft ? { currency: initialDraft.currency, date: localExpenseDate(), categoryId: data.categories.some(item => item.id === initialDraft.categoryId && !item.archived && item.kind === categoryKind) ? initialDraft.categoryId : "", title: initialDraft.title, paymentMethod: initialDraft.paymentMethod, projectId: initialDraft.projectId, projectName: initialDraft.projectName, notes: initialDraft.notes } : { currency: refundPurchase?.currency || currency, date: localExpenseDate(), categoryId: refundPurchase?.categoryId || data.categories.find(item => item.kind === categoryKind && !item.archived)?.id || "", title: refundPurchase ? `Возврат: ${refundPurchase.title || "покупка"}` : "", paymentMethod: refundPurchase?.paymentMethod || "Карта", projectId: refundPurchase?.projectId || "", projectName: refundPurchase?.projectName || "", notes: "" };
      if (!editing && !refundPurchase && !data.categories.some(item => item.kind === categoryKind && !item.archived)) { status(`Нет доступных категорий ${categoryKind === "income" ? "доходов" : "расходов"}. Создайте категорию или покажите скрытую.`, false, { name: "manage-categories", label: "Открыть категории" }); return; }
      const projects = options.getWorkspace?.()?.taskProjects || [], fixed = currentKind === "refund" ? ' disabled data-exp-fixed' : "";
      const remaining = refund ? original.amountMinor - data.entries.filter(item => item.originalEntryId === id).reduce((sum, item) => sum + item.amountMinor, 0) : 0;
      if (refund && remaining <= 0) { status("Стоимость покупки уже полностью возвращена.", true); return; }
      const amount = editing ? expenseAmountInput(original.amountMinor) : refund ? expenseAmountInput(remaining) : initialDraft ? expenseAmountInput(initialDraft.amountMinor) : "";
      const body = `${refundPurchase ? `<p class="expenses-form-note expenses-wide">Возврат к покупке от ${e(dateText(refundPurchase.date))}: ${e(refundPurchase.title || "Покупка")}. Учитывается по дате возврата.</p>` : ""}${field("Сумма", `<input class="app-input expenses-amount-input" name="amount" inputmode="decimal" autocomplete="off" maxlength="24" placeholder="0,00" required autofocus value="${e(amount)}">`)}${field("Валюта", `<select class="app-input" name="currency"${fixed}>${CURRENCIES.map(code => option(code, code, draft.currency)).join("")}</select>`)}${field("Категория", `<select class="app-input" name="categoryId" required${fixed}>${!draft.categoryId ? option("", "Выберите доступную категорию", "") : ""}${data.categories.filter(item => item.kind === categoryKind && (!item.archived || item.id === draft.categoryId)).map(item => option(item.id, item.name + (item.archived ? " (скрыта)" : ""), draft.categoryId)).join("")}</select>`)}${field("Дата", `<input class="app-input" name="date" type="date" min="${refundPurchase?.date || "1900-01-01"}" max="9999-12-31" required value="${e(draft.date)}">`)}${field("Название", `<input class="app-input" name="title" maxlength="300" placeholder="Например, ${currentKind === "income" ? "Оплата проекта" : "Продукты на неделю"}" value="${e(draft.title)}">`, true)}${field("Способ оплаты", `<input class="app-input" name="paymentMethod" maxlength="80" placeholder="Карта, наличные…" value="${e(draft.paymentMethod)}">`)}${field("Проект", `<select class="app-input" name="projectId"${fixed}>${option("", "Без проекта", draft.projectId)}${projects.map(item => option(item.id, item.name, draft.projectId)).join("")}${draft.projectId && !projects.some(item => item.id === draft.projectId) ? option(draft.projectId, `${draft.projectName || "Прежний проект"} (${initialDraft ? "недоступен — выберите другой" : "из истории"})`, draft.projectId) : ""}</select>`)}${field("Комментарий", `<textarea class="app-input" name="notes" rows="3" maxlength="4000">${e(draft.notes)}</textarea>`, true)}`;
      openModal(editing ? `Изменить: ${kinds[currentKind].toLocaleLowerCase("ru")}` : initialDraft ? `Повторить: ${kinds[currentKind].toLocaleLowerCase("ru")}` : kinds[currentKind], body, "Сохранить", (form, submitter) => {
        const get = name => form.elements.namedItem(name).value;
        const addNext = !editing && currentKind !== "refund" && Boolean(submitter?.hasAttribute("data-exp-submit-next"));
        const notice = modal.querySelector("[data-exp-dialog-status]"); if (notice) notice.hidden = true;
        void commit(() => controller.saveEntry({ amount: get("amount"), currency: get("currency"), date: get("date"), categoryId: get("categoryId"), title: get("title"), notes: get("notes"), paymentMethod: get("paymentMethod"), projectId: get("projectId"), kind: currentKind, originalEntryId: refund ? id : original?.originalEntryId || "" }, editing ? id : "", editing ? original : null), entry => {
          savedEntry = entry;
          if (!addNext) { closeModal(); return; }
          for (const name of ["amount", "title", "notes"]) form.elements.namedItem(name).value = "";
          modal.querySelector("[data-exp-dialog-error]").hidden = true;
          notice.hidden = false; notice.textContent = "Запись сохранена. Можно добавить следующую.";
          form.elements.namedItem("amount").focus({ preventScroll: true });
        }, entry => ({ text: entry.date.slice(0, 7) !== month || entry.currency !== currency ? `Запись сохранена за ${dateText(entry.date)} · ${entry.currency}. Она вне выбранного периода или валюты.` : "Сохранено", action: { name: "show-saved", label: "Показать запись" } }));
      }, false, !editing && currentKind !== "refund");
      if (!modal) return;
      const form = modal.querySelector("form"), grid = modal.querySelector(".expenses-form-grid");
      grid.insertAdjacentHTML("afterbegin", '<p class="expenses-form-note expenses-wide" data-exp-period-note role="status" aria-live="polite" hidden></p>');
      if (refundPurchase) grid.insertAdjacentHTML("afterbegin", '<p class="expenses-form-note expenses-wide" data-exp-refund-note role="status" aria-live="polite"></p>');
      if (editing && currentKind === "expense") grid.insertAdjacentHTML("afterbegin", '<p class="expenses-form-note expenses-wide" data-exp-purchase-note hidden></p>');
      if (initialDraft && (!draft.categoryId || draft.projectId && !projects.some(item => item.id === draft.projectId))) grid.insertAdjacentHTML("afterbegin", '<p class="expenses-form-note expenses-wide">Категория или проект исходной записи недоступны. Выберите доступную категорию и проект либо «Без проекта». Это новый черновик; исходная запись сохранена.</p>');
      modal.refreshEntryHints = () => {
        const selectedDate = form.elements.date.value, selectedCurrency = form.elements.currency.value, periodNote = modal.querySelector("[data-exp-period-note]");
        periodNote.hidden = !selectedDate || selectedDate.slice(0, 7) === month && selectedCurrency === currency;
        periodNote.textContent = periodNote.hidden ? "" : `Запись попадёт в ${monthText(selectedDate.slice(0, 7))} · ${selectedCurrency}. Сейчас открыт ${monthText(month)} · ${currency}.`;
        const latest = refundPurchase || editing && currentKind === "expense" ? controller.data() : null;
        if (refundPurchase) {
          const purchase = latest.entries.find(item => item.id === refundPurchase.id), note = modal.querySelector("[data-exp-refund-note]");
          const returned = latest.entries.filter(item => item.originalEntryId === refundPurchase.id && item.id !== (editing ? id : "")).reduce((sum, item) => sum + item.amountMinor, 0);
          note.textContent = purchase ? `${editing ? "Максимальная сумма этого возврата" : "Можно вернуть ещё"}: ${formatExpenseAmount(Math.max(0, purchase.amountMinor - returned), purchase.currency)}.` : "Исходная покупка недоступна. Закройте форму и обновите историю.";
        }
        const purchaseNote = modal.querySelector("[data-exp-purchase-note]");
        if (purchaseNote) {
          const refunds = latest.entries.filter(item => item.originalEntryId === id), total = refunds.reduce((sum, item) => sum + item.amountMinor, 0);
          purchaseNote.hidden = !refunds.length;
          purchaseNote.textContent = refunds.length ? `У покупки есть возвраты: ${formatExpenseAmount(total, draft.currency)}. Сумма покупки не может быть меньше возвращённой; дата — не позже ${dateText(refunds.map(item => item.date).sort()[0])}. Валюта, категория и проект должны совпадать с возвратами.` : "";
        }
      };
      const updatePeriodHint = event => { if (["date", "currency"].includes(event.target.name)) modal?.refreshEntryHints?.(); };
      form.addEventListener("input", updatePeriodHint);
      form.addEventListener("change", updatePeriodHint);
      modal.refreshEntryHints();
    }
    function openCategory(id = "") {
      const original = controller.data().categories.find(item => item.id === id);
      openModal(original ? "Изменить категорию" : "Новая категория", `${field("Название", `<input class="app-input" name="name" required maxlength="100" autofocus value="${e(original?.name || "")}">`, true)}${field("Для операций", `<select class="app-input" name="kind"${original ? " disabled data-exp-fixed" : ""}>${option("expense", "Расходы", original?.kind || "expense")}${option("income", "Доходы", original?.kind || "expense")}</select>`)}${field("Цвет", `<select class="app-input" name="color">${CATEGORY_COLORS.map((color, i) => option(color, ["Мятный", "Голубой", "Сиреневый", "Песочный", "Розовый", "Бирюзовый"][i], original?.color || CATEGORY_COLORS[0])).join("")}</select>`)}${original ? `<label class="expenses-check expenses-wide"><input type="checkbox" name="archived"${original.archived ? " checked" : ""}> Скрыть для новых записей</label>` : ""}`, "Сохранить", form => void commit(() => controller.saveCategory({ name: form.elements.name.value, kind: form.elements.kind.value, color: form.elements.color.value, archived: form.elements.archived?.checked || false }, id, original), closeModal));
    }
    function openBudget(categoryId = "") {
      const budgetMonth = month, budgetCurrency = currency;
      const data = controller.data(), budgets = data.budgets.filter(item => item.month === budgetMonth && item.currency === budgetCurrency), current = budgets.find(item => item.categoryId === categoryId);
      openModal("Лимит расходов", `<p class="expenses-form-note expenses-wide">${e(month)} · ${e(currency)}. Пустая сумма убирает лимит.</p>${field("Категория", `<select class="app-input" name="categoryId">${option("", "Все расходы", categoryId)}${data.categories.filter(item => item.kind === "expense").map(item => option(item.id, item.name, categoryId)).join("")}</select>`, true)}${field("Сумма лимита", `<input class="app-input" name="amount" inputmode="decimal" maxlength="24" autofocus placeholder="Не задан" value="${current ? expenseAmountInput(current.limitMinor) : ""}">`, true)}`, "Сохранить", form => void commit(() => controller.setBudget({ month: budgetMonth, currency: budgetCurrency, categoryId: form.elements.categoryId.value, amount: form.elements.amount.value }, budgets.find(item => item.categoryId === form.elements.categoryId.value) || null), closeModal));
      modal?.querySelector('[name="categoryId"]').addEventListener("change", event => { const selected = budgets.find(item => item.categoryId === event.target.value); modal.querySelector('[name="amount"]').value = selected ? expenseAmountInput(selected.limitMinor) : ""; });
    }
    function openBudgetCopy() {
      const data = controller.data(), fromMonth = shiftMonth(month, -1), toMonth = month, selectedCurrency = currency;
      const expectedBudgets = data.budgets.filter(item => item.currency === selectedCurrency && [fromMonth, toMonth].includes(item.month)), source = expectedBudgets.filter(item => item.month === fromMonth);
      if (!fromMonth || !source.length) { status("В прошлом месяце нет лимитов для этой валюты."); return; }
      const body = `<p class="expenses-form-note expenses-wide">${e(monthText(fromMonth))} → ${e(monthText(toMonth))} · ${e(selectedCurrency)}. Существующие лимиты сохраняются, пока вы явно не разрешите замену.</p><div class="expenses-copy-list expenses-wide">${source.map(item => { const existing = expectedBudgets.find(row => row.month === toMonth && row.categoryId === item.categoryId); return `<div class="expenses-copy-row"><strong>${e(data.categories.find(row => row.id === item.categoryId)?.name || "Все расходы")}</strong><span>${money(item.limitMinor, selectedCurrency)}${existing ? `<small>Сейчас ${money(existing.limitMinor, selectedCurrency)} · без замены сохранится</small>` : "<small>Новый лимит</small>"}</span></div>`; }).join("")}</div><label class="expenses-check expenses-wide"><input type="checkbox" name="replaceExisting"> Заменить существующие лимиты значениями из прошлого месяца</label>`;
      openModal("Копировать лимиты", body, "Скопировать", form => void commit(() => controller.copyBudgets({ fromMonth, toMonth, currency: selectedCurrency, expectedBudgets, replaceExisting: form.elements.replaceExisting.checked }), closeModal, result => `Скопировано лимитов: ${result.copied}. Сохранено существующих без замены: ${result.skipped}.`));
    }
    function revealPendingEntry() {
      if (!pendingRevealId) return;
      const row = [...content.querySelectorAll("[data-exp-entry]")].find(node => node.dataset.expEntry === pendingRevealId);
      pendingRevealId = "";
      if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); }
    }
    function showEntryPeriod(entry) {
      if (!entry) { status("Запись уже удалена или недоступна.", true); return; }
      const show = () => {
        month = entry.date.slice(0, 7); currency = entry.currency; view = "history"; resetFilters();
        const index = filterExpenses(controller.data(), historyFilter()).findIndex(item => item.id === entry.id);
        limit = Math.max(80, Math.ceil((index + 1) / 80) * 80);
        selectedEntryId = entry.id; pendingRevealId = entry.id;
      };
      if (currency !== entry.currency) void commit(() => controller.setCurrency(entry.currency), show, "Показаны операции за выбранный месяц.");
      else { show(); render(); status(""); revealPendingEntry(); }
    }
    root.addEventListener("click", event => {
      const target = event.target.closest("[data-exp-action]"); if (!target || busy || modal) return;
      const action = target.dataset.expAction, id = target.dataset.expId || "";
      if (["previous-month", "next-month", "current-month"].includes(action)) { month = action === "current-month" ? localExpenseDate().slice(0, 7) : shiftMonth(month, action === "previous-month" ? -1 : 1) || month; render(); status(""); return; }
      if (action === "all-history" || action === "reset-filters") { resetFilters(action === "all-history" ? "all" : "month"); view = "history"; render(); status(""); return; }
      if (action === "show-saved" || action === "show-latest") { showEntryPeriod(action === "show-saved" ? controller.data().entries.find(item => item.id === savedEntry?.id) : filterExpenses(controller.data())[0]); return; }
      if (action === "manage-categories") { view = "categories"; render(); status(""); root.querySelector('[data-exp-action="category"]').focus(); return; }
      if (action === "tab") { view = target.dataset.expView; render(); return; }
      if (action === "category-history") {
        if (!controller.data().categories.some(item => item.id === id)) { status("Категория уже недоступна. Обновите отчёт.", true); return; }
        resetFilters(); filters.categoryId = id; view = "history"; content.scrollTop = 0; render();
        const row = content.querySelector("[data-exp-entry]");
        if (row) { row.tabIndex = -1; row.focus({ preventScroll: true }); row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); }
        else content.querySelector('[data-exp-filter="query"]').focus({ preventScroll: true });
        status(""); return;
      }
      if (action === "add-expense" || action === "add-income") return openEntry(action === "add-income" ? "income" : "expense");
      if (action === "edit") { const item = controller.data().entries.find(row => row.id === id); if (item) openEntry(item.kind, id); return; }
      if (action === "refund") return openEntry("refund", id, true);
      if (action === "repeat") { const item = controller.data().entries.find(row => row.id === id); if (item && ["expense", "income"].includes(item.kind)) openEntry(item.kind, "", false, item); else status("Исходная операция уже недоступна.", true); return; }
      if (action === "category") return openCategory(id);
      if (action === "budget") return openBudget(id);
      if (action === "copy-budgets") return openBudgetCopy();
      if (action === "more") {
        const count = content.querySelectorAll("[data-exp-entry]").length;
        limit += 80; renderHistoryRows();
        const rows = [...content.querySelectorAll("[data-exp-entry]")], next = rows[count] || content.querySelector('[data-exp-action="more"]') || rows.at(-1) || content.querySelector('[data-exp-filter="query"]');
        if (next) { if (next.hasAttribute("data-exp-entry")) next.tabIndex = -1; next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); }
        return;
      }
      if (action === "export") { try { options.exportReport(expensesCSVRows(controller.data(), historyFilter())); status("CSV подготовлен для скачивания."); } catch (error) { status(error?.message || "Не удалось подготовить CSV.", true); } return; }
      if (action === "delete") {
        const original = controller.data().entries.find(item => item.id === id); if (!original) return;
        openModal("Удалить операцию?", `<p class="expenses-wide expenses-form-note">${e(original.title || kinds[original.kind])} · ${money(original.amountMinor, original.currency)} · ${e(dateText(original.date))}. Запись будет удалена из истории.</p>`, "Удалить", () => void commit(() => controller.removeEntry(id, original), closeModal), true);
      }
    });
    root.addEventListener("input", event => {
      const name = event.target.dataset.expFilter;
      if (name && !busy) { filters[name] = event.target.value; limit = 80; if (name === "period") root.querySelectorAll("[data-exp-custom]").forEach(node => { node.hidden = filters.period !== "custom"; }); renderHistoryRows(); }
    });
    root.querySelector("[data-exp-month]").addEventListener("change", event => {
      if (!/^\d{4}-\d{2}$/.test(event.target.value) || !event.target.validity.valid) { event.target.value = month; return; }
      month = event.target.value; render();
    });
    root.querySelector("[data-exp-currency]").addEventListener("change", event => {
      const previous = currency, selected = event.target.value;
      void commit(() => controller.setCurrency(selected), () => { currency = selected; }).then(saved => { if (!saved) event.target.value = previous; });
    });
    root.addEventListener("pointerdown", event => {
      if (!modal && !event.target.closest("button,input,select,textarea,a,label")) root.focus({ preventScroll: true });
    });
    root.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.code === "KeyF" || event.key.toLowerCase() === "f") && !modal) { event.preventDefault(); event.stopPropagation(); view = "history"; render(); root.querySelector('[data-exp-filter="query"]').focus(); }
    });
    root.refreshExpenses = render;
    render(); return root;
  }
  window.ZETER_EXPENSES_UI_UTILS = Object.freeze({ createExpensesApp });
})();
