"use strict";
// Task completion uses the existing task-store lock, staged write and synthetic fixtures.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const sandbox = { window: { ZETER_CORE_UTILS: {}, ZETER_DATA_NORMALIZERS: {}, ZETER_TASK_UI_UTILS: {} }, console, Date, structuredClone };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,"../app/js/core/task-app-ui-utils.js"),"utf8"),sandbox);
const create = sandbox.window.ZETER_TASK_APP_UI_UTILS.createTaskCompletionController;
assert.equal(typeof create,"function","Task completion must use the task owner and staged persistence");
(async()=>{
  const original={id:"task",title:"Сохранить текст",status:"todo",updatedAt:1}; let store={tasks:[original]}, refuse=true, release;
  const controller=create({getWorkspace:()=>store,persistTransaction:operation=>operation(async snapshot=>({saved:!refuse})),
    saveSnapshot:async(write,candidate)=>{assert.equal(original.status,"todo","No optimistic publication");return write(candidate);}});
  await assert.rejects(controller.complete("task"),/подтверд|сохран/i);
  assert.equal(original.status,"todo"); refuse=false;
  await controller.complete("task"); assert.equal(original.status,"done"); assert.equal(original.title,"Сохранить текст");
  await assert.rejects(controller.complete("missing"),/найден|недоступ|удал/i);
  original.status="todo";
  const delayed=create({getWorkspace:()=>store,persistTransaction:operation=>operation(async()=>new Promise(resolve=>{release=()=>resolve({saved:true});})),saveSnapshot:(write,candidate)=>write(candidate)});
  const pending=delayed.complete("task"); await Promise.resolve();
  await assert.rejects(delayed.complete("task"),/выполняется|дожд/i);
  original.title="Новое название во время записи";
  release(); await pending; assert.equal(original.title,"Новое название во время записи");assert.equal(original.status,"done");
  console.log("search action smoke: ok");
  // Real composition-root navigation must stay bound to its desktop after ACK.
  const app=fs.readFileSync(path.join(__dirname,"../app/js/app.js"),"utf8");
  const source=app.slice(app.indexOf("  async function openExtendedSearchResult("),app.indexOf("  async function runSearchResultAction("));
  let current="A", acknowledge, opened=[];
  const project={id:"p",name:"Проект"},projectStore={activeTaskProjectId:"p"};
  const ctx={searchTargetRecord:()=>({desktopId:"A",workspace:{},store:projectStore,record:project}),
    getDesktopRoot:()=>current,switchVirtualDesktop:id=>{current=id;return true;},
    openApp:(appId,params)=>{opened.push({appId,params,desktop:current});return true;},
    saveState:()=>new Promise(resolve=>{acknowledge=resolve;}),searchRevision:0};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const opening=ctx.openExtendedSearchResult({dataset:{searchKind:"project",id:"p",desktopId:"A",projectType:"tasks"}});
  current="B";acknowledge({saved:true});await assert.rejects(opening,/стол|отмен|устар/i);
  assert.equal(opened.length,0,"A delayed project open must not open another desktop's tasks");
  console.log("search project navigation ACK smoke: ok");
})().catch(error=>{console.error(error);process.exitCode=1;});
