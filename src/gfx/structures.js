// The built and natural mass of a map: houses of the pueblo, tin sheds and warehouses, concrete
// bunkers and barracks, log cabins, container stacks and trailers, tanks, compound walls and
// chain-link fences with their gates, sniper towers, the guns and radars you blow up, rock
// outcrops and cliffs, and the port's gantry cranes. Every box keeps its gameplay size; the art
// is fitted to it. A building only gets a front where it looks onto open ground: walls it shares
// with a neighbour get nothing, and walls onto a courtyard a plainer back.
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxesNear } from '../level.js';
import { Batch } from './batch.js';
import { glowMaterial } from './materials.js';
import { PLASTER, puebloBack, puebloFacade, puebloRoof } from './town.js';

const ROT = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
const BANDS = ['#7a2c1e', '#5a3a2a', '#2c4a5a', '#3a5a3a', '#8a5a2a', '#6a6460'];
const CONTAINER_COLORS = ['#9a2a24', '#24508c', '#c07a1a', '#2e5e36', '#5e6268', '#7a3470', '#1e6a6e', '#8a7a62'];

// ------------------------------------------------------------------ building faces

/**
 * Drawing turned a quarter round: a face looking along x is built as if it looked along z, into
 * its own batch, which is then turned into place. Props and lamps placed meanwhile are turned too.
 */
function turned(ctx) {
  const sub = new Batch();
  return {
    sub,
    ctx: {
      ...ctx,
      B: sub,
      P: { place: (id, x, y, z, o = {}) => ctx.P.place(id, -z, y, x, { ...o, ry: (o.ry || 0) - Math.PI / 2 }) },
      lamps: { push: (l) => ctx.lamps.push({ ...l, x: -l.z, z: l.x }) },
    },
  };
}
const virtual = (b) => ({ ...b, x0: b.z0, x1: b.z1, z0: -b.x1, z1: -b.x0 });

/** fn(ctx, box, faceZ, kind) for each face of b marked in `faces` ({ z0, z1, x0, x1 } → kind). */
function eachFace(ctx, b, faces, fn, minLen = 2.5) {
  if (b.x1 - b.x0 >= minLen) {
    if (faces.z0) fn(ctx, b, b.z0, faces.z0);
    if (faces.z1) fn(ctx, b, b.z1, faces.z1);
  }
  if ((faces.x0 || faces.x1) && b.z1 - b.z0 >= minLen) {
    const t = turned(ctx);
    const vb = virtual(b);
    if (faces.x1) fn(t.ctx, vb, vb.z0, faces.x1);
    if (faces.x0) fn(t.ctx, vb, vb.z1, faces.x0);
    ctx.B.absorb(t.sub, ROT);
  }
}

/**
 * Which faces of a building can be seen, and from where: null against a neighbour, 'back' onto a
 * courtyard, 'front' onto a street, a yard or open ground.
 */
function exposedFaces(level, b) {
  const blocked = (x, z) =>
    boxesNear(level, x, x, z, z).some((o) => o !== b && (o.kind === 'block' || o.kind === 'wall') && o.style !== 'craneleg' && o.y1 > Math.min(2.4, b.y1 - 0.5) && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1);
  const yardAt = (x, z) => level.yards.some((y) => y.kind === 'courtyard' && x > y.x0 && x < y.x1 && z > y.z0 && z < y.z1);
  const look = (pts) => {
    if (pts.filter(([x, z]) => !blocked(x, z)).length < 2) return null;
    return yardAt(...pts[1]) ? 'back' : 'front';
  };
  const along = (a0, a1) => [a0 + (a1 - a0) * 0.2, (a0 + a1) / 2, a0 + (a1 - a0) * 0.8];
  return {
    z0: look(along(b.x0, b.x1).map((x) => [x, b.z0 - 0.7])),
    z1: look(along(b.x0, b.x1).map((x) => [x, b.z1 + 0.7])),
    x0: look(along(b.z0, b.z1).map((z) => [b.x0 - 0.7, z])),
    x1: look(along(b.z0, b.z1).map((z) => [b.x1 + 0.7, z])),
  };
}

/** zs(a, c): the z range from a to c metres out of a face, whichever way it looks. */
const faceZ = (face, out) => {
  const fz = face + out * 0.01;
  return (a, c) => [Math.min(fz + out * a, fz + out * c), Math.max(fz + out * a, fz + out * c)];
};

/** A sloping roof over a box: two slabs to a ridge along its long side, and gable ends. */
function gableRoof(B, b, key, tint, rise, { overhang = 0.35, ends = true, endKey = key, endTint = tint } = {}) {
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
  const span = alongX ? b.z1 - b.z0 : b.x1 - b.x0;
  const len = (alongX ? b.x1 - b.x0 : b.z1 - b.z0) + overhang * 2;
  const run = span / 2 + overhang;
  const slope = Math.atan2(rise, span / 2);
  const w = run / Math.cos(slope);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(alongX ? len : w, 0.09, alongX ? w : len);
    g.applyMatrix4(alongX ? new THREE.Matrix4().makeRotationX(s * slope) : new THREE.Matrix4().makeRotationZ(-s * slope));
    const off = run / 2;
    g.translate(alongX ? cx : cx + s * off, b.y1 + rise / 2 - (overhang * rise) / span, alongX ? cz + s * off : cz);
    B.add(key, g, tint);
  }
  if (!ends) return;
  for (const e of [-1, 1]) {
    const tri = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, rise)]);
    const g = new THREE.ShapeGeometry(tri);
    if (alongX) {
      g.rotateY(e > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.translate(e > 0 ? b.x1 + 0.005 : b.x0 - 0.005, b.y1, cz);
    } else {
      if (e < 0) g.rotateY(Math.PI);
      g.translate(cx, b.y1, e > 0 ? b.z1 + 0.005 : b.z0 - 0.005);
    }
    B.add(endKey, g, endTint);
  }
}

// ------------------------------------------------------------------ the pueblo

function pueblo(ctx, level, b) {
  const { B, rng } = ctx;
  const faces = exposedFaces(level, b);
  let [key, tint] = rng.pick(PLASTER);
  if (b.style === 'church' || b.style === 'belltower') [key, tint] = ['plaster_white', '#f6f0e4'];
  if (b.style === 'ruin') [key, tint] = ['plaster_damaged', '#e4d8c4'];
  const look = { key, tint, band: rng.pick(BANDS) };
  B.box(key, b.x0, b.x1, 0, b.y1, b.z0, b.z1, tint);
  if (b.style === 'ruin') return ruin(ctx, b, faces, look);
  if (b.style === 'belltower') return belltower(ctx, b, faces, look);
  eachFace(ctx, b, faces, (c, vb, face, kind) => (kind === 'front' ? puebloFacade : puebloBack)(c, vb, face, look));
  const zf = [];
  if (faces.z0) zf.push(b.z0);
  if (faces.z1) zf.push(b.z1);
  puebloRoof(ctx, b, look, zf);
  if (faces.x0 || faces.x1) {
    const t = turned(ctx);
    const vb = virtual(b);
    const xf = [];
    if (faces.x1) xf.push(vb.z0);
    if (faces.x0) xf.push(vb.z1);
    puebloRoof(t.ctx, vb, look, xf, { extras: false });
    B.absorb(t.sub, ROT);
  }
  if (b.style === 'church') {
    // A stepped gable over the front, with a cross; the nave under a tiled roof
    gableRoof(B, b, 'roof_tiles', '#ffffff', 2.4, { endKey: key, endTint: tint });
    const front = faces.z1 ? b.z1 : b.z0;
    const out = front === b.z1 ? 1 : -1;
    const cx = (b.x0 + b.x1) / 2;
    const zs = faceZ(front, out);
    B.box(key, cx - 4, cx + 4, b.y1, b.y1 + 2.6, ...zs(-0.4, 0.2), tint);
    B.box(key, cx - 2.2, cx + 2.2, b.y1 + 2.6, b.y1 + 4.4, ...zs(-0.4, 0.2), tint);
    B.box('dark', cx - 0.5, cx + 0.5, b.y1 + 2.9, b.y1 + 4.0, ...zs(0.2, 0.22), '#1a140e');
    B.box('metal', cx - 0.06, cx + 0.06, b.y1 + 4.4, b.y1 + 5.8, ...zs(-0.15, -0.05), '#2a2622');
    B.box('metal', cx - 0.4, cx + 0.4, b.y1 + 5.1, b.y1 + 5.2, ...zs(-0.15, -0.05), '#2a2622');
    // A great round window over the door
    const rose = new THREE.CircleGeometry(1.1, 24);
    if (out < 0) rose.rotateY(Math.PI);
    rose.translate(cx, b.y1 - 2.4, front + out * 0.02);
    B.add('dark', rose, '#1a140e');
  }
}

/** A bell tower: a plain shaft with a door and slit windows, belfry arches, a dome and a cross. */
function belltower(ctx, b, faces, look) {
  const { B } = ctx;
  eachFace(ctx, b, faces, (c, vb, face, kind) => {
    const out = face === vb.z0 ? -1 : 1;
    const zs = faceZ(face, out);
    const cx = (vb.x0 + vb.x1) / 2;
    c.B.box(look.key, vb.x0, vb.x1, 0, 1.05, ...zs(-0.01, 0.03), look.band);
    // String courses between the stages, and a slit window in each
    for (const y of [6.5, 11.5]) c.B.box(look.key, vb.x0 - 0.05, vb.x1 + 0.05, y, y + 0.25, ...zs(-0.01, 0.12), look.tint);
    for (const y of [4.2, 8.8]) c.B.box('dark', cx - 0.18, cx + 0.18, y, y + 1.2, ...zs(0, 0.01), '#120e0a');
    if (kind === 'front') {
      c.B.box('dark', cx - 0.7, cx + 0.7, 0, 2.6, ...zs(0, 0.01), '#140f0a');
      c.B.box('wood', cx - 0.62, cx + 0.62, 0, 2.5, ...zs(0.01, 0.05), '#5a3a22');
    }
  });
  const h = b.y1;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const w = Math.min(b.x1 - b.x0, b.z1 - b.z0);
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const arch = new THREE.Shape();
    const aw = w * 0.32;
    arch.moveTo(-aw, 0);
    arch.lineTo(aw, 0);
    arch.lineTo(aw, 2.2);
    arch.absarc(0, 2.2, aw, 0, Math.PI, false);
    arch.lineTo(-aw, 0);
    const g = new THREE.ShapeGeometry(arch, 12);
    g.rotateY(Math.atan2(nx, nz));
    g.translate(cx + nx * (w / 2 + 0.02), h - 4.6, cz + nz * (w / 2 + 0.02));
    B.add('dark', g, '#1a140e');
  }
  B.cyl('metal', cx, h - 3.6, cz, 1.0, 0.5, '#7a5a2a', { sides: 14, rTop: 0.25 });
  B.box('plaster_white', b.x0 - 0.2, b.x1 + 0.2, h - 0.1, h + 0.35, b.z0 - 0.2, b.z1 + 0.2, '#f6f0e4');
  const dome = new THREE.SphereGeometry(w * 0.42, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(cx, h + 0.35, cz);
  B.add('roof_tiles', dome, '#e8b090');
  B.cyl('plaster_white', cx, h + 0.35 + w * 0.4, cz, 1.0, 0.35, '#f6f0e4', { sides: 10 });
  B.box('metal', cx - 0.06, cx + 0.06, h + 1.3 + w * 0.4, h + 3.0 + w * 0.4, cz - 0.06, cz + 0.06, '#2a2622');
  B.box('metal', cx - 0.45, cx + 0.45, h + 2.3 + w * 0.4, h + 2.42 + w * 0.4, cz - 0.06, cz + 0.06, '#2a2622');
}

/** A shell left standing: gaping windows, a broken top, rubble at its foot. */
function ruin(ctx, b, faces, look) {
  const { B, rng } = ctx;
  eachFace(ctx, b, faces, (c, vb, face) => {
    const out = face === vb.z0 ? -1 : 1;
    const zs = faceZ(face, out);
    for (let x = vb.x0 + 1.5; x < vb.x1 - 1; x += rng.range(2.4, 3.4)) {
      if (rng.chance(0.3)) continue;
      const y = rng.chance(0.5) ? 0.9 : 0;
      c.B.box('dark', x - 0.5, x + 0.5, y, y + (y ? 1.3 : 2.1), ...zs(0, 0.01), '#0e0b08');
    }
  });
  // Jagged stumps of the floor above
  for (let x = b.x0; x < b.x1 - 0.5; x += rng.range(1, 2.2)) {
    for (const z of [b.z0, b.z1 - 0.35]) if (rng.chance(0.6)) B.box(look.key, x, x + rng.range(0.6, 1.6), b.y1, b.y1 + rng.range(0.3, 1.6), z, z + 0.35, look.tint);
  }
  for (let i = 0; i < 6; i++) {
    const lump = new THREE.SphereGeometry(rng.range(0.4, 0.9), 7, 5);
    lump.scale(1.3, 0.45, 1);
    const side = rng.pick(['x0', 'x1', 'z0', 'z1']);
    const x = side === 'x0' ? b.x0 - 0.6 : side === 'x1' ? b.x1 + 0.6 : rng.range(b.x0, b.x1);
    const z = side === 'z0' ? b.z0 - 0.6 : side === 'z1' ? b.z1 + 0.6 : rng.range(b.z0, b.z1);
    lump.translate(x, 0, z);
    B.add(look.key, lump, '#c8b8a0');
  }
}

// ------------------------------------------------------------------ sheds and warehouses

/** Corrugated tin over a steel frame: big roller doors, a strip of high windows, a pitched roof. */
function tinBuilding(ctx, level, b) {
  const { B, rng, theme, lamps, lit } = ctx;
  const faces = exposedFaces(level, b);
  const tint = theme === 'port' ? rng.pick(['#8a9aa8', '#a89a80', '#7a8a7a', '#b0a898', '#9a7a6a', '#8a8a92']) : theme === 'snow' ? rng.pick(['#7a8a7a', '#9a9a92']) : rng.pick(['#c8b8a0', '#b0a898', '#c0a888']);
  B.box('tin', b.x0, b.x1, 0, b.y1, b.z0, b.z1, tint);
  B.box('concrete', b.x0 - 0.06, b.x1 + 0.06, 0, 0.45, b.z0 - 0.06, b.z1 + 0.06, '#a8a49c');
  const big = b.style !== 'shed';
  eachFace(ctx, b, faces, (c, vb, face, kind) => {
    const out = face === vb.z0 ? -1 : 1;
    const zs = faceZ(face, out);
    const L = vb.x1 - vb.x0;
    const h = vb.y1;
    const doors = big && kind === 'front' ? Math.max(1, Math.round(L / 16)) : 0;
    for (let i = 0; i < doors; i++) {
      const cx = vb.x0 + (L / doors) * (i + 0.5);
      const w = Math.min(7, L / doors - 3);
      const dh = Math.min(h - 1.4, vb.style === 'hangar' ? h - 1.2 : 5.2);
      c.B.box('dark', cx - w / 2, cx + w / 2, 0, dh, ...zs(0, 0.01), '#0a0a0a');
      c.B.box('shutter', cx - w / 2, cx + w / 2, rng.chance(0.3) ? rng.range(1.2, dh * 0.7) : 0, dh, ...zs(0.01, 0.06), '#c0c0b8');
      for (const s of [-1, 1]) c.B.box('metal', cx + s * (w / 2 + 0.1) - 0.1, cx + s * (w / 2 + 0.1) + 0.1, 0, dh + 0.2, ...zs(0, 0.16), '#4a4e54');
      c.B.box('metal', cx - w / 2 - 0.2, cx + w / 2 + 0.2, dh, dh + 0.3, ...zs(0, 0.2), '#4a4e54');
      c.B.box('glow', cx - 0.25, cx + 0.25, dh + 0.5, dh + 0.62, ...zs(0.1, 0.35), '#ffe0b0');
      if (lit) c.lamps.push({ x: cx, y: dh + 0.4, z: face + out * 1.2, color: 0xffe0b0, k: 10, d: 14 });
      // A bay number stencilled beside the door
      c.B.box('paint', cx + w / 2 + 0.5, cx + w / 2 + 1.3, 2.4, 3.4, ...zs(0.005, 0.01), rng.pick(['#e0c040', '#e8e8e0']));
    }
    if (kind === 'front' && L > 4) {
      // A steel door with a light over it
      const dx = doors ? vb.x0 + 1.4 : vb.x0 + L * rng.range(0.3, 0.7);
      c.B.box('dark', dx - 0.55, dx + 0.55, 0, 2.2, ...zs(0, 0.01), '#0a0a0a');
      c.B.box('shutter', dx - 0.5, dx + 0.5, 0, 2.15, ...zs(0.01, 0.05), '#6a7078');
      c.B.box('glow', dx - 0.15, dx + 0.15, 2.45, 2.55, ...zs(0.1, 0.25), '#ffe8c0');
    }
    // High windows in a strip, some lit at night
    for (let x = vb.x0 + 2; x < vb.x1 - 1.5; x += 4) {
      if (rng.chance(0.3)) continue;
      const y = h - 1.9;
      const on = lit && rng.chance(0.3);
      c.B.box(on ? 'glow' : 'glass', x - 0.9, x + 0.9, y, y + 0.8, ...zs(0, 0.02), on ? '#ffd8a0' : '#2a3036');
      c.B.box('metal', x - 1, x + 1, y - 0.08, y, ...zs(0, 0.1), '#4a4e54');
    }
    for (let x = vb.x0 + rng.range(0.4, 2); x < vb.x1; x += rng.range(8, 14)) c.B.cyl('metal', x, 0.4, face + out * 0.1, h - 0.4, 0.06, '#5a5e64', { sides: 8 });
  });
  gableRoof(B, b, 'tin', new THREE.Color(tint).multiplyScalar(0.8), Math.min(3, (Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2) * 0.22), { endKey: 'tin', endTint: tint });
  snowCap(ctx, b.x0 - 0.3, b.x1 + 0.3, b.y1 + 0.1, b.z0 - 0.3, b.z1 + 0.3);
}

// ------------------------------------------------------------------ concrete

/** Concrete buildings: barracks, bunkers, huts and offices, with windows, a door and roof junk. */
function concreteBuilding(ctx, level, b) {
  const { B, rng, theme } = ctx;
  const faces = exposedFaces(level, b);
  const key = theme === 'snow' ? 'wall' : 'concrete';
  const tint = b.style === 'office' ? rng.pick(['#d8d4cc', '#c8ccd0', '#e0d8c8']) : b.style === 'hut' ? '#a8b0a0' : '#ffffff';
  B.box(key, b.x0, b.x1, 0, b.y1, b.z0, b.z1, tint);
  eachFace(ctx, b, faces, (c, vb, face, kind) => concreteFace(c, vb, face, kind));
  // Parapet and what's left on the roof
  B.box(key, b.x0 - 0.08, b.x1 + 0.08, b.y1 - 0.02, b.y1 + 0.4, b.z0 - 0.08, b.z0 + 0.2, tint);
  B.box(key, b.x0 - 0.08, b.x1 + 0.08, b.y1 - 0.02, b.y1 + 0.4, b.z1 - 0.2, b.z1 + 0.08, tint);
  B.box(key, b.x0 - 0.08, b.x0 + 0.2, b.y1 - 0.02, b.y1 + 0.4, b.z0, b.z1, tint);
  B.box(key, b.x1 - 0.2, b.x1 + 0.08, b.y1 - 0.02, b.y1 + 0.4, b.z0, b.z1, tint);
  snowCap(ctx, b.x0, b.x1, b.y1, b.z0, b.z1);
  if (ctx.detail < 0.6) return;
  const cx = rng.range(b.x0 + 1.2, b.x1 - 1.2);
  const cz = (b.z0 + b.z1) / 2;
  if (rng.chance(0.5)) ctx.P.place('barrel_03', cx, b.y1, cz, { s: 1.4, ry: rng.range(0, 6) });
  if (rng.chance(0.6)) B.cyl('metal', rng.range(b.x0 + 0.5, b.x1 - 0.5), b.y1, cz + 0.6, rng.range(2, 5), 0.03, '#3a3a3a', { sides: 5 });
  if (b.style === 'bunker' || b.style === 'barracks') {
    // A sandbag ring on the roof
    for (let x = b.x0 + 0.4; x < b.x1 - 0.4; x += 0.62) {
      for (const z of [b.z0 + 0.45, b.z1 - 0.45]) {
        const bag = new THREE.SphereGeometry(0.5, 8, 5);
        bag.scale(0.62, 0.3, 0.42);
        bag.translate(x, b.y1 + 0.55, z);
        B.add('sack', bag, '#f0e6cc');
      }
    }
  }
}

function concreteFace(ctx, b, face, kind) {
  const { B, rng, lamps, lit, P } = ctx;
  const out = face === b.z0 ? -1 : 1;
  const zs = faceZ(face, out);
  const h = b.y1;
  const L = b.x1 - b.x0;
  const office = b.style === 'office';
  const bunker = b.style === 'bunker';
  B.box('concrete', b.x0, b.x1, 0, 0.5, ...zs(-0.01, 0.07), '#a0a09c');
  // Windows: slits in a bunker, rows elsewhere
  for (let x = b.x0 + 1.6; x < b.x1 - 1.1; x += office ? 2.6 : 3.3) {
    for (let y = bunker ? 1.5 : 1.6; y < h - (bunker ? 0.8 : 1.2); y += 3.1) {
      if (rng.chance(kind === 'back' ? 0.5 : 0.15)) continue;
      const w = bunker ? 1.3 : office ? 1.8 : 1.1;
      const hh = bunker ? 0.35 : office ? 1.5 : 1.25;
      const on = lit && rng.chance(office ? 0.5 : 0.3);
      B.box('dark', x - w / 2, x + w / 2, y, y + hh, ...zs(-0.02, 0), '#0a0b0c');
      B.box(on ? 'glow' : 'glass', x - w / 2 + 0.05, x + w / 2 - 0.05, y + 0.05, y + hh - 0.05, ...zs(-0.015, -0.005), on ? '#ffd8a0' : '#1c2228');
      if (on) lamps.push({ x, y: y + 0.6, z: face - out * 1.2, color: 0xffb060, k: 3, d: 6, cheap: true });
      B.box('concrete', x - w / 2 - 0.12, x + w / 2 + 0.12, y - 0.14, y - 0.02, ...zs(0, 0.18), '#b8b8b4');
      if (!bunker) B.box('metal', x - w / 2 - 0.05, x + w / 2 + 0.05, y + hh, y + hh + 0.1, ...zs(0, 0.08), '#5a5e62');
    }
  }
  if (kind !== 'front') return;
  // A door, a lamp over it, a hazard band on the military ones
  const dx = b.x0 + L * rng.range(0.25, 0.75);
  B.box('shutter', dx - 0.75, dx + 0.75, 0, 2.3, ...zs(-0.12, -0.02), '#8a9098');
  B.box('concrete', dx - 0.9, dx + 0.9, 2.3, 2.46, ...zs(0, 0.14), '#a8a8a4');
  if (b.style !== 'office') for (let x = dx - 0.9; x < dx + 0.9; x += 0.36) B.box('paint', x, x + 0.18, 2.46, 2.62, ...zs(0, 0.05), '#e0a820');
  B.box('glow', dx - 0.14, dx + 0.14, 2.76, 2.9, ...zs(0.06, 0.2), '#ffd8a0');
  lamps.push({ x: dx, y: 2.8, z: face + out * 0.6, color: 0xffd8a0, k: 4, d: 8, cheap: true });
  if (ctx.detail >= 0.6 && L > 5 && rng.chance(0.6)) {
    const x = rng.chance(0.5) ? b.x0 + 1.2 : b.x1 - 1.2;
    if (Math.abs(x - dx) > 1.6) P.place('exterior_aircon_unit', x, rng.chance(0.5) ? 0.5 : 2.6, face + out * 0.24, { ry: out > 0 ? 0 : Math.PI, s: 0.62 });
  }
}

// ------------------------------------------------------------------ cabins

function cabin(ctx, level, b) {
  const { B, rng } = ctx;
  const faces = exposedFaces(level, b);
  B.box('wood', b.x0, b.x1, 0, b.y1, b.z0, b.z1, '#9a7a5a');
  // Log ends at the corners
  for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) B.cyl('wood', x, 0, z, b.y1, 0.16, '#7a5a3a', { sides: 7 });
  eachFace(ctx, b, faces, (c, vb, face, kind) => {
    const out = face === vb.z0 ? -1 : 1;
    const zs = faceZ(face, out);
    const L = vb.x1 - vb.x0;
    for (let x = vb.x0 + 1.4; x < vb.x1 - 1; x += 2.8) {
      if (rng.chance(0.3)) continue;
      const on = c.lit && rng.chance(0.4);
      c.B.box(on ? 'glow' : 'glass', x - 0.45, x + 0.45, 1.2, 2.1, ...zs(-0.02, 0), on ? '#ffc880' : '#20262a');
      c.B.box('wood', x - 0.55, x + 0.55, 1.1, 2.2, ...zs(0, 0.06), '#5a3e28');
    }
    if (kind === 'front') {
      const dx = vb.x0 + L * 0.5;
      c.B.box('wood', dx - 0.5, dx + 0.5, 0, 2.05, ...zs(0.01, 0.06), '#4a3220');
    }
  });
  gableRoof(B, b, 'tin', '#6a5a4a', 1.6, { endKey: 'wood', endTint: '#8a6a4a' });
  snowCap(ctx, b.x0 - 0.35, b.x1 + 0.35, b.y1 + 0.7, b.z0 - 0.35, b.z1 + 0.35);
  B.box('concrete', b.x1 - 1.2, b.x1 - 0.5, b.y1 - 0.5, b.y1 + 1.8, b.z0 + 0.6, b.z0 + 1.3, '#8a8a84'); // chimney
}

// ------------------------------------------------------------------ containers, trailers, tanks

/** A stack of shipping containers filling a box. */
function containers(ctx, b) {
  const { B, rng } = ctx;
  for (let y = 0; y < b.y1 - 0.1; y += 2.6) {
    const top = Math.min(b.y1, y + 2.6);
    const inset = rng.range(-0.12, 0.12);
    const x0 = b.x0 + Math.max(0, inset);
    const x1 = b.x1 + Math.min(0, inset);
    B.box('container', x0, x1, y, top - 0.04, b.z0, b.z1, rng.pick(CONTAINER_COLORS));
    for (const [px, pz] of [[x0, b.z0], [x1, b.z0], [x0, b.z1], [x1, b.z1]]) B.box('metal', px - 0.12, px + 0.12, top - 0.24, top - 0.02, pz - 0.12, pz + 0.12, '#3a3a3c');
    // Door ends: locking bars
    for (const ex of [x0, x1]) {
      const out = ex === x0 ? -1 : 1;
      for (let z = b.z0 + 0.5; z < b.z1 - 0.3; z += 0.6) B.box('metal', ex + out * 0.01, ex + out * 0.06, y + 0.2, top - 0.25, z, z + 0.05, '#5a5a5c');
    }
    snowCap(ctx, x0, x1, top, b.z0, b.z1);
  }
}

/** A semi-trailer: a container box on a chassis, wheels at the back, legs at the front. */
function trailer(ctx, b) {
  const { B, rng } = ctx;
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
  B.box('container', b.x0, b.x1, 1.25, b.y1, b.z0, b.z1, rng.pick(CONTAINER_COLORS));
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
  const wid = alongX ? b.z1 - b.z0 : b.x1 - b.x0;
  const at = (t, s) => (alongX ? [cx + t, cz + s] : [cx + s, cz + t]);
  B.box('metal', ...(alongX ? [b.x0 + 0.2, b.x1 - 0.2, 0.95, 1.25, cz - 0.5, cz + 0.5] : [cx - 0.5, cx + 0.5, 0.95, 1.25, b.z0 + 0.2, b.z1 - 0.2]), '#2a2a2c');
  const back = rng.chance(0.5) ? 1 : -1;
  for (const t of [len / 2 - 1.2, len / 2 - 2.6]) {
    for (const s of [-wid / 2 + 0.3, wid / 2 - 0.3]) {
      const [x, z] = at(back * t, s);
      B.cyl('rubber', x, 0.5, z, 0.32, 0.5, '#151515', alongX ? { rx: Math.PI / 2, sides: 14 } : { rz: Math.PI / 2, sides: 14 });
    }
  }
  for (const s of [-wid / 2 + 0.4, wid / 2 - 0.4]) {
    const [x, z] = at(-back * (len / 2 - 2.2), s);
    B.box('metal', x - 0.08, x + 0.08, 0, 1.0, z - 0.08, z + 0.08, '#3a3a3a');
  }
  snowCap(ctx, b.x0, b.x1, b.y1, b.z0, b.z1);
}

function tank(ctx, b) {
  const { B } = ctx;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const r = Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2;
  B.cyl('paint', cx, 0, cz, b.y1, r, ctx.theme === 'port' ? '#c8c8c0' : '#9aa08a', { sides: 28 });
  B.cyl('metal', cx, b.y1, cz, 0.25, r * 0.98, '#8a8a84', { sides: 28, rTop: r * 0.6 });
  // A ladder up the side and a rail round the top
  B.box('metal', cx + r - 0.05, cx + r + 0.05, 0, b.y1 + 1, cz - 0.3, cz - 0.25, '#4a4a4a');
  B.box('metal', cx + r - 0.05, cx + r + 0.05, 0, b.y1 + 1, cz + 0.25, cz + 0.3, '#4a4a4a');
  for (let y = 0.3; y < b.y1; y += 0.35) B.box('metal', cx + r, cx + r + 0.05, y, y + 0.03, cz - 0.3, cz + 0.3, '#4a4a4a');
  B.box('paint', cx - r * 0.98, cx + r * 0.98, b.y1 * 0.5, b.y1 * 0.5 + 0.4, cz - 0.02, cz + 0.02, '#c03020');
  snowCap(ctx, cx - r * 0.7, cx + r * 0.7, b.y1 + 0.2, cz - r * 0.7, cz + r * 0.7);
}

// ------------------------------------------------------------------ walls, fences, gates

/** A compound wall: rendered plaster or concrete, a coping, piers, razor wire along the top. */
function compoundWall(ctx, b) {
  const { B, theme } = ctx;
  const [key, tint] = theme === 'desert' ? ['plaster_damaged', '#e0d0b8'] : ['concrete', '#d8d4cc'];
  B.box(key, b.x0, b.x1, 0, b.y1, b.z0, b.z1, tint);
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
  B.box(key, b.x0 - (alongX ? 0 : 0.12), b.x1 + (alongX ? 0 : 0.12), b.y1, b.y1 + 0.16, b.z0 - (alongX ? 0.12 : 0), b.z1 + (alongX ? 0.12 : 0), tint);
  const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
  for (let t = 0; t <= len; t += 4) {
    const p = (alongX ? b.x0 : b.z0) + t;
    if (alongX) B.box(key, p - 0.3, p + 0.3, 0, b.y1 + 0.1, b.z0 - 0.15, b.z1 + 0.15, tint);
    else B.box(key, b.x0 - 0.15, b.x1 + 0.15, 0, b.y1 + 0.1, p - 0.3, p + 0.3, tint);
  }
  razorWire(ctx, b, alongX);
  snowCap(ctx, b.x0, b.x1, b.y1 + 0.16, b.z0, b.z1);
}

/** Coils of razor wire along the top of a wall or fence. */
function razorWire(ctx, b, alongX, y = b.y1 + 0.3) {
  const { B } = ctx;
  const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
  const c = alongX ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2;
  for (let t = 0.2; t < len; t += 0.45) {
    const coil = new THREE.TorusGeometry(0.24, 0.01, 4, 12);
    coil.applyMatrix4(new THREE.Matrix4().makeRotationY((alongX ? 0 : Math.PI / 2) + 0.3));
    const p = (alongX ? b.x0 : b.z0) + t;
    coil.translate(alongX ? p : c, y, alongX ? c : p);
    B.add('metal', coil, '#9a9a9a');
  }
}

/** Chain-link on steel posts, a top rail, razor wire over it. */
function fence(ctx, b) {
  const { B } = ctx;
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
  const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
  const c = alongX ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2;
  const h = b.y1 - 0.4;
  for (let t = 0; t <= len + 0.01; t += 3) {
    const p = (alongX ? b.x0 : b.z0) + Math.min(t, len);
    B.cyl('metal', alongX ? p : c, 0, alongX ? c : p, h + 0.5, 0.045, '#6a6e72', { sides: 8 });
  }
  for (const y of [0.15, h]) {
    if (alongX) B.box('metal', b.x0, b.x1, y - 0.025, y + 0.025, c - 0.025, c + 0.025, '#6a6e72');
    else B.box('metal', c - 0.025, c + 0.025, y - 0.025, y + 0.025, b.z0, b.z1, '#6a6e72');
  }
  const mesh = new THREE.PlaneGeometry(len, h - 0.1);
  const uvs = mesh.attributes.uv;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * (len / 1.2), uvs.getY(i) * ((h - 0.1) / 1.2));
  if (!alongX) mesh.rotateY(Math.PI / 2);
  mesh.translate(alongX ? (b.x0 + b.x1) / 2 : c, 0.1 + (h - 0.1) / 2, alongX ? c : (b.z0 + b.z1) / 2);
  B.add('fence', mesh, '#ffffff');
  razorWire(ctx, b, alongX, h + 0.35);
}

/** The step-up wall: concrete, scuffed footholds on both faces, razor wire. */
function boostWall(ctx, b) {
  const { B } = ctx;
  B.box('concrete', b.x0, b.x1, 0, b.y1, b.z0, b.z1, '#d8d4cc');
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
  const len = alongX ? b.x1 - b.x0 : b.z1 - b.z0;
  for (let t = 2; t < len - 1; t += 4) {
    const p = (alongX ? b.x0 : b.z0) + t;
    if (alongX) for (const z of [b.z0 - 0.14, b.z1]) B.box('concrete', p - 0.6, p + 0.6, 0.6, b.y1 - 0.4, z, z + 0.14, '#a8a49c');
    else for (const x of [b.x0 - 0.14, b.x1]) B.box('concrete', x, x + 0.14, 0.6, b.y1 - 0.4, p - 0.6, p + 0.6, '#a8a49c');
  }
  razorWire(ctx, b, alongX, b.y1 + 0.24);
  snowCap(ctx, b.x0, b.x1, b.y1, b.z0, b.z1);
}

/** A steel gate with red lights either side: its own group, so it can sink away when it opens. */
function gate(ctx, b, M, blinkers) {
  const alongX = b.x1 - b.x0 >= b.z1 - b.z0;
  const g = new Batch();
  g.box('shutter', b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, '#c8c0b0');
  for (let y = 0.6; y < b.y1; y += 1.4) {
    if (alongX) for (const z of [b.z0 - 0.06, b.z1]) g.box('metal', b.x0, b.x1, y, y + 0.12, z, z + 0.06, '#4a4a4c');
    else for (const x of [b.x0 - 0.06, b.x1]) g.box('metal', x, x + 0.06, y, y + 0.12, b.z0, b.z1, '#4a4a4c');
  }
  const lights = new Batch();
  const ends = alongX ? [[b.x0 - 0.45, (b.z0 + b.z1) / 2], [b.x1 + 0.45, (b.z0 + b.z1) / 2]] : [[(b.x0 + b.x1) / 2, b.z0 - 0.45], [(b.x0 + b.x1) / 2, b.z1 + 0.45]];
  for (const [x, z] of ends) lights.box('glow', x - 0.16, x + 0.16, b.y1 - 0.45, b.y1 - 0.12, z - 0.16, z + 0.16, '#ff3020');
  const group = new THREE.Group();
  for (const m of g.meshes(M, { chunked: false })) group.add(m);
  for (const m of lights.meshes(M, { shadows: false, chunked: false })) {
    group.add(m);
    blinkers.push({ mesh: m, rate: 0.12 });
  }
  return group;
}

// ------------------------------------------------------------------ rocks

/** Smooth-ish noise on the unit sphere from a handful of seeded waves. */
function lumpy(rng) {
  const waves = Array.from({ length: 7 }, () => {
    const d = new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).normalize();
    return { d, f: rng.range(1.5, 4.5), p: rng.range(0, 6.28), a: rng.range(0.05, 0.16) };
  });
  return (v) => waves.reduce((s, w) => s + Math.sin(v.dot(w.d) * w.f + w.p) * w.a, 0);
}

/** A boulder or a run of cliff filling a box: a knobbly lump, sunk a little into the ground. */
function rock(ctx, b) {
  const { B, rng } = ctx;
  const cliff = b.style === 'cliff';
  let g = new THREE.IcosahedronGeometry(1, cliff ? 3 : 2);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const n = lumpy(rng);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const [hx, hz] = [(b.x1 - b.x0) / 2, (b.z1 - b.z0) / 2];
  const h = b.y1;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n(v) * (cliff ? 1.6 : 1.0);
    // Squarer at the sides for cliffs, so a run of them reads as one face of rock
    const sq = cliff ? 0.5 : 0.15;
    const x = Math.sign(v.x) * Math.abs(v.x) ** (1 - sq);
    const z = Math.sign(v.z) * Math.abs(v.z) ** (1 - sq);
    // A dome rather than a ball: the bottom half is squashed into the ground
    const y = v.y > 0 ? v.y * h * 1.05 * k : v.y * 0.4;
    p.setXYZ(i, (b.x0 + b.x1) / 2 + x * hx * 1.1 * k, Math.max(-0.4, y), (b.z0 + b.z1) / 2 + z * hz * 1.1 * k);
  }
  g.computeVertexNormals();
  B.add('rock', g, ctx.theme === 'snow' ? '#c8ccd0' : '#b8aa98');
}

// ------------------------------------------------------------------ the port's cranes

function crane(ctx, c) {
  const { B, back, lamps, rng } = ctx;
  const col = rng.pick(['#c8781a', '#b84a1a', '#d8a020', '#2a5a8a']);
  const [z0, z1] = [c.z0, c.z1];
  // Cross-braced legs (their feet are the level's boxes), and the portal beams across the top
  for (const dx of [-6, 6]) {
    B.box('paint', c.x + dx - 0.6, c.x + dx + 0.6, 0, 28, z0 - 0.6, z0 + 0.6, col);
    B.box('paint', c.x + dx - 0.6, c.x + dx + 0.6, 0, 28, z1 - 0.6, z1 + 0.6, col);
    B.box('paint', c.x + dx - 0.5, c.x + dx + 0.5, 26, 28, z0, z1, col);
    const len = Math.hypot(z1 - z0, 14);
    B.box('metal', c.x + dx - 0.15, c.x + dx + 0.15, 15 - len / 2, 15 + len / 2, (z0 + z1) / 2 - 0.15, (z0 + z1) / 2 + 0.15, '#4a4a4a', { rx: Math.atan2(z1 - z0, 14) });
  }
  for (const z of [z0, z1]) B.box('paint', c.x - 6.6, c.x + 6.6, 26, 28, z - 0.6, z + 0.6, col);
  // Machinery house on top, the boom out over the water, the driver's cab under it
  B.box('paint', c.x - 4, c.x + 4, 28, 31, z0 + 4, z0 + 12, '#d8d8d0');
  back.box('paint', c.x - 1.4, c.x + 1.4, 30, 32.4, z0 - 14, z1 + 46, col);
  for (let z = z0 - 14; z < z1 + 46; z += 4) back.box('metal', c.x - 1.4, c.x + 1.4, 29.6, 30, z, z + 0.3, '#3a3a3a');
  back.box('paint', c.x - 1.6, c.x + 1.6, 27, 29.4, z1 + 4, z1 + 7, '#e8e8e0');
  back.box('glow', c.x - 1.4, c.x + 1.4, 28, 28.8, z1 + 7.01, z1 + 7.05, '#ffd8a0');
  back.box('glow', c.x - 0.3, c.x + 0.3, 32.6, 33.2, z1 + 45, z1 + 45.6, '#ff2020');
  lamps.push({ x: c.x, y: 25, z: (z0 + z1) / 2, color: 0xffe0b0, k: 60, d: 40, far: true });
  // Spreader and cables hanging from the trolley
  const tz = rng.range(z1 + 6, z1 + 30);
  back.box('paint', c.x - 1.2, c.x + 1.2, 18, 18.6, tz - 6, tz + 6, '#d8a020');
  for (const dz of [-1.2, 1.2]) back.box('metal', c.x - 0.03, c.x + 0.03, 18.6, 30, tz + dz - 0.03, tz + dz + 0.03, '#2a2a2a');
}

// ------------------------------------------------------------------ towers and targets

function tower(ctx, b) {
  const { B } = ctx;
  const lx = b.x1 - b.x0;
  const cx = (b.x0 + b.x1) / 2;
  const legs = [[b.x0 + 0.15, b.z0 + 0.15], [b.x1 - 0.15, b.z0 + 0.15], [b.x0 + 0.15, b.z1 - 0.15], [b.x1 - 0.15, b.z1 - 0.15]];
  for (const [x, z] of legs) B.box('wood', x - 0.1, x + 0.1, 0, b.y1, z - 0.1, z + 0.1, '#ffffff');
  for (let y = 1.4; y < b.y1 - 0.5; y += 1.8) {
    const len = Math.hypot(lx, 1.8);
    for (const z of [b.z0 + 0.1, b.z1 - 0.1]) B.box('wood', cx - len / 2, cx + len / 2, y - 0.05, y + 0.05, z - 0.05, z + 0.05, '#ffffff', { rz: Math.atan2(1.8, lx) * (Math.floor(y / 1.8) % 2 ? 1 : -1) });
  }
  B.box('wood', b.x0 - 0.2, b.x1 + 0.2, b.y1 - 0.2, b.y1, b.z0 - 0.2, b.z1 + 0.2, '#ffffff');
  for (const [z0, z1] of [[b.z0 - 0.25, b.z0 + 0.15], [b.z1 - 0.15, b.z1 + 0.25]]) {
    for (let x = b.x0 - 0.1; x < b.x1 + 0.1; x += 0.6) {
      const bag = new THREE.SphereGeometry(0.5, 8, 5);
      bag.scale(0.62, 0.3, z1 - z0);
      bag.translate(x + 0.3, b.y1 + 0.15, (z0 + z1) / 2);
      B.add('sack', bag, '#f0e6cc');
    }
  }
  snowCap(ctx, b.x0 - 0.2, b.x1 + 0.2, b.y1 + 0.3, b.z0 - 0.25, b.z1 + 0.25);
}

/** An anti-aircraft gun or a radar, with an intact and a wrecked version. */
function buildTarget(b, group, spinners, M) {
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const intact = new THREE.Group();
  const wreck = new THREE.Group();
  const s = new Batch();
  const w = new Batch();
  const t = new Batch();
  const radar = b.style === 'radar';
  if (radar) {
    s.cyl('concrete', cx, 0, cz, 0.5, 1.6, '#c8c8c4', { sides: 20 });
    s.cyl('metal', cx, 0.5, cz, 1.6, 0.35, '#b0b4ba');
    s.box('paint', cx - 0.6, cx + 0.6, 1.05, 1.75, cz - 0.6, cz + 0.6, '#e0e4ea');
    w.cyl('concrete', cx, 0, cz, 0.5, 1.6, '#4a4a4a', { sides: 20 });
    w.cyl('metal', cx, 0.5, cz, 0.9, 0.35, '#3a3a3a');
    w.box('metal', cx + 0.5, cx + 1.9, 0.1, 0.45, cz - 1.5, cz + 0.3, '#3a3e44', { ry: 0.6, rz: 0.3 });
    const dish = new THREE.SphereGeometry(1.7, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6);
    dish.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 2 - 0.25));
    dish.translate(0.4, 0.9, 0);
    t.add('paint', dish, '#eef0f4');
    t.cyl('metal', 0, 0, 0, 0.9, 0.06, '#5a5e64', { rz: Math.PI / 2 });
    t.box('paint', -0.4, 0.4, 0, 0.6, -0.3, 0.3, '#a8aeb6');
  } else {
    s.cyl('concrete', cx, 0, cz, 0.35, 1.55, '#b8b4a8', { sides: 20 });
    s.cyl('metal', cx, 0.35, cz, 0.4, 1.1, '#6a6a56', { sides: 16 });
    w.cyl('concrete', cx, 0, cz, 0.35, 1.55, '#3a3a36', { sides: 20 });
    w.box('metal', cx - 0.7, cx + 0.7, 0.4, 1.0, cz - 0.6, cz + 0.6, '#2a2822', { ry: 0.5, rz: 0.4 });
    for (const dz of [-0.3, 0.3]) w.cyl('metal', cx + 0.8, 0.2, cz + dz, 2.2, 0.08, '#1a1a1a', { rz: 1.4 });
    t.box('paint', -0.8, 0.8, 0, 0.9, -0.65, 0.65, '#5e6048');
    t.box('paint', -0.7, -0.1, 0.9, 1.2, -0.5, 0.5, '#4a4c3a');
    for (const dz of [-0.3, 0.3]) {
      t.cyl('metal', 0.9, 0.95, dz, 2.6, 0.075, '#202020', { rz: -1.0 });
      t.cyl('metal', 1.95, 1.65, dz, 0.3, 0.11, '#181818', { rz: -1.0 });
    }
    t.box('metal', -0.2, 0.2, 0.9, 1.3, -0.7, -0.55, '#3a3a2e');
  }
  for (const m of s.meshes(M, { chunked: false })) intact.add(m);
  for (const m of w.meshes(M, { chunked: false })) wreck.add(m);
  const pivot = new THREE.Group();
  pivot.position.set(cx, radar ? 2.1 : 0.75, cz);
  for (const m of t.meshes(M, { chunked: false })) pivot.add(m);
  if (radar) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glowMaterial('#ff3020', 6));
    g.position.set(0, 2.4, 0);
    pivot.add(g);
  }
  intact.add(pivot);
  const spin = { pivot, rate: radar ? 1.4 : 0, stopped: false };
  spinners.push(spin);
  wreck.visible = false;
  group.add(intact, wreck);
  return { box: b, intact, wreck, spin, x: cx, z: cz };
}

// ------------------------------------------------------------------ helpers

/** Snow on top of something, in the snow theme. */
export function snowCap(ctx, x0, x1, y, z0, z1) {
  if (ctx.theme !== 'snow') return;
  // A drift heaped along the top, highest in the middle, thinning at the edges
  const g = new THREE.SphereGeometry(0.5, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(x1 - x0 + 0.06, Math.min(0.22, 0.06 + Math.min(x1 - x0, z1 - z0) * 0.08), z1 - z0 + 0.06);
  g.translate((x0 + x1) / 2, y - 0.02, (z0 + z1) / 2);
  ctx.B.add('dark', g, '#eef3f8');
}

// ------------------------------------------------------------------ everything

/**
 * Builds every structure in a level. ctx: { B, back, P, rng, lamps, detail, lit, theme, M };
 * out: { group, gates, targets, blinkers, spinners }.
 */
export function buildStructures(ctx, level, out) {
  for (const b of level.boxes) {
    if (b.kind === 'block') {
      const s = b.style;
      if (s === 'house' || s === 'church' || s === 'belltower' || s === 'shop' || s === 'ruin') pueblo(ctx, level, b);
      else if (s === 'shed' || s === 'garage' || s === 'hangar' || s === 'warehouse') tinBuilding(ctx, level, b);
      else if (s === 'barracks' || s === 'bunker' || s === 'hut' || s === 'office') concreteBuilding(ctx, level, b);
      else if (s === 'cabin') cabin(ctx, level, b);
      else if (s === 'container') containers(ctx, b);
      else if (s === 'trailer') trailer(ctx, b);
      else if (s === 'tank') tank(ctx, b);
    } else if (b.kind === 'wall') {
      if (b.style === 'fence') fence(ctx, b);
      else compoundWall(ctx, b);
    } else if (b.kind === 'boostwall') boostWall(ctx, b);
    else if (b.kind === 'gate') {
      const g = gate(ctx, b, ctx.M, out.blinkers);
      out.gates.set(b.id, g);
      out.group.add(g);
    } else if (b.kind === 'tower') tower(ctx, b);
    else if (b.kind === 'target') out.targets.push(buildTarget(b, out.group, out.spinners, ctx.M));
    else if (b.kind === 'rock') rock(ctx, b);
    else if (b.kind === 'pillar') ctx.B.box('paint', b.x0, b.x1, 0, b.y1, b.z0, b.z1, '#d8d8d4');
  }
  for (const c of level.cranes || []) crane(ctx, c);
  // The gas station's canopy over its pillars, lit underneath
  for (const y of level.yards) {
    if (y.kind !== 'canopy') continue;
    ctx.B.box('paint', y.x0, y.x1, 5, 5.5, y.z0, y.z1, '#f0f0ec');
    ctx.B.box('paint', y.x0 - 0.02, y.x1 + 0.02, 5.1, 5.4, y.z0 - 0.02, y.z1 + 0.02, '#c03020');
    for (let x = y.x0 + 2; x < y.x1 - 1; x += 3.5) ctx.B.box('glow', x - 0.5, x + 0.5, 4.95, 5, (y.z0 + y.z1) / 2 - 0.15, (y.z0 + y.z1) / 2 + 0.15, '#f8f4e8');
  }
}
