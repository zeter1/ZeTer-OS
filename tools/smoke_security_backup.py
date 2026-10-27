"""Synthetic native vault/restore checks; never starts GUI or touches real data."""
from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

# Import has no startup writes. Every constructor follows configure_temp_data.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_zeter_os as zeter
import security_backup as backup
from smoke_managed_file_native import configure_temp_data, RecordingPlatformOpener


def checked(result):
    assert result.get("ok") is True, result
    return result


def fixture(root):
    configure_temp_data(root)
    assert zeter.DATA_DIR.resolve().is_relative_to(root.resolve())
    api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
    source = zeter.MANAGED_FILE_ROOT_DIR / "Источник с пробелом.docx"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"original source document bytes")
    media = zeter.MANAGED_FILE_ROOT_DIR / "архив.bin"
    media.write_bytes(bytes(range(256)))
    asset = zeter.ITEM_ASSET_ROOT_DIR / "Папки" / "synthetic-folder" / "значок.png"
    asset.parent.mkdir(parents=True, exist_ok=True)
    asset.write_bytes(b"test image bytes")
    paths = [path.relative_to(zeter.DATA_DIR).as_posix() for path in (source, media, asset)]
    record = {"app": "ZeTer OS", "osVersion": "4.0.0", "state": {
        "fs": {"folder": {"assetPath": paths[2]}, "doc": {"managedPath": paths[0]}},
        "settings": {}, "desktops": [],
        "archivedDesktops": [{"fs": {"old": {"managedPath": paths[1]}}}],
        "sourceDocument": {"managedPath": paths[0]}}}
    return api, record, paths


def select_vault(api, root):
    selection = root / "Внешняя папка"
    selection.mkdir(exist_ok=True)
    with patch.object(api, "_choose_security_backup_folder", return_value=selection):
        result = checked(api.configure_security_backups({"chooseFolder": True, "enabled": True, "maxCopies": 3}))
    assert result["configured"] and result["enabled"]
    return Path(result["folder"])


def malformed_archive(raw, mutation):
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        entries = {name: source.read(name) for name in source.namelist()}
    mutation(entries)
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, value in entries.items():
            archive.writestr(name, value)
    return base64.b64encode(target.getvalue()).decode("ascii")


def main():
    checks = []
    with tempfile.TemporaryDirectory(prefix="zeter-security-кириллица-") as temp:
        root = Path(temp)
        api, record, paths = fixture(root)
        before = copy.deepcopy(record)
        # Native canonicalizes portable metadata; the readback receipt must
        # validate the saved canonical state without mutating the caller.
        point_state = copy.deepcopy(record["state"])
        point_state["desktops"] = [{"id": "main", "data": {
            "externalSaveStatus": zeter.NATIVE_DATA_STATUS_PREFIX + " " + str(zeter.DATA_DIR),
            "tasks": [{"id": "synthetic-task"}],
        }}]
        point_state["tasks"] = []
        point = {"id": "restore-synthetic-canonical", "createdAt": 1, "state": point_state}
        original_point = copy.deepcopy(point)
        receipt = checked(api.save_restore_point(point))
        assert receipt["stateVerified"] is True
        stored = checked(api.load_restore_points())["points"][0]
        assert stored["state"]["desktops"][0]["data"]["externalSaveStatus"] == zeter.NATIVE_DATA_PORTABLE_STATUS
        assert stored["state"]["tasks"] == [{"id": "synthetic-task"}]
        assert point == original_point
        checks.append("native safety point canonicalization, disk readback and caller immutability")
        assert checked(api.get_security_backup_status())["configured"] is False
        assert not (zeter.DATA_DIR / "security-backups.json").exists()
        built = checked(api.build_security_backup(record))
        raw = base64.b64decode(built["base64"])
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            assert set(archive.namelist()) == {backup.STATE_NAME, backup.MANIFEST_NAME, *("data/" + path for path in paths)}
            manifest = json.loads(archive.read(backup.MANIFEST_NAME))
            assert manifest["formatVersion"] == 1
            assert all(entry["algorithm"] == "SHA-256" and hashlib.sha256(archive.read(entry["path"])).hexdigest() == entry["value"] for entry in manifest["files"])
            assert archive.read("data/" + paths[0]) == b"original source document bytes"
            assert all(info.compress_type == zipfile.ZIP_STORED and not info.flag_bits & 8 for info in archive.infolist())
        assert record == before
        checks.append("full byte-identical ZIP, archives/source references, SHA256, JS stored ZIP compatibility")
        vault = select_vault(api, root)
        foreign = vault / "my-manual-copy.zip"
        foreign.write_bytes(b"foreign user bytes")
        first = checked(api.create_security_backup(record))["entry"]
        checked(api.pin_security_backup({"id": first["id"], "pinned": True}))
        second = checked(api.create_security_backup(record))["entry"]
        third = checked(api.create_security_backup(record))["entry"]
        fourth = checked(api.create_security_backup(record))["entry"]
        entries = checked(api.get_security_backup_status())["entries"]
        assert {item["id"] for item in entries} == {first["id"], third["id"], fourth["id"]}
        assert not (vault / second["name"]).exists()
        assert foreign.read_bytes() == b"foreign user bytes"
        assert checked(api.read_security_backup({"id": first["id"]}))["base64"]
        checks.append("retention exact oldest unpinned, pin/previous valid protection, foreign preservation")
        config_path = zeter.DATA_DIR / "security-backups.json"
        config_bytes = config_path.read_bytes()
        with patch.object(api, "_choose_security_backup_folder", return_value=None):
            result = checked(api.configure_security_backups({"chooseFolder": True, "enabled": False}))
        assert result["cancelled"] and config_path.read_bytes() == config_bytes
        for invalid in ({"folder": str(root)}, {"path": str(root)}, {"enabled": "yes"}, {"intervalHours": 0}, {"maxCopies": 1}, {"maxBytes": 2}):
            assert not api.configure_security_backups(invalid)["ok"], invalid
        checks.append("chooser cancellation preserves exact config, path injection and settings bounds rejected")
        previous_success = checked(api.get_security_backup_status())["lastSuccessAt"]
        real_replace = backup.os.replace
        def fail_zip(source, target):
            if Path(target).suffix == ".zip":
                raise PermissionError("synthetic publication refusal")
            return real_replace(source, target)
        owned_before = {path.name: path.read_bytes() for path in vault.glob("*.zip")}
        with patch.object(backup.os, "replace", side_effect=fail_zip):
            result = api.create_security_backup(record)
        assert not result["ok"] and "synthetic publication refusal" in result["error"]
        status = checked(api.get_security_backup_status())
        assert status["lastSuccessAt"] == previous_success and status["lastError"]
        assert {path.name: path.read_bytes() for path in vault.glob("*.zip")} == owned_before
        assert not list(vault.glob(".zeter-security-*.tmp"))
        checks.append("failed publication preserves all prior ZIPs and lastSuccessAt, visible lastError")
        good_file = vault / first["name"]
        original_bytes = good_file.read_bytes()
        good_file.write_bytes(original_bytes[:-1] + bytes([original_bytes[-1] ^ 1]))
        assert not api.read_security_backup({"id": first["id"]})["ok"]
        good_file.write_bytes(original_bytes)
        managed = zeter.DATA_DIR / paths[0]
        original_source = managed.read_bytes()
        managed.unlink()
        assert not api.create_security_backup(record)["ok"]
        managed.write_bytes(original_source)
        checks.append("readback corruption and missing managed source refuse success")
        with patch.object(backup, "MAX_BYTES", 64):
            result = api.build_security_backup(record)
            assert not result["ok"] and "120 МиБ" in result["error"], result
        with patch.object(backup, "MAX_STATE_BYTES", 20):
            result = api.build_security_backup(record)
            assert not result["ok"] and "50 МиБ" in result["error"], result
        with patch.object(backup, "MAX_ENTRIES", 3):
            result = api.build_security_backup(record)
            assert not result["ok"] and "1200" in result["error"], result
        checks.append("ZIP/uncompressed, state and entry count limits reject full candidates")
        source_before = {path: (zeter.DATA_DIR / path).read_bytes() for path in paths}
        staged = checked(api.stage_security_restore({"base64": built["base64"]}))
        assert staged["filesRestored"] == 3 and staged["state"] != record["state"]
        assert len(staged["stagedPaths"]) == 3
        assert not zeter.STATE_FILE.exists()
        assert all((zeter.DATA_DIR / path).read_bytes() == value for path, value in source_before.items())
        assert not api.release_security_restore({"stageId": staged["stageId"]})["ok"]
        retained = api._collect_retained_payload_references({})
        assert not retained["errors"], retained
        assert all(path.casefold() in {**retained["managed"], **retained["itemAssets"]} for path in staged["stagedPaths"])
        checked(api.save_state({"state": {"fs": {}, "settings": {}, "desktops": []}}))
        assert all((zeter.DATA_DIR / path).exists() for path in staged["stagedPaths"]), "Primary-save GC removed leased payload"
        # Save only a selected managed payload: release may commit a strict subset.
        selected = next(path for path in staged["stagedPaths"] if path.startswith(zeter.MANAGED_FILE_ROOT_DIR.name))
        selected_bytes = (zeter.DATA_DIR / selected).read_bytes()
        candidate = {"fs": {"selected": {"managedPath": selected}}, "settings": {}, "desktops": []}
        checked(api.save_state({"state": candidate}))
        assert not api.release_security_restore({"stageId": staged["stageId"], "committedPaths": ["foreign"]})["ok"]
        checked(api.release_security_restore({"stageId": staged["stageId"], "committedPaths": [selected]}))
        assert api._security_backup_store().restore_leases() == []
        checked(api.save_state({"state": candidate}))
        assert (zeter.DATA_DIR / selected).read_bytes() == selected_bytes
        checks.append("detached no-overwrite extraction, lease survives primary GC, selective confirmed release")
        # All malicious archives leave state and existing selected payload untouched.
        state_bytes = zeter.STATE_FILE.read_bytes()
        for mutation in (
            lambda entries: entries.update({"../outside.txt": b"escape"}),
            lambda entries: entries.pop("data/" + paths[1]),
            lambda entries: entries.update({"data/" + paths[0]: b"hash mismatch"}),
            lambda entries: entries.update({"DATA/" + paths[0]: b"case collision"}),
        ):
            rejected = api.stage_security_restore({"base64": malformed_archive(raw, mutation)})
            assert not rejected["ok"], rejected
            assert zeter.STATE_FILE.read_bytes() == state_bytes and (zeter.DATA_DIR / selected).read_bytes() == selected_bytes
        checks.append("traversal, missing referenced archive file, SHA mismatch, case collision refuse before extraction")
        # Corrupt lease must fail closed at the real GC collector.
        lease = zeter.DATA_DIR / "security-restore-leases.json"
        lease.write_text('{"owner":"unknown","stages":{}}', encoding="utf-8")
        gc = api._garbage_collect_payload(candidate)
        assert gc["payloadGcSkipped"] is True and not gc["payloadGcOk"]
        assert (zeter.DATA_DIR / selected).read_bytes() == selected_bytes
        checks.append("unknown durable lease blocks GC rather than deleting recovery payload")
        # Configuration fallback reads the previously validated generation.
        config_path.write_bytes(b"corrupt")
        assert checked(api.get_security_backup_status())["configured"]
        checks.append("validated config recovery generation")
    # Independent restart/failure fixture: all paths remain under this temporary root.
    with tempfile.TemporaryDirectory(prefix="zeter-security-recovery-regression-") as temp:
        root = Path(temp)
        api, record, paths = fixture(root)
        vault = select_vault(api, root)
        checked(api.configure_security_backups({"maxCopies": 2}))
        one = checked(api.create_security_backup(record))["entry"]
        checked(api.create_security_backup(record))
        original_atomic = backup.SecurityBackupStore._atomic
        def fail_retention_index(store, path, value, validator, recovery=True):
            if path.name == ".zeter-backup-index.json" and any(entry.get("pendingDelete") for entry in value.get("entries", [])):
                raise OSError("synthetic retained index refusal")
            return original_atomic(store, path, value, validator, recovery)
        before = {path.name: path.read_bytes() for path in vault.glob("*.zip")}
        with patch.object(backup.SecurityBackupStore, "_atomic", fail_retention_index):
            result = checked(api.create_security_backup(record))
        assert result["maintenanceWarning"]
        assert all((vault / name).read_bytes() == data for name, data in before.items())
        checked(api.create_security_backup(record))
        assert len(checked(api.get_security_backup_status())["entries"]) == 2
        checks.append("retained-index failure preserves old bytes, successful next backup reconciles history")
        real_unlink = Path.unlink
        def fail_victim(path, *args, **kwargs):
            if path.suffix == ".zip" and path.parent == vault:
                raise PermissionError("synthetic locked victim")
            return real_unlink(path, *args, **kwargs)
        with patch.object(Path, "unlink", fail_victim):
            result = checked(api.create_security_backup(record))
            assert result["maintenanceWarning"]
            size_before = sum(path.stat().st_size for path in vault.glob("*.zip"))
            failed = api.create_security_backup(record)
            assert not failed["ok"]
            assert sum(path.stat().st_size for path in vault.glob("*.zip")) == size_before
        checked(api.create_security_backup(record))
        checks.append("locked victim stays indexed as pending, repeated attempts cannot grow vault, unlock resumes")
        indexed_before = {entry["id"] for entry in checked(api.get_security_backup_status())["entries"]}
        def deny_new_entry_index(store, path, value, validator, recovery=True):
            if path.name == ".zeter-backup-index.json" and any(entry["id"] not in indexed_before for entry in value.get("entries", [])):
                raise OSError("synthetic initial index refusal")
            return original_atomic(store, path, value, validator, recovery)
        with patch.object(backup.SecurityBackupStore, "_atomic", deny_new_entry_index):
            assert not api.create_security_backup(record)["ok"]
            physical = {path.name: path.read_bytes() for path in vault.glob("*.zip")}
            for _ in range(3):
                assert not api.create_security_backup(record)["ok"]
                assert {path.name: path.read_bytes() for path in vault.glob("*.zip")} == physical
        checked(api.create_security_backup(record))
        assert not (vault / ".zeter-backup-pending.json").exists()
        checks.append("initial index failure durable publication journal bounds physical ZIP growth and resumes after restart-style retry")
        record["state"]["fs"]["doc"]["documentDraft"] = {"basePath": paths[0], "baseSha256": hashlib.sha256((zeter.DATA_DIR / paths[0]).read_bytes()).hexdigest(), "richHtml": "<p>draft</p>"}
        built = checked(api.build_security_backup(record))
        checked(api.save_state({"state": record["state"]}))
        for _ in range(5):
            staged = checked(api.stage_security_restore({"base64": built["base64"]}))
            assert staged["state"]["fs"]["doc"]["documentDraft"]["basePath"] == staged["state"]["fs"]["doc"]["managedPath"]
            checked(api.release_security_restore({"stageId": staged["stageId"], "committedPaths": []}))
            assert api._security_backup_store().restore_leases() == []
        checks.append("document draft basePath remaps; five refused applies abandon generated stages without four-lease lockout")
    for name in checks:
        print("PASS:", name)
    print(f"PASS: security backup native ({len(checks)} scenarios)")


if __name__ == "__main__":
    main()
