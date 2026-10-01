"""Checks for every equation and worked example in examples/heart-and-vessels."""

import math

import pint
import sympy as sp

u = pint.UnitRegistry()


def close(a, b, rel=1e-3):
    return math.isclose(a, b, rel_tol=rel)


def test_cardiac_output_example():
    hr = 75 / u.minute
    sv = 70 * u.mL
    co = (hr * sv).to("L/min")
    assert close(co.magnitude, 5.25)
    assert 4.0 <= co.magnitude <= 8.0  # textbook range


def test_cardiac_output_figure_range():
    # the plotted lines span SV 55–100 mL and HR 50–110 bpm; the y axis (0–12 L/min) holds them all
    assert (110 / u.minute * 100 * u.mL).to("L/min").magnitude <= 12
    assert (50 / u.minute * 55 * u.mL).to("L/min").magnitude >= 0


def test_map_example():
    sbp, dbp = 120, 80
    assert sbp - dbp == 40
    m = dbp + sp.Rational(sbp - dbp, 3)
    assert m == sp.Rational(280, 3)
    assert round(float(m), 1) == 93.3
    assert 70 <= float(m) <= 110


def test_resistance_radius_examples():
    r = sp.symbols("r", positive=True)
    rel = 1 / r**4
    assert rel.subs(r, sp.Rational(1, 2)) == 16
    assert rel.subs(r, 2) == sp.Rational(1, 16)
    # flow = ΔP / R at fixed ΔP: one sixteenth the resistance → 16× the flow
    assert 1 / rel.subs(r, 2) == 16
