"use strict";
// Explicit browser acceptance. Import inert; public preview and synthetic state only.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
async function runExpensesSmoke({ chromium, startPreview, outputDir, browserExecutable } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/expenses-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  const checks = [], errors = []; let browser, page;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1050 }, serviceWorkers: "block", acceptDownloads: true });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    page = await context.newPage(); page.setDefaultTimeout(12000); page.on("pageerror", error => errors.push(error.message));
    const seed = `const storageOwner=window.ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...storageOwner,createPrimaryStateSaveQueue:options=>{
      window.__financeGetState=options.getState;const queue=storageOwner.createPrimaryStateSaveQueue(options);
      return {...queue,transaction:operation=>queue.transaction(write=>operation(async(snapshot,writeOptions)=>{
        if(window.__financeHold)await new Promise(resolve=>{window.__financeRelease=()=>{window.__financeHold=false;resolve();};});
        if(window.__financeRefuse)throw new Error('Тест: запись недоступна');return write(snapshot,writeOptions);
      }))};}};
      if(!localStorage.getItem('finance-fixture')){const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
        ZETER_WORKSPACE_UTILS.syncLegacyWorkspaceAliases(s);s.desktops[0].data.taskProjects=[{id:'finance-project',name:'Тестовый проект'}];
        s.desktops.push({id:'finance-other',name:'Другой стол',data:ZETER_WORKSPACE_UTILS.workspaceDefaults()});
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('finance-fixture','1');}`;
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === "/js/app.js") {
        const source = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8"), anchor = '  function renderExpensesApp(params = {}, winId = "") {';
        assert.ok(source.includes(anchor));
        return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + source.replace(anchor, anchor + '\n    window.__financeOpen = params => openApp("expenses", params); window.__financeSwitch = switchVirtualDesktop;') });
      }
      return route.continue();
    });
    const check = async (name, run) => { await run(); checks.push({ name, status: "PASS" }); console.log(`finances UI PASS: ${name}`); };
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__financeGetState())));
    const open = async () => { await page.locator('[data-top-action="appcenter"]').click(); const install = page.locator('[data-install-app="expenses"]'); if (await install.count()) await install.click(); await page.locator('[data-open-app="expenses"]').last().click(); await page.locator(".expenses-app").last().waitFor(); };
    await page.goto(preview.url); await page.locator("#boot").waitFor({ state: "hidden" }); await open();
    const app = page.locator(".expenses-app").first(), win = page.locator('.window[data-app-id="expenses"]').first();
    await win.evaluate(el => Object.assign(el.style, { width: "1400px", height: "930px", left: "20px", top: "45px" }));
    const action = name => app.locator(`[data-exp-action="${name}"]`), tab = name => app.locator(`.expenses-tabs [data-exp-view="${name}"]`);
    const dialog = () => app.locator("dialog"), save = async () => { await app.locator("[data-exp-submit]").click(); await dialog().waitFor({ state: "detached" }); };
    const add = async (kind, amount, title) => {
      await action(`add-${kind}`).first().click(); await dialog().locator('[name="amount"]').fill(amount); await dialog().locator('[name="title"]').fill(title); await dialog().locator('[name="date"]').fill("2026-10-31"); await save();
    };
    await app.locator("[data-exp-month]").fill("2026-10");
    await check("catalog, empty overview, exact expenses and income categories", async () => {
      assert.match(await app.innerText(), /Расходы и Доходы/); assert.match(await app.innerText(), /Начните с одной записи/);
      await add("income", "1000,00", "Зарплата тестовая"); await add("expense", "12,34", "Продукты тестовые");
      const data = (await state()).desktops[0].data.expenses;
      assert.equal(data.entries.find(row => row.kind === "income").amountMinor, 100000);
      assert.equal(data.entries.find(row => row.kind === "expense").amountMinor, 1234);
      assert.match(await app.locator(".expenses-stat.balance").innerText(), /987,66/);
    });
    await check("failed save retains draft, retry publishes exactly one record", async () => {
      await action("add-expense").first().click(); await dialog().locator('[name="amount"]').fill("20,00"); await dialog().locator('[name="title"]').fill("После отказа"); await dialog().locator('[name="date"]').fill("2026-10-31");
      await page.evaluate(() => { window.__financeRefuse = true; });
      await app.locator("[data-exp-submit]").click(); await app.locator("[data-exp-dialog-error]").waitFor();
      assert.equal(await dialog().locator('[name="title"]').inputValue(), "После отказа"); assert.equal((await state()).desktops[0].data.expenses.entries.length, 2);
      await page.evaluate(() => { window.__financeRefuse = false; }); await save(); assert.equal((await state()).desktops[0].data.expenses.entries.length, 3);
    });
    await check("category create, hide, income type, limits and warning", async () => {
      await tab("categories").click(); await action("category").first().click(); await dialog().locator('[name="name"]').fill('Продажа <img src=x onerror=alert(1)>'); await dialog().locator('[name="kind"]').selectOption("income"); await save();
      assert.equal(await app.locator(".expenses-category img").count(), 0);
      const category = (await state()).desktops[0].data.expenses.categories.find(row => row.name.startsWith("Продажа <"));
      await app.locator(`[data-exp-action="category"][data-exp-id="${category.id}"]`).click(); await dialog().locator('[name="archived"]').check(); await save();
      await action("add-income").first().click(); assert.equal(await dialog().locator(`[name="categoryId"] option[value="${category.id}"]`).count(), 0); await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
      await tab("budgets").click(); await action("budget").first().click(); await dialog().locator('[name="amount"]').fill("30"); await save(); assert.match(await app.locator(".expenses-budget.over").innerText(), /Превышение/);
    });
    await check("history filters, literal search, selected currency and CSV", async () => {
      await tab("history").click(); assert.equal(await app.locator("[data-exp-custom]").first().isVisible(), false); const search = app.locator('[data-exp-filter="query"]'); await search.fill("ЗАРПЛАТА"); assert.equal(await app.locator(".expenses-row").count(), 1);
      const downloadPromise = page.waitForEvent("download"); await action("export").click(); const download = await downloadPromise; const file = path.join(out, "filtered.csv"); await download.saveAs(file);
      const csv = fs.readFileSync(file, "utf8"); assert.match(csv, /Зарплата тестовая/); assert.ok(!csv.includes("Продукты тестовые"));
      await search.fill(""); await app.locator('[data-exp-filter="kind"]').selectOption("income"); assert.equal(await app.locator(".expenses-row").count(), 1); await app.locator('[data-exp-filter="kind"]').selectOption("");
      await app.locator("[data-exp-currency]").selectOption("USD"); await page.waitForFunction(() => window.__financeGetState().desktops[0].data.expenses.currency === "USD"); assert.equal(await app.locator(".expenses-row").count(), 0);
      await app.locator("[data-exp-currency]").selectOption("BYN"); await page.waitForFunction(() => window.__financeGetState().desktops[0].data.expenses.currency === "BYN");
    });
    await check("linked partial refund, edit refund, delete cancellation", async () => {
      const row = app.locator(".expenses-row").filter({ hasText: "Продукты тестовые" }); await row.locator('[data-exp-action="refund"]').click(); await dialog().locator('[name="amount"]').fill("2,34"); await dialog().locator('[name="date"]').fill("2026-10-31"); await save();
      const refund = app.locator(".expenses-row").filter({ hasText: "Возврат: Продукты тестовые" }); await refund.locator('[data-exp-action="edit"]').click(); await dialog().locator('[name="amount"]').fill("2,00"); await save();
      assert.equal((await state()).desktops[0].data.expenses.entries.filter(row => row.kind === "refund").length, 1);
      assert.equal((await state()).desktops[0].data.expenses.entries.find(row => row.kind === "refund").amountMinor, 200);
      await refund.locator('[data-exp-action="delete"]').click(); await dialog().locator("[data-exp-close]").last().click(); assert.equal((await state()).desktops[0].data.expenses.entries.length, 4);
    });
    await check("two windows refresh, stale editor rejected, keyboard focus", async () => {
      await app.locator(".expenses-row").filter({ hasText: "После отказа" }).locator('[data-exp-action="edit"]').click(); await dialog().locator('[name="title"]').fill("Устаревшая правка");
      await dialog().evaluate(el => el.close());
      await page.evaluate(() => window.__financeOpen({ view: "history" })); assert.equal(await page.locator(".expenses-app").count(), 2); const second = page.locator(".expenses-app").last(); await second.locator('.expenses-tabs [data-exp-view="history"]').click(); await second.locator(".expenses-row").filter({ hasText: "После отказа" }).locator('[data-exp-action="edit"]').click();
      const secondDialog = second.locator("dialog"); await secondDialog.locator('[name="title"]').fill("Новая правка"); await second.locator("[data-exp-submit]").click(); await secondDialog.waitFor({ state: "detached" });
      // The first modal remains in the top layer while another window updates the same record.
      await dialog().evaluate(el => { el.close(); el.showModal(); }); await app.locator("[data-exp-submit]").click(); await app.locator("[data-exp-dialog-error]").waitFor(); assert.match(await app.locator("[data-exp-dialog-error]").innerText(), /другом окне/);
      assert.equal(await dialog().locator('[name="title"]').inputValue(), "Устаревшая правка"); await page.keyboard.press("Escape"); await dialog().waitFor({ state: "detached" });
      await page.locator('.window[data-app-id="expenses"]').last().locator('[data-win="close"]').click();
      await app.click({ position: { x: 30, y: 30 } }); await page.keyboard.press("Control+f"); await app.locator('[data-exp-filter="query"]').waitFor(); assert.equal(await app.locator('[data-exp-filter="query"]').evaluate(el => el === document.activeElement), true);
    });
    await check("responsive overview and forms at 1400/760/390/320", async () => {
      await tab("overview").click();
      for (const width of [1400, 760, 390, 320]) {
        await page.setViewportSize({ width: width <= 440 ? width : width + 40, height: 1050 });
        await win.evaluate((el, size) => Object.assign(el.style, { width: size + "px", height: "930px", left: "8px", top: "45px" }), width);
        assert.ok(await app.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `app overflow ${width}`);
        await action("add-income").first().click(); assert.ok(await dialog().evaluate(el => el.scrollWidth <= el.clientWidth + 1), `dialog overflow ${width}`);
        await page.screenshot({ path: path.join(out, `form-${width}.png`) }); await page.keyboard.press("Escape");
        await page.screenshot({ path: path.join(out, `overview-${width}.png`) });
      }
    });
    await check("long category stays inside reports and budgets", async () => {
      await page.setViewportSize({ width: 1500, height: 1050 });
      await win.evaluate(el => Object.assign(el.style, { width: "1400px", height: "930px", left: "20px", top: "45px" }));
      await tab("categories").click(); await action("category").first().click();
      const longName = "Д".repeat(100);
      await dialog().locator('[name="name"]').fill(longName); await save();
      await action("add-expense").first().click();
      await dialog().locator('[name="amount"]').fill("1");
      await dialog().locator('[name="date"]').fill("2026-10-31");
      const id = (await state()).desktops[0].data.expenses.categories.find(item => item.name === longName).id;
      await dialog().locator('[name="categoryId"]').selectOption(id); await save();
      await tab("budgets").click(); await action("budget").first().click();
      await dialog().locator('[name="categoryId"]').selectOption(id); await dialog().locator('[name="amount"]').fill("100"); await save();
      await tab("overview").click();
      for (const width of [1400, 760, 390, 320]) {
        await page.setViewportSize({ width: width <= 440 ? width : width + 40, height: 1050 });
        await win.evaluate((el, size) => Object.assign(el.style, { width: `${size}px`, height: "930px", left: "8px", top: "45px" }), width);
        const overflow = await app.evaluate(el => [...el.querySelectorAll('.expenses-content,.expenses-report-grid .expenses-panel,.expenses-budget')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({ class: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth })));
        assert.deepEqual(overflow, [], `inner overflow at ${width}px`);
        await app.locator('.expenses-report-grid').evaluate(el => el.scrollIntoView({ block: "start" }));
        await page.screenshot({ path: path.join(out, `long-report-${width}.png`) });
      }
    });
    await check("empty month, month navigation, filter reset and saved-date action", async () => {
      await page.setViewportSize({ width: 1500, height: 1050 });
      await win.evaluate(el => Object.assign(el.style, { width: "1400px", height: "930px", left: "20px", top: "45px" }));
      await app.locator('[data-exp-month]').fill("2026-09");
      assert.equal(await app.locator('.expenses-welcome').count(), 0);
      assert.match(await app.locator('.expenses-empty').innerText(), /операций нет/);
      await action('all-history').click();
      assert.equal(await app.locator('[data-exp-filter="period"]').inputValue(), "all");
      assert.match(await app.locator('[data-exp-selection]').innerText(), /BYN.*Все даты/);
      assert.ok(await app.locator('.expenses-row').count() > 0);
      await app.locator('[data-exp-filter="query"]').fill('несуществующая запись');
      await action('reset-filters').click();
      assert.equal(await app.locator('[data-exp-filter="query"]').inputValue(), "");
      assert.equal(await app.locator('[data-exp-filter="period"]').inputValue(), "month");
      await action('previous-month').click(); assert.equal(await app.locator('[data-exp-month]').inputValue(), "2026-08");
      await action('next-month').click(); assert.equal(await app.locator('[data-exp-month]').inputValue(), "2026-09");
      await action('current-month').click();
      assert.equal(await app.locator('[data-exp-month]').inputValue(), await page.evaluate(() => ZETER_EXPENSES_UTILS.localExpenseDate().slice(0, 7)));
      await tab('overview').click(); await app.locator('[data-exp-month]').fill('2026-09');
      await add('expense', '3', 'Запись вне месяца');
      assert.match(await app.locator('[data-exp-status]').innerText(), /31\.10\.2026/);
      await action('show-saved').click();
      assert.equal(await app.locator('[data-exp-month]').inputValue(), '2026-10');
      assert.ok(await app.locator('.expenses-row').filter({ hasText: 'Запись вне месяца' }).count());
      await app.locator('[data-exp-month]').fill('1900-01'); assert.equal(await action('previous-month').isDisabled(), true);
      await app.locator('[data-exp-month]').fill('9999-12'); assert.equal(await action('next-month').isDisabled(), true);
      await app.locator('[data-exp-month]').fill('2026-10');
      await tab('overview').click();
      const keyResult = await app.evaluate(el => { el.focus(); const event = new KeyboardEvent('keydown', { key: 'а', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }); el.dispatchEvent(event); return { prevented: event.defaultPrevented, focused: el.querySelector('[data-exp-filter="query"]') === document.activeElement }; });
      assert.deepEqual(keyResult, { prevented: true, focused: true });
    });
    await check("budget copy preview, keep existing, explicit replace and failure retry", async () => {
      const data = (await state()).desktops[0].data.expenses, longId = data.categories.find(item => item.name === 'Д'.repeat(100)).id;
      const setLimit = async (categoryId, amount) => { await action('budget').first().click(); await dialog().locator('[name="categoryId"]').selectOption(categoryId); await dialog().locator('[name="amount"]').fill(amount); await save(); };
      await tab('budgets').click(); await app.locator('[data-exp-month]').fill('2026-09');
      await setLimit('', '40'); await setLimit(longId, '50');
      await app.locator('[data-exp-month]').fill('2026-10');
      await action('copy-budgets').click();
      assert.equal(await dialog().locator('[name="replaceExisting"]').isChecked(), false);
      assert.match(await dialog().innerText(), /Сейчас 30,00/);
      await page.keyboard.press('Tab');
      assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true);
      await save();
      const budgets = () => state().then(s => s.desktops[0].data.expenses.budgets);
      assert.equal((await budgets()).find(item => item.month === '2026-10' && !item.categoryId).limitMinor, 3000);
      await action('copy-budgets').click(); await dialog().locator('[name="replaceExisting"]').check();
      const before = await budgets();
      await page.evaluate(() => { window.__financeRefuse = true; });
      await app.locator('[data-exp-submit]').click(); await app.locator('[data-exp-dialog-error]').waitFor();
      assert.deepEqual(await budgets(), before);
      assert.equal(await dialog().locator('[name="replaceExisting"]').isChecked(), true);
      await page.evaluate(() => { window.__financeRefuse = false; }); await save();
      assert.equal((await budgets()).find(item => item.month === '2026-10' && !item.categoryId).limitMinor, 4000);
      assert.equal((await budgets()).find(item => item.month === '2026-10' && item.categoryId === longId).limitMinor, 5000);
      assert.match(await app.locator('[data-exp-status]').innerText(), /Скопировано лимитов: 2/);
    });
    await check("hidden categories guide new entries and retain historical edit/refund", async () => {
      for (const kind of ['expense', 'income']) {
        await tab('categories').click();
        const categories = (await state()).desktops[0].data.expenses.categories.filter(item => item.kind === kind);
        for (const item of categories.filter(row => !row.archived)) { await app.locator(`[data-exp-action="category"][data-exp-id="${item.id}"]`).click(); await dialog().locator('[name="archived"]').check(); await save(); }
        await action(`add-${kind}`).first().click();
        assert.equal(await dialog().count(), 0);
        assert.match(await app.locator('[data-exp-status]').innerText(), /Нет доступных категорий/);
        await action('manage-categories').click();
        await app.locator(`[data-exp-action="category"][data-exp-id="${categories.at(-1).id}"]`).click(); await dialog().locator('[name="archived"]').uncheck(); await save();
        await add(kind, '0.01', `После показа категории ${kind}`);
      }
      await tab('history').click(); await action('reset-filters').click();
      const original = app.locator('.expenses-row').filter({ hasText: 'Продукты тестовые' }).filter({ has: page.locator('[data-exp-action="refund"]') });
      await original.locator('[data-exp-action="edit"]').click();
      assert.match(await dialog().locator('[name="categoryId"] option:checked').innerText(), /скрыта/); await save();
      await original.locator('[data-exp-action="refund"]').click(); await dialog().locator('[name="amount"]').fill('0.01'); await dialog().locator('[name="date"]').fill('2026-10-31'); await save();
      assert.equal((await state()).desktops[0].data.expenses.entries.filter(item => item.kind === 'refund').length, 2);
    });
    await check("month comparison handles zero base and cross-month refunds", async () => {
      await app.locator('[data-exp-month]').fill('2026-09');
      await action('add-expense').first().click(); await dialog().locator('[name="amount"]').fill('10'); await dialog().locator('[name="date"]').fill('2026-09-30'); await dialog().locator('[name="title"]').fill('Прошлый месяц'); await save();
      await tab('overview').click(); await app.locator('[data-exp-month]').fill('2026-10');
      assert.match(await app.locator('.expenses-comparison').innerText(), /24,34/);
      assert.ok(!/NaN|Infinity/.test(await app.innerText()));
      await tab('history').click();
      const original = app.locator('.expenses-row').filter({ hasText: 'Продукты тестовые' }).filter({ has: page.locator('[data-exp-action="refund"]') });
      await original.locator('[data-exp-action="refund"]').click(); await dialog().locator('[name="amount"]').fill('5'); await dialog().locator('[name="date"]').fill('2026-11-01'); await save();
      await action('show-saved').click(); await tab('overview').click();
      assert.match(await app.locator('.expenses-stat.balance').innerText(), /5,00/);
      assert.match(await app.locator('.expenses-stat').nth(1).innerText(), /-5,00/);
      assert.ok(!/NaN|Infinity/.test(await app.innerText()));
      await app.locator('[data-exp-month]').fill('2026-10');
    });
    await check("short viewport scroll and modal keyboard focus", async () => {
      for (const size of [{ width: 390, height: 400 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        if (size.width > 700) await win.evaluate((el, s) => Object.assign(el.style, { width: `${s.width - 20}px`, height: `${s.height - 100}px`, left: '8px', top: '45px' }), size);
        const edit = app.locator('.expenses-row [data-exp-action="edit"]').last();
        await edit.scrollIntoViewIfNeeded(); await edit.click();
        assert.equal(await dialog().locator('[name="amount"]').evaluate(el => el === document.activeElement), true);
        await page.keyboard.press('Shift+Tab'); assert.equal(await dialog().evaluate(el => el.contains(document.activeElement)), true);
        await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'detached' });
        assert.equal(await edit.evaluate(el => el === document.activeElement), true);
        await page.screenshot({ path: path.join(out, `short-${size.width}x${size.height}.png`) });
      }
    });
    await check("desktop switch and reload retain financial records", async () => {
      const before = (await state()).desktops[0].data.expenses;
      await page.evaluate(() => window.__financeSwitch("finance-other")); await page.waitForFunction(() => window.__financeGetState().currentDesktop === "finance-other");
      assert.equal((await state()).desktops[1].data.expenses.entries.length, 0);
      await page.evaluate(() => window.__financeSwitch("desktop")); await page.waitForFunction(() => window.__financeGetState().currentDesktop === "desktop");
      await page.setViewportSize({ width: 1500, height: 1050 }); await page.reload(); await page.locator("#boot").waitFor({ state: "hidden" });
      assert.deepEqual((await state()).desktops[0].data.expenses, before);
    });
    assert.deepEqual(errors, []);
    const fingerprints = Object.fromEntries(["app/js/core/expenses-utils.js", "app/js/core/expenses-ui-utils.js", "app/css/70-expenses.css", "app/js/app.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors, fingerprints }, null, 2));
    return { checks: checks.length, errors, outputDir: out };
  } catch (error) {
    checks.push({ name: "current scenario", status: "FAIL", error: error.message }); fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    if (page) await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {}); throw error;
  } finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runExpensesSmoke };
