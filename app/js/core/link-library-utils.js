(() => {
  "use strict";
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!shortcutUtils) throw new Error("ZeTer OS link library requires shortcut utils.");
  const { normalizeShortcutTarget } = shortcutUtils;
  const MAX_ENTRIES = 5000;
  const MAX_CATEGORIES = 200;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,220}$/;
  const clone = value => JSON.parse(JSON.stringify(value));

  function linkTargetKey(value) {
    const shortcut = normalizeShortcutTarget(value);
    if (!shortcut) return "";
    return shortcut.kind === "windows"
      ? `windows:${shortcut.target.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase()}`
      : `${shortcut.kind}:${shortcut.target}`;
  }

  function normalizeLinkLibrary(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const categories = Array.isArray(source.categories) ? source.categories.map(category => ({ ...category })) : [];
    const categoryIds = new Set(categories.map(category => category.id));
    const entries = Array.isArray(source.entries) ? source.entries.map(entry => {
      const shortcut = normalizeShortcutTarget(entry.target);
      return { ...entry, ...(shortcut || {}), description: entry.description || "", favorite: Boolean(entry.favorite),
        pinnedIn: Array.isArray(entry.pinnedIn) ? [...entry.pinnedIn] : entry.pinned === true ? ["all"] : [],
        categoryId: categoryIds.has(entry.categoryId) ? entry.categoryId : "" };
    }) : [];
    return { ...source, categories, entries };
  }

  function validateLinkLibrary(value) {
    if (value == null) return;
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.entries) || !Array.isArray(value.categories)) {
      throw new Error("Ссылки: повреждена библиотека.");
    }
    if (value.entries.length > MAX_ENTRIES || value.categories.length > MAX_CATEGORIES) throw new Error("Ссылки: превышен размер библиотеки.");
    const text = (value, max, required = false) => typeof value === "string" && value.length <= max && (!required || value.trim().length > 0);
    const categoryIds = new Set();
    const categoryNames = new Set();
    value.categories.forEach(category => {
      if (!category || typeof category.id !== "string" || !SAFE_ID.test(category.id) || ["all", "favorites", "uncategorized"].includes(category.id) || categoryIds.has(category.id) || !text(category.name, 120, true)) throw new Error("Ссылки: некорректная категория.");
      if (category.pinned !== undefined && typeof category.pinned !== "boolean") throw new Error("Ссылки: некорректное закрепление категории.");
      const key = category.name.trim().toLocaleLowerCase();
      if (categoryNames.has(key)) throw new Error("Ссылки: повтор названия категории.");
      categoryIds.add(category.id);
      categoryNames.add(key);
    });
    const ids = new Set(), targets = new Set();
    value.entries.forEach(entry => {
      const shortcut = normalizeShortcutTarget(entry?.target);
      const targetKey = linkTargetKey(entry?.target);
      if (!entry || typeof entry.id !== "string" || !SAFE_ID.test(entry.id) || ids.has(entry.id) || !text(entry.name, 300, true) || !text(entry.target, 32768, true) || !shortcut ||
          (entry.kind != null && entry.kind !== shortcut.kind) || (entry.description != null && !text(entry.description, 4000)) ||
          (entry.favorite != null && typeof entry.favorite !== "boolean") || (entry.categoryId != null && entry.categoryId !== "" && !categoryIds.has(entry.categoryId))) {
        throw new Error("Ссылки: некорректная запись или адрес.");
      }
      if (entry.pinned !== undefined && typeof entry.pinned !== "boolean") throw new Error("Ссылки: некорректное закрепление ссылки.");
      if (entry.pinnedIn !== undefined && (!Array.isArray(entry.pinnedIn) || entry.pinnedIn.length > 3 || new Set(entry.pinnedIn).size !== entry.pinnedIn.length || entry.pinnedIn.some(view =>
        typeof view !== "string" || !(view === "all" || (view === "favorites" && entry.favorite === true) || (view === "uncategorized" && !entry.categoryId) || (categoryIds.has(view) && view === entry.categoryId))))) {
        throw new Error("Ссылки: некорректные разделы закрепления.");
      }
      if (targets.has(targetKey)) throw new Error("Ссылки: повтор адреса.");
      for (const field of ["createdAt", "updatedAt"]) if (entry[field] != null && (!Number.isSafeInteger(entry[field]) || entry[field] < 0)) throw new Error("Ссылки: некорректная дата.");
      ids.add(entry.id); targets.add(targetKey);
    });
  }

  function filterLinkEntries(library, filter = "all", query = "") {
    const needle = String(query).trim().toLocaleLowerCase();
    const entries = library.entries.filter(entry => (filter === "all" || (filter === "favorites" ? entry.favorite : filter === "uncategorized" ? !entry.categoryId : entry.categoryId === filter)) &&
      (!needle || `${entry.name}\n${entry.target}\n${entry.description || ""}`.toLocaleLowerCase().includes(needle)));
    return [...entries.filter(entry => isLinkPinned(entry, filter)), ...entries.filter(entry => !isLinkPinned(entry, filter))];
  }

  function isLinkPinned(entry, filter = "all") {
    return Array.isArray(entry.pinnedIn) ? entry.pinnedIn.includes(filter) : entry.pinned === true && filter === "all";
  }

  function orderedLinkCategories(library) {
    return [...library.categories.filter(category => category.pinned === true), ...library.categories.filter(category => category.pinned !== true)];
  }

  function createLinkLibraryController(options) {
    const { saveState, createId } = options;
    const getWorkspace = options.getWorkspace || options.getState;
    let chain = Promise.resolve();
    function library() { return getWorkspace().library || normalizeLinkLibrary(); }
    function mutate(operation) {
      // Capture before either Promise queue: a desktop switch cannot redirect this action.
      const workspace = getWorkspace();
      const execute = async () => {
        const previous = workspace.library;
        const candidate = clone(normalizeLinkLibrary(previous));
        const result = operation(candidate);
        validateLinkLibrary(candidate);
        workspace.library = candidate;
        try {
          const saved = await saveState();
          if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение ссылок.");
        } catch (error) {
          workspace.library = previous;
          throw error;
        }
        options.onChange?.();
        return result;
      };
      const run = chain.catch(() => {}).then(() => typeof options.queueMutation === "function" ? options.queueMutation(execute) : execute());
      chain = run.catch(() => {});
      return run;
    }
    function categoryName(value, candidate, excludeId = "") {
      const name = String(value || "").trim();
      if (!name || name.length > 120) throw new Error("Название категории: от 1 до 120 символов.");
      if (candidate.categories.some(category => category.id !== excludeId && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("Категория с таким названием уже существует.");
      return name;
    }
    return Object.freeze({
      library,
      saveEntry: (draft, editingId = "") => mutate(candidate => {
        const previous = editingId ? candidate.entries.find(entry => entry.id === editingId) : null;
        if (editingId && !previous) throw new Error("Ссылка уже удалена.");
        const shortcut = normalizeShortcutTarget(draft.target);
        if (!shortcut) throw new Error("Укажите http(s)-адрес, абсолютный Windows-путь или zeter://item/ID.");
        const duplicate = candidate.entries.find(entry => entry.id !== editingId && linkTargetKey(entry.target) === linkTargetKey(shortcut.target));
        if (duplicate) { const error = new Error("Этот адрес уже сохранён."); error.code = "DUPLICATE"; error.existingId = duplicate.id; throw error; }
        const now = Date.now();
        const entry = { ...(previous || {}), id: previous?.id || createId("link"), name: String(draft.name || "").trim(), ...shortcut,
          categoryId: draft.categoryId || "", description: String(draft.description || "").trim(), favorite: previous?.favorite || false,
          createdAt: previous?.createdAt || now, updatedAt: now };
        entry.pinnedIn = (previous?.pinnedIn || []).filter(view => view === "all" || (view === "favorites" && entry.favorite) || (view === "uncategorized" && !entry.categoryId) || view === entry.categoryId);
        if (previous) candidate.entries[candidate.entries.indexOf(previous)] = entry; else candidate.entries.push(entry);
        return entry;
      }),
      removeEntry: id => mutate(candidate => { if (!candidate.entries.some(entry => entry.id === id)) throw new Error("Ссылка уже удалена."); candidate.entries = candidate.entries.filter(entry => entry.id !== id); }),
      toggleFavorite: id => mutate(candidate => { const entry = candidate.entries.find(entry => entry.id === id); if (!entry) throw new Error("Ссылка уже удалена."); entry.favorite = !entry.favorite; if (!entry.favorite) entry.pinnedIn = entry.pinnedIn.filter(view => view !== "favorites"); entry.updatedAt = Date.now(); }),
      togglePinned: (id, filter = "all") => mutate(candidate => {
        const entry = candidate.entries.find(entry => entry.id === id); if (!entry) throw new Error("Ссылка уже удалена.");
        if (!["all", "favorites", "uncategorized"].includes(filter) && !candidate.categories.some(category => category.id === filter)) throw new Error("Раздел уже недоступен.");
        if (!filterLinkEntries(candidate, filter).some(item => item.id === id)) throw new Error("Ссылка больше не входит в этот раздел.");
        entry.pinnedIn = isLinkPinned(entry, filter) ? entry.pinnedIn.filter(view => view !== filter) : [...entry.pinnedIn, filter];
        delete entry.pinned; entry.updatedAt = Date.now();
      }),
      addCategory: name => mutate(candidate => { const category = { id: createId("linkcat"), name: categoryName(name, candidate) }; candidate.categories.push(category); return category; }),
      renameCategory: (id, name) => mutate(candidate => { const category = candidate.categories.find(category => category.id === id); if (!category) throw new Error("Категория уже удалена."); category.name = categoryName(name, candidate, id); }),
      toggleCategoryPinned: id => mutate(candidate => { const category = candidate.categories.find(item => item.id === id); if (!category) throw new Error("Категория уже удалена."); category.pinned = !category.pinned; }),
      removeCategory: id => mutate(candidate => { candidate.categories = candidate.categories.filter(category => category.id !== id); candidate.entries.forEach(entry => { if (entry.categoryId === id) { entry.categoryId = ""; entry.pinnedIn = entry.pinnedIn.filter(view => view !== id); } }); }),
      moveCategory: (id, direction) => mutate(candidate => {
        const category = candidate.categories.find(item => item.id === id); if (!category) throw new Error("Категория уже удалена.");
        const peers = candidate.categories.filter(item => Boolean(item.pinned) === Boolean(category.pinned));
        const position = peers.indexOf(category), neighbour = peers[position + (direction < 0 ? -1 : 1)];
        if (!neighbour) return;
        const index = candidate.categories.indexOf(category), next = candidate.categories.indexOf(neighbour);
        [candidate.categories[index], candidate.categories[next]] = [candidate.categories[next], candidate.categories[index]];
      })
    });
  }
  window.ZETER_LINK_LIBRARY_UTILS = Object.freeze({ MAX_ENTRIES, MAX_CATEGORIES, linkTargetKey, normalizeLinkLibrary, validateLinkLibrary, orderedLinkCategories, isLinkPinned, filterLinkEntries, createLinkLibraryController });
})();
