(() => {
  "use strict";

  const assetUtils = window.ZETER_ASSET_UTILS;
  const exportUtils = window.ZETER_EXPORT_UTILS;
  if (!assetUtils || !exportUtils) throw new Error("ZeTer OS XLSX utils require asset and export utils.");

  const { createZipBlob } = assetUtils;
  const { escapeXml } = exportUtils;
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }

  function spreadsheetColumnName(index = 0) {
    let value = Math.max(0, Math.round(Number(index) || 0)) + 1;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  function pixelsToExcelColumnWidth(pixels = 138) {
    const safePixels = clampNumber(pixels, 8, 1800, 138);
    return Math.round(Math.max(1, Math.min(255, (safePixels - 5) / 7)) * 100) / 100;
  }

  function pixelsToExcelRowHeight(pixels = 38) {
    const safePixels = clampNumber(pixels, 8, 546, 38);
    return Math.round(safePixels * 0.75 * 100) / 100;
  }

  function cleanXmlText(value = "") {
    return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  }

  function inlineStringXml(value = "") {
    const text = cleanXmlText(value);
    const preserve = /^\s|\s$|[\r\n\t]/.test(text) ? ' xml:space="preserve"' : "";
    return `<is><t${preserve}>${escapeXml(text)}</t></is>`;
  }

  function uniqueWorksheetName(value, index, used) {
    const fallback = `Страница ${index + 1}`;
    let base = cleanXmlText(value || fallback)
      .replace(/[\\/\?\*\[\]:]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^'+|'+$/g, "")
      .trim() || fallback;
    base = base.slice(0, 31);
    let candidate = base;
    let number = 2;
    while (used.has(candidate.toLocaleLowerCase("ru-RU"))) {
      const suffix = ` (${number++})`;
      candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    used.add(candidate.toLocaleLowerCase("ru-RU"));
    return candidate;
  }

  function worksheetXml(page = {}, pageIndex = 0, activePage = 0) {
    const rows = Array.isArray(page.rows) ? page.rows : [];
    const columns = Array.isArray(page.columns) ? page.columns : [];
    const columnCount = Math.max(1, columns.length, ...rows.map(row => Array.isArray(row) ? row.length : 0));
    const rowCount = Math.max(1, rows.length);
    const lastCell = `${spreadsheetColumnName(columnCount - 1)}${rowCount}`;
    const activeRow = Math.max(0, Math.min(rowCount - 1, Math.round(Number(page.active?.row) || 0)));
    const activeColumn = Math.max(0, Math.min(columnCount - 1, Math.round(Number(page.active?.col) || 0)));
    const activeCell = `${spreadsheetColumnName(activeColumn)}${activeRow + 1}`;

    const colsXml = Array.from({ length: columnCount }, (_, columnIndex) => {
      const width = pixelsToExcelColumnWidth(page.columnWidths?.[columnIndex]);
      return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${width}" customWidth="1"/>`;
    }).join("");

    const rowsXml = Array.from({ length: rowCount }, (_, rowIndex) => {
      const height = pixelsToExcelRowHeight(page.rowHeights?.[rowIndex]);
      const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
      const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
        const value = String(row[columnIndex] ?? "");
        if (!value) return "";
        const ref = `${spreadsheetColumnName(columnIndex)}${rowIndex + 1}`;
        return `<c r="${ref}" t="inlineStr">${inlineStringXml(value)}</c>`;
      }).join("");
      return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells}</row>`;
    }).join("");

    const tabSelected = pageIndex === activePage ? ' tabSelected="1"' : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<dimension ref="A1:${lastCell}"/>` +
      `<sheetViews><sheetView workbookViewId="0"${tabSelected}><selection activeCell="${activeCell}" sqref="${activeCell}"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/>` +
      `<cols>${colsXml}</cols><sheetData>${rowsXml}</sheetData>` +
      `</worksheet>`;
  }

  function xlsxStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
      `</styleSheet>`;
  }

  function buildTableXlsxEntries(table = {}) {
    const sourcePages = Array.isArray(table.pages) && table.pages.length ? table.pages : [table];
    const pages = sourcePages.filter(page => page && typeof page === "object");
    if (!pages.length) pages.push({ name: "Страница 1", columns: ["A"], rows: [[""]] });
    const activePage = Math.max(0, Math.min(pages.length - 1, Math.round(Number(table.activePage) || 0)));
    const usedNames = new Set();
    const sheetNames = pages.map((page, index) => uniqueWorksheetName(page.name, index, usedNames));

    const contentOverrides = pages.map((_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join("");
    const workbookSheets = sheetNames.map((name, index) =>
      `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    ).join("");
    const workbookRelationships = pages.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    ).join("");
    const stylesRelationshipId = `rId${pages.length + 1}`;

    const entries = [
      {
        path: "[Content_Types].xml",
        blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${contentOverrides}</Types>`
      },
      {
        path: "_rels/.rels",
        blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      },
      {
        path: "xl/workbook.xml",
        blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${activePage}"/></bookViews><sheets>${workbookSheets}</sheets><calcPr calcId="0"/></workbook>`
      },
      {
        path: "xl/_rels/workbook.xml.rels",
        blob: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRelationships}<Relationship Id="${stylesRelationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      },
      { path: "xl/styles.xml", blob: xlsxStylesXml() },
      ...pages.map((page, index) => ({
        path: `xl/worksheets/sheet${index + 1}.xml`,
        blob: worksheetXml(page, index, activePage)
      }))
    ];
    return { entries, sheetNames, activePage };
  }

  async function buildTableXlsxBlob(table = {}) {
    const model = buildTableXlsxEntries(table);
    const zip = await createZipBlob(model.entries);
    return new Blob([zip], { type: XLSX_MIME });
  }

  window.ZETER_XLSX_UTILS = Object.freeze({
    XLSX_MIME,
    spreadsheetColumnName,
    pixelsToExcelColumnWidth,
    pixelsToExcelRowHeight,
    uniqueWorksheetName,
    worksheetXml,
    buildTableXlsxEntries,
    buildTableXlsxBlob
  });
})();
