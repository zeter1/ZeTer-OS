"use strict";
// Import is read-only. Explicit execution serves only generated manifest paths
// on loopback; browser state belongs to disposable contexts, never user data/.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const sha = value => createHash("sha256").update(value).digest("hex");

async function runWebCacheSmoke({ chromium, outputDir } = {}) {
  const root = path.resolve(__dirname, "../app");
  const out = outputDir || path.resolve(__dirname, "../work/web-cache-qa");
  fs.mkdirSync(out, {recursive: true});
  const original = JSON.parse(fs.readFileSync(path.join(root, "web-release.json"), "utf8"));
  const filesA = new Map(original.files.map(file => [file.path, fs.readFileSync(path.join(root, file.path))]));
  for (const file of original.files) assert.equal(sha(filesA.get(file.path)), file.sha256, `fresh source: ${file.path}`);
  const versionB = "9.0.1"; // Fixture identity only; never written into the project.
  const filesB = new Map(filesA);
  filesB.set("js/core/version.js", Buffer.from(`window.ZETER_OS_VERSION = "${versionB}";\n`));
  filesB.set("js/app.js", Buffer.concat([filesA.get("js/app.js"), Buffer.from("\n// fixture B\n")]));
  const entriesB = [...filesB].sort(([a], [b]) => a < b ? -1 : 1).map(([name, bytes]) => ({path: name, size: bytes.length, sha256: sha(bytes)}));
  const manifestB = {...original, version: versionB, build: sha(JSON.stringify(entriesB)), files: entriesB};
  let published = {files: filesA, manifest: original}, corrupt = "", legacyMode = false;
  const requests = [], results = [], errors = [], diagnostics = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const prefix = "/portfolio/ZeTerOS/";
    if (!["GET", "HEAD"].includes(request.method) || !url.pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    const name = url.pathname.slice(prefix.length) || "index.html";
    requests.push({path: name, query: url.search});
    let bytes = name === "web-release.json" ? Buffer.from(JSON.stringify(published.manifest)) : published.files.get(name);
    if (legacyMode && name === "index.html") bytes = Buffer.from('<!doctype html><meta charset="utf-8"><textarea id="legacy-draft">Старый черновик</textarea><script src="legacy-setup.js"></script>');
    if (legacyMode && name === "legacy-setup.js") bytes = Buffer.from('navigator.serviceWorker.register("service-worker.js");');
    if (legacyMode && name === "service-worker.js") bytes = Buffer.from('self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(new URL(e.request.url).pathname.endsWith("/late.txt"))e.respondWith(new Response("legacy-owned"));});');
    if (name === corrupt) bytes = Buffer.from("<html>server error returned as 200</html>");
    if (!bytes) { response.writeHead(404); response.end("missing"); return; }
    const types = {html: "text/html", js: "application/javascript", json: "application/json", css: "text/css", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon"};
    // Long-lived HTTP cache mimics the relevant uCoz boundary.
    response.writeHead(200, {"Content-Type": types[name.split(".").pop()] || "application/octet-stream", "Cache-Control": "public, max-age=1728000"});
    response.end(request.method === "HEAD" ? undefined : bytes);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${server.address().port}/portfolio/ZeTerOS/index.html`;
  let browser;
  const ready = async (page, version) => {
    await page.waitForFunction(expected => window.ZETER_OS_VERSION === expected && document.querySelector("#boot")?.classList.contains("done"), version, {timeout: 120000});
    assert.equal(new URL(page.url()).pathname, "/portfolio/ZeTerOS/index.html");
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  };
  try {
    browser = await chromium.launch({headless: false, chromiumSandbox: true});
    const legacyContext = await browser.newContext({serviceWorkers:"allow"});
    legacyMode = true;
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(target);
    await legacyPage.waitForFunction(() => navigator.serviceWorker.controller);
    legacyMode = false;
    await legacyPage.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await legacyPage.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting), null, {timeout:30000});
    assert.equal(await legacyPage.locator("#legacy-draft").inputValue(), "Старый черновик");
    assert.equal(await legacyPage.evaluate(async () => (await fetch("late.txt")).text()), "legacy-owned", "legacy worker retains its running tab");
    await legacyPage.close();
    const migrated = await legacyContext.newPage();
    await migrated.goto(target);
    await ready(migrated,original.version);
    results.push("legacy worker waits for old draft tab to close; ordinary next open migrates: PASS");
    await legacyContext.close();
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: "allow"});
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (["warning","error"].includes(message.type())) diagnostics.push(message.text()); });
    await page.goto(target + "?sample=kept#anchor");
    await page.waitForFunction(() => window.ZETER_OS_VERSION || document.querySelector("[data-web-retry]"), null, {timeout: 30000});
    if (await page.locator("[data-web-retry]").count()) throw new Error(await page.locator(".boot-card").innerText());
    await ready(page, original.version);
    assert.equal(new URL(page.url()).searchParams.get("sample"), "kept");
    assert.equal(new URL(page.url()).hash, "#anchor");
    assert.equal(new URL(page.url()).searchParams.has("__zeter_ready"), false);
    await page.evaluate(async () => {
      localStorage.setItem("web-test-sentinel", "keep-me");
      const db = await new Promise((resolve, reject) => {const req=indexedDB.open("web-test-sentinel",1);req.onupgradeneeded=()=>req.result.createObjectStore("s");req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction("s","readwrite");tx.objectStore("s").put("keep-db","key");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
      const input = document.createElement("textarea"); input.dataset.webTestDraft="true"; input.value="Несохранённый черновик"; document.body.appendChild(input); input.focus();
      await (await caches.open("foreign-app-cache")).put(location.origin+"/foreign-sentinel",new Response("foreign-sentinel"));
    });
    results.push("clean first install, verified startup, query/hash: PASS");
    const fresh = await browser.newContext({serviceWorkers: "allow"});
    // Pointer still A while some server files already B.
    published = {files: filesB, manifest: original};
    const partial = await fresh.newPage();
    await partial.goto(target);
    await partial.locator("[data-web-retry]").waitFor({timeout: 120000});
    assert.equal(await partial.evaluate(() => typeof window.ZETER_OS_VERSION), "undefined");
    results.push("first visitor during incomplete upload: no app execution: PASS");
    await fresh.close();
    const other = await context.newPage();
    other.on("pageerror", error => errors.push(error.message));
    await other.goto(target);
    await ready(other, original.version);
    published = {files: filesB, manifest: manifestB}; corrupt = "js/app.js";
    await other.reload(); // Ordinary reload, never Ctrl+F5.
    await ready(other, original.version);
    results.push("HTML-200/wrong hash rejected, complete A retained: PASS");
    corrupt = "";
    await other.reload();
    await ready(other, versionB);
    await page.evaluate(() => {
      window.__webCheckEvents=[];
      document.addEventListener("visibilitychange",()=>window.__webCheckEvents.push(document.visibilityState));
      window.addEventListener("online",()=>window.__webCheckEvents.push("online"));
    });
    await page.bringToFront();
    diagnostics.push(await page.evaluate(() => {
      window.__webFocusBeforeNotice=document.activeElement;
      return {visibility:document.visibilityState,events:window.__webCheckEvents,controller:Boolean(navigator.serviceWorker.controller),
        draftFocused:document.activeElement?.matches("[data-web-test-draft]"),modalOpen:Boolean(document.querySelector("dialog[open]")),focusTag:document.activeElement?.tagName};
    }));
    // Chromium may keep a separate window visible across bringToFront. A real
    // offline→online transition deterministically exercises the other trigger.
    await context.setOffline(true);
    await context.setOffline(false);
    await page.locator("[data-web-update-notice]").waitFor({timeout: 30000});
    assert.match(await page.locator("[data-web-update-notice]").innerText(), /Ctrl\+F5 не нужен/);
    assert.equal(await page.evaluate(() => window.ZETER_OS_VERSION), original.version);
    assert.equal(await page.locator("[data-web-test-draft]").inputValue(), "Несохранённый черновик");
    assert.equal(await page.evaluate(() => document.activeElement === window.__webFocusBeforeNotice), true, "notice preserves the actual pre-notification focus");
    await page.setViewportSize({width:390,height:844});
    const noticeBox = await page.locator("[data-web-update-notice]").boundingBox();
    assert.ok(noticeBox.x>=0 && noticeBox.x+noticeBox.width<=390, "notice fits narrow viewport");
    assert.equal(await page.locator("[data-web-update-notice] button").evaluate(element => {
      const rect=element.getBoundingClientRect();
      return document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===element;
    }),true,"notice dismiss control is above the modal top layer");
    await page.screenshot({path:path.join(out,"notice-narrow.png")});
    await page.locator("[data-web-update-notice] button").click();
    await page.evaluate(() => new Promise(resolve => {
      const modal=document.querySelector("dialog[open]");
      if (!modal) { resolve(); return; }
      modal.addEventListener("close",resolve,{once:true}); modal.close();
    }));
    assert.equal(await page.locator("[data-web-update-notice]").count(),0,"dismissed notice must not reappear when modal closes");
    // Late static request must still be pinned to A.
    assert.equal(await page.evaluate(async () => (await fetch("js/core/version.js")).text()), filesA.get("js/core/version.js").toString());
    assert.equal(await other.evaluate(async () => (await fetch("js/core/version.js")).text()), filesB.get("js/core/version.js").toString());
    results.push("ordinary F5 installs B; A announces update, draft and late requests unchanged: PASS");
    await context.setOffline(true);
    await other.reload();
    await ready(other, versionB);
    assert.equal(await other.evaluate(() => localStorage.getItem("web-test-sentinel")), "keep-me");
    assert.equal(await other.evaluate(async () => {
      const db = await new Promise(resolve=>{const req=indexedDB.open("web-test-sentinel",1);req.onsuccess=()=>resolve(req.result);});
      const value=await new Promise(resolve=>{const req=db.transaction("s").objectStore("s").get("key");req.onsuccess=()=>resolve(req.result);});db.close();return value;
    }), "keep-db");
    assert.equal(await other.evaluate(async () => (await (await caches.open("foreign-app-cache")).match(location.origin+"/foreign-sentinel")).text()), "foreign-sentinel");
    results.push("offline B, localStorage/IndexedDB and foreign cache preserved: PASS");
    await other.screenshot({path: path.join(out,"offline-wide.png")});
    await context.setOffline(false);
    await other.setViewportSize({width:390,height:844});
    await other.reload(); await ready(other, versionB);
    await other.screenshot({path: path.join(out,"narrow.png")});
    assert.equal(errors.length, 0, errors.join("\n"));
    results.push("390px startup and no page errors: PASS");
    await context.close();
    fs.writeFileSync(path.join(out,"result.json"),JSON.stringify({results, errors, diagnostics, requests},null,2));
    console.log(results.join("\n"));
    return {results,errors};
  } catch (error) {
    if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
      diagnostics.push(await page.evaluate(() => ({url:location.href,visibility:document.visibilityState,events:window.__webCheckEvents,notice:Boolean(document.querySelector("[data-web-update-notice]"))})).catch(()=>({closed:true})));
    }
    fs.writeFileSync(path.join(out,"failure.json"),JSON.stringify({error:error.stack,results,errors,diagnostics,requests},null,2));
    throw error;
  } finally { if (browser) await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
module.exports = { runWebCacheSmoke };
