"""Hermetic Pages feed tests: synthetic ZIPs/HTTP, no GUI, live network or user state.

Imports only define helpers; all writes target a fresh fixture below work/update-feed-tests.
The injected HTTP opener and downloader never contact external services.
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
import threading
import unittest
from email.message import Message
from pathlib import Path
from urllib.error import HTTPError, URLError
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app_updater as update
from tools.smoke_app_updater import fixture_distribution
from tools.build_update_package import build_package


def feed(version="4.0.11", content=b"package"):
    name = f"ZeTer-OS-{version}-Windows-x64.zip"
    tag = "build-abcdef1-123-1"
    return {"schema": 1, "repository": update.REPOSITORY, "platform": update.PLATFORM,
            "version": version, "tag": tag, "name": name,
            "url": f"https://github.com/{update.REPOSITORY}/releases/download/{tag}/{name}",
            "size": len(content), "sha256": hashlib.sha256(content).hexdigest(), "notes": "Проверка обновлений"}


class Response(io.BytesIO):
    def __init__(self, content, headers=None):
        super().__init__(content)
        self.headers = Message()
        for name, value in (headers or {}).items():
            self.headers[name] = value


class Opener:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []
    def open(self, request, timeout):
        self.calls.append(request.full_url)
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def http_error(code, headers=None):
    message = Message()
    for key, value in (headers or {}).items():
        message[key] = value
    return HTTPError("https://example.invalid", code, "synthetic", message, io.BytesIO(b"error"))


class FeedTests(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parents[1] / "work/update-feed-tests"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="канал ", dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def client(self, *responses):
        client = update.GitHubClient()
        client.opener = Opener(responses)
        return client

    def test_numeric_versions_equal_and_older_no_download(self):
        self.assertEqual(update.select_feed(feed("4.0.11"), "4.0.9")["version"], "4.0.11")
        self.assertIsNone(update.select_feed(feed("4.0.9"), "4.0.11"))
        self.assertIsNone(update.select_feed(feed("4.0.11"), "4.0.11"))

    def test_strict_types_identity_and_linkage(self):
        changes = {"schema": [True, 2], "repository": ["evil/repo"], "platform": ["linux"],
                   "version": ["04.0.11", "4.0", True], "tag": ["../evil", "a/b", "a%2fb", "a..b"],
                   "name": ["ZeTer-OS-4.0.10-Windows-x64.zip"], "size": [True, 0, -1, update.MAX_ARCHIVE + 1],
                   "sha256": ["", "a" * 63, "Z" * 64], "notes": [[], "x" * 4001],
                   "url": ["http://github.com/x", "https://github.com.evil/x", "https://user@github.com/x",
                           "https://github.com:443/x", "https://github.com/evil/repo", "https://github.com/x#fragment"]}
        for key, values in changes.items():
            for value in values:
                candidate = {**feed(), key: value}
                with self.subTest(key=key, value=str(value)[:50]), self.assertRaises(update.UpdateError):
                    update.select_feed(candidate, "4.0.1")
        for key in feed():
            candidate = feed()
            del candidate[key]
            with self.subTest(missing=key), self.assertRaises(update.UpdateError):
                update.select_feed(candidate, "4.0.1")
        with self.assertRaises(update.UpdateError):
            update.select_feed({**feed(), "unexpected": "field"}, "4.0.1")

    def test_invalid_even_when_version_is_old(self):
        with self.assertRaises(update.UpdateError):
            update.select_feed({**feed("4.0.1"), "sha256": ""}, "4.0.11")

    def test_feed_only_fixed_url_and_no_redirects(self):
        client = self.client(Response(json.dumps(feed()).encode()))
        value = client.feed(threading.Event())
        self.assertEqual(value["version"], "4.0.11")
        self.assertEqual(client.opener.calls, [update.FEED_URL])
        for url in (update.FEED_URL + "?x=1", update.FEED_URL.replace("ZeTer-OS", "other"),
                    update.FEED_URL.replace("https:", "http:"), update.FEED_URL + "#fragment"):
            with self.assertRaises(update.UpdateError):
                update.validate_url(url, feed=True)
        redirected = self.client(http_error(302, {"Location": update.FEED_URL}))
        with self.assertRaisesRegex(update.UpdateError, "перенаправление"):
            redirected.feed(threading.Event())
        self.assertEqual(len(redirected.opener.calls), 1)

    def test_bad_json_duplicate_oversize_and_truncated(self):
        bodies = [b"", b"[]", b'{"schema":1,"schema":1}', b'{"schema":NaN}', b"\xff", b"x" * (65536 + 1)]
        for body in bodies:
            with self.subTest(size=len(body)), self.assertRaises(update.UpdateError):
                update.select_feed(self.client(Response(body)).feed(threading.Event()), "4.0.1")
        with self.assertRaises(update.UpdateError):
            self.client(Response(b"short", {"Content-Length": "100"})).feed(threading.Event())

    def test_server_errors_distinct_and_single_request(self):
        cases = [(404, {}, "не опубликован"), (403, {}, "отклонил"),
                 (429, {"Retry-After": "120"}, "много запросов"),
                 (403, {"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1120"}, "много запросов")]
        for code, headers, expected in cases:
            client = self.client(http_error(code, headers))
            with self.subTest(code=code), patch.object(update.time, "time", return_value=1000):
                with self.assertRaisesRegex(update.UpdateError, expected) as raised:
                    client.feed(threading.Event())
                if "Retry-After" in headers or "X-RateLimit-Reset" in headers:
                    self.assertEqual(raised.exception.retry_after, 120)
            self.assertEqual(len(client.opener.calls), 1)
        with self.assertRaisesRegex(update.UpdateError, "интернет"):
            self.client(URLError("synthetic offline")).feed(threading.Event())

    def test_asset_redirect_allowed_and_foreign_rejected(self):
        target = "https://release-assets.githubusercontent.com/path?signature=synthetic"
        client = self.client(http_error(302, {"Location": target}), Response(b"package"))
        self.assertEqual(client.fetch(feed()["url"], 100, threading.Event()), b"package")
        self.assertEqual(client.opener.calls[-1], target)
        bad = self.client(http_error(302, {"Location": "https://evil.invalid/file"}))
        with self.assertRaises(update.UpdateError):
            bad.fetch(feed()["url"], 100, threading.Event())
        self.assertEqual(len(bad.opener.calls), 1)

    def test_manager_checks_feed_without_download_or_api(self):
        root = self.base / "Установка"
        fixture_distribution(root, "4.0.11")
        build_package(root, self.base / "packages")
        client = self.client(Response(json.dumps(feed()).encode()), Response(json.dumps(feed("4.0.12")).encode()))
        manager = update.UpdateManager(root, root / "data", frozen=True, platform_name="win32", client=client)
        self.assertEqual(manager.check()["message"], "Установлена актуальная версия.")
        self.assertEqual(manager.check()["phase"], "available")
        self.assertEqual(client.opener.calls, [update.FEED_URL, update.FEED_URL])
        self.assertFalse((root / "data").exists(), "discovery must not create update staging or state")

    def test_cooldown_blocks_manual_repeat_and_clears_on_success(self):
        root = self.base / "Установка"
        fixture_distribution(root, "4.0.11")
        build_package(root, self.base / "packages")
        client = self.client(http_error(429, {"Retry-After": "120"}), Response(json.dumps(feed()).encode()))
        manager = update.UpdateManager(root, root / "data", frozen=True, platform_name="win32", client=client)
        with patch.object(update.time, "monotonic", return_value=1000):
            self.assertFalse(manager.check()["ok"])
            self.assertFalse(manager.check()["ok"])
        self.assertEqual(len(client.opener.calls), 1)
        with patch.object(update.time, "monotonic", return_value=1121):
            self.assertEqual(manager.check()["phase"], "idle")
        self.assertEqual(manager.get_status()["retryAfterSeconds"], 0)

    def package(self):
        root = self.base / "distribution"
        fixture_distribution(root, "4.0.11")
        return build_package(root, self.base / "packages")

    def test_generator_uses_exact_zip_hash_size_and_version(self):
        from tools.build_update_feed import build_feed
        package, _ = self.package()
        output = self.base / "pages/updates.json"
        result = build_feed(package, "build-abcdef1-123-1", output, notes="Исправления")
        self.assertEqual(result["sha256"], hashlib.sha256(package.read_bytes()).hexdigest())
        self.assertEqual(result["size"], package.stat().st_size)
        self.assertEqual(json.loads(output.read_bytes()), result)
        self.assertEqual(update.select_feed(result, "4.0.10")["version"], "4.0.11")

    def test_generator_failed_remote_verification_preserves_previous_feed(self):
        from tools.build_update_feed import build_feed
        package, _ = self.package()
        output = self.base / "pages/updates.json"
        output.parent.mkdir()
        output.write_bytes(b"previous-feed-sentinel")
        client = self.client(Response(b"wrong bytes"))
        with self.assertRaises(update.UpdateError):
            build_feed(package, "build-abcdef1-123-1", output, verify_download=True, client=client)
        self.assertEqual(output.read_bytes(), b"previous-feed-sentinel")
        self.assertEqual(list(output.parent.iterdir()), [output])

    def test_generator_remote_success_then_client_validates_package(self):
        from tools.build_update_feed import build_feed
        package, _ = self.package()
        content = package.read_bytes()
        client = self.client(Response(content))
        output = self.base / "pages/updates.json"
        candidate = build_feed(package, "build-abcdef1-123-1", output, verify_download=True, client=client)
        self.assertEqual(client.opener.calls, [candidate["url"]])
        update.stage_archive(package, self.base / "stage", candidate["version"])
        self.assertEqual(update.read_manifest(self.base / "stage")["version"], candidate["version"])

    def test_publication_workflow_order_and_target_guards(self):
        workflow = (Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        publish = workflow.split("  publish-release:\n", 1)[1]
        self.assertIn("github.repository == 'zeter1/ZeTer-OS' && github.ref == 'refs/heads/main'", publish)
        self.assertLess(publish.index("gh release create"), publish.index("--verify-download"))
        self.assertLess(publish.index("--verify-download"), publish.index("actions/upload-pages-artifact@"))
        self.assertIn("needs: publish-release", publish.split("  publish-pages:", 1)[1])
        self.assertNotIn("--clobber", publish)
        self.assertIn("${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}", publish)
        self.assertIn("cp -R app/. pages/", publish, "Pages deployment must retain the web app")
        deploy = publish.split("  publish-pages:", 1)[1]
        self.assertLess(deploy.index("--check-publication"), deploy.index("actions/deploy-pages@"))

    def test_publication_rejects_old_revision_and_version(self):
        from tools.build_update_feed import check_publication
        current, latest = "a" * 40, "b" * 40
        unused = self.client()
        with self.assertRaises(update.UpdateError):
            check_publication("4.0.16", current, latest, client=unused)
        self.assertEqual(unused.opener.calls, [], "stale rerun must stop before network/deploy")
        with self.assertRaises(update.UpdateError):
            check_publication("4.0.16", latest, latest, client=self.client(Response(json.dumps(feed("4.0.17")).encode())))

    def test_publication_allows_first_or_newer_but_not_unknown_status(self):
        from tools.build_update_feed import check_publication
        revision = "b" * 40
        check_publication("4.0.17", revision, revision, client=self.client(http_error(404)))
        check_publication("4.0.17", revision, revision, client=self.client(Response(json.dumps(feed("4.0.16")).encode())))
        for response in (http_error(403), URLError("offline"), Response(b"broken json")):
            with self.subTest(response=str(response)), self.assertRaises(update.UpdateError):
                check_publication("4.0.17", revision, revision, client=self.client(response))

    def test_generator_rejects_wrong_checksum_name_and_nested_version(self):
        from tools.build_update_feed import build_feed
        package, checksum = self.package()
        output = self.base / "pages/updates.json"
        checksum.write_text("a" * 64 + "  " + package.name + "\n", encoding="ascii")
        with self.assertRaises(update.UpdateError):
            build_feed(package, "build-abcdef1-123-1", output)
        self.assertFalse(output.exists())
        checksum.write_text(hashlib.sha256(package.read_bytes()).hexdigest() + "  " + package.name + "\n", encoding="ascii")
        renamed = package.with_name(package.name.replace("4.0.11", "4.0.12"))
        renamed.write_bytes(package.read_bytes())
        renamed.with_suffix(".sha256.txt").write_text(hashlib.sha256(renamed.read_bytes()).hexdigest() + "  " + renamed.name + "\n", encoding="ascii")
        with self.assertRaises(update.UpdateError):
            build_feed(renamed, "build-abcdef1-123-1", output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
