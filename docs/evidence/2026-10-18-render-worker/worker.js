import * as THREE from './three.webgpu.js';
onmessage = async (e) => {
  const r = { rafInWorker: typeof requestAnimationFrame, gpuInWorker: typeof navigator.gpu };
  try {
    const renderer = new THREE.WebGPURenderer({ canvas: e.data.canvas, antialias: true, forceWebGL: e.data.webgl });
    renderer.setSize(800, 600, false);
    await renderer.init();
    r.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 100); cam.position.z = 3;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x44aa88 }));
    scene.add(mesh, new THREE.DirectionalLight(0xffffff, 3), new THREE.AmbientLight(0x404040));
    let frames = 0; const t0 = performance.now();
    renderer.setAnimationLoop(() => { frames++; mesh.rotation.y += 0.02; renderer.render(scene, cam); });
    setTimeout(() => { setTimeout(() => {
      r.workerFps = frames / ((performance.now() - t0) / 1000);
      r.done = true; postMessage(r); renderer.setAnimationLoop(null); }, 5000); }, 1000);
  } catch (err) { r.error = String(err && err.stack || err); r.done = true; postMessage(r); }
};
