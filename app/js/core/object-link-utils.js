(() => {
  "use strict";

  const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,220}$/;
  const OBJECT_LINK_MAX_ITEMS = 5000;
  const OBJECT_LINK_LABEL_MAX_CHARS = 160;
  const OBJECT_LINK_ENDPOINT_KINDS = Object.freeze(["fs", "event"]);
  const ENDPOINT_KIND_SET = new Set(OBJECT_LINK_ENDPOINT_KINDS);

  function boundedString(value, max = OBJECT_LINK_LABEL_MAX_CHARS) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }

  function safeId(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    return SAFE_ID_RE.test(raw) ? raw : "";
  }

  function normalizeObjectLinkEndpoint(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const kind = String(value.kind || value.type || "").trim();
    const id = safeId(value.id);
    if (!ENDPOINT_KIND_SET.has(kind) || !id) return null;
    return Object.freeze({ kind, id });
  }

  function objectLinkEndpointKey(endpoint) {
    const normalized = normalizeObjectLinkEndpoint(endpoint);
    return normalized ? `${normalized.kind}:${normalized.id}` : "";
  }

  function canonicalEndpoints(left, right) {
    const a = normalizeObjectLinkEndpoint(left);
    const b = normalizeObjectLinkEndpoint(right);
    if (!a || !b) return null;
    const aKey = objectLinkEndpointKey(a);
    const bKey = objectLinkEndpointKey(b);
    if (!aKey || !bKey || aKey === bKey) return null;
    return aKey < bKey ? [a, b] : [b, a];
  }

  function normalizeObjectLink(value, index = 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const endpoints = canonicalEndpoints(
      value.a || value.from || value.source,
      value.b || value.to || value.target
    );
    if (!endpoints) return null;

    const fallbackId = `object_link_${Math.max(0, Math.floor(Number(index) || 0)) + 1}`;
    const id = safeId(value.id) || fallbackId;
    const label = boundedString(value.label);
    const createdAt = Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : 0;
    const normalized = { id, a: endpoints[0], b: endpoints[1] };
    if (label) normalized.label = label;
    if (createdAt > 0) normalized.createdAt = createdAt;
    return normalized;
  }

  function objectLinkPairKey(link) {
    const normalized = normalizeObjectLink(link);
    return normalized
      ? `${objectLinkEndpointKey(normalized.a)}|${objectLinkEndpointKey(normalized.b)}`
      : "";
  }

  function uniqueLinkId(preferred, index, usedIds) {
    let candidate = safeId(preferred) || `object_link_${index + 1}`;
    if (!usedIds.has(candidate)) return candidate;
    let suffix = 2;
    const base = candidate.slice(0, 205) || `object_link_${index + 1}`;
    while (usedIds.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }

  function normalizeObjectLinks(value, options = {}) {
    const max = Number.isFinite(Number(options.maxItems))
      ? Math.max(0, Math.min(OBJECT_LINK_MAX_ITEMS, Math.floor(Number(options.maxItems))))
      : OBJECT_LINK_MAX_ITEMS;
    const source = Array.isArray(value) ? value.slice(0, max) : [];
    const pairKeys = new Set();
    const usedIds = new Set();
    const result = [];

    source.forEach((entry, index) => {
      const normalized = normalizeObjectLink(entry, index);
      if (!normalized) return;
      const pairKey = objectLinkPairKey(normalized);
      if (!pairKey || pairKeys.has(pairKey)) return;
      normalized.id = uniqueLinkId(normalized.id, index, usedIds);
      pairKeys.add(pairKey);
      usedIds.add(normalized.id);
      result.push(normalized);
    });
    return result;
  }

  function linksForObjectEndpoint(links, endpoint) {
    const key = objectLinkEndpointKey(endpoint);
    if (!key) return [];
    return normalizeObjectLinks(links).filter(link => (
      objectLinkEndpointKey(link.a) === key || objectLinkEndpointKey(link.b) === key
    ));
  }

  function linkedObjectEndpoints(links, endpoint) {
    const key = objectLinkEndpointKey(endpoint);
    if (!key) return [];
    return linksForObjectEndpoint(links, endpoint).map(link => (
      objectLinkEndpointKey(link.a) === key ? link.b : link.a
    ));
  }

  function endpointExists(endpoint, state = {}, workspace = {}) {
    const normalized = normalizeObjectLinkEndpoint(endpoint);
    if (!normalized) return false;
    if (normalized.kind === "fs") {
      return Boolean(state?.fs && typeof state.fs === "object" && state.fs[normalized.id]);
    }
    return (Array.isArray(workspace?.events) ? workspace.events : []).some(event => event?.id === normalized.id);
  }

  function pruneBrokenObjectLinks(links, state = {}, workspace = {}) {
    return normalizeObjectLinks(links).filter(link => (
      endpointExists(link.a, state, workspace) && endpointExists(link.b, state, workspace)
    ));
  }

  window.ZETER_OBJECT_LINK_UTILS = Object.freeze({
    OBJECT_LINK_MAX_ITEMS,
    OBJECT_LINK_LABEL_MAX_CHARS,
    OBJECT_LINK_ENDPOINT_KINDS,
    normalizeObjectLinkEndpoint,
    objectLinkEndpointKey,
    normalizeObjectLink,
    normalizeObjectLinks,
    linksForObjectEndpoint,
    linkedObjectEndpoints,
    pruneBrokenObjectLinks
  });
})();
