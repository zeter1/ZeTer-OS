"""Hermetic delivery-contract test: no API construction, app data, registry or PowerShell."""
from __future__ import annotations

import base64
import json
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_zeter_os as zeter  # Inert import; no NativeStorageApi construction.


def main() -> None:
    payload = {"title": 'Тест <&> "$(код)" 🦊', "text": "Русский текст\nВторая строка"}
    marker = subprocess.CompletedProcess([], 0, stdout=b"SUBMITTED", stderr=b"")
    with patch.object(zeter.subprocess, "run", return_value=marker) as run:
        assert zeter.show_windows_notification(payload) == {"ok": True, "submitted": True}
        args, options = run.call_args
        assert Path(args[0][0]).is_absolute()
        assert "-NoProfile" in args[0] and "-NonInteractive" in args[0]
        source = base64.b64decode(args[0][-1]).decode("utf-16-le")
        assert source == zeter._WINDOWS_NOTIFICATION_SCRIPT and payload["title"] not in source
        assert json.loads(options["input"])["title"] == payload["title"]
        assert options["timeout"] == 8 and options["creationflags"] == subprocess.CREATE_NO_WINDOW
        assert "shell" not in options
        for invalid in [None, {}, {**payload, "command": "x"}, {**payload, "title": ""},
                        {**payload, "text": "\x00"}, {**payload, "text": "\ud800"},
                        {**payload, "text": "x" * 2001}, {**payload, "title": 3}]:
            assert zeter.show_windows_notification(invalid)["code"] == "invalid_payload"
        assert run.call_count == 1
        for result, code in [(subprocess.CompletedProcess([], 0, b"", b"private"), "delivery_failed"),
                             (subprocess.CompletedProcess([], 1, b"SUBMITTED", b"private"), "delivery_failed"),
                             (subprocess.CompletedProcess([], 2, b"BLOCKED", b"private"), "blocked")]:
            run.return_value = result
            response = zeter.show_windows_notification(payload)
            assert response["code"] == code and "private" not in str(response)
        for failure, code in [(subprocess.TimeoutExpired("private", 8, output=b"private"), "timeout"),
                              (PermissionError("private"), "access_denied"),
                              (OSError("private"), "delivery_failed")]:
            run.side_effect = failure
            response = zeter.show_windows_notification(payload)
            assert response["code"] == code and "private" not in str(response)
        run.side_effect = None; run.return_value = marker
        assert zeter.show_windows_notification(payload)["submitted"] is True
        zeter._WINDOWS_NOTIFICATION_LOCK.acquire()
        try:
            before = run.call_count
            assert zeter.show_windows_notification(payload)["code"] == "busy"
            assert run.call_count == before
        finally:
            zeter._WINDOWS_NOTIFICATION_LOCK.release()
    print("system notifications native: PASS (validation, stdin, fixed code, outcomes, timeout, lock, privacy)")


if __name__ == "__main__":
    if sys.platform == "win32":
        main()
    else:
        assert zeter.show_windows_notification({"title": "Test", "text": ""})["code"] == "unsupported"
        print("system notifications native: PASS (unsupported platform)")
