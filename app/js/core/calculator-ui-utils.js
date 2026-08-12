(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS calculator UI utils require core utils.");

  const { escapeHtml } = coreUtils;
  const CALCULATOR_KEYS = Object.freeze(["C", "⌫", "%", "/", "7", "8", "9", "*", "4", "5", "6", "-", "1", "2", "3", "+", "0", ".", "="]);

  function calculatorShellHTML(display = "0") {
    return `<div class="calc-display">${escapeHtml(display || "0")}</div><div class="calc-grid">${CALCULATOR_KEYS.map(value => `<button data-v="${escapeHtml(value)}" class="${value === "=" ? "eq" : ""}" ${value === "=" ? "style='grid-column:span 2'" : ""}>${escapeHtml(value)}</button>`).join("")}</div>`;
  }

  function calculatorButtonValue(target) {
    return target?.closest?.("[data-v]")?.dataset.v || "";
  }

  function calculatorAppElement(calculateNextExpression) {
    const nextExpression = typeof calculateNextExpression === "function"
      ? calculateNextExpression
      : (current => current || "");
    const root = document.createElement("div");
    root.className = "calc";
    root.innerHTML = calculatorShellHTML("0");
    let expression = "";
    root.addEventListener("click", event => {
      const key = calculatorButtonValue(event.target);
      if (!key) return;
      expression = nextExpression(expression, key);
      const display = root.querySelector(".calc-display");
      if (display) display.textContent = expression || "0";
    });
    return root;
  }

  window.ZETER_CALCULATOR_UI_UTILS = Object.freeze({
    CALCULATOR_KEYS,
    calculatorButtonValue,
    calculatorShellHTML,
    calculatorAppElement
  });
})();
