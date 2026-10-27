'use strict';
// Two isolated devices over a synthetic Drive/CAS provider. No account, app startup or user files.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
function runtime(now=Date.now){const c={window:{},crypto:webcrypto,Blob,Uint8Array,setTimeout,clearTimeout,console,Date:{now}};for(const file of ['cloud-payload-utils.js','google-drive-sync-utils.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/core',file),'utf8'),c);return c.window;}
async function main(){
 let clock=1000000;
 const api=runtime(()=>clock),sync=api.ZETER_GOOGLE_DRIVE_SYNC_UTILS,sha=api.ZETER_CLOUD_PAYLOAD_UTILS.digest,objects=new Map(),operations=new Map(),receipts=new Map();let counter=0,generation=0,head=null,conflictNext=false,loseReply=false,bootstrap=null;const accountKey='a'.repeat(64);
 const uploads=[];let downloads=0;
 function entry(v){return {id:v.id||'file_'+(++counter),name:v.name,kind:v.kind,parents:v.parentId?[v.parentId]:[],pathKey:v.pathKey};}
 const provider={
  head:async()=>({accountKey,generation,head:head&&{...head}}),
  allocateId:async()=>({id:'file_'+(++counter)}),
  bootstrap:async()=>({bootstrap:bootstrap||(bootstrap={rootFolderId:'root',dataFolderId:'data',historyFolderId:'history',stagingFolderId:'staging'})}),
  makeFolder:async v=>{if(objects.has(v.id))return {entry:objects.get(v.id)};const e=entry(v);objects.set(e.id,{...e});return {entry:e};},
  directoryId:async v=>({id:'dir_'+v.pathKey.slice(0,16)}),
  files:async v=>({entries:[...objects.values()].filter(e=>e.parents.includes(v.parentId)&&(!v.kind||e.kind===v.kind)).map(({blob,...e})=>e)}),
  putFile:async v=>{const digest=await sha(v.blob),old=operations.get(v.operationId);if(old){assert.equal(old.sha256,digest,'operation ID cannot identify different bytes');return {entry:old};}const e={...entry(v),sha256:digest,sizeBytes:v.blob.size,blob:v.blob};uploads.push(e);objects.set(e.id,e);operations.set(v.operationId,e);return {entry:e};},
  readFile:async v=>{downloads++;const e=objects.get(v.id);assert.ok(e?.blob);assert.equal(e.sha256,v.sha256);if(v.sizeBytes!==undefined)assert.equal(e.blob.size,v.sizeBytes);return e.blob;},
  moveFile:async v=>{const e=objects.get(v.id);e.parents=[v.parentId];e.name=v.name;return {entry:e};},
  commit:async v=>{if(receipts.has(v.operationId))return receipts.get(v.operationId);if(conflictNext){conflictNext=false;return {conflict:true,head,generation};}if(v.expectedGeneration!==generation)return {conflict:true,head,generation};head={generation:++generation,rootFolderId:v.rootFolderId,...v.candidate,operationId:v.operationId,parentGeneration:v.expectedGeneration,committedAt:Date.now()};const result={accountKey,generation,head:{...head}};receipts.set(v.operationId,result);if(loseReply){loseReply=false;throw new Error('reply lost');}return result;}
 };
 const fixture=text=>({app:'ZeTer OS',versionNumber:1,state:{fs:{note:{id:'note',type:'note',name:'note',content:text,parent:'desktop'},file:{id:'file',managedPath:'Файлы ZeTer OS/report.docx',documentDraft:{basePath:'Файлы ZeTer OS/report.docx'}}},settings:{theme:'dark'},desktops:[{id:'desktop',name:'Main'}],security:{protectionPolicy:{profile:'standard'},lastIntegrityCheckAt:12,unknownImportant:'preserve'}}});
 function device(record=null,{remap=false}={}){let local=record||fixture(''),bytes=new Blob(['original DOCX bytes']),metadata=null,failApply=false,collectHook=null,collectCount=0;const branches=[];
  const controller=sync.createSyncController({provider,store:{read:async()=>metadata,write:async v=>{metadata={...v};}},collect:async()=>{await collectHook?.(++collectCount);return {stateRecord:local,files:[{path:local.state.fs.file.managedPath,blob:bytes}]};},apply:async snapshot=>{if(failApply)throw new Error('primary ACK refused');const incoming=JSON.parse(JSON.stringify(snapshot.stateRecord));if(remap){incoming.state.fs.file.managedPath='Файлы ZeTer OS/remapped.docx';incoming.state.fs.file.documentDraft.basePath=incoming.state.fs.file.managedPath;}local=incoming;bytes=snapshot.files[0].blob;},preserve:async branch=>{branches.push(branch);return 'branch-'+branches.length;},isSafeToApply:()=>true,isEmpty:s=>!s.fs.note.content,schedule:()=>null,unschedule:()=>{}});
  return {controller,setCollectHook:fn=>{collectHook=fn;collectCount=0;},get local(){return local;},get metadata(){return metadata;},get branches(){return branches;},setText:text=>{local.state.fs.note.content=text;},setBytes:value=>{bytes=new Blob([value]);},failApply:value=>{failApply=value;},get bytes(){return bytes;}};
 }
 async function accept(d){const offer=d.controller.getIncoming();assert.ok(offer,'incoming confirmation exists');await d.controller.acceptIncoming(offer.key);}
 const computer=device(fixture('from computer')),phone=device();await computer.controller.configure(true,true);assert.equal(head.generation,1);assert.ok(uploads.every(e=>!e.name.endsWith('.zip')));const firstPayload=uploads.find(e=>e.kind==='payload'),firstState=uploads.find(e=>e.kind==='state'),firstCount=uploads.length;
 const firstDownloads=downloads;await computer.controller.run();assert.equal(uploads.length,firstCount,'unchanged device uploads no bytes');
 assert.equal(downloads,firstDownloads,'unchanged confirmed device must not download every payload again');
 await computer.controller.run('check');assert.ok(downloads>firstDownloads,'explicit check still verifies remote bytes');
 const afterExplicit=downloads;clock+=300001;await computer.controller.run();assert.ok(downloads>afterExplicit,'periodic integrity check must still read accepted bytes');
 const afterIntegrity=downloads;await computer.controller.run();assert.equal(downloads,afterIntegrity,'completed integrity check enables cheap polling again');
 await phone.controller.configure(true,true);assert.equal(phone.local.state.fs.note.content,'','empty attach does not overwrite before click');await accept(phone);assert.equal(phone.local.state.fs.note.content,'from computer');assert.equal(await phone.bytes.text(),'original DOCX bytes');assert.equal(phone.local.state.security.unknownImportant,'preserve','unknown security field survives canonicalization');
 phone.setText('phone note edited');const beforeEdit=uploads.length;await phone.controller.run();assert.deepEqual(uploads.slice(beforeEdit).map(e=>e.kind),['state','snapshot'],'note edit uploads only state plus commit inventory');await computer.controller.run();await accept(computer);assert.equal(computer.local.state.fs.note.content,'phone note edited');assert.equal(await computer.bytes.text(),'original DOCX bytes','native payload survives phone edit roundtrip');
 computer.setBytes('changed same-path bytes');await computer.controller.run();assert.equal(await objects.get(firstPayload.id).blob.text(),'original DOCX bytes','prior immutable accepted payload remains valid');assert.equal(await objects.get(firstState.id).blob.text().then(JSON.parse).then(v=>v.state.fs.note.content),'from computer');
 await phone.controller.run();await accept(phone);computer.setText('computer concurrent');phone.setText('phone concurrent');await computer.controller.run();await phone.controller.run();assert.equal(phone.controller.getStatus().phase,'conflict');assert.equal(phone.local.state.fs.note.content,'phone concurrent');assert.ok(phone.branches.length>0);const countBranches=phone.branches.length;await phone.controller.run();assert.equal(phone.branches.length,countBranches,'conflict polls do not create endless safety copies');
 await phone.controller.run('cloud');assert.equal(phone.local.state.fs.note.content,'computer concurrent');
 const dirty=device(fixture('first different local'));await dirty.controller.configure(true,true);assert.equal(dirty.controller.getStatus().phase,'conflict','first attach differing nonempty local requires explicit choice');assert.equal(dirty.local.state.fs.note.content,'first different local');
 const savedRemoteHead=head;head=null;
 const branchesBeforeEmpty=dirty.branches.length;await dirty.controller.run();
 assert.equal(dirty.controller.getStatus().phase,'synced','saved conflict must not block upload when coordinator confirms no cloud head');
 assert.equal(dirty.branches.length,branchesBeforeEmpty,'empty cloud does not invent another conflicting version');
 assert.equal(dirty.metadata.conflict,null);
 assert.ok(objects.has(savedRemoteHead.manifestFileId),'prior immutable objects remain untouched');
 await computer.controller.run('local');
 const refused=device();refused.failApply(true);await refused.controller.configure(true,true);await assert.rejects(accept(refused),/ACK refused/);assert.equal(refused.local.state.fs.note.content,'','failed apply retains previous local state');assert.equal(refused.metadata.baseGeneration,null);refused.failApply(false);await refused.controller.run();await accept(refused);assert.equal(refused.local.state.fs.note.content,'computer concurrent');
 const mapped=device(null,{remap:true});await mapped.controller.configure(true,true);await accept(mapped);const beforeEcho=uploads.length;await mapped.controller.run();assert.equal(uploads.length,beforeEcho,'native path remap establishes local baseline instead of echo upload');
 const beforeMappedCheck=downloads;await mapped.controller.run('check');assert.ok(downloads>beforeMappedCheck,'explicit check verifies cloud bytes after native path remap');
 const beforeMappedPoll=downloads;await mapped.controller.run();assert.equal(downloads,beforeMappedPoll,'verified remapped device uses the cached receipt');
 clock+=300001;await mapped.controller.run();assert.ok(downloads>beforeMappedPoll,'integrity interval verifies bytes after native path remap');
 mapped.setText('note after native remap');const beforeMappedEdit=uploads.length;await mapped.controller.run();assert.deepEqual(uploads.slice(beforeMappedEdit).map(e=>e.kind),['state','snapshot'],'native path remap plus note edit reuses unchanged payload bytes');await computer.controller.run();await accept(computer);
 computer.setText('lost reply update');loseReply=true;await assert.rejects(computer.controller.run(),/reply lost/);const pending=computer.metadata.pending;assert.ok(pending?.operationId);const afterLoss=uploads.length;await computer.controller.run();assert.equal(uploads.length,afterLoss,'response loss reconciles accepted current head');assert.equal(computer.metadata.pending,null);
 const receiving=device();await receiving.controller.configure(true,true);await accept(receiving);computer.setText('new cloud version during fetch');await computer.controller.run();const originalRead=provider.readFile;let signalRead,releaseRead,held=false;const readStarted=new Promise(resolve=>signalRead=resolve),readGate=new Promise(resolve=>releaseRead=resolve);provider.readFile=async value=>{if(!held&&value.id===head.manifestFileId){held=true;signalRead();await readGate;}return originalRead(value);};await receiving.controller.run();const pulling=accept(receiving);await readStarted;receiving.local.state.fs.note.x=77;releaseRead();await pulling;provider.readFile=originalRead;assert.equal(receiving.controller.getStatus().phase,'conflict');assert.equal(receiving.local.state.fs.note.x,77,'local desktop edit during remote fetch cannot be silently overwritten');
 let refuseSettings=true;let durable={enabled:true,onboardingVersion:1};const preferences=sync.createSyncController({provider,store:{read:async()=>durable,write:async value=>{if(refuseSettings)throw new Error('settings ACK refused');durable={...value};}}});
 await assert.rejects(preferences.configure(false),/settings ACK refused/);assert.equal((await preferences.settings()).enabled,true);assert.equal((await preferences.settings()).onboardingVersion,1);assert.equal(durable.enabled,true,'rejected disable keeps the durable previous setting');
 await assert.rejects(preferences.disconnect(),/settings ACK refused/);assert.equal((await preferences.settings()).enabled,true,'disconnect preferences publish only after durable ACK');assert.equal(durable.enabled,true);
 refuseSettings=false;await preferences.configure(false);assert.equal((await preferences.settings()).enabled,false);assert.equal(durable.onboardingVersion,1,'legacy metadata remains compatible');const ungated=device();await ungated.controller.configure(true);assert.equal(ungated.metadata.enabled,true,'a fresh connection needs no rules acknowledgement');
 const restarted=sync.createSyncController({provider,store:{read:async()=>durable,write:async()=>{}}});assert.equal((await restarted.settings()).enabled,false);assert.equal((await restarted.settings()).onboardingVersion,1,'legacy metadata survives controller restart');
 let startupChecks=0;const startupOptions={provider:{head:async()=>{startupChecks++;throw new Error('synthetic startup cloud check');}},store:{read:async()=>durable,write:async()=>{}}};await sync.createSyncController(startupOptions).startup();assert.equal(startupChecks,0,'disabled persisted settings remain disabled at startup');durable={...durable,enabled:true};await assert.rejects(sync.createSyncController(startupOptions).startup(),/synthetic startup cloud check/);assert.equal(startupChecks,1,'enabled persisted connection resumes automatically after restart');
 // Offers are transient, stable across polling, and scoped to the exact observed head.
 const offeredDevice=device();await offeredDevice.controller.configure(true);const firstOffer=offeredDevice.controller.getIncoming();assert.ok(firstOffer);
 const savedBeforeOffer=JSON.stringify(offeredDevice.metadata);offeredDevice.controller.deferIncoming(firstOffer.key);await offeredDevice.controller.run();assert.equal(offeredDevice.controller.getIncoming().deferred,true);assert.equal(JSON.stringify(offeredDevice.metadata),savedBeforeOffer,'defer/poll never writes workspace or sync metadata');
 computer.setText('newer than the offer');await computer.controller.run();await offeredDevice.controller.acceptIncoming(firstOffer.key);assert.equal(offeredDevice.local.state.fs.note.content,'','stale confirmation cannot apply a newer cloud head');const secondOffer=offeredDevice.controller.getIncoming();assert.notEqual(secondOffer.key,firstOffer.key);assert.equal(secondOffer.deferred,false);await accept(offeredDevice);assert.equal(offeredDevice.local.state.fs.note.content,'newer than the offer');
 computer.setText('cloud before local change');await computer.controller.run();await offeredDevice.controller.run();const editOffer=offeredDevice.controller.getIncoming();offeredDevice.setText('local edit after notification');await offeredDevice.controller.acceptIncoming(editOffer.key);assert.equal(offeredDevice.controller.getStatus().phase,'conflict');assert.equal(offeredDevice.local.state.fs.note.content,'local edit after notification');
 const disconnectDevice=device();await disconnectDevice.controller.configure(true);const disconnectedOffer=disconnectDevice.controller.getIncoming();await disconnectDevice.controller.disconnect();await disconnectDevice.controller.acceptIncoming(disconnectedOffer.key);assert.equal(disconnectDevice.controller.getIncoming(),null);assert.equal(disconnectDevice.local.state.fs.note.content,'');
 const headRace=device();await headRace.controller.configure(true);await accept(headRace);computer.setText('head recheck race');await computer.controller.run();await headRace.controller.run();const savedHead=head,savedGeneration=generation;headRace.setCollectHook(count=>{if(count===2)head={...head,generation:++generation,snapshotId:'f'.repeat(32)};});await assert.rejects(accept(headRace),/изменилась/);assert.equal(headRace.local.state.fs.note.content,'cloud before local change','head drift during local collect applies zero bytes');head=savedHead;generation=savedGeneration;
 // A competing device wins while this device is uploading. Explicit local choice
 // must create a proposal against the new head, not retry a doomed old CAS forever.
 const racer=device(fixture('race base'));await racer.controller.configure(true);await racer.controller.run('local');
 const competitor=device();await competitor.controller.configure(true);await accept(competitor);
 racer.setText('chosen local winner');competitor.setText('competing cloud winner');
 const commitBeforeRace=provider.commit;
 provider.commit=async value=>{provider.commit=commitBeforeRace;await competitor.controller.run();return commitBeforeRace(value);};
 await racer.controller.run();assert.equal(racer.controller.getStatus().phase,'conflict');
 const stalePending=racer.metadata.pending;assert.ok(stalePending.expectedGeneration<generation);
 await racer.controller.run('local');assert.equal(racer.controller.getStatus().phase,'synced','explicit local choice must resolve stale pending CAS');
 assert.equal(racer.metadata.pending,null);assert.notEqual(head.operationId,stalePending.operationId);
 await competitor.controller.run();await accept(competitor);assert.equal(competitor.local.state.fs.note.content,'chosen local winner');
 // Accepted cloud head may outlive the deleted manifest while the Drive root is empty.
 // Only explicit local selection can rebuild it; polling must not publish.
 const brokenManifestId=head.manifestFileId,priorReadFile=provider.readFile,priorMakeFolder=provider.makeFolder;
 for(const objectId of [...objects.keys()])if(objectId!=='root')objects.delete(objectId);
 provider.makeFolder=async value=>{
   if(value.kind==='data'&&value.id==='data')throw Object.assign(new Error('invalid reserved folder id'),{code:'invalid_reserved_folder_id'});
   return priorMakeFolder(value);
 };
 provider.readFile=async value=>{
   if(value.id===brokenManifestId)throw Object.assign(new Error('synthetic accepted manifest missing'),{acceptedManifestMissing:true});
   return priorReadFile(value);
 };
 const damaged=device(fixture('local survivor'));const beforeBrokenGen=generation,beforeBrokenUploads=uploads.length;
 await damaged.controller.configure(true);assert.equal(damaged.controller.getStatus().phase,'conflict');
 await damaged.controller.run();
 assert.match(damaged.controller.getStatus().text,/манифест/i);
 assert.equal(damaged.controller.getStatus().cloudManifestMissing,true);
 assert.equal(generation,beforeBrokenGen,'missing manifest must not publish during ordinary polling');
 assert.equal(uploads.length,beforeBrokenUploads);
 await assert.rejects(damaged.controller.run('cloud'),/манифест/i);
 assert.equal(damaged.local.state.fs.note.content,'local survivor','invalid cloud cannot overwrite local data');
 await damaged.controller.run('local');
 assert.equal(damaged.controller.getStatus().phase,'synced','explicit local recovery rebuilds deleted manifest');
 const freshManifest=JSON.parse(await objects.get(head.manifestFileId).blob.text());
 assert.notEqual(freshManifest.dataFolderId,'data','Drive-rejected reserved child ID must be replaced');
 assert.notEqual(freshManifest.historyFolderId,'history');
 assert.notEqual(freshManifest.stagingFolderId,'staging');
 assert.equal(objects.has(freshManifest.dataFolderId),true);
 assert.equal(generation,beforeBrokenGen+1);
 assert.ok(uploads.length>beforeBrokenUploads);
 assert.equal(damaged.local.state.fs.note.content,'local survivor');
 assert.equal(damaged.metadata.conflict,null);
 provider.readFile=priorReadFile;
 provider.makeFolder=priorMakeFolder;
 await cancellationGates(sync,sha);
 await retryStages(sync,sha);
 await recreatedRoots(sync,sha);
 const raw=fixture('canonical');const normalized=sync.normalizedRecord(raw);assert.equal(normalized.state.security.lastIntegrityCheckAt,undefined);assert.equal(normalized.state.security.unknownImportant,'preserve');assert.equal(sync.canonical({b:1,a:2}),sync.canonical({a:2,b:1}));
 console.log('GOOGLE_DRIVE_SYNC_PASS: confirmed computer→phone→computer, unchanged zero bytes, note-only state, immutable payload history, first/concurrent conflict, safety dedupe, apply refusal→retry, path-remap no echo, lost commit receipt reconciliation.');
}
async function cancellationGates(sync,sha){
 for(const gateName of ['metadata','digest']){
  let metadata=null,signal,release,puts=0;const reached=new Promise(r=>signal=r),gate=new Promise(r=>release=r);const original=runtime(),payload=original.ZETER_CLOUD_PAYLOAD_UTILS;
  // A separate runtime permits delaying only the exact path digest, without global crypto hooks.
  const localSync=original.ZETER_GOOGLE_DRIVE_SYNC_UTILS;
  if(gateName==='digest')original.ZETER_CLOUD_PAYLOAD_UTILS={...payload,digest:async bytes=>{if(await bytes.text()==='a.txt'){signal();await gate;}return payload.digest(bytes);}};
  const structure={rootFolderId:'root',dataFolderId:'data',historyFolderId:'history',stagingFolderId:'staging'};
  const controller=localSync.createSyncController({provider:{head:async()=>({accountKey:'d'.repeat(64),head:null,generation:0}),bootstrap:async()=>({bootstrap:structure}),makeFolder:async v=>({entry:{id:v.id}}),allocateId:async()=>({id:'file_id'}),putFile:async()=>{puts++;throw new Error('unexpected POST');}},store:{read:async()=>metadata,write:async value=>{if(gateName==='metadata'&&Object.keys(value.uploadIntent?.fileIds||{}).length){signal();await gate;}metadata=JSON.parse(JSON.stringify(value));}},collect:async()=>({stateRecord:{app:'ZeTer OS',state:{fs:{},settings:{}}},files:[{path:'a.txt',blob:new Blob(['test'])}]}),schedule:()=>null,unschedule:()=>{}});
  const running=controller.configure(true);await reached;controller.cancelPending();release();await running;assert.equal(puts,0,'cancel during '+gateName+' stops before POST');assert.equal(controller.getStatus().phase,'pending');
 }
 console.log('GOOGLE_DRIVE_CANCEL_PASS: cancel during durable ACK and crypto path digest stops POST.');
}
async function retryStages(sync,sha){
 const state={app:'ZeTer OS',versionNumber:1,state:{fs:{n:{id:'n',type:'note',content:'synthetic'}},settings:{theme:'dark'}}};
 for(const lostStage of ['root','data','history','staging','payload','state','snapshot']){
  let metadata=null,allocated=0,cloudWrites=0,liveHead=null,gen=0,failed=false;const objects=new Map();const structure={rootFolderId:'root',dataFolderId:'data',historyFolderId:'history',stagingFolderId:'staging'};
  const provider={head:async()=>({accountKey:'b'.repeat(64),generation:gen,head:liveHead}),allocateId:async()=>({id:'id_'+(++allocated)}),bootstrap:async()=>({bootstrap:structure}),directoryId:async v=>({id:'dir_'+v.pathKey.slice(0,16)}),files:async v=>({entries:[...objects.values()].filter(e=>e.parents.includes(v.parentId))}),
   makeFolder:async v=>create(v),putFile:async v=>create(v),readFile:async v=>objects.get(v.id).blob,moveFile:async v=>{const e=objects.get(v.id);e.parents=[v.parentId];e.name=v.name;return {entry:e};},
   commit:async v=>{liveHead={generation:++gen,rootFolderId:v.rootFolderId,...v.candidate};return {head:liveHead,generation:gen};}};
  async function create(v){assert.ok(metadata.uploadIntent,'intent acknowledged before first cloud write');if(objects.has(v.id))return {entry:objects.get(v.id)};cloudWrites++;const e={id:v.id,name:v.name,kind:v.kind,parents:v.parentId?[v.parentId]:[],pathKey:v.pathKey,blob:v.blob};if(v.blob){assert.ok(Object.values(metadata.uploadIntent.fileIds).includes(v.id),'file ID acknowledged before POST');e.sha256=await sha(v.blob);e.sizeBytes=v.blob.size;}objects.set(e.id,e);if(v.kind===lostStage&&!failed){failed=true;throw new Error('lost '+lostStage+' POST reply');}return {entry:e};}
  const options={provider,store:{read:async()=>metadata,write:async v=>{metadata=JSON.parse(JSON.stringify(v));}},collect:async()=>({stateRecord:state,files:[{path:'files/a.txt',blob:new Blob(['payload'])}]}),isSafeToApply:()=>true,isEmpty:()=>false,preserve:async()=>true,schedule:()=>null,unschedule:()=>{}};
  const original=sync.createSyncController(options);await assert.rejects(original.configure(true),new RegExp('lost '+lostStage));const priorIntent=JSON.stringify(metadata.uploadIntent);const restart=sync.createSyncController(options);await restart.startup();assert.ok(liveHead,'restart completes commit after '+lostStage);assert.equal(objects.size,8,'one root, three folders, payload, state, manifest and payload directory');assert.equal([...objects.values()].filter(e=>e.kind==='root').length,1);assert.equal(cloudWrites,8,'lost reply does not create another object at '+lostStage);assert.ok(priorIntent);assert.equal(metadata.uploadIntent,null);await restart.run();assert.equal(cloudWrites,8,'unchanged restart transfers zero objects');
 }
 let writes=0;const refused=sync.createSyncController({provider:{head:async()=>({accountKey:'c'.repeat(64),generation:0,head:null}),bootstrap:async()=>{writes++;}},store:{read:async()=>({enabled:true,accountKey:'c'.repeat(64)}),write:async()=>{throw new Error('intent ACK refused');}},collect:async()=>({stateRecord:state,files:[]})});await assert.rejects(refused.run(),/intent ACK refused/);assert.equal(writes,0,'metadata refusal stops before bootstrap/mutation');
 console.log('GOOGLE_DRIVE_RETRY_PASS: seven ambiguous POST stages + restart; fixed IDs; one root; refused intent zero cloud writes.');
}
async function recreatedRoots(sync,sha){
 for(const mode of ['accepted-head','no-head','lost-reservation','lost-payload','lost-snapshot','settings-refused']){
  const accountKey='e'.repeat(64),structure={rootFolderId:'replacement',dataFolderId:'replacement_data',historyFolderId:'replacement_history',stagingFolderId:'replacement_staging'},objects=new Map();
  let metadata={enabled:true,accountKey,baseGeneration:mode==='no-head'?null:5,baseLocalHash:'1'.repeat(64),baseCloudHash:'2'.repeat(64)},gen=mode==='no-head'?0:5,head=mode==='no-head'?null:{generation:5,rootFolderId:'deleted',snapshotId:'3'.repeat(32),contentHash:'2'.repeat(64),manifestFileId:'deleted_manifest',manifestSha256:'4'.repeat(64)},missing=true,reservations=0,allocated=0,posts=0,failed=false;
  const oldHead=JSON.stringify(head);
  async function create(v){assert.ok(metadata.uploadIntent,'new durable intent exists before replacement POST');if(objects.has(v.id))return {entry:objects.get(v.id)};posts++;const e={id:v.id,name:v.name,kind:v.kind,parents:v.parentId?[v.parentId]:[],pathKey:v.pathKey,blob:v.blob};if(v.blob){e.sha256=await sha(v.blob);e.sizeBytes=v.blob.size;}objects.set(e.id,e);if(!failed&&mode==='lost-'+v.kind){failed=true;throw new Error('lost replacement reply');}return {entry:e};}
  const provider={head:async()=>({accountKey,generation:gen,head,...(missing?{missingRootFolderId:'deleted'}:{})}),recreateRoot:async value=>{assert.equal(value.oldRootFolderId,'deleted');assert.equal(value.expectedGeneration,gen);assert.ok(metadata.uploadIntent);assert.equal(metadata.pending,null);assert.equal(JSON.stringify(head),oldHead,'recreation does not replace accepted head before upload');reservations=1;if(mode==='lost-reservation'&&!failed){failed=true;throw new Error('lost replacement reply');}return {accountKey,generation:gen,head,bootstrap:structure};},allocateId:async()=>({id:'new_'+(++allocated)}),makeFolder:create,putFile:create,directoryId:async v=>({id:'dir_'+v.pathKey.slice(0,12)}),files:async v=>({entries:[...objects.values()].filter(e=>e.parents.includes(v.parentId))}),readFile:async v=>{assert.notEqual(v.id,'deleted_manifest','full replacement must not read old cloud manifest');return objects.get(v.id).blob;},moveFile:async v=>{const e=objects.get(v.id);e.parents=[v.parentId];e.name=v.name;return {entry:e};},commit:async v=>{assert.equal(v.expectedGeneration,gen);assert.equal(v.rootFolderId,'replacement');head={...v.candidate,rootFolderId:v.rootFolderId,generation:++gen};missing=false;return {accountKey,head,generation:gen};}};
  const state={app:'ZeTer OS',state:{fs:{n:{id:'n',type:'note',content:'current local data'}},settings:{theme:'dark'}}};
  const options={provider,store:{read:async()=>metadata,write:async value=>{if(mode==='settings-refused')throw new Error('recreation ACK refused');metadata=JSON.parse(JSON.stringify(value));}},collect:async()=>({stateRecord:state,files:[{path:'a.txt',blob:new Blob(['all local payload'])}]}),isSafeToApply:()=>true,isEmpty:()=>false,preserve:async()=>true,schedule:()=>null,unschedule:()=>{}};
  const controller=sync.createSyncController(options);
  if(mode==='settings-refused'){await assert.rejects(controller.run(),/ACK refused/);assert.equal(reservations,0);assert.equal(posts,0);continue;}
  if(mode.startsWith('lost-')){await assert.rejects(controller.run(),/lost replacement reply/);const restart=sync.createSyncController(options);await restart.startup();}else await controller.run();
  assert.equal(head.rootFolderId,'replacement');assert.equal(gen,mode==='no-head'?1:6,'generation stays monotonic');assert.equal(reservations,1);assert.equal(posts,7,'exactly four folders, full payload, state and manifest');assert.equal([...objects.values()].filter(e=>e.kind==='payload').length,1);assert.equal(metadata.uploadIntent,null);assert.equal(state.state.fs.n.content,'current local data');
 }
 console.log('GOOGLE_DRIVE_RECREATE_PASS: deleted root with/without accepted head, complete local upload, lost replies/restart, durable ACK refusal.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={main};
