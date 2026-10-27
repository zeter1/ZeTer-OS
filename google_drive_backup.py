"""Personal Drive transport. No import I/O, exported credentials or external-file reads."""
from __future__ import annotations

import base64
import contextlib
import ctypes
import hashlib
import io
import json
import math
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from app_updater import WindowsMutex
from problem_logs import plain_path
from security_backup import MAX_BYTES

SCOPE = "https://www.googleapis.com/auth/drive.file"
API = "https://www.googleapis.com/drive/v3/files"
UPLOAD = "https://www.googleapis.com/upload/drive/v3/files"
TOKEN = "https://oauth2.googleapis.com/token"
# Explicitly approved server boundary; never forward tokens to a changed config host.
NATIVE_BROKER = "https://zeter-os-sync.zeter11.workers.dev"
NATIVE_TOKEN = NATIVE_BROKER + "/native/token"
BROKER_USER_AGENT = "ZeTerOS-Native/1.0"
OWNER = "zeter-os-backup"
FIELDS = "id,name,createdTime,size,md5Checksum,appProperties,parents,mimeType,trashed"
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,160}")
CLIENT = re.compile(r"[A-Za-z0-9_-]+\.apps\.googleusercontent\.com")


class DriveError(RuntimeError):
    """Only deliberately safe messages may cross the native bridge."""

    def __init__(self, message, *, status=None, reason=None, location=None):
        super().__init__(message)
        self.status = status if type(status) is int and 100 <= status <= 599 else None
        self.reason = reason if reason in GOOGLE_ERROR_REASONS else "other"
        self.location = location if location in {"fileId", "parents", "fields", "q"} else "other"


GOOGLE_ERROR_REASONS = frozenset({
    "insufficientFilePermissions", "storageQuotaExceeded", "appNotAuthorizedToFile",
    "userRateLimitExceeded", "rateLimitExceeded", "fileNotFound", "notFound",
    "invalid", "invalidArgument", "badRequest", "forbidden", "conflict",
    "insufficientPermissions", "quotaExceeded", "dailyLimitExceeded",
    "activeItemCreationLimitExceeded", "teamDriveFileLimitExceeded",
    "teamDriveHierarchyTooDeep", "cannotCopyFile", "sharingRateLimitExceeded",
    "authError", "other"
})


class HttpFailure(Exception):
    def __init__(self, status, reason="other", location=None):
        self.status = status
        self.reason = reason if reason in GOOGLE_ERROR_REASONS else "other"
        self.location = location if location in {"fileId", "parents", "fields", "q"} else "other"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_request(method, url, headers, body, limit):
    """Fixed HTTPS Google hosts; bearer credentials never follow redirects."""
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in {"www.googleapis.com", "oauth2.googleapis.com"}
            or parsed.username or parsed.password or parsed.port not in {None, 443} or parsed.fragment):
        raise DriveError("Недопустимый адрес Google Drive.")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
            raw = response.read(limit + 1)
            if len(raw) > limit:
                raise DriveError("Ответ Google Drive превышает допустимый размер.")
            return response.status, dict(response.headers), raw
    except urllib.error.HTTPError as exc:
        status, reason, location = exc.code, "other", "other"
        try:
            # The raw Google response is NEVER logged or returned. Accept only a
            # fixed, non-identifying provider reason after a bounded read.
            details = json.loads(exc.read(8192))
            value = details.get("error", {})
            if isinstance(value, dict):
                candidates = value.get("errors") or []
                if isinstance(candidates, list):
                    for detail in candidates[:3]:
                        candidate = detail.get("reason") if isinstance(detail, dict) else None
                        if candidate in GOOGLE_ERROR_REASONS:
                            reason = candidate
                            field = detail.get("location")
                            if field in {"fileId", "parents", "fields", "q"}:
                                location = field
                            break
                if reason == "other" and value.get("status") in GOOGLE_ERROR_REASONS:
                    reason = value["status"]
        except (ValueError, TypeError, AttributeError, UnicodeError):
            pass
        finally:
            exc.close()
        raise HttpFailure(status, reason, location) from None
    except (OSError, urllib.error.URLError, TimeoutError):
        raise DriveError("Нет соединения с Google Drive. Проверьте интернет и повторите действие.") from None


def native_token_request(method, url, headers, body, limit):
    """Approved Desktop token exchange only; redirects never receive credentials."""
    if method != "POST" or url != NATIVE_TOKEN:
        raise DriveError("Недопустимый сервер подключения Google Drive.")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    request.add_header("User-Agent", BROKER_USER_AGENT)
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    except (OSError, urllib.error.URLError, TimeoutError):
        raise DriveError("Нет соединения с сервером подключения Google Drive. Повторите позже.") from None
    with response:
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise DriveError("Ответ сервера подключения Google Drive слишком большой.")
        return response.status, {}, raw


def dpapi(raw, decrypt=False):
    """Current Windows user, UI forbidden; no machine-wide or plaintext fallback."""
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    try:
        crypt = ctypes.WinDLL("crypt32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        if decrypt:
            success = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
        else:
            success = crypt.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
        if not success:
            raise DriveError("Защищённое подключение недоступно для текущего пользователя Windows.")
        try:
            return ctypes.string_at(target.data, target.size)
        finally:
            kernel.LocalFree(target.data)
    except (AttributeError, OSError):
        raise DriveError("Защищённое подключение Google Drive требует Windows.") from None


def safe_name(name):
    if not isinstance(name, str):
        raise DriveError("Некорректное имя ZIP-копии.")
    name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', "_", name).strip(" .")[:180]
    if not name.lower().endswith(".zip"):
        raise DriveError("Нужен ZIP-архив ZeTer OS.")
    if re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", name, re.I):
        name = "ZeTer_" + name
    return name


class GoogleDriveBackup:
    def __init__(self, api, host, http=http_request, protector=dpapi, browser=None, credentials_root=None,
                 token_http=native_token_request):
        self.api, self.host, self.http, self.protector = api, host, http, protector
        self.token_http = token_http
        self.browser = browser or api._platform_opener.open_url
        self.lock = threading.RLock()
        self.cancel = threading.Event()
        # The connection belongs to the Windows user, shared intentionally by local installs.
        local = os.environ.get("LOCALAPPDATA")
        self.credentials_root = Path(credentials_root) if credentials_root is not None else (
            Path(local) / "ZeTer OS" / "google-drive" if local else None)

    def _path(self):
        root = self.credentials_root
        if root is None or not root.is_absolute():
            raise DriveError("Недоступна личная папка подключения Windows.")
        path = root / "auth.dpapi"
        if not plain_path(root, path):
            raise DriveError("Небезопасный путь служебного подключения.")
        return path

    @contextlib.contextmanager
    def transaction(self):
        with self.lock:
            self._path()
            self.credentials_root.mkdir(parents=True, exist_ok=True)
            self._path()
            with WindowsMutex(self.credentials_root, "google-drive-backup"):
                yield

    def _client(self):
        path = self.host.APP_DIR / "google-drive-config.json"
        try:
            if not plain_path(self.host.APP_DIR, path) or path.stat().st_size > 8192:
                return ""
            value = json.loads(path.read_text(encoding="utf-8-sig"))
            client = value.get("desktopClientId", "") if isinstance(value, dict) else ""
            return client if isinstance(client, str) and CLIENT.fullmatch(client) else ""
        except (OSError, ValueError):
            return ""

    def _token_broker(self):
        path = self.host.APP_DIR / "google-drive-config.json"
        try:
            if not plain_path(self.host.APP_DIR, path) or path.stat().st_size > 8192:
                return ""
            value = json.loads(path.read_text(encoding="utf-8-sig"))
            return NATIVE_TOKEN if isinstance(value, dict) and value.get("brokerUrl") == NATIVE_BROKER else ""
        except (OSError, ValueError):
            return ""

    def _validate_auth(self, auth):
        if not isinstance(auth, dict) or set(auth) != {"clientId", "accessToken", "refreshToken", "expiresAt", "needsReconnect"}:
            raise DriveError("Подключение повреждено. Отключите Google Drive и подключитесь снова.")
        if (not CLIENT.fullmatch(str(auth["clientId"])) or not all(isinstance(auth[k], str) and 0 < len(auth[k]) <= 8192
                for k in ("accessToken", "refreshToken")) or type(auth["expiresAt"]) not in (int, float)
                or not 0 < auth["expiresAt"] < 1e12 or type(auth["needsReconnect"]) is not bool):
            raise DriveError("Подключение повреждено. Подключитесь снова.")
        return auth

    def _auth(self):
        path = self._path()
        if not path.exists():
            return None
        try:
            if path.stat().st_size > 65536:
                raise ValueError()
            return self._validate_auth(json.loads(self.protector(path.read_bytes(), True)))
        except Exception:
            raise DriveError("Подключение недоступно. Отключите Google Drive и подключитесь снова.") from None

    def _save(self, auth):
        raw = json.dumps(self._validate_auth(auth), allow_nan=False).encode("utf-8")
        protected = self.protector(raw)
        if self.protector(protected, True) != raw:
            raise DriveError("Не удалось проверить защищённое подключение.")
        self.host.atomic_write_bytes(self._path(), protected)

    def status(self):
        with self.transaction():
            configured = bool(self._client() and self._token_broker())
            try:
                auth = self._auth()
                connected = bool(configured and auth and auth["clientId"] == self._client() and not auth["needsReconnect"])
                reconnect = bool(auth and not connected)
            except DriveError:
                connected, reconnect = False, True
            return {"ok": True, "configured": configured, "connected": connected, "needsReconnect": reconnect}

    def disconnect(self):
        # Cancels the loopback waiter before acquiring the operation lock.
        self.cancel.set()
        with self.transaction():
            self._path().unlink(missing_ok=True)
            broker = self._path().with_name("broker-session.dpapi")
            if not plain_path(self.credentials_root, broker):
                raise DriveError("Небезопасный путь подключения синхронизации.")
            broker.unlink(missing_ok=True)
            return {"ok": True, "connected": False}

    def _json(self, method, url, body=None, auth=None, headers=None):
        extra = {"Accept": "application/json", **(headers or {})}
        if auth:
            extra["Authorization"] = "Bearer " + auth
        if body is not None:
            extra.setdefault("Content-Type", "application/json")
            body = json.dumps(body, allow_nan=False).encode("utf-8")
        status, response_headers, raw = self.http(method, url, extra, body, 2 * 1024 * 1024)
        try:
            return response_headers, json.loads(raw) if raw else {}
        except (ValueError, UnicodeError):
            raise DriveError("Google Drive вернул некорректный ответ.") from None

    def _tokens(self, form, previous=None):
        endpoint = self._token_broker()
        if not endpoint or form.get("client_id") != self._client():
            raise DriveError("Google Drive ещё не настроен в этой версии ZeTer OS.")
        fields = ("grant_type", "code", "code_verifier", "redirect_uri") if form.get("grant_type") == "authorization_code" else ("grant_type", "refresh_token")
        payload = {key: form[key] for key in fields}
        try:
            status, _, raw = self.token_http("POST", endpoint, {"Content-Type": "application/json", "Accept": "application/json"},
                                            json.dumps(payload, ensure_ascii=True).encode("ascii"), 32768)
            value = json.loads(raw)
        except (ValueError, UnicodeError, HttpFailure):
            raise DriveError("Сервер подключения Google Drive временно недоступен. Повторите позже.") from None
        if status != 200:
            if status == 401 and isinstance(value, dict) and value.get("error") == "reconnect_required":
                if previous:
                    self._save({**previous, "needsReconnect": True})
                raise DriveError("Google отклонил подключение. Подключитесь снова.")
            raise DriveError("Сервер подключения Google Drive временно недоступен. Повторите позже.")
        try:
            if not isinstance(value, dict) or set(value) - {"access_token", "refresh_token", "expires_in", "token_type", "scope"}:
                raise ValueError()
            if value.get("scope") != SCOPE or value.get("token_type") != "Bearer":
                raise ValueError()
            expiry = value["expires_in"]
            if type(expiry) not in (int, float) or not math.isfinite(expiry) or not 0 < expiry <= 86400:
                raise ValueError()
            if (not isinstance(value.get("access_token"), str) or not 0 < len(value["access_token"]) <= 8192
                    or ("refresh_token" in value and (not isinstance(value["refresh_token"], str) or not 0 < len(value["refresh_token"]) <= 8192))):
                raise ValueError()
            auth = {"clientId": form["client_id"], "accessToken": value["access_token"],
                    "refreshToken": value.get("refresh_token") or (previous or {}).get("refreshToken", ""),
                    "expiresAt": time.time() + expiry, "needsReconnect": False}
            self._save(auth)
            return auth
        except (ValueError, KeyError, TypeError):
            raise DriveError("Google не выдал постоянное подключение. Подключитесь снова.") from None

    def connect(self, timeout=180):
        with self.transaction():
            client = self._client()
            if not client or not self._token_broker():
                raise DriveError("Google Drive ещё не настроен в этой версии ZeTer OS.")
            self.cancel.clear()
            verifier, state = secrets.token_urlsafe(64), secrets.token_urlsafe(32)
            result = {}

            class Callback(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass

                def setup(self):
                    self.request.settimeout(1)
                    super().setup()

                def do_GET(handler):
                    parsed = urllib.parse.urlsplit(handler.path)
                    query = urllib.parse.parse_qs(parsed.query)
                    valid = (parsed.path == "/oauth2callback" and len(handler.path) < 16384
                             and query.get("state") == [state])
                    if valid and "code" in query and len(query["code"]) == 1:
                        result["code"] = query["code"][0]
                    elif valid and "error" in query:
                        result["denied"] = True
                    handler.send_response(200 if valid else 400)
                    handler.send_header("Content-Type", "text/plain; charset=utf-8")
                    handler.send_header("Cache-Control", "no-store")
                    handler.send_header("X-Content-Type-Options", "nosniff")
                    handler.end_headers()
                    handler.wfile.write("Вернитесь в ZeTer OS. Эту вкладку можно закрыть.".encode("utf-8"))

            with HTTPServer(("127.0.0.1", 0), Callback) as server:
                server.timeout = 0.25
                redirect = "http://127.0.0.1:" + str(server.server_port) + "/oauth2callback"
                challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
                self.browser("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
                    "client_id": client, "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
                    "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
                    "access_type": "offline", "prompt": "consent"}))
                deadline = time.monotonic() + min(timeout, 180)
                while not result and time.monotonic() < deadline and not self.cancel.is_set() and not self.api._closing:
                    server.handle_request()
            if self.cancel.is_set() or self.api._closing:
                raise DriveError("Подключение отменено.")
            if "code" not in result:
                raise DriveError("Подключение не завершено. Повторите вход в Google.")
            self._tokens({"client_id": client, "code": result["code"], "code_verifier": verifier,
                          "redirect_uri": redirect, "grant_type": "authorization_code"})
            return self.status()

    def _access(self):
        auth = self._auth()
        if not auth or auth["clientId"] != self._client() or auth["needsReconnect"]:
            raise DriveError("Сначала подключите Google Drive.")
        if auth["expiresAt"] <= time.time() + 60:
            auth = self._tokens({"client_id": auth["clientId"], "refresh_token": auth["refreshToken"],
                                 "grant_type": "refresh_token"}, auth)
        return auth["accessToken"]

    def _request(self, method, url, body=None):
        try:
            return self._json(method, url, body, self._access())
        except HttpFailure as exc:
            if exc.status == 401:
                raise DriveError("Google отклонил подключение. Подключитесь снова.",
                                 status=exc.status, reason=exc.reason, location=exc.location) from None
            raise DriveError("Не удалось выполнить действие в Google Drive. Повторите позже.",
                             status=exc.status, reason=exc.reason, location=exc.location) from None

    def _files(self, query):
        output, page = [], ""
        for _ in range(10):
            params = {"q": query, "spaces": "drive", "pageSize": 100,
                      "fields": "nextPageToken,files(" + FIELDS + ")", "orderBy": "createdTime desc"}
            if page:
                params["pageToken"] = page
            _, response = self._request("GET", API + "?" + urllib.parse.urlencode(params))
            files = response.get("files", [])
            if not isinstance(files, list) or len(files) > 100:
                raise DriveError("Некорректный список Google Drive.")
            output.extend(files)
            page = response.get("nextPageToken", "")
            if not page:
                return output
        raise DriveError("В папке слишком много копий для одного запроса.")

    def _folder(self, create=False):
        folders = self._files("trashed=false and mimeType='application/vnd.google-apps.folder' and appProperties has { key='app' and value='" + OWNER + "' }")
        folders = [item for item in folders if item.get("appProperties", {}).get("app") == OWNER
                   and item.get("mimeType") == "application/vnd.google-apps.folder" and not item.get("trashed")]
        if folders:
            return self._id(folders[-1].get("id"))
        if create:
            _, folder = self._request("POST", API + "?fields=id", {"name": "ZeTer OS — резервные копии",
                "mimeType": "application/vnd.google-apps.folder", "appProperties": {"app": OWNER}})
            return self._id(folder.get("id"))
        return None

    def _id(self, value):
        if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
            raise DriveError("Некорректный идентификатор Google Drive.")
        return value

    def _entry(self, item, folder):
        props = item.get("appProperties", {})
        if (props.get("app") != OWNER or props.get("kind") != "backup-v1" or item.get("trashed")
                or folder not in item.get("parents", []) or item.get("mimeType") != "application/zip"):
            raise DriveError("Файл не принадлежит резервным копиям ZeTer OS.")
        try:
            size = int(item["size"])
            created = int(datetime.fromisoformat(item["createdTime"].replace("Z", "+00:00")).timestamp() * 1000)
        except (ValueError, TypeError, KeyError):
            raise DriveError("Некорректные сведения о копии Google Drive.") from None
        if not 0 < size <= MAX_BYTES or not re.fullmatch(r"[a-f0-9]{64}", props.get("sha256", "")):
            raise DriveError("Некорректные размер или контрольная сумма копии.")
        return {"id": self._id(item.get("id")), "name": safe_name(item.get("name")), "createdAt": created,
                "sizeBytes": size, "sha256": props["sha256"]}

    def zip_preferences(self, payload=None):
        """Separate, DPAPI-protected, per-install ZIP schedule; old sync untouched."""
        with self.transaction():
            fingerprint = hashlib.sha256(os.path.normcase(str(self.host.DATA_DIR.resolve())).encode("utf-8")).hexdigest()
            directory = self.credentials_root / ("installation-" + fingerprint)
            path = directory / "zip-preferences.dpapi"
            if not plain_path(self.credentials_root, path):
                raise DriveError("Небезопасное расположение настроек ZIP.")
            def validate(value):
                if not isinstance(value, dict) or set(value) != {"enabled", "intervalHours", "lastSuccessAt"}:
                    raise DriveError("Некорректные настройки ZIP-копирования.")
                if (type(value["enabled"]) is not bool or type(value["intervalHours"]) is not int
                        or not 1 <= value["intervalHours"] <= 720 or type(value["lastSuccessAt"]) is not int
                        or not 0 <= value["lastSuccessAt"] < 10**15):
                    raise DriveError("Некорректные параметры ZIP-копирования.")
                return value
            if payload is None:
                if not path.exists():
                    return {"ok": True, "value": None}
                try:
                    if path.stat().st_size > 16384:
                        raise ValueError()
                    value = validate(json.loads(self.protector(path.read_bytes(), True)))
                    return {"ok": True, "value": value}
                except Exception:
                    raise DriveError("Настройки ZIP-копирования повреждены; старые настройки сохранены.") from None
            if not isinstance(payload, dict) or set(payload) != {"value"}:
                raise DriveError("Некорректный запрос ZIP-настроек.")
            value = validate(payload["value"])
            raw = json.dumps(value, allow_nan=False).encode("utf-8")
            encrypted = self.protector(raw)
            if self.protector(encrypted, True) != raw:
                raise DriveError("Контрольное чтение ZIP-настроек не удалось.")
            directory.mkdir(parents=True, exist_ok=True)
            if not plain_path(self.credentials_root, path):
                raise DriveError("Каталог ZIP-настроек перенаправлен.")
            self.host.atomic_write_bytes(path, encrypted)
            if validate(json.loads(self.protector(path.read_bytes(), True))) != value:
                raise DriveError("Настройки ZIP не прошли проверку сохранения.")
            return {"ok": True, "value": value}

    def list(self):
        with self.transaction():
            folder = self._folder()
            entries = [] if not folder else [self._entry(item, folder) for item in self._files(
                "trashed=false and '" + folder + "' in parents and appProperties has { key='app' and value='" + OWNER + "' }")]
            return {"ok": True, "entries": entries}

    def _bytes(self, entry):
        try:
            _, _, raw = self.http("GET", API + "/" + entry["id"] + "?alt=media",
                                  {"Authorization": "Bearer " + self._access()}, None, entry["sizeBytes"])
        except HttpFailure:
            raise DriveError("Не удалось скачать копию Google Drive.") from None
        if len(raw) != entry["sizeBytes"] or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise DriveError("Копия Google Drive повреждена: контрольная сумма не совпадает.")
        self.api._security_backup_store()._verify(io.BytesIO(raw))
        return raw

    def download(self, payload):
        with self.transaction():
            identifier = self._id(payload.get("id"))
            folder = self._folder()
            if not folder:
                raise DriveError("Папка резервных копий не найдена.")
            _, item = self._request("GET", API + "/" + identifier + "?" + urllib.parse.urlencode({"fields": FIELDS}))
            entry = self._entry(item, folder)
            raw = self._bytes(entry)
            return {"ok": True, "base64": base64.b64encode(raw).decode("ascii"),
                    "name": entry["name"], "sizeBytes": len(raw)}

    def upload(self, payload):
        with self.transaction():
            operation = payload.get("operationId")
            if not isinstance(operation, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,120}", operation):
                raise DriveError("Нужен идентификатор операции резервного копирования.")
            encoded = payload.get("base64")
            if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_BYTES + 2) // 3):
                raise DriveError("ZIP превышает допустимый размер 120 МиБ.")
            try:
                raw = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise DriveError("Некорректный ZIP-архив.") from None
            if not 0 < len(raw) <= MAX_BYTES:
                raise DriveError("ZIP превышает допустимый размер 120 МиБ.")
            self.api._security_backup_store()._verify(io.BytesIO(raw))
            name, digest = safe_name(payload.get("name")), hashlib.sha256(raw).hexdigest()
            folder = self._folder(create=True)
            existing = self._files("trashed=false and '" + folder + "' in parents and appProperties has { key='operationId' and value='" + operation + "' }")
            if existing:
                if len(existing) != 1:
                    raise DriveError("У операции найдено несколько копий. Новая загрузка остановлена.")
                entry = self._entry(existing[0], folder)
                if entry["sha256"] != digest or entry["sizeBytes"] != len(raw):
                    raise DriveError("Идентификатор операции уже связан с другой копией.")
                self._bytes(entry)
                return {"ok": True, "entry": entry}
            metadata = {"name": name, "mimeType": "application/zip", "parents": [folder],
                        "appProperties": {"app": OWNER, "kind": "backup-v1", "sha256": digest, "operationId": operation}}
            # Allocate one stable server ID before any ambiguous upload. The encrypted
            # local record survives restart; retries cannot allocate a second cloud copy.
            operations_path = self._path().with_name("upload-operations.dpapi")
            if not plain_path(self.credentials_root, operations_path):
                raise DriveError("Небезопасный путь журнала загрузки.")
            operations = {}
            if operations_path.exists():
                if operations_path.stat().st_size > 1024 * 1024:
                    raise DriveError("Журнал загрузки слишком велик.")
                try:
                    operations = json.loads(self.protector(operations_path.read_bytes(), True))
                    if not isinstance(operations, dict):
                        raise ValueError()
                except Exception:
                    raise DriveError("Не удалось проверить журнал загрузки. Новая копия не создана.") from None
            key = hashlib.sha256((self._client() + ":" + folder + ":" + operation).encode()).hexdigest()
            pending = operations.get(key)
            if pending:
                if not isinstance(pending, dict) or pending.get("sha256") != digest:
                    raise DriveError("Операция уже связана с другой копией.")
                identifier = self._id(pending.get("id"))
                try:
                    _, item = self._json("GET", API + "/" + identifier + "?" + urllib.parse.urlencode({"fields": FIELDS}), auth=self._access())
                except HttpFailure as exc:
                    if exc.status != 404:
                        raise DriveError("Не удалось проверить прежнюю загрузку. Повторите позже.") from None
                else:
                    entry = self._entry(item, folder)
                    if entry["sha256"] != digest or entry["sizeBytes"] != len(raw):
                        raise DriveError("Прежняя загрузка не прошла проверку.")
                    self._bytes(entry)
                    return {"ok": True, "entry": entry}
            else:
                if len(operations) >= 2000:
                    raise DriveError("Журнал загрузок заполнен. Новая загрузка остановлена.")
                _, allocated = self._request("GET", API + "/generateIds?count=1&space=drive&type=files")
                identifier = self._id(allocated.get("ids", [None])[0])
                operations[key] = {"id": identifier, "sha256": digest}
                saved = json.dumps(operations, allow_nan=False).encode()
                protected = self.protector(saved)
                if self.protector(protected, True) != saved:
                    raise DriveError("Не удалось проверить журнал загрузки.")
                self.host.atomic_write_bytes(operations_path, protected)
            metadata["id"] = identifier
            try:
                headers, _ = self._json("POST", UPLOAD + "?uploadType=resumable&fields=" + urllib.parse.quote(FIELDS),
                    metadata, self._access(), {"X-Upload-Content-Type": "application/zip", "X-Upload-Content-Length": str(len(raw))})
                location = next((value for key, value in headers.items() if key.lower() == "location"), "")
                parsed = urllib.parse.urlsplit(location)
                if (parsed.scheme != "https" or parsed.netloc != "www.googleapis.com" or
                        parsed.path != "/upload/drive/v3/files" or parsed.fragment):
                    raise DriveError("Google вернул недопустимый адрес загрузки.")
                _, _, response = self.http("PUT", location, {"Authorization": "Bearer " + self._access(),
                    "Content-Type": "application/zip", "Content-Length": str(len(raw))}, raw, 2 * 1024 * 1024)
                uploaded = json.loads(response)
            except HttpFailure:
                raise DriveError("Загрузка не подтверждена. Повторите с тем же идентификатором операции.") from None
            except (ValueError, TypeError):
                raise DriveError("Загрузка не подтверждена. Повторите с тем же идентификатором операции.") from None
            # Fetch canonical metadata independently of the upload response.
            identifier = self._id(uploaded.get("id"))
            _, item = self._request("GET", API + "/" + identifier + "?" + urllib.parse.urlencode({"fields": FIELDS}))
            entry = self._entry(item, folder)
            if (entry["sizeBytes"] != len(raw) or entry["sha256"] != digest
                    or item.get("md5Checksum") != hashlib.md5(raw, usedforsecurity=False).hexdigest()):
                raise DriveError("Загрузка не прошла проверку размера и контрольной суммы.")
            self._bytes(entry)
            return {"ok": True, "entry": entry}
