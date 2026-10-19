"use strict";
// Hermetic queue fixture: no browser, native calls or app state paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {}, structuredClone };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/js/core/preferences-writer-utils.js'), 'utf8'), context);
const { createPreferencesWriter } = context.window.ZETER_PREFERENCES_WRITER_UTILS;
const plain = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function main() {
  let authoritative = { color: 'blue', lines: 0, other: 42 }, active = 0, maximum = 0;
  const writes = [], updates = [];
  const writer = createPreferencesWriter({ keys: ['color', 'lines', 'asset'], requireAck: true,
    getPreferences: () => authoritative,
    onChange: state => updates.push(state),
    save: patch => new Promise((resolve, reject) => {
      maximum = Math.max(maximum, ++active);
      writes.push({ patch, ack: (result = { saved: true }) => { active--; if (result.saved) authoritative = { ...authoritative, ...patch }; resolve(result); }, fail: () => { active--; reject(new Error('fixture write refused')); } });
    })
  });
  writer.update({ color: 'violet', other: 100 });
  writer.update({ lines: 2 });
  assert.equal(writer.getState().pending, true);
  await tick();
  assert.deepEqual(plain(writes[0].patch), { color: 'violet', lines: 2 });
  writer.update({ color: 'mint', lines: 3 });
  writes[0].ack(); await tick();
  assert.equal(writer.getState().preferences.color, 'mint');
  assert.equal(writer.getState().pending, true);
  writes[1].fail(); await tick();
  assert.ok(writer.getState().error);
  assert.equal(writer.getState().preferences.lines, 3);
  assert.equal(writes.length, 2, 'failed batch must not retry itself');
  writer.retry(); await tick(); writes[2].ack({ saved: true, fallback: true }); await tick();
  assert.equal(writer.getState().dirty, false);
  assert.equal(writer.getState().lastResult.fallback, true);
  assert.equal(authoritative.other, 42);
  const asset = { name: 'Русское имя', nested: { size: 5 } };
  writer.update({ asset }); asset.nested.size = 99;
  assert.equal(writer.getState().preferences.asset.nested.size, 5);
  await tick(); writes[3].ack({ saved: false }); await tick();
  assert.ok(writer.getState().error, 'missing acknowledgement must never report saved');
  assert.equal(writer.discard(), true);
  assert.equal(writer.getState().dirty, false);
  let notices = 0; const unsubscribe = writer.subscribe(() => notices++);
  writer.update({ color: 'rose' }); await tick();
  assert.ok(notices > 0); unsubscribe(); const count = notices;
  writes[4].ack(); await tick(); assert.equal(notices, count);
  assert.equal(maximum, 1);
  assert.ok(updates.length > 8);
  console.log('preferences writer: PASS (coalescing, revisions, ACK, failure/retry/discard, fallback, deep copy, unsubscribe)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
