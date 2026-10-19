"use strict";

// Real generated worker, synthetic origin/caches/network. No browser/user data.
const vm = require("node:vm");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const worker = fs.readFileSync(0, "utf8");

async function scenario(failPrecache, reuseExisting = false) {
  const base = "https://example.test/portfolio/ZeTerOS/";
  const a = "v4-0-28-aaaaaaaaaaaaaaaa", b = "v0123456789abcd";
  const entryA = base + "releases/" + a + "/index.html";
  const entryB = base + "releases/" + b + "/index.html";
  const bootstrap = base + "releases/" + b + "/ucoz-entry.js";
  const slow = base + "releases/" + b + "/js/app.js";
  const complete = base + ".ucoz-complete";
  const stores = new Map();
  const events = new Map();
  let offline = false, skips = 0, claims = 0, slowFetches = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const keyOf = request => typeof request === "string" ? request : request.url;
  const network = async request => {
    const url = keyOf(request);
    if (offline) throw new Error("offline fixture");
    if (url.includes("release.json")) return Response.json({ schema: 1, build: b, entry: "releases/" + b + "/index.html" });
    if (url === entryB) return new Response("<!doctype html><html>new B</html>", { headers: { "Content-Type": "text/html" } });
    if (url === bootstrap) return new Response("// entry B", { headers: { "Content-Type": "application/javascript" } });
    if (url === slow) {
      slowFetches++;
      await held;
      return new Response(failPrecache ? "unavailable" : "// app B", { status: failPrecache ? 503 : 200 });
    }
    return new Response("missing fixture", { status: 404 });
  };
  const cacheApi = {
    keys: async () => [...stores.keys()],
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name);
      return {
        match: async request => map.get(keyOf(request))?.clone(),
        put: async (request, response) => { map.set(keyOf(request), response.clone()); },
        addAll: async requests => {
          const results = await Promise.all(requests.map(async request => {
            const response = await network(request);
            if (!response.ok) throw new Error("precache HTTP " + response.status);
            return [keyOf(request), response];
          }));
          for (const [key, response] of results) map.set(key, response.clone());
        }
      };
    }
  };
  stores.set("zeter-ucoz-/other/-foreign", new Map([[complete, new Response("vffffffffffffff")]]));
  stores.set("zeter-ucoz-/portfolio/ZeTerOS/-" + a, new Map([
    [complete, new Response(a)], [entryA, new Response("complete A")]
  ]));
  if (reuseExisting) {
    stores.set("zeter-ucoz-/portfolio/ZeTerOS/-" + b, new Map([
      [complete, new Response(b)], [entryB, new Response("complete B")],
      [bootstrap, new Response("// entry B")], [slow, new Response("// cached app B")]
    ]));
    release();
  }
  const sandbox = { URL, Request, Response, Date, Math, Set, Promise, fetch: network, caches: cacheApi,
    console: { ...console, warn() {} },
    self: { registration: { scope: base }, addEventListener: (name, handler) => events.set(name, handler),
      skipWaiting: async () => { skips++; }, clients: { claim: async () => { claims++; } } }
  };
  vm.createContext(sandbox);
  vm.runInContext("const BUILD=" + JSON.stringify(b) + ";const ASSETS=" + JSON.stringify([entryB, bootstrap, slow].map(url => url.slice(base.length))) + ";\n" + worker, sandbox);
  let installed = false;
  events.get("install")({ waitUntil: promise => { promise.then(() => { installed = true; }); } });
  await new Promise(setImmediate);
  assert.equal(installed, true, "worker install must finish while a noncritical resource is held");
  assert.equal(skips, 1);
  let activated;
  events.get("activate")({ waitUntil: promise => { activated = promise; } });
  await activated;
  assert.equal(claims, 1);
  const waits = [];
  const navigate = async () => {
    let response;
    events.get("fetch")({ request: { url: base + "index.html", method: "GET", mode: "navigate" },
      respondWith: promise => { response = promise; }, waitUntil: promise => waits.push(promise) });
    return response;
  };
  const response = await navigate();
  assert.equal(response.headers.get("Location"), entryB, "online navigation must reach B before full offline cache");
  await navigate();
  await new Promise(setImmediate);
  const current = [...stores.entries()].find(([key]) => key.includes(b) && key.endsWith("-r2"))[1];
  if (reuseExisting) {
    await Promise.all(waits);
    assert.equal(slowFetches, 0, "root-only hotfix must reuse already complete immutable app bytes");
    assert.equal(current.has(complete), true);
    return;
  }
  assert.equal(slowFetches, 1, "concurrent navigations must share one precache attempt");
  assert.equal(current.has(complete), false);
  offline = true;
  const fallback = await sandbox.navigate(new Request(base + "index.html"));
  assert.equal(fallback.headers.get("Location"), entryA, "incomplete B must retain full offline A from its own scope");
  offline = false;
  release();
  await Promise.all(waits);
  assert.equal(current.has(complete), !failPrecache, "only an entirely successful precache may be marked complete");
  offline = true;
  const final = await sandbox.navigate(new Request(base + "index.html"));
  assert.equal(final.headers.get("Location"), failPrecache ? entryA : entryB);
  assert.equal(stores.has("zeter-ucoz-/other/-foreign"), true, "foreign cache must remain untouched");
}

(async () => {
  await scenario(false);
  await scenario(true);
  await scenario(false, true);
  console.log("uCoz runtime: early activation, deduplicated precache, complete markers and scoped offline fallback: OK");
})().catch(error => { console.error(error); process.exitCode = 1; });
