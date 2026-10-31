const ZETER_CACHE_REVISION = "web-snapshots-1";
const ZETER_CACHE = "zeter-os-4.0.101-web-snapshots-1";
const ZETER_ASSETS = [
  "./",
  "./index.html",
  "./js/web-bootstrap.js",
  "./css/style.css",
  "./css/00-base.css",
  "./css/10-shell.css",
  "./css/20-windows.css",
  "./css/30-app-common.css",
  "./css/40-app-foundation.css",
  "./css/41-first-run.css",
  "./css/45-form-controls.css",
  "./css/50-explorer.css",
  "./css/60-apps-calendar-notes-tables.css",
  "./css/61-tasks.css",
  "./css/80-overrides.css",
  "./css/85-explorer-plus.css",
  "./css/90-security.css",
  "./css/95-mobile.css",
  "./assets/icons/mobile-search.svg",
  "./assets/icons/mobile-menu.svg",
  "./assets/icons/mobile-apps.svg",
  "./assets/icons/mobile-notifications.svg",
  "./js/core/boot-guard.js",
  "./js/core/version.js",
  "./js/core/config.js",
  "./js/core/utils.js",
  "./js/core/system-settings-utils.js",
  "./js/core/shortcut-utils.js",
  "./js/core/link-library-utils.js",
  "./js/core/link-library-ui-utils.js",
  "./js/core/prompt-library-utils.js",
  "./js/core/contacts-utils.js",
  "./js/core/contacts-ui-utils.js",
  "./css/69-contacts.css",
  "./js/core/prompt-library-ui-utils.js",
  "./js/core/business-calculations-utils.js",
  "./js/core/business-calculations-ui-utils.js",
  "./js/core/time-tracking-utils.js",
  "./js/core/project-overview-utils.js",
  "./js/core/time-tracking-ui-utils.js",
  "./css/68-time-tracking.css",
  "./css/67-business-calculations.css",
  "./css/65-link-library.css",
  "./css/66-prompt-library.css",
  "./js/core/first-run-ui-utils.js",
  "./js/core/context-menu-ui-utils.js",
  "./js/core/explorer-tab-utils.js",
  "./js/core/explorer-ui-utils.js",
  "./js/core/pinning-utils.js",
  "./js/core/deletion-utils.js",
  "./js/core/desktop-layout-utils.js",
  "./js/core/item-drag-ui-utils.js",
  "./js/core/window-metrics-utils.js",
  "./js/core/window-session-utils.js",
  "./js/core/window-ui-utils.js",
  "./js/core/sticky-utils.js",
  "./js/core/native-storage.js",
  "./js/core/managed-file-utils.js",
  "./js/core/storage-utils.js",
  "./js/core/asset-utils.js",
  "./js/core/security-protection-utils.js",
  "./js/core/visual-utils.js",
  "./js/core/shell-ui-utils.js",
  "./js/core/item-customization-utils.js",
  "./js/core/desktop-profile-utils.js",
  "./js/core/desktop-ui-utils.js",
  "./js/core/preferences-writer-utils.js",
  "./js/core/start-ui-utils.js",
  "./js/core/file-import-utils.js",
  "./js/core/file-template-utils.js",
  "./js/core/rich-text-utils.js",
  "./js/core/markdown-utils.js",
  "./js/core/automation-utils.js",
  "./js/core/automation-ui-utils.js",
  "./js/core/object-link-utils.js",
  "./js/core/object-link-ui-utils.js",
  "./js/core/editor-ui-utils.js",
  "./js/core/data-normalizers.js",
  "./js/core/workspace-utils.js",
  "./js/core/state-maintenance-utils.js",
  "./js/core/task-ui-utils.js",
  "./js/core/project-overview-ui-utils.js",
  "./js/core/task-app-ui-utils.js",
  "./js/core/calendar-utils.js",
  "./js/core/calendar-ui-utils.js",
  "./js/core/notification-utils.js",
  "./js/core/notification-ui-utils.js",
  "./js/core/import-utils.js",
  "./js/core/state-import-validator.js",
  "./js/core/export-utils.js",
  "./js/core/download-utils.js",
  "./js/core/security-utils.js",
  "./js/core/security-restore-utils.js",
  "./js/core/security-vault-utils.js",
  "./js/core/security-recovery-utils.js",
  "./js/core/cloud-payload-utils.js",
  "./js/core/google-drive-sync-utils.js",
  "./js/core/google-drive-backup-utils.js",
  "./google-drive-config.json",
  "./js/core/security-ui-utils.js",
  "./js/core/readable-export-utils.js",
  "./js/core/table-utils.js",
  "./js/core/xlsx-utils.js",
  "./js/core/table-ui-utils.js",
  "./js/core/table-app-interactions.js",
  "./js/core/calculator-utils.js",
  "./js/core/calculator-ui-utils.js",
  "./js/core/app-catalog.js",
  "./js/core/item-metadata.js",
  "./js/core/item-properties-ui-utils.js",
  "./js/core/fs-item-utils.js",
  "./js/core/explorer-utils.js",
  "./js/core/help-content.js",
  "./js/core/monitor-utils.js",
  "./js/core/photo-ui-utils.js",
  "./js/core/settings-ui-utils.js",
  "./js/core/about-ui-utils.js",
  "./js/core/update-ui-utils.js",
  "./js/update-probe.js",
  "./update-probe.html",
  "./js/core/app-center-ui-utils.js",
  "./js/core/search-utils.js",
  "./js/core/initial-state-utils.js",
  "./js/core/state-migration-utils.js",
  "./js/core/search-ui-utils.js",
  "./js/app.js",
  "./assets/icons/zeter-logo.svg",
  "./assets/icons/zeter-mark.svg",
  "./assets/icons/zeter-icon.ico",
  "./assets/icons/zeter-icon-32.png",
  "./assets/icons/zeter-icon-180.png",
  "./assets/icons/zeter-icon-192.png",
  "./assets/icons/zeter-icon-512.png",
  "./assets/icons/zeter-icon-maskable-512.png",
  "./manifest.json"
];
// ZETER_ASSETS above is the static dependency contract checked by check_project.
// Exact bytes of ALL public app files belong to generated web-release.json.
const WEB_SCOPE = self.registration.scope;
const WEB_PREFIX = `zeter-web-v1:${WEB_SCOPE}:`;
const WEB_META = `${WEB_PREFIX}meta`;
const WEB_MARKER = new URL("__zeter_complete__", WEB_SCOPE).href;
const WEB_ACTIVE = new URL("__zeter_active__", WEB_SCOPE).href;
const WEB_JOBS = new Map();
const WEB_TIMEOUT = 20000;
const WEB_MAX_BYTES = 200 * 1024 * 1024;
const webUrl = path => new URL(path, WEB_SCOPE).href;
const webCache = build => `${WEB_PREFIX}${build}`;
const webDigest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");

async function webFetch(path, nonce = "", maxBytes = WEB_MAX_BYTES) {
  const url = new URL(path, WEB_SCOPE);
  url.searchParams.set("__zeter_fetch", `${nonce ? nonce + "-" : ""}${Date.now()}-${Math.random()}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEB_TIMEOUT);
  try {
    const response = await fetch(url.href, { cache: "no-store", redirect: "error", credentials: "same-origin", signal: controller.signal });
    if (!response.ok || response.redirected || response.type === "opaque") throw new Error(`Не получен файл ${path}`);
    // Read body before releasing timeout; a stalled body is also a failed download.
    const declared = Number(response.headers.get("content-length"));
    if (!response.headers.get("content-encoding") && declared > maxBytes) { await response.body?.cancel(); throw new Error("Слишком большой ответ сервера"); }
    const reader = response.body?.getReader();
    const chunks = []; let length = 0;
    if (reader) {
      try {
        while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maxBytes) { await reader.cancel(); throw new Error("Слишком большой ответ сервера"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    const merged = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const bytes = merged.buffer;
    return { bytes, headers: response.headers };
  } finally { clearTimeout(timer); }
}

async function webValidateManifest(value) {
  if (!value || value.schema !== 1 || value.runtime !== 1 || !/^\d+\.\d+\.\d+$/.test(value.version) ||
      !/^[a-f0-9]{64}$/.test(value.build) || !Array.isArray(value.files) || value.files.length < 6 || value.files.length > 1000) {
    throw new Error("Неподдерживаемый список файлов веб-версии");
  }
  let total = 0, previous = "";
  const entries = value.files.map(file => {
    if (!file || typeof file.path !== "string" || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/.test(file.path) ||
        file.path <= previous || file.path === "web-release.json" || !Number.isSafeInteger(file.size) || file.size < 0 ||
        file.size > WEB_MAX_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Некорректный путь или размер файла веб-версии");
    previous = file.path; total += file.size;
    return { path: file.path, size: file.size, sha256: file.sha256 };
  });
  if (total > WEB_MAX_BYTES) throw new Error("Веб-версия превышает 200 МБ");
  for (const required of ["index.html", "js/app.js", "js/core/version.js", "js/web-bootstrap.js", "manifest.json", "service-worker.js"]) {
    if (!entries.some(file => file.path === required)) throw new Error(`Нет обязательного файла ${required}`);
  }
  if (await webDigest(new TextEncoder().encode(JSON.stringify(entries))) !== value.build) throw new Error("Неверный идентификатор веб-версии");
  return { schema: 1, runtime: 1, version: value.version, build: value.build, files: entries };
}

async function webManifest() {
  const { bytes } = await webFetch("web-release.json", "", 512 * 1024);
  if (bytes.byteLength > 512 * 1024) throw new Error("Слишком большой список файлов");
  return webValidateManifest(JSON.parse(new TextDecoder().decode(bytes)));
}

async function webComplete(build) {
  if (!/^[a-f0-9]{64}$/.test(build || "")) return null;
  const response = await (await caches.open(webCache(build))).match(WEB_MARKER);
  if (!response) return null;
  const manifest = await webValidateManifest(await response.json());
  return manifest.build === build ? manifest : null;
}

async function webCurrent() {
  const pointer = await (await caches.open(WEB_META)).match(WEB_ACTIVE);
  if (!pointer) return null;
  return webComplete((await pointer.json()).build);
}

async function webPrepare() {
  const manifest = await webManifest();
  if (WEB_JOBS.has(manifest.build)) return WEB_JOBS.get(manifest.build);
  const task = (async () => {
    const cache = await caches.open(webCache(manifest.build));
    if (!await webComplete(manifest.build)) {
      const old = await webCurrent();
      const oldCache = old ? await caches.open(webCache(old.build)) : null;
      let cursor = 0;
      async function download() {
        while (cursor < manifest.files.length) {
          const file = manifest.files[cursor++];
          let response = await cache.match(webUrl(file.path));
          if (!response && oldCache && old.files.some(item => item.path === file.path && item.sha256 === file.sha256)) {
            response = await oldCache.match(webUrl(file.path));
          }
          let bytes, headers;
          if (response) { bytes = await response.arrayBuffer(); headers = response.headers; }
          else ({ bytes, headers } = await webFetch(file.path, file.sha256, file.size));
          if (bytes.byteLength !== file.size || await webDigest(bytes) !== file.sha256) throw new Error(`Файл ещё не обновлён или повреждён: ${file.path}`);
          // Use known types: some file managers return text/plain for JS/JSON.
          const types = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml" };
          const outputHeaders = new Headers(headers);
          const mime = types[file.path.split(".").pop()];
          if (mime) outputHeaders.set("Content-Type", mime);
          outputHeaders.delete("Content-Encoding"); outputHeaders.delete("Content-Length");
          outputHeaders.set("Cache-Control", "no-store");
          await cache.put(webUrl(file.path), new Response(bytes, { headers: outputHeaders }));
        }
      }
      const outcomes = await Promise.allSettled(Array.from({length: 4}, download));
      const failed = outcomes.find(item => item.status === "rejected");
      if (failed) throw failed.reason;
      // A second upload must not silently replace the pointer while we download.
      if ((await webManifest()).build !== manifest.build) throw new Error("На сайте началась загрузка другой версии");
      await cache.put(WEB_MARKER, Response.json(manifest));
    }
    await (await caches.open(WEB_META)).put(WEB_ACTIVE, Response.json({build: manifest.build}));
    return manifest;
  })();
  WEB_JOBS.set(manifest.build, task);
  try { return await task; } finally { WEB_JOBS.delete(manifest.build); }
}

async function webPin(clientId, build) {
  if (!clientId) throw new Error("Браузер не предоставил идентификатор вкладки");
  await (await caches.open(WEB_META)).put(webUrl(`__zeter_client__/${encodeURIComponent(clientId)}`), Response.json({build}));
}

async function webPinned(clientId) {
  if (!clientId) return null;
  const response = await (await caches.open(WEB_META)).match(webUrl(`__zeter_client__/${encodeURIComponent(clientId)}`));
  return response ? webComplete((await response.json()).build) : null;
}

function webUnavailable() {
  return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Обновление ZeTer OS</title><body><h1>ZeTer OS обновляется</h1><p>Полная версия пока недоступна. Дождитесь окончания загрузки файлов и откройте страницу снова обычной кнопкой обновления. Ctrl+F5 и очистка данных не нужны.</p><p>Если загрузка уже завершена, проверьте подключение к интернету.</p><p><a href="./index.html">Открыть снова</a></p></body></html>', {
    status: 503, headers: {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'"}
  });
}

async function webNavigate(event) {
  let manifest;
  try { manifest = await webPrepare(); }
  catch (error) { console.warn("[ZeTer OS web update]", error.message); manifest = await webCurrent(); }
  if (!manifest) return webUnavailable();
  const cache = await caches.open(webCache(manifest.build));
  const response = await cache.match(webUrl("index.html"));
  if (!response) return webUnavailable();
  await webPin(event.resultingClientId, manifest.build);
  const html = (await response.text()).replace("</head>", `<meta name="zeter-web-build" content="${manifest.build}"></head>`);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length"); headers.set("Cache-Control", "no-store");
  return new Response(html, {headers});
}

self.addEventListener("install", event => event.waitUntil((async () => {
  const clients = await self.clients.matchAll({type: "window", includeUncontrolled: true});
  for (const client of clients) {
    if (!client.url.startsWith(WEB_SCOPE)) continue;
    const url = new URL(client.url);
    // A new inert gate is safe; an unknown running legacy tab must keep its
    // original worker until closed. Known snapshot clients have durable pins.
    if (url.searchParams.get("__zeter_gate") === "1" || await webPinned(client.id)) continue;
    return;
  }
  await self.skipWaiting();
})()));
// No clients.claim: an uncontrolled page performs its own single navigation.
// Keep all existing snapshots and foreign caches; never reset browser state.
self.addEventListener("activate", event => event.waitUntil(Promise.resolve()));
self.addEventListener("message", event => {
  if (event.data?.type !== "ZETER_WEB_CHECK") return;
  const port = event.ports?.[0];
  event.waitUntil((async () => {
    try {
      const manifest = await webPrepare();
      port?.postMessage({ok: true, runtime: 1, build: manifest.build, version: manifest.version});
    } catch (error) { port?.postMessage({ok: false, error: String(error.message).slice(0, 400)}); }
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !url.href.startsWith(WEB_SCOPE)) return;
  const path = url.pathname.slice(new URL(WEB_SCOPE).pathname.length);
  // The existing native flag belongs to the local Python server, never uCoz.
  if ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.searchParams.get("native") === "1") return;
  if (event.request.mode === "navigate" && (path === "" || path === "index.html")) {
    event.respondWith(webNavigate(event).catch(() => webUnavailable()));
    return;
  }
  if (path === "web-release.json" || path === "service-worker.js") return;
  event.respondWith((async () => {
    const manifest = await webPinned(event.clientId);
    if (!manifest || !manifest.files.some(file => file.path === path)) return new Response("Файлы вкладки недоступны. Откройте ZeTer OS снова.", {status: 503});
    // Queries do not select a different generation; the durable client pin does.
    return (await (await caches.open(webCache(manifest.build))).match(webUrl(path))) || new Response("Неполный локальный кэш", {status: 503});
  })().catch(() => new Response("Кэш недоступен", {status: 503})));
});
