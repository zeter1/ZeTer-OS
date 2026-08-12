(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const tableUtils = window.ZETER_TABLE_UTILS;
  const tableUiUtils = window.ZETER_TABLE_UI_UTILS;
  const xlsxUtils = window.ZETER_XLSX_UTILS;
  if (!coreUtils || !tableUtils || !tableUiUtils || !xlsxUtils) throw new Error("ZeTer OS table interactions require table UI and XLSX dependencies.");

  const { $, $$, clamp } = coreUtils;
  const {
    TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS, TABLE_MIN_ROWS, TABLE_MIN_COLS,
    TABLE_MAX_ROWS, TABLE_MAX_COLS, TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_ROW_HEIGHT,
    TABLE_MIN_COL_WIDTH, TABLE_MAX_COL_WIDTH, TABLE_MIN_ROW_HEIGHT, TABLE_MAX_ROW_HEIGHT,
    makeDefaultTablePage, exposeActiveTablePage, activeTablePage, tableCellStyle,
    setTableCellStyle, shiftTableCellStyles, spreadsheetColumnName,
    ensureTableFileName, makeDefaultTableData, normalizeTableData, tableToCSV
  } = tableUtils;
  const {
    tableAppShellHTML, tablePagesHTML, tableGridHTML, tableSizeText, applyTableLayout,
    updateTableFormatControls, bindTableGridNavigation, bindTableCellResize, bindTableManagedFileResize
  } = tableUiUtils;
  const { buildTableXlsxBlob } = xlsxUtils;

  function createTableView({ item, root, tableEl, pagesEl, size, searchQuery, applySearchHighlight = () => {}, getTable, getPage }) {
    const setActive = (row, col, focus = false) => {
      const page = getPage();
      page.active = { row: clamp(row, 0, page.rows.length - 1), col: clamp(col, 0, page.columns.length - 1) };
      exposeActiveTablePage(item.table);
      $$('[data-cell]', tableEl).forEach(cell => {
        cell.classList.toggle("active", Number(cell.dataset.row) === page.active.row && Number(cell.dataset.col) === page.active.col);
        cell.classList.remove("resizing");
      });
      updateTableFormatControls(root, page);
      if (focus) {
        const input = $(`input[data-row="${page.active.row}"][data-col="${page.active.col}"]`, tableEl);
        input?.focus(); input?.select();
      }
    };
    const drawPages = () => { pagesEl.innerHTML = tablePagesHTML(getTable()); };
    const draw = () => {
      const table = getTable(); const page = activeTablePage(table);
      tableEl.innerHTML = tableGridHTML(page); applyTableLayout(tableEl, page);
      size.textContent = tableSizeText(table, page);
      setActive(page.active?.row || 0, page.active?.col || 0, false);
      drawPages();
      if (searchQuery) applySearchHighlight(root, searchQuery);
    };
    return { draw, drawPages, setActive };
  }

  function bindTablePageActions(pagesEl, { getTable, draw, save, setStatus, promptName, confirmDelete, toast }) {
    pagesEl.addEventListener("click", event => {
      const tab = event.target.closest("[data-table-page-index]");
      const action = event.target.closest("[data-table-page-action]")?.dataset.tablePageAction;
      const table = getTable();
      if (tab) {
        table.activePage = clamp(Number(tab.dataset.tablePageIndex), 0, table.pages.length - 1);
        exposeActiveTablePage(table); draw(); setStatus(`Страница: ${activeTablePage(table).name}`); save(); return;
      }
      if (!action) return;
      if (action === "add") {
        table.pages.push(makeDefaultTablePage(TABLE_DEFAULT_ROWS, TABLE_DEFAULT_COLS, `Страница ${table.pages.length + 1}`));
        table.activePage = table.pages.length - 1; exposeActiveTablePage(table); draw(); setStatus("Добавлена новая страница"); save();
      }
      if (action === "rename") {
        const page = activeTablePage(table); const nextName = promptName(page.name || `Страница ${table.activePage + 1}`);
        if (nextName === null) return;
        page.name = nextName.trim() || `Страница ${table.activePage + 1}`; draw(); setStatus("Страница переименована"); save();
      }
      if (action === "delete") {
        if (table.pages.length <= 1) return toast("Нельзя удалить", "В таблице должна остаться хотя бы одна страница");
        const page = activeTablePage(table);
        if (!confirmDelete(page.name || `Страница ${table.activePage + 1}`)) return;
        table.pages.splice(table.activePage, 1); table.activePage = Math.max(0, table.activePage - 1);
        exposeActiveTablePage(table); draw(); setStatus("Страница удалена"); save();
      }
    });
  }

  function bindTableFormatActions(root, fontSizeSelect, { getPage, draw, setActive, save, setStatus }) {
    const applyFormat = updater => {
      const page = getPage(); const active = page.active || { row: 0, col: 0 };
      const next = updater({ ...tableCellStyle(page, active.row, active.col) }) || {};
      setTableCellStyle(page, active.row, active.col, next); draw(); setActive(active.row, active.col, true); setStatus("Сохраняю…"); save();
    };
    fontSizeSelect.addEventListener("change", () => applyFormat(style => ({ ...style, fontSize: clamp(Math.round(Number(fontSizeSelect.value) || 14), 10, 28) })));
    root.addEventListener("change", event => {
      const color = event.target.closest("input[data-table-color]");
      if (color) applyFormat(style => ({ ...style, [color.dataset.tableColor]: color.value }));
    });
    return event => {
      const format = event.target.closest("[data-table-format]")?.dataset.tableFormat;
      if (!format) return false;
      applyFormat(style => {
        if (format === "clear-format") return {};
        return {
          ...style,
          ...(format === "bold" ? { bold: !style.bold } : format === "italic" ? { italic: !style.italic } : format === "underline" ? { underline: !style.underline } : format === "align-left" ? { align: style.align === "left" ? undefined : "left" } : format === "align-center" ? { align: style.align === "center" ? undefined : "center" } : format === "align-right" ? { align: style.align === "right" ? undefined : "right" } : {})
        };
      });
      return true;
    };
  }

  function handleTableStructureAction(action, { getPage, draw, save, setActive, toast }) {
    const page = getPage();
    if (action === "add-row") {
      if (page.rows.length >= TABLE_MAX_ROWS) return toast("Лимит таблицы", `Максимум строк: ${TABLE_MAX_ROWS}`);
      const after = page.active?.row ?? page.rows.length - 1; const insertAt = after + 1;
      page.rows.splice(insertAt, 0, Array.from({ length: page.columns.length }, () => ""));
      page.rowHeights.splice(insertAt, 0, page.rowHeights[after] || TABLE_DEFAULT_ROW_HEIGHT);
      shiftTableCellStyles(page, { type: "insert-row", index: insertAt }); page.active = { row: insertAt, col: page.active?.col || 0 };
    } else if (action === "add-col") {
      if (page.columns.length >= TABLE_MAX_COLS) return toast("Лимит таблицы", `Максимум столбцов: ${TABLE_MAX_COLS}`);
      const after = page.active?.col ?? page.columns.length - 1; const insertAt = after + 1;
      page.columns.splice(insertAt, 0, spreadsheetColumnName(page.columns.length)); page.columnWidths.splice(insertAt, 0, page.columnWidths[after] || TABLE_DEFAULT_COL_WIDTH);
      page.rows.forEach(row => row.splice(insertAt, 0, "")); shiftTableCellStyles(page, { type: "insert-col", index: insertAt }); page.active = { row: page.active?.row || 0, col: insertAt };
    } else if (action === "delete-row") {
      if (page.rows.length <= TABLE_MIN_ROWS) return true;
      const row = clamp(page.active?.row || 0, 0, page.rows.length - 1); page.rows.splice(row, 1); page.rowHeights.splice(row, 1);
      shiftTableCellStyles(page, { type: "delete-row", index: row }); page.active.row = Math.max(0, row - 1);
    } else if (action === "delete-col") {
      if (page.columns.length <= TABLE_MIN_COLS) return true;
      const col = clamp(page.active?.col || 0, 0, page.columns.length - 1); page.columns.splice(col, 1); page.columnWidths.splice(col, 1);
      page.rows.forEach(row => row.splice(col, 1)); shiftTableCellStyles(page, { type: "delete-col", index: col }); page.active.col = Math.max(0, col - 1);
    } else return false;
    draw(); save(); if (action === "add-row" || action === "add-col") setActive(page.active.row, page.active.col, true);
    return true;
  }

  function handleTableFileAction(action, { item, getTable, getPage, draw, save, downloadXlsx, confirmClear }) {
    if (action === "download-xlsx") { downloadXlsx(item, getTable()); return true; }
    if (action !== "clear" || !confirmClear()) return action === "clear";
    const page = getPage(); page.rows = page.rows.map(row => row.map(() => "")); page.cellStyles = {}; page.managedFiles = []; exposeActiveTablePage(item.table); draw(); save(); return true;
  }

  function createTableAppRuntimeController(options = {}) {
    const getState = typeof options.getState === "function" ? options.getState : () => ({ fs: {} });
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const createItem = typeof options.createItem === "function" ? options.createItem : () => "";
    const debounce = typeof options.debounce === "function" ? options.debounce : callback => callback;
    const findSearchHit = typeof options.findSearchHit === "function" ? options.findSearchHit : () => null;
    const applySearchHighlight = typeof options.applySearchHighlight === "function" ? options.applySearchHighlight : () => {};
    const saveState = typeof options.saveState === "function" ? options.saveState : () => {};
    const renderFileSurfaces = typeof options.renderFileSurfaces === "function" ? options.renderFileSurfaces : () => {};
    const refreshWindowTitle = typeof options.refreshWindowTitle === "function" ? options.refreshWindowTitle : () => {};
    const toast = typeof options.toast === "function" ? options.toast : () => {};
    const promptUser = typeof options.prompt === "function" ? options.prompt : () => null;
    const confirmUser = typeof options.confirm === "function" ? options.confirm : () => false;
    const downloadBlob = typeof options.downloadBlob === "function" ? options.downloadBlob : () => {};
    const openExternalLink = typeof options.openExternalLink === "function" ? options.openExternalLink : () => {};
    const documentRef = options.documentRef || globalThis.document;
    const now = typeof options.now === "function" ? options.now : Date.now;
    const createView = typeof options.createView === "function" ? options.createView : createTableView;
    const bindPageActions = typeof options.bindPageActions === "function" ? options.bindPageActions : bindTablePageActions;
    const bindFormatActions = typeof options.bindFormatActions === "function" ? options.bindFormatActions : bindTableFormatActions;
    const bindGridNavigation = typeof options.bindGridNavigation === "function" ? options.bindGridNavigation : bindTableGridNavigation;
    const bindCellResize = typeof options.bindCellResize === "function" ? options.bindCellResize : bindTableCellResize;
    const bindManagedFileResize = typeof options.bindManagedFileResize === "function" ? options.bindManagedFileResize : bindTableManagedFileResize;
    const runStructureAction = typeof options.handleStructureAction === "function" ? options.handleStructureAction : handleTableStructureAction;
    const runFileAction = typeof options.handleFileAction === "function" ? options.handleFileAction : handleTableFileAction;

    function renderTableApp(params = {}, winId = "") {
      const state = getState();
      let itemId = params.itemId;
      if (!itemId) {
        itemId = createItem("table", "Новая таблица.table", getDesktopRoot(), 120, 120, { table: makeDefaultTableData(), content: "", extension: "table" });
        params.itemId = itemId;
      }
      const item = state.fs[itemId];
      item.table = normalizeTableData(item.table || item);
      item.content = tableToCSV(item);

      const root = documentRef.createElement("div");
      root.className = "table-app";
      root.dataset.managedFileItemId = item.id;
      root.innerHTML = tableAppShellHTML(item.name);

      const title = $(".table-title", root);
      const tableEl = $(".zeter-table", root);
      const status = $("[data-table-status]", root);
      const size = $("[data-table-size]", root);
      const pagesEl = $("[data-table-pages]", root);
      const fontSizeSelect = $("[data-table-font-size]", root);

      const getTable = () => item.table = normalizeTableData(item.table);
      const getPage = () => activeTablePage(getTable());
      const initialSearchHit = params.searchQuery ? findSearchHit(item.table, params.searchQuery) : null;
      if (initialSearchHit) {
        item.table.activePage = initialSearchHit.pageIndex;
        exposeActiveTablePage(item.table);
        activeTablePage(item.table).active = { row: initialSearchHit.row, col: initialSearchHit.col };
      }

      const save = debounce(() => {
        item.name = title.value.trim() || item.name;
        item.table = normalizeTableData(item.table);
        item.content = tableToCSV(item);
        item.updatedAt = now();
        saveState();
        renderFileSurfaces();
        refreshWindowTitle(winId, item.name);
        status.textContent = `Автосохранено: ${new Date().toLocaleTimeString("ru-RU")}`;
      }, 220);

      const { drawPages, draw, setActive } = createView({
        item, root, tableEl, pagesEl, size, searchQuery: params.searchQuery,
        applySearchHighlight, getTable, getPage
      });
      const setStatus = text => { status.textContent = text; };

      bindCellResize(root, tableEl, {
        getPage,
        setActive,
        applyLayout: page => applyTableLayout(tableEl, page),
        save,
        setStatus,
        minColumnWidth: TABLE_MIN_COL_WIDTH,
        maxColumnWidth: TABLE_MAX_COL_WIDTH,
        minRowHeight: TABLE_MIN_ROW_HEIGHT,
        maxRowHeight: TABLE_MAX_ROW_HEIGHT
      });

      bindManagedFileResize(root, tableEl, {
        getPage,
        save,
        setStatus
      });

      title.addEventListener("input", () => { status.textContent = "Сохраняю…"; save(); });

      bindGridNavigation(tableEl, {
        getPage,
        setActive,
        save,
        setStatus,
        columnName: spreadsheetColumnName,
        openExternalLink
      });

      bindPageActions(pagesEl, {
        getTable, draw, save, setStatus,
        promptName: currentName => promptUser("Название страницы:", currentName),
        confirmDelete: currentName => confirmUser(`Удалить страницу «${currentName}»?`), toast
      });
      const handleFormatAction = bindFormatActions(root, fontSizeSelect, { getPage, draw, setActive, save, setStatus });

      root.addEventListener("click", event => {
        if (handleFormatAction(event)) return;
        const action = event.target.closest("[data-table-action]")?.dataset.tableAction;
        if (!action) return;
        if (runStructureAction(action, { getPage, draw, save, setActive, toast })) return;
        runFileAction(action, {
          item, getTable, getPage, draw, save,
          downloadXlsx: (currentItem, table) => {
            const base = ensureTableFileName(currentItem.name).replace(/\.(table|csv|xlsx)$/i, "");
            const fileName = `${base}.xlsx`;
            setStatus("Собираю книгу Excel…");
            Promise.resolve(buildTableXlsxBlob(table))
              .then(blob => downloadBlob(fileName, blob))
              .then(result => {
                if (result?.cancelled) {
                  setStatus("Сохранение Excel отменено");
                  return;
                }
                const savedName = result?.fileName || fileName;
                const directory = result?.directoryName ? `Папка: ${result.directoryName}` : "";
                setStatus(`Excel сохранён: ${savedName}`);
                toast("Книга Excel сохранена", [savedName, directory].filter(Boolean).join(" · "));
              })
              .catch(error => {
                console.error("[ZeTer OS table XLSX]", error);
                setStatus("Не удалось сохранить Excel");
                toast("Ошибка сохранения Excel", error?.message || "Не удалось создать книгу XLSX");
              });
          },
          confirmClear: () => confirmUser("Очистить все ячейки активной страницы?")
        });
      });

      drawPages();
      draw();
      return root;
    }

    return Object.freeze({ renderTableApp });
  }

  window.ZETER_TABLE_APP_INTERACTIONS = Object.freeze({
    createTableView,
    bindTablePageActions,
    bindTableFormatActions,
    handleTableStructureAction,
    handleTableFileAction,
    createTableAppRuntimeController
  });
})();
