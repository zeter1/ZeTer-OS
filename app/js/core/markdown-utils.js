(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS markdown utils require core utils.");

  const { escapeHtml } = coreUtils;

  function markdown(text = "") {
    return escapeHtml(text).split("\n").map(line => {
      if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith("- [x] ")) return `<p>✅ ${line.slice(6)}</p>`;
      if (line.startsWith("- [ ] ")) return `<p>⬜ ${line.slice(6)}</p>`;
      if (line.startsWith("- ")) return `<p>• ${line.slice(2)}</p>`;
      return line ? `<p>${line}</p>` : `<br>`;
    }).join("");
  }

  window.ZETER_MARKDOWN_UTILS = Object.freeze({
    markdown
  });
})();
