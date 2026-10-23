"use strict";
// Hermetic VM fixtures and the actual primary queue; no startup/native/user data.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const fixtureNow = new Date(2026, 9, 22, 12).getTime();
class CalendarTestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [fixtureNow])); }
  static now() { return fixtureNow; }
}
const sandbox = { console, Date: CalendarTestDate, structuredClone, TextEncoder, setTimeout, clearTimeout, crypto: require("node:crypto").webcrypto };
sandbox.window = sandbox; vm.createContext(sandbox);
for (const file of ["config", "utils", "data-normalizers", "calendar-utils", "calendar-ui-utils", "storage-utils", "automation-utils", "notification-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(root, `app/js/core/${file}.js`), "utf8"), sandbox);
}
const clone = value => JSON.parse(JSON.stringify(value)), tick = () => new Promise(resolve => setImmediate(resolve));
const today = sandbox.ZETER_CORE_UTILS.todayISO();
const draft = title => ({ title, date: today, start: "09:00", end: "10:00", reminder: "0" });
const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
// Run the exact production adapter, including legacy aliases and staged automation enqueue.
const adapter = source.slice(source.indexOf("  function calendarPersistenceOptions("), source.indexOf("  function renderLinkLibraryApp("));
vm.runInContext(adapter, sandbox);

async function main() {
  const first = { events: [], automations: [{ id: "on_create", name: "Создание", enabled: true, type: "event_created", actions: [{ type: "notify", title: "План", text: "Создан" }] }] };
  const other = { events: [{ id: "neighbor", title: "Другой стол" }] };
  const state = { desktops: [{ id: "desktop", data: first }, { id: "other", data: other }], fs: {} };
  let disk, refuse = false, hold = null, sequence = 0, chain = Promise.resolve();
  Object.assign(sandbox, {
    state, uid: () => `event_${++sequence}`, automationEventBaseline: new Map(), scheduleAutomationCheck() {},
    ui: { windows: new Map([["editor", { desktopId: "desktop" }], ["calendar", { desktopId: "desktop" }]]), calendar: {} },
    getDesktopRoot: () => "desktop", document: {}, systemSettings: () => ({ calendar: {} }), desktopName: value => value,
    createCalendarApp: value => value, createCalendarEventEditorApp: (_params, _id, value) => value,
    writeSmallSettingsToLocalStorage() {}, scheduleExternalBackup() {}, securityRuntimeController: { scheduleProtectionCheck() {} },
    refreshProjectOverviews() {}, renderNotifications() {}, refreshOpenCalendars() {}, closeWindow() {}, toast() {}, objectLinksPanelFor() {},
    todayISO: () => today, confirm: () => true, openApp() {}, downloadFile() {}, formatDate: value => value,
    createAutomationRuntimeController: sandbox.ZETER_AUTOMATION_UTILS.createAutomationRuntimeController,
    syncLegacyWorkspaceAliases: value => { value.events = value.desktops[0].data.events; },
    queueAutomationMutation: operation => { const run = chain.catch(() => {}).then(operation); chain = run.catch(() => {}); return run; }
  });
  const queue = sandbox.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({
    getState: () => state, cloneState: clone, writesAllowed: () => true, nativeStorage: () => true,
    writePrimaryRecord: async snapshot => {
      if (hold) await new Promise(resolve => { hold.resolve = resolve; });
      if (refuse) throw new Error("fixture write refused");
      disk = clone(snapshot); return { updatedAt: 1 };
    }
  });
  sandbox.persistSearchAwareTransaction = operation => queue.transaction(operation);
  const editor = sandbox.renderCalendarEventEditorApp({}, "editor"), calendarApp = sandbox.renderCalendarApp({}, "calendar");
  const model = { saveEvent: editor.saveEventRecord, removeEvent: calendarApp.removeEvent };
  const controller = Object.fromEntries(["saveEvent", "removeEvent"].map(key => [key, async (...args) => {
    const result = await model[key](...args);
    editor.onEventSaved();
    return result;
  }]));
  sandbox.syncLegacyWorkspaceAliases(state);
  const before = clone(state);
  refuse = true;
  await assert.rejects(controller.saveEvent(draft("Черновик")), /refused/);
  assert.deepEqual(clone(state), before, "refused create must not publish events, automations or aliases");
  refuse = false; hold = {};
  const creating = controller.saveEvent(draft("Первая встреча")); await tick();
  assert.deepEqual(clone(state), before, "pending create must leave live state unchanged");
  hold.resolve(); hold = null; const created = await creating;
  assert.equal(first.events.length, 1); assert.equal(first.events[0].id, created.id);
  assert.equal(disk.desktops[0].data.events[0].title, "Первая встреча");
  assert.equal(disk.events[0].id, created.id, "legacy alias must contain the same accepted event");
  assert.equal(disk.desktops[0].data.automationRuntime.queue.length, 1, "event and automation must persist atomically");
  assert.equal(first.automationRuntime.queue.length, 1);
  assert.deepEqual(other, before.desktops[1].data);

  const original = clone(first.events[0]);
  await controller.saveEvent(draft("Изменено другим окном"), created.id, original);
  await assert.rejects(controller.saveEvent(draft("Устаревший ввод"), created.id, original), /другом окне/);
  assert.equal(first.events[0].title, "Изменено другим окном");
  const metadata = { ...clone(first.events[0]), createdAt: 123, reminderNotifiedOccurrence: "sent", customMetadata: { keep: true } };
  first.events[0] = metadata;
  const changed = await controller.saveEvent(draft("Метаданные сохранены"), created.id, metadata);
  assert.equal(changed.createdAt, 123); assert.equal(changed.reminderNotifiedOccurrence, "sent"); assert.deepEqual(clone(changed.customMetadata), { keep: true });
  for (const date of ["", "2028-02-30", "2027-02-29", "2028-13-01"]) {
    await assert.rejects(controller.saveEvent({ ...draft("Дата"), date }), /дат/);
  }
  await assert.rejects(controller.saveEvent({ ...draft("Время"), start: "25:99" }), /время/);
  const leap = await controller.saveEvent({ ...draft("Високосный день"), date: "2028-02-29" });
  const preserved = clone(state); refuse = true;
  await assert.rejects(controller.removeEvent(created.id), /refused/); assert.deepEqual(clone(state), preserved);
  refuse = false;
  await controller.removeEvent(created.id);
  assert.deepEqual(clone(first.events.map(event => event.id)), [leap.id]);
  await assert.rejects(controller.saveEvent(draft("Удалено"), created.id, changed), /удалено/);
  assert.deepEqual(other, before.desktops[1].data);

  hold = {};
  const editing = controller.saveEvent({ ...draft("Правка при напоминании"), date: "2028-02-29" }, leap.id, clone(first.events[0])); await tick();
  first.events[0].reminderNotifiedOccurrence = "delivered-during-write";
  first.events.push({ id: "background", title: "Независимое событие" });
  const trailing = queue.queue();
  hold.resolve(); hold = null; await editing; await trailing;
  assert.equal(first.events[0].reminderNotifiedOccurrence, "delivered-during-write");
  assert.equal(first.events[1].id, "background");
  assert.equal(disk.events[0].reminderNotifiedOccurrence, "delivered-during-write");
  assert.equal(disk.events[1].id, "background", "ordinary save after barrier must retain independent changes");

  await controller.saveEvent({ ...draft("Включить напоминание"), date: "2028-02-29", reminder: "15" }, leap.id, clone(first.events[0]));
  let continueReminder;
  const reminderBarrier = queue.transaction(() => new Promise(resolve => { continueReminder = resolve; })); await tick();
  const beforeReminder = clone(first.events[0]);
  const afterReminder = controller.saveEvent({ ...draft("Правка после напоминания"), date: "2028-02-29", reminder: "15" }, leap.id, beforeReminder); await tick();
  const delivered = sandbox.ZETER_NOTIFICATION_UTILS.collectDueCalendarReminderNotifications([{ desktopId: "desktop", events: first.events }], {
    now: new Date("2028-02-29T08:50:00").getTime(), occursOn: sandbox.ZETER_CALENDAR_UTILS.occursOn
  });
  assert.equal(delivered.notifications.length, 1, "the actual collector must deliver the pending reminder");
  continueReminder(); await reminderBarrier; await afterReminder;
  assert.equal(first.events[0].title, "Правка после напоминания", "reminder bookkeeping must not invalidate the editor draft");
  assert.equal(first.events[0].reminderNotifiedOccurrence, "2028-02-29|09:00|15");

  // The workspace is resolved again after the primary transaction barrier.
  let release;
  const barrier = queue.transaction(() => new Promise(resolve => { release = resolve; })); await tick();
  const stale = controller.saveEvent(draft("Удалённый стол")); await tick();
  state.desktops = state.desktops.filter(desktop => desktop.id !== "desktop"); release(); await barrier;
  await assert.rejects(stale, /недоступен/);
  assert.deepEqual(other, before.desktops[1].data);
  console.log("calendar persistence smoke: ok (ACK, refusal/retry, conflict, metadata, dates, automation, workspace)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
