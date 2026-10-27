(() => {
  'use strict';
  const MAX_BYTES = 120 * 1024 * 1024;
  const OWNER = 'zeter-os-backup';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const cancelled = () => Object.assign(new Error('Операция отменена: подключение изменилось.'), {cancelled:true});
  const reconnect = () => Object.assign(new Error('Доступ Google истёк. Нажми «Подключить Google Drive» повторно.'), {needsReconnect:true});
  async function sha256(blob) {
    const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,'0')).join('');
  }
  async function toBase64(blob) {
    const bytes=new Uint8Array(await blob.arrayBuffer());let value='';
    for(let n=0;n<bytes.length;n+=32768)value+=String.fromCharCode(...bytes.subarray(n,n+32768));
    return btoa(value);
  }
  function fromBase64(result) {
    if(typeof result?.base64!=='string'||result.base64.length>Math.ceil(MAX_BYTES/3)*4)throw new Error('Размер облачной копии превышает 120 МБ.');
    const bytes=Uint8Array.from(atob(result.base64),c=>c.charCodeAt(0));
    if(bytes.length>MAX_BYTES)throw new Error('Размер облачной копии превышает 120 МБ.');
    return new File([bytes],result.name||'ZeTer_OS_backup.zip',{type:'application/zip'});
  }
  function createPreferenceStore(indexedDB = window.indexedDB,key = 'preferences') {
    async function use(write,value) {
      if(!indexedDB)throw new Error('IndexedDB недоступна. Настройки облачных копий не сохранены.');
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('zeter-google-drive-preferences',1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Не удалось открыть настройки облачных копий.'));});
      try{return await new Promise((resolve,reject)=>{const tx=db.transaction('settings',write?'readwrite':'readonly'),store=tx.objectStore('settings');let result;const r=write?store.put(value,key):store.get(key);r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(write?value:result);tx.onerror=tx.onabort=()=>reject(new Error('Настройки облачных копий не записаны.'));});}finally{db.close();}
    }
    return {read:()=>use(false),write:value=>use(true,value)};
  }
  function createWebTransport(options = {}) {
    const fetcher=options.fetch || window.fetch.bind(window),now=options.now||Date.now;
    let token='',expires=0,folder='',generation=0,pendingAuth=null,config=null;
    const requests=new Set(),attempts=new Set();
    const timeoutMs=options.timeoutMs||45000;
    async function request(url,init={},json=true) {
      const revision=generation;
      if(options.auth){const result=await options.auth.getToken();if(revision!==generation)throw cancelled();token=result.accessToken;expires=result.expiresAt;}
      if(!token||now()>=expires){token='';throw reconnect();}
      const abort=new AbortController();requests.add(abort);
      const timer=setTimeout(()=>abort.abort(),timeoutMs);
      try {
        const response=await fetcher(url,{...init,signal:abort.signal,headers:{...init.headers,Authorization:'Bearer '+token}});
        if(revision!==generation)throw cancelled();
        if(response.status===401){token='';expires=0;options.auth?.invalidate?.();throw reconnect();}
        if(!response.ok)throw Object.assign(new Error(response.status===403?'Google Drive отказал в доступе. Проверь разрешение и свободное место.':`Google Drive: HTTP ${response.status}. Проверь список копий перед повтором.`),{httpStatus:response.status});
        const result=json?await response.json():await boundedBlob(response);
        if(revision!==generation)throw cancelled();return result;
      }catch(error){if(revision!==generation)throw cancelled();if(error.name==='AbortError')throw new Error('Google Drive не ответил вовремя. Проверь список перед повтором загрузки.');throw error;}
      finally{clearTimeout(timer);requests.delete(abort);}
    }
    async function boundedBlob(response) {
      if(Number(response.headers?.get('content-length')||0)>MAX_BYTES)throw new Error('Размер облачной копии превышает 120 МБ.');
      if(!response.body?.getReader){const b=await response.blob();if(b.size>MAX_BYTES)throw new Error('Размер облачной копии превышает 120 МБ.');return b;}
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)throw new Error('Размер облачной копии превышает 120 МБ.');chunks.push(part.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
      return new Blob(chunks,{type:'application/zip'});
    }
    const fields='id,name,createdTime,size,parents,appProperties,mimeType';
    const marker=`appProperties has { key='app' and value='${OWNER}' }`;
    async function query(q) {
      const all=[];let page='';const seen=new Set();
      do{if(seen.has(page)||seen.size>100)throw new Error('Google Drive вернул некорректную пагинацию.');seen.add(page);
        const params=new URLSearchParams({q:`trashed=false and ${q}`,fields:`nextPageToken,files(${fields})`,pageSize:'100'});if(page)params.set('pageToken',page);
        const data=await request(API+'?'+params);all.push(...(data.files||[]));page=data.nextPageToken||'';
      }while(page);return all;
    }
    async function getFolder(create=false) {
      if(folder)return folder;
      const matches=await query(`${marker} and mimeType='application/vnd.google-apps.folder'`);
      if(matches.length>1)throw new Error('Найдено несколько папок ZeTer OS. Обратись к настройщику Google Drive.');
      if(matches.length){folder=matches[0].id;return folder;}
      if(!create)return null;
      const created=await request(API+'?fields=id',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'ZeTer OS — резервные копии',mimeType:'application/vnd.google-apps.folder',appProperties:{app:OWNER}})});
      folder=created.id;return folder;
    }
    function entry(file){return {id:file.id,name:file.name,createdAt:file.createdTime,sizeBytes:Number(file.size)||0,sha256:file.appProperties?.sha256||'',operationId:file.appProperties?.operationId||''};}
    async function owned(id) {
      if(!/^[\w-]{1,200}$/.test(id||''))throw new Error('Некорректный идентификатор облачной копии.');
      const file=await request(API+'/'+encodeURIComponent(id)+'?fields='+fields),parent=await getFolder();
      if(file.appProperties?.app!==OWNER||file.appProperties?.kind!=='backup-v1'||!file.parents?.includes(parent)||file.mimeType!=='application/zip')throw new Error('Этот файл не принадлежит резервным копиям ZeTer OS.');
      if(!/^[a-f0-9]{64}$/.test(file.appProperties?.sha256||''))throw new Error('В облачной копии отсутствует контрольная сумма.');
      if(Number(file.size)>MAX_BYTES)throw new Error('Размер облачной копии превышает 120 МБ.');return file;
    }
    async function download(id) {
      const file=await owned(id),blob=await request(API+'/'+encodeURIComponent(id)+'?alt=media',{},false);
      if(blob.size!==Number(file.size)||await sha256(blob)!==file.appProperties.sha256)throw new Error('Контрольная сумма облачной копии не совпала. Данные не изменены.');
      return new File([blob],file.name,{type:'application/zip'});
    }
    async function status() {
      if(options.auth)return options.auth.status();
      config=config||await options.loadConfig();
      return {configured:Boolean(config.webClientId),connected:Boolean(token&&now()<expires),needsReconnect:Boolean(expires&&now()>=expires),sessionLimited:true};
    }
    async function connect() {
      if(options.auth){await options.auth.connect();return status();}
      const s=await status();if(!s.configured)throw new Error('Google Drive не настроен: нужен webClientId.');
      if(pendingAuth)throw new Error('Подключение Google уже открыто.');
      const oauth=options.oauth || window.google?.accounts?.oauth2;
      if(!oauth)throw new Error('Google Identity Services не загрузился. Проверь интернет и повтори подключение.');
      const revision=generation;
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('Подключение Google не завершено. Нажми «Подключить» повторно.')),120000);
        function finish(error,result){if(!pendingAuth)return;pendingAuth=null;clearTimeout(timer);if(revision!==generation)return reject(cancelled());if(error)return reject(error);token=result.access_token;expires=now()+Math.max(1,Number(result.expires_in)||3600)*1000-30000;resolve();}
        pendingAuth={cancel:()=>finish(cancelled())};
        try{oauth.initTokenClient({client_id:config.webClientId,scope:'https://www.googleapis.com/auth/drive.file',callback:r=>finish(r.error?new Error('Google не предоставил доступ.'):null,r),error_callback:()=>finish(new Error('Окно Google закрыто или подключение не выполнено.'))}).requestAccessToken({prompt:'consent'});}catch(error){finish(error);}
      });
      return status();
    }
    async function disconnect() {generation++;pendingAuth?.cancel();pendingAuth=null;for(const r of requests)r.abort();token='';expires=0;folder='';if(options.auth)await options.auth.disconnect();return status();}
    async function list() {const parent=await getFolder();if(!parent)return {entries:[]};const rows=await query(`${marker} and '${parent}' in parents and mimeType='application/zip'`);return {entries:rows.filter(row=>row.appProperties?.app===OWNER&&row.appProperties?.kind==='backup-v1'&&row.mimeType==='application/zip'&&row.parents?.includes(parent)&&/^[a-f0-9]{64}$/.test(row.appProperties?.sha256||'')&&Number(row.size)>0&&Number(row.size)<=MAX_BYTES).map(entry).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))};}
    async function upload({blob,name,operationId}) {
      if(!blob?.size||blob.size>MAX_BYTES)throw new Error('Копия должна быть размером до 120 МБ.');
      if(!/^[\w-]{8,100}$/.test(operationId||''))throw new Error('Некорректный идентификатор операции.');
      const parent=await getFolder(true),digest=await sha256(blob);
      const prior=(await query(`${marker} and '${parent}' in parents and appProperties has { key='operationId' and value='${operationId}' }`));
      if(prior.length){if(prior.length!==1||prior[0].appProperties?.sha256!==digest)throw new Error('Неоднозначный результат прошлой загрузки. Проверь список копий.');await download(prior[0].id);return {entry:entry(prior[0])};}
      if(attempts.has(operationId))throw new Error('Результат загрузки неизвестен. Обнови список; повтор этой операции остановлен.');
      attempts.add(operationId);
      const metadata={name,mimeType:'application/zip',parents:[parent],appProperties:{app:OWNER,kind:'backup-v1',sha256:digest,operationId}};
      const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('file',blob,name);
      const result=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields='+fields,{method:'POST',body:form});
      await download(result.id);return {entry:entry(result)};
    }
    const syncMarker="appProperties has { key='app' and value='zeter-os' } and appProperties has { key='format' and value='sync-v1' }";
    const googleId=value=>{if(!/^[A-Za-z0-9_-]{1,200}$/.test(value||''))throw new Error('Некорректный идентификатор файла Google.');return value;};
    const syncFields='id,name,createdTime,size,parents,appProperties,mimeType,trashed';
    function syncEntry(file){return {id:file.id,name:file.name,createdAt:Date.parse(file.createdTime)||0,sizeBytes:Number(file.size)||0,parents:file.parents||[],mimeType:file.mimeType,kind:file.appProperties?.kind,sha256:file.appProperties?.sha256,pathKey:file.appProperties?.pathKey,operationId:file.appProperties?.operationId};}
    async function syncOwned(id){const file=await request(API+'/'+googleId(id)+'?fields='+syncFields);if(file.id!==id||file.trashed||file.appProperties?.app!=='zeter-os'||file.appProperties?.format!=='sync-v1')throw new Error('Файл не принадлежит синхронизации ZeTer OS.');return file;}
    async function syncExisting(id){try{return await syncOwned(id);}catch(error){if(error.httpStatus===404)return null;throw error;}}
    async function allocateId(){const result=await request(API+'/generateIds?count=1&space=drive&type=files');if(!Array.isArray(result.ids)||result.ids.length!==1)throw new Error('Google Drive не выделил идентификатор файла.');return {id:googleId(result.ids[0])};}
    const canonicalNames={root:'ZeTer OS',data:'data',history:'.zeter-sync-history',staging:'.zeter-sync-staging'},canonicalKinds=Object.keys(canonicalNames);
    function sameSync(file,metadata,size){const props=metadata.appProperties,fields=[...canonicalKinds,'directory'].includes(props.kind)?['kind','pathKey','sha256']:['kind','pathKey','sha256','operationId'];const refinedPayload=props.kind==='payload'&&metadata.mimeType==='application/octet-stream'&&typeof file.mimeType==='string'&&/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(file.mimeType)&&!file.mimeType.toLowerCase().startsWith('application/vnd.google-apps.');if(file.name!==metadata.name||file.mimeType!==metadata.mimeType&&!refinedPayload||metadata.parents&&JSON.stringify(file.parents)!==JSON.stringify(metadata.parents)||fields.some(key=>file.appProperties?.[key]!==props[key])||size!==undefined&&Number(file.size)!==size)throw new Error('Идентификатор синхронизации уже связан с другим объектом.');}
    function bootstrapValue(value){const keys=['rootFolderId','dataFolderId','historyFolderId','stagingFolderId'];if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||keys.some(key=>!Object.hasOwn(value,key)))throw new Error('Некорректная структура папок синхронизации.');for(const key of keys)googleId(value[key]);if(new Set(Object.values(value)).size!==4)throw new Error('Папки синхронизации имеют одинаковые идентификаторы.');return value;}
    async function checkBootstrap(value){bootstrapValue(value);for(const kind of canonicalKinds){const file=await syncExisting(value[kind+'FolderId']);if(file)sameSync(file,{name:canonicalNames[kind],mimeType:'application/vnd.google-apps.folder',appProperties:{kind},...(kind==='root'?{}:{parents:[value.rootFolderId]})});}return value;}
    function headValue(result,account){
      if(!result||typeof result!=='object'||!Object.hasOwn(result,'head')||!Number.isSafeInteger(result.generation)||result.generation<0||account!==undefined&&result.accountKey!==account)throw new Error('Некорректная версия или аккаунт синхронизации.');
      googleId(result.accountKey);const head=result.head;
      if(head===null){if(result.generation!==0)throw new Error('Неполная версия синхронизации.');return {...result,head:null};}
      const fields=['generation','rootFolderId','snapshotId','manifestFileId','manifestSha256','contentHash','operationId','parentGeneration','committedAt'];
      if(!head||fields.some(key=>!Object.hasOwn(head,key))||head.generation!==result.generation||head.parentGeneration!==result.generation-1||!Number.isSafeInteger(head.committedAt)||head.committedAt<=0||head.committedAt>=1e15||!/^[a-f0-9]{32}$/.test(head.operationId||''))throw new Error('Неполная версия синхронизации.');
      for(const key of ['rootFolderId','snapshotId','manifestFileId'])googleId(head[key]);for(const key of ['manifestSha256','contentHash'])if(!/^[a-f0-9]{64}$/.test(head[key]||''))throw new Error('Некорректная контрольная сумма синхронизации.');
      return {...result,head:Object.fromEntries(fields.map(key=>[key,head[key]]))};
    }
    async function rootMissing(id,acceptedHead){
      let file;try{file=await request(API+'/'+googleId(id)+'?fields='+syncFields);}catch(error){if(error.httpStatus===404)return acceptedHead;throw error;}
      if(file.id!==id||typeof file.trashed!=='boolean'||file.appProperties?.app!=='zeter-os'||file.appProperties?.format!=='sync-v1')throw new Error('Корневая папка не принадлежит синхронизации ZeTer OS.');
      sameSync(file,{name:canonicalNames.root,mimeType:'application/vnd.google-apps.folder',appProperties:{kind:'root'}});return file.trashed;
    }
    async function head(){
      const revision=generation,auth=requireBroker();let current=headValue(await auth.syncHead()),root=current.head?.rootFolderId;
      if(revision!==generation)throw cancelled();
      if(!root){const reservation=headValue(await auth.syncBootstrap({expectedGeneration:current.generation,bootstrap:null}),current.accountKey);if(revision!==generation)throw cancelled();
        if(reservation.conflict){current=reservation;root=current.head?.rootFolderId;}else{if(reservation.generation!==current.generation||JSON.stringify(reservation.head)!==JSON.stringify(current.head))throw new Error('Версия синхронизации изменилась.');root=reservation.bootstrap?bootstrapValue(reservation.bootstrap).rootFolderId:null;}}
      const {missingRootFolderId:ignored,...clean}=current;if(root&&await rootMissing(root,current.head!==null))clean.missingRootFolderId=root;if(revision!==generation)throw cancelled();return clean;
    }
    async function recreateRoot(value){
      const revision=generation;
      if(!value||Object.keys(value).length!==2||!Object.hasOwn(value,'expectedGeneration')||!Object.hasOwn(value,'oldRootFolderId')||!Number.isSafeInteger(value.expectedGeneration)||value.expectedGeneration<0)throw new Error('Некорректный запрос новой папки синхронизации.');
      const oldRootFolderId=googleId(value.oldRootFolderId),current=await head();if(revision!==generation)throw cancelled();
      if(current.generation!==value.expectedGeneration||current.missingRootFolderId!==oldRootFolderId)return {...current,conflict:true};
      const proposal={};for(const kind of canonicalKinds){proposal[kind+'FolderId']=(await allocateId()).id;if(revision!==generation)throw cancelled();}
      const result=headValue(await requireBroker().syncRecreate({expectedGeneration:value.expectedGeneration,oldRootFolderId,bootstrap:bootstrapValue(proposal)}),current.accountKey);if(revision!==generation)throw cancelled();if(result.conflict)return result;
      if(result.generation!==current.generation||JSON.stringify(result.head)!==JSON.stringify(current.head))throw new Error('Версия синхронизации изменилась.');
      const structure=bootstrapValue(result.bootstrap);if(Object.values(structure).includes(oldRootFolderId))throw new Error('Новая структура повторяет удалённую папку.');
      await checkBootstrap(structure);if(revision!==generation)throw cancelled();return {...result,bootstrap:structure};
    }
    async function bootstrap({expectedGeneration}){
      const revision=generation;
      if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw new Error('Некорректная версия синхронизации.');
      const auth=requireBroker(),first=await auth.syncBootstrap({expectedGeneration,bootstrap:null});if(first.conflict)return first;
      if(first.generation!==expectedGeneration)throw new Error('Версия синхронизации изменилась.');
      if(first.bootstrap)return {...first,bootstrap:await checkBootstrap(first.bootstrap)};
      let rootId=first.head?.rootFolderId;
      const oldest=items=>items.sort((a,b)=>(Date.parse(a.createdTime)-Date.parse(b.createdTime))||String(a.id).localeCompare(String(b.id)))[0];
      const validFolder=(file,kind,parent)=>file.appProperties?.app==='zeter-os'&&file.appProperties?.format==='sync-v1'&&file.appProperties?.kind===kind&&file.name===canonicalNames[kind]&&file.mimeType==='application/vnd.google-apps.folder'&&!file.trashed&&Number.isFinite(Date.parse(file.createdTime))&&(!parent||JSON.stringify(file.parents)===JSON.stringify([parent]));
      if(rootId){const root=await syncOwned(rootId);if(!validFolder(root,'root'))throw new Error('Корневая папка принятой версии не прошла проверку.');}
      else{const roots=await query(`${syncMarker} and 'root' in parents and mimeType='application/vnd.google-apps.folder' and appProperties has { key='kind' and value='root' }`);rootId=oldest(roots.filter(file=>validFolder(file,'root')))?.id;}
      const proposal={rootFolderId:rootId|| (await allocateId()).id},children=rootId?await query(`${syncMarker} and '${googleId(rootId)}' in parents`):[];
      for(const kind of ['data','history','staging']){const matches=children.filter(file=>validFolder(file,kind,rootId));if(matches.length>1)throw new Error('Найдено несколько подходящих папок синхронизации.');proposal[kind+'FolderId']=matches[0]?.id||(await allocateId()).id;}
      if(revision!==generation)throw cancelled();const result=await auth.syncBootstrap({expectedGeneration,bootstrap:bootstrapValue(proposal)});if(result.conflict)return result;
      if(result.accountKey!==first.accountKey)throw cancelled();
      if(result.generation!==expectedGeneration)throw new Error('Версия синхронизации изменилась.');return {...result,bootstrap:await checkBootstrap(result.bootstrap)};
    }
    async function directoryId(value){
      const revision=generation,auth=requireBroker(),keys=['expectedGeneration','rootFolderId','parentId','name','pathKey','operationId'];
      if(!value||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||!Number.isSafeInteger(value.expectedGeneration)||value.expectedGeneration<0||typeof value.name!=='string'||!value.name.trim()||value.name.length>240||['.','..'].includes(value.name)||/[\x00-\x1f/\\]/.test(value.name)||!/^[a-f0-9]{64}$/.test(value.pathKey)||!/^[a-f0-9]{32}$/.test(value.operationId))throw new Error('Некорректный запрос каталога синхронизации.');
      googleId(value.rootFolderId);googleId(value.parentId);const root=await syncOwned(value.rootFolderId);if(root.appProperties.kind!=='root'||root.mimeType!=='application/vnd.google-apps.folder')throw new Error('Некорректный корень синхронизации.');
      let parent=await syncOwned(value.parentId);const seen=new Set();for(let depth=0;parent.id!==root.id;depth++){if(depth>=64||seen.has(parent.id)||parent.mimeType!=='application/vnd.google-apps.folder'||!Array.isArray(parent.parents)||parent.parents.length!==1)throw new Error('Родитель каталога находится вне корня синхронизации.');seen.add(parent.id);parent=await syncOwned(parent.parents[0]);}
      if(revision!==generation)throw cancelled();let result=await auth.syncDirectory({...value,id:null});if(result.conflict)return result;const account=result.accountKey;
      if(!result.id){const children=await query(`${syncMarker} and '${value.parentId}' in parents`),matches=children.filter(file=>!file.trashed&&file.name===value.name&&file.mimeType==='application/vnd.google-apps.folder'&&file.appProperties?.app==='zeter-os'&&file.appProperties?.format==='sync-v1'&&file.appProperties?.kind==='directory'&&file.appProperties?.pathKey===value.pathKey&&JSON.stringify(file.parents)===JSON.stringify([value.parentId]));if(matches.length>1)throw new Error('Найдено несколько подходящих каталогов синхронизации.');const id=matches[0]?.id||(await allocateId()).id;if(revision!==generation)throw cancelled();result=await auth.syncDirectory({...value,id:googleId(id)});if(result.conflict)return result;if(result.accountKey!==account)throw cancelled();}
      googleId(result.id);const file=await syncExisting(result.id);if(file)sameSync(file,{name:value.name,mimeType:'application/vnd.google-apps.folder',parents:[value.parentId],appProperties:{kind:'directory',pathKey:value.pathKey}});if(revision!==generation)throw cancelled();return {id:result.id};
    }
    async function syncFiles(value){const parent=await syncOwned(value.parentId);if(parent.mimeType!=='application/vnd.google-apps.folder')throw new Error('Некорректная папка синхронизации.');const params=new URLSearchParams({q:`trashed=false and ${syncMarker} and '${googleId(value.parentId)}' in parents`,fields:`nextPageToken,files(${syncFields})`,pageSize:'100'});if(value.kind){if(!/^[a-z]+$/.test(value.kind))throw new Error('Некорректный тип файла.');params.set('q',params.get('q')+` and appProperties has { key='kind' and value='${value.kind}' }`);}if(value.pageToken)params.set('pageToken',value.pageToken);const result=await request(API+'?'+params);return {entries:(result.files||[]).map(syncEntry),nextPageToken:result.nextPageToken};}
    async function syncRead(value){const file=await syncOwned(value.id),size=Number(file.size),expected=value.sizeBytes===undefined&&file.appProperties.kind==='snapshot'?size:value.sizeBytes;if(!Number.isSafeInteger(expected)||expected<0||expected>MAX_BYTES||size!==expected||!/^[a-f0-9]{64}$/.test(value.sha256||'')||file.appProperties.sha256!==value.sha256)throw new Error('Метаданные файла синхронизации не совпали.');const data=await request(API+'/'+googleId(value.id)+'?alt=media',{},false);if(data.size!==expected||await sha256(data)!==value.sha256)throw new Error('Контрольная сумма файла синхронизации не совпала.');return data;}
    async function syncCreate(value,isFolder){
      const revision=generation;
      if(!/^[a-f0-9]{32}$/.test(value.operationId||''))throw new Error('Некорректный идентификатор синхронизации.');
      if(!['root','data','history','staging','snapshot','state','payload','directory'].includes(value.kind))throw new Error('Некорректный тип файла синхронизации.');
      if(typeof value.name!=='string'||!value.name||value.name.length>255||/[\x00-\x1f/\\]/.test(value.name))throw new Error('Некорректное имя файла синхронизации.');
      if(value.pathKey&&!/^[a-f0-9]{64}$/.test(value.pathKey))throw new Error('Некорректный путь файла синхронизации.');
      if(value.parentId){const parent=await syncOwned(value.parentId);if(parent.mimeType!=='application/vnd.google-apps.folder')throw new Error('Некорректная папка синхронизации.');}
      const sha=isFolder?'':await sha256(value.blob);if(!isFolder&&value.blob.size>MAX_BYTES)throw new Error('Файл превышает 120 МБ.');
      const props={app:'zeter-os',format:'sync-v1',kind:value.kind,operationId:value.operationId};if(value.pathKey)props.pathKey=value.pathKey;if(sha)props.sha256=sha;
      const metadata={name:value.name,mimeType:isFolder?'application/vnd.google-apps.folder':value.mimeType||'application/octet-stream',appProperties:props};if(value.parentId)metadata.parents=[value.parentId];
      if(!isFolder&&['root','data','history','staging','directory'].includes(value.kind)||isFolder&&['state','payload'].includes(value.kind)||!value.parentId&&value.kind!=='root')throw new Error('Некорректный тип или родитель объекта синхронизации.');
      const fixed=value.id?googleId(value.id):null;
      const matches=fixed?[]:await query(`${syncMarker} and appProperties has { key='operationId' and value='${value.operationId}' }`);
      const prior=fixed?await syncExisting(fixed):matches[0];if(matches.length>1)throw new Error('Неоднозначная операция синхронизации.');
      if(prior){sameSync(prior,metadata,isFolder?undefined:value.blob.size);if(!isFolder)await syncRead({id:prior.id,sha256:sha,sizeBytes:value.blob.size});return {entry:syncEntry(prior)};}
      if(!fixed)throw new Error('Сначала сохрани постоянный идентификатор загрузки.');metadata.id=fixed;
      if(revision!==generation)throw cancelled();
      let file;if(isFolder)file=await request(API+'?fields='+syncFields,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(metadata)});else{const form=new FormData();form.append('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.append('file',value.blob,value.name);file=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields='+syncFields,{method:'POST',body:form});}
      if(file.id!==fixed)throw new Error('Google Drive вернул другой идентификатор файла.');file=await syncOwned(fixed);sameSync(file,metadata,isFolder?undefined:value.blob.size);if(!isFolder)await syncRead({id:fixed,sha256:sha,sizeBytes:value.blob.size});return {entry:syncEntry(file)};
    }
    async function syncMove(value){const file=await syncOwned(value.id),parent=await syncOwned(value.parentId);if(parent.mimeType!=='application/vnd.google-apps.folder')throw new Error('Некорректная папка синхронизации.');const params=new URLSearchParams({fields:syncFields,addParents:googleId(value.parentId)});const remove=(file.parents||[]).filter(p=>p!==value.parentId);if(remove.length)params.set('removeParents',remove.join(','));if(file.parents?.includes(value.parentId)&&file.name===value.name)return {entry:syncEntry(file)};return {entry:syncEntry(await request(API+'/'+googleId(value.id)+'?'+params,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:value.name})}))};}
    const requireBroker=()=>{if(!options.auth)throw new Error('Для синхронизации между устройствами нужен сервис постоянного подключения. Сеансовый вход Google его не заменяет.');return options.auth;};
    return {status,connect,disconnect,list,download,upload,allocateId,bootstrap,recreateRoot,directoryId,head,commit:value=>requireBroker().syncCommit(value),makeFolder:value=>syncCreate(value,true),files:syncFiles,putFile:value=>syncCreate(value,false),readFile:syncRead,moveFile:syncMove};
  }
  function createBrokerAuth(options) {
    const origin=new URL(options.brokerUrl).origin;
    if(!origin.startsWith('https://')||new URL(options.brokerUrl).href!==origin+'/')throw new Error('brokerUrl должен быть HTTPS-адресом сервиса без пути.');
    const host=options.host||window,fetcher=options.fetch||window.fetch.bind(window),store=options.store||createPreferenceStore(window.indexedDB,'broker-session'),now=options.now||Date.now;
    let handle='',token=null,loaded=null,generation=0,refreshing=null,login=null,needsReconnect=false,writeChain=Promise.resolve();
    const requests=new Set();
    const persist=value=>{const next=writeChain.catch(()=>{}).then(()=>store.write(value));writeChain=next;return next;};
    const load=()=>{if(!loaded){const revision=generation;loaded=store.read().then(value=>{if(revision===generation)handle=/^[A-Za-z0-9_-]{43}$/.test(value?.handle||'')?value.handle:'';});}return loaded;};
    async function brokerRequest(path,bearer,body={},method='POST') {
      const revision=generation,controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),options.timeoutMs||30000);
      try{const result=await fetcher(origin+path,{method,credentials:'omit',headers:{Authorization:'Bearer '+bearer,...(method==='GET'?{}:{'Content-Type':'application/json'})},...(method==='GET'?{}:{body:JSON.stringify(body)}),signal:controller.signal});if(revision!==generation)throw cancelled();
        if(result.status===409&&['/sync/commit','/sync/bootstrap','/sync/directory','/sync/recreate'].includes(path)){const conflict=await result.json();if(revision!==generation)throw cancelled();if(conflict.error!=='sync-conflict')throw new Error('Каталог синхронизации уже связан с другим путём.');return {...conflict,conflict:true};}
        if([400,401,403].includes(result.status)){needsReconnect=true;token=null;throw reconnect();}if(!result.ok)throw new Error('Сервис Google Drive недоступен. Проверь интернет; повторная загрузка не началась.');
        const value=await result.json();if(revision!==generation)throw cancelled();return value;
      }catch(error){if(revision!==generation)throw cancelled();if(error.name==='AbortError')throw new Error('Сервис подключения Google не ответил вовремя.');throw error;}finally{clearTimeout(timer);requests.delete(controller);}
    }
    async function getToken() {
      await load();if(!handle||needsReconnect)throw reconnect();if(token&&token.expiresAt>now()+30000)return token;if(refreshing)return refreshing;
      const revision=generation,bearer=handle;
      const job=brokerRequest('/token',bearer).then(value=>{if(revision!==generation)throw cancelled();const expiresAt=Number(value.expiresAt);if(typeof value.accessToken!=='string'||!value.accessToken||!Number.isFinite(expiresAt)||expiresAt<=now())throw new Error('Сервис Google вернул некорректный срок доступа.');token={accessToken:value.accessToken,expiresAt};return token;});
      refreshing=job;try{return await job;}finally{if(refreshing===job)refreshing=null;}
    }
    async function status(){await load();return {configured:true,connected:Boolean(handle&&!needsReconnect),needsReconnect,sessionLimited:false,persistent:true};}
    async function connect() {
      if(login)throw new Error('Подключение Google уже открыто.');
      const popup=host.open('about:blank','_blank','popup,width=520,height=700');if(!popup)throw new Error('Разреши всплывающее окно для подключения Google Drive.');
      const revision=generation,bytes=crypto.getRandomValues(new Uint8Array(32));const nonce=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      try {
        const received=await new Promise((resolve,reject)=>{
          const finish=(error,value)=>{if(login?.revision!==revision)return;host.removeEventListener('message',listener);clearTimeout(timer);clearInterval(closed);login=null;if(error)reject(error);else resolve(value);};
          const listener=event=>{if(event.origin!==origin||event.source!==popup||event.data?.type!=='zeter-google-drive-auth'||event.data.nonce!==nonce)return;if(!/^[A-Za-z0-9_-]{43}$/.test(event.data.sessionHandle||''))return finish(new Error('Сервис Google вернул некорректное подтверждение.'));finish(null,event.data.sessionHandle);};
          const timer=setTimeout(()=>finish(new Error('Подключение Google не завершено. Повтори подключение.')),options.loginTimeoutMs||120000),closed=setInterval(()=>{if(popup.closed)finish(new Error('Окно подключения Google закрыто.'));},300);
          login={revision,cancel:()=>finish(cancelled())};host.addEventListener('message',listener);
          try{popup.location.href=origin+'/oauth/start?'+new URLSearchParams({origin:host.location.origin,nonce});}catch(error){finish(error);}
        });
        if(revision!==generation)throw cancelled();await load();if(revision!==generation)throw cancelled();
        await persist({handle:received});if(revision!==generation)throw cancelled();handle=received;needsReconnect=false;token=null;await getToken();return status();
      }finally{popup.close();}
    }
    async function disconnect() {
      const previous=handle;generation++;login?.cancel();for(const request of requests)request.abort();handle='';token=null;needsReconnect=false;refreshing=null;
      const outcomes=await Promise.allSettled([persist({handle:''}),previous?brokerRequest('/disconnect',previous):Promise.resolve()]);
      if(outcomes.some(result=>result.status==='rejected'))throw new Error('Локальное подключение отключено; сервер не подтвердил завершение сеанса. Проверь интернет и повтори отключение. Если настройки недоступны, повтори его перед закрытием ZeTer OS.');
      return status();
    }
    async function authenticated(path,body,method){await load();if(!handle||needsReconnect)throw reconnect();return brokerRequest(path,handle,body,method);}
    return {status,connect,disconnect,getToken,syncHead:()=>authenticated('/sync/head',null,'GET'),syncRecreate:value=>authenticated('/sync/recreate',value),syncBootstrap:value=>authenticated('/sync/bootstrap',value),syncDirectory:value=>authenticated('/sync/directory',value),syncCommit:value=>authenticated('/sync/commit',{expectedGeneration:value.expectedGeneration,operationId:value.operationId,rootFolderId:value.rootFolderId,candidate:value.candidate}),invalidate(){token=null;}};
  }
  function createBrowserTransport(options) {
    let selected=null;
    async function get(){if(!selected)selected=Promise.resolve(options.loadConfig()).then(config=>createWebTransport({...options,auth:config.brokerUrl?createBrokerAuth({...options,brokerUrl:config.brokerUrl}):null,loadConfig:async()=>config}));return selected;}
    return Object.fromEntries(['status','connect','disconnect','list','download','upload','head','commit','allocateId','bootstrap','recreateRoot','directoryId','makeFolder','files','putFile','readFile','moveFile'].map(method=>[method,async(...args)=>(await get())[method](...args)]));
  }
  function createNativeTransport(call) {
    let generation=0;
    const pending=new Set();
    function invoke(method,payload) {
      const revision=generation;
      return new Promise((resolve,reject)=>{const cancel=()=>reject(cancelled());pending.add(cancel);const timer=setTimeout(()=>reject(new Error('Google Drive не ответил вовремя. Обнови список перед повтором.')),180000);
        Promise.resolve().then(()=>{if(revision!==generation)throw cancelled();return payload===undefined?call(method):call(method,payload);}).then(value=>revision===generation?resolve(value):reject(cancelled()),reject).finally(()=>{clearTimeout(timer);pending.delete(cancel);});
      });
    }
    return {status:()=>invoke('google_drive_status'),connect:()=>invoke('google_drive_connect'),disconnect:()=>{generation++;for(const cancel of pending)cancel();return invoke('google_drive_disconnect');},list:()=>invoke('google_drive_list'),download:async id=>fromBase64(await invoke('google_drive_download',{id})),upload:async value=>{const revision=generation,base64=await toBase64(value.blob);if(revision!==generation)throw cancelled();return invoke('google_drive_upload',{base64,name:value.name,operationId:value.operationId});},allocateId:()=>invoke('google_drive_allocate_id'),recreateRoot:value=>invoke('google_drive_recreate_root',{expectedGeneration:value.expectedGeneration,oldRootFolderId:value.oldRootFolderId}),bootstrap:value=>invoke('google_drive_bootstrap',{expectedGeneration:value.expectedGeneration}),directoryId:value=>invoke('google_drive_directory_id',value),head:()=>invoke('google_drive_sync_head'),commit:value=>invoke('google_drive_sync_commit',{expectedGeneration:value.expectedGeneration,operationId:value.operationId,rootFolderId:value.rootFolderId,candidate:value.candidate}),makeFolder:value=>invoke('google_drive_make_folder',value),files:value=>invoke('google_drive_files',value),moveFile:value=>invoke('google_drive_move_file',value),readFile:async value=>fromBase64(await invoke('google_drive_read_file',value)),putFile:async value=>{const revision=generation,base64=await toBase64(value.blob);if(revision!==generation)throw cancelled();const {blob,...metadata}=value;return invoke('google_drive_put_file',{...metadata,base64});}};
  }
  function createNativePreferenceStore(call){return {read:async()=>{const result=await call('google_drive_sync_preferences');return result.value;},write:async value=>{const result=await call('google_drive_sync_preferences',{value});if(JSON.stringify(result.value)!==JSON.stringify(value))throw new Error('Настройки синхронизации не прошли контрольное чтение.');return result.value;}};}
  function createZipNativePreferenceStore(call) {
    return {
      read:async()=>{const response=await call('google_drive_zip_preferences');return response.value;},
      write:async value=>{const response=await call('google_drive_zip_preferences',{value});
        if(JSON.stringify(response.value)!==JSON.stringify(value))throw new Error('ZIP-настройки не прошли контрольное чтение.');
        return response.value;}
    };
  }
  function createController(options) {
    const transport=options.transport,store=options.store||createPreferenceStore(),now=options.now||Date.now;
    let preferences={enabled:false,intervalHours:24,lastSuccessAt:0},loaded=false,connection={configured:false,connected:false},entries=[],busy=false,revision=0,timer=null,stopped=false,lastAttempt=0,lastError='',pendingUpload=null;
    const roots=new Set(),schedule=options.schedule||setTimeout,cancelSchedule=options.cancelSchedule||clearTimeout;
    const esc=v=>window.ZETER_CORE_UTILS.escapeHtml(String(v??''));
    async function load(){if(!loaded){const p=await store.read();preferences={enabled:p?.enabled===true,intervalHours:Math.min(720,Math.max(1,Number(p?.intervalHours)||24)),lastSuccessAt:Number(p?.lastSuccessAt)||0};loaded=true;}}
    function render() {
      for(const root of roots){if(!root.isConnected){roots.delete(root);continue;}const box=root.querySelector('[data-drive-status]');if(!box)continue;
        box.textContent=(connection.configured?(connection.connected?'Google Drive подключён.':'Google Drive не подключён. Нажми «Подключить Google Drive».'):'Google Drive не настроен для этой установки. Нужны OAuth-настройки владельца приложения.')+(connection.sessionLimited?' Браузерный доступ ограничен сеансом Google; после его окончания подключись снова.':'')+(connection.persistent?' Постоянное подключение: в этом браузере хранится ключ сеанса, позволяющий получать доступ к копиям через сервис подключения. На общем компьютере отключай аккаунт после работы.':'')+(preferences.lastSuccessAt?' Последняя проверенная загрузка: '+new Date(preferences.lastSuccessAt).toLocaleString('ru-RU')+'.':'')+(lastError?' '+lastError:'');
        root.querySelector('[data-drive-operation]').textContent=busy?'Выполняется операция Google Drive…':'';
        for(const button of root.querySelectorAll('[data-drive-action]')){
          const action=button.dataset.driveAction;
          if(action==='connect')button.hidden=Boolean(connection.connected);
          if(action==='disconnect')button.hidden=!connection.connected;
          button.disabled=busy||(action==='refresh'?false:action==='disconnect'?!connection.connected:action==='connect'?!connection.configured:!connection.connected);
        }
        const enabled=root.querySelector('[data-drive-enabled]'),interval=root.querySelector('[data-drive-interval]'),key=JSON.stringify([loaded,preferences.enabled,preferences.intervalHours]);if(root.dataset.drivePreference!==key){enabled.checked=preferences.enabled;interval.value=preferences.intervalHours;root.dataset.drivePreference=key;}enabled.disabled=busy||!connection.connected;interval.disabled=busy;
        root.querySelector('[data-drive-list]').innerHTML=entries.map(e=>`<article class="security-restore-card"><div class="security-restore-head"><div><b>${esc(e.name)}</b><small>${esc(new Date(e.createdAt).toLocaleString('ru-RU'))} · ${esc(window.ZETER_CORE_UTILS.bytesToHuman(e.sizeBytes))}</small></div></div><div class="security-inline-actions"><button type="button" data-drive-action="download" data-drive-id="${esc(e.id)}" ${busy?'disabled':''}>Скачать ZIP</button><button type="button" data-drive-action="inspect" data-drive-id="${esc(e.id)}" ${busy?'disabled':''}>Проверить / восстановить</button></div></article>`).join('')||'<p class="muted">Обнови список после подключения. Облачные копии автоматически не удаляются.</p>';
      }
    }
    async function refresh(){const generation=revision;await load();try{const next=await transport.status();if(generation!==revision)throw cancelled();connection=next;const result=connection.connected?await transport.list():{entries:[]};if(generation!==revision)throw cancelled();entries=result.entries||[];lastError='';return connection;}catch(error){if(error.needsReconnect){connection={...connection,connected:false,needsReconnect:true};entries=[];}if(!error.cancelled)lastError=error.message||'Не удалось обновить список ZIP-копий.';throw error;}finally{render();}}
    async function createBackup(generation) {
      if(!options.isReady?.())throw new Error('Дождись полной загрузки данных ZeTer OS.');
      if(!pendingUpload){const blob=await options.buildBackup();if(generation!==revision)throw cancelled();pendingUpload={blob,operationId:crypto.randomUUID(),name:'ZeTer_OS_'+new Date(now()).toISOString().replace(/[:.]/g,'-')+'.zip'};}
      const result=await transport.upload(pendingUpload);if(generation!==revision)throw cancelled();
      if(!result?.entry?.id)throw new Error('Google Drive не подтвердил загрузку. Проверь список копий.');
      const committedPreferences={...preferences,lastSuccessAt:now()};await store.write(committedPreferences);if(generation!==revision)throw cancelled();preferences=committedPreferences;pendingUpload=null;return result;
    }
    async function action(action,root) {
      const name=action.name||action;
      if(name==='disconnect') {revision++;pendingUpload=null;preferences={...preferences,enabled:false};lastError='';connection={...connection,connected:false};entries=[];render();try{await Promise.all([store.write(preferences),transport.disconnect()]);}catch(error){lastError=error.message;throw error;}finally{render();}return;}
      if(busy)throw new Error('Операция Google Drive уже выполняется.');
      busy=true;lastError='';const generation=revision;render();
      const job=(async()=>{
        await load();if(generation!==revision)throw cancelled();
        if(name==='connect'){connection=await transport.connect();}
        else if(name==='configure'){const hours=Number(root.querySelector('[data-drive-interval]').value);if(!Number.isInteger(hours)||hours<1||hours>720)throw new Error('Интервал должен быть целым числом от 1 до 720 часов.');if(!connection.connected)throw reconnect();const candidate={...preferences,enabled:root.querySelector('[data-drive-enabled]').checked,intervalHours:hours};await store.write(candidate);if(generation!==revision)throw cancelled();preferences=candidate;}
        else if(name==='create'){await createBackup(generation);}
        else if(name==='download'||name==='inspect'){if(!entries.some(e=>e.id===action.id))throw new Error('Обнови список и выбери копию ZeTer OS.');const file=await transport.download(action.id);if(generation!==revision)throw cancelled();if(name==='download')await options.download(file.name,file);else await options.inspectFile(root,file,()=>generation===revision);}
        if(generation!==revision)throw cancelled();await refresh();
      })();
      try{return await job;}catch(error){if(!error.cancelled){lastError=error.message||'Облачная операция не завершена.';if(error.needsReconnect)connection={...connection,connected:false,needsReconnect:true};}throw error;}
      finally{busy=false;render();}
    }
    async function tick() {
      if(stopped)return;
      try{await load();if(preferences.enabled&&!busy&&options.isReady?.()&&now()-preferences.lastSuccessAt>=preferences.intervalHours*3600000&&now()-lastAttempt>=15*60000){lastAttempt=now();connection=await transport.status();if(connection.connected)await action('create');else{lastError='Для автоматической копии подключи Google Drive повторно.';render();}}}catch(error){lastError=error.message;render();}
      finally{if(!stopped)timer=schedule(tick,60000);}
    }
    return {action,refresh,render,mount(root){roots.add(root);render();},start(){if(timer===null&&!stopped)timer=schedule(tick,10000);},stop(){stopped=true;revision++;cancelSchedule(timer);},tick};
  }
  function createSyncPanelController(options) {
    const transport=options.transport,sync=options.sync,roots=new Set(),attached=new WeakSet();let connection={configured:null,connected:false},settings={enabled:false,onboardingVersion:0},busy=false,revision=0,refreshing=null,error='';
    function paint(){const status=sync.getStatus();for(const root of roots){if(root.isConnected)attached.add(root);else if(attached.has(root)){roots.delete(root);continue;}const box=root.querySelector('[data-drive-status]');if(!box)continue;
      const panel=root.querySelector('.security-drive-panel');panel?.classList.toggle('is-connected',connection.connected);panel?.setAttribute('aria-busy',String(busy||settings.busy));
      const label=connection.configured===null?(error?'Не удалось проверить подключение Google Drive.':'Проверяем подключение Google Drive…'):!connection.configured?'Google Drive не настроен для этой установки.':!connection.connected?'Подключи один Google-аккаунт внутри ZeTer OS на каждом устройстве.':connection.sessionLimited?'Google подключён на один сеанс. Для обмена между устройствами настрой сервис постоянного подключения.':!settings.enabled?'Подключение сохранено. Для автоматического обмена нажми «Подключить Google Drive».':status.text;
      box.textContent=label+(error?' '+error:'');box.dataset.phase=status.phase;
      const working=busy||settings.busy;root.querySelector('[data-drive-operation]').textContent=working?status.text:'';
      root.querySelector('[data-drive-conflict]').hidden=!(connection.connected&&settings.enabled&&settings.conflictVerified&&['conflict','offline'].includes(status.phase)&&settings.conflict);
      const incoming=settings.incoming||sync.getIncoming?.(),offer=root.querySelector('[data-drive-incoming]');
      if(offer){offer.hidden=!incoming;offer.dataset.driveIncomingKey=incoming?.key||'';const text=root.querySelector('[data-drive-incoming-text]');if(text)text.textContent=incoming?.text||'';offer.setAttribute('aria-busy',String(Boolean(incoming?.busy)));}
      for(const button of root.querySelectorAll('[data-drive-action]')){const action=button.dataset.driveAction;
        if(action==='accept-incoming'||action==='defer-incoming'){button.hidden=!incoming;button.disabled=working||Boolean(incoming?.busy)||!connection.connected;continue;}
        if(action==='connect')button.hidden=connection.connected&&settings.enabled;
        if(action==='disconnect')button.hidden=!connection.connected;
        if(action==='sync')button.hidden=!connection.connected||!settings.enabled;
        button.disabled=action==='guide'?false:action==='disconnect'?!connection.connected&&!working:working||(action==='choose-cloud'&&status.cloudManifestMissing===true)||(action==='connect'?connection.configured===false:action==='refresh'?false:!connection.connected||connection.sessionLimited||(action==='sync'&&!settings.enabled));
      }
    }}
    function render(){paint();sync.settings().then(value=>{settings=value;paint();}).catch(failure=>{error=failure.message;paint();});}
    async function refresh(){if(refreshing)return refreshing;const generation=revision;refreshing=(async()=>{const value=await transport.status();if(generation!==revision)return;connection=value;const prefs=await sync.settings();if(generation!==revision)return;settings=prefs;error='';paint();return value;})();try{return await refreshing;}catch(failure){error=failure.message;paint();throw failure;}finally{refreshing=null;}}
    async function action(value,root){const name=value.name||value;if(name==='guide'){const guide=root.querySelector('[data-drive-guide]');guide.open=true;guide.scrollIntoView({block:'nearest'});guide.querySelector('summary').focus();return;}
      if(name==='disconnect'){revision++;connection={...connection,connected:false};error='';paint();const results=await Promise.allSettled([sync.disconnect(),transport.disconnect()]);for(const result of results)if(result.status==='rejected'){error=result.reason?.message||'Отключение не подтверждено.';}settings=await sync.settings();paint();if(error)throw new Error(error);return;}
      if(busy)throw new Error('Синхронизация уже выполняется.');busy=true;error='';paint();
      try{if(name==='connect'){settings=await sync.settings();if(!connection.connected)connection=await transport.connect();if(connection.sessionLimited)throw new Error('Для автоматической синхронизации нужно постоянное подключение Google.');await sync.configure(true);}
        else if(name==='sync'){if(!settings.enabled)throw new Error('Сначала подключи Google Drive внутри ZeTer OS.');await sync.run('check');}
        else if(name==='accept-incoming'||name==='defer-incoming'){const key=value.key||root?.querySelector('[data-drive-incoming]')?.dataset.driveIncomingKey;if(!key)throw new Error('Обнови предложение новых данных.');if(name==='accept-incoming')await sync.acceptIncoming(key);else await sync.deferIncoming(key);}
        else if(name==='choose-cloud'||name==='choose-local'){if(!connection.connected||!settings.enabled||!settings.conflictVerified||!['conflict','offline'].includes(sync.getStatus().phase))throw new Error('Сначала подключи Google Drive и дождись сверки данных.');if(!settings.conflict)throw new Error('Разные версии больше не требуют выбора. Обнови статус.');const missing=sync.getStatus().cloudManifestMissing===true;if(name==='choose-cloud'&&missing)throw new Error('Облачный манифест отсутствует. Загрузка этой версии заблокирована.');const question=name==='choose-cloud'?'Заменить данные этого устройства проверенной облачной версией? Страховочная версия сохранена.':missing?'Манифест облачной версии удалён. Сохранить текущие данные этого устройства как новую общую копию Google Drive? Отсутствующий прежний снимок не восстановится, а локальная страховочная копия сохранится.':'Сделать данные этого устройства общей версией? Предыдущая облачная версия останется в истории.';const confirmed=await (options.confirm||window.confirm)(question);if(confirmed)await sync.run(name==='choose-cloud'?'cloud':'local');}
        await refresh();
      }catch(failure){error=failure.message;throw failure;}finally{busy=false;settings=await sync.settings();paint();}
    }
    return {render,refresh,action,mount(root){roots.add(root);paint();refresh().catch(()=>{});}};
  }
  window.ZETER_GOOGLE_DRIVE_BACKUP_UTILS=Object.freeze({MAX_BYTES,sha256,toBase64,createPreferenceStore,createNativePreferenceStore,createZipNativePreferenceStore,createWebTransport,createBrokerAuth,createBrowserTransport,createNativeTransport,createController,createSyncPanelController});
})();
