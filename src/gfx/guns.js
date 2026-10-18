// Weapons. The long guns are modelled here from side profiles (extruded and bevelled) and parts;
// the sidearm and the bolt-action marksman rifle are photo-scanned Poly Haven models. Each gun is
// built along +x (muzzle forward), +y up, +z to its right, with its origin at the top of the
// pistol grip, and carries anchors: where each hand goes and how it sits, the shoulder stock,
// the muzzle, and the magazine well for reloads. Metal gets procedural wear on its edges.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, float, mix, mx_fractal_noise_float, mx_noise_float, positionLocal, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import { loadGLB, loadSurface } from './assets.js';

// ------------------------------------------------------------------ materials

function metal(c = '#1c1d20', { rough = 0.42, wear = 0.35 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  // Wear: finish rubbed bright in patches and along edges, fine scratches everywhere
  const p = positionLocal.mul(60);
  const scratches = smoothstep(0.62, 0.8, mx_noise_float(p.mul(vec2(1, 9).xyx))).mul(0.5);
  // Finish worn through in small patches (handling marks), not big blotches
  const rub = smoothstep(0.6, 0.85, mx_fractal_noise_float(positionLocal.mul(55), 3, 2, 0.5).mul(0.5).add(0.5)).mul(wear);
  const k = rub.add(scratches.mul(wear)).min(1);
  m.colorNode = mix(color(c), color('#5a5c60'), k);
  m.roughnessNode = mix(float(rough), float(0.28), k).add(mx_noise_float(positionLocal.mul(300)).mul(0.05));
  m.metalnessNode = mix(float(0.75), float(1), k);
  return m;
}

function polymer(c = '#1b1b1c', rough = 0.72) {
  const m = new THREE.MeshStandardNodeMaterial();
  // Stippled texture: tiny bumps break up the highlight
  m.colorNode = color(c).mul(float(1).add(mx_noise_float(positionLocal.mul(220)).mul(0.08)));
  m.roughnessNode = float(rough).add(mx_noise_float(positionLocal.mul(400)).mul(0.08));
  m.metalnessNode = float(0);
  return m;
}

/** Stained, worn wooden furniture (scanned pine), grain running along the gun. */
async function woodMaterial(tint = '#ffffff', gloss = 1) {
  const s = await loadSurface('stained_pine');
  const m = new THREE.MeshStandardNodeMaterial();
  const c = uv().mul(vec2(2.2, 2.2));
  m.colorNode = texture(s.map, c).rgb.mul(color(tint));
  m.normalMap = s.normal;
  m.roughnessNode = texture(s.arm, c).g.mul(0.8 * gloss);
  m.metalnessNode = float(0);
  return m;
}

/** Engraved gold plate, for a cartel boss's rifle. */
function goldMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  // Scrollwork: a fine noise pattern cut into the plating catches darker
  const scroll = smoothstep(0.6, 0.75, mx_noise_float(positionLocal.mul(vec3(90, 90, 30))).mul(0.5).add(0.5));
  m.colorNode = mix(color('#f0c060'), color('#9a6c22'), scroll.mul(0.35));
  m.roughnessNode = mix(float(0.16), float(0.32), scroll);
  m.metalnessNode = float(1);
  return m;
}

// ------------------------------------------------------------------ geometry helpers

/** A side profile (x,y points) extruded `depth` across z, centred, with softened edges. */
function profile(points, depth, bevel = 0.004) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const b = Math.min(bevel, depth * 0.3);
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - b * 2, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(depth - b * 2) / 2);
  return g;
}

/** A cylinder along x from x0 to x1. */
function tube(x0, x1, r, y = 0, z = 0, sides = 16, r1 = r) {
  const g = new THREE.CylinderGeometry(r1, r, x1 - x0, sides);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, z);
  return g;
}

function box(x0, x1, y0, y1, w, z = 0) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, w);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  return g;
}

/** Picatinny rail: a strip of teeth along x. */
function rail(x0, x1, y, w = 0.022) {
  const parts = [box(x0, x1, y, y + 0.006, w)];
  for (let x = x0 + 0.003; x < x1 - 0.003; x += 0.01) parts.push(box(x, x + 0.005, y + 0.006, y + 0.011, w));
  return mergeGeometries(parts);
}

/** Builds a gun from {material: [geometries]} into a group, merging per material. */
function assemble(parts) {
  const group = new THREE.Group();
  for (const [mat, geos] of parts) {
    const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => {
      for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k);
      if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
      return x;
    }));
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Hand placements on a gun, in its space. at: the wrist; fwd: wrist toward the knuckles; palm:
 * out of the palm; curl: finger curl in radians [thumb, index, middle, ring, pinky].
 */
const RIGHT_ON_GRIP = (at) => ({ at, fwd: v(0.96, -0.27, 0.0), palm: v(0.15, 0.05, -1), curl: [0.5, 1.15, 1.35, 1.4, 1.45] });
const LEFT_ON_GRIP = (at) => ({ at, fwd: v(0.97, -0.05, 0.22), palm: v(0.0, 0.1, 1), curl: [0.6, 1.2, 1.3, 1.35, 1.4] });
const LEFT_UNDER = (at) => ({ at, fwd: v(0.45, 0.0, 0.9), palm: v(0, 1, 0), curl: [0.4, 0.9, 1.0, 1.05, 1.1] });

// ------------------------------------------------------------------ the guns

let shared = null;
async function mats() {
  if (!shared) {
    shared = {
      metal: metal('#1c1d20'),
      steel: metal('#2a2b2e', { rough: 0.35, wear: 0.5 }),
      black: polymer('#18181a'),
      tan: polymer('#8a7656', 0.75),
      olive: polymer('#4a4c36', 0.75),
      grey: polymer('#3a3c40', 0.7),
      glass: new THREE.MeshPhysicalNodeMaterial({ color: '#0a1218', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 }),
      reticle: (() => {
        const m = new THREE.MeshBasicNodeMaterial();
        m.colorNode = color('#ff2a1a').mul(8);
        return m;
      })(),
      wood: await woodMaterial(),
      darkWood: await woodMaterial('#7a5a48', 0.8),
      gold: goldMaterial(),
      blued: metal('#17181b', { rough: 0.38, wear: 0.18 }),
    };
  }
  return shared;
}

/** The contractors' carbine: collapsible stock, rails, vertical grip, holographic sight. */
async function carbine(finish = 'black') {
  const M = await mats();
  const furn = M[finish] || M.black;
  const p = [];
  const mt = [];
  // Stock and buffer tube
  p.push(profile([[-0.4, -0.075], [-0.4, 0.035], [-0.37, 0.046], [-0.22, 0.034], [-0.15, 0.03], [-0.15, -0.008], [-0.22, -0.02], [-0.33, -0.062], [-0.37, -0.075]], 0.04));
  mt.push(tube(-0.3, -0.04, 0.016, 0.012, 0, 14));
  // Lower receiver with magazine well and trigger guard
  mt.push(profile([[-0.06, -0.002], [0.15, -0.002], [0.15, -0.03], [0.142, -0.068], [0.072, -0.068], [0.066, -0.03], [0.02, -0.03], [-0.02, -0.012], [-0.06, -0.012]], 0.034, 0.003));
  mt.push(box(-0.005, 0.07, -0.05, -0.044, 0.012));
  // Pistol grip
  p.push(profile([[-0.04, -0.008], [0.012, -0.008], [0.003, -0.05], [-0.012, -0.112], [-0.052, -0.106], [-0.044, -0.05]], 0.03));
  // Upper receiver, rail, charging handle
  mt.push(profile([[-0.07, -0.002], [0.17, -0.002], [0.17, 0.046], [-0.06, 0.046], [-0.07, 0.03]], 0.033, 0.003));
  mt.push(rail(-0.06, 0.17, 0.046, 0.022));
  mt.push(box(-0.085, -0.06, 0.03, 0.042, 0.04));
  // Handguard: octagonal with rails on four sides
  p.push(tube(0.17, 0.43, 0.026, 0.022, 0, 8));
  mt.push(rail(0.17, 0.43, 0.048, 0.02));
  for (const s of [-1, 1]) {
    const r = rail(0.2, 0.4, -0.004, 0.018);
    r.rotateX((s * Math.PI) / 2);
    r.translate(0, 0.022, 0);
    mt.push(r);
  }
  // Barrel, gas block, flash hider
  mt.push(tube(0.43, 0.56, 0.0095, 0.022, 0, 12));
  mt.push(box(0.44, 0.47, 0.012, 0.042, 0.022));
  mt.push(tube(0.56, 0.615, 0.012, 0.022, 0, 8));
  // Magazine (separate, it comes out on reloads)
  const mag = profile([[0.078, -0.06], [0.138, -0.06], [0.152, -0.12], [0.168, -0.19], [0.108, -0.2], [0.094, -0.13]], 0.024, 0.003);
  // Vertical foregrip
  p.push(tube(0.0, 0.085, 0.014, 0, 0, 12).rotateZ(Math.PI / 2).translate(0.33, -0.045, 0));
  // Holographic sight
  const sight = [box(0.02, 0.13, 0.057, 0.072, 0.034), box(0.03, 0.12, 0.072, 0.118, 0.006, 0.019), box(0.03, 0.12, 0.072, 0.118, 0.006, -0.019), box(0.03, 0.12, 0.112, 0.12, 0.044)];
  const glass = box(0.07, 0.074, 0.075, 0.112, 0.032);
  const dot = new THREE.SphereGeometry(0.0022, 8, 6).translate(0.072, 0.093, 0);
  const g = assemble([[furn, p], [M.metal, [...mt, ...sight]], [M.glass, [glass]], [M.reticle, [dot]]]);
  const magMesh = assemble([[M.steel, [mag]]]);
  g.add(magMesh);
  return {
    group: g,
    mag: magMesh,
    kind: 'long',
    stock: v(-0.34, -0.02),
    muzzle: v(0.615, 0.022),
    sight: v(0.072, 0.093),
    well: v(0.12, -0.08),
    hands: { R: RIGHT_ON_GRIP(v(-0.082, -0.045, 0.036)), L: LEFT_UNDER(v(0.2, -0.035, -0.04)) },
  };
}

/**
 * The AK-47 pattern rifle: a drop-angle wooden stock, stamped receiver with a ribbed dust cover,
 * wooden pistol grip and handguards, a gas tube over the barrel, the front sight with its
 * protective ears, slant muzzle brake, cleaning rod, and the curved 30-round magazine.
 * rpk: the light machine gun version (long heavy barrel, club-foot stock, bipod, drum).
 * gold: a cartel boss's gold-plated piece.
 */
async function ak({ rpk = false, gold = false } = {}) {
  const M = await mats();
  const wood = gold ? M.darkWood : M.wood;
  const steel = gold ? M.gold : M.blued;
  const w = [];
  const mt = [];
  const blk = [];
  const L = rpk ? 0.84 : 0.62; // muzzle position
  // Stock: the comb drops away from the receiver; the RPK's has a club foot
  // (stock points behind the receiver are pulled in to the real length of pull)
  const pull = (pts) => pts.map(([x, y]) => [x < -0.07 ? -0.07 + (x + 0.07) * 0.83 : x, y]);
  if (rpk) w.push(profile(pull([[-0.07, 0.016], [-0.18, 0.0], [-0.43, -0.03], [-0.44, -0.065], [-0.44, -0.16], [-0.4, -0.16], [-0.33, -0.1], [-0.25, -0.13], [-0.2, -0.125], [-0.12, -0.06], [-0.07, -0.032]]), 0.04));
  else w.push(profile(pull([[-0.07, 0.016], [-0.42, -0.04], [-0.43, -0.05], [-0.43, -0.148], [-0.405, -0.15], [-0.13, -0.06], [-0.07, -0.032]]), 0.038));
  mt.push(box(-0.37, -0.362, -0.15, -0.042, 0.04)); // butt plate
  // Receiver, dust cover with its ribs, rear sight block and leaf
  mt.push(profile([[-0.075, -0.034], [0.215, -0.034], [0.215, 0.026], [-0.06, 0.026], [-0.075, 0.012]], 0.034, 0.002));
  mt.push(profile([[-0.07, 0.024], [0.2, 0.024], [0.2, 0.04], [0.19, 0.05], [-0.02, 0.05], [-0.07, 0.034]], 0.03, 0.006));
  for (let x = 0.02; x < 0.19; x += 0.028) mt.push(box(x, x + 0.006, 0.048, 0.053, 0.022));
  mt.push(box(0.2, 0.26, 0.022, 0.05, 0.03), box(0.215, 0.25, 0.05, 0.058, 0.018));
  // Charging handle and selector lever on the right
  mt.push(box(0.15, 0.17, 0.01, 0.022, 0.012, 0.024), new THREE.CylinderGeometry(0.007, 0.007, 0.022, 8).rotateX(Math.PI / 2).translate(0.163, 0.016, 0.036));
  mt.push(box(-0.04, 0.1, 0.004, 0.014, 0.004, 0.019));
  // Rivets
  for (const [x, y] of [[-0.05, -0.015], [0.02, -0.022], [0.06, -0.022], [0.2, -0.02], [0.2, 0.0]]) for (const z of [-0.018, 0.018]) mt.push(new THREE.SphereGeometry(0.0035, 6, 4).translate(x, y, z));
  // Pistol grip and trigger guard
  w.push(profile([[-0.036, -0.03], [0.002, -0.03], [-0.018, -0.118], [-0.056, -0.112]], 0.03));
  mt.push(profile([[0.0, -0.034], [0.07, -0.034], [0.072, -0.045], [0.05, -0.062], [0.005, -0.062], [0.0, -0.05], [0.008, -0.05], [0.012, -0.056], [0.046, -0.056], [0.062, -0.042], [0.062, -0.04], [0.0, -0.04]], 0.008, 0.001));
  mt.push(box(0.024, 0.03, -0.055, -0.035, 0.005)); // trigger
  // Handguards: the lower one with finger grooves, the upper one over the gas tube
  w.push(profile([[0.215, -0.034], [0.4, -0.03], [0.405, -0.012], [0.4, 0.006], [0.215, 0.006]], 0.044, 0.008));
  for (let x = 0.25; x < 0.39; x += 0.03) blk.push(box(x, x + 0.006, -0.032, -0.012, 0.046));
  w.push(tube(0.255, 0.4, 0.018, 0.034, 0, 12));
  // Barrel, gas tube and block, front sight, muzzle brake, cleaning rod
  mt.push(tube(0.215, L, rpk ? 0.011 : 0.0085, 0.0, 0, 12));
  mt.push(tube(0.4, 0.44, 0.011, 0.034, 0, 10));
  mt.push(box(0.43, 0.47, -0.012, 0.048, 0.026));
  mt.push(box(L - 0.05, L - 0.02, -0.012, 0.022, 0.024));
  mt.push(box(L - 0.045, L - 0.035, 0.022, 0.062, 0.004)); // front sight post
  for (const z of [-0.013, 0.013]) mt.push(box(L - 0.05, L - 0.03, 0.02, 0.066, 0.004, z)); // its ears
  mt.push(tube(0.4, L - 0.05, 0.003, -0.015, 0, 6)); // cleaning rod
  if (!rpk) {
    mt.push(tube(L, L + 0.035, 0.012, 0.0, 0, 10));
  } else {
    // Folded bipod under the muzzle
    for (const z of [-0.012, 0.012]) mt.push(box(L - 0.32, L - 0.06, -0.026, -0.018, 0.006, z));
    mt.push(tube(L, L + 0.04, 0.013, 0.0, 0, 10));
  }
  const g = assemble([[wood, w], [steel, mt], [gold ? M.gold : M.blued, blk]]);
  // The magazine (separate: it comes out on reloads): the curved 30-rounder, or the RPK's drum
  let magGeo;
  if (rpk) {
    const drum = new THREE.CylinderGeometry(0.095, 0.095, 0.075, 28).rotateX(Math.PI / 2).translate(0.12, -0.14, 0);
    const feed = profile([[0.075, -0.034], [0.135, -0.034], [0.15, -0.06], [0.09, -0.06]], 0.03, 0.002);
    magGeo = [drum, feed];
  } else {
    // The banana curve: front and rear edges are arcs sweeping forward toward the bottom
    const bez = (a, b, c, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]];
    const front = [];
    const rear = [];
    for (let i = 0; i <= 8; i++) {
      front.push(bez([0.134, -0.034], [0.15, -0.15], [0.262, -0.236], i / 8));
      rear.push(bez([0.078, -0.034], [0.09, -0.18], [0.212, -0.272], i / 8));
    }
    magGeo = [profile([...front, ...rear.reverse()], 0.026, 0.003)];
    for (const t of [0.35, 0.6, 0.82]) {
      // Stiffening ribs pressed across the body
      const [fx, fy] = bez([0.134, -0.034], [0.15, -0.15], [0.262, -0.236], t);
      const [rx, ry] = bez([0.078, -0.034], [0.09, -0.18], [0.212, -0.272], t);
      const rib = new THREE.BoxGeometry(Math.hypot(fx - rx, fy - ry), 0.008, 0.029).rotateZ(Math.atan2(fy - ry, fx - rx)).translate((fx + rx) / 2, (fy + ry) / 2, 0);
      magGeo.push(rib);
    }
  }
  const magMesh = assemble([[gold ? M.gold : M.blued, magGeo]]);
  g.add(magMesh);
  return {
    group: g,
    mag: magMesh,
    kind: rpk ? 'heavy' : 'long',
    stock: v(-0.36, -0.07),
    muzzle: v(L + 0.035, 0.0),
    sight: v(0.235, 0.058),
    well: v(0.1, -0.06),
    hands: { R: RIGHT_ON_GRIP(v(-0.074, -0.052, 0.034)), L: LEFT_UNDER(v(rpk ? 0.29 : 0.26, -0.036, -0.036)) },
  };
}

/** Militia rifle: stamped receiver, wood furniture, curved magazine (an original design). */
async function oldRifle() {
  const M = await mats();
  const wood = [];
  const mt = [];
  wood.push(profile([[-0.43, -0.09], [-0.43, 0.02], [-0.4, 0.03], [-0.2, 0.02], [-0.07, 0.012], [-0.07, -0.015], [-0.19, -0.035], [-0.38, -0.09]], 0.038));
  mt.push(profile([[-0.08, -0.03], [0.22, -0.03], [0.23, 0.035], [-0.07, 0.04], [-0.08, 0.02]], 0.034, 0.002));
  wood.push(profile([[-0.04, -0.03], [0.0, -0.03], [-0.012, -0.11], [-0.045, -0.105]], 0.028));
  wood.push(profile([[0.23, -0.025], [0.46, -0.018], [0.46, 0.03], [0.23, 0.036]], 0.042));
  mt.push(tube(0.23, 0.6, 0.008, 0.045, 0, 10)); // gas tube
  mt.push(tube(0.46, 0.66, 0.0095, 0.012, 0, 12));
  mt.push(box(0.6, 0.615, 0.012, 0.06, 0.008)); // front sight
  mt.push(box(0.2, 0.235, 0.035, 0.055, 0.012)); // rear sight
  const mag = profile([[0.1, -0.03], [0.16, -0.03], [0.19, -0.11], [0.205, -0.19], [0.15, -0.205], [0.125, -0.12]], 0.026, 0.003);
  const g = assemble([[M.wood, wood], [M.metal, mt]]);
  const magMesh = assemble([[M.steel, [mag]]]);
  g.add(magMesh);
  return {
    group: g,
    mag: magMesh,
    kind: 'long',
    stock: v(-0.37, -0.03),
    muzzle: v(0.66, 0.012),
    sight: v(0.2, 0.06),
    well: v(0.14, -0.06),
    hands: { R: RIGHT_ON_GRIP(v(-0.09, -0.06, 0.035)), L: LEFT_UNDER(v(0.25, -0.06, -0.035)) },
  };
}

async function shotgun(finish = 'black') {
  const M = await mats();
  const furn = finish === 'wood' ? M.wood : M[finish] || M.black;
  const p = [];
  const mt = [];
  p.push(profile([[-0.42, -0.085], [-0.42, 0.025], [-0.39, 0.035], [-0.2, 0.025], [-0.06, 0.02], [-0.06, -0.015], [-0.16, -0.03], [-0.36, -0.085]], 0.04));
  p.push(profile([[-0.05, -0.02], [0.0, -0.02], [-0.012, -0.1], [-0.048, -0.095]], 0.03));
  mt.push(profile([[-0.07, -0.025], [0.2, -0.025], [0.2, 0.04], [-0.06, 0.042], [-0.07, 0.02]], 0.036, 0.003));
  mt.push(tube(0.2, 0.68, 0.012, 0.025, 0, 14));
  mt.push(tube(0.2, 0.6, 0.011, -0.004, 0, 12)); // magazine tube
  p.push(tube(0.3, 0.46, 0.022, 0.0, 0, 12)); // pump
  const g = assemble([[furn, p], [M.metal, mt]]);
  return { group: g, mag: null, kind: 'long', stock: v(-0.36, -0.03), muzzle: v(0.68, 0.025), sight: v(0.1, 0.05), well: v(0.12, -0.03), hands: { R: RIGHT_ON_GRIP(v(-0.09, -0.05, 0.036)), L: LEFT_UNDER(v(0.3, -0.055, -0.035)) }, pump: true };
}

async function lmg() {
  const M = await mats();
  const p = [];
  const mt = [];
  p.push(profile([[-0.45, -0.09], [-0.45, 0.03], [-0.41, 0.045], [-0.15, 0.035], [-0.1, 0.03], [-0.1, -0.02], [-0.2, -0.035], [-0.38, -0.09]], 0.046));
  p.push(profile([[-0.05, -0.02], [0.0, -0.02], [-0.012, -0.11], [-0.05, -0.105]], 0.032));
  mt.push(profile([[-0.1, -0.03], [0.3, -0.03], [0.3, 0.06], [-0.08, 0.065], [-0.1, 0.04]], 0.05, 0.003));
  mt.push(rail(-0.06, 0.28, 0.065, 0.024));
  mt.push(tube(0.3, 0.62, 0.03, 0.02, 0, 12)); // heat shield
  mt.push(tube(0.62, 0.86, 0.012, 0.02, 0, 12));
  mt.push(tube(0.86, 0.92, 0.016, 0.02, 0, 8));
  mt.push(box(0.05, 0.2, 0.07, 0.09, 0.02)); // carry handle
  const ammo = box(0.06, 0.2, -0.17, -0.03, 0.11, 0.035);
  const g = assemble([[M.black, p], [M.metal, mt], [M.olive, [ammo]]]);
  return { group: g, mag: null, kind: 'heavy', stock: v(-0.38, -0.03), muzzle: v(0.92, 0.02), sight: v(0.1, 0.09), well: v(0.13, -0.05), hands: { R: RIGHT_ON_GRIP(v(-0.09, -0.06, 0.04)), L: LEFT_UNDER(v(0.3, -0.06, -0.045)) } };
}

/** Six-barrel rotary gun, carried at the hip on a sling, fed from a backpack. */
async function rotary() {
  const M = await mats();
  const mt = [box(-0.18, 0.15, -0.08, 0.08, 0.15)];
  const spinParts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    spinParts.push(tube(0.15, 0.85, 0.014, Math.cos(a) * 0.045, Math.sin(a) * 0.045, 8));
  }
  spinParts.push(tube(0.2, 0.24, 0.07, 0, 0, 16), tube(0.7, 0.74, 0.07, 0, 0, 16));
  const handle = [tube(-0.05, 0.1, 0.018, 0.13, 0, 10), box(-0.16, -0.12, -0.18, 0.0, 0.03)];
  const g = assemble([[M.metal, mt], [M.black, handle]]);
  const spin = assemble([[M.steel, spinParts]]);
  g.add(spin);
  return { group: g, spin, mag: null, kind: 'rotary', stock: v(-0.18, 0), muzzle: v(0.85, 0), sight: v(0, 0.1), well: v(-0.1, -0.1), hands: { R: RIGHT_ON_GRIP(v(-0.2, -0.1, 0.04)), L: { at: v(-0.02, 0.1, -0.04), fwd: v(1, 0, 0), palm: v(0, -1, 0), curl: [0.6, 1.3, 1.4, 1.4, 1.4] } } };
}

/** A photo-scanned gun, re-centred so its grip is at the origin. */
async function scanned(id, { scale = 1, offset, rot = [0, 0, 0] }) {
  const g = (await loadGLB(`props/${id}.glb`)).scene.clone();
  const inner = new THREE.Group();
  inner.add(g);
  g.rotation.set(...rot);
  g.scale.setScalar(scale);
  g.position.copy(offset);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return inner;
}

async function pistol() {
  const group = await scanned('service_pistol', { offset: v(0.06, -0.02, 0) });
  return { group, mag: null, kind: 'pistol', stock: v(-0.1, 0), muzzle: v(0.23, 0.04), sight: v(0.0, 0.06), well: v(-0.02, -0.1), hands: { R: RIGHT_ON_GRIP(v(-0.075, -0.05, 0.03)), L: { at: v(-0.06, -0.075, -0.045), fwd: v(0.6, -0.4, 0.7), palm: v(0.3, 0.3, 0.9), curl: [0.4, 1.2, 1.3, 1.35, 1.4] } } };
}

async function boltRifle() {
  const group = await scanned('bolt_action_rifle_7_62', { offset: v(0.2, 0.0, 0) });
  return { group, mag: null, kind: 'long', stock: v(-0.4, -0.05), muzzle: v(0.83, 0.03), sight: v(0.15, 0.09), well: v(0.12, -0.04), hands: { R: RIGHT_ON_GRIP(v(-0.12, -0.06, 0.035)), L: LEFT_UNDER(v(0.25, -0.05, -0.035)) }, bolt: true };
}

const BUILDERS = { ak, rpk: () => ak({ rpk: true }), goldAk: () => ak({ gold: true }), carbine, carbineTan: () => carbine('tan'), carbineOlive: () => carbine('olive'), oldRifle, shotgun, shotgunWood: () => shotgun('wood'), lmg, rotary, pistol, boltRifle };

const protos = new Map();

/** Builds every gun once (models, materials, scans) so copies can be made instantly. */
export async function preloadGuns(kinds = Object.keys(BUILDERS)) {
  await Promise.all(
    kinds.map(async (k) => {
      if (!protos.has(k)) protos.set(k, await BUILDERS[k]());
    }),
  );
}

/** A new copy of a gun (shares geometry and materials with every other copy). Preload first. */
export function makeGun(kind) {
  const proto = protos.get(kind);
  if (!proto) throw new Error(`gun ${kind} not loaded`);
  const group = proto.group.clone(true);
  const magIndex = proto.mag ? proto.group.children.indexOf(proto.mag) : -1;
  const spinIndex = proto.spin ? proto.group.children.indexOf(proto.spin) : -1;
  return { ...proto, group, mag: magIndex >= 0 ? group.children[magIndex] : null, spin: spinIndex >= 0 ? group.children[spinIndex] : null, magRest: magIndex >= 0 ? group.children[magIndex].position.clone() : null };
}

export const GUN_KINDS = Object.keys(BUILDERS);
