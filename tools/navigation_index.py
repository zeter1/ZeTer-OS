from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = PROJECT_ROOT / "app"
CORE_DIR = APP_DIR / "js" / "core"
APP_JS = APP_DIR / "js" / "app.js"
INDEX_HTML = APP_DIR / "index.html"
MANIFEST_PATH = PROJECT_ROOT / "tools" / "code_owners.json"
SCENARIO_MAP_MD = PROJECT_ROOT / "docs" / "SCENARIO_MAP.md"
CORE_API_INDEX_MD = PROJECT_ROOT / "docs" / "CORE_API_INDEX.md"
UI_CONTRACTS_MD = PROJECT_ROOT / "docs" / "UI_CONTRACTS.md"
STATE_LIFECYCLE_MD = PROJECT_ROOT / "docs" / "STATE_LIFECYCLE.md"
GENERATED_NAVIGATION_DOCS = (
    SCENARIO_MAP_MD,
    CORE_API_INDEX_MD,
    UI_CONTRACTS_MD,
    STATE_LIFECYCLE_MD,
)
STATE_STAGE_ORDER = ("defaults", "normalizers", "migration", "validator", "serializer", "storage")
STATE_STAGE_LABELS = {
    "defaults": "Defaults",
    "normalizers": "Normalizers",
    "migration": "Migration",
    "validator": "Validator",
    "serializer": "Serializer",
    "storage": "Storage/runtime",
}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def project_path(path: str) -> Path | None:
    candidate = (PROJECT_ROOT / path).resolve()
    try:
        candidate.relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        return None
    return candidate


def load_owner_manifest(path: Path = MANIFEST_PATH) -> dict[str, Any]:
    data = json.loads(read_text(path))
    if not isinstance(data, dict):
        raise ValueError("tools/code_owners.json must contain an object")
    return data


def core_public_exports(source: str) -> list[str]:
    direct = re.findall(r"window\.(ZETER_[A-Z0-9_]+)\s*=", source)
    defined = re.findall(
        r"Object\.defineProperty\(\s*window\s*,\s*['\"](ZETER_[A-Z0-9_]+)['\"]",
        source,
    )
    return [*direct, *defined]


def _balanced_object_body(source: str, open_index: int) -> str | None:
    depth = 0
    quote = ""
    escaped = False
    line_comment = False
    block_comment = False
    index = open_index
    while index < len(source):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""

        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
            index += 1
            continue
        if char == "/" and next_char == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and next_char == "*":
            block_comment = True
            index += 2
            continue
        if char in {"'", '"', "`"}:
            quote = char
            index += 1
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[open_index + 1:index]
        index += 1
    return None


def _public_object_body(source: str, export: str) -> str | None:
    direct = re.search(
        rf"window\.{re.escape(export)}\s*=\s*(?:Object\.freeze\s*\(\s*)?\{{",
        source,
    )
    if direct:
        open_index = source.find("{", direct.start(), direct.end())
        return _balanced_object_body(source, open_index)

    defined = re.search(
        rf"Object\.defineProperty\(\s*window\s*,\s*['\"]{re.escape(export)}['\"]",
        source,
    )
    if not defined:
        return None
    value = re.search(r"value\s*:\s*Object\.freeze\s*\(\s*\{", source[defined.end():])
    if not value:
        return None
    open_index = defined.end() + value.end() - 1
    return _balanced_object_body(source, open_index)


def _split_top_level_members(body: str) -> list[str]:
    segments: list[str] = []
    start = 0
    depths = {"(": 0, "[": 0, "{": 0}
    closing = {")": "(", "]": "[", "}": "{"}
    quote = ""
    escaped = False
    line_comment = False
    block_comment = False
    index = 0
    while index < len(body):
        char = body[index]
        next_char = body[index + 1] if index + 1 < len(body) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            index += 1
            continue
        if block_comment:
            if char == "*" and next_char == "/":
                block_comment = False
                index += 2
            else:
                index += 1
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
            index += 1
            continue
        if char == "/" and next_char == "/":
            line_comment = True
            index += 2
            continue
        if char == "/" and next_char == "*":
            block_comment = True
            index += 2
            continue
        if char in {"'", '"', "`"}:
            quote = char
        elif char in depths:
            depths[char] += 1
        elif char in closing:
            opener = closing[char]
            depths[opener] = max(0, depths[opener] - 1)
        elif char == "," and not any(depths.values()):
            segments.append(body[start:index])
            start = index + 1
        index += 1
    segments.append(body[start:])
    return segments


def core_public_api_members(source: str, export: str) -> list[str]:
    body = _public_object_body(source, export)
    if body is None:
        return []

    members: list[str] = []
    for raw_segment in _split_top_level_members(body):
        segment = re.sub(r"^\s*(?:(?://[^\n]*\n)|(?:/\*.*?\*/\s*))*", "", raw_segment, flags=re.S).strip()
        if not segment or segment.startswith("..."):
            continue
        quoted = re.match(r"['\"]([^'\"]+)['\"]\s*:", segment)
        if quoted:
            members.append(quoted.group(1))
            continue
        match = re.match(
            r"(?:(?:get|set|async)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::|\(|$)",
            segment,
        )
        if match:
            members.append(match.group(1))
    return list(dict.fromkeys(members))


def ordered_core_paths() -> list[Path]:
    scripts = re.findall(r"<script[^>]+src=['\"]([^'\"]+)['\"]", read_text(INDEX_HTML), re.I)
    paths: list[Path] = []
    for script in scripts:
        normalized = script.split("?", 1)[0].split("#", 1)[0].lstrip("./")
        if not normalized.startswith("js/core/"):
            continue
        candidate = APP_DIR / normalized
        if candidate.exists():
            paths.append(candidate)
    return paths


def core_api_records(manifest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    owner_manifest = manifest or load_owner_manifest()
    paths = ordered_core_paths()
    records: list[dict[str, Any]] = []
    for path in paths:
        source = read_text(path)
        exports = core_public_exports(source)
        export = exports[0] if len(exports) == 1 else ""
        dependencies = sorted(set(re.findall(r"window\.(ZETER_[A-Z0-9_]+)", source)) - {export})
        records.append({
            "path": path.relative_to(PROJECT_ROOT).as_posix(),
            "export": export,
            "members": core_public_api_members(source, export) if export else [],
            "dependencies": dependencies,
            "consumers": [],
            "smokes": [],
        })

    app_source = read_text(APP_JS)
    for record in records:
        export = record["export"]
        consumers = [other["path"] for other in records if export and export in other["dependencies"]]
        if export and re.search(rf"(?<![A-Za-z0-9_$]){re.escape(export)}(?![A-Za-z0-9_$])", app_source):
            consumers.append("app/js/app.js")
        record["consumers"] = consumers

        smokes: list[str] = []
        for scenario in owner_manifest.get("scenarios", []):
            if record["path"] in scenario.get("js", []):
                smokes.extend(scenario.get("smokes", []))
        record["smokes"] = list(dict.fromkeys(smokes))
    return records


def _markdown_cell(values: Iterable[str] | str) -> str:
    if isinstance(values, str):
        text = values
    else:
        items = [str(value) for value in values if str(value)]
        text = "<br>".join(f"`{item}`" for item in items) if items else "—"
    return text.replace("|", "\\|")


def render_scenario_map(manifest: dict[str, Any] | None = None) -> str:
    data = manifest or load_owner_manifest()
    lines = [
        "# Карта пользовательских сценариев ZeTer OS",
        "",
        "> Файл генерируется из `tools/code_owners.json` командой `python tools/update_docs.py --write`. Не редактируй таблицу вручную.",
        "",
        "Используй карту, когда задача проходит через несколько JS/CSS/state-слоёв. Для прямого поиска запусти `python tools/find_owner.py \"запрос\"`.",
        "",
        "| Сценарий | JS-владельцы | app.js-якоря | CSS | State | Smoke | Ручной сценарий |",
        "|---|---|---|---|---|---|---|",
    ]
    for scenario in data.get("scenarios", []):
        lines.append(
            "| " + " | ".join([
                f"**{scenario['title']}**<br>`{scenario['id']}`",
                _markdown_cell(scenario.get("js", [])),
                _markdown_cell(scenario.get("app_anchors", [])),
                _markdown_cell(scenario.get("css", [])),
                _markdown_cell(scenario.get("state", [])),
                _markdown_cell(scenario.get("smokes", [])),
                _markdown_cell(scenario.get("manual", "")),
            ]) + " |"
        )
    return "\n".join(lines) + "\n"


def render_core_api_index(manifest: dict[str, Any] | None = None) -> str:
    data = manifest or load_owner_manifest()
    records = core_api_records(data)
    member_count = sum(len(record["members"]) for record in records)
    lines = [
        "# Публичный API core-модулей ZeTer OS",
        "",
        "> Файл генерируется из текущего JavaScript и `tools/code_owners.json`. Не редактируй таблицу вручную.",
        "",
        f"- Core-модулей: {len(records)}.",
        f"- Публичных членов API: {member_count}.",
        "- Consumers вычисляются по реальным ссылкам `window.ZETER_*`.",
        "",
        "| Модуль | Глобал | Публичные члены | Dependencies | Consumers | Связанные smoke |",
        "|---|---|---|---|---|---|",
    ]
    for record in records:
        members = record["members"] or ["scalar/no object API"]
        lines.append(
            "| " + " | ".join([
                f"`{record['path']}`",
                f"`{record['export']}`" if record["export"] else "—",
                _markdown_cell(members),
                _markdown_cell(record["dependencies"]),
                _markdown_cell(record["consumers"]),
                _markdown_cell(record["smokes"]),
            ]) + " |"
        )
    return "\n".join(lines) + "\n"


def render_ui_contracts(manifest: dict[str, Any] | None = None) -> str:
    data = manifest or load_owner_manifest()
    lines = [
        "# UI-контракты ZeTer OS",
        "",
        "> Файл генерируется из `tools/code_owners.json`. Hooks проверяются по текущим HTML/JS/CSS-файлам.",
        "",
        "| UI-область | Сценарий | DOM/data hooks | Владельцы |",
        "|---|---|---|---|",
    ]
    for contract in data.get("ui_contracts", []):
        lines.append(
            "| " + " | ".join([
                f"**{contract['title']}**<br>`{contract['id']}`",
                f"`{contract['scenario']}`",
                _markdown_cell(contract.get("hooks", [])),
                _markdown_cell(contract.get("files", [])),
            ]) + " |"
        )
    return "\n".join(lines) + "\n"


def _format_state_stage(entries: list[dict[str, Any]]) -> str:
    values: list[str] = []
    for entry in entries:
        anchors = entry.get("anchors", [])
        values.extend(f"{entry['path']}#{anchor}" for anchor in anchors)
    return _markdown_cell(values)


def render_state_lifecycle(manifest: dict[str, Any] | None = None) -> str:
    data = manifest or load_owner_manifest()
    headers = ["Область", "State paths", *[STATE_STAGE_LABELS[key] for key in STATE_STAGE_ORDER], "Smoke"]
    lines = [
        "# Жизненный цикл state ZeTer OS",
        "",
        "> Файл генерируется из `tools/code_owners.json`. Каждый якорь проверяется в указанном файле.",
        "",
        "| " + " | ".join(headers) + " |",
        "|" + "---|" * len(headers),
    ]
    for lifecycle in data.get("state_lifecycle", []):
        stages = lifecycle.get("stages", {})
        cells = [
            f"**{lifecycle['title']}**<br>`{lifecycle['id']}`",
            _markdown_cell(lifecycle.get("state_paths", [])),
            *[_format_state_stage(stages.get(stage, [])) for stage in STATE_STAGE_ORDER],
            _markdown_cell(lifecycle.get("smokes", [])),
        ]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def generated_navigation_docs(manifest: dict[str, Any] | None = None) -> dict[Path, str]:
    data = manifest or load_owner_manifest()
    return {
        SCENARIO_MAP_MD: render_scenario_map(data),
        CORE_API_INDEX_MD: render_core_api_index(data),
        UI_CONTRACTS_MD: render_ui_contracts(data),
        STATE_LIFECYCLE_MD: render_state_lifecycle(data),
    }


def validate_owner_manifest(manifest: dict[str, Any] | None = None) -> list[str]:
    data = manifest or load_owner_manifest()
    failures: list[str] = []
    if data.get("version") != 1:
        failures.append("manifest version must be 1")

    def object_list(key: str) -> list[dict[str, Any]]:
        value = data.get(key)
        if not isinstance(value, list) or not value:
            failures.append(f"{key} must be a non-empty list")
            return []
        objects: list[dict[str, Any]] = []
        for index, item in enumerate(value):
            if not isinstance(item, dict):
                failures.append(f"{key}[{index}] must be an object")
            else:
                objects.append(item)
        return objects

    scenarios = object_list("scenarios")
    ui_contracts = object_list("ui_contracts")
    state_lifecycle = object_list("state_lifecycle")

    def check_ids(items: list[dict[str, Any]], label: str) -> set[str]:
        ids = [item.get("id") for item in items]
        invalid = [value for value in ids if not isinstance(value, str) or not re.fullmatch(r"[a-z0-9-]+", value)]
        if invalid:
            failures.append(f"{label}: invalid ids {invalid}")
        valid_ids = [value for value in ids if isinstance(value, str) and re.fullmatch(r"[a-z0-9-]+", value)]
        duplicates = sorted({value for value in valid_ids if valid_ids.count(value) > 1})
        if duplicates:
            failures.append(f"{label}: duplicated ids {duplicates}")
        return set(valid_ids)

    scenario_ids = check_ids(scenarios, "scenarios")
    check_ids(ui_contracts, "ui_contracts")
    check_ids(state_lifecycle, "state_lifecycle")
    app_source = read_text(APP_JS)

    def string_list(value: Any, label: str, *, allow_empty: bool = False) -> list[str]:
        if not isinstance(value, list):
            failures.append(f"{label}: expected a list")
            return []
        strings = [item for item in value if isinstance(item, str) and item.strip()]
        if len(strings) != len(value):
            failures.append(f"{label}: values must be non-empty strings")
        if not allow_empty and not strings:
            failures.append(f"{label}: must be a non-empty list")
        duplicates = sorted({item for item in strings if strings.count(item) > 1})
        if duplicates:
            failures.append(f"{label}: duplicated values {duplicates}")
        return strings

    def validate_paths(paths: Any, label: str, *, allow_empty: bool = False) -> list[Path]:
        values = string_list(paths, label, allow_empty=allow_empty)
        resolved: list[Path] = []
        for raw in values:
            path = project_path(raw)
            if path is None:
                failures.append(f"{label}: path escapes project: {raw}")
            elif not path.exists():
                failures.append(f"{label}: path not found: {raw}")
            else:
                resolved.append(path)
        return resolved

    owned_js: set[str] = set()
    owned_css: set[str] = set()
    for scenario in scenarios:
        label = f"scenario {scenario.get('id', '<missing>')}"
        for key in ("title", "manual"):
            if not isinstance(scenario.get(key), str) or not scenario[key].strip():
                failures.append(f"{label}: {key} is required")
        string_list(scenario.get("keywords"), f"{label}.keywords")
        js_values = string_list(scenario.get("js"), f"{label}.js")
        css_values = string_list(scenario.get("css"), f"{label}.css", allow_empty=True)
        app_anchors = string_list(scenario.get("app_anchors"), f"{label}.app_anchors")
        string_list(scenario.get("state"), f"{label}.state")
        validate_paths(js_values, f"{label}.js")
        validate_paths(css_values, f"{label}.css", allow_empty=True)
        validate_paths(scenario.get("smokes"), f"{label}.smokes", allow_empty=True)
        owned_js.update(js_values)
        owned_css.update(css_values)
        for raw in js_values:
            if not raw.startswith("app/js/core/"):
                failures.append(f"{label}.js: expected app/js/core path: {raw}")
        for raw in css_values:
            if not raw.startswith("app/css/") or raw == "app/css/style.css":
                failures.append(f"{label}.css: expected thematic app/css path: {raw}")
        for anchor in app_anchors:
            if not re.search(
                rf"(?<![A-Za-z0-9_$]){re.escape(anchor)}(?![A-Za-z0-9_$])",
                app_source,
            ):
                failures.append(f"{label}: app.js anchor not found: {anchor}")

    expected_js = {path.relative_to(PROJECT_ROOT).as_posix() for path in CORE_DIR.glob("*.js")}
    missing_js = sorted(expected_js - owned_js)
    if missing_js:
        failures.append("scenarios: core files without an owner: " + ", ".join(missing_js))
    expected_css = {
        path.relative_to(PROJECT_ROOT).as_posix()
        for path in (APP_DIR / "css").glob("*.css")
        if path.name != "style.css"
    }
    missing_css = sorted(expected_css - owned_css)
    if missing_css:
        failures.append("scenarios: CSS files without an owner: " + ", ".join(missing_css))

    for contract in ui_contracts:
        label = f"ui {contract.get('id', '<missing>')}"
        if not isinstance(contract.get("title"), str) or not contract["title"].strip():
            failures.append(f"{label}: title is required")
        if contract.get("scenario") not in scenario_ids:
            failures.append(f"{label}: unknown scenario {contract.get('scenario')}")
        string_list(contract.get("keywords"), f"{label}.keywords")
        files = validate_paths(contract.get("files", []), f"{label}.files")
        combined = "\n".join(read_text(path) for path in files)
        hooks = string_list(contract.get("hooks"), f"{label}.hooks")
        for hook in hooks:
            if hook not in combined:
                failures.append(f"{label}: hook not found in owner files: {hook}")

    for lifecycle in state_lifecycle:
        label = f"state {lifecycle.get('id', '<missing>')}"
        if not isinstance(lifecycle.get("title"), str) or not lifecycle["title"].strip():
            failures.append(f"{label}: title is required")
        string_list(lifecycle.get("state_paths"), f"{label}.state_paths")
        validate_paths(lifecycle.get("smokes", []), f"{label}.smokes")
        stages = lifecycle.get("stages")
        if not isinstance(stages, dict):
            failures.append(f"{label}: stages must be an object")
            continue
        unknown_stages = sorted(set(stages) - set(STATE_STAGE_ORDER))
        if unknown_stages:
            failures.append(f"{label}: unknown stages {unknown_stages}")
        for stage in STATE_STAGE_ORDER:
            entries = stages.get(stage)
            if not isinstance(entries, list) or not entries:
                failures.append(f"{label}: stage {stage} must be a non-empty list")
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    failures.append(f"{label}.{stage}: entry must be an object")
                    continue
                paths = validate_paths([entry.get("path")], f"{label}.{stage}")
                anchors = string_list(entry.get("anchors"), f"{label}.{stage}.anchors")
                source = read_text(paths[0]) if paths else ""
                for anchor in anchors:
                    if anchor not in source:
                        failures.append(f"{label}.{stage}: anchor not found: {anchor}")

    return list(dict.fromkeys(failures))


def _search_score(query: str, haystack: str) -> int:
    normalized_query = query.casefold().strip()
    normalized_haystack = haystack.casefold()
    if not normalized_query:
        return 0
    score = 12 if normalized_query in normalized_haystack else 0
    for token in re.findall(r"[A-Za-zА-Яа-яЁё0-9_-]+", normalized_query):
        if re.search(rf"(?<!\w){re.escape(token)}(?!\w)", normalized_haystack):
            score += 4
        elif token in normalized_haystack:
            score += 1
    return score


def search_owner_records(query: str, limit: int = 8, manifest: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    data = manifest or load_owner_manifest()
    results: list[dict[str, Any]] = []

    for scenario in data.get("scenarios", []):
        haystack = " ".join(str(value) for value in [
            scenario.get("id", ""), scenario.get("title", ""), *scenario.get("keywords", []),
            *scenario.get("js", []), *scenario.get("app_anchors", []), *scenario.get("css", []),
            *scenario.get("state", []),
        ])
        score = _search_score(query, haystack)
        if score:
            results.append({"kind": "scenario", "score": score, "id": scenario["id"], "title": scenario["title"], "data": scenario})

    for contract in data.get("ui_contracts", []):
        haystack = " ".join(str(value) for value in [
            contract.get("id", ""), contract.get("title", ""), contract.get("scenario", ""),
            *contract.get("keywords", []), *contract.get("files", []), *contract.get("hooks", []),
        ])
        score = _search_score(query, haystack)
        if score:
            results.append({"kind": "ui", "score": score, "id": contract["id"], "title": contract["title"], "data": contract})

    for lifecycle in data.get("state_lifecycle", []):
        stage_values: list[str] = []
        for entries in lifecycle.get("stages", {}).values():
            for entry in entries:
                stage_values.extend([entry.get("path", ""), *entry.get("anchors", [])])
        haystack = " ".join([lifecycle.get("id", ""), lifecycle.get("title", ""), *lifecycle.get("state_paths", []), *stage_values])
        score = _search_score(query, haystack)
        if score:
            results.append({"kind": "state", "score": score, "id": lifecycle["id"], "title": lifecycle["title"], "data": lifecycle})

    for record in core_api_records(data):
        haystack = " ".join([
            record["path"], record["export"], *record["members"], *record["dependencies"], *record["consumers"],
        ])
        score = _search_score(query, haystack)
        if score:
            results.append({"kind": "core", "score": score, "id": record["export"] or record["path"], "title": record["path"], "data": record})

    kind_order = {"scenario": 0, "ui": 1, "state": 2, "core": 3}
    results.sort(key=lambda item: (-item["score"], kind_order.get(item["kind"], 99), item["title"]))
    return results[:max(1, limit)]
