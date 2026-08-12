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
  const developer = config.DEVELOPER || {};
  const SYSTEM_SETTING_PATHS = new Set([
    "startup.restoreWindows",
    "startup.desktop",
    "startup.windowMode",
    "notifications.enabled",
    "notifications.tasks",
    "notifications.calendar",
    "notifications.system",
    "notifications.quietHoursEnabled",
    "notifications.quietFrom",
    "notifications.quietTo",
    "accessibility.textScale",
    "accessibility.largeControls",
    "accessibility.highContrast",
    "accessibility.reducedMotion"
  ]);

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
      hasCustomWallpaper: Boolean(wallpaper?.dataURL),
      wallpaperName: wallpaper?.name,
      wallpaperSizeText: wallpaper?.size ? formatBytes(wallpaper.size) : "",
      osVersion: options.osVersion || "",
      developerName: options.developerName || developer.name || "",
      developerEmail: options.developerEmail || developer.email || "",
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
    $$('[data-wall]', root).forEach(button => button.classList.toggle("active", button.dataset.wall === activeWallpaper));
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
    const system = options.systemSettings || normalizeSystemSettings();
    const notifications = system.notifications;
    const accessibility = system.accessibility;
    const startup = system.startup;
    const storage = options.storage || {};
    const notificationDisabled = !notifications.enabled;
    const quietDisabled = notificationDisabled || !notifications.quietHoursEnabled;
    const desktopOptions = [
      `<option value="last"${selected(startup.desktop, "last")}>Последний открытый рабочий стол</option>`,
      ...(options.desktopOptions || []).map(desktop => `<option value="${escapeHtml(desktop.id)}"${selected(startup.desktop, desktop.id)}>${escapeHtml(desktop.name || desktop.id)}</option>`)
    ].join("");

    return `
      <section class="setting-card desktop-profile-card">
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
      <section class="setting-card"><h3>Обои</h3><div class="choice-row"><button data-wall="aurora">Aurora</button><button data-wall="silk">Silk</button><button data-wall="mint">Mint</button><button data-wall="graphite">Graphite</button><button data-wall="custom">Свои</button></div><div class="custom-wallpaper-panel"><div class="custom-wallpaper-preview ${options.hasCustomWallpaper ? "has-image" : ""}">${options.hasCustomWallpaper ? "" : "Предпросмотр появится после загрузки"}</div><small>${wallpaperInfo}<br>Изображение сохраняется вместе с данными ОС.</small><div class="custom-wallpaper-actions"><button data-wall-upload>Загрузить свои обои</button>${options.hasCustomWallpaper ? "<button data-wall-clear>Удалить свои обои</button>" : ""}</div><input data-wall-file type="file" accept="image/*" hidden></div></section>

      <section class="setting-card settings-data-card">
        <div class="setting-card-heading"><h3>Сохранение и данные</h3><span class="settings-status ${escapeHtml(storage.statusTone || "neutral")}">${escapeHtml(storage.status || "")}</span></div>
        <p class="muted">ZeTer OS сохраняет изменения автоматически. Здесь можно проверить место хранения и выполнить запись немедленно.</p>
        <dl class="settings-kv"><div><dt>Хранилище</dt><dd>${escapeHtml(storage.mode || "—")}</dd></div><div><dt>Путь</dt><dd>${escapeHtml(storage.path || "—")}</dd></div><div><dt>Последнее сохранение</dt><dd>${escapeHtml(storage.lastSavedText || "—")}</dd></div><div><dt>Объём состояния</dt><dd>${escapeHtml(storage.stateSizeText || "—")}</dd></div></dl>
        ${storage.lastError ? `<p class="settings-error">Последняя ошибка: ${escapeHtml(storage.lastError)}</p>` : ""}
        <div class="settings-actions"><button data-storage-save>Сохранить сейчас</button>${storage.canOpenDataFolder ? "<button data-storage-open-folder>Открыть папку data</button>" : ""}<button data-storage-security>Центр безопасности</button></div>
      </section>

      <section class="setting-card settings-notification-card">
        <h3>Уведомления</h3>
        ${settingsToggleHTML("notifications.enabled", "Разрешить уведомления", "Главный выключатель новых уведомлений", notifications.enabled)}
        <div class="settings-toggle-group">
          ${settingsToggleHTML("notifications.tasks", "Задачи", "Сроки и настроенные напоминания", notifications.tasks, notificationDisabled)}
          ${settingsToggleHTML("notifications.calendar", "Календарь", "Напоминания перед событиями", notifications.calendar, notificationDisabled)}
          ${settingsToggleHTML("notifications.system", "Системные сообщения", "Важные сообщения ZeTer OS", notifications.system, notificationDisabled)}
        </div>
        ${settingsToggleHTML("notifications.quietHoursEnabled", "Не беспокоить по расписанию", "Уведомления сохраняются в центре, но всплывающее сообщение не показывается", notifications.quietHoursEnabled, notificationDisabled)}
        <div class="settings-time-row"><label class="settings-field"><span>С</span><input data-system-setting="notifications.quietFrom" type="time" value="${escapeHtml(notifications.quietFrom)}"${quietDisabled ? " disabled" : ""}></label><label class="settings-field"><span>До</span><input data-system-setting="notifications.quietTo" type="time" value="${escapeHtml(notifications.quietTo)}"${quietDisabled ? " disabled" : ""}></label></div>
      </section>

      <section class="setting-card">
        <h3>Запуск и восстановление окон</h3>
        ${windowsStartupToggleHTML(options.windowsStartupAvailable)}
        ${settingsToggleHTML("startup.restoreWindows", "Восстанавливать открытые окна", "При следующем запуске вернуть приложения текущего рабочего стола", startup.restoreWindows)}
        <label class="settings-field"><span>Рабочий стол после запуска</span><select data-system-setting="startup.desktop">${desktopOptions}</select></label>
        <label class="settings-field"><span>Окно ZeTer OS после запуска</span><select data-system-setting="startup.windowMode"><option value="maximized"${selected(startup.windowMode, "maximized")}>Развёрнуто на весь экран</option><option value="windowed"${selected(startup.windowMode, "windowed")}>Обычное окно 1320 × 840</option></select></label>
        <small class="settings-help-note">Стартовый рабочий стол и размер внешнего окна применяются при следующем запуске ZeTer OS.</small>
      </section>

      <section class="setting-card">
        <h3>Интерфейс и доступность</h3>
        <label class="settings-field"><span>Размер текста</span><select data-system-setting="accessibility.textScale"><option value="90"${selected(accessibility.textScale, 90)}>90%</option><option value="100"${selected(accessibility.textScale, 100)}>100%</option><option value="110"${selected(accessibility.textScale, 110)}>110%</option><option value="120"${selected(accessibility.textScale, 120)}>120%</option></select></label>
        <div class="settings-toggle-group">
          ${settingsToggleHTML("accessibility.largeControls", "Крупные элементы управления", "Увеличить кнопки и поля внутри приложений", accessibility.largeControls)}
          ${settingsToggleHTML("accessibility.highContrast", "Повышенный контраст", "Сделать текст, границы и фокус заметнее", accessibility.highContrast)}
          ${settingsToggleHTML("accessibility.reducedMotion", "Уменьшить анимацию", "Почти мгновенные переходы и раскрытия", accessibility.reducedMotion)}
        </div>
      </section>

      <section class="setting-card hotkey-settings-card">
        <div class="setting-card-heading"><h3>Настраиваемые горячие клавиши</h3><button type="button" class="settings-link-button" data-hotkeys-reset>Сбросить</button></div>
        <p class="muted">Нажми «Изменить», затем новое сочетание. Системные и конфликтующие сочетания не принимаются.</p>
        <div class="hotkey-settings-list">${hotkeyRowsHTML(options)}</div>
        <small class="settings-help-note">Alt+Tab переключает окна, Ctrl+Z отменяет действие, Delete удаляет выбранный значок. Эти безопасные системные действия не переназначаются.</small>
      </section>

      <section class="setting-card"><h3>О системе</h3><p><b>ZeTer OS ${escapeHtml(options.osVersion || "")}</b></p><p class="muted">Desktop-версия ZeTer OS: интерфейс HTML/CSS/JS работает в Python-окне, а данные автоматически сохраняются в папку data рядом с программой.</p></section>
      <section class="setting-card developer-card"><h3>Разработчик</h3><div class="developer-profile"><span class="developer-avatar" aria-hidden="true">ДК</span><div><b>${escapeHtml(options.developerName || developer.name || "")}</b><small>Автор и разработчик ZeTer OS</small></div></div><div class="developer-contact"><span>Электронная почта</span><b>${escapeHtml(options.developerEmail || developer.email || "")}</b></div></section>`;
  }

  function settingsAppElement(options = {}) {
    const {
      winId = "",
      getSettings = () => ({}),
      getSystemSettings = () => ({}),
      setSystemSettings = () => {},
      getDesktopRecord = () => ({}),
      getDesktopOptions = () => [],
      getStorageSummary = () => ({}),
      getDesktopRoot = () => "desktop",
      normalizeDesktopIcon = icon => icon || null,
      normalizeCustomWallpaper = wallpaper => wallpaper || null,
      desktopAvatarHTML = () => "",
      desktopName = () => "Рабочий стол",
      desktopDescription = () => "",
      formatBytes = value => String(value || ""),
      osVersion = "",
      windowsStartupAvailable = false,
      applySettings = () => {},
      toast = () => {},
      refreshWindow = () => {},
      createCustomWallpaperFromFile = async () => null,
      createDesktopIconFromFile = async () => null,
      saveState = () => {},
      openDataFolder = async () => {},
      getWindowsStartupStatus = async () => ({ supported: false, enabled: false, stale: false }),
      setWindowsStartupEnabled = async () => ({ supported: false, enabled: false, stale: false }),
      openSecurity = () => {},
      renderStart = () => {}
    } = options;
    const root = document.createElement("div");
    root.className = "settings";
    let pendingHotkeyAction = "";

    const rootId = () => getDesktopRoot();
    const currentTitle = () => desktopName(rootId());
    const currentDescription = () => desktopDescription(rootId());
    const renderAgain = () => {
      if (winId) refreshWindow(winId);
      else syncSettingsWallpaperButtons(root, getSettings());
    };

    const settings = getSettings();
    const desk = getDesktopRecord();
    const deskIcon = normalizeDesktopIcon(desk.icon);
    const wallpaper = normalizeCustomWallpaper(settings.customWallpaper);
    root.innerHTML = settingsAppHTML(settingsAppViewModel({
      desktopAvatarHTML: desktopAvatarHTML(rootId(), true),
      desktopTitle: currentTitle(),
      desktopDescription: currentDescription(),
      desktopNameValue: desk.name || currentTitle(),
      desktopIcon: deskIcon,
      wallpaper,
      formatBytes,
      osVersion,
      windowsStartupAvailable,
      systemSettings: getSystemSettings(),
      desktopOptions: getDesktopOptions(),
      hotkeyDefinitions: HOTKEY_DEFINITIONS,
      storage: getStorageSummary()
    }));

    const sync = () => syncSettingsWallpaperButtons(root, getSettings());
    const refreshWindowsStartup = async (showToast = false) => {
      if (!windowsStartupAvailable) {
        syncWindowsStartupControls(document, windowsStartupView());
        return;
      }
      syncWindowsStartupControls(document, windowsStartupView({ supported: true }, true));
      try {
        const status = await getWindowsStartupStatus();
        syncWindowsStartupControls(document, windowsStartupView(status));
      } catch (error) {
        syncWindowsStartupControls(document, windowsStartupView(
          { supported: true },
          false,
          error?.message || "неизвестная ошибка Windows"
        ));
        if (showToast) {
          toast("Не удалось проверить автозапуск", error?.message || "Проверь доступ к настройкам Windows.");
        }
      }
    };
    const saveSystemSettings = async next => {
      setSystemSettings(normalizeSystemSettings(next));
      applySettings();
      await Promise.resolve(saveState());
      renderAgain();
    };

    root.addEventListener("click", async event => {
      const action = settingsClickAction(event.target);
      if (!action) return;
      const settings = getSettings();
      if (action.type === "select-wallpaper") {
        if (action.wall === "custom" && !settings.customWallpaper?.dataURL) return $("[data-wall-file]", root)?.click();
        settings.wallpaper = action.wall;
        applySettings();
        saveState();
        sync();
      }
      if (action.type === "upload-wallpaper") $("[data-wall-file]", root)?.click();
      if (action.type === "clear-wallpaper") {
        delete settings.customWallpaper;
        if (settings.wallpaper === "custom") settings.wallpaper = "aurora";
        applySettings();
        saveState();
        toast("Свои обои удалены", "Рабочий стол переключён на Aurora.");
        renderAgain();
      }
      if (action.type === "upload-desktop-icon") $("[data-desktop-icon-file]", root)?.click();
      if (action.type === "clear-desktop-icon") {
        delete getDesktopRecord().icon;
        saveState();
        renderStart();
        toast("Иконка удалена", "Рабочий стол использует стандартный значок.");
        renderAgain();
      }
      if (action.type === "save-now") {
        await Promise.resolve(saveState());
        const summary = getStorageSummary();
        if (summary.lastError) toast("Сохранение не завершено", summary.lastError);
        else toast("Данные сохранены", `${summary.mode || "Хранилище"} · ${formatSettingsTime(summary.lastSavedAt)}`);
        renderAgain();
      }
      if (action.type === "open-data-folder") {
        try { await openDataFolder(); } catch (error) { toast("Не удалось открыть папку data", error?.message || "Запусти desktop-версию через run_zeter_os.py."); }
      }
      if (action.type === "open-security") openSecurity();
      if (action.type === "capture-hotkey") {
        pendingHotkeyAction = action.actionId;
        const button = $(`[data-hotkey-capture="${action.actionId}"]`, root);
        if (button) {
          button.classList.add("capturing");
          button.querySelector("kbd").textContent = "Нажми сочетание…";
          button.focus();
        }
      }
      if (action.type === "clear-hotkey") {
        const next = normalizeSystemSettings(getSystemSettings());
        next.hotkeys[action.actionId] = "";
        await saveSystemSettings(next);
        toast("Сочетание отключено", HOTKEY_DEFINITIONS.find(item => item.id === action.actionId)?.label || "Действие");
      }
      if (action.type === "reset-hotkeys") {
        const next = normalizeSystemSettings(getSystemSettings());
        next.hotkeys = defaultHotkeys();
        await saveSystemSettings(next);
        toast("Горячие клавиши сброшены", "Восстановлены стандартные сочетания.");
      }
    });

    root.addEventListener("keydown", async event => {
      if (!pendingHotkeyAction) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        pendingHotkeyAction = "";
        renderAgain();
        return;
      }
      const value = keyboardEventHotkey(event);
      if (!value) return;
      if (!isHotkeyAssignable(value)) {
        toast("Сочетание недоступно", "Используй Ctrl или Alt вместе с буквой, стрелкой либо другой клавишей.");
        return;
      }
      const conflict = hotkeyConflict(pendingHotkeyAction, value, getSystemSettings());
      if (conflict) {
        toast("Сочетание уже используется", conflict.label);
        return;
      }
      const next = normalizeSystemSettings(getSystemSettings());
      next.hotkeys[pendingHotkeyAction] = value;
      const label = HOTKEY_DEFINITIONS.find(item => item.id === pendingHotkeyAction)?.label || "Действие";
      pendingHotkeyAction = "";
      await saveSystemSettings(next);
      toast("Горячая клавиша сохранена", `${label}: ${hotkeyDisplay(value)}`);
    }, true);

    root.addEventListener("change", async event => {
      const action = settingsChangeAction(event.target);
      if (!action) return;
      if (action.type === "windows-startup") {
        syncWindowsStartupControls(document, windowsStartupView(
          { supported: true, enabled: action.enabled },
          true
        ));
        try {
          const result = await setWindowsStartupEnabled(action.enabled);
          if (result?.supported !== true) throw new Error("Автозапуск недоступен в этом режиме.");
          syncWindowsStartupControls(document, windowsStartupView(result));
          toast(
            result.enabled ? "Автозапуск включён" : "Автозапуск выключен",
            result.enabled
              ? "ZeTer OS запустится после следующего входа в Windows. Настройка общая для всех рабочих столов."
              : "ZeTer OS больше не будет запускаться вместе с Windows."
          );
        } catch (error) {
          toast("Не удалось изменить автозапуск", error?.message || "Проверь доступ к настройкам Windows.");
          await refreshWindowsStartup();
        }
        return;
      }
      if (action.type === "system-setting") {
        await saveSystemSettings(applySystemSetting(getSystemSettings(), action.path, action.value));
        return;
      }
      const file = event.target.files?.[0];
      if (action.type === "wallpaper-file") {
        event.target.value = "";
        if (!file) return;
        try {
          const customWallpaper = await createCustomWallpaperFromFile(file);
          const current = getSettings();
          current.customWallpaper = customWallpaper;
          current.wallpaper = "custom";
          applySettings();
          saveState();
          toast("Свои обои загружены", customWallpaper.name || "Изображение применено к рабочему столу.");
          renderAgain();
        } catch (error) {
          console.error("[ZeTer OS custom wallpaper]", error);
          toast("Не удалось загрузить обои", error?.message || "Проверь файл изображения.");
        }
      }
      if (action.type === "desktop-icon-file") {
        event.target.value = "";
        if (!file) return;
        try {
          const customIcon = await createDesktopIconFromFile(file);
          getDesktopRecord().icon = customIcon;
          saveState();
          renderStart();
          toast("Иконка загружена", customIcon.name || "Иконка применена к рабочему столу.");
          renderAgain();
        } catch (error) {
          console.error("[ZeTer OS desktop icon]", error);
          toast("Не удалось загрузить иконку", error?.message || "Проверь файл изображения.");
        }
      }
    });

    const saveDesktopProfile = debounce(() => { saveState(); renderStart(); }, 250);
    root.addEventListener("input", event => {
      const action = settingsInputAction(event.target);
      if (!action) return;
      if (action.type === "desktop-name") {
        getDesktopRecord().name = action.value;
        updateSettingsDesktopProfileText(root, currentTitle(), currentDescription());
        saveDesktopProfile();
      }
      if (action.type === "desktop-description") {
        getDesktopRecord().description = action.value;
        updateSettingsDesktopProfileText(root, currentTitle(), currentDescription());
        saveDesktopProfile();
      }
    });

    sync();
    void refreshWindowsStartup();
    return root;
  }

  window.ZETER_SETTINGS_UI_UTILS = Object.freeze({
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
