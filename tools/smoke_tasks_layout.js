"use strict";
// Browser regression over synthetic state only. A Playwright runner supplies the browser and scoped HTTP preview.
// Importing this module does not start a browser, server or application.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
async function runTasksLayoutSmoke({ chromium, startPreview, outputDir } = {}) {
  assert.ok(chromium && startPreview, "Supply chromium and the scoped startPreview helper from the Playwright runner");
  const ROOT = path.resolve(__dirname, ".."), OUT = outputDir || path.join(ROOT, "work", "tasks-fixes-qa");
  fs.mkdirSync(OUT, { recursive: true });
const preview=await startPreview({root:path.join(ROOT,'app'),allow:['index.html','js','css','assets','manifest.json','service-worker.js'],ttlSeconds:600});
let browser;
try {
 browser=await chromium.launch({headless:false,chromiumSandbox:true});
const ctx=await browser.newContext({viewport:{width:1920,height:1000},serviceWorkers:'block'}),page=await ctx.newPage(),errors=[];
await ctx.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
page.on('pageerror',e=>errors.push(e.message));
const seed=`const realStorage=window.ZETER_STORAGE_UTILS;window.ZETER_STORAGE_UTILS={...realStorage,createPrimaryStateSaveQueue:options=>{const queue=realStorage.createPrimaryStateSaveQueue(options);return {...queue,transaction:operation=>queue.transaction(write=>operation(async snapshot=>{if(window.__holdTaskWrite)await new Promise(resolve=>{window.__releaseTaskWrite=resolve;});if(window.__refuseTaskWrite)throw new Error('Тест: хранилище недоступно');const result=await write(snapshot);window.__lastTaskSaved=snapshot;return result;} ))};}};if(!localStorage.getItem('tasks-fix-fixture')){const s=ZETER_INITIAL_STATE_UTILS.defaultState();s.firstRunCompleted=true;const base={projectId:'p',priority:'medium',status:'todo',indefinite:true,createdAt:Date.now(),description:'',checklist:[]};const tasks=[{...base,id:'short1',title:'Короткая задача',tag:'Первый'},{...base,id:'short2',title:'Ещё задача',tag:'Первый'},{...base,id:'other',title:'Задача другого проекта',projectId:'q',tag:'Второй'}];const taskProjects=[{id:'p',name:'Две задачи'},{id:'empty',name:'Пустой проект'},{id:'q',name:'Другой проект'},{id:'many',name:'Длинные карточки'}].map(project=>({...project,defaultView:'list'}));for(let i=0;i<12;i++)tasks.push({...base,id:'long'+i,projectId:'many',status:['todo','doing','review','done'][i%4],title:'Длинная задача с названием и проверкой переноса слов '+i,description:'Описание работы, ожидаемого результата и условий проверки. '.repeat(4),tag:'Тест',checklist:[{id:'check'+i,text:'Длинный пункт проверки, который должен переноситься и не перекрывать другие карточки',done:false}]});s.desktops[0].data={...ZETER_WORKSPACE_UTILS.workspaceDefaults(),tasks,taskProjects,activeTaskProjectId:'p'};Object.assign(s,{tasks,taskProjects,activeTaskProjectId:'p'});localStorage.setItem('zeter_os_state_v3',JSON.stringify(s));localStorage.setItem('tasks-fix-fixture','1');}`;
await page.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(preview.url))return route.abort();if(new URL(url).pathname==='/js/app.js')return route.fulfill({contentType:'application/javascript',body:seed+'\n'+fs.readFileSync(path.join(ROOT,'app/js/app.js'),'utf8')});return route.continue();});
try{
 await page.goto(preview.url);await page.waitForSelector('#boot',{state:'hidden'});await page.locator('#taskbar [data-app="tasks"]').click();const app=page.locator('.tasks-app');await app.waitFor();
 await page.locator('.window[data-app-id="tasks"]').evaluate(el=>Object.assign(el.style,{width:'1870px',height:'850px',left:'20px',top:'20px'}));

 let nativeDialogs=0;page.on('dialog',async dialog=>{nativeDialogs++;await dialog.dismiss();});
 assert.equal((await app.locator('[data-project-add]').textContent()).trim(),'Создать проект');
 await app.locator('[data-project-add]').click();const projectDialog=page.locator('[data-task-project-dialog]'),nameInput=projectDialog.locator('input');
 await projectDialog.waitFor();assert.equal(await nameInput.evaluate(el=>el===document.activeElement),true);
 await nameInput.press('Shift+Tab');assert.equal(await projectDialog.locator('[type="submit"]').evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await nameInput.evaluate(el=>el===document.activeElement),true);
 await page.screenshot({path:OUT+'/project-dialog.png'});await page.setViewportSize({width:390,height:844});assert.ok(await projectDialog.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await page.screenshot({path:OUT+'/project-dialog-390.png'});await page.setViewportSize({width:1920,height:1000});
 await nameInput.fill('Черновик');await nameInput.press('Escape');await projectDialog.waitFor({state:'detached'});
 assert.equal(await app.locator('[data-project-add]').evaluate(el=>el===document.activeElement),true);
 await app.locator('[data-project-add]').click();await nameInput.fill('Учёба <проект>');
 await page.evaluate(()=>{window.__refuseTaskWrite=true;});await nameInput.press('Enter');
 await projectDialog.locator('[role="alert"]:not([hidden])').waitFor();assert.equal(await nameInput.inputValue(),'Учёба <проект>');
 assert.equal(await app.locator('.task-project-tab').count(),4,'failed creation must not add a project');
 await page.screenshot({path:OUT+'/project-dialog-error.png'});
 await page.evaluate(()=>{window.__refuseTaskWrite=false;});await nameInput.press('Enter');await projectDialog.waitFor({state:'detached'});
 await app.locator('[data-current-project-name]').filter({hasText:'Учёба <проект>'}).waitFor();
 assert.equal(nativeDialogs,0,'project creation must not use a browser prompt');
 await app.locator('[data-project-id="p"]').click();
 // Hold the actual primary transaction write; the UI must still switch twice.
 await page.evaluate(()=>{window.__holdTaskWrite=true;window.__releaseTaskWrite=null;});
 await app.locator('[data-project-id="q"]').click();await page.waitForFunction(()=>!!window.__releaseTaskWrite);
 await app.locator('[data-project-id="empty"]').click();
 assert.equal(await app.locator('[data-current-project-name]').textContent(),'Пустой проект','switching cannot await a held storage acknowledgement');
 await app.locator('[data-project-id="p"]').click();assert.equal(await app.locator('[data-current-project-name]').textContent(),'Две задачи');
 await page.evaluate(()=>{window.__holdTaskWrite=false;window.__releaseTaskWrite();});
 await app.locator('[data-project-view="list"]').click();
 const geom=await app.locator('.task-board').evaluate(board=>{const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};return {rows:getComputedStyle(board).gridTemplateRows,sections:[...board.querySelectorAll('.task-column')].map(col=>({status:col.dataset.status,...rect(col),cards:[...col.querySelectorAll('.task-card')].map(rect)})),cards:[...board.querySelectorAll('.task-card')].map(rect)}});
 console.log('LAYOUT_GEOMETRY',JSON.stringify(geom));
 await page.screenshot({path:OUT+'/list-two-tasks.png'});
 assert.ok(geom.sections.every((section,index)=>!index||section.top>=geom.sections[index-1].bottom-1),'status groups must not overlap: '+JSON.stringify(geom.sections));
 assert.ok(geom.sections[0].cards.at(-1).bottom<=geom.sections[0].bottom+1,'status group must contain every card; next section must not overlap');
 assert.equal(await app.locator('.task-column').count(),1,'list must omit empty statuses');
 assert.ok(geom.cards.every(card=>card.height<160),'short list tasks with visible actions must stay compact');
 await app.locator('[data-project-id="empty"]').click();await app.locator('[data-current-project-name]').filter({hasText:'Пустой проект'}).waitFor();
 assert.equal(await app.locator('.task-column').count(),0,'empty project must have one empty state, no empty status sections');
 await app.locator('[data-project-id="p"]').click();await app.locator('[data-current-project-name]').filter({hasText:'Две задачи'}).waitFor();
 await app.locator('[data-filter-tag]').selectOption('Первый');await app.locator('[data-project-id="q"]').click();await app.locator('[data-current-project-name]').filter({hasText:'Другой проект'}).waitFor();
 assert.equal(await app.locator('[data-filter-tag]').inputValue(),'all');assert.equal(await app.locator('.task-card').count(),1,'visible all-tags select must not leave an old hidden tag filter');
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.projectId),'q','project selection must retain keyboard focus');

 await app.locator('[data-project-id="p"]').click();await app.locator('[data-current-project-name]').filter({hasText:'Две задачи'}).waitFor();
 await app.locator('[data-task-id="short2"] [data-task-status]').selectOption('doing');await app.locator('.task-column[data-status="doing"] [data-task-id="short2"]').waitFor();
 async function checkGeometry(label){const result=await app.locator('.task-board').evaluate(board=>{const rect=el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}};const sections=[...board.querySelectorAll('.task-column')],issues=[];for(const col of sections){const outer=rect(col),head=rect(col.querySelector('h3'));for(const card of col.querySelectorAll('.task-card')){const r=rect(card);if(r.bottom>outer.bottom+1||r.top<head.bottom-1)issues.push({type:'card-outside-group',outer,card:r});}for(const other of sections){if(other===col)continue;const r=rect(other);if(Math.min(r.right,outer.right)-Math.max(r.left,outer.left)>1&&Math.min(r.bottom,outer.bottom)-Math.max(r.top,outer.top)>1)issues.push({type:'groups-overlap',outer,other:r});}}return {issues,horizontal:board.scrollWidth>board.clientWidth+1,count:sections.length};});assert.deepEqual(result.issues,[],label+': '+JSON.stringify(result));assert.equal(result.horizontal,false,label+' must not overflow horizontally');return result;}
 await checkGeometry('two populated statuses');
 async function checkActions(card,label){
  assert.equal(await card.locator('[data-task-more], summary').count(),0,label+': actions must not require More');
  const result=await card.evaluate(el=>{const area=el.querySelector('.task-actions'),r=area.getBoundingClientRect();const buttons=[...area.querySelectorAll('button')].map(button=>{const b=button.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,height:b.height,visible:!!button.getClientRects().length};});return {left:r.left,right:r.right,buttons};});
  assert.equal(result.buttons.length,5,label+': all five actions must be present');assert.ok(result.buttons.every(button=>button.visible),label+': every action must be visible without a click');
  assert.ok(Math.abs(Math.min(...result.buttons.map(button=>button.left))-result.left)<1&&Math.abs(Math.max(...result.buttons.map(button=>button.right))-result.right)<1,label+': buttons must fill the action row');
  for(let i=0;i<result.buttons.length;i++)for(let j=i+1;j<result.buttons.length;j++){const a=result.buttons[i],b=result.buttons[j];assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,label+': action buttons must not overlap');}
  await checkGeometry(label+' actions');
 }
 const first=app.locator('[data-task-id="short1"]');await checkActions(first,'list wide');await first.locator('[data-pin]').click();await app.locator('[data-task-id="short1"].pinned').waitFor();assert.equal(await page.evaluate(()=>document.activeElement?.hasAttribute('data-pin')),true,'pin must preserve focus in the visible action row');await checkGeometry('expanded actions');
 await app.locator('[data-filter-q]').fill('нет такой задачи');assert.equal(await app.locator('.task-column').count(),0);assert.equal(await app.locator('.task-board-empty').count(),1);await app.locator('[data-task-reset-filters]').click();assert.equal(await app.locator('.task-card').count(),2);
 await app.locator('[data-project-view="board"]').click();assert.equal(await app.locator('.task-column').count(),4);await checkGeometry('board drop targets');
 await app.locator('[data-project-id="many"]').click();await app.locator('[data-current-project-name]').filter({hasText:'Длинные карточки'}).waitFor();
 for(const width of [1870,900,560]){await page.locator('.window[data-app-id="tasks"]').evaluate((el,width)=>Object.assign(el.style,{width:width+'px',height:'850px',left:'20px',top:'20px'}),width);for(const mode of ['list','board']){await app.locator('[data-project-view="'+mode+'"]').click();await checkGeometry(mode+' width '+width);await checkActions(app.locator('.task-card').first(),mode+' width '+width);await page.screenshot({path:OUT+'/actions-'+mode+'-'+width+'.png'});await page.screenshot({path:OUT+'/'+mode+'-'+width+'.png'});}}
 await page.setViewportSize({width:390,height:844});for(const mode of ['list','board']){await app.locator('[data-project-view="'+mode+'"]').click();await checkGeometry(mode+'390');await checkActions(app.locator('.task-card').first(),mode+'390');await page.screenshot({path:OUT+'/'+mode+'-390.png'});}
 await page.evaluate(()=>document.documentElement.style.setProperty('--zeter-text-scale','1.5'));await checkGeometry('text150 narrow');assert.ok(await app.locator('.task-board').evaluate(el=>el.clientHeight>=140),'large text must leave a usable task viewport');await app.locator('.task-card').last().scrollIntoViewIfNeeded();await page.screenshot({path:OUT+'/board-390-text150.png'});
 await page.setViewportSize({width:1920,height:1000});await page.locator('.window[data-app-id="tasks"]').evaluate(el=>Object.assign(el.style,{width:'1870px',height:'850px',left:'20px',top:'20px'}));await page.evaluate(()=>{document.documentElement.style.removeProperty('--zeter-text-scale');});await app.locator('[data-project-id="empty"]').click();await app.locator('[data-current-project-name]').filter({hasText:'Пустой проект'}).waitFor();await app.locator('[data-project-view="list"]').click();await page.screenshot({path:OUT+'/empty-list.png'});assert.equal(await app.locator('.task-column').count(),0);
 await page.waitForFunction(()=>window.__lastTaskSaved?.desktops[0].data.activeTaskProjectId==='empty');
 await page.reload();await page.waitForSelector('#boot',{state:'hidden'});if(!(await page.locator('.tasks-app').count()))await page.locator('#taskbar [data-app="tasks"]').click();await page.locator('[data-current-project-name]').filter({hasText:'Пустой проект'}).waitFor();assert.equal(await page.locator('.task-project-tab').filter({hasText:'Учёба <проект>'}).count(),1,'created project and final navigation preference must survive reload');
 // Creation editor: label/control geometry must not stretch with the window height.
 await page.locator('.tasks-app .task-workspace-head [data-open-task-create]').click();const editor=page.locator('.task-editor-create'),editorWindow=page.locator('.window[data-app-id="taskedit"]');await editor.waitFor();
 await editor.locator('[data-task-title]').fill('Проверка формы');await editor.locator('[data-task-description]').fill('Текст не должен теряться при изменении размера окна.');
 async function checkEditor(label,oneColumn=false){
  const metrics=await editor.evaluate(root=>{const r=node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};};const grid=root.querySelector('.task-editor-grid');return {root:r(root),grid:r(grid),columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,footer:r(root.querySelector('.task-editor-status')),viewportHeight:innerHeight,fields:[...root.querySelectorAll('.task-editor-field')].map(field=>{const text=[...field.childNodes].find(node=>node.nodeType===3&&node.textContent.trim()),range=document.createRange();range.selectNodeContents(text);const caption=r(range),control=r(field.querySelector('input,select,textarea'));return {caption,control,gap:control.top-caption.bottom,type:field.querySelector('input,select,textarea').tagName};})};});
  console.log('EDITOR_GEOMETRY',label,JSON.stringify(metrics));
  assert.ok(metrics.fields.every(field=>field.gap>=0&&field.gap<=18),label+': label must stay close to its control');
  assert.ok(metrics.fields.filter(field=>field.type!=='TEXTAREA').every(field=>field.control.height>=36&&field.control.height<=52),label+': fields must have a consistent compact height');
  assert.ok(metrics.grid.width<=900,label+': maximized window must not stretch fields across the screen');
  assert.ok(metrics.fields.every(field=>field.control.left>=metrics.root.left-1&&field.control.right<=metrics.root.right+1),label+': controls must not overflow the form');
  assert.ok(metrics.footer.bottom<=Math.min(metrics.root.bottom,metrics.viewportHeight)+1,label+': Save/Cancel must remain inside the window');
  if(oneColumn)assert.equal(metrics.columns,1,label+': narrow internal window must use one column');
  return metrics;
 }
 await editorWindow.evaluate(el=>Object.assign(el.style,{width:'1870px',height:'850px',left:'20px',top:'20px'}));await page.screenshot({path:OUT+'/task-editor-wide.png'});await checkEditor('wide');
 for(const width of [680,560]){await editorWindow.evaluate((el,width)=>Object.assign(el.style,{width:width+'px',height:(width===680?'520px':'650px'),left:'20px',top:'20px'}),width);await checkEditor('window '+width,width===560);await page.screenshot({path:OUT+'/task-editor-'+width+'.png'});}
 await page.setViewportSize({width:390,height:844});await editorWindow.evaluate(el=>Object.assign(el.style,{width:'390px',height:'680px',left:'0px',top:'0px'}));await checkEditor('390',true);await page.evaluate(()=>document.documentElement.style.setProperty('--zeter-text-scale','1.5'));await checkEditor('390 text150',true);await editor.locator('[data-task-description]').scrollIntoViewIfNeeded();await page.screenshot({path:OUT+'/task-editor-390.png'});
 assert.equal(await editor.locator('[data-task-title]').inputValue(),'Проверка формы');assert.equal(await editor.locator('[data-task-description]').inputValue(),'Текст не должен теряться при изменении размера окна.');
 const due=editor.locator('[data-task-due]'),indefinite=editor.locator('[data-create-indefinite]');
 await due.fill('2027-02-15');await indefinite.click();
 assert.equal(await due.isDisabled(),false,'date must remain clickable while the task is indefinite');assert.equal(await indefinite.getAttribute('aria-pressed'),'true');assert.equal(await due.inputValue(),'');
 await due.click({position:{x:20,y:20}});assert.equal(await indefinite.getAttribute('aria-pressed'),'false','clicking the date must remove indefinite mode');assert.equal(await due.inputValue(),'2027-02-15','returning to a date restores the last chosen deadline');
 await due.fill('2027-03-20');await indefinite.click();assert.equal(await indefinite.getAttribute('aria-pressed'),'true');
 await indefinite.press('Shift+Tab');assert.equal(await indefinite.getAttribute('aria-pressed'),'false','keyboard focus on the date must restore dated mode');assert.equal(await due.inputValue(),'2027-03-20');
 await indefinite.click();await due.fill('2027-04-21');assert.equal(await indefinite.getAttribute('aria-pressed'),'false','entering a date must remove indefinite mode');assert.equal(await due.inputValue(),'2027-04-21');
 await page.screenshot({path:OUT+'/task-editor-date-restored.png'});await editor.locator('[data-task-priority]').selectOption('high');
 await editor.locator('[data-task-title]').press('Control+Enter');await editor.waitFor({state:'detached'});await page.locator('.task-card').filter({hasText:'Проверка формы'}).waitFor();
 await page.reload();await page.waitForSelector('#boot',{state:'hidden'});if(!(await page.locator('.tasks-app').count()))await page.locator('#taskbar [data-app="tasks"]').click();await page.locator('.task-card').filter({hasText:'Проверка формы'}).waitFor();assert.ok((await page.locator('.task-card').filter({hasText:'Проверка формы'}).textContent()).includes('21.04.2027'),'deadline restored from indefinite mode must survive save and reload');
 await page.locator('.tasks-app .task-workspace-head [data-open-task-create]').click();await editor.waitFor();await editor.locator('[data-task-title]').fill('Бессрочная после даты');const secondDue=editor.locator('[data-task-due]'),secondIndefinite=editor.locator('[data-create-indefinite]');
 await secondDue.fill('2027-05-20');await secondIndefinite.click();await secondDue.click({position:{x:20,y:20}});assert.equal(await secondIndefinite.getAttribute('aria-pressed'),'false');await secondIndefinite.click();assert.equal(await secondIndefinite.getAttribute('aria-pressed'),'true');assert.equal(await secondDue.inputValue(),'');
 await editor.locator('[data-task-title]').press('Control+Enter');await editor.waitFor({state:'detached'});await page.locator('.task-card').filter({hasText:'Бессрочная после даты'}).waitFor();await page.reload();await page.waitForSelector('#boot',{state:'hidden'});if(!(await page.locator('.tasks-app').count()))await page.locator('#taskbar [data-app="tasks"]').click();const indefiniteCard=page.locator('.task-card').filter({hasText:'Бессрочная после даты'});await indefiniteCard.waitFor();assert.ok((await indefiniteCard.locator('.task-meta').textContent()).includes('Бессрочная'),'indefinite mode chosen again must survive save and reload');
 assert.deepEqual(errors,[]);console.log('TASKS_LAYOUT_REGRESSION_PASS');
}catch(e){console.log('ERRORS',JSON.stringify(errors));throw e;}
} finally { if (browser) await browser.close(); await preview.close(); }

}
module.exports = { runTasksLayoutSmoke };
