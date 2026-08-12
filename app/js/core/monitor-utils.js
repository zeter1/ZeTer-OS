(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS monitor utils require core utils.");

  const { escapeHtml, clamp, pad, bytesToHuman } = coreUtils;

  function monitorAlerts({
    originPct,
    statePct,
    heapPct,
    fps,
    lag,
    online,
    nativeMode,
    storageFallback = false,
    system = {},
    systemError = "",
    systemLoading = false
  } = {}) {
    const alerts = [];
    if (nativeMode && systemError) alerts.push({ type: "bad", title: "Метрики Windows недоступны", text: systemError });
    else if (nativeMode && !system.available && systemLoading) alerts.push({ type: "warn", title: "Идёт первый замер", text: "CPU Windows вычисляется по двум последовательным измерениям." });
    else if (nativeMode && system.stale) alerts.push({ type: "warn", title: "Системный замер устарел", text: "Автообновление задержалось более чем на 12 секунд. Нажми «Обновить сейчас»." });
    if (system.cpuAveragePct > 92) alerts.push({ type: "bad", title: "CPU перегружен", text: `Средняя загрузка за последние замеры — ${Math.round(system.cpuAveragePct)}%.` });
    else if (system.cpuAveragePct > 80) alerts.push({ type: "warn", title: "Высокая загрузка CPU", text: `Средняя загрузка за последние замеры — ${Math.round(system.cpuAveragePct)}%.` });
    if (system.memoryPct > 92) alerts.push({ type: "bad", title: "Почти закончилась RAM", text: `Windows использует ${Math.round(system.memoryPct)}% оперативной памяти.` });
    else if (system.memoryPct > 82) alerts.push({ type: "warn", title: "Мало свободной RAM", text: `Windows использует ${Math.round(system.memoryPct)}% оперативной памяти.` });
    if (system.diskLevel === "bad") alerts.push({ type: "bad", title: "На диске данных мало места", text: `Свободно ${system.diskFreeText || "очень мало"}. Освободи место до создания бэкапа или импорта файлов.` });
    else if (system.diskLevel === "warn") alerts.push({ type: "warn", title: "Диск данных заполняется", text: `Свободно ${system.diskFreeText || "мало места"}.` });
    if (!online) alerts.push({ type: "warn", title: "Нет сети", text: nativeMode ? "Windows-приложение продолжит работать офлайн, но сетевые функции недоступны." : "Браузер считает подключение офлайн." });
    if (storageFallback && !nativeMode) alerts.push({ type: "bad", title: "IndexedDB недоступен", text: "ZeTer OS временно сохраняет полный бэкап в localStorage. Освободи место или проверь настройки браузера." });
    if (!nativeMode && originPct != null && originPct > 85) alerts.push({ type: "bad", title: "Хранилище почти заполнено", text: `Использовано ${Math.round(originPct)}% квоты браузера.` });
    else if (!nativeMode && originPct != null && originPct > 65) alerts.push({ type: "warn", title: "Хранилище растёт", text: `Использовано ${Math.round(originPct)}% квоты браузера.` });
    if (!nativeMode && statePct != null && statePct > 85) alerts.push({ type: "bad", title: "Состояние ОС слишком большое", text: `Данные ZeTer OS занимают ${Math.round(statePct)}% доступной квоты.` });
    else if (!nativeMode && statePct != null && statePct > 65) alerts.push({ type: "warn", title: "Состояние ОС растёт", text: `Данные ZeTer OS занимают ${Math.round(statePct)}% доступной квоты.` });
    if (heapPct != null && heapPct > 80) alerts.push({ type: "bad", title: "Высокое потребление памяти вкладкой", text: `JS Heap использует ${Math.round(heapPct)}% лимита.` });
    else if (heapPct != null && heapPct > 60) alerts.push({ type: "warn", title: "Память вкладки растёт", text: `JS Heap использует ${Math.round(heapPct)}% лимита.` });
    if (fps && fps < 25) alerts.push({ type: "bad", title: "Интерфейс тормозит", text: `FPS упал до ${fps}. Закрой лишние окна.` });
    else if (fps && fps < 45) alerts.push({ type: "warn", title: "FPS ниже идеального", text: `Сейчас около ${fps} fps.` });
    if (lag > 180) alerts.push({ type: "bad", title: "Большая задержка JS", text: `Главный поток задерживается на ${lag} мс.` });
    else if (lag > 70) alerts.push({ type: "warn", title: "Есть микрозависания", text: `Задержка JS около ${lag} мс.` });
    return alerts;
  }

  function monitorCard(label, value, sub, kind = "") {
    return `<div class="monitor-card ${kind}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(sub)}</small></div>`;
  }

  function monitorAlertsHTML(alerts = []) {
    if (!alerts.length) {
      return `<div class="monitor-alert good"><b>Стабильно</b><span>Критичных проблем сейчас не видно.</span></div>`;
    }
    return alerts.map(alert => `<div class="monitor-alert ${escapeHtml(alert.type || "warn")}"><b>${escapeHtml(alert.title || "")}</b><span>${escapeHtml(alert.text || "")}</span></div>`).join("");
  }

  function meterBar(label, value, sub, pctValue, level = "ok") {
    const p = Number.isFinite(pctValue) ? clamp(Math.round(pctValue), 0, 100) : 0;
    const percentText = Number.isFinite(pctValue) ? `${Math.round(pctValue)}%` : "";
    return `<div class="monitor-meter ${level}"><div class="monitor-meter-head"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)} ${percentText ? `· ${percentText}` : ""}</span></div><div class="monitor-meter-track"><i style="width:${p}%"></i></div><small>${escapeHtml(sub)}</small></div>`;
  }

  function kv(k, v) {
    return `<div class="monitor-kv-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`;
  }

  function percent(used, total) {
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
    return (used / total) * 100;
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}ч ${pad(m)}м`;
    if (m) return `${m}м ${pad(sec)}с`;
    return `${sec}с`;
  }

  function pushHistory(arr, value, max, limit = 28) {
    if (!Number.isFinite(value)) return;
    arr.push(Math.min(max, Math.max(0, value)));
    while (arr.length > limit) arr.shift();
  }

  function createMonitorRuntime(startedAt = performance.now()) {
    return {
      live: {
        fps: null,
        lag: 0,
        storage: null,
        battery: null,
        uaMemory: null,
        persisted: null,
        gpu: null,
        isBrave: null,
        storageUpdatedAt: null,
        system: null,
        systemError: "",
        systemUpdatedAt: null,
        systemLoading: false
      },
      history: { fps: [], lag: [], storage: [], systemCpu: [], systemMemory: [] },
      startedAt,
      frameCount: 0,
      frameStarted: startedAt,
      lastLagTick: startedAt
    };
  }

  function tickMonitorFps(runtime = {}, now = performance.now()) {
    const live = runtime.live || {};
    const history = runtime.history || {};
    runtime.frameCount = (Number(runtime.frameCount) || 0) + 1;
    const frameStarted = Number.isFinite(Number(runtime.frameStarted)) ? Number(runtime.frameStarted) : now;
    if (now - frameStarted >= 1000) {
      live.fps = Math.round(runtime.frameCount * 1000 / (now - frameStarted));
      pushHistory(history.fps || [], live.fps, 60);
      runtime.frameCount = 0;
      runtime.frameStarted = now;
    }
    return live.fps;
  }

  function tickMonitorLag(runtime = {}, now = performance.now()) {
    const live = runtime.live || {};
    const history = runtime.history || {};
    const lastLagTick = Number.isFinite(Number(runtime.lastLagTick)) ? Number(runtime.lastLagTick) : now;
    live.lag = Math.max(0, Math.round(now - lastLagTick - 1000));
    pushHistory(history.lag || [], live.lag, 250);
    runtime.lastLagTick = now;
    return live.lag;
  }

  async function readMonitorAsyncMetrics(runtime = {}, options = {}) {
    const live = runtime.live || {};
    const history = runtime.history || {};
    const shouldReadNative = Boolean(options.nativeMode && typeof options.readNativeSystemMetrics === "function" && !live.systemLoading);
    if (shouldReadNative) live.systemLoading = true;
    try {
      if (navigator.storage?.estimate) {
        live.storage = await navigator.storage.estimate();
        live.storageUpdatedAt = Date.now();
        if (live.storage?.quota) pushHistory(history.storage || [], percent(live.storage.usage || 0, live.storage.quota) || 0, 100);
      }
    } catch {}
    try { if (navigator.storage?.persisted) live.persisted = await navigator.storage.persisted(); } catch {}
    try {
      if (navigator.getBattery) {
        const battery = await navigator.getBattery();
        live.battery = {
          level: Math.round((battery.level || 0) * 100),
          charging: battery.charging,
          chargingTime: battery.chargingTime,
          dischargingTime: battery.dischargingTime
        };
      }
    } catch {}
    try {
      if (performance.measureUserAgentSpecificMemory) {
        const mem = await performance.measureUserAgentSpecificMemory();
        live.uaMemory = mem?.bytes || null;
      }
    } catch {}
    try {
      if (navigator.brave?.isBrave) live.isBrave = await navigator.brave.isBrave();
    } catch {}
    if (!live.gpu) live.gpu = readGpuInfo();
    if (shouldReadNative) {
      try {
        const system = await options.readNativeSystemMetrics();
        live.system = system && typeof system === "object" ? system : null;
        live.systemError = "";
        live.systemUpdatedAt = Number(system?.sampledAt) || Date.now();
        pushHistory(history.systemCpu || [], system?.cpuPercent == null ? Number.NaN : Number(system.cpuPercent), 100);
        pushHistory(history.systemMemory || [], system?.memoryPercent == null ? Number.NaN : Number(system.memoryPercent), 100);
      } catch (error) {
        live.systemError = String(error?.message || error || "Неизвестная ошибка чтения системных метрик.");
      } finally {
        live.systemLoading = false;
      }
    }
    return live;
  }

  function sparkline(values, max = 100, invert = false) {
    const list = values.length ? values : Array(14).fill(0);
    return `<div class="monitor-sparkline">${list.map(v => {
      const h = clamp(Math.round((v / max) * 100), 4, 100);
      return `<i style="height:${invert ? Math.max(4, h) : h}%"></i>`;
    }).join("")}</div>`;
  }

  function readGpuInfo() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return null;
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) return { vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
      return { vendor: "WebGL", renderer: "WebGL доступен, подробности скрыты браузером" };
    } catch {
      return null;
    }
  }

  function browserName(isBrave) {
    const viewNavigator = typeof navigator !== "undefined" ? navigator : {};
    const ua = viewNavigator.userAgent || "";
    if (isBrave) return "Brave / Chromium";
    if (/Edg\//.test(ua)) return "Microsoft Edge";
    if (/OPR\//.test(ua)) return "Opera";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua)) return "Chromium/Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "неизвестно";
  }

  function monitorDeviceModel(live = {}) {
    const root = typeof window !== "undefined" ? window : {};
    const viewScreen = typeof screen !== "undefined" ? screen : {};
    const viewNavigator = typeof navigator !== "undefined" ? navigator : {};
    const screenWidth = viewScreen.width || "—";
    const screenHeight = viewScreen.height || "—";
    const windowWidth = root.innerWidth || "—";
    const windowHeight = root.innerHeight || "—";
    return {
      platform: viewNavigator.userAgentData?.platform || viewNavigator.platform || "неизвестно",
      browser: browserName(live.isBrave),
      cpuThreads: viewNavigator.hardwareConcurrency ? `${viewNavigator.hardwareConcurrency}` : "недоступно",
      deviceMemory: viewNavigator.deviceMemory ? `≈ ${viewNavigator.deviceMemory} ГБ` : "недоступно",
      screenText: `${screenWidth}×${screenHeight} @${root.devicePixelRatio || 1}x`,
      windowText: `${windowWidth}×${windowHeight}`,
      language: viewNavigator.language || "—",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "—",
      gpu: live.gpu?.renderer || "недоступно"
    };
  }

  function monitorNetworkModel(live = {}) {
    const viewNavigator = typeof navigator !== "undefined" ? navigator : {};
    const conn = viewNavigator.connection || viewNavigator.mozConnection || viewNavigator.webkitConnection;
    return {
      onlineText: typeof viewNavigator.onLine === "boolean" ? (viewNavigator.onLine ? "онлайн" : "оффлайн") : "недоступно",
      type: conn?.effectiveType || conn?.type || "недоступно",
      downlink: conn?.downlink ? `≈ ${conn.downlink} Мбит/с` : "недоступно",
      rtt: conn?.rtt ? `${conn.rtt} мс` : "недоступно",
      saveData: conn?.saveData ? "включена" : "нет",
      battery: live.battery ? `${live.battery.level}% · ${live.battery.charging ? "заряжается" : "от батареи"}` : "недоступно"
    };
  }

  function recentAverage(values = [], count = 3) {
    const recent = (Array.isArray(values) ? values : [])
      .slice(-count)
      .filter(Number.isFinite);
    if (!recent.length) return null;
    return recent.reduce((sum, value) => sum + value, 0) / recent.length;
  }

  function highUsageLevel(value, warnAt, badAt) {
    if (!Number.isFinite(value)) return "ok";
    if (value >= badAt) return "bad";
    if (value >= warnAt) return "warn";
    return "ok";
  }

  function monitorSystemModel(system = null, history = {}, options = {}) {
    const source = system && typeof system === "object" ? system : {};
    const memoryPct = source.memoryPercent == null ? null : (Number.isFinite(Number(source.memoryPercent)) ? Number(source.memoryPercent) : null);
    const diskPct = source.diskPercent == null ? null : (Number.isFinite(Number(source.diskPercent)) ? Number(source.diskPercent) : null);
    const cpuPct = source.cpuPercent == null ? null : Number(source.cpuPercent);
    const cpuAveragePct = recentAverage(history.systemCpu || [], 3);
    const diskTotalBytes = Number(source.diskTotalBytes) || 0;
    const diskFreeBytes = Number(source.diskFreeBytes) || 0;
    const diskFreePct = diskTotalBytes > 0 ? percent(diskFreeBytes, diskTotalBytes) : null;
    const diskLevel = (
      diskTotalBytes > 0 && (diskFreeBytes < 2 * 1024 ** 3 || diskFreePct < 5)
        ? "bad"
        : diskTotalBytes > 0 && (diskFreeBytes < 10 * 1024 ** 3 || diskFreePct < 10)
          ? "warn"
          : "ok"
    );
    const sampledAt = Number(source.sampledAt) || Number(options.updatedAt) || 0;
    return {
      available: Boolean(system && (Number(source.memoryTotalBytes) > 0 || Number(source.diskTotalBytes) > 0)),
      loading: Boolean(options.loading),
      error: String(options.error || ""),
      cpuPct: Number.isFinite(cpuPct) ? cpuPct : null,
      cpuAveragePct: Number.isFinite(cpuAveragePct) ? cpuAveragePct : (Number.isFinite(cpuPct) ? cpuPct : null),
      cpuLevel: highUsageLevel(Number.isFinite(cpuAveragePct) ? cpuAveragePct : cpuPct, 80, 92),
      logicalProcessors: Number(source.logicalProcessors) || 0,
      memoryPct,
      memoryLevel: highUsageLevel(memoryPct, 82, 92),
      memoryUsedText: Number(source.memoryTotalBytes) > 0
        ? `${bytesToHuman(Number(source.memoryUsedBytes) || 0)} / ${bytesToHuman(Number(source.memoryTotalBytes))}`
        : "Недоступно",
      memoryFreeText: Number(source.memoryAvailableBytes) >= 0 ? bytesToHuman(Number(source.memoryAvailableBytes)) : "Недоступно",
      diskPct,
      diskLevel,
      diskName: String(source.diskName || "диск с папкой data"),
      diskUsedText: diskTotalBytes > 0 ? `${bytesToHuman(Number(source.diskUsedBytes) || 0)} / ${bytesToHuman(diskTotalBytes)}` : "Недоступно",
      diskFreeText: diskTotalBytes > 0 ? bytesToHuman(diskFreeBytes) : "Недоступно",
      processMemoryText: Number(source.processMemoryBytes) > 0 ? bytesToHuman(Number(source.processMemoryBytes)) : "Недоступно",
      processCpuPct: source.processCpuPercent == null ? null : Number(source.processCpuPercent),
      uptimeText: Number(source.uptimeMs) >= 0 ? formatDuration(Number(source.uptimeMs)) : "Недоступно",
      osText: String(source.osName || "Windows"),
      osVersion: String(source.osVersion || "—"),
      architecture: String(source.architecture || "—"),
      pythonVersion: String(source.pythonVersion || "—"),
      sampledAt,
      stale: Boolean(sampledAt && Date.now() - sampledAt > 12000),
      updatedAtText: sampledAt ? new Date(sampledAt).toLocaleTimeString("ru-RU") : "—"
    };
  }

  function monitorHealthModel({ alerts = [], nativeMode = false, system = {} } = {}) {
    const badCount = alerts.filter(alert => alert?.type === "bad").length;
    const warnCount = alerts.filter(alert => alert?.type === "warn").length;
    if (nativeMode && !system.available && !system.error) {
      return {
        tone: "checking",
        title: "Собираем данные",
        text: "Первый системный замер ещё не завершён.",
        badge: "ЗАМЕР"
      };
    }
    if (badCount) {
      return {
        tone: "bad",
        title: "Нужно внимание",
        text: `${badCount} серьёзных предупреждений${warnCount ? ` · ещё ${warnCount} рекомендаций` : ""}.`,
        badge: `${badCount} крит.`
      };
    }
    if (warnCount) {
      return {
        tone: "warn",
        title: "Есть рекомендации",
        text: `${warnCount} предупреждений без немедленной угрозы данным.`,
        badge: `${warnCount} предупр.`
      };
    }
    if (nativeMode && !system.available) {
      return {
        tone: "checking",
        title: "Собираем данные",
        text: system.error || "Первый системный замер ещё не завершён.",
        badge: "ЗАМЕР"
      };
    }
    return {
      tone: "good",
      title: "Система работает стабильно",
      text: "По текущим измерениям критичных проблем не видно.",
      badge: "НОРМА"
    };
  }

  function monitorDiagnosticReport(model = {}, now = Date.now()) {
    const system = model.system || {};
    const resources = model.resources || {};
    const storage = model.storage || {};
    const network = model.network || {};
    const overview = model.overview || {};
    const alerts = Array.isArray(model.alerts) ? model.alerts : [];
    const metric = value => Number.isFinite(value) ? `${Math.round(value * 10) / 10}%` : "недоступно";
    const lines = [
      "ZeTer OS — диагностический отчёт",
      `Время: ${new Date(now).toLocaleString("ru-RU")}`,
      `Режим: ${model.nativeMode ? "Windows-приложение" : "браузер"}`,
      "",
      "Система",
      `CPU Windows: ${metric(system.cpuPct)} (среднее: ${metric(system.cpuAveragePct)})`,
      `Оперативная память: ${metric(system.memoryPct)} · ${system.memoryUsedText || "недоступно"} · свободно ${system.memoryFreeText || "недоступно"}`,
      `Диск данных: ${metric(system.diskPct)} · свободно ${system.diskFreeText || "недоступно"}`,
      `Процесс ZeTer OS: RAM ${system.processMemoryText || "недоступно"} · CPU ${metric(system.processCpuPct)}`,
      `Время работы Windows: ${system.uptimeText || "недоступно"}`,
      "",
      "Интерфейс ZeTer OS",
      `FPS: ${resources.fps || "недоступно"} · задержка: ${resources.lag ?? "недоступно"} мс`,
      `Состояние: ${bytesToHuman(storage.stateBytes || 0)} · ошибка сохранения: ${storage.lastErrorText || "нет"}`,
      `Открыто окон: ${overview.openWindowsCount || 0} · непрочитанных уведомлений: ${overview.unreadNotifications || 0}`,
      `Сеть: ${network.onlineText || "недоступно"}`,
      "",
      alerts.length ? "Предупреждения:" : "Предупреждения: нет",
      ...alerts.map(alert => `- ${alert.title}: ${alert.text}`)
    ];
    return lines.join("\n");
  }

  function monitorVisibleItems(items = []) {
    return (Array.isArray(items) ? items : []).filter(item => item && !item.hiddenFromDesktop && !item.hiddenInExplorer && !item.systemRole);
  }

  function monitorImportedBytes(items = []) {
    return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + (Number(item?.size) || 0), 0);
  }

  function monitorLastChangedAt(items = [], tasks = [], events = []) {
    return Math.max(
      0,
      ...(Array.isArray(items) ? items : []).map(item => Number(item?.updatedAt || item?.createdAt || 0)),
      ...(Array.isArray(tasks) ? tasks : []).map(task => Number(task?.updatedAt || task?.createdAt || 0)),
      ...(Array.isArray(events) ? events : []).map(event => Number(event?.updatedAt || event?.createdAt || 0))
    );
  }

  function monitorOverviewModel(options = {}) {
    const {
      visibleItems = [],
      tasks = [],
      events = [],
      notifications = [],
      openWindows = [],
      apps = {},
      today = "",
      occursOn = () => false,
      uptimeMs = 0,
      domNodes = 0
    } = options;
    const safeItems = Array.isArray(visibleItems) ? visibleItems : [];
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const safeEvents = Array.isArray(events) ? events : [];
    const safeNotifications = Array.isArray(notifications) ? notifications : [];
    const safeOpenWindows = Array.isArray(openWindows) ? openWindows : [];
    return {
      visibleItems: safeItems.length,
      files: safeItems.filter(item => !["folder", "app"].includes(item.type)).length,
      folders: safeItems.filter(item => item.type === "folder").length,
      appsCount: safeItems.filter(item => item.type === "app").length,
      openWindowsCount: safeOpenWindows.length,
      openWindowNamesText: safeOpenWindows.length ? safeOpenWindows.map(win => apps[win.appId]?.name || win.appId).join(", ") : "",
      tasksCount: safeTasks.length,
      tasksDone: safeTasks.filter(task => task.status === "done").length,
      tasksDoing: safeTasks.filter(task => task.status === "doing").length,
      todayEvents: safeEvents.filter(event => occursOn(event, today)).length,
      eventsTotal: safeEvents.length,
      notificationsTotal: safeNotifications.length,
      unreadNotifications: safeNotifications.filter(notification => !notification.read).length,
      uptimeText: formatDuration(uptimeMs),
      domNodes
    };
  }

  function monitorResourcesModel(options = {}) {
    const {
      fps = 0,
      lag = 0,
      mem = null,
      uaMemory = null,
      nativeMode = false
    } = options;
    const heapPct = mem?.jsHeapSizeLimit ? percent(mem.usedJSHeapSize, mem.jsHeapSizeLimit) : null;
    const committedPct = mem?.jsHeapSizeLimit ? percent(mem.totalJSHeapSize, mem.jsHeapSizeLimit) : null;
    return {
      fps,
      fpsPct: Math.min(100, Math.round((fps / 60) * 100)),
      fpsLevel: fps < 25 ? "bad" : fps < 45 ? "warn" : "ok",
      lag,
      lagPct: Math.min(100, Math.round((lag / 250) * 100)),
      lagLevel: lag > 180 ? "bad" : lag > 70 ? "warn" : "ok",
      heapUsedText: mem ? `${bytesToHuman(mem.usedJSHeapSize)} / ${bytesToHuman(mem.jsHeapSizeLimit)}` : "Недоступно",
      heapUsedSub: mem ? "реальная память вкладки из performance.memory" : nativeMode ? "WebView не отдаёт эту метрику" : "браузер не отдаёт эту метрику",
      heapPct,
      heapLevel: heapPct > 80 ? "bad" : heapPct > 60 ? "warn" : "ok",
      heapTotalText: mem ? `${bytesToHuman(mem.totalJSHeapSize)}` : "Недоступно",
      heapTotalSub: uaMemory ? `память вкладки: ${bytesToHuman(uaMemory)}` : "зарезервированная память JS-движка",
      committedPct,
      committedLevel: committedPct > 80 ? "bad" : committedPct > 60 ? "warn" : "ok"
    };
  }

  function monitorStorageModel(options = {}) {
    const {
      nativeMode = false,
      storage = null,
      storageUpdatedAt = 0,
      storageRuntime = {},
      stateBytes = 0,
      importedBytes = 0,
      lastChangedAt = 0
    } = options;
    const quota = storage?.quota || 0;
    const statePct = nativeMode ? null : (quota ? percent(stateBytes, quota) : null);
    const originPct = nativeMode ? null : (quota ? percent(storage?.usage || 0, quota) : null);
    return {
      dataFolderBytes: nativeMode ? Number(storageRuntime.usage || stateBytes || 0) : 0,
      originText: storage ? `${bytesToHuman(storage.usage || 0)} / ${bytesToHuman(storage.quota || 0)}` : "Недоступно",
      originPct,
      originLevel: originPct > 85 ? "bad" : originPct > 65 ? "warn" : "ok",
      stateBytes,
      statePct,
      stateLevel: statePct > 85 ? "bad" : statePct > 65 ? "warn" : "ok",
      localSettingsBytes: storageRuntime.localSettingsBytes || 0,
      localSettingsPct: (!nativeMode && quota) ? percent(storageRuntime.localSettingsBytes || 0, quota) : null,
      importedBytes,
      importedPct: (!nativeMode && quota) ? percent(importedBytes, quota) : null,
      primaryStorageText: nativeMode ? "data/zeter-os-state.json" : (storageRuntime.fallback ? "localStorage, аварийный режим" : "IndexedDB"),
      lastSavedAtText: storageRuntime.lastSavedAt ? new Date(storageRuntime.lastSavedAt).toLocaleString("ru-RU") : "ещё не записано",
      lastErrorText: storageRuntime.lastError || "нет",
      persistenceText: nativeMode ? "data рядом с программой" : (options.persisted === null ? "проверяется" : (options.persisted ? "включено" : "обычный режим")),
      lastChangedText: lastChangedAt ? new Date(lastChangedAt).toLocaleString("ru-RU") : "нет данных",
      updatedAtText: storageUpdatedAt ? new Date(storageUpdatedAt).toLocaleTimeString("ru-RU") : "—"
    };
  }

  function monitorAppHTML(model = {}) {
    const {
      nativeMode = false,
      alerts = [],
      health = {},
      overview = {},
      resources = {},
      storage = {},
      system = {},
      device = {},
      network = {},
      history = {}
    } = model;
    const monitorSubtitle = nativeMode
      ? "Реальные метрики Windows, процесса ZeTer OS, интерфейса и папки data."
      : "Живые данные браузера, текущего рабочего стола и хранилища.";
    const noteText = nativeMode
      ? "Метрики Windows читаются локально через Python без отправки данных в интернет. Краткие всплески CPU оцениваются по среднему из трёх последних замеров, чтобы не создавать ложную тревогу."
      : "Важно: браузер не даёт веб-приложению реальный процент загрузки CPU Windows и полную RAM системы. Вместо фейковых чисел здесь показаны доступные реальные метрики: FPS, задержка JS-потока, память вкладки, Storage, сеть, батарея и параметры устройства.";
    const primaryCards = nativeMode
      ? `
        ${monitorCard("CPU Windows", Number.isFinite(system.cpuPct) ? `${Math.round(system.cpuPct)}%` : "замер…", Number.isFinite(system.cpuAveragePct) ? `среднее: ${Math.round(system.cpuAveragePct)}%` : `${system.logicalProcessors || "—"} логических потоков`, system.cpuLevel || "ok")}
        ${monitorCard("Оперативная память", Number.isFinite(system.memoryPct) ? `${Math.round(system.memoryPct)}%` : "недоступно", system.memoryUsedText || "ожидание метрики", system.memoryLevel || "ok")}
        ${monitorCard(`Диск ${system.diskName || "data"}`, Number.isFinite(system.diskPct) ? `${Math.round(system.diskPct)}%` : "недоступно", `свободно ${system.diskFreeText || "—"}`, system.diskLevel || "ok")}
        ${monitorCard("Процесс ZeTer OS", system.processMemoryText || "недоступно", `CPU: ${Number.isFinite(system.processCpuPct) ? `${system.processCpuPct}%` : "замер…"}`, "process")}
        ${monitorCard("Интерфейс", resources.fps ? `${resources.fps} fps` : "замер…", `задержка ${resources.lag ?? 0} мс`, resources.fpsLevel || "ok")}
        ${monitorCard("Время работы Windows", system.uptimeText || "недоступно", `ZeTer OS: ${overview.uptimeText || "0с"}`, "uptime")}`
      : `
        ${monitorCard("Элементов", overview.visibleItems ?? 0, `${overview.files ?? 0} файлов · ${overview.folders ?? 0} папок · ${overview.appsCount ?? 0} приложений`, "files")}
        ${monitorCard("Окон открыто", overview.openWindowsCount ?? 0, overview.openWindowNamesText || "Нет активных окон", "windows")}
        ${monitorCard("Задач", overview.tasksCount ?? 0, `${overview.tasksDone ?? 0} готово · ${overview.tasksDoing ?? 0} в работе`, "tasks")}
        ${monitorCard("Сегодня событий", overview.todayEvents ?? 0, `Всего в календаре: ${overview.eventsTotal ?? 0}`, "events")}
        ${monitorCard("Интерфейс", resources.fps ? `${resources.fps} fps` : "замер…", `задержка ${resources.lag ?? 0} мс`, resources.fpsLevel || "ok")}
        ${monitorCard("Время с запуска", overview.uptimeText || "0с", `DOM: ${overview.domNodes ?? 0} узлов`, "uptime")}`;

    return `
      <div class="monitor-top">
        <div><h2>Мониторинг ZeTer OS</h2><p class="muted">${escapeHtml(monitorSubtitle)}</p></div>
        <div class="monitor-live ${system.error ? "error" : ""}"><span></span>${system.error ? "ОШИБКА" : "LIVE"}</div>
      </div>
      <div class="monitor-health ${escapeHtml(health.tone || "checking")}">
        <div class="monitor-health-icon" aria-hidden="true">${health.tone === "bad" ? "!" : health.tone === "warn" ? "△" : health.tone === "good" ? "✓" : "…"}</div>
        <div><b>${escapeHtml(health.title || "Собираем данные")}</b><span>${escapeHtml(health.text || "Первый замер ещё не завершён.")}</span></div>
        <strong>${escapeHtml(health.badge || "ЗАМЕР")}</strong>
      </div>
      <div class="monitor-actions" aria-label="Действия монитора">
        <button type="button" class="primary" data-monitor-action="refresh"${system.loading ? " disabled" : ""}>↻ Обновить сейчас</button>
        <button type="button" data-monitor-action="copy-report">⧉ Скопировать отчёт</button>
        ${nativeMode ? `<button type="button" data-monitor-action="open-data">📁 Папка data</button><button type="button" data-monitor-action="open-logs">🧾 Журналы</button>` : ""}
        <button type="button" data-monitor-action="security">🛡️ Центр безопасности</button>
      </div>
      ${alerts.length ? `<div class="monitor-alerts">${monitorAlertsHTML(alerts)}</div>` : ""}
      <div class="monitor-stat-grid">${primaryCards}</div>
      <div class="monitor-layout">
        <section class="monitor-panel monitor-panel-wide">
          <div class="monitor-panel-head">
            <h3>${nativeMode ? "Ресурсы Windows" : "Системные метрики Windows"}</h3>
            <span>${nativeMode ? `обновлено ${escapeHtml(system.updatedAtText || "—")}` : "требуется Windows-режим"}</span>
          </div>
          ${nativeMode
            ? `
              ${meterBar("Процессор", Number.isFinite(system.cpuPct) ? `${system.cpuPct}%` : "первый замер", `${system.logicalProcessors || "—"} логических потоков · предупреждение после устойчивых 80%`, system.cpuPct, system.cpuLevel || "ok")}
              ${meterBar("Оперативная память", system.memoryUsedText || "Недоступно", `свободно ${system.memoryFreeText || "—"}`, system.memoryPct, system.memoryLevel || "ok")}
              ${meterBar(`Диск с папкой data (${system.diskName || "—"})`, system.diskUsedText || "Недоступно", `свободно ${system.diskFreeText || "—"} · предупреждение при менее 10 ГБ или 10%`, system.diskPct, system.diskLevel || "ok")}
              ${meterBar("CPU процесса ZeTer OS", Number.isFinite(system.processCpuPct) ? `${system.processCpuPct}%` : "первый замер", `RAM процесса: ${system.processMemoryText || "—"}`, system.processCpuPct, highUsageLevel(system.processCpuPct, 25, 50))}
              <div class="monitor-sparks">
                <div><b>CPU Windows · последние замеры</b>${sparkline(history.systemCpu || [], 100)}</div>
                <div><b>Оперативная память</b>${sparkline(history.systemMemory || [], 100)}</div>
              </div>
              <div class="monitor-kv monitor-kv-compact">
                ${kv("Операционная система", system.osText || "Windows")}
                ${kv("Архитектура", system.architecture || "—")}
                ${kv("Время работы Windows", system.uptimeText || "недоступно")}
                ${kv("Python runtime", system.pythonVersion || "—")}
              </div>`
            : `<p class="monitor-note">Запусти ZeTer OS через <b>run_zeter_os.py</b>, чтобы монитор увидел реальную загрузку CPU, общую RAM Windows, свободное место на диске и память процесса приложения. В браузере эти данные технически закрыты.</p>`}
        </section>
        <section class="monitor-panel">
          <h3>${nativeMode ? "Ресурсы WebView-движка" : "Ресурсы браузера"}</h3>
          ${meterBar("FPS интерфейса", `${resources.fps || "—"} fps`, "реальная частота отрисовки окна", resources.fpsPct, resources.fpsLevel || "ok")}
          ${meterBar("Задержка JS-потока", `${resources.lag ?? 0} мс`, "показывает зависания интерфейса", resources.lagPct, resources.lagLevel || "ok")}
          ${meterBar("JS Heap используется", resources.heapUsedText || "Недоступно", resources.heapUsedSub || (nativeMode ? "WebView не отдаёт эту метрику" : "браузер не отдаёт эту метрику"), resources.heapPct, resources.heapLevel || "ok")}
          ${meterBar("JS Heap выделено", resources.heapTotalText || "Недоступно", resources.heapTotalSub || "зарезервированная память JS-движка", resources.committedPct, resources.committedLevel || "ok")}
          <div class="monitor-sparks">
            <div><b>История FPS</b>${sparkline(history.fps || [], 60)}</div>
            <div><b>История задержки</b>${sparkline(history.lag || [], 250, true)}</div>
          </div>
        </section>
        <section class="monitor-panel">
          <h3>Хранилище</h3>
          ${nativeMode
            ? meterBar("Папка data", bytesToHuman(storage.dataFolderBytes || 0), "состояние, точки восстановления, backups и логи рядом с программой", null, "ok")
            : meterBar("Storage origin", storage.originText || "Недоступно", "реальная квота браузера для этого сайта", storage.originPct, storage.originLevel || "ok")}
          ${meterBar("Состояние ZeTer OS", bytesToHuman(storage.stateBytes || 0), storage.stateSub || (nativeMode ? "точный размер data/zeter-os-state.json" : "точный размер основного состояния в IndexedDB"), storage.statePct, storage.stateLevel || "ok")}
          ${meterBar("Маленькие настройки", bytesToHuman(storage.localSettingsBytes || 0), "localStorage хранит только лёгкие настройки и служебную диагностику", storage.localSettingsPct, "ok")}
          ${meterBar("Импортированные файлы", bytesToHuman(storage.importedBytes || 0), "сумма исходных размеров файлов внутри ZeTer OS", storage.importedPct, "ok")}
          <div class="monitor-kv">
            ${kv("Основное хранилище", storage.primaryStorageText || "—")}
            ${kv("Последнее сохранение", storage.lastSavedAtText || "ещё не записано")}
            ${kv("Ошибка хранилища", storage.lastErrorText || "нет")}
            ${kv(nativeMode ? "Папка данных" : "Постоянное хранилище", storage.persistenceText || "—")}
            ${kv("Последнее изменение", storage.lastChangedText || "нет данных")}
            ${kv("Обновлено", storage.updatedAtText || "—")}
          </div>
          <div class="monitor-sparks"><div><b>История Storage</b>${sparkline(history.storage || [], 100)}</div></div>
        </section>
        <section class="monitor-panel">
          <h3>Рабочее пространство ZeTer OS</h3>
          <div class="monitor-kv">
            ${kv("Файлы и папки", `${overview.files ?? 0} файлов · ${overview.folders ?? 0} папок`)}
            ${kv("Ярлыки приложений", `${overview.appsCount ?? 0}`)}
            ${kv("Открытые окна", overview.openWindowNamesText || "нет")}
            ${kv("Задачи", `${overview.tasksCount ?? 0} всего · ${overview.tasksDoing ?? 0} в работе · ${overview.tasksDone ?? 0} готово`)}
            ${kv("Календарь сегодня", `${overview.todayEvents ?? 0} событий`)}
            ${kv("Уведомления", `${overview.notificationsTotal ?? 0} всего · ${overview.unreadNotifications ?? 0} непрочитанных`)}
            ${kv("DOM интерфейса", `${overview.domNodes ?? 0} узлов`)}
          </div>
        </section>
        <section class="monitor-panel">
          <h3>${nativeMode ? "Устройство и WebView" : "Устройство и браузер"}</h3>
          <div class="monitor-kv">
            ${kv("Платформа", device.platform || "неизвестно")}
            ${kv(nativeMode ? "WebView-движок" : "Браузер", device.browser || "неизвестно")}
            ${kv("CPU потоки", device.cpuThreads || "недоступно")}
            ${kv("RAM устройства", device.deviceMemory || "недоступно")}
            ${kv("Экран", device.screenText || "—")}
            ${kv("Окно", device.windowText || "—")}
            ${kv("Язык", device.language || "—")}
            ${kv("Часовой пояс", device.timeZone || "—")}
            ${kv("GPU", device.gpu || "недоступно")}
          </div>
        </section>
        <section class="monitor-panel">
          <h3>Сеть и питание</h3>
          <div class="monitor-kv">
            ${kv("Сеть", network.onlineText || "недоступно")}
            ${kv("Тип сети", network.type || "недоступно")}
            ${kv("Скорость", network.downlink || "недоступно")}
            ${kv("Ping", network.rtt || "недоступно")}
            ${kv("Экономия трафика", network.saveData || "нет")}
            ${kv("Батарея", network.battery || "недоступно")}
          </div>
          <p class="monitor-note">${escapeHtml(noteText)}</p>
        </section>
      </div>`;
  }

  function securityStorageMetersHTML(model = {}) {
    const {
      nativeMode = false,
      stateBytes = 0,
      dataUsageBytes = 0,
      readableBytes = 0,
      readableFiles = 0,
      localSettingsBytes = 0,
      quota = 0,
      usage = 0,
      statePct = null,
      usagePct = null,
      riskTone = "ok"
    } = model;
    if (nativeMode) {
      return `
        ${meterBar("Состояние ZeTer OS", bytesToHuman(stateBytes), "data/zeter-os-state.json", null, "ok")}
        ${meterBar("Папка data", bytesToHuman(dataUsageBytes), "Суммарный размер data: состояние, точки восстановления, логи, backups и Windows-копии", null, "ok")}
        ${meterBar("Windows-открываемые файлы", bytesToHuman(readableBytes), `${readableFiles || 0} файлов · data/Рабочие столы`, null, "ok")}
        ${meterBar("Маленькие настройки интерфейса", bytesToHuman(localSettingsBytes), "localStorage используется только для лёгкой диагностики интерфейса", null, "ok")}`;
    }
    return `
      ${meterBar("Состояние ZeTer OS", bytesToHuman(stateBytes), "Реальный размер основного состояния ОС", statePct, riskTone)}
      ${meterBar("Всё хранилище сайта", quota ? `${bytesToHuman(usage)} / ${bytesToHuman(quota)}` : "Квота браузером не отдана", "IndexedDB, localStorage, кеш PWA и служебные данные", usagePct, riskTone)}
      ${meterBar("Маленькие настройки", bytesToHuman(localSettingsBytes), "localStorage используется только для небольших настроек и диагностики", quota ? percent(localSettingsBytes, quota) : null, "ok")}`;
  }

  function securityKvRowsHTML(model = {}) {
    const {
      nativeMode = false,
      dataFolder = "data",
      backupDir = "data/backups",
      readableDir = "data/Рабочие столы",
      logFile = "data/logs/zeter-os.log",
      lastLoadedText = "После запуска ещё не фиксировалась",
      lastCheckText = "Ещё не выполнялась",
      integrityStatus = "Проверка ещё не выполнялась",
      lastError = "Нет",
      browserStorageText = "IndexedDB",
      backupFolderText = "",
      persistenceText = "Обычный режим браузера"
    } = model;
    if (nativeMode) {
      return `
        ${kv("Основное хранилище", "data/zeter-os-state.json")}
        ${kv("Папка данных", dataFolder || "data")}
        ${kv("Точки восстановления", "data/restore-points.json")}
        ${kv("Резервные копии", backupDir || "data/backups")}
        ${kv("Windows-копии", readableDir || "data/Рабочие столы")}
        ${kv("Форматы", ".docx, .csv, .ics, изображения")}
        ${kv("Логи", logFile || "data/logs/zeter-os.log")}
        ${kv("Последняя загрузка", lastLoadedText)}
        ${kv("Последняя проверка", lastCheckText)}
        ${kv("Итог проверки", integrityStatus || "Проверка ещё не выполнялась")}
        ${kv("Последняя ошибка", lastError || "Нет")}`;
    }
    return `
      ${kv("Основное хранилище", browserStorageText)}
      ${kv("Последняя загрузка", lastLoadedText)}
      ${kv("Последняя проверка", lastCheckText)}
      ${kv("Итог проверки", integrityStatus || "Проверка ещё не выполнялась")}
      ${kv("Последняя ошибка", lastError || "Нет")}
      ${kv("Папка автосохранения", backupFolderText || "Папка не выбрана")}
      ${kv("Постоянство данных", persistenceText)}`;
  }

  function createMonitorApp(api) {
    const {
      document,
      requestAnimationFrame,
      setInterval,
      performance,
      navigator,
      apps,
      ui,
      getDesktopRoot,
      workspaceItems,
      deskTasks,
      deskEvents,
      deskNotifications,
      shouldUseNativeStorage,
      storedStateSizeBytes,
      storageRuntime,
      todayISO,
      occursOn
    } = api;
    const readNativeSystemMetrics = typeof api.readNativeSystemMetrics === "function" ? api.readNativeSystemMetrics : null;
    const openDataFolder = typeof api.openDataFolder === "function" ? api.openDataFolder : async () => {};
    const openLogsFolder = typeof api.openLogsFolder === "function" ? api.openLogsFolder : async () => {};
    const openApp = typeof api.openApp === "function" ? api.openApp : () => {};
    const copyText = typeof api.copyText === "function" ? api.copyText : async () => false;
    const toast = typeof api.toast === "function" ? api.toast : () => {};
    const root = document.createElement("div");
    root.className = "monitor-app";
    const runtime = createMonitorRuntime();
    const { live, history } = runtime;
    let lastModel = {};
    let asyncRead = null;

    const buildModel = () => {
      const rootId = getDesktopRoot();
      const visibleItems = monitorVisibleItems(workspaceItems(rootId));
      const tasks = deskTasks();
      const events = deskEvents();
      const openWins = Array.from(ui.windows.values()).filter(windowRecord => windowRecord.desktopId === rootId);
      const nativeMode = shouldUseNativeStorage();
      const stateBytes = storedStateSizeBytes();
      const resources = monitorResourcesModel({ fps: live.fps ?? 0, lag: live.lag, mem: performance.memory || null, uaMemory: live.uaMemory, nativeMode });
      const storage = monitorStorageModel({ nativeMode, storage: live.storage, storageUpdatedAt: live.storageUpdatedAt, storageRuntime, stateBytes, importedBytes: monitorImportedBytes(visibleItems), lastChangedAt: monitorLastChangedAt(visibleItems, tasks, events), persisted: live.persisted });
      const system = monitorSystemModel(live.system, history, {
        loading: live.systemLoading,
        error: live.systemError,
        updatedAt: live.systemUpdatedAt
      });
      const overview = monitorOverviewModel({
        visibleItems,
        tasks,
        events,
        notifications: deskNotifications(),
        openWindows: openWins,
        apps,
        today: todayISO(),
        occursOn,
        uptimeMs: performance.now() - runtime.startedAt,
        domNodes: document.querySelectorAll("*").length
      });
      const alerts = monitorAlerts({
        originPct: storage.originPct,
        statePct: storage.statePct,
        heapPct: resources.heapPct,
        fps: live.fps ?? 0,
        lag: live.lag,
        online: navigator.onLine,
        nativeMode,
        storageFallback: storageRuntime.fallback,
        system,
        systemError: live.systemError,
        systemLoading: live.systemLoading
      });
      return {
        nativeMode,
        alerts,
        health: monitorHealthModel({ alerts, nativeMode, system }),
        overview,
        resources,
        storage,
        system,
        device: monitorDeviceModel(live),
        network: monitorNetworkModel(live),
        history
      };
    };

    const draw = () => {
      lastModel = buildModel();
      root.innerHTML = monitorAppHTML(lastModel);
    };
    const raf = now => { if (!root.isConnected) return; tickMonitorFps(runtime, now); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const update = () => { if (!root.isConnected) return false; draw(); return true; };
    const lagTimer = setInterval(() => { if (!root.isConnected) return clearInterval(lagTimer); tickMonitorLag(runtime); }, 1000);
    const drawTimer = setInterval(() => { if (!update()) clearInterval(drawTimer); }, 1000);
    const readAsync = async () => {
      if (!root.isConnected) return;
      if (asyncRead) return asyncRead;
      asyncRead = readMonitorAsyncMetrics(runtime, {
        nativeMode: shouldUseNativeStorage(),
        readNativeSystemMetrics
      }).finally(() => { asyncRead = null; });
      await asyncRead;
      if (root.isConnected) draw();
    };

    root.addEventListener("click", async event => {
      const button = event.target.closest("[data-monitor-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.monitorAction;
      try {
        if (action === "refresh") {
          button.disabled = true;
          await readAsync();
          if (live.systemError) toast("Монитор не обновлён", live.systemError);
          else toast("Монитор обновлён", shouldUseNativeStorage() ? "Получен новый замер Windows." : "Получены свежие метрики браузера.");
        } else if (action === "copy-report") {
          const copied = await copyText(monitorDiagnosticReport(lastModel));
          if (copied) toast("Отчёт скопирован", "Его можно вставить в сообщение или сохранить в заметки.");
          else toast("Не удалось скопировать", "Разреши доступ к буферу обмена и повтори попытку.");
        } else if (action === "open-data") {
          await openDataFolder();
        } else if (action === "open-logs") {
          await openLogsFolder();
        } else if (action === "security") {
          openApp("security");
        }
      } catch (error) {
        toast("Действие не выполнено", error?.message || String(error));
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });

    readAsync();
    const asyncTimer = setInterval(() => { if (!root.isConnected) return clearInterval(asyncTimer); readAsync(); }, 3000);
    draw();
    return root;
  }

  window.ZETER_MONITOR_UTILS = Object.freeze({
    monitorAlerts,
    monitorAlertsHTML,
    monitorAppHTML,
    securityStorageMetersHTML,
    securityKvRowsHTML,
    monitorCard,
    meterBar,
    kv,
    percent,
    formatDuration,
    pushHistory,
    createMonitorRuntime,
    tickMonitorFps,
    tickMonitorLag,
    readMonitorAsyncMetrics,
    sparkline,
    readGpuInfo,
    browserName,
    monitorDeviceModel,
    monitorNetworkModel,
    recentAverage,
    highUsageLevel,
    monitorSystemModel,
    monitorHealthModel,
    monitorDiagnosticReport,
    monitorVisibleItems,
    monitorImportedBytes,
    monitorLastChangedAt,
    monitorOverviewModel,
    monitorResourcesModel,
    monitorStorageModel
    ,createMonitorApp
  });
})();
