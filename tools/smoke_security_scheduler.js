"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const box=vm.createContext({window:{ZETER_ASSET_UTILS:{},ZETER_SECURITY_PROTECTION_UTILS:{},ZETER_OS_CONFIG:{},ZETER_CORE_UTILS:{escapeHtml:String}},console,setTimeout,clearTimeout,Date,JSON,Set,WeakMap});
vm.runInContext(fs.readFileSync('app/js/core/security-recovery-utils.js','utf8'),box);
(async()=>{
 let time=1700000000000,creates=0,alerts=[],scheduled=[],fail=false;
 let status={configured:true,enabled:true,intervalHours:1,lastSuccessAt:0};
 const api=box.window.ZETER_SECURITY_RECOVERY_UTILS.createRecoveryController({getState:()=>({fs:{},settings:{}}),transaction:async fn=>fn(()=>{}),nativeMode:()=>true,nativeCall:async method=>{if(method==='get_security_backup_status'){if(fail)throw Error('offline');return status;}if(method==='create_security_backup'){creates++;status={...status,lastSuccessAt:time};return {ok:true};}},syncEditors:()=>{},notify:(...args)=>alerts.push(args),now:()=>time,schedule:(fn,delay)=>{scheduled.push(delay);return 1;},cancelSchedule:()=>{},browserVault:{}});
 await api.tick();assert.equal(creates,1);assert.equal(scheduled.at(-1),60000);
 await api.tick();assert.equal(creates,1,'recent successful backup is not repeated');
 time+=3600001;await api.tick();assert.equal(creates,2);
 fail=true;time+=3600001;await api.tick();const alertCount=alerts.length;await api.tick();assert.equal(alerts.length,alertCount,'offline warning has cooldown, no immediate retry loop');
 api.stop();const scheduleCount=scheduled.length;await api.tick();assert.equal(scheduled.length,scheduleCount);
 console.log('security automatic scheduler due/success/offline cooldown/shutdown PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
