// Cruz: the AI partner. He follows Hatch's orders (advance, regroup, hold), finds cover that
// actually protects him, flanks while Hatch is holding the enemy's attention, fires in bursts,
// and drops everything to revive Hatch when he goes down.
import { chest, startReload, tickReload, walk } from './actors.js';
import { PHYS } from './config.js';
import { distXZ, yawTo } from './math.js';
import { navDir, reachable } from './nav.js';

const SIGHT = 60;

function nearestVisibleEnemy(c, game, maxDist = SIGHT, filter = null) {
  let best = null;
  let bestD = maxDist;
  // A patrol that hasn't noticed you is left alone, unless Hatch has started it or it's close
  const loud = game.hatch.sinceShot < 240;
  for (const e of game.enemies) {
    if (e.dead || (filter && !filter(e))) continue;
    if (e.alert === false && !loud && distXZ(c, e) > 12) continue;
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
    // Advancing: toward the threat. Flanking: well off to the side of Hatch's line to it
    if (forward) score -= (Math.hypot(c.x - threat.x, c.z - threat.z) - dThreat) * 0.6;
    if (flank) {
      const hx = threat.x - game.hatch.x;
      const hz = threat.z - game.hatch.z;
      const hl = Math.hypot(hx, hz) || 1;
      score -= Math.abs(((p.x - game.hatch.x) * -hz + (p.z - game.hatch.z) * hx) / hl) * 0.5;
    }
    if (score < bestScore && reachable(game.level, c, p)) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Walks toward a spot, round whatever's in the way, slowing as he gets there. True once there. */
function moveTo(c, game, spot, speed) {
  const n = navDir(game.level, c, spot, game.frame);
  if (n.d < 0.35) {
    walk(c, game.level, { x: 0, z: 0 }, speed);
    return true;
  }
  walk(c, game.level, { x: n.x, z: n.z }, Math.min(speed, n.d * 4 + 1));
  if (!c.target) c.yaw = Math.atan2(n.z, n.x);
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
  c.retarget = (c.retarget ?? 0) - 1;
  if (c.retarget <= 0 || (c.target && c.target.dead)) {
    c.target = nearestVisibleEnemy(c, game);
    c.retarget = 20;
  }
  const threat = c.target || game.enemies.find((e) => !e.dead && e.alert !== false && distXZ(e, c) < 50);

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
    // No cover to hand: back and to the left of Hatch, out of the camera's way
    spot = c.cover || { x: h.x - Math.cos(h.aimYaw) * 1.2 + Math.sin(h.aimYaw) * 2.6, z: h.z - Math.sin(h.aimYaw) * 1.2 - Math.cos(h.aimYaw) * 2.6 };
  } else {
    // No enemies about: walk at Hatch's left shoulder (the camera is over his right)
    spot = { x: h.x + Math.cos(h.aimYaw) * 0.4 + Math.sin(h.aimYaw) * 2.4, z: h.z + Math.sin(h.aimYaw) * 0.4 - Math.cos(h.aimYaw) * 2.4 };
  }
  // Hatch standing in the line of fire: step out to the other side of it
  if (c.target && game.order !== 'hold') {
    const tx = c.target.x - c.x;
    const tz = c.target.z - c.z;
    const len2 = tx * tx + tz * tz || 1;
    const k = ((h.x - c.x) * tx + (h.z - c.z) * tz) / len2;
    const ox = h.x - (c.x + tx * k);
    const oz = h.z - (c.z + tz * k);
    if (k > 0 && k < 1 && Math.hypot(ox, oz) < 0.8) {
      const len = Math.sqrt(len2);
      const nx = -tz / len;
      const nz = tx / len;
      const away = ox * nx + oz * nz > 0 ? -1 : 1;
      spot = { x: c.x + nx * away * 2.5, z: c.z + nz * away * 2.5 };
    }
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
  game.sfx(c.weapon === 'pistol' ? 'pistolFar' : 'rifleFar', c);
  c.burst = (c.burst || 0) + 1;
  if (!steady && c.burst >= 6 + Math.floor(Math.random() * 5)) {
    c.burst = 0;
    c.burstPause = 30 + Math.floor(Math.random() * 40);
  }
}
