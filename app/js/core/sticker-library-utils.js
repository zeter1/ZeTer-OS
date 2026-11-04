(() => {
  "use strict";
  const clone = value => JSON.parse(JSON.stringify(value));
  const array = value => Array.isArray(value) ? value : [];
  const PROJECT_ICONS = Object.freeze([{ id: "folder", label: "Папка", glyph: "📁" }, { id: "star", label: "Звезда", glyph: "⭐" }, { id: "idea", label: "Идея", glyph: "💡" }, { id: "work", label: "Работа", glyph: "💼" }, { id: "home", label: "Дом", glyph: "🏠" }, { id: "code", label: "Код", glyph: "💻" }, { id: "heart", label: "Личное", glyph: "💜" }, { id: "book", label: "Книга", glyph: "📚" }, { id: "rocket", label: "Развитие", glyph: "🚀" }, { id: "calendar", label: "Планы", glyph: "📅" }, { id: "coffee", label: "Отдых", glyph: "☕" }, { id: "flag", label: "Цель", glyph: "🏁" }].map(Object.freeze));
  const PROJECT_COLORS = Object.freeze(Object.keys(window.ZETER_STICKY_UTILS.STICKY_COLORS));
  const DEFAULT_PREFERENCES = Object.freeze({ density: "comfortable", defaultColor: "purple", sort: "updated", showPath: true, showHint: true });
  function isProjectIconDataURL(value) {
    if (typeof value !== "string" || value.length > 200000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
    const encoded = value.slice(22);
    if (encoded.length % 4) return false;
    try {
      const header = atob(encoded.slice(0, 44));
      if (header.slice(0, 8) !== "\x89PNG\r\n\x1a\n" || header.slice(12, 16) !== "IHDR") return false;
      const size = offset => [0, 1, 2, 3].reduce((result, index) => result * 256 + header.charCodeAt(offset + index), 0);
      return size(16) > 0 && size(16) <= 256 && size(20) > 0 && size(20) <= 256;
    } catch (_) { return false; }
  }
  function projectAppearance(value = {}) {
    return { iconId: PROJECT_ICONS.some(item => item.id === value?.iconId) ? value.iconId : "folder", color: PROJECT_COLORS.includes(value?.color) ? value.color : "purple", description: typeof value?.description === "string" ? value.description.slice(0, 500) : "", iconDataURL: isProjectIconDataURL(value?.iconDataURL) ? value.iconDataURL : "" };
  }
  function validateProjectAppearance(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные настройки проекта.");
    if (value.description != null && (typeof value.description !== "string" || value.description.length > 500)) throw new Error("Описание проекта должно быть текстом до 500 символов.");
    if (value.iconId != null && !PROJECT_ICONS.some(item => item.id === value.iconId)) throw new Error("Выберите значок проекта из списка.");
    if (value.color != null && !PROJECT_COLORS.includes(value.color)) throw new Error("Выберите цвет проекта из списка.");
    if (value.iconDataURL != null && value.iconDataURL !== "" && !isProjectIconDataURL(value.iconDataURL)) throw new Error("Иконка проекта должна быть PNG до 256×256 и 200 000 символов.");
  }
  function normalizeStickerPreferences(value = {}) {
    const result = { ...DEFAULT_PREFERENCES };
    if (value?.density === "compact") result.density = "compact";
    if (PROJECT_COLORS.includes(value?.defaultColor)) result.defaultColor = value.defaultColor;
    if (value?.sort === "name") result.sort = "name";
    for (const key of ["showPath", "showHint"]) if (typeof value?.[key] === "boolean") result[key] = value[key];
    return result;
  }
  function validateStickerPreferences(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные настройки стикеров.");
    if (value.density != null && !["comfortable", "compact"].includes(value.density) || value.sort != null && !["updated", "name"].includes(value.sort) || value.defaultColor != null && !PROJECT_COLORS.includes(value.defaultColor)) throw new Error("Выберите настройки стикеров из списка.");
    for (const key of ["showPath", "showHint"]) if (value[key] != null && typeof value[key] !== "boolean") throw new Error("Некорректный переключатель настроек стикеров.");
  }
  function normalizeStickerLibrary(value = {}) {
    return { projects: array(value?.projects).map(item => ({ ...item })), categories: array(value?.categories).map(item => ({ ...item })), preferences: normalizeStickerPreferences(value?.preferences) };
  }
  function belongsToDesktop(state, note, desktopId) {
    const seen = new Set();
    for (let item = note; item && !seen.has(item.id); item = state.fs?.[item.parent]) {
      if (item.deletedAt) return false;
      if (item.parent === desktopId) return true;
      seen.add(item.id);
    }
    return false;
  }
  function stickerEntries(state) {
    return array(state?.desktops).flatMap(desktop => array(desktop.data?.noteStickies).flatMap(sticky => {
      const note = state.fs?.[sticky?.noteId];
      return note?.type === "note" && belongsToDesktop(state, note, desktop.id) ? [{ desktopId: desktop.id, desktopName: desktop.name, sticky, note }] : [];
    }));
  }
  function validateStickerLibrary(value) {
    const library = normalizeStickerLibrary(value), ids = new Set(), names = new Set();
    if (library.projects.length > 200 || library.categories.length > 1000) throw new Error("Слишком много проектов или категорий стикеров.");
    for (const [kind, rows] of [["project", library.projects], ["category", library.categories]]) {
      for (const item of rows) {
        if (typeof item.id !== "string" || !item.id || item.id.length > 160 || ids.has(item.id)) throw new Error("Некорректный ID проекта или категории.");
        ids.add(item.id);
        if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 120) throw new Error("Введите название до 120 символов.");
        if (kind === "category" && !library.projects.some(project => project.id === item.projectId)) throw new Error("Проект категории недоступен.");
        if (kind === "project") validateProjectAppearance(item);
        const key = `${kind}:${item.projectId || ""}:${item.name.trim().toLocaleLowerCase("ru")}`;
        if (names.has(key)) throw new Error("Такое название уже есть.");
        names.add(key);
      }
    }
    return library;
  }
  function createStickerLibraryController(options) {
    const getState = options.getState;
    const findDesktop = (state, id) => {
      const desktop = array(state.desktops).find(item => item.id === id);
      if (!desktop?.data) throw new Error("Рабочий стол недоступен.");
      return desktop;
    };
    const findEntry = (state, desktopId, noteId) => {
      const entry = stickerEntries(state).find(item => item.desktopId === desktopId && item.note.id === noteId);
      if (!entry) throw new Error("Стикер уже удалён или недоступен.");
      return entry;
    };
    function mutate(desktopId, operation) {
      return options.queueMutation(() => options.persistTransaction(async write => {
        options.beforeSnapshot?.();
        const state = getState(), desktop = findDesktop(state, desktopId);
        const registryBefore = JSON.stringify([desktop.data.noteStickies, desktop.data.stickyLibrary]);
        const candidate = clone(state), target = findDesktop(candidate, desktopId);
        target.data.stickyLibrary = normalizeStickerLibrary(target.data.stickyLibrary);
        target.data.noteStickies = array(target.data.noteStickies);
        const changedNotes = new Set();
        const result = operation(candidate, target, changedNotes);
        const notesBefore = new Map([...changedNotes].map(id => [id, JSON.stringify(state.fs[id])]));
        validateStickerLibrary(target.data.stickyLibrary);
        if (target.data.noteStickies.length > 1000) throw new Error("На одном столе можно хранить до 1000 стикеров.");
        const saved = await write(candidate, { requirePrimary: true });
        if (saved?.saved !== true) throw new Error("Хранилище не подтвердило сохранение стикеров.");
        options.beforePublish?.();
        const currentDesktop = findDesktop(getState(), desktopId);
        const conflict = getState() !== state || currentDesktop !== desktop
          || JSON.stringify([desktop.data.noteStickies, desktop.data.stickyLibrary]) !== registryBefore
          || [...notesBefore].some(([id, before]) => JSON.stringify(state.fs[id]) !== before);
        if (conflict) {
          // Direct note editors and sticky drag/settings can change live fields while
          // primary ACK is pending. Never publish the stale candidate over that input.
          // Repair durable state inside the same barrier before rejecting this draft.
          const repaired = await write(clone(getState()), { requirePrimary: true });
          if (repaired?.saved !== true) throw new Error("Не удалось подтвердить новые правки другого окна. Скопируйте текст и повторите сохранение.");
          throw new Error("Стикер изменён в другом окне во время сохранения. Новые правки сохранены; ваш черновик оставлен в форме.");
        }
        // Publish only this feature's fields; unrelated changes during ACK remain live.
        desktop.data.noteStickies = target.data.noteStickies;
        desktop.data.stickyLibrary = target.data.stickyLibrary;
        changedNotes.forEach(id => { state.fs[id] = candidate.fs[id]; });
        options.onChange?.(desktopId, [...changedNotes]);
        return result;
      }));
    }
    const requireName = name => String(name || "").trim();
    function group(desktopId, kind, action, id, name, projectId = "", appearance = null, expected = null) {
      return mutate(desktopId, (state, desktop) => {
        const library = desktop.data.stickyLibrary, rows = library[kind];
        if (kind === "projects" && appearance) validateProjectAppearance(appearance);
        if (action === "add") {
          const item = { id: options.createId(kind === "projects" ? "stickerproject" : "stickercategory"), name: requireName(name), ...(kind === "categories" ? { projectId } : appearance ? projectAppearance(appearance) : {}) };
          rows.push(item); return item;
        }
        const item = rows.find(item => item.id === id);
        if (!item) throw new Error("Проект или категория уже удалены.");
        if (expected !== null && JSON.stringify(item) !== expected) throw new Error("Проект или категория изменены в другом окне. Скопируйте свои правки и откройте настройки заново.");
        if (action === "rename") { item.name = requireName(name); if (kind === "projects" && appearance) Object.assign(item, projectAppearance(appearance)); return item; }
        library[kind] = rows.filter(item => item.id !== id);
        if (kind === "projects") library.categories = library.categories.filter(item => item.projectId !== id);
        desktop.data.noteStickies.forEach(sticky => {
          if (kind === "projects" && sticky.projectId === id) { sticky.projectId = ""; sticky.categoryId = ""; }
          if (kind === "categories" && sticky.categoryId === id) sticky.categoryId = "";
        });
      });
    }
    return Object.freeze({
      entries: () => stickerEntries(getState()),
      desktops: () => array(getState().desktops),
      library: id => normalizeStickerLibrary(findDesktop(getState(), id).data.stickyLibrary),
      group,
      setPreferences: (desktopId, preferences, expected = null) => {
        validateStickerPreferences(preferences);
        return mutate(desktopId, (state, desktop) => {
          if (expected !== null && JSON.stringify(desktop.data.stickyLibrary.preferences) !== expected) throw new Error("Настройки стикеров изменены в другом окне. Скопируйте свои правки и откройте настройки заново.");
          desktop.data.stickyLibrary.preferences = normalizeStickerPreferences(preferences);
        });
      },
      saveEntry: (desktopId, draft, noteId = "", expected = null) => mutate(desktopId, (state, desktop, changed) => {
        if (draft.preserveMetadata && noteId) {
          const current = findEntry(state, desktopId, noteId).sticky;
          draft = { ...draft, projectId: current.projectId, categoryId: current.categoryId, color: current.color, favorite: current.favorite };
        }
        const library = desktop.data.stickyLibrary;
        if (draft.projectId && !library.projects.some(item => item.id === draft.projectId)) throw new Error("Проект уже удалён. Выберите другой.");
        if (draft.categoryId && !library.categories.some(item => item.id === draft.categoryId && item.projectId === draft.projectId)) throw new Error("Выберите категорию выбранного проекта.");
        let note, sticky;
        if (noteId) {
          ({ note, sticky } = findEntry(state, desktopId, noteId));
          if (expected && (note.name !== expected.title || options.noteHtml(note) !== expected.richHtml)) throw new Error("Заметка изменена в другом окне. Скопируйте свой текст и откройте стикер заново.");
          // The form can overwrite these fields; placement/size remain independent.
          const metadata = value => [value.projectId || "", value.categoryId || "", value.color || "purple", Boolean(value.favorite)];
          if (expected?.sticky && JSON.stringify(metadata(sticky)) !== JSON.stringify(metadata(expected.sticky))) throw new Error("Стикер изменён в другом окне. Скопируйте свои правки и откройте стикер заново.");
        } else {
          note = { id: options.createId("note"), type: "note", parent: desktopId, name: "Стикер", content: "", createdAt: Date.now() };
          state.fs[note.id] = note;
          sticky = { noteId: note.id, desktop: false, x: 120, y: 90, w: 270, h: 270, z: 3601 };
          desktop.data.noteStickies.push(sticky);
        }
        if (draft.appearance) {
          const appearance = draft.appearance;
          if (Object.keys(appearance).sort().join(',') !== 'color,fontSize,opacity,textColor'
            || !PROJECT_COLORS.includes(appearance.color) || !['light', 'dark'].includes(appearance.textColor)
            || !Number.isInteger(appearance.fontSize) || appearance.fontSize < 12 || appearance.fontSize > 22
            || !Number.isFinite(appearance.opacity) || appearance.opacity < .7 || appearance.opacity > 1) throw new Error("Некорректные настройки стикера.");
          const current = window.ZETER_STICKY_UTILS.normalizeStickySettings({ ...sticky });
          if (expected?.appearance && ['color', 'textColor', 'fontSize', 'opacity'].some(key => current[key] !== expected.appearance[key])) throw new Error("Оформление стикера изменено в другом окне. Скопируйте свои правки и откройте стикер заново.");
        }
        const name = requireName(draft.title);
        if (!name || name.length > 240) throw new Error("Введите название до 240 символов.");
        note.name = name;
        if (draft.richHtml != null) {
          note.richContent = options.cleanHtml(draft.richHtml);
          note.content = options.plainText(note.richContent);
        }
        note.updatedAt = Date.now(); changed.add(note.id);
        sticky.projectId = draft.projectId || ""; sticky.categoryId = draft.categoryId || "";
        if (PROJECT_COLORS.includes(draft.color)) sticky.color = draft.color;
        sticky.favorite = Boolean(draft.favorite);
        if (draft.appearance) Object.assign(sticky, draft.appearance);
        return { noteId: note.id, desktopId };
      }),
      removeEntry: (desktopId, noteId) => mutate(desktopId, (state, desktop) => {
        findEntry(state, desktopId, noteId);
        desktop.data.noteStickies = desktop.data.noteStickies.filter(item => item.noteId !== noteId);
        // The note and all of its attachments deliberately remain untouched.
      }),
      setDesktop: (desktopId, noteId, shown, position) => mutate(desktopId, state => {
        const { sticky } = findEntry(state, desktopId, noteId);
        sticky.desktop = Boolean(shown);
        if (position) { sticky.x = Math.max(0, position.x); sticky.y = Math.max(56, position.y); }
      }),
      toggleFavorite: (desktopId, noteId) => mutate(desktopId, state => {
        const { sticky } = findEntry(state, desktopId, noteId); sticky.favorite = !sticky.favorite;
      })
    });
  }
  window.ZETER_STICKER_LIBRARY_UTILS = Object.freeze({ PROJECT_ICONS, PROJECT_COLORS, isProjectIconDataURL, projectAppearance, validateProjectAppearance, normalizeStickerPreferences, validateStickerPreferences, normalizeStickerLibrary, validateStickerLibrary, belongsToDesktop, stickerEntries, createStickerLibraryController });
})();
