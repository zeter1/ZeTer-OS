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
            <button type="button" class="first-run-create" data-first-create autofocus>
              <span class="first-run-action-icon">${icons.grid}</span>
              <span class="first-run-action-copy"><span class="first-run-recommended">НОВЫЙ СТАРТ</span><strong>Создать рабочее пространство</strong><span>Чистый рабочий стол с основными приложениями</span></span>
              <span class="first-run-arrow">${icons.arrow}</span>
            </button>
            <button type="button" class="first-run-secondary" data-first-import>
              <span class="first-run-action-icon">${icons.upload}</span>
              <span class="first-run-action-copy"><strong>Импортировать бэкап</strong><span>Продолжи работу с сохранёнными данными</span></span>
              <span class="first-run-arrow">${icons.arrow}</span>
            </button>
            <div class="first-run-guide">
              <span class="first-run-action-icon">${icons.book}</span>
              <div><strong>Хочешь сначала разобраться?</strong><p>Открой руководство с примерами и подсказками.</p><button type="button" data-first-help>Посмотреть возможности <span aria-hidden="true">↗</span></button></div>
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
  const tourSteps = [
    { target: "#start-button", title: "Всё начинается с Пуска", text: "Здесь находятся приложения и рабочие столы. Создай отдельный стол для учёбы, работы или личных дел и переключайся между ними." },
    { target: "#desktop", title: "Создай первый материал", text: "Щёлкни правой кнопкой по свободному месту рабочего стола. Выбери «Создать файл», «Новая заметка», папку или таблицу. Начни с одного нужного материала — остальные добавишь позже." },
    { target: "#desktop", title: "Открывай и выбирай", text: "Один щелчок выбирает значок, двойной — открывает материал. Клавиша Enter тоже открывает выбранный объект. Щелчок по свободному месту снимает выделение." },
    { target: "#desktop", title: "Перемещай несколько значков", text: "Удерживай Ctrl и щёлкай по нужным значкам либо протяни рамку по свободному месту. Затем потяни за любой выбранный значок: вся группа переместится вместе. Правый клик по объекту откроет его действия." },
    { target: "#start-button", title: "Раздели разные дела", text: "В Пуске можно создать рабочие столы для работы, учёбы и личного. Файлы, задачи и календарь каждого стола независимы. Переключай столы в Пуске, а название и оформление меняй в Настройках." },
    { target: '[data-top-action="appcenter"]', title: "Выбери свои приложения", text: "Каталог «Приложения» объясняет назначение каждого инструмента. «Установить» добавляет ярлык на текущий стол. Удаление ярлыка через каталог сохраняет твои файлы и данные приложения." },
    { target: "#taskbar", title: "Держи окна под рукой", text: "Нижняя панель показывает закреплённые и открытые приложения. Нажми значок, чтобы свернуть окно или вернуть его. Правый клик поможет выбрать окно и закрепить приложение. Кнопки в заголовке управляют размером и закрытием окна." },
    { target: '.desktop-icon[title="Задачи"], [data-top-action="appcenter"]', title: "Превращай планы в задачи", text: "Открой «Задачи» из Пуска или с рабочего стола. Создай задачу, укажи срок и при необходимости напоминание. Для большого дела создай проект и добавляй задачи в него." },
    { target: '[data-top-action="calendar"]', title: "Планируй время в календаре", text: "Добавляй встречи и занятия в Календарь, выбирай дату, время и напоминание. Нажатие на часы нижней панели открывает календарь текущего месяца. Напоминания работают, пока ZeTer OS открыта." },
    { target: ".taskbar-search", title: "Найди нужное за секунды", text: "Поиск на нижней панели помогает находить приложения, файлы, задачи и настройки. Введи часть названия и выбери результат." },
    { target: "#notifications-button", title: "Проверяй уведомления", text: "Значок колокольчика открывает центр уведомлений: здесь собраны напоминания и системные сообщения. Категории уведомлений и тихие часы можно изменить в Настройках." },
    { target: '[data-top-action="security"]', title: "Защити свою работу", text: "В Центре безопасности данных создай проверенный ZIP-бэкап. Сохрани его отдельно от программы: он пригодится для переноса и восстановления." },
    { target: '[data-top-action="settings"]', title: "Меняй настройки в любое время", text: "В Настройках можно изменить имя и фон стола, размер значков и текста, показ расширений, уведомления и запуск. Выбор при первом знакомстве не ограничивает тебя — возвращайся сюда, когда захочешь." },
    { target: '.desktop-icon[title="Руководство пользователя ZeTer OS"], [data-top-action="about"]', title: "Ответы всегда рядом", text: "Открой «Руководство пользователя ZeTer OS» из Пуска, каталога или окна «О ZeTer OS». Ищи инструкции обычными словами, читай выбранный раздел и переходи в нужное приложение прямо из темы. Теперь можно начать работу!" }
  ];

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
    if (step === 0) return `<h1 id="first-run-title">Начнём с твоего стола</h1><p class="first-run-setup-lead">Дай ему имя и выбери настроение. Всё можно изменить позже.</p>
      <label class="first-run-field">Название рабочего стола<input name="desktopName" maxlength="80" required autocomplete="off" value="${escapeHtml(draft.desktopName)}" placeholder="Например, Моя мастерская"></label>
      <fieldset class="first-run-wallpapers"><legend>Фон рабочего стола</legend>${Object.entries(wallpapers).map(([id, label]) => `<label><input type="radio" name="wallpaper" value="${id}"${check(draft.wallpaper === id)}><span class="first-run-wall first-run-wall-${id}"><span>${label}</span></span></label>`).join("")}</fieldset>
      <div class="first-run-fields"><label class="first-run-field">Размер значков<select name="iconSize">${[["small","Маленькие"],["medium","Обычные"],["large","Крупные"]].map(([id,label]) => `<option value="${id}"${select(id,draft.desktopAppearance.iconSize)}>${label}</option>`).join("")}</select></label><label class="first-run-field">Расстояние между значками<select name="density"><option value="compact"${select("compact",draft.desktopAppearance.density)}>Компактно</option><option value="comfortable"${select("comfortable",draft.desktopAppearance.density)}>Свободнее</option></select></label></div>
      ${field("extensions", "Показывать расширения файлов", "Например, отчёт.docx вместо отчёт. Имена файлов сохраняются.", draft.desktopAppearance.extensions)}
      <div class="first-run-desktop-preview" data-first-desktop-preview aria-label="Предпросмотр значков"><span>${icons.files}<small>Документ.docx</small></span><span>${icons.check}<small>Задачи</small></span><span>${icons.grid}<small>Приложения</small></span></div>`;
    if (step === 1) return `<h1 id="first-run-title">Приложения под рукой</h1><p class="first-run-setup-lead">Отметь, что разместить на столе и на панели задач. Остальные приложения останутся в каталоге. Снятие галочки убирает только ярлык, сохраняя материалы.</p>
      <div class="first-run-app-head"><span>Приложение</span><span>На столе</span><span>На панели</span></div>
      <div class="first-run-app-list">${initial.apps.map(app => `<div class="first-run-app-row"><span><b aria-hidden="true">${escapeHtml(app.icon)}</b><strong>${escapeHtml(app.name)}</strong></span><label><span class="first-run-sr-only">На столе: ${escapeHtml(app.name)}</span><input type="checkbox" name="desktopApps" value="${escapeHtml(app.id)}"${check(draft.desktopApps.includes(app.id))}></label><label><span class="first-run-sr-only">На панели задач: ${escapeHtml(app.name)}</span><input type="checkbox" name="taskbarApps" value="${escapeHtml(app.id)}"${check(draft.taskbarApps.includes(app.id))}></label></div>`).join("")}</div><p class="first-run-setup-lead first-run-small-note">Пуск и поиск всегда остаются на панели задач.</p>`;
    if (step === 2) return `<h1 id="first-run-title">Сделай работу удобной</h1><p class="first-run-setup-lead">Выбери размер текста и поведение интерфейса.</p>
      <div class="first-run-fields"><label class="first-run-field">Размер текста<select name="textScale">${[90,100,110,120].map(size => `<option value="${size}"${select(size, accessibility.textScale)}>${size}%${size === 100 ? " · стандартный" : ""}</option>`).join("")}</select></label>
      <label class="first-run-field">Размер новых окон<select name="openingSize">${[["full","Вся рабочая область"],["large","Большой"],["medium","Средний"],["compact","Компактный"]].map(([id,label]) => `<option value="${id}"${select(id,draft.systemSettings.windows.openingSize)}>${label}</option>`).join("")}</select></label></div>
      <div class="first-run-preview" data-first-preview><strong>Вот так будет выглядеть текст</strong><p>Важные идеи начинаются с удобного места для работы.</p></div>
      ${field("largeControls", "Крупные кнопки", "Легче выбирать элементы мышью и касанием", accessibility.largeControls)}
      ${field("highContrast", "Повышенный контраст", "Более заметные границы и подписи", accessibility.highContrast)}
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
    return `<h1 id="first-run-title">Всё готово к началу</h1><p class="first-run-setup-lead">Проверь свой выбор. Следующим шагом предложим создать первый бэкап.</p>
      <dl class="first-run-summary"><div><dt>Рабочий стол</dt><dd>${escapeHtml(draft.desktopName)}</dd></div><div><dt>Оформление</dt><dd>${wallpapers[draft.wallpaper]} · текст ${accessibility.textScale}%</dd></div><div><dt>Приложения</dt><dd>На столе: ${draft.desktopApps.length} · на панели: ${draft.taskbarApps.length}</dd></div><div><dt>Уведомления</dt><dd>${notifications.enabled ? "Включены" : "Выключены"}${notifications.quietHoursEnabled ? " · с тихими часами" : ""}</dd></div><div><dt>При запуске</dt><dd>${draft.systemSettings.startup.restoreWindows ? "Возвращать окна" : "Чистый стол"} · ${draft.systemSettings.startup.windowMode === "windowed" ? "обычное окно" : "развёрнутое окно"}</dd></div></dl>
      <div class="first-run-data-note">${icons.shield}<div><strong>Сохраняется на этом устройстве</strong><p>В Windows-приложении — в папке data рядом с программой. В браузере — в хранилище этого сайта: очистка хранилища может удалить данные.</p><p>Создавай ZIP-бэкапы через Центр безопасности данных и храни их отдельно от папки программы. Бэкап можно импортировать на другом устройстве.</p></div></div>
      ${field("showTour", "Показать подсказки на рабочем столе", `${tourSteps.length} полезных шагов: материалы, приложения, планы, окна и безопасность`, draft.showTour)}`;
  }

  function startFirstRunSetup({ dialog, initial, save, onFinish, exportBackup = async () => null, getWindowsStartup = async () => ({supported:false}), setWindowsStartup = async () => ({supported:false}), osVersion = "", windowRef = window }) {
    // A local draft keeps Back/Cancel and failed saves from changing live settings.
    const draft = JSON.parse(JSON.stringify(initial));
    draft.showTour = true;
    let step = 0, tourIndex = 0, pending = false, phase = "setup", generation = 0;
    const doc = dialog.ownerDocument;
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
    function positionTour() {
      const ring = dialog.querySelector(".first-run-tour-ring");
      const targets = tourSteps[tourIndex].target.split(", ").map(selector => doc.querySelector(selector)).filter(Boolean);
      const card = dialog.querySelector(".first-run-tour-card");
      const cardHeight = card?.getBoundingClientRect().height || 0;
      // Prefer a visible route to the app when its desktop icon sits behind the card.
      const fitsBesideCard = target => {
        const rect = target.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= windowRef.innerHeight && Math.max(rect.top, windowRef.innerHeight - rect.bottom) >= cardHeight + 40;
      };
      const target = (windowRef.innerWidth <= 640 && targets.find(fitsBesideCard)) || targets[0];
      if (!ring) return;
      ring.hidden = !target;
      if (!target) return;
      let rect = target.getBoundingClientRect();
      if (rect.left < 0 || rect.right > windowRef.innerWidth || rect.top < 0 || rect.bottom > windowRef.innerHeight) {
        target.scrollIntoView?.({block:"nearest",inline:"center"});
        rect = target.getBoundingClientRect();
      }
      const left = Math.max(4, rect.left - 6), top = Math.max(4, rect.top - 6);
      Object.assign(ring.style, { left: `${left}px`, top: `${top}px`, width: `${Math.min(rect.width + 12, windowRef.innerWidth - left - 4)}px`, height: `${Math.min(rect.height + 12, windowRef.innerHeight - top - 4)}px` });
      if (windowRef.innerWidth <= 640) {
        const aboveTarget = rect.top > windowRef.innerHeight - rect.bottom;
        card.style.top = aboveTarget ? "24px" : "auto";
        card.style.bottom = aboveTarget ? "auto" : "24px";
        const freeHeight = (aboveTarget ? rect.top : windowRef.innerHeight - rect.bottom) - 40;
        card.style.maxHeight = freeHeight > 160 ? `${freeHeight}px` : "";
      } else { card.style.top = ""; card.style.bottom = ""; card.style.maxHeight = ""; }
    }
    function finish() {
      windowRef.removeEventListener("resize", positionTour);
      dialog.removeEventListener("click", onClick);
      dialog.removeEventListener("submit", onSubmit);
      dialog.removeEventListener("input", onInput);
      dialog.removeEventListener("change", onChange);
      generation++;
      onFinish();
    }
    function renderTour() {
      dialog.classList.add("first-run-touring");
      const current = tourSteps[tourIndex];
      dialog.innerHTML = `<div class="first-run-tour-ring" aria-hidden="true"></div><section class="first-run-tour-card"><div class="first-run-tour-top"><span>ЗНАКОМСТВО С СИСТЕМОЙ · ${tourIndex + 1} / ${tourSteps.length}</span><button type="button" data-setup-skip>Пропустить</button></div><div class="first-run-progress"><span style="width:${(tourIndex + 1) / tourSteps.length * 100}%"></span></div><h1 id="first-run-title" tabindex="-1">${current.title}</h1><p id="first-run-description">${current.text}</p><div class="first-run-setup-actions"><button type="button" data-tour-back${tourIndex === 0 ? " disabled" : ""}>Назад</button><button type="button" class="first-run-primary" data-tour-next>${tourIndex === tourSteps.length - 1 ? "Начать работу" : "Дальше"} ${icons.arrow}</button></div></section>`;
      positionTour();
      dialog.querySelector("h1").focus();
    }
    function render() {
      generation++;
      dialog.innerHTML = `<article class="first-run-card first-run-setup-card"><header class="first-run-header"><div class="first-run-brand"><img src="assets/icons/zeter-logo.svg" alt=""><span>ZeTer OS</span></div><span class="first-run-version">Первая настройка · ${escapeHtml(osVersion)}</span></header>
        <ol class="first-run-stepper" aria-label="Этапы настройки">${setupSteps.map((title,index) => `<li${index === step ? ' aria-current="step"' : ""} class="${index < step ? "is-complete" : ""}"><span>${index < step ? "✓" : index + 1}</span><span>${title}</span></li>`).join("")}</ol>
        <form class="first-run-setup-form"><div class="first-run-setup-content">${setupStepHTML(step,draft,initial)}<p class="first-run-error" data-first-error role="alert" hidden></p></div><footer class="first-run-setup-actions"><button type="button" data-setup-back>${step === 0 ? "К приветствию" : "Назад"}</button><span>Шаг ${step + 1} из ${setupSteps.length}</span><button class="first-run-primary" type="submit">${step === setupSteps.length - 1 ? "Сохранить и начать" : "Продолжить"} ${icons.arrow}</button></footer></form></article>`;
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
    function continueAfterBackup() {
      if (draft.showTour) { phase = "tour"; windowRef.addEventListener("resize", positionTour); renderTour(); }
      else finish();
    }
    function renderBackup() {
      phase = "backup";
      dialog.innerHTML = `<article class="first-run-card first-run-setup-card"><header class="first-run-header"><div class="first-run-brand"><img src="assets/icons/zeter-logo.svg" alt=""><span>ZeTer OS</span></div><span class="first-run-version">Настройки сохранены</span></header><section class="first-run-setup-content"><span class="first-run-eyebrow">СОХРАНИ ПЕРВЫЙ РЕЗУЛЬТАТ</span><h1 id="first-run-title" tabindex="-1">Твой первый бэкап</h1><p class="first-run-setup-lead" id="first-run-description">Сохрани настроенное пространство в ZIP. Он поможет перенести данные или восстановить их позже.</p><div class="first-run-data-note">${icons.shield}<div><strong>Проверка перед сохранением</strong><p>ZeTer OS проверит содержимое и контрольные суммы ZIP. Храни копию отдельно от папки программы, например на другом диске.</p><p>В Windows выбери место в диалоге сохранения. В браузере проверь файл в загрузках.</p></div></div><p data-first-backup-status class="first-run-backup-status" role="status" aria-live="polite">Настройки уже сохранены. Бэкап можно создать сейчас или позже в Центре безопасности данных.</p></section><footer class="first-run-setup-actions"><button type="button" data-first-backup-later>Позже</button><button type="button" class="first-run-primary" data-first-backup-create>Создать ZIP-бэкап ${icons.arrow}</button></footer></article>`;
      dialog.querySelector("h1").focus();
      dialog.scrollTop = 0;
    }
    async function createBackup() {
      setPending(true);
      const status = dialog.querySelector("[data-first-backup-status]");
      status.textContent = "Создаём и проверяем ZIP…";
      try {
        const result = await exportBackup();
        if (!result?.verification?.verified || !result?.downloadResult || result.downloadResult.cancelled || result.downloadResult.ok === false) throw new Error("Бэкап не сохранён или сохранение отменено. Повтори попытку либо выбери «Позже».");
        status.textContent = result.downloadResult.directoryName === "Загрузки браузера" ? `ZIP «${result.name}» создан и проверен. Скачивание передано браузеру — проверь файл в загрузках.` : `ZIP «${result.name}» создан, проверен и сохранён.`;
        const button = dialog.querySelector("[data-first-backup-create]");
        button.textContent = "Продолжить";
        button.removeAttribute("data-first-backup-create");
        button.setAttribute("data-first-backup-done", "");
        dialog.querySelector("[data-first-backup-later]").hidden = true;
      } catch (error) { status.textContent = error?.message || "Не удалось создать бэкап. Повтори попытку."; }
      setPending(false);
    }
    async function onSubmit(event) {
      event.preventDefault();
      if (phase !== "setup" || pending || !read()) return;
      if (step < setupSteps.length - 1) { step++; render(); return; }
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
      renderBackup();
    }
    function onClick(event) {
      if (pending) return;
      if (event.target.closest("[data-setup-back]")) {
        // Back never traps the user on an invalid field; keep the unfinished text.
        if (step === 0) {
          dialog.removeEventListener("click", onClick);
          dialog.removeEventListener("submit", onSubmit);
          dialog.removeEventListener("input", onInput);
          dialog.removeEventListener("change", onChange);
          generation++;
          dialog.innerHTML = firstRunScreenHTML(osVersion);
          dialog.querySelector("[data-first-create]").focus();
        } else { read(false); step--; render(); }
      }
      if (event.target.closest("[data-first-backup-create]")) createBackup();
      if (event.target.closest("[data-first-backup-later], [data-first-backup-done]")) continueAfterBackup();
      if (event.target.closest("[data-setup-skip]")) finish();
      if (event.target.closest("[data-tour-back]") && tourIndex > 0) { tourIndex--; renderTour(); }
      if (event.target.closest("[data-tour-next]")) {
        if (tourIndex === tourSteps.length - 1) finish();
        else { tourIndex++; renderTour(); }
      }
    }
    dialog.addEventListener("click", onClick);
    dialog.addEventListener("submit", onSubmit);
    dialog.addEventListener("input", onInput);
    dialog.addEventListener("change", onChange);
    render();
  }

  window.ZETER_FIRST_RUN_UI_UTILS = Object.freeze({
    firstRunScreenHTML,
    startFirstRunSetup,
    applyFirstRunDraft
  });
})();
