// Enemy behaviour. Riflemen fight from cover, popping up for bursts; shotgunners rush; snipers
// hold still and paint you with a laser before they fire; heavies and bosses walk forward behind
// their armour, and some throw grenades. Targets are picked by aggro (game.pickTarget). Patrols
// walk their routes until they see or hear you; an area's defenders won't follow you across the
// map. Everyone gets about by the navigation grid (nav.js).
import { chest, ENEMY_TYPES, walk } from './actors.js';
import { inArea } from './level.js';
import { distXZ, yawTo } from './math.js';
import { navDir, reachable } from './nav.js';

function protects(point, from) {
  const dx = from.x - point.x;
  const dz = from.z - point.z;
  const len = Math.hypot(dx, dz) || 1;
  return (dx / len) * point.nx + (dz / len) * point.nz > 0.55;
}

function findCover(e, game, threat) {
  let best = null;
  let bestScore = Infinity;
  for (const p of game.level.cover) {
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d > 16 || !protects(p, threat)) continue;
    const dThreat = Math.hypot(p.x - threat.x, p.z - threat.z);
    if (dThreat < 7 || dThreat > 40) continue;
    if (game.enemies.some((o) => o !== e && !o.dead && o.cover && Math.hypot(o.cover.x - p.x, o.cover.z - p.z) < 1.2)) continue;
    const score = d + Math.abs(dThreat - 18) * 0.35;
    if (score >= bestScore || !reachable(game.level, e, p)) continue;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** Walks toward a spot, round whatever's in the way. True once there. */
function steer(e, game, spot, speed, near = 0.4) {
  const n = navDir(game.level, e, spot, game.frame);
  if (n.d < near) {
    walk(e, game.level, { x: 0, z: 0 }, speed);
    return true;
  }
  walk(e, game.level, { x: n.x, z: n.z }, speed);
  e.yaw = Math.atan2(n.z, n.x);
  return false;
}

/** Has a patrolling enemy seen or heard either of you? Crouching keeps you harder to spot. */
function noticed(e, game) {
  for (const c of game.contractors) {
    if (c.gone) continue;
    const d = distXZ(e, c);
    if (c.sinceShot < 3 && d < 55) return true; // gunfire carries
    if (d < (c.crouch ? 3 : 7)) return true; // right on top of them
    if (d > (c.crouch ? 22 : 42)) continue;
    if (Math.cos(yawTo(e, c) - e.yaw) > 0.3 && game.canSee(e, c)) return true;
  }
  return false;
}

/** A patrol on its rounds: along the route at a walk, turning at each corner. */
function patrol(e, game) {
  const p = e.patrol;
  const wp = p.route[p.i];
  e.crouch = false;
  steer(e, game, wp, 1.7, 0.4);
  if (distXZ(e, wp) < 2.2) p.i = (p.i + 1) % p.route.length;
  e.anim = 'walk';
}

function fire(e, game, target, spreadScale = 1) {
  const gun = e.gun;
  if (gun.ammo <= 0) {
    if (!e.reloadT) e.reloadT = gun.def.reload;
    return false;
  }
  if (e.fireCd > 0 || e.reloadT > 0) return false;
  gun.ammo--;
  e.fireCd = gun.def.rate;
  e.yaw = yawTo(e, target);
  // Further away and on the move is harder to hit
  const dist = distXZ(e, target);
  const moving = Math.hypot(target.vx, target.vz) > 3 ? 1.3 : 1;
  game.fireAt(e, chest(target), gun.def, spreadScale * moving * (0.7 + dist / 40));
  e.muzzle = 3;
  game.sfx(e.type === 'sniper' ? 'sniperFar' : e.type === 'shotgunner' || e.type === 'enforcer' ? 'shotgun' : e.type === 'warden' ? 'minigun' : ENEMY_TYPES[e.type].armored ? 'lmg' : 'enemyRifle', e);
  return true;
}

export function updateEnemy(e, game) {
  e.animT++;
  if (e.flash > 0) e.flash--;
  if (e.muzzle > 0) e.muzzle--;
  if (e.fireCd > 0) e.fireCd--;
  if (e.reloadT > 0 && --e.reloadT === 0) e.gun.ammo = e.gun.def.mag;
  if (e.grenadeCd > 0) e.grenadeCd--;
  if (e.throwT > 0) e.throwT--;
  const def = ENEMY_TYPES[e.type];

  // On patrol and none the wiser: keep walking, keep looking
  if (e.alert === false) {
    if (e.animT % 6 === 0 && noticed(e, game)) game.alertSquad(e);
    else return patrol(e, game);
  }

  // Pick who to shoot every so often; between times, keep tracking whether we can see them.
  if (--e.retarget <= 0 || !e.target || e.target.gone) {
    e.target = game.pickTarget(e);
    e.retarget = 40 + Math.floor(Math.random() * 30);
  }
  if (e.animT % 6 === 0) e.sees = !!e.target && game.canSee(e, e.target);
  const goal = e.target || nearestContractor(e, game);
  if (!goal) return walk(e, game.level, { x: 0, z: 0 }, 0);
  const dist = distXZ(e, goal);

  // Nobody in sight and you've gone a long way off: an area's defenders go back to their posts,
  // and a patrol back to its rounds
  if (!e.sees && !e.tower) {
    e.lost = (e.lost || 0) + 1;
    const area = game.level.areas[e.area];
    const strayed = area ? !inArea(area, goal, 45) : e.patrol && e.lost > 600 && !e.patrol.route.some((w) => distXZ(w, goal) < 70);
    if (strayed) {
      if (e.patrol) {
        e.alert = false;
        e.lost = 0;
        return patrol(e, game);
      }
      e.crouch = false;
      e.cover = null;
      const there = steer(e, game, e.home || e, def.speed * 0.6);
      e.anim = there ? 'aim' : 'walk';
      return;
    }
  } else e.lost = 0;

  // Snipers on towers, or anyone with a sniper rifle: hold still, aim, then fire
  if (def.sniper) {
    // A marksman on the ground with no line of sight for a while moves to find one
    e.unseen = e.sees ? 0 : (e.unseen || 0) + 1;
    if (!e.tower && e.unseen > 360) {
      e.crouch = false;
      e.aimT = 0;
      steer(e, game, goal, def.speed);
      e.anim = 'run';
      return;
    }
    walk(e, game.level, { x: 0, z: 0 }, 0);
    e.crouch = false;
    if (e.sees && dist < 120) {
      e.yaw = yawTo(e, goal);
      e.aimT++;
      if (e.aimT > 100) {
        fire(e, game, goal, 0.6);
        e.aimT = 0;
      }
    } else e.aimT = 0;
    e.anim = 'aim';
    return;
  }

  // Grenades for anyone hiding behind cover too long
  if (def.grenadier && e.grenadeCd <= 0 && dist > 8 && dist < 26 && e.target) {
    const t = e.target;
    const flight = 1.1;
    game.throwGrenade(e, { x: (t.x - e.x) / dist, y: 0.35, z: (t.z - e.z) / dist }, Math.min(18, dist / flight));
    e.grenadeCd = 360 + Math.floor(Math.random() * 240);
  }

  // Rushers: straight at you, blasting when close
  if (def.rush) {
    e.crouch = false;
    if (dist > 4) steer(e, game, goal, def.speed);
    else walk(e, game.level, { x: 0, z: 0 }, def.speed);
    if (e.sees && dist < 11) fire(e, game, goal, 1);
    e.anim = Math.hypot(e.vx, e.vz) > 0.5 ? 'run' : 'aim';
    return;
  }

  // Heavies and bosses: plod forward, firing long bursts. They keep coming until they can see
  // who they're after.
  if (def.armored) {
    if (dist > 11 || !e.sees) steer(e, game, goal, def.speed);
    else walk(e, game.level, { x: 0, z: 0 }, def.speed);
    if (e.sees) {
      e.yaw = yawTo(e, goal);
      if (e.burst > 0) {
        if (fire(e, game, goal, 1)) e.burst--;
      } else if (--e.stateT <= 0) {
        e.burst = def.burst[0] + Math.floor(Math.random() * (def.burst[1] - def.burst[0]));
        e.stateT = 50 + Math.floor(Math.random() * 40);
      }
    }
    e.anim = Math.hypot(e.vx, e.vz) > 0.3 ? 'walk' : 'aim';
    return;
  }

  // Riflemen: get into cover that blocks the target, then pop up and shoot. Five seconds without
  // a sight of anyone and they leave cover to push closer.
  e.unseen = e.sees ? 0 : (e.unseen || 0) + 1;
  if (e.unseen > 300) {
    e.cover = null;
    e.pushT = 120;
    e.unseen = 0;
  }
  if (e.pushT > 0) {
    e.pushT--;
    e.crouch = false;
    steer(e, game, goal, def.speed);
    if (e.sees && Math.random() < 0.08) fire(e, game, goal, 1.4);
    e.anim = 'run';
    return;
  }
  if (!e.cover || (e.animT % 90 === 0 && !protects(e.cover, goal))) e.cover = findCover(e, game, goal);
  if (e.cover) {
    const there = steer(e, game, e.cover, def.speed);
    if (there) {
      e.stateT--;
      if (e.state !== 'pop' && e.state !== 'hide') {
        e.state = 'hide';
        e.stateT = 40 + Math.floor(Math.random() * 60);
      }
      if (e.state === 'hide') {
        e.crouch = true;
        if (e.stateT <= 0 && e.reloadT === 0) {
          e.state = 'pop';
          e.stateT = 50 + Math.floor(Math.random() * 50);
          e.burst = def.burst[0] + Math.floor(Math.random() * (def.burst[1] - def.burst[0]));
        }
      } else {
        e.crouch = false;
        if (e.sees && e.burst > 0 && fire(e, game, goal, 1)) e.burst--;
        if (e.stateT <= 0 || e.burst <= 0) {
          e.state = 'hide';
          e.stateT = 50 + Math.floor(Math.random() * 70);
        }
      }
      if (e.sees || e.state === 'pop') e.yaw = yawTo(e, goal);
    } else {
      e.crouch = false;
      e.state = 'move';
      // Snap shots on the move, now and then
      if (e.sees && Math.random() < 0.05) fire(e, game, goal, 1.6);
    }
  } else {
    // No cover nearby: close in to a fighting distance and shoot standing
    e.crouch = false;
    if (dist > 18) steer(e, game, goal, def.speed);
    else walk(e, game.level, { x: 0, z: 0 }, def.speed);
    if (e.sees) {
      e.yaw = yawTo(e, goal);
      if (e.burst > 0) {
        if (fire(e, game, goal, 1.1)) e.burst--;
      } else if (--e.stateT <= 0) {
        e.burst = def.burst[0] + Math.floor(Math.random() * (def.burst[1] - def.burst[0]));
        e.stateT = 60 + Math.floor(Math.random() * 60);
      }
    }
  }
  const moving = Math.hypot(e.vx, e.vz) > 0.5;
  e.anim = moving ? 'run' : e.crouch ? 'crouch' : 'aim';
}

function nearestContractor(e, game) {
  let best = null;
  let bestD = Infinity;
  for (const c of game.contractors) {
    if (c.gone) continue;
    const d = distXZ(e, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

