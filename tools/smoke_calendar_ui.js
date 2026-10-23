"use strict";
// Explicit browser entrypoint; import is inert. No app startup, native API or real storage.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
async function runCalendarSmoke({ chromium, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/calendar-qa");
  fs.mkdirSync(out, { recursive: true });
  const files = ["config", "utils", "data-normalizers", "calendar-utils", "calendar-ui-utils", "storage-utils", "automation-utils", "notification-utils"].map(file => `js/core/${file}.js`);
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", ...files, "css"], ttlSeconds: 600 });
  const appSource = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
  const adapter = appSource.slice(appSource.indexOf("  function calendarPersistenceOptions("), appSource.indexOf("  function calendarMutationSaved("));
  const results = []; let browser;
  try {
    browser = await chromium.launch({ chromiumSandbox: true, headless: false });
    const cases = [
      ["create refusal preserves draft; retry survives remount", async page => {
        await page.locator("[data-ev-title]").fill("Встреча по проекту");
        await page.evaluate(() => { fixture.refuse = true; });
        await page.locator("[data-save-event]").click();
        await page.waitForFunction(() => fixture.toasts.some(row => row[0] === "Не удалось сохранить событие"));
        assert.equal(await page.locator("[data-ev-title]").inputValue(), "Встреча по проекту");
        assert.equal(await page.evaluate(() => state.desktops[0].data.events.length), 0);
        await page.evaluate(() => { fixture.refuse = false; });
        await page.locator("[data-save-event]").click(); await page.locator("#editor").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => fixture.disk.events[0].title), "Встреча по проекту");
        await page.evaluate(() => { state = structuredClone(fixture.disk); fixture.mount(state.desktops[0].data.events[0].id); });
        assert.equal(await page.locator("[data-ev-title]").inputValue(), "Встреча по проекту");
      }],
      ["pending save blocks duplicate Ctrl+Enter and Escape", async page => {
        await page.locator("[data-ev-title]").fill("Дождаться записи"); await page.evaluate(() => { fixture.hold = {}; });
        await page.locator("[data-ev-title]").press("Control+Enter"); await page.waitForFunction(() => typeof fixture.hold?.resolve === "function");
        await page.locator("#editor").dispatchEvent("keydown", { key: "Enter", ctrlKey: true });
        await page.locator("#editor").dispatchEvent("keydown", { key: "Escape" });
        assert.equal(await page.locator("#editor").count(), 1); assert.equal(await page.locator("[data-save-event]").isDisabled(), true);
        assert.equal(await page.evaluate(() => state.desktops[0].data.events.length), 0);
        await page.evaluate(() => { fixture.hold.resolve(); fixture.hold = null; }); await page.locator("#editor").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => state.desktops[0].data.events.length), 1); assert.equal(await page.evaluate(() => fixture.writes), 1);
      }],
      ["stale editor preserves newer event and its own draft", async page => {
        await page.evaluate(async () => {
          const item = await fixture.controller.saveEvent({ title: "Исходное", date: fixture.today }); fixture.mount(item.id);
          await fixture.controller.saveEvent({ title: "Новое из другого окна", date: fixture.today }, item.id, structuredClone(item));
        });
        await page.locator("[data-ev-title]").fill("Устаревший ввод"); await page.locator("[data-save-event]").click();
        await page.waitForFunction(() => fixture.toasts.some(row => /другом окне/.test(row[1])));
        assert.equal(await page.locator("[data-ev-title]").inputValue(), "Устаревший ввод");
        assert.equal(await page.evaluate(() => state.desktops[0].data.events[0].title), "Новое из другого окна");
      }],
      ["delete cancellation, refusal, retry and neighbor preservation", async page => {
        await page.evaluate(async () => {
          await fixture.controller.saveEvent({ title: "Удаляемое", date: fixture.today });
          await fixture.controller.saveEvent({ title: "Соседнее", date: fixture.today }); fixture.mountCalendar(); fixture.confirm = false;
        });
        const remove = page.locator("[data-delete-event]").first(); await remove.click();
        assert.equal(await page.evaluate(() => state.desktops[0].data.events.length), 2);
        await page.evaluate(() => { fixture.confirm = true; fixture.refuse = true; }); await remove.click();
        await page.waitForFunction(() => fixture.toasts.some(row => row[0] === "Не удалось удалить событие"));
        assert.equal(await page.locator("[data-delete-event]").count(), 2);
        await page.evaluate(() => { fixture.refuse = false; }); await remove.click();
        await page.waitForFunction(() => state.desktops[0].data.events.length === 1);
        assert.equal(await page.evaluate(() => state.desktops[0].data.events[0].title), "Соседнее");
      }],
      ["pending save keeps workspace ownership after desktop switch", async page => {
        await page.locator("[data-ev-title]").fill("Первый стол"); await page.evaluate(() => { fixture.hold = {}; });
        await page.locator("[data-save-event]").click(); await page.waitForFunction(() => typeof fixture.hold?.resolve === "function");
        await page.evaluate(() => { fixture.active = "other"; fixture.hold.resolve(); fixture.hold = null; });
        await page.locator("#editor").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => state.desktops[0].data.events[0].title), "Первый стол");
        assert.deepEqual(await page.evaluate(() => state.desktops[1].data.events), [{ id: "sentinel", title: "Не менять" }]);
      }],
      ["blank date is rejected; narrow editor stays usable", async page => {
        await page.setViewportSize({ width: 390, height: 740 });
        await page.locator("[data-ev-title]").fill("Проверка даты"); await page.locator("[data-ev-date]").fill("");
        await page.locator("[data-save-event]").click(); await page.waitForFunction(() => fixture.toasts.length > 0);
        assert.equal(await page.locator("#editor").count(), 1); assert.equal(await page.evaluate(() => fixture.writes), 0);
        await page.locator("[data-ev-date]").fill(await page.evaluate(() => fixture.today)); await page.locator("[data-save-event]").click();
        await page.locator("#editor").waitFor({ state: "detached" });
      }],
      ["accepted save with presentation failure cannot create a duplicate", async page => {
        await page.locator("[data-ev-title]").fill("Уже сохранено"); await page.evaluate(() => { fixture.raisePresentation = true; });
        await page.locator("[data-save-event]").click();
        await page.waitForFunction(() => fixture.toasts.some(row => /повторно добавлять/.test(row[1])));
        assert.equal(await page.evaluate(() => fixture.disk.events.length), 1);
        await page.locator("[data-save-event]").click();
        assert.equal(await page.evaluate(() => fixture.writes), 1);
        await page.locator("[data-cancel-event-editor]").click(); await page.locator("#editor").waitFor({ state: "detached" });
      }],
      ["reminder before transaction does not invalidate the editor", async page => {
        await page.evaluate(async () => {
          const item = await fixture.controller.saveEvent({ title: "Напоминание", date: fixture.today, start: "09:00", reminder: "15" }); fixture.mount(item.id);
          fixture.barrier = fixture.queue.transaction(() => new Promise(resolve => { fixture.releaseBarrier = resolve; }));
        });
        await page.waitForFunction(() => typeof fixture.releaseBarrier === "function");
        await page.locator("[data-ev-title]").fill("Название после напоминания"); await page.locator("[data-save-event]").click();
        const count = await page.evaluate(() => {
          const result = ZETER_NOTIFICATION_UTILS.collectDueCalendarReminderNotifications([{ desktopId: "desktop", events: state.desktops[0].data.events }], {
            now: new Date(`${fixture.today}T08:50:00`).getTime(), occursOn: ZETER_CALENDAR_UTILS.occursOn
          });
          fixture.releaseBarrier(); return result.notifications.length;
        });
        assert.equal(count, 1); await page.locator("#editor").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => state.desktops[0].data.events[0].title), "Название после напоминания");
        assert.equal(await page.evaluate(() => state.desktops[0].data.events[0].reminderNotifiedOccurrence), `${await page.evaluate(() => fixture.today)}|09:00|15`);
      }]
    ];
    for (const [name, check] of cases) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, serviceWorkers: "block" });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", route => {
        const url = route.request().url();
        if (!url.startsWith(preview.url)) return route.abort();
        if (url === preview.url) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="css/style.css"></head><body><main style="padding:16px;max-width:850px;margin:auto"></main></body></html>' });
        return route.continue();
      });
      try {
        await page.goto(preview.url); for (const file of files) await page.addScriptTag({ url: new URL(file, preview.url).href });
        await page.addScriptTag({ content: adapter });
        await page.evaluate(() => {
          window.state = { desktops: [{ id: "desktop", data: { events: [] } }, { id: "other", data: { events: [{ id: "sentinel", title: "Не менять" }] } }], fs: {} };
          window.fixture = { today: ZETER_CORE_UTILS.todayISO(), active: "desktop", toasts: [], writes: 0, refuse: false, hold: null, confirm: true };
          let serial = 0, chain = Promise.resolve(); window.uid = () => `event_${++serial}`;
          window.syncLegacyWorkspaceAliases = value => { value.events = value.desktops[0].data.events; };
          window.automationEventBaseline = new Map(); window.scheduleAutomationCheck = () => {};
          window.createAutomationRuntimeController = ZETER_AUTOMATION_UTILS.createAutomationRuntimeController;
          window.queueAutomationMutation = operation => { const run = chain.catch(() => {}).then(operation); chain = run.catch(() => {}); return run; };
          const queue = ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, cloneState: structuredClone, writesAllowed: () => true, nativeStorage: () => true,
            writePrimaryRecord: async snapshot => { fixture.writes++; if (fixture.hold) await new Promise(resolve => { fixture.hold.resolve = resolve; }); if (fixture.refuse) throw new Error("Искусственный отказ записи"); fixture.disk = structuredClone(snapshot); return { updatedAt: 1 }; } });
          window.persistSearchAwareTransaction = operation => queue.transaction(operation);
          fixture.queue = queue;
          const options = calendarPersistenceOptions("desktop"); fixture.controller = ZETER_CALENDAR_UTILS.createCalendarEventController(options);
          const common = { document, getCalendar: () => ({ selected: fixture.today, date: fixture.today, view: "month" }), getEvents: () => options.getWorkspace()?.events || [],
            saveEventRecord: (...args) => fixture.controller.saveEvent(...args), removeEvent: id => fixture.controller.removeEvent(id), onEventSaved: () => { syncLegacyWorkspaceAliases(state); if (fixture.raisePresentation) throw new Error("fixture presentation failure"); },
            todayISO: () => fixture.today, toast: (...args) => fixture.toasts.push(args), confirmUser: () => fixture.confirm, closeWindow: () => document.querySelector("#editor")?.remove() };
          fixture.mount = eventId => { const editor = ZETER_CALENDAR_UI_UTILS.createCalendarEventEditorApp({ eventId, date: fixture.today }, "test", common); editor.id = "editor"; document.querySelector("main").replaceChildren(editor); };
          fixture.mountCalendar = () => document.querySelector("main").replaceChildren(ZETER_CALENDAR_UI_UTILS.createCalendarApp(common));
          fixture.mount();
        });
        await check(page); assert.deepEqual(errors, []);
        results.push({ name, status: "PASS" }); console.log(`calendar browser PASS: ${name}`);
      } catch (error) {
        results.push({ name, status: "FAIL", error: error.message, pageErrors: errors });
        await page.screenshot({ path: path.join(out, `failure-${results.length}.png`), fullPage: true }); throw error;
      } finally { await context.close(); }
    }
  } finally {
    const fingerprints = Object.fromEntries([...files, "js/app.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "app", file))).digest("hex")]));
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ results, fingerprints }, null, 2));
    await browser?.close(); await preview.close();
  }
  return results;
}
module.exports = { runCalendarSmoke };
