"""Build an immutable static uCoz release. No app import, network or user state."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

from build_release import ReleaseBuildError, _ensure_source_file, _is_link_like, _zip_info, read_project_version, sha256_file

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REGISTER_SOURCE = 'navigatorRef.serviceWorker.register("service-worker.js")'
REGISTER_TARGET = 'navigatorRef.serviceWorker.register("../../service-worker.js", { scope: "../../", updateViaCache: "none" })'

RELEASE_READER = r'''
async function readRelease(base) {
  const url = new URL("release.json", base);
  url.searchParams.set("check", Date.now() + "-" + Math.random().toString(36).slice(2));
  const response = await fetch(url.href, { cache: "no-store", redirect: "error" });
  if (!response.ok) throw new Error("Не удалось получить версию: HTTP " + response.status);
  const text = await response.text();
  if (text.length > 16384) throw new Error("Слишком большой release.json");
  const release = JSON.parse(text);
  if (release.schema !== 1 || !/^[0-9A-Za-z.+-]+-[0-9a-f]{16}$/.test(release.build || "") ||
      release.entry !== "releases/" + release.build + "/index.html") {
    throw new Error("Некорректный release.json");
  }
  return new URL(release.entry, base);
}
'''

LOADER = RELEASE_READER + r'''
(async () => {
  const base = new URL("./", location.href);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(new URL("service-worker.js", base).href,
      { scope: base.pathname, updateViaCache: "none" })
      .catch(error => console.warn("[ZeTer OS uCoz]", error));
  }
  try {
    const entry = await readRelease(base);
    entry.hash = location.hash;
    location.replace(entry.href);
  } catch (error) {
    document.getElementById("status").textContent = "Не удалось открыть ZeTer OS. " + error.message;
    document.getElementById("retry").hidden = false;
  }
})();
document.getElementById("retry").addEventListener("click", () => location.reload());
'''

LANDING = '''<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'">
<title>ZeTer OS</title><link rel="manifest" href="manifest.json">
<script src="ucoz-loader.js" defer></script></head><body>
<h1>ZeTer OS</h1><p id="status">Открывается актуальная версия…</p>
<button id="retry" hidden>Повторить</button>
<noscript>Для запуска ZeTer OS включите JavaScript.</noscript></body></html>
'''

WORKER = RELEASE_READER + r'''
const BASE = new URL(self.registration.scope);
const CACHE_PREFIX = "zeter-ucoz-" + BASE.pathname + "-";
const CACHE = CACHE_PREFIX + BUILD;
const COMPLETE = new URL(".ucoz-complete", BASE).href;
const IMMUTABLE = new Set(ASSETS.map(path => new URL(path, BASE).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Only immutable release paths are precached; publication metadata stays online.
    await cache.addAll([...IMMUTABLE].map(url => new Request(url, { cache: "reload" })));
    await cache.put(COMPLETE, new Response(BUILD));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  // Keep older release caches: an open tab may still need its original resources.
  // Never enumerate/delete unrelated origin caches or touch user databases.
  event.waitUntil(self.clients.claim());
});

async function cachedRelease(request) {
  const keys = (await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX));
  for (const key of keys) {
    const cache = await caches.open(key);
    if (!(await cache.match(COMPLETE))) continue;
    const response = await cache.match(request);
    if (response) return response;
  }
  return undefined;
}

async function navigate(request) {
  const url = new URL(request.url);
  try {
    const entry = await readRelease(BASE);
    if (url.pathname !== entry.pathname) {
      // Do not redirect a working A to an unavailable B during a failed upload.
      const probe = await fetch(entry.href, { cache: "no-store", redirect: "error" });
      if (!probe.ok) throw new Error("New entry HTTP " + probe.status);
      entry.hash = url.hash;
      return Response.redirect(entry.href, 302);
    }
    const response = await fetch(request, { cache: "no-store" });
    if (!response.ok) throw new Error("Entry HTTP " + response.status);
    return response;
  } catch (error) {
    const cached = await cachedRelease(request);
    if (cached) return cached;
    // An offline opening of the permanent URL uses this worker's complete release.
    const fallback = new URL("releases/" + BUILD + "/index.html", BASE);
    const isPermanent = url.pathname === BASE.pathname || url.pathname === new URL("index.html", BASE).pathname;
    if (isPermanent && await cachedRelease(fallback.href)) return Response.redirect(fallback.href, 302);
    return new Response("ZeTer OS: нет доступной полной сборки. Проверьте соединение и повторите открытие.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  const relative = url.pathname.slice(BASE.pathname.length);
  const entry = relative === "" || relative === "index.html" || /^releases\/[^/]+\/index\.html$/.test(relative);
  if (request.mode === "navigate" && entry) {
    event.respondWith(navigate(request));
  } else if (relative === "release.json") {
    event.respondWith(fetch(request, { cache: "no-store" }));
  } else if (relative.startsWith("releases/")) {
    event.respondWith((async () => (await cachedRelease(request)) || fetch(request))());
  }
});
'''


@dataclass(frozen=True)
class UcozResult:
    archive_path: Path
    version: str
    build_id: str
    sha256: str
    file_count: int


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        for key in ("src", "href", "poster"):
            value = values.get(key)
            if value and not (tag == "a" and key == "href"):
                self.references.append(value)
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"])


def validate_resources(files: dict[str, bytes]) -> None:
    for name, data in files.items():
        refs: list[str] = []
        if name.endswith(".html"):
            parser = AssetParser()
            parser.feed(data.decode("utf-8-sig"))
            refs = parser.references
            if len(parser.scripts) != len(set(parser.scripts)):
                raise ReleaseBuildError(f"Повторное подключение JS: {name}")
        elif name.endswith(".css"):
            css = re.sub(r"/\*.*?\*/", "", data.decode("utf-8-sig"), flags=re.S)
            refs = re.findall(r'''url\(\s*["']?([^\s)"']+)["']?\s*\)''', css)
            refs += re.findall(r'''@import\s+["']([^"']+)["']''', css)
        for ref in refs:
            parsed = urlsplit(ref)
            if not parsed.path or parsed.scheme or parsed.netloc:
                continue
            if parsed.path.startswith("/"):
                raise ReleaseBuildError(f"Абсолютный путь требует проверки для подпапки uCoz: {name}: {ref}")
            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parsed.path)))
            if target not in files:
                raise ReleaseBuildError(f"Отсутствующий ресурс: {name}: {ref} → {target}")
    for name, data in files.items():
        if name.endswith("manifest.json"):
            manifest = json.loads(data)
            for icon in manifest.get("icons", []):
                target = posixpath.normpath(posixpath.join(posixpath.dirname(name), icon["src"]))
                if target not in files:
                    raise ReleaseBuildError(f"Не найдена иконка manifest: {target}")


def collect_app(root: Path) -> dict[str, bytes]:
    app = root / "app"
    if _is_link_like(app) or not app.is_dir():
        raise ReleaseBuildError("app должна быть обычной папкой проекта.")
    files: dict[str, bytes] = {}
    for directory, dirs, names in os.walk(app, followlinks=False):
        for name in dirs + names:
            path = Path(directory) / name
            if _is_link_like(path):
                raise ReleaseBuildError(f"Ссылка/junction внутри app: {path}")
        for name in names:
            path = Path(directory) / name
            relative = path.relative_to(app).as_posix()
            if name.startswith(".") or path.suffix.lower() in {".py", ".pyc", ".exe", ".log", ".bak", ".tmp"}:
                raise ReleaseBuildError(f"Неожиданный служебный файл в app; проверьте вручную: {relative}")
            files[relative] = _ensure_source_file(path, root)
    for required in ("index.html", "manifest.json", "service-worker.js", "js/app.js", "js/core/shell-ui-utils.js"):
        if required not in files:
            raise ReleaseBuildError(f"Нет обязательного файла app/{required}")
    return files


def prepare_files(root: Path) -> tuple[str, str, dict[str, bytes]]:
    version = read_project_version(root)
    source = collect_app(root)
    validate_resources(source)
    digest = hashlib.sha256(Path(__file__).read_bytes())
    for name, data in sorted(source.items()):
        digest.update(name.encode("utf-8") + b"\0" + len(data).to_bytes(8, "big") + data)
    build_id = version + "-" + digest.hexdigest()[:16]
    prefix = f"releases/{build_id}/"
    files = {prefix + name: data for name, data in source.items() if name != "service-worker.js"}
    shell_name = prefix + "js/core/shell-ui-utils.js"
    shell = files[shell_name].decode("utf-8-sig")
    if shell.count(REGISTER_SOURCE) != 1:
        raise ReleaseBuildError("Изменился владелец регистрации PWA. Требуется пересмотр uCoz adapter.")
    files[shell_name] = shell.replace(REGISTER_SOURCE, REGISTER_TARGET).encode("utf-8")
    html = files[prefix + "index.html"].decode("utf-8-sig")
    if html.count('href="manifest.json"') != 1:
        raise ReleaseBuildError("Не найден единственный manifest в index.html.")
    files[prefix + "index.html"] = html.replace('href="manifest.json"', 'href="../../manifest.json"').encode("utf-8")
    manifest = json.loads(source["manifest.json"])
    for icon in manifest.get("icons", []):
        icon["src"] = prefix + icon["src"]
    manifest.update(start_url="./index.html", scope="./", id="./index.html")
    files["manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    files["index.html"] = LANDING.encode("utf-8")
    files["ucoz-loader.js"] = LOADER.encode("utf-8")
    files["release.json"] = (json.dumps({"schema": 1, "version": version, "build": build_id,
        "entry": prefix + "index.html"}, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    assets = sorted(name for name in files if name.startswith(prefix))
    worker = "const BUILD = " + json.dumps(build_id) + ";\nconst ASSETS = " + json.dumps(assets) + ";\n" + WORKER
    files["service-worker.js"] = worker.encode("utf-8")
    validate_resources(files)
    return version, build_id, files


def validate_archive(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path) as archive:
        if len(archive.namelist()) != len(files) or set(archive.namelist()) != set(files):
            raise ReleaseBuildError("ZIP не совпадает с планом упаковки.")
        if archive.testzip():
            raise ReleaseBuildError("CRC ZIP не прошёл.")
        for name, data in files.items():
            if archive.read(name) != data:
                raise ReleaseBuildError(f"Байты ZIP не совпали: {name}")


def build_ucoz(project_root: Path, output_dir: Path) -> UcozResult:
    root = project_root.resolve(strict=True)
    destination = (output_dir if output_dir.is_absolute() else root / output_dir).resolve()
    if destination == root or destination in root.parents:
        raise ReleaseBuildError("Используйте отдельную выходную папку, например dist/ucoz.")
    for protected in (root / name for name in ("app", "data", ".git", ".agents", ".codex")):
        if destination == protected or protected in destination.parents:
            raise ReleaseBuildError(f"Выходной каталог защищён: {destination}")
    version, build_id, files = prepare_files(root)
    destination.mkdir(parents=True, exist_ok=True)
    final = destination / f"ZeTer-OS-uCoz-FTP-{version}.zip"
    descriptor, temporary = tempfile.mkstemp(prefix=".ucoz-", suffix=".tmp", dir=destination)
    os.close(descriptor)
    candidate = Path(temporary)
    try:
        with zipfile.ZipFile(candidate, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(files.items()):
                archive.writestr(_zip_info(name), data, compresslevel=9)
        validate_archive(candidate, files)
        digest = sha256_file(candidate)
        if final.exists():
            if _is_link_like(final) or sha256_file(final) != digest:
                raise ReleaseBuildError("ZIP этой версии уже существует с другими байтами. Он сохранён. Повышайте версию или используйте другой --output-dir.")
        else:
            # Exclusive publication: another build must not replace an existing result.
            if os.name == "nt":
                os.rename(candidate, final)  # Windows refuses an existing destination.
            else:
                os.link(candidate, final)
    finally:
        candidate.unlink(missing_ok=True)
    return UcozResult(final, version, build_id, digest, len(files))


def main() -> int:
    parser = argparse.ArgumentParser(description="Собрать веб-версию ZeTer OS для ручной загрузки на uCoz.")
    parser.add_argument("--output-dir", type=Path, default=Path("dist/ucoz"))
    args = parser.parse_args()
    try:
        result = build_ucoz(PROJECT_ROOT, args.output_dir)
    except (ReleaseBuildError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"Ошибка сборки uCoz: {exc}", file=sys.stderr)
        return 1
    print(f"ZIP: {result.archive_path}\nВерсия: {result.version}\nСборка: {result.build_id}\nФайлов: {result.file_count}\nSHA-256: {result.sha256}")
    print("Загрузка вручную: releases → loader/index/manifest → service-worker.js → release.json ПОСЛЕДНИМ.")
    print("Не удаляйте старые releases. Инструкция: docs/UCOZ.md. На сервер ничего не отправлено.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
