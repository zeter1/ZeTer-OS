"""
ZeTer OS Python Launcher

Запускает ZeTer OS как обычное окно приложения через pywebview.
Главное состояние ОС сохраняется в папку data рядом с этим .py-файлом,
а не в профиль Chrome/Edge/Firefox.
"""

from __future__ import annotations

import base64
import ctypes
import csv
import html
import io
import json
import os
import platform
import re
import secrets
import shutil
import zipfile
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

APP_NAME = "ZeTer OS"
WINDOWS_RUN_REGISTRY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
WINDOWS_RUN_VALUE_NAME = APP_NAME
MAX_STATE_FILE_BYTES = 200 * 1024 * 1024
RESTORE_LIMIT = 12
BACKUP_LIMIT = 12
MAX_TEXT_DOWNLOAD_BYTES = 20 * 1024 * 1024
MAX_BINARY_DOWNLOAD_BYTES = 50 * 1024 * 1024
MAX_MANAGED_FILE_BYTES = 4 * 1024 * 1024 * 1024 * 1024
MAX_ITEM_ASSET_BYTES = 12 * 1024 * 1024
MANAGED_FILE_CHUNK_BYTES = 1024 * 1024
MANAGED_FILE_UPLOAD_TTL_SECONDS = 6 * 60 * 60

BASE_DIR = Path(__file__).resolve().parent
APP_DIR = BASE_DIR / "app"
DATA_DIR = BASE_DIR / "data"
BACKUP_DIR = DATA_DIR / "backups"
LOG_DIR = DATA_DIR / "logs"
STATE_FILE = DATA_DIR / "zeter-os-state.json"
RESTORE_FILE = DATA_DIR / "restore-points.json"
LOG_FILE = LOG_DIR / "zeter-os.log"
READABLE_ROOT_DIR = DATA_DIR / "Рабочие столы"
READABLE_SUMMARY_FILE = DATA_DIR / "README_ДАННЫЕ_WINDOWS.txt"
MANAGED_FILE_ROOT_DIR = DATA_DIR / "Файлы ZeTer OS"
MANAGED_FILE_INCOMING_DIR = MANAGED_FILE_ROOT_DIR / ".incoming"
ITEM_ASSET_ROOT_DIR = DATA_DIR / "Оформление объектов"
NATIVE_DATA_STATUS_PREFIX = "Папка data подключена автоматически:"
NATIVE_DATA_PORTABLE_STATUS = f"{NATIVE_DATA_STATUS_PREFIX} data/zeter-os-state.json"


def windows_startup_command() -> str:
    """Build the current portable launch command for the per-user Run key."""
    executable = Path(sys.executable).resolve()
    if getattr(sys, "frozen", False):
        return subprocess.list2cmdline([str(executable)])

    if executable.name.casefold() in {"python.exe", "python3.exe"}:
        windowless = executable.with_name("pythonw.exe")
        if windowless.is_file():
            executable = windowless
    return subprocess.list2cmdline([str(executable), str(Path(__file__).resolve())])


def now_ms() -> int:
    return int(time.time() * 1000)


def cpu_percent_from_system_times(
    previous: Optional[tuple[int, int, int]],
    current: Optional[tuple[int, int, int]],
) -> Optional[float]:
    """Calculate Windows-wide CPU load from two GetSystemTimes samples."""
    if previous is None or current is None:
        return None
    idle_delta = current[0] - previous[0]
    kernel_delta = current[1] - previous[1]
    user_delta = current[2] - previous[2]
    total_delta = kernel_delta + user_delta
    if idle_delta < 0 or kernel_delta < 0 or user_delta < 0 or total_delta <= 0:
        return None
    busy_delta = max(0, total_delta - idle_delta)
    return round(min(100.0, max(0.0, busy_delta * 100.0 / total_delta)), 1)


def _windows_system_times() -> Optional[tuple[int, int, int]]:
    if not sys.platform.startswith("win"):
        return None
    from ctypes import wintypes

    idle = wintypes.FILETIME()
    kernel = wintypes.FILETIME()
    user = wintypes.FILETIME()
    get_system_times = ctypes.windll.kernel32.GetSystemTimes
    if not get_system_times(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
        raise ctypes.WinError()

    def value(file_time: Any) -> int:
        return (int(file_time.dwHighDateTime) << 32) | int(file_time.dwLowDateTime)

    return value(idle), value(kernel), value(user)


def _windows_memory_status() -> Optional[Dict[str, int]]:
    if not sys.platform.startswith("win"):
        return None

    class MemoryStatusEx(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong),
            ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatusEx()
    status.dwLength = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise ctypes.WinError()
    total = int(status.ullTotalPhys)
    available = int(status.ullAvailPhys)
    return {
        "total": total,
        "available": available,
        "used": max(0, total - available),
        "percent": int(status.dwMemoryLoad),
    }


def _windows_process_memory_bytes() -> Optional[int]:
    if not sys.platform.startswith("win"):
        return None

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong),
            ("PageFaultCount", ctypes.c_ulong),
            ("PeakWorkingSetSize", ctypes.c_size_t),
            ("WorkingSetSize", ctypes.c_size_t),
            ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPagedPoolUsage", ctypes.c_size_t),
            ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
            ("PagefileUsage", ctypes.c_size_t),
            ("PeakPagefileUsage", ctypes.c_size_t),
        ]

    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    get_current_process = ctypes.windll.kernel32.GetCurrentProcess
    get_current_process.restype = ctypes.c_void_p
    get_process_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
    get_process_memory_info.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ProcessMemoryCounters),
        ctypes.c_ulong,
    ]
    get_process_memory_info.restype = ctypes.c_int
    process = get_current_process()
    if not get_process_memory_info(
        process,
        ctypes.byref(counters),
        counters.cb,
    ):
        raise ctypes.WinError()
    return int(counters.WorkingSetSize)


def _windows_uptime_ms() -> Optional[int]:
    if not sys.platform.startswith("win"):
        return None
    get_tick_count = ctypes.windll.kernel32.GetTickCount64
    get_tick_count.restype = ctypes.c_ulonglong
    return int(get_tick_count())


def json_bytes(value: Any) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def normalize_portable_state_metadata(state: Any) -> int:
    """Remove machine-specific native paths from persisted workspace metadata."""
    if not isinstance(state, dict):
        return 0
    desktops = state.get("desktops")
    if not isinstance(desktops, list):
        return 0
    changed = 0
    for desktop in desktops:
        data = desktop.get("data") if isinstance(desktop, dict) else None
        if not isinstance(data, dict):
            continue
        status = data.get("externalSaveStatus")
        if (
            isinstance(status, str)
            and status.startswith(NATIVE_DATA_STATUS_PREFIX)
            and status != NATIVE_DATA_PORTABLE_STATUS
        ):
            data["externalSaveStatus"] = NATIVE_DATA_PORTABLE_STATUS
            changed += 1
    return changed


LEGACY_WORKSPACE_FIELDS = (
    "tasks",
    "taskProjects",
    "activeTaskProjectId",
    "events",
    "notifications",
)


def sync_legacy_workspace_aliases(state: Any) -> int:
    """Keep old root workspace fields equal to the canonical main desktop data."""
    if not isinstance(state, dict):
        return 0
    desktops = state.get("desktops")
    if not isinstance(desktops, list) or not desktops:
        return 0
    primary = next(
        (desktop for desktop in desktops if isinstance(desktop, dict) and desktop.get("id") == "desktop"),
        next((desktop for desktop in desktops if isinstance(desktop, dict)), None),
    )
    data = primary.get("data") if isinstance(primary, dict) else None
    if not isinstance(data, dict):
        return 0

    changed = 0
    for field in LEGACY_WORKSPACE_FIELDS:
        if field not in data:
            continue
        if state.get(field) != data.get(field):
            state[field] = data.get(field)
            changed += 1
    return changed


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def log(message: str) -> None:
    ensure_dirs()
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {message}\n"
    try:
        LOG_FILE.open("a", encoding="utf-8").write(line)
    except Exception:
        pass


def _atomic_replace_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(
        prefix=".zeter-atomic-",
        suffix=".tmp",
        dir=str(path.parent),
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def atomic_write_text(path: Path, text: str) -> None:
    _atomic_replace_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, value: Any) -> None:
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, indent=2))


def read_json_file(path: Path) -> Any:
    if not path.exists():
        return None
    if path.stat().st_size > MAX_STATE_FILE_BYTES:
        raise RuntimeError(f"Файл слишком большой: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def copy_if_exists(src: Path, dst: Path) -> bool:
    if not src.exists():
        return False
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


def prune_backups() -> int:
    removed = 0
    try:
        files = sorted(
            [p for p in BACKUP_DIR.glob("*.json") if p.is_file()],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for old in files[BACKUP_LIMIT:]:
            try:
                old.unlink()
                removed += 1
            except Exception as exc:
                log(f"BACKUP_ROTATION cannot delete {old.name}: {exc}")
    except Exception as exc:
        log(f"BACKUP_ROTATION error: {exc}")
    return removed


def make_startup_backup() -> None:
    if not STATE_FILE.exists():
        return
    stamp = datetime.now().strftime("%Y-%m-%d")
    dst = BACKUP_DIR / f"zeter-os-state-startup-{stamp}.json"
    if not dst.exists():
        copy_if_exists(STATE_FILE, dst)
        prune_backups()


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class NoCacheHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Не засоряем консоль запросами к локальным CSS/JS/картинкам.
        return


# ---------------------------------------------------------------------------
# Windows-readable data mirror
# ---------------------------------------------------------------------------
# Besides zeter-os-state.json (the full restore file), ZeTer OS keeps a
# human-readable mirror inside ./data/Рабочие столы.  It is regenerated from
# the current state on every save so photos are real image files, notes/tasks
# are Word-friendly files, tables are CSV, and each desktop has its own folder.

WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
IMAGE_MIME_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
}
ITEM_ASSET_KIND_LAYOUT = {
    "folder-icon": ("Папки", "значок"),
    "folder-background": ("Папки", "фон"),
    "shortcut-icon": ("Ярлыки", "значок"),
}
TRASH_ROOT_ID = "__zeter_trash__"


def atomic_write_bytes(path: Path, data: bytes) -> None:
    _atomic_replace_bytes(path, data)


def write_windows_text(path: Path, text: str) -> None:
    """Write UTF-8 with BOM so Windows Notepad/Excel detect Cyrillic safely."""
    atomic_write_bytes(path, str(text).encode("utf-8-sig"))


def safe_windows_name(name: Any, fallback: str = "file", max_len: int = 90, keep_ext: bool = False) -> str:
    value = str(name or fallback).strip()
    value = re.sub(r"[\x00-\x1f]", " ", value)
    value = re.sub(r"[<>:\"/\\|?*]+", "_", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        value = fallback
    if not keep_ext:
        value = re.sub(r"\.[A-Za-z0-9]{1,8}$", "", value).strip(" .") or fallback
    if value.upper() in WINDOWS_RESERVED_NAMES:
        value = f"{value}_"
    return value[:max_len].strip(" .") or fallback


def safe_managed_file_name(name: Any) -> str:
    """Return a Windows-safe file name while preserving its extension."""
    raw = str(name or "Файл").strip()
    suffix = Path(raw).suffix[:20]
    stem_limit = max(40, 160 - len(suffix))
    stem = safe_windows_name(Path(raw).stem if suffix else raw, "Файл", max_len=stem_limit)
    if stem.upper() in WINDOWS_RESERVED_NAMES:
        stem = f"{stem}_"
    return f"{stem}{suffix}"


def managed_file_path(relative_path: Any, *, require_file: bool = False) -> Path:
    """Resolve a state path strictly inside data/Файлы ZeTer OS."""
    raw = str(relative_path or "").strip().replace("\\", "/")
    parts = [part for part in raw.split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        raise ValueError("Некорректный путь файла ZeTer OS.")
    if Path(raw).is_absolute() or ":" in parts[0]:
        raise ValueError("Абсолютный путь файла запрещён.")
    target = (DATA_DIR.joinpath(*parts)).resolve()
    root = MANAGED_FILE_ROOT_DIR.resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("Путь файла выходит за пределы папки ZeTer OS data.") from exc
    if require_file and (not target.exists() or not target.is_file()):
        raise FileNotFoundError("Файл ZeTer OS не найден в папке data.")
    return target


def managed_file_relative_path(path: Path) -> str:
    return path.resolve().relative_to(DATA_DIR.resolve()).as_posix()


def item_asset_path(relative_path: Any, *, require_file: bool = False) -> Path:
    """Resolve a state path strictly inside data/Оформление объектов."""
    raw = str(relative_path or "").strip().replace("\\", "/")
    parts = [part for part in raw.split("/") if part]
    if len(parts) != 4 or parts[0] != ITEM_ASSET_ROOT_DIR.name:
        raise ValueError("Некорректный путь изображения оформления.")
    if parts[1] not in {"Папки", "Ярлыки"} or not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", parts[2]):
        raise ValueError("Некорректный путь изображения оформления.")
    if not re.fullmatch(r"(?:значок|фон)\.(?:png|jpe?g|webp|gif|bmp)", parts[3], flags=re.I):
        raise ValueError("Некорректный файл изображения оформления.")
    if parts[1] == "Ярлыки" and not parts[3].lower().startswith("значок."):
        raise ValueError("У ярлыка может быть только свой значок.")
    target = DATA_DIR.joinpath(*parts).resolve()
    try:
        target.relative_to(ITEM_ASSET_ROOT_DIR.resolve())
    except ValueError as exc:
        raise ValueError("Путь изображения выходит за пределы папки ZeTer OS data.") from exc
    if require_file and (not target.exists() or not target.is_file()):
        raise FileNotFoundError("Изображение оформления не найдено в папке data.")
    return target


def item_asset_relative_path(path: Path) -> str:
    return path.resolve().relative_to(DATA_DIR.resolve()).as_posix()


def inspect_payload_references(value: Any) -> Dict[str, Any]:
    """Collect validated payload paths and retain unsafe values for diagnostics."""
    managed: Dict[str, str] = {}
    item_assets: Dict[str, str] = {}
    invalid_managed: set[str] = set()
    invalid_item_assets: set[str] = set()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for key, child in node.items():
                if key == "managedPath":
                    if not isinstance(child, str):
                        invalid_managed.add(f"<{type(child).__name__}>")
                        continue
                    try:
                        relative = managed_file_relative_path(managed_file_path(child))
                        managed[relative.casefold()] = relative
                    except (ValueError, OSError):
                        invalid_managed.add(child)
                elif key == "assetPath":
                    if not isinstance(child, str):
                        invalid_item_assets.add(f"<{type(child).__name__}>")
                        continue
                    try:
                        relative = item_asset_relative_path(item_asset_path(child))
                        item_assets[relative.casefold()] = relative
                    except (ValueError, OSError):
                        invalid_item_assets.add(child)
                else:
                    visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return {
        "managed": managed,
        "itemAssets": item_assets,
        "invalidManaged": sorted(invalid_managed),
        "invalidItemAssets": sorted(invalid_item_assets),
    }


def collect_managed_file_paths(value: Any) -> set[str]:
    """Collect only safe managedPath values; arbitrary state strings are ignored."""
    return set(inspect_payload_references(value)["managed"])


def collect_item_asset_paths(value: Any) -> set[str]:
    """Collect only safe item customization assetPath values."""
    return set(inspect_payload_references(value)["itemAssets"])


def unique_child_path(path: Path, used: set[str]) -> Path:
    normalized = str(path).lower()
    if normalized not in used and not path.exists():
        used.add(normalized)
        return path
    stem = path.stem
    suffix = path.suffix
    parent = path.parent
    n = 2
    while True:
        candidate = parent / f"{stem} ({n}){suffix}"
        normalized = str(candidate).lower()
        if normalized not in used and not candidate.exists():
            used.add(normalized)
            return candidate
        n += 1


def strip_known_extension(name: str) -> str:
    return re.sub(r"\.[A-Za-z0-9]{1,8}$", "", str(name or "")).strip() or str(name or "")


def extension_from_name(name: str, fallback: str = "txt") -> str:
    match = re.search(r"\.([A-Za-z0-9]{1,8})$", str(name or ""))
    return (match.group(1).lower() if match else fallback).lstrip(".") or fallback


def normalize_mime(mime: str) -> str:
    return str(mime or "").split(";", 1)[0].strip().lower()


def mime_to_extension(mime: str, fallback: str = "png") -> str:
    return IMAGE_MIME_EXT.get(normalize_mime(mime), fallback)


def parse_data_url(data_url: str) -> Optional[tuple[str, bytes]]:
    if not isinstance(data_url, str):
        return None
    match = re.match(r"^data:([^;,]+)(;base64)?,(.*)$", data_url, flags=re.I | re.S)
    if not match:
        return None
    mime = normalize_mime(match.group(1) or "application/octet-stream")
    body = match.group(3) or ""
    try:
        if match.group(2):
            raw = base64.b64decode(re.sub(r"\s+", "", body), validate=False)
        else:
            from urllib.parse import unquote_to_bytes
            raw = unquote_to_bytes(body)
        return mime, raw
    except Exception:
        return None


def html_to_plain_text(value: str) -> str:
    text = str(value or "")
    # Картинки больше не заменяются текстом "[изображение сохранено отдельно]".
    # Они сохраняются отдельными файлами и встраиваются в DOCX заметки.
    text = re.sub(r"<\s*img\b[^>]*>", "\n", text, flags=re.I | re.S)
    text = re.sub(r"<\s*br\s*/?\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<\s*/\s*p\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<\s*/\s*div\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<\s*/\s*li\s*>", "\n", text, flags=re.I)
    text = re.sub(r"<\s*li\b[^>]*>", "• ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def extract_data_images_from_html(value: str) -> list[str]:
    if not isinstance(value, str) or "data:image/" not in value:
        return []
    images: list[str] = []
    for match in re.finditer(r"<\s*img\b[^>]*\bsrc\s*=\s*(['\"])(.*?)\1", value, flags=re.I | re.S):
        src = html.unescape(match.group(2) or "")
        if src.startswith("data:image/"):
            images.append(src)
    # Some imported HTML may have unquoted src attributes.
    for match in re.finditer(r"<\s*img\b[^>]*\bsrc\s*=\s*([^\s>]+)", value, flags=re.I | re.S):
        src = html.unescape((match.group(1) or "").strip("'\""))
        if src.startswith("data:image/") and src not in images:
            images.append(src)
    return images


def note_plain_text(item: Dict[str, Any]) -> str:
    content = item.get("content")
    rich = item.get("richContent")
    if isinstance(rich, str) and rich.strip():
        plain = html_to_plain_text(rich)
        if plain:
            return plain
    if isinstance(content, str):
        return content.strip()
    return ""


def xml_text(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=False)


def docx_paragraph(text: str, style: str = "") -> str:
    style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    text = str(text if text is not None else "")
    if text == "":
        return f"<w:p>{style_xml}</w:p>"
    runs = []
    # Preserve explicit line breaks inside paragraph.
    parts = text.split("\n")
    for i, part in enumerate(parts):
        if i:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(f'<w:r><w:t xml:space="preserve">{xml_text(part)}</w:t></w:r>')
    return f"<w:p>{style_xml}{''.join(runs)}</w:p>"


def image_dimensions(raw: bytes, mime: str) -> tuple[int, int]:
    """Return image dimensions without external dependencies; fallback is safe for Word."""
    try:
        mime = normalize_mime(mime)
        if mime == "image/png" and raw.startswith(b"\x89PNG") and len(raw) >= 24:
            return int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
        if mime in {"image/jpeg", "image/jpg"} and raw.startswith(b"\xff\xd8"):
            i = 2
            while i + 9 < len(raw):
                if raw[i] != 0xFF:
                    i += 1
                    continue
                marker = raw[i + 1]
                i += 2
                if marker in {0xD8, 0xD9}:
                    continue
                if i + 2 > len(raw):
                    break
                size = int.from_bytes(raw[i:i + 2], "big")
                if size < 2 or i + size > len(raw):
                    break
                if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                    return int.from_bytes(raw[i + 5:i + 7], "big"), int.from_bytes(raw[i + 3:i + 5], "big")
                i += size
        if mime == "image/gif" and raw[:6] in {b"GIF87a", b"GIF89a"} and len(raw) >= 10:
            return int.from_bytes(raw[6:8], "little"), int.from_bytes(raw[8:10], "little")
        if mime == "image/bmp" and raw.startswith(b"BM") and len(raw) >= 26:
            return int.from_bytes(raw[18:22], "little", signed=True), abs(int.from_bytes(raw[22:26], "little", signed=True))
        if mime == "image/webp" and raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
            vp8x = raw.find(b"VP8X")
            if vp8x >= 0 and vp8x + 30 <= len(raw):
                w = int.from_bytes(raw[vp8x + 12:vp8x + 15] + b"\x00", "little") + 1
                h = int.from_bytes(raw[vp8x + 15:vp8x + 18] + b"\x00", "little") + 1
                return w, h
    except Exception:
        pass
    return 900, 600


def docx_image_paragraph(rel_id: str, cx: int, cy: int, descr: str) -> str:
    descr_xml = xml_text(descr or "Изображение")
    return (
        f'<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="1" name="{descr_xml}" descr="{descr_xml}"/>'
        f'<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
        f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
        f'<pic:nvPicPr><pic:cNvPr id="0" name="{descr_xml}"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{rel_id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        f'</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    )


def normalize_doc_images(images: Optional[list[Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, image in enumerate(images or [], 1):
        data_url = ""
        name = f"Изображение {index}"
        if isinstance(image, str):
            data_url = image
        elif isinstance(image, dict):
            data_url = str(image.get("dataURL") or image.get("src") or "")
            name = str(image.get("name") or image.get("caption") or name)
        parsed = parse_data_url(data_url)
        if not parsed:
            continue
        mime, raw = parsed
        if not mime.startswith("image/") or not raw:
            continue
        ext = mime_to_extension(mime, "png")
        width, height = image_dimensions(raw, mime)
        width = max(int(width or 900), 1)
        height = max(int(height or 600), 1)
        cx = width * 9525
        cy = height * 9525
        max_cx = 5900000
        max_cy = 8500000
        scale = min(1.0, max_cx / cx if cx else 1.0, max_cy / cy if cy else 1.0)
        cx = int(cx * scale)
        cy = int(cy * scale)
        result.append({"name": name, "mime": mime, "ext": ext, "raw": raw, "cx": cx, "cy": cy})
    return result


def write_docx(path: Path, title: str, paragraphs: list[str], images: Optional[list[Any]] = None) -> None:
    document_parts = [docx_paragraph(title, "Title")]
    for paragraph in paragraphs:
        lines = str(paragraph if paragraph is not None else "").splitlines()
        if not lines:
            document_parts.append(docx_paragraph(""))
        else:
            for line in lines:
                document_parts.append(docx_paragraph(line))

    doc_images = normalize_doc_images(images)
    if doc_images:
        document_parts.append(docx_paragraph(""))
        document_parts.append(docx_paragraph("Изображения из заметки:", "Heading1"))
        for idx, image in enumerate(doc_images, 1):
            image["rel_id"] = f"rId{idx}"
            document_parts.append(docx_image_paragraph(image["rel_id"], image["cx"], image["cy"], image["name"]))

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">\n'
        '  <w:body>\n    {body}\n    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>\n  </w:body>\n</w:document>'
    ).format(body="\n    ".join(document_parts))

    image_defaults = "".join(
        f'<Default Extension="{ext}" ContentType="{ctype}"/>'
        for ext, ctype in [("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("bmp", "image/bmp"), ("webp", "image/webp")]
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{image_defaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
    image_rels = "".join(
        f'<Relationship Id="{image["rel_id"]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image{idx}.{image["ext"]}"/>'
        for idx, image in enumerate(doc_images, 1)
    )
    document_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{image_rels}</Relationships>'
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", package_rels)
        zf.writestr("word/document.xml", document_xml)
        if doc_images:
            zf.writestr("word/_rels/document.xml.rels", document_rels)
        for idx, image in enumerate(doc_images, 1):
            zf.writestr(f"word/media/image{idx}.{image['ext']}", image["raw"])
    os.replace(tmp, path)


def write_word_html_doc(path: Path, title: str, body_text: str, images: Optional[list[Any]] = None) -> None:
    # A .doc extension can contain Word-compatible HTML. Microsoft Word and
    # LibreOffice open it, and Notepad still shows readable UTF-8 text.
    img_html = []
    for index, image in enumerate(images or [], 1):
        data_url = image if isinstance(image, str) else str((image or {}).get("dataURL") or (image or {}).get("src") or "")
        if data_url.startswith("data:image/"):
            img_html.append(f'<p><img alt="Изображение {index}" src="{html.escape(data_url, quote=True)}" style="max-width: 650px; height: auto;"></p>')
    html_doc = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{html.escape(title)}</title></head>
<body><h1>{html.escape(title)}</h1><pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">{html.escape(body_text or '')}</pre>{''.join(img_html)}</body></html>
"""
    atomic_write_bytes(path, html_doc.encode("utf-8-sig"))


def write_doc_bundle(base_path_no_ext: Path, title: str, text: str, images: Optional[list[Any]] = None) -> Path:
    """Write one Windows-readable document only.

    Older builds created .doc, .docx and .txt copies for every note, which
    wasted space and confused users. The current mirror stores a single .docx
    file per note/document/task because .docx opens in Microsoft Word and
    keeps embedded images inside the same file.
    """
    clean_text = str(text or "").strip() or "Пусто."
    path = base_path_no_ext.with_suffix(".docx")
    write_docx(path, title, clean_text.split("\n\n"), images)
    return path


def write_csv_file(path: Path, rows: list[list[Any]]) -> None:
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";", lineterminator="\n")
    for row in rows:
        writer.writerow(["" if cell is None else str(cell) for cell in row])
    write_windows_text(path, output.getvalue())


def format_ts(value: Any) -> str:
    try:
        number = float(value)
        if number > 100000000000:
            number /= 1000
        return datetime.fromtimestamp(number).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""


def normalize_task_status(value: Any) -> str:
    return {"todo": "Нужно сделать", "doing": "В работе", "done": "Готово"}.get(str(value or ""), str(value or ""))


def normalize_priority(value: Any) -> str:
    return {"low": "Низкий", "medium": "Средний", "high": "Высокий"}.get(str(value or ""), str(value or ""))


def task_text(task: Dict[str, Any], projects: list[Dict[str, Any]] | None = None) -> str:
    project_map = {str(p.get("id")): str(p.get("name") or "") for p in (projects or []) if isinstance(p, dict)}
    lines = [
        f"Название: {task.get('title') or 'Без названия'}",
        f"Статус: {normalize_task_status(task.get('status')) or '—'}",
        f"Приоритет: {normalize_priority(task.get('priority')) or '—'}",
        f"Срок: {task.get('due') or '—'}",
        f"Тег: {task.get('tag') or '—'}",
    ]
    project_name = project_map.get(str(task.get("projectId") or ""), "")
    if project_name:
        lines.append(f"Проект: {project_name}")
    if task.get("description"):
        lines.extend(["", "Описание:", str(task.get("description"))])
    checklist = task.get("checklist") if isinstance(task.get("checklist"), list) else []
    if checklist:
        lines.extend(["", "Чеклист:"])
        for item in checklist:
            if isinstance(item, dict):
                lines.append(f"[{'x' if item.get('done') else ' '}] {item.get('text') or ''}")
    if task.get("createdAt") or task.get("updatedAt"):
        lines.extend(["", f"Создано: {format_ts(task.get('createdAt')) or '—'}", f"Обновлено: {format_ts(task.get('updatedAt')) or '—'}"])
    return "\n".join(lines).strip()


def tasks_document_text(tasks: list[Dict[str, Any]], title: str, projects: list[Dict[str, Any]] | None = None) -> str:
    if not tasks:
        return f"{title}\n\nЗадач пока нет."
    blocks = [title, ""]
    for i, task in enumerate(tasks, 1):
        if not isinstance(task, dict):
            continue
        blocks.append(f"{i}. {task.get('title') or 'Без названия'}")
        blocks.append(task_text(task, projects))
        blocks.append("-" * 40)
    return "\n".join(blocks).strip()


def tasks_csv_rows(tasks: list[Dict[str, Any]], projects: list[Dict[str, Any]] | None = None) -> list[list[Any]]:
    project_map = {str(p.get("id")): str(p.get("name") or "") for p in (projects or []) if isinstance(p, dict)}
    rows = [["Название", "Статус", "Приоритет", "Срок", "Тег", "Проект", "Описание", "Чеклист", "Создано", "Обновлено"]]
    for task in tasks or []:
        if not isinstance(task, dict):
            continue
        checklist = task.get("checklist") if isinstance(task.get("checklist"), list) else []
        checklist_text = " | ".join(f"[{'x' if c.get('done') else ' '}] {c.get('text') or ''}" for c in checklist if isinstance(c, dict))
        rows.append([
            task.get("title") or "Без названия",
            normalize_task_status(task.get("status")),
            normalize_priority(task.get("priority")),
            task.get("due") or "",
            task.get("tag") or "",
            project_map.get(str(task.get("projectId") or ""), ""),
            task.get("description") or "",
            checklist_text,
            format_ts(task.get("createdAt")),
            format_ts(task.get("updatedAt")),
        ])
    return rows


def event_text(event: Dict[str, Any]) -> str:
    lines = [
        f"Название: {event.get('title') or 'Без названия'}",
        f"Дата: {event.get('date') or '—'}",
        f"Время: {(event.get('start') or '—')} — {(event.get('end') or '—')}",
        f"Категория: {event.get('category') or '—'}",
        f"Место: {event.get('location') or '—'}",
        f"Повтор: {event.get('repeat') or '—'}",
        f"Напоминание: {event.get('reminder') or '—'}",
    ]
    if event.get("description"):
        lines.extend(["", "Описание:", str(event.get("description"))])
    return "\n".join(lines).strip()


def events_document_text(events: list[Dict[str, Any]], title: str) -> str:
    if not events:
        return f"{title}\n\nСобытий пока нет."
    blocks = [title, ""]
    for i, event in enumerate(sorted([e for e in events if isinstance(e, dict)], key=lambda e: (str(e.get("date") or ""), str(e.get("start") or ""))), 1):
        blocks.append(f"{i}. {event.get('title') or 'Без названия'}")
        blocks.append(event_text(event))
        blocks.append("-" * 40)
    return "\n".join(blocks).strip()


def events_csv_rows(events: list[Dict[str, Any]]) -> list[list[Any]]:
    rows = [["Название", "Дата", "Начало", "Конец", "Категория", "Место", "Описание", "Повтор", "Напоминание"]]
    for event in sorted([e for e in events or [] if isinstance(e, dict)], key=lambda e: (str(e.get("date") or ""), str(e.get("start") or ""))):
        rows.append([
            event.get("title") or "Без названия",
            event.get("date") or "",
            event.get("start") or "",
            event.get("end") or "",
            event.get("category") or "",
            event.get("location") or "",
            event.get("description") or "",
            event.get("repeat") or "",
            event.get("reminder") or "",
        ])
    return rows


def make_ics(events: list[Dict[str, Any]]) -> str:
    def esc(v: Any) -> str:
        return str(v or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ZeTer OS//Windows Data Export//RU"]
    for event in events or []:
        if not isinstance(event, dict) or not event.get("date"):
            continue
        date = re.sub(r"[^0-9]", "", str(event.get("date") or ""))[:8]
        start = re.sub(r"[^0-9]", "", str(event.get("start") or ""))[:4] or "0000"
        end = re.sub(r"[^0-9]", "", str(event.get("end") or ""))[:4] or start
        lines += [
            "BEGIN:VEVENT",
            f"UID:{esc(event.get('id') or event.get('title') or date)}@zeter-os",
            f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART:{date}T{start}00",
            f"DTEND:{date}T{end}00",
            f"SUMMARY:{esc(event.get('title') or 'Событие')}",
        ]
        if event.get("description"):
            lines.append(f"DESCRIPTION:{esc(event.get('description'))}")
        if event.get("location"):
            lines.append(f"LOCATION:{esc(event.get('location'))}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def table_to_csv_rows(item: Dict[str, Any]) -> list[list[Any]]:
    table = item.get("table") if isinstance(item.get("table"), dict) else item
    pages = table.get("pages") if isinstance(table, dict) and isinstance(table.get("pages"), list) else None
    if pages:
        page = pages[0] if isinstance(pages[0], dict) else {}
        rows = page.get("rows") if isinstance(page.get("rows"), list) else []
        return [[str(cell or "") for cell in row] for row in rows if isinstance(row, list)]
    content = item.get("content")
    if isinstance(content, str) and content.strip():
        return [line.split(",") for line in content.splitlines()]
    return []


def all_table_pages(item: Dict[str, Any]) -> list[tuple[str, list[list[Any]]]]:
    table = item.get("table") if isinstance(item.get("table"), dict) else item
    pages = table.get("pages") if isinstance(table, dict) and isinstance(table.get("pages"), list) else None
    if not pages:
        return [("Таблица", table_to_csv_rows(item))]
    result = []
    for i, page in enumerate(pages, 1):
        if not isinstance(page, dict):
            continue
        rows = page.get("rows") if isinstance(page.get("rows"), list) else []
        result.append((str(page.get("name") or f"Страница {i}"), [[str(cell or "") for cell in row] for row in rows if isinstance(row, list)]))
    return result or [("Таблица", [])]


def purge_deleted_items_from_state(state: Dict[str, Any]) -> int:
    """Permanently remove deleted/trash items before saving to ./data."""
    if not isinstance(state, dict):
        return 0
    removed = 0
    # JS may permanently remove items from the working state before saving.
    # Existing restore points and backups remain immutable recovery snapshots.
    if isinstance(state.get("_zeterDeletedIdsToPurge"), list):
        state.pop("_zeterDeletedIdsToPurge", None)
    fs = state.get("fs")
    if isinstance(fs, dict):
        deleted_ids: set[str] = set()
        for item_id, item in fs.items():
            if isinstance(item, dict) and (item.get("deletedAt") or item.get("parent") == TRASH_ROOT_ID):
                deleted_ids.add(str(item_id))
        changed = True
        while changed:
            changed = False
            for item_id, item in fs.items():
                if str(item_id) in deleted_ids or not isinstance(item, dict):
                    continue
                if str(item.get("parent") or "") in deleted_ids:
                    deleted_ids.add(str(item_id))
                    changed = True
        for item_id in list(deleted_ids):
            if item_id in fs:
                fs.pop(item_id, None)
                removed += 1

    def clear_trash_keys(container: Any) -> None:
        nonlocal removed
        if not isinstance(container, dict):
            return
        for key in ("trash", "trashItems", "deletedItems", "recycleBin", "binItems"):
            value = container.get(key)
            if isinstance(value, list) and value:
                removed += len(value)
                container[key] = []
            elif isinstance(value, dict) and value:
                removed += len(value)
                container[key] = {}

    clear_trash_keys(state)
    for desk in state.get("desktops") if isinstance(state.get("desktops"), list) else []:
        if isinstance(desk, dict):
            clear_trash_keys(desk)
            clear_trash_keys(desk.get("data"))
    return removed




def _write_windows_readable_data(
    state: Dict[str, Any],
    readable_root: Path,
    readable_summary_file: Path,
) -> Dict[str, Any]:
    if not isinstance(state, dict):
        raise ValueError("Состояние должно быть объектом.")

    desktops_raw = state.get("desktops") if isinstance(state.get("desktops"), list) else []
    if not desktops_raw:
        desktops_raw = [{"id": "desktop", "name": "Основной", "data": {}}]
    desktops = [d if isinstance(d, dict) else {} for d in desktops_raw]
    desktop_ids = {str(d.get("id") or "desktop") for d in desktops}
    desktop_names = {str(d.get("id") or "desktop"): str(d.get("name") or "Рабочий стол") for d in desktops}
    fs = state.get("fs") if isinstance(state.get("fs"), dict) else {}

    explorer_to_desktop: dict[str, str] = {}
    for desk in desktops:
        desk_id = str(desk.get("id") or "desktop")
        data = desk.get("data") if isinstance(desk.get("data"), dict) else {}
        root_id = data.get("explorerRootId")
        if root_id:
            explorer_to_desktop[str(root_id)] = desk_id
    for item_id, item in fs.items():
        if isinstance(item, dict) and item.get("systemRole") == "explorerRoot":
            parent = str(item.get("parent") or "")
            if parent in desktop_ids:
                explorer_to_desktop[str(item_id)] = parent

    def is_desktop_root(item_id: Any) -> bool:
        return str(item_id or "") in desktop_ids

    def is_explorer_root(item_id: Any) -> bool:
        return str(item_id or "") in explorer_to_desktop

    def desktop_id_for_item(item: Dict[str, Any]) -> str:
        fallback = "desktop" if "desktop" in desktop_ids else next(iter(desktop_ids), "desktop")
        for key in ("desktopId", "workspaceId", "workspaceRootId", "desktopRootId", "rootDesktopId", "rootId", "desktop", "workspace"):
            value = str(item.get(key) or "")
            if value in desktop_ids:
                return value
        parent_id = str(item.get("parent") or "")
        visited: set[str] = set()
        while parent_id and parent_id not in visited:
            visited.add(parent_id)
            if is_desktop_root(parent_id):
                return parent_id
            if is_explorer_root(parent_id):
                return explorer_to_desktop.get(parent_id, fallback)
            parent = fs.get(parent_id)
            if not isinstance(parent, dict):
                break
            parent_id = str(parent.get("parent") or "")
        return fallback

    def folder_trail(item: Dict[str, Any]) -> list[str]:
        trail: list[str] = []
        parent_id = str(item.get("parent") or "")
        visited: set[str] = set()
        while parent_id and parent_id not in visited:
            visited.add(parent_id)
            if is_desktop_root(parent_id) or is_explorer_root(parent_id):
                break
            parent = fs.get(parent_id)
            if not isinstance(parent, dict):
                break
            if parent.get("type") == "folder" and not parent.get("systemRole"):
                trail.insert(0, safe_windows_name(parent.get("name"), "Папка", 80))
            grand = str(parent.get("parent") or "")
            if is_desktop_root(grand) or is_explorer_root(grand):
                break
            parent_id = grand
        return trail

    def active_items(include_trash: bool = False) -> list[Dict[str, Any]]:
        items = []
        for item in fs.values():
            if not isinstance(item, dict):
                continue
            if item.get("systemRole"):
                continue
            if str(item.get("id") or "") in desktop_ids or str(item.get("id") or "") in explorer_to_desktop:
                continue
            if item.get("type") == "app":
                continue
            deleted = bool(item.get("deletedAt") or item.get("parent") == TRASH_ROOT_ID)
            if deleted and not include_trash:
                continue
            if not deleted and include_trash:
                continue
            items.append(item)
        return items

    def is_note_like(item: Dict[str, Any]) -> bool:
        t = str(item.get("type") or "")
        name = str(item.get("name") or "")
        if t == "note":
            return True
        note_flag = bool(item.get("isNote") or item.get("noteId") or item.get("note") is True or item.get("kind") == "note" or item.get("appType") == "note")
        note_name = bool(re.search(r"(^|\s)(новая\s+)?заметк", name, flags=re.I) or re.match(r"^note[\s_-]", name, flags=re.I))
        return t in {"text", "file", "document", "richtext", "html"} and (note_flag or note_name)

    # Rebuild only the generated mirror. The canonical restore state remains in zeter-os-state.json.
    if readable_root.exists():
        shutil.rmtree(readable_root)
    readable_root.mkdir(parents=True, exist_ok=True)

    used_paths: set[str] = set()
    counters = {"files": 0, "images": 0, "docs": 0, "tables": 0, "tasks": 0, "events": 0, "notes": 0}
    desktop_dir: dict[str, Path] = {}

    categories = ["Заметки", "Задачи", "Календарь", "Фотографии", "Изображения", "Таблицы", "Файлы", "Уведомления", "Настройки"]
    for index, desk in enumerate(desktops, 1):
        desk_id = str(desk.get("id") or ("desktop" if index == 1 else f"desktop_{index}"))
        title = desktop_names.get(desk_id) or "Рабочий стол"
        base = readable_root / safe_windows_name(f"{index:02d} - {title}", f"{index:02d} - Рабочий стол", 100)
        base.mkdir(parents=True, exist_ok=True)
        desktop_dir[desk_id] = base
        for cat in categories:
            (base / cat).mkdir(parents=True, exist_ok=True)
        profile = [
            "Профиль рабочего стола ZeTer OS",
            f"Название: {title}",
            f"Описание: {desk.get('description') or '—'}",
            f"ID: {desk_id}",
            f"Дата экспорта: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "",
            "Эта папка создана автоматически из ZeTer OS. Основной файл восстановления: data/zeter-os-state.json.",
        ]
        write_doc_bundle(base / "Настройки" / "Профиль рабочего стола", "Профиль рабочего стола", "\n".join(profile))
        settings_data = desk.get("data", {}).get("settings") if isinstance(desk.get("data"), dict) else {}
        write_windows_text(base / "Настройки" / "settings.json", json.dumps(settings_data or {}, ensure_ascii=False, indent=2))

    def ddir(desk_id: str, category: str, *subfolders: str) -> Path:
        base = desktop_dir.get(desk_id) or next(iter(desktop_dir.values()))
        path = base / category
        for folder in subfolders:
            path = path / safe_windows_name(folder, "Папка", 80)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def safe_base_file(path: Path, fallback: str) -> Path:
        return unique_child_path(path, used_paths)

    def save_image_data(target_dir: Path, base_name: str, data_url: str, fallback_ext: str = "png") -> Optional[Path]:
        parsed = parse_data_url(data_url)
        if not parsed:
            return None
        mime, raw = parsed
        if not mime.startswith("image/") or not raw:
            return None
        ext = mime_to_extension(mime, fallback_ext)
        path = safe_base_file(target_dir / f"{safe_windows_name(strip_known_extension(base_name), 'image', 70)}.{ext}", "image")
        atomic_write_bytes(path, raw)
        counters["images"] += 1
        counters["files"] += 1
        return path

    # Desktop-specific tasks, events, notifications, wallpapers/icons.
    # An explicitly empty desktop store is authoritative: do not resurrect stale
    # root-level legacy tasks/events after the user has deleted everything.
    exported_global_tasks = any(
        isinstance(d.get("data"), dict) and isinstance(d["data"].get("tasks"), list)
        for d in desktops if isinstance(d, dict)
    )
    exported_global_events = any(
        isinstance(d.get("data"), dict) and isinstance(d["data"].get("events"), list)
        for d in desktops if isinstance(d, dict)
    )
    for desk in desktops:
        desk_id = str(desk.get("id") or "desktop")
        title = desktop_names.get(desk_id, "Рабочий стол")
        data = desk.get("data") if isinstance(desk.get("data"), dict) else {}

        has_task_store = isinstance(data.get("tasks"), list)
        tasks = data.get("tasks") if has_task_store else []
        projects = data.get("taskProjects") if isinstance(data.get("taskProjects"), list) else []
        if not has_task_store and desk_id == state.get("currentDesktop") and isinstance(state.get("tasks"), list):
            tasks = state.get("tasks") or []
            projects = state.get("taskProjects") if isinstance(state.get("taskProjects"), list) else projects
            exported_global_tasks = True
        tasks_dir = ddir(desk_id, "Задачи")
        if tasks:
            text = tasks_document_text(tasks, f"Задачи — {title}", projects)
            write_doc_bundle(tasks_dir / "Все задачи", f"Задачи — {title}", text)
            write_csv_file(tasks_dir / "Все задачи.csv", tasks_csv_rows(tasks, projects))
            counters["tasks"] += len(tasks)
            individual_dir = tasks_dir / "Отдельные задачи"
            individual_dir.mkdir(exist_ok=True)
            for task in tasks:
                if isinstance(task, dict):
                    base = safe_base_file(individual_dir / safe_windows_name(task.get("title"), "Задача", 70), "Задача")
                    write_doc_bundle(base, str(task.get("title") or "Задача"), task_text(task, projects))

        has_event_store = isinstance(data.get("events"), list)
        events = data.get("events") if has_event_store else []
        if not has_event_store and desk_id == state.get("currentDesktop") and isinstance(state.get("events"), list):
            events = state.get("events") or []
            exported_global_events = True
        cal_dir = ddir(desk_id, "Календарь")
        if events:
            ev_text = events_document_text(events, f"Календарь — {title}")
            write_doc_bundle(cal_dir / "События календаря", f"Календарь — {title}", ev_text)
            write_csv_file(cal_dir / "События календаря.csv", events_csv_rows(events))
            write_windows_text(cal_dir / "События календаря.ics", make_ics(events))
            counters["events"] += len(events)

        notifications = data.get("notifications") if isinstance(data.get("notifications"), list) else []
        notif_lines = []
        for n in notifications:
            if isinstance(n, dict):
                notif_lines.append(f"{format_ts(n.get('time')) or ''} — {n.get('title') or 'Уведомление'}\n{n.get('text') or ''}\n")
        if notif_lines:
            write_doc_bundle(ddir(desk_id, "Уведомления") / "Уведомления", f"Уведомления — {title}", "\n".join(notif_lines).strip())

        settings = data.get("settings") if isinstance(data.get("settings"), dict) else {}
        wallpaper = settings.get("customWallpaper") if isinstance(settings.get("customWallpaper"), dict) else None
        if wallpaper and isinstance(wallpaper.get("dataURL"), str):
            save_image_data(ddir(desk_id, "Изображения", "Обои"), wallpaper.get("name") or "Свои обои", wallpaper.get("dataURL"), "jpg")
        icon = desk.get("icon") if isinstance(desk.get("icon"), dict) else None
        if icon and isinstance(icon.get("dataURL"), str):
            save_image_data(ddir(desk_id, "Изображения", "Иконки рабочих столов"), icon.get("name") or "Иконка рабочего стола", icon.get("dataURL"), "png")

    # Global tasks/events that were not represented inside desktop.data.
    fallback_desktop = "desktop" if "desktop" in desktop_ids else next(iter(desktop_ids), "desktop")
    if not exported_global_tasks and isinstance(state.get("tasks"), list) and state.get("tasks"):
        tasks_dir = ddir(fallback_desktop, "Задачи", "Глобальные задачи")
        projects = state.get("taskProjects") if isinstance(state.get("taskProjects"), list) else []
        write_doc_bundle(tasks_dir / "Глобальные задачи", "Глобальные задачи", tasks_document_text(state.get("tasks") or [], "Глобальные задачи", projects))
        write_csv_file(tasks_dir / "Глобальные задачи.csv", tasks_csv_rows(state.get("tasks") or [], projects))
    if not exported_global_events and isinstance(state.get("events"), list) and state.get("events"):
        events_dir = ddir(fallback_desktop, "Календарь", "Глобальные события")
        write_doc_bundle(events_dir / "Глобальные события", "Глобальные события", events_document_text(state.get("events") or [], "Глобальные события"))
        write_csv_file(events_dir / "Глобальные события.csv", events_csv_rows(state.get("events") or []))
        write_windows_text(events_dir / "Глобальные события.ics", make_ics(state.get("events") or []))

    # File-system items: notes, files, tables, images and task lists.
    for item in active_items(include_trash=False):
        desk_id = desktop_id_for_item(item)
        item_type = str(item.get("type") or "")
        item_name = str(item.get("name") or "Без названия")
        trail = folder_trail(item)

        if item_type == "folder":
            (ddir(desk_id, "Файлы", *trail) / safe_windows_name(item_name, "Папка", 80)).mkdir(parents=True, exist_ok=True)
            continue

        if item_type == "image" or isinstance(item.get("dataURL"), str) and str(item.get("dataURL")).startswith("data:image/"):
            target = ddir(desk_id, "Фотографии", *trail)
            if not save_image_data(target, item_name, str(item.get("dataURL") or ""), mime_to_extension(item.get("mime") or "", "png")):
                write_windows_text(target / f"{safe_windows_name(strip_known_extension(item_name), 'Изображение')}_не_экспортировано.txt", f"Изображение найдено в состоянии, но не содержит встроенных данных.\nИмя: {item_name}\n")
            continue

        if item_type == "table":
            table_dir = ddir(desk_id, "Таблицы", *trail)
            base = safe_windows_name(strip_known_extension(item_name), "Таблица", 70)
            pages = all_table_pages(item)
            if len(pages) <= 1:
                write_csv_file(safe_base_file(table_dir / f"{base}.csv", "Таблица"), pages[0][1])
            else:
                sub = table_dir / base
                sub.mkdir(parents=True, exist_ok=True)
                for i, (page_name, rows) in enumerate(pages, 1):
                    write_csv_file(safe_base_file(sub / f"{i:02d} - {safe_windows_name(page_name, 'Страница', 60)}.csv", "Страница"), rows)
            counters["tables"] += 1
            continue

        if item_type == "tasklist":
            tasks = item.get("tasks") if isinstance(item.get("tasks"), list) else []
            projects = item.get("taskProjects") if isinstance(item.get("taskProjects"), list) else []
            tasks_dir = ddir(desk_id, "Задачи", "Списки задач", *trail)
            base = safe_base_file(tasks_dir / safe_windows_name(strip_known_extension(item_name), "Список задач", 70), "Список задач")
            write_doc_bundle(base, item_name, tasks_document_text(tasks, f"Список задач — {item_name}", projects))
            write_csv_file(base.with_suffix(".csv"), tasks_csv_rows(tasks, projects))
            counters["tasks"] += len(tasks)
            continue

        text_content = ""
        if isinstance(item.get("richContent"), str) and item.get("richContent"):
            text_content = html_to_plain_text(item.get("richContent") or "")
        if not text_content and isinstance(item.get("content"), str):
            text_content = item.get("content") or ""

        if is_note_like(item):
            # Windows-копия заметок намеренно плоская: все заметки рабочего
            # стола лежат прямо в его каталоге «Заметки». Исходная структура
            # папок остаётся в полном state, а совпадающие имена ниже получают
            # безопасный суффикс «(2)», «(3)» и т. д.
            note_dir = ddir(desk_id, "Заметки")
            base = safe_base_file(note_dir / safe_windows_name(strip_known_extension(item_name), "Заметка", 70), "Заметка")
            images = extract_data_images_from_html(str(item.get("richContent") or ""))
            write_doc_bundle(base, item_name, text_content, images)
            counters["notes"] += 1
            # Изображения заметки встроены прямо в DOCX, отдельные копии не создаются,
            # чтобы одна заметка занимала один файл и не дублировала место в data.
            continue

        # Other files: keep original extension whenever possible and also create DOC files for rich text.
        files_dir = ddir(desk_id, "Файлы", *trail)
        ext = extension_from_name(item_name, str(item.get("extension") or "txt"))
        clean_file_name = safe_windows_name(item_name, "Файл", 90, keep_ext=True)
        if not re.search(r"\.[A-Za-z0-9]{1,8}$", clean_file_name):
            clean_file_name = f"{clean_file_name}.{ext}"
        write_windows_text(safe_base_file(files_dir / clean_file_name, "Файл"), text_content + ("\n" if text_content and not text_content.endswith("\n") else ""))
        if isinstance(item.get("richContent"), str) and item.get("richContent"):
            base = safe_base_file(files_dir / safe_windows_name(strip_known_extension(item_name), "Документ", 70), "Документ")
            rich_images = extract_data_images_from_html(str(item.get("richContent") or ""))
            write_doc_bundle(base, item_name, text_content, rich_images)
        counters["files"] += 1

    # Deleted/trash items are intentionally not mirrored in data/Рабочие столы.

    summary = [
        "ZeTer OS — данные в формате для Windows",
        "",
        f"Дата последнего сохранения: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "Папка рабочих столов: data\\Рабочие столы",
        "",
        "Эти папки создаются автоматически при каждом сохранении ZeTer OS.",
        "Основной файл для полного восстановления ZeTer OS: data/zeter-os-state.json.",
        "",
        "Что можно открыть в Windows:",
        "- Заметки: один .docx-файл на элемент прямо в папке «Заметки» рабочего стола, без дополнительных подпапок",
        "- Задачи: один .docx-файл на элемент",
        "- Изображения, фото, обои и иконки: .png/.jpg/.webp/.gif/.bmp",
        "- Таблицы: .csv",
        "- Календарь: .docx, .csv и .ics",
        "- Настройки: .json и документы профиля рабочего стола",
        "",
        "Важный совет: редактируй данные внутри ZeTer OS. Файлы в этой папке — автосозданная Windows-копия, при следующем сохранении она синхронизируется заново. Удалённые элементы не экспортируются.",
        "",
        f"Заметок: {counters['notes']}",
        f"Задач: {counters['tasks']}",
        f"Событий: {counters['events']}",
        f"Изображений: {counters['images']}",
        f"Таблиц: {counters['tables']}",
    ]
    write_windows_text(readable_summary_file, "\n".join(summary) + "\n")

    total_files = sum(1 for p in readable_root.rglob("*") if p.is_file())
    total_bytes = sum(p.stat().st_size for p in readable_root.rglob("*") if p.is_file())
    return {"readableDir": str(READABLE_ROOT_DIR), "readableFiles": total_files, "readableBytes": total_bytes, **counters}


def _publish_readable_tree(staging_root: Path, target_root: Path) -> None:
    """Publish a fully built mirror without first making live files disappear."""
    target_root.mkdir(parents=True, exist_ok=True)
    expected_files: set[Path] = set()

    for source in sorted(staging_root.rglob("*"), key=lambda path: (len(path.parts), str(path))):
        relative = source.relative_to(staging_root)
        target = target_root / relative
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        expected_files.add(relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(source, target)

    stale_files = [
        path for path in target_root.rglob("*")
        if path.is_file() and path.relative_to(target_root) not in expected_files
    ]
    for stale in stale_files:
        stale.unlink()

    directories = sorted(
        [path for path in target_root.rglob("*") if path.is_dir()],
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for directory in directories:
        try:
            directory.rmdir()
        except OSError:
            pass


def export_windows_readable_data(state: Dict[str, Any]) -> Dict[str, Any]:
    """Build the Windows mirror off-screen, then publish complete files."""
    ensure_dirs()
    token = f"{os.getpid()}-{threading.get_ident()}-{secrets.token_hex(4)}"
    staging_root = DATA_DIR / f".zeter-readable-{token}"
    staging_summary = DATA_DIR / f".zeter-readable-summary-{token}.tmp"
    try:
        result = _write_windows_readable_data(state, staging_root, staging_summary)
        _publish_readable_tree(staging_root, READABLE_ROOT_DIR)
        os.replace(staging_summary, READABLE_SUMMARY_FILE)
        result["readableFiles"] = sum(1 for path in READABLE_ROOT_DIR.rglob("*") if path.is_file())
        result["readableBytes"] = sum(path.stat().st_size for path in READABLE_ROOT_DIR.rglob("*") if path.is_file())
        return result
    finally:
        if staging_root.exists():
            shutil.rmtree(staging_root, ignore_errors=True)
        try:
            staging_summary.unlink(missing_ok=True)
        except OSError:
            pass


class DefaultPlatformOpener:
    """Open verified targets with the operating system without invoking a shell."""

    def open_path(self, path: Path) -> None:
        target = path.resolve()
        if not target.exists():
            raise FileNotFoundError(f"Файл или папка больше не существует: {target}")
        if sys.platform.startswith("win"):
            os.startfile(str(target))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(target)])
        else:
            subprocess.Popen(["xdg-open", str(target)])

    def open_url(self, target: str) -> None:
        if not webbrowser.open(target, new=2):
            raise RuntimeError("Система не смогла открыть браузер по умолчанию.")

    def open_windows_target(self, target: str) -> str:
        if not sys.platform.startswith("win"):
            raise RuntimeError("Ярлыки на файлы и папки Windows доступны только в Windows.")
        expanded = os.path.expandvars(os.path.expanduser(target))
        if not re.match(r"^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)", expanded):
            raise ValueError("Укажи абсолютный путь Windows, например C:\\Папка\\файл.txt.")
        path = Path(expanded)
        if not path.exists():
            raise FileNotFoundError("Файл или папка ярлыка больше не существует.")
        self.open_path(path)
        return "folder" if path.is_dir() else "file"


class WindowsStartupManager:
    """Manage the current user's ZeTer OS entry in the Windows Run key."""

    def __init__(
        self,
        registry_module: Optional[Any] = None,
        command_provider: Optional[Any] = None,
        platform_name: Optional[str] = None,
    ) -> None:
        self._platform_name = str(platform_name or sys.platform)
        if registry_module is None and self._platform_name.startswith("win"):
            import winreg

            registry_module = winreg
        self._registry = registry_module
        self._command_provider = command_provider or windows_startup_command

    @property
    def supported(self) -> bool:
        return self._platform_name.startswith("win") and self._registry is not None

    def _read_registered_command(self) -> Optional[str]:
        if not self.supported:
            return None
        registry = self._registry
        try:
            key = registry.OpenKey(
                registry.HKEY_CURRENT_USER,
                WINDOWS_RUN_REGISTRY_PATH,
                0,
                registry.KEY_READ,
            )
        except FileNotFoundError:
            return None
        try:
            value, value_type = registry.QueryValueEx(key, WINDOWS_RUN_VALUE_NAME)
        except FileNotFoundError:
            return None
        finally:
            registry.CloseKey(key)
        if value_type != registry.REG_SZ or not isinstance(value, str):
            return ""
        return value.strip()

    def status(self) -> Dict[str, Any]:
        if not self.supported:
            return {
                "supported": False,
                "enabled": False,
                "stale": False,
            }
        expected = str(self._command_provider()).strip()
        registered = self._read_registered_command()
        return {
            "supported": True,
            "enabled": registered == expected,
            "stale": registered is not None and registered != expected,
        }

    def set_enabled(self, enabled: bool) -> Dict[str, Any]:
        if not self.supported:
            raise RuntimeError("Автозапуск ZeTer OS доступен только в desktop-версии для Windows.")
        registry = self._registry
        if enabled:
            key = registry.CreateKeyEx(
                registry.HKEY_CURRENT_USER,
                WINDOWS_RUN_REGISTRY_PATH,
                0,
                registry.KEY_READ | registry.KEY_SET_VALUE,
            )
            try:
                registry.SetValueEx(
                    key,
                    WINDOWS_RUN_VALUE_NAME,
                    0,
                    registry.REG_SZ,
                    str(self._command_provider()).strip(),
                )
            finally:
                registry.CloseKey(key)
        else:
            try:
                key = registry.OpenKey(
                    registry.HKEY_CURRENT_USER,
                    WINDOWS_RUN_REGISTRY_PATH,
                    0,
                    registry.KEY_READ | registry.KEY_SET_VALUE,
                )
            except FileNotFoundError:
                key = None
            if key is not None:
                try:
                    try:
                        registry.DeleteValue(key, WINDOWS_RUN_VALUE_NAME)
                    except FileNotFoundError:
                        pass
                finally:
                    registry.CloseKey(key)
        return self.status()


class NativeStorageApi:
    """JS API для pywebview: хранит данные ZeTer OS в папке ./data."""

    def __init__(
        self,
        platform_opener: Optional[Any] = None,
        windows_startup_manager: Optional[Any] = None,
    ) -> None:
        ensure_dirs()
        make_startup_backup()
        self._platform_opener = platform_opener or DefaultPlatformOpener()
        self._windows_startup_manager = windows_startup_manager or WindowsStartupManager()
        self._window: Any = None
        self._last_previous_backup_at = 0.0
        self._state_save_lock = threading.RLock()
        self._restore_points_lock = threading.RLock()
        self._file_upload_lock = threading.RLock()
        self._system_metrics_lock = threading.RLock()
        self._file_uploads: Dict[str, Dict[str, Any]] = {}
        self._uncommitted_file_paths: Dict[str, float] = {}
        self._cleanup_orphaned_incoming_files()
        self._export_existing_state_to_readable_folder()
        try:
            self._system_cpu_sample = _windows_system_times()
        except OSError as exc:
            self._system_cpu_sample = None
            log(f"SYSTEM_METRICS initial CPU sample unavailable: {exc}")
        self._process_cpu_sample = (time.perf_counter(), time.process_time())

    def _ok(self, **data: Any) -> Dict[str, Any]:
        return {"ok": True, **data}

    def _error(self, exc: BaseException) -> Dict[str, Any]:
        log(f"ERROR: {exc}")
        return {"ok": False, "error": str(exc)}

    def _payload_dict(self, payload: Any, error_message: str) -> Dict[str, Any]:
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            raise ValueError(error_message)
        return payload

    def _cleanup_orphaned_incoming_files(self) -> int:
        """A new API instance has no active uploads, so old .part files are stale."""
        if not MANAGED_FILE_INCOMING_DIR.exists():
            return 0
        removed = 0
        for path in MANAGED_FILE_INCOMING_DIR.iterdir():
            if not path.is_file():
                continue
            try:
                path.unlink()
                removed += 1
            except OSError as exc:
                log(f"FILE_IMPORT stale cleanup error file={json.dumps(str(path), ensure_ascii=False)} detail={exc}")
        if removed:
            log(f"FILE_IMPORT stale cleanup removed={removed}")
        return removed

    def _cleanup_expired_file_uploads(self) -> int:
        cutoff = time.time() - MANAGED_FILE_UPLOAD_TTL_SECONDS
        removed = 0
        with self._file_upload_lock:
            expired = [upload_id for upload_id, session in self._file_uploads.items() if float(session.get("startedAt") or 0) < cutoff]
            for upload_id in expired:
                session = self._file_uploads.pop(upload_id, None)
                temp_path = session.get("tempPath") if isinstance(session, dict) else None
                if isinstance(temp_path, Path):
                    try:
                        temp_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                removed += 1
        return removed

    def _collect_retained_payload_references(self, current_state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        managed: Dict[str, str] = {}
        item_assets: Dict[str, str] = {}
        errors: list[str] = []
        sources = 0

        def add_source(label: str, value: Any) -> None:
            nonlocal sources
            inspected = inspect_payload_references(value)
            managed.update(inspected["managed"])
            item_assets.update(inspected["itemAssets"])
            invalid_managed = inspected["invalidManaged"]
            invalid_assets = inspected["invalidItemAssets"]
            if invalid_managed:
                errors.append(f"{label}: небезопасные managedPath: {', '.join(invalid_managed)}")
            if invalid_assets:
                errors.append(f"{label}: небезопасные assetPath: {', '.join(invalid_assets)}")
            sources += 1

        if current_state is None:
            if STATE_FILE.exists():
                try:
                    record = read_json_file(STATE_FILE)
                    if not isinstance(record, dict) or not record:
                        raise ValueError("основной файл не содержит корректный JSON-объект")
                    if "state" in record:
                        state = record.get("state")
                    else:
                        state = record
                    if not isinstance(state, dict):
                        raise ValueError("основной файл не содержит объект state")
                    add_source("primary state", state)
                except Exception as exc:
                    errors.append(f"primary state: {exc}")
        else:
            add_source("current state", current_state)

        with self._restore_points_lock:
            if RESTORE_FILE.exists():
                try:
                    points = read_json_file(RESTORE_FILE)
                    if not isinstance(points, list):
                        raise ValueError("файл точек восстановления не содержит список")
                    add_source("restore points", points)
                except Exception as exc:
                    errors.append(f"restore points: {exc}")

        if BACKUP_DIR.exists():
            for backup_path in sorted(BACKUP_DIR.glob("*.json"), key=lambda path: path.name.casefold()):
                try:
                    add_source(f"backup {backup_path.name}", read_json_file(backup_path))
                except Exception as exc:
                    errors.append(f"backup {backup_path.name}: {exc}")

        return {
            "managed": managed,
            "itemAssets": item_assets,
            "errors": errors,
            "sources": sources,
        }

    def _preflight_state_payload(self, state: Dict[str, Any]) -> Dict[str, Any]:
        inspected = inspect_payload_references(state)
        missing_managed: list[str] = []
        missing_assets: list[str] = []
        for relative in inspected["managed"].values():
            try:
                managed_file_path(relative, require_file=True)
            except (FileNotFoundError, OSError):
                missing_managed.append(relative)
        for relative in inspected["itemAssets"].values():
            try:
                item_asset_path(relative, require_file=True)
            except (FileNotFoundError, OSError):
                missing_assets.append(relative)
        invalid_managed = inspected["invalidManaged"]
        invalid_assets = inspected["invalidItemAssets"]
        ready = not (missing_managed or missing_assets or invalid_managed or invalid_assets)
        return {
            "ready": ready,
            "managedFilesRequired": len(inspected["managed"]),
            "itemAssetsRequired": len(inspected["itemAssets"]),
            "missingManagedFiles": sorted(missing_managed),
            "missingItemAssets": sorted(missing_assets),
            "invalidManagedPaths": invalid_managed,
            "invalidItemAssetPaths": invalid_assets,
        }

    def _prune_unreferenced_managed_files(self, referenced: set[str]) -> Dict[str, int]:
        now = time.time()
        with self._file_upload_lock:
            for relative in list(self._uncommitted_file_paths):
                if relative in referenced:
                    self._uncommitted_file_paths.pop(relative, None)
            protected = {
                relative
                for relative, created_at in self._uncommitted_file_paths.items()
                if now - created_at < MANAGED_FILE_UPLOAD_TTL_SECONDS
            }
            self._uncommitted_file_paths = {
                relative: created_at
                for relative, created_at in self._uncommitted_file_paths.items()
                if relative in protected
            }

        removed_files = 0
        removed_bytes = 0
        kept_files = 0
        if MANAGED_FILE_ROOT_DIR.exists():
            for path in MANAGED_FILE_ROOT_DIR.rglob("*"):
                if not path.is_file() or MANAGED_FILE_INCOMING_DIR in path.parents:
                    continue
                relative = managed_file_relative_path(path).casefold()
                if relative in referenced or relative in protected:
                    kept_files += 1
                    continue
                try:
                    removed_bytes += path.stat().st_size
                    path.unlink()
                    removed_files += 1
                except OSError as exc:
                    log(f"FILE_PRUNE error file={json.dumps(str(path), ensure_ascii=False)} detail={exc}")

            directories = sorted(
                [path for path in MANAGED_FILE_ROOT_DIR.rglob("*") if path.is_dir() and path != MANAGED_FILE_INCOMING_DIR],
                key=lambda path: len(path.parts),
                reverse=True,
            )
            for directory in directories:
                try:
                    directory.rmdir()
                except OSError:
                    pass
        return {
            "managedFiles": kept_files,
            "managedFilesRemoved": removed_files,
            "managedFilesRemovedBytes": removed_bytes,
        }

    def _prune_unreferenced_item_assets(self, referenced: set[str]) -> Dict[str, int]:
        removed_files = 0
        removed_bytes = 0
        kept_files = 0
        if ITEM_ASSET_ROOT_DIR.exists():
            for path in ITEM_ASSET_ROOT_DIR.rglob("*"):
                if not path.is_file():
                    continue
                try:
                    relative = item_asset_relative_path(path).casefold()
                except (ValueError, OSError):
                    continue
                if relative in referenced:
                    kept_files += 1
                    continue
                try:
                    removed_bytes += path.stat().st_size
                    path.unlink()
                    removed_files += 1
                except OSError as exc:
                    log(f"ITEM_ASSET_PRUNE error file={json.dumps(str(path), ensure_ascii=False)} detail={exc}")

            directories = sorted(
                [path for path in ITEM_ASSET_ROOT_DIR.rglob("*") if path.is_dir()],
                key=lambda path: len(path.parts),
                reverse=True,
            )
            for directory in directories:
                try:
                    directory.rmdir()
                except OSError:
                    pass
        return {
            "itemAssets": kept_files,
            "itemAssetsRemoved": removed_files,
            "itemAssetsRemovedBytes": removed_bytes,
        }

    def _garbage_collect_payload(self, current_state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        references = self._collect_retained_payload_references(current_state)
        errors = references["errors"]
        if errors:
            log(f"PAYLOAD_GC skipped errors={json.dumps(errors, ensure_ascii=False)}")
            return {
                "payloadGcOk": False,
                "payloadGcSkipped": True,
                "payloadGcErrors": errors,
                "payloadReferenceSources": references["sources"],
                "recoveryManagedFiles": len(references["managed"]),
                "recoveryItemAssets": len(references["itemAssets"]),
                "managedFiles": 0,
                "managedFilesRemoved": 0,
                "managedFilesRemovedBytes": 0,
                "itemAssets": 0,
                "itemAssetsRemoved": 0,
                "itemAssetsRemovedBytes": 0,
            }
        managed_files = self._prune_unreferenced_managed_files(set(references["managed"]))
        item_assets = self._prune_unreferenced_item_assets(set(references["itemAssets"]))
        result = {
            "payloadGcOk": True,
            "payloadGcSkipped": False,
            "payloadGcErrors": [],
            "payloadReferenceSources": references["sources"],
            "recoveryManagedFiles": len(references["managed"]),
            "recoveryItemAssets": len(references["itemAssets"]),
            **managed_files,
            **item_assets,
        }
        log(
            "PAYLOAD_GC "
            f"sources={result['payloadReferenceSources']} "
            f"managedRefs={result['recoveryManagedFiles']} "
            f"managedRemoved={result['managedFilesRemoved']} "
            f"assetRefs={result['recoveryItemAssets']} "
            f"assetsRemoved={result['itemAssetsRemoved']}"
        )
        return result

    def _safe_download_name(self, name: Any, fallback: str) -> str:
        file_name = safe_windows_name(name, fallback, max_len=120, keep_ext=True)
        file_path = Path(file_name)
        if file_path.stem.upper() in WINDOWS_RESERVED_NAMES:
            file_name = f"{file_path.stem}_{file_path.suffix}"
        if not Path(file_name).suffix:
            fallback_suffix = Path(fallback).suffix or ".bin"
            file_name += fallback_suffix
        return file_name

    def _download_file_types(self, file_name: str, mime_type: str) -> tuple[str, ...]:
        suffix = Path(file_name).suffix.lower()
        if mime_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" or suffix == ".xlsx":
            return ("Книга Excel (*.xlsx)", "Все файлы (*.*)")
        if mime_type == "text/csv" or suffix == ".csv":
            return ("CSV (*.csv)", "Все файлы (*.*)")
        if mime_type == "application/zip" or suffix == ".zip":
            return ("ZIP (*.zip)", "Все файлы (*.*)")
        if suffix:
            return (f"Файлы {suffix} (*{suffix})", "Все файлы (*.*)")
        return ("Все файлы (*.*)",)

    def _choose_download_target(self, file_name: str, mime_type: str) -> Optional[Path]:
        if self._window is None:
            raise RuntimeError("Окно ZeTer OS ещё не готово для выбора места сохранения.")

        import webview  # type: ignore

        file_dialog = getattr(webview, "FileDialog", None)
        dialog_type = getattr(file_dialog, "SAVE", None) if file_dialog is not None else None
        if dialog_type is None:
            dialog_type = getattr(webview, "SAVE_DIALOG", None)
        if dialog_type is None:
            raise RuntimeError("Установленная версия pywebview не поддерживает диалог сохранения файла.")

        selection = self._window.create_file_dialog(
            dialog_type,
            save_filename=file_name,
            file_types=self._download_file_types(file_name, mime_type),
        )
        if not selection:
            return None

        selected_path = selection[0] if isinstance(selection, (list, tuple)) else selection
        target = Path(str(selected_path))
        suffix = Path(file_name).suffix.lower()
        if not target.suffix and suffix:
            target = target.with_suffix(suffix)
        if target.exists() and target.is_dir():
            raise ValueError("Выбранный путь является папкой, а не файлом.")
        return target


    def _export_existing_state_to_readable_folder(self) -> None:
        try:
            record = read_json_file(STATE_FILE)
            state = record.get("state") if isinstance(record, dict) else None
            if isinstance(state, dict):
                normalized_portable_metadata = normalize_portable_state_metadata(state)
                normalized_workspace_aliases = sync_legacy_workspace_aliases(state)
                purged_deleted = purge_deleted_items_from_state(state)
                if (purged_deleted or normalized_portable_metadata or normalized_workspace_aliases) and isinstance(record, dict):
                    record["state"] = state
                    record["stateBytes"] = json_bytes(state)
                    record["updatedAt"] = now_ms()
                    record["savedAt"] = datetime.now().isoformat(timespec="seconds")
                    atomic_write_json(STATE_FILE, record)
                result = export_windows_readable_data(state)
                payload_gc = self._garbage_collect_payload(state)
                log(f"WINDOWS_READABLE startup files={result.get('readableFiles')} portableMetadata={normalized_portable_metadata} workspaceAliases={normalized_workspace_aliases} purgedDeleted={purged_deleted} payloadGcOk={payload_gc.get('payloadGcOk')} managedFiles={payload_gc.get('managedFiles')} managedFilesRemoved={payload_gc.get('managedFilesRemoved')} itemAssets={payload_gc.get('itemAssets')} itemAssetsRemoved={payload_gc.get('itemAssetsRemoved')} dir={result.get('readableDir')}")
            else:
                payload_gc = self._garbage_collect_payload()
                log(
                    "PAYLOAD_GC startup-without-primary "
                    f"payloadGcOk={payload_gc.get('payloadGcOk')} "
                    f"managedFilesRemoved={payload_gc.get('managedFilesRemoved')} "
                    f"itemAssetsRemoved={payload_gc.get('itemAssetsRemoved')}"
                )
        except Exception as exc:
            log(f"WINDOWS_READABLE startup error: {exc}")

    def get_storage_info(self) -> Dict[str, Any]:
        try:
            state_bytes = STATE_FILE.stat().st_size if STATE_FILE.exists() else 0
            restore_bytes = RESTORE_FILE.stat().st_size if RESTORE_FILE.exists() else 0
            data_bytes = 0
            for path in DATA_DIR.rglob("*"):
                if path.is_file():
                    data_bytes += path.stat().st_size
            backup_files = [path for path in BACKUP_DIR.glob("*") if path.is_file()] if BACKUP_DIR.exists() else []
            log_files = [path for path in LOG_DIR.glob("*") if path.is_file()] if LOG_DIR.exists() else []
            return self._ok(
                dataDir=str(DATA_DIR),
                stateFile=str(STATE_FILE),
                restoreFile=str(RESTORE_FILE),
                backupDir=str(BACKUP_DIR),
                logDir=str(LOG_DIR),
                logFile=str(LOG_FILE),
                readableDir=str(READABLE_ROOT_DIR),
                readableSummaryFile=str(READABLE_SUMMARY_FILE),
                managedFileDir=str(MANAGED_FILE_ROOT_DIR),
                managedFileBytes=sum(p.stat().st_size for p in MANAGED_FILE_ROOT_DIR.rglob("*") if p.is_file() and MANAGED_FILE_INCOMING_DIR not in p.parents) if MANAGED_FILE_ROOT_DIR.exists() else 0,
                managedFiles=sum(1 for p in MANAGED_FILE_ROOT_DIR.rglob("*") if p.is_file() and MANAGED_FILE_INCOMING_DIR not in p.parents) if MANAGED_FILE_ROOT_DIR.exists() else 0,
                itemAssetDir=str(ITEM_ASSET_ROOT_DIR),
                itemAssetBytes=sum(p.stat().st_size for p in ITEM_ASSET_ROOT_DIR.rglob("*") if p.is_file()) if ITEM_ASSET_ROOT_DIR.exists() else 0,
                itemAssets=sum(1 for p in ITEM_ASSET_ROOT_DIR.rglob("*") if p.is_file()) if ITEM_ASSET_ROOT_DIR.exists() else 0,
                readableBytes=sum(p.stat().st_size for p in READABLE_ROOT_DIR.rglob("*") if p.is_file()) if READABLE_ROOT_DIR.exists() else 0,
                readableFiles=sum(1 for p in READABLE_ROOT_DIR.rglob("*") if p.is_file()) if READABLE_ROOT_DIR.exists() else 0,
                backupBytes=sum(path.stat().st_size for path in backup_files),
                backupFiles=len(backup_files),
                logBytes=sum(path.stat().st_size for path in log_files),
                logFiles=len(log_files),
                stateBytes=state_bytes,
                restoreBytes=restore_bytes,
                dataBytes=data_bytes,
                exists=STATE_FILE.exists(),
            )
        except Exception as exc:
            return self._error(exc)

    def get_windows_startup_status(self) -> Dict[str, Any]:
        try:
            return self._ok(**self._windows_startup_manager.status())
        except Exception as exc:
            return self._error(exc)

    def set_windows_startup_enabled(self, enabled: Any) -> Dict[str, Any]:
        try:
            if not isinstance(enabled, bool):
                raise ValueError("Состояние автозапуска должно быть логическим значением.")
            result = self._windows_startup_manager.set_enabled(enabled)
            log(f"WINDOWS_STARTUP enabled={result.get('enabled')} stale={result.get('stale')}")
            return self._ok(**result)
        except Exception as exc:
            return self._error(exc)

    def get_system_metrics(self) -> Dict[str, Any]:
        """Return real host metrics for the system monitor without extra packages."""
        try:
            with self._system_metrics_lock:
                sampled_at = now_ms()
                current_times = _windows_system_times()
                cpu_percent = cpu_percent_from_system_times(
                    self._system_cpu_sample,
                    current_times,
                )
                self._system_cpu_sample = current_times

                wall_now = time.perf_counter()
                process_now = time.process_time()
                previous_wall, previous_process = self._process_cpu_sample
                wall_delta = wall_now - previous_wall
                process_delta = process_now - previous_process
                self._process_cpu_sample = (wall_now, process_now)
                logical_processors = max(1, int(os.cpu_count() or 1))
                process_cpu_percent = (
                    round(
                        min(
                            100.0,
                            max(
                                0.0,
                                process_delta * 100.0 / wall_delta / logical_processors,
                            ),
                        ),
                        1,
                    )
                    if wall_delta > 0
                    else None
                )

                memory = _windows_memory_status()
                disk = shutil.disk_usage(DATA_DIR)
                disk_used = max(0, int(disk.total) - int(disk.free))
                disk_percent = (
                    round(disk_used * 100.0 / int(disk.total), 1)
                    if disk.total
                    else None
                )

                return self._ok(
                    sampledAt=sampled_at,
                    cpuPercent=cpu_percent,
                    logicalProcessors=logical_processors,
                    memoryTotalBytes=memory["total"] if memory else None,
                    memoryAvailableBytes=memory["available"] if memory else None,
                    memoryUsedBytes=memory["used"] if memory else None,
                    memoryPercent=memory["percent"] if memory else None,
                    diskName=DATA_DIR.anchor or str(DATA_DIR),
                    diskTotalBytes=int(disk.total),
                    diskUsedBytes=disk_used,
                    diskFreeBytes=int(disk.free),
                    diskPercent=disk_percent,
                    processMemoryBytes=_windows_process_memory_bytes(),
                    processCpuPercent=process_cpu_percent,
                    uptimeMs=_windows_uptime_ms(),
                    osName=f"{platform.system()} {platform.release()}".strip(),
                    osVersion=platform.version(),
                    architecture=platform.machine() or "неизвестно",
                    pythonVersion=platform.python_version(),
                )
        except Exception as exc:
            return self._error(exc)

    def report_client_error(self, details: Any) -> Dict[str, Any]:
        """Записывает ограниченную диагностику фатальной ошибки JavaScript при boot."""
        try:
            if isinstance(details, str):
                try:
                    details = json.loads(details)
                except json.JSONDecodeError:
                    details = {"message": details}
            if not isinstance(details, dict):
                details = {"message": str(details or "Неизвестная ошибка JavaScript")}

            def text_field(name: str, limit: int) -> str:
                return str(details.get(name) or "").strip()[:limit]

            try:
                line = max(0, int(details.get("line") or 0))
            except (TypeError, ValueError):
                line = 0
            try:
                column = max(0, int(details.get("column") or 0))
            except (TypeError, ValueError):
                column = 0

            payload = {
                "kind": text_field("kind", 80) or "boot_error",
                "message": text_field("message", 900) or "Неизвестная ошибка JavaScript",
                "source": text_field("source", 500),
                "line": line,
                "column": column,
                "stack": text_field("stack", 5000),
                "page": text_field("page", 500),
                "occurredAt": text_field("occurredAt", 80),
            }
            log(f"CLIENT_ERROR {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}")
            return self._ok(recorded=True)
        except Exception as exc:
            return self._error(exc)

    def save_item_asset(self, payload: Any) -> Dict[str, Any]:
        """Atomically store a folder/shortcut image in data/Оформление объектов."""
        try:
            data = self._payload_dict(payload, "Некорректные данные изображения оформления.")
            item_id = str(data.get("itemId") or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", item_id):
                raise ValueError("Некорректный ID папки или ярлыка.")
            kind = str(data.get("kind") or "").strip()
            layout = ITEM_ASSET_KIND_LAYOUT.get(kind)
            if not layout:
                raise ValueError("Неподдерживаемый тип изображения оформления.")
            parsed = parse_data_url(str(data.get("dataURL") or ""))
            if not parsed:
                raise ValueError("Не удалось прочитать изображение оформления.")
            mime, raw = parsed
            if mime not in IMAGE_MIME_EXT:
                raise ValueError("Поддерживаются только PNG, JPG, WebP, GIF и BMP.")
            if not raw:
                raise ValueError("Файл изображения пуст.")
            if len(raw) > MAX_ITEM_ASSET_BYTES:
                raise ValueError("Изображение оформления слишком большое. Максимум: 12 МБ.")
            if shutil.disk_usage(DATA_DIR).free < len(raw) + 16 * 1024 * 1024:
                raise OSError("Недостаточно свободного места для изображения оформления.")

            category, stem = layout
            extension = mime_to_extension(mime)
            target_dir = ITEM_ASSET_ROOT_DIR / category / item_id
            target = target_dir / f"{stem}.{extension}"
            atomic_write_bytes(target, raw)
            for old in target_dir.glob(f"{stem}.*"):
                if old == target or not old.is_file():
                    continue
                try:
                    old.unlink()
                except OSError as exc:
                    log(f"ITEM_ASSET old cleanup error file={json.dumps(str(old), ensure_ascii=False)} detail={exc}")

            relative_path = item_asset_relative_path(target)
            original_name = safe_windows_name(data.get("name"), "Изображение", max_len=160, keep_ext=True)
            saved_at = datetime.now().isoformat(timespec="seconds")
            asset = {
                "path": relative_path,
                "mime": mime,
                "originalName": original_name,
                "size": len(raw),
                "savedAt": saved_at,
            }
            log(f"ITEM_ASSET save kind={kind} item={item_id} file={json.dumps(str(target), ensure_ascii=False)} bytes={len(raw)} mime={mime}")
            return self._ok(asset=asset)
        except Exception as exc:
            return self._error(exc)

    def begin_file_import(self, payload: Any) -> Dict[str, Any]:
        """Reserve a managed path and a temporary file for a complete file copy."""
        try:
            data = self._payload_dict(payload, "Некорректные данные файла.")
            file_name = safe_managed_file_name(data.get("name"))
            try:
                expected_size = int(data.get("size") or 0)
            except (TypeError, ValueError) as exc:
                raise ValueError("Некорректный размер файла.") from exc
            if expected_size < 0:
                raise ValueError("Размер файла не может быть отрицательным.")
            if expected_size > MAX_MANAGED_FILE_BYTES:
                raise ValueError("Файл превышает допустимый размер ZeTer OS.")

            ensure_dirs()
            MANAGED_FILE_INCOMING_DIR.mkdir(parents=True, exist_ok=True)
            free_bytes = shutil.disk_usage(DATA_DIR).free
            if free_bytes < expected_size + 64 * 1024 * 1024:
                raise OSError("Недостаточно свободного места для полной копии файла в ZeTer OS\\data.")

            raw_parts = data.get("directoryParts") if isinstance(data.get("directoryParts"), list) else []
            directory_parts = [
                safe_windows_name(part, "Папка", max_len=60)
                for part in raw_parts[:16]
                if str(part or "").strip()
            ]
            if not directory_parts:
                directory_parts = ["Рабочий стол", "Файлы"]
            destination_dir = MANAGED_FILE_ROOT_DIR.joinpath(*directory_parts)

            self._cleanup_expired_file_uploads()
            upload_id = secrets.token_urlsafe(18)
            temp_path = MANAGED_FILE_INCOMING_DIR / f"{upload_id}.part"
            with self._file_upload_lock:
                reserved = {
                    str(session.get("finalPath")).casefold()
                    for session in self._file_uploads.values()
                    if isinstance(session.get("finalPath"), Path)
                }
                final_path = unique_child_path(destination_dir / file_name, reserved)
                temp_path.touch(exist_ok=False)
                self._file_uploads[upload_id] = {
                    "tempPath": temp_path,
                    "finalPath": final_path,
                    "expectedSize": expected_size,
                    "receivedSize": 0,
                    "originalName": file_name,
                    "mime": normalize_mime(str(data.get("type") or "application/octet-stream")),
                    "startedAt": time.time(),
                }
            log(f"FILE_IMPORT begin id={upload_id} name={json.dumps(file_name, ensure_ascii=False)} bytes={expected_size}")
            return self._ok(uploadId=upload_id, chunkBytes=MANAGED_FILE_CHUNK_BYTES)
        except Exception as exc:
            return self._error(exc)

    def append_file_chunk(self, payload: Any) -> Dict[str, Any]:
        """Append one bounded Base64 chunk while enforcing strict byte offsets."""
        try:
            data = self._payload_dict(payload, "Некорректный фрагмент файла.")
            upload_id = str(data.get("uploadId") or "")
            with self._file_upload_lock:
                session = self._file_uploads.get(upload_id)
                if not session:
                    raise ValueError("Сеанс копирования файла не найден или устарел.")
                expected_offset = int(session.get("receivedSize") or 0)
                try:
                    offset = int(data.get("offset") or 0)
                except (TypeError, ValueError) as exc:
                    raise ValueError("Некорректная позиция фрагмента файла.") from exc
                if offset != expected_offset:
                    raise ValueError("Нарушен порядок фрагментов файла. Копирование остановлено.")
                encoded = re.sub(r"\s+", "", str(data.get("base64") or ""))
                if len(encoded) > ((MANAGED_FILE_CHUNK_BYTES + 2) // 3) * 4 + 8:
                    raise ValueError("Фрагмент файла превышает допустимый размер.")
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except (ValueError, TypeError) as exc:
                    raise ValueError("Фрагмент файла повреждён.") from exc
                if not raw or len(raw) > MANAGED_FILE_CHUNK_BYTES:
                    raise ValueError("Некорректный размер фрагмента файла.")
                next_size = expected_offset + len(raw)
                if next_size > int(session.get("expectedSize") or 0):
                    raise ValueError("Получено больше данных, чем заявлено для файла.")
                temp_path = session.get("tempPath")
                if not isinstance(temp_path, Path):
                    raise RuntimeError("Временный файл недоступен.")
                with temp_path.open("ab") as handle:
                    handle.write(raw)
                session["receivedSize"] = next_size
            return self._ok(receivedBytes=next_size)
        except Exception as exc:
            return self._error(exc)

    def finish_file_import(self, payload: Any) -> Dict[str, Any]:
        """Verify the complete byte count and atomically publish the copied file."""
        try:
            data = self._payload_dict(payload, "Некорректное завершение копирования файла.")
            upload_id = str(data.get("uploadId") or "")
            with self._file_upload_lock:
                session = self._file_uploads.get(upload_id)
                if not session:
                    raise ValueError("Сеанс копирования файла не найден или устарел.")
                expected_size = int(session.get("expectedSize") or 0)
                received_size = int(session.get("receivedSize") or 0)
                temp_path = session.get("tempPath")
                final_path = session.get("finalPath")
                if not isinstance(temp_path, Path) or not isinstance(final_path, Path):
                    raise RuntimeError("Путь копируемого файла повреждён.")
                actual_size = temp_path.stat().st_size if temp_path.exists() else -1
                if received_size != expected_size or actual_size != expected_size:
                    raise ValueError(f"Файл скопирован не полностью: {actual_size} из {expected_size} байт.")
                if final_path.exists():
                    reserved = {
                        str(other.get("finalPath")).casefold()
                        for other_id, other in self._file_uploads.items()
                        if other_id != upload_id and isinstance(other.get("finalPath"), Path)
                    }
                    final_path = unique_child_path(final_path, reserved)
                    session["finalPath"] = final_path
                final_path.parent.mkdir(parents=True, exist_ok=True)
                with temp_path.open("r+b") as handle:
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temp_path, final_path)
                self._file_uploads.pop(upload_id, None)
                relative_path = managed_file_relative_path(final_path)
                self._uncommitted_file_paths[relative_path.casefold()] = time.time()

            managed_file = {
                "id": f"file-{secrets.token_hex(8)}",
                "name": str(session.get("originalName") or final_path.name),
                "managedPath": relative_path,
                "size": expected_size,
                "mime": str(session.get("mime") or "application/octet-stream"),
                "extension": final_path.suffix.lower().lstrip("."),
                "importedAt": now_ms(),
            }
            log(f"FILE_IMPORT finish id={upload_id} file={json.dumps(str(final_path), ensure_ascii=False)} bytes={expected_size}")
            return self._ok(file=managed_file, filePath=str(final_path))
        except Exception as exc:
            return self._error(exc)

    def cancel_file_import(self, payload: Any) -> Dict[str, Any]:
        try:
            data = self._payload_dict(payload, "Некорректная отмена копирования файла.")
            upload_id = str(data.get("uploadId") or "")
            with self._file_upload_lock:
                session = self._file_uploads.pop(upload_id, None)
                temp_path = session.get("tempPath") if isinstance(session, dict) else None
                if isinstance(temp_path, Path):
                    temp_path.unlink(missing_ok=True)
            if session:
                log(f"FILE_IMPORT cancel id={upload_id}")
            return self._ok(cancelled=bool(session))
        except Exception as exc:
            return self._error(exc)

    def open_managed_file(self, payload: Any) -> Dict[str, Any]:
        """Open only a verified managed file copy with the OS default application."""
        try:
            data = self._payload_dict(payload, "Некорректная команда открытия файла.")
            path = managed_file_path(data.get("managedPath"), require_file=True)
            self._platform_opener.open_path(path)
            log(f"FILE_OPEN file={json.dumps(str(path), ensure_ascii=False)}")
            return self._ok(filePath=str(path))
        except Exception as exc:
            return self._error(exc)

    def open_external_target(self, payload: Any) -> Dict[str, Any]:
        """Open an explicit http(s) URL or absolute Windows path without a shell."""
        try:
            data = self._payload_dict(payload, "Некорректная команда открытия ярлыка.")
            target = str(data.get("target") or "").strip()
            if len(target) >= 2 and target[0] == target[-1] and target[0] in {'"', "'"}:
                target = target[1:-1].strip()
            if not target or len(target) > 32768 or "\x00" in target:
                raise ValueError("В ярлыке не указан корректный путь или адрес.")

            is_windows_path = bool(re.match(r"^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)", target))
            parsed = urlsplit(target)
            if parsed.scheme.lower() in {"http", "https"}:
                if not parsed.netloc:
                    raise ValueError("Адрес сайта не содержит домен.")
                self._platform_opener.open_url(target)
                log(f"SHORTCUT_OPEN kind=url host={json.dumps(parsed.hostname or '', ensure_ascii=False)}")
                return self._ok(kind="url")

            if parsed.scheme and not is_windows_path:
                raise ValueError("Разрешены только ссылки http/https и абсолютные пути Windows.")
            if not is_windows_path:
                raise ValueError("Укажи абсолютный путь Windows, например C:\\Папка\\файл.txt.")
            kind = self._platform_opener.open_windows_target(target)
            log(f"SHORTCUT_OPEN kind={kind} path={json.dumps(target, ensure_ascii=False)}")
            return self._ok(kind=kind)
        except Exception as exc:
            return self._error(exc)

    def save_text_download(self, payload: Any) -> Dict[str, Any]:
        """Показывает системный диалог и сохраняет выбранный текстовый файл."""
        try:
            if isinstance(payload, str):
                try:
                    payload = json.loads(payload)
                except json.JSONDecodeError:
                    payload = {"content": payload}
            if not isinstance(payload, dict):
                raise ValueError("Некорректные данные файла для скачивания.")

            file_name = self._safe_download_name(payload.get("name"), "download.txt")

            content = str(payload.get("content") or "")
            mime_type = str(payload.get("type") or "text/plain").split(";", 1)[0].strip().lower()
            encoding = "utf-8-sig" if mime_type == "text/csv" else "utf-8"
            raw = content.encode(encoding)
            if len(raw) > MAX_TEXT_DOWNLOAD_BYTES:
                raise ValueError("Файл слишком большой для скачивания из ZeTer OS.")

            target = self._choose_download_target(file_name, mime_type)
            if target is None:
                log(f"DOWNLOAD_TEXT cancelled name={json.dumps(file_name, ensure_ascii=False)} mime={mime_type}")
                return self._ok(cancelled=True, fileName=file_name)

            atomic_write_bytes(target, raw)
            log(f"DOWNLOAD_TEXT file={json.dumps(str(target), ensure_ascii=False)} bytes={len(raw)} mime={mime_type}")
            return self._ok(
                cancelled=False,
                fileName=target.name,
                directoryName=str(target.parent),
                filePath=str(target),
                bytes=len(raw),
            )
        except Exception as exc:
            return self._error(exc)

    def save_binary_download(self, payload: Any) -> Dict[str, Any]:
        """Показывает системный диалог и сохраняет переданный двоичный файл."""
        try:
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                raise ValueError("Некорректные данные двоичного файла для скачивания.")

            file_name = self._safe_download_name(payload.get("name"), "download.bin")
            mime_type = str(payload.get("type") or "application/octet-stream").split(";", 1)[0].strip().lower()
            encoded = re.sub(r"\s+", "", str(payload.get("base64") or ""))
            if len(encoded) > ((MAX_BINARY_DOWNLOAD_BYTES + 2) // 3) * 4:
                raise ValueError("Двоичный файл слишком большой для скачивания из ZeTer OS.")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise ValueError("Некорректные двоичные данные файла.") from exc
            if len(raw) > MAX_BINARY_DOWNLOAD_BYTES:
                raise ValueError("Двоичный файл слишком большой для скачивания из ZeTer OS.")

            target = self._choose_download_target(file_name, mime_type)
            if target is None:
                log(f"DOWNLOAD_BINARY cancelled name={json.dumps(file_name, ensure_ascii=False)} mime={mime_type}")
                return self._ok(cancelled=True, fileName=file_name)

            atomic_write_bytes(target, raw)
            log(f"DOWNLOAD_BINARY file={json.dumps(str(target), ensure_ascii=False)} bytes={len(raw)} mime={mime_type}")
            return self._ok(
                cancelled=False,
                fileName=target.name,
                directoryName=str(target.parent),
                filePath=str(target),
                bytes=len(raw),
            )
        except Exception as exc:
            return self._error(exc)

    def open_data_folder(self) -> Dict[str, Any]:
        try:
            ensure_dirs()
            self._platform_opener.open_path(DATA_DIR)
            return self._ok(dataDir=str(DATA_DIR))
        except Exception as exc:
            return self._error(exc)


    def open_logs_folder(self) -> Dict[str, Any]:
        try:
            ensure_dirs()
            self._platform_opener.open_path(LOG_DIR)
            return self._ok(logDir=str(LOG_DIR), logFile=str(LOG_FILE))
        except Exception as exc:
            return self._error(exc)


    def close_app(self) -> Dict[str, Any]:
        try:
            if self._window is None or not callable(getattr(self._window, "destroy", None)):
                raise RuntimeError("Окно ZeTer OS недоступно для безопасного закрытия.")
            log("CLOSE requested from recovery screen")
            self._window.destroy()
            return self._ok(closing=True)
        except Exception as exc:
            return self._error(exc)



    def open_readable_folder(self) -> Dict[str, Any]:
        try:
            ensure_dirs()
            READABLE_ROOT_DIR.mkdir(parents=True, exist_ok=True)
            self._platform_opener.open_path(READABLE_ROOT_DIR)
            return self._ok(readableDir=str(READABLE_ROOT_DIR))
        except Exception as exc:
            return self._error(exc)


    def load_state(self) -> Dict[str, Any]:
        try:
            if not STATE_FILE.exists():
                return self._ok(record=None)
            record = read_json_file(STATE_FILE)
            if not isinstance(record, dict) or not record:
                raise ValueError("Основной файл состояния существует, но не содержит корректный JSON-объект.")
            if isinstance(record, dict) and "state" not in record:
                # Поддержка случая, если кто-то вручную положил в файл «голый» state.
                normalize_portable_state_metadata(record)
                sync_legacy_workspace_aliases(record)
                record = {
                    "id": "current",
                    "app": APP_NAME,
                    "storageMode": "python-data-folder",
                    "updatedAt": int(STATE_FILE.stat().st_mtime * 1000),
                    "stateBytes": json_bytes(record),
                    "state": record,
                }
            elif isinstance(record, dict):
                if not isinstance(record.get("state"), dict):
                    raise ValueError("В основном файле состояния отсутствует корректный объект state.")
                normalize_portable_state_metadata(record.get("state"))
                sync_legacy_workspace_aliases(record.get("state"))
            return self._ok(record=record)
        except Exception as exc:
            return self._error(exc)

    def _write_and_confirm_primary_state(self, clean_record: Dict[str, Any]) -> tuple[bool, bytes]:
        previous_existed = STATE_FILE.exists()
        previous_bytes = STATE_FILE.read_bytes() if previous_existed else b""
        try:
            atomic_write_json(STATE_FILE, clean_record)
            confirmed = read_json_file(STATE_FILE)
            if not isinstance(confirmed, dict) or not isinstance(confirmed.get("state"), dict):
                raise RuntimeError("Записанный основной файл не содержит корректный объект state.")
            if confirmed != clean_record:
                raise RuntimeError("Повторное чтение основного файла не совпало с подготовленной записью.")
            return previous_existed, previous_bytes
        except Exception as primary_error:
            rollback_error = None
            try:
                if previous_existed:
                    current_bytes = STATE_FILE.read_bytes() if STATE_FILE.exists() else None
                    if current_bytes != previous_bytes:
                        atomic_write_bytes(STATE_FILE, previous_bytes)
                elif STATE_FILE.exists():
                    STATE_FILE.unlink()
            except Exception as exc:
                rollback_error = exc
            if rollback_error is not None:
                raise RuntimeError(
                    f"Не удалось подтвердить основной state ({primary_error}); "
                    f"также не удалось вернуть предыдущий файл ({rollback_error})."
                ) from primary_error
            raise

    def save_state(self, record: Any) -> Dict[str, Any]:
        with self._state_save_lock:
            return self._save_state_locked(record)

    def _save_state_locked(self, record: Any) -> Dict[str, Any]:
        try:
            if isinstance(record, str):
                record = json.loads(record)
            if not isinstance(record, dict):
                raise ValueError("Состояние должно быть JSON-объектом.")
            prepared_record = json.loads(json.dumps(record, ensure_ascii=False, allow_nan=False))
            state = prepared_record.get("state")
            if not isinstance(state, dict):
                raise ValueError("В записи состояния нет объекта state.")
            normalized_portable_metadata = normalize_portable_state_metadata(state)
            normalized_workspace_aliases = sync_legacy_workspace_aliases(state)
            purged_deleted = purge_deleted_items_from_state(state)

            updated_at = now_ms()
            clean_record = {
                "id": "current",
                "app": APP_NAME,
                "osVersion": prepared_record.get("osVersion") or prepared_record.get("version") or "",
                "versionNumber": prepared_record.get("versionNumber") or 0,
                "storageMode": "python-data-folder",
                "updatedAt": updated_at,
                "savedAt": datetime.now().isoformat(timespec="seconds"),
                "stateBytes": json_bytes(state),
                "state": state,
            }

            previous_existed, previous_bytes = self._write_and_confirm_primary_state(clean_record)

            backup_error = ""
            previous_backup = ""
            removed_backups = 0
            if previous_existed and time.time() - self._last_previous_backup_at > 15:
                try:
                    backup_path = BACKUP_DIR / (
                        f"zeter-os-state-previous-{updated_at}-{secrets.token_hex(3)}.json"
                    )
                    atomic_write_bytes(backup_path, previous_bytes)
                    previous_backup = str(backup_path)
                    self._last_previous_backup_at = time.time()
                    removed_backups = prune_backups()
                except Exception as exc:
                    backup_error = str(exc)
                    log(f"BACKUP previous snapshot error: {exc}")

            readable_error = ""
            try:
                readable = export_windows_readable_data(state)
            except Exception as exc:
                readable_error = str(exc)
                log(f"WINDOWS_READABLE save error: {exc}")
                readable = {
                    "readableDir": str(READABLE_ROOT_DIR),
                    "readableFiles": sum(1 for path in READABLE_ROOT_DIR.rglob("*") if path.is_file()) if READABLE_ROOT_DIR.exists() else 0,
                    "readableBytes": sum(path.stat().st_size for path in READABLE_ROOT_DIR.rglob("*") if path.is_file()) if READABLE_ROOT_DIR.exists() else 0,
                }

            payload_gc_error = ""
            try:
                payload_gc = self._garbage_collect_payload(state)
            except Exception as exc:
                payload_gc_error = str(exc)
                log(f"PAYLOAD_GC save error: {exc}")
                payload_gc = {
                    "payloadGcOk": False,
                    "payloadGcSkipped": True,
                    "payloadGcErrors": [payload_gc_error],
                    "managedFiles": 0,
                    "managedFilesRemoved": 0,
                    "managedFilesRemovedBytes": 0,
                    "itemAssets": 0,
                    "itemAssetsRemoved": 0,
                    "itemAssetsRemovedBytes": 0,
                }

            payload_gc_ok = bool(payload_gc.get("payloadGcOk"))
            payload_error_text = payload_gc_error or "; ".join(payload_gc.get("payloadGcErrors") or [])
            log(f"SAVE primaryVerified=True stateBytes={clean_record['stateBytes']} backupOk={not backup_error} removedBackups={removed_backups} readableOk={not readable_error} readableFiles={readable.get('readableFiles')} portableMetadata={normalized_portable_metadata} workspaceAliases={normalized_workspace_aliases} purgedDeleted={purged_deleted} payloadGcOk={payload_gc_ok} managedFiles={payload_gc.get('managedFiles')} managedFilesRemoved={payload_gc.get('managedFilesRemoved')} itemAssets={payload_gc.get('itemAssets')} itemAssetsRemoved={payload_gc.get('itemAssetsRemoved')} readableDir={readable.get('readableDir')}")
            return self._ok(
                updatedAt=updated_at,
                stateBytes=clean_record["stateBytes"],
                stateFile=str(STATE_FILE),
                primaryVerified=True,
                portableMetadata=normalized_portable_metadata,
                workspaceAliases=normalized_workspace_aliases,
                purgedDeleted=purged_deleted,
                purgedRestore=0,
                backupOk=not backup_error,
                backupError=backup_error,
                previousBackup=previous_backup,
                removedBackups=removed_backups,
                readableOk=not readable_error,
                readableError=readable_error,
                managedOk=payload_gc_ok,
                managedError=payload_error_text,
                itemAssetsOk=payload_gc_ok,
                itemAssetsError=payload_error_text,
                **payload_gc,
                **readable,
            )
        except Exception as exc:
            message = f"Основной state не сохранён и не подтверждён: {exc}"
            log(f"SAVE_ERROR stage=primary-confirm error={type(exc).__name__}: {exc}")
            return {"ok": False, "error": message, "stage": "primary-confirm"}

    def clear_state(self) -> Dict[str, Any]:
        with self._state_save_lock:
            try:
                backup_file = ""
                if STATE_FILE.exists():
                    previous_bytes = STATE_FILE.read_bytes()
                    backup_path = BACKUP_DIR / (
                        f"zeter-os-state-before-reset-{now_ms()}-{secrets.token_hex(3)}.json"
                    )
                    atomic_write_bytes(backup_path, previous_bytes)
                    if backup_path.read_bytes() != previous_bytes:
                        raise RuntimeError("Страховочная копия перед сбросом не прошла повторную проверку.")
                    backup_file = str(backup_path)
                    prune_backups()
                    STATE_FILE.unlink()

                readable_error = ""
                try:
                    if READABLE_ROOT_DIR.exists():
                        shutil.rmtree(READABLE_ROOT_DIR)
                    if READABLE_SUMMARY_FILE.exists():
                        READABLE_SUMMARY_FILE.unlink()
                except Exception as exc:
                    readable_error = str(exc)
                    log(f"CLEAR_STATE readable cleanup error: {exc}")

                with self._file_upload_lock:
                    self._file_uploads.clear()
                    self._uncommitted_file_paths.clear()
                payload_gc = self._garbage_collect_payload({})
                log(
                    f"CLEAR_STATE backup={json.dumps(backup_file, ensure_ascii=False)} "
                    f"readableOk={not readable_error} payloadGcOk={payload_gc.get('payloadGcOk')}"
                )
                return self._ok(
                    backupFile=backup_file,
                    readableOk=not readable_error,
                    readableError=readable_error,
                    **payload_gc,
                )
            except Exception as exc:
                return self._error(exc)

    def load_restore_points(self) -> Dict[str, Any]:
        try:
            with self._restore_points_lock:
                points = read_json_file(RESTORE_FILE) or []
                if not isinstance(points, list):
                    points = []
                for point in points:
                    if isinstance(point, dict):
                        state = point.get("state")
                        changed = normalize_portable_state_metadata(state) + sync_legacy_workspace_aliases(state)
                        if changed and isinstance(state, dict):
                            point["stateBytes"] = json_bytes(state)
                points.sort(key=lambda item: int(item.get("createdAt") or 0) if isinstance(item, dict) else 0, reverse=True)
                return self._ok(points=points[:RESTORE_LIMIT])
        except Exception as exc:
            return self._error(exc)

    def preflight_restore_point(self, point_id: Any) -> Dict[str, Any]:
        try:
            safe_id = str(point_id or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,220}", safe_id):
                raise ValueError("Некорректный ID точки восстановления.")
            with self._restore_points_lock:
                points = read_json_file(RESTORE_FILE) or []
                if not isinstance(points, list):
                    raise ValueError("Файл точек восстановления повреждён.")
                point = next(
                    (
                        item
                        for item in points
                        if isinstance(item, dict) and str(item.get("id") or "") == safe_id
                    ),
                    None,
                )
                if not isinstance(point, dict) or not isinstance(point.get("state"), dict):
                    raise ValueError("Выбранная точка восстановления отсутствует или повреждена.")
                preflight = self._preflight_state_payload(point["state"])
            if not preflight["ready"]:
                missing = [
                    *preflight["missingManagedFiles"],
                    *preflight["missingItemAssets"],
                    *preflight["invalidManagedPaths"],
                    *preflight["invalidItemAssetPaths"],
                ]
                preflight["message"] = (
                    "Точка не применена. Отсутствуют или небезопасны payload-файлы: "
                    + ", ".join(missing)
                    + ". Восстанови их из проверенного ZIP-бэкапа и повтори операцию."
                )
            else:
                preflight["message"] = "Все необходимые payload-файлы точки доступны."
            log(
                f"RESTORE_PREFLIGHT id={safe_id} ready={preflight['ready']} "
                f"managed={preflight['managedFilesRequired']} assets={preflight['itemAssetsRequired']}"
            )
            return self._ok(pointId=safe_id, **preflight)
        except Exception as exc:
            return self._error(exc)

    def save_restore_point(self, point: Any) -> Dict[str, Any]:
        try:
            if isinstance(point, str):
                point = json.loads(point)
            if not isinstance(point, dict) or not isinstance(point.get("state"), dict):
                raise ValueError("Некорректная точка восстановления.")
            point = json.loads(json.dumps(point, ensure_ascii=False, allow_nan=False))

            normalize_portable_state_metadata(point["state"])
            sync_legacy_workspace_aliases(point["state"])
            inspected = inspect_payload_references(point["state"])
            if inspected["invalidManaged"] or inspected["invalidItemAssets"]:
                invalid = [*inspected["invalidManaged"], *inspected["invalidItemAssets"]]
                raise ValueError(f"Точка содержит небезопасные payload-пути: {', '.join(invalid)}")
            point["stateBytes"] = json_bytes(point["state"])
            point["storageMode"] = "python-data-folder"
            point["createdAt"] = int(point.get("createdAt") or now_ms())
            with self._state_save_lock:
                with self._restore_points_lock:
                    points = read_json_file(RESTORE_FILE) or []
                    if not isinstance(points, list):
                        points = []
                    points = [p for p in points if isinstance(p, dict) and p.get("id") != point.get("id")]
                    points.append(point)
                    points.sort(key=lambda item: int(item.get("createdAt") or 0), reverse=True)
                    points = points[:RESTORE_LIMIT]
                    atomic_write_json(RESTORE_FILE, points)
                    payload_gc = self._garbage_collect_payload()
                    return self._ok(count=len(points), restoreFile=str(RESTORE_FILE), **payload_gc)
        except Exception as exc:
            return self._error(exc)

    def delete_restore_point(self, point_id: Any) -> Dict[str, Any]:
        try:
            safe_id = str(point_id or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,220}", safe_id):
                raise ValueError("Некорректный ID точки восстановления.")
            with self._state_save_lock:
                with self._restore_points_lock:
                    points = read_json_file(RESTORE_FILE) or []
                    if not isinstance(points, list):
                        points = []
                    kept = [point for point in points if not isinstance(point, dict) or point.get("id") != safe_id]
                    removed = len(points) - len(kept)
                    if removed:
                        atomic_write_json(RESTORE_FILE, kept[:RESTORE_LIMIT])
                        log(f"RESTORE_POINT delete id={safe_id} remaining={len(kept)}")
                    payload_gc = self._garbage_collect_payload() if removed else {}
                    return self._ok(removed=removed, count=len(kept), **payload_gc)
        except Exception as exc:
            return self._error(exc)

    def cleanup_security_artifacts(self, payload: Any) -> Dict[str, Any]:
        try:
            data = json.loads(payload) if isinstance(payload, str) else payload
            data = data if isinstance(data, dict) else {}
            dry_run = bool(data.get("dryRun", True))
            clean_logs = bool(data.get("logs", False))
            clean_backups = bool(data.get("backups", False))
            clean_temp = bool(data.get("temporary", False))
            keep_log_bytes = 256 * 1024
            now_value = time.time()

            log_reclaim = max(0, LOG_FILE.stat().st_size - keep_log_bytes) if clean_logs and LOG_FILE.exists() else 0
            backups = sorted([path for path in BACKUP_DIR.glob("*.json") if path.is_file()], key=lambda path: path.stat().st_mtime, reverse=True) if BACKUP_DIR.exists() else []
            old_backups = [path for index, path in enumerate(backups) if index >= 3 and now_value - path.stat().st_mtime > 90 * 24 * 60 * 60] if clean_backups else []
            temp_candidates = []
            if clean_temp:
                explicit_temp = [STATE_FILE.with_suffix(STATE_FILE.suffix + ".tmp"), RESTORE_FILE.with_suffix(RESTORE_FILE.suffix + ".tmp")]
                explicit_temp.extend(BACKUP_DIR.glob("*.tmp") if BACKUP_DIR.exists() else [])
                explicit_temp.extend(DATA_DIR.rglob(".zeter-atomic-*.tmp") if DATA_DIR.exists() else [])
                temp_candidates = [
                    path for path in dict.fromkeys(explicit_temp)
                    if path.exists() and path.is_file() and now_value - path.stat().st_mtime > 24 * 60 * 60
                ]

            backup_reclaim = sum(path.stat().st_size for path in old_backups)
            temp_reclaim = sum(path.stat().st_size for path in temp_candidates)
            removed_backups = 0
            removed_temp = 0
            payload_gc: Dict[str, Any] = {}
            if not dry_run:
                if clean_logs and log_reclaim:
                    raw = LOG_FILE.read_bytes()[-keep_log_bytes:]
                    atomic_write_text(LOG_FILE, raw.decode("utf-8", errors="replace"))
                for path in old_backups:
                    path.unlink(missing_ok=True)
                    removed_backups += 1
                for path in temp_candidates:
                    path.unlink(missing_ok=True)
                    removed_temp += 1
                if removed_backups:
                    payload_gc = self._garbage_collect_payload()
                log(f"SECURITY_CLEANUP freed={log_reclaim + backup_reclaim + temp_reclaim} backups={removed_backups} temp={removed_temp}")

            return self._ok(
                dryRun=dry_run,
                reclaimBytes=log_reclaim + backup_reclaim + temp_reclaim,
                logBytes=log_reclaim,
                backupBytes=backup_reclaim,
                backupFiles=len(old_backups),
                temporaryBytes=temp_reclaim,
                temporaryFiles=len(temp_candidates),
                removedBackups=removed_backups,
                removedTemporary=removed_temp,
                **payload_gc,
            )
        except Exception as exc:
            return self._error(exc)

    def clear_restore_points(self) -> Dict[str, Any]:
        try:
            with self._state_save_lock:
                with self._restore_points_lock:
                    backup_file = ""
                    if RESTORE_FILE.exists():
                        restore_bytes = RESTORE_FILE.read_bytes()
                        backup_path = BACKUP_DIR / (
                            f"restore-points-before-reset-{now_ms()}-{secrets.token_hex(3)}.json"
                        )
                        atomic_write_bytes(backup_path, restore_bytes)
                        if backup_path.read_bytes() != restore_bytes:
                            raise RuntimeError("Копия точек восстановления перед очисткой не прошла проверку.")
                        backup_file = str(backup_path)
                        prune_backups()
                        RESTORE_FILE.unlink()
                    payload_gc = self._garbage_collect_payload()
                    return self._ok(backupFile=backup_file, **payload_gc)
        except Exception as exc:
            return self._error(exc)


def start_local_server() -> tuple[ThreadingHTTPServer, int]:
    if not APP_DIR.exists() or not (APP_DIR / "index.html").exists():
        raise FileNotFoundError("Не найдена папка app или файл app/index.html рядом с run_zeter_os.py.")
    port = find_free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port


def startup_window_maximized() -> bool:
    """Read the next-launch window mode from the saved state without changing it."""
    if not STATE_FILE.exists():
        return True
    try:
        record = read_json_file(STATE_FILE)
        state = record.get("state") if isinstance(record, dict) and isinstance(record.get("state"), dict) else record
        if not isinstance(state, dict):
            return True
        system_settings = state.get("systemSettings")
        startup = system_settings.get("startup") if isinstance(system_settings, dict) else None
        return not (isinstance(startup, dict) and startup.get("windowMode") == "windowed")
    except Exception as exc:
        log(f"STARTUP WINDOW SETTINGS WARNING: {exc}")
        return True


def main() -> int:
    ensure_dirs()
    try:
        import webview  # type: ignore
    except ModuleNotFoundError:
        print("pywebview не установлен.")
        print("Установи зависимости командой:")
        print("  py -3 -m pip install -r requirements.txt")
        print("Потом запусти:")
        print("  py -3 run_zeter_os.py")
        return 1

    server: Optional[ThreadingHTTPServer] = None
    try:
        server, port = start_local_server()
        url = f"http://127.0.0.1:{port}/index.html?native=1"
        api = NativeStorageApi()
        log(f"START {APP_NAME} on {url}; data={DATA_DIR}")
        window = webview.create_window(
            APP_NAME,
            url,
            js_api=api,
            width=1320,
            height=840,
            min_size=(1024, 640),
            maximized=startup_window_maximized(),
            text_select=True,
        )
        api._window = window
        webview.start(debug=False)
        return 0
    except Exception as exc:
        log(f"FATAL: {exc}")
        print(f"Ошибка запуска ZeTer OS: {exc}")
        return 1
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
            log("STOP ZeTer OS")


if __name__ == "__main__":
    raise SystemExit(main())
