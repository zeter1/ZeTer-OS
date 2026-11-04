"use strict";
// Pure VM fixtures. No application startup, native bridge or user state.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const sandbox = { console, atob }; sandbox.window = sandbox; vm.createContext(sandbox);
sandbox.ZETER_CORE_UTILS = { clamp:(n,min,max)=>Math.max(min,Math.min(max,n)), escapeHtml:String };
sandbox.ZETER_WINDOW_METRICS_UTILS = { topMenuHeight:()=>36, taskbarSpace:()=>66 };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/sticky-utils.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/sticker-library-utils.js"), "utf8"), sandbox);
const lib = sandbox.ZETER_STICKER_LIBRARY_UTILS;
async function main() {
  const state = { desktops: [{ id: "a", name: "Первый", data: { noteStickies: [{ noteId: "old" }] } }, { id: "b", name: "Второй", data: { noteStickies: [{ noteId: "neighbor" }] } }], fs: {
    old: { id: "old", type: "note", parent: "a", name: "Исходная заметка", content: "Текст", richContent: "<p>Текст</p>", managedFiles: [{ id: "attachment", path: "managed/safe.txt" }] },
    neighbor: { id: "neighbor", type: "note", parent: "b", name: "Соседняя", content: "Сохранить" }
  } };
  let id = 0, refuse = false, lastSaved, hold = null, chain = Promise.resolve();
  const controller = lib.createStickerLibraryController({ getState: () => state, createId: prefix => `${prefix}_${++id}`,
    queueMutation: fn => { const result = chain.catch(() => {}).then(fn); chain = result; return result; },
    persistTransaction: operation => operation(async candidate => { if (hold) await hold; if (refuse) throw new Error("Test storage refusal"); lastSaved = JSON.parse(JSON.stringify(candidate)); return { saved: true }; }),
    cleanHtml: value => value, plainText: value => value.replace(/<[^>]*>/g, ""), noteHtml: note => note.richContent || note.content || "" });
  assert.equal(controller.entries().length, 2, "existing note-backed stickers are discovered without migration/copy");
  const original = JSON.stringify(state.fs.old), neighbor = JSON.stringify(state.fs.neighbor);
  await controller.setDesktop("a", "old", false);
  assert.equal(controller.entries().length, 2, "closing desktop sticker retains library entry");
  assert.equal(state.desktops[0].data.noteStickies[0].desktop, false);
  const project = await controller.group("a", "projects", "add", "", "Работа");
  const category = await controller.group("a", "categories", "add", "", "Идеи", project.id);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEt8AAAAASUVORK5CYII=';
  assert.equal(lib.isProjectIconDataURL(png), true);
  for (const unsafe of ['https://example.invalid/icon.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,abc" onerror="bad', 'data:image/png;base64,AAAA', 42, png+'A'.repeat(200000)]) assert.equal(lib.isProjectIconDataURL(unsafe), false);
  const hugeHeader=Buffer.from(png.slice(22),'base64'); hugeHeader.writeUInt32BE(10000,16);
  assert.equal(lib.isProjectIconDataURL('data:image/png;base64,'+hugeHeader.toString('base64')),false);
  state.desktops[0].data.stickyLibrary.projects[0].futureField = 'retain';
  const appearance = { iconId:'rocket', iconDataURL:png, color:'mint', description:'Описание <b>как текст</b>' };
  const metadataBefore=JSON.stringify(state);refuse=true;
  await assert.rejects(controller.group('a','projects','rename',project.id,'Работа','',appearance),/refusal/);
  assert.equal(JSON.stringify(state),metadataBefore);refuse=false;
  await controller.group('a','projects','rename',project.id,'Работа','',appearance);
  assert.equal(controller.library('a').projects[0].iconDataURL,png);
  assert.equal(controller.library('a').projects[0].futureField,'retain');
  assert.equal(JSON.parse(JSON.stringify(state)).desktops[0].data.stickyLibrary.projects[0].description,appearance.description);
  await assert.rejects(controller.group('a','projects','rename',project.id,'Работа','',{iconDataURL:'https://bad.invalid'}),/PNG/);
  await assert.rejects(controller.group('a','projects','rename',project.id,'Работа','',{description:42}),/Описание/);
  await controller.setPreferences('a',{density:'compact',sort:'name',defaultColor:'pink',showPath:false,showHint:false});
  assert.equal(controller.library('a').preferences.density,'compact');
  assert.equal(controller.library('b').preferences.density,'comfortable');
  const preferencesBefore=JSON.stringify(state);refuse=true;
  await assert.rejects(controller.setPreferences('a',{density:'comfortable'}),/refusal/);refuse=false;
  assert.equal(JSON.stringify(state),preferencesBefore);
  await assert.rejects(controller.group("a", "projects", "add", "", "работа"), /уже/);
  const created = await controller.saveEntry("a", { title: "Новый стикер", richHtml: "<p>Текст\nКириллица</p>", projectId: project.id, categoryId: category.id, color: "mint", favorite: true });
  assert.equal(lib.PROJECT_COLORS.length,16);
  for (const color of lib.PROJECT_COLORS) {
    await controller.saveEntry('a',{title:'Новый стикер',color,projectId:project.id,categoryId:category.id,favorite:true},created.noteId);
    assert.equal(controller.entries().find(row=>row.note.id===created.noteId).sticky.color,color);
    assert.equal(sandbox.ZETER_STICKY_UTILS.normalizeStickySettings({color}).color,color);
  }
  assert.equal(state.fs[created.noteId].content, "Текст\nКириллица");
  assert.equal(state.fs[created.noteId].parent, "a");
  assert.equal(controller.entries().find(row => row.note.id === created.noteId).sticky.desktop, false);
  const stableNote = state.fs[created.noteId];
  const editorBaseline = { title: stableNote.name, richHtml: stableNote.richContent, sticky: { ...controller.entries().find(row => row.note.id === created.noteId).sticky } };
  const staleDraft = { title: stableNote.name, richHtml: stableNote.richContent, ...editorBaseline.sticky };
  await controller.toggleFavorite('a', created.noteId);
  const newerMetadata = JSON.stringify(state);
  await assert.rejects(controller.saveEntry('a', staleDraft, created.noteId, editorBaseline), /другом окне/);
  assert.equal(JSON.stringify(state), newerMetadata, 'stale metadata must not be published');
  // Placement is independent of the fields edited in the library form.
  const freshBaseline = { title: stableNote.name, richHtml: stableNote.richContent, sticky: { ...controller.entries().find(row => row.note.id === created.noteId).sticky } };
  await controller.setDesktop('a', created.noteId, true, {x:200,y:200});
  await controller.saveEntry('a', { ...staleDraft, favorite: freshBaseline.sticky.favorite }, created.noteId, freshBaseline);
  assert.equal(controller.entries().find(row=>row.note.id===created.noteId).sticky.x,200);
  for (const kind of ['projects','categories']) {
    const id = kind === 'projects' ? project.id : category.id;
    const oldGroup = JSON.stringify(controller.library('a')[kind].find(row=>row.id===id));
    await controller.group('a',kind,'rename',id,'Новое '+kind);
    const renamedState = JSON.stringify(state);
    await assert.rejects(controller.group('a',kind,'rename',id,'Устаревшее','',null,oldGroup),/другом окне/);
    await assert.rejects(controller.group('a',kind,'remove',id,'','',null,oldGroup),/другом окне/);
    assert.equal(JSON.stringify(state),renamedState,'stale group rename/remove must not publish');
  }
  const oldPreferences = JSON.stringify(controller.library('a').preferences);
  await controller.setPreferences('a',{density:'comfortable',sort:'name',defaultColor:'mint',showPath:true,showHint:true});
  const newPreferencesState=JSON.stringify(state);
  await assert.rejects(controller.setPreferences('a',{density:'compact'},oldPreferences),/другом окне/);
  assert.equal(JSON.stringify(state),newPreferencesState,'stale preferences must not publish');

  const before = JSON.stringify(state); refuse = true;
  await assert.rejects(controller.removeEntry("a", "old"), /refusal/);
  assert.equal(JSON.stringify(state), before, "failed primary ACK has no live mutation");
  refuse = false;
  await controller.removeEntry("a", "old");
  assert.equal(JSON.stringify(state.fs.old), original, "deleting sticker preserves note rich text and attachments byte-for-byte");
  assert.equal(JSON.stringify(state.fs.neighbor), neighbor);
  await controller.group("a", "projects", "remove", project.id);
  const retained = controller.entries().find(row => row.note.id === created.noteId);
  assert.equal(retained.sticky.projectId, ""); assert.equal(retained.sticky.categoryId, "");
  assert.equal(controller.library("a").categories.length, 0);
  const savedNote = JSON.stringify(state.fs[created.noteId]);
  await assert.rejects(controller.saveEntry("a", { title: "Stale" }, created.noteId, { title: "Old", richHtml: "Old" }), /другом окне/);
  assert.equal(JSON.stringify(state.fs[created.noteId]), savedNote);
  await assert.rejects(controller.saveEntry("b", { title: "Wrong workspace" }, created.noteId), /недоступен/);
  let release; hold = new Promise(resolve => { release = resolve; });
  const pending = controller.toggleFavorite("a", created.noteId);
  await new Promise(resolve => setImmediate(resolve));
  state.fs.neighbor.content = "Изменено во время ACK";
  release(); await pending; hold = null;
  assert.equal(state.fs.neighbor.content, "Изменено во время ACK");
  const edited = state.fs[created.noteId];
  hold = new Promise(resolve => { release = resolve; });
  const concurrent = controller.saveEntry("a", { title: edited.name, richHtml: "candidate", color: "blue" }, created.noteId);
  await new Promise(resolve => setImmediate(resolve));
  state.fs[created.noteId].richContent = "typed while ACK";
  release();
  await assert.rejects(concurrent, /другом окне во время/); hold = null;
  assert.equal(state.fs[created.noteId].richContent, "typed while ACK", "late note input must survive ACK publication");
  assert.equal(lastSaved.fs[created.noteId].richContent, "typed while ACK", "durable state compensates rejected stale candidate");
  const currentAppearance = () => {
    const s=sandbox.ZETER_STICKY_UTILS.normalizeStickySettings({...controller.entries().find(row=>row.note.id===created.noteId).sticky});
    return Object.fromEntries(['color','textColor','fontSize','opacity'].map(key=>[key,s[key]]));
  };
  const oldAppearance = currentAppearance(), nextAppearance = {color:'teal',textColor:'dark',fontSize:18,opacity:.85};
  const appearanceDraft = {title:state.fs[created.noteId].name,richHtml:state.fs[created.noteId].richContent,preserveMetadata:true,appearance:nextAppearance};
  const appearanceExpected = {title:appearanceDraft.title,richHtml:appearanceDraft.richHtml,appearance:oldAppearance};
  const beforeAppearance = JSON.stringify(state);refuse=true;
  await assert.rejects(controller.saveEntry('a',appearanceDraft,created.noteId,appearanceExpected),/refusal/);
  assert.equal(JSON.stringify(state),beforeAppearance);refuse=false;
  await controller.saveEntry('a',appearanceDraft,created.noteId,appearanceExpected);
  assert.deepEqual(currentAppearance(),nextAppearance);
  await assert.rejects(controller.saveEntry('a',appearanceDraft,created.noteId,appearanceExpected),/Оформление.*другом окне/);
  await assert.rejects(controller.saveEntry('a',{...appearanceDraft,appearance:{...nextAppearance,fontSize:999}},created.noteId),/настройки/);
  state.fs[created.noteId].deletedAt = 12;
  assert.equal(controller.entries().length, 1, "legacy-deleted notes must stay hidden without deletion");
  delete state.fs[created.noteId].deletedAt;
  assert.equal(lib.stickerEntries(JSON.parse(JSON.stringify(lastSaved))).length, 2, "JSON export/reload retains stickers and groups");
  state.fs.neighbor.parent = "legacy-deleted-root";
  assert.equal(controller.entries().length, 1, "hidden/deleted or wrong-workspace notes are not exposed");
  console.log("sticker library smoke: PASS (existing notes, independent desktops, groups, ACK refusal/retry, safe deletion, stale edits, JSON round-trip)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
