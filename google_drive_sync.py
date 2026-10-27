"""Owned ordinary Drive files and the conditional shared sync-head broker.

No filesystem payload discovery, deletion, overwrite or background work. The UI
owns snapshots/conflict decisions; this boundary moves verified immutable bytes.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import secrets
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from google_drive_backup import API, FIELDS, UPLOAD, BROKER_USER_AGENT, DriveError, HttpFailure, NoRedirect
from problem_logs import plain_path
from security_backup import MAX_BYTES

NAMESPACE = {"app": "zeter-os", "format": "sync-v1"}
KINDS = {"root", "data", "history", "staging", "snapshot", "state", "payload", "directory"}
FOLDER_KINDS = {"root", "data", "history", "staging", "snapshot", "directory"}
FILE_KINDS = {"snapshot", "state", "payload"}
FOLDER_MIME = "application/vnd.google-apps.folder"
DIGEST = re.compile(r"[a-f0-9]{64}")
OPERATION = re.compile(r"[a-f0-9]{32}")
TOKEN = re.compile(r"[A-Za-z0-9_-]{16,4096}")
MAX_JSON = 2 * 1024 * 1024
BOOTSTRAP_FIELDS = {"rootFolderId", "dataFolderId", "historyFolderId", "stagingFolderId"}
CANONICAL_FOLDER_NAMES = {"root": "ZeTer OS", "data": "data", "history": ".zeter-sync-history", "staging": ".zeter-sync-staging"}


def name(value):
    if (not isinstance(value, str) or not value.strip() or len(value) > 240
            or value in {".", ".."} or re.search(r"[\x00-\x1f/\\]", value)):
        raise DriveError("Некорректное имя файла или папки Google Drive.")
    return value


def digest(value):
    if not isinstance(value, str) or not DIGEST.fullmatch(value):
        raise DriveError("Некорректная контрольная сумма синхронизации.")
    return value


def operation(value):
    if not isinstance(value, str) or not OPERATION.fullmatch(value):
        raise DriveError("Некорректный идентификатор операции синхронизации.")
    return value


def generation(value):
    if type(value) is not int or not 0 <= value < 2**53:
        raise DriveError("Некорректная версия синхронизации.")
    return value


def broker_http_request(method, url, headers, body, limit):
    """Only called with a locally validated fixed broker endpoint; no redirects."""
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    request.add_header("User-Agent", BROKER_USER_AGENT)
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
    except urllib.error.HTTPError as error:
        # Preserve bounded 401/409 bodies for the explicit protocol, not exception text.
        response = error
    except (OSError, urllib.error.URLError, TimeoutError):
        raise DriveError("Нет соединения с сервером синхронизации. Повторите позже.") from None
    with response:
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise DriveError("Ответ сервера синхронизации слишком большой.")
        return response.status, {}, raw


class GoogleDriveSync:
    def __init__(self, drive, broker_http=broker_http_request):
        self.drive = drive
        self.broker_http = broker_http

    def _installation_root(self):
        data = self.drive.host.DATA_DIR
        if not plain_path(data, data):
            raise DriveError("Небезопасная папка данных синхронизации.")
        fingerprint = hashlib.sha256(os.path.normcase(str(data.resolve())).encode("utf-8")).hexdigest()
        root = self.drive.credentials_root / ("installation-" + fingerprint)
        if not plain_path(self.drive.credentials_root, root):
            raise DriveError("Небезопасная личная папка синхронизации.")
        root.mkdir(parents=True, exist_ok=True)
        if not plain_path(self.drive.credentials_root, root):
            raise DriveError("Личная папка синхронизации была перенаправлена.")
        return root

    def _preferences_value(self, value):
        allowed = {"enabled", "onboardingVersion", "deviceId", "baseGeneration", "baseLocalHash", "baseCloudHash", "accountKey", "pending", "conflict", "uploadIntent"}
        if not isinstance(value, dict) or not set(value).issubset(allowed):
            raise DriveError("Некорректные настройки синхронизации.")
        if "enabled" in value and type(value["enabled"]) is not bool:
            raise DriveError("Некорректный флаг синхронизации.")
        if "onboardingVersion" in value and (type(value["onboardingVersion"]) is not int or value["onboardingVersion"] not in {0, 1}):
            raise DriveError("Некорректная версия инструкции синхронизации.")
        if "deviceId" in value:
            operation(value["deviceId"])
        if value.get("baseGeneration") is not None:
            generation(value["baseGeneration"])
        for key in ("baseLocalHash", "baseCloudHash"):
            if value.get(key) is not None:
                digest(value[key])
        if value.get("accountKey") is not None:
            digest(value["accountKey"])
        intent = value.get("uploadIntent")
        if intent is not None:
            fields = {"accountKey", "operationId", "snapshotId", "createdAt", "expectedGeneration", "localHash", "bootstrap", "fileIds"}
            if not isinstance(intent, dict) or set(intent) != fields:
                raise DriveError("Некорректное намерение загрузки синхронизации.")
            digest(intent["accountKey"])
            if intent["accountKey"] != value.get("accountKey"):
                raise DriveError("Загрузка относится к другому аккаунту.")
            operation(intent["operationId"])
            operation(intent["snapshotId"])
            generation(intent["expectedGeneration"])
            digest(intent["localHash"])
            if type(intent["createdAt"]) is not int or not 0 < intent["createdAt"] < 10**15:
                raise DriveError("Некорректное время загрузки.")
            if intent["bootstrap"] is not None:
                self._bootstrap_value(intent["bootstrap"])
            file_ids = intent["fileIds"]
            if not isinstance(file_ids, dict) or len(file_ids) > 10000:
                raise DriveError("Журнал идентификаторов загрузки заполнен или повреждён.")
            for key, identifier in file_ids.items():
                operation(key)
                self.drive._id(identifier)
            if len(set(file_ids.values())) != len(file_ids):
                raise DriveError("Идентификаторы разных файлов загрузки совпадают.")
        pending = value.get("pending")
        if pending is not None:
            fields = {"operationId", "expectedGeneration", "rootFolderId", "candidate", "localHash"}
            if not isinstance(pending, dict) or set(pending) != fields:
                raise DriveError("Некорректная незавершённая синхронизация.")
            operation(pending["operationId"])
            generation(pending["expectedGeneration"])
            self.drive._id(pending["rootFolderId"])
            digest(pending["localHash"])
            candidate = pending["candidate"]
            if not isinstance(candidate, dict) or set(candidate) != {"snapshotId", "manifestFileId", "manifestSha256", "contentHash"}:
                raise DriveError("Некорректный сохранённый снимок синхронизации.")
            for key in ("snapshotId", "manifestFileId"):
                self.drive._id(candidate[key])
            for key in ("manifestSha256", "contentHash"):
                digest(candidate[key])
        conflict = value.get("conflict")
        if conflict is not None:
            if not isinstance(conflict, dict) or set(conflict) != {"branchId", "head", "localHash", "reason"}:
                raise DriveError("Некорректные сведения о конфликте синхронизации.")
            if not isinstance(conflict["branchId"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", conflict["branchId"]):
                raise DriveError("Некорректный идентификатор страховочной копии.")
            digest(conflict["localHash"])
            if not isinstance(conflict["reason"], str) or len(conflict["reason"]) > 2000 or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", conflict["reason"]):
                raise DriveError("Некорректное описание конфликта синхронизации.")
            head = conflict["head"]
            if head is not None:
                checked = self._head({"head": head, "generation": head.get("generation") if isinstance(head, dict) else None}, value.get("accountKey") or "local")
                if checked["head"] != head:
                    raise DriveError("Неизвестные поля версии конфликта синхронизации.")
        raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(raw) > 1024 * 1024:
            raise DriveError("Настройки синхронизации превышают безопасный размер.")
        return raw

    def _publish_local(self, path, raw, validator, encrypted=False):
        """Validate a closed, flushed same-directory temp before atomic publication."""
        root = self.drive.credentials_root
        if not plain_path(root, path):
            raise DriveError("Небезопасный путь локальной синхронизации.")
        protected = self.drive.protector(raw) if encrypted else raw
        descriptor, temporary = tempfile.mkstemp(prefix=".zeter-sync-", suffix=".tmp", dir=path.parent)
        temp = Path(temporary)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(protected)
                stream.flush()
                os.fsync(stream.fileno())
            if not plain_path(root, temp) or not plain_path(root, path):
                raise DriveError("Папка синхронизации была перенаправлена.")
            saved = temp.read_bytes()
            if saved != protected:
                raise DriveError("Локальная копия синхронизации не прошла проверку чтением.")
            decoded = self.drive.protector(saved, True) if encrypted else saved
            if decoded != raw:
                raise DriveError("Локальная копия синхронизации повреждена.")
            validator(decoded)
            if path.suffix == ".zip":
                # Never replace even an unexpectedly colliding conflict branch.
                # Windows rename refuses an existing destination. On POSIX use
                # no-replace hard-link publication rather than replacing rename.
                if os.name == "nt":
                    os.rename(temp, path)
                else:
                    os.link(temp, path)
            else:
                self.drive.host.replace_transiently_locked_file(temp, path)
        finally:
            if plain_path(root, temp):
                temp.unlink(missing_ok=True)

    def sync_preferences(self, payload=None):
        with self.drive.transaction():
            root = self._installation_root()
            path = root / "preferences.dpapi"
            if not plain_path(root, path):
                raise DriveError("Небезопасный путь настроек синхронизации.")
            if payload is None:
                if not path.exists():
                    return {"ok": True, "value": None}
                try:
                    if path.stat().st_size > 2 * 1024 * 1024:
                        raise ValueError()
                    value = json.loads(self.drive.protector(path.read_bytes(), True))
                    self._preferences_value(value)
                    return {"ok": True, "value": value}
                except Exception:
                    raise DriveError("Настройки синхронизации повреждены. Существующий файл сохранён.") from None
            if not isinstance(payload, dict) or set(payload) != {"value"}:
                raise DriveError("Некорректный запрос настроек синхронизации.")
            raw = self._preferences_value(payload["value"])
            self._publish_local(path, raw, lambda data: self._preferences_value(json.loads(data)), encrypted=True)
            return {"ok": True, "value": json.loads(raw)}

    def sync_preserve(self, payload):
        with self.drive.transaction():
            if not isinstance(payload, dict) or not set(payload).issubset({"base64", "name"}):
                raise DriveError("Некорректный запрос страховочной копии.")
            encoded = payload.get("base64")
            if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
                raise DriveError("Страховочная копия превышает 120 МиБ.")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise DriveError("Некорректная страховочная ZIP-копия.") from None
            verifier = lambda data: self.drive.api._security_backup_store()._verify(io.BytesIO(data))
            verifier(raw)
            if "name" in payload:
                name(payload["name"])
            root = self._installation_root()
            conflicts = root / "conflicts"
            if not plain_path(root, conflicts):
                raise DriveError("Небезопасная папка страховочных копий.")
            conflicts.mkdir(exist_ok=True)
            identifier = secrets.token_hex(16)
            path = conflicts / (identifier + ".zip")
            if path.exists() or not plain_path(root, path):
                raise DriveError("Нельзя заменить существующую страховочную копию.")
            self._publish_local(path, raw, verifier)
            return {"ok": True, "id": identifier}

    def _kind(self, value, folders=False):
        if not isinstance(value, str) or value not in (FOLDER_KINDS if folders else FILE_KINDS):
            raise DriveError("Некорректный тип объекта синхронизации.")
        return value

    def _properties(self, payload, folders=False):
        props = {**NAMESPACE, "kind": self._kind(payload.get("kind"), folders)}
        if payload.get("pathKey") is not None:
            props["pathKey"] = digest(payload["pathKey"])
        if payload.get("operationId") is not None:
            props["operationId"] = operation(payload["operationId"])
        return props

    def _entry(self, item):
        if not isinstance(item, dict):
            raise DriveError("Некорректные сведения об объекте Google Drive.")
        props = item.get("appProperties")
        if (not isinstance(props, dict) or any(props.get(key) != value for key, value in NAMESPACE.items())
                or props.get("kind") not in KINDS or item.get("trashed")):
            raise DriveError("Объект не принадлежит синхронизации ZeTer OS.")
        mime = item.get("mimeType")
        folders = mime == FOLDER_MIME
        self._kind(props["kind"], folders)
        if not isinstance(mime, str) or not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", mime):
            raise DriveError("Некорректный формат объекта Google Drive.")
        parents = item.get("parents", [])
        if not isinstance(parents, list) or len(parents) > 1:
            raise DriveError("Некорректная родительская папка Google Drive.")
        for parent in parents:
            self.drive._id(parent)
        try:
            created = int(datetime.fromisoformat(item["createdTime"].replace("Z", "+00:00")).timestamp() * 1000)
        except (KeyError, TypeError, ValueError, OverflowError):
            raise DriveError("Некорректная дата объекта Google Drive.") from None
        entry = {"id": self.drive._id(item.get("id")), "name": name(item.get("name")), "kind": props["kind"],
                 "mimeType": mime, "parents": parents, "createdAt": created}
        for field in ("pathKey", "sha256"):
            if field in props:
                entry[field] = digest(props[field])
        if "operationId" in props:
            entry["operationId"] = operation(props["operationId"])
        if not folders:
            try:
                size = int(item["size"])
            except (KeyError, TypeError, ValueError):
                raise DriveError("Некорректный размер файла Google Drive.") from None
            if not 0 <= size <= MAX_BYTES or "sha256" not in entry:
                raise DriveError("Файл превышает 120 МиБ или не имеет контрольной суммы.")
            entry["sizeBytes"] = size
        return entry

    def _get(self, identifier):
        identifier = self.drive._id(identifier)
        _, item = self.drive._request("GET", API + "/" + identifier + "?" + urllib.parse.urlencode({"fields": FIELDS}))
        return self._entry(item), item

    def _parent(self, identifier):
        entry, _ = self._get(identifier)
        if entry["mimeType"] != FOLDER_MIME:
            raise DriveError("Родительский объект Google Drive должен быть папкой ZeTer OS.")
        return entry

    def _query(self, query, token=None):
        params = {"q": query, "spaces": "drive", "pageSize": 100,
                  "fields": "nextPageToken,files(" + FIELDS + ")", "orderBy": "createdTime desc"}
        if token is not None:
            if not isinstance(token, str) or not 0 < len(token) <= 4096 or re.search(r"[\x00-\x20]", token):
                raise DriveError("Некорректная страница Google Drive.")
            params["pageToken"] = token
        _, result = self.drive._request("GET", API + "?" + urllib.parse.urlencode(params))
        if not isinstance(result, dict) or not isinstance(result.get("files", []), list) or len(result.get("files", [])) > 100:
            raise DriveError("Некорректный список Google Drive.")
        next_page = result.get("nextPageToken")
        if next_page is not None and (not isinstance(next_page, str) or len(next_page) > 4096):
            raise DriveError("Некорректная страница Google Drive.")
        return [self._entry(item) for item in result.get("files", [])], next_page

    def _owned_query(self):
        return ("trashed=false and appProperties has { key='app' and value='zeter-os' } and "
                "appProperties has { key='format' and value='sync-v1' }")

    def files(self, payload):
        with self.drive.transaction():
            parent = self._parent(payload.get("parentId"))
            query = self._owned_query() + " and '" + parent["id"] + "' in parents"
            if payload.get("kind") is not None:
                kind = payload["kind"]
                if not isinstance(kind, str) or kind not in KINDS:
                    raise DriveError("Некорректный тип объекта синхронизации.")
                query += " and appProperties has { key='kind' and value='" + kind + "' }"
            entries, token = self._query(query, payload.get("pageToken"))
            if any(parent["id"] not in entry["parents"] for entry in entries):
                raise DriveError("Google Drive вернул объект из другой папки.")
            return {"ok": True, "entries": entries, **({"nextPageToken": token} if token else {})}

    def _operation_record(self, props, parent, item_name, sha=None):
        """One immutable server ID per operation, durable before its first POST."""
        op = props.get("operationId")
        if op is None:
            return None
        path = self.drive._path().with_name("sync-operations.dpapi")
        if not plain_path(self.drive.credentials_root, path):
            raise DriveError("Небезопасный путь журнала синхронизации.")
        values = {}
        if path.exists():
            try:
                if path.stat().st_size > MAX_JSON:
                    raise ValueError()
                values = json.loads(self.drive.protector(path.read_bytes(), True))
                if not isinstance(values, dict):
                    raise ValueError()
            except Exception:
                raise DriveError("Журнал синхронизации повреждён. Новая загрузка остановлена.") from None
        # Account boundary is the owned parent; root operations are namespaced by
        # the connected account's permission ID (fetched only for root creation).
        scope = parent or self._permission_id()
        key = hashlib.sha256((self.drive._client() + ":" + scope + ":" + op).encode()).hexdigest()
        specification = {"parentId": parent, "name": item_name, "properties": props, "sha256": sha}
        pending = values.get(key)
        if pending is not None:
            if not isinstance(pending, dict) or pending.get("specification") != specification:
                raise DriveError("Операция синхронизации уже связана с другим объектом.")
            return self.drive._id(pending.get("id"))
        if len(values) >= 4000:
            raise DriveError("Журнал синхронизации заполнен. Новая загрузка остановлена.")
        _, result = self.drive._request("GET", API + "/generateIds?count=1&space=drive&type=files")
        try:
            identifier = self.drive._id(result["ids"][0])
        except (KeyError, TypeError, IndexError):
            raise DriveError("Google Drive не выделил идентификатор файла.") from None
        values[key] = {"id": identifier, "specification": specification}
        raw = json.dumps(values, allow_nan=False).encode()
        if len(raw) > MAX_JSON:
            raise DriveError("Журнал синхронизации заполнен. Новая загрузка остановлена.")
        protected = self.drive.protector(raw)
        if self.drive.protector(protected, True) != raw:
            raise DriveError("Не удалось проверить журнал синхронизации.")
        self.drive.host.atomic_write_bytes(path, protected)
        return identifier

    def _permission_id(self):
        _, value = self.drive._request("GET", "https://www.googleapis.com/drive/v3/about?fields=user(permissionId)")
        try:
            return self.drive._id(value["user"]["permissionId"])
        except (KeyError, TypeError):
            raise DriveError("Не удалось определить аккаунт синхронизации.") from None

    def _existing(self, identifier):
        try:
            _, item = self.drive._json("GET", API + "/" + identifier + "?" + urllib.parse.urlencode({"fields": FIELDS}), auth=self.drive._access())
            return self._entry(item), item
        except HttpFailure as error:
            if error.status == 404:
                return None
            raise DriveError("Не удалось проверить прежнюю загрузку. Повторите позже.") from None

    def _same(self, entry, metadata):
        props = metadata["appProperties"]
        fields = ("kind", "pathKey", "sha256") if props["kind"] in {"root", "data", "history", "staging", "directory"} else ("kind", "pathKey", "sha256", "operationId")
        actual_mime = entry["mimeType"]
        # Drive refines opaque uploads (e.g. octet-stream -> image/png).
        # Only ordinary payload bytes permit refinement; Google-native types,
        # state/manifests and folders keep their exact format contract.
        refined_payload = (props["kind"] == "payload" and metadata["mimeType"] == "application/octet-stream"
                           and isinstance(actual_mime, str)
                           and re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", actual_mime)
                           and not actual_mime.lower().startswith("application/vnd.google-apps."))
        if (entry["name"] != metadata["name"] or (actual_mime != metadata["mimeType"] and not refined_payload)
                or (metadata.get("parents") and entry["parents"] != metadata["parents"])
                or any(entry.get(field) != props.get(field) for field in fields)):
            raise DriveError("Идентификатор операции связан с другим объектом Google Drive.")

    def _find_operation(self, props, parent):
        if not props.get("operationId"):
            return None
        query = self._owned_query() + " and appProperties has { key='operationId' and value='" + props["operationId"] + "' }"
        if parent:
            query += " and '" + parent + "' in parents"
        entries, token = self._query(query)
        if token or len(entries) > 1:
            raise DriveError("Операция синхронизации связана с несколькими объектами. Новая загрузка остановлена.")
        return entries[0] if entries else None

    def make_folder(self, payload):
        with self.drive.transaction():
            props, item_name = self._properties(payload, True), name(payload.get("name"))
            parent = payload.get("parentId")
            if parent is not None:
                parent = self._parent(parent)["id"]
            elif props["kind"] != "root":
                raise DriveError("Для этой папки нужен родитель ZeTer OS.")
            metadata = {"name": item_name, "mimeType": FOLDER_MIME, "appProperties": props}
            if parent:
                metadata["parents"] = [parent]
            if payload.get("id") is not None:
                identifier = self.drive._id(payload["id"])
                metadata["id"] = identifier
                existing = self._existing(identifier)
                if existing:
                    self._same(existing[0], metadata)
                    return {"ok": True, "entry": existing[0]}
                _, item = self.drive._request("POST", API + "?" + urllib.parse.urlencode({"fields": FIELDS}), metadata)
                entry = self._entry(item)
                if entry["id"] != identifier:
                    raise DriveError("Google Drive вернул другой идентификатор папки.")
                self._same(entry, metadata)
                return {"ok": True, "entry": entry}
            previous = self._find_operation(props, parent)
            if previous:
                self._same(previous, metadata)
                return {"ok": True, "entry": previous}
            if props.get("operationId") is None:
                # Root folder is discoverable across devices. No arbitrary-name reuse
                # for children: callers provide operationId for idempotent creation.
                query = self._owned_query() + " and mimeType='" + FOLDER_MIME + "' and appProperties has { key='kind' and value='" + props["kind"] + "' }"
                if parent:
                    query += " and '" + parent + "' in parents"
                entries, token = self._query(query)
                if token:
                    raise DriveError("Найдено слишком много корневых папок синхронизации.")
                matching = [entry for entry in entries if entry["name"] == item_name and entry.get("pathKey") == props.get("pathKey")]
                if matching:
                    return {"ok": True, "entry": matching[-1]}
            identifier = self._operation_record(props, parent, item_name)
            if identifier:
                metadata["id"] = identifier
                existing = self._existing(identifier)
                if existing:
                    self._same(existing[0], metadata)
                    return {"ok": True, "entry": existing[0]}
            _, item = self.drive._request("POST", API + "?" + urllib.parse.urlencode({"fields": FIELDS}), metadata)
            entry = self._entry(item)
            self._same(entry, metadata)
            return {"ok": True, "entry": entry}

    def _read(self, entry, expected_sha, expected_size):
        if entry["mimeType"] == FOLDER_MIME or entry.get("sha256") != expected_sha or entry.get("sizeBytes") != expected_size:
            raise DriveError("Файл Google Drive не совпадает с ожидаемой копией.")
        try:
            _, _, raw = self.drive.http("GET", API + "/" + entry["id"] + "?alt=media",
                {"Authorization": "Bearer " + self.drive._access()}, None, expected_size)
        except HttpFailure:
            raise DriveError("Не удалось прочитать файл Google Drive.") from None
        if len(raw) != expected_size or hashlib.sha256(raw).hexdigest() != expected_sha:
            raise DriveError("Контрольная сумма файла Google Drive не совпадает.")
        return raw

    def read_file(self, payload):
        with self.drive.transaction():
            expected_sha = digest(payload.get("sha256"))
            expected_size = payload.get("sizeBytes")
            omitted_size = "sizeBytes" not in payload
            if not omitted_size and (type(expected_size) is not int or not 0 <= expected_size <= MAX_BYTES):
                raise DriveError("Некорректный размер файла синхронизации.")
            if omitted_size:
                # The accepted manifest can be missing while its root folder still
                # exists. Preserve an explicit, fixed error for user-approved repair.
                found = self._existing(payload.get("id"))
                if found is None:
                    raise DriveError("Принятый манифест облачной копии отсутствует в Google Drive.")
                entry, _ = found
            else:
                entry, _ = self._get(payload.get("id"))
            if omitted_size:
                # Broker heads intentionally omit manifest size. Only their owned
                # snapshot files may derive it from bounded, validated metadata.
                if entry["kind"] != "snapshot" or entry["mimeType"] == FOLDER_MIME:
                    raise DriveError("Для этого файла нужен ожидаемый размер синхронизации.")
                expected_size = entry["sizeBytes"]
            raw = self._read(entry, expected_sha, expected_size)
            return {"ok": True, "base64": base64.b64encode(raw).decode("ascii"), "name": entry["name"], "sizeBytes": len(raw)}

    def put_file(self, payload):
        with self.drive.transaction():
            props, item_name = self._properties(payload), name(payload.get("name"))
            operation(payload.get("operationId"))
            parent = self._parent(payload.get("parentId"))["id"]
            mime = payload.get("mimeType")
            if (not isinstance(mime, str) or mime == FOLDER_MIME
                    or not re.fullmatch(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+", mime)):
                raise DriveError("Некорректный формат файла синхронизации.")
            encoded = payload.get("base64")
            if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
                raise DriveError("Файл синхронизации превышает 120 МиБ.")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise DriveError("Некорректные данные файла синхронизации.") from None
            if len(raw) > MAX_BYTES:
                raise DriveError("Файл синхронизации превышает 120 МиБ.")
            props["sha256"] = sha = hashlib.sha256(raw).hexdigest()
            metadata = {"name": item_name, "mimeType": mime, "parents": [parent], "appProperties": props}
            fixed = self.drive._id(payload["id"]) if payload.get("id") is not None else None
            previous = None if fixed else self._find_operation(props, parent)
            if previous:
                self._same(previous, metadata)
                self._read(previous, sha, len(raw))
                return {"ok": True, "entry": previous}
            identifier = fixed or self._operation_record(props, parent, item_name, sha)
            metadata["id"] = identifier
            existing = self._existing(identifier)
            if existing:
                self._same(existing[0], metadata)
                self._read(existing[0], sha, len(raw))
                return {"ok": True, "entry": existing[0]}
            try:
                headers, _ = self.drive._json("POST", UPLOAD + "?uploadType=resumable&fields=" + urllib.parse.quote(FIELDS),
                    metadata, self.drive._access(), {"X-Upload-Content-Type": mime, "X-Upload-Content-Length": str(len(raw))})
                location = next((value for key, value in headers.items() if key.lower() == "location"), "")
                parsed = urllib.parse.urlsplit(location)
                if parsed.scheme != "https" or parsed.netloc != "www.googleapis.com" or parsed.path != "/upload/drive/v3/files" or parsed.fragment:
                    raise DriveError("Недопустимый адрес загрузки Google Drive.")
                _, _, response = self.drive.http("PUT", location, {"Authorization": "Bearer " + self.drive._access(),
                    "Content-Type": mime, "Content-Length": str(len(raw))}, raw, MAX_JSON)
                uploaded = json.loads(response)
                if uploaded.get("id") != identifier:
                    raise ValueError()
            except (HttpFailure, ValueError, TypeError):
                raise DriveError("Загрузка не подтверждена. Повторите ту же операцию синхронизации.") from None
            entry, item = self._get(identifier)
            self._same(entry, metadata)
            if item.get("md5Checksum") != hashlib.md5(raw, usedforsecurity=False).hexdigest():
                raise DriveError("Google Drive не подтвердил контрольную сумму загрузки.")
            self._read(entry, sha, len(raw))
            return {"ok": True, "entry": entry}

    def move_file(self, payload):
        with self.drive.transaction():
            entry, _ = self._get(payload.get("id"))
            parent = self._parent(payload.get("parentId"))
            item_name = name(payload.get("name"))
            if entry["id"] == parent["id"] or entry["kind"] == "root":
                raise DriveError("Нельзя переместить корневую папку синхронизации.")
            params = {"fields": FIELDS}
            if entry["parents"] != [parent["id"]]:
                params["addParents"] = parent["id"]
                if entry["parents"]:
                    params["removeParents"] = ",".join(entry["parents"])
            # Metadata-only PATCH; no upload URL, bytes, trash or delete operation.
            _, item = self.drive._request("PATCH", API + "/" + entry["id"] + "?" + urllib.parse.urlencode(params), {"name": item_name})
            moved = self._entry(item)
            if moved["id"] != entry["id"] or moved["parents"] != [parent["id"]] or moved["name"] != item_name:
                raise DriveError("Google Drive не подтвердил перемещение объекта.")
            if any(moved.get(key) != entry.get(key) for key in ("sha256", "sizeBytes", "kind", "mimeType")):
                raise DriveError("Содержимое объекта изменилось при перемещении.")
            return {"ok": True, "entry": moved}

    def _broker(self):
        path = self.drive.host.APP_DIR / "google-drive-config.json"
        try:
            if not plain_path(self.drive.host.APP_DIR, path) or path.stat().st_size > 8192:
                raise ValueError()
            value = json.loads(path.read_text(encoding="utf-8-sig"))
            url = value.get("brokerUrl", "")
            parsed = urllib.parse.urlsplit(url)
            if (not isinstance(url, str) or len(url) > 2048 or parsed.scheme != "https" or not parsed.hostname
                    or parsed.username or parsed.password or parsed.port not in {None, 443} or parsed.query or parsed.fragment
                    or parsed.hostname in {"localhost", "127.0.0.1", "::1"} or re.search(r"[\x00-\x20]", url)
                    or not re.fullmatch(r"[A-Za-z0-9.-]+", parsed.hostname) or "." not in parsed.hostname
                    or re.fullmatch(r"[0-9.]+", parsed.hostname)):
                raise ValueError()
            return url.rstrip("/")
        except (OSError, ValueError, TypeError, AttributeError):
            raise DriveError("Сервер синхронизации ещё не настроен в этой версии ZeTer OS.") from None

    def _session_path(self):
        path = self.drive._path().with_name("broker-session.dpapi")
        if not plain_path(self.drive.credentials_root, path):
            raise DriveError("Небезопасный путь подключения синхронизации.")
        return path

    def _broker_json(self, method, endpoint, payload=None, session=None):
        if (method, endpoint) not in {("POST", "/native/session"), ("GET", "/sync/head"), ("POST", "/sync/commit"), ("POST", "/sync/bootstrap"), ("POST", "/sync/directory"), ("POST", "/sync/recreate")}:
            raise DriveError("Недопустимая операция сервера синхронизации.")
        headers = {"Accept": "application/json"}
        raw = None
        if payload is not None:
            raw = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode()
            if len(raw) >= (16384 if endpoint == "/native/session" else 4096):
                raise DriveError("Запрос синхронизации слишком большой.")
            headers["Content-Type"] = "application/json"
        if session:
            headers["Authorization"] = "Bearer " + session
        status, _, result = self.broker_http(method, self._broker() + endpoint, headers, raw, 65536)
        try:
            result = json.loads(result)
            if not isinstance(result, dict):
                raise ValueError()
        except (ValueError, TypeError):
            raise DriveError("Сервер синхронизации вернул некорректный ответ.") from None
        return status, result

    def _session(self, fresh=False):
        path, broker = self._session_path(), self._broker()
        client = self.drive._client()
        # Bind the opaque server session to this exact Google connection. A new
        # browser consent can select another account while clientId stays equal.
        self.drive._access()
        auth = self.drive._auth()
        connection_key = hashlib.sha256((auth["clientId"] + "\0" + auth["refreshToken"]).encode()).hexdigest()
        if not fresh and path.exists():
            try:
                if path.stat().st_size > 65536:
                    raise ValueError()
                saved = json.loads(self.drive.protector(path.read_bytes(), True))
                if (saved.get("brokerUrl") == broker and saved.get("clientId") == client
                        and saved.get("connectionKey") == connection_key
                        and type(saved.get("expiresAt")) is int and saved["expiresAt"] > int(time.time() * 1000) + 60000
                        and TOKEN.fullmatch(saved.get("sessionHandle", ""))):
                    self.drive._id(saved.get("accountKey"))
                    return saved
            except (ValueError, TypeError, AttributeError):
                raise DriveError("Подключение сервера синхронизации повреждено. Подключитесь снова.") from None
        status, result = self._broker_json("POST", "/native/session", {"accessToken": self.drive._access()})
        if status != 200:
            raise DriveError("Сервер синхронизации отклонил подключение. Подключитесь снова.")
        if (not isinstance(result.get("sessionHandle"), str) or not TOKEN.fullmatch(result["sessionHandle"])
                or type(result.get("expiresAt")) is not int or not int(time.time() * 1000) < result["expiresAt"] < 10**15):
            raise DriveError("Сервер синхронизации не выдал защищённое подключение.")
        saved = {"brokerUrl": broker, "clientId": client, "sessionHandle": result["sessionHandle"],
                 "accountKey": self.drive._id(result.get("accountKey")), "expiresAt": result["expiresAt"], "connectionKey": connection_key}
        raw = json.dumps(saved, allow_nan=False).encode()
        protected = self.drive.protector(raw)
        if self.drive.protector(protected, True) != raw:
            raise DriveError("Не удалось проверить подключение сервера синхронизации.")
        self.drive.host.atomic_write_bytes(path, protected)
        return saved

    def _head(self, result, account):
        current = generation(result.get("generation"))
        head = result.get("head")
        if result.get("accountKey", account) != account:
            raise DriveError("Сервер вернул другой аккаунт синхронизации.")
        if head is None:
            if current != 0:
                raise DriveError("Сервер вернул неполную версию синхронизации.")
            return {"accountKey": account, "head": None, "generation": 0}
        fields = {"generation", "rootFolderId", "snapshotId", "manifestFileId", "manifestSha256", "contentHash", "operationId", "parentGeneration", "committedAt"}
        if not isinstance(head, dict) or not fields.issubset(head):
            raise DriveError("Сервер вернул неполную версию синхронизации.")
        clean = {key: head[key] for key in fields}
        if generation(clean["generation"]) != current or generation(clean["parentGeneration"]) != current - 1:
            raise DriveError("Версии синхронизации не согласованы.")
        for key in ("rootFolderId", "snapshotId", "manifestFileId"):
            self.drive._id(clean[key])
        for key in ("manifestSha256", "contentHash"):
            digest(clean[key])
        operation(clean["operationId"])
        if type(clean["committedAt"]) is not int or not 0 < clean["committedAt"] < 10**15:
            raise DriveError("Некорректное время публикации синхронизации.")
        return {"accountKey": account, "head": clean, "generation": current}

    def _head_request(self, method, endpoint, payload=None):
        session = self._session()
        status, result = self._broker_json(method, endpoint, payload, session["sessionHandle"])
        if status == 401:
            session = self._session(fresh=True)
            status, result = self._broker_json(method, endpoint, payload, session["sessionHandle"])
        if status == 409 and endpoint == "/sync/commit" and result.get("error") == "sync-conflict":
            return {"ok": True, "conflict": True, **self._head(result, session["accountKey"])}
        if status != 200:
            raise DriveError("Не удалось подтвердить синхронизацию. Повторите позже.")
        return {"ok": True, **self._head(result, session["accountKey"])}

    def sync_head(self):
        with self.drive.transaction():
            current = self._head_request("GET", "/sync/head")
            root_id = current["head"]["rootFolderId"] if current["head"] else None
            if root_id is None:
                reservation = self._bootstrap_request(current["generation"], None)
                if reservation["accountKey"] != current["accountKey"]:
                    raise DriveError("Аккаунт синхронизации изменился.")
                if reservation.get("conflict"):
                    current = {key: reservation[key] for key in ("ok", "head", "generation", "accountKey")}
                    root_id = current["head"]["rootFolderId"] if current["head"] else None
                else:
                    if reservation["generation"] != current["generation"] or reservation["head"] != current["head"]:
                        raise DriveError("Версия синхронизации изменилась.")
                    if reservation["bootstrap"]:
                        root_id = reservation["bootstrap"]["rootFolderId"]
            if root_id and self._root_missing(root_id, accepted_head=current["head"] is not None):
                current["missingRootFolderId"] = root_id
            return current

    def _root_missing(self, identifier, *, accepted_head):
        """Only an accepted head proves materialization before a 404 response."""
        identifier = self.drive._id(identifier)
        try:
            _, item = self.drive._json("GET", API + "/" + identifier + "?" + urllib.parse.urlencode({"fields": FIELDS}), auth=self.drive._access())
        except HttpFailure as error:
            if error.status == 404:
                return accepted_head
            raise DriveError("Не удалось проверить корневую папку синхронизации.") from None
        if not isinstance(item, dict) or item.get("id") != identifier or type(item.get("trashed")) is not bool:
            raise DriveError("Некорректные сведения о корневой папке синхронизации.")
        entry = self._entry({**item, "trashed": False})
        self._same(entry, {"name": "ZeTer OS", "mimeType": FOLDER_MIME, "appProperties": {**NAMESPACE, "kind": "root"}})
        return item["trashed"]

    def recreate_root(self, payload):
        """Reserve a replacement; the caller must persist intent before this call."""
        with self.drive.transaction():
            if not isinstance(payload, dict) or set(payload) != {"expectedGeneration", "oldRootFolderId"}:
                raise DriveError("Некорректный запрос новой папки синхронизации.")
            expected, old_root = generation(payload["expectedGeneration"]), self.drive._id(payload["oldRootFolderId"])
            current = self.sync_head()
            if current["generation"] != expected or current.get("missingRootFolderId") != old_root:
                return {"ok": True, "conflict": True, **{key: current[key] for key in ("accountKey", "head", "generation")}}
            proposal = {key: self.allocate_id()["id"] for key in sorted(BOOTSTRAP_FIELDS)}
            session = self._session()
            if session["accountKey"] != current["accountKey"]:
                raise DriveError("Аккаунт синхронизации изменился.")
            request = {"expectedGeneration": expected, "oldRootFolderId": old_root, "bootstrap": self._bootstrap_value(proposal)}
            status, result = self._broker_json("POST", "/sync/recreate", request, session["sessionHandle"])
            if status == 401:
                session = self._session(fresh=True)
                if session["accountKey"] != current["accountKey"]:
                    raise DriveError("Аккаунт синхронизации изменился.")
                status, result = self._broker_json("POST", "/sync/recreate", request, session["sessionHandle"])
            if status not in {200, 409} or result.get("accountKey") != current["accountKey"]:
                raise DriveError("Не удалось закрепить новую папку синхронизации.")
            checked = self._head(result, current["accountKey"])
            if status == 409 and result.get("error") == "sync-conflict":
                return {"ok": True, "conflict": True, **checked}
            if status != 200 or checked["generation"] != expected or checked["head"] != current["head"]:
                raise DriveError("Версия синхронизации изменилась.")
            structure = self._bootstrap_value(result.get("bootstrap"))
            if old_root in structure.values():
                raise DriveError("Новая структура повторяет удалённую папку.")
            return {"ok": True, **checked, "bootstrap": self._check_bootstrap(structure)}

    def allocate_id(self):
        with self.drive.transaction():
            _, value = self.drive._request("GET", API + "/generateIds?count=1&space=drive&type=files")
            if not isinstance(value, dict) or not isinstance(value.get("ids"), list) or len(value["ids"]) != 1:
                raise DriveError("Google Drive не выделил идентификатор файла.")
            return {"ok": True, "id": self.drive._id(value["ids"][0])}

    def _bootstrap_value(self, value):
        if not isinstance(value, dict) or set(value) != BOOTSTRAP_FIELDS:
            raise DriveError("Некорректная структура папок синхронизации.")
        clean = {key: self.drive._id(value[key]) for key in BOOTSTRAP_FIELDS}
        if len(set(clean.values())) != 4:
            raise DriveError("Папки синхронизации имеют одинаковые идентификаторы.")
        return clean

    def _bootstrap_request(self, expected, proposal):
        session = self._session()
        payload = {"expectedGeneration": expected, "bootstrap": proposal}
        status, result = self._broker_json("POST", "/sync/bootstrap", payload, session["sessionHandle"])
        if status == 401:
            session = self._session(fresh=True)
            status, result = self._broker_json("POST", "/sync/bootstrap", payload, session["sessionHandle"])
        checked = self._head(result, session["accountKey"]) if status in {200, 409} else None
        if status == 409 and result.get("error") == "sync-conflict":
            return {"ok": True, "conflict": True, **checked}
        if status != 200:
            raise DriveError("Не удалось закрепить папки синхронизации. Повторите позже.")
        return {"ok": True, **checked, "bootstrap": self._bootstrap_value(result["bootstrap"]) if result.get("bootstrap") is not None else None}

    def _check_bootstrap(self, value):
        value = self._bootstrap_value(value)
        for kind, item_name in CANONICAL_FOLDER_NAMES.items():
            key = kind + "FolderId"
            existing = self._existing(value[key])
            if existing:
                metadata = {"name": item_name, "mimeType": FOLDER_MIME, "appProperties": {**NAMESPACE, "kind": kind}}
                if kind != "root":
                    metadata["parents"] = [value["rootFolderId"]]
                self._same(existing[0], metadata)
        return value

    def bootstrap(self, payload):
        """Reserve IDs before any Drive POST. Listing is discovery, never retry identity."""
        with self.drive.transaction():
            if not isinstance(payload, dict) or set(payload) != {"expectedGeneration"}:
                raise DriveError("Некорректный запрос папок синхронизации.")
            expected = generation(payload["expectedGeneration"])
            current = self._bootstrap_request(expected, None)
            if current.get("conflict"):
                return current
            if current["bootstrap"]:
                current["bootstrap"] = self._check_bootstrap(current["bootstrap"])
                return current
            root_id = current["head"]["rootFolderId"] if current["head"] else None
            if root_id:
                self._same(self._parent(root_id), {"name": "ZeTer OS", "mimeType": FOLDER_MIME, "appProperties": {**NAMESPACE, "kind": "root"}})
            else:
                entries, token = self._query(self._owned_query() + " and 'root' in parents and mimeType='" + FOLDER_MIME + "' and appProperties has { key='kind' and value='root' }")
                if token:
                    raise DriveError("Слишком много корневых папок синхронизации.")
                roots = [entry for entry in entries if entry["kind"] == "root" and entry["name"] == "ZeTer OS" and entry["mimeType"] == FOLDER_MIME]
                root_id = min(roots, key=lambda entry: (entry["createdAt"], entry["id"]))["id"] if roots else None
            proposal = {"rootFolderId": root_id or self.allocate_id()["id"]}
            for kind in ("data", "history", "staging"):
                entries, token = self._query(self._owned_query() + " and '" + root_id + "' in parents") if root_id else ([], None)
                if token:
                    raise DriveError("Слишком много папок синхронизации.")
                matches = [entry for entry in entries if entry["kind"] == kind and entry["name"] == CANONICAL_FOLDER_NAMES[kind] and entry["mimeType"] == FOLDER_MIME and entry["parents"] == [root_id]]
                if len(matches) > 1:
                    raise DriveError("Найдено несколько подходящих папок синхронизации.")
                proposal[kind + "FolderId"] = matches[0]["id"] if matches else self.allocate_id()["id"]
            result = self._bootstrap_request(expected, proposal)
            if not result.get("conflict"):
                result["bootstrap"] = self._check_bootstrap(result["bootstrap"])
            return result

    def directory_id(self, payload):
        with self.drive.transaction():
            if not isinstance(payload, dict) or set(payload) != {"expectedGeneration", "rootFolderId", "parentId", "name", "pathKey", "operationId"}:
                raise DriveError("Некорректный запрос каталога синхронизации.")
            clean = {"expectedGeneration": generation(payload["expectedGeneration"]),
                     "rootFolderId": self.drive._id(payload["rootFolderId"]), "parentId": self.drive._id(payload["parentId"]),
                     "name": name(payload["name"]), "pathKey": digest(payload["pathKey"]), "operationId": operation(payload["operationId"])}
            root, current = self._parent(clean["rootFolderId"]), self._parent(clean["parentId"])
            if root["kind"] != "root":
                raise DriveError("Некорректный корень каталога синхронизации.")
            seen = set()
            for _ in range(64):
                if current["id"] == root["id"]:
                    break
                if current["id"] in seen or not current["parents"]:
                    raise DriveError("Родитель каталога находится вне корня синхронизации.")
                seen.add(current["id"])
                current = self._parent(current["parents"][0])
            else:
                raise DriveError("Слишком глубокий каталог синхронизации.")
            session = self._session()
            def reserve(identifier):
                nonlocal session
                body = {**clean, "id": identifier}
                status, result = self._broker_json("POST", "/sync/directory", body, session["sessionHandle"])
                if status == 401:
                    session = self._session(fresh=True)
                    status, result = self._broker_json("POST", "/sync/directory", body, session["sessionHandle"])
                if status == 409 and result.get("error") == "sync-conflict":
                    return {"ok": True, "conflict": True, **self._head(result, session["accountKey"])}
                if status != 200 or result.get("accountKey") != session["accountKey"]:
                    raise DriveError("Не удалось закрепить каталог синхронизации.")
                return {"ok": True, "id": self.drive._id(result["id"]) if result.get("id") is not None else None}
            result = reserve(None)
            if not result.get("conflict") and not result["id"]:
                entries, token = self._query(self._owned_query() + " and '" + clean["parentId"] + "' in parents")
                matches = [entry for entry in entries if entry["name"] == clean["name"] and entry["kind"] == "directory" and entry["mimeType"] == FOLDER_MIME and entry["parents"] == [clean["parentId"]] and entry.get("pathKey") == clean["pathKey"]]
                if token or len(matches) > 1:
                    raise DriveError("Найдено несколько подходящих каталогов синхронизации.")
                result = reserve(matches[0]["id"] if matches else self.allocate_id()["id"])
            if not result.get("conflict"):
                existing = self._existing(result["id"])
                if existing:
                    self._same(existing[0], {"name": clean["name"], "mimeType": FOLDER_MIME, "parents": [clean["parentId"]], "appProperties": {**NAMESPACE, "kind": "directory", "pathKey": clean["pathKey"]}})
            return result

    def sync_commit(self, payload):
        with self.drive.transaction():
            candidate = payload.get("candidate")
            if not isinstance(candidate, dict) or set(candidate) != {"snapshotId", "manifestFileId", "manifestSha256", "contentHash"}:
                raise DriveError("Некорректный снимок синхронизации.")
            clean = {"expectedGeneration": generation(payload.get("expectedGeneration")),
                     "operationId": operation(payload.get("operationId")),
                     "rootFolderId": self.drive._id(payload.get("rootFolderId")), "candidate": {
                         "snapshotId": self.drive._id(candidate.get("snapshotId")),
                         "manifestFileId": self.drive._id(candidate.get("manifestFileId")),
                         "manifestSha256": digest(candidate.get("manifestSha256")), "contentHash": digest(candidate.get("contentHash"))}}
            # Both referenced cloud objects must belong to this namespace before
            # asking the account-bound server for the conditional publication.
            root = self._parent(clean["rootFolderId"])
            manifest, _ = self._get(clean["candidate"]["manifestFileId"])
            if (root["kind"] != "root" or manifest["kind"] != "snapshot" or manifest["mimeType"] == FOLDER_MIME
                    or manifest.get("sha256") != clean["candidate"]["manifestSha256"]):
                raise DriveError("Снимок не принадлежит указанной синхронизации.")
            current, seen = manifest, {manifest["id"]}
            for _ in range(32):
                parents = current["parents"]
                if root["id"] in parents:
                    break
                if not parents or parents[0] in seen:
                    raise DriveError("Манифест находится вне папки синхронизации.")
                seen.add(parents[0])
                current = self._parent(parents[0])
            else:
                raise DriveError("Слишком глубокая папка снимка синхронизации.")
            self._read(manifest, clean["candidate"]["manifestSha256"], manifest["sizeBytes"])
            return self._head_request("POST", "/sync/commit", clean)
