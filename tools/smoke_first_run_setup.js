"use strict";

// Synthetic state only: no app startup, storage, registry or external download.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { window: { ZETER_CORE_UTILS: { escapeHtml: value => String(value ?? "") } } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/first-run-ui-utils.js"), "utf8"), sandbox);
const api = sandbox.window.ZETER_FIRST_RUN_UI_UTILS;
assert.equal(typeof api.applyFirstRunDraft, "function", "first-run choices need a staged snapshot owner");
const fixture = {
  currentDesktop: "desktop", firstRunCompleted: false,
  desktops: [{ id: "desktop", name: "Основной", data: { settings: { volume: 41, explorerView: { compact: true } }, tasks: [{id:"task-1"}] } }, {id:"other",data:{settings:{wallpaper:"silk"}}}],
  fs: {
    tasks: {id:"tasks",type:"app",appId:"tasks",parent:"desktop",name:"Задачи",x:50,y:70},
    settings: {id:"settings",type:"app",appId:"settings",parent:"desktop"},
    nested: {id:"nested",type:"app",appId:"settings",parent:"folder"},
    foreign: {id:"foreign",type:"app",appId:"settings",parent:"other"},
    note: {id:"note",type:"note",parent:"desktop",name:"Моё",content:"keep"}
  },
  taskbarPinnedApps: ["settings"], systemSettings: { hotkeys: { search:"Ctrl+Space" } }
};
const before = JSON.stringify(fixture);
const draft = { desktopName:"  Мастерская  ",wallpaper:"mint",desktopApps:["tasks","calendar","calendar"],taskbarApps:["calendar"],desktopAppearance:{iconSize:"large",density:"comfortable",extensions:false},systemSettings:{startup:{restoreWindows:false,desktop:"desktop",windowMode:"windowed"},hotkeys:{search:"Ctrl+Space"}} };
let serial = 0;
const options = {desktopId:"desktop",apps:{tasks:{name:"Задачи"},settings:{name:"Настройки"},calendar:{name:"Календарь"},private:{name:"Hidden",hidden:true}},createId:()=>`new-${++serial}`,normalizeSystemSettings:value=>value,normalizeDesktopAppearance:value=>value,normalizeTaskbarPinnedApps:ids=>ids.filter(id=>["tasks","calendar","settings"].includes(id))};
const candidate = JSON.parse(before);
api.applyFirstRunDraft(candidate,draft,options);
assert.equal(JSON.stringify(fixture),before,"candidate building must never touch live state");
assert.equal(candidate.desktops[0].name,"Мастерская");
assert.equal(candidate.desktops[0].data.settings.volume,41);
assert.equal(candidate.desktops[0].data.settings.explorerView.compact,true);
assert.equal(candidate.desktops[0].data.settings.desktopAppearance.extensions,false);
assert.equal(candidate.fs.tasks.id,"tasks");
assert.equal(candidate.fs.tasks.x,50);
assert.equal(candidate.fs.settings,undefined,"only unchecked app shortcut at selected root is removed");
assert.ok(candidate.fs.nested && candidate.fs.foreign && candidate.fs.note);
assert.equal(Object.values(candidate.fs).filter(item=>item.appId==="calendar").length,1);
assert.deepEqual(Array.from(candidate.taskbarPinnedApps),["calendar"]);
assert.equal(candidate.firstRunCompleted,true);
for (const delta of [{desktopName:" "},{wallpaper:"bad"},{desktopApps:["private"]},{taskbarApps:["unknown"]},{systemSettings:{startup:{desktop:"missing"}}}]) {
  assert.throws(()=>api.applyFirstRunDraft(JSON.parse(before),{...draft,...delta},options));
}
api.applyFirstRunDraft(JSON.parse(before),null,options);
const hiddenPin = JSON.parse(before);
hiddenPin.taskbarPinnedApps.push("table");
api.applyFirstRunDraft(hiddenPin,draft,{...options,apps:{...options.apps,table:{hidden:true}},normalizeTaskbarPinnedApps:ids=>ids});
assert.deepEqual(Array.from(hiddenPin.taskbarPinnedApps),["calendar","table"],"unlisted hidden app pins must survive catalog selection");
console.log("first-run setup smoke: staged choices, IDs/data, app selection, appearance, startup and validation: ok");
