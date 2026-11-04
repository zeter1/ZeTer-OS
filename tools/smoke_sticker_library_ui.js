"use strict";
// Explicit synthetic browser acceptance; importing this file is inert.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
async function runStickersSmoke({ chromium, startPreview, outputDir, browserExecutable } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/stickers-qa"); fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "sticky-window.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  let browser, page; const checks = [], errors = [];
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
    const seed = `const owner=window.ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...owner,createPrimaryStateSaveQueue:options=>{
      const queue=owner.createPrimaryStateSaveQueue(options);return {...queue,transaction:operation=>queue.transaction(write=>operation(async(s,o)=>{if(window.__stickerHold)await new Promise(resolve=>{window.__stickerRelease=()=>{window.__stickerHold=false;resolve();};});if(window.__stickerRefuse)throw new Error('Тест: запись недоступна');return write(s,o);} ))};}};
      if(!localStorage.getItem('sticker-fixture')){const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);const d=s.desktops[0];
      s.fs['sticker-source']={id:'sticker-source',type:'note',parent:d.id,name:'Стикер из заметки',content:'Исходный текст',richContent:'<p>Исходный текст</p>'};d.data.noteStickies=[{noteId:'sticker-source',desktop:false}];
      s.desktops.push({id:'sticker-other',name:'Другой стол',data:ZETER_WORKSPACE_UTILS.workspaceDefaults({noteStickies:[{noteId:'sticker-neighbor',desktop:false}]})});
      s.fs['sticker-neighbor']={id:'sticker-neighbor',type:'note',parent:'sticker-other',name:'Соседний стикер',content:'Текст другого стола'};
      localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('sticker-fixture','1');}`;
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === "/js/app.js") {
        const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8"), anchor = '  function renderStickersApp(params = {}, winId = "") {';
        const instrumented = source.replace('createProjectIcon: window.ZETER_VISUAL_UTILS.createDesktopIconFromFile,', 'createProjectIcon: async file => { const image=await window.ZETER_VISUAL_UTILS.createDesktopIconFromFile(file); if(window.__iconHold) await new Promise(resolve=>{window.__iconRelease=()=>{window.__iconHold=false;resolve();};}); window.__iconCompleted=(window.__iconCompleted||0)+1; return image; },');
        return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + instrumented.replace(anchor, anchor + '\n    window.__stickerGetState=()=>state; window.__stickerOpen=()=>openApp("stickers");window.__stickerSwitch=switchVirtualDesktop;') });
      }
      return route.continue();
    });
    const check = async (name, operation) => { await operation(); checks.push({ name, status: "PASS" }); console.log(`stickers UI PASS: ${name}`); };
    const open = async () => {
      await page.locator('[data-top-action="appcenter"]').click();
      const install = page.locator('[data-install-app="stickers"]'); if (await install.count()) await install.click();
      await page.locator('[data-open-app="stickers"]').last().click(); await page.locator(".sticker-library-app").last().waitFor();
    };
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    const app = page.locator(".sticker-library-app").last(), win = page.locator('.window[data-app-id="stickers"]').last();
    await win.evaluate(el => Object.assign(el.style, { width: "1420px", height: "930px", left: "20px", top: "45px" }));
    const action = name => app.locator(`[data-sticker-action="${name}"]`), form = () => app.locator("[data-sticker-form]");
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__stickerGetState())));
    const groupDialog = () => app.locator("[data-sticker-dialog]");
    const saveGroup = async name => { await groupDialog().locator('[name="entityName"]').fill(name); await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({ state: "detached" }); };
    const revealMenu = async card => { const menu = card.locator('.sticker-library-card-menu'); if (!await menu.evaluate(el => el.open)) await menu.locator('summary').click(); };
    const showNavigation = async current => { const toggle = current.locator('[data-sticker-action="navigation"]'); if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click(); };
    await check("board heading, live counts, desktop in sidebar and primary create", async () => {
      assert.equal(await app.locator('[data-sticker-heading]').textContent(), "Все стикеры");
      assert.match(await app.locator('[data-sticker-count]').textContent(), /^1 стикер · /);
      assert.equal(await app.locator('.sticker-library-sidebar [data-sticker-desktop]').count(), 1);
      assert.equal(await app.locator('.sticker-library-heading [data-sticker-action="new"]').count(), 1);
      assert.equal(await app.locator('.sticker-library-global-nav .sticker-library-nav-count').first().textContent(), "1");
      assert.equal(await action('project-settings').isVisible(), false);
      await page.screenshot({ path: path.join(out, "board-baseline.png") });
    });
    await check("catalog, existing sticky, current desktop default and explicit other/all", async () => {
      const s = await state(); assert.equal(await app.locator("[data-sticker-desktop]").inputValue(), s.desktops[0].id);
      assert.equal(await app.locator("[data-sticker-note]").count(), 1); assert.match(await app.innerText(), /Стикер из заметки/);
      await app.locator("[data-sticker-desktop]").selectOption("sticker-other"); assert.match(await app.innerText(), /Соседний стикер/);
      await app.locator("[data-sticker-desktop]").selectOption(""); assert.equal(await app.locator("[data-sticker-note]").count(), 2);
      await app.locator("[data-sticker-desktop]").selectOption(s.desktops[0].id);
    });
    await check("project plus placement, ZeTer dialog keyboard/cancel, failed save retains name and retry", async () => {
      const plus = action("add-project"); assert.equal((await plus.innerText()).trim(), "＋");
      assert.equal(await plus.locator("xpath=..").locator("h3").textContent(), "Проекты");
      await plus.focus(); await page.keyboard.press("Enter");
      const input = groupDialog().locator('[name="entityName"]');
      assert.equal(await input.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Shift+Tab"); assert.equal(await groupDialog().locator('[type="submit"]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab"); assert.equal(await input.evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape"); await groupDialog().waitFor({ state: "detached" }); assert.equal(await plus.evaluate(el => el === document.activeElement), true);
      await plus.click(); await input.fill("Черновик проекта"); await page.evaluate(() => { window.__stickerRefuse = true; });
      await groupDialog().locator('[type="submit"]').click(); await groupDialog().locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
      assert.equal(await input.inputValue(), "Черновик проекта"); assert.equal((await state()).desktops[0].data.stickyLibrary?.projects?.length || 0, 0);
      await page.screenshot({ path: path.join(out, "project-save-error.png") });
      await page.evaluate(() => { window.__stickerRefuse = false; }); await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({ state: "detached" });
      await action("project").filter({ hasText: "Черновик проекта" }).click(); await action("project-settings").click();
      assert.equal(await groupDialog().locator('[name="entityName"]').inputValue(), "Черновик проекта");
      await saveGroup("Переименованный проект"); await action("project").filter({ hasText: "Переименованный проект" }).waitFor();
      const projectRow = app.locator('.sticker-library-project').filter({ hasText: "Переименованный проект" });
      assert.equal(await projectRow.locator('[data-sticker-action="project-settings"]').count(), 0);
      assert.equal(await app.locator('.sticker-library-title-row [data-sticker-action="project-settings"]').isVisible(), true);
      assert.equal(await projectRow.locator('[data-sticker-action="project"]').getAttribute('data-group-id'), await action('project-settings').getAttribute('data-group-id'));
      await action("project-settings").click(); await groupDialog().locator('[data-sticker-dialog-remove]').click();
      await groupDialog().locator('[data-sticker-dialog-cancel]').click(); assert.equal((await state()).desktops[0].data.stickyLibrary.projects.length, 1);
      await action("project-settings").click(); await groupDialog().locator('[data-sticker-dialog-remove]').click();
      await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.stickyLibrary.projects.length, 0);
      assert.equal(await action("project-settings").isVisible(), false); assert.equal(await action("add-category").isVisible(), false);
      assert.equal(await plus.evaluate(el => el === document.activeElement), true, "deleted project returns focus to visible project plus");
      assert.ok((await state()).fs["sticker-source"]);
    });
    await check("stale sticker metadata keeps newer favorite and the local draft", async () => {
      await app.locator('[data-sticker-note="sticker-source"] [data-sticker-action="edit"]').click();
      await form().locator('[data-sticker-text]').fill('Несохранённый текст');
      await page.evaluate(() => { const s=window.__stickerGetState(); s.desktops[0].data.noteStickies.find(item=>item.noteId==='sticker-source').favorite=true; document.querySelector('.sticker-library-app').refreshStickers(); });
      await form().locator('[type="submit"]').click();
      await form().locator('[data-sticker-editor-error]:not([hidden])').waitFor();
      assert.match(await form().locator('[data-sticker-editor-error]').textContent(), /другом окне/);
      assert.equal(await form().locator('[data-sticker-text]').innerText(), 'Несохранённый текст');
      assert.equal((await state()).desktops[0].data.noteStickies.find(item=>item.noteId==='sticker-source').favorite,true);
      assert.equal((await state()).fs['sticker-source'].content,'Исходный текст');
      await page.screenshot({path:path.join(out,'metadata-conflict.png')});
      await action('cancel').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click();
      await app.locator('[data-sticker-note="sticker-source"] [data-sticker-action="favorite"]').click();
      await page.waitForFunction(()=>!document.querySelector('.sticker-library-app').hasAttribute('aria-busy'));
    });
    await check("stale project/category forms keep newer names and their drafts", async () => {
      await action('add-project').click(); await saveGroup('Проверка конфликта'); await action('project').click();
      for(const kind of ['projects','categories']) {
        if(kind==='categories') { await action('add-category').click(); await saveGroup('Категория до изменения'); const id=(await state()).desktops[0].data.stickyLibrary.categories[0].id; await app.locator('[data-sticker-category]').selectOption(id); }
        await action(kind==='projects'?'project-settings':'category-settings').click();
        await groupDialog().locator('[name="entityName"]').fill('Мой черновик');
        await page.evaluate(kind=>{const s=window.__stickerGetState();s.desktops[0].data.stickyLibrary[kind][0].name='Новое название другого окна';document.querySelector('.sticker-library-app').refreshStickers();},kind);
        await groupDialog().locator('[type="submit"]').click(); await groupDialog().locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
        assert.match(await groupDialog().locator('[data-sticker-dialog-error]').textContent(),/другом окне/);
        assert.equal(await groupDialog().locator('[name="entityName"]').inputValue(),'Мой черновик');
        assert.equal((await state()).desktops[0].data.stickyLibrary[kind][0].name,'Новое название другого окна');
        await groupDialog().locator('[data-sticker-dialog-cancel]').click();
      }
      await action('project-settings').click(); await groupDialog().locator('[data-sticker-dialog-remove]').click();
      await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({state:'detached'});
    });
    await check("stale preferences keep newer density and the local switches", async () => {
      await win.locator('[data-sticker-settings]').click(); await groupDialog().locator('[name="showHint"]').uncheck();
      await page.evaluate(()=>{window.__stickerGetState().desktops[0].data.stickyLibrary.preferences.density='compact';document.querySelector('.sticker-library-app').refreshStickers();});
      await groupDialog().locator('[type="submit"]').click(); await groupDialog().locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
      assert.match(await groupDialog().locator('[data-sticker-dialog-error]').textContent(),/другом окне/);
      assert.equal(await groupDialog().locator('[name="showHint"]').isChecked(),false);
      assert.equal((await state()).desktops[0].data.stickyLibrary.preferences.density,'compact');
      assert.equal((await state()).desktops[0].data.stickyLibrary.preferences.showHint,true);
      await groupDialog().locator('[data-sticker-dialog-cancel]').click();
      await win.locator('[data-sticker-settings]').click(); await groupDialog().locator('[name="density"]').selectOption('comfortable');
      await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({state:'detached'});
    });
    await check("project and category creation, new rich sticker, safe text and retained ownership", async () => {
      await action("add-project").click(); await saveGroup("Проект стикеров");
      await action("project").filter({ hasText: "Проект стикеров" }).waitFor(); await action("project").click();
      assert.equal(await action("add-category").innerText(), "Создать категорию в проекте");
      assert.equal(await app.locator('.sticker-library-heading [data-sticker-action="add-category"]').count(), 0);
      assert.equal(await app.locator('.sticker-library-main [data-sticker-action="add-category"]').count(), 1);
      await action("add-category").click(); assert.equal(await groupDialog().getAttribute("aria-label"), "Создать категорию в проекте"); await saveGroup("Идеи");
      assert.equal(await app.locator('[data-sticker-category] option').count(), 2);
      assert.equal(await app.locator('.sticker-library-sidebar [data-sticker-action="category"]').count(), 0);
      await page.screenshot({ path: path.join(out, "project-with-category.png") });
      const presetCategory = (await state()).desktops[0].data.stickyLibrary.categories[0].id;
      await app.locator('[data-sticker-category]').selectOption(presetCategory);
      await action("new").first().click(); await form().locator('[name="title"]').fill("Новая идея");
      assert.equal(await app.locator('dialog[data-sticker-new-dialog][open]').count(), 1);
      assert.equal(await app.locator('section[data-sticker-editor] form').count(), 0, "creation no longer occupies the bottom of library");
      assert.equal(await form().locator('[name="categoryId"]').inputValue(), presetCategory);
      await form().locator("[data-sticker-text]").fill("Кириллица\n<script>не HTML</script>");
      const project = (await state()).desktops[0].data.stickyLibrary.projects[0].id;
      await form().locator('[name="projectId"]').selectOption(project);
      const category = (await state()).desktops[0].data.stickyLibrary.categories[0].id; await form().locator('[name="categoryId"]').selectOption(category);
      await form().locator('[name="color"]').selectOption("mint");
      await page.screenshot({ path: path.join(out, "new-sticker-window.png") });
      await page.evaluate(() => { window.__stickerRefuse = true; }); await form().locator('[type="submit"]').click();
      await form().locator('[data-sticker-editor-error]:not([hidden])').waitFor(); assert.equal(await form().locator('[name="title"]').inputValue(), "Новая идея");
      assert.equal(Object.values((await state()).fs).some(note => note.name === "Новая идея"), false);
      await page.evaluate(() => { window.__stickerRefuse = false; window.__stickerHold = true; delete window.__stickerRelease; }); await form().locator('[type="submit"]').click();
      await page.waitForFunction(() => typeof window.__stickerRelease === "function"); await page.keyboard.press("Escape");
      assert.equal(await app.locator('dialog[data-sticker-new-dialog][open]').count(), 1); assert.equal(await form().locator('[name="title"]').isDisabled(), true);
      await page.evaluate(() => { window.__stickerRelease(); }); await form().waitFor({ state: "detached" });
      const s = await state(), note = Object.values(s.fs).find(item => item.name === "Новая идея"); assert.ok(note); assert.equal(note.parent, s.desktops[0].id); assert.match(note.content, /<script>не HTML<\/script>/);
      assert.equal(s.desktops[0].data.noteStickies.find(item => item.noteId === note.id).categoryId, category);
    });
    await check("project category dropdown filters cards, resets selection and keeps creation beside list", async () => {
      const first = (await state()).desktops[0].data.stickyLibrary.categories[0].id;
      await action("add-category").click(); await saveGroup("Без стикеров");
      const second = (await state()).desktops[0].data.stickyLibrary.categories.find(item => item.name === "Без стикеров").id;
      await app.locator('[data-sticker-category]').selectOption(second); assert.equal(await app.locator('[data-sticker-note]').count(), 0);
      await app.locator('[data-sticker-category]').selectOption(first); assert.equal(await app.locator('[data-sticker-note]').count(), 1);
      await app.locator('[data-sticker-category]').selectOption(""); assert.equal(await app.locator('[data-sticker-note]').count(), 1); assert.equal(await action("category-settings").isVisible(), false);
      await action("all").click(); assert.equal(await app.locator('[data-sticker-category-controls]').isVisible(), false);
      await action("project").click(); assert.equal(await app.locator('[data-sticker-category]').inputValue(), "");
      await app.locator('[data-sticker-category]').selectOption(first);
      await page.screenshot({ path: path.join(out, "category-dropdown.png") });
    });
    await check("settings retain stickers, duplicate name, pending Escape blocked, category rename and remove", async () => {
      await action("category-settings").click(); await groupDialog().locator('[name="entityName"]').fill("Новые идеи");
      await page.evaluate(() => { window.__stickerHold = true; }); await groupDialog().locator('[type="submit"]').click();
      await page.waitForFunction(() => typeof window.__stickerRelease === "function");
      await page.keyboard.press("Escape"); assert.equal(await groupDialog().count(), 1); assert.equal(await groupDialog().locator('[name="entityName"]').isDisabled(), true);
      await page.evaluate(() => { window.__stickerRelease(); }); await groupDialog().waitFor({ state: "detached" });
      assert.ok((await app.locator('[data-sticker-category]').innerText()).includes("Новые идеи"));
      await action("add-project").click(); await groupDialog().locator('[name="entityName"]').fill("проект стикеров"); await groupDialog().locator('[type="submit"]').click();
      await groupDialog().locator('[data-sticker-dialog-error]:not([hidden])').waitFor(); assert.equal(await groupDialog().locator('[name="entityName"]').inputValue(), "проект стикеров");
      await groupDialog().locator('[data-sticker-dialog-cancel]').click();
      await action("category-settings").click(); await groupDialog().locator('[data-sticker-dialog-remove]').click();
      await page.evaluate(() => { window.__stickerRefuse = true; }); await groupDialog().locator('[type="submit"]').click();
      await groupDialog().locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
      assert.equal((await state()).desktops[0].data.stickyLibrary.categories.length, 2);
      await page.evaluate(() => { window.__stickerRefuse = false; }); await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.stickyLibrary.categories.length, 1);
      assert.equal(await app.locator('[data-sticker-category]').inputValue(), "", "deleted category returns to all categories");
      const s = await state(), note = Object.values(s.fs).find(item => item.name === "Новая идея"); assert.ok(note); assert.equal(s.desktops[0].data.noteStickies.find(item => item.noteId === note.id).categoryId, "");
    });
    await check("header gear follows selected project, cancel focus and deletion keep other project", async () => {
      const first = (await state()).desktops[0].data.stickyLibrary.projects[0];
      await action("add-project").click(); await saveGroup("Второй проект");
      const row = () => app.locator('.sticker-library-project').filter({ hasText: "Второй проект" });
      await row().locator('[data-sticker-action="project"]').click();
      const selectedId=await row().locator('[data-sticker-action="project"]').getAttribute('data-group-id');
      assert.equal(await action('project-settings').getAttribute('data-group-id'),selectedId);
      await action('project-settings').focus(); await page.keyboard.press('Enter');
      assert.equal(await groupDialog().locator('[name="entityName"]').inputValue(), "Второй проект");
      await page.keyboard.press('Escape'); await groupDialog().waitFor({state:'detached'});
      assert.equal(await action('project-settings').evaluate(el=>el===document.activeElement),true);
      await action('project-settings').click();
      await saveGroup("Второй проект после правки");
      assert.equal((await state()).desktops[0].data.stickyLibrary.projects.find(item => item.id === first.id).name, first.name);
      assert.equal(await row().locator('[data-sticker-action="project"]').getAttribute('aria-pressed'),'true');
      await action('project-settings').click(); await groupDialog().locator('[data-sticker-dialog-remove]').click();
      await groupDialog().locator('[type="submit"]').click(); await groupDialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.stickyLibrary.projects.length, 1);
      assert.equal(await action('project-settings').isVisible(),false);
      await action('unassigned').click(); assert.equal(await action('project-settings').isVisible(),false);
      await action('project').click();
      assert.equal(await action("project").getAttribute("aria-pressed"), "true");
      assert.equal(await action('project-settings').getAttribute('data-group-id'),first.id);
    });
    await action("all").click();
    await check("project icon upload, presets, description/color, refusal/retry and late decode", async () => {
      await action('project').click(); await action('project-settings').click();
      const dialog=groupDialog(), png={name:'project.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64')};
      await dialog.locator('[name="description"]').fill('Проект <b>без HTML</b>');
      await dialog.locator('[name="projectColor"]').selectOption('teal');
      assert.equal(await dialog.locator('[name="projectColor"] option').count(),16);
      await dialog.locator('[data-sticker-icon-preset="rocket"]').click();
      await dialog.locator('[data-sticker-icon-file]').setInputFiles(png);
      await dialog.locator('[data-sticker-icon-preview] img').waitFor();
      const before=JSON.stringify((await state()).desktops[0].data.stickyLibrary.projects);
      await page.evaluate(()=>{window.__stickerRefuse=true;}); await dialog.locator('[type="submit"]').click();
      await dialog.locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
      assert.equal(JSON.stringify((await state()).desktops[0].data.stickyLibrary.projects),before);
      assert.equal(await dialog.locator('[data-sticker-icon-preview] img').count(),1);
      await page.evaluate(()=>{window.__stickerRefuse=false;});await dialog.locator('[type="submit"]').click();await dialog.waitFor({state:'detached'});
      const saved=(await state()).desktops[0].data.stickyLibrary.projects[0];assert.match(saved.iconDataURL,/^data:image\/png;base64,/);assert.equal(saved.color,'teal');
      assert.equal(await app.locator('[data-sticker-project-description]').textContent(),'Проект <b>без HTML</b>');
      assert.equal(await app.locator('[data-sticker-project-description] b').count(),0);
      assert.equal(await app.locator('[data-sticker-project-mark] img').count(),1);
      await action('project-settings').click();
      await dialog.locator('[data-sticker-icon-file]').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg onload="bad()"/>')});
      await dialog.locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
      assert.equal(await dialog.locator('[data-sticker-icon-preview] img').count(),1);
      await page.evaluate(()=>{window.__iconHold=true;delete window.__iconRelease;});
      await dialog.locator('[data-sticker-icon-file]').setInputFiles(png);await page.waitForFunction(()=>typeof window.__iconRelease==='function');
      await dialog.locator('[data-sticker-icon-preset="book"]').click();
      const completed=await page.evaluate(()=>window.__iconCompleted);await page.evaluate(()=>{window.__iconRelease();delete window.__iconRelease;});
      await page.waitForFunction(n=>window.__iconCompleted>n,completed);
      assert.equal(await dialog.locator('[data-sticker-icon-preset="book"]').getAttribute('aria-pressed'),'true');
      assert.equal(await dialog.locator('[data-sticker-icon-preview] img').count(),0);
      await page.screenshot({path:path.join(out,'project-settings.png')});
      await dialog.locator('[data-sticker-dialog-cancel]').click();await dialog.waitFor({state:'detached'});
      assert.equal((await state()).desktops[0].data.stickyLibrary.projects[0].iconDataURL,saved.iconDataURL);
      await action('project-settings').click();await page.evaluate(()=>{window.__iconHold=true;delete window.__iconRelease;});
      await dialog.locator('[data-sticker-icon-file]').setInputFiles(png);await page.waitForFunction(()=>typeof window.__iconRelease==='function');
      await dialog.locator('[data-sticker-dialog-cancel]').click();await dialog.waitFor({state:'detached'});
      const closedCompleted=await page.evaluate(()=>window.__iconCompleted);
      await page.evaluate(()=>{window.__iconRelease();delete window.__iconRelease;});
      await page.waitForFunction(n=>window.__iconCompleted>n,closedCompleted);
      assert.equal((await state()).desktops[0].data.stickyLibrary.projects[0].iconDataURL,saved.iconDataURL);
      await action('all').click();
    });
    await check("upload settles when close preparation is cancelled", async () => {
      await action('project').click();await action('project-settings').click();const dialog=groupDialog();
      const png={name:'close.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=','base64')};
      await page.evaluate(()=>{window.__iconHold=true;delete window.__iconRelease;});
      await dialog.locator('[data-sticker-icon-file]').setInputFiles(png);await page.waitForFunction(()=>typeof window.__iconRelease==='function');
      const preparing = app.evaluate(el=>el.prepareStickerClose());
      await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click();
      assert.equal(await preparing,true);
      assert.equal(await app.evaluate(el=>el.inert),true);
      const completed=await page.evaluate(()=>window.__iconCompleted);await page.evaluate(()=>{window.__iconRelease();delete window.__iconRelease;});
      await page.waitForFunction(n=>window.__iconCompleted>n,completed);
      await app.evaluate(el=>el.cancelStickerClose());
      assert.equal(await dialog.locator('[type="submit"]').isEnabled(),true,'settled upload must not leave pending lock after cancelled close');
      assert.equal(await dialog.locator('[data-sticker-icon-preview] img').count(),1);
      await dialog.locator('[data-sticker-dialog-cancel]').click();await dialog.waitFor({state:'detached'});await action('all').click();
    });
    await check("titlebar app settings, ACK retry, desktop isolation and new color default", async () => {
      const settings=win.locator('[data-window-header-tools] [data-sticker-settings]');assert.equal(await settings.isVisible(),true);
      await settings.focus();await page.keyboard.press('Enter'); const dialog=groupDialog();
      assert.equal(await dialog.getAttribute('aria-label'),'Настройки стикеров');
      assert.equal(await dialog.locator('[name="density"]').evaluate(el=>el===document.activeElement),true);
      await dialog.locator('[name="density"]').selectOption('compact');await dialog.locator('[name="sort"]').selectOption('name');
      await dialog.locator('[name="defaultColor"]').selectOption('orange');await dialog.locator('[name="showPath"]').uncheck();await dialog.locator('[name="showHint"]').uncheck();
      await page.evaluate(()=>{window.__stickerRefuse=true;});await dialog.locator('[type="submit"]').click();await dialog.locator('[data-sticker-dialog-error]:not([hidden])').waitFor();
      assert.equal((await state()).desktops[0].data.stickyLibrary.preferences.density,'comfortable');
      await page.evaluate(()=>{window.__stickerRefuse=false;});await dialog.locator('[type="submit"]').click();await dialog.waitFor({state:'detached'});
      assert.equal(await settings.evaluate(el=>el===document.activeElement),true);
      assert.equal(await app.getAttribute('data-density'),'compact');assert.equal(await app.locator('.sticker-library-hint').isVisible(),false);
      assert.equal(await app.locator('[data-sticker-sort]').inputValue(),'name');
      assert.ok(await app.locator('.sticker-library-location').evaluateAll(nodes=>nodes.every(node=>node.hidden)));
      await action('new').first().click();assert.equal(await form().locator('[name="color"]').inputValue(),'orange');assert.equal(await form().locator('[name="color"] option').count(),16);await action('cancel').click();
      const desk=(await state()).desktops[0].id;
      await app.locator('[data-sticker-desktop]').selectOption('sticker-other');assert.equal(await app.getAttribute('data-density'),'comfortable');
      await app.locator('[data-sticker-desktop]').selectOption(desk);assert.equal(await app.getAttribute('data-density'),'compact');
      await settings.click();await page.screenshot({path:path.join(out,'app-settings.png')});
      await dialog.locator('[name="density"]').selectOption('comfortable');await dialog.locator('[name="sort"]').selectOption('updated');await dialog.locator('[name="defaultColor"]').selectOption('purple');await dialog.locator('[name="showPath"]').check();await dialog.locator('[name="showHint"]').check();
      await dialog.locator('[type="submit"]').click();await dialog.waitFor({state:'detached'});
    });
    await check("project appearance import rejects external URLs, SVG and invalid metadata", async () => {
      const results=await page.evaluate(()=>{
        const valid=JSON.parse(JSON.stringify(window.__stickerGetState()));
        const validate=state=>window.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport(state);
        validate(valid);const rejected=[];
        for(const patch of [{iconDataURL:'https://example.invalid/x.png'},{iconDataURL:'data:image/svg+xml;base64,PHN2Zz4='},{description:42},{iconId:'<bad>'},{color:'unlisted'}]){
          const copy=JSON.parse(JSON.stringify(valid));Object.assign(copy.desktops[0].data.stickyLibrary.projects[0],patch);
          try{validate(copy);rejected.push(false);}catch(error){rejected.push(true);}
        }
        const archived=JSON.parse(JSON.stringify(valid));
        archived.archivedDesktops=[{id:'appearance_archive',archivedAt:'2026-11-03T09:00:00Z',desktop:JSON.parse(JSON.stringify(valid.desktops[0])),fs:JSON.parse(JSON.stringify(valid.fs))}];
        validate(archived);
        archived.archivedDesktops[0].desktop.data.stickyLibrary.projects[0].iconDataURL='data:image/svg+xml;base64,PHN2Zz4=';
        try{validate(archived);rejected.push(false);}catch(error){rejected.push(/PNG/.test(error.message));}
        return rejected;
      });
      assert.deepEqual(results,[true,true,true,true,true,true]);
    });
    await check("direct card editing, Escape/cancel and rejected navigation preserve draft", async () => {
      const card = app.locator('[data-sticker-note="sticker-source"]');
      await card.locator('[data-sticker-action="quick-edit"]').focus(); await page.keyboard.press('Enter');
      assert.equal(await card.locator('[data-sticker-form]').count(), 1, "editor stays inside this card");
      assert.equal(await form().locator('[name="title"]').evaluate(el => el === document.activeElement), true);
      await form().locator('[data-sticker-text]').fill('Несохранённый текст карточки');
      await action('favorites').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
      assert.equal(await form().locator('[data-sticker-text]').innerText(), 'Несохранённый текст карточки');
      await form().locator('[data-sticker-text]').evaluate(el => { window.__inlineDraftNode = el; window.__inlineDraftRoot = el.closest('.sticker-library-app'); });
      await page.evaluate(() => window.__inlineDraftRoot.refreshStickers());
      assert.equal(await form().locator('[data-sticker-text]').evaluate(el => el === window.__inlineDraftNode), true);
      assert.equal(await form().locator('[data-sticker-text]').innerText(), 'Несохранённый текст карточки');
      await form().locator('[data-sticker-text]').focus();
      await page.keyboard.press('Escape'); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
      assert.equal(await form().count(), 1);
      await action('cancel').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click(); await form().waitFor({state:'detached'});
      assert.equal((await state()).fs['sticker-source'].content, 'Исходный текст');
      assert.equal(await card.locator('[data-sticker-action="quick-edit"]').evaluate(el => el === document.activeElement), true);
    });
    await check("inline stale edit preserves external note and local draft", async () => {
      const card = app.locator('[data-sticker-note]').filter({hasText:'Новая идея'});
      await card.locator('[data-sticker-action="quick-edit"]').click();
      await form().locator('[data-sticker-text]').fill('Мой отдельный черновик');
      const noteId = await card.getAttribute('data-sticker-note');
      await page.evaluate(id => { const note=window.__stickerGetState().fs[id]; note.content='Правка другого окна'; note.richContent='<p>Правка другого окна</p>'; document.querySelector('.sticker-library-app').refreshStickers(); }, noteId);
      await form().locator('[type="submit"]').click(); await form().locator('[data-sticker-editor-error]:not([hidden])').waitFor();
      assert.equal(await form().locator('[data-sticker-text]').innerText(), 'Мой отдельный черновик');
      assert.equal((await state()).fs[noteId].content, 'Правка другого окна');
      await page.screenshot({path:path.join(out,'inline-conflict.png')});
      await action('cancel').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click(); await form().waitFor({state:'detached'});
    });
    await check("inline settings preserve rich text and pending ACK blocks navigation", async () => {
      const card=app.locator('[data-sticker-note]').filter({hasText:'Новая идея'}), noteId=await card.getAttribute('data-sticker-note');
      const markup='<p>Правка <strong>другого окна</strong></p>';
      await page.evaluate(({id,html})=>{const note=window.__stickerGetState().fs[id];note.richContent=html;document.querySelector('.sticker-library-app').refreshStickers();},{id:noteId,html:markup});
      await card.locator('[data-sticker-action="edit"]').click();
      await form().locator('.sticker-library-editor-settings summary').click();
      await form().locator('[name="color"]').selectOption('pink'); await form().locator('[name="favorite"]').check();
      await page.evaluate(()=>{window.__stickerHold=true;}); await form().locator('[type="submit"]').click();
      await page.waitForFunction(()=>typeof window.__stickerRelease==='function');
      await app.locator('[data-sticker-search]').fill('Пока сохраняется');
      assert.equal(await app.locator('[data-sticker-search]').inputValue(),'');
      assert.equal(await form().locator('[data-sticker-text]').isVisible(),true);
      await page.keyboard.press('Escape'); assert.equal(await form().count(),1);
      await page.evaluate(()=>{window.__stickerRelease();delete window.__stickerRelease;}); await form().waitFor({state:'detached'});
      const saved=await state(), sticky=saved.desktops[0].data.noteStickies.find(item=>item.noteId===noteId);
      assert.equal(saved.fs[noteId].richContent,markup); assert.equal(sticky.color,'pink'); assert.equal(sticky.favorite,true);
      assert.equal(await card.getAttribute('data-color'),'pink');
    });
    await check("failed primary save retains draft, retry and note text propagation", async () => {
      const card = app.locator('[data-sticker-note="sticker-source"]'); await card.locator('[data-sticker-action="quick-edit"]').click();
      await form().locator("[data-sticker-text]").fill("Изменено из библиотеки"); await page.evaluate(() => { window.__stickerRefuse = true; });
      await form().locator('[type="submit"]').click(); await app.locator("[data-sticker-status].error").waitFor();
      assert.equal(await form().locator("[data-sticker-text]").innerText(), "Изменено из библиотеки"); assert.equal((await state()).fs["sticker-source"].content, "Исходный текст");
      await page.evaluate(() => { window.__stickerRefuse = false; }); await form().locator('[type="submit"]').click(); await form().waitFor({ state: "detached" });
      assert.equal((await state()).fs["sticker-source"].content, "Изменено из библиотеки");
    });
    await check("search, empty reset, favorite and source note from card menu", async () => {
      await app.locator('[data-sticker-search]').fill('Не существующий текст');
      assert.equal(await app.locator('[data-sticker-note]').count(),0);
      await action('clear').click(); assert.equal(await app.locator('[data-sticker-note]').count(),2);
      const card=app.locator('[data-sticker-note="sticker-source"]');
      await card.locator('[data-sticker-action="favorite"]').click();
      await action('favorites').click(); assert.equal(await app.locator('[data-sticker-note]').count(),2);
      await action('all').click(); await revealMenu(card); await card.locator('[data-sticker-action="note"]').click();
      const editor=page.locator('.window[data-app-id="editor"]').last();await editor.waitFor();
      assert.equal(await editor.locator('.editor-title').inputValue(),'Стикер из заметки');
      assert.equal(await editor.locator('.rich-editor-area').innerText(),'Изменено из библиотеки');
      await editor.locator('[data-win="close"]').click();
      await app.locator('[data-sticker-sort]').selectOption('name');
      assert.deepEqual(await app.locator('[data-sticker-note] h3').allTextContents(),['Новая идея','Стикер из заметки']);
      await app.locator('[data-sticker-sort]').selectOption('updated');
    });
    await check("pin, close desktop only, library retention", async () => {
      const card = app.locator('[data-sticker-note="sticker-source"]'); await card.locator('[data-sticker-action="desktop"]').click();
      const sticky = page.locator('.desktop-sticky[data-note-id="sticker-source"]'); await sticky.waitFor();
      await win.locator('[data-win="min"]').click();
      await page.locator('.window[data-app-id="appcenter"] [data-win="min"]').click();
      await sticky.locator("[data-sticky-settings]").click();
      await sticky.locator("[data-sticky-library]").click(); await sticky.waitFor({ state: "detached" });
      assert.equal(await app.locator('[data-sticker-note="sticker-source"]').count(), 1);
      assert.equal(await app.isVisible(), true);
    });
    await check("dirty new window rejects close and desktop switch", async () => {
      await action("new").first().click(); await form().locator('[name="title"]').fill("Несохранённый черновик");
      await app.locator('[aria-label="Закрыть создание стикера"]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
      assert.equal(await form().locator('[name="title"]').inputValue(), "Несохранённый черновик");
      const switching = page.evaluate(() => window.__stickerSwitch("sticker-other"));
      await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click();
      assert.equal(await switching, false);
      assert.equal(await form().locator('[name="title"]').inputValue(), "Несохранённый черновик");
      await action("cancel").click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click(); await form().waitFor({ state: "detached" });
    });
    await check("pointer drag from library onto actual ZeTer desktop", async () => {
      await win.evaluate(el => Object.assign(el.style, { width: "880px", left: "580px" }));
      const card = app.locator("[data-sticker-note]").filter({ hasText: "Новая идея" });
      const handle = await card.locator("[data-sticker-drag]").boundingBox(); assert.ok(handle);
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
      await page.mouse.move(430, 590, { steps: 10 }); await page.mouse.up();
      await card.locator('[data-sticker-action="desktop"][aria-pressed="true"]').waitFor();
      const s = await state(), note = Object.values(s.fs).find(item => item.name === "Новая идея");
      assert.equal(s.desktops[0].data.noteStickies.find(item => item.noteId === note.id).desktop, true);
      await page.locator(`.desktop-sticky[data-note-id="${note.id}"]`).waitFor();
      await win.evaluate(el => Object.assign(el.style, { width: "1420px", left: "20px" }));
    });
    await check("cancel, refuse, retry sticker deletion keeps source note and neighbor", async () => {
      const card = app.locator('[data-sticker-note="sticker-source"]');
      await revealMenu(card); await card.locator('.sticker-library-card-menu summary').focus(); await page.keyboard.press('Escape');
      assert.equal(await card.locator('.sticker-library-card-menu').evaluate(el=>el.open), false);
      await revealMenu(card); await card.locator('[data-sticker-action="remove"]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-cancel]').click(); assert.equal(await card.count(), 1);
      await revealMenu(card); await page.evaluate(() => { window.__stickerRefuse = true; }); await card.locator('[data-sticker-action="remove"]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click(); await app.locator("[data-sticker-status].error").waitFor(); assert.equal(await card.count(), 1);
      await revealMenu(card); await page.evaluate(() => { window.__stickerRefuse = false; }); await card.locator('[data-sticker-action="remove"]').click(); await page.locator('dialog.zeter-dialog[open]').locator('[data-dialog-submit]').click(); await card.waitFor({ state: "detached" });
      const s = await state(); assert.equal(s.fs["sticker-source"].content, "Изменено из библиотеки"); assert.equal(s.fs["sticker-neighbor"].content, "Текст другого стола");
    });
    await check("keyboard form cancel and current desktop reload", async () => {
      await action("new").first().focus(); await page.keyboard.press("Enter"); await form().waitFor(); assert.equal(await form().locator('[name="title"]').evaluate(el => el === document.activeElement), true);
      await action("cancel").focus(); await page.keyboard.press("Tab"); assert.equal(await app.locator('[aria-label="Закрыть создание стикера"]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Shift+Tab"); assert.equal(await action("cancel").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape"); await form().waitFor({ state: "detached" }); assert.equal(await action("new").first().evaluate(el => el === document.activeElement), true);
      await win.locator('[data-sticker-settings]').click(); await groupDialog().locator('[name="density"]').selectOption('compact');
      await groupDialog().locator('[type="submit"]').click();await groupDialog().waitFor({state:'detached'});
      await page.reload(); await page.locator("#boot").waitFor({ state: "hidden" });
      if (!await page.locator(".sticker-library-app").count()) await open();
      const s = await state(); assert.ok(s.fs["sticker-source"]); assert.equal(s.desktops[0].data.noteStickies.some(item => item.noteId === "sticker-source"), false);
      assert.equal(s.desktops[0].data.stickyLibrary.preferences.density,'compact');
      assert.match(s.desktops[0].data.stickyLibrary.projects[0].iconDataURL,/^data:image\/png;base64,/);
      const restored = page.locator('.window[data-app-id="stickers"]').last();
      if (await restored.evaluate(el => el.classList.contains("minimized"))) await page.locator('.taskbar-app[title="Стикеры"]').click();
    });
    await check("note context menu creates sticker discoverable immediately", async () => {
      const current = page.locator('.window[data-app-id="stickers"]').last(); await current.locator('[data-win="min"]').click();
      await page.locator('.desktop-icon[data-item-id="sticker-source"]').click({ button: "right" });
      await page.locator("#context-menu").getByRole("button", { name: /Сделать стикером на рабочем столе/ }).click();
      await page.locator('.taskbar-app[title="Стикеры"]').click();
      await page.locator('.sticker-library-app [data-sticker-note="sticker-source"]').waitFor();
      assert.equal((await state()).fs["sticker-source"].content, "Изменено из библиотеки");
    });
    await page.locator('[data-sticker-action="all"]').last().click();
    await page.locator('[data-sticker-action="project"]').last().click();
    for (const width of [1440, 760, 390, 320]) await check(`rendered layout ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('.window[data-app-id="stickers"]').last().evaluate((el, w) => Object.assign(el.style, { width: `${w - 16}px`, height: "900px", left: "8px", top: "45px" }), width);
      const current = page.locator(".sticker-library-app").last();
      assert.ok(await current.evaluate(el => el.scrollWidth <= el.clientWidth + 2), "no horizontal application overflow");
      const controls = current.locator('[data-sticker-category-controls]'); assert.equal(await controls.isVisible(), true);
      assert.ok(await controls.evaluate(el => el.scrollWidth <= el.clientWidth + 2), "category controls reflow without horizontal overflow");
      assert.equal(await current.locator('.sticker-library-title-row [data-sticker-action="project-settings"]').isVisible(), true);
      await controls.scrollIntoViewIfNeeded();
      await current.screenshot({ path: path.join(out, `stickers-${width}.png`) });
      if (width === 390 || width === 320) {
        await current.locator('[data-sticker-action="project-settings"]').click();
        assert.equal(await current.locator('[data-sticker-dialog] [name="entityName"]').inputValue(),'Проект стикеров');
        await page.keyboard.press('Escape'); await current.locator('[data-sticker-dialog]').waitFor({state:'detached'});
        assert.equal(await current.locator('[data-sticker-action="project-settings"]').evaluate(el=>el===document.activeElement),true);
        await current.locator('[data-sticker-action="add-category"]').click();
        const dialog = current.locator('[data-sticker-dialog]');
        assert.equal(await dialog.getAttribute("aria-label"), "Создать категорию в проекте");
        const rect = await dialog.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1);
        assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth+2));
        await page.screenshot({ path: path.join(out, `project-dialog-${width}.png`) });
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
        await current.locator('[data-sticker-action="new"]').first().click();
        const editor = current.locator('[data-sticker-new-dialog]'); const editorRect = await editor.boundingBox();
        assert.ok(editorRect.x >= 0 && editorRect.x + editorRect.width <= width + 1);
        assert.ok(await editor.evaluate(el => el.scrollWidth <= el.clientWidth + 2));
        await editor.locator('[data-sticker-action="cancel"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, `new-sticker-window-${width}.png`) });
        await editor.locator('[data-sticker-action="cancel"]').click(); await editor.waitFor({ state: "detached" });
        await showNavigation(current); assert.equal(await current.locator('[data-sticker-action="add-project"]').isVisible(), true);
        await current.locator('[data-sticker-action="favorites"]').click();
        assert.equal(await current.locator('[data-sticker-action="navigation"]').getAttribute('aria-expanded'), 'false');
        await showNavigation(current); await current.locator('[data-sticker-action="project"]').last().click();
        const card = current.locator('[data-sticker-note]').first(); await card.locator('[data-sticker-action="quick-edit"]').click();
        assert.ok(await current.evaluate(el=>el.scrollWidth<=el.clientWidth+2));
        await current.locator('[data-sticker-form] [data-sticker-action="cancel"]').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(out,`inline-edit-${width}.png`)});
        await current.locator('[data-sticker-form] [data-sticker-action="cancel"]').click();
        const appSettings=page.locator('.window[data-app-id="stickers"]').last().locator('[data-sticker-settings]');
        await appSettings.click();const preferences=current.locator('[data-sticker-dialog]');
        assert.equal(await preferences.getAttribute('aria-label'),'Настройки стикеров');
        assert.ok(await preferences.evaluate(el=>el.scrollWidth<=el.clientWidth+2));
        await preferences.locator('[data-sticker-dialog-cancel]').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(out,`app-settings-${width}.png`)});
        await preferences.locator('[data-sticker-dialog-cancel]').click();
      }
    });
    await check("new sticker window scrolls with reachable actions at 640px height", async () => {
      await page.setViewportSize({ width: 900, height: 640 });
      const current = page.locator(".sticker-library-app").last(); await current.locator('[data-sticker-action="new"]').first().click();
      const editor = current.locator('[data-sticker-new-dialog]'); const rect = await editor.boundingBox(); assert.ok(rect.y >= 0 && rect.y + rect.height <= 641);
      await editor.locator('[data-sticker-action="cancel"]').scrollIntoViewIfNeeded();
      const cancel = await editor.locator('[data-sticker-action="cancel"]').boundingBox(); assert.ok(cancel.y >= 0 && cancel.y + cancel.height <= 640);
      await page.screenshot({ path: path.join(out, "new-sticker-window-short.png") });
      await editor.locator('[data-sticker-action="cancel"]').click(); await editor.waitFor({ state: "detached" });
    });
    await check("all sixteen colors render in the dedicated sticky document with a fake native bridge", async () => {
      const childContext=await browser.newContext({viewport:{width:420,height:500},serviceWorkers:'block'});
      try{
        await childContext.addInitScript(()=>{window.pywebview={api:{get_snapshot:async()=>({ok:true,snapshot:{title:'Цветной стикер',richHtml:'<p>Проверка цвета и читаемого текста</p>',color:new URL(location.href).searchParams.get('color')}})}};});
        const child=await childContext.newPage();await child.route('**/*',route=>route.request().url().startsWith(preview.url)?route.continue():route.abort());
        const palette=await page.evaluate(()=>Object.keys(window.ZETER_STICKY_UTILS.STICKY_COLORS)), backgrounds=new Set();
        assert.equal(palette.length,16);
        for(const color of palette){
          await child.goto(preview.url+'sticky-window.html?color='+color);
          await child.waitForFunction(color=>document.documentElement.dataset.color===color,color);
          backgrounds.add(await child.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor));
          if(color==='orange'||color==='teal')await child.screenshot({path:path.join(out,`sticky-document-${color}.png`)});
        }
        assert.equal(backgrounds.size,16,'every color has its own CSS background');
      }finally{await childContext.close();}
    });
    assert.deepEqual(errors, []); fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    fs.writeFileSync(path.join(out, "synthetic-state.json"), JSON.stringify(await state()));
    return { checks, errors, out };
  } catch (error) { fs.writeFileSync(path.join(out, "failure.json"), JSON.stringify({ checks, errors, error: error.message }, null, 2)); if (page) await page.screenshot({path:path.join(out,"failure.png")}).catch(()=>{}); throw error; }
  finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runStickersSmoke };
