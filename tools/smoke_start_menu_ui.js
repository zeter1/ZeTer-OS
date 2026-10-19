"use strict";

// Explicit browser regression: a fresh context, synthetic state and a public-only preview.
// Requiring this file has no startup or storage side effects.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runStartMenuSmoke({ chromium, startPreview, outputDir } = {}) {
  assert.ok(chromium && startPreview);
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/start-menu-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  let browser, page;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const seed = `
      const realStorage = window.ZETER_STORAGE_UTILS;
      window.ZETER_STORAGE_UTILS = {...realStorage, createPrimaryStateSaveQueue: options => {
        const queue = realStorage.createPrimaryStateSaveQueue(options);
        return {...queue, transaction: operation => queue.transaction(write => operation(async snapshot => {
          window.__startWriteCount = (window.__startWriteCount || 0) + 1;
          if (window.__holdStartWrite) await new Promise(resolve => { window.__releaseStartWrite = resolve; });
          if (window.__refuseStartWrite) throw new Error('Synthetic storage refusal');
          const result = await write(snapshot); window.__startSaved = snapshot; return result;
        }))};
      }};
      if (!localStorage.getItem('start-menu-fixture')) {
        const s = ZETER_INITIAL_STATE_UTILS.defaultState();
        s.firstRunCompleted = true;
        s.systemSettings.startMenu = ZETER_SYSTEM_SETTINGS_UTILS.normalizeStartMenuPreferences({
          recentItems: [{id:'recent-other', openedAt:200}, {id:'recent-note', openedAt:100}]
        });
        s.desktops.push({id:'test-other', name:'Вайбкодинг, программирование и очень длинное название пространства', description:'Другой стол', data:ZETER_WORKSPACE_UTILS.workspaceDefaults()});
        s.fs['recent-note'] = {id:'recent-note',type:'note',name:'План <проекта>',parent:'desktop',content:'Тестовый документ',richContent:'',createdAt:10,updatedAt:10};
        s.fs['recent-other'] = {id:'recent-other',type:'note',name:'Документ другого стола',parent:'test-other',content:'Второй документ',richContent:'',createdAt:10,updatedAt:10};
        s.fs['pinned-note'] = {id:'pinned-note',type:'note',name:'Закреплённая заметка с длинным названием',parent:'desktop',content:'Текст',richContent:'',pinnedInStart:true,startPinnedAt:10,createdAt:10,updatedAt:10};
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(s)); localStorage.setItem('start-menu-fixture','1');
      }
    `;
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      return route.continue();
    });
    await page.goto(preview.url);
    await page.locator("#boot").waitFor({ state: "hidden" });
    const menu = page.locator("#start-menu");
    const settings = page.locator("#start-settings");
    const open = async () => { if (!await menu.isVisible()) await page.locator("#start-button").click(); };
    const saved = async (key, value) => {
      await page.waitForFunction(({ key, value }) => window.__startSaved?.systemSettings?.startMenu?.[key] === value, { key, value });
      await page.waitForFunction(() => document.querySelector('#start-preferences')?.getAttribute('aria-busy') !== 'true');
    };
    const pref = key => page.locator(`[data-start-pref="${key}"]`);
    await open();
    assert.equal(await settings.getAttribute("aria-controls"), "start-preferences");
    assert.equal((await settings.innerText()).replace("⚙", "").trim(), "Настройки");
    assert.equal(await page.locator("[data-start-recent]").count(), 2);
    assert.equal(await page.locator(".start-desktop-delete").count(), 0);
    await page.screenshot({ path: path.join(out, "start-desktop.png") });

    // Keyboard reordering must survive a real persisted reload.
    const firstPin = await page.locator("[data-start-pin]").first().getAttribute("data-start-pin");
    await page.locator("[data-start-pin]").first().focus();
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForFunction(key => window.__startSaved?.systemSettings.startMenu.pinOrder[1] === key, firstPin);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.startPin), firstPin, "Background pin-order save must keep focus for the next Alt+arrow");
    await settings.click();
    // A held persistence acknowledgement must never lock the next selection.
    const writesBeforeBurst = await page.evaluate(() => window.__startWriteCount || 0);
    await page.evaluate(() => { window.__holdStartWrite = true; window.__releaseStartWrite = null; });
    await pref("layout").selectOption("compact");
    await page.waitForFunction(() => typeof window.__releaseStartWrite === 'function');
    assert.equal(await pref("iconSize").isEnabled(), true, "A pending disk write must not disable other Start settings");
    await pref("iconSize").selectOption("large");
    await pref("showPinned").uncheck();
    await pref("showPinned").check();
    assert.equal(await pref("iconSize").inputValue(), "large", "Preview must apply the latest selection before storage acknowledgement");
    assert.equal(await page.evaluate(() => window.__startWriteCount), writesBeforeBurst + 1, "Only the first batch may be in storage while later changes are still accumulating");
    const stableInput = await pref("iconSize").elementHandle();
    await page.keyboard.press("Escape");
    await settings.click();
    assert.equal(await pref("iconSize").inputValue(), "large", "Closing the panel must retain an unsaved choice while storage is pending");
    await pref("iconSize").focus();
    await page.screenshot({ path:path.join(out, "settings-pending.png") });
    await page.evaluate(() => { window.__holdStartWrite = false; window.__releaseStartWrite(); });
    await saved("iconSize", "large");
    assert.equal(await page.evaluate(() => window.__startWriteCount), writesBeforeBurst + 2, "A burst must coalesce into one additional write");
    assert.equal(await stableInput.evaluate(input => input.isConnected && input === document.activeElement), true, "Background acknowledgements must preserve the input and focus");
    await pref("layout").selectOption("compact"); await saved("layout", "compact");
    await pref("iconSize").selectOption("large"); await saved("iconSize", "large");
    await page.screenshot({ path: path.join(out, "start-settings.png") });
    await page.reload(); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    assert.equal(await page.locator("[data-start-pin]").nth(1).getAttribute("data-start-pin"), firstPin);
    await settings.click();
    assert.equal(await pref("layout").inputValue(), "compact");
    assert.equal(await pref("iconSize").inputValue(), "large");

    // Refusal retains the latest draft with an explicit retry; no false saved state.
    const confirmedBeforeRefusal = await page.evaluate(() => JSON.stringify(window.__startSaved));
    await page.evaluate(() => { window.__refuseStartWrite = true; });
    await pref("showDesktops").click();
    await page.locator(".start-settings-error").waitFor();
    assert.equal(await pref("showDesktops").isChecked(), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__startSaved)), confirmedBeforeRefusal, "Failed draft must not publish a successful snapshot");
    assert.equal(await pref("iconSize").isEnabled(), true);
    await page.evaluate(() => { window.__refuseStartWrite = false; });
    await page.locator('[data-start-settings-retry]').click(); await saved("showDesktops", false);
    await page.evaluate(() => { window.__refuseStartWrite = true; });
    await pref("showDesktops").check();
    await page.locator(".start-settings-error").waitFor();
    await page.locator('[data-start-settings-discard]').click();
    assert.equal(await pref("showDesktops").isChecked(), false, "Discard must restore the last confirmed choice");
    await page.evaluate(() => { window.__refuseStartWrite = false; });
    await pref("showDesktops").check(); await saved("showDesktops", true);
    for (const key of ["showPinned", "showRecent", "showDesktops", "showQuickActions"]) { await pref(key).uncheck(); await saved(key, false); }
    await page.keyboard.press("Escape");
    assert.equal(await menu.isVisible(), true);
    assert.equal(await settings.evaluate(el => el === document.activeElement), true);
    assert.equal(await settings.isVisible(), true);
    await settings.click();
    for (const key of ["showPinned", "showRecent", "showDesktops", "showQuickActions"]) { await pref(key).check(); await saved(key, true); }
    await pref("layout").selectOption("balanced"); await saved("layout", "balanced");
    await page.keyboard.press("Escape");

    // Content bounds, title wrapping and footer availability across viewport shapes.
    for (const [width, height] of [[1440,1000],[1280,720],[920,600],[390,844]]) {
      await page.setViewportSize({ width, height });
      await menu.evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
      const bounds = await menu.evaluate(el => {
        const r = el.getBoundingClientRect(), footer = el.querySelector('.start-footer').getBoundingClientRect();
        return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight,
          overflow:el.scrollWidth-el.clientWidth, footerBottom:footer.bottom };
      });
      assert.ok(bounds.left >= -1 && bounds.right <= width+1 && bounds.top >= -1 && bounds.bottom <= height+1, JSON.stringify(bounds));
      assert.ok(bounds.overflow <= 1, "Start horizontal overflow: " + JSON.stringify(bounds));
      assert.ok(bounds.footerBottom <= height, "Footer must remain reachable");
      await page.screenshot({ path:path.join(out, `start-${width}.png`) });
      await settings.click();
      assert.ok(await pref("layout").isVisible());
      await page.screenshot({ path:path.join(out, `settings-${width}.png`) });
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width:1440,height:1000 });
    const draggedPin = await page.locator('[data-start-pin]').first().getAttribute('data-start-pin');
    await page.locator('[data-start-pin]').first().dragTo(page.locator('[data-start-pin]').nth(1));
    await page.waitForFunction(key => window.__startSaved?.systemSettings.startMenu.pinOrder[1] === key, draggedPin);
    // Catalog and shared search including commands and file name escaping.
    await page.locator("#start-all-apps").click();
    await page.locator('[data-start-category="system"]').click();
    assert.ok(await page.locator("[data-start-app]").count() > 0);
    await page.locator("#start-search-input").fill("настройки");
    await page.locator("#start-search-input").press("ArrowUp");
    assert.equal(await page.locator('[data-search-kind]').last().evaluate(el => el === document.activeElement), true, "ArrowUp from search selects the last result");
    await page.locator("#start-search-input").fill("План");
    await page.locator('[data-search-kind="item"][data-id="recent-note"]').waitFor();
    assert.ok((await page.locator("#start-pinned").innerText()).includes("План <проекта>"));
    await page.locator("#start-search-input").press("Enter");
    await page.locator('.window[data-app-id="editor"]').waitFor();
    await page.waitForFunction(() => window.__startSaved?.systemSettings.startMenu.recentItems[0]?.id === 'recent-note');
    await open(); await page.locator("#start-search-input").fill("");
    await page.locator("#start-all-apps").click();
    await page.locator('[data-start-recent="recent-other"]').click();
    await page.waitForFunction(() => window.__startSaved?.currentDesktop === 'test-other');
    // Document names are input values, not text nodes in this editor.
    await page.waitForFunction(() => [...document.querySelectorAll('.editor-title')].some(input => input.value === 'Документ другого стола'));
    await open();
    await page.locator('#start-clear-recent').click();
    await page.waitForFunction(() => window.__startSaved?.systemSettings.startMenu.recentItems.length === 0);
    assert.equal(await page.locator('#start-recent-section').isVisible(), false);
    await page.locator('[data-start-quick="task"]').click();
    await page.locator('.window[data-app-id="taskedit"]').waitFor();
    await open(); await settings.click();
    await pref('showRecent').uncheck(); await saved('showRecent', false); await page.keyboard.press('Escape');
    await page.locator('[data-start-quick="note"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.editor-title')].some(input => input.value === 'Новая заметка'));
    await open(); await settings.click();
    await pref('showRecent').check(); await saved('showRecent', true);
    assert.ok(await page.evaluate(() => Object.values(window.__startSaved.fs).some(item => item.name === 'Новая заметка')));
    assert.equal(await page.evaluate(() => window.__startSaved.systemSettings.startMenu.recentItems.length), 0, 'Disabled history must not collect new documents');
    await page.keyboard.press('Escape');
    await page.locator('[data-start-quick="explorer"]').click();
    await page.locator('.window[data-app-id="folder"]').waitFor();
    await open();
    await page.locator('[data-desktop-menu="test-other"]').click();
    page.once('dialog', dialog => dialog.accept('Тестовое пространство'));
    await page.locator('#context-menu button').filter({ hasText:'Переименовать' }).click();
    await page.waitForFunction(() => window.__startSaved?.desktops.find(desktop => desktop.id === 'test-other')?.name === 'Тестовое пространство');
    assert.ok((await page.locator('[data-switch-desktop="test-other"]').innerText()).includes('Тестовое пространство'));
    await page.locator('[data-desktop-menu="test-other"]').click();
    await page.locator('#context-menu button').filter({ hasText:'Настроить рабочий стол' }).click();
    await page.locator('.window[data-app-id="settings"]').waitFor();
    assert.deepEqual(errors, [], "No browser errors");
    console.log("start menu browser smoke: PASS (responsive, settings/reload/refusal, pin keyboard/drag, catalog, search, recents/privacy/cross-desktop, all quick actions, desktop rename/settings)");
    console.log("screenshots: " + out);
    await context.close();
  } catch (error) {
    if (page && !page.isClosed()) {
      console.log("FAILURE_DIAGNOSTICS", JSON.stringify(await page.evaluate(() => ({
        savedDesktop: window.__startSaved?.currentDesktop,
        recents: window.__startSaved?.systemSettings?.startMenu?.recentItems,
        editors: [...document.querySelectorAll('.editor-title')].map(input => input.value),
        visibleMenu: !document.querySelector('#start-menu')?.classList.contains('hidden')
      }))));
      await page.screenshot({ path:path.join(out, 'failure.png') });
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}
module.exports = { runStartMenuSmoke };
