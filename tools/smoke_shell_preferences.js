"use strict";
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const nodes = Object.fromEntries(['#clock','#date-line','#lock-time','#lock-date','#tray','#toast-stack'].map(id=>[id,{textContent:'',children:[],appendChild(node){this.children.push(node);}}]));
const timers = [];
const sandbox = { window: { ZETER_CORE_UTILS: { $: id=>nodes[id], $$:()=>[], escapeHtml:String } }, document:{createElement:()=>({remove(){this.removed=true;}})}, setTimeout:(fn,ms)=>{timers.push({fn,ms});} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../app/js/core/shell-ui-utils.js'),'utf8'),sandbox);
const shell = sandbox.window.ZETER_SHELL_UI_UTILS;
const midnight=new Date(2026,0,1,0,5,7), noon=new Date(2026,0,1,12,5,7);
assert.equal(shell.clockViewModel({},midnight).time,'00:05');
assert.equal(shell.clockViewModel({format:'12h',showSeconds:true},midnight).time,'12:05:07 AM');
assert.equal(shell.clockViewModel({format:'12h'},noon).time,'12:05 PM');
shell.updateClock({showDate:false,showSeconds:true},midnight);
assert.equal(nodes['#date-line'].hidden,true);
assert.equal(nodes['#clock'].textContent,'00:05:07');
shell.updateClock({showDate:true},midnight); assert.equal(nodes['#date-line'].hidden,false);
for(const duration of [3500,5000,8000,12000]){shell.toast('Тест','Сообщение',duration);assert.equal(timers.at(-1).ms,duration);}
shell.toast('Тест','',-1);assert.equal(timers.at(-1).ms,3500);
timers[0].fn();assert.equal(nodes['#toast-stack'].children[0].removed,true);assert.equal(nodes['#toast-stack'].children[1].removed,undefined);
console.log('shell preferences: PASS (midnight/noon, 12/24, seconds/date, bounded toast duration)');
