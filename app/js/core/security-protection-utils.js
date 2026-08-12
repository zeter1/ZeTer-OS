(() => {
  "use strict";

  const assetUtils = window.ZETER_ASSET_UTILS;
  if (!assetUtils) throw new Error("ZeTer OS security protection utils require asset utils.");

  const JOURNAL_LIMIT = 120;
  const ENCRYPTED_MAGIC = "ZETERBAK1\n";
  const ENCRYPTED_FORMAT = "zeter-encrypted-backup";
  const MANIFEST_PATH = "zeter-backup-manifest.json";
  const STATE_PATH = "zeter-os-state.json";
  const DEFAULT_PBKDF2_ITERATIONS = 210000;
  const PROFILE_RULES = Object.freeze({
    standard: Object.freeze({ profile: "standard", label: "Стандартная", autoRestoreHours: 24, restoreLimit: 8, verifiedBackupMaxAgeDays: 7 }),
    enhanced: Object.freeze({ profile: "enhanced", label: "Усиленная", autoRestoreHours: 6, restoreLimit: 12, verifiedBackupMaxAgeDays: 2 }),
    manual: Object.freeze({ profile: "manual", label: "Ручная", autoRestoreHours: 0, restoreLimit: 5, verifiedBackupMaxAgeDays: 30 })
  });

  function clampInt(value, min, max, fallback) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }

  function normalizeProtectionPolicy(policy = {}) {
    const profile = Object.hasOwn(PROFILE_RULES, policy?.profile) ? policy.profile : "standard";
    const defaults = PROFILE_RULES[profile];
    return {
      profile,
      autoRestoreHours: clampInt(policy?.autoRestoreHours, 0, 24 * 30, defaults.autoRestoreHours),
      restoreLimit: clampInt(policy?.restoreLimit, 1, 12, defaults.restoreLimit),
      verifiedBackupMaxAgeDays: clampInt(policy?.verifiedBackupMaxAgeDays, 1, 365, defaults.verifiedBackupMaxAgeDays)
    };
  }

  function protectionProfile(profile = "standard") {
    return PROFILE_RULES[profile] || PROFILE_RULES.standard;
  }

  function normalizeJournal(entries = []) {
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && typeof entry === "object")
      .map(entry => ({
        id: String(entry.id || `security-${Number(entry.at || Date.now())}`),
        at: Number(entry.at || 0),
        type: String(entry.type || "system").slice(0, 60),
        tone: ["ok", "warn", "bad", "info"].includes(entry.tone) ? entry.tone : "info",
        title: String(entry.title || "Событие защиты").slice(0, 180),
        detail: String(entry.detail || "").slice(0, 800),
        code: String(entry.code || "").slice(0, 100)
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, JOURNAL_LIMIT);
  }

  function recordSecurityEvent(meta = {}, event = {}, now = () => Date.now()) {
    const at = Number(event.at || now());
    const entry = {
      id: String(event.id || `security-${at}-${Math.random().toString(36).slice(2, 8)}`),
      at,
      type: event.type || "system",
      tone: event.tone || "info",
      title: event.title || "Событие защиты",
      detail: event.detail || "",
      code: event.code || ""
    };
    meta.journal = normalizeJournal([entry, ...(meta.journal || [])]);
    return meta.journal[0];
  }

  function stateSummary(state = {}) {
    const desktops = Array.isArray(state.desktops) ? state.desktops : [];
    const fs = state.fs && typeof state.fs === "object" ? Object.values(state.fs) : [];
    const desktopStores = desktops.map(desk => desk?.data || {});
    const countAll = key => (Array.isArray(state[key]) ? state[key].length : 0) + desktopStores.reduce((sum, store) => sum + (Array.isArray(store[key]) ? store[key].length : 0), 0);
    return {
      desktops: desktops.length,
      files: fs.length,
      folders: fs.filter(item => item?.type === "folder").length,
      notes: fs.filter(item => ["note", "text", "markdown"].includes(item?.type)).length,
      tables: fs.filter(item => item?.type === "table").length,
      images: fs.filter(item => item?.type === "image").length,
      tasks: countAll("tasks"),
      events: countAll("events"),
      notifications: countAll("notifications")
    };
  }

  function compareStateSummaries(current = {}, incoming = {}) {
    const keys = ["desktops", "files", "folders", "notes", "tables", "images", "tasks", "events", "notifications"];
    return keys.map(key => ({ key, current: Number(current[key] || 0), incoming: Number(incoming[key] || 0), delta: Number(incoming[key] || 0) - Number(current[key] || 0) }));
  }

  async function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value && typeof value.arrayBuffer === "function") return new Uint8Array(await value.arrayBuffer());
    return new TextEncoder().encode(String(value ?? ""));
  }

  function hex(bytes) {
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  async function checksum(value, options = {}) {
    const bytes = await toBytes(value);
    const cryptoRef = options.crypto || globalThis.crypto;
    if (cryptoRef?.subtle?.digest) {
      const digest = await cryptoRef.subtle.digest("SHA-256", bytes);
      return { algorithm: "SHA-256", value: hex(new Uint8Array(digest)) };
    }
    const crc = assetUtils.crc32(bytes) >>> 0;
    return { algorithm: "CRC32", value: crc.toString(16).padStart(8, "0") };
  }

  async function verifyChecksum(value, expected = {}, options = {}) {
    const bytes = await toBytes(value);
    if (expected.algorithm === "CRC32") {
      return (assetUtils.crc32(bytes) >>> 0).toString(16).padStart(8, "0") === expected.value;
    }
    const actual = await checksum(bytes, options);
    return actual.algorithm === expected.algorithm && actual.value === expected.value;
  }

  async function createBackupManifest(entries = [], metadata = {}, options = {}) {
    const files = [];
    for (const entry of entries) {
      const bytes = await toBytes(entry.blob);
      const digest = await checksum(bytes, options);
      files.push({ path: String(entry.path || ""), bytes: bytes.byteLength, ...digest });
    }
    return {
      app: "ZeTer OS",
      format: "zeter-backup-manifest",
      formatVersion: 1,
      createdAt: metadata.createdAt || new Date().toISOString(),
      osVersion: metadata.osVersion || "",
      versionNumber: Number(metadata.versionNumber || 0),
      backupMode: metadata.backupMode || "zip-with-readable-folders",
      stateSummary: metadata.stateSummary || {},
      files
    };
  }

  function parseJsonBytes(bytes, label) {
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error(`${label} содержит повреждённый JSON.`); }
  }

  function validateBackupStatePayload(payload = {}) {
    const state = payload?.state || payload;
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("В бэкапе нет состояния ZeTer OS.");
    if (!state.fs || typeof state.fs !== "object" || Array.isArray(state.fs)) throw new Error("В бэкапе нет файловой системы ZeTer OS.");
    if (!state.settings || typeof state.settings !== "object" || Array.isArray(state.settings)) throw new Error("В бэкапе нет настроек ZeTer OS.");
    return state;
  }

  async function verifyBackupEntries(entries, options = {}) {
    const stateBytes = entries.get(STATE_PATH) || entries.get(`backup/${STATE_PATH}`);
    if (!stateBytes) throw new Error(`В бэкапе не найден ${STATE_PATH}.`);
    const payload = parseJsonBytes(stateBytes, STATE_PATH);
    const state = validateBackupStatePayload(payload);
    const manifestBytes = entries.get(MANIFEST_PATH);
    if (!manifestBytes) {
      return { ok: true, verified: false, legacy: true, status: "Совместимый старый бэкап без манифеста", payload, state, summary: stateSummary(state), manifest: null };
    }

    const manifest = parseJsonBytes(manifestBytes, MANIFEST_PATH);
    if (manifest?.format !== "zeter-backup-manifest" || Number(manifest?.formatVersion) !== 1 || !Array.isArray(manifest.files)) {
      throw new Error("Манифест бэкапа имеет неподдерживаемый формат.");
    }
    for (const expected of manifest.files) {
      const bytes = entries.get(expected.path);
      if (!bytes) throw new Error(`В бэкапе отсутствует файл из манифеста: ${expected.path}.`);
      if (Number(expected.bytes) !== bytes.byteLength) throw new Error(`Размер файла ${expected.path} не совпадает с манифестом.`);
      if (!(await verifyChecksum(bytes, expected, options))) throw new Error(`Контрольная сумма файла ${expected.path} не совпадает.`);
    }
    return { ok: true, verified: true, legacy: false, status: "Манифест и контрольные суммы проверены", payload, state, summary: stateSummary(state), manifest };
  }

  async function verifyBackupBlob(blob, options = {}) {
    const entries = await (options.readStoredZipEntries || assetUtils.readStoredZipEntries)(await blob.arrayBuffer());
    return verifyBackupEntries(entries, options);
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function encryptedBackupSupported(cryptoRef = globalThis.crypto) {
    return Boolean(cryptoRef?.subtle?.importKey && cryptoRef?.getRandomValues);
  }

  async function deriveEncryptionKey(passphrase, salt, iterations, cryptoRef) {
    const material = await cryptoRef.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return cryptoRef.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptBackupBlob(blob, passphrase, options = {}) {
    const password = String(passphrase || "");
    if (password.length < 8) throw new Error("Парольная фраза должна содержать не менее 8 символов.");
    const cryptoRef = options.crypto || globalThis.crypto;
    if (!encryptedBackupSupported(cryptoRef)) throw new Error("Шифрование недоступно в этом браузере. Используй актуальный Edge, Chrome или запуск через Python.");
    const salt = cryptoRef.getRandomValues(new Uint8Array(16));
    const iv = cryptoRef.getRandomValues(new Uint8Array(12));
    const iterations = clampInt(options.iterations, 10000, 1000000, DEFAULT_PBKDF2_ITERATIONS);
    const header = {
      format: ENCRYPTED_FORMAT,
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      originalName: String(options.originalName || "ZeTer_OS_backup.zip").slice(0, 240),
      originalBytes: Number(blob?.size || 0),
      cipher: "AES-256-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv)
    };
    const headerBytes = new TextEncoder().encode(JSON.stringify(header));
    const key = await deriveEncryptionKey(password, salt, iterations, cryptoRef);
    const encrypted = await cryptoRef.subtle.encrypt({ name: "AES-GCM", iv, additionalData: headerBytes }, key, await blob.arrayBuffer());
    const magic = new TextEncoder().encode(ENCRYPTED_MAGIC);
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, headerBytes.byteLength, true);
    return new Blob([magic, length, headerBytes, encrypted], { type: "application/x-zeter-backup" });
  }

  async function decryptBackupBlob(source, passphrase, options = {}) {
    const password = String(passphrase || "");
    if (!password) throw new Error("Для зашифрованного бэкапа нужна парольная фраза.");
    const cryptoRef = options.crypto || globalThis.crypto;
    if (!encryptedBackupSupported(cryptoRef)) throw new Error("Расшифровка недоступна в этом браузере.");
    const bytes = await toBytes(source);
    const magicBytes = new TextEncoder().encode(ENCRYPTED_MAGIC);
    if (bytes.byteLength < magicBytes.byteLength + 5 || !magicBytes.every((value, index) => bytes[index] === value)) throw new Error("Файл не является зашифрованным бэкапом ZeTer OS.");
    const headerLength = new DataView(bytes.buffer, bytes.byteOffset + magicBytes.byteLength, 4).getUint32(0, true);
    if (headerLength < 20 || headerLength > 64 * 1024 || magicBytes.byteLength + 4 + headerLength >= bytes.byteLength) throw new Error("Заголовок зашифрованного бэкапа повреждён.");
    const headerStart = magicBytes.byteLength + 4;
    const headerBytes = bytes.slice(headerStart, headerStart + headerLength);
    const header = parseJsonBytes(headerBytes, "Заголовок бэкапа");
    if (header?.format !== ENCRYPTED_FORMAT || Number(header?.formatVersion) !== 1) throw new Error("Версия зашифрованного бэкапа не поддерживается.");
    const salt = base64ToBytes(header.salt);
    const iv = base64ToBytes(header.iv);
    const key = await deriveEncryptionKey(password, salt, clampInt(header.iterations, 10000, 1000000, DEFAULT_PBKDF2_ITERATIONS), cryptoRef);
    try {
      const decrypted = await cryptoRef.subtle.decrypt({ name: "AES-GCM", iv, additionalData: headerBytes }, key, bytes.slice(headerStart + headerLength));
      if (Number(header.originalBytes || 0) && decrypted.byteLength !== Number(header.originalBytes)) throw new Error("Размер расшифрованного архива не совпадает.");
      const blob = new Blob([decrypted], { type: "application/zip" });
      return { blob, header };
    } catch (error) {
      if (/размер/i.test(error?.message || "")) throw error;
      throw new Error("Не удалось расшифровать бэкап. Проверь парольную фразу и целостность файла.");
    }
  }

  function isEncryptedBackupFile(file) {
    return /\.zeterbak$/i.test(file?.name || "") || file?.type === "application/x-zeter-backup";
  }

  function describeRestorePoint(point = {}) {
    const summary = point.summary && typeof point.summary === "object" ? point.summary : stateSummary(point.state || {});
    return {
      id: String(point.id || ""),
      name: String(point.name || "Точка восстановления"),
      reason: String(point.reason || "manual"),
      createdAt: Number(point.createdAt || 0),
      osVersion: String(point.osVersion || ""),
      sizeBytes: Number(point.sizeBytes || 0),
      verified: point.verified !== false,
      summary
    };
  }

  window.ZETER_SECURITY_PROTECTION_UTILS = Object.freeze({
    JOURNAL_LIMIT,
    MANIFEST_PATH,
    STATE_PATH,
    PROFILE_RULES,
    normalizeProtectionPolicy,
    protectionProfile,
    normalizeJournal,
    recordSecurityEvent,
    stateSummary,
    compareStateSummaries,
    checksum,
    createBackupManifest,
    validateBackupStatePayload,
    verifyBackupEntries,
    verifyBackupBlob,
    encryptedBackupSupported,
    encryptBackupBlob,
    decryptBackupBlob,
    isEncryptedBackupFile,
    describeRestorePoint
  });
})();
