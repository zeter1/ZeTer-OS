"""Hermetic native sticker contract: inert module import, no app/data/GUI/network."""
from __future__ import annotations

import ast
import json
from pathlib import Path
import re
import os
import shutil
import subprocess
import sys
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sticky_windows import StickyWindows


def check_poll_during_close(root: Path):
    """Run only the child controller in a VM: fake DOM, held synthetic ACK."""
    node = os.environ.get("ZETER_NODE") or shutil.which("node")
    assert node, "Node is required for the child-window close regression"
    script = r'''
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(process.argv[2], "utf8");
const elements = new Map();
for (const name of ["title", "editor", "status", "retry", "settings", "settings-panel", "color", "text-color", "font-size", "opacity", "font-size-value", "opacity-value", "settings-close", "reset", "settings-status", "settings-retry"]) {
  elements.set(`#sticky-${name}`, {
    value: "", innerHTML: "", textContent: "", disabled: true,
    contentEditable: "false", dataset: {}, addEventListener() {},
    style: {setProperty() {}}, setAttribute() {}, focus() {},
    querySelectorAll() { return []; }
  });
}
elements.set('.sticky-window', elements.get('#sticky-settings-panel'));
const initial = {title: "Original", richHtml: "<p>Original</p>", color: "yellow"};
let held, poll, reads = 0;
const context = {
  document: {documentElement: {dataset: {}}, title: "", addEventListener() {},
    querySelector(selector) { return elements.get(selector); }},
  window: {addEventListener() {}, ZETER_RICH_TEXT_UTILS: {
    cleanRichHtml: value => value, plainToRichHtml: value => value
  }, pywebview: {api: {get_snapshot() {
    reads++;
    return reads === 1 ? Promise.resolve({ok: true, snapshot: initial})
      : new Promise(resolve => { held = resolve; });
  }}}},
  setInterval(callback) { poll = callback; return 1; }, clearInterval() {},
  setTimeout() { return 1; }, clearTimeout() {}
};
async function flush() { for (let index = 0; index < 10; index++) await Promise.resolve(); }
(async () => {
  context.window.ZETER_CORE_UTILS = {clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),escapeHtml:String};
  context.window.ZETER_WINDOW_METRICS_UTILS = {topMenuHeight:()=>0,taskbarSpace:()=>0};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(require('node:path').dirname(process.argv[2]),'core/sticky-utils.js'),'utf8'), context);
  vm.runInContext(fs.readFileSync(require("node:path").join(require("node:path").dirname(process.argv[2]),"core/dialog-utils.js"),"utf8"), context);
  vm.runInContext(source, context);
  await flush();
  const title = elements.get("#sticky-title"), editor = elements.get("#sticky-editor");
  assert.equal(title.value, "Original");
  assert.equal(editor.contentEditable, "true");
  poll(); // The clean-window poll now waits for its main-window snapshot.
  assert.equal(typeof held, "function");
  assert.equal(await context.window.ZETER_STICKY_WINDOW.prepareClose(), true);
  assert.equal(title.disabled, true);
  assert.equal(editor.contentEditable, "false");
  held({ok: true, snapshot: {...initial, title: "Late parent edit", richHtml: "<p>Late</p>"}});
  await flush();
  assert.equal(title.disabled, true, "late poll must not enable title during main-close ACK");
  assert.equal(editor.contentEditable, "false", "late poll must not enable editor during main-close ACK");
  assert.equal(title.value, "Original", "late poll must not replace frozen title");
  assert.equal(editor.innerHTML, "<p>Original</p>", "late poll must not replace frozen editor");
  context.window.ZETER_STICKY_WINDOW.cancelClose();
  assert.equal(title.disabled, false);
  assert.equal(editor.contentEditable, "true");
  console.log("sticky child poll/prepareClose race: PASS");
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
    result = subprocess.run([node, "-", str(root / "app/js/sticky-window.js")], input=script,
                            text=True, encoding="utf-8", capture_output=True, timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    print(result.stdout.strip())


class Event:
    def __init__(self):
        self.handlers = []

    def __iadd__(self, handler):
        self.handlers.append(handler)
        return self

    def emit(self):
        return [handler() for handler in self.handlers]


class Child:
    def __init__(self, api):
        self.api = api
        self.events = type("Events", (), {"closed": Event(), "closing": Event()})()
        self.destroyed = False
        self.restored = False
        self.shown = False
        self.close_checked = threading.Event()
        self.prepare_allowed = True
        self.close_cancelled = threading.Event()

    def destroy(self):
        if False in self.events.closing.emit():
            return
        self.destroyed = True
        self.events.closed.emit()

    def restore(self):
        self.restored = True

    def show(self):
        self.shown = True

    def evaluate_js(self, script, callback=None):
        if "prepareClose()" in script:
            callback(self.prepare_allowed)
            return
        if "cancelClose()" in script:
            self.close_cancelled.set()
            return
        assert "requestClose()" in script and callback is None
        self.close_checked.set()
        return True


class Webview:
    def __init__(self):
        self.windows = []

    def create_window(self, title, url, **options):
        assert url == "http://127.0.0.1:1234/sticky-window.html"
        assert options["min_size"] == (280, 240)
        child = Child(options["js_api"])
        self.windows.append(child)
        return child


class Main:
    def __init__(self):
        self.snapshot = {"workspaceId": "desktop_1", "stickyId": "note_1", "title": "Заметка", "richHtml": "<p>Исходный текст</p>", "color": "yellow"}
        self.scripts = []
        self.mode = "ok"
        self.neighbor = {"title": "Сосед", "richHtml": "Не менять"}
        self.destroyed = threading.Event()
        self.close_handler = None
        self.prepare_allowed = True
        self.close_checks = 0
        self.close_cancelled = threading.Event()

    def destroy(self):
        if self.close_handler:
            self.close_handler()
        self.destroyed.set()

    def evaluate_js(self, script, callback=None):
        self.scripts.append(script)
        if "api.prepareClose()" in script:
            self.close_checks += 1
            if self.mode == "timeout":
                return
            if self.mode == "raise":
                raise RuntimeError("PRIVATE close exception")
            callback(self.prepare_allowed)
            return
        if "ZETER_STICKY_NATIVE.cancelClose()" in script:
            self.close_cancelled.set()
            return
        match = re.search(r"return api\.(snapshot|save|action)\(JSON.parse\((.+)\)\);", script)
        assert match
        method, encoded = match.groups()
        payload = json.loads(json.loads(encoded))
        if self.mode == "raise":
            raise RuntimeError("PRIVATE exception")
        if self.mode == "timeout":
            return
        if self.mode == "malformed":
            callback(None)
            return
        if self.mode == "failure":
            callback({"ok": False, "error": "Стикер удалён"})
            return
        if method == "save":
            if payload["expectedTitle"] != self.snapshot["title"] or payload["expectedRichHtml"] != self.snapshot["richHtml"]:
                callback({"ok": False, "error": "Заметка изменена в другом окне"})
                return
            self.snapshot.update(title=payload["title"], richHtml=payload["richHtml"])
            if "appearance" in payload:
                self.snapshot["appearance"] = payload["appearance"]
        if method == "action":
            self.last_action = payload["action"]
            callback({"ok": True})
            return
        callback({"ok": True, "snapshot": dict(self.snapshot)})

    def restore(self):
        self.restored = True

    def show(self):
        self.shown = True


def main():
    # Import only sticky_windows: no NativeStorageApi constructor or state paths.
    # Launcher syntax is read and parsed, never imported or started by this test.
    root = Path(__file__).resolve().parents[1]
    ast.parse((root / "run_zeter_os.py").read_text(encoding="utf-8-sig"))
    check_poll_during_close(root)
    parent, view = Main(), Webview()
    manager = StickyWindows(parent, view, "http://127.0.0.1:1234", ack_timeout=.001)
    ids = {"workspaceId": "desktop_1", "stickyId": "note_1"}
    assert manager.open(ids) == {"ok": True, "reused": False}
    child = view.windows[0]
    assert set(name for name in dir(child.api) if not name.startswith("_")) == {"get_snapshot", "save_sticky", "perform_action", "close_window"}
    assert manager.open(ids) == {"ok": True, "reused": True}
    assert len(view.windows) == 1 and child.restored and child.shown
    malicious = '</script><img src=x onerror="alert(1)">\u2028");window.arbitrary(); // Русский'
    payload = {"title": malicious, "richHtml": '<p data-managed-file-inline="file_1">' + malicious + '</p>', "expectedTitle": "Заметка", "expectedRichHtml": "<p>Исходный текст</p>"}
    assert child.api.save_sticky(payload)["ok"] is True
    assert parent.snapshot["title"] == malicious
    assert malicious not in parent.scripts[-1] and "window.arbitrary();" not in parent.scripts[-1].split("JSON.parse(")[0]
    assert parent.neighbor == {"title": "Сосед", "richHtml": "Не менять"}
    assert child.api.save_sticky(payload)["ok"] is False  # stale editor
    appearance = {"color": "teal", "textColor": "dark", "fontSize": 18, "opacity": .85}
    updated = {**payload, "expectedTitle": malicious, "expectedRichHtml": payload["richHtml"], "appearance": appearance, "expectedAppearance": appearance}
    assert child.api.save_sticky(updated)["ok"] is True
    for invalid in [{**updated, "appearance": {**appearance, "opacity": False}}, {**updated, "appearance": {**appearance, "color": []}}, {**updated, "appearance": {**appearance, "fontSize": 999}}]:
        assert child.api.save_sticky(invalid)["ok"] is False
    for action in ("library", "desktop", "delete"):
        assert child.api.perform_action({"action": action})["ok"] is True
        assert parent.last_action == action and parent.restored and parent.shown
    for invalid in (None, {}, {"action": []}, {"action": "delete", "state": {}}, {"action": "eval"}):
        assert child.api.perform_action(invalid)["ok"] is False
    parent.mode = "failure"
    assert child.api.perform_action({"action": "delete"})["ok"] is False and not child.destroyed
    parent.mode = "ok"
    for invalid in [None, {}, {**payload, "state": {}}, {**payload, "title": "\ud800"}, {**payload, "richHtml": "\x00"}]:
        assert child.api.save_sticky(invalid)["ok"] is False
    for invalid in [None, {}, {**ids, "stickyId": "../note"}, {**ids, "extra": "x"}]:
        assert manager.open(invalid)["ok"] is False
    for mode in ["raise", "timeout", "malformed", "failure"]:
        parent.mode = mode
        result = child.api.get_snapshot()
        assert result["ok"] is False and "PRIVATE" not in str(result)
    parent.mode = "ok"
    before = dict(parent.snapshot)
    assert child.api.close_window()["ok"] is True and child.destroyed
    assert parent.snapshot == before and not manager._children
    assert manager.open(ids)["reused"] is False
    manager.close_all()
    assert view.windows[-1].destroyed and parent.snapshot == before
    assert manager.open(ids)["ok"] is False
    # Main close is cancelled synchronously, then proceeds only after child ACK.
    parent, view = Main(), Webview()
    manager = StickyWindows(parent, view, "http://127.0.0.1:1234", ack_timeout=.01)
    assert manager.open(ids)["ok"]
    parent.close_handler = manager.close_all
    assert manager.can_close_main() is False
    assert parent.destroyed.wait(1) and view.windows[0].destroyed
    assert parent.close_checks == 1
    assert manager.can_close_main() is True
    parent, view = Main(), Webview()
    manager = StickyWindows(parent, view, "http://127.0.0.1:1234", ack_timeout=.01)
    assert manager.open(ids)["ok"]
    view.windows[0].prepare_allowed = False
    assert manager.can_close_main() is False
    assert view.windows[0].close_cancelled.wait(1)
    assert parent.close_cancelled.is_set()
    assert not parent.destroyed.is_set() and not view.windows[0].destroyed
    assert parent.snapshot["richHtml"] == "<p>Исходный текст</p>"
    # Main sticker forms are guarded even without any detached child window.
    parent, view = Main(), Webview()
    manager = StickyWindows(parent, view, "http://127.0.0.1:1234", ack_timeout=.01)
    parent.close_handler = manager.close_all
    assert manager.can_close_main() is False
    assert parent.destroyed.wait(1) and parent.close_checks == 1
    for mode in ["refused", "timeout", "raise"]:
        parent, view = Main(), Webview()
        manager = StickyWindows(parent, view, "http://127.0.0.1:1234", ack_timeout=.001)
        parent.prepare_allowed = False
        parent.mode = mode
        assert manager.can_close_main() is False
        assert parent.close_cancelled.wait(1)
        assert parent.close_checks == 1 and not parent.destroyed.is_set()
    print("sticky windows: PASS (isolated bridge, create/reuse/close, text as data, stale save, failures, main-close ACK/refusal, no state writes)")


if __name__ == "__main__":
    main()
