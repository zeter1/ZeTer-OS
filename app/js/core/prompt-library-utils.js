(() => {
  "use strict";
  const SAFE_ID = /^[A-Za-z0-9_-]{1,220}$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  function normalizePromptLibrary(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return { ...source, projects: Array.isArray(source.projects) ? source.projects.map(item => ({ ...item })) : [],
      categories: Array.isArray(source.categories) ? source.categories.map(item => ({ ...item })) : [],
      entries: Array.isArray(source.entries) ? source.entries.map(item => ({ ...item, categoryId: item.categoryId || "", favorite: Boolean(item.favorite) })) : [] };
  }
  function validatePromptLibrary(value) {
    if (value == null) return;
    if (!value || typeof value !== "object" || Array.isArray(value) || !["projects", "categories", "entries"].every(key => Array.isArray(value[key]))) throw new Error("Промпты: повреждена библиотека.");
    if (value.projects.length > 200 || value.categories.length > 2000 || value.entries.length > 5000) throw new Error("Промпты: превышен размер библиотеки.");
    const text = (item, max) => typeof item === "string" && item.length <= max && item.trim().length > 0;
    const ids = new Set(), names = new Set(), projects = new Set(), categories = new Map();
    function identity(item) {
      if (!item || typeof item.id !== "string" || !SAFE_ID.test(item.id) || ids.has(item.id)) throw new Error("Промпты: некорректный ID.");
      ids.add(item.id);
    }
    function name(item, scope) {
      if (!text(item.name, 120)) throw new Error("Промпты: некорректное название.");
      const key = `${scope}:${item.name.trim().toLocaleLowerCase()}`;
      if (names.has(key)) throw new Error("Название уже существует.");
      names.add(key);
    }
    value.projects.forEach(item => { identity(item); name(item, "projects"); projects.add(item.id); });
    value.categories.forEach(item => {
      identity(item); if (!projects.has(item.projectId)) throw new Error("Категория: проект недоступен.");
      if (["all", "favorites", "uncategorized"].includes(item.id)) throw new Error("Промпты: зарезервированный ID категории.");
      name(item, `project:${item.projectId}`); categories.set(item.id, item.projectId);
    });
    value.entries.forEach(item => {
      identity(item);
      if (typeof item.projectId !== "string" || (item.projectId !== "" && !projects.has(item.projectId))) throw new Error("Промпт: проект недоступен.");
      if (!text(item.name, 300) || !text(item.text, 100000)) throw new Error("Название промпта: до 300 символов; текст: от 1 до 100000 символов.");
      if (typeof item.categoryId !== "string" || (item.categoryId && (!item.projectId || categories.get(item.categoryId) !== item.projectId))) throw new Error("Категория не принадлежит проекту.");
      if (typeof item.favorite !== "boolean") throw new Error("Промпты: некорректное избранное.");
      for (const key of ["createdAt", "updatedAt"]) if (item[key] != null && (!Number.isSafeInteger(item[key]) || item[key] < 0)) throw new Error("Промпты: некорректная дата.");
    });
  }
  function filterPromptEntries(library, projectId, filter = "all", query = "") {
    const needle = String(query).trim().toLocaleLowerCase();
    return library.entries.filter(item => item.projectId === projectId && (filter === "all" || (filter === "favorites" ? item.favorite : filter === "uncategorized" ? !item.categoryId : item.categoryId === filter)) &&
      (!needle || `${item.name}\n${item.text}`.toLocaleLowerCase().includes(needle)));
  }
  function createPromptLibraryController(options) {
    let chain = Promise.resolve();
    const library = () => normalizePromptLibrary(options.getWorkspace()?.promptLibrary);
    function mutate(operation) {
      const workspace = options.getWorkspace();
      const execute = async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте приложение заново.");
        const previous = workspace.promptLibrary, candidate = clone(normalizePromptLibrary(previous));
        const result = operation(candidate); validatePromptLibrary(candidate);
        // Keep the candidate out of live state: pending exports must see accepted data.
        const saved = write ? await options.saveSnapshot(write, candidate) : await options.saveState(candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение промптов.");
        workspace.promptLibrary = candidate;
        return result;
      };
      const transaction = () => options.persistTransaction ? options.persistTransaction(execute) : execute();
      const run = chain.catch(() => {}).then(() => options.queueMutation ? options.queueMutation(transaction) : transaction());
      chain = run.catch(() => {}); return run;
    }
    const find = (items, id, label) => { const item = items.find(item => item.id === id); if (!item) throw new Error(`${label} уже удалён или недоступен.`); return item; };
    const title = value => String(value || "").trim();
    return Object.freeze({ library,
      addProject: name => mutate(candidate => { const item = { id: options.createId("promptproject"), name: title(name) }; candidate.projects.push(item); return item; }),
      renameProject: (id, name) => mutate(candidate => { find(candidate.projects, id, "Проект").name = title(name); }),
      removeProject: (id, mode = "transfer") => mutate(candidate => {
        if (!["transfer", "delete"].includes(mode)) throw new Error("Выберите один вариант: перенести промпты или удалить их.");
        find(candidate.projects, id, "Проект");
        if (mode === "delete") candidate.entries = candidate.entries.filter(item => item.projectId !== id);
        else candidate.entries.forEach(item => { if (item.projectId === id) { item.projectId = ""; item.categoryId = ""; } });
        candidate.projects = candidate.projects.filter(item => item.id !== id); candidate.categories = candidate.categories.filter(item => item.projectId !== id);
      }),
      addCategory: (projectId, name) => mutate(candidate => { find(candidate.projects, projectId, "Проект"); const item = { id: options.createId("promptcat"), projectId, name: title(name) }; candidate.categories.push(item); return item; }),
      renameCategory: (id, name) => mutate(candidate => { find(candidate.categories, id, "Раздел").name = title(name); }),
      removeCategory: id => mutate(candidate => { find(candidate.categories, id, "Раздел"); candidate.categories = candidate.categories.filter(item => item.id !== id); candidate.entries.forEach(item => { if (item.categoryId === id) item.categoryId = ""; }); }),
      saveEntry: (draft, editingId = "") => mutate(candidate => {
        const previous = editingId ? find(candidate.entries, editingId, "Промпт") : null, now = Date.now();
        const item = { ...(previous || {}), id: previous?.id || options.createId("prompt"), name: title(draft.name), text: String(draft.text || ""),
          projectId: draft.projectId, categoryId: draft.categoryId || "", favorite: previous?.favorite || false, createdAt: previous?.createdAt ?? now, updatedAt: now };
        if (previous) candidate.entries[candidate.entries.indexOf(previous)] = item; else candidate.entries.push(item);
        return item;
      }),
      removeEntry: id => mutate(candidate => { find(candidate.entries, id, "Промпт"); candidate.entries = candidate.entries.filter(item => item.id !== id); }),
      toggleFavorite: id => mutate(candidate => { const item = find(candidate.entries, id, "Промпт"); item.favorite = !item.favorite; item.updatedAt = Date.now(); })
    });
  }
  window.ZETER_PROMPT_LIBRARY_UTILS = Object.freeze({ normalizePromptLibrary, validatePromptLibrary, filterPromptEntries, createPromptLibraryController });
})();
