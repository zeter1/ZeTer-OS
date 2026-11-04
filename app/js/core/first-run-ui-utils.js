(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS first-run UI utils require core utils.");

  const { escapeHtml } = coreUtils;

  const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const icons = Object.freeze({
    grid: icon('<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'),
    files: icon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
    check: icon('<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m7 12 3 3 7-7"/>'),
    arrow: icon('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
    upload: icon('<path d="M12 16V3m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
    book: icon('<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zm0 0v15"/>'),
    bell: icon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>'),
    search: icon('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>'),
    shield: icon('<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>')
  });

  function firstRunScreenHTML(osVersion = "") {
    return `
      <article class="first-run-card">
        <header class="first-run-header">
          <div class="first-run-brand"><img src="assets/icons/zeter-logo.svg" alt=""><span>ZeTer OS</span></div>
          <span class="first-run-version">Версия ${escapeHtml(osVersion)}</span>
        </header>
        <div class="first-run-layout">
          <section class="first-run-intro" aria-labelledby="first-run-title">
            <span class="first-run-eyebrow"><span aria-hidden="true"></span>МЕСТО ДЛЯ ТВОИХ ИДЕЙ</span>
            <h1 id="first-run-title">Добро пожаловать<br>в <span>ZeTer OS</span></h1>
            <p id="first-run-description" class="first-run-lead">Твои материалы, планы и инструменты —<br class="first-run-wide-break"> в одном личном рабочем пространстве.</p>
            <ul class="first-run-features" aria-label="Что здесь можно делать">
              <li><span class="first-run-feature-icon">${icons.files}</span><div><strong>Собирай важное</strong><p>Файлы, заметки, таблицы и ссылки под рукой.</p></div></li>
              <li><span class="first-run-feature-icon">${icons.check}</span><div><strong>Планируй и действуй</strong><p>Задачи, календарь и учёт времени для твоих планов.</p></div></li>
              <li><span class="first-run-feature-icon">${icons.grid}</span><div><strong>Организуй по-своему</strong><p>Отдельные рабочие столы для учёбы, работы и личного.</p></div></li>
            </ul>
            <div class="first-run-path"><span>ПЕРВЫЕ ШАГИ</span><ol><li>Создай материал</li><li>Настрой свой стол</li><li>Сохрани бэкап</li></ol></div>
          </section>
          <section class="first-run-start" aria-labelledby="first-run-start-title">
            <span class="first-run-step">ТВОЙ ПЕРВЫЙ ШАГ</span>
            <h2 id="first-run-start-title">С чего начнём?</h2>
            <p class="first-run-start-lead">Начни с чистого стола или верни свои данные.</p>
            <button type="button" class="first-run-create" data-first-quick autofocus>
              <span class="first-run-action-icon">${icons.grid}</span>
              <span class="first-run-action-copy"><span class="first-run-recommended">ГОТОВЫЙ РАБОЧИЙ СТОЛ</span><strong>Начать быстро</strong><span>Открой рабочий стол с основными приложениями</span></span>
              <span class="first-run-arrow">${icons.arrow}</span>
            </button>
            <button type="button" class="first-run-secondary" data-first-create>
              <span class="first-run-action-icon">${icons.grid}</span>
              <span class="first-run-action-copy"><strong>Настроить под себя</strong><span>Выбери оформление и ярлыки с предпросмотром</span></span>
              <span class="first-run-arrow">${icons.arrow}</span>
            </button>
            <input type="file" data-first-import-file accept=".zip,.json,.zeterbak,application/zip,application/json" hidden>
            <button type="button" class="first-run-secondary" data-first-import>
              <span class="first-run-action-icon">${icons.upload}</span>
              <span class="first-run-action-copy"><strong>Восстановить из бэкапа</strong><span>Продолжи работу с сохранёнными данными</span></span>
              <span class="first-run-arrow">${icons.arrow}</span>
            </button>
            <div class="first-run-guide">
              <span class="first-run-action-icon">${icons.book}</span>
              <div><strong>Хочешь сначала разобраться?</strong><p>Открой руководство с примерами и подсказками.</p><button type="button" data-first-help>Начать с руководства <span aria-hidden="true">↗</span></button></div>
            </div>
            <p class="first-run-later">Настройки и руководство всегда доступны из рабочего пространства.</p>
            <p class="first-run-error" data-first-error role="alert" hidden></p>
          </section>
        </div>
        <footer class="first-run-footer">
          <span class="first-run-storage-icon">${icons.shield}</span>
          <p><strong>Твои данные — на этом устройстве.</strong> Для переноса и восстановления сохраняй бэкап отдельно.</p>
          <details class="first-run-storage"><summary>О сохранении данных</summary><p>В Windows-приложении данные хранятся в папке data рядом с программой. В браузере — в хранилище этого сайта: его очистка может удалить данные. Создавай ZIP-бэкапы в Центре безопасности данных и храни их отдельно от программы.</p></details>
        </footer>
      </article>`;
  }

  const wallpapers = Object.freeze({ aurora: "Аврора", silk: "Шёлк", mint: "Мята", graphite: "Графит" });
  const setupSteps = ["Твой стол", "Приложения", "Удобство", "Уведомления", "Запуск", "Проверка"];
  const tourSteps = Object.freeze([
    {id:"start",icon:"grid",name:"Меню",title:"Открой меню",text:"Курсор открывает меню «Пуск» и создаёт заметку."},
    {id:"search",icon:"search",name:"Поиск",title:"Найди свою заметку",text:"Курсор вводит запрос, выбирает результат и открывает найденную заметку."},
    {id:"notifications",icon:"bell",name:"Уведомления",title:"Проверь уведомления",text:"Курсор открывает центр уведомлений и отмечает напоминание прочитанным."},
    {id:"note",icon:"files",name:"Заметка",title:"Создай первую заметку",text:"Курсор печатает несколько абзацев, выделяет текст и показывает жирный шрифт, курсив, подчёркивание и размер заголовка."},
    {id:"desktops",icon:"grid",name:"Рабочие столы",title:"Переключи рабочий стол",text:"На другом рабочем столе появляются материалы выбранного проекта."},
    {id:"catalog",icon:"grid",name:"Приложения",title:"Установи приложение",text:"Курсор находит калькулятор в каталоге, устанавливает его ярлык и открывает приложение."},
    {id:"folders",icon:"files",name:"Папки",title:"Открой папку в Проводнике",text:"Курсор открывает папку с рабочего стола и выбирает материал внутри."},
    {id:"context",icon:"files",name:"Действия",title:"Открой меню действий",text:"Правый клик по значку открывает его меню. Команда «Открыть» запускает редактор."},
    {id:"selection",icon:"check",name:"Выделение",title:"Выбери группу значков",text:"Курсор выделяет два значка с Ctrl и открывает меню действий. На широком экране показывает перенос группы."},
    {id:"taskbar",icon:"grid",name:"Панель задач",title:"Переключи приложение",text:"Курсор открывает календарь, затем возвращается к заметке через панель задач."},
    {id:"windows",icon:"grid",name:"Окна",title:"Сверни и верни окно",text:"Окно заметки сворачивается, а нажатие на его значок внизу возвращает редактор."},
    {id:"tasks",icon:"check",name:"Задачи",title:"Добавь первую задачу",text:"Курсор заполняет форму, сохраняет задачу и открывает список с результатом."},
    {id:"calendar",icon:"check",name:"Календарь",title:"Запланируй событие",text:"Курсор добавляет встречу и сохраняет её в настоящем календаре учебной среды."},
    {id:"settings",icon:"grid",name:"Настройки",title:"Измени оформление",text:"Курсор выбирает фон «Мята». После закрытия настроек виден новый фон стола."},
    {id:"backup",icon:"shield",name:"Бэкап",title:"Подготовь резервную копию",text:"Курсор открывает Центр безопасности данных и собирает проверенный учебный ZIP."}
  ]);
  function applyFirstRunDraft(snapshot, draft, options) {
    const { desktopId, apps, createId, normalizeSystemSettings, normalizeDesktopAppearance, normalizeTaskbarPinnedApps } = options;
    const desktop = snapshot.desktops.find(record => record.id === desktopId);
    if (!desktop) throw new Error("Рабочий стол больше недоступен.");
    if (draft) {
      const name = String(draft.desktopName || "").trim().slice(0, 80);
      if (!name) throw new Error("Укажи название рабочего стола.");
      if (!Object.hasOwn(wallpapers, draft.wallpaper)) throw new Error("Выбери фон из списка.");
      const eligible = id => Object.hasOwn(apps, id) && !apps[id].hidden && id !== "search";
      if (![draft.desktopApps, draft.taskbarApps].every(ids => Array.isArray(ids) && ids.every(eligible))) throw new Error("Список приложений изменился. Проверь выбор.");
      const startupDesktop = draft.systemSettings?.startup?.desktop;
      if (startupDesktop !== "last" && !snapshot.desktops.some(record => record.id === startupDesktop)) throw new Error("Выбери существующий стартовый стол.");
      desktop.name = name;
      desktop.data.settings.wallpaper = draft.wallpaper;
      desktop.data.settings.desktopAppearance = normalizeDesktopAppearance(draft.desktopAppearance);
      snapshot.systemSettings = normalizeSystemSettings(draft.systemSettings);
      // Choices cover the visible catalog; preserve pins outside that list (e.g. Tables).
      const otherPins = (snapshot.taskbarPinnedApps || []).filter(id => !eligible(id));
      snapshot.taskbarPinnedApps = normalizeTaskbarPinnedApps([...draft.taskbarApps, ...otherPins]);
      const chosen = new Set(draft.desktopApps);
      Object.entries(snapshot.fs).forEach(([id, item]) => {
        if (item?.type === "app" && item.parent === desktopId && !item.deletedAt && eligible(item.appId) && !chosen.has(item.appId)) delete snapshot.fs[id];
      });
      chosen.forEach(appId => {
        const existing = Object.values(snapshot.fs).find(item => item?.type === "app" && item.appId === appId && item.parent === desktopId && !item.deletedAt);
        if (existing) { delete existing.hiddenFromDesktop; return; }
        const id = createId("app");
        snapshot.fs[id] = {id,type:"app",appId,name:apps[appId].name,parent:desktopId,x:24,y:80,createdAt:Date.now(),updatedAt:Date.now()};
      });
    }
    snapshot.firstRunCompleted = true;
    return snapshot;
  }

  function setupStepHTML(step, draft, initial) {
    const check = value => value ? " checked" : "";
    const select = (value, current) => String(value) === String(current) ? " selected" : "";
    const field = (key, title, description, value) => `<label class="first-run-toggle"><span><strong>${title}</strong><small>${description}</small></span><input type="checkbox" name="${key}"${check(value)}></label>`;
    const accessibility = draft.systemSettings.accessibility;
    const notifications = draft.systemSettings.notifications;
    const textSize = `<label class="first-run-field">Размер текста<select name="textScale">${[90,100,110,120].map(size => `<option value="${size}"${select(size, accessibility.textScale)}>${size}%${size === 100 ? " · стандартный" : ""}</option>`).join("")}</select></label>`;
    const contrast = field("highContrast", "Повышенный контраст", "Более заметные границы и подписи", accessibility.highContrast);
    if (step === 0) return `<h1 id="first-run-title">Начнём с твоего стола</h1><p class="first-run-setup-lead">Дай ему имя и выбери настроение. Всё можно изменить позже.</p>
      <label class="first-run-field">Название рабочего стола<input name="desktopName" maxlength="80" required autocomplete="off" value="${escapeHtml(draft.desktopName)}" placeholder="Например, Моя мастерская"></label>
      <fieldset class="first-run-wallpapers"><legend>Фон рабочего стола</legend>${Object.entries(wallpapers).map(([id, label]) => `<label><input type="radio" name="wallpaper" value="${id}"${check(draft.wallpaper === id)}><span class="first-run-wall first-run-wall-${id}"><span>${label}</span></span></label>`).join("")}</fieldset>
      <div class="first-run-fields"><label class="first-run-field">Размер значков<select name="iconSize">${[["small","Маленькие"],["medium","Обычные"],["large","Крупные"]].map(([id,label]) => `<option value="${id}"${select(id,draft.desktopAppearance.iconSize)}>${label}</option>`).join("")}</select></label><label class="first-run-field">Расстояние между значками<select name="density"><option value="compact"${select("compact",draft.desktopAppearance.density)}>Компактно</option><option value="comfortable"${select("comfortable",draft.desktopAppearance.density)}>Свободнее</option></select></label></div>
            ${field("extensions", "Показывать расширения файлов", "Например, отчёт.docx вместо отчёт. Имена файлов сохраняются.", draft.desktopAppearance.extensions)}
      <details class="first-run-access"><summary>Размер текста и контраст</summary>${textSize}${contrast}</details>
      <div class="first-run-desktop-preview" data-first-desktop-preview aria-label="Предпросмотр стола"><strong class="first-run-preview-name" data-first-preview-name></strong><span>${icons.files}<small>Документ.docx</small></span><span>${icons.check}<small>Задачи</small></span><span>${icons.grid}<small>Приложения</small></span></div>`;
    if (step === 1) return `<h1 id="first-run-title">Приложения под рукой</h1><p class="first-run-setup-lead">Отметь, что разместить на столе и на панели задач. Остальные приложения останутся в каталоге. Снятие галочки убирает только ярлык, сохраняя материалы.</p>
      <div class="first-run-app-head"><span>Приложение</span><span>На столе</span><span>На панели</span></div>
      <div class="first-run-app-list">${initial.apps.map(app => `<div class="first-run-app-row"><span><b aria-hidden="true">${escapeHtml(app.icon)}</b><strong>${escapeHtml(app.name)}</strong></span><label><span class="first-run-sr-only">На столе: ${escapeHtml(app.name)}</span><input type="checkbox" name="desktopApps" value="${escapeHtml(app.id)}"${check(draft.desktopApps.includes(app.id))}></label><label><span class="first-run-sr-only">На панели задач: ${escapeHtml(app.name)}</span><input type="checkbox" name="taskbarApps" value="${escapeHtml(app.id)}"${check(draft.taskbarApps.includes(app.id))}></label></div>`).join("")}</div><p class="first-run-setup-lead first-run-small-note">Пуск и поиск всегда остаются на панели задач.</p>`;
    if (step === 2) return `<h1 id="first-run-title">Сделай работу удобной</h1><p class="first-run-setup-lead">Выбери размер текста и поведение интерфейса.</p>
      <div class="first-run-fields">${textSize}<label class="first-run-field">Размер новых окон<select name="openingSize">${[["full","Вся рабочая область"],["large","Большой"],["medium","Средний"],["compact","Компактный"]].map(([id,label]) => `<option value="${id}"${select(id,draft.systemSettings.windows.openingSize)}>${label}</option>`).join("")}</select></label></div>
      <div class="first-run-preview" data-first-preview><strong>Вот так будет выглядеть текст</strong><p>Важные идеи начинаются с удобного места для работы.</p></div>
      ${field("largeControls", "Крупные кнопки", "Легче выбирать элементы мышью и касанием", accessibility.largeControls)}
      ${contrast}
      ${field("reducedMotion", "Меньше анимации", "Спокойные переходы без лишнего движения", accessibility.reducedMotion)}`;
    if (step === 3) return `<h1 id="first-run-title">Нужное — вовремя</h1><p class="first-run-setup-lead">Настрой напоминания внутри ZeTer OS. Они работают, пока приложение открыто.</p>
      ${field("notificationsEnabled", "Показывать уведомления", "Общий переключатель уведомлений системы", notifications.enabled)}
      ${field("tasks", "Напоминания о задачах", "Не пропускать сроки твоих задач", notifications.tasks)}
      ${field("calendar", "События календаря", "Напоминать о запланированных событиях", notifications.calendar)}
      ${field("system", "Системные сообщения", "Сообщать о событиях и состоянии ZeTer OS", notifications.system)}
      ${field("quietHoursEnabled", "Тихие часы", "Приглушать обычные уведомления в выбранное время", notifications.quietHoursEnabled)}
      <div class="first-run-fields"><label class="first-run-field">Начало тихих часов<input type="time" name="quietFrom" value="${escapeHtml(notifications.quietFrom)}" required></label><label class="first-run-field">Окончание<input type="time" name="quietTo" value="${escapeHtml(notifications.quietTo)}" required></label></div>`;
    if (step === 4) return `<h1 id="first-run-title">Как начинать работу</h1><p class="first-run-setup-lead">Определи, что ZeTer OS откроет при следующем запуске.</p>
      ${field("restoreWindows", "Возвращать открытые окна", "Восстанавливать приложения выбранного рабочего стола", draft.systemSettings.startup.restoreWindows)}
      <div class="first-run-fields"><label class="first-run-field">Стартовый рабочий стол<select name="startupDesktop"><option value="last"${select("last",draft.systemSettings.startup.desktop)}>Последний открытый</option>${initial.desktops.map(desktop => `<option value="${escapeHtml(desktop.id)}"${select(desktop.id,draft.systemSettings.startup.desktop)}>${escapeHtml(desktop.id === initial.desktopId ? draft.desktopName : desktop.name)}</option>`).join("")}</select></label>
      <label class="first-run-field">Окно ZeTer OS<select name="windowMode"><option value="maximized"${select("maximized",draft.systemSettings.startup.windowMode)}>Развёрнутое</option><option value="windowed"${select("windowed",draft.systemSettings.startup.windowMode)}>Обычное окно</option></select></label></div>
      <section class="first-run-native-startup"><label class="first-run-toggle"><span><strong>Запускать вместе с Windows</strong><small data-first-startup-status>Проверяем доступность…</small></span><input type="checkbox" data-first-windows-startup disabled></label><p class="first-run-small-note">Автозапуск меняется сразу при переключении. Остальные параметры — после «Сохранить и начать».</p></section>`;
    return `<h1 id="first-run-title">Всё готово к началу</h1><p class="first-run-setup-lead">Проверь свой выбор. После сохранения можно пройти короткое обучение.</p>
      <dl class="first-run-summary"><div><dt>Рабочий стол</dt><dd>${escapeHtml(draft.desktopName)}</dd></div><div><dt>Оформление</dt><dd>${wallpapers[draft.wallpaper]} · текст ${accessibility.textScale}%</dd></div><div><dt>Приложения</dt><dd>На столе: ${draft.desktopApps.length} · на панели: ${draft.taskbarApps.length}</dd></div><div><dt>Уведомления</dt><dd>${notifications.enabled ? "Включены" : "Выключены"}${notifications.quietHoursEnabled ? " · с тихими часами" : ""}</dd></div><div><dt>При запуске</dt><dd>${draft.systemSettings.startup.restoreWindows ? "Возвращать окна" : "Чистый стол"} · ${draft.systemSettings.startup.windowMode === "windowed" ? "обычное окно" : "развёрнутое окно"}</dd></div></dl>
      <div class="first-run-data-note">${icons.shield}<div><strong>Сохраняется на этом устройстве</strong><p>В Windows-приложении — в папке data рядом с программой. В браузере — в хранилище этого сайта: очистка хранилища может удалить данные.</p><p>Создавай ZIP-бэкапы через Центр безопасности данных и храни их отдельно от папки программы. Бэкап можно импортировать на другом устройстве.</p></div></div>
      ${field("showTour", "Предложить обучение на рабочем столе", `${tourSteps.length} коротких уроков с учебными примерами`, draft.showTour)}`;
  }

  function startFirstRunSetup({ dialog, initial, save, onFinish, getWindowsStartup = async () => ({supported:false}), setWindowsStartup = async () => ({supported:false}), osVersion = "" }) {
    // A local draft keeps Back/Cancel and failed saves from changing live settings.
    const draft = JSON.parse(JSON.stringify(initial));
    draft.showTour = true;
    let step = 0, reviewFrom = 4, pending = false, generation = 0;
    const read = (validate = true) => {
      const form = dialog.querySelector("form");
      if (!form) return true;
      if (validate && !form.reportValidity()) return false;
      const value = name => form.elements.namedItem(name)?.value;
      const checked = name => Boolean(form.elements.namedItem(name)?.checked);
      if (step === 0) {
        const input = form.elements.namedItem("desktopName");
        if (validate && !input.value.trim()) { input.setCustomValidity("Введи название рабочего стола."); input.reportValidity(); return false; }
        draft.desktopName = input.value.trim();
        draft.wallpaper = value("wallpaper");
        draft.systemSettings.accessibility.textScale = Number(value("textScale"));
        draft.systemSettings.accessibility.highContrast = checked("highContrast");
        draft.desktopAppearance = {iconSize:value("iconSize"),density:value("density"),extensions:checked("extensions")};
      }
      if (step === 1) {
        draft.desktopApps = Array.from(form.querySelectorAll('[name="desktopApps"]:checked'),input => input.value);
        draft.taskbarApps = Array.from(form.querySelectorAll('[name="taskbarApps"]:checked'),input => input.value);
      }
      if (step === 2) {
        Object.assign(draft.systemSettings.accessibility, { textScale: Number(value("textScale")), largeControls: checked("largeControls"), highContrast: checked("highContrast"), reducedMotion: checked("reducedMotion") });
        draft.systemSettings.windows.openingSize = value("openingSize");
      }
      if (step === 3) Object.assign(draft.systemSettings.notifications, { enabled: checked("notificationsEnabled"), tasks: checked("tasks"), calendar: checked("calendar"), system: checked("system"), quietHoursEnabled: checked("quietHoursEnabled"), quietFrom: value("quietFrom"), quietTo: value("quietTo") });
      if (step === 4) Object.assign(draft.systemSettings.startup,{restoreWindows:checked("restoreWindows"),desktop:value("startupDesktop"),windowMode:value("windowMode")});
      if (step === setupSteps.length - 1) draft.showTour = checked("showTour");
      return true;
    };
    function detach() {
      dialog.removeEventListener("click", onClick);
      dialog.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("input", onInput);
      dialog.removeEventListener("change", onChange);
      generation++;
    }
    function render() {
      generation++;
      dialog.innerHTML = `<article class="first-run-card first-run-setup-card"><header class="first-run-header"><div class="first-run-brand"><img src="assets/icons/zeter-logo.svg" alt=""><span>ZeTer OS</span></div><span class="first-run-version">Первая настройка · ${escapeHtml(osVersion)}</span></header>
        <ol class="first-run-stepper" aria-label="Этапы настройки">${setupSteps.map((title,index) => {
          const complete = index < step && (step !== setupSteps.length - 1 || index <= reviewFrom);
          return `<li${index === step ? ' aria-current="step"' : ""} class="${complete ? "is-complete" : ""}"><span>${complete ? "✓" : index + 1}</span><span>${title}</span></li>`;
        }).join("")}</ol>
        <form class="first-run-setup-form"><div class="first-run-setup-content">${setupStepHTML(step,draft,initial)}<p class="first-run-error" data-first-error role="alert" hidden></p></div><footer class="first-run-setup-actions"><button type="button" data-setup-back>${step === 0 ? "К приветствию" : "Назад"}</button>${step === 1 ? `<button type="submit" data-setup-review>К проверке</button>` : `<span>Шаг ${step + 1} из ${setupSteps.length}</span>`}<button class="first-run-primary" type="submit">${step === setupSteps.length - 1 ? "Сохранить и начать" : step === 1 ? "Доп. настройки" : "Продолжить"} ${icons.arrow}</button></footer></form></article>`;
      dialog.querySelector(".first-run-setup-lead").id = "first-run-description";
      const title = dialog.querySelector("h1");
      title.tabIndex = -1;
      title.focus();
      dialog.scrollTop = 0;
      updatePreview();
      if (step === 4) loadStartup(generation);
    }
    function updatePreview() {
      const preview = dialog.querySelector("[data-first-preview]");
      if (preview) preview.style.fontSize = `${14 * Number(dialog.querySelector('[name="textScale"]').value) / 100}px`;
      const desktopPreview = dialog.querySelector("[data-first-desktop-preview]");
      if (desktopPreview) {
        desktopPreview.style.fontSize = `${Number(dialog.querySelector('[name="textScale"]').value) * .14}px`;
        desktopPreview.classList.toggle("has-contrast", dialog.querySelector('[name="highContrast"]').checked);
        desktopPreview.dataset.wallpaper = dialog.querySelector('[name="wallpaper"]:checked')?.value || "aurora";
        desktopPreview.querySelector("[data-first-preview-name]").textContent = dialog.querySelector('[name="desktopName"]').value;
        desktopPreview.dataset.iconSize = dialog.querySelector('[name="iconSize"]').value;
        desktopPreview.dataset.density = dialog.querySelector('[name="density"]').value;
        desktopPreview.querySelector("small").textContent = dialog.querySelector('[name="extensions"]').checked ? "Документ.docx" : "Документ";
      }
    }
    function onInput(event) {
      if (event.target.name === "desktopName") event.target.setCustomValidity("");
      updatePreview();
    }
    function setPending(value) {
      pending = value;
      dialog.querySelectorAll("button, input, select").forEach(element => { element.disabled = value; });
    }
    function startupStatus(status, error = "") {
      const checkbox = dialog.querySelector("[data-first-windows-startup]");
      const note = dialog.querySelector("[data-first-startup-status]");
      if (!checkbox || !note) return;
      checkbox.checked = status?.enabled === true;
      checkbox.disabled = pending || status?.supported !== true;
      note.textContent = error || (status?.supported !== true ? "Доступно только в Windows-приложении. В браузере запуском управляет браузер." : status.stale ? "Найдена запись из другого расположения. Включи, чтобы обновить её." : status.enabled ? "Включён для текущего пользователя Windows." : "Выключен. Можно включить при необходимости.");
    }
    async function loadStartup(token) {
      try { const status = await getWindowsStartup(); if (token === generation) startupStatus(status); }
      catch (error) { if (token === generation) startupStatus(null, `Не удалось проверить автозапуск: ${error?.message || "Открой Настройки позже."}`); }
    }
    async function onChange(event) {
      updatePreview();
      if (!event.target.matches("[data-first-windows-startup]") || pending) return;
      const desired = event.target.checked;
      setPending(true);
      try {
        const status = await setWindowsStartup(desired);
        if (status?.supported !== true || status?.enabled !== desired) throw new Error("Windows не подтвердила изменение.");
        setPending(false);
        startupStatus(status);
      } catch (error) {
        try {
          const status = await getWindowsStartup();
          setPending(false);
          startupStatus(status, `Не удалось изменить автозапуск: ${error?.message || "Повтори выбор."}`);
        } catch {
          setPending(false);
          startupStatus(null, "Автозапуск не проверен. Открой Настройки после завершения мастера.");
        }
      }
    }
    async function onSubmit(event) {
      event.preventDefault();
      if (pending || !read()) return;
      if (step < setupSteps.length - 1) {
        reviewFrom = step;
        step = event.submitter?.matches("[data-setup-review]") ? setupSteps.length - 1 : step + 1;
        render();
        return;
      }
      setPending(true);
      const errorBox = dialog.querySelector("[data-first-error]");
      errorBox.hidden = true;
      try {
        await save(draft);
      } catch (error) {
        errorBox.textContent = `Не удалось сохранить настройки. ${error?.message || "Повтори попытку."}`;
        errorBox.hidden = false;
        setPending(false);
        return;
      }
      pending = false;
      detach();
      onFinish(draft.showTour);
    }
    function onClick(event) {
      if (pending) return;
      if (event.target.closest("[data-setup-back]")) {
        // Back keeps the unfinished text and does not validate it.
        if (step === 0) {
          detach();
          dialog.innerHTML = firstRunScreenHTML(osVersion);
          dialog.querySelector("[data-first-quick]").focus();
        } else { read(false); step = step === setupSteps.length - 1 ? reviewFrom : step - 1; render(); }
      }
    }
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("submit", onSubmit);
    dialog.addEventListener("input", onInput);
    dialog.addEventListener("change", onChange);
    render();
  }

  let lastLesson;
  const lessonKey = "zeter-first-steps-v1";

  function startFirstRunTour({ documentRef = document, windowRef = window, exportBackup }) {
    if (documentRef.querySelector(".first-run-screen")) return;
    const opener = documentRef.activeElement;
    const dialog = documentRef.createElement("dialog");
    dialog.className = "first-run-screen first-run-touring";
    dialog.setAttribute("aria-labelledby", "first-run-title");
    dialog.setAttribute("aria-describedby", "first-run-description");
    let remembered = lastLesson;
    try { remembered ??= windowRef.localStorage.getItem(lessonKey); } catch {}
    let index = -1, pending = false, frame = null, token = "", timer = null, ready = false, runId = 0, bootFailed = false;
    const manual = documentRef.body.classList.contains("zeter-reduced-motion")
      || Boolean(windowRef.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

    function remember(id) {
      lastLesson = id || "";
      try {
        if (id) windowRef.localStorage.setItem(lessonKey, id);
        else windowRef.localStorage.removeItem(lessonKey);
      } catch {}
    }
    function disposeFrame() {
      windowRef.clearTimeout(timer);
      frame?.remove();
      frame = null;
      token = "";
      ready = false;
      bootFailed = false;
    }
    function close() {
      disposeFrame();
      windowRef.removeEventListener("message", onMessage);
      dialog.close();
      dialog.remove();
      const target = opener?.isConnected && opener !== documentRef.body
        ? opener : documentRef.querySelector("#start-button");
      target?.focus();
    }
    function send(type) {
      frame?.contentWindow?.postMessage({channel:"zeter-training", token, runId, type, lesson:tourSteps[index]?.id, manual}, "*");
    }
    function onMessage(event) {
      const data = event.data;
      if (!frame || event.source !== frame.contentWindow || data?.channel !== "zeter-training" || data.token !== token) return;
      if (data.type === "ready") {
        ready = true;
        windowRef.clearTimeout(timer);
        if (tourSteps[index]) send("play");
        return;
      }
      if (data.type === "failed" && !ready && data.runId == null) {
        windowRef.clearTimeout(timer);
        bootFailed = true;
        const status = dialog.querySelector("[data-live-status]");
        if (status) { status.textContent = data.text; status.dataset.liveResult = "failed"; }
        return;
      }
      if (data.type !== "focus" && data.runId !== runId) return;
      const status = dialog.querySelector("[data-live-status]");
      if (!status) return;
      const next = dialog.querySelector("[data-live-next]");
      if (data.type === "pointer" && Number.isFinite(data.x) && Number.isFinite(data.y)) {
        const card = dialog.querySelector(".first-run-tour-card");
        if (windowRef.innerWidth > 700) {
          card.style.left = data.x > windowRef.innerWidth / 2 ? "12px" : "auto";
          card.style.right = data.x > windowRef.innerWidth / 2 ? "auto" : "12px";
        } else {
          card.style.top = data.y > windowRef.innerHeight / 2 ? "8px" : "auto";
          card.style.bottom = data.y > windowRef.innerHeight / 2 ? "auto" : "68px";
        }
      } else if (data.type === "focus") {
        if (!data.keepSelection && documentRef.activeElement === frame) dialog.querySelector("h1").focus({preventScroll:true});
      } else if (data.type === "action") {
        status.textContent = String(data.text || "").slice(0, 200);
        status.dataset.liveAction = String(data.step);
        status.setAttribute("aria-label", `Действие ${data.step} из ${data.total}`);
        next.hidden = !manual;
        next.disabled = false;
      } else if (data.type === "complete" || data.type === "failed") {
        windowRef.clearTimeout(timer);
        status.textContent = String(data.text || "").slice(0, 200);
        status.dataset.liveResult = data.type;
        next.hidden = true;
      }
    }
    function prepareFrame() {
      token = windowRef.crypto.randomUUID();
      frame = windowRef.ZETER_TRAINING_RUNTIME.createFrame(token);
      dialog.prepend(frame);
      timer = windowRef.setTimeout(() => {
        if (frame && !ready) {
          bootFailed = true;
          const status = dialog.querySelector("[data-live-status]");
          if (status) {
            status.textContent = "Учебная среда не ответила. Нажми «Повторить».";
            status.dataset.liveResult = "failed";
          }
        }
      }, 20000);
    }
    function render() {
      if (frame && !ready && bootFailed) disposeFrame();
      runId++;
      if (frame) send("stop");
      dialog.querySelector(".first-run-tour-card")?.remove();
      const lesson = tourSteps[index];
      const resume = tourSteps.findIndex(step => step.id === remembered);
      const finished = index === tourSteps.length;
      const title = lesson?.title || (finished ? "Стол готов к работе" : "Первые шаги в ZeTer OS");
      const text = lesson?.text || (finished
        ? "Можно сохранить резервную копию своего пространства или вернуться к работе."
        : "15 уроков: курсор открывает настоящие меню и окна ZeTer OS и показывает действия на учебных материалах.");
      const picker = `<div class="first-run-lesson-picker">${tourSteps.map((step, i) => `<button type="button" data-tour-select="${i}">${icons[step.icon]} ${step.name}</button>`).join("")}</div>`;
      const progress = lesson ? `<div class="first-run-tour-progress" aria-label="Шаг ${index+1} из ${tourSteps.length}">${tourSteps.map((_, i) => `<span class="${i < index ? "is-past" : i === index ? "is-current" : ""}"></span>`).join("")}</div>` : "";
      const body = lesson ? `<p class="first-run-live-status" data-live-status role="status">${ready ? "Подготавливаем следующий показ…" : "Открываем учебный рабочий стол…"}</p>
        <div class="first-run-live-controls"><button type="button" data-live-replay>Повторить</button><button type="button" data-live-next hidden>Показать действие</button></div>`
        : finished ? '<p data-tour-status role="status"></p>' : picker;
      const actions = lesson
        ? `<button type="button" data-tour-back>Назад</button><button type="button" class="first-run-primary" data-tour-next>${index === 14 ? "Завершить" : "Далее"} ${icons.arrow}</button>`
        : finished ? '<button type="button" data-tour-exit>К рабочему столу</button><button type="button" class="first-run-primary" data-first-backup-create>Создать ZIP-бэкап</button>'
          : `<button type="button" data-tour-exit>К рабочему столу</button><button type="button" class="first-run-primary" data-tour-select="${resume < 0 ? 0 : resume}">${resume < 0 ? "Начать обучение" : "Продолжить обучение"}</button>`;
      dialog.insertAdjacentHTML("beforeend", `<section class="first-run-tour-card${lesson ? " first-run-tour-live" : " first-run-tour-centered"}">
        <div class="first-run-tour-content"><div class="first-run-tour-top"><span>${lesson ? `УЧЕБНЫЙ СТОЛ · ${index + 1} ИЗ 15` : "ZETER OS · ПЕРВЫЕ ШАГИ"}</span>${lesson ? '<button type="button" data-tour-exit>Позже</button>' : ""}</div>
        ${progress}<h1 id="first-run-title" tabindex="-1">${title}</h1><p id="first-run-description">${text}</p>${body}</div>
        <div class="first-run-setup-actions">${actions}</div></section>`);
      if (frame) frame.hidden = !lesson;
      if (lesson) {
        if (!frame) prepareFrame();
        else if (ready) send("play");
      }
      dialog.querySelector("h1").focus({preventScroll:true});
    }
    function advance(next) {
      index = next;
      if (next >= 0) remember(tourSteps[next]?.id);
      remembered = lastLesson;
      render();
    }
      async function saveBackup(button) {
      pending = true;
      button.disabled = true;
      const exit = dialog.querySelector("[data-tour-exit]");
      exit.disabled = true;
      const status = dialog.querySelector("[data-tour-status]");
      status.textContent = "Создаём и проверяем ZIP…";

      try {
        const result = await exportBackup();
        if (!result?.verification?.verified || !result.downloadResult || result.downloadResult.cancelled || result.downloadResult.ok === false) {
          status.textContent = "Сохранение не подтверждено. Можно повторить или вернуться к рабочему столу.";
        } else {
          status.textContent = result.downloadResult.directoryName === "Загрузки браузера"
            ? "ZIP проверен. Файл передан браузеру, посмотри его в загрузках."
            : "ZIP проверен и сохранён.";
          button.hidden = true;
        }
      } catch {
        status.textContent = "Не удалось создать ZIP. Попробуй ещё раз или вернись к рабочему столу.";
      } finally {
        pending = false;
        button.disabled = false;
        exit.disabled = false;
        (button.hidden ? exit : button).focus();
      }
    }

    dialog.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || pending) return;
      if (button.matches("[data-tour-exit]")) close();
      else if (button.matches("[data-tour-select]")) advance(Number(button.dataset.tourSelect));
      else if (button.matches("[data-tour-back]")) advance(index - 1);
      else if (button.matches("[data-tour-next]")) advance(index + 1);
      else if (button.matches("[data-live-replay]")) render();
      else if (button.matches("[data-live-next]")) { button.disabled = true; send("next"); }
      else if (button.matches("[data-first-backup-create]")) saveBackup(button);
    });
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!pending) close(); });
    documentRef.body.append(dialog);
    dialog.showModal();
    windowRef.addEventListener("message", onMessage);
    render();
  }
  window.ZETER_FIRST_RUN_UI_UTILS = Object.freeze({
    firstRunScreenHTML,
    startFirstRunSetup,
    startFirstRunTour,
    applyFirstRunDraft
  });
})();
