"use strict";
// Explicit browser run, isolated synthetic state, native delivery double. Import is inert.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runSystemNotificationsSmoke({ chromium, startPreview, outputDir, browserExecutable } = {}) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/system-notifications-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "web-release.json"], ttlSeconds: 600 });
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const seed = `
      window.__systemCalls=[];
      const notificationOwner=window.ZETER_NOTIFICATION_UI_UTILS;
      window.ZETER_NOTIFICATION_UI_UTILS={...notificationOwner,createSystemNotificationController:options=>notificationOwner.createSystemNotificationController({...options,isNative:()=>true,nativeSend:async payload=>{
        window.__systemCalls.push(payload);
        if(window.__deliveryRefuse)throw new Error('Тест: Windows запретила уведомление');
        return {submitted:true};
      }})};
      const storageOwner=window.ZETER_STORAGE_UTILS;
      window.ZETER_STORAGE_UTILS={...storageOwner,createPrimaryStateSaveQueue:options=>{const q=storageOwner.createPrimaryStateSaveQueue(options);return {...q,transaction:operation=>q.transaction(write=>operation(async(snapshot,opts)=>{
        if(window.__saveRefuse)throw new Error('Тест: отказ сохранения');
        const result=await write(snapshot,opts);window.__savedNotificationState=snapshot;return result;
      }))};}};
      if(!localStorage.getItem('system-notification-fixture')){
        const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
        s.fs['notification-sentinel']={id:'notification-sentinel',type:'note',name:'Сохранить.txt',content:'Соседний текст',parent:'desktop',createdAt:1,updatedAt:1};
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('system-notification-fixture','1');
      }
    `;
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") {
        const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
        const anchor = "  driveIncomingUiController = notificationUiUtils.createDriveIncomingController({";
        assert.ok(source.includes(anchor));
        return route.fulfill({ contentType: "application/javascript", body: seed + source.replace(anchor, "  window.__createNotificationFixture = addNotification; window.__readNotificationFixture = () => JSON.parse(JSON.stringify(state));\n" + anchor) });
      }
      return route.continue();
    });
    const open = async () => {
      await page.locator('[data-top-action="settings"]').click();
      await page.locator('.settings [data-settings-section="notifications"]').last().click();
    };
    const settled = () => page.waitForFunction(() => ['saved','fallback'].includes(document.querySelector('[data-settings-save-status]')?.dataset.saveState));
    const checkbox = () => page.locator('[data-system-setting="notifications.systemDelivery"]').last();
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    assert.equal(await checkbox().isChecked(), false);
    await page.evaluate(() => window.__createNotificationFixture('До включения','Останется только внутри'));
    assert.equal(await page.evaluate(() => window.__systemCalls.length), 0);
    await checkbox().check(); await settled();
    assert.equal(await page.evaluate(() => window.__systemCalls.length), 0, 'enabling must not replay history');
    await page.evaluate(() => { window.__createNotificationFixture('Первое','Русский текст'); window.__createNotificationFixture('Второе','Другое сообщение'); });
    await page.waitForFunction(() => window.__systemCalls.length === 2);
    await page.locator('[data-system-notification-test]').click();
    await page.waitForFunction(() => document.querySelector('[data-system-notification-status]').textContent.includes('Проверочное уведомление передано'));
    await page.evaluate(() => { window.__deliveryRefuse=true; window.__createNotificationFixture('Отказ Windows','Не терять запись'); });
    await page.waitForFunction(() => document.querySelector('[data-system-notification-status]').textContent.includes('Windows запретила'));
    await page.locator('[data-system-notification-test]').click();
    assert.match(await page.locator('[data-system-notification-status]').innerText(), /Windows запретила/);
    await page.evaluate(() => { window.__deliveryRefuse=false; });
    await page.locator('[data-system-notification-test]').click();
    await page.waitForFunction(() => document.querySelector('[data-system-notification-status]').textContent.includes('Проверочное уведомление передано'));
    await page.evaluate(() => { window.__saveRefuse=true; });
    await checkbox().uncheck();
    await page.waitForFunction(() => document.querySelector('[data-settings-save-status]')?.dataset.saveState === 'error');
    await page.evaluate(() => { window.__saveRefuse=false; });
    await page.locator('[data-settings-retry]').click(); await settled();
    assert.equal(await checkbox().isChecked(), false);
    await checkbox().check(); await settled();
    await page.reload(); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    assert.equal(await checkbox().isChecked(), true);
    assert.equal(await page.evaluate(() => window.__systemCalls.length), 0, 'reload must not replay history');
    await page.evaluate(() => window.__createNotificationFixture('После reload','Проверить сохранившиеся данные'));
    await page.waitForFunction(() => window.__systemCalls.length === 1);
    const state = await page.evaluate(() => window.__readNotificationFixture());
    assert.equal(state.fs['notification-sentinel'].content, 'Соседний текст');
    assert.ok(state.desktops[0].data.notifications.some(n => n.title === 'Отказ Windows'), 'delivery failure must preserve center record');
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: 900 });
      const control = checkbox(); await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      const test = page.locator('[data-system-notification-test]').last(); await test.scrollIntoViewIfNeeded();
      const button = await test.boundingBox(); assert.ok(button.x >= 0 && button.x + button.width <= width);
      await test.focus(); assert.equal(await test.evaluate(el => el === document.activeElement), true);
      await page.screenshot({ path: path.join(out, `notifications-${width}.png`) });
      results.push({ width, visibleControls: true });
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ pass: true, results, realWindowsToast: "NOT_VERIFIED", nativeTransport: "double", realData: false }, null, 2));
    console.log("system notification UI: PASS (opt-in/save/reload, no replay, failure/retry, neighbor data, keyboard, 1440/390/320)");
  } catch (error) {
    fs.writeFileSync(path.join(out, "failure.json"), JSON.stringify({ error: error.message, results }, null, 2));
    throw error;
  } finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runSystemNotificationsSmoke };
