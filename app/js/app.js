(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS config is not loaded.");
  const {
    STORAGE_KEY,
    OS_VERSION,
    OS_VERSION_NUMBER,
    LEGACY_DELETED_ROOT,
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
    firstRunScreenHTML,
    startFirstRunSetup,
    applyFirstRunDraft
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

  const deletionUtils = window.ZETER_DELETION_UTILS;
  if (!deletionUtils) throw new Error("ZeTer OS deletion utils are not loaded.");
  const { createDeletionController } = deletionUtils;

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

  const automationUtils = window.ZETER_AUTOMATION_UTILS;
  if (!automationUtils) throw new Error("ZeTer OS automation utils are not loaded.");
  const {
    normalizeAutomations,
    normalizeAutomationCategories,
    changeAutomationCategory,
    automationCategoryScope,
    normalizeAutomationRuntime,
    AUTOMATION_TEMPLATES,
    createAutomationRuntimeController
  } = automationUtils;

  const automationUiUtils = window.ZETER_AUTOMATION_UI_UTILS;
  if (!automationUiUtils) throw new Error("ZeTer OS automation UI utils are not loaded.");
  const {
    createAutomationApp
  } = automationUiUtils;

  const objectLinkUtils = window.ZETER_OBJECT_LINK_UTILS;
  if (!objectLinkUtils) throw new Error("ZeTer OS object link utils are not loaded.");
  const {
    normalizeObjectLinks
  } = objectLinkUtils;

  const objectLinkUiUtils = window.ZETER_OBJECT_LINK_UI_UTILS;
  if (!objectLinkUiUtils) throw new Error("ZeTer OS object link UI utils are not loaded.");
  const {
    createObjectLinksPanel
  } = objectLinkUiUtils;

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
    createFsItemRecord,
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
    trashRoot: LEGACY_DELETED_ROOT,
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
    openItem: openDesktopItem,
    renderDesktopStickies,
    canMoveInto,
    enableItemPointerDrag,
    enableDesktopItemPointerDrag,
    showDesktopMenu,
    showItemMenu
  } = desktopItemRuntimeController;

  const documentEditorRuntimeController = createDocumentEditorRuntimeController({
    getState: () => state,
    showContext,
    getDesktopRoot,
    createItem,
    saveState: saveStateWithNoteAutomation,
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
    nativeStorageCall,
    sanitizeExportPathPart,
    stripKnownExtension,
    toast,
    openExternalLink: target => openExternalTarget(target),
    copyText: copyTextToClipboard,
    objectLinksPanelFor,
    documentRef: document,
    itemInWorkspace,
    getWindowRecord: winId => ui.windows.get(winId),
    hasOtherDocumentWindow: (itemId, winId) => [...ui.windows].some(([id, record]) => id !== winId && record.appId === "editor" && record.params?.itemId === itemId),
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

  let securityRecoveryController = null;
  let googleDriveBackupController = null;
  let googleDriveSyncController = null;
  let driveIncomingUiController = null;
  const securityRuntimeController = createSecurityRuntimeController({
    getRecoveryController: () => securityRecoveryController,
    getDriveController: () => googleDriveBackupController,
    isMutationBlocked: () => recoveryApplying,
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
    loadNativeRestorePoints: query => query ? nativeStorageCall("load_restore_points", query) : nativeStorageCall("load_restore_points"),
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
    trashRoot: LEGACY_DELETED_ROOT,
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
    buildBackupForState: target => buildFullSecurityBackup({state:cloneForBackup(target)}),
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
      automations: renderAutomationsApp,
      links: renderLinkLibraryApp,
      prompts: renderPromptLibraryApp,
      calculations: renderBusinessCalculationsApp,
      timeTracking: renderTimeTrackingApp,
      contacts: renderContactsApp,
      automationEditor: renderAutomationEditorApp,
      shortcutEditor: renderShortcutEditorApp,
      itemSettings: renderItemSettingsApp,
      calculator: renderCalculatorApp,
      photos: renderPhotosApp,
      settings: renderSettingsApp,
      about: renderAboutApp,
      manualUpdate: renderManualUpdateApp,
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
      automationEditor: params => params?.mode === "edit" ? "Редактирование автоматизации" : "Новая автоматизация",
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
    saveState: saveStateWithTaskAutomation,
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
    closeWindow,
    createProjectOverview: createTaskProjectOverview,
    createProjectPersistence: createTaskProjectPersistence,
    persistProjectView: () => {
      syncOpenWindowsBeforeBackup();
      void Promise.resolve(saveState()).catch(error => toast("Представление не сохранено", error?.message || "Повторите выбор после устранения ошибки хранения."));
    }
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
  let searchRevision = 0;
  let appUpdateApplying = false;
  let recoveryApplying = false;
  let updateUiController = null;
  const ui = {
    z: 100,
    windows: new Map(),
    settingsSessions: new Map(),
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
    getOpeningSize: () => systemSettings().windows.openingSize,
    getOpeningPlacement: () => systemSettings().windows.placement,
    getLastOpeningRect: appId => systemSettings().windows.lastPositions[appId],
    rememberOpeningRect: (appId, rect) => { const current = systemSettings(); current.windows.lastPositions = { ...current.windows.lastPositions, [appId]: rect }; setSystemSettings(current); },
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
    syncTaskbar: () => taskbarController.syncWindows(),
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
    getActiveWindow: () => ui.activeWindow,
    minimizeWindow,
    persistWindows: persistOpenWindowsForCurrentDesktop,
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
    openItem: openStartItem,
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
    createDesktop: createVirtualDesktop,
    getPreferences: () => systemSettings().startMenu,
    updatePreferences: updateStartPreferences,
    searchResults: query => searchController.results(query, { ignoreFilters: true }),
    searchResultsHTML: results => window.ZETER_SEARCH_UI_UTILS.searchResultsListHTML(results,
      '<p class="start-empty">Ничего не найдено. Попробуйте другое слово.</p>'),
    openSearchResult: element => searchResultNavigator.openResult(element),
    getRecentItems: getStartRecentItems,
    openRecent: openStartItem,
    clearRecent: () => updateStartPreferences({ recentItems: [] }),
    desktopAction: startDesktopAction,
    quickAction: action => {
      closeFloating();
      if (action === "task") return openApp("taskedit", { mode: "create" });
      if (action === "explorer") return openApp("folder", { folderId: getExplorerRoot() });
      if (action === "note") {
        const id = createItem("note", "Новая заметка", getDesktopRoot(), 120, 120, { content: "", richContent: "" });
        return openItem(id);
      }
    }
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
    removeTaskbarButton: winId => {
      $(`.taskbar-app[data-win-id="${cssEscape(winId)}"]`)?.remove();
      taskbarController.syncWindows();
    }
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
    trashRoot: LEGACY_DELETED_ROOT
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
    trashRoot: LEGACY_DELETED_ROOT,
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

  const deletionController = createDeletionController({
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
    normalizeStartPinnedState,
    descendantIds: descendants,
    uniqueName,
    persistTransaction: operation => persistSearchAwareTransaction(write => operation(snapshot => {
      syncLegacyWorkspaceAliases(snapshot);
      return write(snapshot, { requirePrimary: true });
    })),
    renderAllFileSurfaces,
    toast,
    confirm: message => confirm(message),
    rememberDeletedIdsInTarget: rememberDeletedIdsForNativePurgeInTarget,
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
    getBrowserPayloadStore:()=>browserCloudPayloadStore,
    openShortcutTarget: (target, name) => openShortcutTarget(target, name),
    openDocument: async file => {
      let item = Object.values(state.fs).find(entry => !entry.deletedAt && entry.type === "managedFile" && entry.managedFile?.managedPath === file.managedPath);
      if (!item) {
        const id = await createItem("managedFile", file.name, getDesktopRoot(), 80, 80, { extension: file.extension, managedFile: { ...file } });
        item = state.fs[id];
      }
      if (!item) throw new Error("Не удалось открыть копию документа в data.");
      openApp("editor", { itemId: item.id });
      return true;
    },
    nativeMode: shouldUseNativeStorage,
    toast,
    confirm: message => confirm(message),
    documentRef: document
  });
  managedFileRuntimeController.bind();

  const desktopSurfaceController = createDesktopSurfaceController({
    getSettings: deskSettings,
    getSurface: () => $("#desktop"),
    getSelectionBox: () => $("#selection-box"),
    getContainer: () => $("#desktop-items"),
    getRootId: getDesktopRoot,
    getItems: () => Object.values(state.fs).filter(item => item.parent === getDesktopRoot() && !item.deletedAt && !item.hiddenFromDesktop && item.systemRole !== "explorerRoot" && !(item.type === "app" && item.appId === "notes")),
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
    requestDeletion: (model, execute) => shellUiUtils.showDesktopDeletionDialog(model, execute, { download: () => downloadDesktopBackup(model) }),
    queueMutation: operation => queueAutomationMutation(operation),
    persistTransaction: persistSearchAwareTransaction,
    pruneReferences: (target, ids) => pruneTargetReferencesForRemovedItems(target, ids),
    onRemovedItems: ids => removedItemReferencesController.closeWindowsForRemovedItems(ids),
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
      const surface = $("#desktop-items");
      if (surface) { surface.scrollLeft = 0; surface.scrollTop = 0; }
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
    setState: value => { state = value; searchRevision += 1; },
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

  function removeLegacyFullStateFromLocalStorage(record = {}) {
    return removeLegacyFullStateFromLocalStorageFromStorage({ storage: localStorage, storageKey: STORAGE_KEY, primaryUpdatedAt: record.updatedAt, warn: (...args) => console.warn(...args) });
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
    searchRevision += 1;
    const barrier = primaryStateSaveQueue.barrier();
    if (barrier) {
      const deferred = barrier.then(() => saveState(options));
      deferred.catch(() => {});
      return deferred;
    }
    syncLegacyWorkspaceAliases(state);
    const savePromise = Promise.resolve(storageStateRuntimeController.saveState(options)).then(result => {
      if (result?.skipped || result?.saved === false) {
        throw new Error("Хранилище ещё не готово к записи.");
      }
      googleDriveSyncController?.requestSync?.();
      return result;
    }).finally(() => { searchRevision += 1; });
    savePromise.catch(() => {});
    return savePromise;
  }

  function persistSearchAwareTransaction(operation) {
    return primaryStateSaveQueue.transaction(operation).then(result=>{googleDriveSyncController?.requestSync?.();return result;}).finally(() => { searchRevision += 1; });
  }

  function persistSearchPreferences(ownerState, ownerSettings) {
    return persistSearchAwareTransaction(async write => {
      if (state !== ownerState || state.searchSettings !== ownerSettings) throw new Error("Состояние поиска изменилось. Повторите выбор.");
      syncLegacyWorkspaceAliases(state);
      const snapshot = cloneForBackup(state);
      const saved = await write(snapshot);
      if (saved?.saved !== true) throw new Error("Хранилище не подтвердило настройки поиска.");
      writeSmallSettingsToLocalStorage();
      return { ...saved, searchSettings: snapshot.searchSettings };
    });
  }

  function storedStateSizeBytes() {
    return storageStateRuntimeController.storedStateSizeBytes();
  }

  function migrate(s) {
    return migrateStateWithRuntime(s, { apps });
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

  function rememberDeletedIdsForNativePurge(deletedIds = new Set()) {
    return rememberDeletedIdsForNativePurgeInTarget(state, deletedIds);
  }

  function permanentlyRemoveItemsFromBrowserState(ids = [], options = {}) {
    return deletionController.permanentlyRemoveItems(ids, options);
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

  function updateStartPreferences(patch) {
    return persistSearchAwareTransaction(async write => {
      syncLegacyWorkspaceAliases(state);
      const current = systemSettings().startMenu;
      const changes = typeof patch === "function" ? patch(current) : patch;
      const next = systemSettingsUtils.normalizeStartMenuPreferences({ ...current, ...changes });
      const snapshot = cloneForBackup(state);
      snapshot.systemSettings = normalizeSystemSettings({ ...snapshot.systemSettings, startMenu: next });
      const result = await write(snapshot);
      if (!result?.saved) throw new Error("Настройки не сохранены. Проверьте доступность хранилища и повторите.");
      state.systemSettings = { ...systemSettings(), startMenu: next };
      return next;
    });
  }

  function startItemDesktop(item) {
    if (!item || item.deletedAt || item.parent === LEGACY_DELETED_ROOT) return null;
    return state.desktops.find(desktop => itemInWorkspace(item, desktop.id)
      || (desktop.data?.explorerRootId && itemInWorkspace(item, desktop.data.explorerRootId))) || null;
  }

  function getStartRecentItems() {
    return systemSettings().startMenu.recentItems.flatMap(entry => {
      const item = state.fs[entry.id];
      const desktop = startItemDesktop(item);
      return desktop ? [{ id: item.id, name: item.name, icon: itemIcon(item), desktopName: desktopName(desktop.id) }] : [];
    }).slice(0, 4);
  }

  function recordStartRecentItem(id) {
    const item = state.fs[id];
    if (!item || !["text", "note", "markdown", "table", "tasklist", "managedFile", "image", "paint"].includes(item.type)
      || !startItemDesktop(item) || !systemSettings().startMenu.showRecent) return;
    const openedAt = Date.now();
    void updateStartPreferences(current => current.showRecent ? {
      recentItems: [{ id, openedAt }, ...current.recentItems.filter(entry => entry.id !== id)]
    } : {}).catch(error => toast("История не сохранена", error?.message || "Повторите после восстановления хранилища."));
  }

  function openItem(id) {
    const result = openDesktopItem(id);
    if (state.fs[id]?.type === "managedFile") {
      void Promise.resolve(result).then(value => { if (value === true) recordStartRecentItem(id); })
        .catch(error => toast("Не удалось открыть файл", error?.message || state.fs[id]?.name || "Файл недоступен."));
    }
    return result;
  }

  function openStartItem(id) {
    const desktop = startItemDesktop(state.fs[id]);
    if (!desktop) return;
    closeFloating();
    if (desktop.id !== getDesktopRoot()) switchVirtualDesktop(desktop.id);
    return openItem(id);
  }

  async function startDesktopAction(action, id) {
    const desktop = state.desktops.find(entry => entry.id === id);
    if (!desktop) return;
    if (action === "rename") {
      const name = prompt("Название рабочего стола:", desktopName(id));
      if (name === null || !name.trim()) return;
      try {
        await persistSearchAwareTransaction(async write => {
          const live = state.desktops.find(entry => entry.id === id);
          if (!live) throw new Error("Рабочий стол уже удалён.");
          syncLegacyWorkspaceAliases(state);
          const snapshot = cloneForBackup(state);
          snapshot.desktops.find(entry => entry.id === id).name = name.trim().slice(0, 80);
          const result = await write(snapshot);
          if (!result?.saved) throw new Error("Хранилище ещё не готово к записи.");
          const target = state.desktops.find(entry => entry.id === id);
          if (target) target.name = name.trim().slice(0, 80);
        });
        renderDesktop();
        renderStart();
      } catch (error) { toast("Название не сохранено", error?.message || "Повторите попытку."); }
      return;
    }
    if (action === "settings") {
      closeFloating();
      if (id !== getDesktopRoot()) switchVirtualDesktop(id);
      openApp("settings");
    }
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
  function deskAutomations() {
    const workspace = currentWorkspace();
    workspace.automations = normalizeAutomations(workspace.automations);
    return workspace.automations;
  }
  function deskObjectLinks() {
    const workspace = currentWorkspace();
    workspace.objectLinks = normalizeObjectLinks(workspace.objectLinks);
    return workspace.objectLinks;
  }
  function setDeskTasks(tasks) { return workspaceRuntimeController.setDeskTasks(tasks); }
  function setDeskEvents(events) { return workspaceRuntimeController.setDeskEvents(events); }
  function setDeskNotifications(notifications) { return workspaceRuntimeController.setDeskNotifications(notifications); }
  function setDeskAutomations(automations) {
    const workspace = currentWorkspace();
    workspace.automations = normalizeAutomations(automations);
    scheduleAutomationCheck();
    return workspace.automations;
  }
  function setDeskObjectLinks(objectLinks) {
    const workspace = currentWorkspace();
    workspace.objectLinks = normalizeObjectLinks(objectLinks);
    return workspace.objectLinks;
  }
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
    const desktopId = virtualDesktopController.create();
    if (desktopId) {
      seedAutomationEventBaselines();
      scheduleAutomationCheck();
    }
    return desktopId;
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
    const previousDesktopId = getDesktopRoot();
    const switched = virtualDesktopController.switchTo(id);
    if (switched && getDesktopRoot() !== previousDesktopId) {
      seedAutomationEventBaselines();
      scheduleAutomationCheck();
    }
    return switched;
  }

  async function downloadDesktopBackup(model) {
    syncLiveEditorsBeforeExport();
    const snapshot = workspaceUtils.desktopBackupSnapshot(state, model.id);
    model.signature = workspaceUtils.desktopDeletionModel(state, model.id).signature;
    // Resolve exported images in a detached snapshot; never include another desktop.
    const hydration = await hydrateExternalAssets({ settings: snapshot.desktop.data.settings || {}, desktops: [snapshot.desktop], fs: snapshot.fs });
    if (hydration?.missing) throw new Error(`Не удалось включить ${hydration.missing} изображений. Выберите доступную папку исходных ресурсов и повторите скачивание.`);
    if (shouldUseNativeStorage()) return nativeStorageCall("save_desktop_backup", snapshot);
    const hasNativePayload = value => value && typeof value === "object" && Object.entries(value).some(([key, entry]) =>
      ((key === "managedPath" || key === "assetPath") && Boolean(entry)) || hasNativePayload(entry));
    if (hasNativePayload(snapshot)) throw new Error("Этот стол содержит вложения из папки data. Скачайте полный архив из Windows-версии ZeTer OS, чтобы включить сами файлы.");
    const payload = { app: "ZeTer OS", format: "zeter-desktop-backup", version: 1, createdAt: new Date().toISOString(), ...snapshot };
    const blob = await createZipBlob([
      { path: "desktop.json", blob: new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }) },
      { path: "README.txt", blob: new Blob(["Архив одного рабочего стола ZeTer OS. desktop.json содержит документы, настройки, задачи, календарь, ссылки и прочие данные этого стола. Это архив данных, а не полный бэкап ОС. Внешние папки Windows и сайты по ссылкам не копируются. Изображения встроены в JSON.\n"], { type: "text/plain;charset=utf-8" }) }
    ]);
    const result = await downloadBlob(`ZeTer_${sanitizeExportPathPart(model.name, "Рабочий стол")}.zip`, blob);
    return { ...result, browser: true };
  }

  async function deleteVirtualDesktop(id) {
    let removed;
    try { removed = await virtualDesktopController.remove(id); }
    catch (error) { toast("Рабочий стол не удалён", error.message); return false; }
    if (removed) {
      seedAutomationEventBaselines();
      scheduleAutomationCheck();
    }
    return removed;
  }

  function clearDesktopSelection(options = {}) {
    return desktopSurfaceController.clear(options);
  }

  function renderDesktop() {
    const mobileName = $("#mobile-desktop-name");
    if (mobileName) {
      const name = desktopName(getDesktopRoot());
      mobileName.textContent = name;
      mobileName.title = name;
    }
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
    refreshProjectOverviews();
  }

  function cleanupRemovedItemReferences(ids = []) { return removedItemReferencesController.cleanup(ids); }

  function normalizeNotesData(target = state) {
    return normalizeNotesDataForTarget(target, { appCenterName: apps.appcenter?.name, helpName: apps.help?.name });
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
      placement: options.placement,
      title: options.title,
      returnFocus: options.returnFocus
    });
  }

  function showContextNearElement(event, entries, placement = "above") {
    showContext(event.clientX, event.clientY, entries, {
      anchorEl: event.currentTarget || event.target,
      placement
    });
  }

  function folderNameExists(parent, name, excludeId = null) { return fsItemController.folderNameExists(parent, name, excludeId); }
  function createItem(type, name, parent = getDesktopRoot(), x = 40, y = 40, extra = {}) {
    const id = fsItemController.createItem(type, name, parent, x, y, extra);
    if (id && type === "note") enqueueExternalAutomationEvent("note_created", state.fs?.[id]);
    return id;
  }
  function createFolderInFolder(parent = getDesktopRoot(), options = {}) { return fsItemController.createFolder(parent, options); }
  function uniqueName(name, parent, excludeId = null) { return fsItemController.uniqueName(name, parent, excludeId); }

  function renameItem(itemId) { return fsItemController.renameItem(itemId); }
  function duplicateItem(itemId) { return fsItemController.duplicateItem(itemId); }

  function deleteItem(itemId, options = {}) { return deletionController.deleteItem(itemId, options); }

  function itemPath(item = {}) { return fsItemController.itemPath(item); }

  function showItemProperties(itemId) { return fsItemController.showProperties(itemId); }

  function deleteItems(ids = []) { return deletionController.deleteItems(ids); }

  function cycleWindows(reverse = false) { return windowRuntimeController.cycleWindows(reverse); }

  function descendants(folderId) {
    return descendantIdsInFs(state.fs, folderId);
  }

  function openByDataApp(id) { return shellRuntimeController.openByDataApp(id); }
  function openApp(appId, params = {}, options = {}) {
    const result = windowRuntimeController.openApp(appId, params, options);
    if (params.itemId && !options.restoring && [...ui.windows.values()].some(record =>
      record.appId === appId && record.params?.itemId === params.itemId && record.desktopId === getDesktopRoot())) {
      recordStartRecentItem(params.itemId);
    }
    return result;
  }

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
    const viewDesktopId = state.currentDesktop;
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
      itemKind: startItemKind,
      desktopView: deskSettings().explorerView,
      saveView: (folderId, patch) => persistSearchAwareTransaction(async write => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = cloneForBackup(state);
        const folder = snapshot.fs[folderId];
        const settings = snapshot.desktops.find(desk => desk.id === viewDesktopId)?.data?.settings;
        const previous = folder?.explorerView || (folder?.type === "folder" ? { ...settings?.explorerView, columnWidths: {} } : settings?.explorerView) || {};
        const view = explorerUiUtils.normalizeExplorerView({ ...previous, ...patch, columnWidths: { ...previous.columnWidths, ...patch.columnWidths } });
        if (folder?.type === "folder") folder.explorerView = view;
        else if (isDesktopRoot(folderId)) snapshot.desktops.find(desk => desk.id === viewDesktopId).data.settings.explorerView = view;
        else throw new Error("Папка больше недоступна.");
        const result = await write(snapshot);
        if (!result?.saved) throw new Error("Не удалось сохранить вид папки.");
        if (state.fs[folderId]?.type === "folder") state.fs[folderId].explorerView = view;
        else if (isDesktopRoot(folderId)) {
          const desktop = state.desktops.find(desk => desk.id === viewDesktopId);
          if (desktop?.data?.settings) desktop.data.settings.explorerView = view;
        }
        return view;
      }),
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

  const OBJECT_LINKABLE_FS_TYPES = new Set(["note", "text", "markdown", "table", "managedFile", "image", "paint"]);
  const OBJECT_LINK_FS_TYPE_LABELS = Object.freeze({
    note: "Заметка",
    text: "Документ",
    markdown: "Markdown",
    table: "Таблица",
    managedFile: "Файл",
    image: "Изображение",
    paint: "Рисунок"
  });

  function objectLinkPresentation(endpoint = {}) {
    if (endpoint.kind === "event") {
      const event = deskEvents().find(item => item.id === endpoint.id);
      return event ? { label: event.title || "Событие", typeLabel: "Событие" } : null;
    }
    const item = state.fs?.[endpoint.id];
    if (!item || !OBJECT_LINKABLE_FS_TYPES.has(item.type) || !itemInWorkspace(item, getDesktopRoot())) return null;
    return { label: item.name || "Объект", typeLabel: OBJECT_LINK_FS_TYPE_LABELS[item.type] || "Файл" };
  }

  function objectLinkCandidates() {
    const files = workspaceItems(getDesktopRoot())
      .filter(item => OBJECT_LINKABLE_FS_TYPES.has(item.type))
      .map(item => ({
        endpoint: { kind: "fs", id: item.id },
        label: item.name || "Объект",
        typeLabel: OBJECT_LINK_FS_TYPE_LABELS[item.type] || "Файл"
      }));
    const events = deskEvents().map(event => ({
      endpoint: { kind: "event", id: event.id },
      label: `${event.title || "Событие"}${event.date ? ` · ${formatDate(event.date)}` : ""}`,
      typeLabel: "Событие"
    }));
    return [...files, ...events];
  }

  function openLinkedObject(endpoint = {}) {
    if (endpoint.kind === "fs") {
      const item = state.fs?.[endpoint.id];
      if (item && itemInWorkspace(item, getDesktopRoot())) {
        openItem(item.id);
        return true;
      }
    } else if (endpoint.kind === "event" && deskEvents().some(event => event.id === endpoint.id)) {
      openApp("calendaredit", { mode: "edit", eventId: endpoint.id });
      return true;
    }
    toast("Связанный объект не найден", "Он мог быть удалён или перемещён на другой рабочий стол.");
    return false;
  }

  function addObjectLink(left, right) {
    return persistAutomationMutation(() => {
      const current = deskObjectLinks();
      const next = normalizeObjectLinks([...current, {
        id: uid("object_link"),
        a: left,
        b: right,
        createdAt: Date.now()
      }]);
      if (next.length === current.length) return false;
      setDeskObjectLinks(next);
      return true;
    });
  }

  function removeObjectLink(linkId = "") {
    return persistAutomationMutation(() => {
      const current = deskObjectLinks();
      const next = current.filter(link => link.id !== linkId);
      if (next.length === current.length) return false;
      setDeskObjectLinks(next);
      return true;
    });
  }

  function objectLinksPanelFor(endpoint) {
    return createObjectLinksPanel({
      document,
      endpoint,
      getLinks: deskObjectLinks,
      getCandidates: objectLinkCandidates,
      resolveEndpoint: objectLinkPresentation,
      openLinkedObject,
      addLink: addObjectLink,
      removeLink: removeObjectLink
    });
  }

  function automationFolderOptions() {
    const root = getDesktopRoot();
    return [
      { id: root, label: `Рабочий стол «${desktopName(root)}»`, isDesktop: true },
      ...workspaceItems(root)
        .filter(item => item.type === "folder" && !item.systemRole && !item.deletedAt)
        .map(item => ({ id: item.id, label: `Папка «${item.name || "Без названия"}»` }))
    ];
  }

  function automationEventOptions() {
    return deskEvents().map(event => ({
      id: event.id,
      label: `${event.title || "Событие"}${event.date ? ` · ${formatDate(event.date)}` : ""}`
    }));
  }

  function automationFileFolderName(file) {
    const parentId = file?.parent || "";
    if (!parentId) return "";
    if (parentId === getDesktopRoot()) return desktopName(parentId);
    return state.fs?.[parentId]?.name || "";
  }

  function returnToAutomations(winId, categoryId = "*") {
    closeWindow(winId);
    const existing = [...ui.windows.values()].find(record => record.appId === "automations" && record.desktopId === getDesktopRoot());
    if (!existing) return openApp("automations", { categoryId });
    existing.params.categoryId = categoryId;
    refreshWindow(existing.winId);
    existing.el.classList.remove("minimized");
    focusWindow(existing.winId);
    persistOpenWindowsForCurrentDesktop();
  }

  function openAutomationEditor(draft) {
    const editing = deskAutomations().some(rule => rule.id === draft.id);
    const existing = editing && [...ui.windows.values()].find(record => record.appId === "automationedit" && record.params?.automationId === draft.id && record.desktopId === getDesktopRoot());
    if (existing) {
      existing.el.classList.remove("minimized");
      focusWindow(existing.winId);
      return;
    }
    return openApp("automationedit", editing
      ? { mode: "edit", automationId: draft.id }
      : { mode: "create", draft });
  }

  function renderAutomationEditorApp(params = {}, winId) {
    return renderAutomationsApp(params, winId, true);
  }

  function renderAutomationsApp(params = {}, winId, editorOnly = false) {
    const workspaceId = getDesktopRoot();
    const initialDraft = params.mode === "edit" ? deskAutomations().find(rule => rule.id === params.automationId) : params.draft;
    return createAutomationApp({
      document,
      editorOnly,
      initialDraft,
      initialError: editorOnly && params.mode === "edit" && !initialDraft ? "Автоматизация удалена. Вернись к списку и выбери другое правило." : "",
      openEditor: openAutomationEditor,
      closeEditor: () => returnToAutomations(winId),
      onSaved: rule => returnToAutomations(winId, rule.categoryId || ""),
      saveDraft: editorOnly ? draft => commitAutomationDraft(draft, { workspaceId, editingId: params.mode === "edit" ? params.automationId : "" }) : null,
      getAutomations: deskAutomations,
      setAutomations: setDeskAutomations,
      saveState,
      commitAutomations: commitAutomationList,
      getRuntime: automationRuntimeForUi,
      getCategories: () => normalizeAutomationCategories(currentWorkspace().automationCategories),
      getCategoryFilter: () => params.categoryId ?? "*",
      setCategoryFilter: categoryId => { params.categoryId = categoryId; },
      mutateCategory: change => persistAutomationMutation(() => {
        if (getDesktopRoot() !== workspaceId) throw new Error("Рабочий стол изменился. Открой категории заново.");
        return changeAutomationCategory(currentWorkspace(), change);
      }),
      previewAutomation: previewAutomationForUi,
      runAutomation: runAutomationManually,
      setGlobalPaused: setAutomationsGloballyPaused,
      clearHistory: clearAutomationHistory,
      templates: AUTOMATION_TEMPLATES,
      getSampleContext: automationSampleContext,
      getFileOptions: automationFileOptions,
      openSourceFolder: openAutomationSourceFolder,
      openSampleFile: openAutomationSampleFile,
      confirmUser: confirm,
      toast,
      uid,
      getEventOptions: automationEventOptions,
      getFolderOptions: automationFolderOptions,
      resolveLabel: (kind, id) => {
        if (kind === "event") return deskEvents().find(event => event.id === id)?.title || "";
        if (kind === "folder") return automationFolderOptions().find(folder => folder.id === id)?.label || "";
        if (id === getDesktopRoot()) return desktopName(id);
        return state.fs?.[id]?.name || "";
      }
    });
  }

  function renderTasksApp(params = {}, winId) { return taskAppRuntimeController.renderTasksApp(params, winId); }
  function refreshProjectOverviews(workspaceId = getDesktopRoot()) {
    ui.windows.forEach(record => {
      if (["tasks", "tasklist"].includes(record.appId) && record.desktopId === workspaceId) {
        record.el.querySelector(".project-overview-content")?.refreshProjectOverview?.();
      }
    });
  }
  function createWorkspaceTimeController(workspaceId) {
    return window.ZETER_TIME_TRACKING_UTILS.createTimeTrackingController({
      getWorkspace: () => state.desktops.find(desk => desk.id === workspaceId)?.data || null,
      createId: uid,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, tracking) => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop) throw new Error("Рабочий стол недоступен.");
        desktop.data.timeTracking = tracking;
        return write(snapshot);
      }
    });
  }
  function createTaskProjectPersistence(store, params, winId) {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const original = store.item || state.desktops.find(desk => desk.id === workspaceId)?.data;
    const getStore = () => {
      if (getDesktopRoot() !== workspaceId) return null;
      const source = store.item ? state.fs[store.item.id] : state.desktops.find(desk => desk.id === workspaceId)?.data;
      if (source !== original || (store.item && (source.deletedAt || source.type !== "tasklist" || !itemInWorkspace(source, workspaceId)))) return null;
      return source;
    };
    return {
      getStore,
      afterCreate: () => {
        syncLegacyWorkspaceAliases(state); writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
        ui.windows.forEach(record => { if (record.appId === "timetracking" && record.desktopId === workspaceId) record.el.querySelector(".time-tracking-app")?.refreshTimeTracking?.(); });
      },
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, candidate) => {
        if (!getStore()) throw new Error("Список задач недоступен. Откройте приложение заново.");
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const target = store.item ? snapshot.fs[store.item.id] : snapshot.desktops.find(desk => desk.id === workspaceId)?.data;
        if (!target) throw new Error("Список задач недоступен.");
        Object.assign(target, candidate);
        syncLegacyWorkspaceAliases(snapshot);
        return write(snapshot);
      }
    };
  }

  function createTaskProjectOverview(store, params, winId, showBoard, getCategoryId = () => "all") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const getWorkspace = () => state.desktops.find(desk => desk.id === workspaceId)?.data || null;
    const getStore = () => {
      if (!getWorkspace() || getDesktopRoot() !== workspaceId) return null;
      if (!store.item) return getWorkspace();
      const item = state.fs[store.item.id];
      return item && item.type === "tasklist" && !item.deletedAt && itemInWorkspace(item, workspaceId) ? item : null;
    };
    const resolveAttachment = ref => {
      if (getDesktopRoot() !== workspaceId) return null;
      if (ref.kind === "event") {
        const event = getWorkspace()?.events?.find(item => item.id === ref.id);
        return event ? { label: event.title || "Событие", typeLabel: `${formatDate(event.date)}${event.time ? ` · ${event.time}` : ""}${event.repeat && event.repeat !== "none" ? " · повторяется" : ""}` } : null;
      }
      const item = state.fs[ref.id];
      if (!item || item.deletedAt || !itemInWorkspace(item, workspaceId) || ![...OBJECT_LINKABLE_FS_TYPES, "folder", "tasklist", "shortcut"].includes(item.type)) return null;
      return { label: item.name || "Материал", typeLabel: OBJECT_LINK_FS_TYPE_LABELS[item.type] || (item.type === "folder" ? "Папка" : item.type === "tasklist" ? "Список задач" : "Ярлык") };
    };
    const controller = window.ZETER_TASK_APP_UI_UTILS.createTaskProjectAttachmentController({
      getStore, resolveAttachment,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, projects) => {
        if (!getStore()) throw new Error("Список задач недоступен.");
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const target = store.item ? snapshot.fs[store.item.id] : snapshot.desktops.find(desk => desk.id === workspaceId)?.data;
        if (!target) throw new Error("Список задач недоступен.");
        target.taskProjects = projects;
        syncLegacyWorkspaceAliases(snapshot);
        return write(snapshot);
      }
    });
    const time = createWorkspaceTimeController(workspaceId);
    const changed = () => {
      syncLegacyWorkspaceAliases(state); writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
      securityRuntimeController.scheduleProtectionCheck();
      refreshProjectOverviews(workspaceId);
      ui.windows.forEach(record => { if (record.appId === "timetracking" && record.desktopId === workspaceId) record.el.querySelector(".time-tracking-app")?.refreshTimeTracking?.(); });
    };
    return window.ZETER_PROJECT_OVERVIEW_UI_UTILS.createProjectOverview({
      documentRef: document, controller, isTaskList: store.kind === "tasklist", showBoard,
      createTask: () => {
        const source = getStore();
        if (!source) return;
        openApp("taskedit", { mode: "create", projectId: source.activeTaskProjectId, categoryId: ["all", "none"].includes(getCategoryId()) ? "" : getCategoryId(), ...(store.item ? { itemId: store.item.id } : {}) });
      },
      getContext: () => {
        const source = getStore();
        const project = source?.taskProjects?.find(item => item.id === source.activeTaskProjectId);
        const candidates = getDesktopRoot() === workspaceId ? [
          ...workspaceItems(workspaceId).filter(item => !item.deletedAt && resolveAttachment({ kind: "fs", id: item.id })).map(item => ({ endpoint: { kind: "fs", id: item.id }, ...resolveAttachment({ kind: "fs", id: item.id }) })),
          ...(getWorkspace()?.events || []).map(event => ({ endpoint: { kind: "event", id: event.id }, ...resolveAttachment({ kind: "event", id: event.id }) }))
        ] : [];
        return { project, tasks: source?.tasks || [], categoryId: getCategoryId(), workspace: store.kind === "tasklist" ? {} : getWorkspace() || {}, candidates, resolveAttachment, needsRecovery: time.needsRecovery() };
      },
      openAttachment: ref => { if (resolveAttachment(ref)) openLinkedObject(ref); },
      openTask: taskId => openApp("taskedit", { taskId, ...(store.item ? { itemId: store.item.id } : {}) }),
      openTime: () => openApp("timetracking", { projectId: getStore()?.activeTaskProjectId }),
      startTimer: (taskId, projectId) => {
        const source = getStore();
        if (store.kind === "tasklist" || !source?.tasks?.some(task => task.id === taskId && task.projectId === projectId)) throw new Error("Задача недоступна.");
        return time.start({ taskId });
      },
      onChange: changed
    });
  }
  function refreshOpenTaskBoards(excludeWinId = "") { taskAppRuntimeController.refreshOpenTaskBoards(excludeWinId); }
  function renderTaskEditorApp(params = {}, winId) { return taskAppRuntimeController.renderTaskEditorApp(params, winId); }
  function refreshOpenCalendars(excludeWinId = "") {
    ui.windows.forEach((record, winId) => {
      if (winId !== excludeWinId && record.appId === "calendar") {
        const calendar = record.el?.querySelector(".calendar-app");
        if (typeof calendar?.refreshCalendar === "function") calendar.refreshCalendar();
        else refreshWindow(winId);
      }
    });
  }
  function calendarPersistenceOptions(workspaceId) {
    const getWorkspace = () => state.desktops.find(desk => desk.id === workspaceId)?.data || null;
    return {
      getWorkspace, createId: uid, queueMutation: queueAutomationMutation,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: async (write, events, mutation = {}) => {
        const workspace = getWorkspace();
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop || !workspace) throw new Error("Рабочий стол недоступен.");
        desktop.data.events = events;
        if (mutation.created) {
          // Queue event-created automations in the same staged snapshot as the event.
          createAutomationRuntimeController({ getState: () => snapshot, getWorkspace: () => desktop.data }).enqueueEvent({
            type: "event_created", event: mutation.event, eventKey: `created:${mutation.event.createdAt}`
          });
        }
        syncLegacyWorkspaceAliases(snapshot);
        const saved = await write(snapshot);
        if (saved?.saved === true && mutation.created) {
          workspace.automationRuntime = desktop.data.automationRuntime;
          automationEventBaseline.set(`${workspaceId}:${mutation.event.id}`, {
            createdAt: mutation.event.createdAt, updatedAt: mutation.event.updatedAt
          });
          scheduleAutomationCheck();
        }
        return saved;
      }
    };
  }
  function calendarMutationSaved() {
    syncLegacyWorkspaceAliases(state);
    writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
    securityRuntimeController.scheduleProtectionCheck(); refreshProjectOverviews();
  }
  function calendarWorkspaceTools(workspaceId, ownerWindowId = "") {
    const getWorkspace = () => state.desktops.find(desk => desk.id === workspaceId)?.data;
    const importedMaterials = new WeakMap();
    const preferences = () => window.ZETER_WORKSPACE_UTILS.normalizeWorkspaceCalendarState(getWorkspace()?.calendarState);
    const resolveAttachment = ref => {
      const item = ref?.kind === "fs" ? state.fs?.[ref.id] : null;
      if (!item || item.deletedAt || !itemInWorkspace(item, workspaceId) || !OBJECT_LINKABLE_FS_TYPES.has(item.type)) return null;
      return { label: item.name || "Файл", title: item.name || "Файл", typeLabel: OBJECT_LINK_FS_TYPE_LABELS[item.type] || "Файл" };
    };
    const saveWorkspacePatch = operation => queueAutomationMutation(() => persistSearchAwareTransaction(async write => {
      const workspace = getWorkspace();
      if (!workspace) throw new Error("Рабочий стол недоступен. Откройте календарь заново.");
      const patch = operation(workspace);
      syncLegacyWorkspaceAliases(state);
      const snapshot = JSON.parse(JSON.stringify(state));
      const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
      if (!desktop) throw new Error("Рабочий стол недоступен.");
      Object.assign(desktop.data, patch);
      syncLegacyWorkspaceAliases(snapshot);
      const saved = await write(snapshot);
      if (saved?.saved !== true) throw new Error("Хранилище не подтвердило запись. Ввод сохранён; повторите попытку.");
      Object.assign(workspace, patch);
      calendarMutationSaved();
      return patch;
    }));
    return {
      getAttachmentCandidates: () => workspaceItems(workspaceId).filter(item => resolveAttachment({ kind: "fs", id: item.id })).map(item => ({ endpoint: { kind: "fs", id: item.id }, kind: "fs", id: item.id, ...resolveAttachment({ kind: "fs", id: item.id }) })),
      resolveAttachment,
      openAttachment: ref => {
        if (getDesktopRoot() !== workspaceId || !resolveAttachment(ref)) throw new Error("Файл удалён или недоступен на этом рабочем столе.");
        openItem(ref.id);
      },
      canUploadEventFiles: () => shouldUseNativeStorage(),
      importEventFiles: async files => {
        if (!shouldUseNativeStorage()) throw new Error("Загрузка с компьютера доступна в Windows/Python. Выберите файл из рабочего стола.");
        const selected = Array.from(files || []);
        if (!selected.length || selected.length > 200) throw new Error("Выберите от 1 до 200 файлов.");
        const attachments = [];
        for (const file of selected) {
          try {
            if (!getWorkspace() || getDesktopRoot() !== workspaceId) throw new Error("Вернитесь на рабочий стол события перед загрузкой файла.");
            const cached = importedMaterials.get(file);
            if (cached?.ref && state.fs[cached.ref.id]) { attachments.push(cached.ref); continue; }
            const managedFile = cached?.managedFile || await window.ZETER_MANAGED_FILE_UTILS.copyFileToManagedStorage(file, { nativeStorageCall });
            importedMaterials.set(file, { managedFile });
            const ref = await queueAutomationMutation(() => persistSearchAwareTransaction(async write => {
              if (!getWorkspace()) throw new Error("Рабочий стол недоступен. Копия файла сохранена в папке данных.");
              syncLegacyWorkspaceAliases(state);
              const snapshot = JSON.parse(JSON.stringify(state));
              const result = window.ZETER_FS_ITEM_UTILS.createFsItemRecord(snapshot.fs, "managedFile", file.name, workspaceId, { uid, extra: { extension: managedFile.extension, managedFile }, x: 40, y: 40 });
              if (state.fs[result.keyId]) throw new Error("Не удалось создать уникальный ID файла.");
              snapshot.fs[result.keyId] = result.item;
              const saved = await write(snapshot);
              if (saved?.saved !== true) throw new Error("Хранилище не подтвердило добавление файла. Копия остаётся в папке данных; событие пока не сохранено.");
              state.fs[result.keyId] = result.item;
              return { kind: "fs", id: result.keyId };
            }));
            attachments.push(ref);
            importedMaterials.set(file, { managedFile, ref });
            renderAllFileSurfaces(); calendarMutationSaved();
          } catch (error) {
            error.attachments = attachments;
            throw error;
          }
        }
        return attachments;
      },
      getTasks: () => getWorkspace()?.tasks || [],
      getTaskProjects: () => getWorkspace()?.taskProjects || [],
      getCategories: () => window.ZETER_DATA_NORMALIZERS.normalizeCalendarCategories(getWorkspace()?.calendarCategories),
      getCalendarPreferences: preferences,
      saveCalendarPreferences: async patch => {
        const allowed = ["view", "workStart", "workEnd", "showTaskDeadlines"];
        const intent = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key)));
        if (intent.workStart !== undefined || intent.workEnd !== undefined) {
          const candidate = { ...preferences(), ...intent };
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.workStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.workEnd) || candidate.workStart >= candidate.workEnd) throw new Error("Рабочие часы: окончание должно быть позже начала.");
        }
        const result = await saveWorkspacePatch(workspace => ({ calendarState: window.ZETER_WORKSPACE_UTILS.normalizeWorkspaceCalendarState({ ...workspace.calendarState, ...intent }) }));
        return { ...result.calendarState, saved: true };
      },
      saveCategory: async (draft, editingId = "", original = null) => {
        const submitted = JSON.parse(JSON.stringify(draft || {}));
        const baseline = original ? JSON.stringify(original) : "";
        let category;
        await saveWorkspacePatch(workspace => {
          const categories = window.ZETER_DATA_NORMALIZERS.normalizeCalendarCategories(workspace.calendarCategories);
          const previous = categories.find(item => item.id === editingId);
          if (editingId && (!previous || baseline && JSON.stringify(previous) !== baseline)) throw new Error("Категория изменена в другом окне. Откройте её заново; введённые данные остались в форме.");
          const name = String(submitted.name || "").trim();
          if (!name || name.length > 80) throw new Error("Название категории: от 1 до 80 символов.");
          if (!/^#[0-9a-f]{6}$/i.test(submitted.color || "")) throw new Error("Выберите цвет категории.");
          if (categories.some(item => item.id !== editingId && item.name.toLocaleLowerCase("ru") === name.toLocaleLowerCase("ru"))) throw new Error("Категория с таким названием уже есть.");
          if (!editingId && categories.length >= 100) throw new Error("Можно создать до 100 собственных категорий.");
          if (submitted.description !== undefined && (typeof submitted.description !== "string" || submitted.description.length > 1000)) throw new Error("Описание категории: не больше 1000 символов.");
          if (submitted.icon !== undefined && !window.ZETER_DATA_NORMALIZERS.CALENDAR_CATEGORY_ICONS.includes(submitted.icon)) throw new Error("Выберите значок категории из списка.");
          category = { ...previous, id: previous?.id || uid("calcat"), name, color: submitted.color.toLowerCase(), ...(submitted.description === undefined ? {} : { description: submitted.description.trim() }), ...(submitted.icon === undefined ? {} : { icon: submitted.icon }) };
          return { calendarCategories: editingId ? categories.map(item => item.id === editingId ? category : item) : [...categories, category] };
        });
        refreshOpenCalendars(ownerWindowId);
        return JSON.parse(JSON.stringify(category));
      },
      deleteCategory: async (id, replacementId = "", original = null) => {
        const baseline = original ? JSON.stringify(original) : "";
        await saveWorkspacePatch(workspace => {
          const categories = window.ZETER_DATA_NORMALIZERS.normalizeCalendarCategories(workspace.calendarCategories);
          const previous = categories.find(item => item.id === id);
          if (!previous || !baseline || JSON.stringify(previous) !== baseline) throw new Error("Категория изменена или удалена в другом окне. Откройте её заново.");
          const events = workspace.events || [];
          const used = events.some(event => event.category === id);
          const replacementExists = ["work", "personal", "health", "important"].includes(replacementId) || categories.some(item => item.id === replacementId);
          if (replacementId === id || replacementId && !replacementExists) throw new Error("Выберите существующую категорию для переноса событий.");
          if (used && !replacementId) throw new Error("Выберите, в какую категорию перенести события. События не будут удалены.");
          const patch = { calendarCategories: categories.filter(item => item.id !== id) };
          if (used) {
            const updatedAt = new Date().toISOString();
            patch.events = events.map(event => event.category === id ? { ...event, category: replacementId, updatedAt } : event);
          }
          return patch;
        });
        refreshOpenCalendars(ownerWindowId);
      },
      openTask: taskId => {
        if (getDesktopRoot() !== workspaceId || !getWorkspace()?.tasks?.some(task => task.id === taskId)) throw new Error("Вернитесь на рабочий стол события. Исходная задача должна быть доступна.");
        openApp("taskedit", { taskId });
      },
      startEventTimer: async event => {
        const workspace = getWorkspace();
        if (getDesktopRoot() !== workspaceId || !workspace) throw new Error("Вернитесь на рабочий стол события, чтобы начать работу.");
        const source = workspace.events?.find(item => item.id === (event.eventId || event.id));
        if (!source) throw new Error("Событие больше недоступно. Обновите календарь.");
        if (source.taskId && !workspace.tasks?.some(task => task.id === source.taskId)) throw new Error("Исходная задача недоступна. Сначала измените привязку события.");
        await createWorkspaceTimeController(workspaceId).start({ title: source.title, notes: source.description || "", taskId: source.taskId || "", projectId: source.projectId || "" });
        writeSmallSettingsToLocalStorage(); scheduleExternalBackup(); refreshProjectOverviews(workspaceId);
        openApp("timetracking");
      }
    };
  }
  function renderCalendarApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const persistence = calendarPersistenceOptions(workspaceId);
    const controller = window.ZETER_CALENDAR_UTILS.createCalendarEventController(persistence);
    return createCalendarApp({
      ...calendarWorkspaceTools(workspaceId, winId),
      initialView: params.view,
      getWeekStart: () => systemSettings().calendar.weekStart,
      document,
      desktopTitle: desktopName(workspaceId),
      getCalendar: () => ui.calendar,
      setCalendar: calendar => { ui.calendar = calendar; },
      getEvents: () => persistence.getWorkspace()?.events || [],
      saveEventRecord: (...args) => controller.saveEvent(...args),
      removeEvent: (...args) => controller.removeEvent(...args),
      onEventSaved: calendarMutationSaved,
      refreshOpenCalendars: () => refreshOpenCalendars(winId),
      renderNotifications,
      toast,
      confirmUser: confirm,
      openEventEditor: params => openApp("calendaredit", params),
      openProjectSettings: (projectId, onSaved) => {
        const projectPersistence = createTaskProjectPersistence({}, {}, winId);
        const project = projectPersistence.getStore()?.taskProjects?.find(item => item.id === projectId);
        if (!project) throw new Error("Проект недоступен. Выберите существующий проект.");
        const controller = window.ZETER_TASK_APP_UI_UTILS.createTaskProjectSettingsController(projectPersistence);
        window.ZETER_TASK_APP_UI_UTILS.showTaskProjectSettingsDialog(document, project, controller, () => {
          projectPersistence.afterCreate();
          refreshOpenTaskBoards();
          refreshOpenCalendars(winId);
          onSaved();
        }, { autoSave: true });
      },
      openProjectCreator: onCreated => {
        const projectPersistence = createTaskProjectPersistence({}, {}, winId);
        const creation = window.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({ ...projectPersistence, getWorkspace: projectPersistence.getStore });
        window.ZETER_TASK_APP_UI_UTILS.showTaskProjectDialog(document, creation.createProject, project => {
          projectPersistence.afterCreate();
          refreshOpenTaskBoards();
          refreshOpenCalendars(winId);
          onCreated(project);
        });
      },
      downloadFile,
      todayISO,
      formatDate
    });
  }
  function renderCalendarEventEditorApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const persistence = calendarPersistenceOptions(workspaceId);
    const controller = window.ZETER_CALENDAR_UTILS.createCalendarEventController(persistence);
    const planController = params.timeTrackingPlan ? window.ZETER_CALENDAR_UTILS.createCalendarPlanController(persistence) : null;
    return createCalendarEventEditorApp(params, winId, {
      ...calendarWorkspaceTools(workspaceId, winId),
      document,
      getCalendar: () => ui.calendar,
      setCalendar: calendar => { if (getDesktopRoot() === workspaceId) ui.calendar = calendar; },
      getEvents: () => persistence.getWorkspace()?.events || [],
      saveEventRecord: (...args) => controller.saveEvent(...args),
      onEventSaved: calendarMutationSaved,
      renderNotifications,
      refreshOpenCalendars,
      closeWindow,
      toast,
      todayISO,
      objectLinksPanelFor,
      saveNewPlan: planController ? draft => queueAutomationMutation(() => planController.createPlan(draft)) : null,
      onPlanSaved: planController ? () => {
        syncLegacyWorkspaceAliases(state);
        writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
      } : null
    });
  }
  function renderLinkLibraryApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const linkLibraryController = window.ZETER_LINK_LIBRARY_UTILS.createLinkLibraryController({
      getWorkspace: () => workspaceDataForDesktopId(workspaceId),
      createId: uid,
      saveState,
      queueMutation: queueAutomationMutation
    });
    return window.ZETER_LINK_LIBRARY_UI_UTILS.createLinkLibraryApp(params, {
      documentRef: document,
      controller: linkLibraryController,
      openTarget: openShortcutTarget,
      isNative: shouldUseNativeStorage,
      copyText: text => navigator.clipboard.writeText(text),
      confirm: text => confirm(text),
      prompt: (text, value) => prompt(text, value),
      onChange: () => {
        [...ui.windows.entries()].forEach(([id, record]) => {
          if (id !== winId && record.appId === "links" && record.desktopId === workspaceId) record.el.querySelector(".link-library-app")?.refreshLibrary?.();
        });
      }
    });
  }

  function renderContactsApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const controller = window.ZETER_CONTACTS_UTILS.createContactsController({
      getWorkspace: () => state.desktops.find(desk => desk.id === workspaceId)?.data || null,
      createId: uid,
      queueMutation: queueAutomationMutation,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, contacts) => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop) throw new Error("Рабочий стол недоступен.");
        desktop.data.contacts = contacts;
        return write(snapshot);
      }
    });
    return window.ZETER_CONTACTS_UI_UTILS.createContactsApp(params, {
      documentRef: document, controller,
      copyText: text => navigator.clipboard.writeText(text),
      confirm: text => confirm(text),
      onChange: () => {
        writeSmallSettingsToLocalStorage();
        scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
        [...ui.windows.entries()].forEach(([id, record]) => {
          if (id !== winId && record.appId === "contacts" && record.desktopId === workspaceId) record.el.querySelector(".contacts-app")?.refreshContacts?.();
        });
      }
    });
  }

  function renderPromptLibraryApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const controller = window.ZETER_PROMPT_LIBRARY_UTILS.createPromptLibraryController({
      getWorkspace: () => state.desktops.some(desk => desk.id === workspaceId) ? workspaceDataForDesktopId(workspaceId) : null,
      createId: uid, saveState, queueMutation: queueAutomationMutation,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, library) => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop) throw new Error("Рабочий стол недоступен.");
        desktop.data.promptLibrary = library;
        return write(snapshot);
      }
    });
    return window.ZETER_PROMPT_LIBRARY_UI_UTILS.createPromptLibraryApp(params, {
      documentRef: document, controller,
      copyText: text => navigator.clipboard.writeText(text),
      confirm: text => confirm(text),
      onChange: () => {
        writeSmallSettingsToLocalStorage();
        scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
        [...ui.windows.entries()].forEach(([id, record]) => {
          if (id !== winId && record.appId === "prompts" && record.desktopId === workspaceId) record.el.querySelector(".prompt-library-app")?.refreshLibrary?.();
        });
      }
    });
  }

  function renderTimeTrackingApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const getWorkspace = () => state.desktops.find(desk => desk.id === workspaceId)?.data || null;
    const taskCreator = window.ZETER_TASK_APP_UI_UTILS.createTaskCreationController({
      getWorkspace,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, candidate) => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop) throw new Error("Рабочий стол недоступен.");
        Object.assign(desktop.data, candidate);
        syncLegacyWorkspaceAliases(snapshot);
        return write(snapshot);
      }
    });
    const controller = window.ZETER_TIME_TRACKING_UTILS.createTimeTrackingController({
      getWorkspace, createId: uid,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, tracking) => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop) throw new Error("Рабочий стол недоступен.");
        desktop.data.timeTracking = tracking;
        return write(snapshot);
      }
    });
    return window.ZETER_TIME_TRACKING_UI_UTILS.createTimeTrackingApp(params, {
      documentRef: document, controller, taskCreator, getWorkspace, confirm: text => confirm(text),
      onPlan: initialEvent => {
        if (!getWorkspace() || getDesktopRoot() !== workspaceId) throw new Error("Вернитесь на рабочий стол этого занятия и откройте планирование заново.");
        openApp("calendaredit", { timeTrackingPlan: true, initialEvent, date: initialEvent.date });
      },
      exportReport: rows => downloadBlob(`ZeTer-time-${todayISO()}.csv`, new Blob(["\uFEFF", window.ZETER_EXPORT_UTILS.tablePageToCSV({ rows })], { type: "text/csv;charset=utf-8" })),
      onChange: change => {
        if (change?.tasksChanged) { syncLegacyWorkspaceAliases(state); refreshOpenTaskBoards(); }
        writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
        refreshProjectOverviews(workspaceId);
        [...ui.windows.entries()].forEach(([id, record]) => {
          if (id !== winId && record.appId === "timetracking" && record.desktopId === workspaceId) record.el.querySelector(".time-tracking-app")?.refreshTimeTracking?.();
        });
      }
    });
  }

  function renderBusinessCalculationsApp(params = {}, winId = "") {
    const workspaceId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const controller = window.ZETER_BUSINESS_CALCULATIONS_UTILS.createBusinessCalculationsController({
      getWorkspace: () => state.desktops.some(desk => desk.id === workspaceId) ? workspaceDataForDesktopId(workspaceId) : null,
      persistTransaction: persistSearchAwareTransaction,
      saveSnapshot: (write, calculations) => {
        syncLegacyWorkspaceAliases(state);
        const snapshot = JSON.parse(JSON.stringify(state));
        const desktop = snapshot.desktops.find(desk => desk.id === workspaceId);
        if (!desktop) throw new Error("Рабочий стол недоступен.");
        desktop.data.calculations = calculations;
        return write(snapshot);
      }
    });
    return window.ZETER_BUSINESS_CALCULATIONS_UI_UTILS.createBusinessCalculationsApp(params, {
      documentRef: document, controller,
      onChange: () => {
        writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
        [...ui.windows.entries()].forEach(([id, record]) => {
          if (id !== winId && record.appId === "calculations" && record.desktopId === workspaceId) record.el.querySelector(".business-calculations-app")?.refreshCalculations?.();
        });
      }
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
      saveItem: candidate => persistSearchAwareTransaction(async write => {
        const current = state.fs?.[candidate.id];
        if (!current || current.type !== candidate.type) throw new Error("Элемент был удалён. Закрой окно и повтори действие.");
        const changes = { appearance: candidate.appearance, updatedAt: candidate.updatedAt };
        if (candidate.type === "shortcut") {
          for (const key of ["name", "shortcut", "extension", "managedFile"]) changes[key] = candidate[key];
        }
        const baseline = Object.fromEntries(Object.keys(changes).map(key => [key, JSON.stringify(current[key])]));
        syncLegacyWorkspaceAliases(state);
        const snapshot = cloneForBackup(state);
        Object.assign(snapshot.fs[candidate.id], changes);
        const result = await write(snapshot);
        if (!result?.saved) throw new Error("Хранилище ещё не готово к записи.");
        // Preserve mutations made while writing; their queued save follows the barrier.
        if (state.fs?.[candidate.id] === current) {
          for (const [key, value] of Object.entries(changes)) {
            if (JSON.stringify(current[key]) === baseline[key]) current[key] = value;
          }
        }
        writeSmallSettingsToLocalStorage();
        scheduleExternalBackup();
        securityRuntimeController.scheduleProtectionCheck();
      }),
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
      openProblemLogsFolder: () => nativeStorageCall("open_problem_logs_folder"),
      openApp,
      copyText: copyTextToClipboard,
      toast
    });
  }

  function renderSettingsApp(params = {}, winId = "") {
    const desktopId = ui.windows.get(winId)?.desktopId || getDesktopRoot();
    const modelsFor = target => {
      const desktop = target.desktops.find(record => record.id === desktopId);
      if (!desktop) throw new Error("Рабочий стол больше не существует. Закрой его настройки.");
      return { desktop, settings: desktop.data?.settings || {}, systemSettings: target.systemSettings };
    };
    let session = ui.settingsSessions.get(desktopId);
    if (!session) {
      session = {};
      session.writer = window.ZETER_PREFERENCES_WRITER_UTILS.createPreferencesWriter({
        keys: window.ZETER_SETTINGS_UI_UTILS.SETTINGS_PREFERENCE_KEYS,
        getPreferences: () => window.ZETER_SETTINGS_UI_UTILS.settingsPreferences(modelsFor(state)),
        requireAck: true,
        save: patch => persistSearchAwareTransaction(async write => {
          syncLegacyWorkspaceAliases(state);
          const snapshot = cloneForBackup(state);
          const staged = window.ZETER_SETTINGS_UI_UTILS.applySettingsPreferencePatch(modelsFor(snapshot), patch);
          const target = snapshot.desktops.find(record => record.id === desktopId);
          target.data.settings = staged.settings;
          for (const field of ["name", "description", "icon"]) if (Object.prototype.hasOwnProperty.call(patch, "profile." + field)) {
            if (field === "icon" && !staged.desktop.icon) delete target.icon; else target[field] = staged.desktop[field];
          }
          snapshot.systemSettings = staged.systemSettings;
          const result = await write(snapshot);
          if (result?.saved !== true) throw new Error("Хранилище не подтвердило запись. Повтори сохранение.");
          // Merge against live state again: another owner may have changed independent fields while writing.
          const published = window.ZETER_SETTINGS_UI_UTILS.applySettingsPreferencePatch(modelsFor(state), patch);
          const live = state.desktops.find(record => record.id === desktopId);
          live.data.settings = published.settings;
          for (const field of ["name", "description", "icon"]) if (Object.prototype.hasOwnProperty.call(patch, "profile." + field)) {
            if (field === "icon" && !published.desktop.icon) delete live.icon; else live[field] = published.desktop[field];
          }
          state.systemSettings = published.systemSettings;
          if (Object.prototype.hasOwnProperty.call(patch, "system.windows.openingSize")) {
            const active = ui.windows.get(ui.activeWindow);
            const previewId = active?.appId === "settings" && active.desktopId === desktopId ? active.winId : session.intentWindowId;
            windowRuntimeController.applyOpeningSize(previewId, published.systemSettings.windows.openingSize);
          }
          applySettings();
          if (desktopId === getDesktopRoot()) renderDesktop();
          renderStart();
          if (Object.prototype.hasOwnProperty.call(patch, "system.calendar.weekStart")) refreshOpenCalendars();
          writeSmallSettingsToLocalStorage(); scheduleExternalBackup();
          return result;
        })
      });
      ui.settingsSessions.set(desktopId, session);
    }
    session.intentWindowId = winId;
    return settingsAppElement({
      winId, activeSection: params.settingsSection, searchQuery: params.settingsQuery,
      onSectionChange: section => { (ui.windows.get(winId)?.params || params).settingsSection = section; },
      onSearchChange: query => { (ui.windows.get(winId)?.params || params).settingsQuery = query; },
      getModels: () => modelsFor(state), preferencesWriter: session.writer, preferencesSession: session,
      getSettings: () => modelsFor(state).settings, getSystemSettings: systemSettings,
      getDesktopRecord: () => modelsFor(state).desktop, getDesktopRoot: () => desktopId,
      getDesktopOptions: startupDesktopOptions, getStorageSummary: storageSettingsSummary,
      desktopAvatarHTML: (id, active, desktop) => desktopAvatarHTMLFromList(desktop ? [desktop] : state.desktops, id, active),
      desktopName, desktopDescription, formatBytes: bytesToHuman,
      windowsStartupAvailable: shouldUseNativeStorage(), toast, createCustomWallpaperFromFile, createDesktopIconFromFile, saveState,
      openDataFolder: () => nativeStorageCall("open_data_folder"),
      getWindowsStartupStatus: () => nativeStorageCall("get_windows_startup_status"),
      setWindowsStartupEnabled: enabled => nativeStorageCall("set_windows_startup_enabled", enabled),
      openSecurity: () => openApp("security")
    });
  }
  function renderAboutApp(){
    const root = window.ZETER_ABOUT_UI_UTILS.aboutAppElement({
      openApp,
      showContext,
      copyText: copyTextToClipboard,
      openExternalLink: openExternalTarget,
      toast
    });
    updateUiController?.render(root);
    return root;
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
  function renderManualUpdateApp(){
    return window.ZETER_UPDATE_UI_UTILS.manualUpdateElement({ openExternalLink: openExternalTarget, showContext, copyText: copyTextToClipboard, toast });
  }
  function renderHelpApp(){ return helpAppElement({ openApp, osVersion: OS_VERSION }); }
  const searchController = createSearchController({
    document,
    getState: () => state,
    getFs: () => state.fs,
    getCurrentDesktopId: getDesktopRoot,
    getWorkspace: currentWorkspace,
    getDesktopStores: () => state.desktops.map(desktop => ({ desktopId: desktop.id, title: desktop.name, data: workspaceDataForDesktopId(desktop.id) })),
    getRevision: () => searchRevision,
    runResultAction: runSearchResultAction,
    saveSearchSettings: persistSearchPreferences,
    apps,
    trashRoot: LEGACY_DELETED_ROOT,
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
    validateResult: element => searchTargetRecord({ kind: element.dataset.searchKind, id: element.dataset.id,
      desktopId: element.dataset.desktopId, itemId: element.dataset.itemId, projectType: element.dataset.projectType }),
    getCalendarEvent: eventId => deskEvents().find(event => event.id === eventId),
    setCalendarEventDate: date => { ui.calendar = { ...ui.calendar, date, selected: date, view: "agenda" }; },
    toggleNotifications: () => togglePanel("notifications"),
    openExtendedResult: openExtendedSearchResult
  });

  const globalSearchOverlay = createGlobalSearchOverlayController({
    document,
    ElementCtor: Element,
    closeFloating,
    renderGlobal: query => searchController.renderGlobal(query),
    openFirst: () => searchController.openSelected($("#global-search-results")),
    schedule: callback => setTimeout(callback, 0)
  });

  function openSearchResult(element) { return searchController.openResultElement(element); }

  function searchTargetRecord(result) {
    const desktopId = result.desktopId || getDesktopRoot();
    const desktop = state.desktops.find(item => item.id === desktopId);
    if (!desktop) throw new Error("Рабочий стол больше недоступен.");
    const workspace = workspaceDataForDesktopId(desktopId);
    const liveItem = id => {
      const item = state.fs[id];
      if (!item || item.deletedAt || item.hiddenInExplorer || item.hiddenFromDesktop) return null;
      const seen = new Set(); let cursor = item;
      while (cursor && !seen.has(cursor.id)) {
        if (cursor.deletedAt || cursor.parent === LEGACY_DELETED_ROOT) return null;
        seen.add(cursor.id);
        if (isDesktopRoot(cursor.parent)) return cursor.parent === desktopId ? item : null;
        cursor = state.fs[cursor.parent];
      }
      return null;
    };
    let store = workspace;
    if (result.itemId) { store = liveItem(result.itemId); if (store?.type !== "tasklist") store = null; }
    let record;
    if (result.kind === "item") record = liveItem(result.id);
    else if (result.kind === "task") record = store?.tasks?.find(item => item.id === result.id);
    else if (result.kind === "calendar") record = workspace.events?.find(item => item.id === result.id);
    else if (result.kind === "project") record = (result.projectType === "prompts" ? workspace.promptLibrary?.projects : store?.taskProjects)?.find(item => item.id === result.id);
    else if (result.kind === "link") record = workspace.library?.entries?.find(item => item.id === result.id);
    else if (result.kind === "prompt") record = workspace.promptLibrary?.entries?.find(item => item.id === result.id);
    else if (result.kind === "time") record = workspace.timeTracking?.entries?.find(item => item.id === result.id && item.deletedAt == null);
    else if (["app", "command", "notification"].includes(result.kind)) record = result;
    if (!record) throw new Error("Материал удалён или изменён. Обновите поиск.");
    return { desktopId, workspace, store, record };
  }

  async function openExtendedSearchResult(element) {
    const result = { kind: element.dataset.searchKind, id: element.dataset.id, desktopId: element.dataset.desktopId,
      itemId: element.dataset.itemId, projectId: element.dataset.projectId, projectType: element.dataset.projectType };
    const target = searchTargetRecord(result);
    if (target.desktopId !== getDesktopRoot() && !switchVirtualDesktop(target.desktopId)) throw new Error("Не удалось открыть рабочий стол.");
    if (result.kind === "link") return openShortcutTarget(target.record.target, target.record.name);
    if (result.kind === "prompt") return openApp("prompts", { projectId: target.record.projectId || "", entryId: target.record.id });
    if (result.kind === "time") return openApp("timetracking", { entryId: target.record.id });
    if (result.kind === "project") {
      if (result.projectType === "prompts") return openApp("prompts", { projectId: target.record.id });
      const previousProject = target.store.activeTaskProjectId;
      target.store.activeTaskProjectId = target.record.id;
      try { await saveState({ skipExternalBackup: true, silentStorageError: true }); }
      catch (error) { if (target.store.activeTaskProjectId === target.record.id) target.store.activeTaskProjectId = previousProject; searchRevision += 1; throw error; }
      const current = searchTargetRecord(result);
      if (getDesktopRoot() !== target.desktopId || current.store !== target.store || current.record !== target.record) {
        throw new Error("Рабочий стол или проект изменён. Открытие отменено; выберите проект ещё раз.");
      }
      return openApp(result.itemId ? "tasklist" : "tasks", result.itemId ? { itemId: result.itemId, projectView: "overview" } : { projectView: "overview" });
    }
    return false;
  }

  async function runSearchResultAction(result, action) {
    const target = searchTargetRecord(result);
    if (action === "copy") {
      let text = "";
      if (result.kind === "link") text = target.record.target;
      else if (result.kind === "prompt") text = target.record.text;
      else if (result.kind === "time") text = [target.record.title, target.record.notes].filter(Boolean).join("\n");
      else if (result.kind === "item" && ["text", "note", "markdown"].includes(target.record.type)) text = target.record.richContent ? htmlPlainText(target.record.richContent) : target.record.content || "";
      else if (result.kind === "item" && target.record.type === "table") text = window.ZETER_TABLE_UTILS.tablePlainText(target.record);
      if (!text || !await copyTextToClipboard(text)) throw new Error("Не удалось скопировать текст. Откройте материал и скопируйте вручную.");
      return true;
    }
    if (action === "complete" && result.kind === "task") {
      const getStore = () => { try { return searchTargetRecord(result).store; } catch { return null; } };
      const controller = window.ZETER_TASK_APP_UI_UTILS.createTaskCompletionController({
        getWorkspace: getStore, persistTransaction: persistSearchAwareTransaction,
        saveSnapshot: (write, candidate) => {
          const current = searchTargetRecord(result);
          syncLegacyWorkspaceAliases(state);
          const snapshot = cloneForBackup(state);
          const store = result.itemId ? snapshot.fs[result.itemId] : snapshot.desktops.find(item => item.id === current.desktopId)?.data;
          if (!store) throw new Error("Список задач недоступен.");
          store.tasks = candidate.tasks;
          syncLegacyWorkspaceAliases(snapshot);
          return write(snapshot);
        }
      });
      const saved = await queueAutomationMutation(() => controller.complete(result.id));
      refreshOpenTaskBoards(); renderAllFileSurfaces();
      if (target.desktopId === getDesktopRoot()) {
        void saveStateWithTaskAutomation({ skipExternalBackup: true }).catch(error => toast("Статус задачи сохранён", `Не удалось сохранить связанные автоматизации: ${error.message}`));
      }
      return saved;
    }
    if (action === "reveal" && result.kind === "item") {
      if (target.desktopId !== getDesktopRoot() && !switchVirtualDesktop(target.desktopId)) throw new Error("Не удалось открыть рабочий стол.");
      closeFloating();
      return openApp("folder", { folderId: target.record.parent, focusItemId: target.record.id });
    }
    if (action === "open") {
      const element = document.createElement("button");
      Object.assign(element.dataset, { searchKind: result.kind, id: String(result.id), desktopId: target.desktopId,
        itemId: result.itemId || "", projectId: result.projectId || "", projectType: result.projectType || "", query: result.query || "" });
      return searchResultNavigator.openResult(element);
    }
    throw new Error("Действие недоступно для этого материала.");
  }

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
    getIncoming: () => driveIncomingUiController?.getIncoming(),
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
  function renderNotifications() { return notificationCenterController.render(); }
  function notificationDecision(options = {}) {
    return notificationDeliveryDecision(systemSettings(), notificationFilterKind(options), new Date());
  }
  function shouldPopupNotification(options = {}) { return notificationDecision(options).popup; }
  function addNotification(title, text, options = {}) {
    if (!notificationDecision(options).store) return null;
    return notificationCenterController.addNotification(title, text, options);
  }

  driveIncomingUiController = notificationUiUtils.createDriveIncomingController({
    document,
    acceptIncoming: key => googleDriveSyncController?.acceptIncoming(key),
    deferIncoming: key => googleDriveSyncController?.deferIncoming(key),
    onChange: renderNotifications,
    onError: error => toast("Новые данные не загружены", error?.message || "Повторите загрузку из центра уведомлений.")
  });

  function automationStateForCurrentWorkspace() {
    const root = getDesktopRoot();
    const fs = {};
    workspaceItems(root).forEach(item => { fs[item.id] = item; });
    return { fs, desktops: [{ id: root }] };
  }

  function automationUniqueName(name, parentId, excludeId = "") {
    const cleanName = String(name || "Файл");
    const occupied = new Set(Object.values(state.fs || {})
      .filter(item => item && item.id !== excludeId && !item.deletedAt && item.parent === parentId)
      .map(item => String(item.name || "").toLocaleLowerCase("ru-RU")));
    if (!occupied.has(cleanName.toLocaleLowerCase("ru-RU"))) return cleanName;
    const dot = cleanName.lastIndexOf(".");
    const base = dot > 0 ? cleanName.slice(0, dot) : cleanName;
    const extension = dot > 0 ? cleanName.slice(dot) : "";
    let index = 2;
    while (occupied.has(`${base} (${index})${extension}`.toLocaleLowerCase("ru-RU"))) index += 1;
    return `${base} (${index})${extension}`;
  }

  function refreshAutomationSurfaces(options = {}) {
    if (options.files !== false) renderAllFileSurfaces();
    renderNotifications();
    ui.windows.forEach((record, winId) => {
      if (options.automations !== false && record.appId === "automations") refreshWindow(winId);
    });
  }

  function restoreAutomationSnapshot(snapshot, automations, runtime) {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, snapshot);
    const workspace = currentWorkspace();
    workspace.automations = normalizeAutomations(automations);
    workspace.automationRuntime = cloneForBackup(runtime);
    refreshAutomationSurfaces();
  }

  const automationRuntimeController = createAutomationRuntimeController({
    getState: automationStateForCurrentWorkspace,
    getWorkspace: currentWorkspace,
    now: Date.now,
    resolveFileFolderName: automationFileFolderName,
    notify: (title, text, meta = {}) => {
      const run = meta.run || {};
      const options = {
        source: `automation:${meta.automationId || "unknown"}`,
        save: false
      };
      if (["event_before", "event_relative", "event_created"].includes(run.type) && (run.eventId || run.triggerId)) {
        options.linkedObjectKind = "event";
        options.linkedObjectId = run.eventId || run.triggerId;
        options.linkedEventDate = run.eventDate || "";
      } else if (run.type === "file_added" && run.fileId) {
        options.linkedObjectKind = "fs";
        options.linkedObjectId = run.fileId;
      } else if (["note_created", "note_changed"].includes(run.type) && run.triggerId) {
        options.linkedObjectKind = "fs";
        options.linkedObjectId = run.triggerId;
      } else if (["task_completed", "task_overdue"].includes(run.type) && run.triggerId) {
        options.action = "open-task";
        options.taskId = run.triggerId;
        options.taskDesktopId = getDesktopRoot();
      }
      addNotification(title, text, options);
      return true;
    },
    createNote: ({ name, content, parentId }, meta = {}) => {
      const root = getDesktopRoot();
      const folder = state.fs?.[parentId];
      const parent = parentId === root || (folder?.type === "folder" && itemInWorkspace(folder, root)) ? parentId : root;
      const result = createFsItemRecord(state.fs, "note", name || "Новая заметка", parent, {
        x: 60,
        y: 60,
        uid,
        uniqueName: automationUniqueName,
        positionForItem: draft => isDesktopRoot(parent)
          ? findFreeDesktopPosition(parent, 60, 60, draft.id)
          : findFreeFolderPosition(parent, 60, 60, draft.id),
        extra: {
          content: String(content || ""),
          richContent: plainToRichHtml(String(content || ""))
        }
      });
      if (!result.item || !result.keyId) return false;
      state.fs[result.keyId] = result.item;
      const origin = meta.origin || {};
      enqueueExternalAutomationEvent("note_created", result.item, {
        originAutomationId: meta.automationId,
        chainId: origin.chainId || `automation:${meta.automationId || "unknown"}:${meta.run?.runKey || result.keyId}`,
        chainDepth: Math.max(0, Number(origin.depth) || 0) + 1,
        chainAutomationIds: [...(Array.isArray(origin.automationIds) ? origin.automationIds : []), meta.automationId].filter(Boolean)
      });
      return { kind: "fs", id: result.keyId };
    },
    moveFile: (fileId, targetFolderId, meta = {}) => {
      const root = getDesktopRoot();
      const item = state.fs?.[fileId];
      const target = state.fs?.[targetFolderId];
      if (!item || !itemInWorkspace(item, root)) return false;
      if (targetFolderId !== root && (target?.type !== "folder" || !itemInWorkspace(target, root))) return false;
      if (!canMoveExplorerItemIntoFolder(state.fs, fileId, targetFolderId, { isDesktopRoot })) return false;
      const collision = Object.values(state.fs || {}).find(candidate => (
        candidate &&
        candidate.id !== item.id &&
        !candidate.deletedAt &&
        candidate.parent === targetFolderId &&
        String(candidate.name || "").toLocaleLowerCase("ru-RU") === String(item.name || "").toLocaleLowerCase("ru-RU")
      ));
      if (collision && meta.collisionPolicy === "skip") return { status: "skipped", kind: "fs", id: fileId };
      if (collision && meta.collisionPolicy === "replace") {
        if (meta.replaceAcknowledged !== true || permanentlyRemoveItemsFromBrowserState([collision.id], { dropActionHistory: false }) < 1) return false;
      }
      if (collision && meta.collisionPolicy === "rename") {
        item.name = automationUniqueName(item.name, targetFolderId, item.id);
      }
      const position = isDesktopRoot(targetFolderId)
        ? findFreeDesktopPosition(targetFolderId, 60, 60, item.id)
        : findFreeFolderPosition(targetFolderId, 60, 60, item.id);
      item.parent = targetFolderId;
      item.x = position.x;
      item.y = position.y;
      item.updatedAt = Date.now();
      return { kind: "fs", id: fileId };
    },
    linkObjects: (left, right, meta = {}) => {
      if (![left?.kind, right?.kind].every(kind => kind === "fs" || kind === "event")) return false;
      const current = deskObjectLinks();
      const next = normalizeObjectLinks([...current, {
        id: uid("object_link"),
        a: left,
        b: right,
        label: meta.label,
        createdAt: Date.now()
      }]);
      if (next.length === current.length) return { kind: right.kind, id: right.id };
      setDeskObjectLinks(next);
      return { kind: right.kind, id: right.id };
    }
  });

  const automationSeededWorkspaces = new Set();
  const automationTaskBaseline = new Map();
  const automationNoteBaseline = new Map();
  const automationEventBaseline = new Map();
  const automationStartupKey = `boot_${Date.now().toString(36)}`;
  let automationStartupQueued = false;

  function automationTaskRecords() {
    const root = getDesktopRoot();
    const workspace = currentWorkspace();
    const taskLists = workspaceItems(root).filter(item => item?.type === "tasklist");
    return [
      ...(Array.isArray(workspace.tasks) ? workspace.tasks : []),
      ...taskLists.flatMap(item => Array.isArray(item.tasks) ? item.tasks : [])
    ].filter(task => task?.id);
  }

  function automationNoteRecords() {
    return workspaceItems(getDesktopRoot()).filter(item => item?.type === "note" && item.id);
  }

  function automationEventRecords() {
    return (Array.isArray(currentWorkspace().events) ? currentWorkspace().events : []).filter(event => event?.id);
  }

  function automationBaselineKey(id) {
    return `${getDesktopRoot()}:${id}`;
  }

  function replaceAutomationBaseline(target, records, projector) {
    const prefix = `${getDesktopRoot()}:`;
    [...target.keys()].filter(key => key.startsWith(prefix)).forEach(key => target.delete(key));
    records.forEach(record => target.set(automationBaselineKey(record.id), projector(record)));
  }

  function seedAutomationEventBaselines() {
    const root = getDesktopRoot();
    replaceAutomationBaseline(automationTaskBaseline, automationTaskRecords(), task => ({
      status: task.status || "todo",
      updatedAt: Number(task.updatedAt) || 0,
      due: String(task.due || "")
    }));
    replaceAutomationBaseline(automationNoteBaseline, automationNoteRecords(), note => ({
      updatedAt: Number(note.updatedAt) || 0,
      name: String(note.name || ""),
      content: String(note.content || "")
    }));
    replaceAutomationBaseline(automationEventBaseline, automationEventRecords(), event => ({
      createdAt: Number(event.createdAt) || 0,
      updatedAt: Number(event.updatedAt) || 0
    }));
    automationSeededWorkspaces.add(root);
    return true;
  }

  function ensureAutomationEventBaselines() {
    if (!automationSeededWorkspaces.has(getDesktopRoot())) seedAutomationEventBaselines();
  }

  function enqueueExternalAutomationEvent(type, object, metadata = {}) {
    if (!object?.id) return [];
    const event = {
      type,
      eventKey: String(metadata.eventKey || object.updatedAt || object.createdAt || Date.now()),
      at: Date.now(),
      originAutomationId: metadata.originAutomationId,
      chainId: metadata.chainId,
      chainDepth: metadata.chainDepth,
      chainAutomationIds: metadata.chainAutomationIds
    };
    if (type.startsWith("task_")) event.task = object;
    if (type.startsWith("note_")) event.note = object;
    if (type === "event_created") event.event = object;
    const queued = automationRuntimeController.enqueueEvent(event);
    if (queued.length) scheduleAutomationCheck();
    return queued;
  }

  function taskAutomationEventsSinceBaseline(tasks) {
    ensureAutomationEventBaselines();
    return tasks.flatMap(task => {
      const previous = automationTaskBaseline.get(automationBaselineKey(task.id));
      if (previous && previous.status !== "done" && task.status === "done") {
        return [{
          type: "task_completed",
          task,
          eventKey: `completed:${task.updatedAt || Date.now()}`
        }];
      }
      return [];
    });
  }

  function noteAutomationEventsSinceBaseline(notes) {
    ensureAutomationEventBaselines();
    return notes.flatMap(note => {
      const previous = automationNoteBaseline.get(automationBaselineKey(note.id));
      if (!previous) return [];
      const changed = previous.updatedAt !== (Number(note.updatedAt) || 0) || previous.name !== String(note.name || "") || previous.content !== String(note.content || "");
      return changed ? [{ type: "note_changed", note, eventKey: `changed:${note.updatedAt || Date.now()}` }] : [];
    });
  }

  function calendarAutomationEventsSinceBaseline(events) {
    ensureAutomationEventBaselines();
    return events.flatMap(event => automationEventBaseline.has(automationBaselineKey(event.id))
      ? []
      : [{ type: "event_created", event, eventKey: `created:${event.createdAt || Date.now()}` }]);
  }

  function saveStateWithAutomationEvents(saveOptions, events, commitBaseline) {
    const promise = queueAutomationMutation(async () => {
      const workspace = currentWorkspace();
      const runtimeBefore = cloneForBackup(workspace.automationRuntime);
      events.forEach(event => automationRuntimeController.enqueueEvent(event));
      try {
        const result = await Promise.resolve(saveState(saveOptions));
        commitBaseline();
        if (events.length) scheduleAutomationCheck();
        return result;
      } catch (error) {
        currentWorkspace().automationRuntime = runtimeBefore;
        throw error;
      }
    });
    promise.catch(() => {});
    return promise;
  }

  function saveStateWithTaskAutomation(saveOptions = {}) {
    const tasks = automationTaskRecords();
    const events = taskAutomationEventsSinceBaseline(tasks);
    return saveStateWithAutomationEvents(saveOptions, events, () => {
      replaceAutomationBaseline(automationTaskBaseline, tasks, task => ({
        status: task.status || "todo",
        updatedAt: Number(task.updatedAt) || 0,
        due: String(task.due || "")
      }));
    });
  }

  function saveStateWithNoteAutomation(saveOptions = {}) {
    const notes = automationNoteRecords();
    const events = noteAutomationEventsSinceBaseline(notes);
    return saveStateWithAutomationEvents(saveOptions, events, () => {
      replaceAutomationBaseline(automationNoteBaseline, notes, note => ({
        updatedAt: Number(note.updatedAt) || 0,
        name: String(note.name || ""),
        content: String(note.content || "")
      }));
    });
  }

  function saveStateWithCalendarAutomation(saveOptions = {}) {
    const eventsNow = automationEventRecords();
    const events = calendarAutomationEventsSinceBaseline(eventsNow);
    const saving = saveStateWithAutomationEvents(saveOptions, events, () => {
      replaceAutomationBaseline(automationEventBaseline, eventsNow, event => ({
        createdAt: Number(event.createdAt) || 0,
        updatedAt: Number(event.updatedAt) || 0
      }));
    });
    return Promise.resolve(saving).then(result => { refreshProjectOverviews(); return result; });
  }

  function enqueueOverdueTaskAutomationEvents() {
    const today = todayISO();
    automationTaskRecords().forEach(task => {
      const due = String(task.due || "");
      if (!task.indefinite && task.status !== "done" && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today) {
        automationRuntimeController.enqueueEvent({
          type: "task_overdue",
          task,
          eventKey: `overdue:${due}`,
          at: Date.now()
        });
      }
    });
  }

  let automationMutationChain = Promise.resolve();

  function queueAutomationMutation(operation) {
    const run = automationMutationChain
      .catch(() => {})
      .then(() => operation());
    automationMutationChain = run.catch(() => {});
    return run;
  }

  function restoreAutomationExactSnapshot(snapshot) {
    Object.keys(state).forEach(key => delete state[key]);
    Object.assign(state, snapshot);
    // The initiating UI must survive to show its rejected-save error and draft.
    refreshAutomationSurfaces({ automations: false });
  }

  function persistAutomationMutation(operation) {
    return queueAutomationMutation(async () => {
      const snapshot = cloneForBackup(state);
      try {
        const result = await operation();
        await Promise.resolve(saveState());
        cleanupRemovedItemReferences(Object.keys(snapshot.fs || {}).filter(id => !state.fs[id]));
        refreshAutomationSurfaces();
        return result;
      } catch (error) {
        restoreAutomationExactSnapshot(snapshot);
        throw error;
      }
    });
  }

  function automationRuntimeForUi() {
    const workspace = currentWorkspace();
    workspace.automationRuntime = normalizeAutomationRuntime(workspace.automationRuntime);
    return workspace.automationRuntime;
  }

  function automationFileOptions(value = {}) {
    const folders = automationFolderOptions();
    return workspaceItems(getDesktopRoot())
      .filter(item => item && !["folder", "app"].includes(item.type) && !item.deletedAt && !item.systemRole && (!value.folderId || item.parent === value.folderId))
      .map(item => ({
        id: item.id, type: item.type, parentId: item.parent,
        folderLabel: folders.find(folder => folder.id === item.parent)?.label || automationFileFolderName(item),
        label: `${item.type === "note" ? "Заметка" : "Файл"}: ${item.name || "Без названия"} — ${folders.find(folder => folder.id === item.parent)?.label || automationFileFolderName(item)}`
      }));
  }

  function openAutomationSourceFolder(folderId = "", fileId = "") {
    const file = fileId ? automationSampleContext({ type: "file_added", folderId }, { fileId }).file : null;
    if (fileId && !file) return toast("Объект недоступен", "Обнови список и выбери файл заново: он мог быть удалён или перемещён.");
    const targetId = file?.parent || folderId || getDesktopRoot();
    if (!automationFolderOptions().some(folder => folder.id === targetId)) return toast("Папка недоступна", "Обнови список и выбери папку заново.");
    return openApp("folder", { folderId: targetId });
  }

  function openAutomationSampleFile(folderId = "", fileId = "") {
    const file = automationSampleContext({ type: "file_added", folderId }, { fileId }).file;
    if (!file) return toast("Объект недоступен", "Обнови список и выбери файл заново: он мог быть удалён или перемещён.");
    return openItem(file.id);
  }

  function automationSampleContext(value = {}, selection = {}) {
    const automation = normalizeAutomations([value])[0] || value;
    const workspace = currentWorkspace();
    const root = getDesktopRoot();
    const files = workspaceItems(root).filter(item => item && !["folder", "app"].includes(item.type) && !item.deletedAt && !item.systemRole);
    const notes = files.filter(item => item.type === "note");
    const events = Array.isArray(workspace.events) ? workspace.events : [];
    const tasks = automationTaskRecords();
    const selectedFileId = selection.fileId ?? selection.file?.id;
    const file = files.find(item => (!automation.folderId || item.parent === automation.folderId) && (selectedFileId === undefined || item.id === selectedFileId)) || null;
    if (automation.type === "file_added") return { file, fileId: file?.id || "", fileFolderName: automationFileFolderName(file) };
    const event = events.find(item => item.id === automation.eventId) || events[0] || null;
    return {
      file,
      fileFolderName: automationFileFolderName(file),
      event,
      task: tasks[0] || null,
      note: notes[0] || null,
      eventDate: event?.date || ""
    };
  }

  function previewAutomationForUi(value, context = {}) {
    return automationRuntimeController.preview(value, automationSampleContext(value, context));
  }

  function commitAutomationList(next) {
    return persistAutomationMutation(() => {
      const categories = normalizeAutomationCategories(currentWorkspace().automationCategories);
      if (next.some(rule => rule.categoryId && !categories.some(category => category.id === rule.categoryId))) throw new Error("Категория удалена. Выбери другую категорию или «Без категории».");
      return setDeskAutomations(next);
    });
  }

  function commitAutomationDraft(draft, { workspaceId, editingId = "" } = {}) {
    return persistAutomationMutation(() => {
      if (getDesktopRoot() !== workspaceId) throw new Error("Рабочий стол изменился. Открой редактор заново.");
      const all = deskAutomations();
      const current = all.find(rule => rule.id === (editingId || draft.id));
      if (editingId && !current) throw new Error("Автоматизация уже удалена. Изменения не сохранены.");
      if (!editingId && current) throw new Error("Правило с таким ID уже сохранено. Открой его из списка для редактирования.");
      const rule = normalizeAutomations([{ ...draft, id: editingId || draft.id,
        lastRunKey: current?.lastRunKey || "", lastError: current?.lastError || "", pausedReason: current?.pausedReason || ""
      }])[0];
      if (!rule) throw new Error("Правило не прошло проверку.");
      const categories = normalizeAutomationCategories(currentWorkspace().automationCategories);
      if (rule.categoryId && !categories.some(category => category.id === rule.categoryId)) throw new Error("Категория удалена. Выбери другую категорию или «Без категории».");
      const next = current ? all.map(item => item.id === current.id ? rule : item) : [...all, rule];
      const saved = setDeskAutomations(next);
      if (!saved.some(item => item.id === rule.id)) throw new Error("Достигнут предел количества автоматизаций. Новое правило не сохранено.");
      return rule;
    });
  }

  function setAutomationsGloballyPaused(paused) {
    return persistAutomationMutation(() => automationRuntimeController.setGlobalPaused(paused));
  }

  function clearAutomationHistory(categoryId = "*") {
    return persistAutomationMutation(() => {
      if (categoryId === "*") return automationRuntimeController.clearHistory();
      const workspace = currentWorkspace();
      const ids = new Set(automationCategoryScope(workspace, categoryId).history.map(entry => entry.id));
      workspace.automationRuntime.history = workspace.automationRuntime.history.filter(entry => !ids.has(entry.id));
      return true;
    });
  }

  function runAutomationManually(automationId, context = {}) {
    const workspaceId = getDesktopRoot();
    return persistAutomationMutation(() => {
      if (getDesktopRoot() !== workspaceId) throw new Error("Рабочий стол изменился. Открой проверку правила заново.");
      const automation = deskAutomations().find(item => item.id === automationId);
      if (!automation) throw new Error("Автоматизация не найдена.");
      const sample = automationSampleContext(automation, context);
      if (automation.type === "file_added" && (!context.fileId || !sample.file)) {
        throw new Error("Выбери файл для проверки заново: он мог быть удалён или перемещён в другую папку.");
      }
      return automationRuntimeController.manualRun(automation, sample);
    });
  }

  let automationCheckTimer = null;
  let automationCheckInFlight = false;

  async function runAutomationCheck() {
    if (appUpdateApplying || recoveryApplying || automationCheckInFlight) return 0;
    automationCheckInFlight = true;
    try {
      return await queueAutomationMutation(async () => {
        const workspace = currentWorkspace();
        const automationsBefore = cloneForBackup(workspace.automations);
        const runtimeBefore = cloneForBackup(workspace.automationRuntime);
        enqueueOverdueTaskAutomationEvents();
        const pending = automationRuntimeController.collectDueRuns();
        const runtimeChanged = JSON.stringify(runtimeBefore) !== JSON.stringify(currentWorkspace().automationRuntime);
        if (!pending.length) {
          if (!runtimeChanged) return 0;
          try {
            await Promise.resolve(saveState());
          } catch (saveError) {
            currentWorkspace().automations = normalizeAutomations(automationsBefore);
            currentWorkspace().automationRuntime = cloneForBackup(runtimeBefore);
            refreshAutomationSurfaces({ files: false });
            console.error("[ZeTer OS automation save]", saveError);
            toast("Автоматизация не сохранена", "Очередь не изменена. Проверь хранилище ZeTer OS.");
          }
          return 0;
        }

        const stateBeforeExecution = cloneForBackup(state);
        let executed = 0;
        let executionError = null;
        try {
          executed = await automationRuntimeController.executeDueRuns();
        } catch (error) {
          executionError = error;
        }
        try {
          await Promise.resolve(saveState());
        } catch (saveError) {
          restoreAutomationSnapshot(stateBeforeExecution, automationsBefore, runtimeBefore);
          console.error("[ZeTer OS automation save]", saveError);
          toast("Автоматизация не сохранена", "Изменения запуска отменены. Проверь хранилище ZeTer OS.");
          return 0;
        }
        cleanupRemovedItemReferences(Object.keys(stateBeforeExecution.fs || {}).filter(id => !state.fs[id]));
        refreshAutomationSurfaces();
        if (executionError) {
          console.error("[ZeTer OS automation]", executionError);
          toast("Автоматизация выполнена частично", "Состояние запуска сохранено; правило будет повторено с места ошибки.");
          return 0;
        }
        return executed;
      });
    } catch (error) {
      console.error("[ZeTer OS automation]", error);
      toast("Автоматизация не выполнена", error?.message || "Проверь правило и связанные объекты.");
      return 0;
    } finally {
      automationCheckInFlight = false;
    }
  }

  function scheduleAutomationCheck() {
    setTimeout(() => { void runAutomationCheck(); }, 0);
    return true;
  }

  function startAutomationWatcher() {
    seedAutomationEventBaselines();
    if (!automationStartupQueued) {
      automationStartupQueued = true;
      automationRuntimeController.enqueueEvent({ type: "startup", startupKey: automationStartupKey, at: Date.now() });
    }
    scheduleAutomationCheck();
    if (automationCheckTimer !== null) clearInterval(automationCheckTimer);
    automationCheckTimer = setInterval(() => { void runAutomationCheck(); }, TASK_REMINDER_CHECK_MS);
    return automationCheckTimer;
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
      openApp("calendar", { view: "day" });
      return true;
    },
    openLinkedObject: (endpoint, notification = {}) => {
      const desktopId = notification.desktopId || getDesktopRoot();
      if (desktopId !== getDesktopRoot() && state.desktops.some(desktop => desktop.id === desktopId)) switchVirtualDesktop(desktopId);
      if (endpoint.kind === "event" && endpoint.eventDate) {
        ui.calendar = { ...ui.calendar, date: endpoint.eventDate, selected: endpoint.eventDate, editing: endpoint.id };
      }
      closeFloating();
      return openLinkedObject(endpoint);
    },
    toast
  });

  function openNotification(id) {
    const notification = deskNotifications().find(item => item.id === id);
    if (notification?.action === "open-update" && /^update:\d+\.\d+\.\d+$/.test(notification.source || "")) {
      notification.read = true;
      saveState();
      renderNotifications();
      closeFloating();
      openApp("about");
      updateUiController?.showOffer();
      return true;
    }
    return taskNotificationController.openById(id);
  }

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
    setTimer: (callback, delay) => setInterval(() => { if (!appUpdateApplying && !recoveryApplying) callback(); }, delay),
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
    setTimer: (callback, delay) => setInterval(() => { if (!appUpdateApplying && !recoveryApplying) callback(); }, delay),
    clearTimer: timer => clearInterval(timer),
    intervalMs: TASK_REMINDER_CHECK_MS
  });

  function scheduleTaskReminderCheck() {
    taskReminderWatcher.schedule();
    return calendarReminderWatcher.schedule();
  }
  function startTaskReminderWatcher() {
    taskReminderWatcher.start();
    const calendarTimer = calendarReminderWatcher.start();
    startAutomationWatcher();
    return calendarTimer;
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
    showDesktop: () => windowRuntimeController.showDesktop(),
    cycleWindows,
    openItem,
    deleteItems,
    renderNotifications,
    keepWindowsInBounds,
    normalizeVisualSettings,
    normalizeSystemSettings,
    hotkeyActionForEvent,
    switchRelativeDesktop,
    switchDesktop: switchVirtualDesktop,
    showContext,
    customWallpaperCssUrl,
    firstRunScreenHTML,
    startFirstRunSetup: (dialog, onFinish) => startFirstRunSetup({
      dialog,
      osVersion: OS_VERSION,
      initial: {
        desktopName: currentDesktopRecord().name || desktopName(getDesktopRoot()),
        wallpaper: deskSettings().wallpaper === "custom" ? "aurora" : (deskSettings().wallpaper || "aurora"),
        systemSettings: normalizeSystemSettings(systemSettings()),
        desktopAppearance: window.ZETER_VISUAL_UTILS.normalizeDesktopAppearance(deskSettings().desktopAppearance),
        desktopId: getDesktopRoot(),
        desktops: startupDesktopOptions(),
        apps: installableAppEntries().map(([id, app]) => ({id,name:app.name,icon:app.icon})),
        desktopApps: installableAppEntries().filter(([id]) => Object.values(state.fs).some(item => item.type === "app" && item.appId === id && item.parent === getDesktopRoot() && !item.deletedAt && !item.hiddenFromDesktop)).map(([id]) => id),
        taskbarApps: taskbarPinnedApps().filter(id => apps[id] && !apps[id].hidden)
      },
      save: saveFirstRunSetup,
      exportBackup: () => exportOS({source:"first-run"}),
      getWindowsStartup: () => shouldUseNativeStorage() ? nativeStorageCall("get_windows_startup_status") : Promise.resolve({supported:false}),
      setWindowsStartup: enabled => nativeStorageCall("set_windows_startup_enabled", enabled),
      onFinish
    }),
    completeFirstRun: () => saveFirstRunSetup(),
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
    updateClock,
    prepareCalendarForTray: () => {
      const today = todayISO();
      ui.calendar = { ...ui.calendar, view: "month", date: today, selected: today, editing: null };
    },
    systemPulse,
    setInterval: (callback, delay) => setInterval(callback, delay),
    setTimeout: (callback, delay) => setTimeout(callback, delay)
  });

  function saveFirstRunSetup(draft = null) {
    const desktopId = getDesktopRoot();
    return persistSearchAwareTransaction(async write => {
      syncLegacyWorkspaceAliases(state);
      const snapshot = cloneForBackup(state);
      const beforeAppIds = new Set(Object.keys(snapshot.fs));
      applyFirstRunDraft(snapshot, draft, {
        desktopId,
        apps,
        createId: uid,
        normalizeSystemSettings,
        normalizeDesktopAppearance: window.ZETER_VISUAL_UTILS.normalizeDesktopAppearance,
        normalizeTaskbarPinnedApps
      });
      const desktop = snapshot.desktops.find(record => record.id === desktopId);
      syncLegacyWorkspaceAliases(snapshot);
      const result = await write(snapshot);
      if (!result?.saved) throw new Error("Хранилище не подтвердило запись. Повтори попытку.");
      if (draft) {
        const current = state.desktops.find(record => record.id === desktopId);
        current.name = desktop.name;
        current.data.settings.wallpaper = draft.wallpaper;
        current.data.settings.desktopAppearance = desktop.data.settings.desktopAppearance;
        beforeAppIds.forEach(id => {
          if (!snapshot.fs[id] && state.fs[id]?.type === "app" && state.fs[id].parent === desktopId) delete state.fs[id];
        });
        Object.entries(snapshot.fs).forEach(([id,item]) => {
          if (!beforeAppIds.has(id)) state.fs[id] = item;
          else if (item.type === "app" && item.parent === desktopId && state.fs[id] && !item.hiddenFromDesktop) delete state.fs[id].hiddenFromDesktop;
        });
        state.taskbarPinnedApps = snapshot.taskbarPinnedApps;
        setSystemSettings(snapshot.systemSettings);
        syncLegacyWorkspaceAliases(state);
        applySettings();
        renderDesktop();
        renderStart();
        renderTaskbarPinnedApps();
        writeSmallSettingsToLocalStorage();
      }
      state.firstRunCompleted = true;
      scheduleExternalBackup();
      return result;
    });
  }

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
      buildZip: () => buildFullSecurityBackup(),
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

  let securityVaultFolder = null;
  const browserCloudPayloadStore=window.ZETER_CLOUD_PAYLOAD_UTILS.createPayloadStore();
  const SECURITY_VAULT_DB = "zeter-security-vault-folder";
  async function rememberSecurityVaultFolder(handle) {
    const db = await openIndexedDb(SECURITY_VAULT_DB, "handles", {keyPath:"id"});
    try { const tx=db.transaction("handles","readwrite");tx.objectStore("handles").put({id:"history",handle});await transactionDone(tx); }
    finally { db.close(); }
  }
  async function loadSecurityVaultFolder() {
    const row = await readIndexedDbRecord(SECURITY_VAULT_DB,"handles","history",{keyPath:"id"});
    securityVaultFolder=row?.handle||null;
  }
  async function buildFullSecurityBackup(record = null) {
    await syncLiveEditorsBeforeExport();
    await primaryStateSaveQueue.pending();
    syncLegacyWorkspaceAliases(state);
    const snapshot=record?.state || cloneForBackup(state);
    if (shouldUseNativeStorage()) {
      const result=await nativeStorageCall("build_security_backup",{app:"ZeTer OS",state:snapshot,osVersion:OS_VERSION,versionNumber:OS_VERSION_NUMBER});
      const binary=atob(result.base64),bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
      return new Blob([bytes],{type:"application/zip"});
    }
    if(window.ZETER_CLOUD_PAYLOAD_UTILS.references(snapshot).size){
      const files=[];for(const path of window.ZETER_CLOUD_PAYLOAD_UTILS.references(snapshot)){const blob=await browserCloudPayloadStore.get(path);if(!blob)throw new Error('Файл ещё не загружен для полной копии: '+path);files.push({path,blob});}
      return window.ZETER_CLOUD_PAYLOAD_UTILS.buildVerifiedArchive({app:'ZeTer OS',versionNumber:OS_VERSION_NUMBER,state:snapshot},files);
    }
    const zip=await buildDownloadOsDataZip(snapshot);
    await window.ZETER_SECURITY_RECOVERY_UTILS.inspectBackupFile(new File([zip],"check.zip",{type:"application/zip"}),{validate:validateImportedStateForImport,migrate});
    return zip;
  }
  const browserSecurityVaultRaw = window.ZETER_SECURITY_VAULT_UTILS.createBrowserBackupVault({
    getHandle:()=>securityVaultFolder,
    chooseFolder:async()=>{if(!window.showDirectoryPicker)throw new Error("Браузер не поддерживает выбор папки. Открой ZeTer OS через Python/EXE либо актуальный Chrome/Edge.");const handle=await window.showDirectoryPicker({mode:"readwrite"});securityVaultFolder=handle;return handle;},
    verifyPermission:async handle=>(await handle.queryPermission({mode:"readwrite"}))==="granted",
    buildBackup:buildFullSecurityBackup
  });
  const browserSecurityVault = {...browserSecurityVaultRaw, configure:async payload=>{
    const previous=securityVaultFolder;
    try {const result=await browserSecurityVaultRaw.configure(payload);if(result.cancelled){securityVaultFolder=previous;return result;}if(payload.chooseFolder)await rememberSecurityVaultFolder(securityVaultFolder);return result;}
    catch(error){securityVaultFolder=previous;throw error;}
  }};
  function prepareCloudStateForPublication(candidate) {
    // Existing runtime owners also initialize roots and lay out icons when rendering.
    // Run that work on the detached candidate before its primary ACK, never on live state.
    const explorer=createExplorerRuntimeController({getState:()=>candidate,createId:uid});
    syncLegacyWorkspaceAliases(candidate,{ensureWorkspaceExplorerRoot:explorer.ensureWorkspaceExplorerRoot});
    const surface=$("#desktop-items");
    if(!surface?.parentElement)throw new Error('Рабочий стол ещё не готов к применению облачной версии.');
    const rootId=candidate.currentDesktop,workspace=candidate.desktops.find(desk=>desk.id===rootId)?.data;
    const items=Object.values(candidate.fs).filter(item=>item.parent===rootId&&!item.deletedAt&&!item.hiddenFromDesktop&&item.systemRole!=="explorerRoot"&&!(item.type==="app"&&item.appId==="notes"));
    const staging=surface.cloneNode(false);staging.removeAttribute("id");staging.inert=true;staging.style.visibility="hidden";staging.style.pointerEvents="none";
    surface.parentElement.append(staging);
    try {
      staging.scrollLeft=surface.scrollLeft;staging.scrollTop=surface.scrollTop;
      const offset={x:surface.scrollLeft||0,y:surface.scrollTop||0};
      const forbiddenRects=desktopLayoutUtils.desktopForbiddenRects([$("#top-menu"),$("#taskbar")]).map(rect=>({...rect,x:rect.x+offset.x,y:rect.y+offset.y}));
      const viewportWidth=surface.clientWidth||window.innerWidth,viewportHeight=Math.max(window.innerHeight,surface.scrollHeight||0,...items.map(item=>(item.y||0)+216));
      desktopUiUtils.renderDesktopIcons({container:staging,items,appearance:workspace?.settings?.desktopAppearance,itemIcon,clampPosition:(x,y)=>desktopLayoutUtils.clampDesktopPosition(x,y,{viewportWidth,viewportHeight,forbiddenRects})});
      desktopUiUtils.renderDesktopStickies({root:staging,stickies:workspace?.noteStickies,getNote:id=>candidate.fs[id],plainToRichHtml,cleanRichHtml});
      return candidate;
    } finally {staging.remove();}
  }
  securityRecoveryController=window.ZETER_SECURITY_RECOVERY_UTILS.createRecoveryController({
    getState:()=>state,transaction:operation=>persistSearchAwareTransaction(operation),
    validate:validateImportedStateForImport,migrate,nativeMode:shouldUseNativeStorage,nativeCall:nativeStorageCall,
    browserVault:browserSecurityVault,buildBackup:buildFullSecurityBackup,
    browserPayloadStore:browserCloudPayloadStore,readPrimary:readPrimaryStateRecord,
    createSafetyPoint:snapshot=>securityRuntimeController.createRecoverySafetyPoint(snapshot),
    syncEditors:syncLiveEditorsBeforeExport,
    prepareApply:async()=>{await automationMutationChain;},
    prepareIncoming:prepareCloudStateForPublication,
    setLocked:locked=>{recoveryApplying=Boolean(locked);const os=document.querySelector("#os");if(os)os.inert=recoveryApplying||appUpdateApplying;},
    hasOpenEditors:()=>[...ui.windows.values()].some(record=>!["security","help","about","monitor"].includes(record.appId)),
    requestPassphrase:file=>prompt(`Пароль от «${file.name}» (не сохраняется):`,""),
    confirm,notify:toast,
    publish:candidate=>{
      Object.keys(state).forEach(key=>delete state[key]);Object.assign(state,candidate);
      syncLegacyWorkspaceAliases(state);renderAllFileSurfaces();renderDesktop();renderStart();renderTaskbarPinnedApps();
      // Restored documents become visible immediately; existing editors retain their draft until closed.
    },
    rememberFolder:rememberSecurityVaultFolder
  });

  let googleDriveConfigPromise = null;
  function loadGoogleDriveConfig() {
    if(!googleDriveConfigPromise)googleDriveConfigPromise=fetch(new URL('google-drive-config.json',document.baseURI),{cache:'no-store'}).then(async response=>{
      if(!response.ok)return {};
      const value=await response.json();
      const config={webClientId:typeof value.webClientId==='string'?value.webClientId:'',brokerUrl:typeof value.brokerUrl==='string'?value.brokerUrl:''};
      if(config.webClientId&&!window.google?.accounts?.oauth2&&!document.querySelector('[data-google-drive-identity]')){
        const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.dataset.googleDriveIdentity='1';document.head.append(script);
      }
      return config;
    }).catch(()=>({}));
    return googleDriveConfigPromise;
  }
  // Cloud backup panel removed. ZIP backups are local import/export only.

  function nextWallpaper(){
    const settings = deskSettings();
    settings.wallpaper = nextWallpaperValue(settings);
    applySettings();
    saveState();
  }

  let bootInitialized = false;

  async function recordAppUpdateNotification(update = {}) {
    const source = `update:${update.version}`;
    const added = [];
    for (const desktop of state.desktops || []) {
      const workspace = workspaceDataForDesktopId(desktop.id);
      if (workspace.notifications.some(item => item.source === source)) continue;
      const record = notificationCenterController.addNotification(`Доступна ZeTer OS ${update.version}`, "Новая версия готова к установке. Нажмите «Обновить» или откройте «О ZeTer OS».", { desktopId: desktop.id, source, action: "open-update", save: false });
      added.push({ workspace, record });
    }
    if (!added.length) return;
    try { await saveState(); }
    catch (error) {
      added.forEach(({ workspace, record }) => { workspace.notifications = workspace.notifications.filter(item => item.id !== record.id); });
      renderNotifications();
      throw error;
    }
    renderNotifications();
  }

  updateUiController = window.ZETER_UPDATE_UI_UTILS.createUpdateController({
    native: shouldUseNativeStorage(),
    callNative: nativeStorageCall,
    notifyAvailable: recordAppUpdateNotification,
    openExternalLink: openExternalTarget,
    openManualUpdate: () => { closeFloating(); return openApp("manualupdate"); },
    setLocked: locked => {
      appUpdateApplying = Boolean(locked);
      document.body.classList.toggle("app-update-locked", appUpdateApplying);
      const os = document.querySelector("#os");
      if (os) os.inert = appUpdateApplying;
    },
    saveBeforeInstall: async () => {
      await automationMutationChain;
      await syncLiveEditorsBeforeExport();
      await primaryStateSaveQueue.barrier();
      await saveState();
      await primaryStateSaveQueue.barrier();
    }
  });

  async function loadStorageAndInitialize() {
    if (bootInitialized) return;
    state = await storageStateRuntimeController.loadStateForBoot();
    bootInitialized = true;
    // Cloud ZIP backup never blocks startup or imports any remote state.
    init();
    if (!shouldUseNativeStorage()) {
      try { await loadSecurityVaultFolder(); } catch (error) { console.warn("[ZeTer OS backup history folder]",error); }
    }
    // No cloud polling, automatic backup history, or point generation on startup.
    window.addEventListener("pagehide",()=>{securityRecoveryController.stop();browserCloudPayloadStore.close();},{once:true});
    void updateUiController.start();
  }

  function showNativeStorageRecovery(error) {
    const guard = window.ZETER_BOOT_GUARD;
    const shown = guard?.showStorageRecovery?.({
      error,
      message: error?.message || "Не удалось прочитать data/zeter-os-state.json.",
      onRetry: loadStorageAndInitialize,
      onOpenData: shouldUseNativeStorage() ? () => nativeStorageCall("open_data_folder") : null,
      onOpenLogs: shouldUseNativeStorage() ? () => nativeStorageCall("open_problem_logs_folder") : null,
      onClose: shouldUseNativeStorage() ? () => nativeStorageCall("close_app") : null
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
      showNativeStorageRecovery(error);
    }
  }

  if (document.readyState === "loading") document.addEventListener('DOMContentLoaded', bootZeTerOs);
  else void bootZeTerOs();
})();
