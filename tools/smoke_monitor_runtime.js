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

  const system = monitor.monitorSystemModel({
    sampledAt: 1000,
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
