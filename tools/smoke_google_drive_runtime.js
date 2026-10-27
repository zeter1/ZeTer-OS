'use strict';
// Inert VM fixtures: no app startup, real account, browser storage, native API or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');
const sandbox={window:{ZETER_CORE_UTILS:{escapeHtml:v=>String(v),bytesToHuman:v=>String(v)}},crypto:webcrypto,Blob,File,FormData,URL,URLSearchParams,Uint8Array,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,btoa,atob,console};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/core/google-drive-backup-utils.js'),'utf8'),sandbox);
const utils=sandbox.window.ZETER_GOOGLE_DRIVE_BACKUP_UTILS;
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});}
async function main(){
 await backgroundPanelCompletion();
 // Listing before the first ZIP must never create an empty Drive folder.
 let emptyFolderWrites=0;
 const emptyDrive=utils.createWebTransport({
   fetch:async(url,init)=>{if(init?.method==='POST')emptyFolderWrites++;return json({files:[]});},
   loadConfig:async()=>({webClientId:'synthetic-client'}),
   oauth:{initTokenClient:opts=>({requestAccessToken(){opts.callback({access_token:'synthetic',expires_in:3600});}})}
 });
 await emptyDrive.connect();
 assert.equal((await emptyDrive.list()).entries.length,0);
 assert.equal(emptyFolderWrites,0,'read-only list cannot write a folder to a fresh Google Drive');
 const bridgeCalls=[];const strictNative=utils.createNativeTransport((...args)=>{bridgeCalls.push(args);assert.equal(args.length,1,'Python zero-argument methods must not receive an undefined/null payload');return {configured:true,connected:false};});
 await strictNative.status();await strictNative.connect();await strictNative.list();await strictNative.head();await strictNative.allocateId();await strictNative.disconnect();assert.deepEqual(bridgeCalls.map(args=>args[0]),['google_drive_status','google_drive_connect','google_drive_list','google_drive_sync_head','google_drive_allocate_id','google_drive_disconnect']);
 const folderPayload={name:'synthetic folder',kind:'root',operationId:'synthetic-operation'};const payloadNative=utils.createNativeTransport((...args)=>{assert.equal(args.length,2);assert.equal(args[0],'google_drive_make_folder');assert.equal(args[1],folderPayload);return {};});await payloadNative.makeFolder(folderPayload);
 let now=100000,foreign=false,badHash=false,unauthorized=false,uploads=0,hanging=false,aborted=false;
 const blob=new Blob(['synthetic verified archive'],{type:'application/zip'}),digest=await utils.sha256(blob);
 const metadata={id:'backup-one',name:'Копия.zip',createdTime:'2026-10-26T10:00:00Z',size:String(blob.size),mimeType:'application/zip',parents:['folder-one'],appProperties:{app:'zeter-os-backup',kind:'backup-v1',sha256:digest,operationId:'operation-one'}};
 const fetcher=async(url,init)=>{
  if(hanging)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(Object.assign(new Error('abort'),{name:'AbortError'}));}));
  if(unauthorized)return json({},401);
  const u=new URL(url);
  if(u.searchParams.get('alt')==='media')return new Response(badHash?'corrupt':await blob.arrayBuffer());
  if(u.pathname.includes('/upload/')){uploads++;return json(metadata);}
  if(u.pathname.endsWith('/backup-one'))return json({...metadata,parents:foreign?['foreign-folder']:['folder-one']});
  const q=u.searchParams.get('q')||'';
  if(q.includes("mimeType='application/vnd.google-apps.folder'"))return json({files:[{id:'folder-one'}]});
  if(q.includes("key='operationId'"))return json({files:uploads?[metadata]:[]});
  return json({files:[metadata]});
 };
 const oauth={initTokenClient:opts=>({requestAccessToken(){opts.callback({access_token:'synthetic-token',expires_in:3600});}}),revoke(token,done){done();}};
 const web=utils.createWebTransport({fetch:fetcher,oauth,loadConfig:async()=>({webClientId:'synthetic-client'}),now:()=>now,timeoutMs:15});
 assert.equal((await web.status()).connected,false);await web.connect();assert.equal((await web.status()).sessionLimited,true);
 assert.equal((await web.list()).entries[0].id,'backup-one');
 assert.equal(await (await web.download('backup-one')).text(),await blob.text());
 foreign=true;await assert.rejects(web.download('backup-one'),/не принадлежит/);foreign=false;
 badHash=true;await assert.rejects(web.download('backup-one'),/сумма/);badHash=false;
 await web.upload({blob,name:'Копия.zip',operationId:'operation-one'});await web.upload({blob,name:'Копия.zip',operationId:'operation-one'});assert.equal(uploads,1,'same operation is remotely reconciled instead of uploaded again');
 now+=3600000;await assert.rejects(web.list(),/истёк/);assert.equal((await web.status()).connected,false);
 await web.connect();unauthorized=true;await assert.rejects(web.list(),/истёк/);unauthorized=false;assert.equal((await web.status()).connected,false);
 await web.connect();hanging=true;await assert.rejects(web.list(),/вовремя/);assert.equal(aborted,true,'deadline aborts network');hanging=false;
 await web.connect();hanging=true;const pending=web.list();await new Promise(resolve=>setTimeout(resolve,0));await web.disconnect();await assert.rejects(pending,e=>e.cancelled===true);hanging=false;
 const preferences=[];let finishBuild,builds=0,cloudUploads=0;
 const state={configured:true,connected:true};
 const controller=utils.createController({transport:{status:async()=>state,list:async()=>({entries:[]}),disconnect:async()=>{state.connected=false;},upload:async()=>{cloudUploads++;return {entry:{id:'synthetic'}};}},store:{read:async()=>null,write:async p=>preferences.push({...p})},isReady:()=>true,buildBackup:async()=>{builds++;await new Promise(resolve=>finishBuild=resolve);return blob;}});
 await controller.refresh();const create=controller.action('create');await new Promise(resolve=>setTimeout(resolve,0));await assert.rejects(controller.action('create'),/уже выполняется/);await controller.action('disconnect');finishBuild();await assert.rejects(create,e=>e.cancelled===true);assert.equal(builds,1);assert.equal(cloudUploads,0,'disconnect before snapshot completion prevents upload');assert.equal(preferences.at(-1).enabled,false);
 let finishUpload,failFirst=true;const ids=[];
 const retry=utils.createController({transport:{status:async()=>({configured:true,connected:true}),list:async()=>({entries:[]}),upload:async value=>{ids.push(value.operationId);if(failFirst){failFirst=false;throw new Error('ambiguous');}return {entry:{id:'done'}};}},store:{read:async()=>null,write:async()=>{}},isReady:()=>true,buildBackup:async()=>blob});
 await retry.refresh();await assert.rejects(retry.action('create'),/ambiguous/);await retry.action('create');assert.equal(ids[0],ids[1],'explicit retry retains operation ID and snapshot');
 let refusePreferences=true,scheduledUploads=0;const persistedPreferences={enabled:false,intervalHours:24,lastSuccessAt:0};
 const settingsRoot={querySelector:selector=>selector==='[data-drive-interval]'?{value:'1'}:{checked:true}};
 const scheduler=utils.createController({now:()=>100000000,schedule:()=>null,cancelSchedule:()=>{},transport:{status:async()=>({configured:true,connected:true}),list:async()=>({entries:[]}),upload:async()=>{scheduledUploads++;return {entry:{id:'scheduled'}};}},store:{read:async()=>({...persistedPreferences}),write:async value=>{if(refusePreferences)throw new Error('preference write refused');Object.assign(persistedPreferences,value);}},isReady:()=>true,buildBackup:async()=>blob});
 await scheduler.refresh();await assert.rejects(scheduler.action({name:'configure'},settingsRoot),/preference write refused/);await scheduler.tick();assert.equal(scheduledUploads,0,'rejected enable must not activate scheduler');assert.equal(persistedPreferences.enabled,false);
 refusePreferences=false;await scheduler.action({name:'configure'},settingsRoot);await scheduler.tick();assert.equal(scheduledUploads,1,'explicit retry enables scheduler only after persistence ACK');scheduler.stop();
 let connectionCalls=0,autoRuns=0,refuseAutoEnable=true;const syncPolicy={enabled:false,onboardingVersion:0},syncConnection={configured:true,connected:false,persistent:true};
 const autoTransport={status:async()=>({...syncConnection}),connect:async()=>{connectionCalls++;syncConnection.connected=true;return {...syncConnection};}};
 const autoSync={settings:async()=>({...syncPolicy}),getStatus:()=>({phase:syncPolicy.enabled?'synced':'local',text:'synthetic sync status'}),configure:async enabled=>{assert.equal(enabled,true,'Connect always requests automatic synchronization');if(refuseAutoEnable)throw new Error('sync settings ACK refused');syncPolicy.enabled=true;autoRuns++;}};
 const autoPanel=utils.createSyncPanelController({transport:autoTransport,sync:autoSync});await autoPanel.refresh();await assert.rejects(autoPanel.action('connect'),/ACK refused/);assert.equal(connectionCalls,1,'Connect opens account authorization without a rules checkbox');assert.equal(syncPolicy.enabled,false);assert.equal(autoRuns,0,'refused enable cannot start synchronization');
 const disabledReload=utils.createSyncPanelController({transport:autoTransport,sync:autoSync});await disabledReload.refresh();assert.equal(syncPolicy.enabled,false,'refresh/reload cannot implicitly enable an old disabled preference');assert.equal(autoRuns,0);
 refuseAutoEnable=false;await disabledReload.action('connect');assert.equal(syncPolicy.enabled,true);assert.equal(autoRuns,1,'successful Connect starts automatic sync without a second control');assert.equal(connectionCalls,1,'retry after settings refusal reuses the established account connection');
 const nativeCalls=[];const native=utils.createNativeTransport(async(method)=>{nativeCalls.push(method);return {};});
 const upload=native.upload({blob,name:'test.zip',operationId:'operation-native'});await native.disconnect();await assert.rejects(upload,e=>e.cancelled===true);assert.deepEqual(nativeCalls,['google_drive_disconnect'],'native base64 conversion cannot publish after disconnect');
 const listeners=new Set(),popup={closed:false,location:{href:''},close(){this.closed=true;}};
 const host={location:{origin:'https://app.example'},open:()=>{popup.closed=false;return popup;},addEventListener:(name,listener)=>listeners.add(listener),removeEventListener:(name,listener)=>listeners.delete(listener)};
 let stored=null,tokenRequests=0,finishToken=null;
 const brokerOptions={brokerUrl:'https://broker.example',host,now:()=>now,store:{read:async()=>stored,write:async p=>{stored=p;}},fetch:async(url,init)=>{assert.equal(init.credentials,'omit');assert.equal(JSON.parse(init.body)&&Object.keys(JSON.parse(init.body)).length,0);if(url.endsWith('/disconnect'))return json({disconnected:true});tokenRequests++;if(finishToken===true)return new Promise(resolve=>{finishToken=()=>resolve(json({accessToken:'late-token',expiresAt:now+3600000}));});return json({accessToken:'broker-token',expiresAt:now+3600000});}};
 const broker=utils.createBrokerAuth(brokerOptions);const login=broker.connect();await new Promise(resolve=>setTimeout(resolve,0));const nonce=new URL(popup.location.href).searchParams.get('nonce'),handle='s'.repeat(43);
 const message={origin:'https://broker.example',source:popup,data:{type:'zeter-google-drive-auth',nonce,sessionHandle:handle}};
 for(const listener of listeners){listener({...message,origin:'https://attacker.example'});listener({...message,source:{}});listener({...message,data:{...message.data,nonce:'wrong'}});}assert.equal(stored,null,'spoofed callback cannot persist authentication');
 for(const listener of [...listeners])listener(message);await login;assert.equal(stored.handle,handle);assert.equal(tokenRequests,1);assert.equal((await broker.status()).persistent,true);
 await Promise.all([broker.getToken(),broker.getToken()]);assert.equal(tokenRequests,1,'valid in-memory access token reused');now+=3600000;await Promise.all([broker.getToken(),broker.getToken()]);assert.equal(tokenRequests,2,'expired access token refresh deduplicated');
 const reloaded=utils.createBrokerAuth(brokerOptions);await reloaded.getToken();assert.equal(tokenRequests,3,'persisted handle reconnects silently after reload');
 now+=3600000;finishToken=true;const refreshing=reloaded.getToken();await new Promise(resolve=>setTimeout(resolve,0));await reloaded.disconnect();finishToken();await assert.rejects(refreshing,e=>e.cancelled===true);assert.equal(stored.handle,'');assert.equal((await reloaded.status()).connected,false,'late token cannot reconnect after disconnect');
 const cancelledLogin=broker.connect();await broker.disconnect();await assert.rejects(cancelledLogin,e=>e.cancelled===true);assert.equal(listeners.size,0,'cancel removes callback listener');
 const invalid=utils.createBrokerAuth({...brokerOptions,store:{read:async()=>({handle}),write:async()=>{}},fetch:async()=>json({},401)});await assert.rejects(invalid.getToken(),/истёк/);assert.equal((await invalid.status()).needsReconnect,true);
 const statusBox={textContent:'',dataset:{}},operationBox={textContent:''},conflictBox={hidden:false};const mounted={isConnected:true,querySelector:selector=>({'[data-drive-status]':statusBox,'[data-drive-operation]':operationBox,'[data-drive-conflict]':conflictBox}[selector]||null),querySelectorAll:()=>[]};
 let rejectPreferences=true;const failingPreferences={getStatus:()=>({phase:'local',text:'synthetic local'}),settings:async()=>{if(rejectPreferences)throw new Error('Synthetic preferences read refused');return {enabled:false};}};
 const knownConfigPanel=utils.createSyncPanelController({transport:{status:async()=>({configured:true,connected:false})},sync:failingPreferences});knownConfigPanel.mount(mounted);await assert.rejects(knownConfigPanel.refresh(),/preferences read refused/);assert.ok(!statusBox.textContent.includes('не настроен'),'preferences failure cannot falsely report missing OAuth config');assert.match(statusBox.textContent,/preferences read refused/);rejectPreferences=false;await knownConfigPanel.refresh();assert.ok(!statusBox.textContent.includes('refused'),'successful retry clears stale error');
 const unavailablePanel=utils.createSyncPanelController({transport:{status:async()=>{throw new Error('Synthetic bridge unavailable');}},sync:failingPreferences});unavailablePanel.mount(mounted);await assert.rejects(unavailablePanel.refresh(),/bridge unavailable/);assert.match(statusBox.textContent,/Не удалось проверить подключение/);assert.ok(!statusBox.textContent.includes('не настроен'));
 await stableSyncIds();
 await deletedRootRecreation();
 console.log('GOOGLE_DRIVE_RUNTIME_PASS: owned ID/hash/size; upload reconciliation; expiry/401; timeout; duplicate/disconnect; same-snapshot retry; native invalidation; broker spoof guard, persistent refresh/dedupe/reload, late-token/cancel protection, invalid grant; ungated Connect; accurate configuration/read-failure status; bootstrap/fixed-ID lost reply restart, canonical reuse, strict collisions and directory reservation.');
}
async function stableSyncIds(){
 const files=new Map(),bytes=new Map(),accountKey='a'.repeat(64),folderMime='application/vnd.google-apps.folder';let allocated=0,posts=0,lost=false,hidden=false,reservation=null,directory=null,detectMime=null;
 const auth={getToken:async()=>({accessToken:'synthetic',expiresAt:Date.now()+3600000}),syncBootstrap:async value=>{if(value.expectedGeneration!==0)return {conflict:true};if(!reservation&&value.bootstrap)reservation=structuredClone(value.bootstrap);return {accountKey,generation:0,head:null,bootstrap:reservation};},syncDirectory:async value=>{if(value.expectedGeneration!==1)return {conflict:true};if(!directory&&value.id)directory=value.id;return {accountKey,id:directory};}};
 const fetch=async(url,init)=>{const u=new URL(url);if(u.pathname.endsWith('/generateIds'))return json({ids:['reserved_'+(++allocated)]});
  if(init.method==='POST'){let metadata,blob;if(init.body instanceof FormData){metadata=JSON.parse(await init.body.get('metadata').text());blob=init.body.get('file');}else metadata=JSON.parse(init.body);if(files.has(metadata.id))return json({},409);posts++;const entry={...metadata,parents:metadata.parents||['mydrive'],createdTime:'2026-10-26T10:00:00Z',...(blob?{size:String(blob.size)}:{}),...(blob&&metadata.appProperties.kind==='payload'&&detectMime?{mimeType:detectMime}:{})};files.set(entry.id,entry);if(blob)bytes.set(entry.id,await blob.arrayBuffer());if(lost){lost=false;throw new Error('Synthetic lost POST reply');}return json(entry);}
  if(u.pathname==='/drive/v3/files'){const q=u.searchParams.get('q')||'';let values=[...files.values()];const parent=q.match(/'([^']+)' in parents/);if(parent)values=values.filter(file=>file.parents.includes(parent[1]==='root'?'mydrive':parent[1]));return json({files:hidden?[]:values});}
  const id=u.pathname.split('/').pop();if(!files.has(id))return json({},404);if(u.searchParams.get('alt')==='media')return new Response(bytes.get(id));return json(files.get(id));};
 const create=()=>utils.createWebTransport({fetch,auth}),web=create();
 const structure=(await web.bootstrap({expectedGeneration:0})).bootstrap;assert.equal(posts,0,'reserve only IDs before Drive mutations');assert.equal(allocated,4);
 hidden=true;assert.deepEqual((await create().bootstrap({expectedGeneration:0})).bootstrap,structure);assert.equal(allocated,4,'reload uses existing reservation before generateIds');
 for(const kind of ['root','data','history','staging']){const input={id:structure[kind+'FolderId'],name:{root:'ZeTer OS',data:'data',history:'.zeter-sync-history',staging:'.zeter-sync-staging'}[kind],kind,operationId:'1'.repeat(32),...(kind==='root'?{}:{parentId:structure.rootFolderId})};lost=true;await assert.rejects(web.makeFolder(input),/lost POST/);const prior=await create().makeFolder({...input,operationId:'2'.repeat(32)});assert.equal(prior.entry.id,input.id);await assert.rejects(web.makeFolder({...input,name:'wrong'}),/другим объектом/);}
 assert.deepEqual((await create().bootstrap({expectedGeneration:0})).bootstrap,structure);reservation=null;hidden=false;assert.deepEqual((await create().bootstrap({expectedGeneration:0})).bootstrap,structure,'discovery reuses actual engine folder names after intent changes');assert.equal(allocated,4);
 assert.equal(posts,4,'one canonical object per folder despite hidden listing and lost responses');
 const blob=new Blob(['verified fixed ID bytes']),id=(await web.allocateId()).id,payload={id,name:'state.json',kind:'state',mimeType:'application/json',parentId:structure.stagingFolderId,pathKey:'b'.repeat(64),operationId:'3'.repeat(32),blob};
 lost=true;await assert.rejects(web.putFile(payload),/lost POST/);await create().putFile(payload);assert.equal(posts,5,'restart rechecks exact file ID without an extra byte upload');
 for(const patch of [{name:'wrong'},{pathKey:'c'.repeat(64)},{parentId:structure.dataFolderId},{blob:new Blob(['changed'])}])await assert.rejects(web.putFile({...payload,...patch}),/другим объектом/);
 const binaryId=(await web.allocateId()).id,binary={...payload,id:binaryId,name:'image.png',kind:'payload',mimeType:'application/octet-stream',operationId:'5'.repeat(32)};
 await web.putFile(binary);const binaryPosts=posts;
 for(const detected of ['image/png','image/jpeg','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']){files.get(binaryId).mimeType=detected;assert.equal((await create().putFile(binary)).entry.id,binaryId,'MIME detection reuses verified binary ID');}
 assert.equal(posts,binaryPosts,'MIME detection retry uploads zero bytes');
 for(const detected of [folderMime,'application/vnd.google-apps.document','invalid']){files.get(binaryId).mimeType=detected;await assert.rejects(web.putFile(binary));}
 files.get(binaryId).mimeType='image/png';
 for(const patch of [{name:'wrong'},{parentId:structure.dataFolderId},{pathKey:'c'.repeat(64)},{operationId:'6'.repeat(32)},{blob:new Blob(['changed'])}])await assert.rejects(web.putFile({...binary,...patch}));
 files.get(id).mimeType='text/plain';await assert.rejects(web.putFile(payload),'state MIME stays exact');files.get(id).mimeType='application/json';
 const value={expectedGeneration:1,rootFolderId:structure.rootFolderId,parentId:structure.dataFolderId,name:'Папка',pathKey:'d'.repeat(64),operationId:'4'.repeat(32)};
 const directoryId=(await web.directoryId(value)).id;const folder={...value,id:directoryId,kind:'directory'};await web.makeFolder(folder);assert.equal((await create().directoryId(value)).id,directoryId);assert.equal(posts,7);assert.equal((await web.directoryId({...value,expectedGeneration:0})).conflict,true);
 detectMime='image/png';const fresh={...binary,id:(await web.allocateId()).id,operationId:'7'.repeat(32)};assert.equal((await web.putFile(fresh)).entry.mimeType,'image/png','initial upload verifies bytes with detected MIME');detectMime=null;
 // Verify pre-existing directories are selected before allocation, with no mutation.
 directory=null;hidden=false;const count=allocated;assert.equal((await create().directoryId(value)).id,directoryId);assert.equal(allocated,count);
 // Duplicate child folders are ambiguous; only direct My Drive roots participate.
 files.clear();bytes.clear();reservation=null;directory=null;
 const root={id:'oldest_root',name:'ZeTer OS',mimeType:folderMime,parents:['mydrive'],createdTime:'2026-10-20T10:00:00Z',appProperties:{app:'zeter-os',format:'sync-v1',kind:'root'}};
 files.set(root.id,root);files.set('newer_root',{...root,id:'newer_root',createdTime:'2026-10-26T10:00:00Z'});files.set('nested_root',{...root,id:'nested_root',parents:['foreign_parent'],createdTime:'2026-10-01T10:00:00Z'});
 for(const kind of ['data','history','staging']){for(const suffix of ['a','b'])files.set('duplicate_'+suffix,{...root,id:'duplicate_'+suffix,name:{data:'data',history:'.zeter-sync-history',staging:'.zeter-sync-staging'}[kind],parents:[root.id],appProperties:{...root.appProperties,kind}});const before=JSON.stringify([...files]),priorPosts=posts;await assert.rejects(create().bootstrap({expectedGeneration:0}),/несколько/);assert.equal(reservation,null,'ambiguous child must not publish a reservation');assert.equal(posts,priorPosts);assert.equal(JSON.stringify([...files]),before);files.delete('duplicate_a');files.delete('duplicate_b');}
 const beforeRoots=JSON.stringify([...files]),canonical=await create().bootstrap({expectedGeneration:0});assert.equal(canonical.bootstrap.rootFolderId,root.id);assert.equal(JSON.stringify([...files]),beforeRoots,'existing roots must stay untouched');
 const bootstrapCalls=[];const native=utils.createNativeTransport((method,payload)=>{bootstrapCalls.push([method,payload]);return method==='google_drive_bootstrap'?{bootstrap:structure}:{id:directoryId};});await native.bootstrap({expectedGeneration:0});await native.directoryId(value);assert.deepEqual(bootstrapCalls.map(item=>item[0]),['google_drive_bootstrap','google_drive_directory_id']);
}
async function deletedRootRecreation(){
 const accountKey='a'.repeat(64),folderMime='application/vnd.google-apps.folder',files=new Map();let allocated=0,posts=0,failure=null,reservation=null,replacement=null,loseReply=false,recreateCalls=0;
 const accepted={generation:3,parentGeneration:2,rootFolderId:'old_root',snapshotId:'1'.repeat(32),manifestFileId:'old_manifest',manifestSha256:'2'.repeat(64),contentHash:'3'.repeat(64),operationId:'4'.repeat(32),committedAt:1793000000000};let currentHead=accepted,currentGeneration=3;
 const envelope=()=>({accountKey,head:currentHead,generation:currentGeneration});
 const folder=(id,kind,parent,trashed=false)=>({id,name:{root:'ZeTer OS',data:'data',history:'.zeter-sync-history',staging:'.zeter-sync-staging'}[kind],mimeType:folderMime,parents:parent?[parent]:['mydrive'],createdTime:'2026-10-26T10:00:00Z',trashed,appProperties:{app:'zeter-os',format:'sync-v1',kind}});
 files.set('old_root',folder('old_root','root',null,true));
 const auth={getToken:async()=>({accessToken:'synthetic',expiresAt:Date.now()+3600000}),syncHead:async()=>envelope(),syncBootstrap:async value=>{assert.equal(value.bootstrap,null,'head only reads the existing reservation');return {...envelope(),bootstrap:reservation};},syncRecreate:async value=>{recreateCalls++;assert.deepEqual(Object.keys(value).sort(),['bootstrap','expectedGeneration','oldRootFolderId']);assert.equal(value.oldRootFolderId,'old_root');if(value.expectedGeneration!==currentGeneration)return {...envelope(),conflict:true};replacement||=structuredClone(value.bootstrap);reservation=replacement;if(loseReply){loseReply=false;throw new Error('Synthetic lost reservation reply');}return {...envelope(),bootstrap:replacement};}};
 const fetch=async(url,init)=>{if(init.method==='POST'){posts++;const metadata=JSON.parse(init.body),file={...folder(metadata.id,metadata.appProperties.kind),...metadata};files.set(file.id,file);return json(file);}const path=new URL(url).pathname;if(path.endsWith('/generateIds'))return json({ids:['candidate_'+(++allocated)]});if(failure==='network')throw new Error('Synthetic network failure');if(failure)return json({},failure);const file=files.get(path.split('/').pop());return file?json(file):json({},404);};
 const create=()=>utils.createWebTransport({auth,fetch}),web=create();
 assert.equal((await web.head()).missingRootFolderId,'old_root');assert.equal(allocated,0);files.delete('old_root');assert.equal((await web.head()).missingRootFolderId,'old_root');
 for(const status of [401,403,500,'network']){failure=status;const before=allocated;await assert.rejects(web.recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'}));assert.equal(allocated,before,'auth/network errors cannot reserve candidates');}failure=null;
 files.set('old_root',folder('old_root','root',null,true));for(const delta of [{appProperties:{app:'foreign',format:'sync-v1',kind:'root'}},{appProperties:{app:'zeter-os',format:'sync-v1',kind:'data'}},{mimeType:'text/plain'},{trashed:'true'}]){files.set('old_root',{...folder('old_root','root',null,true),...delta});await assert.rejects(web.head());}files.set('old_root',folder('old_root','root',null,false));assert.equal((await web.head()).missingRootFolderId,undefined);assert.equal((await web.recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'})).conflict,true);assert.equal(allocated,0);
 files.set('old_root',folder('old_root','root',null,true));loseReply=true;await assert.rejects(web.recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'}),/lost reservation/);const winner=structuredClone(replacement);
 for(const kind of ['root','data','history','staging'])files.set(winner[kind+'FolderId'],folder(winner[kind+'FolderId'],kind,kind==='root'?null:winner.rootFolderId));
 const results=await Promise.all([create().recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'}),create().recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'})]);for(const result of results)assert.deepEqual(result.bootstrap,winner);assert.equal(posts,0);assert.equal(recreateCalls,3);assert.equal((await web.head()).missingRootFolderId,'old_root','pending active replacement does not hide old accepted deletion');assert.equal((await web.bootstrap({expectedGeneration:3})).bootstrap.rootFolderId,winner.rootFolderId);
 files.get(winner.historyFolderId).trashed=true;await assert.rejects(web.recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'}));files.get(winner.historyFolderId).trashed=false;
 const beforeStale=allocated;assert.equal((await web.recreateRoot({expectedGeneration:2,oldRootFolderId:'old_root'})).conflict,true);assert.equal(allocated,beforeStale);
 currentHead=null;currentGeneration=0;reservation=null;assert.equal((await web.head()).missingRootFolderId,undefined);assert.equal(allocated,beforeStale);reservation=winner;assert.equal((await web.head()).missingRootFolderId,undefined);files.get(winner.rootFolderId).trashed=true;assert.equal((await web.head()).missingRootFolderId,winner.rootFolderId);
 files.delete(winner.rootFolderId);assert.equal((await web.head()).missingRootFolderId,undefined,'unmaterialized null-head reservation404 does not prove deletion');assert.equal(allocated,beforeStale);assert.equal(posts,0);
 reservation={rootFolderId:'old_root',dataFolderId:'old_data',historyFolderId:'old_history',stagingFolderId:'old_staging'};replacement=null;loseReply=true;
 await assert.rejects(web.recreateRoot({expectedGeneration:0,oldRootFolderId:'old_root'}),/lost reservation/);const unmaterialized=structuredClone(reservation),afterLost=allocated,afterRecreateCalls=recreateCalls;
 assert.equal(files.has(unmaterialized.rootFolderId),false);assert.equal((await create().head()).missingRootFolderId,undefined);assert.equal((await create().recreateRoot({expectedGeneration:0,oldRootFolderId:'old_root'})).conflict,true);
 assert.deepEqual((await create().bootstrap({expectedGeneration:0})).bootstrap,unmaterialized);assert.equal(allocated,afterLost);assert.equal(recreateCalls,afterRecreateCalls);assert.equal(posts,0);
 assert.equal((await create().makeFolder({id:unmaterialized.rootFolderId,name:'ZeTer OS',kind:'root',operationId:'b'.repeat(32)})).entry.id,unmaterialized.rootFolderId);assert.equal(allocated,afterLost);assert.equal((await web.head()).missingRootFolderId,undefined);
 const calls=[],native=utils.createNativeTransport((...args)=>{calls.push(args);return {};});await native.recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root',ignored:'never forwarded'});assert.equal(calls[0].length,2);assert.equal(calls[0][0],'google_drive_recreate_root');assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{expectedGeneration:3,oldRootFolderId:'old_root'});
 currentHead=accepted;currentGeneration=3;let cancelWeb,tokenReads=0,reserveAfterCancel=0,allocationsAfterCancel=0;
 cancelWeb=utils.createWebTransport({auth:{...auth,getToken:async()=>{if(++tokenReads===2)await cancelWeb.disconnect();return {accessToken:'synthetic',expiresAt:Date.now()+3600000};},disconnect:async()=>{},status:async()=>({connected:false}),syncRecreate:async()=>{reserveAfterCancel++;throw new Error('Recreate after cancel');}},fetch:async(url,init)=>{if(url.includes('/generateIds'))allocationsAfterCancel++;return fetch(url,init);}});
 await assert.rejects(cancelWeb.recreateRoot({expectedGeneration:3,oldRootFolderId:'old_root'}),error=>error.cancelled===true);assert.equal(reserveAfterCancel,0);assert.equal(allocationsAfterCancel,0,'disconnect during token await must stop the next request');
 const brokerCalls=[],broker=utils.createBrokerAuth({brokerUrl:'https://sync.example.test/',store:{read:async()=>({handle:'h'.repeat(43)}),write:async()=>{}},fetch:async(url,init)=>{brokerCalls.push([url,JSON.parse(init.body)]);return json({error:'sync-conflict',accountKey,head:null,generation:0},409);}});assert.equal((await broker.syncRecreate({expectedGeneration:0,oldRootFolderId:'old_root',bootstrap:winner})).conflict,true);assert.equal(brokerCalls[0][0],'https://sync.example.test/sync/recreate');
 console.log('DELETED_ROOT_RUNTIME_PASS: canonical trash/404 vs auth/network/foreign; reservation-only head; concurrent/lost-response winner; pending head; trashed replacement refusal; native arity; broker 409.');
}
async function backgroundPanelCompletion(){
 for(const file of ['cloud-payload-utils.js','google-drive-sync-utils.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/core',file),'utf8'),sandbox);
 const boxes=Object.fromEntries(['status','operation','conflict'].map(key=>[key,{textContent:'',dataset:{},hidden:true}]));
 const buttons=['choose-local','choose-cloud'].map(driveAction=>({dataset:{driveAction},disabled:false}));
 const root={isConnected:true,querySelector:selector=>boxes[selector.match(/^\[data-drive-(\w+)\]$/)?.[1]]||null,querySelectorAll:()=>buttons};
 let panel;
 const controller=sandbox.window.ZETER_GOOGLE_DRIVE_SYNC_UTILS.createSyncController({
  provider:{head:async()=>({accountKey:'synthetic-account',generation:1,head:{snapshotId:'synthetic-head',contentHash:'different'}})},
  store:{read:async()=>({enabled:true}),write:async()=>{}},
  collect:async()=>({stateRecord:{app:'ZeTer OS',state:{fs:{},settings:{}}},files:[]}),
  preserve:async()=> 'synthetic-branch',isEmpty:()=>false,onStatus:()=>panel?.render()
 });
 panel=utils.createSyncPanelController({transport:{status:async()=>({configured:true,connected:true})},sync:controller});
 panel.mount(root);await panel.refresh();await controller.run();
 // Drain the panel's async settings read; no manual refresh or panel action.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(controller.getStatus().phase,'conflict');
 assert.equal((await controller.settings()).busy,false);
 assert.equal(boxes.conflict.hidden,false);
 assert.equal(buttons[0].disabled,false,'background conflict completion must unlock version choice without a manual refresh');
 assert.equal(boxes.operation.textContent,'','completed background check must clear its busy text');
 const disconnectedPanel=utils.createSyncPanelController({transport:{status:async()=>({configured:true,connected:false})},sync:controller});
 disconnectedPanel.mount(root);await disconnectedPanel.refresh();
 assert.equal(boxes.conflict.hidden,true,'saved conflict is not current cloud evidence while disconnected');
 await assert.rejects(disconnectedPanel.action('choose-local'),/подключ|свер/i,'disconnected choice cannot start a transfer');
 const refused=sandbox.window.ZETER_GOOGLE_DRIVE_SYNC_UTILS.createSyncController({
  provider:{head:async()=>({accountKey:'synthetic-account',generation:2,head:{snapshotId:'new-head',contentHash:'different'}})},
  store:{read:async()=>({enabled:true,conflict:{localHash:'old',head:{snapshotId:'old-head'}}}),write:async()=>{}},
  collect:async()=>({stateRecord:{app:'ZeTer OS',state:{fs:{},settings:{}}},files:[]}),
  preserve:async()=>{throw new Error('Synthetic safety copy refused');},isEmpty:()=>false
 });
 await assert.rejects(refused.run(),/safety copy refused/);
 assert.equal(refused.getStatus().phase,'offline','failure while refreshing a saved conflict must replace the loading status');
 assert.equal((await refused.settings()).busy,false);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={main};
