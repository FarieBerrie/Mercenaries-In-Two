// Getting around the open maps. The ground is cut into half-metre cells, each open or blocked
// (blocked where a box stands, grown by a body's width). Paths are found with A* over those cells
// and pulled tight into a few straight legs; anyone walking somewhere asks navDir for the way,
// which goes straight at the goal when nothing's in between and follows a path when something is.

const RES = 0.5; // metres per cell
const INFLATE = 0.45; // a body's radius and a little more
const STEP_UP = 0.35;
const SQRT2 = Math.SQRT2;

/** Marks which cells can be walked. Called when the level is built and when a gate opens. */
export function rebuildNav(level) {
  const { x0, x1, z0, z1 } = level.bounds;
  const nx = Math.ceil((x1 - x0) / RES);
  const nz = Math.ceil((z1 - z0) / RES);
  const n = nx * nz;
  const old = level.nav;
  const nav = old && old.nx === nx && old.nz === nz ? old : { x0, z0, nx, nz, blocked: new Uint8Array(n), g: new Float32Array(n), from: new Int32Array(n), seen: new Uint32Array(n), shut: new Uint32Array(n), gen: 0, heap: new Int32Array(1 << 16), heapF: new Float32Array(1 << 16) };
  const blocked = nav.blocked;
  blocked.fill(0);
  for (const b of level.boxes) {
    if (b.y1 <= STEP_UP || b.y0 > 1.7) continue; // kerbs you step onto; things overhead
    // Cells whose centres are within INFLATE of the box
    const c0 = Math.max(0, Math.ceil((b.x0 - INFLATE - x0) / RES - 0.5));
    const c1 = Math.min(nx - 1, Math.floor((b.x1 + INFLATE - x0) / RES - 0.5));
    const r0 = Math.max(0, Math.ceil((b.z0 - INFLATE - z0) / RES - 0.5));
    const r1 = Math.min(nz - 1, Math.floor((b.z1 + INFLATE - z0) / RES - 0.5));
    for (let r = r0; r <= r1; r++) blocked.fill(1, r * nx + c0, r * nx + c1 + 1);
  }
  // The edge of the map
  const edge = Math.ceil(1 / RES);
  for (let r = 0; r < nz; r++) {
    for (let c = 0; c < nx; c++) if (r < edge || c < edge || r >= nz - edge || c >= nx - edge) blocked[r * nx + c] = 1;
  }
  label(nav);
  level.nav = nav;
}

/** Numbers each connected patch of open ground, so "can I get there at all?" is one lookup. */
function label(nav) {
  const { nx, nz, blocked } = nav;
  const n = nx * nz;
  if (!nav.region || nav.region.length !== n) {
    nav.region = new Int32Array(n);
    nav.queue = new Int32Array(n);
  }
  const region = nav.region;
  const queue = nav.queue;
  region.fill(0);
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (blocked[start] || region[start]) continue;
    next++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    region[start] = next;
    while (head < tail) {
      const i = queue[head++];
      const c = i % nx;
      if (c > 0 && !blocked[i - 1] && !region[i - 1]) {
        region[i - 1] = next;
        queue[tail++] = i - 1;
      }
      if (c < nx - 1 && !blocked[i + 1] && !region[i + 1]) {
        region[i + 1] = next;
        queue[tail++] = i + 1;
      }
      if (i >= nx && !blocked[i - nx] && !region[i - nx]) {
        region[i - nx] = next;
        queue[tail++] = i - nx;
      }
      if (i < n - nx && !blocked[i + nx] && !region[i + nx]) {
        region[i + nx] = next;
        queue[tail++] = i + nx;
      }
    }
  }
}

/** Is there any way on foot from a to b (with the gates as they are now)? */
export function reachable(level, a, b) {
  const nav = level.nav;
  const ia = nearestOpen(nav, cellOf(nav, a), 12);
  const ib = nearestOpen(nav, cellOf(nav, b), 12);
  return ia >= 0 && ib >= 0 && nav.region[ia] === nav.region[ib];
}

const cellOf = (nav, p) => {
  const c = Math.floor((p.x - nav.x0) / RES);
  const r = Math.floor((p.z - nav.z0) / RES);
  return c < 0 || r < 0 || c >= nav.nx || r >= nav.nz ? -1 : r * nav.nx + c;
};
const centre = (nav, i) => ({ x: nav.x0 + ((i % nav.nx) + 0.5) * RES, z: nav.z0 + (Math.floor(i / nav.nx) + 0.5) * RES });

/** Is this spot open ground a body could stand on? */
export function standable(level, p) {
  const i = cellOf(level.nav, p);
  return i >= 0 && !level.nav.blocked[i];
}

/** The open cell nearest to cell i, searching out to `radius` cells; -1 if there's none. */
function nearestOpen(nav, i, radius = 8) {
  if (i < 0) return -1;
  if (!nav.blocked[i]) return i;
  const c0 = i % nav.nx;
  const r0 = Math.floor(i / nav.nx);
  for (let k = 1; k <= radius; k++) {
    let best = -1;
    let bestD = Infinity;
    for (let dr = -k; dr <= k; dr++) {
      for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue;
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || r < 0 || c >= nav.nx || r >= nav.nz) continue;
        const j = r * nav.nx + c;
        if (nav.blocked[j]) continue;
        const d = dc * dc + dr * dr;
        if (d < bestD) {
          best = j;
          bestD = d;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** The nearest standable spot to p (p itself if it's open), or null. */
export function nearestStandable(level, p, radius = 6) {
  const i = nearestOpen(level.nav, cellOf(level.nav, p), Math.ceil(radius / RES));
  if (i < 0) return null;
  return level.nav.blocked[cellOf(level.nav, p)] === 0 ? { x: p.x, z: p.z } : centre(level.nav, i);
}

/** Can a body walk in a straight line from a to b? (Every cell the line crosses is open.) */
export function walkable(level, a, b) {
  const nav = level.nav;
  const ax = (a.x - nav.x0) / RES;
  const az = (a.z - nav.z0) / RES;
  const bx = (b.x - nav.x0) / RES;
  const bz = (b.z - nav.z0) / RES;
  let c = Math.floor(ax);
  let r = Math.floor(az);
  const cEnd = Math.floor(bx);
  const rEnd = Math.floor(bz);
  const dx = bx - ax;
  const dz = bz - az;
  const stepC = dx > 0 ? 1 : -1;
  const stepR = dz > 0 ? 1 : -1;
  let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? c + 1 : c) - ax) / dx;
  let tMaxZ = Math.abs(dz) < 1e-9 ? Infinity : ((dz > 0 ? r + 1 : r) - az) / dz;
  const tDX = Math.abs(dx) < 1e-9 ? Infinity : 1 / Math.abs(dx);
  const tDZ = Math.abs(dz) < 1e-9 ? Infinity : 1 / Math.abs(dz);
  const open = (cc, rr) => cc >= 0 && rr >= 0 && cc < nav.nx && rr < nav.nz && !nav.blocked[rr * nav.nx + cc];
  // The start cell may be blocked (someone hugging a wall), and so may the goal's own cell (a
  // spot tight against cover): only the cells in between have to be open
  for (let n = 0; n < 4000; n++) {
    if (c === cEnd && r === rEnd) return true;
    if (tMaxX < tMaxZ) {
      c += stepC;
      tMaxX += tDX;
    } else {
      r += stepR;
      tMaxZ += tDZ;
    }
    if (c === cEnd && r === rEnd) return true;
    if (!open(c, r)) return false;
  }
  return false;
}

/**
 * A walkable path from `from` to `to` as a list of points (the last one the goal, or the open
 * spot nearest it), or null if there's no way there. maxExpand bounds the search.
 */
export function findPath(level, from, to, maxExpand = 90000) {
  const nav = level.nav;
  const s = nearestOpen(nav, cellOf(nav, from), 6);
  const goalCell = cellOf(nav, to);
  const g = nearestOpen(nav, goalCell, 12);
  if (s < 0 || g < 0) return null;
  // A goal tucked against something is still where we're going, as long as it's within reach
  const near = centre(nav, g);
  const goal = Math.hypot(near.x - to.x, near.z - to.z) < 1.0 ? { x: to.x, z: to.z } : near;
  if (s === g) return [goal];
  const { nx, blocked } = nav;
  const gen = ++nav.gen;
  const gx = g % nx;
  const gz = Math.floor(g / nx);
  const h = (i) => {
    const dx = Math.abs((i % nx) - gx);
    const dz = Math.abs(Math.floor(i / nx) - gz);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * 1.2;
  };
  // A binary heap of cells by f
  let heap = nav.heap;
  let heapF = nav.heapF;
  let size = 0;
  const push = (i, f) => {
    if (size >= heap.length) {
      const nh = new Int32Array(heap.length * 2);
      const nf = new Float32Array(heap.length * 2);
      nh.set(heap);
      nf.set(heapF);
      heap = nav.heap = nh;
      heapF = nav.heapF = nf;
    }
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p] <= f) break;
      heap[k] = heap[p];
      heapF[k] = heapF[p];
      k = p;
    }
    heap[k] = i;
    heapF[k] = f;
  };
  const pop = () => {
    const top = heap[0];
    const last = heap[--size];
    const lf = heapF[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heap[k] = heap[c];
      heapF[k] = heapF[c];
      k = c;
    }
    heap[k] = last;
    heapF[k] = lf;
    return top;
  };
  nav.seen[s] = gen;
  nav.g[s] = 0;
  nav.from[s] = -1;
  push(s, h(s));
  let found = false;
  for (let expanded = 0; size > 0 && expanded < maxExpand; expanded++) {
    const i = pop();
    if (i === g) {
      found = true;
      break;
    }
    if (nav.shut[i] === gen) continue;
    nav.shut[i] = gen;
    const c = i % nx;
    const r = Math.floor(i / nx);
    const gi = nav.g[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc;
        const rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= nx || rr >= nav.nz) continue;
        const j = rr * nx + cc;
        if (blocked[j] || nav.shut[j] === gen) continue;
        // No cutting corners past a blocked cell
        if (dr && dc && (blocked[r * nx + cc] || blocked[rr * nx + c])) continue;
        const ng = gi + (dr && dc ? SQRT2 : 1);
        if (nav.seen[j] === gen && ng >= nav.g[j]) continue;
        nav.seen[j] = gen;
        nav.g[j] = ng;
        nav.from[j] = i;
        push(j, ng + h(j));
      }
    }
  }
  if (!found) return null;
  // Walk back, then pull the path tight: keep only the corners you can't see past
  const cells = [];
  for (let i = g; i !== -1; i = nav.from[i]) cells.push(i);
  cells.reverse();
  const pts = cells.map((i) => centre(nav, i));
  pts[pts.length - 1] = goal;
  const out = [];
  let anchor = { x: from.x, z: from.z };
  let k = 0;
  while (k < pts.length - 1) {
    // The furthest point still in a straight, open line from the anchor: a coarse look back from
    // the far end first, then step on one at a time
    let far = k + 1;
    for (let j = pts.length - 1; j > k + 1; j -= Math.max(1, Math.floor((j - k) / 8))) {
      if (walkable(level, anchor, pts[j])) {
        far = j;
        break;
      }
    }
    while (far + 1 < pts.length && walkable(level, anchor, pts[far + 1])) far++;
    out.push(pts[far]);
    anchor = pts[far];
    k = far;
  }
  return out.length ? out : [goal];
}

/**
 * Which way to walk from an agent toward a goal, around whatever's in the way. The route is kept
 * on the agent (agent.nav) and worked out again when the goal moves or every so often.
 * Returns { x, z, d }: a unit direction (zero when there) and the distance left to the goal.
 */
export function navDir(level, agent, goal, frame) {
  const dx = goal.x - agent.x;
  const dz = goal.z - agent.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return { x: 0, z: 0, d };
  let nav = agent.nav;
  if (!nav || nav.level !== level) nav = agent.nav = { level, goal: null, path: null, i: 0, at: -1e9, direct: true, last: { x: agent.x, z: agent.z }, still: 0 };
  // Stuck against something for a while: think again
  const moved = Math.hypot(agent.x - nav.last.x, agent.z - nav.last.z);
  nav.still = moved < 0.02 ? nav.still + 1 : 0;
  nav.last = { x: agent.x, z: agent.z };
  const goalMoved = !nav.goal || Math.hypot(goal.x - nav.goal.x, goal.z - nav.goal.z) > Math.max(1.2, d * 0.12);
  if (goalMoved || frame - nav.at > 60 || nav.still === 20) {
    nav.goal = { x: goal.x, z: goal.z };
    nav.at = frame;
    nav.direct = d < 1.5 || walkable(level, agent, goal);
    nav.path = nav.direct || !reachable(level, agent, goal) ? null : findPath(level, agent, goal);
    nav.i = 0;
  }
  let tx = goal.x;
  let tz = goal.z;
  if (!nav.direct && nav.path) {
    const path = nav.path;
    while (nav.i < path.length - 1 && Math.hypot(path[nav.i].x - agent.x, path[nav.i].z - agent.z) < 0.7) nav.i++;
    // Look one leg ahead: if the next corner is already in sight, cut to it
    if (nav.i < path.length - 1 && frame % 8 === 0 && walkable(level, agent, path[nav.i + 1])) nav.i++;
    tx = path[nav.i].x;
    tz = path[nav.i].z;
  }
  const wx = tx - agent.x;
  const wz = tz - agent.z;
  const wl = Math.hypot(wx, wz) || 1;
  return { x: wx / wl, z: wz / wl, d };
}
