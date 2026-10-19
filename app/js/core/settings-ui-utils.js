(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const config = window.ZETER_OS_CONFIG;
  const systemSettingsUtils = window.ZETER_SYSTEM_SETTINGS_UTILS;
  if (!coreUtils || !config || !systemSettingsUtils) {
    throw new Error("ZeTer OS settings UI utils require core, config and system settings utils.");
  }

  const { escapeHtml, $$, $, debounce } = coreUtils;
  const {
    HOTKEY_DEFINITIONS,
    normalizeSystemSettings,
    keyboardEventHotkey,
    isHotkeyAssignable,
    hotkeyDisplay,
    hotkeyConflict,
    defaultHotkeys
  } = systemSettingsUtils;
  const SYSTEM_SETTING_PATHS = new Set([
    "startup.restoreWindows",
    "startup.desktop",
    "startup.windowMode",
    "windows.openingSize",
    "windows.placement",
    "clock.format",
    "clock.showSeconds",
    "clock.showDate",
    "calendar.weekStart",
    "notifications.enabled",
    "notifications.tasks",
    "notifications.calendar",
    "notifications.system",
    "notifications.quietHoursEnabled",
    "notifications.quietFrom",
    "notifications.quietTo",
    "notifications.popupDuration",
    "accessibility.textScale",
    "accessibility.largeControls",
    "accessibility.highContrast",
    "accessibility.reducedMotion"
  ]);
  for (const definition of HOTKEY_DEFINITIONS) SYSTEM_SETTING_PATHS.add(`hotkeys.${definition.id}`);
  const APPEARANCE_FIELDS = ["iconSize", "density", "extensions", "labelSize", "labelLines", "openMode"];
  const SETTINGS_PREFERENCE_KEYS = Object.freeze([
    ...[...SYSTEM_SETTING_PATHS].map(path => `system.${path}`),
    ...APPEARANCE_FIELDS.map(field => `desktop.desktopAppearance.${field}`),
    "desktop.accent", "desktop.wallpaper", "desktop.customWallpaper", "profile.name", "profile.description", "profile.icon"
  ]);
  const preferenceKeys = new Set(SETTINGS_PREFERENCE_KEYS);
  const SETTINGS_SECTIONS = [
    { id: "appearance", title: "Рабочий стол", note: "Обои, значки и окна", description: "Твоё пространство. Оформи его так, как удобно тебе.", icon: "M3 4h18v13H3z M8 21h8 M12 17v4" },
    { id: "startup", title: "Запуск и окна", note: "Начало работы и восстановление", description: "Выбери, с чего будет начинаться работа в ZeTer OS.", icon: "M12 3v9 M6 5a9 9 0 1 0 12 0" },
    { id: "notifications", title: "Уведомления", note: "Напоминания и тихие часы", description: "Оставь нужные напоминания и выдели время без отвлечений.", icon: "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4" },
    { id: "accessibility", title: "Удобство и доступность", note: "Текст, контраст и анимация", description: "Настрой интерфейс под своё зрение и привычки.", icon: "M4 5h16 M12 5v15 M7 20h10" },
    { id: "time", title: "Время и календарь", note: "Часы, дата и начало недели", description: "Выбери удобный формат времени и порядок дней в календаре.", icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2" },
    { id: "hotkeys", title: "Горячие клавиши", note: "Быстрые действия с клавиатуры", description: "Привычные сочетания для повседневных действий.", icon: "M3 6h18v13H3z M6 10h1 M11 10h1 M16 10h1 M7 15h10" },
    { id: "storage", title: "Сохранение и данные", note: "Хранилище и безопасность", description: "Проверь сохранение и перейди к защите своих данных.", icon: "M4 4h14l2 2v14H4z M8 4v6h8V4 M8 20v-6h8v6" }
  ];

  function settingsPreferences({ settings = {}, systemSettings = {}, desktop = {} } = {}) {
    const system = normalizeSystemSettings(systemSettings);
    const visual = window.ZETER_VISUAL_UTILS;
    const appearance = visual.normalizeDesktopAppearance(settings.desktopAppearance);
    return {
      ...Object.fromEntries([...SYSTEM_SETTING_PATHS].map(path => { const [group, field] = path.split("."); return [`system.${path}`, system[group][field]]; })),
      ...Object.fromEntries(APPEARANCE_FIELDS.map(field => [`desktop.desktopAppearance.${field}`, appearance[field]])),
      "desktop.accent": visual.ACCENT_PRESETS.some(preset => preset.id === settings.accent) ? settings.accent : "blue",
      "desktop.wallpaper": settings.wallpaper || "aurora", "desktop.customWallpaper": settings.customWallpaper || null,
      "profile.name": desktop.name || "", "profile.description": desktop.description || "", "profile.icon": desktop.icon || null
    };
  }

  function applySettingsPreferencePatch(models = {}, patch = {}) {
    const settings = { ...(models.settings || {}), desktopAppearance: { ...(models.settings?.desktopAppearance || {}) } };
    const systemSettings = normalizeSystemSettings(models.systemSettings);
    const desktop = { ...(models.desktop || {}) };
    for (const [key, value] of Object.entries(patch)) {
      if (!preferenceKeys.has(key)) continue;
      const [scope, group, field] = key.split(".");
      if (scope === "system") systemSettings[group][field] = value;
      else if (scope === "profile") {
        if (group === "icon" && !value) delete desktop.icon;
        else desktop[group] = group === "name" ? normalizeDesktopProfileName(value) : group === "description" ? normalizeDesktopProfileDescription(value) : value;
      } else if (group === "desktopAppearance") settings.desktopAppearance[field] = value;
      else if (group === "customWallpaper" && !value) delete settings.customWallpaper;
      else settings[group] = value;
    }
    const visual = window.ZETER_VISUAL_UTILS;
    settings.accent = visual.ACCENT_PRESETS.some(preset => preset.id === settings.accent) ? settings.accent : "blue";
    settings.desktopAppearance = visual.normalizeDesktopAppearance(settings.desktopAppearance);
    if (!["aurora", "silk", "mint", "graphite", "custom"].includes(settings.wallpaper) || (settings.wallpaper === "custom" && !settings.customWallpaper)) settings.wallpaper = "aurora";
    return { settings, systemSettings: normalizeSystemSettings(systemSettings), desktop };
  }

  function settingsResetPatch(section = "") {
    const defaults = normalizeSystemSettings();
    const paths = [...SYSTEM_SETTING_PATHS].filter(path => section === "startup" ? path.startsWith("startup.") : section === "time" ? /^(clock|calendar)\./.test(path) : section === "appearance" ? path.startsWith("windows.") : section === "hotkeys" ? path.startsWith("hotkeys.") : path.startsWith(section + "."));
    const patch = Object.fromEntries(paths.map(path => { const [group, field] = path.split("."); return [`system.${path}`, defaults[group][field]]; }));
    if (section === "appearance") {
      const visual = window.ZETER_VISUAL_UTILS.baseDesktopSettings();
      patch["desktop.accent"] = visual.accent; patch["desktop.wallpaper"] = visual.wallpaper;
      for (const field of APPEARANCE_FIELDS) patch[`desktop.desktopAppearance.${field}`] = visual.desktopAppearance[field];
    }
    return patch;
  }

  function sizeSuffix(sizeText = "") {
    return sizeText ? ` · ${escapeHtml(sizeText)}` : "";
  }

  function formatSettingsTime(timestamp = 0) {
    if (!Number(timestamp)) return "Ещё не выполнялось";
    return new Date(Number(timestamp)).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
  }

  function checked(value) {
    return value ? " checked" : "";
  }

  function selected(value, expected) {
    return String(value) === String(expected) ? " selected" : "";
  }

  function settingsAppViewModel(options = {}) {
    const formatBytes = typeof options.formatBytes === "function" ? options.formatBytes : value => String(value || "");
    const desktopIcon = options.desktopIcon || null;
    const wallpaper = options.wallpaper || null;
    const desktopTitle = options.desktopTitle || "Рабочий стол";
    const desktopDescription = options.desktopDescription || "";
    const systemSettings = normalizeSystemSettings(options.systemSettings);
    const storage = options.storage || {};
    return {
      desktopAvatarHTML: options.desktopAvatarHTML || "",
      desktopTitle,
      desktopDescription,
      desktopNameValue: options.desktopNameValue || desktopTitle,
      hasDesktopIcon: Boolean(desktopIcon?.dataURL),
      desktopIconName: desktopIcon?.name,
      desktopIconSizeText: desktopIcon?.size ? formatBytes(desktopIcon.size) : "",
      desktopAppearance: options.desktopAppearance,
      accent: options.accent || "blue",
      hasCustomWallpaper: Boolean(wallpaper?.dataURL),
      wallpaperName: wallpaper?.name,
      wallpaperSizeText: wallpaper?.size ? formatBytes(wallpaper.size) : "",
      windowsStartupAvailable: Boolean(options.windowsStartupAvailable),
      systemSettings,
      desktopOptions: Array.isArray(options.desktopOptions) ? options.desktopOptions : [],
      hotkeyDefinitions: Array.isArray(options.hotkeyDefinitions) ? options.hotkeyDefinitions : HOTKEY_DEFINITIONS,
      storage: {
        mode: storage.mode || "Определяется…",
        status: storage.fallback ? "Резервный режим" : (storage.ready ? "Готово" : "Инициализация"),
        statusTone: storage.fallback || storage.lastError ? "warn" : (storage.ready ? "ok" : "neutral"),
        path: storage.path || "—",
        lastSavedText: formatSettingsTime(storage.lastSavedAt),
        stateSizeText: storage.stateBytes ? formatBytes(storage.stateBytes) : "Нет данных",
        lastError: storage.lastError || "",
        canOpenDataFolder: Boolean(storage.canOpenDataFolder)
      }
    };
  }

  function activeSettingsWallpaper(settings = {}) {
    return settings.wallpaper === "custom" && settings.customWallpaper?.dataURL ? "custom" : settings.wallpaper || "aurora";
  }

  function settingsClickAction(target) {
    const wallButton = target?.closest?.("[data-wall]");
    if (wallButton) return { type: "select-wallpaper", wall: wallButton.dataset.wall || "" };
    const hotkeyButton = target?.closest?.("[data-hotkey-capture]");
    if (hotkeyButton) return { type: "capture-hotkey", actionId: hotkeyButton.dataset.hotkeyCapture || "" };
    const clearHotkeyButton = target?.closest?.("[data-hotkey-clear]");
    if (clearHotkeyButton) return { type: "clear-hotkey", actionId: clearHotkeyButton.dataset.hotkeyClear || "" };
    if (target?.closest?.("[data-hotkeys-reset]")) return { type: "reset-hotkeys" };
    if (target?.closest?.("[data-storage-save]")) return { type: "save-now" };
    if (target?.closest?.("[data-storage-open-folder]")) return { type: "open-data-folder" };
    if (target?.closest?.("[data-storage-security]")) return { type: "open-security" };
    if (target?.closest?.("[data-wall-upload]")) return { type: "upload-wallpaper" };
    if (target?.closest?.("[data-wall-clear]")) return { type: "clear-wallpaper" };
    if (target?.closest?.("[data-desktop-icon-upload]")) return { type: "upload-desktop-icon" };
    if (target?.closest?.("[data-desktop-icon-clear]")) return { type: "clear-desktop-icon" };
    return null;
  }

  function settingsChangeAction(target) {
    if (target?.matches?.("[data-desktop-appearance]")) {
      const field = target.dataset.desktopAppearance || "";
      if (!APPEARANCE_FIELDS.includes(field)) return null;
      return { type: "desktop-appearance", field, value: target.type === "checkbox" ? Boolean(target.checked) : target.value };
    }
    if (target?.matches?.("[data-wall-file]")) return { type: "wallpaper-file" };
    if (target?.matches?.("[data-desktop-icon-file]")) return { type: "desktop-icon-file" };
    if (target?.matches?.("[data-windows-startup]")) {
      return { type: "windows-startup", enabled: Boolean(target.checked) };
    }
    if (target?.matches?.("[data-system-setting]")) {
      const path = target.dataset.systemSetting || "";
      if (!SYSTEM_SETTING_PATHS.has(path)) return null;
      const value = target.type === "checkbox" ? Boolean(target.checked) : target.value;
      return { type: "system-setting", path, value };
    }
    return null;
  }

  function applySystemSetting(settings = {}, path = "", value = null) {
    if (!SYSTEM_SETTING_PATHS.has(path)) return normalizeSystemSettings(settings);
    const normalized = normalizeSystemSettings(settings);
    const [group, field] = path.split(".");
    normalized[group][field] = path === "accessibility.textScale" ? Number(value) : value;
    return normalizeSystemSettings(normalized);
  }

  function normalizeDesktopProfileName(value = "") {
    return String(value || "").slice(0, 80);
  }

  function normalizeDesktopProfileDescription(value = "") {
    return String(value || "").slice(0, 520);
  }

  function settingsInputAction(target) {
    if (target?.matches?.("[data-desktop-name]")) {
      return { type: "desktop-name", value: normalizeDesktopProfileName(target.value) };
    }
    if (target?.matches?.("[data-desktop-description]")) {
      return { type: "desktop-description", value: normalizeDesktopProfileDescription(target.value) };
    }
    return null;
  }

  function syncSettingsWallpaperButtons(root, settings = {}) {
    const activeWallpaper = activeSettingsWallpaper(settings);
    $$('[data-wall]', root).forEach(button => {
      const active = button.dataset.wall === activeWallpaper;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const preview = $("[data-settings-preview]", root);
    if (preview) preview.dataset.settingsPreview = activeWallpaper;
  }

  function updateSettingsDesktopProfileText(root, title = "", description = "") {
    const titleEl = $(".desktop-profile-head b", root);
    const noteEl = $(".desktop-profile-head .muted", root);
    if (titleEl) titleEl.textContent = title || "Рабочий стол";
    if (noteEl) noteEl.textContent = description || "";
  }

  function settingsToggleHTML(path, title, note, value, disabled = false) {
    return `<label class="settings-toggle${disabled ? " is-disabled" : ""}"><input data-system-setting="${escapeHtml(path)}" type="checkbox"${checked(value)}${disabled ? " disabled" : ""}><span><b>${escapeHtml(title)}</b>${note ? `<small>${escapeHtml(note)}</small>` : ""}</span></label>`;
  }

  function windowsStartupView(status = {}, pending = false, error = "") {
    const supported = status?.supported === true;
    const enabled = supported && status?.enabled === true;
    let message = "Автозапуск доступен только в desktop-версии ZeTer OS для Windows.";
    if (pending) message = "Проверяем текущее состояние автозапуска в Windows…";
    else if (error) message = `Не удалось проверить автозапуск: ${String(error)}`;
    else if (supported && status?.stale) message = "Найдена запись из другого расположения программы. Включи галочку, чтобы обновить её.";
    else if (enabled) message = "Включено для текущего пользователя Windows. Настройка общая для всех рабочих столов.";
    else if (supported) message = "Выключено для текущего пользователя Windows. Настройка общая для всех рабочих столов.";
    return {
      supported,
      enabled,
      pending: Boolean(pending),
      disabled: Boolean(pending || error || !supported),
      message
    };
  }

  function windowsStartupToggleHTML(available = false) {
    const view = windowsStartupView({ supported: Boolean(available) }, Boolean(available));
    return `<label class="settings-toggle${view.disabled ? " is-disabled" : ""}" data-windows-startup-row><input data-windows-startup type="checkbox"${checked(view.enabled)}${view.disabled ? " disabled" : ""}><span><b>Запускать ZeTer OS вместе с Windows</b><small data-windows-startup-note>${escapeHtml(view.message)}</small></span></label>`;
  }

  function syncWindowsStartupControls(scope, view = {}) {
    if (!scope?.querySelectorAll) return;
    $$("[data-windows-startup]", scope).forEach(input => {
      input.checked = Boolean(view.enabled);
      input.disabled = Boolean(view.disabled);
    });
    $$("[data-windows-startup-row]", scope).forEach(row => {
      row.classList.toggle("is-disabled", Boolean(view.disabled));
      row.setAttribute("aria-busy", view.pending ? "true" : "false");
    });
    $$("[data-windows-startup-note]", scope).forEach(note => {
      note.textContent = String(view.message || "");
    });
  }

  function hotkeyRowsHTML(options = {}) {
    const settings = options.systemSettings || normalizeSystemSettings();
    return (options.hotkeyDefinitions || HOTKEY_DEFINITIONS).map(definition => {
      const value = settings.hotkeys[definition.id] || "";
      return `<div class="hotkey-setting-row"><span>${escapeHtml(definition.label)}</span><button type="button" data-hotkey-capture="${escapeHtml(definition.id)}"><kbd>${escapeHtml(hotkeyDisplay(value))}</kbd><small>Изменить</small></button><button type="button" class="icon-action" data-hotkey-clear="${escapeHtml(definition.id)}" title="Отключить сочетание" aria-label="Отключить сочетание для ${escapeHtml(definition.label)}">×</button></div>`;
    }).join("");
  }

  function settingsAppHTML(options = {}) {
    const desktopTitle = options.desktopTitle || "Рабочий стол";
    const desktopDescription = options.desktopDescription || "";
    const wallpaperInfo = options.hasCustomWallpaper
      ? `Загружено: ${escapeHtml(options.wallpaperName || "Свои обои")}${sizeSuffix(options.wallpaperSizeText)}`
      : "Свои обои пока не загружены. Кнопка «Свои» откроет выбор файла.";
    const desktopIconInfo = options.hasDesktopIcon
      ? `Загружено: ${escapeHtml(options.desktopIconName || "Иконка рабочего стола")}${sizeSuffix(options.desktopIconSizeText)}`
      : "Своя иконка пока не загружена.";
    const system = normalizeSystemSettings(options.systemSettings);
    const notifications = system.notifications;
    const accessibility = system.accessibility;
    const startup = system.startup;
    const storage = options.storage || {};
    const appearance = window.ZETER_VISUAL_UTILS?.normalizeDesktopAppearance?.(options.desktopAppearance) || {};
    const notificationDisabled = !notifications.enabled;
    const quietDisabled = notificationDisabled || !notifications.quietHoursEnabled;
    const desktopOptions = [
      `<option value="last"${selected(startup.desktop, "last")}>Последний открытый рабочий стол</option>`,
      ...(options.desktopOptions || []).map(desktop => `<option value="${escapeHtml(desktop.id)}"${selected(startup.desktop, desktop.id)}>${escapeHtml(desktop.name || desktop.id)}</option>`)
    ].join("");

    const activeSection = SETTINGS_SECTIONS.find(section => section.id === options.activeSection) || SETTINGS_SECTIONS[0];
    return `
      <div class="settings-shell"><div class="settings-layout">
      <aside class="settings-sidebar">
        <div class="settings-brand"><span class="settings-eyebrow">ZETER OS</span><h2>Настройки</h2><p>Всё на своём месте</p></div>
        <label class="settings-search"><span>Найти параметр</span><input data-settings-search type="search" placeholder="Название или действие…" autocomplete="off" aria-label="Поиск по настройкам"></label>
        <nav class="settings-nav" aria-label="Разделы настроек">${SETTINGS_SECTIONS.map(section => `<button type="button" data-settings-section="${section.id}" aria-pressed="${section.id === activeSection.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${section.icon}"/></svg><span><b>${section.title}</b><small>${section.note}</small></span></button>`).join("")}</nav>
        <p class="settings-sidebar-note">Изменения сохраняются автоматически</p>
      </aside>
      <div class="settings-content">
        <div data-settings-search-results class="settings-search-results" role="region" aria-label="Результаты поиска" hidden></div>
        <header class="settings-page-heading"><div><span class="settings-eyebrow">ПАРАМЕТРЫ СИСТЕМЫ</span><h2 data-settings-title>${activeSection.title}</h2><p data-settings-description>${activeSection.description}</p></div><button type="button" class="settings-link-button" data-settings-reset>Вернуть стандартные</button></header>
        <div class="settings-save-status" data-settings-save-status role="status" aria-live="polite"><div><b data-settings-save-text>Изменения сохраняются автоматически</b><small data-settings-save-detail></small></div><div class="settings-actions"><button type="button" data-settings-retry hidden>Повторить</button><button type="button" data-settings-discard hidden>Отменить несохранённое</button></div></div>
        <div data-settings-reset-confirm class="settings-reset-confirm" role="group" aria-label="Подтверждение сброса параметров" hidden><b>Вернуть стандартные параметры этого раздела?</b><p>Файлы, профиль стола и загруженные изображения сохранятся. Автозапуск Windows не изменится.</p><div class="settings-actions"><button type="button" data-settings-reset-yes>Вернуть стандартные</button><button type="button" data-settings-reset-no>Отмена</button></div></div>
        <div class="settings-panels">
      <section class="setting-card settings-windows-card" data-settings-panel="appearance">
        <h3>Окна приложений</h3>
        <label class="settings-field"><span>Размер новых окон приложений</span><select data-system-setting="windows.openingSize">${systemSettingsUtils.WINDOW_SIZE_PRESETS.map(preset => `<option value="${preset.id}"${selected(system.windows.openingSize, preset.id)}>${escapeHtml(preset.label)}</option>`).join("")}</select></label>
        <label class="settings-field"><span>Размещение новых окон</span><select data-system-setting="windows.placement"><option value="center"${selected(system.windows.placement, "center")}>По центру</option><option value="cascade"${selected(system.windows.placement, "cascade")}>Каскадом</option><option value="last"${selected(system.windows.placement, "last")}>Последнее положение приложения</option></select></label>
        <p class="settings-help-note">Выбери размер — окно «Настройки» сразу примет его. Размер зависит от рабочей области. Выбор применяется к новым окнам; восстановленные окна сохраняют свой размер. На узком экране окно занимает всю доступную ширину.</p>
      </section>
      <section class="setting-card desktop-profile-card" data-settings-panel="appearance">
        <h3>Рабочий стол</h3>
        <div class="desktop-profile-head">${options.desktopAvatarHTML || ""}<div><p><b>${escapeHtml(desktopTitle)}</b></p><p class="muted">${escapeHtml(desktopDescription)}</p></div></div>
        <div class="desktop-profile-form">
          <label class="settings-field settings-field-inline"><span>Название</span><input data-desktop-name type="text" maxlength="80" value="${escapeHtml(options.desktopNameValue || desktopTitle)}" placeholder="Название рабочего стола"></label>
          <label class="settings-field settings-field-inline settings-field-textarea"><span>Описание</span><textarea data-desktop-description maxlength="520" rows="3" placeholder="Описание рабочего стола">${escapeHtml(desktopDescription)}</textarea></label>
          <div class="settings-field settings-field-inline desktop-icon-field"><span>Иконка</span><div class="desktop-icon-control"><small>${desktopIconInfo}</small><div class="custom-wallpaper-actions compact-actions"><button data-desktop-icon-upload>Загрузить иконку</button>${options.hasDesktopIcon ? "<button data-desktop-icon-clear>Удалить иконку</button>" : ""}</div></div></div>
        </div>
        <small class="desktop-profile-save-note">Профиль сохраняется вместе с данными ОС и входит в ZIP-бэкап.</small>
        <input data-desktop-icon-file type="file" accept="image/*" hidden>
      </section>
      <section class="setting-card settings-icons-card" data-settings-panel="appearance">
        <h3>Значки рабочего стола</h3>
        <label class="settings-field"><span>Размер значков</span><select data-desktop-appearance="iconSize"><option value="small"${selected(appearance.iconSize || "medium", "small")}>Маленькие</option><option value="medium"${selected(appearance.iconSize || "medium", "medium")}>Средние</option><option value="large"${selected(appearance.iconSize || "medium", "large")}>Крупные</option></select></label>
        <label class="settings-field"><span>Расстояние между значками</span><select data-desktop-appearance="density"><option value="compact"${selected(appearance.density || "compact", "compact")}>Компактно</option><option value="comfortable"${selected(appearance.density || "compact", "comfortable")}>Свободно</option></select></label>
        <label class="settings-field"><span>Размер подписей значков</span><select data-desktop-appearance="labelSize"><option value="small"${selected(appearance.labelSize, "small")}>Мелкий — 10 px</option><option value="medium"${selected(appearance.labelSize || "medium", "medium")}>Обычный — 12 px</option><option value="large"${selected(appearance.labelSize, "large")}>Крупный — 14 px</option></select></label>
        <label class="settings-field"><span>Количество строк в подписи</span><select data-desktop-appearance="labelLines">${[0, 1, 2, 3].map(value => `<option value="${value}"${selected(appearance.labelLines || 0, value)}>${value ? value + (value === 1 ? " строка" : " строки") : "Показывать целиком"}</option>`).join("")}</select></label>
        <label class="settings-field"><span>Открытие значков</span><select data-desktop-appearance="openMode"><option value="double"${selected(appearance.openMode || "double", "double")}>Двойным щелчком</option><option value="single"${selected(appearance.openMode, "single")}>Одним щелчком</option></select></label>
        <label class="settings-toggle"><input data-desktop-appearance="extensions" type="checkbox"${checked(appearance.extensions !== false)}><span><b>Показывать расширения файлов</b><small>Меняется только подпись значка. Имя файла сохраняется.</small></span></label>
        <p class="settings-help-note">Настройки действуют на текущем рабочем столе. При увеличении значков или расстояния соседние элементы сдвигаются, чтобы подписи не перекрывались.</p>
        <div class="settings-example"><span class="settings-eyebrow">ПРИМЕР ПОДПИСИ</span><div class="desktop-icon settings-icon-example" data-settings-icon-preview><span class="emoji" aria-hidden="true">📄</span><span class="label">План большого проекта и заметки.txt</span></div><small>Предпросмотр меняется сразу. Рабочий стол обновится после сохранения.</small></div>
      </section>
      <section class="setting-card settings-accent-card" data-settings-panel="appearance"><h3>Акцентный цвет</h3><p class="settings-help-note">Цвет кнопок, выделения и фокуса на этом рабочем столе. Тёмная тема сохраняется.</p><div class="settings-accent-choices" role="group" aria-label="Акцентный цвет">${window.ZETER_VISUAL_UTILS.ACCENT_PRESETS.map(preset => `<button type="button" data-settings-accent="${preset.id}" aria-pressed="${(options.accent || "blue") === preset.id}"><span data-accent-swatch="${preset.id}" aria-hidden="true"></span>${preset.label}</button>`).join("")}</div><div class="settings-accent-example" data-settings-accent-preview><span class="settings-example-primary">Основное действие</span><span class="settings-example-focus">Выбранный элемент</span></div></section>
      <section class="setting-card settings-wallpaper-card" data-settings-panel="appearance">
        <div class="settings-wallpaper-demo" data-settings-preview="aurora" aria-hidden="true"><div class="settings-demo-window"><i></i><i></i><i></i><span></span><span></span></div><div class="settings-demo-dock"><i></i><i></i><i></i><i></i></div><span class="settings-preview-caption">Твой рабочий стол</span></div>
        <div class="settings-wallpaper-options"><h3>Обои и настроение</h3><p class="settings-help-note">Выбери фон — он сразу появится на рабочем столе.</p>
        <div class="choice-row settings-wallpaper-choices">${[["aurora", "Aurora"], ["silk", "Silk"], ["mint", "Mint"], ["graphite", "Graphite"], ["custom", "Свои"]].map(([id, label]) => `<button type="button" data-wall="${id}" aria-pressed="false"><span class="settings-wallpaper-swatch" data-wall-swatch="${id}" aria-hidden="true">${id === "custom" && !options.hasCustomWallpaper ? "+" : ""}</span><span>${label}</span></button>`).join("")}</div>
        <div class="custom-wallpaper-panel"><div class="custom-wallpaper-preview ${options.hasCustomWallpaper ? "has-image" : ""}"${options.hasCustomWallpaper ? "" : " hidden"}></div><small>${wallpaperInfo}<br>Изображение сохраняется вместе с данными ОС.</small><div class="custom-wallpaper-actions"><button data-wall-upload>Загрузить свои обои</button>${options.hasCustomWallpaper ? "<button data-wall-clear>Удалить свои обои</button>" : ""}</div><input data-wall-file type="file" accept="image/*" hidden></div></div>
      </section>

      <section class="setting-card settings-data-card" data-settings-panel="storage">
        <div class="setting-card-heading"><h3>Сохранение и данные</h3><span class="settings-status ${escapeHtml(storage.statusTone || "neutral")}">${escapeHtml(storage.status || "")}</span></div>
        <p class="muted">ZeTer OS сохраняет изменения автоматически. Здесь можно проверить место хранения и выполнить запись немедленно.</p>
        <dl class="settings-kv"><div><dt>Хранилище</dt><dd>${escapeHtml(storage.mode || "—")}</dd></div><div><dt>Путь</dt><dd>${escapeHtml(storage.path || "—")}</dd></div><div><dt>Последнее сохранение</dt><dd>${escapeHtml(storage.lastSavedText || "—")}</dd></div><div><dt>Объём состояния</dt><dd>${escapeHtml(storage.stateSizeText || "—")}</dd></div></dl>
        <p class="settings-error" data-storage-error${storage.lastError ? "" : " hidden"}>${storage.lastError ? `Последняя ошибка: ${escapeHtml(storage.lastError)}` : ""}</p>
        <div class="settings-actions"><button data-storage-save>Сохранить сейчас</button>${storage.canOpenDataFolder ? "<button data-storage-open-folder>Открыть папку data</button>" : ""}<button data-storage-security>Центр безопасности</button></div>
      </section>

      <section class="setting-card settings-notification-card" data-settings-panel="notifications">
        <h3>Уведомления</h3>
        <label class="settings-field"><span>Длительность всплывающих сообщений</span><select data-system-setting="notifications.popupDuration">${systemSettingsUtils.POPUP_DURATION_VALUES.map(value => `<option value="${value}"${selected(notifications.popupDuration, value)}>${value === 3500 ? "3,5 секунды — стандартно" : value / 1000 + " секунд"}</option>`).join("")}</select></label>
        ${settingsToggleHTML("notifications.enabled", "Разрешить уведомления", "Главный выключатель новых уведомлений", notifications.enabled)}
        <div class="settings-toggle-group">
          ${settingsToggleHTML("notifications.tasks", "Задачи", "Сроки и настроенные напоминания", notifications.tasks, notificationDisabled)}
          ${settingsToggleHTML("notifications.calendar", "Календарь", "Напоминания перед событиями", notifications.calendar, notificationDisabled)}
          ${settingsToggleHTML("notifications.system", "Системные сообщения", "Важные сообщения ZeTer OS", notifications.system, notificationDisabled)}
        </div>
        ${settingsToggleHTML("notifications.quietHoursEnabled", "Не беспокоить по расписанию", "Уведомления сохраняются в центре, но всплывающее сообщение не показывается", notifications.quietHoursEnabled, notificationDisabled)}
        <div class="settings-time-row"><label class="settings-field"><span>С</span><input data-system-setting="notifications.quietFrom" type="time" value="${escapeHtml(notifications.quietFrom)}"${quietDisabled ? " disabled" : ""}></label><label class="settings-field"><span>До</span><input data-system-setting="notifications.quietTo" type="time" value="${escapeHtml(notifications.quietTo)}"${quietDisabled ? " disabled" : ""}></label></div>
      </section>

      <section class="setting-card" data-settings-panel="startup">
        <h3>Запуск и восстановление окон</h3>
        ${windowsStartupToggleHTML(options.windowsStartupAvailable)}
        ${settingsToggleHTML("startup.restoreWindows", "Восстанавливать открытые окна", "При следующем запуске вернуть приложения текущего рабочего стола", startup.restoreWindows)}
        <label class="settings-field"><span>Рабочий стол после запуска</span><select data-system-setting="startup.desktop">${desktopOptions}</select></label>
        <label class="settings-field"><span>Окно ZeTer OS после запуска</span><select data-system-setting="startup.windowMode"><option value="maximized"${selected(startup.windowMode, "maximized")}>Развёрнуто на весь экран</option><option value="windowed"${selected(startup.windowMode, "windowed")}>Обычное окно 1320 × 840</option></select></label>
        <small class="settings-help-note">Стартовый рабочий стол и размер внешнего окна применяются при следующем запуске ZeTer OS.</small>
      </section>

      <section class="setting-card" data-settings-panel="accessibility">
        <h3>Интерфейс и доступность</h3>
        <label class="settings-field"><span>Размер текста</span><select data-system-setting="accessibility.textScale">${systemSettingsUtils.TEXT_SCALE_VALUES.map(value => `<option value="${value}"${selected(accessibility.textScale, value)}>${value}%</option>`).join("")}</select></label>
        <div class="settings-example settings-text-example"><span class="settings-eyebrow">ПРИМЕР ТЕКСТА</span><p>Удобно читать и работать</p><span class="settings-example-primary">Пример кнопки</span><small>Это предпросмотр. Масштаб интерфейса применится после сохранения.</small></div>
        <div class="settings-toggle-group">
          ${settingsToggleHTML("accessibility.largeControls", "Крупные элементы управления", "Увеличить кнопки и поля внутри приложений", accessibility.largeControls)}
          ${settingsToggleHTML("accessibility.highContrast", "Повышенный контраст", "Сделать текст, границы и фокус заметнее", accessibility.highContrast)}
          ${settingsToggleHTML("accessibility.reducedMotion", "Уменьшить анимацию", "Почти мгновенные переходы и раскрытия", accessibility.reducedMotion)}
        </div>
      </section>

      <section class="setting-card" data-settings-panel="time"><h3>Часы и дата</h3><label class="settings-field"><span>Формат времени</span><select data-system-setting="clock.format"><option value="24h"${selected(system.clock.format, "24h")}>24 часа</option><option value="12h"${selected(system.clock.format, "12h")}>12 часов — AM/PM</option></select></label>${settingsToggleHTML("clock.showSeconds", "Показывать секунды", "В часах на нижней панели", system.clock.showSeconds)}${settingsToggleHTML("clock.showDate", "Показывать дату", "Под часами на нижней панели", system.clock.showDate)}<div class="settings-example"><span class="settings-eyebrow">ПРИМЕР ЧАСОВ</span><b data-settings-clock-preview></b></div><h3>Календарь</h3><label class="settings-field"><span>Первый день недели</span><select data-system-setting="calendar.weekStart"><option value="monday"${selected(system.calendar.weekStart, "monday")}>Понедельник</option><option value="sunday"${selected(system.calendar.weekStart, "sunday")}>Воскресенье</option></select></label><p class="settings-help-note">Меняет порядок дней в месяце и неделе календаря. Даты событий сохраняются.</p></section>

      <section class="setting-card hotkey-settings-card" data-settings-panel="hotkeys">
        <div class="setting-card-heading"><h3>Настраиваемые горячие клавиши</h3><button type="button" class="settings-link-button" data-hotkeys-reset>Сбросить</button></div>
        <p class="muted">Нажми «Изменить», затем новое сочетание. Системные и конфликтующие сочетания не принимаются.</p>
        <div class="hotkey-settings-list">${hotkeyRowsHTML(options)}</div>
        <small class="settings-help-note">Alt+Tab переключает окна, Ctrl+Z отменяет действие, Delete удаляет выбранный значок. Эти безопасные системные действия не переназначаются.</small>
      </section></div></div></div></div>`;
  }

  function settingsAppElement(options = {}) {
    const {
      winId = "", getSettings = () => ({}), getSystemSettings = () => ({}), getDesktopRecord = () => ({}),
      getDesktopRoot = () => "desktop", getDesktopOptions = () => [], getStorageSummary = () => ({}),
      desktopName = () => "Рабочий стол", desktopDescription = () => "", desktopAvatarHTML = () => "", formatBytes = value => String(value || ""),
      toast = () => {}, openSecurity = () => {}, openDataFolder = async () => {}, windowsStartupAvailable = false,
      getWindowsStartupStatus = async () => ({ supported: false }), setWindowsStartupEnabled = async () => ({ supported: false }),
      createCustomWallpaperFromFile = async () => null, createDesktopIconFromFile = async () => null
    } = options;
    const getModels = options.getModels || (() => ({ settings: getSettings(), systemSettings: getSystemSettings(), desktop: getDesktopRecord() }));
    const session = options.preferencesSession || {};
    session.assetListeners ||= new Set();
    session.pendingAssets ||= {};
    const notifyAssets = () => {
      session.assetPending = Object.keys(session.pendingAssets).length;
      for (const listener of session.assetListeners) listener();
    };
    const cancelAsset = kind => {
      const key = kind === "wallpaper" ? "wallpaperGeneration" : "iconGeneration";
      session[key] = (session[key] || 0) + 1;
      delete session.pendingAssets[kind];
      notifyAssets();
    };
    const writer = options.preferencesWriter || window.ZETER_PREFERENCES_WRITER_UTILS.createPreferencesWriter({
      keys: SETTINGS_PREFERENCE_KEYS, getPreferences: () => settingsPreferences(getModels()), requireAck: true,
      save: async patch => { const result = await options.savePreferences?.(patch); if (result?.saved === true) options.onPreferencesSaved?.(patch, result); return result; }
    });
    const root = document.createElement("div");
    root.className = "settings"; root.dataset.settingsRoot = "";
    let pendingHotkeyAction = "", currentSection = options.activeSection || "appearance";
    const models = () => applySettingsPreferencePatch(getModels(), writer.getState().patch);
    const initial = models();
    let renderedAvatarHTML = desktopAvatarHTML(getDesktopRoot(), true, initial.desktop);
    root.innerHTML = settingsAppHTML(settingsAppViewModel({
      desktopAvatarHTML: renderedAvatarHTML, desktopTitle: initial.desktop.name || desktopName(getDesktopRoot()),
      desktopDescription: initial.desktop.description || desktopDescription(getDesktopRoot()), desktopNameValue: initial.desktop.name,
      desktopIcon: initial.desktop.icon, desktopAppearance: initial.settings.desktopAppearance, accent: initial.settings.accent,
      wallpaper: initial.settings.customWallpaper, systemSettings: initial.systemSettings, windowsStartupAvailable,
      desktopOptions: getDesktopOptions(), hotkeyDefinitions: HOTKEY_DEFINITIONS, storage: getStorageSummary(), formatBytes
    }));
    const controlKey = control => control.dataset.systemSetting ? "system." + control.dataset.systemSetting
      : control.dataset.desktopAppearance ? "desktop.desktopAppearance." + control.dataset.desktopAppearance
      : control.matches("[data-desktop-name]") ? "profile.name" : control.matches("[data-desktop-description]") ? "profile.description"
      : control.dataset.settingsAccent ? "desktop.accent" : control.matches("[data-wall-upload]") ? "desktop.customWallpaper"
      : control.dataset.wall ? "desktop.wallpaper"
      : control.dataset.hotkeyCapture ? "system.hotkeys." + control.dataset.hotkeyCapture
      : control.matches("[data-desktop-icon-upload]") ? "profile.icon" : control.matches("[data-windows-startup]") ? "windows.autorun"
      : control.matches("[data-storage-save]") ? "action.storageSave" : control.matches("[data-storage-open-folder]") ? "action.storageFolder" : control.matches("[data-storage-security]") ? "action.storageSecurity" : "";
    const controls = () => $$("[data-system-setting], [data-desktop-appearance], [data-desktop-name], [data-desktop-description]", root);
    const showSection = (id, remember = true) => {
      const section = SETTINGS_SECTIONS.find(item => item.id === id) || SETTINGS_SECTIONS[0];
      currentSection = section.id;
      $$("[data-settings-section]", root).forEach(button => button.setAttribute("aria-pressed", String(button.dataset.settingsSection === section.id)));
      $$("[data-settings-panel]", root).forEach(panel => { panel.hidden = panel.dataset.settingsPanel !== section.id; });
      $("[data-settings-title]", root).textContent = section.title;
      $("[data-settings-description]", root).textContent = section.description;
      $("[data-settings-reset]", root).hidden = section.id === "storage";
      $("[data-settings-reset-confirm]", root).hidden = true;
      if (remember) { const body = root.closest?.(".window-body"); if (body) body.scrollTop = 0; options.onSectionChange?.(section.id); }
    };
    for (const panel of $$("[data-settings-panel]", root)) {
      const scope = document.createElement("span"); scope.className = "settings-scope";
      scope.textContent = panel.dataset.settingsPanel === "appearance" && !panel.classList.contains("settings-windows-card") ? "Текущий рабочий стол" : panel.dataset.settingsPanel === "storage" ? "На этом устройстве" : "Вся ZeTer OS";
      panel.prepend(scope);
    }
    const startupRow = $("[data-windows-startup-row] span", root);
    if (startupRow) { const scope = document.createElement("small"); scope.className = "settings-scope"; scope.textContent = "Windows · текущий пользователь"; startupRow.prepend(scope); }
    const setQuery = value => { $("[data-settings-search]", root).value = value; options.onSearchChange?.(value); };
    const normalizeQuery = value => String(value || "").toLocaleLowerCase("ru-RU").replaceAll("ё", "е").trim();
    const searchEntries = [];
    const aliases = { "system.windows.openingSize": "размер окна предпросмотр", "system.windows.placement": "положение центр каскад запомнить", "desktop.accent": "акцент цвет кнопки выделение синий фиолетовый изумрудный розовый янтарный", "desktop.desktopAppearance.labelSize": "шрифт название размер подпись", "desktop.desktopAppearance.labelLines": "длинное имя строки обрезка", "desktop.desktopAppearance.openMode": "один двойной щелчок клик", "system.notifications.popupDuration": "время длительность сообщение", "system.accessibility.textScale": "шрифт масштаб текст 150 увеличение", "system.calendar.weekStart": "начало недели воскресенье понедельник", "system.clock.format": "часы время 12 24 формат", "profile.icon": "загрузить изображение иконка", "desktop.customWallpaper": "загрузить свои обои фон" };
    for (const control of $$("[data-system-setting], [data-desktop-appearance], [data-desktop-name], [data-desktop-description], [data-settings-accent], [data-wall], [data-wall-upload], [data-desktop-icon-upload], [data-windows-startup], [data-hotkey-capture], [data-storage-save], [data-storage-open-folder], [data-storage-security]", root)) {
      const key = controlKey(control), panel = control.closest("[data-settings-panel]");
      if (!key || !panel || searchEntries.some(entry => entry.key === key)) continue;
      const label = control.closest("label");
      const title = control.dataset.hotkeyCapture ? HOTKEY_DEFINITIONS.find(item => item.id === control.dataset.hotkeyCapture)?.label || "Горячая клавиша" : control.dataset.wall ? "Обои рабочего стола" : control.dataset.settingsAccent ? "Акцентный цвет" : label?.querySelector("b, span")?.textContent || control.textContent || "Параметр";
      const section = SETTINGS_SECTIONS.find(item => item.id === panel.dataset.settingsPanel);
      searchEntries.push({ key, control, section, title: title.trim(), text: normalizeQuery(title + " " + (label?.textContent || "") + " " + section.title + " " + (aliases[key] || "")) });
    }
    const drawSearch = () => {
      const query = normalizeQuery($("[data-settings-search]", root).value), results = $("[data-settings-search-results]", root);
      results.hidden = !query;
      if (!query) { results.innerHTML = ""; return; }
      const terms = query.split(/\s+/), found = searchEntries.filter(entry => terms.every(term => entry.text.includes(term)));
      results.innerHTML = `<p>${found.length ? "Найдено параметров: " + found.length : "Ничего не найдено. Попробуй другое название."}</p>` + found.map(entry => `<button type="button" data-settings-search-result="${escapeHtml(entry.key)}"><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.section.title)}</small></button>`).join("");
    };
    const goToResult = key => {
      const entry = searchEntries.find(item => item.key === key); if (!entry) return;
      pendingHotkeyAction = ""; showSection(entry.section.id); setQuery(""); drawSearch();
      entry.control.focus(); entry.control.scrollIntoView({ block: "center" });
      entry.control.classList.add("settings-found-control");
      entry.control.addEventListener("blur", () => entry.control.classList.remove("settings-found-control"), { once: true });
    };
    const render = () => {
      const state = writer.getState(), model = models(), preferences = settingsPreferences(model);
      for (const control of controls()) {
        const value = preferences[controlKey(control)];
        if (control.type === "checkbox") control.checked = Boolean(value);
        else if (control.value !== String(value ?? "")) control.value = String(value ?? "");
        const path = control.dataset.systemSetting || "";
        if (path.startsWith("notifications.") && !["notifications.enabled", "notifications.popupDuration"].includes(path)) control.disabled = !model.systemSettings.notifications.enabled || (/quiet(From|To)$/.test(path) && !model.systemSettings.notifications.quietHoursEnabled);
        const label = control.closest(".settings-toggle"); if (label) label.classList.toggle("is-disabled", control.disabled);
      }
      syncSettingsWallpaperButtons(root, model.settings);
      updateSettingsDesktopProfileText(root, model.desktop.name || "Рабочий стол", model.desktop.description || "");
      const avatarHTML = desktopAvatarHTML(getDesktopRoot(), true, model.desktop);
      if (avatarHTML !== renderedAvatarHTML) {
        const avatar = $(".desktop-profile-head .workspace-avatar", root);
        if (avatar) avatar.outerHTML = avatarHTML;
        renderedAvatarHTML = avatarHTML;
      }
      const text = $("[data-settings-save-text]", root), detail = $("[data-settings-save-detail]", root), status = $("[data-settings-save-status]", root);
      status.dataset.saveState = state.error ? "error" : session.assetPending ? "processing" : state.pending ? "saving" : state.lastSavedAt ? (state.lastResult?.fallback ? "fallback" : "saved") : "idle";
      text.textContent = state.error ? "Изменения не сохранены" : session.assetPending ? "Подготовка изображения…" : state.pending ? "Сохраняется…" : state.lastSavedAt ? (state.lastResult?.fallback ? "Сохранено в резервном хранилище" : "Параметры сохранены") : "Изменения сохраняются автоматически";
      detail.textContent = state.error ? state.error.message || String(state.error) : state.lastSavedAt && !state.pending ? formatSettingsTime(state.lastSavedAt) : "";
      $("[data-settings-retry]", root).hidden = !state.error;
      $("[data-settings-discard]", root).hidden = !state.canDiscard;
      const preview = $("[data-settings-icon-preview]", root);
      for (const field of ["iconSize", "labelSize", "labelLines"]) preview.dataset[field] = String(model.settings.desktopAppearance[field]);
      const accent = window.ZETER_VISUAL_UTILS.ACCENT_PRESETS.find(item => item.id === model.settings.accent);
      root.style.setProperty("--settings-preview-accent", accent.color); root.style.setProperty("--settings-preview-primary", accent.primary);
      $$("[data-accent-swatch]", root).forEach(swatch => swatch.style.setProperty("--accent-swatch", window.ZETER_VISUAL_UTILS.ACCENT_PRESETS.find(item => item.id === swatch.dataset.accentSwatch).color));
      root.style.setProperty("--settings-preview-text-scale", String(model.systemSettings.accessibility.textScale / 100));
      root.style.setProperty("--custom-wallpaper-preview", window.ZETER_VISUAL_UTILS.customWallpaperCssUrl(model.settings.customWallpaper));
      $$("[data-settings-accent]", root).forEach(button => button.setAttribute("aria-pressed", String(button.dataset.settingsAccent === accent.id)));
      $("[data-settings-clock-preview]", root).textContent = window.ZETER_SHELL_UI_UTILS?.clockViewModel(model.systemSettings.clock).time || "";
      const image = model.settings.customWallpaper, wallpaperPreview = $(".custom-wallpaper-preview", root);
      wallpaperPreview.hidden = !image?.dataURL; wallpaperPreview.classList.toggle("has-image", Boolean(image?.dataURL));
      const updateAsset = (value, container, selector, text, clearText) => {
        const control = $(container, root); if (!control) return;
        const info = $("small", control); if (info) info.textContent = value ? `Загружено: ${value.name || text}${value.size ? " · " + formatBytes(value.size) : ""}` : text;
        let clear = $(selector, control);
        if (value && !clear) { clear = document.createElement("button"); clear.type = "button"; clear.setAttribute(selector.slice(1, -1), ""); clear.textContent = clearText; $(".custom-wallpaper-actions", control).appendChild(clear); }
        if (clear) clear.hidden = !value;
      };
      updateAsset(image, ".custom-wallpaper-panel", "[data-wall-clear]", "Свои обои не загружены. Изображение сохраняется вместе с данными ОС.", "Удалить свои обои");
      updateAsset(model.desktop.icon, ".desktop-icon-control", "[data-desktop-icon-clear]", "Своя иконка пока не загружена.", "Удалить иконку");
      for (const button of $$("[data-hotkey-capture]", root)) { const capturing = pendingHotkeyAction === button.dataset.hotkeyCapture; button.classList.toggle("capturing", capturing); $("kbd", button).textContent = capturing ? "Нажми сочетание…" : hotkeyDisplay(model.systemSettings.hotkeys[button.dataset.hotkeyCapture] || ""); }
      const summary = settingsAppViewModel({ storage: getStorageSummary(), formatBytes }).storage;
      const values = [summary.mode, summary.path, summary.lastSavedText, summary.stateSizeText];
      $$(".settings-data-card dd", root).forEach((node, index) => { node.textContent = values[index] || "—"; });
      const badge = $(".settings-data-card .settings-status", root);
      badge.textContent = summary.status; badge.className = "settings-status " + summary.statusTone;
      const storageError = $("[data-storage-error]", root); storageError.hidden = !summary.lastError; storageError.textContent = summary.lastError ? "Последняя ошибка: " + summary.lastError : "";
    };
    const change = patch => writer.update(patch);
    const refreshWindowsStartup = async () => {
      if (!windowsStartupAvailable) { syncWindowsStartupControls(root, windowsStartupView()); return; }
      syncWindowsStartupControls(root, windowsStartupView({ supported: true }, true));
      try { syncWindowsStartupControls(root, windowsStartupView(await getWindowsStartupStatus())); }
      catch (error) { syncWindowsStartupControls(root, windowsStartupView({ supported: true }, false, error?.message || String(error))); }
    };
    root.addEventListener("input", event => {
      if (event.target.matches("[data-settings-search]")) { options.onSearchChange?.(event.target.value); drawSearch(); return; }
      const action = settingsInputAction(event.target);
      if (action) change({ [action.type === "desktop-name" ? "profile.name" : "profile.description"]: action.value });
    });
    root.addEventListener("focusout", event => {
      if (pendingHotkeyAction && event.target.matches("[data-hotkey-capture]")) { pendingHotkeyAction = ""; render(); }
    });
    root.addEventListener("click", async event => {
      const target = event.target;
      const navigation = target.closest("[data-settings-section]");
      if (navigation) { pendingHotkeyAction = ""; showSection(navigation.dataset.settingsSection); setQuery(""); drawSearch(); render(); return; }
      const result = target.closest("[data-settings-search-result]"); if (result) { goToResult(result.dataset.settingsSearchResult); render(); return; }
      if (target.closest("[data-settings-retry]")) { writer.retry(); return; }
      if (target.closest("[data-settings-discard]")) {
        if (writer.discard()) { cancelAsset("wallpaper"); cancelAsset("icon"); }
        return;
      }
      if (target.closest("[data-settings-reset]")) { $("[data-settings-reset-confirm]", root).hidden = false; $("[data-settings-reset-yes]", root).focus(); return; }
      if (target.closest("[data-settings-reset-no]")) { $("[data-settings-reset-confirm]", root).hidden = true; $("[data-settings-reset]", root).focus(); return; }
      if (target.closest("[data-settings-reset-yes]")) {
        pendingHotkeyAction = "";
        if (currentSection === "appearance") session.wallpaperSelectionRevision = (session.wallpaperSelectionRevision || 0) + 1;
        change(settingsResetPatch(currentSection)); $("[data-settings-reset-confirm]", root).hidden = true; $("[data-settings-reset]", root).focus(); return;
      }
      const accent = target.closest("[data-settings-accent]"); if (accent) { change({ "desktop.accent": accent.dataset.settingsAccent }); return; }
      const action = settingsClickAction(target); if (!action) return;
      const model = models();
      if (action.type === "select-wallpaper") {
        if (action.wall === "custom" && !model.settings.customWallpaper) $("[data-wall-file]", root).click();
        else {
          session.wallpaperSelectionRevision = (session.wallpaperSelectionRevision || 0) + 1;
          change({ "desktop.wallpaper": action.wall });
        }
      }
      if (action.type === "upload-wallpaper") $("[data-wall-file]", root).click();
      if (action.type === "upload-desktop-icon") $("[data-desktop-icon-file]", root).click();
      if (action.type === "clear-wallpaper") { cancelAsset("wallpaper"); change({ "desktop.customWallpaper": null, ...(model.settings.wallpaper === "custom" ? { "desktop.wallpaper": "aurora" } : {}) }); }
      if (action.type === "clear-desktop-icon") { cancelAsset("icon"); change({ "profile.icon": null }); }
      if (action.type === "save-now") {
        if (writer.getState().dirty) writer.retry();
        else try { const result = await options.saveState?.(); if (result?.saved !== true) throw new Error("Хранилище не подтвердило запись"); toast(result.fallback ? "Данные записаны в резервное хранилище" : "Данные сохранены"); } catch (error) { toast("Сохранение не завершено", error?.message || String(error)); }
        render();
      }
      if (action.type === "open-data-folder") try { await openDataFolder(); } catch (error) { toast("Не удалось открыть папку data", error?.message || String(error)); }
      if (action.type === "open-security") openSecurity();
      if (action.type === "capture-hotkey") { pendingHotkeyAction = action.actionId; render(); }
      if (action.type === "clear-hotkey") { pendingHotkeyAction = ""; change({ [`system.hotkeys.${action.actionId}`]: "" }); }
      if (action.type === "reset-hotkeys") { pendingHotkeyAction = ""; change(settingsResetPatch("hotkeys")); }
    });
    root.addEventListener("keydown", event => {
      if (pendingHotkeyAction) {
        if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) { pendingHotkeyAction = ""; render(); return; }
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Escape") { pendingHotkeyAction = ""; render(); return; }
        const value = keyboardEventHotkey(event); if (!value) return;
        if (!isHotkeyAssignable(value)) { toast("Сочетание недоступно", "Используй Ctrl или Alt вместе с другой клавишей."); return; }
        const conflict = hotkeyConflict(pendingHotkeyAction, value, models().systemSettings);
        if (conflict) { toast("Сочетание уже используется", conflict.label); return; }
        change({ [`system.hotkeys.${pendingHotkeyAction}`]: value }); pendingHotkeyAction = ""; render(); return;
      }
      if (event.target.matches("[data-settings-search]")) {
        if (event.key === "Escape") { event.stopPropagation(); setQuery(""); drawSearch(); }
        if (event.key === "Enter") { event.preventDefault(); const first = $("[data-settings-search-result]", root); if (first) goToResult(first.dataset.settingsSearchResult); }
      }
      if (event.key === "Escape" && !$("[data-settings-reset-confirm]", root).hidden) { event.stopPropagation(); $("[data-settings-reset-confirm]", root).hidden = true; $("[data-settings-reset]", root).focus(); }
    }, true);
    root.addEventListener("change", async event => {
      const action = settingsChangeAction(event.target); if (!action) return;
      if (action.type === "system-setting") { change({ [`system.${action.path}`]: action.value }); return; }
      if (action.type === "desktop-appearance") { change({ [`desktop.desktopAppearance.${action.field}`]: action.value }); return; }
      if (action.type === "windows-startup") {
        syncWindowsStartupControls(root, windowsStartupView({ supported: true, enabled: action.enabled }, true));
        try { const result = await setWindowsStartupEnabled(action.enabled); if (!result?.supported) throw new Error("Автозапуск недоступен"); syncWindowsStartupControls(root, windowsStartupView(result)); }
        catch (error) { toast("Не удалось изменить автозапуск", error?.message || String(error)); await refreshWindowsStartup(); }
        return;
      }
      const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
      const wallpaper = action.type === "wallpaper-file", key = wallpaper ? "wallpaperGeneration" : "iconGeneration";
      const generation = session[key] = (session[key] || 0) + 1;
      const kind = wallpaper ? "wallpaper" : "icon", selectionRevision = session.wallpaperSelectionRevision || 0;
      session.pendingAssets[kind] = generation; notifyAssets();
      try {
        const image = await (wallpaper ? createCustomWallpaperFromFile(file) : createDesktopIconFromFile(file));
        if (session[key] !== generation) return;
        if (!image?.dataURL) throw new Error("Не удалось подготовить изображение");
        // Keep a completed image, but never replace a later explicit wallpaper choice/reset.
        change(wallpaper ? { "desktop.customWallpaper": image, ...((session.wallpaperSelectionRevision || 0) === selectionRevision ? { "desktop.wallpaper": "custom" } : {}) } : { "profile.icon": image });
      } catch (error) { if (session[key] === generation) toast("Изображение не загружено", error?.message || String(error)); }
      finally { if (session.pendingAssets[kind] === generation) { delete session.pendingAssets[kind]; notifyAssets(); } }
    });
    const unsubscribeWriter = writer.subscribe(render);
    session.assetListeners.add(render);
    root.disposeSettingsView = () => { unsubscribeWriter(); session.assetListeners.delete(render); };
    showSection(currentSection, false); setQuery(options.searchQuery || ""); drawSearch(); render(); void refreshWindowsStartup();
    return root;
  }

  window.ZETER_SETTINGS_UI_UTILS = Object.freeze({
    SETTINGS_PREFERENCE_KEYS,
    settingsPreferences,
    applySettingsPreferencePatch,
    settingsResetPatch,
    SYSTEM_SETTING_PATHS,
    settingsAppViewModel,
    activeSettingsWallpaper,
    settingsClickAction,
    settingsChangeAction,
    applySystemSetting,
    settingsInputAction,
    syncSettingsWallpaperButtons,
    updateSettingsDesktopProfileText,
    normalizeDesktopProfileName,
    normalizeDesktopProfileDescription,
    settingsToggleHTML,
    windowsStartupView,
    windowsStartupToggleHTML,
    syncWindowsStartupControls,
    hotkeyRowsHTML,
    settingsAppHTML,
    settingsAppElement
  });
})();
