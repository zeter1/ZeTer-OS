"use strict";

// Explicit browser acceptance only: fresh profile, public-only preview, synthetic state.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

async function runSearchUpgradeSmoke({chromium,startPreview,outputDir}={}) {
  const root=path.resolve(__dirname,".."), out=outputDir||path.join(root,"work/search-upgrade-qa");
  fs.mkdirSync(out,{recursive:true});
  const preview=await startPreview({root:path.join(root,"app"),allow:["index.html","js","css","assets","manifest.json"],ttlSeconds:900});
  const checks=[],errors=[];let browser,page;
  try {
    browser=await chromium.launch({headless:false,chromiumSandbox:true});
    const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:"block"});
    await context.addInitScript(()=>{window.__ZETER_UI_PREVIEW__=true;Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__searchCopied=text;}}});});
    page=await context.newPage();page.setDefaultTimeout(6000);page.on("pageerror",error=>errors.push(error.message));
    const seed=`
      const storage=window.ZETER_STORAGE_UTILS;
      window.__pendingSearchWrites=0;
      window.ZETER_STORAGE_UTILS={...storage,createPrimaryStateSaveQueue:options=>storage.createPrimaryStateSaveQueue({...options,
        writePrimaryRecord:async snapshot=>{window.__pendingSearchWrites++;try{
          if(window.__holdSearchWrite) await new Promise(resolve=>{window.__releaseSearchWrite=resolve;});
          if(window.__refuseSearchWrite) throw new Error('Synthetic write refusal');
          const saved=await options.writePrimaryRecord(snapshot);window.__searchSaved=snapshot;return saved;
        }finally{window.__pendingSearchWrites--;}}
        ,saveFallback:snapshot=>window.__refuseSearchWrite?false:options.saveFallback(snapshot)
      })};
      if(!localStorage.getItem('search-upgrade-fixture')){
        const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;
        const at=Date.now()-7200000;
        const ws=ZETER_WORKSPACE_UTILS.workspaceDefaults();
        ws.taskProjects=[{id:'shared-project',name:'Орбита проект',description:'Разработка сайта',createdAt:at,updatedAt:at}];ws.activeTaskProjectId='shared-project';
        ws.tasks=[{id:'shared-task',title:'Орбита задача',description:'Проверить новую панель',projectId:'shared-project',status:'todo',priority:'normal',indefinite:true,checklist:[],createdAt:at,updatedAt:at}];
        ws.events=[{id:'search-event',title:'Орбита встреча',description:'Обсудить запуск',date:'2026-10-22',start:'12:00',end:'13:00',category:'work',repeat:'none',reminder:'0'}];
        ws.library={categories:[],entries:[{id:'search-link',name:'Орбита справочник',target:'https://example.test/orbita',description:'Полезные материалы',kind:'url',categoryId:'',favorite:false,createdAt:at,updatedAt:at}]};
        ws.promptLibrary={projects:[{id:'prompt-project',name:'Орбита промпты'}],categories:[],entries:[{id:'search-prompt',name:'Орбита ревью',projectId:'prompt-project',categoryId:'',text:'Точный текст\\n<script>window.__searchEvil=1</script>',favorite:false,createdAt:at,updatedAt:at}]};
        ws.timeTracking={entries:[{id:'search-time',title:'Орбита занятие',notes:'Планирование интерфейса',projectId:'shared-project',projectName:'Орбита проект',taskId:'shared-task',createdAt:at,finishedAt:at+3600000,runningSince:null,segments:[{start:at,end:at+3600000}],manual:true}],active:null,dailyGoalMinutes:0};
        s.desktops[0].data=ws;
        const other=ZETER_WORKSPACE_UTILS.workspaceDefaults();other.taskProjects=[{id:'shared-project',name:'Другой проект'}];other.activeTaskProjectId='shared-project';
        other.tasks=[{id:'shared-task',title:'Орбита чужая задача',projectId:'shared-project',status:'todo',priority:'normal',indefinite:true,checklist:[],createdAt:at,updatedAt:at}];
        other.events=[{id:'search-event',title:'Отложенное событие',date:'2026-10-24',start:'10:00',end:'11:00',category:'work',repeat:'none',reminder:'0'}];
        s.desktops.push({id:'search-other',name:'Другой стол',data:other});
        const add=(id,type,name,parent='desktop',extra={})=>s.fs[id]={id,type,name,parent,x:32,y:32,createdAt:at,updatedAt:at,...extra};
        add('search-folder','folder','Орбита папка <важное>','desktop',{appearance:{color:'#4f8fe8'}});
        add('search-image','folder','Орбита картинка','desktop',{appearance:{icon:{dataURL:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='}}});
        add('search-photo','image','Орбита фото','desktop',{dataURL:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='});
        add('search-note','note','Орбита заметка','search-folder',{content:'Ежик и Ёлка, уникальная глубина, кавычки "важно"',richContent:''});
        add('search-long','note','Орбита '+'ДлинноеИмя'.repeat(35),'desktop',{content:'ДлиннаяСтрока'.repeat(100),richContent:''});
        add('search-table','table','Орбита таблица','desktop',{table:{pages:[{id:'page1',name:'План',rows:[['Товар','Цена'],['Книга','10']]}],activePage:0}});
        add('search-other-note','note','Орбита чужой материал','search-other',{content:'Другой стол'});
        add('search-race-note','note','Отложенная заметка','search-other',{content:'Не открывать после удаления'});
        add('restored-folder','folder','Прежняя папка','desktop',{deletedAt:0});
        add('restored-note','note','Прежняя заметка','restored-folder',{deletedAt:0,content:'Прежний активный формат'});
        add('search-deleted','note','Орбита удалено','desktop',{deletedAt:at});
        for(let i=0;i<20;i++)add('search-many-'+i,'folder','Орбита каталог '+i);
        localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('search-upgrade-fixture','1');
      }
    `;
    await page.route("**/*",route=>{
      const url=route.request().url();if(!url.startsWith(preview.url))return route.abort();
      if(new URL(url).pathname==='/js/app.js'){
        let source=fs.readFileSync(path.join(root,'app/js/app.js'),'utf8');
        const navStart=source.indexOf('  const searchResultNavigator = createSearchResultNavigator({'),navEnd=source.indexOf('  const globalSearchOverlay =',navStart);
        source=source.slice(0,navStart)+source.slice(navStart,navEnd).replace('schedule: callback => setTimeout(callback, 0)','schedule: callback => {if(window.__holdSearchNavigation)window.__releaseSearchNavigation=callback;else setTimeout(callback,0);}')+source.slice(navEnd);
        source=source.replace('  function renderSearchApp()',`  window.__searchUpgrade={state:()=>state,controller:searchController,save:saveState,transaction:persistSearchAwareTransaction,revision:()=>searchRevision,bump:()=>{searchRevision++;},action:runSearchResultAction,switchDesktop:switchVirtualDesktop,renameDesktop:id=>startDesktopAction('rename',id),deleteFile:deleteItem,openEditor:id=>{closeFloating();return openApp("editor",{itemId:id});},openTime:()=>{closeFloating();return openApp("timetracking");},windows:()=>[...ui.windows.values()].map(r=>({appId:r.appId,desktopId:r.desktopId}))};\n  function renderSearchApp()`);
        return route.fulfill({contentType:'application/javascript',body:seed+'\n'+source});
      }return route.continue();
    });
    await page.goto(preview.url);await page.locator('#boot').waitFor({state:'hidden'});
    const overlay=page.locator('#global-search'),field=page.locator('#global-search-field'),pane=page.locator('#global-search-results');
    const list=()=>pane.locator('.search-result-list');
    const row=(id,desktop)=>list().locator(`button[data-search-kind][data-id="${id}"]${desktop?`[data-desktop-id="${desktop}"]`:''}`);
    const open=async query=>{if(!await overlay.isVisible())await page.locator('[data-top-action="search"]').click();await field.fill(query);};
    const idle=()=>page.waitForFunction(()=>!window.__pendingSearchWrites);
    const previewAction=(action)=>pane.locator(`.search-preview [data-search-action="${action}"]:visible`).first();
    async function check(name,action){try{await action();checks.push({name,status:'PASS'});}catch(error){checks.push({name,status:'FAIL',error:error.message});await page.screenshot({path:path.join(out,name+'-fail.png')});}finally{await page.evaluate(()=>{window.__refuseSearchWrite=false;window.__holdSearchWrite=false;window.__releaseSearchWrite?.();});} }
    await check('all-types-and-groups',async()=>{
      await open('Орбита');
      for(const id of ['search-folder','search-note','shared-task','search-event','search-link','search-prompt','search-time','shared-project'])assert.ok(await row(id,'desktop').count(),id);
      assert.equal(await row('search-other-note').count(),0);assert.equal(await row('search-deleted').count(),0);
      assert.equal(await row('search-folder').locator('i svg').count(),1);assert.doesNotMatch(await list().innerText(),/<svg|viewBox|item-custom-icon/);
      assert.equal(await row('search-image').locator('i img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
      const keys=await list().locator('[data-search-key][data-search-kind]').evaluateAll(els=>els.map(el=>el.dataset.searchKey));assert.equal(new Set(keys).size,keys.length);
      assert.ok(await pane.locator('.search-section-head h3').count()>3);
    });
    await check('preview-escaped-and-single-selection',async()=>{
      const before=await page.locator('.window').count();await row('search-prompt').click();
      assert.equal(await page.locator('.window').count(),before);assert.match(await pane.locator('.search-preview').innerText(),/<script>/);
      assert.equal(await page.evaluate(()=>window.__searchEvil),undefined);assert.equal(await pane.locator('.search-preview script').count(),0);
    });
    await check('content-yo-and-safe-highlight',async()=>{
      await open('елка');assert.ok(await row('search-note').count());assert.match(await row('search-note').locator('.search-snippet').innerHTML(),/<mark[^>]*>Ёлка<\/mark>/);
      await field.fill('глубина');assert.ok(await row('search-note').count());
      const html=await page.evaluate(()=>ZETER_SEARCH_UTILS.highlightSearchText('" & <','quot'));assert.equal(html,'&quot; &amp; &lt;');
    });
    await check('scope-and-id-collisions',async()=>{
      await open('Орбита');await pane.locator('[data-search-scope="all"]').click();await idle();
      assert.ok(await row('search-other-note').count());assert.equal(await row('shared-task').count(),2);
      await pane.locator('[data-search-scope="current"]').click();await idle();assert.equal(await row('shared-task').count(),1);
    });
    const filters=async()=>{const details=pane.locator('details.search-refine');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();};
    await check('type-project-date-and-reset',async()=>{
      await open('Орбита');await filters();await pane.locator('[data-search-filter="prompts"]').click();await idle();assert.equal(await row('search-note').count(),0);assert.equal(await row('search-prompt').count(),1);
      await pane.locator('[data-search-reset]').first().click();await idle();await filters();
      const project=await pane.locator('[data-search-setting="projectId"] option').evaluateAll(els=>els.find(el=>el.textContent.includes('Орбита проект'))?.value);
      assert.ok(project);await pane.locator('[data-search-setting="projectId"]').selectOption(project);await idle();assert.ok(await row('shared-task').count());assert.equal(await row('search-prompt').count(),0);
      await pane.locator('[data-search-setting="dateFrom"]').fill('2099-01-01');await idle();assert.equal(await list().locator('[data-search-kind]').count(),0);
      await pane.locator('[data-search-reset]').first().click();await idle();assert.ok(await row('search-note').count());
      const details=pane.locator('details.search-refine');if(await details.evaluate(el=>el.open))await details.locator('summary').click();
    });
    await check('layout-and-typo-corrections',async()=>{
      await open('pfvtnrf');assert.ok(await row('search-note').count());assert.ok(await pane.locator('.search-suggestion').isVisible());assert.equal(await field.inputValue(),'pfvtnrf');
      await field.fill('заметкв');assert.ok(await row('search-note').count());assert.ok(await pane.locator('.search-suggestion').isVisible());
      await field.fill('Орбита заметка');assert.equal(await pane.locator('.search-suggestion').count(),0);
    });
    await check('start-ignores-invisible-project-and-date-filters',async()=>{
      await open('Орбита');await filters();
      const project=await pane.locator('[data-search-setting="projectId"] option').evaluateAll(els=>els.find(el=>el.textContent.includes('Орбита проект'))?.value);
      await pane.locator('[data-search-setting="projectId"]').selectOption(project);await pane.locator('[data-search-setting="dateFrom"]').fill('2099-01-01');await idle();
      await page.locator('#global-search-close').click();await page.locator('#start-button').click();await page.locator('#start-search-input').fill('Орбита заметка');
      assert.equal(await page.locator('#start-menu [data-id="search-note"]').count(),1,'Start has no visible project/date restrictions');
      await open('Орбита');await filters();await pane.locator('[data-search-reset]').first().click();await idle();
    });
    await check('project-filter-after-desktop-switch-and-delete',async()=>{
      await open('Орбита');await filters();
      const project=await pane.locator('[data-search-setting="projectId"] option').evaluateAll(els=>els.find(el=>el.textContent.includes('Орбита проект'))?.value);
      await pane.locator('[data-search-setting="projectId"]').selectOption(project);await idle();
      await page.evaluate(()=>__searchUpgrade.switchDesktop('search-other'));
      await open('Орбита чужой материал');assert.equal(await row('search-other-note').count(),1);assert.equal(await page.evaluate(()=>__searchUpgrade.state().searchSettings.projectId),'');
      await page.evaluate(()=>__searchUpgrade.switchDesktop('desktop'));
      await open('Орбита');await filters();await pane.locator('[data-search-setting="projectId"]').selectOption(project);await idle();
      await page.evaluate(()=>{const s=__searchUpgrade.state();s.desktops[0].data.taskProjects.push({id:'temporary-project',name:'Временный проект'});__searchUpgrade.bump();});
      await field.fill('Временный проект');await filters();
      const temporary=await pane.locator('[data-search-setting="projectId"] option').evaluateAll(els=>els.find(el=>el.textContent.includes('Временный проект'))?.value);
      await pane.locator('[data-search-setting="projectId"]').selectOption(temporary);await idle();
      await page.evaluate(()=>{__searchUpgrade.state().desktops[0].data.taskProjects=__searchUpgrade.state().desktops[0].data.taskProjects.filter(p=>p.id!=='temporary-project');__searchUpgrade.bump();});
      await field.fill('Орбита заметка');assert.equal(await row('search-note').count(),1);assert.equal(await page.evaluate(()=>__searchUpgrade.state().searchSettings.projectId),'');
    });
    await check('legacy-active-zero-marker-is-searchable',async()=>{
      await open('Прежняя');
      await field.fill('Прежняя заметка');assert.equal(await row('restored-note').count(),1);
      await field.fill('Прежняя папка');assert.equal(await row('restored-folder').count(),1);
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().fs['restored-note'].deletedAt),0);
    });
    await check('delayed-opening-cancels-stale-target',async()=>{
      await open('Отложенная заметка');await pane.locator('[data-search-scope="all"]').click();await idle();
      await page.evaluate(()=>{
        const result=__searchUpgrade.controller.results('Отложенная заметка')[0];window.__holdSearchNavigation=true;window.__delayedOpening='pending';
        __searchUpgrade.controller.openResultElement({dataset:{searchKind:result.kind,searchKey:result.key,id:result.id,desktopId:result.desktopId,query:'Отложенная заметка'}}).then(ok=>window.__delayedOpening=ok);
      });
      assert.equal(await page.evaluate(()=>window.__delayedOpening),'pending','History and success wait for the scheduled open');
      await page.evaluate(()=>{__searchUpgrade.switchDesktop('desktop');window.__holdSearchNavigation=false;window.__releaseSearchNavigation();});
      await page.waitForFunction(()=>window.__delayedOpening!=='pending');assert.equal(await page.evaluate(()=>window.__delayedOpening),false);
      await open('Отложенная заметка');
      await page.evaluate(()=>{
        const result=__searchUpgrade.controller.results('Отложенная заметка')[0];window.__holdSearchNavigation=true;window.__delayedOpening='pending';
        __searchUpgrade.controller.openResultElement({dataset:{searchKind:result.kind,searchKey:result.key,id:result.id,desktopId:result.desktopId,query:'Отложенная заметка'}}).then(ok=>window.__delayedOpening=ok);
        const item=__searchUpgrade.state().fs['search-race-note'];item.deletedAt=1;item.parent='trash';window.__holdSearchNavigation=false;window.__releaseSearchNavigation();
      });
      await page.waitForFunction(()=>window.__delayedOpening!=='pending');assert.equal(await page.evaluate(()=>window.__delayedOpening),false);
      assert.ok(await page.locator('.window input.editor-title').evaluateAll(els=>els.every(el=>el.value!=='Отложенная заметка')));
      assert.equal(await page.evaluate(()=>Boolean(__searchUpgrade.state().searchSettings.history?.some(h=>h.query==='Отложенная заметка'))),false);
      await page.evaluate(()=>{__searchUpgrade.switchDesktop('desktop');__searchUpgrade.bump();});await open('Орбита');await pane.locator('[data-search-scope="current"]').click();await idle();
    });
    await check('delayed-calendar-with-colliding-id-cancels-on-switch',async()=>{
      await open('Отложенное событие');await pane.locator('[data-search-scope="all"]').click();await idle();
      await page.evaluate(()=>{
        const result=__searchUpgrade.controller.results('Отложенное событие')[0];window.__holdSearchNavigation=true;window.__delayedCalendar='pending';
        __searchUpgrade.controller.openResultElement({dataset:{searchKind:result.kind,searchKey:result.key,id:result.id,desktopId:result.desktopId,query:'Отложенное событие'}}).then(ok=>window.__delayedCalendar=ok);
      });
      assert.equal(await page.evaluate(()=>window.__delayedCalendar),'pending');
      await page.evaluate(()=>{__searchUpgrade.switchDesktop('desktop');window.__holdSearchNavigation=false;window.__releaseSearchNavigation();});
      await page.waitForFunction(()=>window.__delayedCalendar!=='pending');assert.equal(await page.evaluate(()=>window.__delayedCalendar),false);
      assert.equal(await page.evaluate(()=>__searchUpgrade.windows().filter(w=>w.appId==='calendar').length),0);
      await open('Орбита');await pane.locator('[data-search-scope="current"]').click();await idle();
    });
    await check('new-query-starts-at-top',async()=>{
      await open('Орбита');await list().evaluate(el=>{el.scrollTop=el.scrollHeight;});
      assert.ok(await list().evaluate(el=>el.scrollTop)>100);
      await field.fill('каталог');assert.equal(await list().evaluate(el=>el.scrollTop),0,'A new query must show its best result');
    });
    await check('find-photo-command-shows-images',async()=>{
      try {
        await open('Найти фото');await row('find-photo').dblclick();await idle();
        assert.equal(await field.inputValue(),'');assert.equal(await row('search-photo').count(),1,'Image command must show actual matching photos without requiring another query');
      } finally {await filters();await pane.locator('[data-search-reset]').first().click();await idle();}
    });
    await check('keyboard-enter-history-and-recents',async()=>{
      await open('глубина');await field.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement?.dataset.id),'search-note');
      await page.keyboard.press('Enter');await idle();assert.equal(await overlay.isVisible(),false);assert.ok(await page.locator('.window input.editor-title').evaluateAll(els=>els.some(el=>el.value==='Орбита заметка')));
      await open('');assert.ok(await pane.locator('[data-search-history="глубина"]').count());assert.ok(await row('search-note').count());
      await pane.locator('[data-search-clear="history"]').click();await idle();assert.equal(await pane.locator('[data-search-history="глубина"]').count(),0);
    });
    await check('reveal-selects-file',async()=>{
      await open('глубина');await row('search-note').click();await previewAction('reveal').click();
      assert.equal(await overlay.isVisible(),false);assert.ok(await page.locator('.window .file-card.selected[data-id="search-note"], .window [data-item-id="search-note"].selected').count());
    });
    await check('complete-refusal-then-retry',async()=>{
      await open('Орбита задача');await row('shared-task').click();
      await page.evaluate(()=>{window.__refuseSearchWrite=true;});await previewAction('complete').click();
      await page.waitForFunction(()=>/не выполнено|сохран/i.test(document.querySelector('#global-search-results .search-status')?.textContent||''));
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().desktops[0].data.tasks.find(t=>t.id==='shared-task').status),'todo');
      await page.evaluate(()=>{window.__refuseSearchWrite=false;});await previewAction('complete').click();
      await page.waitForFunction(()=>__searchUpgrade.state().desktops[0].data.tasks.find(t=>t.id==='shared-task').status==='done');await idle();
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().desktops.find(d=>d.id==='search-other').data.tasks[0].status),'todo');
    });
    await check('prompt-and-time-exact-open',async()=>{
      await open('Орбита ревью');await row('search-prompt').dblclick();await idle();assert.ok(await page.locator('[data-prompt-row="search-prompt"][aria-current="true"]').count());
      await open('Орбита занятие');await row('search-time').dblclick();await idle();assert.ok(await page.locator('[data-time-row="search-time"][aria-current="true"]').count());
    });
    await check('copy-exact-text-and-address',async()=>{
      await open('Орбита ревью');await row('search-prompt').click();await previewAction('copy').click();
      assert.equal(await page.evaluate(()=>window.__searchCopied),'Точный текст\n<script>window.__searchEvil=1</script>');
      await open('Орбита справочник');await row('search-link').click();await previewAction('copy').click();assert.equal(await page.evaluate(()=>window.__searchCopied),'https://example.test/orbita');
      await open('Орбита таблица');await row('search-table').click();await previewAction('copy').click();assert.match(await page.evaluate(()=>window.__searchCopied),/Книга.*10/);
    });
    await check('desktop-rename-invalidates-cache',async()=>{
      await open('Орбита');await idle();const before=await page.evaluate(()=>__searchUpgrade.revision());
      page.once('dialog',dialog=>dialog.accept('Основной обновлённый'));
      await page.evaluate(()=>__searchUpgrade.renameDesktop('desktop'));await idle();
      assert.ok(await page.evaluate(()=>__searchUpgrade.revision())>before,'Accepted rename must invalidate index');
      await field.fill('Основной обновлённый');assert.ok(await row('search-folder').count());
    });
    await check('open-task-calendar-project-app',async()=>{
      await open('Орбита задача');await row('shared-task').dblclick();await idle();assert.ok(await page.locator('[data-task-id="shared-task"]').count());
      await open('Орбита встреча');await row('search-event').dblclick();await idle();assert.ok(await page.locator('.window').filter({hasText:'Орбита встреча'}).count());
      await open('Орбита проект');await row('shared-project').dblclick();await idle();assert.equal(await page.evaluate(()=>__searchUpgrade.state().desktops[0].data.activeTaskProjectId),'shared-project');
      await open('Калькулятор');await row('calculator').dblclick();assert.ok(await page.locator('.window').filter({hasText:'Калькулятор'}).count());
    });
    await check('index-reuse-and-transaction-refresh',async()=>{
      await open('Орбита');await idle();await field.fill('Орбит');const before=await page.evaluate(()=>__searchUpgrade.controller.getStats());
      await field.fill('Орбита');const after=await page.evaluate(()=>__searchUpgrade.controller.getStats());assert.equal(after.normalizationCount,before.normalizationCount);
      await page.evaluate(async()=>{await __searchUpgrade.transaction(async write=>{const s=structuredClone(__searchUpgrade.state());s.desktops[0].data.promptLibrary.entries[0].name='Новое уникальное имя';const saved=await write(s);if(saved.saved)__searchUpgrade.state().desktops[0].data.promptLibrary.entries[0].name='Новое уникальное имя';});});
      await field.fill('Новое уникальное имя');assert.equal(await row('search-prompt').count(),1);
      await page.evaluate(async()=>{delete __searchUpgrade.state().fs['search-note'];await __searchUpgrade.save({skipExternalBackup:true});});await field.fill('глубина');assert.equal(await row('search-note').count(),0);
    });
    await check('cross-desktop-open',async()=>{
      await open('Орбита чужой материал');await pane.locator('[data-search-scope="all"]').click();await idle();await row('search-other-note').dblclick();await idle();
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().currentDesktop),'search-other');assert.ok(await page.locator('.window input.editor-title').evaluateAll(els=>els.some(el=>el.value==='Орбита чужой материал')));
      await page.evaluate(async()=>{__searchUpgrade.switchDesktop('desktop');await __searchUpgrade.save();});
      // A real desktop switch restores its windows and state aliases.
      await page.reload();await page.locator('#boot').waitFor({state:'hidden'});
    });
    for(const [width,height]of [[1440,1000],[760,800],[390,800],[320,640],[760,320]])await check('layout-'+width+'x'+height,async()=>{
      await page.setViewportSize({width,height});await open('Орбита');
      const box=await overlay.boundingBox(),scroll=await page.evaluate(()=>({html:[document.scrollingElement.scrollLeft,document.scrollingElement.scrollTop],os:[document.querySelector('#os').scrollLeft,document.querySelector('#os').scrollTop]}));assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=height+1,JSON.stringify({box,scroll}));
      const metrics=await pane.evaluate(el=>({sw:el.scrollWidth,w:el.clientWidth,list:el.querySelector('.search-result-list')&&{sw:el.querySelector('.search-result-list').scrollWidth,w:el.querySelector('.search-result-list').clientWidth,h:el.querySelector('.search-result-list').clientHeight}}));
      assert.ok(metrics.sw<=metrics.w+1,JSON.stringify(metrics));assert.ok(metrics.list&&metrics.list.h>20&&metrics.list.sw<=metrics.list.w+1,JSON.stringify(metrics));
      assert.equal(await page.locator('.search-result button').count(),0);
      if(width<=390){await list().locator('[data-search-kind]').first().click();assert.ok(await pane.locator('.search-inline-preview:visible').count());}
      await page.screenshot({path:path.join(out,'search-'+width+'x'+height+'.png')});
    });
    await check('history-survives-reload-and-clear',async()=>{
      await page.setViewportSize({width:1440,height:1000});await open('Орбита таблица');await row('search-table').dblclick();await idle();
      await page.reload();await page.locator('#boot').waitFor({state:'hidden'});await open('');
      assert.ok(await pane.locator('[data-search-history="Орбита таблица"]').count());assert.ok(await row('search-table').count());
      await pane.locator('[data-search-clear="recent"]').click();await idle();assert.equal(await row('search-table').count(),0);
      await pane.locator('[data-search-clear="history"]').click();await idle();assert.equal(await pane.locator('[data-search-history]').count(),0);
    });
    await check('queued-reset-preserves-newer-type-choice',async()=>{
      await open('Орбита таблица');await row('search-table').dblclick();await idle();
      await open('');await idle();await page.evaluate(()=>{window.__holdSearchWrite=true;});
      await pane.locator('[data-search-clear="history"]').click();await page.waitForFunction(()=>window.__pendingSearchWrites>0);
      await filters();await pane.locator('[data-search-reset]').first().click();await pane.locator('[data-search-filter="tasks"]').click();
      assert.deepEqual(await page.evaluate(()=>__searchUpgrade.state().searchSettings.filters),['tasks']);
      await page.evaluate(()=>{window.__holdSearchWrite=false;window.__releaseSearchWrite();});await idle();
      await page.waitForFunction(()=>window.__searchSaved.searchSettings.filters.length===1&&window.__searchSaved.searchSettings.filters[0]==='tasks');
      assert.deepEqual(await page.evaluate(()=>__searchUpgrade.state().searchSettings.filters),['tasks']);
      await pane.locator('[data-search-reset]').first().click();await idle();
    });
    await check('two-refused-filter-edits-restore-confirmed-choice',async()=>{
      await open('Орбита');await idle();
      await page.evaluate(()=>__searchUpgrade.controller.setFilters(['notes']));
      await page.evaluate(()=>{window.__holdSearchWrite=true;window.__refuseSearchWrite=true;window.__firstRejectedFilter=__searchUpgrade.controller.setFilters(['tasks']);});
      await page.waitForFunction(()=>window.__pendingSearchWrites>0);
      await page.evaluate(()=>{window.__secondRejectedFilter=__searchUpgrade.controller.setFilters(['images']);window.__holdSearchWrite=false;window.__releaseSearchWrite();});
      const responses=await page.evaluate(()=>Promise.all([window.__firstRejectedFilter,window.__secondRejectedFilter]));assert.deepEqual(responses,[false,false]);
      assert.deepEqual(await page.evaluate(()=>__searchUpgrade.state().searchSettings.filters),['notes']);
      assert.equal(await pane.locator('[data-search-filter="notes"]').getAttribute('aria-pressed'),'true');
      await page.evaluate(()=>{window.__refuseSearchWrite=false;return __searchUpgrade.controller.setFilters(['tasks']);});await idle();
      assert.deepEqual(await page.evaluate(()=>window.__searchSaved.searchSettings.filters),['tasks']);
      await filters();await pane.locator('[data-search-reset]').first().click();await idle();
    });
    await check('standalone-search-and-large-text-contrast',async()=>{
      await page.evaluate(()=>{const el=__searchUpgrade.controller.createApp();el.id='standalone-search-upgrade';el.style.cssText='position:fixed;inset:40px 20px;z-index:9999;background:var(--glass);padding:16px';document.body.append(el);});
      const app=page.locator('#standalone-search-upgrade');await app.locator('input').first().fill('Орбита');assert.ok(await app.locator('.search-pane .search-result').count());
      await app.locator('input').first().press('ArrowDown');assert.ok(await page.evaluate(()=>document.activeElement?.closest('#standalone-search-upgrade')));
      await app.evaluate(el=>el.remove());await open('Орбита');
      await page.evaluate(()=>{document.documentElement.style.setProperty('--zeter-text-scale','1.5');document.body.classList.add('zeter-high-contrast');});await page.setViewportSize({width:390,height:800});
      await field.fill('Орбит');const box=await overlay.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);assert.ok(await list().locator('[data-search-kind]').count());
      await page.screenshot({path:path.join(out,'search-contrast-large-text.png')});
      await page.evaluate(()=>{document.documentElement.style.removeProperty('--zeter-text-scale');document.body.classList.remove('zeter-high-contrast');});
    });
    await check('taskbar-escape-and-start',async()=>{
      await page.setViewportSize({width:1440,height:1000});await page.locator('#global-search-close').click();
      await page.locator('#taskbar-search-field').fill('Орбита');assert.equal(await field.inputValue(),'Орбита');assert.equal(await overlay.getAttribute('data-search-placement'),'bottom');
      await page.locator('#taskbar-search-field').press('ArrowDown');assert.ok(await page.evaluate(()=>document.activeElement?.matches('#global-search-results [data-search-kind]')));
      await page.keyboard.press('Escape');assert.equal(await overlay.isVisible(),false);
      await page.locator('#start-button').click();await page.locator('#start-search-input').fill('Орбита папка');assert.equal(await page.locator('#start-menu [data-id="search-folder"] i svg').count(),1);
    });
    await check('exact-seven-type-filters',async()=>{
      await open('Орбита');await filters();await pane.locator('[data-search-reset]').first().click();await idle();await filters();
      for(const type of ['files','folders','tasks','calendar','notes','tables','images']){await pane.locator(`[data-search-filter="${type}"]`).click();await idle();}
      const chosen=await page.evaluate(()=>__searchUpgrade.state().searchSettings.filters);
      assert.equal(chosen.length,7);assert.ok(!chosen.includes('projects'));
      await pane.locator('[data-search-reset]').first().click();await idle();
    });
    await check('recent-outside-500-result-limit',async()=>{
      await page.evaluate(()=>{
        const s=__searchUpgrade.state();for(let i=0;i<601;i++)s.fs['many-'+i]={id:'many-'+i,type:'note',parent:'desktop',name:'A indexed '+String(i).padStart(3,'0'),content:'',createdAt:1,updatedAt:1};
        s.fs['recent-beyond']={id:'recent-beyond',type:'note',parent:'desktop',name:'Z recently opened',content:'',createdAt:1,updatedAt:1};__searchUpgrade.bump();
        const result=__searchUpgrade.controller.results('Z recently opened')[0];s.searchSettings.recent=[{key:result.key,at:Date.now()}];
      });
      await open('');assert.equal(await row('recent-beyond').count(),1);
    });
    await check('project-open-cancelled-after-desktop-switch',async()=>{
      await open('Орбита проект');await idle();
      await page.evaluate(()=>{
        const result=__searchUpgrade.controller.results('Орбита проект').find(r=>r.kind==='project'&&r.projectType==='tasks');
        window.__holdSearchWrite=true;window.__projectOpenOutcome='pending';
        __searchUpgrade.action(result,'open').then(()=>window.__projectOpenOutcome='opened',error=>window.__projectOpenOutcome=error.message);
      });
      await page.waitForFunction(()=>window.__pendingSearchWrites>0);
      await page.evaluate(()=>{__searchUpgrade.switchDesktop('search-other');window.__holdSearchWrite=false;window.__releaseSearchWrite();});
      await page.waitForFunction(()=>window.__projectOpenOutcome!=='pending');await idle();
      assert.match(await page.evaluate(()=>window.__projectOpenOutcome),/отменено/);
      assert.equal(await page.evaluate(()=>__searchUpgrade.windows().filter(r=>r.desktopId==='search-other'&&r.appId==='tasks').length),0);
    });
    await check('filesystem-delete-cancel-refusal-retry-keeps-editor',async()=>{
      await page.evaluate(()=>{__searchUpgrade.switchDesktop('desktop');const s=__searchUpgrade.state();s.fs['delete-a']={id:'delete-a',type:'note',name:'Удаляемый черновик',content:'Текст редактора',parent:'desktop'};s.fs['delete-b']={id:'delete-b',type:'note',name:'До правки',parent:'desktop'};__searchUpgrade.bump();__searchUpgrade.openEditor('delete-a');});
      page.once('dialog',dialog=>dialog.dismiss());
      assert.equal(await page.evaluate(()=>__searchUpgrade.deleteFile('delete-a')),false);
      assert.equal(await page.evaluate(()=>!!__searchUpgrade.state().fs['delete-a']),true);
      page.once('dialog',dialog=>dialog.accept());
      await page.evaluate(()=>{window.__holdSearchWrite=true;window.__fileDelete='pending';__searchUpgrade.deleteFile('delete-a').then(value=>window.__fileDelete=value);});
      await page.waitForFunction(()=>window.__pendingSearchWrites>0);
      assert.equal(await page.evaluate(()=>!!__searchUpgrade.state().fs['delete-a']),true);
      assert.equal(await page.evaluate(()=>__searchUpgrade.windows().some(w=>w.appId==='editor')),true);
      await page.evaluate(()=>{__searchUpgrade.state().fs['delete-b'].name='Параллельная правка';window.__refuseSearchWrite=true;window.__holdSearchWrite=false;window.__releaseSearchWrite();});
      await page.waitForFunction(()=>window.__fileDelete!=='pending');assert.equal(await page.evaluate(()=>window.__fileDelete),false);
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().fs['delete-b'].name),'Параллельная правка');
      assert.equal(await page.evaluate(()=>!!__searchUpgrade.state().fs['delete-a']),true);
      await page.evaluate(()=>{window.__refuseSearchWrite=false;});page.once('dialog',dialog=>dialog.accept());
      assert.equal(await page.evaluate(()=>__searchUpgrade.deleteFile('delete-a')),true);await idle();
      assert.equal(await page.evaluate(()=>!!__searchUpgrade.state().fs['delete-a']),false);
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().fs['delete-b'].name),'Параллельная правка');
    });
    await check('time-delete-cancel-refusal-retry-without-trash',async()=>{
      await page.evaluate(()=>{const tracking=__searchUpgrade.state().desktops.find(d=>d.id==='desktop').data.timeTracking;const at=Date.now()-60000;const entry={id:'delete-time',title:'Удаляемая запись',createdAt:at,finishedAt:at+1000,segments:[{start:at,end:at+1000}],runningSince:null};tracking.entries.push(entry,{...entry,id:'legacy-time',deletedAt:1});__searchUpgrade.openTime();});
      const time=page.locator('.time-tracking-app:visible').last();const card=()=>time.locator('[data-time-row="delete-time"]');
      assert.equal(await time.locator('[data-time-action="trash"],[data-time-action="restore"],[data-time-action="purge-all"]').count(),0);
      assert.doesNotMatch(await time.innerText(),/Корзина|В корзину/);
      page.once('dialog',dialog=>dialog.dismiss());await card().locator('[data-time-action="delete"]').click();assert.equal(await card().count(),1);
      await page.evaluate(()=>{window.__refuseSearchWrite=true;});page.once('dialog',dialog=>dialog.accept());await card().locator('[data-time-action="delete"]').click();
      await page.waitForFunction(()=>document.querySelectorAll('.time-tracking-app .time-status.error').length>0);await idle();assert.equal(await card().count(),1);
      await page.evaluate(()=>{window.__refuseSearchWrite=false;});page.once('dialog',dialog=>dialog.accept());await card().locator('[data-time-action="delete"]').click();
      await page.waitForFunction(()=>!__searchUpgrade.state().desktops.find(d=>d.id==='desktop').data.timeTracking.entries.some(e=>e.id==='delete-time'));await idle();
      assert.equal(await card().count(),0);assert.equal(await time.locator('[data-time-row="legacy-time"]').count(),0);
      assert.equal(await page.evaluate(()=>__searchUpgrade.state().desktops.find(d=>d.id==='desktop').data.timeTracking.entries.find(e=>e.id==='legacy-time').deletedAt),1);
    });
    await check('obsolete-trash-code-not-loaded',async()=>{
      assert.equal(await page.evaluate(()=>typeof window.ZETER_TRASH_UTILS),'undefined');
      assert.equal(await page.locator('script[src*="trash-utils"]').count(),0);
      assert.equal(await page.evaluate(()=>__searchUpgrade.windows().filter(w=>w.appId==='recycle').length),0);
    });
  } finally {
    const fingerprints=Object.fromEntries(['app/js/core/search-utils.js','app/js/core/search-ui-utils.js','app/js/app.js','app/css/10-shell.css','app/js/core/deletion-utils.js','app/js/core/time-tracking-utils.js','app/js/core/time-tracking-ui-utils.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors,fingerprints},null,2));console.log(JSON.stringify({checks,errors},null,2));
    if(browser)await browser.close();await preview.close();
  }
  assert.equal(errors.length,0,'Browser JS errors');assert.ok(checks.every(c=>c.status==='PASS'),'Unified search browser checks failed');
}
module.exports={runSearchUpgradeSmoke};
