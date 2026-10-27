'use strict';
// Synthetic UI boundary only: no startup, filesystem state, native bridge or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
async function main(){
 const children=[],list={innerHTML:''},badge={textContent:'',classList:{toggle(){}}},listeners=new Map();
 const document={body:{append(node){children.push(node);}},activeElement:null,querySelector:name=>name==='#notification-list'?list:name==='#notif-count'?badge:null,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn),createElement:()=>({setAttribute(){},innerHTML:'',remove(){const at=children.indexOf(this);if(at>=0)children.splice(at,1);}})};
 const sandbox={window:{ZETER_CORE_UTILS:{escapeHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')},ZETER_NOTIFICATION_UTILS:{notificationMatchesFilter:()=>true}},console};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/core/notification-ui-utils.js'),'utf8'),sandbox);
 const api=sandbox.window.ZETER_NOTIFICATION_UI_UTILS,workspace={notifications:[]},before=JSON.stringify(workspace);let saves=0,accepted=0,deferred=0,release,fail=false,hold=false;
 const errors=[];let ui;const center=api.createNotificationCenterController({document,getNotifications:()=>workspace.notifications,getIncoming:()=>ui?.getIncoming(),saveState:()=>saves++});
 ui=api.createDriveIncomingController({document,onChange:()=>center.render(),acceptIncoming:async key=>{accepted++;if(hold)await new Promise((resolve,reject)=>release={resolve,reject});if(fail)throw new Error('synthetic rejection');if(ui.getIncoming()?.key===key)ui.setIncoming(null);},deferIncoming:async key=>{deferred++;ui.setIncoming({...ui.getIncoming(),deferred:true});},onError:error=>errors.push(error.message)});
 const offer=(key,extra={})=>ui.setIncoming({key,text:'<unsafe>',busy:false,deferred:false,...extra});
 offer('a');assert.equal(children.length,1);assert.match(list.innerHTML,/&lt;unsafe>/);assert.equal(badge.textContent,1);assert.equal(accepted,0,'offer does not load data');
 await ui.action('defer','a');assert.equal(deferred,1);assert.equal(children.length,0);assert.match(list.innerHTML,/Загрузить новые данные/);offer('a',{deferred:true});assert.equal(children.length,0,'same deferred head stays quiet');
 offer('b');assert.equal(children.length,1);await ui.action('accept','a');assert.equal(accepted,0,'stale head button has no effect');
 hold=true;const first=ui.action('accept','b');await Promise.resolve();assert.equal(ui.getIncoming().busy,true);await ui.action('accept','b');assert.equal(accepted,1,'double action does not duplicate load');
 ui.setIncoming(null);offer('c');release.reject(Object.assign(new Error('stale cancelled callback'),{cancelled:true}));await first;assert.equal(ui.getIncoming().key,'c');assert.equal(ui.getIncoming().busy,false);assert.deepEqual(errors,[]);
 hold=false;fail=true;await ui.action('accept','c');assert.equal(ui.getIncoming().key,'c');assert.equal(ui.getIncoming().busy,false);assert.deepEqual(errors,['synthetic rejection']);
 fail=false;await ui.action('accept','c');assert.equal(ui.getIncoming(),null);assert.equal(children.length,0);assert.equal(badge.textContent,0);
 assert.equal(JSON.stringify(workspace),before,'transient UI never changes workspace');assert.equal(saves,0,'transient UI never saves synced data');
 console.log('DRIVE_INCOMING_NOTIFICATIONS_PASS: no apply before click, transient state, defer/same/new head, stale key, busy guard, cancellation, refusal→retry.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
