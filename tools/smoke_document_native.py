"""Hermetic document bridge tests; real LibreOffice only with explicit option."""
from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import document_converter as converter
import run_zeter_os as zeter
from smoke_managed_file_native import RecordingPlatformOpener, configure_temp_data

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
IMAGE = "data:image/png;base64," + base64.b64encode(PNG).decode("ascii")
RICH = '<p>Кириллица <b>жирный</b> текст</p><table><tr><td>ячейка</td></tr></table><p><img src="' + IMAGE + '"></p>'


def fixture_docx(path: Path, text: str = "Старый текст") -> bytes:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>')
    return path.read_bytes()


def smoke_sanitizer(root: Path):
    safe, expected = converter.sanitize_html('<head><title>НЕ ЗАГОЛОВОК</title></head><p onclick="bad()">текст<script>evil</script><a href="javascript:evil()">ссылка</a></p>' + RICH)
    assert "НЕ ЗАГОЛОВОК" not in safe and "onclick" not in safe and "evil" not in safe and "javascript:" not in safe
    linked, _ = converter.sanitize_html('<a href="https://example.org/test?q=1">Ссылка</a>')
    assert 'href="https://example.org/test?q=1"' in linked
    assert "<b>жирный</b>" in safe and expected["tables"] == expected["images"] == 1
    for source in ('<img src="https://example.invalid/a.png">', '<img src="file:///C:/secret.png">', '<img src="data:image/svg+xml;base64,AAAA">', '<img src="../secret.png">'):
        try:
            converter.sanitize_html(source, root)
        except ValueError:
            pass
        else:
            raise AssertionError("Unsafe image accepted: " + source)
    picture = root / "рисунок.png"
    picture.write_bytes(PNG)
    converted, _ = converter.sanitize_html('<img src="%D1%80%D0%B8%D1%81%D1%83%D0%BD%D0%BE%D0%BA.png">', root)
    assert IMAGE in converted
    escaped = root.parent / "outside-document.png"
    escaped.write_bytes(PNG)
    link = root / "linked.png"
    try:
        link.symlink_to(escaped)
    except OSError:
        pass  # Junction coverage below does not require Windows symlink privilege.
    else:
        try:
            converter.sanitize_html('<img src="linked.png">', root)
        except ValueError:
            pass
        else:
            raise AssertionError("Symlink image accepted")


def smoke_converter_failures(root: Path):
    source = root / "document.html"
    source.write_text("<p>fixture</p>")
    class Job:
        def __init__(self): self.closed, self.assigned = False, False
        def assign(self, process): self.process, self.assigned = process, True
        def resume(self, process):
            assert self.assigned
            process.resumed = True
        def close(self): self.closed = True
    class Process:
        def __init__(self, mode): self.mode, self.returncode, self.killed, self.resumed = mode, None, False, False
        def wait(self, timeout):
            assert self.resumed, "Converter was waited before ownership/resume"
            if self.mode == "timeout" and not self.killed:
                raise subprocess.TimeoutExpired("synthetic", timeout)
            self.returncode = 1 if self.mode == "nonzero" else 0
            return self.returncode
        def kill(self): self.killed = True
        def poll(self): return self.returncode
    for mode in ("nonzero", "timeout", "missing-output"):
        process, job = Process(mode), Job()
        with patch.object(converter, "find_libreoffice", return_value=root / "fake-soffice.com"), patch.object(converter, "_WindowsJob", return_value=job), patch.object(converter.subprocess, "Popen", return_value=process) as launch:
            try:
                converter._run_conversion(source, root / mode, root / (mode + "-profile"), "docx:Office Open XML Text")
            except (RuntimeError, TimeoutError, ValueError):
                pass
            else:
                raise AssertionError("False conversion success: " + mode)
            args = launch.call_args
            assert isinstance(args.args[0], list) and args.kwargs["stdin"] == subprocess.DEVNULL
            if sys.platform == "win32":
                assert args.kwargs["creationflags"] & 0x4, "Converter was started unsuspended"
            assert job.closed and (mode != "timeout" or process.killed)
            profile = (root / (mode + "-profile") / "user/registrymodifications.xcu").read_text()
            assert "DisableMacrosExecution" in profile and "DisableActiveContent" in profile
    with patch.dict(converter.os.environ, {}, clear=True), patch.object(converter.shutil, "which", return_value=None):
        try:
            converter.find_libreoffice()
        except RuntimeError as exc:
            assert "LibreOffice" in str(exc)
        else:
            raise AssertionError("Missing converter accepted")


def smoke_windows_job(root: Path):
    if sys.platform != "win32":
        return
    import ctypes
    from ctypes import wintypes
    # Real harmless helper: its parent exits normally, then job close must reap
    # the still-running descendant by its owned process handle (not image name).
    code = "import subprocess,sys; p=subprocess.Popen([sys.executable,'-I','-S','-c','import time; time.sleep(60)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW); print(p.pid,flush=True)"
    job = converter._WindowsJob()
    process, helper = None, None
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    try:
        process = subprocess.Popen([sys.executable, "-I", "-S", "-c", code], cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, creationflags=subprocess.CREATE_NO_WINDOW | 0x4)
        job.assign(process)
        job.resume(process)
        output, _ = process.communicate(timeout=5)
        assert process.returncode == 0 and output.strip().isdigit(), output
        helper = kernel.OpenProcess(0x100000, False, int(output.strip()))  # SYNCHRONIZE
        assert helper and kernel.WaitForSingleObject(helper, 0) == 258, "Owned helper was not alive before cleanup"
        job.close()
        assert kernel.WaitForSingleObject(helper, 5000) == 0, "Owned descendant survived parent exit + job close"
    finally:
        job.close()
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        if helper:
            kernel.CloseHandle(helper)
    print("PASS Windows ownership: suspended launch → job assignment → resume; owned helper killed after parent exit")


def smoke_bridge(root: Path):
    configure_temp_data(root)
    api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
    directory = zeter.MANAGED_FILE_ROOT_DIR / "Тест с пробелами"
    directory.mkdir(parents=True)
    source = directory / "Исходник.docx"
    original = fixture_docx(source)
    digest = hashlib.sha256(original).hexdigest()
    relative = zeter.managed_file_relative_path(source)
    with patch.object(converter, "read_document", return_value={"richHtml": "<p>Старый текст</p>", "sha256": digest, "name": source.name, "format": "docx", "warnings": []}):
        assert api.read_managed_document({"managedPath": relative})["ok"]
        assert not api.read_managed_document({"managedPath": "Файлы ZeTer OS/../outside.docx"})["ok"]
    with patch.object(converter, "find_libreoffice", side_effect=converter.LibreOfficeNotFoundError("LibreOffice не установлен")):
        missing = api.read_managed_document({"managedPath": relative})
        assert not missing["ok"] and missing["code"] == "DOCUMENT_CONVERTER_MISSING", missing
        assert source.read_bytes() == original, "Missing converter must preserve the imported document"
    candidate = fixture_docx(root / "candidate.docx", "Правка")
    payload = {"managedPath": relative, "expectedSha256": digest, "richHtml": "<p>Правка</p>", "name": "Отредактированное.docx"}
    with patch.object(converter, "build_document", return_value=candidate):
        saved = api.save_managed_document(payload)
        assert saved["ok"], saved
    target = zeter.DATA_DIR / saved["file"]["managedPath"]
    assert target != source and target.read_bytes() == candidate and source.read_bytes() == original
    marker = target.with_name("." + target.name + converter.PENDING_SUFFIX)
    assert marker.exists()
    # No primary reference yet: GC, then a fresh API instance must retain it.
    # The imported original already belongs to the owning item in primary state.
    zeter.atomic_write_json(zeter.STATE_FILE, {"state": {"sourceDocument": {"managedPath": relative}}})
    api._prune_unreferenced_managed_files({relative.casefold()})
    assert target.exists() and marker.exists()
    api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
    api._prune_unreferenced_managed_files({relative.casefold()})
    assert target.exists() and marker.exists()
    # Confirm primary reference; the ownership marker is consumed, original kept.
    zeter.atomic_write_json(zeter.STATE_FILE, {"state": {"item": saved["file"], "sourceDocument": {"managedPath": relative}}})
    api._prune_unreferenced_managed_files({relative.casefold(), saved["file"]["managedPath"].casefold()})
    assert target.exists() and source.exists() and not marker.exists()
    before = {p.name for p in directory.iterdir()}
    for failure in (TimeoutError("synthetic timeout"), RuntimeError("synthetic exit"), ValueError("invalid candidate")):
        with patch.object(converter, "build_document", side_effect=failure):
            assert not api.save_managed_document(payload)["ok"]
        assert before == {p.name for p in directory.iterdir()} and source.read_bytes() == original
    invalid = root / "invalid.docx"
    invalid.write_bytes(b"not a ZIP document")
    with patch.object(converter, "_run_conversion", return_value=invalid):
        assert not api.save_managed_document(payload)["ok"]
    assert before == {p.name for p in directory.iterdir()}, "Invalid converted DOCX was published"
    with patch.object(converter, "build_document", return_value=candidate) as build:
        assert not api.save_managed_document({**payload, "expectedSha256": "0" * 64})["ok"]
        build.assert_not_called()
    def change_during_conversion(value):
        source.write_bytes(b"externally changed during conversion")
        return candidate
    with patch.object(converter, "build_document", side_effect=change_during_conversion):
        assert not api.save_managed_document(payload)["ok"]
    assert before == {p.name for p in directory.iterdir()}, "Concurrent source change published a stale candidate"
    source.write_bytes(original)
    # A malformed marker blocks cleanup, including deletion of unrelated files.
    bad = directory / (".bad.docx" + converter.PENDING_SUFFIX)
    bad.write_text("{}")
    try:
        api._prune_unreferenced_managed_files(set())
    except ValueError:
        pass
    else:
        raise AssertionError("Malformed marker failed open")
    assert target.exists() and source.exists()
    bad.unlink()
    marker.write_text(json.dumps({"owner": converter.PENDING_OWNER, "managedPath": saved["file"]["managedPath"], "sha256": "0" * 64}), encoding="utf-8")
    try:
        api._prune_unreferenced_managed_files(set())
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched recovery digest failed open")
    assert target.exists() and source.exists()
    marker.unlink()
    if sys.platform == "win32":
        junction = zeter.MANAGED_FILE_ROOT_DIR / "junction"
        result = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(junction), str(directory)], capture_output=True)
        assert result.returncode == 0, "Could not create owned junction fixture"
        try:
            assert not api.read_managed_document({"managedPath": "Файлы ZeTer OS/junction/Исходник.docx"})["ok"]
        finally:
            junction.rmdir()
    print("PASS document native: safe HTML, immutable publication, failure/retry, restart recovery, confirmed marker consumption, traversal/reparse refusal")


def smoke_document_readable(root: Path):
    configure_temp_data(root)
    api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
    directory = zeter.MANAGED_FILE_ROOT_DIR / "Документы"
    directory.mkdir(parents=True)
    source = directory / "Оригинал.docx"
    original = fixture_docx(source, "Подлинные байты документа")
    legacy = directory / "Старый.doc"
    legacy_bytes = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1synthetic-legacy-mirror"
    legacy.write_bytes(legacy_bytes)
    state = {"currentDesktop": "desktop", "desktops": [{"id": "desktop", "name": "Проверка"}], "fs": {}}
    for index, path in enumerate((source, legacy)):
        state["fs"][str(index)] = {"id": str(index), "parent": "desktop", "type": "managedFile", "name": path.name, "managedFile": {"managedPath": zeter.managed_file_relative_path(path), "name": path.name}, "richContent": "<p>Это не должно подменять двоичный документ</p>"}
    for _ in range(2):
        saved = api.save_state({"state": state})
        assert saved["ok"] and saved["readableOk"], saved
        for path, expected in ((source, original), (legacy, legacy_bytes)):
            mirrored = list(zeter.READABLE_ROOT_DIR.rglob(path.name))
            assert len(mirrored) == 1, mirrored
            assert mirrored[0].read_bytes() == expected, "Managed document mirror contains placeholder text instead of original bytes"
            assert path.read_bytes() == expected, "Readable export modified the working managed file"
    with zipfile.ZipFile(list(zeter.READABLE_ROOT_DIR.rglob(source.name))[0]) as archive:
        assert "Подлинные байты документа" in archive.read("word/document.xml").decode("utf-8")
    print("PASS document readable mirror: real DOC/DOCX bytes, no placeholder or duplicate, repeat save readableOk")


def live_libreoffice(root: Path):
    # Start from supported HTML; inspect independent ZIP/XML semantics after save.
    source = root / "Живой документ.docx"
    source.write_bytes(converter.build_document(RICH))
    before = source.read_bytes()
    read = converter.read_document(source)
    assert "Кириллица" in read["richHtml"] and "жирный" in read["richHtml"]
    assert "<table" in read["richHtml"] and "<img" in read["richHtml"]
    edited = read["richHtml"] + "<p>Добавленная строка</p>"
    target = root / "Изменённый.docx"
    target.write_bytes(converter.build_document(edited))
    with zipfile.ZipFile(target) as archive:
        xml = ET.fromstring(archive.read("word/document.xml"))
        text = "".join(node.text or "" for node in xml.iter(converter.W + "t"))
        assert text.count("Кириллица") == 1 and text.count("Добавленная строка") == 1
        assert len(list(xml.iter(converter.W + "tbl"))) == 1
        assert any(name.startswith("word/media/") for name in archive.namelist())
        assert any(node.find(converter.W + "rPr/" + converter.W + "b") is not None for node in xml.iter(converter.W + "r"))
    again = converter.read_document(target)
    assert "Добавленная строка" in again["richHtml"] and source.read_bytes() == before
    # A real binary DOC fixture is generated only inside this test's temp tree.
    doc = converter._run_conversion(source, root / "legacy", root / "legacy-profile", "doc:MS Word 97")
    legacy_before = doc.read_bytes()
    legacy = converter.read_document(doc)
    assert "Кириллица" in legacy["richHtml"] and "<table" in legacy["richHtml"] and "<img" in legacy["richHtml"]
    assert doc.read_bytes() == legacy_before
    print("PASS live LibreOffice: DOC/DOCX Cyrillic, bold/table/image, edit → DOCX → reopen, no duplicated title, original bytes unchanged")


def main():
    with tempfile.TemporaryDirectory(prefix="zeter-document-smoke-") as temp:
        root = Path(temp)
        for name in ("sanitizer", "process", "bridge", "readable", "live"):
            (root / name).mkdir()
        smoke_sanitizer(root / "sanitizer")
        smoke_converter_failures(root / "process")
        smoke_windows_job(root / "process")
        smoke_bridge(root / "bridge")
        smoke_document_readable(root / "readable")
        if "--live-libreoffice" in sys.argv:
            live_libreoffice(root / "live")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
