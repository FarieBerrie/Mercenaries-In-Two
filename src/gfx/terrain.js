// The land round the map: a heightfield that stays flat over the play area and rises into
// crested dunes and flat-topped mesas (desert) or foothills and ridged peaks (snow). Its material
// blends photo-scanned surfaces by slope and height on the GPU: sand on the gentle ground and
// layered sandstone on the cliffs; snow settling where it can and bare rock where it can't. All
// sampled triplanar, so steep faces don't stretch.
import * as THREE from 'three/webgpu';
import { abs, clamp, float, Fn, max, mix, mx_fractal_noise_float, normalize, normalWorld, positionWorld, pow, smoothstep, texture, vec3 } from 'three/tsl';
import { createRng } from '../rng.js';

// ------------------------------------------------------------------ noise

/** Smooth value noise in 2D, seeded. */
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const rng = createRng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = Float32Array.from({ length: 256 }, () => rng.next());
  const at = (x, y) => val[perm[(perm[x & 255] + y) & 511]];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = x - xi;
    const ty = y - yi;
    const u = tx * tx * (3 - 2 * tx);
    const v = ty * ty * (3 - 2 * ty);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

function fbm(noise, x, y, octaves = 5) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let t = 0;
  for (let i = 0; i < octaves; i++) {
    s += noise(x * f, y * f) * a;
    t += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / t;
}

/** Sharp-crested noise for mountain ridges. */
function ridged(noise, x, y, octaves = 5) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let t = 0;
  let w = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * f, y * f) * 2 - 1);
    n *= n * w;
    w = Math.min(1, n * 2);
    s += n * a;
    t += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / t;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Height of the land at (x, z): zero over the map, rising away from its edges. */
export function terrainHeight(level) {
  const { x0, x1, z0, z1 } = level.bounds;
  const noise = makeNoise(level.missionIndex * 977 + 13);
  const theme = level.theme;
  return (x, z) => {
    const dx = Math.max(0, x0 + 4 - x, x - x1 - 4);
    const dz = Math.max(0, z0 + 4 - z, z - z1 - 4);
    const d = Math.hypot(dx, dz);
    const near = smooth(0, 30, d);
    if (theme === 'desert') {
      const warp = fbm(noise, x * 0.006, z * 0.006, 3) * 60;
      const crest = 1 - Math.abs(Math.sin((x * 0.8 + z * 0.45 + warp) * 0.03));
      const dunes = crest ** 2.4 * 11 + fbm(noise, x * 0.012, z * 0.012, 4) * 9;
      // Flat-topped mesas out on the horizon
      const m = fbm(noise, x * 0.0045 + 31, z * 0.0045 - 17, 4);
      const mesa = smooth(0.56, 0.6, m) * (38 + fbm(noise, x * 0.02, z * 0.02, 2) * 8) * smooth(110, 190, d);
      return dunes * near + mesa - 0.2;
    }
    // Snow: rolling foothills, then ridged peaks
    const hills = fbm(noise, x * 0.015, z * 0.015, 4) * 10 * near;
    const peaks = ridged(noise, x * 0.0065 + 5, z * 0.0065, 6) ** 1.35 * 190 * smooth(25, 170, d);
    return hills + peaks - 0.2;
  };
}

/** Triplanar sample of a texture at world scale `s` (metres per tile). */
const triplanar = (tex, s) =>
  Fn(() => {
    const n = abs(normalWorld);
    const w = pow(n, vec3(4));
    const ws = w.div(w.x.add(w.y).add(w.z));
    const p = positionWorld.div(s);
    return texture(tex, p.zy).mul(ws.x).add(texture(tex, p.xz).mul(ws.y)).add(texture(tex, p.xy).mul(ws.z));
  })();

/**
 * Terrain material. flat/steep: surfaces for gentle ground and cliffs; scales in metres.
 */
function terrainMaterial(flat, steep, { flatScale = 6, steepScale = 9, cliff = [0.25, 0.5], snowLine = null }) {
  const m = new THREE.MeshStandardNodeMaterial();
  const slope = float(1).sub(normalWorld.y);
  const vary = mx_fractal_noise_float(positionWorld.xz.mul(0.01), 3, 2, 0.5);
  let k = smoothstep(cliff[0], cliff[1], slope.add(vary.mul(0.15)));
  if (snowLine) {
    // Snow stays off steep rock; it thins toward the peaks' cliffs
    k = clamp(k, 0, 1);
  }
  const fa = triplanar(flat.map, flatScale);
  const sa = triplanar(steep.map, steepScale);
  const macro = float(1).add(vary.mul(0.25));
  m.colorNode = mix(fa.rgb, sa.rgb, k).mul(macro);
  const fr = triplanar(flat.arm, flatScale);
  const sr = triplanar(steep.arm, steepScale);
  m.roughnessNode = mix(fr.g, sr.g, k);
  m.metalnessNode = float(0);
  return m;
}

/** The terrain mesh round a level (desert and snow), and its height function. */
export function buildTerrain(level, surfaces) {
  const theme = level.theme;
  const H = terrainHeight(level);
  const b = level.bounds;
  const reach = 360;
  const [x0, x1, z0, z1] = [b.x0 - reach, b.x1 + reach, b.z0 - reach, b.z1 + reach];
  // Finer near the map, where you can see it up close
  const sx = Math.round((x1 - x0) / 5);
  const sz = Math.round((z1 - z0) / 5);
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz).rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
  // Cut away the part under the map (the ground plane is there)
  const idx = geo.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    let inside = 0;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(idx[i + k]);
      const z = p.getZ(idx[i + k]);
      if (x > b.x0 + 2 && x < b.x1 - 2 && z > b.z0 + 2 && z < b.z1 - 2) inside++;
    }
    if (inside < 3) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  geo.setIndex(keep);
  geo.computeVertexNormals();
  const mat =
    theme === 'desert'
      ? terrainMaterial(surfaces.dense_sand, surfaces.sandstone_cracks, { flatScale: 5, steepScale: 14, cliff: [0.22, 0.45] })
      : terrainMaterial(surfaces.snow_02, surfaces.rock_face, { flatScale: 7, steepScale: 16, cliff: [0.3, 0.55], snowLine: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, height: H };
}

