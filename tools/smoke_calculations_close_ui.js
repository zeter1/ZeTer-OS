"use strict";
// Explicit component regression: real model, primary queue, UI and window close owner.
// Inert import. Separate browser contexts, synthetic state, blocked network; no native/data/.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
async function runCalculationsCloseSmoke({ launchBrowser, outputDir } = {}) {
  if (typeof launchBrowser !== "function" || !path.isAbsolute(outputDir || "")) throw new Error("Explicit browser launcher and absolute outputDir required.");
  const root = path.resolve(__dirname, ".."), checks = [], failures = [];
  fs.mkdirSync(outputDir, { recursive: true });
  let browser;
  try {
    browser = await launchBrowser();
    for (const scenario of ["refusal and explicit retry", "successful close", "late input before close", "unchanged close", "decimal result"]) {
      const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: "block" });
      let page;
      try {
        await context.route("**/*", route => route.abort());
        page = await context.newPage();
        page.setDefaultTimeout(7000);
        const pageErrors = []; page.on("pageerror", error => pageErrors.push(error.message));
        await page.setContent('<html lang="ru"><body><div id="mount" style="width:1250px;height:850px"></div></body></html>');
        for (const name of ["00-base.css", "30-app-common.css", "67-business-calculations.css"]) await page.addStyleTag({ content: fs.readFileSync(path.join(root, "app/css", name), "utf8") });
        await page.evaluate(() => {
          window.ZETER_CORE_UTILS = { escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])),
            $: (selector, scope = document) => scope.querySelector(selector), $$: (selector, scope = document) => [...scope.querySelectorAll(selector)], cssEscape: CSS.escape, clamp: (value, min, max) => Math.min(max, Math.max(min, value)) };
          // Closing does not use session/geometry algorithms; inject only that unrelated boundary.
          window.ZETER_WINDOW_METRICS_UTILS = {}; window.ZETER_WINDOW_SESSION_UTILS = {};
        });
        for (const name of ["business-calculations-utils.js", "storage-utils.js", "business-calculations-ui-utils.js", "window-ui-utils.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(root, "app/js/core", name), "utf8") });
        await page.evaluate(() => {
          const api = ZETER_BUSINESS_CALCULATIONS_UTILS;
          window.fixtureState = { desktops: [{ id: "finance", data: { calculations: api.normalizeBusinessCalculations() } }, { id: "neighbor", data: { sentinel: "unchanged" } }] };
          window.durableState = structuredClone(fixtureState); window.writeAttempts = 0;
          window.primaryQueue = ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => fixtureState, nativeStorage: true, writePrimaryRecord: async snapshot => {
            window.writeAttempts++;
            if (window.holdNextWrite) { window.holdNextWrite = false; await new Promise(resolve => { window.releaseWrite = resolve; }); if (window.refuseHeldWrite) throw new Error("Synthetic write refusal"); }
            window.durableState = structuredClone(snapshot); return { updatedAt: Date.now() };
          } });
          window.mountCalculations = () => {
            const mount = document.querySelector("#mount");
            mount.innerHTML = '<section class="window" style="width:1250px;height:850px;position:relative"><button id="close-window" type="button">Закрыть</button><div class="window-body" style="height:790px"></div></section>';
            const win = mount.querySelector(".window");
            const controller = api.createBusinessCalculationsController({ getWorkspace: () => fixtureState.desktops[0].data, persistTransaction: operation => primaryQueue.transaction(operation), saveSnapshot: (write, calculations) => {
              const snapshot = structuredClone(fixtureState); snapshot.desktops[0].data.calculations = calculations; return write(snapshot);
            } });
            window.calculationsRoot = ZETER_BUSINESS_CALCULATIONS_UI_UTILS.createBusinessCalculationsApp({}, { documentRef: document, controller });
            win.querySelector(".window-body").append(calculationsRoot);
            window.runtimeWindows = new Map([["calculation", { el: win, appId: "calculations" }]]);
            const runtime = ZETER_WINDOW_UI_UTILS.createWindowRuntimeController({ getWindows: () => runtimeWindows, getExplorerFolders: () => new Map(), persistWindows: () => {}, normalizeOpeningRect: value => value });
            document.querySelector("#close-window").addEventListener("click", () => { window.closeResult = Promise.resolve(runtime.closeWindow("calculation")); });
          };
          mountCalculations();
        });
        const cost = () => page.locator('[data-calc-card="margin"] [data-calc-field="cost"]');
        if (scenario === "decimal result") {
          const card = page.locator('[data-calc-card="breakeven"]');
          for (const [field, value] of [["fixed", "1000"], ["price", "1.20"], ["variable", "1.10"]]) await card.locator(`[data-calc-field="${field}"]`).fill(value);
          assert.equal((await card.locator('[data-calc-result="units"]').innerText()).replace(/\s/g, ""), "10000шт.");
          await page.screenshot({ path: path.join(outputDir, "exact-decimal-result.png") });
        } else if (scenario === "unchanged close") {
          await page.locator("#close-window").click(); await page.locator(".window").waitFor({ state: "detached" });
          assert.equal(await page.evaluate(() => writeAttempts), 0);
        } else {
          await page.evaluate(refuse => { window.holdNextWrite = true; window.refuseHeldWrite = refuse; }, scenario === "refusal and explicit retry");
          await cost().fill("987.65");
          if (scenario === "late input before close") {
            await page.locator('[data-calc-card="margin"] [data-calc-field="price"]').focus();
            await page.waitForFunction(() => typeof window.releaseWrite === "function");
            await cost().fill("222.22");
          }
          await page.locator("#close-window").click();
          await page.waitForFunction(() => typeof window.releaseWrite === "function");
          assert.equal(await page.evaluate(() => runtimeWindows.size), 1, "pending write must keep the window registered");
          assert.equal(await cost().isDisabled(), true, "freeze late input while preparing close");
          assert.equal(await page.evaluate(() => durableState.desktops[0].data.calculations.inputs.margin.cost), "700");
          await page.locator("#close-window").click(); // A second close must share the same request.
          assert.equal(await page.evaluate(() => writeAttempts), 1);
          await page.evaluate(() => releaseWrite());
          if (scenario === "refusal and explicit retry") {
            assert.equal(await page.evaluate(() => closeResult), false);
            assert.equal(await cost().inputValue(), "987.65");
            assert.equal(await cost().isDisabled(), false);
            assert.equal(await page.evaluate(() => runtimeWindows.size), 1);
            assert.match(await page.locator("[data-calc-status]").innerText(), /не закрыто|оставлено открытым/i);
            await page.screenshot({ path: path.join(outputDir, "refusal-keeps-draft.png") });
            await page.locator("#close-window").click();
          }
          await page.locator(".window").waitFor({ state: "detached" });
          const expected = scenario === "late input before close" ? "222.22" : "987.65";
          assert.equal(await page.evaluate(() => durableState.desktops[0].data.calculations.inputs.margin.cost), expected);
          assert.deepEqual(await page.evaluate(() => durableState.desktops[1]), { id: "neighbor", data: { sentinel: "unchanged" } });
          await page.evaluate(() => mountCalculations());
          assert.equal(await cost().inputValue(), expected);
        }
        assert.deepEqual(pageErrors, [], "no uncaught page errors");
        checks.push({ scenario, status: "PASS" });
      } catch (error) {
        checks.push({ scenario, status: "FAIL", error: error.message }); failures.push(error);
        if (page) await page.screenshot({ path: path.join(outputDir, `failure-${checks.length}.png`) });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(outputDir, "results.json"), JSON.stringify({ checks, browserVersion: browser.version(), fingerprints: Object.fromEntries(["app/js/core/business-calculations-utils.js", "app/js/core/storage-utils.js", "app/js/core/business-calculations-ui-utils.js", "app/js/core/window-ui-utils.js", "app/css/00-base.css", "app/css/30-app-common.css", "app/css/67-business-calculations.css", "tools/smoke_calculations_close_ui.js"].map(name => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex")])) }, null, 2));
    console.log(JSON.stringify(checks));
  } finally { if (browser) await browser.close(); }
  if (failures.length) throw new AggregateError(failures, "Calculations close regressions failed");
  return checks;
}
module.exports = { runCalculationsCloseSmoke };
