(() => {
  "use strict";
  const coreUtils = window.ZETER_CORE_UTILS;
  const linkLibraryUtils = window.ZETER_LINK_LIBRARY_UTILS;
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!coreUtils || !linkLibraryUtils || !shortcutUtils) throw new Error("ZeTer OS link library UI requires core, library and shortcut utils.");
  const { escapeHtml } = coreUtils;
  const { filterLinkEntries, orderedLinkCategories, isLinkPinned } = linkLibraryUtils;
  const { shortcutIcon, shortcutKindLabel } = shortcutUtils;
  const e = escapeHtml;
  const pinIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 3h6l-1 6 4 4v3H6v-3l4-4zM12 16v6"/></svg>';
  const starPath = '<path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.08 6.28L12 17.36l-5.63 2.97 1.08-6.28L2.9 9.6l6.3-.9z"/>';
  let appSequence = 0;

  function linkRowsHTML(entries, selectedId = "", filter = "all") {
    return entries.length ? entries.map(entry => `<article class="link-library-row${entry.id === selectedId ? " selected" : ""}" data-link-row="${e(entry.id)}" tabindex="-1">
      <span class="link-library-icon" aria-label="${e(shortcutKindLabel(entry))}">${shortcutIcon(entry)}</span>
      <div class="link-library-details"><div class="link-library-entry-heading"><strong>${e(entry.name)}</strong>${isLinkPinned(entry, filter) ? '<small class="link-library-pin-label">Закреплена здесь</small>' : ""}</div><button type="button" class="link-library-target" data-link-action="open" data-link-id="${e(entry.id)}" title="${e(entry.target)}" aria-label="Открыть адрес: ${e(entry.target)}">${e(entry.target)}</button>${entry.description ? `<p>${e(entry.description)}</p>` : ""}</div>
      <div class="link-library-row-controls"><button type="button" class="app-btn link-library-pin" data-link-action="pin" data-link-id="${e(entry.id)}" aria-label="${isLinkPinned(entry, filter) ? "Открепить ссылку в этом разделе" : "Закрепить ссылку в этом разделе"}" title="${isLinkPinned(entry, filter) ? "Открепить в этом разделе" : "Закрепить в этом разделе"}" aria-pressed="${isLinkPinned(entry, filter)}">${pinIcon}</button><button type="button" class="app-btn link-library-star" data-link-action="favorite" data-link-id="${e(entry.id)}" aria-label="${entry.favorite ? "Убрать из избранного" : "Добавить в избранное"}" title="${entry.favorite ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${Boolean(entry.favorite)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="${entry.favorite ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${starPath}</svg></button></div>
      <div class="link-library-actions"><button class="app-btn" data-link-action="open" data-link-id="${e(entry.id)}">Открыть</button><button class="app-btn" data-link-action="copy" data-link-id="${e(entry.id)}">Копировать</button><button class="app-btn" data-link-action="edit" data-link-id="${e(entry.id)}">Изменить</button><button class="danger-btn" data-link-action="delete" data-link-id="${e(entry.id)}">Удалить</button></div>
    </article>`).join("") : `<div class="link-library-empty"><span>🔗</span><h2>Здесь пока нет ссылок</h2><p>Добавьте адрес сайта, путь Windows или ссылку на объект ZeTer OS. Если включён поиск, измените запрос или фильтр.</p></div>`;
  }

  function linkEditorHTML(draft, categories, editing) {
    return `<form class="link-library-editor" data-link-form><h2>${editing ? "Изменить ссылку" : "Новая ссылка"}</h2>
      <label class="link-library-field-wide">Название<input class="app-input" name="name" required maxlength="300" value="${e(draft.name || "")}" placeholder="Например, материалы курса" autocomplete="off"></label>
      <label class="link-library-field-wide">Адрес<input class="app-input" name="target" required maxlength="32768" value="${e(draft.target || "")}" placeholder="https://example.com, C:\\Папка или zeter://item/ID" autocomplete="off"></label>
      <p class="muted link-library-field-wide">Сайт, папка или файл Windows, объект ZeTer OS. Тип ссылки определяется автоматически.</p>
      <label>Категория<select class="app-input" name="categoryId"><option value="">Без категории</option>${categories.map(category => `<option value="${e(category.id)}"${draft.categoryId === category.id ? " selected" : ""}>${e(category.name)}</option>`).join("")}</select></label>
      <button type="button" class="app-btn link-library-create-category" data-link-action="form-category">+ Создать категорию</button>
      <label class="link-library-field-wide"><span>Описание <small class="muted">(необязательно)</small></span><textarea class="app-input" name="description" maxlength="4000" rows="3" placeholder="Для чего пригодится эта ссылка">${e(draft.description || "")}</textarea></label>
      <div class="link-library-form-actions"><button class="app-btn primary" type="submit">Сохранить</button><button class="app-btn" type="button" data-link-action="cancel">Отмена</button></div></form>`;
  }

  function createLinkLibraryApp(params = {}, options = {}) {
    const documentRef = options.documentRef || document;
    const controller = options.controller;
    const root = documentRef.createElement("div");
    root.className = "link-library-app";
    const instanceId = ++appSequence;
    let filter = "all", query = "", draft = null, editingId = "", selectedId = params.entryId || "", busy = false;
    let message = "", error = false;
    function readDraft() {
      const form = root.querySelector("[data-link-form]");
      if (form) draft = { name: form.elements.namedItem("name").value, target: form.elements.namedItem("target").value,
        categoryId: form.elements.namedItem("categoryId").value, description: form.elements.namedItem("description").value };
    }
    function setMessage(text, isError = false) {
      message = text; error = isError;
      const status = root.querySelector("[data-link-status]");
      if (status) { status.textContent = text; status.classList.toggle("error", isError); status.hidden = !text; }
    }
    function renderRows() {
      const entries = filterLinkEntries(controller.library(), filter, query);
      root.querySelector("[data-link-list]").innerHTML = linkRowsHTML(entries, selectedId, filter);
      root.querySelector("[data-link-result-count]").textContent = `Ссылок: ${entries.length}`;
    }
    function render() {
      const library = controller.library();
      if (!["all", "favorites", "uncategorized"].includes(filter) && !library.categories.some(category => category.id === filter)) filter = "all";
      const nav = (id, name, count) => `<button class="app-btn link-library-filter${filter === id ? " active" : ""}" data-link-filter="${e(id)}" aria-pressed="${filter === id}"><span>${e(name)}</span><small>${count}</small></button>`;
      const sortedCategories = orderedLinkCategories(library);
      const categories = sortedCategories.map((category, index) => {
        const menuId = `link-category-menu-${instanceId}-${index}`;
        const peers = sortedCategories.filter(item => Boolean(item.pinned) === Boolean(category.pinned));
        const setting = (action, title, disabled = false) => `<button type="button" data-link-action="category-${action}" data-category-id="${e(category.id)}"${disabled ? " disabled" : ""}>${title}</button>`;
        return `<div class="link-library-category-row${filter === category.id ? " active" : ""}${category.pinned ? " pinned" : ""}">${nav(category.id, category.name, library.entries.filter(entry => entry.categoryId === category.id).length)}${category.pinned ? '<span class="link-library-category-pin" role="img" aria-label="Закреплена" title="Закреплённая категория"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 3h6l-1 6 4 4v3H6v-3l4-4zM12 16v6"/></svg></span>' : ""}<button type="button" class="app-btn link-library-category-gear" data-link-action="category-settings" data-category-id="${e(category.id)}" aria-label="Настройки категории ${e(category.name)}" aria-expanded="false" aria-controls="${menuId}"><span aria-hidden="true">⚙</span></button>
          <div id="${menuId}" class="link-library-category-menu" popover="auto" data-link-category-menu="${e(category.id)}" role="group" aria-label="Настройки категории ${e(category.name)}"><strong>${e(category.name)}</strong>${setting("rename", "Переименовать")}${setting("pin", category.pinned ? "Открепить категорию" : "Закрепить категорию")}${setting("up", "Переместить выше", peers[0].id === category.id)}${setting("down", "Переместить ниже", peers.at(-1).id === category.id)}<p>При удалении категории ссылки сохранятся в «Без категории».</p>${setting("delete", "Удалить категорию")}</div></div>`;
      }).join("");
      const title = filter === "all" ? "Все ссылки" : filter === "favorites" ? "Избранное" : filter === "uncategorized" ? "Без категории" : library.categories.find(category => category.id === filter)?.name;
      const visibleEntries = filterLinkEntries(library, filter, query);
      root.innerHTML = `<header class="link-library-header"><div class="link-library-brand"><span class="link-library-brand-icon" aria-hidden="true">🔗</span><div><h1>Ссылки</h1><p class="muted">Ссылки текущего рабочего стола</p></div></div><button class="app-btn primary" data-link-action="add">+ Добавить ссылку</button></header>
        <div class="link-library-layout"><aside class="link-library-sidebar" aria-label="Категории ссылок">${nav("all", "Все ссылки", library.entries.length)}${nav("favorites", "Избранное", library.entries.filter(entry => entry.favorite).length)}${nav("uncategorized", "Без категории", library.entries.filter(entry => !entry.categoryId).length)}
        <div class="link-library-category-heading"><strong>Категории</strong><button class="app-btn" data-link-action="category-add" aria-label="Создать категорию">+</button></div>
        ${categories}</aside>
        <main class="link-library-main"><label class="link-library-search">Поиск<input class="app-input" type="search" data-link-search value="${e(query)}" placeholder="Название, адрес или описание" aria-label="Поиск по ссылкам"></label>
        <p class="link-library-status${error ? " error" : ""}" data-link-status role="status" aria-live="polite"${message ? "" : " hidden"}>${e(message)}</p>
        ${draft ? linkEditorHTML(draft, sortedCategories, Boolean(editingId)) : ""}<div class="link-library-list-heading"><h2>${e(title)}</h2><span data-link-result-count>Ссылок: ${visibleEntries.length}</span></div><div class="link-library-list" data-link-list aria-label="Список ссылок">${linkRowsHTML(visibleEntries, selectedId, filter)}</div></main></div>`;
      if (busy) root.querySelectorAll("button, input, select, textarea").forEach(control => { control.disabled = true; });
    }
    function categoryGear(id) { return [...root.querySelectorAll('[data-link-action="category-settings"]')].find(button => button.dataset.categoryId === id); }
    function closeCategorySettings(restoreFocus = false) {
      root.querySelectorAll("[data-link-category-menu][data-open]").forEach(menu => {
        if (typeof menu.hidePopover === "function" && menu.matches(":popover-open")) menu.hidePopover();
        delete menu.dataset.open;
        const gear = categoryGear(menu.dataset.linkCategoryMenu);
        gear?.setAttribute("aria-expanded", "false");
        if (restoreFocus) gear?.focus();
      });
    }
    root.addEventListener("toggle", event => {
      const menu = event.target;
      if (!menu.matches?.("[data-link-category-menu]")) return;
      if (event.newState === "closed") delete menu.dataset.open;
      categoryGear(menu.dataset.linkCategoryMenu)?.setAttribute("aria-expanded", String(event.newState === "open"));
    }, true);
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && root.querySelector("[data-link-category-menu][data-open]")) {
        event.preventDefault(); event.stopPropagation(); closeCategorySettings(true);
      }
    });
    async function commit(operation, after = () => {}) {
      if (busy) return;
      const categoryFocus = documentRef.activeElement?.closest?.("[data-link-category-menu]")?.dataset.linkCategoryMenu;
      const entryFocus = documentRef.activeElement?.dataset?.linkId;
      const entryFocusAction = documentRef.activeElement?.dataset?.linkAction;
      const restoreEntryFocus = () => {
        if (entryFocus && ["pin", "favorite"].includes(entryFocusAction)) {
          const control = [...root.querySelectorAll("button[data-link-id]")].find(button => button.dataset.linkId === entryFocus && button.dataset.linkAction === entryFocusAction);
          (control || root.querySelector('[data-link-filter][aria-pressed="true"]'))?.focus();
        }
      };
      readDraft(); busy = true; setMessage("Сохранение…");
      root.querySelectorAll("button, input, select, textarea").forEach(control => { control.disabled = true; });
      let acknowledged = false;
      try {
        const result = await operation(); acknowledged = true; after(result); message = "Сохранено"; error = false;
        busy = false; render(); options.onChange?.();
        if (categoryFocus) (categoryGear(categoryFocus) || root.querySelector('[data-link-filter][aria-pressed="true"]'))?.focus();
        restoreEntryFocus();
      } catch (caught) {
        busy = false;
        if (caught.code === "DUPLICATE") { selectedId = caught.existingId; filter = "all"; query = ""; draft = null; editingId = ""; }
        message = acknowledged ? "Сохранено, но не удалось обновить интерфейс. Откройте приложение заново." : caught.message || "Не удалось сохранить. Изменения отменены; повторите попытку."; error = true;
        render();
        if (categoryFocus) categoryGear(categoryFocus)?.focus();
        restoreEntryFocus();
        if (caught.code === "DUPLICATE") root.querySelector(`[data-link-row="${selectedId}"]`)?.focus();
      }
    }
    root.addEventListener("input", event => { if (event.target.matches("[data-link-search]")) { query = event.target.value; renderRows(); } });
    root.addEventListener("submit", event => {
      if (!event.target.matches("[data-link-form]")) return;
      event.preventDefault(); readDraft();
      void commit(() => controller.saveEntry(draft, editingId), entry => { selectedId = entry.id; draft = null; editingId = ""; filter = "all"; query = ""; });
    });
    root.addEventListener("click", async event => {
      if (!event.target.closest("[data-link-category-menu], [data-link-action='category-settings']")) closeCategorySettings();
      const button = event.target.closest("button"); if (!button || !root.contains(button) || busy) return;
      if (button.dataset.linkFilter) { readDraft(); filter = button.dataset.linkFilter; render(); return; }
      const action = button.dataset.linkAction;
      const categoryId = button.dataset.categoryId;
      if (action === "category-settings") {
        const menu = root.querySelector(`#${button.getAttribute("aria-controls")}`);
        const wasOpen = menu.dataset.open === "true";
        closeCategorySettings();
        if (!wasOpen) {
          const rect = button.getBoundingClientRect(), viewport = documentRef.documentElement;
          const width = Math.min(252, viewport.clientWidth - 24);
          menu.style.width = `${width}px`;
          menu.style.left = `${Math.max(12, Math.min(rect.left, viewport.clientWidth - width - 12))}px`;
          menu.style.top = `${Math.max(12, Math.min(rect.bottom + 6, viewport.clientHeight - 350))}px`;
          menu.dataset.open = "true";
          if (typeof menu.showPopover === "function") menu.showPopover();
          button.setAttribute("aria-expanded", "true");
          menu.querySelector("button:not(:disabled)")?.focus();
        }
        return;
      }
      const entry = controller.library().entries.find(item => item.id === button.dataset.linkId);
      if (action === "add" || action === "edit") { if (action === "edit" && !entry) return; editingId = entry?.id || ""; draft = entry ? { ...entry } : { categoryId: controller.library().categories.some(category => category.id === filter) ? filter : "" }; message = ""; render(); root.querySelector('[name="name"]')?.focus(); }
      else if (action === "cancel") { draft = null; editingId = ""; message = ""; render(); }
      else if (action === "favorite" && entry) await commit(() => controller.toggleFavorite(entry.id));
      else if (action === "pin" && entry) await commit(() => controller.togglePinned(entry.id, filter));
      else if (action === "delete" && entry && options.confirm(`Удалить ссылку «${entry.name}»? Сам файл, сайт или объект останется.`)) await commit(() => controller.removeEntry(entry.id));
      else if ((action === "category-add" || action === "form-category")) {
        readDraft(); const name = options.prompt("Название новой категории:", "");
        if (name != null) await commit(() => controller.addCategory(name), category => { if (action === "form-category" && draft) draft.categoryId = category.id; else filter = category.id; });
      } else if (action === "category-rename") {
        const category = controller.library().categories.find(item => item.id === categoryId); if (!category) return;
        const name = options.prompt("Новое название категории:", category.name);
        if (name != null) await commit(() => controller.renameCategory(categoryId, name));
      } else if (action === "category-pin") await commit(() => controller.toggleCategoryPinned(categoryId));
      else if (action === "category-delete" && options.confirm("Удалить категорию? Все ссылки в ней перейдут в «Без категории».")) await commit(() => controller.removeCategory(categoryId), () => { if (filter === categoryId) filter = "uncategorized"; if (draft?.categoryId === categoryId) draft.categoryId = ""; });
      else if (action === "category-up" || action === "category-down") await commit(() => controller.moveCategory(categoryId, action === "category-up" ? -1 : 1));
      else if (action === "copy" && entry) {
        try { await options.copyText(entry.target); setMessage("Адрес скопирован"); } catch { setMessage("Не удалось скопировать. Выделите адрес в форме «Изменить» и скопируйте вручную.", true); }
      } else if (action === "open" && entry) {
        if (entry.kind === "windows" && !options.isNative()) { setMessage(`Windows-путь: ${entry.target}. В браузере используйте «Копировать»; открыть файл можно в Windows-версии.`, true); return; }
        try { const result = await options.openTarget(entry.target, entry.name); if (result === false && entry.kind !== "url") setMessage("Цель недоступна или открытие отменено. Ссылка остаётся в библиотеке.", true); }
        catch (caught) { setMessage(caught.message || "Не удалось открыть цель. Ссылка остаётся в библиотеке.", true); }
      }
    });
    root.refreshLibrary = () => { readDraft(); render(); };
    render();
    return root;
  }
  window.ZETER_LINK_LIBRARY_UI_UTILS = Object.freeze({ linkRowsHTML, linkEditorHTML, createLinkLibraryApp });
})();
