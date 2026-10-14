"""Standalone frozen update helper; code-only transaction and verified rollback.

The copied onefile helper lives outside the replaced files in data/updates/<uuid>.
No application storage constructor, migration or user-data traversal occurs here.
"""
from __future__ import annotations

import argparse
import ctypes
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

from app_updater import (EXE, MANIFEST, ParentProcess, UpdateError, WindowsMutex,
                         atomic_json, file_record, parse_json, plain_path,
                         preflight_install, read_manifest, safe_name,
                         validate_manifest, verify_file, verify_record)


def replace_file(root: Path, source: Path, target: Path, expected: dict):
    """Copy beside target, verify and atomically replace; retain source for recovery."""
    plain_path(root, target)
    plain_path(root, source)
    if file_record(source) != expected:
        raise UpdateError("Исходный файл транзакции повреждён.")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = plain_path(root, target.with_name(".zeter-swap-" + uuid.uuid4().hex + ".tmp"))
    try:
        with source.open("rb") as reader, temp.open("xb") as writer:
            shutil.copyfileobj(reader, writer, 1024 * 1024)
            writer.flush()
            os.fsync(writer.fileno())
        if file_record(temp) != expected:
            raise UpdateError("Копия для замены повреждена.")
        deadline = time.monotonic() + 2
        while True:
            try:
                plain_path(root, target)
                plain_path(root, temp)
                os.replace(temp, target)
                break
            except OSError as exc:
                if getattr(exc, "winerror", None) not in {32, 33} or time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)
        if file_record(plain_path(root, target)) != expected:
            raise UpdateError("Заменённый файл не прошёл проверку.")
    finally:
        plain_path(root, temp)
        temp.unlink(missing_ok=True)


def validate_session(root: Path, session: Path):
    root = Path(os.path.abspath(root))
    session = plain_path(root, Path(os.path.abspath(session)))
    if session.parent != root / "data" / "updates" or len(session.name) != 32 or any(c not in "0123456789abcdef" for c in session.name):
        raise UpdateError("Каталог транзакции не принадлежит установщику.")
    return root, session


class Transaction:
    def __init__(self, root: Path, session: Path, *, checkpoint=None):
        self.root, self.session = validate_session(root, session)
        self.path = self.session / "journal.json"
        self.checkpoint = checkpoint or (lambda name: None)
        self.journal = None

    def save(self, phase):
        self.journal["phase"] = phase
        atomic_json(self.session, self.path, self.journal)

    def begin(self, old, new):
        if self.path.exists():
            raise UpdateError("Транзакция уже существует; сначала выполните восстановление.")
        preflight_install(self.root, self.session / "stage", old, new)
        backup = plain_path(self.root, self.session / "backup")
        backup.mkdir()
        old_records = {**old["files"], MANIFEST: file_record(self.root / MANIFEST)}
        new_records = {**new["files"], MANIFEST: file_record(self.session / "stage" / MANIFEST)}
        self.journal = {"schema": 1, "root": str(self.root), "session": str(self.session), "phase": "backing_up", "old": old, "new": new, "map": []}
        for name in sorted(set(old_records) | set(new_records)):
            self.journal["map"].append({"name": name, "source": str(self.session / "stage" / name), "target": str(self.root / name), "backup": str(backup / name), "old": old_records.get(name), "new": new_records.get(name)})
        self.save("backing_up")
        for item in self.journal["map"]:
            if item["old"] is not None:
                source = verify_file(self.root, item["name"], item["old"])
                destination = plain_path(self.root, Path(item["backup"]))
                destination.parent.mkdir(parents=True, exist_ok=True)
                plain_path(self.root, destination)
                with source.open("rb") as reader, destination.open("xb") as writer:
                    shutil.copyfileobj(reader, writer, 1024 * 1024)
                    writer.flush()
                    os.fsync(writer.fileno())
                if file_record(destination) != item["old"]:
                    raise UpdateError("Не удалось проверить резервную копию программы.")
        # Last distinguishing check before the first target mutation.
        preflight_install(self.root, self.session / "stage", old, new)
        self.save("backed_up")

    def load(self):
        plain_path(self.root, self.path)
        value = parse_json(self.path.read_bytes())
        if not isinstance(value, dict) or value.get("schema") != 1 or value.get("root") != str(self.root) or value.get("session") != str(self.session) or value.get("phase") not in {"backing_up", "backed_up", "swapping", "probing", "rolling_back", "rolled_back", "committed"}:
            raise UpdateError("Некорректный журнал восстановления.")
        old, new = validate_manifest(value["old"]), validate_manifest(value["new"])
        items = value.get("map")
        names = set(old["files"]) | set(new["files"]) | {MANIFEST}
        if not isinstance(items, list) or len(items) != len(names) or {i.get("name") for i in items if isinstance(i, dict)} != names:
            raise UpdateError("Журнал восстановления не совпадает с манифестами.")
        for item in items:
            name = safe_name(item["name"], manifest=item["name"] == MANIFEST)
            expected_paths = {"source": self.session / "stage" / name, "target": self.root / name, "backup": self.session / "backup" / name}
            for key, expected in expected_paths.items():
                if item.get(key) != str(expected):
                    raise UpdateError("Изменена карта путей восстановления.")
                plain_path(self.root, expected)
            if name != MANIFEST and (item.get("old") != old["files"].get(name) or item.get("new") != new["files"].get(name)):
                raise UpdateError("Изменена карта контрольных сумм.")
            if name == MANIFEST:
                for field, manifest in (("old", old), ("new", new)):
                    source = Path(item["backup"] if field == "old" else item["source"])
                    if value["phase"] == "backing_up" and field == "old":
                        source = Path(item["target"])
                    if field == "new":
                        # Recovery depends on verified old backups, not disposable staged code.
                        record = item[field]
                        if not isinstance(record, dict) or set(record) != {"size", "sha256"} or type(record["size"]) is not int or record["size"] < 0 or not isinstance(record["sha256"], str) or len(record["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in record["sha256"]):
                            raise UpdateError("Некорректная сумма манифеста в журнале.")
                        continue
                    verify_record(self.root, source, item[field])
                    if parse_json(source.read_bytes()) != manifest:
                        raise UpdateError("Резервный манифест не соответствует журналу.")
        self.journal = value
        return value

    def _target_owned(self, item):
        target = plain_path(self.root, Path(item["target"]))
        if target.exists():
            if not target.is_file() or file_record(target) not in [item["old"], item["new"]]:
                raise UpdateError("Файл был изменён независимо; восстановление остановлено: " + item["name"])
        return target

    def swap(self):
        self.save("swapping")
        for item in self.journal["map"]:
            target = self._target_owned(item)
            if item["new"] is None:
                if item["old"]:
                    verify_record(self.root, Path(item["backup"]), item["old"])
                target.unlink(missing_ok=True)
            else:
                replace_file(self.root, Path(item["source"]), target, item["new"])
            self.checkpoint(item["name"])
        self.verify("new")
        self.save("probing")

    def verify(self, field):
        for item in self.journal["map"]:
            expected = item[field]
            target = plain_path(self.root, Path(item["target"]))
            if expected is None:
                if target.exists():
                    raise UpdateError("Лишний файл после транзакции.")
            else:
                verify_file(self.root, item["name"], expected)

    def rollback(self):
        if self.journal is None:
            self.load()
        if self.journal["phase"] == "committed":
            raise UpdateError("Подтверждённое обновление нельзя откатить этой командой.")
        if self.journal["phase"] == "rolled_back":
            self.verify("old")
            return
        if self.journal["phase"] == "backing_up":
            # No target writes were permitted in this phase.
            self.verify("old")
            self.save("rolled_back")
            return
        # Validate the complete rollback plan before any restoration.
        for item in self.journal["map"]:
            self._target_owned(item)
            if item["old"] is not None:
                verify_record(self.root, Path(item["backup"]), item["old"])
        self.save("rolling_back")
        for item in reversed(self.journal["map"]):
            target = self._target_owned(item)
            if item["old"] is None:
                target.unlink(missing_ok=True)
            else:
                replace_file(self.root, Path(item["backup"]), target, item["old"])
            self.checkpoint("rollback:" + item["name"])
        self.verify("old")
        self.save("rolled_back")

    def commit(self):
        self.verify("new")
        self.save("committed")


class ChildJob:
    """Kill-on-close Job Object for the probe/selftest tree only."""
    def __init__(self):
        self.handle = None
        if sys.platform != "win32":
            return
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64), ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD), ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = wintypes.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        limits = Extended()
        limits.BasicLimitInformation.LimitFlags = 0x2000
        if not self.handle or not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            self.close()
            raise UpdateError("Не удалось создать защищённый процесс проверки.")

    def attach_resume(self, child):
        if self.handle:
            if not self.kernel.AssignProcessToJobObject(self.handle, int(child._handle)):
                raise UpdateError("Не удалось изолировать процесс проверки.")
            ntdll = ctypes.WinDLL("ntdll")
            ntdll.NtResumeProcess.argtypes = [ctypes.c_void_p]
            ntdll.NtResumeProcess.restype = ctypes.c_long
            if ntdll.NtResumeProcess(int(child._handle)) != 0:
                raise UpdateError("Не удалось запустить процесс проверки.")

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def child_env():
    env = os.environ.copy()
    env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
    return env


def run_checked(arguments: list[str], root: Path, timeout: int):
    job = ChildJob()
    child = None
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | (0x4 if sys.platform == "win32" else 0)
        child = subprocess.Popen(arguments, cwd=root, env=child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=flags)
        job.attach_resume(child)
        if child.wait(timeout=timeout) != 0:
            raise UpdateError("Установленная программа не прошла проверку запуска.")
    except subprocess.TimeoutExpired as exc:
        raise UpdateError("Программа не завершила проверку в отведённое время.") from exc
    finally:
        job.close()
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)


def restart(root: Path):
    installed = read_manifest(root)
    verify_file(root, EXE, installed["files"][EXE])
    subprocess.Popen([str(root / EXE)], cwd=root, env=child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def execute_request(path: Path, *, parent_factory=ParentProcess, checks=run_checked, launch=restart):
    path = Path(os.path.abspath(path))
    request = parse_json(path.read_bytes())
    root, session = validate_session(Path(request["root"]), Path(request["session"]))
    if path != session / "request.json" or request.get("schema") != 1 or not isinstance(request.get("nonce"), str) or len(request["nonce"]) != 32:
        raise UpdateError("Некорректный запрос установщика.")
    plain_path(root, path)
    validate_manifest(request["old"])
    validate_manifest(request["new"])
    if getattr(sys, "frozen", False):
        from app_updater import HELPER
        if Path(sys.executable).resolve() != session / HELPER:
            raise UpdateError("Установщик должен быть запущен из сохранённой транзакции.")
        verify_record(root, session / HELPER, request["old"]["files"][HELPER])
    parent = parent_factory(request["parentPid"], root / EXE, request["parentCreation"])
    transaction = Transaction(root, session)
    exited = False
    try:
        with WindowsMutex(root, "update"):
            preflight_install(root, session / "stage", request["old"], request["new"])
            helper_identity = ParentProcess(os.getpid(), Path(sys.executable)) if sys.platform == "win32" else None
            try:
                atomic_json(session, session / "ready.json", {"nonce": request["nonce"], "parentCreation": request["parentCreation"], "ready": True, "helperPid": os.getpid(), "helperCreation": helper_identity.creation if helper_identity else 0})
            finally:
                if helper_identity:
                    helper_identity.close()
            if not parent.wait(45, lambda: (session / "cancel.json").exists()):
                raise UpdateError("Закрытие программы отменено или истекло время ожидания. Файлы не заменены.")
            exited = True
            with WindowsMutex(root, "instance"):
                try:
                    if (session / "cancel.json").exists():
                        raise UpdateError("Обновление отменено до замены файлов.")
                    transaction.begin(request["old"], request["new"])
                    transaction.swap()
                    checks([str(root / EXE), "--self-test"], root, 45)
                    checks([str(root / EXE), "--update-probe", request["nonce"], request["new"]["version"], str(session)], root, 45)
                    transaction.commit()
                except BaseException:
                    if transaction.path.exists() and transaction.journal["phase"] != "committed":
                        transaction.rollback()
                    raise
    finally:
        parent.close()
        # Locks are released before normal launch. Never run normal migrations pre-commit.
        if exited and (not transaction.path.exists() or (transaction.journal and transaction.journal["phase"] in {"committed", "rolled_back"})):
            if not transaction.path.exists():
                if read_manifest(root) != request["old"]:
                    raise UpdateError("Программа изменена; автоматический перезапуск остановлен.")
                for name, record in request["old"]["files"].items():
                    verify_file(root, name, record)
            launch(root)


def recover(path: Path, *, launch=restart):
    path = Path(os.path.abspath(path))
    value = parse_json(path.read_bytes())
    root, session = validate_session(Path(value["root"]), Path(value["session"]))
    if path != session / "journal.json":
        raise UpdateError("Неверный путь журнала восстановления.")
    with WindowsMutex(root, "update"), WindowsMutex(root, "instance"):
        transaction = Transaction(root, session)
        transaction.load()
        if getattr(sys, "frozen", False):
            from app_updater import HELPER
            if Path(sys.executable).resolve() != session / HELPER:
                raise UpdateError("Восстановление должно запускаться сохранённым установщиком.")
            verify_record(root, session / HELPER, transaction.journal["old"]["files"][HELPER])
        transaction.rollback()
    launch(root)


def main():
    parser = argparse.ArgumentParser(description="Recoverable code-only ZeTer OS updater")
    parser.add_argument("--request", type=Path)
    parser.add_argument("--recover", type=Path)
    args = parser.parse_args()
    try:
        if bool(args.request) == bool(args.recover):
            raise UpdateError("Нужен ровно один запрос или журнал восстановления.")
        if args.recover:
            recover(args.recover)
        else:
            execute_request(args.request)
        return 0
    except Exception as exc:
        # Keep safe bounded failure evidence beside the workflow-owned request.
        path = args.request or args.recover
        if path:
            try:
                value = parse_json(path.read_bytes())
                _, session = validate_session(Path(value["root"]), Path(value["session"]))
                message = str(exc)[:400] if isinstance(exc, UpdateError) else "Сбой транзакции обновления; резервная копия сохранена."
                atomic_json(session, session / "result.json", {"ok": False, "error": message})
            except Exception:
                pass  # Failure to write optional receipt cannot turn failure into success.
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
