"use strict";
// Pure VM fixtures: no browser profile, native API or user state is opened.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const sandbox = { console, URL, structuredClone, Blob, TextEncoder, TextDecoder, crypto: require("node:crypto").webcrypto, Uint8Array, atob, btoa }; sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/time-tracking-utils.js"), "utf8"), sandbox);
const model = sandbox.ZETER_TIME_TRACKING_UTILS;
for (const name of ["utils.js", "config.js", "shortcut-utils.js", "link-library-utils.js", "prompt-library-utils.js", "business-calculations-utils.js", "storage-utils.js", "asset-utils.js", "security-protection-utils.js", "import-utils.js", "export-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name), "utf8"), sandbox);
}
sandbox.ZETER_DATA_NORMALIZERS = { TASK_TITLE_MAX_CHARS: 500, TASK_TAG_MAX_CHARS: 160, TASK_CHECKLIST_TEXT_MAX_CHARS: 500 };
sandbox.ZETER_RICH_TEXT_UTILS = { cleanRichHtml: value => value };
sandbox.ZETER_ITEM_CUSTOMIZATION_UTILS = { isItemAssetPath: () => false };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/state-import-validator.js"), "utf8"), sandbox);
async function main() {
  let now = new Date(2026, 9, 15, 10).getTime(), serial = 0, fail = false, release;
  const workspace = { tasks: [{ id: "task1", title: "Сайт", projectId: "project1" }], taskProjects: [{ id: "project1", name: "Работа" }] };
  const options = { getWorkspace: () => workspace, createId: () => `session${++serial}`, now: () => now, runtimeId: "boot1",
    persistTransaction: operation => operation(async candidate => { if (fail) return { saved: false }; if (release) await new Promise(resolve => { release.resolve = resolve; }); return { saved: true }; }),
    saveSnapshot: (write, candidate) => write(candidate) };
  const first = model.createTimeTrackingController(options), second = model.createTimeTrackingController(options);
  assert.equal(first.read().entries.length, 0);
  fail = true; await assert.rejects(first.start({ title: "Черновик" }), /сохран/i); assert.equal(first.read().active, null);
  fail = false; release = {}; const pending = first.start({ taskId: "task1" });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(first.read().active, null, "candidate stays private before acknowledgement");
  release.resolve(); release = null; await pending;
  assert.equal(first.read().active.title, "Сайт"); assert.equal(first.read().active.projectName, "Работа");
  await assert.rejects(second.start({ title: "Другая" }), /сесси/i);
  now += 60000; await first.pause(); now += 300000; assert.equal(model.sessionDuration(first.read().active, now), 60000);
  await second.resume(); now += 120000; fail = true;
  await assert.rejects(first.finish(), /сохран/i); assert.ok(first.read().active); assert.equal(first.read().entries.length, 0);
  fail = false; await first.finish(); assert.equal(first.read().active, null); assert.equal(model.sessionDuration(first.read().entries[0], now), 180000);
  const reloadWorkspace = JSON.parse(JSON.stringify(workspace));
  assert.equal(model.sessionDuration(reloadWorkspace.timeTracking.entries[0], now), 180000);
  workspace.tasks = []; workspace.taskProjects = [];
  assert.equal(first.read().entries[0].projectName, "Работа", "deleted task/project must not erase history");
  await assert.rejects(first.start({ taskId: "task1" }), /задач/i);
  await first.start({ title: "Свободное занятие" }); now += 120000;
  const restarted = model.createTimeTrackingController({ ...options, runtimeId: "boot2" });
  assert.equal(restarted.needsRecovery(), true);
  await assert.rejects(restarted.pause(), /уточн/i);
  await assert.rejects(restarted.recover(now + 1), /окончан/i);
  await restarted.recover(now - 60000); assert.equal(model.sessionDuration(first.read().entries.at(-1), now), 60000);
  const entry = first.read().entries[0]; await first.edit(entry.id, { title: "Исправлено", startedAt: now - 300000, durationMs: 240000, allowOverlap: true });
  assert.equal(model.sessionDuration(first.read().entries[0], now), 240000);
  const untouched = JSON.stringify(first.read()); fail = true;
  await assert.rejects(first.edit(entry.id, { title: "Не записано", startedAt: now - 300000, durationMs: 1 }), /сохран/i);
  assert.equal(JSON.stringify(first.read()), untouched); fail = false;
  const midnight = new Date(2026, 9, 15).getTime();
  const crossing = { segments: [{ start: midnight - 3600000, end: midnight + 7200000 }], runningSince: null };
  assert.equal(model.timeInRange(crossing, midnight - 86400000, midnight), 3600000);
  assert.equal(model.timeInRange(crossing, midnight, midnight + 86400000), 7200000);
  assert.equal(model.localRanges(new Date(2026, 9, 18, 12).getTime()).weekStart, new Date(2026, 9, 12).getTime());
  const valid = JSON.parse(JSON.stringify(first.read())); model.validateTimeTracking(valid);
  assert.throws(() => model.validateTimeTracking({ ...valid, entries: [valid.entries[0], valid.entries[0]] }), /ID/i);
  const broken = JSON.parse(JSON.stringify(valid)); broken.entries[0].segments[0].end = -1;
  assert.throws(() => model.validateTimeTracking(broken), /интервал/i);
  assert.throws(() => model.validateTimeTracking({ entries: [], active: { id: "bad" } }), /времени/i);
  assert.throws(() => model.validateTimeTracking({ entries: [], active: undefined }), /времени/i);
  assert.equal(model.normalizeTimeTracking().active, null);
  // Separate workspaces own independent timers and journals.
  const other = { timeTracking: model.normalizeTimeTracking() };
  const isolated = model.createTimeTrackingController({ ...options, getWorkspace: () => other });
  await isolated.start({ title: "Другой стол" }); assert.equal(first.read().active, null);
  await first.removeEntry(entry.id); await first.setDailyGoal(60);
  const incoming = { fs: {}, settings: {}, currentDesktop: "desktop", desktops: [{ id: "desktop", name: "Основной", data: { timeTracking: first.read() } }, { id: "second", name: "Второй", data: { timeTracking: isolated.read() } }] };
  const validator = sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport;
  validator(incoming);
  const corrupt = JSON.parse(JSON.stringify(incoming)); corrupt.desktops[1].data.timeTracking.active.segments = [{ start: 5, end: 1 }];
  assert.throws(() => validator(corrupt), /интервал/i);
  const archive = { fs: {}, settings: {}, archivedDesktops: [{ id: "archive1", archivedAt: new Date(now).toISOString(), desktop: corrupt.desktops[1], fs: {} }] };
  assert.throws(() => validator(archive), /интервал/i);
  let zipEntries;
  const zip = await sandbox.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(incoming, { createZipBlob: async entries => { zipEntries = entries; return sandbox.ZETER_ASSET_UTILS.createZipBlob(entries); } });
  assert.equal(zip.zeterVerification.verified, true);
  const restored = JSON.parse(await zipEntries.find(item => item.path === "zeter-os-state.json").blob.text()).state;
  assert.deepEqual(restored.desktops, JSON.parse(JSON.stringify(incoming.desktops))); validator(restored);
  assert.equal(restored.desktops[0].data.timeTracking.dailyGoalMinutes, 60);
  assert.ok(restored.desktops[0].data.timeTracking.entries.some(item => item.deletedAt != null));
  console.log("Time tracking smoke: lifecycle, failure/retry, staged save, reload/recovery, isolation, midnight/week and validation PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
