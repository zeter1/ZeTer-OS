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
    systemLoading = false,
    activeAlertIds = []
  } = {}) {
    const alerts = [];
    if (nativeMode && systemError) alerts.push({ type: "bad", title: "Метрики Windows недоступны", text: systemError });
    else if (nativeMode && !system.available && systemLoading) alerts.push({ type: "warn", title: "Идёт первый замер", text: "CPU Windows вычисляется по двум последовательным измерениям." });
    else if (nativeMode && system.stale) alerts.push({ type: "warn", title: "Системный замер устарел", text: "Автообновление задержалось более чем на 12 секунд. Нажми «Обновить сейчас»." });
    if (!system.stale && !systemError) {
      if (system.cpuAveragePct > 92) alerts.push({ id: "cpu", type: "bad", title: "CPU перегружен", text: `Средняя загрузка за последние замеры — ${Math.round(system.cpuAveragePct)}%.`, advice: "Посмотри график и открой диспетчер задач Windows (Ctrl+Shift+Esc), чтобы найти потребителя CPU." });
      else if (system.cpuAveragePct > (activeAlertIds.includes("cpu") ? 75 : 80)) alerts.push({ id: "cpu", type: "warn", title: "Высокая загрузка CPU", text: `Средняя загрузка за последние замеры — ${Math.round(system.cpuAveragePct)}%.`, advice: "Сверь время роста нагрузки с выполняемыми операциями. Список процессов доступен в диспетчере задач Windows (Ctrl+Shift+Esc)." });
      if (system.memoryPct > 92) alerts.push({ id: "memory", type: "bad", title: "Почти закончилась RAM", text: `Windows использует ${Math.round(system.memoryPct)}% памяти · свободно ${system.memoryFreeText || "—"}.`, advice: "Открой диспетчер задач Windows (Ctrl+Shift+Esc) и отсортируй процессы по памяти. Сохрани работу перед закрытием ненужных программ." });
      else if (system.memoryPct > (activeAlertIds.includes("memory") ? 77 : 82)) alerts.push({ id: "memory", type: "warn", title: "Мало свободной RAM", text: `Windows использует ${Math.round(system.memoryPct)}% памяти · свободно ${system.memoryFreeText || "—"}.`, advice: "Высокая занятость сама по себе не доказывает причину торможения. Проверь динамику и потребителей памяти в диспетчере задач (Ctrl+Shift+Esc)." });
    }
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
    if (fps != null && fps < 25) alerts.push({ id: "fps", type: "bad", title: "Интерфейс тормозит", text: `Частота кадровых callbacks: ${fps} fps.`, advice: "Проверь график задержек. Сохрани работу и закрой ненужные окна ZeTer OS." });
    else if (fps != null && fps < (activeAlertIds.includes("fps") ? 50 : 45)) alerts.push({ id: "fps", type: "warn", title: "Низкая частота интерфейса", text: `Сейчас около ${fps} fps.`, advice: "Оцени вместе с задержками: частота зависит также от дисплея, видимости окна и энергосбережения." });
    if (lag > 180) alerts.push({ id: "lag", type: "bad", title: "Большая задержка JS", text: `Главный поток задерживается на ${lag} мс.`, advice: "Посмотри график задержек и приложи отчёт, если зависания повторяются." });
    else if (lag > (activeAlertIds.includes("lag") ? 40 : 70)) alerts.push({ id: "lag", type: "warn", title: "Есть микрозависания", text: `Задержка JS около ${lag} мс.`, advice: "Сопоставь задержки с текущими операциями и нагрузкой Windows." });
    return alerts;
  }

  function monitorCard(label, value, sub, kind = "") {
    return `<div class="monitor-card ${kind}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(sub)}</small></div>`;
  }

  function monitorAlertsHTML(alerts = []) {
    if (!alerts.length) {
      return `<div class="monitor-alert good"><b>Стабильно</b><span>Критичных проблем сейчас не видно.</span></div>`;
    }
    return alerts.map(alert => `<div class="monitor-alert ${escapeHtml(alert.type || "warn")}"><b>${escapeHtml(alert.title || "")}</b><span>${escapeHtml(alert.text || "")}</span>${alert.since != null ? `<small>Наблюдается с ${escapeHtml(new Date(alert.since).toLocaleTimeString("ru-RU"))}</small>` : ""}${alert.advice ? `<p>${escapeHtml(alert.advice)}</p><button type="button" data-monitor-action="resources">Посмотреть графики</button>` : ""}</div>`).join("");
  }

  function meterBar(label, value, sub, pctValue, level = "ok") {
    const p = Number.isFinite(pctValue) ? clamp(Math.round(pctValue), 0, 100) : 0;
    const percentText = Number.isFinite(pctValue) ? `${Math.round(pctValue)}%` : "";
    return `<div class="monitor-meter ${level}"><div class="monitor-meter-head"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)} ${percentText ? `· ${percentText}` : ""}</span></div>${Number.isFinite(pctValue) ? `<div class="monitor-meter-track"><i style="width:${p}%"></i></div>` : ""}<small>${escapeHtml(sub)}</small></div>`;
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
        lag: null,
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
      series: { cpu: [], memory: [], fps: [], lag: [] },
      alertStates: {},
      view: "overview",
      minutes: 1,
      startedAt,
      frameCount: 0,
      frameStarted: startedAt,
      lastLagTick: startedAt
    };
  }

  function recordMonitorSample(samples, at, value) {
    if (!Number.isFinite(at) || (samples.length && at <= samples[samples.length - 1].at)) return;
    samples.push({ at, value: Number.isFinite(value) && value >= 0 ? value : null });
    while (samples.length && (samples[0].at < at - 900000 || samples.length > 1200)) samples.shift();
  }

  function monitorTimelineModel(samples = [], { now = Date.now(), minutes = 1, gapMs = 7000 } = {}) {
    const duration = ([1, 5, 15].includes(Number(minutes)) ? Number(minutes) : 1) * 60000;
    const points = samples.filter(point => point.at >= now - duration && point.at <= now);
    const values = points.filter(point => Number.isFinite(point.value));
    const segments = [];
    let segment = null;
    let previous = null;
    for (const point of points) {
      if (!Number.isFinite(point.value)) { segment = null; previous = point; continue; }
      if (!segment || (previous && point.at - previous.at > gapMs)) { segment = []; segments.push(segment); }
      segment.push(point);
      previous = point;
    }
    return {
      points: values, segments, now, start: now - duration, duration,
      min: values.length ? Math.min(...values.map(point => point.value)) : null,
      max: values.length ? Math.max(...values.map(point => point.value)) : null,
      average: values.length ? Math.round(values.reduce((sum, point) => sum + point.value, 0) / values.length * 10) / 10 : null,
      latest: points.length && Number.isFinite(points[points.length - 1].value) && now - points[points.length - 1].at <= gapMs ? points[points.length - 1].value : null
    };
  }

  function monitorFreshness({ nativeMode = false, system = {}, hidden = false } = {}) {
    if (hidden) return { live: false, label: "ПАУЗА", tone: "paused" };
    if (nativeMode && system.error) return { live: false, label: "ОШИБКА ЗАМЕРА", tone: "error" };
    if (nativeMode && system.stale) return { live: false, label: "НЕТ СВЕЖИХ ДАННЫХ", tone: "paused" };
    if (nativeMode && !system.available) return { live: false, label: "ПЕРВЫЙ ЗАМЕР", tone: "paused" };
    return { live: true, label: "ЗАМЕРЫ АКТУАЛЬНЫ", tone: "" };
  }

  function monitorStableAlerts(runtime, candidates, { now = Date.now(), systemAt = 0, uiAt = 0, unavailable = false } = {}) {
    const states = runtime.alertStates;
    const ids = ["cpu", "memory", "fps", "lag"];
    const result = candidates.filter(alert => !ids.includes(alert.id));
    for (const id of ids) {
      const native = id === "cpu" || id === "memory";
      const at = native ? systemAt : uiAt;
      if ((native && unavailable) || !at) { delete states[id]; continue; }
      const candidate = candidates.find(alert => alert.id === id);
      const state = states[id] || (states[id] = { at: 0, since: at, active: null, pending: "", pendingSince: at });
      if (at !== state.at) {
        const gap = state.at && (at - state.at > (native ? 7000 : 3500) || at < state.at);
        // Continuity belongs to the resource, not its current severity: crossing
        // warn/bad must not indefinitely postpone a sustained overload warning.
        const next = candidate ? "load" : "clear";
        if (gap) { state.active = null; state.since = at; }
        if (gap || state.pending !== next) { state.pending = next; state.pendingSince = at; }
        if (candidate && !state.active && at - state.pendingSince >= 9000) state.since = state.pendingSince;
        if (at - state.pendingSince >= (candidate ? 9000 : 6000)) state.active = candidate ? { ...candidate, since: state.since } : null;
        else if (candidate && state.active?.type === candidate.type) state.active = { ...candidate, since: state.since };
        state.at = at;
      }
      if (state.active) result.push({ ...state.active, elapsed: Math.max(0, now - state.active.since) });
    }
    return result;
  }

  function monitorTimelineHTML(label, samples, options = {}) {
    const timeline = monitorTimelineModel(samples, options);
    const unit = options.unit || "%";
    const scale = Math.max(options.max || 100, timeline.max || 0, 1);
    const x = at => ((at - timeline.start) / timeline.duration * 600).toFixed(1);
    const y = value => (110 - value / scale * 100).toFixed(1);
    const time = at => new Date(at).toLocaleTimeString("ru-RU");
    const fmt = value => value == null ? "—" : `${Math.round(value * 10) / 10} ${unit}`;
    return `<div class="monitor-chart"><div class="monitor-panel-head"><h3>${escapeHtml(label)}</h3><b>${escapeHtml(fmt(timeline.latest))}</b></div>
      <div class="monitor-chart-scale"><span>Шкала: 0 — ${escapeHtml(fmt(scale))}</span></div>
      <svg viewBox="-5 0 610 120" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(`${label}: минимум ${fmt(timeline.min)}, среднее ${fmt(timeline.average)}, пик ${fmt(timeline.max)}`)}">
      <path class="monitor-chart-grid" d="M0 10H600 M0 60H600 M0 110H600"/>
      ${timeline.segments.map(segment => `<polyline points="${segment.map(point => `${x(point.at)},${y(point.value)}`).join(" ")}"/>`).join("")}
      ${timeline.points.map(point => `<circle cx="${x(point.at)}" cy="${y(point.value)}" r="3"><title>${escapeHtml(`${time(point.at)} · ${fmt(point.value)}`)}</title></circle>`).join("")}</svg>
      <div class="monitor-chart-axis"><span>${escapeHtml(time(timeline.start))}</span><span>${escapeHtml(time(timeline.now))}</span></div>
      <div class="monitor-chart-summary">Мин. ${escapeHtml(fmt(timeline.min))} · среднее ${escapeHtml(fmt(timeline.average))} · пик ${escapeHtml(fmt(timeline.max))}</div>
      ${!timeline.points.length ? `<p class="monitor-note">Пока нет измерений за выбранный период.</p>` : ""}</div>`;
  }

  function tickMonitorFps(runtime = {}, now = performance.now()) {
    const live = runtime.live || {};
    const history = runtime.history || {};
    runtime.frameCount = (Number(runtime.frameCount) || 0) + 1;
    const frameStarted = Number.isFinite(Number(runtime.frameStarted)) ? Number(runtime.frameStarted) : now;
    if (now - frameStarted >= 1000) {
      live.fps = Math.round(runtime.frameCount * 1000 / (now - frameStarted));
      pushHistory(history.fps || [], live.fps, Infinity);
      recordMonitorSample(runtime.series?.fps || [], Date.now(), live.fps);
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
    recordMonitorSample(runtime.series?.lag || [], Date.now(), live.lag);
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
        recordMonitorSample(runtime.series?.cpu || [], live.systemUpdatedAt, system?.cpuPercent);
        recordMonitorSample(runtime.series?.memory || [], live.systemUpdatedAt, system?.memoryPercent);
      } catch (error) {
        live.systemError = String(error?.message || error || "Неизвестная ошибка чтения системных метрик.");
        recordMonitorSample(runtime.series?.cpu || [], Date.now(), null);
        recordMonitorSample(runtime.series?.memory || [], Date.now(), null);
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
      memoryTotalText: Number(source.memoryTotalBytes) > 0 ? bytesToHuman(Number(source.memoryTotalBytes)) : "Недоступно",
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
      `Измерения: ${monitorFreshness(model).label} · последний замер Windows: ${system.sampledAt ? new Date(system.sampledAt).toLocaleString("ru-RU") : "недоступно"}`,
      "",
      "Система",
      `CPU Windows: ${metric(system.cpuPct)} (среднее: ${metric(system.cpuAveragePct)})`,
      `Оперативная память: ${metric(system.memoryPct)} · ${system.memoryUsedText || "недоступно"} · свободно ${system.memoryFreeText || "недоступно"}`,
      `Место на диске данных: занято ${metric(system.diskPct)} · свободно ${system.diskFreeText || "недоступно"}`,
      `Python-процесс ZeTer OS (без WebView): RAM ${system.processMemoryText || "недоступно"} · CPU ${metric(system.processCpuPct)}`,
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
    lines.push("", `Динамика за ${model.minutes || 1} мин (с момента открытия окна):`);
    for (const [key, label, unit] of [["cpu", "CPU Windows", "%"], ["memory", "RAM Windows", "%"], ["fps", "Частота интерфейса", "fps"], ["lag", "Задержка интерфейса", "мс"]]) {
      const stats = monitorTimelineModel(model.series?.[key] || [], { now, minutes: model.minutes || 1 });
      const value = number => number == null ? "недоступно" : `${number} ${unit}`;
      lines.push(`${label}: мин. ${value(stats.min)} · среднее ${value(stats.average)} · пик ${value(stats.max)} · замеров ${stats.points.length}`);
    }
    lines.push("FPS измеряет кадровые callbacks, а не реально показанные кадры. Пропуски измерений не считаются нулевой нагрузкой.");
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
      fps = null,
      lag = null,
      mem = null,
      uaMemory = null,
      nativeMode = false
    } = options;
    const heapPct = mem?.jsHeapSizeLimit ? percent(mem.usedJSHeapSize, mem.jsHeapSizeLimit) : null;
    const committedPct = mem?.jsHeapSizeLimit ? percent(mem.totalJSHeapSize, mem.jsHeapSizeLimit) : null;
    return {
      fps,
      fpsPct: Math.min(100, Math.round((fps / 60) * 100)),
      fpsLevel: fps == null ? "unknown" : fps < 25 ? "bad" : fps < 45 ? "warn" : "ok",
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
      hasSaveError: Boolean(storageRuntime.lastError),
      hasSaved: Boolean(storageRuntime.lastSavedAt),
      persistenceText: nativeMode ? "data рядом с программой" : (options.persisted === null ? "проверяется" : (options.persisted ? "включено" : "обычный режим")),
      lastChangedText: lastChangedAt ? new Date(lastChangedAt).toLocaleString("ru-RU") : "нет данных",
      updatedAtText: storageUpdatedAt ? new Date(storageUpdatedAt).toLocaleTimeString("ru-RU") : "—"
    };
  }

  function monitorAppHTML(model = {}) {
    const { nativeMode = false, alerts = [], health = {}, overview = {}, resources = {}, storage = {}, system = {}, device = {}, network = {}, history = {}, series = {}, view = "overview", minutes = 1, now = Date.now(), hidden = false } = model;
    const fresh = monitorFreshness({ nativeMode, system, hidden });
    const selected = ["overview", "resources", "data", "device"].includes(view) ? view : "overview";
    const number = (value, unit = "%") => Number.isFinite(value) ? `${Math.round(value)} ${unit}` : "—";
    const chartOptions = { now, minutes };
    const charts = nativeMode && ["overview", "resources"].includes(selected) ? [
      monitorTimelineHTML("CPU Windows", series.cpu || [], chartOptions),
      monitorTimelineHTML("Оперативная память", series.memory || [], chartOptions)
    ] : [];
    const uiCharts = (selected === "resources" || (!nativeMode && selected === "overview")) ? [
      monitorTimelineHTML("Частота интерфейса", series.fps || [], { ...chartOptions, max: 60, unit: "fps", gapMs: 3500 }),
      monitorTimelineHTML("Задержка интерфейса", series.lag || [], { ...chartOptions, max: 200, unit: "мс", gapMs: 3500 })
    ] : [];
    const period = `<div class="monitor-period" role="group" aria-label="Период графиков">${[1, 5, 15].map(value => `<button type="button" data-monitor-period="${value}" aria-pressed="${Number(minutes) === value}">${value} мин</button>`).join("")}</div>`;
    const card = (key, title, value, subtitle, tone = "") => `<button type="button" class="monitor-card ${escapeHtml(tone)}" data-monitor-card="${key}" data-monitor-action="resources"><span>${escapeHtml(title)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(subtitle)}</small><em>Открыть графики →</em></button>`;
    const mainAlert = alerts.find(alert => alert.type === "bad") || alerts[0];
    const noteText = nativeMode
      ? "Метрики Windows читаются локально, без отправки в интернет. Память Python не включает отдельные процессы WebView. История хранится только пока открыто это окно."
      : "Браузер не даёт сайту загрузку CPU Windows и полную RAM системы. Здесь показаны только доступные данные браузера; характеристики сети являются оценкой браузера, а не проверкой доступа к серверу.";
    const pending = Object.values(model.alertStates || {}).some(state => state.pending !== "clear" && !state.active);
    const detailMetric = (icon, label, value, hint) => `<div class="monitor-detail-metric"><span class="monitor-detail-icon" aria-hidden="true">${icon}</span><div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(hint)}</small></div></div>`;
    const detailTitle = (icon, title, subtitle) => `<div class="monitor-detail-title"><span class="monitor-detail-icon" aria-hidden="true">${icon}</span><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></div></div>`;
    const facts = entries => `<dl class="monitor-facts">${entries.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
    const saveState = storage.hasSaveError ? "error" : storage.hasSaved ? "saved" : "unknown";

    return `
      <div class="monitor-top"><div><h2>Монитор системы</h2><p class="muted">${nativeMode ? "Windows · ZeTer OS · сохранение данных" : "Интерфейс · хранилище · рабочее пространство"}</p></div></div>
      <div class="monitor-health ${fresh.live ? escapeHtml(health.tone || "checking") : "checking"}" data-monitor-status="${fresh.live ? "current" : hidden ? "paused" : system.error ? "error" : system.stale ? "stale" : "checking"}">
        <div class="monitor-health-icon" aria-hidden="true">${!fresh.live ? "…" : mainAlert ? "!" : "✓"}</div>
        <div><b>${escapeHtml(!fresh.live ? (system.error ? "Не удалось обновить измерения" : fresh.label) : mainAlert?.title || (pending ? "Проверяем устойчивость нагрузки" : "По текущим замерам отклонений не видно"))}</b><span>${escapeHtml(!fresh.live ? "Последние значения могут быть устаревшими. Обнови замер или дождись восстановления." : mainAlert?.text || (pending ? "Краткий всплеск ещё не считается устойчивой проблемой." : "Выбери показатель, чтобы посмотреть его динамику."))}</span></div>
        <strong>${escapeHtml(!fresh.live ? "ПРОВЕРКА" : mainAlert ? `${alerts.length} предупр.` : pending ? "НАБЛЮДЕНИЕ" : "НОРМА")}</strong>
      </div>
      <div class="monitor-actions" aria-label="Действия монитора">
        <button type="button" class="primary" data-monitor-action="refresh"${system.loading ? " disabled" : ""}>↻ Обновить сейчас</button>
        <button type="button" data-monitor-action="copy-report">Скопировать отчёт</button>
        ${nativeMode ? `<button type="button" data-monitor-action="open-data">Папка data</button><button type="button" data-monitor-action="open-problem-logs">Логи проблем</button><button type="button" data-monitor-action="open-logs">Журнал операций</button>` : ""}
        <button type="button" data-monitor-action="security">Центр безопасности</button>
      </div>
      <nav class="monitor-tabs" aria-label="Разделы монитора">${[["overview", "Обзор"], ["resources", "Ресурсы"], ["data", "Данные"], ["device", "Устройство"]].map(([id, label]) => `<button type="button" data-monitor-view="${id}" aria-pressed="${selected === id}">${label}</button>`).join("")}</nav>
      <div data-monitor-panel="overview"${selected !== "overview" ? " hidden" : ""}>
        <div class="monitor-stat-grid">
          ${nativeMode ? card("cpu", "CPU Windows", number(system.cpuPct), Number.isFinite(system.cpuAveragePct) ? `Среднее последних замеров: ${number(system.cpuAveragePct)}` : "Ожидание измерения", system.cpuLevel) : card("heap", "Память JavaScript", resources.heapUsedText || "Недоступно", "Данные браузерного движка")}
          ${nativeMode ? card("memory", "Оперативная память", number(system.memoryPct), `Свободно ${system.memoryFreeText || "—"}`, system.memoryLevel) : card("windows", "Открытые окна", String(overview.openWindowsCount || 0), "На текущем рабочем столе")}
          ${nativeMode ? card("disk", `Место на диске ${system.diskName || "data"}`, number(system.diskPct), `Занято · свободно ${system.diskFreeText || "—"}`, system.diskLevel) : card("storage", "Хранилище сайта", storage.originText || "Недоступно", "Использование квоты браузера")}
          ${card("fps", "Отзывчивость", number(resources.fps, "fps"), `Задержка ${number(resources.lag, "мс")}`, resources.fpsLevel)}
        </div>
        <div class="monitor-alerts">${alerts.length ? monitorAlertsHTML(alerts) : `<p class="monitor-note">${!fresh.live ? "Для актуальной оценки нужны свежие измерения." : pending ? "Подтверждаем устойчивость нагрузки; одиночный всплеск не вызывает тревогу." : "Новых предупреждений нет. Подробные показатели доступны в разделе «Ресурсы»."}</p>`}</div>
        <section class="monitor-panel"><div class="monitor-panel-head"><h3>Динамика за ${Number(minutes)} мин</h3>${period}</div><div class="monitor-charts">${selected === "overview" ? (nativeMode ? charts : uiCharts).join("") : ""}</div><p class="monitor-note">Наведи на точку графика, чтобы увидеть время и значение. Разрывы означают отсутствие замеров. История начинается при открытии окна.</p></section>
      </div>
      <div data-monitor-panel="resources"${selected !== "resources" ? " hidden" : ""}>
        <section class="monitor-panel"><div class="monitor-panel-head"><h3>${nativeMode ? "Ресурсы Windows и интерфейса" : "Ресурсы браузера"}</h3>${period}</div><div class="monitor-charts">${selected === "resources" ? [...charts, ...uiCharts].join("") : ""}</div><p class="monitor-note">FPS — частота requestAnimationFrame, а не измерение реально показанных кадров. Скрытая вкладка не участвует в оценке торможения. Предупреждение о CPU, RAM или интерфейсе требует 9 секунд последовательных замеров; восстановление — 6 секунд с запасом по порогу.</p></section>
        <section class="monitor-panel"><h3>${nativeMode ? "Python-процесс ZeTer OS" : "Память браузерного движка"}</h3><div class="monitor-kv monitor-kv-compact">${nativeMode ? kv("Память Python", system.processMemoryText || "Недоступно") + kv("CPU Python", number(system.processCpuPct)) + kv("Логические потоки", system.logicalProcessors || "—") + kv("Windows работает", system.uptimeText || "—") : ""}${kv("JS Heap", resources.heapUsedText || "Недоступно")}${kv("Выделено JS Heap", resources.heapTotalText || "Недоступно")}${kv("Задержек > 180 мс за минуту", (series.lag || []).filter(point => point.at >= now - 60000 && point.value > 180).length)}</div><p class="monitor-note">${escapeHtml(noteText)}</p></section>
      </div>
      <div data-monitor-panel="data"${selected !== "data" ? " hidden" : ""} class="monitor-detail-view">
        <div class="monitor-detail-intro"><h3>Данные и сохранение</h3><p>Объём хранилища, последняя запись и доступное место.</p></div>
        <div class="monitor-save-state ${saveState}" data-monitor-save-status="${saveState}">
          <span class="monitor-detail-icon" aria-hidden="true">${saveState === "error" ? "!" : saveState === "saved" ? "✓" : "…"}</span>
          <div><b>${saveState === "error" ? "Есть ошибка сохранения" : saveState === "saved" ? "Последняя запись подтверждена" : "Сохранение ещё не подтверждено"}</b><p>${escapeHtml(saveState === "error" ? storage.lastErrorText : saveState === "saved" ? `Сохранено ${storage.lastSavedAtText}` : "В этом запуске пока нет подтверждённой записи. Подробности доступны ниже.")}</p></div>
        </div>
        <div class="monitor-detail-metrics">
          ${detailMetric("▣", nativeMode ? "Известный объём данных" : "Хранилище сайта", nativeMode ? bytesToHuman(storage.dataFolderBytes || 0) : storage.originText || "Недоступно", nativeMode ? "Последняя оценка, без нового обхода папки" : "Занято / квота браузера")}
          ${detailMetric("▤", "Состояние ZeTer OS", bytesToHuman(storage.stateBytes || 0), "Основной файл рабочего пространства")}
          ${detailMetric("↧", "Импортированные файлы", bytesToHuman(storage.importedBytes || 0), "Сумма исходных размеров")}
          ${detailMetric("⚙", "Настройки интерфейса", bytesToHuman(storage.localSettingsBytes || 0), "Лёгкие настройки и диагностика")}
        </div>
        <div class="monitor-details-grid">
          <section class="monitor-panel monitor-detail-panel">
            ${detailTitle("▤", "Сохранение и хранилище", "Где находятся данные и когда они обновлялись")}
            ${facts([
              ["Основное хранилище", storage.primaryStorageText || "—"],
              ["Последнее сохранение", storage.lastSavedAtText || "ещё не записано"],
              ["Ошибка записи", storage.lastErrorText || "нет"],
              [nativeMode ? "Папка данных" : "Постоянное хранилище", storage.persistenceText || "—"],
              ["Последнее изменение", storage.lastChangedText || "нет данных"],
              ["Сведения обновлены", storage.updatedAtText || "—"]
            ])}
          </section>
          <section class="monitor-panel monitor-detail-panel">
            ${detailTitle("◫", nativeMode ? `Диск ${system.diskName || "с папкой data"}` : "Место для данных сайта", nativeMode ? "Свободное место на диске с папкой data" : "Квота предоставляется браузером для этого сайта")}
            <div class="monitor-capacity"><span>${nativeMode ? "Свободно" : "Занято из квоты"}</span><b>${escapeHtml(nativeMode ? system.diskFreeText || "Недоступно" : storage.originText || "Недоступно")}</b></div>
            ${nativeMode ? meterBar("Занято на диске", system.diskUsedText || "Недоступно", "Процент занятой ёмкости, не активность диска", system.diskPct, system.diskLevel || "ok") : meterBar("Использование квоты", storage.originText || "Недоступно", "IndexedDB, localStorage и кэш сайта", storage.originPct, storage.originLevel || "ok")}
            <p class="monitor-note">${nativeMode ? "Размер данных слева — последняя известная оценка. Этот экран не запускает повторное сканирование папки data." : "Браузер может менять доступную квоту. Размер импортированных файлов и размер состояния показаны отдельно и не являются непересекающимися частями общего объёма."}</p>
            ${!nativeMode ? `<div class="monitor-storage-history"><b>Использование квоты · последние замеры</b>${history.storage?.length ? sparkline(history.storage, 100) : '<p class="monitor-note">История появится после первых измерений.</p>'}</div>` : ""}
          </section>
        </div>
      </div>
      <div data-monitor-panel="device"${selected !== "device" ? " hidden" : ""} class="monitor-detail-view">
        <div class="monitor-detail-intro"><h3>Устройство и окружение</h3><p>Характеристики компьютера, рабочее пространство и подключение.</p></div>
        <div class="monitor-detail-metrics monitor-device-metrics">
          ${detailMetric("▣", "Система", nativeMode ? system.osText || "Windows" : device.platform || "Недоступно", nativeMode ? system.architecture || "Архитектура недоступна" : "Платформа браузера")}
          ${detailMetric("▥", "Логические потоки CPU", String(nativeMode && system.logicalProcessors ? system.logicalProcessors : device.cpuThreads || "Недоступно"), nativeMode ? "По данным Windows" : "По данным браузера")}
          ${detailMetric("▦", "Оперативная память", nativeMode ? system.memoryTotalText || "Недоступно" : device.deviceMemory || "Недоступно", nativeMode ? "Общий объём RAM Windows" : "Приблизительная оценка браузера")}
        </div>
        <div class="monitor-details-grid">
          <section class="monitor-panel monitor-detail-panel">
            ${detailTitle("▣", "Система и приложение", nativeMode ? "Windows и среда запуска ZeTer OS" : "Браузер и его окружение")}
            ${facts([
              ...(nativeMode ? [["Windows", system.osText || "—"], ["Архитектура", system.architecture || "—"], ["Python", system.pythonVersion || "—"], ["Windows работает", system.uptimeText || "—"]] : [["Платформа", device.platform || "Недоступно"]]),
              [nativeMode ? "Движок WebView" : "Браузер", device.browser || "Недоступно"],
              ["ZeTer OS работает", overview.uptimeText || "—"],
              ["Язык", device.language || "—"], ["Часовой пояс", device.timeZone || "—"]
            ])}
          </section>
          <section class="monitor-panel monitor-detail-panel">
            ${detailTitle("◫", "Экран и графика", "Разрешение, масштаб и графический движок")}
            ${facts([["Экран и масштаб", device.screenText || "—"], ["Окно приложения", device.windowText || "—"], ["Графический адаптер", device.gpu || "Недоступно"]])}
            <p class="monitor-note">Сведения о графике передаёт браузерный движок. Некоторые характеристики могут быть скрыты.</p>
          </section>
          <section class="monitor-panel monitor-detail-panel">
            ${detailTitle("▤", "Рабочее пространство", "Содержимое текущего рабочего стола")}
            <div class="monitor-workspace-counts"><div><b>${overview.files ?? 0}</b><span>файлов</span></div><div><b>${overview.folders ?? 0}</b><span>папок</span></div><div><b>${overview.appsCount ?? 0}</b><span>ярлыков</span></div></div>
            ${facts([
              ["Открытые окна", overview.openWindowNamesText || "нет"],
              ["Задачи", `${overview.tasksCount ?? 0} всего · ${overview.tasksDoing ?? 0} в работе · ${overview.tasksDone ?? 0} готово`],
              ["Календарь сегодня", `${overview.todayEvents ?? 0} событий`],
              ["Уведомления", `${overview.notificationsTotal ?? 0} всего · ${overview.unreadNotifications ?? 0} непрочитанных`],
              ["Элементы DOM", `${overview.domNodes ?? 0} узлов`]
            ])}
          </section>
          <section class="monitor-panel monitor-detail-panel">
            ${detailTitle("↔", "Сеть и питание", "Доступные сведения браузерного движка")}
            ${facts([
              ["Статус сети", network.onlineText || "Недоступно"], ["Тип подключения", network.type || "Недоступно"],
              ["Оценка скорости", network.downlink || "Недоступно"], ["Оценка задержки RTT", network.rtt || "Недоступно"],
              ["Экономия трафика", network.saveData || "нет"], ["Батарея", network.battery || "Недоступно"]
            ])}
            <p class="monitor-note">Статус «онлайн» не проверяет доступ к конкретному сайту. Скорость и RTT — оценки движка, а не отдельный тест сети.</p>
          </section>
        </div>
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

  // Keep existing controls and focus alive across periodic metric updates.
  function patchMonitorDOM(root, html) {
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = html;
    const sync = (target, source) => {
      if (target.nodeType === 3) {
        if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
        return;
      }
      if (target.nodeType === 1 && source.nodeType === 1) {
        for (const attribute of Array.from(target.attributes)) if (!source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
        for (const attribute of Array.from(source.attributes)) if (target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
      }
      let index = 0;
      for (const child of Array.from(source.childNodes)) {
        const current = target.childNodes[index];
        if (!current) target.append(child.cloneNode(true));
        else if (current.nodeType !== child.nodeType || current.nodeName !== child.nodeName) current.replaceWith(child.cloneNode(true));
        else sync(current, child);
        index++;
      }
      while (target.childNodes.length > index) target.lastChild.remove();
    };
    sync(root, template.content);
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
    const openProblemLogsFolder = typeof api.openProblemLogsFolder === "function" ? api.openProblemLogsFolder : async () => {};
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
      const resources = monitorResourcesModel({ fps: live.fps, lag: live.lag, mem: performance.memory || null, uaMemory: live.uaMemory, nativeMode });
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
      const candidates = monitorAlerts({
        originPct: storage.originPct,
        statePct: storage.statePct,
        heapPct: resources.heapPct,
        fps: document.hidden ? null : live.fps,
        lag: document.hidden ? null : live.lag,
        online: navigator.onLine,
        nativeMode,
        storageFallback: storageRuntime.fallback,
        system,
        systemError: live.systemError,
        systemLoading: live.systemLoading,
        activeAlertIds: Object.keys(runtime.alertStates).filter(id => runtime.alertStates[id].active)
      });
      const alerts = monitorStableAlerts(runtime, candidates, {
        systemAt: live.systemUpdatedAt,
        uiAt: runtime.series.lag.at(-1)?.at || 0,
        unavailable: system.stale || Boolean(system.error),
        now: Date.now()
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
        history,
        series: runtime.series,
        alertStates: runtime.alertStates,
        view: runtime.view,
        minutes: runtime.minutes,
        now: Date.now(),
        hidden: document.hidden
      };
    };

    const draw = () => {
      lastModel = buildModel();
      patchMonitorDOM(root, monitorAppHTML(lastModel));
    };
    const raf = now => {
      if (!root.isConnected) return;
      if (document.hidden) { runtime.frameCount = 0; runtime.frameStarted = now; live.fps = null; }
      else tickMonitorFps(runtime, now);
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const update = () => { if (!root.isConnected) return false; draw(); return true; };
    const lagTimer = setInterval(() => {
      if (!root.isConnected) return clearInterval(lagTimer);
      if (document.hidden) {
        runtime.lastLagTick = performance.now();
        runtime.frameCount = 0;
        runtime.frameStarted = performance.now();
        live.fps = null;
        recordMonitorSample(runtime.series.fps, Date.now(), null);
        recordMonitorSample(runtime.series.lag, Date.now(), null);
        delete runtime.alertStates.fps;
        delete runtime.alertStates.lag;
      } else tickMonitorLag(runtime);
    }, 1000);
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
      const viewButton = event.target.closest("[data-monitor-view]");
      const periodButton = event.target.closest("[data-monitor-period]");
      if (viewButton) { runtime.view = viewButton.dataset.monitorView; draw(); return; }
      if (periodButton) { runtime.minutes = Number(periodButton.dataset.monitorPeriod); draw(); return; }
      const button = event.target.closest("[data-monitor-action]");
      if (!button || button.disabled) return;
      const action = button.dataset.monitorAction;
      try {
        if (action === "resources") {
          runtime.view = "resources";
          draw();
          root.querySelector('[data-monitor-view="resources"]')?.focus();
        } else if (action === "refresh") {
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
        } else if (action === "open-problem-logs") {
          await openProblemLogsFolder();
        } else if (action === "security") {
          openApp("security");
        }
      } catch (error) {
        toast("Действие не выполнено", error?.message || String(error));
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });

    // The owner inserts the returned root synchronously; read after that insertion.
    Promise.resolve().then(readAsync);
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
    recordMonitorSample,
    monitorTimelineModel,
    monitorTimelineHTML,
    monitorStableAlerts,
    monitorFreshness,
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
