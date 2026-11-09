# "Red one" blackbox log (owner, 2026-11-08)

The owner's own quad: custom 5-inch freestyle frame, squashed X, R29 props, 2207.5 1750 KV motors, 700 g all-up
weight. Betaflight 4.5.5 on a TBS Lucid FC (AT32F435), 8 kHz loop, logged at ~1970 Hz with bidirectional DShot eRPM,
14 poles. The log file (`red one.BBL`, 8 MB, not committed) holds two flights: 15 s of hover on a part-used pack and
88 s of freestyle on a fresh one (25.1 V at rest; the flash filled, so the end of flight 2 is cut off).

Decoded with orangebox 0.5.0 (GPL-3.0, PyPI) into numpy; `scripts/` holds every script, `results.txt` their output.
Run: `python scripts/decode.py "red one.BBL" out`, then `python scripts/<name>.py out scripts`.

Summary: see `docs/notes/physics.md` §2v.
