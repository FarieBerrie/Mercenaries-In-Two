import { createContractor, createEnemy, chest, ENEMY_TYPES, eye, isContractor } from './actors.js';
import { AGGRO, cameraOffset, CAMERA, HEALTH, PAL, STEP } from './config.js';
import { updateEnemy } from './enemies.js';
import { boxesNear, boxesOnRay, buildLevel, groundHeight, inArea, removeBox } from './level.js';
import { angleDiff, clamp, distXZ, rayBox, rayCylinder, yawTo } from './math.js';
import { nearestStandable, standable } from './nav.js';
import { updatePartner } from './partner.js';
import { updatePlayer } from './player.js';
import { createProgress, loadout } from './progress.js';
import { WEAPONS } from './weapons.js';

const dt = STEP;
const PAY = { area: 500, objective: 1000, headshot: 50, flank: 50, coopSnipe: 300 };
const USE_RANGE = 2.2;
const BOOST_FRAMES = 100;
const BACK_TO_BACK_FRAMES = 1200;

/**
 * One mission: the level, Hatch and Cruz, the enemies, and the rules that connect them. Drawing
 * and sound live elsewhere; `audio` only needs an optional sfx(name) method.
 */
export class Game {
  constructor({ input, audio = null, missionIndex = 0, progress = createProgress(), seed = 7, difficulty = 1 } = {}) {
    this.input = input;
    this.difficulty = difficulty; // scales the damage the contractors take
    this.audio = audio;
    this.progress = progress;
    this.loadout = loadout(progress);
    this.level = buildLevel(missionIndex, seed);
    this.missionIndex = missionIndex;
    this.mission = this.level.mission;
    this.checkpoint = 0; // area to restart from (the last one walked into)
    this.areas = this.level.areas.map(() => ({ triggered: false, wave: 0, cleared: false }));
    this.earned = 0;
    this.stats = { kills: 0, headshots: 0, flanks: 0, coopSnipes: 0, downs: 0, restarts: 0 };
    this.frame = 0;
    this.order = 'regroup'; // regroup | advance | hold
    this.quiet = false; // tests set this to stop areas sending waves
    this.listeners = new Set();
    this.reset();
  }

  /** (Re)start from the checkpoint: both contractors at the way into that area, fully armed. */
  reset() {
    const area = this.level.areas[this.checkpoint];
    const s = area.start;
    const fresh = this.checkpoint === 0 && !this.areas.some((a) => a.triggered || a.cleared);
    const yaw = fresh ? this.level.start.yaw : Math.atan2(area.center.z - s.z, area.center.x - s.x);
    const f = { x: Math.cos(yaw), z: Math.sin(yaw) };
    const r = { x: -f.z, z: f.x };
    const ph = nearestStandable(this.level, { x: s.x + r.x * 0.8, z: s.z + r.z * 0.8 }) || s;
    const pc = nearestStandable(this.level, { x: s.x - f.x * 1.4 - r.x * 1.6, z: s.z - f.z * 1.4 - r.z * 1.6 }) || s;
    this.hatch = createContractor('hatch', ph.x, ph.z, this.loadout);
    this.cruz = createContractor('cruz', pc.x, pc.z, this.loadout);
    for (const c of this.contractors) c.yaw = c.aimYaw = yaw;
    this.enemies = [];
    this.patrolsUp = false; // the patrols walking the roads come back too
    this.pickups = []; // ammo dropped by fallen enemies
    this.grenades = [];
    this.tracers = [];
    this.particles = [];
    this.popups = [];
    this.aggro = 0; // -100 (all on Cruz) .. 100 (all on Hatch)
    this.overkill = null; // { who, t }
    this.mode = 'play'; // play | boost | snipe | backToBack | complete | failed
    this.modeT = 0;
    this.timeScale = 1;
    this.shakeT = 0;
    this.hitMarker = 0;
    this.prompt = null;
    // Areas from the checkpoint on start over; objectives already done stay done.
    for (let i = this.checkpoint; i < this.areas.length; i++) {
      if (this.areas[i].cleared) continue;
      this.areas[i].triggered = false;
      this.areas[i].wave = 0;
      for (const o of this.level.areas[i].objectives) if (!o.done) o.progress = 0;
    }
    this.banner = { text: area.name, sub: this.mission.name, t: 180 };
  }

  restart() {
    this.stats.restarts++;
    this.reset();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  /** A sound, optionally from a place in the world (so it can be panned and faded with distance). */
  sfx(name, at = null) {
    this.audio?.sfx?.(name, at);
  }

  shake(n) {
    this.shakeT = Math.max(this.shakeT, n);
  }

  get contractors() {
    return [this.hatch, this.cruz];
  }

  partnerOf(c) {
    return c === this.hatch ? this.cruz : this.hatch;
  }

  // ---------------------------------------------------------------- update

  update() {
    this.frame++;
    this.modeT++;
    if (this.shakeT > 0) this.shakeT--;
    if (this.hitMarker > 0) this.hitMarker--;
    this.tracers = this.tracers.filter((t) => --t.life > 0);
    if (this.banner.t > 0) this.banner.t--;

    if (this.mode === 'complete' || this.mode === 'failed') {
      this.updateParticles();
      return;
    }
    if (this.mode === 'boost') {
      this.updateBoost();
      this.updateParticles();
      return;
    }

    this.prompt = null;
    if (!this.patrolsUp && !this.quiet) this.spawnPatrols();
    updatePlayer(this.hatch, this, this.input);
    updatePartner(this.cruz, this);
    for (const e of this.enemies) if (!e.dead) updateEnemy(e, this);
    this.enemies = this.enemies.filter((e) => !e.dead || e.deadT++ < 90);
    this.separateBodies();
    this.updateGrenades();
    this.updateAggro();
    this.updateContractors();
    this.updateAreas();
    if (this.mode === 'backToBack') this.updateBackToBack();
    this.updateParticles();
  }

  // ---------------------------------------------------------------- aggro

  /** Shooting draws attention: Hatch's shots push aggro toward him, Cruz's toward Cruz. */
  addAggro(c, amount) {
    if (this.overkill) return;
    this.aggro = clamp(this.aggro + (c === this.hatch ? amount : -amount), -AGGRO.max, AGGRO.max);
    if (Math.abs(this.aggro) >= AGGRO.max) {
      this.overkill = { who: this.aggro > 0 ? 'hatch' : 'cruz', t: AGGRO.overkillFrames };
      this.sfx('overkill');
      this.popupScreen('REDLINE', PAL.orange);
      this.emit('redline', this.overkill.who);
    }
  }

  updateAggro() {
    if (this.overkill) {
      if (--this.overkill.t <= 0) {
        this.overkill = null;
        this.aggro = 0;
      }
      return;
    }
    const quiet = Math.min(this.hatch.sinceShot, this.cruz.sinceShot) > 60;
    if (quiet) this.aggro -= Math.sign(this.aggro) * Math.min(Math.abs(this.aggro), AGGRO.decay * dt);
  }

  /** Hatch tells Cruz what to do: advance to forward cover, regroup on Hatch, or hold here. */
  giveOrder(order) {
    if (this.cruz.downed) return;
    this.order = order;
    this.cruz.holdAt = order === 'hold' ? { x: this.cruz.x, z: this.cruz.z } : null;
    this.cruz.cover = null;
    this.popup(this.cruz, { advance: 'MOVING UP!', regroup: 'ON YOU!', hold: 'HOLDING!' }[order], PAL.blue);
    this.sfx('order');
  }

  inOverkill(c) {
    return this.overkill?.who === c.who;
  }

  /** The other contractor during an Overkill: the enemies forget about them. */
  ghosted(c) {
    return !!this.overkill && this.overkill.who !== c.who;
  }

  /** Who an enemy should shoot at: someone it can see, chosen by aggro. */
  pickTarget(e) {
    const seen = this.contractors.filter((c) => !c.gone && this.canSee(e, c));
    if (!seen.length) return null;
    const visible = seen.filter((c) => !this.ghosted(c));
    const pool = visible.length ? visible : seen;
    if (pool.length === 1) return pool[0];
    let pHatch = clamp(0.5 + this.aggro / 160, 0.08, 0.92);
    if (this.hatch.downed) pHatch *= 0.35;
    if (this.cruz.downed) pHatch = 1 - (1 - pHatch) * 0.35;
    return Math.random() < pHatch ? this.hatch : this.cruz;
  }

  // ---------------------------------------------------------------- shooting

  /**
   * The first thing along a ray: a box, a body, or nothing. ignore is a set of actors to skip;
   * only actors on `team` are considered (null for everyone).
   */
  raycast(o, d, maxDist, { ignore = null, team = null } = {}) {
    let best = { t: maxDist, actor: null, box: null };
    for (const b of boxesOnRay(this.level, o, d, maxDist)) {
      const t = rayBox(o, d, b);
      if (t < best.t) best = { t, actor: null, box: b };
    }
    if (o.y + d.y * best.t < 0 && d.y < 0) best = { t: -o.y / d.y, actor: null, box: null, ground: true };
    const bodies = [...this.contractors, ...this.enemies];
    for (const a of bodies) {
      if (a.dead || a.gone || ignore?.has(a) || (team && a.team !== team)) continue;
      const t = rayCylinder(o, d, a.x, a.y, a.z, a.r, a.h);
      if (t < best.t) best = { t, actor: a, box: null };
    }
    best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }

  canSee(a, b) {
    const o = eye(a);
    const t = chest(b);
    const d = { x: t.x - o.x, y: t.y - o.y, z: t.z - o.z };
    const len = Math.hypot(d.x, d.y, d.z);
    if (len > 90) return false;
    const u = { x: d.x / len, y: d.y / len, z: d.z / len };
    for (const box of boxesOnRay(this.level, o, u, len)) {
      if (rayBox(o, u, box) < len - 0.05) return false;
    }
    return true;
  }

  /** Where the camera's crosshair is pointing, for the player's shots. */
  aimPoint(c) {
    const f = { x: Math.cos(c.aimYaw) * Math.cos(c.aimPitch), y: Math.sin(c.aimPitch), z: Math.sin(c.aimYaw) * Math.cos(c.aimPitch) };
    const r = { x: -Math.sin(c.aimYaw), z: Math.cos(c.aimYaw) };
    const e = eye(c);
    const { back, right } = cameraOffset(c.aimK ?? (c.aiming ? 1 : 0));
    const side = c.camSide ?? right;
    const cam = { x: e.x - f.x * back + r.x * side, y: e.y + CAMERA.up - f.y * back, z: e.z - f.z * back + r.z * side };
    // Start the ray level with the player, so nothing between the camera and him gets hit.
    const skip = back + 0.3;
    const start = { x: cam.x + f.x * skip, y: cam.y + f.y * skip, z: cam.z + f.z * skip };
    return this.raycast(start, f, 300, { ignore: new Set([this.hatch, this.cruz]) }).point;
  }

  /** The muzzle: just in front of the right shoulder. */
  muzzle(a) {
    const e = eye(a);
    const yaw = a.aimYaw ?? a.yaw;
    return { x: e.x + Math.cos(yaw) * 0.5 - Math.sin(yaw) * 0.22, y: e.y - 0.18, z: e.z + Math.sin(yaw) * 0.5 + Math.cos(yaw) * 0.22 };
  }

  /**
   * Fires a gun from `shooter` at a point, with the weapon's spread (scaled). Bullets hit the
   * first box or body on the other team along their path. Returns who was hit, if anyone.
   */
  fireAt(shooter, target, def, spreadScale = 1) {
    const from = this.muzzle(shooter);
    const base = { x: target.x - from.x, y: target.y - from.y, z: target.z - from.z };
    const len = Math.hypot(base.x, base.y, base.z) || 1;
    const enemyTeam = isContractor(shooter) ? 'hostile' : 'contractors';
    const pellets = def.pellets || 1;
    let landed = null;
    for (let i = 0; i < pellets; i++) {
      const s = def.spread * spreadScale;
      const d = {
        x: base.x / len + (Math.random() - 0.5) * 2 * s,
        y: base.y / len + (Math.random() - 0.5) * 2 * s,
        z: base.z / len + (Math.random() - 0.5) * 2 * s,
      };
      const dl = Math.hypot(d.x, d.y, d.z);
      d.x /= dl;
      d.y /= dl;
      d.z /= dl;
      // The contractors' rounds pass each other by (no shooting through your partner's back);
      // enemy rounds stop at whoever is in the way.
      const hit = this.raycast(from, d, def.range ?? 120, { ignore: new Set([shooter]), team: isContractor(shooter) ? 'hostile' : null });
      const friendly = hit.actor && hit.actor.team !== enemyTeam;
      if (hit.actor && !friendly) {
        landed = hit.actor;
        this.hurt(hit.actor, def.damage, shooter, hit.point);
      }
      // What the bullet hit, for impact effects: a body, a box (and which), the ground or nothing
      const impact = hit.actor ? 'flesh' : hit.box ? 'box' : hit.ground ? 'ground' : 'air';
      this.tracers.push({ from, to: hit.point, life: 5, hostile: !isContractor(shooter), impact, box: hit.box, shooter, heavy: def.damage >= 100 });
    }
    if (isContractor(shooter)) {
      shooter.sinceShot = 0;
      this.addAggro(shooter, AGGRO.perShot + (landed ? AGGRO.perHit : 0));
    }
    return landed;
  }

  /** Damage from a gun, with headshots, flanking, armour and Overkill applied. */
  hurt(target, amount, source, point) {
    if (isContractor(target)) return this.hurtContractor(target, amount, source);
    if (target.dead) return;
    if (target.alert === false) this.alertSquad(target);
    const def = ENEMY_TYPES[target.type];
    let dmg = amount;
    const fromShooter = yawTo(target, source);
    const off = Math.abs(angleDiff(target.yaw, fromShooter)); // 0 = shot from the front
    const head = point && point.y > target.y + target.h - 0.3 * target.size;
    let tag = null;
    if (def.armored) {
      if (off < 1.1) {
        dmg *= 0.15;
        tag = 'ARMOR';
      } else {
        dmg *= 1.6;
        tag = 'FLANKED';
      }
    } else {
      if (head) {
        dmg *= 2.2;
        tag = 'HEADSHOT';
      }
      if (off > 2.0) {
        dmg *= 1.5;
        tag = tag || 'FLANKED';
      }
    }
    if (this.inOverkill(source)) dmg *= 1.6;
    target.hp -= dmg;
    target.flash = 4;
    target.hitBy = source;
    if (source === this.hatch) this.hitMarker = 8;
    this.addParticles(point || chest(target), 4, ['#a02020', '#601010'], 2);
    if (target.hp <= 0) this.killEnemy(target, source, tag);
    else if (tag === 'ARMOR' && source === this.hatch && Math.random() < 0.1) this.popup(target, 'ARMOR - FLANK HIM', PAL.grey);
  }

  hurtContractor(c, amount, source) {
    if (c.gone || this.mode === 'boost') return;
    let dmg = amount * this.difficulty;
    if (this.inOverkill(c)) dmg *= 0.5;
    if (c.downed) {
      c.bleed -= dmg * 6; // getting shot while down shortens the clock
      return;
    }
    c.hp -= dmg;
    c.sinceHit = 0;
    c.flash = 4;
    // Where it came from, for the damage direction indicator
    if (source && source.x !== undefined) c.hitFrom = { x: source.x, z: source.z, frame: this.frame };
    if (c === this.hatch) this.shake(4);
    if (c.hp <= 0) this.downContractor(c);
  }

  downContractor(c) {
    c.hp = 0;
    c.downed = true;
    c.bleed = HEALTH.bleedOut;
    c.crouch = true;
    c.sprint = false;
    c.aiming = false;
    c.reloadT = 0;
    c.weapon = 'pistol';
    this.stats.downs++;
    this.sfx('down', c);
    this.popup(c, c === this.hatch ? 'HATCH IS DOWN' : 'CRUZ IS DOWN', PAL.red);
    this.emit('down', c);
    if (this.mode === 'snipe') this.leaveNest();
  }

  revive(c) {
    c.downed = false;
    c.hp = c.maxHp * HEALTH.revivedHealth;
    c.crouch = false;
    c.weapon = 'rifle';
    c.sinceHit = 0;
    c.reviving = 0;
    this.sfx('revive', c);
    this.popup(c, 'BACK ON YOUR FEET', PAL.green);
    this.emit('revive', c);
  }

  killEnemy(e, source, tag) {
    e.dead = true;
    e.deadT = 0;
    const def = ENEMY_TYPES[e.type];
    let pay = def.pay;
    if (tag === 'HEADSHOT') {
      pay += PAY.headshot;
      this.stats.headshots++;
    }
    if (tag === 'FLANKED') {
      pay += PAY.flank;
      this.stats.flanks++;
    }
    this.stats.kills++;
    this.earned += pay;
    this.popup(e, `$${pay}${tag && tag !== 'ARMOR' ? ` ${tag}` : ''}`, PAL.yellow);
    if (Math.random() < (def.boss ? 1 : 0.55)) this.pickups.push({ x: e.x, y: e.y, z: e.z, kind: 'ammo', t: 0 });
    this.sfx(def.boss ? 'bossDown' : 'kill', e);
    this.emit('kill', { enemy: e, source, tag, pay });
    if (def.boss) {
      this.shake(18);
      this.explode(chest(e), 0, null);
    }
  }

  /** Bodies don't walk through each other: overlapping pairs are pushed apart. */
  separateBodies() {
    const bodies = [...this.contractors.filter((c) => !c.gone), ...this.enemies.filter((e) => !e.dead)];
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (Math.abs(a.y - b.y) > 1.5) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = a.r + b.r;
        if (d >= min) continue;
        const nx = d > 1e-4 ? dx / d : 1;
        const nz = d > 1e-4 ? dz / d : 0;
        const push = (min - d) / 2;
        for (const [body, k] of [[a, -push], [b, push]]) {
          const x = body.x + nx * k;
          const z = body.z + nz * k;
          if (!this.solidAt(x, body.y + 0.5, z)) {
            body.x = x;
            body.z = z;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- grenades

  throwGrenade(thrower, dir, speed = 15) {
    const from = eye(thrower);
    this.grenades.push({ x: from.x, y: from.y, z: from.z, vx: dir.x * speed, vy: dir.y * speed + 4, vz: dir.z * speed, fuse: WEAPONS.grenade.fuse, team: thrower.team, owner: thrower });
    this.sfx('throw', thrower);
    thrower.throwT = 20; // for the throwing animation
  }

  updateGrenades() {
    for (const g of this.grenades) {
      g.vy -= 20 * dt;
      const nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      const nz = g.z + g.vz * dt;
      // Bounce off the ground and boxes, losing speed
      const floor = groundHeight(this.level, nx, nz, 0.05, g.y);
      if (ny < floor + 0.1) {
        g.vy = Math.abs(g.vy) * 0.35;
        g.vx *= 0.6;
        g.vz *= 0.6;
        g.y = floor + 0.1;
      } else g.y = ny;
      if (this.solidAt(nx, g.y, g.z)) g.vx *= -0.4;
      else g.x = nx;
      if (this.solidAt(g.x, g.y, nz)) g.vz *= -0.4;
      else g.z = nz;
      if (--g.fuse <= 0) this.explode(g, WEAPONS.grenade.damage, g);
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0);
  }

  solidAt(x, y, z) {
    for (const b of boxesNear(this.level, x, x, z, z)) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1) return true;
    return false;
  }

  /** An explosion; grenades only hurt the side that didn't throw them. */
  explode(at, damage, grenade) {
    this.sfx('boom', at);
    this.shake(12);
    this.emit('explosion', { x: at.x, y: at.y, z: at.z });
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 6;
      this.particles.push({ x: at.x, y: at.y + 0.3, z: at.z, vx: Math.cos(a) * s, vy: Math.random() * 6, vz: Math.sin(a) * s, life: 20 + Math.random() * 25, color: ['#ffd060', '#ff8a30', '#e03a2a', '#3a3a3a'][i % 4], size: 0.35, gravity: 6 });
    }
    if (!damage) return;
    const R = WEAPONS.grenade.radius;
    const victims = grenade.team === 'contractors' ? this.enemies.filter((e) => !e.dead) : this.contractors;
    for (const v of victims) {
      const d = Math.hypot(v.x - at.x, v.y + 0.8 - at.y, v.z - at.z);
      if (d > R) continue;
      const dmg = damage * (1 - d / R);
      if (isContractor(v)) this.hurtContractor(v, dmg * 0.45, grenade.owner);
      else {
        if (v.alert === false) this.alertSquad(v);
        v.hp -= dmg;
        v.flash = 4;
        if (v.hp <= 0) this.killEnemy(v, grenade.owner, null);
      }
    }
  }

  // ---------------------------------------------------------------- the contractors

  /** Walking over dropped ammo picks it up. */
  updatePickups() {
    for (const k of this.pickups) {
      k.t++;
      for (const c of this.contractors) {
        if (k.taken || c.downed || distXZ(c, k) > 1.4 || Math.abs(c.y - k.y) > 1.5) continue;
        const rifle = c.guns.rifle;
        if (rifle.reserve >= rifle.def.reserve + rifle.def.mag) continue;
        rifle.reserve = Math.min(rifle.def.reserve + rifle.def.mag, rifle.reserve + rifle.def.mag);
        k.taken = true;
        if (c === this.hatch) {
          this.popup(c, '+AMMO', PAL.white);
          this.sfx('pickup');
        }
      }
    }
    this.pickups = this.pickups.filter((k) => !k.taken && k.t < 60 * 60);
  }

  /** Full ammo and grenades: at each cleared area. */
  resupply() {
    for (const c of this.contractors) {
      c.guns.rifle.reserve = Math.max(c.guns.rifle.reserve, c.guns.rifle.def.reserve);
      c.grenades = Math.max(c.grenades, c.maxGrenades);
    }
  }

  updateContractors() {
    this.updatePickups();
    for (const c of this.contractors) {
      c.sinceHit++;
      c.sinceShot++;
      if (c.flash > 0) c.flash--;
      if (c.downed) {
        if (--c.bleed <= 0 && !c.gone) {
          c.gone = true;
          this.fail(`${c === this.hatch ? 'HATCH' : 'CRUZ'} BLED OUT`);
        }
      } else if (c.sinceHit > HEALTH.regenDelay && c.hp < c.maxHp) {
        c.hp = Math.min(c.maxHp, c.hp + HEALTH.regenRate * dt);
      }
    }
    if (this.hatch.downed && this.cruz.downed) this.fail('YOU BOTH WENT DOWN');
  }

  fail(reason) {
    if (this.mode === 'failed') return;
    this.mode = 'failed';
    this.modeT = 0;
    this.failReason = reason;
    this.timeScale = 1;
    this.sfx('fail');
    this.emit('failed', reason);
  }

  // ---------------------------------------------------------------- areas and objectives

  enemiesIn(index) {
    return this.enemies.filter((e) => !e.dead && e.area === index);
  }

  /**
   * The area that matters right now: the one you're fighting in (the nearest, if more than one
   * is live), else the next one to take along the contract's route; -1 once everything's taken.
   */
  focusArea() {
    const h = this.hatch;
    let best = -1;
    let bestD = Infinity;
    for (const a of this.level.areas) {
      const st = this.areas[a.index];
      if (!st.triggered || st.cleared) continue;
      const d = distXZ(h, a.center);
      if (d < bestD) {
        best = a.index;
        bestD = d;
      }
    }
    if (best >= 0) return best;
    return this.areas.findIndex((st) => !st.cleared);
  }

  /** Is every area taken (so the helicopter can come)? */
  get allClear() {
    return this.areas.every((st) => st.cleared);
  }

  updateAreas() {
    const h = this.hatch;
    this.level.areas.forEach((area, i) => {
      const st = this.areas[i];
      if (!st.triggered && !st.cleared && !this.quiet && !h.downed && this.mode === 'play' && inArea(area, h, area.triggerPad)) this.triggerArea(i);
      if (!st.triggered || st.cleared) return;
      const alive = this.enemiesIn(i).length;
      const waves = area.spec.waves;
      if (st.wave < waves.length - 1 && alive <= 2 && this.mode !== 'backToBack' && !this.quiet) {
        st.wave++;
        this.spawnWave(i, st.wave);
      }
      const objectivesDone = area.objectives.every((o) => o.done);
      if (st.wave >= waves.length - 1 && alive === 0 && objectivesDone && this.mode !== 'backToBack') this.clearArea(i);
    });

    // Extraction: every area taken, and Hatch at the pickup point
    const end = this.level.areas[this.level.areas.length - 1];
    if (end.extract && this.allClear && distXZ(h, end.extract) < 5 && !h.downed && !this.cruz.downed) this.complete();
  }

  triggerArea(i) {
    const area = this.level.areas[i];
    const st = this.areas[i];
    st.triggered = true;
    st.wave = 0;
    this.checkpoint = i;
    this.banner = { text: area.name, sub: this.mission.name, t: 180 };
    this.sfx('area');
    this.emit('areaTriggered', i);
    if (area.spec.backToBack) {
      this.startBackToBack(i);
      return;
    }
    this.spawnWave(i, 0);
    if (area.spec.boss) this.spawnBoss(area);
    if (area.spec.snipe) {
      for (const t of area.targets) {
        const e = createEnemy('sniper', t.x, t.z);
        e.y = t.y;
        e.area = i;
        e.tower = true;
        this.enemies.push(e);
      }
    }
  }

  spawnBoss(area) {
    const at = area.bossAt || area.center;
    const e = createEnemy(area.spec.boss, at.x, at.z);
    e.area = area.index;
    e.home = { x: at.x, z: at.z };
    e.yaw = yawTo(e, this.hatch);
    this.enemies.push(e);
    this.boss = e;
    this.popupScreen(ENEMY_TYPES[area.spec.boss].name, PAL.red);
  }

  /** A wave comes in at the area's spawn points: out of sight, and not right on top of you. */
  spawnWave(i, wave) {
    const area = this.level.areas[i];
    const h = this.hatch;
    const shuffle = (list) => list.map((s) => [Math.random(), s]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
    const far = shuffle(area.spawns.filter((s) => distXZ(h, s) >= 18));
    const near = shuffle(area.spawns.filter((s) => distXZ(h, s) < 18));
    const spots = [...far, ...near];
    let k = 0;
    for (const [type, count] of area.spec.waves[wave] || []) {
      for (let n = 0; n < count; n++) {
        const s = spots[k++ % spots.length];
        const e = createEnemy(type, s.x, s.z);
        e.area = i;
        e.home = { x: s.x, z: s.z };
        e.yaw = yawTo(e, h);
        this.enemies.push(e);
      }
    }
  }

  /** Squads walking their routes between the areas, until they see or hear you. */
  spawnPatrols() {
    this.patrolsUp = true;
    this.level.patrols.forEach((p, k) => {
      p.squad.forEach((type, n) => {
        const at = nearestStandable(this.level, { x: p.route[0].x - n * 1.6, z: p.route[0].z + (n % 2 ? 1.2 : -1.2) }) || p.route[0];
        const e = createEnemy(type, at.x, at.z);
        e.area = -1;
        e.alert = false;
        e.patrol = { route: p.route, i: 1 % p.route.length, squad: k, slot: n };
        e.home = { x: at.x, z: at.z };
        e.yaw = yawTo(e, p.route[e.patrol.i]);
        this.enemies.push(e);
      });
    });
  }

  /** Someone in a patrol has seen or heard you: the whole squad knows. */
  alertSquad(e) {
    if (e.alert !== false) return;
    for (const o of this.enemies) if (!o.dead && o.patrol && o.patrol.squad === e.patrol.squad) o.alert = true;
    this.sfx('alert', e);
  }

  clearArea(i) {
    const area = this.level.areas[i];
    const st = this.areas[i];
    st.cleared = true;
    this.earned += PAY.area;
    this.resupply();
    this.checkpoint = i;
    const gate = area.gate && area.gate.kind === 'gate' && !area.gate.removed ? area.gate : null;
    if (gate) removeBox(this.level, gate);
    if (this.allClear && this.level.areas.some((a) => a.extract)) this.popupScreen('ALL CLEAR - GET TO THE EXTRACTION POINT', PAL.green);
    else if (gate) this.popupScreen('AREA CLEAR - THE GATE IS OPEN', PAL.green);
    else if (area.boost) this.popupScreen('AREA CLEAR - GIVE HATCH A LEG-UP', PAL.green);
    else this.popupScreen('AREA CLEAR', PAL.green);
    if (area.spec.boss) this.boss = null;
    this.sfx('clear');
    this.emit('areaCleared', i);
  }

  complete() {
    this.mode = 'complete';
    this.modeT = 0;
    this.earned += this.mission.pay;
    this.sfx('complete');
    this.emit('complete');
  }

  /** What Hatch can use right now (revive, objective, boost, nest), for prompts and the Use key. */
  usable(c) {
    const partner = this.partnerOf(c);
    if (partner.downed && !partner.gone && distXZ(c, partner) < USE_RANGE) return { kind: 'revive', target: partner, label: `HOLD E: REVIVE ${partner.who.toUpperCase()}` };
    for (const area of this.level.areas) {
      for (const o of area.objectives) {
        if (!o.done && distXZ(c, o) < USE_RANGE + 0.6) return { kind: 'objective', target: o, label: o.kind === 'plant' ? 'HOLD E: SET CHARGE' : 'HOLD E: FREE THE HOSTAGE' };
      }
    }
    for (const area of this.level.areas) {
      const i = area.index;
      if (area.boost && this.areas[i].cleared && distXZ(c, area.boost) < 3.5) return { kind: 'boost', target: area, label: 'PRESS E: LEG-UP' };
      if (area.nest && this.areas[i].triggered && distXZ(c, area.nest) < 4 && this.mode === 'play' && area.targets.length && this.enemiesIn(i).some((e) => e.tower)) {
        return { kind: 'nest', target: area, label: 'PRESS E: SYNC SHOT' };
      }
    }
    return null;
  }

  /** Holding Use on an objective or a downed partner; returns true while something's in progress. */
  holdUse(c, thing) {
    if (thing.kind === 'revive') {
      const p = thing.target;
      p.reviving = (p.reviving || 0) + 1;
      if (p.reviving >= HEALTH.reviveTime) this.revive(p);
      return true;
    }
    if (thing.kind === 'objective') {
      const o = thing.target;
      if (++o.progress >= 120) {
        o.done = true;
        this.earned += PAY.objective;
        if (o.kind === 'plant') {
          this.popupScreen('CHARGE SET', PAL.yellow);
          this.sfx('plant', o);
          o.blowAt = this.frame + 150;
        } else {
          this.popupScreen('HOSTAGE FREED', PAL.green);
          this.sfx('clear');
        }
      }
      return true;
    }
    return false;
  }

  /** Planted charges go off a little after they're set. */
  updateCharges() {
    for (const area of this.level.areas) {
      for (const o of area.objectives) {
        if (o.blowAt && this.frame >= o.blowAt) {
          o.blowAt = null;
          o.blown = true;
          this.explode({ x: o.x + 2.4, y: 1.5, z: o.z }, 0, null);
          this.emit('targetDestroyed', o);
          this.shake(20);
        }
      }
    }
  }

  // ---------------------------------------------------------------- co-op moves

  /** Step-jump: Cruz braces, Hatch goes up and over, then pulls Cruz up after him. */
  startBoost(area) {
    this.mode = 'boost';
    this.modeT = 0;
    this.boostArea = area;
    this.boostFrom = { hatch: { x: this.hatch.x, z: this.hatch.z }, cruz: { x: this.cruz.x, z: this.cruz.z } };
    this.sfx('boost');
  }

  updateBoost() {
    const a = this.boostArea;
    const k = Math.min(1, this.modeT / BOOST_FRAMES);
    const h = this.hatch;
    const c = this.cruz;
    const B = a.boost;
    const wallTop = B.wall?.y1 ?? 3.4;
    // Into the wall, and to its right
    const len = Math.hypot(B.landing.x - B.x, B.landing.z - B.z) || 1;
    const f = { x: (B.landing.x - B.x) / len, z: (B.landing.z - B.z) / len };
    const r = { x: -f.z, z: f.x };
    // Cruz kneels at the wall; Hatch steps on him, goes over, and Cruz follows.
    c.x = B.x - f.x * 0.5 + r.x * 0.8;
    c.z = B.z - f.z * 0.5 + r.z * 0.8;
    c.crouch = k < 0.6;
    h.x = k < 0.5 ? B.x : B.landing.x;
    h.z = k < 0.5 ? B.z : B.landing.z;
    h.y = k < 0.5 ? wallTop * (k / 0.5) : Math.max(0, wallTop * (1 - (k - 0.5) / 0.2));
    h.anim = 'boost';
    c.anim = 'boost';
    if (k >= 1) {
      h.x = B.landing.x;
      h.z = B.landing.z;
      h.y = 0;
      const pc = nearestStandable(this.level, { x: B.landing.x - f.x + r.x * 1.5, z: B.landing.z - f.z + r.z * 1.5 }) || B.landing;
      c.x = pc.x;
      c.z = pc.z;
      c.y = 0;
      c.crouch = false;
      this.mode = 'play';
      this.popupScreen('OVER THE WALL', PAL.green);
    }
  }

  /** Co-op snipe: both of you up in the nest with marksman rifles. */
  enterNest(area) {
    this.mode = 'snipe';
    this.modeT = 0;
    this.nestArea = area;
    const n = area.nest;
    const h = this.hatch;
    h.x = n.x;
    h.z = n.z;
    h.y = n.y;
    h.vx = h.vz = 0;
    h.weapon = 'sniper';
    h.reloadT = 0; // a rifle reload doesn't carry over to the marksman rifle
    h.aiming = true;
    h.crouch = false;
    // Facing the towers
    const tx = area.targets.reduce((sum, t) => sum + t.x, 0) / area.targets.length;
    const tz = area.targets.reduce((sum, t) => sum + t.z, 0) / area.targets.length;
    h.aimYaw = Math.atan2(tz - n.z, tx - n.x);
    h.aimPitch = 0.02;
    const c = this.cruz;
    c.x = n.x - 1.5;
    c.z = n.z + 0.8;
    c.y = n.y;
    c.weapon = 'sniper';
    this.popupScreen('SYNC SHOT: FIRE AND CRUZ FIRES WITH YOU', PAL.blue);
    this.sfx('select');
  }

  leaveNest() {
    if (this.mode !== 'snipe') return;
    this.mode = 'play';
    for (const c of this.contractors) {
      if (!c.downed) c.weapon = 'rifle';
      c.aiming = false;
    }
  }

  /** When Hatch fires from the nest, Cruz drops a second target at the same instant. */
  coopSnipe(hit) {
    const area = this.nestArea;
    const others = this.enemiesIn(area.index).filter((e) => e.tower && !e.dead && e !== hit);
    if (!others.length) return;
    const t = others[0];
    this.tracers.push({ from: this.muzzle(this.cruz), to: chest(t), life: 8, hostile: false });
    this.killEnemy(t, this.cruz, 'HEADSHOT');
    if (hit?.dead) {
      this.stats.coopSnipes++;
      this.earned += PAY.coopSnipe;
      this.popupScreen(`SYNC SHOT +$${PAY.coopSnipe}`, PAL.blue);
    }
    if (!this.enemiesIn(area.index).some((e) => e.tower)) this.leaveNest();
  }

  /** Back-to-back: surrounded, the two of you stand together and the world slows down. */
  startBackToBack(i) {
    const area = this.level.areas[i];
    this.mode = 'backToBack';
    this.modeT = 0;
    this.timeScale = 0.55;
    const at = area.ambush || area.center;
    const cx = at.x;
    const cz = at.z;
    for (const [c, side] of [[this.hatch, -1], [this.cruz, 1]]) {
      c.x = cx;
      c.z = cz + side * 0.45;
      c.y = 0;
      c.vx = c.vz = 0;
      c.crouch = false;
      c.weapon = 'rifle';
    }
    this.hatch.aimYaw = 0;
    this.cruz.yaw = Math.PI;
    this.b2bCenter = { x: cx, z: cz };
    // A ring of attackers, out past the nearest cover
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      let r = 15;
      let x = cx + Math.cos(a) * r;
      let z = cz + Math.sin(a) * r * 0.9;
      for (let tries = 0; tries < 10 && (groundHeight(this.level, x, z, 0.5) > 0 || !standable(this.level, { x, z })); tries++) {
        r -= 1;
        x = cx + Math.cos(a) * r;
        z = cz + Math.sin(a) * r * 0.9;
      }
      const e = createEnemy(k % 4 === 3 ? 'shotgunner' : 'rifleman', x, z);
      e.area = i;
      e.home = { x, z };
      e.yaw = yawTo(e, this.b2bCenter);
      this.enemies.push(e);
    }
    this.popupScreen('SURROUNDED', PAL.orange);
    this.sfx('overkill');
  }

  updateBackToBack() {
    const area = this.level.areas[this.areas.findIndex((s, i) => s.triggered && !s.cleared && this.level.areas[i].spec.backToBack)];
    // Unlimited ammo while it lasts
    for (const c of this.contractors) c.guns.rifle.ammo = Math.max(c.guns.rifle.ammo, 5);
    const left = this.enemiesIn(area?.index ?? -1).length;
    if (left === 0 || this.modeT > BACK_TO_BACK_FRAMES) {
      this.mode = 'play';
      this.timeScale = 1;
      this.popupScreen('BREAKOUT: CLEAR', PAL.green);
      if (area) {
        if (area.spec.boss) this.spawnBoss(area);
        this.spawnWave(area.index, 0);
      }
    }
  }

  // ---------------------------------------------------------------- effects

  addParticles(at, n, colors, speed = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * speed + 0.4;
      this.particles.push({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: Math.random() * speed + 0.5, vz: Math.sin(a) * s, life: 14 + Math.random() * 14, color: colors[i % colors.length], size: 0.12, gravity: 12 });
    }
  }

  popup(a, text, color) {
    this.popups.push({ x: a.x, y: a.y + (a.h || 1.8) + 0.4, z: a.z, text, color, t: 70 });
  }

  popupScreen(text, color) {
    this.popups.push({ screen: true, text, color, t: 150 });
  }

  updateParticles() {
    this.updateCharges();
    for (const p of this.particles) {
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.life--;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.t--;
      if (!p.screen) p.y += 0.015;
    }
    this.popups = this.popups.filter((p) => p.t > 0);
  }

  get bossActive() {
    return !!this.boss && !this.boss.dead;
  }
}

