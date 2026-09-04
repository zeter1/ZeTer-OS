"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const validatorPath = path.join(ROOT, "app", "js", "core", "state-import-validator.js");
const SAFE_ID = /^[A-Za-z0-9_-]{1,220}$/;

function validateImportArrayLimit(value, label, max) {
  if (value == null) return;
  if (!Array.isArray(value)) throw new Error(`${label}: ожидался массив.`);
  if (value.length > max) throw new Error(`${label}: слишком много элементов.`);
}

function validateImportString(value, label, max = Number.POSITIVE_INFINITY) {
  if (value == null) return;
  if (typeof value !== "string") throw new Error(`${label}: ожидался текст.`);
  if (value.length > max) throw new Error(`${label}: текст слишком длинный.`);
}

function validateImportSafeId(value, label) {
  if (!SAFE_ID.test(String(value || ""))) throw new Error(`${label}: некорректный ID.`);
}

function validateImportEnum(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`${label}: недопустимое значение.`);
}

const sandbox = {
  console,
  document: { createElement: () => ({ innerHTML: "", querySelectorAll: () => [] }) },
  ZETER_OS_CONFIG: {
    BACKUP_IMPORT_MAX_STATE_BYTES: 1024,
    BACKUP_IMPORT_MAX_FS_ITEMS: 100,
    BACKUP_IMPORT_MAX_DESKTOPS: 10,
    BACKUP_IMPORT_MAX_TEXT_CHARS: 1000,
    BACKUP_IMPORT_MAX_DATA_URL_CHARS: 1000,
    BACKUP_IMPORT_MAX_TASK_CHECKLIST_ITEMS: 100,
    BACKUP_IMPORT_MAX_TASK_PROJECTS: 100,
    BACKUP_IMPORT_MAX_TASKS: 100,
    CALENDAR_MAX_EVENTS: 100,
    NOTIFICATION_MAX_ITEMS: 100,
    OPEN_WINDOWS_MAX: 20,
    CALENDAR_CATEGORY_IDS: ["work"],
    CALENDAR_REPEAT_IDS: ["none"],
    CALENDAR_REMINDER_IDS: ["none"]
  },
  ZETER_CORE_UTILS: { byteSize: () => 0, bytesToHuman: value => String(value) },
  ZETER_ASSET_UTILS: { isExternalAssetPath: () => false },
  ZETER_IMPORT_UTILS: {
    validateImportArrayLimit,
    validateImportString,
    validateImportSafeId,
    validateImportEnum,
    validateImportDataImage: () => {}
  },
  ZETER_DATA_NORMALIZERS: {
    TASK_TITLE_MAX_CHARS: 500,
    TASK_TAG_MAX_CHARS: 160,
    TASK_CHECKLIST_TEXT_MAX_CHARS: 500
  },
  ZETER_RICH_TEXT_UTILS: { cleanRichHtml: value => String(value || "") },
  ZETER_ITEM_CUSTOMIZATION_UTILS: { isItemAssetPath: () => false }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
// Use production string semantics: the generic helper only checks length,
// so category validation itself must enforce the string type.
const importSource = fs.readFileSync(path.join(ROOT, "app", "js", "core", "import-utils.js"), "utf8");
const stringValidatorSource = importSource.match(/^  function validateImportString\([\s\S]*?^  }/m)[0];
vm.runInContext(stringValidatorSource, sandbox);
sandbox.ZETER_IMPORT_UTILS.validateImportString = sandbox.validateImportString;
vm.runInContext(fs.readFileSync(validatorPath, "utf8"), sandbox, { filename: validatorPath });

const validator = sandbox.ZETER_STATE_IMPORT_VALIDATOR;
assert.ok(validator, "state import validator must load");
assert.doesNotThrow(() => validator.validateImportedAutomationCategories([{ id: "screen", name: "Разработка Записи экрана" }], "Категории"));
for (const categories of [[{ id: "bad!", name: "Имя" }], [{ id: "ok", name: "" }], [{ id: "ok", name: { unexpected: true } }], [{ id: "ok", name: 42 }], [{ id: "ok", name: "A" }, { id: "ok", name: "B" }], {}]) {
  assert.throws(() => validator.validateImportedAutomationCategories(categories, "Категории"));
}
assert.throws(() => validator.validateImportedAutomations([{ id: "a", name: "A", type: "startup", categoryId: "bad!" }], "Правила"));
assert.throws(() => validator.validateImportedAutomationCategories([{ id: 42, name: "Имя" }], "Категории"));
assert.throws(() => validator.validateImportedAutomations([{ id: "a", name: "A", type: "startup", categoryId: 42 }], "Правила"));

assert.doesNotThrow(() => validator.validateImportedAutomations([
  {
    id: "weekly1",
    name: "План недели",
    enabled: true,
    type: "weekly",
    condition: "always",
    weekday: 1,
    time: "09:00",
    lastRunKey: "",
    action: { type: "notify", title: "План", text: "Открыть план" }
  },
  {
    id: "file1",
    name: "Архивировать",
    type: "file_added",
    folderId: "desktop",
    lastRunKey: "",
    action: { type: "move_file", targetFolderId: "archive" }
  }
], "Автоматизации"));

assert.doesNotThrow(() => validator.validateImportedAutomations([
  {
    id: "v2_rule",
    name: "Цепочка v2",
    enabled: true,
    type: "file_added",
    folderId: "desktop",
    conditionMode: "any",
    conditions: [
      { id: "condition_1", type: "file_extension", value: "pdf" },
      { id: "condition_2", type: "file_name_contains", value: "отчёт" }
    ],
    actions: [
      { id: "action_1", type: "notify", title: "{file.name}", text: "Добавлен файл", onError: "continue" },
      { id: "action_2", type: "move_file", targetFolderId: "archive", collisionPolicy: "replace", replaceAcknowledged: false, onError: "stop" }
    ]
  }
], "Автоматизации"), "unacknowledged replace imports safely and is blocked by runtime/UI until acknowledged");

assert.doesNotThrow(() => validator.validateImportedAutomationRuntime({
  paused: true,
  baselineSeeded: true,
  knownFileIds: ["file1"],
  queue: [{ id: "queue1", automationId: "v2_rule", runKey: "file_added:file1", triggerType: "file_added", triggerId: "file1", status: "retry", attempts: 1 }],
  history: [{
    id: "history1",
    automationId: "v2_rule",
    status: "warning",
    message: "Часть действий выполнена",
    actionResults: [{ actionId: "action_1", actionType: "notify", status: "success", message: "Готово" }]
  }],
  checkpoints: [{
    id: "checkpoint1",
    queueId: "queue1",
    completedActionIds: ["action_1"],
    actionResults: [{ actionId: "action_1", actionType: "notify", status: "success", message: "Готово" }]
  }],
  rateLog: []
}, "Выполнение автоматизаций"));

assert.throws(
  () => validator.validateImportedAutomations([{ id: "bad", name: "Bad", type: "weekly", weekday: 7, time: "09:00", action: { type: "notify" } }], "Автоматизации"),
  /вне диапазона/
);
assert.throws(
  () => validator.validateImportedAutomations([{ id: "bad", name: "Bad", type: "weekly", weekday: 1, time: "25:00", action: { type: "notify" } }], "Автоматизации"),
  /некорректное время/
);
assert.throws(
  () => validator.validateImportedAutomations([{ id: "bad_move", name: "Bad move", type: "weekly", weekday: 1, time: "09:00", action: { type: "move_file", targetFolderId: "archive" } }], "Автоматизации"),
  /только для триггера добавления файла/
);
assert.throws(
  () => validator.validateImportedAutomationRuntime({
    queue: Array.from({ length: 501 }, (_, index) => ({ id: `queue_${index}`, automationId: "rule", runKey: `run_${index}`, triggerType: "startup" }))
  }, "Выполнение автоматизаций"),
  /слишком много элементов/
);

assert.doesNotThrow(() => validator.validateImportedObjectLinks([
  { id: "link1", a: { kind: "fs", id: "note1" }, b: { kind: "event", id: "event1" } }
], "Связи"));
assert.throws(
  () => validator.validateImportedObjectLinks([{ id: "link1", a: { kind: "fs", id: "same" }, b: { kind: "fs", id: "same" } }], "Связи"),
  /не может ссылаться на тот же объект/
);
assert.throws(
  () => validator.validateImportedObjectLinks([{ id: "link1", a: { kind: "task", id: "task1" }, b: { kind: "event", id: "event1" } }], "Связи"),
  /недопустимое значение/
);

assert.doesNotThrow(() => validator.validateImportedNotifications([
  { id: "notification1", title: "Готово", text: "Файл перемещён", linkedObjectKind: "fs", linkedObjectId: "file1" }
], "Уведомления"));
assert.throws(
  () => validator.validateImportedNotifications([{ id: "notification1", title: "Bad", linkedObjectKind: "fs" }], "Уведомления"),
  /ID связанного объекта/
);
assert.throws(
  () => validator.validateImportedNotifications([{ id: "notification1", title: "Bad", linkedObjectKind: "task", linkedObjectId: "task1" }], "Уведомления"),
  /недопустимое значение/
);

console.log("automation import validation smoke: ok");
