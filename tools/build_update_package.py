"""Generate an owned flat-onedir manifest and versioned binary ZIP/checksum.

Only the explicitly supplied synthetic/build distribution is read or changed.
Never packages state, diagnostics or a source checkout; executable pair is required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import uuid
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_updater import (EXE, HELPER, MANIFEST, LAYOUT, PLATFORM, UpdateError,
                         file_record, plain_path, read_version, safe_name,
                         validate_manifest)


def build_package(distribution: Path, output: Path) -> tuple[Path, Path]:
    distribution = Path(os.path.abspath(distribution))
    output = Path(os.path.abspath(output))
    plain_path(distribution, distribution)
    if not distribution.is_dir() or not all((distribution / name).is_file() for name in (EXE, HELPER)):
        raise UpdateError("Нужна полная EXE-сборка вместе с отдельным установщиком.")
    version = read_version(distribution)
    records = {}
    # Reject protected contents rather than silently publishing user data.
    for path in sorted(distribution.rglob("*")):
        plain_path(distribution, path)
        if path.is_dir():
            safe_name(path.relative_to(distribution).as_posix())
            continue
        name = path.relative_to(distribution).as_posix()
        if name == MANIFEST:
            continue
        safe_name(name)
        if not path.is_file():
            raise UpdateError("Сборка содержит специальный файл.")
        records[name] = file_record(path)
    manifest = validate_manifest({"schema": 1, "version": version, "platform": PLATFORM, "layout": LAYOUT, "files": records})
    manifest_path = plain_path(distribution, distribution / MANIFEST)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    plain_path(output, output)
    output.mkdir(parents=True, exist_ok=True)
    zip_path = output / f"ZeTer-OS-{version}-Windows-x64.zip"
    checksum = zip_path.with_suffix(".sha256.txt")
    temporary = output / (".zeter-package-" + uuid.uuid4().hex + ".zip")
    try:
        with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in [*sorted(records), MANIFEST]:
                archive.write(distribution / name, name)
        # Independent second read proves produced ZIP bytes match the hashed source map.
        with zipfile.ZipFile(temporary) as archive:
            if set(archive.namelist()) != set(records) | {MANIFEST}:
                raise UpdateError("Неверный состав созданного ZIP.")
            for name, record in records.items():
                content = archive.read(name)
                if len(content) != record["size"] or hashlib.sha256(content).hexdigest() != record["sha256"]:
                    raise UpdateError("Исходная сборка изменена во время упаковки.")
        plain_path(output, zip_path)
        os.replace(temporary, zip_path)
        plain_path(output, checksum)
        checksum.write_text(file_record(zip_path)["sha256"] + "  " + zip_path.name + "\n", encoding="ascii", newline="\n")
    finally:
        temporary.unlink(missing_ok=True)
    return zip_path, checksum


def verify_x64_executable(path: Path):
    """CLI publication proof: the actual entry/helper PE machines must be AMD64."""
    plain_path(path.parent, path)
    with path.open("rb") as stream:
        header = stream.read(64)
        if len(header) != 64 or header[:2] != b"MZ":
            raise UpdateError("Файл не является готовым Windows EXE.")
        offset = struct.unpack_from("<I", header, 60)[0]
        if offset > 64 * 1024 * 1024:
            raise UpdateError("Некорректный заголовок EXE.")
        stream.seek(offset)
        pe = stream.read(6)
        if pe[:4] != b"PE\x00\x00" or len(pe) != 6 or struct.unpack_from("<H", pe, 4)[0] != 0x8664:
            raise UpdateError("Пакет Windows-x64 требует EXE и установщик AMD64.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "win32" or struct.calcsize("P") != 8:
        raise UpdateError("Пакеты Windows-x64 собираются 64-битным Python в Windows.")
    for executable in (EXE, HELPER):
        verify_x64_executable(args.distribution / executable)
    package, checksum = build_package(args.distribution, args.output)
    print(package)
    print(checksum)
