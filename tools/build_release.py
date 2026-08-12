from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "ZeTer OS"
FIXED_ZIP_TIMESTAMP = (2020, 1, 1, 0, 0, 0)
RELEASE_ROOT_FILES = (
    "README_PYTHON.md",
    "requirements.txt",
    "run_zeter_os.py",
    "start_zeter_os.cmd",
)
REQUIRED_RELEASE_FILES = (
    *RELEASE_ROOT_FILES,
    "app/index.html",
    "app/manifest.json",
    "app/service-worker.js",
    "app/js/core/version.js",
)
ROOT_EXCLUDED_PARTS = frozenset(
    {
        ".agents",
        ".codex",
        ".git",
        "build",
        "data",
        "dist",
        "docs",
        "tools",
        "work",
    }
)
EXCLUDED_PARTS = frozenset(
    {
        ".agents",
        ".codex",
        ".git",
        ".idea",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".temp",
        ".tmp",
        ".vscode",
        "__pycache__",
        "coverage",
        "htmlcov",
        "logs",
        "playwright-report",
        "temp",
        "test",
        "test-results",
        "tests",
        "tmp",
    }
)
EXCLUDED_NAMES = frozenset(
    {
        ".coverage",
        ".ds_store",
        ".gitignore",
        "desktop.ini",
        "thumbs.db",
    }
)
EXCLUDED_SUFFIXES = frozenset({".bak", ".log", ".pyc", ".pyo", ".tmp"})


class ReleaseBuildError(RuntimeError):
    """A safe, user-facing release build failure."""


@dataclass(frozen=True)
class ReleaseEntry:
    source: Path
    relative: PurePosixPath
    data: bytes

    @property
    def archive_name(self) -> str:
        return f"{ARCHIVE_ROOT}/{self.relative.as_posix()}"


@dataclass(frozen=True)
class ReleaseBuildResult:
    archive_path: Path
    version: str
    sha256: str
    file_count: int
    source_bytes: int
    archive_bytes: int


def is_forbidden_release_path(relative: PurePosixPath) -> bool:
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        return True
    parts = tuple(part.casefold() for part in relative.parts if part != ".")
    if not parts or parts[0] in ROOT_EXCLUDED_PARTS:
        return True
    if any(part in EXCLUDED_PARTS for part in parts):
        return True
    name = parts[-1]
    if name in EXCLUDED_NAMES or name == ".env" or name.startswith(".env."):
        return True
    if PurePosixPath(name).suffix.casefold() in EXCLUDED_SUFFIXES:
        return True
    if name.startswith("test_") or ".test." in name or ".spec." in name:
        return True
    return False


def _is_link_like(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def _ensure_source_file(path: Path, project_root: Path) -> bytes:
    if _is_link_like(path):
        raise ReleaseBuildError(f"Символические ссылки и junction не допускаются: {path}")
    if not path.is_file():
        raise ReleaseBuildError(f"Ожидался обычный файл: {path}")
    try:
        path.resolve(strict=True).relative_to(project_root)
    except ValueError as exc:
        raise ReleaseBuildError(f"Файл выходит за пределы проекта: {path}") from exc

    before = path.stat()
    data = path.read_bytes()
    after = path.stat()
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
        raise ReleaseBuildError(f"Файл изменился во время сборки, повторите запуск: {path}")
    return data


def read_project_version(project_root: Path) -> str:
    version_file = project_root / "app" / "js" / "core" / "version.js"
    try:
        source = version_file.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ReleaseBuildError(f"Не удалось прочитать версию: {exc}") from exc
    match = re.search(r"ZETER_OS_VERSION\s*=\s*['\"]([^'\"]+)['\"]", source)
    if not match:
        raise ReleaseBuildError("В app/js/core/version.js не найдена версия ZeTer OS.")
    version = match.group(1).strip()
    if not re.fullmatch(r"\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?", version):
        raise ReleaseBuildError(f"Недопустимый формат версии для имени ZIP: {version!r}")
    return version


def collect_release_entries(project_root: Path) -> list[ReleaseEntry]:
    root = project_root.resolve(strict=True)
    missing = [relative for relative in REQUIRED_RELEASE_FILES if not (root / relative).is_file()]
    if missing:
        raise ReleaseBuildError("Не хватает обязательных файлов: " + ", ".join(missing))

    app_root = root / "app"
    if _is_link_like(app_root) or not app_root.is_dir():
        raise ReleaseBuildError("Папка app должна быть обычной папкой внутри проекта.")

    candidates = [root / relative for relative in RELEASE_ROOT_FILES]
    candidates.extend(path for path in app_root.rglob("*") if path.is_file() or _is_link_like(path))

    entries: list[ReleaseEntry] = []
    seen: set[str] = set()
    for source in candidates:
        relative_path = source.relative_to(root)
        relative = PurePosixPath(relative_path.as_posix())
        if is_forbidden_release_path(relative):
            continue
        key = relative.as_posix()
        if key in seen:
            raise ReleaseBuildError(f"Повторяющийся путь релиза: {key}")
        seen.add(key)
        entries.append(
            ReleaseEntry(
                source=source,
                relative=relative,
                data=_ensure_source_file(source, root),
            )
        )

    included = {entry.relative.as_posix() for entry in entries}
    omitted_required = [relative for relative in REQUIRED_RELEASE_FILES if relative not in included]
    if omitted_required:
        raise ReleaseBuildError(
            "Обязательные файлы были исключены правилами сборки: " + ", ".join(omitted_required)
        )
    return sorted(entries, key=lambda entry: entry.relative.as_posix())


def _zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(filename=name, date_time=FIXED_ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = (0o100644 & 0xFFFF) << 16
    info.flag_bits |= 0x800
    return info


def write_release_archive(archive_path: Path, entries: Iterable[ReleaseEntry]) -> None:
    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        allowZip64=True,
    ) as archive:
        for entry in entries:
            archive.writestr(_zip_info(entry.archive_name), entry.data, compresslevel=9)
    with archive_path.open("r+b") as handle:
        handle.flush()
        os.fsync(handle.fileno())


def validate_release_archive(archive_path: Path, entries: list[ReleaseEntry]) -> None:
    expected = {entry.archive_name: entry for entry in entries}
    with zipfile.ZipFile(archive_path, "r") as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise ReleaseBuildError("В ZIP обнаружены повторяющиеся пути.")
        if set(names) != set(expected):
            missing = sorted(set(expected) - set(names))
            extra = sorted(set(names) - set(expected))
            raise ReleaseBuildError(f"Состав ZIP не совпал с планом: missing={missing}, extra={extra}")
        for info in infos:
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts:
                raise ReleaseBuildError(f"Небезопасный путь внутри ZIP: {info.filename}")
            if len(path.parts) < 2 or path.parts[0] != ARCHIVE_ROOT:
                raise ReleaseBuildError(f"Файл находится вне корня {ARCHIVE_ROOT}: {info.filename}")
            relative = PurePosixPath(*path.parts[1:])
            if is_forbidden_release_path(relative):
                raise ReleaseBuildError(f"В ZIP попал запрещённый путь: {relative}")
            if info.file_size != len(expected[info.filename].data):
                raise ReleaseBuildError(f"Размер файла в ZIP не совпал: {info.filename}")
            if info.date_time != FIXED_ZIP_TIMESTAMP:
                raise ReleaseBuildError(f"Непредсказуемая дата файла в ZIP: {info.filename}")
        broken = archive.testzip()
        if broken:
            raise ReleaseBuildError(f"Проверка CRC не прошла для файла: {broken}")

    launcher = next(entry for entry in entries if entry.relative.as_posix() == "run_zeter_os.py")
    try:
        compile(launcher.data.decode("utf-8-sig"), launcher.relative.as_posix(), "exec")
    except (SyntaxError, UnicodeError) as exc:
        raise ReleaseBuildError(f"run_zeter_os.py в релизе не компилируется: {exc}") from exc

    with tempfile.TemporaryDirectory(prefix="zeter-release-check-") as temp_dir:
        probe_root = Path(temp_dir) / "Проверка релиза ZeTer OS"
        extract_root = probe_root / "Распакованная сборка"
        probe_root.mkdir(parents=True)
        copied_archive = probe_root / archive_path.name
        shutil.copyfile(archive_path, copied_archive)
        with zipfile.ZipFile(copied_archive, "r") as archive:
            archive.extractall(extract_root)
        for entry in entries:
            extracted = extract_root / Path(*PurePosixPath(entry.archive_name).parts)
            if not extracted.is_file() or extracted.read_bytes() != entry.data:
                raise ReleaseBuildError(f"Распакованный файл не совпал с исходным: {entry.archive_name}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prepare_output_dir(project_root: Path, output_dir: Path) -> Path:
    root = project_root.resolve(strict=True)
    candidate = output_dir if output_dir.is_absolute() else root / output_dir
    resolved = candidate.resolve(strict=False)
    for protected in (root / "app", root / "data"):
        protected = protected.resolve(strict=False)
        if resolved == protected or protected in resolved.parents:
            raise ReleaseBuildError(f"Нельзя создавать релиз внутри {protected}.")
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def build_release(project_root: Path, output_dir: Path) -> ReleaseBuildResult:
    root = project_root.resolve(strict=True)
    version = read_project_version(root)
    entries = collect_release_entries(root)
    destination = _prepare_output_dir(root, output_dir)
    archive_name = f"ZeTer_OS_{version}_portable.zip"
    final_path = destination / archive_name
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f".{archive_name}.",
        suffix=".tmp",
        dir=destination,
    )
    os.close(descriptor)
    temp_path = Path(temp_name)
    try:
        write_release_archive(temp_path, entries)
        validate_release_archive(temp_path, entries)
        digest = sha256_file(temp_path)
        archive_bytes = temp_path.stat().st_size
        os.replace(temp_path, final_path)
    finally:
        temp_path.unlink(missing_ok=True)

    return ReleaseBuildResult(
        archive_path=final_path,
        version=version,
        sha256=digest,
        file_count=len(entries),
        source_bytes=sum(len(entry.data) for entry in entries),
        archive_bytes=archive_bytes,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Создать чистый проверенный ZIP-релиз ZeTer OS без пользовательских данных."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("dist"),
        help="Каталог результата; относительный путь считается от корня проекта (по умолчанию dist).",
    )
    args = parser.parse_args(argv)
    try:
        result = build_release(PROJECT_ROOT, args.output_dir)
    except (ReleaseBuildError, OSError, zipfile.BadZipFile) as exc:
        print(f"Ошибка сборки: {exc}", file=sys.stderr)
        return 1

    print("Чистый релиз ZeTer OS создан и проверен.")
    print(f"Архив: {result.archive_path}")
    print(f"Версия: {result.version}")
    print(f"Файлов: {result.file_count}")
    print(f"Размер ZIP: {result.archive_bytes} байт")
    print(f"SHA-256: {result.sha256}")
    print("Пользовательская папка data, логи и служебные файлы в архив не включены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
