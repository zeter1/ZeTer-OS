(() => {
  'use strict';
  const MAX_BYTES=120*1024*1024;
  const digest=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
  function safePath(value) {
    if(typeof value!=='string'||!value||value.length>1024||value.includes('\\')||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f<>:"|?*]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error('Небезопасный путь файла синхронизации.');
    return value;
  }
  function references(state) {
    const result=new Set();
    function visit(value,parentKey=''){if(!value||typeof value!=='object')return;for(const [key,entry] of Object.entries(value)){if((key==='managedPath'||key==='assetPath'||(key==='basePath'&&parentKey==='documentDraft'))&&typeof entry==='string'&&entry)result.add(safePath(entry.replace(/\\/g,'/')));else if(entry&&typeof entry==='object')visit(entry,key);}}
    visit(state);return result;
  }
  function remapReferences(state,mapping) {
    function visit(value,parentKey=''){if(!value||typeof value!=='object')return;for(const [key,entry] of Object.entries(value)){if((key==='managedPath'||key==='assetPath'||(key==='basePath'&&parentKey==='documentDraft'))&&typeof entry==='string'){const replacement=mapping.get(entry.replace(/\\/g,'/'));if(replacement)value[key]=replacement;}else if(entry&&typeof entry==='object')visit(entry,key);}}
    visit(state);return state;
  }
  async function buildVerifiedArchive(stateRecord,files) {
    const entries=[{path:'zeter-os-state.json',blob:new Blob([JSON.stringify(stateRecord)],{type:'application/json'})},...files.map(file=>({path:'data/'+safePath(file.path),blob:file.blob}))];
    const manifest=await window.ZETER_SECURITY_PROTECTION_UTILS.createBackupManifest(entries,{versionNumber:stateRecord.versionNumber,backupMode:'native-full-payload'});
    entries.push({path:'zeter-backup-manifest.json',blob:new Blob([JSON.stringify(manifest)],{type:'application/json'})});
    const archive=await window.ZETER_ASSET_UTILS.createZipBlob(entries);
    if(archive.size>MAX_BYTES)throw new Error('Полная версия с манифестом превышает 120 МБ.');
    const verified=await window.ZETER_SECURITY_PROTECTION_UTILS.verifyBackupBlob(archive);if(!verified.verified)throw new Error('Локальная проверка полной версии не завершена.');return archive;
  }
  function createPayloadStore(options={}) {
    const indexedDB=options.indexedDB||window.indexedDB;let opened=null;const urls=new Map();
    function open(){if(!opened)opened=new Promise((resolve,reject)=>{const request=indexedDB.open('zeter-cloud-payload-v1',1);request.onupgradeneeded=()=>{for(const name of ['blobs','paths','branches'])request.result.createObjectStore(name);};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Хранилище файлов телефона недоступно.'));});return opened;}
    async function transaction(names,write,operation){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(names,write?'readwrite':'readonly');let result;try{operation(tx,value=>{result=value;});}catch(error){tx.abort();return reject(error);}tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(new Error('Не удалось сохранить файлы синхронизации. Проверь свободное место. Прежние данные сохранены.'));});}
    async function get(path){safePath(path);return transaction(['paths','blobs'],false,(tx,done)=>{const request=tx.objectStore('paths').get(path);request.onsuccess=()=>{if(!request.result)return done(null);const blob=tx.objectStore('blobs').get(request.result);blob.onsuccess=()=>done(blob.result||null);};});}
    async function stage(state,files) {
      const candidate=JSON.parse(JSON.stringify(state)),mapping=new Map(),prepared=[];let bytes=0;const seen=new Set();
      for(const file of files){const path=safePath(file.path);if(seen.has(path))throw new Error('Повторяющийся путь синхронизации.');seen.add(path);bytes+=file.blob.size;if(bytes>MAX_BYTES)throw new Error('Файлы синхронизации превышают 120 МБ.');const sha=await digest(file.blob);if(file.sha256&&file.sha256!==sha)throw new Error('Контрольная сумма файла не совпала.');const old=await get(path);let target=path;
        if(old&&await digest(old)!==sha){const parts=path.split('/'),name=parts.pop(),dot=name.lastIndexOf('.');if(parts[0]==='Оформление объектов'&&parts.length===3){parts[2]='sync-'+sha;parts.push(name);}else parts.push((dot>0?name.slice(0,dot):name)+'__sync_'+sha+(dot>0?name.slice(dot):''));target=parts.join('/');const collision=await get(target);if(collision&&await digest(collision)!==sha)throw new Error('Страховочный путь занят другими байтами. Прежние файлы сохранены.');mapping.set(path,target);}
        prepared.push({path:target,sha,blob:file.blob});
      }
      for(const path of references(candidate))if(!seen.has(path))throw new Error('В облачной версии отсутствует обязательный файл.');
      await transaction(['blobs','paths'],true,(tx,done)=>{for(const file of prepared){tx.objectStore('blobs').put(file.blob,file.sha);const request=tx.objectStore('paths').get(file.path);request.onsuccess=()=>{if(request.result&&request.result!==file.sha){tx.abort();return;}tx.objectStore('paths').put(file.sha,file.path);};}done(true);});
      return {state:remapReferences(candidate,mapping),mapping};
    }
    async function preserve(branch){const id=crypto.randomUUID();await transaction(['branches'],true,(tx,done)=>{tx.objectStore('branches').put({...branch,id,createdAt:Date.now()},id);done(id);});return id;}
    async function objectURL(path){const blob=await get(path);if(!blob)throw new Error('Файл ещё не загружен из Google Drive.');const sha=await digest(blob),key=path+'#'+sha;if(!urls.has(key))urls.set(key,URL.createObjectURL(blob));return urls.get(key);}
    return {get,stage,preserve,objectURL,close(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();}};
  }
  window.ZETER_CLOUD_PAYLOAD_UTILS=Object.freeze({MAX_BYTES,digest,safePath,references,remapReferences,buildVerifiedArchive,createPayloadStore});
})();
