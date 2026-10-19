(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS desktop layout utils require core utils.");

  const { clamp } = coreUtils;

  const DESKTOP_ICON_WIDTH = 80;
  const DESKTOP_ICON_HEIGHT = 82;
  const DESKTOP_ICON_GAP = 4;
  const DESKTOP_FORBIDDEN_GAP = 8;
  const DESKTOP_POSITION_NUDGE_GAP = 10;
  const DESKTOP_ICON_STEP = 84;
  const DESKTOP_MARGIN_X = 24;
  const DESKTOP_MARGIN_Y = 18;
  const DESKTOP_CLIENT_OFFSET_X = 40;
  const DESKTOP_CLIENT_OFFSET_Y = 40;
  const FOLDER_ITEM_WIDTH = 150;
  const FOLDER_ITEM_HEIGHT = 138;
  const FOLDER_ITEM_GAP = 8;
  const FOLDER_MARGIN = 24;
  const FOLDER_STEP_X = FOLDER_ITEM_WIDTH + 12;
  const FOLDER_STEP_Y = FOLDER_ITEM_HEIGHT + 10;
  const FOLDER_POINTER_OFFSET_X = 72;
  const FOLDER_POINTER_OFFSET_Y = 54;

  function desktopIconRect(x, y) {
    return { x, y, w: DESKTOP_ICON_WIDTH, h: DESKTOP_ICON_HEIGHT };
  }

  function rectsOverlap(a, b, gap = DESKTOP_ICON_GAP) {
    return !(
      a.x + a.w + gap <= b.x ||
      b.x + b.w + gap <= a.x ||
      a.y + a.h + gap <= b.y ||
      b.y + b.h + gap <= a.y
    );
  }

  // Use rendered dimensions: long labels and large icons can exceed nominal cells.
  // Grow downwards when full instead of returning an occupied position.
  function resolveIconPosition(rect, occupied = [], { width = 980, gap = DESKTOP_ICON_GAP } = {}) {
    const maxX = Math.max(0, width - rect.w - gap);
    const preferred = { x: clamp(rect.x || 0, 0, maxX), y: Math.max(0, rect.y || 0) };
    const free = p => !occupied.some(other => rectsOverlap({ ...rect, ...p }, other, gap));
    if (free(preferred)) return preferred;
    const xs = [...new Set([preferred.x, gap, ...occupied.map(other => other.x + other.w + gap)])]
      .filter(x => x >= 0 && x <= maxX);
    const ys = [...new Set([preferred.y, gap, ...occupied.map(other => other.y + other.h + gap)])]
      .filter(y => y >= 0).sort((a, b) => a - b);
    for (const y of ys) for (const x of xs) if (free({ x, y })) return { x, y };
    return { x: 0, y: Math.max(0, ...occupied.map(other => other.y + other.h + gap)) };
  }

  function desktopMaxPosition(viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
    return {
      maxX: Math.max(0, viewportWidth - DESKTOP_ICON_WIDTH),
      maxY: Math.max(0, viewportHeight - DESKTOP_ICON_HEIGHT)
    };
  }

  function overlapsForbiddenDesktopArea(x, y, forbiddenRects = [], gap = DESKTOP_FORBIDDEN_GAP) {
    const rect = desktopIconRect(x, y);
    return forbiddenRects.some(bad => rectsOverlap(rect, bad, gap));
  }

  function clampDesktopPosition(x, y, options = {}) {
    const forbiddenRects = Array.isArray(options.forbiddenRects) ? options.forbiddenRects : [];
    const { maxX, maxY } = desktopMaxPosition(options.viewportWidth, options.viewportHeight);
    let nx = clamp(Number.isFinite(x) ? x : DESKTOP_MARGIN_X, 0, maxX);
    let ny = clamp(Number.isFinite(y) ? y : DESKTOP_MARGIN_X, 0, maxY);

    if (!overlapsForbiddenDesktopArea(nx, ny, forbiddenRects)) return { x: nx, y: ny };

    const start = { x: nx, y: ny };
    const candidates = [{ x: nx, y: ny }];
    const icon = desktopIconRect(0, 0);

    for (const bad of forbiddenRects) {
      candidates.push(
        { x: bad.x - icon.w - DESKTOP_POSITION_NUDGE_GAP, y: ny },
        { x: bad.x + bad.w + DESKTOP_POSITION_NUDGE_GAP, y: ny },
        { x: nx, y: bad.y - icon.h - DESKTOP_POSITION_NUDGE_GAP },
        { x: nx, y: bad.y + bad.h + DESKTOP_POSITION_NUDGE_GAP },
        { x: bad.x - icon.w - DESKTOP_POSITION_NUDGE_GAP, y: bad.y - icon.h - DESKTOP_POSITION_NUDGE_GAP },
        { x: bad.x + bad.w + DESKTOP_POSITION_NUDGE_GAP, y: bad.y - icon.h - DESKTOP_POSITION_NUDGE_GAP },
        { x: bad.x - icon.w - DESKTOP_POSITION_NUDGE_GAP, y: bad.y + bad.h + DESKTOP_POSITION_NUDGE_GAP },
        { x: bad.x + bad.w + DESKTOP_POSITION_NUDGE_GAP, y: bad.y + bad.h + DESKTOP_POSITION_NUDGE_GAP }
      );
    }

    const valid = candidates
      .map(p => ({ x: clamp(p.x, 0, maxX), y: clamp(p.y, 0, maxY) }))
      .filter(p => !overlapsForbiddenDesktopArea(p.x, p.y, forbiddenRects));

    if (!valid.length) return { x: nx, y: ny };
    valid.sort((a, b) => ((a.x - start.x) ** 2 + (a.y - start.y) ** 2) - ((b.x - start.x) ** 2 + (b.y - start.y) ** 2));
    return valid[0];
  }

  function clientToDesktopPosition(clientX, clientY, options = {}) {
    return clampDesktopPosition(clientX - DESKTOP_CLIENT_OFFSET_X, clientY - DESKTOP_CLIENT_OFFSET_Y, options);
  }

  function desktopForbiddenRects(elements = []) {
    return Array.from(elements)
      .filter(Boolean)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      })
      .filter(rect => rect.w > 0 && rect.h > 0);
  }

  function desktopGroupMovePlan(items = [], deltaX = 0, deltaY = 0, options = {}) {
    const forbiddenRects = Array.isArray(options.forbiddenRects) ? options.forbiddenRects : [];
    const width = options.viewportWidth ?? window.innerWidth;
    const height = options.viewportHeight ?? window.innerHeight;
    const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap) : 0;
    const forbiddenGap = Math.max(DESKTOP_FORBIDDEN_GAP, gap);
    const members = items
      .filter(item => item?.id)
      .map(item => ({
        id: item.id,
        x: Number.isFinite(item.x) ? item.x : 0,
        y: Number.isFinite(item.y) ? item.y : 0,
        w: Number.isFinite(item.w) && item.w > 0 ? item.w : DESKTOP_ICON_WIDTH,
        h: Number.isFinite(item.h) && item.h > 0 ? item.h : DESKTOP_ICON_HEIGHT
      }));
    if (!members.length) return { valid: false, dx: 0, dy: 0, positions: [] };

    const minDx = -Math.min(...members.map(item => item.x));
    const maxDx = Math.min(...members.map(item => width - item.w - gap - item.x));
    const minDy = -Math.min(...members.map(item => item.y));
    const maxDy = Math.min(...members.map(item => height - item.h - gap - item.y));
    const unchanged = () => ({ valid: false, dx: 0, dy: 0, positions: members.map(({ id, x, y }) => ({ id, x, y })) });
    if (minDx > maxDx || minDy > maxDy) return unchanged();
    const desired = {
      dx: clamp(Number.isFinite(deltaX) ? deltaX : 0, minDx, maxDx),
      dy: clamp(Number.isFinite(deltaY) ? deltaY : 0, minDy, maxDy)
    };
    const normalizeDelta = candidate => ({
      dx: clamp(Number.isFinite(candidate?.dx) ? candidate.dx : 0, minDx, maxDx),
      dy: clamp(Number.isFinite(candidate?.dy) ? candidate.dy : 0, minDy, maxDy)
    });
    const collides = candidate => members.some(item => (
      forbiddenRects.some(bad => rectsOverlap({ ...item, x: item.x + candidate.dx, y: item.y + candidate.dy }, bad, forbiddenGap))
    ));
    const candidates = [desired, { dx: 0, dy: 0 }];

    forbiddenRects.forEach(bad => {
      members.forEach(item => {
        const clearance = Math.max(DESKTOP_POSITION_NUDGE_GAP, forbiddenGap);
        const left = bad.x - item.w - clearance - item.x;
        const right = bad.x + bad.w + clearance - item.x;
        const above = bad.y - item.h - clearance - item.y;
        const below = bad.y + bad.h + clearance - item.y;
        candidates.push(
          { dx: left, dy: desired.dy },
          { dx: right, dy: desired.dy },
          { dx: desired.dx, dy: above },
          { dx: desired.dx, dy: below },
          { dx: left, dy: above },
          { dx: left, dy: below },
          { dx: right, dy: above },
          { dx: right, dy: below }
        );
      });
    });

    const unique = new Map();
    candidates.map(normalizeDelta).forEach(candidate => {
      unique.set(`${candidate.dx}:${candidate.dy}`, candidate);
    });
    const validCandidates = [...unique.values()].filter(candidate => !collides(candidate));
    validCandidates.sort((a, b) => (
      ((a.dx - desired.dx) ** 2 + (a.dy - desired.dy) ** 2)
      - ((b.dx - desired.dx) ** 2 + (b.dy - desired.dy) ** 2)
    ));
    const chosen = validCandidates[0];
    if (!chosen) return unchanged();

    return {
      valid: true,
      dx: chosen.dx,
      dy: chosen.dy,
      positions: members.map(item => ({ id: item.id, x: item.x + chosen.dx, y: item.y + chosen.dy }))
    };
  }

  function findFreeDesktopPosition(items = [], parent = "desktop", preferredX = null, preferredY = null, excludeId = null, options = {}) {
    const viewportWidth = options.viewportWidth ?? window.innerWidth;
    const viewportHeight = options.viewportHeight ?? window.innerHeight;
    const forbiddenRects = Array.isArray(options.forbiddenRects) ? options.forbiddenRects : [];
    const layoutOptions = { viewportWidth, viewportHeight, forbiddenRects };
    const { maxX, maxY } = desktopMaxPosition(viewportWidth, viewportHeight);
    const occupied = items
      .filter(item => item?.parent === parent && item.id !== excludeId)
      .map(item => {
        const pos = clampDesktopPosition(item.x ?? 0, item.y ?? 0, layoutOptions);
        return desktopIconRect(pos.x, pos.y);
      });

    const free = (x, y) => {
      const pos = clampDesktopPosition(x, y, layoutOptions);
      const rect = desktopIconRect(pos.x, pos.y);
      return !overlapsForbiddenDesktopArea(pos.x, pos.y, forbiddenRects) && !occupied.some(other => rectsOverlap(rect, other));
    };

    const normalized = (x, y) => clampDesktopPosition(clamp(x, 0, maxX), clamp(y, 0, maxY), layoutOptions);

    if (Number.isFinite(preferredX) && Number.isFinite(preferredY)) {
      const preferred = clientToDesktopPosition(preferredX, preferredY, layoutOptions);
      if (free(preferred.x, preferred.y)) return preferred;

      for (let radius = DESKTOP_ICON_STEP; radius <= Math.max(viewportWidth, viewportHeight); radius += DESKTOP_ICON_STEP) {
        const candidates = [
          [preferred.x + radius, preferred.y],
          [preferred.x - radius, preferred.y],
          [preferred.x, preferred.y + radius],
          [preferred.x, preferred.y - radius],
          [preferred.x + radius, preferred.y + radius],
          [preferred.x - radius, preferred.y + radius],
          [preferred.x + radius, preferred.y - radius],
          [preferred.x - radius, preferred.y - radius]
        ];
        for (const [cx, cy] of candidates) {
          const pos = normalized(cx, cy);
          if (free(pos.x, pos.y)) return pos;
        }
      }
    }

    for (let x = DESKTOP_MARGIN_X; x <= maxX; x += DESKTOP_ICON_STEP) {
      for (let y = DESKTOP_MARGIN_Y; y <= maxY; y += DESKTOP_ICON_STEP) {
        const pos = normalized(x, y);
        if (free(pos.x, pos.y)) return pos;
      }
    }

    for (let y = DESKTOP_MARGIN_Y; y <= maxY; y += DESKTOP_ICON_STEP) {
      for (let x = DESKTOP_MARGIN_X; x <= maxX; x += DESKTOP_ICON_STEP) {
        const pos = normalized(x, y);
        if (free(pos.x, pos.y)) return pos;
      }
    }

    return clampDesktopPosition(DESKTOP_MARGIN_X + occupied.length * 18, DESKTOP_MARGIN_Y + occupied.length * 18, layoutOptions);
  }

  function folderContentSize(items = [], parent, bounds = {}) {
    return {
      width: Math.max(
        Number(bounds.width) || 0,
        Number(bounds.viewportWidth) || 0,
        980,
        ...items
          .filter(item => item?.parent === parent)
          .map(item => (item.x || 0) + FOLDER_ITEM_WIDTH + FOLDER_MARGIN)
      ),
      height: Math.max(
        Number(bounds.height) || 0,
        Number(bounds.viewportHeight) || 0,
        680,
        ...items
          .filter(item => item?.parent === parent)
          .map(item => (item.y || 0) + FOLDER_ITEM_HEIGHT + FOLDER_MARGIN)
      )
    };
  }

  function findFreeFolderPosition(items = [], parent, preferredX = 36, preferredY = 36, excludeId = null, bounds = {}) {
    const { width: contentW, height: contentH } = folderContentSize(items, parent, bounds);
    const maxX = Math.max(FOLDER_ITEM_GAP, contentW - FOLDER_ITEM_WIDTH - FOLDER_ITEM_GAP);
    const maxY = Math.max(FOLDER_ITEM_GAP, contentH - FOLDER_ITEM_HEIGHT - FOLDER_ITEM_GAP);
    const occupied = items
      .filter(item => item?.parent === parent && item.id !== excludeId)
      .map(item => ({ x: item.x ?? FOLDER_MARGIN, y: item.y ?? FOLDER_MARGIN, w: FOLDER_ITEM_WIDTH, h: FOLDER_ITEM_HEIGHT }));

    const free = (x, y) => !occupied.some(rect => rectsOverlap({ x, y, w: FOLDER_ITEM_WIDTH, h: FOLDER_ITEM_HEIGHT }, rect, FOLDER_ITEM_GAP));
    const px = clamp(Number.isFinite(preferredX) ? preferredX : 36, FOLDER_ITEM_GAP, maxX);
    const py = clamp(Number.isFinite(preferredY) ? preferredY : 36, FOLDER_ITEM_GAP, maxY);
    if (free(px, py)) return { x: px, y: py };

    for (let y = FOLDER_MARGIN; y <= maxY; y += FOLDER_STEP_Y) {
      for (let x = FOLDER_MARGIN; x <= maxX; x += FOLDER_STEP_X) {
        if (free(x, y)) return { x, y };
      }
    }

    return { x: FOLDER_MARGIN, y: Math.max(FOLDER_MARGIN, ...occupied.map(rect => rect.y + rect.h + FOLDER_ITEM_GAP)) };
  }

  function positionInFolderGrid(items = [], parent, gridMetrics = {}, clientX, clientY, itemId = null) {
    const visibleW = Math.max(Number(gridMetrics.clientWidth) || 0, Number(gridMetrics.width) || 0, Number(gridMetrics.scrollWidth) || 0);
    const visibleH = Math.max(Number(gridMetrics.clientHeight) || 0, Number(gridMetrics.height) || 0, Number(gridMetrics.scrollHeight) || 0);
    const scrollLeft = Number(gridMetrics.scrollLeft) || 0;
    const scrollTop = Number(gridMetrics.scrollTop) || 0;
    const rectLeft = Number(gridMetrics.left) || 0;
    const rectTop = Number(gridMetrics.top) || 0;
    const contentX = clientX - rectLeft + scrollLeft - FOLDER_POINTER_OFFSET_X;
    const contentY = clientY - rectTop + scrollTop - FOLDER_POINTER_OFFSET_Y;
    const maxX = Math.max(FOLDER_ITEM_GAP, visibleW + scrollLeft - FOLDER_ITEM_WIDTH - FOLDER_ITEM_GAP);
    const maxY = Math.max(FOLDER_ITEM_GAP, visibleH + scrollTop - FOLDER_ITEM_HEIGHT - FOLDER_ITEM_GAP);

    return findFreeFolderPosition(items, parent, clamp(contentX, FOLDER_ITEM_GAP, maxX), clamp(contentY, FOLDER_ITEM_GAP, maxY), itemId, {
      width: visibleW + scrollLeft,
      height: visibleH + scrollTop
    });
  }

  function createDesktopLayoutRuntimeController(options = {}) {
    const getItems = typeof options.getItems === "function" ? options.getItems : () => [];
    const getDesktopRoot = typeof options.getDesktopRoot === "function" ? options.getDesktopRoot : () => "desktop";
    const getForbiddenElements = typeof options.getForbiddenElements === "function" ? options.getForbiddenElements : () => [];
    const getScrollOffset = typeof options.getScrollOffset === "function" ? options.getScrollOffset : () => ({ x: 0, y: 0 });
    const getViewportSize = typeof options.getViewportSize === "function"
      ? options.getViewportSize
      : () => ({ width: window.innerWidth, height: window.innerHeight });

    function forbiddenRects() {
      const offset = getScrollOffset();
      return desktopForbiddenRects(getForbiddenElements()).map(rect => ({ ...rect, x: rect.x + offset.x, y: rect.y + offset.y }));
    }

    function layoutOptions() {
      const viewport = getViewportSize() || {};
      return {
        forbiddenRects: forbiddenRects(),
        viewportWidth: viewport.width,
        viewportHeight: viewport.height
      };
    }

    function maxPosition() {
      const viewport = getViewportSize() || {};
      return desktopMaxPosition(viewport.width, viewport.height);
    }

    function overlapsForbiddenArea(x, y, gap = DESKTOP_FORBIDDEN_GAP) {
      return overlapsForbiddenDesktopArea(x, y, forbiddenRects(), gap);
    }

    function clampPosition(x, y) {
      return clampDesktopPosition(x, y, layoutOptions());
    }

    function clientToPosition(clientX, clientY) {
      const offset = getScrollOffset();
      return clientToDesktopPosition(clientX + offset.x, clientY + offset.y, layoutOptions());
    }

    function findFreePosition(parent = getDesktopRoot(), preferredX = null, preferredY = null, excludeId = null) {
      const offset = getScrollOffset();
      return findFreeDesktopPosition(getItems(), parent,
        Number.isFinite(preferredX) ? preferredX + offset.x : preferredX,
        Number.isFinite(preferredY) ? preferredY + offset.y : preferredY, excludeId, layoutOptions());
    }

    function groupMovePlan(items = [], deltaX = 0, deltaY = 0, movementOptions = {}) {
      return desktopGroupMovePlan(items, deltaX, deltaY, { ...layoutOptions(), gap: movementOptions.gap });
    }

    return Object.freeze({
      forbiddenRects,
      maxPosition,
      overlapsForbiddenArea,
      clampPosition,
      clientToPosition,
      findFreePosition,
      groupMovePlan
    });
  }

  window.ZETER_DESKTOP_LAYOUT_UTILS = Object.freeze({
    DESKTOP_ICON_WIDTH,
    DESKTOP_ICON_HEIGHT,
    DESKTOP_ICON_GAP,
    DESKTOP_FORBIDDEN_GAP,
    DESKTOP_ICON_STEP,
    desktopIconRect,
    rectsOverlap,
    resolveIconPosition,
    desktopMaxPosition,
    overlapsForbiddenDesktopArea,
    clampDesktopPosition,
    clientToDesktopPosition,
    desktopForbiddenRects,
    desktopGroupMovePlan,
    findFreeDesktopPosition,
    folderContentSize,
    findFreeFolderPosition,
    positionInFolderGrid,
    createDesktopLayoutRuntimeController
  });
})();
