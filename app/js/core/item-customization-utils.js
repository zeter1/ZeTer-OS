(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const assetUtils = window.ZETER_ASSET_UTILS;
  const visualUtils = window.ZETER_VISUAL_UTILS;
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!coreUtils || !assetUtils || !visualUtils || !shortcutUtils) {
    throw new Error("ZeTer OS item customization utils require core, asset, visual and shortcut utils.");
  }

  const { escapeHtml } = coreUtils;
  const { isDataImage } = assetUtils;
  const { createCustomWallpaperFromFile, createDesktopIconFromFile } = visualUtils;
  const {
    normalizeShortcutTarget,
    normalizeShortcutRecord,
    shortcutIcon,
    shortcutKindLabel,
    createShortcutAttachment
  } = shortcutUtils;

  const DEFAULT_FOLDER_COLOR = "#e4ad43";
  const FOLDER_COLOR_OPTIONS = Object.freeze([
    "#e4ad43",
    "#4f8fe8",
    "#55b985",
    "#c879e8",
    "#ed6f7f",
    "#7f8da8",
    "#e4854d",
    "#39a8b8"
  ]);
  const ITEM_ASSET_PATH_RE = /^Оформление объектов\/(Папки|Ярлыки)\/([A-Za-z0-9_.-]{1,160})\/(значок|фон)\.(png|jpe?g|webp|gif|bmp)$/iu;

  function normalizeFolderColor(value = "") {
    const raw = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : DEFAULT_FOLDER_COLOR;
  }

  function isItemAssetPath(value = "") {
    const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "");
    const match = normalized.match(ITEM_ASSET_PATH_RE);
    if (!match) return false;
    return match[1] === "Папки" || match[3] === "значок";
  }

  function normalizeItemImage(raw = null, fallbackName = "Изображение") {
    if (!raw || typeof raw !== "object") return null;
    const dataURL = String(raw.dataURL || "");
    const assetPath = String(raw.assetPath || raw.itemAsset?.path || "").replace(/\\/g, "/");
    if (!isDataImage(dataURL) && !isItemAssetPath(assetPath)) return null;
    const clean = {
      name: String(raw.name || raw.originalName || raw.itemAsset?.originalName || fallbackName).trim() || fallbackName,
      mime: String(raw.mime || raw.type || raw.itemAsset?.mime || "image/png"),
      size: Math.max(0, Number(raw.size) || 0),
      originalSize: Math.max(0, Number(raw.originalSize) || Number(raw.size) || 0),
      updatedAt: Math.max(0, Number(raw.updatedAt) || Date.now())
    };
    if (isDataImage(dataURL)) clean.dataURL = dataURL;
    if (isItemAssetPath(assetPath)) {
      clean.assetPath = assetPath;
      clean.savedAt = String(raw.savedAt || raw.itemAsset?.savedAt || "");
    }
    return clean;
  }

  function normalizeItemAppearance(item = null) {
    if (!item || !["folder", "shortcut"].includes(item.type)) return null;
    const source = item.appearance && typeof item.appearance === "object" ? item.appearance : {};
    const clean = { ...source };
    const icon = normalizeItemImage(source.icon, item.type === "folder" ? "Значок папки" : "Значок ярлыка");
    if (icon) clean.icon = icon;
    else delete clean.icon;

    if (item.type === "folder") {
      clean.color = normalizeFolderColor(source.color);
      const background = normalizeItemImage(source.background, "Фон папки");
      if (background) clean.background = background;
      else delete clean.background;
    } else {
      delete clean.color;
      delete clean.background;
    }

    item.appearance = clean;
    return clean;
  }

  function normalizeItemCustomizations(state = {}) {
    Object.values(state?.fs || {}).forEach(item => normalizeItemAppearance(item));
    return state;
  }

  function folderColorIconHTML(color = DEFAULT_FOLDER_COLOR) {
    const fill = normalizeFolderColor(color);
    return `<svg class="item-custom-icon item-folder-color-icon" viewBox="0 0 64 54" aria-hidden="true" focusable="false">
      <path fill="${fill}" d="M5 11a6 6 0 0 1 6-6h15l7 7h20a6 6 0 0 1 6 6v25a7 7 0 0 1-7 7H12a7 7 0 0 1-7-7V11Z"></path>
      <path fill="rgba(255,255,255,.24)" d="M5 20h54v5H5z"></path>
    </svg>`;
  }

  function customImageHTML(image = null) {
    const normalized = normalizeItemImage(image);
    if (!normalized?.dataURL) return "";
    return `<img class="item-custom-icon item-custom-image" src="${escapeHtml(normalized.dataURL)}" alt="">`;
  }

  function itemIconHTML(item = null, fallbackIcon = "") {
    if (!item) return fallbackIcon;
    const appearance = normalizeItemAppearance(item);
    const customIcon = customImageHTML(appearance?.icon);
    if (customIcon) return customIcon;
    if (item.type === "folder") return folderColorIconHTML(appearance?.color);
    return fallbackIcon;
  }

  function folderBackgroundDataURL(item = null) {
    if (!item || item.type !== "folder") return "";
    const background = normalizeItemAppearance(item)?.background;
    return background?.dataURL && isDataImage(background.dataURL) ? background.dataURL : "";
  }

  function itemSettingsTitle(item = null) {
    return item?.type === "folder" ? "Настройка папки" : "Настройка ярлыка";
  }

  function colorPaletteHTML(selectedColor = DEFAULT_FOLDER_COLOR) {
    const selected = normalizeFolderColor(selectedColor);
    return FOLDER_COLOR_OPTIONS.map(color => (
      `<button type="button" class="item-color-swatch${color === selected ? " active" : ""}" data-item-color="${color}" style="--item-swatch:${color}" title="${color}" aria-label="Цвет папки ${color}"></button>`
    )).join("");
  }

  function itemImageInfo(image = null, emptyText = "Не загружено") {
    const normalized = normalizeItemImage(image);
    if (!normalized) return emptyText;
    const size = normalized.size ? ` · ${Math.max(1, Math.round(normalized.size / 1024))} КБ` : "";
    return `${normalized.name}${size}`;
  }

  function itemSettingsHTML(item = null) {
    const appearance = normalizeItemAppearance(item) || {};
    const folder = item?.type === "folder";
    const shortcut = item?.type === "shortcut";
    const normalizedShortcut = shortcut ? normalizeShortcutRecord(item.shortcut || item.managedFile || item) : null;
    const title = itemSettingsTitle(item);
    return `<form class="item-settings-form" data-item-settings-form>
      <div class="item-settings-heading">
        <span class="item-settings-preview-icon" data-item-settings-icon-preview></span>
        <div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(item?.name || "")}</p></div>
      </div>
      ${folder ? `<section class="item-settings-section">
        <h3>Цвет папки</h3>
        <p class="muted">Цвет используется, если свой значок папки не загружен.</p>
        <div class="item-color-controls">
          <div class="item-color-palette" data-item-color-palette>${colorPaletteHTML(appearance.color)}</div>
          <label><span>Свой цвет</span><input type="color" data-item-folder-color value="${normalizeFolderColor(appearance.color)}"></label>
        </div>
      </section>` : ""}
      ${shortcut ? `<section class="item-settings-section">
        <label class="shortcut-editor-field"><span>Название ярлыка</span>
          <input data-item-shortcut-name maxlength="300" value="${escapeHtml(item?.name || "")}" autocomplete="off">
        </label>
        <label class="shortcut-editor-field"><span>Ссылка или путь ярлыка</span>
          <textarea data-item-shortcut-target rows="4" spellcheck="false">${escapeHtml(normalizedShortcut?.target || "")}</textarea>
        </label>
        <div class="shortcut-editor-type" data-item-shortcut-type></div>
      </section>` : ""}
      <section class="item-settings-section item-image-setting">
        <div><h3>Свой значок</h3><p class="muted" data-item-icon-info>${escapeHtml(itemImageInfo(appearance.icon))}</p></div>
        <div class="item-settings-actions compact-actions">
          <button type="button" data-item-icon-upload>Загрузить значок</button>
          <button type="button" data-item-icon-clear${appearance.icon ? "" : " class=\"hidden\""}>Убрать значок</button>
        </div>
        <input type="file" data-item-icon-file accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>
      </section>
      ${folder ? `<section class="item-settings-section item-folder-background-setting">
        <div><h3>Фон внутри папки</h3><p class="muted" data-item-background-info>${escapeHtml(itemImageInfo(appearance.background))}</p></div>
        <div class="item-folder-background-preview" data-item-background-preview><span>Предпросмотр фона</span></div>
        <div class="item-settings-actions compact-actions">
          <button type="button" data-item-background-upload>Загрузить фон</button>
          <button type="button" data-item-background-clear${appearance.background ? "" : " class=\"hidden\""}>Убрать фон</button>
        </div>
        <input type="file" data-item-background-file accept=".png,.jpg,.jpeg,.webp,.gif,.bmp,image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>
      </section>` : ""}
      <p class="item-settings-storage-note">В Windows-режиме изображения сохраняются в <b>data/Оформление объектов</b> и остаются переносимыми вместе со всей папкой data.</p>
      <p class="shortcut-editor-error" data-item-settings-error aria-live="polite"></p>
      <div class="item-settings-footer">
        <button type="button" data-item-settings-cancel>Отмена</button>
        <button type="submit" class="primary" data-item-settings-save>Сохранить настройки</button>
      </div>
    </form>`;
  }

  function mergeSavedAsset(image = null, savedAsset = null) {
    const normalized = normalizeItemImage(image);
    if (!normalized) return null;
    const asset = savedAsset?.asset && typeof savedAsset.asset === "object" ? savedAsset.asset : savedAsset;
    if (!asset?.path || !isItemAssetPath(asset.path)) return normalized;
    return normalizeItemImage({
      ...normalized,
      assetPath: asset.path,
      savedAt: asset.savedAt || "",
      mime: asset.mime || normalized.mime,
      size: Number(asset.size) || normalized.size
    });
  }

  function updateShortcutItem(item, values = {}) {
    if (!item || item.type !== "shortcut") return false;
    const normalized = normalizeShortcutTarget(values.target);
    if (!normalized || (normalized.kind === "zeter" && normalized.itemId === item.id)) return false;
    const name = String(values.name || "").trim();
    if (!name) return false;
    item.name = name;
    item.shortcut = normalized;
    item.extension = "shortcut";
    item.managedFile = {
      ...(item.managedFile && typeof item.managedFile === "object" ? item.managedFile : {}),
      ...createShortcutAttachment(normalized, {
        id: item.managedFile?.id || `${item.id}-ref`,
        name,
        importedAt: item.createdAt
      })
    };
    item.updatedAt = Date.now();
    return true;
  }

  function createItemSettingsApp(params = {}, winId = "", options = {}) {
    const documentRef = options.documentRef || document;
    const getItem = typeof options.getItem === "function" ? options.getItem : () => null;
    const item = getItem(params.itemId);
    const root = documentRef.createElement("div");
    root.className = "item-settings-app";
    if (!item || !["folder", "shortcut"].includes(item.type)) {
      root.innerHTML = `<div class="item-settings-missing"><h2>Элемент не найден</h2><p>Папка или ярлык были удалены.</p></div>`;
      return root;
    }

    root.innerHTML = itemSettingsHTML(item);
    const form = root.querySelector("[data-item-settings-form]");
    const saveButton = root.querySelector("[data-item-settings-save]");
    const errorText = root.querySelector("[data-item-settings-error]");
    const iconPreview = root.querySelector("[data-item-settings-icon-preview]");
    const backgroundPreview = root.querySelector("[data-item-background-preview]");
    const iconInfo = root.querySelector("[data-item-icon-info]");
    const backgroundInfo = root.querySelector("[data-item-background-info]");
    const colorInput = root.querySelector("[data-item-folder-color]");
    const shortcutNameInput = root.querySelector("[data-item-shortcut-name]");
    const shortcutTargetInput = root.querySelector("[data-item-shortcut-target]");
    const shortcutTypeText = root.querySelector("[data-item-shortcut-type]");
    const initialAppearance = normalizeItemAppearance(item) || {};
    let pendingIcon = initialAppearance.icon ? { ...initialAppearance.icon } : null;
    let pendingBackground = initialAppearance.background ? { ...initialAppearance.background } : null;
    let iconChanged = false;
    let backgroundChanged = false;
    let saving = false;

    const closeWindow = typeof options.closeWindow === "function" ? options.closeWindow : () => {};
    const persistAsset = typeof options.persistAsset === "function" ? options.persistAsset : async () => null;
    const saveState = typeof options.saveState === "function" ? options.saveState : async () => {};
    const renderAllFileSurfaces = typeof options.renderAllFileSurfaces === "function" ? options.renderAllFileSurfaces : () => {};
    const refreshItemDependents = typeof options.refreshItemDependents === "function" ? options.refreshItemDependents : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};

    function fallbackIcon() {
      return item.type === "shortcut" ? shortcutIcon(item.shortcut || item.managedFile || item) : "📁";
    }

    function syncIconPreview() {
      const draft = {
        ...item,
        appearance: {
          ...(item.appearance || {}),
          color: colorInput?.value || initialAppearance.color,
          ...(pendingIcon ? { icon: pendingIcon } : {})
        }
      };
      if (!pendingIcon) delete draft.appearance.icon;
      iconPreview.innerHTML = itemIconHTML(draft, fallbackIcon());
      if (iconInfo) iconInfo.textContent = itemImageInfo(pendingIcon);
      root.querySelector("[data-item-icon-clear]")?.classList.toggle("hidden", !pendingIcon);
    }

    function syncBackgroundPreview() {
      if (!backgroundPreview) return;
      const dataURL = pendingBackground?.dataURL && isDataImage(pendingBackground.dataURL) ? pendingBackground.dataURL : "";
      backgroundPreview.classList.toggle("has-image", Boolean(dataURL));
      backgroundPreview.style.backgroundImage = dataURL ? `linear-gradient(rgba(4,9,20,.18), rgba(4,9,20,.18)), url("${dataURL}")` : "";
      if (backgroundInfo) backgroundInfo.textContent = itemImageInfo(pendingBackground);
      root.querySelector("[data-item-background-clear]")?.classList.toggle("hidden", !pendingBackground);
    }

    function inspectShortcut() {
      if (item.type !== "shortcut") return true;
      const normalized = normalizeShortcutTarget(shortcutTargetInput?.value || "");
      const missingInternal = normalized?.kind === "zeter" && !getItem(normalized.itemId);
      const selfTarget = normalized?.kind === "zeter" && normalized.itemId === item.id;
      const hasName = Boolean(String(shortcutNameInput?.value || "").trim());
      const valid = Boolean(normalized && !missingInternal && !selfTarget && hasName);
      shortcutTypeText.textContent = selfTarget
        ? "Ярлык не может ссылаться сам на себя"
        : missingInternal
          ? "Элемент ZeTer OS не найден"
          : normalized
            ? shortcutKindLabel(normalized)
            : "Укажи абсолютный путь Windows, сайт или путь ZeTer OS";
      saveButton.disabled = saving || !valid;
      return valid;
    }

    root.addEventListener("click", event => {
      const target = event.target;
      const swatch = target.closest?.("[data-item-color]");
      if (swatch && colorInput) {
        colorInput.value = normalizeFolderColor(swatch.dataset.itemColor);
        root.querySelectorAll("[data-item-color]").forEach(button => button.classList.toggle("active", button === swatch));
        syncIconPreview();
      }
      if (target.closest?.("[data-item-icon-upload]")) root.querySelector("[data-item-icon-file]")?.click();
      if (target.closest?.("[data-item-background-upload]")) root.querySelector("[data-item-background-file]")?.click();
      if (target.closest?.("[data-item-icon-clear]")) {
        pendingIcon = null;
        iconChanged = true;
        syncIconPreview();
      }
      if (target.closest?.("[data-item-background-clear]")) {
        pendingBackground = null;
        backgroundChanged = true;
        syncBackgroundPreview();
      }
      if (target.closest?.("[data-item-settings-cancel]")) closeWindow(winId);
    });

    colorInput?.addEventListener("input", () => {
      root.querySelectorAll("[data-item-color]").forEach(button => button.classList.toggle("active", button.dataset.itemColor === colorInput.value.toLowerCase()));
      syncIconPreview();
    });
    shortcutNameInput?.addEventListener("input", inspectShortcut);
    shortcutTargetInput?.addEventListener("input", inspectShortcut);

    root.querySelector("[data-item-icon-file]")?.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        pendingIcon = await createDesktopIconFromFile(file);
        iconChanged = true;
        errorText.textContent = "";
        syncIconPreview();
      } catch (error) {
        errorText.textContent = error?.message || "Не удалось подготовить значок.";
      }
    });

    root.querySelector("[data-item-background-file]")?.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        pendingBackground = await createCustomWallpaperFromFile(file);
        backgroundChanged = true;
        errorText.textContent = "";
        syncBackgroundPreview();
      } catch (error) {
        errorText.textContent = error?.message || "Не удалось подготовить фон папки.";
      }
    });

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving || !inspectShortcut()) return;
      const current = getItem(item.id);
      if (!current || current.type !== item.type) {
        errorText.textContent = "Элемент был удалён. Закрой окно и повтори действие.";
        return;
      }
      saving = true;
      saveButton.disabled = true;
      saveButton.textContent = "Сохранение…";
      errorText.textContent = "";
      try {
        const assetJobs = [];
        if (iconChanged && pendingIcon) {
          assetJobs.push(Promise.resolve(persistAsset(current.id, current.type === "folder" ? "folder-icon" : "shortcut-icon", pendingIcon))
            .then(saved => { pendingIcon = mergeSavedAsset(pendingIcon, saved); }));
        }
        if (backgroundChanged && pendingBackground) {
          assetJobs.push(Promise.resolve(persistAsset(current.id, "folder-background", pendingBackground))
            .then(saved => { pendingBackground = mergeSavedAsset(pendingBackground, saved); }));
        }
        await Promise.all(assetJobs);

        const appearance = {
          ...(current.appearance && typeof current.appearance === "object" ? current.appearance : {}),
          ...(pendingIcon ? { icon: pendingIcon } : {})
        };
        if (!pendingIcon) delete appearance.icon;
        if (current.type === "folder") {
          appearance.color = normalizeFolderColor(colorInput?.value);
          if (pendingBackground) appearance.background = pendingBackground;
          else delete appearance.background;
        }
        current.appearance = appearance;
        normalizeItemAppearance(current);

        if (current.type === "shortcut" && !updateShortcutItem(current, {
          name: shortcutNameInput?.value,
          target: shortcutTargetInput?.value
        })) {
          throw new Error("Проверь название и ссылку или путь ярлыка.");
        }
        current.updatedAt = Date.now();
        await Promise.resolve(saveState());
        renderAllFileSurfaces();
        refreshItemDependents(current.id);
        toast("Настройки сохранены", current.name);
        closeWindow(winId);
      } catch (error) {
        console.error("[ZeTer OS item settings]", error);
        errorText.textContent = error?.message || "Не удалось сохранить настройки.";
        saving = false;
        saveButton.textContent = "Сохранить настройки";
        inspectShortcut();
      }
    });

    syncIconPreview();
    syncBackgroundPreview();
    inspectShortcut();
    setTimeout(() => (shortcutNameInput || colorInput)?.focus?.(), 0);
    return root;
  }

  window.ZETER_ITEM_CUSTOMIZATION_UTILS = Object.freeze({
    DEFAULT_FOLDER_COLOR,
    FOLDER_COLOR_OPTIONS,
    normalizeFolderColor,
    isItemAssetPath,
    normalizeItemImage,
    normalizeItemAppearance,
    normalizeItemCustomizations,
    folderColorIconHTML,
    itemIconHTML,
    folderBackgroundDataURL,
    itemSettingsTitle,
    itemSettingsHTML,
    mergeSavedAsset,
    updateShortcutItem,
    createItemSettingsApp
  });
})();
