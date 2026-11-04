"use strict";
// Explicit Playwright entrypoint. Public app preview, synthetic state, no native/network calls.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
async function runCapabilitiesSmoke({ chromium, startPreview, outputDir, browserExecutable }) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/capabilities-qa");
  fs.mkdirSync(out, { recursive: true });
  const checks = [], errors = [];
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  let browser, failure;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(12000);
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(preview.url).origin) return route.abort();
      if (url.pathname === "/js/app.js") {
        const seed = `const fixture=ZETER_INITIAL_STATE_UTILS.defaultState();fixture.firstRunCompleted=true;
          ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(fixture);const desk=fixture.desktops[0];
          fixture.fs['cap-note']={id:'cap-note',parent:desk.id,type:'note',name:'Проверка возможностей',content:'Сохранить текст'};
          desk.data.noteStickies=[{noteId:'cap-note',desktop:false}];
          localStorage.setItem('zeter_os_state_v3',JSON.stringify(fixture));`;
        const source = fs.readFileSync(path.join(root,"app/js/app.js"),"utf8").replace('  function renderStickersApp(params = {}, winId = "") {', '  function renderStickersApp(params = {}, winId = "") {\nwindow.__capState=()=>JSON.parse(JSON.stringify(state));');
        return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + source });
      }
      return route.continue();
    });
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" });
    await page.locator('[data-top-action="about"]').click();
    const about = page.locator(".about-app").last(), section = about.locator("[data-about-capabilities]");
    await section.waitFor();
    assert.match(await section.innerText(), /Браузерная версия/);
    assert.equal(await section.locator('[data-capability="windowsStickers"] [data-status="unavailable"]').count(), 1);
    assert.equal(await section.locator("[data-capability]").count(), 11);
    assert.equal(await section.getByRole("link",{name:"Скачать для Windows"}).getAttribute("href"), "https://github.com/zeter1/ZeTer-OS/releases");
    const win = page.locator('.window[data-app-id="about"]').last();
    for (const width of [1440,390,320]) {
      await page.setViewportSize({ width, height: 1000 });
      await win.evaluate((node,w) => Object.assign(node.style,{width:`${w-16}px`,height:"880px",left:"8px",top:"45px"}),width);
      await section.scrollIntoViewIfNeeded();
      assert.equal(await section.evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `capabilities overflow at ${width}`);
      await page.screenshot({path:path.join(out,`browser-${width}.png`)});
      checks.push(`browser capabilities and reflow ${width}`);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('[data-top-action="settings"]').click();
    const settings = page.locator(".settings").last();
    await settings.locator('[data-settings-section="startup"]').click();
    const startup = settings.locator('[data-settings-panel="startup"]');
    assert.equal(await startup.locator(".capability-notice").isVisible(),true);
    assert.equal(await startup.locator('[data-windows-startup]').isDisabled(),true);
    assert.equal(await startup.locator('[data-system-setting="startup.windowMode"]').isDisabled(),true);
    await startup.locator('[data-capabilities-about]').click();
    await section.waitFor();
    assert.equal(await page.locator('[data-capabilities-heading]').last().evaluate(node=>node===document.activeElement),true);
    checks.push("settings restriction and internal capabilities link");
    await page.locator('[data-top-action="appcenter"]').click();
    const install = page.locator('[data-install-app="stickers"]');
    if (await install.count()) await install.click();
    await page.locator('[data-open-app="stickers"]').last().click();
    const library = page.locator(".sticker-library-app").last(); await library.waitFor();
    assert.equal(await library.locator(".capability-notice").isVisible(),true);
    const before = await page.evaluate(() => window.__capState().fs['cap-note']);
    await library.locator('.sticker-library-card-menu summary').first().click();
    const unavailable = library.locator('[data-sticker-action="windows"]').first();
    assert.match(await unavailable.innerText(), /нужно приложение/);
    await unavailable.focus(); await page.keyboard.press("Enter");
    await section.waitFor();
    assert.equal(await page.locator('.window[data-app-id="about"]').count(),1,"capability links reuse the existing About window");
    assert.deepEqual(await page.evaluate(() => window.__capState().fs['cap-note']), before, "explaining a missing capability must preserve the note");
    checks.push("keyboard unavailable sticker action; source note preserved");
    await context.close();

    // Actual About component, separate document, fake bridge identity only; no app startup.
    const component = await browser.newContext({ viewport:{width:900,height:1000},serviceWorkers:"block" });
    const card = await component.newPage(); card.on("pageerror",error=>errors.push(error.message));
    await card.route("**/*",route=>route.abort());
    await card.setContent('<html><head></head><body></body></html>');
    for (const name of ["version.js","config.js","utils.js","app-catalog.js","runtime-capabilities-utils.js","about-ui-utils.js"]) await card.addScriptTag({path:path.join(root,"app/js/core",name)});
    for (const kind of ["python","exe"]) {
      await card.evaluate(kind => {
        document.body.replaceChildren();
        window.pywebview={api:{load_state(){},open_sticky_window(){},get_windows_startup_status(){},set_windows_startup_enabled(){}}};
        document.body.append(ZETER_ABOUT_UI_UTILS.aboutAppElement({getRuntimeInfo:async()=>({kind,platform:"win32"})}));
      },kind);
      await card.waitForFunction(kind=>document.querySelector('[data-runtime-mode]').textContent.includes(kind==="exe"?"EXE":"Python"),kind);
      assert.equal(await card.locator('[data-capability="windowsStickers"] [data-status="available"]').count(),1);
      assert.equal(await card.locator('[data-capability="windowsFiles"] [data-status="unavailable"]').count(),1);
      assert.equal(await card.locator('[data-capability="folderSave"] [data-status="unavailable"]').count(),1);
      checks.push(`${kind} identity and incomplete bridge`);
    }
    await card.evaluate(() => {
      delete window.pywebview; window.ZETER_PYTHON_STORAGE=true;
      window.__identityRefuse=true;
      document.body.replaceChildren(ZETER_ABOUT_UI_UTILS.aboutAppElement({getRuntimeInfo:async()=>{
        if(window.__identityRefuse)throw Error('synthetic refusal');
        return {kind:"python",platform:"win32"};
      }}));
    });
    await card.getByText(/не удалось уточнить режим запуска/).waitFor();
    assert.equal(await card.locator('[data-capability="windowsStickers"] [data-status="pending"]').count(),1);
    await card.evaluate(() => {
      window.pywebview={api:{load_state(){},open_sticky_window(){}}};
      window.__identityRefuse=false;
    });
    await card.locator('[data-capabilities-refresh]').click();
    await card.waitForFunction(()=>document.querySelector('[data-runtime-mode]').textContent.includes('Python'));
    assert.equal(await card.locator('[data-capability="windowsStickers"] [data-status="available"]').count(),1);
    checks.push("identity refusal then explicit retry after bridge ready");
    await card.evaluate(() => {
      delete window.pywebview; delete window.ZETER_PYTHON_STORAGE;
      window.Notification=Object.assign(function(){},{permission:"denied"});
      document.body.replaceChildren(ZETER_ABOUT_UI_UTILS.aboutAppElement());
    });
    // about:blank is not a secure origin; explicitly inject the feature probe in this isolated fixture.
    await card.evaluate(()=>{
      Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});
      document.querySelector('[data-capabilities-refresh]').click();
    });
    assert.equal(await card.locator('[data-capability="systemNotifications"] [data-status="unavailable"]').count(),1);
    await card.evaluate(()=>{window.Notification.permission="granted";});
    await card.locator('[data-capabilities-refresh]').click();
    assert.equal(await card.locator('[data-capability="systemNotifications"] [data-status="limited"]').count(),1);
    checks.push("notification permission denied then granted and refresh");
    await card.evaluate(()=>{
      Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
      Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Android'});
      document.querySelector('[data-capabilities-refresh]').click();
    });
    assert.match(await card.locator('[data-runtime-mode]').innerText(),/PWA на мобильном/);
    assert.equal(await card.locator('[data-capability="windowsStickers"] [data-status="unavailable"]').count(),1);
    checks.push("mobile PWA retains browser limitations");
    await component.close();
    assert.deepEqual(errors,[]);
  } catch(error) { failure=error; }
  const cleanup=await Promise.allSettled([browser?.close(),preview.close()]);
  fs.writeFileSync(path.join(out,"results.json"),JSON.stringify({status:failure?"FAIL":"PASS",checks,error:failure?.message,cleanup:cleanup.map(r=>r.status)},null,2));
  if(failure)throw failure;
  for(const result of cleanup)if(result.status==="rejected")throw result.reason;
  console.log(`capabilities UI: PASS (${checks.length} scenarios)`);
}
module.exports={runCapabilitiesSmoke};
