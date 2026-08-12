(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const tableUtils = window.ZETER_TABLE_UTILS;
  const managedFileUtils = window.ZETER_MANAGED_FILE_UTILS;
  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS table UI utils require core utils.");
  if (!tableUtils) throw new Error("ZeTer OS table UI utils require table utils.");
  if (!managedFileUtils) throw new Error("ZeTer OS table UI utils require managed file utils.");
  if (!shortcutUtils) throw new Error("ZeTer OS table UI utils require shortcut utils.");

  const { $, $$, clamp, escapeHtml } = coreUtils;
  const {
    TABLE_ROW_HEADER_WIDTH,
    spreadsheetColumnName,
    tableCellStyle,
    tableCellTextStyleAttr,
    tableCellBackgroundStyle
  } = tableUtils;
  const {
    normalizeManagedFiles,
    managedFileAttachmentHTML,
    MANAGED_FILE_MIN_WIDTH,
    MANAGED_FILE_MAX_WIDTH,
    MANAGED_FILE_DEFAULT_WIDTH
  } = managedFileUtils;
  const { normalizeWebUrl } = shortcutUtils;

  function tableCellWebLinkHTML(value = "") {
    const label = String(value || "").trim();
    const href = normalizeWebUrl(label);
    return href ? `<a class="table-cell-web-link" data-table-web-link="${escapeHtml(href)}" href="${escapeHtml(href)}" title="Открыть ссылку в браузере">${escapeHtml(label)}</a>` : "";
  }

  function syncTableCellWebLink(cell, value = "") {
    if (!cell) return false;
    cell.querySelector(".table-cell-web-link")?.remove();
    const html = tableCellWebLinkHTML(value);
    cell.classList.toggle("has-web-link", Boolean(html));
    if (!html) return false;
    const box = cell.ownerDocument.createElement("div");
    box.innerHTML = html;
    const link = box.firstElementChild;
    const input = cell.querySelector("input[data-row][data-col]");
    if (link) cell.insertBefore(link, input?.nextSibling || cell.firstChild);
    return Boolean(link);
  }

  function tableAppShellHTML(itemName = "") {
    return `
      <input class="table-title" value="${escapeHtml(itemName)}" />
      <div class="toolbar table-toolbar">
        <button data-table-action="add-row">+ строка</button>
        <button data-table-action="add-col">+ столбец</button>
        <button data-table-action="delete-row">− строка</button>
        <button data-table-action="delete-col">− столбец</button>
        <span class="toolbar-divider"></span>
        <button class="format-btn" data-table-format="bold" title="Жирный текст"><b>Ж</b></button>
        <button class="format-btn" data-table-format="italic" title="Курсив"><i>К</i></button>
        <button class="format-btn" data-table-format="underline" title="Подчёркивание"><u>Ч</u></button>
        <button class="format-btn" data-table-format="align-left" title="По левому краю">⇤</button>
        <button class="format-btn" data-table-format="align-center" title="По центру">≡</button>
        <button class="format-btn" data-table-format="align-right" title="По правому краю">⇥</button>
        <select class="table-font-size" data-table-font-size title="Размер текста">
          <option value="10">10</option><option value="12">12</option><option value="14">14</option><option value="16">16</option><option value="18">18</option><option value="20">20</option><option value="24">24</option><option value="28">28</option>
        </select>
        <label class="table-color-control" title="Цвет текста">Текст <input type="color" data-table-color="color" value="#f3f4ff"></label>
        <label class="table-color-control" title="Цвет заливки ячейки">Фон <input type="color" data-table-color="background" value="#5c55b8"></label>
        <button class="format-btn" data-table-format="clear-format" title="Сбросить форматирование">Сброс</button>
        <span class="toolbar-divider"></span>
        <button data-table-action="download-xlsx" title="Все страницы, размеры строк и столбцов">Скачать Excel</button>
        <button data-table-action="clear">Очистить</button>
        <span class="muted" data-table-status>Автосохранение включено</span>
      </div>
      <div class="table-pages" data-table-pages></div>
      <div class="table-scroll"><table class="zeter-table"></table></div>
      <div class="editor-status"><span data-table-size></span><span>При экспорте в Excel страницы становятся отдельными листами. Форматирование применяется к выбранной ячейке.</span></div>`;
  }

  function tablePageTitle(page = {}, index = 0) {
    return page.name || `Страница ${index + 1}`;
  }

  function tablePagesHTML(table = {}) {
    const pages = Array.isArray(table.pages) ? table.pages : [];
    const activePage = Number(table.activePage || 0);
    return `
        <div class="table-page-tabs">
          ${pages.map((page, index) => `<button class="table-page-tab ${index === activePage ? "active" : ""}" data-table-page-index="${index}" title="Переключиться на страницу">${escapeHtml(tablePageTitle(page, index))}</button>`).join("")}
        </div>
        <div class="table-page-actions">
          <button data-table-page-action="add">+ страница</button>
          <button data-table-page-action="rename">Переименовать</button>
          <button data-table-page-action="delete">Удалить</button>
        </div>`;
  }

  function tableGridHTML(page = {}) {
    const columns = Array.isArray(page.columns) ? page.columns : [];
    const rows = Array.isArray(page.rows) ? page.rows : [];
    const columnWidths = Array.isArray(page.columnWidths) ? page.columnWidths : [];
    const rowHeights = Array.isArray(page.rowHeights) ? page.rowHeights : [];
    page.managedFiles = normalizeManagedFiles(page.managedFiles, { rowCount: rows.length, colCount: columns.length });
    const filesByCell = new Map();
    page.managedFiles.forEach(file => {
      const key = `${file.row}:${file.col}`;
      if (!filesByCell.has(key)) filesByCell.set(key, []);
      filesByCell.get(key).push(file);
    });
    const colgroup = `<colgroup><col class="table-row-header-col" style="width:${TABLE_ROW_HEADER_WIDTH}px">${columns.map((_, c) => `<col data-table-col="${c}" style="width:${columnWidths[c]}px">`).join("")}</colgroup>`;
    const head = `<thead><tr><th class="corner" style="width:${TABLE_ROW_HEADER_WIDTH}px;min-width:${TABLE_ROW_HEADER_WIDTH}px"></th>${columns.map((col, c) => {
      const width = columnWidths[c];
      return `<th data-col-header="${c}" style="width:${width}px;min-width:${width}px"><input data-col-title="${c}" value="${escapeHtml(col)}" aria-label="Название столбца ${c + 1}"></th>`;
    }).join("")}</tr></thead>`;
    const body = `<tbody>${rows.map((row, r) => {
      const height = rowHeights[r];
      return `<tr data-row-index="${r}" style="height:${height}px"><th data-row-header="${r}" style="height:${height}px;min-height:${height}px">${r + 1}</th>${columns.map((_, c) => {
        const width = columnWidths[c];
        const style = tableCellStyle(page, r, c);
        const tdStyle = `width:${width}px;min-width:${width}px;height:${height}px;min-height:${height}px;${tableCellBackgroundStyle(style)}`;
        const cellFiles = (filesByCell.get(`${r}:${c}`) || []).map(file => managedFileAttachmentHTML(file, {
          resizable: true,
          positioned: true,
          containerHeight: height
        })).join("");
        const cellValue = String(row[c] || "");
        const webLink = tableCellWebLinkHTML(cellValue);
        const classes = [cellFiles ? "has-managed-files" : "", webLink ? "has-web-link" : ""].filter(Boolean).join(" ");
        return `<td${classes ? ` class="${classes}"` : ""} data-cell data-row="${r}" data-col="${c}" style="${tdStyle}"><input data-row="${r}" data-col="${c}" value="${escapeHtml(cellValue)}" aria-label="Ячейка ${spreadsheetColumnName(c)}${r + 1}"${tableCellTextStyleAttr(style)}>${webLink}${cellFiles ? `<div class="table-cell-managed-files">${cellFiles}</div>` : ""}<span class="table-cell-resize-handle" data-cell-resizer data-row="${r}" data-col="${c}" title="Изменить размер ячейки"></span></td>`;
      }).join("")}</tr>`;
    }).join("")}</tbody>`;
    return colgroup + head + body;
  }

  function tableSizeText(table = {}, page = {}) {
    const pageCount = Array.isArray(table.pages) ? table.pages.length : 0;
    const activePage = Number(table.activePage || 0);
    const rows = Array.isArray(page.rows) ? page.rows.length : 0;
    const columns = Array.isArray(page.columns) ? page.columns.length : 0;
    return `${rows} строк × ${columns} столбцов · ${pageCount} страниц · активна: ${tablePageTitle(page, activePage)}`;
  }

  function applyTableLayout(tableEl, page = {}) {
    if (!tableEl || !page) return;
    const tableWidth = TABLE_ROW_HEADER_WIDTH + (page.columnWidths || []).reduce((sum, width) => sum + width, 0);
    tableEl.style.width = `${tableWidth}px`;
    tableEl.style.minWidth = `${tableWidth}px`;
    $$("col[data-table-col]", tableEl).forEach(colEl => {
      const col = Number(colEl.dataset.tableCol);
      colEl.style.width = `${page.columnWidths[col]}px`;
    });
    $$("th[data-col-header]", tableEl).forEach(header => {
      const col = Number(header.dataset.colHeader);
      const width = page.columnWidths[col];
      header.style.width = `${width}px`;
      header.style.minWidth = `${width}px`;
    });
    $$("tr[data-row-index]", tableEl).forEach(rowEl => {
      const row = Number(rowEl.dataset.rowIndex);
      const height = page.rowHeights[row];
      rowEl.style.height = `${height}px`;
      const rowHeader = $(`th[data-row-header="${row}"]`, rowEl);
      if (rowHeader) {
        rowHeader.style.height = `${height}px`;
        rowHeader.style.minHeight = `${height}px`;
      }
    });
    $$('[data-cell]', tableEl).forEach(cell => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      const width = page.columnWidths[col];
      const height = page.rowHeights[row];
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
      cell.style.height = `${height}px`;
      cell.style.minHeight = `${height}px`;
    });
  }

  function updateTableFormatControls(root, page = {}) {
    if (!root) return;
    const active = page.active || { row: 0, col: 0 };
    const style = tableCellStyle(page, active.row, active.col);
    $$('[data-table-format]', root).forEach(button => {
      const format = button.dataset.tableFormat;
      const isActive =
        (format === "bold" && style.bold) ||
        (format === "italic" && style.italic) ||
        (format === "underline" && style.underline) ||
        (format === "align-left" && style.align === "left") ||
        (format === "align-center" && style.align === "center") ||
        (format === "align-right" && style.align === "right");
      button.classList.toggle("active", Boolean(isActive));
    });
    const fontSize = $("[data-table-font-size]", root);
    const textColor = $('input[data-table-color="color"]', root);
    const fillColor = $('input[data-table-color="background"]', root);
    if (fontSize) fontSize.value = String(style.fontSize || 14);
    if (textColor) textColor.value = style.color || "#f3f4ff";
    if (fillColor) fillColor.value = style.background || "#5c55b8";
  }

  function bindTableGridNavigation(tableEl, {
    getPage = () => null,
    setActive = () => {},
    save = () => {},
    setStatus = () => {},
    columnName = spreadsheetColumnName,
    openExternalLink = () => {}
  } = {}) {
    if (!tableEl) return;
    tableEl.addEventListener("focusin", event => {
      const input = event.target.closest("input[data-row][data-col]");
      if (input) setActive(Number(input.dataset.row), Number(input.dataset.col));
    });
    tableEl.addEventListener("click", event => {
      const webLink = event.target.closest("[data-table-web-link]");
      if (webLink) {
        event.preventDefault();
        event.stopPropagation();
        openExternalLink(webLink.dataset.tableWebLink || webLink.getAttribute("href") || "");
        return;
      }
      const cell = event.target.closest("td[data-cell]");
      if (cell) setActive(Number(cell.dataset.row), Number(cell.dataset.col));
    });
    tableEl.addEventListener("input", event => {
      const page = getPage();
      if (!page) return;
      const cell = event.target.closest("input[data-row][data-col]");
      const colTitle = event.target.closest("input[data-col-title]");
      if (cell) {
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        page.rows[row][col] = cell.value;
        syncTableCellWebLink(cell.closest("td[data-cell]"), cell.value);
        setActive(row, col);
        setStatus("Сохраняю…");
        save();
      }
      if (colTitle) {
        const col = Number(colTitle.dataset.colTitle);
        page.columns[col] = colTitle.value || columnName(col);
        setStatus("Сохраняю…");
        save();
      }
    });
    tableEl.addEventListener("keydown", event => {
      const input = event.target.closest("input[data-row][data-col]");
      if (!input) return;
      const page = getPage();
      if (!page) return;
      const row = Number(input.dataset.row);
      const col = Number(input.dataset.col);
      if (event.key === "Enter") {
        event.preventDefault();
        setActive(Math.min(row + 1, page.rows.length - 1), col, true);
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        let nextRow = row;
        let nextCol = col + direction;
        if (nextCol >= page.columns.length) { nextCol = 0; nextRow = Math.min(row + 1, page.rows.length - 1); }
        if (nextCol < 0) { nextCol = page.columns.length - 1; nextRow = Math.max(row - 1, 0); }
        setActive(nextRow, nextCol, true);
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && event.altKey) {
        event.preventDefault();
        const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
        setActive(row + delta[0], col + delta[1], true);
      }
    });
  }

  function bindTableCellResize(root, tableEl, {
    getPage = () => null,
    setActive = () => {},
    applyLayout = () => {},
    save = () => {},
    setStatus = () => {},
    minColumnWidth = 40,
    maxColumnWidth = 600,
    minRowHeight = 24,
    maxRowHeight = 600
  } = {}) {
    if (!root || !tableEl) return;
    let resize = null;
    const stop = () => {
      if (!resize) return;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      root.classList.remove("table-resizing");
      resize = null;
      $$('[data-cell]', tableEl).forEach(cell => cell.classList.remove("resizing"));
      setStatus("Сохраняю…");
      save();
    };
    const move = event => {
      if (!resize) return;
      const page = getPage();
      if (!page) return;
      const width = clamp(Math.round(resize.startWidth + event.clientX - resize.startX), minColumnWidth, maxColumnWidth);
      const height = clamp(Math.round(resize.startHeight + event.clientY - resize.startY), minRowHeight, maxRowHeight);
      page.columnWidths[resize.col] = width;
      page.rowHeights[resize.row] = height;
      applyLayout(page);
      setStatus(`Размер: ${width}×${height}px`);
      save();
    };
    tableEl.addEventListener("mousedown", event => {
      const handle = event.target.closest("[data-cell-resizer]");
      if (!handle) return;
      event.preventDefault();
      event.stopPropagation();
      const page = getPage();
      if (!page) return;
      const row = Number(handle.dataset.row);
      const col = Number(handle.dataset.col);
      setActive(row, col, false);
      resize = { row, col, startX: event.clientX, startY: event.clientY, startWidth: page.columnWidths[col], startHeight: page.rowHeights[row] };
      root.classList.add("table-resizing");
      $(`td[data-row="${row}"][data-col="${col}"]`, tableEl)?.classList.add("resizing");
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", stop);
    });
    return stop;
  }

  function bindTableManagedFileResize(root, tableEl, {
    getPage = () => null,
    save = () => {},
    setStatus = () => {}
  } = {}) {
    if (!root || !tableEl) return;
    let resize = null;
    const stop = () => {
      if (!resize) return;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      root.classList.remove("managed-file-resizing");
      resize = null;
      setStatus("Сохраняю ширину файла…");
      save();
    };
    const move = event => {
      if (!resize) return;
      const page = getPage();
      if (!page) return;
      const width = clamp(
        Math.round(resize.startWidth + event.clientX - resize.startX),
        MANAGED_FILE_MIN_WIDTH,
        MANAGED_FILE_MAX_WIDTH
      );
      const file = (page.managedFiles || []).find(candidate => String(candidate.id) === resize.fileId);
      if (!file) return stop();
      file.displayWidth = width;
      resize.chip.style.width = `${width}px`;
      setStatus(`Ширина файла: ${width}px`);
    };
    tableEl.addEventListener("mousedown", event => {
      const handle = event.target.closest("[data-managed-file-resizer]");
      if (!handle) return;
      const chip = handle.closest(".managed-file-chip[data-managed-file-id]");
      const cell = handle.closest("td[data-cell]");
      const page = getPage();
      if (!chip || !cell || !page) return;
      const file = (page.managedFiles || []).find(candidate => String(candidate.id) === chip.dataset.managedFileId);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      const startWidth = clamp(
        Math.round(Number(file.displayWidth) || chip.getBoundingClientRect().width || MANAGED_FILE_DEFAULT_WIDTH),
        MANAGED_FILE_MIN_WIDTH,
        MANAGED_FILE_MAX_WIDTH
      );
      resize = { fileId: String(file.id), chip, startX: event.clientX, startWidth };
      root.classList.add("managed-file-resizing");
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", stop);
    });
    return stop;
  }

  window.ZETER_TABLE_UI_UTILS = Object.freeze({
    tableAppShellHTML,
    tablePagesHTML,
    tableGridHTML,
    tableSizeText,
    tableCellWebLinkHTML,
    syncTableCellWebLink,
    applyTableLayout,
    updateTableFormatControls,
    bindTableGridNavigation,
    bindTableCellResize,
    bindTableManagedFileResize
  });
})();
