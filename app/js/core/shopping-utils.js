(() => {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,220}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);
  const text = (value, max) => typeof value === "string" && value.length <= max;
  const fold = value => value.trim().normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
  function normalizePreferences(value) {
    const source = object(value) ? value : {};
    return { ...source, density: source.density ?? "normal", groupByCategory: source.groupByCategory ?? true, showDescriptions: source.showDescriptions ?? true };
  }
  function normalizeShopping(value) {
    const source = object(value) ? clone(value) : {};
    return { ...source, projects: source.projects ?? [], categories: source.categories ?? [], items: source.items ?? [], preferences: normalizePreferences(source.preferences) };
  }
  function validateShopping(value) {
    if (value == null) return;
    if (!object(value) || !Array.isArray(value.projects) || !Array.isArray(value.categories) || !Array.isArray(value.items)) throw new Error("Покупки: некорректный формат данных.");
    if (value.preferences != null) {
      const prefs = normalizePreferences(value.preferences);
      if (!object(value.preferences) || !["normal", "compact"].includes(prefs.density) || typeof prefs.groupByCategory !== "boolean" || typeof prefs.showDescriptions !== "boolean") throw new Error("Покупки: некорректные настройки приложения.");
    }
    if (value.projects.length > 100 || value.categories.length > 500 || value.items.length > 5000) throw new Error("Покупки: доступно до 100 проектов и 500 категорий и 5000 товаров на рабочем столе.");
    const ids = new Set(), names = new Set(), projects = new Set(), categories = new Map(), categoryNames = new Set();
    const identity = row => {
      if (!object(row) || !validId(row.id) || ids.has(row.id)) throw new Error("Покупки: некорректный или повторяющийся ID.");
      ids.add(row.id);
      if (![row.createdAt, row.updatedAt].every(time => Number.isSafeInteger(time) && time >= 0)) throw new Error("Покупки: некорректная дата записи.");
    };
    value.projects.forEach(row => {
      identity(row);
      if (!text(row.name, 100) || !row.name.trim() || names.has(fold(row.name))) throw new Error("Название проекта должно быть уникальным и содержать от 1 до 100 символов.");
      names.add(fold(row.name)); projects.add(row.id);
    });
    value.categories.forEach(row => {
      identity(row);
      if (!projects.has(row.projectId)) throw new Error("Покупки: проект категории недоступен.");
      const key = `${row.projectId}:${typeof row.name === "string" ? fold(row.name) : ""}`;
      if (!text(row.name, 100) || !row.name.trim() || categoryNames.has(key)) throw new Error("Категория должна иметь уникальное в проекте название до 100 символов.");
      categoryNames.add(key); categories.set(row.id, row.projectId);
    });
    value.items.forEach(row => {
      identity(row);
      if (!projects.has(row.projectId)) throw new Error("Покупки: проект товара недоступен.");
      if (row.categoryId !== "" && categories.get(row.categoryId) !== row.projectId) throw new Error("Покупки: категория товара недоступна в этом проекте.");
      if (!text(row.name, 200) || !row.name.trim() || !text(row.quantity, 80) || !text(row.notes, 2000)) throw new Error("Покупки: название до 200, количество до 80 и примечание до 2000 символов.");
      if (typeof row.bought !== "boolean") throw new Error("Покупки: некорректная отметка купленного товара.");
    });
  }
  function createShoppingController(options) {
    let chain = Promise.resolve();
    const data = () => normalizeShopping(options.getWorkspace()?.shopping);
    const find = (rows, id, label) => { const row = rows.find(item => item.id === id); if (!row) throw new Error(`${label} уже удалён или недоступен.`); return row; };
    const unchanged = (row, original) => { if (original && JSON.stringify(row) !== JSON.stringify(original)) throw new Error("Данные изменены в другом окне. Ввод сохранён; откройте запись заново."); };
    function mutate(operation) {
      const workspace = options.getWorkspace();
      const execute = async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте покупки заново.");
        const baseline = JSON.stringify(workspace.shopping), candidate = data();
        const result = operation(candidate);
        validateShopping(candidate);
        const saved = await options.saveSnapshot(write, candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение покупок. Повторите попытку.");
        if (options.getWorkspace() !== workspace || JSON.stringify(workspace.shopping) !== baseline) throw new Error("Данные изменились во время сохранения. Откройте покупки заново и проверьте запись.");
        workspace.shopping = candidate;
        return result;
      };
      const transaction = () => options.persistTransaction(execute);
      const run = chain.catch(() => {}).then(() => options.queueMutation ? options.queueMutation(transaction) : transaction());
      chain = run.catch(() => {});
      return run;
    }
    return Object.freeze({ data,
      setPreferences(draft, original = null) {
        const input = clone(draft), baseline = original ? normalizePreferences(clone(original)) : null;
        return mutate(candidate => {
          if (!object(input)) throw new Error("Покупки: некорректные настройки приложения.");
          if (baseline && ["density", "groupByCategory", "showDescriptions"].some(key => candidate.preferences[key] !== baseline[key])) throw new Error("Настройки изменены в другом окне. Ввод сохранён; откройте настройки заново.");
          candidate.preferences = normalizePreferences({ ...candidate.preferences, ...input });
          return clone(candidate.preferences);
        });
      },
      saveProject(draft, id = "", original = null) {
        const input = clone(draft), baseline = original ? clone(original) : null;
        return mutate(candidate => {
          const previous = id ? find(candidate.projects, id, "Проект") : null;
          unchanged(previous, baseline);
          const row = { ...previous, id: previous?.id || options.createId("shopping_project"), name: String(input.name ?? "").trim(), createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() };
          if (previous) candidate.projects[candidate.projects.indexOf(previous)] = row; else candidate.projects.push(row);
          return clone(row);
        });
      },
      saveCategory(draft, id = "", original = null) {
        const input = clone(draft), baseline = original ? clone(original) : null;
        return mutate(candidate => {
          const previous = id ? find(candidate.categories, id, "Категория") : null;
          unchanged(previous, baseline); find(candidate.projects, input.projectId, "Проект");
          if (previous && previous.projectId !== input.projectId) throw new Error("Категория принадлежит другому проекту.");
          const row = { ...previous, id: previous?.id || options.createId("shopping_category"), projectId: input.projectId, name: String(input.name ?? "").trim(), createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() };
          if (previous) candidate.categories[candidate.categories.indexOf(previous)] = row; else candidate.categories.push(row);
          return clone(row);
        });
      },
      removeCategory(id, original) {
        const baseline = clone(original);
        return mutate(candidate => {
          unchanged(find(candidate.categories, id, "Категория"), baseline);
          candidate.categories = candidate.categories.filter(row => row.id !== id);
          candidate.items.filter(row => row.categoryId === id).forEach(row => { row.categoryId = ""; row.updatedAt = Date.now(); });
        });
      },
      saveItem(draft, id = "", original = null) {
        const input = clone(draft), baseline = original ? clone(original) : null;
        return mutate(candidate => {
          const previous = id ? find(candidate.items, id, "Товар") : null;
          unchanged(previous, baseline); find(candidate.projects, input.projectId, "Проект");
          const row = { ...previous, id: previous?.id || options.createId("shopping_item"), projectId: input.projectId, categoryId: input.categoryId ?? "", name: String(input.name ?? "").trim(), quantity: String(input.quantity ?? "").trim(), notes: String(input.notes ?? "").trim(), bought: previous?.bought ?? false, createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() };
          if (previous) candidate.items[candidate.items.indexOf(previous)] = row; else candidate.items.push(row);
          return clone(row);
        });
      },
      setBought(id, bought) {
        return mutate(candidate => { const row = find(candidate.items, id, "Товар"); row.bought = bought; row.updatedAt = Date.now(); });
      },
      removeItem(id, original) {
        const baseline = clone(original);
        return mutate(candidate => { const row = find(candidate.items, id, "Товар"); unchanged(row, baseline); candidate.items = candidate.items.filter(item => item.id !== id); });
      },
      clearBought(projectId, originals) {
        const baseline = clone(originals);
        return mutate(candidate => {
          find(candidate.projects, projectId, "Проект");
          baseline.forEach(original => { const row = find(candidate.items, original.id, "Товар"); unchanged(row, original); if (row.projectId !== projectId || !row.bought) throw new Error("Проект изменён. Проверьте купленные товары."); });
          const ids = new Set(baseline.map(row => row.id)); candidate.items = candidate.items.filter(row => !ids.has(row.id));
        });
      },
      removeProject(id, original, originals, originalCategories) {
        const baseline = clone(original), rows = clone(originals), categories = clone(originalCategories);
        return mutate(candidate => {
          unchanged(find(candidate.projects, id, "Проект"), baseline);
          if (JSON.stringify(candidate.items.filter(row => row.projectId === id)) !== JSON.stringify(rows)) throw new Error("Проект изменён в другом окне. Проверьте товары перед удалением.");
          if (JSON.stringify(candidate.categories.filter(row => row.projectId === id)) !== JSON.stringify(categories)) throw new Error("Категории проекта изменены. Проверьте их перед удалением.");
          candidate.categories = candidate.categories.filter(row => row.projectId !== id);
          candidate.projects = candidate.projects.filter(row => row.id !== id); candidate.items = candidate.items.filter(row => row.projectId !== id);
        });
      }
    });
  }
  window.ZETER_SHOPPING_UTILS = Object.freeze({ normalizeShopping, validateShopping, createShoppingController });
})();
