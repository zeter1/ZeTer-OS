"use strict";
// Explicit isolated browser regressions. No app/native data, SW or external network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
async function runSettingsEdgesSmoke({chromium,startPreview,outputDir}={}) {
  const root=path.resolve(__dirname,'..'),out=outputDir||path.join(root,'work/settings-bugs-qa');
  fs.mkdirSync(out,{recursive:true});
  const preview=await startPreview({root:path.join(root,'app'),allow:['index.html','js','css','assets','manifest.json','service-worker.js'],ttlSeconds:600});
  let browser;const failures=[],results=[];
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  const seed=`const visualOwner=window.ZETER_VISUAL_UTILS;
    window.__assetReleases={};window.__assetDone={};
    window.ZETER_VISUAL_UTILS={...visualOwner,createCustomWallpaperFromFile:async file=>{
      if(file.name.startsWith('hold-'))await new Promise(resolve=>{window.__assetReleases[file.name]=resolve;});
      if(file.name==='hold-bad.png'){window.__assetDone[file.name]=true;throw new Error('fixture неверное изображение');}
      const value=await visualOwner.createCustomWallpaperFromFile(file);window.__assetDone[file.name]=true;return value;
    }};
    const owner=window.ZETER_STORAGE_UTILS;
    window.ZETER_STORAGE_UTILS={...owner,createPrimaryStateSaveQueue:options=>{const q=owner.createPrimaryStateSaveQueue(options);return{...q,transaction:operation=>q.transaction(write=>operation(async(snapshot,opts)=>{
      if(window.__refusePreferences)throw new Error('fixture отказ записи');
      const result=await write(snapshot,opts);window.__edgeSaved=snapshot;return result;
    }))};}};
    if(!localStorage.getItem('settings-edge-fixture')){const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;s.desktops[0].name='Первый стол';localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('settings-edge-fixture','1');}`;
  try {
    browser=await chromium.launch({headless:false,chromiumSandbox:true});
    const run=async(name,check)=>{
      const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
      await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
      page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(preview.url))return route.abort();if(new URL(url).pathname==='/js/app.js')return route.fulfill({contentType:'application/javascript',body:seed+'\n'+fs.readFileSync(path.join(root,'app/js/app.js'),'utf8')});return route.continue();});
      try {
        await page.goto(preview.url);await page.locator('#boot').waitFor({state:'hidden'});await page.locator('[data-top-action="settings"]').click();
        const settings=page.locator('.settings').last();
        const settled=()=>page.waitForFunction(()=>['saved','fallback'].includes(document.querySelector('[data-settings-save-status]')?.dataset.saveState));
        const upload=async name=>{await settings.locator('[data-wall-file]').setInputFiles({name,mimeType:'image/png',buffer:png});if(name.startsWith('hold-'))await page.waitForFunction(name=>Boolean(window.__assetReleases[name]),name);else await settled();};
        const release=async name=>{await page.evaluate(name=>window.__assetReleases[name](),name);await page.waitForFunction(name=>window.__assetDone[name],name);};
        await check({page,settings,settled,upload,release});assert.deepEqual(errors,[],'no unhandled JS errors');
        results.push({name,status:'PASS'});console.log('PASS '+name);
      }catch(error){failures.push({name,message:error.message});results.push({name,status:'FAIL',message:error.message});await page.screenshot({path:path.join(out,name+'.png'),style:'.toast-stack{visibility:hidden}'});console.log('FAIL '+name+': '+error.message);}
      finally{await context.close();}
    };
    await run('late-upload-after-wallpaper-choice',async({page,settings,settled,upload,release})=>{
      await upload('hold-choice.png');await settings.locator('[data-wall="mint"]').click();
      await page.waitForFunction(()=>window.__edgeSaved?.desktops[0].data.settings.wallpaper==='mint');
      await release('hold-choice.png');await settled();
      assert.equal(await settings.locator('[data-wall="mint"]').getAttribute('aria-pressed'),'true','late decode must preserve the more recent wallpaper choice');
    });
    await run('late-upload-after-reset',async({settings,settled,upload,release})=>{
      await upload('hold-reset.png');await settings.locator('[data-settings-reset]').click();await settings.locator('[data-settings-reset-yes]').click();
      await release('hold-reset.png');await settled();
      assert.equal(await settings.locator('[data-wall="aurora"]').getAttribute('aria-pressed'),'true','late decode must preserve confirmed reset');
    });
    await run('reopened-view-after-cancelled-upload',async({page,settings,settled,upload,release})=>{
      await upload('existing.png');await upload('hold-cancel.png');
      await settings.locator('[data-wall-clear]').click();
      await settings.evaluate(el=>el.closest('.window').querySelector('[data-win="close"]').click());
      await page.waitForFunction(()=>!document.querySelector('.settings'));await page.locator('[data-top-action="settings"]').click();
      await release('hold-cancel.png');
      await page.waitForFunction(()=>window.__assetDone['hold-cancel.png']);
      assert.notEqual(await settings.locator('[data-settings-save-status]').getAttribute('data-save-state'),'processing','cancelled upload must not leave reopened view stuck processing');
      await settled();
    });
    await run('newer-upload-wins',async({page,settings,settled,upload,release})=>{
      await upload('hold-old.png');await upload('hold-new.png');await release('hold-new.png');
      await page.waitForFunction(()=>window.__edgeSaved?.desktops[0].data.settings.customWallpaper?.name==='hold-new.png');
      await release('hold-old.png');await settled();
      assert.equal(await page.evaluate(()=>window.__edgeSaved.desktops[0].data.settings.customWallpaper.name),'hold-new.png');
    });
    await run('reopened-view-after-rejected-upload',async({page,settings,upload,release})=>{
      await upload('hold-bad.png');
      await settings.evaluate(el=>el.closest('.window').querySelector('[data-win="close"]').click());
      await page.waitForFunction(()=>!document.querySelector('.settings'));await page.locator('[data-top-action="settings"]').click();
      assert.equal(await settings.locator('[data-settings-save-status]').getAttribute('data-save-state'),'processing');
      await release('hold-bad.png');
      await page.waitForFunction(()=>document.querySelector('[data-settings-save-status]')?.dataset.saveState!=='processing');
      assert.equal(await settings.locator('[data-wall="custom"]').getAttribute('aria-pressed'),'false');
    });
    await run('discard-while-upload-pending',async({page,settings,upload,release,settled})=>{
      await page.evaluate(()=>{window.__refusePreferences=true;});await settings.locator('[data-settings-accent="violet"]').click();
      await page.waitForFunction(()=>document.querySelector('[data-settings-save-status]')?.dataset.saveState==='error');
      await upload('hold-discard.png');await settings.locator('[data-settings-discard]').click();
      await page.evaluate(()=>{window.__refusePreferences=false;});await release('hold-discard.png');
      assert.equal(await settings.locator('[data-wall="custom"]').getAttribute('aria-pressed'),'false','discard unsaved intent must also cancel pending image');
      assert.equal(await settings.locator('[data-settings-accent="blue"]').getAttribute('aria-pressed'),'true');
    });
    await run('clear-hotkey-stops-capture',async({page,settings,settled})=>{
      await settings.locator('[data-settings-section="hotkeys"]').click();
      await settings.locator('[data-hotkey-capture="search"]').click();
      await settings.locator('[data-hotkey-clear="search"]').click();await settled();
      assert.equal(await settings.locator('[data-hotkey-capture="search"]').evaluate(el=>el.classList.contains('capturing')),false,'clearing a shortcut must end capture');
      await settings.locator('[data-settings-search]').fill('часы');
      await settings.locator('[data-settings-search]').press('Control+KeyA');
      assert.equal(await page.evaluate(()=>window.__edgeSaved.systemSettings.hotkeys.search),'','typing after clear must not reassign the shortcut');
    });
    await run('reset-hotkeys-stops-capture',async({settings,settled})=>{
      await settings.locator('[data-settings-section="hotkeys"]').click();
      await settings.locator('[data-hotkey-capture="search"]').click();
      await settings.locator('[data-settings-reset]').click();await settings.locator('[data-settings-reset-yes]').click();await settled();
      assert.equal(await settings.locator('[data-hotkey-capture="search"]').evaluate(el=>el.classList.contains('capturing')),false,'confirmed reset must end capture');
    });
    await run('tab-leaves-hotkey-capture',async({page,settings})=>{
      await settings.locator('[data-settings-section="hotkeys"]').click();
      const capture=settings.locator('[data-hotkey-capture="search"]');await capture.click();await capture.press('Tab');
      assert.equal(await settings.locator('[data-hotkey-clear="search"]').evaluate(el=>el===document.activeElement),true,'Tab must leave capture and reach the next control');
      assert.equal(await capture.evaluate(el=>el.classList.contains('capturing')),false);
      await settings.locator('[data-settings-search]').click();await page.keyboard.type('test');
      assert.equal(await settings.locator('[data-settings-search]').inputValue(),'test');
    });
    await run('profile-icon-preview-after-upload',async({page,settings,settled})=>{
      await settings.locator('[data-desktop-icon-file]').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:png});await settled();
      assert.equal(await settings.locator('.desktop-profile-head img').count(),1,'new icon must be visible without reopening settings');
      assert.equal(await settings.locator('.desktop-profile-head img').getAttribute('src'),await page.evaluate(()=>window.__edgeSaved.desktops[0].icon.dataURL));
    });
    await run('profile-icon-preview-after-clear',async({page,settings,settled})=>{
      await settings.locator('[data-desktop-icon-file]').setInputFiles({name:'profile.png',mimeType:'image/png',buffer:png});await settled();
      await settings.evaluate(el=>el.closest('.window').querySelector('[data-win="close"]').click());
      await page.waitForFunction(()=>!document.querySelector('.settings'));await page.locator('[data-top-action="settings"]').click();
      assert.equal(await settings.locator('.desktop-profile-head img').count(),1);
      await settings.locator('[data-desktop-icon-clear]').click();await settled();
      assert.equal(await settings.locator('.desktop-profile-head img').count(),0,'cleared icon must disappear from current preview');
    });
    await run('profile-text-editing-keeps-words-and-caret',async({page,settings,settled})=>{
      const name=settings.locator('[data-desktop-name]');await name.fill('');await name.pressSequentially('Мой рабочий стол');await settled();
      assert.equal(await name.inputValue(),'Мой рабочий стол');
      await name.evaluate(el=>el.setSelectionRange(4,4));await name.pressSequentially('новый ');await settled();
      assert.equal(await name.inputValue(),'Мой новый рабочий стол');
      assert.equal(await name.evaluate(el=>el.selectionStart),10,'ACK must preserve editing caret');
      const description=settings.locator('[data-desktop-description]');await description.fill('Первая строка\nВторая строка');await settled();
      assert.equal(await page.evaluate(()=>window.__edgeSaved.desktops[0].description),'Первая строка\nВторая строка');
    });
    await run('profile-icon-refusal-and-discard',async({page,settings})=>{
      await page.evaluate(()=>{window.__refusePreferences=true;});
      await settings.locator('[data-desktop-icon-file]').setInputFiles({name:'unsaved.png',mimeType:'image/png',buffer:png});
      await page.waitForFunction(()=>document.querySelector('[data-settings-save-status]')?.dataset.saveState==='error');
      assert.equal(await settings.locator('.desktop-profile-head img').count(),1,'refused draft remains visible for retry');
      await settings.locator('[data-settings-discard]').click();
      assert.equal(await settings.locator('.desktop-profile-head img').count(),0,'discard restores saved default icon');
      await page.reload();await page.locator('#boot').waitFor({state:'hidden'});
      if(!await settings.count())await page.locator('[data-top-action="settings"]').click();
      assert.equal(await settings.locator('.desktop-profile-head img').count(),0,'refused image must not reach persisted state after reload');
    });
    await run('hotkey-assign-then-cancel-by-focus',async({page,settings,settled})=>{
      await settings.locator('[data-settings-section="hotkeys"]').click();
      const capture=settings.locator('[data-hotkey-capture="search"]');await capture.click();await capture.press('Control+Alt+KeyY');await settled();
      assert.equal(await page.evaluate(()=>window.__edgeSaved.systemSettings.hotkeys.search),'Ctrl+Alt+Y','normal capture still saves the new combination');
      await capture.click();await settings.locator('[data-settings-search]').click();await page.keyboard.type('clock');
      assert.equal(await settings.locator('[data-settings-search]').inputValue(),'clock','leaving capture by mouse restores normal text input');
      assert.equal(await capture.evaluate(el=>el.classList.contains('capturing')),false);
      assert.equal(await page.evaluate(()=>window.__edgeSaved.systemSettings.hotkeys.search),'Ctrl+Alt+Y');
    });
    fs.writeFileSync(path.join(out,'edge-results.json'),JSON.stringify(results,null,2));
    assert.deepEqual(failures,[],'settings edge regressions');return{out,results};
  }finally{await browser?.close();await preview.close();}
}
module.exports={runSettingsEdgesSmoke};
