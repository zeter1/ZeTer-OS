(() => {
  "use strict";

  const { escapeHtml } = window.ZETER_CORE_UTILS;
  const WINDOWS_DOWNLOAD_URL = "https://github.com/zeter1/ZeTer-OS/releases";
  const NATIVE_FEATURES = Object.freeze([
    { id: "windowsFiles", title: "Открытие файлов и папок Windows", methods: ["open_external_target"], alternative: "В браузере можно просмотреть и скопировать путь; ссылки на сайты открываются обычным способом." },
    { id: "windowsStickers", title: "Отдельные окна стикеров Windows", methods: ["open_sticky_window"], alternative: "Используйте стикеры на рабочем столе ZeTer OS или в библиотеке." },
    { id: "fileImport", title: "Полная копия локальных файлов", methods: ["begin_file_import", "append_file_chunk", "finish_file_import", "cancel_file_import"], alternative: "В браузере доступны импорт поддерживаемых материалов и вложения из рабочего стола ZeTer OS." },
    { id: "wordDocuments", title: "Редактирование DOC / DOCX", methods: ["read_managed_document", "save_managed_document"], requirement: "Дополнительно требуется установленный LibreOffice. Его наличие проверяется при открытии документа.", alternative: "В браузере можно скачать вложенный документ и открыть его во внешнем редакторе; заметки ZeTer OS редактируются здесь." },
    { id: "windowsStartup", title: "Автозапуск вместе с Windows", methods: ["get_windows_startup_status", "set_windows_startup_enabled"], alternative: "В браузере запуском управляет браузер или установленная PWA." },
    { id: "systemMetrics", title: "Нагрузка CPU, память и диск Windows", methods: ["get_system_metrics"], alternative: "В браузере монитор показывает доступные сведения о ZeTer OS и браузере." },
    { id: "dataFolder", title: "Открытие папки данных в Windows", methods: ["open_data_folder"], alternative: "В браузере данные принадлежат этому сайту и профилю. Для переноса используйте ZIP-бэкап в Центре безопасности данных." }
  ].map(Object.freeze));

  function getCapabilities({ windowRef = window, runtimeInfo = null } = {}) {
    const env = windowRef, nav = env.navigator || {};
    const training = Boolean(env.ZETER_TRAINING_RUNTIME?.active);
    const api = training ? null : env.pywebview?.api;
    const expectedNative = !training && Boolean(api || env.ZETER_PYTHON_STORAGE || new URLSearchParams(env.location?.search || "").get("native") === "1");
    const native = Boolean(api && typeof api.load_state === "function");
    const pending = expectedNative && !native;
    const windows = native && (!runtimeInfo?.platform || runtimeInfo.platform === "win32");
    const installed = !expectedNative && Boolean(nav.standalone || env.matchMedia?.("(display-mode: standalone)").matches);
    const mobile = !expectedNative && /Android|iPhone|iPad|iPod/i.test(nav.userAgent || "");
    const kind = training ? "training" : expectedNative ? (runtimeInfo?.kind === "exe" || runtimeInfo?.kind === "python" ? runtimeInfo.kind : "native") : installed ? "pwa" : "browser";
    const label = { training: "Учебная среда", exe: "Приложение Windows · EXE", python: "Приложение Windows · Python", native: "Настольное приложение · EXE / Python", pwa: mobile ? "PWA на мобильном устройстве" : "Установленная PWA", browser: mobile ? "Браузер на мобильном устройстве" : "Браузерная версия" }[kind];
    const has = methods => windows && methods.every(method => typeof api[method] === "function");
    const features = [
      { id: "workspace", title: "Заметки, задачи, календарь и другие web-приложения", status: "available", message: "Работают внутри ZeTer OS. Возможности отдельных вложений и системных действий указаны ниже." },
      ...NATIVE_FEATURES.map(definition => {
        const available = has(definition.methods);
        const status = available ? definition.requirement ? "limited" : "available" : pending ? "pending" : "unavailable";
        const reason = training ? "Системные действия отключены на время обучения." : pending ? "Связь с настольным приложением ещё не готова. Если состояние не меняется, перезапустите ZeTer OS." : native ? "Эта возможность недоступна в текущем приложении. Проверьте версию и перезапустите его." : "Для этой функции нужно приложение ZeTer OS для Windows: готовая EXE-сборка или запуск через Python с pywebview.";
        return { id: definition.id, title: definition.title, status, message: available ? definition.requirement || "Доступно через приложение. Права доступа и результат проверяются при выполнении действия." : `${reason} ${definition.alternative}`, requiresWindows: !expectedNative && !training };
      })
    ];
    const nativeFolder = native && typeof api.save_state === "function";
    const browserFolder = !expectedNative && !training && env.isSecureContext && typeof env.showDirectoryPicker === "function";
    const folderStatus = nativeFolder ? "available" : browserFolder ? "permission" : pending ? "pending" : "unavailable";
    const folderMessage = training ? "Системные действия отключены на время обучения."
      : nativeFolder ? "В настольном приложении данные автоматически сохраняются в активной папке data."
      : pending ? "Связь с настольным приложением ещё не готова. После восстановления связи обновите список."
      : expectedNative ? "Текущий системный интерфейс не предоставляет запись данных. Обновите список или перезапустите приложение; проверьте сообщение об ошибке сохранения."
      : browserFolder ? "Выберите папку в Центре безопасности данных и разрешите доступ. После переноса доступ нужно выдать заново."
      : "Этот браузер не предоставляет выбор папки для автосохранения. Используйте скачивание ZIP-бэкапа в Центре безопасности данных.";
    features.push({ id: "folderSave", title: "Автосохранение в выбранную папку", status: folderStatus, message: folderMessage });
    const notification = !training && (native ? typeof api.show_system_notification === "function" : !expectedNative && env.isSecureContext && typeof env.Notification === "function");
    const permission = env.Notification?.permission;
    features.push({ id: "systemNotifications", title: "Системные уведомления", status: notification ? native || permission === "granted" ? "limited" : permission === "denied" ? "unavailable" : "permission" : "unavailable", message: training ? "Системные действия отключены на время обучения." : native && notification ? "Включите доставку в Настройках. Показ зависит от настроек Windows; ZeTer OS должна работать." : notification ? permission === "denied" ? "Уведомления запрещены для этого сайта. Измените разрешение в настройках браузера. Внутренний центр уведомлений остаётся доступен." : "В Настройках нажмите «Проверить уведомление» и разрешите уведомления сайта. Поддержка фоновой доставки зависит от браузера и системы; ZeTer OS должна работать." : "Системная доставка недоступна в этом окружении. Пользуйтесь центром уведомлений внутри ZeTer OS." });
    const exe = runtimeInfo?.kind === "exe" && has(["get_app_update_status", "prepare_app_update", "install_app_update"]);
    features.push({ id: "appUpdates", title: "Автоматическая установка обновлений EXE", status: exe ? "limited" : "unavailable", message: exe ? "Доступность канала и новой сборки проверяется в блоке «Версия и обновления»." : "Автоустановка предназначена для готовой Windows-сборки. Python-исходники обновляются вручную, браузер и PWA — через web-ресурсы сайта." });
    return { kind, label, native, pending, features };
  }

  function getFeature(id, options) {
    const feature = getCapabilities(options).features.find(item => item.id === id);
    if (!feature) throw new Error(`Unknown ZeTer OS capability: ${id}`);
    return feature;
  }

  function featureNoticeHTML(id, options) {
    const feature = getFeature(id, options);
    if (feature.status === "available" || feature.status === "limited") return "";
    return `<aside class="capability-notice"><strong>${feature.requiresWindows ? "Доступно в приложении для Windows" : "Возможность сейчас недоступна"}</strong><p>${escapeHtml(feature.message)}</p><button type="button" data-capabilities-about>Возможности этой версии</button>${feature.requiresWindows ? ` <a href="${WINDOWS_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer">Скачать для Windows</a>` : ""}</aside>`;
  }

  function capabilitiesHTML(snapshot = getCapabilities()) {
    const labels = { available: "Доступно", limited: "С условиями", unavailable: "Недоступно", permission: "Нужна настройка", pending: "Ожидание связи" };
    return `<p class="capabilities-mode" data-runtime-mode>${escapeHtml(snapshot.label)}</p><p class="muted">EXE и Python используют настольные возможности. Телефон и установленная PWA используют возможности браузера. Разрешения и дополнительные компоненты проверяются при выполнении действия.</p><dl class="capabilities-list">${snapshot.features.map(feature => `<div data-capability="${feature.id}"><dt><b>${escapeHtml(feature.title)}</b><span class="capability-status" data-status="${feature.status}">${labels[feature.status]}</span></dt><dd>${escapeHtml(feature.message)}</dd></div>`).join("")}</dl>`;
  }

  window.ZETER_RUNTIME_CAPABILITIES_UTILS = Object.freeze({ WINDOWS_DOWNLOAD_URL, getCapabilities, getFeature, featureNoticeHTML, capabilitiesHTML });
})();
