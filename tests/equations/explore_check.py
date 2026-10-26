"""Evaluate an explorable's own expressions from book.json, so a test checks the book, not a copy.

The book's expression language (src/core/expr.ts) is a small subset of ordinary maths: numbers,
names, + - * / ^ and a few functions. Here it is translated to SymPy and evaluated with only the
listed functions and the block's own parameters in scope; any other name fails the test. (These
are the repository's own sample books, so SymPy's parser is acceptable here; the app itself never
evaluates book text with anything but src/core/expr.ts.)
"""

import json
import math
from pathlib import Path

import sympy as sp

FUNCS = {"exp": sp.exp, "ln": sp.log, "log10": lambda v: sp.log(v, 10), "sqrt": sp.sqrt, "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "atan": sp.atan, "abs": sp.Abs, "pi": sp.pi, "e": sp.E}


def find(book_dir, block_id):
    book = json.loads((Path(__file__).resolve().parents[2] / "examples" / book_dir / "book.json").read_text())
    for ch in book["chapters"]:
        for s in ch["sections"]:
            for layer in ("summary", "intuition", "formal", "limits"):
                for b in s["layers"][layer]:
                    if b.get("id") == block_id:
                        return b
    raise KeyError(block_id)


def evaluate(expr, values):
    names = {k: sp.Symbol(k) for k in values}
    tree = sp.parse_expr(expr.replace("^", "**"), local_dict={**FUNCS, **names}, evaluate=True)
    stray = {str(s) for s in tree.free_symbols} - set(values)
    assert not stray, f"unknown names in {expr!r}: {stray}"
    return float(tree.subs({names[k]: v for k, v in values.items()}))


def defaults(block):
    return {p["name"]: p["value"] for p in block["params"]}


def readouts(block, **override):
    vals = {**defaults(block), **override}
    return {r["label"]: evaluate(r["expr"], vals) for r in block["readouts"]}


def curve(block, x, series=0, **override):
    vals = {**defaults(block), **override, "x": x}
    return evaluate(block["plot"]["series"][series]["expr"], vals)


def close(a, b, rel=1e-3):
    return math.isclose(a, b, rel_tol=rel)
