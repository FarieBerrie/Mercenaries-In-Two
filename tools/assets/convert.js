// Runs in headless Chrome (see build.mjs). Converts the cached sources into what the game loads:
//   characters/<avatar>.glb   Rocketbox people: indexed mesh, PBR materials, WebP textures
//   anims/male.json           motion-captured clips, trimmed to the body's bones
//   textures/<id>/{diff,nor,arm}.webp
//   sky/<theme>/{env.hdr,sky.webp}
//   props/<id>.glb            Poly Haven props, decimated to a triangle budget
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.js';

const M = await (await fetch('/manifest.json')).json();
const want = (t) => !M.tasks.length || M.tasks.includes(t);
const log = (...a) => fetch('/log', { method: 'POST', body: a.join(' ') });
const put = (path, data) => fetch(`/out/${path}`, { method: 'PUT', body: data });
let bytes = 0;
const putSized = async (path, data) => {
  const size = data.byteLength ?? data.size;
  bytes += size;
  await put(path, data);
  return `${(size / 1e6).toFixed(2)}MB`;
};

// ------------------------------------------------------------------ images

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Any image source (ImageBitmap, canvas, or a DataTexture's {data,width,height}) as a canvas. */
function toCanvas(image) {
  if (image instanceof HTMLCanvasElement) return image;
  if (image.data) {
    const c = canvasOf(image.width, image.height);
    const ctx = c.getContext('2d');
    const d = new ImageData(image.width, image.height);
    const src = image.data;
    const ch = src.length / (image.width * image.height);
    for (let i = 0, j = 0; i < d.data.length; i += 4, j += ch) {
      d.data[i] = src[j];
      d.data[i + 1] = src[j + 1];
      d.data[i + 2] = src[j + 2];
      d.data[i + 3] = ch === 4 ? src[j + 3] : 255;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }
  const c = canvasOf(image.width, image.height);
  c.getContext('2d').drawImage(image, 0, 0);
  return c;
}

/** Downscales by halves (sharper than one big step) to at most `size` on the longer side. */
function resized(image, size) {
  let c = toCanvas(image);
  const scale = Math.min(1, size / Math.max(c.width, c.height));
  const tw = Math.max(1, Math.round(c.width * scale));
  const th = Math.max(1, Math.round(c.height * scale));
  while (c.width > tw * 2 || c.height > th * 2) {
    const n = canvasOf(Math.max(tw, c.width >> 1), Math.max(th, c.height >> 1));
    const ctx = n.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  if (c.width !== tw || c.height !== th) {
    const n = canvasOf(tw, th);
    const ctx = n.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, tw, th);
    c = n;
  }
  return c;
}

/** A resized copy of a texture, flagged to export as WebP. */
function shrinkTexture(tex, size, colorSpace = tex.colorSpace) {
  const c = resized(tex.image, size);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = colorSpace;
  t.wrapS = tex.wrapS;
  t.wrapT = tex.wrapT;
  t.channel = tex.channel;
  t.userData.mimeType = 'image/webp';
  return t;
}

const blobOf = (canvas, type = 'image/webp', q = 0.86) => new Promise((r) => canvas.toBlob(r, type, q));

async function loadBitmap(url, opts) {
  const blob = await (await fetch(url)).blob();
  return createImageBitmap(blob, opts);
}

// ------------------------------------------------------------------ geometry

/** Drops vertices no triangle uses, and renumbers the rest. */
function compact(geo) {
  const index = geo.index.array;
  const remap = new Int32Array(geo.attributes.position.count).fill(-1);
  let n = 0;
  for (const i of index) if (remap[i] < 0) remap[i] = n++;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const size = attr.itemSize;
    const arr = new attr.array.constructor(n * size);
    for (let v = 0; v < remap.length; v++) {
      if (remap[v] < 0) continue;
      for (let k = 0; k < size; k++) arr[remap[v] * size + k] = attr.array[v * size + k];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size, attr.normalized));
  }
  const idx = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) idx[i] = remap[index[i]];
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  for (const g of geo.groups) out.addGroup(g.start, g.count, g.materialIndex);
  return out;
}

/** Simplifies a mesh's geometry to about `tris` triangles, keeping UV seams and normals sound. */
function simplify(geo, tris) {
  if (!geo.index) geo = mergeVertices(geo, 1e-5);
  const count = geo.index.count / 3;
  if (count <= tris) return { geo, from: count, to: count };
  const pos = geo.attributes.position;
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) positions.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const stride = (nrm ? 3 : 0) + (uv ? 2 : 0);
  const attrs = new Float32Array(Math.max(1, pos.count * stride));
  for (let i = 0; i < pos.count; i++) {
    const o = i * stride;
    if (nrm) attrs.set([nrm.getX(i), nrm.getY(i), nrm.getZ(i)], o);
    if (uv) attrs.set([uv.getX(i), uv.getY(i)], i * stride + (nrm ? 3 : 0));
  }
  const weights = [...(nrm ? [0.5, 0.5, 0.5] : []), ...(uv ? [1, 1] : [])];
  const indices = new Uint32Array(geo.index.array);
  const run = (error, flags) =>
    (stride ? MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, attrs, stride, weights, null, tris * 3, error, flags) : MeshoptSimplifier.simplify(indices, positions, 3, tris * 3, error, flags))[0];
  // Seams can stop a careful pass early; then allow collapsing across them, then anything goes
  let out = run(0.05, []);
  if (out.length / 3 > tris * 1.5) out = run(0.25, ['Permissive']);
  if (out.length / 3 > tris * 1.5) out = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, tris * 3, 0.05)[0];
  const g = geo.clone();
  g.setIndex(new THREE.BufferAttribute(out, 1));
  g.clearGroups();
  return { geo: compact(g), from: count, to: out.length / 3 };
}

async function exportGLB(object, animations = []) {
  const exporter = new GLTFExporter();
  return exporter.parseAsync(object, { binary: true, animations, onlyVisible: true });
}

// ------------------------------------------------------------------ people

/** Reorders triangles so each material is one contiguous group (one draw call per material). */
function byMaterial(geo) {
  if (!geo.groups.length) return geo;
  const index = geo.index.array;
  const mats = [...new Set(geo.groups.map((g) => g.materialIndex))].sort((a, b) => a - b);
  const out = [];
  const groups = [];
  for (const m of mats) {
    const start = out.length;
    for (const g of geo.groups) {
      if (g.materialIndex !== m) continue;
      for (let i = g.start; i < g.start + g.count; i++) out.push(index[i]);
    }
    groups.push([start, out.length - start, m]);
  }
  geo.setIndex(out);
  geo.clearGroups();
  for (const [s, c, m] of groups) geo.addGroup(s, c, m);
  return geo;
}

const managerIdle = (manager) =>
  new Promise((resolve) => {
    if (manager.itemsLoaded >= manager.itemsTotal) return resolve();
    manager.onLoad = resolve;
  });

/** Texture size per material kind: faces stay sharp, the rest is plenty at 1K. */
const AVATAR_TEX = { head: 1024, body: 1024, equipment: 1024, helmet: 512 };

/** Specular (grey) → glTF metal/rough: roughness in green, no metal. */
function roughFromSpecular(spec, size) {
  const c = resized(spec.image, size);
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const s = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / (3 * 255);
    const rough = Math.min(1, Math.max(0.28, 0.94 - Math.sqrt(s) * 0.62));
    d.data[i] = 255;
    d.data[i + 1] = Math.round(rough * 255);
    d.data[i + 2] = 0;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = spec.flipY;
  t.colorSpace = THREE.NoColorSpace;
  t.userData.mimeType = 'image/webp';
  return t;
}

async function buildAvatar(name) {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  const loader = new FBXLoader(manager);
  loader.setResourcePath(`/cache/rocketbox/${name}/Textures/`);
  const fbx = await loader.loadAsync(`/cache/rocketbox/${name}/${name}.fbx`);
  await managerIdle(manager);
  const kinds = [];
  fbx.traverse((o) => {
    if (o.name === 'Bip01_Footsteps') o.visible = false;
    if (!o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      const kind = Object.keys(AVATAR_TEX).find((k) => m.name.toLowerCase().includes(k)) || 'other';
      const size = AVATAR_TEX[kind] || 512;
      kinds.push(`${m.name}:${size}`);
      const std = new THREE.MeshStandardMaterial({ name: m.name, roughness: 1, metalness: 1 });
      if (m.map) std.map = shrinkTexture(m.map, size, THREE.SRGBColorSpace);
      if (m.map && m.alphaMap) {
        // Hair and eyelash cards: their cut-out goes into the colour map's alpha, alpha-tested
        const c = std.map.image;
        const a = resized(m.alphaMap.image, Math.max(c.width, c.height));
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const ad = a.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = ad[i + 1];
        ctx.putImageData(d, 0, 0);
        std.alphaTest = 0.4;
        std.side = THREE.DoubleSide;
        kinds.push(`${m.name}:cutout`);
      }
      if (m.normalMap) std.normalMap = shrinkTexture(m.normalMap, size, THREE.NoColorSpace);
      if (m.specularMap) {
        const rm = roughFromSpecular(m.specularMap, size);
        std.roughnessMap = rm;
        std.metalnessMap = rm;
      } else {
        std.roughness = 0.8;
        std.metalness = 0;
      }
      return std;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    // Index the triangle soup: same look, a fraction of the vertices
    const g = o.geometry;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    const before = g.attributes.position.count;
    o.geometry = byMaterial(mergeVertices(g, 1e-4));
    kinds.push(`verts ${before}→${o.geometry.attributes.position.count}`);
  });
  fbx.scale.setScalar(0.01); // centimetres → metres
  const glb = await exportGLB(fbx);
  const size = await putSized(`characters/${name}.glb`, glb);
  log(`avatar ${name} ${size} [${kinds.join(', ')}]`);
}

/** Bones that move the body; the face rig, fingers (posed round the gun in game) and helpers are left out. */
const BODY_BONE = /^Bip01(_Pelvis|_Spine\d?|_Neck|_Head|_[LR]_(Clavicle|UpperArm|Forearm|Hand|Thigh|Calf|Foot|Toe0))?$/;

/** Sample rate per clip: locomotion keeps its detail, slow idles need far less. Long idles are trimmed. */
const ANIM_RATE = { idle: 15, idleLook: 15, idleNervous: 15, crouchIdle: 15 };
const ANIM_MAX = { idleNervous: 10, idle: 10 };

async function buildAnims() {
  const loader = new FBXLoader();
  const clips = [];
  for (const key of Object.keys(M.ANIMATIONS)) {
    const fbx = await loader.loadAsync(`/cache/rocketbox/anims/${key}.fbx`);
    const src = fbx.animations[0];
    const fps = ANIM_RATE[key] || 30;
    const duration = Math.min(src.duration, ANIM_MAX[key] || Infinity);
    const n = Math.max(2, Math.round(duration * fps) + 1);
    const times = Float32Array.from({ length: n }, (_, i) => Math.round(((i * duration) / (n - 1)) * 1000) / 1000);
    const tracks = [];
    for (const t of src.tracks) {
      const [node, prop] = t.name.split('.');
      if (!BODY_BONE.test(node) || prop === 'scale') continue;
      if (prop === 'position' && node !== 'Bip01' && node !== 'Bip01_Pelvis') continue;
      const digits = prop === 'position' ? 100 : 10000;
      const interp = t.createInterpolant();
      const size = t.getValueSize();
      const values = new Float32Array(n * size);
      for (let i = 0; i < n; i++) {
        const v = interp.evaluate(times[i]);
        for (let k = 0; k < size; k++) values[i * size + k] = Math.round(v[k] * digits) / digits;
      }
      tracks.push(new t.constructor(t.name, times, values));
    }
    // The clips carry the body forward (root motion). The game moves people itself, so take the
    // travel out of the root (keeping its sway and bob) and record it as the gait's speed.
    let speed = 0;
    const root = tracks.find((t) => t.name === 'Bip01.position');
    if (root) {
      const v = root.values;
      const last = (n - 1) * 3;
      const dx = v[last] - v[0];
      const dz = v[last + 2] - v[2];
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        v[i * 3] = Math.round((v[i * 3] - dx * k) * 100) / 100;
        v[i * 3 + 2] = Math.round((v[i * 3 + 2] - dz * k) * 100) / 100;
      }
      speed = Math.hypot(dx, dz) / 100 / duration; // centimetres → metres per second
    }
    const clip = new THREE.AnimationClip(key, duration, tracks);
    clip.optimize();
    const json = THREE.AnimationClip.toJSON(clip);
    json.speed = Math.round(speed * 1000) / 1000;
    clips.push(json);
    log(`anim ${key} ${duration.toFixed(2)}s @${fps} ${tracks.length}/${src.tracks.length} tracks, travels ${json.speed} m/s`);
  }
  const json = JSON.stringify(clips);
  log(`anims/male.json ${await putSized('anims/male.json', new Blob([json]))}`);
}

// ------------------------------------------------------------------ surfaces and skies

async function buildTextures() {
  for (const [id, sizes] of Object.entries(M.TEXTURES)) {
    const parts = [];
    for (const [i, map] of ['diff', 'nor', 'arm'].entries()) {
      const bmp = await loadBitmap(`/cache/polyhaven/textures/${id}/${map}.jpg`);
      const c = resized(bmp, sizes[i]);
      parts.push(`${map} ${c.width} ${await putSized(`textures/${id}/${map}.webp`, await blobOf(c, 'image/webp', map === 'nor' ? 0.9 : 0.85))}`);
    }
    log(`texture ${id}: ${parts.join(', ')}`);
  }
  // Needle and twig cards for the procedural pines; the twigs' cut-out goes in the alpha channel
  for (const part of ['branches', 'twigs']) {
    for (const map of ['diff', 'nor_gl', 'arm']) {
      const bmp = await loadBitmap(`/cache/polyhaven/props/fir_sapling/textures/fir_sapling_${part}_${map}_1k.jpg`);
      const c = resized(bmp, 1024);
      if (part === 'twigs' && map === 'diff') {
        const alpha = resized(await loadBitmap('/cache/polyhaven/props/fir_sapling/textures/fir_sapling_twigs_alpha_1k.jpg'), 1024);
        const ctx = c.getContext('2d');
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const a = alpha.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] = a[i];
        ctx.putImageData(d, 0, 0);
      }
      await putSized(`textures/fir_${part}/${map === 'nor_gl' ? 'nor' : map}.webp`, await blobOf(c, 'image/webp', 0.88));
    }
  }
  log('texture fir cards');
}

async function buildSkies() {
  for (const [theme, id] of Object.entries(M.SKIES)) {
    const hdr = await (await fetch(`/cache/polyhaven/skies/${id}/env.hdr`)).arrayBuffer();
    await putSized(`sky/${theme}/env.hdr`, hdr);
    // The backdrop: the sky from the zenith to a little below the horizon, at 6K across
    const W = 6144;
    const bmp = await loadBitmap(`/cache/polyhaven/skies/${id}/sky.jpg`, { resizeWidth: W, resizeHeight: W / 2, resizeQuality: 'high' });
    const rows = Math.round((W / 2) * (100 / 180)); // +90° down to -10°
    const c = canvasOf(W, rows);
    c.getContext('2d').drawImage(bmp, 0, 0, W, rows, 0, 0, W, rows);
    log(`sky ${theme} (${id}) ${await putSized(`sky/${theme}/sky.webp`, await blobOf(c, 'image/webp', 0.86))}`);
  }
}

// ------------------------------------------------------------------ props

async function buildProps() {
  await MeshoptSimplifier.ready;
  const loader = new GLTFLoader();
  for (const [id, spec] of Object.entries(M.PROPS)) {
    const gltf = await loader.loadAsync(`/cache/polyhaven/props/${id}/${id}.gltf`);
    const root = gltf.scene;
    let from = 0;
    let to = 0;
    const done = new Map();
    const shrink = (t, cs) => {
      if (!t) return t;
      if (!done.has(t)) done.set(t, shrinkTexture(t, spec.tex, cs ?? t.colorSpace));
      return done.get(t);
    };
    const meshes = [];
    root.traverse((o) => o.isMesh && meshes.push(o));
    // Share the budget between meshes by their size
    const total = meshes.reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
    for (const o of meshes) {
      const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      const r = simplify(o.geometry, Math.max(120, Math.round((spec.tris * tris) / total)));
      o.geometry = r.geo;
      from += r.from;
      to += r.to;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.map = shrink(m.map);
        m.normalMap = shrink(m.normalMap);
        const arm = shrink(m.roughnessMap || m.metalnessMap || m.aoMap);
        if (m.roughnessMap) m.roughnessMap = arm;
        if (m.metalnessMap) m.metalnessMap = arm;
        if (m.aoMap) m.aoMap = arm;
        m.alphaMap = shrink(m.alphaMap);
      }
    }
    const glb = await exportGLB(root);
    log(`prop ${id} ${Math.round(from)}→${Math.round(to)} tris ${await putSized(`props/${id}.glb`, glb)}`);
  }
}

// ------------------------------------------------------------------ run

try {
  if (want('avatars')) for (const name of Object.keys(M.AVATARS)) await buildAvatar(name);
  if (want('anims')) await buildAnims();
  if (want('textures')) await buildTextures();
  if (want('skies')) await buildSkies();
  if (want('props')) await buildProps();
  await log(`total ${(bytes / 1e6).toFixed(1)}MB`);
  await fetch('/done', { method: 'POST', body: 'ok' });
} catch (e) {
  await log(`FAILED: ${e?.stack || e}`);
  await fetch('/done', { method: 'POST', body: 'failed' });
}
