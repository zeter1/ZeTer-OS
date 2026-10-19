"""Bounded native security vault and detached, recoverable payload restoration.

The launcher supplies current data paths at call time. No import/constructor I/O.
Vault configuration is private local metadata, never part of the exported state.
"""
from __future__ import annotations

import base64
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import stat
import tempfile
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from app_updater import WindowsMutex
from problem_logs import plain_path

MAX_BYTES = 120 * 1024 * 1024
MAX_STATE_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 1200
MAX_METADATA_BYTES = 2 * 1024 * 1024
STATE_NAME = "zeter-os-state.json"
MANIFEST_NAME = "zeter-backup-manifest.json"
CONFIG_OWNER = "zeter-security-backup-config-v1"
INDEX_OWNER = "zeter-security-backup-index-v1"
LEASE_OWNER = "zeter-security-restore-leases-v1"
IDENTIFIER = re.compile(r"[a-f0-9]{32}")
DIGEST = re.compile(r"[a-f0-9]{64}")


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def _json(raw):
    def pairs(items):
        value = {}
        for key, child in items:
            if key in value:
                raise ValueError("Повторяющееся поле JSON.")
            value[key] = child
        return value
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Некорректное число JSON.")))


def _safe_name(name):
    if not isinstance(name, str) or not name or len(name) > 1024 or "\\" in name:
        raise ValueError("Небезопасный путь в бэкапе.")
    for part in name.split("/"):
        if (not part or part in {".", ".."} or part.endswith((" ", "."))
                or re.search(r'[\x00-\x1f<>:"|?*]', part)
                or re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", part, re.I)):
            raise ValueError("Небезопасный путь в бэкапе.")
    return unicodedata.normalize("NFC", name).casefold()


def _hash_file(path, limit=MAX_BYTES):
    size = 0
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ValueError("Бэкап превышает допустимый размер 120 МиБ.")
            digest.update(chunk)
    return size, digest.hexdigest()


def _checked(root, target):
    if not plain_path(root, target):
        raise ValueError("Ссылки, junction и перенаправления папок запрещены.")
    return target


def _identity(path):
    info = path.stat()
    return [info.st_dev, info.st_ino]


class SecurityBackupStore:
    def __init__(self, api, host):
        self.api, self.host = api, host

    @property
    def data(self):
        return self.host.DATA_DIR

    @contextlib.contextmanager
    def transaction(self):
        with self.api._state_save_lock:
            _checked(self.data, self.data)
            with WindowsMutex(self.data, "security-backups"):
                yield

    def _read_metadata(self, path, validator, default=None):
        _checked(path.parent, path)
        if not path.exists() and not path.with_suffix(path.suffix + ".previous").exists():
            return default
        failures = []
        for candidate in (path, path.with_suffix(path.suffix + ".previous")):
            try:
                _checked(path.parent, candidate)
                if candidate.stat().st_size > MAX_METADATA_BYTES:
                    raise ValueError("Служебный файл превышает безопасный размер.")
                value = _json(candidate.read_bytes())
                validator(value)
                return value
            except (OSError, ValueError, TypeError, KeyError) as exc:
                failures.append(type(exc).__name__)
        raise ValueError("Служебные данные повреждены; файлы сохранены, очистка остановлена.")

    def _atomic(self, path, value, validator, recovery=True):
        raw = _json_bytes(value)
        if len(raw) > MAX_METADATA_BYTES:
            raise ValueError("Превышен размер служебного файла.")
        validator(_json(raw))
        _checked(path.parent, path)
        parent_identity = _identity(path.parent)
        previous = path.with_suffix(path.suffix + ".previous")
        if recovery and path.exists():
            old = self._read_metadata(path, validator)
            self._atomic(previous, old, validator, recovery=False)
        descriptor, name = tempfile.mkstemp(prefix=".zeter-security-", suffix=".tmp", dir=path.parent)
        temp = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            if temp.read_bytes() != raw:
                raise OSError("Служебный файл не прошёл проверку чтением.")
            validator(_json(temp.read_bytes()))
            _checked(path.parent, path)
            _checked(path.parent, temp)
            if _identity(path.parent) != parent_identity:
                raise ValueError("Папка служебного файла была заменена во время записи.")
            os.replace(temp, path)
        finally:
            if plain_path(path.parent, temp):
                temp.unlink(missing_ok=True)

    def _config_path(self):
        return _checked(self.data, self.data / "security-backups.json")

    def _default_config(self):
        return {"owner": CONFIG_OWNER, "folder": "", "folderIdentity": [], "vaultId": "",
                "enabled": False, "intervalHours": 24, "maxCopies": 14,
                "maxBytes": 2 * 1024**3, "lastError": "", "lastSuccessAt": 0}

    def _validate_config(self, value):
        if not isinstance(value, dict) or set(value) != set(self._default_config()) or value.get("owner") != CONFIG_OWNER:
            raise ValueError("Неизвестный формат конфигурации бэкапов.")
        if (type(value["enabled"]) is not bool or not isinstance(value["folder"], str)
                or not isinstance(value["lastError"], str) or len(value["lastError"]) > 500
                or type(value["lastSuccessAt"]) is not int or value["lastSuccessAt"] < 0):
            raise ValueError("Некорректная конфигурация бэкапов.")
        for key, lower, upper in (("intervalHours", 1, 720), ("maxCopies", 2, 100), ("maxBytes", 64 * 1024**2, 20 * 1024**3)):
            if type(value[key]) is not int or not lower <= value[key] <= upper:
                raise ValueError("Параметры бэкапов вне допустимых границ.")
        if value["folder"]:
            if (not Path(value["folder"]).is_absolute() or not IDENTIFIER.fullmatch(value["vaultId"])
                    or not isinstance(value["folderIdentity"], list) or len(value["folderIdentity"]) != 2
                    or any(type(number) is not int for number in value["folderIdentity"])):
                raise ValueError("Некорректная папка бэкапов.")
        elif value["enabled"] or value["vaultId"] or value["folderIdentity"]:
            raise ValueError("Папка бэкапов ещё не выбрана.")

    def _config(self):
        return self._read_metadata(self._config_path(), self._validate_config, self._default_config())

    def _root(self, config):
        if not config["folder"]:
            raise ValueError("Сначала выберите папку бэкапов.")
        root = Path(config["folder"])
        _checked(root, root)
        if not root.is_dir() or _identity(root) != config["folderIdentity"]:
            raise ValueError("Папка бэкапов недоступна или была заменена. Выберите её заново.")
        return root

    def _validate_index(self, value):
        if (not isinstance(value, dict) or set(value) != {"owner", "vaultId", "entries"}
                or value["owner"] != INDEX_OWNER or not IDENTIFIER.fullmatch(str(value["vaultId"]))
                or not isinstance(value["entries"], list) or len(value["entries"]) > 101):
            raise ValueError("Неизвестный индекс бэкапов.")
        ids = set()
        for entry in value["entries"]:
            if (not isinstance(entry, dict) or set(entry) - {"pendingDelete"} != {"id", "name", "createdAt", "sizeBytes", "sha256", "pinned", "verified"}
                    or not IDENTIFIER.fullmatch(str(entry.get("id"))) or entry["id"] in ids
                    or entry["name"] != "zeter-vault-" + entry["id"] + ".zip"
                    or type(entry["createdAt"]) is not int or entry["createdAt"] < 0
                    or type(entry["sizeBytes"]) is not int or not 0 < entry["sizeBytes"] <= MAX_BYTES
                    or not DIGEST.fullmatch(str(entry["sha256"]))
                    or type(entry["pinned"]) is not bool or entry["verified"] is not True
                    or ("pendingDelete" in entry and type(entry["pendingDelete"]) is not bool)):
                raise ValueError("Повреждённая запись индекса бэкапов.")
            ids.add(entry["id"])

    def _index(self, config):
        root = self._root(config)
        value = self._read_metadata(root / ".zeter-backup-index.json", self._validate_index)
        if not value or value["vaultId"] != config["vaultId"]:
            raise ValueError("Индекс выбранной папки не принадлежит этому хранилищу.")
        return value

    def _status(self, config=None):
        config = config or self._config()
        entries = self._index(config)["entries"] if config["folder"] else []
        return {"ok": True, "configured": bool(config["folder"]), **{key: config[key] for key in
                ("folder", "enabled", "intervalHours", "maxCopies", "maxBytes", "lastError", "lastSuccessAt")},
                "entries": sorted(entries, key=lambda entry: (entry["createdAt"], entry["id"]), reverse=True),
                "locationKind": "same-volume" if config["folder"] and Path(config["folder"]).anchor.casefold() == self.data.anchor.casefold() else "separate-volume" if config["folder"] else "unconfigured"}

    def status(self):
        with self.transaction():
            return self._status()

    def configure(self, payload):
        if not isinstance(payload, dict) or set(payload) - {"enabled", "intervalHours", "maxCopies", "maxBytes", "chooseFolder"}:
            raise ValueError("Неизвестные настройки бэкапов; пути из интерфейса не принимаются.")
        with self.transaction():
            config = self._config()
            if "chooseFolder" in payload and type(payload["chooseFolder"]) is not bool:
                raise ValueError("Некорректный запрос выбора папки.")
            if payload.get("chooseFolder"):
                selected = self.api._choose_security_backup_folder()
                if selected is None:
                    return {**self._status(config), "cancelled": True}
                selected = Path(selected).absolute()
                _checked(selected, selected)
                if not selected.is_dir() or selected.resolve().is_relative_to(self.data.resolve()):
                    raise ValueError("Выберите существующую папку вне служебной data.")
                root = _checked(selected, selected / "ZeTer OS backups")
                root.mkdir(exist_ok=True)
                _checked(selected, root)
                index = self._read_metadata(root / ".zeter-backup-index.json", self._validate_index)
                if index is None:
                    if any(root.iterdir()):
                        raise ValueError("Папка ZeTer OS backups содержит неизвестные файлы. Выберите другую папку.")
                    index = {"owner": INDEX_OWNER, "vaultId": uuid.uuid4().hex, "entries": []}
                    self._atomic(root / ".zeter-backup-index.json", index, self._validate_index)
                config.update(folder=str(root), folderIdentity=_identity(root), vaultId=index["vaultId"])
            config.update({key: value for key, value in payload.items() if key != "chooseFolder"})
            self._validate_config(config)
            if config["folder"]:
                self._index(config)
            self._atomic(self._config_path(), config, self._validate_config)
            return self._status(config)

    def _references(self, state):
        def visit(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key in {"managedPath", "assetPath"}:
                        _safe_name(value)
                        resolver = self.host.managed_file_path if key == "managedPath" else self.host.item_asset_path
                        target = resolver(value)
                        _checked(self.data, self.data / value)
                        if target.relative_to(self.data.resolve()).as_posix() != value:
                            raise ValueError("Ненормализованный путь payload запрещён.")
                    else:
                        visit(value)
            elif isinstance(node, list):
                for value in node:
                    visit(value)
        visit(state)
        inspected = self.host.inspect_payload_references(state)
        if inspected["invalidManaged"] or inspected["invalidItemAssets"]:
            raise ValueError("В состоянии есть небезопасные ссылки на файлы.")
        return {**{value: "managedPath" for value in inspected["managed"].values()},
                **{value: "assetPath" for value in inspected["itemAssets"].values()}}

    def _record(self, record):
        if isinstance(record, str):
            if len(record) > MAX_STATE_BYTES:
                raise ValueError("JSON состояния превышает 50 МиБ.")
            record = _json(record.encode("utf-8"))
        raw = _json_bytes(record)
        if len(raw) > MAX_STATE_BYTES:
            raise ValueError("JSON состояния превышает 50 МиБ.")
        record = _json(raw)
        state = record.get("state") if isinstance(record, dict) else None
        if not isinstance(state, dict) or not isinstance(state.get("fs"), dict) or not isinstance(state.get("settings"), dict):
            raise ValueError("В бэкапе нет полного состояния с fs/settings.")
        return record, raw

    def _build(self, record, target):
        record, state_raw = self._record(record)
        refs = self._references(record["state"])
        if len(refs) + 2 > MAX_ENTRIES:
            raise ValueError("В бэкапе больше 1200 файлов.")
        total = len(state_raw)
        files = []
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED, allowZip64=False) as archive:
            archive.writestr(STATE_NAME, state_raw)
            files.append({"path": STATE_NAME, "bytes": len(state_raw), "algorithm": "SHA-256", "value": hashlib.sha256(state_raw).hexdigest()})
            for relative, kind in refs.items():
                resolver = self.host.managed_file_path if kind == "managedPath" else self.host.item_asset_path
                source = resolver(relative, require_file=True)
                _checked(self.data, self.data / relative)
                before = source.stat()
                total += before.st_size
                if total > MAX_BYTES:
                    raise ValueError("Полный бэкап превышает восстанавливаемый лимит 120 МиБ.")
                digest, size = hashlib.sha256(), 0
                name = "data/" + relative
                with source.open("rb") as reader, archive.open(name, "w") as writer:
                    while chunk := reader.read(1024 * 1024):
                        size += len(chunk)
                        if size > before.st_size:
                            raise OSError("Файл изменился во время создания бэкапа.")
                        digest.update(chunk)
                        writer.write(chunk)
                after = source.stat()
                if size != before.st_size or (before.st_dev, before.st_ino, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_mtime_ns):
                    raise OSError("Файл изменился во время создания бэкапа.")
                files.append({"path": name, "bytes": size, "algorithm": "SHA-256", "value": digest.hexdigest()})
            manifest = _json_bytes({"app": "ZeTer OS", "format": "zeter-backup-manifest", "formatVersion": 1,
                                   "createdAt": datetime.now(timezone.utc).isoformat(), "osVersion": record.get("osVersion", ""),
                                   "backupMode": "native-full-payload", "files": files})
            if total + len(manifest) > MAX_BYTES:
                raise ValueError("Полный бэкап превышает восстанавливаемый лимит 120 МиБ.")
            archive.writestr(MANIFEST_NAME, manifest)
        with target.open("r+b") as stream:
            os.fsync(stream.fileno())
        self._verify(target)

    def _verify(self, source):
        size = len(source.getbuffer()) if isinstance(source, io.BytesIO) else source.stat().st_size
        if not 0 < size <= MAX_BYTES:
            raise ValueError("ZIP превышает допустимый размер 120 МиБ.")
        with zipfile.ZipFile(source) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_ENTRIES:
                raise ValueError("В ZIP больше 1200 файлов.")
            names, total = set(), 0
            for info in infos:
                key = _safe_name(info.filename)
                if (key in names or info.is_dir() or info.flag_bits & 9
                        or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
                        or stat.S_IFMT(info.external_attr >> 16) not in {0, stat.S_IFREG}):
                    raise ValueError("ZIP содержит повторяющуюся или неподдерживаемую запись.")
                names.add(key)
                total += info.file_size
                if total > MAX_BYTES or info.compress_size > MAX_BYTES:
                    raise ValueError("ZIP превышает лимит распаковки 120 МиБ.")
            by_name = {info.filename: info for info in infos}
            if STATE_NAME not in by_name or MANIFEST_NAME not in by_name or by_name[STATE_NAME].file_size > MAX_STATE_BYTES or by_name[MANIFEST_NAME].file_size > MAX_METADATA_BYTES:
                raise ValueError("ZIP не содержит ограниченные state/manifest.")
            manifest = _json(archive.read(MANIFEST_NAME))
            if (not isinstance(manifest, dict) or manifest.get("format") != "zeter-backup-manifest"
                    or manifest.get("formatVersion") != 1 or not isinstance(manifest.get("files"), list)):
                raise ValueError("Неподдерживаемый манифест бэкапа.")
            expected = {}
            for entry in manifest["files"]:
                if (not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or entry["path"] in expected
                        or entry["path"] == MANIFEST_NAME or entry.get("algorithm") != "SHA-256"
                        or not DIGEST.fullmatch(str(entry.get("value"))) or type(entry.get("bytes")) is not int
                        or not 0 <= entry["bytes"] <= MAX_BYTES):
                    raise ValueError("Некорректная запись манифеста.")
                expected[entry["path"]] = entry
            if set(expected) != set(by_name) - {MANIFEST_NAME}:
                raise ValueError("Манифест не описывает точный состав ZIP.")
            for name, entry in expected.items():
                if by_name[name].file_size != entry["bytes"]:
                    raise ValueError("Размер файла не совпадает с манифестом.")
                digest = hashlib.sha256()
                with archive.open(name) as reader:
                    while chunk := reader.read(1024 * 1024):
                        digest.update(chunk)
                if digest.hexdigest() != entry["value"]:
                    raise ValueError("Контрольная сумма файла не совпадает с манифестом.")
            record, _ = self._record(_json(archive.read(STATE_NAME)))
            refs = self._references(record["state"])
            if any("data/" + relative not in expected for relative in refs):
                raise ValueError("В ZIP отсутствует связанный файл или оформление. Восстановление остановлено.")
            return record, refs, expected

    def _binary(self, path, name):
        raw = path.read_bytes()
        if len(raw) > MAX_BYTES:
            raise ValueError("ZIP превышает 120 МиБ.")
        return {"ok": True, "name": name, "base64": base64.b64encode(raw).decode("ascii")}

    def build(self, record):
        with self.transaction():
            descriptor, name = tempfile.mkstemp(prefix=".zeter-security-", suffix=".tmp", dir=self.data)
            os.close(descriptor)
            target = Path(name)
            try:
                self._build(record, target)
                return self._binary(target, "ZeTer_OS_full_backup.zip")
            finally:
                if plain_path(self.data, target):
                    target.unlink(missing_ok=True)

    def _entry_path(self, config, entry, verify=True):
        root = self._root(config)
        path = _checked(root, root / entry["name"])
        if verify and _hash_file(path) != (entry["sizeBytes"], entry["sha256"]):
            raise ValueError("Файл хранилища изменён или повреждён; операция остановлена.")
        return path

    def _remember_error(self, config, exc):
        config["lastError"] = str(exc)[:500]
        self._atomic(self._config_path(), config, self._validate_config)

    def create(self, record):
        with self.transaction():
            config = self._config()
            temp = None
            try:
                root, index = self._root(config), self._index(config)
                pending_path = _checked(root, root / ".zeter-backup-pending.json")
                pending = self._read_metadata(pending_path, self._validate_index)
                if pending is not None:
                    if pending["vaultId"] != config["vaultId"] or len(pending["entries"]) != 1:
                        raise ValueError("Неизвестная незавершённая копия; новое создание остановлено.")
                    recovered = pending["entries"][0]
                    recovered_path = self._entry_path(config, recovered, verify=False)
                    if recovered_path.exists():
                        self._entry_path(config, recovered)
                        self._verify(recovered_path)
                        if not any(item["id"] == recovered["id"] for item in index["entries"]):
                            index["entries"].append(recovered)
                            self._atomic(root / ".zeter-backup-index.json", index, self._validate_index)
                    pending_path.unlink()
                # A pending victim was authorised only after a successful newer backup.
                # Retry that exact deletion before allocating another ZIP, so locked files
                # cannot create unlimited unaccounted growth.
                for pending in list(index["entries"]):
                    if pending.get("pendingDelete"):
                        if pending["pinned"]:
                            pending.pop("pendingDelete", None)
                            continue
                        target = self._entry_path(config, pending, verify=False)
                        if target.exists():
                            self._entry_path(config, pending).unlink()
                        index["entries"].remove(pending)
                self._atomic(root / ".zeter-backup-index.json", index, self._validate_index)
                if shutil.disk_usage(root).free < 2 * MAX_BYTES + 16 * 1024**2:
                    raise OSError("Недостаточно свободного места для проверяемого полного бэкапа.")
                descriptor, name = tempfile.mkstemp(prefix=".zeter-security-", suffix=".tmp", dir=root)
                os.close(descriptor)
                temp = Path(name)
                self._build(record, temp)
                size, digest = _hash_file(temp)
                identifier = uuid.uuid4().hex
                entry = {"id": identifier, "name": "zeter-vault-" + identifier + ".zip", "createdAt": self.host.now_ms(),
                         "sizeBytes": size, "sha256": digest, "pinned": False, "verified": True}
                # Missing indexed files are already absent: reconcile only their records.
                # A changed/locked existing file is retained and never overwritten/deleted.
                errors = []
                existing = []
                for previous_entry in index["entries"]:
                    path = self._entry_path(config, previous_entry, verify=False)
                    if path.exists():
                        existing.append(previous_entry)
                    else:
                        errors.append("Недоступна прежняя копия: " + previous_entry["name"])
                index["entries"] = existing
                entries = [*existing, entry]
                # Keep two newest copies (including the last previously verified one), plus every pin.
                ordered = sorted(entries, key=lambda item: (item["createdAt"], item["id"]))
                previous = sorted(index["entries"], key=lambda item: (item["createdAt"], item["id"]))[-1:]
                protected = {entry["id"]} | {item["id"] for item in previous} | {item["id"] for item in entries if item["pinned"]}
                removed = []
                for candidate in ordered if config["enabled"] else []:
                    if len(entries) <= config["maxCopies"] and sum(item["sizeBytes"] for item in entries) <= config["maxBytes"]:
                        break
                    if candidate["id"] not in protected:
                        try:
                            self._entry_path(config, candidate)
                        except (OSError, ValueError) as exc:
                            errors.append(candidate["name"] + ": " + str(exc)[:100])
                            continue
                        entries.remove(candidate)
                        removed.append(candidate)
                if config["enabled"] and (len(entries) > config["maxCopies"] or sum(item["sizeBytes"] for item in entries) > config["maxBytes"]):
                    raise ValueError("Лимит хранилища занят закреплёнными/последними копиями. Увеличьте лимит или снимите закрепление.")
                target = self._entry_path(config, entry, verify=False)
                if target.exists():
                    raise ValueError("Имя нового бэкапа уже занято.")
                self._root(config)
                # This ownership journal precedes publication. A failed index ACK is
                # reconciled before another ZIP can be allocated, including after restart.
                self._atomic(pending_path, {"owner": INDEX_OWNER, "vaultId": config["vaultId"], "entries": [entry]}, self._validate_index, recovery=False)
                os.replace(temp, target)
                temp = None
                self._entry_path(config, entry)
                self._verify(target)
                # Persist ownership before deleting anything. A crash only leaves owned extra copies.
                index["entries"] = [*index["entries"], entry]
                self._atomic(root / ".zeter-backup-index.json", index, self._validate_index)
                pending_path.unlink()
                config.update(lastSuccessAt=entry["createdAt"], lastError="")
                self._atomic(self._config_path(), config, self._validate_config)
                # Publish the retained index BEFORE deleting victims. If this commit fails,
                # all previous files stay intact and the newly verified ZIP remains indexed.
                if removed:
                    retained_index = {**index, "entries": [*entries, *[{**victim, "pendingDelete": True} for victim in removed]]}
                    try:
                        self._atomic(root / ".zeter-backup-index.json", retained_index, self._validate_index)
                    except Exception as exc:
                        errors.append("Очистка отложена: индекс не записан (" + str(exc)[:120] + ")")
                        removed = []
                    else:
                        index = retained_index
                for candidate in removed:
                    try:
                        self._entry_path(config, candidate).unlink()
                        index["entries"] = [item for item in index["entries"] if item["id"] != candidate["id"]]
                    except (OSError, ValueError) as exc:
                        errors.append("Сохранён вне списка: " + candidate["name"] + ": " + str(exc)[:100])
                if removed:
                    try:
                        self._atomic(root / ".zeter-backup-index.json", index, self._validate_index)
                    except Exception as exc:
                        errors.append("Индекс удаления не обновлён: " + str(exc)[:100])
                if errors:
                    config["lastError"] = "Бэкап проверен; обслуживание: " + "; ".join(errors)[:350]
                    try:
                        self._atomic(self._config_path(), config, self._validate_config)
                    except Exception:
                        pass  # The verified ZIP/index ACK already completed; return the warning below.
                return {"ok": True, "entry": entry, "status": self._status(config), "maintenanceWarning": config["lastError"]}
            except Exception as exc:
                try:
                    self._remember_error(config, exc)
                except Exception as metadata_exc:
                    raise RuntimeError(f"{exc} Не удалось сохранить сообщение об ошибке ({type(metadata_exc).__name__}).") from exc
                raise
            finally:
                if temp is not None and plain_path(temp.parent, temp):
                    temp.unlink(missing_ok=True)

    def _find(self, index, payload):
        identifier = payload.get("id") if isinstance(payload, dict) else None
        if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
            raise ValueError("Некорректный ID бэкапа.")
        return next((entry for entry in index["entries"] if entry["id"] == identifier), None)

    def pin(self, payload):
        if not isinstance(payload, dict) or set(payload) != {"id", "pinned"} or type(payload["pinned"]) is not bool:
            raise ValueError("Некорректное закрепление бэкапа.")
        with self.transaction():
            config = self._config()
            index = self._index(config)
            entry = self._find(index, payload)
            if entry is None:
                raise ValueError("Бэкап не найден.")
            self._entry_path(config, entry)
            entry["pinned"] = payload["pinned"]
            if entry["pinned"]:
                entry.pop("pendingDelete", None)
            self._atomic(self._root(config) / ".zeter-backup-index.json", index, self._validate_index)
            return self._status(config)

    def read(self, payload):
        with self.transaction():
            config = self._config()
            entry = self._find(self._index(config), payload)
            if entry is None:
                raise ValueError("Бэкап не найден.")
            path = self._entry_path(config, entry)
            result = self._binary(path, entry["name"])
            raw = base64.b64decode(result["base64"])
            if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                raise ValueError("Файл изменился во время чтения.")
            self._verify(io.BytesIO(raw))
            return result

    def _lease_path(self):
        return _checked(self.data, self.data / "security-restore-leases.json")

    def _validate_leases(self, value):
        if (not isinstance(value, dict) or set(value) != {"owner", "stages"} or value["owner"] != LEASE_OWNER
                or not isinstance(value["stages"], dict) or len(value["stages"]) > 4):
            raise ValueError("Неизвестные recovery leases; очистка payload остановлена.")
        for identifier, files in value["stages"].items():
            if not IDENTIFIER.fullmatch(identifier) or not isinstance(files, list) or len(files) > MAX_ENTRIES - 2:
                raise ValueError("Некорректный recovery lease.")
            total = 0
            seen = set()
            for entry in files:
                if (not isinstance(entry, dict) or set(entry) != {"kind", "path", "bytes", "sha256"}
                        or entry["kind"] not in {"managedPath", "assetPath"} or not DIGEST.fullmatch(str(entry["sha256"]))
                        or type(entry["bytes"]) is not int or not 0 <= entry["bytes"] <= MAX_BYTES):
                    raise ValueError("Некорректный файл recovery lease.")
                key = _safe_name(entry["path"])
                parts = entry["path"].split("/")
                owned = (len(parts) == 3 and parts[0] == self.host.MANAGED_FILE_ROOT_DIR.name
                         and parts[1] == "security-restore-" + identifier and re.match(r"^\d{4}-", parts[2])) if entry["kind"] == "managedPath" else (
                             len(parts) == 4 and parts[0] == self.host.ITEM_ASSET_ROOT_DIR.name
                             and parts[1] in {"Папки", "Ярлыки"}
                             and re.fullmatch("security-restore-" + identifier + r"-\d{4}", parts[2]))
                if key in seen or not owned:
                    raise ValueError("Recovery lease не принадлежит своей стадии.")
                seen.add(key)
                self._references({entry["kind"]: entry["path"]})
                total += entry["bytes"]
            if total > MAX_BYTES:
                raise ValueError("Recovery lease превышает лимит 120 МиБ.")

    def _leases(self):
        # No stale fallback: removing a lease and then recovering an older file can only
        # over-preserve; an unknown current lease must still block GC, never be ignored.
        path = self._lease_path()
        if not path.exists():
            return {"owner": LEASE_OWNER, "stages": {}}
        if path.stat().st_size > MAX_METADATA_BYTES:
            raise ValueError("Recovery lease превышает безопасный размер.")
        value = _json(path.read_bytes())
        self._validate_leases(value)
        return value

    def restore_leases(self):
        with self.transaction():
            leases = self._leases()
            return [{entry["kind"]: entry["path"]} for files in leases["stages"].values() for entry in files]

    def stage(self, payload):
        if not isinstance(payload, dict) or set(payload) != {"base64"} or not isinstance(payload["base64"], str) or len(payload["base64"]) > ((MAX_BYTES + 2) // 3) * 4:
            raise ValueError("ZIP восстановления превышает 120 МиБ или имеет неверный формат.")
        raw = base64.b64decode(payload["base64"], validate=True)
        with self.transaction():
            record, refs, expected = self._verify(io.BytesIO(raw))
            leases = self._leases()
            if len(leases["stages"]) >= 4:
                raise ValueError("Уже есть четыре незавершённых восстановления. Завершите предыдущие перед новым.")
            identifier = uuid.uuid4().hex
            if identifier in leases["stages"]:
                raise ValueError("ID recovery-стадии уже занят; существующие файлы сохранены.")
            mapping, files = {}, []
            for index, (relative, kind) in enumerate(refs.items()):
                parts = relative.split("/")
                if kind == "managedPath":
                    changed = f"{self.host.MANAGED_FILE_ROOT_DIR.name}/security-restore-{identifier}/{index:04d}-{parts[-1]}"
                else:
                    changed = f"{parts[0]}/{parts[1]}/security-restore-{identifier}-{index:04d}/{parts[-1]}"
                self._references({kind: changed})
                if (self.data / changed).exists():
                    raise ValueError("Путь recovery-файла уже занят; существующие файлы сохранены.")
                mapping[relative] = changed
                entry = expected["data/" + relative]
                files.append({"kind": kind, "path": changed, "bytes": entry["bytes"], "sha256": entry["value"]})
            if shutil.disk_usage(self.data).free < sum(entry["bytes"] for entry in files) + 16 * 1024**2:
                raise OSError("Недостаточно места для изолированного восстановления.")
            leases["stages"][identifier] = files
            self._atomic(self._lease_path(), leases, self._validate_leases, recovery=False)
            # Durable lease precedes extraction. On failure, preserve recovery evidence.
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                    for relative, changed in mapping.items():
                        target = _checked(self.data, self.data / changed)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        _checked(self.data, target)
                        with archive.open("data/" + relative) as reader, target.open("xb") as writer:
                            shutil.copyfileobj(reader, writer, 1024 * 1024)
                            writer.flush()
                            os.fsync(writer.fileno())
                        item = expected["data/" + relative]
                        if _hash_file(target) != (item["bytes"], item["value"]):
                            raise OSError("Извлечённый файл не прошёл проверку чтением.")
                def rewrite(node):
                    if isinstance(node, dict):
                        for key, value in node.items():
                            if key in {"managedPath", "assetPath"} and isinstance(value, str) and value:
                                node[key] = mapping[value]
                            elif key == "basePath" and isinstance(value, str) and value in mapping:
                                node[key] = mapping[value]
                            else:
                                rewrite(value)
                    elif isinstance(node, list):
                        for value in node:
                            rewrite(value)
                rewrite(record["state"])
                if not self.api._preflight_state_payload(record["state"])["ready"]:
                    raise ValueError("Изолированный payload не прошёл финальную проверку.")
                return {"ok": True, "state": record["state"], "filesRestored": len(files), "stageId": identifier,
                        "stagedPaths": [entry["path"] for entry in files]}
            except Exception as exc:
                # Generated payloads are disposable when authoritative state is readable.
                # This removes only the lease, never payload bytes; ordinary GC retains
                # anything referenced by primary state or recovery points.
                try:
                    primary = self.host.read_json_file(self.host.STATE_FILE)
                    if not isinstance(primary, dict) or not isinstance(primary.get("state"), dict):
                        raise ValueError("Основное состояние не подтверждено.")
                    self._references(primary["state"])
                    del leases["stages"][identifier]
                    self._atomic(self._lease_path(), leases, self._validate_leases, recovery=False)
                except Exception:
                    raise RuntimeError(f"Восстановление остановлено; recovery-стадия {identifier} сохранена: {exc}") from exc
                raise RuntimeError(f"Восстановление остановлено без изменения рабочих данных: {exc}") from exc

    def release(self, payload):
        identifier = payload.get("stageId") if isinstance(payload, dict) else None
        if (not isinstance(payload, dict) or set(payload) - {"stageId", "committedPaths"}
                or not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier)):
            raise ValueError("Некорректный ID recovery-стадии.")
        with self.transaction():
            leases = self._leases()
            if identifier not in leases["stages"]:
                return {"ok": True, "released": False}
            primary = self.host.read_json_file(self.host.STATE_FILE)
            if not isinstance(primary, dict) or not isinstance(primary.get("state"), dict):
                raise ValueError("Основное состояние ещё не подтверждено; recovery lease сохранён.")
            refs = self._references(primary["state"])
            files = leases["stages"][identifier]
            selected = payload.get("committedPaths", [entry["path"] for entry in files])
            if (not isinstance(selected, list) or len(selected) > len(files) or any(not isinstance(path, str) for path in selected)
                    or len(set(selected)) != len(selected) or set(selected) - {entry["path"] for entry in files}):
                raise ValueError("Некорректный список подтверждённых файлов recovery-стадии.")
            for entry in files:
                if entry["path"] not in selected:
                    continue
                if entry["path"] not in refs or _hash_file(_checked(self.data, self.data / entry["path"])) != (entry["bytes"], entry["sha256"]):
                    raise ValueError("Основное состояние не подтверждает все восстановленные файлы; recovery lease сохранён.")
            del leases["stages"][identifier]
            self._atomic(self._lease_path(), leases, self._validate_leases, recovery=False)
            return {"ok": True, "released": True}
