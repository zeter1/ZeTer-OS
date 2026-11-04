"use strict";
// Hermetic VM: no app startup, browser profile, native process or real notification.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [2026, 10, 3, 12, 0])); } }
const sandbox = { console, Date: TestDate, Promise };
sandbox.window = sandbox;
sandbox.ZETER_CORE_UTILS = { escapeHtml: String };
vm.createContext(sandbox);
for (const name of ["system-settings-utils", "notification-utils", "notification-ui-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name + ".js"), "utf8"), sandbox);
}

async function main() {
  const utils = sandbox.ZETER_SYSTEM_SETTINGS_UTILS;
  const create = sandbox.ZETER_NOTIFICATION_UI_UTILS.createSystemNotificationController;
  assert.equal(utils.normalizeSystemSettings().notifications.systemDelivery, false);
  assert.equal(utils.normalizeSystemSettings({ notifications: { systemDelivery: "true" } }).notifications.systemDelivery, false);
  let settings = utils.normalizeSystemSettings(), calls = [], fail = false, active = 0, peak = 0;
  const controller = create({ getSettings: () => settings, isNative: () => true, nativeSend: async payload => {
    active++; peak = Math.max(peak, active); calls.push(payload);
    await Promise.resolve(); active--;
    if (fail) throw new Error("Windows заблокировала уведомление");
    return { submitted: true };
  } });
  const record = { title: "Дедлайн <&> $(не код)", text: "Русский текст 🦊" };
  assert.equal(await controller.send(record), false);
  assert.equal(calls.length, 0);
  settings.notifications.systemDelivery = true;
  assert.deepEqual(await Promise.all([controller.send(record), controller.send(record)]), [true, true]);
  assert.equal(calls.length, 2); assert.equal(peak, 1);
  assert.equal(calls[0].title, record.title); assert.equal(calls[0].text, record.text);
  settings.notifications.tasks = false;
  assert.equal(await controller.send(record, { source: "task:one" }), false);
  settings.notifications.tasks = true;
  settings.notifications.quietHoursEnabled = true;
  settings.notifications.quietFrom = "11:00"; settings.notifications.quietTo = "13:00";
  assert.equal(await controller.send(record), false);
  settings.notifications.quietHoursEnabled = false;
  settings.notifications.enabled = false;
  assert.equal(await controller.send(record), false);
  settings.notifications.enabled = true;
  fail = true;
  assert.equal(await controller.send(record), false);
  assert.match(controller.getStatus(), /заблокировала/);
  fail = false;
  assert.equal(await controller.send(record), true, "a failure must not poison later delivery");
  settings.notifications.systemDelivery = false;
  assert.equal(await controller.test(), true, "explicit test also works before enabling the preference");
  let requested = 0, shown = [];
  class API { constructor(title, data) { shown.push({ title, data }); } }
  API.permission = "default";
  API.requestPermission = async () => { requested++; API.permission = "granted"; };
  settings.notifications.systemDelivery = true;
  const browser = create({ host: { Notification: API, isSecureContext: true }, getSettings: () => settings });
  assert.equal(await browser.send(record), false); assert.equal(requested, 0);
  await browser.test(); assert.equal(requested, 1); assert.equal(shown.length, 1);
  await browser.send(record); assert.equal(shown.length, 2);
  API.permission = "denied";
  await assert.rejects(browser.test(), /Разреши уведомления/);
  assert.equal(requested, 1);
  await assert.rejects(create({ host: {} }).test(), /недоступны/);
  console.log("system notifications: PASS (opt-in, filters, quiet hours, serial sends, failure/retry, explicit permission)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
