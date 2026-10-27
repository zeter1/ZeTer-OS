"use strict";
// Explicit browser test. Import is inert; no native API or real state is used.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");

async function runTaskbarOverflowSmoke({ chromium, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/taskbar-overflow-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  let browser;
  const checks = [], errors = [];
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === "/js/app.js") {
        const seed = `if(!localStorage.getItem('overflow-fixture')){
          const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
          s.taskbarPinnedApps=['tasks','calendar','settings','contacts','editor','calculator'];
          ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);
          for(let i=1;i<=2;i++)s.fs['overflow-note-'+i]={id:'overflow-note-'+i,type:'note',name:'Проверочная заметка '+i,parent:'desktop',content:'Сохранить '+i,richContent:'',x:40,y:300,createdAt:1,updatedAt:1};
          s.notifications.push({id:'overflow-notice',title:'Тестовое уведомление',text:'Искусственные данные',icon:'ℹ️',read:false,createdAt:Date.now(),category:'system'});
          localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('overflow-fixture','1');}`;
        return route.fulfill({ contentType: "application/javascript", body: seed + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      }
      return route.continue();
    });
    await page.goto(preview.url);
    await page.locator("#boot").waitFor({ state: "hidden" });
    const button = page.locator("#taskbar-overflow-button"), panel = page.locator("#taskbar-overflow-panel"), home = page.locator("#mobile-home-button");
    const visible = async value => page.waitForFunction(expected => document.querySelector('#taskbar-overflow-button').hidden === !expected, value);
    await visible(true);
    assert.equal(await page.locator('.mobile-header #notifications-button').count(), 1);
    assert.equal(await page.locator('#notifications-button').count(), 1);
    const badge = await page.locator('#notif-count').innerText();
    await page.screenshot({ path: path.join(out, 'overflow-390.png') });
    await button.tap();
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.equal(await panel.locator('[data-overflow-app-id]').count(), 6, 'all idle pins are available');
    await page.screenshot({ path: path.join(out, 'apps-390.png') });
    await panel.locator('[data-overflow-app-id="settings"]').tap();
    assert.equal(await panel.isVisible(), false);
    const settings = page.locator('.window[data-app-id="settings"]');
    await settings.waitFor();
    const settingsId = await settings.getAttribute('data-win-id');
    await home.tap();
    await button.tap();
    const settingsRow = panel.locator(`[data-overflow-win-id="${settingsId}"]`);
    assert.match(await settingsRow.innerText(), /Свернуто/);
    await settingsRow.tap();
    assert.equal(await settings.getAttribute('class').then(s => s.includes('minimized')), false);
    assert.equal(await page.locator('.window[data-app-id="settings"]').count(), 1);
    checks.push('idle-pin-launch-and-minimized-window-restore');
    await home.tap();
    for (let i=1;i<=2;i++) {
      await page.locator(`#desktop-items [data-item-id="overflow-note-${i}"]`).tap();
      await home.tap();
    }
    const editors = await page.locator('.window[data-app-id="editor"]').evaluateAll(els => els.map(el => el.dataset.winId));
    assert.equal(editors.length, 2);
    await button.tap();
    for (const id of editors) assert.equal(await panel.locator(`[data-overflow-win-id="${id}"]`).count(), 1);
    await panel.locator(`[data-overflow-win-id="${editors[0]}"]`).tap();
    assert.equal(await page.locator(`.window[data-win-id="${editors[0]}"]`).getAttribute('class').then(s => s.includes('minimized')), false);
    checks.push('each-window-of-pinned-app-is-addressable');
    await button.tap();
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
    await button.tap();
    await page.locator('.mobile-header #notifications-button').tap();
    assert.equal(await panel.isVisible(), false);
    assert.equal(await page.locator('#notification-center').isVisible(), true);
    await home.tap();
    assert.equal(await page.locator('#notif-count').innerText(), badge);
    checks.push('escape-focus-outside-close-notifications-badge');
    // Remove open windows first; then test the pin-only overflow boundary in both directions.
    for (const id of [...editors, settingsId]) {
      await button.tap();
      await panel.locator(`[data-overflow-win-id="${id}"]`).tap();
      const win=page.locator(`.window[data-win-id="${id}"]`);
      await win.locator('[data-win="close"]').tap();
      await win.waitFor({state:'detached'});
    }
    await page.setViewportSize({width:430,height:932});
    await visible(false);
    await page.setViewportSize({width:390,height:844});
    await visible(true);
    await button.tap();
    await page.setViewportSize({width:844,height:390});
    await visible(false);
    assert.equal(await panel.isVisible(), false);
    await page.setViewportSize({width:320,height:568});
    await visible(true);
    await button.tap();
    const box=await panel.boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=320 && box.y>=44 && box.y+box.height<=500,'panel stays within phone workspace');
    await page.screenshot({path:path.join(out,'apps-320.png')});
    checks.push('overflow-appears-and-disappears-on-resize-without-sticking');
    await home.tap();
    // Real pin/unpin actions must update overflow without reloading.
    for (const appId of ['settings','contacts','editor','calculator']) {
      const pin=page.locator(`#taskbar [data-taskbar-pinned-app="${appId}"]`);
      await pin.click({button:'right'});
      await page.locator('#context-menu button').filter({hasText:'Открепить'}).click();
    }
    await visible(false);
    checks.push('unpin-recomputes-overflow-immediately');
    await page.setViewportSize({width:1440,height:900});
    await page.emulateMedia({media:'screen'});
    await visible(false);
    await page.waitForFunction(()=>document.querySelector('#notifications-button').parentElement.id==='taskbar');
    assert.equal(await page.locator('#taskbar #notifications-button').count(),1);
    assert.equal(await page.locator('#notif-count').innerText(),badge);
    assert.equal(await page.locator('.taskbar-search').isVisible(),true);
    await page.screenshot({path:path.join(out,'desktop-1440.png')});
    checks.push('desktop-bell-location-and-taskbar-retained');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));
    console.log(`taskbar overflow UI: PASS (${checks.length} scenarios, 0 JS errors)`);
    return {checks,out};
  } finally { await browser?.close(); await preview.close(); }
}
module.exports = { runTaskbarOverflowSmoke };
