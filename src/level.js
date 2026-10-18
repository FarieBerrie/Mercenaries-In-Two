// A mission's world: one open map (maps.js lays it out) with the places you fight spread across
// it. Everything solid is an axis-aligned box, kept in a 2D grid so a body, a bullet or the
// camera only looks at the boxes near it. Low boxes are cover; the points beside them where
// you're protected are worked out here so the AI can find them.
import { MAPS } from './maps.js';
import { MISSIONS } from './missions.js';
import { rebuildNav } from './nav.js';
import { createRng } from './rng.js';

export const COVER_HEIGHT = 1.3; // boxes this low or lower are cover you can crouch behind
const CELL = 8;

export function buildLevel(missionIndex = 0, seed = 7) {
  const mission = MISSIONS[missionIndex];
  const rng = createRng(seed + missionIndex * 1000);
  const level = {
    mission,
    missionIndex,
    theme: mission.theme,
    bounds: null, // { x0, x1, z0, z1 }: where bodies can go
    start: null, // { x, z, yaw }: where the contract begins
    boxes: [],
    areas: [],
    cover: [],
    roads: [], // { x0, x1, z0, z1, kind }: streets, roads, plazas and yards (for the ground and the map)
    yards: [], // courtyards and lots, for dressing
    trees: [], // { x, z, s }: palms or pines (their trunks are boxes too)
    patrols: [], // { route: [{ x, z }], squad: [type] }
    grid: null,
  };
  MAPS[mission.theme](level, rng, mission);
  rebuildGrid(level);
  for (const area of level.areas) if (area.spawns.length < 14) findSpawns(level, area, rng);
  level.cover = findCoverPoints(level);
  rebuildNav(level);
  return level;
}

/** Spread-out places for an area's enemies to come in, clear of everything. */
function findSpawns(level, area, rng) {
  const r = area.spawnRect;
  for (let tries = 0; area.spawns.length < 14 && tries < 600; tries++) {
    const x = rng.range(r.x0 + 1, r.x1 - 1);
    const z = rng.range(r.z0 + 1, r.z1 - 1);
    if (!inBounds(level, x, z, 2)) continue;
    if (groundHeight(level, x, z, 0.9) > 0) continue;
    if (area.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) continue;
    area.spawns.push({ x, z });
  }
}

export const inBounds = (level, x, z, pad = 0) => x > level.bounds.x0 + pad && x < level.bounds.x1 - pad && z > level.bounds.z0 + pad && z < level.bounds.z1 - pad;

/** Spots right beside low boxes, each with the direction the box protects you from. */
function findCoverPoints(level) {
  const points = [];
  for (const b of level.boxes) {
    if (b.kind !== 'cover' || b.y1 > COVER_HEIGHT) continue;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const candidates = [];
    for (let z = b.z0 + 0.4; z <= b.z1 - 0.4 + 1e-6; z += 1.2) {
      candidates.push({ x: b.x0 - 0.6, z, nx: 1, nz: 0 }, { x: b.x1 + 0.6, z, nx: -1, nz: 0 });
    }
    for (let x = b.x0 + 0.4; x <= b.x1 - 0.4 + 1e-6; x += 1.2) {
      candidates.push({ x, z: b.z0 - 0.6, nx: 0, nz: 1 }, { x, z: b.z1 + 0.6, nx: 0, nz: -1 });
    }
    if (!candidates.length) candidates.push({ x: b.x0 - 0.6, z: cz, nx: 1, nz: 0 }, { x: b.x1 + 0.6, z: cz, nx: -1, nz: 0 });
    for (const c of candidates) {
      if (groundHeight(level, c.x, c.z, 0.3) > 0) continue; // inside something else
      if (!inBounds(level, c.x, c.z, 1)) continue;
      points.push({ ...c, box: b, cx, cz });
    }
  }
  return points;
}

// ------------------------------------------------------------------ the grid

export function rebuildGrid(level) {
  const { x0, x1, z0, z1 } = level.bounds;
  const pad = 48; // boxes can sit a little outside the bounds (walls, the map's edges)
  const gx0 = Math.floor((x0 - pad) / CELL);
  const gz0 = Math.floor((z0 - pad) / CELL);
  const nx = Math.ceil((x1 + pad) / CELL) - gx0;
  const nz = Math.ceil((z1 + pad) / CELL) - gz0;
  const cells = Array.from({ length: nx * nz }, () => []);
  for (const b of level.boxes) {
    const [c0, c1] = [clampI(Math.floor(b.x0 / CELL) - gx0, nx), clampI(Math.floor(b.x1 / CELL) - gx0, nx)];
    const [r0, r1] = [clampI(Math.floor(b.z0 / CELL) - gz0, nz), clampI(Math.floor(b.z1 / CELL) - gz0, nz)];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * nx + c].push(b);
  }
  level.grid = { gx0, gz0, nx, nz, cells };
}

const clampI = (i, n) => Math.max(0, Math.min(n - 1, i));

let stamp = 0;
/** Every box overlapping the rectangle [xa, xb] × [za, zb], each once. */
export function boxesNear(level, xa, xb, za, zb) {
  stamp++;
  const { gx0, gz0, nx, nz, cells } = level.grid;
  const c0 = clampI(Math.floor(Math.min(xa, xb) / CELL) - gx0, nx);
  const c1 = clampI(Math.floor(Math.max(xa, xb) / CELL) - gx0, nx);
  const r0 = clampI(Math.floor(Math.min(za, zb) / CELL) - gz0, nz);
  const r1 = clampI(Math.floor(Math.max(za, zb) / CELL) - gz0, nz);
  const out = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      for (const b of cells[r * nx + c]) {
        if (b._seen === stamp) continue;
        b._seen = stamp;
        out.push(b);
      }
    }
  }
  return out;
}

/**
 * Every box in the grid cells a ray passes over (in plan), out to maxDist, each once: what a
 * bullet, a line of sight or the camera needs to test. d need not be normalised in y.
 */
export function boxesOnRay(level, o, d, maxDist) {
  stamp++;
  const { gx0, gz0, nx, nz, cells } = level.grid;
  const out = [];
  const take = (c, r) => {
    if (c < 0 || r < 0 || c >= nx || r >= nz) return;
    for (const b of cells[r * nx + c]) {
      if (b._seen === stamp) continue;
      b._seen = stamp;
      out.push(b);
    }
  };
  const hx = d.x;
  const hz = d.z;
  const hl = Math.hypot(hx, hz);
  let c = Math.floor(o.x / CELL) - gx0;
  let r = Math.floor(o.z / CELL) - gz0;
  take(c, r);
  if (hl < 1e-9) return out;
  // Distances are measured along the ray (|d| = 1 in 3D), so the plan length scales by hl
  const reach = maxDist * hl;
  const ux = hx / hl;
  const uz = hz / hl;
  const stepC = ux > 0 ? 1 : -1;
  const stepR = uz > 0 ? 1 : -1;
  const cellX = (c + gx0) * CELL;
  const cellZ = (r + gz0) * CELL;
  let tMaxX = Math.abs(ux) < 1e-9 ? Infinity : ((ux > 0 ? cellX + CELL : cellX) - o.x) / ux;
  let tMaxZ = Math.abs(uz) < 1e-9 ? Infinity : ((uz > 0 ? cellZ + CELL : cellZ) - o.z) / uz;
  const tDX = Math.abs(ux) < 1e-9 ? Infinity : CELL / Math.abs(ux);
  const tDZ = Math.abs(uz) < 1e-9 ? Infinity : CELL / Math.abs(uz);
  for (let n = 0; n < 400; n++) {
    if (tMaxX < tMaxZ) {
      if (tMaxX > reach) break;
      c += stepC;
      tMaxX += tDX;
    } else {
      if (tMaxZ > reach) break;
      r += stepR;
      tMaxZ += tDZ;
    }
    if (c < -1 || r < -1 || c > nx || r > nz) break;
    take(c, r);
  }
  return out;
}

/** Height of the highest surface under a square footprint, no higher than `below`. */
export function groundHeight(level, x, z, r = 0, below = Infinity) {
  let top = 0;
  for (const b of boxesNear(level, x - r, x + r, z - r, z + r)) {
    if (b.y1 > below + 0.01 || b.y1 <= top) continue;
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) top = b.y1;
  }
  return top;
}

/** How far a horizontal line from `from` along `dir` runs before it meets a box (at most max). */
export function roomAlong(level, from, dir, max) {
  let t = max;
  for (const b of boxesOnRay(level, from, dir, max)) {
    const tt = rayBoxDist(from, dir, b);
    if (tt < t) t = tt;
  }
  return t;
}

const rayBoxDist = (o, d, box) => {
  let tmin = 0;
  let tmax = Infinity;
  for (const [oa, da, lo, hi] of [
    [o.x, d.x, box.x0, box.x1],
    [o.y, d.y, box.y0, box.y1],
    [o.z, d.z, box.z0, box.z1],
  ]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < lo || oa > hi) return Infinity;
      continue;
    }
    let t0 = (lo - oa) / da;
    let t1 = (hi - oa) / da;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
};

/** Removes a box (an opened gate). */
export function removeBox(level, box) {
  box.removed = true;
  level.boxes = level.boxes.filter((b) => b !== box);
  rebuildGrid(level);
  rebuildNav(level);
}

/** Is a point inside an area's patch of ground (its fighting rectangle, grown by `pad`)? */
export function inArea(area, p, pad = 0) {
  return p.x > area.x0 - pad && p.x < area.x1 + pad && p.z > area.z0 - pad && p.z < area.z1 + pad;
}

/** The area a point is in (nearest centre among those it's inside), or -1 out in the open. */
export function areaAt(level, p, pad = 0) {
  let best = -1;
  let bestD = Infinity;
  for (const a of level.areas) {
    if (!inArea(a, p, pad)) continue;
    const d = Math.hypot(p.x - a.center.x, p.z - a.center.z);
    if (d < bestD) {
      best = a.index;
      bestD = d;
    }
  }
  return best;
}
