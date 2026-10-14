(() => {
  "use strict";
  const { escapeHtml } = window.ZETER_CORE_UTILS;
  const BUSY_PHASES = new Set(["checking", "downloading", "preparing", "installing", "awaiting_exit"]);

  function updatePanelHTML(status = {}) {
    const busy = BUSY_PHASES.has(status.phase);
    const progress = Math.max(0, Math.min(100, Number(status.progress) || 0));
    const message = status.error || status.message || (status.supported ? "Проверка новых версий выполняется автоматически." : "Установка обновлений доступна в Windows-сборке ZeTer OS.");
    return `<p data-update-message role="status">${escapeHtml(message)}</p>
      ${status.supported && (status.available || ["downloading", "preparing", "ready", "installing", "awaiting_exit"].includes(status.phase)) ? `<p class="update-restart-notice"><strong>ZeTer OS перезапустится автоматически.</strong> Во время установки окно закроется, затем программа запустится сама. Дождитесь её открытия. Не запускайте программу вручную.</p>` : ""}
      ${status.phase === "downloading" ? `<progress max="100" value="${progress}" aria-label="Загрузка обновления"></progress>` : ""}
      <div class="about-update-actions"><button type="button" data-update-check${busy || !status.supported ? " disabled" : ""}>Проверить обновления</button>
      ${status.available && status.supported ? `<button type="button" data-update-install${busy ? " disabled" : ""}>Обновить до ${escapeHtml(status.version || "новой версии")}</button>` : ""}
      <button type="button" data-update-news>Что нового</button><button type="button" data-update-manual>Обновить вручную</button>
      ${status.phase === "downloading" ? `<button type="button" data-update-cancel>Отмена</button>` : ""}</div>`;
  }

  function manualUpdateHTML() {
    return `<section class="setting-card manual-update-intro"><h2>Обновить ZeTer OS вручную</h2><p>Скачайте полную новую сборку и перенесите в неё свои данные. Старая папка программы и резервная копия помогут вернуться к прежней версии, если возникнет проблема.</p><div class="about-update-actions"><button type="button" data-manual-update-link="releases">Скачать Windows-сборку</button><button type="button" data-manual-update-link="repository">Репозиторий ZeTer OS</button><button type="button" data-update-news>Что нового</button></div></section>
      <section class="setting-card"><h3>Пошаговое обновление Windows-сборки</h3><ol class="manual-update-steps">
        <li><b>Сохраните резервную копию.</b><p>В текущей ZeTer OS откройте «Центр безопасности данных» и создайте ZIP-бэкап. Сохраните его вне папки программы, например в «Документы». Дождитесь подтверждения сохранения.</p></li>
        <li><b>Скачайте готовую сборку.</b><p>Откройте GitHub Releases по кнопке выше. Выберите нужную более новую версию и скачайте из её Assets полный архив <code>ZeTer-OS-&lt;версия&gt;-Windows-x64.zip</code>. Не выбирайте «Source code (zip)» или «Source code (tar.gz)»: это код проекта, которому нужен Python. Не скачивайте только отдельный EXE — для запуска нужны все файлы сборки.</p></li>
        <li><b>Закройте старую ZeTer OS.</b><p>Завершите работу, дождитесь сохранения и закройте окно программы. Копирование данных и ручную замену выполняйте после закрытия.</p></li>
        <li><b>Распакуйте архив в новую пустую папку.</b><p>Например, создайте отдельную папку «ZeTer OS новая» рядом со старой и полностью распакуйте туда скачанный ZIP. Не заменяйте старую папку и не смешивайте файлы двух версий. Найдите в новой папке <code>ZeTer-OS.exe</code>.</p></li>
        <li><b>Скопируйте свои данные.</b><p>В старой папке рядом с EXE (или <code>run_zeter_os.py</code>, если использовали Python) найдите папку <code>data</code>. Скопируйте её целиком в новую папку рядом с <code>ZeTer-OS.exe</code>. Копируйте, а не перемещайте: исходная папка должна остаться для возврата. Если новая папка уже содержит ваши данные, не объединяйте и не перезаписывайте их — сначала сохраните обе копии и выберите другую пустую папку.</p></li>
        <li><b>Запустите и проверьте новую версию.</b><p>Откройте новый <code>ZeTer-OS.exe</code>. В «О ZeTer OS» проверьте номер версии, затем рабочие столы, документы, задачи и вложения. После проверки используйте ярлык на новую папку. Если был включён автозапуск Windows, включите его заново в настройках новой версии, чтобы обновить путь.</p></li>
      </ol></section>
      <section class="setting-card"><h3>Если вы работали в браузере</h3><p>В браузерной ZeTer OS нет папки <code>data</code> рядом с EXE. Создайте ZIP-бэкап через «Центр безопасности данных», запустите новую Windows-сборку и импортируйте этот бэкап через её «Центр безопасности данных». Сначала сохраните копию уже существующих данных новой сборки, если они есть.</p></section>
      <section class="setting-card"><h3>Если новая версия не запустилась</h3><p>Закройте новую сборку и запустите программу из сохранённой старой папки. Не удаляйте старую папку и ZIP-бэкап до проверки новой версии. Не переносите <code>data</code> из новой версии обратно в старую: формат мог измениться. Для восстановления используйте совместимую версию и проверенный бэкап.</p><p class="muted"><a href="https://github.com/zeter1/ZeTer-OS" target="_blank" rel="noopener noreferrer" data-manual-update-link="repository">Страница репозитория</a> содержит описание проекта и инструкции. Готовые Windows-сборки скачиваются в разделе <a href="https://github.com/zeter1/ZeTer-OS/releases" target="_blank" rel="noopener noreferrer" data-manual-update-link="releases">Releases</a>. Прямая ссылка на Releases: <a href="https://github.com/zeter1/ZeTer-OS/releases" target="_blank" rel="noopener noreferrer" data-manual-update-link="releases">https://github.com/zeter1/ZeTer-OS/releases</a></p></section>`;
  }

  function manualUpdateElement({ documentRef = document, getSelection = () => window.getSelection(), showContext = () => {}, copyText = async () => false, toast = () => {}, openExternalLink = async () => false } = {}) {
    const root = documentRef.createElement("div");
    root.className = "about-app manual-update-app";
    root.innerHTML = manualUpdateHTML();
    let pendingCopyText = "";
    function localSelection() {
      const selection = getSelection();
      return selection && !selection.isCollapsed && root.contains(selection.anchorNode) && root.contains(selection.focusNode) ? selection : null;
    }
    function showCopyMenu(event, text) {
      event.preventDefault();
      event.stopPropagation();
      showContext(event.clientX, event.clientY, [["📋", "Копировать", async () => {
        const copied = await copyText(text);
        toast(copied ? "Текст скопирован" : "Не удалось скопировать", copied ? "Выделенный текст в буфере обмена." : "Выделите текст и нажмите Ctrl+C.");
      }]]);
    }
    root.addEventListener("pointerdown", event => {
      pendingCopyText = "";
      if (event.button !== 0 || event.target.closest?.("button")) return;
      const selection = localSelection();
      if (!selection) return;
      const onSelection = Array.from(selection.getRangeAt(0).getClientRects()).some(rect =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
      if (!onSelection) return;
      pendingCopyText = selection.toString();
      if (pendingCopyText) event.preventDefault();
    });
    root.addEventListener("click", event => {
      const text = pendingCopyText;
      pendingCopyText = "";
      if (text) { showCopyMenu(event, text); return; }
      const button = event.target.closest?.("[data-manual-update-link]");
      if (!button || !root.contains(button)) return;
      const links = { releases: "https://github.com/zeter1/ZeTer-OS/releases", repository: "https://github.com/zeter1/ZeTer-OS" };
      const href = links[button.dataset.manualUpdateLink];
      if (!href) return;
      event.preventDefault();
      void openExternalLink(href);
    });
    root.addEventListener("contextmenu", event => {
      const text = localSelection()?.toString();
      if (text) showCopyMenu(event, text);
    });
    return root;
  }

  function createUpdateController(options = {}) {
    const documentRef = options.documentRef || document;
    const windowRef = options.windowRef || window;
    const callNative = options.callNative || (async () => ({}));
    const notifyAvailable = options.notifyAvailable || (() => {});
    const saveBeforeInstall = options.saveBeforeInstall || (async () => {});
    const setLocked = options.setLocked || (() => {});
    const openExternalLink = options.openExternalLink || (async () => false);
    const openManualUpdate = options.openManualUpdate || (() => {});
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;
    const pollMs = options.pollMs || 6 * 60 * 60 * 1000;
    let status = { supported: Boolean(options.native), phase: "idle", available: false };
    let busy = false, stopped = false, started = false, cancelRequested = false, mutationsLocked = false;
    let checkPromise = null, timer = null, progressTimer = null, offer = null;
    let dismissedVersion = "";
    let progressGeneration = 0;

    function render(scope = documentRef) {
      scope.querySelectorAll?.("[data-update-panel]").forEach(panel => { panel.innerHTML = updatePanelHTML(status); });
      documentRef.querySelectorAll?.("[data-update-install]").forEach(button => { button.disabled = busy || !status.supported || !status.available || BUSY_PHASES.has(status.phase); });
      const anchor = documentRef.querySelector?.('[data-top-action="about"]');
      if (anchor) {
        anchor.classList.toggle("has-app-update", Boolean(status.available));
        anchor.title = status.available ? `Доступна ZeTer OS ${status.version}` : "О ZeTer OS";
      }
      if (offer) {
        offer.querySelector("[data-update-offer-body]").innerHTML = updatePanelHTML(status);
        offer.querySelector("[data-update-later]").disabled = busy;
        positionOffer();
      }
      if (mutationsLocked) {
        documentRef.querySelectorAll?.("[data-update-check],[data-update-install],[data-update-news],[data-update-manual],[data-update-later],[data-update-cancel]").forEach(button => { button.disabled = true; });
      }
    }

    function positionOffer() {
      if (!offer) return;
      const anchor = documentRef.querySelector?.('[data-top-action="about"]');
      const rect = anchor?.getBoundingClientRect();
      const width = Math.min(390, Math.max(240, windowRef.innerWidth - 24));
      const left = Math.max(12, Math.min((rect?.right || windowRef.innerWidth - 12) - width, windowRef.innerWidth - width - 12));
      offer.style.width = `${width}px`;
      offer.style.left = `${left}px`;
      offer.style.top = `${Math.max(12, (rect?.bottom || 56) + 10)}px`;
    }

    function hideOffer() {
      offer?.remove();
      offer = null;
    }

    function showOffer() {
      if (!status.available || !status.supported || stopped) return false;
      if (!offer) {
        offer = documentRef.createElement("aside");
        offer.className = "app-update-offer glass";
        offer.setAttribute("aria-label", "Обновление ZeTer OS");
        offer.innerHTML = `<div class="app-update-offer-heading"><b>Доступна новая ZeTer OS</b><button type="button" data-update-later aria-label="Напомнить позже">Позже</button></div><div data-update-offer-body></div>`;
        documentRef.body.appendChild(offer);
      }
      render();
      return true;
    }

    function applyStatus(next = {}) {
      status = { ...status, ...next };
      render();
      return status;
    }

    async function check(manual = false) {
      if (!status.supported || stopped || busy) return status;
      if (checkPromise) return checkPromise;
      checkPromise = (async () => {
        applyStatus({ phase: "checking", error: "", message: "Проверяем наличие обновлений…" });
        try {
          const next = await callNative("check_app_updates");
          if (stopped) return status;
          applyStatus(next);
          if (status.available) {
            await notifyAvailable(status);
            if (manual || dismissedVersion !== status.version) showOffer();
          } else hideOffer();
        } catch (error) {
          // The native envelope preserves server cooldown in cached status even when callNative throws.
          try { applyStatus(await callNative("get_app_update_status")); } catch {}
          applyStatus({ phase: "error", error: String(error?.message || "Не удалось проверить обновления.").slice(0, 500) });
        }
        return status;
      })();
      try { return await checkPromise; } finally { checkPromise = null; }
    }

    function scheduleCheck() {
      if (stopped || !status.supported) return;
      timer = setTimer(async () => {
        timer = null;
        await check();
        scheduleCheck();
      }, Math.max(pollMs, (Number(status.retryAfterSeconds) || 0) * 1000));
    }

    function pollProgress(generation = progressGeneration) {
      progressTimer = setTimer(async () => {
        progressTimer = null;
        if (!busy || stopped || generation !== progressGeneration || status.phase !== "downloading") return;
        try {
          const next = await callNative("get_app_update_status");
          if (busy && !stopped && generation === progressGeneration && status.phase === "downloading") applyStatus(next);
        } catch {}
        if (busy && !stopped && generation === progressGeneration && status.phase === "downloading") pollProgress(generation);
      }, 1000);
    }

    async function install() {
      if (busy || stopped || mutationsLocked || status.phase === "awaiting_exit" || !status.supported || !status.available) return false;
      busy = true;
      cancelRequested = false;
      let locked = false, closing = false;
      try {
        applyStatus({ phase: "downloading", error: "", message: "Скачиваем и проверяем обновление…", progress: 0 });
        showOffer();
        progressGeneration += 1;
        pollProgress();
        const prepared = await callNative("prepare_app_update");
        progressGeneration += 1;
        if (stopped) return false;
        applyStatus(prepared);
        if (cancelRequested || status.phase !== "ready") return false;
        if (progressTimer !== null) { clearTimer(progressTimer); progressTimer = null; }
        locked = true;
        mutationsLocked = true;
        setLocked(true);
        applyStatus({ phase: "installing", message: "Сохраняем работу. Затем ZeTer OS закроется, установит обновление и запустится сама…" });
        await saveBeforeInstall();
        const armed = await callNative("install_app_update");
        if (armed.phase !== "awaiting_exit") throw new Error("Процесс обновления не подтвердил готовность. ZeTer OS остаётся открытой.");
        applyStatus(armed);
        await callNative("close_app");
        closing = true;
        return true;
      } catch (error) {
        // A save/arming/close failure must leave the current app usable and cancel only its own updater.
        try { await callNative("cancel_app_update"); } catch {}
        applyStatus({ phase: "error", error: String(error?.message || "Не удалось установить обновление.").slice(0, 500) });
        return false;
      } finally {
        progressGeneration += 1;
        busy = false;
        if (progressTimer !== null) { clearTimer(progressTimer); progressTimer = null; }
        if (locked && !closing) { mutationsLocked = false; setLocked(false); }
        render();
      }
    }

    async function cancel() {
      if (status.phase !== "downloading") return;
      cancelRequested = true;
      try { applyStatus(await callNative("cancel_app_update")); }
      catch (error) { applyStatus({ error: String(error?.message || "Не удалось отменить загрузку.").slice(0, 500) }); }
    }

    function click(event) {
      const target = event.target;
      const button = target?.closest?.("[data-update-check],[data-update-install],[data-update-cancel],[data-update-later],[data-update-news],[data-update-manual]");
      if (!button || button.disabled || mutationsLocked) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.hasAttribute("data-update-check")) void check(true);
      else if (button.hasAttribute("data-update-install")) void install();
      else if (button.hasAttribute("data-update-cancel")) void cancel();
      else if (button.hasAttribute("data-update-news")) void openExternalLink("https://github.com/zeter1/ZeTer-OS/blob/main/CHANGELOG.md");
      else if (button.hasAttribute("data-update-manual")) { hideOffer(); openManualUpdate(); }
      else { dismissedVersion = status.version; hideOffer(); }
    }

    async function start() {
      if (started || stopped) return;
      started = true;
      documentRef.addEventListener("click", click, true);
      windowRef.addEventListener?.("resize", positionOffer);
      windowRef.addEventListener?.("pagehide", stop, { once: true });
      if (!status.supported) { render(); return; }
      try { applyStatus(await callNative("get_app_update_status")); }
      catch (error) { applyStatus({ supported: false, phase: "error", error: String(error?.message || "Обновления недоступны.").slice(0, 500) }); }
      if (status.supported) { await check(); scheduleCheck(); }
    }

    function stop() {
      stopped = true;
      progressGeneration += 1;
      if (timer !== null) clearTimer(timer);
      if (progressTimer !== null) clearTimer(progressTimer);
      documentRef.removeEventListener("click", click, true);
      windowRef.removeEventListener?.("resize", positionOffer);
      hideOffer();
    }

    return Object.freeze({ start, stop, check, install, cancel, showOffer, render, getStatus: () => ({ ...status }), isBusy: () => busy });
  }
  window.ZETER_UPDATE_UI_UTILS = Object.freeze({ updatePanelHTML, manualUpdateHTML, manualUpdateElement, createUpdateController });
})();
