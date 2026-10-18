// Trees and grass, the way games of the era did them: cards with cut-out textures. Pine boughs
// are painted needle by needle into a texture (with a matching normal map so they catch the
// light), hung in drooping tiers round a scanned-bark trunk, and drawn instanced so a whole
// forest is a few draw calls. Dry grass for the desert is the same idea with blades.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, float, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, texture, uniform, uv, vec3 } from 'three/tsl';
import { createRng } from '../rng.js';
import { WEATHER } from './materials.js';

// ------------------------------------------------------------------ painted cards

/** A conifer bough: a stem with needles both sides, drooping at the tip. RGBA. */
function boughCanvas(seed = 3) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const rng = createRng(seed);
  // Several sprigs off a main stem, so the card reads as a full bough
  const stem = (x0, y0, x1, y1, len, n, width) => {
    ctx.strokeStyle = '#3a2c1c';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 6, x1, y1);
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 6;
      for (const s of [-1, 1]) {
        const a = (s * (0.9 + rng.next() * 0.5) + (rng.next() - 0.5) * 0.4) * (1 - t * 0.3);
        const l = len * (0.6 + rng.next() * 0.5) * (1 - t * 0.45);
        const g = 40 + rng.next() * 40;
        ctx.strokeStyle = `rgb(${g * 0.55},${g + 20},${g * 0.6})`;
        ctx.lineWidth = 1.3 + rng.next();
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a - 0.6) * l * 0.5, y + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  };
  stem(4, H / 2, W - 10, H / 2 + 30, 34, 260, 4);
  for (let k = 0; k < 9; k++) {
    const t = 0.1 + k * 0.09;
    const x = 4 + (W - 14) * t;
    const s = k % 2 ? -1 : 1;
    stem(x, H / 2 + t * 30, x + 120 * (1 - t * 0.5), H / 2 + s * (60 + rng.next() * 30) + t * 30, 22, 90, 2);
  }
  return c;
}

/** A normal map for a painted card: needles bulge out of it, the rest is flat. */
function normalFromAlpha(src) {
  const W = src.width;
  const H = src.height;
  const s = src.getContext('2d').getImageData(0, 0, W, H).data;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(W, H);
  const h = (x, y) => s[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + 3] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * 2;
      const dy = (h(x, y - 1) - h(x, y + 1)) * 2;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      out.data[i] = ((dx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/** Dry grass: a tuft of thin curved blades. RGBA. */
function grassCanvas(seed = 9) {
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const rng = createRng(seed);
  for (let i = 0; i < 140; i++) {
    const x = W / 2 + (rng.next() - 0.5) * W * 0.5;
    const len = H * (0.45 + rng.next() * 0.5);
    const lean = (rng.next() - 0.5) * 1.2;
    const g = 120 + rng.next() * 80;
    ctx.strokeStyle = `rgb(${g + 30},${g + 10},${g * 0.55})`;
    ctx.lineWidth = 1 + rng.next() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.quadraticCurveTo(x + lean * len * 0.3, H - len * 0.6, x + lean * len * 0.6, H - len);
    ctx.stroke();
  }
  return c;
}

function canvasTexture(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

let cards = null;
function cardTextures() {
  if (!cards) {
    const b = boughCanvas();
    const g = grassCanvas();
    cards = { bough: canvasTexture(b, true), boughN: canvasTexture(normalFromAlpha(b), false), grass: canvasTexture(g, true) };
  }
  return cards;
}

// ------------------------------------------------------------------ materials

/** A cut-out card material; snow settles on the upward faces in the snow theme. */
function cardMaterial(map, normal, { tint = '#ffffff', snow = false } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.45, side: THREE.DoubleSide });
  const tex = texture(map, uv());
  let col = tex.rgb.mul(color(tint)).mul(float(0.8).add(mx_noise_float(positionWorld.mul(0.35)).mul(0.25)));
  if (snow) {
    const k = smoothstep(0.1, 0.6, normalWorld.y.add(mx_noise_float(positionWorld.mul(2)).mul(0.3))).mul(WEATHER.snow);
    col = mix(col, vec3(0.92, 0.95, 1.0), k.mul(0.85));
  }
  m.colorNode = col;
  m.opacityNode = tex.a;
  if (normal) m.normalMap = normal;
  m.roughnessNode = float(0.85);
  m.metalnessNode = float(0);
  return m;
}

// ------------------------------------------------------------------ trees

/** One pine as geometry: trunk and tiers of drooping bough cards. Returns { trunk, needles }. */
function pineGeometry(seed, height = 10) {
  const rng = createRng(seed);
  const trunk = new THREE.CylinderGeometry(0.04, 0.22, height * 0.95, 8, 4);
  trunk.translate(0, (height * 0.95) / 2, 0);
  const cards = [];
  const tiers = 9 + Math.floor(rng.next() * 3);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = height * (0.18 + 0.8 * t);
    const reach = (1 - t) * height * 0.32 + 0.4;
    const n = 6 + Math.floor((1 - t) * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.next() * 0.6 + i;
      const card = new THREE.PlaneGeometry(reach, reach * 0.55);
      card.translate(reach / 2, 0, 0);
      // Droop: tilt down at the tip, a little random roll
      card.rotateX((rng.next() - 0.5) * 0.6);
      card.rotateZ(-0.25 - (1 - t) * 0.2 - rng.next() * 0.15);
      card.rotateY(a);
      card.translate(0, y, 0);
      cards.push(card);
    }
  }
  // A tuft at the very top
  const top = new THREE.PlaneGeometry(0.9, 1.2);
  top.rotateZ(Math.PI / 2);
  top.translate(0, height * 0.98, 0);
  cards.push(top, top.clone().rotateY(Math.PI / 2));
  for (const c of cards) c.deleteAttribute('normal');
  const needles = mergeGeometries(cards);
  // Card normals point up and out, so a tree lights like a cone rather than a pile of planes
  const p = needles.attributes.position;
  const nrm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const l = Math.hypot(x, z) || 1;
    const v = new THREE.Vector3(x / l, 0.7, z / l).normalize();
    nrm.set([v.x, v.y, v.z], i * 3);
  }
  needles.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return { trunk, needles };
}

/**
 * A forest: places pines (instanced, a few shapes) at the given spots.
 * spots: [{ x, y, z, s (scale), r (rotation) }]; bark: Poly Haven bark surface.
 */
let pineParts = null;
const pineMats = new Map();
export function buildPines(spots, { bark, snow = false } = {}) {
  const tx = cardTextures();
  const group = new THREE.Group();
  if (!spots.length) return group;
  // Shapes and materials are shared by every call (forests are built a chunk at a time)
  pineParts ??= [pineGeometry(11, 10), pineGeometry(23, 11), pineGeometry(37, 9)];
  const variants = pineParts;
  const mk = `${snow}|${bark?.map?.uuid}`;
  if (!pineMats.has(mk)) {
    const needleMat = cardMaterial(tx.bough, tx.boughN, { tint: '#8fa88a', snow });
    const trunkMat = new THREE.MeshStandardNodeMaterial();
    if (bark) {
      const t = texture(bark.map, uv().mul(vec3(2, 4, 1).xy));
      trunkMat.colorNode = t.rgb.mul(0.8);
    } else trunkMat.color.set('#3a2a1e');
    trunkMat.roughness = 0.9;
    pineMats.set(mk, { needleMat, trunkMat });
  }
  const { needleMat, trunkMat } = pineMats.get(mk);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const byVariant = variants.map(() => []);
  spots.forEach((s, i) => byVariant[i % variants.length].push(s));
  variants.forEach((v, vi) => {
    const list = byVariant[vi];
    if (!list.length) return;
    const needles = new THREE.InstancedMesh(v.needles, needleMat, list.length);
    const trunk = new THREE.InstancedMesh(v.trunk, trunkMat, list.length);
    list.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r ?? 0), new THREE.Vector3(s.s, s.s * (0.9 + (i % 5) * 0.05), s.s));
      needles.setMatrixAt(i, m);
      trunk.setMatrixAt(i, m);
    });
    for (const im of [needles, trunk]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  });
  return group;
}

/** Dry grass tufts (crossed cards), instanced. spots: [{ x, y, z, s, r }] */
let grassParts = null;
export function buildGrass(spots) {
  const group = new THREE.Group();
  if (!spots.length) return group;
  if (!grassParts) {
    const tx = cardTextures();
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const geo = mergeGeometries([a, a.clone().rotateY(Math.PI / 2), a.clone().rotateY(Math.PI / 4)]);
    const n = geo.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); // lit like the ground they grow from
    grassParts = { geo, mat: cardMaterial(tx.grass, null, { tint: '#d8c8a0' }) };
  }
  const { geo, mat } = grassParts;
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  spots.forEach((s, i) => {
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r ?? 0), new THREE.Vector3(s.s, s.s * 0.8, s.s));
    im.setMatrixAt(i, m);
  });
  im.castShadow = true;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  group.add(im);
  return group;
}

