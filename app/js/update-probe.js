(() => {
  "use strict";
  let confirmed = false;
  async function confirm() {
    if (confirmed || !window.pywebview?.api?.confirm_update_probe) return;
    confirmed = true;
    const params = new URLSearchParams(location.search);
    if (params.get("expected") !== window.ZETER_OS_VERSION) return;
    await window.pywebview.api.confirm_update_probe(params.get("nonce"), window.ZETER_OS_VERSION);
  }
  window.addEventListener("pywebviewready", () => { void confirm(); }, { once: true });
  document.addEventListener("DOMContentLoaded", () => { void confirm(); }, { once: true });
})();
