"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const sandbox = { console, window: {
  ZETER_CORE_UTILS: { escapeHtml: value => String(value), $: () => null },
  ZETER_RICH_TEXT_UTILS: { cleanRichHtml: value => value },
  ZETER_MARKDOWN_UTILS: {}, ZETER_MANAGED_FILE_UTILS: {}
} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/editor-ui-utils.js"), "utf8"), sandbox);
const { createManagedDocumentSession } = sandbox.window.ZETER_EDITOR_UI_UTILS;
const missingHtml = sandbox.window.ZETER_EDITOR_UI_UTILS.managedDocumentUnavailableHTML({ code: "DOCUMENT_CONVERTER_MISSING" });
assert.match(missingHtml, /data-document-download/);
assert.match(missingHtml, /Проверить снова/);
assert.match(missingHtml, /уже находится в папке data/);
assert.equal(sandbox.window.ZETER_EDITOR_UI_UTILS.LIBREOFFICE_DOWNLOAD_URL, "https://www.libreoffice.org/download/download/");
assert.doesNotMatch(sandbox.window.ZETER_EDITOR_UI_UTILS.managedDocumentUnavailableHTML({ message: "broken document" }), /data-document-download/);

async function main() {
  const original = { id: "file1", name: "Исходник.doc", managedPath: "Файлы ZeTer OS/Стол/Исходник.doc", extension: "doc" };
  const item = { id: "item1", name: original.name, type: "managedFile", managedFile: original };
  let failState = false;
  let failConversion = false;
  let generation = 0;
  const writes = [];
  const session = createManagedDocumentSession({
    getItem: () => item,
    saveState: async () => {
      if (failState && item.managedFile !== original) throw new Error("state refused");
      writes.push(JSON.parse(JSON.stringify(item)));
      return { saved: true };
    },
    nativeStorageCall: async (method, payload) => {
      if (method === "read_managed_document") return { richHtml: "<p>Исходник</p>", sha256: "original-hash" };
      if (failConversion) throw new Error("converter refused");
      assert.equal(method, "save_managed_document");
      assert.equal(payload.managedPath, item.managedFile.managedPath);
      return { file: { ...original, name: "Работа.docx", extension: "docx", managedPath: `Файлы ZeTer OS/Стол/версия-${++generation}.docx` }, sha256: `hash-${generation}` };
    }
  });
  await session.load();
  const firstEditor = { revision: session.revision };
  const staleEditor = { revision: session.revision };
  const edit = { title: "Работа.doc", richHtml: "<p>Правка 1</p>", plainText: "Правка 1" };
  failConversion = true;
  await assert.rejects(session.save(edit, firstEditor), /converter refused/);
  assert.equal(item.managedFile, original);
  assert.equal(item.documentDraft.richContent, edit.richHtml, "draft survives converter failure");
  failConversion = false;
  failState = true;
  await assert.rejects(session.save(edit, firstEditor), /state refused/);
  assert.equal(item.managedFile, original, "pointer rolls back after state refusal");
  assert.equal(item.documentDraft.richContent, edit.richHtml);
  failState = false;
  await session.save(edit, firstEditor);
  assert.equal(item.sourceDocument.managedPath, original.managedPath, "original retained even before periodic backup");
  assert.equal(item.documentDraft, undefined);
  assert.equal(item.managedFile.extension, "docx");
  const committedPath = item.managedFile.managedPath;
  await assert.rejects(session.save({ ...edit, richHtml: "stale" }, staleEditor), /другом окне/);
  assert.equal(item.managedFile.managedPath, committedPath);
  await Promise.all([
    session.save({ ...edit, richHtml: "<p>Правка 2</p>" }, firstEditor),
    session.save({ ...edit, richHtml: "<p>Правка 3</p>" }, firstEditor)
  ]);
  assert.equal(session.richHtml, "<p>Правка 3</p>", "same editor rapid saves keep ordering");
  assert.equal(item.sourceDocument.managedPath, original.managedPath);
  assert.ok(writes.some(saved => saved.documentDraft), "draft is persisted before conversion");
  assert.equal(session.captureDraft({ ...edit, title: item.name, richHtml: "<p>До debounce</p>" }, firstEditor), true);
  assert.equal(item.documentDraft.richContent, "<p>До debounce</p>", "window/workspace sync captures the last edit before debounce");
  const queuedOld = session.save({ ...edit, title: item.name, richHtml: "<p>Снимок очереди</p>" }, firstEditor);
  session.captureDraft({ ...edit, title: item.name, richHtml: "<p>Самый новый ввод</p>" }, firstEditor);
  await queuedOld;
  assert.equal(item.documentDraft?.richContent, "<p>Самый новый ввод</p>", "older queued save must not erase input captured before conversion starts");

  sandbox.setTimeout = callback => callback();
  sandbox.window.ZETER_WINDOW_METRICS_UTILS = {};
  sandbox.window.ZETER_WINDOW_SESSION_UTILS = { collectWindowSessionsFromRuntime: () => [] };
  sandbox.window.ZETER_CORE_UTILS.cssEscape = value => value;
  sandbox.window.ZETER_CORE_UTILS.$$ = () => [];
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app/js/core/window-ui-utils.js"), "utf8"), sandbox);
  const area = { contentEditable: "true" }, title = { disabled: false }, status = {};
  let rejectClose;
  let closing = false;
  const liveEditor = { disposeManagedDocument: () => new Promise((_, reject) => { rejectClose = reject; }),
    querySelector: selector => selector.includes("area") ? area : selector.includes("title") ? title : status };
  const record = { el: { querySelector: () => liveEditor, classList: { add: () => { closing = true; } }, remove() {} } };
  const windows = new Map([["win", record]]);
  const windowController = sandbox.window.ZETER_WINDOW_UI_UTILS.createWindowRuntimeController({ getWindows: () => windows });
  const close = windowController.closeWindow("win");
  await Promise.resolve();
  assert.equal(windows.has("win"), true, "window stays present while saving");
  assert.equal(area.contentEditable, "false");
  rejectClose(new Error("disk refused"));
  assert.equal(await close, false);
  assert.equal(windows.has("win"), true, "failed close keeps the only live draft visible");
  assert.equal(closing, false);
  assert.equal(area.contentEditable, "true");
  assert.match(status.textContent, /disk refused/);
  liveEditor.disposeManagedDocument = async () => {};
  await windowController.closeWindow("win");
  assert.equal(windows.has("win"), false, "confirmed save permits closing");
  console.log("Managed document editor smoke: PASS (failure/retry, draft, original, conflicting windows, queued saves)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
