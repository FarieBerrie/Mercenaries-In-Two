// Ragdolls. When someone dies their body is handed to a small physics simulation: fifteen
// joints (verlet particles) held together by bone-length constraints, braced through the torso,
// with limits that stop limbs folding through themselves, colliding with the ground and the
// level's boxes. It starts from the animated pose, moving the way the body was moving, plus a
// shove from whatever killed it. The skeleton is then turned, bone by bone, to follow the
// particles. Bodies that have come to rest stop simulating.
import * as THREE from 'three/webgpu';
import { boxesNear, groundHeight } from '../level.js';
import { rotateWorld, setWorldQuat, worldPos, worldQuat } from './rig.js';

const GRAVITY = -9.8;
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Joint names and the bones they sit on. */
function joints(rig) {
  const sp = rig.spine;
  return {
    pelvis: rig.hips,
    belly: sp[1] || sp[0],
    chest: rig.neck,
    head: rig.head,
    shL: rig.arms.L.upper,
    elL: rig.arms.L.fore,
    wrL: rig.arms.L.hand,
    shR: rig.arms.R.upper,
    elR: rig.arms.R.fore,
    wrR: rig.arms.R.hand,
    hipL: rig.legs.L.thigh,
    knL: rig.legs.L.calf,
    anL: rig.legs.L.foot,
    hipR: rig.legs.R.thigh,
    knR: rig.legs.R.calf,
    anR: rig.legs.R.foot,
  };
}

const LINKS = [
  ['pelvis', 'belly'], ['belly', 'chest'], ['chest', 'head'],
  ['pelvis', 'hipL'], ['pelvis', 'hipR'], ['hipL', 'hipR'],
  ['chest', 'shL'], ['chest', 'shR'], ['shL', 'shR'],
  ['shL', 'elL'], ['elL', 'wrL'], ['shR', 'elR'], ['elR', 'wrR'],
  ['hipL', 'knL'], ['knL', 'anL'], ['hipR', 'knR'], ['knR', 'anR'],
  // bracing: the torso is (nearly) rigid
  ['shL', 'hipL'], ['shR', 'hipR'], ['shL', 'hipR'], ['shR', 'hipL'], ['belly', 'shL'], ['belly', 'shR'], ['belly', 'hipL'], ['belly', 'hipR'], ['pelvis', 'chest'],
  ['head', 'shL'], ['head', 'shR'],
];
/** Joints that may come closer than their rest distance, but not too close (no folding flat). */
const LIMITS = [
  ['wrL', 'shL', 0.16], ['wrR', 'shR', 0.16], ['anL', 'hipL', 0.3], ['anR', 'hipR', 0.3], ['wrL', 'chest', 0.08], ['wrR', 'chest', 0.08], ['knL', 'chest', 0.35], ['knR', 'chest', 0.35], ['head', 'pelvis', 0.4],
];
const RADIUS = { pelvis: 0.12, belly: 0.13, chest: 0.13, head: 0.11, hipL: 0.09, hipR: 0.09, shL: 0.07, shR: 0.07 };

export class Ragdoll {
  /**
   * rig: the model's Rig; level: for collisions; impulse: { x, y, z } velocity added at the
   * hit point `at` (world), falling off with distance; prev: last frame's joint positions (for
   * the body's own motion).
   */
  constructor(rig, level, { impulse = null, at = null, scale = 1 } = {}) {
    this.rig = rig;
    this.level = level;
    this.J = joints(rig);
    this.names = Object.keys(this.J).filter((k) => this.J[k]);
    this.p = {};
    this.o = {};
    for (const n of this.names) {
      const pos = worldPos(this.J[n], new THREE.Vector3());
      this.p[n] = pos;
      const prev = rig.lastJoint?.[n];
      // Previous position gives the starting velocity (verlet stores it implicitly): one
      // frame's movement spread over the three sub-steps
      this.o[n] = prev ? pos.clone().addScaledVector(_v.subVectors(pos, prev), -1 / 3) : pos.clone();
    }
    if (impulse) {
      for (const n of this.names) {
        const d = at ? this.p[n].distanceTo(at) : 0;
        const k = Math.max(0.15, 1 - d / 0.9);
        this.o[n].addScaledVector(_v.set(impulse.x, impulse.y, impulse.z), -k / 180);
      }
    }
    this.rest = LINKS.filter(([a, b]) => this.p[a] && this.p[b]).map(([a, b]) => [a, b, this.p[a].distanceTo(this.p[b])]);
    this.limits = LIMITS.filter(([a, b]) => this.p[a] && this.p[b]).map(([a, b, d]) => [a, b, d * scale]);
    this.scale = scale;
    // How the pelvis and chest sit relative to their joint frames now, to carry through
    this.frame0 = {
      pelvis: this.frameQuat('pelvis').invert().multiply(worldQuat(this.J.pelvis)),
      chest: this.frameQuat('chest').invert().multiply(worldQuat(rig.spine[rig.spine.length - 1])),
    };
    this.hipOffset = worldPos(this.J.pelvis, new THREE.Vector3()).sub(this.p.pelvis);
    this.still = 0;
    this.asleep = false;
    this.t = 0;
  }

  /** An orthonormal frame from the torso particles: up the spine, across the hips. */
  frameQuat(which) {
    const p = this.p;
    const up = which === 'pelvis' ? _a.subVectors(p.belly, p.pelvis) : _a.subVectors(p.head, p.chest);
    const across = which === 'pelvis' ? _b.subVectors(p.hipL, p.hipR) : _b.subVectors(p.shL, p.shR);
    up.normalize();
    across.addScaledVector(up, -across.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(across, up);
    const m = new THREE.Matrix4().makeBasis(across, up, fwd);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  step(dt) {
    if (this.asleep) return;
    this.t += dt;
    const sub = 3;
    const h = Math.min(dt, 1 / 30) / sub;
    let moved = 0;
    for (let s = 0; s < sub; s++) {
      for (const n of this.names) {
        const p = this.p[n];
        const o = this.o[n];
        const vx = (p.x - o.x) * 0.995;
        const vy = (p.y - o.y) * 0.995;
        const vz = (p.z - o.z) * 0.995;
        o.copy(p);
        p.x += vx;
        p.y += vy + GRAVITY * h * h;
        p.z += vz;
        moved += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
      }
      for (let it = 0; it < 8; it++) {
        for (const [a, b, len] of this.rest) this.solve(a, b, len, len);
        for (const [a, b, min] of this.limits) this.solve(a, b, min, Infinity);
        this.collide();
      }
    }
    this.still = moved < 0.004 * this.names.length ? this.still + dt : 0;
    if (this.still > 0.6 || this.t > 8) this.asleep = true;
  }

  solve(a, b, min, max) {
    const pa = this.p[a];
    const pb = this.p[b];
    _v.subVectors(pb, pa);
    const d = _v.length() || 1e-6;
    const want = d < min ? min : d > max ? max : d;
    if (want === d) return;
    const k = (d - want) / d / 2;
    pa.addScaledVector(_v, k);
    pb.addScaledVector(_v, -k);
  }

  collide() {
    const level = this.level;
    for (const n of this.names) {
      const p = this.p[n];
      const r = (RADIUS[n] ?? 0.06) * this.scale;
      const g = level ? groundHeight(level, p.x, p.z, 0, p.y + 0.3) : 0;
      if (p.y < g + r) {
        p.y = g + r;
        // Friction: kill most sliding on contact
        const o = this.o[n];
        o.x = p.x + (o.x - p.x) * 0.55;
        o.z = p.z + (o.z - p.z) * 0.55;
        o.y = Math.min(o.y, p.y);
      }
      if (!level) continue;
      for (const b of boxesNear(level, p.x - 0.3, p.x + 0.3, p.z - 0.3, p.z + 0.3)) {
        if (p.x < b.x0 - r || p.x > b.x1 + r || p.z < b.z0 - r || p.z > b.z1 + r || p.y < b.y0 - r || p.y > b.y1 + r) continue;
        // Push out along the shallowest side
        const pen = [p.x - (b.x0 - r), b.x1 + r - p.x, p.y - (b.y0 - r), b.y1 + r - p.y, p.z - (b.z0 - r), b.z1 + r - p.z];
        let i = 0;
        for (let k = 1; k < 6; k++) if (pen[k] < pen[i]) i = k;
        if (i === 0) p.x = b.x0 - r;
        else if (i === 1) p.x = b.x1 + r;
        else if (i === 2) p.y = b.y0 - r;
        else if (i === 3) p.y = b.y1 + r;
        else if (i === 4) p.z = b.z0 - r;
        else p.z = b.z1 + r;
      }
    }
  }

  /** Turns the skeleton to follow the particles. */
  apply() {
    const rig = this.rig;
    const J = this.J;
    // Pelvis: placed and turned with the hip frame
    const hp = this.p.pelvis.clone().add(this.hipOffset);
    J.pelvis.parent.updateMatrixWorld(true);
    J.pelvis.position.copy(J.pelvis.parent.worldToLocal(hp));
    setWorldQuat(J.pelvis, this.frameQuat('pelvis').multiply(this.frame0.pelvis));
    // Spine: each bone aimed up the chain
    const sp = rig.spine;
    if (sp[0] && this.p.belly) this.aim(sp[0], 'pelvis', 'belly');
    if (sp.length > 1) this.aim(sp[1], 'belly', 'chest');
    const top = sp[sp.length - 1];
    if (top) setWorldQuat(top, this.frameQuat('chest').multiply(this.frame0.chest));
    if (rig.neck) this.aim(rig.neck, 'chest', 'head');
    // Limbs
    for (const s of ['L', 'R']) {
      this.aim(rig.arms[s].upper, `sh${s}`, `el${s}`);
      this.aim(rig.arms[s].fore, `el${s}`, `wr${s}`);
      this.aim(rig.legs[s].thigh, `hip${s}`, `kn${s}`);
      this.aim(rig.legs[s].calf, `kn${s}`, `an${s}`);
    }
  }

  /** Turns `bone` so its joint→next-joint direction matches the particles a→b. */
  aim(bone, a, b) {
    if (!bone || !this.p[a] || !this.p[b]) return;
    const next = this.J[b];
    const cur = worldPos(next, _a).sub(worldPos(bone, _b));
    if (cur.lengthSq() < 1e-8) return;
    const want = _v.subVectors(this.p[b], this.p[a]);
    _q.setFromUnitVectors(cur.normalize(), want.normalize());
    rotateWorld(bone, _q);
  }
}

/** Remembers where each joint is this frame (so a ragdoll can start with the body's motion). */
export function rememberJoints(rig) {
  const J = joints(rig);
  rig.lastJoint ??= {};
  for (const [n, bone] of Object.entries(J)) {
    if (!bone) continue;
    (rig.lastJoint[n] ??= new THREE.Vector3()).setFromMatrixPosition(bone.matrixWorld);
  }
}

