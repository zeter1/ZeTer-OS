"""Local, content-free diagnostics. Importing this module never writes files."""
from __future__ import annotations

import contextlib
import functools
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

SCHEMA = 1
OWNER = "zeter-os-problem-logs"
RETENTION_DAYS = 120
EVENT_LIMIT = 4 * 1024
SESSION_LIMIT = 2 * 1024 * 1024
ROOT_LIMIT = 32 * 1024 * 1024
OVERFLOW_RESERVE = 1024 * 1024
OVERFLOW_LIMIT = 4 * 1024
MAX_OVERFLOW_PROBLEMS = 4
CONTROL_RESERVE = 128 * 1024
CONTROL_LIMIT = 64 * 1024
MAX_FINGERPRINTS = 64
MAX_SCAN_ENTRIES = 12000
DISK_LOCK_TIMEOUT_SECONDS = 0.75
SESSION_FILES = frozenset({"manifest.json", "events.jsonl", "problems.jsonl", "summary.json", "report.txt", "health.json"})
STAGES = frozenset({
    "boot", "server_start", "window_create", "frontend_ready", "client_runtime",
    "get_storage_info", "get_system_metrics", "load_state", "save_state", "primary_confirm",
    "readable_export", "startup_backup", "previous_backup", "payload_cleanup", "incoming_cleanup",
    "load_restore_points", "preflight_restore_point", "save_restore_point", "delete_restore_point",
    "clear_restore_points", "clear_state", "cleanup_security_artifacts", "save_item_asset",
    "begin_file_import", "append_file_chunk", "finish_file_import", "cancel_file_import",
    "save_text_download", "save_binary_download", "open_managed_file", "open_external_target",
    "open_data_folder", "open_logs_folder", "open_problem_logs_folder", "open_readable_folder",
    "get_windows_startup_status", "set_windows_startup_enabled", "close_app", "shutdown",
})
OUTCOMES = frozenset({"started", "success", "error", "partial", "cancelled", "recovered", "slow", "incomplete"})
NUMBER_FIELDS = frozenset({"stateBytes", "size", "receivedSize", "expectedSize", "count", "removed",
                          "preserved", "readableFiles", "readableBytes", "managedFilesRemoved", "itemAssetsRemoved",
                          "line", "column", "pending", "dropped", "durationMs"})
BOOL_FIELDS = frozenset({"primaryVerified", "readableOk", "backupOk", "payloadGcOk", "cancelled", "recorded"})
CLIENT_KINDS = frozenset({"boot_timeout", "runtime_error", "unhandled_rejection", "storage_load_error"})
RUN_NAME_PATTERN = re.compile(r"run-\d{6}-\d{3}-[a-f0-9]{32}")


class DiagnosticLimitError(OSError):
    """An internal budget failure; its fixed code never contains product input."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def stamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds")


def plain_path(root: Path, path: Path) -> bool:
    """No symlink/reparse component, including the root; never resolve through a link."""
    root, path = root.absolute(), path.absolute()
    try:
        for candidate in (root, path):
            current = candidate
            while True:
                try:
                    info = current.lstat()
                    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
                        return False
                except FileNotFoundError:
                    pass
                parent = current.parent
                if parent == current:
                    break
                current = parent
        root_key = os.path.normcase(os.path.abspath(os.path.realpath(root)))
        path_key = os.path.normcase(os.path.abspath(os.path.realpath(path)))
        return os.path.commonpath((root_key, path_key)) == root_key
    except (ValueError, OSError):
        return False


def _json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def diagnosed(stage: str):
    """Observe the real bridge boundary; never inspect its input or raw error text."""
    def decorate(function):
        @functools.wraps(function)
        def call(self, *args, **kwargs):
            logger = getattr(self, "_problem_logs", None)
            if logger is None:
                return function(self, *args, **kwargs)
            with logger.operation(stage) as operation:
                result = function(self, *args, **kwargs)
                operation.result(result)
                return result
        return call
    return decorate


class Operation:
    def __init__(self, logger, stage):
        self.logger, self.stage = logger, stage
        self.id = uuid.uuid4().hex
        self.started = time.monotonic()
        self.outcome = "success"
        self.fields = {}
        self.problem_recorded = False

    def result(self, result):
        if not isinstance(result, dict):
            return
        self.fields = self.logger.safe_fields(result)
        if result.get("ok") is False:
            self.outcome = "error"
        elif result.get("cancelled"):
            self.outcome = "cancelled"
        elif any(result.get(key) is False for key in ("readableOk", "backupOk", "payloadGcOk")):
            self.outcome = "partial"


class ProblemLogs:
    def __init__(self, app_root: Path, *, clock=utc_now, source_root: Path | None = None):
        self.app_root = Path(app_root).absolute()
        self.root = self.app_root / "Логи проблем"
        self.source_root = Path(source_root or app_root).resolve()
        self.clock = clock
        self.id = uuid.uuid4().hex
        started_at = clock()
        local_started_at = started_at.astimezone()
        self.day = local_started_at.date().isoformat()
        self.day_root = self.root / self.day
        run_time = local_started_at.strftime("%H%M%S-%f")[:-3]
        self.session = self.day_root / f"run-{run_time}-{self.id}"
        self.lock = threading.RLock()
        self.local = threading.local()
        self.started = time.monotonic()
        self.seq = 0
        self.closed = False
        self.available = False
        self.detail_available = False
        self.overflow_active = False
        self._overflow_accounted = {}
        self._overflow_last_write = 0.0
        self._emergency_warned = False
        self.health = {"integrity": "healthy", "dropped": 0, "gaps": [], "writeFailures": 0}
        self.metrics = {}
        self.problems = {}
        self.problem_samples = {}
        self.problem_occurrences = 0
        self.last_problem_observation = None
        self.source_files = {"run_zeter_os.py", "problem_logs.py", "app/js/app.js", "app/js/core/version.js"}
        core = self.source_root / "app" / "js" / "core"
        if core.is_dir():
            self.source_files.update("app/js/core/" + p.name for p in core.glob("*.js") if p.is_file())
        self.manifest = {"owner": OWNER, "schema": SCHEMA, "day": self.day, "sessionId": self.id,
                         "pid": os.getpid(), "startedAt": stamp(started_at),
                         "runtimeMode": "source", "identity": self._identity()}
        try:
            if not plain_path(self.app_root, self.root):
                raise OSError("unsafe diagnostic root")
            self.root.mkdir(exist_ok=True)
            self._retention()
            self.day_root.mkdir(exist_ok=True)
            self.session.mkdir()
            self._store(self.session / "manifest.json", self.manifest, control=True)
            self._store(self.session / "events.jsonl", b"", control=True)
            self._store(self.session / "problems.jsonl", b"", control=True)
            self.available = True
            self.detail_available = True
            self._publish_pointer("latest_run.json", self._pointer("manifest.json"), "startedAt")
        except Exception as exc:
            self._degrade("initialization_failed", exc)
            # A budget failure before the manifest must not accumulate empty run folders.
            try:
                if plain_path(self.app_root, self.session):
                    self.session.rmdir()
            except OSError:
                pass

    def _identity(self):
        hashes = {}
        aggregate = hashlib.sha256()
        for name in sorted(self.source_files):
            try:
                data = (self.source_root / name).read_bytes()
            except OSError:
                continue
            digest = hashlib.sha256(data).hexdigest()
            aggregate.update((name + ":" + digest + "\n").encode())
            if name in {"run_zeter_os.py", "problem_logs.py", "app/js/app.js", "app/js/core/version.js"}:
                hashes[name] = digest
        version = "unknown"
        try:
            text = (self.source_root / "app/js/core/version.js").read_text(encoding="utf-8")
            match = re.search(r'ZETER_OS_VERSION\s*=\s*"([0-9.]+)"', text)
            if match:
                version = match[1]
        except OSError:
            pass
        try:
            webview = importlib.metadata.version("pywebview")
        except importlib.metadata.PackageNotFoundError:
            webview = "not-installed"
        return {"app": "ZeTer OS", "version": version, "python": sys.version.split()[0],
                "pywebview": webview, "platform": sys.platform, "sourceHashes": hashes,
                "sourceSetSha256": aggregate.hexdigest(), "sourceFileCount": len(self.source_files)}

    def _pointer(self, filename):
        return {"owner": OWNER, "schema": SCHEMA, "day": self.day, "sessionId": self.id,
                "session": self.session.name, "file": filename, "startedAt": self.manifest["startedAt"]}

    @contextlib.contextmanager
    def _disk_lock(self):
        target = self.root / ".writer.lock"
        if not plain_path(self.app_root, target):
            raise OSError("unsafe lock")
        with target.open("a+b") as handle:
            if not target.stat().st_size:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            deadline = time.monotonic() + DISK_LOCK_TIMEOUT_SECONDS
            acquired = False
            while not acquired:
                try:
                    handle.seek(0)
                    if os.name == "nt":
                        import msvcrt
                        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    acquired = True
                except OSError:
                    if time.monotonic() >= deadline:
                        raise OSError("diagnostic writer lock timeout")
                    time.sleep(0.01)
            try:
                yield
            finally:
                if os.name == "nt":
                    handle.seek(0)
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle, fcntl.LOCK_UN)

    def _usage(self, root, *, max_entries=MAX_SCAN_ENTRIES):
        total = count = 0
        for directory, names, files in os.walk(root, followlinks=False):
            for name in names + files:
                count += 1
                path = Path(directory) / name
                if count > max_entries:
                    raise DiagnosticLimitError("diagnostic entry budget")
                if not plain_path(self.app_root, path):
                    raise OSError("diagnostic budget cannot be measured safely")
            total += sum((Path(directory) / name).stat().st_size for name in files)
        return total

    def _read_control_json(self, path):
        if not path.is_file() or not plain_path(self.app_root, path) or path.stat().st_size > CONTROL_LIMIT:
            raise ValueError("unsafe diagnostic control file")
        value = json.loads(path.read_bytes())
        if not isinstance(value, dict):
            raise ValueError("invalid diagnostic control file")
        return value

    def _pointer_target_exists(self, pointer):
        try:
            if pointer.get("owner") != OWNER or pointer.get("schema") != SCHEMA:
                return False
            day = str(pointer.get("day") or "")
            session = str(pointer.get("session") or "")
            filename = str(pointer.get("file") or "")
            if pointer.get("mode") == "daily-overflow":
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or filename != "overflow.json":
                    return False
                payload = self._read_control_json(self.root / day / filename)
                return payload.get("owner") == OWNER and payload.get("schema") == SCHEMA and payload.get("day") == day
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or not RUN_NAME_PATTERN.fullmatch(session):
                return False
            if filename not in SESSION_FILES:
                return False
            target = self.root / day / session / filename
            manifest = self._read_control_json(target.parent / "manifest.json")
            return (target.is_file() and plain_path(self.app_root, target)
                    and manifest.get("owner") == OWNER and manifest.get("schema") == SCHEMA
                    and manifest.get("sessionId") == pointer.get("sessionId")
                    and manifest.get("startedAt") == pointer.get("startedAt"))
        except (OSError, ValueError):
            return False

    def _store_locked(self, path, value, *, control=False, append=False, emergency=False):
        data = value if isinstance(value, bytes) else _json(value)
        if len(data) > (CONTROL_LIMIT if control else EVENT_LIMIT):
            raise OSError("diagnostic record cap")
        if not plain_path(self.app_root, path):
            raise OSError("unsafe diagnostic path")
        budget = ROOT_LIMIT if emergency else ROOT_LIMIT - OVERFLOW_RESERVE - (0 if control else CONTROL_RESERVE)
        session_budget = SESSION_LIMIT if control else SESSION_LIMIT - CONTROL_RESERVE
        # Include the replacement temp in the peak budget, not only the final file size.
        required = len(data)
        entry_limit = MAX_SCAN_ENTRIES if emergency else MAX_SCAN_ENTRIES - 2 * (RETENTION_DAYS + 1) - 16
        if self._usage(self.root, max_entries=entry_limit) + required > budget:
            raise DiagnosticLimitError("diagnostic folder cap")
        if path.parent == self.session and self._usage(self.session) + required > session_budget:
            raise DiagnosticLimitError("diagnostic session cap")
        if append:
            with path.open("ab") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            return
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".problem-", suffix=".tmp", delete=False) as handle:
                temp = Path(handle.name)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            if temp.read_bytes() != data:
                raise OSError("diagnostic temp mismatch")
            if not isinstance(value, bytes):
                json.loads(temp.read_bytes())
            os.replace(temp, path)
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)

    def _store(self, path, value, *, control=False, append=False):
        with self._disk_lock():
            self._store_locked(path, value, control=control, append=append)

    def _publish_pointer(self, name, value, order_field):
        with self._disk_lock():
            return self._publish_pointer_locked(name, value, order_field)

    def _publish_pointer_locked(self, name, value, order_field, *, emergency=False):
        if name not in {"latest_run.json", "latest_problem.json"}:
            raise ValueError("unknown diagnostic pointer")
        path = self.root / name
        try:
            current = self._read_control_json(path)
            if not self._pointer_target_exists(current):
                current = {}
        except (OSError, ValueError):
            current = {}
        def key(pointer):
            sequence = pointer.get("problemSequence", 0)
            if not isinstance(sequence, int) or isinstance(sequence, bool):
                sequence = 0
            return str(pointer.get(order_field) or ""), str(pointer.get("sessionId") or ""), sequence
        current_key, candidate_key = key(current), key(value)
        if current and current_key > candidate_key:
            return False
        if emergency and current.get("sessionId") == value.get("sessionId") and current.get("file") == "summary.json":
            return False
        self._store_locked(path, value, control=True, emergency=emergency)
        return True

    def _publish_overflow(self, *, force=False, closing=False):
        """One bounded daily fallback, shared by all processes; never evict young history."""
        if not force and self._overflow_last_write and time.monotonic() - self._overflow_last_write < 5:
            return False
        path = self.day_root / "overflow.json"
        daily_published = False
        try:
            if not self.root.is_dir() or not plain_path(self.app_root, path):
                raise OSError("emergency unavailable")
            self.day_root.mkdir(exist_ok=True)
            totals = {"runsStarted": 1, "runsClosed": int(closing),
                      "problemOccurrences": self.problem_occurrences,
                      "droppedDetails": self.health["dropped"],
                      "writeFailures": self.health["writeFailures"],
                      "operationCount": sum(item["count"] for item in self.metrics.values())}
            with self._disk_lock():
                if path.exists():
                    value = self._read_control_json(path)
                    if (value.get("owner") != OWNER or value.get("schema") != SCHEMA
                            or value.get("day") != self.day or value.get("mode") != "daily-overflow"):
                        raise ValueError("unknown emergency owner")
                else:
                    value = {"owner": OWNER, "schema": SCHEMA, "day": self.day, "mode": "daily-overflow",
                             "firstSeenAt": stamp(self.clock()), "integrity": "degraded", "problems": []}
                for name, count in totals.items():
                    previous = value.get(name, 0)
                    if not isinstance(previous, int) or isinstance(previous, bool) or previous < 0:
                        raise ValueError("invalid emergency counters")
                    value[name] = min(10**15, previous + max(0, count - self._overflow_accounted.get(name, 0)))
                value["lastSeenAt"] = max(str(value.get("lastSeenAt") or ""), stamp(self.clock()))
                value["gaps"] = sorted(set(value.get("gaps", [])) | set(self.health["gaps"]))[:16]
                value["reason"] = "detail_budget_exhausted" if "detail_budget_exhausted" in value["gaps"] else "detailed_diagnostics_unavailable"
                value["detailsComplete"] = False
                value["countsCompleteThrough"] = "last-flush; active runs may have unflushed counts"
                current_run = value.get("latestRun", {})
                if (self.manifest["startedAt"], self.id) >= (str(current_run.get("startedAt") or ""), str(current_run.get("sessionId") or "")):
                    value["latestRun"] = {"sessionId": self.id, "startedAt": self.manifest["startedAt"],
                                          "version": self.manifest["identity"]["version"],
                                          "sourceSetSha256": self.manifest["identity"]["sourceSetSha256"],
                                          "status": "closed" if closing else "active-or-interrupted"}
                samples = value["problems"]
                if not isinstance(samples, list) or len(samples) > MAX_OVERFLOW_PROBLEMS:
                    raise ValueError("invalid emergency samples")
                fingerprints = {item["fingerprint"] for item in samples}
                for fingerprint, sample in self.problem_samples.items():
                    if fingerprint not in fingerprints and len(samples) < MAX_OVERFLOW_PROBLEMS:
                        samples.append(sample)
                        fingerprints.add(fingerprint)
                value["sampleLimit"] = MAX_OVERFLOW_PROBLEMS
                value["samplesMayBeIncomplete"] = True
                if len(_json(value)) > OVERFLOW_LIMIT:
                    raise OSError("emergency record cap")
                self._store_locked(path, value, control=True, emergency=True)
                daily_published = True
                # Only account deltas after the atomic daily publication is confirmed.
                self._overflow_accounted = totals
                self._overflow_last_write = time.monotonic()
                self.available = True
                pointer = {**self._pointer("overflow.json"), "mode": "daily-overflow"}
                self._publish_pointer_locked("latest_run.json", pointer, "startedAt", emergency=True)
                if self.last_problem_observation:
                    latest = self.last_problem_observation
                    has_sample = latest["fingerprint"] in fingerprints
                    problem_pointer = {**pointer, "observedAt": latest["utc"], "problemSequence": self.problem_occurrences,
                                       "evidenceAvailable": has_sample}
                    if has_sample:
                        problem_pointer["fingerprint"] = latest["fingerprint"]
                    else:
                        problem_pointer["evidenceOmitted"] = "sample_limit"
                    self._publish_pointer_locked("latest_problem.json", problem_pointer, "observedAt", emergency=True)
            return True
        except Exception:
            self.health["writeFailures"] += 1
            failure_code = "overflow_pointer_publish_failed" if daily_published else "overflow_write_failed"
            if failure_code not in self.health["gaps"]:
                self.health["gaps"] = ([failure_code] + self.health["gaps"])[:16]
            if not self.detail_available:
                self.available = False
            if not self._emergency_warned:
                self._emergency_warned = True
                try:
                    sys.stderr.write("ZeTer OS: problem diagnostics unavailable; no data was redirected.\n")
                except Exception:
                    pass
            return False

    def _degrade(self, gap, exc=None):
        # Independent fixed-size daily fallback. No exception strings or recursive logging.
        self.health["integrity"] = "degraded"
        self.health["writeFailures"] += 1
        if gap not in self.health["gaps"] and len(self.health["gaps"]) < 16:
            self.health["gaps"].append(gap)
        if isinstance(exc, DiagnosticLimitError) and "detail_budget_exhausted" not in self.health["gaps"]:
            self.health["gaps"] = (["detail_budget_exhausted"] + self.health["gaps"])[:16]
        self.overflow_active = True
        return self._publish_overflow()

    def _retention(self):
        cutoff_day = self.clock().astimezone().date() - timedelta(days=RETENTION_DAYS)
        incomplete = removed = 0
        scanned = 0
        with self._disk_lock():
            for day_root in sorted(self.root.iterdir()):
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day_root.name) or not plain_path(self.app_root, day_root) or not day_root.is_dir():
                    continue
                try:
                    day_value = datetime.strptime(day_root.name, "%Y-%m-%d").date()
                except ValueError:
                    continue
                for directory in list(day_root.iterdir()):
                    scanned += 1
                    if scanned > MAX_SCAN_ENTRIES:
                        raise OSError("diagnostic retention scan cap")
                    if directory.is_file() and (directory.name == "overflow.json" or re.fullmatch(r"emergency-[a-f0-9]{32}\.json", directory.name)):
                        if day_value >= cutoff_day or not plain_path(self.app_root, directory):
                            continue
                        try:
                            payload = self._read_control_json(directory)
                            if payload.get("owner") == OWNER and payload.get("schema") == SCHEMA and payload.get("day") == day_root.name:
                                for pointer_name in ("latest_run.json", "latest_problem.json"):
                                    pointer_path = self.root / pointer_name
                                    try:
                                        pointer = self._read_control_json(pointer_path)
                                    except (OSError, ValueError):
                                        pointer = {}
                                    if (pointer.get("owner") == OWNER and pointer.get("day") == day_root.name
                                            and pointer.get("file") == directory.name and pointer.get("mode") == "daily-overflow"):
                                        pointer_path.unlink()
                                directory.unlink()
                        except (ValueError, OSError):
                            pass
                        continue
                    if not RUN_NAME_PATTERN.fullmatch(directory.name) or not plain_path(self.app_root, directory) or not directory.is_dir():
                        continue
                    children = list(directory.iterdir())
                    if any(p.name not in SESSION_FILES or not plain_path(self.app_root, p) or not p.is_file() for p in children):
                        continue
                    try:
                        manifest = json.loads((directory / "manifest.json").read_bytes())
                        if (manifest.get("owner") != OWNER or manifest.get("schema") != SCHEMA
                                or manifest.get("day") != day_root.name
                                or not directory.name.endswith("-" + str(manifest.get("sessionId")))):
                            continue
                    except (ValueError, OSError):
                        continue
                    if day_value >= cutoff_day:
                        try:
                            summary = json.loads((directory / "summary.json").read_bytes())
                            closed = (summary.get("owner") == OWNER and summary.get("sessionId") == manifest["sessionId"]
                                      and summary.get("status") == "closed")
                        except (ValueError, OSError):
                            closed = False
                        if not closed:
                            incomplete += 1
                        continue
                    try:
                        # Recheck immediately before unlinking only the known owner set.
                        if set(directory.iterdir()) != set(children) or any(not plain_path(self.app_root, p) for p in children):
                            continue
                        for pointer in ("latest_run.json", "latest_problem.json"):
                            target = self.root / pointer
                            if target.is_file() and plain_path(self.app_root, target):
                                try:
                                    current = json.loads(target.read_bytes())
                                except (ValueError, OSError):
                                    current = {}
                                if (current.get("owner") == OWNER and current.get("day") == day_root.name
                                        and current.get("session") == directory.name):
                                    target.unlink()
                        for path in children:
                            path.unlink()
                        directory.rmdir()
                        removed += 1
                    except OSError:
                        self.health["integrity"] = "degraded"
                        if "retention_incomplete" not in self.health["gaps"]:
                            self.health["gaps"].append("retention_incomplete")
                if day_value < cutoff_day:
                    try:
                        day_root.rmdir()
                    except OSError:
                        pass
        self.manifest["previousIncompleteOrActive"] = incomplete
        self.manifest["retentionRemoved"] = removed

    def safe_fields(self, fields):
        result = {}
        for key in NUMBER_FIELDS:
            value = fields.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                result[key] = max(0, min(value, 10**15))
        for key in BOOL_FIELDS:
            if isinstance(fields.get(key), bool):
                result[key] = fields[key]
        return result

    def exception(self, exc):
        chain, seen = [], set()
        while exc is not None and id(exc) not in seen and len(chain) < 4:
            seen.add(id(exc))
            category = "invalid_data" if isinstance(exc, (ValueError, TypeError)) else "io_error" if isinstance(exc, OSError) else "runtime_error"
            frames = []
            tb = exc.__traceback__
            while tb:
                try:
                    name = Path(tb.tb_frame.f_code.co_filename).resolve().relative_to(self.source_root).as_posix()
                except ValueError:
                    name = "external"
                if name not in self.source_files:
                    name = "external"
                frames.append({"file": name, "line": tb.tb_lineno,
                               "function": tb.tb_frame.f_code.co_name if name != "external" else "omitted"})
                tb = tb.tb_next
            numeric_code = lambda value: value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 0xFFFFFFFF else None
            chain.append({"type": type(exc).__name__[:80], "messageClass": category,
                          "errno": numeric_code(getattr(exc, "errno", None)),
                          "winerror": numeric_code(getattr(exc, "winerror", None)),
                          "frames": frames[-8:], "framesOmitted": max(0, len(frames) - 8)})
            exc = exc.__cause__ or (None if exc.__suppress_context__ else exc.__context__)
        return {"chain": chain, "chainTruncated": exc is not None,
                "diagnostic_gaps": ["raw_exception_message_omitted_for_privacy", "no_locals_or_source_lines"]}

    def event(self, stage, outcome="success", **fields):
        with self.lock:
            if self.closed:
                return
            stage = stage if stage in STAGES else "client_runtime"
            outcome = outcome if outcome in OUTCOMES else "error"
            operation = getattr(self.local, "operation", None)
            self.seq += 1
            event = {"schema": SCHEMA, "sessionId": self.id, "seq": self.seq, "utc": stamp(self.clock()),
                     "elapsedMs": round((time.monotonic() - self.started) * 1000, 3), "stage": stage,
                     "outcome": outcome, "operationId": operation.id if operation else None,
                     "fields": self.safe_fields(fields)}
            try:
                if not self.detail_available:
                    raise OSError("diagnostics unavailable")
                self._store(self.session / "events.jsonl", event, append=True)
                return True
            except Exception as exc:
                self.health["dropped"] += 1
                return self._degrade("event_write_failed", exc)

    def failure(self, exc=None, *, stage=None, outcome="error", client=None):
        with self.lock:
            if self.closed:
                return
            operation = getattr(self.local, "operation", None)
            stage = stage or (operation.stage if operation else "boot")
            if stage not in STAGES:
                stage = "client_runtime"
            detail = self.exception(exc) if exc else {"diagnostic_gaps": ["no_python_exception"]}
            if client is not None:
                # Source is a known source identifier, never a raw URL or untrusted filename.
                source = str(client.get("source") or "")[:600].split("?", 1)[0].split("#", 1)[0]
                safe_source = next((name for name in self.source_files if source.endswith("/" + name.removeprefix("app/"))), "unknown")
                kind = str(client.get("kind") or "")
                detail = {"kind": kind if kind in CLIENT_KINDS else "unknown", "source": safe_source, **self.safe_fields(client),
                          "diagnostic_gaps": ["client_message_stack_and_page_omitted_for_privacy"]}
            fingerprint = hashlib.sha256(_json({"stage": stage, "outcome": outcome, "detail": detail})).hexdigest()[:24]
            self.problem_occurrences += 1
            self.last_problem_observation = {"utc": stamp(self.clock()), "fingerprint": fingerprint}
            if fingerprint not in self.problems and len(self.problems) >= MAX_FINGERPRINTS:
                self.health["dropped"] += 1
                return self._degrade("problem_fingerprint_cap")
            entry = self.problems.setdefault(fingerprint, {"fingerprint": fingerprint, "stage": stage, "outcome": outcome, "occurrences": 0})
            entry["occurrences"] += 1
            entry["lastSeenAt"] = stamp(self.clock())
            if operation and stage == operation.stage and outcome != "slow":
                operation.problem_recorded = True
                operation.outcome = outcome
            # First occurrence is decisive; final summary owns exact deduplicated counts.
            if entry["occurrences"] != 1:
                if self.overflow_active:
                    return self._publish_overflow()
                return False
            problem = {**entry, "schema": SCHEMA, "sessionId": self.id, "utc": stamp(self.clock()),
                       "operationId": operation.id if operation else None, "evidence": detail}
            sample = {"fingerprint": fingerprint, "stage": stage, "outcome": outcome,
                      "sessionId": self.id, "sourceSetSha256": self.manifest["identity"]["sourceSetSha256"]}
            chain = detail.get("chain") or []
            if chain:
                sample.update({key: chain[0].get(key) for key in ("type", "errno", "winerror")})
                frames = chain[0].get("frames") or []
                if frames:
                    sample["frame"] = frames[-1]
            elif client is not None:
                sample.update({key: detail.get(key) for key in ("kind", "source", "line", "column")})
            self.problem_samples[fingerprint] = sample
            try:
                if not self.detail_available:
                    raise OSError("diagnostics unavailable")
                # Problem evidence has priority over the lower-value event timeline.
                self._store(self.session / "problems.jsonl", problem, append=True, control=True)
                self._publish_pointer("latest_problem.json", {
                    **self._pointer("problems.jsonl"), "fingerprint": fingerprint, "observedAt": problem["utc"],
                    "problemSequence": self.problem_occurrences, "evidenceAvailable": True,
                }, "observedAt")
                return True
            except Exception as error:
                self.health["dropped"] += 1
                recorded = self._degrade("problem_write_failed", error)
                if len(self.problem_samples) <= MAX_OVERFLOW_PROBLEMS:
                    recorded = self._publish_overflow(force=True)
                return recorded

    @contextlib.contextmanager
    def operation(self, stage):
        previous = getattr(self.local, "operation", None)
        operation = Operation(self, stage)
        self.local.operation = operation
        with self.lock:
            metric = self.metrics.setdefault(stage, {"count": 0, "totalMs": 0, "maxMs": 0, "outcomes": {}})
            metric["count"] += 1
            sampled = metric["count"] <= 3
        if sampled:
            self.event(stage, "started")
        try:
            yield operation
        except BaseException as exc:
            operation.outcome = "error"
            self.failure(exc)
            raise
        finally:
            duration = round((time.monotonic() - operation.started) * 1000, 3)
            with self.lock:
                metric["totalMs"] = round(metric["totalMs"] + duration, 3)
                metric["maxMs"] = max(metric["maxMs"], duration)
                metric["outcomes"][operation.outcome] = metric["outcomes"].get(operation.outcome, 0) + 1
                outcome_occurrence = metric["outcomes"][operation.outcome]
            if operation.outcome in {"error", "partial", "recovered"} and not operation.problem_recorded:
                self.failure(stage=stage, outcome=operation.outcome)
            event_outcome = "slow" if duration >= 1500 and operation.outcome == "success" else operation.outcome
            # Exact totals remain in summary.metrics; the timeline keeps only decisive samples.
            if sampled or (event_outcome != "success" and outcome_occurrence <= 3):
                self.event(stage, event_outcome, durationMs=duration, **operation.fields)
            if duration >= 1500:
                self.failure(stage=stage, outcome="slow")
            self.local.operation = previous

    def close(self, outcome="success"):
        with self.lock:
            if self.closed:
                return
            slowest = sorted(
                ({"stage": stage, "count": metric["count"],
                  "averageMs": round(metric["totalMs"] / max(1, metric["count"]), 3),
                  "maxMs": metric["maxMs"]} for stage, metric in self.metrics.items()),
                key=lambda item: (item["maxMs"], item["averageMs"]), reverse=True,
            )[:8]
            repeated = [
                {"fingerprint": item["fingerprint"], "stage": item["stage"],
                 "outcome": item["outcome"], "occurrences": item["occurrences"]}
                for item in self.problems.values() if item["occurrences"] > 1
            ]
            summary = {"owner": OWNER, "schema": SCHEMA, "sessionId": self.id,
                       "status": "closed", "closedAt": stamp(self.clock()), "requestedOutcome": outcome,
                       "outcome": "issues" if self.problems else outcome, "metrics": self.metrics,
                       "problems": list(self.problems.values()), "improvementSignals": {
                           "slowestOperations": slowest, "repeatedProblems": repeated,
                           "diagnosticGaps": list(self.health["gaps"]),
                       }, "health": self.health, "lastSequence": self.seq}
            try:
                if not self.detail_available:
                    raise OSError("diagnostics unavailable")
                self._store(self.session / "health.json", self.health, control=True)
                report = f"ZeTer OS — {self.id}\nИтог: {summary['outcome']}\nДиагностика: {self.health['integrity']}\nПроблем: {len(self.problems)}; пропущено: {self.health['dropped']}\nПодробности: summary.json, problems.jsonl, events.jsonl\n"
                self._store(self.session / "report.txt", report.encode("utf-8"), control=True)
                self._store(self.session / "summary.json", summary, control=True)
                self._publish_pointer("latest_run.json", self._pointer("summary.json"), "startedAt")
            except Exception as exc:
                self._degrade("final_publication_failed", exc)
            if self.overflow_active:
                self._publish_overflow(force=True, closing=True)
            self.closed = True


class DailyProblemLogs:
    """Route new work to today's session, retaining the owner of in-flight operations."""

    def __init__(self, app_root: Path, *, clock=utc_now, source_root: Path | None = None):
        self.app_root = Path(app_root).absolute()
        self.root = self.app_root / "Логи проблем"
        self.clock, self.source_root = clock, source_root
        self.lock, self.local = threading.RLock(), threading.local()
        self.current = ProblemLogs(self.app_root, clock=clock, source_root=source_root)
        self.active = {self.current: 0}
        self.closed = False
        self.close_outcome = "success"

    @property
    def available(self):
        return self.current.available

    @contextlib.contextmanager
    def _using(self):
        with self.lock:
            logger = getattr(self.local, "logger", None)
            if logger is None:
                day = self.clock().astimezone().date().isoformat()
                if not self.closed and day != self.current.day:
                    previous = self.current
                    self.current = ProblemLogs(self.app_root, clock=self.clock, source_root=self.source_root)
                    self.active[self.current] = 0
                    if self.active[previous] == 0:
                        previous.close()
                        del self.active[previous]
                logger = self.current
            self.active[logger] = self.active.get(logger, 0) + 1
        try:
            yield logger
        finally:
            with self.lock:
                self.active[logger] -= 1
                if self.active[logger] == 0 and (self.closed or logger is not self.current):
                    logger.close(self.close_outcome)
                    del self.active[logger]

    def event(self, *args, **kwargs):
        with self._using() as logger:
            return logger.event(*args, **kwargs)

    def failure(self, *args, **kwargs):
        with self._using() as logger:
            return logger.failure(*args, **kwargs)

    @contextlib.contextmanager
    def operation(self, stage):
        with self._using() as logger:
            previous = getattr(self.local, "logger", None)
            self.local.logger = logger
            try:
                with logger.operation(stage) as operation:
                    yield operation
            finally:
                self.local.logger = previous

    def close(self, outcome="success"):
        with self.lock:
            self.closed = True
            self.close_outcome = outcome
            for logger, count in list(self.active.items()):
                if count == 0:
                    logger.close(outcome)
                    del self.active[logger]
