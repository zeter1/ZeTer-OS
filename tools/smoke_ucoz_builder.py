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
import prepare_web


class UcozBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="zeter-ucoz-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "Проект с пробелами"
        files = {
            "index.html": '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; base-uri \'none\'"><link rel="manifest" href="manifest.json"><link rel="stylesheet" href="css/style.css"><script src="js/core/version.js"></script><script src="js/core/shell-ui-utils.js"></script><script src="js/app.js"></script></head><body></body></html>',
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

    def test_direct_manifest_tracks_all_bytes_and_excludes_private_state(self):
        html = self.root / "app/index.html"
        html.write_text(html.read_text(encoding="utf-8").replace('<script src="', '<script type="application/zeter-script" src="'), encoding="utf-8")
        (self.root / "app/js/web-bootstrap.js").write_text("// gate", encoding="utf-8")
        rendered = prepare_web.render_manifest(self.root)
        manifest = self.root / "app/web-release.json"
        manifest.write_bytes(rendered)
        self.assertTrue(prepare_web.check_manifest(self.root))
        self.assertEqual(rendered, prepare_web.render_manifest(self.root))
        paths = {file["path"] for file in json.loads(rendered)["files"]}
        self.assertIn("assets/icon.svg", paths)
        self.assertNotIn("web-release.json", paths)
        self.assertNotIn("private.json", paths)
        (self.root / "app/assets/icon.svg").write_text("<svg/>", encoding="utf-8")
        self.assertFalse(prepare_web.check_manifest(self.root))
        self.assertEqual((self.root / "data/private.json").read_text(encoding="utf-8"), "private")

    def test_direct_manifest_rejects_application_script_before_gate(self):
        (self.root / "app/js/web-bootstrap.js").write_text("// gate", encoding="utf-8")
        with self.assertRaisesRegex(builder.ReleaseBuildError, "Скрипты приложения"):
            prepare_web.render_manifest(self.root)

    def test_structure_original_order_and_deterministic_bytes(self):
        result = self.build()
        original = result.archive_path.read_bytes()
        with zipfile.ZipFile(result.archive_path) as archive:
            names = archive.namelist()
            self.assertIn("index.html", names)
            self.assertIn("release.json", names)
            meta = json.loads(archive.read("release.json"))
            prefix = meta["entry"].removesuffix("index.html")
            self.assertRegex(prefix, r"^releases/v[0-9a-f]{14}/$")
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

    @unittest.skipUnless(shutil.which("node"), "Node required for actual entry bootstrap regression")
    def test_entry_keeps_permanent_url_and_immutable_resource_base(self):
        result = self.build()
        with zipfile.ZipFile(result.archive_path) as archive:
            meta = json.loads(archive.read("release.json"))
            prefix = meta["entry"].removesuffix("index.html")
            html = archive.read(meta["entry"]).decode()
            self.assertIn('<base href="./" data-zeter-ucoz>', html)
            self.assertLess(html.index('src="ucoz-entry.js"'), html.index('href="css/style.css"'))
            bootstrap = archive.read(prefix + "ucoz-entry.js").decode()
        code = r'''
const vm=require("node:vm"), assert=require("node:assert/strict"), fs=require("node:fs");
const code=fs.readFileSync(0,"utf8");
for(const folder of ["/portfolio/ZeTerOS/", "/other/path/", "/"]){
 for (const id of ["v9-8-7-aaaaaaaaaaaaaaaa", "v0123456789abcd"]) {
 const release=folder+"releases/"+id+"/";
 const base={href:"./"}, state={saved:"unchanged"}; let changed;
 const sandbox={URL, document:{currentScript:{src:"https://example.test"+release+"ucoz-entry.js"},querySelector:()=>base},
   location:new URL("https://example.test"+release+"index.html?probe=1#section"),
   history:{state,replaceState:(s,title,url)=>{assert.equal(s,state);changed=url;}}};
 vm.runInNewContext(code,sandbox);
 assert.equal(changed,"https://example.test"+folder+"index.html?probe=1#section");
 assert.equal(base.href,"https://example.test"+release);
 assert.equal(new URL("css/style.css",base.href).pathname,release+"css/style.css");
 assert.equal(new URL("../../service-worker.js",base.href).pathname,folder+"service-worker.js");
 }
}
'''
        executed = subprocess.run([shutil.which("node"), "-e", code], input=bootstrap,
            text=True, encoding="utf-8", capture_output=True, timeout=15)
        self.assertEqual(executed.returncode, 0, executed.stdout + executed.stderr)

    def test_release_directory_is_accepted_by_ucoz(self):
        result = self.build()
        self.assertRegex(result.build_id, r"^[A-Za-z0-9_-]+$")
        self.assertLessEqual(len(result.build_id), 15)

    def test_directory_names_over_panel_limit_are_rejected(self):
        with self.assertRaises(builder.ReleaseBuildError):
            builder.validate_ucoz_paths({"folder1234567890x/file.js": b""})

    def test_changed_content_changes_build_address_and_keeps_old_zip(self):
        old = self.build()
        (self.root / "app/js/app.js").write_text("window.testValue = 2;", encoding="utf-8")
        with self.assertRaises(builder.ReleaseBuildError):
            self.build()
        new = builder.build_ucoz(self.root, self.root / "other-output")
        self.assertNotEqual(old.build_id, new.build_id)

    def test_runtime_patch_keeps_existing_release_and_contains_only_worker(self):
        old = self.build()
        original = old.archive_path.read_bytes()
        patched = builder.build_runtime_patch(old.archive_path, self.root / "runtime-patch")
        self.assertEqual(patched.build_id, old.build_id)
        self.assertEqual(patched.version, old.version)
        self.assertEqual(old.archive_path.read_bytes(), original)
        plan = json.loads((patched.archive_path.parent / "upload-plan.json").read_text(encoding="utf-8"))
        self.assertEqual([item["path"] for item in plan["uploads"]], ["service-worker.js"])
        with zipfile.ZipFile(patched.archive_path) as archive:
            self.assertEqual(archive.namelist(), ["service-worker.js"])
            worker = archive.read("service-worker.js").decode()
        self.assertIn(json.dumps(old.build_id), worker)
        self.assertIn('const RUNTIME = "2";', worker)

    def test_runtime_patch_rejects_wrong_entry_and_keeps_output_absent(self):
        old = self.build()
        broken = self.root / "broken.zip"
        with zipfile.ZipFile(old.archive_path) as source, zipfile.ZipFile(broken, "w") as target:
            for name in source.namelist():
                data = source.read(name)
                if name == "release.json":
                    meta = json.loads(data)
                    meta["entry"] = "../private/index.html"
                    data = json.dumps(meta).encode()
                target.writestr(name, data)
        output = self.root / "must-stay-absent"
        with self.assertRaises(builder.ReleaseBuildError):
            builder.build_runtime_patch(broken, output)
        self.assertFalse(output.exists())

    def test_runtime_patch_detects_outputs_created_during_zip_publication(self):
        old = self.build()
        output = self.root / "concurrent-output"
        original = builder.publish_archive
        def publish_with_competing_outputs(*args):
            result = original(*args)
            (output / "service-worker.js").write_bytes(b"foreign worker")
            (output / "upload-plan.json").write_bytes(b"foreign plan")
            return result
        with patch.object(builder, "publish_archive", side_effect=publish_with_competing_outputs):
            with self.assertRaises(builder.ReleaseBuildError):
                builder.build_runtime_patch(old.archive_path, output)
        self.assertEqual((output / "service-worker.js").read_bytes(), b"foreign worker")
        self.assertEqual((output / "upload-plan.json").read_bytes(), b"foreign plan")

    def test_release_address_is_payload_hash_not_root_runtime_hash(self):
        with patch.object(builder, "__file__", str(self.root / "absent-runtime-source.py")):
            first = builder.prepare_files(self.root)
            with patch.object(builder, "WORKER", builder.WORKER + "\n// root-only revision\n"):
                second = builder.prepare_files(self.root)
        self.assertEqual(first[1], second[1])
        self.assertNotEqual(first[2]["service-worker.js"], second[2]["service-worker.js"])

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
    def test_router_activation_is_independent_from_offline_download(self):
        result = subprocess.run([shutil.which("node"), str(Path(__file__).with_name("smoke_ucoz_runtime.js"))],
            input=builder.WORKER, text=True, encoding="utf-8", capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

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
let offline = false;
const sandbox = { URL, Request, Response, Date, Math, Set, console,
  self: { registration: { scope: base }, addEventListener() {} },
  caches: { keys: async () => ["zeter-ucoz-/portfolio/ZeTerOS/-" + buildA],
    open: async () => ({ match: async req => {
      const key = typeof req === "string" ? req : req.url;
      if (key.endsWith(".ucoz-complete")) return new Response(buildA);
      if (key === entryA) return new Response("complete A");
    } }) },
  fetch: async req => {
    if (offline) throw new Error("offline fixture");
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
  offline = true;
  const permanent = await sandbox.navigate(new Request(base + "index.html?probe=1"));
  assert.equal(permanent.status, 302);
  assert.equal(permanent.headers.get("Location"), entryA + "?probe=1");
  const offlineEntry = await sandbox.navigate(new Request(permanent.headers.get("Location")));
  assert.equal(offlineEntry.status, 200, "query must not hide the complete offline HTML entry");
  assert.equal(await offlineEntry.text(), "complete A");
})().catch(error => { console.error(error); process.exitCode=1; });
'''
        result = subprocess.run([shutil.which("node"), "-e", code],
            input=builder.WORKER, text=True, encoding="utf-8", capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
