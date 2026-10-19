"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
async function runSecurityRecoverySmoke({chromium,startPreview,outputDir}) {
 const root=path.resolve(__dirname,'..'),out=outputDir||path.join(root,'work/security-recovery-qa');fs.mkdirSync(out,{recursive:true});
 const preview=await startPreview({root:path.join(root,'app'),allow:['index.html','js','css','assets','manifest.json','service-worker.js'],ttlSeconds:600});let browser;
 try{
  browser=await chromium.launch({headless:false,chromiumSandbox:true});const context=await browser.newContext({viewport:{width:1400,height:1100},serviceWorkers:'block'});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const seed=`const fixture=ZETER_INITIAL_STATE_UTILS.defaultState();fixture.firstRunCompleted=true;fixture.fs['local-note']={id:'local-note',type:'note',parent:'desktop',name:'Сегодняшняя заметка',content:'Сохранить сегодняшний текст',richContent:'<p>Сохранить сегодняшний текст</p>',x:10,y:10};localStorage.setItem('zeter_os_state_v3',JSON.stringify(fixture));`;
  await page.route('**/*',route=>{
   if(!route.request().url().startsWith(preview.url))return route.abort();
   if(new URL(route.request().url()).pathname==='/js/app.js'){
    let code=fs.readFileSync(path.join(root,'app/js/app.js'),'utf8');
    code=code.replace('transaction:operation=>primaryStateSaveQueue.transaction(operation)','transaction:operation=>primaryStateSaveQueue.transaction(write=>operation((...args)=>window.__failRecoveryWrite?Promise.reject(new Error("Тестовый отказ primary")):write(...args)))');
    const last=code.lastIndexOf('})();');code=code.slice(0,last)+`window.__securityTest={getState:()=>state,recovery:securityRecoveryController};\n`+code.slice(last);
    return route.fulfill({contentType:'application/javascript',body:seed+'\n'+code});
   }return route.continue();
  });
  await page.goto(preview.url);await page.waitForSelector('#boot',{state:'hidden'});await page.locator('[data-top-action="security"]').click();const app=page.locator('.security-center-app');await app.waitFor();
  await page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');await app.locator('[data-security-view="backups"]').click();
  const busyDone=()=>page.waitForFunction(()=>document.querySelector('.security-center-app')?.getAttribute('aria-busy')==='false');
  const before=await page.evaluate(()=>JSON.stringify(__securityTest.getState()));
  const b64=await page.evaluate(async()=>{
    const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;s.fs['restore-note']={id:'restore-note',type:'note',parent:'desktop',name:'Вернуть из архива',content:'Архивный текст',richContent:'<p>Архивный текст</p>',x:20,y:20};
    const entries=[{path:'zeter-os-state.json',blob:new Blob([JSON.stringify({app:'ZeTer OS',state:s})])}];const manifest=await ZETER_SECURITY_PROTECTION_UTILS.createBackupManifest(entries);entries.push({path:'zeter-backup-manifest.json',blob:new Blob([JSON.stringify(manifest)])});const zip=await ZETER_ASSET_UTILS.createZipBlob(entries);let raw='';for(const c of new Uint8Array(await zip.arrayBuffer()))raw+=String.fromCharCode(c);return btoa(raw);
  });
  const encryptedB64=await page.evaluate(async plain=>{
    const zip=new Blob([Uint8Array.from(atob(plain),c=>c.charCodeAt(0))],{type:'application/zip'});
    const encrypted=await ZETER_SECURITY_PROTECTION_UTILS.encryptBackupBlob(zip,'Тестовый пароль 123',{iterations:10000});
    let raw='';for(const c of new Uint8Array(await encrypted.arrayBuffer()))raw+=String.fromCharCode(c);return btoa(raw);
  },b64);
  const encryptedFile={name:'Проверенная копия.zeterbak',mimeType:'application/x-zeter-backup',buffer:Buffer.from(encryptedB64,'base64')};
  page.once('dialog',d=>d.accept('Неверный пароль'));
  await app.locator('[data-recovery-file]').setInputFiles(encryptedFile);await busyDone();
  assert.match(await app.locator('[data-recovery-status]').textContent(),/Не удалось расшифровать/);
  assert.equal(await page.evaluate(()=>JSON.stringify(__securityTest.getState())),before,'wrong password leaves live data unchanged');
  page.once('dialog',d=>d.accept('Тестовый пароль 123'));
  await app.locator('[data-recovery-file]').setInputFiles(encryptedFile);await busyDone();
  assert.match(await app.locator('[data-recovery-file-result]').textContent(),/Архив прочитан и проверен/);
  assert.equal(await page.evaluate(()=>JSON.stringify(__securityTest.getState())),before,'encrypted inspection is readonly');
  await app.locator('[data-recovery-file]').setInputFiles({name:'Проверенная копия.zip',mimeType:'application/zip',buffer:Buffer.from(b64,'base64')});await busyDone();
  assert.match(await app.locator('[data-recovery-file-result]').textContent(),/Архив прочитан и проверен/);
  assert.equal(await page.evaluate(()=>JSON.stringify(__securityTest.getState())),before,'inspection leaves current state byte-equivalent');
  await app.locator('[data-recovery-choice]').selectOption('item:desktop:restore-note');await app.locator('[data-recovery-action="compare"]').click();await busyDone();
  assert.match(await app.locator('[data-recovery-preview]').textContent(),/Вернуть из архива/);
  await page.screenshot({path:path.join(out,'preview.png')});
  for(const width of [560,304]){
    await page.setViewportSize({width:Math.max(width+16,320),height:1100});
    await page.locator('.window[data-app-id="security"]').evaluate((el,w)=>Object.assign(el.style,{width:w+'px',height:'950px',top:'8px',left:'8px'}),width);
    assert.equal(await app.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&[...el.querySelectorAll('[data-recovery-selective] select,[data-recovery-preview],[data-vault-interval],[data-vault-quota]')].filter(n=>n.getClientRects().length).every(n=>{const a=el.getBoundingClientRect(),b=n.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.right+1;})),true,'loaded recovery fits '+width);
    await app.locator('[data-recovery-preview]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'preview-'+width+'.png')});
  }
  await page.setViewportSize({width:1400,height:1100});
  await page.locator('.window[data-app-id="security"]').evaluate(el=>Object.assign(el.style,{width:'1384px',height:'950px',top:'8px',left:'8px'}));
  await app.locator('[data-recovery-action="apply"]').click();await busyDone();
  assert.match(await app.locator('[data-recovery-status]').textContent(),/Данные изменились после сравнения/,'resizing persisted window sessions invalidates stale comparison');
  await app.locator('[data-recovery-action="compare"]').click();await busyDone();
  await page.evaluate(()=>window.__failRecoveryWrite=true);page.once('dialog',d=>d.accept());await app.locator('[data-recovery-action="apply"]').click();await busyDone();
  assert.match(await app.locator('[data-recovery-status]').textContent(),/Тестовый отказ primary/);
  assert.equal(await page.evaluate(()=>Object.values(__securityTest.getState().fs).some(f=>f.content==='Архивный текст')),false);
  assert.equal(await page.evaluate(()=>__securityTest.getState().fs['local-note'].content),'Сохранить сегодняшний текст');
  await page.evaluate(()=>window.__failRecoveryWrite=false);page.once('dialog',d=>d.accept());await app.locator('[data-recovery-action="apply"]').click();await busyDone();
  assert.match(await app.locator('[data-recovery-status]').textContent(),/Восстановление завершено/);
  assert.equal(await page.evaluate(()=>Object.values(__securityTest.getState().fs).filter(f=>f.content==='Архивный текст').length),1);
  assert.equal(await page.evaluate(()=>__securityTest.getState().fs['local-note'].content),'Сохранить сегодняшний текст');
  await page.reload();await page.waitForSelector('#boot',{state:'hidden'});
  assert.equal(await page.evaluate(()=>Object.values(__securityTest.getState().fs).filter(f=>f.content==='Архивный текст').length),1,'confirmed recovery survives reload');
  // Native FULL archive payload path convention is checked without touching native data.
  const nativeSummary=await page.evaluate(async()=>{
    const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.fs['portable-file']={id:'portable-file',type:'managedFile',parent:'desktop',name:'Файл.bin',managedFile:{managedPath:'Файлы ZeTer OS/Файл.bin',name:'Файл.bin',size:3}};
    const entries=[{path:'zeter-os-state.json',blob:new Blob([JSON.stringify({state:s})])},{path:'data/Файлы ZeTer OS/Файл.bin',blob:new Blob(['abc'])}];const manifest=await ZETER_SECURITY_PROTECTION_UTILS.createBackupManifest(entries);entries.push({path:'zeter-backup-manifest.json',blob:new Blob([JSON.stringify(manifest)])});const zip=await ZETER_ASSET_UTILS.createZipBlob(entries);
    const result=await __securityTest.recovery.inspect(new File([zip],'native-full.zip',{type:'application/zip'}));return result.payloadCount;
  });assert.equal(nativeSummary,1);
  assert.deepEqual(errors,[]);
  console.log('SECURITY_RECOVERY_UI_PASS: ZIP/encrypted inspection readonly+hash, wrong/correct password, copy preview, refused write preserves live, retry/ACK/reload, native data/ payload convention');
 }finally{await browser?.close();await preview.close();}
}
module.exports={runSecurityRecoverySmoke};
