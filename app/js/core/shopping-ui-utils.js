(() => {
  "use strict";
  const escape = value => window.ZETER_CORE_UTILS.escapeHtml(String(value ?? ""));
  const ALL_CATEGORIES = "*"; // Not a valid persisted ID; imported category IDs remain unchanged.
  let projectMenuSequence = 0;
  function createShoppingApp(params = {}, options = {}) {
    const doc = options.documentRef || document, controller = options.controller;
    const root = doc.createElement("div"); root.className = "shopping-app";
    const projectMenuId = `shopping-project-menu-${++projectMenuSequence}`;
    let projectId = params.projectId || "", filter = "needed", categoryFilter = ALL_CATEGORIES, busy = false, modal = null;
    root.innerHTML = `
      <div data-window-header-tools-source><button class="shopping-settings-button" type="button" data-shop-settings aria-label="Настройки приложения Покупки" title="Настройки приложения Покупки">⚙</button></div>
      <fieldset class="shopping-controls" data-shop-controls><div class="shopping-layout">
        <aside class="shopping-sidebar" aria-label="Списки покупок"><div class="shopping-section-title">Мои списки</div><button class="app-btn shopping-create-project" type="button" data-shop-action="new-list">Создать список</button><nav data-shop-lists aria-label="Выбрать список покупок"></nav></aside>
        <section class="shopping-main"><div class="shopping-list-heading"><div class="shopping-project-heading"><div class="shopping-title-row"><h3 data-shop-title>Создайте список покупок</h3><button class="app-btn shopping-project-gear" type="button" data-shop-action="project-settings" aria-label="Действия списка" aria-expanded="false" aria-controls="${projectMenuId}">⋯</button></div><div class="shopping-project-menu" data-shop-project-menu id="${projectMenuId}" role="group" aria-label="Действия списка" hidden><button class="app-btn" type="button" data-shop-action="rename-list">Переименовать список</button><button class="app-btn" type="button" data-shop-action="clear-bought">Очистить купленное</button><button class="app-btn" type="button" data-shop-action="delete-list">Удалить список</button></div></div><button class="app-btn primary shopping-add-purchase" type="button" data-shop-action="new-item">Добавить покупку</button></div>


        <div class="shopping-filters"><div class="shopping-filter-tabs" role="group" aria-label="Какие товары показывать"><button class="app-btn" type="button" data-shop-filter="needed" aria-pressed="true">Нужно купить <span data-shop-count="needed"></span></button><button class="app-btn" type="button" data-shop-filter="bought" aria-pressed="false">Куплено <span data-shop-count="bought"></span></button><button class="app-btn" type="button" data-shop-filter="all" aria-pressed="false">Все <span data-shop-count="all"></span></button></div><label class="shopping-search"><span class="shopping-sr-only">Поиск товаров</span><input type="search" data-shop-search placeholder="Найти в списке" aria-label="Поиск товаров"></label></div>
        <div class="shopping-categories" role="group" aria-label="Категории"><label><span class="shopping-sr-only">Категория</span><select data-shop-category aria-label="Категория"></select></label><div class="shopping-category-tools"><button class="app-btn shopping-category-gear" type="button" data-shop-action="category-settings" aria-label="Управление категориями" aria-expanded="false" aria-controls="${projectMenuId}-categories">⚙</button><div class="shopping-category-menu" id="${projectMenuId}-categories" data-shop-category-menu role="group" aria-label="Управление категориями" hidden><button class="app-btn shopping-create-category" type="button" data-shop-action="new-category">Создать категорию</button><button class="app-btn" type="button" data-shop-action="rename-category">Переименовать категорию</button><button class="app-btn shopping-danger" type="button" data-shop-action="delete-category">Удалить категорию</button></div></div></div>
        <div class="shopping-items" data-shop-items></div></section>
      </div></fieldset><p class="shopping-status" data-shop-status role="status" aria-live="polite" hidden></p>`;
    const controls = root.querySelector("[data-shop-controls]"), search = root.querySelector("[data-shop-search]");
    const status = root.querySelector("[data-shop-status]"), settingsButton = root.querySelector("[data-shop-settings]");
    const action = name => root.querySelector(`[data-shop-action="${name}"]`);
    const selected = () => controller.data().projects.find(row => row.id === projectId);
    const projectMenu = root.querySelector("[data-shop-project-menu]"), projectHeading = root.querySelector(".shopping-project-heading");
    const categoryMenu = root.querySelector("[data-shop-category-menu]"), categoryTools = root.querySelector(".shopping-category-tools");
    function closeCategoryMenu(restoreFocus = false) {
      categoryMenu.hidden = true; action("category-settings").setAttribute("aria-expanded", "false");
      if (restoreFocus && !action("category-settings").matches(":disabled")) action("category-settings").focus();
    }
    categoryTools.addEventListener("focusout", event => { if (!categoryTools.contains(event.relatedTarget)) closeCategoryMenu(); });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && !categoryMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeCategoryMenu(true); }
    });
    function closeProjectMenu(restoreFocus = false) {
      projectMenu.hidden = true; action("project-settings").setAttribute("aria-expanded", "false");
      if (restoreFocus && !action("project-settings").disabled) action("project-settings").focus();
    }
    projectHeading.addEventListener("focusout", event => {
      if (!projectHeading.contains(event.relatedTarget)) closeProjectMenu();
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && !projectMenu.hidden) {
        event.preventDefault(); event.stopPropagation(); closeProjectMenu(true);
      }
    });
    function closeItemMenus(restoreFocus = false) {
      root.querySelectorAll("[data-shop-item-menu]:not([hidden])").forEach(menu => {
        menu.hidden = true;
        const button = menu.parentElement.querySelector('[data-shop-action="item-menu"]');
        button.setAttribute("aria-expanded", "false");
        if (restoreFocus) button.focus();
      });
    }
    function itemFocus(id, name) {
      const nodes = [...root.querySelectorAll("[data-shop-item]")].filter(node => node.dataset.shopItem === id);
      return nodes.find(node => node.dataset.shopAction === name && node.getClientRects().length) || nodes.find(node => node.dataset.shopAction === "item-menu");
    }
    root.addEventListener("focusout", event => {
      const actions = event.target.closest(".shopping-item-actions");
      if (actions && !actions.contains(event.relatedTarget)) closeItemMenus();
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && root.querySelector("[data-shop-item-menu]:not([hidden])")) {
        event.preventDefault(); event.stopPropagation(); closeItemMenus(true);
      }
    });
    function render() {
      const focused = root.contains(doc.activeElement) ? doc.activeElement : null, focusedAction = focused?.dataset?.shopAction, focusedItem = focused?.dataset?.shopItem;
      const data = controller.data(), prefs = data.preferences;
      root.dataset.shoppingDensity = prefs.density;
      root.classList.toggle("shopping-hide-descriptions", !prefs.showDescriptions);
      if (!data.projects.some(row => row.id === projectId)) projectId = data.projects[0]?.id || "";
      const list = data.projects.find(row => row.id === projectId), items = data.items.filter(row => row.projectId === projectId);
      const bought = items.filter(row => row.bought).length;
      const categories = data.categories.filter(row => row.projectId === projectId);
      if (categoryFilter !== ALL_CATEGORIES && categoryFilter !== "" && !categories.some(row => row.id === categoryFilter)) categoryFilter = ALL_CATEGORIES;
      const categoryOptions = categories.map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join("");
      root.querySelector("[data-shop-category]").innerHTML = `<option value="${ALL_CATEGORIES}">Все категории</option><option value="">Без категории</option>${categoryOptions}`;
      root.querySelector("[data-shop-category]").value = categoryFilter;
      ["rename-category", "delete-category"].forEach(name => { action(name).disabled = !categories.some(row => row.id === categoryFilter); });
      root.querySelector("[data-shop-lists]").innerHTML = data.projects.map(row => {
        const remaining = data.items.filter(item => item.projectId === row.id && !item.bought).length;
        return `<button class="app-btn shopping-list" type="button" data-shop-list="${escape(row.id)}" aria-current="${row.id === projectId ? "page" : "false"}"><span>🛒 ${escape(row.name)}</span><span class="shopping-count" aria-label="Осталось купить: ${remaining}">${remaining}</span></button>`;
      }).join("") || '<p class="shopping-muted">Списков пока нет</p>';
      root.querySelector("[data-shop-title]").textContent = list?.name || "Создайте список покупок";
      const remaining = items.length - bought;
      ["needed", "bought", "all"].forEach(name => {
        root.querySelector(`[data-shop-count="${name}"]`).textContent = String(name === "needed" ? remaining : name === "bought" ? bought : items.length);
        root.querySelector(`[data-shop-filter="${name}"]`).setAttribute("aria-pressed", String(filter === name));
      });
      action("new-item").hidden = !list; action("new-item").disabled = !list;
      action("project-settings").hidden = !list; action("project-settings").disabled = !list;
      if (!list) { closeProjectMenu(); closeCategoryMenu(); }
      ["rename-list", "delete-list", "clear-bought"].forEach(name => { action(name).disabled = !list || name === "clear-bought" && !bought; });
      root.querySelector(".shopping-filters").hidden = !list;
      root.querySelector(".shopping-categories").hidden = !list;
      const query = search.value.trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
      const categoryItems = items.filter(row => categoryFilter === ALL_CATEGORIES || row.categoryId === categoryFilter);
      const allBought = categoryItems.length > 0 && categoryItems.every(row => row.bought);
      const rows = categoryItems.filter(row => (filter === "all" || row.bought === (filter === "bought")) && `${row.name} ${row.quantity} ${row.notes}`.toLocaleLowerCase("ru").replace(/ё/g, "е").includes(query));
      const itemHTML = row => `<article class="shopping-item ${row.bought ? "is-bought" : ""}" data-shop-row="${escape(row.id)}"><label class="shopping-check"><input type="checkbox" data-shop-item="${escape(row.id)}" data-shop-action="bought" ${row.bought ? "checked" : ""} aria-label="Куплено: ${escape(row.name)}"></label><div class="shopping-item-copy"><strong>${escape(row.name)}</strong>${!prefs.groupByCategory ? `<span class="shopping-category-label">${escape(categories.find(category => category.id === row.categoryId)?.name || "Без категории")}</span>` : ""}${row.notes ? `<p class="shopping-item-description">${options.renderDescription ? options.renderDescription(row.notes) : escape(row.notes)}</p>` : ""}</div>${row.quantity ? `<span class="shopping-quantity">${escape(row.quantity)}</span>` : ""}<div class="shopping-item-actions"><button class="app-btn shopping-item-more" type="button" data-shop-action="item-menu" data-shop-item="${escape(row.id)}" aria-label="Действия с товаром: ${escape(row.name)}" aria-expanded="false" aria-controls="shopping-item-menu-${projectMenuId}-${escape(row.id)}">⋯</button><div class="shopping-item-menu" id="shopping-item-menu-${projectMenuId}-${escape(row.id)}" data-shop-item-menu role="group" aria-label="Действия с товаром" hidden><button class="app-btn" type="button" data-shop-action="edit-item" data-shop-item="${escape(row.id)}">Изменить</button><button class="app-btn shopping-danger" type="button" data-shop-action="delete-item" data-shop-item="${escape(row.id)}">Удалить</button></div></div></article>`;
      root.querySelector("[data-shop-items]").innerHTML = prefs.groupByCategory ? [...categories, { id: "", name: "Без категории" }].map(category => {
        const group = rows.filter(row => row.categoryId === category.id);
        return group.length ? `<section class="shopping-group" aria-label="${escape(category.name)}"><div class="shopping-group-heading"><h4>${escape(category.name)}</h4><span>${group.length}</span></div>${group.map(itemHTML).join("")}</section>` : "";
      }).join("") : rows.map(itemHTML).join("");
      if (!rows.length) root.querySelector("[data-shop-items]").innerHTML = `<div class="shopping-empty"><span aria-hidden="true">${!list ? "🛒" : filter === "needed" && allBought && !query ? "✓" : "☷"}</span><h3>${!list ? "Начните с первого списка" : query ? "Ничего не найдено" : filter === "needed" && allBought ? "Всё куплено!" : filter === "bought" ? "Купленных товаров пока нет" : categoryFilter !== ALL_CATEGORIES ? "В этой категории пока нет товаров" : "С чего начнём?"}</h3><p>${!list ? "Нажмите «Создать список», затем добавьте товары." : query ? "Измените запрос или фильтр." : "Нажмите «Добавить покупку», чтобы указать название, количество и описание."}</p></div>`;
      root.querySelectorAll(".shopping-item-description a[href]").forEach(link => {
        link.target = "_blank"; link.rel = "noopener noreferrer";
      });
      if (!modal && focusedItem && focusedAction) (itemFocus(focusedItem, focusedAction) || action("new-item")).focus();
    }

    async function perform(operation, success) {
      if (busy) return;
      let nextFocus;
      const initiating = doc.activeElement, initiatingAction = initiating?.dataset?.shopAction, initiatingItem = initiating?.dataset?.shopItem;
      closeProjectMenu(); closeItemMenus(); closeCategoryMenu();
      settingsButton.disabled = true;
      busy = true; controls.disabled = true; root.setAttribute("aria-busy", "true");
      if (modal) { modal.setAttribute("closedby", "none"); modal.querySelector("fieldset").disabled = true; }
      status.hidden = false; status.classList.remove("error"); status.textContent = "Сохраняем…";
      let focusMoved = false;
      const rememberFocus = event => {
        if (event.type === "focusin" || !root.contains(event.target)) focusMoved = true;
      };
      const stopWatchingFocus = () => {
        doc.removeEventListener("focusin", rememberFocus);
        doc.removeEventListener("pointerdown", rememberFocus, true);
      };
      doc.addEventListener("focusin", rememberFocus);
      doc.addEventListener("pointerdown", rememberFocus, true);
      try {
        const result = await operation();
        stopWatchingFocus();
        nextFocus = success?.(result); render(); options.onChange?.(); status.textContent = "Сохранено";
      } catch (error) {
        status.classList.add("error"); status.textContent = error.message || "Не удалось сохранить покупки. Повторите действие.";
        if (modal) modal.querySelector("[data-shop-error]").textContent = status.textContent;
      } finally {
        stopWatchingFocus();
        busy = false; controls.disabled = false; settingsButton.disabled = false; root.setAttribute("aria-busy", "false");
        if (modal) {
          modal.setAttribute("closedby", "closerequest"); modal.querySelector("fieldset").disabled = false;
          // The queued close event may arrive after the transaction has settled.
          if (!modal.open) modal.showModal();
          if (!focusMoved) modal.querySelector("input, select")?.focus();
        }
        else if (!focusMoved) {
          const focusItem = nextFocus?.dataset?.shopItem || initiatingItem, focusAction = nextFocus?.dataset?.shopAction || initiatingAction;
          const successor = focusItem ? itemFocus(focusItem, focusAction) : null;
          const target = [nextFocus, initiating, successor, selected() ? action("new-item") : null, action("new-list")]
            .find(node => node?.isConnected && node.matches("button,input,select,textarea,[tabindex]") && !node.matches(":disabled") && node.getClientRects().length > 0);
          target?.focus();
        }
      }
    }
    function bindDialogDismissal(dialog, close) {
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
      dialog.addEventListener("close", () => {
        if (modal !== dialog || dialog.open || !dialog.isConnected) return;
        // Older engines can force a native close after repeated Escape despite cancel.
        // Keep the same form and draft alive until the transaction has settled.
        if (busy) dialog.showModal(); else close();
      });
    }
    function settingsEditor() {
      if (busy || modal) return;
      closeProjectMenu(); closeItemMenus(); closeCategoryMenu();
      const original = controller.data().preferences, opener = settingsButton;
      modal = doc.createElement("dialog"); modal.className = "shopping-dialog shopping-settings-dialog";
      modal.setAttribute("aria-label", "Настройки приложения Покупки");
      modal.innerHTML = `<form><fieldset><h3>Настройки Покупок</h3><p class="shopping-settings-note">Для всех списков рабочего стола «${escape(options.getWorkspaceName?.() || "Текущий")}»</p><label>Плотность списка<select name="density"><option value="normal" ${original.density === "normal" ? "selected" : ""}>Обычная</option><option value="compact" ${original.density === "compact" ? "selected" : ""}>Компактная</option></select></label><label class="shopping-setting-check"><input type="checkbox" name="groupByCategory" ${original.groupByCategory ? "checked" : ""}>Группировать товары по категориям</label><label class="shopping-setting-check"><input type="checkbox" name="showDescriptions" ${original.showDescriptions ? "checked" : ""}>Показывать описания товаров</label><p class="shopping-error" data-shop-error role="alert"></p><div class="shopping-dialog-actions"><button class="app-btn" type="button" data-shop-cancel>Отмена</button><button class="app-btn primary" type="submit">Сохранить</button></div></fieldset></form>`;
      const close = () => { if (busy) return; modal.close(); modal.remove(); modal = null; opener.focus(); };
      modal.querySelector("[data-shop-cancel]").addEventListener("click", close);
      bindDialogDismissal(modal, close);
      modal.addEventListener("keydown", event => {
        if (event.key !== "Tab" || busy) return;
        const fields = [...modal.querySelectorAll("input, select, button")].filter(node => !node.disabled);
        if (event.shiftKey && doc.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
        else if (!event.shiftKey && doc.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
      });
      modal.querySelector("form").addEventListener("submit", event => {
        event.preventDefault(); const fields = event.currentTarget.elements;
        const draft = { density: fields.density.value, groupByCategory: fields.groupByCategory.checked, showDescriptions: fields.showDescriptions.checked };
        perform(() => controller.setPreferences(draft, original), () => { modal.close(); modal.remove(); modal = null; return opener; });
      });
      root.append(modal); modal.showModal(); modal.querySelector("select").focus();
    }
    settingsButton.addEventListener("click", settingsEditor);
    function editor(kind, original = null) {
      if (busy || modal) return;
      const opener = doc.activeElement, editing = Boolean(original), item = kind === "item", category = kind === "category", capturedList = projectId, capturedCategory = categoryFilter === ALL_CATEGORIES ? "" : categoryFilter;
      const categoryRows = controller.data().categories.filter(row => row.projectId === (original?.projectId || projectId));
      const selectedCategory = original?.categoryId ?? capturedCategory;
      modal = doc.createElement("dialog"); modal.className = `shopping-dialog${item ? " shopping-item-dialog" : ""}${item && !editing ? " shopping-add-dialog" : ""}`;
      modal.setAttribute("aria-label", item ? editing ? "Изменить покупку" : "Добавить покупку" : category ? editing ? "Переименовать категорию" : "Новая категория" : editing ? "Переименовать список" : "Новый список");
      modal.innerHTML = `<form><fieldset><h3>${item ? editing ? "Изменить покупку" : "Добавить покупку" : category ? editing ? "Переименовать категорию" : "Новая категория" : editing ? "Переименовать список" : "Новый список покупок"}</h3><label>${item ? "Название товара" : category ? "Название категории" : "Название списка"}<input name="name" required maxlength="${item ? 200 : 100}" value="${escape(original?.name || "")}" autofocus></label>${item ? `<label>Количество<input name="quantity" maxlength="80" value="${escape(original?.quantity || "")}"></label><label>Категория<select name="categoryId"><option value="">Без категории</option>${categoryRows.map(row => `<option value="${escape(row.id)}" ${row.id === selectedCategory ? "selected" : ""}>${escape(row.name)}</option>`).join("")}</select></label><label>Описание<textarea name="notes" maxlength="2000" rows="4">${escape(original?.notes || "")}</textarea></label>` : ""}<p class="shopping-error" data-shop-error role="alert"></p><div class="shopping-dialog-actions">${item && !editing ? '<button class="app-btn primary" type="submit">Добавить покупку</button><button class="app-btn" type="button" data-shop-cancel>Отмена</button>' : '<button class="app-btn" type="button" data-shop-cancel>Отмена</button><button class="app-btn primary" type="submit">Сохранить</button>'}</div></fieldset></form>`;
      const close = () => {
        if (busy) return;
        modal.close(); modal.remove(); modal = null;
        const target = item && original ? itemFocus(original.id, "item-menu") : opener;
        (target?.isConnected && target.getClientRects().length ? target : selected() ? action("new-item") : action("new-list")).focus();
      };
      modal.querySelector("[data-shop-cancel]").addEventListener("click", close);
      bindDialogDismissal(modal, close);
      modal.addEventListener("keydown", event => {
        if (event.key !== "Tab" || busy) return;
        const fields = [...modal.querySelectorAll("input, select, textarea, button")].filter(node => !node.disabled);
        if (event.shiftKey && doc.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
        else if (!event.shiftKey && doc.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
      });
      modal.querySelector("form").addEventListener("submit", event => {
        event.preventDefault(); const form = event.currentTarget;
        const draft = { name: form.elements.name.value, ...(item ? { projectId: original?.projectId || capturedList, quantity: form.elements.quantity.value, notes: form.elements.notes.value, categoryId: form.elements.categoryId.value } : category ? { projectId: capturedList } : {}) };
        perform(() => item ? controller.saveItem(draft, original?.id, original) : category ? controller.saveCategory(draft, original?.id, original) : controller.saveProject(draft, original?.id, original), row => {
          if (category) categoryFilter = row.id; else if (!item) projectId = row.id;
          else if (!editing) { categoryFilter = row.categoryId || ALL_CATEGORIES; filter = "needed"; search.value = ""; }
          // The accepted form may close while the write guard is still active.
          modal.close(); modal.remove(); modal = null;
          return opener?.isConnected ? opener : action("new-list");
        });
      });
      root.append(modal); modal.showModal(); modal.querySelector("input").focus();
    }
    async function confirmRemoval(message, operation) {
      if (busy) return;
      const opener = doc.activeElement;
      busy = true; controls.disabled = true;
      let accepted;
      try { accepted = await options.confirm(message, { title: "Удаление покупок", action: "Удалить" }); }
      finally { busy = false; controls.disabled = false; if (opener?.isConnected && !opener.matches(":disabled")) opener.focus(); }
      if (accepted) await perform(operation);
    }
    search.addEventListener("input", render);
    root.querySelector("[data-shop-category]").addEventListener("change", event => { categoryFilter = event.target.value; render(); });

    function openDescriptionLink(event) {
      const link = event.target.closest?.(".shopping-item-description a[href]");
      if (!link || !root.contains(link)) return false;
      event.preventDefault(); event.stopPropagation();
      if (busy) return true;
      const showError = error => {
        status.hidden = false; status.classList.add("error");
        status.textContent = error?.message || "Не удалось открыть ссылку.";
      };
      try {
        if (!options.openExternal) throw new Error("Открытие ссылок недоступно.");
        status.hidden = true; status.classList.remove("error");
        // noopener can return null/false after a successful browser opening.
        Promise.resolve(options.openExternal(link.getAttribute("href") || "")).catch(showError);
      } catch (error) { showError(error); }
      return true;
    }
    root.addEventListener("auxclick", event => { if (event.button === 1) openDescriptionLink(event); });
    root.addEventListener("click", event => {
      if (openDescriptionLink(event) || busy) return;
      const filterButton = event.target.closest("[data-shop-filter]");
      if (filterButton) { closeProjectMenu(); closeItemMenus(); closeCategoryMenu(); filter = filterButton.dataset.shopFilter; render(); return; }
      const listButton = event.target.closest("[data-shop-list]");
      if (listButton) { closeProjectMenu(); projectId = listButton.dataset.shopList; categoryFilter = ALL_CATEGORIES; search.value = ""; render(); root.querySelector(`[data-shop-list="${projectId}"]`)?.focus(); return; }
      const button = event.target.closest("[data-shop-action]");
      if (!button) { if (!projectHeading.contains(event.target)) closeProjectMenu(); if (!categoryTools.contains(event.target)) closeCategoryMenu(); if (!event.target.closest(".shopping-item-actions")) closeItemMenus(); return; }
      if (button.dataset.shopAction === "category-settings") {
        const opening = categoryMenu.hidden;
        closeProjectMenu(); closeItemMenus(); closeCategoryMenu();
        if (opening) { categoryMenu.hidden = false; button.setAttribute("aria-expanded", "true"); categoryMenu.querySelector("button:not(:disabled)").focus(); }
        else button.focus();
        return;
      }
      if (categoryMenu.contains(button)) closeCategoryMenu(true); else closeCategoryMenu();
      if (button.dataset.shopAction === "item-menu") {
        const menu = button.parentElement.querySelector("[data-shop-item-menu]"), opening = menu.hidden;
        closeProjectMenu(); closeItemMenus(); closeCategoryMenu();
        if (opening) { menu.hidden = false; button.setAttribute("aria-expanded", "true"); menu.querySelector("button").focus(); }
        else button.focus();
        return;
      }
      if (button.dataset.shopAction === "project-settings") {
        closeItemMenus();
        if (projectMenu.hidden && selected()) {
          projectMenu.hidden = false; button.setAttribute("aria-expanded", "true");
          projectMenu.querySelector("button:not(:disabled)")?.focus();
        } else closeProjectMenu(true);
        return;
      }
      if (projectMenu.contains(button)) closeProjectMenu(true);
      else closeProjectMenu();
      closeItemMenus();
      const name = button.dataset.shopAction, data = controller.data(), list = selected(), row = data.items.find(item => item.id === button.dataset.shopItem);
      const category = data.categories.find(row => row.id === categoryFilter && row.projectId === projectId);
      if (name === "new-category" && list) editor("category");
      if (name === "rename-category" && category) editor("category", category);
      if (name === "delete-category" && category) confirmRemoval(`Удалить категорию «${category.name}»? Товары останутся в списке без категории.`, () => controller.removeCategory(category.id, category));
      if (name === "new-list") editor("list");
      if (name === "rename-list" && list) editor("list", list);
      if (name === "new-item" && list) editor("item");
      if (name === "edit-item" && row) editor("item", row);
      if (name === "bought" && row) { const checked = button.checked; button.checked = row.bought; perform(() => controller.setBought(row.id, checked)); }
      if (name === "delete-item" && row) confirmRemoval(`Удалить товар «${row.name}»?`, () => controller.removeItem(row.id, row));
      if (name === "delete-list" && list) { const rows = data.items.filter(item => item.projectId === list.id); confirmRemoval(`Удалить список «${list.name}» и все категории и товары в нём (${rows.length})?`, () => controller.removeProject(list.id, list, rows, data.categories.filter(row => row.projectId === list.id))); }
      if (name === "clear-bought" && list) { const rows = data.items.filter(item => item.projectId === list.id && item.bought); confirmRemoval(`Удалить купленные товары из списка «${list.name}» (${rows.length})?`, () => controller.clearBought(list.id, rows)); }
    });
    root.refreshShopping = render;
    render(); return root;
  }
  window.ZETER_SHOPPING_UI_UTILS = Object.freeze({ createShoppingApp });
})();
