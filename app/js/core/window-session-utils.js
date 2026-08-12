(() => {
  "use strict";

  const config = window.ZETER_OS_CONFIG;
  if (!config) throw new Error("ZeTer OS window session utils require config.");

  const { OPEN_WINDOWS_MAX } = config;

  function serializableParams(params = {}) {
    try {
      return JSON.parse(JSON.stringify(params || {}));
    } catch {
      return {};
    }
  }

  function normalizeWindowSession(session = {}) {
    return {
      appId: session.appId,
      params: serializableParams(session.params || {}),
      rect: session.rect || null,
      minimized: Boolean(session.minimized),
      maximized: Boolean(session.maximized)
    };
  }

  function normalizeWindowSessionList(sessions = [], appRegistry = {}, maxWindows = OPEN_WINDOWS_MAX) {
    if (!Array.isArray(sessions)) return [];
    const limit = Math.max(0, Math.min(Number(maxWindows) || OPEN_WINDOWS_MAX, OPEN_WINDOWS_MAX));
    return sessions
      .filter(session => session && session.appId && appRegistry[session.appId])
      .slice(0, limit)
      .map(normalizeWindowSession);
  }

  function collectWindowSessionsFromRuntime(records, desktopId) {
    const sessions = [];
    records.forEach(rec => {
      if (rec.desktopId !== desktopId) return;
      const el = rec.el;
      sessions.push(normalizeWindowSession({
        appId: rec.appId,
        params: rec.params || {},
        minimized: el.classList.contains("minimized"),
        maximized: el.classList.contains("maximized"),
        rect: {
          left: el.style.left,
          top: el.style.top,
          width: el.style.width,
          height: el.style.height
        }
      }));
    });
    return sessions;
  }

  window.ZETER_WINDOW_SESSION_UTILS = Object.freeze({
    serializableParams,
    normalizeWindowSession,
    normalizeWindowSessionList,
    collectWindowSessionsFromRuntime
  });
})();
