// The level's static meshes: ground, buildings, cover props, gates, towers, objectives and a
// backdrop beyond the walls. Textured boxes use world-space UVs so textures keep their scale;
// untextured props are merged into vertex-coloured batches. Gates are their own meshes so they
// can vanish when an area is cleared.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from './rng.js';
import { crateTexture, groundTexture, rockTexture, sandbagTexture, wallTexture } from './textures.js';

const color = new THREE.Color();

/** A box with world-space UVs (u, v in metres / tile) on its five visible faces. */
function texturedBox(b, tile = 4, tint = '#ffffff') {
  const { x0, x1, y0, y1, z0, z1 } = b;
  const pos = [];
  const nrm = [];
  const uv = [];
  const quad = (pts, n, uvs) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...pts[i]);
      nrm.push(...n);
      uv.push(...uvs[i]);
    }
  };
  const u = (v) => v / tile;
  quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[u(z1), u(y0)], [u(z0), u(y0)], [u(z0), u(y1)], [u(z1), u(y1)]]);
  quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[u(z0), u(y0)], [u(z1), u(y0)], [u(z1), u(y1)], [u(z0), u(y1)]]);
  quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[u(x0), u(y0)], [u(x1), u(y0)], [u(x1), u(y1)], [u(x0), u(y1)]]);
  quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[u(x1), u(y0)], [u(x0), u(y0)], [u(x0), u(y1)], [u(x1), u(y1)]]);
  quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], [[u(x0), u(z1)], [u(x1), u(z1)], [u(x1), u(z0)], [u(x0), u(z0)]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  color.set(tint);
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => [color.r, color.g, color.b][i % 3]), 3));
  return g;
}

/** Vertex-coloured shapes merged into one mesh. */
class Batch {
  constructor() {
    this.geos = [];
  }

  add(geo, hex, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0 } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    color.set(hex);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) c.set([color.r, color.g, color.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.geos.push(g);
  }

  box(x0, x1, y0, y1, z0, z1, hex, opts = {}) {
    this.add(UNIT, hex, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, sx: x1 - x0, sy: y1 - y0, sz: z1 - z0, ...opts });
  }

  cyl(x, y0, z, h, r, hex, sides = 12) {
    this.add(new THREE.CylinderGeometry(r, r, h, sides), hex, { x, y: y0 + h / 2, z });
  }

  mesh(material) {
    if (!this.geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(this.geos), material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}
const UNIT = new THREE.BoxGeometry(1, 1, 1);

const CAR_COLORS = ['#a83a2a', '#3a5a8a', '#c8b890', '#5a6a3a', '#2a2a2e'];
const CONTAINER_COLORS = ['#a8302a', '#2a5a9a', '#c88a20', '#3a6a3a', '#6a6a70', '#8a3a7a'];

export function buildWorld(level) {
  const group = new THREE.Group();
  const theme = level.theme;
  const rng = createRng(level.missionIndex * 31 + 5);
  const solid = new Batch();
  const glow = new Batch();
  const textured = new Map(); // texture key → geometries
  const addTextured = (key, geo) => {
    if (!textured.has(key)) textured.set(key, []);
    textured.get(key).push(geo);
  };
  const gates = new Map();
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);

  // ---- ground
  const groundTex = groundTexture(theme);
  groundTex.repeat.set((level.length + 200) / 8, (level.halfWidth * 2 + 160) / 8);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(level.length + 200, level.halfWidth * 2 + 160), lambert({ map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(level.length / 2, 0, 0);
  ground.receiveShadow = true;
  group.add(ground);

  for (const b of level.boxes) {
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const lx = b.x1 - b.x0;
    const lz = b.z1 - b.z0;
    if (b.kind === 'edge' || b.kind === 'block') {
      const style = b.style === 'wall' ? { desert: 'house', port: 'container', snow: 'bunker' }[theme] : b.style;
      if (style === 'container') {
        // Stacks of shipping containers, each its own colour
        for (let y = 0; y < b.y1 - 0.1; y += 2.6) {
          const top = Math.min(b.y1, y + 2.6);
          addTextured('container', texturedBox({ ...b, y0: y, y1: top - 0.05 }, 2.6, rng.pick(CONTAINER_COLORS)));
          solid.box(b.x0 - 0.03, b.x1 + 0.03, top - 0.1, top - 0.02, b.z0 - 0.03, b.z1 + 0.03, '#2a2a2e');
        }
      } else {
        addTextured(style, texturedBox(b, 4));
        // Roof parapets, dark windows and doors facing into the play area
        solid.box(b.x0 - 0.1, b.x1 + 0.1, b.y1, b.y1 + 0.35, b.z0 - 0.1, b.z1 + 0.1, style === 'house' ? '#b48a5c' : '#7a7c78');
        const face = Math.abs(b.z0) < Math.abs(b.z1) ? b.z0 : b.z1;
        const out = face === b.z0 ? -1 : 1;
        if (b.kind === 'edge' && lz > lx * 0.2) {
          for (let x = b.x0 + 1.5; x < b.x1 - 1; x += 3.2) {
            for (let y = 2; y < b.y1 - 1; y += 3.4) solid.box(x - 0.5, x + 0.5, y, y + 1.1, face + out * 0.02 - 0.03, face + out * 0.02 + 0.03, '#1a1c22');
          }
        }
        if (style === 'house' && b.kind === 'block') solid.box(cx - 0.5, cx + 0.5, 0, 2, b.z0 - 0.03, b.z0 + 0.03, '#4a2e18');
      }
    } else if (b.kind === 'gate') {
      const geo = texturedBox(b, 4);
      const mesh = new THREE.Mesh(geo, lambert({ map: wallTexture('gate'), vertexColors: true }));
      mesh.castShadow = mesh.receiveShadow = true;
      gates.set(b.id, mesh);
      group.add(mesh);
    } else if (b.kind === 'boostwall') {
      addTextured('bunker', texturedBox(b, 4, '#c8c4bc'));
      for (let z = -8; z <= 8; z += 8) solid.box(b.x0 - 0.12, b.x0, 0.6, b.y1 - 0.4, z - 0.6, z + 0.6, '#5a5650'); // scuffed footholds
    } else if (b.kind === 'tower') {
      // Scaffold: four legs, cross braces, a deck
      for (const [x, z] of [[b.x0 + 0.15, b.z0 + 0.15], [b.x1 - 0.15, b.z0 + 0.15], [b.x0 + 0.15, b.z1 - 0.15], [b.x1 - 0.15, b.z1 - 0.15]]) solid.cyl(x, 0, z, b.y1, 0.12, '#6a5a3a', 6);
      for (let y = 1.5; y < b.y1; y += 2) solid.box(b.x0, b.x1, y, y + 0.1, cz - 0.05, cz + 0.05, '#5a4a2a');
      solid.box(b.x0 - 0.2, b.x1 + 0.2, b.y1 - 0.2, b.y1, b.z0 - 0.2, b.z1 + 0.2, '#7a6a48');
      solid.box(b.x0 - 0.2, b.x1 + 0.2, b.y1, b.y1 + 0.9, b.z0 - 0.2, b.z0 - 0.1, '#7a6a48');
    } else if (b.kind === 'target') {
      if (b.style === 'radar') {
        solid.cyl(cx, 0, cz, 1.2, 1.3, '#7a7e84');
        solid.cyl(cx, 1.2, cz, 1.4, 0.3, '#5a5e64');
        solid.add(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.5), '#d8dce2', { x: cx, y: 3, z: cz, rz: 1.1 });
        glow.box(cx - 0.1, cx + 0.1, 2.9, 3.1, cz - 0.1, cz + 0.1, '#ff3030');
      } else {
        solid.cyl(cx, 0, cz, 0.8, 1.5, '#5a5a4a');
        solid.box(cx - 0.8, cx + 0.8, 0.8, 1.6, cz - 0.6, cz + 0.6, '#6a6a5a');
        for (const dz of [-0.35, 0.35]) solid.add(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), '#2a2a2a', { x: cx + 0.6, y: 2.2, z: cz + dz, rz: -0.9 });
      }
    } else if (b.kind === 'cover') {
      const h = b.y1;
      switch (b.style) {
        case 'crate':
          addTextured('crate', texturedBox(b, 1.2));
          break;
        case 'sandbags':
          addTextured('sandbags', texturedBox(b, 1));
          break;
        case 'barrier':
          // Concrete barrier: wide foot, tapered top
          solid.box(b.x0, b.x1, 0, 0.35, b.z0, b.z1, '#a8a6a0');
          solid.box(b.x0 + (lx < lz ? 0.1 : 0), b.x1 - (lx < lz ? 0.1 : 0), 0.35, h, b.z0 + (lz < lx ? 0.1 : 0), b.z1 - (lz < lx ? 0.1 : 0), '#b8b6b0');
          break;
        case 'car': {
          const c = rng.pick(CAR_COLORS);
          solid.box(b.x0, b.x1, 0.25, 0.85, b.z0, b.z1, c);
          const along = lx > lz;
          const cab = along ? [cx - lx * 0.25, cx + lx * 0.15, b.z0 + 0.1, b.z1 - 0.1] : [b.x0 + 0.1, b.x1 - 0.1, cz - lz * 0.25, cz + lz * 0.15];
          solid.box(cab[0], cab[1], 0.85, h, cab[2], cab[3], '#3a4a5a');
          for (const [wx, wz] of along ? [[b.x0 + 0.8, b.z0], [b.x1 - 0.8, b.z0], [b.x0 + 0.8, b.z1], [b.x1 - 0.8, b.z1]] : [[b.x0, b.z0 + 0.8], [b.x0, b.z1 - 0.8], [b.x1, b.z0 + 0.8], [b.x1, b.z1 - 0.8]]) {
            solid.add(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 12), '#141416', { x: wx, y: 0.33, z: wz, rx: along ? Math.PI / 2 : 0, rz: along ? 0 : Math.PI / 2 });
          }
          break;
        }
        case 'drums':
          for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [0, 0.35]]) solid.cyl(cx + dx, 0, cz + dz, h, 0.32, rng.pick(['#3a5a8a', '#8a3a2a', '#5a6a3a']), 12);
          break;
        case 'pallets':
          for (let y = 0; y < h; y += 0.25) solid.box(b.x0, b.x1, y, y + 0.14, b.z0, b.z1, y % 0.5 ? '#9a7a4a' : '#8a6a3a');
          solid.box(b.x0 + 0.1, b.x1 - 0.1, 0.5, h, b.z0 + 0.1, b.z1 - 0.1, '#c8c0a8'); // wrapped cargo
          break;
        case 'forklift':
          solid.box(b.x0, b.x1, 0.2, 1, b.z0, b.z1, '#d8a020');
          solid.box(b.x0, b.x0 + 0.1, 0, h + 1.2, b.z0 + 0.2, b.z1 - 0.2, '#2a2a2a');
          break;
        case 'rocks':
          solid.add(new THREE.DodecahedronGeometry(1, 1), '#7a7e84', { x: cx, y: h * 0.45, z: cz, sx: lx * 0.6, sy: h * 0.6, sz: lz * 0.6 });
          break;
        default:
          addTextured('crate', texturedBox(b, 1.2));
      }
    }
  }

  // ---- extraction points and the hostage
  for (const a of level.areas) {
    if (a.extract) {
      // A landing pad
      solid.cyl(a.extract.x, 0, a.extract.z, 0.04, 4, '#3a3a3e', 24);
      solid.cyl(a.extract.x, 0.04, a.extract.z, 0.02, 3.6, '#e8c040', 24);
      solid.cyl(a.extract.x, 0.05, a.extract.z, 0.02, 3.3, '#3a3a3e', 24);
    }
  }

  // ---- the backdrop beyond the walls
  const W = level.halfWidth;
  for (const side of [-1, 1]) {
    for (let x = -60; x < level.length + 60; x += rng.range(20, 40)) {
      if (theme === 'snow') {
        const h = rng.range(25, 70);
        solid.add(new THREE.ConeGeometry(1, 1, 7), rng.pick(['#e8eef4', '#d8e0ea']), { x, y: h / 2, z: side * rng.range(W + 30, W + 70), sx: rng.range(20, 40), sy: h, sz: rng.range(20, 40) });
      } else if (theme === 'desert') {
        solid.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#d8b884', { x, y: 0, z: side * rng.range(W + 20, W + 60), sx: rng.range(18, 36), sy: rng.range(4, 12), sz: rng.range(12, 24) });
      } else {
        // Cranes over the water
        const z = side * rng.range(W + 20, W + 40);
        solid.box(x - 0.4, x + 0.4, 0, 30, z - 0.4, z + 0.4, '#c8781a');
        solid.box(x - 0.3, x + 0.3, 30, 31, z - 14, z + 2, '#c8781a');
        glow.box(x - 0.2, x + 0.2, 31.2, 31.6, z - 0.2, z + 0.2, '#ff3030');
      }
    }
  }
  if (theme === 'port') {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(level.length + 400, 300), new THREE.MeshLambertMaterial({ color: '#0c1a2a' }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(level.length / 2, -0.3, 0);
    group.add(water);
    ground.scale.set(1, (W * 2 + 20) / (W * 2 + 160), 1);
  }

  // ---- materials and merge
  const textures = { house: wallTexture('house'), container: wallTexture('container'), bunker: wallTexture('bunker'), crate: crateTexture(), sandbags: sandbagTexture(), rocks: rockTexture() };
  for (const [key, geos] of textured) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), lambert({ map: textures[key], vertexColors: true }));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  const s = solid.mesh(lambert({ vertexColors: true }));
  if (s) group.add(s);
  const gl = glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }));
  if (gl) group.add(gl);
  return { group, gates };
}
