// Cruz: the AI partner. He follows Hatch's orders (advance, regroup, hold), finds cover that
// actually protects him, flanks while Hatch is holding the enemy's attention, fires in bursts,
// and drops everything to revive Hatch when he goes down.
import { chest, startReload, tickReload, walk } from './actors.js';
import { PHYS } from './config.js';
import { distXZ, yawTo } from './math.js';

const SIGHT = 60;

function nearestVisibleEnemy(c, game, maxDist = SIGHT, filter = null) {
  let best = null;
  let bestD = maxDist;
  for (const e of game.enemies) {
    if (e.dead || (filter && !filter(e))) continue;
    const d = distXZ(c, e);
    if (d < bestD && game.canSee(c, e)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Is a cover point shielding someone standing at it from a threat at `from`? */
function protects(point, from) {
  const dx = from.x - point.x;
  const dz = from.z - point.z;
  const len = Math.hypot(dx, dz) || 1;
  return (dx / len) * point.nx + (dz / len) * point.nz > 0.55;
}

/**
 * Picks cover: near `anchor`, shielding from `threat`, not already taken. `forward` prefers
 * points further along x (advancing); `flank` prefers points off to the side of Hatch's line.
 */
function chooseCover(game, c, anchor, threat, { radius = 8, forward = false, flank = false } = {}) {
  let best = null;
  let bestScore = Infinity;
  for (const p of game.level.cover) {
    const dAnchor = Math.hypot(p.x - anchor.x, p.z - anchor.z);
    if (dAnchor > radius || !protects(p, threat)) continue;
    const dThreat = Math.hypot(p.x - threat.x, p.z - threat.z);
    if (dThreat < 6) continue;
    let score = dAnchor + Math.abs(dThreat - 16) * 0.3;
    if (forward) score -= (p.x - c.x) * 0.6;
    if (flank) score -= Math.abs(p.z - game.hatch.z) * 0.5;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

function moveTo(c, game, spot, speed) {
  const dx = spot.x - c.x;
  const dz = spot.z - c.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.35) {
    walk(c, game.level, { x: 0, z: 0 }, speed);
    return true;
  }
  // Slide sideways for a moment when something's in the way
  if (c.hitWall && !c.sidestep) c.sidestep = 24 * (Math.random() < 0.5 ? -1 : 1);
  let wx = dx / d;
  let wz = dz / d;
  if (c.sidestep) {
    const s = Math.sign(c.sidestep);
    [wx, wz] = [-wz * s, wx * s];
    c.sidestep -= s;
  }
  walk(c, game.level, { x: wx, z: wz }, Math.min(speed, d * 4 + 1));
  if (!c.target) c.yaw = Math.atan2(wz, wx);
  return false;
}

export function updatePartner(c, game) {
  c.animT++;
  const h = game.hatch;
  const gun = c.guns[c.weapon];
  tickReload(gun, c);
  if (c.fireCd > 0) c.fireCd--;
  gun.reserve = Math.max(gun.reserve, gun.def.mag); // Cruz carries plenty
  if (game.mode === 'boost') return;
  if (game.mode === 'snipe') {
    walk(c, game.level, { x: 0, z: 0 }, 0);
    c.anim = 'aim';
    return;
  }

  // Down: crawl toward Hatch and plink with the sidearm
  if (c.downed) {
    moveTo(c, game, h, PHYS.downed);
    shoot(c, game, nearestVisibleEnemy(c, game, 30), 1.6);
    c.anim = 'downed';
    return;
  }

  // Hatch is down: go and get him up, whatever's happening
  if (h.downed && !h.gone) {
    c.crouch = false;
    c.target = null;
    // Close enough to reach him: stop there rather than shoving him along the ground
    if (distXZ(c, h) < 1.3 || moveTo(c, game, h, PHYS.sprint)) {
      walk(c, game.level, { x: 0, z: 0 }, 0);
      c.yaw = yawTo(c, h);
      game.holdUse(c, { kind: 'revive', target: h });
      c.anim = 'use';
    } else c.anim = 'sprint';
    return;
  }

  // Back to back: rooted, covering the half Hatch isn't facing
  if (game.mode === 'backToBack') {
    walk(c, game.level, { x: 0, z: 0 }, 0);
    const behind = (e) => Math.cos(yawTo(h, e) - h.aimYaw) < 0.2;
    c.target = nearestVisibleEnemy(c, game, 40, behind) || nearestVisibleEnemy(c, game, 40);
    if (c.target) c.yaw = yawTo(c, c.target);
    shoot(c, game, c.target, 1.1, true);
    c.anim = 'aim';
    return;
  }

  // Who to shoot (re-checked a few times a second)
  if (--c.retarget <= 0 || (c.target && c.target.dead)) {
    c.target = nearestVisibleEnemy(c, game);
    c.retarget = 20;
  }
  const threat = c.target || game.enemies.find((e) => !e.dead && Math.abs(e.x - c.x) < 50);

  // Where to be, by order
  let spot;
  if (game.order === 'hold' && c.holdAt) spot = c.holdAt;
  else if (threat) {
    const advancing = game.order === 'advance';
    const flank = advancing && game.aggro > 30; // Hatch has their attention: go round the side
    if (!c.cover || !protects(c.cover, threat) || (c.coverT = (c.coverT || 0) + 1) > 240) {
      c.cover = chooseCover(game, c, advancing ? c : h, threat, { radius: advancing ? 12 : 7, forward: advancing, flank });
      c.coverT = 0;
    }
    spot = c.cover || { x: h.x - Math.cos(h.aimYaw) * 2.5, z: h.z - Math.sin(h.aimYaw) * 2.5 + 1.5 };
  } else {
    // No enemies about: walk at Hatch's shoulder
    spot = { x: h.x - Math.cos(h.aimYaw) * 2.2 - Math.sin(h.aimYaw) * 1.6, z: h.z - Math.sin(h.aimYaw) * 2.2 + Math.cos(h.aimYaw) * 1.6 };
  }
  const far = distXZ(c, spot) > 6;
  const arrived = moveTo(c, game, spot, far ? PHYS.sprint : PHYS.walk);

  // Crouch in cover between bursts; stand to shoot
  const shooting = c.target && game.canSee(c, c.target);
  c.crouch = arrived && !!c.cover && (!shooting || c.burstPause > 0);
  if (c.target) c.yaw = yawTo(c, c.target);
  if (shooting) shoot(c, game, c.target, 1.25);
  c.aimYaw = c.yaw;

  const moving = Math.hypot(c.vx, c.vz) > 0.5;
  c.anim = moving ? (far ? 'sprint' : c.crouch ? 'crouchWalk' : 'walk') : c.crouch ? 'crouch' : c.target ? 'aim' : 'idle';
}

/** Bursts with pauses between them, so Cruz isn't a turret. */
function shoot(c, game, target, spreadScale, steady = false) {
  if (!target) return;
  const gun = c.guns[c.weapon];
  if (c.burstPause > 0) {
    c.burstPause--;
    return;
  }
  if (gun.ammo <= 0) {
    startReload(gun, c);
    return;
  }
  if (c.fireCd > 0 || c.reloadT > 0) return;
  c.yaw = yawTo(c, target);
  c.aimYaw = c.yaw;
  gun.ammo--;
  c.fireCd = gun.def.rate + (gun.def.auto ? 1 : 6);
  game.fireAt(c, chest(target), gun.def, spreadScale);
  game.sfx(c.weapon === 'pistol' ? 'pistolFar' : 'rifleFar');
  c.burst = (c.burst || 0) + 1;
  if (!steady && c.burst >= 6 + Math.floor(Math.random() * 5)) {
    c.burst = 0;
    c.burstPause = 30 + Math.floor(Math.random() * 40);
  }
}
