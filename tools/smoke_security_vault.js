"use strict";

// Entire fixture is in memory: no browser profile, OS data, picker or filesystem writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

class MemoryDirectory {
  constructor(name, faults = {}, log = []) {
    this.kind = "directory";
    this.name = name;
    this.items = new Map();
    this.faults = faults;
    this.log = log;
  }
  async getDirectoryHandle(name, options = {}) {
    const item = this.items.get(name);
    if (item) {
      if (item.kind !== "directory") throw new Error("TypeMismatchError");
      return item;
    }
    if (!options.create) throw Object.assign(new Error("Not found"), { name: "NotFoundError" });
    const directory = new MemoryDirectory(name, this.faults, this.log);
    this.items.set(name, directory);
    return directory;
  }
  async getFileHandle(name, options = {}) {
    if (this.items.has(name)) return this.items.get(name);
    if (!options.create) throw Object.assign(new Error("Not found"), { name: "NotFoundError" });
    const file = {
      kind: "file", name, blob: new Blob([]),
      getFile: async () => file.blob,
      createWritable: async () => {
        let staged;
        return {
          write: async value => {
            if (name.endsWith(".zip") && this.faults.failBackupWrite) {
              this.faults.failBackupWrite = false;
              throw new Error("Injected backup write failure");
            }
            staged = value instanceof Blob ? value : new Blob([value]);
          },
          abort: async () => { this.log.push(`abort:${name}`); },
          close: async () => {
            if (name === "index.json" && this.faults.failPublicationCloses) {
              const next = JSON.parse(await staged.text());
              const current = JSON.parse(await file.blob.text());
              if (current.pending && !next.pending) {
                this.faults.failPublicationCloses--;
                throw new Error("Injected publication close failure");
              }
            }
            if (name === "index.json" && this.faults.failIndexClose) {
              this.faults.failIndexClose = false;
              throw new Error("Injected index close failure");
            }
            if (name.endsWith(".zip") && this.faults.corruptBackupClose) {
              this.faults.corruptBackupClose = false;
              staged = new Blob(["corrupt"]);
            }
            file.blob = staged;
            this.log.push(`commit:${name}`);
          }
        };
      }
    };
    file.isSameEntry = async other => file === other;
    this.items.set(name, file);
    return file;
  }
  async removeEntry(name) {
    this.log.push(`remove:${name}`);
    if (this.faults.failRemove) throw new Error("Injected locked file");
    this.items.delete(name);
  }
  async *entries() { yield* this.items.entries(); }
}

function makeLockManager() {
  let queue = Promise.resolve();
  return { request: (_name, _options, callback) => {
    const result = queue.then(callback);
    queue = result.catch(() => {});
    return result;
  } };
}

function runtime(withLocks = true, crypto = webcrypto) {
  const context = vm.createContext({
    window: { ZETER_OS_CONFIG: { BACKUP_IMPORT_MAX_ZIP_ENTRIES: 200, ALLOWED_IMAGE_MIME_TYPES: ["image/png"] } },
    navigator: withLocks ? { locks: makeLockManager() } : {},
    console, Blob, Uint8Array, Uint32Array, ArrayBuffer, DataView, TextEncoder, TextDecoder,
    Date, JSON, Math, Map, Set, Promise, crypto, atob, btoa
  });
  for (const name of ["asset-utils", "security-protection-utils", "security-vault-utils"]) {
    const path = `app/js/core/${name}.js`;
    vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  }
  return context;
}

async function main() {
  const context = runtime();
  const assets = context.window.ZETER_ASSET_UTILS;
  const protection = context.window.ZETER_SECURITY_PROTECTION_UTILS;
  const entries = [{ path: "zeter-os-state.json", blob: new Blob([JSON.stringify({ state: { fs: {}, settings: {} } })]) }];
  const manifest = await protection.createBackupManifest(entries, {}, { crypto: webcrypto });
  const zip = await assets.createZipBlob([...entries, { path: "zeter-backup-manifest.json", blob: new Blob([JSON.stringify(manifest)]) }]);
  assert.equal((await protection.verifyBackupBlob(zip, { crypto: webcrypto })).verified, true);
  const faults = {}, log = [], root = new MemoryDirectory("Тестовая папка", faults, log);
  let selected = root, chooseResult = root, clock = 1700000000000;
  const make = (options = {}, ctx = context) => ctx.window.ZETER_SECURITY_VAULT_UTILS.createBrowserBackupVault({
    getHandle: async () => selected,
    chooseFolder: async () => chooseResult,
    verifyPermission: async () => true,
    buildBackup: async () => zip,
    now: () => clock++,
    ...options
  });
  const vault = make();
  assert.equal((await vault.status()).configured, false);
  const configured = await vault.configure({ chooseFolder: true, enabled: true, maxCopies: 2 });
  assert.equal(configured.configured, true);
  assert.equal(configured.intervalHours, 24);
  assert.equal(configured.maxBytes, 2 * 1024 ** 3);
  assert.equal(configured.locationKind, "unknown");
  const first = await vault.create();
  assert.equal(first.entry.verified, true);
  assert.equal(first.entries.length, 1);
  const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", await zip.arrayBuffer())).toString("hex");
  assert.equal(first.entry.sha256, digest);
  const read = await vault.read({ id: first.entry.id });
  assert.equal(read.name, first.entry.name);
  assert.deepEqual(Buffer.from(await read.blob.arrayBuffer()), Buffer.from(await zip.arrayBuffer()));
  await assert.rejects(() => vault.read({ id: "../index.json" }), /не найден|неверн|недопустим/i);
  await assert.rejects(() => vault.configure({ maxCopies: 0 }), /колич|копи|предел/i);
  await vault.pin({ id: first.entry.id, pinned: true });
  await vault.create();
  const third = await vault.create();
  assert.equal(third.entries.length, 2);
  assert.equal(third.entries.find(item => item.id === first.entry.id).pinned, true);
  const namespace = root.items.get("zeter-security-backups");
  assert.ok(namespace);
  const removal = log.findIndex(line => line.startsWith("remove:"));
  assert.ok(log.slice(0, removal).filter(line => line === "commit:index.json").length >= 5, "index ACK must precede retention deletion");
  const foreign = await namespace.getFileHandle("manual-user.zip", { create: true });
  foreign.blob = new Blob(["user-owned"]);
  const outside = await root.getFileHandle("zeter-backup-user.zip", { create: true });
  outside.blob = new Blob(["outside namespace"]);
  await vault.create();
  assert.equal(await foreign.blob.text(), "user-owned");
  assert.ok(namespace.items.has("manual-user.zip"));
  assert.ok(root.items.has("zeter-backup-user.zip"));

  // A valid candidate that cannot ACK its index must not trigger pruning or replace prior settings.
  const beforeFailure = await vault.status();
  const removalsBefore = log.filter(line => line.startsWith("remove:")).length;
  faults.failIndexClose = true;
  await assert.rejects(() => vault.create(), /index close failure/);
  assert.equal(log.filter(line => line.startsWith("remove:")).length, removalsBefore);
  assert.deepEqual((await vault.status()).entries.map(item => item.id), beforeFailure.entries.map(item => item.id));
  faults.failIndexClose = true;
  await assert.rejects(() => vault.configure({ maxCopies: 8, enabled: false }), /index close failure/);
  assert.equal((await vault.status()).maxCopies, 2);
  assert.equal((await vault.status()).enabled, true);
  faults.corruptBackupClose = true;
  await assert.rejects(() => vault.create(), /сумм|провер|поврежд|размер/i);
  assert.deepEqual((await vault.status()).entries.map(item => item.id), beforeFailure.entries.map(item => item.id));
  const retry = await vault.create();
  assert.ok(retry.entries.some(item => item.id === retry.entry.id));

  // Cancel and a foreign selected namespace both preserve the accepted runtime folder/settings.
  chooseResult = null;
  assert.equal((await vault.configure({ chooseFolder: true, enabled: false })).cancelled, true);
  assert.equal((await vault.status()).enabled, true);
  const foreignRoot = new MemoryDirectory("Чужая папка");
  const foreignNamespace = await foreignRoot.getDirectoryHandle("zeter-security-backups", { create: true });
  const foreignIndex = await foreignNamespace.getFileHandle("index.json", { create: true });
  foreignIndex.blob = new Blob(['{"format":"foreign"}']);
  chooseResult = selected = foreignRoot;
  await assert.rejects(() => vault.configure({ chooseFolder: true, enabled: false }), /принадлеж|чуж|владел|маркер/i);
  assert.equal((await vault.status()).folder, "Тестовая папка");
  assert.equal((await vault.status()).enabled, true);
  assert.equal(await foreignIndex.blob.text(), '{"format":"foreign"}');
  selected = root;

  // A damaged old candidate is preserved and cannot be used as a retention victim.
  await vault.pin({ id: first.entry.id, pinned: false });
  namespace.items.get(first.entry.name).blob = new Blob(["externally changed"]);
  const damaged = await vault.create();
  assert.ok(namespace.items.has(first.entry.name));
  assert.equal(damaged.entries.find(item => item.id === first.entry.id).verified, false);
  assert.ok(damaged.maintenanceWarning);
  await assert.rejects(() => vault.read({ id: first.entry.id }), /сумм|провер|поврежд|размер/i);
  faults.failRemove = true;
  const locked = await vault.create();
  assert.ok(locked.entry.verified);
  assert.ok(locked.maintenanceWarning);
  faults.failRemove = false;
  await vault.configure({ maxBytes: 1, maxCopies: 1 });
  const filesBeforeQuota = namespace.items.size;
  await assert.rejects(() => vault.create(), /превышает лимит/);
  assert.equal(namespace.items.size, filesBeforeQuota, "an exhausted quota cannot grow the directory on repeated attempts");
  assert.ok(namespace.items.has(locked.entry.name), "last valid copy survives impossible quota");
  await vault.configure({ enabled: false });
  const countDisabled = (await vault.status()).entries.length;
  await vault.create();
  assert.equal((await vault.status()).entries.length, countDisabled + 1);

  // Independent controllers reload under the same cross-tab lock instead of overwriting the index.
  const concurrentRoot = new MemoryDirectory("Concurrent");
  const v1 = make({ getHandle: async () => concurrentRoot });
  const v2 = make({ getHandle: async () => concurrentRoot });
  await v1.configure({ enabled: false });
  await Promise.all([v1.create(), v2.create(), v1.create(), v2.create()]);
  assert.equal((await v1.status()).entries.length, 4);
  assert.equal(new Set((await v1.status()).entries.map(item => item.name)).size, 4);
  const noLocks = make({ getHandle: async () => concurrentRoot }, runtime(false));
  assert.equal((await noLocks.status()).configured, true);
  await assert.rejects(() => noLocks.create(), /браузер|блокиров|Locks/i);
  assert.equal((await v1.status()).entries.length, 4);
  const denied = make({ getHandle: async () => concurrentRoot, verifyPermission: async () => false });
  await assert.rejects(() => denied.create(), /доступ|разреш/i);
  const invalidZip = make({ getHandle: async () => concurrentRoot, buildBackup: async () => new Blob(["bad"]) });
  await assert.rejects(() => invalidZip.create());
  assert.equal((await v1.status()).entries.length, 4);

  // Equal wall-clock values must not make random IDs decide which copy is newest.
  let seed = 255;
  const equalTimeContext = runtime(true, { subtle: webcrypto.subtle, getRandomValues: bytes => bytes.fill(seed--) });
  const equalTimeRoot = new MemoryDirectory("Same timestamp");
  const equalTime = make({ getHandle: async () => equalTimeRoot, now: () => 1700000000000 }, equalTimeContext);
  await equalTime.configure({ enabled: true, maxCopies: 1 });
  const equalFirst = await equalTime.create();
  const equalSecond = await equalTime.create();
  assert.equal(equalSecond.entries.length, 1);
  assert.equal(equalSecond.entries[0].id, equalSecond.entry.id, "newest committed copy survives equal-time retention");
  assert.notEqual(equalSecond.entries[0].id, equalFirst.entry.id);

  // Publication failure must be durable: retries cannot allocate another orphan ZIP.
  const journalFaults = {}, journalLog = [], journalRoot = new MemoryDirectory("Publication journal", journalFaults, journalLog);
  const journalOptions = { getHandle: async () => journalRoot };
  let journalVault = make(journalOptions);
  await journalVault.configure({ enabled: true });
  await journalVault.create();
  const journalDirectory = journalRoot.items.get("zeter-security-backups");
  const physicalZips = () => [...journalDirectory.items.keys()].filter(name => name.endsWith(".zip")).length;
  const readJournal = async () => JSON.parse(await journalDirectory.items.get("index.json").blob.text());
  for (let attempt = 0; attempt < 3; attempt++) {
    journalFaults.failIndexClose = true;
    await assert.rejects(() => journalVault.create(), /index close failure/);
    assert.equal(physicalZips(), 1, "failed reservation creates no ZIP");
  }
  journalFaults.failPublicationCloses = 3;
  for (let attempt = 0; attempt < 3; attempt++) {
    journalVault = make(journalOptions); // restart loses all in-memory recovery state
    await assert.rejects(() => journalVault.create(), /publication close failure/);
    assert.equal(physicalZips(), 2, "all failed publications share one durable pending file");
    assert.equal((await readJournal()).entries.length, 1);
    assert.ok((await readJournal()).pending);
  }
  const pendingId = (await readJournal()).pending.id;
  const adopted = await make(journalOptions).create();
  assert.equal(adopted.entry.id, pendingId);
  assert.equal(adopted.recovered, true);
  assert.equal(physicalZips(), 2);
  assert.equal((await readJournal()).pending, null);
  assert.equal((await readJournal()).entries.length, 2);
  journalFaults.failBackupWrite = true;
  await assert.rejects(() => journalVault.create(), /backup write failure/);
  assert.equal(physicalZips(), 2, "known newly allocated empty partial is removed");
  assert.equal((await readJournal()).pending, null);
  journalFaults.corruptBackupClose = true;
  await assert.rejects(() => journalVault.create(), /сумм|размер|поврежд/i);
  assert.equal(physicalZips(), 2, "known corrupt generated candidate is removed");
  assert.equal((await readJournal()).pending, null);
  journalFaults.corruptBackupClose = journalFaults.failRemove = true;
  await assert.rejects(() => journalVault.create());
  const blockedId = (await readJournal()).pending.id;
  assert.equal(physicalZips(), 3);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(() => make(journalOptions).create(), /незаверш|восстанов|провер/i);
    assert.equal(physicalZips(), 3, "unconfirmed cleanup durably blocks further allocation");
    assert.equal((await readJournal()).pending.id, blockedId);
  }
  assert.equal((await readJournal()).entries.length, 2, "prior verified history survives blocked cleanup");
  console.log("security browser vault ownership/ACK/readback/retention/retry/cross-tab smoke PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
