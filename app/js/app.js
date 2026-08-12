(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS config is not loaded.");
  const {
    STORAGE_KEY,
    OS_VERSION,
    OS_VERSION_NUMBER,
    TRASH_ROOT,
    DEFAULT_TRASH_RETENTION_DAYS,
    ACTIVE_CACHE_NAME,
    OLD_LOCAL_STORAGE_KEYS,
    OLD_RESTORE_DB_NAMES,
    RESTORE_DB,
    RESTORE_STORE,
    RESTORE_LIMIT,
    PRIMARY_STATE_DB,
    PRIMARY_STATE_STORE,
    PRIMARY_STATE_ID,
    SMALL_SETTINGS_KEY,
    STORAGE_WARNING_RATIO,
    STORAGE_WARNING_COOLDOWN_MS,
    STORAGE_CHECK_DEBOUNCE_MS,
    SEARCH_RESULT_LIMIT,
    OPEN_WINDOWS_MAX
  } = config;
  const EXTERNAL_DB = "zeter-os-external-save";
  const EXTERNAL_STORE = "handles";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS core utils are not loaded.");
  const { $, $$, pad, uid, todayISO, escapeHtml, cssEscape, normalizeSafeId, truncateText, clamp, debounce, rand, byteSize, bytesToHuman } = coreUtils;
  const safeAttr = escapeHtml;

  const systemSettingsUtils = window.ZETER_SYSTEM_SETTINGS_UTILS;
  if (!systemSettingsUtils) throw new Error("ZeTer OS system settings utils are not loaded.");
  const {
    normalizeSystemSettings,
    hotkeyActionForEvent,
    notificationDeliveryDecision
  } = systemSettingsUtils;

  const shortcutUtils = window.ZETER_SHORTCUT_UTILS;
  if (!shortcutUtils) throw new Error("ZeTer OS shortcut utils are not loaded.");
  const {
    normalizeShortcutTarget,
    normalizeShortcutRecord,
    shortcutTargetForItem,
    createShortcutEditorApp
  } = shortcutUtils;

  const shellUiUtils = window.ZETER_SHELL_UI_UTILS;
  if (!shellUiUtils) throw new Error("ZeTer OS shell UI utils are not loaded.");
  const {
    formatDate,
    updateClock,
    toast,
    createRunningTaskbarButton,
    createTaskbarController,
    createShellRuntimeController
  } = shellUiUtils;

  const firstRunUiUtils = window.ZETER_FIRST_RUN_UI_UTILS;
  if (!firstRunUiUtils) throw new Error("ZeTer OS first-run UI utils are not loaded.");
  const {
    firstRunScreenHTML
  } = firstRunUiUtils;

  const contextMenuUiUtils = window.ZETER_CONTEXT_MENU_UI_UTILS;
  if (!contextMenuUiUtils) throw new Error("ZeTer OS context menu UI utils are not loaded.");
  const {
    buildStartAppContextMenuEntries,
    buildStartItemContextMenuEntries,
    buildRunningTaskbarWindowMenuEntries,
    buildTaskbarPinnedAppMenuEntries,
    buildSnapMenuEntries,
    buildLockedTaskbarMenuEntries,
    buildExplorerEmptyAreaMenuEntries,
    buildExplorerFolderMenuEntries,
    renderContextMenu
  } = contextMenuUiUtils;

  const desktopLayoutUtils = window.ZETER_DESKTOP_LAYOUT_UTILS;
  if (!desktopLayoutUtils) throw new Error("ZeTer OS desktop layout utils are not loaded.");
  const {
    findFreeFolderPosition: findFreeFolderPositionForItems,
    positionInFolderGrid: positionInFolderGridForItems
  } = desktopLayoutUtils;

  const windowSessionUtils = window.ZETER_WINDOW_SESSION_UTILS;
  if (!windowSessionUtils) throw new Error("ZeTer OS window session utils are not loaded.");
  const {
    serializableParams
  } = windowSessionUtils;

  const windowUiUtils = window.ZETER_WINDOW_UI_UTILS;
  if (!windowUiUtils) throw new Error("ZeTer OS window UI utils are not loaded.");
  const {
    createWindowRuntimeController,
    windowBodyEl
  } = windowUiUtils;

  const explorerTabUtils = window.ZETER_EXPLORER_TAB_UTILS;
  if (!explorerTabUtils) throw new Error("ZeTer OS explorer tab utils are not loaded.");
  const {
    isExplorerBlankTab
  } = explorerTabUtils;

  const explorerUiUtils = window.ZETER_EXPLORER_UI_UTILS;
  if (!explorerUiUtils) throw new Error("ZeTer OS explorer UI utils are not loaded.");
  const {
    explorerTreeHTML,
    explorerPinnedHTML,
    explorerPreviewEmptyHTML,
    explorerPreviewMultiHTML,
    explorerPreviewImageBodyHTML,
    explorerPreviewFolderBodyHTML,
    explorerPreviewTableBodyHTML,
    explorerPreviewTasklistBodyHTML,
    explorerPreviewTextBodyHTML,
    explorerPreviewSingleHTML,
    prepareExplorerAppModel,
    createExplorerApp,
    explorerPreviewHTMLFromModel
  } = explorerUiUtils;

  const pinningUtils = window.ZETER_PINNING_UTILS;
  if (!pinningUtils) throw new Error("ZeTer OS pinning utils are not loaded.");
  const {
    DEFAULT_TASKBAR_PINNED_APPS,
    LOCKED_TASKBAR_ITEMS,
    STATIC_TASKBAR_APP_IDS,
    canPinAppToTaskbar: canPinAppToTaskbarForApps,
    itemTaskbarAppId: itemTaskbarAppIdForApps,
    canPinItemToStart,
    normalizeStartPinnedState: normalizeStartPinnedStateForTarget,
    normalizeTaskbarPinnedApps: normalizeTaskbarPinnedAppsForApps
  } = pinningUtils;

  const trashUtils = window.ZETER_TRASH_UTILS;
  if (!trashUtils) throw new Error("ZeTer OS trash utils are not loaded.");
  const {
    normalizeTrashRetentionDays,
    createTrashActionController
  } = trashUtils;

  const nativeStorage = window.ZETER_NATIVE_STORAGE;
  if (!nativeStorage) throw new Error("ZeTer OS native storage bridge is not loaded.");
  const {
    shouldUseNativeStorage,
    nativeStorageLabel,
    waitForNativeStorage,
    nativeStorageCall,
    normalizeNativeStateRecord
  } = nativeStorage;

  const managedFileUtils = window.ZETER_MANAGED_FILE_UTILS;
  if (!managedFileUtils) throw new Error("ZeTer OS managed file utils are not loaded.");
  const { createManagedFileRuntimeController } = managedFileUtils;
  let managedFileRuntimeController = null;

  const storageUtils = window.ZETER_STORAGE_UTILS;
  if (!storageUtils) throw new Error("ZeTer OS storage utils are not loaded.");
  const {
    createStorageRuntimeState,
    buildSmallSettingsSnapshot: buildSmallSettingsSnapshotFromStorage,
    openIndexedDb,
    transactionDone,
    readIndexedDbRecord,
    putIndexedDbRecord,
    getAllIndexedDbRecords,
    clearIndexedDbStore,
    deleteIndexedDatabaseByName,
    readLegacyLocalStorageState: readLegacyLocalStorageStateFromStorage,
    writeSmallSettingsToLocalStorage: writeSmallSettingsToLocalStorageFromStorage,
    removeLegacyFullStateFromLocalStorage: removeLegacyFullStateFromLocalStorageFromStorage,
    saveFullStateToLocalStorageFallback: saveFullStateToLocalStorageFallbackFromStorage,
    createPrimaryStateSaveQueue,
    createStorageStateRuntimeController,
    clearLegacyLocalStorageData: clearLegacyLocalStorageDataCore,
    clearOldIndexedDbData: clearOldIndexedDbDataCore,
    clearOldPwaCaches: clearOldPwaCachesCore
  } = storageUtils;
  const storageRuntime = createStorageRuntimeState();

  const assetUtils = window.ZETER_ASSET_UTILS;
  if (!assetUtils) throw new Error("ZeTer OS asset utils are not loaded.");
  const {
    EXTERNAL_ASSET_ROOT,
    EXTERNAL_IMAGE_ROOT,
    EXTERNAL_WALLPAPER_ROOT,
    EXTERNAL_DESKTOP_ICON_ROOT,
    cloneForBackup,
    isDataImage,
    parseDataUrl,
    mimeToExtension,
    sanitizePathPart,
    dataUrlByteLength,
    dataUrlWithMime,
    createZipBlob,
    buildExternalBackupStateModel,
    createExternalAssetIoController
  } = assetUtils;

  const securityProtectionUtils = window.ZETER_SECURITY_PROTECTION_UTILS;
  if (!securityProtectionUtils) throw new Error("ZeTer OS security protection utils are not loaded.");
  const {
    verifyBackupBlob,
    encryptBackupBlob,
    decryptBackupBlob,
    recordSecurityEvent
  } = securityProtectionUtils;

  const visualUtils = window.ZETER_VISUAL_UTILS;
  if (!visualUtils) throw new Error("ZeTer OS visual utils are not loaded.");
  const {
    baseDesktopSettings,
    normalizeDesktopIcon,
    defaultDesktopDescription,
    normalizeDesktopRecord,
    normalizeCustomWallpaper,
    collectVisualSettingsHolders,
    customWallpaperCssUrl,
    normalizeVisualSettings,
    nextWallpaperValue,
    createCustomWallpaperFromFile,
    createDesktopIconFromFile
  } = visualUtils;

  const itemCustomizationUtils = window.ZETER_ITEM_CUSTOMIZATION_UTILS;
  if (!itemCustomizationUtils) throw new Error("ZeTer OS item customization utils are not loaded.");
  const {
    folderBackgroundDataURL,
    itemSettingsTitle,
    createItemSettingsApp
  } = itemCustomizationUtils;

  const desktopProfileUtils = window.ZETER_DESKTOP_PROFILE_UTILS;
  if (!desktopProfileUtils) throw new Error("ZeTer OS desktop profile utils are not loaded.");
  const {
    desktopRecordById: desktopRecordByIdFromList,
    desktopName: desktopNameFromList,
    desktopDescription: desktopDescriptionFromList,
    desktopIconData: desktopIconDataFromList,
    desktopAvatarHTML: desktopAvatarHTMLFromList
  } = desktopProfileUtils;

  const desktopUiUtils = window.ZETER_DESKTOP_UI_UTILS;
  if (!desktopUiUtils) throw new Error("ZeTer OS desktop UI utils are not loaded.");
  const {
    createDesktopSurfaceController,
    createDesktopItemRuntimeController
  } = desktopUiUtils;

  const startUiUtils = window.ZETER_START_UI_UTILS;
  if (!startUiUtils) throw new Error("ZeTer OS start UI utils are not loaded.");
  const {
    createStartMenuController
  } = startUiUtils;

  const fileImportUtils = window.ZETER_FILE_IMPORT_UTILS;
  if (!fileImportUtils) throw new Error("ZeTer OS file import utils are not loaded.");
  const {
    nativeImportSkippedSummary,
    importNativeFilesBatch
  } = fileImportUtils;

  const fileTemplateUtils = window.ZETER_FILE_TEMPLATE_UTILS;
  if (!fileTemplateUtils) throw new Error("ZeTer OS file template utils are not loaded.");
  const {
    starterContentForExtension
  } = fileTemplateUtils;

  const richTextUtils = window.ZETER_RICH_TEXT_UTILS;
  if (!richTextUtils) throw new Error("ZeTer OS rich text utils are not loaded.");
  const {
    plainToRichHtml,
    cleanRichHtml,
    htmlPlainText
  } = richTextUtils;

  const editorUiUtils = window.ZETER_EDITOR_UI_UTILS;
  if (!editorUiUtils) throw new Error("ZeTer OS editor UI utils are not loaded.");
  const {
    createDocumentEditorRuntimeController
  } = editorUiUtils;

  const importUtils = window.ZETER_IMPORT_UTILS;
  if (!importUtils) throw new Error("ZeTer OS import utils are not loaded.");
  const {
    createExternalAssetImportController,
    runOsImportAction
  } = importUtils;

  const stateImportValidator = window.ZETER_STATE_IMPORT_VALIDATOR;
  if (!stateImportValidator) throw new Error("ZeTer OS state import validator is not loaded.");
  const {
    validateImportedStateForImport
  } = stateImportValidator;

  const exportUtils = window.ZETER_EXPORT_UTILS;
  if (!exportUtils) throw new Error("ZeTer OS export utils are not loaded.");
  const {
    sanitizeExportPathPart,
    stripKnownExtension,
    createExternalBackupRuntimeController,
    runDownloadBackupAction
  } = exportUtils;

  const downloadUtils = window.ZETER_DOWNLOAD_UTILS;
  if (!downloadUtils) throw new Error("ZeTer OS download utils are not loaded.");
  const {
    downloadBlob,
    downloadFile,
    downloadDataUrl
  } = downloadUtils;

  const securityUtils = window.ZETER_SECURITY_UTILS;
  if (!securityUtils) throw new Error("ZeTer OS security utils are not loaded.");
  const {
    normalizeSecurityMeta,
    securityBackupFileName,
    formatSecurityTime
  } = securityUtils;

  const securityUiUtils = window.ZETER_SECURITY_UI_UTILS;
  if (!securityUiUtils) throw new Error("ZeTer OS security UI utils are not loaded.");
  const {
    createSecurityRuntimeController
  } = securityUiUtils;

  const readableExportUtils = window.ZETER_READABLE_EXPORT_UTILS;
  if (!readableExportUtils) throw new Error("ZeTer OS readable export utils are not loaded.");
  const {
    createReadableExportRuntimeController,
    buildDocxForNote
  } = readableExportUtils;

  const tableUtils = window.ZETER_TABLE_UTILS;
  if (!tableUtils) throw new Error("ZeTer OS table utils are not loaded.");
  const {
    spreadsheetColumnName,
    ensureTableFileName,
    makeDefaultTableData,
    normalizeTableData,
    activeTablePage,
    parseCSVRows,
    tableToCSV,
    normalizeTablesData
  } = tableUtils;

  const tableAppInteractions = window.ZETER_TABLE_APP_INTERACTIONS;
  if (!tableAppInteractions) throw new Error("ZeTer OS table app interactions are not loaded.");
  const {
    createTableAppRuntimeController
  } = tableAppInteractions;

  const calculatorUtils = window.ZETER_CALCULATOR_UTILS;
  if (!calculatorUtils) throw new Error("ZeTer OS calculator utils are not loaded.");
  const {
    calculateNextExpression
  } = calculatorUtils;

  const calculatorUiUtils = window.ZETER_CALCULATOR_UI_UTILS;
  if (!calculatorUiUtils) throw new Error("ZeTer OS calculator UI utils are not loaded.");
  const {
    calculatorAppElement
  } = calculatorUiUtils;

  const searchUtils = window.ZETER_SEARCH_UTILS;
  if (!searchUtils) throw new Error("ZeTer OS search utils are not loaded.");
  const {
    normalizeSearchSettings,
    searchMatch,
    findTableSearchHit
  } = searchUtils;

  const searchUiUtils = window.ZETER_SEARCH_UI_UTILS;
  if (!searchUiUtils) throw new Error("ZeTer OS search UI utils are not loaded.");
  const {
    createSearchResultNavigator,
    createSearchController,
    createGlobalSearchOverlayController,
    highlightRichEditorSearch,
    selectTextareaSearch,
    applyTableSearchHighlight
  } = searchUiUtils;

  const initialStateUtils = window.ZETER_INITIAL_STATE_UTILS;
  if (!initialStateUtils) throw new Error("ZeTer OS initial state utils are not loaded.");
  const {
    defaultState: createDefaultState
  } = initialStateUtils;

  const stateMigrationUtils = window.ZETER_STATE_MIGRATION_UTILS;
  if (!stateMigrationUtils) throw new Error("ZeTer OS state migration utils are not loaded.");
  const {
    migrateState: migrateStateWithRuntime
  } = stateMigrationUtils;

  const appCatalog = window.ZETER_APP_CATALOG;
  if (!appCatalog) throw new Error("ZeTer OS app catalog is not loaded.");
  const {
    buildAppRegistry
  } = appCatalog;

  const itemMetadata = window.ZETER_ITEM_METADATA;
  if (!itemMetadata) throw new Error("ZeTer OS item metadata is not loaded.");
  const {
    itemIconForApps,
    startItemKind
  } = itemMetadata;

  const itemPropertiesUiUtils = window.ZETER_ITEM_PROPERTIES_UI_UTILS;
  if (!itemPropertiesUiUtils) throw new Error("ZeTer OS item properties UI utils are not loaded.");
  const {
    itemPropertiesText
  } = itemPropertiesUiUtils;

  const fsItemUtils = window.ZETER_FS_ITEM_UTILS;
  if (!fsItemUtils) throw new Error("ZeTer OS fs item utils are not loaded.");
  const {
    descendantIds: descendantIdsInFs,
    applyFsItemPosition,
    itemDescription: itemDescriptionFromFs,
    createFsItemController
  } = fsItemUtils;

  const explorerUtils = window.ZETER_EXPLORER_UTILS;
  if (!explorerUtils) throw new Error("ZeTer OS explorer utils are not loaded.");
  const {
    explorerFlowLayout,
    sortExplorerItems,
    explorerSearchGridPosition,
    explorerCardMeta,
    explorerGridMinSize,
    canMoveExplorerItemIntoFolder,
    explorerSingleMovePlanForFs,
    applyExplorerSingleMovePlan,
    sanitizeExplorerSpaces: sanitizeExplorerSpacesInTarget,
    createExplorerRuntimeController
  } = explorerUtils;

  const helpContent = window.ZETER_HELP_CONTENT;
  if (!helpContent) throw new Error("ZeTer OS help content is not loaded.");
  const {
    helpAppElement
  } = helpContent;

  const monitorUtils = window.ZETER_MONITOR_UTILS;
  if (!monitorUtils) throw new Error("ZeTer OS monitor utils are not loaded.");
  const {
    monitorAlerts,
    monitorAppHTML,
    securityStorageMetersHTML,
    securityKvRowsHTML,
    percent,
    createMonitorRuntime,
    tickMonitorFps,
    tickMonitorLag,
    readMonitorAsyncMetrics,
    monitorDeviceModel,
    monitorNetworkModel,
    monitorVisibleItems,
    monitorImportedBytes,
    monitorLastChangedAt,
    monitorOverviewModel,
    monitorResourcesModel,
    monitorStorageModel
  } = monitorUtils;

  const photoUiUtils = window.ZETER_PHOTO_UI_UTILS;
  if (!photoUiUtils) throw new Error("ZeTer OS photo UI utils are not loaded.");
  const {
    galleryAppElement
  } = photoUiUtils;

  const settingsUiUtils = window.ZETER_SETTINGS_UI_UTILS;
  if (!settingsUiUtils) throw new Error("ZeTer OS settings UI utils are not loaded.");
  const {
    settingsAppElement
  } = settingsUiUtils;

  const appCenterUiUtils = window.ZETER_APP_CENTER_UI_UTILS;
  if (!appCenterUiUtils) throw new Error("ZeTer OS app center UI utils are not loaded.");
  const {
    appCenterAppElement,
    createAppShortcutController
  } = appCenterUiUtils;

  const desktopItemRuntimeController = createDesktopItemRuntimeController({
    getState: () => state,
    getRuntimeUi: () => ui,
    getApps: () => apps,
    getDesktopRoot,
    isDesktopRoot,
    isExplorerRoot: folderId => isExplorerRoot(folderId),
    getExplorerRoot: () => getExplorerRoot(),
    currentWorkspace,
    trashRoot: TRASH_ROOT,
    createId: uid,
    uniqueName,
    openApp,
    toast,
    saveState,
    renderDesktop,
    renderFileSurfaces: renderAllFileSurfaces,
    refreshNotesWindows,
    refreshOpenEditors,
    itemIcon,
    openManagedFile: file => openManagedFile(file),
    openShortcut: item => openShortcutItem(item),
    openExternalLink: target => openExternalTarget(target),
    moveManagedFileAtPoint: (...args) => managedFileRuntimeController?.moveManagedFileAtPoint(...args),
    markManagedFileTarget: (...args) => managedFileRuntimeController?.markManagedFileTarget(...args),
    clearManagedFileTarget: () => managedFileRuntimeController?.clearManagedFileTarget(),
    plainToRichHtml,
    cleanRichHtml,
    documentRef: document,
    windowRef: window,
    positionInFolderGrid: (...args) => positionInFolderGrid(...args),
    applyItemPosition: applyFsItemPosition,
    canMoveIntoFolder: canMoveExplorerItemIntoFolder,
    createMovePlan: explorerSingleMovePlanForFs,
    applyMovePlan: applyExplorerSingleMovePlan,
    findFreeFolderPosition: (...args) => findFreeFolderPosition(...args),
    bulkMoveItemsToFolder: (...args) => bulkMoveItemsToFolder(...args),
    canPinToStart: canPinItemToStart,
    itemTaskbarAppId,
    isTaskbarPinned: isTaskbarPinnedApp,
    showContext,
    createFolder: createFolderInFolder,
    createFile: createFileInFolder,
    createShortcut: openShortcutEditor,
    createTable: createTableInFolder,
    createTaskList: createTaskListInFolder,
    createItem,
    undo: undoLastAction,
    exportData: exportOS,
    openImport: () => $("#import-file").click(),
    itemActions: {
      rename: renameItem,
      duplicate: duplicateItem,
      setStartPinned: setStartItemPinned,
      setTaskbarPinned: setTaskbarAppPinned,
      settings: openItemSettings,
      copyLocation: copyItemLocation,
      properties: showItemProperties,
      delete: deleteItem
    }
  });
  const {
    desktopRootOf,
    itemInWorkspace,
    workspaceItems,
    clampDesktopPosition,
    clientToDesktopPosition,
    findFreeDesktopPosition,
    addDesktopShortcut,
    openItem,
    renderDesktopStickies,
    canMoveInto,
    enableItemPointerDrag,
    enableDesktopItemPointerDrag,
    showDesktopMenu,
    showItemMenu
  } = desktopItemRuntimeController;

  const documentEditorRuntimeController = createDocumentEditorRuntimeController({
    getState: () => state,
    getDesktopRoot,
    createItem,
    saveState,
    renderFileSurfaces: renderAllFileSurfaces,
    refreshWindowTitle,
    debounce,
    highlightSearch: highlightRichEditorSearch,
    openApp,
    openItem,
    duplicateItem,
    downloadFile,
    downloadBlob,
    buildNoteDocx: buildDocxForNote,
    sanitizeExportPathPart,
    stripKnownExtension,
    toast,
    openExternalLink: target => openExternalTarget(target),
    documentRef: document,
    itemInWorkspace,
    getWindowRecord: winId => ui.windows.get(winId),
    persistOpenWindows: persistOpenWindowsForCurrentDesktop,
    refreshWindow,
    itemIcon,
    showItemMenu,
    enableItemPointerDrag,
    createFolderInFolder,
    prompt,
    desktopRootOf,
    desktopName,
    isDesktopRoot,
    workspaceItems,
    selectSearch: selectTextareaSearch
  });

  const tableAppRuntimeController = createTableAppRuntimeController({
    getState: () => state,
    getDesktopRoot,
    createItem,
    debounce,
    findSearchHit: findTableSearchHit,
    applySearchHighlight: applyTableSearchHighlight,
    saveState,
    renderFileSurfaces: renderAllFileSurfaces,
    refreshWindowTitle,
    toast,
    prompt,
    confirm,
    downloadBlob,
    openExternalLink: target => openExternalTarget(target),
    documentRef: document
  });

  const securityRuntimeController = createSecurityRuntimeController({
    getState: () => state,
    currentWorkspace,
    shouldUseNativeStorage,
    supportsExternalFolderSave,
    getExternalDirectoryHandle: () => externalDirectoryHandle,
    nativeStorageCall,
    storedStateSizeBytes,
    storageRuntime,
    storageWarningRatio: STORAGE_WARNING_RATIO,
    storageWarningCooldownMs: STORAGE_WARNING_COOLDOWN_MS,
    storageCheckDebounceMs: STORAGE_CHECK_DEBOUNCE_MS,
    byteSize,
    readSmallSettings: () => localStorage.getItem(SMALL_SETTINGS_KEY) || "",
    readLegacyState: () => localStorage.getItem(STORAGE_KEY),
    getStorageEstimate: () => navigator.storage?.estimate ? navigator.storage.estimate() : null,
    percent,
    readPrimaryStateRecord,
    saveState,
    confirmUser: confirm,
    promptUser: prompt,
    purgeDeletedItemsFromStorageState,
    purgeExpiredTrashItems: purgeExpiredTrashItemsFromTarget,
    clearLegacyLocalStorageDataCore,
    oldLocalStorageKeys: OLD_LOCAL_STORAGE_KEYS,
    smallSettingsKey: SMALL_SETTINGS_KEY,
    storageKey: STORAGE_KEY,
    clearOldIndexedDbDataCore,
    oldRestoreDbNames: OLD_RESTORE_DB_NAMES,
    externalDbName: EXTERNAL_DB,
    primaryStateDbName: PRIMARY_STATE_DB,
    deleteIndexedDatabaseByName,
    clearOldPwaCachesCore,
    activeCacheName: ACTIVE_CACHE_NAME,
    refreshRecycleBinWindows,
    localStorageRef: localStorage,
    indexedDbAvailable: () => Boolean(window.indexedDB),
    clearNativeState: () => nativeStorageCall("clear_state"),
    clearExternalRuntimeState: () => externalBackupRuntimeController?.clearRuntimeState(),
    clearIndexedDbStore,
    externalStoreName: EXTERNAL_STORE,
    clearNativeRestorePoints: () => nativeStorageCall("clear_restore_points"),
    restoreDbName: RESTORE_DB,
    restoreStoreName: RESTORE_STORE,
    openIndexedDb,
    transactionDone,
    readIndexedDbRecord,
    getAllIndexedDbRecords,
    loadNativeRestorePoints: () => nativeStorageCall("load_restore_points"),
    preflightNativeRestorePoint: pointId => nativeStorageCall("preflight_restore_point", pointId),
    saveNativeRestorePoint: point => nativeStorageCall("save_restore_point", point),
    deleteNativeRestorePoint: pointId => nativeStorageCall("delete_restore_point", pointId),
    cleanupNativeArtifacts: payload => nativeStorageCall("cleanup_security_artifacts", payload),
    syncLiveEditorsBeforeExport,
    cloneForBackup,
    defaultState,
    osVersion: OS_VERSION,
    replaceStateFromRestore: restoredState => {
      Object.keys(state).forEach(key => delete state[key]);
      Object.assign(state, migrate(cloneForBackup(restoredState)));
    },
    reload: () => location.reload(),
    trashRoot: TRASH_ROOT,
    isDesktopRoot,
    getDesktopRoot,
    uid,
    todayISO,
    normalizeTaskStore: (...args) => normalizeTaskStore(...args),
    normalizeCalendarStore: (...args) => normalizeCalendarStore(...args),
    normalizeNotificationStore: (...args) => normalizeNotificationStore(...args),
    renderAllFileSurfaces,
    toast,
    documentRef: document,
    refreshWindow,
    formatSecurityTime,
    bytesToHuman,
    restoreLimit: RESTORE_LIMIT,
    browserPersistenceAvailable: () => Boolean(navigator.storage?.persisted),
    securityStorageMetersHTML,
    securityKvRowsHTML,
    exportBackup: options => exportOS({ source: "security", ...(options || {}) }),
    buildBackupForState: target => buildDownloadOsDataZip(target),
    verifyBackup: verifyBackupBlob,
    encryptBackup: encryptBackupBlob,
    downloadBlob,
    backupFileName: securityBackupFileName,
    validateImportedState: validateImportedStateForImport,
    openImport: () => $("#import-file")?.click(),
    chooseExternalSaveFolder,
    openReadableFolder: () => nativeStorageCall("open_readable_folder"),
    writeExternalBackup: () => writeExternalBackup("manual")
  });

  const apps = buildAppRegistry({
    renderers: {
      explorer: renderExplorer,
      editor: documentEditorRuntimeController.renderRichEditorApp,
      notes: documentEditorRuntimeController.renderNotesApp,
      markdown: documentEditorRuntimeController.renderMarkdownApp,
      table: tableAppRuntimeController.renderTableApp,
      tasks: renderTasksApp,
      taskEditor: renderTaskEditorApp,
      calendar: renderCalendarApp,
      calendarEventEditor: renderCalendarEventEditorApp,
      shortcutEditor: renderShortcutEditorApp,
      itemSettings: renderItemSettingsApp,
      calculator: renderCalculatorApp,
      photos: renderPhotosApp,
      settings: renderSettingsApp,
      security: securityRuntimeController.renderSecurityCenterApp,
      monitor: renderMonitorApp,
      appcenter: renderAppCenter,
      help: renderHelpApp,
      search: renderSearchApp
    },
    titleResolvers: {
      folder: params => state.fs?.[params?.folderId]?.name || (isDesktopRoot(params?.folderId) ? "Рабочий стол" : "Папка"),
      table: params => state.fs?.[params?.itemId]?.name || "Таблица",
      taskWindow: params => taskWindowTitleFromParams(params),
      taskEditor: params => params?.mode === "create" ? "Добавление задачи" : "Редактирование задачи",
      calendarEventEditor: params => params?.mode === "edit" ? "Редактирование события" : "Добавление события",
      shortcutEditor: () => "Создание ярлыка",
      itemSettings: params => itemSettingsTitle(state.fs?.[params?.itemId])
    }
  });

  function canPinAppToTaskbar(appId) {
    return canPinAppToTaskbarForApps(apps, appId);
  }

  function itemTaskbarAppId(item) {
    return itemTaskbarAppIdForApps(item, apps);
  }

  function normalizeStartPinnedState(target = state) {
    return normalizeStartPinnedStateForTarget(target);
  }

  function normalizeTaskbarPinnedApps(list = []) {
    return normalizeTaskbarPinnedAppsForApps(list, apps);
  }

  const dataNormalizers = window.ZETER_DATA_NORMALIZERS;
  if (!dataNormalizers) throw new Error("ZeTer OS data normalizers are not loaded.");
  const {
    DEFAULT_TASK_PROJECT_NAME,
    TASK_REMINDER_CHECK_MS,
    taskWindowTitleFromName,
    taskDateTimeInputValue,
    normalizeTaskReminderValue,
    taskReminderTime,
    taskReminderLabel,
    taskDescriptionPreview,
    priorityName,
    statusName,
    normalizeTaskReminderRepeatDays,
    taskReminderRepeatLabel,
    nextTaskReminderValue,
    taskProjectTitle,
    defaultTaskReminderValue,
    makeTaskProject,
    makeTask,
    updateTaskTitleDescription,
    updateTaskPriority,
    updateTaskChecklistItem,
    toggleTaskPinned,
    setTaskIndefinite,
    setTaskReminder,
    clearTaskReminder,
    normalizeTaskStore,
    normalizeTaskListsData,
    normalizeCalendarEvent,
    normalizeCalendarEvents,
    normalizeCalendarStore,
    normalizeNotificationRecord,
    normalizeNotifications,
    normalizeNotificationStore
  } = dataNormalizers;

  const workspaceUtils = window.ZETER_WORKSPACE_UTILS;
  if (!workspaceUtils) throw new Error("ZeTer OS workspace utils are not loaded.");
  const {
    workspaceDataForDesktopId: workspaceDataForDesktopIdFromState,
    syncLegacyWorkspaceAliases,
    createWorkspaceRuntimeController,
    createVirtualDesktopController
  } = workspaceUtils;

  const stateMaintenanceUtils = window.ZETER_STATE_MAINTENANCE_UTILS;
  if (!stateMaintenanceUtils) throw new Error("ZeTer OS state maintenance utils are not loaded.");
  const {
    ensureSystemAppShortcut: ensureSystemAppShortcutForState,
    removeExplorerAppShortcutsFromState: removeExplorerAppShortcutsFromTarget,
    removeWorkspaceDocumentsFoldersFromState: removeWorkspaceDocumentsFoldersFromTarget,
    expandItemIdsInTarget: expandItemIdsInTargetForState,
    pushActionHistory: pushActionHistoryForTarget,
    pruneTargetReferencesForRemovedItems: pruneTargetReferencesForRemovedItemsForState,
    purgeDeletedItemsFromStorageState: purgeDeletedItemsFromStorageTarget,
    rememberDeletedIdsForNativePurge: rememberDeletedIdsForNativePurgeInTarget,
    normalizeNotesData: normalizeNotesDataForTarget,
    createRemovedItemReferencesController
  } = stateMaintenanceUtils;

  const taskAppUiUtils = window.ZETER_TASK_APP_UI_UTILS;
  if (!taskAppUiUtils) throw new Error("ZeTer OS task app UI utils are not loaded.");
  const {
    createTaskTargetNavigator,
    createTaskAppRuntimeController
  } = taskAppUiUtils;

  const taskAppRuntimeController = createTaskAppRuntimeController({
    getState: () => state,
    currentWorkspace,
    normalizeTaskStoreValue: normalizeTaskStore,
    desktopName,
    getDesktopRoot,
    documentRef: document,
    getUi: () => ui,
    getApps: () => apps,
    windowBodyEl,
    saveState,
    renderAllFileSurfaces,
    renderStart,
    refreshWindowTitle,
    taskWindowTitleFromParams,
    toast,
    openApp,
    scheduleTaskReminderCheck,
    downloadFile,
    todayISO,
    formatDate,
    promptUser: prompt,
    confirmUser: confirm,
    closeWindow
  });

  const calendarUtils = window.ZETER_CALENDAR_UTILS;
  if (!calendarUtils) throw new Error("ZeTer OS calendar utils are not loaded.");
  const {
    occursOn,
    categoryName,
    calendarEventsForDate
  } = calendarUtils;

  const calendarUiUtils = window.ZETER_CALENDAR_UI_UTILS;
  if (!calendarUiUtils) throw new Error("ZeTer OS calendar UI utils are not loaded.");
  const {
    createCalendarApp,
    createCalendarEventEditorApp
  } = calendarUiUtils;

  const notificationUtils = window.ZETER_NOTIFICATION_UTILS;
  if (!notificationUtils) throw new Error("ZeTer OS notification utils are not loaded.");
  const {
    notificationFilterKind,
    createTaskReminderWatcher,
    createCalendarReminderWatcher
  } = notificationUtils;

  const notificationUiUtils = window.ZETER_NOTIFICATION_UI_UTILS;
  if (!notificationUiUtils) throw new Error("ZeTer OS notification UI utils are not loaded.");
  const {
    createNotificationCenterController,
    bindNotificationCenter,
    createTaskNotificationController
  } = notificationUiUtils;

  function taskWindowTitleFromParams(params = {}) {
    const taskListName = params?.itemId ? state.fs?.[params.itemId]?.name : "";
    const shortcutName = params?.shortcutItemId ? state.fs?.[params.shortcutItemId]?.name : "";
    return taskWindowTitleFromName(taskListName || shortcutName);
  }

  let state = defaultState();
  const ui = {
    z: 100,
    windows: new Map(),
    activeWindow: null,
    restoringWindows: false,
    explorerFolders: new Map(),
    selectedDesktop: null,
    multiSelected: new Set(),
    selectionDrag: null,
    notificationFilter: "all",
    drag: null,
    calendar: { view: "month", date: todayISO(), selected: todayISO(), editing: null },
    taskFilter: { q: "", priority: "all", tag: "all" },
    taskFocusTarget: null,
    currentPath: "desktop",
    startShowAll: false,
    stickyZ: 3600
  };

  const workspaceRuntimeController = createWorkspaceRuntimeController({
    getState: () => state,
    ensureWorkspaceExplorerRoot: desktopId => ensureWorkspaceExplorerRoot(desktopId),
    getExplorerRoot: () => getExplorerRoot(),
    createWorkspaceSystemFolders: rootId => createWorkspaceSystemFolders(rootId),
    sanitizeExplorerSpacesInState: sanitizeExplorerSpacesInTarget,
    getApps: () => apps,
    desktopRecordById: desktopRecordByIdFromList,
    desktopName: desktopNameFromList,
    desktopDescription: desktopDescriptionFromList,
    desktopIconData: desktopIconDataFromList,
    desktopAvatarHTML: desktopAvatarHTMLFromList
  });

  const windowRuntimeController = createWindowRuntimeController({
    getWindows: () => ui.windows,
    getExplorerFolders: () => ui.explorerFolders,
    getActiveWindow: () => ui.activeWindow,
    setActiveWindow: winId => { ui.activeWindow = winId; },
    nextZ: () => ++ui.z,
    getApps: () => apps,
    clearDesktopSelection,
    getRestoringWindows: () => ui.restoringWindows,
    setRestoringWindows: restoring => { ui.restoringWindows = restoring; },
    getDesktopRoot,
    getCurrentWorkspace: currentWorkspace,
    getOpenWindows: deskOpenWindows,
    saveState,
    renderDesktop,
    syncLiveEditors: syncLiveEditorsBeforeExport,
    maxWindows: OPEN_WINDOWS_MAX,
    createRunningTaskbarButton,
    showRunningTaskbarWindowMenu,
    buildSnapMenuEntries,
    showContext,
    getSnapOverlay: () => $("#snap-overlay"),
    getTaskbarApps: () => $("#taskbar-apps"),
    getWindowLayer: () => $("#window-layer") || $("#windows"),
    getWindowTemplate: () => $("#window-template"),
    createId: uid,
    isExplorerBlankTab,
    getItem: itemId => state.fs[itemId],
    isDesktopRoot,
    itemInWorkspace,
    prepareExplorerOpenParams: (...args) => prepareExplorerOpenParams(...args),
    toast,
    onOpenError: (appId, params, error) => console.error("[ZeTer OS openApp]", appId, params, error)
  });

  const taskbarController = createTaskbarController({
    getState: () => state,
    getApps: () => apps,
    getWindows: () => ui.windows,
    saveState,
    renderStart,
    openByDataApp,
    showContextNearElement,
    focusWindow,
    closeWindow,
    closeFloating,
    toast,
    normalizeTaskbarPinnedApps,
    canPinAppToTaskbar,
    lockedTaskbarItems: LOCKED_TASKBAR_ITEMS,
    staticTaskbarAppIds: STATIC_TASKBAR_APP_IDS,
    buildLockedTaskbarMenuEntries,
    buildTaskbarPinnedAppMenuEntries,
    buildRunningTaskbarWindowMenuEntries,
    buildStartAppContextMenuEntries
  });

  const startMenuController = createStartMenuController({
    getState: () => state,
    getApps: () => apps,
    getShowAll: () => ui.startShowAll,
    setShowAll: showAll => { ui.startShowAll = showAll; },
    saveState,
    toast,
    canPinItem: canPinItemToStart,
    itemKind: startItemKind,
    itemIcon,
    itemDescription,
    closeFloating,
    openApp,
    showAppMenu: showStartAppMenu,
    openItem,
    buildItemMenuEntries: buildStartItemContextMenuEntries,
    showContextNearElement,
    ensureDesktops,
    getCurrentDesktopId: () => state.currentDesktop,
    itemCount: desktopId => workspaceItems(desktopId).length,
    desktopAvatarHTML,
    desktopName,
    desktopDescription,
    switchDesktop: switchVirtualDesktop,
    deleteDesktop: deleteVirtualDesktop,
    createDesktop: createVirtualDesktop
  });

  const removedItemReferencesController = createRemovedItemReferencesController({
    getState: () => state,
    getWindows: () => ui.windows,
    getExplorerFolders: () => ui.explorerFolders,
    getApps: () => apps,
    getActiveWindow: () => ui.activeWindow,
    setActiveWindow: winId => { ui.activeWindow = winId; },
    ensureDesktops,
    workspaceDefaults,
    itemTaskbarAppId,
    normalizeTaskbarPinnedApps,
    taskbarPinnedApps,
    removeTaskbarButton: winId => $(`.taskbar-app[data-win-id="${cssEscape(winId)}"]`)?.remove()
  });

  const explorerRuntimeController = createExplorerRuntimeController({
    getState: () => state,
    getDesktopRoot,
    ensureDesktops,
    currentDesktopRecord,
    workspaceDefaults,
    createId: uid,
    uniqueName,
    isDesktopRoot,
    currentWorkspace,
    workspaceItems,
    renderTreeHTML: explorerTreeHTML,
    renderPinnedHTML: explorerPinnedHTML,
    itemIcon,
    saveState,
    renderFileSurfaces: renderAllFileSurfaces,
    toast,
    findFreeFolderPositionForItems,
    positionInFolderGridForItems,
    viewportSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
    tabUtils: explorerTabUtils,
    serializableParams,
    itemInWorkspace,
    getWindowRecord: winId => ui.windows.get(winId),
    refreshWindow,
    persistOpenWindows: persistOpenWindowsForCurrentDesktop,
    desktopRootOf,
    safeAttr,
    escapeHtml,
    descendantsForId: descendants,
    itemDescription,
    searchMatch,
    canMoveInto,
    createZipBlob,
    downloadBlob,
    todayISO,
    logDownloadError: err => console.error("[ZeTer OS explorer download]", err),
    itemKind: startItemKind,
    formatBytes: bytesToHuman,
    previewHTMLFromModel: explorerPreviewHTMLFromModel,
    previewRenderers: {
      empty: explorerPreviewEmptyHTML,
      multi: explorerPreviewMultiHTML,
      image: explorerPreviewImageBodyHTML,
      folder: explorerPreviewFolderBodyHTML,
      table: explorerPreviewTableBodyHTML,
      tasklist: explorerPreviewTasklistBodyHTML,
      text: explorerPreviewTextBodyHTML,
      single: explorerPreviewSingleHTML
    }
  });
  const {
    ensureWorkspaceExplorerRoot,
    getExplorerRoot,
    isExplorerRoot,
    folderRootContext,
    isInExplorerSpace,
    createWorkspaceSystemFolders,
    expandedExplorerSet,
    saveExpandedExplorerSet,
    renderExplorerTree,
    renderPinnedExplorer,
    togglePinnedItem,
    removeFolderReferences,
    findFreeFolderPosition,
    positionInFolderGrid,
    explorerFolderIdForTab,
    prepareExplorerOpenParams,
    persistExplorerTabsForAnchor,
    navigateFolderWindow,
    normalizeExplorerTabs,
    explorerFolderTitle,
    explorerBaseRootForFolder,
    explorerAddressText,
    explorerPathText,
    resolveExplorerAddress,
    explorerItemSize,
    explorerSearchableItems,
    explorerResultLocationText,
    explorerFolderMoveTargets,
    bulkMoveItemsToFolder,
    downloadExplorerItems,
    explorerPreviewHTML
  } = explorerRuntimeController;

  const readableExportRuntimeController = createReadableExportRuntimeController({
    getState: () => state,
    ensureDesktops,
    isDesktopRoot,
    isExplorerRoot,
    desktopName,
    desktopDescription,
    collectVisualSettingsHolders,
    normalizeCustomWallpaper,
    normalizeDesktopIcon,
    normalizeTaskStore,
    workspaceDefaults,
    normalizeTableData,
    activeTablePage,
    plainToRichHtml,
    cleanRichHtml,
    getWindows: () => ui.windows,
    getStickyCards: () => $$(".desktop-sticky"),
    getItem: itemId => state.fs[itemId],
    query: $,
    saveState,
    trashRoot: TRASH_ROOT
  });

  const fsItemController = createFsItemController({
    getState: () => state,
    getDesktopRoot,
    isDesktopRoot,
    createId: uid,
    clientToDesktopPosition,
    findFreeDesktopPosition,
    findFreeFolderPosition,
    saveState,
    renderAllFileSurfaces,
    toast,
    prompt: (message, defaultValue) => prompt(message, defaultValue),
    desktopName,
    trashRoot: TRASH_ROOT,
    normalizeTaskStore,
    refreshOpenEditors,
    refreshOpenTaskListTitles,
    refreshOpenTaskShortcutTitles,
    itemKind: startItemKind,
    itemSize: item => item.managedFile ? bytesToHuman(Number(item.managedFile.size) || 0) : item.dataURL ? bytesToHuman(dataUrlByteLength(item.dataURL)) : bytesToHuman(new Blob([JSON.stringify(item)]).size),
    itemPropertiesText,
    alert: message => alert(message),
    starterContentForExtension,
    plainToRichHtml,
    openItem,
    ensureTableFileName,
    makeDefaultTableData,
    tableToCSV,
    makeTaskProject,
    defaultTaskProjectName: DEFAULT_TASK_PROJECT_NAME
  });

  const trashActionController = createTrashActionController({
    getState: () => state,
    cloneState: cloneForBackup,
    replaceState: restoredState => {
      Object.keys(state).forEach(key => delete state[key]);
      Object.assign(state, restoredState);
    },
    isDesktopRoot,
    getDesktopRoot,
    expandItemIdsInTarget,
    cleanupRemovedItemReferences,
    pruneTargetReferencesForRemovedItems,
    pushActionHistory: action => pushActionHistoryForTarget(state, action),
    normalizeStartPinnedState,
    descendantIds: descendants,
    uniqueName,
    saveState,
    renderAllFileSurfaces,
    refreshRecycleBinWindows,
    toast,
    confirm: message => confirm(message),
    rememberDeletedIdsForNativePurge,
    clearSelection: () => {
      ui.selectedDesktop = null;
      ui.multiSelected?.clear();
    }
  });

  managedFileRuntimeController = createManagedFileRuntimeController({
    getState: () => state,
    getDesktopRoot,
    isDesktopRoot,
    desktopName,
    createItem,
    saveState,
    renderFileSurfaces: renderAllFileSurfaces,
    refreshHostWindows: itemId => {
      ui.windows.forEach((record, winId) => {
        if (record?.params?.itemId === itemId && ["editor", "table"].includes(record.appId)) refreshWindow(winId);
      });
    },
    syncOpenEditors: syncLiveEditorsBeforeExport,
    cleanupRemovedItemReferences,
    nativeStorageCall,
    openShortcutTarget: (target, name) => openShortcutTarget(target, name),
    nativeMode: shouldUseNativeStorage,
    toast,
    confirm: message => confirm(message),
    documentRef: document
  });
  managedFileRuntimeController.bind();

  const desktopSurfaceController = createDesktopSurfaceController({
    getSurface: () => $("#desktop"),
    getSelectionBox: () => $("#selection-box"),
    getContainer: () => $("#desktop-items"),
    getRootId: getDesktopRoot,
    getItems: () => Object.values(state.fs).filter(item => item.parent === getDesktopRoot() && !item.deletedAt && !item.hiddenFromDesktop && item.systemRole !== "explorerRoot"),
    getSelectedId: () => ui.selectedDesktop,
    setSelectedId: itemId => { ui.selectedDesktop = itemId; },
    getSelectedIds: () => ui.multiSelected,
    getSelectionDrag: () => ui.selectionDrag,
    setSelectionDrag: drag => { ui.selectionDrag = drag; },
    getIcons: () => $$(".desktop-icon"),
    clampPosition: clampDesktopPosition,
    itemIcon,
    onOpen: openItem,
    onShowMenu: showItemMenu,
    onEnableDrag: enableDesktopItemPointerDrag,
    renderStickies: renderDesktopStickies
  });

  const virtualDesktopController = createVirtualDesktopController({
    getState: () => state,
    ensureDesktops,
    createId: uid,
    requestName: (message, defaultName) => prompt(message, defaultName),
    confirmDelete: message => confirm(message),
    addDesktopShortcut,
    ensureWorkspaceExplorerRoot,
    createWorkspaceSystemFolders,
    findFreeDesktopPosition,
    persistOpenWindows: persistOpenWindowsForCurrentDesktop,
    clearRuntimeWindows,
    restoreWindows: restoreWindowsForCurrentDesktop,
    resetSelection: () => {
      ui.selectedDesktop = null;
      ui.multiSelected?.clear();
    },
    applySettings,
    saveState,
    renderDesktop,
    renderStart,
    renderNotifications,
    getDesktopName: desktopName,
    toast
  });

  const appShortcutController = createAppShortcutController({
    getState: () => state,
    getApps: () => apps,
    getRootId: getDesktopRoot,
    itemInWorkspace,
    addDesktopShortcut,
    saveState,
    renderAllFileSurfaces,
    refreshWindows: refreshAppCenterWindows,
    toast
  });

  function defaultState() {
    return createDefaultState();
  }

  const primaryStateSaveQueue = createPrimaryStateSaveQueue({
    getState: () => state,
    cloneState: cloneForBackup,
    writePrimaryRecord: snapshot => writePrimaryStateRecord(snapshot),
    removeLegacyState: removeLegacyFullStateFromLocalStorage,
    saveFallback: snapshot => saveFullStateToLocalStorageFallback(snapshot),
    nativeStorage: shouldUseNativeStorage,
    nativeStorageLabel,
    writesAllowed: () => storageRuntime.writesAllowed,
    scheduleStorageCheck: () => securityRuntimeController.scheduleStoragePressureCheck(),
    runtime: storageRuntime,
    byteSize,
    warn: (...args) => console.warn(...args),
    toast
  });

  const storageStateRuntimeController = createStorageStateRuntimeController({
    getState: () => state,
    setState: value => { state = value; },
    runtime: storageRuntime,
    nativeStorage: shouldUseNativeStorage,
    nativeStorageLabel,
    readPrimaryRecord: readPrimaryStateRecord,
    readLegacyState: readLegacyLocalStorageState,
    migrateState: migrate,
    defaultState,
    queuePrimarySave: options => primaryStateSaveQueue.queue(options),
    writeSmallSettings: writeSmallSettingsToLocalStorage,
    scheduleExternalBackup,
    scheduleStorageCheck: () => securityRuntimeController.scheduleStoragePressureCheck(),
    scheduleProtectionCheck: () => securityRuntimeController.scheduleProtectionCheck(),
    waitForNativeStorage,
    byteSize,
    warn: (...args) => console.warn(...args),
    logBootError: (...args) => console.error(...args)
  });

  async function readPrimaryStateRecord() {
    return storageUtils.readPrimaryStateRecord({
      nativeStorage: shouldUseNativeStorage,
      nativeStorageCall,
      normalizeNativeStateRecord,
      dbName: PRIMARY_STATE_DB,
      storeName: PRIMARY_STATE_STORE,
      id: PRIMARY_STATE_ID
    });
  }

  async function writePrimaryStateRecord(snapshot = state) {
    return storageUtils.writePrimaryStateRecord(snapshot, {
      id: PRIMARY_STATE_ID,
      osVersion: OS_VERSION,
      versionNumber: OS_VERSION_NUMBER,
      nativeStorage: shouldUseNativeStorage,
      nativeStorageCall,
      dbName: PRIMARY_STATE_DB,
      storeName: PRIMARY_STATE_STORE,
      byteSize
    });
  }

  function readLegacyLocalStorageState() {
    return readLegacyLocalStorageStateFromStorage({ storage: localStorage, storageKey: STORAGE_KEY, warn: (...args) => console.warn(...args) });
  }

  function buildSmallSettingsSnapshot(target = state) {
    return buildSmallSettingsSnapshotFromStorage(target, {
      nativeStorage: shouldUseNativeStorage(),
      osVersion: OS_VERSION,
      versionNumber: OS_VERSION_NUMBER,
      normalizeTaskbarPinnedApps,
      defaultTaskbarPinnedApps: DEFAULT_TASKBAR_PINNED_APPS
    });
  }

  function writeSmallSettingsToLocalStorage() {
    return writeSmallSettingsToLocalStorageFromStorage(state, {
      storage: localStorage,
      smallSettingsKey: SMALL_SETTINGS_KEY,
      runtime: storageRuntime,
      byteSize,
      buildSnapshot: buildSmallSettingsSnapshot,
      warn: (...args) => console.warn(...args)
    });
  }

  function removeLegacyFullStateFromLocalStorage() {
    return removeLegacyFullStateFromLocalStorageFromStorage({ storage: localStorage, storageKey: STORAGE_KEY, warn: (...args) => console.warn(...args) });
  }

  function saveFullStateToLocalStorageFallback(snapshot = state, fallbackOptions = {}) {
    return saveFullStateToLocalStorageFallbackFromStorage(snapshot, {
      storage: localStorage,
      storageKey: STORAGE_KEY,
      runtime: storageRuntime,
      byteSize,
      warn: (...args) => console.warn(...args),
      toast,
      ...fallbackOptions
    });
  }

  async function loadState() {
    return storageStateRuntimeController.loadState();
  }

  function saveState(options = {}) {
    syncLegacyWorkspaceAliases(state);
    const savePromise = Promise.resolve(storageStateRuntimeController.saveState(options)).then(result => {
      if (result?.skipped || result?.saved === false) {
        throw new Error("Хранилище ещё не готово к записи.");
      }
      return result;
    });
    savePromise.catch(() => {});
    return savePromise;
  }

  function storedStateSizeBytes() {
    return storageStateRuntimeController.storedStateSizeBytes();
  }

  function migrate(s) {
    return migrateStateWithRuntime(s, {
      apps,
      normalizeTrashState,
      purgeExpiredTrashItems: purgeExpiredTrashItemsFromTarget
    });
  }

  function ensureSystemAppShortcut(target = state, appId, name, x = 320, y = 132) {
    return ensureSystemAppShortcutForState(target, appId, name, x, y);
  }

  function removeExplorerAppShortcutsFromState(target = state) {
    return removeExplorerAppShortcutsFromTarget(target);
  }

  function removeWorkspaceDocumentsFoldersFromState(target = state) {
    return removeWorkspaceDocumentsFoldersFromTarget(target);
  }

  function expandItemIdsInTarget(target = state, ids = []) {
    return expandItemIdsInTargetForState(target, ids);
  }

  function pruneTargetReferencesForRemovedItems(target = state, deletedIds = new Set(), options = {}) {
    return pruneTargetReferencesForRemovedItemsForState(target, deletedIds, {
      ...options,
      normalizeTaskbarPinnedApps
    });
  }

  function purgeDeletedItemsFromStorageState(target = state, options = {}) {
    return purgeDeletedItemsFromStorageTarget(target, {
      ...options,
      normalizeStartPinnedState,
      normalizeTaskbarPinnedApps
    });
  }

  function rememberDeletedIdsForNativePurge(deletedIds = new Set()) {
    return rememberDeletedIdsForNativePurgeInTarget(state, deletedIds);
  }

  function permanentlyRemoveItemsFromBrowserState(ids = [], options = {}) {
    return trashActionController.permanentlyRemoveItems(ids, options);
  }

  function trashRetentionDays(target = state) {
    return trashActionController.retentionDays(target);
  }

  function normalizeTrashState(target = state) {
    return trashActionController.normalizeState(target);
  }

  function purgeExpiredTrashItemsFromTarget(target = state, options = {}) {
    return trashActionController.purgeExpired(target, options);
  }

  function applyTrashRetentionDays(value) {
    return trashActionController.applyRetentionDays(value);
  }

  let externalDirectoryHandle = null;
  let externalBackupRuntimeController = null;
  const externalAssetIoController = createExternalAssetIoController({
    getRootHandle: () => externalDirectoryHandle,
    warn: (...args) => console.warn(...args)
  });
  externalBackupRuntimeController = createExternalBackupRuntimeController({
    getState: () => state,
    getWorkspace: currentWorkspace,
    getDirectoryHandle: () => externalDirectoryHandle,
    setDirectoryHandle: handle => { externalDirectoryHandle = handle; },
    nativeMode: shouldUseNativeStorage,
    storageStateBytes: storedStateSizeBytes,
    version: OS_VERSION,
    versionNumber: OS_VERSION_NUMBER,
    assetRoot: EXTERNAL_ASSET_ROOT,
    assetRoots: [EXTERNAL_IMAGE_ROOT, EXTERNAL_WALLPAPER_ROOT, EXTERNAL_DESKTOP_ICON_ROOT],
    buildExternalBackupStateModel,
    syncOpenWindows: syncOpenWindowsBeforeBackup,
    saveDataImageAsset: externalAssetIoController.saveDataImageAsset,
    createRichContentAdapter: richContent => {
      const box = document.createElement("div");
      box.innerHTML = cleanRichHtml(richContent);
      return { images: $$("img", box), serialize: () => cleanRichHtml(box.innerHTML) };
    },
    pad,
    collectVisualSettingsHolders,
    normalizeCustomWallpaper,
    normalizeDesktopIcon,
    buildReadableEntries: buildHumanReadableOsDataEntries,
    createZipBlob,
    clearDirectory: externalAssetIoController.clearDirectory,
    writeBlobByPath: externalAssetIoController.writeBlobByPath,
    syncLiveEditors: syncLiveEditorsBeforeExport,
    saveState,
    verifyPermission: (handle, write) => securityRuntimeController.verifyExternalPermission(handle, write),
    storeDirectory: securityRuntimeController.storeExternalHandle,
    loadDirectory: securityRuntimeController.loadExternalHandle,
    openNativeDataFolder: () => nativeStorageCall("open_data_folder"),
    getNativeStorageInfo: () => nativeStorageCall("get_storage_info"),
    pickDirectory: () => window.showDirectoryPicker({ mode: "readwrite" }),
    refresh: () => { renderStart(); refreshWorkspaceWindows(); },
    notify: toast,
    warn: (...args) => console.warn(...args),
    logExternalSaveError: error => console.error("[ZeTer OS external save]", error),
    logPickerError: error => console.error(error),
    logInitError: error => console.warn(shouldUseNativeStorage() ? "[ZeTer OS native storage init]" : "[ZeTer OS external save init]", error),
    windowRef: window
  });

  const externalAssetImportController = createExternalAssetImportController({
    collectVisualSettingsHolders,
    getDirectoryHandle: () => externalDirectoryHandle,
    setDirectoryHandle: handle => { externalDirectoryHandle = handle; },
    supportsExternalFolderSave,
    verifyPermission: (handle, write) => securityRuntimeController.verifyExternalPermission(handle, write),
    pickDirectory: () => window.showDirectoryPicker({ mode: "read" }),
    readBlobByPath: externalAssetIoController.readBlobByPath,
    createRichContentAdapter: richContent => {
      const box = document.createElement("div");
      box.innerHTML = cleanRichHtml(richContent);
      return { images: $$("img", box), serialize: () => cleanRichHtml(box.innerHTML) };
    },
    notify: toast,
    warn: (...args) => console.warn(...args)
  });

  function supportsExternalFolderSave() { return externalBackupRuntimeController.supportsExternalFolderSave(); }

  async function hydrateExternalAssets(incoming) {
    return externalAssetImportController.hydrateExternalAssets(incoming);
  }



  function exportDesktopIdForItem(item = {}) { return readableExportRuntimeController.desktopIdForItem(item); }
  function syncLiveEditorsBeforeExport() { return readableExportRuntimeController.syncLiveEditors(); }
  async function buildHumanReadableOsDataEntries() { return readableExportRuntimeController.buildEntries(); }

  async function buildDownloadOsDataZip(target = state) { return externalBackupRuntimeController.buildDownloadOsDataZip(target); }
  async function writeExternalBackup(reason = "auto") { return externalBackupRuntimeController.writeExternalBackup(reason); }
  function scheduleExternalBackup() { return externalBackupRuntimeController.scheduleExternalBackup(); }
  async function chooseExternalSaveFolder() { return externalBackupRuntimeController.chooseExternalSaveFolder(); }
  async function initExternalSaveFolder() { return externalBackupRuntimeController.initExternalSaveFolder(); }

  function safeInitStep(label, action) { return shellRuntimeController.safeInitStep(label, action); }
  function init() { return shellRuntimeController.init(); }
  function applySettings() { return shellRuntimeController.applySettings(); }
  function closeFloating() { return shellRuntimeController.closeFloating(); }
  function togglePanel(which) { return shellRuntimeController.togglePanel(which); }
  function openGlobalSearch(query = "", focus = true, placement = "top") { return shellRuntimeController.openGlobalSearch(query, focus, placement); }
  function toggleGlobalSearch() { return shellRuntimeController.toggleGlobalSearch(); }


  function workspaceDefaults(seed = {}) { return workspaceRuntimeController.workspaceDefaults(seed); }
  function ensureDesktops() { return workspaceRuntimeController.ensureDesktops(); }
  function currentDesktopRecord() { return workspaceRuntimeController.currentDesktopRecord(); }
  function currentWorkspace() { return workspaceRuntimeController.currentWorkspace(); }
  function deskSettings() { return workspaceRuntimeController.deskSettings(); }
  function systemSettings() {
    state.systemSettings = normalizeSystemSettings(state.systemSettings);
    return state.systemSettings;
  }
  function setSystemSettings(settings = {}) {
    state.systemSettings = normalizeSystemSettings(settings);
    return state.systemSettings;
  }
  function applyStartupPreferences() {
    const target = systemSettings().startup.desktop;
    if (target !== "last" && state.desktops.some(desktop => desktop.id === target)) state.currentDesktop = target;
    return state.currentDesktop;
  }
  function startupDesktopOptions() {
    return (state.desktops || []).map(desktop => ({ id: desktop.id, name: desktopName(desktop.id) }));
  }
  function switchRelativeDesktop(direction = 1) {
    const desktops = Array.isArray(state.desktops) ? state.desktops : [];
    if (desktops.length < 2) return false;
    const currentIndex = Math.max(0, desktops.findIndex(desktop => desktop.id === state.currentDesktop));
    const offset = direction < 0 ? -1 : 1;
    const nextIndex = (currentIndex + offset + desktops.length) % desktops.length;
    return switchVirtualDesktop(desktops[nextIndex].id);
  }
  function storageSettingsSummary() {
    const nativeMode = shouldUseNativeStorage();
    return {
      mode: storageRuntime.mode || (nativeMode ? nativeStorageLabel() : "IndexedDB"),
      ready: Boolean(storageRuntime.ready),
      loadStatus: storageRuntime.loadStatus || "pending",
      writesAllowed: Boolean(storageRuntime.writesAllowed),
      fallback: Boolean(storageRuntime.fallback),
      lastError: storageRuntime.lastError || "",
      lastSavedAt: Number(storageRuntime.lastSavedAt) || 0,
      stateBytes: Number(storageRuntime.stateBytes) || storedStateSizeBytes(),
      path: nativeMode ? "data/zeter-os-state.json" : "IndexedDB · zeter-os-primary-state",
      canOpenDataFolder: nativeMode
    };
  }
  function deskTasks() { return workspaceRuntimeController.deskTasks(); }
  function deskTaskProjects() { return workspaceRuntimeController.deskTaskProjects(); }
  function deskEvents() { return workspaceRuntimeController.deskEvents(); }
  function deskNotifications() { return workspaceRuntimeController.deskNotifications(); }
  function setDeskTasks(tasks) { return workspaceRuntimeController.setDeskTasks(tasks); }
  function setDeskEvents(events) { return workspaceRuntimeController.setDeskEvents(events); }
  function setDeskNotifications(notifications) { return workspaceRuntimeController.setDeskNotifications(notifications); }
  function deskOpenWindows() { return workspaceRuntimeController.deskOpenWindows(); }
  function sanitizeWorkspaceWindowSessions() { return workspaceRuntimeController.sanitizeWorkspaceWindowSessions(); }
  function sanitizeExplorerSpaces() { return workspaceRuntimeController.sanitizeExplorerSpaces(); }

  function collectCurrentWindowSessions() { return windowRuntimeController.collectCurrentWindowSessions(); }
  function syncOpenWindowsBeforeBackup() { return windowRuntimeController.syncOpenWindowsBeforeBackup(); }
  function persistOpenWindowsForCurrentDesktop() { return windowRuntimeController.persistOpenWindowsForCurrentDesktop(); }
  function windowLayer() { return windowRuntimeController.windowLayer(); }
  function clearRuntimeWindows() { return windowRuntimeController.clearRuntimeWindows(); }
  function restoreWindowsForCurrentDesktop() { return windowRuntimeController.restoreWindowsForCurrentDesktop(); }
  function refreshWorkspaceWindows() { return windowRuntimeController.refreshWorkspaceWindows(); }
  function getDesktopRoot() { return workspaceRuntimeController.getDesktopRoot(); }
  function isDesktopRoot(id) { return workspaceRuntimeController.isDesktopRoot(id); }
  function desktopRecordById(id) { return workspaceRuntimeController.desktopRecordById(id); }
  function desktopName(id) { return workspaceRuntimeController.desktopName(id); }
  function desktopDescription(id) { return workspaceRuntimeController.desktopDescription(id); }
  function desktopIconData(id) { return workspaceRuntimeController.desktopIconData(id); }
  function desktopAvatarHTML(id, active = false) { return workspaceRuntimeController.desktopAvatarHTML(id, active); }

  function createVirtualDesktop() {
    return virtualDesktopController.create();
  }

  function installableAppEntries() {
    return appShortcutController.entries();
  }

  function appInstalledOnDesktop(appId, root = getDesktopRoot()) {
    return appShortcutController.isInstalled(appId, root);
  }

  function refreshAppCenterWindows() {
    ui.windows.forEach((rec, winId) => {
      if (rec.appId === "appcenter") refreshWindow(winId);
    });
  }

  function installAppToDesktop(appId) {
    return appShortcutController.install(appId);
  }

  function uninstallAppFromDesktop(appId) {
    return appShortcutController.uninstall(appId);
  }

  function switchVirtualDesktop(id) {
    return virtualDesktopController.switchTo(id);
  }

  function deleteVirtualDesktop(id) {
    return virtualDesktopController.remove(id);
  }

  function clearDesktopSelection(options = {}) {
    return desktopSurfaceController.clear(options);
  }

  function renderDesktop() {
    return desktopSurfaceController.render();
  }

  function itemIcon(item) {
    return itemIconForApps(apps, item);
  }

  async function copyTextToClipboard(value = "") {
    const text = String(value || "");
    if (!text) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch {}
    area.remove();
    return copied;
  }

  async function copyItemLocation(itemId) {
    const item = state.fs?.[itemId];
    const target = shortcutTargetForItem(itemId);
    if (!item || !target) return false;
    const copied = await copyTextToClipboard(target);
    if (copied) toast("Путь скопирован", `${item.name} · ${target}`);
    else toast("Не удалось скопировать путь", "Разреши ZeTer OS доступ к буферу обмена и повтори попытку.");
    return copied;
  }

  function openShortcutEditor(parentId = getDesktopRoot(), options = {}) {
    const parent = isDesktopRoot(parentId) || state.fs?.[parentId]?.type === "folder" ? parentId : getDesktopRoot();
    return openApp("shortcutedit", {
      parentId: parent,
      x: Number.isFinite(Number(options.x)) ? Number(options.x) : 80,
      y: Number.isFinite(Number(options.y)) ? Number(options.y) : 80,
      target: String(options.target || ""),
      name: String(options.name || "")
    });
  }

  function openItemSettings(itemId) {
    const item = state.fs?.[itemId];
    if (!item || !["folder", "shortcut"].includes(item.type)) {
      toast("Настройки недоступны", "Выбранный элемент не является папкой или пользовательским ярлыком.");
      return null;
    }
    return openApp("itemsettings", { itemId: item.id });
  }

  async function persistItemCustomizationAsset(itemId, kind, image = null) {
    if (!shouldUseNativeStorage() || !image?.dataURL) return null;
    const result = await nativeStorageCall("save_item_asset", {
      itemId,
      kind,
      name: image.name || "Изображение",
      dataURL: image.dataURL
    });
    return result?.asset || null;
  }

  async function openExternalTarget(target, label = "") {
    const normalized = normalizeShortcutTarget(target);
    if (!normalized) {
      toast("Не удалось открыть ярлык", "Путь или ссылка имеют неподдерживаемый формат.");
      return false;
    }
    if (normalized.kind === "zeter") return openShortcutTarget(normalized.target, label);
    if (normalized.kind === "windows") {
      const extension = managedFileUtils.fileExtension(normalized.target);
      if (managedFileUtils.EXECUTABLE_EXTENSIONS.has(extension) && !confirm(`Запустить потенциально исполняемый файл «${label || normalized.target}»?`)) return false;
    }
    if (!shouldUseNativeStorage()) {
      if (normalized.kind === "url") {
        const opened = window.open(normalized.target, "_blank", "noopener,noreferrer");
        if (opened) opened.opener = null;
        return Boolean(opened);
      }
      toast("Нужен запуск через Windows", "Ярлыки на файлы и папки открываются при запуске ZeTer OS через run_zeter_os.py.");
      return false;
    }
    try {
      await nativeStorageCall("open_external_target", { target: normalized.target });
      return true;
    } catch (error) {
      console.error("[ZeTer OS shortcut open]", error);
      toast("Не удалось открыть ярлык", error?.message || label || normalized.target);
      return false;
    }
  }

  function openShortcutTarget(target, label = "", visited = new Set()) {
    const normalized = normalizeShortcutTarget(target);
    if (!normalized) {
      toast("Не удалось открыть ярлык", "Цель ярлыка повреждена или имеет неподдерживаемый формат.");
      return false;
    }
    if (normalized.kind !== "zeter") return openExternalTarget(normalized.target, label);
    if (visited.has(normalized.itemId)) {
      toast("Циклический ярлык", "Ярлыки ссылаются друг на друга и не могут быть открыты.");
      return false;
    }
    const item = state.fs?.[normalized.itemId];
    if (!item || item.deletedAt) {
      toast("Элемент не найден", "Цель ярлыка была удалена или больше недоступна.");
      return false;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(normalized.itemId);
    if (item.type === "shortcut") {
      const shortcut = normalizeShortcutRecord(item.shortcut || item.managedFile || item);
      return shortcut ? openShortcutTarget(shortcut.target, item.name, nextVisited) : false;
    }
    return openItem(item.id);
  }

  function openShortcutItem(item = {}) {
    const shortcut = normalizeShortcutRecord(item.shortcut || item.managedFile || item);
    if (!shortcut) {
      toast("Не удалось открыть ярлык", `${item.name || "Ярлык"}: цель не указана.`);
      return false;
    }
    return openShortcutTarget(shortcut.target, item.name, new Set([item.id]));
  }

  function openManagedFile(file) {
    return managedFileRuntimeController?.openManagedFile(file);
  }

  function setStartItemPinned(itemId, pinned) { return startMenuController.setItemPinned(itemId, pinned); }

  function renderAllFileSurfaces() {
    renderDesktop();
    ui.explorerFolders.forEach((_, winId) => refreshWindow(winId));
    refreshNotesWindows();
    refreshAppCenterWindows();
    renderTaskbarPinnedApps();
    renderStart($("#start-search-input")?.value || "");
  }

  function cleanupRemovedItemReferences(ids = []) { return removedItemReferencesController.cleanup(ids); }

  function normalizeNotesData(target = state) {
    return normalizeNotesDataForTarget(target, { appCenterName: apps.appcenter?.name });
  }


  function refreshNotesWindows() {
    ui.windows.forEach((rec, winId) => {
      if (rec.appId === "notes") refreshWindow(winId);
    });
  }

  function refreshOpenTaskListTitles(itemId) {
    ui.windows.forEach((rec, winId) => {
      if (rec.appId === "tasklist" && rec.params?.itemId === itemId) refreshWindowTitle(winId, taskWindowTitleFromParams(rec.params));
    });
  }

  function refreshOpenTaskShortcutTitles(itemId) {
    ui.windows.forEach((rec, winId) => {
      if (rec.appId === "tasks" && rec.params?.shortcutItemId === itemId) refreshWindowTitle(winId, taskWindowTitleFromParams(rec.params));
    });
  }

  function showContext(x, y, entries, options = {}) {
    return renderContextMenu({
      menu: $("#context-menu"),
      x,
      y,
      entries,
      anchorEl: options.anchorEl,
      placement: options.placement
    });
  }

  function showContextNearElement(event, entries, placement = "above") {
    showContext(event.clientX, event.clientY, entries, {
      anchorEl: event.currentTarget || event.target,
      placement
    });
  }

  function folderNameExists(parent, name, excludeId = null) { return fsItemController.folderNameExists(parent, name, excludeId); }
  function createItem(type, name, parent = getDesktopRoot(), x = 40, y = 40, extra = {}) { return fsItemController.createItem(type, name, parent, x, y, extra); }
  function createFolderInFolder(parent = getDesktopRoot(), options = {}) { return fsItemController.createFolder(parent, options); }
  function uniqueName(name, parent, excludeId = null) { return fsItemController.uniqueName(name, parent, excludeId); }

  function renameItem(itemId) { return fsItemController.renameItem(itemId); }
  function duplicateItem(itemId) { return fsItemController.duplicateItem(itemId); }

  function pushActionHistory(action) { return trashActionController.pushActionHistory(action); }
  function moveItemsToTrash(ids = []) { return trashActionController.moveItemsToTrash(ids); }

  function deleteItem(itemId, options = {}) { return trashActionController.deleteItem(itemId, options); }

  function undoLastAction() { return trashActionController.undoLastAction(); }
  function trashedItems() { return trashActionController.trashedItems(); }
  function restoreTrashItem(itemId) { return trashActionController.restoreTrashItem(itemId); }

  function permanentlyDeleteTrashItem(itemId) { return trashActionController.permanentlyDeleteTrashItem(itemId); }
  function emptyTrash() { return trashActionController.emptyTrash(); }

  function itemPath(item = {}) { return fsItemController.itemPath(item); }

  function showItemProperties(itemId) { return fsItemController.showProperties(itemId); }

  function refreshRecycleBinWindows() {
    // Приложение «Корзина» удалено; удаление файлов теперь выполняется сразу.
  }

  function deleteItems(ids = []) { return trashActionController.deleteItems(ids); }

  function cycleWindows(reverse = false) { return windowRuntimeController.cycleWindows(reverse); }

  function descendants(folderId) {
    return descendantIdsInFs(state.fs, folderId);
  }

  function openByDataApp(id) { return shellRuntimeController.openByDataApp(id); }
  function openApp(appId, params = {}, options = {}) { return windowRuntimeController.openApp(appId, params, options); }

  function bindWindow(el, winId) { return windowRuntimeController.bindWindow(el, winId); }
  function addTaskbarApp(winId, app) { return windowRuntimeController.addTaskbarApp(winId, app); }
  function focusWindow(winId) { return windowRuntimeController.focusWindow(winId); }
  function closeWindow(winId) { return windowRuntimeController.closeWindow(winId); }
  function minimizeWindow(winId) { return windowRuntimeController.minimizeWindow(winId); }
  function toggleMax(winId) { return windowRuntimeController.toggleMax(winId); }
  function restoreWindow(winId) { return windowRuntimeController.restoreWindow(winId); }
  function snapWindow(winId, mode) { return windowRuntimeController.snapWindow(winId, mode); }
  function showSnapMenu(winId, event) { return windowRuntimeController.showSnapMenu(winId, event); }
  function refreshWindow(winId) { return windowRuntimeController.refreshWindow(winId); }
  function keepWindowsInBounds() { return windowRuntimeController.keepWindowsInBounds(); }

  function taskbarPinnedApps() { return taskbarController.pinnedApps(); }
  function isTaskbarPinnedApp(appId) { return taskbarController.isPinned(appId); }
  function setTaskbarAppPinned(appId, pinned) { return taskbarController.setPinned(appId, pinned); }
  function renderTaskbarPinnedApps() { return taskbarController.renderPinned(); }
  function bindTaskbarLockedContextMenus() { return taskbarController.bindLockedContextMenus(); }
  function showTaskbarPinnedAppMenu(e, appId) { return taskbarController.showPinnedAppMenu(e, appId); }
  function showRunningTaskbarWindowMenu(e, winId) { return taskbarController.showRunningWindowMenu(e, winId); }
  function showStartAppMenu(e, appId) { return taskbarController.showStartAppMenu(e, appId); }


  function showStartItemMenu(e, itemId) { return startMenuController.showItemMenu(e, itemId); }
  function renderStart(filter = "") { return startMenuController.render(filter); }
  function renderStartDesktops() { return startMenuController.renderDesktops(); }


  function renderExplorer(params = {}, winId) {
    const rootId = getExplorerRoot();
    createWorkspaceSystemFolders(rootId);
    const model = prepareExplorerAppModel({
      params, rootId,
      getItem: id => state.fs[id],
      isDesktopRoot, folderRootContext, isExplorerRoot, isInExplorerSpace,
      explorerFolderIdForTab, explorerBaseRootForFolder,
      normalizeExplorerTabs, persistExplorerTabsForAnchor,
      explorerPathText, explorerFolderTitle, explorerAddressText,
      renderPinnedExplorer, renderExplorerTree, explorerPreviewHTML
    });
    return createExplorerApp({
      model, params, winId, rootId, state, ui, document, window, serializableParams,
      isDesktopRoot, isExplorerRoot, enableItemPointerDrag, clearDesktopSelection,
      explorerPreviewHTML, explorerSearchableItems, sortExplorerItems, explorerItemSize,
      explorerFlowLayout, explorerSearchGridPosition, findFreeFolderPosition,
      explorerResultLocationText, explorerCardMeta, itemDescription, bytesToHuman, itemIcon,
      folderBackgroundDataURL,
      openItem,
      navigateFolder: (folderId, navigationOptions) => navigateFolderWindow(winId, params, folderId, navigationOptions),
      buildExplorerFolderMenuEntries, renameItem, duplicateItem, openItemSettings, showItemProperties, deleteItem,
      copyItemLocation,
      showContext, showItemMenu, explorerGridMinSize,
      normalizeExplorerTabs, explorerBaseRootForFolder, persistExplorerTabsForAnchor,
      refreshWindow: () => refreshWindow(winId),
      persistOpenWindows: persistOpenWindowsForCurrentDesktop,
      toast,
      creators: {
        folder: createFolderInFolder,
        file: createFileInFolder,
        shortcut: openShortcutEditor,
        table: createTableInFolder,
        taskList: createTaskListInFolder,
        note: (parentId, position) => createItem("note", "Новая заметка", parentId, position.x, position.y, { content: "", richContent: "" }),
        openEditor: itemId => openApp("editor", { itemId })
      },
      togglePinnedItem, deleteItems, downloadExplorerItems, saveState, renderAllFileSurfaces,
      explorerFolderMoveTargets, explorerPathText, bulkMoveItemsToFolder,
      expandedExplorerSet, saveExpandedExplorerSet, explorerFolderIdForTab,
      descendants, confirmDelete: confirm, removeFolderReferences, desktopRoot: getDesktopRoot(),
      positionInFolderGrid, buildExplorerEmptyAreaMenuEntries, resolveExplorerAddress, importNativeFiles
    });

  }

  function createFileInFolder(parent = "desktop", options = {}) { return fsItemController.createFile(parent, options); }

  function itemDescription(item) {
    return itemDescriptionFromFs(item, {
      apps,
      fs: state.fs,
      normalizeTableData,
      activeTablePage,
      normalizeTaskStore
    });
  }

  function refreshWindowTitle(winId, title) { const rec = ui.windows.get(winId); if (rec) $(".window-title b", rec.el).textContent = title; }
  function refreshOpenEditors(itemId) { ui.windows.forEach((rec, id) => { if (rec.params?.itemId === itemId) refreshWindow(id); }); }

  function createTableInFolder(parent = getDesktopRoot(), options = {}) { return fsItemController.createTable(parent, options); }
  function createTaskListInFolder(parent = getDesktopRoot(), options = {}) { return fsItemController.createTaskList(parent, options); }

  function renderTasksApp(params = {}, winId) { return taskAppRuntimeController.renderTasksApp(params, winId); }
  function refreshOpenTaskBoards(excludeWinId = "") { taskAppRuntimeController.refreshOpenTaskBoards(excludeWinId); }
  function renderTaskEditorApp(params = {}, winId) { return taskAppRuntimeController.renderTaskEditorApp(params, winId); }
  function refreshOpenCalendars(excludeWinId = "") {
    ui.windows.forEach((record, winId) => {
      if (winId !== excludeWinId && record.appId === "calendar") refreshWindow(winId);
    });
  }
  function renderCalendarApp() {
    return createCalendarApp({
      document,
      desktopTitle: desktopName(getDesktopRoot()),
      getCalendar: () => ui.calendar,
      setCalendar: calendar => { ui.calendar = calendar; },
      getEvents: deskEvents,
      setEvents: setDeskEvents,
      saveState,
      renderNotifications,
      toast,
      confirmUser: confirm,
      openEventEditor: params => openApp("calendaredit", params),
      downloadFile,
      todayISO,
      formatDate
    });
  }
  function renderCalendarEventEditorApp(params = {}, winId = "") {
    return createCalendarEventEditorApp(params, winId, {
      document,
      getCalendar: () => ui.calendar,
      setCalendar: calendar => { ui.calendar = calendar; },
      getEvents: deskEvents,
      setEvents: setDeskEvents,
      saveState,
      renderNotifications,
      refreshOpenCalendars,
      closeWindow,
      toast,
      todayISO
    });
  }
  function renderShortcutEditorApp(params = {}, winId = "") {
    return createShortcutEditorApp(params, winId, {
      documentRef: document,
      getItem: itemId => state.fs?.[itemId],
      getDefaultParent: getDesktopRoot,
      createItem,
      createId: uid,
      openTarget: openShortcutTarget,
      closeWindow,
      toast
    });
  }
  function renderItemSettingsApp(params = {}, winId = "") {
    return createItemSettingsApp(params, winId, {
      documentRef: document,
      getItem: itemId => state.fs?.[itemId],
      persistAsset: persistItemCustomizationAsset,
      saveState,
      renderAllFileSurfaces,
      refreshItemDependents: itemId => {
        refreshOpenEditors(itemId);
        refreshOpenTaskListTitles(itemId);
        refreshOpenTaskShortcutTitles(itemId);
      },
      closeWindow,
      toast
    });
  }
  function renderCalculatorApp(){ return calculatorAppElement(calculateNextExpression); }
  function renderPhotosApp(params = {}){
    return galleryAppElement({
      fs: state.fs,
      item: params.itemId ? state.fs[params.itemId] : null,
      isValidImage: image => isDataImage(image?.dataURL),
      itemDescription,
      downloadDataUrl,
      toast
    });
  }
  function renderMonitorApp(){
    return monitorUtils.createMonitorApp({
      document,
      requestAnimationFrame,
      setInterval,
      performance,
      navigator,
      apps,
      ui,
      getDesktopRoot,
      workspaceItems,
      deskTasks,
      deskEvents,
      deskNotifications,
      shouldUseNativeStorage,
      storedStateSizeBytes,
      storageRuntime,
      todayISO,
      occursOn,
      readNativeSystemMetrics: () => nativeStorageCall("get_system_metrics"),
      openDataFolder: () => nativeStorageCall("open_data_folder"),
      openLogsFolder: () => nativeStorageCall("open_logs_folder"),
      openApp,
      copyText: copyTextToClipboard,
      toast
    });
  }

  function renderSettingsApp(params = {}, winId = ""){
    return settingsAppElement({
      winId,
      getSettings: deskSettings,
      getSystemSettings: systemSettings,
      setSystemSettings,
      getDesktopRecord: currentDesktopRecord,
      getDesktopOptions: startupDesktopOptions,
      getStorageSummary: storageSettingsSummary,
      getDesktopRoot,
      normalizeDesktopIcon,
      normalizeCustomWallpaper,
      desktopAvatarHTML,
      desktopName,
      desktopDescription,
      formatBytes: bytesToHuman,
      osVersion: OS_VERSION,
      windowsStartupAvailable: shouldUseNativeStorage(),
      applySettings,
      toast,
      refreshWindow,
      createCustomWallpaperFromFile,
      createDesktopIconFromFile,
      saveState,
      openDataFolder: () => nativeStorageCall("open_data_folder"),
      getWindowsStartupStatus: () => nativeStorageCall("get_windows_startup_status"),
      setWindowsStartupEnabled: enabled => nativeStorageCall("set_windows_startup_enabled", enabled),
      openSecurity: () => openApp("security"),
      renderStart
    });
  }
  function renderAppCenter(){
    return appCenterAppElement({
      getAppEntries: installableAppEntries,
      isInstalled: id => appInstalledOnDesktop(id, getDesktopRoot()),
      openApp,
      installApp: installAppToDesktop,
      uninstallApp: uninstallAppFromDesktop
    });
  }
  function renderHelpApp(){ return helpAppElement({ openApp, osVersion: OS_VERSION }); }
  const searchController = createSearchController({
    document,
    getState: () => state,
    getFs: () => state.fs,
    getCurrentDesktopId: getDesktopRoot,
    getWorkspace: currentWorkspace,
    apps,
    trashRoot: TRASH_ROOT,
    resultLimit: SEARCH_RESULT_LIMIT,
    isDesktopRoot,
    isExplorerRoot,
    normalizeTaskStore,
    statusName,
    priorityName,
    taskReminderLabel,
    taskReminderRepeatLabel,
    htmlPlainText,
    itemDescription,
    itemIcon,
    desktopName,
    categoryName,
    formatDate,
    defaultTaskProjectName: DEFAULT_TASK_PROJECT_NAME,
    saveState,
    openResult: element => searchResultNavigator.openResult(element)
  });

  function renderSearchApp() { return searchController.createApp(); }
  function renderGlobalSearch(query) { return searchController.renderGlobal(query); }

  const taskTargetNavigator = createTaskTargetNavigator({
    getCurrentDesktopId: getDesktopRoot,
    desktopExists: desktopId => state.desktops.some(desk => desk.id === desktopId),
    switchDesktop: switchVirtualDesktop,
    getTaskListItem: itemId => state.fs?.[itemId],
    getWorkspace: currentWorkspace,
    getWindows: () => ui.windows,
    setTaskFilter: filter => { ui.taskFilter = filter; },
    setTaskFocusTarget: taskId => { ui.taskFocusTarget = taskId; },
    getTaskFocusTarget: () => ui.taskFocusTarget,
    saveState,
    closeFloating,
    refreshWindow,
    focusWindow,
    persistOpenWindows: persistOpenWindowsForCurrentDesktop,
    openApp,
    schedule: callback => setTimeout(callback, 0),
    scheduleLater: setTimeout
  });

  const searchResultNavigator = createSearchResultNavigator({
    closeFloating,
    openApp,
    createItem,
    getCurrentDesktopId: getDesktopRoot,
    desktopExists: desktopId => state.desktops.some(desk => desk.id === desktopId),
    switchDesktop: switchVirtualDesktop,
    schedule: callback => setTimeout(callback, 0),
    getItem: itemId => state.fs[itemId],
    openItem,
    setSearchFilters: searchController.setFilters,
    openGlobalSearch,
    renderGlobalSearch: query => searchController.renderGlobal(query),
    toast,
    taskNavigator: taskTargetNavigator,
    getCalendarEvent: eventId => deskEvents().find(event => event.id === eventId),
    setCalendarEventDate: date => { ui.calendar = { ...ui.calendar, date, selected: date, view: "agenda" }; },
    toggleNotifications: () => togglePanel("notifications")
  });

  const globalSearchOverlay = createGlobalSearchOverlayController({
    document,
    ElementCtor: Element,
    closeFloating,
    renderGlobal: query => searchController.renderGlobal(query),
    openFirst: () => searchResultNavigator.openFirst($("#global-search-results")),
    schedule: callback => setTimeout(callback, 0)
  });

  function openSearchResult(element) { return searchResultNavigator.openResult(element); }

  function workspaceDataForDesktopId(desktopId = getDesktopRoot()) {
    return workspaceDataForDesktopIdFromState(state, desktopId, {
      ensureDesktops,
      currentDesktopRecord,
      workspaceDefaults
    });
  }

  const notificationCenterController = createNotificationCenterController({
    document,
    getFilter: () => ui.notificationFilter,
    setFilter: filter => { ui.notificationFilter = filter; },
    getNotifications: deskNotifications,
    setNotifications: setDeskNotifications,
    getCurrentDesktopId: getDesktopRoot,
    getWorkspaceForDesktop: workspaceDataForDesktopId,
    getEventsForDate: iso => calendarEventsForDate(deskEvents(), iso),
    todayISO,
    uid,
    normalizeNotificationRecord,
    saveState
  });

  function updateNotificationBadge() { return notificationCenterController.updateBadge(); }
  function markNotificationsRead() { return notificationCenterController.markRead(); }
  function renderNotifications() { return notificationCenterController.render(); }
  function notificationDecision(options = {}) {
    return notificationDeliveryDecision(systemSettings(), notificationFilterKind(options), new Date());
  }
  function shouldPopupNotification(options = {}) { return notificationDecision(options).popup; }
  function addNotification(title, text, options = {}) {
    if (!notificationDecision(options).store) return null;
    return notificationCenterController.addNotification(title, text, options);
  }

  const taskNotificationController = createTaskNotificationController({
    getNotifications: deskNotifications,
    getCurrentDesktopId: getDesktopRoot,
    taskNavigator: taskTargetNavigator,
    openCalendar: notification => {
      const desktopId = notification.desktopId || getDesktopRoot();
      if (desktopId !== getDesktopRoot() && state.desktops.some(desktop => desktop.id === desktopId)) switchVirtualDesktop(desktopId);
      const date = notification.calendarDate || todayISO();
      ui.calendar = { ...ui.calendar, view: "day", date, selected: date, editing: null };
      closeFloating();
      openApp("calendar");
      return true;
    },
    toast
  });

  function openNotification(id) { return taskNotificationController.openById(id); }

  const taskReminderWatcher = createTaskReminderWatcher({
    getState: () => state,
    ensureDesktops,
    workspaceDefaults,
    normalizeTaskStore,
    desktopName,
    exportDesktopIdForItem,
    taskReminderTime,
    nextTaskReminderValue,
    formatDate,
    taskProjectTitle,
    normalizeTaskReminderRepeatDays,
    taskReminderRepeatLabel,
    taskDescriptionPreview,
    addNotification,
    getCurrentDesktopId: getDesktopRoot,
    shouldPopupNotification,
    toast,
    saveState,
    renderNotifications,
    refreshWorkspaceWindows,
    safeInitStep,
    now: Date.now,
    setTimer: (callback, delay) => setInterval(callback, delay),
    clearTimer: timer => clearInterval(timer),
    intervalMs: TASK_REMINDER_CHECK_MS
  });

  const calendarReminderWatcher = createCalendarReminderWatcher({
    getState: () => state,
    ensureDesktops,
    workspaceDefaults,
    desktopName,
    occursOn,
    addNotification,
    getCurrentDesktopId: getDesktopRoot,
    shouldPopupNotification,
    toast,
    saveState,
    renderNotifications,
    refreshWorkspaceWindows,
    safeInitStep,
    now: Date.now,
    setTimer: (callback, delay) => setInterval(callback, delay),
    clearTimer: timer => clearInterval(timer),
    intervalMs: TASK_REMINDER_CHECK_MS
  });

  function scheduleTaskReminderCheck() {
    taskReminderWatcher.schedule();
    return calendarReminderWatcher.schedule();
  }
  function startTaskReminderWatcher() {
    taskReminderWatcher.start();
    return calendarReminderWatcher.start();
  }

  function systemPulse() { return notificationCenterController.systemPulse(); }

  const shellRuntimeController = createShellRuntimeController({
    documentRef: document,
    windowRef: window,
    navigatorRef: navigator,
    locationRef: location,
    ElementCtor: Element,
    getState: () => state,
    getRuntimeUi: () => ui,
    getDesktopRoot,
    getDesktopName: desktopName,
    getSettings: deskSettings,
    getSystemSettings: systemSettings,
    saveState,
    renderDesktop,
    renderFileSurfaces: renderAllFileSurfaces,
    toast,
    openApp,
    closeWindow,
    exportData: exportOS,
    importData: importOS,
    chooseExternalSaveFolder,
    importNativeFiles,
    startMenuController,
    globalSearchOverlay,
    notificationCenterController,
    bindNotificationCenter,
    openNotification,
    showDesktopMenu,
    bindDesktopSelectionBox: () => desktopSurfaceController.bindSelectionBox(),
    cycleWindows,
    undoLastAction,
    openItem,
    deleteItems,
    markNotificationsRead,
    renderNotifications,
    keepWindowsInBounds,
    normalizeVisualSettings,
    normalizeSystemSettings,
    hotkeyActionForEvent,
    switchRelativeDesktop,
    customWallpaperCssUrl,
    firstRunScreenHTML,
    osVersion: OS_VERSION,
    initSteps: {
      shouldUseNativeStorage,
      ensureDesktops,
      applyStartupPreferences,
      shouldRestoreWindows: () => systemSettings().startup.restoreWindows,
      removeWorkspaceDocumentsFolders: removeWorkspaceDocumentsFoldersFromState,
      normalizeNotesData: () => normalizeNotesData(state),
      sanitizeWorkspaceWindowSessions,
      sanitizeExplorerSpaces,
      removeExplorerAppShortcuts: removeExplorerAppShortcutsFromState,
      initExternalSaveFolder: () => initExternalSaveFolder(),
      renderStart,
      renderTaskbarPinnedApps,
      startTaskReminderWatcher,
      restoreWindowsForCurrentDesktop
    },
    purgeExpiredTrash: () => purgeExpiredTrashItemsFromTarget(state, { dropActionHistory: true }),
    refreshRecycleBinWindows,
    updateClock,
    prepareCalendarForTray: () => {
      const today = todayISO();
      ui.calendar = { ...ui.calendar, view: "month", date: today, selected: today, editing: null };
    },
    systemPulse,
    setInterval: (callback, delay) => setInterval(callback, delay),
    setTimeout: (callback, delay) => setTimeout(callback, delay)
  });

  function importNativeFiles(fileList, parent = "desktop", x = 80, y = 80){
    importNativeFilesBatch(fileList, {
      parent,
      x,
      y,
      uid,
      uniqueName,
      isDesktopRoot,
      findFreeDesktopPosition,
      findFreeFolderPosition,
      helpers: {
        dataUrlWithMime,
        isDataImage,
        parseCSVRows,
        normalizeTableData,
        spreadsheetColumnName,
        plainToRichHtml
      },
      onSkipped: skipped => toast("Часть файлов пропущена", nativeImportSkippedSummary(skipped)),
      onItem: (id, item) => {
        state.fs[id] = item;
        saveState();
        renderAllFileSurfaces();
      },
      onComplete: ({ imported }) => toast("Файлы импортированы", `Добавлено: ${imported}`)
    });
  }

  async function exportOS(options = {}){
    return runDownloadBackupAction({
      syncBeforeExport: syncLiveEditorsBeforeExport,
      buildZip: buildDownloadOsDataZip,
      fileName: securityBackupFileName,
      download: downloadBlob,
      markBackup: ({ name, size, verification }) => {
        const meta = securityRuntimeController.securityMeta();
        const stateFile = verification?.manifest?.files?.find(file => file.path === "zeter-os-state.json");
        Object.assign(meta, {
          lastFullBackupAt: Date.now(),
          lastFullBackupSize: size,
          lastFullBackupName: name,
          lastBackupVerifiedAt: Date.now(),
          lastBackupVerified: Boolean(verification?.verified),
          lastBackupChecksum: stateFile?.value || "",
          lastBackupChecksumAlgorithm: stateFile?.algorithm || ""
        });
        recordSecurityEvent(meta, { type: "backup", tone: "ok", title: options.source === "pre-reset" ? "Создан страховочный ZIP перед сбросом" : options.source === "pre-cleanup" ? "Создан страховочный ZIP перед очисткой" : "Создан проверенный ZIP-бэкап", detail: `${name} · ${bytesToHuman(size)}` });
      },
      persistBackup: () => saveState({ skipExternalBackup: true, silentStorageError: true }),
      formatBytes: bytesToHuman,
      notify: toast,
      logError: error => console.error('[ZeTer OS export]', error)
    });
  }
  async function importOS(event){
    return runOsImportAction(event, {
      validateImportedState: validateImportedStateForImport,
      hydrateExternalAssets,
      requestPassphrase: file => prompt(`Бэкап «${file?.name || ".zeterbak"}» зашифрован. Введи парольную фразу:`, ""),
      decryptBackupBlob,
      preflightImport: (incoming, context) => securityRuntimeController.previewImport(incoming, context),
      createSafetyPoint: () => securityRuntimeController.createRestorePoint(null, { name: "Перед импортом", reason: "pre-import", silent: true }),
      requireSafetyPoint: true,
      captureCurrentState: () => cloneForBackup(state),
      replaceState: incoming => {
        Object.keys(state).forEach(key => delete state[key]);
        Object.assign(state, migrate(incoming));
      },
      rollbackState: previous => {
        Object.keys(state).forEach(key => delete state[key]);
        Object.assign(state, migrate(previous));
      },
      saveState,
      verifyAppliedState: () => securityRuntimeController.verifyAppliedImport(),
      onImported: ({ file, backupMetadata }) => securityRuntimeController.recordImportResult(true, { detail: `${file?.name || "бэкап"}${backupMetadata?.encrypted ? " · зашифрован" : ""}${backupMetadata?.verification?.verified ? " · контрольные суммы проверены" : " · legacy-формат"}` }),
      onImportFailed: (error, result) => securityRuntimeController.recordImportResult(false, { rolledBack: result?.rolledBack, detail: error?.message || String(error) }),
      notify: toast,
      scheduleReload: () => setTimeout(() => location.reload(), 800),
      logError: error => console.error("[ZeTer OS import]", error)
    });
  }

  function nextWallpaper(){
    const settings = deskSettings();
    settings.wallpaper = nextWallpaperValue(settings);
    applySettings();
    saveState();
  }

  let bootInitialized = false;

  async function loadStorageAndInitialize() {
    if (bootInitialized) return;
    state = await storageStateRuntimeController.loadStateForBoot();
    bootInitialized = true;
    init();
  }

  function showNativeStorageRecovery(error) {
    const guard = window.ZETER_BOOT_GUARD;
    const shown = guard?.showStorageRecovery?.({
      error,
      message: error?.message || "Не удалось прочитать data/zeter-os-state.json.",
      onRetry: loadStorageAndInitialize,
      onOpenData: () => nativeStorageCall("open_data_folder"),
      onOpenLogs: () => nativeStorageCall("open_logs_folder"),
      onClose: () => nativeStorageCall("close_app")
    });
    if (!shown) {
      guard?.reportFailure?.({
        kind: "storage_load_error",
        message: error?.message || "Не удалось прочитать data/zeter-os-state.json.",
        error
      });
    }
  }

  async function bootZeTerOs() {
    try {
      await loadStorageAndInitialize();
    } catch (error) {
      if (shouldUseNativeStorage()) showNativeStorageRecovery(error);
      else window.ZETER_BOOT_GUARD?.reportFailure?.({ kind: "storage_load_error", message: error?.message, error });
    }
  }

  document.addEventListener('DOMContentLoaded', bootZeTerOs);
})();
