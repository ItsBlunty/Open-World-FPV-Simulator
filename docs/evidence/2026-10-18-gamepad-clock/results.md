# Gamepad poll clock vs frame rate (2026-10-18)

`probe.html` does 6 ms of busy work in every requestAnimationFrame and runs one poll loop (`?mode=`), counting frames,
polls (gated to >= 2 ms apart, calling `navigator.getGamepads()`) and loop iterations over 3 s after a 2 s warm-up.
`serve.mjs` serves it on 127.0.0.1:18931 and appends each result to `results.txt`. No gamepad was connected.
Windows 11, 120 Hz display. Firefox 158 in a window (throwaway profile); Chrome 155 headless (`--headless=new`).

| Browser | mode | fps | polls/s | loop iterations/s |
|---|---|---|---|---|
| Firefox 158 | none | 120.3 | – | – |
| Firefox 158 | spin (MessageChannel, upstream) | 25.3 | 471 | 280 122 |
| Firefox 158 | spin + getGamepads | 25.7 | 472 | 281 305 |
| Firefox 158 | setTimeout 0 chain | 120.0 | 120 | 120 |
| Firefox 158 | setTimeout 1 chain | 120.0 | 120 | 120 |
| Firefox 158 | scheduler.postTask background | 22.7 | 391 | 322 765 |
| Firefox 158 | scheduler.postTask user-visible | 22.7 | 384 | 328 106 |
| Firefox 158 | requestIdleCallback chain | 120.0 | 105 | 105 |
| Firefox 158 | worker setInterval 1 ms -> postMessage (chosen) | 120.3 | 139-142 | 230 |
| Firefox 158 | worker setTimeout 1 ms chain | 120.3 | 141 | 229 |
| Firefox 158 | worker busy loop, post every 1 ms | 120.7 | 205 | 1 005 |
| Chrome 155 | none | 120 | – | – |
| Chrome 155 | spin + getGamepads | 119 | 223 | 73 093 |
| Chrome 155 | worker setInterval 1 ms (chosen) | 120 | 131 | 250 |
