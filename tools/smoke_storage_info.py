"""Fresh native storage totals and one-pass filesystem observation, without GUI."""

from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
from pathlib import Path
import json
import os
import sys
import tempfile
from unittest.mock import patch

from smoke_managed_file_native import configure_temp_data, RecordingPlatformOpener, zeter


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="zeter-storage-info-") as temp:
        root = Path(temp) / "Папка с пробелами"
        configure_temp_data(root)
        api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
        # Constructor side effects belong only to this synthetic data tree.
        zeter.LOG_FILE.unlink(missing_ok=True)
        fixture = {
            "zeter-os-state.json": b"state",
            "restore-points.json": b"restore",
            "backups/direct.json": b"backup",
            "backups/nested/ignored.json": b"nested backup",
            "logs/direct.log": b"log",
            "logs/nested/ignored.log": b"nested log",
            "Файлы ZeTer OS/папка/файл.bin": b"managed",
            "Файлы ZeTer OS/zero.bin": b"",
            "Файлы ZeTer OS/.incoming/session.part": b"incoming",
            "Оформление объектов/Папки/icon.png": b"asset",
            "Рабочие столы/стол/doc.txt": b"readable",
            "README_ДАННЫЕ_WINDOWS.txt": b"summary",
            "other/free.bin": b"other",
        }
        for relative, content in fixture.items():
            path = zeter.DATA_DIR / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        ordinary_files = {zeter.DATA_DIR / relative for relative in fixture}
        directories = {zeter.DATA_DIR}
        for path in ordinary_files:
            directories.update(parent for parent in path.parents if parent.is_relative_to(zeter.DATA_DIR))
        stats: Counter[Path] = Counter()
        scans: Counter[Path] = Counter()
        original_stat = Path.stat

        def counted_stat(path, *args, **kwargs):
            stats[path] += 1
            return original_stat(path, *args, **kwargs)

        observing_scans = True

        def observe_scandir(event, args):
            if observing_scans and event == "os.scandir":
                scans[Path(args[0])] += 1

        # The audit event also observes pathlib implementations that captured
        # os.scandir before patching; this hook lives only in the smoke process.
        sys.addaudithook(observe_scandir)
        try:
            with patch.object(Path, "stat", counted_stat):
                result = api.get_storage_info()
        finally:
            observing_scans = False
        expected = {
            "ok": True,
            "dataDir": str(zeter.DATA_DIR), "stateFile": str(zeter.STATE_FILE),
            "restoreFile": str(zeter.RESTORE_FILE), "backupDir": str(zeter.BACKUP_DIR),
            "logDir": str(zeter.LOG_DIR), "logFile": str(zeter.LOG_FILE),
            "readableDir": str(zeter.READABLE_ROOT_DIR),
            "readableSummaryFile": str(zeter.READABLE_SUMMARY_FILE),
            "managedFileDir": str(zeter.MANAGED_FILE_ROOT_DIR),
            "itemAssetDir": str(zeter.ITEM_ASSET_ROOT_DIR),
            "managedFileBytes": 7, "managedFiles": 2,
            "itemAssetBytes": 5, "itemAssets": 1,
            "readableBytes": 8, "readableFiles": 1,
            "backupBytes": 6, "backupFiles": 1,
            "logBytes": 3, "logFiles": 1,
            "stateBytes": 5, "restoreBytes": 7,
            "dataBytes": 84, "exists": True,
        }
        assert result == expected, (result, expected)
        repeated_files = {str(path.relative_to(zeter.DATA_DIR)): stats[path] for path in ordinary_files if stats[path] > 1}
        repeated_scans = {str(path.relative_to(zeter.DATA_DIR)): scans[path] for path in directories if scans[path] != 1}
        assert not repeated_files and not repeated_scans, {"repeatedFileStats": repeated_files, "directoryScansNotOne": repeated_scans}
        assert all(stats[path] == 1 for path in ordinary_files), stats

        # A second call observes modifications/deletions rather than cached sizes.
        zeter.STATE_FILE.unlink()
        (zeter.MANAGED_FILE_ROOT_DIR / "zero.bin").write_bytes(b"new")
        changed = api.get_storage_info()
        assert changed == {**expected, "stateBytes": 0, "exists": False, "managedFileBytes": 10, "dataBytes": 82}, changed

        vanished = zeter.BACKUP_DIR / "direct.json"

        def vanished_stat(path, *args, **kwargs):
            if path == vanished:
                raise FileNotFoundError("synthetic concurrent removal")
            return original_stat(path, *args, **kwargs)

        with patch.object(Path, "stat", vanished_stat):
            missing = api.get_storage_info()
        assert missing == {**changed, "backupFiles": 0, "backupBytes": 0, "dataBytes": 76}, missing

        # Independently model link entry classification: nested directory links
        # are skipped; explicit category roots still contribute their category,
        # but their descendants were never part of the data-root traversal.
        original_scandir = os.scandir
        directory_links = {zeter.MANAGED_FILE_ROOT_DIR / "папка", zeter.READABLE_ROOT_DIR}

        class LinkEntry:
            def __init__(self, entry):
                self.path = entry.path

            def is_symlink(self):
                return Path(self.path) in directory_links

        @contextmanager
        def link_scandir(path):
            with original_scandir(path) as entries:
                yield (LinkEntry(entry) for entry in entries)

        with patch.object(os, "scandir", link_scandir):
            links = api.get_storage_info()
        assert links == {**changed, "managedFiles": 1, "managedFileBytes": 3, "dataBytes": 67}, links

        zeter.STATE_FILE.write_bytes(b"")
        zeter.RESTORE_FILE.unlink()
        empty_state = api.get_storage_info()
        assert empty_state == {**changed, "exists": True, "restoreBytes": 0, "dataBytes": 75}, empty_state

        def denied_stat(path, *args, **kwargs):
            if path == vanished:
                raise PermissionError("synthetic permanent denial")
            return original_stat(path, *args, **kwargs)

        with patch.object(Path, "stat", denied_stat):
            denied = api.get_storage_info()
        assert denied == {"ok": False, "error": "synthetic permanent denial"}, denied
        assert vanished.read_bytes() == b"backup"
        print(f"storage info smoke: ok; {len(ordinary_files)} files stat once, {len(directories)} directories scanned once; fresh/race/denial/empty/link classification verified")
    smoke_restore_summaries()


def smoke_restore_summaries() -> None:
    with tempfile.TemporaryDirectory(prefix="zeter-restore-summaries-") as temp:
        configure_temp_data(Path(temp))
        api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
        private_text = "PRIVATE-CONTENT-" + "x" * 50000
        state = {
            "fs": {"folder": {"type": "folder"}, "note": {"type": "note", "content": private_text},
                   "table": {"type": "table"}, "image": {"type": "image"}},
            "tasks": [{"title": private_text}], "events": [],
            "desktops": [{"id": "desktop", "data": {"tasks": [{}, {}], "events": [{}], "notifications": [{}],
                          "externalSaveStatus": zeter.NATIVE_DATA_STATUS_PREFIX + " C:/private/path"}}],
        }
        stored_summary = {"files": 4, "tasks": 3, "content": private_text, "unknown": 123,
                          "notes": private_text, "images": True, "events": -1}
        points = [{"id": f"point-{index}", "app": "ZeTer OS", "name": f"Point {index}",
                   "reason": "manual", "createdAt": index, "osVersion": "test", "sizeBytes": 50000,
                   "stateBytes": 50000, "verified": True, "summary": stored_summary,
                   "state": state, "privateExtra": private_text} for index in range(14)]
        points[-1].pop("summary")  # Legacy point: structural counts only.
        points.append({"id": "broken", "createdAt": 99, "state": private_text})
        points.append(private_text)  # Invalid entry must not publish its text.
        zeter.atomic_write_json(zeter.RESTORE_FILE, points)
        persisted = zeter.RESTORE_FILE.read_bytes()
        # Existing FULL path is the compatibility baseline, including its
        # portable metadata and legacy alias normalization.
        full_before = api.load_restore_points()
        assert full_before["ok"] is True
        assert full_before["points"][1]["state"]["tasks"] == [{}, {}]
        assert full_before["points"][1]["state"]["desktops"][0]["data"]["externalSaveStatus"] == zeter.NATIVE_DATA_PORTABLE_STATUS
        with patch.object(zeter, "normalize_portable_state_metadata", side_effect=AssertionError("Summary normalized full state")), \
             patch.object(zeter, "sync_legacy_workspace_aliases", side_effect=AssertionError("Summary normalized aliases")), \
             patch.object(zeter, "json_bytes", side_effect=AssertionError("Summary serialized full state")), \
             patch.object(zeter.json, "dumps", side_effect=AssertionError("Summary cloned full state")):
            summaries = api.load_restore_points({"summariesOnly": True})
        assert summaries["ok"] is True, summaries
        cards = summaries["points"]
        assert len(cards) == zeter.RESTORE_LIMIT == len(full_before["points"])
        assert [card["id"] for card in cards] == [point["id"] for point in full_before["points"]]
        assert cards[0] == {"id": "broken", "createdAt": 99, "summary": {}, "stateAvailable": False}, cards[0]
        assert cards[1]["summary"] == {"desktops": 1, "files": 4, "folders": 1, "notes": 1,
                                        "tables": 1, "images": 1, "tasks": 3, "events": 1, "notifications": 1}, cards[1]
        assert cards[2]["summary"] == {"files": 4, "tasks": 3}, cards[2]
        allowed = {"id", "app", "name", "reason", "createdAt", "osVersion", "sizeBytes", "stateBytes", "verified", "summary", "stateAvailable"}
        assert all(set(card) <= allowed and "state" not in card for card in cards), cards
        assert private_text not in json.dumps(summaries), "Summary leaked private content"
        assert len(json.dumps(summaries)) < 6000
        assert api.load_restore_points() == full_before
        assert api.load_restore_points({"summariesOnly": False}) == full_before
        assert zeter.RESTORE_FILE.read_bytes() == persisted, "Read-only summary rewrote restore points"
        for query in ({}, {"summariesOnly": 1}, {"summariesOnly": "true"}, {"summariesOnly": True, "other": 1}, True, "{}"):
            assert api.load_restore_points(query)["ok"] is False, query
        # No cache; changed metadata and invalid entries are visible next call.
        changed_point = {**points[0], "name": "Fresh name", "createdAt": 100}
        zeter.atomic_write_json(zeter.RESTORE_FILE, [changed_point, private_text])
        refreshed = api.load_restore_points({"summariesOnly": True})
        assert refreshed["points"][0]["name"] == "Fresh name" and len(refreshed["points"]) == 2, refreshed
        assert refreshed["points"][1] == {"summary": {}, "stateAvailable": False}, refreshed
        assert api.load_restore_points()["points"][1] == private_text, "FULL damaged-entry behavior changed"
        print("restore summaries smoke: ok; full compatibility/order/limit/privacy/no normalization/freshness verified")


if __name__ == "__main__":
    main()
