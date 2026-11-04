"""Small, storage-free pywebview bridge for note-backed Windows stickers.

The main JavaScript controller owns all mutations and persistence. Child windows
receive no NativeStorageApi and cannot load or overwrite a state snapshot.
"""
from __future__ import annotations

import json
import re
import threading
from typing import Any


def _error(message: str) -> dict:
    return {"ok": False, "error": message}


def _text(value: Any, limit: int) -> bool:
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        return False
    try:
        value.encode("utf-8")
        return True
    except UnicodeError:
        return False


class StickyWindowApi:
    """The complete public API exposed to one child window."""

    def __init__(self, owner: "StickyWindows", key: tuple[str, str]):
        self._owner = owner
        self._key = key
        self._window = None
        self._allow_close = False
        self._checking_close = False
        self._close_lock = threading.Lock()
        self._save_lock = threading.Lock()

    def get_snapshot(self) -> dict:
        return self._owner._call("snapshot", self._key)

    def save_sticky(self, payload: Any) -> dict:
        fields = {"title", "richHtml", "expectedTitle", "expectedRichHtml"}
        if not isinstance(payload, dict) or set(payload) not in (fields, fields | {"appearance", "expectedAppearance"}):
            return _error("Некорректные данные стикера.")
        if not all(_text(payload[name], 2_000_000 if "Html" in name else 240) for name in fields):
            return _error("Текст стикера слишком большой или повреждён.")
        for name in ("appearance", "expectedAppearance"):
            if name not in payload:
                continue
            value = payload[name]
            if (not isinstance(value, dict) or set(value) != {"color", "textColor", "fontSize", "opacity"}
                    or value["color"] not in ("purple", "blue", "mint", "yellow", "pink", "graphite", "orange", "coral", "red", "lime", "teal", "indigo", "lavender", "plum", "brown", "sand")
                    or value["textColor"] not in ("light", "dark")
                    or type(value["fontSize"]) is not int or not 12 <= value["fontSize"] <= 22
                    or type(value["opacity"]) not in (int, float) or not .7 <= value["opacity"] <= 1):
                return _error("Некорректные настройки стикера.")
        if not self._save_lock.acquire(blocking=False):
            return _error("Стикер уже сохраняется. Дождитесь результата.")
        try:
            return self._owner._call("save", self._key, payload)
        finally:
            self._save_lock.release()

    def perform_action(self, payload: Any) -> dict:
        if not isinstance(payload, dict) or set(payload) != {"action"} or payload["action"] not in ("library", "desktop", "delete"):
            return _error("Неизвестное действие стикера.")
        if not self._save_lock.acquire(blocking=False):
            return _error("Дождитесь сохранения стикера.")
        try:
            self._owner._main.restore()
            self._owner._main.show()
            return self._owner._call("action", self._key, payload)
        except Exception:
            return _error("Не удалось открыть главное окно. Попробуйте снова.")
        finally:
            self._save_lock.release()

    def close_window(self) -> dict:
        try:
            if self._window is None:
                return _error("Окно стикера уже закрыто.")
            self._allow_close = True
            self._window.destroy()
            return {"ok": True}
        except Exception:
            self._allow_close = False
            return _error("Не удалось закрыть окно стикера.")

    def _on_closing(self):
        if self._allow_close or self._owner._closed:
            return True
        with self._close_lock:
            if not self._checking_close:
                self._checking_close = True
                threading.Thread(target=self._request_close, daemon=True).start()
        # WinForms closing runs on its GUI thread: never evaluate JS there.
        return False

    def _request_close(self):
        try:
            # This fixed script never includes note text or a caller's expression.
            script = "Boolean(!window.ZETER_STICKY_WINDOW || window.ZETER_STICKY_WINDOW.requestClose())"
            if self._window is not None and self._window.evaluate_js(script) is True:
                self.close_window()
        except Exception:
            # Keep the live window/draft when its close check could not complete.
            pass
        finally:
            with self._close_lock:
                self._checking_close = False


class StickyWindows:
    def __init__(self, main_window: Any, webview: Any, origin: str, ack_timeout: float = 30):
        self._main = main_window
        self._webview = webview
        self._url = origin.rstrip("/") + "/sticky-window.html"
        self._ack_timeout = ack_timeout
        self._lock = threading.RLock()
        self._children: dict[tuple[str, str], StickyWindowApi] = {}
        self._closed = False
        self._preparing_close = False
        self._allow_main_close = False

    def open(self, payload: Any) -> dict:
        if not isinstance(payload, dict) or set(payload) != {"workspaceId", "stickyId"}:
            return _error("Некорректный идентификатор стикера.")
        if not all(isinstance(value, str) and re.fullmatch(r"[\w.-]{1,160}", value, re.ASCII) for value in payload.values()):
            return _error("Некорректный идентификатор стикера.")
        key = (payload["workspaceId"], payload["stickyId"])
        snapshot = self._call("snapshot", key)
        if snapshot.get("ok") is not True:
            return snapshot
        try:
            with self._lock:
                if self._closed or self._preparing_close:
                    return _error("Главное окно уже закрыто.")
                existing = self._children.get(key)
                if existing and existing._window is not None:
                    existing._window.restore()
                    existing._window.show()
                    return {"ok": True, "reused": True}
                bridge = StickyWindowApi(self, key)
                window = self._webview.create_window(
                    "Стикер — ZeTer OS", self._url, js_api=bridge,
                    width=360, height=400, min_size=(280, 240), text_select=True,
                    background_color="#fff6bd", confirm_close=False,
                )
                if window is None:
                    return _error("Не удалось создать окно стикера.")
                bridge._window = window
                self._children[key] = bridge
                window.events.closing += bridge._on_closing

                def on_closed():
                    with self._lock:
                        if self._children.get(key) is bridge:
                            self._children.pop(key, None)
                        bridge._window = None

                window.events.closed += on_closed
                return {"ok": True, "reused": False}
        except Exception:
            return _error("Не удалось открыть окно стикера.")

    def _call(self, method: str, key: tuple[str, str], patch: dict | None = None) -> dict:
        if self._closed:
            return _error("Главное окно уже закрыто.")
        payload = {"workspaceId": key[0], "stickyId": key[1], **(patch or {})}
        encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
        # Double JSON encoding keeps all user text inside a JS string literal.
        argument = "JSON.parse(" + json.dumps(encoded) + ")"
        script = (
            "Promise.resolve().then(() => { const api = window.ZETER_STICKY_NATIVE; "
            "if (!api || typeof api." + method + " !== 'function') "
            "return {ok:false,error:'Стикеры в главном окне ещё не готовы.'}; "
            "return api." + method + "(" + argument + "); "
            "}).catch(() => ({ok:false,error:'Не удалось обработать стикер в главном окне.'}))"
        )
        ready = threading.Event()
        result = []

        def receive(value):
            result.append(value)
            ready.set()

        try:
            self._main.evaluate_js(script, callback=receive)
            if not ready.wait(self._ack_timeout):
                return _error("Нет подтверждения главного окна. Сохранение могло завершиться; проверьте заметку перед повтором.")
            value = result[0]
            if not isinstance(value, dict) or type(value.get("ok")) is not bool:
                return _error("Главное окно вернуло некорректный ответ.")
            if value["ok"] is False:
                # Parent errors are UI strings, never exception/log output.
                return _error(value.get("error") if _text(value.get("error"), 1000) else "Не удалось сохранить стикер.")
            if method == "action":
                return {"ok": True}
            snapshot = value.get("snapshot")
            if not isinstance(snapshot, dict) or snapshot.get("workspaceId") != key[0] or snapshot.get("stickyId") != key[1]:
                return _error("Главное окно вернуло другой стикер.")
            if not _text(snapshot.get("title"), 240) or not _text(snapshot.get("richHtml"), 2_000_000):
                return _error("Главное окно вернуло некорректный текст стикера.")
            return {"ok": True, "snapshot": snapshot}
        except Exception:
            return _error("Главное окно недоступно. Текст в этом окне сохранён для повторной попытки.")

    def close_all(self):
        """Called after the main window has closed; never mutates note/state data."""
        with self._lock:
            self._closed = True
            children = list(self._children.values())
        for child in children:
            child.close_window()

    def can_close_main(self) -> bool:
        """GUI handler: cancel now, check main forms/child drafts on a worker."""
        with self._lock:
            if self._closed or self._allow_main_close:
                return True
            if not self._preparing_close:
                self._preparing_close = True
                threading.Thread(target=self._prepare_main_close, daemon=True).start()
        return False

    def _check_close(self, window: Any, script: str) -> bool:
        finished = threading.Event()
        result = []

        def receive(value):
            result.append(value)
            finished.set()

        try:
            window.evaluate_js(script, callback=receive)
            return finished.wait(self._ack_timeout) and result[0] is True
        except Exception:
            return False

    def _prepare_main_close(self):
        with self._lock:
            children = list(self._children.values())
        main_script = (
            "Promise.resolve().then(() => { const api = window.ZETER_STICKY_NATIVE; "
            "return api && typeof api.prepareClose === 'function' ? api.prepareClose() : true; "
            "}).catch(() => false)"
        )
        ready_to_close = self._check_close(self._main, main_script)
        for child in (children if ready_to_close else []):
            window = child._window
            if window is None:
                continue
            script = "Promise.resolve().then(() => window.ZETER_STICKY_WINDOW ? window.ZETER_STICKY_WINDOW.prepareClose() : true).catch(() => false)"
            if not self._check_close(window, script):
                ready_to_close = False
                break
        if ready_to_close:
            try:
                self._allow_main_close = True
                self._main.destroy()
                return
            except Exception:
                self._allow_main_close = False
        # A form/save refused close: keep the main app and children editable.
        try:
            self._main.evaluate_js("window.ZETER_STICKY_NATIVE && window.ZETER_STICKY_NATIVE.cancelClose && window.ZETER_STICKY_NATIVE.cancelClose()")
        except Exception:
            pass
        for child in children:
            try:
                if child._window is not None:
                    child._window.evaluate_js("window.ZETER_STICKY_WINDOW && window.ZETER_STICKY_WINDOW.cancelClose()")
            except Exception:
                pass
        with self._lock:
            self._preparing_close = False
