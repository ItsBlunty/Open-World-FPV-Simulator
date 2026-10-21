# Chris Rosser's (AOS-RC) prop sweeps: fit a DC motor + ESC model to each sheet. ESC duty d = (signal - 1000) / 1000;
# torque constant Kt from Q = Kt (I - I0) (a least-squares line), back-EMF constant Ke = Kt (SI), then the effective
# resistance from d V = Ke w + R I + c (least squares over the points above 10 % throttle). Prints, per prop: KV, R, I0,
# the full-throttle point, and the fit's rms error. Usage: motor_fit.py "Prop Testing.xlsx" [sheet ...]
import sys, numpy as np, openpyxl
sys.stdout.reconfigure(encoding='utf-8')
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
sheets = sys.argv[2:] or [ws.title for ws in wb.worksheets if ws.title != 'Score']
for name in sheets:
    rows = [r for r in wb[name].iter_rows(values_only=True)]
    a = np.array([[float(x) if isinstance(x, (int, float)) else np.nan for x in r[:10]] for r in rows[1:] if r[0] is not None])
    sig, Q, T, V, I, rpm = a[:, 1], -a[:, 5], a[:, 6] * 9.80665e-3, a[:, 7], a[:, 8], a[:, 9]
    w = rpm * 2 * np.pi / 60; d = (sig - 1000) / 1000
    m = (d > 0.1) & (rpm > 1000) & np.isfinite(Q + I + V)
    kt, q0 = np.polyfit(I[m], Q[m], 1); i0 = -q0 / kt
    X = np.stack([w[m], I[m], np.ones(m.sum())], 1); ke, R, c = np.linalg.lstsq(X, d[m] * V[m], rcond=None)[0]
    res = d[m] * V[m] - X @ np.array([ke, R, c])
    full = np.argmax(sig)
    print(f'{name:28s} Kt {kt:.5f} N m/A (KV {60 / (2 * np.pi * kt):5.0f}), I0 {i0:4.2f} A | fit d V = Ke w + R I + c: Ke {ke:.5f} (KV {60 / (2 * np.pi * ke):5.0f}), R {R:.3f} ohm, c {c:+.2f} V, rms {np.sqrt(np.mean(res ** 2)):.2f} V | full: {rpm[full]:.0f} rpm, {T[full]:.2f} N, {I[full]:.1f} A at {V[full]:.2f} V')
