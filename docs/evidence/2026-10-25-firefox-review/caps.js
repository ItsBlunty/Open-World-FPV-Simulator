(async () => {
    const out = { ua: navigator.userAgent, secure: isSecureContext };
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { depth: true });
    if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        out.webgl2 = {
            renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR),
            unmasked: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
            depthBits: gl.getParameter(gl.DEPTH_BITS),
            clipControl: !!gl.getExtension('EXT_clip_control'),
            maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxSamples: gl.getParameter(gl.MAX_SAMPLES),
            exts: gl.getSupportedExtensions()
        };
    }
    out.caveatOk = !!document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    out.gpu = !!navigator.gpu;
    if (navigator.gpu) {
        try {
            const a = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility' });
            out.adapter = a ? { info: a.info ? { vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description } : null, maxTex: a.limits.maxTextureDimension2D, features: [...a.features] } : null;
            out.preferredFormat = navigator.gpu.getPreferredCanvasFormat();
        } catch (e) { out.adapterError = String(e); }
    }
    out.hid = 'hid' in navigator; out.serial = 'serial' in navigator; out.usb = 'usb' in navigator;
    out.gamepads = typeof navigator.getGamepads;
    out.userAgentData = 'userAgentData' in navigator;
    out.scheduler = typeof globalThis.scheduler;
    try {
        const ac = new AudioContext({ latencyHint: 0 }); await ac.resume().catch(()=>0); await new Promise(r=>setTimeout(r,500));
        out.audio0 = { base: ac.baseLatency, output: ac.outputLatency, rate: ac.sampleRate, state: ac.state };
        ac.close();
        const ac2 = new AudioContext({ latencyHint: "interactive" }); await ac2.resume().catch(()=>0); await new Promise(r=>setTimeout(r,500));
        out.audioInteractive = { base: ac2.baseLatency, output: ac2.outputLatency };
        ac2.close();
    } catch (e) { out.audioError = String(e); }
    out.offscreenWebgl2 = !!new OffscreenCanvas(4, 4).getContext('webgl2');
    return JSON.stringify(out);
})()
