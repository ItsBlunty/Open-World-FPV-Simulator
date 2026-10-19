# Saved flights

Work notes. Read only when working in this area; `HANDOFF.md` has the current state.

## 0t. Saved flights (owner, 2026-10-18): built, before the freestyle grader

**Asked:** the owner chose to save flights in the browser before building the grader, so every graded attempt can be
replayed and re-scored later (and for the trick report, replay and ghost ideas in `docs/decisions.md`).

**What a flight is (`apps/fly/src/flights.ts`, format `owfpv-flight/1`).** One visit to the page flown with a radio (or
`?demo`): sim-core's kept lives (the runner keeps the last 30, 32 MiB at most), each its `LifeHeader`, its records (the
sticks applied, respawns, world changes), its end tick, its trace hash and any snapshot; plus the preset JSON by sha256
(so a later preset edit cannot change an old flight), the map id and version, sim-core's version, and the golden props
taken with their ticks. A visit with only the free camera is not saved.

**Trace hashes are now on in the game** (`FlightSession` option `traceHash`, set by the engine): a SHA-256 of every
tick's state per life. Measured in Node on the first map: about 3 ms per simulated second (physics 9-14 ms), so about
0.05 ms per 60 fps frame. The flight, traffic and classic self-test hashes are unchanged (hashing reads the state only).

**When it is saved.** When the sim pauses (the menu or any screen opens, the tab is hidden) and every 60 s of flying; the
same visit's record is replaced each time. Stored in IndexedDB (`owfpv` / `flights`, with a summary beside it in
`flight-summaries`): the newest 30 kept and 256 MiB of records at most, the newest always. About 1 MB per minute at a
500 Hz radio.

**Checking one (`checkFlight`).** Each life replays on its own from its header and records (sim-core `replayLives`); its
collision is rebuilt from the map and the traffic toggles its header's collision hash names (the 8 combinations are
tried). Match = every life's hash equals the saved one. A flight from another map version or traffic version says so
instead of replaying wrong. The menu's "Saved flights" screen lists flights with length, lives, props and size, and per
flight: Check replay (in a worker, `check-worker.ts`), Download (JSON with base64 records), Delete (asks twice; this
visit's own flight cannot be deleted).

**Evidence:** `apps/fly/test/flights.test.ts`: a 12 s flight with traffic, a settings change and a crash respawn
replays to the same hashes life by life, also after a JSON round trip; a changed throttle record is caught; another map
version is refused with the reason. `pnpm test` 52 files, 454 tests. In the built-in browser (Chrome, dev server,
`?demo`): a 19 s flight of 3 lives saved, "Replay matches" on the screen; its first two lives (one ended by the
`stuck-wedged` rewind), taken out of IndexedDB, replay in Node to the same hashes: Chrome and Node agree.

**Opening a flight file (2026-10-19, owner asked: "you can download but not upload it again").** Saved flights >
Open a flight file… (or drop the file on the screen; several at once) reads a downloaded `.owfpv.json` and keeps it in
this browser beside the flights flown here, marked "from a file"; Watch and Check replay then treat it the same. A file
that is not a flight, or is damaged, is refused with the reason (`flightFromJson`); a file of this visit's own flight is
refused (the minute save would overwrite it). The same flight opened twice replaces itself (same id). The 30 kept are
now the 30 saved most recently (`savedAt` in the summary; older summaries count by their flight date), so an old file
opened today is not dropped at once. Evidence: `flights.test.ts` refuses non-JSON, other formats and a damaged lives
list (503 tests). In the built-in browser (dev server): an 8 s flight file written in Node, opened with a non-flight
file: the flight added, "notes.json: not a saved flight (not JSON)" shown; Check replay "Replay matches (1 life)"; Watch
plays it. Not tried: drag and drop by hand (same code path as the button).

**Left open:** (the replay viewer is built since: `replay-viewer.md` §0u.) Flights of an older map or traffic version cannot be checked (keep old builds, or version
the maps, if old flights must replay). A flight longer than the runner's 30 lives / 32 MiB keeps only its tail.
