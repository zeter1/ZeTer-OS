(() => {
  "use strict";

  const utils = window.ZETER_CORE_UTILS;
  const exportUtils = window.ZETER_EXPORT_UTILS;
  const managedFileUtils = window.ZETER_MANAGED_FILE_UTILS;
  if (!utils || !exportUtils || !managedFileUtils) throw new Error("ZeTer OS table utils require core, export and managed file utils.");

  const { clamp } = utils;
  const { tablePageToCSV } = exportUtils;
  const { normalizeManagedFiles, shiftTableManagedFiles } = managedFileUtils;

  const TABLE_DEFAULT_ROWS = 8;
  const TABLE_DEFAULT_COLS = 6;
  const TABLE_MIN_ROWS = 1;
  const TABLE_MIN_COLS = 1;
  const TABLE_MAX_ROWS = 80;
  const TABLE_MAX_COLS = 26;
  const TABLE_DEFAULT_COL_WIDTH = 138;
  const TABLE_DEFAULT_ROW_HEIGHT = 38;
  const TABLE_MIN_COL_WIDTH = 56;
  const TABLE_MAX_COL_WIDTH = 520;
  const TABLE_MIN_ROW_HEIGHT = 30;
  const TABLE_MAX_ROW_HEIGHT = 260;
  const TABLE_ROW_HEADER_WIDTH = 46;
  const TABLE_MAX_PAGES = 24;

  function spreadsheetColumnName(index = 0) {
    let n = Math.max(0, Number(index) || 0) + 1;
    let name = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function ensureTableFileName(name = "Новая таблица.table") {
    const clean = String(name || "Новая таблица.table").trim() || "Новая таблица.table";
    return /\.(table|csv)$/i.test(clean) ? clean : `${clean}.table`;
  }

  function makeDefaultTablePage(rows = TABLE_DEFAULT_ROWS, cols = TABLE_DEFAULT_COLS, name = "Страница 1") {
    const safeRows = clamp(Math.round(Number(rows) || TABLE_DEFAULT_ROWS), TABLE_MIN_ROWS, TABLE_MAX_ROWS);
    const safeCols = clamp(Math.round(Number(cols) || TABLE_DEFAULT_COLS), TABLE_MIN_COLS, TABLE_MAX_COLS);
    return {
      name: String(name || "Страница 1"),
      columns: Array.from({ length: safeCols }, (_, i) => spreadsheetColumnName(i)),
      rows: Array.from({ length: safeRows }, () => Array.from({ length: safeCols }, () => "")),
      columnWidths: Array.from({ length: safeCols }, () => TABLE_DEFAULT_COL_WIDTH),
      rowHeights: Array.from({ length: safeRows }, () => TABLE_DEFAULT_ROW_HEIGHT),
      active: { row: 0, col: 0 },
      headerRow: true,
      cellStyles: {},
      managedFiles: []
    };
  }

  function makeDefaultTableData(rows = TABLE_DEFAULT_ROWS, cols = TABLE_DEFAULT_COLS) {
    const page = makeDefaultTablePage(rows, cols, "Страница 1");
    return exposeActiveTablePage({ pages: [page], activePage: 0 });
  }

  function normalizeTableDimensionList(list, length, fallback, min, max) {
    const source = Array.isArray(list) ? list : [];
    return Array.from({ length }, (_, i) => clamp(Math.round(Number(source[i]) || fallback), min, max));
  }

  function normalizeTableColor(value) {
    const text = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text : "";
  }

  function normalizeTableCellStyle(style = {}) {
    const result = {};
    if (style.bold) result.bold = true;
    if (style.italic) result.italic = true;
    if (style.underline) result.underline = true;
    if (["left", "center", "right"].includes(style.align)) result.align = style.align;
    const fontSize = clamp(Math.round(Number(style.fontSize) || 0), 0, 28);
    if (fontSize >= 10) result.fontSize = fontSize;
    const color = normalizeTableColor(style.color);
    const background = normalizeTableColor(style.background);
    if (color) result.color = color;
    if (background) result.background = background;
    return result;
  }

  function normalizeTableCellStyles(styles = {}, rowCount = 0, colCount = 0) {
    const result = {};
    Object.entries(styles && typeof styles === "object" ? styles : {}).forEach(([key, style]) => {
      const [rowRaw, colRaw] = String(key).split(":");
      const row = Number(rowRaw);
      const col = Number(colRaw);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= rowCount || col >= colCount) return;
      const clean = normalizeTableCellStyle(style);
      if (Object.keys(clean).length) result[`${row}:${col}`] = clean;
    });
    return result;
  }

  function normalizeTablePage(raw = {}, fallbackName = "Страница 1") {
    let columns = Array.isArray(raw.columns) ? raw.columns.map((v, i) => String(v || spreadsheetColumnName(i))) : [];
    let rows = Array.isArray(raw.rows) ? raw.rows.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? "")) : []) : [];

    if (!rows.length && typeof raw.content === "string" && raw.content.trim()) {
      rows = parseCSVRows(raw.content);
    }

    const rowCount = clamp(rows.length || TABLE_DEFAULT_ROWS, TABLE_MIN_ROWS, TABLE_MAX_ROWS);
    const detectedCols = Math.max(columns.length, ...rows.map(row => row.length), TABLE_DEFAULT_COLS);
    const colCount = clamp(detectedCols, TABLE_MIN_COLS, TABLE_MAX_COLS);

    if (!columns.length) columns = Array.from({ length: colCount }, (_, i) => spreadsheetColumnName(i));
    columns = Array.from({ length: colCount }, (_, i) => String(columns[i] || spreadsheetColumnName(i)));
    rows = Array.from({ length: rowCount }, (_, r) => Array.from({ length: colCount }, (_, c) => String(rows[r]?.[c] ?? "")));

    const activeRow = clamp(Math.round(Number(raw.active?.row) || 0), 0, rowCount - 1);
    const activeCol = clamp(Math.round(Number(raw.active?.col) || 0), 0, colCount - 1);

    const columnWidths = normalizeTableDimensionList(raw.columnWidths || raw.colWidths, colCount, TABLE_DEFAULT_COL_WIDTH, TABLE_MIN_COL_WIDTH, TABLE_MAX_COL_WIDTH);
    const managedFiles = normalizeManagedFiles(raw.managedFiles, { rowCount, colCount });

    return {
      name: String(raw.name || fallbackName || "Страница 1"),
      columns,
      rows,
      columnWidths,
      rowHeights: normalizeTableDimensionList(raw.rowHeights, rowCount, TABLE_DEFAULT_ROW_HEIGHT, TABLE_MIN_ROW_HEIGHT, TABLE_MAX_ROW_HEIGHT),
      active: { row: activeRow, col: activeCol },
      headerRow: raw.headerRow !== false,
      cellStyles: normalizeTableCellStyles(raw.cellStyles || raw.styles, rowCount, colCount),
      managedFiles
    };
  }

  function exposeActiveTablePage(table = {}) {
    table.pages = Array.isArray(table.pages) && table.pages.length ? table.pages : [makeDefaultTablePage()];
    table.activePage = clamp(Math.round(Number(table.activePage) || 0), 0, table.pages.length - 1);
    const page = table.pages[table.activePage];
    table.columns = page.columns;
    table.rows = page.rows;
    table.columnWidths = page.columnWidths;
    table.rowHeights = page.rowHeights;
    table.active = page.active;
    table.headerRow = page.headerRow;
    table.cellStyles = page.cellStyles;
    table.managedFiles = page.managedFiles;
    return table;
  }

  function activeTablePage(table = {}) {
    if (!Array.isArray(table.pages) || !table.pages.length) return table;
    return table.pages[clamp(Math.round(Number(table.activePage) || 0), 0, table.pages.length - 1)] || table.pages[0];
  }

  function normalizeTableData(raw = {}) {
    const rawPages = Array.isArray(raw.pages) && raw.pages.length ? raw.pages : [raw];
    const pages = rawPages.slice(0, TABLE_MAX_PAGES).map((page, index) => normalizeTablePage(page, `Страница ${index + 1}`));
    const activePage = clamp(Math.round(Number(raw.activePage) || 0), 0, pages.length - 1);
    return exposeActiveTablePage({ pages, activePage });
  }

  function tableCellKey(row, col) {
    return `${row}:${col}`;
  }

  function tableCellStyle(page, row, col) {
    page.cellStyles = page.cellStyles && typeof page.cellStyles === "object" ? page.cellStyles : {};
    return page.cellStyles[tableCellKey(row, col)] || {};
  }

  function setTableCellStyle(page, row, col, style = {}) {
    page.cellStyles = page.cellStyles && typeof page.cellStyles === "object" ? page.cellStyles : {};
    const clean = normalizeTableCellStyle(style);
    const key = tableCellKey(row, col);
    if (Object.keys(clean).length) page.cellStyles[key] = clean;
    else delete page.cellStyles[key];
  }

  function tableCellTextStyleAttr(style = {}) {
    const css = [];
    if (style.bold) css.push("font-weight:800");
    if (style.italic) css.push("font-style:italic");
    if (style.underline) css.push("text-decoration:underline");
    if (style.align) css.push(`text-align:${style.align}`);
    if (style.color) css.push(`color:${style.color}`);
    if (style.fontSize) css.push(`font-size:${style.fontSize}px`);
    return css.length ? ` style="${css.join(";")}"` : "";
  }

  function tableCellBackgroundStyle(style = {}) {
    return style.background ? `background:${style.background};` : "";
  }

  function shiftTableCellStyles(page, options = {}) {
    const styles = page.cellStyles && typeof page.cellStyles === "object" ? page.cellStyles : {};
    const next = {};
    Object.entries(styles).forEach(([key, style]) => {
      let [row, col] = key.split(":").map(Number);
      if (!Number.isInteger(row) || !Number.isInteger(col)) return;
      if (options.type === "insert-row" && row >= options.index) row += 1;
      if (options.type === "delete-row") {
        if (row === options.index) return;
        if (row > options.index) row -= 1;
      }
      if (options.type === "insert-col" && col >= options.index) col += 1;
      if (options.type === "delete-col") {
        if (col === options.index) return;
        if (col > options.index) col -= 1;
      }
      if (row >= 0 && col >= 0 && row < page.rows.length && col < page.columns.length) next[tableCellKey(row, col)] = style;
    });
    page.cellStyles = next;
    shiftTableManagedFiles(page, options);
  }

  function parseCSVRows(text = "") {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    let commaCount = 0;
    let semicolonCount = 0;
    let detectQuoted = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"') {
        if (detectQuoted && src[i + 1] === '"') {
          i++;
        } else {
          detectQuoted = !detectQuoted;
        }
      } else if (!detectQuoted && ch === ",") {
        commaCount++;
      } else if (!detectQuoted && ch === ";") {
        semicolonCount++;
      }
    }
    const delimiter = semicolonCount > commaCount ? ";" : ",";
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === delimiter) {
        row.push(cell);
        cell = "";
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        if (rows.length >= TABLE_MAX_ROWS) break;
        continue;
      }
      cell += ch;
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.slice(0, TABLE_MAX_ROWS).map(cells => cells.slice(0, TABLE_MAX_COLS));
  }

  function tableToCSV(itemOrTable = {}) {
    const table = normalizeTableData(itemOrTable.table || itemOrTable);
    return tablePageToCSV(activeTablePage(table));
  }

  function normalizeTablesData(target = {}) {
    const fs = target?.fs || {};
    Object.values(fs).forEach(item => {
      if (!item || item.type !== "table") return;
      item.name = String(item.name || "Новая таблица.table").trim() || "Новая таблица.table";
      item.table = normalizeTableData(item.table || item);
      item.content = tableToCSV(item);
    });
    return target;
  }

  function tablePlainText(item = {}) {
    const table = normalizeTableData(item.table || item);
    return table.pages
      .map((page, index) => `${page.name || `Страница ${index + 1}`} ${page.rows.map(row => row.join(" ")).join(" ")}`)
      .join(" ");
  }

  window.ZETER_TABLE_UTILS = Object.freeze({
    TABLE_DEFAULT_ROWS,
    TABLE_DEFAULT_COLS,
    TABLE_MIN_ROWS,
    TABLE_MIN_COLS,
    TABLE_MAX_ROWS,
    TABLE_MAX_COLS,
    TABLE_DEFAULT_COL_WIDTH,
    TABLE_DEFAULT_ROW_HEIGHT,
    TABLE_MIN_COL_WIDTH,
    TABLE_MAX_COL_WIDTH,
    TABLE_MIN_ROW_HEIGHT,
    TABLE_MAX_ROW_HEIGHT,
    TABLE_ROW_HEADER_WIDTH,
    TABLE_MAX_PAGES,
    spreadsheetColumnName,
    ensureTableFileName,
    makeDefaultTablePage,
    makeDefaultTableData,
    normalizeTableDimensionList,
    normalizeTableColor,
    normalizeTableCellStyle,
    normalizeTableCellStyles,
    normalizeTablePage,
    exposeActiveTablePage,
    activeTablePage,
    normalizeTableData,
    tableCellKey,
    tableCellStyle,
    setTableCellStyle,
    tableCellTextStyleAttr,
    tableCellBackgroundStyle,
    shiftTableCellStyles,
    parseCSVRows,
    tableToCSV,
    normalizeTablesData,
    tablePlainText
  });
})();
