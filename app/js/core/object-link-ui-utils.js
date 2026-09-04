(() => {
  "use strict";

  const coreUtils = window.ZETER_CORE_UTILS;
  const objectLinkUtils = window.ZETER_OBJECT_LINK_UTILS;
  if (!coreUtils) throw new Error("ZeTer OS object link UI utils require core utils.");
  if (!objectLinkUtils) throw new Error("ZeTer OS object link UI utils require object link utils.");

  const { escapeHtml } = coreUtils;
  const {
    normalizeObjectLinkEndpoint,
    normalizeObjectLinks,
    objectLinkEndpointKey,
    linksForObjectEndpoint
  } = objectLinkUtils;
  const safeAttr = escapeHtml;

  function normalizedCandidate(value = {}) {
    const endpoint = normalizeObjectLinkEndpoint(value.endpoint || value);
    if (!endpoint) return null;
    return {
      endpoint,
      label: String(value.label || value.name || value.title || endpoint.id).trim() || endpoint.id,
      typeLabel: String(value.typeLabel || value.kindLabel || (endpoint.kind === "event" ? "Событие" : "Файл")).trim()
    };
  }

  function resolveEndpointPresentation(endpoint, options = {}) {
    const normalized = normalizeObjectLinkEndpoint(endpoint);
    if (!normalized) return { label: "Объект недоступен", typeLabel: "Объект" };
    const resolver = typeof options.resolveEndpoint === "function" ? options.resolveEndpoint : null;
    if (resolver) {
      const resolved = resolver(normalized) || {};
      const candidate = normalizedCandidate({ endpoint: normalized, ...resolved });
      if (candidate) return { label: candidate.label, typeLabel: candidate.typeLabel };
    }
    const match = (Array.isArray(options.candidates) ? options.candidates : [])
      .map(normalizedCandidate)
      .find(candidate => candidate && objectLinkEndpointKey(candidate.endpoint) === objectLinkEndpointKey(normalized));
    if (match) return { label: match.label, typeLabel: match.typeLabel };
    return { label: normalized.id, typeLabel: normalized.kind === "event" ? "Событие" : "Объект" };
  }

  function linkedEndpointFor(link, endpoint) {
    const sourceKey = objectLinkEndpointKey(endpoint);
    if (!sourceKey) return null;
    if (objectLinkEndpointKey(link?.a) === sourceKey) return normalizeObjectLinkEndpoint(link.b);
    if (objectLinkEndpointKey(link?.b) === sourceKey) return normalizeObjectLinkEndpoint(link.a);
    return null;
  }

  function objectLinkRowsHTML(links = [], endpoint = {}, options = {}) {
    const related = linksForObjectEndpoint(links, endpoint);
    if (!related.length) return `<p class="muted object-links-empty">Связанных объектов пока нет.</p>`;
    return related.map(link => {
      const linked = linkedEndpointFor(link, endpoint);
      const presentation = resolveEndpointPresentation(linked, options);
      return `<div class="object-link-row" data-object-link-id="${safeAttr(link.id)}"><div class="object-link-copy"><b>${escapeHtml(presentation.label)}</b><small>${escapeHtml(presentation.typeLabel)}</small></div><div class="object-link-actions"><button type="button" data-open-object-link-kind="${safeAttr(linked?.kind || "")}" data-open-object-link-id="${safeAttr(linked?.id || "")}">Открыть</button><button type="button" class="danger-btn" data-remove-object-link="${safeAttr(link.id)}" aria-label="Удалить связь с объектом">Удалить связь</button></div></div>`;
    }).join("");
  }

  function availableObjectLinkCandidates(candidates = [], endpoint = {}, links = []) {
    const sourceKey = objectLinkEndpointKey(endpoint);
    const linkedKeys = new Set(linksForObjectEndpoint(links, endpoint).map(link => objectLinkEndpointKey(linkedEndpointFor(link, endpoint))));
    return (Array.isArray(candidates) ? candidates : []).map(normalizedCandidate).filter(candidate => {
      if (!candidate) return false;
      const key = objectLinkEndpointKey(candidate.endpoint);
      return Boolean(key && key !== sourceKey && !linkedKeys.has(key));
    });
  }

  function objectLinkCandidateOptionsHTML(candidates = [], endpoint = {}, links = []) {
    const available = availableObjectLinkCandidates(candidates, endpoint, links);
    const options = [`<option value="">${available.length ? "Выбери объект" : "Нет доступных объектов"}</option>`];
    available.forEach(candidate => {
      const key = objectLinkEndpointKey(candidate.endpoint);
      options.push(`<option value="${safeAttr(key)}">${escapeHtml(candidate.typeLabel)} · ${escapeHtml(candidate.label)}</option>`);
    });
    return options.join("");
  }

  function objectLinksPanelHTML(options = {}) {
    const endpoint = normalizeObjectLinkEndpoint(options.endpoint);
    const links = normalizeObjectLinks(options.links);
    const candidates = Array.isArray(options.candidates) ? options.candidates : [];
    if (!endpoint) return "";
    const availableCandidates = availableObjectLinkCandidates(candidates, endpoint, links);
    const selectOptions = objectLinkCandidateOptionsHTML(availableCandidates, endpoint, links);
    const hasCandidate = availableCandidates.length > 0;
    return `<section class="object-links-panel" data-object-links-panel><div class="object-links-heading"><div><h4>Связи</h4><p class="muted">Переходи между связанными объектами, не создавая копии.</p></div></div><div class="object-links-list" data-object-links-list>${objectLinkRowsHTML(links, endpoint, options)}</div><div class="object-link-add-row"><select data-object-link-candidate aria-label="Объект для новой связи"${hasCandidate ? "" : " disabled"}>${selectOptions}</select><button type="button" data-add-object-link${hasCandidate ? "" : " disabled"}>Добавить связь</button></div></section>`;
  }

  function endpointFromKey(value = "") {
    const match = /^(fs|event):([A-Za-z0-9_-]{1,220})$/.exec(String(value || "").trim());
    return match ? normalizeObjectLinkEndpoint({ kind: match[1], id: match[2] }) : null;
  }

  function objectLinkClickAction(target, root = null) {
    const open = target?.closest?.("[data-open-object-link-id]");
    if (open) return { type: "open", endpoint: normalizeObjectLinkEndpoint({ kind: open.dataset.openObjectLinkKind, id: open.dataset.openObjectLinkId }) };
    const remove = target?.closest?.("[data-remove-object-link]");
    if (remove) return { type: "remove", linkId: remove.dataset.removeObjectLink || "" };
    if (target?.closest?.("[data-add-object-link]")) {
      const select = root?.querySelector?.("[data-object-link-candidate]");
      return { type: "add", endpoint: endpointFromKey(select?.value || "") };
    }
    return null;
  }

  function createObjectLinksPanel(integration = {}) {
    const documentRef = integration.document || globalThis.document;
    const endpoint = normalizeObjectLinkEndpoint(integration.endpoint);
    if (!endpoint) return null;
    const getLinks = typeof integration.getLinks === "function" ? integration.getLinks : () => [];
    const getCandidates = typeof integration.getCandidates === "function" ? integration.getCandidates : () => (integration.candidates || []);
    const openLinkedObject = typeof integration.openLinkedObject === "function" ? integration.openLinkedObject : () => false;
    const addLink = typeof integration.addLink === "function" ? integration.addLink : () => false;
    const removeLink = typeof integration.removeLink === "function" ? integration.removeLink : () => false;
    const onError = typeof integration.onError === "function" ? integration.onError : () => {};
    const root = documentRef.createElement("div");
    root.className = "object-links-mount";

    const render = () => {
      root.innerHTML = objectLinksPanelHTML({
        endpoint,
        links: getLinks(),
        candidates: getCandidates(),
        resolveEndpoint: integration.resolveEndpoint
      });
    };
    const refreshAfterAccepted = result => {
      if (result && typeof result.then === "function") {
        result.then(accepted => {
          if (accepted !== false) render();
        }).catch(onError);
        return;
      }
      if (result !== false) render();
    };
    root.addEventListener("click", event => {
      const action = objectLinkClickAction(event.target, root);
      if (!action) return;
      if (action.type === "open" && action.endpoint) openLinkedObject(action.endpoint);
      if (action.type === "remove" && action.linkId) refreshAfterAccepted(removeLink(action.linkId));
      if (action.type === "add" && action.endpoint) refreshAfterAccepted(addLink(endpoint, action.endpoint));
    });
    render();
    Object.defineProperty(root, "refreshObjectLinks", { value: render });
    return root;
  }

  window.ZETER_OBJECT_LINK_UI_UTILS = Object.freeze({
    normalizedCandidate,
    resolveEndpointPresentation,
    linkedEndpointFor,
    objectLinkRowsHTML,
    availableObjectLinkCandidates,
    objectLinkCandidateOptionsHTML,
    objectLinksPanelHTML,
    endpointFromKey,
    objectLinkClickAction,
    createObjectLinksPanel
  });
})();
