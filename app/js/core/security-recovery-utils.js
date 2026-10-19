(() => {
  'use strict';
  const assets = window.ZETER_ASSET_UTILS, protection = window.ZETER_SECURITY_PROTECTION_UTILS;
  const config = window.ZETER_OS_CONFIG;
  const clone = value => JSON.parse(JSON.stringify(value));
  function payloadPaths(value, result = new Set()) {
    if (!value || typeof value !== 'object') return result;
    for (const [key, entry] of Object.entries(value)) {
      if (['managedPath','assetPath'].includes(key) && typeof entry === 'string' && entry) result.add(entry.replace(/\\/g,'/'));
      else if (entry && typeof entry === 'object') payloadPaths(entry, result);
    }
    return result;
  }
  function assertPath(path) {
    if (!path || path.includes('\\') || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..' || /[\0<>:"|?*]/.test(p))) throw new Error('Некорректный путь вложения в архиве.');
    return path;
  }
  async function hydrateArchiveImages(state, entries) {
    const readImage = async (path, mime) => {
      assertPath(path);
      const bytes = entries.get(path);
      if (!bytes) throw new Error(`В архиве отсутствует изображение: ${path}`);
      const type = mime || assets.extensionImageMime(path.split('.').pop());
      if (!assets.imageMimeAllowed(type)) throw new Error('Неподдерживаемый формат изображения в архиве.');
      return assets.blobToDataURL(new Blob([bytes], {type}));
    };
    async function visit(value) {
      if (!value || typeof value !== 'object') return;
      for (const key of ['externalImage','externalWallpaper','externalDesktopIcon']) {
        const ref = value[key];
        if (ref?.path && !assets.isDataImage(value.dataURL)) value.dataURL = await readImage(ref.path, value.mime || ref.mime);
      }
      if (typeof value.richContent === 'string' && /data-zeter-external-src|zeter-os-assets\//i.test(value.richContent)) {
        const doc = new DOMParser().parseFromString(value.richContent, 'text/html');
        for (const image of doc.querySelectorAll('img')) {
          const path = image.getAttribute('data-zeter-external-src') || image.getAttribute('src') || '';
          if (path.startsWith('zeter-os-assets/')) {
            image.setAttribute('src', await readImage(path,image.getAttribute('data-zeter-mime')));
            image.removeAttribute('data-zeter-external-src');
          }
        }
        value.richContent = doc.body.innerHTML;
      }
      for (const entry of Object.values(value)) if (entry && typeof entry === 'object') await visit(entry);
    }
    await visit(state); return state;
  }
  async function inspectBackupFile(file, options = {}) {
    if (!file || file.size > config.BACKUP_IMPORT_MAX_BYTES) throw new Error('Выбери ZIP или .zeterbak размером до 120 МБ.');
    let zip = file, encrypted = false;
    if (protection.isEncryptedBackupFile(file)) {
      const passphrase = await options.requestPassphrase?.(file);
      if (!passphrase) { const error = new Error('Проверка отменена.'); error.cancelled=true; throw error; }
      zip = (await protection.decryptBackupBlob(file, passphrase)).blob; encrypted = true;
    } else if (!/\.zip$/i.test(file.name || '') && !/zip/i.test(file.type || '')) throw new Error('Для независимой проверки выбери ZIP или .zeterbak. JSON не содержит отдельные вложения.');
    const entries = await assets.readStoredZipEntries(await zip.arrayBuffer());
    const verification = await protection.verifyBackupEntries(entries);
    if (!verification.verified) throw new Error('Старый архив без манифеста: полную сохранность подтвердить нельзя. Используй обычный импорт либо создай новый проверенный ZIP.');
    const paths = payloadPaths(verification.state);
    for (const path of paths) if (!entries.has(assertPath(path)) && !entries.has(`data/${path}`)) throw new Error(`В архиве отсутствует обязательный файл: ${path}`);
    let state = clone(verification.state);
    if (options.hydrate !== false) state = await hydrateArchiveImages(state, entries);
    state = await options.validate?.(state) || state;
    state = options.migrate ? options.migrate(state) : state;
    state = await options.validate?.(state) || state;
    const problems = [];
    window.ZETER_SECURITY_UTILS?.validateSecurityFileSystem(state.fs, {desktopRoots:(state.desktops||[]).map(d=>d.id)}, problems);
    if (problems.some(p=>p.level==='bad')) throw new Error(problems.filter(p=>p.level==='bad').map(p=>p.message).slice(0,4).join(' '));
    const digest = await protection.checksum(file);
    return {sourceState:state,zipBlob:zip,entries,digest,fileName:file.name || 'Бэкап.zip',size:file.size,encrypted,verified:true,checkedAt:Date.now(),payloadCount:paths.size,
      summary:protection.stateSummary(state),choices:window.ZETER_SECURITY_RESTORE_UTILS?.listRestoreChoices(state) || [],warnings:paths.size?['Файлы Windows проверены по байтам. Открытие в установленных программах не выполнялось.']:[]};
  }
  function createRecoveryController(options) {
    const {getState,transaction,validate,migrate,publish,createSafetyPoint,nativeCall,nativeMode,buildBackup,browserVault,notify=()=>{},confirm=()=>false,syncEditors=()=>{},now=()=>Date.now(),schedule=setTimeout,cancelSchedule=clearTimeout}=options;
    let running=false,timer=null,stopped=false,lastAutoAttempt=0,lastAutoErrorAt=0,actionBusy=false;
    const sessions=new WeakMap();
    const session=root=>{if(!sessions.has(root))sessions.set(root,{source:null,preview:null,historyRevision:0});return sessions.get(root);};
    const invalidateRefresh=root=>{session(root).historyRevision++;};
    const roots=new Set();
    const planner=()=>window.ZETER_SECURITY_RESTORE_UTILS;
    const inspect=file=>inspectBackupFile(file,{validate,migrate,requestPassphrase:options.requestPassphrase});
    const escape=value=>window.ZETER_CORE_UTILS.escapeHtml(String(value??''));
    const base64=async blob=>{const data=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(s);};
    const fileFromNative=result=>{const binary=atob(result.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));return new File([bytes],result.name||'Бэкап.zip',{type:'application/zip'});};
    const status=()=>nativeMode()?nativeCall('get_security_backup_status'):browserVault.status();
    function message(root,text,bad=false) {const box=root.querySelector('[data-recovery-status]');if(box){box.textContent=text;box.classList.toggle('bad',bad);box.hidden=!text;}}
    function clearPreview(root) {session(root).preview=null;const box=root.querySelector('[data-recovery-preview]');if(box)box.replaceChildren();const apply=root.querySelector('[data-recovery-action="apply"]');if(apply)apply.hidden=true;}
    function showInspection(root,result) {
      session(root).source=result;
      clearPreview(root);
      const box=root.querySelector('[data-recovery-file-result]');
      box.innerHTML=`<b>Архив прочитан и проверен</b><span>${escape(result.fileName)} · ${escape(new Date(result.checkedAt).toLocaleString('ru-RU'))}</span><small>${escape(result.digest.algorithm)}: ${escape(result.digest.value)}</small><p>Манифест, контрольные суммы, структура состояния и обязательные вложения проверены. Файлов Windows: ${result.payloadCount}. Рабочие данные не изменены.</p><p class="muted">Вложения не запускались. Проверка не подтверждает авторство или безопасность исполняемых файлов.</p>`;
      const list=root.querySelector('[data-recovery-choice]');
      list.innerHTML=result.choices.map(row=>`<option value="${escape(row.key)}">${escape(row.label)} · ${escape(({item:'файл / папка',project:'проект',desktop:'рабочий стол'})[row.kind])}</option>`).join('');
      const targets=root.querySelector('[data-recovery-target]');targets.innerHTML=(getState().desktops||[]).map(d=>`<option value="${escape(d.id)}">${escape(d.name)}</option>`).join('');targets.value=getState().currentDesktop||'desktop';
      root.querySelector('[data-recovery-selective]').hidden=false;
      root.querySelector('[data-recovery-mode]').value='copy';
    }
    async function refresh(root) {
      const revision=++session(root).historyRevision;
      const s=await status(),box=root.querySelector('[data-vault-status]');
      if(revision!==session(root).historyRevision)return s;
      box.textContent=s.configured?`Папка: ${s.folder}. ${s.enabled?'Автокопирование включено':'Автокопирование выключено'}. Последний успех: ${s.lastSuccessAt?new Date(s.lastSuccessAt).toLocaleString('ru-RU'):'ещё нет'}.${s.lastError?' Ошибка: '+s.lastError:''}${s.maintenanceWarning?' '+s.maintenanceWarning:''}`:'Папка истории не выбрана. Выбери место отдельно от папки программы.';
      if (!root.dataset.vaultInitialized) {
        root.querySelector('[data-vault-enabled]').checked=Boolean(s.enabled);
        root.querySelector('[data-vault-interval]').value=String(s.intervalHours||24);
        root.querySelector('[data-vault-count]').value=String(s.maxCopies||14);
        root.querySelector('[data-vault-quota]').value=String(Math.round((s.maxBytes||2147483648)/1048576));
        root.dataset.vaultInitialized='1';
      }
      const entries=root.querySelector('[data-vault-list]');
      entries.innerHTML=(s.entries||[]).map(e=>`<article class="security-restore-card"><div class="security-restore-head"><div><b>${escape(e.name)}</b><small>${escape(new Date(e.createdAt).toLocaleString('ru-RU'))} · ${escape(window.ZETER_CORE_UTILS.bytesToHuman(e.sizeBytes))} · ${e.pinned?'Закреплена':'Автоочистка по правилам'}</small></div></div><div class="security-inline-actions"><button type="button" data-recovery-action="history-inspect" data-id="${escape(e.id)}">Проверить / восстановить</button><button type="button" data-recovery-action="pin" data-id="${escape(e.id)}" data-pinned="${!e.pinned}">${e.pinned?'Открепить':'Закрепить'}</button></div></article>`).join('')||'<p class="muted">Пока нет полных копий. После выбора папки нажми «Создать копию сейчас».</p>';
      return s;
    }
    function makePlan(root,incoming=session(root).source?.sourceState) {
      const source=session(root).source;
      if(!source)throw new Error('Сначала выбери и проверь архив.');
      const selection={key:root.querySelector('[data-recovery-choice]').value,mode:root.querySelector('[data-recovery-mode]').value,targetDesktopId:root.querySelector('[data-recovery-target]').value};
      const stamp=now();const idFactory=()=>{let seq=0;return prefix=>`recovered-${prefix}-${stamp}-${++seq}`;};selection.createId=idFactory();
      const plan=planner().prepareSelectiveRestore(getState(),incoming,selection);
      return {selection,plan,idFactory,fingerprint:JSON.stringify(getState())};
    }
    async function apply(root) {
      const {source,preview}=session(root);
      if(!preview || preview.fingerprint!==JSON.stringify(getState()))throw new Error('Данные изменились после сравнения. Нажми «Сравнить» ещё раз.');
      if(!confirm(preview.selection.mode==='replace'?'Применить показанную замену? Перед записью будет создана страховочная точка.':'Восстановить выбранное отдельной копией? Текущие объекты сохранятся.'))return;
      if(options.hasOpenEditors?.())throw new Error("Закрой окна документов, задач и редакторов перед восстановлением, затем повтори сравнение.");
      await syncEditors();
      if(preview.fingerprint!==JSON.stringify(getState()))throw new Error('Открытые редакторы содержат изменения. Повтори сравнение.');
      const accepted=preview;
      let lease=null, committed=false, committedPaths=[];
      options.setLocked?.(true);
      try {
      await options.prepareApply?.();
      await transaction(async write=>{
        if(accepted.fingerprint!==JSON.stringify(getState()))throw new Error('Данные изменились. Повтори сравнение.');
        const before=clone(getState());
        const safety=await createSafetyPoint(before);
        if(!safety)throw new Error('Не удалось подтвердить страховочную точку. Восстановление остановлено.');
        let incoming=source.sourceState;
        try {
          if(nativeMode() && payloadPaths(incoming).size) {
            lease=await nativeCall('stage_security_restore',{base64:await base64(source.zipBlob)});
            incoming=await hydrateArchiveImages(lease.state,source.entries);
            incoming=migrate?migrate(incoming):incoming;
          } else if(!nativeMode() && payloadPaths(incoming).size)throw new Error('Этот архив содержит файлы Windows. Для восстановления открой ZeTer OS через Python или EXE.');
          const fresh=planner().prepareSelectiveRestore(before,incoming,{...accepted.selection,createId:accepted.idFactory()});
          fresh.state = await validate(fresh.state) || fresh.state;
          if(accepted.fingerprint!==JSON.stringify(getState()))throw new Error("Данные изменились во время подготовки. Повтори сравнение.");
          const result=await write(fresh.state,{requirePrimary:true});
          if(!result?.saved || result.fallback)throw new Error('Основное хранилище не подтвердило запись. Рабочие данные не заменены.');
          publish(fresh.state);
          committed=true;
          const stagedPaths=new Set(lease?.stagedPaths || []);
          committedPaths=[...payloadPaths(fresh.state)].filter(path=>stagedPaths.has(path));
        } finally {
          if(lease?.stageId)await nativeCall('release_security_restore',{stageId:lease.stageId,committedPaths:committed?committedPaths:[]}).catch(error=>notify('Файлы восстановления удерживаются для безопасности',error.message));
        }
      });
      } finally {options.setLocked?.(false);}
      clearPreview(root);notify('Выборочное восстановление выполнено','Состояние записано. Страховочная точка доступна в Центре безопасности.');message(root,'Восстановление завершено. Новые данные доступны в ZeTer OS.');
    }
    async function action(action,root) {
      if(actionBusy || running)throw new Error("Другая операция безопасности ещё выполняется. Дождись завершения.");
      actionBusy=true;
      const name=action.name,id=action.id;
      let {source}=session(root);
      try {
        if(name==='choose-file'){root.querySelector('[data-recovery-file]').click();return;}
        if(name==='inspect-file') {
          const input=root.querySelector('[data-recovery-file]'),file=input.files?.[0];
          if(!file)return;
          source=null;session(root).source=null;clearPreview(root);root.querySelector('[data-recovery-selective]').hidden=true;root.querySelector('[data-recovery-file-result]').replaceChildren();
          try{source=await inspect(file);showInspection(root,source);message(root,'Проверка выбранного файла завершена. Рабочее состояние не изменено.');}finally{input.value='';}return;
        }
        if(name==='compare') {
          const preview=makePlan(root);await validate(clone(preview.plan.state));session(root).preview=preview;
          const labels={add:'Добавить',update:'Заменить',remove:'Удалить'};
          const box=root.querySelector('[data-recovery-preview]');
          box.innerHTML=`<b>Будет изменено объектов: ${preview.plan.changes.length}</b><ul>${preview.plan.changes.map(c=>`<li>${escape(labels[c.action]||c.action)}: ${escape(c.label)}</li>`).join('')}</ul>${(preview.plan.warnings||[]).map(w=>`<p>${escape(w)}</p>`).join('')}<p class="muted">Применение начнётся только после подтверждения. Перед записью сохраняется страховочная точка.</p>`;
          root.querySelector('[data-recovery-action="apply"]').hidden=false;return;
        }
        if(name==='apply'){await apply(root);return;}
        if(name==='history-inspect') {
          const file=nativeMode()?fileFromNative(await nativeCall('read_security_backup',{id})):(()=>null)();
          const selected=file || await browserVault.read({id});
          source=await inspect(selected.blob?new File([selected.blob],selected.name,{type:'application/zip'}):selected);showInspection(root,source);message(root,'Копия истории проверена; можно выбрать объект для восстановления.');return;
        }
        if(name==='pin') {const payload={id,pinned:action.pinned==='true'};if(nativeMode())await nativeCall('pin_security_backup',payload);else await browserVault.pin(payload);await refresh(root);return;}
        if(name==='configure'||name==='choose-folder') {
          if(name==='configure'&&!root.dataset.vaultInitialized)throw new Error('Сначала дождись чтения действующих правил истории или обнови историю. Настройки не изменены.');
          const payload=name==='choose-folder'?{chooseFolder:true}:{enabled:root.querySelector('[data-vault-enabled]').checked,intervalHours:Number(root.querySelector('[data-vault-interval]').value),maxCopies:Number(root.querySelector('[data-vault-count]').value),maxBytes:Number(root.querySelector('[data-vault-quota]').value)*1048576};
          const s=nativeMode()?await nativeCall('configure_security_backups',payload):await browserVault.configure(payload);
          if(s.cancelled)return;
          delete root.dataset.vaultInitialized;await refresh(root);message(root,'Настройки истории сохранены. Копирование работает, пока ZeTer OS открыта.');return;
        }
        if(name==='create-now'){await createBackup();await refresh(root);message(root,'Полная копия записана и перечитана.');return;}
        if(name==='refresh-history'){await refresh(root);return;}
      }catch(error){if(!error.cancelled)message(root,error.message||String(error),true);throw error;}finally{actionBusy=false;}
    }
    async function createBackup() {
      if(running)throw new Error('Полная копия уже создаётся.');running=true;
      try {
        await syncEditors();
        let record;
        await transaction(async()=>{record={app:'ZeTer OS',state:clone(getState()),osVersion:config.OS_VERSION,versionNumber:config.OS_VERSION_NUMBER};});
        return nativeMode()?await nativeCall('create_security_backup',record):await browserVault.create(record);
      }finally{running=false;}
    }
    async function tick() {
      if(stopped)return;
      for(const root of roots)if(!root.isConnected)roots.delete(root);
      if(actionBusy || running || [...roots].some(root=>root.getAttribute("aria-busy")==="true")){timer=schedule(tick,60000);return;}
      if(now()-lastAutoErrorAt<15*60000){timer=schedule(tick,60000);return;}
      try {const s=await status();if(s.configured&&s.enabled&&now()-Number(s.lastSuccessAt||0)>=Number(s.intervalHours||24)*3600000&&now()-lastAutoAttempt>=15*60000){lastAutoAttempt=now();await createBackup();notify('Резервная копия создана','Полный архив проверен после записи.');for(const root of roots)if(root.isConnected)await refresh(root);}}
      catch(error){lastAutoErrorAt=now();notify('Автоматическая копия не создана',error.message||'Открой Центр безопасности и проверь папку.');}
      finally{if(!stopped)timer=schedule(tick,60000);}
    }
    function mount(root) {
      roots.add(root);
      root.querySelector('[data-recovery-file]')?.addEventListener('change',()=>root.querySelector('[data-recovery-action="inspect-file"]').click());
      for(const input of root.querySelectorAll('[data-recovery-choice],[data-recovery-mode],[data-recovery-target]'))input.addEventListener('change',()=>clearPreview(root));
    }
    return Object.freeze({action,refresh,invalidateRefresh,mount,inspect,createBackup,start(){if(timer==null&&!stopped)timer=schedule(tick,10000);},stop(){stopped=true;cancelSchedule(timer);},tick});
  }
  window.ZETER_SECURITY_RECOVERY_UTILS=Object.freeze({payloadPaths,hydrateArchiveImages,inspectBackupFile,createRecoveryController});
})();
