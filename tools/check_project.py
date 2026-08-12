from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable

from navigation_index import (
    GENERATED_NAVIGATION_DOCS,
    MANIFEST_PATH as OWNER_MANIFEST_JSON,
    generated_navigation_docs,
    load_owner_manifest,
    validate_owner_manifest,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = PROJECT_ROOT / "app"
CSS_ENTRY = APP_DIR / "css" / "style.css"
INDEX_HTML = APP_DIR / "index.html"
SERVICE_WORKER = APP_DIR / "service-worker.js"
VERSION_JS = APP_DIR / "js" / "core" / "version.js"
APP_JS = APP_DIR / "js" / "app.js"
PYTHON_ENTRY = PROJECT_ROOT / "run_zeter_os.py"
AGENTS_MD = PROJECT_ROOT / "AGENTS.md"
MANIFEST_JSON = APP_DIR / "manifest.json"
DOCS_DIR = PROJECT_ROOT / "docs"
CODEMAP_MD = DOCS_DIR / "CODEMAP.md"
MODULE_DEPENDENCIES_MD = DOCS_DIR / "MODULE_DEPENDENCIES.md"
NATIVE_BRIDGE_MD = DOCS_DIR / "NATIVE_BRIDGE.md"
TROUBLESHOOTING_MD = DOCS_DIR / "TROUBLESHOOTING.md"
GLOSSARY_MD = DOCS_DIR / "GLOSSARY.md"
TESTING_MD = DOCS_DIR / "TESTING.md"
UPDATE_DOCS_TOOL = PROJECT_ROOT / "tools" / "update_docs.py"
NAVIGATION_INDEX_TOOL = PROJECT_ROOT / "tools" / "navigation_index.py"
FIND_OWNER_TOOL = PROJECT_ROOT / "tools" / "find_owner.py"
CHECK_PROJECT_CMD = PROJECT_ROOT / "check_project.cmd"
BUILD_RELEASE_CMD = PROJECT_ROOT / "build_release.cmd"
BUILD_RELEASE_TOOL = PROJECT_ROOT / "tools" / "build_release.py"
SMOKE_RUNNER = PROJECT_ROOT / "tools" / "run_smokes.js"
NATIVE_SMOKE = PROJECT_ROOT / "tools" / "smoke_managed_file_native.py"
RELEASE_SMOKE = PROJECT_ROOT / "tools" / "smoke_release_builder.py"
SMOKE_SCRIPTS = (
    PROJECT_ROOT / "tools" / "smoke_system_settings.js",
    PROJECT_ROOT / "tools" / "smoke_state_migration.js",
    PROJECT_ROOT / "tools" / "smoke_storage_runtime.js",
    PROJECT_ROOT / "tools" / "smoke_import_runtime.js",
    PROJECT_ROOT / "tools" / "smoke_export_runtime.js",
    PROJECT_ROOT / "tools" / "smoke_help_content.js",
)
CODEMAP_GENERATED_START = "<!-- BEGIN GENERATED CORE SUMMARY -->"
CODEMAP_GENERATED_END = "<!-- END GENERATED CORE SUMMARY -->"
ALLOWED_EXTERNAL_ZETER_GLOBALS = frozenset({"ZETER_PYTHON_STORAGE"})
REQUIRED_DOCS = (
    DOCS_DIR / "README.md",
    DOCS_DIR / "ARCHITECTURE.md",
    CODEMAP_MD,
    DOCS_DIR / "FRONTEND_WORKFLOW.md",
    DOCS_DIR / "EDITING_GUIDE.md",
    DOCS_DIR / "DATA_MODEL.md",
    NATIVE_BRIDGE_MD,
    MODULE_DEPENDENCIES_MD,
    TROUBLESHOOTING_MD,
    GLOSSARY_MD,
    TESTING_MD,
    DOCS_DIR / "HELP_MAINTENANCE.md",
    *GENERATED_NAVIGATION_DOCS,
)
REQUIRED_SCRIPT_ORDER = (
    "js/core/boot-guard.js",
    "js/core/version.js",
    "js/core/config.js",
    "js/core/utils.js",
    "js/core/system-settings-utils.js",
    "js/core/shortcut-utils.js",
    "js/core/shell-ui-utils.js",
    "js/core/first-run-ui-utils.js",
    "js/core/context-menu-ui-utils.js",
    "js/core/explorer-tab-utils.js",
    "js/core/explorer-ui-utils.js",
    "js/core/pinning-utils.js",
    "js/core/trash-utils.js",
    "js/core/desktop-layout-utils.js",
    "js/core/item-drag-ui-utils.js",
    "js/core/window-metrics-utils.js",
    "js/core/window-session-utils.js",
    "js/core/window-ui-utils.js",
    "js/core/sticky-utils.js",
    "js/core/native-storage.js",
    "js/core/managed-file-utils.js",
    "js/core/storage-utils.js",
    "js/core/asset-utils.js",
    "js/core/security-protection-utils.js",
    "js/core/visual-utils.js",
    "js/core/item-customization-utils.js",
    "js/core/desktop-profile-utils.js",
    "js/core/desktop-ui-utils.js",
    "js/core/start-ui-utils.js",
    "js/core/file-import-utils.js",
    "js/core/file-template-utils.js",
    "js/core/rich-text-utils.js",
    "js/core/markdown-utils.js",
    "js/core/editor-ui-utils.js",
    "js/core/data-normalizers.js",
    "js/core/workspace-utils.js",
    "js/core/state-maintenance-utils.js",
    "js/core/task-ui-utils.js",
    "js/core/task-app-ui-utils.js",
    "js/core/calendar-utils.js",
    "js/core/calendar-ui-utils.js",
    "js/core/notification-utils.js",
    "js/core/notification-ui-utils.js",
    "js/core/import-utils.js",
    "js/core/state-import-validator.js",
    "js/core/export-utils.js",
    "js/core/download-utils.js",
    "js/core/security-utils.js",
    "js/core/security-ui-utils.js",
    "js/core/readable-export-utils.js",
    "js/core/table-utils.js",
    "js/core/xlsx-utils.js",
    "js/core/table-ui-utils.js",
    "js/core/table-app-interactions.js",
    "js/core/calculator-utils.js",
    "js/core/calculator-ui-utils.js",
    "js/core/app-catalog.js",
    "js/core/item-metadata.js",
    "js/core/item-properties-ui-utils.js",
    "js/core/fs-item-utils.js",
    "js/core/explorer-utils.js",
    "js/core/help-content.js",
    "js/core/monitor-utils.js",
    "js/core/photo-ui-utils.js",
    "js/core/settings-ui-utils.js",
    "js/core/app-center-ui-utils.js",
    "js/core/search-utils.js",
    "js/core/initial-state-utils.js",
    "js/core/state-migration-utils.js",
    "js/core/search-ui-utils.js",
    "js/app.js",
)


@dataclass(frozen=True)
class CheckResult:
    name: str
    status: str
    message: str


@dataclass(frozen=True)
class CoreModuleContract:
    path: Path
    web_path: str
    export: str
    dependencies: tuple[str, ...]
    order: int
    lines: int


@dataclass(frozen=True)
class CodemapCoreModuleRow:
    project_path: str
    export: str
    description: str
    line_number: int


class LocalAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {name.lower(): value for name, value in attrs if value}
        if tag.lower() == "script":
            script_src = attr_map.get("src")
            if script_src and is_local_asset_reference(script_src):
                self.scripts.append(script_src)
        for attr_name in ("src", "href"):
            value = attr_map.get(attr_name)
            if value and is_local_asset_reference(value):
                self.assets.append(value)


def ok(name: str, message: str) -> CheckResult:
    return CheckResult(name, "OK", message)


def warn(name: str, message: str) -> CheckResult:
    return CheckResult(name, "WARN", message)


def fail(name: str, message: str) -> CheckResult:
    return CheckResult(name, "FAIL", message)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def is_local_asset_reference(value: str) -> bool:
    raw = value.strip()
    if not raw or raw.startswith("#"):
        return False
    lower = raw.lower()
    blocked_prefixes = ("http:", "https:", "data:", "blob:", "mailto:", "javascript:")
    return not lower.startswith(blocked_prefixes)


def strip_url_suffix(value: str) -> str:
    return value.split("#", 1)[0].split("?", 1)[0].strip()


def resolve_app_asset(reference: str) -> Path | None:
    clean = strip_url_suffix(reference)
    if clean in {"", ".", "./"}:
        return APP_DIR
    candidate = (APP_DIR / clean.lstrip("./")).resolve()
    try:
        candidate.relative_to(APP_DIR.resolve())
    except ValueError:
        return None
    return candidate


def check_required_files() -> list[CheckResult]:
    required = [
        INDEX_HTML,
        CSS_ENTRY,
        SERVICE_WORKER,
        VERSION_JS,
        APP_JS,
        PYTHON_ENTRY,
        MANIFEST_JSON,
        UPDATE_DOCS_TOOL,
        OWNER_MANIFEST_JSON,
        NAVIGATION_INDEX_TOOL,
        FIND_OWNER_TOOL,
        CHECK_PROJECT_CMD,
        BUILD_RELEASE_CMD,
        BUILD_RELEASE_TOOL,
        SMOKE_RUNNER,
        RELEASE_SMOKE,
        *SMOKE_SCRIPTS,
    ]
    missing = [str(path.relative_to(PROJECT_ROOT)) for path in required if not path.exists()]
    if missing:
        return [fail("required.files", "missing: " + ", ".join(missing))]
    return [ok("required.files", f"{len(required)} required files exist")]


def check_required_docs() -> list[CheckResult]:
    missing = [str(path.relative_to(PROJECT_ROOT)) for path in REQUIRED_DOCS if not path.exists()]
    if missing:
        return [fail("docs.required", "missing: " + ", ".join(missing))]

    invalid: list[str] = []
    for path in REQUIRED_DOCS:
        try:
            text = read_text(path)
        except (OSError, UnicodeError) as exc:
            invalid.append(f"{path.name}: {exc}")
            continue
        if not text.strip().startswith("# "):
            invalid.append(f"{path.name}: missing H1 heading")

    if invalid:
        return [fail("docs.required", "; ".join(invalid))]
    return [ok("docs.required", f"{len(REQUIRED_DOCS)} required Markdown files exist")]


def markdown_local_link_target(raw_target: str) -> str | None:
    raw = raw_target.strip()
    if not raw or raw.startswith("#"):
        return None
    if raw.startswith("<") and ">" in raw:
        raw = raw[1:raw.index(">")]
    else:
        raw = raw.split(maxsplit=1)[0]
    lower = raw.lower()
    blocked_prefixes = ("http:", "https:", "mailto:", "data:", "javascript:", "app:")
    if lower.startswith(blocked_prefixes):
        return None
    return strip_url_suffix(raw)


def check_docs_links() -> list[CheckResult]:
    if any(not path.exists() for path in REQUIRED_DOCS):
        return [fail("docs.links", "skipped because required documentation is missing")]

    pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
    failures: list[str] = []
    checked = 0
    root = PROJECT_ROOT.resolve()
    for document in REQUIRED_DOCS:
        for match in pattern.finditer(read_text(document)):
            target = markdown_local_link_target(match.group(1))
            if not target:
                continue
            checked += 1
            candidate = (document.parent / target).resolve()
            try:
                candidate.relative_to(root)
            except ValueError:
                failures.append(f"{document.name}: {target} escapes project")
                continue
            if not candidate.exists():
                failures.append(f"{document.name}: {target} not found")

    if failures:
        return [fail("docs.links", "; ".join(failures))]
    return [ok("docs.links", f"{checked} local Markdown links resolve")]


def core_module_files() -> list[Path]:
    return sorted((APP_DIR / "js" / "core").glob("*.js"), key=lambda path: path.name)


def check_core_module_coverage() -> list[CheckResult]:
    modules = core_module_files()
    if not modules:
        return [fail("core.coverage", "no app/js/core/*.js modules found")]
    if not INDEX_HTML.exists() or not SERVICE_WORKER.exists():
        return [fail("core.coverage", "index.html or service-worker.js is missing")]

    parser = LocalAssetParser()
    parser.feed(read_text(INDEX_HTML))
    index_scripts = [strip_url_suffix(src).replace("\\", "/").lstrip("./") for src in parser.scripts]
    cached_assets = {asset.replace("\\", "/").lstrip("./") for asset in parse_service_worker_assets(read_text(SERVICE_WORKER))}
    required_scripts = list(REQUIRED_SCRIPT_ORDER)
    failures: list[str] = []

    for module in modules:
        web_path = f"js/core/{module.name}"
        if index_scripts.count(web_path) != 1:
            failures.append(f"{web_path}: expected once in index.html")
        if required_scripts.count(web_path) != 1:
            failures.append(f"{web_path}: expected once in REQUIRED_SCRIPT_ORDER")
        if web_path not in cached_assets:
            failures.append(f"{web_path}: missing from ZETER_ASSETS")

    actual = {f"js/core/{module.name}" for module in modules}
    listed = {path for path in required_scripts if path.startswith("js/core/")}
    for stale in sorted(listed - actual):
        failures.append(f"{stale}: listed but file is missing")

    if failures:
        return [fail("core.coverage", "; ".join(failures))]
    return [ok("core.coverage", f"{len(modules)} core modules are indexed, ordered and cached")]


def core_public_exports(source: str) -> list[str]:
    direct = re.findall(r"window\.(ZETER_[A-Z0-9_]+)\s*=", source)
    defined = re.findall(
        r"Object\.defineProperty\(\s*window\s*,\s*['\"](ZETER_[A-Z0-9_]+)['\"]",
        source,
    )
    return [*direct, *defined]


def check_core_module_exports() -> list[CheckResult]:
    modules = core_module_files()
    if not modules:
        return [fail("core.exports", "no app/js/core/*.js modules found")]
    failures: list[str] = []
    for module in modules:
        exports = core_public_exports(read_text(module))
        if len(exports) != 1:
            failures.append(f"{module.name}: expected one window.ZETER_* export, found {len(exports)}")

    if failures:
        return [fail("core.exports", "; ".join(failures))]
    return [ok("core.exports", f"{len(modules)} core modules expose one global each")]


def parse_codemap_core_module_rows(text: str) -> tuple[list[CodemapCoreModuleRow], list[str]]:
    rows: list[CodemapCoreModuleRow] = []
    failures: list[str] = []
    path_pattern = re.compile(r"`(app/js/core/[^`/|]+\.js)`")
    export_pattern = re.compile(r"`(ZETER_[A-Z0-9_]+)`")

    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        body = stripped[1:-1] if stripped.endswith("|") else stripped[1:]
        cells = [cell.strip() for cell in re.split(r"(?<!\\)\|", body)]
        if not cells:
            continue
        path_match = path_pattern.fullmatch(cells[0])
        if not path_match:
            continue

        project_path = path_match.group(1)
        if len(cells) != 3:
            failures.append(f"CODEMAP.md:{line_number}: {project_path} row must have exactly 3 cells")
            continue

        export_match = export_pattern.fullmatch(cells[1])
        export = export_match.group(1) if export_match else ""
        if not export:
            failures.append(f"CODEMAP.md:{line_number}: {project_path} has an invalid public global")

        description = cells[2].strip()
        if not description:
            failures.append(f"CODEMAP.md:{line_number}: {project_path} has an empty description")

        rows.append(CodemapCoreModuleRow(
            project_path=project_path,
            export=export,
            description=description,
            line_number=line_number,
        ))

    return rows, failures


def codemap_manual_contract_failures(
    text: str,
    modules: Iterable[Path] | None = None,
) -> list[str]:
    module_list = list(modules) if modules is not None else core_module_files()
    rows, failures = parse_codemap_core_module_rows(text)
    actual_by_path = {f"app/js/core/{module.name}": module for module in module_list}
    rows_by_path: dict[str, list[CodemapCoreModuleRow]] = {}
    rows_by_export: dict[str, list[CodemapCoreModuleRow]] = {}

    for row in rows:
        rows_by_path.setdefault(row.project_path, []).append(row)
        if row.export:
            rows_by_export.setdefault(row.export, []).append(row)

    for project_path, module in actual_by_path.items():
        matching_rows = rows_by_path.get(project_path, [])
        if len(matching_rows) != 1:
            failures.append(f"{project_path}: expected exactly one manual CODEMAP.md row, found {len(matching_rows)}")
            continue
        exports = core_public_exports(read_text(module))
        if len(exports) != 1:
            failures.append(f"{module.name}: cannot validate CODEMAP.md mapping; found {len(exports)} exports")
            continue
        row = matching_rows[0]
        if row.export != exports[0]:
            shown_export = row.export or "<invalid>"
            failures.append(
                f"CODEMAP.md:{row.line_number}: {project_path} maps to {shown_export}, expected {exports[0]}"
            )

    for stale_path in sorted(set(rows_by_path) - set(actual_by_path)):
        failures.append(f"{stale_path}: manual CODEMAP.md row has no matching module")

    for export, matching_rows in sorted(rows_by_export.items()):
        if len(matching_rows) > 1:
            locations = ", ".join(str(row.line_number) for row in matching_rows)
            failures.append(f"{export}: duplicated in manual CODEMAP.md rows {locations}")

    return list(dict.fromkeys(failures))


def check_codemap_manual_contracts() -> list[CheckResult]:
    modules = core_module_files()
    if not modules or not CODEMAP_MD.exists():
        return [fail("codemap.manual_contracts", "core modules or CODEMAP.md are missing")]
    failures = codemap_manual_contract_failures(read_text(CODEMAP_MD), modules)
    if failures:
        return [fail("codemap.manual_contracts", "; ".join(failures))]
    return [ok(
        "codemap.manual_contracts",
        f"{len(modules)} manual module rows match their globals and descriptions",
    )]


def markdown_h2_section(text: str, heading: str) -> str | None:
    marker = f"## {heading}"
    lines = text.splitlines()
    try:
        start = next(index for index, line in enumerate(lines) if line.strip() == marker) + 1
    except StopIteration:
        return None
    end = next(
        (index for index in range(start, len(lines)) if lines[index].startswith("## ")),
        len(lines),
    )
    return "\n".join(lines[start:end])


def parse_codemap_app_anchors(text: str) -> tuple[list[str], list[str]]:
    section = markdown_h2_section(text, "Области app.js")
    if section is None:
        return [], ["CODEMAP.md: missing 'Области app.js' section"]

    anchors: list[str] = []
    failures: list[str] = []
    for line in section.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if not cells or cells[0] in {"Область", "---"} or set(cells[0]) <= {"-", ":"}:
            continue
        if len(cells) != 2:
            failures.append(f"CODEMAP.md app.js row must have 2 cells: {stripped}")
            continue
        row_anchors = re.findall(r"`([A-Za-z_$][A-Za-z0-9_$]*)`", cells[1])
        if not row_anchors:
            failures.append(f"CODEMAP.md app.js row has no anchors: {stripped}")
            continue
        anchors.extend(row_anchors)

    if not anchors:
        failures.append("CODEMAP.md app.js anchor table is empty")
    return anchors, failures


def check_codemap_app_anchors() -> list[CheckResult]:
    if not CODEMAP_MD.exists() or not APP_JS.exists():
        return [fail("codemap.app_anchors", "CODEMAP.md or app.js is missing")]

    anchors, failures = parse_codemap_app_anchors(read_text(CODEMAP_MD))
    app_text = read_text(APP_JS)
    for anchor in anchors:
        pattern = rf"(?<![A-Za-z0-9_$]){re.escape(anchor)}(?![A-Za-z0-9_$])"
        if not re.search(pattern, app_text):
            failures.append(f"{anchor}: not found in app/js/app.js")

    if failures:
        return [fail("codemap.app_anchors", "; ".join(failures))]
    return [ok("codemap.app_anchors", f"{len(anchors)} app.js search anchors resolve")]


def index_script_web_paths() -> list[str]:
    if not INDEX_HTML.exists():
        return []
    parser = LocalAssetParser()
    parser.feed(read_text(INDEX_HTML))
    return [strip_url_suffix(src).replace("\\", "/").lstrip("./") for src in parser.scripts]


def analyze_core_module_contracts() -> tuple[list[CoreModuleContract], list[str]]:
    modules = core_module_files()
    scripts = index_script_web_paths()
    failures: list[str] = []
    exports_by_path: dict[Path, str] = {}
    path_by_export: dict[str, Path] = {}

    for module in modules:
        exports = core_public_exports(read_text(module))
        if len(exports) != 1:
            failures.append(f"{module.name}: expected one export, found {len(exports)}")
            continue
        export = exports[0]
        if export in path_by_export:
            failures.append(f"{export}: exported by both {path_by_export[export].name} and {module.name}")
            continue
        exports_by_path[module] = export
        path_by_export[export] = module

    contracts: list[CoreModuleContract] = []
    for module in modules:
        export = exports_by_path.get(module)
        if not export:
            continue
        source = read_text(module)
        references = set(re.findall(r"window\.(ZETER_[A-Z0-9_]+)", source))
        references.discard(export)
        unknown = references - set(path_by_export) - set(ALLOWED_EXTERNAL_ZETER_GLOBALS)
        for name in sorted(unknown):
            failures.append(f"{module.name}: unknown global {name}")

        dependencies = sorted(
            references & set(path_by_export),
            key=lambda name: scripts.index(f"js/core/{path_by_export[name].name}")
            if f"js/core/{path_by_export[name].name}" in scripts
            else len(scripts),
        )
        web_path = f"js/core/{module.name}"
        if web_path not in scripts:
            failures.append(f"{module.name}: missing from index.html")
            order = len(scripts) + 1
        else:
            order = scripts.index(web_path) + 1

        for dependency in dependencies:
            dependency_path = f"js/core/{path_by_export[dependency].name}"
            if dependency_path not in scripts:
                failures.append(f"{module.name}: dependency {dependency} is missing from index.html")
            elif scripts.index(dependency_path) >= order - 1:
                failures.append(f"{module.name}: dependency {dependency} loads too late")

        contracts.append(CoreModuleContract(
            path=module,
            web_path=web_path,
            export=export,
            dependencies=tuple(dependencies),
            order=order,
            lines=len(source.splitlines()),
        ))

    known_exports = set(path_by_export)
    if APP_JS.exists():
        app_references = set(re.findall(r"window\.(ZETER_[A-Z0-9_]+)", read_text(APP_JS)))
        unknown_app = app_references - known_exports - set(ALLOWED_EXTERNAL_ZETER_GLOBALS)
        for name in sorted(unknown_app):
            failures.append(f"app.js: unknown global {name}")

    contract_by_export = {contract.export: contract for contract in contracts}
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(export: str, trail: tuple[str, ...]) -> None:
        if export in visiting:
            failures.append("dependency cycle: " + " -> ".join((*trail, export)))
            return
        if export in visited or export not in contract_by_export:
            return
        visiting.add(export)
        for dependency in contract_by_export[export].dependencies:
            visit(dependency, (*trail, export))
        visiting.remove(export)
        visited.add(export)

    for contract in contracts:
        visit(contract.export, ())

    contracts.sort(key=lambda item: item.order)
    return contracts, list(dict.fromkeys(failures))


def check_core_dependencies() -> list[CheckResult]:
    contracts, failures = analyze_core_module_contracts()
    if failures:
        return [fail("core.dependencies", "; ".join(failures))]
    edges = sum(len(contract.dependencies) for contract in contracts)
    return [ok("core.dependencies", f"{edges} dependency edges load in a valid acyclic order")]


def render_module_dependencies_markdown() -> str:
    contracts, failures = analyze_core_module_contracts()
    if failures:
        raise ValueError("Cannot render module dependencies: " + "; ".join(failures))
    edges = sum(len(contract.dependencies) for contract in contracts)
    lines = [
        "# Зависимости core-модулей ZeTer OS",
        "",
        "> Этот файл генерируется командой `python tools/update_docs.py --write`. Не редактируй таблицу вручную.",
        "",
        f"- Core-модулей: {len(contracts)}.",
        f"- Публичных глобалов: {len(contracts)}.",
        f"- Статических зависимостей: {edges}.",
        "- Порядок взят из `app/index.html`; каждая зависимость должна загружаться раньше потребителя.",
        "",
        "Назначение модулей описано в [CODEMAP.md](CODEMAP.md), правила направления зависимостей — в [ARCHITECTURE.md](ARCHITECTURE.md).",
        "",
        "| № | Модуль | Публичный глобал | Зависимости | Строк |",
        "|---:|---|---|---|---:|",
    ]
    for contract in contracts:
        dependencies = ", ".join(f"`{name}`" for name in contract.dependencies) or "—"
        lines.append(
            f"| {contract.order} | `app/js/core/{contract.path.name}` | "
            f"`{contract.export}` | {dependencies} | {contract.lines} |"
        )
    lines.extend((
        "",
        "При добавлении, удалении, переименовании core-модуля или изменении порядка загрузки обнови `app/index.html`, `app/service-worker.js` и `REQUIRED_SCRIPT_ORDER`. После любых изменений core-модулей запусти генератор документации и строгую проверку проекта.",
        "",
    ))
    return "\n".join(lines)


def render_codemap_generated_summary() -> str:
    contracts, failures = analyze_core_module_contracts()
    if failures:
        raise ValueError("Cannot render CODEMAP summary: " + "; ".join(failures))
    edges = sum(len(contract.dependencies) for contract in contracts)
    return "\n".join((
        CODEMAP_GENERATED_START,
        "> Этот блок обновляется командой `python tools/update_docs.py --write`.",
        "",
        f"- Core-модулей: {len(contracts)}.",
        f"- Публичных глобалов: {len(contracts)}.",
        f"- Статических зависимостей: {edges}.",
        "- Подробный порядок: [MODULE_DEPENDENCIES.md](MODULE_DEPENDENCIES.md).",
        CODEMAP_GENERATED_END,
    ))


def codemap_generated_block_bounds(text: str) -> tuple[int, int]:
    start_count = text.count(CODEMAP_GENERATED_START)
    end_count = text.count(CODEMAP_GENERATED_END)
    failures: list[str] = []
    if start_count != 1:
        failures.append(f"expected exactly one start marker, found {start_count}")
    if end_count != 1:
        failures.append(f"expected exactly one end marker, found {end_count}")
    if failures:
        raise ValueError("CODEMAP generated markers are invalid: " + "; ".join(failures))

    start = text.index(CODEMAP_GENERATED_START)
    end_start = text.index(CODEMAP_GENERATED_END)
    if start >= end_start:
        raise ValueError("CODEMAP generated markers are invalid: start marker must precede end marker")
    return start, end_start + len(CODEMAP_GENERATED_END)


def replace_generated_block(text: str, replacement: str) -> str:
    start, end = codemap_generated_block_bounds(text)
    return text[:start] + replacement + text[end:]


def generated_doc_mismatches() -> list[str]:
    mismatches: list[str] = []
    expected_dependencies = render_module_dependencies_markdown().replace("\r\n", "\n")
    actual_dependencies = read_text(MODULE_DEPENDENCIES_MD).replace("\r\n", "\n") if MODULE_DEPENDENCIES_MD.exists() else ""
    if actual_dependencies != expected_dependencies:
        mismatches.append("docs/MODULE_DEPENDENCIES.md")

    if not CODEMAP_MD.exists():
        mismatches.append("docs/CODEMAP.md")
    else:
        current = read_text(CODEMAP_MD).replace("\r\n", "\n")
        expected = replace_generated_block(current, render_codemap_generated_summary())
        if expected != current:
            mismatches.append("docs/CODEMAP.md generated summary")

    manifest = load_owner_manifest()
    manifest_failures = validate_owner_manifest(manifest)
    if manifest_failures:
        raise ValueError("Invalid tools/code_owners.json: " + "; ".join(manifest_failures))
    for path, expected in generated_navigation_docs(manifest).items():
        actual = read_text(path).replace("\r\n", "\n") if path.exists() else ""
        if actual != expected.replace("\r\n", "\n"):
            mismatches.append(path.relative_to(PROJECT_ROOT).as_posix())
    return mismatches


def check_generated_docs() -> list[CheckResult]:
    try:
        mismatches = generated_doc_mismatches()
    except (OSError, UnicodeError, ValueError) as exc:
        return [fail("docs.generated", str(exc))]
    if mismatches:
        return [fail("docs.generated", "stale: " + ", ".join(mismatches) + "; run tools/update_docs.py --write")]
    return [ok("docs.generated", "dependency, API, scenario, UI and state maps are current")]


def check_owner_manifest() -> list[CheckResult]:
    try:
        manifest = load_owner_manifest()
        failures = validate_owner_manifest(manifest)
    except (OSError, UnicodeError, ValueError) as exc:
        return [fail("navigation.owners", str(exc))]
    if failures:
        return [fail("navigation.owners", "; ".join(failures))]
    return [ok(
        "navigation.owners",
        f"{len(manifest['scenarios'])} scenarios, {len(manifest['ui_contracts'])} UI contracts and "
        f"{len(manifest['state_lifecycle'])} state lifecycles resolve",
    )]


def check_owner_lookup() -> list[CheckResult]:
    fixtures = (
        ("explorer preview", "explorer-preview"),
        ("task reminder", "tasks"),
        ("createSearchController", "ZETER_SEARCH_UI_UTILS"),
    )
    failures: list[str] = []
    for query, expected_id in fixtures:
        try:
            completed = subprocess.run(
                [sys.executable, "-X", "utf8", str(FIND_OWNER_TOOL), query, "--json"],
                cwd=PROJECT_ROOT,
                text=True,
                encoding="utf-8",
                capture_output=True,
                check=False,
                timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            failures.append(f"{query!r}: {exc}")
            continue
        if completed.returncode != 0:
            details = (completed.stderr or completed.stdout or "lookup failed").strip()
            failures.append(f"{query!r}: {details}")
            continue
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError as exc:
            failures.append(f"{query!r}: invalid JSON: {exc}")
            continue
        result_ids = [item.get("id") for item in payload.get("results", [])]
        if expected_id not in result_ids:
            failures.append(f"{query!r}: expected {expected_id}, got {result_ids}")
    if failures:
        return [fail("navigation.lookup", "; ".join(failures))]
    return [ok("navigation.lookup", f"{len(fixtures)} owner lookup fixtures pass")]


def check_docs_inventory() -> list[CheckResult]:
    expected = {path.resolve() for path in REQUIRED_DOCS}
    actual = {path.resolve() for path in DOCS_DIR.glob("*.md")}
    failures: list[str] = []
    for path in sorted(expected - actual):
        failures.append(f"missing {path.name}")
    for path in sorted(actual - expected):
        failures.append(f"unregistered {path.name}")

    docs_readme = DOCS_DIR / "README.md"
    if docs_readme.exists():
        index_text = read_text(docs_readme)
        for path in REQUIRED_DOCS:
            if path == docs_readme:
                continue
            if f"({path.name})" not in index_text:
                failures.append(f"README.md: missing link to {path.name}")

    if failures:
        return [fail("docs.inventory", "; ".join(failures))]
    return [ok("docs.inventory", f"{len(REQUIRED_DOCS)} docs are registered and indexed")]


def check_agents_doc_references() -> list[CheckResult]:
    if not AGENTS_MD.exists():
        return [fail("docs.agent_references", "AGENTS.md is missing")]
    references = sorted(set(re.findall(r"docs/[A-Z0-9_-]+\.md", read_text(AGENTS_MD), re.I)))
    missing = [reference for reference in references if not (PROJECT_ROOT / reference).exists()]
    if missing:
        return [fail("docs.agent_references", "missing: " + ", ".join(missing))]
    return [ok("docs.agent_references", f"{len(references)} AGENTS.md documentation references resolve")]


def check_agents_contract() -> list[CheckResult]:
    if not AGENTS_MD.exists():
        return [fail("docs.agent_contract", "AGENTS.md is missing")]

    text = read_text(AGENTS_MD)
    failures: list[str] = []
    first_line = text.splitlines()[0].strip() if text.splitlines() else ""
    if first_line != "# Repository Guidelines":
        failures.append("H1 must be '# Repository Guidelines'")

    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]+(?:[-_][A-Za-zА-Яа-яЁё0-9]+)*", text)
    if not 200 <= len(words) <= 400:
        failures.append(f"word count is {len(words)}, expected 200-400")

    obsolete = sorted(set(re.findall(r"APP_JS_REFACTOR_[A-Z0-9_]+\.md", text)))
    if obsolete:
        failures.append("obsolete refactor docs: " + ", ".join(obsolete))

    if failures:
        return [fail("docs.agent_contract", "; ".join(failures))]
    return [ok("docs.agent_contract", f"AGENTS.md has the required title and {len(words)} words")]


def native_storage_api_methods() -> set[str]:
    tree = ast.parse(read_text(PYTHON_ENTRY), filename=str(PYTHON_ENTRY))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "NativeStorageApi":
            return {
                child.name
                for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and not child.name.startswith("_")
            }
    return set()


def native_storage_response_envelope_is_valid() -> bool:
    tree = ast.parse(read_text(PYTHON_ENTRY), filename=str(PYTHON_ENTRY))
    methods: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "NativeStorageApi":
            methods = {
                child.name: child
                for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
            }
            break

    def returned_dict(function_name: str) -> dict[str, ast.expr] | None:
        function = methods.get(function_name)
        if function is None:
            return None
        for node in ast.walk(function):
            if not isinstance(node, ast.Return) or not isinstance(node.value, ast.Dict):
                continue
            return {
                key.value: value
                for key, value in zip(node.value.keys, node.value.values)
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
        return None

    ok_result = returned_dict("_ok") or {}
    error_result = returned_dict("_error") or {}
    return (
        isinstance(ok_result.get("ok"), ast.Constant)
        and ok_result["ok"].value is True
        and isinstance(error_result.get("ok"), ast.Constant)
        and error_result["ok"].value is False
        and "error" in error_result
    )


def check_native_bridge_contract() -> list[CheckResult]:
    if not NATIVE_BRIDGE_MD.exists() or not PYTHON_ENTRY.exists():
        return [fail("native.bridge_contract", "NATIVE_BRIDGE.md or run_zeter_os.py is missing")]
    python_methods = native_storage_api_methods()
    documented = set(re.findall(r"(?m)^\| `([a-z][a-z0-9_]+)\(", read_text(NATIVE_BRIDGE_MD)))
    js_source = "\n".join(read_text(path) for path in sorted((APP_DIR / "js").rglob("*.js")))
    js_calls = set(re.findall(r"nativeStorageCall\(\s*['\"]([a-z][a-z0-9_]+)['\"]", js_source))
    js_calls.update(re.findall(r"pywebview\?\.api\?\.([a-z][a-z0-9_]+)", js_source))
    failures: list[str] = []
    if python_methods != documented:
        failures.append(
            "Python/docs mismatch: "
            f"missing docs={sorted(python_methods - documented)}, stale docs={sorted(documented - python_methods)}"
        )
    if js_calls != python_methods:
        failures.append(
            "Python/JS mismatch: "
            f"unused API={sorted(python_methods - js_calls)}, unknown calls={sorted(js_calls - python_methods)}"
        )
    if not native_storage_response_envelope_is_valid():
        failures.append("{ ok, error } response envelope was not found")
    if failures:
        return [fail("native.bridge_contract", "; ".join(failures))]
    return [ok("native.bridge_contract", f"{len(python_methods)} Python methods match JS calls and docs")]


def parse_css_imports(css_text: str) -> list[str]:
    pattern = re.compile(r"@import\s+(?:url\()?['\"]?([^'\"\);]+)", re.IGNORECASE)
    return [match.group(1).strip() for match in pattern.finditer(css_text)]


def check_css_imports() -> list[CheckResult]:
    if not CSS_ENTRY.exists():
        return [fail("css.imports", "app/css/style.css is missing")]
    imports = parse_css_imports(read_text(CSS_ENTRY))
    if not imports:
        return [warn("css.imports", "style.css has no @import rules")]

    failures: list[str] = []
    for reference in imports:
        target = (CSS_ENTRY.parent / strip_url_suffix(reference)).resolve()
        try:
            target.relative_to(CSS_ENTRY.parent.resolve())
        except ValueError:
            failures.append(f"{reference} escapes app/css")
            continue
        if not target.exists():
            failures.append(f"{reference} not found")

    if failures:
        return [fail("css.imports", "; ".join(failures))]
    return [ok("css.imports", f"{len(imports)} imported CSS files exist")]


def check_css_entry_contract() -> list[CheckResult]:
    if not CSS_ENTRY.exists():
        return [fail("css.entry_contract", "app/css/style.css is missing")]

    without_comments = re.sub(r"/\*.*?\*/", "", read_text(CSS_ENTRY), flags=re.S)
    import_line = re.compile(r"@import\s+url\(\s*['\"][^'\"]+['\"]\s*\)\s*;", re.I)
    invalid = [
        line.strip()
        for line in without_comments.splitlines()
        if line.strip() and not import_line.fullmatch(line.strip())
    ]
    if invalid:
        return [fail("css.entry_contract", "style.css must contain only comments and @import rules: " + "; ".join(invalid))]
    return [ok("css.entry_contract", "style.css contains only comments and @import rules")]


def parse_codemap_css_rows(text: str) -> tuple[list[str], list[str]]:
    section = markdown_h2_section(text, "CSS-модули")
    if section is None:
        return [], ["CODEMAP.md: missing 'CSS-модули' section"]

    paths: list[str] = []
    failures: list[str] = []
    path_pattern = re.compile(r"`(app/css/[^`/|]+\.css)`")
    for line in section.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if not cells or cells[0] in {"Файл", "---"} or set(cells[0]) <= {"-", ":"}:
            continue
        if len(cells) != 2:
            failures.append(f"CODEMAP.md CSS row must have 2 cells: {stripped}")
            continue
        match = path_pattern.fullmatch(cells[0])
        if not match:
            failures.append(f"CODEMAP.md CSS row has an invalid path: {stripped}")
            continue
        if not cells[1]:
            failures.append(f"CODEMAP.md CSS row has an empty description: {stripped}")
        paths.append(match.group(1))

    if not paths:
        failures.append("CODEMAP.md CSS table is empty")
    return paths, failures


def check_css_codemap_contract() -> list[CheckResult]:
    if not CSS_ENTRY.exists() or not CODEMAP_MD.exists():
        return [fail("css.codemap", "style.css or CODEMAP.md is missing")]

    documented, failures = parse_codemap_css_rows(read_text(CODEMAP_MD))
    imported: list[str] = []
    for reference in parse_css_imports(read_text(CSS_ENTRY)):
        target = (CSS_ENTRY.parent / strip_url_suffix(reference)).resolve()
        try:
            imported.append(target.relative_to(PROJECT_ROOT.resolve()).as_posix())
        except ValueError:
            continue

    if documented != imported:
        failures.append(
            "CODEMAP.md CSS order does not match style.css: "
            f"documented={documented}, imported={imported}"
        )

    if failures:
        return [fail("css.codemap", "; ".join(failures))]
    return [ok("css.codemap", f"{len(imported)} CSS rows match style.css order")]


def parse_service_worker_assets(text: str) -> list[str]:
    match = re.search(r"const\s+ZETER_ASSETS\s*=\s*\[(.*?)\];", text, re.S)
    if not match:
        return []
    block = match.group(1)
    return [m.group(1) or m.group(2) for m in re.finditer(r'"([^"]+)"|\'([^\']+)\'', block)]


def check_service_worker_assets() -> list[CheckResult]:
    if not SERVICE_WORKER.exists():
        return [fail("service_worker.assets", "app/service-worker.js is missing")]
    assets = parse_service_worker_assets(read_text(SERVICE_WORKER))
    if not assets:
        return [fail("service_worker.assets", "ZETER_ASSETS was not found")]

    failures: list[str] = []
    for reference in assets:
        target = resolve_app_asset(reference)
        if target is None:
            failures.append(f"{reference} escapes app")
        elif not target.exists():
            failures.append(f"{reference} not found")

    if failures:
        return [fail("service_worker.assets", "; ".join(failures))]
    return [ok("service_worker.assets", f"{len(assets)} cached assets exist")]


def check_css_imports_are_cached() -> list[CheckResult]:
    if not CSS_ENTRY.exists() or not SERVICE_WORKER.exists():
        return [warn("css.cache", "skipped because style.css or service-worker.js is missing")]

    imports = parse_css_imports(read_text(CSS_ENTRY))
    assets = set(parse_service_worker_assets(read_text(SERVICE_WORKER)))
    missing: list[str] = []
    for reference in imports:
        normalized = "./css/" + Path(strip_url_suffix(reference)).name
        if normalized not in assets:
            missing.append(normalized)

    if missing:
        return [fail("css.cache", "missing in ZETER_ASSETS: " + ", ".join(missing))]
    return [ok("css.cache", f"{len(imports)} CSS imports are listed in service-worker.js")]


def check_index_assets() -> list[CheckResult]:
    if not INDEX_HTML.exists():
        return [fail("index.assets", "app/index.html is missing")]

    parser = LocalAssetParser()
    parser.feed(read_text(INDEX_HTML))
    failures: list[str] = []
    for reference in parser.assets:
        target = resolve_app_asset(reference)
        if target is None:
            failures.append(f"{reference} escapes app")
        elif not target.exists():
            failures.append(f"{reference} not found")

    if failures:
        return [fail("index.assets", "; ".join(failures))]
    return [ok("index.assets", f"{len(parser.assets)} local assets referenced by index.html exist")]


def collect_index_script_files() -> list[Path]:
    if not INDEX_HTML.exists():
        return []
    parser = LocalAssetParser()
    parser.feed(read_text(INDEX_HTML))
    scripts: list[Path] = []
    for reference in parser.scripts:
        target = resolve_app_asset(reference)
        if target and target.suffix.lower() == ".js":
            scripts.append(target)
    return scripts


def check_index_script_order() -> list[CheckResult]:
    if not INDEX_HTML.exists():
        return [fail("index.script_order", "app/index.html is missing")]
    parser = LocalAssetParser()
    parser.feed(read_text(INDEX_HTML))
    scripts = [strip_url_suffix(src).replace("\\", "/").lstrip("./") for src in parser.scripts]
    required_order = REQUIRED_SCRIPT_ORDER
    missing = [script for script in required_order if script not in scripts]
    if missing:
        return [fail("index.script_order", "missing scripts: " + ", ".join(missing))]
    positions = [scripts.index(script) for script in required_order]
    if positions != sorted(positions):
        return [fail("index.script_order", "expected order: " + " -> ".join(required_order))]
    return [ok("index.script_order", "core scripts load before app.js")]


def check_manifest_assets() -> list[CheckResult]:
    if not MANIFEST_JSON.exists():
        return [warn("manifest.assets", "app/manifest.json is missing")]
    try:
        manifest = json.loads(read_text(MANIFEST_JSON))
    except json.JSONDecodeError as exc:
        return [fail("manifest.assets", f"manifest.json is invalid JSON: {exc}")]

    icons = manifest.get("icons", [])
    failures: list[str] = []
    checked = 0
    if isinstance(icons, list):
        for icon in icons:
            if not isinstance(icon, dict):
                continue
            src = icon.get("src")
            if not isinstance(src, str) or not is_local_asset_reference(src):
                continue
            checked += 1
            target = resolve_app_asset(src)
            if target is None:
                failures.append(f"{src} escapes app")
            elif not target.exists():
                failures.append(f"{src} not found")

    if failures:
        return [fail("manifest.assets", "; ".join(failures))]
    return [ok("manifest.assets", f"{checked} manifest icon assets exist")]


def parse_version() -> str | None:
    if not VERSION_JS.exists():
        return None
    match = re.search(r"ZETER_OS_VERSION\s*=\s*['\"]([^'\"]+)['\"]", read_text(VERSION_JS))
    return match.group(1) if match else None


def parse_service_worker_cache() -> str | None:
    if not SERVICE_WORKER.exists():
        return None
    match = re.search(r"ZETER_CACHE\s*=\s*['\"]([^'\"]+)['\"]", read_text(SERVICE_WORKER))
    return match.group(1) if match else None


def check_version_cache_match() -> list[CheckResult]:
    version = parse_version()
    cache = parse_service_worker_cache()
    if not version or not cache:
        return [warn("version.cache", "version or service-worker cache name was not found")]
    expected = f"zeter-os-{version}"
    if cache != expected:
        return [fail("version.cache", f"service worker cache is {cache!r}, expected {expected!r}")]
    return [ok("version.cache", f"service worker cache matches version {version}")]


def check_python_syntax() -> list[CheckResult]:
    scripts = (
        PYTHON_ENTRY,
        Path(__file__).resolve(),
        UPDATE_DOCS_TOOL,
        NAVIGATION_INDEX_TOOL,
        FIND_OWNER_TOOL,
        NATIVE_SMOKE,
        BUILD_RELEASE_TOOL,
        RELEASE_SMOKE,
    )
    results: list[CheckResult] = []
    for script in scripts:
        if not script.exists():
            results.append(fail("python.syntax", f"{script.name} is missing"))
            continue
        try:
            source = read_text(script)
            compile(source, str(script), "exec")
        except SyntaxError as exc:
            results.append(fail("python.syntax", f"{exc.filename}:{exc.lineno}: {exc.msg}"))
            continue
        results.append(ok("python.syntax", f"{script.relative_to(PROJECT_ROOT)} compiles"))
    return results


def find_node() -> str | None:
    return shutil.which("node")


def run_node_check(node: str, script: Path) -> CheckResult:
    rel = script.relative_to(PROJECT_ROOT)
    completed = subprocess.run(
        [node, "--check", str(script)],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode == 0:
        return ok("javascript.syntax", f"{rel} passes node --check")
    details = (completed.stderr or completed.stdout or "node --check failed").strip()
    return fail("javascript.syntax", f"{rel}: {details}")


def check_javascript_syntax(strict_node: bool) -> list[CheckResult]:
    scripts = [*collect_index_script_files(), SERVICE_WORKER, SMOKE_RUNNER, *SMOKE_SCRIPTS]
    scripts = list(dict.fromkeys(scripts))
    missing = [str(script.relative_to(PROJECT_ROOT)) for script in scripts if not script.exists()]
    if missing:
        return [fail("javascript.syntax", "missing: " + ", ".join(missing))]

    node = find_node()
    if not node:
        message = "Node.js not found; JS syntax check skipped"
        return [fail("javascript.syntax", message)] if strict_node else [warn("javascript.syntax", message)]

    return [run_node_check(node, script) for script in scripts]


def check_scenario_smokes(strict_node: bool) -> list[CheckResult]:
    if not strict_node:
        return []
    if not SMOKE_RUNNER.exists():
        return [fail("javascript.smokes", "tools/run_smokes.js is missing")]

    node = find_node()
    if not node:
        return [fail("javascript.smokes", "Node.js not found; scenario smokes skipped")]

    try:
        completed = subprocess.run(
            [node, str(SMOKE_RUNNER)],
            cwd=PROJECT_ROOT,
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return [fail("javascript.smokes", "scenario smoke suite exceeded 30 seconds")]

    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    output = output or "scenario smoke suite failed"
    if completed.returncode != 0:
        return [fail("javascript.smokes", output)]
    summary = output.splitlines()[-1] if output else "scenario smoke suite passed"
    return [ok("javascript.smokes", summary)]


def check_native_smoke(strict_node: bool) -> list[CheckResult]:
    if not strict_node:
        return []
    if not NATIVE_SMOKE.exists():
        return [fail("python.native_smoke", "tools/smoke_managed_file_native.py is missing")]

    try:
        completed = subprocess.run(
            [sys.executable, str(NATIVE_SMOKE)],
            cwd=PROJECT_ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        return [fail("python.native_smoke", "managed-file native smoke exceeded 60 seconds")]

    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    output = output or "managed-file native smoke failed"
    if completed.returncode != 0:
        return [fail("python.native_smoke", output)]
    summary = output.splitlines()[-1] if output else "managed-file native smoke passed"
    return [ok("python.native_smoke", summary)]


def check_release_smoke(strict_node: bool) -> list[CheckResult]:
    if not strict_node:
        return []
    if not RELEASE_SMOKE.exists():
        return [fail("python.release_smoke", "tools/smoke_release_builder.py is missing")]

    try:
        completed = subprocess.run(
            [sys.executable, str(RELEASE_SMOKE)],
            cwd=PROJECT_ROOT,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        return [fail("python.release_smoke", "release builder smoke exceeded 30 seconds")]

    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    output = output or "release builder smoke failed"
    if completed.returncode != 0:
        return [fail("python.release_smoke", output)]
    summary = output.splitlines()[-1] if output else "release builder smoke passed"
    return [ok("python.release_smoke", summary)]


def run_checks(strict_node: bool) -> list[CheckResult]:
    checks: list[CheckResult] = []
    checks.extend(check_required_files())
    checks.extend(check_required_docs())
    checks.extend(check_docs_inventory())
    checks.extend(check_docs_links())
    checks.extend(check_agents_doc_references())
    checks.extend(check_agents_contract())
    checks.extend(check_index_assets())
    checks.extend(check_index_script_order())
    checks.extend(check_core_module_coverage())
    checks.extend(check_core_module_exports())
    checks.extend(check_codemap_manual_contracts())
    checks.extend(check_codemap_app_anchors())
    checks.extend(check_core_dependencies())
    checks.extend(check_owner_manifest())
    checks.extend(check_owner_lookup())
    checks.extend(check_generated_docs())
    checks.extend(check_native_bridge_contract())
    checks.extend(check_manifest_assets())
    checks.extend(check_css_imports())
    checks.extend(check_css_entry_contract())
    checks.extend(check_css_codemap_contract())
    checks.extend(check_service_worker_assets())
    checks.extend(check_css_imports_are_cached())
    checks.extend(check_version_cache_match())
    checks.extend(check_python_syntax())
    checks.extend(check_javascript_syntax(strict_node=strict_node))
    checks.extend(check_scenario_smokes(strict_node=strict_node))
    checks.extend(check_native_smoke(strict_node=strict_node))
    checks.extend(check_release_smoke(strict_node=strict_node))
    return checks


def print_results(results: Iterable[CheckResult]) -> int:
    counts = {"OK": 0, "WARN": 0, "FAIL": 0}
    for result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
        print(f"[{result.status}] {result.name}: {result.message}")

    print()
    print(f"Summary: {counts['OK']} ok, {counts['WARN']} warnings, {counts['FAIL']} failures")
    return 1 if counts["FAIL"] else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Check ZeTer OS project structure and syntax.")
    parser.add_argument(
        "--strict-node",
        action="store_true",
        help="Fail if Node.js is not available for JavaScript syntax checks.",
    )
    args = parser.parse_args()
    return print_results(run_checks(strict_node=args.strict_node))


if __name__ == "__main__":
    sys.exit(main())
