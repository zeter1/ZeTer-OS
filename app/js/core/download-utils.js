(() => {
  "use strict";

  const assetUtils = window.ZETER_ASSET_UTILS;
  const exportUtils = window.ZETER_EXPORT_UTILS;
  const nativeStorage = window.ZETER_NATIVE_STORAGE;
  if (!assetUtils || !exportUtils || !nativeStorage) throw new Error("ZeTer OS download utils require asset, export and native storage utils.");

  const { isDataImage } = assetUtils;
  const { sanitizeExportPathPart } = exportUtils;
  const { shouldUseNativeStorage, nativeStorageCall } = nativeStorage;

  function browserDownloadBlob(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  async function blobBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  async function downloadBlob(name, blob) {
    const safeBlob = blob instanceof Blob ? blob : new Blob([blob], { type: "application/octet-stream" });
    if (shouldUseNativeStorage()) {
      return nativeStorageCall("save_binary_download", {
        name,
        base64: await blobBase64(safeBlob),
        type: safeBlob.type || "application/octet-stream"
      });
    }
    browserDownloadBlob(name, safeBlob);
    return { ok: true, cancelled: false, fileName: name, directoryName: "Загрузки браузера" };
  }

  function downloadFile(name, content, type = "text/plain") {
    if (shouldUseNativeStorage()) {
      return nativeStorageCall("save_text_download", {
        name,
        content: String(content ?? ""),
        type
      });
    }
    return downloadBlob(name, new Blob([content], { type }));
  }

  function downloadDataUrl(filename, dataURL) {
    if (!isDataImage(dataURL)) return;
    const a = document.createElement("a");
    a.href = dataURL;
    a.download = sanitizeExportPathPart(filename || "image", "image");
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  window.ZETER_DOWNLOAD_UTILS = Object.freeze({
    downloadBlob,
    downloadFile,
    downloadDataUrl
  });
})();
