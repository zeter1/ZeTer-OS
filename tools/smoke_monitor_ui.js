"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runMonitorSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/monitor-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error("MONITOR_PAGE_ERROR", error.message); });
    await page.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      // Load the real core/CSS without booting storage or the user's application.
      if (new URL(url).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body: "" });
      return route.continue();
    });
    await page.goto(preview.url);
    await page.waitForFunction(() => Boolean(window.ZETER_MONITOR_UTILS));
    await page.evaluate(() => {
      document.getElementById("boot")?.remove();
      const fixtureWindow = document.createElement("section");
      fixtureWindow.className = "window glass active";
      fixtureWindow.style.cssText = "inset:0;min-width:0;width:100%;height:100%";
      fixtureWindow.innerHTML = '<div class="window-titlebar"><b>Монитор системы · тестовые данные</b></div><div class="window-body"></div>';
      document.getElementById("window-layer").append(fixtureWindow);
      const f = window.monitorFixture = { now: Date.now(), timers: [], copied: "", fail: false, native: true, cpu: 23, memory: 91, storage: { usage: 37 * 1024 ** 2, localSettingsBytes: 3200, lastSavedAt: Date.now() } };
      Date.now = () => f.now;
      f.mount = () => {
        f.timers = [];
        const app = ZETER_MONITOR_UTILS.createMonitorApp({ document, performance, navigator,
          requestAnimationFrame: () => 0,
          setInterval: (callback, delay) => { f.timers.push({ callback, delay }); return f.timers.length; },
          apps: {}, ui: { windows: new Map() }, getDesktopRoot: () => "fixture", workspaceItems: () => [],
          deskTasks: () => [], deskEvents: () => [], deskNotifications: () => [], shouldUseNativeStorage: () => f.native,
          storedStateSizeBytes: () => 1.5 * 1024 ** 2, storageRuntime: f.storage, todayISO: () => "2026-10-19", occursOn: () => false,
          copyText: async text => { f.copied = text; return true; },
          readNativeSystemMetrics: async () => {
            if (f.fail) throw new Error("Fixture: measurement unavailable");
            return { sampledAt: f.now, cpuPercent: f.cpu, memoryPercent: f.memory, memoryTotalBytes: 16 * 1024 ** 3,
              memoryUsedBytes: 15 * 1024 ** 3, memoryAvailableBytes: 1.3 * 1024 ** 3, diskName: "G:\\", diskPercent: 6,
              diskTotalBytes: 931 * 1024 ** 3, diskFreeBytes: 872 * 1024 ** 3, diskUsedBytes: 59 * 1024 ** 3,
              processMemoryBytes: 138 * 1024 ** 2, processCpuPercent: 0, osName: "Windows 11", architecture: "AMD64", pythonVersion: "3.13.6", uptimeMs: 3600000 };
          }
        });
        const previous = document.querySelector(".monitor-app");
        if (previous) previous.replaceWith(app); else fixtureWindow.querySelector(".window-body").append(app);
      };
      f.mount();
    });
    const app = page.locator(".monitor-app");
    await page.waitForFunction(() => document.querySelector(".monitor-health")?.dataset.monitorStatus === "current");
    assert.equal(await app.locator(".monitor-live").count(), 0, "the standalone LIVE badge is removed");
    assert.equal(await app.locator("h2").evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom < innerHeight; }), true, "monitor heading must be inside the visible window");
    assert.equal(await app.locator("[data-monitor-card]").count(), 4);
    await app.locator('[data-monitor-view="resources"]').click();
    await app.locator('[data-monitor-period="15"]:visible').click();
    await app.locator('[data-monitor-period="15"]:visible').focus();
    await page.evaluate(() => monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback()));
    assert.equal(await app.locator('[data-monitor-period="15"]:visible').evaluate(node => node === document.activeElement), true, "refresh preserves keyboard focus");
    assert.equal(await app.locator('[data-monitor-period="15"]:visible').getAttribute("aria-pressed"), "true");
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => { monitorFixture.now += 3000; });
      await app.locator('[data-monitor-action="refresh"]').click();
      await page.waitForFunction(() => !document.querySelector('[data-monitor-action="refresh"]').disabled);
    }
    await app.locator('[data-monitor-view="overview"]').click();
    assert.match(await app.locator(".monitor-alerts").textContent(), /Мало свободной RAM/);
    assert.match(await app.locator(".monitor-alerts").textContent(), /Ctrl\+Shift\+Esc/);
    await app.locator('[data-monitor-action="copy-report"]').click();
    assert.match(await page.evaluate(() => monitorFixture.copied), /пик|Пик/);
    await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
    await app.locator('[data-monitor-view="resources"]').click();
    await page.screenshot({ path: path.join(out, "resources.png"), fullPage: true });
    for (const view of ["data", "device"]) {
      await app.locator(`[data-monitor-view="${view}"]`).click();
      const geometry = await app.locator(`[data-monitor-panel="${view}"]`).evaluate(node => {
        const grid = node.querySelector(".monitor-details-grid");
        const panels = Array.from(grid.children).map(panel => panel.getBoundingClientRect());
        const rect = node.getBoundingClientRect();
        return { gap: panels[1].left - panels[0].right, coverage: (panels[1].right - panels[0].left) / rect.width, sameRow: Math.abs(panels[1].top - panels[0].top) < 1 };
      });
      assert.equal(geometry.sameRow, true, `${view}: two groups use the wide window`);
      assert.ok(geometry.coverage > .98 && geometry.gap >= 12, `${view}: full width with a clear gap`);
      await app.evaluate(node => { node.scrollTop = 0; node.parentElement.scrollTop = 0; });
      await page.screenshot({ path: path.join(out, `${view}-desktop.png`), fullPage: true });
    }
    await app.locator('[data-monitor-view="data"]').click();
    assert.equal(await app.locator("[data-monitor-save-status]").getAttribute("data-monitor-save-status"), "saved");
    await page.evaluate(() => { monitorFixture.storage.lastError = '<img src=x onerror=alert(1)> Ошибка записи ' + 'Длинное описание '.repeat(16); monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback()); });
    assert.equal(await app.locator("[data-monitor-save-status]").getAttribute("data-monitor-save-status"), "error");
    assert.equal(await app.locator('[data-monitor-panel="data"] img').count(), 0, "error text is escaped");
    await page.evaluate(() => { monitorFixture.storage.lastError = ''; monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback()); });
    assert.equal(await app.locator("[data-monitor-save-status]").getAttribute("data-monitor-save-status"), "saved");
    await page.evaluate(() => { monitorFixture.storage.lastSavedAt = null; monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback()); });
    assert.equal(await app.locator("[data-monitor-save-status]").getAttribute("data-monitor-save-status"), "unknown", "absence of an error is not proof of a saved record");
    await page.evaluate(() => { monitorFixture.storage.lastSavedAt = monitorFixture.now; monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback()); });
    for (const width of [1920, 1024, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of ["overview", "resources", "data", "device"]) {
        await app.locator(`[data-monitor-view="${view}"]`).click();
        assert.equal(await app.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, `${view}: no overflow at ${width}`);
        if (["data", "device"].includes(view)) {
          await app.evaluate(node => { node.scrollTop = 0; node.parentElement.scrollTop = 0; });
          await page.screenshot({ path: path.join(out, `${view}-${width}.png`), fullPage: true });
          assert.equal(await app.locator(`[data-monitor-panel="${view}"] .monitor-facts`).evaluateAll(lists => lists.every(list => Array.from(list.children).every(row => {
            const label = row.querySelector("dt").getBoundingClientRect();
            const value = row.querySelector("dd").getBoundingClientRect();
            const box = row.getBoundingClientRect();
            return value.right <= box.right + 1 && value.bottom <= box.bottom + 1 && (label.right <= value.left + 1 || label.bottom <= value.top + 1);
          }))), true, `${view}: labels and long values remain separate at ${width}`);
          await app.evaluate(node => { node.scrollTop = node.scrollHeight; });
          await page.screenshot({ path: path.join(out, `${view}-${width}-bottom.png`), fullPage: true });
        }
      }
      await app.locator('[data-monitor-view="overview"]').click();
      await page.screenshot({ path: path.join(out, `narrow-${width}.png`), fullPage: true });
    }
    await page.evaluate(() => { monitorFixture.now += 13000; monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback()); });
    assert.equal(await app.locator(".monitor-health").getAttribute("data-monitor-status"), "stale");
    await page.evaluate(() => { monitorFixture.fail = true; });
    await app.locator('[data-monitor-action="refresh"]').click();
    await page.waitForFunction(() => document.querySelector(".monitor-health")?.dataset.monitorStatus === "error");
    await page.evaluate(() => { monitorFixture.fail = false; monitorFixture.now += 3000; });
    await app.locator('[data-monitor-action="refresh"]').click();
    await page.waitForFunction(() => document.querySelector(".monitor-health")?.dataset.monitorStatus === "current");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      monitorFixture.now += 1000;
      monitorFixture.timers.filter(timer => timer.delay === 1000).forEach(timer => timer.callback());
    });
    assert.equal(await app.locator(".monitor-health").getAttribute("data-monitor-status"), "paused");
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); });
    await page.evaluate(() => { monitorFixture.native = false; monitorFixture.mount(); });
    await page.waitForSelector('.monitor-app [data-monitor-view="resources"]');
    await app.locator('[data-monitor-view="resources"]').click();
    assert.match(await app.textContent(), /браузер|браузера/);
    assert.equal(await app.locator('[data-monitor-action="open-data"]').count(), 0);
    // Exercise the production composition root as well as the deterministic native fixture.
    const integration = await context.newPage();
    integration.on("pageerror", error => errors.push(error.message));
    await integration.route("**/*", route => {
      const url = route.request().url();
      if (!url.startsWith(preview.url)) return route.abort();
      if (new URL(url).pathname === "/js/app.js") return route.fulfill({ contentType: "application/javascript", body:
        "const fixture=ZETER_INITIAL_STATE_UTILS.defaultState();fixture.firstRunCompleted=true;localStorage.setItem('zeter_os_state_v3',JSON.stringify(fixture));\n" + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      return route.continue();
    });
    await integration.goto(preview.url);
    await integration.waitForSelector("#boot", { state: "hidden" });
    await integration.locator('[data-top-action="monitor"]').click();
    const actual = integration.locator(".monitor-app");
    await actual.locator('[data-monitor-view="resources"]').click();
    await actual.locator('[data-monitor-period="5"]:visible').click();
    assert.equal(await actual.locator('[data-monitor-period="5"]:visible').getAttribute("aria-pressed"), "true");
    await actual.locator('[data-monitor-view="data"]').click();
    assert.match(await actual.locator('[data-monitor-panel="data"]').textContent(), /IndexedDB/);
    await actual.locator('[data-monitor-view="overview"]').click();
    await integration.waitForFunction(() => Array.from(document.querySelectorAll('[data-monitor-panel="overview"] .monitor-chart')).every(chart => chart.querySelectorAll("circle").length > 0));
    await actual.evaluate(node => { node.scrollTop = 0; node.parentElement.scrollTop = 0; });
    await integration.screenshot({ path: path.join(out, "browser-integration.png"), fullPage: true });
    await integration.close();
    assert.deepEqual(errors, []);
    console.log("MONITOR_UI_PASS: no LIVE badge, full-width detail groups, save error/recovery and escaped text, tabs, periods, focus, 1920/1440/1024/760/390/320, stale/error/recovery, hidden tab, native fixture and production composition root");
  } finally {
    await browser?.close();
    await preview.close();
  }
}
module.exports = { runMonitorSmoke };
