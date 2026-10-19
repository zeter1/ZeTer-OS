"""Bounded, isolated LibreOffice conversion for managed Word documents.

This module never publishes into storage. Its caller owns publication and recovery.
"""
from __future__ import annotations

import base64
import ctypes
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

from problem_logs import plain_path

MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
MAX_HTML_BYTES = 16 * 1024 * 1024
MAX_EXPANDED_BYTES = 128 * 1024 * 1024
CONVERSION_TIMEOUT = 45
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ALLOWED_TAGS = {"a", "p", "div", "span", "br", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "img", "hr"}
VOID_TAGS = {"br", "img", "hr"}
IMAGE_MIMES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp"}
STYLE_PROPERTIES = {"font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "color", "background-color", "vertical-align", "margin-left", "margin-right", "margin-top", "margin-bottom", "padding", "border", "border-collapse", "width", "height"}
PENDING_SUFFIX = ".document-pending.json"
PENDING_OWNER = "zeter-managed-document-pending-v1"


def _safe_hyperlink(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return len(value) <= 4096 and not any(ord(ch) < 32 for ch in value) and parsed.scheme.lower() in {"http", "https"} and bool(parsed.hostname) and parsed.username is None and parsed.password is None
    except ValueError:
        return False


def checked_managed_path(data_root: Path, managed_root: Path, relative: str) -> Path:
    """Reject links before resolve, including links pointing back inside storage."""
    if not isinstance(relative, str) or len(relative) > 1024:
        raise ValueError("Некорректный путь документа.")
    parts = relative.replace("\\", "/").split("/")
    if not parts or parts[0] != managed_root.name or any(not part or part in {".", ".."} or ":" in part for part in parts):
        raise ValueError("Документ должен находиться в папке файлов ZeTer OS.")
    target = data_root.joinpath(*parts)
    if not plain_path(data_root, target):
        raise ValueError("Ссылки и перенаправления пути документа запрещены.")
    target.resolve().relative_to(managed_root.resolve())
    return target


def pending_documents(data_root: Path, managed_root: Path) -> list[tuple[Path, Path, dict]]:
    """Conservative durable recovery set; malformed ownership blocks deletion."""
    result = []
    if not managed_root.exists():
        return result
    for directory, dirs, files in os.walk(managed_root, followlinks=False):
        for name in dirs + files:
            if not plain_path(data_root, Path(directory) / name):
                raise ValueError("Небезопасная ссылка в папке файлов; очистка остановлена.")
        for name in files:
            if not name.endswith(PENDING_SUFFIX):
                continue
            marker = Path(directory) / name
            if marker.stat().st_size > 2048:
                raise ValueError("Некорректный recovery-маркер документа; очистка остановлена.")
            record = json.loads(marker.read_text(encoding="utf-8"))
            if not isinstance(record, dict) or set(record) != {"owner", "managedPath", "sha256"} or record.get("owner") != PENDING_OWNER or not re.fullmatch(r"[a-f0-9]{64}", str(record.get("sha256", ""))):
                raise ValueError("Неизвестный recovery-маркер документа; данные сохранены.")
            target = checked_managed_path(data_root, managed_root, record["managedPath"])
            if marker != target.with_name("." + target.name + PENDING_SUFFIX) or target.suffix.lower() != ".docx":
                raise ValueError("Recovery-маркер ссылается на другой документ; данные сохранены.")
            if target.exists() and (not target.is_file() or target.stat().st_size > MAX_DOCUMENT_BYTES or hashlib.sha256(target.read_bytes()).hexdigest() != record["sha256"]):
                raise ValueError("Не удалось подтвердить recovery-документ; данные сохранены.")
            result.append((marker, target, record))
            if len(result) > 32:
                raise ValueError("Превышен лимит recovery-документов; очистка остановлена.")
    return result


class LibreOfficeNotFoundError(RuntimeError):
    """The optional local converter is not installed; the imported file is intact."""


def find_libreoffice() -> Path:
    candidates = [Path(os.environ[key]) / "LibreOffice/program/soffice.com"
                  for key in ("ProgramFiles", "ProgramFiles(x86)") if os.environ.get(key)]
    resolved = shutil.which("soffice.com") or shutil.which("libreoffice") or shutil.which("soffice")
    if resolved:
        candidates.append(Path(resolved))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise LibreOfficeNotFoundError("Для редактирования DOC/DOCX требуется LibreOffice. Копия документа сохранена в data.")


class _WindowsJob:
    """Kill only this launch's descendants, including after soffice.com exits."""
    def __init__(self):
        self.handle = None
        if os.name != "nt":
            return
        from ctypes import wintypes
        class BASIC(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong), ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_ulonglong) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
        class EXTENDED(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", BASIC), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        limits = EXTENDED()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        if not self.handle or not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise OSError("Не удалось изолировать процесс LibreOffice.")

    def assign(self, process):
        if self.handle and not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            process.kill()
            process.wait(timeout=5)
            raise OSError("Не удалось ограничить дерево процесса LibreOffice.")

    def resume(self, process):
        """Resume the primary thread only after the suspended process joins our job."""
        if not self.handle:
            return
        from ctypes import wintypes
        class THREADENTRY32(ctypes.Structure):
            _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ThreadID", wintypes.DWORD), ("th32OwnerProcessID", wintypes.DWORD), ("tpBasePri", wintypes.LONG), ("tpDeltaPri", wintypes.LONG), ("dwFlags", wintypes.DWORD)]
        kernel = self.kernel
        kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
        kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        kernel.Thread32First.argtypes = [wintypes.HANDLE, ctypes.POINTER(THREADENTRY32)]
        kernel.Thread32Next.argtypes = [wintypes.HANDLE, ctypes.POINTER(THREADENTRY32)]
        kernel.OpenThread.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenThread.restype = wintypes.HANDLE
        kernel.ResumeThread.argtypes = [wintypes.HANDLE]
        kernel.ResumeThread.restype = wintypes.DWORD
        snapshot = kernel.CreateToolhelp32Snapshot(0x4, 0)  # TH32CS_SNAPTHREAD
        if snapshot in (None, ctypes.c_void_p(-1).value):
            raise OSError("Не удалось найти приостановленный поток LibreOffice.")
        try:
            entry = THREADENTRY32()
            entry.dwSize = ctypes.sizeof(entry)
            threads = []
            available = kernel.Thread32First(snapshot, ctypes.byref(entry))
            while available:
                if entry.th32OwnerProcessID == process.pid:
                    threads.append(entry.th32ThreadID)
                entry.dwSize = ctypes.sizeof(entry)
                available = kernel.Thread32Next(snapshot, ctypes.byref(entry))
            if len(threads) != 1:
                raise OSError("Не удалось подтвердить первичный поток LibreOffice.")
            thread = kernel.OpenThread(0x2, False, threads[0])  # THREAD_SUSPEND_RESUME
            if not thread:
                raise OSError("Не удалось открыть приостановленный поток LibreOffice.")
            try:
                if kernel.ResumeThread(thread) != 1:
                    raise OSError("Не удалось возобновить изолированный LibreOffice.")
            finally:
                kernel.CloseHandle(thread)
        finally:
            kernel.CloseHandle(snapshot)

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def _run_conversion(source: Path, output: Path, profile: Path, target_format: str) -> Path:
    executable = find_libreoffice()
    output.mkdir()
    user = profile / "user"
    user.mkdir(parents=True)
    # Fresh profile: no trusted locations, disabled macro engines and active OLE/DDE.
    (user / "registrymodifications.xcu").write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop><prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="SecureURL" oor:op="fuse"><value/></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop><prop oor:name="Field" oor:op="fuse"><value>false</value></prop><prop oor:name="Chart" oor:op="fuse"><value>false</value></prop></item>
</oor:items>''', encoding="utf-8")
    args = [str(executable), "-env:UserInstallation=" + profile.as_uri(), "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore", "--convert-to", target_format, "--outdir", str(output), str(source)]
    job = _WindowsJob()
    process = None
    try:
        # CREATE_SUSPENDED closes the launch→assignment race: no converter code
        # (and therefore no helper) can run before job ownership is established.
        flags = subprocess.CREATE_NO_WINDOW | 0x4 if os.name == "nt" else 0
        process = subprocess.Popen(args, cwd=str(source.parent), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
        job.assign(process)
        job.resume(process)
        try:
            code = process.wait(timeout=CONVERSION_TIMEOUT)
        except subprocess.TimeoutExpired as exc:
            job.close()
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            raise TimeoutError("LibreOffice не завершил преобразование за 45 секунд. Исходный файл сохранён.") from exc
        if code:
            raise RuntimeError(f"LibreOffice завершил преобразование с ошибкой ({code}).")
    finally:
        job.close()
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=5)
    suffix = target_format.split(":", 1)[0]
    result = output / (source.stem + "." + suffix)
    if not plain_path(output, result) or not result.is_file() or not 0 < result.stat().st_size <= MAX_DOCUMENT_BYTES:
        raise ValueError("LibreOffice не создал допустимый документ.")
    return result


def inspect_docx(path: Path) -> dict:
    if not 0 < path.stat().st_size <= MAX_DOCUMENT_BYTES:
        raise ValueError("Размер документа должен быть от 1 байта до 32 МБ.")
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > 10000 or sum(entry.file_size for entry in entries) > MAX_EXPANDED_BYTES:
            raise ValueError("Слишком большой распакованный DOCX.")
        names = {entry.filename for entry in entries}
        if "word/document.xml" not in names or "[Content_Types].xml" not in names:
            raise ValueError("Файл не является документом DOCX.")
        for entry in entries:
            name = entry.filename.casefold()
            if entry.flag_bits & 1 or "vbaproject" in name or name.startswith("word/embeddings/"):
                raise ValueError("Макросы, шифрование и встроенные активные объекты не поддерживаются.")
            if name.endswith(".rels"):
                root = ET.fromstring(archive.read(entry))
                for rel in root:
                    if rel.get("TargetMode", "").casefold() == "external":
                        if not (rel.get("Type", "").endswith("/hyperlink") and _safe_hyperlink(rel.get("Target", ""))):
                            raise ValueError("Документ содержит внешние ресурсы. Удалите их в офисном редакторе.")
        root = ET.fromstring(archive.read("word/document.xml"))
        if root.find(W + "body") is None:
            raise ValueError("В DOCX отсутствует содержимое документа.")
        fields = " ".join([node.text or "" for node in root.iter(W + "instrText")] + [node.get(W + "instr", "") for node in root.iter(W + "fldSimple")])
        if re.search(r"\b(?:DDE|INCLUDETEXT|INCLUDEPICTURE|DATABASE)\b", fields, re.I):
            raise ValueError("Автоматические внешние поля документа не поддерживаются.")
        image_tags = {"{http://schemas.openxmlformats.org/drawingml/2006/main}blip", "{urn:schemas-microsoft-com:vml}imagedata"}
        return {"text": "".join(node.text or "" for node in root.iter(W + "t")), "tables": len(list(root.iter(W + "tbl"))), "images": sum(node.tag in image_tags for node in root.iter())}


def _image_data(value: str, image_root: Path | None) -> str:
    if value.startswith("data:"):
        match = re.fullmatch(r"data:(image/(?:png|jpeg|gif|webp|bmp));base64,([A-Za-z0-9+/=\s]+)", value, re.I)
        if not match:
            raise ValueError("Неподдерживаемая встроенная картинка документа.")
        raw = base64.b64decode(re.sub(r"\s", "", match[2]), validate=True)
        mime = match[1].lower()
    else:
        parsed = urlsplit(value)
        if image_root is None or parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError("Внешние картинки документа запрещены.")
        path = image_root / unquote(parsed.path)
        if not plain_path(image_root, path) or not path.is_file():
            raise ValueError("Картинка документа выходит за безопасную папку.")
        if not 0 < path.stat().st_size <= 8 * 1024 * 1024:
            raise ValueError("Картинка документа слишком большая.")
        mime = IMAGE_MIMES.get(path.suffix.lower().lstrip("."))
        if not mime:
            raise ValueError("Формат картинки документа не поддерживается.")
        raw = path.read_bytes()
    if not 0 < len(raw) <= 8 * 1024 * 1024:
        raise ValueError("Картинка документа слишком большая.")
    signatures = {"image/png": raw.startswith(b"\x89PNG\r\n\x1a\n"), "image/jpeg": raw.startswith(b"\xff\xd8\xff"), "image/gif": raw.startswith((b"GIF87a", b"GIF89a")), "image/webp": raw.startswith(b"RIFF") and raw[8:12] == b"WEBP", "image/bmp": raw.startswith(b"BM")}
    if not signatures[mime]:
        raise ValueError("Содержимое картинки не соответствует её формату.")
    return "data:" + mime + ";base64," + base64.b64encode(raw).decode("ascii")


class _SafeHTML(HTMLParser):
    def __init__(self, image_root):
        super().__init__(convert_charrefs=True)
        self.image_root, self.parts, self.skip = image_root, [], []
        self.text, self.tables, self.images = [], 0, 0

    def handle_starttag(self, tag, attributes):
        if self.skip:
            if tag not in VOID_TAGS and tag not in {"meta", "link", "input"}:
                self.skip.append(tag)
            return
        if tag in {"head", "script", "style", "iframe", "object", "svg", "math"}:
            self.skip.append(tag)
            return
        if tag not in ALLOWED_TAGS:
            return
        attrs = dict(attributes)
        safe = []
        if tag == "a" and _safe_hyperlink(attrs.get("href", "")):
            safe.append(("href", attrs["href"]))
        if tag == "img":
            safe.append(("src", _image_data(attrs.get("src", ""), self.image_root)))
            self.images += 1
        if tag == "table":
            self.tables += 1
        for key in ("colspan", "rowspan", "width", "height", "start"):
            value = attrs.get(key, "")
            if re.fullmatch(r"[0-9]{1,4}%?", value):
                safe.append((key, value))
        if attrs.get("align", "") in {"left", "right", "center", "justify"}:
            safe.append(("align", attrs["align"]))
        styles = []
        for item in attrs.get("style", "").split(";"):
            key, sep, value = item.partition(":")
            key, value = key.strip().lower(), value.strip()
            if sep and key in STYLE_PROPERTIES and len(value) <= 200 and re.fullmatch(r"[a-zA-Z0-9\s#.,()%+'\"-]+", value) and not re.search(r"url|expression|var\s*\(", value, re.I):
                styles.append(key + ":" + value)
        if styles:
            safe.append(("style", ";".join(styles)))
        self.parts.append("<" + tag + "".join(' ' + key + '="' + html.escape(value, quote=True) + '"' for key, value in safe) + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.skip:
            if tag == self.skip[-1]:
                self.skip.pop()
            return
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS:
            self.parts.append("</" + tag + ">")

    def handle_data(self, data):
        if not self.skip:
            self.text.append(data)
            self.parts.append(html.escape(data))


def sanitize_html(value: str, image_root: Path | None = None) -> tuple[str, dict]:
    if not isinstance(value, str) or len(value.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Содержимое документа превышает 16 МБ.")
    parser = _SafeHTML(image_root)
    parser.feed(value)
    parser.close()
    result = "".join(parser.parts)
    if len(result.encode("utf-8")) > MAX_HTML_BYTES:
        raise ValueError("Документ с картинками превышает 16 МБ.")
    return result, {"text": "".join(parser.text), "tables": parser.tables, "images": parser.images}


def _compact(value: str) -> str:
    return "".join(value.split())


def read_document(path: Path) -> dict:
    if path.suffix.lower() not in {".doc", ".docx"} or not 0 < path.stat().st_size <= MAX_DOCUMENT_BYTES:
        raise ValueError("Поддерживаются DOC/DOCX размером до 32 МБ.")
    original = path.read_bytes()
    with tempfile.TemporaryDirectory(prefix="zeter-document-") as temp:
        root = Path(temp)
        source = root / ("document" + path.suffix.lower())
        source.write_bytes(original)
        if source.suffix == ".doc":
            if not original.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
                raise ValueError("Файл не является документом DOC.")
            source = _run_conversion(source, root / "docx", root / "profile-docx", 'docx:Office Open XML Text')
        semantics = inspect_docx(source)
        converted = _run_conversion(source, root / "html", root / "profile-html", 'html:HTML (StarWriter)')
        raw = converted.read_bytes()
        charset = re.search(br'charset\s*=\s*["\']?([A-Za-z0-9_-]+)', raw[:4096], re.I)
        encoding = charset[1].decode("ascii") if charset else "utf-8"
        safe, content = sanitize_html(raw.decode(encoding), converted.parent)
        if _compact(semantics["text"]) not in _compact(content["text"]) or content["tables"] < semantics["tables"] or content["images"] < semantics["images"]:
            raise ValueError("Преобразование не сохранило текст, таблицы или картинки документа.")
        return {"richHtml": safe, "sha256": hashlib.sha256(original).hexdigest(), "name": path.name, "format": path.suffix.lower().lstrip("."), "warnings": ["Редактор поддерживает текст, списки, таблицы и картинки. Сложная вёрстка Word может измениться; исходник сохранён."]}


def build_document(rich_html: str) -> bytes:
    safe, expected = sanitize_html(rich_html)
    with tempfile.TemporaryDirectory(prefix="zeter-document-save-") as temp:
        root = Path(temp)
        source = root / "document.html"
        source.write_text('<!doctype html><html><head><meta charset="UTF-8"></head><body>' + safe + '</body></html>', encoding="utf-8")
        result = _run_conversion(source, root / "docx", root / "profile", 'docx:Office Open XML Text')
        actual = inspect_docx(result)
        if _compact(expected["text"]) != _compact(actual["text"]) or actual["tables"] < expected["tables"] or actual["images"] < expected["images"]:
            raise ValueError("Новый DOCX не сохранил текст, таблицы или картинки. Исходный файл сохранён.")
        return result.read_bytes()
