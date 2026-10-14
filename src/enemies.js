// Enemy behaviour. Riflemen fight from cover, popping up for bursts; shotgunners rush; snipers
// hold still and paint you with a laser before they fire; heavies and bosses walk forward behind
// their armour, and some throw grenades. Targets are picked by aggro (game.pickTarget).
import { chest, ENEMY_TYPES, walk } from './actors.js';
import { distXZ, yawTo } from './math.js';

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
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

function steer(e, game, spot, speed) {
  const dx = spot.x - e.x;
  const dz = spot.z - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) {
    walk(e, game.level, { x: 0, z: 0 }, speed);
    return true;
  }
  // Blocked: slide sideways for a while (longer when we can't even see who we're after)
  if (e.hitWall && !e.sidestep) e.sidestep = (e.sees ? 30 : 70) * (Math.random() < 0.5 ? -1 : 1);
  let wx = dx / d;
  let wz = dz / d;
  if (e.sidestep) {
    const s = Math.sign(e.sidestep);
    [wx, wz] = [-wz * s, wx * s];
    e.sidestep -= s;
  }
  walk(e, game.level, { x: wx, z: wz }, speed);
  e.yaw = Math.atan2(wz, wx);
  return false;
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
  game.sfx(e.type === 'sniper' ? 'sniperFar' : e.type === 'shotgunner' || e.type === 'enforcer' ? 'shotgun' : 'enemyRifle');
  return true;
}

export function updateEnemy(e, game) {
  e.animT++;
  if (e.flash > 0) e.flash--;
  if (e.muzzle > 0) e.muzzle--;
  if (e.fireCd > 0) e.fireCd--;
  if (e.reloadT > 0 && --e.reloadT === 0) e.gun.ammo = e.gun.def.mag;
  if (e.grenadeCd > 0) e.grenadeCd--;
  const def = ENEMY_TYPES[e.type];

  // Pick who to shoot every so often; between times, keep tracking whether we can see them.
  if (--e.retarget <= 0 || !e.target || e.target.gone) {
    e.target = game.pickTarget(e);
    e.retarget = 40 + Math.floor(Math.random() * 30);
  }
  if (e.animT % 6 === 0) e.sees = !!e.target && game.canSee(e, e.target);
  const goal = e.target || nearestContractor(e, game);
  if (!goal) return walk(e, game.level, { x: 0, z: 0 }, 0);
  const dist = distXZ(e, goal);

  // Snipers on towers, or anyone with a sniper rifle: hold still, aim, then fire
  if (def.sniper) {
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

