"use strict";
// Explicit Playwright runner only; importing does not start the application.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
async function runProjectOverviewSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/overview-upgrade-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json", "service-worker.js"], ttlSeconds: 600 });
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const seed = `if(!localStorage.getItem('overview-fixture')){const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;const day=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return d.toLocaleDateString('sv-SE');};const p={id:'p',name:'Развитие продукта',color:'#17a398',description:'Подготовить новую версию: исследование, интерфейс и проверка качества.',categories:[{id:'c',name:'Разработка'}]},q={id:'q',name:'Новый проект'};const base={projectId:'p',priority:'medium',status:'todo',createdAt:Date.now(),checklist:[]};const tasks=[{...base,id:'late',title:'Согласовать структуру и основные сценарии',priority:'high',due:day(-2),categoryId:'c'},{...base,id:'today',title:'Доработать интерфейс обзора и доступность',status:'doing',due:day(0),categoryId:'c'},{...base,id:'week',title:'Проверить сохранение и подготовить документацию',status:'review',due:day(3),priority:'low'},{...base,id:'none',title:'Собрать идеи для следующего этапа',indefinite:true},{...base,id:'done',title:'Исследовать текущие сценарии',status:'done',categoryId:'c'},{...base,id:'foreign',projectId:'q',title:'Сторонняя задача',due:day(-2)}];const now=Date.now(),end=now-600000,start=end-5400000;const entry={id:'entry',title:'Проектирование интерфейса',projectId:'p',taskId:'',projectName:p.name,createdAt:start,finishedAt:end,runningSince:null,segments:[{start,end}],notes:''};s.desktops[0].data={...ZETER_WORKSPACE_UTILS.workspaceDefaults(),tasks,taskProjects:[p,q],activeTaskProjectId:'p',timeTracking:{entries:[entry],active:null,dailyGoalMinutes:0}};Object.assign(s,{tasks,taskProjects:[p,q],activeTaskProjectId:'p'});localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('overview-fixture','1');}`;
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body: seed + "\n" + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      return route.continue();
    });
    try {
      await page.goto(preview.url); await page.waitForSelector('#boot', { state: 'hidden' });
      await page.locator('#taskbar [data-app="tasks"]').click();
      const app = page.locator('.tasks-app'), overview = app.locator('[data-project-overview]');
      await app.waitFor();
      const size = async (width, height = width <= 374 ? 760 : 900) => { await page.setViewportSize({ width: Math.max(width + 16, 320), height: height + 84 }); await page.locator('.window[data-app-id="tasks"]').evaluate((el, args) => Object.assign(el.style, { width: args.width+'px', height: args.height+'px', left: '8px', top: '8px' }), { width, height }); };
      const geometry = async label => assert.equal(await overview.evaluate(el => {
        const root = el.getBoundingClientRect();
        return el.scrollWidth <= el.clientWidth + 1 && [...el.querySelectorAll('.project-panel,.project-summary,.project-metric')].every(node => { const r = node.getBoundingClientRect(); return r.left >= root.left - 1 && r.right <= root.right + 1; });
      }), true, label + ': panels fit the actual app width');
      const overviewTab = () => app.locator('[data-project-view="overview"]').click();
      await size(1540); await geometry('wide');
      assert.equal(await overview.locator('progress').getAttribute('aria-label'), 'Выполнено 20% задач');
      assert.deepEqual(await overview.locator('.project-metric > strong').allTextContents(), ['1', '1', '2', '1']);
      assert.equal(await overview.locator('[data-project-time="all"]').textContent(), '01:30');
      assert.equal(await overview.locator('[data-project-day-bar]').count(), 7);
      assert.equal(await overview.locator('[data-project-task="foreign"]').count(), 0);
      await page.screenshot({ path: path.join(out, 'overview-wide.png') });
      await overview.locator('.project-time-panel').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(out, 'overview-time.png') });
      for (const [filter, ids] of [['overdue', ['late']], ['today', ['today']], ['week', ['today', 'week']], ['undated', ['none']]]) {
        await overview.locator(`.project-metric[data-project-deadline="${filter}"]`).click();
        assert.equal(await app.locator(`[data-task-deadline="${filter}"]`).getAttribute('aria-pressed'), 'true');
        assert.deepEqual(await app.locator('.task-card').evaluateAll(els => els.map(el => el.dataset.taskId)), ids);
        await overviewTab();
      }
      await app.locator('[data-filter-category]').selectOption('c');
      assert.equal(await overview.locator('progress').getAttribute('aria-label'), 'Выполнено 33% задач');
      assert.equal(await overview.locator('[data-project-time="all"]').textContent(), '01:30');
      await overview.locator('.project-metric[data-project-deadline="week"]').click();
      assert.deepEqual(await app.locator('.task-card').evaluateAll(els => els.map(el => el.dataset.taskId)), ['today']);
      await overviewTab(); await app.locator('[data-filter-category]').selectOption('all');
      await overview.locator('[data-project-action="find-attachment"]').first().click();
      assert.equal(await overview.locator('[data-project-attachment-search]').evaluate(el => el === document.activeElement), true);
      await overview.locator('[data-project-task="today"][data-project-action="task"]').click();
      const editor = page.locator('.task-editor-app'); await editor.waitFor();
      assert.equal(await editor.locator('[data-task-title]').inputValue(), 'Доработать интерфейс обзора и доступность');
      await editor.locator('[data-task-title]').press('Escape'); await editor.waitFor({ state: 'detached' });
      for (const width of [900, 560, 374, 304]) {
        await size(width); await overview.evaluate(el => { el.scrollTop = 0; el.closest('.task-workspace').scrollTop = 0; }); await geometry(String(width));
        await page.screenshot({ path: path.join(out, `overview-${width}.png`) });
        if (width <= 374) {
          await overview.locator('.project-metric-grid').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(out, `overview-content-${width}.png`) });
          assert.ok(await overview.locator('.project-metric-grid').isVisible());
        }
      }
      await page.evaluate(() => document.documentElement.style.setProperty('--zeter-text-scale', '1.5'));
      await geometry('text150');
      await page.evaluate(() => { document.documentElement.style.removeProperty('--zeter-text-scale'); });
      await size(1540); await geometry('restored text size');
      await app.locator('[data-project-id="q"]').click();
      assert.equal(await overview.locator('[data-project-task="late"]').count(), 0);
      await app.locator('[data-project-add]').click();
      const create = page.locator('[data-task-project-dialog]'); await create.locator('input').fill('Пустой проект'); await create.locator('input').press('Enter'); await create.waitFor({ state: 'detached' });
      await overview.locator('[data-project-action="create"]').first().click(); await editor.waitFor();
      assert.equal(await editor.locator('[data-task-project] option:checked').textContent(), 'Пустой проект');
      await editor.locator('[data-task-title]').press('Escape'); await editor.waitFor({ state: 'detached' });
      await page.screenshot({ path: path.join(out, 'overview-empty.png') });
      assert.deepEqual(errors, []);
      console.log('PROJECT_OVERVIEW_UI_PASS: metrics/filter routes, category scope, stages/week chart, time, task/create actions, empty, wide/narrow/dark/text150');
    } catch (error) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); throw error; }
  } finally { await browser?.close(); await preview.close(); }
}
module.exports = { runProjectOverviewSmoke };
