(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS shortcut utils require core utils.");

  const { escapeHtml } = coreUtils;
  const INTERNAL_TARGET_RE = /^zeter:\/\/item\/([\w.-]{1,160})$/i;
  const WINDOWS_DRIVE_PATH_RE = /^[a-z]:[\\/]/i;
  const WINDOWS_UNC_PATH_RE = /^\\\\[^\\/]+[\\/][^\\/]+/;
  const MAX_SHORTCUT_TARGET_LENGTH = 32768;

  function stripOuterQuotes(value = "") {
    const raw = String(value || "").trim();
    if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  }

  function normalizeWebUrl(value = "") {
    let raw = stripOuterQuotes(value);
    if (/^www\./i.test(raw)) raw = `https://${raw}`;
    if (!/^https?:\/\//i.test(raw) || raw.length > MAX_SHORTCUT_TARGET_LENGTH) return "";
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function normalizeWindowsPath(value = "") {
    const raw = stripOuterQuotes(value);
    if (!raw || raw.length > MAX_SHORTCUT_TARGET_LENGTH || raw.includes("\0")) return "";
    if (!WINDOWS_DRIVE_PATH_RE.test(raw) && !WINDOWS_UNC_PATH_RE.test(raw)) return "";
    return raw;
  }

  function shortcutTargetForItem(itemId = "") {
    const id = String(itemId || "").trim();
    return /^[\w.-]{1,160}$/.test(id) ? `zeter://item/${id}` : "";
  }

  function normalizeShortcutTarget(value = "") {
    const raw = stripOuterQuotes(value);
    if (!raw || raw.length > MAX_SHORTCUT_TARGET_LENGTH) return null;
    const internal = raw.match(INTERNAL_TARGET_RE);
    if (internal) return { kind: "zeter", target: shortcutTargetForItem(internal[1]), itemId: internal[1] };
    const url = normalizeWebUrl(raw);
    if (url) return { kind: "url", target: url };
    const windowsPath = normalizeWindowsPath(raw);
    if (windowsPath) return { kind: "windows", target: windowsPath };
    return null;
  }

  function normalizeShortcutRecord(raw = {}) {
    if (typeof raw === "string") raw = { target: raw };
    if (!raw || typeof raw !== "object") return null;
    const nested = raw.shortcut && typeof raw.shortcut === "object" ? raw.shortcut : raw;
    const normalized = normalizeShortcutTarget(nested.target || nested.shortcutTarget || raw.shortcutTarget || "");
    return normalized ? { target: normalized.target, kind: normalized.kind, ...(normalized.itemId ? { itemId: normalized.itemId } : {}) } : null;
  }

  function shortcutIcon(shortcut = {}) {
    const normalized = normalizeShortcutRecord(shortcut);
    if (normalized?.kind === "url") return "🌐";
    if (normalized?.kind === "windows") return "↗";
    return "🔗";
  }

  function shortcutKindLabel(shortcut = {}) {
    const normalized = normalizeShortcutRecord(shortcut);
    if (normalized?.kind === "url") return "Сайт";
    if (normalized?.kind === "windows") return "Файл или папка Windows";
    if (normalized?.kind === "zeter") return "Элемент ZeTer OS";
    return "Некорректная цель";
  }

  function shortcutDefaultName(shortcut = {}, options = {}) {
    const normalized = normalizeShortcutRecord(shortcut);
    if (!normalized) return "Новый ярлык";
    if (normalized.kind === "zeter") {
      const item = typeof options.getItem === "function" ? options.getItem(normalized.itemId) : null;
      return String(item?.name || "Ярлык ZeTer OS").trim() || "Ярлык ZeTer OS";
    }
    if (normalized.kind === "url") {
      try { return new URL(normalized.target).hostname.replace(/^www\./i, "") || "Сайт"; } catch { return "Сайт"; }
    }
    const parts = normalized.target.replace(/[\\/]+$/, "").split(/[\\/]/);
    return String(parts.pop() || normalized.target || "Ярлык Windows").trim() || "Ярлык Windows";
  }

  function createShortcutAttachment(shortcut = {}, options = {}) {
    const normalized = normalizeShortcutRecord(shortcut);
    if (!normalized) return null;
    const name = String(options.name || shortcutDefaultName(normalized, options)).trim() || "Ярлык";
    return {
      id: String(options.id || `shortcut-ref-${Date.now().toString(36)}`),
      name,
      kind: "shortcut",
      shortcutTarget: normalized.target,
      shortcutKind: normalized.kind,
      size: 0,
      mime: "application/x-zeter-shortcut",
      extension: "shortcut",
      importedAt: Math.max(0, Math.round(Number(options.importedAt) || Date.now()))
    };
  }

  function normalizeShortcutItems(state = {}) {
    Object.values(state?.fs || {}).forEach(item => {
      if (!item || item.type !== "shortcut") return;
      const shortcut = normalizeShortcutRecord(item.shortcut || item.managedFile || item);
      if (!shortcut) return;
      item.shortcut = shortcut;
      item.extension = "shortcut";
      item.managedFile = {
        ...(item.managedFile && typeof item.managedFile === "object" ? item.managedFile : {}),
        ...createShortcutAttachment(shortcut, {
          id: item.managedFile?.id || `${item.id}-ref`,
          name: item.name,
          importedAt: item.createdAt
        })
      };
    });
    return state;
  }

  function shortcutEditorHTML({ target = "", name = "" } = {}) {
    return `<form class="shortcut-editor-form" data-shortcut-form>
      <div class="shortcut-editor-intro">
        <span class="shortcut-editor-icon" data-shortcut-icon>🔗</span>
        <div><h2>Создание ярлыка</h2><p>Вставь путь Windows, адрес сайта или путь ZeTer OS, скопированный из меню элемента.</p></div>
      </div>
      <label class="shortcut-editor-field"><span>Путь или ссылка</span>
        <textarea data-shortcut-target rows="4" spellcheck="false" placeholder="C:\\Папка\\файл.mp4&#10;https://example.com&#10;zeter://item/..."></textarea>
      </label>
      <div class="shortcut-editor-type" data-shortcut-type>Укажи путь или ссылку</div>
      <label class="shortcut-editor-field"><span>Название ярлыка</span>
        <input data-shortcut-name value="${escapeHtml(name)}" placeholder="Заполнится автоматически" autocomplete="off">
      </label>
      <p class="shortcut-editor-error" data-shortcut-error aria-live="polite"></p>
      <div class="shortcut-editor-actions">
        <button type="button" data-shortcut-cancel>Отмена</button>
        <button type="button" data-shortcut-test disabled>Проверить открытие</button>
        <button type="submit" class="primary" data-shortcut-create disabled>Создать ярлык</button>
      </div>
    </form>`;
  }

  function createShortcutEditorApp(params = {}, winId = "", options = {}) {
    const documentRef = options.documentRef || document;
    const root = documentRef.createElement("div");
    root.className = "shortcut-editor-app";
    root.innerHTML = shortcutEditorHTML({ target: params.target, name: params.name });
    const form = root.querySelector("[data-shortcut-form]");
    const targetInput = root.querySelector("[data-shortcut-target]");
    const nameInput = root.querySelector("[data-shortcut-name]");
    const typeText = root.querySelector("[data-shortcut-type]");
    const icon = root.querySelector("[data-shortcut-icon]");
    const errorText = root.querySelector("[data-shortcut-error]");
    const createButton = root.querySelector("[data-shortcut-create]");
    const testButton = root.querySelector("[data-shortcut-test]");
    let nameWasEdited = Boolean(String(params.name || "").trim());
    targetInput.value = String(params.target || "");

    const getItem = typeof options.getItem === "function" ? options.getItem : () => null;
    const closeWindow = typeof options.closeWindow === "function" ? options.closeWindow : () => {};
    const openTarget = typeof options.openTarget === "function" ? options.openTarget : async () => false;
    const createItem = typeof options.createItem === "function" ? options.createItem : () => null;
    const createId = typeof options.createId === "function" ? options.createId : prefix => `${prefix}-${Date.now()}`;

    function inspect() {
      const normalized = normalizeShortcutTarget(targetInput.value);
      const internalMissing = normalized?.kind === "zeter" && !getItem(normalized.itemId);
      const valid = Boolean(normalized && !internalMissing);
      icon.textContent = shortcutIcon(normalized || {});
      typeText.textContent = internalMissing ? "Элемент ZeTer OS не найден" : (normalized ? shortcutKindLabel(normalized) : "Укажи абсолютный путь Windows, сайт или путь ZeTer OS");
      errorText.textContent = internalMissing ? "Скопированный элемент был удалён или находится в другом состоянии ZeTer OS." : "";
      createButton.disabled = !valid;
      testButton.disabled = !valid;
      if (valid && !nameWasEdited) nameInput.value = shortcutDefaultName(normalized, { getItem });
      return valid ? normalized : null;
    }

    targetInput.addEventListener("input", inspect);
    nameInput.addEventListener("input", () => { nameWasEdited = true; });
    root.querySelector("[data-shortcut-cancel]")?.addEventListener("click", () => closeWindow(winId));
    testButton.addEventListener("click", () => {
      const normalized = inspect();
      if (normalized) Promise.resolve(openTarget(normalized.target, nameInput.value.trim() || shortcutDefaultName(normalized, { getItem })));
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      const shortcut = inspect();
      if (!shortcut) return;
      const name = nameInput.value.trim() || shortcutDefaultName(shortcut, { getItem });
      const attachment = createShortcutAttachment(shortcut, { id: createId("shortcut-ref"), name });
      const parent = String(params.parentId || options.getDefaultParent?.() || "desktop");
      const id = createItem("shortcut", name, parent, Number(params.x), Number(params.y), {
        shortcut,
        managedFile: attachment,
        extension: "shortcut"
      });
      if (!id) {
        errorText.textContent = "Не удалось создать ярлык в выбранном месте.";
        return;
      }
      closeWindow(winId);
    });

    inspect();
    setTimeout(() => targetInput.focus(), 0);
    return root;
  }

  window.ZETER_SHORTCUT_UTILS = Object.freeze({
    INTERNAL_TARGET_RE,
    MAX_SHORTCUT_TARGET_LENGTH,
    normalizeWebUrl,
    normalizeWindowsPath,
    normalizeShortcutTarget,
    normalizeShortcutRecord,
    shortcutTargetForItem,
    shortcutIcon,
    shortcutKindLabel,
    shortcutDefaultName,
    createShortcutAttachment,
    normalizeShortcutItems,
    shortcutEditorHTML,
    createShortcutEditorApp
  });
})();
