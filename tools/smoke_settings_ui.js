"use strict";

// Explicit browser check: isolated context, synthetic state, no native API or external network.
// Importing this module does not start the app or write state.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runSettingsSmoke({ chromium, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/settings-design-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const seed = `const storageOwner=window.ZETER_STORAGE_UTILS;
      const visualOwner=window.ZETER_VISUAL_UTILS;
      window.ZETER_VISUAL_UTILS={...visualOwner,createCustomWallpaperFromFile:async file=>{
        if(window.__settingsHoldAsset)await new Promise(resolve=>{window.__settingsReleaseAsset=()=>{window.__settingsHoldAsset=false;resolve();};});
        return visualOwner.createCustomWallpaperFromFile(file);
      }};
      window.ZETER_STORAGE_UTILS={...storageOwner,createPrimaryStateSaveQueue:options=>{const queue=storageOwner.createPrimaryStateSaveQueue(options);return {...queue,transaction:operation=>queue.transaction(write=>operation(async(snapshot,writeOptions)=>{
        window.__settingsWriteAttempts=(window.__settingsWriteAttempts||0)+1;
        if(window.__settingsHold)await new Promise(resolve=>{window.__settingsRelease=()=>{window.__settingsHold=false;resolve();};});
        if(window.__settingsRefuse)throw new Error('Тест: запись недоступна');
        const result=await write(snapshot,writeOptions);window.__settingsSaved=snapshot;return window.__settingsFallback?{...result,fallback:true}:result;
      }))};}};
      if (!localStorage.getItem('settings-design-fixture')) {
      const s = ZETER_INITIAL_STATE_UTILS.defaultState(); s.firstRunCompleted = true;
      s.desktops[0].name = 'Вайбкодинг, программирование и нейросети';
      s.desktops.push({id:'settings-other',name:'Другой тестовый стол',description:'Сохранить профиль',data:ZETER_WORKSPACE_UTILS.workspaceDefaults()});
      for(let i=0;i<6;i++)s.fs['label-'+i]={id:'label-'+i,type:'note',name:'Очень длинное русское название документа для проверки подписи '+i+'.txt',parent:'desktop',content:'Сохранить содержимое '+i,richContent:'',x:20,y:20,createdAt:1,updatedAt:1};
      localStorage.setItem('zeter_os_state_v3', JSON.stringify(s));
      localStorage.setItem('settings-design-fixture', '1');
    }`;
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      return route.continue();
    });
    await page.goto(preview.url);
    await page.locator("#boot").waitFor({ state: "hidden" });
    await page.locator('[data-top-action="settings"]').click();
    const settings = page.locator(".settings").last();
    const nav = settings.locator("[data-settings-section]");
    assert.equal(await nav.count(), 7, "settings must expose seven named sections");
    const settled = async () => page.waitForFunction(() => ['saved','fallback'].includes(document.querySelector('[data-settings-save-status]')?.dataset.saveState));
    const choose = async id => {
      await settings.locator(`[data-settings-section="${id}"]`).click();
      assert.equal(await settings.locator(`[data-settings-section="${id}"]`).getAttribute("aria-pressed"), "true");
      assert.ok(await settings.locator(`[data-settings-panel="${id}"]`).first().isVisible());
      assert.equal(await settings.locator(`[data-settings-panel]:not([data-settings-panel="${id}"]):visible`).count(), 0);
      assert.equal(await settings.evaluate(el => el.closest('.window-body').scrollTop), 0, "new section must start at its heading");
    };
    // Serial ACK with newer intent, focus stability, explicit retry and fallback status.
    const search = settings.locator('[data-settings-search]');
    await search.fill('подпись');
    await settings.locator('[data-settings-search-result="desktop.desktopAppearance.labelSize"]').click();
    assert.equal(await settings.locator('[data-desktop-appearance="labelSize"]').evaluate(el => el === document.activeElement), true);
    await search.fill('несуществующийпараметр');
    assert.match(await settings.locator('[data-settings-search-results]').innerText(), /Ничего не найдено/);
    await search.press('Escape');
    assert.equal(await search.inputValue(), '');
    await search.fill('горячие клавиши');
    assert.equal(await settings.locator('[data-settings-search-result^="system.hotkeys."]').count(), 7);
    await settings.locator('[data-settings-search-result="system.hotkeys.search"]').click();
    assert.equal(await settings.locator('[data-hotkey-capture="search"]').evaluate(el=>el===document.activeElement),true);
    await search.fill('сохранение');
    assert.ok(await settings.locator('[data-settings-search-result="action.storageSave"]').count());
    await settings.locator('[data-settings-search-result="action.storageSave"]').click();
    assert.equal(await settings.locator('[data-storage-save]').evaluate(el=>el===document.activeElement),true);
    await choose('accessibility');
    await page.evaluate(() => { window.__settingsHold = true; });
    const scale = settings.locator('[data-system-setting="accessibility.textScale"]');
    await scale.selectOption('130');
    await page.waitForFunction(() => typeof window.__settingsRelease === 'function');
    await scale.selectOption('150');
    await settings.locator('[data-system-setting="accessibility.largeControls"]').check();
    await scale.focus();
    assert.equal(await settings.locator('[data-settings-save-status]').getAttribute('data-save-state'), 'saving');
    assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--zeter-text-scale')), '');
    await page.evaluate(() => window.__settingsRelease());
    await settled();
    assert.equal(await scale.inputValue(), '150');
    assert.equal(await scale.evaluate(el => el === document.activeElement), true);
    assert.equal(await page.evaluate(() => window.__settingsSaved.systemSettings.accessibility.textScale), 150);
    assert.equal(await page.evaluate(() => window.__settingsSaved.systemSettings.accessibility.largeControls), true);
    await scale.selectOption('100');
    await settings.locator('[data-system-setting="accessibility.largeControls"]').uncheck(); await settled();
    await choose('appearance');
    await page.evaluate(() => { window.__settingsRefuse = true; });
    await settings.locator('[data-settings-accent="violet"]').click();
    await page.waitForFunction(() => document.querySelector('[data-settings-save-status]')?.dataset.saveState === 'error');
    assert.equal(await settings.locator('[data-settings-accent="violet"]').getAttribute('aria-pressed'), 'true');
    const attempts = await page.evaluate(() => window.__settingsWriteAttempts);
    await search.fill('цвет');
    assert.equal(await page.evaluate(() => window.__settingsWriteAttempts), attempts, 'refused batch does not auto retry');
    await search.press('Escape');
    await page.evaluate(() => { window.__settingsRefuse = false; window.__settingsFallback = true; });
    await settings.locator('[data-settings-retry]').click(); await settled();
    assert.equal(await settings.locator('[data-settings-save-status]').getAttribute('data-save-state'), 'fallback');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '#b8a0ff');
    await page.evaluate(() => { window.__settingsFallback = false; });
    // Full label geometry and safe single-click activation, preserving names/content.
    await settings.locator('[data-desktop-appearance="labelSize"]').selectOption('large');
    await settings.locator('[data-desktop-appearance="labelLines"]').selectOption('2'); await settled();
    const iconState = await page.locator('.desktop-items .desktop-icon').evaluateAll(icons => icons.map(icon => {
      const r = icon.getBoundingClientRect(), label = icon.querySelector('.label'), css = getComputedStyle(label);
      return { id: icon.dataset.itemId, x:r.x,y:r.y,w:r.width,h:r.height,font:css.fontSize,clamp:css.webkitLineClamp,lh:parseFloat(css.lineHeight),labelH:label.getBoundingClientRect().height };
    }));
    assert.ok(iconState.length >= 6);
    for (const icon of iconState) { assert.equal(icon.font,'14px'); assert.equal(icon.clamp,'2'); assert.ok(icon.labelH <= icon.lh * 2 + 1); }
    for (let i=0;i<iconState.length;i++) for(let j=i+1;j<iconState.length;j++) {
      const a=iconState[i],b=iconState[j]; assert.ok(a.x+a.w<=b.x+1 || b.x+b.w<=a.x+1 || a.y+a.h<=b.y+1 || b.y+b.h<=a.y+1,'desktop labels must not overlap');
    }
    await settings.locator('[data-desktop-appearance="openMode"]').selectOption('single'); await settled();
    const beforeWindows = await page.locator('.window').count();
    await page.evaluate(() => document.querySelector('.settings').closest('.window').style.pointerEvents='none');
    const icon = page.locator('.desktop-icon[data-item-id="label-0"]');
    await icon.click({ modifiers:['Control'] });
    assert.equal(await page.locator('.window').count(),beforeWindows);
    await icon.dblclick();
    assert.equal(await page.locator('.window').count(),beforeWindows+1,'double event series in single mode opens once');
    await page.locator('.window.active [data-win="close"]').click();
    await page.waitForFunction(count=>document.querySelectorAll('.window').length===count,beforeWindows);
    await page.evaluate(() => document.querySelector('.settings').closest('.window').style.pointerEvents='auto');
    await settings.locator('[data-desktop-appearance="openMode"]').selectOption('double'); await settled();
    await choose('time');
    await settings.locator('[data-system-setting="clock.format"]').selectOption('12h');
    await settings.locator('[data-system-setting="clock.showSeconds"]').check();
    await settings.locator('[data-system-setting="clock.showDate"]').uncheck();
    await settings.locator('[data-system-setting="calendar.weekStart"]').selectOption('sunday'); await settled();
    assert.match(await page.locator('#clock').innerText(), /^\d{2}:\d{2}:\d{2} (AM|PM)$/);
    assert.equal(await page.locator('#date-line').isVisible(),false);
    await page.locator('[data-app="calendar"]:visible').first().click();
    const calendar = page.locator('.calendar-app');
    assert.equal(await calendar.locator('.weekday').first().innerText(),'Вс');
    await page.locator('.window.active [data-win="close"]').click();
    await choose('time');
    await settings.locator('[data-system-setting="calendar.weekStart"]').selectOption('monday'); await settled();
    await choose('appearance');
    await settings.locator("[data-desktop-name]").fill("Тестовый рабочий стол");
    assert.ok(await settings.evaluate(el => { const body = el.closest('.window-body'); body.scrollTop = 200; return body.scrollTop > 0; }), "fixture must start scrolled");
    await choose("notifications");
    await settings.locator('[data-system-setting="notifications.enabled"]').uncheck();
    await page.waitForFunction(() => document.querySelector('[data-system-setting="notifications.tasks"]')?.disabled);
    assert.equal(await settings.locator('[data-settings-section="notifications"]').getAttribute("aria-pressed"), "true", "refresh must retain section");
    await settings.locator('[data-system-setting="notifications.enabled"]').check();
    await page.waitForFunction(() => !document.querySelector('[data-system-setting="notifications.tasks"]')?.disabled);
    await settings.locator('[data-system-setting="notifications.quietHoursEnabled"]').check();
    await settings.locator('[data-system-setting="notifications.quietFrom"]').fill("21:30");
    await choose("appearance");
    assert.equal(await settings.locator("[data-desktop-name]").inputValue(), "Тестовый рабочий стол");
    await settings.locator('[data-wall="mint"]').click();
    await settled();
    assert.equal(await settings.locator('[data-wall="mint"]').getAttribute("aria-pressed"), "true");
    await settings.locator('[data-wall-file]').setInputFiles({ name: "Тестовые обои.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
    await settings.locator('[data-wall-clear]').waitFor();
    assert.equal(await settings.locator('[data-settings-section="appearance"]').getAttribute("aria-pressed"), "true");
    assert.equal(await settings.locator('[data-wall="custom"]').getAttribute("aria-pressed"), "true");
    await settings.locator('[data-wall-clear]').click();
    await settings.locator('[data-wall="mint"]').click();
    await settled();
    await settings.locator('[data-wall-file]').setInputFiles({name:'Сохранить при сбросе.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
    await settled();
    // Decode completion on another desktop must still publish to the captured owner.
    await page.evaluate(()=>{window.__settingsHoldAsset=true;});
    await settings.locator('[data-wall-file]').setInputFiles({name:'Адрес только первого стола.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
    await page.waitForFunction(()=>typeof window.__settingsReleaseAsset==='function');
    const switchDesktop=async id=>{if(!await page.locator('#start-menu').isVisible())await page.locator('#start-button').click();await page.locator(`[data-switch-desktop="${id}"]`).click();if(await page.locator('#start-menu').isVisible())await page.locator('#start-button').click();};
    await switchDesktop('settings-other');
    await page.locator('[data-top-action="settings"]').click();
    assert.equal(await settings.locator('[data-desktop-name]').inputValue(),'Другой тестовый стол');
    await page.evaluate(()=>window.__settingsReleaseAsset());
    await page.waitForFunction(()=>window.__settingsSaved?.desktops.find(d=>d.id==='desktop')?.data.settings.customWallpaper?.name==='Адрес только первого стола.png');
    assert.equal(await settings.locator('[data-desktop-name]').inputValue(),'Другой тестовый стол');
    assert.equal(await settings.locator('[data-wall-clear]').count(),0,'upload never lands on newly selected desktop');
    await switchDesktop('desktop');
    await choose('appearance');
    await settled();
    await settings.locator('[data-settings-reset]').click();
    await settings.locator('[data-settings-reset-yes]').click(); await settled();
    assert.equal(await settings.locator('[data-desktop-name]').inputValue(),'Тестовый рабочий стол');
    assert.equal(await settings.locator('[data-wall-clear]').isVisible(),true,'reset keeps uploaded image');
    assert.equal(await settings.locator('[data-wall="aurora"]').getAttribute('aria-pressed'),'true');
    assert.equal(await settings.locator('[data-settings-accent="blue"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>window.__settingsSaved.fs['label-0'].content),'Сохранить содержимое 0');
    await settings.locator('[data-wall="mint"]').click(); await settled();
    const size = settings.locator('[data-system-setting="windows.openingSize"]');
    await size.selectOption("compact");
    await settled();
    await size.selectOption("full");
    await settled();
    // Real runtime placement: move → close → reopen, then cascade different apps.
    await size.selectOption('compact'); await settled();
    await settings.locator('[data-system-setting="windows.placement"]').selectOption('last'); await settled();
    const openCalendar = async () => { await page.locator('[data-app="calendar"]:visible').first().click(); return page.locator('.window.active'); };
    let calendarWindow = await openCalendar();
    const handle = calendarWindow.locator('.window-titlebar');
    const handleRect = await handle.boundingBox();
    await page.mouse.move(handleRect.x+90,handleRect.y+22); await page.mouse.down(); await page.mouse.move(handleRect.x+150,handleRect.y+62,{steps:5}); await page.mouse.up();
    const moved = await calendarWindow.evaluate(el=>({left:el.style.left,top:el.style.top}));
    await calendarWindow.locator('[data-win="close"]').click();
    await page.waitForFunction(()=>!document.querySelector('.calendar-app'));
    calendarWindow = await openCalendar();
    assert.deepEqual(await calendarWindow.evaluate(el=>({left:el.style.left,top:el.style.top})),moved,'last placement survives closing window');
    await calendarWindow.locator('[data-win="close"]').click();
    await choose('appearance');
    await settings.locator('[data-system-setting="windows.placement"]').selectOption('cascade'); await settled();
    calendarWindow = await openCalendar();
    const cascadeA=await calendarWindow.evaluate(el=>({left:el.style.left,top:el.style.top}));
    await page.locator('[data-app="tasks"]:visible').first().click();
    const cascadeB=await page.locator('.window.active').evaluate(el=>({left:el.style.left,top:el.style.top}));
    assert.notDeepEqual(cascadeA,cascadeB,'cascade positions different new applications separately');
    await page.locator('.window.active [data-win="close"]').click();
    await page.locator('.calendar-app').locator('..').locator('..').locator('[data-win="close"]').click();
    await choose('appearance');
    await settings.locator('[data-system-setting="windows.placement"]').selectOption('last');
    await size.selectOption('full'); await settled();
    await page.screenshot({ path: path.join(out, "settings-desktop.png"), style: ".toast-stack { visibility: hidden; }" });
    for (const id of ["startup", "accessibility", "hotkeys", "storage"]) await choose(id);
    await choose("hotkeys");
    await settings.locator("[data-hotkey-capture]").first().click();
    await page.keyboard.press("Escape");
    assert.equal(await settings.locator('[data-settings-section="hotkeys"]').getAttribute("aria-pressed"), "true");
    assert.equal(await settings.locator(".capturing").count(), 0);
    await settings.locator('[data-settings-section="appearance"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await settings.locator('[data-settings-section="appearance"]').getAttribute("aria-pressed"), "true");
    const focusable = settings.locator('button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled), textarea:visible:not(:disabled)');
    for (let index = 1; index < await focusable.count(); index++) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[data-settings-panel][hidden]'))), false, "Tab must skip hidden panels");
    }
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[data-settings-panel][hidden]'))), false, "Shift+Tab must skip hidden panels");
    }
    // Container resizing within a wide viewport, then an actual narrow viewport.
    for (const width of [850, 560, 374, 304]) {
      await settings.locator("..").evaluate((body, width) => {
        const win = body.closest(".window"); win.style.width = width + "px"; win.style.left = "0px";
      }, width);
      for (const id of ["appearance", "notifications", "hotkeys", "storage"]) {
        await choose(id);
        assert.ok(await settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${id} must fit ${width}px window`);
        assert.ok(await settings.locator(".settings-content").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Width stress above deliberately preserves the tall desktop window. Give the narrow fixture
    // an explicit reachable height, as resizing the browser doesn't resize existing app windows.
    await settings.evaluate(el => { const win = el.closest('.window'); win.style.height = '680px'; win.style.top = '0px'; });
    await choose("appearance");
    await page.screenshot({ path: path.join(out, "settings-390.png"), style: ".toast-stack { visibility: hidden; }" });
    await page.setViewportSize({ width: 320, height: 760 });
    await settings.evaluate(el => { el.closest('.window').style.height = '620px'; });
    for (const id of ["appearance", "startup", "notifications", "accessibility", "hotkeys", "storage"]) {
      await choose(id);
      assert.ok(await settings.locator(".settings-content").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${id} must fit 320px viewport`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await choose("accessibility");
    await settings.locator('[data-system-setting="accessibility.textScale"]').selectOption("150");
    await settings.locator('[data-system-setting="accessibility.largeControls"]').check();
    await settings.locator('[data-system-setting="accessibility.highContrast"]').check();
    await choose("hotkeys");
    assert.ok(await settings.locator(".settings-content").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    fs.writeFileSync(path.join(out, "accessibility-geometry.json"), JSON.stringify(await settings.evaluate(el => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      const ancestors = []; for (let node = el; node; node = node.parentElement) ancestors.push({ className: node.className, scrollLeft: node.scrollLeft, scrollTop: node.scrollTop });
      return { viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY }, window: rect(el.closest('.window')), settings: rect(el), body: rect(el.closest('.window-body')), ancestors };
    }), null, 2));
    await page.screenshot({ path: path.join(out, "settings-accessibility-390.png"), style: ".toast-stack { visibility: hidden; }" });
    await settled();
    await page.reload();
    await page.locator("#boot").waitFor({ state: "hidden" });
    if (!await settings.count()) await page.locator('[data-top-action="settings"]').click();
    await choose("appearance");
    assert.equal(await settings.locator("[data-desktop-name]").inputValue(), "Тестовый рабочий стол");
    assert.equal(await settings.locator('[data-wall="mint"]').getAttribute("aria-pressed"), "true");
    await choose("notifications");
    assert.equal(await settings.locator('[data-system-setting="notifications.quietFrom"]').inputValue(), "21:30");
    assert.deepEqual(errors, []);
    console.log("settings UI: PASS (navigation, rerender, keyboard, window preview, persistence, responsive, accessibility; 0 JS errors)");
    return { outputDir: out };
  } finally {
    await browser?.close();
    await preview.close();
  }
}

module.exports = { runSettingsSmoke };
