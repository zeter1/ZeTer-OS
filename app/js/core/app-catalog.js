(() => {
  "use strict";

  const APP_CATALOG_DEFINITIONS = Object.freeze({
    folder: Object.freeze({ name: "Папка", icon: "📁", w: 880, h: 570, pinned: false, hidden: true, render: "explorer", title: "folder" }),
    editor: Object.freeze({ name: "Текстовый редактор", icon: "📝", w: 760, h: 560, pinned: false, render: "editor" }),
    notes: Object.freeze({ name: "Заметки", icon: "🗒️", w: 540, h: 470, pinned: false, render: "notes" }),
    markdown: Object.freeze({ name: "Markdown Studio", icon: "📘", w: 880, h: 580, pinned: false, render: "markdown" }),
    table: Object.freeze({ name: "Таблица", icon: "▦", w: 1040, h: 640, pinned: false, hidden: true, render: "table", title: "table" }),
    tasks: Object.freeze({ name: "Задачи", icon: "✅", w: 1040, h: 680, pinned: true, render: "tasks", title: "taskWindow" }),
    tasklist: Object.freeze({ name: "Список задач", icon: "☑️", w: 1040, h: 680, pinned: false, hidden: true, render: "tasks", title: "taskWindow" }),
    taskedit: Object.freeze({ name: "Редактирование задачи", icon: "📝", w: 680, h: 520, pinned: false, hidden: true, render: "taskEditor", title: "taskEditor" }),
    calendar: Object.freeze({ name: "Календарь", icon: "📅", w: 1180, h: 680, pinned: true, render: "calendar" }),
    calendaredit: Object.freeze({ name: "Добавление события", icon: "📅", w: 680, h: 580, pinned: false, hidden: true, render: "calendarEventEditor", title: "calendarEventEditor" }),
    shortcutedit: Object.freeze({ name: "Создание ярлыка", icon: "🔗", w: 680, h: 500, pinned: false, hidden: true, render: "shortcutEditor", title: "shortcutEditor" }),
    itemsettings: Object.freeze({ name: "Настройка объекта", icon: "⚙️", w: 720, h: 640, pinned: false, hidden: true, render: "itemSettings", title: "itemSettings" }),
    calculator: Object.freeze({ name: "Калькулятор", icon: "🧮", w: 390, h: 540, pinned: true, render: "calculator" }),
    photos: Object.freeze({ name: "Фото", icon: "🖼️", w: 760, h: 540, pinned: false, render: "photos" }),
    settings: Object.freeze({ name: "Настройки", icon: "⚙️", w: 820, h: 600, pinned: true, render: "settings" }),
    security: Object.freeze({ name: "Центр безопасности данных", icon: "🛡️", w: 980, h: 680, pinned: true, render: "security" }),
    monitor: Object.freeze({ name: "Монитор системы", icon: "📊", w: 980, h: 720, pinned: true, render: "monitor" }),
    appcenter: Object.freeze({ name: "Приложения", icon: "🛍️", w: 760, h: 520, pinned: true, render: "appcenter" }),
    help: Object.freeze({ name: "Справка", icon: "❔", w: 1040, h: 700, pinned: false, render: "help" }),
    search: Object.freeze({ name: "Поиск", icon: "⌕", w: 780, h: 620, pinned: false, render: "search" })
  });

  function appCatalogIds() {
    return Object.keys(APP_CATALOG_DEFINITIONS);
  }

  function buildAppRegistry({ renderers = {}, titleResolvers = {} } = {}) {
    const registry = {};
    Object.entries(APP_CATALOG_DEFINITIONS).forEach(([appId, definition]) => {
      const { render, title, ...metadata } = definition;
      const renderFn = renderers[render || appId];
      if (typeof renderFn !== "function") throw new Error(`Missing renderer for app "${appId}".`);
      const app = { ...metadata, render: renderFn };
      if (title) {
        const titleFn = titleResolvers[title];
        if (typeof titleFn !== "function") throw new Error(`Missing title resolver "${title}" for app "${appId}".`);
        app.title = titleFn;
      }
      registry[appId] = app;
    });
    return registry;
  }

  window.ZETER_APP_CATALOG = Object.freeze({
    APP_CATALOG_DEFINITIONS,
    appCatalogIds,
    buildAppRegistry
  });
})();
