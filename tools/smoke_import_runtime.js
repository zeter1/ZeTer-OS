"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class FakeFileReader {
  readAsDataURL(file) {
    this.result = file.dataURL;
    this.onload();
  }
}

function loadImportUtils() {
  const context = vm.createContext({
    window: {},
    console,
    Blob,
    FileReader: FakeFileReader,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    ArrayBuffer,
    DataView,
    structuredClone,
    decodeURIComponent,
    atob
  });
  for (const relativePath of [
    "app/js/core/config.js",
    "app/js/core/asset-utils.js",
    "app/js/core/security-protection-utils.js"
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  }
  context.window.ZETER_CORE_UTILS = Object.freeze({
    byteSize: value => Buffer.byteLength(String(value || ""), "utf8"),
    bytesToHuman: value => `${value} B`,
    isSafeId: value => /^[A-Za-z0-9_-]{1,220}$/.test(String(value || ""))
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "app/js/core/import-utils.js"), "utf8");
  vm.runInContext(source, context, { filename: "app/js/core/import-utils.js" });
  return context.window.ZETER_IMPORT_UTILS;
}

function imageNode(pathValue) {
  const attrs = new Map([
    ["data-zeter-external-src", pathValue],
    ["src", pathValue]
  ]);
  return {
    getAttribute: name => attrs.get(name) || "",
    setAttribute: (name, value) => attrs.set(name, value),
    value: name => attrs.get(name)
  };
}

async function smokeHydration() {
  const { createExternalAssetImportController } = loadImportUtils();
  const root = { id: "backup-root" };
  const editorImage = imageNode("zeter-os-assets/images/editor/note/one.png");
  const missingEditorImage = imageNode("zeter-os-assets/images/editor/note/missing.png");
  const warnings = [];
  const files = new Map([
    ["zeter-os-assets/wallpapers/main.jpg", { dataURL: "data:image/jpeg;base64,d2FsbA==", type: "image/jpeg", size: 4 }],
    ["zeter-os-assets/desktop-icons/main.png", { dataURL: "data:image/png;base64,aWNvbg==", type: "image/png", size: 4 }],
    ["zeter-os-assets/images/files/photo.png", { dataURL: "data:image/png;base64,cGhvdG8=", type: "image/png", size: 5 }],
    ["zeter-os-assets/images/editor/note/one.png", { dataURL: "data:image/png;base64,bm90ZQ==", type: "image/png", size: 4 }]
  ]);
  const incoming = {
    settings: {
      customWallpaper: {
        externalWallpaper: { path: "zeter-os-assets/wallpapers/main.jpg", mime: "image/jpeg" }
      }
    },
    desktops: [{
      id: "main",
      icon: { externalDesktopIcon: { path: "zeter-os-assets/desktop-icons/main.png", mime: "image/png" } }
    }],
    fs: {
      photo: { externalImage: { path: "zeter-os-assets/images/files/photo.png", mime: "image/png" } },
      note: { richContent: '<img data-zeter-external-src="zeter-os-assets/images/editor/note/one.png">' }
    }
  };
  const controller = createExternalAssetImportController({
    collectVisualSettingsHolders: target => [{ desktopId: "main", settings: target.settings }],
    getDirectoryHandle: () => root,
    supportsExternalFolderSave: () => true,
    verifyPermission: async handle => handle === root,
    readBlobByPath: async (handle, assetPath) => {
      assert.strictEqual(handle, root);
      if (!files.has(assetPath)) throw new Error("missing");
      return files.get(assetPath);
    },
    createRichContentAdapter: () => ({
      images: [editorImage, missingEditorImage],
      serialize: () => `${editorImage.value("src")}|${missingEditorImage.value("src")}`
    }),
    warn: (...args) => warnings.push(args)
  });

  const report = await controller.hydrateExternalAssets(incoming);
  assert.deepStrictEqual({ ...report }, { total: 5, restored: 4, missing: 1 });
  assert.match(incoming.settings.customWallpaper.dataURL, /^data:image\/jpeg/);
  assert.match(incoming.desktops[0].icon.dataURL, /^data:image\/png/);
  assert.match(incoming.fs.photo.dataURL, /^data:image\/png/);
  assert.match(incoming.fs.note.richContent, /^data:image\/png/);
  assert.strictEqual(warnings.length, 1);
  console.log("external asset hydration smoke: OK");
}

async function smokeDirectorySelection() {
  const { createExternalAssetImportController } = loadImportUtils();
  const picked = { id: "picked-root" };
  let stored = null;
  const notices = [];
  const incoming = { fs: { image: { externalImage: { path: "zeter-os-assets/images/files/a.png" } } } };
  const controller = createExternalAssetImportController({
    getDirectoryHandle: () => null,
    setDirectoryHandle: handle => { stored = handle; },
    supportsExternalFolderSave: () => true,
    pickDirectory: async () => picked,
    verifyPermission: async handle => handle === picked,
    notify: (...args) => notices.push(args)
  });
  assert.strictEqual(await controller.getImportAssetDirectoryHandle(incoming), picked);
  assert.strictEqual(stored, picked);
  assert.strictEqual(notices.length, 1);

  const noAssets = await controller.hydrateExternalAssets({ fs: {} });
  assert.deepStrictEqual({ ...noAssets }, { total: 0, restored: 0, missing: 0 });

  const unavailable = createExternalAssetImportController({ supportsExternalFolderSave: () => false });
  await assert.rejects(
    () => unavailable.hydrateExternalAssets(incoming),
    /нужна папка zeter-os-assets/
  );
  console.log("external asset folder selection smoke: OK");
}

async function smokeImportAction() {
  const { runOsImportAction } = loadImportUtils();
  const notices = [];
  let replaced = null;
  let saved = false;
  let reloadScheduled = false;
  const input = {
    files: [{
      name: "zeter-os-state.json",
      type: "application/json",
      size: 40,
      text: async () => JSON.stringify({ state: { fs: {}, marker: "loaded" } })
    }],
    value: "selected"
  };
  const result = await runOsImportAction({ target: input }, {
    validateImportedState: incoming => ({ ...incoming, validated: true }),
    hydrateExternalAssets: async incoming => {
      assert.strictEqual(incoming.validated, true);
      return { total: 2, restored: 2, missing: 0 };
    },
    replaceState: incoming => { replaced = incoming; },
    saveState: async () => { saved = true; },
    notify: (...args) => notices.push(args),
    scheduleReload: () => { reloadScheduled = true; }
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.assetReport.restored, 2);
  assert.strictEqual(replaced.marker, "loaded");
  assert.strictEqual(saved, true);
  assert.strictEqual(reloadScheduled, true);
  assert.strictEqual(input.value, "");
  assert.deepStrictEqual(notices[0], [
    "Импорт проверен и выполнен",
    "Состояние ZeTer OS восстановлено. Картинки восстановлены: 2/2. Перед заменой создана аварийная точка."
  ]);

  let unsafeReplaceCalled = false;
  const unsafeNotices = [];
  const unsafeInput = {
    files: [{
      name: "unsafe-import.json",
      type: "application/json",
      size: 40,
      text: async () => JSON.stringify({ state: { fs: {}, marker: "unsafe" } })
    }],
    value: "selected"
  };
  const unsafe = await runOsImportAction({ target: unsafeInput }, {
    validateImportedState: incoming => incoming,
    requireSafetyPoint: true,
    createSafetyPoint: async () => null,
    replaceState: () => { unsafeReplaceCalled = true; },
    notify: (...args) => unsafeNotices.push(args)
  });
  assert.strictEqual(unsafe.ok, false);
  assert.strictEqual(unsafeReplaceCalled, false);
  assert.match(unsafeNotices[0][1], /не удалось создать аварийную точку/i);

  const emptyInput = { files: [], value: "unchanged" };
  assert.strictEqual(await runOsImportAction({ target: emptyInput }), null);
  assert.strictEqual(emptyInput.value, "unchanged");

  const errors = [];
  const failedNotices = [];
  const failedInput = {
    files: [{ name: "backup.json", type: "application/json", size: 10, text: async () => "{}" }],
    value: "selected"
  };
  const failed = await runOsImportAction({ target: failedInput }, {
    validateImportedState: () => { throw new Error("bad"); },
    notify: (...args) => failedNotices.push(args),
    logError: error => errors.push(error)
  });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(failedInput.value, "");
  assert.deepStrictEqual(failedNotices[0], [
    "Ошибка импорта",
    "Файл не похож на резервную копию ZeTer OS."
  ]);
  console.log("OS import action smoke: OK");
}

async function main() {
  await smokeHydration();
  await smokeDirectorySelection();
  await smokeImportAction();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
