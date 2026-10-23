"use strict";
// Real transaction queue + composition adapter, all state and writes are synthetic.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const read = name => fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const e = value => String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const ctx={window:{ZETER_CORE_UTILS:{escapeHtml:e},ZETER_TABLE_UTILS:{}},console,Date,TextEncoder,structuredClone};
vm.createContext(ctx);
for(const name of ['storage-utils','search-utils','search-ui-utils'])vm.runInContext(read('app/js/core/'+name+'.js'),ctx);
const app=read('app/js/app.js');
const adapter=app.slice(app.indexOf('  function persistSearchPreferences('),app.indexOf('  function storedStateSizeBytes('));
assert.ok(adapter.includes('persistSearchPreferences'),'Exact search settings snapshot adapter must exist');
(async()=>{
  const state={fs:{},desktops:[],searchSettings:{filters:['notes'],filtersVersion:2}};
  const writes=[];
  const queue=ctx.window.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({getState:()=>state,nativeStorage:true,cloneState:structuredClone,
    writePrimaryRecord:async snapshot=>{writes.push(snapshot);if(writes.length===2)throw new Error('second refused');return{updatedAt:1};}});
  Object.assign(ctx,{state,cloneForBackup:structuredClone,syncLegacyWorkspaceAliases(){},writeSmallSettingsToLocalStorage(){},
    persistSearchAwareTransaction:op=>queue.transaction(op)});
  vm.runInContext(adapter,ctx);
  let releaseBarrier,barrierStarted,saveStarted;
  const barrierReady=new Promise(resolve=>{barrierStarted=resolve;});
  const barrier=queue.transaction(async()=>{barrierStarted();await new Promise(resolve=>{releaseBarrier=resolve;});});
  await barrierReady;
  const saveReady=new Promise(resolve=>{saveStarted=resolve;});
  const controller=ctx.window.ZETER_SEARCH_UI_UTILS.createSearchController({getState:()=>state,getFs:()=>state.fs,
    saveSearchSettings:(owner,target)=>{saveStarted();return ctx.persistSearchPreferences(owner,target);}});
  const first=controller.setFilters(['tasks']);await saveReady;
  const second=controller.setFilters(['images']);releaseBarrier();await barrier;
  assert.equal(await first,true);assert.equal(await second,false);
  assert.deepEqual([...writes[0].searchSettings.filters],['images'],'The actual snapshot is captured after the barrier');
  assert.deepEqual([...controller.activeFilters()],['images'],'Rollback must match the actual acknowledged snapshot');
  console.log('search settings transaction snapshot smoke: ok');
})().catch(error=>{console.error(error);process.exitCode=1;});
