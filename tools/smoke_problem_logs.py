"""Hermetic smoke for compact, privacy-safe ZeTer OS problem logs."""

from __future__ import annotations

import contextlib
import io
import json
import multiprocessing
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from problem_logs import OWNER, ROOT_LIMIT, SCHEMA, SESSION_LIMIT, DailyProblemLogs, ProblemLogs, stamp
import problem_logs


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def seed_session(root: Path, session_id: str, closed_at: datetime, *, incomplete: bool = False, foreign: bool = False) -> Path:
    day = closed_at.astimezone().date().isoformat()
    run_time = closed_at.astimezone().strftime("%H%M%S-%f")[:-3]
    session = root / day / f"run-{run_time}-{session_id}"
    session.mkdir(parents=True)
    write_json(session / "manifest.json", {
        "owner": OWNER,
        "schema": SCHEMA,
        "day": day,
        "sessionId": session_id,
        "startedAt": stamp(closed_at - timedelta(minutes=1)),
    })
    (session / "events.jsonl").write_text("", encoding="utf-8")
    (session / "problems.jsonl").write_text("", encoding="utf-8")
    if not incomplete:
        write_json(session / "summary.json", {
            "owner": OWNER,
            "schema": SCHEMA,
            "sessionId": session_id,
            "status": "closed",
            "closedAt": stamp(closed_at),
        })
    if foreign:
        (session / "manual-note.txt").write_text("preserve", encoding="utf-8")
    return session


def read_json_lines(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


@contextlib.contextmanager
def day_rollover_fixture():
    fixture = tempfile.TemporaryDirectory(prefix="zeter-day-rollover-")
    root = Path(fixture.name)
    try:
        yield fixture.name
    finally:
        try:
            fixture.cleanup()
        except OSError as original:
            if getattr(original, "winerror", None) != 145:
                raise
            # Windows sometimes reports an already empty directory as not empty.
            # Retry only these owned empty ancestors; never recurse or remove files.
            for attempt in range(3):
                try:
                    for directory in (root / "ZeTer OS" / "Логи проблем", root / "ZeTer OS", root):
                        if directory.exists():
                            if not problem_logs.plain_path(root, directory):
                                raise original
                            directory.rmdir()
                    break
                except OSError as error:
                    if getattr(error, "winerror", None) != 145 or attempt == 2:
                        raise
                    time.sleep(0.025 * (attempt + 1))


def overflow_worker(app_root: str, moment: datetime, results) -> None:
    with patch.multiple(problem_logs, ROOT_LIMIT=96 * 1024, OVERFLOW_RESERVE=32 * 1024, CONTROL_RESERVE=8 * 1024):
        logger = ProblemLogs(Path(app_root), clock=lambda: moment, source_root=PROJECT_ROOT)
        with logger.operation("save_state"):
            logger.failure(OSError(28, "PRIVATE_OVERFLOW_SECRET"))
        logger.close()
        results.put({"id": logger.id, "available": logger.available, "overflow": logger.overflow_active})


def smoke_overflow(fixed: datetime) -> None:
    with tempfile.TemporaryDirectory(prefix="zeter-overflow-") as temp:
        app_root = Path(temp) / "Копия ZeTer OS"
        log_root = app_root / "Логи проблем"
        log_root.mkdir(parents=True)
        protected = seed_session(log_root, "5" * 32, fixed - timedelta(days=1))
        (protected / "events.jsonl").write_bytes(b"A" * (64 * 1024))
        before = {path.name: path.read_bytes() for path in protected.iterdir()}
        foreign = log_root / "manual-note.txt"
        foreign.write_text("keep", encoding="utf-8")
        with patch.multiple(problem_logs, ROOT_LIMIT=96 * 1024, OVERFLOW_RESERVE=32 * 1024, CONTROL_RESERVE=8 * 1024):
            for index in range(30):
                logger = ProblemLogs(app_root, clock=lambda index=index: fixed + timedelta(seconds=index), source_root=PROJECT_ROOT)
                assert logger.available and logger.overflow_active and not logger.detail_available
                with logger.operation("load_state"):
                    logger.failure(OSError("PRIVATE_OVERFLOW_SECRET", "PRIVATE_OVERFLOW_SECRET"))
                    logger.failure(OSError("PRIVATE_OVERFLOW_SECRET", "PRIVATE_OVERFLOW_SECRET"))
                logger.close()
                assert not logger.session.exists(), "quota-only starts must not leave empty run directories"
            overflow = logger.day_root / "overflow.json"
            value = json.loads(overflow.read_text(encoding="utf-8"))
            assert value["runsStarted"] == value["runsClosed"] == 30
            assert value["problemOccurrences"] == 60
            assert value["operationCount"] == 30
            assert value["integrity"] == "degraded" and value["detailsComplete"] is False
            assert value["droppedDetails"] > 0
            assert value["problems"], "bounded problem evidence must survive exhausted detailed budget"
            assert overflow.stat().st_size <= problem_logs.OVERFLOW_LIMIT
            assert "PRIVATE_OVERFLOW_SECRET" not in overflow.read_text(encoding="utf-8")
            assert {path.name: path.read_bytes() for path in protected.iterdir()} == before, "young evidence must never be evicted for quota"
            assert foreign.read_text(encoding="utf-8") == "keep"
            assert len(list(log_root.rglob("overflow.json"))) == 1
            assert not list(log_root.rglob("emergency-*.json"))
            pointer = json.loads((log_root / "latest_run.json").read_text(encoding="utf-8"))
            assert pointer["mode"] == "daily-overflow" and pointer["file"] == "overflow.json"
            assert logger._pointer_target_exists(pointer)

            context = multiprocessing.get_context("spawn")
            results = context.Queue()
            processes = [context.Process(target=overflow_worker, args=(str(app_root), fixed + timedelta(minutes=index + 1), results)) for index in range(2)]
            try:
                for process in processes:
                    process.start()
                for process in processes:
                    process.join(20)
                    assert process.exitcode == 0, "concurrent logger process did not finish successfully"
                outcomes = [results.get(timeout=5) for _ in processes]
                assert all(item["available"] and item["overflow"] for item in outcomes)
            finally:
                for process in processes:
                    if process.is_alive():
                        process.terminate()
                        process.join(5)
                results.close()
            value = json.loads(overflow.read_text(encoding="utf-8"))
            assert value["runsStarted"] == value["runsClosed"] == 32, "concurrent daily counters lost an update"
            assert value["problemOccurrences"] == 62
            assert value["reason"] == "detail_budget_exhausted"
            assert sum(path.stat().st_size for path in log_root.rglob("*") if path.is_file()) <= problem_logs.ROOT_LIMIT

            probe = ProblemLogs(app_root, clock=lambda: fixed + timedelta(minutes=3), source_root=PROJECT_ROOT)
            for line in range(5):
                probe.failure(stage="client_runtime", client={"kind": "runtime_error", "line": line, "message": "PRIVATE_OVERFLOW_SECRET"})
            probe._publish_overflow(force=True)
            pointer = json.loads((log_root / "latest_problem.json").read_text(encoding="utf-8"))
            assert pointer["evidenceAvailable"] is False and "fingerprint" not in pointer
            assert pointer["evidenceOmitted"] == "sample_limit"
            original_store = probe._store_locked
            def fail_overflow(path, *args, **kwargs):
                if path.name == "overflow.json":
                    raise OSError("synthetic overflow write failure")
                return original_store(path, *args, **kwargs)
            emergency_signal = io.StringIO()
            with patch.object(probe, "_store_locked", side_effect=fail_overflow), contextlib.redirect_stderr(emergency_signal):
                assert probe._publish_overflow(force=True) is False
                assert probe.available is False
            assert "problem diagnostics unavailable" in emergency_signal.getvalue()
            assert probe._publish_overflow(force=True) is True and probe.available
            value = json.loads(overflow.read_text(encoding="utf-8"))
            assert "overflow_write_failed" in value["gaps"] and value["writeFailures"] > 0
            after_retry_count = value["problemOccurrences"]
            probe._publish_overflow(force=True)
            assert json.loads(overflow.read_text(encoding="utf-8"))["problemOccurrences"] == after_retry_count, "retry duplicated already committed counters"
            probe.close()

            next_day = ProblemLogs(app_root, clock=lambda: fixed + timedelta(days=1), source_root=PROJECT_ROOT)
            next_day.close()
            assert (next_day.day_root / "overflow.json").is_file(), "a new day must retain a separate compact history"
            assert len(list(log_root.rglob("overflow.json"))) == 2

            for age in (120, 121):
                old_day = (fixed - timedelta(days=age)).astimezone().date().isoformat()
                write_json(log_root / old_day / "overflow.json", {"owner": OWNER, "schema": SCHEMA, "day": old_day, "mode": "daily-overflow"})
            retention = ProblemLogs(app_root, clock=lambda: fixed, source_root=PROJECT_ROOT)
            retention.close()
            boundary_day = (fixed - timedelta(days=120)).astimezone().date().isoformat()
            expired_day = (fixed - timedelta(days=121)).astimezone().date().isoformat()
            assert (log_root / boundary_day / "overflow.json").is_file()
            assert not (log_root / expired_day / "overflow.json").exists()


def smoke_day_rollover(fixed: datetime) -> None:
    with day_rollover_fixture() as temp:
        app_root = Path(temp) / "ZeTer OS"
        app_root.mkdir()
        moment = [fixed]
        logger = DailyProblemLogs(app_root, clock=lambda: moment[0], source_root=PROJECT_ROOT)
        original = logger.current
        entered, release = threading.Event(), threading.Event()
        failures = []
        def in_flight_operation():
            try:
                with logger.operation("save_state"):
                    entered.set()
                    assert release.wait(5)
                    logger.failure(ValueError("synthetic"))
            except BaseException as exc:
                failures.append(type(exc).__name__)
        thread = threading.Thread(target=in_flight_operation)
        thread.start()
        try:
            assert entered.wait(5)
            moment[0] += timedelta(days=1)
            logger.event("boot")
            current = logger.current
            assert current.day != original.day and current.session.is_dir()
            assert not (original.session / "summary.json").exists(), "rollover must not close an in-flight operation"
        finally:
            release.set()
            thread.join(5)
        assert not thread.is_alive() and not failures
        logger.close()
        old_summary = json.loads((original.session / "summary.json").read_text(encoding="utf-8"))
        new_summary = json.loads((current.session / "summary.json").read_text(encoding="utf-8"))
        assert old_summary["metrics"]["save_state"]["count"] == 1
        assert old_summary["problems"][0]["stage"] == "save_state"
        assert new_summary["status"] == "closed" and new_summary["outcome"] == "success"
        assert json.loads((logger.root / "latest_run.json").read_text(encoding="utf-8"))["sessionId"] == current.id


def main() -> None:
    assert SESSION_LIMIT == 2 * 1024 * 1024
    assert ROOT_LIMIT == 32 * 1024 * 1024
    with tempfile.TemporaryDirectory(prefix="zeter-path-alias-") as alias_temp:
        long_root = Path(alias_temp) / "Long Windows User"
        child = long_root / "data" / "file.json"
        child.parent.mkdir(parents=True)
        child.write_text("{}", encoding="utf-8")
        assert problem_logs.plain_path(Path(str(long_root).upper()), child), "Windows case-only paths must match"
        assert not problem_logs.plain_path(long_root, long_root.with_name(long_root.name + "Sibling") / "file.json")
        assert not problem_logs.plain_path(long_root, Path("Z:/outside.json"))

        original_lstat = Path.lstat

        def flagged_lstat(flagged: Path, *, reparse: bool):
            def inspect(value: Path):
                if value == flagged:
                    mode = problem_logs.stat.S_IFDIR if reparse else problem_logs.stat.S_IFLNK
                    return type("PathInfo", (), {"st_mode": mode, "st_file_attributes": 0x400 if reparse else 0})()
                return original_lstat(value)
            return inspect

        for flagged in (long_root, child.parent):
            with patch.object(Path, "lstat", autospec=True, side_effect=flagged_lstat(flagged, reparse=False)):
                assert not problem_logs.plain_path(long_root, child)
            with patch.object(Path, "lstat", autospec=True, side_effect=flagged_lstat(flagged, reparse=True)):
                assert not problem_logs.plain_path(long_root, child)
        with patch("problem_logs.os.path.realpath", side_effect=OSError("simulated canonicalization failure")):
            assert not problem_logs.plain_path(long_root, child)
    fixed = datetime(2030, 5, 20, 12, 0, tzinfo=timezone.utc)

    with tempfile.TemporaryDirectory(prefix="zeter-problem-logs-") as temp:
        app_root = Path(temp) / "ZeTer OS portable"
        log_root = app_root / "Логи проблем"
        log_root.mkdir(parents=True)
        removed = seed_session(log_root, "1" * 32, fixed - timedelta(days=121))
        preserved_boundary = seed_session(log_root, "2" * 32, fixed - timedelta(days=120))
        removed_incomplete = seed_session(log_root, "3" * 32, fixed - timedelta(days=200), incomplete=True)
        preserved_foreign = seed_session(log_root, "4" * 32, fixed - timedelta(days=200), foreign=True)
        write_json(log_root / "latest_run.json", {
            "owner": OWNER,
            "schema": SCHEMA,
            "day": removed.parent.name,
            "session": removed.name,
            "file": "summary.json",
        })

        logger = ProblemLogs(app_root, clock=lambda: fixed, source_root=PROJECT_ROOT)
        assert logger.available is True
        assert not removed.exists(), "Closed owned session older than 120 full days was retained"
        assert preserved_boundary.exists(), "Exactly 120 full days must be preserved"
        assert not removed_incomplete.exists(), "Owned incomplete session older than 120 days was retained"
        assert preserved_foreign.exists(), "Session with a foreign/manual file must be preserved"
        assert logger.session.parent.name == fixed.astimezone().date().isoformat()

        secret = "PRIVATE_TOKEN_AND_DOCUMENT_TEXT"
        client = {
            "kind": "runtime_error",
            "message": secret,
            "stack": f"stack {secret}",
            "source": f"http://127.0.0.1/app/js/app.js?token={secret}",
            "line": 321,
            "column": 7,
            "unknown": secret,
        }
        logger.failure(stage="client_runtime", client=client)
        logger.failure(stage="client_runtime", client=client)

        unusual_error = OSError(secret, secret)
        unusual_error.winerror = secret
        logger.failure(unusual_error, stage="save_item_asset")
        boolean_error = OSError(True, secret)
        boolean_error.winerror = True
        logger.failure(boolean_error, stage="open_managed_file")

        try:
            with logger.operation("save_state"):
                raise OSError(28, secret)
        except OSError:
            pass

        with logger.operation("readable_export") as operation:
            operation.result({"ok": True, "readableOk": False, "count": 4, "private": secret})
        logger.close("success")

        pointer = json.loads((log_root / "latest_run.json").read_text(encoding="utf-8"))
        assert pointer == {
            "owner": OWNER,
            "schema": SCHEMA,
            "day": logger.day,
            "sessionId": logger.id,
            "session": logger.session.name,
            "file": "summary.json",
            "startedAt": logger.manifest["startedAt"],
        }
        latest_problem = json.loads((log_root / "latest_problem.json").read_text(encoding="utf-8"))
        assert latest_problem["session"] == logger.session.name

        manifest = json.loads((logger.session / "manifest.json").read_text(encoding="utf-8"))
        summary = json.loads((logger.session / "summary.json").read_text(encoding="utf-8"))
        problems = read_json_lines(logger.session / "problems.jsonl")
        events = read_json_lines(logger.session / "events.jsonl")
        assert manifest["identity"]["version"] != "unknown"
        assert len(manifest["identity"]["sourceSetSha256"]) == 64
        assert summary["outcome"] == "issues" and summary["health"]["integrity"] == "healthy"
        assert summary["improvementSignals"]["slowestOperations"]
        assert any(item["occurrences"] == 2 for item in summary["improvementSignals"]["repeatedProblems"])
        client_problem = next(problem for problem in problems if problem["stage"] == "client_runtime")
        assert client_problem["evidence"]["kind"] == "runtime_error"
        assert client_problem["evidence"]["source"] == "app/js/app.js"
        assert client_problem["evidence"]["line"] == 321
        assert any(problem["stage"] == "save_state" for problem in problems)
        for stage in ("save_item_asset", "open_managed_file"):
            codes = next(problem for problem in problems if problem["stage"] == stage)["evidence"]["chain"][0]
            assert codes["errno"] is None and codes["winerror"] is None, "non-integer exception codes must be omitted"
        assert any(problem["stage"] == "readable_export" and problem["outcome"] == "partial" for problem in problems)
        assert [event["seq"] for event in events] == list(range(1, len(events) + 1))

        serialized = "\n".join(
            path.read_text(encoding="utf-8", errors="replace")
            for path in logger.session.iterdir()
            if path.is_file()
        )
        assert secret not in serialized
        assert str(PROJECT_ROOT) not in serialized

        degraded = ProblemLogs(app_root, clock=lambda: fixed + timedelta(seconds=1), source_root=PROJECT_ROOT)
        original_store = degraded._store
        degraded._store = lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("forced diagnostic sink failure"))
        degraded.event("boot", "error")
        degraded._store = original_store
        degraded.close("error")
        emergency = degraded.day_root / "overflow.json"
        assert emergency.is_file(), "Independent emergency marker was not published"
        emergency_payload = json.loads(emergency.read_text(encoding="utf-8"))
        assert emergency_payload["integrity"] == "degraded"
        assert "event_write_failed" in emergency_payload["gaps"]

        older = ProblemLogs(app_root, clock=lambda: fixed + timedelta(seconds=10), source_root=PROJECT_ROOT)
        newer = ProblemLogs(app_root, clock=lambda: fixed + timedelta(seconds=11), source_root=PROJECT_ROOT)
        newer.failure(ValueError("new"), stage="load_state")
        older.failure(ValueError("old"), stage="load_state")
        newer.close()
        older.close()
        assert json.loads((log_root / "latest_run.json").read_text(encoding="utf-8"))["sessionId"] == newer.id, "older close must not replace the newest run pointer"
        assert json.loads((log_root / "latest_problem.json").read_text(encoding="utf-8"))["sessionId"] == newer.id, "older observed problem must not replace the latest problem pointer"
        older = ProblemLogs(app_root, clock=lambda: fixed + timedelta(seconds=12), source_root=PROJECT_ROOT)
        older.failure(ValueError("new observation"), stage="load_state")
        assert json.loads((log_root / "latest_problem.json").read_text(encoding="utf-8"))["sessionId"] == older.id
        older.close()

    smoke_overflow(fixed)
    smoke_day_rollover(fixed)
    print("problem logs smoke: privacy, retention, pointers, bounded daily fallback and concurrent writers: ok")


if __name__ == "__main__":
    main()
