"use strict";
// Pure synthetic model/controller checks: no browser profile, native API or data/ I/O.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({window:{ZETER_OS_CONFIG:{TRASH_ROOT:'trash'},ZETER_CORE_UTILS:{pad:n=>String(n),isSafeId:()=>true,escapeHtml:s=>String(s)}},console,document:{},Blob,TextEncoder,TextDecoder,Uint8Array,Uint32Array,ArrayBuffer,DataView,Date,JSON,Math,Map,Set,Promise});
for(const name of ['asset-utils','security-protection-utils','security-utils','security-ui-utils','security-recovery-utils'])vm.runInContext(fs.readFileSync('app/js/core/'+name+'.js','utf8'),context);
const api=context.window.ZETER_SECURITY_UTILS;
async function main(){
 let finishPoints,finishStorage,reads=0,storageReads=0,cleanupReads=0;
 const points=[{id:'synthetic-point',createdAt:1}],nativeInfo={dataDir:'G:/Искусственные данные',dataBytes:30};
 const result=api.collectSecuritySnapshotModel({nativeMode:true,includeCleanup:false,
  readRestorePoints:()=>{reads++;return new Promise(resolve=>finishPoints=resolve);},
  nativeStorageCall:()=>{storageReads++;return new Promise(resolve=>finishStorage=resolve);},
  collectExternalSaveSnapshot:args=>api.collectExternalSaveSnapshotModel({nativeMode:true,...args,nativeStorageCall:()=>{storageReads++;return nativeInfo;}}),
  collectCleanupPreview:()=>{cleanupReads++;return {};}});
 await Promise.resolve();
 assert.equal(storageReads,1,'storage read starts without waiting for restore points');
 finishStorage(nativeInfo);finishPoints(points);
 const snapshot=await result;
 assert.equal(reads,1);assert.equal(storageReads,1,'external status shares the same native result');assert.equal(cleanupReads,0,'overview does not calculate cleanup');
 assert.equal(snapshot.restoreCount,1);assert.equal(snapshot.externalSave.folderName,nativeInfo.dataDir);assert.equal(snapshot.usage,30);
 let restoreCalls=0,cleanupCalls=0,infoCalls=0;const restoreQueries=[];
 const runtime=context.window.ZETER_SECURITY_UI_UTILS.createSecurityRuntimeController({getState:()=>({fs:{}}),shouldUseNativeStorage:()=>true,
  nativeStorageCall:async()=>{infoCalls++;return nativeInfo;},loadNativeRestorePoints:async query=>{restoreCalls++;restoreQueries.push(query);return {points};},
  cleanupNativeArtifacts:async()=>{cleanupCalls++;return {reclaimBytes:7};}});
 const full=await runtime.collectSecuritySnapshot();
 assert.equal(restoreCalls,1,'cleanup preview reuses already read restore points');assert.equal(infoCalls,1);assert.equal(cleanupCalls,1);assert.equal(full.cleanupPreview.restorePoints,1);
 assert.equal(restoreQueries[0]?.summariesOnly,true,'status cards request metadata instead of full restore states');
 const fast=await runtime.collectSecuritySnapshot({includeCleanup:false});assert.equal(cleanupCalls,1);assert.equal(fast.restoreCount,1);
 const beforeCheck=restoreCalls;await runtime.runSecurityIntegrityCheck();assert.equal(restoreCalls-beforeCheck,1,'integrity check also reads restore points only once');
 assert.equal(restoreQueries.at(-1),undefined,'integrity still requests full point states');
 let finishOld;let historyReads=0;const nodes=new Map(),fakeRoot={dataset:{},querySelector:key=>{if(!nodes.has(key))nodes.set(key,{classList:{toggle(){}}});return nodes.get(key);}};
 const recovery=context.window.ZETER_SECURITY_RECOVERY_UTILS.createRecoveryController({getState:()=>({}),nativeMode:()=>true,schedule:()=>0,cancelSchedule:()=>{},nativeCall:async()=>{if(++historyReads===1)return new Promise(resolve=>finishOld=resolve);return {configured:true,folder:'new',enabled:false,entries:[]};}});
 const old=recovery.refresh(fakeRoot);await recovery.refresh(fakeRoot);finishOld({configured:true,folder:'old',enabled:true,entries:[]});await old;
 assert.match(nodes.get('[data-vault-status]').textContent,/Папка: new/,'late history read must not overwrite newer settings/status');
 const configured=[];const settingsController=context.window.ZETER_SECURITY_RECOVERY_UTILS.createRecoveryController({getState:()=>({}),nativeMode:()=>true,schedule:()=>0,cancelSchedule:()=>{},nativeCall:async(method,payload)=>{if(method==='configure_security_backups')configured.push(payload);return {configured:true,folder:'configured',enabled:true,maxCopies:100,intervalHours:72,maxBytes:4294967296,entries:[]};}});
 delete fakeRoot.dataset.vaultInitialized;
 await assert.rejects(settingsController.action({name:'configure'},fakeRoot),/дождись чтения/);assert.equal(configured.length,0,'unknown settings cannot overwrite existing retention');
 await settingsController.action({name:'choose-folder'},fakeRoot);assert.equal(JSON.stringify(configured[0]),JSON.stringify({chooseFolder:true}),'repairing folder never submits uninitialized defaults');
 console.log('Security loading smoke passed: parallel reads, one native status/restore read, lazy cleanup.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
