// An autopilot that plays Hatch: for the title-screen demo and for testing that every mission
// can be finished. It speaks the same input interface as the keyboard and mouse.
import { chest, ENEMY_TYPES, eye } from './actors.js';
import { areaAt } from './level.js';
import { angleDiff, distXZ } from './math.js';

export function createBot() {
  let game = null;
  let held = new Set();
  let prev = new Set();
  let wish = { x: 0, z: 0 };
  let look = { x: 0, y: 0 };
  let stuck = 0;
  let sidestep = 0;
  let last = { x: 0, z: 0 };
  let unseen = 0;
  let stalled = 0; // frames spent near an armoured enemy without a shot at it

  function aimAt(p, point) {
    const e = eye(p);
    const yaw = Math.atan2(point.z - e.z, point.x - e.x);
    const pitch = Math.atan2(point.y - e.y, Math.hypot(point.x - e.x, point.z - e.z));
    const dy = angleDiff(p.aimYaw, yaw);
    const dp = pitch - p.aimPitch;
    look = { x: Math.max(-0.25, Math.min(0.25, dy)), y: Math.max(-0.1, Math.min(0.1, -dp)) };
    // On target to within about 30 cm at that range
    const tol = Math.min(0.05, 0.3 / Math.max(1, Math.hypot(point.x - e.x, point.z - e.z)));
    return Math.abs(dy) < tol && Math.abs(dp) < tol * 2;
  }

  /** Where Hatch should be heading next. */
  function destination(p) {
    const level = game.level;
    const i = areaAt(level, p.x);
    const area = level.areas[i];
    const st = game.areas[i];
    const todo = area.objectives.find((o) => !o.done);
    if (todo) return todo;
    if (st.cleared) {
      if (area.boost) return area.boost;
      if (area.extract) return area.extract;
      return { x: area.x1 + 6, z: 0 };
    }
    if (area.nest && game.enemiesIn(i).some((e) => e.tower)) return area.nest;
    // Armoured enemies only take damage from the side or back: go round them.
    const heavy = game.enemies.find((e) => !e.dead && e.area === i && ENEMY_TYPES[e.type].armored);
    if (heavy) {
      const behind = { x: heavy.x - Math.cos(heavy.yaw) * 9, z: heavy.z - Math.sin(heavy.yaw) * 9 };
      behind.z = Math.max(-level.halfWidth + 2, Math.min(level.halfWidth - 2, behind.z));
      return behind;
    }
    const foe = game.enemies.find((e) => !e.dead && e.area === i);
    // Hold at a fighting distance, but go and flush them out if they've gone quiet
    if (foe) return distXZ(p, foe) > 14 || unseen > 180 ? foe : p;
    return { x: Math.min(area.x1 - 3, p.x + 10), z: 0 };
  }

  return {
    attach(g) {
      game = g;
    },
    update() {
      prev = held;
      held = new Set();
      wish = { x: 0, z: 0 };
      look = { x: 0, y: 0 };
      if (!game || game.mode === 'complete' || game.mode === 'failed' || game.mode === 'boost') return;
      const p = game.hatch;

      // Use whatever's in reach: revive, objectives, step-jump, the sniper nest
      const thing = game.usable(p);
      if (thing && game.mode === 'play') {
        if (thing.kind === 'revive' || thing.kind === 'objective') held.add('use');
        else if (!prev.has('use')) held.add('use');
      }

      // Shoot the nearest enemy we can see
      // Armoured enemies are only worth shooting from the side or back: until we're there, hold
      // fire (so Cruz draws their attention) and shoot anything else.
      const exposed = (e) => !ENEMY_TYPES[e.type].armored || Math.abs(angleDiff(e.yaw, Math.atan2(p.z - e.z, p.x - e.x))) > 1.2;
      let target = null;
      let best = game.mode === 'snipe' ? 200 : 70;
      for (const e of game.enemies) {
        if (e.dead || !exposed(e) || (game.mode === 'snipe' && !e.tower)) continue;
        const d = distXZ(p, e);
        if (d < best && game.canSee(p, e)) {
          target = e;
          best = d;
        }
      }
      unseen = target ? 0 : unseen + 1;

      // An armoured enemy up close that we can't get a shot at: a grenade doesn't care about armour.
      const brute = game.enemies.find((e) => !e.dead && ENEMY_TYPES[e.type].armored && distXZ(p, e) < 13);
      stalled = brute && !target ? stalled + 1 : 0;
      if (brute && stalled > 90 && p.grenades > 0 && game.mode === 'play') {
        const lob = { x: brute.x, y: eye(p).y - 0.6 - distXZ(p, brute) * 0.05, z: brute.z };
        if (aimAt(p, lob) && !prev.has('grenade')) {
          held.add('grenade');
          stalled = 0;
        }
        return;
      }
      if (target) {
        // Aim high: enemies popping out of cover show their heads first.
        const point = { ...chest(target), y: target.y + target.h - 0.2 };
        // Hold the trigger for automatic guns; tap it for semi-automatic ones.
        const auto = p.guns[p.weapon].def.auto;
        if (aimAt(p, point) && (auto || !prev.has('fire'))) held.add('fire');
      }
      if (p.guns[p.weapon].ammo === 0) held.add('reload');
      if (game.mode === 'snipe' && !target && !prev.has('use')) held.add('use'); // nothing left to snipe: climb down
      if (game.mode !== 'play') return;

      // Walk toward the destination, sidestepping when stuck
      const dest = destination(p);
      let dx = dest.x - p.x;
      let dz = dest.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.8) {
        dx /= d;
        dz /= d;
        if (sidestep) {
          [dx, dz] = [-dz * Math.sign(sidestep), dx * Math.sign(sidestep)];
          sidestep -= Math.sign(sidestep);
        }
        wish = { x: dx, z: dz };
        if (!target && d > 12) held.add('sprint');
      }
      const moved = Math.hypot(p.x - last.x, p.z - last.z);
      last = { x: p.x, z: p.z };
      if (d > 0.8 && moved < 0.01 && !p.using) {
        if (++stuck > 20) {
          sidestep = 40 * (Math.random() < 0.5 ? -1 : 1);
          held.add('vault');
          stuck = 0;
        }
      } else stuck = 0;
      if (!target) aimAt(p, { x: p.x + wish.x * 10 + 0.01, y: eye(p).y, z: p.z + wish.z * 10 });
    },
    down: (a) => held.has(a),
    pressed: (a) => held.has(a) && !prev.has(a),
    look: () => look,
    /** The wish direction, turned into a stick relative to Hatch's aim. */
    moveVector(aimYaw) {
      const f = { x: Math.cos(aimYaw), z: Math.sin(aimYaw) };
      const r = { x: -Math.sin(aimYaw), z: Math.cos(aimYaw) };
      const fwd = wish.x * f.x + wish.z * f.z;
      const right = wish.x * r.x + wish.z * r.z;
      return { x: f.x * fwd + r.x * right, z: f.z * fwd + r.z * right };
    },
  };
}
