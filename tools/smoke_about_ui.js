"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { window: { ZETER_CORE_UTILS: { escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])) } } };
vm.createContext(sandbox);
for (const name of ["version.js", "config.js", "app-catalog.js", "about-ui-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", "js", "core", name), "utf8"), sandbox);
}
const about = sandbox.window.ZETER_ABOUT_UI_UTILS;
const html = about.aboutAppHTML();
assert.match(html, /data-about-guide[^>]*>Руководство пользователя ZeTer OS<\/button>/, "About must offer the internal user guide");
assert.doesNotMatch(html, /Изменения сохраняются автоматически\./, "the crossed-out introduction must be removed");
assert.match(html, /class="about-brand"[\s\S]*?<img src="assets\/icons\/zeter-logo\.svg"[^>]*alt=""/, "About must use the shared product logo beside its heading");
assert.match(html, /data-update-check/, "About must let the user check for app updates");
assert.ok(html.includes(sandbox.window.ZETER_OS_CONFIG.OS_VERSION), "About must display the running product version");
const expectedLinks = [
  "https://github.com/zeter1/ZeTer-OS/blob/main/CHANGELOG.md", "https://github.com/zeter1/ZeTer-OS/releases",
  "https://github.com/zeter1/ZeTer-OS",
  "https://dkoles.com/zeteros/index.html", "https://github.com/zeter1/ZeTer-OS/releases",
  "https://developer.microsoft.com/microsoft-edge/webview2/", "https://github.com/zeter1/ZeTer-OS/blob/main/README_PYTHON.md",
  "https://t.me/zeter1", "https://www.linkedin.com/in/zeter/", "https://www.facebook.com/zeter1", "https://vk.ru/zeter1",
  "https://www.instagram.com/zeter1992/", "https://tenchat.ru/zeter", "https://x.com/zeter1", "https://www.threads.com/@zeter1992",
  "https://ok.ru/zeter1", "https://t.me/zeterchat"
];
assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), expectedLinks, "all requested destinations must be preserved");
assert.match(html, /Дмитрий Колесниченко/);
assert.match(html, /zeter11@gmail\.com/);
assert.ok(html.indexOf('about-release"') < html.indexOf('about-launch"') && html.indexOf('about-launch"') < html.indexOf('about-developer"'), "launch instructions belong between updates and developer");
assert.equal([...html.matchAll(/class="about-launch-card"/g)].length, 3);
assert.match(html, /py -3 -m pip install -r requirements\.txt\npy -3 run_zeter_os\.py/);
assert.match(html, /start_zeter_os\.cmd/);
assert.match(html, /Автоматической синхронизации между вариантами нет/);

async function main() {
  const handlers = {};
  const inside = {}, outside = {};
  const root = { addEventListener: (name, callback) => { handlers[name] = callback; }, contains: node => node === inside };
  let selection = { isCollapsed: false, anchorNode: inside, focusNode: inside, toString: () => "  Дмитрий\nКолесниченко  " };
  let menu, copied, result = true;
  const notices = [], opened = [], openedApps = [];
  about.aboutAppElement({
    documentRef: { createElement: () => root }, getSelection: () => selection,
    showContext: (x, y, entries) => { menu = { x, y, entries }; },
    copyText: async text => { copied = text; return result; },
    toast: title => notices.push(title), openExternalLink: async href => opened.push(href), openApp: appId => openedApps.push(appId)
  });
  const event = { preventDefault() {}, stopPropagation() {}, clientX: 125, clientY: 80 };
  handlers.contextmenu(event);
  assert.equal(menu.x, 125);
  selection = null; // Opening the menu may collapse the DOM selection; copy must retain its snapshot.
  await menu.entries[0][2]();
  assert.equal(copied, "  Дмитрий\nКолесниченко  ");
  assert.equal(notices.pop(), "Текст скопирован");
  result = false;
  await menu.entries[0][2]();
  assert.equal(notices.pop(), "Не удалось скопировать");
  for (selection of [null, { isCollapsed: true }, { isCollapsed: false, anchorNode: outside, focusNode: inside }, { isCollapsed: false, anchorNode: inside, focusNode: outside }]) {
    menu = null;
    handlers.contextmenu(event);
    assert.equal(menu, null, "empty or foreign selection must never be copied by this window");
  }
  const link = inside;
  link.getAttribute = () => expectedLinks[1];
  link.querySelector = () => ({ textContent: "Обновления системы" });
  handlers.click({ ...event, target: { closest: selector => selector === "[data-about-link]" ? link : null } });
  assert.deepEqual(opened, [expectedLinks[1]], "links must use the app's external-opening boundary");
  handlers.click({ ...event, target: { closest: selector => selector === "[data-about-guide]" ? inside : null } });
  assert.deepEqual(openedApps, ["help"], "the guide must open inside ZeTer OS");
  assert.deepEqual(opened, [expectedLinks[1]], "opening the guide must not launch an external page");
  console.log("about UI smoke: ok");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
