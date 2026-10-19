(() => {
  "use strict";

  const DIRECTORY = "zeter-security-backups";
  const MARKER = ".zeter-vault-owner.json";
  const INDEX = "index.json";
  const OWNER = "zeter-security-backup-vault";
  const LOCK = "zeter-security-vault";
  const DEFAULTS = Object.freeze({ enabled: false, intervalHours: 24, maxCopies: 14, maxBytes: 2 * 1024 ** 3 });
  const ID_PATTERN = /^[a-f0-9]{32}$/;

  function createBrowserBackupVault(options = {}) {
    const getHandle = options.getHandle || (async () => null);
    const chooseFolder = options.chooseFolder;
    const verifyPermission = options.verifyPermission || (async () => false);
    const now = options.now || Date.now;
    let acceptedHandle = null;
    let queue = Promise.resolve();
    let lastError = "";
    let maintenanceWarning = "";

    function protection() {
      const api = window.ZETER_SECURITY_PROTECTION_UTILS;
      if (!api?.verifyBackupBlob) throw new Error("Проверка ZIP-бэкапов недоступна.");
      return api;
    }

    function lockManager() {
      return globalThis.navigator?.locks || window.navigator?.locks;
    }

    function serial(operation, mutation = false) {
      const task = queue.then(async () => {
        const locks = lockManager();
        if (mutation && !locks?.request) throw new Error("Этот браузер не поддерживает Web Locks: безопасная запись истории бэкапов недоступна. Используй актуальный Chrome или Edge.");
        return locks?.request ? locks.request(LOCK, { mode: mutation ? "exclusive" : "shared" }, operation) : operation();
      }).catch(error => {
        lastError = String(error?.message || error);
        throw error;
      });
      queue = task.catch(() => {});
      return task;
    }

    function integer(value, minimum, maximum, label) {
      if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`Неверный предел ${label}.`);
      return value;
    }

    function settings(source, base = DEFAULTS) {
      const result = { ...base };
      if (source.enabled !== undefined) {
        if (typeof source.enabled !== "boolean") throw new Error("Неверный режим автоматических бэкапов.");
        result.enabled = source.enabled;
      }
      if (source.intervalHours !== undefined) result.intervalHours = integer(source.intervalHours, 1, 8760, "интервала бэкапов");
      if (source.maxCopies !== undefined) result.maxCopies = integer(source.maxCopies, 1, 10000, "количества копий");
      if (source.maxBytes !== undefined) result.maxBytes = integer(source.maxBytes, 1, Number.MAX_SAFE_INTEGER, "объёма копий");
      return result;
    }

    function freshId() {
      const crypto = globalThis.crypto;
      if (!crypto?.getRandomValues || !crypto?.subtle?.digest) throw new Error("Браузер не поддерживает безопасные контрольные суммы бэкапов.");
      return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    function backupName(id, createdAt) {
      return `zeter-backup-${new Date(createdAt).toISOString().replace(/[:.]/g, "-")}-${id}.zip`;
    }

    async function checksum(blob) {
      if (!globalThis.crypto?.subtle?.digest) throw new Error("SHA-256 недоступен в этом браузере.");
      const hash = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
    }

    async function optionalFile(directory, name) {
      try { return await directory.getFileHandle(name); }
      catch (error) { if (error?.name === "NotFoundError") return null; throw error; }
    }

    async function writeFile(file, data) {
      const writable = await file.createWritable();
      try {
        await writable.write(data);
        await writable.close();
      } catch (error) {
        // Abort is best effort; the original write/close error remains observable.
        try { await writable.abort(); } catch (_) { /* closed or unavailable stream */ }
        throw error;
      }
    }

    async function writeJson(directory, name, value) {
      const text = JSON.stringify(value);
      const file = await directory.getFileHandle(name, { create: true });
      // File System Access commits createWritable's temporary content on close.
      await writeFile(file, text);
      if (await (await file.getFile()).text() !== text) throw new Error("Записанный индекс бэкапов не прошёл проверку чтением.");
    }

    function validateEntry(entry) {
      if (!entry || !ID_PATTERN.test(entry.id) || !Number.isSafeInteger(entry.createdAt) || entry.createdAt < 1 || entry.createdAt > 8640000000000000 || entry.name !== backupName(entry.id, entry.createdAt) || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 1 || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.pinned !== "boolean" || entry.verified !== true) throw new Error("Индекс бэкапов содержит повреждённые или чужие записи; файлы сохранены.");
    }

    function validateIndex(value, marker) {
      if (!value || value.owner !== OWNER || value.formatVersion !== 1 || value.vaultId !== marker.vaultId || !Array.isArray(value.entries)) throw new Error("Индекс папки не принадлежит этому хранилищу ZeTer OS или повреждён.");
      if (!value.settings || Object.keys(DEFAULTS).some(key => value.settings[key] === undefined)) throw new Error("Настройки индекса бэкапов повреждены.");
      const normalized = settings(value.settings);
      if (!Number.isSafeInteger(value.lastSuccessAt) || value.lastSuccessAt < 0) throw new Error("Дата последнего бэкапа в индексе повреждена.");
      const ids = new Set();
      const names = new Set();
      for (const entry of value.entries) {
        validateEntry(entry);
        if (ids.has(entry.id) || names.has(entry.name)) throw new Error("Индекс бэкапов содержит повторяющиеся записи; файлы сохранены.");
        ids.add(entry.id);
        names.add(entry.name);
      }
      // Older valid indexes have no pending field. A pending record is an exact
      // reserved mapping, never a path supplied by the caller or a glob match.
      const pending = value.pending === undefined ? null : value.pending;
      if (pending !== null) {
        validateEntry(pending);
        if (pending.pinned || ids.has(pending.id) || names.has(pending.name)) throw new Error("Журнал незавершённого бэкапа повреждён; файлы сохранены.");
      }
      return { ...value, settings: normalized, pending };
    }

    async function openVault(handle, create = false) {
      if (!handle || handle.kind !== "directory") throw new Error("Выбери папку для истории бэкапов.");
      let directory;
      let fresh = false;
      try { directory = await handle.getDirectoryHandle(DIRECTORY); }
      catch (error) {
        if (error?.name !== "NotFoundError") throw error;
        if (!create) return null;
        directory = await handle.getDirectoryHandle(DIRECTORY, { create: true });
        fresh = true;
      }
      let marker;
      if (fresh) {
        marker = { owner: OWNER, formatVersion: 1, vaultId: freshId() };
        await writeJson(directory, MARKER, marker);
      } else {
        const markerFile = await optionalFile(directory, MARKER);
        if (!markerFile) throw new Error("В папке истории отсутствует маркер владельца ZeTer OS. Чужая папка сохранена.");
        try { marker = JSON.parse(await (await markerFile.getFile()).text()); }
        catch (_) { throw new Error("Маркер владельца папки истории повреждён. Файлы сохранены."); }
        if (marker?.owner !== OWNER || marker.formatVersion !== 1 || !ID_PATTERN.test(marker.vaultId)) throw new Error("Папка истории принадлежит другому владельцу или повреждена.");
      }
      const indexFile = await optionalFile(directory, INDEX);
      if (!indexFile) {
        if (!fresh) throw new Error("Индекс папки истории отсутствует. Существующие файлы сохранены; выбери другую папку.");
        return { handle, directory, index: { owner: OWNER, formatVersion: 1, vaultId: marker.vaultId, settings: { ...DEFAULTS }, entries: [], pending: null, lastSuccessAt: 0 } };
      }
      let parsed;
      try { parsed = JSON.parse(await (await indexFile.getFile()).text()); }
      catch (_) { throw new Error("Индекс папки истории повреждён. Существующие файлы сохранены."); }
      return { handle, directory, index: validateIndex(parsed, marker) };
    }

    async function permission(handle, write) {
      if (!await verifyPermission(handle, write)) throw new Error("Нет разрешения на доступ к папке бэкапов. Выбери её повторно.");
    }

    async function currentVault() {
      const handle = acceptedHandle || await getHandle();
      if (!handle) throw new Error("Выбери папку для истории бэкапов.");
      await permission(handle, true);
      const vault = await openVault(handle);
      if (!vault) throw new Error("Папка истории ещё не настроена.");
      return vault;
    }

    async function inspect(directory, entry) {
      const file = await directory.getFileHandle(entry.name);
      const blob = await file.getFile();
      if (blob.size !== entry.sizeBytes || await checksum(blob) !== entry.sha256) throw new Error("Размер или контрольная сумма сохранённого ZIP-бэкапа не совпадает. Файл сохранён.");
      if (!(await protection().verifyBackupBlob(blob)).verified) throw new Error("Сохранённый ZIP-бэкап не прошёл проверку манифеста.");
      return blob;
    }

    function unconfigured(folder = "") {
      return { configured: false, folder, ...DEFAULTS, entries: [], lastError, lastSuccessAt: 0, maintenanceWarning, locationKind: "unknown" };
    }

    async function snapshot(vault) {
      const entries = [];
      let damaged = false;
      for (const entry of vault.index.entries) {
        let verified = false;
        try { await inspect(vault.directory, entry); verified = true; }
        catch (_) { damaged = true; }
        entries.push({ ...entry, verified });
      }
      return {
        configured: true, folder: vault.handle.name || "Выбранная папка", ...vault.index.settings,
        entries: entries.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)),
        lastError, lastSuccessAt: vault.index.lastSuccessAt,
        maintenanceWarning: [maintenanceWarning, vault.index.pending ? "Есть незавершённая публикация бэкапа. Следующее создание сначала проверит её; новые файлы до восстановления не записываются." : "", damaged ? "Некоторые копии отсутствуют или не прошли проверку. Неизвестные и повреждённые файлы сохранены." : ""].filter(Boolean).join(" "),
        locationKind: "unknown"
      };
    }

    async function status() {
      return serial(async () => {
        const handle = acceptedHandle || await getHandle();
        if (!handle) return unconfigured();
        try {
          await permission(handle, false);
          const vault = await openVault(handle);
          if (!vault) return unconfigured(handle.name || "");
          acceptedHandle = handle;
          return snapshot(vault);
        } catch (error) {
          lastError = String(error?.message || error);
          return unconfigured(handle.name || "");
        }
      });
    }

    async function configure(payload = {}) {
      return serial(async () => {
        if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !["chooseFolder", ...Object.keys(DEFAULTS)].includes(key))) throw new Error("Неверные параметры настройки папки бэкапов.");
        // Validate before showing the picker or creating anything in its namespace.
        settings(payload);
        let handle = acceptedHandle || await getHandle();
        if (payload.chooseFolder) {
          if (typeof chooseFolder !== "function") throw new Error("Выбор папки не поддерживается этим браузером.");
          let chosen;
          try { chosen = await chooseFolder(); }
          catch (error) {
            if (error?.name !== "AbortError") throw error;
            chosen = null;
          }
          if (chosen === null || chosen === false || chosen?.cancelled) {
            const previous = handle ? await openVault(handle) : null;
            return { ...(previous ? await snapshot(previous) : unconfigured()), cancelled: true };
          }
          const staged = await getHandle();
          handle = chosen?.kind === "directory" ? chosen : staged;
          // The caller stages its IndexedDB handle and commits it only after this
          // method resolves successfully; on rejection it restores the old handle.
        }
        await permission(handle, true);
        const vault = await openVault(handle, true);
        const candidate = { ...vault.index, settings: settings(payload, vault.index.settings) };
        await writeJson(vault.directory, INDEX, candidate);
        vault.index = candidate;
        acceptedHandle = handle;
        lastError = "";
        maintenanceWarning = "";
        return snapshot(vault);
      }, true);
    }

    async function retain(vault, committedId) {
      if (!vault.index.settings.enabled) return;
      const warnings = [];
      const valid = new Set();
      const ordered = [...vault.index.entries].sort((a, b) => a.createdAt - b.createdAt);
      for (const entry of ordered) {
        try { await inspect(vault.directory, entry); valid.add(entry.id); }
        catch (_) { warnings.push("Повреждённая или недоступная копия сохранена для восстановления."); }
      }
      // The last committed backup stays recoverable even if the system clock
      // repeats or moves backwards; random IDs cannot determine recency.
      const newest = valid.has(committedId) ? committedId : ordered.filter(entry => valid.has(entry.id)).at(-1)?.id;
      const overLimit = () => vault.index.entries.length > vault.index.settings.maxCopies || vault.index.entries.reduce((total, entry) => total + entry.sizeBytes, 0) > vault.index.settings.maxBytes;
      for (const entry of ordered) {
        if (!overLimit()) break;
        if (entry.pinned || entry.id === newest || !valid.has(entry.id)) continue;
        try {
          // Re-read the exact indexed victim, never enumerate/glob ZIPs as victims.
          await inspect(vault.directory, entry);
          await vault.directory.removeEntry(entry.name);
        } catch (error) {
          warnings.push(`Не удалось удалить старую копию: ${String(error?.message || error)}`);
          continue;
        }
        const candidate = { ...vault.index, entries: vault.index.entries.filter(item => item.id !== entry.id) };
        try {
          await writeJson(vault.directory, INDEX, candidate);
          vault.index = candidate;
        } catch (error) {
          warnings.push(`Копия создана, но индекс очистки не подтверждён: ${String(error?.message || error)}`);
          break;
        }
      }
      if (overLimit()) warnings.push("Лимит истории превышен: закреплённые, непроверенные и последняя исправная копии сохранены.");
      maintenanceWarning = [...new Set(warnings)].join(" ");
    }

    async function create(record) {
      return serial(async () => {
        const vault = await currentVault();
        if (vault.index.pending) {
          const pending = vault.index.pending;
          if (await optionalFile(vault.directory, pending.name)) {
            try { await inspect(vault.directory, pending); }
            catch (_) { throw new Error("Незавершённая копия не прошла проверку. Новый архив не создан; сохрани файл для восстановления или убери его из папки истории вручную."); }
            return publish(vault, pending, true);
          }
          // A reservation interrupted before allocation (or after confirmed
          // removal) can be cleared durably before another output is allocated.
          const reconciled = { ...vault.index, pending: null };
          await writeJson(vault.directory, INDEX, reconciled);
          vault.index = reconciled;
        }
        if (typeof options.buildBackup !== "function") throw new Error("Создание полного ZIP-бэкапа недоступно.");
        if (vault.index.settings.enabled && (vault.index.entries.length > vault.index.settings.maxCopies || vault.index.entries.reduce((sum, item) => sum + item.sizeBytes, 0) > vault.index.settings.maxBytes)) throw new Error("История превышает лимит после предыдущего обслуживания. Увеличь лимит или освободи доступ к старым копиям перед новым архивом.");
        const blob = await options.buildBackup(record);
        if (!blob || typeof blob.arrayBuffer !== "function" || !Number.isSafeInteger(blob.size) || blob.size < 1) throw new Error("Не получен полный ZIP-бэкап.");
        if (!(await protection().verifyBackupBlob(blob)).verified) throw new Error("Новый ZIP-бэкап не прошёл проверку манифеста.");
        const createdAt = integer(now(), 1, 8640000000000000, "даты бэкапа");
        const id = freshId();
        const entry = { id, name: backupName(id, createdAt), createdAt, sizeBytes: blob.size, sha256: await checksum(blob), pinned: false, verified: true };
        if (await optionalFile(vault.directory, entry.name)) throw new Error("Имя новой копии уже занято. Существующий файл сохранён.");
        const reserved = { ...vault.index, pending: entry };
        // ACK the sole pending output BEFORE allocating it. Failed publication
        // survives restart and cannot accumulate unindexed ZIPs on each retry.
        await writeJson(vault.directory, INDEX, reserved);
        vault.index = reserved;
        let file = null;
        try {
          if (await optionalFile(vault.directory, entry.name)) throw new Error("Зарезервированное имя занято другим файлом. Файл сохранён.");
          file = await vault.directory.getFileHandle(entry.name, { create: true });
          await writeFile(file, blob);
          await inspect(vault.directory, entry);
        } catch (error) {
          await discardFreshCandidate(vault, entry, file, error);
          throw error;
        }
        return publish(vault, entry);
      }, true);
    }

    async function discardFreshCandidate(vault, entry, ownedFile, originalError) {
      try {
        const current = await optionalFile(vault.directory, entry.name);
        if (current) {
          // Only this invocation's newly allocated handle may be discarded.
          // After restart an invalid pending file is ambiguous and is preserved.
          if (!ownedFile || (current !== ownedFile && !(await ownedFile.isSameEntry?.(current)))) throw new Error("принадлежность незавершённого файла не подтверждена");
          await vault.directory.removeEntry(entry.name);
          if (await optionalFile(vault.directory, entry.name)) throw new Error("удаление незавершённого файла не подтверждено");
        }
        const cleared = { ...vault.index, pending: null };
        await writeJson(vault.directory, INDEX, cleared);
        vault.index = cleared;
      } catch (cleanupError) {
        throw new Error(`${String(originalError?.message || originalError)} Незавершённая публикация сохранена в журнале; новые архивы заблокированы до восстановления: ${String(cleanupError?.message || cleanupError)}`);
      }
    }

    async function publish(vault, entry, recovered = false) {
      const candidate = { ...vault.index, entries: [...vault.index.entries, entry], pending: null, lastSuccessAt: entry.createdAt };
      // Durable ACK of this verified copy precedes every retention deletion.
      // On failure the previous durable index still owns the one pending file.
      await writeJson(vault.directory, INDEX, candidate);
      vault.index = candidate;
      acceptedHandle = vault.handle;
      lastError = "";
      maintenanceWarning = "";
      await retain(vault, entry.id);
      const result = await snapshot(vault);
      const published = result.entries.find(item => item.id === entry.id);
      if (!published?.verified) throw new Error("Новая копия больше не проходит проверку после записи индекса. История сохранена; проверь доступ к папке.");
      return { ...result, entry: published, recovered };
    }

    function findEntry(vault, id) {
      if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("Неверный идентификатор бэкапа.");
      const entry = vault.index.entries.find(item => item.id === id);
      if (!entry) throw new Error("Бэкап не найден в индексе папки.");
      return entry;
    }

    async function pin({ id, pinned } = {}) {
      return serial(async () => {
        if (typeof pinned !== "boolean") throw new Error("Неверный режим закрепления бэкапа.");
        const vault = await currentVault();
        const entry = findEntry(vault, id);
        const candidate = { ...vault.index, entries: vault.index.entries.map(item => item.id === entry.id ? { ...item, pinned } : item) };
        await writeJson(vault.directory, INDEX, candidate);
        vault.index = candidate;
        lastError = "";
        return snapshot(vault);
      }, true);
    }

    async function read({ id } = {}) {
      return serial(async () => {
        const handle = acceptedHandle || await getHandle();
        await permission(handle, false);
        const vault = await openVault(handle);
        if (!vault) throw new Error("Папка истории ещё не настроена.");
        const entry = findEntry(vault, id);
        return { name: entry.name, blob: await inspect(vault.directory, entry) };
      });
    }

    return Object.freeze({ status, configure, create, pin, read });
  }

  window.ZETER_SECURITY_VAULT_UTILS = Object.freeze({ createBrowserBackupVault });
})();
