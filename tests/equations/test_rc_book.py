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


# --- Chapter 2: worked problem, experiment, application, practice ------------------------------


def test_threshold_problem():
    """Problem: 5 V through 10 kΩ into 100 µF; the input reads high above 3.5 V."""
    tau = (10e3 * u.ohm * 100e-6 * u.F).to("s")
    assert close(tau.magnitude, 1.0)
    t = tau * math.log(1 / (1 - 3.5 / 5.0))  # 1 - e^{-t/τ} = 0.7  →  t = τ ln(10/3)
    assert close(t.magnitude, 1.204, rel=1e-3)
    assert tau.magnitude < t.magnitude < 2 * tau.magnitude  # 70 % lies between 63 % (1τ) and 86 % (2τ)
    # symbolic: the supply voltage cancels
    tt, T, Vs = sp.symbols("t tau V_s", positive=True)
    sol = sp.solve(sp.Eq(sp.Rational(7, 10) * Vs, Vs * (1 - sp.exp(-tt / T))), tt)
    assert sp.simplify(sol[0] - T * sp.log(sp.Rational(10, 3))) == 0


def test_measure_tau_experiment():
    """Experiment: 100 kΩ and 100 µF give τ = 10 s; 63.2 % of a 4.5 V pack is 2.84 V; a 10 MΩ meter lowers the final voltage by about 1 %."""
    assert close((100e3 * u.ohm * 100e-6 * u.F).to("s").magnitude, 10.0)
    assert close(0.632 * 4.5, 2.84, rel=2e-3)
    divider = 10e6 / (10e6 + 100e3)
    assert close(1 - divider, 0.0099, rel=0.01)


def test_debounce_numbers():
    """Application: 10 kΩ and 1 µF give τ = 10 ms; the 70 % threshold is crossed at 12.0 ms."""
    tau = (10e3 * u.ohm * 1e-6 * u.F).to("ms")
    assert close(tau.magnitude, 10.0)
    assert close(tau.magnitude * math.log(10 / 3), 12.04, rel=1e-3)


def test_exercise_tau_value():
    assert close((4.7e3 * u.ohm * 220e-6 * u.F).to("s").magnitude, 1.034, rel=1e-3)


def test_exercise_three_tau():
    assert close(1 - math.exp(-3), 0.950, rel=1e-3)


def test_exercise_discharge_time():
    """12 V → 3 V with τ = 2 s: t = τ ln 4 = 2.77 s, the same as two half-lives."""
    t = 2.0 * math.log(12 / 3)
    assert close(t, 2.77, rel=2e-3)
    assert close(t, 2 * (2.0 * math.log(2)), rel=1e-9)


def test_exercise_design():
    """Two thirds of the supply in 50 ms with 10 µF: R = 4.55 kΩ; the nearest E12 value, 4.7 kΩ, gives 51.6 ms."""
    tau = 50e-3 / math.log(3)
    R = tau / 10e-6
    assert close(R, 4551, rel=1e-3)
    e12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]
    nearest = min((v * 1e3 for v in e12), key=lambda v: abs(v - R))
    assert nearest == 4.7e3
    assert close(nearest * 10e-6 * math.log(3) * 1e3, 51.6, rel=2e-3)


# --- Explorables: the book's own expressions, evaluated from book.json --------------------------

from explore_check import close as near, curve, find, readouts  # noqa: E402


def test_explore_energy():
    b = find("rc-circuits", "xpl-energy")
    r = readouts(b)
    U12 = (0.5 * (100 * u.uF) * (12 * u.V) ** 2).to("mJ").magnitude
    assert near(r["Energy at 12 V"], U12) and near(U12, 7.2)
    assert near(r["Energy at 12 V"] / r["Energy at 6 V"], 4)  # twice the voltage, four times the energy
    # the curve is the same law: at 12 V it passes through the readout, and capacitance scales it
    assert near(curve(b, 12), U12)
    assert near(curve(b, 12, C=200) / curve(b, 12), 2)


def test_explore_charging():
    b = find("rc-circuits", "xpl-charging")
    r = readouts(b)
    tau = ((10 * u.kohm) * (100 * u.uF)).to("s").magnitude
    assert near(r["Time constant τ = RC"], tau) and near(tau, 1.0)
    assert near(r["Time to reach 99 % (τ ln 100)"], tau * math.log(100))
    # the curve crosses 63.2 % at t = τ for any R and C (the explorable's "notice")
    for R, C in [(10, 100), (47, 100), (10, 470), (2.2, 33)]:
        t = ((R * u.kohm) * (C * u.uF)).to("s").magnitude
        assert near(curve(b, t, R=R, C=C), 1 - math.exp(-1))
    assert near(b["plot"]["levels"][0]["y"], 1 - math.exp(-1), rel=1e-3)


def test_explore_lowpass():
    b = find("rc-circuits", "xpl-lowpass")
    r = readouts(b)
    fc = (1 / (2 * math.pi * (1.6 * u.kohm) * (100 * u.nF))).to("Hz").magnitude
    assert near(r["Cutoff frequency, 1/(2πRC)"], fc) and round(fc) == 995
    assert near(curve(b, fc), 20 * math.log10(1 / math.sqrt(2)))  # −3.01 dB at the cutoff
    # ten times R moves the cutoff down tenfold; far above it the slope is −20 dB per decade
    assert near(readouts(b, R=16)["Cutoff frequency, 1/(2πRC)"], fc / 10)
    assert abs((curve(b, 100 * fc) - curve(b, 10 * fc)) + 20) < 0.1
    g10k = 20 * math.log10(1 / math.sqrt(1 + (10000 / fc) ** 2))
    assert near(r["Gain at 10 kHz"], g10k)
