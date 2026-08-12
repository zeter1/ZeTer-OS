from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from navigation_index import load_owner_manifest, search_owner_records, validate_owner_manifest


def format_values(values: list[str] | None) -> str:
    return ", ".join(values or []) or "—"


def format_result(result: dict[str, Any]) -> list[str]:
    data = result["data"]
    lines = [f"[{result['kind']}] {result['title']}  score={result['score']}"]
    if result["kind"] == "scenario":
        lines.extend([
            f"  JS: {format_values(data.get('js'))}",
            f"  app.js: {format_values(data.get('app_anchors'))}",
            f"  CSS: {format_values(data.get('css'))}",
            f"  State: {format_values(data.get('state'))}",
            f"  Smoke: {format_values(data.get('smokes'))}",
            f"  Manual: {data.get('manual', '—')}",
        ])
    elif result["kind"] == "ui":
        lines.extend([
            f"  Scenario: {data.get('scenario', '—')}",
            f"  Hooks: {format_values(data.get('hooks'))}",
            f"  Files: {format_values(data.get('files'))}",
        ])
    elif result["kind"] == "state":
        lines.append(f"  State: {format_values(data.get('state_paths'))}")
        for stage, entries in data.get("stages", {}).items():
            values = [f"{entry['path']}#{anchor}" for entry in entries for anchor in entry.get("anchors", [])]
            lines.append(f"  {stage}: {format_values(values)}")
        lines.append(f"  Smoke: {format_values(data.get('smokes'))}")
    elif result["kind"] == "core":
        lines.extend([
            f"  Global: {data.get('export') or '—'}",
            f"  API: {format_values(data.get('members'))}",
            f"  Dependencies: {format_values(data.get('dependencies'))}",
            f"  Consumers: {format_values(data.get('consumers'))}",
            f"  Smoke: {format_values(data.get('smokes'))}",
        ])
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Find ZeTer OS scenario, UI, state, or core owners.")
    parser.add_argument("query", nargs="+", help="Words, symbol, selector, state path, or scenario name.")
    parser.add_argument("--limit", type=int, default=8, help="Maximum number of matches (default: 8).")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    try:
        manifest = load_owner_manifest()
        failures = validate_owner_manifest(manifest)
        if failures:
            print("Owner manifest is invalid: " + "; ".join(failures), file=sys.stderr)
            return 2
        query = " ".join(args.query).strip()
        results = search_owner_records(query, limit=max(1, args.limit), manifest=manifest)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Owner lookup failed: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({"query": query, "results": results}, ensure_ascii=False, indent=2))
    else:
        print(f"ZeTer OS owners for: {query}")
        print()
        for index, result in enumerate(results):
            if index:
                print()
            print("\n".join(format_result(result)))

    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
