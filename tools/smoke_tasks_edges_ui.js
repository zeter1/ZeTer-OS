"use strict";
// Explicit Playwright runner only. New contexts, synthetic data, public-only preview;
// no native API, user profile, real data directory, service worker or external network.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

async function runTasksEdgesSmoke({ chromium, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/tasks-audit-qa/edges");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  const results = [];
  const fingerprints = () => Object.fromEntries(['app/js/core/task-app-ui-utils.js','app/js/core/task-ui-utils.js'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  const source = fingerprints();
  let browser;
  const seed = `
    const originalStorage = window.ZETER_STORAGE_UTILS;
    window.ZETER_STORAGE_UTILS = {...originalStorage, createPrimaryStateSaveQueue: options => {
      const queue = originalStorage.createPrimaryStateSaveQueue(options);
      window.__qaQueue = queue;
      return {...queue, queue: async opts => {
        const mode = window.__qaNextSave; window.__qaNextSave = null;
        if (mode === 'hold-refuse') await new Promise(resolve => window.__qaRelease = resolve);
        if (mode === 'refuse' || mode === 'hold-refuse') throw new Error('Тест: запись недоступна');
        return queue.queue(opts);
      }};
    }};
    if (!localStorage.getItem('tasks-edges-fixture')) {
      const s = ZETER_INITIAL_STATE_UTILS.defaultState(); s.firstRunCompleted = true;
      const base = {projectId:'p', status:'todo', priority:'medium', indefinite:true, description:'Описание', categoryId:'c', checklist:[{id:'check',text:'Проверить результат',done:false}]};
      const a = {...ZETER_WORKSPACE_UTILS.workspaceDefaults(), tasks:[{...base,id:'t',title:'Первая задача'},{...base,id:'neighbor',title:'Соседняя задача'}], taskProjects:[{id:'p',name:'Проект А',categories:[{id:'c',name:'Категория'}]}], activeTaskProjectId:'p'};
      const b = {...ZETER_WORKSPACE_UTILS.workspaceDefaults(), tasks:[{...base,id:'b',projectId:'pb',title:'Задача стола Б',categoryId:''}], taskProjects:[{id:'pb',name:'Проект Б'}], activeTaskProjectId:'pb'};
      s.desktops[0].data = a; s.desktops.push({id:'second',name:'Второй стол',data:b});
      Object.assign(s,{tasks:a.tasks,taskProjects:a.taskProjects,activeTaskProjectId:'p'});
      localStorage.setItem('zeter_os_state_v3', JSON.stringify(s)); localStorage.setItem('tasks-edges-fixture','1');
    }
  `;
  const stateTask = (page, id = "t", desktop = "desktop") => page.evaluate(({id, desktop}) => window.__tasksQA.state.desktops.find(d => d.id === desktop).data.tasks.find(t => t.id === id), {id, desktop});
  const settle = page => page.evaluate(async () => { await window.__qaQueue.pending().catch(() => {}); });
  const cases = [
    ["board rollback stays on original desktop", async (page, app) => {
      const before = await page.evaluate(() => structuredClone(window.__tasksQA.state.desktops.map(d => d.data)));
      await page.evaluate(() => { window.__qaNextSave = 'hold-refuse'; });
      await app.locator('[data-task-id="t"] [data-task-status]').selectOption('doing');
      await page.waitForFunction(() => !!window.__qaRelease);
      await page.evaluate(() => window.__tasksQA.switchDesktop('second'));
      await page.evaluate(() => window.__qaRelease());
      await page.getByText('Изменения не сохранены', {exact:true}).waitFor();
      const after = await page.evaluate(() => window.__tasksQA.state.desktops.map(d => d.data));
      assert.deepEqual(after[1].tasks, before[1].tasks, 'rollback replaced another desktop tasks');
      assert.equal(after[1].activeTaskProjectId, before[1].activeTaskProjectId);
      assert.deepEqual(after[0].tasks, before[0].tasks, 'original task must roll back');
      await settle(page); await page.reload(); await page.waitForSelector('#boot', {state:'hidden'});
      assert.deepEqual((await stateTask(page)).status, before[0].tasks[0].status, 'reload restored a refused change');
    }],
    ["editor rollback stays on original desktop", async (page, app) => {
      await app.locator('[data-task-id="t"] [data-edit]').first().click();
      const editor = page.locator('.task-editor-app'); await editor.locator('[data-task-title]').fill('Черновик');
      const before = await stateTask(page, 'b', 'second');
      await page.evaluate(() => { window.__qaNextSave = 'hold-refuse'; });
      await editor.locator('[data-save]').click(); await page.waitForFunction(() => !!window.__qaRelease);
      await page.evaluate(() => window.__tasksQA.switchDesktop('second'));
      await page.evaluate(() => window.__qaRelease());
      await page.getByText('Задача не сохранена', {exact:true}).waitFor();
      assert.deepEqual(await stateTask(page, 'b', 'second'), before);
      assert.equal((await stateTask(page)).title, 'Первая задача');
      await settle(page); await page.reload(); await page.waitForSelector('#boot', {state:'hidden'});
      assert.equal((await stateTask(page)).title, 'Первая задача', 'reload restored a refused edit');
    }],
    ["impossible deadline is rejected then valid leap day survives reload", async (page, app) => {
      const before = await stateTask(page);
      const invalid = page.waitForEvent('dialog').then(dialog => dialog.accept('2027-02-31'));
      await app.locator('[data-task-id="t"] [data-toggle-indefinite]').click(); await invalid;
      assert.deepEqual(await stateTask(page), before, 'impossible date changed the task');
      const valid = page.waitForEvent('dialog').then(dialog => dialog.accept('2028-02-29'));
      await app.locator('[data-task-id="t"] [data-toggle-indefinite]').click(); await valid;
      await page.waitForFunction(() => window.__tasksQA.state.desktops[0].data.tasks[0].due === '2028-02-29');
      await settle(page); await page.reload(); await page.waitForSelector('#boot', {state:'hidden'});
      assert.equal((await stateTask(page)).due, '2028-02-29'); assert.equal((await stateTask(page)).indefinite, false);
    }],
    ["editor preserves board changes made since opening", async (page, app) => {
      await app.locator('[data-task-id="t"] [data-edit]').first().click();
      const editor = page.locator('.task-editor-app');
      await editor.locator('[data-task-title]').fill('Правка названия');
      await app.locator('[data-task-id="t"] [data-pin]').evaluate(el => el.click());
      await app.locator('[data-task-id="t"].pinned').waitFor({state:'attached'});
      await editor.locator('[data-save]').click(); await editor.waitFor({state:'detached'}); await settle(page);
      assert.equal((await stateTask(page)).title, 'Правка названия');
      assert.equal((await stateTask(page)).pinned, true, 'editor lost a change from the board');
    }],
    ["board refusal then retry preserves neighbors and checklist", async (page, app) => {
      const neighbor = await stateTask(page, 'neighbor');
      await page.evaluate(() => { window.__qaNextSave = 'refuse'; });
      await app.locator('[data-task-id="t"] [data-pin]').click();
      await page.getByText('Изменения не сохранены', {exact:true}).waitFor();
      assert.equal(Boolean((await stateTask(page)).pinned), false);
      await app.locator('[data-task-id="t"] [data-pin]').click();
      await app.locator('[data-task-id="t"].pinned').waitFor();
      await app.locator('[data-task-id="t"] [data-sub="check"]').check(); await settle(page);
      assert.equal((await stateTask(page)).checklist[0].done, true);
      assert.deepEqual(await stateTask(page, 'neighbor'), neighbor);
    }],
    ["delete cancel refusal retry only removes selected task", async (page, app) => {
      const before = await stateTask(page), neighbor = await stateTask(page, 'neighbor');
      let dialog = page.waitForEvent('dialog').then(d => d.dismiss());
      await app.locator('[data-task-id="t"] [data-delete]').click(); await dialog;
      assert.deepEqual(await stateTask(page), before);
      await page.evaluate(() => { window.__qaNextSave = 'refuse'; });
      dialog = page.waitForEvent('dialog').then(d => d.accept());
      await app.locator('[data-task-id="t"] [data-delete]').click(); await dialog;
      await page.getByText('Изменения не сохранены', {exact:true}).waitFor();
      assert.deepEqual(await stateTask(page), before);
      dialog = page.waitForEvent('dialog').then(d => d.accept());
      await app.locator('[data-task-id="t"] [data-delete]').click(); await dialog;
      await app.locator('[data-task-id="t"]').waitFor({state:'detached'}); await settle(page);
      assert.equal(await stateTask(page), undefined); assert.deepEqual(await stateTask(page, 'neighbor'), neighbor);
      await page.reload(); await page.waitForSelector('#boot', {state:'hidden'}); assert.equal(await stateTask(page), undefined);
    }],
    ["reminder save refusal retry repeat and remove", async (page, app) => {
      const card = app.locator('[data-task-id="t"]');
      await card.locator('[data-reminder]').click();
      const value = await page.evaluate(() => { const d=new Date();d.setDate(d.getDate()+2);d.setHours(12,0,0,0);const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T12:00`; });
      await card.locator('[data-reminder-input]').fill(value); await card.locator('[data-reminder-repeat]').fill('3');
      await page.evaluate(() => { window.__qaNextSave='refuse'; });
      await card.locator('[data-reminder-save]').click(); await page.getByText('Изменения не сохранены',{exact:true}).waitFor();
      assert.equal((await stateTask(page)).reminderAt,'');
      await card.locator('[data-reminder]').click(); await card.locator('[data-reminder-input]').fill(value); await card.locator('[data-reminder-repeat]').fill('3');
      await card.locator('[data-reminder-save]').click(); await page.getByText('Уведомление поставлено',{exact:true}).waitFor(); await settle(page);
      assert.equal((await stateTask(page)).reminderRepeatDays,3);
      await page.reload(); await page.waitForSelector('#boot',{state:'hidden'});
      assert.equal((await stateTask(page)).reminderAt,value);
      const currentApp=page.locator('.tasks-app'); if(!await currentApp.count()) await page.locator('#taskbar [data-app="tasks"]').click();
      await currentApp.locator('[data-project-view="list"]').click();
      await card.locator('[data-reminder]').click(); await card.locator('[data-reminder-remove]').click();
      await page.getByText('Уведомление убрано',{exact:true}).waitFor(); await settle(page);
      assert.equal((await stateTask(page)).reminderAt,''); assert.equal((await stateTask(page)).reminderRepeatDays,0);
    }],
    ["priority search status and export use current task data", async (page, app) => {
      const card=app.locator('[data-task-id="t"]'); await card.locator('[data-priority-button]').click();
      await card.locator('[data-priority-select]').selectOption('high'); await page.getByText('Приоритет изменён',{exact:true}).waitFor();
      await app.locator('[data-filter-priority]').selectOption('high'); assert.equal(await app.locator('.task-card').count(),1);
      await app.locator('[data-filter-q]').fill('нет такой задачи'); assert.equal(await app.locator('.task-card').count(),0);
      await app.locator('[data-task-reset-filters]').click(); assert.equal(await app.locator('.task-card').count(),2);
      await card.locator('[data-task-status]').selectOption('done'); await app.locator('.task-column[data-status="done"] [data-task-id="t"]').waitFor(); await settle(page);
      const downloading=page.waitForEvent('download'); await app.locator('[data-export-tasks]').click(); const download=await downloading;
      const stream=await download.createReadStream(),chunks=[]; for await (const chunk of stream) chunks.push(chunk);
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(data.tasks.length,2); assert.equal(data.tasks.find(t=>t.id==='t').priority,'high'); assert.equal(data.tasks.find(t=>t.id==='t').status,'done'); assert.equal(data.taskProjects[0].id,'p');
    }],
    ["create refusal retains draft then retry and reload", async (page, app) => {
      await app.locator('.task-workspace-head [data-open-task-create]').click();
      const editor = page.locator('.task-editor-app');
      await editor.locator('[data-task-title]').fill('Новая <задача>');
      await editor.locator('[data-task-description]').fill('Описание\nВторая строка');
      await page.evaluate(() => { window.__qaNextSave = 'refuse'; });
      await editor.locator('[data-save]').click(); await page.getByText('Задача не сохранена', {exact:true}).waitFor();
      assert.equal(await editor.locator('[data-task-title]').inputValue(), 'Новая <задача>');
      assert.equal(await page.evaluate(() => window.__tasksQA.state.desktops[0].data.tasks.length), 2);
      await editor.locator('[data-task-title]').press('Control+Enter'); await editor.waitFor({state:'detached'}); await settle(page);
      await page.reload(); await page.waitForSelector('#boot', {state:'hidden'});
      const tasks = await page.evaluate(() => window.__tasksQA.state.desktops[0].data.tasks);
      assert.equal(tasks.length, 3); assert.equal(tasks.filter(t => t.title === 'Новая <задача>').length, 1);
    }]
  ];
  try {
    browser = await chromium.launch({headless:false, chromiumSandbox:true});
    for (const [name, run] of cases) {
      const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
      await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const url = route.request().url(); if (!url.startsWith(preview.url)) return route.abort();
        if (new URL(url).pathname === '/js/app.js') {
          const source = fs.readFileSync(path.join(root,'app/js/app.js'),'utf8');
          const marker = '  if (document.readyState === "loading")';
          assert.ok(source.includes(marker));
          return route.fulfill({contentType:'application/javascript',body:seed + source.replace(marker, '  window.__tasksQA = {get state() { return state; }, openApp, switchDesktop: switchVirtualDesktop};\n' + marker)});
        }
        return route.continue();
      });
      try {
        await page.goto(preview.url); await page.waitForSelector('#boot', {state:'hidden'});
        await page.locator('#taskbar [data-app="tasks"]').click();
        const app = page.locator('.tasks-app'); await app.waitFor();
        await app.locator('[data-project-view="list"]').click(); await settle(page);
        await run(page, app); assert.deepEqual(errors, []);
        results.push({name,status:'PASS'}); console.log('PASS',name);
      } catch (e) {
        const screenshot = `failure-${results.length+1}.png`;
        await page.screenshot({path:path.join(out,screenshot)});
        results.push({name,status:'FAIL',error:e.message,errors,screenshot}); console.log('FAIL',name,e.message);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close(); await preview.close();
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({source,sourceUnchanged:JSON.stringify(source)===JSON.stringify(fingerprints()),results},null,2));
  }
  assert.equal(results.filter(r=>r.status==='FAIL').length,0,JSON.stringify(results));
  console.log(`TASKS_EDGES_UI_PASS: ${results.length} scenarios`);
}
module.exports = { runTasksEdgesSmoke };
