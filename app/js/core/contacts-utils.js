(() => {
  "use strict";
  const SAFE_ID = /^[A-Za-z0-9_-]{1,220}$/;
  const RESERVED = new Set(["all", "favorites", "uncategorized", "__proto__", "constructor", "prototype"]);
  const FIELD_TYPES = new Set(["phone", "email", "social", "url", "text", "multiline"]);
  const TEXT_LIMITS = Object.freeze({ name: 300, company: 300, role: 300, phone: 160, secondaryPhone: 160, email: 320, telegram: 320, website: 2048, city: 300, notes: 20000 });
  const fold = value => String(value || "").normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е");
  const clone = value => JSON.parse(JSON.stringify(value));
  function normalizeContacts(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return { ...source,
      projects: Array.isArray(source.projects) ? source.projects.map(item => ({ ...item })) : [],
      categories: Array.isArray(source.categories) ? source.categories.map(item => ({ ...item })) : [],
      entries: Array.isArray(source.entries) ? source.entries.map(item => {
        const entry = { ...item, projectId: item.projectId ?? "", categoryId: item.categoryId ?? "", favorite: item.favorite ?? false, tags: Array.isArray(item.tags) ? [...item.tags] : item.tags ?? [], fields: Array.isArray(item.fields) ? item.fields.map(field => ({ ...field })) : item.fields ?? [] };
        Object.keys(TEXT_LIMITS).forEach(key => { entry[key] = item[key] ?? ""; });
        return entry;
      }) : []
    };
  }
  function validateContacts(value) {
    if (value == null) return;
    if (!value || typeof value !== "object" || Array.isArray(value) || !["projects", "categories", "entries"].every(key => Array.isArray(value[key]))) throw new Error("Контакты: повреждён справочник.");
    if (value.projects.length > 200 || value.categories.length > 2000 || value.entries.length > 10000) throw new Error("Контакты: превышен размер справочника (200 проектов, 2000 категорий, 10000 контактов).");
    const ids = new Set(), names = new Set(), projects = new Set(), categories = new Map();
    function identity(item) {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string" || !SAFE_ID.test(item.id) || RESERVED.has(item.id) || ids.has(item.id)) throw new Error("Контакты: некорректный или повторяющийся ID.");
      ids.add(item.id);
    }
    function title(item, scope) {
      if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 120) throw new Error("Название проекта или категории: от 1 до 120 символов.");
      const key = `${scope}:${fold(item.name.trim())}`;
      if (names.has(key)) throw new Error("Такое название уже существует.");
      names.add(key);
    }
    value.projects.forEach(item => { identity(item); title(item, "projects"); projects.add(item.id); });
    value.categories.forEach(item => {
      identity(item);
      if (typeof item.projectId !== "string" || !projects.has(item.projectId)) throw new Error("Категория: проект недоступен.");
      title(item, `project:${item.projectId}`); categories.set(item.id, item.projectId);
    });
    value.entries.forEach(item => {
      identity(item);
      if (typeof item.projectId !== "string" || (item.projectId && !projects.has(item.projectId))) throw new Error("Контакт: проект недоступен.");
      if (typeof item.categoryId !== "string" || (item.categoryId && (!item.projectId || categories.get(item.categoryId) !== item.projectId))) throw new Error("Категория не принадлежит проекту контакта.");
      if (typeof item.name !== "string" || !item.name.trim()) throw new Error("Укажите имя контакта.");
      for (const [key, limit] of Object.entries(TEXT_LIMITS)) if (item[key] != null && (typeof item[key] !== "string" || item[key].length > limit)) throw new Error(`Контакты: поле «${key}» должно быть текстом до ${limit} символов.`);
      if (typeof item.favorite !== "boolean") throw new Error("Контакты: некорректное избранное.");
      if (item.tags != null && (!Array.isArray(item.tags) || item.tags.length > 50 || item.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 100))) throw new Error("Теги: до 50 непустых названий по 100 символов.");
      if (item.fields != null) {
        if (!Array.isArray(item.fields) || item.fields.length > 100) throw new Error("У контакта может быть до 100 дополнительных полей.");
        item.fields.forEach(field => {
          identity(field);
          if (!FIELD_TYPES.has(field.type) || typeof field.label !== "string" || field.label.length > 120 || typeof field.value !== "string" || field.value.length > 20000) throw new Error("Контакты: некорректное дополнительное поле (название до 120, значение до 20000 символов).");
        });
      }
      for (const key of ["createdAt", "updatedAt"]) if (item[key] != null && (!Number.isSafeInteger(item[key]) || item[key] < 0)) throw new Error("Контакты: некорректная дата.");
    });
  }
  function filterContacts(library, projectId = null, filter = "all", query = "", sort = "name") {
    const tokens = fold(query).trim().split(/\s+/).filter(Boolean);
    const entries = (library?.entries || []).filter(item => {
      if (projectId !== null && item.projectId !== projectId) return false;
      if (!(filter === "all" || (filter === "favorites" ? item.favorite : filter === "uncategorized" ? !item.categoryId : item.categoryId === filter))) return false;
      if (!tokens.length) return true;
      const haystack = fold([item.name, item.company, item.role, item.phone, item.secondaryPhone, item.email, item.telegram, item.website, item.city, ...(item.tags || []), item.notes, ...(item.fields || []).flatMap(field => [field.label, field.value])].join("\n"));
      const phones = [item.phone, item.secondaryPhone, ...(item.fields || []).filter(field => field.type === "phone").map(field => field.value)].map(phone => String(phone || "").replace(/\D/g, ""));
      return tokens.every(token => haystack.includes(token) || (/^[+\d().\-\u2010-\u2015\u2212]+$/.test(token) && /\d/.test(token) && phones.some(phone => phone.includes(token.replace(/\D/g, "")))));
    });
    return entries.sort((a, b) => (sort === "recent" ? (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0) : 0) || fold(a.name).localeCompare(fold(b.name), "ru", { numeric: true }) || a.id.localeCompare(b.id));
  }
  function createContactsController(options) {
    let chain = Promise.resolve();
    const library = () => normalizeContacts(options.getWorkspace()?.contacts);
    function mutate(operation) {
      const workspace = options.getWorkspace();
      const execute = async write => {
        if (!workspace || options.getWorkspace() !== workspace) throw new Error("Рабочий стол недоступен. Откройте контакты заново.");
        const candidate = clone(normalizeContacts(workspace.contacts));
        const result = operation(candidate);
        validateContacts(candidate);
        const saved = write ? await options.saveSnapshot(write, candidate) : await options.saveState(candidate);
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение контактов. Повторите попытку.");
        // The accepted snapshot belongs to this workspace, even if the user switched desktops during I/O.
        workspace.contacts = candidate;
        return result;
      };
      const transaction = () => options.persistTransaction ? options.persistTransaction(execute) : execute();
      const run = chain.catch(() => {}).then(() => options.queueMutation ? options.queueMutation(transaction) : transaction());
      chain = run.catch(() => {});
      return run;
    }
    const find = (items, id, label) => { const item = items.find(entry => entry.id === id); if (!item) throw new Error(`${label} уже удалён или недоступен.`); return item; };
    const title = value => String(value || "").trim();
    return Object.freeze({ library,
      addProject: name => mutate(candidate => { const item = { id: options.createId("contactproject"), name: title(name) }; candidate.projects.push(item); return item; }),
      renameProject: (id, name) => mutate(candidate => { find(candidate.projects, id, "Проект").name = title(name); }),
      removeProject: id => mutate(candidate => {
        find(candidate.projects, id, "Проект");
        candidate.entries.forEach(item => { if (item.projectId === id) { item.projectId = ""; item.categoryId = ""; } });
        candidate.categories = candidate.categories.filter(item => item.projectId !== id);
        candidate.projects = candidate.projects.filter(item => item.id !== id);
      }),
      addCategory: (projectId, name) => mutate(candidate => { find(candidate.projects, projectId, "Проект"); const item = { id: options.createId("contactcategory"), projectId, name: title(name) }; candidate.categories.push(item); return item; }),
      renameCategory: (id, name) => mutate(candidate => { find(candidate.categories, id, "Категория").name = title(name); }),
      removeCategory: id => mutate(candidate => {
        find(candidate.categories, id, "Категория");
        candidate.categories = candidate.categories.filter(item => item.id !== id);
        candidate.entries.forEach(item => { if (item.categoryId === id) item.categoryId = ""; });
      }),
      saveEntry: (draft, editingId = "", originalEntry = null) => {
        const captured = clone(draft), original = originalEntry ? clone(originalEntry) : null;
        return mutate(candidate => {
          const previous = editingId ? find(candidate.entries, editingId, "Контакт") : null, now = Date.now();
          if (previous && original && JSON.stringify(previous) !== JSON.stringify(original)) throw new Error("Контакт изменён в другом окне. Введённый текст остался в форме. Закройте редактор и откройте карточку заново, чтобы увидеть актуальные данные.");
          const item = { ...(previous || {}), id: previous?.id || options.createId("contact"), projectId: captured.projectId ?? "", categoryId: captured.categoryId ?? "", favorite: captured.favorite ?? previous?.favorite ?? false,
            tags: Array.isArray(captured.tags) ? [...captured.tags] : [], createdAt: previous?.createdAt ?? now, updatedAt: now };
          item.fields = (captured.fields ?? previous?.fields ?? []).map(field => ({ ...field, id: field.id || options.createId("contactfield") }));
          Object.keys(TEXT_LIMITS).forEach(key => { item[key] = key === "notes" ? String(captured[key] || "") : title(captured[key]); });
          if (previous) candidate.entries[candidate.entries.indexOf(previous)] = item; else candidate.entries.push(item);
          return item;
        });
      },
      removeEntry: id => mutate(candidate => { find(candidate.entries, id, "Контакт"); candidate.entries = candidate.entries.filter(item => item.id !== id); }),
      toggleFavorite: id => mutate(candidate => { const item = find(candidate.entries, id, "Контакт"); item.favorite = !item.favorite; item.updatedAt = Date.now(); })
    });
  }
  window.ZETER_CONTACTS_UTILS = Object.freeze({ normalizeContacts, validateContacts, filterContacts, createContactsController });
})();
