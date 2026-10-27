"""Synthetic Google Drive diagnostic tests. No real credentials, state or network."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from contextlib import nullcontext
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_zeter_os as app
from google_drive_backup import DriveError
from google_drive_sync import GoogleDriveSync
from problem_logs import ProblemLogs
from smoke_managed_file_native import configure_temp_data, RecordingPlatformOpener


def main():
    with tempfile.TemporaryDirectory(prefix="zeter-drive-diagnostics-") as tmp:
        root = Path(tmp)
        configure_temp_data(root)
        logger = ProblemLogs(root, source_root=Path(__file__).resolve().parents[1])
        api = app.NativeStorageApi(platform_opener=RecordingPlatformOpener(), problem_logs=logger,
                                   google_drive_credentials_root=root / "credentials")
        valid = {"driveEvent": "remote_checked", "drivePhase": "loading",
                 "cloudHeadPresent": True, "cloudGeneration": 1, "syncAttempt": 1}
        assert api.google_drive_sync_diagnostic(valid)["ok"]
        malicious = {**valid, "refreshToken": "NEVER-LEAK-MY-SECRET"}
        assert not api.google_drive_sync_diagnostic(malicious)["ok"]
        assert not api.google_drive_sync_diagnostic({**valid, "cloudGeneration": "a URL"})["ok"]
        assert api.google_drive_sync_diagnostic({
            "driveEvent": "conflict_saved", "drivePhase": "conflict",
            "cloudHeadPresent": True, "conflictSaved": True, "syncAttempt": 2,
        })["ok"]
        assert api.google_drive_sync_diagnostic({
            "driveEvent": "failure", "drivePhase": "offline",
            "driveError": "broker_unreachable", "syncAttempt": 3,
        })["ok"]

        class FailingSync:
            def __init__(self, drive):
                self.drive = drive
            def sync_head(self):
                raise DriveError("Нет соединения с сервером синхронизации. Повторите позже.")

        with patch.object(app, "GoogleDriveSync", FailingSync):
            response = api.google_drive_sync_head()
        assert response["ok"] is False
        assert app.drive_diagnostic_error(DriveError(
            "Нет соединения с сервером подключения Google Drive. Повторите позже.")) == "token_broker_unreachable"
        assert app.drive_diagnostic_error(DriveError(
            "Нет соединения с сервером синхронизации. Повторите позже.")) == "broker_unreachable"

        logger.close()
        events = [json.loads(line) for line in (logger.session / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        problems = [json.loads(line) for line in (logger.session / "problems.jsonl").read_text(encoding="utf-8").splitlines()]
        assert any(e["stage"] == "google_drive_client" and e["fields"].get("driveEvent") == "remote_checked"
                   and e["fields"].get("cloudHeadPresent") is True for e in events)
        assert any(e["stage"] == "google_drive_client" and e["fields"].get("driveEvent") == "conflict_saved"
                   for e in events)
        assert any(e["stage"] == "google_drive_client" and e["fields"].get("driveError") == "broker_unreachable"
                   for e in events)
        assert any(p["stage"] == "google_drive_client" and
                   p["evidence"].get("kind") == "drive_sync_error" for p in problems)
        assert any(p["stage"] == "google_drive_sync_rpc" and
                   p["lastContext"]["fields"]["driveAction"] == "sync_head" and
                   p["lastContext"]["fields"]["driveError"] == "broker_unreachable" for p in problems)
        all_logs = "\n".join((logger.session / file).read_text(encoding="utf-8")
                              for file in ("events.jsonl", "problems.jsonl", "summary.json", "report.txt"))
        assert "NEVER-LEAK-MY-SECRET" not in all_logs
        assert not any(k in all_logs for k in ('refreshToken', 'accessToken', 'manifestFileId'))
    # The Python native bridge must expose a precise, fixed missing-manifest error
    # only for absent accepted snapshot metadata, never for generic network errors.
    class ReadOnlyDrive:
        def transaction(self):
            return nullcontext()

    native_sync = GoogleDriveSync(ReadOnlyDrive())
    with patch.object(native_sync, "_existing", return_value=None):
        try:
            native_sync.read_file({"id": "missing-accepted-manifest", "sha256": "a" * 64})
        except DriveError as error:
            assert str(error) == "Принятый манифест облачной копии отсутствует в Google Drive."
        else:
            raise AssertionError("Missing accepted manifest must fail explicitly")
    print("GOOGLE_DRIVE_DIAGNOSTICS_PASS: detailed stages, failure fingerprint, bounded no-secret events, missing-manifest rejection")


if __name__ == "__main__":
    main()
