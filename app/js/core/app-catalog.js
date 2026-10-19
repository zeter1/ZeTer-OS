(() => {
  "use strict";

  const APP_CATALOG_DEFINITIONS = Object.freeze({
    folder: Object.freeze({ name: "Папка", icon: "📁", w: 880, h: 570, pinned: false, hidden: true, render: "explorer", title: "folder" }),
    editor: Object.freeze({ name: "Текстовый редактор", description: "Создавайте текстовые документы.\nОформляйте текст и вставляйте фото.\nОткрывайте DOC и DOCX в Windows.", icon: "📝", w: 760, h: 560, pinned: false, render: "editor" }),
    notes: Object.freeze({ name: "Заметки", icon: "🗒️", w: 540, h: 470, pinned: false, hidden: true, render: "notes" }),
    markdown: Object.freeze({ name: "Markdown Studio", description: "Пишите заметки в Markdown.\nСразу смотрите готовый результат.\nСкачивайте документы в .md.", icon: "📘", w: 880, h: 580, pinned: false, render: "markdown" }),
    table: Object.freeze({ name: "Таблица", icon: "▦", w: 1040, h: 640, pinned: false, hidden: true, render: "table", title: "table" }),
    tasks: Object.freeze({ name: "Задачи", description: "Управляйте задачами и проектами.\nВыбирайте обзор, доску или список.\nСвязывайте материалы и встречи.", icon: "✅", w: 1040, h: 680, pinned: true, render: "tasks", title: "taskWindow" }),
    tasklist: Object.freeze({ name: "Список задач", icon: "☑️", w: 1040, h: 680, pinned: false, hidden: true, render: "tasks", title: "taskWindow" }),
    taskedit: Object.freeze({ name: "Редактирование задачи", icon: "📝", w: 680, h: 520, pinned: false, hidden: true, render: "taskEditor", title: "taskEditor" }),
    calendar: Object.freeze({ name: "Календарь", description: "Планируйте события и встречи.\nЗадавайте повторы и напоминания.\nСмотрите дела на выбранную дату.", icon: "📅", w: 1180, h: 680, pinned: true, render: "calendar" }),
    calendaredit: Object.freeze({ name: "Добавление события", icon: "📅", w: 680, h: 580, pinned: false, hidden: true, render: "calendarEventEditor", title: "calendarEventEditor" }),
    automations: Object.freeze({ name: "Автоматизации", description: "Создавайте правила для рутины.\nВыбирайте условия и действия.\nПроверяйте итоги выполнения.", icon: "⚡", w: 920, h: 640, pinned: false, render: "automations" }),
    links: Object.freeze({ name: "Ссылки", description: "Собирайте полезные ссылки.\nДобавляйте сайты, файлы и папки.\nРаспределяйте их по категориям.", icon: "🔗", w: 980, h: 660, pinned: false, render: "links" }),
    calculations: Object.freeze({ name: "Подсчёты", description: "Считайте маржу, скидки и прибыль.\nОценивайте затраты и окупаемость.\nВыбирайте нужные калькуляторы.", icon: "∑", w: 980, h: 740, pinned: false, render: "calculations" }),
    prompts: Object.freeze({ name: "Промпты", description: "Храните запросы для нейросетей.\nРазделяйте шаблоны по категориям.\nКопируйте текст для новой беседы.", icon: "✦", w: 980, h: 700, pinned: false, render: "prompts" }),
    timetracking: Object.freeze({ name: "Учёт времени", description: "Засекайте время работы таймером.\nЗаписывайте занятия вручную.\nСмотрите историю и итоги недели.", icon: "⏱️", w: 1040, h: 760, pinned: false, render: "timeTracking" }),
    automationedit: Object.freeze({ name: "Новая автоматизация", icon: "⚡", w: 940, h: 720, pinned: false, hidden: true, render: "automationEditor", title: "automationEditor" }),
    shortcutedit: Object.freeze({ name: "Создание ярлыка", icon: "🔗", w: 680, h: 500, pinned: false, hidden: true, render: "shortcutEditor", title: "shortcutEditor" }),
    itemsettings: Object.freeze({ name: "Настройка объекта", icon: "⚙️", w: 720, h: 640, pinned: false, hidden: true, render: "itemSettings", title: "itemSettings" }),
    calculator: Object.freeze({ name: "Калькулятор", description: "Выполняйте обычные вычисления.\nСкладывайте, делите и умножайте.\nСчитайте проценты и выражения.", icon: "🧮", w: 390, h: 540, pinned: true, render: "calculator" }),
    photos: Object.freeze({ name: "Фото", description: "Открывайте свои изображения.\nПросматривайте фото рабочего стола.\nПереходите между снимками.", icon: "🖼️", w: 760, h: 540, pinned: false, render: "photos" }),
    settings: Object.freeze({ name: "Настройки", description: "Настраивайте рабочее пространство.\nМеняйте тему, обои и размер окон.\nВыбирайте удобные горячие клавиши.", icon: "⚙️", w: 820, h: 600, pinned: true, render: "settings" }),
    about: Object.freeze({ name: "О ZeTer OS", description: "Узнайте больше о ZeTer OS.\nПроверьте версию и обновления.\nНайдите контакты разработчика.", icon: "ℹ️", w: 820, h: 700, pinned: false, render: "about" }),
    manualupdate: Object.freeze({ name: "Обновить вручную", icon: "⬇️", w: 820, h: 700, pinned: false, hidden: true, render: "manualUpdate" }),
    security: Object.freeze({ name: "Центр безопасности данных", description: "Проверяйте сохранность данных.\nСоздавайте резервные копии.\nВосстанавливайте рабочую среду.", icon: "🛡️", w: 980, h: 680, pinned: true, render: "security" }),
    monitor: Object.freeze({ name: "Монитор системы", description: "Следите за работой ZeTer OS.\nСмотрите данные о хранилище.\nПроверяйте нагрузку и диагностику.", icon: "📊", w: 980, h: 720, pinned: true, render: "monitor" }),
    appcenter: Object.freeze({ name: "Приложения", description: "Знакомьтесь с приложениями.\nДобавляйте ярлыки на текущий стол.\nУбирайте ненужные ярлыки.", icon: "🛍️", w: 760, h: 520, pinned: true, render: "appcenter" }),
    help: Object.freeze({ name: "Руководство пользователя ZeTer OS", description: "Осваивайте ZeTer OS по шагам.\nИщите инструкции по возможностям.\nНаходите ответы на частые вопросы.", icon: "❔", w: 1040, h: 700, pinned: false, render: "help" }),
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
