// The 3D view, on the GPU (three.js WebGPU renderer; WebGL 2 where WebGPU isn't available). Per
// mission it loads the sky, surfaces, props and people, dresses the level, and compiles every
// shader before play so nothing hitches mid-fight. Each frame it poses the people (motion
// capture, IK, ragdolls), turns the game's shots, impacts and explosions into effects, moves
// the helicopter, lamps and gates, and hands the picture to the post-processing pipeline.
// The game steps at 60 Hz; positions are blended between steps (rememberPositions/blend) so
// motion stays smooth at any refresh rate.
import * as THREE from 'three/webgpu';
import { abs, color, dot, float, normalView, positionLocal, positionViewDirection, pow, uniform } from 'three/tsl';
import { chest, ENEMY_TYPES, eye } from './actors.js';
import { boxesOnRay } from './level.js';
import { angleDiff, rayBox } from './math.js';
import { setAnisotropy } from './gfx/assets.js';
import { createPerson, enemyVariants, PEOPLE, preloadPeople } from './gfx/characters.js';
import { createFx } from './gfx/fx.js';
import { createGPU, gpuLabel } from './gfx/gpu.js';
import { buildHelicopter } from './gfx/heli.js';
import { WEATHER } from './gfx/materials.js';
import { createPost, keepNormals } from './gfx/post.js';
import { Ragdoll, rememberJoints } from './gfx/ragdoll.js';
import { applySky, SKY, THEMES } from './gfx/sky.js';
import { buildWorld, preloadWorld } from './gfx/world.js';

/** Development timing: set PROFILE.on to record slow frames. */
export const PROFILE = { on: false, slow: [], sum: { frames: 0, people: 0, world: 0, fx: 0, draw: 0, sim: 0, hud: 0 } };

/** Saves where everything is before a game step, for blending. */
export function rememberPositions(game) {
  const keep = (o) => {
    o._px = o.x;
    o._py = o.y;
    o._pz = o.z;
    o._pyaw = o.yaw;
  };
  for (const c of game.contractors) keep(c);
  for (const e of game.enemies) keep(e);
  for (const g of game.grenades) keep(g);
}

export function blend(o, alpha) {
  if (o._px === undefined) return { x: o.x, y: o.y, z: o.z, yaw: o.yaw ?? 0 };
  return {
    x: o._px + (o.x - o._px) * alpha,
    y: o._py + (o.y - o._py) * alpha,
    z: o._pz + (o.z - o._pz) * alpha,
    yaw: o.yaw === undefined ? 0 : o._pyaw + angleDiff(o._pyaw, o.yaw) * alpha,
  };
}

/** Which face of a box a point sits on, as an outward normal. */
function boxNormal(b, p) {
  const d = [
    [p.x - b.x0, -1, 0, 0],
    [b.x1 - p.x, 1, 0, 0],
    [p.y - b.y0, 0, -1, 0],
    [b.y1 - p.y, 0, 1, 0],
    [p.z - b.z0, 0, 0, -1],
    [b.z1 - p.z, 0, 0, 1],
  ].sort((a, c) => Math.abs(a[0]) - Math.abs(c[0]))[0];
  return { x: d[1], y: d[2], z: d[3] };
}

/** A volumetric-looking cone of light under a lamp: additive, brightest at the top, soft at the rim. */
function lightCone(height, radius, hex) {
  const geo = new THREE.ConeGeometry(radius, height, 24, 1, true).translate(0, -height / 2, 0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const h = float(1).add(positionLocal.y.div(height)).clamp(0, 1);
  const rim = abs(dot(normalView, positionViewDirection)).clamp(0, 1);
  m.colorNode = color(hex).mul(pow(h, 2.2)).mul(pow(rim, 1.5)).mul(0.12);
  m.mrtNode = keepNormals();
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 5;
  return mesh;
}


/**
 * Creates the renderer on a canvas (async: the GPU has to be set up). hooks: optional
 * { footstep(at, loud), whiz(side), impact(at, kind), heli(at|null) } so sounds follow what's drawn.
 */
export async function createRenderer(canvas, quality, hooks = {}, { backend = 'auto' } = {}) {
  const renderer = await createGPU(canvas, { backend });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setAnisotropy(8);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.08, 1500);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  const bounce = new THREE.HemisphereLight(0xffffff, 0x000000, 0);
  scene.add(bounce);
  const post = createPost(renderer, scene, camera);
  const fx = createFx(scene, renderer, quality);
  const dynamic = new THREE.Group();
  scene.add(dynamic);

  let q = quality;
  let theme = THEMES.desert;
  let themeName = 'desert';
  let world = null;
  let worldLevel = null;
  let game = null;
  let unsub = null;
  let people = new Map(); // actor → person
  let pool = new Map(); // role key → [person]
  const corpses = [];
  const drops = [];
  let hostage = null;
  let heli = null;
  const heliState = { t: 0, phase: 'away', leave: false, hoverT: 0 };
  const lampLights = [];
  const cones = [];
  const grenadeMeshes = [];
  const pickupMeshes = [];
  const objectiveRings = [];
  const breathT = new Map();
  const loaded = new Map();
  let looks = null;
  let lastFrame = null;
  let resetMarker = null;
  let sunVis = 0;
  let lastBlast = null;
  const v3 = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  // Sniper laser sights: HDR red lines that bloom
  // Shared, so every grenade and pickup is the same pipeline (warmed once during loading)
  const grenadeGeo = new THREE.SphereGeometry(0.065, 12, 8);
  const ledGeo = new THREE.SphereGeometry(0.018, 6, 4);
  const pickupGeo = new THREE.BoxGeometry(0.42, 0.22, 0.28);
  const stripeGeo = new THREE.BoxGeometry(0.43, 0.04, 0.29);
  const grenadeMat = new THREE.MeshStandardNodeMaterial({ color: '#3a4a2a', roughness: 0.6, metalness: 0.3 });
  const ledMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(6, 0.5, 0.3) });
  const pickupMat = new THREE.MeshStandardNodeMaterial({ color: '#4a5230', roughness: 0.6, metalness: 0.2 });
  const stripeMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2.5, 2, 0.6) });
  const laserGeo = new THREE.BufferGeometry();
  laserGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 6), 3));
  const laserMat = new THREE.LineBasicNodeMaterial({ transparent: true });
  const laserK = uniform(0.7);
  laserMat.colorNode = color(6, 0.3, 0.2);
  laserMat.opacityNode = laserK;
  laserMat.mrtNode = keepNormals();
  const lasers = new THREE.LineSegments(laserGeo, laserMat);
  lasers.frustumCulled = false;
  dynamic.add(lasers);

  function setQuality(nq) {
    q = nq;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    renderer.setPixelRatio(pr);
    sun.shadow.mapSize.set(q.shadows, q.shadows);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    const span = q.shadows >= 4096 ? 42 : q.shadows >= 2048 ? 34 : 26;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 320 });
    sun.shadow.camera.updateProjectionMatrix();
    post.setQuality(q);
    post.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1);
    post.setLook(theme);
    fx.setQuality(q);
  }

  /** Loads everything a theme needs (cached). */
  function load(t) {
    if (!loaded.has(t)) {
      const wt = t === 'menu' ? 'desert' : t;
      loaded.set(t, Promise.all([preloadWorld(wt), preloadPeople(wt)]).then(([assets]) => assets));
    }
    return loaded.get(t);
  }

  // ------------------------------------------------------------ people

  /** Which look an enemy gets (cycling through its type's looks), and its pool key. */
  const lookOf = (e) => e.id % enemyVariants(e.type, game.level.theme);
  const roleKey = (e) => `${e.type}|${game.level.theme}|${lookOf(e)}`;

  function personFor(a) {
    let p = people.get(a);
    if (p) return p;
    if (a === game.hatch || a === game.cruz) {
      p = createPerson(a.who, { look: looks?.[a.who] });
    } else {
      const key = roleKey(a);
      p = pool.get(key)?.pop() || createPerson({ enemy: a.type, theme: game.level.theme, seed: lookOf(a) });
    }
    dynamic.add(p.outer);
    for (const g of Object.values(p.guns)) dynamic.add(g.group);
    p.outer.visible = true;
    people.set(a, p);
    return p;
  }

  function removePerson(p) {
    dynamic.remove(p.outer);
    for (const g of Object.values(p.guns)) dynamic.remove(g.group);
  }

  function clearPeople() {
    for (const p of people.values()) removePerson(p);
    people = new Map();
    for (const c of corpses) removePerson(c.p);
    corpses.length = 0;
    for (const d of drops) dynamic.remove(d.group);
    drops.length = 0;
  }

  /** Builds the scene for a game (async: loads the theme). skyTheme overrides the sky (menu). */
  let queue = Promise.resolve();
  function setGame(g, lk, opts = {}) {
    queue = queue.then(() => buildFor(g, lk, opts)).catch((e) => console.error(e));
    return queue;
  }

  async function buildFor(g, lk, { skyTheme = null } = {}) {
    looks = lk;
    if (g === game) return;
    const sameLevel = !!(game && world && game.level === g.level && worldLevel === g.level);
    const wantSky = skyTheme || g.level.theme;
    const assets = await load(wantSky === 'menu' ? 'menu' : g.level.theme);
    game = g;
    unsub?.();
    unsub = g.on(onEvent);
    resetMarker = g.hatch;
    fx.clear();
    clearPeople();
    pool = new Map();
    if (!sameLevel || themeName !== wantSky) {
      if (world) scene.remove(world.group);
      themeName = wantSky;
      const applied = await applySky(scene, sun, themeName, bounce);
      theme = applied.theme;
      for (const l of lampLights) scene.remove(l);
      lampLights.length = 0;
      for (const c of cones) dynamic.remove(c);
      cones.length = 0;
      world = buildWorld(g.level, assets, { detail: q.detail, lit: !!theme.night });
      worldLevel = g.level;
      scene.add(world.group);
      WEATHER.wet.value = theme.wet || 0;
      WEATHER.snow.value = g.level.theme === 'snow' ? 1 : 0;
      PEOPLE.rim.value = theme.rim;
      PEOPLE.rimColor.value.copy(SKY.sunColor.value).lerp(new THREE.Color(1, 1, 1), 0.5);
      PEOPLE.dust.value.set(theme.dust?.color || '#8c7656');
      PEOPLE.dustK.value = theme.dust?.k ?? 0.5;
      post.setLook(theme);
      renderer.toneMappingExposure = 1;
      const nLamps = theme.night ? 6 : 3;
      for (let i = 0; i < nLamps; i++) {
        const l = new THREE.PointLight(0xffcf90, 0, 24, 2);
        scene.add(l);
        lampLights.push(l);
      }
      if (theme.night) {
        for (const lamp of world.lamps) {
          if (lamp.cheap || lamp.far) continue;
          const c = lightCone(lamp.y, lamp.y * 0.42, lamp.color);
          c.position.set(lamp.x, lamp.y, lamp.z);
          dynamic.add(c);
          cones.push(c);
        }
      }
      fx.setTheme(g.level.theme);
      fx.setWeather(theme.weather || null);
      fx.setAmbient({ fires: world.fires, smokes: world.smokes });
      for (const r of objectiveRings) dynamic.remove(r);
      objectiveRings.length = 0;
      for (const a of g.level.areas) {
        for (const o of a.objectives) {
          const ringMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(3, 2, 0.4), transparent: true, opacity: 0.85, depthWrite: false });
          ringMat.mrtNode = keepNormals();
          const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 40).rotateX(-Math.PI / 2), ringMat);
          ring.position.set(o.x, 0.03, o.z);
          ring.userData.objective = o;
          dynamic.add(ring);
          objectiveRings.push(ring);
        }
      }
    }
    // The two contractors, the hostage, and a few enemies made ahead of time (their shaders
    // compile now, and spawning one later costs nothing)
    for (const c of g.contractors) personFor(c);
    if (hostage) removePerson(hostage);
    hostage = null;
    const rescue = g.level.areas.flatMap((a) => a.objectives).find((o) => o.kind === 'rescue');
    if (rescue) {
      hostage = createPerson('hostage');
      hostage.target = rescue;
      hostage.actor = { x: rescue.x, y: 0, z: rescue.z, vx: 0, vz: 0, yaw: Math.PI * 0.6, anim: 'idle', weapon: null, sinceShot: 999 };
      dynamic.add(hostage.outer);
    }
    const types = new Set(g.level.areas.flatMap((a) => [...(a.spec.waves || []).flat().map((w) => w[0]), ...(a.spec.boss ? [a.spec.boss] : [])]));
    for (const type of types) {
      for (let s = 0; s < enemyVariants(type, g.level.theme); s++) {
        const key = `${type}|${g.level.theme}|${s}`;
        const p = createPerson({ enemy: type, theme: g.level.theme, seed: s });
        p.outer.position.set(-500, -50, 0); // out of sight, but drawn once for compiling
        dynamic.add(p.outer);
        for (const gun of Object.values(p.guns)) dynamic.add(gun.group);
        if (!pool.has(key)) pool.set(key, []);
        pool.get(key).push(p);
      }
    }
    if (heli) dynamic.remove(heli.root);
    heli = null;
    Object.assign(heliState, { t: 0, phase: 'away', leave: false, hoverT: 0 });
    const last = g.level.areas[g.level.areas.length - 1];
    if (last.extract) {
      heli = buildHelicopter();
      heli.extract = last.extract;
      heli.area = last.index;
      heli.root.position.set(-500, -50, 0);
      dynamic.add(heli.root);
    }
  }

  function newGrenade() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(grenadeGeo, grenadeMat);
    body.scale.set(1, 1.2, 1);
    body.castShadow = true;
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.y = 0.08;
    g.add(body, led);
    g.userData.led = led;
    dynamic.add(g);
    grenadeMeshes.push(g);
  }

  function newPickup() {
    const g = new THREE.Group();
    const box = new THREE.Mesh(pickupGeo, pickupMat);
    box.castShadow = true;
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    g.add(box, stripe);
    dynamic.add(g);
    pickupMeshes.push(g);
  }

  /** Compiles every shader in the scene now, so the first frames of play don't stutter. */
  async function warm(view) {
    placeCamera(view);
    // Everything that only appears in a fight is made ahead and laid out on the level for the
    // warm-up frames (the loading screen covers them), then put away
    while (grenadeMeshes.length < 6) newGrenade();
    while (pickupMeshes.length < 8) newPickup();
    const L = game.level;
    const mid = { x: (L.bounds.x0 + L.bounds.x1) / 2, z: (L.bounds.z0 + L.bounds.z1) / 2 };
    const reach = Math.max(L.bounds.x1 - L.bounds.x0, L.bounds.z1 - L.bounds.z0) / 2;
    let k = 0;
    const spot = (o, y = 0) => {
      o.position.set(mid.x + (k % 10) * 1.5 - 7, y, mid.z + Math.floor(k / 10) * 1.5 - 6);
      k++;
    };
    for (const m of [...grenadeMeshes, ...pickupMeshes]) {
      m.visible = true;
      spot(m, 0.3);
    }
    const warmPeople = [...people.values(), ...[...pool.values()].flat()];
    for (const p of warmPeople) {
      p.outer.visible = true;
      spot(p.outer);
      p.outer.updateMatrixWorld(true);
      for (const g of Object.values(p.guns)) {
        g.group.visible = true;
        g.group.position.copy(p.outer.position).add(new THREE.Vector3(0, 1.2, 0));
      }
    }
    if (heli) {
      heli.root.visible = true;
      heli.root.position.set(mid.x, 6, mid.z + 10);
    }
    fx.prewarm(camera);
    // First from high above, seeing the whole level, with the shadows stretched over all of it:
    // every shader (scene, ambient-occlusion pre-pass, shadow) compiles and every texture is
    // uploaded now rather than the first time it comes into view
    const sc = sun.shadow.camera;
    const keep = { left: sc.left, right: sc.right, top: sc.top, bottom: sc.bottom, far: sc.far };
    const span = reach + 80;
    Object.assign(sc, { left: -span, right: span, top: span, bottom: -span, far: 1200 });
    sc.updateProjectionMatrix();
    placeCamera({ position: { x: mid.x, y: reach * 1.3 + 120, z: mid.z }, target: { x: mid.x, y: 0, z: mid.z }, fov: 85, up: { x: 0, y: 0, z: -1 } });
    sun.target.position.set(mid.x, 0, mid.z);
    sun.position.copy(SKY.sunDir.value).multiplyScalar(400).add(sun.target.position);
    sun.target.updateMatrixWorld();
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      /* compiling ahead is an optimisation */
    }
    for (let i = 0; i < 2; i++) post.render();
    Object.assign(sc, keep);
    sc.updateProjectionMatrix();
    // Then a couple of real frames from where play starts
    placeCamera(view);
    for (let i = 0; i < 2; i++) post.render();
    fx.clear();
    // Pooled enemies, pickups and the helicopter go back out of the way
    for (const list of pool.values()) for (const p of list) hidePooled(p);
    for (const m of [...grenadeMeshes, ...pickupMeshes]) m.visible = false;
    if (heli) {
      heli.root.visible = false;
      heli.root.position.set(-500, -50, 0);
    }
  }

  function hidePooled(p) {
    p.outer.visible = false;
    for (const g of Object.values(p.guns)) g.group.visible = false;
  }

  function applyTheme() {
    post.setLook(theme);
  }

  // ------------------------------------------------------------ events from the game

  function onEvent(type, data) {
    if (type === 'explosion') {
      fx.explosion(data, 1);
      lastBlast = { x: data.x, y: data.y ?? 0.5, z: data.z, t: performance.now() };
    }
    if (type === 'kill') {
      const e = data.enemy;
      if (Math.random() < 0.8) fx.bloodPool(e);
      if (ENEMY_TYPES[e.type].boss) {
        fx.explosion(chest(e), 1.6);
        fx.burn({ x: e.x, y: 0.2, z: e.z }, 1.2);
      }
    }
    if (type === 'targetDestroyed' && world) {
      let best = null;
      let bestD = Infinity;
      for (const t of world.targets) {
        const d = Math.hypot(t.x - data.x, t.z - data.z);
        if (d < bestD) {
          best = t;
          bestD = d;
        }
      }
      if (best) {
        best.intact.visible = false;
        best.wreck.visible = true;
        best.spin.stopped = true;
        fx.explosion({ x: best.x, y: 1.5, z: best.z }, 2);
        fx.burn({ x: best.x, y: 0.8, z: best.z }, 1.4);
      }
    }
  }

  /** Where a person's muzzle is right now. */
  function muzzleOf(p, a, out) {
    const gun = p.guns[a.weapon] || p.guns.main;
    if (!gun) return null;
    gun.group.updateMatrixWorld(true);
    return out.copy(gun.muzzle).applyMatrix4(gun.group.matrixWorld);
  }

  /** New tracers this frame: muzzle flashes, casings, impacts, and bullets snapping past. */
  function processShots() {
    const h = game.hatch;
    const head = eye(h);
    for (const tr of game.tracers) {
      if (tr._seen) continue;
      tr._seen = true;
      const shooter = tr.shooter;
      const p = shooter ? people.get(shooter) : null;
      let from = tr.from;
      if (p && !shooter.dead) {
        const m = muzzleOf(p, shooter, tmp);
        if (m) from = { x: m.x, y: m.y, z: m.z };
      }
      const dx = tr.to.x - from.x;
      const dy = tr.to.y - from.y;
      const dz = tr.to.z - from.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = { x: dx / len, y: dy / len, z: dz / len };
      if (!tr.pellet) {
        const big = tr.heavy || ['heavy', 'warlord', 'warden', 'enforcer', 'shotgunner'].includes(shooter?.type);
        fx.muzzle(from, dir, { big, light: true });
        if (shooter && (shooter === game.hatch || shooter === game.cruz)) fx.casing(from, dir);
        for (const other of game.tracers) if (other !== tr && !other._seen && other.shooter === shooter) other.pellet = true;
      }
      // Like real belts and magazines, only some rounds are tracers (none for sidearms)
      const every = tr.heavy ? 1 : shooter === game.hatch || shooter === game.cruz ? (shooter.weapon === 'pistol' ? 0 : 3) : 2;
      if (shooter) shooter._tracerN = ((shooter._tracerN ?? -1) + 1) % Math.max(1, every);
      if (every && (!shooter || shooter._tracerN === 0)) fx.tracer(from, tr.to, { hostile: tr.hostile, heavy: tr.heavy });
      if (tr.impact === 'box' && tr.box) fx.impact(tr.to, boxNormal(tr.box, tr.to), 'box', game.level.theme);
      else if (tr.impact === 'ground') fx.impact(tr.to, { x: 0, y: 1, z: 0 }, 'ground', game.level.theme);
      else if (tr.impact === 'flesh') fx.impact(tr.to, null, 'flesh', game.level.theme);
      const nearImpact = Math.hypot(tr.to.x - head.x, tr.to.z - head.z) < 14;
      if (nearImpact && tr.impact !== 'air') hooks.impact?.(tr.to, tr.impact);
      if (tr.hostile && !h.downed) {
        const t = Math.max(0, Math.min(1, ((head.x - from.x) * dx + (head.y - from.y) * dy + (head.z - from.z) * dz) / (len * len)));
        const px = from.x + dx * t - head.x;
        const py = from.y + dy * t - head.y;
        const pz = from.z + dz * t - head.z;
        if (t > 0.05 && t < 0.98 && Math.hypot(px, py, pz) < 1.6) hooks.whiz?.(Math.sin(Math.atan2(pz, px) - h.aimYaw));
      }
      if (tr.impact === 'flesh' && tr.shooter) tr.hitAt = tr.to;
      game._lastFlesh = tr.impact === 'flesh' ? tr : game._lastFlesh;
    }
  }

  // ------------------------------------------------------------ characters

  function pose(p, a, alpha, dt, t, ctx) {
    const b = blend(a, alpha);
    p.outer.position.set(b.x, b.y, b.z);
    p.outer.rotation.y = -b.yaw;
    p.outer.updateMatrixWorld(true);
    p.state.flash = a.flash > 0 && !a.dead && a !== game.hatch ? (a.flash / 4) * (a === game.cruz ? 0.35 : 0.8) : 0;
    const stepped = p.animator.update(a, dt, { time: t, ...ctx });
    rememberJoints(p.rig);
    return { b, stepped };
  }

  /** A dead body: hand it to the ragdoll, shoved by whatever killed it, and drop the gun. */
  function kill(p, a) {
    const imp = { x: 0, y: 1, z: 0 };
    let at = null;
    const src = a.hitBy;
    if (lastBlast && performance.now() - lastBlast.t < 200 && Math.hypot(lastBlast.x - a.x, lastBlast.z - a.z) < 8) {
      const d = Math.hypot(a.x - lastBlast.x, a.z - lastBlast.z) || 1;
      Object.assign(imp, { x: ((a.x - lastBlast.x) / d) * 7, y: 6, z: ((a.z - lastBlast.z) / d) * 7 });
      at = new THREE.Vector3(a.x, 0.6, a.z);
    } else if (src) {
      const d = Math.hypot(a.x - src.x, a.z - src.z) || 1;
      const k = a.type === 'heavy' || ENEMY_TYPES[a.type]?.boss ? 1.5 : 3.2;
      Object.assign(imp, { x: ((a.x - src.x) / d) * k, y: 0.6, z: ((a.z - src.z) / d) * k });
      const f = game._lastFlesh;
      at = f ? new THREE.Vector3(f.to.x, f.to.y, f.to.z) : new THREE.Vector3(a.x, a.y + 1.4, a.z);
    }
    p.ragdoll = new Ragdoll(p.rig, game.level, { impulse: imp, at, scale: p.spec.scale || 1 });
    for (const g of Object.values(p.guns)) {
      if (!g.group.visible) continue;
      drops.push({ group: g.group, v: new THREE.Vector3(imp.x * 0.4 + (Math.random() - 0.5), 1.5 + Math.random(), imp.z * 0.4 + (Math.random() - 0.5)), w: new THREE.Vector3(Math.random() * 6, Math.random() * 3, Math.random() * 6), rest: false });
    }
  }

  function updateDrops(dt) {
    for (const d of drops) {
      if (d.rest) continue;
      d.v.y -= 9.8 * dt;
      d.group.position.addScaledVector(d.v, dt);
      d.group.rotation.x += d.w.x * dt;
      d.group.rotation.y += d.w.y * dt;
      d.group.rotation.z += d.w.z * dt;
      if (d.group.position.y < 0.05) {
        d.group.position.y = 0.05;
        // Lie flat on its side, pointing whichever way it was spinning
        const yaw = d.group.rotation.y;
        d.group.rotation.order = 'YXZ';
        d.group.rotation.set(Math.PI / 2, yaw, 0);
        d.rest = true;
      }
    }
    while (drops.length > 24) dynamic.remove(drops.shift().group);
  }

  function updateCharacters(alpha, dt, t) {
    const theme3 = game.level.theme;
    for (const c of game.contractors) {
      const p = personFor(c);
      const { b, stepped } = pose(p, c, alpha, dt, t, { pitch: c.aimPitch || 0 });
      // Hidden when the camera is inside them
      const near = Math.hypot(b.x - camera.position.x, b.y + 1 - camera.position.y, b.z - camera.position.z) < 0.9;
      p.outer.visible = !c.gone && !near;
      for (const g of Object.values(p.guns)) if (near || c.gone) g.group.visible = false;
      if (stepped && c.onGround !== false) {
        hooks.footstep?.(b, c === game.hatch ? 1 : 0.7);
        if (theme3 !== 'port' && c.anim === 'sprint') fx.dust(b, theme3, 0.6, 0.15);
      }
      if (theme3 === 'snow') breathe(c, p, t);
    }
    const seen = new Set();
    for (const e of game.enemies) {
      seen.add(e);
      const p = personFor(e);
      if (e.dead) {
        if (!p.ragdoll) kill(p, e);
        p.ragdoll.step(dt);
        p.ragdoll.apply();
        continue;
      }
      const target = e.target;
      const pitch = target ? Math.atan2(target.y + 1.1 - (e.y + 1.45 * (e.size || 1)), Math.hypot(target.x - e.x, target.z - e.z)) : 0;
      const { b, stepped } = pose(p, e, alpha, dt, t, { pitch });
      if (stepped && Math.hypot(b.x - game.hatch.x, b.z - game.hatch.z) < 25) hooks.footstep?.(b, ENEMY_TYPES[e.type].armored ? 1.2 : 0.6);
      if (theme3 === 'snow') breathe(e, p, t);
    }
    // Enemies the game has let go of stay as corpses for a while
    for (const [e, p] of people) {
      if (seen.has(e) || e === game.hatch || e === game.cruz) continue;
      people.delete(e);
      corpses.push({ p });
      if (corpses.length > 16) removePerson(corpses.shift().p);
    }
    for (const c of corpses) {
      if (c.p.ragdoll && !c.p.ragdoll.asleep) {
        c.p.ragdoll.step(dt);
        c.p.ragdoll.apply();
      }
    }
    if (hostage) {
      const o = hostage.target;
      const freed = o.done;
      const a = hostage.actor;
      a.anim = 'idle';
      if (freed) a.yaw = Math.atan2(game.hatch.z - o.z, game.hatch.x - o.x);
      hostage.outer.position.set(o.x, 0, o.z);
      hostage.outer.rotation.y = -a.yaw;
      hostage.outer.updateMatrixWorld(true);
      hostage.animator.update(a, dt, { bound: !freed, freed, unarmed: true, time: t });
    }
  }

  function breathe(a, p, t) {
    const next = breathT.get(a) ?? t + Math.random() * 2;
    if (t < next) return;
    breathT.set(a, t + 2 + Math.random() * 1.2);
    if (!p.rig.head) return;
    p.rig.head.getWorldPosition(v3);
    const yaw = a.yaw ?? 0;
    fx.breath({ x: v3.x + Math.cos(yaw) * 0.12, y: v3.y + 0.05, z: v3.z + Math.sin(yaw) * 0.12 }, { x: Math.cos(yaw), z: Math.sin(yaw) });
  }

  // ------------------------------------------------------------ the helicopter

  function updateHeli(dt, t) {
    if (!heli) return;
    const ex = heli.extract;
    const cleared = !!game.areas[heli.area]?.cleared;
    const s = heliState;
    if (s.phase === 'away' && cleared) {
      s.phase = 'arriving';
      s.t = 0;
    }
    if (game.mode === 'complete') s.leave = true;
    s.t += dt;
    if (s.phase === 'hover') {
      s.hoverT += dt;
      if (s.leave && s.hoverT > 1.5) {
        s.phase = 'leaving';
        s.t = 0;
      }
    }
    heli.root.visible = s.phase !== 'away';
    if (!heli.root.visible) {
      hooks.heli?.(null);
      return;
    }
    let x, y, z, yaw, tilt;
    if (s.phase === 'arriving') {
      const k = Math.min(1, s.t / 7);
      const e = 1 - (1 - k) ** 3;
      x = ex.x + 140 * (1 - e);
      z = ex.z + 70 * (1 - e) + 3;
      y = 3 + 45 * (1 - e) ** 2;
      yaw = Math.atan2(-70, -140);
      tilt = 0.25 * (1 - k);
      if (k >= 1) {
        s.phase = 'hover';
        s.hoverT = 0;
      }
    } else if (s.phase === 'hover') {
      x = ex.x + Math.sin(t * 0.7) * 0.3;
      z = ex.z + 3 + Math.cos(t * 0.5) * 0.3;
      y = 3 + Math.sin(t * 1.1) * 0.25;
      yaw = Math.atan2(-70, -140);
      tilt = 0;
    } else {
      const k = Math.min(1, s.t / 8);
      x = ex.x - 80 * k * k;
      z = ex.z + 3;
      y = 3 + 40 * k * k + 2 * Math.min(1, s.t);
      yaw = Math.PI;
      tilt = -0.2 * Math.min(1, s.t / 2);
    }
    heli.root.position.set(x, y, z);
    heli.root.rotation.set(0, -yaw, tilt);
    heli.rotor.rotation.y = t * 28;
    heli.tail.rotation.z = t * 40;
    heli.blink.visible = Math.sin(t * 6) > 0.3;
    if (y < 14) fx.dust({ x: x + (Math.random() - 0.5) * 10, y: 0, z: z + (Math.random() - 0.5) * 10 }, game.level.theme, 3 * (1 - y / 14), 3);
    hooks.heli?.({ x, y, z });
  }

  // ------------------------------------------------------------ the rest of the world

  function updateEffects(alpha, t, dt) {
    const lp = laserGeo.attributes.position;
    let nl = 0;
    for (const e of game.enemies) {
      if (e.dead || !ENEMY_TYPES[e.type].sniper || !e.aimT || !e.target || nl >= 24) continue;
      const p = people.get(e);
      const a = p ? muzzleOf(p, e, tmp) || eye(e) : eye(e);
      const b = chest(e.target);
      lp.setXYZ(nl * 2, a.x, a.y, a.z);
      lp.setXYZ(nl * 2 + 1, b.x, b.y + 0.2, b.z);
      nl++;
    }
    laserGeo.setDrawRange(0, nl * 2);
    lp.needsUpdate = true;
    laserK.value = 0.5 + Math.sin(t * 20) * 0.2;

    // Grenades in flight, and ammo dropped by the fallen
    while (grenadeMeshes.length < game.grenades.length) newGrenade();
    grenadeMeshes.forEach((g, i) => {
      const gr = game.grenades[i];
      g.visible = !!gr;
      if (!gr) return;
      const b = blend(gr, alpha);
      g.position.set(b.x, b.y, b.z);
      g.rotation.x += dt * 8;
      g.userData.led.visible = Math.sin((gr.fuse / 60) ** 1.5 * 40) > 0;
    });
    while (pickupMeshes.length < game.pickups.length) newPickup();
    pickupMeshes.forEach((m, i) => {
      const k = game.pickups[i];
      m.visible = !!k;
      if (k) {
        m.position.set(k.x, k.y + 0.2 + Math.sin(t * 3 + i) * 0.05, k.z);
        m.rotation.y = t * 1.5 + i;
      }
    });
    for (const r of objectiveRings) {
      const o = r.userData.objective;
      r.visible = !o.done;
      r.scale.setScalar(1 + Math.sin(t * 4) * 0.08 + (o.progress || 0) / 300);
    }
    // Gates sink into the ground once their area is clear
    for (const a of game.level.areas) {
      if (!a.gate) continue;
      const mesh = world.gates.get(a.gate.id);
      if (!mesh) continue;
      if (a.gate.removed) {
        mesh.userData.open = (mesh.userData.open ?? 0) + dt / 2.2;
        const k = Math.min(1, mesh.userData.open);
        if (k < 1 && Math.random() < 0.6) fx.dust({ x: (a.gate.x0 + a.gate.x1) / 2 + (Math.random() - 0.5) * (a.gate.x1 - a.gate.x0), y: 0, z: (a.gate.z0 + a.gate.z1) / 2 + (Math.random() - 0.5) * (a.gate.z1 - a.gate.z0) }, game.level.theme, 1.2, 0.5);
        mesh.position.y = -(a.gate.y1 + 0.1) * k * k;
        mesh.visible = k < 1;
      } else {
        mesh.position.y = 0;
        mesh.visible = true;
        mesh.userData.open = 0;
      }
    }
  }

  /** Real lights for the lamps nearest the camera, so the night is lit where you are. */
  function updateLamps() {
    if (!lampLights.length) return;
    const c = camera.position;
    const near = world.lamps.filter((l) => !l.cheap && !l.far).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    lampLights.forEach((l, i) => {
      const lamp = near[i];
      if (!lamp) {
        l.intensity = 0;
        return;
      }
      l.position.set(lamp.x, lamp.y, lamp.z);
      l.color.setHex(lamp.color);
      // Firelight flickers
      const t = performance.now() / 1000;
      l.intensity = lamp.flicker ? lamp.k * (0.72 + 0.18 * Math.sin(t * 11 + lamp.x) + 0.1 * Math.sin(t * 23.7 + lamp.z)) : lamp.k;
      l.distance = lamp.d;
    });
  }

  /** Where the sun is on screen, and how much of it is in view (for glare and light shafts). */
  function updateGlare() {
    const u = post.uniforms;
    const d = SKY.discDir.value;
    v3.copy(d).multiplyScalar(400).add(camera.position).project(camera);
    // Shafts stream past whatever is in front of the sun, so they only need it near the screen
    const on = v3.z < 1 ? Math.max(0, 1 - Math.max(Math.abs(v3.x), Math.abs(v3.y) * 0.8 - 0.1) / 1.5) : 0;
    u.sunOn.value += (on - u.sunOn.value) * 0.15;
    if (!theme.glare) {
      u.sunVis.value = 0;
      u.sunPos.value.set((v3.x + 1) / 2, (1 - v3.y) / 2);
      return;
    }
    let vis = 0;
    if (v3.z < 1 && Math.abs(v3.x) < 1.3 && Math.abs(v3.y) < 1.3) {
      const o = camera.position;
      vis = 1;
      for (const b of boxesOnRay(game.level, o, d, 160)) {
        if (rayBox(o, d, b) < 200) {
          vis = 0;
          break;
        }
      }
      vis *= Math.max(0, 1 - Math.hypot(v3.x, v3.y) / 1.6);
    }
    sunVis += (vis - sunVis) * 0.15;
    u.sunPos.value.set((v3.x + 1) / 2, (1 - v3.y) / 2);
    u.sunVis.value = sunVis * theme.glare;
  }

  function placeCamera(view) {
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
    camera.position.set(view.position.x, view.position.y, view.position.z);
    if (view.up) camera.up.set(view.up.x, view.up.y, view.up.z);
    else camera.up.set(Math.sin(view.roll || 0), Math.cos(view.roll || 0), 0);
    camera.lookAt(view.target.x, view.target.y, view.target.z);
    camera.updateMatrixWorld();
    // Shadows cover the ground in front of the camera, snapped to texels so edges don't crawl
    const d = SKY.sunDir.value;
    const fwdX = view.target.x - view.position.x;
    const fwdZ = view.target.z - view.position.z;
    const fl = Math.hypot(fwdX, fwdZ) || 1;
    const span = sun.shadow.camera.right * 2;
    const texel = span / sun.shadow.mapSize.x;
    const reach = span * 0.38;
    const sx = Math.round((camera.position.x + (fwdX / fl) * reach) / texel) * texel;
    const sz = Math.round((camera.position.z + (fwdZ / fl) * reach) / texel) * texel;
    sun.target.position.set(sx, 0, sz);
    sun.position.set(sx + d.x * 160, d.y * 160, sz + d.z * 160);
    sun.target.updateMatrixWorld();
  }

  setQuality(quality);

  return {
    camera,
    scene,
    renderer,
    fx,
    post,
    get gpu() {
      return gpuLabel();
    },
    get world() {
      return world;
    },
    /** The people being drawn, by actor (for development tools). */
    get people() {
      return people;
    },
    get extracted() {
      return !heli || (heliState.phase === 'leaving' && heliState.t > 4);
    },
    get heliPosition() {
      return heli?.root.visible ? heli.root.position : null;
    },
    /** Starts loading a theme in the background. */
    prepare: (t) => load(t),
    setGame,
    warm,
    setQuality,
    applyTheme,
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      post.setSize(w, h);
    },
    /** view: { position, target, fov, roll }; alpha: how far between steps; t: seconds. */
    render(g, view, t, alpha = 1) {
      if (g !== game || !world) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - (lastFrame ?? now)) / 1000) || 1 / 60;
      lastFrame = now;
      if (game.hatch !== resetMarker) {
        resetMarker = game.hatch;
        fx.clear();
        clearPeople();
      }
      const prof = PROFILE.on ? [performance.now()] : null;
      const mark = () => prof?.push(performance.now());
      placeCamera(view);
      SKY.time.value = t;
      updateCharacters(alpha, dt, t);
      mark();
      processShots();
      updateEffects(alpha, t, dt);
      updateDrops(dt);
      updateHeli(dt, t);
      updateLamps();
      world.update(t, game);
      mark();
      fx.update(dt, camera, game.level.theme);
      updateGlare();
      mark();
      post.uniforms.time.value = t;
      post.render();
      mark();
      if (prof) {
        const S = PROFILE.sum;
        S.frames++;
        S.people += prof[1] - prof[0];
        S.world += prof[2] - prof[1];
        S.fx += prof[3] - prof[2];
        S.draw += prof[4] - prof[3];
      }
      if (prof && prof[prof.length - 1] - prof[0] > 30) PROFILE.slow.push({ t: +t.toFixed(2), people: Math.round(prof[1] - prof[0]), world: Math.round(prof[2] - prof[1]), fx: Math.round(prof[3] - prof[2]), draw: Math.round(prof[4] - prof[3]), n: people.size });
    },
    project(x, y, z, w, h) {
      v3.set(x, y, z).project(camera);
      if (v3.z > 1) return null;
      return { x: ((v3.x + 1) / 2) * w, y: ((1 - v3.y) / 2) * h };
    },
    toCamera(x, y, z) {
      return v3.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).clone();
    },
  };
}

