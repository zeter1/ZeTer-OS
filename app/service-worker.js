const ZETER_CACHE = "zeter-os-3.89";
const ZETER_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./css/00-base.css",
  "./css/10-shell.css",
  "./css/20-windows.css",
  "./css/30-app-common.css",
  "./css/40-app-foundation.css",
  "./css/45-form-controls.css",
  "./css/50-explorer.css",
  "./css/60-apps-calendar-notes-tables.css",
  "./css/80-overrides.css",
  "./css/85-explorer-plus.css",
  "./css/90-security.css",
  "./js/core/boot-guard.js",
  "./js/core/version.js",
  "./js/core/config.js",
  "./js/core/utils.js",
  "./js/core/system-settings-utils.js",
  "./js/core/shortcut-utils.js",
  "./js/core/shell-ui-utils.js",
  "./js/core/first-run-ui-utils.js",
  "./js/core/context-menu-ui-utils.js",
  "./js/core/explorer-tab-utils.js",
  "./js/core/explorer-ui-utils.js",
  "./js/core/pinning-utils.js",
  "./js/core/trash-utils.js",
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
  "./js/core/item-customization-utils.js",
  "./js/core/desktop-profile-utils.js",
  "./js/core/desktop-ui-utils.js",
  "./js/core/start-ui-utils.js",
  "./js/core/file-import-utils.js",
  "./js/core/file-template-utils.js",
  "./js/core/rich-text-utils.js",
  "./js/core/markdown-utils.js",
  "./js/core/editor-ui-utils.js",
  "./js/core/data-normalizers.js",
  "./js/core/workspace-utils.js",
  "./js/core/state-maintenance-utils.js",
  "./js/core/task-ui-utils.js",
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
  "./js/core/app-center-ui-utils.js",
  "./js/core/search-utils.js",
  "./js/core/initial-state-utils.js",
  "./js/core/state-migration-utils.js",
  "./js/core/search-ui-utils.js",
  "./js/app.js",
  "./assets/icons/zeter-logo.svg",
  "./assets/icons/zeter-icon-192.png",
  "./assets/icons/zeter-icon-512.png",
  "./manifest.json"
];
const ZETER_ASSET_URLS = new Set(ZETER_ASSETS.map(path => new URL(path, self.registration.scope).href));
const ZETER_INSTALL_REQUESTS = ZETER_ASSETS.map(path => new Request(
  new URL(path, self.registration.scope).href,
  { cache: "reload" }
));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(ZETER_CACHE).then(cache => cache.addAll(ZETER_INSTALL_REQUESTS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== ZETER_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }

  url.search = "";
  url.hash = "";
  const cacheKey = url.href;
  if (!ZETER_ASSET_URLS.has(cacheKey)) return;

  event.respondWith(caches.open(ZETER_CACHE).then(async cache => {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === "basic") await cache.put(cacheKey, response.clone());
    return response;
  }));
});
