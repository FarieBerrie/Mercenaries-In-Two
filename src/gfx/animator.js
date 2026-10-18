// Bringing a person to life each frame, in layers:
//   1. Motion capture for the legs and body: idle, walk, run and sprint clips blended by speed and
//      phase-locked to how fast the actor is really moving (stride measured from the clips), so
//      feet don't skate. Moving sideways turns the hips toward the movement; moving backwards
//      plays the cycle in reverse.
//   2. Crouching and kneeling: the pelvis drops and two-bone IK keeps the feet planted.
//   3. The upper body turns and bends toward the aim, bladed so the support hand reaches the
//      gun; the gun sits in the shoulder pocket (or out at arm's length for a pistol, at the hip
//      for the rotary gun) and both hands are solved onto it, fingers curled round the grips.
//   4. Reloads (the magazine really comes out), recoil, grenade throws, flinches when hit, the
//      head looking along the aim.
// Death hands the body to the ragdoll (ragdoll.js).
import * as THREE from 'three/webgpu';
import { rotateWorld, twoBoneIK, UP, worldPos, worldQuat } from './rig.js';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (k) => k * k * (3 - 2 * k);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Locomotion clips and the speed band each covers (m/s). */
const GAITS = ['walk', 'walkFast', 'run', 'sprint'];

const strideCache = new Map();

/**
 * Measures a looping locomotion clip on a model: the ground speed its feet imply (how fast a
 * planted foot slides back), and the phase at which the left foot is furthest forward.
 */
function measureGait(rig, inner, clip) {
  const key = `${rig.type}:${clip.name}`;
  if (strideCache.has(key)) return strideCache.get(key);
  const mixer = new THREE.AnimationMixer(inner);
  const action = mixer.clipAction(clip);
  action.play();
  const N = 48;
  const samples = [];
  inner.updateMatrixWorld(true);
  const fwd = rig.forward.clone().applyQuaternion(worldQuat(inner));
  for (let i = 0; i <= N; i++) {
    mixer.setTime((i / N) * clip.duration);
    inner.updateMatrixWorld(true);
    const hip = worldPos(rig.hips);
    const out = {};
    for (const s of ['L', 'R']) {
      const f = worldPos(rig.legs[s].foot).sub(hip);
      out[s] = { x: f.dot(fwd), y: worldPos(rig.legs[s].foot).y };
    }
    samples.push(out);
  }
  action.stop();
  mixer.uncacheRoot(inner);
  // Planted foot: near its lowest point; its backward slide rate is the walking speed
  let speed = 0;
  let n = 0;
  for (const s of ['L', 'R']) {
    const minY = Math.min(...samples.map((p) => p[s].y));
    for (let i = 0; i < N; i++) {
      const a = samples[i][s];
      const b = samples[i + 1][s];
      if (a.y < minY + 0.03 && b.y < minY + 0.03) {
        speed += (a.x - b.x) / (clip.duration / N);
        n++;
      }
    }
  }
  speed = n ? speed / n : 1.4;
  let best = -Infinity;
  let offset = 0;
  samples.forEach((p, i) => {
    if (p.L.x > best) {
      best = p.L.x;
      offset = i / N;
    }
  });
  const r = { speed: Math.max(0.5, speed), offset };
  strideCache.set(key, r);
  return r;
}

/** A spring for flinches and recoil: a 3-vector of angles that settles back to zero. */
class Spring {
  constructor(k = 120, d = 14) {
    this.x = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.k = k;
    this.d = d;
  }
  kick(x, y, z) {
    this.v.x += x;
    this.v.y += y;
    this.v.z += z;
  }
  step(dt) {
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.v.addScaledVector(this.x, -this.k * h);
      this.v.multiplyScalar(Math.max(0, 1 - this.d * h));
      this.x.addScaledVector(this.v, h);
    }
  }
}

export class Animator {
  /**
   * model: { outer, inner, rig }; clips: name → AnimationClip; gun: from makeGun (or null);
   * guns: every gun this person carries, by weapon name.
   */
  constructor(model, clips, { guns = {}, gunFor = () => null, scale = 1 } = {}) {
    this.model = model;
    this.rig = model.rig;
    this.inner = model.inner;
    this.guns = guns;
    this.gunFor = gunFor;
    this.scale = scale;
    this.mixer = new THREE.AnimationMixer(this.inner);
    this.actions = {};
    this.gait = {};
    const animated = new Set();
    for (const [name, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(0);
      this.actions[name] = action;
      for (const t of clip.tracks) animated.add(t.name);
      if (GAITS.includes(name)) {
        this.gait[name] = measureGait(this.rig, this.inner, clip);
        // The clip knows how fast the performer really moved; that beats measuring the feet
        if (clip.userData?.speed > 0.3) this.gait[name] = { ...this.gait[name], speed: clip.userData.speed };
      }
    }
    // The gaits this rig has, slowest first
    this.gaits = GAITS.filter((g) => this.actions[g]).sort((a, b) => this.gait[a].speed - this.gait[b].speed);
    this.rig.rememberRest(animated);
    this.phase = Math.random();
    this.idleT = Math.random() * 10;
    this.hipYaw = 0;
    this.backwards = false;
    this.crouchK = 0;
    this.aimK = 0;
    this.sprintK = 0;
    this.downK = 0;
    this.useK = 0;
    this.weights = {};
    this.flinch = new Spring(140, 12);
    this.recoil = new Spring(260, 20);
    this.lastFlash = 0;
    this.lastShot = 999;
    this.prevPhase = 0;
    this.headFwdLocal = null;
    this.chestFrame = null;
    this.gunWorld = new THREE.Matrix4();
  }

  /** Sets every clip's weight, crossfading toward targets. */
  blend(targets, dt) {
    const k = 1 - Math.exp(-10 * dt);
    for (const [name, action] of Object.entries(this.actions)) {
      const w = (this.weights[name] ?? 0) + ((targets[name] ?? 0) - (this.weights[name] ?? 0)) * k;
      this.weights[name] = w;
      action.setEffectiveWeight(w);
    }
  }

  /**
   * Poses the model for an actor. a: the actor (game state); dt: seconds; ctx: { pitch, time,
   * unarmed, bound, ground }. Returns true on the frame a foot lands.
   */
  update(a, dt, ctx = {}) {
    const rig = this.rig;
    const { outer, inner } = this.model;
    const anim = a.anim;
    const yaw = a.yaw ?? 0;
    const vx = a.vx || 0;
    const vz = a.vz || 0;
    const speed = Math.hypot(vx, vz) / this.scale;
    const downed = !!a.downed || anim === 'downed';
    const crouched = !downed && ((a.crouch && anim !== 'sprint') || anim === 'crouch' || anim === 'crouchWalk');
    const using = anim === 'use' || anim === 'boost';
    const sprinting = anim === 'sprint';
    const vaulting = anim === 'vault';
    const ease = (cur, target, rate) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
    this.crouchK = ease(this.crouchK, crouched || using || ctx.bound ? 1 : 0, 9);
    this.downK = ease(this.downK, downed ? 1 : 0, 6);
    this.sprintK = ease(this.sprintK, sprinting ? 1 : 0, 8);
    this.useK = ease(this.useK, using ? 1 : 0, 8);

    // ---- 1. legs: which gait, how far through its cycle, which way the hips face
    const moveYaw = Math.atan2(vz, vx);
    let rel = speed > 0.3 ? wrap(moveYaw - yaw) : 0;
    let back = false;
    if (Math.abs(rel) > Math.PI * 0.6) {
      back = true;
      rel = wrap(rel - Math.PI);
    }
    const hipTarget = clamp(rel, -1.1, 1.1) * (sprinting ? 0.3 : 1);
    this.hipYaw += wrap(hipTarget - this.hipYaw) * (1 - Math.exp(-8 * dt));
    this.backwards = back;

    const w = { idle: 0, walk: 0, walkFast: 0, run: 0, sprint: 0, crouchIdle: 0, injured: 0, idleNervous: 0, idleLook: 0 };
    let gaitSpeed = 1;
    let move = 0;
    if (speed > 0.25 && !using && !vaulting && this.gaits.length) {
      move = clamp((speed - 0.25) / 0.6, 0, 1);
      // Blend the two gaits either side of this speed, so stride length grows with speed and
      // the cadence stays natural
      const list = this.gaits;
      const sp = (g) => this.gait[g].speed;
      let lo = list[0];
      for (const g of list) if (sp(g) <= speed) lo = g;
      const hi = list[Math.min(list.length - 1, list.indexOf(lo) + 1)];
      const k = hi === lo || speed <= sp(list[0]) ? 0 : clamp((speed - sp(lo)) / (sp(hi) - sp(lo)), 0, 1);
      w[lo] += (1 - k) * move;
      w[hi] += k * move;
      gaitSpeed = sp(lo) + (sp(hi) - sp(lo)) * k;
    }
    if (ctx.bound) w.crouchIdle = 1;
    else if (ctx.freed) w.idleNervous = 1;
    else if (crouched || using || downed) w.crouchIdle = 1 - move;
    else w.idle = 1 - move;
    this.blend(w, dt);

    // Phase-locked cycle: advance by distance covered over the clips' stride
    const rate = clamp(speed / gaitSpeed, 0.6, 1.6);
    const prev = this.phase;
    if (move > 0) this.phase = (this.phase + ((back ? -1 : 1) * dt * rate) / this.cycle(w)) % 1;
    if (this.phase < 0) this.phase += 1;
    for (const g of GAITS) {
      const action = this.actions[g];
      if (!action) continue;
      action.time = ((this.phase + this.gait[g].offset) % 1) * action.getClip().duration;
    }
    for (const n of ['idle', 'crouchIdle', 'idleNervous', 'idleLook']) {
      const action = this.actions[n];
      if (action) action.time = (this.idleT % action.getClip().duration);
    }
    this.idleT += dt;
    const stepped = move > 0.5 && Math.floor(prev * 2) !== Math.floor(this.phase * 2);

    rig.resetUnanimated();
    // The mixer skips writing any value that didn't change since last frame, which would leave
    // last frame's procedural adjustments in place to pile up. Spoil last frame's results so
    // every animated value is written fresh. (Uses the mixer's internal double buffer.)
    const prevAccu = this.mixer._accuIndex;
    for (const b of this.mixer._bindings) b.buffer.fill(NaN, (prevAccu + 1) * b.valueSize, (prevAccu + 2) * b.valueSize);
    this.mixer.update(0);

    // ---- place the model and turn the hips toward the movement
    outer.updateMatrixWorld(true);
    if (rig.rootBone) rotateWorld(rig.rootBone, _q.setFromAxisAngle(UP, -this.hipYaw));
    const fwd = _fwd.set(Math.cos(yaw), 0, Math.sin(yaw));
    const right = _right.set(-Math.sin(yaw), 0, Math.cos(yaw));
    const ground = outer.position.y;

    // ---- 2. crouch / kneel / sit: drop the pelvis, keep the feet down with IK
    const feet = {};
    for (const s of ['L', 'R']) feet[s] = worldPos(rig.legs[s].foot, new THREE.Vector3());
    let drop = 0;
    const walkingCrouch = this.crouchK * move;
    drop += walkingCrouch * rig.hipHeight * 0.3;
    if (vaulting) drop += 0.1;
    if (this.downK > 0.01) drop += this.downK * rig.hipHeight * 0.62;
    if (ctx.bound) drop += rig.hipHeight * 0.18;
    if (drop > 0.001 && rig.hips) {
      const hp = worldPos(rig.hips);
      hp.y -= drop;
      rig.hips.parent.worldToLocal(hp);
      rig.hips.position.copy(hp);
      rig.hips.updateMatrixWorld(true);
    }
    // Forward lean when crouch-walking, sprinting; back when sat down
    const lean = walkingCrouch * 0.35 + this.sprintK * 0.25 - this.downK * 0.35 + this.useK * 0.25;
    if (Math.abs(lean) > 0.001 && rig.spine[0]) rotateWorld(rig.spine[0], _q.setFromAxisAngle(right, -lean));
    if (drop > 0.001 || this.downK > 0.01 || vaulting) {
      for (const s of ['L', 'R']) {
        const l = rig.legs[s];
        const target = feet[s].clone();
        const side = s === 'L' ? -1 : 1;
        if (this.downK > 0.01) {
          // Sat on the ground: legs out in front, one knee up
          const hp = worldPos(rig.hips);
          const out = hp.clone().addScaledVector(fwd, s === 'L' ? 0.55 : 0.7).addScaledVector(right, side * 0.16);
          out.y = ground + 0.09;
          target.lerp(out, this.downK);
        }
        if (vaulting) {
          const hp = worldPos(rig.hips);
          target.copy(hp).addScaledVector(fwd, 0.2).addScaledVector(right, side * 0.14);
          target.y = hp.y - 0.35;
        }
        target.y = Math.max(target.y, ground + 0.07);
        const knee = worldPos(l.calf, new THREE.Vector3()).addScaledVector(fwd, 0.5).addScaledVector(right, side * 0.08);
        twoBoneIK(l.thigh, l.calf, l.foot, target, knee);
      }
    }

    // ---- 3. the upper body and the gun
    const gun = ctx.unarmed ? null : this.gunFor(a);
    for (const g of Object.values(this.guns)) g.group.visible = !!gun && g === gun;
    const pitch = clamp(ctx.pitch ?? 0, -1.2, 1.2);
    const aimYaw = a.aimYaw ?? yaw;
    const aimDir = _aim.set(Math.cos(aimYaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(aimYaw) * Math.cos(pitch));
    const raised = ctx.raised ?? (a.aiming || (a.sinceShot ?? 999) < 50 || (a.muzzle ?? 0) > 0 || anim === 'aim');
    const slung = !gun || using || vaulting || ctx.bound;
    const carry = !slung && (sprinting || (anim === 'run' && !raised));
    this.aimK = ease(this.aimK, raised && !slung && !carry ? 1 : 0, 10);

    // Recoil and flinch springs
    if ((a.sinceShot ?? 999) < this.lastShot) this.recoil.kick(0, 0, 9 + Math.random() * 3);
    this.lastShot = a.sinceShot ?? 999;
    if ((a.flash ?? 0) > this.lastFlash && !a.dead) this.flinch.kick((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, -6 - Math.random() * 4);
    this.lastFlash = a.flash ?? 0;
    this.recoil.step(dt);
    this.flinch.step(dt);

    // Turn the chest toward the aim (bladed for long guns), and bend it with the pitch
    const blade = slung || carry || this.downK > 0.5 ? 0 : gun.kind === 'long' ? 0.5 + 0.1 * this.aimK : gun.kind === 'heavy' ? 0.55 : gun.kind === 'rotary' ? 0.25 : 0.05;
    const chestYaw = aimYaw + blade;
    const cf = this.chestForward();
    const have = Math.atan2(cf.z, cf.x);
    const twist = wrap(chestYaw - have);
    const sp = rig.spine;
    const shares = [0.3, 0.35, 0.35];
    const bend = (slung ? 0 : pitch * 0.45) + this.flinch.x.z * 0.02;
    for (let i = 0; i < sp.length; i++) {
      rotateWorld(sp[i], _q.setFromAxisAngle(UP, -twist * shares[i]));
      const r = this.chestRight();
      rotateWorld(sp[i], _q.setFromAxisAngle(r, bend * shares[i] + this.flinch.x.x * 0.01));
    }

    // Where the gun is
    if (gun) this.placeGun(a, gun, { aimDir, slung, carry, pitch, time: ctx.time ?? 0 });

    // Arms onto the gun (or wherever this moment needs them)
    this.placeArms(a, gun, { slung, carry, fwd, right, ground, bound: !!ctx.bound });

    // Head: along the aim (bowed when bound); aiming a long gun, the cheek drops onto the stock
    let look = ctx.bound ? _v2.copy(fwd).setY(-0.9).normalize() : slung && !using ? fwd : aimDir;
    if (gun && !slung && !carry && gun.kind === 'long' && this.aimK > 0.01) {
      look = _v2.copy(aimDir).addScaledVector(UP, -0.18 * this.aimK).normalize();
      if (rig.head) rotateWorld(rig.head, _q.setFromAxisAngle(aimDir, 0.22 * this.aimK));
    }
    this.lookAlong(look, ctx.bound ? 1 : 0.85);
    return stepped;
  }

  /** How long a full cycle of the blended gaits takes, for phase-locking. */
  cycle(w) {
    let t = 0;
    let n = 0;
    for (const g of GAITS) {
      if (!this.actions[g] || !(w[g] > 0)) continue;
      t += this.actions[g].getClip().duration * w[g];
      n += w[g];
    }
    return n ? t / n : 1;
  }

  chestForward() {
    const L = worldPos(this.rig.arms.L.upper, _c1);
    const R = worldPos(this.rig.arms.R.upper, _c2);
    const left = L.sub(R);
    left.y = 0;
    return _c3.crossVectors(left.normalize(), UP).normalize();
  }

  chestRight() {
    const f = this.chestForward();
    return _c4.set(-f.z, 0, f.x);
  }

  /** The gun's world transform for this moment. */
  placeGun(a, gun, { aimDir, slung, carry, pitch, time }) {
    const rig = this.rig;
    const chest = rig.spine[rig.spine.length - 1];
    const cf = this.chestForward().clone();
    const cr = new THREE.Vector3(-cf.z, 0, cf.x);
    const shoulder = worldPos(rig.arms.R.upper, new THREE.Vector3());
    let x;
    let pos;
    const yAxis = new THREE.Vector3();
    if (slung) {
      // Across the back, muzzle up over the left shoulder
      const c = worldPos(chest, new THREE.Vector3());
      x = new THREE.Vector3().copy(UP).multiplyScalar(0.8).addScaledVector(cr, -0.6).normalize();
      const z = cf.clone().negate();
      yAxis.crossVectors(z, x).normalize();
      _m.makeBasis(x, yAxis, new THREE.Vector3().crossVectors(x, yAxis));
      pos = c.addScaledVector(cf, -0.2).addScaledVector(UP, -0.05);
    } else if (carry) {
      // Port arms: across the chest, muzzle up and to the left
      const c = worldPos(chest, new THREE.Vector3());
      x = new THREE.Vector3().copy(cf).multiplyScalar(0.55).addScaledVector(UP, 0.45).addScaledVector(cr, -0.7).normalize();
      yAxis.copy(cf).addScaledVector(x, -cf.dot(x)).normalize();
      _m.makeBasis(x, yAxis, new THREE.Vector3().crossVectors(x, yAxis));
      pos = c.addScaledVector(cf, 0.28).addScaledVector(cr, 0.06).addScaledVector(UP, -0.12);
    } else {
      x = aimDir.clone();
      if (gun.kind === 'rotary') x.y *= 0.8;
      // Lowered (low ready) when not shooting: muzzle down and in
      const low = 1 - this.aimK;
      if (low > 0.001 && gun.kind !== 'rotary') {
        x.applyAxisAngle(cr, -0.4 * low);
        x.applyAxisAngle(UP, 0.3 * low);
      }
      x.normalize();
      // Recoil: the muzzle climbs
      x.applyAxisAngle(cr, this.recoil.x.z * 0.006);
      yAxis.copy(UP).addScaledVector(x, -UP.dot(x)).normalize();
      const z = new THREE.Vector3().crossVectors(x, yAxis);
      _m.makeBasis(x, yAxis, z);
      const q = new THREE.Quaternion().setFromRotationMatrix(_m);
      if (gun.kind === 'pistol') {
        // Out at arm's length in front of the eyes
        const head = worldPos(rig.head, new THREE.Vector3());
        pos = head.addScaledVector(aimDir, 0.42 * (0.6 + 0.4 * this.aimK)).addScaledVector(UP, -0.13 - 0.15 * low).addScaledVector(cr, 0.03);
      } else if (gun.kind === 'rotary') {
        const hip = worldPos(rig.hips, new THREE.Vector3());
        pos = hip.addScaledVector(cf, 0.3).addScaledVector(cr, 0.16).addScaledVector(UP, 0.15);
        pos.sub(gun.stock.clone().applyQuaternion(q));
      } else {
        // Stock in the shoulder pocket, a little in from the joint
        const pocket = shoulder.clone().addScaledVector(cr, -0.06).addScaledVector(cf, 0.04).addScaledVector(UP, -0.03 + 0.03 * this.aimK + (gun.kind === 'heavy' ? -0.08 : 0));
        pos = pocket.sub(gun.stock.clone().applyQuaternion(q));
      }
      // Recoil pushes back along the barrel
      pos.addScaledVector(x, -this.recoil.x.z * 0.004);
      // Reload: the gun rolls out to show the magazine well
      const reloadK = this.reloadK(a);
      if (reloadK > 0) {
        const r = Math.sin(reloadK * Math.PI);
        _q.setFromAxisAngle(x, -0.6 * r);
        q.premultiply(_q);
        pos.addScaledVector(UP, -0.06 * r);
      }
      gun.group.position.copy(pos);
      gun.group.quaternion.copy(q);
      gun.group.updateMatrixWorld(true);
      this.reloadMag(gun, reloadK);
      if (gun.spin) gun.spin.rotation.x = (a.muzzle ?? 0) > 0 || (a.sinceShot ?? 999) < 8 ? time * 50 : gun.spin.rotation.x;
      return;
    }
    gun.group.position.copy(pos);
    gun.group.quaternion.setFromRotationMatrix(_m);
    gun.group.updateMatrixWorld(true);
    this.reloadMag(gun, 0);
  }

  /** 0..1 through a reload, or 0. */
  reloadK(a) {
    if (!(a.reloadT > 0)) return 0;
    const total = a.guns?.[a.weapon]?.def.reload || a.gun?.def.reload || 110;
    return clamp(1 - a.reloadT / total, 0, 1);
  }

  /** The magazine drops out, a fresh one goes in. */
  reloadMag(gun, k) {
    if (!gun.mag) return;
    if (k <= 0) {
      gun.mag.position.copy(gun.magRest);
      gun.mag.visible = true;
      return;
    }
    if (k < 0.3) gun.mag.position.copy(gun.magRest).add(_v.set(0, -smooth(k / 0.3) * 0.25, 0));
    else if (k < 0.55) gun.mag.visible = false;
    else if (k < 0.72) {
      gun.mag.visible = true;
      gun.mag.position.copy(gun.magRest).add(_v.set(0, -(1 - smooth((k - 0.55) / 0.17)) * 0.12, 0));
    } else gun.mag.position.copy(gun.magRest);
    if (k > 0.3 && k < 0.55) gun.mag.visible = false;
  }

  /** Both arms: onto the gun, or doing whatever this moment needs. */
  placeArms(a, gun, { slung, fwd, right, ground, bound }) {
    const rig = this.rig;
    const anim = a.anim;
    const hip = worldPos(rig.hips, new THREE.Vector3());
    const gw = gun?.group.matrixWorld;
    const toWorld = (p) => p.clone().applyMatrix4(gw);
    const dirWorld = (d) => d.clone().transformDirection(gw);
    const targets = { L: null, R: null };
    const frames = { L: null, R: null };
    if (gun && !slung) {
      for (const s of ['L', 'R']) {
        const h = gun.hands[s];
        targets[s] = toWorld(h.at);
        frames[s] = { fwd: dirWorld(h.fwd), palm: dirWorld(h.palm), curl: h.curl };
      }
      // Reload: the support hand goes to the well, down to a pouch, and back
      const k = this.reloadK(a);
      if (k > 0) {
        const well = toWorld(gun.well);
        const pouch = worldPos(rig.spine[rig.spine.length - 1], new THREE.Vector3()).addScaledVector(fwd, 0.18).addScaledVector(right, -0.08).addScaledVector(UP, -0.28);
        const fore = targets.L;
        let t;
        if (k < 0.15) t = fore.clone().lerp(well, smooth(k / 0.15));
        else if (k < 0.35) t = well.clone().lerp(pouch, smooth((k - 0.15) / 0.2));
        else if (k < 0.55) t = pouch.clone().lerp(well, smooth((k - 0.35) / 0.2));
        else if (k < 0.72) t = well.clone();
        else t = well.clone().lerp(fore, smooth((k - 0.72) / 0.28));
        targets.L = t.addScaledVector(UP, -0.03);
        frames.L = { fwd: dirWorld(new THREE.Vector3(0.2, 0.3, 1)), palm: dirWorld(new THREE.Vector3(0, 1, 0)), curl: [0.5, 0.9, 1, 1, 1] };
      }
      // Grenade: the throwing arm winds back over the shoulder and whips forward
      if (a.throwT > 0) {
        const k2 = 1 - a.throwT / 20;
        const sh = worldPos(rig.arms.R.upper, new THREE.Vector3());
        const back = sh.clone().addScaledVector(fwd, -0.25).addScaledVector(UP, 0.2).addScaledVector(right, 0.1);
        const out = sh.clone().addScaledVector(fwd, 0.55).addScaledVector(UP, -0.1);
        targets.R = k2 < 0.45 ? back : back.lerp(out, smooth((k2 - 0.45) / 0.55));
        frames.R = null;
      }
    }
    if (a.downed || anim === 'downed') {
      // Propped up on the left hand
      targets.L = hip.clone().addScaledVector(fwd, -0.28).addScaledVector(right, -0.3);
      targets.L.y = ground + 0.06;
      frames.L = { fwd: fwd.clone().negate(), palm: new THREE.Vector3(0, -1, 0), curl: [0.2, 0.2, 0.2, 0.2, 0.2] };
    }
    if (anim === 'use' || anim === 'boost') {
      const wob = anim === 'use' ? Math.sin(this.idleT * 15) * 0.03 : 0;
      for (const s of ['L', 'R']) {
        const side = s === 'L' ? -1 : 1;
        const p = hip.clone().addScaledVector(fwd, 0.5).addScaledVector(right, side * 0.09);
        p.y = ground + (anim === 'boost' ? 0.55 : 0.35) + side * wob;
        targets[s] = p;
        frames[s] = { fwd: fwd.clone().setY(-0.4).normalize(), palm: anim === 'boost' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0), curl: [0.4, 0.6, 0.7, 0.75, 0.8] };
      }
    }
    if (anim === 'vault') {
      const p = hip.clone().addScaledVector(fwd, 0.25).addScaledVector(right, -0.2);
      p.y -= 0.35;
      targets.L = p;
    }
    if (bound) {
      for (const s of ['L', 'R']) {
        const side = s === 'L' ? -1 : 1;
        targets[s] = hip.clone().addScaledVector(fwd, -0.2).addScaledVector(right, side * 0.06).addScaledVector(UP, 0.05);
        frames[s] = { fwd: right.clone().multiplyScalar(-side), palm: fwd.clone().negate(), curl: [0.6, 0.8, 0.9, 0.9, 0.9] };
      }
    }
    for (const s of ['L', 'R']) {
      const arm = rig.arms[s];
      const side = s === 'L' ? -1 : 1;
      if (!targets[s]) {
        // Free hand: relaxed fingers
        rig.curl(s, [0.25, 0.3, 0.35, 0.4, 0.45]);
        continue;
      }
      // Elbows down and out
      const sh = worldPos(arm.upper, new THREE.Vector3());
      const pole = sh.clone().addScaledVector(UP, -1).addScaledVector(right, side * (s === 'R' ? 0.7 : 0.35)).addScaledVector(fwd, s === 'R' ? -0.3 : 0.2);
      // Out of reach: the hand slides back along the line toward the shoulder
      const reach = rig.armLength[s] * this.scale * 0.985;
      const d = sh.distanceTo(targets[s]);
      if (d > reach) targets[s].lerp(sh, 1 - reach / d);
      twoBoneIK(arm.upper, arm.fore, arm.hand, targets[s], pole);
      if (this.debug) this.debug[s] = { target: targets[s].toArray().map((x) => +x.toFixed(3)), got: worldPos(arm.hand).toArray().map((x) => +x.toFixed(3)), sh: sh.toArray().map((x) => +x.toFixed(3)), reach: +sh.distanceTo(targets[s]).toFixed(3), len: +this.rig.armLength[s].toFixed(3) };
      if (frames[s]) {
        rig.orientHand(s, frames[s].fwd, frames[s].palm);
        rig.curl(s, frames[s].curl);
      }
    }
  }

  /** Turns the neck and head so the face looks along `dir` (world). */
  lookAlong(dir, weight = 0.85) {
    const rig = this.rig;
    if (!rig.head) return;
    if (!this.headFwdLocal) this.headFwdLocal = rig.headFwd.clone();
    const cur = _v.copy(this.headFwdLocal).applyQuaternion(worldQuat(rig.head, _q2)).normalize();
    const want = _v2.copy(dir).normalize();
    let ang = Math.acos(clamp(cur.dot(want), -1, 1));
    if (ang < 1e-4) return;
    const lim = 1.2;
    const k = (Math.min(ang, lim) / ang) * weight;
    _q.setFromUnitVectors(cur, want);
    const part = new THREE.Quaternion().slerp(_q, k * 0.4);
    if (rig.neck) rotateWorld(rig.neck, part);
    const cur2 = _v.copy(this.headFwdLocal).applyQuaternion(worldQuat(rig.head, _q2)).normalize();
    ang = Math.acos(clamp(cur2.dot(want), -1, 1));
    if (ang < 1e-4) return;
    _q.setFromUnitVectors(cur2, want);
    rotateWorld(rig.head, new THREE.Quaternion().slerp(_q, Math.min(1, (Math.min(ang, lim) / ang) * weight)));
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();
const _c3 = new THREE.Vector3();
const _c4 = new THREE.Vector3();
