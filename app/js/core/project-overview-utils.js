(() => {
  "use strict";
  const { timeInRange, localRanges, isTimeEntryDeleted } = window.ZETER_TIME_TRACKING_UTILS;
  const PROJECT_ATTACHMENT_LIMIT = 200;

  function normalizeProjectAttachments(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : []).slice(0, PROJECT_ATTACHMENT_LIMIT).filter(ref => {
      if (!ref || !["fs", "event"].includes(ref.kind) || typeof ref.id !== "string" || !/^[A-Za-z0-9_-]{1,220}$/.test(ref.id)) return false;
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(ref => ({ kind: ref.kind, id: ref.id }));
  }

  function validProjectDue(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number), date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  function buildProjectOverview({ project = {}, tasks = [], workspace = {}, now = Date.now(), needsRecovery = false, categoryId = "all" } = {}) {
    const date = new Date(now), pad = n => String(n).padStart(2, "0");
    const today = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const weekDueEnd = new Date(date); weekDueEnd.setDate(weekDueEnd.getDate() + 6);
    const lastDueDay = `${weekDueEnd.getFullYear()}-${pad(weekDueEnd.getMonth() + 1)}-${pad(weekDueEnd.getDate())}`;
    const selected = tasks.filter(task => task.projectId === project.id && (categoryId === "all" || (categoryId === "none" ? !task.categoryId : task.categoryId === categoryId)));
    const pending = selected.filter(task => task.status !== "done");
    const due = task => !task.indefinite && validProjectDue(task.due) ? task.due : "9999-12-31";
    const priority = task => ({ high: 0, medium: 1, low: 2 })[task.priority] ?? 1;
    pending.sort((a, b) => due(a).localeCompare(due(b)) || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || priority(a) - priority(b) || String(a.title || "").localeCompare(String(b.title || ""), "ru"));
    const done = selected.length - pending.length;
    const tracking = workspace.timeTracking || {}, week = localRanges(now);
    const entries = (tracking.entries || []).filter(entry => entry.projectId === project.id && !isTimeEntryDeleted(entry));
    if (tracking.active?.projectId === project.id) {
      entries.push(needsRecovery ? { ...tracking.active, runningSince: null } : tracking.active);
    }
    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const start = new Date(week.weekStart); start.setDate(start.getDate() + index);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      return { date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, label: start.toLocaleDateString("ru-RU", { weekday: "short" }), isToday: +start === week.dayStart, ms: entries.reduce((sum, entry) => sum + timeInRange(entry, +start, Math.min(+end, now), now), 0) };
    });
    return {
      today, todayCount: pending.filter(task => due(task) === today).length,
      weekDueCount: pending.filter(task => due(task) >= today && due(task) <= lastDueDay).length,
      undatedCount: pending.filter(task => due(task) === "9999-12-31").length,
      highPriorityCount: pending.filter(task => task.priority === "high").length,
      stages: [["todo", "Нужно сделать"], ["doing", "В работе"], ["review", "На проверке"], ["done", "Готово"]].map(([id, name]) => ({ id, name, count: selected.filter(task => task.status === id).length })),
      weekDays,
      total: selected.length, done, progress: selected.length ? Math.round(done / selected.length * 100) : 0,
      overdue: pending.filter(task => due(task) < today).length,
      nextDue: pending.length && due(pending[0]) !== "9999-12-31" ? due(pending[0]) : "",
      pending, attachments: normalizeProjectAttachments(project.attachments),
      totalMs: entries.reduce((sum, entry) => sum + timeInRange(entry, 0, now, now), 0),
      weekMs: entries.reduce((sum, entry) => sum + timeInRange(entry, week.weekStart, Math.min(week.weekEnd, now), now), 0)
    };
  }

  window.ZETER_PROJECT_OVERVIEW_UTILS = Object.freeze({ PROJECT_ATTACHMENT_LIMIT, normalizeProjectAttachments, validProjectDue, buildProjectOverview });
})();
