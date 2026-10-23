"use strict";
// Explicit browser acceptance. Import is inert. Separate origin/context, synthetic state only.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

async function runContactsSmoke({ chromium, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/contacts-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  const checks = [], errors = [];
  let browser, page;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, serviceWorkers: "block" });
    await context.addInitScript(() => {
      window.__ZETER_UI_PREVIEW__ = true;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async value => { window.__contactsClipboard = value; } } });
    });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on("pageerror", error => errors.push(error.message));
    const seed = `const storageOwner=window.ZETER_STORAGE_UTILS;
      window.ZETER_STORAGE_UTILS={...storageOwner,createPrimaryStateSaveQueue:options=>{
        window.__contactsGetState=options.getState;
        const queue=storageOwner.createPrimaryStateSaveQueue(options);
        return {...queue,transaction:operation=>queue.transaction(write=>operation(async(snapshot,writeOptions)=>{
          window.__contactsAttempts=(window.__contactsAttempts||0)+1;
          if(window.__contactsHold)await new Promise(resolve=>{window.__contactsRelease=()=>{window.__contactsHold=false;resolve();};});
          if(window.__contactsRefuse)throw new Error('Тест: запись недоступна');
          const result=await write(snapshot,writeOptions);window.__contactsSaved=snapshot;return result;
        }))};}};
      if(!localStorage.getItem('contacts-fixture')){
        const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
        ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);
        s.desktops[0].data.contacts=ZETER_CONTACTS_UTILS.normalizeContacts({
          projects:[{id:'cp1',name:'Работа'},{id:'cp2',name:'Здоровье'}],
          categories:[{id:'cc1',projectId:'cp1',name:'Партнёры'},{id:'cc2',projectId:'cp2',name:'Специалисты'}],
          entries:[{id:'ce1',projectId:'cp1',categoryId:'cc1',name:'Алёна Иванова',company:'Студия Север',role:'Дизайнер',city:'Минск',tags:['брендинг'],notes:'Поможет с фирменным стилем',favorite:true,fields:[{id:'cf1',type:'phone',label:'Рабочий телефон',value:'+375 (29) 123-45-67'},{id:'cf2',type:'email',label:'Почта',value:'alena@example.invalid'}]},
          {id:'ce2',projectId:'cp2',categoryId:'cc2',name:'Иван Петров',role:'Врач',favorite:false,fields:[]}]});
        s.desktops.push({id:'contacts-other',name:'Другой стол',data:ZETER_WORKSPACE_UTILS.workspaceDefaults({contacts:{projects:[],categories:[],entries:[]}})});
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('contacts-fixture','1');
      }`;
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") {
        const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
        const anchor = '  function renderContactsApp(params = {}, winId = "") {';
        assert.ok(source.includes(anchor));
        const instrumented = source.replace(anchor, anchor + '\n    window.__contactsOpenWindow = params => openApp("contacts", params);');
        return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + instrumented });
      }
      return route.continue();
    });
    const check = async (name, run) => { await run(); checks.push({ name, status: "PASS" }); console.log(`contacts UI PASS: ${name}`); };
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__contactsGetState())));
    const open = async () => {
      await page.locator('[data-top-action="appcenter"]').click();
      await page.locator('[data-open-app="contacts"]').last().click();
      await page.locator(".contacts-app").last().waitFor();
    };
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    const app = page.locator(".contacts-app").first(), win = page.locator('.window[data-app-id="contacts"]').first();
    await win.evaluate(el => Object.assign(el.style, { width: "1400px", height: "900px", left: "20px", top: "45px" }));
    const action = id => app.locator(`[data-contact-action="${id}"]`);
    const dialog = () => app.locator("dialog");
    const save = async () => { await app.locator("[data-contact-dialog-submit]").click(); await dialog().waitFor({ state: "detached" }); };
    await check("catalog, projects and categories inside project", async () => {
      assert.equal(await app.locator("[data-contact-filter]").count(), 0);
      await app.locator('[data-contact-project="cp1"]').click();
      assert.equal(await app.locator('[data-contact-filter] option[value="cc1"]').count(), 1);
      assert.equal(await app.locator('.contacts-sidebar [data-contact-filter]').count(), 0);
      assert.equal(await app.locator('[data-contact-filter] option[value="cc2"]').count(), 0);
      await app.locator('[data-contact-project="cp2"]').click();
      assert.equal(await app.locator('[data-contact-filter] option[value="cc2"]').count(), 1);
      assert.equal(await app.locator('[data-contact-filter] option[value="cc1"]').count(), 0);
      assert.equal(await app.locator('.contacts-context-title [data-contact-action="category-add"]').count(), 1);
    });
    const global = () => app.locator('[data-contact-project="*"]:not([data-contact-global])');
    const search = app.locator("[data-contact-search]");
    await check("search multiword, ё, phone digits, custom values and empty", async () => {
      await global().click();
      for (const query of ["алена север", "брендинг", "375291234567", "alena@example.invalid", "фирменным"]) {
        await search.fill(query); assert.equal(await app.locator('[data-contact-open="ce1"]').count(), 1, query);
        assert.equal(await app.locator('[data-contact-open="ce2"]').count(), 0, query);
      }
      await search.fill("неттакогоконтакта"); assert.equal(await app.locator("[data-contact-open]").count(), 0);
      await search.fill("");
      await app.locator('[data-contact-open="ce1"]').click();
      assert.match(await app.locator("[data-contact-detail]").innerText(), /Дизайнер/);
      await app.locator('[data-contact-copy="field:cf2"]').click();
      assert.equal(await page.evaluate(() => window.__contactsClipboard), "alena@example.invalid");
    });
    await check("new contact repeated phones email social custom description", async () => {
      await app.locator('[data-contact-project="cp1"]').click(); await app.locator('[data-contact-filter]').selectOption("cc1");
      await action("add").click();
      await app.locator('[name="name"]').fill("Мария Новая"); await app.locator('[name="company"]').fill("Лаборатория"); await app.locator('[name="role"]').fill("Инженер");
      await app.locator('[name="notes"]').fill("Важное описание контакта");
      const addField = async (index, type, label, value) => {
        if (index >= 2) await app.locator("[data-contact-field-add]").click();
        const row = app.locator("[data-contact-field-row]").nth(index);
        await row.locator("[data-contact-field-type]").selectOption(type);
        await row.locator("[data-contact-field-label]").fill(label);
        await row.locator("[data-contact-field-value]").fill(value);
      };
      await addField(0, "phone", "Рабочий", "+375 (33) 555-66-77");
      await addField(1, "email", "Рабочая почта", "maria@example.invalid");
      await addField(2, "phone", "Личный", "+375 25 777 88 99");
      await addField(3, "social", "Мой Telegram", "https://t.me/example");
      await addField(4, "multiline", "Условия сотрудничества", "Первая строка\n  Вторая строка");
      await save();
      const record = (await state()).desktops[0].data.contacts.entries.find(row => row.name === "Мария Новая");
      assert.equal(record.fields.length, 5); assert.equal(record.fields.filter(row => row.type === "phone").length, 2);
      assert.equal(record.categoryId, "cc1"); assert.equal(record.fields[4].value, "Первая строка\n  Вторая строка");
      assert.match(await app.locator("[data-contact-detail]").innerText(), /Условия сотрудничества/);
    });
    await check("save refusal preserves form and accepted state, explicit retry", async () => {
      await action("edit").click(); await app.locator('[name="role"]').fill("Ведущий инженер");
      await page.evaluate(() => { window.__contactsRefuse = true; });
      await app.locator("[data-contact-dialog-submit]").click();
      await app.locator("[data-contact-dialog-error]").waitFor({ state: "visible" });
      assert.equal(await app.locator('[name="role"]').inputValue(), "Ведущий инженер");
      assert.equal((await state()).desktops[0].data.contacts.entries.find(row => row.name === "Мария Новая").role, "Инженер");
      assert.equal(await app.locator("[data-contact-field-row]").count(), 5);
      await page.evaluate(() => { window.__contactsRefuse = false; }); await save();
      assert.equal((await state()).desktops[0].data.contacts.entries.find(row => row.name === "Мария Новая").role, "Ведущий инженер");
    });
    await check("move project resets category, remove field, cancel deletion", async () => {
      await action("edit").click(); await app.locator('[name="projectId"]').selectOption("cp2");
      assert.equal(await app.locator('[name="categoryId"]').inputValue(), "");
      assert.equal(await app.locator('[name="categoryId"] option[value="cc1"]').count(), 0);
      await app.locator('[name="categoryId"]').selectOption("cc2");
      await app.locator("[data-contact-field-remove]").last().click(); await save();
      const record = (await state()).desktops[0].data.contacts.entries.find(row => row.name === "Мария Новая");
      assert.equal(record.projectId, "cp2"); assert.equal(record.categoryId, "cc2"); assert.equal(record.fields.length, 4);
      await action("delete").click(); await app.locator("[data-contact-dialog-cancel]").last().click();
      assert.equal((await state()).desktops[0].data.contacts.entries.length, 3);
    });
    await check("keyboard focus and favorites", async () => {
      await search.focus(); await page.keyboard.press("Control+f"); assert.equal(await search.evaluate(el => document.activeElement === el), true);
      await global().click(); await search.fill("Алёна"); await app.locator('[data-contact-open="ce1"]').click();
      await action("favorite").click(); await page.waitForFunction(() => window.__contactsGetState().desktops[0].data.contacts.entries.find(row => row.id === 'ce1').favorite === false);
      await action("favorite").click(); await page.waitForFunction(() => window.__contactsGetState().desktops[0].data.contacts.entries.find(row => row.id === 'ce1').favorite === true);
      await search.fill(""); await app.locator('[data-contact-global="favorites"]').click(); assert.equal(await app.locator("[data-contact-open]").count(), 1);
    });
    await check("two windows: pending change refresh preserves other editor draft", async () => {
      await page.evaluate(() => window.__contactsOpenWindow({ entryId: "ce1" }));
      const otherWin = page.locator('.window[data-app-id="contacts"]').nth(1), otherApp = otherWin.locator(".contacts-app");
      await otherWin.evaluate(el => Object.assign(el.style, { width: "660px", height: "880px", left: "810px", top: "45px" }));
      await win.evaluate(el => Object.assign(el.style, { width: "760px", left: "20px" }));
      await otherApp.locator('[data-contact-open="ce1"]').click();
      await page.evaluate(() => { window.__contactsHold = true; });
      await otherApp.locator('[data-contact-action="favorite"]').click();
      await page.waitForFunction(() => typeof window.__contactsRelease === "function");
      await app.locator('[data-contact-open="ce1"]').click(); await action("edit").click();
      await app.locator('[name="role"]').fill("Черновик должности");
      await page.evaluate(() => window.__contactsRelease());
      await page.waitForFunction(() => window.__contactsGetState().desktops[0].data.contacts.entries.find(row => row.id === "ce1").favorite === false);
      assert.equal(await app.locator('[name="role"]').inputValue(), "Черновик должности");
      await app.locator("[data-contact-dialog-cancel]").first().click();
      assert.equal((await state()).desktops[0].data.contacts.entries.find(row => row.id === "ce1").role, "Дизайнер");
      await win.evaluate(el => Object.assign(el.style, { width: "1400px" }));
    });
    await check("project and category CRUD preserve contact and neighbor", async () => {
      await action("project-add").first().click(); await app.locator('[name="title"]').fill("Проверка проекта"); await save();
      await action("category-add").click(); await app.locator('[name="title"]').fill("Своя категория"); await save();
      await action("add").click(); await app.locator('[name="name"]').fill("Контакт для проверки категорий"); await save();
      const record = (await state()).desktops[0].data.contacts.entries.find(row => row.name === "Контакт для проверки категорий");
      await app.locator('[data-contact-filter]').selectOption(record.categoryId);
      await app.locator(".contacts-category-menu summary").click(); await action("category-delete").click(); await save();
      assert.equal((await state()).desktops[0].data.contacts.entries.find(row => row.id === record.id).categoryId, "");
      await app.locator(".contacts-project-menu summary").click(); await action("project-delete").click(); await save();
      const after = (await state()).desktops[0].data.contacts;
      assert.equal(after.entries.find(row => row.id === record.id).projectId, "");
      assert.equal(after.entries.find(row => row.id === "ce1").categoryId, "cc1");
    });
    await check("desktop and narrow container layouts, modal reachable", async () => {
      await global().click(); await app.locator('[data-contact-project="cp1"]').click(); await app.locator('[data-contact-open="ce1"]').click();
      await page.screenshot({ path: path.join(out, "desktop.png") });
      for (const width of [760, 460, 320]) {
        await win.evaluate((el, width) => Object.assign(el.style, { width: width + "px", height: "840px", left: "8px", top: "45px" }), width);
        assert.ok(await app.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `root overflow at ${width}`);
        await action("add").click(); await app.locator('[name="name"]').fill("Тест формы");
        assert.equal(await app.locator("[data-contact-dialog-submit]").isVisible(), true);
        assert.ok(await dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1), `dialog overflow at ${width}`);
        await page.screenshot({ path: path.join(out, `narrow-${width}.png`) });
        await app.locator("[data-contact-dialog-cancel]").first().click();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await win.evaluate(el => Object.assign(el.style, { width: "374px", height: "730px", left: "8px", top: "45px" }));
      await page.screenshot({ path: path.join(out, "mobile.png") });
    });
    await check("reload retains all user-added fields and workspace isolation", async () => {
      await page.setViewportSize({ width: 1500, height: 1050 }); await page.reload(); await page.locator("#boot").waitFor({ state: "hidden" });
      if (!await page.locator(".contacts-app").count()) await open();
      const after = await state(), record = after.desktops[0].data.contacts.entries.find(row => row.name === "Мария Новая");
      assert.equal(record.fields.length, 4); assert.equal(record.role, "Ведущий инженер"); assert.equal(record.projectId, "cp2");
      assert.equal(after.desktops[1].data.contacts.entries.length, 0);
    });
    assert.deepEqual(errors, []);
    const fingerprints = Object.fromEntries(["app/js/core/contacts-utils.js", "app/js/core/contacts-ui-utils.js", "app/css/69-contacts.css", "app/js/app.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors, fingerprints }, null, 2));
    return { checks: checks.length, errors, outputDir: out };
  } catch (error) {
    checks.push({ name: "current scenario", status: "FAIL", error: error.message });
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
    throw error;
  } finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runContactsSmoke };
