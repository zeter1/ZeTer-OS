(() => {
  "use strict";
  const { escapeHtml: e } = window.ZETER_CORE_UTILS;
  const { filterContacts } = window.ZETER_CONTACTS_UTILS;
  const icon = (name, size = 18) => {
    const paths = { people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', star: '<path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.08 6.28L12 17.36l-5.63 2.97 1.08-6.28L2.9 9.6l6.3-.9z"/>', folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>', plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="m14 5-7 7 7 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>' };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.people}</svg>`;
  };
  const initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase("ru");
  const fieldLabels = Object.freeze({ phone: "Телефон", email: "Электронная почта", social: "Социальная сеть", url: "Сайт / ссылка", text: "Своё поле", multiline: "Описание" });
  const fieldKey = field => ({ social: "website", url: "website" }[field.type] || field.type);
  function channelURL(key, value) {
    const text = String(value || "").trim();
    if (["phone", "secondaryPhone"].includes(key) && /^[+\d\s().-]+$/.test(text) && /\d/.test(text)) return `tel:${text.replace(/[^+\d]/g, "")}`;
    if (key === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${encodeURIComponent(text)}`;
    if (key === "telegram" && /^@?[a-zA-Z0-9_]{5,32}$/.test(text)) return `https://t.me/${text.replace(/^@/, "")}`;
    if (["website", "telegram"].includes(key)) {
      try { const url = new URL(/^[a-z]+:/i.test(text) ? text : `https://${text}`); if (url.protocol === "https:" && !url.username && !url.password && (key !== "telegram" || ["t.me", "telegram.me"].includes(url.hostname))) return url.href; } catch (_) { /* Plain text is still available to copy. */ }
    }
    return "";
  }
  function createContactsApp(params = {}, options = {}) {
    const doc = options.documentRef || document, controller = options.controller, root = doc.createElement("div");
    root.className = "contacts-app";
    const target = controller.library().entries.find(item => item.id === params.entryId);
    let projectId = target ? target.projectId : params.projectId ?? null, filter = "all", query = params.searchQuery || "", sort = "name", selectedId = target?.id || "", limit = 80, busy = false, modal = null;
    root.innerHTML = `<header class="contacts-header"><div class="contacts-brand"><span class="contacts-brand-icon">${icon("people", 23)}</span><div><h1>Контакты</h1><p>Нужные люди — под рукой</p></div></div><button type="button" class="app-btn primary contacts-add" data-contact-action="add" data-contact-write>${icon("plus")}<span>Новый контакт</span></button></header>
      <div class="contacts-layout"><aside class="contacts-sidebar" aria-label="Проекты контактов"><nav data-contact-nav></nav></aside><main class="contacts-main">
      <div class="contacts-toolbar"><label class="contacts-search">${icon("search")}<span class="contacts-sr-only">Поиск контактов</span><input class="app-input" type="search" data-contact-search placeholder="Имя, телефон, почта или описание" autocomplete="off" value="${e(query)}"><kbd>Ctrl F</kbd></label><label class="contacts-sort"><span class="contacts-sr-only">Сортировка контактов</span><select class="app-input" data-contact-sort><option value="name">По имени</option><option value="recent">Недавно изменённые</option></select></label></div>
      <div class="contacts-context" data-contact-context></div><p class="contacts-status" data-contact-status role="status" aria-live="polite" hidden></p>
      <div class="contacts-directory"><section class="contacts-results" aria-label="Список контактов"><div class="contacts-results-heading"><span data-contact-count></span><span>ИМЯ / КОМПАНИЯ</span></div><div class="contacts-list" data-contact-list></div></section><section class="contacts-detail" data-contact-detail aria-label="Карточка контакта"></section></div></main></div>`;
    const search = root.querySelector("[data-contact-search]"), nav = root.querySelector("[data-contact-nav]"), context = root.querySelector("[data-contact-context]"), list = root.querySelector("[data-contact-list]"), detail = root.querySelector("[data-contact-detail]");
    function status(text, error = false) {
      const node = root.querySelector("[data-contact-status]"); node.hidden = !text; node.textContent = text; node.classList.toggle("error", error);
    }
    function preserveFocus(render) {
      const active = doc.activeElement;
      const hook = active && root.contains(active) ? ["contactOpen", "contactProject", "contactFilter", "contactAction"].find(key => active.dataset?.[key] != null) : null;
      const value = hook ? active.dataset[hook] : "";
      render();
      if (hook && !active.isConnected) [...root.querySelectorAll("button, select[data-contact-filter]")].find(node => node.dataset[hook] === value)?.focus({ preventScroll: true });
    }
    function renderDetail(library) {
      const item = library.entries.find(entry => entry.id === selectedId);
      if (!item) { detail.innerHTML = `<div class="contacts-detail-placeholder">${icon("people", 38)}<h2>Карточка контакта</h2><p>Выберите человека в списке,<br>чтобы увидеть информацию.</p></div>`; return; }
      const project = library.projects.find(entry => entry.id === item.projectId), category = library.categories.find(entry => entry.id === item.categoryId);
      const channels = [["phone", "Телефон"], ["secondaryPhone", "Дополнительный телефон"], ["email", "Электронная почта"], ["telegram", "Telegram"], ["website", "Сайт"]].filter(([key]) => item[key]).map(([key, label]) => ({ key, label, value: item[key], type: key }));
      (item.fields || []).filter(field => field.value.trim()).forEach(field => channels.push({ key: `field:${field.id}`, label: field.label || fieldLabels[field.type], value: field.value, type: fieldKey(field) }));
      detail.innerHTML = `<button type="button" class="app-btn contacts-back" data-contact-action="back">${icon("back")} К списку</button><div class="contacts-profile"><span class="contacts-avatar contacts-avatar-large">${e(initials(item.name))}</span><button type="button" class="app-btn contacts-star${item.favorite ? " active" : ""}" data-contact-action="favorite" data-contact-id="${e(item.id)}" data-contact-write aria-pressed="${item.favorite}" aria-label="${item.favorite ? "Убрать из избранного" : "Добавить в избранное"}">${icon("star", 21)}</button><h2>${e(item.name)}</h2>${item.role || item.company ? `<p class="contacts-position">${e([item.role, item.company].filter(Boolean).join(" · "))}</p>` : ""}${item.city ? `<p class="contacts-city">${e(item.city)}</p>` : ""}<div class="contacts-badges"><span>${e(project?.name || "Без проекта")}</span>${category ? `<span>${e(category.name)}</span>` : ""}</div></div>
        <div class="contacts-detail-actions"><button type="button" class="app-btn" data-contact-action="edit" data-contact-write>Изменить контакт</button><button type="button" class="app-btn contacts-delete" data-contact-action="delete" data-contact-write>Удалить</button></div>
        ${channels.length ? `<div class="contacts-channels">${channels.map(({ key, label, value, type }) => { const href = channelURL(type, value); return `<div class="contacts-channel${type === "multiline" ? " contacts-channel-multiline" : ""}"><div><span>${e(label)}</span>${href ? `<a href="${e(href)}" data-contact-external="${e(href)}" target="_blank" rel="noopener noreferrer">${e(value)}</a>` : `<strong>${e(value)}</strong>`}</div><button type="button" class="app-btn contacts-icon-button" data-contact-copy="${e(key)}" aria-label="Скопировать: ${e(label)}">${icon("copy")}</button></div>`; }).join("")}</div>` : '<p class="contacts-muted contacts-no-channels">Добавьте телефон, почту или другое поле в редакторе.</p>'}
        ${item.tags.length ? `<div class="contacts-tags">${item.tags.map(tag => `<span>${e(tag)}</span>`).join("")}</div>` : ""}${item.notes ? `<div class="contacts-description"><h3>Описание контакта</h3><p>${e(item.notes)}</p></div>` : ""}`;
    }
    function renderRows() {
      const library = controller.library(), entries = filterContacts(library, projectId, filter, query, sort);
      if (!entries.some(item => item.id === selectedId)) selectedId = entries[0]?.id || "";
      const visibleEntries = entries.slice(0, limit), selected = entries.find(item => item.id === selectedId);
      if (selected && !visibleEntries.includes(selected)) visibleEntries.push(selected);
      root.querySelector("[data-contact-count]").textContent = query.trim() ? `Найдено: ${entries.length}` : `Контактов: ${entries.length}`;
      list.innerHTML = entries.length ? visibleEntries.map(item => `<button type="button" class="contacts-row${selectedId === item.id ? " selected" : ""}" data-contact-open="${e(item.id)}" aria-pressed="${selectedId === item.id}"><span class="contacts-avatar">${e(initials(item.name))}</span><span class="contacts-row-text"><strong>${e(item.name)}</strong><span>${e([item.role, item.company].filter(Boolean).join(" · ") || item.email || item.phone || item.fields?.find(field => field.value)?.value || "Контакт")}</span></span>${item.favorite ? `<span class="contacts-row-star" aria-label="Избранный контакт">${icon("star", 14)}</span>` : ""}</button>`).join("") + (entries.length > visibleEntries.length ? `<button type="button" class="app-btn contacts-more" data-contact-action="more">Показать ещё · осталось ${entries.length - visibleEntries.length}</button>` : "") : `<div class="contacts-empty">${icon("people", 42)}<h2>${query.trim() || filter !== "all" ? "Контакты не найдены" : "Здесь появятся ваши контакты"}</h2><p>${query.trim() || filter !== "all" ? "Измените запрос или выберите другой раздел." : "Добавьте первого человека. Телефон, почту и описание можно заполнить позже."}</p><button type="button" class="app-btn" data-contact-action="${query.trim() || filter !== "all" ? "clear" : "add"}">${query.trim() || filter !== "all" ? "Сбросить поиск и фильтр" : "Добавить контакт"}</button></div>`;
      renderDetail(library); setBusy(busy);
    }
    function renderNavigation() {
      const library = controller.library();
      if (projectId !== null && projectId !== "" && !library.projects.some(item => item.id === projectId)) { projectId = null; filter = "all"; }
      const categories = projectId ? library.categories.filter(item => item.projectId === projectId) : [];
      const projectCounts = new Map(), categoryCounts = new Map(); let favorites = 0, projectFavorites = 0, projectUncategorized = 0;
      library.entries.forEach(item => { projectCounts.set(item.projectId, (projectCounts.get(item.projectId) || 0) + 1); if (item.favorite) favorites++; if (item.projectId === projectId) { if (item.favorite) projectFavorites++; if (!item.categoryId) projectUncategorized++; categoryCounts.set(item.categoryId, (categoryCounts.get(item.categoryId) || 0) + 1); } });
      if (!["all", "favorites", "uncategorized"].includes(filter) && !categories.some(item => item.id === filter)) filter = "all";
      const navButton = (id, name, glyph, count, active, extra = "") => `<button type="button" class="contacts-nav-button${active ? " active" : ""}" data-contact-project="${e(id)}" ${extra} aria-pressed="${active}">${icon(glyph)}<span>${e(name)}</span><small>${count}</small></button>`;
      nav.innerHTML = `<div class="contacts-global-nav">${navButton("*", "Все контакты", "people", library.entries.length, projectId === null && filter === "all")}${navButton("*", "Избранное", "star", favorites, projectId === null && filter === "favorites", 'data-contact-global="favorites"')}${navButton("", "Без проекта", "folder", projectCounts.get("") || 0, projectId === "")}</div><div class="contacts-project-heading"><span>ПРОЕКТЫ</span><button type="button" class="app-btn contacts-icon-button" data-contact-action="project-add" data-contact-write aria-label="Создать проект">${icon("plus", 16)}</button></div><div class="contacts-project-list">${library.projects.length ? library.projects.map(item => navButton(item.id, item.name, "folder", projectCounts.get(item.id) || 0, projectId === item.id)).join("") : '<p class="contacts-sidebar-hint">Создайте проект для рабочих или личных контактов.</p>'}</div><button type="button" class="app-btn contacts-new-project" data-contact-action="project-add" data-contact-write>${icon("plus", 15)} Создать проект</button>`;
      const project = library.projects.find(item => item.id === projectId);
      const categoryCount = id => id === "all" ? projectCounts.get(projectId) || 0 : id === "favorites" ? projectFavorites : id === "uncategorized" ? projectUncategorized : categoryCounts.get(id) || 0;
      context.innerHTML = `<div class="contacts-context-title"><div class="contacts-context-heading"><h2>${e(project?.name || (projectId === "" ? "Без проекта" : filter === "favorites" ? "Избранное" : "Все контакты"))}</h2><p>${project ? "Контакты и категории этого проекта" : projectId === "" ? "Контакты, которые ещё не распределены по проектам" : "Справочник текущего рабочего стола"}</p></div>${project ? `<div class="contacts-context-actions"><button type="button" class="app-btn contacts-category-add" data-contact-action="category-add" data-contact-write>${icon("plus", 15)}<span>Создать категорию</span></button><details class="contacts-project-menu"><summary class="app-btn" aria-label="Настройки проекта">···</summary><div><button type="button" class="app-btn" data-contact-action="project-rename" data-contact-write>Переименовать</button><button type="button" class="app-btn" data-contact-action="project-delete" data-contact-write>Удалить проект</button></div></details></div>` : ""}</div>${project ? `<div class="contacts-category-bar" aria-label="Категории проекта"><label class="contacts-category-select">Категория<select class="app-input" data-contact-filter data-contact-filter-project="${e(project.id)}">${[["all", "Все категории"], ["favorites", "Избранное"], ["uncategorized", "Без категории"], ...categories.map(item => [item.id, item.name])].map(([id, name]) => `<option value="${e(id)}"${filter === id ? " selected" : ""}>${e(name)} (${categoryCount(id)})</option>`).join("")}</select></label>${!["all", "favorites", "uncategorized"].includes(filter) ? '<details class="contacts-category-menu"><summary class="app-btn" aria-label="Настройки категории">···</summary><div><button type="button" class="app-btn" data-contact-action="category-rename" data-contact-write>Переименовать категорию</button><button type="button" class="app-btn" data-contact-action="category-delete" data-contact-write>Удалить категорию</button></div></details>' : ""}</div>` : ""}`;
    }
    function setBusy(value) {
      busy = value; root.setAttribute("aria-busy", String(value));
      root.querySelectorAll("[data-contact-write]").forEach(node => { node.disabled = value; });
      if (modal) modal.querySelectorAll("input,textarea,select,button").forEach(node => { node.disabled = value; });
    }
    function refreshContacts() { preserveFocus(() => { renderNavigation(); renderRows(); }); if (modal?.querySelector("[data-contact-form]")) updateEditorSelectors(); }
    async function commit(operation, after) {
      if (busy) return false;
      setBusy(true); status("Сохранение…");
      let result;
      try { result = await operation(); }
      catch (error) { setBusy(false); const text = error?.message || "Не удалось сохранить. Повторите попытку."; status(text, true); const node = modal?.querySelector("[data-contact-dialog-error]"); if (node) { node.hidden = false; node.textContent = text; } return false; }
      setBusy(false);
      try { after?.(result); refreshContacts(); status("Сохранено"); options.onChange?.(); }
      catch (_) { status("Сохранено, но интерфейс не обновился. Откройте контакты заново.", true); }
      return true;
    }
    function closeModal() {
      if (busy || !modal) return;
      const old = modal, previous = old.previousFocus; modal = null; old.close?.(); old.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true }); else root.querySelector('[data-contact-action="add"]')?.focus();
    }
    function openModal(title, body, submitLabel, submit, danger = false) {
      if (modal || busy) return;
      modal = doc.createElement("dialog"); modal.className = "contacts-dialog"; modal.previousFocus = doc.activeElement;
      modal.setAttribute("aria-label", title);
      modal.innerHTML = `<form><header><h2>${e(title)}</h2><button type="button" class="app-btn contacts-icon-button" data-contact-dialog-cancel aria-label="Закрыть">${icon("close")}</button></header><div class="contacts-dialog-body">${body}<p class="contacts-dialog-error" data-contact-dialog-error role="alert" hidden></p></div><footer><button type="button" class="app-btn" data-contact-dialog-cancel>Отмена</button><button type="submit" class="${danger ? "danger-btn" : "app-btn primary"}" data-contact-dialog-submit>${e(submitLabel)}</button></footer></form>`;
      root.append(modal); modal.querySelectorAll("[data-contact-dialog-cancel]").forEach(node => node.addEventListener("click", closeModal));
      modal.addEventListener("cancel", event => { event.preventDefault(); closeModal(); });
      modal.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeModal(); } });
      modal.querySelector("form").addEventListener("submit", event => { event.preventDefault(); if (!busy) submit(modal.querySelector("form")); });
      if (typeof modal.showModal === "function") modal.showModal(); else modal.setAttribute("open", "");
      (modal.querySelector("input,textarea") || modal.querySelector("[data-contact-dialog-cancel]")).focus();
    }
    function nameDialog(kind, item) {
      const project = kind === "project", editing = Boolean(item), selectedProject = projectId;
      openModal(`${editing ? "Переименовать" : "Создать"} ${project ? "проект" : "категорию"}`, `<label class="contacts-field">Название<input class="app-input" name="title" required maxlength="120" value="${e(item?.name || "")}" placeholder="${project ? "Например, Работа" : "Например, Клиенты"}"></label>`, editing ? "Сохранить" : "Создать", form => {
        const name = form.elements.namedItem("title").value;
        commit(() => project ? editing ? controller.renameProject(item.id, name) : controller.addProject(name) : editing ? controller.renameCategory(item.id, name) : controller.addCategory(selectedProject, name), result => { closeModal(); if (result && project) { projectId = result.id; filter = "all"; } else if (result) filter = result.id; });
      });
    }
    function confirmRemoval(kind, item) {
      const description = kind === "project" ? `Проект «${item.name}» и его категории будут удалены. Все контакты сохранятся в разделе «Без проекта» со своими данными.` : kind === "category" ? `Категория «${item.name}» будет удалена. Все контакты сохранятся в этом проекте без категории.` : `Контакт «${item.name}» будет удалён без возможности восстановления.`;
      openModal(kind === "entry" ? "Удалить контакт?" : kind === "project" ? "Удалить проект?" : "Удалить категорию?", `<p class="contacts-confirm-text">${e(description)}</p>`, "Удалить", () => commit(() => kind === "project" ? controller.removeProject(item.id) : kind === "category" ? controller.removeCategory(item.id) : controller.removeEntry(item.id), () => { closeModal(); if (kind === "project") { projectId = ""; filter = "all"; } if (kind === "category") filter = "all"; }), true);
    }
    function updateEditorSelectors(resetCategory = false) {
      const form = modal?.querySelector("form"); if (!form || !form.querySelector("[data-contact-form]")) return;
      const library = controller.library(), project = form.elements.namedItem("projectId"), category = form.elements.namedItem("categoryId"), oldProject = project.value, oldCategory = resetCategory ? "" : category.value;
      project.innerHTML = `<option value="">Без проекта</option>${oldProject && !library.projects.some(item => item.id === oldProject) ? `<option value="${e(oldProject)}" disabled>Проект недоступен — выберите другой</option>` : ""}${library.projects.map(item => `<option value="${e(item.id)}">${e(item.name)}</option>`).join("")}`; project.value = oldProject;
      category.innerHTML = `<option value="">Без категории</option>${oldCategory && !library.categories.some(item => item.id === oldCategory && item.projectId === oldProject) ? `<option value="${e(oldCategory)}" disabled>Категория недоступна — выберите другую</option>` : ""}${library.categories.filter(item => item.projectId === oldProject).map(item => `<option value="${e(item.id)}">${e(item.name)}</option>`).join("")}`; category.value = oldCategory;
      category.closest("label").hidden = !oldProject;
    }
    function editEntry(item) {
      const draft = item || { projectId: projectId || "", categoryId: !["all", "favorites", "uncategorized"].includes(filter) ? filter : "", tags: [], favorite: false, fields: [{ type: "phone", label: "Телефон", value: "" }, { type: "email", label: "Электронная почта", value: "" }] };
      const field = (key, label, max, placeholder = "", type = "text") => `<label class="contacts-field">${label}<input class="app-input" name="${key}" type="${type}" maxlength="${max}" value="${e(draft[key] || "")}" placeholder="${e(placeholder)}"${key === "name" ? " required" : ""}></label>`;
      const legacyFields = [["phone", "Телефон"], ["secondaryPhone", "Дополнительный телефон"], ["email", "Электронная почта"], ["telegram", "Telegram"], ["website", "Сайт"]].filter(([key]) => draft[key]).map(([key, label]) => field(key, label, key === "website" ? 2048 : 320)).join("");
      openModal(item ? "Изменить контакт" : "Новый контакт", `<div class="contacts-editor" data-contact-form>${field("name", "Имя *", 300, "Как зовут человека")}${field("company", "Компания", 300)}${field("role", "Должность", 300)}${field("city", "Город", 300)}<label class="contacts-field">Проект<select class="app-input" name="projectId"><option value="${e(draft.projectId)}">Текущий проект</option></select></label><label class="contacts-field">Категория<select class="app-input" name="categoryId"><option value="${e(draft.categoryId)}">Текущая категория</option></select></label>${legacyFields}<h3 class="contacts-field-wide">Связь и дополнительные поля</h3><p class="contacts-editor-hint contacts-field-wide">Добавляйте сколько нужно телефонов, адресов почты, соцсетей и своих полей.</p><div class="contacts-custom-fields contacts-field-wide" data-contact-fields></div><button type="button" class="app-btn contacts-add-field contacts-field-wide" data-contact-field-add>${icon("plus", 16)} Добавить поле</button><label class="contacts-field contacts-field-wide">Теги через запятую<input class="app-input" name="tags" value="${e(draft.tags.join(", "))}" maxlength="5099" placeholder="Клиент, дизайн, партнёр"></label><label class="contacts-field contacts-field-wide">Описание контакта<textarea class="app-input" name="notes" rows="4" maxlength="20000" placeholder="Чем занимается, как познакомились, важные детали"></textarea></label><label class="contacts-favorite-field contacts-field-wide"><input type="checkbox" name="favorite"${draft.favorite ? " checked" : ""}> В избранном — быстрый доступ к контакту</label><p class="contacts-editor-hint contacts-field-wide">Обязательно только имя. Остальную информацию можно добавить позже.</p><p class="contacts-duplicate contacts-field-wide" data-contact-duplicate hidden></p></div>`, "Сохранить контакт", form => {
        const fields = ["name", "company", "role", "phone", "secondaryPhone", "email", "telegram", "website", "city", "projectId", "categoryId", "notes"];
        const value = Object.fromEntries(fields.map(key => [key, form.elements.namedItem(key)?.value ?? draft[key] ?? ""]));
        const notes = form.elements.namedItem("notes").value;
        value.notes = notes === String(draft.notes || "").replace(/\r\n?/g, "\n") ? draft.notes || "" : notes;
        value.tags = [...new Set(form.elements.namedItem("tags").value.split(",").map(tag => tag.trim()).filter(Boolean))]; value.favorite = form.elements.namedItem("favorite").checked;
        value.fields = [...form.querySelectorAll("[data-contact-field-row]")].map(row => { const value = row.querySelector("[data-contact-field-value]").value; return { id: row.dataset.contactFieldId || "", type: row.querySelector("[data-contact-field-type]").value, label: row.querySelector("[data-contact-field-label]").value, value: value === String(row.originalValue || "").replace(/\r\n?/g, "\n") ? row.originalValue || "" : value }; });
        commit(() => controller.saveEntry(value, item?.id, item), result => { closeModal(); selectedId = result.id; projectId = result.projectId; filter = "all"; query = ""; search.value = ""; root.classList.add("contacts-show-detail"); });
      });
      if (!modal) return;
      modal.querySelector('[name="notes"]').value = draft.notes || "";
      const fieldContainer = modal.querySelector("[data-contact-fields]");
      function addField(fieldValue, focus = false) {
        if (fieldContainer.children.length >= 100) { const node = modal.querySelector("[data-contact-dialog-error]"); node.hidden = false; node.textContent = "Можно добавить до 100 полей."; return; }
        const row = doc.createElement("div"); row.className = "contacts-custom-field"; row.dataset.contactFieldRow = ""; row.dataset.contactFieldId = fieldValue.id || ""; row.originalValue = fieldValue.value || "";
        row.innerHTML = `<label class="contacts-field"><span>Тип поля</span><select class="app-input" data-contact-field-type>${Object.entries(fieldLabels).map(([type, label]) => `<option value="${type}"${fieldValue.type === type ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="contacts-field"><span>Название поля</span><input class="app-input" data-contact-field-label maxlength="120" value="${e(fieldValue.label || "")}" placeholder="Например, Рабочий телефон"></label><label class="contacts-field contacts-custom-value"><span>Значение</span><textarea class="app-input" rows="${fieldValue.type === "multiline" ? 3 : 1}" maxlength="20000" data-contact-field-value placeholder="Введите значение"></textarea></label><button type="button" class="app-btn contacts-icon-button contacts-remove-field" data-contact-field-remove aria-label="Удалить поле">${icon("close", 16)}</button>`;
        const valueInput = row.querySelector("[data-contact-field-value]"); valueInput.value = fieldValue.value || "";
        row.querySelector("[data-contact-field-remove]").addEventListener("click", () => { if (busy) return; row.remove(); modal.querySelector("[data-contact-field-add]").focus(); });
        row.querySelector("[data-contact-field-type]").addEventListener("change", event => { const label = row.querySelector("[data-contact-field-label]"); if (!label.value || Object.values(fieldLabels).includes(label.value)) label.value = fieldLabels[event.target.value]; valueInput.rows = event.target.value === "multiline" ? 3 : 1; });
        fieldContainer.append(row); if (focus) row.querySelector("[data-contact-field-type]").focus();
      }
      (draft.fields || []).forEach(fieldValue => addField(fieldValue));
      modal.querySelector("[data-contact-field-add]").addEventListener("click", () => { if (!busy) addField({ type: "text", label: "", value: "" }, true); });
      updateEditorSelectors();
      modal.querySelector('[name="projectId"]').addEventListener("change", () => updateEditorSelectors(true));
      modal.querySelector("form").addEventListener("input", () => {
        const form = modal?.querySelector("form"); if (!form) return;
        const phones = [form.elements.namedItem("phone")?.value || "", ...[...form.querySelectorAll("[data-contact-field-row]")].filter(row => row.querySelector("[data-contact-field-type]").value === "phone").map(row => row.querySelector("[data-contact-field-value]").value)].map(value => value.replace(/\D/g, "")).filter(value => value.length >= 5);
        const emails = [form.elements.namedItem("email")?.value || "", ...[...form.querySelectorAll("[data-contact-field-row]")].filter(row => row.querySelector("[data-contact-field-type]").value === "email").map(row => row.querySelector("[data-contact-field-value]").value)].map(value => value.trim().toLocaleLowerCase()).filter(Boolean);
        const duplicate = controller.library().entries.find(entry => entry.id !== item?.id && ([entry.phone, entry.secondaryPhone, ...(entry.fields || []).filter(field => field.type === "phone").map(field => field.value)].some(value => phones.includes(value.replace(/\D/g, ""))) || [entry.email, ...(entry.fields || []).filter(field => field.type === "email").map(field => field.value)].some(value => emails.includes(value.trim().toLocaleLowerCase()))));
        const node = form.querySelector("[data-contact-duplicate]"); node.hidden = !duplicate; node.textContent = duplicate ? `Похожий контакт уже есть: ${duplicate.name}. При необходимости можно сохранить ещё один.` : "";
      });
    }
    root.addEventListener("click", event => {
      const button = event.target.closest("button, a[data-contact-external]"); if (!button || !root.contains(button) || modal?.contains(button)) return;
      const data = button.dataset, library = controller.library();
      if (data.contactExternal) { if (options.openExternal) { event.preventDefault(); Promise.resolve(options.openExternal(data.contactExternal)).catch(error => status(error.message || "Не удалось открыть ссылку.", true)); } return; }
      if (data.contactProject !== undefined) { projectId = data.contactProject === "*" ? null : data.contactProject; filter = data.contactGlobal || "all"; limit = 80; root.classList.remove("contacts-show-detail"); refreshContacts(); return; }
      if (data.contactOpen) { selectedId = data.contactOpen; root.classList.add("contacts-show-detail"); preserveFocus(renderRows); return; }
      if (data.contactCopy) { const item = library.entries.find(entry => entry.id === selectedId), value = data.contactCopy.startsWith("field:") ? item?.fields.find(field => field.id === data.contactCopy.slice(6))?.value : item?.[data.contactCopy]; if (value != null) Promise.resolve(options.copyText?.(value)).then(result => { if (result === false || !options.copyText) throw new Error("Копирование недоступно."); status("Скопировано"); }).catch(error => status(error.message || "Не удалось скопировать.", true)); return; }
      const action = data.contactAction, item = library.entries.find(entry => entry.id === selectedId), project = library.projects.find(entry => entry.id === projectId), category = library.categories.find(entry => entry.id === filter);
      if (busy && !["back", "more", "clear"].includes(action)) return;
      if (action === "add") editEntry();
      if (action === "edit" && item) editEntry(item);
      if (action === "delete" && item) confirmRemoval("entry", item);
      if (action === "favorite") commit(() => controller.toggleFavorite(data.contactId));
      if (action === "back") root.classList.remove("contacts-show-detail");
      if (action === "more") { limit += 80; renderRows(); }
      if (action === "clear") { query = ""; search.value = ""; filter = "all"; refreshContacts(); search.focus(); }
      if (action === "project-add") nameDialog("project");
      if (action === "project-rename" && project) nameDialog("project", project);
      if (action === "project-delete" && project) confirmRemoval("project", project);
      if (action === "category-add" && project) nameDialog("category");
      if (action === "category-rename" && category) nameDialog("category", category);
      if (action === "category-delete" && category) confirmRemoval("category", category);
    });
    search.addEventListener("input", () => { query = search.value; limit = 80; root.classList.remove("contacts-show-detail"); renderRows(); });
    root.addEventListener("change", event => {
      const select = event.target;
      if (!select.matches("select[data-contact-filter]")) return;
      const library = controller.library();
      if (select !== context.querySelector("select[data-contact-filter]") || select.dataset.contactFilterProject !== projectId || !library.projects.some(item => item.id === projectId)) { refreshContacts(); return; }
      const value = select.value;
      if (!["all", "favorites", "uncategorized"].includes(value) && !library.categories.some(item => item.id === value && item.projectId === projectId)) { refreshContacts(); return; }
      filter = value; limit = 80; root.classList.remove("contacts-show-detail"); refreshContacts();
    });
    root.querySelector("[data-contact-sort]").addEventListener("change", event => { sort = event.target.value; renderRows(); });
    root.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLocaleLowerCase() === "f" || event.code === "KeyF")) { if (!modal) { event.preventDefault(); event.stopPropagation(); search.focus(); search.select(); } }
      if (event.target.matches("[data-contact-open]") && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const rows = [...list.querySelectorAll("[data-contact-open]")], index = rows.indexOf(event.target), next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        event.preventDefault(); rows[next]?.focus();
      }
    });
    root.refreshContacts = refreshContacts;
    refreshContacts();
    if (target) doc.defaultView?.requestAnimationFrame(() => {
      const row = list.querySelector(".contacts-row.selected");
      if (root.isConnected && row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
    return root;
  }
  window.ZETER_CONTACTS_UI_UTILS = Object.freeze({ createContactsApp });
})();
