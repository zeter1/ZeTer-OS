"""Native managed-file copy/lifecycle smoke without launching the ZeTer OS GUI."""

from __future__ import annotations

import base64
import copy
import shutil
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_zeter_os as zeter


class RecordingPlatformOpener:
    def __init__(self) -> None:
        self.paths: list[str] = []
        self.urls: list[str] = []
        self.windows_targets: list[str] = []

    def open_path(self, path: Path) -> None:
        self.paths.append(str(path))

    def open_url(self, target: str) -> None:
        self.urls.append(target)

    def open_windows_target(self, target: str) -> str:
        self.windows_targets.append(target)
        return "file"


class RecordingWindow:
    def __init__(self) -> None:
        self.destroyed = False

    def destroy(self) -> None:
        self.destroyed = True


class MemoryRegistry:
    HKEY_CURRENT_USER = "HKCU"
    KEY_READ = 0x01
    KEY_SET_VALUE = 0x02
    REG_SZ = 1

    def __init__(self) -> None:
        self.keys: set[tuple[str, str]] = set()
        self.values: dict[tuple[str, str, str], tuple[object, int]] = {}

    def CreateKeyEx(self, root: str, path: str, reserved: int, access: int) -> tuple[str, str]:
        key = (root, path)
        self.keys.add(key)
        return key

    def OpenKey(self, root: str, path: str, reserved: int, access: int) -> tuple[str, str]:
        key = (root, path)
        if key not in self.keys:
            raise FileNotFoundError(path)
        return key

    def QueryValueEx(self, key: tuple[str, str], name: str) -> tuple[object, int]:
        try:
            return self.values[(key[0], key[1], name)]
        except KeyError as exc:
            raise FileNotFoundError(name) from exc

    def SetValueEx(self, key: tuple[str, str], name: str, reserved: int, value_type: int, value: object) -> None:
        self.values[(key[0], key[1], name)] = (value, value_type)

    def DeleteValue(self, key: tuple[str, str], name: str) -> None:
        try:
            del self.values[(key[0], key[1], name)]
        except KeyError as exc:
            raise FileNotFoundError(name) from exc

    def CloseKey(self, key: tuple[str, str]) -> None:
        return None


def configure_temp_data(root: Path) -> None:
    zeter.DATA_DIR = root / "data"
    zeter.BACKUP_DIR = zeter.DATA_DIR / "backups"
    zeter.LOG_DIR = zeter.DATA_DIR / "logs"
    zeter.STATE_FILE = zeter.DATA_DIR / "zeter-os-state.json"
    zeter.RESTORE_FILE = zeter.DATA_DIR / "restore-points.json"
    zeter.LOG_FILE = zeter.LOG_DIR / "zeter-os.log"
    zeter.READABLE_ROOT_DIR = zeter.DATA_DIR / "Рабочие столы"
    zeter.READABLE_SUMMARY_FILE = zeter.DATA_DIR / "README_ДАННЫЕ_WINDOWS.txt"
    zeter.MANAGED_FILE_ROOT_DIR = zeter.DATA_DIR / "Файлы ZeTer OS"
    zeter.MANAGED_FILE_INCOMING_DIR = zeter.MANAGED_FILE_ROOT_DIR / ".incoming"
    zeter.ITEM_ASSET_ROOT_DIR = zeter.DATA_DIR / "Оформление объектов"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="zeter-managed-file-") as temp:
        temp_root = Path(temp)
        source_root = temp_root / "Исходный компьютер" / "ZeTer OS source"
        source_root.mkdir(parents=True)
        configure_temp_data(source_root)
        zeter.MANAGED_FILE_INCOMING_DIR.mkdir(parents=True, exist_ok=True)
        zeter.atomic_write_json(
            zeter.STATE_FILE,
            {"state": {"systemSettings": {"startup": {"windowMode": "windowed"}}}},
        )
        assert zeter.startup_window_maximized() is False, "Windowed startup preference was ignored"
        zeter.atomic_write_json(
            zeter.STATE_FILE,
            {"systemSettings": {"startup": {"windowMode": "maximized"}}},
        )
        assert zeter.startup_window_maximized() is True, "Maximized startup preference was ignored"
        zeter.STATE_FILE.unlink()
        stale_part = zeter.MANAGED_FILE_INCOMING_DIR / "stale.part"
        stale_part.write_bytes(b"partial")
        platform_opener = RecordingPlatformOpener()
        registry = MemoryRegistry()
        startup_command = '"C:\\Программы ZeTer OS\\pythonw.exe" "C:\\Программы ZeTer OS\\run_zeter_os.py"'
        startup_manager = zeter.WindowsStartupManager(
            registry_module=registry,
            command_provider=lambda: startup_command,
            platform_name="win32",
        )
        api = zeter.NativeStorageApi(
            platform_opener=platform_opener,
            windows_startup_manager=startup_manager,
        )
        assert not stale_part.exists(), "Stale partial upload was not cleaned on startup"
        startup_status = api.get_windows_startup_status()
        assert startup_status.get("ok") is True and startup_status.get("enabled") is False
        invalid_startup = api.set_windows_startup_enabled("yes")
        assert invalid_startup.get("ok") is False
        enabled_startup = api.set_windows_startup_enabled(True)
        assert enabled_startup.get("ok") is True and enabled_startup.get("enabled") is True, enabled_startup
        startup_value_key = (
            registry.HKEY_CURRENT_USER,
            zeter.WINDOWS_RUN_REGISTRY_PATH,
            zeter.WINDOWS_RUN_VALUE_NAME,
        )
        assert registry.values[startup_value_key] == (startup_command, registry.REG_SZ)
        registry.values[startup_value_key] = ('"D:\\Старая папка\\run_zeter_os.py"', registry.REG_SZ)
        stale_startup = api.get_windows_startup_status()
        assert stale_startup.get("enabled") is False and stale_startup.get("stale") is True
        refreshed_startup = api.set_windows_startup_enabled(True)
        assert refreshed_startup.get("enabled") is True and refreshed_startup.get("stale") is False
        disabled_startup = api.set_windows_startup_enabled(False)
        assert disabled_startup.get("ok") is True and disabled_startup.get("enabled") is False
        assert startup_value_key not in registry.values
        assert zeter.cpu_percent_from_system_times((100, 500, 500), (120, 600, 600)) == 90.0
        first_metrics = api.get_system_metrics()
        second_metrics = api.get_system_metrics()
        assert first_metrics.get("ok") is True and second_metrics.get("ok") is True, second_metrics
        assert int(second_metrics.get("logicalProcessors") or 0) >= 1
        assert int(second_metrics.get("diskTotalBytes") or 0) > 0
        assert int(second_metrics.get("diskFreeBytes") or -1) >= 0
        if sys.platform.startswith("win"):
            assert int(second_metrics.get("memoryTotalBytes") or 0) > 0
            assert int(second_metrics.get("uptimeMs") or 0) > 0
        missing_state = api.load_state()
        assert missing_state.get("ok") is True and missing_state.get("record") is None
        zeter.STATE_FILE.write_text("{broken", encoding="utf-8")
        damaged_state = api.load_state()
        assert damaged_state.get("ok") is False and "Expecting" in damaged_state.get("error", "")
        zeter.STATE_FILE.write_text("{}", encoding="utf-8")
        empty_state = api.load_state()
        assert empty_state.get("ok") is False and "JSON-объект" in empty_state.get("error", "")
        zeter.STATE_FILE.unlink()

        first_point = api.save_restore_point({"id": "restore-one", "name": "One", "state": {"fs": {}, "settings": {}}})
        second_point = api.save_restore_point({"id": "restore-two", "name": "Two", "state": {"fs": {}, "settings": {}}})
        assert first_point.get("ok") is True and second_point.get("ok") is True
        deleted_point = api.delete_restore_point("restore-one")
        assert deleted_point.get("ok") is True and deleted_point.get("removed") == 1
        assert [point.get("id") for point in api.load_restore_points().get("points", [])] == ["restore-two"]

        atomic_target = zeter.DATA_DIR / "parallel-atomic.bin"
        atomic_payloads = [b"A" * 131_072, b"B" * 131_072]
        atomic_barrier = threading.Barrier(3)
        atomic_errors: list[Exception] = []

        def write_atomic_payload(payload: bytes) -> None:
            try:
                atomic_barrier.wait()
                zeter.atomic_write_bytes(atomic_target, payload)
            except Exception as exc:
                atomic_errors.append(exc)

        atomic_threads = [
            threading.Thread(target=write_atomic_payload, args=(payload,))
            for payload in atomic_payloads
        ]
        for thread in atomic_threads:
            thread.start()
        atomic_barrier.wait()
        for thread in atomic_threads:
            thread.join(timeout=10)
        assert not atomic_errors and not any(thread.is_alive() for thread in atomic_threads), atomic_errors
        assert atomic_target.read_bytes() in atomic_payloads, "Concurrent atomic write produced mixed bytes"
        assert not list(zeter.DATA_DIR.rglob(".zeter-atomic-*.tmp")), "Successful atomic write left temporary files"

        atomic_failure_target = zeter.DATA_DIR / "atomic-failure.bin"
        atomic_failure_target.write_bytes(b"previous")
        original_replace = zeter.os.replace

        def fail_atomic_replace(source: object, target: object) -> None:
            if Path(target) == atomic_failure_target:
                raise OSError("simulated replace failure")
            original_replace(source, target)

        zeter.os.replace = fail_atomic_replace
        try:
            try:
                zeter.atomic_write_bytes(atomic_failure_target, b"new")
                raise AssertionError("Simulated replace failure was not raised")
            except OSError as exc:
                assert "simulated replace failure" in str(exc)
        finally:
            zeter.os.replace = original_replace
        assert atomic_failure_target.read_bytes() == b"previous"
        assert not list(zeter.DATA_DIR.rglob(".zeter-atomic-*.tmp")), "Failed atomic write left temporary files"

        restore_barrier = threading.Barrier(3)
        restore_results: list[dict[str, object]] = []

        def add_restore_point(point_id: str) -> None:
            restore_barrier.wait()
            restore_results.append(api.save_restore_point({
                "id": point_id,
                "name": point_id,
                "state": {"fs": {}, "settings": {"point": point_id}},
            }))

        restore_threads = [
            threading.Thread(target=add_restore_point, args=("parallel-one",)),
            threading.Thread(target=add_restore_point, args=("parallel-two",)),
        ]
        for thread in restore_threads:
            thread.start()
        restore_barrier.wait()
        for thread in restore_threads:
            thread.join(timeout=10)
        assert not any(thread.is_alive() for thread in restore_threads)
        assert all(result.get("ok") is True for result in restore_results), restore_results
        parallel_ids = {point.get("id") for point in api.load_restore_points().get("points", [])}
        assert {"parallel-one", "parallel-two"}.issubset(parallel_ids), parallel_ids

        same_id_barrier = threading.Barrier(3)
        same_id_results: list[dict[str, object]] = []

        def replace_same_restore_point(marker: str) -> None:
            same_id_barrier.wait()
            same_id_results.append(api.save_restore_point({
                "id": "parallel-same",
                "name": marker,
                "state": {"fs": {}, "settings": {"marker": marker}},
            }))

        same_id_threads = [
            threading.Thread(target=replace_same_restore_point, args=("first",)),
            threading.Thread(target=replace_same_restore_point, args=("second",)),
        ]
        for thread in same_id_threads:
            thread.start()
        same_id_barrier.wait()
        for thread in same_id_threads:
            thread.join(timeout=10)
        assert not any(thread.is_alive() for thread in same_id_threads)
        assert all(result.get("ok") is True for result in same_id_results), same_id_results
        same_id_points = [
            point
            for point in api.load_restore_points().get("points", [])
            if point.get("id") == "parallel-same"
        ]
        assert len(same_id_points) == 1
        assert same_id_points[0]["state"]["settings"]["marker"] in {"first", "second"}

        seed_delete = api.save_restore_point({
            "id": "parallel-delete",
            "name": "Delete",
            "state": {"fs": {}, "settings": {}},
        })
        assert seed_delete.get("ok") is True
        mutation_barrier = threading.Barrier(3)
        mutation_results: list[dict[str, object]] = []

        def concurrent_add() -> None:
            mutation_barrier.wait()
            mutation_results.append(api.save_restore_point({
                "id": "parallel-keep",
                "name": "Keep",
                "state": {"fs": {}, "settings": {}},
            }))

        def concurrent_delete() -> None:
            mutation_barrier.wait()
            mutation_results.append(api.delete_restore_point("parallel-delete"))

        mutation_threads = [
            threading.Thread(target=concurrent_add),
            threading.Thread(target=concurrent_delete),
        ]
        for thread in mutation_threads:
            thread.start()
        mutation_barrier.wait()
        for thread in mutation_threads:
            thread.join(timeout=10)
        assert not any(thread.is_alive() for thread in mutation_threads)
        assert all(result.get("ok") is True for result in mutation_results), mutation_results
        mutation_ids = {point.get("id") for point in api.load_restore_points().get("points", [])}
        assert "parallel-keep" in mutation_ids and "parallel-delete" not in mutation_ids

        zeter.LOG_FILE.write_bytes(b"x" * (300 * 1024))
        old_backup = zeter.BACKUP_DIR / "zeter-os-state-old.json"
        old_backup.write_text("{}", encoding="utf-8")
        old_time = zeter.time.time() - 100 * 24 * 60 * 60
        zeter.os.utime(old_backup, (old_time, old_time))
        for index in range(3):
            recent = zeter.BACKUP_DIR / f"recent-{index}.json"
            recent.write_text("{}", encoding="utf-8")
        temp_file = zeter.BACKUP_DIR / "unfinished.tmp"
        temp_file.write_bytes(b"temporary")
        stale_temp_time = zeter.time.time() - 2 * 24 * 60 * 60
        zeter.os.utime(temp_file, (stale_temp_time, stale_temp_time))
        fresh_temp_file = zeter.BACKUP_DIR / "active-write.tmp"
        fresh_temp_file.write_bytes(b"active")
        stale_atomic_temp = zeter.DATA_DIR / ".zeter-atomic-orphan.tmp"
        stale_atomic_temp.write_bytes(b"orphan")
        zeter.os.utime(stale_atomic_temp, (stale_temp_time, stale_temp_time))
        user_temp = zeter.DATA_DIR / "user-file.tmp"
        user_temp.write_bytes(b"user data")
        zeter.os.utime(user_temp, (stale_temp_time, stale_temp_time))
        cleanup_preview = api.cleanup_security_artifacts({"dryRun": True, "logs": True, "backups": True, "temporary": True})
        assert cleanup_preview.get("ok") is True and cleanup_preview.get("reclaimBytes", 0) > 0
        cleanup_result = api.cleanup_security_artifacts({"dryRun": False, "logs": True, "backups": True, "temporary": True})
        assert cleanup_result.get("ok") is True and not old_backup.exists() and not temp_file.exists() and fresh_temp_file.exists()
        assert not stale_atomic_temp.exists() and user_temp.exists(), "Temporary cleanup touched an unrecognized user file"
        assert zeter.LOG_FILE.stat().st_size < 270 * 1024

        readable_state = {
            "desktops": [{"id": "desktop-main", "name": "Рабочий стол 1", "data": {}}],
            "currentDesktop": "desktop-main",
            "fs": {
                "projects": {"id": "projects", "type": "folder", "name": "Проекты", "parent": "desktop-main"},
                "nested-note": {"id": "nested-note", "type": "note", "name": "Одинаковая", "parent": "projects", "content": "Первая"},
                "root-note": {"id": "root-note", "type": "note", "name": "Одинаковая", "parent": "desktop-main", "content": "Вторая"},
            },
        }
        zeter.export_windows_readable_data(readable_state)
        notes_dir = zeter.READABLE_ROOT_DIR / "01 - Рабочий стол 1" / "Заметки"
        assert {path.name for path in notes_dir.iterdir()} == {"Одинаковая.docx", "Одинаковая (2).docx"}
        assert not (notes_dir / "Проекты").exists(), "Readable notes unexpectedly repeat ZeTer OS folders"
        original_note_bytes = (notes_dir / "Одинаковая.docx").read_bytes()
        original_write_windows_text = zeter.write_windows_text

        def fail_staged_readable_write(path: Path, text: str) -> None:
            if path.name == "settings.json":
                raise OSError("simulated readable staging failure")
            original_write_windows_text(path, text)

        zeter.write_windows_text = fail_staged_readable_write
        try:
            try:
                zeter.export_windows_readable_data(readable_state)
                raise AssertionError("Readable staging failure was not reported")
            except OSError as error:
                assert "simulated readable staging failure" in str(error)
        finally:
            zeter.write_windows_text = original_write_windows_text
        assert (notes_dir / "Одинаковая.docx").read_bytes() == original_note_bytes, "A failed rebuild damaged the live readable mirror"
        assert not list(zeter.DATA_DIR.glob(".zeter-readable-*")), "Readable staging artifacts were not cleaned"

        try:
            zeter.managed_file_path("../outside.txt")
            raise AssertionError("Path traversal was accepted")
        except ValueError:
            pass

        incomplete = api.begin_file_import({"name": "broken.bin", "size": 2, "directoryParts": ["Стол"]})
        assert incomplete.get("ok") is True, incomplete
        partial = api.append_file_chunk({"uploadId": incomplete["uploadId"], "offset": 0, "base64": base64.b64encode(b"x").decode("ascii")})
        assert partial.get("ok") is True, partial
        rejected = api.finish_file_import({"uploadId": incomplete["uploadId"]})
        assert rejected.get("ok") is False, rejected
        cancelled = api.cancel_file_import({"uploadId": incomplete["uploadId"]})
        assert cancelled.get("ok") is True, cancelled

        raw = ("ZeTer OS managed file smoke\n" * 80_000).encode("utf-8")
        begin = api.begin_file_import({
            "name": "тестовое видео.mp4",
            "size": len(raw),
            "type": "video/mp4",
            "directoryParts": ["Рабочий стол 1", "Рабочий стол", "Папка"],
        })
        assert begin.get("ok") is True, begin
        upload_id = begin["uploadId"]
        chunk_size = int(begin["chunkBytes"])
        for offset in range(0, len(raw), chunk_size):
            chunk = raw[offset:offset + chunk_size]
            result = api.append_file_chunk({
                "uploadId": upload_id,
                "offset": offset,
                "base64": base64.b64encode(chunk).decode("ascii"),
            })
            assert result.get("ok") is True, result
        finished = api.finish_file_import({"uploadId": upload_id})
        assert finished.get("ok") is True, finished
        managed_file = finished["file"]
        copied_path = zeter.managed_file_path(managed_file["managedPath"], require_file=True)
        assert copied_path.read_bytes() == raw

        tiny_png_data_url = (
            "data:image/png;base64,"
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg=="
        )
        folder_icon_result = api.save_item_asset({
            "itemId": "custom-folder",
            "kind": "folder-icon",
            "name": "значок.png",
            "dataURL": tiny_png_data_url,
        })
        folder_background_result = api.save_item_asset({
            "itemId": "custom-folder",
            "kind": "folder-background",
            "name": "фон.png",
            "dataURL": tiny_png_data_url,
        })
        shortcut_icon_result = api.save_item_asset({
            "itemId": "custom-shortcut",
            "kind": "shortcut-icon",
            "name": "ярлык.png",
            "dataURL": tiny_png_data_url,
        })
        rejected_item_asset = api.save_item_asset({
            "itemId": "../outside",
            "kind": "folder-icon",
            "name": "опасный.png",
            "dataURL": tiny_png_data_url,
        })
        assert folder_icon_result.get("ok") is True, folder_icon_result
        assert folder_background_result.get("ok") is True, folder_background_result
        assert shortcut_icon_result.get("ok") is True, shortcut_icon_result
        assert rejected_item_asset.get("ok") is False, rejected_item_asset
        folder_icon_path = zeter.item_asset_path(folder_icon_result["asset"]["path"], require_file=True)
        folder_background_path = zeter.item_asset_path(folder_background_result["asset"]["path"], require_file=True)
        shortcut_icon_path = zeter.item_asset_path(shortcut_icon_result["asset"]["path"], require_file=True)

        windows_target = r"C:\ZeTer OS\Документ.txt"
        opened = api.open_managed_file({"managedPath": managed_file["managedPath"]})
        opened_data = api.open_data_folder()
        opened_logs = api.open_logs_folder()
        opened_readable = api.open_readable_folder()
        external_file = api.open_external_target({"target": windows_target})
        external_url = api.open_external_target({"target": "https://example.com/docs"})
        rejected_scheme = api.open_external_target({"target": "javascript:alert(1)"})
        rejected_relative = api.open_external_target({"target": "relative/file.txt"})
        assert opened.get("ok") is True, opened
        assert opened_data.get("ok") is True, opened_data
        assert opened_logs.get("ok") is True, opened_logs
        assert opened_readable.get("ok") is True, opened_readable
        assert external_file.get("ok") is True, external_file
        assert external_url.get("ok") is True, external_url
        assert rejected_scheme.get("ok") is False, rejected_scheme
        assert rejected_relative.get("ok") is False, rejected_relative
        assert platform_opener.paths == [
            str(copied_path),
            str(zeter.DATA_DIR),
            str(zeter.LOG_DIR),
            str(zeter.READABLE_ROOT_DIR),
        ], "Files and folders were not passed only to the injected platform opener"
        assert platform_opener.windows_targets == [windows_target], "Windows target was not passed to the injected platform opener"
        assert platform_opener.urls == ["https://example.com/docs"], "URL was not passed to the injected platform opener"
        recording_window = RecordingWindow()
        api._window = recording_window
        closed = api.close_app()
        assert closed.get("ok") is True and closed.get("closing") is True
        assert recording_window.destroyed is True

        state = {
            "fs": {
                "shortcut": {
                    "id": "shortcut",
                    "type": "managedFile",
                    "name": managed_file["name"],
                    "parent": "desktop-main",
                    "managedFile": managed_file,
                },
                "shortcut-copy": {
                    "id": "shortcut-copy",
                    "type": "managedFile",
                    "name": managed_file["name"],
                    "parent": "desktop-main",
                    "managedFile": managed_file,
                },
                "portable-note": {
                    "id": "portable-note",
                    "type": "note",
                    "name": "Переносимая заметка",
                    "parent": "desktop-main",
                    "content": "Текст с кириллицей сохраняется полностью",
                },
                "custom-folder": {
                    "id": "custom-folder",
                    "type": "folder",
                    "name": "Оформленная папка",
                    "parent": "desktop-main",
                    "appearance": {
                        "color": "#4f8fe8",
                        "icon": {
                            "dataURL": tiny_png_data_url,
                            "assetPath": folder_icon_result["asset"]["path"],
                        },
                        "background": {
                            "dataURL": tiny_png_data_url,
                            "assetPath": folder_background_result["asset"]["path"],
                        },
                    },
                },
                "custom-shortcut": {
                    "id": "custom-shortcut",
                    "type": "shortcut",
                    "name": "Документация",
                    "parent": "desktop-main",
                    "shortcut": {"kind": "url", "target": "https://example.com/docs"},
                    "appearance": {
                        "icon": {
                            "dataURL": tiny_png_data_url,
                            "assetPath": shortcut_icon_result["asset"]["path"],
                        },
                    },
                },
            },
            "desktops": [{
                "id": "desktop-main",
                "name": "Рабочий стол 1",
                "data": {
                    "settings": {"accent": "#123456"},
                    "tasks": [{"id": "portable-task", "title": "Переносимая задача", "done": False}],
                    "events": [{"id": "portable-event", "title": "Переносимое событие", "date": "2030-01-02"}],
                    "notifications": [{"id": "portable-notification", "title": "Переносимое уведомление"}],
                    "externalSaveEnabled": True,
                    "externalSaveStatus": f"{zeter.NATIVE_DATA_STATUS_PREFIX} {zeter.DATA_DIR}",
                },
            }],
            "currentDesktop": "desktop-main",
            "systemSettings": {"startup": {"windowMode": "windowed", "restoreWindows": True}},
            "security": {"portableSentinel": "security-data-kept"},
        }
        saved = api.save_state({"state": state, "osVersion": "smoke", "versionNumber": 1})
        assert saved.get("ok") is True and saved.get("portableMetadata") == 1 and copied_path.exists(), saved
        assert saved.get("itemAssets") == 3
        assert folder_icon_path.exists() and folder_background_path.exists() and shortcut_icon_path.exists()
        persisted = zeter.read_json_file(zeter.STATE_FILE)["state"]
        assert persisted["desktops"][0]["data"]["externalSaveStatus"] == zeter.NATIVE_DATA_PORTABLE_STATUS
        assert str(source_root) not in str(persisted), "The canonical state retained a source-computer path"

        restore_saved = api.save_restore_point({"id": "portable-point", "name": "Portable", "state": state})
        assert restore_saved.get("ok") is True, restore_saved
        restore_loaded = api.load_restore_points()
        portable_point = next(point for point in restore_loaded["points"] if point.get("id") == "portable-point")
        assert portable_point["state"]["desktops"][0]["data"]["externalSaveStatus"] == zeter.NATIVE_DATA_PORTABLE_STATUS

        immutable_state = copy.deepcopy(state)
        immutable_state["fs"]["archived-note"] = {
            "id": "archived-note",
            "type": "note",
            "name": "Снимок до удаления",
            "parent": "desktop-main",
            "content": "Эта версия должна остаться в точке восстановления.",
        }
        immutable_saved = api.save_restore_point({
            "id": "immutable-point",
            "name": "Immutable",
            "state": immutable_state,
        })
        assert immutable_saved.get("ok") is True, immutable_saved
        immutable_restore_bytes = zeter.RESTORE_FILE.read_bytes()
        immutable_backup = zeter.BACKUP_DIR / "immutable-auto-backup.json"
        immutable_backup.write_text('{"sentinel":"immutable-backup"}', encoding="utf-8")
        immutable_backup_bytes = immutable_backup.read_bytes()
        api._last_previous_backup_at = zeter.time.time()
        deletion_record = {
            "state": copy.deepcopy(state),
            "osVersion": "smoke",
            "versionNumber": 1,
        }
        deletion_record["state"]["_zeterDeletedIdsToPurge"] = ["archived-note"]
        deletion_record_before = copy.deepcopy(deletion_record)
        deletion_saved = api.save_state(deletion_record)
        assert deletion_saved.get("ok") is True and deletion_saved.get("primaryVerified") is True, deletion_saved
        assert deletion_record == deletion_record_before, "save_state mutated the caller-owned record"
        assert zeter.RESTORE_FILE.read_bytes() == immutable_restore_bytes, "Ordinary save rewrote an existing restore point"
        assert immutable_backup.read_bytes() == immutable_backup_bytes, "Ordinary save changed an existing auto backup"
        immutable_loaded = api.load_restore_points()
        immutable_point = next(point for point in immutable_loaded["points"] if point.get("id") == "immutable-point")
        assert "archived-note" in immutable_point["state"]["fs"], "Ordinary deletion changed a restore snapshot"

        api._last_previous_backup_at = 0
        primary_before_first_snapshot = zeter.STATE_FILE.read_bytes()
        first_snapshot_save = api.save_state({
            "state": copy.deepcopy(state),
            "osVersion": "smoke-snapshot-one",
            "versionNumber": 1,
        })
        first_snapshot_path = Path(first_snapshot_save.get("previousBackup") or "")
        assert first_snapshot_save.get("ok") is True and first_snapshot_path.is_file(), first_snapshot_save
        assert first_snapshot_path.read_bytes() == primary_before_first_snapshot
        first_snapshot_bytes = first_snapshot_path.read_bytes()
        api._last_previous_backup_at = 0
        second_snapshot_state = copy.deepcopy(state)
        second_snapshot_state["security"]["immutableSnapshotSequence"] = 2
        second_snapshot_save = api.save_state({
            "state": second_snapshot_state,
            "osVersion": "smoke-snapshot-two",
            "versionNumber": 1,
        })
        second_snapshot_path = Path(second_snapshot_save.get("previousBackup") or "")
        assert second_snapshot_save.get("ok") is True and second_snapshot_path.is_file(), second_snapshot_save
        assert second_snapshot_path != first_snapshot_path, "Periodic save overwrote an existing previous snapshot"
        assert first_snapshot_path.read_bytes() == first_snapshot_bytes, "Existing previous snapshot was modified"

        primary_before_failure = zeter.STATE_FILE.read_bytes()
        restore_before_failure = zeter.RESTORE_FILE.read_bytes()
        backups_before_failure = {
            path.name: path.read_bytes()
            for path in zeter.BACKUP_DIR.glob("*.json")
            if path.is_file()
        }
        managed_before_failure = copied_path.read_bytes()
        icon_before_failure = folder_icon_path.read_bytes()
        failed_record = {
            "state": copy.deepcopy(state),
            "osVersion": "smoke-failure",
            "versionNumber": 2,
        }
        failed_record["state"]["_zeterDeletedIdsToPurge"] = ["shortcut", "custom-folder"]
        failed_record_before = copy.deepcopy(failed_record)
        original_atomic_write_json = zeter.atomic_write_json

        def fail_primary_state_write(path: Path, value: object) -> None:
            if path == zeter.STATE_FILE:
                raise OSError("simulated primary state write failure")
            original_atomic_write_json(path, value)

        zeter.atomic_write_json = fail_primary_state_write
        try:
            failed_save = api.save_state(failed_record)
        finally:
            zeter.atomic_write_json = original_atomic_write_json
        assert failed_save.get("ok") is False and failed_save.get("stage") == "primary-confirm", failed_save
        assert "simulated primary state write failure" in failed_save.get("error", "")
        failure_log = zeter.LOG_FILE.read_text(encoding="utf-8")
        assert "SAVE_ERROR stage=primary-confirm" in failure_log
        assert "simulated primary state write failure" in failure_log
        assert failed_record == failed_record_before, "Failed save mutated the caller-owned record"
        assert zeter.STATE_FILE.read_bytes() == primary_before_failure, "Failed save changed the previous primary state"
        assert zeter.RESTORE_FILE.read_bytes() == restore_before_failure, "Failed save changed restore points"
        assert {
            path.name: path.read_bytes()
            for path in zeter.BACKUP_DIR.glob("*.json")
            if path.is_file()
        } == backups_before_failure, "Failed save changed automatic backups"
        assert copied_path.read_bytes() == managed_before_failure, "Failed save removed or changed a managed file"
        assert folder_icon_path.read_bytes() == icon_before_failure, "Failed save removed or changed an item asset"

        original_read_json_file = zeter.read_json_file
        verification_reads = 0

        def return_mismatched_primary_once(path: Path) -> object:
            nonlocal verification_reads
            if path == zeter.STATE_FILE and verification_reads == 0:
                verification_reads += 1
                return {"state": {"mismatched": True}}
            return original_read_json_file(path)

        zeter.read_json_file = return_mismatched_primary_once
        try:
            unconfirmed_save = api.save_state({
                "state": copy.deepcopy(state),
                "osVersion": "smoke-unconfirmed",
                "versionNumber": 3,
            })
        finally:
            zeter.read_json_file = original_read_json_file
        assert unconfirmed_save.get("ok") is False and verification_reads == 1, unconfirmed_save
        assert zeter.STATE_FILE.read_bytes() == primary_before_failure, "Unconfirmed save did not roll back the primary state"
        assert zeter.RESTORE_FILE.read_bytes() == restore_before_failure, "Unconfirmed save changed restore points"
        assert copied_path.read_bytes() == managed_before_failure, "Unconfirmed save changed a managed file"
        assert folder_icon_path.read_bytes() == icon_before_failure, "Unconfirmed save changed an item asset"

        original_export_windows_readable_data = zeter.export_windows_readable_data
        zeter.export_windows_readable_data = lambda _state: (_ for _ in ()).throw(OSError("simulated readable publish failure"))
        try:
            state["security"]["saveAfterReadableFailure"] = "confirmed"
            partial = api.save_state({"state": state, "osVersion": "smoke", "versionNumber": 1})
        finally:
            zeter.export_windows_readable_data = original_export_windows_readable_data
        assert partial.get("ok") is True and partial.get("readableOk") is False, partial
        assert zeter.read_json_file(zeter.STATE_FILE)["state"]["security"]["saveAfterReadableFailure"] == "confirmed", "Canonical state was not kept when the readable mirror failed"

        portable_root = temp_root / "Другой компьютер" / "ZeTer OS перенос"
        portable_root.mkdir(parents=True)
        shutil.copytree(zeter.DATA_DIR, portable_root / "data")
        configure_temp_data(portable_root)
        portable_api = zeter.NativeStorageApi()
        portable_loaded = portable_api.load_state()
        assert portable_loaded.get("ok") is True, portable_loaded
        portable_state = portable_loaded["record"]["state"]
        assert portable_state["fs"]["portable-note"]["content"] == "Текст с кириллицей сохраняется полностью"
        assert portable_state["desktops"][0]["data"]["tasks"][0]["id"] == "portable-task"
        assert portable_state["desktops"][0]["data"]["events"][0]["id"] == "portable-event"
        assert portable_state["desktops"][0]["data"]["notifications"][0]["id"] == "portable-notification"
        assert portable_state["security"]["saveAfterReadableFailure"] == "confirmed"
        assert portable_state["desktops"][0]["data"]["externalSaveStatus"] == zeter.NATIVE_DATA_PORTABLE_STATUS
        portable_copied_path = zeter.managed_file_path(managed_file["managedPath"], require_file=True)
        assert portable_copied_path.read_bytes() == raw, "Managed file bytes changed after copying data"
        assert zeter.item_asset_path(portable_state["fs"]["custom-folder"]["appearance"]["icon"]["assetPath"], require_file=True).exists()
        assert zeter.item_asset_path(portable_state["fs"]["custom-folder"]["appearance"]["background"]["assetPath"], require_file=True).exists()
        assert zeter.item_asset_path(portable_state["fs"]["custom-shortcut"]["appearance"]["icon"]["assetPath"], require_file=True).exists()
        portable_info = portable_api.get_storage_info()
        assert Path(portable_info["dataDir"]) == zeter.DATA_DIR and str(source_root) not in portable_info["dataDir"]
        portable_resaved = portable_api.save_state({"state": portable_state, "osVersion": "smoke", "versionNumber": 1})
        assert portable_resaved.get("ok") is True and portable_copied_path.exists(), portable_resaved

        configure_temp_data(source_root)

        one_reference = {**state, "fs": {"shortcut-copy": state["fs"]["shortcut-copy"]}}
        retained = api.save_state({"state": one_reference, "osVersion": "smoke", "versionNumber": 1})
        assert retained.get("ok") is True and copied_path.exists(), retained
        assert retained.get("itemAssetsRemoved") == 0, retained
        assert folder_icon_path.exists() and folder_background_path.exists() and shortcut_icon_path.exists()

        deleted = api.save_state({"state": {**state, "fs": {}}, "osVersion": "smoke", "versionNumber": 1})
        assert deleted.get("ok") is True, deleted
        assert copied_path.exists(), "A recovery snapshot still references the managed file"
        assert folder_icon_path.exists() and folder_background_path.exists() and shortcut_icon_path.exists()

        recovery_root = temp_root / "Полный цикл восстановления"
        recovery_root.mkdir(parents=True)
        configure_temp_data(recovery_root)
        zeter.MANAGED_FILE_INCOMING_DIR.mkdir(parents=True, exist_ok=True)
        recovery_api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
        recovery_raw = b"recovery-payload-\x00\xff" * 128
        recovery_begin = recovery_api.begin_file_import({
            "name": "восстановление.bin",
            "size": len(recovery_raw),
            "type": "application/octet-stream",
            "directoryParts": ["Рабочий стол", "Recovery"],
        })
        assert recovery_begin.get("ok") is True, recovery_begin
        recovery_append = recovery_api.append_file_chunk({
            "uploadId": recovery_begin["uploadId"],
            "offset": 0,
            "base64": base64.b64encode(recovery_raw).decode("ascii"),
        })
        assert recovery_append.get("ok") is True, recovery_append
        recovery_finished = recovery_api.finish_file_import({"uploadId": recovery_begin["uploadId"]})
        assert recovery_finished.get("ok") is True, recovery_finished
        recovery_managed = recovery_finished["file"]
        recovery_managed_path = zeter.managed_file_path(recovery_managed["managedPath"], require_file=True)

        recovery_icon = recovery_api.save_item_asset({
            "itemId": "recovery-folder",
            "kind": "folder-icon",
            "name": "значок.png",
            "dataURL": tiny_png_data_url,
        })
        recovery_background = recovery_api.save_item_asset({
            "itemId": "recovery-folder",
            "kind": "folder-background",
            "name": "фон.png",
            "dataURL": tiny_png_data_url,
        })
        assert recovery_icon.get("ok") is True and recovery_background.get("ok") is True
        recovery_icon_path = zeter.item_asset_path(recovery_icon["asset"]["path"], require_file=True)
        recovery_background_path = zeter.item_asset_path(recovery_background["asset"]["path"], require_file=True)
        recovery_icon_bytes = recovery_icon_path.read_bytes()
        recovery_background_bytes = recovery_background_path.read_bytes()

        recovery_state = {
            "fs": {
                "managed-recovery": {
                    "id": "managed-recovery",
                    "type": "managedFile",
                    "managedFile": recovery_managed,
                },
                "recovery-folder": {
                    "id": "recovery-folder",
                    "type": "folder",
                    "appearance": {
                        "icon": {"assetPath": recovery_icon["asset"]["path"]},
                        "background": {"assetPath": recovery_background["asset"]["path"]},
                    },
                },
            },
            "settings": {},
        }
        recovery_saved = recovery_api.save_state({
            "state": recovery_state,
            "osVersion": "smoke-recovery",
            "versionNumber": 1,
        })
        assert recovery_saved.get("ok") is True and recovery_saved.get("payloadGcOk") is True, recovery_saved
        recovery_point = recovery_api.save_restore_point({
            "id": "recovery-point",
            "name": "Recovery payload",
            "state": recovery_state,
        })
        assert recovery_point.get("ok") is True, recovery_point
        explicit_backup = zeter.BACKUP_DIR / "recovery-payload-backup.json"
        zeter.atomic_write_json(explicit_backup, {"state": recovery_state})

        reset_result = recovery_api.clear_state()
        assert reset_result.get("ok") is True and reset_result.get("backupFile"), reset_result
        assert not zeter.STATE_FILE.exists(), "Full reset left the primary state in place"
        assert recovery_managed_path.read_bytes() == recovery_raw
        assert recovery_icon_path.read_bytes() == recovery_icon_bytes
        assert recovery_background_path.read_bytes() == recovery_background_bytes

        restarted_api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener())
        ready_preflight = restarted_api.preflight_restore_point("recovery-point")
        assert ready_preflight.get("ok") is True and ready_preflight.get("ready") is True, ready_preflight

        held_managed_path = recovery_root / "held-recovery-payload.bin"
        recovery_managed_path.replace(held_managed_path)
        try:
            missing_preflight = restarted_api.preflight_restore_point("recovery-point")
            assert missing_preflight.get("ok") is True and missing_preflight.get("ready") is False, missing_preflight
            assert missing_preflight.get("missingManagedFiles") == [recovery_managed["managedPath"]]
            assert "проверенного ZIP-бэкапа" in missing_preflight.get("message", "")
        finally:
            held_managed_path.replace(recovery_managed_path)

        restore_points = zeter.read_json_file(zeter.RESTORE_FILE)
        restore_points.append({
            "id": "unsafe-point",
            "name": "Unsafe",
            "state": {"fs": {"escape": {"managedPath": "../outside.bin"}}},
        })
        zeter.atomic_write_json(zeter.RESTORE_FILE, restore_points)
        unsafe_preflight = restarted_api.preflight_restore_point("unsafe-point")
        assert unsafe_preflight.get("ok") is True and unsafe_preflight.get("ready") is False, unsafe_preflight
        assert unsafe_preflight.get("invalidManagedPaths") == ["../outside.bin"]
        unsafe_deleted = restarted_api.delete_restore_point("unsafe-point")
        assert unsafe_deleted.get("ok") is True and unsafe_deleted.get("removed") == 1, unsafe_deleted

        point_state = next(
            point["state"]
            for point in restarted_api.load_restore_points()["points"]
            if point.get("id") == "recovery-point"
        )
        restored = restarted_api.save_state({
            "state": point_state,
            "osVersion": "smoke-restored",
            "versionNumber": 1,
        })
        assert restored.get("ok") is True, restored
        assert recovery_managed_path.read_bytes() == recovery_raw
        assert recovery_icon_path.read_bytes() == recovery_icon_bytes
        assert recovery_background_path.read_bytes() == recovery_background_bytes

        restarted_api._last_previous_backup_at = zeter.time.time()
        emptied = restarted_api.save_state({
            "state": {"fs": {}, "settings": {}},
            "osVersion": "smoke-empty",
            "versionNumber": 1,
        })
        assert emptied.get("ok") is True, emptied
        assert recovery_managed_path.exists() and recovery_icon_path.exists() and recovery_background_path.exists()
        for backup_path in zeter.BACKUP_DIR.glob("*.json"):
            backup_path.unlink()
        final_delete = restarted_api.delete_restore_point("recovery-point")
        assert final_delete.get("ok") is True and final_delete.get("removed") == 1, final_delete
        assert final_delete.get("managedFilesRemoved") == 1, final_delete
        assert final_delete.get("itemAssetsRemoved") == 2, final_delete
        assert not recovery_managed_path.exists(), "GC kept a managed file after its last recovery reference was removed"
        assert not recovery_icon_path.exists() and not recovery_background_path.exists(), "GC kept item assets after their last recovery reference was removed"

    print("managed file native smoke: ok")


if __name__ == "__main__":
    main()
