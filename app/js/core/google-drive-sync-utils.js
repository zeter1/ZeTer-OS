(() => {
  'use strict';
  const payload=()=>window.ZETER_CLOUD_PAYLOAD_UTILS;
  const id=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const clone=value=>JSON.parse(JSON.stringify(value));
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
  // Exact device-local telemetry owned by security-utils.normalizeSecurityMeta. Unknown fields remain data.
  const SECURITY_TELEMETRY=['lastFullBackupAt','lastFullBackupSize','lastFullBackupName','lastBackupVerifiedAt','lastBackupVerified','lastBackupChecksum','lastBackupChecksumAlgorithm','lastEncryptedBackupAt','lastRecoveryTestAt','lastRecoveryTestStatus','lastIntegrityCheckAt','lastIntegrityStatus','lastIntegrityOutcome','lastIntegrityBad','lastIntegrityWarn','lastAutoRestorePointAt','lastImportAt','lastCleanupAt','journal'];
  function normalizedRecord(record){const result=clone(record);if(result.state?.security)for(const key of SECURITY_TELEMETRY)delete result.state.security[key];return result;}
  const blob=value=>new Blob([canonical(value)],{type:'application/json'});
  async function collectModel(input){const stateRecord=normalizedRecord(input.stateRecord),stateBlob=blob(stateRecord),files=[];let bytes=stateBlob.size;const paths=new Set();
    for(const file of input.files||[]){const path=payload().safePath(file.path);if(paths.has(path)||path==='zeter-os-state.json')throw new Error('Повторяющийся путь данных синхронизации.');paths.add(path);bytes+=file.blob.size;if(bytes>payload().MAX_BYTES)throw new Error('Данные синхронизации превышают 120 МБ.');files.push({path,blob:file.blob,sha256:await payload().digest(file.blob),sizeBytes:file.blob.size});}
    for(const path of payload().references(stateRecord.state))if(!paths.has(path))throw new Error('Не найден обязательный файл локальной версии: '+path);
    files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);const stateSha=await payload().digest(stateBlob),contentHash=await payload().digest(blob({stateSha,files:files.map(f=>({path:f.path,sha256:f.sha256,sizeBytes:f.sizeBytes}))}));return {stateRecord,stateBlob,stateSha,files,contentHash,localBaseline:clone(input.localBaseline||input.stateRecord.state)};
  }
  function createSyncController(options) {
    const provider=options.provider,store=options.store;let meta=null,loaded=null,busy=false,epoch=0,stopped=false,timer=null,debounce=null,writes=Promise.resolve(),status={phase:'loading',text:'Читаем настройки синхронизации…'},conflict=null;
    let incoming=null,reconciled=null;const offered=new Set(),deferred=new Set();
    const now=options.now||Date.now,schedule=options.schedule||setTimeout,unschedule=options.unschedule||clearTimeout;
    const publicIncoming=()=>incoming?{key:incoming.key,snapshotId:incoming.head.snapshotId,generation:incoming.head.generation,contentHash:incoming.head.contentHash,text:'На Google Drive есть новые данные. Загрузить их на это устройство?',busy:incoming.busy,deferred:deferred.has(incoming.key)}:null;
    const changedIncoming=()=>options.onIncoming?.(publicIncoming());
    function clearIncoming(){if(incoming){incoming=null;changedIncoming();}}
    function offerIncoming(local,remote){report('incoming_offered',{cloudHeadPresent:true,cloudGeneration:remote.generation});const key=remote.accountKey+':'+remote.generation+':'+remote.head.snapshotId;if(incoming?.key!==key){incoming={key,head:clone(remote.head),accountKey:remote.accountKey,localHash:local.contentHash,busy:false};if(offered.has(key))deferred.add(key);offered.add(key);changedIncoming();}emit('incoming','На Google Drive есть новые данные. Подтверди загрузку на это устройство.');return status;}
    // Bounded, metadata-only breadcrumbs. Never transmit file paths, messages, IDs or tokens.
    const diagnosticAt=new Map();let syncAttempt=0;
    function report(driveEvent,fields={}) {
      if(!options.onDiagnostic)return;
      const safe={driveEvent,drivePhase:status.phase,syncAttempt,...fields};
      const key=JSON.stringify([driveEvent,safe.drivePhase,safe.driveError,safe.driveChoice,safe.cloudGeneration,safe.cloudHeadPresent,safe.rootMissing,safe.localChanged,safe.cloudChanged]);
      const timestamp=now(),previous=diagnosticAt.get(key);
      if(previous!==undefined&&timestamp>=previous&&timestamp-previous<300000)return;
      diagnosticAt.set(key,timestamp);
      if(diagnosticAt.size>100)diagnosticAt.clear();
      try{options.onDiagnostic(safe);}catch{/* Diagnostics must never affect sync. */}
    }
    const emit=(phase,text,details={})=>{status={phase,text,...details};report('phase',{conflictSaved:Boolean(meta?.conflict),uploadPending:Boolean(meta?.pending)});options.onStatus?.(status);};
    const ensure=()=>loaded||(loaded=store.read().then(value=>{meta={enabled:false,onboardingVersion:0,deviceId:id(),baseGeneration:null,baseLocalHash:null,baseCloudHash:null,...value};}));
    async function save(patch){const revision=epoch;const task=writes.catch(()=>{}).then(async()=>{if(revision!==epoch)throw Object.assign(new Error('Настройки синхронизации изменились.'),{cancelled:true});const candidate={...meta,...patch};await store.write(candidate);if(revision!==epoch)throw Object.assign(new Error('Синхронизация отменена после сохранения настроек.'),{cancelled:true});meta=candidate;});writes=task;return task;}
    const current=generation=>{if(generation!==epoch||stopped)throw Object.assign(new Error('Синхронизация отменена.'),{cancelled:true});};
    async function readFile(entry){if(!entry||!/^[\w-]{1,200}$/.test(entry.fileId||'' )||!/^[a-f0-9]{64}$/.test(entry.sha256||'')||!Number.isSafeInteger(entry.sizeBytes)||entry.sizeBytes<0||entry.sizeBytes>payload().MAX_BYTES)throw new Error('Некорректный файл облачной версии.');const result=await provider.readFile({id:entry.fileId,sha256:entry.sha256,sizeBytes:entry.sizeBytes});if(result.size!==entry.sizeBytes||await payload().digest(result)!==entry.sha256)throw new Error('Контрольная сумма облачного файла не совпала.');return result;}
    // Only a verified 404 for the accepted manifest authorizes explicit local recovery.
    async function readAcceptedManifest(head) {
      try {return await provider.readFile({id:head.manifestFileId,sha256:head.manifestSha256});}
      catch (error) {
        if(error?.acceptedManifestMissing===true || error?.httpStatus===404 || error?.message==='Принятый манифест облачной копии отсутствует в Google Drive.') {
          throw Object.assign(new Error('Облачная версия повреждена: манифест отсутствует в Google Drive. Восстанови копию явным выбором данных этого устройства.'),{acceptedManifestMissing:true});
        }
        throw error;
      }
    }
    async function readSnapshot(head){if(!head)return null;const manifestBlob=await readAcceptedManifest(head);if(await payload().digest(manifestBlob)!==head.manifestSha256)throw new Error('Манифест облачной версии повреждён.');let manifest;try{manifest=JSON.parse(await manifestBlob.text());}catch{throw new Error('Манифест облачной версии повреждён.');}
      if(manifest.schema!==1||manifest.format!=='zeter-sync-snapshot'||manifest.snapshotId!==head.snapshotId||manifest.contentHash!==head.contentHash||!Array.isArray(manifest.files)||manifest.files.length>10000||manifest.state?.path!=='zeter-os-state.json')throw new Error('Неподдерживаемая облачная версия.');
      const stateBlob=await readFile(manifest.state);let stateRecord;try{stateRecord=JSON.parse(await stateBlob.text());}catch{throw new Error('Состояние облачной версии повреждено.');}if(stateRecord.app!=='ZeTer OS'||!stateRecord.state?.fs||!stateRecord.state?.settings)throw new Error('В облачной версии нет состояния ZeTer OS.');
      const files=[];let size=stateBlob.size;const paths=new Set();for(const entry of manifest.files){const path=payload().safePath(entry.path);if(paths.has(path)||path==='zeter-os-state.json')throw new Error('Повторяющийся путь облачной версии.');paths.add(path);size+=entry.sizeBytes;if(size>payload().MAX_BYTES)throw new Error('Облачная версия превышает 120 МБ.');files.push({...entry,blob:await readFile(entry)});}
      const model=await collectModel({stateRecord,files});if(model.contentHash!==head.contentHash)throw new Error('Состав облачной версии не совпал с подтверждённой версией.');return {manifest,...model};
    }
    async function safeConflict(local,head,reason){clearIncoming();if(meta.conflict?.localHash===local.contentHash&&meta.conflict?.head?.snapshotId===head?.snapshotId){conflict=meta.conflict;emit('conflict',reason+' Обе версии сохранены. Выбери версию явно.');return status;}const branchId=await options.preserve({stateRecord:local.stateRecord,files:local.files.map(({path,blob,sha256})=>({path,blob,sha256})),head,reason});if(!branchId)throw new Error('Не удалось сохранить страховочную локальную версию. Выбор версии остановлен.');const nextConflict={branchId,head,localHash:local.contentHash};await save({conflict:{...nextConflict,reason}});conflict=nextConflict;emit('conflict',reason+' Обе версии сохранены. Выбери версию явно.');report('conflict_saved',{cloudHeadPresent:Boolean(head),conflictSaved:true,localChanged:true});return status;}
    async function verifyHead(expected){const live=await provider.head();if(!live.head||live.head.snapshotId!==expected.snapshotId||live.generation!==expected.generation)throw Object.assign(new Error('Облачная версия изменилась. Сверим её заново.'),{stale:true});return live;}
    async function reconcile(head,snapshot,generation){
      // The canonical immutable manifest is authoritative. The readable data tree follows only the current winner.
      const manifest=snapshot.manifest;await verifyHead(head);current(generation);
      const directoryCache=new Map([['',manifest.dataFolderId]]);
      async function directory(path){
        if(directoryCache.has(path))return directoryCache.get(path);
        const parts=path.split('/'),name=parts.pop(),parent=await directory(parts.join('/'));await verifyHead(head);current(generation);
        const pathKey=await payload().digest(new Blob([path])),operationId=(await payload().digest(blob([meta.accountKey,head.rootFolderId,'directory',path]))).slice(0,32);
        const reserved=await provider.directoryId({expectedGeneration:head.generation,rootFolderId:head.rootFolderId,parentId:parent,name,pathKey,operationId});current(generation);
        if(reserved.conflict)throw Object.assign(new Error('Облачная версия изменилась. Сверим её заново.'),{stale:true});
        if(!meta.uploadIntent)await intentFor(snapshot,{accountKey:meta.accountKey,generation:head.generation},generation);
        if(!meta.uploadIntent.fileIds[operationId]&&Object.keys(meta.uploadIntent.fileIds).length>=10000)throw new Error('План передачи заполнен. Создание папки остановлено.');
        await save({uploadIntent:{...meta.uploadIntent,fileIds:{...meta.uploadIntent.fileIds,[operationId]:reserved.id}}});current(generation);
        const made=await provider.makeFolder({id:reserved.id,parentId:parent,name,kind:'directory',pathKey,operationId});current(generation);directoryCache.set(path,made.entry.id);return made.entry.id;
      }
      // Removed files leave the current data tree, but remain available in owned recovery history.
      const wanted=new Set([...manifest.files,manifest.state].map(entry=>entry.fileId)),queue=[manifest.dataFolderId],visited=new Set();let scanned=0;
      while(queue.length){const parentId=queue.shift();if(visited.has(parentId))throw new Error('Повтор папки облачных данных.');visited.add(parentId);let pageToken='';const seenPages=new Set();do{if(seenPages.has(pageToken))throw new Error('Повтор страницы папки Google Drive.');seenPages.add(pageToken);await verifyHead(head);current(generation);const result=await provider.files({parentId,pageToken});for(const entry of result.entries||[]){if(++scanned>20000)throw new Error('Слишком много объектов в облачной папке данных.');if(entry.kind==='directory')queue.push(entry.id);else if(['state','payload'].includes(entry.kind)&&!wanted.has(entry.id)){await verifyHead(head);current(generation);await provider.moveFile({id:entry.id,parentId:manifest.historyFolderId,name:entry.name});}}pageToken=result.nextPageToken||'';}while(pageToken);}
      for(const entry of [...manifest.files,manifest.state]){await verifyHead(head);current(generation);const parts=entry.path.split('/'),name=parts.pop(),parentId=await directory(parts.join('/'));
        let pageToken='',seen=new Set(),alreadyThere=false;do{if(seen.has(pageToken))throw new Error('Повтор страницы папки Google Drive.');seen.add(pageToken);const result=await provider.files({parentId,pageToken});for(const old of result.entries||[]){if(old.id===entry.fileId&&old.name===name)alreadyThere=true;if(old.name===name&&old.id!==entry.fileId&&['state','payload'].includes(old.kind)){await verifyHead(head);current(generation);await provider.moveFile({id:old.id,parentId:manifest.historyFolderId,name:old.name});}}pageToken=result.nextPageToken||'';}while(pageToken);
        await verifyHead(head);current(generation);if(!alreadyThere)await provider.moveFile({id:entry.fileId,parentId,name});
      }
      await verifyHead(head);current(generation);
      reconciled={accountKey:meta.accountKey,head:canonical(head),checkedAt:now()};
    }
    async function intentFor(local,remote,generation){
      let intent=meta.uploadIntent;
      if(!intent||intent.accountKey!==remote.accountKey||intent.localHash!==local.contentHash||intent.expectedGeneration!==remote.generation){
        intent={accountKey:remote.accountKey,operationId:id(),snapshotId:id(),createdAt:now(),expectedGeneration:remote.generation,localHash:local.contentHash,bootstrap:intent?.accountKey===remote.accountKey&&intent?.expectedGeneration===remote.generation?intent.bootstrap:null,fileIds:intent?.accountKey===remote.accountKey?{...intent.fileIds}:{}};
        current(generation);await save({uploadIntent:intent,pending:null});
      }
      return intent;
    }
    async function fixedId(operationKey,generation){
      const intent=meta.uploadIntent;if(!intent)throw new Error('Не сохранён план передачи данных.');
      if(intent.fileIds[operationKey])return intent.fileIds[operationKey];
      if(Object.keys(intent.fileIds).length>=10000)throw new Error('План передачи заполнен. Передача остановлена без создания дубликатов.');
      const allocated=await provider.allocateId();current(generation);
      await save({uploadIntent:{...intent,fileIds:{...intent.fileIds,[operationKey]:allocated.id}}});current(generation);return allocated.id;
    }
    async function publish(local,remote,generation,allowMissingManifest=false){
      report('publish_start',{cloudHeadPresent:Boolean(remote.head),cloudGeneration:remote.generation,localFileCount:local.files.length});
      clearIncoming();
      let pending=meta.pending;
      if(!pending||pending.localHash!==local.contentHash||pending.expectedGeneration!==remote.generation){const intent=await intentFor(local,remote,generation),{operationId,snapshotId}=intent;
        const derived=async value=>(await payload().digest(new Blob([operationId+'\n'+value]))).slice(0,32);
        let old=null;
        if(remote.head) {
          try {old=await readSnapshot(remote.head);}
          catch(error) {
            if(!allowMissingManifest || !error.acceptedManifestMissing)throw error;
            // Explicitly chosen local branch only: do not reuse missing cloud bytes.
            report('failure',{driveError:'missing_cloud_snapshot',cloudHeadPresent:true});
          }
        }
        let structure=intent.bootstrap;
        const kinds=[['dataFolderId','data','data'],['historyFolderId','.zeter-sync-history','history'],['stagingFolderId','.zeter-sync-staging','staging']];
        // A verified accepted manifest is authoritative for the existing Drive
        // tree. The coordinator's older reservation may contain unusable IDs.
        if(old && remote.head){
          const trusted={rootFolderId:remote.head.rootFolderId,...Object.fromEntries(kinds.map(([key])=>[key,old.manifest[key]]))};
          const ids=Object.values(trusted);
          if(ids.some(value=>typeof value!=='string'||!/^[-_A-Za-z0-9]{1,160}$/.test(value))||new Set(ids).size!==4)throw new Error('Облачный манифест содержит некорректные идентификаторы папок.');
          structure=trusted;
          if(JSON.stringify(meta.uploadIntent?.bootstrap)!==JSON.stringify(trusted)){
            await save({uploadIntent:{...meta.uploadIntent,bootstrap:trusted}});
          }
        }
        if(!structure){const result=await provider.bootstrap({expectedGeneration:remote.generation});current(generation);if(result.conflict)throw Object.assign(new Error('Облачная версия изменилась. Сверим её заново.'),{stale:true});structure=result.bootstrap;await save({uploadIntent:{...meta.uploadIntent,bootstrap:structure}});}
        const rootFolderId=structure.rootFolderId;
        async function createFolders(candidate){
          current(generation);
          const rootOperation=await derived('root');
          await provider.makeFolder({id:rootFolderId,name:'ZeTer OS',kind:'root',operationId:rootOperation});current(generation);
          for(const [key,name,kind] of kinds){const operation=await derived(kind);current(generation);await provider.makeFolder({id:candidate[key],parentId:rootFolderId,name,kind,operationId:operation});current(generation);}
        }
        try{await createFolders(structure);}
        catch(error){
          if(!allowMissingManifest||old||!remote.head||rootFolderId!==remote.head.rootFolderId||error?.code!=='invalid_reserved_folder_id')throw error;
          // The user explicitly chose local recovery, but the broker's unused
          // child IDs are rejected by Drive. Only an empty owned root is eligible.
          const latest=await provider.head();current(generation);
          if(latest.generation!==remote.generation||latest.head?.snapshotId!==remote.head.snapshotId||latest.head?.rootFolderId!==rootFolderId)throw Object.assign(new Error('Облачная версия изменилась. Сверим её заново.'),{stale:true});
          const listing=await provider.files({parentId:rootFolderId});current(generation);
          if(!Array.isArray(listing?.entries)||listing.entries.length||listing.nextPageToken)throw new Error('Старая папка Google Drive уже содержит файлы. Замена зарезервированных ID остановлена.');
          const repaired={rootFolderId};
          for(const [key] of kinds){
            const allocated=await provider.allocateId();current(generation);
            if(!allocated?.id||!/^[-_A-Za-z0-9]{1,160}$/.test(allocated.id))throw new Error('Google Drive не подтвердил новые идентификаторы папок.');
            repaired[key]=allocated.id;
          }
          if(new Set(Object.values(repaired)).size!==4)throw new Error('Google Drive вернул повторяющиеся идентификаторы папок.');
          // Save all fresh IDs and forget only proven-unpublished file IDs before
          // issuing any write. A failed ACK leaves the cloud untouched.
          await save({uploadIntent:{...meta.uploadIntent,bootstrap:repaired,fileIds:{}},pending:null});current(generation);
          structure=repaired;
          report('reserved_ids_replaced',{cloudHeadPresent:true,cloudGeneration:remote.generation});
          await createFolders(structure);
        }
        const {dataFolderId,historyFolderId,stagingFolderId}=structure;
        const dirs={dataFolderId,historyFolderId,stagingFolderId};
        const previous=new Map((old?.manifest.files||[]).map(f=>[f.path,f])),reused=new Set();const files=[];
        async function put(path,bytes,sha,kind){current(generation);const key=(await payload().digest(blob([remote.accountKey,dirs.stagingFolderId,kind,path,sha]))).slice(0,32),pathKey=await payload().digest(new Blob([path])),fileId=await fixedId(key,generation);current(generation);const result=await provider.putFile({id:fileId,parentId:dirs.stagingFolderId,name:path.split('/').pop(),blob:bytes,mimeType:kind==='state'?'application/json':'application/octet-stream',kind,pathKey,operationId:key});current(generation);const record={path,fileId:result.entry.id,sha256:sha,sizeBytes:bytes.size};await readFile(record);return record;}
        for(const file of local.files){let prior=previous.get(file.path);if(prior?.sha256!==file.sha256||prior.sizeBytes!==file.sizeBytes||reused.has(prior.fileId))prior=[...previous.values()].find(entry=>entry.sha256===file.sha256&&entry.sizeBytes===file.sizeBytes&&!reused.has(entry.fileId));if(prior){reused.add(prior.fileId);files.push({...prior,path:file.path});}else files.push(await put(file.path,file.blob,file.sha256,'payload'));}
        const state=old?.manifest.state.sha256===local.stateSha?old.manifest.state:await put('zeter-os-state.json',local.stateBlob,local.stateSha,'state');
        const manifest={schema:1,format:'zeter-sync-snapshot',snapshotId,createdAt:intent.createdAt,deviceId:meta.deviceId,contentHash:local.contentHash,...dirs,state,files};const manifestBlob=blob(manifest),manifestSha256=await payload().digest(manifestBlob),manifestOperation=await derived('snapshot\n'+manifestSha256),manifestId=await fixedId(manifestOperation,generation);current(generation);const uploaded=await provider.putFile({id:manifestId,parentId:dirs.stagingFolderId,name:'snapshot-'+snapshotId+'.json',blob:manifestBlob,mimeType:'application/json',kind:'snapshot',operationId:manifestOperation});await readFile({fileId:uploaded.entry.id,sha256:manifestSha256,sizeBytes:manifestBlob.size});
        pending={operationId,expectedGeneration:remote.generation,rootFolderId,candidate:{snapshotId,manifestFileId:uploaded.entry.id,manifestSha256,contentHash:local.contentHash},localHash:local.contentHash};current(generation);await save({pending});
      }
      current(generation);emit('cloud','Передаём изменения в облако…');const accepted=await provider.commit(pending);current(generation);const live=await provider.head();current(generation);
      if(accepted.conflict||live.head?.snapshotId!==pending.candidate.snapshotId)return safeConflict(local,live.head,'Другое устройство уже изменило облачные данные.');
      report('publish_committed',{cloudHeadPresent:true,cloudGeneration:live.generation});
      const snapshot=await readSnapshot(live.head);await reconcile(live.head,snapshot,generation);await save({baseGeneration:live.generation,baseLocalHash:local.contentHash,baseCloudHash:live.head.contentHash,pending:null,uploadIntent:null,conflict:null});conflict=null;emit('synced','Все синхронизировано');report('reconcile_complete',{cloudHeadPresent:true,cloudGeneration:live.generation});return status;
    }
    async function pull(local,remote,generation){if(!options.isSafeToApply()){emit('local','Новая облачная версия ожидает закрытия редакторов.');return status;}const snapshot=await readSnapshot(remote.head);current(generation);await verifyHead(remote.head);current(generation);const latest=await collectModel(await options.collect());current(generation);if(latest.contentHash!==local.contentHash)return safeConflict(latest,remote.head,'Локальные данные изменились во время получения облачной версии.');await verifyHead(remote.head);current(generation);emit('local','Сохраняем облачные изменения на этом устройстве…');const expectedLocalRecord=normalizedRecord({app:'ZeTer OS',versionNumber:local.stateRecord.versionNumber,state:local.localBaseline});await options.apply({...snapshot,expectedLocalRecord},()=>generation===epoch&&!stopped);current(generation);const after=await collectModel(await options.collect());current(generation);await verifyHead(remote.head);await reconcile(remote.head,snapshot,generation);await save({baseGeneration:remote.generation,baseCloudHash:remote.head.contentHash,baseLocalHash:after.contentHash,pending:null,uploadIntent:null,conflict:null});conflict=null;clearIncoming();emit('synced','Все синхронизировано');return status;}
    async function run(force=null){await ensure();if(busy)return status;if(!meta.enabled&&force===null){emit('local','Автосинхронизация выключена.');return status;}busy=true;syncAttempt++;const generation=epoch;
      try{emit('loading','Сверяем локальную и облачную версии…');const remote=await provider.head();current(generation);if(meta.accountKey&&meta.accountKey!==remote.accountKey){clearIncoming();conflict=null;await save({baseGeneration:null,baseLocalHash:null,baseCloudHash:null,pending:null,uploadIntent:null,conflict:null});}if(meta.accountKey!==remote.accountKey)await save({accountKey:remote.accountKey});report('remote_checked',{cloudHeadPresent:Boolean(remote.head),cloudGeneration:remote.generation,rootMissing:Boolean(remote.missingRootFolderId),conflictSaved:Boolean(meta.conflict),uploadPending:Boolean(meta.pending)});
        const local=await collectModel(await options.collect());report('local_collected',{localFileCount:local.files.length,cloudHeadPresent:Boolean(remote.head)});current(generation);
        if(remote.missingRootFolderId){
          clearIncoming();
          // A confirmed deleted canonical root requires a full new snapshot. Keep
          // old accepted cloud receipts intact; the replacement commits by CAS.
          const replacementRemote={...remote,head:null};
          const recovering=meta.uploadIntent?.accountKey===remote.accountKey&&meta.uploadIntent?.expectedGeneration===remote.generation&&meta.uploadIntent?.bootstrap&&meta.uploadIntent.bootstrap.rootFolderId!==remote.missingRootFolderId;
          if(!recovering)await save({baseGeneration:null,baseLocalHash:null,baseCloudHash:null,pending:null,uploadIntent:null,conflict:null});
          await intentFor(local,replacementRemote,generation);current(generation);
          emit('cloud','Папка Google Drive удалена. Создаём новую копию данных…');
          const replacement=await provider.recreateRoot({expectedGeneration:remote.generation,oldRootFolderId:remote.missingRootFolderId});current(generation);
          if(replacement.conflict){emit('pending','Другое устройство уже обновило облако. Сверим данные заново.');return status;}
          await save({uploadIntent:{...meta.uploadIntent,bootstrap:replacement.bootstrap}});current(generation);
          return await publish(local,replacementRemote,generation);
        }
        if(force&&typeof force==='object'){
          const offer=incoming;
          if(!offer||offer.key!==force.incomingKey)return status;
          if(offer.accountKey!==remote.accountKey){clearIncoming();return status;}
          if(local.contentHash!==offer.localHash)return await safeConflict(local,remote.head,'Локальные данные изменились после уведомления.');
          if(!remote.head){clearIncoming();emit('pending','Облачная версия больше недоступна.');return status;}
          if(remote.generation!==offer.head.generation||remote.head.snapshotId!==offer.head.snapshotId)return offerIncoming(local,remote);
          if(!options.isSafeToApply()){emit('incoming','Закрой редакторы и снова подтверди загрузку новых данных.');return status;}
          report('choice_selected',{driveChoice:'incoming',cloudHeadPresent:true});
          if(!await options.preserve({stateRecord:local.stateRecord,files:local.files,head:remote.head,reason:'Перед подтверждённой загрузкой новых данных'}))throw new Error('Страховочная версия не сохранена.');
          return await pull(local,remote,generation);
        }
        if(force==='cloud'){report('choice_selected',{driveChoice:'cloud',cloudHeadPresent:Boolean(remote.head)});if(!remote.head)throw new Error('Облачная версия ещё не создана.');if(!await options.preserve({stateRecord:local.stateRecord,files:local.files,head:remote.head,reason:'Перед выбором облачной версии'}))throw new Error('Страховочная версия не сохранена.');return await pull(local,remote,generation);}
        if(force==='local'){report('choice_selected',{driveChoice:'local',cloudHeadPresent:Boolean(remote.head)});if(remote.head&&!await options.preserve({stateRecord:local.stateRecord,files:local.files,head:remote.head,reason:'Перед выбором локальной версии'}))throw new Error('Страховочная версия не сохранена.');return await publish(local,remote,generation,true);}
        if(!remote.head)return await publish(local,remote,generation);
        if(meta.conflict) {
          if(typeof provider.readFile==='function') {
            try {await readAcceptedManifest(remote.head);}
            catch(error) {
              if(!error.acceptedManifestMissing)throw error;
              await safeConflict(local,remote.head,'Облачный снимок отсутствует.');
              report('failure',{driveError:'missing_cloud_snapshot',cloudHeadPresent:true});
              emit('conflict','Принятый облачный снимок удалён или недоступен: Google Drive не находит манифест. Данные компьютера сохранены. Выбери «Использовать данные этого устройства» для создания новой копии.',{cloudManifestMissing:true});
              return status;
            }
          }
          return await safeConflict(local,remote.head,'Ожидается твой выбор локальной или облачной версии.');
        }
        // The current head and local bytes are still checked on every poll. Reuse
        // only this process's completed reconciliation; restart, pending writes,
        // explicit checks and a five-minute integrity interval require a full read.
        const confirmed=meta.baseGeneration===remote.generation&&meta.baseCloudHash===remote.head.contentHash&&meta.baseLocalHash===local.contentHash;
        const recentlyChecked=reconciled?.accountKey===remote.accountKey&&reconciled.head===canonical(remote.head)&&now()>=reconciled.checkedAt&&now()-reconciled.checkedAt<300000;
        if(force===null&&confirmed&&recentlyChecked&&!meta.pending&&!meta.uploadIntent){clearIncoming();emit('synced','Все синхронизировано');return status;}
        if(local.contentHash===remote.head.contentHash||confirmed){const snapshot=await readSnapshot(remote.head);await reconcile(remote.head,snapshot,generation);await save({baseGeneration:remote.generation,baseLocalHash:local.contentHash,baseCloudHash:remote.head.contentHash,pending:null,uploadIntent:null});clearIncoming();emit('synced','Все синхронизировано');return status;}
        if(meta.baseGeneration===null){if(options.isEmpty(local.stateRecord.state))return offerIncoming(local,remote);return await safeConflict(local,remote.head,'Первое подключение: на устройстве и в облаке разные данные.');}
        const localChanged=local.contentHash!==meta.baseLocalHash,cloudChanged=remote.head.contentHash!==meta.baseCloudHash;
        if(localChanged&&cloudChanged)return await safeConflict(local,remote.head,'Данные изменились на двух устройствах.');
        if(cloudChanged)return offerIncoming(local,remote);
        if(localChanged)return await publish(local,remote,generation);
        emit('synced','Все синхронизировано');return status;
      }catch(error){if(error.cancelled)return status;emit(error.needsReconnect?'reconnect':error.stale?'pending':'offline',error.message||'Синхронизация отложена. Локальные данные доступны.');report('failure',{driveError:error.needsReconnect?'auth_required':error.stale?'stale_cloud':'unknown_failure',conflictSaved:Boolean(meta?.conflict),uploadPending:Boolean(meta?.pending)});throw error;}finally{busy=false;}}
    async function configure(enabled){await ensure();if(!enabled){epoch++;conflict=null;clearIncoming();}await save({enabled:Boolean(enabled)});if(enabled)return run();emit('local','Автосинхронизация выключена.');}
    async function tick(){if(stopped)return;try{if(options.isVisible?.()!==false)await run();}catch{/* The exact failure is retained in the visible status. */}finally{if(!stopped)timer=schedule(tick,20000);}}
    function requestSync(){if(stopped||debounce!==null)return;debounce=schedule(()=>{debounce=null;run().catch(()=>{});},1500);}
    return {run,configure,requestSync,getIncoming:publicIncoming,async acceptIncoming(key){await ensure();if(!meta.enabled||busy||!incoming||incoming.busy||incoming.key!==key)return status;incoming.busy=true;changedIncoming();try{return await run({incomingKey:key});}finally{if(incoming?.key===key){incoming.busy=false;changedIncoming();}}},deferIncoming(key){if(!incoming||incoming.key!==key||incoming.busy)return;deferred.add(key);changedIncoming();},cancelPending(){epoch++;clearIncoming();emit('pending','Проверка облака отложена. Локальные данные доступны.');},async startup(){await ensure();if(meta.enabled)return run();},async settings(){await ensure();return {...meta,status,busy,incoming:publicIncoming(),conflict:meta.conflict||conflict,conflictVerified:Boolean(conflict)};},getStatus:()=>status,async disconnect(){epoch++;conflict=null;clearIncoming();await ensure();await save({enabled:false});emit('local','Подключение отключено. Автосинхронизация остановлена.');},start(){if(timer===null&&!stopped)timer=schedule(tick,20000);},stop(){stopped=true;epoch++;clearIncoming();unschedule(timer);unschedule(debounce);},tick};
  }
  window.ZETER_GOOGLE_DRIVE_SYNC_UTILS=Object.freeze({canonical,normalizedRecord,collectModel,createSyncController});
})();
