// Render lab: one scene with the real sky, surfaces, a prop and a character, through the full
// post stack, for checking the look in isolation. ?theme=desert|port|snow|menu&q=high
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createGPU, gpuLabel } from '../src/gfx/gpu.js';
import { loadClips, loadGLB, loadSurface } from '../src/gfx/assets.js';
import { applySky, THEMES } from '../src/gfx/sky.js';
import { surfaceMaterial, WEATHER } from '../src/gfx/materials.js';
import { createPost } from '../src/gfx/post.js';
import { QUALITY } from '../src/settings.js';

const q = new URLSearchParams(location.search);
const themeName = q.get('theme') || 'desert';
const quality = { ...QUALITY[q.get('q') || 'high'] };
for (const k of ['ao', 'motionBlur', 'aa', 'bloom', 'flare']) if (q.has(k)) quality[k] = q.get(k) === '0' ? false : isNaN(+q.get(k)) ? q.get(k) : +q.get(k);
const canvas = document.getElementById('c');
const renderer = await createGPU(canvas, { backend: q.get('backend') || 'auto' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1500);
const sun = new THREE.DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const bounce = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
scene.add(bounce);
const { theme, sunDir } = await applySky(scene, sun, themeName, bounce);
sun.position.copy(sunDir).multiplyScalar(100);
WEATHER.wet.value = theme.wet || 0;
WEATHER.snow.value = themeName === 'snow' ? 1 : 0;

const S = Object.fromEntries(await Promise.all(['gravelly_sand', 'dense_sand', 'clay_plaster', 'rough_plaster_brick', 'asphalt_02', 'snow_02', 'concrete_wall_008', 'container_side'].map(async (id) => [id, await loadSurface(id)])));
const groundSet = themeName === 'port' ? S.asphalt_02 : themeName === 'snow' ? S.snow_02 : S.gravelly_sand;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), surfaceMaterial(groundSet, { mapping: 'ground', scale: 3, blend: themeName === 'desert' || themeName === 'menu' ? { set: S.dense_sand, scale: 4, amount: 0.45, noise: 0.06 } : null, wet: themeName === 'port' }));
ground.receiveShadow = true;
scene.add(ground);
const wallSet = themeName === 'port' ? S.container_side : themeName === 'snow' ? S.concrete_wall_008 : S.clay_plaster;
const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 4), surfaceMaterial(wallSet, { scale: 3, grime: 1.6, blend: themeName === 'desert' ? { set: S.rough_plaster_brick, scale: 2.5, amount: 0.25, noise: 0.25 } : null, wet: themeName === 'port', snow: themeName === 'snow' ? { set: S.snow_02 } : null }));
wall.position.set(0, 3.5, -6);
wall.castShadow = wall.receiveShadow = true;
scene.add(wall);

const crate = (await loadGLB('props/wooden_military_crate.glb')).scene.clone();
crate.position.set(2.2, 0, -1);
crate.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
scene.add(crate);
const barrier = (await loadGLB('props/concrete_road_barrier.glb')).scene.clone();
barrier.position.set(-3, 0, -1.5);
barrier.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
scene.add(barrier);

const clips = await loadClips();
const people = [];
for (const [i, name] of (q.get('m') || 'Military_Male_03,Military_Male_02,Security_Male_01').split(',').entries()) {
  const src = (await loadGLB(`characters/${name}.glb`)).scene;
  const m = cloneSkinned(src);
  m.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      if (o.material.name?.includes('helmet') && i === 0) o.visible = false;
    }
  });
  m.position.set(-1 + i * 1.1, 0, 0.5 - i * 0.6);
  m.rotation.y = 0.4 - i * 0.3;
  scene.add(m);
  const mixer = new THREE.AnimationMixer(m);
  mixer.clipAction(clips[i === 1 ? 'idleLook' : 'idle']).play();
  people.push(mixer);
}

const post = createPost(renderer, scene, camera);
post.setQuality(quality);
post.setSize(innerWidth, innerHeight);
post.setLook(theme);
for (const k of ['grain', 'sharpen', 'aberration', 'vignette']) if (q.has(k)) post.uniforms[k].value = +q.get(k);

const yaw = Number(q.get('yaw') ?? 0.35);
const dist = Number(q.get('d') ?? 4.2);
const ty = Number(q.get('ty') ?? 1.2);
camera.position.set(Math.sin(yaw) * dist, ty + Number(q.get('cy') ?? 0.35), 2 + Math.cos(yaw) * dist);
camera.lookAt(0, ty, 0);

const info = document.getElementById('info');
let frames = 0;
let t0 = performance.now();
let last = performance.now();
window.lab = { renderer, scene, camera, post, fps: 0, gpu: gpuLabel() };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const m of people) m.update(dt);
  post.uniforms.time.value = now / 1000;
  post.render();
  frames++;
  if (now - t0 > 1000) {
    window.lab.fps = Math.round((frames * 1000) / (now - t0));
    info.textContent = `${gpuLabel()}  ${window.lab.fps} fps  ${renderer.info.render.drawCalls} draws  ${renderer.info.render.triangles} tris`;
    frames = 0;
    t0 = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.ready = true;
