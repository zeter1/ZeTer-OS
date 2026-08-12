(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS first-run UI utils require core utils.");

  const { escapeHtml } = coreUtils;

  function firstRunScreenHTML(osVersion = "") {
    return `
      <div class="first-run-card glass">
        <img src="assets/icons/zeter-logo.svg" alt="">
        <h2>Добро пожаловать в ZeTer OS ${escapeHtml(osVersion)}</h2>
        <p class="muted">Создай рабочее пространство, импортируй бэкап или познакомься с возможностями системы.</p>
        <div class="choice-row">
          <button data-first-create>Создать рабочее пространство</button>
          <button data-first-import>Импортировать бэкап</button>
          <button data-first-help>Посмотреть возможности</button>
        </div>
      </div>`;
  }

  window.ZETER_FIRST_RUN_UI_UTILS = Object.freeze({
    firstRunScreenHTML
  });
})();
