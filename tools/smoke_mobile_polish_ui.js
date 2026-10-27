"use strict";

// Import is inert. Public app preview, isolated contexts and synthetic data only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runMobilePolishSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/mobile-polish-qa/browser");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  const checks = [], errors = [];
  const noteName = 'Длинная заметка <b>без HTML</b> & "кавычки" ' + 'Название '.repeat(10);
  const secondName = ('Второй рабочий стол <b>без HTML</b> ' + 'Длинное имя '.repeat(7)).trim();
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block", acceptDownloads: true });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") {
        const seed = `if (!localStorage.getItem('polish-fixture')) {
          const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
          ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);
          s.fs['polish-note']={id:'polish-note',type:'note',name:${JSON.stringify(noteName)},parent:'desktop',content:'Исходный текст',richContent:'',x:40,y:40,createdAt:1,updatedAt:1};
          s.fs['polish-folder']={id:'polish-folder',type:'folder',name:'Папка <b>буквально</b>',parent:'desktop',x:200,y:40,createdAt:1,updatedAt:1};
          s.fs['polish-child']={id:'polish-child',type:'note',name:'Вложенная заметка <b>буквально</b>',parent:'polish-folder',content:'Соседний текст',richContent:'',createdAt:1,updatedAt:1};
          s.fs['polish-subfolder']={id:'polish-subfolder',type:'folder',name:'Вложенная папка <b>буквально</b>',parent:'polish-folder',createdAt:1,updatedAt:1};
          const other=JSON.parse(JSON.stringify(s.desktops[0].data));
          s.desktops.push({id:'polish-other',name:${JSON.stringify(secondName)},data:other});
          localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('polish-fixture','1');
        }`;
        return route.fulfill({ contentType: "application/javascript", body: seed + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      }
      return route.continue();
    });
    await page.goto(preview.url);
    await page.locator("#boot").waitFor({ state: "hidden" });
    const menu = page.locator("#context-menu");
    const switcher = page.locator("#mobile-desktop-switch");
    const menuTitle = menu.locator(".context-menu-title");
    const firstDesktop = (await page.locator("#mobile-desktop-name").textContent()).trim();
    const assertTitle = async text => {
      assert.equal(await menuTitle.textContent(), text);
      assert.equal(await menuTitle.locator("b, script, img").count(), 0, "name must remain literal text");
      const rect = await menu.boundingBox();
      const viewport = page.viewportSize();
      assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, "menu fits viewport");
    };
    const closeMenu = () => menu.locator(".context-close-btn").tap();
    const home = () => page.locator("#mobile-home-button").tap();

    for (const [width, height] of [[320,568], [390,844], [430,932], [844,390]]) {
      await page.setViewportSize({ width, height });
      await switcher.tap();
      await assertTitle("Рабочие столы");
      assert.equal(await menu.locator(".context-menu-items button").count(), 2);
      assert.match(await menu.locator(".context-menu-items button").first().textContent(), /✓.*текущий/s);
      const other = menu.getByRole("button", { name: secondName, exact: false });
      assert.equal(await other.count(), 1);
      assert.ok(await other.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "long desktop name wraps");
      await page.screenshot({ path: path.join(out, `desktops-${width}.png`) });
      await page.keyboard.press("Escape");
      assert.equal(await menu.isVisible(), false);
      assert.equal(await switcher.evaluate(el => el === document.activeElement), true);
      await switcher.tap();
      await page.locator(".mobile-brand > img").tap();
      assert.equal(await menu.isVisible(), false, "outside closes picker");
      checks.push(`picker-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const desktopNote = page.locator('.desktop-item:has(.desktop-icon[data-item-id="polish-note"])');
    await desktopNote.locator(".desktop-item-menu").tap();
    await assertTitle(noteName);
    assert.equal(await page.locator('.window[data-app-id="editor"]').count(), 0);
    await page.screenshot({ path: path.join(out, "material-menu.png") });
    await closeMenu();
    await desktopNote.locator(".desktop-icon").tap();
    const editor = page.locator('.window[data-app-id="editor"]:not(.minimized)').last();
    await editor.waitFor();
    const actions = editor.locator(".editor-header-actions");
    const more = actions.locator('[data-action="more"]');
    for (const [width, height] of [[320,568], [390,844], [430,932], [844,390]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await actions.locator('[data-action="new"]').isVisible(), true);
      assert.equal(await actions.locator('[data-action="folder"]').isVisible(), true);
      assert.equal(await actions.locator('[data-action="download-docx"]').isVisible(), false);
      assert.ok(await actions.evaluate(el => el.scrollWidth <= el.clientWidth + 1), "editor actions fit without horizontal scrolling");
      await page.screenshot({ path: path.join(out, `editor-${width}.png`) });
      await more.tap();
      await assertTitle(noteName);
      await page.screenshot({ path: path.join(out, `editor-more-${width}.png`) });
      assert.equal(await menu.locator(".context-menu-items button").count(), 4);
      await page.keyboard.press("Escape");
      assert.equal(await more.evaluate(el => el === document.activeElement), true);
      checks.push(`editor-${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const area = editor.locator(".rich-editor-area");
    await area.fill("Текст после мобильной правки — сохранён");
    await editor.locator('[data-status]').filter({ hasText: "Автосохранено" }).waitFor();
    const downloadPromise = page.waitForEvent("download");
    await more.tap();
    await menu.getByRole("button", { name: "Скачать файл в формате TXT", exact: true }).tap();
    const download = await downloadPromise;
    const txtPath = path.join(out, "note.txt");
    await download.saveAs(txtPath);
    assert.equal(fs.readFileSync(txtPath, "utf8"), "Текст после мобильной правки — сохранён");
    const materialsBeforeCopy = await page.locator(".desktop-icon").count();
    await more.tap();
    await menu.getByRole("button", { name: "Создать копию файла", exact: true }).tap();
    assert.equal(await menu.isVisible(), false);
    await home();
    assert.equal(await page.locator(".desktop-icon").count(), materialsBeforeCopy + 1, "copy creates exactly one material");
    const copy = page.locator(".desktop-icon").filter({ hasText: "— копия" });
    assert.equal(await copy.count(), 1);
    await copy.tap();
    assert.equal(await page.locator('.window[data-app-id="editor"]:not(.minimized)').last().locator(".rich-editor-area").innerText(), "Текст после мобильной правки — сохранён", "copy contains the saved text");
    await home();
    await switcher.tap();
    await menu.getByRole("button", { name: secondName, exact: false }).tap();
    await page.waitForFunction(name => document.querySelector("#mobile-desktop-name").textContent === name, secondName);
    await switcher.tap();
    assert.match(await menu.locator(".context-menu-items button").last().textContent(), /✓.*текущий/s);
    await menu.getByRole("button", { name: firstDesktop, exact: false }).tap();
    await page.waitForFunction(name => document.querySelector("#mobile-desktop-name").textContent === name, firstDesktop);
    await page.reload();
    await page.locator("#boot").waitFor({ state: "hidden" });
    await page.locator('.desktop-icon[data-item-id="polish-note"]').tap();
    assert.equal(await page.locator('.window[data-app-id="editor"]:not(.minimized)').last().locator(".rich-editor-area").innerText(), "Текст после мобильной правки — сохранён");
    checks.push("txt-export-copy-switch-reload-preserves-note");
    await home();
    await page.locator('.desktop-icon[data-item-id="polish-folder"]').tap();
    const folder = page.locator('.window[data-app-id="folder"]:not(.minimized)').last();
    await folder.waitFor();
    for (const [id, name] of [["polish-child", "Вложенная заметка <b>буквально</b>"], ["polish-subfolder", "Вложенная папка <b>буквально</b>"]]) {
      await folder.locator(`.file-card[data-item-id="${id}"] .explorer-item-menu`).tap();
      await assertTitle(name);
      await closeMenu();
    }
    checks.push("explorer-file-folder-titles");
    await home();
    await page.locator('.desktop-icon[data-item-id="polish-note"]').tap();
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktopActions = page.locator('.window[data-app-id="editor"]:not(.minimized)').last().locator(".editor-header-actions");
    assert.equal(await switcher.isVisible(), false);
    assert.equal(await desktopActions.locator('[data-action="more"]').isVisible(), false);
    for (const action of ["new", "folder", "duplicate", "download-txt", "download-html", "download-docx"]) {
      assert.equal(await desktopActions.locator(`[data-action="${action}"]`).isVisible(), true);
    }
    await page.screenshot({ path: path.join(out, "desktop-editor.png") });
    checks.push("desktop-all-original-actions");
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    return { checks, errors, out };
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
}

module.exports = { runMobilePolishSmoke };
