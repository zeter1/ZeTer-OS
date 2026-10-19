"""Build an immutable static uCoz release. No app import, network or user state."""
from __future__ import annotations

import argparse
import hashlib
import io
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
  if (release.schema !== 1 || !/^(?:v[0-9a-f]{14}|[0-9A-Za-z_-]+-[0-9a-f]{16})$/.test(release.build || "") ||
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
    entry.search = location.search;
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

ENTRY_BOOTSTRAP = r'''
(() => {
  const release = new URL("./", document.currentScript.src);
  const base = document.querySelector("base[data-zeter-ucoz]");
  if (!base || release.origin !== location.origin ||
      !/\/releases\/(?:v[0-9a-f]{14}|[0-9A-Za-z_-]+-[0-9a-f]{16})\/$/.test(release.pathname) ||
      location.pathname !== new URL("index.html", release).pathname) {
    throw new Error("Некорректный адрес веб-сборки ZeTer OS");
  }
  // Pin the resource base before changing the document URL. Later dynamic
  // images/fetches and PWA registration must keep this release's paths too.
  base.href = release.href;
  const permanent = new URL("../../index.html", release);
  permanent.search = location.search;
  permanent.hash = location.hash;
  history.replaceState(history.state, "", permanent.href);
})();
'''

WEB_RUNTIME_VERSION = "2"

WORKER = 'const RUNTIME = ' + json.dumps(WEB_RUNTIME_VERSION) + ';\n' + RELEASE_READER + r'''
const BASE = new URL(self.registration.scope);
const CACHE_PREFIX = "zeter-ucoz-" + BASE.pathname + "-";
const CACHE = CACHE_PREFIX + BUILD + "-r" + RUNTIME;
const COMPLETE = new URL(".ucoz-complete", BASE).href;
const IMMUTABLE = new Set(ASSETS.map(path => new URL(path, BASE).href));
let preparation = null;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Activate routing after validating the entry, not after downloading an
    // entire offline copy. A slow optional image must not hold the old router.
    const entry = new URL("releases/" + BUILD + "/index.html", BASE);
    await cache.addAll([entry.href, new URL("ucoz-entry.js", entry).href]
      .map(url => new Request(url, { cache: "reload", redirect: "error" })));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  // Keep older release caches: an open tab may still need its original resources.
  // Never enumerate/delete unrelated origin caches or touch user databases.
  event.waitUntil(self.clients.claim());
});

function prepareOffline() {
  if (!preparation) {
    preparation = (async () => {
      const cache = await caches.open(CACHE);
      if (await cache.match(COMPLETE)) return;
      const remaining = [...IMMUTABLE];
      async function download() {
        while (remaining.length) {
          const url = remaining.shift();
          if (await cache.match(url)) continue;
          // A root-only patch can reuse identical immutable resources from a
          // prior complete cache instead of downloading the app again.
          const response = (await cachedRelease(url)) ||
            await fetch(new Request(url, { cache: "reload", redirect: "error" }));
          if (!response.ok) throw new Error("Offline resource HTTP " + response.status + ": " + url);
          await cache.put(url, response);
        }
      }
      const results = await Promise.allSettled(Array.from({ length: Math.min(4, remaining.length) }, download));
      const failure = results.find(result => result.status === "rejected");
      if (failure) throw failure.reason;
      // Partial downloads never become an offline fallback. Keep prior caches.
      await cache.put(COMPLETE, new Response(BUILD));
    })().finally(() => { preparation = null; });
  }
  return preparation;
}

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

async function latestCompleteEntry() {
  const keys = (await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX)).reverse();
  for (const key of keys) {
    const cache = await caches.open(key);
    const complete = await cache.match(COMPLETE);
    if (!complete) continue;
    const build = await complete.text();
    if (!/^(?:v[0-9a-f]{14}|[0-9A-Za-z_-]+-[0-9a-f]{16})$/.test(build)) continue;
    const entry = new URL("releases/" + build + "/index.html", BASE);
    if (await cache.match(entry.href)) return entry;
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
      entry.search = url.search;
      entry.hash = url.hash;
      return Response.redirect(entry.href, 302);
    }
    const response = await fetch(request, { cache: "no-store" });
    if (!response.ok) throw new Error("Entry HTTP " + response.status);
    return response;
  } catch (error) {
    // Entry HTML is immutable by build; query/hash select client state, not
    // another file. Resource fetches below still retain full URL matching.
    const cachedEntry = new URL(request.url);
    cachedEntry.search = "";
    cachedEntry.hash = "";
    const cached = await cachedRelease(cachedEntry.href);
    if (cached) return cached;
    // A newly activated router may not have its full offline copy yet.
    const fallback = await latestCompleteEntry();
    const isPermanent = url.pathname === BASE.pathname || url.pathname === new URL("index.html", BASE).pathname;
    if (isPermanent && fallback) {
      fallback.search = url.search;
      fallback.hash = url.hash;
      return Response.redirect(fallback.href, 302);
    }
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
    // This extends the fetch event, not installation/activation or its response.
    event.waitUntil(prepareOffline().catch(error => console.warn("[ZeTer OS offline cache]", error)));
    event.respondWith(navigate(request));
  } else if (relative === "release.json") {
    event.respondWith(fetch(request, { cache: "no-store" }));
  } else if (relative.startsWith("releases/")) {
    event.respondWith((async () => (await cachedRelease(request)) || fetch(request))());
  }
});

self.addEventListener("message", event => {
  if (event.data?.type !== "ZETER_UCOZ_RUNTIME_STATUS" || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    event.ports[0].postMessage({ runtime: RUNTIME, build: BUILD,
      complete: !!(await cache.match(COMPLETE)) });
  })());
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
        if tag == "base":
            if values.get("href") != "./" or "data-zeter-ucoz" not in values:
                raise ReleaseBuildError("Неожиданный base в веб-сборке uCoz.")
            return  # Generated release base does not refer to a file.
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


def validate_ucoz_paths(files: dict[str, bytes]) -> None:
    """Match file-manager limits; a valid local ZIP is not necessarily uploadable."""
    children: dict[str, set[str]] = {}
    for name in files:
        parts = name.split("/")
        if 2 + len(parts) - 1 > 10:
            raise ReleaseBuildError(f"Превышена глубина 10 папок uCoz: {name}")
        for index, part in enumerate(parts):
            pattern = r"[A-Za-z0-9_-]+" if index < len(parts) - 1 else r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*"
            limit = 15 if index < len(parts) - 1 else 45
            if len(part) > limit or not re.fullmatch(pattern, part):
                raise ReleaseBuildError(f"Недопустимое имя для файлового менеджера uCoz: {part} ({name})")
            children.setdefault("/".join(parts[:index]), set()).add(part)
    for parent, names in children.items():
        if len(names) > 1000:
            raise ReleaseBuildError(f"Более 1000 элементов в каталоге uCoz: {parent}")


def prepare_files(root: Path) -> tuple[str, str, dict[str, bytes]]:
    version = read_project_version(root)
    source = collect_app(root)
    validate_resources(source)
    payload = {name: data for name, data in source.items() if name != "service-worker.js"}
    shell_name = "js/core/shell-ui-utils.js"
    shell = payload[shell_name].decode("utf-8-sig")
    if shell.count(REGISTER_SOURCE) != 1:
        raise ReleaseBuildError("Изменился владелец регистрации PWA. Требуется пересмотр uCoz adapter.")
    payload[shell_name] = shell.replace(REGISTER_SOURCE, REGISTER_TARGET).encode("utf-8")
    html = payload["index.html"].decode("utf-8-sig")
    if html.count('href="manifest.json"') != 1:
        raise ReleaseBuildError("Не найден единственный manifest в index.html.")
    if html.count("base-uri 'none'") != 1 or "<base" in html.lower():
        raise ReleaseBuildError("Изменился CSP/base в index.html. Требуется пересмотр uCoz adapter.")
    # Only the generated web copy permits an explicit same-origin base. The
    # source/native HTML retains base-uri 'none'; no inline/eval script is added.
    html = html.replace("base-uri 'none'", "base-uri 'self'")
    first_link = html.find("<link ")
    if first_link < 0:
        raise ReleaseBuildError("Не найдено место для uCoz entry bootstrap.")
    html = html[:first_link] + '<base href="./" data-zeter-ucoz>\n<script src="ucoz-entry.js"></script>\n' + html[first_link:]
    payload["index.html"] = html.replace('href="manifest.json"', 'href="../../manifest.json"').encode("utf-8")
    payload["ucoz-entry.js"] = ENTRY_BOOTSTRAP.encode("utf-8")
    # Only actual immutable payload bytes determine its address. Updating the
    # root router/loader no longer renames every unchanged application asset.
    digest = hashlib.sha256()
    for name, data in sorted(payload.items()):
        digest.update(name.encode("utf-8") + b"\0" + len(data).to_bytes(8, "big") + data)
    build_id = "v" + digest.hexdigest()[:14]
    prefix = f"releases/{build_id}/"
    files = {prefix + name: data for name, data in payload.items()}
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
    files["service-worker.js"] = render_worker(build_id, assets)
    validate_resources(files)
    validate_ucoz_paths(files)
    return version, build_id, files


def render_worker(build_id: str, assets: list[str]) -> bytes:
    return ("const BUILD = " + json.dumps(build_id) + ";\nconst ASSETS = " + json.dumps(assets)
        + ";\n" + WORKER).encode("utf-8")


def validate_archive(path: Path, files: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path) as archive:
        if len(archive.namelist()) != len(files) or set(archive.namelist()) != set(files):
            raise ReleaseBuildError("ZIP не совпадает с планом упаковки.")
        if archive.testzip():
            raise ReleaseBuildError("CRC ZIP не прошёл.")
        for name, data in files.items():
            if archive.read(name) != data:
                raise ReleaseBuildError(f"Байты ZIP не совпали: {name}")


def output_directory(project_root: Path, output_dir: Path) -> Path:
    root = project_root.resolve(strict=True)
    destination = (output_dir if output_dir.is_absolute() else root / output_dir).resolve()
    if destination == root or destination in root.parents:
        raise ReleaseBuildError("Используйте отдельную выходную папку, например dist/ucoz.")
    for protected in (root / name for name in ("app", "data", ".git", ".agents", ".codex")):
        if destination == protected or protected in destination.parents:
            raise ReleaseBuildError(f"Выходной каталог защищён: {destination}")
    return destination


def publish_archive(destination: Path, filename: str, files: dict[str, bytes]) -> tuple[Path, str]:
    destination.mkdir(parents=True, exist_ok=True)
    final = destination / filename
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
    return final, digest


def build_ucoz(project_root: Path, output_dir: Path) -> UcozResult:
    root = project_root.resolve(strict=True)
    destination = output_directory(root, output_dir)
    version, build_id, files = prepare_files(root)
    final, digest = publish_archive(destination, f"ZeTer-OS-uCoz-FTP-{version}.zip", files)
    return UcozResult(final, version, build_id, digest, len(files))


def build_runtime_patch(source_archive: Path, output_dir: Path) -> UcozResult:
    """Generate one root worker for an already published, verified app ZIP.

    Do not call prepare_files: its current payload may differ from the selected
    live release. No network, extraction into app/, native import or upload.
    """
    if _is_link_like(source_archive):
        raise ReleaseBuildError("Архив не должен быть ссылкой.")
    source_archive = source_archive.resolve(strict=True)
    with source_archive.open("rb") as stream:
        source_bytes = stream.read(200 * 1024 * 1024 + 1)
    if len(source_bytes) > 200 * 1024 * 1024:
        raise ReleaseBuildError("Исходный ZIP превышает 200 МБ.")
    with zipfile.ZipFile(io.BytesIO(source_bytes)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or len(names) > 2000:
            raise ReleaseBuildError("Неоднозначный или слишком большой состав ZIP.")
        if sum(item.file_size for item in archive.infolist()) > 200 * 1024 * 1024:
            raise ReleaseBuildError("Распакованный ZIP превышает 200 МБ.")
        if "release.json" not in names:
            raise ReleaseBuildError("В ZIP нет release.json.")
        meta = json.loads(archive.read("release.json"))
        build = meta.get("build", "") if isinstance(meta, dict) else ""
        if not isinstance(build, str) or not re.fullmatch(r"(?:v[0-9a-f]{14}|[0-9A-Za-z_-]+-[0-9a-f]{16})", build):
            raise ReleaseBuildError("Неверный build ID исходного ZIP.")
        prefix = f"releases/{build}/"
        if meta.get("schema") != 1 or meta.get("entry") != prefix + "index.html":
            raise ReleaseBuildError("Неверный entry исходного ZIP.")
        root_names = {"index.html", "ucoz-loader.js", "manifest.json", "service-worker.js", "release.json"}
        for name in names:
            if name not in root_names and not name.startswith(prefix):
                raise ReleaseBuildError(f"Лишний путь в исходном ZIP: {name}")
            if any(not re.fullmatch(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*", part) for part in name.split("/")):
                raise ReleaseBuildError(f"Небезопасный путь ZIP: {name}")
        required = root_names | {prefix + name for name in ("index.html", "ucoz-entry.js", "js/core/version.js")}
        if not required.issubset(names):
            raise ReleaseBuildError("Исходный ZIP неполон.")
        source = {name: archive.read(name) for name in names}
    validate_resources(source)
    match = re.search(r'''window\.ZETER_OS_VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']''',
        source[prefix + "js/core/version.js"].decode("utf-8-sig"))
    if not match or meta.get("version") != match.group(1):
        raise ReleaseBuildError("Версия payload не совпадает с release.json.")
    version = match.group(1)
    assets = sorted(name for name in names if name.startswith(prefix))
    worker = render_worker(build, assets)
    destination = output_directory(PROJECT_ROOT, output_dir)
    plan = {"schema": 1, "mode": "runtime-only", "version": version, "build": build,
        "runtime": WEB_RUNTIME_VERSION, "source_archive_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "site_directory": "/portfolio/ZeTerOS/", "release_json_must_remain_unchanged": True,
        "uploads": [{"path": "service-worker.js", "local": str(destination / "service-worker.js"),
            "size": len(worker), "sha256": hashlib.sha256(worker).hexdigest()}]}
    outputs = {"service-worker.js": worker,
        "upload-plan.json": (json.dumps(plan, ensure_ascii=False, indent=2) + "\n").encode("utf-8")}
    # Check every output before publication. Never overwrite a previous candidate.
    for name, data in outputs.items():
        target = destination / name
        if target.exists() and (_is_link_like(target) or target.read_bytes() != data):
            raise ReleaseBuildError(f"Предыдущий результат сохранён; выберите другой --output-dir: {target}")
    final, digest = publish_archive(destination, f"ZeTer-OS-uCoz-runtime-{version}-r{WEB_RUNTIME_VERSION}.zip",
        {"service-worker.js": worker})
    for name, data in outputs.items():
        target = destination / name
        if target.exists():
            if _is_link_like(target) or target.read_bytes() != data:
                raise ReleaseBuildError(f"Результат занят другой сборкой и сохранён: {target}")
        else:
            with target.open("xb") as stream:
                stream.write(data)
    for name, data in outputs.items():
        target = destination / name
        if _is_link_like(target) or target.read_bytes() != data:
            raise ReleaseBuildError(f"Итоговый комплект изменён другой сборкой: {target}")
    return UcozResult(final, version, build, digest, 1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Собрать веб-версию ZeTer OS для ручной загрузки на uCoz.")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--runtime-only-from", type=Path, help="Служебный патч из ZIP уже опубликованной сборки; payload не пересобирается.")
    parser.add_argument("--no-pause", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.runtime_only_from:
            result = build_runtime_patch(args.runtime_only_from, args.output_dir or Path("dist/ucoz-runtime"))
        else:
            result = build_ucoz(PROJECT_ROOT, args.output_dir or Path("dist/ucoz"))
    except (ReleaseBuildError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"Ошибка сборки uCoz: {exc}", file=sys.stderr)
        return 1
    print(f"ZIP: {result.archive_path}\nВерсия: {result.version}\nСборка: {result.build_id}\nФайлов: {result.file_count}\nSHA-256: {result.sha256}")
    if args.runtime_only_from:
        print(f"Веб-runtime: r{WEB_RUNTIME_VERSION}. Загрузить ТОЛЬКО service-worker.js по upload-plan.json.")
        print("release.json, manifest и файлы releases остаются прежними. Сначала сверить активные version/build с планом.")
    else:
        print("Загрузка вручную: releases → loader/index/manifest → service-worker.js → release.json ПОСЛЕДНИМ.")
    print("Не удаляйте старые releases. Инструкция: docs/UCOZ.md. На сервер ничего не отправлено.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
