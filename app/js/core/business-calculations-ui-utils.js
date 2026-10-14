(() => {
  "use strict";
  const { escapeHtml: e } = window.ZETER_CORE_UTILS;
  const { CALCULATIONS, CURRENCIES, calculateBusinessValues } = window.ZETER_BUSINESS_CALCULATIONS_UTILS;
  function formatCalculationValue(value, unit, currency) {
    if (value === null || !Number.isFinite(value)) return "—";
    const text = value.toLocaleString("ru-RU", { maximumFractionDigits: unit === "money" ? 2 : 1 });
    return unit === "money" ? `${text} ${currency}` : `${text}${unit === "%" || unit === "×" ? "" : " "}${unit}`;
  }
  function calculationResultsHTML(id, inputs, currency) {
    const result = calculateBusinessValues(id, inputs), max = Math.max(1, ...result.bars.map(bar => Math.abs(bar.value || 0)));
    return `<div class="calculation-metrics">${result.metrics.map(metric => `<div class="calculation-metric${metric.value < 0 ? " negative" : ""}"><span>${e(metric.label)}</span><strong data-calc-result="${e(metric.key)}">${e(formatCalculationValue(metric.value, metric.unit, currency))}</strong></div>`).join("")}</div>
      ${result.bars.length ? `<div class="calculation-chart" aria-label="Сравнение сумм">${result.bars.map(bar => `<div class="calculation-bar${bar.value < 0 ? " negative" : ""}"><span>${e(bar.label)}</span><meter min="0" max="${max}" value="${Math.abs(bar.value || 0)}" aria-label="${e(bar.label)}"></meter><b>${e(formatCalculationValue(bar.value, "money", currency))}</b></div>`).join("")}</div>` : ""}
      <p class="calculation-note${result.invalid.length ? " error" : ""}"${result.note ? "" : " hidden"}>${e(result.note)}</p>`;
  }
  function calculationCardHTML(item, inputs, currency, index, count, size = null) {
    const invalid = calculateBusinessValues(item.id, inputs).invalid;
    return `<article class="calculation-card" data-calc-card="${e(item.id)}"><header><button class="app-btn calculation-handle" type="button" data-calc-handle="${e(item.id)}" aria-label="Перетащить ${e(item.title)}" title="Перетащить карточку выше или ниже внутри Подсчётов">⠿</button><div class="calculation-heading"><small>${e(item.category)}</small><h2>${e(item.title)}</h2></div><span class="calculation-icon" aria-hidden="true">${e(item.icon)}</span></header>
      <div class="calculation-card-content"><p class="calculation-description">${e(item.description)}</p><div class="calculation-fields">${item.fields.map(entry => `<label><span>${e(entry.label)} <small>(${e(entry.unit === "money" ? currency : entry.unit)})${entry.max == null ? "" : ` · 0–${entry.max}`}</small></span><input class="app-input" type="text" inputmode="decimal" autocomplete="off" maxlength="48" data-calc-field="${e(entry.key)}" value="${e(inputs[entry.key])}" aria-label="${e(entry.label)}" aria-invalid="${invalid.includes(entry.key)}"></label>`).join("")}</div>
      <div data-calc-results>${calculationResultsHTML(item.id, inputs, currency)}</div></div><footer><div><button class="app-btn" type="button" data-calc-action="up" data-calc-id="${item.id}"${index === 0 ? " disabled" : ""} aria-label="Выше: ${e(item.title)}">↑ Выше</button><button class="app-btn" type="button" data-calc-action="down" data-calc-id="${item.id}"${index === count - 1 ? " disabled" : ""} aria-label="Ниже: ${e(item.title)}">↓ Ниже</button></div><div class="calculation-card-options"><button class="app-btn" type="button" data-calc-action="size-reset" data-calc-id="${item.id}"${size ? "" : " hidden"}>Сбросить размер</button><button class="app-btn" type="button" data-calc-action="hide" data-calc-id="${item.id}" title="Убрать с главного экрана, сохранив введённые значения">Убрать</button></div></footer><button class="calculation-resize-handle" type="button" data-calc-resize="${item.id}" aria-label="Изменить размер: ${e(item.title)}" title="Потяните для изменения размера. С клавиатуры — стрелки.">↘</button></article>`;
  }
  function createBusinessCalculationsApp(params = {}, options = {}) {
    const doc = options.documentRef || document, controller = options.controller, root = doc.createElement("div");
    root.className = "business-calculations-app";
    const drafts = new Map();
    let catalog = false, query = "", busy = 0, message = "", error = false, drag = null, resize = null, refreshPending = false;
    const view = doc.defaultView || window;
    const keyFor = (id, key) => `${id}:${key}`;
    function inputsFor(id, data) {
      const inputs = { ...data.inputs[id] };
      CALCULATIONS.find(item => item.id === id).fields.forEach(entry => {
        const key = keyFor(id, entry.key); if (drafts.has(key)) inputs[entry.key] = drafts.get(key);
      });
      return inputs;
    }
    function applyCardSize(card, size) {
      card.toggleAttribute("data-calc-size", Boolean(size));
      card.toggleAttribute("data-calc-wide", size?.span === 2);
      if (size) { card.style.setProperty("--calc-card-width", `${size.width}px`); card.style.setProperty("--calc-card-height", `${size.height}px`); }
      else { card.style.removeProperty("--calc-card-width"); card.style.removeProperty("--calc-card-height"); }
    }
    function status(text, failed = false) {
      message = text; error = failed;
      const node = root.querySelector("[data-calc-status]");
      if (node) { node.textContent = text; node.classList.toggle("error", failed); }
      root.querySelector("[data-calc-retry]")?.toggleAttribute("hidden", !drafts.size);
    }
    function catalogRows() {
      const data = controller.data(), needle = query.trim().toLocaleLowerCase();
      const items = CALCULATIONS.filter(item => `${item.title} ${item.category} ${item.description}`.toLocaleLowerCase().includes(needle));
      root.querySelector("[data-calc-catalog-list]").innerHTML = items.length ? items.map(item => `<div class="calculation-catalog-row"><span class="calculation-icon" aria-hidden="true">${e(item.icon)}</span><div><strong>${e(item.title)}</strong><p>${e(item.description)}</p></div><button class="app-btn" type="button" data-calc-action="add" data-calc-id="${item.id}"${data.selected.includes(item.id) || busy ? " disabled" : ""}>${data.selected.includes(item.id) ? "Добавлено" : "+ Добавить"}</button></div>`).join("") : '<p class="muted">Подсчёты не найдены. Измените поиск.</p>';
    }
    function render() {
      const active = doc.activeElement, cardId = active?.closest?.("[data-calc-card]")?.dataset.calcCard;
      const activeField = active?.dataset?.calcField, activeAction = active?.dataset?.calcAction, activeId = active?.dataset?.calcId;
      const selection = activeField ? [active.selectionStart, active.selectionEnd] : null;
      const previousScroll = root.querySelector("[data-calc-list]")?.scrollTop || 0;
      const data = controller.data();
      root.innerHTML = `<header class="calculation-app-header"><div><span class="calculation-eyebrow">Ваш рабочий стол · бизнес-калькуляторы</span><h1>Подсчёты</h1><p>Выберите нужные расчёты и расположите их в удобном порядке.</p></div><button class="app-btn primary" type="button" data-calc-action="catalog" aria-expanded="${catalog}">+ Добавить подсчёт</button></header>
        <div class="calculation-toolbar"><label>Валюта <select class="app-input" data-calc-currency aria-label="Валюта подсчётов">${CURRENCIES.map(currency => `<option${currency === data.currency ? " selected" : ""}>${currency}</option>`).join("")}</select></label><span>Карточек: ${data.selected.length} из ${CALCULATIONS.length}</span><p data-calc-status role="status" aria-live="polite" class="${error ? "error" : ""}">${e(message || "Изменения полей сохраняются после выхода из поля.")}</p><button class="app-btn" data-calc-retry type="button"${drafts.size ? "" : " hidden"}>Сохранить ввод</button></div>
        <section class="calculation-catalog" data-calc-catalog${catalog ? "" : " hidden"} aria-label="Каталог подсчётов"><div class="calculation-catalog-head"><h2>Добавить на главный экран</h2><button class="app-btn" type="button" data-calc-action="catalog-close">Закрыть</button></div><label class="calculation-search">Поиск подсчёта<input class="app-input" type="search" data-calc-search value="${e(query)}" placeholder="Название или назначение"></label><div data-calc-catalog-list></div></section>
        <p class="calculation-order-hint">Перемещайте карточки за ⠿, меняйте размер за ↘ в правом нижнем углу. Доступны кнопки «Выше» и «Ниже».</p><div class="calculation-list" data-calc-list aria-label="Мои подсчёты">${data.selected.length ? data.selected.map((id, index) => calculationCardHTML(CALCULATIONS.find(item => item.id === id), inputsFor(id, data), data.currency, index, data.selected.length, data.sizes[id])).join("") : '<div class="calculation-empty"><span>∑</span><h2>Соберите свой экран подсчётов</h2><p>Нажмите «Добавить подсчёт» и выберите нужные калькуляторы. Введённые значения убранных карточек сохранены.</p><button class="app-btn primary" type="button" data-calc-action="catalog">Выбрать подсчёты</button></div>'}</div>`;
      catalogRows();
      root.querySelectorAll("[data-calc-card]").forEach(card => applyCardSize(card, data.sizes[card.dataset.calcCard]));
      root.querySelector("[data-calc-list]").scrollTop = previousScroll;
      if (busy) root.querySelectorAll("button, select").forEach(node => { node.disabled = true; });
      const focus = activeField ? root.querySelector(`[data-calc-card="${cardId}"] [data-calc-field="${activeField}"]`) : activeAction ? root.querySelector(`[data-calc-action="${activeAction}"]${activeId ? `[data-calc-id="${activeId}"]` : ""}`) : null;
      if (focus && !focus.disabled) { focus.focus({ preventScroll: true }); if (selection) focus.setSelectionRange(...selection); }
    }
    function refreshResults(card) {
      const data = controller.data(), id = card.dataset.calcCard, inputs = inputsFor(id, data), result = calculateBusinessValues(id, inputs);
      card.querySelector("[data-calc-results]").innerHTML = calculationResultsHTML(id, inputs, data.currency);
      card.querySelectorAll("[data-calc-field]").forEach(input => input.setAttribute("aria-invalid", String(result.invalid.includes(input.dataset.calcField))));
    }
    function setBusy(delta) {
      busy += delta; root.setAttribute("aria-busy", String(busy > 0));
      // Re-render only controls; do not replace live input elements during a save.
      root.querySelectorAll("button, select").forEach(node => {
        const action = node.dataset.calcAction, id = node.dataset.calcId, selected = controller.data().selected;
        node.disabled = busy > 0 || (action === "up" && selected.indexOf(id) === 0) || (action === "down" && selected.indexOf(id) === selected.length - 1) || (action === "add" && selected.includes(id));
      });
    }
    async function saveField(id, key, value) {
      let saved = false;
      setBusy(1); status("Сохранение…");
      try {
        await controller.setInput(id, key, value);
        saved = true;
        if (drafts.get(keyFor(id, key)) === value) drafts.delete(keyFor(id, key));
        options.onChange?.(); status(drafts.size ? "Есть несохранённый ввод. Выйдите из поля." : "Сохранено");
        return true;
      } catch (caught) { status(saved ? "Ввод сохранён, но другие окна не обновились. Откройте их заново." : `${caught.message || "Не удалось сохранить."} Ввод оставлен в этом окне.`, true); return saved; }
      finally { setBusy(-1); }
    }
    async function flushDrafts() {
      for (const [key, value] of [...drafts]) {
        const [id, field] = key.split(":");
        if (!await saveField(id, field, value)) return false;
      }
      return true;
    }
    async function commit(operation, focusId = "") {
      if (busy || !await flushDrafts()) { render(); return; }
      let saved = false;
      setBusy(1); status("Сохранение…");
      try { await operation(); saved = true; options.onChange?.(); status("Сохранено"); }
      catch (caught) { status(saved ? "Изменение сохранено, но другие окна не обновились. Откройте их заново." : caught.message || "Изменение не сохранено.", true); }
      finally { setBusy(-1); render(); if (focusId) root.querySelector(`[data-calc-handle="${focusId}"]`)?.focus({ preventScroll: true }); }
    }
    root.addEventListener("input", event => {
      if (event.target.matches("[data-calc-search]")) { query = event.target.value; catalogRows(); return; }
      const input = event.target.closest("[data-calc-field]"), card = input?.closest("[data-calc-card]");
      if (!card) return;
      drafts.set(keyFor(card.dataset.calcCard, input.dataset.calcField), input.value);
      refreshResults(card); status("Ввод изменён. Сохранится после выхода из поля.");
    });
    root.addEventListener("change", event => {
      if (event.target.matches("[data-calc-currency]")) { const currency = event.target.value; commit(() => controller.setCurrency(currency)); return; }
      const input = event.target.closest("[data-calc-field]"), card = input?.closest("[data-calc-card]");
      if (card) saveField(card.dataset.calcCard, input.dataset.calcField, input.value);
    });
    root.addEventListener("click", async event => {
      if (event.target.closest("[data-calc-retry]")) { if (!busy && await flushDrafts()) render(); return; }
      const button = event.target.closest("[data-calc-action]"); if (!button || busy) return;
      const { calcAction: action, calcId: id } = button.dataset;
      if (action === "catalog" || action === "catalog-close") { catalog = action === "catalog" ? !catalog : false; render(); root.querySelector(catalog ? "[data-calc-search]" : '[data-calc-action="catalog"]')?.focus(); return; }
      if (action === "add") { await commit(() => controller.add(id)); return; }
      if (action === "size-reset") { await commit(() => controller.resetSize(id)); return; }
      if (action === "hide") { await commit(() => controller.remove(id)); return; }
      const order = controller.data().selected, index = order.indexOf(id), target = order[index + (action === "up" ? -1 : 1)];
      if (target && ["up", "down"].includes(action)) await commit(() => controller.reorder(id, target, action === "up" ? "before" : "after"), id);
    });
    const clearDrop = () => { root.querySelectorAll(".calculation-drop-target").forEach(node => node.classList.remove("calculation-drop-target")); };
    function movePreview(event) {
      const bounds = root.getBoundingClientRect();
      const x = Math.max(0, Math.min(bounds.width - drag.width, event.clientX - bounds.left - drag.offsetX));
      const y = Math.max(0, Math.min(bounds.height - drag.height, event.clientY - bounds.top - drag.offsetY));
      drag.preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    function createPreview(card) {
      const preview = card.cloneNode(true);
      [preview, ...preview.querySelectorAll("*")].forEach(node => {
        [...node.attributes].filter(attr => attr.name.startsWith("data-calc") || attr.name === "id").forEach(attr => node.removeAttribute(attr.name));
      });
      const originals = card.querySelectorAll("input"), copies = preview.querySelectorAll("input");
      originals.forEach((input, index) => { copies[index].value = input.value; });
      preview.classList.add("calculation-drag-preview"); preview.setAttribute("data-calc-drag-preview", "");
      preview.setAttribute("aria-hidden", "true"); preview.setAttribute("inert", "");
      const rect = card.getBoundingClientRect();
      preview.style.width = `${rect.width}px`; preview.style.height = `${rect.height}px`;
      root.append(preview); return preview;
    }
    root.addEventListener("pointerdown", event => {
      const handle = event.target.closest("[data-calc-handle]");
      if (!handle || event.button !== 0 || busy || drag || resize) return;
      event.preventDefault(); event.stopPropagation();
      const card = handle.closest("[data-calc-card]"), rect = card.getBoundingClientRect();
      drag = { id: handle.dataset.calcHandle, pointerId: event.pointerId, handle, target: "", preview: createPreview(card),
        width: rect.width, height: rect.height, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, x: event.clientX, y: event.clientY, frame: 0 };
      handle.setPointerCapture(event.pointerId); card.classList.add("calculation-dragging"); movePreview(event);
      doc.addEventListener("keydown", cancelInteraction, true);
      status(`Перемещение: ${CALCULATIONS.find(item => item.id === drag.id).title}`);
      drag.frame = view.requestAnimationFrame(autoScroll);
    });
    function dragTarget(event) {
      clearDrop(); drag.target = "";
      const node = doc.elementFromPoint(event.clientX, event.clientY), card = node?.closest("[data-calc-card]");
      if (!card || !root.contains(card) || card.dataset.calcCard === drag.id) return;
      drag.target = card.dataset.calcCard;
      card.classList.add("calculation-drop-target");
    }
    function autoScroll() {
      if (!drag) return;
      if (!root.isConnected) { finishDrag({ pointerId: drag.pointerId, stopPropagation() {} }, true); return; }
      const list = root.querySelector("[data-calc-list]"), rect = list.getBoundingClientRect();
      if (drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top && drag.y <= rect.bottom) {
        const before = list.scrollTop;
        if (drag.y < rect.top + 40) list.scrollTop -= 10;
        else if (drag.y > rect.bottom - 40) list.scrollTop += 10;
        if (list.scrollTop !== before) dragTarget({ clientX: drag.x, clientY: drag.y });
      }
      drag.frame = view.requestAnimationFrame(autoScroll);
    }
    root.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); drag.x = event.clientX; drag.y = event.clientY;
      movePreview(event); dragTarget(event);
    });
    const finishDrag = (event, cancelled = false) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.stopPropagation(); if (!cancelled) dragTarget(event);
      const current = drag; drag = null; clearDrop(); view.cancelAnimationFrame(current.frame); current.preview.remove();
      doc.removeEventListener("keydown", cancelInteraction, true);
      root.querySelector(`[data-calc-card="${current.id}"]`)?.classList.remove("calculation-dragging");
      if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      if (!cancelled && current.target) commit(() => controller.moveTo(current.id, current.target), current.id);
      else { status("Порядок не изменён."); if (refreshPending) render(); }
      refreshPending = false;
    };
    root.addEventListener("pointerup", event => finishDrag(event));
    root.addEventListener("pointercancel", event => finishDrag(event, true));
    root.addEventListener("lostpointercapture", event => finishDrag(event, true));
    function resizeLimits() {
      const list = root.querySelector("[data-calc-list]"), style = view.getComputedStyle(list);
      return { maxWidth: Math.max(280, Math.min(2400, list.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))), column: parseFloat(style.gridTemplateColumns), columns: style.gridTemplateColumns.split(" ").length };
    }
    function resizedValue(width, height) {
      const limits = resizeLimits(), w = Math.round(Math.max(280, Math.min(limits.maxWidth, width)));
      return { width: w, height: Math.round(Math.max(240, Math.min(2000, height))), span: limits.columns > 1 && w > limits.column + 12 ? 2 : 1 };
    }
    root.addEventListener("pointerdown", event => {
      const handle = event.target.closest("[data-calc-resize]");
      if (!handle || event.button !== 0 || busy || drag || resize) return;
      event.preventDefault(); event.stopPropagation();
      const card = handle.closest("[data-calc-card]"), rect = card.getBoundingClientRect();
      resize = { id: handle.dataset.calcResize, card, handle, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, size: null, frame: 0 };
      handle.setPointerCapture(event.pointerId); card.classList.add("calculation-resizing"); status("Изменение размера карточки…");
      doc.addEventListener("keydown", cancelInteraction, true);
      resize.frame = view.requestAnimationFrame(watchResize);
    });
    root.addEventListener("pointermove", event => {
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      resize.size = resizedValue(resize.width + event.clientX - resize.x, resize.height + event.clientY - resize.y);
      applyCardSize(resize.card, resize.size);
    });
    function finishResize(event, cancelled = false) {
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.stopPropagation(); const current = resize; resize = null;
      view.cancelAnimationFrame(current.frame); doc.removeEventListener("keydown", cancelInteraction, true);
      current.card.classList.remove("calculation-resizing");
      if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      if (!cancelled && current.size) commit(() => controller.setSize(current.id, current.size));
      else { status("Размер не изменён."); render(); }
      refreshPending = false;
    }
    function watchResize() {
      if (!resize) return;
      if (!root.isConnected) { finishResize({ pointerId: resize.pointerId, stopPropagation() {} }, true); return; }
      resize.frame = view.requestAnimationFrame(watchResize);
    }
    function cancelInteraction(event) {
      if (event.key !== "Escape" || (!drag && !resize)) return;
      event.preventDefault(); event.stopPropagation();
      if (drag) finishDrag({ pointerId: drag.pointerId, stopPropagation() {} }, true);
      if (resize) finishResize({ pointerId: resize.pointerId, stopPropagation() {} }, true);
    }
    root.addEventListener("pointerup", event => finishResize(event));
    root.addEventListener("pointercancel", event => finishResize(event, true));
    root.addEventListener("lostpointercapture", event => finishResize(event, true));
    root.addEventListener("keydown", event => {
      cancelInteraction(event);
      const handle = event.target.closest("[data-calc-resize]");
      if (!handle || busy || drag || resize || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const rect = handle.closest("[data-calc-card]").getBoundingClientRect(), id = handle.dataset.calcResize;
      const size = resizedValue(rect.width + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0), rect.height + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0));
      commit(() => controller.setSize(id, size)).then(() => root.querySelector(`[data-calc-resize="${id}"]`)?.focus({ preventScroll: true }));
    });
    root.refreshCalculations = () => { if (drag || resize) { refreshPending = true; return; } render(); };
    render(); return root;
  }
  window.ZETER_BUSINESS_CALCULATIONS_UI_UTILS = Object.freeze({ formatCalculationValue, calculationResultsHTML, calculationCardHTML, createBusinessCalculationsApp });
})();
