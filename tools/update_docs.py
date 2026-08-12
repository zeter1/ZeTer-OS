from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from check_project import (
    CODEMAP_MD,
    MODULE_DEPENDENCIES_MD,
    generated_doc_mismatches,
    read_text,
    render_codemap_generated_summary,
    render_module_dependencies_markdown,
    replace_generated_block,
)
from navigation_index import generated_navigation_docs, load_owner_manifest, validate_owner_manifest


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(temp, path)


def update_generated_docs() -> list[str]:
    manifest = load_owner_manifest()
    manifest_failures = validate_owner_manifest(manifest)
    if manifest_failures:
        raise ValueError("Invalid tools/code_owners.json: " + "; ".join(manifest_failures))

    dependencies = render_module_dependencies_markdown()
    navigation_docs = generated_navigation_docs(manifest)
    current_dependencies = read_text(MODULE_DEPENDENCIES_MD) if MODULE_DEPENDENCIES_MD.exists() else ""
    codemap = read_text(CODEMAP_MD)
    updated_codemap = replace_generated_block(codemap, render_codemap_generated_summary())

    changed: list[str] = []
    if current_dependencies.replace("\r\n", "\n") != dependencies:
        atomic_write_text(MODULE_DEPENDENCIES_MD, dependencies)
        changed.append(str(MODULE_DEPENDENCIES_MD.name))
    if updated_codemap != codemap:
        atomic_write_text(CODEMAP_MD, updated_codemap)
        changed.append(str(CODEMAP_MD.name))
    for path, expected in navigation_docs.items():
        current = read_text(path) if path.exists() else ""
        if current.replace("\r\n", "\n") != expected.replace("\r\n", "\n"):
            atomic_write_text(path, expected)
            changed.append(str(path.name))
    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="Check or update generated ZeTer OS documentation.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Fail when generated documentation is stale (default).")
    mode.add_argument("--write", action="store_true", help="Atomically update generated documentation.")
    args = parser.parse_args()

    try:
        if args.write:
            changed = update_generated_docs()
            if changed:
                print("Updated: " + ", ".join(changed))
            else:
                print("Generated documentation is already current.")

        mismatches = generated_doc_mismatches()
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"Documentation update failed: {exc}", file=sys.stderr)
        return 1

    if mismatches:
        print("Generated documentation is stale: " + ", ".join(mismatches), file=sys.stderr)
        print("Run: python tools/update_docs.py --write", file=sys.stderr)
        return 1
    print("Generated documentation check: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
