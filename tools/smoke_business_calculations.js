"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = { console, URL, structuredClone, Blob, TextEncoder, TextDecoder, crypto: require("node:crypto").webcrypto, Uint8Array, atob, btoa }; sandbox.window = sandbox;
vm.createContext(sandbox);
const source = path.join(__dirname, "../app/js/core/business-calculations-utils.js");
assert.ok(fs.existsSync(source), "Business calculations need a production model");
vm.runInContext(fs.readFileSync(source, "utf8"), sandbox);
const model = sandbox.ZETER_BUSINESS_CALCULATIONS_UTILS;
for (const name of ["utils.js", "config.js", "business-calculations-ui-utils.js", "shortcut-utils.js", "link-library-utils.js", "prompt-library-utils.js", "storage-utils.js", "asset-utils.js", "security-protection-utils.js", "import-utils.js", "export-utils.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core", name), "utf8"), sandbox);
}
sandbox.ZETER_DATA_NORMALIZERS = { TASK_TITLE_MAX_CHARS: 500, TASK_TAG_MAX_CHARS: 160, TASK_CHECKLIST_TEXT_MAX_CHARS: 500 };
sandbox.ZETER_RICH_TEXT_UTILS = { cleanRichHtml: value => value };
sandbox.ZETER_ITEM_CUSTOMIZATION_UTILS = { isItemAssetPath: () => false };
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/state-import-validator.js"), "utf8"), sandbox);
const defaults = model.normalizeBusinessCalculations();
assert.equal(model.CALCULATIONS.length, 10);
const values = (id, inputs = defaults.inputs[id]) => Object.fromEntries(model.calculateBusinessValues(id, inputs).metrics.map(item => [item.key, item.value]));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
assert.equal(values("margin").profit, 500); near(values("margin").margin, 500 / 1200 * 100); near(values("margin").markup, 500 / 700 * 100);
assert.equal(values("breakeven").units, 13); assert.equal(values("breakeven").revenue, 6500);
near(values("hourly").hourly, 6500 / .94 / 100); near(values("hourly").safe, 6500 / .94 / 100 * 1.2);
assert.equal(values("discount").profit, 650); assert.equal(values("discount").final, 1350);
assert.equal(values("roi").net, 1200); assert.equal(values("roi").roi, 150);
assert.equal(values("ltv").cac, 150); assert.equal(values("ltv").ltv, 3600); assert.equal(values("ltv").ratio, 24);
assert.equal(values("plan").orders, 14); near(values("plan").daily, 20000 / 22);
near(values("runway").months, 12000 / 3500); assert.equal(values("runway").gap, -9000);
assert.equal(values("acquiring").fee, 50); assert.equal(values("acquiring").net, 1950);
assert.equal(values("rko").total, 75); near(values("rko").effective, .375);
assert.equal(values("margin", { cost: "0", price: "0" }).margin, null);
assert.equal(values("margin", { cost: "0", price: "0" }).markup, null);
assert.equal(values("breakeven", { fixed: "4000", price: "180", variable: "180" }).units, null);
assert.equal(values("hourly", { income: "5000", costs: "1500", tax: "6", hours: "0" }).hourly, null);
assert.equal(values("discount", { price: "1500", rate: "100", cost: "700" }).profit, -700);
assert.equal(values("margin", { cost: "700", price: "" }).profit, null, "empty input must not pretend to be zero");
assert.equal(values("margin", { cost: "-1", price: "100" }).profit, null);
assert.equal(values("acquiring", { amount: "2000", rate: "101", fixed: "0" }).fee, null);
assert.equal(values("acquiring", { amount: "2000", rate: "2,5", fixed: "0" }).fee, 50);
model.validateBusinessCalculations(defaults);
assert.throws(() => model.validateBusinessCalculations({ ...defaults, selected: ["margin", "margin"] }), /повтор/i);
assert.throws(() => model.validateBusinessCalculations({ ...defaults, selected: ["unknown"] }), /подсч/i);
async function main() {
  const workspace = { calculations: defaults }, other = { calculations: model.normalizeBusinessCalculations() };
  let fail = false, snapshots = [], resolveSave;
  const controller = model.createBusinessCalculationsController({ getWorkspace: () => workspace,
    persistTransaction: operation => operation(async candidate => { if (fail) throw new Error("disk full"); snapshots.push(candidate); return { saved: true }; }),
    saveSnapshot: (write, candidate) => write(candidate) });
  const moves = [
    ["margin", "breakeven", ["breakeven", "margin", "hourly", "discount"]],
    ["breakeven", "margin", ["breakeven", "margin", "hourly", "discount"]],
    ["margin", "discount", ["breakeven", "hourly", "discount", "margin"]],
    ["discount", "margin", ["discount", "margin", "breakeven", "hourly"]],
    ["hourly", "breakeven", ["margin", "hourly", "breakeven", "discount"]],
    ["breakeven", "hourly", ["margin", "hourly", "breakeven", "discount"]]
  ];
  for (const [id, target, expected] of moves) {
    const fixture = { calculations: model.normalizeBusinessCalculations() };
    fixture.calculations.sizes.margin = { width: 800, height: 420, span: 2 };
    fixture.calculations.inputs.margin.cost = "987,50";
    let reject = true, writes = 0;
    const mover = model.createBusinessCalculationsController({ getWorkspace: () => fixture,
      persistTransaction: operation => operation(async () => { writes++; if (reject) throw new Error("move refused"); return { saved: true }; }), saveSnapshot: (write, candidate) => write(candidate) });
    const previous = JSON.stringify(fixture.calculations);
    await assert.rejects(mover.moveTo(id, target), /move refused/);
    assert.equal(JSON.stringify(fixture.calculations), previous);
    reject = false; await mover.moveTo(id, target);
    assert.deepEqual(Array.from(fixture.calculations.selected), expected, `${id} takes ${target}'s original position`);
    assert.equal(fixture.calculations.inputs.margin.cost, "987,50");
    assert.equal(fixture.calculations.sizes.margin.span, 2);
    await assert.rejects(mover.moveTo(id, "unknown"), /недоступна/i);
    assert.equal(writes, 2, "missing target cannot save an arbitrary position");
  }
  await controller.add("rko");
  await controller.setInput("rko", "monthlyFee", "99,50");
  await controller.reorder("rko", "margin", "before");
  assert.equal(workspace.calculations.selected[0], "rko");
  assert.equal(other.calculations.selected.includes("rko"), false);
  await controller.remove("rko"); await controller.add("rko");
  assert.equal(workspace.calculations.inputs.rko.monthlyFee, "99,50", "hiding keeps the inputs");
  fail = true; const before = JSON.stringify(workspace);
  await assert.rejects(controller.remove("margin"), /disk full/);
  assert.equal(JSON.stringify(workspace), before, "failed save never publishes the candidate");
  fail = false; await controller.remove("margin");
  model.validateBusinessCalculations(JSON.parse(JSON.stringify(workspace.calculations)));
  const pendingWorkspace = { calculations: model.normalizeBusinessCalculations() };
  const pending = model.createBusinessCalculationsController({ getWorkspace: () => pendingWorkspace,
    persistTransaction: operation => operation(() => new Promise(resolve => { resolveSave = resolve; })), saveSnapshot: (write, candidate) => write(candidate) });
  const save = pending.add("roi");
  for (let i = 0; i < 8 && !resolveSave; i++) await Promise.resolve();
  assert.ok(resolveSave, "save reached the synthetic boundary");
  assert.equal(pendingWorkspace.calculations.selected.includes("roi"), false, "pending candidates stay outside live state/exports");
  resolveSave({ saved: true }); await save;
  assert.equal(pendingWorkspace.calculations.selected.includes("roi"), true);
  assert.equal(snapshots.length, 6);
  await controller.setSize("rko", { width: 780, height: 420, span: 2 });
  assert.equal(workspace.calculations.sizes.rko.width, 780);
  assert.equal(other.calculations.sizes.rko, undefined, "sizes belong to one desktop");
  fail = true; const beforeSize = JSON.stringify(workspace.calculations);
  await assert.rejects(controller.setSize("rko", { width: 500, height: 300, span: 1 }), /disk full/);
  assert.equal(JSON.stringify(workspace.calculations), beforeSize, "size changes publish only after saved ack");
  fail = false;
  await assert.rejects(controller.setSize("rko", { width: 1, height: 300, span: 1 }), /размер/i);
  await controller.remove("rko"); await controller.add("rko");
  assert.equal(workspace.calculations.sizes.rko.height, 420, "hide/restore keeps size");
  const legacy = { ...defaults }; delete legacy.sizes;
  model.validateBusinessCalculations(legacy);
  assert.equal(Object.keys(model.normalizeBusinessCalculations(legacy).sizes).length, 0);
  const incoming = { fs: {}, settings: {}, currentDesktop: "desktop", desktops: [{ id: "desktop", name: "Первый", data: workspace }, { id: "second", name: "Второй", data: other }] };
  const validator = sandbox.ZETER_STATE_IMPORT_VALIDATOR.validateImportedStateForImport;
  validator(incoming);
  const corrupt = JSON.parse(JSON.stringify(incoming)); corrupt.desktops[0].data.calculations.selected = ["unknown"];
  assert.throws(() => validator(corrupt), /подсч/i);
  const corruptSize = JSON.parse(JSON.stringify(incoming)); corruptSize.desktops[0].data.calculations.sizes.rko.width = 1;
  assert.throws(() => validator(corruptSize), /размер/i);
  let zipEntries;
  const zip = await sandbox.ZETER_EXPORT_UTILS.buildDownloadOsDataZipModel(incoming, { createZipBlob: async entries => { zipEntries = entries; return sandbox.ZETER_ASSET_UTILS.createZipBlob(entries); } });
  assert.equal(zip.zeterVerification.verified, true);
  const restored = JSON.parse(await zipEntries.find(item => item.path === "zeter-os-state.json").blob.text()).state;
  assert.deepEqual(restored.desktops, JSON.parse(JSON.stringify(incoming.desktops)), "real ZIP preserves order, currency and every input"); validator(restored);
  const ui = sandbox.ZETER_BUSINESS_CALCULATIONS_UI_UTILS;
  const item = model.CALCULATIONS[0], html = ui.calculationCardHTML(item, { cost: '\"><img onerror="x">', price: "1200" }, "BYN", 0, 1);
  assert.ok(!html.includes("<img"), "input text is escaped");
  assert.ok(html.includes("data-calc-handle") && html.includes('data-calc-action="up"') && html.includes('data-calc-action="down"'));
  assert.ok(html.includes("data-calc-resize") && html.includes('data-calc-action="size-reset"'));
  fail = true; const beforeReset = JSON.stringify(workspace.calculations);
  await assert.rejects(controller.resetSize("rko"), /disk full/);
  assert.equal(JSON.stringify(workspace.calculations), beforeReset);
  fail = false; await controller.resetSize("rko");
  assert.equal(workspace.calculations.sizes.rko, undefined);
  assert.equal(ui.formatCalculationValue(1.234, "money", "BYN"), "1,23 BYN");
  console.log("business calculations smoke: ok (10 formulas, limits, add/hide/reorder, sizes/reset/legacy, staged save/rejection, import, verified ZIP and UI escaping)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
