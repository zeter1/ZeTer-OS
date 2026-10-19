"""Generate/check the upload-last integrity manifest; no network or user state."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from build_ucoz import collect_app, validate_resources, validate_ucoz_paths
from build_release import ReleaseBuildError, read_project_version

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_NAME = "web-release.json"


def render_manifest(root: Path) -> bytes:
    files = collect_app(root)
    files.pop(MANIFEST_NAME, None)
    validate_resources(files)
    validate_ucoz_paths(files)
    if "js/web-bootstrap.js" not in files:
        raise ReleaseBuildError("Нет раннего web-bootstrap.js")
    html = files["index.html"].decode("utf-8-sig")
    app_scripts = re.findall(r'<script\b[^>]*src="(js/(?:core/[^\"]+|app\.js))"[^>]*>', html)
    gated_scripts = re.findall(r'<script\b[^>]*type="application/zeter-script"[^>]*src="(js/(?:core/[^\"]+|app\.js))"[^>]*>', html)
    if not app_scripts or app_scripts != gated_scripts:
        raise ReleaseBuildError("Скрипты приложения должны запускаться только после проверки полного кэша")
    if len(files) > 1000 or sum(map(len, files.values())) > 200 * 1024 * 1024:
        raise ReleaseBuildError("Превышен размер веб-комплекта")
    entries = [{"path": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
               for name, data in sorted(files.items())]
    identity = json.dumps(entries, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    manifest = {"schema": 1, "runtime": 1, "version": read_project_version(root),
                "build": hashlib.sha256(identity).hexdigest(), "files": entries}
    return (json.dumps(manifest, ensure_ascii=True, indent=2) + "\n").encode("utf-8")


def check_manifest(root: Path) -> bool:
    path = root / "app" / MANIFEST_NAME
    return path.is_file() and not path.is_symlink() and path.read_bytes() == render_manifest(root)


def main() -> int:
    parser = argparse.ArgumentParser(description="Подготовка app для прямой загрузки на uCoz.")
    parser.add_argument("--write", action="store_true", help="Обновить только app/web-release.json")
    args = parser.parse_args()
    try:
        expected = render_manifest(PROJECT_ROOT)
        target = PROJECT_ROOT / "app" / MANIFEST_NAME
        if args.write:
            # collect_app rejects symlinks/junctions before any mutation.
            if not target.exists() or target.read_bytes() != expected:
                temp = target.with_suffix(".json.tmp")
                if temp.exists() or temp.is_symlink():
                    raise ReleaseBuildError("Служебный временный файл уже существует; проверьте app/web-release.json.tmp")
                with temp.open("xb") as output:
                    output.write(expected)
                # On failure preserve both the old manifest and the candidate.
                # Never remove a temp file that another concurrent call owns.
                temp.replace(target)
        if not target.is_file() or target.read_bytes() != expected:
            print("STALE: выполните prepare_web.cmd перед загрузкой app на сайт.")
            return 1
        value = json.loads(expected)
        print(f"WEB READY: {value['version']}; files={len(value['files'])}; build={value['build']}")
        print("Загрузите содержимое app; web-release.json — ПОСЛЕДНИМ. Папки сохраняются.")
        return 0
    except (OSError, ValueError, ReleaseBuildError) as error:
        print(f"WEB ERROR: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
