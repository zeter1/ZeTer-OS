(() => {
  "use strict";

  function itemPropertiesText({
    name = "",
    kind = "",
    size = "",
    path = "",
    createdAt = Date.now(),
    updatedAt = Date.now(),
    deletedAt = 0
  } = {}) {
    return [
      `Название: ${name}`,
      `Тип: ${kind}`,
      `Размер: ${size}`,
      `Путь: ${path}`,
      `Создано: ${new Date(createdAt || Date.now()).toLocaleString("ru-RU")}`,
      `Изменено: ${new Date(updatedAt || createdAt || Date.now()).toLocaleString("ru-RU")}`,
      deletedAt ? `Удалено старой версией: ${new Date(deletedAt).toLocaleString("ru-RU")}` : ""
    ].filter(Boolean).join("\n");
  }

  window.ZETER_ITEM_PROPERTIES_UI_UTILS = Object.freeze({
    itemPropertiesText
  });
})();
