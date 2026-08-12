from __future__ import annotations

import hashlib
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from build_release import (
    ARCHIVE_ROOT,
    ReleaseBuildError,
    build_release,
    is_forbidden_release_path,
)


def write_fixture(path: Path, content: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        path.write_bytes(content)
    else:
        path.write_text(content, encoding="utf-8", newline="\n")


def make_project(root: Path) -> None:
    write_fixture(root / "README_PYTHON.md", "# ZeTer OS\n")
    write_fixture(root / "requirements.txt", "pywebview>=5.0\n")
    write_fixture(root / "run_zeter_os.py", "print('ZeTer OS')\n")
    write_fixture(root / "start_zeter_os.cmd", b"@echo off\r\npython run_zeter_os.py\r\n")
    write_fixture(root / "app" / "index.html", "<!doctype html><title>ZeTer OS</title>\n")
    write_fixture(root / "app" / "manifest.json", '{"name":"ZeTer OS"}\n')
    write_fixture(root / "app" / "service-worker.js", 'const ZETER_CACHE = "zeter-os-9.87";\n')
    write_fixture(root / "app" / "js" / "core" / "version.js", 'window.ZETER_OS_VERSION = "9.87";\n')
    write_fixture(root / "app" / "assets" / "значок теста.txt", "portable asset\n")

    write_fixture(root / "data" / "private.txt", "USER DATA MUST NOT LEAK\n")
    write_fixture(root / "data" / "logs" / "zeter-os.log", "PRIVATE LOG\n")
    write_fixture(root / ".git" / "config", "PRIVATE GIT DATA\n")
    write_fixture(root / ".codex" / "state.json", "PRIVATE CODEX DATA\n")
    write_fixture(root / ".agents" / "notes.txt", "PRIVATE AGENT DATA\n")
    write_fixture(root / "tools" / "test-artifact.txt", "DEV TOOL\n")
    write_fixture(root / "app" / "__pycache__" / "leak.pyc", b"compiled")
    write_fixture(root / "app" / "tests" / "fixture.js", "throw new Error('test only');\n")
    write_fixture(root / "app" / "logs" / "debug.log", "debug\n")
    write_fixture(root / "app" / "temp" / "scratch.tmp", "temporary\n")


def archive_names(path: Path) -> set[str]:
    with zipfile.ZipFile(path, "r") as archive:
        assert archive.testzip() is None
        return set(archive.namelist())


def main() -> None:
    assert is_forbidden_release_path(PurePosixPath("data/private.txt"))
    assert is_forbidden_release_path(PurePosixPath("app/__pycache__/leak.pyc"))
    assert is_forbidden_release_path(PurePosixPath("app/tests/fixture.js"))
    assert not is_forbidden_release_path(PurePosixPath("app/assets/значок теста.txt"))

    with tempfile.TemporaryDirectory(prefix="zeter-release-smoke-") as temp_dir:
        temp_root = Path(temp_dir)
        project_root = temp_root / "Проект ZeTer OS"
        make_project(project_root)

        first = build_release(project_root, temp_root / "Первая сборка")
        second = build_release(project_root, temp_root / "Вторая сборка")
        first_bytes = first.archive_path.read_bytes()
        second_bytes = second.archive_path.read_bytes()
        assert first_bytes == second_bytes
        assert hashlib.sha256(first_bytes).hexdigest() == first.sha256 == second.sha256

        names = archive_names(first.archive_path)
        assert f"{ARCHIVE_ROOT}/app/assets/значок теста.txt" in names
        assert f"{ARCHIVE_ROOT}/run_zeter_os.py" in names
        lowered = {name.casefold() for name in names}
        for marker in ("/data/", "/.git/", "/.codex/", "/.agents/", "/__pycache__/", "/tests/"):
            assert all(marker not in f"/{name}" for name in lowered)
        assert all(not name.endswith((".pyc", ".log", ".tmp")) for name in lowered)
        assert first.file_count == len(names)

        published_before_failure = first.archive_path.read_bytes()
        (project_root / "app" / "index.html").unlink()
        try:
            build_release(project_root, first.archive_path.parent)
        except ReleaseBuildError:
            pass
        else:
            raise AssertionError("missing required runtime file did not stop release build")
        assert first.archive_path.read_bytes() == published_before_failure

    print("release builder smoke passed: deterministic ZIP, exclusions, extraction and safe publish")


if __name__ == "__main__":
    main()
