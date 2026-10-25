(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 900 && !window.__selftest; i++) await sleep(200);
  const s = window.__selftest; return JSON.stringify(s ? { ok: s.ok, flightOk: s.flightOk, trafficOk: s.trafficOk, hash: s.hash, traffic: s.traffic, engine: __fly.engine } : { error: 'no selftest result', text: document.body.innerText.slice(0, 400) });
})()
