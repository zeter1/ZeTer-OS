(() => {
  "use strict";

  function createDialogs(doc = document) {
    let active = null;

    function show(message, { title, action, defaultValue, password = false, notice = false, danger = false, signal } = {}) {
      const inputMode = defaultValue !== undefined;
      const cancelValue = inputMode ? null : false;
      if (active || signal?.aborted) return Promise.resolve(cancelValue);

      return new Promise(resolve => {
        const previous = doc.activeElement;
        const dialog = doc.createElement("dialog");
        dialog.className = "zeter-dialog";
        dialog.setAttribute("aria-labelledby", "zeter-dialog-title");
        dialog.setAttribute("aria-describedby", "zeter-dialog-message");
        dialog.innerHTML = `<form>
          <div class="zeter-dialog-heading"><span aria-hidden="true"></span><h2 id="zeter-dialog-title"></h2></div>
          <p id="zeter-dialog-message"></p>
          <input hidden autocomplete="off" aria-labelledby="zeter-dialog-message">
          <div class="zeter-dialog-actions">
            <button type="button" data-dialog-cancel>Отмена</button>
            <button type="submit" data-dialog-submit></button>
          </div>
        </form>`;
        const input = dialog.querySelector("input");
        const cancel = dialog.querySelector("[data-dialog-cancel]");
        const submit = dialog.querySelector("[data-dialog-submit]");
        dialog.querySelector("h2").textContent = title;
        dialog.querySelector("p").textContent = String(message ?? "");
        cancel.hidden = notice;
        submit.textContent = action;
        dialog.toggleAttribute("data-danger", danger);
        if (inputMode) {
          input.hidden = false;
          input.type = password ? "password" : "text";
          input.value = String(defaultValue);
        }
        const first = inputMode ? input : notice ? submit : cancel;
        first.autofocus = true;

        const finish = value => {
          if (active !== dialog) return;
          active = null;
          signal?.removeEventListener("abort", dismiss);
          dialog.close();
          dialog.remove();
          if (previous?.isConnected) previous.focus({ preventScroll: true });
          resolve(value);
        };
        const dismiss = () => finish(cancelValue);
        cancel.addEventListener("click", dismiss);
        dialog.addEventListener("cancel", event => { event.preventDefault(); dismiss(); });
        dialog.addEventListener("keydown", event => event.stopPropagation());
        dialog.querySelector("form").addEventListener("submit", event => {
          event.preventDefault();
          finish(inputMode ? input.value : true);
        });
        active = dialog;
        doc.body.append(dialog);
        dialog.showModal();
        if (inputMode) input.select();
        signal?.addEventListener("abort", dismiss, { once: true });
      });
    }

    return Object.freeze({
      confirm(message, options = {}) {
        const danger = /^Удалить|^Очистить/u.test(message);
        const action = message.startsWith("Удалить") ? "Удалить" : message.startsWith("Очистить") ? "Очистить" : "Продолжить";
        return show(message, { title: danger ? "Подтверждение удаления" : "Подтвердите действие", action, danger, ...options });
      },
      prompt(message, defaultValue = "", options = {}) {
        return show(message, { title: "Введите значение", action: "Сохранить", defaultValue, ...options });
      },
      alert(message, options = {}) {
        return show(message, { title: "Сообщение ZeTer OS", action: "Закрыть", notice: true, ...options });
      }
    });
  }

  window.ZETER_DIALOG_UTILS = Object.freeze({ createDialogs });
})();
