// The three mission maps. Each is open country a few hundred metres across: towns, yards and
// woods to move through, roads and streets between them, and the four places the contract is
// fought over (areas) spread across it. Walls and fences shut the last places in until the one
// before is taken; everything else is open. All built from axis-aligned boxes, deterministically
// from the level's seed.

// Cover props per theme: [kind, length (x), height, depth (z)]
export const COVER = {
  desert: [['crate', 1.2, 1.2, 1.2], ['sandbags', 3, 1, 0.8], ['barrier', 2.6, 1.1, 0.6], ['car', 4.4, 1.3, 2], ['drums', 1.4, 1.1, 1.4]],
  port: [['crate', 1.2, 1.2, 1.2], ['barrier', 2.6, 1.1, 0.6], ['pallets', 2.4, 1, 1.6], ['drums', 1.4, 1.1, 1.4], ['forklift', 2.6, 1.3, 1.4]],
  snow: [['crate', 1.2, 1.2, 1.2], ['sandbags', 3, 1, 0.8], ['barrier', 2.6, 1.1, 0.6], ['rocks', 2.2, 1.2, 1.8], ['drums', 1.4, 1.1, 1.4]],
};

const WALL_H = 3.4; // compound walls and fences: too high to climb, low enough for a leg-up
const grow = (r, d) => ({ x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d });

/** Layout helpers shared by the three maps. */
function makeBuilder(level, rng) {
  const CELLB = 16;
  const hash = new Map();
  const key = (c, r) => (c + 4096) * 8192 + (r + 4096);
  const reserved = []; // { x0, x1, z0, z1, hard }: roads keep buildings out; hard ones keep everything out
  const over = (a, x0, x1, z0, z1, pad = 0) => a.x0 < x1 + pad && a.x1 > x0 - pad && a.z0 < z1 + pad && a.z1 > z0 - pad;

  const B = {
    rng,
    level,
    bounds(x0, x1, z0, z1) {
      level.bounds = { x0, x1, z0, z1 };
    },
    start(x, z, yaw = 0) {
      level.start = { x, z, yaw };
    },
    box(x0, x1, y0, y1, z0, z1, props) {
      const b = { id: level.boxes.length, x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0, y1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), ...props };
      level.boxes.push(b);
      for (let c = Math.floor(b.x0 / CELLB); c <= Math.floor(b.x1 / CELLB); c++) {
        for (let r = Math.floor(b.z0 / CELLB); r <= Math.floor(b.z1 / CELLB); r++) {
          const k = key(c, r);
          if (!hash.has(k)) hash.set(k, []);
          hash.get(k).push(b);
        }
      }
      return b;
    },
    /** Does anything solid overlap the rectangle (grown by pad)? */
    hits(x0, x1, z0, z1, pad = 0) {
      for (let c = Math.floor((x0 - pad) / CELLB); c <= Math.floor((x1 + pad) / CELLB); c++) {
        for (let r = Math.floor((z0 - pad) / CELLB); r <= Math.floor((z1 + pad) / CELLB); r++) {
          for (const b of hash.get(key(c, r)) || []) if (over(b, x0, x1, z0, z1, pad)) return true;
        }
      }
      return false;
    },
    /** Room for something: nothing solid within pad, inside the map, out of kept-clear ground. */
    free(x0, x1, z0, z1, pad = 1.6, { roads = true } = {}) {
      const bd = level.bounds;
      if (x0 < bd.x0 + 1.5 || x1 > bd.x1 - 1.5 || z0 < bd.z0 + 1.5 || z1 > bd.z1 - 1.5) return false;
      if (B.hits(x0, x1, z0, z1, pad)) return false;
      return !reserved.some((k) => (k.hard || !roads) && over(k, x0, x1, z0, z1));
    },
    /** A road, street, plaza or yard: painted on the ground; buildings stay off it. */
    road(x0, x1, z0, z1, kind = 'road') {
      const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), kind };
      level.roads.push(r);
      reserved.push(r);
      return r;
    },
    /** Ground that stays clear of everything (landing pads, ambush rings, sight lines). */
    keep(x0, x1, z0, z1) {
      reserved.push({ x0, x1, z0, z1, hard: true });
    },
    building(x0, x1, z0, z1, h, style, props = {}) {
      return B.box(x0, x1, 0, h, z0, z1, { kind: 'block', style, ...props });
    },
    wall(x0, x1, z0, z1, h = WALL_H, style = 'wall', kind = 'wall') {
      return B.box(x0, x1, 0, h, z0, z1, { kind, style });
    },
    cover(cx, cz, [kind, len, h, depth], turn = false, pad = 1.6, opts = {}) {
      const lx = turn ? depth : len;
      const lz = turn ? len : depth;
      if (!B.free(cx - lx / 2, cx + lx / 2, cz - lz / 2, cz + lz / 2, pad, opts)) return null;
      return B.box(cx - lx / 2, cx + lx / 2, 0, h, cz - lz / 2, cz + lz / 2, { kind: 'cover', style: kind });
    },
    /** Cover through a rectangle in loose rows, so there are always ways through. */
    coverField(rect, palette, { density = 0.55, rows = [6, 9], step = [4, 7] } = {}) {
      for (let x = rect.x0 + 2; x < rect.x1 - 2; x += rng.range(...rows)) {
        for (let z = rect.z0 + 2; z < rect.z1 - 2; z += rng.range(...step)) {
          if (!rng.chance(density)) continue;
          B.cover(x + rng.range(-1, 1), z, rng.pick(palette), rng.chance(0.3));
        }
      }
    },
    /** A tree: drawn by the world as a palm or a pine; its trunk stops bodies and bullets. */
    tree(x, z, s = 1, pad = 1, { roads = false } = {}) {
      const r = 0.28 * s;
      if (!B.free(x - r, x + r, z - r, z + r, pad, { roads })) return false;
      level.trees.push({ x, z, s });
      B.box(x - r, x + r, 0, 7 * s, z - r, z + r, { kind: 'tree', style: 'trunk' });
      return true;
    },
    /** Boulders and outcrops across a rectangle: big ones block, small ones are cover. */
    rocks(rect, n, { big = 0.4 } = {}) {
      for (let i = 0; i < n; i++) {
        const x = rng.range(rect.x0, rect.x1);
        const z = rng.range(rect.z0, rect.z1);
        if (rng.chance(big)) {
          const lx = rng.range(2.5, 6);
          const lz = rng.range(2.5, 6);
          if (B.free(x - lx / 2, x + lx / 2, z - lz / 2, z + lz / 2, 2.5, { roads: false })) B.box(x - lx / 2, x + lx / 2, 0, rng.range(1.8, 4.5), z - lz / 2, z + lz / 2, { kind: 'rock', style: 'boulder' });
        } else B.cover(x, z, ['rocks', rng.range(1.6, 2.6), rng.range(0.9, 1.2), rng.range(1.2, 2)], rng.chance(0.5), 2, { roads: false });
      }
    },
    /**
     * A walled compound: walls round a rectangle, with a gate and a step-up stretch where asked.
     * gate / boost: { side: 'x0'|'x1'|'z0'|'z1', at, width }.
     */
    compound(r, { gate = null, boost = null, style = 'wall', height = WALL_H, open = [] } = {}) {
      const t = 1;
      const out = { gate: null, boostwall: null };
      const sides = {
        x0: { fixed: [r.x0 - t, r.x0], from: r.z0 - t, to: r.z1 + t, alongX: false },
        x1: { fixed: [r.x1, r.x1 + t], from: r.z0 - t, to: r.z1 + t, alongX: false },
        z0: { fixed: [r.z0 - t, r.z0], from: r.x0, to: r.x1, alongX: true },
        z1: { fixed: [r.z1, r.z1 + t], from: r.x0, to: r.x1, alongX: true },
      };
      for (const [name, s] of Object.entries(sides)) {
        if (open.includes(name)) continue;
        // Cut the side into stretches round its openings
        const cuts = [];
        if (gate?.side === name) cuts.push({ a: gate.at - gate.width / 2, b: gate.at + gate.width / 2, kind: 'gate' });
        if (boost?.side === name) cuts.push({ a: boost.at - boost.width / 2, b: boost.at + boost.width / 2, kind: 'boostwall' });
        cuts.sort((p, q) => p.a - q.a);
        let a = s.from;
        const piece = (p, q, kind, h) => {
          if (q - p < 0.05) return null;
          const [f0, f1] = s.fixed;
          return s.alongX ? B.box(p, q, 0, h, f0, f1, { kind, style: kind === 'wall' ? style : kind }) : B.box(f0, f1, 0, h, p, q, { kind, style: kind === 'wall' ? style : kind });
        };
        for (const c of cuts) {
          piece(a, c.a, 'wall', height);
          const b = piece(c.a, c.b, c.kind, height);
          if (c.kind === 'gate') out.gate = b;
          else out.boostwall = b;
          a = c.b;
        }
        piece(a, s.to, 'wall', height);
      }
      return out;
    },
    /** A city block: houses round the edge of a lot facing the streets, a courtyard behind. */
    block(lot, { style = 'house', depth = [5.5, 7.5], width = [7, 12], height = [4.6, 9.4], alleys = 1 } = {}) {
      const house = (x0, x1, z0, z1) => {
        if (x1 - x0 < 2.5 || z1 - z0 < 2.5) return;
        B.building(x0, x1, z0, z1, rng.range(...height), style);
      };
      /** Houses side by side along [a0, a1], each its own width, leaving gaps where asked. */
      const along = (a0, a1, place, gapsAt = []) => {
        let a = a0;
        while (a < a1 - 0.1) {
          let w = Math.min(a1 - a, rng.range(...width));
          if (a1 - (a + w) < width[0] * 0.8) w = a1 - a;
          const g = gapsAt.find((p) => p >= a - 0.01 && p < a + w);
          if (g !== undefined) {
            if (g - a > 2.5) place(a, g);
            a = g + 3;
            continue;
          }
          place(a, a + w);
          a += w;
        }
      };
      const W = lot.x1 - lot.x0;
      const D = lot.z1 - lot.z0;
      const [dN, dS, dW, dE] = [0, 1, 2, 3].map(() => rng.range(...depth));
      // Too small for a courtyard: two rows back to back, facing the streets either side
      if (W < dW + dE + 5 || D < dN + dS + 5) {
        if (W >= D) {
          const mid = lot.z0 + D * rng.range(0.42, 0.58);
          along(lot.x0, lot.x1, (a, b) => house(a, b, lot.z0, mid));
          along(lot.x0, lot.x1, (a, b) => house(a, b, mid, lot.z1));
        } else {
          const mid = lot.x0 + W * rng.range(0.42, 0.58);
          along(lot.z0, lot.z1, (a, b) => house(lot.x0, mid, a, b));
          along(lot.z0, lot.z1, (a, b) => house(mid, lot.x1, a, b));
        }
        return null;
      }
      // Alleys: 3 m gaps through the row on some sides, into the courtyard
      const gaps = { n: [], s: [], w: [], e: [] };
      const sideNames = ['n', 's', 'w', 'e'];
      for (let i = 0; i < alleys; i++) {
        const side = rng.pick(sideNames);
        const len = side === 'n' || side === 's' ? W : D;
        const margin = Math.max(dN, dS, dW, dE) + 2;
        if (len < margin * 2 + 4) continue;
        gaps[side].push((side === 'n' || side === 's' ? lot.x0 : lot.z0) + rng.range(margin, len - margin - 3));
      }
      along(lot.x0, lot.x1, (a, b) => house(a, b, lot.z0, lot.z0 + dN), gaps.n);
      along(lot.x0, lot.x1, (a, b) => house(a, b, lot.z1 - dS, lot.z1), gaps.s);
      along(lot.z0 + dN, lot.z1 - dS, (a, b) => house(lot.x0, lot.x0 + dW, a, b), gaps.w);
      along(lot.z0 + dN, lot.z1 - dS, (a, b) => house(lot.x1 - dE, lot.x1, a, b), gaps.e);
      const yard = { x0: lot.x0 + dW, x1: lot.x1 - dE, z0: lot.z0 + dN, z1: lot.z1 - dS, kind: 'courtyard', open: Object.values(gaps).some((g) => g.length) };
      level.yards.push(yard);
      if (yard.open) {
        // A little to find in there
        for (let i = 0; i < 3; i++) B.cover(rng.range(yard.x0 + 2, yard.x1 - 2), rng.range(yard.z0 + 2, yard.z1 - 2), rng.pick(COVER[level.theme]), rng.chance(0.5), 1.4);
      }
      return yard;
    },
    /** An area: one of the four places the contract is fought over. */
    area(i, rect, { start, triggerPad = 12, spawnRect = null, center = null } = {}) {
      const spec = level.mission.areas[i];
      const area = {
        index: i,
        name: spec.name,
        spec,
        x0: rect.x0,
        x1: rect.x1,
        z0: rect.z0,
        z1: rect.z1,
        center: center || { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2 },
        triggerPad, // how far outside its rectangle walking in sets it off
        start, // where you come back after going down here
        spawnRect: spawnRect || grow(rect, 6),
        spawns: [],
        objectives: [],
        gate: null, // opens when this area is taken
        boost: null,
        nest: null,
        targets: [],
        extract: null,
        bossAt: null,
        ambush: null,
      };
      level.areas[i] = area;
      return area;
    },
    /** A gun or a radar to blow up, with the spot to stand in to set the charge. */
    target(area, x, z, style) {
      B.keep(x - 4.5, x + 3, z - 2.6, z + 2.6);
      B.box(x - 1.6, x + 1.6, 0, 2.6, z - 1.6, z + 1.6, { kind: 'target', style });
      area.objectives.push({ kind: 'plant', x: x - 2.4, z, done: false, progress: 0 });
    },
    patrol(route, squad) {
      level.patrols.push({ route, squad });
    },
  };
  return B;
}

/** Scatter n things over a rectangle with a placing function that may refuse. */
function scatter(rng, rect, n, place) {
  for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) if (place(rng.range(rect.x0, rect.x1), rng.range(rect.z0, rect.z1))) i++;
}

// ------------------------------------------------------------------ the desert

/**
 * DUST DEVIL. A pueblo of painted plaster round a plaza and its church, open desert all round,
 * the road east past a gas station and farmhouses to the warlord's walled compound, and his
 * fenced landing zone behind it.
 */
function desert(level, rng) {
  const B = makeBuilder(level, rng);
  const pal = COVER.desert;
  B.bounds(-250, 250, -160, 160);
  B.start(-238, 0, 0);

  // ---- the pueblo: a grid of streets with a plaza in the middle
  const xs = [-200, -166, -136, -84, -54, -24];
  const zs = [-96, -62, -30, 0, 30, 62, 96];
  const ST = 8;
  B.road(-250, -200, -5, 5, 'road');
  B.road(-24, 111, -5, 5, 'road');
  for (const x of xs.slice(1, -1)) B.road(x - ST / 2, x + ST / 2, zs[0], zs[zs.length - 1], 'street');
  for (const z of zs.slice(1, -1)) B.road(xs[0], xs[xs.length - 1], z - ST / 2, z + ST / 2, 'street');
  const plaza = { x0: xs[2] + ST / 2, x1: xs[3] - ST / 2, z0: zs[2] + ST / 2, z1: zs[4] - ST / 2 };
  B.road(plaza.x0, plaza.x1, plaza.z0, plaza.z1, 'plaza');

  // The church on the plaza's north side, its bell tower the landmark you can see from anywhere
  B.building(-122, -98, -57, -37, 11, 'church');
  B.building(-131, -123, -45, -37, 20, 'belltower');
  B.building(-97, -88, -58, -47, 6, 'house');
  B.building(-132, -124, -58, -50, 5.2, 'house');
  // The market south of the plaza: a row of houses behind stalls
  for (let x = -132; x < -88; ) {
    const w = Math.min(-88 - x, rng.range(7, 11));
    B.building(x, x + w, 50, 58, rng.range(4.6, 7.5), 'house');
    x += w;
  }
  for (let x = -128; x < -92; x += 5.5) for (const z of [38, 44]) B.cover(x + rng.range(-0.4, 0.4), z, ['stall', 3, 1.05, 1.6], false, 1.2);

  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      if (i === 2 && j >= 1 && j <= 4) continue; // church, plaza and market
      const lot = {
        x0: xs[i] + (i > 0 ? ST / 2 : 0),
        x1: xs[i + 1] - (i < xs.length - 2 ? ST / 2 : 0),
        z0: zs[j] + (j > 0 ? ST / 2 : 0),
        z1: zs[j + 1] - (j < zs.length - 2 ? ST / 2 : 0),
      };
      const r = rng.next();
      const nearPlaza = (i === 1 || i === 3) && (j === 2 || j === 3);
      if (!nearPlaza && r < 0.14) {
        // An empty lot behind low adobe walls, a broken-down house in one corner
        level.yards.push({ ...lot, kind: 'lot', open: true });
        B.building(lot.x0, lot.x0 + rng.range(7, 10), lot.z0, lot.z0 + rng.range(6, 8), rng.range(3.2, 4.4), 'ruin');
        for (const [x0, x1, z0, z1] of [
          [lot.x0 + 12, lot.x1 - 6, lot.z1 - 0.6, lot.z1],
          [lot.x1 - 0.6, lot.x1, lot.z0 + 4, lot.z1 - 8],
        ]) {
          if (x1 - x0 > 2 && z1 - z0 > 0.3 && B.free(x0, x1, z0, z1, 0.5)) B.box(x0, x1, 0, 1.15, z0, z1, { kind: 'cover', style: 'adobe' });
        }
        B.coverField({ x0: lot.x0 + 4, x1: lot.x1 - 3, z0: lot.z0 + 9, z1: lot.z1 - 3 }, pal, { density: 0.3 });
        continue;
      }
      B.block(lot, { alleys: rng.chance(0.25) ? 2 : rng.chance(0.8) ? 1 : 0, height: nearPlaza ? [6, 10] : [4.4, 8.6] });
    }
  }
  // Palms round the plaza and along the main street
  for (const [x, z] of [[-131, -25], [-89, -25], [-131, 25], [-89, 25], [-118, -25], [-102, 25]]) B.tree(x, z, rng.range(0.9, 1.15), 0.4, { roads: true });

  // ---- outskirts: a gas station, farmhouses with walled yards, wrecks on the road
  B.road(-6, 22, -32, -5, 'yard');
  B.building(-4, 9, -31, -21, 4.2, 'shop');
  for (const [x, z] of [[1, -16], [15, -16], [1, -9], [15, -9]]) B.box(x - 0.25, x + 0.25, 0, 5, z - 0.25, z + 0.25, { kind: 'pillar', style: 'canopy' });
  level.yards.push({ x0: -1, x1: 17, z0: -18, z1: -7, kind: 'canopy' });
  B.cover(8, -12.5, ['pump', 1, 1.3, 0.6]);
  B.cover(8, -8.5, ['pump', 1, 1.3, 0.6]);
  const farm = (x, z) => {
    const w = rng.range(7, 10);
    const d = rng.range(6, 8);
    if (!B.free(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 3, { roads: false })) return false;
    B.building(x - w / 2, x + w / 2, z - d / 2, z + d / 2, rng.range(3.8, 5.4), 'house');
    // A low wall round the yard in front, with a way in
    const side = z > 0 ? -1 : 1;
    const yz = z + side * (d / 2 + 7);
    if (B.free(x - w / 2 - 2, x + w / 2 + 2, Math.min(yz, yz - side * 0.6), Math.max(yz, yz - side * 0.6), 0.5)) {
      B.box(x - w / 2 - 2, x - 1.6, 0, 1.1, Math.min(yz, yz - side * 0.6), Math.max(yz, yz - side * 0.6), { kind: 'cover', style: 'adobe' });
      B.box(x + 1.6, x + w / 2 + 2, 0, 1.1, Math.min(yz, yz - side * 0.6), Math.max(yz, yz - side * 0.6), { kind: 'cover', style: 'adobe' });
    }
    return true;
  };
  scatter(rng, { x0: -14, x1: 48, z0: 14, z1: 70 }, 4, farm);
  scatter(rng, { x0: -14, x1: 48, z0: -80, z1: -40 }, 3, farm);
  scatter(rng, { x0: -230, x1: 40, z0: 104, z1: 150 }, 3, farm);
  scatter(rng, { x0: -230, x1: 40, z0: -150, z1: -104 }, 3, farm);
  B.cover(6, -2.2, ['car', 4.4, 1.3, 2]);
  B.cover(24, 2.4, ['car', 4.4, 1.3, 2]);

  // ---- 0: THE VILLAGE (the plaza)
  const a0 = B.area(0, { x0: -140, x1: -80, z0: -34, z1: 34 }, { start: { x: -238, z: 0 }, triggerPad: 14 });
  B.cover(-110, 0, ['fountain', 4.4, 0.9, 4.4], false, 1.2);
  B.coverField({ x0: -134, x1: -86, z0: -24, z1: 24 }, pal, { density: 0.5 });

  // ---- 1: OUTER WALL, and 2: THE COMPOUND behind it
  const C = { x0: 113, x1: 195, z0: -49, z1: 49 };
  const a1 = B.area(1, { x0: 56, x1: 111, z0: -48, z1: 48 }, { start: { x: 34, z: 0 }, spawnRect: { x0: 74, x1: 110, z0: -46, z1: 46 } });
  B.keep(103, 112, -6, 6);
  const walls = B.compound(C, { gate: { side: 'x1', at: 0, width: 8 }, boost: { side: 'x0', at: 0, width: 12 } });
  a1.boost = { x: 110.6, z: 0, landing: { x: 115, z: 0 }, wall: walls.boostwall };
  for (const lineX of [80, 96]) {
    for (let z = -40; z < 40; z += rng.range(6.5, 8.5)) {
      if (Math.abs(z + 2) < 4) continue;
      if (B.free(lineX - 0.4, lineX + 0.4, z, z + 4, 0.8)) B.box(lineX - 0.4, lineX + 0.4, 0, 1, z, z + 4, { kind: 'cover', style: 'sandbags' });
    }
  }
  B.building(100, 108, -45, -37, 3.6, 'shed');
  B.building(97, 106, 32, 40, 3.6, 'shed');
  B.cover(66, -20, ['car', 4.4, 1.3, 2], true);
  B.cover(70, 24, ['car', 4.4, 1.3, 2]);
  B.coverField({ x0: 60, x1: 104, z0: -44, z1: 44 }, pal, { density: 0.3 });

  const a2 = B.area(2, C, { start: { x: 116, z: 0 }, triggerPad: 0, spawnRect: { x0: 124, x1: 194, z0: -48, z1: 48 } });
  a2.gate = walls.gate;
  B.keep(113, 122, -6, 6);
  B.keep(188, 196, -6, 6);
  B.building(124, 140, -47, -38, 4.2, 'barracks');
  B.building(168, 188, 38, 47, 4.2, 'barracks');
  B.building(176, 193, -47, -33, 5, 'garage');
  B.target(a2, 146, -20, 'aagun');
  B.target(a2, 170, 18, 'aagun');
  B.coverField({ x0: 118, x1: 192, z0: -46, z1: 46 }, pal, { density: 0.55 });
  B.keep(C.x0, C.x1, C.z0, C.z1); // nothing more goes in once it's dressed

  // ---- 3: LANDING ZONE, fenced, through the compound's east gate
  const L = { x0: 197, x1: 247, z0: -58, z1: 58 };
  B.compound({ x0: 196, x1: 248, z0: -59, z1: 59 }, { style: 'fence', open: ['x0'] });
  B.wall(195, 196, -60, -50, WALL_H, 'fence');
  B.wall(195, 196, 50, 60, WALL_H, 'fence');
  const a3 = B.area(3, L, { start: { x: 200, z: 0 }, triggerPad: 0, spawnRect: { x0: 205, x1: 246, z0: -56, z1: 56 } });
  a3.extract = { x: 228, z: 0 };
  a3.bossAt = { x: 236, z: 24 };
  B.keep(220, 236, -8, 8);
  B.keep(196, 206, -6, 6);
  B.building(206, 224, -56, -42, 7, 'hangar');
  B.building(232, 238, 40, 46, 3.2, 'tank');
  B.building(240, 246, 40, 46, 3.2, 'tank');
  B.coverField({ x0: 200, x1: 245, z0: -40, z1: 54 }, pal, { density: 0.45 });
  B.keep(L.x0, L.x1, L.z0, L.z1);

  // ---- the open desert: boulders, scrub and the odd ruin
  B.rocks({ x0: -245, x1: 245, z0: -155, z1: -100 }, 45);
  B.rocks({ x0: -245, x1: 245, z0: 100, z1: 155 }, 45);
  B.rocks({ x0: -20, x1: 105, z0: -100, z1: 100 }, 30);
  B.rocks({ x0: 196, x1: 245, z0: -155, z1: -62 }, 12);
  B.rocks({ x0: 196, x1: 245, z0: 62, z1: 155 }, 12);
  B.rocks({ x0: -245, x1: -205, z0: -100, z1: 100 }, 14);
  scatter(rng, { x0: -240, x1: 240, z0: -150, z1: 150 }, 30, (x, z) => B.tree(x, z, rng.range(0.9, 1.25), 3));

  B.patrol([{ x: -18, z: -2 }, { x: 46, z: -2 }], ['rifleman', 'rifleman']);
  B.patrol([{ x: -166, z: -62 }, { x: -166, z: 62 }, { x: -54, z: 62 }, { x: -54, z: -62 }], ['rifleman', 'shotgunner']);
  B.patrol([{ x: 10, z: -90 }, { x: 70, z: -120 }, { x: 100, z: -75 }], ['rifleman', 'rifleman']);
  void a0;
}

// ------------------------------------------------------------------ the port

/**
 * LOW TIDE. A night port: Dock Road east from the gate, a container yard of stacked boxes and
 * lanes, the gantry cranes on the quay, the warehouse district, a truck depot, and the fenced
 * pier at the far end where the ships are tied up.
 */
function port(level, rng) {
  const B = makeBuilder(level, rng);
  const pal = COVER.port;
  B.bounds(-210, 232, -170, 132);
  B.start(-202, -38, 0);
  B.road(-210, 232, -44, -32, 'road');
  B.road(-62, -52, -170, 96, 'road');
  B.road(52, 62, -170, 96, 'road');
  B.road(196, 206, -32, -24, 'road');
  B.road(-210, 168, 96, 132, 'quay');

  /** Container stacks in blocks with lanes between, skipping kept ground. */
  const yard = (rect, { blockZ = [10, 15], laneX = [6, 9], laneZ = [7, 10], skip = 0.15, high = [1, 3] } = {}) => {
    for (let x = rect.x0; x < rect.x1 - 12; x += 12.2 + rng.range(...laneX)) {
      for (let z = rect.z0; z < rect.z1 - 5; ) {
        const d = Math.min(rect.z1 - z, rng.range(...blockZ));
        if (!rng.chance(skip) && d > 4) {
          // Stacks side by side, each its own height
          for (let zz = z; zz < z + d - 2.4; zz += 2.5) {
            const n = rng.int(...high);
            if (B.free(x, x + 12.2, zz, zz + 2.45, 0, { roads: false })) B.building(x, x + 12.2, zz, zz + 2.45, n * 2.6, 'container');
          }
        }
        z += d + rng.range(...laneZ);
      }
    }
  };

  // ---- 0: CONTAINER YARD, a clearing among the stacks
  const r0 = { x0: -158, x1: -98, z0: -6, z1: 66 };
  B.area(0, r0, { start: { x: -202, z: -38 }, triggerPad: 12 });
  // Inside the clearing: a few boxes dropped where they were unloaded, and cover
  for (const [x, z, turn] of [[-142, 12, false], [-118, 40, true], [-108, 6, false], [-140, 52, true]]) {
    const [lx, lz] = turn ? [2.45, 12.2] : [12.2, 2.45];
    B.building(x - lx / 2, x + lx / 2, z - lz / 2, z + lz / 2, 2.6, 'container');
  }
  B.coverField(r0, pal, { density: 0.5 });
  B.keep(r0.x0, r0.x1, r0.z0, r0.z1);
  yard({ x0: -205, x1: -64, z0: -28, z1: 92 });

  // ---- 1: THE GANTRIES, on the quay
  const r1 = { x0: -44, x1: 50, z0: 62, z1: 130 };
  const a1 = B.area(1, r1, { start: { x: -57, z: 64 }, triggerPad: 8 });
  a1.nest = { x: -38.5, z: 92, y: 4 };
  B.box(-41, -36, 0, 4, 88, 95, { kind: 'tower', style: 'tower' });
  for (const tz of [72, 86, 106, 120]) {
    const tx = 26 + rng.range(-2, 2);
    B.box(tx - 1.5, tx + 1.5, 0, 7, tz - 1.5, tz + 1.5, { kind: 'tower', style: 'tower' });
    a1.targets.push({ x: tx, y: 7, z: tz });
  }
  level.cranes = [];
  for (const cx of [-180, -132, -84, -12, 32, 82, 130]) {
    for (const dx of [-6, 6]) for (const z of [99, 127]) B.box(cx + dx - 0.6, cx + dx + 0.6, 0, 30, z - 0.6, z + 0.6, { kind: 'block', style: 'craneleg' });
    level.cranes.push({ x: cx, z0: 99, z1: 127 });
  }
  B.coverField({ x0: -30, x1: 20, z0: 68, z1: 126 }, pal, { density: 0.3, rows: [8, 12] });
  B.coverField({ x0: 22, x1: 48, z0: 64, z1: 128 }, pal, { density: 0.45 });

  // ---- 2: WAREHOUSE, a yard among the sheds
  const r2 = { x0: 96, x1: 134, z0: -132, z1: -66 };
  const a2 = B.area(2, r2, { start: { x: 57, z: -80 }, triggerPad: 10 });
  a2.objectives.push({ kind: 'rescue', x: 114, z: -98, done: false, progress: 0 });
  B.keep(108, 120, -104, -92);
  B.building(68, 94, -162, -138, 10, 'warehouse');
  B.building(104, 154, -164, -142, 11, 'warehouse');
  B.building(68, 92, -128, -60, 9, 'warehouse');
  B.building(138, 160, -122, -58, 10, 'warehouse');
  B.coverField(r2, pal, { density: 0.5 });

  // ---- 3: THE DOCKS, fenced off at the end of the quay
  const r3 = { x0: 170, x1: 229, z0: -22, z1: 129 };
  const fence = B.compound({ x0: 169, x1: 236, z0: -23, z1: 136 }, { style: 'fence', open: ['x1', 'z1'], gate: { side: 'z0', at: 201, width: 10 } });
  a2.gate = fence.gate;
  const a3 = B.area(3, r3, { start: { x: 201, z: -30 }, triggerPad: 0, spawnRect: { x0: 172, x1: 228, z0: -20, z1: 128 } });
  a3.ambush = { x: 198, z: 46 };
  a3.extract = { x: 210, z: 112 };
  a3.bossAt = { x: 216, z: 74 };
  B.keep(180, 216, 28, 64);
  B.keep(202, 218, 104, 120);
  B.keep(196, 206, -24, -16);
  yard({ x0: 172, x1: 228, z0: -18, z1: 18 }, { skip: 0.35, high: [1, 2] });
  B.building(214, 228, 76, 88, 4.5, 'office');
  for (let z = -10; z < 128; z += 9) B.cover(229.2, z, ['bollard', 0.6, 0.8, 0.6], false, 0.4);
  B.coverField({ x0: 172, x1: 228, z0: 20, z1: 128 }, pal, { density: 0.4 });
  B.keep(r3.x0, r3.x1, r3.z0, r3.z1);

  // ---- the rest of the port
  yard({ x0: 66, x1: 166, z0: -28, z1: 92 }, { skip: 0.25 });
  yard({ x0: -205, x1: -66, z0: -166, z1: -50 }, { skip: 0.3, high: [1, 2] });
  yard({ x0: -205, x1: -50, z0: 100, z1: 128 }, { skip: 0.5, high: [1, 2], blockZ: [8, 10] });
  B.building(-46, -10, -162, -122, 9, 'warehouse');
  B.building(0, 46, -150, -112, 10, 'warehouse');
  B.building(-40, -20, -100, -82, 7, 'office');
  B.building(8, 40, -96, -70, 8, 'warehouse');
  B.building(166, 226, -166, -150, 8, 'warehouse');
  for (const [x, z] of [[180, -120], [196, -120], [212, -120], [180, -100], [196, -100], [212, -100]]) B.building(x - 5, x + 5, z - 5, z + 5, 9, 'tank');
  // The middle: trailers waiting for loads, forklifts, a site office
  for (let x = -44; x < 44; x += rng.range(16, 22)) {
    for (const z of [-20, 10, 40]) {
      if (rng.chance(0.3)) continue;
      const zz = z + rng.range(-3, 3);
      if (B.free(x, x + 12, zz, zz + 2.5, 2, { roads: false })) B.building(x, x + 12, zz, zz + 2.5, 3.9, 'trailer');
    }
  }
  B.building(-18, -4, -26, -16, 5, 'office');
  B.coverField({ x0: -48, x1: 48, z0: -28, z1: 58 }, pal, { density: 0.25, rows: [9, 14] });
  B.coverField({ x0: 64, x1: 166, z0: -165, z1: -46 }, pal, { density: 0.15, rows: [10, 14] });

  B.patrol([{ x: -40, z: -38 }, { x: 150, z: -38 }], ['rifleman', 'rifleman']);
  B.patrol([{ x: -57, z: -160 }, { x: -57, z: -50 }], ['rifleman', 'shotgunner']);
  B.patrol([{ x: 60, z: 110 }, { x: 160, z: 110 }], ['rifleman', 'rifleman']);
}

// ------------------------------------------------------------------ the mountain

/**
 * WHITEOUT. A snowbound valley under the peaks: the road climbs from a checkpoint through pine
 * woods to a line of bunkers, the walled radar base beyond them, and up behind a rock ridge the
 * summit pad, reached only through the base's north gate.
 */
function snow(level, rng) {
  const B = makeBuilder(level, rng);
  const pal = COVER.snow;
  B.bounds(-230, 230, -180, 180);
  B.start(-222, 130, 0);
  B.road(-230, -54, 124, 136, 'road');
  B.road(-66, -54, -6, 136, 'road');
  B.road(-66, 40, -6, 6, 'road');
  B.road(116, 126, -150, -70, 'road');

  // ---- 0: CHECKPOINT on the road
  const r0 = { x0: -150, x1: -96, z0: 98, z1: 162 };
  B.area(0, r0, { start: { x: -222, z: 130 }, triggerPad: 12 });
  B.cover(-121, 126.5, ['barrier', 2.6, 1.1, 0.6], true, 0.6);
  B.cover(-117, 133.5, ['barrier', 2.6, 1.1, 0.6], true, 0.6);
  B.building(-131, -125, 112, 118, 3, 'hut');
  B.building(-113, -107, 142, 148, 3, 'hut');
  B.building(-142, -130, 142, 146, 3.9, 'trailer');
  B.coverField(r0, pal, { density: 0.45 });

  // ---- 1: THE BUNKERS, and 2: the RADAR FIELD behind the base wall
  const base = { x0: 41, x1: 139, z0: -69, z1: 39 };
  const a1 = B.area(1, { x0: -26, x1: 39, z0: -44, z1: 44 }, { start: { x: -60, z: 20 }, spawnRect: { x0: 2, x1: 38, z0: -42, z1: 42 } });
  B.keep(32, 41, -6, 6);
  const walls = B.compound(base, { gate: { side: 'z0', at: 121, width: 10 }, boost: { side: 'x0', at: 0, width: 12 } });
  a1.boost = { x: 38.6, z: 0, landing: { x: 43, z: 0 }, wall: walls.boostwall };
  B.building(-10, -2, -34, -26, 3, 'bunker');
  B.building(8, 16, 22, 30, 3, 'bunker');
  B.building(20, 28, -22, -14, 3, 'bunker');
  for (const lineX of [-14, 12]) {
    for (let z = -38; z < 38; z += rng.range(6.5, 8.5)) {
      if (Math.abs(z + 2) < 4) continue;
      if (B.free(lineX - 0.4, lineX + 0.4, z, z + 4, 0.8)) B.box(lineX - 0.4, lineX + 0.4, 0, 1, z, z + 4, { kind: 'cover', style: 'sandbags' });
    }
  }
  B.coverField({ x0: -22, x1: 36, z0: -40, z1: 40 }, pal, { density: 0.3 });

  const a2 = B.area(2, base, { start: { x: 44, z: 0 }, triggerPad: 0, spawnRect: { x0: 50, x1: 138, z0: -68, z1: 38 } });
  a2.gate = walls.gate;
  B.keep(41, 50, -6, 6);
  B.keep(114, 128, -69, -60);
  B.target(a2, 72, -40, 'radar');
  B.target(a2, 112, 14, 'radar');
  B.building(54, 70, 22, 36, 5, 'bunker');
  B.building(88, 110, -67, -57, 4.2, 'barracks');
  B.building(128, 137, 20, 30, 3.4, 'tank');
  B.coverField({ x0: 46, x1: 136, z0: -66, z1: 36 }, pal, { density: 0.5 });
  B.keep(base.x0, base.x1, base.z0, base.z1);

  // ---- 3: THE SUMMIT, behind the ridge
  for (let z = -180; z < -69; ) {
    const len = Math.min(-69 - z, rng.range(8, 14));
    B.box(94 + rng.range(-1, 0.5), 100, 0, rng.range(6, 11), z, z + len, { kind: 'rock', style: 'cliff' });
    z += len;
  }
  for (let x = 140; x < 232; ) {
    const len = Math.min(232 - x, rng.range(8, 14));
    B.box(x, x + len, 0, rng.range(6, 11), -76, -70 + rng.range(-0.5, 0.5), { kind: 'rock', style: 'cliff' });
    x += len;
  }
  const a3 = B.area(3, { x0: 132, x1: 222, z0: -172, z1: -92 }, { start: { x: 121, z: -80 }, triggerPad: 0, spawnRect: { x0: 140, x1: 222, z0: -172, z1: -96 } });
  a3.extract = { x: 200, z: -150 };
  a3.bossAt = { x: 182, z: -118 };
  B.keep(192, 208, -158, -142);
  B.building(150, 166, -164, -150, 5, 'bunker');
  B.coverField({ x0: 136, x1: 220, z0: -168, z1: -96 }, pal, { density: 0.45 });
  B.keep(132, 222, -172, -92);

  // ---- the valley: pine woods, boulders, a few cabins
  const woods = [
    [{ x0: -226, x1: -74, z0: -176, z1: 84 }, 170],
    [{ x0: -48, x1: 90, z0: -176, z1: -74 }, 70],
    [{ x0: -40, x1: 226, z0: 56, z1: 176 }, 110],
    [{ x0: 146, x1: 226, z0: -62, z1: 50 }, 50],
    [{ x0: 104, x1: 226, z0: -176, z1: -84 }, 30],
  ];
  // Stands of trees with clearings between them, and a few strays
  for (const [rect, n] of woods) {
    const stands = Math.max(3, Math.round(n / 16));
    for (let k = 0; k < stands; k++) {
      const cx = rng.range(rect.x0, rect.x1);
      const cz = rng.range(rect.z0, rect.z1);
      const r = rng.range(9, 24);
      for (let i = 0; i < (n / stands) * 1.3; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * r;
        B.tree(cx + Math.cos(a) * d, cz + Math.sin(a) * d, rng.range(0.75, 1.35), 1.6);
      }
    }
    scatter(rng, rect, Math.round(n * 0.15), (x, z) => B.tree(x, z, rng.range(0.7, 1.2), 2));
  }
  B.rocks({ x0: -226, x1: 226, z0: -176, z1: 176 }, 90, { big: 0.5 });
  scatter(rng, { x0: -200, x1: -100, z0: -150, z1: 60 }, 3, (x, z) => (B.free(x - 5, x + 5, z - 4, z + 4, 3) ? !!B.building(x - 5, x + 5, z - 4, z + 4, 4, 'cabin') : false));

  B.patrol([{ x: -60, z: 112 }, { x: -60, z: 14 }], ['rifleman', 'rifleman']);
  B.patrol([{ x: -180, z: -60 }, { x: -110, z: -120 }, { x: -86, z: -40 }], ['rifleman', 'rifleman']);
  B.patrol([{ x: 170, z: 70 }, { x: 210, z: 150 }, { x: 160, z: 150 }], ['rifleman', 'shotgunner']);
}

export const MAPS = { desert, port, snow };
