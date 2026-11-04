"use strict";
// Hermetic VM / in-memory ZIP. No startup, native API, network or real data.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const plain = value => JSON.parse(JSON.stringify(value));
const box = { console, Blob, URL, TextDecoder, TextEncoder, atob, btoa, Uint8Array, structuredClone, crypto: require("node:crypto").webcrypto, setTimeout, clearTimeout,
  document: { createElement: () => ({ getContext: () => null, querySelector: () => null, querySelectorAll: () => [] }), querySelector: () => null, querySelectorAll: () => [] } };
box.window = box; vm.createContext(box);
for (const file of ["version.js", "config.js", "utils.js", "system-settings-utils.js", "shortcut-utils.js", "link-library-utils.js", "prompt-library-utils.js", "contacts-utils.js", "expenses-utils.js", "business-calculations-utils.js", "time-tracking-utils.js", "pinning-utils.js", "deletion-utils.js", "asset-utils.js", "security-protection-utils.js", "visual-utils.js", "item-customization-utils.js", "data-normalizers.js", "window-session-utils.js", "automation-utils.js", "object-link-utils.js", "workspace-utils.js", "storage-utils.js", "import-utils.js", "export-utils.js", "rich-text-utils.js", "state-import-validator.js", "security-restore-utils.js", "cloud-payload-utils.js", "google-drive-sync-utils.js"]) {
  const filename = path.join(__dirname, "../app/js/core", file); vm.runInContext(fs.readFileSync(filename, "utf8"), box, { filename });
}
async function main() {
  const api = box.ZETER_EXPENSES_UTILS, work = box.ZETER_WORKSPACE_UTILS;
  const fixture = () => ({ fs: {}, settings: {}, currentDesktop: "second", desktops: [{ id: "desktop", name: "Основной", data: work.workspaceDefaults() }, { id: "second", name: "Второй", data: work.workspaceDefaults() }] });
  const state = fixture(), workspace = state.desktops[1].data;
  work.syncLegacyWorkspaceAliases(state);
  const sentinel = JSON.stringify(state.desktops[0]);
  const queue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => state, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
  let id = 0;
  const controller = api.createExpensesController({ getWorkspace: () => workspace, createId: prefix => `${prefix}_${++id}`, persistTransaction: operation => queue.transaction(operation),
    saveSnapshot: (write, expenses) => { const snapshot = plain(state); snapshot.desktops[1].data.expenses = expenses; return write(snapshot); } });
  const categoryId = workspace.expenses.categories.find(item => item.kind === "expense").id;
  const entry = await controller.saveEntry({ amount: "25,37", kind: "expense", currency: "BYN", categoryId, date: "2026-10-31", title: "=1+1", paymentMethod: "Карта", projectId: "", notes: "Кавычки \" и\nперенос" });
  await controller.saveEntry({ amount: "5", kind: "refund", originalEntryId: entry.id, date: "2026-11-01", paymentMethod: "Карта", title: "Частичный возврат" });
  await controller.saveEntry({ amount: "100", kind: "income", currency: "BYN", categoryId: workspace.expenses.categories.find(item => item.kind === "income").id, date: "2026-10-31", projectId: "", title: "Оплата", paymentMethod: "Наличные" });
  await controller.setBudget({ month: "2026-10", currency: "BYN", categoryId, amount: "200" });
  const expenses = plain(workspace.expenses);
  assert.equal(JSON.stringify(state.desktops[0]), sentinel);
  const validate = box.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport;
  validate(state);
  const bad = plain(state); bad.desktops[1].data.expenses.entries[0].amountMinor = 0.1;
  assert.throws(() => validate(bad), /сумм/i);
  const badMonth = plain(state); badMonth.desktops[1].data.expenses.budgets[0].month = ["2026-10"];
  assert.throws(() => validate(badMonth), /месяц/i);
  const old = fixture(); delete old.desktops[1].data.expenses; work.normalizeWorkspaceData(old.desktops[1].data); api.validateExpenses(old.desktops[1].data.expenses);
  assert.equal(old.desktops[1].data.expenses.entries.length, 0);
  let zipEntries;
  const zip = await box.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(state, { createZipBlob: async entries => { zipEntries = entries; return box.ZETER_ASSET_UTILS.createZipBlob(entries); } });
  assert.equal(zip.zeterVerification.verified, true);
  const payload = JSON.parse(await zipEntries.find(item => item.path === "zeter-os-state.json").blob.text());
  assert.deepEqual(payload.state.desktops[1].data.expenses, expenses); validate(payload.state);
  assert.deepEqual(plain(work.desktopBackupSnapshot(state, "second").desktop.data.expenses), expenses);
  const recovery = box.ZETER_SECURITY_RESTORE_UTILS, key = recovery.listRestoreChoices(state).find(row => row.kind === "desktop" && row.desktopId === "second").key;
  const plan = recovery.prepareSelectiveRestore(fixture(), state, { key, mode: "copy", createId: prefix => `recovered_${prefix}_${++id}` });
  const restored = plan.state.desktops.find(row => !["desktop", "second"].includes(row.id)).data.expenses;
  api.validateExpenses(restored);
  assert.equal(restored.entries.find(row => row.kind === "refund").originalEntryId, restored.entries.find(row => row.kind === "expense").id);
  assert.equal(restored.budgets[0].categoryId, restored.entries[0].categoryId);
  assert.notEqual(restored.categories[0].id, expenses.categories[0].id);
  const historical = plain(state); historical.desktops[1].data.expenses.entries.filter(row => row.kind !== "income").forEach(row => { row.projectId = "deleted_project"; row.projectName = "Прежний проект"; });
  const historyPlan = recovery.prepareSelectiveRestore(fixture(), historical, { key, mode: "copy", createId: prefix => `history_${prefix}_${++id}` });
  const historyExpenses = historyPlan.state.desktops.find(row => !["desktop", "second"].includes(row.id)).data.expenses;
  api.validateExpenses(historyExpenses);
  assert.equal(historyExpenses.entries[0].projectName, "Прежний проект");
  for (const selected of [[], ["expenses"]]) {
    const target = plain(state), mainBefore = JSON.stringify(target.desktops[0]);
    const saveQueue = box.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => target, nativeStorage: true, writePrimaryRecord: async () => ({ updatedAt: 1 }) });
    const desktopController = work.createVirtualDesktopController({ getState: () => target, requestDeletion: (model, execute) => { assert.ok(model.groups.some(row => row.id === "expenses" && row.count > 0)); return execute(selected); }, persistTransaction: operation => saveQueue.transaction(operation), saveState: () => saveQueue.queue() });
    await desktopController.remove("second");
    assert.equal(JSON.stringify(target.desktops[0]), mainBefore);
    if (selected.length) assert.equal(target.archivedDesktops[0]?.desktop.data.expenses, undefined);
    else {
      assert.deepEqual(plain(target.archivedDesktops[0].desktop.data.expenses), expenses); validate(target);
      const broken = plain(target); broken.archivedDesktops[0].desktop.data.expenses.budgets[0].categoryId = "missing";
      assert.throws(() => validate(broken), /категори/i);
    }
  }
  console.log("expenses integration smoke: ok (legacy defaults, ACK queue, desktop isolation, strict import, ZIP, recovery category/refund/history remap, archive/selective deletion)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
