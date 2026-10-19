"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const plain = value => JSON.parse(JSON.stringify(value));
for (const file of fs.readdirSync(path.join(__dirname, "../app/css")).filter(name => name.endsWith(".css"))) {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../app/css", file), "utf8"), /body\.light\b|color-scheme:\s*light\b|prefers-color-scheme:\s*light\b/, `Dark-only interface: ${file}`);
}
let activeContainer = null;
let controls = [];
let listeners = {};
const root = { addEventListener(type, callback) { listeners[type] = callback; } };
const sandbox = {
  console,
  document: {
    querySelector() { return null; },
    createElement(tag) {
      if (tag === "div") return root;
      return {
        style: {}, dataset: {}, listeners: {}, addEventListener(type, callback) { this.listeners[type] = callback; },
        get offsetWidth() { return { small: 64, medium: 80, large: 104 }[activeContainer.dataset.iconSize]; },
        get offsetHeight() {
          // Independent DOM fixture: a long title is taller than every nominal cell.
          return this.innerHTML.includes("Очень длинное") ? 151 : { small: 68, medium: 82, large: 106 }[activeContainer.dataset.iconSize];
        }
      };
    }
  },
  window: {
    innerWidth: 640,
    ZETER_CORE_UTILS: {
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      uid: () => "fixture", escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
      $: () => null, $$: selector => selector === "[data-desktop-appearance]" ? controls : [], debounce: callback => callback
    },
    ZETER_STICKY_UTILS: {}, ZETER_ITEM_DRAG_UI_UTILS: {},
    ZETER_CONTEXT_MENU_UI_UTILS: {}, ZETER_MANAGED_FILE_UTILS: {}
  }
};
vm.createContext(sandbox);
for (const name of ["config", "asset-utils", "visual-utils", "system-settings-utils", "explorer-tab-utils", "explorer-ui-utils", "desktop-layout-utils", "desktop-ui-utils", "preferences-writer-utils", "settings-ui-utils"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", `${name}.js`), "utf8"), sandbox, { filename: name });
}
const visual = sandbox.window.ZETER_VISUAL_UTILS;
const desktop = sandbox.window.ZETER_DESKTOP_UI_UTILS;
const settingsUi = sandbox.window.ZETER_SETTINGS_UI_UTILS;
assert.deepEqual(plain(visual.normalizeDesktopAppearance()), { iconSize: "medium", density: "compact", extensions: true, labelSize: "medium", labelLines: 0, openMode: "double" });
for (const invalid of [null, [], false, { iconSize: "giant", density: "dense", extensions: "false" }]) {
  assert.deepEqual(plain(visual.normalizeDesktopAppearance(invalid)), { iconSize: "medium", density: "compact", extensions: true, labelSize: "medium", labelLines: 0, openMode: "double" });
}
const savedSettings = { wallpaper: "mint", volume: 32, future: { keep: 1 }, desktopAppearance: { iconSize: "large", density: "comfortable", extensions: false, future: 3 } };
const normalized = visual.normalizeVisualSettings(savedSettings);
assert.equal(normalized, savedSettings);
assert.deepEqual(plain(normalized.desktopAppearance), { iconSize: "large", density: "comfortable", extensions: false, future: 3, labelSize: "medium", labelLines: 0, openMode: "double" });
assert.deepEqual(plain(normalized.future), { keep: 1 });
assert.equal(normalized.wallpaper, "mint");
assert.deepEqual(plain(visual.baseDesktopSettings().desktopAppearance), { iconSize: "medium", density: "compact", extensions: true, labelSize: "medium", labelLines: 0, openMode: "double" });

function render(appearance, sourceItems, width = 640) {
  const children = [];
  activeContainer = { dataset: {}, clientWidth: width, scrollLeft: 0, scrollTop: 10,
    appendChild(child) { children.push(child); }, set innerHTML(_value) { children.length = 0; }
  };
  desktop.renderDesktopIcons({ container: activeContainer, items: sourceItems, appearance,
    clampPosition: (x, y) => ({ x, y }), itemIcon: () => "📄"
  });
  return children;
}
const data = [
  { id: "a", type: "file", name: "Отчёт.txt", x: 0, y: 0, content: "preserve" },
  { id: "b", type: "folder", name: "Папка.v1", x: 84, y: 0 }
];
let icons = render(undefined, data);
assert.deepEqual(data.map(item => [item.x, item.y]), [[0, 0], [84, 0]], "default 80px icons preserve valid positions and 4px clearance");
assert.ok(icons[0].innerHTML.includes("Отчёт.txt"));
const compact = data.map(item => ({ ...item }));
icons = render({ iconSize: "medium", density: "comfortable", extensions: false }, compact);
assert.ok(icons[0].innerHTML.includes('class="label">Отчёт</span>'));
assert.ok(icons[1].innerHTML.includes("Папка.v1"));
assert.equal(compact[0].name, "Отчёт.txt");
assert.equal(compact[0].content, "preserve");
assert.ok(compact[1].x >= 96 || compact[1].y >= 98, "comfortable spacing protects a real 80x82 rect with 16px gap");
const labelItems = [
  { id: "long", type: "file", name: "Очень длинное имя файла.txt", x: 0, y: 0 },
  { id: "next", type: "file", name: "Второй.txt", x: 0, y: 86 }
];
for (const size of ["small", "medium", "large"]) {
  const fixture = labelItems.map(item => ({ ...item }));
  icons = render({ iconSize: size, density: "comfortable" }, fixture, 120);
  assert.equal(activeContainer.dataset.iconSize, size);
  assert.ok(icons.every(icon => icon.dataset.iconSize === size), "cloned drag previews retain their own size attributes");
  assert.ok(fixture[1].y >= 167, "151px rendered title height, not nominal tile, determines clearance");
  assert.equal(activeContainer.scrollTop, 10);
}
const controllerItems = [{ id: "single", type: "file", name: "Имя.txt", x: 20, y: 20 }];
const controller = desktop.createDesktopSurfaceController({
  getContainer: () => activeContainer, getItems: () => controllerItems,
  getSettings: () => ({ desktopAppearance: { iconSize: "small", extensions: false } }),
  clampPosition: (x, y) => ({ x, y })
});
controller.render();
assert.equal(activeContainer.dataset.iconSize, "small", "surface controller forwards workspace appearance");
assert.deepEqual(controllerItems.map(item => [item.x, item.y, item.name]), [[20, 20, "Имя.txt"]]);

for (const mode of ['double', 'single']) {
  const children=[];let opens=0,selections=0;
  activeContainer={dataset:{},clientWidth:640,appendChild:child=>children.push(child),set innerHTML(_value){children.length=0;}};
  desktop.renderDesktopIcons({container:activeContainer,items:[{id:'activation',name:'Имя.txt'}],appearance:{openMode:mode},onSelect:()=>{selections++;},onOpen:()=>{opens++;}});
  const icon=children[0];
  const event=(detail=1,extra={})=>({detail,stopPropagation(){},preventDefault(){},...extra});
  icon.listeners.click(event(1));icon.listeners.click(event(2));icon.listeners.dblclick(event(2));
  assert.equal(opens,1,`${mode}: full double event sequence opens exactly once`);
  for(const modifier of ['ctrlKey','metaKey','altKey','shiftKey']){icon.listeners.click(event(1,{[modifier]:true}));icon.listeners.dblclick(event(2,{[modifier]:true}));}
  assert.equal(opens,1,`${mode}: modified clicks never open`);
  icon.dataset.dragJustEnded='1';icon.listeners.click(event(1));icon.listeners.dblclick(event(2));
  assert.equal(opens,1,`${mode}: trailing drag events never open`);
  delete icon.dataset.dragJustEnded;icon.listeners.click(event(0));
  assert.equal(opens,2,`${mode}: keyboard activation opens once`);assert.ok(selections>=3);
}

async function settingsSequence() {
  let current = { wallpaper: "mint", desktopAppearance: { iconSize: "medium", density: "compact", extensions: true } };
  const old = plain(current);
  let fail = true, disk = plain(current), renders = 0;
  const writer = sandbox.window.ZETER_PREFERENCES_WRITER_UTILS.createPreferencesWriter({
    keys: settingsUi.SETTINGS_PREFERENCE_KEYS, requireAck: true,
    getPreferences: () => settingsUi.settingsPreferences({ settings: current }),
    save: async patch => {
      const candidate = settingsUi.applySettingsPreferencePatch({ settings: current }, patch);
      if (fail) throw new Error("fixture refusal");
      disk = plain(candidate.settings); current = candidate.settings; renders++;
      return { saved: true };
    }
  });
  const tick = async () => { for (let i=0; i<12; i++) await Promise.resolve(); };
  assert.equal(settingsUi.settingsChangeAction({matches: selector => selector === "[data-desktop-appearance]",dataset:{desktopAppearance:"foreign"}}), null);
  writer.update({"desktop.desktopAppearance.iconSize":"large"}); await tick();
  assert.deepEqual(plain(current), old); assert.deepEqual(disk, old); assert.equal(renders,0);
  assert.equal(writer.getState().preferences["desktop.desktopAppearance.iconSize"],"large", "failed write keeps visible intent for explicit retry");
  assert.ok(writer.getState().error);
  fail=false; writer.retry(); await tick();
  assert.equal(current.desktopAppearance.iconSize,"large"); assert.equal(disk.wallpaper,"mint"); assert.equal(renders,1);
  writer.update({"desktop.desktopAppearance.extensions":false}); await tick();
  assert.equal(disk.desktopAppearance.extensions,false);
}
settingsSequence().then(() => console.log("desktop appearance: normalization, measured clearance, names, staged refusal→retry ok"))
  .catch(error => { console.error(error); process.exitCode = 1; });
