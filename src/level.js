// Builds a mission's world from missions.js: areas in a row along +x, each walled in at the
// sides, with cover scattered through it and a gate (or a high wall to step-jump) at the far
// end. Everything solid is an axis-aligned box. Low boxes are cover; the points beside them
// where you're protected are worked out here so the AI can find them.
import { MISSIONS } from './missions.js';
import { createRng } from './rng.js';

export const HALF_WIDTH = 22; // each area spans z = -22..22
const CELL = 16;
const GATE_WIDTH = 8;
const WALL_HEIGHT = 9;
const BOOST_WALL = 3.4;
export const COVER_HEIGHT = 1.3; // boxes this low or lower are cover you can crouch behind

// Cover props per theme: [kind, length (x), height, depth (z)]
const COVER = {
  desert: [['crate', 1.2, 1.2, 1.2], ['sandbags', 3, 1, 0.8], ['barrier', 2.6, 1.1, 0.6], ['car', 4.4, 1.3, 2], ['drums', 1.4, 1.1, 1.4]],
  port: [['crate', 1.2, 1.2, 1.2], ['barrier', 2.6, 1.1, 0.6], ['pallets', 2.4, 1, 1.6], ['drums', 1.4, 1.1, 1.4], ['forklift', 2.6, 1.3, 1.4]],
  snow: [['crate', 1.2, 1.2, 1.2], ['sandbags', 3, 1, 0.8], ['barrier', 2.6, 1.1, 0.6], ['rocks', 2.2, 1.2, 1.8], ['drums', 1.4, 1.1, 1.4]],
};
const BIG = { desert: 'house', port: 'container', snow: 'bunker' };

export function buildLevel(missionIndex = 0, seed = 7) {
  const mission = MISSIONS[missionIndex];
  const rng = createRng(seed + missionIndex * 1000);
  const W = HALF_WIDTH;
  const level = {
    mission,
    missionIndex,
    theme: mission.theme,
    length: mission.areas.reduce((n, a) => n + a.length, 0),
    halfWidth: W,
    boxes: [],
    cells: [],
    areas: [],
    cover: [],
  };
  const addBox = (x0, x1, y0, y1, z0, z1, props) => {
    const box = { id: level.boxes.length, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), ...props };
    level.boxes.push(box);
    return box;
  };
  const free = (x0, x1, z0, z1, pad = 1.6) => !level.boxes.some((b) => b.x0 < x1 + pad && b.x1 > x0 - pad && b.z0 < z1 + pad && b.z1 > z0 - pad);

  let x0 = 0;
  mission.areas.forEach((spec, index) => {
    const x1 = x0 + spec.length;
    const last = index === mission.areas.length - 1;
    const area = {
      index,
      name: spec.name,
      x0,
      x1,
      spec,
      start: { x: x0 + 4, z: 0 },
      spawns: [],
      objectives: [],
      gate: null,
      boost: null,
      nest: null,
      targets: [],
      extract: null,
    };

    // Side walls: tall buildings, containers or cliffs, depending on the theme
    for (const side of [-1, 1]) {
      for (let x = x0; x < x1; ) {
        const w = Math.min(x1 - x, rng.range(8, 16));
        const depth = rng.range(4, 8);
        addBox(x, x + w, 0, rng.range(6, 12), side * W, side * (W + depth), { kind: 'edge', style: BIG[mission.theme] });
        x += w;
      }
    }
    // The far end: a gate in a wall, a high wall to step-jump, or (last area) solid
    if (spec.boost) {
      area.gate = addBox(x1 - 1, x1, 0, BOOST_WALL, -W, W, { kind: 'boostwall', style: 'wall' });
      area.boost = { x: x1 - 2.2, z: 0, landing: { x: x1 + 3, z: 0 } };
    } else if (last) {
      addBox(x1 - 1, x1, 0, WALL_HEIGHT, -W, W, { kind: 'edge', style: 'wall' });
    } else {
      addBox(x1 - 1, x1, 0, WALL_HEIGHT, -W, -GATE_WIDTH / 2, { kind: 'edge', style: 'wall' });
      addBox(x1 - 1, x1, 0, WALL_HEIGHT, GATE_WIDTH / 2, W, { kind: 'edge', style: 'wall' });
      area.gate = addBox(x1 - 1, x1, 0, WALL_HEIGHT * 0.7, -GATE_WIDTH / 2, GATE_WIDTH / 2, { kind: 'gate', style: 'gate' });
    }

    // Objectives and set pieces get their space first.
    for (const [px, pz] of spec.plant || []) {
      addBox(x0 + px - 1.6, x0 + px + 1.6, 0, 2.6, pz - 1.6, pz + 1.6, { kind: 'target', style: mission.theme === 'snow' ? 'radar' : 'aagun' });
      area.objectives.push({ kind: 'plant', x: x0 + px - 2.4, z: pz, done: false, progress: 0 });
    }
    if (spec.rescue) {
      const [hx, hz] = spec.rescue;
      area.objectives.push({ kind: 'rescue', x: x0 + hx, z: hz, done: false, progress: 0 });
    }
    if (spec.snipe) {
      // A nest at the near end, and tall towers at the far end with marksmen on them
      area.nest = { x: x0 + 6, z: -W + 5, y: 4 };
      addBox(x0 + 4, x0 + 9, 0, 4, -W, -W + 7, { kind: 'tower', style: 'tower' });
      for (const tz of [-14, -5, 5, 14]) {
        const tx = x1 - 10 + rng.range(-2, 2);
        addBox(tx - 1.5, tx + 1.5, 0, 7, tz - 1.5, tz + 1.5, { kind: 'tower', style: 'tower' });
        area.targets.push({ x: tx, y: 7, z: tz });
      }
    }
    if (spec.extract) area.extract = { x: x1 - 8, z: 0 };

    // Cover through the middle of the area, in loose rows so there are always ways through
    const palette = COVER[mission.theme];
    for (let row = x0 + 10; row < x1 - 8; row += rng.range(6, 9)) {
      for (let z = -W + 3; z < W - 3; z += rng.range(4, 7)) {
        if (rng.chance(0.45)) continue;
        const [kind, len, h, depth] = rng.pick(palette);
        const turn = rng.chance(0.3);
        const lx = turn ? depth : len;
        const lz = turn ? len : depth;
        const cx = row + rng.range(-1, 1);
        if (!free(cx - lx / 2, cx + lx / 2, z - lz / 2, z + lz / 2)) continue;
        addBox(cx - lx / 2, cx + lx / 2, 0, h, z - lz / 2, z + lz / 2, { kind: 'cover', style: kind });
      }
    }
    // A couple of bigger blocks (houses, containers, bunkers) to break up sight lines
    for (let i = 0; i < 3; i++) {
      const cx = rng.range(x0 + 18, x1 - 14);
      const cz = (rng.chance(0.5) ? -1 : 1) * rng.range(8, W - 6);
      const [lx, lz] = mission.theme === 'port' ? [6, 2.5] : [rng.range(5, 8), rng.range(4, 7)];
      if (free(cx - lx / 2, cx + lx / 2, cz - lz / 2, cz + lz / 2, 2.5)) addBox(cx - lx / 2, cx + lx / 2, 0, mission.theme === 'port' ? 2.6 : rng.range(3.5, 5), cz - lz / 2, cz + lz / 2, { kind: 'block', style: BIG[mission.theme] });
    }

    // Where enemies come in: the far half of the area, clear of everything
    for (let tries = 0; area.spawns.length < 14 && tries < 400; tries++) {
      const sx = rng.range(x0 + spec.length * 0.55, x1 - 4);
      const sz = rng.range(-W + 3, W - 3);
      if (free(sx - 0.5, sx + 0.5, sz - 0.5, sz + 0.5, 0.6)) area.spawns.push({ x: sx, z: sz });
    }
    level.areas.push(area);
    x0 = x1;
  });

  rebuildGrid(level);
  level.cover = findCoverPoints(level);
  return level;
}

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
      if (Math.abs(c.z) > level.halfWidth - 1) continue;
      points.push({ ...c, box: b, cx, cz });
    }
  }
  return points;
}

export function rebuildGrid(level) {
  level.cells = Array.from({ length: Math.ceil(level.length / CELL) + 2 }, () => []);
  for (const b of level.boxes) {
    const c0 = Math.max(0, Math.floor(b.x0 / CELL));
    const c1 = Math.min(level.cells.length - 1, Math.floor(b.x1 / CELL));
    for (let c = c0; c <= c1; c++) level.cells[c].push(b);
  }
}

let stamp = 0;
/** Every box overlapping the x range [xa, xb], each once. */
export function boxesNear(level, xa, xb) {
  stamp++;
  const out = [];
  const c0 = Math.max(0, Math.floor(xa / CELL));
  const c1 = Math.min(level.cells.length - 1, Math.floor(xb / CELL));
  for (let c = c0; c <= c1; c++) {
    for (const b of level.cells[c]) {
      if (b._seen === stamp) continue;
      b._seen = stamp;
      out.push(b);
    }
  }
  return out;
}

/** Height of the highest surface under a square footprint, no higher than `below`. */
export function groundHeight(level, x, z, r = 0, below = Infinity) {
  let top = 0;
  for (const b of boxesNear(level, x - r, x + r)) {
    if (b.y1 > below + 0.01 || b.y1 <= top) continue;
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) top = b.y1;
  }
  return top;
}

/** Removes a box (an opened gate). */
export function removeBox(level, box) {
  box.removed = true;
  level.boxes = level.boxes.filter((b) => b !== box);
  rebuildGrid(level);
}

export const areaAt = (level, x) => {
  const i = level.areas.findIndex((a) => x < a.x1);
  return i === -1 ? level.areas.length - 1 : i;
};
