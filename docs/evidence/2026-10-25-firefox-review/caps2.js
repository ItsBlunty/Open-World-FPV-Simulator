(async () => {
  const out = {};
  const a = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
  out.adapter = a ? { vendor: a.info?.vendor, arch: a.info?.architecture, maxTex: a.limits.maxTextureDimension2D, maxBufferSize: a.limits.maxBufferSize, features: [...a.features].sort() } : null;
  try { const ac = new AudioContext({ latencyHint: 0 }); out.audio0 = { base: ac.baseLatency, output: ac.outputLatency, state: ac.state }; } catch (e) { out.audioErr = String(e); }
  try { const ac = new AudioContext({ latencyHint: 'interactive' }); out.audioI = { base: ac.baseLatency, output: ac.outputLatency, state: ac.state }; } catch (e) { out.audioErr2 = String(e); }
  return JSON.stringify(out);
})()
