(() => {
  "use strict";

  const itemCustomizationUtils = window.ZETER_ITEM_CUSTOMIZATION_UTILS;
  if (!itemCustomizationUtils) throw new Error("ZeTer OS item metadata requires item customization utils.");

  const ITEM_TYPE_ICONS = Object.freeze({
    app: "▣",
    folder: "📁",
    note: "🗒️",
    markdown: "📘",
    table: "▦",
    tasklist: "☑️",
    image: "🖼️",
    paint: "🎨",
    managedFile: "📎",
    shortcut: "🔗",
    file: "📄"
  });

  const START_ITEM_KIND_LABELS = Object.freeze({
    app: "Ярлык",
    folder: "Папка",
    table: "Таблица",
    tasklist: "Список задач",
    markdown: "Markdown",
    image: "Изображение",
    paint: "Изображение",
    managedFile: "Файл Windows",
    shortcut: "Ярлык",
    file: "Файл"
  });

  function itemIconForApps(apps = {}, item = null) {
    if (!item) return ITEM_TYPE_ICONS.file;
    let fallback = ITEM_TYPE_ICONS[item.type] || ITEM_TYPE_ICONS.file;
    if (item.type === "app") fallback = apps[item.appId]?.icon || ITEM_TYPE_ICONS.app;
    if (item.type === "managedFile" && window.ZETER_MANAGED_FILE_UTILS) fallback = window.ZETER_MANAGED_FILE_UTILS.managedFileIcon(item.managedFile || item);
    if (item.type === "shortcut" && window.ZETER_SHORTCUT_UTILS) fallback = window.ZETER_SHORTCUT_UTILS.shortcutIcon(item.shortcut || item.managedFile || item);
    return itemCustomizationUtils.itemIconHTML(item, fallback);
  }

  function startItemKind(item = null) {
    if (!item) return "Элемент";
    return START_ITEM_KIND_LABELS[item.type] || START_ITEM_KIND_LABELS.file;
  }

  window.ZETER_ITEM_METADATA = Object.freeze({
    ITEM_TYPE_ICONS,
    START_ITEM_KIND_LABELS,
    itemIconForApps,
    startItemKind
  });
})();
