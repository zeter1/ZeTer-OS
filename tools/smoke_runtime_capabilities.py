"""Execute only the AST-extracted metadata method; never import the launcher."""
import ast
from pathlib import Path
from types import SimpleNamespace

source = Path(__file__).resolve().parents[1] / "run_zeter_os.py"
tree = ast.parse(source.read_text(encoding="utf-8-sig"))
owner = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "NativeStorageApi")
method = next(node for node in owner.body if isinstance(node, ast.FunctionDef) and node.name == "get_runtime_info")
assert not method.decorator_list
method.returns = None
for frozen, expected in ((False, "python"), (True, "exe")):
    namespace = {"sys": SimpleNamespace(frozen=frozen, platform="win32")}
    exec(compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec"), namespace)
    assert namespace["get_runtime_info"](object()) == {"ok": True, "kind": expected, "platform": "win32"}
print("runtime identity: PASS (AST-only; no launcher import/state/filesystem calls)")
