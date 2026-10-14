"""Create a Pages feed from exact binary ZIP bytes; optional public download gate.

No import-time writes or network. CLI writes only the explicitly supplied output.
--verify-download checks unauthenticated direct Release download before publishing feed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_updater import (ASSET_RE, MANIFEST, MAX_FEED, MAX_JSON, PLATFORM, REPOSITORY,
                         GitHubClient, UpdateError, file_record, parse_json, validate_feed,
                         validate_manifest, version_tuple, read_version)


def check_publication(version: str, revision: str, latest_revision: str, *, client=None):
    """Immediately-before-deploy gate: a rerun cannot restore an older site/feed."""
    version_tuple(version)
    if not re.fullmatch(r"[a-f0-9]{40}", revision) or revision != latest_revision:
        raise UpdateError("Устаревший запуск CI: публиковать Pages можно только для текущего main.")
    try:
        published = validate_feed((client or GitHubClient()).feed(threading.Event()))
    except UpdateError as exc:
        if exc.http_status == 404:
            return  # First deployment only; offline/invalid feed are not absence.
        raise
    if version_tuple(version) < version_tuple(published["version"]):
        raise UpdateError("Нельзя понизить уже опубликованную версию Pages.")


def build_feed(package: Path, tag: str, output: Path, *, notes: str = "", verify_download: bool = False, client=None) -> dict:
    package, output = Path(package).resolve(), Path(output).resolve()
    match = ASSET_RE.fullmatch(package.name)
    if not match:
        raise UpdateError("Нужно версионное имя ZIP Windows-x64.")
    if output == package or output == package.with_suffix(".sha256.txt"):
        raise UpdateError("Файл канала не должен заменять ZIP или контрольную сумму.")
    record = file_record(package)
    checksum = package.with_suffix(".sha256.txt").read_text(encoding="ascii")
    if checksum != record["sha256"] + "  " + package.name + "\n":
        raise UpdateError("Контрольная сумма не соответствует ZIP.")
    with zipfile.ZipFile(package) as archive:
        entries = [entry for entry in archive.infolist() if entry.filename == MANIFEST]
        if len(entries) != 1 or entries[0].file_size > MAX_JSON:
            raise UpdateError("ZIP не содержит единственный манифест обновления.")
        manifest = validate_manifest(parse_json(archive.read(entries[0])))
        if manifest["version"] != match[1]:
            raise UpdateError("Версия ZIP не совпадает с вложенным манифестом.")
    candidate = validate_feed({"schema": 1, "repository": REPOSITORY, "platform": PLATFORM,
                               "version": match[1], "tag": tag, "name": package.name,
                               "url": f"https://github.com/{REPOSITORY}/releases/download/{tag}/{package.name}",
                               **record, "notes": notes})
    content = (json.dumps(candidate, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if len(content) > MAX_FEED:
        raise UpdateError("Файл канала обновлений слишком большой.")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Private staging; failure cannot replace the last published feed.
    with tempfile.TemporaryDirectory(prefix=".feed-", dir=output.parent) as temporary:
        temporary = Path(temporary)
        if verify_download:
            download = temporary / "package.zip"
            (client or GitHubClient()).fetch(candidate["url"], candidate["size"], threading.Event(), output=download)
            if file_record(download) != record:
                raise UpdateError("Опубликованный ZIP не совпадает с проверенной сборкой.")
        if file_record(package) != record:
            raise UpdateError("ZIP изменён во время создания канала обновлений.")
        staged = temporary / "updates.json"
        staged.write_bytes(content)
        os.replace(staged, output)
    return candidate


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--tag")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--notes", default="")
    parser.add_argument("--verify-download", action="store_true")
    parser.add_argument("--check-publication", action="store_true")
    parser.add_argument("--revision")
    parser.add_argument("--latest-revision")
    args = parser.parse_args()
    if args.check_publication:
        if not args.revision or not args.latest_revision:
            parser.error("--check-publication requires --revision and --latest-revision")
        check_publication(read_version(Path(__file__).resolve().parents[1]), args.revision, args.latest_revision)
        print("Current main and published version allow Pages deployment.")
    else:
        if not args.package or not args.tag or not args.output:
            parser.error("feed generation requires --package, --tag and --output")
        result = build_feed(args.package, args.tag, args.output, notes=args.notes, verify_download=args.verify_download)
        print(f"Pages feed: {result['version']} / {result['sha256']} / {args.output}")
