"use strict";
// Explicit browser test only. Synthetic state; no native storage or external network.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createHash } = require("node:crypto");
async function runStickyControlsSmoke({ chromium, startPreview, outputDir, browserExecutable, baseline = false } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/sticky-controls-qa");
  const owners = ["app/js/app.js", "app/js/core/desktop-ui-utils.js", "app/js/core/sticker-library-utils.js", "app/js/sticky-window.js", "app/sticky-window.html", "app/css/60-apps-calendar-notes-tables.css", "app/css/sticky-window.css", "sticky_windows.py"];
  const identity = () => Object.fromEntries(owners.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const sourceIdentity = identity();
  fs.mkdirSync(out, { recursive: true });
  let preview, browser, page;
  const checks = [], errors = [], failures = [];
  const check = async (name, operation) => { await operation(); checks.push(name); console.log(`sticky controls PASS: ${name}`); };
  try {
    preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "sticky-window.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname !== "/js/app.js") return route.continue();
      const seed = `const owner=ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...owner,createPrimaryStateSaveQueue:options=>{
        const queue=owner.createPrimaryStateSaveQueue(options);return {...queue,transaction:operation=>queue.transaction(write=>operation(async(s,o)=>{
          if(window.__stickyHold)await new Promise(resolve=>{window.__stickyRelease=()=>{window.__stickyHold=false;resolve();};});
          if(window.__stickyRefuse)throw new Error('Тест: запись недоступна');return write(s,o);} ))};}};
        const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);const d=s.desktops[0];
        s.fs['controls-note']={id:'controls-note',type:'note',parent:d.id,name:'План на сегодня',content:'Текст стикера',richContent:'<p>Текст стикера</p>',managedFiles:[]};
        s.fs['controls-neighbor']={id:'controls-neighbor',type:'note',parent:d.id,name:'Соседняя заметка',content:'Не изменять'};
        d.data.noteStickies=[{noteId:'controls-note',desktop:true,x:70,y:100,w:380,h:340}];
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));`;
      let source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
      source = source.replace('    nativeStickyAvailable: () => shouldUseNativeStorage(),', '    nativeStickyAvailable: () => true,');
      source = source.replace('    if (!shouldUseNativeStorage()) throw new Error("Отдельные окна доступны в Windows-версии ZeTer OS.");', `    window.__stickyWindowsCalls=(window.__stickyWindowsCalls||0)+1;
        if(window.__stickyWindowsRefuse)throw new Error('Тест: Windows недоступен');return {ok:true};`);
      source = source.replace('  function renderStickersApp(params = {}, winId = "") {', '  function renderStickersApp(params = {}, winId = "") {\n    window.__stickyState=()=>state;');
      source = source.replace('  function createStickersController() {', '  function createStickersController() {\n    window.__stickyState=()=>state;');
      return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + source });
    });
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" });
    const sticky = () => page.locator('.desktop-sticky[data-note-id="controls-note"]');
    await sticky().waitFor();
    await page.screenshot({ path: path.join(out, "desktop.png") });
    if (!baseline) {
      const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__stickyState())));
      await check("clear actions, keyboard and compact layout", async () => {
        assert.equal(await sticky().locator('[data-close-sticky]').count(), 0);
        assert.equal(await sticky().locator('[data-sticky-library]').isVisible(), false);
        await sticky().locator('[data-sticky-settings]').click();
        assert.equal(await sticky().locator('[data-sticky-settings]').getAttribute('aria-expanded'), 'true');
        for (const width of [380, 220]) {
          await sticky().evaluate((el, width) => { el.style.width = `${width}px`; }, width);
          for (const selector of ['[data-sticky-library]', '[data-sticky-delete]', '[data-sticky-windows]']) {
            const button = sticky().locator(selector); assert.equal(await button.isVisible(), true);
            assert.equal(await button.evaluate(el => { const b=el.getBoundingClientRect(), c=el.closest('.desktop-sticky').getBoundingClientRect(); return b.left>=c.left&&b.right<=c.right&&b.bottom<=c.bottom; }), true);
          }
          assert.equal(await sticky().locator('[data-sticky-settings-panel]').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        }
        await page.screenshot({ path: path.join(out, "desktop-narrow.png") });
        await sticky().locator('[data-sticky-settings]').focus(); await page.keyboard.press('Tab');
        // Text editor is the next tab stop, followed by the visible action row.
        await page.keyboard.press('Tab');
        assert.equal(await sticky().locator('[data-sticky-library]').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Escape');
        assert.equal(await sticky().locator('[data-sticky-library]').isVisible(), false);
        assert.equal(await sticky().locator('[data-sticky-settings]').evaluate(el => el === document.activeElement), true);
        await sticky().evaluate(el => { el.style.height='180px'; });
        await sticky().locator('[data-sticky-settings]').click();
        await sticky().locator('[data-sticky-settings-close]').scrollIntoViewIfNeeded();
        assert.equal(await sticky().locator('[data-sticky-settings-close]').evaluate(el=>{const b=el.getBoundingClientRect(),c=el.closest('.desktop-sticky').getBoundingClientRect();return b.bottom<=c.bottom;}),true);
        await sticky().locator('[data-sticky-settings-close]').click();
        await sticky().evaluate(el => { el.style.height='340px'; });
      });
      await check("return to library: failure keeps text, pending freezes input, retry preserves note", async () => {
        await sticky().locator('[data-sticky-text]').fill('Последний ввод перед переносом');
        await sticky().locator('[data-sticky-settings]').click();
        await page.evaluate(() => { window.__stickyRefuse = true; });
        await sticky().locator('[data-sticky-library]').click();
        await sticky().locator('[data-sticky-action-status]:not([hidden])').waitFor();
        assert.match(await sticky().innerText(), /Тест: запись недоступна/);
        assert.equal(await sticky().locator('[data-sticky-text]').innerText(), 'Последний ввод перед переносом');
        await page.evaluate(() => { window.__stickyRefuse = false; window.__stickyHold = true; });
        await sticky().locator('[data-sticky-library]').click();
        await page.waitForFunction(() => typeof window.__stickyRelease === 'function');
        assert.equal(await sticky().locator('[data-sticky-text]').getAttribute('contenteditable'), 'false');
        await page.evaluate(() => window.__stickyRelease()); await sticky().waitFor({ state: 'detached' });
        const s = await state(); assert.equal(s.fs['controls-note'].content, 'Последний ввод перед переносом');
        assert.equal(s.desktops[0].data.noteStickies[0].desktop, false);
        assert.equal(await page.locator('.sticker-library-app [data-sticker-note="controls-note"]').count(), 1);
      });
      const pin = async () => {
        await page.locator('.sticker-library-app [data-sticker-note="controls-note"] [data-sticker-action="desktop"]').click();
        await page.locator('.window[data-app-id="stickers"] [data-win="min"]').click(); await sticky().waitFor();
        await sticky().locator('[data-sticky-settings]').click();
      };
      await pin();
      await check("Windows transfer: refused open retains sticker; success hides desktop copy", async () => {
        await page.evaluate(() => { window.__stickyWindowsRefuse = true; });
        await sticky().locator('[data-sticky-windows]').click();
        await sticky().locator('[data-sticky-action-status]:not([hidden])').waitFor();
        assert.match(await sticky().innerText(), /Windows недоступен/);
        await page.evaluate(() => { window.__stickyWindowsRefuse = false; });
        await sticky().locator('[data-sticky-windows]').click(); await sticky().waitFor({ state: 'detached' });
        const s = await state(); assert.equal(s.desktops[0].data.noteStickies[0].desktop, false);
        assert.equal(await page.evaluate(() => window.__stickyWindowsCalls), 2);
        assert.ok(s.fs['controls-note']);
      });
      await page.locator('.taskbar-app[title="Стикеры"]').click(); await pin();
      await check("delete: cancel, refusal, retry; original and neighbor survive", async () => {
        const before = (await state()).fs;
        await sticky().locator('[data-sticky-delete]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
        assert.equal(await sticky().count(), 1);
        await page.evaluate(() => { window.__stickyRefuse = true; });
        await sticky().locator('[data-sticky-delete]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click();
        await sticky().locator('[data-sticky-action-status]:not([hidden])').waitFor();
        assert.equal((await state()).desktops[0].data.noteStickies.length, 1);
        await page.evaluate(() => { window.__stickyRefuse = false; });
        await sticky().locator('[data-sticky-delete]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click();
        await sticky().waitFor({ state: 'detached' });
        const s = await state(); assert.equal(s.desktops[0].data.noteStickies.length, 0);
        assert.equal(s.fs['controls-note'].content, before['controls-note'].content);
        assert.deepEqual(s.fs['controls-neighbor'], before['controls-neighbor']);
      });
    }
    await check("Windows document and autosave", async () => {
      const child = await context.newPage();
      child.on('pageerror', error => errors.push(error.message));
      await child.route('**/*', route => route.request().url().startsWith(preview.url) ? route.continue() : route.abort());
      if (!baseline) {
        await page.evaluate(() => {
          const s=window.__stickyState(),d=s.desktops[0];
          s.fs['native-note']={id:'native-note',type:'note',parent:d.id,name:'План на сегодня',content:'Текст',richContent:'<p>Текст</p>'};
          d.data.noteStickies.push({noteId:'native-note',desktop:false,color:'teal',textColor:'dark',fontSize:16,opacity:1});
          window.__nativeIds={workspaceId:d.id,stickyId:'native-note'};
        });
        await child.exposeFunction('__readParent', () => page.evaluate(() => window.ZETER_STICKY_NATIVE.snapshot(window.__nativeIds)));
        await child.exposeFunction('__saveParent', payload => page.evaluate(payload => window.ZETER_STICKY_NATIVE.save({...window.__nativeIds,...payload}), payload));
        await child.exposeFunction('__actionParent', payload => page.evaluate(payload => window.ZETER_STICKY_NATIVE.action({...window.__nativeIds,...payload}), payload));
      }
      await child.addInitScript(() => {
        window.__childSnapshot = { title: 'План на сегодня', richHtml: '<p>Текст</p>', color: 'teal' };
        window.pywebview = { api: {
          get_snapshot: async () => window.__readParent ? window.__readParent() : ({ ok: true, snapshot: window.__childSnapshot }),
          save_sticky: async payload => {
            if (window.__childRefuse) return { ok: false, error: 'Тест: сохранение недоступно' };
            if (window.__saveParent) return window.__saveParent(payload);
            window.__childSnapshot = { ...window.__childSnapshot, title: payload.title, richHtml: payload.richHtml, appearance: payload.appearance };
            return { ok: true, snapshot: window.__childSnapshot };
          },
          perform_action: async payload => window.__actionRefuse ? {ok:false,error:'Тест: действие недоступно'} : window.__actionParent(payload),
          close_window: async () => { window.__childClosed=true; return {ok:true}; }
        } };
      });
      await child.setViewportSize({ width: 360, height: 400 });
      await child.goto(preview.url + 'sticky-window.html'); await child.locator('#sticky-title:not([disabled])').waitFor();
      await child.screenshot({ path: path.join(out, 'windows-document.png') });
      if (!baseline) {
        assert.equal(await child.locator('#sticky-save').count(), 0);
        assert.equal(await child.locator('label[for="sticky-title"]').innerText(), 'Название стикера');
        await child.locator('#sticky-title').fill('Автоматически сохранено');
        await page.waitForFunction(() => window.__stickyState().fs['native-note'].name === 'Автоматически сохранено');
        await child.evaluate(() => { window.__childRefuse = true; });
        await child.locator('#sticky-editor').fill('Черновик при отказе');
        await child.locator('#sticky-retry:not([hidden])').waitFor();
        assert.equal(await child.locator('#sticky-editor').innerText(), 'Черновик при отказе');
        await child.screenshot({ path: path.join(out, 'windows-error.png') });
        await child.evaluate(() => { window.__childRefuse = false; }); await child.locator('#sticky-retry').click();
        await page.waitForFunction(() => window.__stickyState().fs['native-note'].richContent.includes('Черновик при отказе'));
        assert.equal(await child.locator('#sticky-retry').isVisible(), false);
        await child.locator('#sticky-settings').click();
        await child.locator('#sticky-color').selectOption('orange');
        await page.waitForFunction(() => window.__stickyState().desktops[0].data.noteStickies.find(s=>s.noteId==='native-note').color === 'orange');
        await child.locator('#sticky-font-size').fill('18'); await child.locator('#sticky-font-size').dispatchEvent('change');
        await page.waitForFunction(() => window.__stickyState().desktops[0].data.noteStickies.find(s=>s.noteId==='native-note').fontSize === 18);
        await child.locator('#sticky-text-color').selectOption('light');
        await page.waitForFunction(() => window.__stickyState().desktops[0].data.noteStickies.find(s=>s.noteId==='native-note').textColor === 'light');
        await child.locator('#sticky-opacity').fill('85'); await child.locator('#sticky-opacity').dispatchEvent('change');
        await page.waitForFunction(() => window.__stickyState().desktops[0].data.noteStickies.find(s=>s.noteId==='native-note').opacity === .85);
        assert.equal(await page.evaluate(async () => {
          const snapshot=window.ZETER_STICKY_NATIVE.snapshot(window.__nativeIds).snapshot;
          const result=await window.ZETER_STICKY_NATIVE.save({...window.__nativeIds,title:snapshot.title,richHtml:snapshot.richHtml,appearance:snapshot.appearance,expectedTitle:'Old ACK',expectedRichHtml:'Old ACK',expectedAppearance:{...snapshot.appearance,color:'blue'}});
          return result.ok;
        }),true,'retry after a lost successful ACK accepts the already-saved text and appearance');
        await child.screenshot({path:path.join(out,'windows-settings.png')});
        await child.locator('#sticky-settings-close').scrollIntoViewIfNeeded(); await child.locator('#sticky-settings-close').click();
        assert.equal(await child.locator('#sticky-settings').evaluate(el=>el===document.activeElement),true);
        await child.setViewportSize({width:280,height:240}); await child.locator('#sticky-settings').click();
        assert.equal(await child.locator('#sticky-settings-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
        await child.locator('#sticky-settings-close').scrollIntoViewIfNeeded();
        assert.equal(await child.locator('#sticky-settings-close').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),true);
        await child.screenshot({path:path.join(out,'windows-settings-small.png')});
        await child.keyboard.press('Escape'); assert.equal(await child.locator('#sticky-settings-panel').isVisible(),false);
        await child.setViewportSize({width:360,height:400}); await child.locator('#sticky-settings').click();
        await child.locator('[data-sticky-action="delete"]').click();
        await child.locator('dialog.zeter-dialog[open] [data-dialog-cancel]').click();
        assert.ok(await page.evaluate(()=>window.ZETER_STICKY_NATIVE.snapshot(window.__nativeIds).ok));
        await child.evaluate(()=>{window.__actionRefuse=true;});
        await child.locator('[data-sticky-action="desktop"]').click();
        await child.locator('#sticky-status[data-error="true"]').waitFor();
        assert.equal(await child.evaluate(()=>Boolean(window.__childClosed)),false);
        await child.evaluate(()=>{window.__actionRefuse=false;});
        await child.locator('[data-sticky-action="desktop"]').click(); await child.waitForFunction(()=>window.__childClosed);
        assert.equal(await page.evaluate(()=>window.__stickyState().desktops[0].data.noteStickies.find(s=>s.noteId==='native-note').desktop),true);
        // The fake close marker leaves this document alive for the next action.
        await child.evaluate(()=>{window.__childClosed=false;});
        await child.locator('[data-sticky-action="library"]').click(); await child.waitForFunction(()=>window.__childClosed);
        assert.equal(await page.evaluate(()=>window.__stickyState().desktops[0].data.noteStickies.find(s=>s.noteId==='native-note').desktop),false);
        await child.evaluate(()=>{window.__childClosed=false;});
        await child.locator('[data-sticky-action="delete"]').click();
        await child.locator('dialog.zeter-dialog[open] [data-dialog-submit]').click(); await child.waitForFunction(()=>window.__childClosed);
        assert.equal(await page.evaluate(()=>window.ZETER_STICKY_NATIVE.snapshot(window.__nativeIds).ok),false);
        assert.match(await page.evaluate(()=>window.__stickyState().fs['native-note'].content),/Черновик/);
      }
      await child.close();
    });
    assert.deepEqual(errors, []);
  } catch (error) {
    failures.push(error);
    if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  } finally {
    for (const cleanup of [() => browser?.close(), () => preview?.close()]) {
      try { await cleanup(); } catch (error) { failures.push(error); }
    }
    if (JSON.stringify(sourceIdentity) !== JSON.stringify(identity())) failures.push(new Error('Tested sources changed during browser verification'));
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, failures: failures.map(error => error.message), baseline, sourceIdentity }, null, 2));
  }
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('; '));
  return { checks, out, baseline };
}
module.exports = { runStickyControlsSmoke };
