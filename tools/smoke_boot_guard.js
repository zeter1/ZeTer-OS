"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", "boot-guard.js"), "utf8");

function createElement(tagName = "div") {
  const classes = new Set();
  const listeners = new Map();
  return {
    tagName: String(tagName).toUpperCase(),
    className: "",
    textContent: "",
    type: "",
    disabled: false,
    children: [],
    attributes: {},
    parentNode: null,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    },
    listener(name) { return listeners.get(name); }
  };
}

function createHarness(withReporter = true) {
  const heading = createElement("h1");
  const status = createElement("p");
  const card = createElement("div");
  const boot = createElement("div");
  boot.querySelector = selector => {
    if (selector === "h1") return heading;
    if (selector === ".boot-card > p:not(.boot-error-detail)") return status;
    if (selector === ".boot-card") return card;
    if (selector === ".boot-error-detail") return card.children.find(child => child.className === "boot-error-detail") || null;
    if (selector === ".boot-retry") return card.children.find(child => child.className === "boot-retry") || null;
    if (selector === ".boot-recovery-actions") return card.children.find(child => child.className === "boot-recovery-actions") || null;
    return null;
  };

  const eventListeners = new Map();
  const timers = new Map();
  const nativeReports = [];
  let nextTimerId = 1;
  const window = {
    location: { href: "http://127.0.0.1/index.html?native=1", reload() {} },
    pywebview: withReporter ? { api: { report_client_error(payload) { nativeReports.push(payload); return { ok: true }; } } } : undefined,
    addEventListener(name, callback) { eventListeners.set(name, callback); },
    removeEventListener(name, callback) { if (eventListeners.get(name) === callback) eventListeners.delete(name); },
    setTimeout(callback) { const id = nextTimerId++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const document = {
    getElementById: id => id === "boot" ? boot : null,
    createElement
  };
  const context = vm.createContext({
    window,
    document,
    console: { error() {}, warn() {} },
    Date,
    Error,
    Math,
    Number,
    Object,
    Promise,
    String
  });
  vm.runInContext(source, context, { filename: "boot-guard.js" });
  return { window, boot, card, heading, status, eventListeners, timers, nativeReports };
}

async function main() {
  {
    const harness = createHarness(true);
    const error = new Error("Cannot access 'lateValue' before initialization");
    harness.eventListeners.get("error")({
      message: error.message,
      filename: "http://127.0.0.1/js/app.js",
      lineno: 855,
      colno: 5,
      error
    });

    assert.equal(harness.boot.classList.contains("failed"), true);
    assert.equal(harness.heading.textContent, "Не удалось загрузить ZeTer OS");
    assert.match(harness.status.textContent, /ошибка/);
    assert.match(harness.card.children.find(child => child.className === "boot-error-detail").textContent, /lateValue/);
    assert.equal(harness.card.children.find(child => child.className === "boot-retry").textContent, "Перезапустить");
    assert.equal(harness.nativeReports.length, 1);
    assert.equal(harness.nativeReports[0].kind, "runtime_error");
    assert.equal(harness.nativeReports[0].line, 855);
  }

  {
    const harness = createHarness(false);
    const timeoutCallback = [...harness.timers.values()][0];
    timeoutCallback();
    assert.equal(harness.boot.classList.contains("failed"), true);
    assert.match(harness.card.children.find(child => child.className === "boot-error-detail").textContent, /30 секунд/);

    harness.window.pywebview = { api: { report_client_error(payload) { harness.nativeReports.push(payload); return { ok: true }; } } };
    harness.eventListeners.get("pywebviewready")();
    assert.equal(harness.nativeReports.length, 1);
    assert.equal(harness.nativeReports[0].kind, "boot_timeout");
  }

  {
    const harness = createHarness(true);
    const calls = [];
    const shown = harness.window.ZETER_BOOT_GUARD.showStorageRecovery({
      error: new Error("damaged JSON"),
      onRetry() { calls.push("retry"); },
      onOpenData() { calls.push("data"); },
      onOpenLogs() { calls.push("logs"); },
      onClose() { calls.push("close"); }
    });
    assert.equal(shown, true);
    assert.equal(harness.heading.textContent, "Не удалось прочитать данные ZeTer OS");
    assert.match(harness.status.textContent, /Автосохранение заблокировано/);
    assert.match(harness.card.children.find(child => child.className === "boot-error-detail").textContent, /damaged JSON/);
    const actions = harness.card.children.find(child => child.className === "boot-recovery-actions");
    assert.ok(actions);
    assert.deepEqual(actions.children.map(button => button.textContent), [
      "Повторить чтение",
      "Открыть папку data",
      "Открыть журналы",
      "Безопасно закрыть"
    ]);
    for (const button of actions.children) await button.listener("click")();
    assert.deepEqual(calls, ["retry", "data", "logs", "close"]);
    assert.equal(harness.nativeReports.length, 1);
    assert.equal(harness.nativeReports[0].kind, "storage_load_error");
  }

  {
    const harness = createHarness(true);
    harness.window.ZETER_BOOT_GUARD.markReady();
    assert.equal(harness.timers.size, 0);
    assert.equal(harness.eventListeners.has("error"), false);
    assert.equal(harness.eventListeners.has("unhandledrejection"), false);
  }

  console.log("boot guard smoke: ok");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
