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


# --- Explorables: the book's own expressions, evaluated from book.json --------------------------

from explore_check import close as near, curve, find, readouts  # noqa: E402


def test_explore_cardiac_output():
    b = find("heart-and-vessels", "xpl-cardiac-output")
    r = readouts(b)
    CO = ((75 / u.minute) * (70 * u.mL)).to("L/min").magnitude
    assert near(r["Cardiac output"], CO) and near(CO, 5.25)
    assert near(r["Blood pumped per hour"], CO * 60)
    # the notice: 70 bpm × 100 mL and 100 bpm × 70 mL both pump 7 L/min
    assert near(readouts(b, HR=70, SV=100)["Cardiac output"], 7.0)
    assert near(readouts(b, HR=100, SV=70)["Cardiac output"], 7.0)
    # the dot sits on the line
    assert near(curve(b, 75), CO)
    # sliders stay inside the textbook's resting ranges (55–100 mL)
    sv = next(p for p in b["params"] if p["name"] == "SV")
    assert (sv["min"], sv["max"]) == (55, 100)


def test_explore_vessel_radius():
    b = find("heart-and-vessels", "xpl-vessel-radius")
    assert near(readouts(b)["Resistance (× original)"], 1.0)
    at80 = readouts(b, r=80)
    assert near(at80["Resistance (× original)"], 1 / 0.8**4) and round(at80["Resistance (× original)"], 1) == 2.4
    assert round(at80["Flow at the normal pressure (× original)"], 2) == 0.41
    # flow halves at about 84 % of the radius
    assert round(100 * 0.5 ** 0.25) == 84
    assert near(readouts(b, r=50)["Resistance (× original)"], 16)
    # the curve is flow = ΔP/R: linear in the pressure difference
    assert near(curve(b, 2, r=80), 2 * curve(b, 1, r=80))
