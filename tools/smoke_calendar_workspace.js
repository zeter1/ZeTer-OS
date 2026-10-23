"use strict";
// Exact production adapters + real primary queue on synthetic state. No startup/native/user files.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.resolve(__dirname, ".."), clone = value => JSON.parse(JSON.stringify(value));
const box = { console, structuredClone, TextEncoder, setTimeout, clearTimeout, crypto: require("node:crypto").webcrypto };
box.window = box; box.ZETER_TIME_TRACKING_UTILS = {}; vm.createContext(box);
for (const name of ["project-overview-utils", "config", "utils", "data-normalizers", "storage-utils", "fs-item-utils"]) vm.runInContext(fs.readFileSync(path.join(root, `app/js/core/${name}.js`), "utf8"), box);
const workspaceSource = fs.readFileSync(path.join(root, "app/js/core/workspace-utils.js"), "utf8");
vm.runInContext(workspaceSource.slice(workspaceSource.indexOf("  function normalizeWorkspaceCalendarState("), workspaceSource.indexOf("  function workspaceDefaults(")), box);
box.ZETER_WORKSPACE_UTILS = { normalizeWorkspaceCalendarState: box.normalizeWorkspaceCalendarState };
const appSource = fs.readFileSync(path.join(root, "app/js/app.js"), "utf8");
vm.runInContext(appSource.slice(appSource.indexOf("  function calendarWorkspaceTools("), appSource.indexOf("  function renderCalendarApp(")), box);

async function main() {
  const first = { tasks: [{ id: "task_a", title: "Исходная задача" }], taskProjects: [], events: [{ id: "event_a", title: "Соседнее событие" }], calendarState: {view:"month",workStart:"09:00",workEnd:"18:00"}, calendarCategories: [] };
  const other = { tasks: [], events: [{ id: "other_event" }], calendarCategories: [{id:"calcat_other",name:"Другой стол",color:"#112233"}] };
  const state = { desktops: [{id:"desktop",data:first},{id:"other",data:other}], fs: {file_a:{id:"file_a",type:"text",name:"Документ.txt",parent:"desktop"},file_other:{id:"file_other",type:"text",name:"Другой.txt",parent:"other"}} };
  const originalOther = JSON.stringify(other), originalEvents = JSON.stringify(first.events);
  let refuse = false, disk, sequence = 0, copies = 0, native = true, chain = Promise.resolve();
  const refreshExclusions = [];
  Object.assign(box, {
    state, uid: prefix => `${prefix}_${++sequence}`, getDesktopRoot:()=>"desktop",
    OBJECT_LINKABLE_FS_TYPES:new Set(["text","managedFile"]), OBJECT_LINK_FS_TYPE_LABELS:{text:"Текст",managedFile:"Файл"},
    itemInWorkspace:(item,id)=>item.parent===id,
    workspaceItems:id=>Object.values(state.fs).filter(item=>item.parent===id),
    shouldUseNativeStorage:()=>native, nativeStorageCall:()=>{throw new Error("No real native API allowed");},
    renderAllFileSurfaces(){},calendarMutationSaved(){},refreshOpenCalendars(id){refreshExclusions.push(id);},openItem(){},
    syncLegacyWorkspaceAliases:value=>{value.events=value.desktops[0].data.events;},
    queueAutomationMutation:operation=>{const result=chain.catch(()=>{}).then(operation);chain=result.catch(()=>{});return result;},
    ZETER_MANAGED_FILE_UTILS:{copyFileToManagedStorage:async file=>{copies++;return {name:file.name,extension:"pdf",managedPath:`fixture/${copies}.pdf`,size:123,type:"application/pdf"};}}
  });
  const queue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({getState:()=>state,cloneState:clone,writesAllowed:()=>true,nativeStorage:()=>true,writePrimaryRecord:async snapshot=>{if(refuse)throw new Error("fixture refusal");disk=clone(snapshot);return {updatedAt:1};}});
  box.persistSearchAwareTransaction = operation=>queue.transaction(operation);
  const tools = box.calendarWorkspaceTools("desktop", "calendar-window");
  assert.equal(tools.getAttachmentCandidates().length,1,"no cross-workspace candidate");
  assert.equal(tools.resolveAttachment({kind:"fs",id:"file_other"}),null);
  refuse=true;
  await assert.rejects(tools.saveCalendarPreferences({view:"week"}),/refusal|подтвердило/);
  assert.equal(first.calendarState.view,"month");
  refuse=false;
  await tools.saveCalendarPreferences({view:"week",workStart:"08:30",workEnd:"19:00",unknown:"ignored"});
  assert.equal(first.calendarState.view,"week");assert.equal(disk.desktops[0].data.calendarState.workStart,"08:30");
  assert.equal(Object.hasOwn(first.calendarState,"unknown"),false);
  await assert.rejects(tools.saveCalendarPreferences({workStart:"20:00",workEnd:"08:00"}),/позже/);
  refuse=true;
  await assert.rejects(tools.saveCategory({name:"Семья",color:"#aabbcc"}),/refusal|подтвердило/);
  assert.equal(first.calendarCategories.length,0);
  refuse=false;
  const category=await tools.saveCategory({name:"Семья",color:"#aabbcc"});
  assert.deepEqual(refreshExclusions,["calendar-window"],"category ACK must not remount its own calendar and discard its controls");
  assert.match(category.id,/^calcat_/);assert.equal(first.calendarCategories[0].name,"Семья");
  await assert.rejects(tools.saveCategory({name:"семья",color:"#aabbcc"}),/уже есть/);
  const original=clone(category);
  await tools.saveCategory({name:"Дом",color:"#112233"},category.id,original);
  await assert.rejects(tools.saveCategory({name:"Устаревшее",color:"#112233"},category.id,original),/другом окне/);
  const metadataBefore=JSON.stringify(first);
  refuse=true;
  await assert.rejects(tools.saveCategory({name:"Дом",color:"#112233",description:"Семейные события",icon:"🏠"},category.id,clone(first.calendarCategories[0])),/refusal|подтвердило/);
  assert.equal(JSON.stringify(first),metadataBefore);
  refuse=false;
  await tools.saveCategory({name:"Дом",color:"#112233",description:"Семейные события",icon:"🏠"},category.id,clone(first.calendarCategories[0]));
  assert.equal(first.calendarCategories[0].description,"Семейные события");assert.equal(first.calendarCategories[0].icon,"🏠");
  for(const fields of [{description:"x".repeat(1001)},{icon:"not-an-icon"}]) await assert.rejects(tools.saveCategory({name:"Дом",color:"#112233",...fields},category.id,clone(first.calendarCategories[0])));
  const currentCategory=clone(first.calendarCategories[0]);
  first.events.push({id:"categorized",title:"Событие с файлом",category:category.id,description:"Описание",attachments:[{kind:"fs",id:"file_a"}],repeat:"weekly",repeatWeekdays:[1,3]});
  const beforeDelete=JSON.stringify(first), neighboringEvent=clone(first.events[0]), linkedEvent=clone(first.events[1]);
  await assert.rejects(tools.deleteCategory(category.id,"personal",original),/другом окне/);
  await assert.rejects(tools.deleteCategory(category.id,"",currentCategory),/перенести/);
  await assert.rejects(tools.deleteCategory(category.id,category.id,currentCategory),/существующую/);
  await assert.rejects(tools.deleteCategory(category.id,"calcat_missing",currentCategory),/существующую/);
  assert.equal(JSON.stringify(first),beforeDelete);
  refuse=true;
  await assert.rejects(tools.deleteCategory(category.id,"personal",currentCategory),/refusal|подтвердило/);
  assert.equal(JSON.stringify(first),beforeDelete,"refusal keeps category, event fields and neighbors intact");
  refuse=false;
  await tools.deleteCategory(category.id,"personal",currentCategory);
  assert.equal(first.calendarCategories.length,0);
  assert.deepEqual(clone(first.events[0]),neighboringEvent);
  assert.deepEqual({...clone(first.events[1]),updatedAt:undefined},{...linkedEvent,category:"personal",updatedAt:undefined});
  assert.deepEqual(clone(disk.desktops[0].data.events),clone(first.events));
  first.events.pop();
  assert.equal(JSON.stringify(first.events),originalEvents);
  const unusedCategory=await tools.saveCategory({name:"Пустая",color:"#112233"});
  await tools.deleteCategory(unusedCategory.id,"",unusedCategory);
  assert.equal(first.calendarCategories.length,0);
  await assert.rejects(tools.deleteCategory("work","personal",{}),/другом окне/);
  native=false;await assert.rejects(tools.importEventFiles([{name:"test.pdf"}]),/Windows\/Python/);assert.equal(copies,0);
  native=true;
  const file={name:"Вложение.pdf"};refuse=true;
  await assert.rejects(tools.importEventFiles([file]),/refusal|подтвердило/);
  assert.equal(Object.keys(state.fs).length,2,"ACK refusal does not publish fs material");
  refuse=false;
  const refs=await tools.importEventFiles([file]);
  assert.equal(refs.length,1);assert.equal(copies,1,"retry reuses completed managed copy");
  assert.equal(state.fs[refs[0].id].name,"Вложение.pdf");
  assert.equal(disk.fs[refs[0].id].type,"managedFile");
  assert.deepEqual(clone(await tools.importEventFiles([file])),clone(refs));
  assert.equal(Object.keys(state.fs).length,3,"repeated selection does not duplicate saved file");
  assert.equal(JSON.stringify(other),originalOther);assert.equal(JSON.stringify(first.events),originalEvents);
  assert.equal(tools.getTasks()[0].id,"task_a");
  console.log("calendar workspace smoke: ok (preferences/category ACK/refusal/retry/stale/delete-transfer, native import boundary/retry, files and workspace isolation)");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
