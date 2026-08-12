(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS photo UI utils require core utils.");

  const { escapeHtml } = coreUtils;
  const safeAttr = escapeHtml;

  function galleryStripHTML(images = [], selectedId = "") {
    return images.map(image => `<button data-gallery-id="${safeAttr(image.id)}" class="${image.id === selectedId ? "active" : ""}"><img src="${safeAttr(image.dataURL)}" alt=""><span>${escapeHtml(image.name)}</span></button>`).join("") || `<p class="muted">Изображений пока нет.</p>`;
  }

  function collectGalleryImages(fs = {}, isValidImage = image => Boolean(image?.dataURL)) {
    return Object.values(fs || {}).filter(item =>
      item &&
      !item.deletedAt &&
      ["image", "paint"].includes(item.type) &&
      isValidImage(item)
    );
  }

  function galleryInitialSelection(images = [], preferred = null, isValidImage = image => Boolean(image?.dataURL)) {
    if (preferred && images.some(image => image.id === preferred.id) && isValidImage(preferred)) return preferred;
    return images[0];
  }

  function gallerySelectById(images = [], selected = null, id = "") {
    return images.find(image => image.id === id) || selected;
  }

  function gallerySelectByOffset(images = [], selected = null, step = 1) {
    if (!images.length) return selected;
    const index = Math.max(0, images.findIndex(image => image.id === selected?.id));
    return images[(index + step + images.length) % images.length];
  }

  function gallerySlideshowStepCount(images = []) {
    return Math.max(1, images.length) * 2;
  }

  function galleryClickAction(target) {
    const thumb = target?.closest?.("[data-gallery-id]");
    if (thumb) return { type: "select", id: thumb.dataset.galleryId || "" };
    if (target?.closest?.("[data-gallery-prev]")) return { type: "prev" };
    if (target?.closest?.("[data-gallery-next]")) return { type: "next" };
    if (target?.closest?.("[data-gallery-rotate]")) return { type: "rotate" };
    if (target?.closest?.("[data-gallery-download]")) return { type: "download" };
    if (target?.closest?.("[data-gallery-slideshow]")) return { type: "slideshow" };
    return null;
  }

  function galleryViewHTML(images = [], selected = {}, rotation = 0, description = "") {
    return `<div class="gallery-view"><aside class="gallery-strip">${galleryStripHTML(images, selected?.id)}</aside><main class="gallery-main"><div class="gallery-toolbar"><button data-gallery-prev>←</button><button data-gallery-next>→</button><button data-gallery-rotate>Повернуть</button><button data-gallery-slideshow>Слайд-шоу</button><button data-gallery-download>Скачать</button></div><div class="gallery-image-wrap"><img src="${safeAttr(selected.dataURL)}" alt="${escapeHtml(selected.name)}" style="transform:rotate(${Number(rotation) || 0}deg)"></div><h2>${escapeHtml(selected.name)}</h2><p class="muted">${escapeHtml(description)}</p></main></div>`;
  }

  function galleryEmptyHTML() {
    return `<div><div class="photo-card"></div><h2>Фото ZeTer</h2><p class="muted">Перетащи изображение с Windows в открытую папку или на рабочий стол — оно появится в ZeTer OS и откроется здесь.</p></div>`;
  }

  function galleryAppElement(options = {}) {
    const isValidImage = typeof options.isValidImage === "function" ? options.isValidImage : image => Boolean(image?.dataURL);
    const describeItem = typeof options.itemDescription === "function" ? options.itemDescription : () => "";
    const downloadDataUrl = typeof options.downloadDataUrl === "function" ? options.downloadDataUrl : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const root = document.createElement("div");
    root.className = "photo-stage gallery-app";
    const images = collectGalleryImages(options.fs, isValidImage);
    let rotation = 0;
    let selected = galleryInitialSelection(images, options.item || null, isValidImage);

    const draw = () => {
      root.innerHTML = selected?.dataURL
        ? galleryViewHTML(images, selected, rotation, describeItem(selected))
        : galleryEmptyHTML();
    };

    const selectByOffset = step => {
      selected = gallerySelectByOffset(images, selected, step);
      rotation = 0;
      draw();
    };

    root.addEventListener("click", event => {
      const action = galleryClickAction(event.target);
      if (!action) return;
      if (action.type === "select") {
        selected = gallerySelectById(images, selected, action.id);
        rotation = 0;
        draw();
        return;
      }
      if (action.type === "prev") return selectByOffset(-1);
      if (action.type === "next") return selectByOffset(1);
      if (action.type === "rotate") {
        rotation = (rotation + 90) % 360;
        draw();
        return;
      }
      if (action.type === "download" && selected?.dataURL) return downloadDataUrl(selected.name, selected.dataURL);
      if (action.type === "slideshow") {
        let left = gallerySlideshowStepCount(images);
        const timer = setInterval(() => {
          if (!root.isConnected || !left--) return clearInterval(timer);
          selectByOffset(1);
        }, 1200);
        toast("Слайд-шоу", "Показ запущен.");
      }
    });

    draw();
    return root;
  }

  window.ZETER_PHOTO_UI_UTILS = Object.freeze({
    collectGalleryImages,
    galleryStripHTML,
    galleryInitialSelection,
    gallerySelectById,
    gallerySelectByOffset,
    gallerySlideshowStepCount,
    galleryClickAction,
    galleryViewHTML,
    galleryEmptyHTML,
    galleryAppElement
  });
})();
