// Loading what's in public/assets (built by `npm run assets`): characters, animation clips,
// props, surfaces and skies. Everything is cached, so asking twice costs nothing, and a running
// count of bytes in flight drives the loading bars.
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const BASE = `${import.meta.env?.BASE_URL ?? './'}assets/`;
const cache = new Map();
const progress = { pending: 0, done: 0, listeners: new Set() };
let anisotropy = 8;

function track(promise) {
  progress.pending++;
  emit();
  return promise.finally(() => {
    progress.done++;
    emit();
  });
}
function emit() {
  for (const f of progress.listeners) f(progress.done, progress.pending);
}

/** Calls f(done, total) as loads start and finish. Returns an unsubscribe function. */
export function onProgress(f) {
  progress.listeners.add(f);
  return () => progress.listeners.delete(f);
}

export function setAnisotropy(n) {
  anisotropy = n;
}

function once(key, make) {
  if (!cache.has(key)) cache.set(key, track(make()));
  return cache.get(key);
}

const gltf = new GLTFLoader();
const textures = new THREE.TextureLoader();
const hdr = new HDRLoader();

/** A glTF binary: { scene, animations }. Callers clone what they use. */
export const loadGLB = (path) => once(`glb:${path}`, () => gltf.loadAsync(BASE + path));

export const loadJSON = (path) => once(`json:${path}`, () => fetch(BASE + path).then((r) => r.json()));

/** An image texture. srgb for colour maps; repeat for tiling surfaces. */
export function loadTexture(path, { srgb = false, repeat = true } = {}) {
  return once(`tex:${path}:${srgb}:${repeat}`, async () => {
    const t = await textures.loadAsync(BASE + path);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    return t;
  });
}

/** A Poly Haven surface: colour, normal, and packed AO/roughness/metal. */
export function loadSurface(id) {
  return once(`surface:${id}`, async () => {
    const [map, normal, arm] = await Promise.all([loadTexture(`textures/${id}/diff.webp`, { srgb: true }), loadTexture(`textures/${id}/nor.webp`), loadTexture(`textures/${id}/arm.webp`)]);
    return { id, map, normal, arm };
  });
}

export const loadHDR = (path) => once(`hdr:${path}`, () => hdr.loadAsync(BASE + path));

/** Motion-capture clips, parsed once. */
export function loadClips(path = 'anims/male.json') {
  return once(`clips:${path}`, async () => {
    const json = await fetch(BASE + path).then((r) => r.json());
    const clips = {};
    for (const j of json) {
      const clip = THREE.AnimationClip.parse(j);
      // How fast the motion-captured performer was really moving (locomotion), in m/s
      clip.userData = { speed: j.speed || 0 };
      clips[j.name] = clip;
    }
    return clips;
  });
}
