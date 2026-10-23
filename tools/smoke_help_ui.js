"use strict";

// Explicit browser check only: importing this file starts no application.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function runHelpSmoke({ chromium, startPreview, outputDir }) {
  const root = path.resolve(__dirname, "..");
  const out = outputDir || path.join(root, "work/help-guide-qa");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js", "css", "assets", "manifest.json"], ttlSeconds: 600 });
  let browser;
  const checks = [];
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1050 }, serviceWorkers: "block" });
    await context.addInitScript(() => { window.__ZETER_UI_PREVIEW__ = true; });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(preview.url)) return route.abort();
      if (new URL(route.request().url()).pathname === "/js/app.js") {
        const seed = "const helpSeed=ZETER_INITIAL_STATE_UTILS.defaultState();helpSeed.firstRunCompleted=true;localStorage.setItem('zeter_os_state_v3',JSON.stringify(helpSeed));\n";
        return route.fulfill({ contentType: "application/javascript", body: seed + fs.readFileSync(path.join(root, "app/js/app.js"), "utf8") });
      }
      return route.continue();
    });
    try {
      await page.goto(preview.url);
      await page.waitForSelector("#boot", { state: "hidden" });
      await page.locator('[data-top-action="help"]').click();
      const app = page.locator(".help-page"), win = page.locator('.window[data-app-id="help"]');
      await app.waitFor();
      const size = async (width, viewport = width, height = 1050) => {
        await page.setViewportSize({ width: viewport, height });
        await win.evaluate((el, box) => Object.assign(el.style, { width: `${box.width - 16}px`, height: `${box.height - 100}px`, top: "42px", left: "8px" }), { width, height });
      };
      const fit = async label => {
        const bad = await app.evaluate(el => {
          const main = el.querySelector(".help-main");
          const bounds = el.getBoundingClientRect();
          return {
            root: el.scrollWidth > el.clientWidth + 1,
            main: main.scrollWidth > main.clientWidth + 1,
            elements: [...el.querySelectorAll("button,input,summary,.help-section-index,.help-topic,.help-hero")]
              .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== "hidden")
              .filter(node => { const r = node.getBoundingClientRect(); return r.left < bounds.left - 1 || r.right > bounds.right + 1; })
              .map(node => node.className || node.tagName)
          };
        });
        assert.deepEqual(bad, { root: false, main: false, elements: [] }, label);
        checks.push(label);
      };
      const navigate = async id => {
        const nav = app.locator(".help-nav");
        if (!await nav.isVisible()) await app.locator("[data-help-menu-toggle]").click();
        await nav.locator(`[data-help-target="${id}"]`).click();
      };
      for (const width of [1920,1280,900,620,390,320]) {
        await size(width);
        await navigate("home");
        await fit(`home-${width}`);
        await page.screenshot({ path: path.join(out, `home-${width}.png`) });
        await navigate("safety");
        assert.equal(await app.locator("[data-help-section]:visible").count(), 1);
        await fit(`safety-${width}`);
        await page.screenshot({ path: path.join(out, `section-${width}.png`) });
      }
      await size(390, 1600);
      await navigate("home");
      assert.equal(await app.locator("[data-help-menu-toggle]").isVisible(), true, "layout must respond to the window rather than viewport");
      await fit("narrow-window-wide-viewport");
      await app.locator("[data-help-menu-toggle]").click();
      assert.equal(await app.locator("[data-help-menu-toggle]").getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await app.locator(".help-nav").isVisible(), false);
      assert.equal(await app.locator("[data-help-menu-toggle]").evaluate(el => el === document.activeElement), true);
      const ids = await page.evaluate(() => ZETER_HELP_CONTENT.HELP_SECTIONS.map(section => section.id));
      for (const id of ids) {
        await navigate(id);
        assert.equal(await app.locator(`[data-help-target="${id}"][aria-current="page"]`).count(), 1);
        assert.equal(await app.locator("[data-help-section]:visible").count(), 1);
        await fit(`section-${id}-390`);
      }
      await navigate("workspace");
      const section = app.locator("#help-workspace");
      await section.locator("[data-help-expand]").click();
      assert.equal(await section.locator("details:not([open])").count(), 0);
      await section.locator("[data-help-collapse]").click();
      assert.equal(await section.locator("details[open]").count(), 0);
      const lastJump = section.locator("[data-help-topic-target]").last();
      const topicId = await lastJump.getAttribute("data-help-topic-target");
      await lastJump.click();
      assert.equal(await app.locator(`#${topicId}`).getAttribute("open"), "");
      assert.equal(await app.locator(`#${topicId} summary`).evaluate(el => el === document.activeElement), true);
      assert.equal(await app.locator(`#${topicId} summary`).evaluate(el => {
        const a = el.getBoundingClientRect(), b = el.closest(".help-main").getBoundingClientRect();
        return a.top >= b.top && a.top < b.bottom;
      }), true, "jump must reveal the instruction in the reading pane");
      await page.keyboard.press("Enter");
      assert.equal(await app.locator(`#${topicId}`).getAttribute("open"), null);
      const search = app.locator("[data-help-search]");
      await search.fill("времени УЧЁТ");
      assert.equal(await app.locator("#help-timetracking").isVisible(), true);
      assert.equal(await app.locator("#help-timetracking details[open]").count(), 7);
      await fit("search-results-390");
      await page.screenshot({ path: path.join(out, "search-390.png") });
      await search.fill("несуществующий-запрос");
      assert.equal(await app.locator("[data-help-empty]").isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await search.inputValue(), "");
      assert.equal(await section.isVisible(), true, "clearing search must restore the section being read");
      assert.equal(await app.locator("#help-timetracking details[open]").count(), 0);
      checks.push("search-cross-section-empty-escape-restores-state", "jump-expand-collapse-keyboard");
      await size(390);
      await page.evaluate(() => { document.documentElement.style.setProperty("--zeter-text-scale", "1.5"); document.body.classList.add("zeter-high-contrast"); });
      await navigate("home"); await fit("home-150-percent-contrast");
      await navigate("timetracking"); await fit("section-150-percent-contrast");
      await page.screenshot({ path: path.join(out, "large-text-390.png") });
      await page.evaluate(() => { document.documentElement.style.removeProperty("--zeter-text-scale"); document.body.classList.remove("zeter-high-contrast"); });
      await size(620, 900, 420);
      await navigate("home"); await fit("short-window");
      await navigate("start");
      await size(1440);
      await page.screenshot({ path: path.join(out, "reading-1440.png") });
      await app.locator("#help-start .help-section-pager button").last().click();
      assert.equal(await section.isVisible(), true, "next section must follow the contents order");
      await navigate("safety");
      const firstTopic = app.locator("#help-safety details").first();
      await firstTopic.locator("summary").click();
      const appAction = firstTopic.locator("[data-help-app]");
      const appId = await appAction.getAttribute("data-help-app");
      await appAction.click();
      assert.equal(await page.locator(`.window[data-app-id="${appId}"]`).isVisible(), true);
      checks.push("pager-order-and-real-app-opening");
      assert.deepEqual(errors, [], "page must have no JavaScript errors");
      const crypto = require("node:crypto");
      const sources = Object.fromEntries(["app/js/core/help-content.js", "app/css/40-app-foundation.css"].map(name => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex")]));
      fs.writeFileSync(path.join(out, "result.json"), JSON.stringify({ status: "PASS", sources, checks, errors }, null, 2));
      console.log(`Help guide browser: PASS (${checks.length} checks)`);
    } catch (error) {
      await page.screenshot({ path: path.join(out, "failure.png") });
      fs.writeFileSync(path.join(out, "failure.json"), JSON.stringify({ checks, error: error.message, errors }, null, 2));
      throw error;
    } finally { await context.close(); }
  } finally { if (browser) await browser.close(); await preview.close(); }
}

module.exports = { runHelpSmoke };
