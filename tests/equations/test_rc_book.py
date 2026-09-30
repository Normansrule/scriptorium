"""Verification of every key equation and worked example in examples/rc-circuits.

Each test is referenced by an equation's `example.check` field in book.json, and
tests/unit/book.test.ts fails if a pointer names a test that does not exist here.

Algebra is checked with SymPy; numbers and units with Pint, so mixing up units such as
farads and henries fails dimensionally. One trap Pint cannot catch: it treats the radian
as dimensionless, so rad/s converts silently to Hz. The 2π in the cutoff frequency is
therefore guarded numerically (test_cutoff_needs_two_pi).
"""

import math

import pint
import sympy as sp

u = pint.UnitRegistry()

# Value used in the book, as given by the cited textbook (OpenStax University Physics Vol. 2, §8.1).
EPS0 = 8.85e-12 * u.F / u.m


def close(a, b, rel=1e-3):
    return math.isclose(a, b, rel_tol=rel)


# --- Chapter 1 -------------------------------------------------------------------------------


def test_capacitance_example():
    C = (47e-6 * u.C) / (10 * u.V)
    assert C.check("[capacitance]")
    assert close(C.to("uF").magnitude, 4.7)


def test_parallel_plate_example():
    A = (0.10 * u.m) * (0.10 * u.m)
    d = 1.0e-3 * u.m
    C_vac = (EPS0 * A / d).to("pF")
    C_air = (1.00059 * EPS0 * A / d).to("pF")
    assert close(C_vac.magnitude, 88.5)
    # Air changes the answer by 0.059 % (the book says 0.06 %).
    assert close(C_air.magnitude / C_vac.magnitude - 1, 0.00059, rel=0.02)


def test_parallel_plate_scaling():
    """Doubling area doubles C; doubling the gap halves it (the figure shows this)."""
    eps, A, d = sp.symbols("epsilon A d", positive=True)
    C = eps * A / d
    assert sp.simplify(C.subs(A, 2 * A) / C) == 2
    assert sp.simplify(C.subs(d, 2 * d) / C) == sp.Rational(1, 2)


def test_energy_example():
    U = (0.5 * (100e-6 * u.F) * (12 * u.V) ** 2).to("mJ")
    assert close(U.magnitude, 7.2)


def test_charging_energy_split():
    """Charging from a fixed supply: the supply delivers QV = CV², the capacitor keeps ½CV², the resistor turns ½CV² into heat, for any R."""
    t, R, C, Vs = sp.symbols("t R C V_s", positive=True)
    i = (Vs / R) * sp.exp(-t / (R * C))
    supplied = sp.integrate(Vs * i, (t, 0, sp.oo))
    heat = sp.integrate(i**2 * R, (t, 0, sp.oo))
    assert sp.simplify(supplied - C * Vs**2) == 0
    assert sp.simplify(heat - sp.Rational(1, 2) * C * Vs**2) == 0


def test_energy_derivation():
    """U = ∫0^Q V dq with V = q/C gives ½CV² = ½QV = Q²/(2C)."""
    q, Q, C = sp.symbols("q Q C", positive=True)
    U = sp.integrate(q / C, (q, 0, Q))
    V = Q / C
    assert sp.simplify(U - sp.Rational(1, 2) * C * V**2) == 0
    assert sp.simplify(U - sp.Rational(1, 2) * Q * V) == 0


# --- Chapter 2 -------------------------------------------------------------------------------


def test_tau_example():
    tau = (10e3 * u.ohm * 100e-6 * u.F).to("s")
    assert close(tau.magnitude, 1.0)


def test_tau_units():
    """Ohms times farads is seconds."""
    assert (1 * u.ohm * u.F).to("s").magnitude == 1


def test_charging_derivation():
    """Kirchhoff's voltage law V_s = iR + v with i = C dv/dt, starting uncharged."""
    t, R, C, Vs = sp.symbols("t R C V_s", positive=True)
    v = sp.Function("v")
    sol = sp.dsolve(sp.Eq(Vs, R * C * v(t).diff(t) + v(t)), v(t), ics={v(0): 0})
    assert sp.simplify(sol.rhs - Vs * (1 - sp.exp(-t / (R * C)))) == 0


def test_charging_example():
    Vs = 5.0
    assert close(1 - math.exp(-1), 0.632, rel=1e-3)
    assert close(Vs * (1 - math.exp(-1)), 3.16, rel=1e-3)
    assert close(1 - math.exp(-5), 0.993, rel=1e-3)
    assert close(Vs * (1 - math.exp(-5)), 4.97, rel=1e-3)


def test_discharging_derivation():
    t, R, C, V0 = sp.symbols("t R C V_0", positive=True)
    v = sp.Function("v")
    sol = sp.dsolve(sp.Eq(0, R * C * v(t).diff(t) + v(t)), v(t), ics={v(0): V0})
    assert sp.simplify(sol.rhs - V0 * sp.exp(-t / (R * C))) == 0


def test_half_life_example():
    t, tau = sp.symbols("t tau", positive=True)
    t_half = sp.solve(sp.Eq(sp.exp(-t / tau), sp.Rational(1, 2)), t)[0]
    assert sp.simplify(t_half - tau * sp.log(2)) == 0
    assert close(float(sp.log(2)), 0.693, rel=1e-3)


# --- Chapter 3 -------------------------------------------------------------------------------


def test_cutoff_example():
    fc = (1 / (2 * math.pi * 1.6e3 * u.ohm * 100e-9 * u.F)).to("Hz")
    assert close(fc.magnitude, 995, rel=1e-3)


def test_cutoff_needs_two_pi():
    """Leaving out the 2π gives 6250 Hz instead of 995 Hz; the example's number rules that out."""
    wrong = (1 / (1.6e3 * u.ohm * 100e-9 * u.F)).to("Hz").magnitude
    assert close(wrong, 6250, rel=1e-3)
    assert not close(wrong, 995, rel=0.05)


def test_gain_derivation():
    """Voltage divider of R and 1/(jωC): H = 1/(1 + jωRC), |H| = 1/√(1 + (ωRC)²) = 1/√(1 + (f/fc)²)."""
    w, R, C, f = sp.symbols("omega R C f", positive=True)
    Zc = 1 / (sp.I * w * C)
    H = sp.simplify(Zc / (R + Zc))
    assert sp.simplify(H - 1 / (1 + sp.I * w * R * C)) == 0
    mag = sp.sqrt(sp.simplify(H * sp.conjugate(H)))
    fc = 1 / (2 * sp.pi * R * C)
    assert sp.simplify(mag.subs(w, 2 * sp.pi * f) - 1 / sp.sqrt(1 + (f / fc) ** 2)) == 0


def test_gain_examples():
    g = lambda r: 1 / math.sqrt(1 + r**2)  # noqa: E731
    assert close(g(1), 0.707, rel=1e-3)
    assert close(g(10), 0.0995, rel=1e-3)
    assert close(20 * math.log10(g(1)), -3.01, rel=1e-3)
    assert close(20 * math.log10(g(10)), -20.04, rel=1e-3)
    assert close(20 * math.log10(g(0.1)), -0.043, rel=1e-2)


def test_rolloff_asymptote():
    """Far above cutoff the gain falls 20 dB for every factor of 10 in frequency."""
    r = sp.symbols("r", positive=True)
    gdb = 20 * sp.log(1 / sp.sqrt(1 + r**2), 10)
    slope = sp.limit(sp.diff(gdb, r) * r * sp.log(10), r, sp.oo)  # d(gain)/d(log10 r)
    assert slope == -20


def test_phase_at_cutoff():
    """The output lags the input by atan(f/fc): 45° at the cutoff frequency."""
    w, R, C = sp.symbols("omega R C", positive=True)
    H = 1 / (1 + sp.I * w * R * C)
    phase = sp.arg(H.subs(w, 1 / (R * C)))
    assert sp.simplify(phase + sp.pi / 4) == 0
