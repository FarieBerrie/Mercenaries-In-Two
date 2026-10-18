// What makes a map look lived in: street lamps along the roads, wires strung across the streets
// between the houses, a power line down the desert road, litter in the gutters, burning barrels,
// clutter against the walls, scrub and palms, snowdrifts and junk round the bunkers, and beyond
// the map's edges the country it sits in: dunes and scrub, wooded mountainsides, or the city and
// the ships round the port.
import * as THREE from 'three/webgpu';
import { boxesNear } from '../level.js';
import { wire } from './town.js';

const CONTAINER_COLORS = ['#9a2a24', '#24508c', '#c07a1a', '#2e5e36', '#5e6268', '#7a3470', '#1e6a6e', '#8a7a62'];

/** Is a spot open ground, nothing solid within r? */
export function openAt(level, x, z, r = 0.5) {
  const b = level.bounds;
  if (x < b.x0 + r || x > b.x1 - r || z < b.z0 + r || z > b.z1 - r) return false;
  return !boxesNear(level, x - r, x + r, z - r, z + r).some((o) => x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1);
}
const onRoad = (level, x, z, pad = 0) => level.roads.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);

/** A street lamp at (x, z) whose arm reaches along (dx, dz); lit at night and in the snow. */
function lamp(ctx, x, z, dx, dz) {
  const { B, P, lamps, theme } = ctx;
  const s = theme === 'port' ? 2.2 : 1.55;
  P.place('street_lamp_01', x, 0, z, { ry: Math.atan2(-dz, dx), s });
  const top = 3.75 * s;
  const gx = x + dx * 0.28 * (s / 1.55);
  const gz = z + dz * 0.28 * (s / 1.55);
  B.box('glow', gx - 0.16, gx + 0.16, top - 0.12, top - 0.08, gz - 0.1, gz + 0.1, theme === 'snow' ? '#e8f0ff' : '#ffd8a0');
  if (theme !== 'desert') lamps.push({ x: gx, y: top - 0.3, z: gz, color: theme === 'snow' ? 0xdce8ff : 0xffcf90, k: theme === 'port' ? 22 : 14, d: theme === 'port' ? 24 : 18 });
}

/** Lamps down the edges of the roads, alternating sides on the wide ones. */
function streetLamps(ctx, level) {
  const { rng, theme } = ctx;
  const spacing = theme === 'port' ? 26 : theme === 'snow' ? 34 : 30;
  for (const r of level.roads) {
    if (r.kind === 'plaza' || r.kind === 'yard') continue;
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    if (len < 20) continue;
    let side = rng.chance(0.5) ? 1 : -1;
    for (let t = rng.range(6, spacing); t < len - 4; t += spacing) {
      const a = (alongX ? r.x0 : r.z0) + t;
      const edge = side > 0 ? (alongX ? r.z1 : r.x1) + 0.7 : (alongX ? r.z0 : r.x0) - 0.7;
      const [x, z] = alongX ? [a, edge] : [edge, a];
      if (openAt(level, x, z, 0.6) && !onRoad(level, x, z, -0.1)) lamp(ctx, x, z, alongX ? 0 : -side, alongX ? -side : 0);
      side = -side;
    }
  }
}

/** Wires across the town's streets between the facades on either side, in sagging bundles. */
function streetWires(ctx, level, { lo = 5, hi = 8, every = [9, 15] } = {}) {
  const { B, rng } = ctx;
  const facing = (x, z, nx, nz) => {
    // The building whose face is just across from this road edge, if any
    for (let d = 0.2; d < 3; d += 0.6) {
      const px = x + nx * d;
      const pz = z + nz * d;
      const hit = boxesNear(level, px, px, pz, pz).find((o) => o.kind === 'block' && o.y1 > 4 && px > o.x0 - 0.05 && px < o.x1 + 0.05 && pz > o.z0 - 0.05 && pz < o.z1 + 0.05);
      if (hit) return { b: hit, at: d };
    }
    return null;
  };
  for (const r of level.roads) {
    if (r.kind !== 'street' && r.kind !== 'road') continue;
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    const wid = alongX ? r.z1 - r.z0 : r.x1 - r.x0;
    if (wid > 14) continue;
    const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
    for (let t = rng.range(2, 8); t < len - 2; t += rng.range(...every)) {
      const a = (alongX ? r.x0 : r.z0) + t;
      const a2 = a + rng.range(-3, 3);
      const left = alongX ? facing(a, r.z0, 0, -1) : facing(r.x0, a, -1, 0);
      const right = alongX ? facing(a2, r.z1, 0, 1) : facing(r.x1, a2, 1, 0);
      if (!left || !right) continue;
      const ya = Math.min(left.b.y1 - 0.4, rng.range(lo, hi));
      const yb = Math.min(right.b.y1 - 0.4, rng.range(lo, hi));
      const n = 1 + Math.floor(rng.next() * 3);
      const pa = alongX ? { x: a, z: r.z0 - left.at + 0.05 } : { x: r.x0 - left.at + 0.05, z: a };
      const pb = alongX ? { x: a2, z: r.z1 + right.at - 0.05 } : { x: r.x1 + right.at - 0.05, z: a2 };
      for (let k = 0; k < n; k++) {
        const off = k * 0.15;
        const A = new THREE.Vector3(pa.x + (alongX ? off : 0), ya - k * 0.12, pa.z + (alongX ? 0 : off));
        const Bv = new THREE.Vector3(pb.x + (alongX ? off : 0), yb - k * 0.1, pb.z + (alongX ? 0 : off));
        B.add('rubber', wire(A, Bv, rng.range(0.8, 1.8)), '#151515');
      }
      for (const [p, y] of [[pa, ya], [pb, yb]]) B.box('metal', p.x - 0.12, p.x + 0.12, y - 0.05, y + 0.05, p.z - 0.12, p.z + 0.12, '#3a3a3a');
    }
  }
}

/** Wooden poles carrying a sagging three-wire line along a road. */
function powerLine(ctx, level, r, side) {
  const { B } = ctx;
  const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
  const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
  const off = side > 0 ? (alongX ? r.z1 : r.x1) + 2.5 : (alongX ? r.z0 : r.x0) - 2.5;
  let prev = null;
  for (let t = 10; t < len; t += 38) {
    const a = (alongX ? r.x0 : r.z0) + t;
    const [x, z] = alongX ? [a, off] : [off, a];
    if (!openAt(level, x, z, 0.4)) {
      prev = null;
      continue;
    }
    B.cyl('wood', x, 0, z, 8, 0.13, '#a08060', { sides: 8, rTop: 0.1 });
    if (alongX) B.box('wood', x - 0.07, x + 0.07, 7.4, 7.55, z - 0.9, z + 0.9, '#a08060');
    else B.box('wood', x - 0.9, x + 0.9, 7.4, 7.55, z - 0.07, z + 0.07, '#a08060');
    if (prev) {
      for (const k of [-0.8, 0, 0.8]) {
        const A = new THREE.Vector3(prev.x + (alongX ? 0 : k), 7.5, prev.z + (alongX ? k : 0));
        const Bv = new THREE.Vector3(x + (alongX ? 0 : k), 7.5, z + (alongX ? k : 0));
        B.add('rubber', wire(A, Bv, 0.9, 0.015), '#1a1a1a');
      }
    }
    prev = { x, z };
  }
}

/** Litter along the gutters and in the yards. */
function litterSpots(level, rng, n) {
  const out = [];
  const roads = level.roads.filter((r) => r.kind !== 'quay');
  for (let i = 0; i < n && roads.length; i++) {
    const r = rng.pick(roads);
    const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
    // Most of it gathers along the edges
    const edge = rng.chance(0.7);
    let x = rng.range(r.x0, r.x1);
    let z = rng.range(r.z0, r.z1);
    if (edge) {
      if (alongX) z = rng.chance(0.5) ? r.z0 + rng.next() ** 2 * 1.5 : r.z1 - rng.next() ** 2 * 1.5;
      else x = rng.chance(0.5) ? r.x0 + rng.next() ** 2 * 1.5 : r.x1 - rng.next() ** 2 * 1.5;
    }
    if (openAt(level, x, z, 0.3)) out.push({ x, z });
  }
  return out;
}

/** Clutter against the walls of buildings: what people leave outside. */
function wallClutter(ctx, level, n) {
  const { P, B, rng, theme } = ctx;
  const blocks = level.boxes.filter((b) => b.kind === 'block' && b.style !== 'craneleg' && b.style !== 'tank');
  for (let i = 0; i < n && blocks.length; i++) {
    const b = rng.pick(blocks);
    const side = rng.int(0, 3);
    const t = rng.next();
    const [x, z, ry] = side === 0 ? [b.x0 + (b.x1 - b.x0) * t, b.z0 - 0.7, 0] : side === 1 ? [b.x0 + (b.x1 - b.x0) * t, b.z1 + 0.7, Math.PI] : side === 2 ? [b.x0 - 0.7, b.z0 + (b.z1 - b.z0) * t, Math.PI / 2] : [b.x1 + 0.7, b.z0 + (b.z1 - b.z0) * t, -Math.PI / 2];
    if (!openAt(level, x, z, 0.55)) continue;
    const r = rng.next();
    const turn = ry + rng.range(-0.4, 0.4);
    if (theme === 'desert') {
      if (r < 0.2) P.place('wooden_military_crate', x, 0, z, { ry: turn, s: 0.8 });
      else if (r < 0.35) P.place(rng.pick(['Barrel_01', 'Barrel_02', 'barrel_03']), x, 0, z, { ry: turn });
      else if (r < 0.48) P.place('old_tyre', x, 0.08, z, { ry: turn, rx: Math.PI / 2 });
      else if (r < 0.6) P.place('metal_jerrycan', x, 0, z, { ry: turn });
      else if (r < 0.74) P.place('cardboard_box_01', x, 0, z, { ry: turn, s: rng.range(0.9, 1.3) });
      else if (r < 0.84) P.place('propane_tank', x, 0, z, { ry: turn });
      else P.place(rng.pick(['shrub_02', 'shrub_03', 'shrub_04']), x, 0, z, { ry: turn, s: rng.range(0.4, 0.7) });
    } else if (theme === 'port') {
      if (r < 0.22) P.place('metal_trash_can', x, 0, z, { ry: turn, s: 0.6 });
      else if (r < 0.4) P.place('trashbag', x, 0, z, { ry: turn, s: rng.range(0.8, 1.2) });
      else if (r < 0.52) P.place('plastic_crate_01', x, 0, z, { ry: turn });
      else if (r < 0.62) P.place('hand_truck', x, 0, z, { ry: turn });
      else if (r < 0.72) P.place('small_lpg_tank', x, 0, z, { ry: turn });
      else if (r < 0.82) P.place('utility_box_01', x, 0, z, { ry });
      else if (r < 0.9) P.place('fire_hydrant', x, 0, z, { ry: turn, s: 0.8 });
      else P.place('old_tyre', x, 0.08, z, { ry: turn, rx: Math.PI / 2 });
    } else {
      if (r < 0.25) P.place('metal_jerrycan_green', x, 0, z, { ry: turn });
      else if (r < 0.4) P.place('portable_generator', x, 0, z, { ry: turn });
      else if (r < 0.52) P.place('old_military_compressor', x, 0, z, { ry: turn, s: 0.8 });
      else if (r < 0.66) P.place('ammo_box', x, 0, z, { ry: turn, s: 1.4 });
      else if (r < 0.8) P.place(rng.pick(['Barrel_01', 'barrel_03']), x, 0, z, { ry: turn });
      else {
        const drift = new THREE.SphereGeometry(rng.range(0.6, 1.1), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        drift.scale(1.5, 0.4, 1);
        drift.rotateY(ry);
        drift.translate(x, 0, z);
        B.add('dark', drift, '#f2f6fa');
      }
    }
  }
}

/** Burning barrels: firelight in the streets and yards. */
function fires(ctx, level, n, out) {
  const { P, rng, lamps } = ctx;
  for (let i = 0, tries = 0; i < n && tries < n * 20; tries++) {
    const r = rng.pick(level.roads);
    const x = rng.range(r.x0, r.x1);
    const z = rng.range(r.z0, r.z1);
    if (!openAt(level, x, z, 1.2)) continue;
    P.place('barrel_03', x, 0, z, { ry: rng.range(0, 6), s: 1.05 });
    out.push({ x, y: 1.0, z, s: rng.range(0.7, 1) });
    lamps.push({ x, y: 1.6, z, color: 0xff8a3a, k: 9, d: 10, flicker: true });
    i++;
  }
}

/**
 * Everything inside the map that isn't gameplay. spots collects positions for the instanced
 * plants: { palms, pines, grass, litter }; smokes and fires are returned for the effects.
 */
export function dressMap(ctx, level, spots) {
  const { P, B, rng, detail, theme } = ctx;
  const b = level.bounds;
  const area = (b.x1 - b.x0) * (b.z1 - b.z0);
  streetLamps(ctx, level);
  const fireList = [];
  const smokes = [];
  if (theme !== 'snow') {
    streetWires(ctx, level, theme === 'port' ? { lo: 6, hi: 9, every: [14, 24] } : {});
    spots.litter.push(...litterSpots(level, rng, Math.round(area * 0.012 * detail)));
    fires(ctx, level, theme === 'port' ? 14 : 10, fireList);
    // Smoke rising from somewhere beyond the edge of the map
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2);
      smokes.push({ x: (b.x0 + b.x1) / 2 + Math.cos(a) * ((b.x1 - b.x0) / 2 + rng.range(30, 90)), y: theme === 'port' ? 2 : 6, z: (b.z0 + b.z1) / 2 + Math.sin(a) * ((b.z1 - b.z0) / 2 + rng.range(30, 90)), s: rng.range(0.8, 1.3) });
    }
  }
  if (detail >= 0.5) wallClutter(ctx, level, Math.round(level.boxes.filter((o) => o.kind === 'block').length * 1.2 * detail));
  for (const t of level.trees) (theme === 'desert' ? spots.palms : spots.pines).push({ x: t.x, y: 0, z: t.z, s: t.s, r: rng.range(0, 6) });

  if (theme === 'desert') {
    // A power line down the road east, scrub and dry grass over the open ground
    const road = level.roads.find((r) => r.kind === 'road' && r.x1 - r.x0 > 60);
    if (road) powerLine(ctx, level, road, -1);
    // Mostly dry grass (cheap cards), a scanned shrub or branch here and there
    for (let i = 0; i < area * 0.005 * detail; i++) {
      const x = rng.range(b.x0, b.x1);
      const z = rng.range(b.z0, b.z1);
      if (onRoad(level, x, z, 1) || !openAt(level, x, z, 0.4)) continue;
      const r = rng.next();
      if (r < 0.84) spots.grass.push({ x, y: 0, z, s: rng.range(0.4, 0.9), r: rng.range(0, 6) });
      else if (r < 0.93) P.place(rng.pick(['shrub_02', 'shrub_03']), x, 0, z, { ry: rng.range(0, 6), s: rng.range(0.5, 1.0) });
      else P.place('dry_branches_medium_01', x, 0, z, { ry: rng.range(0, 6), s: rng.range(0.7, 1.2) });
    }
  } else if (theme === 'snow') {
    for (let i = 0; i < area * 0.0016 * detail; i++) {
      const x = rng.range(b.x0, b.x1);
      const z = rng.range(b.z0, b.z1);
      if (onRoad(level, x, z, 1) || !openAt(level, x, z, 1)) continue;
      const r = rng.next();
      if (r < 0.45) {
        const drift = new THREE.SphereGeometry(rng.range(0.7, 1.5), 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        drift.scale(1.6, 0.32, 1);
        drift.rotateY(rng.range(0, 6));
        drift.translate(x, 0, z);
        B.add('dark', drift, '#f2f6fa');
      } else if (r < 0.65) P.place('dead_tree_trunk', x, 0, z, { ry: rng.range(0, 6), s: rng.range(0.6, 1) });
      else P.place(rng.pick(['rock_07', 'rock_09']), x, 0, z, { ry: rng.range(0, 6), s: rng.range(2, 4) });
    }
    // Red-topped poles marking the road edges for the ploughs
    for (const r of level.roads) {
      const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
      const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let t = 4; t < len; t += 12) {
        for (const s of [-1, 1]) {
          const a = (alongX ? r.x0 : r.z0) + t;
          const e = s > 0 ? (alongX ? r.z1 : r.x1) + 0.4 : (alongX ? r.z0 : r.x0) - 0.4;
          const [x, z] = alongX ? [a, e] : [e, a];
          if (openAt(level, x, z, 0.2)) B.cyl('paint', x, 0, z, 1.4, 0.035, '#c83020', { sides: 6 });
        }
      }
    }
  }
  return { fires: fireList, smokes };
}

/** The country round the map. height: the terrain's height function. */
export function dressBackdrop(ctx, level, height, spots) {
  const { back, PB, rng, detail, lamps, theme } = ctx;
  const b = level.bounds;
  const ring = (inner, outer) => {
    // A point between `inner` and `outer` metres outside the map's edge
    for (;;) {
      const x = rng.range(b.x0 - outer, b.x1 + outer);
      const z = rng.range(b.z0 - outer, b.z1 + outer);
      const d = Math.max(b.x0 - x, x - b.x1, b.z0 - z, z - b.z1);
      if (d > inner && d < outer) return { x, z };
    }
  };
  if (theme === 'desert') {
    for (let i = 0; i < 700 * detail; i++) {
      const { x, z } = ring(6, 150);
      const y = height(x, z);
      const r = rng.next();
      if (r < 0.12) spots.palms.push({ x, y: y - 0.2, z, s: rng.range(0.9, 1.4), r: rng.range(0, 6) });
      else if (r < 0.16) PB.place('quiver_tree_02', x, y - 0.1, z, { ry: rng.range(0, 6), s: rng.range(1.8, 3) });
      else if (r < 0.24) PB.place('shrub_02', x, y - 0.1, z, { ry: rng.range(0, 6), s: rng.range(0.6, 1.1) });
      else if (r < 0.28) PB.place('namaqualand_boulder_02', x, y - 0.3, z, { ry: rng.range(0, 6), s: rng.range(0.6, 1.4) });
      else spots.grass.push({ x, y, z, s: rng.range(0.6, 1.1), r: rng.range(0, 6) });
    }
  } else if (theme === 'snow') {
    // Woods up the mountainsides in stands, thinning to the treeline
    for (let k = 0; k < 90 * detail; k++) {
      const c = ring(4, 160);
      const r = rng.range(12, 34);
      for (let i = 0; i < 18; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * r;
        const x = c.x + Math.cos(a) * d;
        const z = c.z + Math.sin(a) * d;
        if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) continue;
        const y = height(x, z);
        if (y > 45 || rng.chance(y / 60)) continue; // treeline
        spots.pines.push({ x, y: y - 0.3, z, s: rng.range(0.8, 1.6), r: rng.range(0, 6) });
      }
    }
  } else {
    // The land side: a fence along the edge with floodlights, then the city's warehouses
    for (const [x0, x1, z0, z1] of [[b.x0 - 400, b.x1 + 2, b.z0 - 1.2, b.z0 - 0.9], [b.x0 - 1.2, b.x0 - 0.9, b.z0 - 400, b.z1 + 2]]) {
      back.box('fence', x0, x1, 0.1, 3.2, z0, z1, '#ffffff');
    }
    for (let i = 0; i < 260; i++) {
      const { x, z } = ring(14, 260);
      if (x > b.x1 - 10 || z > b.z1 - 10) continue; // that side is the water
      const w = rng.range(14, 40);
      const d = rng.range(12, 30);
      const h = rng.range(6, 22);
      back.box('wall', x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, rng.pick(['#8a8a8a', '#7a7a72', '#9a9488']));
      for (let k = 0; k < h / 4; k++) if (rng.chance(0.25)) back.box('glow', x - w / 2 + rng.range(1, w - 3), x - w / 2 + rng.range(1, w - 3) + 1.2, k * 4 + 2, k * 4 + 2.9, z - d / 2 - 0.05, z - d / 2 - 0.02, rng.pick(['#ffcf80', '#a8c8ff', '#ffe8c0']));
    }
    // The quay edges and the ships moored off them
    for (const [x0, x1, z0, z1] of [[b.x0 - 400, b.x1 + 1, b.z1, b.z1 + 0.8], [b.x1, b.x1 + 0.8, b.z0 - 400, b.z1 + 0.8]]) back.box('concrete', x0, x1, -1.4, 0, z0, z1, '#b0b0aa');
    for (let x = b.x0 - 300; x < b.x1; x += 9) back.cyl('paint', x, 0, b.z1 + 0.4, 0.55, 0.18, '#2a2a2c', { rTop: 0.22 });
    const ship = (x, z, alongX) => {
      const L = rng.range(130, 190);
      const W = rng.range(22, 30);
      const box = (a0, a1, y0, y1, c0, c1, col, key = 'paint') => (alongX ? back.box(key, x + a0, x + a1, y0, y1, z + c0, z + c1, col) : back.box(key, x + c0, x + c1, y0, y1, z + a0, z + a1, col));
      box(-L / 2, L / 2, -3, 9, -W / 2, W / 2, '#2a2e36');
      box(-L / 2, L / 2, 7, 9, -W / 2 - 0.1, W / 2 + 0.1, '#6a1a1a');
      box(L / 2 - 30, L / 2 - 14, 9, 28, -W / 2 + 2, W / 2 - 2, '#d0d0c8');
      for (let k = -L / 2 + 6; k < L / 2 - 34; k += 6.5) for (let y = 9; y < 9 + rng.int(1, 4) * 2.6; y += 2.6) box(k, k + 6, y, y + 2.5, -W / 2 + 2, W / 2 - 2, rng.pick(CONTAINER_COLORS), 'container');
      for (let k = -L / 2 + 2; k < L / 2 - 2; k += 3) box(k, k + 0.4, 9.3, 9.6, -W / 2 - 0.15, -W / 2 - 0.1, '#ffcf80', 'glow');
      lamps.push({ x, y: 20, z, color: 0xffe0b0, k: 80, d: 60, far: true });
    };
    for (let x = b.x0 + 40; x < b.x1 - 60; x += rng.range(200, 260)) ship(x, b.z1 + 28, true);
    ship(b.x1 + 26, (b.z0 + b.z1) / 2 + 20, false);
    // The city skyline far beyond
    for (let i = 0; i < 160; i++) {
      const a = rng.range(Math.PI * 0.95, Math.PI * 2.05);
      const r = rng.range(520, 700);
      const x = (b.x0 + b.x1) / 2 + Math.cos(a) * r;
      const z = (b.z0 + b.z1) / 2 + Math.sin(a) * r;
      const h = rng.range(20, 90);
      const w = rng.range(14, 30);
      back.box('dark', x - w / 2, x + w / 2, 0, h, z - w / 2, z + w / 2, '#0e121a');
      for (let k = 0; k < h / 4; k++) if (rng.chance(0.35)) back.box('glow', x - 2, x + 2, k * 4 + 2, k * 4 + 3, z - w / 2 - 0.1, z - w / 2 - 0.05, rng.pick(['#ffcf80', '#a8c8ff', '#ffe8c0']));
    }
  }
}
