"use strict";

// Explicit browser acceptance: isolated synthetic state, public assets, no native API.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function runMobileExplorerSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/mobile-explorer-qa/verified");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  const checks = [], errors = [];
  let browser, page;
  const seed = `if (!localStorage.getItem('mobile-explorer-fixture')) {
    const s=ZETER_INITIAL_STATE_UTILS.defaultState(); s.firstRunCompleted=true;
    ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);
    s.fs['phone-folder']={id:'phone-folder',type:'folder',name:'Материалы телефона',parent:'desktop',x:900,y:800,createdAt:1,updatedAt:1};
    s.fs['phone-nested']={id:'phone-nested',type:'folder',name:'Вложенная папка',parent:'phone-folder',x:1200,y:1000,createdAt:1,updatedAt:1};
    s.fs['phone-note']={id:'phone-note',type:'note',name:'Отчёт <за месяц> с длинным названием',parent:'phone-folder',content:'Контрольный текст',richContent:'',x:1400,y:1200,createdAt:1,updatedAt:1};
    s.fs['phone-neighbor']={id:'phone-neighbor',type:'note',name:'Соседняя заметка',parent:'phone-folder',content:'Соседние данные',richContent:'',createdAt:1,updatedAt:1};
    s.fs['phone-leaf']={id:'phone-leaf',type:'note',name:'Вложенная заметка',parent:'phone-nested',content:'Вложенные данные',richContent:'',createdAt:1,updatedAt:1};
    localStorage.setItem('zeter_os_state_v3',JSON.stringify(s)); localStorage.setItem('mobile-explorer-fixture','1');
  }\n`;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const routeFixture = route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body: seed + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      return route.continue();
    };
    await context.route("**/*", routeFixture);
    await page.goto(preview.url);
    await page.locator("#boot").waitFor({ state: "hidden" });
    await page.locator('#desktop-items [data-item-id="phone-folder"]').tap();
    const folder = page.locator('.window[data-app-id="folder"]:not(.minimized)');
    const toolbar = folder.locator('.explorer-path-toolbar');
    const fileMenu = id => folder.locator(`.file-card[data-item-id="${id}"] .explorer-item-menu`);
    const closeMenu = () => page.locator('#context-menu .context-close-btn').tap();
    const openFile = id => folder.locator(`.file-card[data-item-id="${id}"] .explorer-item-open`);
    const stateSlice = async () => {
      return page.evaluate(async () => {
      const config = window.ZETER_OS_CONFIG;
      const record = await window.ZETER_STORAGE_UTILS.readPrimaryStateRecord({ dbName: config.PRIMARY_STATE_DB, storeName: config.PRIMARY_STATE_STORE, id: config.PRIMARY_STATE_ID });
      const s = record.state;
      return ['phone-folder','phone-nested','phone-note','phone-neighbor','phone-leaf'].map(id => {
        const item=s.fs[id]; return { id, parent:item.parent, content:item.content, x:item.x, y:item.y };
      });
      });
    };
    const original = await stateSlice();
    for (const [width,height] of [[320,568],[390,844],[430,932],[844,390]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await toolbar.locator('[data-path-input]').isVisible(), false);
      assert.equal(await toolbar.locator('[data-search]').isVisible(), false);
      assert.equal(await toolbar.locator('[data-sort-toggle]').isVisible(), false);
      assert.ok((await toolbar.boundingBox()).height <= 52, 'collapsed toolbar occupies one row');
      assert.equal(await folder.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await toolbar.locator('[data-mobile-panel="path"]').tap();
      assert.equal(await toolbar.locator('[data-path-input]').isVisible(), true);
      assert.match(await toolbar.locator('[data-path-input]').inputValue(), /Материалы телефона/);
      await toolbar.locator('[data-path-input]').press('Escape');
      assert.equal(await toolbar.locator('[data-path-input]').isVisible(), false);
      assert.equal(await toolbar.locator('[data-mobile-panel="path"]').evaluate(el => el === document.activeElement), true);
      await toolbar.locator('[data-mobile-panel="search"]').tap();
      await toolbar.locator('[data-search]').fill('Соседняя');
      assert.equal(await folder.locator('.file-card').count(), 1, 'search filters actual folder content');
      await toolbar.locator('[data-mobile-panel="search"]').tap();
      assert.equal(await folder.locator('.file-card').count(), 3, 'closing search removes the hidden filter');
      await toolbar.locator('[data-mobile-panel="tools"]').tap();
      assert.equal(await toolbar.locator('[data-sort-toggle]').isVisible(), true);
      assert.equal(await toolbar.locator('[data-view-toggle]').isVisible(), true);
      await toolbar.locator('[data-mobile-panel="tools"]').tap();
      for (const id of ['phone-note','phone-nested']) {
        const r = await fileMenu(id).boundingBox();
        assert.ok(r.width >= 44 && r.height >= 44, 'material menu has a 44px touch target');
        await fileMenu(id).tap();
        await page.locator('#context-menu').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.window:not(.minimized)').count(), 1, 'menu must not open the material');
        await closeMenu();
        assert.equal(await folder.locator('.file-card').count(), 3);
      }
      await page.screenshot({ path: path.join(out, `explorer-${width}.png`) });
      checks.push(`compact-path-search-commands-item-menus-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await openFile('phone-nested').tap();
    assert.equal(await folder.locator('.file-card[data-item-id="phone-leaf"]').count(), 1);
    await toolbar.locator('[data-nav="up"]').tap();
    assert.equal(await folder.locator('.file-card[data-item-id="phone-note"]').count(), 1);
    checks.push('nested-folder-up-navigation');

    // Each visual mode must keep the new menu separate from the visible label/icon.
    for (const mode of ['huge','large','medium','icons','small','list','table','content']) {
      await toolbar.locator('[data-mobile-panel="tools"]').tap();
      await toolbar.locator('[data-view-toggle]').tap();
      await folder.locator(`input[data-view-mode][value="${mode}"]`).check();
      await folder.locator(`.explorer-plus[data-view-mode="${mode}"]`).waitFor({ state: 'visible' });
      await folder.locator('.explorer-view-menu:not(.explorer-sort-menu)').evaluate(el => el.hidePopover());
      await toolbar.locator('[data-mobile-panel="tools"]').tap();
      const card = folder.locator('.file-card[data-item-id="phone-note"]');
      await fileMenu('phone-note').scrollIntoViewIfNeeded();
      const hit = await fileMenu('phone-note').evaluate(el => {
        const a=el.getBoundingClientRect(), b=el.closest('.file-card').querySelector('.explorer-item-name').getBoundingClientRect();
        return { overlap: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, hit: el.contains(document.elementFromPoint(a.left+a.width/2,a.top+a.height/2)) };
      });
      assert.equal(hit.overlap, false, `${mode}: menu does not cover name`);
      assert.equal(hit.hit, true, `${mode}: menu is reachable`);
      await fileMenu('phone-note').tap();
      await page.locator('#context-menu').waitFor({ state: 'visible' });
      await closeMenu();
      assert.equal(await card.locator('.explorer-item-name').textContent(), 'Отчёт <за месяц> с длинным названием');
      await page.screenshot({ path: path.join(out, `view-${mode}.png`) });
      checks.push(`material-menu-${mode}`);
    }
    const tabsBefore = await folder.locator('[data-open-tab]').count();
    await folder.locator('[data-action="new-tab"]').tap();
    assert.equal(await folder.locator('[data-open-tab]').count(), tabsBefore + 1);
    assert.equal(await toolbar.locator('[data-path-input]').isVisible(), true, 'blank tab keeps address reachable');
    for (const width of [320,390,430,844]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
      const close = folder.locator('.explorer-tab.active [data-close-tab]');
      await close.scrollIntoViewIfNeeded();
      const r=await close.boundingBox();
      assert.ok(r.width >= 44 && r.height >= 44);
    }
    await folder.locator('.explorer-tab.active [data-close-tab]').tap();
    assert.equal(await folder.locator('[data-open-tab]').count(), tabsBefore);
    assert.equal(await folder.locator('.file-card[data-item-id="phone-note"]').count(), 1, 'closing the active blank tab returns to its neighbor');
    checks.push('large-separate-tab-close-preserves-neighbor');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('#boot').waitFor({ state: 'hidden' });
    assert.deepEqual(await stateSlice(), original, 'phone menus, view changes, tabs and reload preserve text, parents and coordinates');
    checks.push('phone-reload-preserves-materials');

    // Mouse layout in the same view: original controls return and mobile menus disappear.
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.equal(await toolbar.locator('[data-path-input]').isVisible(), true);
    assert.equal(await toolbar.locator('[data-search]').isVisible(), true);
    assert.equal(await toolbar.locator('[data-sort-toggle]').isVisible(), true);
    assert.equal(await fileMenu('phone-note').isVisible(), false);
    await openFile('phone-note').click();
    assert.equal(await page.locator('.window:not(.minimized)').count(), 1, 'one desktop click selects only');
    await openFile('phone-note').dblclick();
    assert.equal(await page.locator('.window:not(.minimized)').count(), 2, 'desktop double click opens once');
    const mouseEditorId = await page.locator('.window:not(.minimized)').last().getAttribute('data-win-id');
    const mouseEditor = page.locator(`.window[data-win-id="${mouseEditorId}"]`);
    await mouseEditor.locator('[data-win="close"]').click();
    await mouseEditor.waitFor({ state: 'detached' });
    assert.equal(await page.locator('.window:not(.minimized)').count(), 1);
    await openFile('phone-note').focus();
    await openFile('phone-note').press('Enter');
    assert.equal(await page.locator('.window:not(.minimized)').count(), 2, 'native keyboard activation opens material');
    const keyboardEditorId = await page.locator('.window:not(.minimized)').last().getAttribute('data-win-id');
    const keyboardEditor = page.locator(`.window[data-win-id="${keyboardEditorId}"]`);
    await keyboardEditor.locator('[data-win="close"]').click();
    await keyboardEditor.waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(out, 'desktop.png') });
    checks.push('desktop-controls-keyboard-opening');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await toolbar.locator('[data-search]').isVisible(), false);

    // A true mouse context covers the changed card container independently of touch.
    const mouseContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, serviceWorkers: 'block' });
    await mouseContext.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    await mouseContext.route('**/*', routeFixture);
    const mousePage = await mouseContext.newPage();
    mousePage.on('pageerror', error => errors.push(error.message));
    await mousePage.goto(preview.url);
    await mousePage.locator('#boot').waitFor({ state: 'hidden' });
    await mousePage.locator('#desktop-items [data-item-id="phone-folder"]').dblclick();
    const mouseFolder = mousePage.locator('.window[data-app-id="folder"]:not(.minimized)');
    await mouseFolder.locator('[data-view-toggle]').click();
    await mouseFolder.locator('[data-view-flag="checkboxes"]').check();
    await mouseFolder.locator('.explorer-plus[data-checkboxes="true"]').waitFor({ state: 'visible' });
    await mouseFolder.locator('.explorer-view-menu:not(.explorer-sort-menu)').evaluate(el => el.hidePopover());
    const mouseCard = id => mouseFolder.locator(`.file-card[data-item-id="${id}"]`);
    await mouseCard('phone-note').locator('.explorer-item-check').click();
    await mouseCard('phone-neighbor').locator('.explorer-item-check').click();
    assert.equal(await mouseFolder.locator('.file-card.selected').count(), 2);
    assert.equal(await mousePage.locator('.window:not(.minimized)').count(), 1, 'checkbox selection does not open files');
    await mouseCard('phone-neighbor').locator('.explorer-item-check').click();
    assert.equal(await mouseFolder.locator('.file-card.selected').count(), 1);
    checks.push('mouse-checkbox-multiselect-no-open');
    await mouseCard('phone-note').locator('.explorer-item-open').dragTo(mouseCard('phone-nested'));
    await mousePage.waitForFunction(async () => {
      const c=window.ZETER_OS_CONFIG;
      const r=await window.ZETER_STORAGE_UTILS.readPrimaryStateRecord({dbName:c.PRIMARY_STATE_DB,storeName:c.PRIMARY_STATE_STORE,id:c.PRIMARY_STATE_ID});
      return r?.state?.fs?.['phone-note']?.parent === 'phone-nested';
    });
    const moved = await mousePage.evaluate(async () => {
      const c=window.ZETER_OS_CONFIG;
      const r=await window.ZETER_STORAGE_UTILS.readPrimaryStateRecord({dbName:c.PRIMARY_STATE_DB,storeName:c.PRIMARY_STATE_STORE,id:c.PRIMARY_STATE_ID});
      return {parent:r.state.fs['phone-neighbor'].parent,content:r.state.fs['phone-note'].content};
    });
    assert.deepEqual(moved,{parent:'phone-folder',content:'Контрольный текст'});
    await mousePage.screenshot({ path: path.join(out, 'mouse-drag.png') });
    checks.push('mouse-card-drag-exact-item-preserves-neighbor');
    assert.deepEqual(errors, []);
    const sourceHashes = Object.fromEntries(['app/js/core/explorer-ui-utils.js','app/css/85-explorer-plus.css','app/css/95-mobile.css', 'tools/smoke_mobile_explorer_ui.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, sourceHashes }, null, 2));
    console.log(`mobile explorer: PASS (${checks.length} scenarios, 0 JS errors)`);
    return { checks, out };
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(out, 'failure.png') });
      const geometry = await page.locator('.explorer-plus, .explorer-main, .explorer-content, .file-grid, .explorer-path-toolbar, .file-card, .explorer-item-menu').evaluateAll(els => els.map(el => ({ cls: el.className, rect: el.getBoundingClientRect().toJSON(), scrollTop: el.scrollTop, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight })));
      fs.writeFileSync(path.join(out, 'geometry.json'), JSON.stringify(geometry, null, 2));
    }
    fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}

module.exports = { runMobileExplorerSmoke };
