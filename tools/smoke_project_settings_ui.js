"use strict";
// Explicit runner only. Separate browser context, synthetic state, public app assets.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
async function runProjectSettingsSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/project-settings-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const seed = `const realStorage=window.ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...realStorage,createPrimaryStateSaveQueue:options=>{const queue=realStorage.createPrimaryStateSaveQueue(options);return {...queue,transaction:operation=>queue.transaction(write=>operation(async snapshot=>{if(window.__refuseSettingsWrite)throw new Error('Проверка: запись недоступна');if(window.__holdSettingsWrite)await new Promise(resolve=>window.__releaseSettingsWrite=resolve);const result=await write(snapshot);window.__settingsSnapshot=snapshot;return result;}))};}};if(!localStorage.getItem('settings-fixture')){const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;const taskProjects=[{id:'p',name:'Учёба',categories:[{id:'c',name:'Чтение'}]},{id:'q',name:'Работа'}],tasks=[{id:'low',projectId:'p',title:'Первый',status:'todo',priority:'low',createdAt:1,indefinite:true},{id:'high',projectId:'p',title:'Второй',status:'todo',priority:'high',createdAt:2,indefinite:true},{id:'done',projectId:'p',title:'Готовая задача',status:'done',priority:'medium',indefinite:true}];s.desktops[0].data={...ZETER_WORKSPACE_UTILS.workspaceDefaults(),tasks,taskProjects,activeTaskProjectId:'p'};Object.assign(s,{tasks,taskProjects,activeTaskProjectId:'p'});localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('settings-fixture','1');}`;
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      return route.continue();
    });
    try {
      await page.goto(preview.url); await page.waitForSelector("#boot", { state: "hidden" });
      await page.locator('#taskbar [data-app="tasks"]').click();
      const app = page.locator(".tasks-app"), dialog = page.locator("[data-project-settings-dialog]");
      await app.waitFor();
      const open = async () => { await app.locator('.task-project-settings summary').click(); await app.locator('[data-project-configure]').first().click(); await dialog.waitFor(); };
      const name = dialog.locator('[name="name"]');
      const save = dialog.locator('[type="submit"]');
      const layout = async width => {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await dialog.evaluate(el => { const r = el.getBoundingClientRect(), footer = el.querySelector('footer').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && footer.bottom <= r.bottom && el.scrollWidth <= el.clientWidth + 1; }), true, `dialog and actions fit at ${width}`);
      };
      await open();
      await name.fill('Учёба <web>');
      await dialog.locator('[name="description"]').fill('Цель проекта\nИзучить Python');
      await dialog.getByRole('radio', { name: 'Зелёный', exact: true }).check();
      await dialog.locator('[name="defaultView"]').selectOption('list');
      await dialog.locator('[name="sortBy"]').selectOption('priority');
      await dialog.locator('[name="hideCompleted"]').check();
      await dialog.locator('[name="defaultPriority"]').selectOption('high');
      await layout(1440); await page.screenshot({ path: path.join(out, 'settings-wide.png') });
      await page.evaluate(() => { window.__refuseSettingsWrite = true; }); await save.click();
      await dialog.locator('[role="alert"]:not([hidden])').waitFor();
      assert.equal(await name.inputValue(), 'Учёба <web>');
      assert.equal(await app.locator('[data-current-project-name]').textContent(), 'Учёба', 'refusal preserves active project');
      await page.evaluate(() => { window.__refuseSettingsWrite = false; window.__holdSettingsWrite = true; });
      await save.click(); await page.waitForFunction(() => !!window.__releaseSettingsWrite);
      assert.equal(await name.isDisabled(), true);
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true, 'pending modal stays open');
      assert.equal(await app.locator('[data-current-project-name]').textContent(), 'Учёба');
      await page.evaluate(() => { window.__holdSettingsWrite = false; window.__releaseSettingsWrite(); });
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await app.locator('[data-current-project-name]').textContent(), 'Учёба <web>');
      assert.equal(await app.locator('[data-project-description]').textContent(), 'Цель проекта\nИзучить Python');
      assert.equal(await app.locator('[data-task-id="done"]').count(), 0);
      assert.deepEqual(await app.locator('.task-card').evaluateAll(els => els.map(el => el.dataset.taskId)), ['high', 'low']);
      await app.locator('[data-open-task-create]').first().click();
      const editor = page.locator('.task-editor-create');
      assert.equal(await editor.locator('[data-task-priority]').inputValue(), 'high');
      await editor.locator('[data-task-project]').selectOption('q');
      assert.equal(await editor.locator('[data-task-priority]').inputValue(), 'medium');
      await editor.locator('[data-task-project]').selectOption('p');
      await editor.locator('[data-task-title]').fill('Новая задача');
      await editor.locator('[data-task-title]').press('Control+Enter'); await editor.waitFor({ state: 'detached' });
      await app.locator('[data-project-id="q"]').click();
      assert.equal(await app.locator('[data-project-description]').isHidden(), true);
      assert.equal(await app.locator('[data-project-view="overview"]').getAttribute('aria-pressed'), 'true');
      await app.locator('[data-project-id="p"]').click();
      assert.equal(await app.locator('[data-project-view="list"]').getAttribute('aria-pressed'), 'true');
      await page.reload(); await page.waitForSelector('#boot', { state: 'hidden' });
      if (!await app.count()) await page.locator('#taskbar [data-app="tasks"]').click();
      await app.waitFor(); await app.locator('[data-project-id="p"]').click();
      await open(); assert.equal(await name.inputValue(), 'Учёба <web>');
      assert.equal(await dialog.locator('[name="defaultPriority"]').inputValue(), 'high');
      assert.equal(await dialog.locator('[name="hideCompleted"]').isChecked(), true);
      for (const width of [760, 390, 320]) {
        await layout(width); await page.screenshot({ path: path.join(out, `settings-${width}.png`) });
      }
      await name.fill('Отменённая правка'); await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await app.locator('[data-current-project-name]').textContent(), 'Учёба <web>');
      await page.setViewportSize({ width: 1440, height: 1000 }); await open();
      await dialog.locator('[name="hideCompleted"]').uncheck(); await save.click(); await dialog.waitFor({ state: 'detached' });
      assert.equal(await app.locator('[data-task-id="done"]').count(), 1, 'completed tasks can be restored to view');
      assert.equal(await app.locator('[data-task-id="low"] [data-priority-button]').textContent(), 'Низкий', 'existing priority stays unchanged');
      await open();
      assert.equal(await dialog.locator('.task-project-colors input[type="radio"]').count(), 22);
      assert.equal(await dialog.locator('[name="customPicker"]').evaluate(el => el.getBoundingClientRect().width <= 60), true, 'color picker stays compact beside HEX');
      const hex = dialog.getByRole('textbox', { name: 'Код цвета HEX', exact: true });
      await hex.fill('invalid'); await save.click();
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await hex.evaluate(el => el.checkValidity()), false, 'invalid HEX cannot submit');
      await dialog.locator('[name="customPicker"]').evaluate(el => { el.value = '#d92b74'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await hex.inputValue(), '#d92b74');
      assert.equal(await dialog.locator('[name="color"][value="custom"]').isChecked(), true);
      assert.equal(await dialog.locator('[data-project-color-preview]').evaluate(el => getComputedStyle(el).borderLeftColor), 'rgb(217, 43, 116)');
      await page.evaluate(() => { window.__refuseSettingsWrite = true; }); await save.click();
      await dialog.locator('[role="alert"]:not([hidden])').waitFor();
      assert.equal(await hex.inputValue(), '#d92b74');
      await page.evaluate(() => { window.__refuseSettingsWrite = false; });
      await dialog.locator('.task-project-color-section').screenshot({ path: path.join(out, 'palette-wide.png') });
      await save.click(); await dialog.waitFor({ state: 'detached' });
      assert.equal(await app.locator('[data-current-project-name]').evaluate(el => getComputedStyle(el).borderLeftColor), 'rgb(217, 43, 116)');
      await page.reload(); await page.waitForSelector('#boot', { state: 'hidden' });
      if (!await app.count()) await page.locator('#taskbar [data-app="tasks"]').click();
      await app.waitFor(); await open();
      assert.equal(await hex.inputValue(), '#d92b74', 'custom color survives reload');
      assert.equal(await dialog.locator('[name="color"][value="custom"]').isChecked(), true);
      await dialog.getByRole('radio', { name: 'Синий', exact: true }).check();
      assert.equal(await hex.inputValue(), '#70aeef', 'preset synchronizes picker and code');
      await hex.fill('#17a398');
      for (const width of [390, 320]) { await layout(width); await hex.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, `palette-${width}.png`) }); }
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      console.log('PROJECT_SETTINGS_UI_PASS: save/refusal/retry/pending, isolation, sorting, defaults, 22 presets/custom picker/HEX/preview/reload, cancel, 1440/760/390/320');
    } catch (error) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); throw error; }
  } finally { await browser?.close(); await preview.close(); }
}
module.exports = { runProjectSettingsSmoke };
