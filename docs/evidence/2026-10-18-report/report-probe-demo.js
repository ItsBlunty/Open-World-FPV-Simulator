new Promise(async (res) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.trim().startsWith(t));
  let opened = null; window.open = (u) => { opened = u; return null; };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" })); await sleep(1500);
  console.warn('probe warning | for the log');
  btn('Report or suggest').click();
  await sleep(2500);
  const panel = document.querySelector('.report-field').closest('.panel');
  const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); };
  set(panel.querySelector('input[type=text]'), 'Probe: test report');
  const ta = panel.querySelectorAll('textarea');
  set(ta[0], 'The quad clipped a wall.'); set(ta[1], '1. Start at Park\n2. Fly north');
  panel.querySelector('details').open = true;
  await sleep(200);
  btn('Open on GitHub').click();
  await sleep(300);
  const u = new URL(opened);
  res(JSON.stringify({ fields: ta.length, buttons: [...panel.querySelectorAll('button')].map((b) => b.textContent), path: u.pathname, title: u.searchParams.get('title'), labels: u.searchParams.get('labels'), len: opened.length, msg: panel.querySelector('.hint')?.textContent, body: u.searchParams.get('body') }));
})
