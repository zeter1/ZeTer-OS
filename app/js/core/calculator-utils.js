(() => {
  "use strict";

  function safeCalculateExpression(input = "") {
    const src = String(input || "").replace(/\s+/g, "");
    if (!src || /[^0-9+\-*/%.()]/.test(src)) throw new Error("bad expression");
    let index = 0;
    const peek = () => src[index];
    const eat = ch => src[index] === ch && (index++, true);
    const parseNumber = () => {
      const start = index;
      while (/[0-9.]/.test(peek() || "")) index++;
      const raw = src.slice(start, index);
      if (!raw || raw.split(".").length > 2) throw new Error("bad number");
      return Number(raw);
    };
    const parseFactor = () => {
      let value;
      if (eat("+")) value = parseFactor();
      else if (eat("-")) value = -parseFactor();
      else if (eat("(")) {
        value = parseExpression();
        if (!eat(")")) throw new Error("missing bracket");
      } else {
        value = parseNumber();
      }
      while (eat("%")) value = value / 100;
      return value;
    };
    const parseTerm = () => {
      let value = parseFactor();
      while (true) {
        if (eat("*")) value *= parseFactor();
        else if (eat("/")) value /= parseFactor();
        else break;
      }
      return value;
    };
    function parseExpression() {
      let value = parseTerm();
      while (true) {
        if (eat("+")) value += parseTerm();
        else if (eat("-")) value -= parseTerm();
        else break;
      }
      return value;
    }
    const result = parseExpression();
    if (index !== src.length || !Number.isFinite(result)) throw new Error("bad result");
    return Number.isInteger(result) ? String(result) : String(Number(result.toFixed(10)));
  }

  function calculateNextExpression(current = "", key = "", options = {}) {
    const errorText = options.errorText || "Ошибка";
    const expr = String(current || "");
    const value = String(key || "");
    if (!value) return expr;
    if (value === "C") return "";
    if (value === "\u232b") return expr.slice(0, -1);
    if (value === "=") {
      try {
        return safeCalculateExpression(expr || "0");
      } catch {
        return errorText;
      }
    }
    return `${expr === errorText ? "" : expr}${value}`;
  }

  window.ZETER_CALCULATOR_UTILS = Object.freeze({
    safeCalculateExpression,
    calculateNextExpression
  });
})();
