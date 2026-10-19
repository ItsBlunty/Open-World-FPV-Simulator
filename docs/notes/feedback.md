# Bug reports and suggestions from the game

Section §0w. Read only when working on the Report screen; `HANDOFF.md` has the current state.

## 0w. Report screen (owner, 2026-10-18): built, waiting for the owner to try it

**Asked:** "add an in-game button to report issues to the github as issues or suggestions. Give it some format,
include game state and such for future reference or to replicate issues."

**How it works** (read from GitHub's docs, 2026-10-18: "Creating an issue" > from a URL query, and "Attaching files"):
- Menu > "Problems or ideas" > **Report or suggest** opens the Report screen (`ui/report-ui.ts`). The sim stays
  paused (the screen opens in the same task as the menu closes; a first version awaited the flight list first, and
  the sim ran for a moment in between: caught by the probe, tick 268 unpaused).
- The pilot picks Bug or Suggestion and writes a title and two or three short fields. **Open on GitHub** opens
  `…/issues/new?title=…&body=…&labels=bug|enhancement` in a new tab; the pilot checks it and presses Create there.
  Nothing is sent from the game, no token or account is stored. **Copy report** puts the whole text on the clipboard.
- GitHub applies `labels` only for people allowed to label issues (the owner); for players the title prefix
  `[Bug]` / `[Suggestion]` sorts them. A link past the server's limit gets "414 URI Too Long" (no number given):
  the game keeps links under 7500 characters (`MAX_URL`), dropping the settings, then the errors, then the end of
  long text from the link, and copies the full report to the clipboard with a note to paste it.
- The flight file (Download this flight, `.owfpv.json`) can be dragged into the issue: GitHub takes `.json` in issue
  comments, up to 25 MB. That file replays the visit exactly (saved flights §0t).

**The format** (`report.ts`, sample in `docs/evidence/2026-10-18-report/sample-issue-body.md`):
- Bug: "What happened", "Steps to make it happen", "What I expected". Suggestion: "The idea", "Why it would help".
  An empty field reads "_Not given._".
- "Game details", folded under `<details>`: a table with Build (commit and date, from `vite.config.ts` `__BUILD__`:
  CI's GITHUB_SHA or git), Page URL (with its `?` options), Browser, Screen, GPU (WebGL's unmasked renderer name),
  Input (device, report rate, stick mode), Renderer (backend, where, fps, draws, triangles), Map (id, version, spawn,
  traffic, traffic version), Flight (sim-core version, tick, life, hitches, paused), Quad (armed, crashed, position,
  speed, velocity, roll / pitch / yaw), Camera (FPV / chase / free, replay playhead), Saved flight id, Uptime. Then the
  settings and flight-model overrides as JSON, and the last 12 errors and warnings the page logged (console.error,
  console.warn, uncaught errors and rejections; the console still shows them).
- The engine answers a typed `report` message (`engine/protocol.ts` EngineReport); it reads state only.
- The pilot can untick "Include the game's state", and sees exactly what is included before opening GitHub.

**Evidence:** `test/report.test.ts` (6 tests: titles, sections, the table, the link's title / body / label, the
length cap and clipboard copy, the error log). Headless Chrome on the production build (`report-probe-demo.js`):
from the start menu the report shows tick 0, paused, no saved flight; mid-flight (demo, Esc, Report) it shows the
quad's state, the saved flight and a Download button; `window.open` was replaced in the probe, so nothing reached
GitHub. A typical link is about 2 kB. Screenshot `report-screen.png`. Suite: 55 files, 481 tests pass.

**Left open:** not tried against GitHub itself (would create a real issue: the owner's call). No issue templates in
the repo (`.github/ISSUE_TEMPLATE`); a link with `body` fills the form directly anyway. Errors inside the engine
worker (`?render=worker`) are not captured. The GPU name and browser string go into a public issue: the pilot sees
them first and can untick the state.
