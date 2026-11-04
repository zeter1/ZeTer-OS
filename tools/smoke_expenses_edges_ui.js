"use strict";
// Explicit browser regressions. Import inert; synthetic state and isolated contexts only.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

async function runExpensesEdgesSmoke({ chromium, startPreview, outputDir, browserExecutable, only = "" } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/expenses-improvements-qa/edges");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  const checks = [], errors = []; let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    async function check(name, fixture, run) {
      if (only && !name.includes(only)) return;
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: "block", acceptDownloads: true, ...(fixture.touch ? { hasTouch: true, isMobile: true } : {}) });
      let page;
      try {
        await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
        page = await context.newPage(); page.setDefaultTimeout(12000);
        page.on("pageerror", error => errors.push({ name, message: error.message }));
        const seed = `const expensesTestStorage=window.ZETER_STORAGE_UTILS;
          window.ZETER_STORAGE_UTILS={...expensesTestStorage,createPrimaryStateSaveQueue:options=>{
            window.__expensesGetState=options.getState;
            const queue=expensesTestStorage.createPrimaryStateSaveQueue(options);
            return {...queue,transaction:operation=>queue.transaction(write=>operation(async(snapshot,writeOptions)=>{
              if(window.__expensesHold)await new Promise(resolve=>{window.__expensesRelease=()=>{window.__expensesHold=false;resolve();};});
              if(window.__expensesRefuse)throw new Error('Тест: запись недоступна');
              return write(snapshot,writeOptions);
            }))};
          }};
          const expensesFixture=${JSON.stringify(fixture)}, expensesState=ZETER_INITIAL_STATE_UTILS.defaultState();
          expensesState.firstRunCompleted=true;ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(expensesState);
          if(expensesFixture.sequential)expensesState.desktops.push({id:'expenses_sentinel',name:'Соседний стол',data:ZETER_WORKSPACE_UTILS.workspaceDefaults()});
          expensesState.desktops[0].name='Учёт <стола> & покупки';
          const expensesData=expensesState.desktops[0].data.expenses;
          const expensesCategory=expensesData.categories.find(row=>row.kind==='expense').id;
          const expensesRow=(id,title,createdAt)=>({id,title,createdAt,updatedAt:createdAt,kind:'expense',originalEntryId:'',amountMinor:500,currency:expensesFixture.currency||'BYN',date:'2025-01-20',categoryId:expensesCategory,notes:'',paymentMethod:'Карта',projectId:'',projectName:''});
          if(expensesFixture.position||expensesFixture.create){
            expensesData.entries=Array.from({length:90},(_,index)=>expensesRow('edge_row_'+index,'Синтетическая покупка '+index,1000+2*index));
            if(expensesFixture.position)expensesData.entries.push(expensesRow('edge_target','Целевая запись',1179-2*(expensesFixture.position-1)));
          }
          if(expensesFixture.refund)expensesData.entries=[expensesRow('edge_purchase','Покупка для возврата',1000)];
          ZETER_EXPENSES_UTILS.validateExpenses(expensesData);
          localStorage.setItem('zeter_os_state_v3',JSON.stringify(expensesState));`;
        await page.route("**/*", route => {
          if (!route.request().url().startsWith(preview.url)) return route.abort();
          if (new URL(route.request().url()).pathname === "/js/app.js") {
            const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
            const anchor = '  function renderExpensesApp(params = {}, winId = "") {';
            assert.ok(source.includes(anchor));
            return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + source.replace(anchor, anchor + '\n    window.__expensesOpen = () => openApp("expenses", {view:"history"});') });
          }
          return route.continue();
        });
        await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" });
        await page.locator('[data-top-action="appcenter"]').click();
        const install = page.locator('[data-install-app="expenses"]'); if (await install.count()) await install.click();
        await page.locator('[data-open-app="expenses"]').last().click();
        const app = page.locator(".expenses-app").last(); await app.waitFor();
        if (fixture.narrow) await page.setViewportSize({ width: 390, height: 844 });
        else await page.locator('.window[data-app-id="expenses"]').last().evaluate(el => Object.assign(el.style, { width: "1880px", height: "950px", left: "16px", top: "45px" }));
        await app.locator("[data-exp-month]").fill("2026-10");
        await run({ page, app, dialog: () => app.locator("dialog"), state: () => page.evaluate(() => JSON.parse(JSON.stringify(window.__expensesGetState()))) });
        checks.push({ name, status: "PASS" }); console.log(`finances edges PASS: ${name}`);
      } catch (error) {
        checks.push({ name, status: "FAIL", error: error.message }); console.log(`finances edges FAIL: ${name}: ${error.message}`);
        if (page) await page.screenshot({ path: path.join(out, `failure-${checks.length}.png`) }).catch(() => {});
      } finally { await context.close(); }
    }
    const visibleTarget = async app => {
      const row = app.locator(".expenses-row").filter({ hasText: "Целевая запись" });
      assert.equal(await row.count(), 1, "target must be rendered beyond the initial 80 rows");
      assert.equal(await row.evaluate(el => {
        const row = el.getBoundingClientRect(), clip = el.closest(".expenses-content").getBoundingClientRect();
        return row.top >= clip.top - 1 && row.bottom <= clip.bottom + 1;
      }), true, "target must be inside the actual scroll viewport");
      assert.equal(await row.evaluate(el => el === document.activeElement || el.contains(document.activeElement)), true, "keyboard focus must follow the target");
    };
    for (const position of [1, 80, 81, 91]) await check(`reveal saved row at position ${position}`, { position, narrow: position === 91 }, async ({ page, app, dialog, state }) => {
      await app.locator('[data-exp-view="history"]').first().click();
      await app.locator('[data-exp-filter="period"]').selectOption("all");
      await app.locator('[data-exp-filter="query"]').fill("Целевая запись");
      await app.locator('.expenses-row [data-exp-action="edit"]').click();
      await dialog().locator('[name="notes"]').fill("Проверка перехода");
      await dialog().locator("[data-exp-submit]").click(); await dialog().waitFor({ state: "detached" });
      await app.locator('[data-exp-action="show-saved"]').click();
      assert.equal(await app.locator("[data-exp-month]").inputValue(), "2025-01"); await visibleTarget(app);
      assert.equal((await state()).desktops[0].data.expenses.entries.length, 91);
      if (position === 81) {
        const pending = page.waitForEvent("download"); await app.locator('[data-exp-action="export"]').click();
        const download = await pending, file = path.join(out, "all-91.csv"); await download.saveAs(file);
        const csv = fs.readFileSync(file, "utf8"); assert.equal((csv.match(/Синтетическая покупка /g) || []).length, 90); assert.match(csv, /Целевая запись/);
      }
    });
    await check("new backdated foreign-currency row and deleted target", { create: true, currency: "EUR" }, async ({ page, app, dialog, state }) => {
      await app.locator('[data-exp-action="add-expense"]').first().click();
      await dialog().locator('[name="amount"]').fill("7,35"); await dialog().locator('[name="currency"]').selectOption("EUR");
      await dialog().locator('[name="date"]').fill("2025-01-01"); await dialog().locator('[name="title"]').fill("Целевая запись");
      await dialog().locator("[data-exp-submit]").click(); await dialog().waitFor({ state: "detached" });
      await app.locator('[data-exp-action="show-saved"]').click(); await visibleTarget(app);
      assert.equal(await app.locator("[data-exp-currency]").inputValue(), "EUR");
      assert.equal((await state()).desktops[0].data.expenses.entries.find(row => row.title === "Целевая запись").amountMinor, 735);
      await app.locator("[data-exp-month]").fill("2026-10");
      await app.locator('[data-exp-action="add-expense"]').first().click(); await dialog().locator('[name="amount"]').fill("1");
      await dialog().locator('[name="date"]').fill("2025-02-01"); await dialog().locator('[name="title"]').fill("Удалённая после сохранения");
      await dialog().locator("[data-exp-submit]").click(); await dialog().waitFor({ state: "detached" });
      // Controlled external deletion tests stale UI feedback; no user state is accessed.
      await page.evaluate(() => { const data = window.__expensesGetState().desktops[0].data.expenses; data.entries = data.entries.filter(row => row.title !== "Удалённая после сохранения"); });
      await app.locator('[data-exp-action="show-saved"]').click(); assert.match(await app.locator("[data-exp-status]").innerText(), /удалена|недоступна/i);
    });
    for (const refund of [false, true]) await check(`failure retains focus and keyboard retry${refund ? " for refund" : ""}`, { refund }, async ({ page, app, dialog, state }) => {
      if (refund) {
        await app.locator('[data-exp-view="history"]').first().click(); await app.locator('[data-exp-filter="period"]').selectOption("all");
        await app.locator('[data-exp-action="refund"]').click();
      } else await app.locator('[data-exp-action="add-expense"]').first().click();
      await dialog().locator('[name="amount"]').fill("2,50"); await dialog().locator('[name="date"]').fill("2026-10-31");
      await dialog().locator('[name="notes"]').fill("Черновик после отказа");
      await page.evaluate(() => { window.__expensesRefuse = true; });
      await dialog().locator("[data-exp-submit]").click(); await dialog().locator("[data-exp-dialog-error]").waitFor();
      assert.equal(await dialog().locator('[name="amount"]').inputValue(), "2,50"); assert.equal(await dialog().locator('[name="notes"]').inputValue(), "Черновик после отказа");
      assert.equal((await state()).desktops[0].data.expenses.entries.length, refund ? 1 : 0);
      assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true, "failed save must retain focus inside the dialog");
      if (refund) for (const name of ["currency", "categoryId", "projectId"]) assert.equal(await dialog().locator(`[name="${name}"]`).isDisabled(), true);
      await page.keyboard.press("Tab"); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true, "Tab from the submit button must stay in the dialog");
      await page.keyboard.press("Shift+Tab"); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true, "Shift+Tab must stay in the dialog");
      await page.evaluate(() => { window.__expensesRefuse = false; });
      await page.keyboard.press("Enter"); await dialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.expenses.entries.length, refund ? 2 : 1);
    });
    await check("desktop context, expense primary and compact empty overview", {}, async ({ page, app }) => {
      assert.equal(await app.locator("[data-exp-workspace]").count(), 1);
      assert.equal(await app.locator("[data-exp-workspace]").innerText(), "Рабочий стол: Учёт <стола> & покупки");
      assert.equal(await app.locator(".expenses-brand img").count(), 0);
      assert.equal(await app.locator('[data-exp-action="add-expense"]').first().evaluate(el => el.classList.contains("primary")), true);
      assert.ok((await app.boundingBox()).width <= 1440);
      assert.ok((await app.locator(".expenses-welcome").boundingBox()).height < 170);
      await page.screenshot({ path: path.join(out, "empty-1920.png") });
      await page.evaluate(() => { window.__expensesGetState().desktops[0].name = "Переименованный стол"; document.querySelector(".expenses-app").refreshExpenses(); });
      assert.equal(await app.locator("[data-exp-workspace]").innerText(), "Рабочий стол: Переименованный стол");
      const longName = "ДлинноеНазвание".repeat(4) + " <&>";
      await page.evaluate(name => { window.__expensesGetState().desktops[0].name = name; document.querySelector(".expenses-app").refreshExpenses(); }, longName);
      for (const size of [{ width: 1000, height: 700 }, { width: 760, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        await page.locator('.window[data-app-id="expenses"]').last().evaluate((el, size) => Object.assign(el.style, { width: `${size.width - 24}px`, height: `${Math.max(260, size.height - 110)}px`, left: "8px", top: "45px" }), size);
        assert.equal(await app.locator("[data-exp-workspace]").innerText(), `Рабочий стол: ${longName}`);
        assert.equal(await app.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `empty overview overflow at ${size.width}`);
        assert.equal(await app.locator("[data-exp-workspace]").evaluate(el => { const box = el.getBoundingClientRect(), root = el.closest(".expenses-app").getBoundingClientRect(); return box.left >= root.left - 1 && box.right <= root.right + 1; }), true, `desktop label overflow at ${size.width}`);
        await page.screenshot({ path: path.join(out, `empty-${size.width}x${size.height}.png`) });
      }
    });
    await check("R01 saved row hidden by current search", {}, async ({ page, app, dialog, state }) => {
      await app.locator('[data-exp-view="history"]').first().click();
      await app.locator('[data-exp-filter="query"]').fill("Молоко");
      await app.locator('[data-exp-action="add-expense"]').first().click();
      await dialog().locator('[name="amount"]').fill("12,34"); await dialog().locator('[name="title"]').fill("Такси");
      await dialog().locator('[name="date"]').fill("2026-10-31");
      await dialog().locator('[data-exp-submit]').click(); await dialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.expenses.entries.length, 1);
      assert.equal(await app.locator('[data-exp-entry]').count(), 0);
      assert.equal(await app.locator('[data-exp-action="show-saved"]').count(), 1, "every saved entry needs an explicit reveal action");
      await app.locator('[data-exp-action="show-saved"]').click();
      assert.equal(await app.locator('[data-exp-filter="query"]').inputValue(), "");
      assert.match(await app.locator('[data-exp-entry]').innerText(), /Такси/);
      assert.equal(await app.locator('[data-exp-entry]').evaluate(el => el === document.activeElement), true);
    });
    for (const count of [81, 91, 161]) await check(`R02 more continues keyboard at ${count} rows`, {}, async ({ page, app }) => {
      await page.evaluate(count => {
        const data = window.__expensesGetState().desktops[0].data.expenses;
        data.entries = Array.from({ length: count }, (_, i) => ({ id: `keyboard_${i}`, kind: "expense", originalEntryId: "", amountMinor: 100, currency: "BYN", date: "2026-10-31", categoryId: data.categories[0].id, title: `Покупка ${i}`, notes: "", paymentMethod: "Карта", projectId: "", projectName: "", createdAt: count - i, updatedAt: count - i }));
      }, count);
      await app.locator('[data-exp-view="history"]').first().click();
      const more = app.locator('[data-exp-action="more"]'); await more.focus(); await page.keyboard.press(count === 91 ? "Space" : "Enter");
      assert.equal(await app.locator('[data-exp-entry]').count(), Math.min(160, count));
      assert.equal(await app.locator('[data-exp-entry="keyboard_80"]').evaluate(el => el === document.activeElement || el.contains(document.activeElement)), true, "focus must reach the first appended row");
      await page.keyboard.press("Tab");
      assert.equal(await app.locator('[data-exp-entry="keyboard_80"]').evaluate(el => el.contains(document.activeElement)), true);
    });
    await check("R03 sibling ACK preserves search selection and foreign focus", {}, async ({ page, app }) => {
      await app.locator('[data-exp-view="history"]').first().click();
      const first = page.locator('.expenses-app').first();
      await page.evaluate(() => window.__expensesOpen());
      assert.equal(await page.locator('.expenses-app').count(), 2);
      const second = page.locator('.expenses-app').last();
      await page.evaluate(() => { window.__expensesHold = true; });
      await second.locator('[data-exp-currency]').selectOption("USD");
      await page.waitForFunction(() => typeof window.__expensesRelease === "function");
      const query = first.locator('[data-exp-filter="query"]');
      await query.focus(); await query.fill("Кириллица и поиск"); await query.evaluate(el => el.setSelectionRange(2, 7, "backward"));
      await page.evaluate(() => window.__expensesRelease());
      await second.locator('[data-exp-status]').filter({ hasText: "Сохранено" }).waitFor();
      assert.deepEqual(await query.evaluate(el => [el === document.activeElement, el.value, el.selectionStart, el.selectionEnd, el.selectionDirection]), [true, "Кириллица и поиск", 2, 7, "backward"]);
      await second.locator('[data-exp-action="add-expense"]').first().click();
      const secondAmount = second.locator('dialog [name="amount"]'); await secondAmount.fill("5");
      await first.evaluate(el => el.refreshExpenses()); assert.equal(await secondAmount.evaluate(el => el === document.activeElement), true, "refresh must not steal modal focus");
    });
    await check("R04 sequential entry ACK failure retry and income", { sequential: true }, async ({ page, app, dialog, state }) => {
      await page.evaluate(() => {
        const current = window.__expensesGetState(); current.desktops[0].data.taskProjects = [{ id: "sequential_project", name: "Проект для серии" }];
      });
      const sentinel = JSON.stringify((await state()).desktops[1]);
      await app.locator('[data-exp-action="add-expense"]').first().click();
      assert.equal(await dialog().locator('[data-exp-submit-next]').count(), 1, "new expense needs save-and-next");
      const next = dialog().locator('[data-exp-submit-next]');
      await dialog().locator('[name="amount"]').fill("1,25"); await dialog().locator('[name="title"]').fill("Первая"); await dialog().locator('[name="notes"]').fill("Комментарий");
      await dialog().locator('[name="date"]').fill("2026-10-20"); await dialog().locator('[name="paymentMethod"]').fill("Наличные");
      await dialog().locator('[name="currency"]').selectOption("EUR"); await dialog().locator('[name="projectId"]').selectOption("sequential_project");
      const categoryId = await dialog().locator('[name="categoryId"]').inputValue();
      await page.evaluate(() => { window.__expensesHold = true; }); await next.click();
      await page.waitForFunction(() => typeof window.__expensesRelease === "function"); await page.keyboard.press("Enter");
      assert.equal((await state()).desktops[0].data.expenses.entries.length, 0);
      await page.evaluate(() => window.__expensesRelease());
      await page.waitForFunction(() => document.querySelector('.expenses-app dialog [name="amount"]').value === "");
      assert.equal((await state()).desktops[0].data.expenses.entries.length, 1);
      for (const name of ["title", "notes"]) assert.equal(await dialog().locator(`[name="${name}"]`).inputValue(), "");
      assert.equal(await dialog().locator('[name="date"]').inputValue(), "2026-10-20"); assert.equal(await dialog().locator('[name="paymentMethod"]').inputValue(), "Наличные");
      for (const [name, value] of [["currency", "EUR"], ["projectId", "sequential_project"], ["categoryId", categoryId]]) assert.equal(await dialog().locator(`[name="${name}"]`).inputValue(), value);
      assert.equal(await dialog().locator('[name="amount"]').evaluate(el => el === document.activeElement), true);
      await dialog().locator('[name="amount"]').fill("2,50"); await dialog().locator('[name="title"]').fill("Вторая");
      await page.evaluate(() => { window.__expensesRefuse = true; }); await next.click(); await dialog().locator('[data-exp-dialog-error]').waitFor();
      assert.equal(await dialog().locator('[name="title"]').inputValue(), "Вторая"); assert.equal((await state()).desktops[0].data.expenses.entries.length, 1);
      await page.evaluate(() => { window.__expensesRefuse = false; }); await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('.expenses-app dialog [name="amount"]').value === "");
      await dialog().locator('[name="amount"]').fill("3,75"); await dialog().locator('[data-exp-submit]').click(); await dialog().waitFor({ state: "detached" });
      assert.deepEqual((await state()).desktops[0].data.expenses.entries.map(row => row.amountMinor), [125, 250, 375]);
      assert.equal(JSON.stringify((await state()).desktops[1]), sentinel);
      await app.locator('[data-exp-action="show-saved"]').click();
      await app.locator('[data-exp-action="add-income"]').first().click(); await dialog().locator('[name="amount"]').fill("10"); await next.click();
      await page.waitForFunction(() => document.querySelector('.expenses-app dialog [name="amount"]').value === "");
      assert.equal((await state()).desktops[0].data.expenses.entries.at(-1).kind, "income");
      await page.keyboard.press("Escape");
      await app.locator('[data-exp-view="history"]').first().click();
      await app.locator('[data-exp-action="edit"]').first().click(); assert.equal(await dialog().locator('[data-exp-submit-next]').count(), 0); await page.keyboard.press("Escape");
      await app.locator('[data-exp-action="refund"]').first().click(); assert.equal(await dialog().locator('[data-exp-submit-next]').count(), 0);
    });
    await check("R04 unavailable selection and narrow form", {}, async ({ page, app, dialog, state }) => {
      await page.evaluate(() => { window.__expensesGetState().desktops[0].data.taskProjects = [{ id: "removed_project", name: "Временный проект" }]; });
      await page.setViewportSize({ width: 320, height: 568 });
      await app.locator('[data-exp-action="add-expense"]').first().click();
      await dialog().locator('[name="amount"]').fill("4,20"); await dialog().locator('[name="title"]').fill("Черновик");
      await dialog().locator('[name="projectId"]').selectOption("removed_project");
      const categoryId = await dialog().locator('[name="categoryId"]').inputValue();
      await page.evaluate(id => { window.__expensesGetState().desktops[0].data.expenses.categories.find(row => row.id === id).archived = true; }, categoryId);
      await dialog().locator('[data-exp-submit-next]').click(); await dialog().locator('[data-exp-dialog-error]').waitFor();
      assert.match(await dialog().locator('[data-exp-dialog-error]').innerText(), /категория.*скрыта|категория.*недоступна/i);
      assert.equal(await dialog().locator('[name="title"]').inputValue(), "Черновик");
      await page.evaluate(id => { const data = window.__expensesGetState().desktops[0].data; data.expenses.categories.find(row => row.id === id).archived = false; data.taskProjects = []; }, categoryId);
      await dialog().locator('[data-exp-submit-next]').click();
      assert.match(await dialog().locator('[data-exp-dialog-error]').innerText(), /проект.*удалён|проект.*недоступен/i);
      assert.equal((await state()).desktops[0].data.expenses.entries.length, 0);
      for (const size of [{ width: 320, height: 568 }, { width: 390, height: 400 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        assert.equal(await dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
        await dialog().locator('[data-exp-submit-next]').scrollIntoViewIfNeeded();
        assert.equal(await dialog().locator('[data-exp-submit-next]').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }), true);
        await page.screenshot({ path: path.join(out, `sequential-form-${size.width}x${size.height}.png`) });
      }
      await page.keyboard.press("Escape"); assert.equal(await app.locator('[data-exp-action="add-expense"]').first().evaluate(el => el === document.activeElement), true);
    });
    await check("R05 category report filters entries and CSV", {}, async ({ page, app, state }) => {
      await page.evaluate(() => {
        const data = window.__expensesGetState().desktops[0].data.expenses, category = data.categories[0];
        category.name = "Продукты " + "ДлинноеНазвание".repeat(5); category.archived = true;
        const row = { kind: "expense", originalEntryId: "", amountMinor: 1000, currency: "BYN", date: "2026-10-01", categoryId: category.id, notes: "", paymentMethod: "Карта", projectId: "", projectName: "", createdAt: 1, updatedAt: 1 };
        data.entries = [{ ...row, id: "report_purchase", title: "Покупка" }, { ...row, id: "report_refund", title: "Возврат в октябре", kind: "refund", originalEntryId: "report_purchase", amountMinor: 200 }, { ...row, id: "report_later", title: "Возврат в ноябре", kind: "refund", date: "2026-11-01", originalEntryId: "report_purchase", amountMinor: 100 }, { ...row, id: "report_other", categoryId: data.categories[1].id, title: "Другая категория" }];
        document.querySelector('.expenses-app').refreshExpenses();
      });
      const category = (await state()).desktops[0].data.expenses.categories[0];
      const link = app.locator(`[data-exp-action="category-history"][data-exp-id="${category.id}"]`);
      assert.equal(await link.count(), 1, "category report must offer history navigation");
      await link.focus(); await page.keyboard.press("Enter");
      assert.equal(await app.locator('[data-exp-filter="categoryId"]').inputValue(), category.id);
      assert.equal(await app.locator('[data-exp-entry]').count(), 2);
      assert.equal(await app.locator('[data-exp-entry]').first().evaluate(el => el === document.activeElement || el.contains(document.activeElement)), true);
      const pending = page.waitForEvent("download"); await app.locator('[data-exp-action="export"]').click();
      const download = await pending, file = path.join(out, "category.csv"); await download.saveAs(file);
      const csv = fs.readFileSync(file, "utf8"); assert.match(csv, /report_purchase/); assert.match(csv, /report_refund/); assert.doesNotMatch(csv, /report_other|report_later/);
      await app.locator('[data-exp-action="reset-filters"]').click(); assert.equal(await app.locator('[data-exp-entry]').count(), 3);
    });
    await check("R05 touch income navigation resets unrelated filters", { touch: true, narrow: true }, async ({ page, app }) => {
      await page.evaluate(() => {
        const data = window.__expensesGetState().desktops[0].data.expenses, category = data.categories.find(row => row.kind === "income");
        data.entries = [{ id: "touch_income", kind: "income", originalEntryId: "", amountMinor: 10000, currency: "BYN", date: "2026-10-31", categoryId: category.id, title: "Оплата проекта", notes: "", paymentMethod: "Карта", projectId: "", projectName: "", createdAt: 1, updatedAt: 1 }];
        document.querySelector('.expenses-app').refreshExpenses();
      });
      await app.locator('[data-exp-view="history"]').first().tap();
      await app.locator('[data-exp-filter="query"]').fill("Несуществующий поиск");
      await app.locator('[data-exp-filter="kind"]').selectOption("expense");
      await app.locator('[data-exp-filter="period"]').selectOption("all");
      await app.locator('[data-exp-view="overview"]').first().tap();
      await app.locator('[data-exp-action="category-history"]').tap();
      assert.equal(await app.locator('[data-exp-filter="query"]').inputValue(), "");
      assert.equal(await app.locator('[data-exp-filter="kind"]').inputValue(), "");
      assert.equal(await app.locator('[data-exp-filter="period"]').inputValue(), "month");
      assert.equal(await app.locator('[data-exp-entry="touch_income"]').count(), 1);
      assert.equal(await app.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      await page.screenshot({ path: path.join(out, "category-income-touch.png") });
    });
    await check("Next: stale budget form preserves the newer limit and draft", {}, async ({ page, app, dialog, state }) => {
      await page.evaluate(() => { window.__expensesGetState().desktops[0].data.expenses.budgets = [{ month: "2026-10", currency: "BYN", categoryId: "", limitMinor: 10000 }]; document.querySelector('.expenses-app').refreshExpenses(); });
      await app.locator('.expenses-budget [data-exp-action="budget"]').click(); await dialog().locator('[name="amount"]').fill("150");
      await page.evaluate(() => { window.__expensesGetState().desktops[0].data.expenses.budgets[0].limitMinor = 20000; document.querySelector('.expenses-app').refreshExpenses(); });
      await dialog().locator('[data-exp-submit]').click();
      await dialog().locator('[data-exp-dialog-error]').waitFor();
      assert.equal(await dialog().count(), 1, "stale budget form must stay open");
      assert.match(await dialog().locator('[data-exp-dialog-error]').innerText(), /лимит.*измен/i);
      assert.equal(await dialog().locator('[name="amount"]').inputValue(), "150"); assert.equal((await state()).desktops[0].data.expenses.budgets[0].limitMinor, 20000);
      await page.keyboard.press("Escape"); await app.locator('.expenses-budget [data-exp-action="budget"]').click();
      assert.equal(await dialog().locator('[name="amount"]').inputValue(), "200.00");
      await dialog().locator('[name="amount"]').fill("175"); await dialog().locator('[data-exp-submit]').click(); await dialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.expenses.budgets[0].limitMinor, 17500);
    });
    await check("Next: date and currency hints update before save", {}, async ({ page, app, dialog, state }) => {
      await app.locator('[data-exp-month]').fill("2024-02"); await app.locator('[data-exp-action="add-expense"]').first().click();
      assert.equal(await dialog().locator('[name="date"]').inputValue(), await page.evaluate(() => window.ZETER_EXPENSES_UTILS.localExpenseDate()));
      const hint = dialog().locator('[data-exp-period-note]'); assert.equal(await hint.count(), 1, "entry form needs a live period hint");
      assert.match(await hint.innerText(), /Запись попадёт/); await dialog().locator('[name="date"]').fill("2024-02-29"); assert.equal(await hint.isVisible(), false);
      await dialog().locator('[name="currency"]').selectOption("EUR"); assert.match(await hint.innerText(), /EUR.*BYN/);
      await dialog().locator('[name="currency"]').selectOption("BYN"); assert.equal(await hint.isVisible(), false);
      await dialog().locator('[name="date"]').fill("2027-01-31"); assert.match(await hint.innerText(), /2027/);
      await page.keyboard.press("Escape"); assert.equal((await state()).desktops[0].data.expenses.entries.length, 0);
    });
    await check("Next: remaining refunds and linked purchase restrictions", {}, async ({ page, app, dialog, state }) => {
      await page.evaluate(() => {
        const data = window.__expensesGetState().desktops[0].data.expenses;
        const row = { kind: "expense", originalEntryId: "", amountMinor: 10000, currency: "BYN", date: "2026-10-01", categoryId: data.categories[0].id, title: "Покупка 100", notes: "", paymentMethod: "Карта", projectId: "", projectName: "", createdAt: 1, updatedAt: 1 };
        data.entries = [{ ...row, id: "next_purchase" }, { ...row, id: "next_refund1", kind: "refund", originalEntryId: "next_purchase", title: "Возврат 30", amountMinor: 3000, date: "2026-10-02" }, { ...row, id: "next_refund2", kind: "refund", originalEntryId: "next_purchase", title: "Возврат 20", amountMinor: 2000, date: "2026-10-03" }]; document.querySelector('.expenses-app').refreshExpenses();
      });
      await app.locator('.expenses-tabs [data-exp-view="history"]').click();
      const purchase = app.locator('[data-exp-entry="next_purchase"]'); await purchase.locator('[data-exp-action="refund"]').click();
      assert.equal(await dialog().locator('[data-exp-refund-note]').count(), 1, "refund form needs an explicit remaining amount");
      assert.match(await dialog().locator('[data-exp-refund-note]').innerText(), /50,00/); await page.keyboard.press("Escape");
      await app.locator('[data-exp-entry="next_refund2"] [data-exp-action="edit"]').click(); assert.match(await dialog().locator('[data-exp-refund-note]').innerText(), /70,00/); await page.keyboard.press("Escape");
      await purchase.locator('[data-exp-action="edit"]').click(); const note = dialog().locator('[data-exp-purchase-note]');
      assert.match(await note.innerText(), /50,00/); assert.match(await note.innerText(), /02\.10\.2026/); await page.keyboard.press("Escape");
      await purchase.locator('[data-exp-action="refund"]').click(); await dialog().locator('[name="amount"]').fill("50,01"); await dialog().locator('[data-exp-submit]').click();
      await dialog().locator('[data-exp-dialog-error]').waitFor(); assert.equal((await state()).desktops[0].data.expenses.entries.length, 3); assert.equal(await dialog().locator('[name="amount"]').inputValue(), "50,01");
      await dialog().locator('[name="amount"]').fill("0,01"); await dialog().locator('[data-exp-submit]').click(); await dialog().waitFor({ state: "detached" });
      assert.equal((await state()).desktops[0].data.expenses.entries.at(-1).amountMinor, 1);
      await purchase.locator('[data-exp-action="refund"]').click(); await dialog().locator('[name="amount"]').fill("0,01");
      await page.evaluate(() => { const data = window.__expensesGetState().desktops[0].data.expenses; data.entries.push({ ...data.entries[1], id: "next_concurrent_refund", amountMinor: 4999, date: "2026-10-31" }); document.querySelector('.expenses-app').refreshExpenses(); });
      assert.match(await dialog().locator('[data-exp-refund-note]').innerText(), /0,00/);
      await dialog().locator('[data-exp-submit]').click(); await dialog().locator('[data-exp-dialog-error]').waitFor();
      assert.equal((await state()).desktops[0].data.expenses.entries.filter(row => row.kind === "refund").reduce((sum, row) => sum + row.amountMinor, 0), 10000);
    });
    await check("Next: readable labels and all narrow tabs visible", { narrow: true }, async ({ page, app, dialog }) => {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const layout = await app.locator('.expenses-tabs').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth + 1, rows: new Set([...el.children].map(n => Math.round(n.getBoundingClientRect().top))).size, heights: [...el.children].map(n => n.getBoundingClientRect().height) }));
        assert.equal(layout.rows, 2, "all four narrow tabs need two visible rows"); assert.equal(layout.overflow, false); assert.ok(layout.heights.every(value => value >= 44));
        await app.locator('[data-exp-action="add-expense"]').first().click();
        assert.ok(await dialog().locator('.expenses-field > span').evaluateAll(nodes => nodes.every(el => parseFloat(getComputedStyle(el).fontSize) >= 13)));
        await page.keyboard.press("Escape");
      }
      await page.screenshot({ path: path.join(out, "next-tabs-320.png") });
    });
    await check("Next: repeat draft cancel failure retry and one new ID", { sequential: true }, async ({ page, app, dialog, state }) => {
      await page.evaluate(() => {
        const current = window.__expensesGetState(); current.desktops[1].data = window.ZETER_WORKSPACE_UTILS.normalizeWorkspaceData(current.desktops[1].data);
        const data = current.desktops[0].data.expenses, row = { id: "next_repeat", kind: "expense", originalEntryId: "", amountMinor: 1234, currency: "BYN", date: "2026-10-01", categoryId: data.categories[0].id, title: "Повторяемая покупка", notes: "Комментарий ".repeat(40), paymentMethod: "Наличные", projectId: "", projectName: "", createdAt: 1, updatedAt: 1 };
        data.entries = [row]; document.querySelector('.expenses-app').refreshExpenses();
      });
      const original = (await state()).desktops[0].data.expenses.entries[0], sentinel = JSON.stringify((await state()).desktops[1]);
      await app.locator('.expenses-tabs [data-exp-view="history"]').click(); const repeat = app.locator('[data-exp-entry="next_repeat"] [data-exp-action="repeat"]');
      assert.equal(await repeat.count(), 1, "expenses need a repeat action"); await repeat.click();
      assert.equal(await dialog().locator('[name="amount"]').inputValue(), "12.34"); assert.equal(await dialog().locator('[name="notes"]').inputValue(), original.notes);
      assert.equal(await dialog().locator('[name="date"]').inputValue(), await page.evaluate(() => window.ZETER_EXPENSES_UTILS.localExpenseDate()));
      await page.keyboard.press("Escape"); assert.equal((await state()).desktops[0].data.expenses.entries.length, 1);
      await repeat.click(); await page.evaluate(() => { window.__expensesRefuse = true; }); await dialog().locator('[data-exp-submit]').click(); await dialog().locator('[data-exp-dialog-error]').waitFor();
      assert.equal(await dialog().locator('[name="title"]').inputValue(), original.title); assert.equal((await state()).desktops[0].data.expenses.entries.length, 1);
      await page.evaluate(() => { window.__expensesRefuse = false; window.__expensesHold = true; }); await dialog().locator('[data-exp-submit]').click(); await page.waitForFunction(() => typeof window.__expensesRelease === "function"); await page.keyboard.press("Enter");
      await page.evaluate(() => window.__expensesRelease()); await dialog().waitFor({ state: "detached" });
      const after = await state(), entries = after.desktops[0].data.expenses.entries; assert.equal(entries.length, 2); assert.notEqual(entries[1].id, original.id); assert.deepEqual(entries[0], original); assert.equal(JSON.stringify(after.desktops[1]), sentinel);
    });
    await check("Next: repeat income currency unavailable category and project", {}, async ({ page, app, dialog, state }) => {
      await page.evaluate(() => {
        const current = window.__expensesGetState(), data = current.desktops[0].data.expenses, category = data.categories.find(row => row.kind === "income"); category.archived = true;
        data.entries = [{ id: "next_old_income", kind: "income", originalEntryId: "", amountMinor: 2001, currency: "EUR", date: "2025-01-01", categoryId: category.id, title: "Исторический доход", notes: "Описание", paymentMethod: "Перевод", projectId: "gone_project", projectName: "Удалённый проект", createdAt: 1, updatedAt: 1 }]; document.querySelector('.expenses-app').refreshExpenses();
      });
      await app.locator('[data-exp-currency]').selectOption("EUR"); await page.waitForFunction(() => document.querySelector('[data-exp-currency]').disabled === false);
      await app.locator('.expenses-tabs [data-exp-view="history"]').click(); await app.locator('[data-exp-filter="period"]').selectOption("all");
      await app.locator('[data-exp-action="repeat"]').click(); assert.match(await dialog().innerText(), /недоступны/);
      assert.equal(await dialog().locator('[name="categoryId"]').inputValue(), ""); assert.equal(await dialog().locator('[name="projectId"]').inputValue(), "gone_project");
      await dialog().locator('[data-exp-submit]').click(); assert.equal((await state()).desktops[0].data.expenses.entries.length, 1, "missing category must not silently become another category");
      const categoryId = (await state()).desktops[0].data.expenses.categories.find(row => row.kind === "income" && !row.archived).id;
      await dialog().locator('[name="categoryId"]').selectOption(categoryId); await dialog().locator('[data-exp-submit]').click(); await dialog().locator('[data-exp-dialog-error]').waitFor();
      assert.equal((await state()).desktops[0].data.expenses.entries.length, 1); await dialog().locator('[name="projectId"]').selectOption("");
      await dialog().locator('[data-exp-submit]').click(); await dialog().waitFor({ state: "detached" });
      const entry = (await state()).desktops[0].data.expenses.entries.at(-1);
      assert.equal(entry.kind, "income"); assert.equal(entry.currency, "EUR"); assert.equal(entry.amountMinor, 2001); assert.equal(entry.projectId, ""); assert.equal(entry.originalEntryId, ""); assert.notEqual(entry.createdAt, 1);
      await app.locator('[data-exp-action="show-saved"]').click(); await app.locator('[data-exp-entry]').last().locator('[data-exp-action="edit"]').click();
      await dialog().locator('[name="date"]').fill("2024-02-29"); assert.match(await dialog().locator('[data-exp-period-note]').innerText(), /2024/);
    });
    const fingerprints = Object.fromEntries(["app/js/core/expenses-ui-utils.js", "app/js/core/expenses-utils.js", "app/css/70-expenses.css", "app/js/app.js", "tools/smoke_expenses_edges_ui.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors, fingerprints }, null, 2));
    assert.ok(checks.length, "no matching expenses edge scenarios");
    assert.deepEqual(errors, []); assert.equal(checks.filter(row => row.status === "FAIL").length, 0, "expenses edge scenarios failed");
    return { checks: checks.length, errors, outputDir: out };
  } finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runExpensesEdgesSmoke };
