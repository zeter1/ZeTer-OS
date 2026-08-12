"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[char]));

const sandbox = {
  console,
  document: {},
  window: {
    ZETER_CORE_UTILS: {
      escapeHtml,
      $: () => null,
      $$: () => [],
      debounce: callback => callback
    }
  }
};
vm.createContext(sandbox);

function loadCore(name) {
  const filePath = path.join(ROOT, "app", "js", "core", name);
  vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
}

["version.js", "config.js", "system-settings-utils.js", "app-catalog.js", "help-content.js", "first-run-ui-utils.js", "settings-ui-utils.js"].forEach(loadCore);

const help = sandbox.window.ZETER_HELP_CONTENT;
const firstRun = sandbox.window.ZETER_FIRST_RUN_UI_UTILS;
const settings = sandbox.window.ZETER_SETTINGS_UI_UTILS;
const config = sandbox.window.ZETER_OS_CONFIG;
const catalog = sandbox.window.ZETER_APP_CATALOG.APP_CATALOG_DEFINITIONS;
assert.ok(help && firstRun && settings && config && catalog, "help, settings, first-run, config and app catalog contracts must load");
assert.deepEqual(
  JSON.parse(JSON.stringify(config.DEVELOPER)),
  { name: "Дмитрий Колесниченко", email: "zeter11@gmail.com" },
  "developer details must have one product-level source of truth"
);

const sectionIds = help.HELP_SECTIONS.map(section => section.id);
assert.equal(new Set(sectionIds).size, sectionIds.length, "help section ids must be unique");
assert.ok(sectionIds.length >= 9, "help must cover all major user areas");
assert.ok(help.HELP_CARDS.every(card => sectionIds.includes(card.target)), "every quick-start card must lead to a real section");

const topics = help.HELP_SECTIONS.flatMap(section => section.topics);
assert.ok(topics.length >= 30, "help must remain a substantial user guide");
assert.ok(topics.every(topic => topic.title && topic.summary && topic.steps?.length), "every help topic must have a title, summary and steps");

const html = help.helpContentHTML({ osVersion: "3.77" });
assert.match(html, /Освой ZeTer OS шаг за шагом/, "help must start with a clear onboarding promise");
assert.match(html, /data-help-search/, "help must provide full-text search");
assert.match(html, /data-help-target="start"/, "help must provide section navigation");
assert.match(html, /start_zeter_os\.cmd/, "help must explain the supported desktop launch");
assert.match(html, /data\/zeter-os-state\.json/, "help must identify the primary recovery state");
assert.match(html, /Отдельного приложения «Корзина» нет/, "help must warn that deletion is immediate after confirmation");
assert.match(html, /служебная совместимость старых state, а не отдельная Корзина/, "help must distinguish legacy deletion records from a current Trash app");
assert.match(html, /\.zeterbak/, "help must explain encrypted backups");
assert.match(html, /data\/logs\/zeter-os\.log/, "help must point to the diagnostic log");
assert.match(html, /Повторить чтение/, "help must explain safe retry after a native state read failure");
assert.match(html, /блокирует автосохранение/, "help must explain that a failed native load cannot overwrite state");
assert.match(html, /не переписывает уже созданные точки и автокопии/, "help must explain immutable recovery snapshots");
assert.match(html, /пока нужна сохранённой точке восстановления или JSON-автокопии/, "help must explain recovery-aware managed payload retention");
assert.match(html, /точка не применяется и предлагается импорт проверенного ZIP-бэкапа/, "help must explain native restore payload preflight");
assert.match(html, /Ctrl\+Space/, "help must document global search shortcut");
assert.match(html, /выделенную группу/, "help must explain how to drag several selected desktop icons");
assert.match(html, /сохранят взаимное расположение/, "help must describe the group drag geometry contract");
assert.match(html, /удерживай Ctrl/, "help must explain additive desktop selection with Ctrl+click");
assert.match(html, /Повторный Ctrl\+щелчок/, "help must explain how to remove one icon from a Ctrl selection");
assert.match(html, /Дмитрий Колесниченко/, "help must identify the developer");
assert.match(html, /zeter11@gmail\.com/, "help must provide the developer contact email");

const settingsHtml = settings.settingsAppHTML(settings.settingsAppViewModel({ osVersion: "3.77" }));
assert.match(settingsHtml, /<h3>Разработчик<\/h3>/, "settings must have a dedicated developer card");
assert.match(settingsHtml, /Дмитрий Колесниченко/, "settings must identify the developer");
assert.match(settingsHtml, /zeter11@gmail\.com/, "settings must provide the developer contact email");
assert.match(settingsHtml, /Сохранение и данные/, "settings must expose storage status and manual save");
assert.match(settingsHtml, /Уведомления/, "settings must expose notification preferences");
assert.match(settingsHtml, /Запуск и восстановление окон/, "settings must expose startup behavior");
assert.match(settingsHtml, /data-windows-startup/, "settings must expose Windows startup control");
assert.match(settingsHtml, /desktop-версии ZeTer OS для Windows/, "browser settings must explain the native-only startup limit");
assert.match(settingsHtml, /Окно ZeTer OS после запуска/, "settings must expose native startup window mode");
assert.match(settingsHtml, /Интерфейс и доступность/, "settings must expose accessibility preferences");
assert.match(settingsHtml, /Настраиваемые горячие клавиши/, "settings must expose configurable hotkeys");
const nativeSettingsHtml = settings.settingsAppHTML(settings.settingsAppViewModel({
  osVersion: "3.87",
  windowsStartupAvailable: true
}));
assert.match(nativeSettingsHtml, /Проверяем текущее состояние автозапуска/, "native settings must start with an honest loading state");
assert.deepEqual(
  JSON.parse(JSON.stringify(settings.windowsStartupView({ supported: true, enabled: true }))),
  {
    supported: true,
    enabled: true,
    pending: false,
    disabled: false,
    message: "Включено для текущего пользователя Windows. Настройка общая для всех рабочих столов."
  }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(settings.settingsChangeAction({
    checked: true,
    matches(selector) {
      return selector === "[data-windows-startup]";
    }
  }))),
  { type: "windows-startup", enabled: true }
);
assert.match(html, /Автозапуск вместе с Windows/, "help must explain Windows startup");

const appIds = [...html.matchAll(/data-help-app="([^"]+)"/g)].map(match => match[1]);
assert.ok(appIds.length >= 6, "help must link to useful built-in apps");
appIds.forEach(appId => assert.ok(catalog[appId], `help app action must reference a real app: ${appId}`));

assert.equal(help.normalizeHelpQuery("  БЭКАП  "), "бэкап");
assert.equal(help.helpTextMatches("Проверенный ZIP-бэкап", "zip"), true);
assert.equal(help.helpTextMatches("Календарь", "таблица"), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(help.helpClickAction({
    closest(selector) {
      return selector === "[data-help-app]" ? { dataset: { helpApp: "security" } } : null;
    }
  }))),
  { type: "open-app", appId: "security" }
);

const firstRunHtml = firstRun.firstRunScreenHTML("3.77");
assert.match(firstRunHtml, /Посмотреть возможности/, "first-run action must accurately describe the guide");
assert.match(firstRunHtml, /data-first-help/, "first-run guide action must use the help hook");
assert.doesNotMatch(firstRunHtml, /Открыть демо|data-first-demo/, "misleading demo wording must not return");

const appSource = fs.readFileSync(path.join(ROOT, "app", "js", "app.js"), "utf8");
assert.match(
  appSource,
  /helpAppElement\(\{\s*openApp,\s*osVersion:\s*OS_VERSION\s*\}\)/,
  "app composition must pass the real OS version and app opener to the guide"
);

console.log("help content smoke: ok");
