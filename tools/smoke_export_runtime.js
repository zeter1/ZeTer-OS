"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const ROOT = process.cwd();

function loadScript(context, relativePath) {
  const source = fs.readFileSync(`${ROOT}/${relativePath}`, "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

function createContext() {
  const window = {
    ZETER_OS_CONFIG: {
      BACKUP_IMPORT_MAX_ZIP_ENTRIES: 200,
      ALLOWED_IMAGE_MIME_TYPES: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]
    }
  };
  const context = vm.createContext({
    window,
    console,
    Blob,
    Uint8Array,
    ArrayBuffer,
    DataView,
    TextEncoder,
    TextDecoder,
    Date,
    JSON,
    Math,
    Set,
    Map,
    Promise,
    structuredClone,
    atob,
    btoa,
    decodeURIComponent,
    encodeURIComponent,
    globalThis: null
  });
  context.globalThis = context;
  return context;
}

function loadExportStack(context) {
  if (!context.window.ZETER_ASSET_UTILS) loadScript(context, "app/js/core/asset-utils.js");
  if (!context.window.ZETER_SECURITY_PROTECTION_UTILS) loadScript(context, "app/js/core/security-protection-utils.js");
  loadScript(context, "app/js/core/export-utils.js");
}

class FakeDirectory {
  constructor(name = "root") {
    this.name = name;
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) throw new Error(`Missing directory: ${name}`);
      this.directories.set(name, new FakeDirectory(name));
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name) && !create) throw new Error(`Missing file: ${name}`);
    const directory = this;
    return {
      async createWritable() {
        return {
          async write(blob) { directory.files.set(name, blob); },
          async close() {}
        };
      },
      async getFile() {
        const value = directory.files.get(name);
        return value instanceof Blob ? value : new Blob([value ?? ""]);
      }
    };
  }

  async *entries() {
    for (const entry of this.directories) yield entry;
    for (const entry of this.files) yield entry;
  }

  async removeEntry(name) {
    this.directories.delete(name);
    this.files.delete(name);
  }
}

async function smokeAssetIo() {
  const context = createContext();
  loadScript(context, "app/js/core/asset-utils.js");
  const root = new FakeDirectory();
  const controller = context.window.ZETER_ASSET_UTILS.createExternalAssetIoController({ getRootHandle: () => root });

  await controller.writeBlobByPath(root, "nested/test.txt", new Blob(["hello"]));
  assert.strictEqual(await (await controller.readBlobByPath(root, "nested/test.txt")).text(), "hello");

  await controller.saveDataImageAsset("images/pixel.png", "data:image/png;base64,aGVsbG8=");
  assert.strictEqual((await controller.readBlobByPath(root, "images/pixel.png")).type, "image/png");

  await controller.writeBlobByPath(root, "readable/old.txt", new Blob(["old"]));
  await controller.writeEntries(root, "readable", [{ path: "new.txt", blob: new Blob(["new"]) }]);
  assert.strictEqual(await (await controller.readBlobByPath(root, "readable/new.txt")).text(), "new");
  await assert.rejects(() => controller.readBlobByPath(root, "../unsafe.txt"), /Небезопасный путь/);
  console.log("external asset io smoke: ok");
}

async function smokeReadableRuntime() {
  const context = createContext();
  context.window.ZETER_CORE_UTILS = {
    parseISO: value => new Date(`${value}T00:00:00`),
    pad: value => String(value).padStart(2, "0")
  };
  context.window.ZETER_RICH_TEXT_UTILS = {
    notePlainText: item => item.content || "",
    collectNoteImageSources: () => []
  };
  context.window.ZETER_DATA_NORMALIZERS = {
    DEFAULT_TASK_PROJECT_NAME: "Без проекта",
    TASK_PROJECT_UNASSIGNED: "unassigned",
    taskReminderLabel: value => String(value || ""),
    taskReminderRepeatLabel: value => String(value || ""),
    normalizeCalendarCategory: value => value || "personal"
  };
  loadScript(context, "app/js/core/asset-utils.js");
  loadExportStack(context);
  loadScript(context, "app/js/core/readable-export-utils.js");

  const state = {
    desktops: [
      { id: "desktop", name: "Основной", data: {} },
      { id: "desk2", name: "Второй", data: { explorerRootId: "root2" } }
    ],
    fs: {
      root2: { id: "root2", type: "folder", systemRole: "explorerRoot", parent: "desk2" },
      folder: { id: "folder", type: "folder", name: "Проекты", parent: "root2" },
      note: { id: "note", type: "note", name: "План", parent: "folder", content: "old" },
      noteDuplicate: { id: "noteDuplicate", type: "note", name: "План", parent: "root2", content: "duplicate" }
    }
  };
  let ensureCount = 0;
  let saveCount = 0;
  const editorArea = { innerHTML: "<b>new</b>", innerText: "new" };
  const editorTitle = { value: "План 2" };
  const editorElement = { fields: { ".editor-title": editorTitle, ".rich-editor-area": editorArea } };
  const windows = new Map([["win1", { appId: "editor", params: { itemId: "note" }, el: editorElement }]]);
  const controller = context.window.ZETER_READABLE_EXPORT_UTILS.createReadableExportRuntimeController({
    getState: () => state,
    ensureDesktops: () => { ensureCount++; },
    isDesktopRoot: id => id === "desktop" || id === "desk2",
    isExplorerRoot: id => id === "root2",
    desktopName: id => state.desktops.find(desk => desk.id === id)?.name || id,
    getWindows: () => windows,
    getStickyCards: () => [],
    getItem: id => state.fs[id],
    query: (selector, element) => element.fields?.[selector] || null,
    cleanRichHtml: value => value,
    plainToRichHtml: value => `<p>${value}</p>`,
    saveState: () => { saveCount++; },
    trashRoot: "trash"
  });

  assert.strictEqual(controller.desktopIdForItem(state.fs.note), "desk2");
  assert.deepStrictEqual(Array.from(controller.folderTrail(state.fs.note)), ["Проекты"]);
  const notes = Array.from(controller.collectNotes());
  assert.strictEqual(notes.length, 2);
  assert.strictEqual(notes[0].desktopId, "desk2");
  const readableEntries = await controller.buildEntries();
  const notePaths = readableEntries
    .map(entry => entry.path)
    .filter(path => path.startsWith("Заметки/Второй/"));
  assert.deepStrictEqual(Array.from(notePaths), ["Заметки/Второй/План.docx", "Заметки/Второй/План (2).docx"]);
  assert.ok(notePaths.every(path => !path.includes("/Проекты/")));
  console.log("readable ownership and note collection smoke: ok");
  assert.strictEqual(controller.syncLiveEditors(), true);
  assert.strictEqual(state.fs.note.name, "План 2");
  assert.strictEqual(state.fs.note.content, "new");
  assert.strictEqual(saveCount, 1);
  assert.ok(ensureCount >= 3);
  console.log("readable live-source sync smoke: ok");
}

async function smokeExternalRuntime() {
  const context = createContext();
  loadExportStack(context);

  const root = new FakeDirectory();
  const workspace = { externalSaveEnabled: true, externalSaveStatus: "" };
  const state = { version: 1, settings: {}, fs: {}, desktops: [] };
  let directoryHandle = root;
  let syncOpenCount = 0;
  let syncEditorsCount = 0;
  let saveCount = 0;
  let storedHandle = null;
  let timerRecord = null;
  const notifications = [];
  const ioContext = createContext();
  loadScript(ioContext, "app/js/core/asset-utils.js");
  const io = ioContext.window.ZETER_ASSET_UTILS.createExternalAssetIoController({ getRootHandle: () => directoryHandle });

  const controller = context.window.ZETER_EXPORT_UTILS.createExternalBackupRuntimeController({
    getState: () => state,
    getWorkspace: () => workspace,
    getDirectoryHandle: () => directoryHandle,
    setDirectoryHandle: handle => { directoryHandle = handle; },
    nativeMode: () => false,
    storageStateBytes: () => 42,
    version: "3.55",
    versionNumber: 3.55,
    assetRoot: "zeter-os-assets",
    assetRoots: ["zeter-os-assets/images"],
    buildExternalBackupStateModel: async (target, options) => {
      options.syncBeforeBackup();
      return { state: structuredClone(target), assets: [] };
    },
    syncOpenWindows: () => { syncOpenCount++; },
    syncLiveEditors: () => { syncEditorsCount++; },
    buildReadableEntries: async () => [{ path: "notes.txt", blob: new Blob(["note"]) }],
    createZipBlob: context.window.ZETER_ASSET_UTILS.createZipBlob,
    clearDirectory: (handle, path) => io.clearDirectory(handle, path),
    writeBlobByPath: (handle, path, blob) => io.writeBlobByPath(handle, path, blob),
    saveState: () => { saveCount++; },
    verifyPermission: async () => true,
    storeDirectory: async handle => { storedHandle = handle; },
    loadDirectory: async () => root,
    pickDirectory: async () => root,
    notify: (title, text) => notifications.push([title, text]),
    refresh: () => {},
    windowRef: { showDirectoryPicker() {}, indexedDB: {} },
    setTimeout: (callback, delay) => { timerRecord = { callback, delay }; return timerRecord; },
    clearTimeout: timer => { if (timer === timerRecord) timerRecord = null; }
  });

  assert.strictEqual(controller.supportsExternalFolderSave(), true);
  const payload = JSON.parse(await controller.externalSavePayload());
  assert.strictEqual(payload.backupMode, "json-plus-external-images-and-readable-data");
  assert.strictEqual(payload.storageStateBytes, 42);

  const zip = await controller.buildDownloadOsDataZip();
  const zipEntries = await context.window.ZETER_ASSET_UTILS.readStoredZipEntries(await zip.arrayBuffer());
  assert.ok(zipEntries.has("zeter-os-state.json"));
  assert.ok(zipEntries.has("notes.txt"));
  assert.ok(zipEntries.has("zeter-backup-manifest.json"));
  assert.strictEqual(zip.zeterVerification.verified, true);
  assert.ok(syncOpenCount >= 2);
  console.log("export payload and zip smoke: ok");

  assert.strictEqual(await controller.writeExternalBackup("manual"), true);
  assert.strictEqual(syncEditorsCount, 1);
  assert.match(String(root.files.get("zeter-os-state.json")), /ZeTer OS/);
  assert.strictEqual(await (await io.readBlobByPath(root, "zeter-os-data/notes.txt")).text(), "note");
  assert.match(workspace.externalSaveStatus, /^Сохранено и проверено:/);
  assert.ok(saveCount >= 1);
  console.log("external backup write smoke: ok");

  assert.strictEqual(controller.scheduleExternalBackup(), true);
  assert.strictEqual(timerRecord.delay, 900);
  assert.strictEqual(controller.runtimeState().scheduled, true);
  console.log("external backup scheduler smoke: ok");

  await controller.chooseExternalSaveFolder();
  assert.strictEqual(storedHandle, root);
  controller.clearRuntimeState();
  assert.strictEqual(directoryHandle, null);
  assert.strictEqual(workspace.externalSaveEnabled, false);
  assert.strictEqual(controller.runtimeState().scheduled, false);
  workspace.externalSaveEnabled = true;
  await controller.initExternalSaveFolder();
  assert.strictEqual(directoryHandle, root);
  assert.strictEqual(controller.runtimeState().scheduled, true);
  controller.clearRuntimeState();
  assert.ok(notifications.length >= 1);
  console.log("external folder picker and init smoke: ok");
}

async function smokeDownloadRuntime() {
  const nativeContext = createContext();
  const nativeCalls = [];
  nativeContext.window.ZETER_ASSET_UTILS = { isDataImage: () => false };
  nativeContext.window.ZETER_EXPORT_UTILS = { sanitizeExportPathPart: value => String(value || "file") };
  nativeContext.window.ZETER_NATIVE_STORAGE = {
    shouldUseNativeStorage: () => true,
    nativeStorageCall: async (method, payload) => {
      nativeCalls.push({ method, payload });
      if (payload.name === "Отменено.csv") {
        return { ok: true, cancelled: true, fileName: payload.name };
      }
      return { ok: true, cancelled: false, fileName: payload.name, directoryName: "D:\\Экспорт" };
    }
  };
  loadScript(nativeContext, "app/js/core/download-utils.js");
  const nativeResult = await nativeContext.window.ZETER_DOWNLOAD_UTILS.downloadFile(
    "Таблица - Страница 1.csv",
    "A,B\n1,2",
    "text/csv;charset=utf-8"
  );
  assert.strictEqual(nativeCalls.length, 1);
  assert.strictEqual(nativeCalls[0].method, "save_text_download");
  assert.strictEqual(nativeCalls[0].payload.content, "A,B\n1,2");
  assert.strictEqual(nativeResult.cancelled, false);
  assert.strictEqual(nativeResult.directoryName, "D:\\Экспорт");

  const binaryResult = await nativeContext.window.ZETER_DOWNLOAD_UTILS.downloadBlob(
    "Таблица.xlsx",
    new Blob(["PK-test"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
  assert.strictEqual(nativeCalls.length, 2);
  assert.strictEqual(nativeCalls[1].method, "save_binary_download");
  assert.strictEqual(nativeCalls[1].payload.name, "Таблица.xlsx");
  assert.strictEqual(Buffer.from(nativeCalls[1].payload.base64, "base64").toString("utf8"), "PK-test");
  assert.strictEqual(binaryResult.cancelled, false);

  const cancelledResult = await nativeContext.window.ZETER_DOWNLOAD_UTILS.downloadFile(
    "Отменено.csv",
    "A",
    "text/csv"
  );
  assert.strictEqual(cancelledResult.cancelled, true);

  const browserContext = createContext();
  let anchorClickCount = 0;
  let anchorRemoved = false;
  browserContext.window.ZETER_ASSET_UTILS = { isDataImage: () => false };
  browserContext.window.ZETER_EXPORT_UTILS = { sanitizeExportPathPart: value => String(value || "file") };
  browserContext.window.ZETER_NATIVE_STORAGE = {
    shouldUseNativeStorage: () => false,
    nativeStorageCall: async () => { throw new Error("native call must not run in browser mode"); }
  };
  browserContext.document = {
    body: { appendChild() {} },
    createElement: () => ({
      href: "",
      download: "",
      click() { anchorClickCount++; },
      remove() { anchorRemoved = true; }
    })
  };
  browserContext.URL = {
    createObjectURL: () => "blob:test",
    revokeObjectURL() {}
  };
  browserContext.setTimeout = callback => { callback(); return 1; };
  loadScript(browserContext, "app/js/core/download-utils.js");
  const browserResult = await browserContext.window.ZETER_DOWNLOAD_UTILS.downloadFile("table.csv", "A", "text/csv");
  assert.strictEqual(anchorClickCount, 1);
  assert.strictEqual(anchorRemoved, true);
  assert.strictEqual(browserResult.fileName, "table.csv");
  const browserBinaryResult = await browserContext.window.ZETER_DOWNLOAD_UTILS.downloadBlob(
    "table.xlsx",
    new Blob(["PK"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
  assert.strictEqual(anchorClickCount, 2);
  assert.strictEqual(browserBinaryResult.fileName, "table.xlsx");
  console.log("browser and native text/binary download smoke: ok");
}

function smokeTableCsvRuntime() {
  const context = createContext();
  context.window.ZETER_CORE_UTILS = {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value))
  };
  loadExportStack(context);
  loadScript(context, "app/js/core/shortcut-utils.js");
  loadScript(context, "app/js/core/managed-file-utils.js");
  loadScript(context, "app/js/core/table-utils.js");

  const rows = [
    ["пав па", "в пва пва", ""],
    ["1,2", "точка;запятая", "кавычка \"и\"\nстрока"]
  ];
  const csv = context.window.ZETER_EXPORT_UTILS.tablePageToCSV({ rows });
  assert.strictEqual(
    csv,
    "пав па;в пва пва;\r\n\"1,2\";\"точка;запятая\";\"кавычка \"\"и\"\"\nстрока\"\r\n"
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.window.ZETER_TABLE_UTILS.parseCSVRows(csv))),
    rows
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.window.ZETER_TABLE_UTILS.parseCSVRows("A,B\n1,2\n"))),
    [["A", "B"], ["1", "2"]]
  );
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.window.ZETER_TABLE_UTILS.parseCSVRows("\uFEFFA;B\r\n1;2\r\n"))),
    [["A", "B"], ["1", "2"]]
  );
  const fittedTable = context.window.ZETER_TABLE_UTILS.normalizeTableData({
    pages: [{
      name: "Лист",
      columns: ["A"],
      rows: [[""]],
      columnWidths: [70],
      rowHeights: [38],
      managedFiles: [{
        id: "file-fit",
        name: "длинное имя.mp3",
        managedPath: "Файлы ZeTer OS/длинное имя.mp3",
        row: 0,
        col: 0,
        displayWidth: 180,
        offsetX: 44,
        offsetY: 9
      }]
    }]
  });
  assert.strictEqual(fittedTable.pages[0].managedFiles[0].displayWidth, 180);
  assert.strictEqual(fittedTable.pages[0].managedFiles[0].offsetX, 44);
  assert.strictEqual(fittedTable.pages[0].managedFiles[0].offsetY, 9);
  console.log("Excel-compatible table CSV smoke: ok");
}

async function smokeTableXlsxRuntime() {
  const context = createContext();
  loadScript(context, "app/js/core/asset-utils.js");
  loadExportStack(context);
  loadScript(context, "app/js/core/xlsx-utils.js");

  const table = {
    activePage: 1,
    pages: [
      {
        name: "Страница 1",
        columns: ["A", "B", "C"],
        rows: [["пав па", "в пва пва", ""], ["", "", "н кекке"]],
        columnWidths: [138, 138, 360],
        rowHeights: [38, 72],
        active: { row: 1, col: 2 }
      },
      {
        name: "Страница 434343",
        columns: ["A", "B"],
        rows: [["второй", "лист"]],
        columnWidths: [200, 90],
        rowHeights: [55],
        active: { row: 0, col: 0 }
      }
    ]
  };
  const blob = await context.window.ZETER_XLSX_UTILS.buildTableXlsxBlob(table);
  assert.strictEqual(blob.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.strictEqual(String.fromCharCode(bytes[0], bytes[1]), "PK");

  const entries = await context.window.ZETER_ASSET_UTILS.readStoredZipEntries(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const workbook = decoder.decode(entries.get("xl/workbook.xml"));
  const sheet1 = decoder.decode(entries.get("xl/worksheets/sheet1.xml"));
  const sheet2 = decoder.decode(entries.get("xl/worksheets/sheet2.xml"));
  assert.ok(workbook.includes('activeTab="1"'));
  assert.ok(workbook.includes('name="Страница 1"'));
  assert.ok(workbook.includes('name="Страница 434343"'));
  assert.ok(sheet1.includes('dimension ref="A1:C2"'));
  assert.ok(sheet1.includes('min="3" max="3" width="50.71" customWidth="1"'));
  assert.ok(sheet1.includes('row r="2" ht="54" customHeight="1"'));
  assert.ok(sheet1.includes('activeCell="C2"'));
  assert.ok(sheet1.includes("пав па"));
  assert.ok(sheet2.includes('min="1" max="1" width="27.86" customWidth="1"'));
  assert.ok(sheet2.includes('row r="1" ht="41.25" customHeight="1"'));
  assert.ok(entries.has("xl/styles.xml"));
  console.log("multi-sheet XLSX dimensions smoke: ok");
}

async function main() {
  const target = process.argv[2] || "all";
  if (target === "asset" || target === "all") await smokeAssetIo();
  if (target === "readable" || target === "all") await smokeReadableRuntime();
  if (target === "external" || target === "all") await smokeExternalRuntime();
  if (target === "download" || target === "all") await smokeDownloadRuntime();
  if (target === "table-csv" || target === "all") smokeTableCsvRuntime();
  if (target === "table-xlsx" || target === "all") await smokeTableXlsxRuntime();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
