"""Synthetic update boundary tests; no real state, GUI or GitHub requests.

Import preflight: updater, runner, package builder and launcher have no import-time
writes. NativeStorageApi construction is only performed after all effective state
paths are redirected to a fresh fixture. Child checks use a synthetic Python command.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import types
import unittest
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_updater as update
import update_runner as runner
from tools.build_update_package import build_package, verify_x64_executable


def fixture_distribution(root, version, extra=None):
    files = {
        update.EXE: b"synthetic executable " + version.encode(),
        update.HELPER: b"synthetic self-contained helper " + version.encode(),
        "app/index.html": b"<html>synthetic application</html>",
        "app/update-probe.html": b"<html>synthetic isolated probe</html>",
        "app/js/update-probe.js": b"/* synthetic probe */",
        "app/js/core/version.js": f'window.ZETER_OS_VERSION = "{version}";\n'.encode(),
        **(extra or {}),
    }
    for name, content in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    return files


class FakeParent:
    exit = True
    closed = False
    def __init__(self, *args):
        pass
    def wait(self, seconds, cancelled):
        return self.exit and not cancelled()
    def close(self):
        type(self).closed = True


class FakeClient:
    def __init__(self, release, archive, checksum=None):
        self.release, self.archive, self.checksum = release, archive, checksum
        self.calls = []
    def releases(self, cancel):
        return self.release
    def fetch(self, url, limit, cancel, **kwargs):
        self.calls.append(url)
        if cancel.is_set():
            raise update.UpdateError("Обновление отменено.")
        if kwargs.get("output"):
            kwargs["output"].write_bytes(self.archive)
            if kwargs.get("progress"):
                kwargs["progress"](len(self.archive))
            return b""
        return self.checksum


def release_asset(version, content=b"package", digest=True):
    name = f"ZeTer-OS-{version}-Windows-x64.zip"
    asset = {"name": name, "size": len(content), "browser_download_url": f"https://github.com/zeter1/ZeTer-OS/releases/download/build-abcdef1/{name}"}
    if digest:
        asset["digest"] = "sha256:" + hashlib.sha256(content).hexdigest()
    else:
        checksum = name[:-4] + ".sha256.txt"
        return {"draft": False, "prerelease": True, "tag_name": "build-abcdef1", "assets": [asset, {"name": checksum, "browser_download_url": f"https://github.com/zeter1/ZeTer-OS/releases/download/build-abcdef1/{checksum}"}]}
    return {"draft": False, "prerelease": True, "tag_name": "build-abcdef1", "assets": [asset]}


class UpdateTests(unittest.TestCase):
    def setUp(self):
        fixture_parent = Path(__file__).resolve().parents[1] / "work" / "update-tests"
        fixture_parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="ZeTer обновление ", dir=fixture_parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "Установка с пробелом"
        self.old_bytes = fixture_distribution(self.root, "4.0.10", {"removed.bin": b"old-only"})
        build_package(self.root, self.base / "old-package")
        self.old = update.read_manifest(self.root)
        self.old_bytes[update.MANIFEST] = (self.root / update.MANIFEST).read_bytes()
        new_root = self.base / "new-dist"
        self.new_bytes = fixture_distribution(new_root, "4.0.11", {"new.bin": b"new-only"})
        package, checksum = build_package(new_root, self.base / "new-package")
        self.archive_bytes = package.read_bytes()
        self.checksum = checksum.read_bytes()
        self.new = update.read_manifest(new_root)
        self.session = self.root / "data/updates" / uuid.uuid4().hex
        self.session.mkdir(parents=True)
        self.archive = self.session / "package.zip"
        self.archive.write_bytes(self.archive_bytes)
        update.stage_archive(self.archive, self.session / "stage", "4.0.11")
        self.protected = {"data/state.json": b'{"user":"sentinel"}', "Логи проблем/foreign.log": b"private logs", "manual.txt": b"unknown user file"}
        for name, content in self.protected.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)

    def assert_protected(self):
        for name, expected in self.protected.items():
            self.assertEqual((self.root / name).read_bytes(), expected, name)

    def assert_old(self):
        for name, expected in self.old_bytes.items():
            self.assertEqual((self.root / name).read_bytes(), expected, name)
        self.assertFalse((self.root / "new.bin").exists())
        self.assert_protected()

    def transaction(self, checkpoint=None):
        result = runner.Transaction(self.root, self.session, checkpoint=checkpoint)
        result.begin(self.old, self.new)
        return result

    def request(self):
        value = {"schema": 1, "root": str(self.root), "session": str(self.session), "old": self.old, "new": self.new, "parentPid": os.getpid(), "parentCreation": 123, "nonce": uuid.uuid4().hex}
        update.atomic_json(self.session, self.session / "request.json", value)
        return self.session / "request.json"

    def test_package_exact_independent_hashes(self):
        for name, content in self.new_bytes.items():
            self.assertEqual(self.new["files"][name], {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()})
        self.assertEqual(self.checksum.decode(), hashlib.sha256(self.archive_bytes).hexdigest() + "  ZeTer-OS-4.0.11-Windows-x64.zip\n")

    def test_x64_runtime_and_pe_publication_boundary(self):
        with patch.object(update.struct, "calcsize", return_value=4):
            manager = update.UpdateManager(self.root, self.root / "data", frozen=True, platform_name="win32")
            self.assertFalse(manager.get_status()["supported"])
        path = self.session / "pe.exe"
        header = bytearray(64)
        header[:2] = b"MZ"
        header[60:64] = (64).to_bytes(4, "little")
        path.write_bytes(header + b"PE\x00\x00" + (0x14c).to_bytes(2, "little"))
        with self.assertRaises(update.UpdateError):
            verify_x64_executable(path)
        path.write_bytes(header + b"PE\x00\x00" + (0x8664).to_bytes(2, "little"))
        verify_x64_executable(path)
        self.assert_old()

    def test_selection_numeric_prerelease_build_sha_no_downgrade(self):
        chosen = update.select_release([release_asset("3.9.99"), release_asset("4.0.11"), release_asset("4.0.9"), release_asset("4.0.12")], "4.0.10")
        self.assertEqual(chosen["version"], "4.0.12")
        self.assertIsNone(update.select_release([release_asset("4.0.10"), release_asset("4.0.9")], "4.0.10"))

    def test_ambiguous_and_unsigned_release_rejected(self):
        release = release_asset("4.0.11")
        with self.assertRaises(update.UpdateError):
            update.select_release([release, copy.deepcopy(release)], "4.0.10")
        del release["assets"][0]["digest"]
        with self.assertRaises(update.UpdateError):
            update.select_release([release], "4.0.10")

    def test_hostile_urls(self):
        for url in ("http://github.com/a", "https://github.com.evil/a", "https://github.com:443/a", "https://user@github.com/a", "https://127.0.0.1/a", "https://api.github.com/repos/other/other/releases", "https://objects.githubusercontent.com@evil/a"):
            with self.subTest(url=url), self.assertRaises(update.UpdateError):
                update.validate_url(url)
        release = release_asset("4.0.11")
        release["assets"][0]["browser_download_url"] = release["assets"][0]["browser_download_url"].replace("zeter1/ZeTer-OS", "evil/repo")
        with self.assertRaises(update.UpdateError):
            update.select_release([release], "4.0.10")

    def test_hostile_zip_paths_and_types_no_stage_writes(self):
        entries = ["../escape", "C:/evil", "/absolute", "app\\evil", "app/file:ads", "app/con.txt", "app/space ", "data/user.json", ".git/config", "app/a\x01b", "app/dir/", "LOGIPR~1/new.dll", "DATA~1/state.bin"]
        for index, name in enumerate(entries):
            bad = self.session / f"hostile-{index}.zip"
            with zipfile.ZipFile(bad, "w") as package:
                package.writestr(name, b"x")
            target = self.session / f"bad-stage-{index}"
            with self.subTest(name=name), self.assertRaises(update.UpdateError):
                update.stage_archive(bad, target, "4.0.11")
            self.assertFalse(target.exists())
        bad = self.session / "symlink.zip"
        with zipfile.ZipFile(bad, "w") as package:
            entry = zipfile.ZipInfo("app/link")
            entry.external_attr = (0o120777 << 16)
            package.writestr(entry, "../../escape")
        with self.assertRaises(update.UpdateError):
            update.stage_archive(bad, self.session / "symlink-stage", "4.0.11")

    def test_zip_manifest_hash_extra_case_collision_and_version(self):
        with zipfile.ZipFile(io.BytesIO(self.archive_bytes)) as original:
            members = {name: original.read(name) for name in original.namelist()}
        for mode in ("hash", "extra", "case", "version", "file-dir", "json-duplicate"):
            changed = dict(members)
            if mode == "hash":
                changed["new.bin"] = b"corrupt"
            elif mode == "extra":
                changed["foreign.bin"] = b"unexpected"
            elif mode == "case":
                changed["NEW.BIN"] = changed["new.bin"]
            elif mode == "version":
                value = copy.deepcopy(self.new)
                value["version"] = "4.0.12"
                changed[update.MANIFEST] = json.dumps(value).encode()
            elif mode == "file-dir":
                value = copy.deepcopy(self.new)
                value["files"]["app"] = {"size": 1, "sha256": hashlib.sha256(b"x").hexdigest()}
                changed[update.MANIFEST] = json.dumps(value).encode()
                changed["app"] = b"x"
            else:
                changed[update.MANIFEST] = b'{"schema":1,"schema":1}'
            bad = self.session / (mode + ".zip")
            with zipfile.ZipFile(bad, "w") as package:
                for name, content in changed.items():
                    package.writestr(name, content)
            target = self.session / ("bad-" + mode)
            with self.subTest(mode=mode), self.assertRaises(update.UpdateError):
                update.stage_archive(bad, target, "4.0.11")
            self.assertFalse(target.exists())

    def test_missing_manifest_modified_owned_unknown_collision(self):
        manifest = self.root / update.MANIFEST
        manifest.unlink()
        with self.assertRaises(update.UpdateError):
            update.preflight_install(self.root, self.session / "stage", self.old, self.new)
        manifest.write_bytes(self.old_bytes[update.MANIFEST])
        exe = self.root / update.EXE
        exe.write_bytes(b"locally modified")
        with self.assertRaises(update.UpdateError):
            update.preflight_install(self.root, self.session / "stage", self.old, self.new)
        exe.write_bytes(self.old_bytes[update.EXE])
        (self.root / "new.bin").write_bytes(b"manual collision")
        with self.assertRaises(update.UpdateError):
            update.preflight_install(self.root, self.session / "stage", self.old, self.new)
        self.assertEqual((self.root / "new.bin").read_bytes(), b"manual collision")
        self.assert_protected()

    def test_junction_escape_refused(self):
        outside = self.base / "outside"
        outside.mkdir()
        junction = self.root / "escape"
        if sys.platform == "win32":
            result = subprocess.run(["cmd", "/c", "mklink", "/J", str(junction), str(outside)], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.addCleanup(lambda: os.rmdir(junction) if junction.exists() else None)
        else:
            junction.symlink_to(outside, target_is_directory=True)
        with self.assertRaises(update.UpdateError):
            update.plain_path(self.root, junction / "file")
        self.assertEqual(list(outside.iterdir()), [])

    def test_success_commit_preserves_data_and_foreign_files(self):
        transaction = self.transaction()
        transaction.swap()
        transaction.commit()
        for name, expected in self.new_bytes.items():
            self.assertEqual((self.root / name).read_bytes(), expected)
        self.assertFalse((self.root / "removed.bin").exists())
        self.assertEqual(update.read_manifest(self.root), self.new)
        self.assert_protected()
        self.assertFalse(update.pending_recovery(self.root))
        self.assertEqual((self.session / "backup" / update.EXE).read_bytes(), self.old_bytes[update.EXE])

    def test_mid_swap_failure_and_repeat_rollback(self):
        def fail(name):
            if name == "removed.bin":
                raise RuntimeError("controlled failure after removing old file")
        transaction = self.transaction(checkpoint=fail)
        with self.assertRaises(RuntimeError):
            transaction.swap()
        self.assertTrue(update.pending_recovery(self.root))
        recovered = runner.Transaction(self.root, self.session)
        recovered.load()
        recovered.rollback()
        recovered.rollback()
        self.assert_old()

    def test_interrupted_rollback_restart(self):
        transaction = self.transaction()
        transaction.swap()
        def fail(name):
            if name.startswith("rollback:"):
                raise RuntimeError("controlled interrupted rollback")
        transaction.checkpoint = fail
        with self.assertRaises(RuntimeError):
            transaction.rollback()
        recovered = runner.Transaction(self.root, self.session)
        recovered.load()
        recovered.rollback()
        self.assert_old()

    def test_backed_up_recovery_does_not_require_candidate_stage(self):
        transaction = self.transaction()
        (self.session / "stage" / update.MANIFEST).unlink()
        recovered = runner.Transaction(self.root, self.session)
        recovered.load()
        recovered.rollback()
        self.assert_old()
        self.assertFalse(update.pending_recovery(self.root))

    def test_corrupt_backup_and_foreign_change_block_rollback(self):
        transaction = self.transaction()
        transaction.swap()
        (self.session / "backup" / update.EXE).write_bytes(b"corrupt backup")
        with self.assertRaises(update.UpdateError):
            transaction.rollback()
        self.assertEqual((self.root / update.EXE).read_bytes(), self.new_bytes[update.EXE])
        self.assert_protected()

    def test_parent_timeout_cancel_and_probe_failure(self):
        path = self.request()
        launches, checks = [], []
        FakeParent.exit = False
        with self.assertRaises(update.UpdateError):
            runner.execute_request(path, parent_factory=FakeParent, checks=lambda *args: checks.append(args), launch=launches.append)
        self.assertEqual(checks, [])
        self.assertEqual(launches, [])
        self.assert_old()
        FakeParent.exit = True
        (self.session / "cancel.json").write_text("{}")
        with self.assertRaises(update.UpdateError):
            runner.execute_request(path, parent_factory=FakeParent, checks=lambda *args: checks.append(args), launch=launches.append)
        self.assert_old()
        (self.session / "cancel.json").unlink()
        def probe_fails(arguments, root, timeout):
            checks.append(arguments)
            if "--update-probe" in arguments:
                raise update.UpdateError("controlled probe failure")
        with self.assertRaises(update.UpdateError):
            runner.execute_request(path, parent_factory=FakeParent, checks=probe_fails, launch=launches.append)
        self.assertEqual(len(checks), 2)
        self.assertEqual(launches, [self.root])
        self.assert_old()
        self.assertTrue(FakeParent.closed)

    def test_manager_checksum_prepare_duplicate_install_cancel(self):
        release = release_asset("4.0.11", self.archive_bytes, digest=False)
        client = FakeClient([release], self.archive_bytes, self.checksum)
        armed = []
        manager = update.UpdateManager(self.root, self.root / "data", frozen=True, platform_name="win32", client=client, runner=lambda *args: armed.append(args))
        self.assertEqual(manager.check()["phase"], "available")
        self.assertEqual(manager.prepare()["phase"], "ready")
        self.assertEqual(manager.install()["phase"], "awaiting_exit")
        self.assertFalse(manager.install()["ok"])
        self.assertEqual(len(armed), 1)
        self.assertEqual(manager.cancel()["phase"], "available")
        self.assertTrue((manager.session / "cancel.json").exists())
        self.assert_old()

    def test_truncated_download_bad_checksum_and_source_disabled(self):
        for mode in ("truncated", "checksum"):
            client = FakeClient([release_asset("4.0.11", self.archive_bytes, digest=False)], self.archive_bytes[:-5] if mode == "truncated" else self.archive_bytes, b"wrong checksum" if mode == "checksum" else self.checksum)
            manager = update.UpdateManager(self.root, self.root / "data", frozen=True, platform_name="win32", client=client)
            manager.check()
            self.assertFalse(manager.prepare()["ok"])
            self.assertEqual(manager.get_status()["phase"], "error")
            self.assert_old()
        client = FakeClient([], b"")
        source = update.UpdateManager(self.root, self.root / "data", frozen=False, platform_name="win32", client=client)
        self.assertFalse(source.get_status()["supported"])
        self.assertFalse(source.prepare()["ok"])
        self.assertEqual(client.calls, [])

    def test_network_error_preserved_and_retry_after_no_retry(self):
        class RateClient:
            calls = 0
            def releases(self, cancel):
                self.calls += 1
                raise update.UpdateError("rate limited", retry_after=90)
        client = RateClient()
        manager = update.UpdateManager(self.root, self.root / "data", frozen=True, platform_name="win32", client=client)
        self.assertFalse(manager.check()["ok"])
        self.assertEqual(manager.get_status()["retryAfterSeconds"], 90)
        self.assertFalse(manager.check()["ok"])
        self.assertEqual(client.calls, 1)

    def test_short_alias_manifest_rejected_without_target_changes(self):
        manifest = copy.deepcopy(self.new)
        manifest["files"]["LOGIPR~1/new.dll"] = {"size": 1, "sha256": hashlib.sha256(b"x").hexdigest()}
        with self.assertRaises(update.UpdateError):
            update.validate_manifest(manifest)
        self.assert_old()

    def test_cancel_at_helper_ready_never_arms_parent_exit(self):
        client = FakeClient([release_asset("4.0.11", self.archive_bytes)], self.archive_bytes)
        manager = update.UpdateManager(self.root, self.root / "data", frozen=True, platform_name="win32", client=client)
        manager.check()
        self.assertEqual(manager.prepare()["phase"], "ready")
        manager.runner = lambda session, request: manager.cancel()
        result = manager.install()
        self.assertFalse(result["ok"])
        self.assertNotEqual(result["phase"], "awaiting_exit")
        self.assertTrue((manager.session / "cancel.json").exists())
        self.assert_old()

    def test_probe_bridge_nonce_version_read_only(self):
        import run_zeter_os as launcher
        api = launcher.ProbeApi("nonce", "4.0.11")
        self.assertFalse(api.confirm_update_probe("wrong", "4.0.11")["ok"])
        self.assertFalse(api.confirm_update_probe("nonce", "4.0.10")["ok"])
        self.assertFalse(api._acknowledged.is_set())
        self.assertTrue(api.confirm_update_probe("nonce", "4.0.11")["ok"])
        self.assertTrue(api._acknowledged.is_set())
        with patch.object(launcher, "NativeStorageApi", side_effect=AssertionError("normal storage cannot be instantiated")), patch.object(launcher, "ensure_dirs", side_effect=AssertionError("probe cannot create normal data")), patch.object(sys, "argv", ["exe", "--update-probe", "invalid", "4.0.11", str(self.session)]):
            self.assertEqual(launcher.main(), 1)
        self.assert_old()

    def test_positive_probe_branch_never_constructs_storage(self):
        import run_zeter_os as launcher
        request_path = self.request()
        value = json.loads(request_path.read_text())
        transaction = self.transaction()
        transaction.swap()
        windows = []
        class Window:
            destroyed = False
            def destroy(self):
                self.destroyed = True
        def create_window(title, url, **kwargs):
            window = Window()
            windows.append((window, url, kwargs["js_api"]))
            return window
        def start(**kwargs):
            self.assertTrue(kwargs["private_mode"])
            self.assertEqual(Path(kwargs["storage_path"]), self.session / "probe-webview")
            api = windows[0][2]
            self.assertIsInstance(api, launcher.ProbeApi)
            self.assertTrue(api.confirm_update_probe(value["nonce"], "4.0.11")["ok"])
        fake_webview = types.SimpleNamespace(create_window=create_window, start=start)
        with patch.object(launcher, "BASE_DIR", self.root), patch.object(launcher, "APP_DIR", self.root / "app"), patch.object(launcher, "NativeStorageApi", side_effect=AssertionError("normal storage cannot be instantiated")), patch.object(launcher, "DailyProblemLogs", side_effect=AssertionError("normal diagnostics cannot start")), patch.object(launcher, "ensure_dirs", side_effect=AssertionError("normal state cannot be created")), patch.object(sys, "frozen", True, create=True), patch.dict(sys.modules, {"webview": fake_webview}):
            self.assertEqual(launcher.run_update_probe(value["nonce"], "4.0.11", self.session), 0)
        self.assertIn("update-probe.html?nonce=" + value["nonce"], windows[0][1])
        transaction.rollback()
        self.assert_old()

    def test_bridge_active_operation_and_awaiting_exit_guard(self):
        import run_zeter_os as launcher
        class Manager:
            phase = "ready"
            installed = 0
            def get_status(self):
                return {"ok": True, "phase": self.phase}
            def install(self):
                self.installed += 1
                self.phase = "awaiting_exit"
                return self.get_status()
        # Avoid ctor entirely: this test isolates the native gate, not storage behavior.
        api = launcher.NativeStorageApi.__new__(launcher.NativeStorageApi)
        api._app_updater = Manager()
        api._native_operation_gate = threading.RLock()
        api._active_native_operations = 1
        api._closing = False
        api._file_upload_lock = threading.RLock()
        api._file_uploads = {}
        self.assertFalse(api.install_app_update()["ok"])
        api._active_native_operations = 0
        api._file_uploads["active"] = {}
        self.assertFalse(api.install_app_update()["ok"])
        api._file_uploads.clear()
        self.assertEqual(api.install_app_update()["phase"], "awaiting_exit")
        self.assertEqual(api._app_updater.installed, 1)
        self.assertFalse(api.save_state({"state": {}})["ok"])
        self.assert_old()

    def test_real_child_check_and_timeout(self):
        marker = self.session / "child-marker.txt"
        runner.run_checked([sys.executable, "-c", "from pathlib import Path; import sys; Path(sys.argv[1]).write_text('child verified')", str(marker)], self.session, 10)
        self.assertEqual(marker.read_text(), "child verified")
        with self.assertRaises(update.UpdateError):
            runner.run_checked([sys.executable, "-c", "import time; time.sleep(30)"], self.session, 1)
        self.assert_old()

    def test_close_failure_allows_cancel_prepare_install_retry(self):
        import run_zeter_os as launcher
        client = FakeClient([release_asset("4.0.11", self.archive_bytes)], self.archive_bytes)
        armed = []
        manager = update.UpdateManager(self.root, self.root / "data", frozen=True, platform_name="win32", client=client, runner=lambda *args: armed.append(args))
        manager.check()
        self.assertEqual(manager.prepare()["phase"], "ready")
        api = launcher.NativeStorageApi.__new__(launcher.NativeStorageApi)
        api._problem_logs = None
        api._app_updater = manager
        api._native_operation_gate = threading.RLock()
        api._active_native_operations = 0
        api._closing = False
        api._file_upload_lock = threading.RLock()
        api._file_uploads = {}
        def refused_destroy():
            raise RuntimeError("controlled window close refusal")
        api._window = types.SimpleNamespace(destroy=refused_destroy)
        self.assertEqual(api.install_app_update()["phase"], "awaiting_exit")
        with patch.object(launcher, "log"):
            self.assertFalse(api.close_app()["ok"])
        self.assertFalse(api._closing)
        self.assertNotEqual(api.cancel_app_update()["phase"], "awaiting_exit")
        self.assertEqual(api.prepare_app_update()["phase"], "ready")
        self.assertEqual(api.install_app_update()["phase"], "awaiting_exit")
        self.assertEqual(len(armed), 2)
        self.assert_old()

    def test_successful_close_keeps_closing_and_rejects_install(self):
        import run_zeter_os as launcher
        manager = update.UpdateManager(self.root, self.root / "data", frozen=False, platform_name="win32")
        api = launcher.NativeStorageApi.__new__(launcher.NativeStorageApi)
        api._problem_logs = None
        api._app_updater = manager
        api._native_operation_gate = threading.RLock()
        api._active_native_operations = 0
        api._closing = False
        closed = []
        api._window = types.SimpleNamespace(destroy=lambda: closed.append(True))
        with patch.object(launcher, "log"):
            self.assertTrue(api.close_app()["ok"])
        self.assertEqual(closed, [True])
        self.assertTrue(api._closing)
        self.assertFalse(api.install_app_update()["ok"])
        self.assert_old()


if __name__ == "__main__":
    unittest.main(verbosity=2)
