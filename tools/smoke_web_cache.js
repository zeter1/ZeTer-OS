"use strict";
// No app startup or user storage: real worker in an isolated in-memory origin.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = "https://fixture.test/portfolio/ZeTerOS/";
const workerSource = fs.readFileSync(require("node:path").join(__dirname, "../app/service-worker.js"), "utf8");
const stores = new Map();
const key = value => new URL(typeof value === "string" ? value : value.url, root).href;
const caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async match(request) { return data.get(key(request))?.clone(); },
      async put(request, response) { data.set(key(request), response.clone()); },
      async delete(request) { return data.delete(key(request)); }
    };
  },
  async keys() { return [...stores.keys()]; },
  async delete(name) { return stores.delete(name); }
};
const sha = async bytes => Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
async function release(label) {
  const files = new Map([
    ["index.html", `<html><head></head><body>${label}</body></html>`],
    ["js/app.js", `/* ${label} */`],
    ["js/core/version.js", `window.ZETER_OS_VERSION="${label}";`],
    ["js/web-bootstrap.js", "// gate"],
    ["manifest.json", "{}"],
    ["service-worker.js", workerSource]
  ]);
  const entries = [];
  for (const [path, source] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const bytes = Buffer.from(source);
    entries.push({ path, size: bytes.length, sha256: await sha(bytes) });
  }
  entries.sort((a,b) => a.path < b.path ? -1 : 1);
  const manifest = { schema: 1, runtime: 1, version: label, build: await sha(Buffer.from(JSON.stringify(entries))), files: entries };
  return { files, manifest };
}
let published, offline = false, corrupt = "", manifestOverride = null;
let runtimeClients = [], skips = 0, oversized = false, cancelled = false, chunksRead = 0;
const handlers = {};
let networkRequests = 0;
function startWorker() {
  vm.runInNewContext(workerSource, {
    URL, URLSearchParams, Request, Response, Headers, TextEncoder, TextDecoder, AbortController,
    crypto: webcrypto, caches, console, setTimeout, clearTimeout,
    self: { registration: { scope: root }, location: { origin: "https://fixture.test" },
      clients: { matchAll: async () => runtimeClients }, skipWaiting: async () => { skips++; },
      addEventListener: (type, handler) => { handlers[type] = handler; } },
    fetch: async request => {
      networkRequests++;
      if (offline) throw new Error("offline");
      const url = new URL(typeof request === "string" ? request : request.url);
      const path = url.pathname.slice(new URL(root).pathname.length);
      if (path === "web-release.json" && oversized) return new Response(new ReadableStream({
        pull(controller) { chunksRead++; controller.enqueue(new Uint8Array(256 * 1024)); },
        cancel() { cancelled = true; }
      }, {highWaterMark: 0}));
      if (path === "web-release.json") return Response.json(manifestOverride || published.manifest);
      if (!published.files.has(path)) return new Response("missing", { status: 404 });
      return new Response(path === corrupt ? "wrong bytes" : published.files.get(path));
    }
  });
}
async function request(path, clientId = "", navigating = false, newId = "") {
  let result;
  const waits = [];
  const req = { url: new URL(path, root).href, method: "GET", mode: navigating ? "navigate" : "cors" };
  handlers.fetch({ request: req, clientId, resultingClientId: newId,
    respondWith: promise => { result = promise; }, waitUntil: p => waits.push(p) });
  const response = await result;
  await Promise.all(waits);
  return response;
}
(async () => {
  const A = await release("1.0.0"), B = await release("1.0.1");
  published = A;
  startWorker();
  const foreign = await caches.open("another-app-cache");
  await foreign.put(root, new Response("sentinel"));
  let activation;
  handlers.activate({ waitUntil: promise => { activation = promise; } });
  await activation;
  assert.equal(await (await foreign.match(root)).text(), "sentinel", "foreign cache preserved");
  let response = await request("index.html", "", true, "client-A");
  assert.equal(response.status, 200, "first complete installation");
  assert.match(await response.text(), /zeter-web-build/);
  published = { files: B.files, manifest: A.manifest };
  response = await request("index.html", "", true, "during-upload");
  assert.match(await response.text(), /1.0.0/, "old snapshot survives partial upload");
  published = B; corrupt = "js/app.js";
  response = await request("index.html", "", true, "bad-B");
  assert.match(await response.text(), /1.0.0/, "hash mismatch cannot activate B");
  corrupt = "";
  response = await request("index.html", "", true, "client-B");
  assert.match(await response.text(), /1.0.1/, "ordinary navigation updates");
  startWorker(); // Browser may terminate worker at any time: bindings must be durable.
  assert.equal(await (await request("js/app.js", "client-A")).text(), "/* 1.0.0 */");
  assert.equal(await (await request("js/app.js", "client-B")).text(), "/* 1.0.1 */");
  runtimeClients = [{id:"legacy",url:root+"releases/old/index.html"}];
  let installation;
  handlers.install({waitUntil: promise => {installation=promise;}});
  await installation;
  assert.equal(skips,0,"unknown running legacy tab prevents accelerated activation");
  runtimeClients = [{id:"client-A",url:root+"index.html"}];
  handlers.install({waitUntil: promise => {installation=promise;}});
  await installation;
  assert.equal(skips,1,"known snapshot tab permits compatible worker replacement");
  oversized = true;
  response = await request("index.html", "", true, "oversized-response");
  assert.match(await response.text(), /1.0.1/);
  assert.equal(cancelled,true,"oversized body is cancelled while streaming");
  assert.ok(chunksRead<=3,"manifest stops at bounded size before reading whole body");
  oversized = false;
  offline = true;
  response = await request("index.html", "", true, "offline");
  assert.match(await response.text(), /1.0.1/, "offline uses complete snapshot");
  const before = networkRequests;
  response = await request("js/app.js", "unknown-client");
  assert.equal(response.status, 503, "unknown clients never receive mixed scripts");
  assert.equal(networkRequests, before, "no network fallback for static resources");
  stores.clear();
  offline = false; corrupt = "js/app.js";
  response = await request("index.html", "", true, "fresh-partial");
  assert.equal(response.status, 503, "new visitor waits during incomplete upload");
  assert.doesNotMatch(await response.text(), /<script src="js\/app.js"/);
  corrupt = "";
  manifestOverride = { ...B.manifest, files: [...B.manifest.files, {path: "../outside.js", size: 1, sha256: "0".repeat(64)}] };
  response = await request("index.html", "", true, "bad-path");
  assert.equal(response.status, 503, "manifest paths must remain in scope");
  console.log("web cache: snapshots, partial upload, integrity, update, durable client pinning, offline, scope: PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
