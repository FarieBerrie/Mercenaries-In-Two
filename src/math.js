// Small vector helpers on plain {x, y, z} objects, so the game logic needs no 3D library.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Horizontal distance between two bodies (feet positions). */
export const distXZ = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/** Unit vector for a heading angle: yaw 0 faces +x, yaw π/2 faces +z. */
export const dirOf = (yaw) => ({ x: Math.cos(yaw), z: Math.sin(yaw) });
export const yawTo = (from, to) => Math.atan2(to.z - from.z, to.x - from.x);

/** Signed smallest difference between two angles, in -π..π. */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turns angle `a` toward `b` by at most `step`. */
export function turnToward(a, b, step) {
  const d = angleDiff(a, b);
  return a + clamp(d, -step, step);
}

/** Moves a 2D velocity (vx, vz) toward a target by at most `step` in length. */
export function approach2(vx, vz, tx, tz, step) {
  const dx = tx - vx;
  const dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= step || d === 0) return [tx, tz];
  return [vx + (dx / d) * step, vz + (dz / d) * step];
}

/** Distance from point p to the segment a→b (all {x, y, z}). */
export function pointSegmentDistance(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

/**
 * Where a ray from `o` along `d` first enters an axis-aligned box, as a distance along the
 * ray (in units of |d|), or Infinity if it misses. Rays starting inside return 0.
 */
export function rayBox(o, d, box) {
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
}

/**
 * Where a ray from `o` along `d` first enters a standing body: a vertical cylinder of radius r
 * from y0 to y0 + h around (cx, cz). Returns the distance along the ray in units of |d|, or
 * Infinity.
 */
export function rayCylinder(o, d, cx, y0, cz, r, h) {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let best = Infinity;
  if (a > 1e-12) {
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0) continue;
        const y = o.y + d.y * t;
        if (y >= y0 && y <= y0 + h) {
          best = Math.min(best, t);
          break;
        }
      }
    }
  }
  // Through the top or bottom cap
  for (const capY of [y0, y0 + h]) {
    if (Math.abs(d.y) < 1e-12) continue;
    const t = (capY - o.y) / d.y;
    if (t < 0 || t >= best) continue;
    const x = ox + d.x * t;
    const z = oz + d.z * t;
    if (x * x + z * z <= r * r) best = t;
  }
  return best;
}
