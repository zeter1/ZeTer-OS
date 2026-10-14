"""Documentation tooling regression checks; no app import, GUI or real state.

Only navigation_index/check_project are imported (read-only module definitions).
Link fixtures and the Python module which must never execute live in TemporaryDirectory.
"""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_project as checker
import navigation_index as navigation


class DocumentationSmoke(unittest.TestCase):
    def check_links(self, source: str, target: str = ""):
        with tempfile.TemporaryDirectory(prefix="zeter-docs-") as temp:
            root = Path(temp)
            document = root / "README.md"
            document.write_text(source, encoding="utf-8")
            (root / "Другой файл.md").write_text(target, encoding="utf-8")
            with patch.object(checker, "PROJECT_ROOT", root), patch.object(checker, "REQUIRED_DOCS", (document,)):
                return checker.check_docs_links()

    def test_missing_same_document_anchor_is_rejected(self):
        results = self.check_links("# Начало\n\n[переход](#нет-раздела)\n")
        self.assertEqual(results[0].status, "FAIL")
        self.assertIn("нет-раздела", results[0].message)

    def test_unicode_percent_encoded_and_duplicate_headings(self):
        results = self.check_links(
            "[первый](<Другой файл.md#данные-и-id>)\n"
            "[повтор](Другой%20файл.md#данные-и-id-1)\n"
            "[явный](Другой%20файл.md#custom)\n"
            "[unicode](Другой%20файл.md#%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D0%B5-%D0%B8-id)\n",
            "# Данные и `ID`\n\n## Данные и ID\n\n<a id=\"custom\"></a>\n",
        )
        self.assertEqual(results[0].status, "OK", results[0].message)

    def test_code_fence_heading_does_not_make_a_valid_anchor(self):
        results = self.check_links("[переход](#ложный)\n\n```markdown\n# Ложный\n```\n")
        self.assertEqual(results[0].status, "FAIL")

    def test_setext_and_formatted_heading(self):
        results = self.check_links("[переход](#проверка-данных)\n\nПроверка **данных**\n---\n")
        self.assertEqual(results[0].status, "OK", results[0].message)

    def test_path_escape_stays_rejected_and_external_link_is_ignored(self):
        results = self.check_links("[внешний](https://example.invalid/#missing)\n[выход](../outside.md#x)\n")
        self.assertEqual(results[0].status, "FAIL")
        self.assertIn("escapes project", results[0].message)

    def test_missing_fragment_in_existing_file_is_rejected(self):
        results = self.check_links("[переход](Другой%20файл.md#нет-раздела)\n", "# Настоящий\n")
        self.assertEqual(results[0].status, "FAIL")
        self.assertIn("нет-раздела", results[0].message)

    def test_python_symbol_lookup_reads_ast_without_importing_module(self):
        with tempfile.TemporaryDirectory(prefix="zeter-owner-") as temp:
            root = Path(temp)
            (root / "native.py").write_text(
                "raise RuntimeError('this module must never execute')\n"
                "class NativeApi:\n    def get_metrics(self):\n        return {}\n",
                encoding="utf-8",
            )
            manifest = {"python_owners": [{
                "id": "native-metrics", "title": "Native metrics", "path": "native.py",
                "anchors": ["NativeApi"], "keywords": ["metrics"],
                "js": [], "docs": [], "smokes": [],
            }]}
            with patch.object(navigation, "PROJECT_ROOT", root), patch.object(navigation, "core_api_records", return_value=[]):
                results = navigation.search_owner_records("get_metrics", manifest=manifest)
            self.assertEqual(len(results), 1)
            self.assertEqual(results[0]["kind"], "python")
            self.assertEqual(results[0]["data"]["symbols"], ["NativeApi.get_metrics"])

    def test_python_manifest_rejects_missing_anchor(self):
        manifest = copy.deepcopy(navigation.load_owner_manifest())
        manifest["python_owners"] = [{
            "id": "broken-native", "title": "Broken native", "path": "run_zeter_os.py",
            "anchors": ["NonexistentNativeApi"], "keywords": ["native"],
            "js": ["app/js/app.js"], "docs": ["docs/NATIVE_BRIDGE.md"], "smokes": [],
        }]
        failures = navigation.validate_owner_manifest(manifest)
        self.assertTrue(any("NonexistentNativeApi" in failure for failure in failures), failures)

    def test_python_cli_returns_owner_contract(self):
        completed = subprocess.run(
            [sys.executable, "-B", str(navigation.PROJECT_ROOT / "tools/find_owner.py"), "get_system_metrics", "--json"],
            capture_output=True, text=True, encoding="utf-8", timeout=20, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
        results = json.loads(completed.stdout)["results"]
        owner = next(item for item in results if item["kind"] == "python")
        self.assertEqual(owner["data"]["path"], "run_zeter_os.py")
        self.assertIn("NativeStorageApi.get_system_metrics", owner["data"]["symbols"])
        self.assertIn("docs/NATIVE_BRIDGE.md", owner["data"]["docs"])
        self.assertIn("tools/smoke_managed_file_native.py", owner["data"]["smokes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
