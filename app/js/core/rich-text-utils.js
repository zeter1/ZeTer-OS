(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  const coreUtils = window.ZETER_CORE_UTILS;
  const assetUtils = window.ZETER_ASSET_UTILS;
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!config || !coreUtils || !assetUtils || !shortcutUtils) throw new Error("ZeTer OS rich text utils require config, core, asset and shortcut utils.");

  const RICH_TEXT_IMAGE_MIME_TYPES = new Set(config.RICH_TEXT_IMAGE_MIME_TYPES || []);
  const RICH_TEXT_FONT_SIZE_MIN = 8;
  const RICH_TEXT_FONT_SIZE_MAX = 200;
  const { escapeHtml } = coreUtils;
  const { isDataImage, isExternalAssetPath } = assetUtils;
  const { normalizeWebUrl } = shortcutUtils;

  function normalizeRichTextFontSize(value) {
    const size = Math.round(Number(value));
    if (!Number.isFinite(size) || size < RICH_TEXT_FONT_SIZE_MIN || size > RICH_TEXT_FONT_SIZE_MAX) return 0;
    return size;
  }

  function sanitizeRichTextSpanStyle(value = "") {
    const match = String(value || "").match(/^\s*font-size\s*:\s*(\d+(?:\.\d+)?)px\s*;?\s*$/i);
    const size = normalizeRichTextFontSize(match?.[1]);
    return size ? `font-size: ${size}px` : "";
  }

  function normalizeRichTextLink(value = "") {
    return normalizeWebUrl(value);
  }

  function linkifyRichTextLine(line = "") {
    const raw = String(line || "");
    const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    let result = "";
    let offset = 0;
    for (const match of raw.matchAll(pattern)) {
      const start = match.index || 0;
      let label = match[0];
      let suffix = "";
      while (label && /[.,!?;:)\]\}]$/.test(label)) {
        suffix = label.slice(-1) + suffix;
        label = label.slice(0, -1);
      }
      const href = normalizeWebUrl(label);
      result += escapeHtml(raw.slice(offset, start));
      result += href
        ? `<a href="${escapeHtml(href)}" title="Открыть в браузере">${escapeHtml(label)}</a>${escapeHtml(suffix)}`
        : escapeHtml(match[0]);
      offset = start + match[0].length;
    }
    return result + escapeHtml(raw.slice(offset));
  }

  function plainToRichHtml(text = "") {
    const lines = String(text || "").split("\n");
    return lines.map(line => line.trim() ? `<p>${linkifyRichTextLine(line)}</p>` : "<p><br></p>").join("");
  }

  function cleanRichHtml(html = "") {
    const box = document.createElement("div");
    box.innerHTML = String(html || "");
    const dangerous = new Set(["script", "iframe", "object", "embed", "style", "link", "meta", "base", "form", "input", "button", "textarea", "select", "svg", "math"]);
    const allowed = new Set(["b", "i", "u", "s", "p", "br", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "span", "img", "a"]);
    const allowedAttrs = {
      img: new Set(["src", "alt", "title", "width", "height"]),
      span: new Set(["style", "data-managed-file-inline", "data-managed-file-inline-x"]),
      a: new Set(["href", "title"])
    };
    const safeImageUrl = value => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      if (isExternalAssetPath(raw)) return raw.replace(/^\.\//, "");
      if (isDataImage(raw, RICH_TEXT_IMAGE_MIME_TYPES)) return raw;
      return "";
    };
    const walk = node => {
      [...node.children].forEach(el => {
        const tag = el.tagName.toLowerCase();
        const managedFileId = tag === "span" ? String(el.getAttribute("data-managed-file-inline") || "").trim() : "";
        const managedFileInlineXRaw = tag === "span" ? el.getAttribute("data-managed-file-inline-x") : null;
        const managedFileInlineX = managedFileInlineXRaw === null || managedFileInlineXRaw === ""
          ? NaN
          : Math.round(Number(managedFileInlineXRaw));
        if (dangerous.has(tag)) {
          el.remove();
          return;
        }
        walk(el);
        if (!allowed.has(tag)) {
          el.replaceWith(...el.childNodes);
          return;
        }
        [...el.attributes].forEach(attr => {
          const name = attr.name.toLowerCase();
          const keep = allowedAttrs[tag]?.has(name);
          if (!keep || /^on/i.test(name)) {
            el.removeAttribute(attr.name);
            return;
          }
          if (name === "src") {
            const src = safeImageUrl(attr.value);
            if (!src) el.removeAttribute(attr.name);
            else el.setAttribute("src", src);
          } else if (name === "href") {
            const href = normalizeRichTextLink(attr.value);
            if (!href) el.removeAttribute(attr.name);
            else el.setAttribute("href", href);
          } else if (name === "style" && tag === "span") {
            const style = sanitizeRichTextSpanStyle(attr.value);
            if (!style) el.removeAttribute(attr.name);
            else el.setAttribute("style", style);
          } else if (name === "width" || name === "height") {
            const value = Math.round(Number(attr.value));
            if (!Number.isFinite(value) || value < 1 || value > 3000) el.removeAttribute(attr.name);
            else el.setAttribute(attr.name, String(value));
          }
        });
        if (tag === "span" && managedFileId) {
          if (/^[\w.-]{1,160}$/.test(managedFileId)) {
            el.setAttribute("data-managed-file-inline", managedFileId);
            if (Number.isFinite(managedFileInlineX) && managedFileInlineX >= 0 && managedFileInlineX <= 10000) {
              el.setAttribute("data-managed-file-inline-x", String(managedFileInlineX));
            } else {
              el.removeAttribute("data-managed-file-inline-x");
            }
            el.removeAttribute("style");
            el.replaceChildren();
          } else {
            el.removeAttribute("data-managed-file-inline");
            el.removeAttribute("data-managed-file-inline-x");
          }
        } else if (tag === "span") {
          el.removeAttribute("data-managed-file-inline-x");
        }
        if (tag === "img" && !el.getAttribute("src")) el.remove();
        if (tag === "a" && !el.getAttribute("href")) el.replaceWith(...el.childNodes);
      });
    };
    walk(box);
    return box.innerHTML;
  }

  function richContentToPlainText(html = "") {
    const box = document.createElement("div");
    box.innerHTML = cleanRichHtml(html || "");
    return (box.innerText || box.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function notePlainText(item = {}) {
    const content = String(item.content || "").trim();
    if (content) return content;
    return richContentToPlainText(item.richContent || "");
  }

  function noteHasImages(item = {}) {
    return typeof item.richContent === "string" && /<img\b|data:image\//i.test(item.richContent);
  }

  function collectNoteImageSources(item = {}) {
    if (!item.richContent) return [];
    const box = document.createElement("div");
    box.innerHTML = cleanRichHtml(item.richContent || "");
    return [...box.querySelectorAll("img")]
      .map(img => img.getAttribute("src") || "")
      .filter(src => isDataImage(src));
  }

  function htmlPlainText(html = "") {
    const box = document.createElement("div");
    box.innerHTML = cleanRichHtml(html || "");
    return box.textContent || box.innerText || "";
  }

  window.ZETER_RICH_TEXT_UTILS = Object.freeze({
    RICH_TEXT_FONT_SIZE_MIN,
    RICH_TEXT_FONT_SIZE_MAX,
    plainToRichHtml,
    linkifyRichTextLine,
    normalizeRichTextFontSize,
    sanitizeRichTextSpanStyle,
    normalizeRichTextLink,
    cleanRichHtml,
    richContentToPlainText,
    notePlainText,
    noteHasImages,
    collectNoteImageSources,
    htmlPlainText
  });
})();
