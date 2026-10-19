"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;"
}[char]));

const sandbox = {
  console,
  Date,
  Intl,
  Math,
  Number,
  Promise,
  setInterval,
  clearInterval,
  performance: { now: () => 1000 },
  navigator: { onLine: true, platform: "Win32", language: "ru-RU" },
  screen: { width: 1920, height: 1080 },
  document: {
    createElement() {
      return { getContext: () => null };
    }
  },
  window: {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    ZETER_CORE_UTILS: {
      escapeHtml,
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      pad: value => String(value).padStart(2, "0"),
      bytesToHuman(value) {
        const bytes = Number(value) || 0;
        if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3 * 10) / 10} ГБ`;
        if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2 * 10) / 10} МБ`;
        if (bytes >= 1024) return `${Math.round(bytes / 1024 * 10) / 10} КБ`;
        return `${bytes} Б`;
      }
    }
  }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(ROOT, "app", "js", "core", "monitor-utils.js"), "utf8"),
  sandbox,
  { filename: "monitor-utils.js" }
);

async function main() {
  const monitor = sandbox.window.ZETER_MONITOR_UTILS;
  assert.ok(monitor, "monitor contract must load");

  // A high-refresh display must not be silently truncated to 60 FPS.
  const fast = monitor.createMonitorRuntime(0);
  for (let frame = 1; frame <= 144; frame++) monitor.tickMonitorFps(fast, frame * 1000 / 144);
  assert.equal(fast.history.fps.at(-1), 144);

  const samples = [];
  monitor.recordMonitorSample(samples, 1000, 10);
  monitor.recordMonitorSample(samples, 4000, 90);
  monitor.recordMonitorSample(samples, 20000, 30);
  const timeline = monitor.monitorTimelineModel(samples, { now: 21000, minutes: 1, gapMs: 7000 });
  assert.equal(timeline.min, 10);
  assert.equal(timeline.max, 90);
  assert.equal(timeline.average, 43.3);
  assert.equal(timeline.segments.length, 2, "missing measurements must break the graph");
  assert.equal(monitor.monitorTimelineModel([], { now: 21000 }).average, null);
  monitor.recordMonitorSample(samples, 20000, 99);
  assert.equal(samples.length, 3, "same sample is not duplicated by redraws");
  monitor.recordMonitorSample(samples, 930000, null);
  assert.equal(samples.length, 1, "history expires after fifteen minutes, including failed samples");
  assert.equal(samples[0].value, null, "unknown is never fabricated as zero");

  const tracker = monitor.createMonitorRuntime(0);
  const cpuAlert = { id: "cpu", type: "warn", title: "Высокая загрузка CPU", text: "85%" };
  const tracked = (alerts, at) => monitor.monitorStableAlerts(tracker, alerts, { now: at, systemAt: at, uiAt: at });
  assert.equal(tracked([cpuAlert], 1000).length, 0, "a single spike is not an incident");
  tracked([cpuAlert], 4000); tracked([cpuAlert], 7000);
  assert.equal(tracked([cpuAlert], 10000)[0].since, 1000);
  assert.equal(tracked([], 13000).length, 1, "recovery must also persist");
  tracked([], 16000);
  assert.equal(tracked([], 19000).length, 0);
  tracked([cpuAlert], 22000);
  assert.equal(tracked([cpuAlert], 50000).length, 0, "a sampling gap resets pending evidence");
  const fluctuating = monitor.createMonitorRuntime(0);
  let sustained = [];
  for (const [at, type] of [[1000, "warn"], [4000, "bad"], [7000, "warn"], [10000, "bad"]]) {
    sustained = monitor.monitorStableAlerts(fluctuating, [{ ...cpuAlert, type }], { now: at, systemAt: at });
  }
  assert.equal(sustained.length, 1, "continuous overload still warns when severity crosses its internal boundary");
  assert.equal(monitor.monitorFreshness({ nativeMode: true, system: { available: true, stale: true } }).label, "НЕТ СВЕЖИХ ДАННЫХ");
  assert.equal(monitor.monitorFreshness({ nativeMode: true, system: { available: false } }).live, false);
  const cpuAt78 = { cpuAveragePct: 78 };
  assert.equal(monitor.monitorAlerts({ online: true, system: cpuAt78 }).some(alert => alert.id === "cpu"), false);
  assert.equal(monitor.monitorAlerts({ online: true, system: cpuAt78, activeAlertIds: ["cpu"] }).some(alert => alert.id === "cpu"), true, "hysteresis keeps an active warning below its entry threshold");
  assert.equal(monitor.monitorAlerts({ online: true, system: { cpuAveragePct: 99, memoryPct: 99, stale: true } }).some(alert => ["cpu", "memory"].includes(alert.id)), false, "stale measurements must not claim current overload");
  const fps144 = monitor.monitorTimelineModel([{ at: 1000, value: 144 }], { now: 2000 });
  assert.equal(fps144.max, 144);
  const explicitGap = monitor.monitorTimelineModel([{ at: 1000, value: 10 }, { at: 2000, value: null }, { at: 3000, value: 20 }], { now: 4000 });
  assert.equal(explicitGap.segments.length, 2);
  assert.equal(explicitGap.average, 15);
  assert.equal(monitor.monitorTimelineModel([{ at: 1000, value: 90 }, { at: 4000, value: null }], { now: 5000 }).latest, null, "a failed latest measurement is not the previous good value");
  assert.equal(monitor.monitorTimelineModel([{ at: 1000, value: 90 }], { now: 20000 }).latest, null, "expired current value stays unavailable, while historical stats remain usable");

  const system = monitor.monitorSystemModel({
    sampledAt: Date.now(),
    cpuPercent: 95,
    logicalProcessors: 16,
    memoryTotalBytes: 16 * 1024 ** 3,
    memoryAvailableBytes: 1 * 1024 ** 3,
    memoryUsedBytes: 15 * 1024 ** 3,
    memoryPercent: 94,
    diskName: "G:\\",
    diskTotalBytes: 100 * 1024 ** 3,
    diskUsedBytes: 97 * 1024 ** 3,
    diskFreeBytes: 3 * 1024 ** 3,
    diskPercent: 97,
    processMemoryBytes: 300 * 1024 ** 2,
    processCpuPercent: 4,
    uptimeMs: 3_600_000,
    osName: "Windows 11",
    architecture: "AMD64",
    pythonVersion: "3.13"
  }, { systemCpu: [93, 94, 95] });
  assert.equal(system.available, true);
  assert.equal(system.cpuLevel, "bad");
  assert.equal(system.memoryLevel, "bad");
  assert.equal(system.diskLevel, "bad");
  assert.equal(Math.round(system.cpuAveragePct), 94);

  const alerts = monitor.monitorAlerts({
    nativeMode: true,
    online: true,
    fps: 60,
    lag: 0,
    system
  });
  assert.ok(alerts.some(alert => alert.title === "CPU перегружен"));
  assert.ok(alerts.some(alert => alert.title === "Почти закончилась RAM"));
  assert.ok(alerts.some(alert => alert.title === "На диске данных мало места"));
  const health = monitor.monitorHealthModel({ alerts, nativeMode: true, system });
  assert.equal(health.tone, "bad");

  const model = {
    nativeMode: true,
    alerts,
    health,
    system,
    resources: { fps: 60, lag: 2, fpsPct: 100, lagPct: 1 },
    storage: { stateBytes: 1024, dataFolderBytes: 2048 },
    overview: { uptimeText: "1м 00с" },
    device: {},
    network: { onlineText: "онлайн" },
    history: { systemCpu: [93, 94, 95], systemMemory: [92, 93, 94] }
  };
  const html = monitor.monitorAppHTML(model);
  assert.match(html, /Ресурсы Windows/);
  assert.match(html, /CPU Windows/);
  assert.match(html, /data-monitor-action="copy-report"/);
  assert.match(html, /data-monitor-action="open-logs"/);
  assert.doesNotMatch(html, /CPU Windows и полная RAM системы недоступны/, "native monitor must not claim that real Windows metrics are unavailable");

  const report = monitor.monitorDiagnosticReport(model, 1000);
  assert.match(report, /CPU Windows: 95%/);
  assert.match(report, /Оперативная память: 94%/);
  assert.match(report, /Предупреждения:/);

  const runtime = monitor.createMonitorRuntime(0);
  await monitor.readMonitorAsyncMetrics(runtime, {
    nativeMode: true,
    readNativeSystemMetrics: async () => ({
      ok: true,
      sampledAt: 2000,
      cpuPercent: 25,
      memoryPercent: 50,
      memoryTotalBytes: 8 * 1024 ** 3,
      diskTotalBytes: 100 * 1024 ** 3
    })
  });
  assert.equal(runtime.live.system.cpuPercent, 25);
  assert.deepEqual(Array.from(runtime.history.systemCpu), [25]);
  assert.deepEqual(Array.from(runtime.history.systemMemory), [50]);
  assert.equal(runtime.live.systemError, "");

  const indexHtml = fs.readFileSync(path.join(ROOT, "app", "index.html"), "utf8");
  assert.match(indexHtml, /data-top-action="monitor">Монитор системы</);
  console.log("system monitor runtime smoke: ok");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
