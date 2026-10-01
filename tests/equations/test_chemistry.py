"""Checks for every equation, worked example and 3D-model angle in examples/molecular-shapes."""

import json
import math
from pathlib import Path

import pint
import sympy as sp

u = pint.UnitRegistry()
BOOK = Path(__file__).resolve().parents[2] / "examples" / "molecular-shapes"


def close(a, b, rel=1e-3):
    return math.isclose(a, b, rel_tol=rel)


def angle(model, i, j, k):
    a, b, c = (model["atoms"][n] for n in (i, j, k))
    u_ = [a[q] - b[q] for q in "xyz"]
    v_ = [c[q] - b[q] for q in "xyz"]
    dot = sum(p * q for p, q in zip(u_, v_))
    return math.degrees(math.acos(dot / (math.hypot(*u_) * math.hypot(*v_))))


def test_tetrahedral_angle():
    """Vectors to alternate cube corners, e.g. (1,1,1) and (1,-1,-1): cos θ = −1/3."""
    a = sp.Matrix([1, 1, 1])
    b = sp.Matrix([1, -1, -1])
    cos_t = sp.simplify(a.dot(b) / (a.norm() * b.norm()))
    assert cos_t == sp.Rational(-1, 3)
    assert close(math.degrees(math.acos(-1 / 3)), 109.47, rel=1e-4)
    assert round(math.degrees(math.acos(-1 / 3)), 1) == 109.5


def test_methane_model_is_tetrahedral():
    m = json.loads((BOOK / "models" / "methane.json").read_text())
    for i in range(1, 5):
        for j in range(i + 1, 5):
            assert close(angle(m, i, 0, j), 109.47, rel=1e-4)


def test_water_model_angle():
    m = json.loads((BOOK / "models" / "water.json").read_text())
    assert close(angle(m, 1, 0, 2), 104.5, rel=1e-4)


def test_molarity_example():
    M = (0.250 * u.mol) / (0.500 * u.L)
    assert close(M.to("mol/L").magnitude, 0.500)


def test_dilution_example():
    C1, V1, C2 = 2.00 * u.mol / u.L, 50.0 * u.mL, 0.500 * u.mol / u.L
    V2 = (C1 * V1 / C2).to("mL")
    assert close(V2.magnitude, 200)
    assert close((C1 * V1).to("mol").magnitude, 0.100)
    assert close((C2 * V2).to("mol").magnitude, 0.100)


def test_ph_examples():
    assert close(-math.log10(1.0e-7), 7.00)
    assert close(-math.log10(1.0e-3), 3.00)
    # one pH unit is a factor of ten; pH 3 vs pH 7 is 10 000×
    assert close(1.0e-3 / 1.0e-7, 10_000)
