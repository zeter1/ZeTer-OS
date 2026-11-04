'use strict';
// Minimal backup panel regression. Synthetic DOM-free model; no real user data.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app/js/app.js'),'utf8');
const sandbox=vm.createContext({window:{
 ZETER_CORE_UTILS:{escapeHtml:s=>String(s)},
 ZETER_SECURITY_UTILS:{
  normalizeSecurityMeta:v=>v||{},collectExternalSaveSnapshotModel:()=>({}),
  collectSecuritySnapshotModel:()=>({}),runSecurityIntegrityModel:()=>({}),
  repairSafeSecurityState:()=>({})
 },
 ZETER_SECURITY_PROTECTION_UTILS:{
  normalizeProtectionPolicy:v=>v||{},protectionProfile:()=>({}),
  recordSecurityEvent:()=>{},stateSummary:()=>({}),
  compareStateSummaries:()=>true,encryptedBackupSupported:()=>false,
  describeRestorePoint:v=>v
 }
},console});
vm.runInContext(fs.readFileSync(path.join(root,'app/js/core/security-ui-utils.js'),'utf8'),sandbox);
const security=sandbox.window.ZETER_SECURITY_UI_UTILS;
const html=security.securityCenterShellHTML(true);
const between=html.split('data-security-panel="backups" hidden>')[1].split('data-security-panel="storage" hidden>')[0];
assert.equal((between.match(/<button\b/g)||[]).length,2,'backups has exactly two buttons');
assert.match(between,/Скачать резервную копию данных/);
assert.match(between,/Загрузить резервную копию данных/);
assert.match(between,/data-security-backup/);
assert.match(between,/data-security-import/);
for(const text of ['ZIP-копии в Google Drive','Автоматически сохранять ZIP','Точки восстановления',
 'Создать точку восстановления','data-drive-action','data-vault','data-recovery-action']){
 assert.ok(!between.includes(text),'removed controls must be absent from backup panel: '+text);
}
assert.ok(!html.includes('data-security-restore-point'),'manual point control removed in all tabs');
assert.ok(!html.includes('data-security-policy-save'),'automatic point policy no longer exposed');
const target=selector=>({closest:pattern=>pattern===selector?{dataset:{}}:null});
assert.equal(security.securityCenterAction(target('[data-security-backup]')).type,'backup');
assert.equal(security.securityCenterAction(target('[data-security-import]')).type,'import');
assert.ok(!app.includes('googleDriveBackupController.start()'),'cloud polling must not start');
assert.ok(!app.includes('googleDriveBackupController.refresh()'),'no background Google Drive refresh');
assert.ok(!app.includes('securityRecoveryController.start()'),'no hidden ZIP history scheduler');
assert.match(app,/openImport:\s*\(\)\s*=>\s*\$\("#import-file"\)/);
assert.match(app,/buildZip:\s*\(\)\s*=>\s*buildFullSecurityBackup\(\)/);
const index=fs.readFileSync(path.join(root,'app/index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'app/service-worker.js'),'utf8');
for(const text of ['google-drive-backup-utils.js','google-drive-config.json']){
 assert.ok(!index.includes(text),'inactive Google adapter/config must not be loaded');
 assert.ok(!worker.includes(text),'inactive Google adapter/config must not enter the cache');
 assert.ok(!fs.existsSync(path.join(root,'app',text.endsWith('.js')?'js/core/'+text:text)),'inactive Google files must stay outside public app');
}
assert.ok(!app.includes('loadGoogleDriveConfig'),'unused identity loader must be absent');
assert.ok(!app.includes('accounts.google.com/gsi/client'),'removed integration must not load Google Identity');
console.log('SIMPLE_BACKUP_UI_PASS: two offline ZIP actions; no cloud, manual points or automatic background copy');
