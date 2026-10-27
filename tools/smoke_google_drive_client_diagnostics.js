"use strict";
// Synthetic conflict and network failure logging. Never connects to Google.
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {webcrypto}=require("node:crypto");
const context={window:{},crypto:webcrypto,Blob,Uint8Array,setTimeout,clearTimeout,console,Date};
vm.createContext(context);
for(const file of ["cloud-payload-utils.js","google-drive-sync-utils.js"]){
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../app/js/core",file),"utf8"),context,{filename:file});
}
const sync=context.window.ZETER_GOOGLE_DRIVE_SYNC_UTILS;
(async()=>{
  const events=[];
  const record={app:"ZeTer OS",versionNumber:1,state:{fs:{},settings:{},desktops:[{id:"desktop",data:{}}]}};
  let saved=null,fail=false,clock=1_000_000;
  const provider={head:async()=>{
    if(fail)throw new Error("SENSITIVE-PRIVATE-TOKEN-MUST-NOT-BE-LOGGED");
    return {accountKey:"a".repeat(64),generation:1,head:{
      generation:1,snapshotId:"snapshot-local-test",contentHash:"b".repeat(64)
    }};
  }};
  const controller=sync.createSyncController({
    provider,store:{read:async()=>saved,write:async next=>{saved=JSON.parse(JSON.stringify(next));}},
    collect:async()=>({stateRecord:record,files:[]}),
    preserve:async()=> "safe-branch",
    isEmpty:()=>false,now:()=>clock,
    onDiagnostic:value=>events.push(value)
  });
  await controller.configure(true);
  assert.equal(controller.getStatus().phase,"conflict");
  const observed=events.find(e=>e.driveEvent==="remote_checked");
  assert.equal(observed.cloudHeadPresent,true);
  assert.equal(observed.cloudGeneration,1);
  assert.equal(events.some(e=>e.driveEvent==="conflict_saved"&&e.conflictSaved===true),true);
  const initialCount=events.filter(e=>e.driveEvent==="remote_checked").length;
  await controller.run();
  assert.equal(events.filter(e=>e.driveEvent==="remote_checked").length,initialCount,
    "Repeated poll should not flood identical remote observations");
  fail=true;
  await assert.rejects(controller.run(),/SENSITIVE-PRIVATE-TOKEN/);
  assert.equal(events.some(e=>e.driveEvent==="failure"&&e.drivePhase==="offline"),true);
  assert.equal(JSON.stringify(events).includes("SENSITIVE-PRIVATE-TOKEN"),false);
  assert.equal(JSON.stringify(events).includes("snapshot-local-test"),false);
  assert.equal(JSON.stringify(events).includes("a".repeat(64)),false);
  console.log("GOOGLE_DRIVE_CLIENT_DIAGNOSTICS_PASS: first-connect conflict, bounded polls, private errors not logged");
})().catch(error=>{console.error(error);process.exitCode=1;});
