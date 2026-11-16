"use strict";
// Explicit browser acceptance: only public app/, synthetic state, isolated profile.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
async function runShoppingSmoke({ launchBrowser, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir;
  fs.mkdirSync(out, { recursive: true });
  const owners = ["app/js/core/shopping-utils.js", "app/js/core/shopping-ui-utils.js", "app/css/72-shopping.css", "app/js/app.js", "app/js/core/rich-text-utils.js", "app/js/core/shortcut-utils.js"];
  const hashes = () => Object.fromEntries(owners.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
  const before = hashes(), checks = [], errors = []; let browser, page, preview, failure;
  try {
    preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on("pageerror", error => errors.push(error.message));
    const seed = `const storage=window.ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...storage,createPrimaryStateSaveQueue:options=>{
      window.__shoppingState=options.getState;const queue=storage.createPrimaryStateSaveQueue(options);
      return {...queue,transaction:operation=>queue.transaction(write=>operation(async(snapshot,writeOptions)=>{
        if(window.__shoppingHold)await new Promise(resolve=>{window.__shoppingRelease=()=>{window.__shoppingHold=false;resolve();};});
        if(window.__shoppingRefuse)throw new Error('Тест: запись недоступна');
        return write(snapshot,writeOptions);
      }))};}};
      if(!localStorage.getItem('shopping-fixture')){const state=ZETER_INITIAL_STATE_UTILS.defaultState();state.firstRunCompleted=true;
        ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(state);state.desktops.push({id:'shopping-other',name:'Другой стол',data:ZETER_WORKSPACE_UTILS.workspaceDefaults()});
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(state));localStorage.setItem('shopping-fixture','1');}`;
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === "/js/app.js") {
        const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8"), anchor = '  function renderShoppingApp(params = {}, winId = "") {';
        assert.ok(source.includes(anchor));
        return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + source.replace(anchor, anchor + '\n    window.__shoppingOpen=(params={})=>openApp("shopping",params); window.__shoppingSwitch=switchVirtualDesktop;') });
      }
      return route.continue();
    });
    const check = async (name, run) => { await run(); checks.push({ name, status: "PASS" }); console.log(`shopping UI PASS: ${name}`); };
    const open = async () => {
      await page.locator('[data-top-action="appcenter"]').click();
      const install = page.locator('[data-install-app="shopping"]'); if (await install.count()) await install.click();
      await page.locator('[data-open-app="shopping"]').last().click(); await page.locator(".shopping-app").last().waitFor();
    };
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__shoppingState())));
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    let app = page.locator('.window[data-app-id="shopping"].active .shopping-app');
    const action = name => app.locator(`[data-shop-action="${name}"]`), dialog = () => app.locator("dialog");
    const projectAction = async name => { if (!await app.locator("[data-shop-project-menu]").isVisible()) await action("project-settings").click(); await action(name).click(); };
    const setFilter = value => app.locator(`[data-shop-filter="${value}"]`).click();
    const settings = () => app.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," window ")][1]').locator('[data-shop-settings]');
    const categoryAction = async name => { if(!await app.locator('[data-shop-category-menu]').isVisible()) await action('category-settings').click(); await action(name).click(); };
    const itemAction = async name => { const row=app.locator('[data-shop-row]').first(); if(!await row.locator('[data-shop-item-menu]').isVisible()) await row.locator('[data-shop-action="item-menu"]').click(); await row.locator(`[data-shop-action="${name}"]`).click(); };
    const save = async () => { await dialog().locator('[type="submit"]').click(); await dialog().waitFor({ state: "detached" }); };
    const addNamed = async (kind, name) => { if(kind.includes("category")) await categoryAction(kind); else await action(kind).click(); await dialog().locator('[name="name"]').fill(name); await save(); };
    const addItem = async (name, quantity = "", notes = "") => {
      await action("new-item").click();
      await dialog().locator('[name="name"]').fill(name);
      await dialog().locator('[name="quantity"]').fill(quantity);
      await dialog().locator('[name="notes"]').fill(notes);
      await save();
    };
    await check("catalog, project/category creation, item and confirmed persistence", async () => {
      assert.match(await page.locator('.window[data-app-id="shopping"].active').innerText(), /Покупки/);
      assert.equal(await app.getByRole("button",{name:"Создать список",exact:true}).count(),1);
      assert.equal(await app.locator(".shopping-header, [data-shop-workspace]").count(), 0);
      assert.equal(await app.locator("[data-shop-controls]").evaluate(el => el.firstElementChild.classList.contains("shopping-layout")), true);
      await addNamed("new-list", "Ремонт"); await addNamed("new-category", "Инструменты");
      const before=(await state()).desktops[0].data.shopping;
      await action("new-item").click();
      assert.equal(await dialog().getAttribute("aria-label"),"Добавить покупку");
      assert.equal(await dialog().locator('[name="notes"]').isVisible(),true);
      assert.equal(await dialog().locator('details,summary').count(),0);
      await dialog().locator('[name="name"]').fill("Молоток");
      await dialog().locator('[name="quantity"]').fill("1 шт");
      await dialog().locator('[name="notes"]').fill("Для дома\nДеревянная ручка");
      assert.equal(await dialog().locator('[name="categoryId"]').inputValue(),before.categories[0].id);
      await page.evaluate(()=>window.__shoppingRefuse=true);
      await dialog().locator('[type="submit"]').click();
      await dialog().locator('[data-shop-error]').filter({hasText:'запись недоступна'}).waitFor();
      assert.deepEqual((await state()).desktops[0].data.shopping,before);
      assert.equal(await dialog().locator('[name="name"]').inputValue(),"Молоток");
      assert.equal(await dialog().locator('[name="quantity"]').inputValue(),"1 шт");
      assert.equal(await dialog().locator('[name="notes"]').inputValue(),"Для дома\nДеревянная ручка");
      await page.evaluate(()=>{window.__shoppingRefuse=false;window.__shoppingHold=true;});
      await dialog().locator('[type="submit"]').click();
      await page.waitForFunction(()=>typeof window.__shoppingRelease==='function');
      assert.equal(await dialog().locator('[type="submit"]').isDisabled(),true);
      await page.keyboard.press('Escape'); assert.equal(await dialog().count(),1);
      await page.evaluate(()=>window.__shoppingRelease());await dialog().waitFor({state:'detached'});
      assert.equal(await action("new-item").evaluate(el=>el===document.activeElement),true);
      const data = (await state()).desktops[0].data.shopping;
      assert.equal(data.projects[0].name, "Ремонт"); assert.equal(data.categories[0].name, "Инструменты");
      assert.equal(data.items[0].categoryId, data.categories[0].id); assert.equal(data.items[0].quantity, "1 шт");
    });
    await check("add purchase only opens on request, visible description, validation, keyboard and cancel",async()=>{
      assert.equal(await app.locator('[data-shop-quick],.shopping-quick,.shopping-description,.shopping-eyebrow,.shopping-progress-summary,.shopping-progress-track,[data-shop-progressbar]').count(),0);
      assert.equal(await dialog().count(),0);
      const before=(await state()).desktops[0].data.shopping;
      await action('new-item').focus();await page.keyboard.press('Enter');
      assert.equal(await dialog().locator('[name="name"]').evaluate(el=>el===document.activeElement),true);
      assert.equal(await dialog().locator('[name="notes"]').isVisible(),true);
      assert.equal(await dialog().locator('[type="submit"]').textContent(),'Добавить покупку');
      const placement=await dialog().evaluate(el=>{const button=el.querySelector('[type="submit"]').getBoundingClientRect(),description=el.querySelector('[name="notes"]').getBoundingClientRect();return {below:button.top>=description.bottom,left:Math.abs(button.left-description.left)};});
      assert.equal(placement.below,true);assert.ok(placement.left<=2,JSON.stringify(placement));
      await dialog().locator('[type="submit"]').click();
      assert.equal(await dialog().locator('[name="name"]').evaluate(el=>el.validity.valueMissing),true);
      assert.deepEqual((await state()).desktops[0].data.shopping,before);
      await dialog().locator('[name="name"]').fill('Черновик без сохранения');
      await dialog().locator('[name="notes"]').fill('Первая строка');
      await page.keyboard.press('Enter');await page.keyboard.type('Вторая строка');
      assert.equal(await dialog().locator('[name="notes"]').inputValue(),'Первая строка\nВторая строка');
      assert.deepEqual((await state()).desktops[0].data.shopping,before);
      await dialog().locator('[name="name"]').focus();await page.keyboard.press('Shift+Tab');
      assert.equal(await dialog().locator('[data-shop-cancel]').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Tab');
      assert.equal(await dialog().locator('[name="name"]').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
      assert.equal(await action('new-item').evaluate(el=>el===document.activeElement),true);
      assert.deepEqual((await state()).desktops[0].data.shopping,before);
      const positions=await app.evaluate(el=>{
        const title=el.querySelector('[data-shop-title]').getBoundingClientRect(),menu=el.querySelector('[data-shop-action="project-settings"]').getBoundingClientRect(),add=el.querySelector('[data-shop-action="new-item"]').getBoundingClientRect();
        return {gap:menu.left-title.right,opposite:add.left>menu.right,sameRow:Math.abs(add.top-menu.top)<8};
      });
      assert.ok(positions.gap>=0&&positions.gap<=18,JSON.stringify(positions));
      assert.equal(positions.opposite,true);assert.equal(positions.sameRow,true);
    });
    await check("category gear create/rename/delete, Escape/outside close and description", async () => {
      assert.equal(await app.locator('.shopping-section-title + [data-shop-action="new-list"] + nav').count(),1);
      assert.equal(await app.locator('.shopping-categories > label + .shopping-category-tools [data-shop-action="category-settings"]').count(),1);
      assert.equal(await action('new-category').isVisible(),false);
      await action('category-settings').focus(); await page.keyboard.press('Enter');
      assert.equal(await app.locator('[data-shop-category-menu]').isVisible(),true);
      assert.equal(await action('new-category').textContent(),'Создать категорию');
      assert.equal(await action('rename-category').textContent(),'Переименовать категорию');
      assert.equal(await action('delete-category').textContent(),'Удалить категорию');
      assert.equal(await action('new-category').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Tab'); assert.equal(await action('rename-category').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Escape');
      assert.equal(await app.locator('[data-shop-category-menu]').isVisible(),false);
      assert.equal(await action('category-settings').evaluate(el=>el===document.activeElement),true);
      await action('category-settings').click(); await app.locator('[data-shop-search]').click();
      assert.equal(await app.locator('[data-shop-category-menu]').isVisible(),false);
      assert.equal(await settings().count(),1); assert.equal(await app.locator('[data-shop-settings]').count(),0);
      assert.equal(await settings().getAttribute('aria-label'),"Настройки приложения Покупки");
      const data=(await state()).desktops[0].data.shopping;
      assert.equal(data.items[0].notes,"Для дома\nДеревянная ручка");
      assert.equal(await app.locator('.shopping-item-description').textContent(),data.items[0].notes);
      assert.equal(await app.locator('.shopping-group-heading h4').textContent(),"Инструменты");
      await app.locator('[data-shop-search]').fill('деревянная'); assert.equal(await app.locator('[data-shop-row]').count(),1);
      await app.locator('[data-shop-search]').fill('');
    });
    await check("idle disabled buttons have no loading cursor", async () => {
      const category = await app.locator('[data-shop-category]').inputValue();
      await app.locator('[data-shop-category]').selectOption({label:"Все категории"});
      assert.notEqual(await app.getAttribute("aria-busy"), "true");
      assert.equal(await app.locator('[data-shop-controls]').evaluate(el => el.disabled), false);
      for (const name of ["rename-category", "delete-category", "clear-bought"]) {
        if (name === "clear-bought") await action("project-settings").click(); else await action("category-settings").click();
        assert.equal(await action(name).isDisabled(), true);
        await action(name).hover();
        const cursor = await action(name).evaluate(el => getComputedStyle(el).cursor);
        console.log(`idle disabled ${name}: cursor=${cursor}`);
        assert.equal(cursor, "default", `false loading cursor over ${name}`);
        await page.keyboard.press("Escape");
      }
      await app.locator('[data-shop-category]').selectOption(category);
    });
    await check("project gear location, menu keyboard and outside close", async () => {
      assert.equal(await app.locator('.shopping-title-row [data-shop-action="project-settings"]').count(), 1);
      assert.equal(await action("rename-list").isVisible(), false);
      assert.equal(await action("delete-list").isVisible(), false);
      assert.equal(await action("clear-bought").isVisible(), false);
      await action("project-settings").focus(); await page.keyboard.press("Enter");
      assert.equal(await app.locator("[data-shop-project-menu]").isVisible(), true);
      assert.equal(await action("rename-list").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await app.locator("[data-shop-project-menu]").isVisible(), false);
      assert.equal(await action("project-settings").evaluate(el => el === document.activeElement), true);
      await action("project-settings").click(); await app.locator('[data-shop-search]').click();
      assert.equal(await app.locator("[data-shop-project-menu]").isVisible(), false);
    });
    await check("description web links escape HTML, open externally, refuse/retry and preserve state", async () => {
      const notes='Сайт https://example.test/item?x=1&y=2.\nКаталог www.example.test/catalog и http://example.test/help\n<img src=x onerror="window.__shoppingUnsafe=1"> javascript:alert(1) data:text/html,test file:///C:/test.txt';
      await itemAction('edit-item');await dialog().locator('[name="notes"]').fill(notes);await save();
      const description=app.locator('.shopping-item-description'), links=description.locator('a');
      assert.equal(await description.textContent(),notes);
      assert.equal(await description.locator('img,script,iframe').count(),0);
      assert.deepEqual(await links.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href'))),['https://example.test/item?x=1&y=2','https://www.example.test/catalog','http://example.test/help']);
      for(const link of await links.all()) { assert.equal(await link.getAttribute('target'),'_blank');assert.equal(await link.getAttribute('rel'),'noopener noreferrer'); }
      const baseline=(await state()).desktops[0].data.shopping;
      const url=page.url();
      await page.evaluate(()=>{
        window.__shoppingLinkCalls=[];window.__shoppingLinkRefuse=true;window.__shoppingOriginalWindowOpen=window.open;
        window.open=(target,frame,features)=>{window.__shoppingLinkCalls.push({target,frame,features});if(window.__shoppingLinkRefuse)throw new Error('Тест: открытие недоступно');return null;};
      });
      await links.first().click();await app.locator('[data-shop-status]').filter({hasText:'Тест: открытие недоступно'}).waitFor();
      await page.evaluate(()=>window.__shoppingLinkRefuse=false);
      await links.first().focus();await page.keyboard.press('Enter');
      await links.nth(1).click({modifiers:['Control']});
      await links.nth(2).click({button:'middle'});
      const calls=await page.evaluate(()=>window.__shoppingLinkCalls);
      assert.equal(calls.length,4);
      assert.deepEqual(calls.map(c=>c.target),['https://example.test/item?x=1&y=2','https://example.test/item?x=1&y=2','https://www.example.test/catalog','http://example.test/help']);
      assert.ok(calls.every(c=>c.frame==='_blank'&&c.features==='noopener,noreferrer'));
      assert.equal(await app.locator('[data-shop-status]').isVisible(),false,'A null noopener return is not an opening failure');
      await links.first().evaluate(el=>el.setAttribute('href','javascript:alert(1)'));
      await links.first().click();
      assert.equal(await page.evaluate(()=>window.__shoppingLinkCalls.length),4);
      await links.first().evaluate(el=>el.setAttribute('href','https://example.test/item?x=1&y=2'));
      assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>window.__shoppingUnsafe),undefined);
      assert.deepEqual((await state()).desktops[0].data.shopping,baseline);
      await page.evaluate(()=>window.__shoppingHold=true);await action('bought').click();
      await page.waitForFunction(()=>typeof window.__shoppingRelease==='function');
      const prevented=await links.first().evaluate(el=>!el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
      assert.equal(prevented,true);assert.equal(await page.evaluate(()=>window.__shoppingLinkCalls.length),4);
      await page.evaluate(()=>window.__shoppingRelease());
      await page.waitForFunction(()=>!document.querySelector('.shopping-app [data-shop-controls]').disabled);
      await setFilter('all');await action('bought').click();
      await page.waitForFunction(()=>!document.querySelector('.shopping-app [data-shop-controls]').disabled);await setFilter('needed');
      assert.deepEqual((await state()).desktops[0].data.shopping.items.map(i=>({name:i.name,notes:i.notes,bought:i.bought})),baseline.items.map(i=>({name:i.name,notes:i.notes,bought:i.bought})));
      await page.evaluate(()=>{window.open=window.__shoppingOriginalWindowOpen;delete window.__shoppingOriginalWindowOpen;});
    });
    await check("edit modal keyboard, notes and safe text rendering", async () => {
      await itemAction("edit-item");
      assert.equal(await dialog().locator('[name="name"]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Shift+Tab"); assert.equal(await dialog().locator('[type="submit"]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab"); assert.equal(await dialog().locator('[name="name"]').evaluate(el => el === document.activeElement), true);
      await dialog().locator('[name="notes"]').fill('<img src=x onerror="bad()">'); await save();
      assert.equal(await app.locator('.shopping-item img').count(), 0); assert.match(await app.innerText(), /<img src=x/);
      assert.equal(await action("item-menu").evaluate(el => el === document.activeElement), true);
    });
    await check("failure preserves draft, explicit retry, pending ACK blocks Escape", async () => {
      await categoryAction("new-category"); await dialog().locator('[name="name"]').fill("Материалы");
      await page.evaluate(() => { window.__shoppingRefuse = true; }); await dialog().locator('[type="submit"]').click();
      await dialog().locator('[data-shop-error]').filter({ hasText: "запись недоступна" }).waitFor();
      assert.equal(await dialog().locator('[name="name"]').inputValue(), "Материалы");
      assert.equal((await state()).desktops[0].data.shopping.categories.length, 1);
      await page.evaluate(() => { window.__shoppingRefuse = false; window.__shoppingHold = true; });
      await dialog().locator('[type="submit"]').click();
      await page.waitForFunction(() => typeof window.__shoppingRelease === "function");
      assert.equal(await dialog().locator('[name="name"]').evaluate(el => getComputedStyle(el).cursor), "wait");
      await page.keyboard.press("Escape"); assert.equal(await dialog().count(), 1);
      await page.evaluate(() => window.__shoppingRelease()); await dialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.shopping.categories.length, 2);
    });
    await check("category filter, bought filter, search and cancellation", async () => {
      await addItem("Краска", "2 банки");
      assert.equal(await app.locator('[data-shop-row]').count(), 1);
      await app.locator('[data-shop-category]').selectOption({label:"Все категории"}); assert.equal(await app.locator('[data-shop-row]').count(), 2);
      await app.locator('[data-shop-search]').fill("Краска"); assert.equal(await app.locator('[data-shop-row]').count(), 1);
      await action("bought").click(); await page.waitForFunction(() => window.__shoppingState().desktops[0].data.shopping.items.find(row => row.name === "Краска")?.bought === true); await app.locator('[data-shop-row]').waitFor({ state: "detached" });
      await setFilter("bought"); assert.equal(await app.locator('[data-shop-row]').count(), 1);
      await itemAction("delete-item"); await page.locator('[data-dialog-cancel]').click();
      assert.equal((await state()).desktops[0].data.shopping.items.length, 2);
      await app.locator('[data-shop-search]').fill(""); await setFilter("all");
    });
    await check("category deletion preserves goods and project isolation", async () => {
      const data = (await state()).desktops[0].data.shopping;
      const materials = data.categories.find(row => row.name === "Материалы");
      await app.locator('[data-shop-category]').selectOption(materials.id); await categoryAction("delete-category"); await page.locator('[data-dialog-submit]').click();
      await page.waitForFunction(() => window.__shoppingState().desktops[0].data.shopping.categories.length === 1);
      assert.equal((await state()).desktops[0].data.shopping.items.find(row => row.name === "Краска").categoryId, "");
      assert.equal(await action("category-settings").evaluate(el => el === document.activeElement), true);
      await addNamed("new-list", "Продукты"); await addNamed("new-category", "Молочное"); await addItem("Молоко", "1 л");
      assert.equal(await app.locator('[data-shop-row]').count(), 1);
      await app.locator('[data-shop-list]').filter({ hasText: "Ремонт" }).click();
      await setFilter("all"); assert.equal(await app.locator('[data-shop-row]').count(), 2);
    });
    await check("project/category rename, accurate empty category and confirmed project deletion", async () => {
      await projectAction("rename-list"); await dialog().locator('[name="name"]').fill("Ремонт дома"); await save();
      await addNamed("new-category", "Пустая категория");
      await setFilter("needed");
      assert.match(await app.locator('.shopping-empty').innerText(), /В этой категории пока нет товаров/);
      assert.doesNotMatch(await app.locator('.shopping-empty').innerText(), /Всё куплено/);
      await categoryAction("rename-category"); await dialog().locator('[name="name"]').fill("Запасное"); await save();
      assert.equal((await state()).desktops[0].data.shopping.categories.some(row => row.name === "Запасное"), true);
      await action("new-list").click(); await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
      assert.equal(await action("new-list").evaluate(el => el === document.activeElement), true);
      await app.locator('[data-shop-list]').filter({ hasText: "Продукты" }).click();
      await action("bought").click(); await page.waitForFunction(() => window.__shoppingState().desktops[0].data.shopping.items.find(row => row.name === "Молоко")?.bought === true);
      await app.locator('.shopping-empty').filter({ hasText: "Всё куплено!" }).waitFor();
      await projectAction("delete-list"); await page.locator('[data-dialog-cancel]').click();
      assert.equal((await state()).desktops[0].data.shopping.projects.length, 2);
      await projectAction("delete-list"); await page.locator('[data-dialog-submit]').click();
      await page.waitForFunction(() => window.__shoppingState().desktops[0].data.shopping.projects.length === 1);
      const data = (await state()).desktops[0].data.shopping;
      assert.equal(data.items.some(row => row.name === "Молоко"), false);
      assert.equal(data.items.some(row => row.name === "Молоток"), true);
      assert.equal(data.categories.some(row => row.name === "Молочное"), false);
    });
    await check("app settings keyboard, refusal preserves draft, explicit retry", async () => {
      const before=(await state()).desktops[0].data.shopping.preferences;
      await settings().focus(); await page.keyboard.press('Enter');
      assert.equal(await dialog().locator('[name="density"]').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await dialog().locator('[type="submit"]').evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Escape'); await dialog().waitFor({state:'detached'});
      assert.equal(await settings().evaluate(el=>el===document.activeElement),true);
      await settings().click(); await dialog().locator('[name="density"]').selectOption('compact');
      await dialog().locator('[name="groupByCategory"]').uncheck(); await dialog().locator('[name="showDescriptions"]').uncheck();
      await page.evaluate(()=>window.__shoppingRefuse=true); await dialog().locator('[type="submit"]').click();
      await dialog().locator('[data-shop-error]').filter({hasText:'запись недоступна'}).waitFor();
      assert.deepEqual((await state()).desktops[0].data.shopping.preferences,before);
      assert.equal(await dialog().locator('[name="density"]').inputValue(),'compact');
      assert.equal(await dialog().locator('[name="showDescriptions"]').isChecked(),false);
      await page.evaluate(()=>window.__shoppingRefuse=false); await save();
      assert.equal(await app.getAttribute('data-shopping-density'),'compact');
      assert.equal(await app.locator('.shopping-group-heading').count(),0);
      assert.equal(await app.evaluate(el=>el.classList.contains('shopping-hide-descriptions')),true);
      await settings().click(); await dialog().locator('[name="density"]').selectOption('normal');
      await dialog().locator('[name="groupByCategory"]').check(); await dialog().locator('[name="showDescriptions"]').check(); await save();
    });
    await check("two windows share confirmed data and another desktop stays empty", async () => {
      await page.evaluate(() => window.__shoppingOpen({projectId:window.__shoppingState().desktops[0].data.shopping.projects[0].id})); app = page.locator('.window[data-app-id="shopping"].active .shopping-app');
      assert.equal(await page.locator(".shopping-app").count(),2,"A distinct project parameter opens a second window");
      await addNamed("new-list", "Дача");
      assert.equal(await page.locator('.shopping-app').first().locator('[data-shop-list]').count(), 2);
      await settings().click(); await dialog().locator('[name="density"]').selectOption('compact'); await save();
      assert.equal(await page.locator('.shopping-app[data-shopping-density="compact"]').count(),2);
      const before = JSON.stringify((await state()).desktops[0].data.shopping);
      await page.evaluate(() => window.__shoppingSwitch("shopping-other")); await page.evaluate(() => window.__shoppingOpen());
      app = page.locator('.window[data-app-id="shopping"].active .shopping-app'); assert.equal(await app.locator('[data-shop-list]').count(), 0);
      await addNamed("new-list", "Другой проект"); assert.equal(JSON.stringify((await state()).desktops[0].data.shopping), before);
      await page.evaluate(() => window.__shoppingSwitch("desktop"));
    });
    await check("pending save preserves second-window typing on success and refusal", async () => {
      const windows=page.locator('.window[data-app-id="shopping"][data-desktop-id="desktop"]');
      assert.equal(await windows.count(),2);
      const styles=await windows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('style')));
      await windows.evaluateAll(nodes=>nodes.forEach((el,index)=>Object.assign(el.style,{left:(10+index*710)+'px',top:'100px',width:'700px',height:'780px',transform:'none'})));
      const a=windows.nth(0).locator('.shopping-app'),b=windows.nth(1).locator('.shopping-app');
      try {
        for(const panel of [a,b]) {
          await panel.locator('[data-shop-list]').filter({hasText:'Ремонт дома'}).click();
          await panel.locator('[data-shop-filter="all"]').click();
          await panel.locator('[data-shop-search]').fill('');
        }
        for(const refuse of [false,true]) {
          const before=(await state()).desktops[0].data.shopping;
          await page.evaluate(()=>{window.__shoppingHold=true;window.__shoppingRefuse=false;window.__shoppingRelease=null;});
          await a.locator('[data-shop-action="bought"]').first().click();
          await page.waitForFunction(()=>typeof window.__shoppingRelease==='function');
          const searchB=b.locator('[data-shop-search]');await searchB.fill('Мол');
          assert.equal(await searchB.evaluate(el=>el===document.activeElement),true);
          await page.evaluate(refuse=>{window.__shoppingRefuse=refuse;window.__shoppingRelease();},refuse);
          await page.waitForFunction(()=>[...document.querySelectorAll('.shopping-app')].every(el=>el.getAttribute('aria-busy')!=='true'));
          assert.equal(await searchB.evaluate(el=>el===document.activeElement),true);
          await page.keyboard.type('оток');assert.equal(await searchB.inputValue(),'Молоток');
          if(refuse)assert.deepEqual((await state()).desktops[0].data.shopping,before);
          else assert.notDeepEqual((await state()).desktops[0].data.shopping,before);
          await searchB.fill('');
        }
      } finally {
        await page.evaluate(()=>{window.__shoppingRefuse=false;window.__shoppingHold=false;});
        await windows.evaluateAll((nodes,styles)=>nodes.forEach((node,index)=>{if(styles[index]===null)node.removeAttribute('style');else node.setAttribute('style',styles[index]);}),styles);
      }
    });
    await check("durable reload preserves projects, categories and goods", async () => {
      const before = (await state()).desktops[0].data.shopping;
      await page.reload(); await page.locator("#boot").waitFor({ state: "hidden" }); await open(); app = page.locator('.window[data-app-id="shopping"].active .shopping-app');
      assert.deepEqual((await state()).desktops[0].data.shopping, before);
    });
    await check("desktop and narrow layouts, long names, keyboard cancel", async () => {
      await addNamed("new-list", "Очень длинное название проекта покупок для проверки переноса текста и доступности кнопок");
      await addNamed("new-category", "Категория с длинным названием для проверки узкого экрана");
      await addItem("Товар с очень длинным названием для проверки правильного переноса на маленьком экране", "Несколько упаковок");
      const win = page.locator('.window[data-app-id="shopping"].active');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 950 });
        if (width === 1440) await win.evaluate(el => Object.assign(el.style, { width: "1160px", height: "820px", left: "40px", top: "45px" }));
        const overflow = await app.evaluate(el => [...el.querySelectorAll('.shopping-main,.shopping-layout,.shopping-list-heading,.shopping-filters')].some(node => node.scrollWidth > node.clientWidth + 2));
        assert.equal(overflow, false, `horizontal overflow at ${width}`);
        const topGap = await app.evaluate(el => el.querySelector(".shopping-layout").getBoundingClientRect().top - el.getBoundingClientRect().top);
        assert.ok(topGap >= 0 && topGap <= 20, `unused header gap at ${width}: ${topGap}`);
        await action("category-settings").click();
        const categoryMenuInside = await app.locator('[data-shop-category-menu]').evaluate(el=>{const r=el.getBoundingClientRect(),a=el.closest('.shopping-app').getBoundingClientRect();return r.left>=a.left-1&&r.right<=a.right+1;});
        assert.equal(categoryMenuInside,true,`category menu overflow at ${width}`);
        await page.keyboard.press('Escape');
        await action("project-settings").click();
        assert.equal(await action("rename-list").isVisible(), true);
        const menuInside = await app.locator('[data-shop-project-menu]').evaluate(el => { const r=el.getBoundingClientRect(), a=el.closest('.shopping-app').getBoundingClientRect(); return r.left >= a.left && r.right <= a.right + 1; });
        assert.equal(menuInside, true, `project menu overflow at ${width}`);
        await page.keyboard.press("Escape");
        await action("new-item").click();
        assert.equal(await dialog().locator('[name="notes"]').isVisible(),true);
        const geometry=await dialog().evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,rect:el.getBoundingClientRect().toJSON(),viewport:window.innerWidth}));
        assert.ok(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));
        assert.ok(geometry.rect.left>=0&&geometry.rect.right<=geometry.viewport,JSON.stringify(geometry));
        await dialog().screenshot({path:path.join(out,`shopping-add-${width}.png`)});
        await page.keyboard.press('Escape');await dialog().waitFor({state:'detached'});
        const editedId=await app.locator('[data-shop-row]').first().getAttribute('data-shop-row');
        await itemAction("edit-item"); await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
        const menuButton=app.locator(`[data-shop-row="${editedId}"] [data-shop-action="item-menu"]`);
        assert.equal(await menuButton.evaluate(el=>el===document.activeElement),true);
        await itemAction("edit-item");await dialog().locator('[data-shop-cancel]').click();await dialog().waitFor({state:'detached'});
        assert.equal(await menuButton.evaluate(el=>el===document.activeElement),true);
        await app.locator(".shopping-layout").evaluate(el => { el.scrollTop = 0; });
        await app.locator(".shopping-sidebar").evaluate(el => { el.scrollTop = 0; });
        assert.equal(await action("new-list").isVisible(), true);
        assert.equal(await app.getByRole("button",{name:"Создать список",exact:true}).count(),1);
        await page.screenshot({ path: path.join(out, `shopping-${width}.png`), fullPage: true });
      }
    });
    await check("imported category named by ID all stays distinct from the all-category filter",async()=>{
      await page.setViewportSize({width:1440,height:1000});
      await page.locator('.window[data-app-id="shopping"].active').evaluate(el=>Object.assign(el.style,{width:'1160px',height:'820px',left:'40px',top:'45px'}));
      await page.evaluate(()=>{
        const fixture=JSON.parse(JSON.stringify(window.__shoppingState())),shopping=fixture.desktops[0].data.shopping;
        const projectId=shopping.projects.at(-1).id,stamp=Date.now();
        shopping.categories.push({id:'all',projectId,name:'Импортированная',createdAt:stamp,updatedAt:stamp});
        shopping.items.push({id:'imported_all_item',projectId,categoryId:'all',name:'Импортированный товар',quantity:'',notes:'',bought:false,createdAt:stamp,updatedAt:stamp});
        ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport(fixture);
        window.__shoppingState().desktops[0].data.shopping=shopping;
        document.querySelectorAll('.shopping-app').forEach(el=>el.refreshShopping());
      });
      const categories=app.locator('[data-shop-category]');
      assert.equal(await categories.evaluate(el=>new Set([...el.options].map(row=>row.value)).size===el.options.length),true);
      await categories.selectOption({label:'Импортированная'});
      assert.equal(await app.locator('[data-shop-row]').count(),1);
      assert.equal(await app.locator('[data-shop-row] strong').textContent(),'Импортированный товар');
      await action('new-item').click();assert.equal(await dialog().locator('[name="categoryId"]').inputValue(),'all');
      await dialog().locator('[name="name"]').fill('Новый товар импортированной категории');await save();
      assert.equal((await state()).desktops[0].data.shopping.items.find(row=>row.name==='Новый товар импортированной категории').categoryId,'all');
      await categories.selectOption({label:'Все категории'});assert.equal(await app.locator('[data-shop-row]').count(),3);
      assert.equal(await action('rename-category').isDisabled(),true);assert.equal(await action('delete-category').isDisabled(),true);
    });
    await check("repeated Escape during save preserves every shopping dialog and refusal retry", async () => {
      for (const kind of ["item", "category", "list", "settings"]) {
        for (const refuse of [false, true]) {
          const before = (await state()).desktops[0].data.shopping;
          const name = `Escape ${kind} ${refuse ? "refusal" : "success"}`;
          if (kind === "settings") await settings().click();
          else if (kind === "category") await categoryAction("new-category");
          else await action(kind === "item" ? "new-item" : "new-list").click();
          let density;
          if (kind === "settings") {
            density = before.preferences.density === "normal" ? "compact" : "normal";
            await dialog().locator('[name="density"]').selectOption(density);
          } else {
            await dialog().locator('[name="name"]').fill(name);
            if (kind === "item") {
              await dialog().locator('[name="quantity"]').fill("3 шт");
              await dialog().locator('[name="notes"]').fill("Черновик\nпосле отказа");
            }
          }
          await page.evaluate(refuse => { window.__shoppingHold = true; window.__shoppingRefuse = refuse; delete window.__shoppingRelease; }, refuse);
          await dialog().locator('[type="submit"]').click();
          await page.waitForFunction(() => typeof window.__shoppingRelease === "function");
          // Check the open/modal state, not merely the existence of the hidden DOM node.
          for (let press = 0; press < 6; press++) {
            await page.keyboard.press("Escape");
            assert.equal(await dialog().evaluate(el => el.open && el.matches(":modal")), true, `${name}: Escape ${press + 1}`);
          }
          assert.deepEqual((await state()).desktops[0].data.shopping, before);
          await page.evaluate(() => window.__shoppingRelease());
          if (refuse) {
            await dialog().locator('[data-shop-error]').filter({hasText:"запись недоступна"}).waitFor();
            assert.equal(await dialog().evaluate(el => el.open && el.matches(":modal")), true);
            assert.deepEqual((await state()).desktops[0].data.shopping, before);
            if (kind === "settings") assert.equal(await dialog().locator('[name="density"]').inputValue(), density);
            else assert.equal(await dialog().locator('[name="name"]').inputValue(), name);
            if (kind === "item") {
              assert.equal(await dialog().locator('[name="quantity"]').inputValue(), "3 шт");
              assert.equal(await dialog().locator('[name="notes"]').inputValue(), "Черновик\nпосле отказа");
            }
            await page.evaluate(() => { window.__shoppingRefuse = false; });
            await save();
          } else await dialog().waitFor({state:"detached"});
          const after = (await state()).desktops[0].data.shopping;
          if (kind === "settings") assert.equal(after.preferences.density, density);
          else {
            const key = {item:"items",category:"categories",list:"projects"}[kind];
            assert.equal(after[key].length, before[key].length + 1);
            assert.equal(after[key].filter(row => row.name === name).length, 1);
          }
          await action("new-item").click();
          assert.equal(await dialog().evaluate(el => el.open), true, "The next form remains usable");
          await page.keyboard.press("Escape"); await dialog().waitFor({state:"detached"});
        }
      }
    });
    await check("native close fallback keeps pending draft visible and cleans idle dialogs", async () => {
      for (const kind of ["item", "settings"]) {
        if (kind === "settings") await settings().click(); else await action("new-item").click();
        if (kind === "item") await dialog().locator('[name="name"]').fill("Fallback draft");
        await page.evaluate(() => { window.__shoppingHold = true; window.__shoppingRefuse = true; delete window.__shoppingRelease; });
        await dialog().locator('[type="submit"]').click();
        await page.waitForFunction(() => typeof window.__shoppingRelease === "function");
        await dialog().evaluate(el => { el.removeAttribute("closedby"); el.close(); });
        await page.waitForFunction(() => document.querySelector(".shopping-app dialog")?.matches(":modal"));
        for (let press = 0; press < 6; press++) {
          await page.keyboard.press("Escape");
          await page.waitForFunction(() => document.querySelector(".shopping-app dialog")?.matches(":modal"));
        }
        // Settle the write in the same task as native close; close events are queued.
        await dialog().evaluate(el => { el.close(); window.__shoppingRelease(); });
        await dialog().locator('[data-shop-error]').filter({hasText:"запись недоступна"}).waitFor();
        if (kind === "item") assert.equal(await dialog().locator('[name="name"]').inputValue(), "Fallback draft");
        // A native close outside a transaction must also release the modal owner.
        await dialog().evaluate(el => el.close()); await dialog().waitFor({state:"detached"});
        await page.evaluate(() => { window.__shoppingRefuse = false; });
        await action("new-item").click(); assert.equal(await dialog().evaluate(el => el.open), true);
        await dialog().locator('[data-shop-cancel]').click(); await dialog().waitFor({state:"detached"});
      }
    });
    assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  } catch (error) {
    failure = error;
    if (page) await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  } finally {
    const cleanup = [];
    if (browser) try { await browser.close(); } catch (error) { cleanup.push(error.message); }
    if (preview) try { await preview.close(); } catch (error) { cleanup.push(error.message); }
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors, before, after: hashes(), failure: failure?.message, cleanup }, null, 2));
    if (failure) throw failure; if (cleanup.length) throw new Error(cleanup.join("; "));
  }
}
module.exports = { runShoppingSmoke };
