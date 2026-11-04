(() => {
  "use strict";
  let librarySequence = 0;
  const icon = name => {
    const paths = { search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>', grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', star: '<path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.08 6.28L12 17.36l-5.63 2.97 1.08-6.28L2.9 9.6l6.3-.9z"/>', monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>', folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', edit: '<path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>' };
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.folder}</svg>`;
  };
  function createStickerLibraryApp(params = {}, options = {}) {
    const doc = options.documentRef || document, controller = options.controller;
    const escape = window.ZETER_CORE_UTILS.escapeHtml;
    const libraryUtils = window.ZETER_STICKER_LIBRARY_UTILS;
    const projectMark = (project, large = false) => {
      const appearance = libraryUtils.projectAppearance(project), preset = libraryUtils.PROJECT_ICONS.find(item => item.id === appearance.iconId);
      return `<span class="sticker-library-project-mark${large ? " large" : ""}" data-color="${appearance.color}">${appearance.iconDataURL ? `<img src="${escape(appearance.iconDataURL)}" alt="">` : escape(preset.glyph)}</span>`;
    };
    const root = doc.createElement("div"); root.className = "sticker-library-app";
    let desktopId = options.currentDesktopId || "", projectId = "", categoryId = "", filter = "all", query = "", searchText = "", sortOrder = "updated", busy = false, dirty = false;
    let editing = null, expected = null, opener = null, openerKey = null, groupDialog = null, editorDialog = null, appliedPreferences = "";
    const sidebarId = `sticker-library-navigation-${++librarySequence}`;
    root.innerHTML = `<div class="editor-header-actions sticker-library-window-tools" data-window-header-tools-source><button type="button" data-sticker-settings aria-label="Настройки стикеров" title="Настройки стикеров">⚙</button></div><div class="sticker-library-mobile-bar"><button type="button" data-sticker-action="navigation" aria-expanded="false" aria-controls="${sidebarId}">${icon("panel")}<span>Разделы и рабочий стол</span></button></div>
      <div class="sticker-library-layout"><aside class="sticker-library-sidebar" id="${sidebarId}" aria-label="Разделы стикеров"><label class="sticker-library-desktop">Рабочий стол<select data-sticker-desktop></select></label><nav data-sticker-sidebar aria-label="Библиотека и проекты"></nav><p class="sticker-library-sidebar-note">Стикеры связаны с вашими заметками</p></aside><section class="sticker-library-main"><header class="sticker-library-heading"><div><div class="sticker-library-title-row"><span data-sticker-project-mark hidden></span><h1 data-sticker-heading></h1><button type="button" class="sticker-library-icon-button" data-sticker-action="project-settings" aria-label="Настройки проекта" title="Настройки проекта" hidden>⚙</button></div><p data-sticker-count></p><p class="sticker-library-project-description" data-sticker-project-description hidden></p></div><button type="button" class="primary sticker-library-new-button" data-sticker-action="new"><span aria-hidden="true">＋</span>Новый стикер</button></header>
      ${options.capabilityNoticeHTML || ""}<div class="sticker-library-toolbar"><label class="sticker-library-search">${icon("search")}<span class="sticker-library-sr-only">Поиск</span><input type="search" data-sticker-search placeholder="Найти название или текст…"></label><label class="sticker-library-sort"><span class="sticker-library-sr-only">Порядок</span><select data-sticker-sort><option value="updated">Сначала изменённые</option><option value="name">По названию</option></select></label></div>
      <p class="sticker-library-status" role="status" aria-live="polite" data-sticker-status></p>
      <div class="sticker-library-project-categories" data-sticker-category-controls hidden><label>Категории проекта<select data-sticker-category><option value="">Все категории</option></select></label><button type="button" class="sticker-library-icon-button" data-sticker-action="category-settings" title="Настройки категории" aria-label="Настройки выбранной категории" hidden>⚙</button><button type="button" data-sticker-action="add-category">Создать категорию в проекте</button></div><div class="sticker-library-grid" data-sticker-list></div><p class="sticker-library-hint">Тяни за ⠿ на свободное место стола ZeTer OS${options.nativeAvailable ? " или за край окна в Windows" : ""}. Кнопка «На стол» доступна без перетаскивания.</p><section class="sticker-library-editor" data-sticker-editor hidden aria-label="Редактирование стикера"></section></section></div>`;
    const $ = selector => root.querySelector(selector);
    const status = (text, error = false) => { $("[data-sticker-status]").textContent = text; $("[data-sticker-status]").classList.toggle("error", error); };
    const currentDesktop = () => desktopId || options.currentDesktopId;
    const button = (action, text, extra = "") => `<button type="button" data-sticker-action="${action}" ${extra}>${text}</button>`;
    const resolve = (desk, id) => controller.entries().find(item => item.desktopId === desk && item.note.id === id);
    async function run(operation, message = "Сохранено") {
      if (busy) return false;
      // Disabling the active button moves browser focus to body. Capture its
      // identity before that happens; the card can be replaced by the ACK refresh.
      const focused = doc.activeElement, focusCard = focused?.closest?.('[data-sticker-note]');
      const focusKey = focusCard && root.contains(focusCard) && focused.dataset.stickerAction
        ? { desk: focusCard.dataset.stickerOwner, note: focusCard.dataset.stickerNote, action: focused.dataset.stickerAction } : null;
      busy = true; root.setAttribute("aria-busy", "true");
      root.querySelectorAll("button").forEach(item => { item.disabled = true; });
      status("Сохранение…");
      try { await operation(); status(message); refresh(); return true; }
      catch (error) { status(error.message || "Не удалось сохранить. Повторите действие.", true); return false; }
      finally {
        busy = false; root.removeAttribute("aria-busy"); root.querySelectorAll("button").forEach(item => { item.disabled = false; });
        if (focusKey && (doc.activeElement === doc.body || doc.activeElement === focused)) {
          const card = [...root.querySelectorAll('[data-sticker-note]')].find(node => node.dataset.stickerOwner === focusKey.desk && node.dataset.stickerNote === focusKey.note);
          const replacement = [...(card?.querySelectorAll('[data-sticker-action]') || [])].find(node => node.dataset.stickerAction === focusKey.action && node.getClientRects().length);
          (replacement || $('[data-sticker-action="new"]'))?.focus({ preventScroll: true });
        }
      }
    }
    function refresh() {
      const focused = doc.activeElement, focusCard = focused?.closest?.("[data-sticker-note]"), focusAction = focused?.dataset?.stickerAction, focusGroup = focused?.dataset?.groupId;
      const desks = controller.desktops();
      if (desktopId && !desks.some(item => item.id === desktopId)) { desktopId = ""; projectId = ""; categoryId = ""; }
      $("[data-sticker-desktop]").innerHTML = `<option value="">Все рабочие столы</option>` + desks.map(item => `<option value="${escape(item.id)}" ${item.id === desktopId ? "selected" : ""}>${escape(item.name)}</option>`).join("");
      const library = controller.library(currentDesktop());
      const preferences = library.preferences;
      if (appliedPreferences !== JSON.stringify(preferences)) { appliedPreferences = JSON.stringify(preferences); sortOrder = preferences.sort; $('[data-sticker-sort]').value = sortOrder; }
      root.dataset.density = preferences.density;
      $('.sticker-library-hint').hidden = !preferences.showHint;
      root.querySelectorAll('.sticker-library-location').forEach(node => { node.hidden = !preferences.showPath; });
      if (projectId && !library.projects.some(item => item.id === projectId)) { projectId = ""; categoryId = ""; }
      if (categoryId && !library.categories.some(item => item.id === categoryId)) categoryId = "";
      $('[data-sticker-category-controls]').hidden = !projectId;
      $('[data-sticker-category]').innerHTML = '<option value="">Все категории</option>' + library.categories.filter(item => item.projectId === projectId).map(item => `<option value="${escape(item.id)}"${item.id === categoryId ? " selected" : ""}>${escape(item.name)}</option>`).join("");
      $('[data-sticker-action="category-settings"]').hidden = !categoryId;
      const projectSettings = $('[data-sticker-action="project-settings"]');
      projectSettings.hidden = !projectId; projectSettings.dataset.groupId = projectId;
      const selectedProject = library.projects.find(item => item.id === projectId);
      $('[data-sticker-project-mark]').hidden = !selectedProject;
      $('[data-sticker-project-mark]').innerHTML = selectedProject ? projectMark(selectedProject, true) : "";
      $('[data-sticker-project-description]').textContent = selectedProject ? libraryUtils.projectAppearance(selectedProject).description : "";
      $('[data-sticker-project-description]').hidden = !$('[data-sticker-project-description]').textContent;
      const side = $("[data-sticker-sidebar]");
      const entries = controller.entries().filter(item => !desktopId || item.desktopId === desktopId);
      const nav = (action, name, glyph, count, active, extra = "") => button(action, `${icon(glyph)}<span>${escape(name)}</span><small class="sticker-library-nav-count">${count}</small>`, `class="sticker-library-nav-button" aria-pressed="${active}" ${extra}`);
      side.innerHTML = `<div class="sticker-library-global-nav">${nav("all", "Все стикеры", "grid", entries.length, filter === "all" && !projectId)}${nav("favorites", "Избранные", "star", entries.filter(item => item.sticky.favorite).length, filter === "favorites")}${nav("on-desktop", "На столе ZeTer OS", "monitor", entries.filter(item => item.sticky.desktop !== false).length, filter === "on-desktop")}</div><div class="sticker-library-projects-heading"><h3>Проекты</h3>${button("add-project", "＋", 'class="sticker-library-icon-button" title="Создать проект" aria-label="Создать проект"')}</div>${library.projects.map(item => `<div class="sticker-library-project">${button("project", `${projectMark(item)}<span>${escape(item.name)}</span><small class="sticker-library-nav-count">${entries.filter(entry => entry.desktopId === currentDesktop() && entry.sticky.projectId === item.id).length}</small>`, `class="sticker-library-nav-button" data-group-id="${escape(item.id)}" aria-pressed="${projectId === item.id}"`)}</div>`).join("")}${nav("unassigned", "Без проекта", "folder", entries.filter(item => item.desktopId === currentDesktop() && !item.sticky.projectId).length, filter === "unassigned")}`;
      let rows = entries.filter(item => (!projectId || item.desktopId === currentDesktop() && item.sticky.projectId === projectId) && (!categoryId || item.sticky.categoryId === categoryId));
      if (filter === "favorites") rows = rows.filter(item => item.sticky.favorite);
      if (filter === "on-desktop") rows = rows.filter(item => item.sticky.desktop !== false);
      if (filter === "unassigned") rows = rows.filter(item => !item.sticky.projectId && item.desktopId === currentDesktop());
      if (query) rows = rows.filter(item => `${item.note.name}\n${item.note.content || ""}`.toLocaleLowerCase("ru").includes(query));
      rows.sort((a, b) => $("[data-sticker-sort]").value === "name" ? a.note.name.localeCompare(b.note.name, "ru") : (b.note.updatedAt || 0) - (a.note.updatedAt || 0));
      $('[data-sticker-heading]').textContent = library.projects.find(item => item.id === projectId)?.name || ({ favorites: "Избранные", "on-desktop": "На столе ZeTer OS", unassigned: "Без проекта" }[filter] || "Все стикеры");
      $('[data-sticker-count]').textContent = `${rows.length} ${rows.length % 10 === 1 && rows.length % 100 !== 11 ? "стикер" : [2, 3, 4].includes(rows.length % 10) && ![12, 13, 14].includes(rows.length % 100) ? "стикера" : "стикеров"} · ${desktopId || projectId || filter === "unassigned" ? desks.find(item => item.id === currentDesktop())?.name || "" : "Все рабочие столы"}`;
      // Keep the live inline form in place during external refresh/ACK. Its expected
      // note snapshot still detects conflicts; closing the editor rebuilds the list.
      if (editing) return;
      const filteredEmpty = Boolean(query || categoryId || ["favorites", "on-desktop"].includes(filter));
      $("[data-sticker-list]").innerHTML = rows.length ? rows.map(({ desktopId: desk, desktopName, note, sticky }) => {
        const groups = controller.library(desk), project = groups.projects.find(item => item.id === sticky.projectId), category = groups.categories.find(item => item.id === sticky.categoryId);
        const color = Object.hasOwn(window.ZETER_STICKY_UTILS.STICKY_COLORS, sticky.color) ? sticky.color : "purple";
        return `<article class="sticker-library-card" data-sticker-note="${escape(note.id)}" data-sticker-owner="${escape(desk)}" data-color="${color}"><div class="sticker-library-card-view"><header><span class="sticker-library-meta">${escape(category?.name || project?.name || "Без проекта")}</span>${button("favorite", icon("star"), `class="sticker-library-favorite sticker-library-icon-button" aria-label="${sticky.favorite ? "Убрать из избранного" : "В избранное"}" aria-pressed="${Boolean(sticky.favorite)}"`)}</header><h3>${escape(note.name)}</h3>${button("quick-edit", escape(note.content || "Нажмите, чтобы добавить текст…"), `class="sticker-library-preview" aria-label="Редактировать текст: ${escape(note.name)}"`)}<p class="sticker-library-meta sticker-library-location">${escape([desktopName, project?.name, category?.name].filter(Boolean).join(" · "))}</p><footer>${button("edit", `${icon("edit")}<span>Изменить</span>`)}${button("desktop", `${icon("monitor")}<span>${sticky.desktop === false ? "На стол" : "На столе"}</span>`, `aria-label="${sticky.desktop === false ? "На стол ZeTer OS" : "Скрыть со стола"}" aria-pressed="${sticky.desktop !== false}"`)}<details class="sticker-library-card-menu"><summary aria-label="Другие действия: ${escape(note.name)}">${icon("more")}</summary><div class="sticker-library-menu-actions">${button("windows", options.nativeAvailable ? "В Windows" : "В Windows · нужно приложение")}${button("note", "Открыть заметку")}${button("remove", "Удалить стикер")}</div></details></footer><button type="button" class="sticker-library-drag-handle" data-sticker-drag title="Перетащить стикер" aria-label="Перетащить стикер ${escape(note.name)}">⠿</button></div></article>`;
      }).join("") : `<div class="sticker-library-empty"><span class="sticker-library-empty-art" aria-hidden="true"><i></i><i></i></span><h3>${filteredEmpty ? "Стикеры не найдены" : projectId ? "У проекта пока нет стикеров" : "Место для ваших идей"}</h3><p>${filteredEmpty ? "Измените запрос или сбросьте фильтры, чтобы увидеть остальные стикеры." : "Создайте первый стикер или выберите «Сделать стикером» у существующей заметки."}</p>${button(filteredEmpty ? "clear" : "new", filteredEmpty ? "Сбросить поиск и фильтры" : "＋ Создать стикер", 'class="primary"')}</div>`;
      $("[data-sticker-list]").querySelectorAll("[data-sticker-drag]").forEach(bindDrag);
      root.querySelectorAll('.sticker-library-location').forEach(node => { node.hidden = !preferences.showPath; });
      if (focusAction && focused && !focused.isConnected && !groupDialog && !editorDialog) {
        const scope = focusCard ? [...root.querySelectorAll('[data-sticker-note]')].find(item => item.dataset.stickerNote === focusCard.dataset.stickerNote && item.dataset.stickerOwner === focusCard.dataset.stickerOwner) : root;
        const replacement = [...(scope?.querySelectorAll('[data-sticker-action]') || [])].find(item => item.dataset.stickerAction === focusAction && item.dataset.groupId === focusGroup);
        (replacement || $('[data-sticker-action="new"]'))?.focus({ preventScroll: true });
      }
    }
    function discard(signal) {
      return !dirty || options.confirm("Закрыть форму без сохранения изменений?", { action: "Закрыть без сохранения", signal });
    }
    function closeEditor(restoreFocus = true) {
      if (editorDialog) { editorDialog.close(); editorDialog.remove(); editorDialog = null; }
      const panel = $("[data-sticker-editor]");
      panel.hidden = true; panel.innerHTML = ""; $(".sticker-library-main").appendChild(panel); dirty = false; editing = null;
      refresh();
      if (!restoreFocus) return;
      const card = openerKey && [...root.querySelectorAll('[data-sticker-note]')].find(item => item.dataset.stickerOwner === openerKey.desk && item.dataset.stickerNote === openerKey.note);
      const replacement = card && [...card.querySelectorAll('[data-sticker-action]')].find(item => item.dataset.stickerAction === openerKey.action);
      (opener?.isConnected ? opener : replacement || $("[data-sticker-action=new]"))?.focus({ preventScroll: true });
    }
    async function leaveInlineEditor() {
      if (busy) { status("Дождитесь завершения сохранения. Черновик оставлен в карточке.", true); return false; }
      if (!editing) return true;
      if (!await discard()) return false;
      closeEditor(false); return true;
    }
    function closeNavigation() {
      root.removeAttribute("data-navigation-open");
      const toggle = $('[data-sticker-action="navigation"]'); toggle.setAttribute("aria-expanded", "false");
      if (toggle.getClientRects().length) toggle.focus({ preventScroll: true });
    }
    async function edit(entry = null, trigger = null) {
      if (!await discard()) return;
      const sourceCard = trigger?.closest('[data-sticker-note]');
      const key = sourceCard ? { desk: sourceCard.dataset.stickerOwner, note: sourceCard.dataset.stickerNote, action: trigger.dataset.stickerAction } : null;
      closeEditor(false);
      openerKey = key;
      opener = trigger; editing = entry; dirty = false;
      const desk = entry?.desktopId || currentDesktop(), note = entry?.note, library = controller.library(desk), sticky = entry?.sticky || { projectId, categoryId, color: library.preferences.defaultColor };
      expected = note ? { title: note.name, richHtml: options.noteHtml(note), sticky: { ...sticky } } : null;
      let panel = $("[data-sticker-editor]");
      if (!entry) {
        editorDialog = doc.createElement("dialog");
        editorDialog.className = "desktop-delete-dialog sticker-library-editor sticker-library-new-dialog";
        editorDialog.setAttribute("data-sticker-new-dialog", ""); editorDialog.setAttribute("aria-label", "Новый стикер");
        root.appendChild(editorDialog); panel = editorDialog;
      } else {
        const card = [...root.querySelectorAll('[data-sticker-note]')].find(item => item.dataset.stickerOwner === desk && item.dataset.stickerNote === note.id);
        if (!card) { editing = null; return; }
        card.classList.add("is-editing"); card.querySelector('.sticker-library-card-view').hidden = true; card.appendChild(panel);
      }
      panel.hidden = false;
      panel.innerHTML = `<form data-sticker-form><h3>${note ? "Изменить стикер" : "Новый стикер"}</h3><p>${escape(controller.desktops().find(item => item.id === desk)?.name || "")}</p><label>Название<input name="title" required maxlength="240" value="${escape(note?.name || "")}" placeholder="Например, идеи на неделю"></label><label>Текст</label><div data-sticker-text contenteditable="true" role="textbox" aria-label="Текст стикера" aria-multiline="true"></div><label>Проект<select name="projectId"><option value="">Без проекта</option>${library.projects.map(item => `<option value="${escape(item.id)}" ${item.id === sticky.projectId ? "selected" : ""}>${escape(item.name)}</option>`).join("")}</select></label><label>Категория<select name="categoryId"></select></label><label>Цвет<select name="color">${window.ZETER_STICKY_UTILS.stickySelectOptions(window.ZETER_STICKY_UTILS.STICKY_COLORS, sticky.color || "purple")}</select></label><label class="sticker-library-check"><input name="favorite" type="checkbox" ${sticky.favorite ? "checked" : ""}>Избранный</label><p>Текст общий с заметкой. Удаление стикера сохраняет заметку и вложения.</p><div class="sticker-library-form-actions"><button class="primary" type="submit">Сохранить</button>${button("cancel", "Отмена")}</div></form>`;
      const form = panel.querySelector("form"), text = panel.querySelector("[data-sticker-text]");
      if (entry) {
        const settings = doc.createElement("details"); settings.className = "sticker-library-editor-settings";
        const summary = doc.createElement("summary"); summary.textContent = "Проект, категория и оформление"; settings.appendChild(summary);
        [...form.querySelectorAll("label")].filter(label => label.querySelector("select,input[type=checkbox]")).forEach(label => settings.appendChild(label));
        form.querySelector(".sticker-library-form-actions").before(settings);
        panel.addEventListener("keydown", inlineEditorKeydown);
      }
      if (editorDialog) {
        const close = doc.createElement("button"); close.type = "button"; close.className = "sticker-library-new-close";
        close.setAttribute("aria-label", "Закрыть создание стикера"); close.textContent = "×";
        const cancel = async () => { if (!busy && await discard()) closeEditor(); };
        close.addEventListener("click", cancel); form.prepend(close);
        editorDialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
        editorDialog.addEventListener("keydown", event => {
          event.stopPropagation();
          if (event.key !== "Tab") return;
          const nodes = [...form.querySelectorAll('input,select,button,[contenteditable="true"]')].filter(node => !node.disabled && !node.closest("[hidden]"));
          const first = nodes[0], last = nodes.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
        });
      }
      const errorNode = doc.createElement("p"); errorNode.setAttribute("data-sticker-editor-error", ""); errorNode.setAttribute("role", "alert"); errorNode.hidden = true;
      form.querySelector(".sticker-library-form-actions").before(errorNode);
      text.innerHTML = expected?.richHtml || "";
      text.querySelectorAll("[data-managed-file-inline]").forEach(item => { item.contentEditable = "false"; item.textContent = "📎 Вложение"; });
      const categories = selected => {
        form.elements.categoryId.innerHTML = `<option value="">Без категории</option>` + library.categories.filter(item => item.projectId === form.elements.projectId.value).map(item => `<option value="${escape(item.id)}" ${item.id === selected ? "selected" : ""}>${escape(item.name)}</option>`).join("");
      };
      categories(sticky.categoryId); form.elements.projectId.addEventListener("change", () => categories(""));
      form.addEventListener("input", () => { dirty = true; }); form.addEventListener("change", () => { dirty = true; });
      text.addEventListener("paste", event => { event.preventDefault(); doc.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || ""); dirty = true; });
      text.addEventListener("click", event => { if (event.target.closest("a")) event.preventDefault(); });
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (busy) return;
        errorNode.hidden = true;
        const draft = { title: form.elements.title.value, richHtml: text.innerHTML, projectId: form.elements.projectId.value, categoryId: form.elements.categoryId.value, color: form.elements.color.value, favorite: form.elements.favorite.checked };
        // Freeze this form while ACK is pending; failed saves preserve its exact draft.
        const controls = [...form.querySelectorAll("input,select,button")]; controls.forEach(item => { item.disabled = true; }); text.contentEditable = "false";
        const saved = await run(() => controller.saveEntry(desk, draft, note?.id || "", expected));
        if (saved) closeEditor(); else { controls.forEach(item => { item.disabled = false; }); text.contentEditable = "true"; errorNode.textContent = $("[data-sticker-status]").textContent; errorNode.hidden = false; form.elements.title.focus(); }
      });
      editorDialog?.showModal();
      form.elements.title.focus();
    }
    async function inlineEditorKeydown(event) {
      // This section is reused; registering the same handler does not accumulate callbacks.
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); if (!busy && await discard()) closeEditor(); }
    }
    function groupEditor(kind, action, trigger, selectedId = "") {
      if (groupDialog) return;
      const desk = currentDesktop(), ownerProjectId = projectId, library = controller.library(desk), isProject = kind === "projects", isPreferences = kind === "preferences";
      const id = selectedId || (isProject ? projectId : categoryId), item = isPreferences ? library.preferences : library[kind].find(item => item.id === id);
      if (action !== "add" && !item) return;
      const title = isPreferences ? "Настройки стикеров" : action === "add" ? (isProject ? "Создать проект" : "Создать категорию в проекте") : (isProject ? "Настройки проекта" : "Настройки категории");
      const expectedSettings = item ? JSON.stringify(item) : null;
      const appearance = libraryUtils.projectAppearance(item), preferences = library.preferences;
      let draftIcon = appearance.iconDataURL, draftPreset = appearance.iconId, imagePending = false, imageGeneration = 0, closed = false;
      const colorOptions = color => window.ZETER_STICKY_UTILS.stickySelectOptions(window.ZETER_STICKY_UTILS.STICKY_COLORS, color);
      const fields = isPreferences ? `<p class="sticker-library-settings-note">Настройки для рабочего стола «${escape(controller.desktops().find(item => item.id === desk)?.name || "") }». Сохраняются при повторном открытии.</p><label>Плотность карточек<select name="density"><option value="comfortable"${preferences.density === "comfortable" ? " selected" : ""}>Свободнее</option><option value="compact"${preferences.density === "compact" ? " selected" : ""}>Компактнее</option></select></label><label>Порядок по умолчанию<select name="sort"><option value="updated"${preferences.sort === "updated" ? " selected" : ""}>Сначала изменённые</option><option value="name"${preferences.sort === "name" ? " selected" : ""}>По названию</option></select></label><label>Цвет новых стикеров<select name="defaultColor">${colorOptions(preferences.defaultColor)}</select></label><label class="sticker-library-check"><input type="checkbox" name="showPath"${preferences.showPath ? " checked" : ""}>Показывать путь проекта на карточке</label><label class="sticker-library-check"><input type="checkbox" name="showHint"${preferences.showHint ? " checked" : ""}>Показывать подсказку перетаскивания</label>` : `<label data-sticker-dialog-name>Название ${isProject ? "проекта" : "категории"}<input class="app-input" name="entityName" maxlength="120" required autocomplete="off" value="${escape(item?.name || "")}"></label>${isProject ? `<label>Описание проекта<textarea name="description" maxlength="500" rows="3" placeholder="Для чего этот проект">${escape(appearance.description)}</textarea></label><div class="sticker-library-project-preview" data-sticker-icon-preview>${projectMark(appearance, true)}</div><fieldset class="sticker-library-icon-picker"><legend>Значок проекта</legend><div class="sticker-library-icon-grid">${libraryUtils.PROJECT_ICONS.map(preset => `<button type="button" data-sticker-icon-preset="${preset.id}" aria-label="${escape(preset.label)}" aria-pressed="${!draftIcon && draftPreset === preset.id}">${escape(preset.glyph)}</button>`).join("")}</div></fieldset><div class="sticker-library-upload-actions"><button type="button" data-sticker-icon-upload>Загрузить изображение</button><button type="button" data-sticker-icon-reset${draftIcon ? "" : " hidden"}>Убрать свою картинку</button></div><input type="file" data-sticker-icon-file accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden><p class="sticker-library-settings-note" data-sticker-upload-status>PNG, JPG или WebP до 2 МБ. Значок будет обрезан до квадрата.</p><label>Цвет проекта<select name="projectColor">${colorOptions(appearance.color)}</select></label>` : ""}`;
      const dialog = doc.createElement("dialog");
      dialog.className = "desktop-delete-dialog sticker-library-dialog";
      dialog.setAttribute("data-sticker-dialog", ""); dialog.setAttribute("aria-label", title);
      dialog.innerHTML = `<form><header><span class="desktop-delete-eyebrow">Стикеры · ZeTer OS</span><h2>${title}</h2><p>${escape(controller.desktops().find(desk => desk.id === currentDesktop())?.name || "")}${!isProject && !isPreferences ? " · " + escape(library.projects.find(project => project.id === ownerProjectId)?.name || "") : ""}</p></header><div class="desktop-delete-body"><div data-sticker-dialog-fields>${fields}</div>${action !== "add" && !isPreferences ? `<div class="sticker-library-dialog-danger"><button class="app-btn" type="button" data-sticker-dialog-remove>${isProject ? "Удалить проект" : "Удалить категорию"}</button><p>Стикеры и заметки сохранятся без привязки к ${isProject ? "проекту" : "категории"}.</p></div>` : ""}<p data-sticker-dialog-confirm hidden>Удалить ${isProject ? "проект" : "категорию"} «${escape(item?.name || "") }»? Стикеры и заметки сохранятся.</p></div><footer><p class="desktop-delete-error" data-sticker-dialog-error role="alert" hidden></p><div class="desktop-delete-actions"><button class="app-btn" type="button" data-sticker-dialog-cancel>Отмена</button><button class="app-btn primary" type="submit" data-sticker-dialog-submit>${isPreferences ? "Сохранить настройки" : action === "add" ? "Создать" : "Сохранить"}</button></div></footer></form>`;
      root.appendChild(dialog);
      const form = dialog.querySelector("form"), input = form.elements.entityName, errorNode = dialog.querySelector("[data-sticker-dialog-error]");
      let removing = false, pending = false;
      const readDraft = () => isPreferences ? { density: form.elements.density.value, sort: form.elements.sort.value, defaultColor: form.elements.defaultColor.value, showPath: form.elements.showPath.checked, showHint: form.elements.showHint.checked } : { name: input.value, ...(isProject ? { description: form.elements.description.value, color: form.elements.projectColor.value, iconId: draftPreset, iconDataURL: draftIcon } : {}) };
      const initialDraft = JSON.stringify(readDraft());
      groupDialog = { dialog, changed: () => imagePending || JSON.stringify(readDraft()) !== initialDraft };
      const close = () => {
        if (pending) return;
        closed = true; imageGeneration++;
        dialog.close(); dialog.remove(); groupDialog = null;
        const matching = [...root.querySelectorAll(`[data-sticker-action="${trigger?.dataset.stickerAction || "add-project"}"]`)].find(node => node.dataset.groupId === trigger?.dataset.groupId);
        const candidates = [trigger, matching, $('[data-sticker-action="add-project"]'), $('[data-sticker-action="new"]')];
        candidates.find(node => node?.isConnected && !node.closest("[hidden]") && node.getClientRects().length)?.focus();
      };
      dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
      dialog.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const nodes = [...dialog.querySelectorAll("input,select,textarea,button")].filter(node => !node.disabled && !node.closest("[hidden]") && node.getClientRects().length);
        const first = nodes[0], last = nodes.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
      });
      dialog.querySelector("[data-sticker-dialog-cancel]").addEventListener("click", close);
      dialog.querySelector("[data-sticker-dialog-remove]")?.addEventListener("click", () => {
        removing = true; input.disabled = true;
        dialog.querySelector("[data-sticker-dialog-fields]").hidden = true;
        dialog.querySelector(".sticker-library-dialog-danger").hidden = true;
        dialog.querySelector("[data-sticker-dialog-confirm]").hidden = false;
        dialog.querySelector("[data-sticker-dialog-submit]").textContent = isProject ? "Удалить проект" : "Удалить категорию";
        dialog.querySelector("[data-sticker-dialog-cancel]").focus();
      });
      form.addEventListener("submit", async event => {
        event.preventDefault(); if (pending || busy || imagePending) return;
        const name = input?.value.trim() || "", draft = readDraft();
        if (!isPreferences && !removing && !name) { input.setCustomValidity("Введите название."); input.reportValidity(); return; }
        pending = true; errorNode.hidden = true;
        const controls = [...form.querySelectorAll('input,select,textarea,button')]; controls.forEach(node => { node.disabled = true; });
        const saved = await run(() => isPreferences ? controller.setPreferences(desk, draft, expectedSettings) : controller.group(desk, kind, removing ? "remove" : action, id, name, ownerProjectId, isProject ? draft : null, expectedSettings));
        pending = false;
        if (saved) { close(); return; }
        controls.forEach(node => { node.disabled = false; }); if (input) input.disabled = removing;
        errorNode.textContent = $("[data-sticker-status]").textContent; errorNode.hidden = false;
        (removing ? dialog.querySelector("[data-sticker-dialog-cancel]") : input || form.elements.density).focus();
      });
      input?.addEventListener("input", () => input.setCustomValidity(""));
      if (isProject) {
        const syncIcon = () => {
          dialog.querySelector('[data-sticker-icon-preview]').innerHTML = projectMark({ iconId: draftPreset, iconDataURL: draftIcon, color: form.elements.projectColor.value }, true);
          dialog.querySelectorAll('[data-sticker-icon-preset]').forEach(node => node.setAttribute('aria-pressed', String(!draftIcon && node.dataset.stickerIconPreset === draftPreset)));
          dialog.querySelector('[data-sticker-icon-reset]').hidden = !draftIcon;
          dialog.querySelector('[data-sticker-dialog-submit]').disabled = imagePending;
          dialog.querySelector('[data-sticker-upload-status]').textContent = imagePending ? 'Подготовка значка…' : 'PNG, JPG или WebP до 2 МБ. Значок обрезается до квадрата.';
        };
        form.elements.projectColor.addEventListener('change', syncIcon);
        dialog.querySelectorAll('[data-sticker-icon-preset]').forEach(node => node.addEventListener('click', () => { imageGeneration++; imagePending = false; draftPreset = node.dataset.stickerIconPreset; draftIcon = ""; syncIcon(); }));
        dialog.querySelector('[data-sticker-icon-reset]').addEventListener('click', () => { imageGeneration++; imagePending = false; draftIcon = ""; syncIcon(); });
        dialog.querySelector('[data-sticker-icon-upload]').addEventListener('click', () => dialog.querySelector('[data-sticker-icon-file]').click());
        dialog.querySelector('[data-sticker-icon-file]').addEventListener('change', async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file || pending) return;
          const generation = ++imageGeneration; imagePending = true; errorNode.hidden = true; syncIcon();
          dialog.querySelector('[data-sticker-upload-status]').textContent = 'Подготовка значка…';
          try {
            if (file.size > 2 * 1024 * 1024 || (file.type ? !['image/png','image/jpeg','image/webp'].includes(file.type) : !/\.(png|jpe?g|webp)$/i.test(file.name))) throw new Error('Выберите PNG, JPG или WebP до 2 МБ.');
            const image = await options.createProjectIcon(file);
            // inert can be temporary while a child window refuses shutdown. Settle
            // this draft even then; real closure is guarded by lifetime/generation.
            if (closed || generation !== imageGeneration || !dialog.isConnected) return;
            if (!libraryUtils.isProjectIconDataURL(image.dataURL)) throw new Error('Не удалось подготовить небольшой PNG-значок. Выберите другую картинку.');
            draftIcon = image.dataURL;
          } catch (error) { if (!closed && generation === imageGeneration && dialog.isConnected) { errorNode.textContent = error.message || 'Не удалось загрузить значок.'; errorNode.hidden = false; } }
          finally { if (!closed && generation === imageGeneration && dialog.isConnected) { imagePending = false; dialog.querySelector('[data-sticker-upload-status]').textContent = 'PNG, JPG или WebP до 2 МБ. Значок обрезается до квадрата.'; syncIcon(); } }
        });
      }
      dialog.showModal(); (input || form.elements.density).focus();
    }
    function bindDrag(handle) {
      let start = null, ghost = null;
      const cleanup = () => { ghost?.remove(); ghost = null; start = null; };
      handle.addEventListener("pointerdown", event => { if (event.button !== 0 || busy) return; start = { x: event.clientX, y: event.clientY }; handle.setPointerCapture(event.pointerId); event.preventDefault(); });
      handle.addEventListener("pointermove", event => {
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 7 && !ghost) return;
        if (!ghost) { ghost = doc.createElement("div"); ghost.className = "sticker-library-drag-ghost"; ghost.textContent = handle.closest("article").querySelector("h3").textContent; doc.body.appendChild(ghost); }
        ghost.style.left = `${event.clientX + 12}px`; ghost.style.top = `${event.clientY + 12}px`;
      });
      handle.addEventListener("pointerup", event => {
        const moved = Boolean(ghost), card = handle.closest("article"); cleanup();
        if (!moved) return;
        const entry = resolve(card.dataset.stickerOwner, card.dataset.stickerNote); if (!entry) return;
        if (event.clientX <= 1 || event.clientY <= 1 || event.clientX >= window.innerWidth - 1 || event.clientY >= window.innerHeight - 1) {
          if (options.nativeAvailable) options.openWindows(entry).catch(error => status(error.message, true));
          else options.showCapabilities?.();
          return;
        }
        const target = doc.elementFromPoint(event.clientX, event.clientY);
        if (target?.closest("#desktop-items,#desktop") && !target.closest(".window")) {
          run(() => options.placeOnDesktop(entry, event.clientX, event.clientY), "Стикер размещён на рабочем столе");
        } else status("Перетащите стикер на свободное место рабочего стола или используйте кнопку под карточкой.");
      });
      handle.addEventListener("pointercancel", cleanup); handle.addEventListener("lostpointercapture", cleanup);
    }
    root.addEventListener("click", async event => {
      const trigger = event.target.closest("[data-sticker-action]"); if (!trigger || busy) return;
      const action = trigger.dataset.stickerAction, card = trigger.closest("[data-sticker-note]");
      const entry = card && resolve(card.dataset.stickerOwner, card.dataset.stickerNote);
      if (editing && !trigger.closest('[data-sticker-editor]') && !await leaveInlineEditor()) return;
      if (action === "navigation") { const open = !root.hasAttribute("data-navigation-open"); root.toggleAttribute("data-navigation-open", open); trigger.setAttribute("aria-expanded", String(open)); return; }
      if (action === "new") return edit(null, trigger);
      if (action === "cancel") { if (await discard()) closeEditor(); return; }
      if (action === "clear") { query = ""; searchText = ""; $('[data-sticker-search]').value = ""; categoryId = ""; filter = "all"; refresh(); return; }
      if (["all", "favorites", "on-desktop", "unassigned"].includes(action)) { filter = action; projectId = ""; categoryId = ""; refresh(); closeNavigation(); return; }
      if (action === "project") { projectId = trigger.dataset.groupId; categoryId = ""; filter = "all"; refresh(); closeNavigation(); return; }
      if (action === "add-project") return groupEditor("projects", "add", trigger);
      if (action === "project-settings") return groupEditor("projects", "rename", trigger, trigger.dataset.groupId);
      if (action === "add-category" && projectId) return groupEditor("categories", "add", trigger);
      if (action === "category-settings" && categoryId) return groupEditor("categories", "rename", trigger, categoryId);
      if (!entry) return;
      if (action === "edit" || action === "quick-edit") return edit(entry, trigger);
      if (action === "note") return options.openNote(entry);
      if (action === "windows") { if (!options.nativeAvailable) { options.showCapabilities?.(); return; } try { await options.openWindows(entry); status("Стикер открыт отдельным окном Windows"); } catch (error) { status(error.message, true); } return; }
      if (action === "desktop") return run(() => controller.setDesktop(entry.desktopId, entry.note.id, entry.sticky.desktop === false));
      if (action === "favorite") return run(() => controller.toggleFavorite(entry.desktopId, entry.note.id));
      if (action === "remove" && await options.confirm(`Удалить стикер «${entry.note.name}»? Заметка и её вложения сохранятся.`)) {
        const saved = await run(() => controller.removeEntry(entry.desktopId, entry.note.id), "Стикер удалён. Заметка сохранена.");
        if (saved && editing?.note.id === entry.note.id) closeEditor();
      }
    });
    const settingsOpener = $('[data-sticker-settings]');
    settingsOpener.addEventListener('click', async () => { if (!root.inert && !busy && await leaveInlineEditor()) groupEditor('preferences', 'edit', settingsOpener); });
    root.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const menu = event.target.closest('.sticker-library-card-menu[open]');
      if (menu) { event.preventDefault(); event.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); }
    });
    root.addEventListener("toggle", event => {
      if (!event.target.matches('.sticker-library-card-menu[open]')) return;
      root.querySelectorAll('.sticker-library-card-menu[open]').forEach(menu => { if (menu !== event.target) menu.open = false; });
    }, true);
    root.addEventListener("pointerdown", event => {
      if (!event.target.closest('.sticker-library-card-menu')) root.querySelectorAll('.sticker-library-card-menu[open]').forEach(menu => { menu.open = false; });
    });
    $("[data-sticker-search]").addEventListener("input", async event => { const selected = event.target.value; if (!await leaveInlineEditor()) { event.target.value = searchText; return; } searchText = selected; query = searchText.trim().toLocaleLowerCase("ru"); refresh(); });
    $("[data-sticker-desktop]").addEventListener("change", async event => { const selected = event.target.value; if (!await leaveInlineEditor()) { event.target.value = desktopId; return; } desktopId = selected; projectId = ""; categoryId = ""; refresh(); });
    $("[data-sticker-sort]").addEventListener("change", event => { if (!leaveInlineEditor()) { event.target.value = sortOrder; return; } sortOrder = event.target.value; refresh(); });
    $("[data-sticker-category]").addEventListener("change", async event => { const selected = event.target.value; if (!await leaveInlineEditor()) { event.target.value = categoryId; return; } categoryId = selected; refresh(); });
    root.requestStickerClose = async signal => {
      if (busy) { status("Дождитесь завершения сохранения. Окно оставлено открытым.", true); return false; }
      return await discard(signal) && (!groupDialog?.changed() || await options.confirm("Закрыть форму проекта или категории без сохранения изменений?", { action: "Закрыть без сохранения", signal }));
    };
    root.hasUnsavedStickerChanges = () => !root.inert && (dirty || busy || Boolean(groupDialog?.changed()));
    root.prepareStickerClose = async signal => { if (!await root.requestStickerClose(signal) || signal?.aborted) return false; root.inert = true; if (groupDialog) groupDialog.dialog.inert = true; if (editorDialog) editorDialog.inert = true; return true; };
    root.cancelStickerClose = () => { root.inert = false; if (groupDialog) groupDialog.dialog.inert = false; if (editorDialog) editorDialog.inert = false; };
    root.refreshStickers = refresh; refresh(); return root;
  }
  window.ZETER_STICKER_LIBRARY_UI_UTILS = Object.freeze({ createStickerLibraryApp });
})();
