// World lab: a mission's level, dressed, with a free camera placed by URL.
// ?m=0..2 (mission) &x=&y=&z= (camera) &lx=&ly=&lz= (look at)
import * as THREE from 'three/webgpu';
import { createStage } from './stage.js';
import { buildLevel } from '../src/level.js';
import { buildWorld, preloadWorld } from '../src/gfx/world.js';

const q = new URLSearchParams(location.search);
const mi = Number(q.get('m') ?? 0);
const level = buildLevel(mi);
if (!q.has('theme')) {
  const u = new URL(location.href);
  u.searchParams.set('theme', level.theme);
  history.replaceState(null, '', u);
}
const stage = await createStage({ ground: false });
const { scene, camera, sun } = stage;
const t0 = performance.now();
const assets = await preloadWorld(level.theme);
const t1 = performance.now();
const world = buildWorld(level, assets, { detail: 1, lit: level.theme === 'port' });
const t2 = performance.now();
scene.add(world.group);
const n = (k, d) => Number(q.get(k) ?? d);
camera.position.set(n('x', 6), n('y', 2.2), n('z', 4));
camera.lookAt(n('lx', 30), n('ly', 1.5), n('lz', 0));
// Shadows follow the view
const s = sun.shadow.camera;
Object.assign(s, { left: -40, right: 40, top: 40, bottom: -40, far: 400 });
s.updateProjectionMatrix();
sun.target.position.set(n('lx', 30), 0, n('lz', 0));
sun.position.copy(sun.target.position).addScaledVector(new THREE.Vector3().copy(sun.position).normalize(), 150);
let draws = 0;
scene.traverse((o) => o.isMesh && draws++);
stage.onFrame = (dt, t) => world.update(t, null);
// What the meshes and triangles are spent on, by material / prop
const by = {};
scene.traverse((o) => {
  if (!o.isMesh) return;
  const key = (o.name || o.material?.name || 'unnamed').split('@')[0];
  const g = o.geometry;
  const tris = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
  by[key] ??= { meshes: 0, tris: 0 };
  by[key].meshes++;
  by[key].tris += Math.round(tris);
});
const top = Object.entries(by).sort((a, b) => b[1].tris - a[1].tris).slice(0, 60).map(([k, v]) => `${k}:${v.meshes}/${(v.tris / 1000).toFixed(0)}k`);
window.info = { load: Math.round(t1 - t0), build: Math.round(t2 - t1), meshes: draws, tris: Object.values(by).reduce((s, v) => s + v.tris, 0), boxes: level.boxes.length, top: top.join(' ') };
window.ready = true;
