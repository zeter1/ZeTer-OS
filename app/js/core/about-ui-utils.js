(() => {
  "use strict";

  const core = window.ZETER_CORE_UTILS;
  const config = window.ZETER_OS_CONFIG;
  if (!core || !config) throw new Error("ZeTer OS About UI requires core utils and config.");
  const { escapeHtml } = core;
  const developer = config.DEVELOPER;
  const CONTACT_LINKS = Object.freeze([
    ["Telegram", "https://t.me/zeter1"],
    ["LinkedIn", "https://www.linkedin.com/in/zeter/"],
    ["Facebook", "https://www.facebook.com/zeter1"],
    ["ВКонтакте", "https://vk.ru/zeter1"],
    ["Instagram", "https://www.instagram.com/zeter1992/"],
    ["TenChat", "https://tenchat.ru/zeter"],
    ["X", "https://x.com/zeter1"],
    ["Threads", "https://www.threads.com/@zeter1992"],
    ["Одноклассники", "https://ok.ru/zeter1"],
    ["Telegram-группа: обо мне, проекты и чат", "https://t.me/zeterchat"]
  ].map(([label, href]) => Object.freeze({ label, href })));

  function linkHTML(label, href) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-about-link><b>${escapeHtml(label)}</b><span>${escapeHtml(href)}</span></a>`;
  }

  function aboutAppHTML() {
    return `
      <section class="setting-card about-intro">
        <span class="about-eyebrow">Личное рабочее пространство</span>
        <div class="about-brand"><img src="assets/icons/zeter-logo.svg" alt="" width="64" height="64" /><h2>ZeTer <span>OS</span></h2></div>
        <p>ZeTer OS — рабочая среда для ваших повседневных дел, проектов и материалов. На отдельных рабочих столах можно собирать документы, заметки, задачи, события календаря, ссылки, промпты и подсчёты — и работать с ними в привычных окнах.</p>
        <p><button type="button" class="about-guide-link" data-about-guide>${escapeHtml(window.ZETER_APP_CATALOG.APP_CATALOG_DEFINITIONS.help.name)}</button> — пошаговые инструкции по работе с файлами, рабочими столами, задачами и другими возможностями системы.</p>
      </section>
      <section class="setting-card about-release">
        <div class="about-release-heading"><h3>Версия и обновления</h3><strong class="about-version">${escapeHtml(config.OS_VERSION)}</strong></div>
        <div class="about-links">
          ${linkHTML("Что нового", "https://github.com/zeter1/ZeTer-OS/blob/main/CHANGELOG.md")}
          ${linkHTML("Обновления системы", "https://github.com/zeter1/ZeTer-OS/releases")}
          ${linkHTML("Репозиторий", "https://github.com/zeter1/ZeTer-OS")}
        </div>
        <small class="muted">Откройте страницу обновлений, чтобы скачать опубликованную сборку. Перед обновлением сохраните ZIP-бэкап в Центре безопасности данных.</small>
        <div class="about-update-panel" data-update-panel><p role="status">Проверка обновлений…</p><div class="about-update-actions"><button type="button" data-update-check>Проверить обновления</button></div></div>
      </section>
      <section class="setting-card about-launch">
        <h3>Как запустить ZeTer OS</h3>
        <p class="muted">Выберите удобный вариант: откройте сайт, скачайте готовое приложение или запустите исходники через Python.</p>
        <div class="about-launch-grid">
          <article class="about-launch-card">
            <h4>В браузере</h4>
            <p>Без установки EXE и Python.</p>
            <ol>
              <li>Откройте веб-версию по ссылке ниже.</li>
              <li>Работайте в одном и том же профиле браузера: здесь сохраняются ваши материалы.</li>
            </ol>
            <p class="muted">Некоторые функции Windows и операции с локальными документами доступны только в настольной версии.</p>
            <div class="about-links">${linkHTML("Открыть веб-версию", "https://dkl.do.am/zeteros/index.html")}</div>
          </article>
          <article class="about-launch-card">
            <h4>Приложение .exe</h4>
            <p>Готовая сборка для Windows x64. Python не нужен.</p>
            <ol>
              <li>Откройте Releases и в разделе Assets скачайте <code>ZeTer-OS-&lt;версия&gt;-Windows-x64.zip</code>.</li>
              <li>Распакуйте весь ZIP в отдельную папку.</li>
              <li>Запустите <code>ZeTer-OS.exe</code> из распакованной папки.</li>
            </ol>
            <p class="muted">Не переносите EXE отдельно от остальных файлов. Для окна приложения нужен Microsoft Edge WebView2 Runtime.</p>
            <div class="about-links">
              ${linkHTML("Скачать Windows-версию", "https://github.com/zeter1/ZeTer-OS/releases")}
              ${linkHTML("Установить WebView2 Runtime", "https://developer.microsoft.com/microsoft-edge/webview2/")}
            </div>
          </article>
          <article class="about-launch-card">
            <h4>Из Python</h4>
            <p>Для работы с исходниками на Windows.</p>
            <ol>
              <li>Установите Python 3.10 или новее с сайта python.org и Microsoft Edge WebView2 Runtime.</li>
              <li>На GitHub выберите Code → Download ZIP и распакуйте архив.</li>
              <li>Откройте папку с <code>run_zeter_os.py</code> и запустите <code>start_zeter_os.cmd</code>.</li>
            </ol>
            <p>Или откройте терминал в этой папке и выполните по очереди:</p>
            <pre><code>py -3 -m pip install -r requirements.txt
py -3 run_zeter_os.py</code></pre>
            <div class="about-links">${linkHTML("Исходники и инструкция", "https://github.com/zeter1/ZeTer-OS/blob/main/README_PYTHON.md")}</div>
          </article>
        </div>
        <p class="muted about-launch-storage">В браузере данные хранятся в его профиле, в EXE и Python — в папке <code>data/</code> рядом с программой. Автоматической синхронизации между вариантами нет. Перед переходом сохраните ZIP-бэкап в Центре безопасности данных; для переноса используйте восстановление из него. Не очищайте данные сайта без резервной копии.</p>
      </section>
      <section class="setting-card about-developer">
        <h3>Разработчик</h3>
        <div class="developer-profile"><span class="developer-avatar" aria-hidden="true">ДК</span><div><b>${escapeHtml(developer.name)}</b><small>Автор и разработчик ZeTer OS</small></div></div>
        <div class="developer-contact"><span>Электронная почта</span><b>${escapeHtml(developer.email)}</b></div>
        <div class="about-links about-contacts">${CONTACT_LINKS.map(link => linkHTML(link.label, link.href)).join("")}</div>
      </section>`;
  }

  function aboutAppElement({ documentRef = document, getSelection = () => window.getSelection(), showContext = () => {}, copyText = async () => false, openExternalLink = async () => false, openApp = () => {}, toast = () => {} } = {}) {
    const root = documentRef.createElement("div");
    root.className = "about-app";
    root.innerHTML = aboutAppHTML();
    root.addEventListener("click", event => {
      const guide = event.target.closest?.("[data-about-guide]");
      if (guide && root.contains(guide)) {
        event.preventDefault();
        openApp("help");
        return;
      }
      const link = event.target.closest?.("[data-about-link]");
      if (!link || !root.contains(link)) return;
      event.preventDefault();
      void openExternalLink(link.getAttribute("href"), link.querySelector("b")?.textContent || "");
    });
    root.addEventListener("contextmenu", event => {
      event.preventDefault();
      event.stopPropagation();
      const selection = getSelection();
      if (!selection || selection.isCollapsed || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return;
      const text = selection.toString();
      if (!text) return;
      showContext(event.clientX, event.clientY, [["📋", "Копировать", async () => {
        const copied = await copyText(text);
        toast(copied ? "Текст скопирован" : "Не удалось скопировать", copied ? "Выделенный текст в буфере обмена." : "Выделите текст и нажмите Ctrl+C.");
      }]]);
    });
    return root;
  }

  window.ZETER_ABOUT_UI_UTILS = Object.freeze({ aboutAppHTML, aboutAppElement });
})();
