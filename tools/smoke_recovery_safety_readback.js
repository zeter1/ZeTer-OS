"use strict";
// Isolated native safety readback regression: no app launch, credentials or user data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const clone = value => JSON.parse(JSON.stringify(value));
const state = { security: {}, desktops: [{ id: "desktop", data: {
  externalSaveStatus: "machine-specific absolute path"
} }] };
const ctx = { document: {}, console, window: {
  ZETER_CORE_UTILS: { escapeHtml: String },
  ZETER_SECURITY_UTILS: {
    normalizeSecurityMeta: value => value || {},
    collectExternalSaveSnapshotModel: () => ({}),
    collectSecuritySnapshotModel: () => ({}),
    runSecurityIntegrityModel: () => ({}),
    repairSafeSecurityState: () => ({})
  },
  ZETER_SECURITY_PROTECTION_UTILS: {
    normalizeProtectionPolicy: () => ({ restoreLimit: 8 }),
    protectionProfile: () => ({}),
    recordSecurityEvent: () => ({}),
    stateSummary: () => ({}),
    compareStateSummaries: () => true,
    encryptedBackupSupported: () => false,
    describeRestorePoint: value => value
  }
} };
vm.createContext(ctx);
const modulePath = path.join(__dirname, "../app/js/core/security-ui-utils.js");
vm.runInContext(fs.readFileSync(modulePath, "utf8"), ctx, { filename: modulePath });
const factory = ctx.window.ZETER_SECURITY_UI_UTILS.createSecurityRuntimeController;
let stored = [], receiptVerified = true, seq = 0, corruptRead = false;
const api = factory({
  getState: () => state,
  shouldUseNativeStorage: () => true,
  restoreLimit: 8,
  uid: () => "restore-synthetic-" + ++seq,
  cloneForBackup: clone,
  saveNativeRestorePoint: async point => {
    const storedPoint = clone(point);
    storedPoint.state.desktops[0].data.externalSaveStatus = "portable path";
    stored.push(storedPoint);
    return { stateVerified: receiptVerified };
  },
  loadNativeRestorePoints: async () => ({
    points: corruptRead ? [] : clone(stored)
  }),
  deleteNativeRestorePoint: async id => { stored = stored.filter(p => p.id !== id); }
});
(async () => {
  const original = clone(state);
  const point = await api.createRecoverySafetyPoint(state);
  assert.equal(point.state.desktops[0].data.externalSaveStatus, "machine-specific absolute path");
  assert.equal(stored[0].state.desktops[0].data.externalSaveStatus, "portable path");
  assert.deepEqual(state, original);
  receiptVerified = false;
  await assert.rejects(api.createRecoverySafetyPoint(state), /контрольное чтение/);
  receiptVerified = true;
  corruptRead = true;
  await assert.rejects(api.createRecoverySafetyPoint(state), /контрольное чтение/);
  console.log("SECURITY_SAFETY_READBACK_PASS: canonical native receipt accepted, missing receipt and readback rejected");
})().catch(error => { console.error(error); process.exitCode = 1; });
