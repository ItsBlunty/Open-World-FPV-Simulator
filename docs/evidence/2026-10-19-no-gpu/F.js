const T = fly.renderer.constructor; let n = 0;
fly.scene.traverse((o) => { const m = o.material; if (m && m.isMeshLambertMaterial) { const THREE_Basic = Object.getPrototypeOf(Object.getPrototypeOf(m)).constructor; } });
// find MeshBasicMaterial via an existing basic material in the scene
let Basic = null; fly.scene.traverse((o) => { if (!Basic && o.material && o.material.isMeshBasicMaterial) Basic = o.material.constructor; });
fly.scene.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && m.isMeshLambertMaterial && Basic) { o.material = new Basic({ color: m.color, vertexColors: m.vertexColors, map: m.map, transparent: m.transparent, opacity: m.opacity, side: m.side, fog: true }); n++; } });
return n;
