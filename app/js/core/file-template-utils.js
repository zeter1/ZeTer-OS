(() => {
  "use strict";

  function starterContentForExtension(ext = "txt", name = "") {
    const cleanExt = String(ext || "txt").toLowerCase();
    const cleanName = String(name || "");
    if (cleanExt === "html") return `<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="UTF-8">\n  <title>${cleanName.replace(/\.html$/i, "")}</title>\n</head>\n<body>\n  \n</body>\n</html>\n`;
    if (cleanExt === "css") return `/* ${cleanName} */\n\n`;
    if (cleanExt === "js") return `// ${cleanName}\n\n`;
    if (cleanExt === "json") return `{\n  "name": "${cleanName}"\n}\n`;
    if (cleanExt === "md") return `# ${cleanName.replace(/\.md$/i, "")}\n\n`;
    if (cleanExt === "csv") return "Название,Значение\n";
    return "";
  }

  window.ZETER_FILE_TEMPLATE_UTILS = Object.freeze({
    starterContentForExtension
  });
})();
