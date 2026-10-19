(() => {
  "use strict";
  const scope = new URL("./", location.href);
  const native = location.protocol === "file:" ||
    (["127.0.0.1", "localhost"].includes(location.hostname) && new URLSearchParams(location.search).get("native") === "1");
  const packaged = Boolean(document.querySelector("base[data-zeter-ucoz]"));
  // Explicit localhost-only seam for the existing isolated UI tests, which
  // replace individual scripts and deliberately block Service Workers.
  const preview = ["127.0.0.1", "localhost"].includes(location.hostname) && window.__ZETER_UI_PREVIEW__ === true;
  const marker = document.querySelector('meta[name="zeter-web-build"]')?.content || "";
  const scripts = [...document.querySelectorAll('script[type="application/zeter-script"][src]')];
  let registration, checking = false;

  function status(message, retry = false) {
    const card = document.querySelector(".boot-card");
    const paragraph = card?.querySelector("p");
    if (paragraph) paragraph.textContent = message;
    if (retry && card && !card.querySelector("[data-web-retry]")) {
      const button = document.createElement("button");
      button.type = "button"; button.dataset.webRetry = "true"; button.textContent = "Повторить проверку";
      button.addEventListener("click", () => location.reload());
      card.appendChild(button);
    }
  }

  function messageWorker(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Проверка обновления не завершилась. Повторите открытие страницы.")); }, 180000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        event.data?.ok && event.data.runtime === 1 ? resolve(event.data) : reject(new Error(event.data?.error || "Обновление пока не готово"));
      };
      worker.postMessage({type: "ZETER_WEB_CHECK"}, [channel.port2]);
    });
  }

  async function loadScripts() {
    for (const original of scripts) {
      const script = document.createElement("script");
      script.src = original.src;
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error("Не удалось загрузить файл приложения"));
        original.after(script);
      });
    }
  }

  function offerUpdate(version) {
    const host = [...document.querySelectorAll("dialog[open]")].pop() || document.body;
    const existing = document.querySelector("[data-web-update-notice]");
    if (existing) { if (existing.parentElement !== host) host.appendChild(existing); return; }
    const notice = document.createElement("aside");
    notice.dataset.webUpdateNotice = "true"; notice.className = "web-update-notice";
    notice.setAttribute("role", "status");
    const text = document.createElement("span");
    text.textContent = `Доступна ZeTer OS ${version}. Сохраните работу и обновите страницу обычной кнопкой браузера. Ctrl+F5 не нужен.`;
    const close = document.createElement("button");
    close.type = "button"; close.textContent = "Закрыть";
    close.addEventListener("click", () => notice.remove());
    notice.append(text, close); host.appendChild(notice);
    if (host !== document.body) host.addEventListener("close", () => {
      if (notice.isConnected && notice.parentElement === host) document.body.appendChild(notice);
    }, {once: true});
  }

  async function checkUpdate() {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const result = await messageWorker(navigator.serviceWorker.controller);
      if (result.build !== marker) offerUpdate(result.version);
    } catch (error) { console.warn("[ZeTer OS web update]", error.message); }
    finally { checking = false; }
  }

  async function main() {
    if (native || packaged || preview) { await loadScripts(); return; }
    if (!window.isSecureContext || !("serviceWorker" in navigator)) throw new Error("Для веб-версии нужен HTTPS и браузер с поддержкой Service Worker.");
    document.documentElement.dataset.zeterWebManaged = "true";
    if (marker && navigator.serviceWorker.controller) {
      await loadScripts();
      void navigator.serviceWorker.register(new URL("service-worker.js", scope).href, {scope: scope.href, updateViaCache: "none"}).catch(error => console.warn("[ZeTer OS web runtime]", error.message));
      // Every ordinary navigation already checks the published manifest in worker.
      // Open tabs only announce a ready version; they never reload themselves.
      window.addEventListener("online", checkUpdate);
      document.addEventListener("visibilitychange", checkUpdate);
      setInterval(checkUpdate, 300000);
      return;
    }
    status("Проверяем и подготавливаем полную версию ZeTer OS…");
    const gateUrl = new URL(location.href);
    gateUrl.searchParams.set("__zeter_gate", "1");
    history.replaceState(history.state, "", gateUrl.href);
    registration = await navigator.serviceWorker.register(new URL("service-worker.js", scope).href, { scope: scope.href, updateViaCache: "none" });
    const worker = await new Promise((resolve, reject) => {
      const current = registration.installing || registration.waiting || registration.active;
      if (current?.state === "activated") { resolve(current); return; }
      const timer = setTimeout(() => reject(new Error("Не удалось включить обработчик обновлений")), 30000);
      function changed() {
        const candidate = registration.installing || registration.waiting || registration.active;
        if (candidate?.state === "activated") { clearTimeout(timer); resolve(candidate); }
        else if (candidate?.state === "installed" && registration.waiting && registration.active) { clearTimeout(timer); reject(new Error("Для первого перехода закройте все старые вкладки ZeTer OS, затем откройте сайт снова. Сначала сохраните работу.")); }
        else if (candidate?.state === "redundant") { clearTimeout(timer); reject(new Error("Обработчик обновлений недоступен")); }
      }
      current?.addEventListener("statechange", changed);
      registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", changed));
    });
    await messageWorker(worker);
    const target = new URL(location.href);
    if (target.searchParams.has("__zeter_ready")) throw new Error("Не удалось открыть проверенную версию. Повторите позже.");
    target.searchParams.set("__zeter_ready", "1");
    target.searchParams.delete("__zeter_gate");
    location.replace(target.href);
  }
  main().catch(error => status(`ZeTer OS пока не готова: ${error.message} Дождитесь завершения загрузки файлов на сайт. Ctrl+F5 и очистка данных не нужны.`, true));
  // Only remove our loop guard; query/hash belonging to the user stay intact.
  if (marker) {
    const canonical = new URL(location.href);
    canonical.searchParams.delete("__zeter_ready");
    canonical.searchParams.delete("__zeter_gate");
    history.replaceState(history.state, "", canonical.href);
  }
})();
