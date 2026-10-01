"""Checks for every equation, worked example and DNA-model dimension in examples/cells-and-dna."""

import json
import math
from pathlib import Path

import pint
import sympy as sp

u = pint.UnitRegistry()
BOOK = Path(__file__).resolve().parents[2] / "examples" / "cells-and-dna"


def close(a, b, rel=1e-3):
    return math.isclose(a, b, rel_tol=rel)


def dna():
    return json.loads((BOOK / "models" / "dna.json").read_text())


def test_sa_volume_derivation():
    r = sp.symbols("r", positive=True)
    ratio = sp.simplify((4 * sp.pi * r**2) / (sp.Rational(4, 3) * sp.pi * r**3))
    assert ratio == 3 / r


def test_sa_volume_examples():
    for radius, expected in ((1, 3.0), (10, 0.3)):
        r = radius * u.um
        ratio = (4 * math.pi * r**2) / (4 / 3 * math.pi * r**3)
        assert close(ratio.to("1/um").magnitude, expected)
    # diameters fall inside the textbook ranges (prokaryote 0.1–5.0 µm, eukaryote 10–100 µm)
    assert 0.1 <= 2 * 1 <= 5.0
    assert 10 <= 2 * 10 <= 100


def test_dna_length_example():
    L = (1500 * 0.34 * u.nm).to("nm")
    assert close(L.magnitude, 510)
    # "about a quarter of the diameter of a 2 µm cell"
    assert close((L / (2 * u.um)).to("").magnitude, 0.255)


def test_dna_turns_example():
    turns = 1500 / 10
    assert turns == 150
    assert close(turns * 3.4, 510)
    assert close(360 / 10, 36)


def test_dna_model_dimensions():
    m = dna()
    atoms = m["atoms"]
    assert m["unit"] == "nm"
    backbone = [a for a in atoms if a["el"] == "P"]
    # diameter: every backbone bead sits 1 nm from the helix axis (the y axis)
    for a in backbone:
        assert close(math.hypot(a["x"], a["z"]), 1.0, rel=1e-3)
    # strand 1 backbone is every fourth atom starting at 0 (see figures.ts)
    s1 = atoms[0::4]
    assert all(a["el"] == "P" for a in s1)
    for p, q in zip(s1, s1[1:]):
        assert close(q["y"] - p["y"], 0.34, rel=1e-3)
        turn = math.degrees(math.atan2(q["z"], q["x"]) - math.atan2(p["z"], p["x"])) % 360
        assert close(turn, 36, rel=1e-3)
    # ten base pairs: one full turn, 3.4 nm of rise including the step to the next pair
    assert len(s1) == 10
    assert close((s1[-1]["y"] - s1[0]["y"]) + 0.34, 3.4)


def test_dna_model_pairs_are_complementary():
    atoms = dna()["atoms"]
    pair = {"A": "T", "T": "A", "G": "C", "C": "G"}
    for k in range(0, len(atoms), 4):
        assert pair[atoms[k + 1]["label"]] == atoms[k + 2]["label"]
