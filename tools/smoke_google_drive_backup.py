"""Synthetic Drive HTTP and encrypted-store boundary; no GUI/live network/account."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run_zeter_os as zeter
import google_drive_backup as drive
import google_drive_sync as sync
from smoke_managed_file_native import configure_temp_data, RecordingPlatformOpener


def checked(result):
    assert result.get("ok") is True, result
    return result


def protector(raw, decrypt=False):
    # Reversible fixture only. Production DPAPI is never invoked by this test.
    if decrypt:
        assert raw.startswith(b"fixture-protected:")
        return base64.b64decode(raw.split(b":", 1)[1])
    return b"fixture-protected:" + base64.b64encode(raw)


class FakeGoogle:
    def __init__(self):
        self.files, self.content, self.sessions = {}, {}, {}
        self.created, self.reads, self.refreshes = 0, 0, 0
        self.ambiguous, self.hide_listing, self.bad_md5, self.bad_bytes = False, False, False, False
        self.reject_refresh = False
        self.forms = []

    def token_http(self, method, url, headers, body, limit):
        assert method == "POST" and url == drive.NATIVE_TOKEN
        assert "Origin" not in headers and "Authorization" not in headers
        assert headers["Content-Type"] == "application/json"
        form = json.loads(body)
        assert "client_id" not in form and "client_secret" not in form
        self.forms.append({key: [value] for key, value in form.items()})
        if self.reject_refresh:
            return 401, {}, b'{"error":"reconnect_required"}'
        self.refreshes += 1
        result = {"access_token": "fixture-access", "expires_in": 3600, "token_type": "Bearer", "scope": drive.SCOPE}
        if form["grant_type"] == "authorization_code":
            result["refresh_token"] = "fixture-refresh"
        return 200, {}, json.dumps(result).encode()

    def __call__(self, method, url, headers, body, limit):
        parsed = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qs(parsed.query)
        response_headers = {}
        assert url != drive.TOKEN, "Desktop must not exchange tokens without the approved broker"
        if parsed.path.endswith("/generateIds"):
            result = {"ids": ["backup" + str(len(self.sessions) + 1)]}
        elif method == "GET" and parsed.path == "/drive/v3/files":
            q = query["q"][0]
            if "mimeType=" in q:
                result = {"files": [item for item in self.files.values() if item["mimeType"] == "application/vnd.google-apps.folder"]}
            else:
                values = [item for item in self.files.values() if item["mimeType"] == "application/zip"]
                if "operationId" in q:
                    values = [item for item in values if item["appProperties"].get("operationId", "") in q]
                result = {"files": [] if self.hide_listing else values}
        elif method == "POST" and parsed.path == "/drive/v3/files":
            item = json.loads(body)
            item["id"] = "folder1"
            self.files["folder1"] = item
            result = item
        elif method == "POST" and parsed.path == "/upload/drive/v3/files":
            item = json.loads(body)
            if item["id"] in self.files:
                raise drive.HttpFailure(409)
            self.sessions[item["id"]] = item
            response_headers["Location"] = drive.UPLOAD + "?upload_id=" + item["id"]
            result = {}
        elif method == "PUT":
            identifier = query["upload_id"][0]
            item = dict(self.sessions[identifier])
            item.update(size=str(len(body)), createdTime="2026-10-26T10:00:00Z",
                        md5Checksum="bad" if self.bad_md5 else hashlib.md5(body, usedforsecurity=False).hexdigest())
            self.files[identifier], self.content[identifier] = item, body
            self.created += 1
            if self.ambiguous:
                self.ambiguous = False
                raise drive.DriveError("Нет соединения с Google Drive. Повторите действие.")
            result = {"id": identifier}
        elif method == "GET" and parsed.path.startswith("/drive/v3/files/"):
            identifier = parsed.path.rsplit("/", 1)[-1]
            if identifier not in self.files:
                raise drive.HttpFailure(404)
            if query.get("alt") == ["media"]:
                self.reads += 1
                raw = b"corrupt" if self.bad_bytes else self.content[identifier]
                assert len(raw) <= limit + 1
                return 200, {}, raw
            result = {"trashed": False, **self.files[identifier]}
        else:
            raise AssertionError((method, parsed.path))
        raw = json.dumps(result).encode()
        assert len(raw) <= limit
        return 200, response_headers, raw


class FakeSyncGoogle(FakeGoogle):
    def __init__(self):
        super().__init__()
        self.allocated, self.patches = 0, 0
        self.lose_folder_reply = False
        self.metadata_failure = None
        self.mutations = 0
        self.detect_payload_mime = None

    def __call__(self, method, url, headers, body, limit):
        parsed = urllib.parse.urlsplit(url)
        query = urllib.parse.parse_qs(parsed.query)
        if method == "GET" and parsed.path.startswith("/drive/v3/files/") and self.detect_payload_mime:
            item = self.files.get(parsed.path.rsplit("/", 1)[-1])
            if item and item.get("appProperties", {}).get("kind") == "payload":
                item["mimeType"] = self.detect_payload_mime
        if method in {"POST", "PATCH", "PUT", "DELETE"}:
            self.mutations += 1
        if method == "GET" and parsed.path.startswith("/drive/v3/files/") and self.metadata_failure:
            if self.metadata_failure == "network":
                raise drive.DriveError("Synthetic network failure")
            raise drive.HttpFailure(self.metadata_failure)
        if parsed.path == "/drive/v3/about":
            return 200, {}, json.dumps({"user": {"permissionId": "account_permission_1"}}).encode()
        if parsed.path.endswith("/generateIds"):
            self.allocated += 1
            return 200, {}, json.dumps({"ids": ["generic_" + str(self.allocated)]}).encode()
        if parsed.path == "/drive/v3/files" and method == "POST":
            item = json.loads(body)
            item.setdefault("id", "folder_" + str(len(self.files)))
            item.setdefault("parents", ["mydrive"])
            item["createdTime"] = "2026-10-26T10:00:00Z"
            if item["id"] in self.files:
                raise drive.HttpFailure(409)
            self.files[item["id"]] = item
            if self.lose_folder_reply:
                self.lose_folder_reply = False
                raise drive.DriveError("Synthetic lost folder response")
            return 200, {}, json.dumps(item).encode()
        if parsed.path == "/drive/v3/files" and method == "GET":
            q = query["q"][0]
            values = [item for item in self.files.values() if item.get("appProperties", {}).get("format") == "sync-v1"]
            if " in parents" in q:
                parent = q.split("' in parents")[0].rsplit("'", 1)[-1]
                if parent == "root":
                    parent = "mydrive"
                values = [item for item in values if parent in item.get("parents", [])]
            for field in ("kind", "operationId"):
                marker = "key='" + field + "' and value='"
                if marker in q:
                    expected = q.split(marker)[1].split("'")[0]
                    values = [item for item in values if item["appProperties"].get(field) == expected]
            return 200, {}, json.dumps({"files": [] if self.hide_listing else values}).encode()
        if parsed.path.startswith("/drive/v3/files/") and method == "PATCH":
            identifier = parsed.path.rsplit("/", 1)[-1]
            item = self.files[identifier]
            assert set(json.loads(body)) == {"name"}, "Move attempted to change more than name/parents"
            item.update(json.loads(body))
            if "addParents" in query:
                item["parents"] = query["addParents"]
            self.patches += 1
            return 200, {}, json.dumps(item).encode()
        return super().__call__(method, url, headers, body, limit)


class FakeBroker:
    def __init__(self):
        self.sessions, self.commits, self.generation = 0, 0, 0
        self.head = None
        self.reject_session_once = False
        self.wrong_account = False
        self.bootstrap = None
        self.directories = {}
        self.replacements = {}
        self.lose_recreate_reply = False

    def __call__(self, method, url, headers, body, limit):
        assert "Origin" not in headers, "Native broker calls must not spoof a browser Origin"
        assert url.startswith("https://sync.example.test/")
        endpoint = urllib.parse.urlsplit(url).path
        if endpoint == "/native/session":
            assert method == "POST" and "Authorization" not in headers
            assert json.loads(body) == {"accessToken": "fixture-access"}
            self.sessions += 1
            result = {"sessionHandle": "fixture_session_handle_" + str(self.sessions),
                      "accountKey": "account_key_fixture", "expiresAt": int(time.time() * 1000) + 3600000}
        else:
            assert headers["Authorization"].startswith("Bearer fixture_session_handle_")
            if self.reject_session_once:
                self.reject_session_once = False
                return 401, {}, b'{"error":"session-expired"}'
            if endpoint == "/sync/directory":
                value = json.loads(body)
                if not self.head or value["expectedGeneration"] != self.generation or value["rootFolderId"] != self.head["rootFolderId"]:
                    return 409, {}, json.dumps({"error": "sync-conflict", "head": self.head, "generation": self.generation}).encode()
                key = (value["rootFolderId"], value["pathKey"])
                if key not in self.directories and value["id"] is not None:
                    self.directories[key] = value
                saved = self.directories.get(key)
                if saved and (saved["name"] != value["name"] or saved["parentId"] != value["parentId"]):
                    return 409, {}, b'{"error":"directory-conflict"}'
                return 200, {}, json.dumps({"accountKey": "account_key_fixture", "id": saved["id"] if saved else None}).encode()
            if endpoint == "/sync/recreate":
                value = json.loads(body)
                assert set(value) == {"expectedGeneration", "oldRootFolderId", "bootstrap"}
                key = (value["expectedGeneration"], value["oldRootFolderId"])
                canonical = self.head["rootFolderId"] if self.head else self.bootstrap["rootFolderId"] if self.bootstrap else None
                if value["expectedGeneration"] != self.generation or (key not in self.replacements and canonical != value["oldRootFolderId"]):
                    return 409, {}, json.dumps({"error": "sync-conflict", "accountKey": "account_key_fixture", "head": self.head, "generation": self.generation}).encode()
                if key not in self.replacements:
                    self.replacements[key] = value["bootstrap"]
                self.bootstrap = self.replacements[key]
                if self.lose_recreate_reply:
                    self.lose_recreate_reply = False
                    raise drive.DriveError("Synthetic lost recreation reply")
            elif endpoint == "/sync/bootstrap":
                value = json.loads(body)
                assert set(value) == {"expectedGeneration", "bootstrap"}
                if value["expectedGeneration"] != self.generation:
                    return 409, {}, json.dumps({"error": "sync-conflict", "head": self.head, "generation": self.generation}).encode()
                if self.bootstrap is None and value["bootstrap"] is not None:
                    self.bootstrap = value["bootstrap"]
            elif endpoint == "/sync/commit":
                assert method == "POST" and len(body) < 4096
                value = json.loads(body)
                if self.head and value["operationId"] == self.head["operationId"]:
                    pass
                elif value["expectedGeneration"] != self.generation:
                    return 409, {}, json.dumps({"error": "sync-conflict", "head": self.head, "generation": self.generation}).encode()
                else:
                    self.commits += 1
                    self.generation += 1
                    self.head = {"generation": self.generation, "rootFolderId": value["rootFolderId"],
                                 **value["candidate"], "operationId": value["operationId"],
                                 "parentGeneration": value["expectedGeneration"], "committedAt": int(time.time() * 1000)}
            else:
                assert endpoint == "/sync/head" and method == "GET" and body is None
            result = {"accountKey": "wrong_account" if self.wrong_account else "account_key_fixture",
                      "head": self.head, "generation": self.generation}
            if endpoint in {"/sync/bootstrap", "/sync/recreate"}:
                result["bootstrap"] = self.bootstrap
        raw = json.dumps(result).encode()
        assert len(raw) <= limit
        return 200, {}, raw


def smoke_deleted_root(api, root, client):
    google, broker = FakeSyncGoogle(), FakeBroker()
    credentials = root / "deleted-root-private"
    credentials.mkdir()
    cloud = drive.GoogleDriveBackup(api, zeter, http=google, protector=protector, credentials_root=credentials)
    cloud._save({"clientId": client, "accessToken": "fixture-access", "refreshToken": "fixture-refresh", "expiresAt": time.time() + 3600, "needsReconnect": False})
    api._google_drive = cloud
    factory = lambda current: sync.GoogleDriveSync(current, broker_http=broker)
    old = {"id": "deleted_root", "name": "ZeTer OS", "mimeType": sync.FOLDER_MIME, "parents": ["mydrive"], "createdTime": "2026-10-20T10:00:00Z", "appProperties": {**sync.NAMESPACE, "kind": "root"}, "trashed": True}
    broker.generation = 3
    broker.head = {"generation": 3, "rootFolderId": old["id"], "snapshotId": "4" * 32, "manifestFileId": "old_manifest", "manifestSha256": "5" * 64, "contentHash": "6" * 64, "operationId": "7" * 32, "parentGeneration": 2, "committedAt": 1793000000000}
    payload = {"expectedGeneration": 3, "oldRootFolderId": old["id"]}
    with patch.object(zeter, "GoogleDriveSync", factory):
        google.files[old["id"]] = dict(old)
        assert checked(api.google_drive_sync_head())["missingRootFolderId"] == old["id"]
        del google.files[old["id"]]
        assert checked(api.google_drive_sync_head())["missingRootFolderId"] == old["id"]
        for failure in (401, 403, 500, "network"):
            google.metadata_failure = failure
            assert api.google_drive_recreate_root(payload)["ok"] is False
            assert google.allocated == 0 and not broker.replacements
        google.metadata_failure = None
        for delta in ({"appProperties": {"app": "foreign", "format": "sync-v1", "kind": "root"}}, {"appProperties": {**sync.NAMESPACE, "kind": "data"}}, {"mimeType": "text/plain"}, {"trashed": "true"}):
            google.files[old["id"]] = {**old, **delta}
            assert api.google_drive_sync_head()["ok"] is False
        google.files[old["id"]] = {**old, "trashed": False}
        assert "missingRootFolderId" not in checked(api.google_drive_sync_head())
        assert checked(api.google_drive_recreate_root(payload))["conflict"] is True
        assert google.allocated == 0
        google.files[old["id"]] = dict(old)
        broker.lose_recreate_reply = True
        assert api.google_drive_recreate_root(payload)["ok"] is False
        winner = dict(broker.bootstrap)
        for kind in ("root", "data", "history", "staging"):
            identifier = winner[kind + "FolderId"]
            google.files[identifier] = {**old, "id": identifier, "name": sync.CANONICAL_FOLDER_NAMES[kind], "parents": ["mydrive"] if kind == "root" else [winner["rootFolderId"]], "trashed": False, "appProperties": {**sync.NAMESPACE, "kind": kind}}
        google.hide_listing = True
        for _ in range(2):
            result = checked(api.google_drive_recreate_root(payload))
            assert result["bootstrap"] == winner and result["head"] == broker.head and result["generation"] == 3
        assert len(broker.replacements) == 1 and google.mutations == 0
        assert checked(api.google_drive_sync_head())["missingRootFolderId"] == old["id"], "Pending replacement does not hide deleted accepted head"
        assert checked(api.google_drive_bootstrap({"expectedGeneration": 3}))["bootstrap"] == winner
        google.files[winner["historyFolderId"]]["trashed"] = True
        assert api.google_drive_recreate_root(payload)["ok"] is False, "Trashed replacement must fail closed"
        google.files[winner["historyFolderId"]]["trashed"] = False
        before = google.allocated
        assert checked(api.google_drive_recreate_root({**payload, "expectedGeneration": 2}))["conflict"] is True
        assert google.allocated == before
        broker.wrong_account = True
        assert api.google_drive_recreate_root(payload)["ok"] is False
        broker.wrong_account = False
        broker.head, broker.generation, broker.bootstrap = None, 0, None
        assert "missingRootFolderId" not in checked(api.google_drive_sync_head())
        assert google.allocated == before, "Null head read must not allocate IDs"
        broker.bootstrap = winner
        assert "missingRootFolderId" not in checked(api.google_drive_sync_head())
        google.files[winner["rootFolderId"]]["trashed"] = True
        assert checked(api.google_drive_sync_head())["missingRootFolderId"] == winner["rootFolderId"]
        del google.files[winner["rootFolderId"]]
        assert "missingRootFolderId" not in checked(api.google_drive_sync_head()), "Unmaterialized reservation 404 does not prove deletion"
        assert google.allocated == before
        assert google.mutations == 0
        # Real null-head failure sequence: old reserved root was materialized and
        # trashed; replacement reservation advances before its response is lost.
        broker.bootstrap = {"rootFolderId": old["id"], "dataFolderId": "old_data", "historyFolderId": "old_history", "stagingFolderId": "old_staging"}
        broker.replacements.clear()
        google.files[old["id"]] = dict(old)
        broker.lose_recreate_reply = True
        initial = {"expectedGeneration": 0, "oldRootFolderId": old["id"]}
        assert api.google_drive_recreate_root(initial)["ok"] is False
        reserved = dict(broker.bootstrap)
        allocated = google.allocated
        assert reserved["rootFolderId"] != old["id"] and reserved["rootFolderId"] not in google.files
        assert "missingRootFolderId" not in checked(api.google_drive_sync_head())
        assert checked(api.google_drive_recreate_root(initial))["conflict"] is True
        assert checked(api.google_drive_bootstrap({"expectedGeneration": 0}))["bootstrap"] == reserved
        assert google.allocated == allocated and len(broker.replacements) == 1 and google.mutations == 0
        materialized = checked(api.google_drive_make_folder({"id": reserved["rootFolderId"], "name": "ZeTer OS", "kind": "root", "operationId": "a" * 32}))["entry"]
        assert materialized["id"] == reserved["rootFolderId"] and google.allocated == allocated
        assert "missingRootFolderId" not in checked(api.google_drive_sync_head())


def smoke_bootstrap_fixed_ids(api, root, client):
    google, broker = FakeSyncGoogle(), FakeBroker()
    credentials = root / "bootstrap-private"
    credentials.mkdir()
    cloud = drive.GoogleDriveBackup(api, zeter, http=google, protector=protector, credentials_root=credentials)
    cloud._save({"clientId": client, "accessToken": "fixture-access", "refreshToken": "fixture-refresh", "expiresAt": time.time() + 3600, "needsReconnect": False})
    api._google_drive = cloud
    factory = lambda current: sync.GoogleDriveSync(current, broker_http=broker)
    with patch.object(zeter, "GoogleDriveSync", factory):
        # Existing roots survive untouched; deterministic oldest owned root wins.
        oldest = {"id": "oldest_root", "name": "ZeTer OS", "mimeType": sync.FOLDER_MIME, "parents": ["mydrive"], "createdTime": "2026-10-20T10:00:00Z", "appProperties": {**sync.NAMESPACE, "kind": "root", "operationId": "f" * 32}}
        google.files[oldest["id"]] = oldest.copy()
        google.files["newer_root"] = {**oldest, "id": "newer_root", "createdTime": "2026-10-26T10:00:00Z"}
        google.files["nested_root"] = {**oldest, "id": "nested_root", "parents": ["foreign_parent"], "createdTime": "2026-10-01T10:00:00Z"}
        for kind in ("data", "history", "staging"):
            for suffix in ("a", "b"):
                identifier = "duplicate_" + suffix
                item_name = {"data": "data", "history": ".zeter-sync-history", "staging": ".zeter-sync-staging"}[kind]
                google.files[identifier] = {**oldest, "id": identifier, "name": item_name, "parents": [oldest["id"]], "appProperties": {**sync.NAMESPACE, "kind": kind}}
            previous = json.dumps(google.files, sort_keys=True)
            assert api.google_drive_bootstrap({"expectedGeneration": 0})["ok"] is False, "Ambiguous bootstrap children must fail closed"
            assert broker.bootstrap is None, "Ambiguous child must not publish a reservation"
            assert json.dumps(google.files, sort_keys=True) == previous, "Ambiguous discovery must not change Drive"
            del google.files["duplicate_a"], google.files["duplicate_b"]
        before = json.dumps(google.files, sort_keys=True)
        structure = checked(api.google_drive_bootstrap({"expectedGeneration": 0}))["bootstrap"]
        assert structure["rootFolderId"] == "oldest_root"
        assert json.dumps(google.files, sort_keys=True) == before, "Reservation must not mutate Drive"
        allocated = google.allocated
        google.hide_listing = True
        assert checked(api.google_drive_bootstrap({"expectedGeneration": 0}))["bootstrap"] == structure
        assert google.allocated == allocated, "Retry checks reservation before generating IDs/listing"
        checked(api.google_drive_make_folder({"id": structure["rootFolderId"], "name": "ZeTer OS", "kind": "root", "operationId": "1" * 32}))
        for kind in ("data", "history", "staging"):
            payload = {"id": structure[kind + "FolderId"], "parentId": structure["rootFolderId"], "name": {"data": "data", "history": ".zeter-sync-history", "staging": ".zeter-sync-staging"}[kind], "kind": kind, "operationId": "2" * 32}
            google.lose_folder_reply = True
            assert api.google_drive_make_folder(payload)["ok"] is False
            # New provider instance/restart, missing list, changed snapshot operation.
            restored = checked(api.google_drive_make_folder({**payload, "operationId": "3" * 32}))["entry"]
            assert restored["id"] == payload["id"]
            assert len([entry for entry in google.files.values() if entry.get("parents") == [structure["rootFolderId"]] and entry["name"] == payload["name"]]) == 1
            assert api.google_drive_make_folder({**payload, "name": "wrong"})["ok"] is False
        assert checked(api.google_drive_bootstrap({"expectedGeneration": 0}))["bootstrap"] == structure
        broker.bootstrap = None
        google.hide_listing = False
        assert checked(api.google_drive_bootstrap({"expectedGeneration": 0}))["bootstrap"] == structure, "Discovery must reuse actual engine folder names after intent changes"
        assert google.allocated == allocated
        count = len(google.files)
        for invalid in ({"expectedGeneration": True}, {"expectedGeneration": 0, "accountKey": "forbidden"}):
            assert api.google_drive_bootstrap(invalid)["ok"] is False
        broker.generation = 1
        broker.head = {"generation": 1, "rootFolderId": structure["rootFolderId"], "snapshotId": "4" * 32, "manifestFileId": "manifest_fixture", "manifestSha256": "5" * 64, "contentHash": "6" * 64, "operationId": "7" * 32, "parentGeneration": 0, "committedAt": int(time.time() * 1000)}
        assert checked(api.google_drive_bootstrap({"expectedGeneration": 0}))["conflict"] is True
        assert len(google.files) == count
        assert checked(api.google_drive_allocate_id())["id"]
        directory = {"expectedGeneration": 1, "rootFolderId": structure["rootFolderId"], "parentId": structure["dataFolderId"], "name": "Папка", "pathKey": "8" * 64, "operationId": "9" * 32}
        identifier = checked(api.google_drive_directory_id(directory))["id"]
        payload = {"id": identifier, "parentId": directory["parentId"], "name": directory["name"], "pathKey": directory["pathKey"], "kind": "directory", "operationId": directory["operationId"]}
        google.lose_folder_reply = True
        assert api.google_drive_make_folder(payload)["ok"] is False
        assert checked(api.google_drive_directory_id(directory))["id"] == identifier
        checked(api.google_drive_make_folder({**payload, "operationId": "a" * 32}))
        assert len(google.files) == count + 1
        broker.directories.clear()
        google.hide_listing = False
        allocated = google.allocated
        assert checked(api.google_drive_directory_id(directory))["id"] == identifier
        assert google.allocated == allocated, "Verified existing directory is reserved without a new ID"
        assert checked(api.google_drive_directory_id({**directory, "expectedGeneration": 0}))["conflict"] is True
        assert api.google_drive_directory_id({**directory, "parentId": "newer_root"})["ok"] is False
        assert api.google_drive_directory_id({**directory, "name": "changed"})["ok"] is False
        raw = b"fixed file after lost reply"
        file_payload = {"id": checked(api.google_drive_allocate_id())["id"], "parentId": structure["stagingFolderId"], "name": "state.json", "mimeType": "application/json", "kind": "state", "operationId": "b" * 32, "pathKey": "c" * 64, "base64": base64.b64encode(raw).decode()}
        created = google.created
        google.ambiguous = True
        assert api.google_drive_put_file(file_payload)["ok"] is False
        google.hide_listing = True
        checked(api.google_drive_put_file(file_payload))
        assert google.created == created + 1
        for delta in ({"name": "wrong"}, {"parentId": structure["dataFolderId"]}, {"pathKey": "d" * 64}, {"base64": base64.b64encode(b"changed").decode()}):
            assert api.google_drive_put_file({**file_payload, **delta})["ok"] is False
        # Drive may refine an opaque payload MIME without changing its bytes.
        binary = {**file_payload, "id": checked(api.google_drive_allocate_id())["id"], "name": "image.png", "mimeType": "application/octet-stream", "kind": "payload", "operationId": "c" * 32}
        checked(api.google_drive_put_file(binary))
        created = google.created
        for detected in ("image/png", "image/jpeg", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"):
            google.files[binary["id"]]["mimeType"] = detected
            assert checked(api.google_drive_put_file(binary))["entry"]["id"] == binary["id"], "Detected binary MIME must preserve the same verified payload"
        assert google.created == created, "Detected MIME retry must not upload new bytes"
        for rejected in (sync.FOLDER_MIME, "application/vnd.google-apps.document", "invalid"):
            google.files[binary["id"]]["mimeType"] = rejected
            assert api.google_drive_put_file(binary)["ok"] is False
        google.files[binary["id"]]["mimeType"] = "image/png"
        for delta in ({"name": "wrong"}, {"parentId": structure["dataFolderId"]}, {"pathKey": "d" * 64}, {"operationId": "d" * 32}, {"base64": base64.b64encode(b"changed").decode()}):
            assert api.google_drive_put_file({**binary, **delta})["ok"] is False
        google.files[file_payload["id"]]["mimeType"] = "text/plain"
        assert api.google_drive_put_file(file_payload)["ok"] is False, "State MIME remains exact"
        fresh = {**binary, "id": checked(api.google_drive_allocate_id())["id"], "operationId": "e" * 32}
        google.detect_payload_mime = "image/png"
        result = checked(api.google_drive_put_file(fresh))
        assert result["entry"]["mimeType"] == "image/png", "Initial upload accepts detected MIME after verified readback"
        google.detect_payload_mime = None


def smoke_generic(api, root, client, public):
    google, broker = FakeSyncGoogle(), FakeBroker()
    credentials = root / "sync-private"
    cloud = drive.GoogleDriveBackup(api, zeter, http=google, protector=protector, credentials_root=credentials)
    credentials.mkdir()
    cloud._save({"clientId": client, "accessToken": "fixture-access", "refreshToken": "fixture-refresh",
                 "expiresAt": time.time() + 3600, "needsReconnect": False})
    api._google_drive = cloud
    factory = lambda current: sync.GoogleDriveSync(current, broker_http=broker)
    (public / "google-drive-config.json").write_text(json.dumps({"desktopClientId": client, "brokerUrl": "https://sync.example.test"}), encoding="utf-8")
    with patch.object(zeter, "GoogleDriveSync", factory):
        root_entry = checked(api.google_drive_make_folder({"name": "ZeTer OS", "kind": "root"}))["entry"]
        root_id = root_entry["id"]
        again = checked(api.google_drive_make_folder({"name": "ZeTer OS", "kind": "root"}))["entry"]
        assert again == root_entry
        data = checked(api.google_drive_make_folder({"parentId": root_id, "name": "data", "kind": "data", "operationId": "1" * 32}))["entry"]
        staging = checked(api.google_drive_make_folder({"parentId": root_id, "name": "staging", "kind": "staging"}))["entry"]
        checked(api.google_drive_make_folder({"parentId": root_id, "name": "data", "kind": "data", "operationId": "1" * 32}))
        raw = b'{"ordinary":"data bytes; not a ZIP"}'
        sha = hashlib.sha256(raw).hexdigest()
        payload = {"parentId": staging["id"], "name": "zeter-os-state.json", "base64": base64.b64encode(raw).decode(),
                   "mimeType": "application/json", "kind": "state", "pathKey": "a" * 64, "operationId": "2" * 32}
        uploaded = checked(api.google_drive_put_file(payload))["entry"]
        count = google.created
        assert uploaded["sha256"] == sha and uploaded["name"] == "zeter-os-state.json"
        checked(api.google_drive_put_file(payload))
        assert google.created == count
        assert api.google_drive_put_file({**payload, "base64": base64.b64encode(b"changed").decode()})["ok"] is False
        assert google.created == count and google.content[uploaded["id"]] == raw
        listed = checked(api.google_drive_files({"parentId": staging["id"], "kind": "state"}))["entries"]
        assert listed == [uploaded]
        read = checked(api.google_drive_read_file({"id": uploaded["id"], "sha256": sha, "sizeBytes": len(raw)}))
        assert base64.b64decode(read["base64"]) == raw
        reads = google.reads
        assert api.google_drive_read_file({"id": uploaded["id"], "sha256": "b" * 64, "sizeBytes": len(raw)})["ok"] is False
        assert google.reads == reads
        foreign = {**google.files[uploaded["id"]], "id": "foreign_sync", "appProperties": {"app": "foreign", "format": "sync-v1", "kind": "state", "sha256": sha}}
        google.files["foreign_sync"] = foreign
        assert api.google_drive_read_file({"id": "foreign_sync", "sha256": sha, "sizeBytes": len(raw)})["ok"] is False
        assert google.reads == reads
        assert api.google_drive_move_file({"id": "foreign_sync", "parentId": data["id"], "name": "bad"})["ok"] is False
        assert google.patches == 0
        moved = checked(api.google_drive_move_file({"id": uploaded["id"], "parentId": data["id"], "name": "state.json"}))["entry"]
        assert moved["parents"] == [data["id"]] and google.content[moved["id"]] == raw
        assert google.created == count and google.patches == 1
        google.bad_bytes = True
        assert api.google_drive_read_file({"id": moved["id"], "sha256": sha, "sizeBytes": len(raw)})["ok"] is False
        google.bad_bytes = False
        google.ambiguous = True
        ambiguous = {**payload, "operationId": "3" * 32}
        assert api.google_drive_put_file(ambiguous)["ok"] is False
        count = google.created
        google.hide_listing = True
        recovered = checked(api.google_drive_put_file(ambiguous))["entry"]
        assert google.created == count
        google.hide_listing = False
        manifest = checked(api.google_drive_put_file({**payload, "name": "manifest.json", "kind": "snapshot", "operationId": "4" * 32}))["entry"]
        # The canonical broker head carries the manifest ID/hash, not its size.
        manifest_read = checked(api.google_drive_read_file({"id": manifest["id"], "sha256": sha}))
        assert base64.b64decode(manifest_read["base64"]) == raw and manifest_read["sizeBytes"] == len(raw)
        reads = google.reads
        assert api.google_drive_read_file({"id": moved["id"], "sha256": sha})["ok"] is False
        assert google.reads == reads, "State without expected size fetched bytes"
        payload_file = checked(api.google_drive_put_file({**payload, "name": "document.bin", "kind": "payload", "operationId": "8" * 32}))["entry"]
        reads = google.reads
        assert api.google_drive_read_file({"id": payload_file["id"], "sha256": sha})["ok"] is False
        assert google.reads == reads, "Payload without expected size fetched bytes"
        metadata = google.files[manifest["id"]]
        original_size = metadata["size"]
        metadata["size"] = str(sync.MAX_BYTES + 1)
        assert api.google_drive_read_file({"id": manifest["id"], "sha256": sha})["ok"] is False
        assert google.reads == reads, "Oversized manifest metadata fetched bytes"
        metadata["size"] = original_size
        first_head = checked(api.google_drive_sync_head())
        assert first_head == {"ok": True, "accountKey": "account_key_fixture", "generation": 0, "head": None}
        commit = {"expectedGeneration": 0, "operationId": "5" * 32, "rootFolderId": root_id, "candidate": {
            "snapshotId": "6" * 32, "manifestFileId": manifest["id"], "manifestSha256": sha, "contentHash": "c" * 64}}
        head = checked(api.google_drive_sync_commit(commit))
        assert head["generation"] == 1 and broker.commits == 1
        checked(api.google_drive_sync_commit(commit))
        assert broker.commits == 1
        conflict = checked(api.google_drive_sync_commit({**commit, "operationId": "7" * 32}))
        assert conflict["conflict"] is True and conflict["generation"] == 1 and conflict["head"] == head["head"]
        # A different Google consent must never reuse the former account's broker handle.
        before_sessions = broker.sessions
        cloud._save({**cloud._auth(), "refreshToken": "a-different-account-consent"})
        checked(api.google_drive_sync_head())
        assert broker.sessions == before_sessions + 1
        before_sessions = broker.sessions
        broker.reject_session_once = True
        checked(api.google_drive_sync_head())
        assert broker.sessions == before_sessions + 1
        broker.wrong_account = True
        assert api.google_drive_sync_head()["ok"] is False
        broker.wrong_account = False
        assert "sessionHandle" not in json.dumps(checked(api.google_drive_sync_head()))
        checked(api.google_drive_disconnect())
        assert not (credentials / "broker-session.dpapi").exists()
        assert not (credentials / "auth.dpapi").exists()
        assert google.content[moved["id"]] == raw and google.content[recovered["id"]] == raw
        assert not list(zeter.DATA_DIR.rglob("*.dpapi"))


def smoke_native_preferences_and_preserve(api, root, client, built):
    credentials = root / "persistent-private"
    api._google_drive = drive.GoogleDriveBackup(api, zeter, http=FakeSyncGoogle(), protector=protector, credentials_root=credentials)
    metadata = {"enabled": True, "onboardingVersion": 1, "deviceId": "a" * 32, "baseGeneration": 4,
                "baseLocalHash": "b" * 64, "baseCloudHash": "c" * 64, "accountKey": "d" * 64,
                "pending": None, "conflict": None}
    assert checked(api.google_drive_sync_preferences())["value"] is None
    assert checked(api.google_drive_sync_preferences({"value": metadata}))["value"] == metadata
    installation = sync.GoogleDriveSync(api._google_drive)._installation_root()
    path = installation / "preferences.dpapi"
    before = path.read_bytes()
    assert before.startswith(b"fixture-protected:")
    # A new native API object simulates a full launcher restart/different HTTP port.
    other = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener(), google_drive_credentials_root=credentials)
    other._google_drive = drive.GoogleDriveBackup(other, zeter, http=FakeSyncGoogle(), protector=protector, credentials_root=credentials)
    assert checked(other.google_drive_sync_preferences())["value"] == metadata
    with patch.object(zeter, "replace_transiently_locked_file", side_effect=OSError("fixture replace refusal")):
        assert api.google_drive_sync_preferences({"value": {**metadata, "enabled": False}})["ok"] is False
    assert path.read_bytes() == before and checked(other.google_drive_sync_preferences())["value"] == metadata
    assert api.google_drive_sync_preferences({"value": {**metadata, "accessToken": "forbidden"}})["ok"] is False
    assert path.read_bytes() == before
    pending = {"operationId": "1" * 32, "expectedGeneration": 4, "rootFolderId": "root_fixture", "candidate": {
        "snapshotId": "2" * 32, "manifestFileId": "manifest_fixture", "manifestSha256": "3" * 64, "contentHash": "4" * 64}, "localHash": "5" * 64}
    checked(api.google_drive_sync_preferences({"value": {**metadata, "pending": pending}}))
    assert checked(other.google_drive_sync_preferences())["value"]["pending"] == pending
    intent = {"accountKey": metadata["accountKey"], "operationId": "6" * 32, "snapshotId": "7" * 32, "createdAt": 1793000000000, "expectedGeneration": 4, "localHash": "8" * 64, "bootstrap": {"rootFolderId": "root_intent", "dataFolderId": "data_intent", "historyFolderId": "history_intent", "stagingFolderId": "staging_intent"}, "fileIds": {"9" * 32: "reserved_file"}}
    with_intent = {**metadata, "pending": pending, "uploadIntent": intent}
    checked(api.google_drive_sync_preferences({"value": with_intent}))
    assert checked(other.google_drive_sync_preferences())["value"] == with_intent
    valid_bytes = path.read_bytes()
    for invalid in ({**intent, "accountKey": "e" * 64}, {**intent, "unknown": "forbidden"}, {**intent, "expectedGeneration": True}, {**intent, "createdAt": -1}, {**intent, "fileIds": {"invalid": "reserved_file"}}, {**intent, "fileIds": {"9" * 32: "same_file", "a" * 32: "same_file"}}, {**intent, "fileIds": {format(i, "032x"): "id_" + str(i) for i in range(10001)}}, {**intent, "bootstrap": {**intent["bootstrap"], "dataFolderId": "root_intent"}}):
        assert api.google_drive_sync_preferences({"value": {**with_intent, "uploadIntent": invalid}})["ok"] is False
        assert path.read_bytes() == valid_bytes, "Rejected intent must preserve durable upload IDs"
    raw = base64.b64decode(built["base64"])
    first = checked(api.google_drive_sync_preserve({"base64": built["base64"]}))["id"]
    second = checked(other.google_drive_sync_preserve({"base64": built["base64"], "name": "Страховочная копия.zip"}))["id"]
    assert first != second
    assert (installation / "conflicts" / (first + ".zip")).read_bytes() == raw
    assert (installation / "conflicts" / (second + ".zip")).read_bytes() == raw
    with patch.object(sync.secrets, "token_hex", return_value=first):
        assert api.google_drive_sync_preserve({"base64": built["base64"]})["ok"] is False
    assert (installation / "conflicts" / (first + ".zip")).read_bytes() == raw
    sentinel = root / "foreign-private-sentinel.bin"
    sentinel.write_bytes(b"foreign unchanged")
    original_plain = sync.plain_path
    def denied(candidate_root, candidate):
        if candidate == path or candidate == installation / "conflicts":
            return False
        return original_plain(candidate_root, candidate)
    protected_before = path.read_bytes()
    with patch.object(sync, "plain_path", denied):
        assert api.google_drive_sync_preferences({"value": metadata})["ok"] is False
        assert api.google_drive_sync_preserve({"base64": built["base64"]})["ok"] is False
    assert path.read_bytes() == protected_before and sentinel.read_bytes() == b"foreign unchanged"
    assert (installation / "conflicts" / (first + ".zip")).read_bytes() == raw
    # Effective DATA_DIR, rather than origin/port or cwd, scopes each installation.
    second_data = root / "a different installation" / "data"
    second_data.mkdir(parents=True)
    with patch.object(zeter, "DATA_DIR", second_data):
        assert checked(api.google_drive_sync_preferences())["value"] is None
    assert checked(other.google_drive_sync_preferences())["value"]["pending"] == pending


def smoke_broker_transport_identity():
    """Real Request construction, fake opener: no network, files or native API."""
    class Response(io.BytesIO):
        status = 200

    class Opener:
        def open(self, request, timeout):
            assert request.get_header("User-agent") == "ZeTerOS-Native/1.0"
            assert request.get_header("Authorization") == "Bearer fixture-private-token"
            assert request.get_header("Content-type") == "application/json"
            assert request.data == b'{"fixture":"private-body"}'
            assert timeout in {15, 30}
            assert "fixture" not in request.get_header("User-agent")
            return Response(b'{"ok":true}')

    def build(*handlers):
        assert len(handlers) == 1 and isinstance(handlers[0], drive.NoRedirect)
        return Opener()

    for transport, url in [(drive.native_token_request, drive.NATIVE_TOKEN),
                           (sync.broker_http_request, drive.NATIVE_BROKER + "/sync/commit")]:
        headers = {"Authorization": "Bearer fixture-private-token", "Content-Type": "application/json"}
        before = dict(headers)
        with patch.object(drive.urllib.request, "build_opener", build):
            assert transport("POST", url, headers, b'{"fixture":"private-body"}', 128) == (200, {}, b'{"ok":true}')
        assert headers == before


def smoke_native_token_proxy(api, root, public, client):
    credentials = root / "token-proxy-private"
    credentials.mkdir()
    fake = FakeGoogle()
    cloud = drive.GoogleDriveBackup(api, zeter, http=fake, token_http=fake.token_http,
                                    protector=protector, credentials_root=credentials)
    old = {"clientId": client, "accessToken": "old-access", "refreshToken": "old-refresh",
           "expiresAt": time.time() - 1, "needsReconnect": False}
    refresh = {"client_id": client, "grant_type": "refresh_token", "refresh_token": old["refreshToken"]}
    good = {"access_token": "new-access", "expires_in": 3600, "token_type": "Bearer", "scope": drive.SCOPE}
    for status, value in [(429, {"error": "rate_limited"}), (503, {"error": "not_configured"}),
                          (502, {"error": "google_unavailable"}), (401, {"error": "unknown"}),
                          (200, {**good, "expires_in": True}), (200, {**good, "expires_in": 86401}),
                          (200, {**good, "scope": drive.SCOPE + " openid"}),
                          (200, {**good, "access_token": []}), (200, {**good, "refresh_token": ""}),
                          (200, {**good, "client_secret": "forbidden"})]:
        cloud._save(old)
        before = cloud._path().read_bytes()
        cloud.token_http = lambda *_, status=status, value=value: (status, {}, json.dumps(value).encode())
        try:
            cloud._tokens(refresh, old)
            raise AssertionError("Rejected/transient token response succeeded")
        except drive.DriveError:
            pass
        assert cloud._path().read_bytes() == before, "Transient/malformed response changed protected auth"
        cloud.token_http = lambda *_: (200, {}, json.dumps(good).encode())
        renewed = cloud._tokens(refresh, old)
        assert renewed["refreshToken"] == "old-refresh" and renewed["accessToken"] == "new-access"
        assert not renewed["needsReconnect"]
    cloud._save(old)
    cloud.token_http = lambda *_: (401, {}, b'{"error":"reconnect_required"}')
    try:
        cloud._tokens(refresh, old)
        raise AssertionError("Confirmed invalid_grant succeeded")
    except drive.DriveError:
        pass
    assert cloud._auth() == {**old, "needsReconnect": True}
    cloud._save(old)
    before = cloud._path().read_bytes()
    cloud.token_http = lambda *_: (200, {}, json.dumps(good).encode())
    try:
        cloud._tokens({"client_id": client, "grant_type": "authorization_code", "code": "fixture-code",
                       "code_verifier": "a" * 43, "redirect_uri": "http://127.0.0.1:12345/oauth2callback"})
        raise AssertionError("Initial grant without refresh token succeeded")
    except drive.DriveError:
        pass
    assert cloud._path().read_bytes() == before
    config_path = public / "google-drive-config.json"
    saved_config = config_path.read_bytes()
    try:
        for broker in ["https://changed.example", drive.NATIVE_BROKER + "/", drive.NATIVE_BROKER + "?x=1"]:
            config_path.write_text(json.dumps({"desktopClientId": client, "brokerUrl": broker}), encoding="utf-8")
            cloud.token_http = lambda *_: (_ for _ in ()).throw(AssertionError("Credentials sent to changed host"))
            try:
                cloud._tokens(refresh, old)
                raise AssertionError("Changed token destination accepted")
            except drive.DriveError:
                pass
            assert cloud._path().read_bytes() == before
    finally:
        config_path.write_bytes(saved_config)
    for url in ["https://changed.example/native/token", drive.NATIVE_TOKEN + "?secret=x"]:
        try:
            drive.native_token_request("POST", url, {}, b"{}", 128)
            raise AssertionError("Unapproved token transport endpoint accepted")
        except drive.DriveError:
            pass


def main():
    smoke_broker_transport_identity()
    with tempfile.TemporaryDirectory(prefix="zeter-drive-кириллица-") as temporary:
        root = Path(temporary)
        configure_temp_data(root)
        credentials = root / "private-user" / "google-drive"
        assert zeter.DATA_DIR.resolve().is_relative_to(root.resolve())
        api = zeter.NativeStorageApi(platform_opener=RecordingPlatformOpener(), google_drive_credentials_root=credentials)
        assert not credentials.exists(), "Constructor must not create auth state"
        public = root / "app"
        public.mkdir()
        client = "fixture.apps.googleusercontent.com"
        (public / "google-drive-config.json").write_text(json.dumps({"desktopClientId": client, "brokerUrl": drive.NATIVE_BROKER}), encoding="utf-8")
        fake = FakeGoogle()
        cloud = drive.GoogleDriveBackup(api, zeter, http=fake, protector=protector, credentials_root=credentials, token_http=fake.token_http)
        api._google_drive = cloud
        external = root / "external-secret.txt"
        external.write_bytes(b"must never enter ZIP")
        record = {"app": "ZeTer OS", "osVersion": "4.0.0", "state": {"fs": {
            "shortcut": {"id": "shortcut", "type": "shortcut", "target": str(external)}}, "settings": {}, "desktops": []}}
        original_read, original_open = Path.read_bytes, Path.open

        def guarded_open(path, *args, **kwargs):
            assert path != external, "Backup attempted to open an external shortcut"
            return original_open(path, *args, **kwargs)

        with patch.object(zeter, "APP_DIR", public), patch.object(Path, "open", guarded_open):
            smoke_native_token_proxy(api, root, public, client)
            built = checked(api.build_security_backup(record))
            raw = base64.b64decode(built["base64"])
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                assert set(archive.namelist()) == {"zeter-os-state.json", "zeter-backup-manifest.json"}
                assert json.loads(archive.read("zeter-os-state.json"))["state"]["fs"]["shortcut"]["target"] == str(external)
            assert checked(api.google_drive_status())["configured"] is True
            assert checked(api.google_drive_status())["connected"] is False
            cloud._save({"clientId": client, "accessToken": "old-fixture", "refreshToken": "fixture-refresh",
                         "expiresAt": time.time() - 1, "needsReconnect": False})
            payload = {"base64": built["base64"], "name": "../копия.zip", "operationId": "operation-fixture-0001"}
            first = checked(api.google_drive_upload(payload))["entry"]
            assert fake.refreshes == 1 and fake.created == 1
            assert first["name"] == "_копия.zip"
            assert checked(api.google_drive_list())["entries"] == [first]
            assert base64.b64decode(checked(api.google_drive_download({"id": first["id"]}))["base64"]) == raw
            checked(api.google_drive_upload(payload))
            assert fake.created == 1, "Repeated upload duplicated a copy"

            foreign = {**fake.files[first["id"]], "id": "foreign", "appProperties": {"app": "other"}}
            fake.files["foreign"] = foreign
            reads = fake.reads
            assert api.google_drive_download({"id": "foreign"})["ok"] is False
            assert fake.reads == reads, "Foreign bytes fetched before ownership validation"
            fake.bad_bytes = True
            assert api.google_drive_download({"id": first["id"]})["ok"] is False
            fake.bad_bytes = False

            fake.ambiguous, fake.hide_listing = True, True
            next_payload = {**payload, "operationId": "operation-fixture-0002"}
            assert api.google_drive_upload(next_payload)["ok"] is False
            count = fake.created
            # A new transport instance simulates restart; listing still hides completion.
            api._google_drive = cloud = drive.GoogleDriveBackup(api, zeter, http=fake, protector=protector, credentials_root=credentials, token_http=fake.token_http)
            checked(api.google_drive_upload(next_payload))
            assert fake.created == count, "Ambiguous completion duplicated after restart"
            fake.hide_listing = False

            fake.bad_md5 = True
            assert api.google_drive_upload({**payload, "operationId": "operation-fixture-0003"})["ok"] is False
            fake.bad_md5 = False
            assert fake.content[first["id"]] == raw

            auth = cloud._auth()
            cloud._save({**auth, "expiresAt": time.time() - 1})
            fake.reject_refresh = True
            assert api.google_drive_list()["ok"] is False
            assert checked(api.google_drive_status())["needsReconnect"] is True
            fake.reject_refresh = False

            # Actual loopback callback with bogus state followed by correct PKCE flow.
            clients = []
            def browser(url):
                query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
                assert query["scope"] == [drive.SCOPE] and query["code_challenge_method"] == ["S256"]
                def callback():
                    wrong = query["redirect_uri"][0] + "?" + urllib.parse.urlencode({"state": "wrong", "code": "fake-code"})
                    try:
                        urllib.request.urlopen(wrong, timeout=3)
                    except urllib.error.HTTPError as error:
                        assert error.code == 400
                        error.close()
                    correct = query["redirect_uri"][0] + "?" + urllib.parse.urlencode({"state": query["state"][0], "code": "fixture-code"})
                    with urllib.request.urlopen(correct, timeout=3) as response:
                        assert response.status == 200
                thread = threading.Thread(target=callback)
                clients.append(thread)
                thread.start()
            cloud.browser = browser
            assert checked(cloud.connect(timeout=4))["connected"] is True
            for thread in clients:
                thread.join(5)
                assert not thread.is_alive()
            form = fake.forms[-1]
            assert form["grant_type"] == ["authorization_code"] and len(form["code_verifier"][0]) >= 43
            cloud.browser = lambda _: cloud.cancel.set()
            try:
                cloud.connect(timeout=1)
                raise AssertionError("Cancelled connection succeeded")
            except drive.DriveError:
                pass
            checked(api.google_drive_disconnect())
            assert not (credentials / "auth.dpapi").exists()
            assert not checked(api.google_drive_status())["connected"]
            assert not list(zeter.DATA_DIR.rglob("*.dpapi"))
            assert all(not path.is_relative_to(public) and not path.is_relative_to(zeter.DATA_DIR) for path in credentials.glob("*"))
        assert original_read(external) == b"must never enter ZIP"
        smoke_native_preferences_and_preserve(api, root, client, built)
        with patch.object(zeter, "APP_DIR", public):
            smoke_generic(api, root, client, public)
            smoke_bootstrap_fixed_ids(api, root, client)
            smoke_deleted_root(api, root, client)
        print("PASS: Drive refresh/reconnect, ownership before bytes, ZIP/hash/md5, stable-ID ambiguous restart dedupe, loopback state/PKCE/cancel, local disconnect, private credentials, external shortcut preservation")
        print("PASS: generic shared namespace, ordinary immutable files/folders, operation dedupe/restart, owned metadata move, expected hash read, broker account/session/head/CAS409/idempotency and one 401 remint")
        print("PASS: per-install native preferences survive restart/origin changes, rejected publication preserves prior state, private path refusal, immutable validated local conflict ZIP and installation isolation")
        print("PASS: bootstrap canonical root reuse; fixed folder/file IDs survive lost replies and hidden listings; directory reservations; strict uploadIntent validation with durable rejection preservation")
        print("PASS: canonical trash/404 distinction; null-head reservation read; auth/network/foreign fail closed; lost-response replacement winner; pending head; active hidden-name validation; trashed replacement refusal; native recreate bridge")


if __name__ == "__main__":
    main()
