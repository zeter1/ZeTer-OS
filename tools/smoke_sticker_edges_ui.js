"use strict";
// Explicit synthetic browser regressions; importing this module has no side effects.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
async function runStickersEdgesSmoke({ chromium, startPreview, outputDir, browserExecutable } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/stickers-edges-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  const checks = [], errors = []; let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    async function check(name, operation) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: "block" });
      let page;
      try {
        await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
        page = await context.newPage(); page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
        await page.route("**/*", route => {
          if (!route.request().url().startsWith(preview.url)) return route.abort();
          if (new URL(route.request().url()).pathname !== "/js/app.js") return route.continue();
          const seed = `const storage=ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...storage,createPrimaryStateSaveQueue:options=>{const queue=storage.createPrimaryStateSaveQueue(options);return {...queue,transaction:operation=>queue.transaction(write=>operation(async(s,o)=>{if(window.__edgeHold)await new Promise(resolve=>{window.__edgeRelease=()=>{window.__edgeHold=false;resolve();};});if(window.__edgeRefuse)throw new Error('Тест: запись недоступна');return write(s,o);} ))};}};
            const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);const d=s.desktops[0];
            d.data.stickyLibrary={projects:[{id:'p',name:'Проект'}],categories:[{id:'c1',projectId:'p',name:'Первая'},{id:'c2',projectId:'p',name:'Вторая'}]};
            d.data.noteStickies=[{noteId:'edge-a',projectId:'p',categoryId:'c1',desktop:false},{noteId:'edge-b',projectId:'p',categoryId:'c2',desktop:false}];
            s.fs['edge-a']={id:'edge-a',type:'note',parent:d.id,name:'Первый стикер',content:'Первоначальный текст',richContent:'<p>Первоначальный текст</p>'};
            s.fs['edge-b']={id:'edge-b',type:'note',parent:d.id,name:'Второй стикер',content:'Соседний текст',richContent:'<p>Соседний текст</p>'};
            s.desktops.push({id:'edge-other',name:'Другой стол',data:ZETER_WORKSPACE_UTILS.workspaceDefaults({noteStickies:[{noteId:'edge-other-note',desktop:false}]})});
            s.fs['edge-other-note']={id:'edge-other-note',type:'note',parent:'edge-other',name:'Другой стикер',content:'Текст другого стола'};
            localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));`;
          const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8"), anchor = '  function renderStickersApp(params = {}, winId = "") {';
          assert.ok(source.includes(anchor), "known composition entrypoint");
          return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + source.replace(anchor, anchor + "\nwindow.__stickerGetState=()=>state;") });
        });
        await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" });
        await page.locator('[data-top-action="appcenter"]').click();
        const install = page.locator('[data-install-app="stickers"]'); if (await install.count()) await install.click();
        await page.locator('[data-open-app="stickers"]').last().click();
        const app = page.locator(".sticker-library-app").last(); await app.waitFor();
        await app.locator("xpath=ancestor::*[contains(@class,'window')][1]").evaluate(el => Object.assign(el.style, { width: "1300px", height: "900px", left: "20px", top: "45px" }));
        await operation({ page, app }); checks.push({ name, status: "PASS" });
      } catch (error) {
        checks.push({ name, status: "FAIL", error: error.message });
        if (page) await page.screenshot({ path: path.join(out, `${name}.png`) }).catch(() => {});
      } finally { await context.close(); }
      console.log(`stickers edge ${checks.at(-1).status}: ${name}`);
    }
    await check("desktop-change-after-inline-discard", async ({ page, app }) => {
      const select = app.locator("[data-sticker-desktop]"), original = await select.inputValue();
      await app.locator('[data-sticker-note="edge-a"] [data-sticker-action="edit"]').click();
      await app.locator('[data-sticker-text]').fill("Несохранённый черновик");
      await select.selectOption("edge-other"); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
      assert.equal(await select.inputValue(), original); assert.equal(await app.locator('[data-sticker-text]').innerText(), "Несохранённый черновик");
      await select.selectOption("edge-other"); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click();
      assert.equal(await app.locator('[data-sticker-form]').count(), 0);
      assert.equal(await select.inputValue(), "edge-other", "accepted desktop choice survives editor refresh");
      assert.deepEqual(await app.locator('[data-sticker-note]').evaluateAll(nodes => nodes.map(node => node.dataset.stickerNote)), ["edge-other-note"]);
      assert.equal(await page.evaluate(() => window.__stickerGetState().fs['edge-a'].content), "Первоначальный текст");
      assert.equal(await page.evaluate(() => window.__stickerGetState().fs['edge-b'].content), "Соседний текст");
    });
    await check("category-change-after-inline-discard", async ({ page, app }) => {
      await app.locator('[data-sticker-action="project"]').click();
      const select = app.locator("[data-sticker-category]"); await select.selectOption("c1");
      await app.locator('[data-sticker-note="edge-a"] [data-sticker-action="edit"]').click();
      await app.locator('[data-sticker-text]').fill("Несохранённая правка категории");
      await select.selectOption("c2"); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
      assert.equal(await select.inputValue(), "c1"); assert.equal(await app.locator('[data-sticker-text]').innerText(), "Несохранённая правка категории");
      await select.selectOption("c2"); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click();
      assert.equal(await app.locator('[data-sticker-form]').count(), 0);
      assert.equal(await select.inputValue(), "c2", "accepted category choice survives editor refresh");
      assert.deepEqual(await app.locator('[data-sticker-note]').evaluateAll(nodes => nodes.map(node => node.dataset.stickerNote)), ["edge-b"]);
      assert.equal(await page.evaluate(() => window.__stickerGetState().fs['edge-a'].content), "Первоначальный текст");
    });
    for (const action of ["favorite", "desktop"]) await check(`keyboard-focus-after-${action}`, async ({ page, app }) => {
      const button = app.locator(`[data-sticker-note="edge-a"] [data-sticker-action="${action}"]`);
      await button.focus(); await app.evaluate(node => node.refreshStickers());
      assert.equal(await button.evaluate(node => node === document.activeElement), true, "ordinary refresh preserves focus");
      await page.keyboard.press("Space");
      await button.waitFor(); await page.waitForFunction(() => !document.querySelector('.sticker-library-app').hasAttribute('aria-busy'));
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await button.evaluate(node => node === document.activeElement), true, "keyboard action retains focus after save and card refresh");
      await page.keyboard.press("Space");
      await page.waitForFunction(() => !document.querySelector('.sticker-library-app').hasAttribute('aria-busy'));
      assert.equal(await button.getAttribute("aria-pressed"), "false", "same keyboard action is reachable again");
    });
    await check("pending-save-does-not-steal-focus", async ({ page, app }) => {
      const button = app.locator('[data-sticker-note="edge-a"] [data-sticker-action="favorite"]'), search = app.locator('[data-sticker-search]');
      await page.evaluate(() => { window.__edgeHold = true; });
      await button.focus(); await page.keyboard.press('Space'); await page.waitForFunction(() => typeof window.__edgeRelease === 'function');
      await search.focus(); await page.evaluate(() => window.__edgeRelease());
      await page.waitForFunction(() => !document.querySelector('.sticker-library-app').hasAttribute('aria-busy'));
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await search.evaluate(node => node === document.activeElement), true, "user focus during ACK is retained");
    });
    await check("failed-save-focus-retry-and-filtered-card-fallback", async ({ page, app }) => {
      const button = app.locator('[data-sticker-note="edge-a"] [data-sticker-action="favorite"]');
      await page.evaluate(() => { window.__edgeRefuse = true; });
      await button.focus(); await page.keyboard.press('Space'); await app.locator('[data-sticker-status].error').waitFor();
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      assert.equal(await button.evaluate(node => node === document.activeElement), true);
      assert.equal(await page.evaluate(() => window.__stickerGetState().fs['edge-b'].content), 'Соседний текст');
      await page.evaluate(() => { window.__edgeRefuse = false; }); await page.keyboard.press('Space');
      await page.waitForFunction(() => !document.querySelector('.sticker-library-app').hasAttribute('aria-busy'));
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      await app.locator('[data-sticker-action="favorites"]').click();
      await button.focus(); await page.keyboard.press('Space'); await button.waitFor({ state: 'detached' });
      assert.equal(await app.locator('[data-sticker-action="new"]').first().evaluate(node => node === document.activeElement), true, "vanished filtered card falls back to create button");
      assert.equal(await page.evaluate(() => window.__stickerGetState().fs['edge-a'].content), 'Первоначальный текст');
    });
    const result = { checks, errors, out }; fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []); assert.equal(checks.filter(item => item.status === "FAIL").length, 0, "all sticker edge scenarios pass"); return result;
  } finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runStickersEdgesSmoke };
