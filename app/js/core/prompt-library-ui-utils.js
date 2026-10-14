(() => {
  "use strict";
  const { escapeHtml: e } = window.ZETER_CORE_UTILS;
  const { filterPromptEntries } = window.ZETER_PROMPT_LIBRARY_UTILS;
  const star = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.55 4.45 1.08 6.28L12 17.36l-5.63 2.97 1.08-6.28L2.9 9.6l6.3-.9z"/></svg>';
  function promptRowsHTML(entries) {
    return entries.length ? entries.map(item => `<article class="link-library-row" data-prompt-row="${e(item.id)}"><span class="link-library-icon" aria-hidden="true">✦</span>
      <div class="link-library-details"><strong>${e(item.name)}</strong><details class="prompt-library-text"><summary>Текст промпта</summary><p>${e(item.text)}</p></details></div>
      <button type="button" class="app-btn link-library-star" data-prompt-action="favorite" data-prompt-id="${e(item.id)}" aria-pressed="${item.favorite}" title="${item.favorite ? "Убрать из избранного" : "Добавить в избранное"}" aria-label="${item.favorite ? "Убрать из избранного" : "Добавить в избранное"}">${star}</button>
      <div class="link-library-actions"><button class="app-btn" data-prompt-action="copy" data-prompt-id="${e(item.id)}">Скопировать промпт</button><button class="app-btn" data-prompt-action="edit" data-prompt-id="${e(item.id)}">Изменить</button><button class="danger-btn" data-prompt-action="delete" data-prompt-id="${e(item.id)}">Удалить</button></div></article>`).join("") : '<div class="link-library-empty"><span>✦</span><h2>Здесь пока нет промптов</h2><p>Добавьте промпт в этот проект или измените поиск и выбранную категорию.</p></div>';
  }
  function promptEditorHTML(draft, library, editing) {
    const missingProject = draft.projectId !== "" && !library.projects.some(item => item.id === draft.projectId);
    const missingCategory = draft.categoryId && !library.categories.some(item => item.id === draft.categoryId && item.projectId === draft.projectId);
    return `<form class="link-library-editor" data-prompt-form><h2>${editing ? "Изменить промпт" : "Новый промпт"}</h2>
      <label class="link-library-field-wide">Название<input class="app-input" name="name" maxlength="300" required value="${e(draft.name || "")}" placeholder="Например, проверка кода"></label>
      <label>Проект<select class="app-input" name="projectId"><option value=""${draft.projectId === "" ? " selected" : ""}>Без проекта</option>${missingProject ? `<option value="${e(draft.projectId || "")}" selected disabled>Проект недоступен — выберите другой</option>` : ""}${library.projects.map(item => `<option value="${e(item.id)}"${draft.projectId === item.id ? " selected" : ""}>${e(item.name)}</option>`).join("")}</select></label>
      <label${draft.projectId === "" ? " hidden" : ""}>Категория<select class="app-input" name="categoryId"><option value="">Без категории</option>${missingCategory ? `<option value="${e(draft.categoryId)}" selected disabled>Категория недоступна — выберите другую</option>` : ""}${library.categories.filter(item => item.projectId === draft.projectId).map(item => `<option value="${e(item.id)}"${draft.categoryId === item.id ? " selected" : ""}>${e(item.name)}</option>`).join("")}</select></label>
      <label class="link-library-field-wide">Промпт<textarea class="app-input" name="text" maxlength="100000" required rows="10" placeholder="Введите текст, который нужно копировать">${e(draft.text || "")}</textarea></label>
      <p class="muted link-library-field-wide">«Скопировать промпт» копирует только этот текст — с переносами строк и пробелами.</p>
      ${missingProject || missingCategory ? '<p class="link-library-field-wide">Проект или категория черновика удалены в другом окне. Выберите доступный проект и категорию перед сохранением.</p>' : ""}
      <div class="link-library-form-actions"><button class="app-btn primary" type="submit">Сохранить</button><button class="app-btn" type="button" data-prompt-action="cancel">Отмена</button></div></form>`;
  }
  function createPromptLibraryApp(params = {}, options = {}) {
    const doc = options.documentRef || document, controller = options.controller, root = doc.createElement("div");
    root.className = "link-library-app prompt-library-app";
    let projectId = params.projectId || "", filter = "all", query = "", draft = null, editingId = "", busy = false, message = "", error = false;
    function readDraft() {
      const form = root.querySelector("[data-prompt-form]");
      if (form) {
        const text = form.elements.namedItem("text").value;
        // A textarea normalizes CRLF. Keep an unchanged imported body byte-for-byte.
        const exactText = text === String(draft?.text || "").replace(/\r\n?/g, "\n") ? draft.text : text;
        draft = { ...Object.fromEntries(["name", "projectId", "categoryId"].map(key => [key, form.elements.namedItem(key).value])), text: exactText };
      }
    }
    function status(text, isError = false) {
      message = text; error = isError; const node = root.querySelector("[data-prompt-status]");
      if (node) { node.textContent = text; node.hidden = !text; node.classList.toggle("error", isError); }
    }
    function rows() {
      const entries = filterPromptEntries(controller.library(), projectId, filter, query);
      root.querySelector("[data-prompt-list]").innerHTML = promptRowsHTML(entries);
      root.querySelector("[data-prompt-count]").textContent = `Промптов: ${entries.length}`;
    }
    function render() {
      const library = controller.library();
      if (projectId && !library.projects.some(item => item.id === projectId)) projectId = "";
      const categories = library.categories.filter(item => item.projectId === projectId);
      if (!["all", "favorites", "uncategorized"].includes(filter) && !categories.some(item => item.id === filter)) filter = "all";
      const nav = (id, name) => `<button class="app-btn link-library-filter${id === filter ? " active" : ""}" data-prompt-filter="${e(id)}" aria-pressed="${id === filter}"><span>${e(name)}</span><small>${filterPromptEntries(library, projectId, id).length}</small></button>`;
      const categoryRows = categories.map(item => `<div class="prompt-library-category"><div class="link-library-category-row">${nav(item.id, item.name)}</div><details><summary aria-label="Настройки категории ${e(item.name)}">⚙</summary><div><button class="app-btn" data-prompt-action="category-rename" data-category-id="${e(item.id)}">Переименовать</button><button class="danger-btn" data-prompt-action="category-delete" data-category-id="${e(item.id)}">Удалить категорию</button></div></details></div>`).join("");
      root.innerHTML = `<header class="link-library-header"><div class="link-library-brand"><span class="link-library-brand-icon" aria-hidden="true">✦</span><div><h1>Промпты</h1><p class="muted">Промпты и проекты текущего рабочего стола</p></div></div><button class="app-btn primary" data-prompt-action="add">+ Добавить промпт</button></header>
        <div class="link-library-layout"><aside class="link-library-sidebar" aria-label="Проект и категории промптов"><label class="prompt-library-project">Проект<select class="app-input" data-prompt-project><option value=""${projectId === "" ? " selected" : ""}>Без проекта</option>${library.projects.map(item => `<option value="${e(item.id)}"${item.id === projectId ? " selected" : ""}>${e(item.name)}</option>`).join("")}</select></label>
        <div class="prompt-library-project-actions"><button class="app-btn" data-prompt-action="project-add">+ Создать проект</button>${projectId ? '<details><summary>Настройки проекта</summary><button class="app-btn" data-prompt-action="project-rename">Переименовать</button><button class="danger-btn" data-prompt-action="project-delete">Удалить проект</button></details>' : ""}</div>
        ${nav("all", "Все промпты")}${nav("favorites", "Избранное")}${nav("uncategorized", "Без категории")}${projectId ? `<div class="link-library-category-heading"><strong>Категории проекта</strong><button class="app-btn" data-prompt-action="category-add" aria-label="Создать категорию">+</button></div>${categoryRows}` : ""}</aside>
        <main class="link-library-main"><label class="link-library-search">${projectId ? "Поиск в проекте" : "Поиск без проекта"}<input class="app-input" type="search" data-prompt-search value="${e(query)}" placeholder="Название или текст промпта"></label>
        <p class="link-library-status${error ? " error" : ""}" data-prompt-status role="status" aria-live="polite"${message ? "" : " hidden"}>${e(message)}</p>
        ${draft ? promptEditorHTML(draft, library, Boolean(editingId)) : ""}<div class="link-library-list-heading"><h2>${projectId ? "Промпты проекта" : "Промпты без проекта"}</h2><span data-prompt-count></span></div><div class="link-library-list" data-prompt-list></div></main></div>`;
      // HTML parsing removes the first LF in textarea content; assign the value explicitly.
      if (draft) root.querySelector('[name="text"]').value = draft.text || "";
      rows();
      if (busy) root.querySelectorAll("button, input, select, textarea").forEach(node => { node.disabled = true; });
    }
    async function commit(operation, after = () => {}) {
      if (busy) return false; readDraft(); busy = true; render(); status("Сохранение…");
      let saved = false;
      try { const result = await operation(); saved = true; after(result); busy = false; status("Сохранено"); render(); options.onChange?.(); return true; }
      catch (caught) { busy = false; status(saved ? "Сохранено, но интерфейс не обновился. Откройте приложение заново." : caught.message || "Не удалось сохранить. Изменения отменены.", true); render(); return saved; }
    }
    function showDialog(title, content, submitLabel, execute, initialFocus = "[data-prompt-dialog-cancel]") {
      if (doc.querySelector("[data-prompt-dialog][open]")) return;
      readDraft();
      const dialog = doc.createElement("dialog"), previousFocus = doc.activeElement;
      dialog.className = "desktop-delete-dialog prompt-library-dialog";
      dialog.setAttribute("data-prompt-dialog", ""); dialog.setAttribute("aria-label", title);
      dialog.innerHTML = `<form><header><span class="desktop-delete-eyebrow">Промпты · ZeTer OS</span><h2>${e(title)}</h2></header><div class="desktop-delete-body">${content}</div><footer><p class="desktop-delete-error" data-prompt-dialog-error role="alert" hidden></p><div class="desktop-delete-actions"><button class="app-btn" type="button" data-prompt-dialog-cancel>Отмена</button><button class="app-btn primary" type="submit" data-prompt-dialog-submit>${e(submitLabel)}</button></div></footer></form>`;
      doc.body.append(dialog);
      let dialogBusy = false;
      const close = () => { dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); else (root.querySelector('[data-prompt-action="project-add"]') || root.querySelector('[data-prompt-action="add"]'))?.focus(); };
      dialog.addEventListener("cancel", event => { event.preventDefault(); if (!dialogBusy) close(); });
      dialog.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Tab") {
          const focusable = [...dialog.querySelectorAll("input, button")].filter(node => !node.disabled);
          const first = focusable[0], last = focusable.at(-1);
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
        }
      });
      dialog.querySelector("[data-prompt-dialog-cancel]").addEventListener("click", () => { if (!dialogBusy) close(); });
      dialog.addEventListener("change", event => {
        const choices = [...dialog.querySelectorAll('[name="projectDisposition"]')];
        if (!choices.includes(event.target)) return;
        if (event.target.checked) choices.forEach(input => { if (input !== event.target) input.checked = false; });
        const choice = choices.find(input => input.checked), submit = dialog.querySelector('[type="submit"]');
        submit.disabled = !choice; submit.textContent = choice?.value === "delete" ? "Удалить проект и все его промпты" : "Удалить проект и перенести промпты";
      });
      dialog.querySelector("form").addEventListener("submit", async event => {
        event.preventDefault(); if (dialogBusy) return;
        const choice = dialog.querySelector('[name="projectDisposition"]:checked');
        if (dialog.querySelector('[name="projectDisposition"]') && !choice) return;
        const name = dialog.querySelector('[name="entityName"]')?.value;
        const mode = choice?.value;
        dialogBusy = true;
        dialog.querySelectorAll("button, input").forEach(node => { node.disabled = true; });
        const errorNode = dialog.querySelector("[data-prompt-dialog-error]"); errorNode.hidden = true;
        const success = await commit(() => execute(name, mode));
        dialogBusy = false;
        if (success) { close(); return; }
        errorNode.textContent = message; errorNode.hidden = false;
        dialog.querySelectorAll("button, input").forEach(node => { node.disabled = false; });
        (dialog.querySelector('[name="entityName"]') || dialog.querySelector('[data-prompt-dialog-cancel]')).focus();
      });
      dialog.showModal(); dialog.querySelector(initialFocus)?.focus();
    }
    function nameDialog(title, value, execute) {
      showDialog(title, `<label class="prompt-library-dialog-field">Название<input class="app-input" name="entityName" maxlength="120" required value="${e(value)}" autocomplete="off"></label>`, "Сохранить", execute, '[name="entityName"]');
    }
    root.addEventListener("input", event => { if (event.target.matches("[data-prompt-search]")) { query = event.target.value; rows(); } });
    root.addEventListener("change", event => {
      if (busy) return;
      if (event.target.matches("[data-prompt-project]")) { readDraft(); projectId = event.target.value; filter = "all"; query = ""; render(); }
      else if (event.target.matches('[data-prompt-form] [name="projectId"]')) { readDraft(); draft.categoryId = ""; render(); root.querySelector('[name="projectId"]')?.focus(); }
    });
    root.addEventListener("submit", event => {
      if (!event.target.matches("[data-prompt-form]")) return; event.preventDefault(); readDraft();
      void commit(() => controller.saveEntry(draft, editingId), item => { projectId = item.projectId; filter = "all"; query = ""; draft = null; editingId = ""; });
    });
    root.addEventListener("click", async event => {
      const button = event.target.closest("button"); if (!button || !root.contains(button) || busy) return;
      if (button.dataset.promptFilter) { readDraft(); filter = button.dataset.promptFilter; render(); return; }
      const action = button.dataset.promptAction, library = controller.library(), entry = library.entries.find(item => item.id === button.dataset.promptId);
      if (action === "add" || action === "edit") {
        if (action === "edit" && !entry) return;
        if (draft && !options.confirm("Заменить открытый несохранённый черновик?")) return;
        editingId = entry?.id || ""; draft = entry ? { ...entry } : { projectId, categoryId: library.categories.some(item => item.projectId === projectId && item.id === filter) ? filter : "" }; message = ""; render(); root.querySelector('[name="name"]')?.focus();
      } else if (action === "cancel") { draft = null; editingId = ""; render(); }
      else if (action === "copy" && entry) {
        try { await options.copyText(entry.text); status("Промпт скопирован"); }
        catch { status("Не удалось скопировать. Откройте «Изменить» и скопируйте поле «Промпт» вручную.", true); }
      } else if (action === "favorite" && entry) {
        await commit(() => controller.toggleFavorite(entry.id));
        [...root.querySelectorAll('[data-prompt-action="favorite"]')].find(node => node.dataset.promptId === entry.id)?.focus();
      } else if (action === "delete" && entry && options.confirm(`Удалить промпт «${entry.name}»?`)) await commit(() => controller.removeEntry(entry.id), () => { if (editingId === entry.id) { draft = null; editingId = ""; } });
      else if (action === "project-add") nameDialog("Создать проект", "", async name => { const item = await controller.addProject(name); projectId = item.id; filter = "all"; query = ""; });
      else if (action === "project-rename") { const item = library.projects.find(item => item.id === projectId); if (item) nameDialog("Переименовать проект", item.name, name => controller.renameProject(item.id, name)); }
      else if (action === "project-delete") {
        const item = library.projects.find(item => item.id === projectId); if (!item) return;
        const count = library.entries.filter(entry => entry.projectId === item.id).length;
        showDialog(`Удалить проект «${item.name}»?`, `<div class="desktop-delete-warning"><b>Проект и его категории будут удалены.</b><p>В проекте промптов: ${count}. Выберите, что сделать со всеми промптами проекта. Поиск и открытая категория не ограничивают действие.</p></div><div class="desktop-delete-groups"><label class="desktop-delete-group"><input type="checkbox" name="projectDisposition" value="transfer" checked><span><b>Перенести все промпты в «Без категории»</b><small>Промпты сохранятся без проекта; текст, название и избранное останутся прежними.</small></span></label><label class="desktop-delete-group"><input type="checkbox" name="projectDisposition" value="delete"><span><b>Удалить все промпты проекта</b><small>Удаление без корзины. Существующие резервные копии сохранятся.</small></span></label></div><p class="desktop-delete-scope">Будут обработаны все промпты этого проекта на момент подтверждения, включая добавленные в другом окне. Другие проекты и общие промпты сохранятся.</p>`, "Удалить проект и перенести промпты", async (name, mode) => {
          await controller.removeProject(item.id, mode); projectId = ""; filter = "uncategorized"; query = "";
          if (draft?.projectId === item.id) {
            if (mode === "transfer") { draft.projectId = ""; draft.categoryId = ""; }
            else if (editingId) { draft = null; editingId = ""; }
          }
        });
      }
      else if (action === "category-add" && projectId) { const id = projectId; nameDialog("Создать категорию", "", async name => { const item = await controller.addCategory(id, name); filter = item.id; }); }
      else if (action === "category-rename") { const item = library.categories.find(item => item.id === button.dataset.categoryId); if (item) nameDialog("Переименовать категорию", item.name, name => controller.renameCategory(item.id, name)); }
      else if (action === "category-delete" && options.confirm("Удалить категорию? Промпты сохранятся в «Без категории» того же проекта.")) await commit(() => controller.removeCategory(button.dataset.categoryId), () => { if (draft?.categoryId === button.dataset.categoryId) draft.categoryId = ""; });
    });
    root.refreshLibrary = () => { readDraft(); render(); };
    render(); return root;
  }
  window.ZETER_PROMPT_LIBRARY_UI_UTILS = Object.freeze({ promptRowsHTML, promptEditorHTML, createPromptLibraryApp });
})();
