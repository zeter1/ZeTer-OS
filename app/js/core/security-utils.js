(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const coreUtils = window.ZETER_CORE_UTILS;
  const protectionUtils = window.ZETER_SECURITY_PROTECTION_UTILS;
  if (!config || !coreUtils || !protectionUtils) throw new Error("ZeTer OS security utils require config, core and protection utils.");

  const { pad, isSafeId } = coreUtils;
  const TRASH_ROOT = config.TRASH_ROOT;
  const CALENDAR_CATEGORY_IDS = new Set(config.CALENDAR_CATEGORY_IDS || []);
  const CALENDAR_REPEAT_IDS = new Set(config.CALENDAR_REPEAT_IDS || []);
  const { normalizeProtectionPolicy, normalizeJournal } = protectionUtils;

  function normalizeSecurityMeta(meta = {}) {
    const lastIntegrityStatus = String(meta?.lastIntegrityStatus || "");
    let lastIntegrityOutcome = ["not_checked", "ok", "warn", "bad"].includes(meta?.lastIntegrityOutcome)
      ? meta.lastIntegrityOutcome
      : "not_checked";
    if (lastIntegrityOutcome === "not_checked" && Number(meta?.lastIntegrityCheckAt || 0)) {
      lastIntegrityOutcome = /^Проверка завершена\. Ошибок не найдено\.?$/i.test(lastIntegrityStatus.trim()) ? "ok" : "warn";
    }
    return {
      lastFullBackupAt: Number(meta?.lastFullBackupAt || 0),
      lastFullBackupSize: Number(meta?.lastFullBackupSize || 0),
      lastFullBackupName: String(meta?.lastFullBackupName || ""),
      lastBackupVerifiedAt: Number(meta?.lastBackupVerifiedAt || 0),
      lastBackupVerified: Boolean(meta?.lastBackupVerified),
      lastBackupChecksum: String(meta?.lastBackupChecksum || ""),
      lastBackupChecksumAlgorithm: String(meta?.lastBackupChecksumAlgorithm || ""),
      lastEncryptedBackupAt: Number(meta?.lastEncryptedBackupAt || 0),
      lastRecoveryTestAt: Number(meta?.lastRecoveryTestAt || 0),
      lastRecoveryTestStatus: String(meta?.lastRecoveryTestStatus || ""),
      lastIntegrityCheckAt: Number(meta?.lastIntegrityCheckAt || 0),
      lastIntegrityStatus,
      lastIntegrityOutcome,
      lastIntegrityBad: Number(meta?.lastIntegrityBad || 0),
      lastIntegrityWarn: Number(meta?.lastIntegrityWarn || 0),
      lastAutoRestorePointAt: Number(meta?.lastAutoRestorePointAt || 0),
      lastImportAt: Number(meta?.lastImportAt || 0),
      lastCleanupAt: Number(meta?.lastCleanupAt || 0),
      protectionPolicy: normalizeProtectionPolicy(meta?.protectionPolicy),
      journal: normalizeJournal(meta?.journal)
    };
  }

  function securityBackupFileName(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const safe = Number.isNaN(d.getTime()) ? new Date() : d;
    return `ZeTer_OS_full_backup_${safe.getFullYear()}-${pad(safe.getMonth() + 1)}-${pad(safe.getDate())}_${pad(safe.getHours())}-${pad(safe.getMinutes())}.zip`;
  }

  function formatSecurityTime(value, empty = "Ещё не выполнялось") {
    const n = Number(value || 0);
    return n ? new Date(n).toLocaleString("ru-RU") : empty;
  }

  function securityStatusLabel(snapshot = {}, storageError = "") {
    if (storageError) return { label: "Требуется внимание", tone: "bad", text: storageError };
    if (snapshot.risk?.tone === "bad") return { label: "Есть риск переполнения", tone: "bad", text: snapshot.risk.text };
    const outcome = snapshot.meta?.lastIntegrityOutcome || "not_checked";
    if (outcome === "bad") return { label: "Найдены критичные проблемы", tone: "bad", text: snapshot.lastIntegrityStatus || "Требуется проверка и безопасное исправление данных." };
    if (outcome === "warn") return { label: "Есть замечания", tone: "warn", text: snapshot.lastIntegrityStatus || "Проверка нашла предупреждения." };
    if (outcome === "not_checked") return { label: "Целостность не проверялась", tone: "warn", text: "Выполни полную проверку, чтобы подтвердить состояние данных." };
    return { label: "Данные в порядке", tone: "ok", text: snapshot.lastIntegrityStatus || "Последняя проверка завершилась без ошибок." };
  }

  function securityProtectionReadiness(snapshot = {}, now = () => Date.now()) {
    const policy = normalizeProtectionPolicy(snapshot.meta?.protectionPolicy);
    const data = snapshot.status || securityStatusLabel(snapshot, "");
    const verifiedAt = Number(snapshot.meta?.lastBackupVerifiedAt || 0);
    const maxAgeMs = policy.verifiedBackupMaxAgeDays * 24 * 60 * 60 * 1000;
    const backup = !verifiedAt
      ? { label: "Нет проверенного бэкапа", tone: "warn", text: "Создай переносимый ZIP-бэкап и сохрани его отдельно от папки программы." }
      : now() - verifiedAt > maxAgeMs
        ? { label: "Бэкап устарел", tone: "warn", text: `Последний проверенный бэкап старше ${policy.verifiedBackupMaxAgeDays} дн.` }
        : { label: "Бэкап готов", tone: "ok", text: "Последний переносимый бэкап прошёл проверку манифеста и контрольных сумм." };
    const recovery = Number(snapshot.restoreCount || 0) > 0
      ? { label: "Восстановление готово", tone: "ok", text: `Доступно точек восстановления: ${snapshot.restoreCount}.` }
      : { label: "Нет точки восстановления", tone: "warn", text: "Создай точку перед крупными изменениями или импортом." };
    const tones = [data.tone, backup.tone, recovery.tone];
    const tone = tones.includes("bad") ? "bad" : tones.includes("warn") ? "warn" : "ok";
    const label = tone === "ok" ? "Защита настроена" : tone === "bad" ? "Требуется срочное действие" : "Защиту можно усилить";
    const score = Math.max(0, 100 - tones.filter(value => value === "warn").length * 20 - tones.filter(value => value === "bad").length * 45);
    return { label, tone, score, data, backup, recovery, policy };
  }

  function securityRiskFromPercent(pct, options = {}) {
    if (!Number.isFinite(pct)) {
      return {
        level: "low",
        label: "Низкий",
        text: options.nativeMode ? "Данные лежат в папке data; квота браузера не используется." : "Браузер не отдал квоту хранилища, но размер данных считается реально.",
        tone: "ok"
      };
    }
    if (pct >= 90) return { level: "critical", label: "Критический", text: "Есть риск проблем с сохранением. Срочно сделай полный бэкап.", tone: "bad" };
    if (pct >= 75) return { level: "high", label: "Высокий", text: "Хранилище почти заполнено. Сделай бэкап и очисти лишние данные.", tone: "bad" };
    if (pct >= 40) return { level: "medium", label: "Средний", text: "Данных становится больше. Рекомендуется периодически делать бэкап.", tone: "warn" };
    return { level: "low", label: "Низкий", text: "Хранилище работает стабильно.", tone: "ok" };
  }

  function securityStorageRiskModel(options = {}) {
    const nativeMode = Boolean(options.nativeMode);
    const stateBytes = Number(options.stateBytes || 0);
    const usage = Number(options.usage || 0);
    const quota = Number(options.quota || 0);
    const fallbackLimit = Number(options.fallbackLimit || 5 * 1024 * 1024);
    const percent = typeof options.percent === "function" ? options.percent : (used, total) => total > 0 ? (used / total) * 100 : null;
    if (nativeMode) {
      return {
        usagePct: null,
        statePct: null,
        riskPct: null,
        risk: { level: "low", label: "Низкий", text: "Основное состояние хранится в папке data рядом с программой, квота браузера не используется.", tone: "ok" }
      };
    }

    const usagePct = quota > 0 ? percent(usage, quota) : null;
    const statePct = quota > 0 ? percent(stateBytes, quota) : percent(stateBytes, fallbackLimit);
    const riskPct = Number.isFinite(usagePct) ? Math.max(usagePct, statePct || 0) : statePct;
    return {
      usagePct,
      statePct,
      riskPct,
      risk: securityRiskFromPercent(riskPct, { nativeMode })
    };
  }

  async function collectExternalSaveSnapshotModel(options = {}) {
    const {
      workspace = {},
      nativeMode = false,
      supportsExternalFolderSave = () => false,
      externalDirectoryHandle = null,
      nativeStorageCall = async () => ({})
    } = options;
    const supported = nativeMode ? true : supportsExternalFolderSave();
    const statusText = String(workspace.externalSaveStatus || "").trim();
    const result = {
      supported,
      enabled: Boolean(workspace.externalSaveEnabled),
      hasHandle: Boolean(externalDirectoryHandle),
      permission: "",
      folderName: externalDirectoryHandle?.name || "",
      label: "Папка не выбрана",
      tone: "warn",
      note: statusText || "Выбери папку, чтобы ZeTer OS автоматически обновляла резервную копию на компьютере."
    };
    if (nativeMode) {
      try {
        const info = await nativeStorageCall("get_storage_info");
        result.enabled = true;
        result.hasHandle = true;
        result.permission = "granted";
        result.folderName = info?.dataDir || "data";
        result.label = "Папка data подключена";
        result.tone = "ok";
        result.note = `Данные автоматически сохраняются рядом с программой: ${info?.dataDir || "data"}.`;
        return result;
      } catch (error) {
        result.label = "Python-хранилище недоступно";
        result.tone = "warn";
        result.note = error?.message || "Запусти ZeTer OS через run_zeter_os.py.";
        return result;
      }
    }
    if (!supported) {
      result.label = "Не поддерживается";
      result.tone = "warn";
      result.note = "Автосохранение в папку доступно в Chrome, Edge или Brave через File System Access API.";
      return result;
    }
    if (!externalDirectoryHandle) {
      result.enabled = false;
      return result;
    }
    try {
      result.permission = await externalDirectoryHandle.queryPermission({ mode: "readwrite" });
    } catch {
      result.permission = "unknown";
    }
    if (result.permission === "granted") {
      result.label = workspace.externalSaveEnabled ? "Папка подключена" : "Папка выбрана";
      result.tone = "ok";
      result.note = statusText || `Выбрана папка: ${result.folderName || "без имени"}.`;
    } else if (result.permission === "denied") {
      result.label = "Нет разрешения";
      result.tone = "bad";
      result.note = "Браузер запретил запись в выбранную папку. Выбери папку заново или разреши доступ.";
    } else {
      result.label = "Нужно разрешение";
      result.tone = "warn";
      result.note = statusText || "Папка была выбрана ранее, но браузер попросит подтвердить доступ при следующем сохранении.";
    }
    return result;
  }

  async function collectSecuritySnapshotModel(options = {}) {
    const {
      meta = {},
      stateBytes = 0,
      storageRuntime = {},
      byteSize = value => String(value || "").length,
      readSmallSettings = () => "",
      readRestorePoints = async () => [],
      nativeMode = false,
      nativeStorageCall = async () => ({}),
      getStorageEstimate = async () => null,
      percent = (used, total) => total > 0 ? (used / total) * 100 : null,
      collectExternalSaveSnapshot = async () => ({})
      , collectCleanupPreview = async () => ({})
    } = options;
    let localSettingsBytes = Number(storageRuntime.localSettingsBytes || 0);
    try {
      if (!localSettingsBytes) localSettingsBytes = byteSize(readSmallSettings() || "");
    } catch {}

    let restoreCount = 0;
    let restorePoints = [];
    let restoreError = "";
    try {
      restorePoints = await readRestorePoints();
      restoreCount = restorePoints.length;
    } catch (error) {
      restoreError = error?.message || "Не удалось прочитать точки восстановления";
    }

    let nativeInfo = null;
    let usage = 0;
    let quota = 0;
    if (nativeMode) {
      try {
        nativeInfo = await nativeStorageCall("get_storage_info");
        usage = Number(nativeInfo?.dataBytes || stateBytes || 0);
        storageRuntime.usage = usage;
        storageRuntime.quota = null;
        storageRuntime.pressurePct = null;
      } catch (error) {
        restoreError = restoreError || (error?.message || "Не удалось прочитать папку data");
      }
    } else {
      let estimate = null;
      try {
        estimate = await getStorageEstimate();
      } catch {}
      usage = Number(estimate?.usage || storageRuntime.usage || 0);
      quota = Number(estimate?.quota || storageRuntime.quota || 0);
    }

    const { usagePct, statePct, riskPct, risk } = securityStorageRiskModel({
      nativeMode,
      stateBytes,
      usage,
      quota,
      percent
    });
    const externalSave = await collectExternalSaveSnapshot();
    let cleanupPreview = {};
    try { cleanupPreview = await collectCleanupPreview(); } catch {}
    const snapshot = {
      meta,
      stateBytes,
      localSettingsBytes,
      restoreCount,
      restorePoints,
      restoreError,
      usage,
      quota,
      usagePct,
      statePct,
      riskPct,
      risk,
      nativeInfo,
      externalSave,
      cleanupPreview,
      lastAutosaveAt: storageRuntime.lastSavedAt || 0,
      lastLoadedAt: storageRuntime.lastLoadedAt || 0,
      lastIntegrityStatus: meta.lastIntegrityStatus || ""
    };
    snapshot.status = securityStatusLabel(snapshot, storageRuntime.lastError);
    snapshot.protection = securityProtectionReadiness(snapshot);
    return snapshot;
  }

  function addIntegrityProblem(list, level, message, code = "", target = "") {
    list.push({ level, message, code, target });
  }

  function validateSecurityTaskStore(store, label, problems) {
    const projects = Array.isArray(store?.taskProjects) ? store.taskProjects : [];
    projects.forEach((project, index) => {
      if (!project || typeof project !== "object") return addIntegrityProblem(problems, "bad", `${label}: найден повреждённый проект #${index + 1}.`, "bad-project");
      if (project.id && !isSafeId(String(project.id))) addIntegrityProblem(problems, "bad", `${label}: небезопасный ID проекта ${project.id}.`, "project-unsafe-id", project.id);
    });
    const tasks = Array.isArray(store?.tasks) ? store.tasks : [];
    const ids = new Set();
    tasks.forEach((task, index) => {
      if (!task || typeof task !== "object") return addIntegrityProblem(problems, "bad", `${label}: найдена повреждённая задача #${index + 1}.`, "bad-task");
      if (!task.id) addIntegrityProblem(problems, "warn", `${label}: у задачи «${task.title || "Без названия"}» нет ID.`, "task-missing-id", task.id || "");
      if (task.id && !isSafeId(String(task.id))) addIntegrityProblem(problems, "bad", `${label}: небезопасный ID задачи ${task.id}.`, "task-unsafe-id", task.id);
      if (task.projectId && !isSafeId(String(task.projectId))) addIntegrityProblem(problems, "bad", `${label}: небезопасный ID проекта у задачи «${task.title || "Без названия"}».`, "task-project-unsafe-id", task.id || "");
      if (task.id && ids.has(task.id)) addIntegrityProblem(problems, "bad", `${label}: дубликат ID задачи ${task.id}.`, "task-duplicate-id", task.id);
      if (task.id) ids.add(task.id);
      if (!String(task.title || "").trim()) addIntegrityProblem(problems, "warn", `${label}: есть задача без названия.`, "task-missing-title", task.id || "");
      (Array.isArray(task.checklist) ? task.checklist : []).forEach((sub, subIndex) => {
        if (sub?.id && !isSafeId(String(sub.id))) addIntegrityProblem(problems, "bad", `${label}: небезопасный ID подпункта #${index + 1}.${subIndex + 1}.`, "task-sub-unsafe-id", task.id || "");
      });
    });
  }

  function validateSecurityEventStore(events, label, problems) {
    const list = Array.isArray(events) ? events : [];
    if (!Array.isArray(events)) addIntegrityProblem(problems, "bad", `${label}: список событий не является массивом.`, "events-not-array");
    const eventIds = new Set();
    list.forEach((event, index) => {
      if (!event || typeof event !== "object") return addIntegrityProblem(problems, "bad", `${label}: повреждённое событие #${index + 1}.`, "event-bad");
      if (!event.id) addIntegrityProblem(problems, "warn", `${label}: у события «${event.title || "Без названия"}» нет ID.`, "event-missing-id");
      if (event.id && !isSafeId(String(event.id))) addIntegrityProblem(problems, "bad", `${label}: небезопасный ID события ${event.id}.`, "event-unsafe-id", event.id);
      if (event.id && eventIds.has(event.id)) addIntegrityProblem(problems, "bad", `${label}: дубликат ID события ${event.id}.`, "event-duplicate-id", event.id);
      if (event.id) eventIds.add(event.id);
      if (!String(event.title || "").trim()) addIntegrityProblem(problems, "warn", `${label}: есть событие без названия.`, "event-missing-title", event.id || "");
      if (!event.date) addIntegrityProblem(problems, "warn", `${label}: у события «${event.title || "Без названия"}» нет даты.`, "event-missing-date", event.id || "");
      if (event.category && !CALENDAR_CATEGORY_IDS.has(String(event.category))) addIntegrityProblem(problems, "bad", `${label}: небезопасная категория события «${event.title || "Без названия"}».`, "event-unsafe-category", event.id || "");
      if (event.repeat && !CALENDAR_REPEAT_IDS.has(String(event.repeat))) addIntegrityProblem(problems, "bad", `${label}: небезопасный повтор события «${event.title || "Без названия"}».`, "event-unsafe-repeat", event.id || "");
    });
  }

  function normalizeRootSet(values = []) {
    const roots = new Set();
    if (values instanceof Set) values.forEach(value => { if (value) roots.add(value); });
    else if (Array.isArray(values)) values.forEach(value => { if (value) roots.add(value); });
    roots.add("desktop");
    return roots;
  }

  function validateSecurityFileSystem(fs, options = {}, problems = []) {
    if (!fs || typeof fs !== "object") {
      addIntegrityProblem(problems, "bad", "Файловая система ZeTer OS отсутствует или повреждена.", "fs-missing");
      return problems;
    }
    const ids = new Set();
    const desktopRoots = normalizeRootSet(options.desktopRoots);
    Object.entries(fs).forEach(([key, item]) => {
      if (!item || typeof item !== "object") return addIntegrityProblem(problems, "bad", `Повреждённая запись файловой системы: ${key}.`, "fs-bad-record", key);
      if (!item.id) addIntegrityProblem(problems, "warn", `Элемент «${item.name || key}» не имеет ID.`, "fs-missing-id", key);
      if (item.id && !isSafeId(String(item.id))) addIntegrityProblem(problems, "bad", `Небезопасный ID в файловой системе: ${item.id}.`, "fs-unsafe-id", item.id);
      if (key && !isSafeId(String(key))) addIntegrityProblem(problems, "bad", `Небезопасный ключ файловой системы: ${key}.`, "fs-unsafe-key", key);
      if (item.id && key && item.id !== key) addIntegrityProblem(problems, "bad", `ID элемента «${item.name || key}» не совпадает с ключом файловой системы.`, "fs-id-key-mismatch", key);
      if (item.id && ids.has(item.id)) addIntegrityProblem(problems, "bad", `Дубликат ID в файловой системе: ${item.id}.`, "fs-duplicate-id", item.id);
      if (item.id) ids.add(item.id);
      if (!String(item.name || "").trim()) addIntegrityProblem(problems, "warn", `Элемент ${item.id || key} не имеет имени.`, "fs-missing-name", key);
      const parent = item.parent;
      if (parent && !isSafeId(String(parent))) addIntegrityProblem(problems, "bad", `У элемента «${item.name || item.id || key}» небезопасный ID родителя.`, "fs-unsafe-parent", key);
      const parentOk = parent === TRASH_ROOT || desktopRoots.has(parent) || Boolean(fs[parent]);
      if (!parentOk) addIntegrityProblem(problems, "warn", `У элемента «${item.name || item.id || key}» битая ссылка на родительскую папку.`, "fs-bad-parent", key);
      if (item.deletedAt && item.parent === TRASH_ROOT && !item.originalParent) addIntegrityProblem(problems, "warn", `У старой удалённой записи «${item.name || item.id || key}» нет исходного пути.`, "trash-missing-origin", key);
      if (item.type === "tasklist") validateSecurityTaskStore(item, `Список задач «${item.name || item.id || key}»`, problems);
    });
    return problems;
  }

  function validateSecurityDesktopStores(desktops = [], problems = []) {
    (Array.isArray(desktops) ? desktops : []).forEach((desk, index) => {
      if (desk?.id && !isSafeId(String(desk.id))) addIntegrityProblem(problems, "bad", `Рабочий стол #${index + 1}: небезопасный ID ${desk.id}.`, "desktop-unsafe-id", desk.id);
      validateSecurityTaskStore(desk?.data, `Рабочий стол «${desk?.name || index + 1}»`, problems);
      validateSecurityEventStore(desk?.data?.events, `Рабочий стол «${desk?.name || index + 1}»: календарь`, problems);
    });
    return problems;
  }

  function securityIntegritySummary(problems = []) {
    const bad = problems.filter(p => p.level === "bad").length;
    const warn = problems.filter(p => p.level !== "bad").length;
    const status = problems.length ? `Найдено проблем: ${problems.length} (${bad} критичных, ${warn} предупреждений).` : "Проверка завершена. Ошибок не найдено.";
    const outcome = bad ? "bad" : warn ? "warn" : "ok";
    return { bad, warn, status, outcome };
  }

  async function runSecurityIntegrityModel(options = {}) {
    const {
      state = {},
      nativeMode = false,
      readPrimaryStateRecord = async () => null,
      readSmallSettings = () => null,
      readLegacyState = () => null,
      readRestorePoints = async () => [],
      collectSecuritySnapshot = async () => ({}),
      persist = false,
      persistStatus = () => {},
      now = () => Date.now()
    } = options;
    const problems = [];
    try {
      const record = await readPrimaryStateRecord();
      if (!record?.state) addIntegrityProblem(problems, "bad", nativeMode ? "Основная запись ZeTer OS в data/zeter-os-state.json не найдена или пуста." : "Основная запись ZeTer OS в IndexedDB не найдена или пуста.", "primary-missing");
      else {
        try { JSON.stringify(record.state); }
        catch { addIntegrityProblem(problems, "bad", "Основное состояние ОС невозможно сериализовать для бэкапа.", "primary-json"); }
      }
    } catch (err) {
      addIntegrityProblem(problems, "bad", `${nativeMode ? "Не удалось прочитать data/zeter-os-state.json" : "Не удалось прочитать основное хранилище IndexedDB"}: ${err?.message || err}.`, "primary-read");
    }

    try {
      const small = readSmallSettings();
      if (small) JSON.parse(small);
    } catch {
      addIntegrityProblem(problems, "warn", "Служебные маленькие настройки в localStorage повреждены.", "small-settings-json");
    }
    try {
      const legacy = readLegacyState();
      if (legacy) JSON.parse(legacy);
    } catch {
      addIntegrityProblem(problems, "warn", "Старый ключ полного состояния в localStorage повреждён.", "legacy-json");
    }

    validateSecurityFileSystem(state.fs, {
      desktopRoots: (state.desktops || []).map(desk => desk?.id).filter(Boolean)
    }, problems);
    validateSecurityTaskStore(state, "Приложение «Задачи»", problems);
    validateSecurityEventStore(state.events, "Календарь", problems);
    validateSecurityDesktopStores(state.desktops, problems);

    try {
      const points = await readRestorePoints();
      points.forEach((point, index) => {
        if (!point?.state || !point.state.fs) addIntegrityProblem(problems, "warn", `Точка восстановления #${index + 1} повреждена или не содержит состояние ОС.`, "restore-bad", point?.id || "");
      });
    } catch (err) {
      addIntegrityProblem(problems, "warn", `Не удалось прочитать точки восстановления: ${err?.message || err}.`, "restore-read");
    }

    const snapshot = await collectSecuritySnapshot();
    if (snapshot.risk?.tone === "bad") addIntegrityProblem(problems, "bad", `Риск переполнения хранилища: ${snapshot.risk.label}. ${snapshot.risk.text}`, "storage-risk");
    else if (snapshot.risk?.tone === "warn") addIntegrityProblem(problems, "warn", `Риск переполнения хранилища: ${snapshot.risk.label}. ${snapshot.risk.text}`, "storage-risk");

    const { bad, warn, status, outcome } = securityIntegritySummary(problems);
    const checkedAt = now();
    if (persist) persistStatus(status, checkedAt, outcome, bad, warn);
    return { problems, bad, warn, status, outcome, checkedAt };
  }

  function repairSafeSecurityState(targetState, options = {}) {
    const {
      trashRoot = TRASH_ROOT,
      isDesktopRoot = () => false,
      desktopRoot = "desktop",
      uid = prefix => `${prefix}-${Date.now()}`,
      todayISO = () => new Date().toISOString().slice(0, 10),
      normalizeTaskStore = () => {},
      normalizeCalendarStore = () => {},
      normalizeNotificationStore = () => {},
      now = () => Date.now()
    } = options;
    let changed = 0;
    const state = targetState || {};
    const fs = state.fs || {};
    Object.entries(fs).forEach(([key, item]) => {
      if (!item || typeof item !== "object") return;
      if (!item.id) { item.id = key; changed++; }
      if (!String(item.name || "").trim()) { item.name = item.type === "folder" ? "Новая папка" : "Без названия"; changed++; }
      const parent = item.parent;
      const parentOk = parent === trashRoot || isDesktopRoot(parent) || Boolean(fs[parent]);
      if (!parentOk) { item.parent = item.deletedAt ? trashRoot : desktopRoot; changed++; }
      if (item.deletedAt && item.parent === trashRoot && !item.originalParent) { item.originalParent = desktopRoot; changed++; }
    });

    const fixTask = task => {
      if (!task || typeof task !== "object") return;
      if (!task.id) { task.id = uid("task"); changed++; }
      if (!String(task.title || "").trim()) { task.title = "Без названия"; changed++; }
      task.updatedAt = now();
    };
    (Array.isArray(state.tasks) ? state.tasks : []).forEach(fixTask);
    Object.values(fs).forEach(item => {
      if (item?.type === "tasklist" && Array.isArray(item.tasks)) item.tasks.forEach(fixTask);
    });
    const normalizeStoreAndCount = store => {
      if (!store || typeof store !== "object") return;
      const before = JSON.stringify({ tasks: store.tasks, taskProjects: store.taskProjects, activeTaskProjectId: store.activeTaskProjectId, events: store.events, notifications: store.notifications });
      normalizeTaskStore(store);
      normalizeCalendarStore(store);
      normalizeNotificationStore(store);
      const after = JSON.stringify({ tasks: store.tasks, taskProjects: store.taskProjects, activeTaskProjectId: store.activeTaskProjectId, events: store.events, notifications: store.notifications });
      if (before !== after) changed++;
    };
    normalizeStoreAndCount(state);
    Object.values(fs).forEach(item => {
      if (item?.type === "tasklist") normalizeStoreAndCount(item);
    });
    (state.desktops || []).forEach(desk => normalizeStoreAndCount(desk?.data));

    const fixEvent = event => {
      if (!event || typeof event !== "object") return;
      if (!event.id) { event.id = uid("event"); changed++; }
      if (!String(event.title || "").trim()) { event.title = "Без названия"; changed++; }
      if (!event.date) { event.date = todayISO(); changed++; }
      event.updatedAt = now();
    };
    (Array.isArray(state.events) ? state.events : []).forEach(fixEvent);
    return changed;
  }

  window.ZETER_SECURITY_UTILS = Object.freeze({
    normalizeSecurityMeta,
    securityBackupFileName,
    formatSecurityTime,
    securityStatusLabel,
    securityProtectionReadiness,
    securityRiskFromPercent,
    securityStorageRiskModel,
    collectExternalSaveSnapshotModel,
    collectSecuritySnapshotModel,
    addIntegrityProblem,
    validateSecurityTaskStore,
    validateSecurityEventStore,
    validateSecurityFileSystem,
    validateSecurityDesktopStores,
    securityIntegritySummary,
    runSecurityIntegrityModel,
    repairSafeSecurityState
  });
})();
