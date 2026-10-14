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
        <h2>ZeTer OS</h2>
        <p>ZeTer OS — рабочая среда для ваших повседневных дел, проектов и материалов. На отдельных рабочих столах можно собирать документы, заметки, задачи, события календаря, ссылки, промпты и подсчёты — и работать с ними в привычных окнах.</p>
        <p class="muted">Изменения сохраняются автоматически. Центр безопасности данных помогает создавать резервные копии и восстанавливать рабочее пространство. ZeTer OS работает как приложение для Windows и в браузере.</p>
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
      <section class="setting-card about-developer">
        <h3>Разработчик</h3>
        <div class="developer-profile"><span class="developer-avatar" aria-hidden="true">ДК</span><div><b>${escapeHtml(developer.name)}</b><small>Автор и разработчик ZeTer OS</small></div></div>
        <div class="developer-contact"><span>Электронная почта</span><b>${escapeHtml(developer.email)}</b></div>
        <div class="about-links about-contacts">${CONTACT_LINKS.map(link => linkHTML(link.label, link.href)).join("")}</div>
      </section>`;
  }

  function aboutAppElement({ documentRef = document, getSelection = () => window.getSelection(), showContext = () => {}, copyText = async () => false, openExternalLink = async () => false, toast = () => {} } = {}) {
    const root = documentRef.createElement("div");
    root.className = "about-app";
    root.innerHTML = aboutAppHTML();
    root.addEventListener("click", event => {
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
