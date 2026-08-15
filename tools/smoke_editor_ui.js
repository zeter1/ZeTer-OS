"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const escapeHtml = value => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

function runScript(relativePath, sandbox) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  vm.runInContext(source, sandbox, { filename: relativePath });
}

const richSandbox = {
  window: {
    ZETER_OS_CONFIG: { RICH_TEXT_IMAGE_MIME_TYPES: ["image/png"] },
    ZETER_CORE_UTILS: { escapeHtml },
    ZETER_ASSET_UTILS: {
      isDataImage: value => /^data:image\//i.test(String(value || "")),
      isExternalAssetPath: value => /^zeter-os-assets\//i.test(String(value || ""))
    },
    ZETER_SHORTCUT_UTILS: {
      normalizeWebUrl(value = "") {
        let target = String(value || "").trim();
        if (/^www\./i.test(target)) target = `https://${target}`;
        return /^https?:\/\/[^\s/]+/i.test(target) ? target : "";
      }
    }
  },
  console,
  document: {},
  globalThis: null
};
richSandbox.globalThis = richSandbox;
vm.createContext(richSandbox);
runScript("app/js/core/rich-text-utils.js", richSandbox);

const rich = richSandbox.window.ZETER_RICH_TEXT_UTILS;
const richSource = fs.readFileSync(path.join(projectRoot, "app/js/core/rich-text-utils.js"), "utf8");
assert.match(richSource, /const allowed = new Set\(\[[^\]]*"blockquote"/);
assert.strictEqual(rich.normalizeRichTextFontSize("8"), 8);
assert.strictEqual(rich.normalizeRichTextFontSize("199.6"), 200);
assert.strictEqual(rich.normalizeRichTextFontSize("7"), 0);
assert.strictEqual(rich.normalizeRichTextFontSize("201"), 0);
assert.strictEqual(rich.sanitizeRichTextSpanStyle("font-size: 27px;"), "font-size: 27px");
assert.strictEqual(rich.sanitizeRichTextSpanStyle("font-size: 27px; color: red"), "");
assert.strictEqual(rich.normalizeRichTextLink("www.example.com"), "https://www.example.com");
assert.strictEqual(rich.normalizeRichTextLink("javascript:alert(1)"), "");

const editorSandbox = {
  window: {
    ZETER_CORE_UTILS: { $: () => null, escapeHtml },
    ZETER_RICH_TEXT_UTILS: rich,
    ZETER_MARKDOWN_UTILS: { markdown: value => String(value || "") },
    ZETER_MANAGED_FILE_UTILS: {
      ensureManagedFileInlineMarkers: () => false,
      plainTextWithoutManagedFiles: () => ""
    }
  },
  console,
  document: {},
  globalThis: null
};
editorSandbox.globalThis = editorSandbox;
vm.createContext(editorSandbox);
runScript("app/js/core/editor-ui-utils.js", editorSandbox);

const editor = editorSandbox.window.ZETER_EDITOR_UI_UTILS;
const html = editor.richEditorHTML("Тест");
assert.match(html, /type="number" data-font-size min="8" max="200"/);
assert.doesNotMatch(html, /data-size=/);
assert.match(html, /data-action="link"/);
assert.match(html, /data-action="quote"/);
assert.match(html, /data-action="download-docx"/);
assert.match(html, /data-find-panel/);
assert.match(html, /data-range-overlay/);
assert.strictEqual((html.match(/data-image-resize=/g) || []).length, 4);

assert.strictEqual(editor.isRichEditorFindShortcut({ ctrlKey: true, code: "KeyF", key: "а" }), true);
assert.strictEqual(editor.isRichEditorFindShortcut({ ctrlKey: true, code: "", key: "А" }), true);
assert.strictEqual(editor.isRichEditorFindShortcut({ ctrlKey: true, altKey: true, code: "KeyF", key: "f" }), false);
assert.strictEqual(editor.isRichEditorFindShortcut({ ctrlKey: false, code: "KeyF", key: "f" }), false);
assert.strictEqual(editor.isRichEditorImageDeleteShortcut({ key: "Delete", code: "Delete" }), true);
assert.strictEqual(editor.isRichEditorImageDeleteShortcut({ key: "Delete", code: "Delete", isComposing: true }), false);
assert.strictEqual(editor.isRichEditorImageDeleteShortcut({ key: "Backspace", code: "Backspace" }), false);
assert.strictEqual(editor.isQuoteExitArrowShortcut({ key: "ArrowDown" }), true);
assert.strictEqual(editor.isQuoteExitArrowShortcut({ key: "ArrowDown", shiftKey: true }), false);
assert.strictEqual(editor.isQuoteExitArrowShortcut({ key: "ArrowDown", isComposing: true }), false);
assert.strictEqual(editor.isQuoteExitArrowShortcut({ key: "ArrowUp" }), false);
assert.strictEqual(editor.shouldRemoveQuoteFromSelection({ startInsideQuote: true, endInsideQuote: true, selectedText: "часть цитаты" }), true);
assert.strictEqual(editor.shouldRemoveQuoteFromSelection({ selectedText: "Вся цитата", selectedQuoteTexts: ["Вся\nцитата"] }), true);
assert.strictEqual(editor.shouldRemoveQuoteFromSelection({ selectedText: "Ввод Вся цитата", selectedQuoteTexts: ["Вся цитата"] }), false);
assert.strictEqual(editor.quoteTextForClipboard({ innerText: "  Первая строка\nВторая строка  " }), "Первая строка\nВторая строка");
assert.strictEqual(editor.quoteTextForClipboard(null), "");

const makeFakeElement = tagName => ({
  tagName: String(tagName || "").toUpperCase(),
  textContent: "",
  children: [],
  appendChild(child) {
    this.children.push(child);
    return child;
  }
});
const fakeQuote = makeFakeElement("blockquote");
const fakeArea = makeFakeElement("div");
fakeArea.lastElementChild = fakeQuote;
fakeArea.appendChild = function appendChild(child) {
  child.previousElementSibling = this.lastElementChild;
  this.children.push(child);
  this.lastElementChild = child;
  return child;
};
const fakeDocument = { createElement: makeFakeElement };
const createdQuoteExit = editor.ensureTrailingQuoteExitParagraph(fakeArea, fakeDocument);
assert.strictEqual(createdQuoteExit.changed, true);
assert.strictEqual(createdQuoteExit.quote, fakeQuote);
assert.strictEqual(createdQuoteExit.paragraph.tagName, "P");
assert.strictEqual(createdQuoteExit.paragraph.children[0].tagName, "BR");
const existingQuoteExit = editor.ensureTrailingQuoteExitParagraph(fakeArea, fakeDocument);
assert.strictEqual(existingQuoteExit.changed, false);
assert.strictEqual(existingQuoteExit.paragraph, createdQuoteExit.paragraph);

const fakeCaretContainer = {};
fakeQuote.contains = node => node === fakeCaretContainer;
const fakeRange = { endContainer: fakeCaretContainer, endOffset: 4 };
const rangeDocument = {
  createRange: () => ({
    collapsed: false,
    selectNodeContents() {},
    setStart() { this.collapsed = true; }
  })
};
assert.strictEqual(editor.rangeEndsAtElementEnd(fakeRange, fakeQuote, rangeDocument), true);
assert.strictEqual(editor.rangeEndsAtElementEnd(fakeRange, fakeQuote, {
  createRange: () => ({ collapsed: false, selectNodeContents() {}, setStart() {} })
}), false);
assert.strictEqual(editor.rangeEndsAtElementEnd({ endContainer: {}, endOffset: 0 }, fakeQuote, rangeDocument), false);

assert.deepStrictEqual(
  Array.from(editor.findTextMatchOffsets("Альфа beta альфа", "АЛЬФА"), match => ({ ...match })),
  [{ start: 0, end: 5 }, { start: 11, end: 16 }]
);
assert.deepStrictEqual(Array.from(editor.findTextMatchOffsets("Текст", "")), []);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(editor.rangeOverlayRectangles({
    getClientRects: () => [
      { left: 12, top: 22, right: 42, bottom: 34 },
      { left: 5, top: 10, right: 18, bottom: 25 },
      { left: 70, top: 70, right: 80, bottom: 80 }
    ]
  }, { left: 10, top: 20 }, { left: 15, top: 21, right: 60, bottom: 50 }))),
  [
    { left: 5, top: 2, width: 27, height: 12 },
    { left: 5, top: 1, width: 3, height: 4 }
  ]
);

assert.deepStrictEqual(
  { ...editor.imageResizeDimensions({ startWidth: 400, startHeight: 200, deltaX: -200, direction: "se" }) },
  { width: 200, height: 100 }
);
assert.deepStrictEqual(
  { ...editor.imageResizeDimensions({ startWidth: 400, startHeight: 200, deltaX: 100, direction: "nw" }) },
  { width: 300, height: 150 }
);
assert.deepStrictEqual(
  { ...editor.imageResizeDimensions({ startWidth: 400, startHeight: 200, deltaX: 1000, direction: "se", maxWidth: 500 }) },
  { width: 500, height: 250 }
);
assert.deepStrictEqual(
  { ...editor.imageResizeDimensions({ startWidth: 400, startHeight: 200, deltaX: -1000, direction: "se" }) },
  { width: 48, height: 24 }
);

async function runRuntimeSmoke() {
  const autosaveStatuses = [];
  const pendingSaves = [];
  const autosave = editor.createAutosaveStatusController({
    save: payload => new Promise((resolve, reject) => pendingSaves.push({ payload, resolve, reject })),
    setStatus: value => autosaveStatuses.push(value),
    now: () => ({ toLocaleTimeString: () => "12:34:56" })
  });
  const staleSave = autosave.run({ revision: 1 });
  assert.strictEqual(autosaveStatuses.at(-1), "Сохранение…");
  const latestSave = autosave.run({ revision: 2 });
  pendingSaves[0].resolve({ saved: true, fallback: false });
  await staleSave;
  assert.strictEqual(autosaveStatuses.at(-1), "Сохранение…", "stale save must not overwrite the latest status");
  pendingSaves[1].reject(new Error("disk full"));
  await assert.rejects(latestSave, /disk full/);
  assert.strictEqual(autosaveStatuses.at(-1), "Не сохранено: disk full");

  const fallbackStatuses = [];
  const fallbackAutosave = editor.createAutosaveStatusController({
    save: async () => ({ saved: true, fallback: true }),
    setStatus: value => fallbackStatuses.push(value),
    now: () => ({ toLocaleTimeString: () => "12:34:56" })
  });
  await fallbackAutosave.run({ revision: 3 });
  assert.strictEqual(fallbackStatuses.at(-1), "Сохранено аварийно: 12:34:56");

  const state = {
    fs: {
      note1: {
        id: "note1",
        type: "note",
        name: "План.txt",
        parent: "desktop",
        content: "Старый текст",
        richContent: "<p>Старый текст</p>"
      }
    }
  };
  let richOptions = null;
  let exportedItem = null;
  let downloaded = null;
  let saveCalls = 0;
  const copyText = async () => true;
  const controller = editor.createDocumentEditorRuntimeController({
    getState: () => state,
    getDesktopRoot: () => "desktop",
    createRichEditor: options => {
      richOptions = options;
      return { dataset: {} };
    },
    buildNoteDocx: async item => {
      exportedItem = item;
      return { kind: "docx-blob" };
    },
    downloadBlob: async (name, blob) => {
      downloaded = { name, blob };
      return { ok: true, cancelled: false };
    },
    sanitizeExportPathPart: name => String(name).replace(/[\\/:*?"<>|]/g, "_"),
    stripKnownExtension: name => String(name).replace(/\.(txt|docx|html)$/i, ""),
    saveState: async () => {
      saveCalls++;
      return { saved: true, fallback: false };
    },
    copyText,
    documentRef: {}
  });
  const root = controller.renderRichEditorApp({ itemId: "note1" }, "win1");
  assert.strictEqual(root.dataset.managedFileItemId, "note1");
  assert.strictEqual(typeof richOptions.downloadDocx, "function");
  assert.strictEqual(richOptions.copyText, copyText);
  const saveResult = await richOptions.save({
    title: "Сохранённый план.txt",
    richHtml: "<p>Сохранённый текст</p>",
    plainText: "Сохранённый текст"
  });
  assert.deepStrictEqual(saveResult, { saved: true, fallback: false });
  assert.strictEqual(saveCalls, 1);
  const result = await richOptions.downloadDocx({
    title: "Итог: план.txt",
    richHtml: "<p>Новый <b>текст</b></p>",
    plainText: "Новый текст"
  });
  assert.deepStrictEqual(result, { ok: true, cancelled: false });
  assert.strictEqual(exportedItem.name, "Итог: план.txt");
  assert.strictEqual(exportedItem.richContent, "<p>Новый <b>текст</b></p>");
  assert.strictEqual(exportedItem.content, "Новый текст");
  assert.strictEqual(downloaded.name, "Итог_ план.docx");
  assert.deepStrictEqual(downloaded.blob, { kind: "docx-blob" });
}

runRuntimeSmoke().then(() => {
  console.log("editor UI smoke: ok");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
