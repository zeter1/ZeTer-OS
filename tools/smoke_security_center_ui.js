"use strict";
// Explicit Playwright runner only. No application startup on import.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
async function runSecurityCenterSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, '..'), out = outputDir || path.join(root, 'work/security-center-qa');
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, 'app'), allow: ['index.html','js','css','assets','manifest.json','service-worker.js'], ttlSeconds: 600 });
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const seed = `const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));`;
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === '/js/app.js') return route.fulfill({ contentType: 'application/javascript', body: seed+'\n'+fs.readFileSync(path.join(root,'app/js/app.js'),'utf8') });
      return route.continue();
    });
    try {
      await page.goto(preview.url); await page.waitForSelector('#boot', { state: 'hidden' });
      await page.locator('[data-top-action="security"]').click();
      let app = page.locator('.security-center-app'); await app.waitFor();
      await page.waitForFunction(() => document.querySelector('.security-center-app')?.getAttribute('aria-busy') === 'false');
      assert.doesNotMatch(await app.locator('[data-security-banner]').textContent(), /Загрузка|Статусы не обновлены/);
      assert.equal(await app.locator('[data-security-stats] .security-summary-card').count(), 3);
      const size = async width => { await page.setViewportSize({ width: Math.max(width+16,320), height: 1050 }); await page.locator('.window[data-app-id="security"]').evaluate((el,w)=>Object.assign(el.style,{width:w+'px',height:'950px',top:'8px',left:'8px'}),width); };
      const geometry = async label => assert.equal(await app.evaluate(el => el.scrollWidth <= el.clientWidth+1 && [...el.querySelectorAll('.security-section,.security-summary-card,.security-action-card,.security-hero,.security-nav')].filter(n=>n.getClientRects().length).every(n=>{const a=el.getBoundingClientRect(),b=n.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;})), true, label+': fits actual window width');
      for (const width of [1380,850,560,374,304]) {
        await size(width);
        for (const view of ['overview','backups','storage','maintenance']) {
          await app.locator(`[data-security-view="${view}"]`).click(); await geometry(width+' '+view);
          assert.equal(await app.locator('[data-security-panel]:visible').count(),1);
          assert.equal(await app.locator(`[data-security-view="${view}"]`).getAttribute('aria-pressed'),'true');
        }
        await app.locator('[data-security-view="overview"]').click();
        await page.screenshot({ path: path.join(out,`overview-${width}.png`) });
      }
      await page.evaluate(()=>document.documentElement.style.setProperty('--zeter-text-scale','1.5'));
      await size(374); await geometry('text150');
      await page.evaluate(()=>document.documentElement.style.removeProperty('--zeter-text-scale'));
      // Controlled integration failures use the actual UI controller, never the user's storage/native bridge.
      await page.evaluate(async () => {
        const old = document.querySelector('.security-center-app');
        const snapshot = await ZETER_SECURITY_UTILS.collectSecuritySnapshotModel({ meta: ZETER_SECURITY_UTILS.normalizeSecurityMeta({}), collectExternalSaveSnapshot:async()=>({label:'Папка подключена',note:'Искусственные данные',folderName:'G:/Тест/'+ 'Длинная папка/'.repeat(12),tone:'ok'}) });
        window.securityFixture = { snapshot, failRead:true, failBackup:true, backups:0, checks:0, imports:0, policy:'', readCalls:0 };
        const f = window.securityFixture;
        const ui = ZETER_SECURITY_UI_UTILS.createSecurityCenterApp({ document, nativeMode:true,
          collectSecuritySnapshot:async()=>{f.readCalls++;if(f.failRead)throw Error('Тестовый отказ чтения');return f.snapshot;},
          exportBackup:async()=>{f.backups++;if(f.failBackup)throw Error('Тестовый отказ сохранения');},
          runIntegrityCheck:async()=>{f.checks++;if(f.failCheck)throw Error('Тестовый отказ проверки');await new Promise(resolve=>{f.finishCheck=resolve;});return {problems:[],status:'Проверка теста завершена'};},
          openImport:()=>{f.imports++;}, setProtectionProfile:async value=>{f.policy=value;}
        });old.replaceWith(ui);
      });
      app=page.locator('.security-center-app');
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.match(await app.locator('[data-security-operation]').textContent(),/Тестовый отказ чтения/);
      assert.match(await app.locator('[data-security-main-badge]').textContent(),/не подтверждено/);
      await page.evaluate(()=>{securityFixture.failRead=false;});
      await app.locator('[data-security-refresh]').click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.equal(await app.locator('[data-security-operation]').isVisible(),false);
      await app.locator('[data-security-backup]').first().click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.match(await app.locator('[data-security-operation]').textContent(),/Тестовый отказ сохранения/);
      await page.evaluate(()=>{securityFixture.failBackup=false;});
      await app.locator('[data-security-backup]').first().click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.evaluate(()=>securityFixture.backups),2);
      await page.evaluate(()=>{securityFixture.failRead=true;});
      await app.locator('[data-security-backup]').first().click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.match(await app.locator('[data-security-operation]').textContent(),/Выполненное действие могло завершиться/);
      const backupsBeforeRefresh = await page.evaluate(()=>securityFixture.backups);
      await page.evaluate(()=>{securityFixture.failRead=false;securityFixture.failCheck=true;});
      await app.locator('[data-security-refresh]').click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.evaluate(()=>securityFixture.backups),backupsBeforeRefresh);
      await app.locator('[data-security-check]').click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.match(await app.locator('[data-security-check-result]').textContent(),/Тестовый отказ проверки/);
      assert.doesNotMatch(await app.locator('[data-security-check-result]').textContent(),/Проверяю/);
      await page.evaluate(()=>{securityFixture.failCheck=false;});
      await app.locator('[data-security-check]').click();
      await app.locator('[data-security-view="backups"]').click();
      assert.equal(await app.locator('[data-security-import]').isDisabled(),true);
      await app.locator('[data-security-import]').dispatchEvent('click');
      assert.equal(await page.evaluate(()=>securityFixture.imports),0);
      await page.evaluate(()=>securityFixture.finishCheck());
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      await app.locator('[data-security-import]').click();
      assert.equal(await page.evaluate(()=>securityFixture.imports),1);
      await app.locator('[data-security-view="overview"]').click();
      assert.match(await app.locator('[data-security-check-result]').textContent(),/Проверка теста завершена/);
      await app.locator('[data-security-view="maintenance"]').click();
      await app.locator('[data-security-policy]').selectOption('enhanced');
      await app.locator('[data-security-view="backups"]').click();
      await app.locator('[data-security-view="maintenance"]').click();
      assert.equal(await app.locator('[data-security-policy]').inputValue(),'enhanced');
      await app.locator('[data-security-policy-save]').click();
      await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
      assert.equal(await page.evaluate(()=>securityFixture.policy),'enhanced');
      assert.equal(await app.locator('[data-security-reset]').isVisible(),false);
      await app.locator('.security-danger-zone summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await app.locator('[data-security-reset]').isVisible(),true);
      await size(1380); await app.locator('[data-security-view="storage"]').click(); await geometry('native long path');
      await page.screenshot({path:path.join(out,'storage-native.png')});
      await app.locator('[data-security-view="backups"]').click(); await page.screenshot({path:path.join(out,'backups.png')});
      assert.deepEqual(errors,[]);
      console.log('SECURITY_CENTER_UI_PASS: full app, dark theme, 4 sections at 5 widths, text150, native fixture, read failure/retry, backup failure/retry, busy exclusion, navigation, policy draft, keyboard reset disclosure');
    } catch(error) { await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{}); throw error; }
  } finally { await browser?.close(); await preview.close(); }
}
module.exports={runSecurityCenterSmoke};
