(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const visualUtils = window.ZETER_VISUAL_UTILS;
  if (!coreUtils || !visualUtils) throw new Error("ZeTer OS desktop profile utils require core and visual utils.");

  const { escapeHtml } = coreUtils;
  const { normalizeDesktopIcon, defaultDesktopDescription } = visualUtils;

  function desktopRecordById(desktops = [], id) {
    return Array.isArray(desktops) ? desktops.find(desk => desk?.id === id) || null : null;
  }

  function desktopName(desktops = [], id) {
    const desk = desktopRecordById(desktops, id);
    return String(desk?.name || "").trim() || "Рабочий стол";
  }

  function desktopDescription(desktops = [], id) {
    const desk = desktopRecordById(desktops, id);
    return typeof desk?.description === "string" ? desk.description : defaultDesktopDescription(id);
  }

  function desktopIconData(desktops = [], id) {
    const desk = desktopRecordById(desktops, id);
    return normalizeDesktopIcon(desk?.icon);
  }

  function desktopAvatarHTML(desktops = [], id, active = false) {
    const icon = desktopIconData(desktops, id);
    if (icon?.dataURL) {
      return `<span class="workspace-avatar has-image"><img src="${escapeHtml(icon.dataURL)}" alt=""></span>`;
    }
    return `<span class="workspace-avatar"><span>${active ? "🟣" : "🖥️"}</span></span>`;
  }

  window.ZETER_DESKTOP_PROFILE_UTILS = Object.freeze({
    desktopRecordById,
    desktopName,
    desktopDescription,
    desktopIconData,
    desktopAvatarHTML
  });
})();
