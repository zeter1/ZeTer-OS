(() => {
  "use strict";

  // Serial, revision-aware intent queue. Adapters own validation and publication.
  function createPreferencesWriter({ keys = [], getPreferences = () => ({}), save, requireAck = false, onChange = () => {}, onError = () => {} } = {}) {
    const allowed = new Set(keys);
    const draft = Object.create(null), revisions = Object.create(null), listeners = new Set();
    let revision = 0, pending = false, scheduled = false, error = null, lastResult = null, lastSavedAt = 0;
    const copy = value => value === undefined ? undefined : (typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)));
    const patchCopy = patch => Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, copy(value)]));
    const getState = () => ({ preferences: { ...getPreferences(), ...patchCopy(draft) }, patch: patchCopy(draft), dirty: Object.keys(draft).length > 0, pending: pending || scheduled, error, canDiscard: !pending && !scheduled && Object.keys(draft).length > 0, lastResult, lastSavedAt, revision });
    const publish = () => { const state = getState(); onChange(state); for (const listener of listeners) listener(state); };

    function schedule() {
      if (pending || scheduled || error || !Object.keys(draft).length) return;
      scheduled = true;
      Promise.resolve().then(pump);
    }

    async function pump() {
      scheduled = false;
      if (pending || error || !Object.keys(draft).length) return;
      const batch = patchCopy(draft), sent = { ...revisions };
      pending = true; publish();
      try {
        if (typeof save !== "function") throw new Error("Сохранение настроек недоступно");
        const result = await save(batch);
        if (requireAck && result?.saved !== true) throw new Error("Хранилище не подтвердило запись. Повтори сохранение.");
        lastResult = result || null; lastSavedAt = Date.now();
        for (const key of Object.keys(batch)) if (revisions[key] === sent[key]) { delete draft[key]; delete revisions[key]; }
      } catch (failure) {
        error = failure; onError(failure);
      } finally {
        pending = false; schedule(); publish();
      }
    }

    function update(patch = {}) {
      const accepted = Object.entries(patch).filter(([key]) => allowed.has(key));
      if (!accepted.length) return getState();
      error = null;
      for (const [key, value] of accepted) { draft[key] = copy(value); revisions[key] = ++revision; }
      schedule(); publish(); return getState();
    }

    function retry() {
      if (pending || scheduled || !Object.keys(draft).length) return false;
      error = null; schedule(); publish(); return true;
    }

    function discard() {
      if (pending || scheduled) return false;
      for (const key of Object.keys(draft)) { delete draft[key]; delete revisions[key]; }
      error = null; publish(); return true;
    }

    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    return Object.freeze({ getState, update, retry, discard, subscribe });
  }

  window.ZETER_PREFERENCES_WRITER_UTILS = Object.freeze({ createPreferencesWriter });
})();
