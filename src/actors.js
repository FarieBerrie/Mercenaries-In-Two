// Bodies shared by the two contractors and their enemies: creation, eye and aim positions, and
// moving through the world. Hatch (the player) and Cruz (the AI partner) are original characters.
import { BODY, PHYS, STEP } from './config.js';
import { approach2, dirOf } from './math.js';
import { moveBody } from './physics.js';
import { WEAPONS } from './weapons.js';

let nextId = 1;

/** One of the two contractors. loadout comes from progress.js. */
export function createContractor(who, x, z, loadout) {
  return {
    id: nextId++,
    who, // 'hatch' | 'cruz'
    team: 'contractors',
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    r: BODY.radius,
    h: BODY.height,
    yaw: 0, // body facing
    aimYaw: 0,
    aimPitch: 0,
    hp: loadout.maxHp,
    maxHp: loadout.maxHp,
    downed: false,
    bleed: 0,
    crouch: false,
    sprint: false,
    aiming: false,
    weapon: 'rifle',
    guns: {
      rifle: { def: loadout.rifle, ammo: loadout.rifle.mag, reserve: loadout.rifle.reserve },
      pistol: { def: loadout.pistol, ammo: loadout.pistol.mag, reserve: Infinity },
      sniper: { def: loadout.sniper, ammo: loadout.sniper.mag, reserve: loadout.sniper.reserve },
    },
    grenades: loadout.grenades,
    maxGrenades: loadout.grenades,
    fireCd: 0,
    reloadT: 0,
    recoil: 0,
    sinceHit: 999,
    sinceShot: 999,
    use: null, // what Use is being held on, and for how long
    vault: 0,
    vaultFrom: null,
    vaultTo: null,
    hitWall: null,
    onGround: true,
    anim: 'idle',
    animT: 0,
    flash: 0,
  };
}

// Enemy roster. hp, speed in m/s, weapon from weapons.js, money paid per kill. armored enemies
// shrug off shots from the front; flank them.
export const ENEMY_TYPES = {
  rifleman: { hp: 70, speed: 3.6, weapon: 'enemyRifle', pay: 100, burst: [4, 8] },
  shotgunner: { hp: 95, speed: 4.6, weapon: 'shotgun', pay: 150, rush: true },
  sniper: { hp: 60, speed: 2.4, weapon: 'enemySniper', pay: 200, sniper: true },
  heavy: { hp: 420, speed: 1.7, weapon: 'lmg', pay: 500, armored: true, size: 1.08, burst: [12, 24] },
  warlord: { hp: 1300, speed: 1.6, weapon: 'lmg', pay: 3000, armored: true, size: 1.15, boss: true, grenadier: true, burst: [16, 30], name: 'THE WARLORD' },
  enforcer: { hp: 1150, speed: 3.8, weapon: 'shotgun', pay: 3000, armored: true, size: 1.15, boss: true, rush: true, name: 'THE ENFORCER' },
  warden: { hp: 1700, speed: 1.4, weapon: 'minigun', pay: 4000, armored: true, size: 1.15, boss: true, grenadier: true, burst: [30, 60], name: 'THE WARDEN' },
};

export function createEnemy(type, x, z, rng = Math.random) {
  const def = ENEMY_TYPES[type];
  const size = def.size || 1;
  return {
    id: nextId++,
    type,
    team: 'hostile',
    x,
    y: 0,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    r: BODY.radius * size,
    h: BODY.height * size,
    size,
    yaw: Math.PI,
    hp: def.hp,
    maxHp: def.hp,
    gun: { def: WEAPONS[def.weapon], ammo: WEAPONS[def.weapon].mag },
    fireCd: 30 + Math.floor(rng() * 60),
    reloadT: 0,
    target: null,
    retarget: 0,
    state: 'advance',
    stateT: 0,
    cover: null,
    burst: 0,
    crouch: false,
    aimT: 0,
    sidestep: 0,
    grenadeCd: 300 + Math.floor(rng() * 300),
    dead: false,
    flash: 0,
    anim: 'idle',
    animT: Math.floor(rng() * 60),
  };
}

export const isContractor = (a) => a.team === 'contractors';
export const eyeHeight = (a) => (a.crouch || a.downed ? BODY.crouchEye : BODY.eye) * (a.size || 1);
export const eye = (a) => ({ x: a.x, y: a.y + eyeHeight(a), z: a.z });
export const chest = (a) => ({ x: a.x, y: a.y + (a.crouch || a.downed ? 0.7 : 1.25) * (a.size || 1), z: a.z });

/** Unit vector for a heading and pitch. */
export function aimVector(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: Math.cos(yaw) * c, y: Math.sin(pitch), z: Math.sin(yaw) * c };
}

/**
 * Moves an actor toward a wish direction ({ x, z }, length 0..1) at a given speed, with
 * acceleration, gravity and collisions. Also keeps the body height right for crouching.
 */
export function walk(a, level, wish, speed) {
  const dt = STEP;
  const crouchH = BODY.crouchHeight * (a.size || 1);
  const standH = BODY.height * (a.size || 1);
  a.h = a.crouch || a.downed ? crouchH : standH;
  const len = Math.hypot(wish.x, wish.z);
  const tx = len > 0.01 ? (wish.x / Math.max(1, len)) * speed : 0;
  const tz = len > 0.01 ? (wish.z / Math.max(1, len)) * speed : 0;
  [a.vx, a.vz] = approach2(a.vx, a.vz, tx, tz, (len > 0.01 ? PHYS.accel : PHYS.friction) * dt);
  a.vy = Math.max(a.vy - PHYS.gravity * dt, -PHYS.maxFall);
  moveBody(level, a, dt);
}

/** Starting a reload, if it makes sense. Returns true if one started. */
export function startReload(gun, a) {
  if (a.reloadT > 0 || gun.ammo >= gun.def.mag || gun.reserve <= 0) return false;
  a.reloadT = gun.def.reload;
  return true;
}

/** Ticks a reload; refills the magazine from the reserve when it finishes. */
export function tickReload(gun, a) {
  if (a.reloadT <= 0) return;
  if (--a.reloadT > 0) return;
  const want = gun.def.mag - gun.ammo;
  const take = Math.min(want, gun.reserve ?? want);
  gun.ammo += take;
  if (gun.reserve !== undefined && gun.reserve !== Infinity) gun.reserve -= take;
}

export { dirOf };
