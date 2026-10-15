"""uCoz packaging contracts on artificial files only; no application import."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import build_ucoz as builder


class UcozBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="zeter-ucoz-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "Проект с пробелами"
        files = {
            "index.html": '<!doctype html><link rel="manifest" href="manifest.json"><link rel="stylesheet" href="css/style.css"><script src="js/core/version.js"></script><script src="js/core/shell-ui-utils.js"></script><script src="js/app.js"></script>',
            "css/style.css": '@import "theme.css";',
            "css/theme.css": 'body { background: url("../assets/icon.svg"); }',
            "assets/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
            "js/core/version.js": 'window.ZETER_OS_VERSION = "9.8.7";',
            "js/core/shell-ui-utils.js": 'navigatorRef.serviceWorker.register("service-worker.js").catch(console.warn);',
            "js/app.js": 'window.testValue = 1;',
            "manifest.json": '{"start_url":"./index.html","scope":"./","icons":[{"src":"assets/icon.svg"}]}',
            "service-worker.js": "// original worker",
        }
        for relative, content in files.items():
            path = self.root / "app" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        (self.root / "data").mkdir()
        (self.root / "data" / "private.json").write_text("private", encoding="utf-8")

    def build(self):
        return builder.build_ucoz(self.root, self.root / "dist")

    def test_structure_original_order_and_deterministic_bytes(self):
        result = self.build()
        original = result.archive_path.read_bytes()
        with zipfile.ZipFile(result.archive_path) as archive:
            names = archive.namelist()
            self.assertIn("index.html", names)
            self.assertIn("release.json", names)
            meta = json.loads(archive.read("release.json"))
            prefix = meta["entry"].removesuffix("index.html")
            self.assertTrue(prefix.startswith("releases/v9-8-7-"))
            html = archive.read(meta["entry"]).decode()
            self.assertLess(html.index("js/core/version.js"), html.index("js/app.js"))
            self.assertEqual(html.count('src="js/app.js"'), 1)
            self.assertEqual(archive.read(prefix + "js/app.js"), b"window.testValue = 1;")
            self.assertFalse(any("private" in n or n.endswith(".py") for n in names))
            self.assertEqual(len(names), len(set(names)))
            self.assertIsNone(archive.testzip())
        self.assertEqual(self.build().archive_path.read_bytes(), original)

    def test_missing_css_dependency_refuses_publication(self):
        old = self.build().archive_path.read_bytes()
        (self.root / "app/assets/icon.svg").unlink()
        with self.assertRaises(builder.ReleaseBuildError):
            self.build()
        self.assertEqual((self.root / "dist/ZeTer-OS-uCoz-FTP-9.8.7.zip").read_bytes(), old)

    def test_release_directory_is_accepted_by_ucoz(self):
        result = self.build()
        self.assertRegex(result.build_id, r"^[A-Za-z0-9_-]+$")
        self.assertLessEqual(len(result.build_id), 45)

    def test_changed_content_changes_build_address_and_keeps_old_zip(self):
        old = self.build()
        (self.root / "app/js/app.js").write_text("window.testValue = 2;", encoding="utf-8")
        with self.assertRaises(builder.ReleaseBuildError):
            self.build()
        new = builder.build_ucoz(self.root, self.root / "other-output")
        self.assertNotEqual(old.build_id, new.build_id)

    def test_output_must_not_be_inside_source_or_data(self):
        for path in [self.root, self.root / "app/output", self.root / "data/output"]:
            with self.subTest(path=path), self.assertRaises(builder.ReleaseBuildError):
                builder.build_ucoz(self.root, path)

    def test_unknown_registration_contract_fails_closed(self):
        path = self.root / "app/js/core/shell-ui-utils.js"
        path.write_text("// changed registration owner", encoding="utf-8")
        with self.assertRaises(builder.ReleaseBuildError):
            self.build()

    def test_failed_zip_validation_keeps_previous_result(self):
        old = self.build().archive_path.read_bytes()
        with patch.object(builder, "validate_archive", side_effect=builder.ReleaseBuildError("injected")):
            with self.assertRaises(builder.ReleaseBuildError):
                self.build()
        self.assertEqual((self.root / "dist/ZeTer-OS-uCoz-FTP-9.8.7.zip").read_bytes(), old)

    @unittest.skipUnless(shutil.which("node"), "Node required for actual worker runtime regression")
    def test_worker_keeps_complete_A_if_new_entry_is_unavailable(self):
        code = r'''
const vm = require("node:vm");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const base = "https://example.test/portfolio/ZeTerOS/";
const buildA = "v9-8-7-aaaaaaaaaaaaaaaa", buildB = "v9-8-7-bbbbbbbbbbbbbbbb";
const entryA = new URL("releases/" + buildA + "/index.html", base).href;
const entryB = new URL("releases/" + buildB + "/index.html", base).href;
const sandbox = { URL, Request, Response, Date, Math, Set, console,
  self: { registration: { scope: base }, addEventListener() {} },
  caches: { keys: async () => ["zeter-ucoz-/portfolio/ZeTerOS/-" + buildA],
    open: async () => ({ match: async req => {
      const key = typeof req === "string" ? req : req.url;
      if (key.endsWith(".ucoz-complete")) return new Response(buildA);
      if (key === entryA) return new Response("complete A");
    } }) },
  fetch: async req => {
    const url = typeof req === "string" ? req : req.url;
    if (url.includes("release.json")) return Response.json({schema:1,build:buildB,entry:"releases/"+buildB+"/index.html"});
    if (url === entryB) return new Response("unavailable B", {status:503});
    return new Response("unexpected", {status:404});
  }
};
vm.createContext(sandbox);
vm.runInContext("const BUILD=" + JSON.stringify(buildA) + ";const ASSETS=[];" + fs.readFileSync(0,"utf8"), sandbox);
(async () => {
  const response = await sandbox.navigate(new Request(entryA));
  assert.equal(response.status, 200, "available A must not redirect to broken B");
  assert.equal(await response.text(), "complete A");
  const failedB = await sandbox.navigate(new Request(entryB));
  assert.equal(failedB.status, 503, "failed B must terminate rather than loop back to A");
})().catch(error => { console.error(error); process.exitCode=1; });
'''
        result = subprocess.run([shutil.which("node"), "-e", code],
            input=builder.WORKER, text=True, encoding="utf-8", capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
