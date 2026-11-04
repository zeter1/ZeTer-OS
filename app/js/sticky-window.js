(() => {
  "use strict";
  const title = document.querySelector("#sticky-title");
  const editor = document.querySelector("#sticky-editor");
  const status = document.querySelector("#sticky-status");
  const retryButton = document.querySelector("#sticky-retry");
  const settingsButton = document.querySelector("#sticky-settings");
  const settingsPanel = document.querySelector("#sticky-settings-panel");
  const color = document.querySelector("#sticky-color");
  const textColor = document.querySelector("#sticky-text-color");
  const fontSize = document.querySelector("#sticky-font-size");
  const opacity = document.querySelector("#sticky-opacity");
  const visual = window.ZETER_STICKY_UTILS;
  color.innerHTML = visual.stickySelectOptions(visual.STICKY_COLORS, "yellow");
  textColor.innerHTML = visual.stickySelectOptions(visual.STICKY_TEXT_COLORS, "dark");
  const { cleanRichHtml, plainToRichHtml } = window.ZETER_RICH_TEXT_UTILS;
  let baseline = null;
  let dirty = false;
  let pending = null;
  let timer = null;
  let polling = false;
  let closing = false;
  let stopped = false;
  let revision = 0;
  let preparingClose = false;
  let acting = false;

  const snapshotAppearance = snapshot => visual.normalizeStickySettings({ ...snapshot.appearance, color: snapshot.appearance?.color || snapshot.color || "yellow", textColor: snapshot.appearance?.textColor || "dark" });
  const currentAppearance = () => ({ color: color.value, textColor: textColor.value, fontSize: Number(fontSize.value), opacity: Number(opacity.value) / 100 });
  const appearancePayload = value => Object.fromEntries(['color', 'textColor', 'fontSize', 'opacity'].map(key => [key, value[key]]));
  function applyAppearance(value, updateControls = true) {
    visual.applyStickyVisual(document.querySelector('.sticky-window'), { ...value });
    document.documentElement.dataset.color = value.color;
    if (updateControls) {
      color.value = value.color; textColor.value = value.textColor;
      fontSize.value = value.fontSize; opacity.value = Math.round(value.opacity * 100);
    }
    document.querySelector('#sticky-font-size-value').textContent = `${value.fontSize}px`;
    document.querySelector('#sticky-opacity-value').textContent = `${Math.round(value.opacity * 100)}%`;
  }
  function lock(locked) {
    title.disabled = locked || !baseline;
    editor.contentEditable = !locked && baseline ? 'true' : 'false';
    settingsPanel.querySelectorAll('button,input,select').forEach(control => { control.disabled = locked || !baseline; });
    settingsButton.disabled = locked || !baseline;
    retryButton.disabled = locked || !baseline;
  }
  function showSettings(shown) {
    settingsPanel.hidden = !shown;
    settingsButton.setAttribute('aria-expanded', String(shown));
    if (shown) settingsPanel.querySelector('button')?.focus();
    else settingsButton.focus({ preventScroll: true });
  }

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
    retryButton.hidden = !error || !dirty;
    const panelStatus = document.querySelector('#sticky-settings-status');
    panelStatus.textContent = error ? text : '';
    panelStatus.hidden = !error;
    document.querySelector('#sticky-settings-retry').hidden = !error || !dirty;
  }

  async function call(method, payload) {
    const api = window.pywebview?.api;
    if (typeof api?.[method] !== "function") throw new Error("Windows-окно ещё не подключено. Попробуйте снова.");
    const result = await api[method](...(payload === undefined ? [] : [payload]));
    if (!result || result.ok !== true) throw new Error(result?.error || "Не удалось сохранить стикер.");
    return result;
  }

  function attachmentLabels() {
    editor.querySelectorAll("[data-managed-file-inline]").forEach(marker => {
      marker.contentEditable = "false";
      marker.textContent = "📎 Вложение";
      marker.title = "Вложение заметки. Открывается в главном окне ZeTer OS.";
    });
  }

  function apply(snapshot) {
    baseline = snapshot;
    title.value = snapshot.title;
    editor.innerHTML = cleanRichHtml(snapshot.richHtml);
    attachmentLabels();
    title.disabled = false;
    editor.contentEditable = "true";
    applyAppearance(snapshotAppearance(snapshot));
    lock(preparingClose || acting);
    document.title = `${snapshot.title || "Стикер"} — ZeTer OS`;
  }

  async function refresh() {
    if (polling || dirty || pending || stopped || preparingClose || acting || closing) return;
    polling = true;
    const before = revision;
    try {
      const result = await call("get_snapshot");
      if (before !== revision || dirty || pending || stopped || preparingClose || acting || closing) return;
      document.documentElement.dataset.color = typeof result.snapshot.color === "string" && /^[a-z]{1,20}$/.test(result.snapshot.color) ? result.snapshot.color : "yellow";
      if (!baseline || baseline.title !== result.snapshot.title || baseline.richHtml !== result.snapshot.richHtml) apply(result.snapshot);
      else {
        baseline = result.snapshot;
        applyAppearance(snapshotAppearance(baseline));
      }
      message("Изменения сохраняются автоматически");
    } catch (error) {
      if (before === revision && !preparingClose) message(error.message, true);
      // A stale/removed sticky can no longer write; retain its visible text.
    } finally { polling = false; }
  }

  function save() {
    clearTimeout(timer);
    if (pending) return pending.then(ok => ok && dirty ? save() : ok);
    if (!dirty || !baseline) return Promise.resolve(!dirty);
    const before = revision;
    const payload = {
      title: title.value.trim() || baseline.title,
      richHtml: cleanRichHtml(editor.innerHTML),
      expectedTitle: baseline.title,
      expectedRichHtml: baseline.richHtml
    };
    payload.appearance = currentAppearance();
    payload.expectedAppearance = appearancePayload(snapshotAppearance(baseline));
    message("Сохранение…");
    retryButton.disabled = true;
    pending = call("save_sticky", payload).then(result => {
      baseline = result.snapshot;
      if (before === revision) {
        dirty = false;
        // Do not replace the editor DOM here: the caret belongs to the user.
        title.value = result.snapshot.title;
        applyAppearance(snapshotAppearance(result.snapshot));
        document.title = `${result.snapshot.title || "Стикер"} — ZeTer OS`;
        message("Изменения сохранены");
      }
      return true;
    }).catch(error => { message(error.message, true); return false; }).finally(() => {
      pending = null;
      retryButton.disabled = preparingClose || acting;
    });
    return pending.then(ok => {
      if (ok && dirty) return save();
      return ok;
    });
  }

  function changed() {
    if (preparingClose || acting) return;
    dirty = true;
    revision += 1;
    message("Есть изменения…");
    clearTimeout(timer);
    timer = setTimeout(save, 450);
  }

  async function closeAfterSave() {
    if (closing) return;
    closing = true;
    try {
      lock(true);
      if (await save()) await call("close_window");
    } catch (error) { message(error.message, true); }
    finally { closing = false; lock(preparingClose || acting); }
  }

  window.ZETER_STICKY_WINDOW = Object.freeze({
    requestClose() {
      if (acting) return false;
      if (!dirty && !pending) return true;
      closeAfterSave();
      return false;
    },
    async prepareClose() {
      preparingClose = true;
      lock(true);
      if (acting) return false;
      return save();
    },
    cancelClose() {
      preparingClose = false;
      lock(acting);
    }
  });

  [title, editor].forEach(element => element.addEventListener("input", changed));
  retryButton.addEventListener("click", save);
  document.querySelector('#sticky-settings-retry').addEventListener('click', save);
  settingsButton.addEventListener('click', () => showSettings(settingsPanel.hidden));
  document.querySelector('#sticky-settings-close').addEventListener('click', () => showSettings(false));
  settingsPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); showSettings(false); }
  });
  [color, textColor, fontSize, opacity].forEach(control => control.addEventListener('change', () => {
    applyAppearance(currentAppearance(), false); changed();
  }));
  [fontSize, opacity].forEach(control => control.addEventListener('input', () => {
    applyAppearance(currentAppearance(), false); changed();
  }));
  document.querySelector('#sticky-reset').addEventListener('click', () => {
    applyAppearance(visual.normalizeStickySettings({})); changed();
  });
  const dialogs = window.ZETER_DIALOG_UTILS.createDialogs(document);
  settingsPanel.querySelectorAll('[data-sticky-action]').forEach(button => button.addEventListener('click', async () => {
    if (acting || preparingClose || !baseline) return;
    const action = button.dataset.stickyAction;
    if (action === 'delete' && !await dialogs.confirm('Удалить стикер? Исходная заметка и вложения останутся в ZeTer OS.')) return;
    if (acting || preparingClose || stopped) return;
    acting = true; lock(true);
    try {
      if (!await save()) return;
      await call('perform_action', { action });
      await call('close_window');
    } catch (error) { message(error.message, true); }
    finally { acting = false; lock(preparingClose); }
  }));
  editor.addEventListener("paste", event => {
    const html = event.clipboardData?.getData("text/html") || "";
    const text = event.clipboardData?.getData("text/plain") || "";
    event.preventDefault();
    document.execCommand("insertHTML", false, html ? cleanRichHtml(html) : plainToRichHtml(text));
    attachmentLabels();
    changed();
  });
  // External navigation must not replace the dedicated child bridge document.
  editor.addEventListener("click", event => { if (event.target.closest("a")) event.preventDefault(); });
  editor.addEventListener("drop", event => event.preventDefault());
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") { event.preventDefault(); save(); }
  });
  window.addEventListener("pywebviewready", refresh);
  window.addEventListener("unload", () => { stopped = true; clearTimeout(timer); clearInterval(poll); });
  const poll = setInterval(refresh, 1500);
  if (window.pywebview?.api) refresh();
})();
