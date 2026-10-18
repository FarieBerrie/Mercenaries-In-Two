// A small stage for the dev pages: renderer, theme sky, ground, sun with shadows, post, and a
// frame loop with an FPS readout.
import * as THREE from 'three/webgpu';
import { createGPU, gpuLabel } from '../src/gfx/gpu.js';
import { loadSurface } from '../src/gfx/assets.js';
import { applySky } from '../src/gfx/sky.js';
import { surfaceMaterial, WEATHER } from '../src/gfx/materials.js';
import { createPost } from '../src/gfx/post.js';
import { QUALITY } from '../src/settings.js';
import { PEOPLE } from '../src/gfx/characters.js';

export async function createStage({ ground: withGround = true } = {}) {
  const q = new URLSearchParams(location.search);
  const themeName = q.get('theme') || 'desert';
  const quality = { ...QUALITY[q.get('q') || 'high'] };
  for (const k of ['ao', 'motionBlur', 'aa', 'bloom', 'flare']) if (q.has(k)) quality[k] = q.get(k) === '0' ? false : isNaN(+q.get(k)) ? q.get(k) : +q.get(k);
  const canvas = document.getElementById('c');
  const renderer = await createGPU(canvas, { backend: q.get('backend') || 'auto' });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(q.get('fov') || 40), innerWidth / innerHeight, 0.05, 1500);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 200 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const bounce = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
  scene.add(bounce);
  const { theme, sunDir } = await applySky(scene, sun, themeName, bounce);
  sun.position.copy(sunDir).multiplyScalar(100);
  WEATHER.wet.value = theme.wet || 0;
  WEATHER.snow.value = themeName === 'snow' ? 1 : 0;
  PEOPLE.rim.value = theme.rim;
  if (withGround) {
    const groundId = themeName === 'port' ? 'asphalt_02' : themeName === 'snow' ? 'snow_02' : 'gravelly_sand';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), surfaceMaterial(await loadSurface(groundId), { mapping: 'ground', scale: 3, wet: themeName === 'port' }));
    ground.receiveShadow = true;
    scene.add(ground);
  }
  const post = createPost(renderer, scene, camera);
  post.setQuality(quality);
  post.setSize(innerWidth, innerHeight);
  post.setLook(theme);
  const info = document.getElementById('info');
  const stage = { q, renderer, scene, camera, sun, post, theme, themeName, fps: 0, gpu: gpuLabel(), onFrame: null, t: 0 };
  let frames = 0;
  let t0 = performance.now();
  let last = performance.now();
  stage.step = (dt) => {
    stage.t += dt;
    stage.onFrame?.(dt, stage.t);
    post.uniforms.time.value = stage.t;
    if (q.get('post') === '0') renderer.render(scene, camera);
    else post.render();
  };
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!stage.paused) stage.step(dt);
    frames++;
    if (now - t0 > 1000) {
      stage.fps = Math.round((frames * 1000) / (now - t0));
      info.textContent = `${gpuLabel()}  ${stage.fps} fps  ${renderer.info.render.drawCalls} draws  ${renderer.info.render.triangles} tris`;
      frames = 0;
      t0 = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.stage = stage;
  return stage;
}
