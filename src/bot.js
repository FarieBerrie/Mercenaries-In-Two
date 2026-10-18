// An autopilot that plays Hatch: for the title-screen demo and for testing that every mission
// can be finished. It speaks the same input interface as the keyboard and mouse.
import { chest, ENEMY_TYPES, eye } from './actors.js';
import { cameraOffset, CAMERA } from './config.js';
import { inBounds } from './level.js';
import { angleDiff, distXZ } from './math.js';
import { nearestStandable, navDir, reachable } from './nav.js';

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
  let blocked = 0; // frames the crosshair has stopped short of the target (a corner by the camera)
  let shuffle = 0; // frames left stepping aside to clear the shot

  function aimAt(p, point) {
    const e = eye(p);
    let yaw = Math.atan2(point.z - e.z, point.x - e.x);
    let pitch = Math.atan2(point.y - e.y, Math.hypot(point.x - e.x, point.z - e.z));
    // Shots go where the crosshair points, and the camera sits behind the right shoulder: put the
    // camera's ray through the point, not the eyes' (which would miss by the shoulder offset up close)
    const off = cameraOffset(p.aimK ?? 0);
    for (let k = 0; k < 3; k++) {
      const f = { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.sin(yaw) * Math.cos(pitch) };
      const side = p.camSide ?? off.right;
      const c = { x: e.x - f.x * off.back - Math.sin(yaw) * side, y: e.y + CAMERA.up - f.y * off.back, z: e.z - f.z * off.back + Math.cos(yaw) * side };
      yaw = Math.atan2(point.z - c.z, point.x - c.x);
      pitch = Math.atan2(point.y - c.y, Math.hypot(point.x - c.x, point.z - c.z));
    }
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
    const i = game.focusArea();
    if (i < 0) {
      // Everything's taken: the helicopter
      const end = level.areas[level.areas.length - 1];
      return end.extract || end.center;
    }
    const area = level.areas[i];
    const st = game.areas[i];
    if (!st.triggered) {
      // On the way there. A walled-in area is reached over the wall from the one before it.
      const prev = level.areas[i - 1];
      if (prev?.boost && game.areas[prev.index].cleared && !reachable(level, p, area.center)) return prev.boost;
      return area.center;
    }
    const todo = area.objectives.find((o) => !o.done);
    if (todo) return todo;
    if (area.nest && game.enemiesIn(i).some((e) => e.tower)) return area.nest;
    // Armoured enemies only take damage from the side or back: go round them.
    const heavy = game.enemies.find((e) => !e.dead && e.area === i && ENEMY_TYPES[e.type].armored);
    if (heavy) {
      // Behind him, or failing that off to one side: somewhere we can actually get to
      for (const turn of [Math.PI, Math.PI * 0.7, -Math.PI * 0.7, Math.PI / 2, -Math.PI / 2]) {
        const a = heavy.yaw + turn;
        const spot = { x: heavy.x + Math.cos(a) * 9, z: heavy.z + Math.sin(a) * 9 };
        if (!inBounds(level, spot.x, spot.z, 2)) continue;
        const at = nearestStandable(level, spot, 3);
        if (at && reachable(level, p, at)) return at;
      }
      return heavy;
    }
    const foe = game.enemies.find((e) => !e.dead && e.area === i);
    // Hold at a fighting distance, but go and flush them out if they've gone quiet
    if (foe) return distXZ(p, foe) > 14 || unseen > 180 ? foe : p;
    return area.center;
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
        const onTarget = aimAt(p, point);
        // The eyes can see round a corner the camera (behind the right shoulder) can't: if the
        // crosshair stops short of the target, step left until it doesn't
        const hit = game.mode === 'play' ? game.aimPoint(p) : null;
        const clear = !hit || Math.hypot(hit.x - p.x, hit.z - p.z) > distXZ(p, target) - 1;
        blocked = onTarget && !clear ? blocked + 1 : 0;
        if (blocked > 20) {
          shuffle = 40;
          blocked = 0;
        }
        if (onTarget && clear && (auto || !prev.has('fire'))) held.add('fire');
      }
      if (p.guns[p.weapon].ammo === 0) held.add('reload');
      if (game.mode === 'snipe' && !target && !prev.has('use')) held.add('use'); // nothing left to snipe: climb down
      if (game.mode !== 'play') return;

      // Walk toward the destination along a path, sidestepping when stuck
      const dest = destination(p);
      const way = navDir(game.level, p, dest, game.frame);
      let dx = way.x;
      let dz = way.z;
      const d = way.d;
      if (shuffle > 0 && target) {
        // Step to the left of the line to the target, away from the shoulder the camera's on
        shuffle--;
        const tx = target.x - p.x;
        const tz = target.z - p.z;
        const tl = Math.hypot(tx, tz) || 1;
        wish = { x: (tz / tl) * 0.9 - (tx / tl) * 0.3, z: (-tx / tl) * 0.9 - (tz / tl) * 0.3 };
      } else if (d > 0.8) {
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
