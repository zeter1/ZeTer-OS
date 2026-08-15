(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const richTextUtils = window.ZETER_RICH_TEXT_UTILS;
  const markdownUtils = window.ZETER_MARKDOWN_UTILS;
  const managedFileUtils = window.ZETER_MANAGED_FILE_UTILS;
  if (!coreUtils || !richTextUtils || !markdownUtils || !managedFileUtils) throw new Error("ZeTer OS editor UI utils require core, rich-text, Markdown and managed file utils.");

  const { $, escapeHtml } = coreUtils;
  const {
    RICH_TEXT_FONT_SIZE_MIN = 8,
    RICH_TEXT_FONT_SIZE_MAX = 200,
    plainToRichHtml,
    cleanRichHtml,
    normalizeRichTextFontSize = value => Math.round(Number(value)) || 0,
    normalizeRichTextLink = value => String(value || "").trim()
  } = richTextUtils;
  const { markdown } = markdownUtils;
  const { ensureManagedFileInlineMarkers, plainTextWithoutManagedFiles } = managedFileUtils;
  const safeAttr = escapeHtml;

  function richEditorHTML(itemName = "") {
    return `
      <input class="editor-title" value="${escapeHtml(itemName)}" />
      <div class="toolbar rich-toolbar">
        <button data-action="new">Новый файл</button>
        <button data-action="duplicate">Копия</button>
        <button data-action="download-txt">Скачать .txt</button>
        <button data-action="download-html">Скачать .html</button>
        <button data-action="download-docx">Скачать .docx</button>
        <button data-action="folder">Показать в папке</button>
      </div>
      <div class="toolbar rich-toolbar formatting-toolbar">
        <button title="Жирный" data-format="bold"><b>Ж</b></button>
        <button title="Курсив" data-format="italic"><i>К</i></button>
        <button title="Подчёркнутый" data-format="underline"><u>Ч</u></button>
        <button title="Зачёркнутый" data-format="strikeThrough"><s>S</s></button>
        <button title="Список" data-format="insertUnorderedList">• список</button>
        <button title="Нумерованный список" data-format="insertOrderedList">1. список</button>
        <button title="Добавить или убрать цитату у выделенного текста" data-action="quote">❝ Цитата</button>
        <button title="Слева" data-format="justifyLeft">⟸</button>
        <button title="По центру" data-format="justifyCenter">↔</button>
        <button title="Справа" data-format="justifyRight">⟹</button>
        <button title="Добавить ссылку на выделенный текст" data-action="link">🔗 Ссылка</button>
        <select data-font title="Шрифт">
          <option value="Arial">Arial</option>
          <option value="Segoe UI">Segoe UI</option>
          <option value="Georgia">Georgia</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Verdana">Verdana</option>
        </select>
        <label class="font-size-tool" title="Размер выделенного текста в пикселях">
          <span>Размер</span>
          <input type="number" data-font-size min="${RICH_TEXT_FONT_SIZE_MIN}" max="${RICH_TEXT_FONT_SIZE_MAX}" step="1" value="16" inputmode="numeric" aria-label="Размер шрифта в пикселях">
          <span>px</span>
        </label>
        <label class="color-tool">Текст <input type="color" data-color value="#ffffff"></label>
        <label class="color-tool">Фон <input type="color" data-bg value="#7aa8ff"></label>
        <button data-format="removeFormat">Очистить стиль</button>
        <span class="muted" data-autosave>Автосохранение включено</span>
      </div>
      <div class="rich-editor-find" data-find-panel hidden>
        <input type="search" data-find-input placeholder="Найти в заметке" autocomplete="off" spellcheck="false" aria-label="Поиск по тексту заметки">
        <span data-find-count>Введите текст</span>
        <button type="button" data-find-action="previous" title="Предыдущее совпадение" aria-label="Предыдущее совпадение">↑</button>
        <button type="button" data-find-action="next" title="Следующее совпадение" aria-label="Следующее совпадение">↓</button>
        <button type="button" data-find-action="close" title="Закрыть поиск" aria-label="Закрыть поиск">✕</button>
      </div>
      <div class="editor-area rich-editor-area" contenteditable="true" spellcheck="true" data-placeholder="Пиши здесь — всё сохраняется автоматически"></div>
      <div class="rich-text-range-overlay" data-range-overlay hidden aria-hidden="true"></div>
      <div class="rich-image-resizer" data-image-resizer hidden aria-hidden="true">
        <button type="button" data-image-resize="nw" aria-label="Изменить размер изображения от верхнего левого угла"></button>
        <button type="button" data-image-resize="ne" aria-label="Изменить размер изображения от верхнего правого угла"></button>
        <button type="button" data-image-resize="sw" aria-label="Изменить размер изображения от нижнего левого угла"></button>
        <button type="button" data-image-resize="se" aria-label="Изменить размер изображения от нижнего правого угла"></button>
      </div>
      <div class="editor-status"><span data-status>Готово</span><span data-count>0 символов</span></div>`;
  }

  function isRichEditorFindShortcut(event = {}) {
    if (!event.ctrlKey || event.altKey || event.metaKey) return false;
    const key = String(event.key || "").toLocaleLowerCase("ru-RU");
    return event.code === "KeyF" || key === "f" || key === "а";
  }

  function isRichEditorImageDeleteShortcut(event = {}) {
    return !event.isComposing && (event.key === "Delete" || event.code === "Delete");
  }

  function isQuoteExitArrowShortcut(event = {}) {
    return !event.isComposing && event.key === "ArrowDown"
      && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  }

  function shouldRemoveQuoteFromSelection({
    startInsideQuote = false,
    endInsideQuote = false,
    selectedText = "",
    selectedQuoteTexts = []
  } = {}) {
    const normalizeText = value => String(value || "").replace(/\s+/g, " ").trim();
    const selection = normalizeText(selectedText);
    const quotes = normalizeText(selectedQuoteTexts.map(normalizeText).filter(Boolean).join(" "));
    return Boolean((startInsideQuote && endInsideQuote) || (selection && selection === quotes));
  }

  function ensureTrailingQuoteExitParagraph(area, documentRef = globalThis.document) {
    if (!area || !documentRef?.createElement) return { paragraph: null, quote: null, changed: false };
    const tagName = element => String(element?.tagName || "").toLowerCase();
    const last = area.lastElementChild;
    if (tagName(last) === "p" && tagName(last.previousElementSibling) === "blockquote" && !String(last.textContent || "").trim()) {
      const children = [...(last.children || [])];
      if (children.every(child => tagName(child) === "br")) {
        if (!children.length) {
          last.appendChild(documentRef.createElement("br"));
          return { paragraph: last, quote: last.previousElementSibling, changed: true };
        }
        return { paragraph: last, quote: last.previousElementSibling, changed: false };
      }
    }
    if (tagName(last) !== "blockquote") return { paragraph: null, quote: null, changed: false };
    const paragraph = documentRef.createElement("p");
    paragraph.appendChild(documentRef.createElement("br"));
    area.appendChild(paragraph);
    return { paragraph, quote: last, changed: true };
  }

  function rangeEndsAtElementEnd(range, element, documentRef = globalThis.document) {
    if (!range || !element || !documentRef?.createRange) return false;
    const endContainer = range.endContainer;
    if (endContainer !== element && !element.contains?.(endContainer)) return false;
    try {
      const tail = documentRef.createRange();
      tail.selectNodeContents(element);
      tail.setStart(endContainer, range.endOffset);
      return tail.collapsed;
    } catch {
      return false;
    }
  }

  function quoteTextForClipboard(quote) {
    if (!quote) return "";
    const copy = quote.cloneNode?.(true) || quote;
    copy.querySelectorAll?.("[data-quote-copy]").forEach(button => button.remove());
    return String(copy.innerText || copy.textContent || "").replace(/\u00a0/g, " ").trim();
  }

  function findTextMatchOffsets(text = "", query = "") {
    const source = String(text || "");
    const needle = String(query || "").trim();
    if (!needle) return [];
    const normalizedSource = source.toLocaleLowerCase("ru-RU");
    const normalizedNeedle = needle.toLocaleLowerCase("ru-RU");
    const matches = [];
    let offset = 0;
    while (offset <= normalizedSource.length - normalizedNeedle.length) {
      const start = normalizedSource.indexOf(normalizedNeedle, offset);
      if (start < 0) break;
      matches.push({ start, end: start + normalizedNeedle.length });
      offset = start + Math.max(1, normalizedNeedle.length);
    }
    return matches;
  }

  function imageResizeDimensions({
    startWidth = 0,
    startHeight = 0,
    deltaX = 0,
    deltaY = 0,
    direction = "se",
    maxWidth = 3000,
    maxDimension = 3000,
    minWidth = 48
  } = {}) {
    const width = Math.max(1, Number(startWidth) || 1);
    const height = Math.max(1, Number(startHeight) || 1);
    const horizontal = direction.includes("w") ? -Number(deltaX || 0) : Number(deltaX || 0);
    const vertical = direction.includes("n") ? -Number(deltaY || 0) : Number(deltaY || 0);
    const scaleX = (width + horizontal) / width;
    const scaleY = (height + vertical) / height;
    const scale = Math.abs(horizontal / width) >= Math.abs(vertical / height) ? scaleX : scaleY;
    const minScale = Math.min(1, Math.max(1 / width, Number(minWidth || 48) / width));
    const maxScale = Math.max(minScale, Math.min(Number(maxWidth || 3000) / width, Number(maxDimension || 3000) / width, Number(maxDimension || 3000) / height));
    const safeScale = Math.min(maxScale, Math.max(minScale, Number.isFinite(scale) ? scale : 1));
    return {
      width: Math.max(1, Math.round(width * safeScale)),
      height: Math.max(1, Math.round(height * safeScale))
    };
  }

  function createAutosaveStatusController({
    save = () => {},
    setStatus = () => {},
    now = () => new Date()
  } = {}) {
    let latestSequence = 0;

    async function run(payload) {
      const sequence = ++latestSequence;
      setStatus("Сохранение…");
      try {
        const result = await save(payload);
        if (sequence === latestSequence) {
          const label = result?.fallback ? "Сохранено аварийно" : "Автосохранено";
          setStatus(`${label}: ${now().toLocaleTimeString("ru-RU")}`);
        }
        return result;
      } catch (error) {
        if (sequence === latestSequence) {
          setStatus(`Не сохранено: ${error?.message || "ошибка хранилища"}`);
        }
        throw error;
      }
    }

    return Object.freeze({ run });
  }

  function editorTextNodes(area, documentRef = globalThis.document) {
    if (!area || !documentRef?.createTreeWalker) return [];
    const walker = documentRef.createTreeWalker(area, 4);
    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      if (node.nodeValue) nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function editorRangeForTextMatch(area, match, documentRef = globalThis.document) {
    if (!area || !match || !documentRef?.createRange) return false;
    const nodes = editorTextNodes(area, documentRef);
    let offset = 0;
    let startNode = null;
    let endNode = null;
    let startOffset = 0;
    let endOffset = 0;
    for (const node of nodes) {
      const length = String(node.nodeValue || "").length;
      if (!startNode && match.start >= offset && match.start <= offset + length) {
        startNode = node;
        startOffset = match.start - offset;
      }
      if (match.end >= offset && match.end <= offset + length) {
        endNode = node;
        endOffset = match.end - offset;
        break;
      }
      offset += length;
    }
    if (!startNode || !endNode) return false;
    const range = documentRef.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  function rangeOverlayRectangles(range, rootRect = {}, clipRect = {}) {
    if (!range?.getClientRects) return [];
    const rootLeft = Number(rootRect.left) || 0;
    const rootTop = Number(rootRect.top) || 0;
    const clipLeft = Number.isFinite(Number(clipRect.left)) ? Number(clipRect.left) : -Infinity;
    const clipTop = Number.isFinite(Number(clipRect.top)) ? Number(clipRect.top) : -Infinity;
    const clipRight = Number.isFinite(Number(clipRect.right)) ? Number(clipRect.right) : Infinity;
    const clipBottom = Number.isFinite(Number(clipRect.bottom)) ? Number(clipRect.bottom) : Infinity;
    return Array.from(range.getClientRects()).map(rect => {
      const left = Math.max(Number(rect.left) || 0, clipLeft);
      const top = Math.max(Number(rect.top) || 0, clipTop);
      const right = Math.min(Number(rect.right) || 0, clipRight);
      const bottom = Math.min(Number(rect.bottom) || 0, clipBottom);
      return {
        left: left - rootLeft,
        top: top - rootTop,
        width: right - left,
        height: bottom - top
      };
    }).filter(rect => rect.width > 0 && rect.height > 0);
  }

  function editorTextOffsetsForRange(area, range, documentRef = globalThis.document) {
    if (!area || !range || !documentRef?.createRange) return null;
    try {
      const prefix = documentRef.createRange();
      prefix.selectNodeContents(area);
      prefix.setEnd(range.startContainer, range.startOffset);
      const start = prefix.toString().length;
      return { start, end: start + range.toString().length };
    } catch {
      return null;
    }
  }

  function selectEditorTextMatch(area, match, documentRef = globalThis.document) {
    const range = editorRangeForTextMatch(area, match, documentRef);
    if (!range) return false;
    const selection = documentRef.defaultView?.getSelection?.() || globalThis.getSelection?.();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    const target = range.startContainer?.parentElement || range.startContainer?.parentNode;
    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return true;
  }

  function normalizeFontSizeMarkers(area, size, documentRef = globalThis.document) {
    const safeSize = normalizeRichTextFontSize(size);
    if (!safeSize || !area?.querySelectorAll || !documentRef?.createElement) return 0;
    let changed = 0;
    area.querySelectorAll('font[size="7"]').forEach(marker => {
      const span = documentRef.createElement("span");
      span.style.fontSize = `${safeSize}px`;
      while (marker.firstChild) span.appendChild(marker.firstChild);
      marker.parentNode?.replaceChild(span, marker);
      changed++;
    });
    return changed;
  }

  function notesBreadcrumbHTML({
    rootId = "",
    rootLabel = "",
    rootIsDesktop = false,
    chain = []
  } = {}) {
    const chainHtml = chain.map((folder, index) => {
      const separator = index ? `<span>›</span>` : "";
      return `${separator}<button data-crumb="${safeAttr(folder.id)}">${escapeHtml(folder.name)}</button>`;
    }).join("");

    if (rootIsDesktop) {
      return chainHtml || `<span class="breadcrumb-current">${escapeHtml(rootLabel)}</span>`;
    }

    return `<button data-crumb="${safeAttr(rootId)}">Папки</button>` + (chainHtml ? `<span>›</span>${chainHtml}` : "");
  }

  function notesShellHTML(currentFolder = "", workspaceRoot = "", breadcrumbHTML = "") {
    return `
      <div class="toolbar notes-toolbar">
        <button data-new>Новая заметка</button>
        <button data-new-folder>Новая папка</button>
        ${currentFolder === workspaceRoot ? "" : `<button data-up>← Назад</button>`}
        <div class="breadcrumb notes-breadcrumb">${breadcrumbHTML}</div>
      </div>
      <div class="file-grid notes-grid" data-folder-drop="${safeAttr(currentFolder)}"></div>`;
  }

  function notesEmptyHTML() {
    return `<b>Здесь пока пусто.</b><br>Создай заметку или папку для заметок через верхние кнопки.`;
  }

  function notesFileCardHTML(item = {}, icon = "📄", description = "") {
    return `<span class="file-emoji">${escapeHtml(icon)}</span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(description)}</small>`;
  }

  function markdownEditorHTML(itemName = "") {
    return `<input class="editor-title" value="${escapeHtml(itemName)}"><div class="toolbar"><button data-download>Скачать .md</button><span class="muted" data-status>Автосохранение включено</span></div><div class="markdown-split"><textarea class="editor-area" spellcheck="false"></textarea><div class="markdown-preview"></div></div><div class="editor-status"><span>Markdown Studio</span><span data-count></span></div>`;
  }

  function createRichEditorUI({
    itemName = "",
    initialHtml = "",
    searchQuery = "",
    cleanHtml = value => value,
    plainToHtml = value => value,
    highlightSearch = () => {},
    debounce = callback => callback,
    save = () => {},
    createNew = () => {},
    duplicate = () => {},
    downloadText = () => {},
    downloadHtml = () => {},
    downloadDocx = () => Promise.resolve(false),
    openFolder = () => {},
    openExternalLink = () => {},
    copyText = () => Promise.resolve(false),
    requestLink = () => null,
    managedFiles = [],
    documentRef = globalThis.document
  } = {}) {
    const root = documentRef.createElement("div");
    root.className = "editor rich-editor";
    root.innerHTML = richEditorHTML(itemName);
    const title = $(".editor-title", root);
    const area = $(".rich-editor-area", root);
    const status = $("[data-status]", root);
    const count = $("[data-count]", root);
    const fontSizeInput = $("[data-font-size]", root);
    const findPanel = $("[data-find-panel]", root);
    const findInput = $("[data-find-input]", root);
    const findCount = $("[data-find-count]", root);
    const rangeOverlay = $("[data-range-overlay]", root);
    const imageResizer = $("[data-image-resizer]", root);
    area.innerHTML = cleanHtml(initialHtml);
    const migratedQuoteExit = ensureTrailingQuoteExitParagraph(area, documentRef);
    const migratedFiles = ensureManagedFileInlineMarkers(area, managedFiles);
    const refreshQuoteCopyButtons = () => {
      area.querySelectorAll("[data-quote-copy]").forEach(button => {
        if (String(button.parentElement?.tagName || "").toLowerCase() !== "blockquote") button.remove();
      });
      area.querySelectorAll("blockquote").forEach(quote => {
        const existing = [...quote.children].find(child => child.matches?.("[data-quote-copy]"));
        if (existing) return;
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "rich-quote-copy";
        button.dataset.quoteCopy = "";
        button.contentEditable = "false";
        button.setAttribute("aria-label", "Копировать цитату");
        button.setAttribute("title", "Копировать цитату");
        quote.insertBefore(button, quote.firstChild);
      });
    };
    refreshQuoteCopyButtons();
    const plainText = () => plainTextWithoutManagedFiles(area);
    const updateCount = () => {
      const text = plainText();
      count.textContent = `${text.length} символов · ${text.split(/\s+/).filter(Boolean).length} слов`;
    };
    const autosaveStatus = createAutosaveStatusController({
      save,
      setStatus: value => { status.textContent = value; }
    });
    const autosave = debounce(() => {
      autosaveStatus.run({ title: title.value, richHtml: cleanHtml(area.innerHTML), plainText: plainText() }).catch(() => {});
    }, 250);
    if (migratedFiles || migratedQuoteExit.changed) autosave();

    const getSelection = () => documentRef.defaultView?.getSelection?.() || globalThis.getSelection?.();
    const rangeInsideArea = range => Boolean(range && (range.commonAncestorContainer === area || area.contains(range.commonAncestorContainer)));
    let savedRange = null;
    let overlayRange = null;
    let overlayKind = "selection";
    const clearRangeOverlay = () => {
      overlayRange = null;
      rangeOverlay.replaceChildren();
      rangeOverlay.hidden = true;
      rangeOverlay.setAttribute("aria-hidden", "true");
      rangeOverlay.removeAttribute("data-range-kind");
    };
    const positionRangeOverlay = () => {
      if (!overlayRange || !rangeInsideArea(overlayRange)) {
        clearRangeOverlay();
        return false;
      }
      let rectangles = [];
      try {
        rectangles = rangeOverlayRectangles(overlayRange, root.getBoundingClientRect(), area.getBoundingClientRect());
      } catch {
        clearRangeOverlay();
        return false;
      }
      rangeOverlay.replaceChildren();
      rectangles.forEach(rect => {
        const marker = documentRef.createElement("span");
        marker.style.left = `${rect.left}px`;
        marker.style.top = `${rect.top}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
        rangeOverlay.appendChild(marker);
      });
      rangeOverlay.hidden = !rectangles.length;
      rangeOverlay.setAttribute("aria-hidden", rectangles.length ? "false" : "true");
      rangeOverlay.dataset.rangeKind = overlayKind;
      return Boolean(rectangles.length);
    };
    const showRangeOverlay = (range, kind = "selection") => {
      if (!range || range.collapsed || !rangeInsideArea(range)) {
        clearRangeOverlay();
        return false;
      }
      overlayRange = range.cloneRange();
      overlayKind = kind;
      return positionRangeOverlay();
    };
    const rememberSelection = () => {
      const selection = getSelection();
      if (!selection?.rangeCount) return false;
      const range = selection.getRangeAt(0);
      if (!rangeInsideArea(range)) return false;
      savedRange = range.cloneRange();
      return true;
    };
    const restoreSelection = () => {
      if (!savedRange) return false;
      try {
        const selection = getSelection();
        if (!selection) return false;
        area.focus();
        selection.removeAllRanges();
        selection.addRange(savedRange);
        return true;
      } catch {
        savedRange = null;
        return false;
      }
    };
    const restoreSelectionOffsets = offsets => {
      const range = editorRangeForTextMatch(area, offsets, documentRef);
      if (!range) return rememberSelection();
      savedRange = range.cloneRange();
      const selection = getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return true;
    };
    const moveCaretAfterTrailingQuote = () => {
      const exit = ensureTrailingQuoteExitParagraph(area, documentRef);
      if (!exit.paragraph || !documentRef.createRange) return false;
      const selection = getSelection();
      if (!selection) return false;
      const caret = documentRef.createRange();
      caret.selectNodeContents(exit.paragraph);
      caret.collapse(true);
      area.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(caret);
      savedRange = caret.cloneRange();
      clearRangeOverlay();
      exit.paragraph.scrollIntoView?.({ block: "nearest" });
      if (exit.changed) {
        status.textContent = "Сохраняю строку после цитаты…";
        autosave();
      }
      return true;
    };

    const runFormat = (command, value = null) => {
      area.focus();
      restoreSelection();
      const selectionOffsets = editorTextOffsetsForRange(area, savedRange, documentRef);
      documentRef.execCommand(command, false, value);
      if (!restoreSelectionOffsets(selectionOffsets)) rememberSelection();
      showRangeOverlay(savedRange);
      status.textContent = "Сохраняю…";
      autosave();
      updateCount();
    };

    let activeFontSize = 0;
    const applyFontSize = () => {
      const size = normalizeRichTextFontSize(fontSizeInput?.value);
      if (!size) {
        status.textContent = `Укажи размер от ${RICH_TEXT_FONT_SIZE_MIN} до ${RICH_TEXT_FONT_SIZE_MAX} px`;
        fontSizeInput?.focus();
        return false;
      }
      activeFontSize = size;
      fontSizeInput.value = String(size);
      area.focus();
      restoreSelection();
      const selectionOffsets = editorTextOffsetsForRange(area, savedRange, documentRef);
      try { documentRef.execCommand("styleWithCSS", false, false); } catch {}
      documentRef.execCommand("fontSize", false, "7");
      normalizeFontSizeMarkers(area, size, documentRef);
      if (!restoreSelectionOffsets(selectionOffsets)) rememberSelection();
      showRangeOverlay(savedRange);
      status.textContent = `Размер шрифта: ${size} px · сохраняю…`;
      autosave();
      updateCount();
      return true;
    };

    const addLinkToSelection = () => {
      area.focus();
      restoreSelection();
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) {
        status.textContent = "Сначала выдели текст, затем нажми «Ссылка»";
        return false;
      }
      const range = selection.getRangeAt(0);
      if (!rangeInsideArea(range)) {
        status.textContent = "Ссылку можно добавить только к тексту заметки";
        return false;
      }
      const container = range.commonAncestorContainer?.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer?.parentElement;
      const currentHref = container?.closest?.("a[href]")?.getAttribute("href") || "https://";
      const rawTarget = requestLink(currentHref, String(selection));
      if (rawTarget === null) return false;
      const href = normalizeRichTextLink(rawTarget);
      if (!href) {
        status.textContent = "Не удалось добавить ссылку: нужен адрес http:// или https://";
        return false;
      }
      restoreSelection();
      documentRef.execCommand("createLink", false, href);
      rememberSelection();
      showRangeOverlay(savedRange);
      status.textContent = "Ссылка добавлена · сохраняю…";
      autosave();
      updateCount();
      return true;
    };

    const toggleQuoteForSelection = () => {
      area.focus();
      restoreSelection();
      const selection = getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) {
        status.textContent = "Сначала выдели текст, затем нажми «Цитата»";
        return false;
      }
      const range = selection.getRangeAt(0);
      if (!rangeInsideArea(range)) {
        status.textContent = "Цитату можно добавить только к тексту заметки";
        return false;
      }
      const closestQuote = node => {
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        const quote = element?.closest?.("blockquote") || null;
        return quote && area.contains(quote) ? quote : null;
      };
      const selectedQuotes = [...area.querySelectorAll("blockquote")].filter(quote => {
        if (quote.parentElement?.closest?.("blockquote")) return false;
        try { return range.intersectsNode(quote); } catch { return false; }
      });
      const removeQuote = shouldRemoveQuoteFromSelection({
        startInsideQuote: Boolean(closestQuote(range.startContainer)),
        endInsideQuote: Boolean(closestQuote(range.endContainer)),
        selectedText: selection.toString(),
        selectedQuoteTexts: selectedQuotes.map(quote => quote.textContent || "")
      });
      const selectionOffsets = editorTextOffsetsForRange(area, range, documentRef);
      documentRef.execCommand("formatBlock", false, removeQuote ? "p" : "blockquote");
      if (!removeQuote) ensureTrailingQuoteExitParagraph(area, documentRef);
      refreshQuoteCopyButtons();
      if (!restoreSelectionOffsets(selectionOffsets)) rememberSelection();
      showRangeOverlay(savedRange);
      status.textContent = `${removeQuote ? "Цитата убрана" : "Текст оформлен как цитата"} · сохраняю…`;
      autosave();
      updateCount();
      return true;
    };

    let findMatches = [];
    let findIndex = -1;
    const searchableText = () => editorTextNodes(area, documentRef).map(node => node.nodeValue || "").join("");
    const showFindMatch = index => {
      if (!findMatches.length) {
        findIndex = -1;
        findCount.textContent = findInput.value.trim() ? "Нет совпадений" : "Введите текст";
        clearRangeOverlay();
        return false;
      }
      findIndex = ((index % findMatches.length) + findMatches.length) % findMatches.length;
      const range = editorRangeForTextMatch(area, findMatches[findIndex], documentRef);
      const selected = showRangeOverlay(range, "find");
      const target = range?.startContainer?.parentElement || range?.startContainer?.parentNode;
      target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      findCount.textContent = `${findIndex + 1} из ${findMatches.length}`;
      findInput.focus({ preventScroll: true });
      return selected;
    };
    const refreshFind = (preferredIndex = 0) => {
      findMatches = findTextMatchOffsets(searchableText(), findInput.value);
      return showFindMatch(preferredIndex);
    };
    const openFind = initialQuery => {
      const wasHidden = findPanel.hidden;
      if (wasHidden) rememberSelection();
      findPanel.hidden = false;
      findPanel.setAttribute("aria-hidden", "false");
      if (typeof initialQuery === "string") {
        findInput.value = initialQuery;
      } else if (wasHidden) {
        const selectedText = String(getSelection?.()?.toString?.() || "").trim();
        if (selectedText && selectedText.length <= 120) findInput.value = selectedText;
      }
      refreshFind(findIndex >= 0 ? findIndex : 0);
      findInput.focus({ preventScroll: true });
      findInput.select();
    };
    const closeFind = () => {
      findPanel.hidden = true;
      findPanel.setAttribute("aria-hidden", "true");
      clearRangeOverlay();
      area.focus();
      restoreSelection();
    };

    let selectedImage = null;
    const hideImageResizer = () => {
      selectedImage = null;
      imageResizer.hidden = true;
      imageResizer.setAttribute("aria-hidden", "true");
    };
    const positionImageResizer = () => {
      if (!selectedImage || !area.contains(selectedImage)) {
        hideImageResizer();
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const imageRect = selectedImage.getBoundingClientRect();
      imageResizer.style.left = `${Math.round(imageRect.left - rootRect.left)}px`;
      imageResizer.style.top = `${Math.round(imageRect.top - rootRect.top)}px`;
      imageResizer.style.width = `${Math.round(imageRect.width)}px`;
      imageResizer.style.height = `${Math.round(imageRect.height)}px`;
    };
    const selectImage = image => {
      if (!image || !area.contains(image)) {
        hideImageResizer();
        return;
      }
      selectedImage = image;
      area.focus({ preventScroll: true });
      imageResizer.hidden = false;
      imageResizer.setAttribute("aria-hidden", "false");
      positionImageResizer();
      status.textContent = "Тяни за угловые маркеры для размера или нажми Delete, чтобы удалить изображение";
    };
    const deleteSelectedImage = () => {
      if (!selectedImage || !area.contains(selectedImage)) {
        hideImageResizer();
        return false;
      }
      const image = selectedImage;
      const parent = image.parentNode;
      const previous = image.previousSibling;
      const next = image.nextSibling;
      image.remove();
      hideImageResizer();
      clearRangeOverlay();
      area.focus({ preventScroll: true });
      if (parent?.isConnected && documentRef.createRange) {
        try {
          const caret = documentRef.createRange();
          if (next?.isConnected) caret.setStartBefore(next);
          else if (previous?.isConnected) caret.setStartAfter(previous);
          else {
            caret.selectNodeContents(parent);
            caret.collapse(false);
          }
          const selection = getSelection();
          selection?.removeAllRanges();
          selection?.addRange(caret);
          savedRange = caret.cloneRange();
        } catch {
          savedRange = null;
        }
      }
      status.textContent = "Изображение удалено · сохраняю…";
      autosave();
      updateCount();
      return true;
    };
    const beginImageResize = (event, direction) => {
      if (!selectedImage) return;
      event.preventDefault();
      event.stopPropagation();
      const image = selectedImage;
      const rect = image.getBoundingClientRect();
      const start = {
        x: event.clientX,
        y: event.clientY,
        width: rect.width || image.naturalWidth || Number(image.getAttribute("width")) || 1,
        height: rect.height || image.naturalHeight || Number(image.getAttribute("height")) || 1
      };
      const move = moveEvent => {
        moveEvent.preventDefault();
        const dimensions = imageResizeDimensions({
          startWidth: start.width,
          startHeight: start.height,
          deltaX: moveEvent.clientX - start.x,
          deltaY: moveEvent.clientY - start.y,
          direction,
          maxWidth: Math.max(48, area.clientWidth - 28)
        });
        image.setAttribute("width", String(dimensions.width));
        image.setAttribute("height", String(dimensions.height));
        status.textContent = `Размер изображения: ${dimensions.width} × ${dimensions.height} px`;
        positionImageResizer();
      };
      const finish = () => {
        documentRef.removeEventListener("pointermove", move);
        documentRef.removeEventListener("pointerup", finish);
        documentRef.removeEventListener("pointercancel", finish);
        status.textContent = "Размер изображения сохранён";
        autosave();
        updateCount();
        positionImageResizer();
      };
      documentRef.addEventListener("pointermove", move);
      documentRef.addEventListener("pointerup", finish);
      documentRef.addEventListener("pointercancel", finish);
    };

    title.addEventListener("input", autosave);
    area.addEventListener("paste", event => {
      const html = event.clipboardData?.getData("text/html") || "";
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!html && !text) return;
      event.preventDefault();
      const cleanedHtml = html ? cleanHtml(html) : "";
      const pastedHtml = text && /(?:https?:\/\/|www\.)/i.test(text) && !/<a\b/i.test(cleanedHtml)
        ? plainToHtml(text)
        : (cleanedHtml || plainToHtml(text));
      documentRef.execCommand("insertHTML", false, pastedHtml);
      if (activeFontSize) normalizeFontSizeMarkers(area, activeFontSize, documentRef);
      ensureTrailingQuoteExitParagraph(area, documentRef);
      refreshQuoteCopyButtons();
      updateCount();
      status.textContent = "Сохраняю…";
      autosave();
    });
    area.addEventListener("input", () => {
      if (activeFontSize) normalizeFontSizeMarkers(area, activeFontSize, documentRef);
      ensureTrailingQuoteExitParagraph(area, documentRef);
      refreshQuoteCopyButtons();
      rememberSelection();
      updateCount();
      status.textContent = "Сохраняю…";
      autosave();
      if (!findPanel.hidden) refreshFind(Math.max(0, findIndex));
    });
    area.addEventListener("mouseup", rememberSelection);
    area.addEventListener("keyup", rememberSelection);
    area.addEventListener("scroll", () => {
      positionImageResizer();
      positionRangeOverlay();
    }, { passive: true });
    root.addEventListener("pointerdown", event => {
      if (event.target.closest("[data-quote-copy]")) {
        event.preventDefault();
        return;
      }
      const resizeHandle = event.target.closest("[data-image-resize]");
      if (resizeHandle) {
        beginImageResize(event, resizeHandle.dataset.imageResize || "se");
        return;
      }
      if (selectedImage && !event.target.closest(".rich-editor-area img")) hideImageResizer();
      if (event.target.closest(".formatting-toolbar")) {
        rememberSelection();
        showRangeOverlay(savedRange);
      } else if (!event.target.closest("[data-find-panel]")) {
        clearRangeOverlay();
      }
    });
    root.addEventListener("click", event => {
      const quoteCopyButton = event.target.closest("[data-quote-copy]");
      if (quoteCopyButton) {
        event.preventDefault();
        event.stopPropagation();
        const quote = quoteCopyButton.closest("blockquote");
        const text = quoteTextForClipboard(quote);
        if (!text) {
          status.textContent = "В цитате нет текста для копирования";
          return;
        }
        status.textContent = "Копирую цитату…";
        Promise.resolve()
          .then(() => copyText(text))
          .then(copied => {
            status.textContent = copied === false ? "Не удалось скопировать цитату" : "Цитата скопирована";
          })
          .catch(error => {
            console.error("Не удалось скопировать цитату", error);
            status.textContent = "Не удалось скопировать цитату";
          });
        return;
      }
      const image = event.target.closest(".rich-editor-area img");
      if (image) {
        event.preventDefault();
        selectImage(image);
        return;
      }
      const link = event.target.closest("a[href]");
      if (link) {
        event.preventDefault();
        event.stopPropagation();
        openExternalLink(link.getAttribute("href") || "");
        return;
      }
      if (event.target.closest(".rich-editor-area")) hideImageResizer();
      const quoteExit = ensureTrailingQuoteExitParagraph(area, documentRef);
      const clickedExit = quoteExit.paragraph && (event.target === quoteExit.paragraph || quoteExit.paragraph.contains?.(event.target));
      const clickedBelowQuote = event.target === area
        && quoteExit.quote?.getBoundingClientRect
        && Number(event.clientY) >= quoteExit.quote.getBoundingClientRect().bottom;
      if ((clickedExit || clickedBelowQuote) && moveCaretAfterTrailingQuote()) {
        event.preventDefault();
        return;
      }
      const format = event.target.closest("[data-format]")?.dataset.format;
      if (format) runFormat(format);
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "new") createNew();
      if (action === "duplicate") duplicate();
      if (action === "download-txt") downloadText();
      if (action === "download-html") downloadHtml();
      if (action === "download-docx") {
        status.textContent = "Создаю DOCX…";
        Promise.resolve(downloadDocx({
          title: title.value,
          richHtml: cleanHtml(area.innerHTML),
          plainText: plainText()
        })).then(result => {
          if (result?.cancelled || result === false) status.textContent = "Скачивание DOCX отменено";
          else if (result?.ok === false) status.textContent = "Не удалось скачать DOCX";
          else status.textContent = "DOCX скачан";
        }).catch(error => {
          console.error("Не удалось скачать заметку в DOCX", error);
          status.textContent = "Не удалось скачать DOCX";
        });
      }
      if (action === "folder") openFolder();
      if (action === "link") addLinkToSelection();
      if (action === "quote") toggleQuoteForSelection();
      const findAction = event.target.closest("[data-find-action]")?.dataset.findAction;
      if (findAction === "previous") showFindMatch(findIndex - 1);
      if (findAction === "next") showFindMatch(findIndex + 1);
      if (findAction === "close") closeFind();
    });
    root.addEventListener("change", event => {
      if (event.target.matches("[data-font]")) runFormat("fontName", event.target.value);
      if (event.target.matches("[data-font-size]")) applyFontSize();
      if (event.target.matches("[data-color]")) runFormat("foreColor", event.target.value);
      if (event.target.matches("[data-bg]")) runFormat("hiliteColor", event.target.value);
    });
    root.addEventListener("keydown", event => {
      if (isQuoteExitArrowShortcut(event) && (event.target === area || area.contains(event.target))) {
        const quoteExit = ensureTrailingQuoteExitParagraph(area, documentRef);
        const selection = getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        if (quoteExit.quote && rangeEndsAtElementEnd(range, quoteExit.quote, documentRef) && moveCaretAfterTrailingQuote()) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (selectedImage && isRichEditorImageDeleteShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        deleteSelectedImage();
        return;
      }
      if (isRichEditorFindShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        openFind();
        return;
      }
      if (!findPanel.hidden && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        showFindMatch(findIndex + (event.shiftKey ? -1 : 1));
        findInput.focus({ preventScroll: true });
        return;
      }
      if (event.target.matches?.("[data-font-size]") && event.key === "Enter") {
        event.preventDefault();
        applyFontSize();
        return;
      }
      if (!findPanel.hidden && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFind();
      }
    }, true);
    findInput.addEventListener("input", () => refreshFind(0));
    updateCount();
    if (searchQuery) {
      highlightSearch(area, searchQuery);
      openFind(searchQuery);
    }
    return root;
  }

  function createMarkdownEditorUI({
    itemName = "",
    initialContent = "",
    searchQuery = "",
    renderMarkdown = value => value,
    selectSearch = () => {},
    debounce = callback => callback,
    save = () => {},
    download = () => {}
  } = {}) {
    const root = document.createElement("div");
    root.className = "editor";
    root.innerHTML = markdownEditorHTML(itemName);
    const title = $(".editor-title", root);
    const area = $("textarea", root);
    const preview = $(".markdown-preview", root);
    const status = $("[data-status]", root);
    area.value = initialContent;
    const draw = () => {
      preview.innerHTML = renderMarkdown(area.value);
      $("[data-count]", root).textContent = `${area.value.length} символов`;
    };
    const autosaveStatus = createAutosaveStatusController({
      save,
      setStatus: value => { status.textContent = value; }
    });
    const autosave = debounce(() => {
      draw();
      autosaveStatus.run({ title: title.value, content: area.value }).catch(() => {});
    }, 250);
    title.addEventListener("input", autosave);
    area.addEventListener("input", autosave);
    root.addEventListener("click", event => {
      if (event.target.closest("[data-download]")) download();
    });
    draw();
    if (searchQuery) selectSearch(area, searchQuery);
    return root;
  }

  function drawNotesGrid(root, {
    items = () => [],
    itemIcon = () => "📄",
    itemDescription = () => "",
    navigateFolder = () => {},
    openNote = () => {},
    showItemMenu = () => {},
    enableDrag = () => {}
  } = {}) {
    const grid = $(".notes-grid", root);
    if (!grid) return;
    grid.innerHTML = "";
    const notes = items();
    if (!notes.length) {
      const empty = document.createElement("div");
      empty.className = "notes-empty workspace-note";
      empty.innerHTML = notesEmptyHTML();
      grid.appendChild(empty);
      return;
    }
    notes.forEach(item => {
      const card = document.createElement("button");
      card.className = "file-card";
      card.dataset.itemId = item.id;
      if (item.type === "folder") card.dataset.folderTarget = item.id;
      card.innerHTML = notesFileCardHTML(item, itemIcon(item), itemDescription(item));
      card.addEventListener("dblclick", event => {
        event.preventDefault();
        event.stopPropagation();
        if (item.type === "folder") navigateFolder(item.id);
        else openNote(item.id);
      });
      card.addEventListener("contextmenu", event => showItemMenu(event, item.id));
      enableDrag(card, item.id, { source: "notes" });
      grid.appendChild(card);
    });
  }

  function bindNotesActions(root, {
    navigateFolder = () => {},
    parentFolder = () => "",
    createNote = () => "",
    openNote = () => {},
    createFolder = () => {},
    redraw = () => {}
  } = {}) {
    if (!root) return;
    root.addEventListener("click", event => {
      const crumb = event.target?.closest?.("[data-crumb]");
      if (crumb) {
        navigateFolder(crumb.dataset.crumb);
        return;
      }
      if (event.target?.closest?.("[data-up]")) {
        navigateFolder(parentFolder());
        return;
      }
      if (event.target?.closest?.("[data-new]")) {
        const itemId = createNote();
        redraw();
        openNote(itemId);
        return;
      }
      if (event.target?.closest?.("[data-new-folder]")) {
        if (createFolder()) redraw();
      }
    });
  }

  function createDocumentEditorRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {} });
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const createItem = typeof options.createItem === "function" ? options.createItem : () => "";
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const refreshWindowTitle = typeof options.refreshWindowTitle === "function" ? options.refreshWindowTitle : () => {};
    const debounce = typeof options.debounce === "function" ? options.debounce : callback => callback;
    const highlightSearch = typeof options.highlightSearch === "function" ? options.highlightSearch : () => {};
    const openApp = typeof options.openApp === "function" ? options.openApp : () => {};
    const openItem = typeof options.openItem === "function" ? options.openItem : () => {};
    const duplicateItem = typeof options.duplicateItem === "function" ? options.duplicateItem : () => {};
    const downloadFile = typeof options.downloadFile === "function" ? options.downloadFile : () => {};
    const downloadBlob = typeof options.downloadBlob === "function" ? options.downloadBlob : () => Promise.resolve(false);
    const buildNoteDocx = typeof options.buildNoteDocx === "function" ? options.buildNoteDocx : () => Promise.reject(new Error("Генератор DOCX недоступен"));
    const sanitizeDownloadName = typeof options.sanitizeExportPathPart === "function" ? options.sanitizeExportPathPart : (name, fallback) => String(name || fallback || "Заметка");
    const stripKnownExtension = typeof options.stripKnownExtension === "function" ? options.stripKnownExtension : name => String(name || "").replace(/\.(txt|docx|html|md)$/i, "");
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const openExternalLink = typeof options.openExternalLink === "function" ? options.openExternalLink : () => {};
    const copyText = typeof options.copyText === "function" ? options.copyText : () => Promise.resolve(false);
    const createRichEditor = typeof options.createRichEditor === "function" ? options.createRichEditor : createRichEditorUI;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const documentRef = options.documentRef || globalThis.document;
    const itemInWorkspace = typeof options.itemInWorkspace === "function" ? options.itemInWorkspace : () => false;
    const getWindowRecord = typeof options.getWindowRecord === "function" ? options.getWindowRecord : () => null;
    const persistOpenWindows = typeof options.persistOpenWindows === "function" ? options.persistOpenWindows : () => {};
    const refreshWindow = typeof options.refreshWindow === "function" ? options.refreshWindow : () => {};
    const itemIcon = typeof options.itemIcon === "function" ? options.itemIcon : () => "📄";
    const showItemMenu = typeof options.showItemMenu === "function" ? options.showItemMenu : () => {};
    const enableItemPointerDrag = typeof options.enableItemPointerDrag === "function" ? options.enableItemPointerDrag : () => {};
    const createFolderInFolder = typeof options.createFolderInFolder === "function" ? options.createFolderInFolder : () => null;
    const requestText = typeof options.prompt === "function" ? options.prompt : () => null;
    const desktopRootOf = typeof options.desktopRootOf === "function" ? options.desktopRootOf : () => getDesktopRoot();
    const desktopName = typeof options.desktopName === "function" ? options.desktopName : id => id;
    const isDesktopRoot = typeof options.isDesktopRoot === "function" ? options.isDesktopRoot : id => id === getDesktopRoot();
    const drawNotes = typeof options.drawNotes === "function" ? options.drawNotes : drawNotesGrid;
    const bindNotes = typeof options.bindNotes === "function" ? options.bindNotes : bindNotesActions;
    const workspaceItems = typeof options.workspaceItems === "function" ? options.workspaceItems : () => [];
    const selectSearch = typeof options.selectSearch === "function" ? options.selectSearch : () => {};
    const createMarkdownEditor = typeof options.createMarkdownEditor === "function" ? options.createMarkdownEditor : createMarkdownEditorUI;

    function renderRichEditorApp(params = {}, winId = "") {
      const state = getState();
      let itemId = params.itemId;
      if (!itemId) {
        itemId = createItem("text", "Новый документ.txt", getDesktopRoot(), 370, 160, { content: "", richContent: "" });
        params.itemId = itemId;
      }
      const item = state.fs[itemId];
      const root = createRichEditor({
        itemName: item.name,
        managedFiles: item.managedFiles,
        initialHtml: item.richContent || plainToRichHtml(item.content || ""),
        searchQuery: params.searchQuery,
        cleanHtml: cleanRichHtml,
        plainToHtml: plainToRichHtml,
        highlightSearch,
        debounce,
        save: ({ title, richHtml, plainText }) => {
          item.name = title.trim() || item.name;
          item.richContent = richHtml;
          item.content = plainText;
          item.updatedAt = now();
          const savePromise = saveState();
          renderFileSurfaces();
          refreshWindowTitle(winId, item.name);
          return savePromise;
        },
        createNew: () => openApp("editor", { itemId: createItem("text", "Новый документ.txt", item.parent, 80, 80, { content: "", richContent: "" }) }),
        duplicate: () => duplicateItem(itemId),
        downloadText: () => downloadFile(item.name.replace(/\.(txt|html)$/i, "") + ".txt", item.content || "", "text/plain"),
        downloadHtml: () => downloadFile(item.name.replace(/\.(txt|html)$/i, "") + ".html", `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>${escapeHtml(item.name)}</title></head><body>${item.richContent || ""}</body></html>`, "text/html"),
        downloadDocx: async ({ title, richHtml, plainText }) => {
          const exportItem = {
            ...item,
            name: title.trim() || item.name || "Заметка",
            richContent: richHtml,
            content: plainText
          };
          const docx = await buildNoteDocx(exportItem);
          const baseName = sanitizeDownloadName(stripKnownExtension(exportItem.name), "Заметка");
          return downloadBlob(`${baseName}.docx`, docx);
        },
        openFolder: () => {
          const parent = item.parent || getDesktopRoot();
          if (state.fs[parent]?.type === "folder") openApp("folder", { folderId: parent });
          else toast("Файл на рабочем столе", "Этот файл находится прямо на рабочем столе.");
        },
        openExternalLink,
        copyText,
        requestLink: defaultValue => requestText("Адрес ссылки для выделенного текста:", defaultValue || "https://"),
        documentRef
      });
      root.dataset.managedFileItemId = item.id;
      return root;
    }

    function breadcrumbHTML(folderId) {
      const state = getState();
      const root = desktopRootOf(folderId);
      const chain = [];
      let id = folderId;
      while (id && id !== root) {
        const item = state.fs[id];
        if (!item) break;
        chain.unshift(item);
        id = item.parent;
      }
      return notesBreadcrumbHTML({
        rootId: root,
        rootLabel: desktopName(root),
        rootIsDesktop: isDesktopRoot(root),
        chain
      });
    }

    function renderNotesApp(params = {}, winId = "") {
      const state = getState();
      const workspaceRoot = getDesktopRoot();
      let currentFolder = params.folderId || workspaceRoot;
      if (currentFolder !== workspaceRoot) {
        const folder = state.fs[currentFolder];
        if (!folder || folder.type !== "folder" || !itemInWorkspace(folder, workspaceRoot)) currentFolder = workspaceRoot;
      }
      params.folderId = currentFolder;

      const root = documentRef.createElement("div");
      root.className = "app-shell notes-app";
      root.innerHTML = notesShellHTML(currentFolder, workspaceRoot, breadcrumbHTML(currentFolder));

      const navigate = folderId => {
        const target = folderId || workspaceRoot;
        if (target !== workspaceRoot) {
          const folder = state.fs[target];
          if (!folder || folder.type !== "folder" || !itemInWorkspace(folder, workspaceRoot)) return;
        }
        const record = getWindowRecord(winId);
        if (record) record.params = { ...(record.params || {}), folderId: target };
        params.folderId = target;
        persistOpenWindows();
        refreshWindow(winId);
      };

      const draw = () => drawNotes(root, {
        items: () => Object.values(state.fs)
          .filter(item => item.parent === currentFolder && !item.systemRole && ["folder", "note", "managedFile", "shortcut"].includes(item.type))
          .sort((a, b) => (a.type === "folder") === (b.type === "folder") ? String(a.name).localeCompare(String(b.name), "ru") : (a.type === "folder" ? -1 : 1)),
        itemIcon,
        itemDescription: item => item.type === "folder"
          ? `${Object.values(state.fs).filter(child => child.parent === item.id && ["folder", "note", "managedFile", "shortcut"].includes(child.type)).length} элементов`
          : item.type === "managedFile" ? "Файл Windows · двойной клик" : item.type === "shortcut" ? "Ярлык · двойной клик" : (item.content || "").slice(0, 80),
        navigateFolder: navigate,
        openNote: itemId => ["managedFile", "shortcut"].includes(state.fs[itemId]?.type) ? openItem(itemId) : openApp("editor", { itemId }),
        showItemMenu,
        enableDrag: enableItemPointerDrag
      });

      bindNotes(root, {
        navigateFolder: navigate,
        parentFolder: () => {
          const parent = state.fs[currentFolder]?.parent || workspaceRoot;
          return isDesktopRoot(parent) ? workspaceRoot : parent;
        },
        createNote: () => createItem("note", "Новая заметка", currentFolder, 60, 60, { content: "", richContent: "" }),
        openNote: itemId => openApp("editor", { itemId }),
        createFolder: () => {
          const name = requestText("Название папки для заметок:", "Новая папка");
          if (name === null) return false;
          return Boolean(createFolderInFolder(currentFolder, { defaultName: name.trim() || "Новая папка", x: 60, y: 60, prompt: false, extra: { showInExplorerTree: true } }));
        },
        redraw: draw
      });

      draw();
      return root;
    }

    function renderMarkdownApp(params = {}, winId = "") {
      const state = getState();
      const itemId = params.itemId || workspaceItems().find(item => item.type === "markdown")?.id ||
        createItem("markdown", "Новый Markdown.md", getDesktopRoot(), 80, 80, { content: "# Новый документ" });
      params.itemId = itemId;
      const item = state.fs[itemId];
      return createMarkdownEditor({
        itemName: item.name,
        initialContent: item.content || "",
        searchQuery: params.searchQuery,
        renderMarkdown: markdown,
        selectSearch,
        debounce,
        save: ({ title, content }) => {
          item.name = title.trim() || item.name;
          item.content = content;
          item.updatedAt = now();
          const savePromise = saveState();
          renderFileSurfaces();
          refreshWindowTitle(winId, item.name);
          return savePromise;
        },
        download: () => downloadFile(item.name.replace(/\.md$/i, "") + ".md", item.content || "", "text/markdown")
      });
    }

    return Object.freeze({ renderRichEditorApp, renderNotesApp, renderMarkdownApp, breadcrumbHTML });
  }

  window.ZETER_EDITOR_UI_UTILS = Object.freeze({
    richEditorHTML,
    isRichEditorFindShortcut,
    isRichEditorImageDeleteShortcut,
    isQuoteExitArrowShortcut,
    shouldRemoveQuoteFromSelection,
    ensureTrailingQuoteExitParagraph,
    rangeEndsAtElementEnd,
    quoteTextForClipboard,
    findTextMatchOffsets,
    imageResizeDimensions,
    createAutosaveStatusController,
    editorTextNodes,
    editorRangeForTextMatch,
    rangeOverlayRectangles,
    editorTextOffsetsForRange,
    selectEditorTextMatch,
    normalizeFontSizeMarkers,
    notesBreadcrumbHTML,
    notesShellHTML,
    notesEmptyHTML,
    notesFileCardHTML,
    markdownEditorHTML,
    createRichEditorUI,
    createMarkdownEditorUI,
    drawNotesGrid,
    bindNotesActions,
    createDocumentEditorRuntimeController
  });
})();
