"""Static guard: no module calls a bare function name it never imports or defines.

This catches the class of bug where extracting code into a new module leaves a helper
(e.g. clean_author_names) used but no longer in scope — a NameError that only fires on
the live code path and so slips past offline tests.
"""
import ast
import os
import glob
import builtins

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILTINS = set(dir(builtins))


def _get_root_name(node):
    curr = node
    while isinstance(curr, ast.Attribute):
        curr = curr.value
    if isinstance(curr, ast.Name):
        return curr.id
    return None


def _module_defined_names(tree):
    """Top-level names a module provides: imports, defs, classes, assignments."""
    names = set(BUILTINS) | {"__file__", "__name__", "__doc__"}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    names.add(t.id)
    return names


def _called_root_names(tree):
    """Names invoked as bare calls or attribute targets (e.g., foo() or foo.bar())."""
    local = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for a in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
                local.add(a.arg)
            if node.args.vararg: local.add(node.args.vararg.arg)
            if node.args.kwarg: local.add(node.args.kwarg.arg)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                for sub in ast.walk(t):
                    if isinstance(sub, ast.Name):
                        local.add(sub.id)
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            for sub in ast.walk(node.target):
                if isinstance(sub, ast.Name):
                    local.add(sub.id)
        elif isinstance(node, ast.For):
            for sub in ast.walk(node.target):
                if isinstance(sub, ast.Name):
                    local.add(sub.id)
        elif isinstance(node, ast.ExceptHandler):
            if node.name:
                local.add(node.name)
        elif isinstance(node, ast.With):
            for item in node.items:
                if item.optional_vars:
                    for sub in ast.walk(item.optional_vars):
                        if isinstance(sub, ast.Name):
                            local.add(sub.id)
        elif isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            for gen in node.generators:
                for sub in ast.walk(gen.target):
                    if isinstance(sub, ast.Name):
                        local.add(sub.id)

    calls = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            root = _get_root_name(node.func)
            if root:
                calls.setdefault(root, node.lineno)
    return calls, local


def test_no_called_name_is_undefined():
    offenders = {}
    paths = glob.glob(os.path.join(ROOT, "tagger_app", "**", "*.py"), recursive=True)
    app_py = os.path.join(ROOT, "app.py")
    if os.path.exists(app_py):
        paths.append(app_py)

    for path in paths:
        tree = ast.parse(open(path).read())
        provided = _module_defined_names(tree)
        calls, local = _called_root_names(tree)
        for name, lineno in calls.items():
            if name not in provided and name not in local:
                offenders.setdefault(os.path.relpath(path, ROOT), []).append((name, lineno))
    assert not offenders, f"called names not imported/defined: {offenders}"
