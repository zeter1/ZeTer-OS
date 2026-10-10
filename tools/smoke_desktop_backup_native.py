"""Synthetic desktop ZIP/archive tests; never open a GUI or real data paths."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# Both imports only define functions/classes/constants. Constructor writes start
# only after configure_temp_data redirects every native state path below.
import run_zeter_os as zeter
from smoke_managed_file_native import configure_temp_data, RecordingPlatformOpener


def main() -> None:
    with tempfile.TemporaryDirectory(prefix=".zeter-desktop-backup-test-", dir=Path(__file__).resolve().parents[1]) as temp:
        root = Path(temp)
        configure_temp_data(root)
        assert zeter.DATA_DIR.resolve().is_relative_to(root.resolve())
        api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
        assert callable(getattr(api, "save_desktop_backup", None)), "Desktop backup API missing"
        managed = zeter.MANAGED_FILE_ROOT_DIR / "test" / "файл.bin"
        managed.parent.mkdir(parents=True)
        raw = bytes(range(256)) * 5000
        managed.write_bytes(raw)
        asset = zeter.ITEM_ASSET_ROOT_DIR / "Папки" / "folder" / "значок.png"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"synthetic-icon")
        unrelated = zeter.DATA_DIR / "unrelated.txt"
        unrelated.write_bytes(b"keep unrelated")
        snapshot = {
            "desktop": {"id": "desk", "name": "Рабочий стол", "data": {"nested": [{"attachment": {"managedPath": zeter.managed_file_relative_path(managed)}}]}},
            "fs": {"folder": {"id": "folder", "appearance": {"icon": {"assetPath": zeter.item_asset_relative_path(asset)}}, "target": str(unrelated)}},
        }
        original = copy.deepcopy(snapshot)
        destination = root / "desk.zip"
        api._choose_download_target = lambda *_args: destination
        result = api.save_desktop_backup(snapshot)
        assert result.get("ok") and not result.get("cancelled"), result
        with zipfile.ZipFile(destination) as archive:
            assert set(archive.namelist()) == {"desktop.json", "README.txt", f"data/{zeter.managed_file_relative_path(managed)}", f"data/{zeter.item_asset_relative_path(asset)}"}
            assert archive.read(f"data/{zeter.managed_file_relative_path(managed)}") == raw
            assert archive.read(f"data/{zeter.item_asset_relative_path(asset)}") == b"synthetic-icon"
            envelope = json.loads(archive.read("desktop.json"))
            assert envelope["app"] == "ZeTer OS" and envelope["format"] == "zeter-desktop-backup" and envelope["version"] == 1
            assert envelope["desktop"] == original["desktop"] and envelope["fs"] == original["fs"]
        assert snapshot == original and unrelated.read_bytes() == b"keep unrelated"
        previous = destination.read_bytes()
        api._choose_download_target = lambda *_args: None
        assert api.save_desktop_backup(snapshot).get("cancelled") is True
        assert destination.read_bytes() == previous
        api._choose_download_target = lambda *_args: destination
        for path in ("../unrelated.txt", "Файлы ZeTer OS/missing.bin"):
            invalid = copy.deepcopy(snapshot)
            invalid["fs"]["bad"] = {"managedPath": path}
            assert api.save_desktop_backup(invalid).get("ok") is False
            assert destination.read_bytes() == previous
        invalid = copy.deepcopy(snapshot)
        invalid["state"] = {"unrelated": "full OS"}
        assert api.save_desktop_backup(invalid).get("ok") is False
        replace = zeter.replace_transiently_locked_file
        def fail_publish(source: Path, target: Path) -> None:
            if target == destination:
                raise OSError("synthetic publish failure")
            replace(source, target)
        zeter.replace_transiently_locked_file = fail_publish
        try:
            assert api.save_desktop_backup(snapshot).get("ok") is False
        finally:
            zeter.replace_transiently_locked_file = replace
        assert destination.read_bytes() == previous
        assert not list(root.glob(".zeter-desktop-*.tmp"))

        entry = {"id": "archive-123", "archivedAt": "2026-10-10T12:00:00Z", **snapshot}
        state = {"desktops": [{"id": "other", "name": "Other", "data": {}}], "fs": {}, "archivedDesktops": [entry]}
        saved = api.save_state({"state": state})
        assert saved.get("ok") and saved.get("primaryVerified") and saved.get("archiveOk"), saved
        projection = zeter.DATA_DIR / "Архив рабочих столов" / entry["id"] / "desktop.json"
        assert json.loads(projection.read_text(encoding="utf-8")) == entry
        assert managed.exists() and asset.exists(), "Archived refs lost during GC"
        initial_projection = projection.read_bytes()
        second_entry = {**copy.deepcopy(entry), "id": "archive-456"}
        state["archivedDesktops"].append(second_entry)
        second_projection = projection.parent.parent / second_entry["id"] / "desktop.json"
        atomic_write = zeter.atomic_write_json
        def fail_projection(path: Path, value: object) -> None:
            if path == second_projection:
                raise OSError("synthetic projection failure")
            atomic_write(path, value)
        zeter.atomic_write_json = fail_projection
        try:
            partial = api.save_state({"state": state})
        finally:
            zeter.atomic_write_json = atomic_write
        assert partial.get("ok") and partial.get("primaryVerified") and partial.get("archiveOk") is False and partial.get("readableOk") is False, partial
        assert projection.read_bytes() == initial_projection
        assert zeter.read_json_file(zeter.STATE_FILE)["state"]["archivedDesktops"] == [entry, second_entry]
        assert managed.exists() and asset.exists()
        state["archivedDesktops"] = [entry]
        conflicting = copy.deepcopy(state)
        conflicting["archivedDesktops"][0]["desktop"]["name"] = "Different archive with same ID"
        collision = api.save_state({"state": conflicting})
        assert collision.get("ok") and collision.get("archiveOk") is False, "Archive ID collision overwrote saved archive"
        assert projection.read_bytes() == initial_projection
        # Remove only test-owned recovery files to prove the physical archive,
        # independently of current state/backups/restore points, retains payload.
        for path in zeter.BACKUP_DIR.glob("*.json"):
            path.unlink()
        retained = api._collect_retained_payload_references({})
        assert zeter.managed_file_relative_path(managed).casefold() in retained["managed"], "Physical desktop archive missing from retained references"
        assert zeter.item_asset_relative_path(asset).casefold() in retained["itemAssets"]
        api._last_previous_backup_at = zeter.time.time()
        without_archives = {"desktops": [{"id": "new", "data": {}}], "fs": {}}
        assert api.save_state({"state": without_archives}).get("ok")
        assert projection.exists() and managed.exists() and asset.exists()
        assert api.clear_state().get("ok")
        assert projection.exists() and managed.exists() and asset.exists()
        projection.write_text("{broken", encoding="utf-8")
        orphan = zeter.MANAGED_FILE_ROOT_DIR / "orphan.bin"
        orphan.write_bytes(b"keep if archive scan unsafe")
        blocked = api._garbage_collect_payload({})
        assert blocked.get("payloadGcSkipped") is True and blocked.get("payloadGcErrors"), blocked
        assert managed.exists() and asset.exists() and orphan.exists()
    print("Desktop native backup/archive smoke OK")


if __name__ == "__main__":
    main()
