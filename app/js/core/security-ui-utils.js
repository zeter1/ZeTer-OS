(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const securityUtils = window.ZETER_SECURITY_UTILS;
  const protectionUtils = window.ZETER_SECURITY_PROTECTION_UTILS;
  if (!coreUtils || !securityUtils || !protectionUtils) throw new Error("ZeTer OS security UI utils require core, security and protection utils.");

  const { escapeHtml } = coreUtils;
  const {
    normalizeSecurityMeta,
    collectExternalSaveSnapshotModel,
    collectSecuritySnapshotModel,
    runSecurityIntegrityModel,
    repairSafeSecurityState
  } = securityUtils;
  const {
    normalizeProtectionPolicy,
    protectionProfile,
    recordSecurityEvent,
    stateSummary,
    compareStateSummaries,
    encryptedBackupSupported,
    describeRestorePoint
  } = protectionUtils;

  function securityActionButtonHTML(attribute, icon, title, detail, tone = "") {
    return `<button class="security-action-card ${escapeHtml(tone)}" ${attribute}>
      <span><i aria-hidden="true">${escapeHtml(icon)}</i><b>${escapeHtml(title)}</b></span>
      <small>${escapeHtml(detail)}</small>
    </button>`;
  }

  function restorePayloadPreflightMessage(result = {}) {
    const groups = [
      ["Файлы ZeTer OS", result.missingManagedFiles],
      ["Значки и фоны", result.missingItemAssets],
      ["Небезопасные пути файлов", result.invalidManagedPaths],
      ["Небезопасные пути оформления", result.invalidItemAssetPaths]
    ];
    const details = groups
      .filter(([, values]) => Array.isArray(values) && values.length)
      .map(([label, values]) => `${label}: ${values.join(", ")}`);
    const reason = details.length
      ? details.join(". ")
      : String(result.message || "Не найдены необходимые файлы точки восстановления.").trim();
    return `Точка не применена. ${reason} Восстанови недостающие данные из проверенного ZIP-бэкапа и повтори операцию.`;
  }

  function securityCenterShellHTML(nativeMode = false) {
    return `
      <div class="security-hero">
        <div class="security-hero-copy">
          <h2>Центр безопасности данных</h2>
          <p class="muted">Здесь можно проверить сохранность ZeTer OS, сделать ZIP-бэкап и увидеть, куда реально сохраняются данные.</p>
        </div>
        <div class="security-hero-side">
          <div class="security-hero-badge" data-security-main-badge>Проверка…</div>
          <b class="security-score" data-security-score>—</b>
        </div>
      </div>

      <div class="security-banner" data-security-banner>
        <b>Загрузка статусов</b>
        <span>Считываю реальные данные хранилища.</span>
      </div>

      <section class="security-recommendation">
        <div><span class="security-eyebrow">Рекомендуемое действие</span><b data-security-primary-title>Проверить состояние</b><small data-security-primary-detail>Центр выбирает следующий безопасный шаг по реальным данным.</small></div>
        <button data-security-primary data-action="check">Выполнить</button>
      </section>

      <section class="security-section">
        <div class="security-section-head"><h3>Быстрые действия</h3><p class="muted">Каждая операция сначала проверяет данные и сообщает, что именно было сделано.</p></div>
        <div class="security-action-grid">
          ${securityActionButtonHTML("data-security-backup", "📦", "Создать проверенный ZIP-бэкап", "Собирает полную переносимую копию, добавляет манифест и проверяет контрольные суммы до сохранения.")}
          ${securityActionButtonHTML("data-security-encrypted-backup", "🔐", "Создать зашифрованный бэкап", "Защищает проверенный ZIP парольной фразой AES-256-GCM. Без пароля восстановление невозможно.")}
          ${securityActionButtonHTML("data-security-import", "📥", "Импортировать ZIP, JSON или .zeterbak", "Показывает состав копии, проверяет формат и создаёт аварийную точку перед заменой данных.")}
          ${securityActionButtonHTML("data-security-recovery-test", "🧪", "Проверить восстановление", "Создаёт временный архив в памяти, читает его обратно и проверяет, не изменяя текущие данные.")}
          ${securityActionButtonHTML("data-security-check", "✅", "Проверить целостность ОС", "Проверяет файловую систему, задачи, календарь, совместимость старых данных, точки восстановления и хранилище.")}
          ${securityActionButtonHTML("data-security-restore-point", "🕘", "Создать точку восстановления", "Сохраняет именованный снимок текущего состояния для быстрого локального отката.")}
          ${securityActionButtonHTML("data-security-folder-save", "📁", nativeMode ? "Открыть папку data" : "Выбрать папку автосохранения", nativeMode ? "Открывает реальную папку состояния, резервных копий, журналов и Windows-файлов." : "Разрешает ZeTer OS автоматически обновлять JSON, изображения и читаемые данные в выбранной папке.")}
          ${nativeMode ? securityActionButtonHTML("data-security-readable-folder", "🗂️", "Открыть Windows-копии", "Открывает папку с DOCX, CSV, ICS, изображениями и другими обычными файлами для чтения вне ZeTer OS.") : ""}
          ${securityActionButtonHTML("data-security-folder-save-now", "💾", "Сохранить состояние сейчас", nativeMode ? "Немедленно обновляет data/zeter-os-state.json и Windows-читаемые копии." : "Немедленно записывает и перечитывает резервную копию в выбранной внешней папке.")}
          ${securityActionButtonHTML("data-security-refresh", "↻", "Обновить все статусы", "Повторно считывает размеры, разрешения, точки восстановления, журнал и состояние защиты.")}
        </div>
      </section>

      <section class="security-section">
        <div class="security-section-head">
          <h3>Ключевые статусы</h3>
          <p class="muted">Основные показатели сохранности данных и состояния хранилища.</p>
        </div>
        <div class="security-summary-grid" data-security-stats></div>
      </section>

      <div class="security-main-layout">
        <section class="security-section">
          <div class="security-section-head"><h3>Хранилище и риск</h3><p class="muted">${nativeMode ? "Размер состояния и папки data рядом с программой." : "Объём данных, квота браузера и риск переполнения."}</p></div>
          <div class="security-storage-stack" data-security-storage></div>
        </section>
        <section class="security-section">
          <div class="security-section-head"><h3>Служебные данные</h3><p class="muted">Последние системные события и текущий режим хранения.</p></div>
          <div class="monitor-kv" data-security-kv></div>
        </section>
      </div>

      <section class="security-section security-folder-panel">
        <div class="security-section-head"><h3>${nativeMode ? "Папка данных ZeTer OS" : "Автосохранение бэкапа в папку"}</h3><p class="muted">${nativeMode ? "Папку выбирать не нужно: ZeTer OS автоматически сохраняет состояние, точки восстановления, логи, резервные копии и Windows-открываемые файлы рядом с программой." : "Выбери одну папку на компьютере. ZeTer OS будет обновлять там zeter-os-state.json, изображения и человекочитаемые данные."}</p></div>
        <div class="security-folder-status" data-security-folder-status></div>
        <p class="muted">${nativeMode ? "Основные файлы: data/zeter-os-state.json, data/restore-points.json, data/backups/, data/logs/ и data/Рабочие столы/. В data/Рабочие столы лежит по одному .docx-файлу на заметку/задачу, CSV/ICS для таблиц и календаря, а также обычные изображения. Не запускай app/index.html напрямую, если хочешь использовать эту папку data." : "Браузер не разрешает сохранить сам доступ к папке внутри ZIP-бэкапа. После переноса ОС на другой браузер или компьютер папку нужно выбрать заново."}</p>
      </section>

      <section class="security-section">
        <div class="security-section-head"><h3>Точки восстановления</h3><p class="muted">Выбери конкретный снимок, просмотри его состав, экспортируй или восстанови. Перед откатом текущие данные страхуются автоматически.</p></div>
        <div class="security-restore-list" data-security-restore-list><p class="muted">Загружаю точки восстановления…</p></div>
      </section>

      <section class="security-section security-check-panel">
        <div class="security-section-head"><h3>Результат проверки</h3><p class="muted">Проверка файловой системы, задач, календаря, совместимости старых данных, точек восстановления и хранилища.</p></div>
        <div data-security-check-result>${securityCheckIdleHTML()}</div>
      </section>

      <section class="security-section">
        <div class="security-section-head"><h3>Автоматическая защита</h3><p class="muted">Профиль определяет частоту автоматических точек, глубину истории и допустимый возраст проверенного бэкапа.</p></div>
        <div class="security-policy-row">
          <label><span>Профиль защиты</span><select data-security-policy><option value="standard">Стандартный · точка раз в 24 часа</option><option value="enhanced">Усиленный · точка раз в 6 часов</option><option value="manual">Ручной · без автоматических точек</option></select></label>
          ${securityActionButtonHTML("data-security-policy-save", "🛡️", "Применить профиль", "Сохраняет безопасные лимиты и сразу проверяет, не пора ли создать автоматическую точку.")}
        </div>
        <p class="muted" data-security-policy-status>Загружаю политику защиты…</p>
      </section>

      <section class="security-section">
        <div class="security-section-head"><h3>Безопасная очистка</h3><p class="muted">Сначала рассчитывается объём и количество объектов. Следы удаления из старых версий, история и точки восстановления никогда не выбраны заранее.</p></div>
        <div class="security-cleanup-grid">
          <label><input type="checkbox" data-security-clean="legacy" checked> Старые ключи и базы ZeTer OS</label>
          <label><input type="checkbox" data-security-clean="cache" checked> Устаревшие PWA-кеши</label>
          <label><input type="checkbox" data-security-clean="temporary" ${nativeMode ? "checked" : "disabled"}> Служебные временные файлы${nativeMode ? "" : " · только при запуске через Python"}</label>
          <label><input type="checkbox" data-security-clean="logs" ${nativeMode ? "" : "disabled"}> Старые части журналов${nativeMode ? "" : " · только при запуске через Python"}</label>
          <label><input type="checkbox" data-security-clean="backups" ${nativeMode ? "" : "disabled"}> Автокопии старше 90 дней${nativeMode ? "" : " · только при запуске через Python"}</label>
          <label><input type="checkbox" data-security-clean="trash"> Следы удаления из старых версий без возможности восстановления</label>
          <label><input type="checkbox" data-security-clean="history"> История отмены действий</label>
          <label><input type="checkbox" data-security-clean="restore"> Все точки восстановления</label>
        </div>
        <div class="security-cleanup-summary" data-security-cleanup-summary>Выполняю предварительный расчёт…</div>
        ${securityActionButtonHTML("data-security-clean-old", "🧹", "Рассчитать и очистить выбранное", "Показывает точный план, запрашивает подтверждение и сообщает фактически освобождённое место.", "warn")}
      </section>

      <section class="security-section">
        <div class="security-section-head"><h3>Журнал защиты</h3><p class="muted">Последние проверки, бэкапы, восстановления, очистки и ошибки. Содержимое документов и парольные фразы сюда не записываются.</p></div>
        <div class="security-journal" data-security-journal><p class="muted">Событий пока нет.</p></div>
        ${securityActionButtonHTML("data-security-diagnostic", "🧾", "Сохранить диагностический отчёт", "Экспортирует безопасную техническую сводку без текстов документов, изображений и паролей.")}
      </section>

      <section class="security-section security-danger-zone">
        <div class="security-section-head"><h3>Опасная зона</h3><p class="muted">Перед сбросом создаются проверенный ZIP и аварийная точка. Полный сброс требует ввода слова СБРОС.</p></div>
        <label class="security-reset-scope"><span>Что сбросить</span><select data-security-reset-scope><option value="settings">Только настройки оформления</option><option value="workspace">Пользовательские данные, сохранив настройки</option><option value="full">Полный сброс ZeTer OS</option></select></label>
        ${securityActionButtonHTML("data-security-reset", "⚠️", "Подготовить безопасный сброс", "Создаёт страховочные копии, показывает точный состав операции и только затем запрашивает подтверждение.", "danger")}
      </section>`;
  }

  function securitySummaryCardHTML(label, value, note, tone = "") {
    return `<article class="security-summary-card ${escapeHtml(tone)}"><span class="security-summary-label">${escapeHtml(label)}</span><b class="security-summary-value">${escapeHtml(value)}</b><small class="security-summary-note">${escapeHtml(note)}</small></article>`;
  }

  function securitySummaryCardsHTML(cards = []) {
    return cards.map(card => securitySummaryCardHTML(card.label, card.value, card.note, card.tone)).join("");
  }

  function securityBannerHTML(title, text) {
    return `<b>${escapeHtml(title)}</b><span>${escapeHtml(text)}</span>`;
  }

  function securityFolderStatusHTML(status = {}) {
    return `<div class="security-folder-card ${escapeHtml(status.tone)}">
        <b>${escapeHtml(status.label)}</b>
        <span>${escapeHtml(status.note)}</span>
      </div>`;
  }

  function restorePointCardHTML(point = {}, bytesToHuman = value => String(value || 0)) {
    const item = describeRestorePoint(point);
    const summary = item.summary || {};
    const when = item.createdAt ? new Date(item.createdAt).toLocaleString("ru-RU") : "Дата неизвестна";
    const reasonLabels = { manual: "Создана вручную", automatic: "Автоматическая защита", "pre-import": "Перед импортом", "pre-restore": "Перед восстановлением", "pre-reset": "Перед сбросом", "pre-fix": "Перед исправлением" };
    return `<article class="security-restore-card">
      <div class="security-restore-head"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(reasonLabels[item.reason] || item.reason)} · ${escapeHtml(when)}</small></div>${securityBadgeHTML(item.verified ? "Проверена" : "Не проверена", item.verified ? "ok" : "warn")}</div>
      <div class="security-restore-summary"><span>Файлы: <b>${Number(summary.files || 0)}</b></span><span>Задачи: <b>${Number(summary.tasks || 0)}</b></span><span>События: <b>${Number(summary.events || 0)}</b></span><span>Размер: <b>${escapeHtml(bytesToHuman(item.sizeBytes))}</b></span></div>
      <div class="security-inline-actions">
        <button data-security-restore-id="${escapeHtml(item.id)}"><b>Восстановить</b><small>Заменит текущее состояние после создания страховочной точки.</small></button>
        <button data-security-export-restore-id="${escapeHtml(item.id)}"><b>Экспортировать</b><small>Создаст отдельный проверенный ZIP из этой точки.</small></button>
        <button class="danger-btn" data-security-delete-restore-id="${escapeHtml(item.id)}"><b>Удалить</b><small>Удалит только выбранную точку после подтверждения.</small></button>
      </div>
    </article>`;
  }

  function securityJournalHTML(entries = []) {
    const items = Array.isArray(entries) ? entries.slice(0, 16) : [];
    if (!items.length) return `<p class="muted">Событий защиты пока нет. После первой проверки или бэкапа здесь появится запись.</p>`;
    return items.map(entry => `<article class="security-journal-entry ${escapeHtml(entry.tone || "info")}">
      <time>${escapeHtml(new Date(Number(entry.at || 0)).toLocaleString("ru-RU"))}</time>
      <div><b>${escapeHtml(entry.title || "Событие защиты")}</b>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ""}</div>
    </article>`).join("");
  }

  function cleanupSummaryHTML(preview = {}, bytesToHuman = value => String(value || 0)) {
    const totalBytes = Number(preview.reclaimBytes || 0) + Number(preview.estimatedBrowserBytes || 0);
    return `<b>Предварительный расчёт</b><span>Старые записи удаления: ${Number(preview.legacyDeletedItems || 0)} · история: ${Number(preview.historyItems || 0)} · точки: ${Number(preview.restorePoints || 0)} · старые ключи: ${Number(preview.legacyKeys || 0)} · служебные файлы: ${Number(preview.nativeFiles || 0)} · можно освободить не менее ${escapeHtml(bytesToHuman(totalBytes))}.</span>`;
  }

  function recommendedSecurityAction(snapshot = {}) {
    if (snapshot.status?.tone === "bad") return { action: "check", title: "Проверить критичную проблему", detail: snapshot.status.text || "Нужно уточнить причину риска перед другими действиями." };
    if (snapshot.meta?.lastIntegrityOutcome === "not_checked") return { action: "check", title: "Выполнить первую проверку", detail: "Подтвердит целостность файловой системы, задач, календаря и хранилища." };
    if (!snapshot.meta?.lastBackupVerifiedAt) return { action: "backup", title: "Создать первый проверенный бэкап", detail: "Это даст переносимую копию, которую можно восстановить на другом компьютере." };
    if (!snapshot.restoreCount) return { action: "restore-point", title: "Создать точку восстановления", detail: "Локальная точка позволит быстро откатить неудачное изменение." };
    if (snapshot.protection?.backup?.tone === "warn") return { action: "backup", title: "Обновить устаревший бэкап", detail: snapshot.protection.backup.text };
    return { action: "backup", title: "Обновить проверенный бэкап", detail: "Текущая защита работает; свежая переносимая копия уменьшит возможную потерю данных." };
  }

  function securityBadgeHTML(label, tone = "ok") {
    return `<span class="security-badge ${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
  }

  function securityProblemHTML(problem = {}, index = 0) {
    const tone = problem.level === "bad" ? "bad" : "warn";
    return `<li class="${tone}"><b>${index + 1}.</b> ${escapeHtml(problem.message || "")}</li>`;
  }

  function securityCheckResultHTML(check = {}, fixedCount = null) {
    const problems = Array.isArray(check.problems) ? check.problems : [];
    const status = check.status || "Проверка завершена.";
    const checkedAt = new Date(check.checkedAt || Date.now()).toLocaleString("ru-RU");
    const fixedText = fixedCount != null ? `<p class="muted">Автоматически исправлено безопасных записей: ${escapeHtml(String(fixedCount))}.</p>` : "";
    const body = problems.length
      ? `<ul>${problems.map(securityProblemHTML).join("")}</ul><div class="choice-row"><button data-security-fix>Исправить безопасные проблемы</button></div>`
      : `<p class="muted">Файловая система, задачи, календарь, точки восстановления и хранилище читаются нормально.</p>`;
    return `<div class="security-check-box ${problems.length ? "has-problems" : "ok"}">
      <div class="security-check-head"><b>${escapeHtml(status)}</b><span>${escapeHtml(checkedAt)}</span></div>
      ${fixedText}
      ${body}
    </div>`;
  }

  function securityCheckIdleHTML() {
    return `<p class="muted">Нажми «Проверить целостность ОС», чтобы выполнить полную проверку данных.</p>`;
  }

  function securityCenterAction(target) {
    const primary = target?.closest?.("[data-security-primary]");
    if (primary) return { type: primary.dataset.action || "check" };
    if (target?.closest?.("[data-security-backup]")) return { type: "backup" };
    if (target?.closest?.("[data-security-encrypted-backup]")) return { type: "encrypted-backup" };
    if (target?.closest?.("[data-security-import]")) return { type: "import" };
    if (target?.closest?.("[data-security-recovery-test]")) return { type: "recovery-test" };
    if (target?.closest?.("[data-security-refresh]")) return { type: "refresh" };
    if (target?.closest?.("[data-security-restore-point]")) return { type: "restore-point" };
    if (target?.closest?.("[data-security-restore-latest]")) return { type: "restore-latest" };
    if (target?.closest?.("[data-security-folder-save]")) return { type: "folder-save" };
    if (target?.closest?.("[data-security-readable-folder]")) return { type: "readable-folder" };
    if (target?.closest?.("[data-security-folder-save-now]")) return { type: "folder-save-now" };
    if (target?.closest?.("[data-security-clean-old]")) return { type: "clean-old" };
    if (target?.closest?.("[data-security-reset]")) return { type: "reset" };
    if (target?.closest?.("[data-security-check]")) return { type: "check" };
    if (target?.closest?.("[data-security-fix]")) return { type: "fix" };
    if (target?.closest?.("[data-security-policy-save]")) return { type: "policy-save" };
    if (target?.closest?.("[data-security-diagnostic]")) return { type: "diagnostic" };
    const restore = target?.closest?.("[data-security-restore-id]");
    if (restore) return { type: "restore-id", id: restore.dataset.securityRestoreId || "" };
    const exportRestore = target?.closest?.("[data-security-export-restore-id]");
    if (exportRestore) return { type: "export-restore-id", id: exportRestore.dataset.securityExportRestoreId || "" };
    const deleteRestore = target?.closest?.("[data-security-delete-restore-id]");
    if (deleteRestore) return { type: "delete-restore-id", id: deleteRestore.dataset.securityDeleteRestoreId || "" };
    return null;
  }

  function renderSecurityCheckResult(node, check, fixedCount = null) {
    if (!node) return;
    node.innerHTML = securityCheckResultHTML(check, fixedCount);
  }

  function renderSecuritySnapshot(root, snapshot, options = {}) {
    if (!root || !snapshot) return;
    const {
      nativeMode = false,
      formatSecurityTime = value => String(value || ""),
      bytesToHuman = value => String(value || 0),
      restoreLimit = 0,
      storageRuntime = {},
      browserPersistenceAvailable = false,
      securityStorageMetersHTML = () => "",
      securityKvRowsHTML = () => ""
    } = options;
    const find = selector => root.querySelector?.(selector);
    const overall = snapshot.protection || { ...snapshot.status, score: 0 };
    const badge = find("[data-security-main-badge]");
    if (badge) {
      badge.className = `security-hero-badge ${overall.tone}`;
      badge.textContent = overall.label;
    }
    const score = find("[data-security-score]");
    if (score) score.textContent = `${Number(overall.score || 0)} / 100`;
    const recommendation = recommendedSecurityAction(snapshot);
    const primary = find("[data-security-primary]");
    if (primary) primary.dataset.action = recommendation.action;
    const primaryTitle = find("[data-security-primary-title]");
    if (primaryTitle) primaryTitle.textContent = recommendation.title;
    const primaryDetail = find("[data-security-primary-detail]");
    if (primaryDetail) primaryDetail.textContent = recommendation.detail;
    const banner = find("[data-security-banner]");
    if (banner) {
      let title = overall.label;
      let text = [overall.data?.text, overall.backup?.text, overall.recovery?.text].filter(Boolean).join(" ") || snapshot.status.text;
      let tone = overall.tone;
      if (snapshot.restoreError) {
        title = "Точки восстановления";
        text = snapshot.restoreError;
        tone = "warn";
      } else if (snapshot.risk?.tone !== "ok") {
        title = `Риск переполнения: ${snapshot.risk.label}`;
        text = snapshot.risk.text;
        tone = snapshot.risk.tone;
      }
      banner.className = `security-banner ${tone}`;
      banner.innerHTML = securityBannerHTML(title, text);
    }
    const policy = normalizeProtectionPolicy(snapshot.meta?.protectionPolicy);
    const effectiveLimit = Math.min(restoreLimit || 12, policy.restoreLimit);
    const stats = find("[data-security-stats]");
    if (stats) stats.innerHTML = securitySummaryCardsHTML([
      { label: "Целостность данных", value: overall.data?.label || snapshot.status.label, note: overall.data?.text || snapshot.status.text, tone: overall.data?.tone || snapshot.status.tone },
      { label: "Переносимый бэкап", value: overall.backup?.label || "Неизвестно", note: overall.backup?.text || "", tone: overall.backup?.tone || "warn" },
      { label: "Готовность отката", value: overall.recovery?.label || "Неизвестно", note: overall.recovery?.text || "", tone: overall.recovery?.tone || "warn" },
      { label: "Автосохранение", value: formatSecurityTime(snapshot.lastAutosaveAt), note: nativeMode ? "JSON + Windows-копии: data/Рабочие столы" : (storageRuntime.fallback ? "Аварийный режим через localStorage" : "Основное состояние хранится в IndexedDB") },
      { label: "ZIP-бэкап", value: formatSecurityTime(snapshot.meta.lastFullBackupAt, "Бэкап ещё не создавался"), note: snapshot.meta.lastFullBackupSize ? `${bytesToHuman(snapshot.meta.lastFullBackupSize)} · ${snapshot.meta.lastFullBackupName || "ZIP"}` : "ZIP-файл ещё не создавался" },
      { label: "Точки восстановления", value: String(snapshot.restoreCount), note: snapshot.restoreCount ? `Доступно до ${effectiveLimit} последних точек` : "Точек восстановления пока нет" },
      { label: nativeMode ? "Папка данных" : "Папка бэкапа", value: snapshot.externalSave.label, note: snapshot.externalSave.folderName ? snapshot.externalSave.folderName : snapshot.externalSave.note, tone: snapshot.externalSave.tone },
      { label: "Размер состояния", value: bytesToHuman(snapshot.stateBytes), note: nativeMode ? "Файл состояния в папке data" : `Доп. настройки в localStorage: ${bytesToHuman(snapshot.localSettingsBytes)}` },
      { label: "Риск переполнения", value: snapshot.risk.label, note: snapshot.risk.text, tone: snapshot.risk.tone }
    ]);
    const storage = find("[data-security-storage]");
    if (storage) storage.innerHTML = securityStorageMetersHTML({
      nativeMode,
      stateBytes: snapshot.stateBytes,
      dataUsageBytes: snapshot.usage,
      readableBytes: snapshot.nativeInfo?.readableBytes || 0,
      readableFiles: snapshot.nativeInfo?.readableFiles || 0,
      localSettingsBytes: snapshot.localSettingsBytes,
      quota: snapshot.quota,
      usage: snapshot.usage,
      statePct: snapshot.statePct,
      usagePct: snapshot.usagePct,
      riskTone: snapshot.risk.tone
    });
    const kvBox = find("[data-security-kv]");
    if (kvBox) kvBox.innerHTML = securityKvRowsHTML({
      nativeMode,
      dataFolder: snapshot.externalSave.folderName || "data",
      backupDir: snapshot.nativeInfo?.backupDir || "data/backups",
      readableDir: snapshot.nativeInfo?.readableDir || "data/Рабочие столы",
      logFile: snapshot.nativeInfo?.logFile || "data/logs/zeter-os.log",
      lastLoadedText: formatSecurityTime(snapshot.lastLoadedAt, "После запуска ещё не фиксировалась"),
      lastCheckText: formatSecurityTime(snapshot.meta.lastIntegrityCheckAt, "Ещё не выполнялась"),
      integrityStatus: snapshot.meta.lastIntegrityStatus || "Проверка ещё не выполнялась",
      lastError: storageRuntime.lastError || "Нет",
      browserStorageText: storageRuntime.fallback ? "localStorage · аварийный режим" : "IndexedDB",
      backupFolderText: snapshot.externalSave.folderName || snapshot.externalSave.label,
      persistenceText: browserPersistenceAvailable ? "Разрешено браузером" : "Обычный режим браузера"
    });
    const folderStatus = find("[data-security-folder-status]");
    if (folderStatus) folderStatus.innerHTML = securityFolderStatusHTML(snapshot.externalSave);
    const restoreList = find("[data-security-restore-list]");
    if (restoreList) restoreList.innerHTML = snapshot.restorePoints?.length
      ? snapshot.restorePoints.map(point => restorePointCardHTML(point, bytesToHuman)).join("")
      : `<p class="muted">Точек пока нет. Создай первую точку перед крупным изменением.</p>`;
    const policySelect = find("[data-security-policy]");
    if (policySelect) policySelect.value = policy.profile;
    const profile = protectionProfile(policy.profile);
    const policyStatus = find("[data-security-policy-status]");
    if (policyStatus) policyStatus.textContent = policy.autoRestoreHours
      ? `${profile.label}: автоматическая точка раз в ${policy.autoRestoreHours} ч., хранится до ${policy.restoreLimit}, проверенный бэкап считается свежим ${policy.verifiedBackupMaxAgeDays} дн.`
      : `${profile.label}: автоматические точки отключены; ручные точки и проверка бэкапов продолжают работать.`;
    const cleanup = find("[data-security-cleanup-summary]");
    if (cleanup) cleanup.innerHTML = cleanupSummaryHTML(snapshot.cleanupPreview, bytesToHuman);
    const journal = find("[data-security-journal]");
    if (journal) journal.innerHTML = securityJournalHTML(snapshot.meta?.journal);
  }

  function createSecurityCenterApp(integration = {}) {
    const {
      document,
      nativeMode = false,
      collectSecuritySnapshot = async () => ({}),
      renderOptions = {},
      exportBackup = async () => {},
      exportEncryptedBackup = async () => {},
      openImport = () => {},
      toast = () => {},
      createRestorePoint = async () => {},
      restoreLatestPoint = async () => {},
      chooseExternalSaveFolder = async () => {},
      openReadableFolder = async () => ({}),
      writeExternalBackup = async () => {},
      cleanOldData = async () => {},
      resetOs = async () => {},
      runIntegrityCheck = async () => ({ problems: [] }),
      fixSafeProblems = async () => {},
      runRecoveryTest = async () => {},
      restorePointById = async () => {},
      exportRestorePoint = async () => {},
      deleteRestorePoint = async () => {},
      setProtectionProfile = async () => {},
      exportDiagnosticReport = async () => {}
    } = integration;
    if (!document?.createElement) throw new Error("Security center requires a document.");
    const root = document.createElement("div");
    root.className = "app-shell security-center-app";
    root.innerHTML = securityCenterShellHTML(nativeMode);

    const refresh = async () => {
      const snapshot = await collectSecuritySnapshot();
      renderSecuritySnapshot(root, snapshot, { ...renderOptions, nativeMode });
    };

    let actionBusy = false;
    root.addEventListener("click", async event => {
      const action = securityCenterAction(event.target);
      if (!action || actionBusy) return;
      const trigger = event.target?.closest?.("button");
      actionBusy = true;
      if (trigger) trigger.disabled = true;
      try {
        if (action.type === "backup") { await exportBackup(); await refresh(); return; }
        if (action.type === "encrypted-backup") { await exportEncryptedBackup(); await refresh(); return; }
        if (action.type === "import") { openImport(); return; }
        if (action.type === "recovery-test") { await runRecoveryTest(); await refresh(); return; }
        if (action.type === "refresh") { await refresh(); toast("Статусы обновлены", "Центр безопасности перечитал состояние ZeTer OS."); return; }
        if (action.type === "restore-point") { await createRestorePoint(root); await refresh(); return; }
        if (action.type === "restore-latest") { await restoreLatestPoint(); return; }
        if (action.type === "restore-id") { await restorePointById(action.id); return; }
        if (action.type === "export-restore-id") { await exportRestorePoint(action.id); await refresh(); return; }
        if (action.type === "delete-restore-id") { await deleteRestorePoint(action.id); await refresh(); return; }
        if (action.type === "folder-save") { await chooseExternalSaveFolder(); await refresh(); return; }
        if (action.type === "readable-folder") {
          try {
            const info = await openReadableFolder();
            toast("Windows-папки открыты", info?.readableDir || "data/Рабочие столы");
          } catch (err) {
            toast("Не удалось открыть Windows-папки", err?.message || "Проверь запуск через run_zeter_os.py.");
          }
          await refresh();
          return;
        }
        if (action.type === "folder-save-now") { await writeExternalBackup(); await refresh(); return; }
        if (action.type === "clean-old") { await cleanOldData(root); await refresh(); return; }
        if (action.type === "reset") { await resetOs(root); return; }
        if (action.type === "policy-save") { await setProtectionProfile(root.querySelector?.("[data-security-policy]")?.value || "standard"); await refresh(); return; }
        if (action.type === "diagnostic") { await exportDiagnosticReport(); return; }
        if (action.type === "check") {
          const box = root.querySelector?.("[data-security-check-result]");
          if (box) box.innerHTML = `<p class="muted">Проверяю данные ZeTer OS…</p>`;
          const check = await runIntegrityCheck({ persist: true });
          renderSecurityCheckResult(box, check);
          await refresh();
          toast("Проверка завершена", check.problems.length ? `Найдено проблем: ${check.problems.length}` : "Ошибок не найдено.");
          return;
        }
        if (action.type === "fix") { await fixSafeProblems(root); await refresh(); }
      } finally {
        actionBusy = false;
        if (trigger) trigger.disabled = false;
      }
    });
    refresh();
    return root;
  }

  function createSecurityRuntimeController(options = {}) {
    const {
      getState = () => ({}),
      currentWorkspace = () => ({}),
      shouldUseNativeStorage = () => false,
      supportsExternalFolderSave = () => false,
      getExternalDirectoryHandle = () => null,
      nativeStorageCall = async () => ({}),
      storedStateSizeBytes = () => 0,
      storageRuntime = {},
      storageWarningRatio = 0.9,
      storageWarningCooldownMs = 15 * 60 * 1000,
      storageCheckDebounceMs = 1200,
      byteSize = value => String(value || "").length,
      readSmallSettings = () => "",
      readLegacyState = () => null,
      getStorageEstimate = async () => null,
      percent = (used, total) => total > 0 ? (used / total) * 100 : null,
      readPrimaryStateRecord = async () => null,
      saveState = async () => {},
      confirmUser = () => false,
      promptUser = () => null,
      purgeDeletedItemsFromStorageState = () => 0,
      purgeExpiredTrashItems = () => 0,
      clearLegacyLocalStorageDataCore = () => 0,
      oldLocalStorageKeys = [],
      smallSettingsKey = "",
      storageKey = "",
      clearOldIndexedDbDataCore = async () => 0,
      oldRestoreDbNames = [],
      externalDbName = "",
      primaryStateDbName = "",
      deleteIndexedDatabaseByName = async () => false,
      clearOldPwaCachesCore = async () => 0,
      activeCacheName = "",
      refreshRecycleBinWindows = () => {},
      localStorageRef = window.localStorage,
      indexedDbAvailable = () => Boolean(window.indexedDB),
      clearNativeState = async () => {},
      clearExternalRuntimeState = () => {},
      clearIndexedDbStore = async () => {},
      externalStoreName = "",
      clearNativeRestorePoints = async () => {},
      restoreDbName = "",
      restoreStoreName = "",
      openIndexedDb = async () => null,
      transactionDone = async () => {},
      readIndexedDbRecord = async () => null,
      getAllIndexedDbRecords = async () => [],
      loadNativeRestorePoints = async () => ({ points: [] }),
      preflightNativeRestorePoint = async () => ({ ready: true }),
      saveNativeRestorePoint = async () => {},
      deleteNativeRestorePoint = async () => ({}),
      cleanupNativeArtifacts = async () => ({}),
      syncLiveEditorsBeforeExport = () => {},
      cloneForBackup = value => value,
      defaultState = () => ({}),
      osVersion = "",
      replaceStateFromRestore = () => {},
      reload = () => {},
      trashRoot = "trash",
      isDesktopRoot = () => false,
      getDesktopRoot = () => "desktop",
      uid = prefix => `${prefix}-${Date.now()}`,
      todayISO = () => new Date().toISOString().slice(0, 10),
      normalizeTaskStore = () => {},
      normalizeCalendarStore = () => {},
      normalizeNotificationStore = () => {},
      renderAllFileSurfaces = () => {},
      toast = () => {},
      documentRef = document,
      refreshWindow = () => {},
      schedule = (callback, delay) => setTimeout(callback, delay),
      clearScheduled = timer => clearTimeout(timer),
      navigatorRef = window.navigator,
      now = () => Date.now(),
      consoleRef = console,
      formatSecurityTime = value => String(value || ""),
      bytesToHuman = value => String(value || 0),
      restoreLimit = 0,
      browserPersistenceAvailable = () => false,
      securityStorageMetersHTML = () => "",
      securityKvRowsHTML = () => "",
      exportBackup = async () => {},
      buildBackupForState = async () => null,
      verifyBackup = async () => ({ ok: false }),
      encryptBackup = async () => null,
      downloadBlob = async () => {},
      backupFileName = () => "ZeTer_OS_full_backup.zip",
      validateImportedState = value => value,
      openImport = () => {},
      chooseExternalSaveFolder = async () => {},
      openReadableFolder = async () => ({}),
      writeExternalBackup = async () => {},
      createSecurityApp = createSecurityCenterApp
    } = options;
    let storagePressureTimer = null;
    let protectionCheckTimer = null;

    function addJournalEvent(event, persist = false) {
      const entry = recordSecurityEvent(securityMeta(), event, now);
      if (persist) saveState({ skipExternalBackup: true, skipProtectionCheck: true, silentStorageError: true });
      return entry;
    }

    function scheduleStoragePressureCheck() {
      clearScheduled(storagePressureTimer);
      storagePressureTimer = schedule(() => checkStoragePressure(), storageCheckDebounceMs);
    }

    async function checkStoragePressure() {
      try {
        if (shouldUseNativeStorage()) {
          const info = await nativeStorageCall("get_storage_info");
          const usage = Number(info?.dataBytes || 0);
          storageRuntime.usage = usage;
          storageRuntime.quota = null;
          storageRuntime.pressurePct = null;
          storageRuntime.stateBytes = Number(info?.stateBytes || storageRuntime.stateBytes || 0);
          return { usage, quota: null, pressurePct: null, statePct: null, dataDir: info?.dataDir || "" };
        }
        if (!navigatorRef?.storage?.estimate) return null;
        const estimate = await navigatorRef.storage.estimate();
        const usage = Number(estimate.usage || 0);
        const quota = Number(estimate.quota || 0);
        const pressurePct = quota > 0 ? (usage / quota) * 100 : null;
        storageRuntime.usage = usage;
        storageRuntime.quota = quota;
        storageRuntime.pressurePct = pressurePct;
        const statePct = quota > 0 ? percent(storedStateSizeBytes(), quota) : null;
        const almostFull = (pressurePct != null && pressurePct >= storageWarningRatio * 100) || (statePct != null && statePct >= storageWarningRatio * 100);
        const checkedAt = now();
        if (almostFull && checkedAt - storageRuntime.warningShownAt > storageWarningCooldownMs) {
          storageRuntime.warningShownAt = checkedAt;
          toast("Хранилище почти заполнено", "Скачай бэкап ZeTer OS и удали лишние большие файлы или картинки.");
        }
        return { usage, quota, pressurePct, statePct };
      } catch (error) {
        consoleRef.warn("[ZeTer OS storage estimate]", error);
        return null;
      }
    }

    function clearLegacyLocalStorageData() {
      return clearLegacyLocalStorageDataCore({
        oldKeys: oldLocalStorageKeys,
        smallSettingsKey,
        storageKey,
        keepStorageKey: storageRuntime.fallback
      });
    }

    async function clearOldIndexedDbData() {
      return clearOldIndexedDbDataCore({
        names: oldRestoreDbNames,
        excludeNames: [externalDbName, primaryStateDbName],
        deleteDatabase: deleteIndexedDatabaseByName
      });
    }

    async function clearOldPwaCaches() {
      return clearOldPwaCachesCore({ activeCacheName });
    }

    async function collectCleanupPreview() {
      const target = getState();
      const fs = Object.values(target?.fs || {});
      const oldKeys = oldLocalStorageKeys.filter(key => key !== smallSettingsKey && key !== storageKey && localStorageRef?.getItem?.(key) != null);
      let estimatedBrowserBytes = 0;
      oldKeys.forEach(key => { try { estimatedBrowserBytes += byteSize(localStorageRef.getItem(key) || ""); } catch {} });
      let native = {};
      if (shouldUseNativeStorage()) {
        try { native = await cleanupNativeArtifacts({ dryRun: true, logs: true, backups: true, temporary: true }); } catch {}
      }
      let restorePoints = 0;
      try { restorePoints = (await readRestorePoints()).length; } catch {}
      return {
        legacyDeletedItems: fs.filter(item => item && (item.deletedAt || item.parent === trashRoot)).length,
        historyItems: Array.isArray(target?.actionHistory) ? target.actionHistory.length : 0,
        restorePoints,
        legacyKeys: oldKeys.length,
        estimatedBrowserBytes,
        reclaimBytes: Number(native?.reclaimBytes || 0),
        nativeFiles: Number(native?.backupFiles || 0) + Number(native?.temporaryFiles || 0) + (Number(native?.logBytes || 0) ? 1 : 0),
        native
      };
    }

    function selectedCleanupOptions(root) {
      const selected = new Set([...(root?.querySelectorAll?.("[data-security-clean]:checked") || [])].map(input => input.dataset.securityClean));
      return Object.fromEntries(["legacy", "cache", "temporary", "logs", "backups", "trash", "history", "restore"].map(key => [key, selected.has(key)]));
    }

    async function cleanOldOsBrowserData(root = documentRef) {
      const selection = selectedCleanupOptions(root);
      const names = Object.entries(selection).filter(([, enabled]) => enabled).map(([key]) => ({ legacy: "старые ключи и базы", cache: "PWA-кеши", temporary: "временные файлы", logs: "старые части журналов", backups: "автокопии старше 90 дней", trash: "следы удаления из старых версий", history: "история отмены", restore: "точки восстановления" }[key]));
      if (!names.length) return toast("Нечего очищать", "Выбери хотя бы одну категорию.");
      const preview = await collectCleanupPreview();
      const warning = `Будут очищены: ${names.join(", ")}. Старые записи удаления: ${preview.legacyDeletedItems}, история: ${preview.historyItems}, точки восстановления: ${preview.restorePoints}, служебные файлы: ${preview.nativeFiles}. Продолжить?`;
      if (!confirmUser(warning)) return false;

      const destructive = selection.trash || selection.history || selection.restore;
      if (destructive) {
        const backup = await exportBackup({ source: "pre-cleanup" });
        if (!backup) return toast("Очистка отменена", "Не удалось создать проверенный страховочный ZIP-бэкап.");
        if (!selection.restore) await createRestorePoint(null, { name: "Перед очисткой", reason: "pre-cleanup", silent: true });
      }

      const before = storedStateSizeBytes();
      let deletedItems = 0;
      if (selection.trash) deletedItems = purgeDeletedItemsFromStorageState(getState(), { dropActionHistory: selection.history });
      else if (selection.history) getState().actionHistory = [];
      const legacyKeys = selection.legacy ? clearLegacyLocalStorageData() : 0;
      const oldCaches = selection.cache ? await clearOldPwaCaches() : 0;
      const oldDbs = selection.legacy ? await clearOldIndexedDbData() : 0;
      if (selection.restore) {
        if (shouldUseNativeStorage()) await clearNativeRestorePoints();
        else if (indexedDbAvailable()) await deleteIndexedDatabaseByName(restoreDbName);
      }
      let nativeResult = {};
      if (shouldUseNativeStorage() && (selection.logs || selection.backups || selection.temporary)) {
        nativeResult = await cleanupNativeArtifacts({ dryRun: false, logs: selection.logs, backups: selection.backups, temporary: selection.temporary });
      }
      securityMeta().lastCleanupAt = now();
      const after = storedStateSizeBytes();
      const freed = Math.max(0, before - after) + Number(nativeResult?.reclaimBytes || 0);
      const details = `старых записей удаления: ${deletedItems} · старых ключей: ${legacyKeys} · кешей: ${oldCaches} · баз: ${oldDbs} · освобождено не менее ${bytesToHuman(freed)}`;
      addJournalEvent({ type: "cleanup", tone: "ok", title: "Безопасная очистка завершена", detail: details });
      await saveState({ skipProtectionCheck: true });
      renderAllFileSurfaces();
      refreshRecycleBinWindows();
      toast("Очистка завершена", details);
      return true;
    }

    function openRestoreDb() {
      return openIndexedDb(restoreDbName, restoreStoreName, {
        keyPath: "id",
        unavailableMessage: "IndexedDB недоступен в этом браузере."
      });
    }

    async function readRestorePoints() {
      if (shouldUseNativeStorage()) {
        const result = await loadNativeRestorePoints();
        const points = Array.isArray(result?.points) ? result.points : [];
        return points.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      }
      const points = await getAllIndexedDbRecords(restoreDbName, restoreStoreName, {
        keyPath: "id",
        unavailableMessage: "IndexedDB недоступен в этом браузере."
      });
      return points.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    }

    function effectiveRestoreLimit() {
      return Math.min(restoreLimit || 12, normalizeProtectionPolicy(securityMeta().protectionPolicy).restoreLimit);
    }

    async function pruneRestorePoints(db, limit = effectiveRestoreLimit()) {
      const tx = db.transaction(restoreStoreName, "readwrite");
      const store = tx.objectStore(restoreStoreName);
      const request = store.getAll();
      request.onsuccess = () => {
        const points = request.result || [];
        points.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        points.slice(limit).forEach(point => store.delete(point.id));
      };
      await transactionDone(tx);
    }

    async function writeRestorePoint(point) {
      if (shouldUseNativeStorage()) {
        await saveNativeRestorePoint(point);
        const points = await readRestorePoints();
        for (const old of points.slice(effectiveRestoreLimit())) await deleteNativeRestorePoint(old.id);
        return;
      }
      const db = await openRestoreDb();
      try {
        const tx = db.transaction(restoreStoreName, "readwrite");
        tx.objectStore(restoreStoreName).put(point);
        await transactionDone(tx);
        await pruneRestorePoints(db);
      } finally {
        db.close();
      }
    }

    async function createRestorePoint(root = documentRef, pointOptions = {}) {
      try {
        let name = String(pointOptions.name || "").trim();
        const reason = pointOptions.reason || "manual";
        if (!name && reason === "manual") {
          const requested = promptUser("Название точки восстановления:", `Ручная точка ${new Date(now()).toLocaleString("ru-RU")}`);
          if (requested == null) return null;
          name = String(requested).trim();
        }
        if (!name) name = reason === "automatic" ? "Автоматическая точка" : "Страховочная точка";
        syncLiveEditorsBeforeExport();
        purgeExpiredTrashItems(getState(), { dropActionHistory: true });
        await saveState({ skipExternalBackup: true, skipProtectionCheck: true });
        const snapshot = cloneForBackup(getState());
        const point = {
          id: uid("restore"),
          app: "ZeTer OS",
          osVersion,
          createdAt: now(),
          name: name.slice(0, 160),
          reason,
          verified: true,
          summary: stateSummary(snapshot),
          sizeBytes: byteSize(JSON.stringify(snapshot)),
          state: snapshot
        };
        await writeRestorePoint(point);
        if (reason === "automatic") securityMeta().lastAutoRestorePointAt = point.createdAt;
        addJournalEvent({ type: "restore-point", tone: "ok", title: "Создана точка восстановления", detail: `${point.name} · ${bytesToHuman(point.sizeBytes)}` });
        await saveState({ skipExternalBackup: true, skipProtectionCheck: true, silentStorageError: true });
        const status = root?.querySelector?.("[data-restore-status]");
        if (status) status.textContent = `Точка создана: ${new Date(point.createdAt).toLocaleString("ru-RU")}. Хранится до ${effectiveRestoreLimit()} последних точек.`;
        if (!pointOptions.silent) toast("Точка восстановления создана", `${point.name}. ${shouldUseNativeStorage() ? "Хранится в data/restore-points.json." : "Хранится в IndexedDB этого браузера."}`);
        return point;
      } catch (error) {
        consoleRef.error("[ZeTer OS restore point]", error);
        if (!pointOptions.silent) toast("Не удалось создать точку", error?.message || "IndexedDB недоступен.");
        return null;
      }
    }

    async function deleteRestorePointById(pointId, ask = true) {
      const points = await readRestorePoints();
      const point = points.find(item => item?.id === pointId);
      if (!point) return false;
      if (ask && !confirmUser(`Удалить только точку «${point.name || "Точка восстановления"}»? Остальные точки и текущее состояние не изменятся.`)) return false;
      if (shouldUseNativeStorage()) await deleteNativeRestorePoint(pointId);
      else {
        const db = await openRestoreDb();
        try {
          const tx = db.transaction(restoreStoreName, "readwrite");
          tx.objectStore(restoreStoreName).delete(pointId);
          await transactionDone(tx);
        } finally { db.close(); }
      }
      addJournalEvent({ type: "restore-delete", tone: "warn", title: "Удалена точка восстановления", detail: point.name || pointId });
      await saveState({ skipExternalBackup: true, skipProtectionCheck: true });
      toast("Точка удалена", point.name || "Выбранная точка восстановления");
      return true;
    }

    async function restorePointById(pointId) {
      let previousState = null;
      let stateWasReplaced = false;
      try {
        const points = await readRestorePoints();
        const point = points.find(item => item?.id === pointId);
        if (!point?.state) return toast("Точка недоступна", "Выбранная точка отсутствует или повреждена.");
        validateImportedState(cloneForBackup(point.state));
        if (shouldUseNativeStorage()) {
          const preflight = await preflightNativeRestorePoint(pointId);
          if (!preflight?.ready) {
            const detail = restorePayloadPreflightMessage(preflight);
            toast("Точка не применена", detail);
            if (confirmUser(`${detail}\n\nОткрыть импорт проверенного ZIP-бэкапа?`)) openImport();
            return false;
          }
        }
        const when = new Date(point.createdAt || now()).toLocaleString("ru-RU");
        if (!confirmUser(`Восстановить «${point.name || "Точка восстановления"}» от ${when}? Сначала будет создана страховочная точка текущего состояния.`)) return false;
        const safety = await createRestorePoint(null, { name: "Перед восстановлением", reason: "pre-restore", silent: true });
        if (!safety) throw new Error("Не удалось создать страховочную точку текущего состояния.");
        previousState = cloneForBackup(getState());
        replaceStateFromRestore(point.state);
        stateWasReplaced = true;
        addJournalEvent({ type: "restore", tone: "ok", title: "Состояние восстановлено", detail: `${point.name || point.id} · ${when}` });
        await saveState({ skipProtectionCheck: true });
        toast("Восстановление выполнено", `Загружена точка «${point.name || when}». Текущее предыдущее состояние сохранено отдельно.`);
        schedule(reload, 800);
        return true;
      } catch (error) {
        consoleRef.error("[ZeTer OS restore point]", error);
        let rollbackFailed = false;
        if (stateWasReplaced && previousState) {
          try { replaceStateFromRestore(previousState); }
          catch (rollbackError) {
            rollbackFailed = true;
            consoleRef.error("[ZeTer OS restore rollback]", rollbackError);
          }
        }
        const rollbackDetail = stateWasReplaced
          ? (rollbackFailed ? " Не удалось вернуть состояние в памяти — перезапусти ZeTer OS." : " Предыдущее состояние оставлено активным.")
          : "";
        toast("Не удалось восстановить", `${error?.message || "Точка восстановления недоступна."}${rollbackDetail}`);
        return false;
      }
    }

    async function restoreLatestPoint() {
      const points = await readRestorePoints();
      if (!points[0]) return toast("Точек восстановления нет", "Сначала создай точку восстановления.");
      return restorePointById(points[0].id);
    }

    async function exportRestorePoint(pointId) {
      const point = (await readRestorePoints()).find(item => item?.id === pointId);
      if (!point?.state) return toast("Точка недоступна", "Не удалось прочитать выбранный снимок.");
      const zip = await buildBackupForState(point.state);
      const verification = zip?.zeterVerification || await verifyBackup(zip);
      if (!verification?.ok || !verification?.verified) throw new Error("ZIP точки не прошёл проверку.");
      const safeDate = new Date(point.createdAt || now()).toISOString().slice(0, 10);
      const name = `ZeTer_OS_restore_point_${safeDate}_${String(point.id).slice(-12)}.zip`;
      const result = await downloadBlob(name, zip);
      if (result?.cancelled) return false;
      addJournalEvent({ type: "restore-export", tone: "ok", title: "Точка экспортирована", detail: `${point.name || point.id} · ${bytesToHuman(zip.size)}` }, true);
      toast("Точка экспортирована и проверена", name);
      return true;
    }

    async function resetPrimaryStateStorage() {
      try { localStorageRef?.removeItem(storageKey); } catch {}
      try { localStorageRef?.removeItem(smallSettingsKey); } catch {}
      if (shouldUseNativeStorage()) {
        await clearNativeState();
        return;
      }
      if (!indexedDbAvailable()) return;
      await deleteIndexedDatabaseByName(primaryStateDbName);
    }

    async function clearExternalSaveHandleStorage() {
      clearExternalRuntimeState();
      if (!indexedDbAvailable()) return;
      try {
        await clearIndexedDbStore(externalDbName, externalStoreName);
      } catch (error) {
        consoleRef.warn("[ZeTer OS clear external save handle]", error);
      }
    }

    function openExternalDb() {
      return openIndexedDb(externalDbName, externalStoreName);
    }

    async function storeExternalHandle(handle) {
      const db = await openExternalDb();
      try {
        const tx = db.transaction(externalStoreName, "readwrite");
        const store = tx.objectStore(externalStoreName);
        store.clear();
        store.put(handle, "directory");
        await transactionDone(tx);
      } finally {
        db.close();
      }
    }

    async function loadExternalHandle() {
      const direct = await readIndexedDbRecord(externalDbName, externalStoreName, "directory");
      if (direct) return direct;
      const all = await getAllIndexedDbRecords(externalDbName, externalStoreName);
      return (all || []).find(handle => handle && handle.kind === "directory") || null;
    }

    async function verifyExternalPermission(handle, write = true) {
      const permissionOptions = { mode: write ? "readwrite" : "read" };
      if ((await handle.queryPermission(permissionOptions)) === "granted") return true;
      if ((await handle.requestPermission(permissionOptions)) === "granted") return true;
      return false;
    }

    async function resetZeTerOsFromUi(root = documentRef) {
      const scope = root?.querySelector?.("[data-security-reset-scope]")?.value || "settings";
      const scopeLabel = { settings: "только настройки оформления", workspace: "пользовательские данные с сохранением настроек", full: "всё текущее состояние ZeTer OS" }[scope] || scope;
      if (!confirmUser(`Подготовить сброс: ${scopeLabel}? Сначала ZeTer OS создаст проверенный ZIP и аварийную точку. Пока страховка не готова, данные не изменятся.`)) return false;
      try {
        const backup = await exportBackup({ source: "pre-reset" });
        if (!backup) throw new Error("Страховочный ZIP не был сохранён.");
        const safety = await createRestorePoint(null, { name: `Перед сбросом: ${scopeLabel}`, reason: "pre-reset", silent: true });
        if (!safety) throw new Error("Не удалось создать аварийную точку восстановления.");

        if (scope === "full") {
          const phrase = promptUser("Проверенный ZIP и аварийная точка созданы. Для полного сброса введи слово СБРОС:", "");
          if (phrase !== "СБРОС") return toast("Полный сброс отменён", "Контрольное слово не совпало. Страховочные копии сохранены."), false;
        } else if (!confirmUser(`Страховочные копии готовы. Выполнить сброс: ${scopeLabel}?`)) {
          return false;
        }

        addJournalEvent({ type: "reset", tone: "warn", title: "Подготовлен безопасный сброс", detail: scopeLabel });
        if (scope === "settings") {
          const fresh = defaultState();
          getState().settings = cloneForBackup(fresh.settings || {});
          (getState().desktops || []).forEach(desk => {
            if (desk?.data) desk.data.settings = cloneForBackup(fresh.settings || {});
          });
          await saveState({ skipProtectionCheck: true });
        } else if (scope === "workspace") {
          const currentSettings = cloneForBackup(getState().settings || {});
          const currentSecurity = cloneForBackup(securityMeta());
          const fresh = defaultState();
          fresh.settings = currentSettings;
          fresh.security = currentSecurity;
          replaceStateFromRestore(fresh);
          await saveState({ skipProtectionCheck: true });
        } else {
          await clearExternalSaveHandleStorage();
          await resetPrimaryStateStorage();
        }
        toast("Безопасный сброс выполнен", "Аварийная точка сохранена и останется доступна после перезапуска.");
        schedule(reload, 650);
        return true;
      } catch (error) {
        consoleRef.error("[ZeTer OS reset]", error);
        toast("Не удалось сбросить ОС", error?.message || "Попробуй обновить страницу и повторить сброс.");
        return false;
      }
    }

    function securityMeta() {
      const state = getState();
      state.security = normalizeSecurityMeta(state.security);
      return state.security;
    }

    function scheduleProtectionCheck() {
      clearScheduled(protectionCheckTimer);
      protectionCheckTimer = schedule(() => maybeCreateAutomaticRestorePoint(), 2500);
    }

    async function maybeCreateAutomaticRestorePoint() {
      const meta = securityMeta();
      const policy = normalizeProtectionPolicy(meta.protectionPolicy);
      if (!policy.autoRestoreHours) return false;
      const interval = policy.autoRestoreHours * 60 * 60 * 1000;
      if (now() - Number(meta.lastAutoRestorePointAt || 0) < interval) return false;
      const point = await createRestorePoint(null, { name: "Автоматическая защита", reason: "automatic", silent: true });
      return Boolean(point);
    }

    async function setProtectionProfile(profileId) {
      const profile = protectionProfile(profileId);
      securityMeta().protectionPolicy = normalizeProtectionPolicy(profile);
      addJournalEvent({ type: "policy", tone: "ok", title: "Профиль защиты изменён", detail: `${profile.label}: автоматическая точка каждые ${profile.autoRestoreHours || 0} ч.` });
      await saveState({ skipExternalBackup: true, skipProtectionCheck: true });
      scheduleProtectionCheck();
      toast("Профиль защиты применён", profile.label);
      return securityMeta().protectionPolicy;
    }

    async function exportEncryptedBackup() {
      if (!encryptedBackupSupported()) return toast("Шифрование недоступно", "Используй актуальный Edge, Chrome или запуск ZeTer OS через Python."), null;
      const first = promptUser("Придумай парольную фразу не короче 8 символов. Она не сохраняется и не восстанавливается:", "");
      if (first == null) return null;
      const second = promptUser("Повтори парольную фразу:", "");
      if (second == null) return null;
      if (first !== second) return toast("Парольные фразы не совпали", "Зашифрованный бэкап не создан."), null;
      const zipName = backupFileName();
      const zip = await buildBackupForState(getState());
      const verification = zip?.zeterVerification || await verifyBackup(zip);
      if (!verification?.ok || !verification?.verified) throw new Error("Исходный ZIP не прошёл проверку.");
      const encrypted = await encryptBackup(zip, first, { originalName: zipName });
      const fileName = zipName.replace(/\.zip$/i, ".zeterbak");
      const result = await downloadBlob(fileName, encrypted);
      if (result?.cancelled) return null;
      const meta = securityMeta();
      meta.lastEncryptedBackupAt = now();
      addJournalEvent({ type: "encrypted-backup", tone: "ok", title: "Создан зашифрованный бэкап", detail: `${fileName} · ${bytesToHuman(encrypted.size)}` });
      await saveState({ skipExternalBackup: true, skipProtectionCheck: true });
      toast("Зашифрованный бэкап создан", "Парольная фраза нигде не сохранена. Храни её отдельно от файла .zeterbak.");
      return { name: fileName, size: encrypted.size };
    }

    async function runRecoveryTest() {
      try {
        const zip = await buildBackupForState(getState());
        const verification = zip?.zeterVerification || await verifyBackup(zip);
        if (!verification?.ok || !verification?.verified) throw new Error("Временный ZIP не прошёл проверку.");
        validateImportedState(cloneForBackup(verification.state));
        const meta = securityMeta();
        meta.lastRecoveryTestAt = now();
        meta.lastRecoveryTestStatus = "Восстановление проверено в памяти";
        addJournalEvent({ type: "recovery-test", tone: "ok", title: "Тест восстановления пройден", detail: `Проверено файлов: ${verification.manifest?.files?.length || 0} · ${bytesToHuman(zip.size)}` });
        await saveState({ skipExternalBackup: true, skipProtectionCheck: true });
        toast("Восстановление проверено", "ZIP прочитан обратно, манифест, контрольные суммы и структура состояния в порядке. Текущие данные не изменялись.");
        return verification;
      } catch (error) {
        const meta = securityMeta();
        meta.lastRecoveryTestAt = now();
        meta.lastRecoveryTestStatus = error?.message || "Тест не пройден";
        addJournalEvent({ type: "recovery-test", tone: "bad", title: "Тест восстановления не пройден", detail: error?.message || String(error) });
        await saveState({ skipExternalBackup: true, skipProtectionCheck: true });
        toast("Проверка восстановления не пройдена", error?.message || "Не удалось прочитать временный бэкап.");
        return null;
      }
    }

    async function previewImport(incoming, context = {}) {
      const current = stateSummary(getState());
      const next = stateSummary(incoming);
      const changes = compareStateSummaries(current, next);
      const labels = { desktops: "рабочие столы", files: "файлы", folders: "папки", notes: "заметки", tables: "таблицы", images: "изображения", tasks: "задачи", events: "события", notifications: "уведомления" };
      const summary = changes.map(item => `${labels[item.key]}: ${item.current} → ${item.incoming}${item.delta ? ` (${item.delta > 0 ? "+" : ""}${item.delta})` : ""}`).join("\n");
      const verification = context.backupMetadata?.verification;
      const protection = verification?.verified ? "Манифест и контрольные суммы проверены." : "Старая копия без манифеста: структура будет проверена, но происхождение отдельных файлов подтвердить нельзя.";
      const encryption = context.backupMetadata?.encrypted ? " Копия успешно расшифрована." : "";
      const approved = confirmUser(`Предварительная проверка завершена.\n${protection}${encryption}\n\n${summary}\n\nТекущее состояние будет заменено только после создания аварийной точки. Продолжить?`);
      return { approved, current, incoming: next, changes, verification };
    }

    async function verifyAppliedImport() {
      const record = await readPrimaryStateRecord();
      if (!record?.state) return false;
      validateImportedState(cloneForBackup(record.state));
      return true;
    }

    async function recordImportResult(success, details = {}) {
      if (success) securityMeta().lastImportAt = now();
      addJournalEvent({ type: "import", tone: success ? "ok" : (details.rolledBack ? "warn" : "bad"), title: success ? "Импорт проверен и выполнен" : (details.rolledBack ? "Неудачный импорт откачен" : "Ошибка импорта"), detail: String(details.detail || "").slice(0, 800) });
      await saveState({ skipExternalBackup: true, skipProtectionCheck: true, silentStorageError: true });
    }

    async function exportDiagnosticReport() {
      const snapshot = await collectSecuritySnapshot();
      const report = {
        app: "ZeTer OS",
        osVersion,
        createdAt: new Date(now()).toISOString(),
        storageMode: shouldUseNativeStorage() ? "python-data-folder" : (storageRuntime.fallback ? "localStorage-fallback" : "indexeddb-primary"),
        stateBytes: snapshot.stateBytes,
        dataUsageBytes: snapshot.usage,
        quotaBytes: snapshot.quota,
        protection: snapshot.protection,
        integrity: { checkedAt: snapshot.meta.lastIntegrityCheckAt, outcome: snapshot.meta.lastIntegrityOutcome, bad: snapshot.meta.lastIntegrityBad, warn: snapshot.meta.lastIntegrityWarn, status: snapshot.meta.lastIntegrityStatus },
        backups: { verifiedAt: snapshot.meta.lastBackupVerifiedAt, encryptedAt: snapshot.meta.lastEncryptedBackupAt, recoveryTestAt: snapshot.meta.lastRecoveryTestAt, recoveryTestStatus: snapshot.meta.lastRecoveryTestStatus },
        restorePoints: (snapshot.restorePoints || []).map(describeRestorePoint),
        cleanupPreview: snapshot.cleanupPreview,
        journal: snapshot.meta.journal
      };
      const name = `ZeTer_OS_security_report_${new Date(now()).toISOString().slice(0, 10)}.json`;
      await downloadBlob(name, new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" }));
      toast("Диагностический отчёт создан", "В отчёте нет текстов документов, изображений и парольных фраз.");
      return report;
    }

    async function collectExternalSaveSnapshot() {
      return collectExternalSaveSnapshotModel({
        workspace: currentWorkspace(),
        nativeMode: shouldUseNativeStorage(),
        supportsExternalFolderSave,
        externalDirectoryHandle: getExternalDirectoryHandle(),
        nativeStorageCall
      });
    }

    async function collectSecuritySnapshot() {
      return collectSecuritySnapshotModel({
        meta: securityMeta(),
        stateBytes: storedStateSizeBytes(),
        storageRuntime,
        byteSize,
        readSmallSettings,
        readRestorePoints,
        nativeMode: shouldUseNativeStorage(),
        nativeStorageCall,
        getStorageEstimate,
        percent,
        collectExternalSaveSnapshot,
        collectCleanupPreview
      });
    }

    async function runSecurityIntegrityCheck(checkOptions = {}) {
      return runSecurityIntegrityModel({
        state: getState(),
        nativeMode: shouldUseNativeStorage(),
        readPrimaryStateRecord,
        readSmallSettings,
        readLegacyState,
        readRestorePoints,
        collectSecuritySnapshot,
        persist: Boolean(checkOptions.persist),
        persistStatus: (status, checkedAt, outcome, bad, warn) => {
          const meta = securityMeta();
          meta.lastIntegrityCheckAt = checkedAt;
          meta.lastIntegrityStatus = status;
          meta.lastIntegrityOutcome = outcome;
          meta.lastIntegrityBad = bad;
          meta.lastIntegrityWarn = warn;
          addJournalEvent({ type: "integrity", tone: outcome === "bad" ? "bad" : outcome === "warn" ? "warn" : "ok", title: outcome === "ok" ? "Проверка целостности пройдена" : "Проверка целостности нашла замечания", detail: status });
          saveState({ skipExternalBackup: true, skipProtectionCheck: true, silentStorageError: true });
        }
      });
    }

    async function fixSafeSecurityProblems(root = documentRef, winId = "") {
      const before = await runSecurityIntegrityCheck({ persist: false });
      let safety = null;
      if (before.problems?.length) {
        safety = await createRestorePoint(null, { name: "Перед безопасным исправлением", reason: "pre-fix", silent: true });
        if (!safety) return toast("Исправление отменено", "Не удалось создать страховочную точку."), { changed: 0, check: before, before };
      }
      const changed = repairSafeSecurityState(getState(), {
        trashRoot,
        isDesktopRoot,
        desktopRoot: getDesktopRoot(),
        uid,
        todayISO,
        normalizeTaskStore,
        normalizeCalendarStore,
        normalizeNotificationStore
      });

      if (changed) {
        addJournalEvent({ type: "integrity-fix", tone: "ok", title: "Безопасные проблемы исправлены", detail: `Изменено записей: ${changed}. Страховочная точка: ${safety?.name || "создана"}.` });
        await saveState({ skipExternalBackup: true, skipProtectionCheck: true, silentStorageError: true });
        renderAllFileSurfaces();
        toast("Безопасные проблемы исправлены", `Изменено записей: ${changed}`);
      } else {
        toast("Исправление не требуется", "Безопасных автоматических исправлений не найдено.");
      }
      const check = await runSecurityIntegrityCheck({ persist: true });
      const resultBox = root?.querySelector?.("[data-security-check-result]");
      if (resultBox) renderSecurityCheckResult(resultBox, check, changed);
      if (winId) schedule(() => refreshWindow(winId), 700);
      return { changed, check, before };
    }

    function renderSecurityCenterApp(params = {}, winId = "") {
      const nativeMode = shouldUseNativeStorage();
      const app = createSecurityApp({
        document: documentRef,
        nativeMode,
        collectSecuritySnapshot,
        renderOptions: {
          nativeMode,
          formatSecurityTime,
          bytesToHuman,
          restoreLimit,
          storageRuntime,
          browserPersistenceAvailable: Boolean(browserPersistenceAvailable()),
          securityStorageMetersHTML,
          securityKvRowsHTML
        },
        exportBackup,
        exportEncryptedBackup,
        openImport,
        toast,
        createRestorePoint,
        restoreLatestPoint,
        chooseExternalSaveFolder,
        openReadableFolder,
        writeExternalBackup,
        cleanOldData: cleanOldOsBrowserData,
        resetOs: resetZeTerOsFromUi,
        runIntegrityCheck: runSecurityIntegrityCheck,
        fixSafeProblems: root => fixSafeSecurityProblems(root, winId),
        runRecoveryTest,
        restorePointById,
        exportRestorePoint,
        deleteRestorePoint: deleteRestorePointById,
        setProtectionProfile,
        exportDiagnosticReport
      });
      scheduleProtectionCheck();
      return app;
    }

    return Object.freeze({
      scheduleStoragePressureCheck,
      scheduleProtectionCheck,
      maybeCreateAutomaticRestorePoint,
      checkStoragePressure,
      clearLegacyLocalStorageData,
      clearOldIndexedDbData,
      clearOldPwaCaches,
      cleanOldOsBrowserData,
      openRestoreDb,
      readRestorePoints,
      pruneRestorePoints,
      createRestorePoint,
      restoreLatestPoint,
      restorePointById,
      exportRestorePoint,
      deleteRestorePointById,
      resetPrimaryStateStorage,
      clearExternalSaveHandleStorage,
      resetZeTerOsFromUi,
      openExternalDb,
      storeExternalHandle,
      loadExternalHandle,
      verifyExternalPermission,
      securityMeta,
      setProtectionProfile,
      exportEncryptedBackup,
      runRecoveryTest,
      previewImport,
      verifyAppliedImport,
      recordImportResult,
      exportDiagnosticReport,
      collectCleanupPreview,
      collectExternalSaveSnapshot,
      collectSecuritySnapshot,
      runSecurityIntegrityCheck,
      fixSafeSecurityProblems,
      renderSecurityCenterApp
    });
  }

  window.ZETER_SECURITY_UI_UTILS = Object.freeze({
    securityCenterShellHTML,
    securityCenterAction,
    securitySummaryCardHTML,
    securitySummaryCardsHTML,
    securityBannerHTML,
    securityFolderStatusHTML,
    securityBadgeHTML,
    securityProblemHTML,
    securityCheckResultHTML,
    securityCheckIdleHTML,
    renderSecurityCheckResult,
    renderSecuritySnapshot,
    restorePayloadPreflightMessage,
    createSecurityCenterApp,
    createSecurityRuntimeController
  });
})();
