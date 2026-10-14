// Low-poly characters. Each model faces +x with its feet at the origin and is a tree of pivots
// (hips, knees, shoulders, elbows, head); the shapes on each pivot are merged into one
// vertex-coloured mesh with a dark outline. All designs here are original: two contractors in
// tactical gear with painted face-plate masks, and the enemies of each mission.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const scratch = new THREE.Color();
const OUTLINE = 0.02;

const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x07060a, side: THREE.BackSide });
outlineMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed += normalize(normal) * ${OUTLINE.toFixed(3)};`);
};

function outlineGeometry(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  const welded = mergeVertices(g, 1e-4);
  welded.computeVertexNormals();
  return welded;
}

class Builder {
  constructor() {
    this.root = new THREE.Group();
    this.solid = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.parts = new Map();
    this.pivots = [];
    this.body = this.pivot(this.root, 0, 0, 0);
  }

  pivot(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    this.parts.set(g, { solid: [], glow: [] });
    this.pivots.push(g);
    return g;
  }

  add(pivot, geometry, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, glow = false } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    scratch.set(color);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([scratch.r, scratch.g, scratch.b], i);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.get(pivot)[glow ? 'glow' : 'solid'].push(g);
  }

  box(pivot, w, h, d, x, y, z, color, opts = {}) {
    this.add(pivot, new THREE.BoxGeometry(w, h, d), color, { x, y, z, ...opts });
  }

  cyl(pivot, rTop, rBottom, h, x, y, z, color, { sides = 10, ...opts } = {}) {
    this.add(pivot, new THREE.CylinderGeometry(rTop, rBottom, h, sides), color, { x, y, z, ...opts });
  }

  ball(pivot, r, x, y, z, color, opts = {}) {
    this.add(pivot, new THREE.IcosahedronGeometry(r, 2), color, { x, y, z, ...opts });
  }

  done(parts) {
    for (const [pivot, { solid, glow }] of this.parts) {
      if (solid.length) {
        const merged = mergeGeometries(solid);
        const mesh = new THREE.Mesh(merged, this.solid);
        mesh.castShadow = true;
        pivot.add(mesh);
        pivot.add(new THREE.Mesh(outlineGeometry(merged), outlineMaterial));
      }
      if (glow.length) pivot.add(new THREE.Mesh(mergeGeometries(glow), this.glowMaterial));
    }
    for (const p of this.pivots) p.userData.rest = p.position.clone();
    return { root: this.root, body: this.body, materials: [this.solid], pivots: this.pivots, ...parts };
  }
}

function leg(b, parent, { y, z, thigh, shin, r, pants, boot }) {
  const hip = b.pivot(parent, 0, y, z);
  b.cyl(hip, r, r * 0.85, thigh, 0, -thigh / 2, 0, pants);
  const knee = b.pivot(hip, 0, -thigh, 0);
  b.cyl(knee, r * 0.85, r * 0.7, shin, 0, -shin / 2, 0, pants);
  b.box(knee, r * 3.4, r * 1.4, r * 2.2, r * 0.7, -shin - r * 0.3, 0, boot);
  return [hip, knee];
}

function arm(b, parent, { y, z, upper, fore, r, sleeve, glove }) {
  const shoulder = b.pivot(parent, 0, y, z);
  b.ball(shoulder, r * 1.2, 0, 0, 0, sleeve);
  b.cyl(shoulder, r, r * 0.9, upper, 0, -upper / 2, 0, sleeve);
  const elbow = b.pivot(shoulder, 0, -upper, 0);
  b.cyl(elbow, r * 0.9, r * 0.8, fore, 0, -fore / 2, 0, sleeve);
  b.box(elbow, r * 1.8, r * 2, r * 1.6, 0, -fore - r * 0.8, 0, glove);
  return [shoulder, elbow];
}

/** Guns, built pointing along the forearm (down its −y axis) so they aim with the arm. */
function guns(b, elbow, fore) {
  const at = -fore - 0.12;
  const rifle = b.pivot(elbow, 0, at, 0);
  b.box(rifle, 0.06, 0.8, 0.07, 0, -0.25, 0, '#202024'); // receiver and barrel
  b.box(rifle, 0.12, 0.3, 0.07, 0.07, -0.05, 0, '#2a2a2e');
  b.box(rifle, 0.07, 0.12, 0.06, 0.11, 0.12, 0, '#3a3a40'); // magazine
  b.box(rifle, 0.05, 0.16, 0.06, -0.06, 0.3, 0, '#4a3a28'); // stock
  b.box(rifle, 0.05, 0.12, 0.05, -0.05, -0.1, 0, '#16161a'); // sight
  const pistol = b.pivot(elbow, 0, at, 0);
  b.box(pistol, 0.05, 0.22, 0.05, 0, -0.07, 0, '#18181c');
  b.box(pistol, 0.08, 0.05, 0.05, 0.04, 0.04, 0, '#2a2a2e');
  const sniper = b.pivot(elbow, 0, at, 0);
  b.box(sniper, 0.06, 1.15, 0.06, 0, -0.4, 0, '#2a2e2a');
  b.box(sniper, 0.06, 0.28, 0.08, -0.08, -0.15, 0, '#16161a'); // scope
  b.box(sniper, 0.05, 0.22, 0.07, 0.06, 0.25, 0, '#3a4a2a');
  const muzzle = b.pivot(elbow, 0, at - 0.72, 0);
  b.ball(muzzle, 0.1, 0, 0, 0, '#ffd060', { glow: true });
  return { rifle, pistol, sniper, muzzle };
}

/** Paints a mask pattern onto the face plate (shapes on the head pivot, facing +x). */
function mask(b, head, { pattern, base, accent }) {
  const x = 0.135;
  b.box(head, 0.04, 0.26, 0.22, x - 0.01, 0.11, 0, base); // the plate
  const paint = (w, h, y, z, color = accent) => b.box(head, 0.012, h, w, x + 0.012, y, z, color);
  if (pattern === 'stripe') paint(0.05, 0.26, 0.11, 0);
  if (pattern === 'split') paint(0.11, 0.26, 0.11, 0.055);
  if (pattern === 'chevron') {
    for (const [y, z, s] of [[0.2, -0.04, 1], [0.2, 0.04, -1], [0.16, -0.04, 1], [0.16, 0.04, -1]]) b.box(head, 0.012, 0.025, 0.07, x + 0.012, y, z, accent, { rx: s * 0.6 });
  }
  if (pattern === 'teeth') {
    paint(0.16, 0.06, 0.03, 0);
    for (let i = -3; i <= 3; i++) paint(0.014, 0.045, 0.03, i * 0.02, '#f4f0e6');
  }
  if (pattern === 'target') {
    paint(0.1, 0.012, 0.12, 0.05);
    paint(0.1, 0.012, 0.18, 0.05);
    paint(0.012, 0.07, 0.15, 0.002);
    paint(0.012, 0.07, 0.15, 0.098);
  }
  // Eye slits and breathing holes
  for (const z of [-0.05, 0.05]) b.box(head, 0.014, 0.025, 0.05, x + 0.016, 0.15, z, '#0a0a0c');
  for (const z of [-0.025, 0, 0.025]) b.box(head, 0.014, 0.012, 0.012, x + 0.016, 0.06, z, '#0a0a0c');
}

/** Hatch or Cruz. look: { suit, vest, mask: { pattern, base, accent }, pack } */
export function buildContractor(look) {
  const b = new Builder();
  const legSpec = { y: 0.94, thigh: 0.46, shin: 0.44, r: 0.085, pants: look.suit, boot: '#1a1814' };
  const [hipL, kneeL] = leg(b, b.body, { ...legSpec, z: -0.12 });
  const [hipR, kneeR] = leg(b, b.body, { ...legSpec, z: 0.12 });
  const torso = b.pivot(b.body, 0, 0.96, 0);
  b.cyl(torso, 0.19, 0.17, 0.22, 0, 0.1, 0, look.suit, { sides: 8 });
  b.box(torso, 0.3, 0.44, 0.46, 0, 0.38, 0, look.suit);
  b.box(torso, 0.34, 0.36, 0.48, 0.01, 0.4, 0, look.vest); // plate carrier
  for (const z of [-0.12, 0, 0.12]) b.box(torso, 0.07, 0.11, 0.1, 0.19, 0.3, z, look.vest); // mag pouches
  b.box(torso, 0.05, 0.08, 0.06, 0.18, 0.5, -0.17, '#3a3a3a'); // radio
  b.box(torso, 0.36, 0.05, 0.5, 0, 0.0, 0, '#2a2620'); // belt
  if (look.pack) b.box(torso, 0.2, 0.4, 0.36, -0.25, 0.4, 0, look.pack);
  const head = b.pivot(torso, 0.02, 0.66, 0);
  b.cyl(head, 0.07, 0.08, 0.1, 0, -0.02, 0, '#3a3a3a', { sides: 8 }); // neck gaiter
  b.ball(head, 0.135, -0.01, 0.13, 0, '#26262a'); // head under a knit cap
  b.cyl(head, 0.14, 0.145, 0.08, -0.01, 0.22, 0, look.cap || '#2e3a2e');
  mask(b, head, look.mask);
  const armSpec = { y: 0.56, upper: 0.29, fore: 0.27, r: 0.065, sleeve: look.suit, glove: '#1e1c1a' };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: -0.29 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: 0.29 });
  const g = guns(b, elbowR, armSpec.fore);
  return b.done({ kind: 'contractor', torso, head, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR, ...g });
}

// Enemy outfits per mission theme
const OUTFITS = {
  desert: { suit: '#a08860', vest: '#6a5a3a', head: '#c8b490', face: '#8a6a4a', boot: '#3a2a1a' },
  port: { suit: '#26282e', vest: '#3a3c44', head: '#1a1a1e', face: '#7a5a48', boot: '#141414' },
  snow: { suit: '#d8dee6', vest: '#8a949e', head: '#e8eef4', face: '#3a3a40', boot: '#2a2a2e' },
};

export function buildEnemy(type, theme) {
  const o = OUTFITS[theme] || OUTFITS.desert;
  const b = new Builder();
  const heavy = ['heavy', 'warlord', 'enforcer', 'warden'].includes(type);
  const boss = ['warlord', 'enforcer', 'warden'].includes(type);
  const bossColors = { warlord: ['#6a1a14', '#c8a030'], enforcer: ['#1a1a20', '#8a1a1a'], warden: ['#e8eef4', '#3a6a9a'] };
  const [armorColor, trim] = boss ? bossColors[type] : heavy ? ['#3a3e44', '#5a5e64'] : [o.vest, o.vest];
  const r = heavy ? 0.11 : 0.085;
  const legSpec = { y: 0.94, thigh: 0.46, shin: 0.44, r, pants: heavy ? armorColor : o.suit, boot: o.boot };
  const [hipL, kneeL] = leg(b, b.body, { ...legSpec, z: -0.13 });
  const [hipR, kneeR] = leg(b, b.body, { ...legSpec, z: 0.13 });
  const torso = b.pivot(b.body, 0, 0.96, 0);
  b.box(torso, heavy ? 0.42 : 0.3, 0.46, heavy ? 0.6 : 0.46, 0, 0.36, 0, heavy ? armorColor : o.suit);
  b.box(torso, heavy ? 0.46 : 0.33, heavy ? 0.42 : 0.32, heavy ? 0.64 : 0.47, 0.01, 0.4, 0, heavy ? trim : o.vest);
  if (heavy) for (const z of [-0.36, 0.36]) b.box(torso, 0.3, 0.16, 0.2, 0, 0.62, z, armorColor); // pauldrons
  const head = b.pivot(torso, 0.02, 0.66, 0);
  if (heavy) {
    b.ball(head, 0.16, 0, 0.12, 0, armorColor);
    b.box(head, 0.06, 0.12, 0.26, 0.14, 0.13, 0, '#101418'); // visor
    b.box(head, 0.02, 0.03, 0.2, 0.17, 0.13, 0, boss ? '#ff4030' : '#40a0ff', { glow: true });
  } else if (theme === 'snow') {
    b.ball(head, 0.135, 0, 0.13, 0, o.head);
    b.box(head, 0.05, 0.07, 0.24, 0.12, 0.15, 0, '#202428'); // goggles
    b.box(head, 0.02, 0.04, 0.2, 0.15, 0.15, 0, '#ff9a30', { glow: true });
  } else {
    b.ball(head, 0.135, 0, 0.13, 0, o.face);
    b.ball(head, 0.142, -0.015, 0.16, 0, o.head); // wrap or beanie
    b.box(head, 0.04, 0.1, 0.22, 0.12, 0.08, 0, o.head); // face cloth
    for (const z of [-0.045, 0.045]) b.box(head, 0.02, 0.02, 0.03, 0.13, 0.15, z, '#f0e8d8');
  }
  if (type === 'sniper') b.box(torso, 0.2, 0.3, 0.5, -0.1, 0.65, 0, theme === 'snow' ? '#d0d8e0' : '#5a6a3a'); // hooded shoulders
  const armSpec = { y: 0.56, upper: 0.29, fore: 0.27, r: heavy ? 0.085 : 0.065, sleeve: heavy ? armorColor : o.suit, glove: '#1a1a1a' };
  const [armL, elbowL] = arm(b, torso, { ...armSpec, z: heavy ? -0.38 : -0.29 });
  const [armR, elbowR] = arm(b, torso, { ...armSpec, z: heavy ? 0.38 : 0.29 });
  // Their gun
  const gun = b.pivot(elbowR, 0, -armSpec.fore - 0.12, 0);
  if (type === 'warden') {
    for (const [dx, dz] of [[0.03, 0.03], [-0.03, 0.03], [0.03, -0.03], [-0.03, -0.03]]) b.cyl(gun, 0.025, 0.025, 0.9, dx, -0.4, dz, '#2a2a2e', { sides: 6 });
    b.box(gun, 0.18, 0.3, 0.18, 0, 0.05, 0, '#3a3a40');
  } else if (heavy) {
    b.box(gun, 0.1, 0.9, 0.1, 0, -0.3, 0, '#26262a');
    b.box(gun, 0.16, 0.2, 0.14, 0.1, -0.05, 0, '#3a3a40'); // box magazine
  } else if (type === 'shotgunner') {
    b.box(gun, 0.07, 0.75, 0.07, 0, -0.25, 0, '#2a2420');
    b.box(gun, 0.07, 0.2, 0.06, -0.03, 0.25, 0, '#5a3a20');
  } else if (type === 'sniper') {
    b.box(gun, 0.06, 1.15, 0.06, 0, -0.4, 0, '#3a3a30');
    b.box(gun, 0.06, 0.26, 0.08, -0.08, -0.15, 0, '#16161a');
  } else {
    b.box(gun, 0.06, 0.72, 0.07, 0, -0.22, 0, '#2a2620');
    b.box(gun, 0.06, 0.14, 0.05, 0.08, 0.05, 0, '#3a3020', { rz: -0.3 }); // curved mag
    b.box(gun, 0.05, 0.16, 0.06, -0.04, 0.28, 0, '#6a4a28');
  }
  const muzzle = b.pivot(elbowR, 0, -armSpec.fore - 0.12 - (heavy ? 0.78 : 0.62), 0);
  b.ball(muzzle, heavy ? 0.14 : 0.1, 0, 0, 0, '#ffd060', { glow: true });
  const scale = heavy ? (boss ? 1.35 : 1.2) : 1;
  b.root.scale.setScalar(scale);
  return b.done({ kind: type, torso, head, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR, muzzle });
}

// ------------------------------------------------------------------- poses

export function smoothPose(m, k) {
  for (const p of m.pivots) {
    const r = p.rotation;
    const prev = (p.userData.prev ??= r.clone());
    prev.x += (r.x - prev.x) * k;
    prev.y += (r.y - prev.y) * k;
    prev.z += (r.z - prev.z) * k;
    r.copy(prev);
  }
}

function resetPose(m) {
  for (const p of m.pivots) {
    p.rotation.set(0, 0, 0);
    p.position.copy(p.userData.rest);
  }
}

function runCycle(m, t, amount, speed) {
  const s = Math.sin(t * speed);
  m.hipL.rotation.z = s * 0.85 * amount;
  m.hipR.rotation.z = -s * 0.85 * amount;
  m.kneeL.rotation.z = -(0.15 + Math.max(0, -s) * 1.2) * amount;
  m.kneeR.rotation.z = -(0.15 + Math.max(0, s) * 1.2) * amount;
  m.body.position.y = Math.abs(Math.cos(t * speed)) * 0.05 * amount;
}

/** Arms up holding the gun, pointing along the aim (pitch tilts it up and down). */
function aimArms(m, pitch, pistol = false) {
  m.armR.rotation.z = Math.PI / 2 + pitch;
  m.elbowR.rotation.z = 0;
  if (pistol) {
    m.armL.rotation.z = Math.PI / 2 + pitch - 0.1;
    m.armL.rotation.x = -0.35;
  } else {
    m.armL.rotation.z = Math.PI / 2 + pitch - 0.25;
    m.armL.rotation.x = -0.55;
    m.elbowL.rotation.z = 0.5;
  }
}

/** Shared pose for contractors and enemies. a: the actor; pitch: aim pitch in radians. */
export function poseActor(m, a, t, pitch = 0) {
  resetPose(m);
  const speed = Math.hypot(a.vx, a.vz);
  const anim = a.anim;
  const crouched = a.crouch && !a.downed;
  if (anim === 'downed') {
    // On one knee, slumped, sidearm up
    m.body.position.y = -0.45;
    m.hipL.rotation.z = 1.4;
    m.kneeL.rotation.z = -2;
    m.hipR.rotation.z = -0.3;
    m.kneeR.rotation.z = -1.6;
    m.torso.rotation.z = -0.25;
    m.armL.rotation.x = 0.4;
    m.armR.rotation.z = Math.PI / 2 + pitch;
    return;
  }
  if (anim === 'boost') {
    m.body.position.y = -0.4;
    m.hipL.rotation.z = 1.5;
    m.kneeL.rotation.z = -2.2;
    m.kneeR.rotation.z = -1.4;
    m.armL.rotation.z = 0.8;
    m.armR.rotation.z = 0.8;
    m.elbowL.rotation.z = 1.4;
    m.elbowR.rotation.z = 1.4;
    return;
  }
  if (speed > 0.6) runCycle(m, a.animT, Math.min(1, speed / 6), anim === 'sprint' ? 0.32 : 0.24);
  if (crouched) {
    m.body.position.y = -0.38;
    m.hipL.rotation.z = 1.1 + m.hipL.rotation.z * 0.3;
    m.hipR.rotation.z = 0.6 + m.hipR.rotation.z * 0.3;
    m.kneeL.rotation.z = -1.7;
    m.kneeR.rotation.z = -1.3;
    m.torso.rotation.z = -0.25;
  }
  if (anim === 'sprint') {
    m.torso.rotation.z = -0.3;
    const s = Math.sin(a.animT * 0.32);
    m.armL.rotation.z = -s * 0.9;
    m.armR.rotation.z = 0.5;
    m.elbowR.rotation.z = 1.4;
    m.elbowL.rotation.z = 1;
    return;
  }
  if (anim === 'use') {
    m.body.position.y = -0.3;
    m.hipL.rotation.z = 1;
    m.kneeL.rotation.z = -1.6;
    m.kneeR.rotation.z = -1.2;
    m.torso.rotation.z = -0.5;
    m.armL.rotation.z = 1.2;
    m.armR.rotation.z = 1.2;
    return;
  }
  if (anim === 'vault') {
    m.hipL.rotation.z = 1.2;
    m.kneeL.rotation.z = -1.5;
    m.hipR.rotation.z = 0.8;
    m.kneeR.rotation.z = -1.2;
    m.armL.rotation.z = 1.5;
    m.torso.rotation.z = -0.3;
  }
  // Guns up
  aimArms(m, pitch, a.weapon === 'pistol');
  m.head.rotation.z = pitch * 0.5;
  m.torso.rotation.z += pitch * 0.25;
}

/** Shows the contractor's current gun and the muzzle flash. */
export function showGun(m, a, firing) {
  m.rifle.visible = a.weapon === 'rifle';
  m.pistol.visible = a.weapon === 'pistol';
  m.sniper.visible = a.weapon === 'sniper';
  m.muzzle.visible = firing;
}
