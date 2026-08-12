"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const context = vm.createContext({
  window: { ZETER_OS_CONFIG: { BACKUP_IMPORT_MAX_ZIP_ENTRIES: 200, ALLOWED_IMAGE_MIME_TYPES: ["image/png"], TRASH_ROOT: "trash" } },
  console,
  Blob,
  Uint8Array,
  Uint32Array,
  ArrayBuffer,
  DataView,
  TextEncoder,
  TextDecoder,
  Date,
  JSON,
  Math,
  Map,
  Set,
  Promise,
  crypto: webcrypto,
  atob,
  btoa,
  globalThis: null
});
context.globalThis = context;

function load(relativePath) {
  vm.runInContext(fs.readFileSync(relativePath, "utf8"), context, { filename: relativePath });
}

load("app/js/core/asset-utils.js");
load("app/js/core/security-protection-utils.js");
context.window.ZETER_CORE_UTILS = Object.freeze({
  pad: value => String(value).padStart(2, "0"),
  isSafeId: value => /^[A-Za-z0-9_-]{1,220}$/.test(String(value || "")),
  escapeHtml: value => String(value ?? "")
});
load("app/js/core/security-utils.js");
load("app/js/core/security-ui-utils.js");

async function main() {
  const protection = context.window.ZETER_SECURITY_PROTECTION_UTILS;
  const security = context.window.ZETER_SECURITY_UTILS;
  const securityUi = context.window.ZETER_SECURITY_UI_UTILS;
  const assets = context.window.ZETER_ASSET_UTILS;
  assert.equal(protection.normalizeProtectionPolicy({ profile: "enhanced" }).autoRestoreHours, 6);
  assert.equal(protection.normalizeProtectionPolicy({ profile: "unknown" }).profile, "standard");
  const migratedSuccess = security.normalizeSecurityMeta({ lastIntegrityCheckAt: 1, lastIntegrityStatus: "Проверка завершена. Ошибок не найдено." });
  assert.equal(migratedSuccess.lastIntegrityOutcome, "ok");
  assert.equal(security.securityStatusLabel({ meta: migratedSuccess, risk: { tone: "ok" }, lastIntegrityStatus: migratedSuccess.lastIntegrityStatus }).tone, "ok");
  assert.equal(security.securityStatusLabel({ meta: security.normalizeSecurityMeta({}), risk: { tone: "ok" } }).tone, "warn");

  const securityShell = securityUi.securityCenterShellHTML(true);
  assert.doesNotMatch(securityShell, /Корзин/, "Security Center must not present a current Trash feature");
  assert.match(securityShell, /Следы удаления из старых версий/, "Security Center must label legacy deletion records explicitly");
  [
    "app/js/core/security-ui-utils.js",
    "app/js/core/security-utils.js",
    "app/js/core/export-utils.js",
    "app/js/core/fs-item-utils.js",
    "app/js/core/item-properties-ui-utils.js",
    "app/js/core/readable-export-utils.js",
    "app/js/core/trash-utils.js"
  ].forEach(file => {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Корзин/, `${file} must not expose a current Trash label`);
  });
  const legacyDeletionProblems = security.validateSecurityFileSystem({
    legacy: { id: "legacy", name: "Старая запись", parent: "trash", deletedAt: 1 }
  }, { desktopRoots: ["desktop"] }, []);
  const legacyOriginProblem = legacyDeletionProblems.find(problem => problem.code === "trash-missing-origin");
  assert.ok(legacyOriginProblem, "legacy trash-shaped state must still be checked");
  assert.match(legacyOriginProblem.message, /старой удалённой записи/);
  assert.doesNotMatch(legacyOriginProblem.message, /Корзин/);

  const meta = { journal: [] };
  protection.recordSecurityEvent(meta, { title: "Проверка", tone: "ok" }, () => 42);
  assert.equal(meta.journal[0].at, 42);

  const state = { settings: {}, fs: { note: { id: "note", type: "note" } }, desktops: [], tasks: [], events: [] };
  const payload = { app: "ZeTer OS", version: "3.55", state };
  const entries = [
    { path: "zeter-os-state.json", blob: new Blob([JSON.stringify(payload)]) },
    { path: "zeter-os-data/readme.txt", blob: new Blob(["ok"]) }
  ];
  const manifest = await protection.createBackupManifest(entries, { osVersion: "3.55", stateSummary: protection.stateSummary(state) }, { crypto: webcrypto });
  entries.push({ path: "zeter-backup-manifest.json", blob: new Blob([JSON.stringify(manifest)]) });
  const zip = await assets.createZipBlob(entries);
  const verification = await protection.verifyBackupBlob(zip, { crypto: webcrypto });
  assert.equal(verification.verified, true);
  assert.equal(verification.summary.files, 1);

  const encrypted = await protection.encryptBackupBlob(zip, "надёжный пароль", { originalName: "backup.zip", iterations: 10000, crypto: webcrypto });
  const decrypted = await protection.decryptBackupBlob(encrypted, "надёжный пароль", { crypto: webcrypto });
  const decryptedVerification = await protection.verifyBackupBlob(decrypted.blob, { crypto: webcrypto });
  assert.equal(decrypted.header.originalName, "backup.zip");
  assert.equal(decryptedVerification.verified, true);
  await assert.rejects(() => protection.decryptBackupBlob(encrypted, "неверный пароль", { crypto: webcrypto }), /Проверь парольную фразу/);

  const missingPayload = {
    ready: false,
    missingManagedFiles: ["Файлы ZeTer OS/Работа/документ.bin"],
    missingItemAssets: ["Оформление объектов/Папки/folder-1/фон.png"],
    invalidManagedPaths: [],
    invalidItemAssetPaths: []
  };
  const preflightText = securityUi.restorePayloadPreflightMessage(missingPayload);
  assert.match(preflightText, /Файлы ZeTer OS\/Работа\/документ\.bin/);
  assert.match(preflightText, /Оформление объектов\/Папки\/folder-1\/фон\.png/);
  assert.match(preflightText, /проверенного ZIP-бэкапа/);

  const calls = { preflight: [], imported: 0, replaced: 0, toasts: [], confirms: [] };
  const controller = securityUi.createSecurityRuntimeController({
    getState: () => ({}),
    shouldUseNativeStorage: () => true,
    loadNativeRestorePoints: async () => ({
      points: [{ id: "restore-1", name: "До удаления", createdAt: 1, state: { fs: {} } }]
    }),
    preflightNativeRestorePoint: async pointId => {
      calls.preflight.push(pointId);
      return missingPayload;
    },
    cloneForBackup: value => JSON.parse(JSON.stringify(value)),
    validateImportedState: value => value,
    replaceStateFromRestore: () => { calls.replaced += 1; },
    openImport: () => { calls.imported += 1; },
    toast: (title, detail) => calls.toasts.push({ title, detail }),
    confirmUser: message => {
      calls.confirms.push(message);
      return true;
    },
    clearNativeState: async () => {
      throw new Error("native clear failed");
    },
    documentRef: {},
    localStorageRef: { removeItem() {} },
    navigatorRef: {},
    consoleRef: console
  });
  assert.equal(await controller.restorePointById("restore-1"), false);
  assert.deepEqual(calls.preflight, ["restore-1"]);
  assert.equal(calls.replaced, 0);
  assert.equal(calls.imported, 1);
  assert.equal(calls.toasts[0].title, "Точка не применена");
  assert.match(calls.confirms[0], /Открыть импорт проверенного ZIP-бэкапа/);
  await assert.rejects(() => controller.resetPrimaryStateStorage(), /native clear failed/);

  const originalState = {
    settings: { marker: "original" },
    security: { journal: [] },
    fs: {},
    desktops: [],
    tasks: [],
    events: []
  };
  const restoredState = {
    settings: { marker: "restore-point" },
    security: { journal: [] },
    fs: {},
    desktops: [],
    tasks: [],
    events: []
  };
  let activeState = JSON.parse(JSON.stringify(originalState));
  let saveCalls = 0;
  let reloadCalls = 0;
  const rollbackToasts = [];
  const replacements = [];
  const rollbackController = securityUi.createSecurityRuntimeController({
    getState: () => activeState,
    shouldUseNativeStorage: () => true,
    loadNativeRestorePoints: async () => ({
      points: [{ id: "restore-save-failure", name: "Проверка отката", createdAt: 2, state: restoredState }]
    }),
    preflightNativeRestorePoint: async () => ({ ready: true }),
    saveNativeRestorePoint: async () => ({ ok: true }),
    cloneForBackup: value => JSON.parse(JSON.stringify(value)),
    validateImportedState: value => value,
    replaceStateFromRestore: value => {
      activeState = JSON.parse(JSON.stringify(value));
      replacements.push(activeState.settings?.marker || "");
    },
    saveState: async () => {
      saveCalls++;
      if (saveCalls === 3) throw new Error("disk full");
      return { saved: true, fallback: false };
    },
    toast: (title, detail) => rollbackToasts.push({ title, detail }),
    confirmUser: () => true,
    reload: () => { reloadCalls++; },
    schedule: callback => callback(),
    uid: prefix => `${prefix}-safety`,
    now: () => 10,
    documentRef: {},
    navigatorRef: {},
    consoleRef: { error() {} }
  });
  assert.equal(await rollbackController.restorePointById("restore-save-failure"), false);
  assert.equal(activeState.settings.marker, "original");
  assert.deepEqual(replacements, ["restore-point", "original"]);
  assert.equal(reloadCalls, 0);
  assert.equal(rollbackToasts.at(-1).title, "Не удалось восстановить");
  assert.match(rollbackToasts.at(-1).detail, /Предыдущее состояние оставлено активным/);

  console.log("security manifest, verification, encryption and restore preflight smoke: ok");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
