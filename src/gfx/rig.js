// Skeletons. Every person is a Rocketbox avatar on the 3ds Max Biped rig; this code also reads
// Mixamo-named rigs, whose bones point along different axes and face different ways. Everything
// procedural here works in world space from the live pose, measuring what it needs from the model
// at load time (which way it faces, limb lengths, how each hand sits), so the same aiming, IK and
// ragdoll code drives both.
import * as THREE from 'three/webgpu';

const fingerNames = (pre, s, names) => names.map((n) => [1, 2, 3].map((i) => `${pre}${s}Hand${n}${i}`));

/** Bone names per rig. Fingers are [thumb, index, middle, ring, pinky], three joints each. */
export const RIGS = {
  biped: {
    root: 'Bip01',
    hips: 'Bip01_Pelvis',
    spine: ['Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2'],
    neck: 'Bip01_Neck',
    head: 'Bip01_Head',
    arm: (s) => ({
      clav: `Bip01_${s}_Clavicle`,
      upper: `Bip01_${s}_UpperArm`,
      fore: `Bip01_${s}_Forearm`,
      hand: `Bip01_${s}_Hand`,
      fingers: [0, 1, 2, 3, 4].map((f) => [`Bip01_${s}_Finger${f}`, `Bip01_${s}_Finger${f}1`, `Bip01_${s}_Finger${f}2`]),
    }),
    leg: (s) => ({ thigh: `Bip01_${s}_Thigh`, calf: `Bip01_${s}_Calf`, foot: `Bip01_${s}_Foot`, toe: `Bip01_${s}_Toe0` }),
    sides: { L: 'L', R: 'R' },
  },
  mixamo: {
    root: 'mixamorigHips',
    hips: 'mixamorigHips',
    spine: ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'],
    neck: 'mixamorigNeck',
    head: 'mixamorigHead',
    arm: (s) => ({
      clav: `mixamorig${s}Shoulder`,
      upper: `mixamorig${s}Arm`,
      fore: `mixamorig${s}ForeArm`,
      hand: `mixamorig${s}Hand`,
      fingers: fingerNames('mixamorig', s, ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']),
    }),
    leg: (s) => ({ thigh: `mixamorig${s}UpLeg`, calf: `mixamorig${s}Leg`, foot: `mixamorig${s}Foot`, toe: `mixamorig${s}ToeBase` }),
    sides: { L: 'Left', R: 'Right' },
  },
};

export const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _m = new THREE.Matrix4();

export const worldPos = (o, out = new THREE.Vector3()) => out.setFromMatrixPosition(o.matrixWorld);
export const worldQuat = (o, out = new THREE.Quaternion()) => {
  o.matrixWorld.decompose(_v, out, _a);
  return out;
};

/** Rotates a bone by a world-space rotation q (keeps its children attached). */
export function rotateWorld(bone, q) {
  // local' = P⁻¹ · q · P · local, where P is the parent's world rotation
  worldQuat(bone.parent, _pq);
  _q2.copy(_pq).invert().multiply(q).multiply(_pq);
  bone.quaternion.premultiply(_q2);
  bone.updateMatrixWorld(true);
}

/** Sets a bone's world-space rotation outright. */
export function setWorldQuat(bone, q) {
  worldQuat(bone.parent, _pq);
  bone.quaternion.copy(_pq.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/** Turns a bone so the direction from it to `child` (a descendant) points along `dir` (world). */
export function aimBone(bone, child, dir, weight = 1) {
  const from = worldPos(child, _a).sub(worldPos(bone, _b)).normalize();
  _q.setFromUnitVectors(from, _c.copy(dir).normalize());
  if (weight < 1) _q.slerp(_q2.identity(), 1 - weight);
  rotateWorld(bone, _q);
}

/**
 * Analytic two-bone IK: bends `mid` and turns `upper` so `end` reaches `target`, with the middle
 * joint swinging toward `pole` (a world point). Starts from the animated pose, so twist stays
 * natural.
 */
export function twoBoneIK(upper, mid, end, target, pole, weight = 1) {
  if (weight <= 0) return;
  const a = worldPos(upper, new THREE.Vector3());
  const b = worldPos(mid, new THREE.Vector3());
  const c = worldPos(end, new THREE.Vector3());
  const lab = a.distanceTo(b);
  const lcb = b.distanceTo(c);
  const t = _t.copy(target);
  if (weight < 1) t.lerpVectors(c, target, weight);
  const lat = THREE.MathUtils.clamp(t.distanceTo(a), 0.01, (lab + lcb) * 0.999);
  // 1. Bend the middle joint until the chain spans the right distance
  const ac = new THREE.Vector3().subVectors(c, a).normalize();
  const ab = new THREE.Vector3().subVectors(b, a).normalize();
  const ba = new THREE.Vector3().subVectors(a, b).normalize();
  const bc = new THREE.Vector3().subVectors(c, b).normalize();
  const ac_ab0 = Math.acos(THREE.MathUtils.clamp(ac.dot(ab), -1, 1));
  const ba_bc0 = Math.acos(THREE.MathUtils.clamp(ba.dot(bc), -1, 1));
  const ac_ab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const ba_bc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  // The bend happens in the plane through the pole
  const toPole = _v.copy(pole).sub(a);
  const axis0 = new THREE.Vector3().crossVectors(ac, ab);
  if (axis0.lengthSq() < 1e-8) axis0.crossVectors(ac, toPole);
  axis0.normalize();
  rotateWorld(upper, _q.setFromAxisAngle(axis0, ac_ab1 - ac_ab0));
  rotateWorld(mid, _q.setFromAxisAngle(axis0, ba_bc1 - ba_bc0));
  // 2. Swing the whole chain so the end points at the target
  worldPos(end, c);
  const ac2 = _a.subVectors(c, a).normalize();
  const at = _b.subVectors(t, a).normalize();
  rotateWorld(upper, _q.setFromUnitVectors(ac2, at));
  // 3. Twist about the shoulder→target line so the middle joint faces the pole
  worldPos(mid, b);
  const axis = at;
  const pb = _a.subVectors(b, a);
  pb.addScaledVector(axis, -pb.dot(axis));
  const pp = _c.copy(pole).sub(a);
  pp.addScaledVector(axis, -pp.dot(axis));
  if (pb.lengthSq() > 1e-8 && pp.lengthSq() > 1e-8) {
    pb.normalize();
    pp.normalize();
    let ang = Math.acos(THREE.MathUtils.clamp(pb.dot(pp), -1, 1));
    if (_ax.crossVectors(pb, pp).dot(axis) < 0) ang = -ang;
    rotateWorld(upper, _q.setFromAxisAngle(axis, ang));
  }
}

/**
 * A model's skeleton, measured. root: the loaded scene (a fresh clone); type: 'biped'|'mixamo'.
 * Finds every bone by name, works out which way the model faces in its own space, and records
 * how each hand is built (where the fingers point, which way the palm faces).
 */
export class Rig {
  constructor(root, type) {
    this.type = type;
    this.root = root;
    const R = RIGS[type];
    const byName = new Map();
    root.traverse((o) => byName.set(o.name, o));
    const get = (n) => byName.get(n) || null;
    this.rootBone = get(R.root);
    this.hips = get(R.hips);
    this.spine = R.spine.map(get).filter(Boolean);
    this.neck = get(R.neck);
    this.head = get(R.head);
    this.arms = {};
    this.legs = {};
    for (const side of ['L', 'R']) {
      const a = R.arm(R.sides[side]);
      this.arms[side] = { clav: get(a.clav), upper: get(a.upper), fore: get(a.fore), hand: get(a.hand), fingers: a.fingers.map((f) => f.map(get).filter(Boolean)) };
      const l = R.leg(R.sides[side]);
      this.legs[side] = { thigh: get(l.thigh), calf: get(l.calf), foot: get(l.foot), toe: get(l.toe) };
    }
    this.skinned = [];
    root.traverse((o) => o.isSkinnedMesh && this.skinned.push(o));
    // Bones the mocap doesn't move, with their rest rotation (reset every frame before posing)
    this.unanimated = [];
    this.measure();
  }

  /**
   * Records the rest rotation and position of everything the clips don't drive (fingers, the
   * face, and any bone position the procedural layers move), so each frame starts clean.
   * animated: Set of 'bone.property' track names.
   */
  rememberRest(animated) {
    this.unanimated = [];
    this.root.traverse((o) => {
      if (!(o.isBone || o.name.startsWith('Bip01') || o.name.startsWith('mixamorig'))) return;
      const q = animated.has(`${o.name}.quaternion`) ? null : o.quaternion.clone();
      const p = animated.has(`${o.name}.position`) ? null : o.position.clone();
      if (q || p) this.unanimated.push([o, q, p]);
    });
  }

  resetUnanimated() {
    for (const [o, q, p] of this.unanimated) {
      if (q) o.quaternion.copy(q);
      if (p) o.position.copy(p);
    }
  }

  /** Measures facing, sizes and hands from the current pose (call with the model at identity). */
  measure() {
    this.root.updateMatrixWorld(true);
    const lt = worldPos(this.legs.L.thigh);
    const rt = worldPos(this.legs.R.thigh);
    const left = lt.clone().sub(rt);
    left.y = 0;
    left.normalize();
    // forward = left × up
    this.forward = new THREE.Vector3().crossVectors(left, UP).normalize();
    // Yaw that turns the model's forward onto +x
    this.yawOffset = Math.atan2(this.forward.z, this.forward.x);
    const hip = worldPos(this.hips);
    const foot = worldPos(this.legs.L.foot);
    const head = worldPos(this.head);
    this.hipHeight = hip.y - Math.min(foot.y, worldPos(this.legs.R.foot).y);
    // Which way the face points, in the head bone's own space
    this.headFwd = this.forward.clone().applyQuaternion(worldQuat(this.head).invert());
    this.height = head.y - foot.y;
    this.armLength = {};
    for (const side of ['L', 'R']) {
      const a = this.arms[side];
      this.armLength[side] = worldPos(a.upper).distanceTo(worldPos(a.fore)) + worldPos(a.fore).distanceTo(worldPos(a.hand));
      a.frame = this.handFrame(side);
      a.curl = this.fingerAxes(side);
    }
    for (const side of ['L', 'R']) {
      const l = this.legs[side];
      l.length = worldPos(l.thigh).distanceTo(worldPos(l.calf)) + worldPos(l.calf).distanceTo(worldPos(l.foot));
    }
  }

  /**
   * How a hand is built, in the hand bone's own space: `fwd` from the wrist toward the middle
   * knuckle, `side` across the knuckles toward the index finger, `palm` out of the palm.
   */
  handFrame(side) {
    const a = this.arms[side];
    const hand = a.hand;
    const hp = worldPos(hand);
    const mid = worldPos(a.fingers[2][0] || hand.children[0]);
    const index = worldPos(a.fingers[1][0] || hand.children[0]);
    const pinky = worldPos(a.fingers[4][0] || hand.children[0]);
    const fwd = mid.sub(hp).normalize();
    const across = index.sub(pinky).normalize();
    // Palm normal: fwd × (pinky→index) points out of the left palm; the right hand is mirrored
    const palm = new THREE.Vector3().crossVectors(fwd, across).normalize();
    if (side === 'R') palm.negate();
    const toLocal = worldQuat(hand).invert();
    const f = fwd.applyQuaternion(toLocal).normalize();
    const p = palm.applyQuaternion(toLocal).normalize();
    // Re-orthogonalise into a right-handed basis (fwd, palm, side)
    const s = new THREE.Vector3().crossVectors(f, p).normalize();
    p.crossVectors(s, f).normalize();
    return { fwd: f, palm: p, side: s };
  }

  /** For each finger joint, the axis (in its own space) that curls it toward the palm. */
  fingerAxes(side) {
    const a = this.arms[side];
    const handQ = worldQuat(a.hand);
    const palmW = a.frame.palm.clone().applyQuaternion(handQ);
    return a.fingers.map((chain, fi) =>
      chain.map((bone, j) => {
        const next = chain[j + 1] || bone.children.find((c) => c.isBone || c.isObject3D);
        if (!next) return null;
        const dir = worldPos(next).sub(worldPos(bone)).normalize();
        // Curling turns the finger's direction toward the palm: axis = dir × palm
        let axis = new THREE.Vector3().crossVectors(dir, palmW).normalize();
        if (fi === 0) {
          // The thumb folds across the palm instead
          const fwdW = a.frame.fwd.clone().applyQuaternion(handQ);
          axis = new THREE.Vector3().crossVectors(dir, fwdW).normalize();
          if (side === 'L') axis.negate();
        }
        const bq = worldQuat(bone).invert();
        return axis.applyQuaternion(bq).normalize();
      }),
    );
  }

  /** Curls the fingers of a hand. amounts: [thumb, index, middle, ring, pinky], radians per joint. */
  curl(side, amounts) {
    const a = this.arms[side];
    a.fingers.forEach((chain, fi) => {
      const k = amounts[fi] ?? amounts[amounts.length - 1];
      chain.forEach((bone, j) => {
        const axis = a.curl[fi][j];
        if (!axis) return;
        bone.quaternion.multiply(_q.setFromAxisAngle(axis, k * (j === 0 ? 0.8 : 1)));
      });
    });
  }

  /**
   * Sets a hand's world orientation from where its fingers should point (fwd) and which way the
   * palm should face (palm), both world directions.
   */
  orientHand(side, fwd, palm) {
    const fr = this.arms[side].frame;
    // World basis we want, and the local basis it should come from
    const f = _a.copy(fwd).normalize();
    const s = _b.crossVectors(f, palm).normalize();
    const p = _c.crossVectors(s, f).normalize();
    _m.makeBasis(f, p, s);
    const want = new THREE.Quaternion().setFromRotationMatrix(_m);
    const lm = new THREE.Matrix4().makeBasis(fr.fwd, fr.palm, fr.side);
    const local = new THREE.Quaternion().setFromRotationMatrix(lm);
    setWorldQuat(this.arms[side].hand, want.multiply(local.invert()));
  }
}

