(() => {
  "use strict";

  const HOTKEY_DEFINITIONS = Object.freeze([
    Object.freeze({ id: "search", label: "Открыть поиск", defaultValue: "Ctrl+Space" }),
    Object.freeze({ id: "start", label: "Открыть меню Пуск", defaultValue: "Ctrl+Alt+P" }),
    Object.freeze({ id: "settings", label: "Открыть Настройки", defaultValue: "Ctrl+Alt+S" }),
    Object.freeze({ id: "calendar", label: "Открыть Календарь", defaultValue: "Ctrl+Alt+C" }),
    Object.freeze({ id: "notifications", label: "Открыть уведомления", defaultValue: "Ctrl+Alt+U" }),
    Object.freeze({ id: "previousDesktop", label: "Предыдущий рабочий стол", defaultValue: "Ctrl+Alt+ArrowLeft" }),
    Object.freeze({ id: "nextDesktop", label: "Следующий рабочий стол", defaultValue: "Ctrl+Alt+ArrowRight" })
  ]);

  const HOTKEY_MODIFIERS = Object.freeze(["Ctrl", "Alt", "Shift", "Meta"]);
  const HOTKEY_ACTION_IDS = new Set(HOTKEY_DEFINITIONS.map(item => item.id));
  const TEXT_SCALE_VALUES = Object.freeze([90, 100, 110, 120]);
  const BLOCKED_HOTKEYS = new Set([
    "Alt+Tab",
    "Ctrl+Alt+Delete",
    "Ctrl+L",
    "Ctrl+N",
    "Ctrl+R",
    "Ctrl+T",
    "Ctrl+W",
    "Ctrl+Z",
    "Ctrl+Shift+N",
    "F5",
    "F11"
  ]);

  const DEFAULT_SYSTEM_SETTINGS = Object.freeze({
    startup: Object.freeze({
      restoreWindows: true,
      desktop: "last",
      windowMode: "maximized"
    }),
    notifications: Object.freeze({
      enabled: true,
      tasks: true,
      calendar: true,
      system: true,
      quietHoursEnabled: false,
      quietFrom: "22:00",
      quietTo: "08:00"
    }),
    accessibility: Object.freeze({
      textScale: 100,
      largeControls: false,
      highContrast: false,
      reducedMotion: false
    }),
    hotkeys: Object.freeze(Object.fromEntries(HOTKEY_DEFINITIONS.map(item => [item.id, item.defaultValue])))
  });

  function booleanSetting(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizeClockTime(value = "", fallback = "00:00") {
    const raw = String(value || "").trim();
    if (!/^\d{2}:\d{2}$/.test(raw)) return fallback;
    const [hours, minutes] = raw.split(":").map(Number);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? raw : fallback;
  }

  function normalizeHotkeyKey(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^[a-z0-9]$/i.test(raw)) return raw.toUpperCase();
    if (/^f(?:[1-9]|1[0-2])$/i.test(raw)) return raw.toUpperCase();
    const aliases = {
      space: "Space",
      spacebar: "Space",
      arrowleft: "ArrowLeft",
      left: "ArrowLeft",
      arrowright: "ArrowRight",
      right: "ArrowRight",
      arrowup: "ArrowUp",
      up: "ArrowUp",
      arrowdown: "ArrowDown",
      down: "ArrowDown",
      enter: "Enter",
      escape: "Escape",
      esc: "Escape",
      delete: "Delete",
      backspace: "Backspace",
      home: "Home",
      end: "End",
      pageup: "PageUp",
      pagedown: "PageDown",
      comma: "Comma",
      period: "Period"
    };
    return aliases[raw.toLowerCase()] || "";
  }

  function canonicalHotkey(value = "") {
    const parts = String(value || "").split("+").map(part => part.trim()).filter(Boolean);
    if (!parts.length) return "";
    const modifiers = new Set();
    const keys = [];
    parts.forEach(part => {
      const lower = part.toLowerCase();
      if (lower === "control" || lower === "ctrl") modifiers.add("Ctrl");
      else if (lower === "alt") modifiers.add("Alt");
      else if (lower === "shift") modifiers.add("Shift");
      else if (lower === "meta" || lower === "win" || lower === "windows") modifiers.add("Meta");
      else keys.push(part);
    });
    if (keys.length !== 1) return "";
    const key = normalizeHotkeyKey(keys[0]);
    if (!key) return "";
    return [...HOTKEY_MODIFIERS.filter(modifier => modifiers.has(modifier)), key].join("+");
  }

  function normalizeHotkey(value = "", fallback = "") {
    if (value === "") return "";
    return canonicalHotkey(value) || canonicalHotkey(fallback);
  }

  function keyboardEventHotkey(event = {}) {
    const modifierKeys = new Set(["Control", "Alt", "Shift", "Meta"]);
    if (modifierKeys.has(event.key)) return "";
    let key = "";
    const code = String(event.code || "");
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^F(?:[1-9]|1[0-2])$/.test(code)) key = code;
    else if (code === "Space") key = "Space";
    else key = normalizeHotkeyKey(event.key || code);
    if (!key) return "";
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(key);
    return canonicalHotkey(parts.join("+"));
  }

  function isHotkeyAssignable(value = "") {
    const hotkey = canonicalHotkey(value);
    if (!hotkey || BLOCKED_HOTKEYS.has(hotkey) || hotkey.includes("Meta+")) return false;
    const key = hotkey.split("+").at(-1);
    return /^F(?:[1-9]|1[0-2])$/.test(key) || hotkey.startsWith("Ctrl+") || hotkey.startsWith("Alt+");
  }

  function hotkeyDisplay(value = "") {
    const hotkey = canonicalHotkey(value);
    if (!hotkey) return "Отключено";
    return hotkey
      .replace("ArrowLeft", "←")
      .replace("ArrowRight", "→")
      .replace("ArrowUp", "↑")
      .replace("ArrowDown", "↓")
      .replace("Space", "Пробел");
  }

  function normalizeSystemSettings(settings = {}) {
    const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    const startupSource = source.startup && typeof source.startup === "object" ? source.startup : {};
    const notificationSource = source.notifications && typeof source.notifications === "object" ? source.notifications : {};
    const accessibilitySource = source.accessibility && typeof source.accessibility === "object" ? source.accessibility : {};
    const hotkeySource = source.hotkeys && typeof source.hotkeys === "object" ? source.hotkeys : {};
    const desktop = String(startupSource.desktop || DEFAULT_SYSTEM_SETTINGS.startup.desktop).slice(0, 120);
    const windowMode = startupSource.windowMode === "windowed" ? "windowed" : "maximized";
    const textScaleCandidate = Number(accessibilitySource.textScale);
    const textScale = TEXT_SCALE_VALUES.includes(textScaleCandidate) ? textScaleCandidate : DEFAULT_SYSTEM_SETTINGS.accessibility.textScale;
    const hotkeys = { ...hotkeySource };
    HOTKEY_DEFINITIONS.forEach(definition => {
      hotkeys[definition.id] = Object.prototype.hasOwnProperty.call(hotkeySource, definition.id)
        ? normalizeHotkey(hotkeySource[definition.id], "")
        : definition.defaultValue;
    });
    return {
      ...source,
      startup: {
        ...startupSource,
        restoreWindows: booleanSetting(startupSource.restoreWindows, DEFAULT_SYSTEM_SETTINGS.startup.restoreWindows),
        desktop: desktop || "last",
        windowMode
      },
      notifications: {
        ...notificationSource,
        enabled: booleanSetting(notificationSource.enabled, DEFAULT_SYSTEM_SETTINGS.notifications.enabled),
        tasks: booleanSetting(notificationSource.tasks, DEFAULT_SYSTEM_SETTINGS.notifications.tasks),
        calendar: booleanSetting(notificationSource.calendar, DEFAULT_SYSTEM_SETTINGS.notifications.calendar),
        system: booleanSetting(notificationSource.system, DEFAULT_SYSTEM_SETTINGS.notifications.system),
        quietHoursEnabled: booleanSetting(notificationSource.quietHoursEnabled, DEFAULT_SYSTEM_SETTINGS.notifications.quietHoursEnabled),
        quietFrom: normalizeClockTime(notificationSource.quietFrom, DEFAULT_SYSTEM_SETTINGS.notifications.quietFrom),
        quietTo: normalizeClockTime(notificationSource.quietTo, DEFAULT_SYSTEM_SETTINGS.notifications.quietTo)
      },
      accessibility: {
        ...accessibilitySource,
        textScale,
        largeControls: booleanSetting(accessibilitySource.largeControls, DEFAULT_SYSTEM_SETTINGS.accessibility.largeControls),
        highContrast: booleanSetting(accessibilitySource.highContrast, DEFAULT_SYSTEM_SETTINGS.accessibility.highContrast),
        reducedMotion: booleanSetting(accessibilitySource.reducedMotion, DEFAULT_SYSTEM_SETTINGS.accessibility.reducedMotion)
      },
      hotkeys
    };
  }

  function hotkeyConflict(actionId = "", value = "", settings = {}) {
    const hotkey = canonicalHotkey(value);
    if (!hotkey) return null;
    const normalized = normalizeSystemSettings(settings);
    const match = HOTKEY_DEFINITIONS.find(definition => definition.id !== actionId && normalized.hotkeys[definition.id] === hotkey);
    return match || null;
  }

  function hotkeyActionForEvent(event = {}, settings = {}) {
    const hotkey = keyboardEventHotkey(event);
    if (!hotkey) return "";
    const normalized = normalizeSystemSettings(settings);
    const definition = HOTKEY_DEFINITIONS.find(item => normalized.hotkeys[item.id] === hotkey);
    return definition?.id || "";
  }

  function clockMinutes(value = "") {
    const normalized = normalizeClockTime(value, "");
    if (!normalized) return NaN;
    const [hours, minutes] = normalized.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function quietHoursActive(notifications = {}, date = new Date()) {
    const settings = normalizeSystemSettings({ notifications }).notifications;
    if (!settings.quietHoursEnabled) return false;
    const from = clockMinutes(settings.quietFrom);
    const to = clockMinutes(settings.quietTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
    const now = date.getHours() * 60 + date.getMinutes();
    return from < to ? now >= from && now < to : now >= from || now < to;
  }

  function notificationDeliveryDecision(settings = {}, category = "system", date = new Date()) {
    const normalized = normalizeSystemSettings(settings).notifications;
    const categoryId = ["tasks", "calendar", "system"].includes(category) ? category : "system";
    const enabled = normalized.enabled && normalized[categoryId];
    return Object.freeze({
      store: enabled,
      popup: enabled && !quietHoursActive(normalized, date),
      quiet: enabled && quietHoursActive(normalized, date)
    });
  }

  function defaultHotkeys() {
    return Object.fromEntries(HOTKEY_DEFINITIONS.map(item => [item.id, item.defaultValue]));
  }

  window.ZETER_SYSTEM_SETTINGS_UTILS = Object.freeze({
    DEFAULT_SYSTEM_SETTINGS,
    HOTKEY_DEFINITIONS,
    HOTKEY_ACTION_IDS,
    TEXT_SCALE_VALUES,
    normalizeClockTime,
    normalizeHotkey,
    keyboardEventHotkey,
    isHotkeyAssignable,
    hotkeyDisplay,
    normalizeSystemSettings,
    hotkeyConflict,
    hotkeyActionForEvent,
    quietHoursActive,
    notificationDeliveryDecision,
    defaultHotkeys
  });
})();
