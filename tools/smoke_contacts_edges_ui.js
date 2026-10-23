"use strict";
// Explicit browser checks. Import is inert; only synthetic state, no native APIs or user storage.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");

async function runContactsEdgesSmoke({ chromium, startPreview, outputDir } = {}) {
  const root = path.resolve(__dirname, ".."), out = outputDir || path.join(root, "work/contacts-bugs-qa/edges");
  fs.mkdirSync(out, { recursive: true });
  const preview = await startPreview({ root: path.join(root, "app"), allow: ["index.html", "js/core/utils.js", "js/core/contacts-utils.js", "js/core/contacts-ui-utils.js", "js/core/storage-utils.js", "css"], ttlSeconds: 600 });
  const checks = [], errors = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: false, chromiumSandbox: true });
    const cases = [
      ["stale editor cannot overwrite a contact changed in another window", async (page, app) => {
        await app.locator('[data-contact-action="edit"]').click();
        await app.locator('[name="role"]').fill("Несохранённая должность");
        await page.evaluate(async () => { await window.fixture.other.toggleFavorite("e1"); window.fixture.apps.forEach(app => app.refreshContacts()); });
        await app.locator("[data-contact-dialog-submit]").click();
        await app.locator("[data-contact-status]").filter({ hasText: /Сохранено|другом окне/ }).waitFor();
        const state = await page.evaluate(() => window.fixture.workspace.contacts.entries[0]);
        assert.equal(state.favorite, true, "stale editor silently reset another window's favorite");
        assert.equal(state.role, "Дизайнер");
        assert.equal(await app.locator('[name="role"]').inputValue(), "Несохранённая должность");
        assert.match(await app.locator("[data-contact-dialog-error]").innerText(), /другом окне/);
        await app.locator("[data-contact-dialog-cancel]").first().click();
        await app.locator('[data-contact-action="edit"]').click(); await app.locator('[name="role"]').fill("Новая должность");
        await app.locator("[data-contact-dialog-submit]").click(); await app.locator("dialog").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.fixture.workspace.contacts.entries[0].favorite), true);
      }],
      ["opening contact beyond first page also reveals selected row", async (page, app) => {
        await page.evaluate(() => {
          const { workspace, mount } = window.fixture;
          workspace.contacts.entries = Array.from({ length: 170 }, (_, i) => ({ ...workspace.contacts.entries[0], id: `entry${i}`, name: `Человек ${String(i).padStart(3, "0")}`, fields: [] }));
          mount({ entryId: "entry169" });
        });
        const selected = app.locator('[data-contact-open="entry169"]');
        assert.equal(await selected.count(), 1, "selected card has no row in the paged list");
        await page.waitForFunction(() => { const el = document.querySelector('[data-contact-open="entry169"]'); if (!el) return false; const row = el.getBoundingClientRect(), list = el.closest(".contacts-list").getBoundingClientRect(); return row.top >= list.top && row.bottom <= list.bottom; });
        assert.ok(await selected.evaluate(el => { const row = el.getBoundingClientRect(), list = el.closest(".contacts-list").getBoundingClientRect(); return row.top >= list.top && row.bottom <= list.bottom; }), "selected row must be visible in the scrolled list");
        assert.equal(await app.locator("[data-contact-open]").count(), 81, "opening a late contact must not render the whole directory");
        assert.equal(await selected.getAttribute("aria-pressed"), "true");
        assert.match(await app.locator("[data-contact-detail] h2").innerText(), /169/);
        assert.match(await app.locator('[data-contact-action="more"]').innerText(), /89/);
        await app.locator('[data-contact-action="more"]').click(); assert.equal(await app.locator("[data-contact-open]").count(), 161);
        await app.locator('[data-contact-action="more"]').click(); assert.equal(await app.locator("[data-contact-open]").count(), 170);
        assert.equal(await app.locator('[data-contact-action="more"]').count(), 0);
        assert.equal(await app.locator("[data-contact-open]").evaluateAll(rows => new Set(rows.map(row => row.dataset.contactOpen)).size), 170);
      }],
      ["short narrow window keeps contact list reachable", async (page, app) => {
        await page.setViewportSize({ width: 390, height: 340 });
        await page.evaluate(() => {
          document.querySelector("#fixture-host").style.height = "290px";
          document.querySelector('[data-contact-project="p1"]').click();
        });
        const size = await app.locator(".contacts-list").evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
        assert.ok(size.height >= 65, `list has no usable space: ${JSON.stringify(size)}`);
        await app.locator('[data-contact-open="e1"]').click();
        await app.locator('[data-contact-action="edit"]').click();
        await app.locator('[name="name"]').fill("Короткое окно");
        await app.locator("[data-contact-dialog-submit]").click(); await app.locator("dialog").waitFor({ state: "detached" });
      }],
      ["formatted phone with nonbreaking hyphens is searchable", async (page, app) => {
        await app.locator("[data-contact-search]").fill("+375 (29) 123\u201145\u201167");
        assert.equal(await app.locator('[data-contact-open="e1"]').count(), 1);
      }],
      ["unavailable project keeps draft and reopening uses current data", async (page, app) => {
        await app.locator('[data-contact-action="edit"]').click(); await app.locator('[name="role"]').fill("Черновик");
        await page.evaluate(async () => { await window.fixture.other.removeProject("p1"); window.fixture.apps.forEach(app => app.refreshContacts()); });
        assert.equal(await app.locator('[name="projectId"]').inputValue(), "p1");
        await app.locator("[data-contact-dialog-submit]").click();
        await app.locator("[data-contact-dialog-error]").waitFor({ state: "visible" });
        assert.equal(await app.locator('[name="role"]').inputValue(), "Черновик");
        assert.equal(await page.evaluate(() => window.fixture.workspace.contacts.entries[0].role), "Дизайнер");
        await app.locator("[data-contact-dialog-cancel]").first().click(); await app.locator('[data-contact-action="edit"]').click();
        assert.equal(await app.locator('[name="projectId"]').inputValue(), "");
        await app.locator('[name="role"]').fill("Черновик"); await app.locator("[data-contact-dialog-submit]").click(); await app.locator("dialog").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.fixture.workspace.contacts.entries[0].role), "Черновик");
      }],
      ["delete refusal preserves neighbors then explicit retry removes only target", async (page, app) => {
        await app.locator('[data-contact-action="delete"]').click();
        await page.evaluate(() => { window.fixture.refuse = true; });
        await app.locator("[data-contact-dialog-submit]").click(); await app.locator("[data-contact-dialog-error]").waitFor({ state: "visible" });
        assert.equal(await page.evaluate(() => window.fixture.workspace.contacts.entries.length), 2);
        await page.evaluate(() => { window.fixture.refuse = false; });
        await app.locator("[data-contact-dialog-submit]").click(); await app.locator("dialog").waitFor({ state: "detached" });
        assert.deepEqual(await page.evaluate(() => window.fixture.workspace.contacts.entries.map(row => row.id)), ["e2"]);
      }],
      ["duplicate project name rejection and corrected retry", async (page, app) => {
        await app.locator('[data-contact-action="project-add"]').first().click();
        await app.locator('[name="title"]').fill("  РАБОТА  "); await app.locator("[data-contact-dialog-submit]").click();
        await app.locator("[data-contact-dialog-error]").waitFor({ state: "visible" });
        assert.equal(await page.evaluate(() => window.fixture.workspace.contacts.projects.length), 1);
        await app.locator('[name="title"]').fill("Личное"); await app.locator("[data-contact-dialog-submit]").click();
        await app.locator("dialog").waitFor({ state: "detached" });
        assert.equal(await page.evaluate(() => window.fixture.workspace.contacts.projects.length), 2);
      }],
      ["user markup remains plain text and clipboard refusal is visible", async (page, app) => {
        await page.evaluate(() => { window.fixture.workspace.contacts.entries[0].name = '<img src=x onerror="window.injected=true">'; window.fixture.apps.forEach(app => app.refreshContacts()); });
        assert.equal(await app.locator("img").count(), 0); assert.equal(await page.evaluate(() => Boolean(window.injected)), false);
        await app.locator('[data-contact-copy="email"]').click();
        await app.locator("[data-contact-status].error").waitFor();
        assert.match(await app.locator("[data-contact-status]").innerText(), /clipboard/);
      }]
    ];
    for (const [index, [name, run]] of cases.entries()) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 850 }, serviceWorkers: "block" });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push({ name, message: error.message }));
      await page.route("**/*", route => {
        const url = route.request().url(); if (!url.startsWith(preview.url)) return route.abort();
        if (new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/css/style.css"><body><div id="fixture-host" style="width:100%;height:760px"></div><script src="/js/core/utils.js"></script><script src="/js/core/storage-utils.js"></script><script src="/js/core/contacts-utils.js"></script><script src="/js/core/contacts-ui-utils.js"></script></body></html>' });
        return route.continue();
      });
      try {
        await page.goto(preview.url);
        await page.evaluate(() => {
          const api = window.ZETER_CONTACTS_UTILS, workspace = { contacts: api.normalizeContacts({ projects: [{ id: "p1", name: "Работа" }], categories: [{ id: "c1", projectId: "p1", name: "Клиенты" }], entries: [{ id: "e1", name: "Алёна", projectId: "p1", categoryId: "c1", role: "Дизайнер", phone: "+375 (29) 123-45-67", email: "alena@example.invalid", favorite: false }, { id: "e2", name: "Борис", projectId: "", categoryId: "", favorite: false }] }) };
          let sequence = 0;
          const fixture = window.fixture = { workspace, apps: [], refuse: false };
          const queue = window.ZETER_STORAGE_UTILS.createPrimaryStateSaveQueue({ getState: () => workspace, nativeStorage: true, writePrimaryRecord: async () => { if (fixture.refuse) throw new Error("Запись недоступна"); return { updatedAt: Date.now() }; } });
          const make = () => api.createContactsController({ getWorkspace: () => workspace, createId: prefix => `${prefix}_${++sequence}`, persistTransaction: operation => queue.transaction(operation), saveSnapshot: (write, contacts) => write({ contacts }) });
          fixture.other = make();
          fixture.mount = (params = {}) => {
            fixture.apps = []; const host = document.querySelector("#fixture-host"); host.replaceChildren();
            const app = window.ZETER_CONTACTS_UI_UTILS.createContactsApp(params, { controller: make(), copyText: async () => { throw new Error("Тест: clipboard недоступен"); } });
            host.append(app); fixture.apps.push(app);
          };
          fixture.mount();
        });
        const app = page.locator(".contacts-app"); await run(page, app);
        if (index < 3) await page.screenshot({ path: path.join(out, `verified-${index + 1}.png`) });
        checks.push({ name, status: "PASS" }); console.log(`contacts edges PASS: ${name}`);
      } catch (error) {
        checks.push({ name, status: "FAIL", error: error.message }); console.log(`contacts edges FAIL: ${name}: ${error.message}`);
        await page.screenshot({ path: path.join(out, `failure-${index + 1}.png`) }).catch(() => {});
      } finally { await context.close(); }
    }
    const fingerprints = Object.fromEntries(["app/js/core/contacts-utils.js", "app/js/core/contacts-ui-utils.js", "app/css/69-contacts.css"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex")]));
    fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, errors, fingerprints }, null, 2));
    assert.equal(checks.filter(row => row.status === "FAIL").length, 0, "contacts edge scenarios failed; see results.json"); assert.deepEqual(errors, []);
    return { checks: checks.length, outputDir: out };
  } finally { if (browser) await browser.close(); await preview.close(); }
}
module.exports = { runContactsEdgesSmoke };
