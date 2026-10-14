"""Fixed-repository, manifest-owned portable Windows updates.

Importing this module does not create directories, launch processes or read user state.
All writable paths are supplied by the launcher; the helper uses the same validators.
"""
from __future__ import annotations

import contextlib
import ctypes
import hashlib
import json
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid
import zipfile
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MANIFEST = "zeter-update.json"
REPOSITORY = "zeter1/ZeTer-OS"
FEED_URL = "https://zeter1.github.io/ZeTer-OS/updates.json"
MAX_FEED = 64 * 1024
PLATFORM = "windows-x64"
LAYOUT = "flat-onedir"
EXE = "ZeTer-OS.exe"
HELPER = "ZeTer-OS-Updater.exe"
MAX_ARCHIVE = 512 * 1024 * 1024
MAX_EXPANDED = 2 * 1024 * 1024 * 1024
MAX_FILES = 15000
MAX_JSON = 8 * 1024 * 1024
VERSION_RE = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\Z")
ASSET_RE = re.compile(r"ZeTer-OS-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-Windows-x64\.zip\Z")
SHA_RE = re.compile(r"[a-f0-9]{64}\Z")
PROTECTED = {"data", "логи проблем", ".git", ".agents", ".codex", ".aws", "build", "dist", ".build-venv", "__pycache__", "logs", "work", "workspace"}
DEVICE_RE = re.compile(r"(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?\Z", re.I)


class UpdateError(RuntimeError):
    def __init__(self, message: str, retry_after: int | None = None, *, http_status: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after
        self.http_status = http_status


def version_tuple(version: str) -> tuple[int, int, int]:
    if not isinstance(version, str) or len(version) > 40 or not VERSION_RE.fullmatch(version):
        raise UpdateError("Некорректная версия пакета обновления.")
    return tuple(map(int, version.split(".")))


def read_version(root: Path) -> str:
    text = (root / "app/js/core/version.js").read_text(encoding="utf-8")
    match = re.search(r'window\.ZETER_OS_VERSION\s*=\s*["\']([^"\']+)["\']', text)
    if not match:
        raise UpdateError("Не найдена версия программы.")
    version_tuple(match[1])
    return match[1]


def safe_name(name: str, *, manifest: bool = False) -> str:
    if not isinstance(name, str) or not name or len(name) > 220 or "\\" in name or ":" in name or name.startswith("/"):
        raise UpdateError("Небезопасный путь в пакете обновления.")
    parts = name.split("/")
    if any(p in {"", ".", ".."} or "~" in p or p.endswith((" ", ".")) or DEVICE_RE.fullmatch(p) or any(ord(c) < 32 or ord(c) == 127 or c in '<>"|?*' for c in p) for p in parts):
        raise UpdateError("Небезопасное имя файла обновления.")
    if parts[0].casefold() in PROTECTED or (name.casefold() == MANIFEST and not manifest):
        raise UpdateError("Обновление затрагивает защищённый каталог.")
    return name


def plain_path(root: Path, path: Path) -> Path:
    """Reject symlinks/junctions at every existing ancestor, including root parents."""
    root, path = Path(os.path.abspath(root)), Path(os.path.abspath(path))
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise UpdateError("Путь обновления выходит за пределы установки.") from exc
    for current in [path, *path.parents]:
        try:
            info = current.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise UpdateError("Обновление через ссылку или junction запрещено.")
    return path


def file_record(path: Path) -> dict:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return {"size": size, "sha256": digest.hexdigest()}


def verify_file(root: Path, name: str, expected: dict) -> Path:
    path = plain_path(root, root / safe_name(name, manifest=name == MANIFEST))
    return verify_record(root, path, expected)


def verify_record(root: Path, path: Path, expected: dict) -> Path:
    path = plain_path(root, path)
    if not path.is_file() or file_record(path) != expected:
        raise UpdateError("Файл программы отсутствует или изменён: " + path.name)
    return path


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise UpdateError("Повторяющееся поле JSON обновления.")
        result[key] = value
    return result


def parse_json(content: bytes, limit: int = MAX_JSON):
    if len(content) > limit:
        raise UpdateError("Слишком большой JSON обновления.")
    try:
        return json.loads(content.decode("utf-8"), object_pairs_hook=_unique_json)
    except (UnicodeError, ValueError) as exc:
        raise UpdateError("Повреждён JSON обновления.") from exc


def validate_manifest(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) != {"schema", "version", "platform", "layout", "files"} or type(value["schema"]) is not int or value["schema"] != 1 or value["platform"] != PLATFORM or value["layout"] != LAYOUT:
        raise UpdateError("Неподдерживаемый манифест обновления.")
    version_tuple(value["version"])
    files = value["files"]
    if not isinstance(files, dict) or not 1 <= len(files) <= MAX_FILES:
        raise UpdateError("Некорректный список файлов обновления.")
    folded = set()
    total = 0
    for name, record in files.items():
        safe_name(name)
        key = name.casefold()
        if key in folded:
            raise UpdateError("Имена файлов отличаются только регистром.")
        folded.add(key)
        if not isinstance(record, dict) or set(record) != {"size", "sha256"} or type(record["size"]) is not int or not 0 <= record["size"] <= MAX_EXPANDED or not isinstance(record["sha256"], str) or not SHA_RE.fullmatch(record["sha256"]):
            raise UpdateError("Некорректная контрольная сумма файла.")
        total += record["size"]
    if total > MAX_EXPANDED:
        raise UpdateError("Превышен размер распакованного обновления.")
    for key in folded:
        if any("/".join(key.split("/")[:i]) in folded for i in range(1, len(key.split("/")))):
            raise UpdateError("Конфликт файла и каталога обновления.")
    for required in (EXE, HELPER, "app/index.html", "app/update-probe.html", "app/js/update-probe.js", "app/js/core/version.js"):
        if required not in files:
            raise UpdateError("В пакете отсутствует обязательный файл: " + required)
    return value


def read_manifest(root: Path) -> dict:
    path = plain_path(root, root / MANIFEST)
    if not path.is_file() or path.stat().st_size > MAX_JSON:
        raise UpdateError("Для этой установки отсутствует манифест; распакуйте новую полную сборку отдельно.")
    return validate_manifest(parse_json(path.read_bytes()))


def atomic_json(root: Path, path: Path, value: dict) -> None:
    plain_path(root, path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        plain_path(root, temporary)
        with temporary.open("xb") as stream:
            stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        plain_path(root, path)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def validate_url(url: str, *, feed: bool = False, initial_asset: tuple[str, str] | None = None) -> str:
    if not isinstance(url, str) or len(url) > 8192:
        raise UpdateError("Некорректный URL обновления.")
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise UpdateError("Некорректный URL обновления.") from exc
    hosts = {"zeter1.github.io"} if feed else {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
    if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password or port is not None or parsed.fragment or any(ord(c) < 33 for c in url):
        raise UpdateError("Небезопасный адрес обновления.")
    if feed and url != FEED_URL:
        raise UpdateError("Неожиданный адрес канала обновлений.")
    if initial_asset:
        tag, name = initial_asset
        if parsed.hostname != "github.com" or parsed.query or unquote(parsed.path) != f"/{REPOSITORY}/releases/download/{tag}/{name}":
            raise UpdateError("Файл обновления принадлежит другому релизу.")
    return url


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubClient:
    """Bounded HTTPS requests; every redirect is checked before opening it."""
    def __init__(self):
        self.opener = build_opener(_NoRedirect())

    def fetch(self, url: str, limit: int, cancel: threading.Event, *, feed=False, progress=None, output: Path | None = None) -> bytes:
        deadline = time.monotonic() + (180 if output else 35)
        validate_url(url, feed=feed)
        response = None
        for _ in range(6):
            if cancel.is_set():
                raise UpdateError("Обновление отменено.")
            validate_url(url, feed=feed)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise UpdateError("Истекло время загрузки обновления.")
            request = Request(url, headers={"User-Agent": "ZeTer-OS-Updater", "Accept": "application/json" if feed else "application/octet-stream", "Accept-Encoding": "identity", "Cache-Control": "no-cache"})
            try:
                response = self.opener.open(request, timeout=min(10, remaining))
                break
            except HTTPError as exc:
                if exc.code in {301, 302, 303, 307, 308}:
                    location = exc.headers.get("Location", "")
                    exc.close()
                    if feed:
                        raise UpdateError("Неожиданное перенаправление канала обновлений.") from None
                    validate_url(location)
                    url = location
                    continue
                retry = exc.headers.get("Retry-After", "")
                if retry and not retry.isdigit():
                    try:
                        retry = str(max(1, int(parsedate_to_datetime(retry).timestamp() - time.time())))
                    except (TypeError, ValueError, OverflowError):
                        retry = ""
                if not retry.isdigit() and exc.headers.get("X-RateLimit-Remaining") == "0":
                    reset = exc.headers.get("X-RateLimit-Reset", "0")
                    retry = str(max(1, int(reset) - int(time.time()))) if reset.isdigit() else "60"
                rate_limited = exc.code == 429 or exc.headers.get("X-RateLimit-Remaining") == "0"
                exc.close()
                if rate_limited:
                    message = "Слишком много запросов к серверу обновлений. Повторите позже."
                elif feed and exc.code == 404:
                    message = "Канал обновлений ещё не опубликован. Можно обновить программу вручную."
                elif exc.code in {401, 403}:
                    message = "Сервер обновлений отклонил запрос (HTTP " + str(exc.code) + ")."
                else:
                    message = "Сервер обновлений временно недоступен (HTTP " + str(exc.code) + ")."
                raise UpdateError(message, min(int(retry), 86400) if retry.isdigit() else None, http_status=exc.code) from None
            except (URLError, OSError) as exc:
                raise UpdateError("Не удалось загрузить обновление; проверьте интернет.") from exc
        if response is None:
            raise UpdateError("Слишком много перенаправлений обновления.")
        collected = bytearray()
        count = 0
        with response:
            length = response.headers.get("Content-Length")
            if length and (not length.isdigit() or int(length) > limit):
                raise UpdateError("Некорректный размер загрузки.")
            if response.headers.get("Content-Encoding", "identity") != "identity":
                raise UpdateError("Неожиданное сжатие HTTP-ответа.")
            sink = output.open("xb") if output else contextlib.nullcontext(None)
            with sink as stream:
                while True:
                    if cancel.is_set():
                        raise UpdateError("Обновление отменено.")
                    if time.monotonic() > deadline:
                        raise UpdateError("Истекло время загрузки обновления.")
                    chunk = response.read(min(128 * 1024, limit - count + 1))
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > limit:
                        raise UpdateError("Превышен размер загрузки.")
                    if stream:
                        stream.write(chunk)
                    else:
                        collected.extend(chunk)
                    if progress:
                        progress(count)
                if length and count != int(length):
                    raise UpdateError("Загрузка обновления оборвалась.")
                if stream:
                    stream.flush()
                    os.fsync(stream.fileno())
        return bytes(collected)

    def feed(self, cancel):
        return parse_json(self.fetch(FEED_URL, MAX_FEED, cancel, feed=True))


def validate_feed(value: dict) -> dict:
    """One published package, tied to the fixed publisher and immutable Release URL."""
    fields = {"schema", "repository", "platform", "version", "tag", "name", "url", "size", "sha256", "notes"}
    if not isinstance(value, dict) or set(value) != fields or type(value["schema"]) is not int or value["schema"] != 1:
        raise UpdateError("Некорректный формат канала обновлений.")
    if value["repository"] != REPOSITORY or value["platform"] != PLATFORM:
        raise UpdateError("Канал обновлений принадлежит другой программе или платформе.")
    version_tuple(value["version"])
    tag, name = value["tag"], value["name"]
    if not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", tag) or ".." in tag or tag.endswith("."):
        raise UpdateError("Некорректный тег обновления.")
    if name != f"ZeTer-OS-{value['version']}-Windows-x64.zip":
        raise UpdateError("Имя ZIP не совпадает с версией обновления.")
    validate_url(value["url"], initial_asset=(tag, name))
    if value["url"] != f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}":
        raise UpdateError("Неожиданный адрес ZIP обновления.")
    if type(value["size"]) is not int or not 0 < value["size"] <= MAX_ARCHIVE:
        raise UpdateError("Некорректный размер пакета обновления.")
    if not isinstance(value["sha256"], str) or not SHA_RE.fullmatch(value["sha256"]):
        raise UpdateError("В канале обновлений отсутствует корректная SHA-256 пакета.")
    if not isinstance(value["notes"], str) or len(value["notes"]) > 4000:
        raise UpdateError("Некорректное описание обновления.")
    return dict(value)


def select_feed(value: dict, current: str) -> dict | None:
    candidate = validate_feed(value)
    return candidate if version_tuple(candidate["version"]) > version_tuple(current) else None


def stage_archive(archive: Path, stage: Path, expected_version: str, cancel=None) -> dict:
    """Validate the entire ZIP topology/manifest/hashes before creating staged files."""
    plain_path(archive.parent, archive)
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if not 1 <= len(entries) <= MAX_FILES + 1:
            raise UpdateError("Слишком много файлов в ZIP.")
        members, folded, total = {}, set(), 0
        for entry in entries:
            name = safe_name(entry.filename, manifest=entry.filename == MANIFEST)
            mode = entry.external_attr >> 16
            if entry.is_dir() or entry.flag_bits & 1 or (stat.S_IFMT(mode) not in {0, stat.S_IFREG}) or (entry.external_attr & 0x400):
                raise UpdateError("ZIP содержит ссылку, каталог или специальный файл.")
            if name.casefold() in folded:
                raise UpdateError("ZIP содержит повторяющиеся имена.")
            folded.add(name.casefold())
            total += entry.file_size
            if total > MAX_EXPANDED or entry.file_size > max(1024 * 1024, entry.compress_size * 500):
                raise UpdateError("ZIP превышает безопасный размер распаковки.")
            members[name] = entry
        if MANIFEST not in members or members[MANIFEST].file_size > MAX_JSON:
            raise UpdateError("ZIP не содержит манифест обновления.")
        manifest = validate_manifest(parse_json(package.read(MANIFEST)))
        if manifest["version"] != expected_version or set(members) != set(manifest["files"]) | {MANIFEST}:
            raise UpdateError("Состав ZIP или версия не совпадает с манифестом.")
        # First pass validates every content before any staged writes.
        for name, record in manifest["files"].items():
            if cancel and cancel.is_set():
                raise UpdateError("Обновление отменено.")
            if members[name].file_size != record["size"]:
                raise UpdateError("Размер файла ZIP не совпадает с манифестом.")
            digest = hashlib.sha256()
            with package.open(name) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            if digest.hexdigest() != record["sha256"]:
                raise UpdateError("Контрольная сумма файла ZIP не совпадает.")
        plain_path(stage.parent, stage)
        if stage.exists():
            raise UpdateError("Каталог staging уже существует.")
        stage.mkdir()
        for name in members:
            if cancel and cancel.is_set():
                raise UpdateError("Обновление отменено.")
            target = plain_path(stage, stage / name)
            target.parent.mkdir(parents=True, exist_ok=True)
            plain_path(stage, target)
            with package.open(name) as source, target.open("xb") as destination:
                shutil.copyfileobj(source, destination, 1024 * 1024)
        if read_version(stage) != expected_version:
            raise UpdateError("Версия ресурсов не совпадает с манифестом.")
        return manifest


def preflight_install(root: Path, stage: Path, current: dict, candidate: dict) -> None:
    if version_tuple(candidate["version"]) <= version_tuple(current["version"]):
        raise UpdateError("Установка старой версии запрещена.")
    if read_manifest(root) != current:
        raise UpdateError("Установка была изменена после подготовки.")
    for name, record in current["files"].items():
        verify_file(root, name, record)
    old_folded = {name.casefold(): name for name in current["files"]}
    for name, record in candidate["files"].items():
        verify_file(stage, name, record)
        target = plain_path(root, root / name)
        if name.casefold() in old_folded and name != old_folded[name.casefold()]:
            raise UpdateError("Обновление меняет регистр пути существующего файла.")
        if target.exists() and name not in current["files"]:
            raise UpdateError("Обновление перезапишет неизвестный файл: " + name)
        for parent in target.parents:
            if parent == root:
                break
            plain_path(root, parent)
            if parent.exists() and not parent.is_dir():
                raise UpdateError("Путь обновления занят неизвестным файлом.")
    required = sum(x["size"] for x in current["files"].values()) + sum(x["size"] for x in candidate["files"].values()) + 64 * 1024 * 1024
    if shutil.disk_usage(root).free < required:
        raise UpdateError("Недостаточно места для обновления и отката.")


class WindowsMutex:
    """Named per-install mutex. Never requests elevation or terminates another process."""
    def __init__(self, root: Path, kind: str):
        self.handle = None
        if sys.platform != "win32":
            return
        from ctypes import wintypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
        self.kernel.CreateMutexW.restype = wintypes.HANDLE
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.ReleaseMutex.argtypes = [wintypes.HANDLE]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        digest = hashlib.sha256(str(root.resolve()).casefold().encode()).hexdigest()
        self.handle = self.kernel.CreateMutexW(None, False, "Local\\ZeTerOS-" + kind + "-" + digest)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        result = self.kernel.WaitForSingleObject(self.handle, 0)
        if result not in {0, 0x80}:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
            raise UpdateError("Другая копия ZeTer OS или обновление уже запущены.")

    def close(self):
        if self.handle:
            self.kernel.ReleaseMutex(self.handle)
            self.kernel.CloseHandle(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def normal_instance_lock(root: Path) -> WindowsMutex:
    with WindowsMutex(root, "update"):
        return WindowsMutex(root, "instance")


def pending_recovery(root: Path) -> bool:
    updates = plain_path(root, root / "data/updates")
    if not updates.exists():
        return False
    for session in updates.iterdir():
        if not re.fullmatch(r"[a-f0-9]{32}", session.name):
            continue
        path = plain_path(root, session / "journal.json")
        if path.exists():
            journal = parse_json(path.read_bytes())
            if not isinstance(journal, dict) or journal.get("phase") not in {"committed", "rolled_back"}:
                return True
    return False


class ParentProcess:
    """Retained Windows HANDLE, verified by exact image and creation timestamp."""
    def __init__(self, pid: int, image: Path, creation: int | None = None):
        if sys.platform != "win32":
            raise UpdateError("Установка обновления поддерживается только в Windows.")
        from ctypes import wintypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.kernel.GetProcessTimes.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)]
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.handle = self.kernel.OpenProcess(0x1000 | 0x100000, False, pid)
        if not self.handle:
            raise UpdateError("Не удалось подтвердить процесс ZeTer OS.")
        try:
            buffer, length = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
            if not self.kernel.QueryFullProcessImageNameW(self.handle, 0, buffer, ctypes.byref(length)) or Path(buffer.value).resolve() != image.resolve():
                raise UpdateError("Процесс ожидания не принадлежит этой установке.")
            times = [wintypes.FILETIME() for _ in range(4)]
            if not self.kernel.GetProcessTimes(self.handle, *(ctypes.byref(t) for t in times)):
                raise UpdateError("Не удалось подтвердить время запуска процесса.")
            self.creation = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
            if creation is not None and creation != self.creation:
                raise UpdateError("PID принадлежит другому процессу.")
        except BaseException:
            self.close()
            raise

    def wait(self, timeout: float, cancelled) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if cancelled():
                return False
            result = self.kernel.WaitForSingleObject(self.handle, 100)
            if result == 0:
                return True
            if result != 258:
                raise UpdateError("Ошибка ожидания завершения ZeTer OS.")
        return False

    def running(self) -> bool:
        return self.kernel.WaitForSingleObject(self.handle, 0) == 258

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


class UpdateManager:
    def __init__(self, root: Path, data_dir: Path, *, frozen=None, platform_name=None, client=None, runner=None):
        self.root, self.data_dir = Path(root), Path(data_dir)
        self.frozen = bool(getattr(sys, "frozen", False) if frozen is None else frozen)
        self.platform = sys.platform if platform_name is None else platform_name
        self.client = client or GitHubClient()
        self.runner = runner or self._launch_helper
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.active = False
        self.arming = False
        self.candidate = None
        self.session = None
        self.helper_process = None
        self.cooldown = 0.0
        try:
            current = read_version(self.root)
        except (OSError, UpdateError):
            current = "0.0.0"
        self.status = {"supported": self.frozen and self.platform == "win32" and struct.calcsize("P") == 8, "currentVersion": current, "phase": "idle", "available": False, "version": "", "progress": 0, "message": "", "error": ""}
        if not self.status["supported"]:
            self.status["message"] = "Автоматическое обновление работает в готовой 64-битной Windows-сборке ZeTer-OS.exe. При запуске из Python или в браузере используйте «Обновить вручную»."
        else:
            try:
                installed = read_manifest(self.root)
                if installed["version"] != current:
                    raise UpdateError("Версия установки не совпадает с манифестом.")
            except (OSError, UpdateError) as exc:
                self.status.update(supported=False, message=str(exc)[:400])

    def get_status(self):
        with self.lock:
            return {"ok": True, **self.status}

    def _set(self, **fields):
        with self.lock:
            self.status.update(fields)

    def _operation(self, action):
        with self.lock:
            if not self.status["supported"]:
                return {"ok": False, **self.status, "error": self.status["message"]}
            if self.active or self.status["phase"] == "awaiting_exit":
                return {"ok": False, **self.status, "error": "Обновление уже выполняется."}
            if time.monotonic() < self.cooldown:
                return {"ok": False, **self.status, "error": "Сервер обновлений просит подождать перед повторной проверкой."}
            self.active = True
            self.cancelled.clear()
        try:
            action()
            return self.get_status()
        except Exception as exc:
            retry = getattr(exc, "retry_after", None)
            fields = {"phase": "error", "error": str(exc)[:400] if isinstance(exc, UpdateError) else "Не удалось подготовить обновление. Проверьте пакет и права записи.", "message": "Обновление не установлено."}
            if retry:
                fields["retryAfterSeconds"] = retry
                self.cooldown = time.monotonic() + retry
            self._set(**fields)
            return {"ok": False, **self.status}
        finally:
            with self.lock:
                self.active = False

    def check(self):
        def action():
            self._set(phase="checking", error="", message="Проверка канала обновлений…", progress=0, retryAfterSeconds=0)
            candidate = select_feed(self.client.feed(self.cancelled), self.status["currentVersion"])
            self.candidate = candidate
            self._set(phase="available" if candidate else "idle", available=bool(candidate), version=candidate["version"] if candidate else "", message="Доступно обновление." if candidate else "Установлена актуальная версия.")
        return self._operation(action)

    def prepare(self):
        with self.lock:
            if not self.active and self.status["phase"] == "ready":
                return self.get_status()
        def action():
            if not self.candidate:
                raise UpdateError("Сначала проверьте наличие обновления.")
            candidate = dict(self.candidate)
            installed = read_manifest(self.root)
            updates = plain_path(self.root, self.data_dir / "updates")
            updates.mkdir(parents=True, exist_ok=True)
            session = plain_path(self.root, updates / uuid.uuid4().hex)
            session.mkdir()
            self.session = session
            self._set(phase="downloading", progress=0, error="", message="Загрузка и проверка обновления…")
            sha = candidate["sha256"]
            archive = session / "package.zip"
            self.client.fetch(candidate["url"], candidate["size"], self.cancelled, output=archive, progress=lambda count: self._set(progress=min(90, round(count / candidate["size"] * 90))))
            if file_record(archive) != {"size": candidate["size"], "sha256": sha}:
                raise UpdateError("Размер или SHA-256 загруженного пакета не совпадает.")
            staged = stage_archive(archive, session / "stage", candidate["version"], self.cancelled)
            preflight_install(self.root, session / "stage", installed, staged)
            # Writability test before closing parent; this exact owned file is removed.
            writable = plain_path(self.root, self.root / (".zeter-update-" + uuid.uuid4().hex + ".tmp"))
            with writable.open("xb") as stream:
                stream.write(b"writability probe")
                stream.flush()
                os.fsync(stream.fileno())
            writable.unlink()
            atomic_json(session, session / "request.json", {"schema": 1, "root": str(self.root.resolve()), "session": str(session.resolve()), "old": installed, "new": staged})
            self._set(phase="ready", progress=100, message="Обновление проверено. ZeTer OS сохранит работу, закроется и перезапустится автоматически. Не запускайте программу вручную.")
        return self._operation(action)

    def install(self):
        def action():
            if self.status["phase"] != "ready" or self.session is None:
                raise UpdateError("Пакет обновления ещё не подготовлен.")
            request = parse_json((self.session / "request.json").read_bytes())
            preflight_install(self.root, self.session / "stage", request["old"], request["new"])
            with self.lock:
                self.arming = True
            try:
                self.runner(self.session, request)
                with self.lock:
                    if self.cancelled.is_set():
                        atomic_json(self.session, self.session / "cancel.json", {"cancelled": True})
                        raise UpdateError("Установка отменена до закрытия программы.")
                    self._set(phase="awaiting_exit", message="ZeTer OS закрывается для установки обновления и затем запустится сама. Дождитесь открытия — не запускайте программу вручную.")
            finally:
                with self.lock:
                    self.arming = False
        return self._operation(action)

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            if self.session and (self.arming or self.status["phase"] == "awaiting_exit"):
                atomic_json(self.session, self.session / "cancel.json", {"cancelled": True})
            if not self.active:
                self._set(phase="available" if self.candidate else "idle", message="Обновление отменено.", error="", progress=0)
        return self.get_status()

    def _launch_helper(self, session, request):
        helper = verify_file(self.root, HELPER, request["old"]["files"][HELPER])
        copied = plain_path(session, session / HELPER)
        shutil.copyfile(helper, copied)
        if file_record(copied) != request["old"]["files"][HELPER]:
            raise UpdateError("Не удалось проверить отдельный установщик.")
        parent = ParentProcess(os.getpid(), self.root / EXE)
        try:
            request.update(parentPid=os.getpid(), parentCreation=parent.creation, nonce=uuid.uuid4().hex)
            atomic_json(session, session / "request.json", request)
        finally:
            parent.close()
        env = os.environ.copy()
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        self.helper_process = subprocess.Popen([str(copied), "--request", str(session / "request.json")], cwd=str(session), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        deadline = time.monotonic() + 20
        ready = session / "ready.json"
        while time.monotonic() < deadline:
            if self.cancelled.wait(0.1) or self.helper_process.poll() is not None:
                break
            if ready.is_file():
                value = parse_json(ready.read_bytes(), 4096)
                if isinstance(value, dict) and value.get("nonce") == request["nonce"] and value.get("parentCreation") == request["parentCreation"] and value.get("ready") is True and type(value.get("helperPid")) is int and type(value.get("helperCreation")) is int:
                    identity = ParentProcess(value["helperPid"], copied, value["helperCreation"])
                    try:
                        if identity.running() and self.helper_process.poll() is None:
                            return
                    finally:
                        identity.close()
                break
        atomic_json(session, session / "cancel.json", {"cancelled": True})
        try:
            self.helper_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.helper_process.terminate()
            self.helper_process.wait(timeout=3)
        raise UpdateError("Установщик не подтвердил готовность; программа остаётся открытой.")
