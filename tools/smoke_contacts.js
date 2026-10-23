"use strict";
// Hermetic model/controller checks: no app startup, native APIs, browser storage or real data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = { console, structuredClone, Date, URL, TextEncoder };
context.window = context;
vm.createContext(context);
for (const file of ["contacts-utils.js", "storage-utils.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", file), "utf8"), context, { filename: file });
const api = context.ZETER_CONTACTS_UTILS;
const json = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let sequence = 0;
const createId = prefix => `${prefix}_${++sequence}`;
const entry = (id, extra = {}) => ({ id, projectId: "p1", categoryId: "c1", name: "Семён Петров", company: "Студия Север", role: "Дизайнер", city: "Минск", phone: "+375 (29) 123-45-67", secondaryPhone: "", email: "semen@example.test", telegram: "@semen_test", website: "https://example.test", tags: ["Партнёр"], notes: "  Познакомились на выставке\r\nДелает макеты  ", favorite: true, createdAt: 10, updatedAt: 20, fields: [], ...extra });
const fixture = () => ({ contacts: { projects: [{ id: "p1", name: "Работа" }, { id: "p2", name: "Личное" }], categories: [{ id: "c1", projectId: "p1", name: "Клиенты" }, { id: "c2", projectId: "p2", name: "Друзья" }], entries: [entry("e1"), entry("e2", { projectId: "p2", categoryId: "c2", name: "Анна", favorite: false }), entry("e3", { projectId: "", categoryId: "", name: "Борис", favorite: false })] } });
function simpleController(workspace, saveState = async () => ({ saved: true })) { return api.createContactsController({ getWorkspace: () => workspace, createId, saveState }); }
function validationAndSearch() {
  const state = fixture(); api.validateContacts(state.contacts);
  assert.deepEqual(json(api.normalizeContacts()), { projects: [], categories: [], entries: [] });
  const rows = (project, filter, query, sort) => json(api.filterContacts(state.contacts, project, filter, query, sort)).map(item => item.id);
  assert.deepEqual(rows(null, "all", ""), ["e2", "e3", "e1"], "Russian name ordering is deterministic");
  assert.deepEqual(rows("p1", "all", "СЕМЕН студия МИНСК партнер макеты"), ["e1"], "tokens cover multiple fields and е/ё");
  assert.deepEqual(rows("p1", "all", "375291234567"), ["e1"], "unformatted number matches formatted phone");
  assert.deepEqual(rows("p1", "all", "+375 (29) 123-45-67"), ["e1"]);
  assert.deepEqual(rows("p1", "all", "+375 (29) 123\u201145\u201167"), ["e1"], "copied phone punctuation matches normalized phone digits");
  assert.deepEqual(rows("", "all", ""), ["e3"], "unassigned differs from all projects");
  assert.deepEqual(rows(null, "favorites", ""), ["e1"]);
  assert.deepEqual(rows("p1", "c2", ""), [], "category cannot reveal another project's contact");
  assert.deepEqual(rows(null, "uncategorized", ""), ["e3"]);
  state.contacts.entries[0].updatedAt = 80;
  assert.equal(rows(null, "all", "", "recent")[0], "e1");
  for (const change of [
    value => value.projects.push({ id: "p3", name: " РАБОТА " }),
    value => value.categories.push({ id: "c3", projectId: "p1", name: "клиенты" }),
    value => { value.categories[0].id = "favorites"; },
    value => { value.entries[0].projectId = "p2"; },
    value => { value.entries[0].phone = 123; },
    value => { value.entries[0].favorite = "true"; },
    value => { value.entries[0].name = " "; },
    value => { value.entries[0].name = "x".repeat(301); },
    value => { value.entries[0].id = "__proto__"; },
    value => { value.entries[0].id = "../escape"; },
    value => { value.entries[0].fields = [{ id: "p1", type: "text", label: "", value: "" }]; },
    value => { value.entries[0].fields = [{ id: "f1", type: "invalid", label: "", value: "" }]; },
    value => { value.entries[0].fields = [{ id: "f1", type: "text", label: "", value: false }]; },
    value => { value.entries[0].fields = [{ id: "f1", type: "text", label: "x".repeat(121), value: "" }]; },
    value => { value.entries[0].fields = [{ id: "f1", type: "text", label: "", value: "x".repeat(20001) }]; },
    value => { value.entries[0].fields = Array.from({ length: 101 }, (_, index) => ({ id: `f${index}`, type: "phone", label: "", value: "" })); },
    value => { value.entries[0].fields = [{ id: "f1", type: "phone", label: "", value: "" }]; value.entries[1].fields = [{ id: "f1", type: "email", label: "", value: "" }]; }
  ]) { const value = json(fixture().contacts); change(value); assert.throws(() => api.validateContacts(value), undefined, "malformed imports must reject before normalization"); }
  const scopes = fixture().contacts; scopes.categories[1].name = "Клиенты"; api.validateContacts(scopes);
  const max = api.normalizeContacts(); max.entries = Array(10001).fill({}); assert.throws(() => api.validateContacts(max), /размер/);
}
async function crudAndRepeatedFields() {
  const state = fixture(), controller = simpleController(state);
  await assert.rejects(controller.addProject("работа"), /уже/);
  await assert.rejects(controller.addCategory("p1", "КЛИЕНТЫ"), /уже/);
  const project = await controller.addProject("Учёба"), category = await controller.addCategory(project.id, "Клиенты");
  const fields = [
    { type: "phone", label: "Рабочий телефон", value: "+7 (999) 111-22-33" },
    { type: "phone", label: "Личный телефон", value: "+375 44 555 66 77" },
    { type: "email", label: "Рабочая почта", value: "first@example.test" },
    { type: "email", label: "Личная почта", value: "second@example.test" },
    { type: "social", label: "Соцсеть", value: "https://social.example.test/user" },
    { type: "url", label: "Портфолио", value: "https://portfolio.example.test" },
    { type: "text", label: "<img onerror=alert(1)>", value: "  произвольное значение  " },
    { type: "multiline", label: "Второе описание", value: "\n\n  exact\r\n<script>text</script>  " },
    { type: "text", label: "Можно заполнить позже", value: "" }
  ];
  const draft = { name: "Мария", projectId: project.id, categoryId: category.id, notes: "Первое описание", favorite: false, fields };
  const created = await controller.saveEntry(draft);
  assert.deepEqual(json(created.fields).map(({ id, ...field }) => field), fields, "all repeatable fields preserve labels, values, duplicates and exact whitespace");
  assert.equal(new Set(created.fields.map(field => field.id)).size, fields.length, "new field IDs are distinct");
  assert.equal(fields.some(field => field.id), false, "controller must not mutate editor draft");
  for (const query of ["79991112233", "375445556677", "second@example.test", "второе exact", "произвольное", "портфолио"]) assert.equal(api.filterContacts(controller.library(), project.id, "all", query)[0]?.id, created.id, `custom search ${query}`);
  const roundTrip = JSON.parse(JSON.stringify(controller.library())); api.validateContacts(roundTrip);
  assert.deepEqual(json(api.normalizeContacts(roundTrip)), roundTrip);
  const removedId = created.fields[1].id;
  await controller.saveEntry({ ...created, fields: created.fields.filter(field => field.id !== removedId) }, created.id);
  const changed = controller.library().entries.find(item => item.id === created.id);
  assert.equal(changed.fields.some(field => field.id === removedId), false);
  assert.deepEqual(json(changed.fields), json(created.fields.filter(field => field.id !== removedId)), "field removal retains other values and identities");
  const withoutName = { ...created, name: "" }; await assert.rejects(controller.saveEntry(withoutName, created.id), /имя/);
  const bare = await controller.saveEntry({ name: "Только имя" }); assert.equal(bare.name, "Только имя");
  const duplicate = await controller.saveEntry(draft); assert.notEqual(duplicate.id, created.id, "duplicate people are allowed");
  await assert.rejects(controller.saveEntry({ ...changed, projectId: "p2" }, changed.id), /Категория/);
  await controller.saveEntry({ ...changed, projectId: "p2", categoryId: "" }, changed.id);
  await controller.renameProject(project.id, "Обучение"); await controller.renameCategory(category.id, "Знакомые");
  const neighborBefore = JSON.stringify(state.contacts.entries.find(item => item.id === "e2"));
  const preserved = json(state.contacts.entries.find(item => item.id === duplicate.id));
  await controller.removeCategory(category.id);
  assert.deepEqual(json(state.contacts.entries.find(item => item.id === duplicate.id)), { ...preserved, categoryId: "" });
  await controller.removeProject(project.id);
  assert.deepEqual(json(state.contacts.entries.find(item => item.id === duplicate.id)), { ...preserved, projectId: "", categoryId: "" });
  assert.equal(JSON.stringify(state.contacts.entries.find(item => item.id === "e2")), neighborBefore, "project removal preserves neighboring data");
  await controller.toggleFavorite(bare.id); assert.equal(state.contacts.entries.find(item => item.id === bare.id).favorite, true);
  await controller.removeEntry(bare.id); assert.equal(state.contacts.entries.some(item => item.id === bare.id), false);
  api.validateContacts(state.contacts);
}
async function rejectionThenRetry() {
  const state = fixture(), before = JSON.stringify(state.contacts);
  let ack = false, received;
  const controller = simpleController(state, async candidate => { received = candidate; state.marker = "independent"; return ack; });
  for (const invalid of [false, true, null, undefined, {}, { saved: false }, { saved: 1 }]) {
    ack = invalid; await assert.rejects(controller.removeCategory("c1"), /не подтвердило/); assert.equal(JSON.stringify(state.contacts), before);
  }
  const draft = { name: "Draft", notes: "  exact draft\n", fields: [{ type: "phone", label: "Два телефона", value: "123" }, { type: "phone", label: "Ещё", value: "456" }] }, draftBefore = JSON.stringify(draft);
  ack = false; await assert.rejects(controller.saveEntry(draft), /не подтвердило/); assert.equal(JSON.stringify(draft), draftBefore); assert.equal(JSON.stringify(state.contacts), before);
  ack = { saved: true }; const saved = await controller.saveEntry(draft); assert.equal(state.contacts.entries.filter(item => item.name === "Draft").length, 1); assert.equal(saved.fields.length, 2); assert.equal(state.marker, "independent"); assert.ok(received.entries.some(item => item.id === saved.id));
  const fail = simpleController(state, async () => { throw new Error("synthetic disk failure"); });
  const accepted = JSON.stringify(state.contacts); await assert.rejects(fail.removeProject("p1"), /synthetic disk failure/); assert.equal(JSON.stringify(state.contacts), accepted);
  await controller.removeProject("p1"); assert.equal(state.contacts.entries.find(item => item.id === "e1").projectId, "");
}
async function stagedPrimaryQueue() {
  const state = { desktops: [{ id: "a", data: fixture() }, { id: "b", data: { contacts: api.normalizeContacts() } }], marker: "before", currentDesktop: "a" };
  const firstWrite = defer(), release = defer(); let calls = 0, persisted;
  const queue = context.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true, writePrimaryRecord: async snapshot => { if (++calls === 1) { firstWrite.resolve(); await release.promise; } persisted = json(snapshot); return { updatedAt: calls }; } });
  const queued = operation => queue.transaction(operation);
  const workspace = state.desktops[0].data;
  const make = () => api.createContactsController({ getWorkspace: () => state.desktops.find(item => item.id === "a")?.data || null, createId,
    persistTransaction: queued, saveSnapshot: (write, contacts) => { const snapshot = json(state); snapshot.desktops.find(item => item.id === "a").data.contacts = contacts; return write(snapshot); } });
  const editorBaseline = json(api.normalizeContacts(workspace.contacts).entries[0]);
  const before = JSON.stringify(workspace.contacts), first = make().removeCategory("c1"); await firstWrite.promise;
  assert.equal(JSON.stringify(workspace.contacts), before, "pending candidate cannot leak into export/live state");
  state.marker = "parallel"; state.currentDesktop = "b";
  const second = make().saveEntry({ name: "Queued person", projectId: "p1", categoryId: "" });
  const staleEdit = make().saveEntry({ ...editorBaseline, role: "Stale draft" }, editorBaseline.id, editorBaseline).catch(error => error);
  release.resolve(); await first; const added = await second;
  assert.match((await staleEdit).message, /другом окне/, "conflict is checked against accepted state after the transaction barrier");
  assert.equal(workspace.contacts.entries.find(item => item.id === "e1").role, "Дизайнер");
  const fresh = json(api.normalizeContacts(workspace.contacts).entries[0]);
  await make().saveEntry({ ...fresh, role: "Fresh edit" }, fresh.id, fresh);
  assert.equal(workspace.contacts.entries.find(item => item.id === "e1").role, "Fresh edit");
  assert.equal(workspace.contacts.entries.find(item => item.id === "e1").categoryId, "");
  assert.ok(workspace.contacts.entries.some(item => item.id === added.id), "queued second writer reads latest accepted library");
  assert.equal(state.desktops[1].data.contacts.entries.length, 0, "desktop switch during pending write cannot move contacts");
  assert.equal(persisted.marker, "parallel"); assert.equal(persisted.currentDesktop, "b");
  assert.equal(persisted.desktops[0].data.contacts.entries.find(item => item.id === "e1").categoryId, "");
  assert.ok(persisted.desktops[0].data.contacts.entries.some(item => item.id === added.id));
  let reachable = workspace;
  const removed = api.createContactsController({ getWorkspace: () => reachable, createId, saveState: () => { throw new Error("must not write"); } });
  const deletion = removed.addProject("Unavailable"); reachable = null; await assert.rejects(deletion, /Рабочий стол недоступен/);
  const held = defer(), entered = defer(); let rejectedPersisted;
  const failureQueue = context.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true, writePrimaryRecord: async snapshot => { entered.resolve(); await held.promise; rejectedPersisted = json(snapshot); return {}; } });
  const rejected = api.createContactsController({ getWorkspace: () => workspace, createId, persistTransaction: action => failureQueue.transaction(action), saveSnapshot: (write, contacts) => { const snapshot = json(state); snapshot.desktops[0].data.contacts = contacts; return write(snapshot); } });
  const previous = JSON.stringify(workspace.contacts), result = rejected.removeProject("p1").catch(error => error); await entered.promise;
  const unrelated = failureQueue.queue(); held.reject(new Error("synthetic staged failure")); assert.match((await result).message, /synthetic staged failure/); await assert.rejects(unrelated, /synthetic staged failure/);
  assert.equal(JSON.stringify(workspace.contacts), previous); assert.equal(rejectedPersisted, undefined);
}
async function main() {
  validationAndSearch(); await crudAndRepeatedFields(); await rejectionThenRetry(); await stagedPrimaryQueue();
  console.log("contacts smoke: ok (validation, project/category boundaries, search, repeatable fields, exact round-trip, preservation, rejected save/retry, staged primary queue, desktop isolation)");
}
const watchdog = setTimeout(() => { console.error("contacts smoke: FAIL (fixture did not complete within 5 seconds)"); process.exitCode = 1; }, 5000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
