"""PyInstaller runtime smoke-test hook for ZeTer OS.

Normal startup is untouched. ``--self-test`` exits before the GUI opens and
verifies the frozen Python runtime plus the web assets that must sit next to
ZeTer-OS.exe in the portable ONEDIR build.
"""

from __future__ import annotations

import sys
from pathlib import Path


def run_packaged_self_test() -> int:
    root = Path(sys.executable).resolve().parent
    required = (
        root / "app" / "index.html",
        root / "app" / "manifest.json",
        root / "app" / "service-worker.js",
        root / "app" / "js" / "core" / "version.js",
    )
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError("Packaged ZeTer OS web assets are missing: " + ", ".join(missing))

    import webview  # noqa: F401 - import itself validates pywebview packaging
    import problem_logs  # noqa: F401 - validate the native launcher dependency

    index = required[0].read_text(encoding="utf-8")
    if not index.strip() or "<html" not in index.lower():
        raise RuntimeError("Packaged app/index.html is empty or invalid.")

    print(f"packaged self-test: ok | root={root} | assets={len(required)}")
    return 0


if "--self-test" in sys.argv:
    raise SystemExit(run_packaged_self_test())
