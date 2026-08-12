(() => {
  "use strict";

  const BOOT_TIMEOUT_MS = 30000;
  const MAX_MESSAGE_LENGTH = 900;
  const MAX_STACK_LENGTH = 5000;
  let completed = false;
  let failureShown = false;
  let pendingNativeReport = null;
  let timeoutId = null;

  function compactText(value, limit) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function normalizeFailure(details = {}) {
    const error = details.error instanceof Error ? details.error : null;
    const message = compactText(details.message || error?.message || "Неизвестная ошибка запуска.", MAX_MESSAGE_LENGTH);
    return {
      kind: compactText(details.kind || "boot_error", 80),
      message: message || "Неизвестная ошибка запуска.",
      source: compactText(details.source || "", 500),
      line: Number.isFinite(Number(details.line)) ? Number(details.line) : 0,
      column: Number.isFinite(Number(details.column)) ? Number(details.column) : 0,
      stack: String(details.stack || error?.stack || "").slice(0, MAX_STACK_LENGTH),
      page: compactText(window.location?.href || "", 500),
      occurredAt: new Date().toISOString()
    };
  }

  function showFailure(payload) {
    const boot = document.getElementById("boot");
    if (!boot) return;
    boot.classList.remove("done");
    boot.classList.add("failed");
    boot.setAttribute("role", "alert");
    boot.setAttribute("aria-live", "assertive");

    const title = boot.querySelector("h1");
    const status = boot.querySelector(".boot-card > p:not(.boot-error-detail)");
    if (title) title.textContent = "Не удалось загрузить ZeTer OS";
    if (status) status.textContent = payload.kind === "boot_timeout"
      ? "Запуск занял слишком много времени"
      : "Во время запуска произошла ошибка";

    let detail = boot.querySelector(".boot-error-detail");
    if (!detail) {
      detail = document.createElement("p");
      detail.className = "boot-error-detail";
      boot.querySelector(".boot-card")?.appendChild(detail);
    }
    detail.textContent = payload.message;

    boot.querySelector(".boot-recovery-actions")?.remove();
    let retry = boot.querySelector(".boot-retry");
    if (!retry) {
      retry = document.createElement("button");
      retry.type = "button";
      retry.className = "boot-retry";
      retry.textContent = "Перезапустить";
      retry.addEventListener("click", () => window.location.reload());
      boot.querySelector(".boot-card")?.appendChild(retry);
    }
  }

  function showStorageRecovery(details = {}) {
    if (completed) return false;
    failureShown = true;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    const payload = normalizeFailure({
      ...details,
      kind: "storage_load_error",
      message: details.message || details.error?.message || "Не удалось прочитать основной файл состояния."
    });
    console.error(`[ZeTer OS boot guard] ${payload.kind}: ${payload.message}`, details.error || "");

    const boot = document.getElementById("boot");
    if (!boot) return false;
    boot.classList.remove("done");
    boot.classList.add("failed");
    boot.setAttribute("role", "alert");
    boot.setAttribute("aria-live", "assertive");

    const title = boot.querySelector("h1");
    const status = boot.querySelector(".boot-card > p:not(.boot-error-detail)");
    if (title) title.textContent = "Не удалось прочитать данные ZeTer OS";
    if (status) status.textContent = "Автосохранение заблокировано — существующий файл не будет заменён";

    let detail = boot.querySelector(".boot-error-detail");
    if (!detail) {
      detail = document.createElement("p");
      detail.className = "boot-error-detail";
      boot.querySelector(".boot-card")?.appendChild(detail);
    }
    detail.textContent = payload.message;
    boot.querySelector(".boot-retry")?.remove();
    boot.querySelector(".boot-recovery-actions")?.remove();

    const actions = document.createElement("div");
    actions.className = "boot-recovery-actions";
    const addAction = (label, action, primary = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `boot-recovery-action${primary ? " primary" : ""}`;
      button.textContent = label;
      button.disabled = typeof action !== "function";
      button.addEventListener("click", async () => {
        if (button.disabled || typeof action !== "function") return;
        button.disabled = true;
        try {
          await Promise.resolve(action());
        } catch (error) {
          detail.textContent = `${label}: ${compactText(error?.message || error, MAX_MESSAGE_LENGTH)}`;
        } finally {
          button.disabled = false;
        }
      });
      actions.appendChild(button);
    };
    addAction("Повторить чтение", details.onRetry, true);
    addAction("Открыть папку data", details.onOpenData);
    addAction("Открыть журналы", details.onOpenLogs);
    addAction("Безопасно закрыть", details.onClose);
    boot.querySelector(".boot-card")?.appendChild(actions);
    sendNativeReport(payload);
    return true;
  }

  function sendNativeReport(payload) {
    pendingNativeReport = payload;
    const api = window.pywebview?.api;
    const reporter = window.pywebview?.api?.report_client_error;
    if (typeof reporter !== "function") return false;
    pendingNativeReport = null;
    try {
      Promise.resolve(reporter.call(api, payload)).catch(error => {
        console.warn("[ZeTer OS boot guard] Не удалось записать ошибку в native-лог.", error);
      });
    } catch (error) {
      console.warn("[ZeTer OS boot guard] Не удалось записать ошибку в native-лог.", error);
    }
    return true;
  }

  function reportFailure(details = {}) {
    if (completed || failureShown) return false;
    failureShown = true;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    const payload = normalizeFailure(details);
    console.error(`[ZeTer OS boot guard] ${payload.kind}: ${payload.message}`, details.error || "");
    showFailure(payload);
    sendNativeReport(payload);
    return true;
  }

  function handleWindowError(event) {
    reportFailure({
      kind: "runtime_error",
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error
    });
  }

  function handleUnhandledRejection(event) {
    const reason = event.reason;
    reportFailure({
      kind: "unhandled_rejection",
      message: reason?.message || reason,
      stack: reason?.stack || "",
      error: reason instanceof Error ? reason : null
    });
  }

  function flushNativeReport() {
    if (pendingNativeReport) sendNativeReport(pendingNativeReport);
  }

  function markReady() {
    completed = true;
    pendingNativeReport = null;
    if (timeoutId !== null) window.clearTimeout(timeoutId);
    window.removeEventListener("error", handleWindowError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  }

  window.addEventListener("error", handleWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);
  window.addEventListener("pywebviewready", flushNativeReport);
  timeoutId = window.setTimeout(() => {
    reportFailure({
      kind: "boot_timeout",
      message: `Запуск не завершился за ${Math.round(BOOT_TIMEOUT_MS / 1000)} секунд. Попробуйте перезапустить ZeTer OS.`
    });
  }, BOOT_TIMEOUT_MS);

  window.ZETER_BOOT_GUARD = Object.freeze({
    timeoutMs: BOOT_TIMEOUT_MS,
    markReady,
    reportFailure,
    showStorageRecovery
  });
})();
