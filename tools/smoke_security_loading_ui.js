"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function runSecurityLoadingSmoke({chromium,startPreview,outputDir}){
 const root=path.resolve(__dirname,'..'),out=outputDir||path.join(root,'work/security-loading-qa');fs.mkdirSync(out,{recursive:true});
 const preview=await startPreview({root:path.join(root,'app'),allow:['index.html','js','css','assets','manifest.json','service-worker.js'],ttlSeconds:600});let browser;
 try{
  browser=await chromium.launch({headless:false,chromiumSandbox:true});const context=await browser.newContext({viewport:{width:1400,height:1050},serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   if(!route.request().url().startsWith(preview.url))return route.abort();
   if(new URL(route.request().url()).pathname==='/js/app.js')return route.fulfill({contentType:'application/javascript',body:`const fixture=ZETER_INITIAL_STATE_UTILS.defaultState();fixture.firstRunCompleted=true;localStorage.setItem('zeter_os_state_v3',JSON.stringify(fixture));\n`+fs.readFileSync(path.join(root,'app/js/app.js'),'utf8')});
   return route.continue();
  });
  await page.goto(preview.url);await page.waitForSelector('#boot',{state:'hidden'});await page.locator('[data-top-action="security"]').click();await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
  await page.evaluate(async()=>{
   const snapshot=await ZETER_SECURITY_UTILS.collectSecuritySnapshotModel({meta:ZETER_SECURITY_UTILS.normalizeSecurityMeta({})});
   const f=window.loadingFixture={snapshot,reads:0,histories:0,cleanups:0,backups:0,timers:[]};
   const app=ZETER_SECURITY_UI_UTILS.createSecurityCenterApp({document,
    collectSecuritySnapshot:async options=>{f.reads++;f.options=options;if(f.reads===1)await new Promise(resolve=>f.finishMain=resolve);return snapshot;},
    collectCleanupPreview:async()=>{f.cleanups++;return {restorePoints:0};},exportBackup:async()=>{f.backups++;},
    recoveryController:{mount(){},invalidateRefresh(){f.historyRevision=(f.historyRevision||0)+1;},refresh:async root=>{const revision=f.historyRevision||0;f.histories++;if(f.histories===1)await new Promise(resolve=>f.finishHistory=resolve);if(revision===(f.historyRevision||0))root.querySelector('[data-vault-status]').textContent='Актуальная история загружена';}},
    scheduleReadTimeout:callback=>{f.timers.push(callback);return callback;},clearReadTimeout:()=>{}
   });document.querySelector('.security-center-app').replaceWith(app);
  });
  const app=page.locator('.security-center-app');
  assert.equal(await app.locator('[data-security-check]').isEnabled(),true,'opening status read must not disable user actions');
  assert.equal(await page.evaluate(()=>loadingFixture.histories),0,'hidden backup history is lazy');
  assert.equal(await page.evaluate(()=>loadingFixture.cleanups),0,'hidden cleanup preview is lazy');
  assert.equal(await app.locator('[data-recovery-action="configure"]').isDisabled(),true,'unknown policy cannot be saved');
  await app.locator('[data-security-view="backups"]').click();await page.waitForFunction(()=>loadingFixture.histories===1);
  await page.evaluate(()=>loadingFixture.firstHistoryDeadline=loadingFixture.timers[1]);
  await app.locator('[data-security-backup]:visible').first().click();await page.waitForFunction(()=>loadingFixture.backups===1&&document.querySelector('.security-center-app').getAttribute('aria-busy')==='false');
  assert.equal(await page.evaluate(()=>loadingFixture.reads),1,'post-action refresh waits for the unresolved read');
  await page.evaluate(()=>loadingFixture.finishMain());await page.waitForFunction(()=>loadingFixture.reads===2&&document.querySelector('.security-center-app').getAttribute('aria-busy')==='false');
  assert.equal(await app.locator('[data-security-stats] .security-summary-card').count(),3,'one trailing read renders current snapshot after the action');
  assert.equal(await app.locator('[data-security-backup]').first().isEnabled(),true,'slow history does not block overview/actions');
  await app.locator('[data-security-view="overview"]').click();await app.locator('[data-security-view="backups"]').click();assert.equal(await page.evaluate(()=>loadingFixture.histories),1,'in-flight history is shared');
  await page.evaluate(()=>loadingFixture.firstHistoryDeadline());
  await page.evaluate(()=>loadingFixture.finishHistory());await page.waitForFunction(()=>loadingFixture.histories===2);assert.match(await app.locator('[data-vault-status]').textContent(),/Актуальная история/,'invalidated history starts one fresh read even after its deadline');
  await app.locator('[data-security-view="maintenance"]').click();await page.waitForFunction(()=>loadingFixture.cleanups===1);
  await app.locator('[data-security-view="overview"]').click();await app.locator('[data-security-view="maintenance"]').click();assert.equal(await page.evaluate(()=>loadingFixture.cleanups),1);
  await app.locator('[data-security-view="overview"]').click();await app.locator('[data-security-backup]').first().click();await page.waitForFunction(()=>document.querySelector('.security-center-app').getAttribute('aria-busy')==='false');assert.equal(await page.evaluate(()=>loadingFixture.backups),2);
  // A controlled read deadline releases the UI, and retry cannot pile up native requests.
  await page.evaluate(()=>{
   const f=loadingFixture;f.slowReads=0;f.timers=[];
   const ui=ZETER_SECURITY_UI_UTILS.createSecurityCenterApp({document,collectSecuritySnapshot:async()=>{f.slowReads++;await new Promise(resolve=>f.finishSlow=resolve);return f.snapshot;},scheduleReadTimeout:cb=>{f.timers.push(cb);return cb;},clearReadTimeout:()=>{}});document.querySelector('.security-center-app').replaceWith(ui);
  });
  await page.waitForFunction(()=>loadingFixture.slowReads===1);await page.evaluate(()=>loadingFixture.timers.at(-1)());
  await page.waitForFunction(()=>document.querySelector('.security-center-app').getAttribute('aria-busy')==='false');assert.match(await app.locator('[data-security-operation]').textContent(),/долго|время/i);
  await app.locator('[data-security-refresh]').click();await page.waitForFunction(()=>document.querySelector('.security-center-app').getAttribute('aria-busy')==='false');assert.equal(await page.evaluate(()=>loadingFixture.slowReads),1,'retry does not start a second unresolved read');
  await page.evaluate(()=>loadingFixture.finishSlow());await app.locator('[data-security-refresh]').click();await page.waitForFunction(()=>loadingFixture.slowReads===2);await page.evaluate(()=>loadingFixture.finishSlow());await page.waitForFunction(()=>document.querySelector('.security-center-app').getAttribute('aria-busy')==='false');assert.doesNotMatch(await app.locator('[data-security-banner]').textContent(),/Статусы не обновлены/);
  await page.screenshot({path:path.join(out,'loaded.png')});assert.deepEqual(errors,[]);
  console.log('SECURITY_LOADING_UI_PASS: actions during initial read, lazy independent history/cleanup, dedup, read deadline/retry, no request pileup.');
 }finally{await browser?.close();await preview.close();}
}
module.exports={runSecurityLoadingSmoke};
