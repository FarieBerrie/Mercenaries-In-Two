// Hatch: the contractor you play. Mouse aims, the body faces where you aim, and every shot goes
// where the crosshair points (game.aimPoint).
import { aimVector, startReload, tickReload, walk } from './actors.js';
import { PHYS } from './config.js';
import { boxesNear, COVER_HEIGHT } from './level.js';
import { clamp } from './math.js';

const VAULT_FRAMES = 18;

/** A low box right in front, to vault over, and where you'd land. */
function vaultTarget(p, level, dir) {
  const probe = { x: p.x + dir.x * 0.9, z: p.z + dir.z * 0.9 };
  for (const b of boxesNear(level, probe.x - 1, probe.x + 1)) {
    if (b.y1 > COVER_HEIGHT + 0.05 || b.y1 - p.y < 0.4) continue;
    if (probe.x < b.x0 - 0.2 || probe.x > b.x1 + 0.2 || probe.z < b.z0 - 0.2 || probe.z > b.z1 + 0.2) continue;
    // Land just past the far side of the box along the vault direction
    const depth = Math.abs(dir.x) > Math.abs(dir.z) ? b.x1 - b.x0 : b.z1 - b.z0;
    return { x: p.x + dir.x * (depth + 1.3), z: p.z + dir.z * (depth + 1.3), top: b.y1 };
  }
  return null;
}

export function updatePlayer(p, game, input) {
  p.animT++;
  const level = game.level;
  const look = input.look ? input.look() : { x: 0, y: 0 };
  p.aimYaw += look.x;
  p.aimPitch = clamp(p.aimPitch - look.y, -1.1, 1.0);
  const gun = p.guns[p.weapon];
  tickReload(gun, p);
  if (p.fireCd > 0) p.fireCd--;
  p.recoil *= 0.88;

  // ---- Use: revive, objectives, step-jump, sniper nest
  const thing = !p.downed ? game.usable(p) : null;
  game.prompt = game.mode === 'snipe' ? 'PRESS E: LEAVE THE NEST' : thing?.label ?? null;
  p.using = null;
  if (game.mode === 'snipe' && input.pressed('use')) game.leaveNest();
  else if (thing) {
    if (thing.kind === 'boost' && input.pressed('use')) return game.startBoost(thing.target);
    if (thing.kind === 'nest' && input.pressed('use')) return game.enterNest(thing.target);
    if ((thing.kind === 'revive' || thing.kind === 'objective') && input.down('use')) {
      p.using = thing;
      game.holdUse(p, thing);
    }
  }

  // ---- Weapons
  if (!p.downed && game.mode !== 'snipe') {
    const was = p.weapon;
    if (input.pressed('weapon1')) p.weapon = 'rifle';
    if (input.pressed('weapon2')) p.weapon = 'pistol';
    if (input.pressed('swap')) p.weapon = p.weapon === 'rifle' ? 'pistol' : 'rifle';
    if (p.weapon !== was) {
      p.reloadT = 0;
      game.sfx('select');
    }
  }
  // Out of sniper rounds: climb down from the nest
  if (game.mode === 'snipe' && p.guns.sniper.ammo === 0 && p.guns.sniper.reserve === 0 && p.reloadT === 0) game.leaveNest();
  // Out of rifle ammo entirely: fall back to the sidearm
  if (p.weapon === 'rifle' && p.guns.rifle.ammo === 0 && p.guns.rifle.reserve === 0 && p.reloadT === 0) {
    p.weapon = 'pistol';
    game.popup(p, 'OUT OF RIFLE AMMO', '#f8c030');
  }
  const g = p.guns[p.weapon];
  if (input.pressed('reload') && startReload(g, p)) game.sfx('reload');
  if (g.ammo === 0 && p.reloadT === 0 && startReload(g, p)) game.sfx('reload');

  // ---- Stance
  if (input.pressed('crouch') && !p.downed) p.crouch = !p.crouch;
  p.aiming = (input.down('aim') || game.mode === 'snipe') && game.mode !== 'backToBack';
  const move = input.moveVector ? input.moveVector(p.aimYaw) : { x: 0, z: 0 };
  const moving = Math.hypot(move.x, move.z) > 0.2;
  const fwd = { x: Math.cos(p.aimYaw), z: Math.sin(p.aimYaw) };
  const forwardish = move.x * fwd.x + move.z * fwd.z > 0.5;
  p.sprint = input.down('sprint') && moving && forwardish && !p.aiming && !p.downed && !input.down('fire');
  if (p.sprint) p.crouch = false;

  // ---- Movement (or a vault in progress)
  const locked = game.mode === 'snipe' || game.mode === 'backToBack' || !!p.using;
  if (p.vault > 0) {
    p.vault--;
    const k = 1 - p.vault / VAULT_FRAMES;
    p.x = p.vaultFrom.x + (p.vaultTo.x - p.vaultFrom.x) * k;
    p.z = p.vaultFrom.z + (p.vaultTo.z - p.vaultFrom.z) * k;
    p.y = Math.sin(k * Math.PI) * (p.vaultTo.top + 0.15);
    if (p.vault === 0) p.y = 0;
  } else {
    if (input.pressed('vault') && !p.downed && !locked && moving) {
      const len = Math.hypot(move.x, move.z);
      const target = vaultTarget(p, level, { x: move.x / len, z: move.z / len });
      if (target) {
        p.vault = VAULT_FRAMES;
        p.vaultFrom = { x: p.x, z: p.z };
        p.vaultTo = target;
        p.crouch = false;
        game.sfx('vault');
      }
    }
    let speed = p.downed ? PHYS.downed : p.sprint ? PHYS.sprint : p.crouch ? PHYS.crouch : PHYS.walk;
    if (p.aiming && !p.downed) speed *= 0.6;
    if (!p.vault) walk(p, level, locked ? { x: 0, z: 0 } : move, speed);
  }
  p.yaw = p.sprint ? Math.atan2(p.vz, p.vx) : p.aimYaw;

  // ---- Shooting
  const wantsFire = g.def.auto ? input.down('fire') : input.pressed('fire');
  if (wantsFire && p.fireCd <= 0 && p.reloadT <= 0 && !p.sprint && !p.vault && !p.using && game.mode !== 'boost') {
    if (g.ammo > 0) {
      if (game.mode !== 'backToBack') g.ammo--;
      p.fireCd = g.def.rate;
      const aim = game.aimPoint(p);
      const spread = (p.aiming ? g.def.aimSpread / g.def.spread : 1) * (p.crouch ? 0.75 : 1) * (moving ? 1.35 : 1) + p.recoil;
      const hit = game.fireAt(p, aim, g.def, spread);
      p.recoil = Math.min(1.5, p.recoil + (p.weapon === 'pistol' ? 0.35 : 0.12));
      game.sfx(p.weapon === 'sniper' ? 'sniper' : p.weapon === 'pistol' ? 'pistol' : 'rifle');
      if (game.mode === 'snipe') game.coopSnipe(hit);
    } else if (input.pressed('fire')) {
      game.sfx('empty');
    }
  }

  // ---- Grenade, lobbed along your aim
  if (input.pressed('grenade') && p.grenades > 0 && !p.downed && game.mode === 'play') {
    p.grenades--;
    game.throwGrenade(p, aimVector(p.aimYaw, p.aimPitch + 0.2));
  }

  // ---- Orders to Cruz
  if (input.pressed('orderAdvance')) game.giveOrder('advance');
  if (input.pressed('orderRegroup')) game.giveOrder('regroup');
  if (input.pressed('orderHold')) game.giveOrder('hold');

  // ---- Animation state
  const speedNow = Math.hypot(p.vx, p.vz);
  if (p.downed) p.anim = 'downed';
  else if (p.vault) p.anim = 'vault';
  else if (p.using) p.anim = 'use';
  else if (p.sprint) p.anim = 'sprint';
  else if (speedNow > 0.5) p.anim = p.crouch ? 'crouchWalk' : 'walk';
  else p.anim = p.crouch ? 'crouch' : 'idle';
}
