"use strict";

// Hermetic VM fixture: no app startup, browser profile or filesystem writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = { window: { ZETER_CORE_UTILS: { $() {}, $$() { return []; }, escapeHtml: String } } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/js/core/preferences-writer-utils.js"), "utf8"), context);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/js/core/start-ui-utils.js"), "utf8"), context);
const createWriter = context.window.ZETER_START_UI_UTILS.createStartPreferencesWriter;
const plain = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

async function checkControllerFocus() {
  // A minimal DOM boundary models the real focus loss when innerHTML removes a button.
  // Expectations below use visible focused keys, independent of the controller's refresh code.
  let document;
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.parentElement = null; this.classes = new Set(); this.value = ""; }
    get classList() { return { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, force) => { const has = force === undefined ? !this.classes.has(name) : force; has ? this.classes.add(name) : this.classes.delete(name); return has; } }; }
    set innerHTML(value) { if (this.contains(document.activeElement)) document.activeElement = document.body; this.children.forEach(child => { child.parentElement = null; }); this.children = []; this.html = value; }
    get innerHTML() { return this.html || ""; }
    appendChild(child) { const old = this.children.indexOf(child); if (old >= 0) this.children.splice(old, 1); this.children.push(child); child.parentElement = this; }
    contains(child) { return child === this || this.children.some(item => item.contains(child)); }
    querySelectorAll(selector) { return selector === '[data-start-pin]' ? this.children.filter(child => child.dataset.startPin) : []; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return selector === '[data-start-pin]' && this.dataset.startPin ? this : null; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    setAttribute() {}
    focus() { document.activeElement = this; }
  }
  document = { createElement: () => new Element(), body: new Element() };
  document.activeElement = document.body;
  const menu = new Element(), pins = new Element(), unrelated = new Element();
  const nodes = { '#start-menu': menu, '#start-pinned': pins };
  let stored = { pinOrder: [] }, release;
  const domContext = { window: { ZETER_CORE_UTILS: { $: selector => nodes[selector] || null, $$: (selector, root) => root?.querySelectorAll(selector) || [], escapeHtml: String } }, document };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/core/preferences-writer-utils.js'), 'utf8'), domContext);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/core/start-ui-utils.js'), 'utf8'), domContext);
  const controller = domContext.window.ZETER_START_UI_UTILS.createStartMenuController({
    getApps: () => ({ a: { name: 'A', pinned: true }, b: { name: 'B', pinned: true } }),
    getPreferences: () => stored,
    updatePreferences: patch => new Promise(resolve => { release = () => { stored = { ...stored, ...patch }; resolve(stored); }; })
  });
  controller.render();
  const moveFirst = () => { pins.children[0].focus(); pins.children[0].listeners.keydown({ altKey: true, key: 'ArrowRight', preventDefault() {} }); };
  moveFirst();
  assert.equal(document.activeElement.dataset.startPin, 'app:a');
  await tick();
  assert.equal(document.activeElement.dataset.startPin, 'app:a', 'microtask save refresh must preserve the actual focused pin');
  release();
  await tick();
  assert.equal(document.activeElement.dataset.startPin, 'app:a', 'ACK refresh must preserve the same focused pin');
  moveFirst();
  unrelated.focus();
  await tick();
  release();
  await tick();
  assert.equal(document.activeElement, unrelated, 'background ACK cannot steal focus from another control');
  moveFirst();
  menu.classList.add('hidden');
  document.body.focus();
  await tick();
  release();
  await tick();
  assert.equal(document.activeElement, document.body, 'closed menu cannot receive focus from a save completion');
}

async function main() {
  assert.equal(typeof createWriter, "function", "Start preferences must expose the serial draft writer");
  let authoritative = { layout: "balanced", iconSize: "normal", showPinned: true, showRecent: true, recentItems: [{ id: "keep" }] };
  const writes = [], changes = [], errors = [];
  let active = 0, maxActive = 0;
  const writer = createWriter({
    getPreferences: () => authoritative,
    save: patch => new Promise((resolve, reject) => {
      active++; maxActive = Math.max(maxActive, active);
      writes.push({ patch: plain(patch), ack() { authoritative = { ...authoritative, ...plain(patch) }; active--; resolve(authoritative); }, fail() { active--; reject(new Error("fixture refused")); } });
    }),
    onChange: state => changes.push(plain(state)),
    onError: error => errors.push(error.message)
  });
  writer.update({ layout: "compact" });
  writer.update({ iconSize: "large" });
  assert.equal(writer.getState().preferences.iconSize, "large", "draft preview is synchronous");
  await tick();
  assert.deepEqual(writes[0].patch, { layout: "compact", iconSize: "large" }, "one microtask batch");
  writer.update({ iconSize: "normal" });
  writer.update({ iconSize: "large", showPinned: false });
  writer.update({ layout: "balanced" });
  assert.equal(writes.length, 1, "held write accepts edits without parallel save");
  assert.equal(writer.getState().preferences.layout, "balanced");
  assert.equal(writer.discard(), false, "in-flight acknowledged state cannot be discarded");
  // The same writer survives hiding/reopening its UI: reading state never resets intent.
  assert.equal(writer.getState().preferences.showPinned, false);
  writes[0].ack();
  await tick();
  assert.equal(writer.getState().preferences.layout, "balanced", "old ACK cannot overwrite newer draft");
  assert.deepEqual(writes[1].patch, { layout: "balanced", iconSize: "large", showPinned: false }, "latest field values coalesce");
  assert.equal(maxActive, 1);
  writes[1].fail();
  await tick();
  assert.equal(writes.length, 2, "failure must not spin automatic retries");
  assert.equal(writer.getState().preferences.showPinned, false, "failure retains unsaved choice");
  assert.equal(writer.getState().dirty, true);
  assert.ok(writer.getState().error);
  assert.equal(errors.length, 1);
  authoritative.recentItems = [{ id: "new-recent" }];
  writer.retry();
  await tick();
  assert.deepEqual(writes[2].patch, writes[1].patch, "retry saves the same latest intent");
  assert.equal("recentItems" in writes[2].patch, false);
  assert.equal("showRecent" in writes[2].patch, false);
  writes[2].ack();
  await tick();
  assert.equal(writer.getState().dirty, false);
  assert.equal(writer.getState().error, null);
  assert.deepEqual(plain(authoritative.recentItems), [{ id: "new-recent" }]);
  writer.update({ showRecent: false, recentItems: [{ id: "forbidden" }] });
  await tick();
  assert.deepEqual(writes[3].patch, { showRecent: false }, "never copy history or unrelated fields into preference write");
  writes[3].fail();
  await tick();
  assert.equal(writer.discard(), true);
  assert.equal(writer.getState().preferences.showRecent, true);
  assert.equal(writer.getState().dirty, false);
  assert.equal(writer.getState().error, null);
  writer.update({ pinOrder: ["app:calendar", "app:tasks"] });
  await tick();
  writer.update({ iconSize: "normal" });
  writes[4].fail();
  await tick();
  writer.update({ layout: "compact" });
  await tick();
  assert.deepEqual(writes[5].patch, { pinOrder: ["app:calendar", "app:tasks"], iconSize: "normal", layout: "compact" }, "new user choice retries all current intent");
  writes[5].ack();
  await tick();
  assert.equal(writer.getState().dirty, false);
  assert.equal(maxActive, 1);
  assert.ok(changes.length > 10);
  await checkControllerFocus();
  console.log("PASS Start preferences: immediate draft, serial ACK, coalescing, failure/retry/discard and unrelated history preservation");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
