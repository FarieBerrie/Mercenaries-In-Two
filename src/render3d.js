// The 3D view: a lit, shadowed scene per mission theme, the characters, tracers and effects.
// The game steps at 60 Hz; positions are blended between steps (rememberPositions/blend) so
// motion stays smooth at any refresh rate.
import * as THREE from 'three';
import { eye } from './actors.js';
import { angleDiff } from './math.js';
import { buildContractor, buildEnemy, poseActor, showGun, smoothPose } from './models.js';
import { blobTexture, useAnisotropy } from './textures.js';
import { buildWorld } from './world3d.js';

const THEMES = {
  desert: { zenith: '#2e6cc0', horizon: '#f2dcb4', fog: '#e8d6b4', fogNear: 70, fogFar: 260, sun: '#fff2dc', sunK: 2.4, sunDir: [-0.4, 1, 0.35], hemiSky: '#c4d8f0', hemiGround: '#a88a64', hemiK: 1.1 },
  port: { zenith: '#04081a', horizon: '#1a2a46', fog: '#121a2c', fogNear: 30, fogFar: 150, sun: '#a8bce8', sunK: 1.1, sunDir: [0.3, 1, -0.4], hemiSky: '#4a5a7a', hemiGround: '#1e1e22', hemiK: 1.0, lamps: true },
  snow: { zenith: '#7a9cc0', horizon: '#eef2f6', fog: '#e2e8ee', fogNear: 40, fogFar: 180, sun: '#ffffff', sunK: 1.6, sunDir: [0.2, 1, 0.5], hemiSky: '#e4eef8', hemiGround: '#b8c4d2', hemiK: 1.3, snow: true },
};

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
  for (const p of game.particles) keep(p);
}

function blend(o, alpha) {
  if (o._px === undefined) return { x: o.x, y: o.y, z: o.z, yaw: o.yaw ?? 0 };
  return {
    x: o._px + (o.x - o._px) * alpha,
    y: o._py + (o.y - o._py) * alpha,
    z: o._pz + (o.z - o._pz) * alpha,
    yaw: o.yaw === undefined ? 0 : o._pyaw + angleDiff(o._pyaw, o.yaw) * alpha,
  };
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500);
  scene.fog = new THREE.Fog(0x000000, 50, 200);
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
  sun.shadow.bias = -0.0008;
  scene.add(hemi, sun, sun.target);

  // Sky dome
  const skyGeo = new THREE.SphereGeometry(400, 24, 12);
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);

  const blob = blobTexture();
  const dynamic = new THREE.Group();
  scene.add(dynamic);

  // Tracers: one batch of line segments
  const MAX_TRACERS = 200;
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
  tracerGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_TRACERS * 6), 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, fog: false }));
  tracers.frustumCulled = false;
  dynamic.add(tracers);

  // Sniper laser sights
  const laserGeo = new THREE.BufferGeometry();
  laserGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(20 * 6), 3));
  const lasers = new THREE.LineSegments(laserGeo, new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.7 }));
  lasers.frustumCulled = false;
  dynamic.add(lasers);

  // Particles
  const MAX_PARTICLES = 800;
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  partGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  const particles = new THREE.Points(partGeo, new THREE.PointsMaterial({ size: 0.28, map: blob, vertexColors: true, transparent: true, depthWrite: false }));
  particles.frustumCulled = false;
  dynamic.add(particles);

  // Falling snow around the camera
  const SNOW = 900;
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SNOW * 3), 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.12, map: blob, color: 0xffffff, transparent: true, depthWrite: false }));
  snow.frustumCulled = false;
  scene.add(snow);
  const flakes = Array.from({ length: SNOW }, () => [Math.random() * 60 - 30, Math.random() * 25, Math.random() * 60 - 30]);

  // Shadow blobs under characters, so they read even where real shadows are faint
  const blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blob, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }), 64);
  blobs.frustumCulled = false;
  dynamic.add(blobs);

  // Markers: tall beams over objectives and extraction
  const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 40, 12, 1, true).translate(0, 20, 0);
  const beams = [];
  const beam = (color) => {
    const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    dynamic.add(m);
    beams.push(m);
    return m;
  };

  const grenadeMeshes = [];
  const pickupMeshes = [];
  const lampLights = [];

  let world = null;
  let worldKey = null;
  let hatchModel = null;
  let cruzModel = null;
  let hostage = null;
  const enemyModels = new Map();
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  let lastFrame = null;
  let theme = THEMES.desert;

  function setGame(game, looks) {
    const key = `${game.level.missionIndex}|${game.level.boxes.length}|${JSON.stringify(looks)}`;
    if (worldKey && worldKey.startsWith(`${game.level.missionIndex}|`) && world?.game === game) return;
    if (world) scene.remove(world.group);
    useAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    world = buildWorld(game.level);
    world.game = game;
    worldKey = key;
    scene.add(world.group);
    theme = THEMES[game.level.theme];
    applyTheme();
    for (const m of [hatchModel, cruzModel]) if (m) dynamic.remove(m.root);
    hatchModel = buildContractor({ suit: '#4a4e3e', vest: '#2e3226', cap: '#2a2a2e', mask: looks.hatch });
    cruzModel = buildContractor({ suit: '#3e4450', vest: '#262a32', cap: '#5a3a2a', mask: looks.cruz, pack: '#3a3a30' });
    dynamic.add(hatchModel.root, cruzModel.root);
    for (const m of enemyModels.values()) dynamic.remove(m.root);
    enemyModels.clear();
    for (const b of beams) dynamic.remove(b);
    beams.length = 0;
    for (const l of lampLights) scene.remove(l);
    lampLights.length = 0;
    if (theme.lamps) {
      // Floodlights over the night port
      for (let x = 20; x < game.level.length; x += 40) {
        const l = new THREE.PointLight(0xffd8a0, 30, 32, 1.6);
        l.position.set(x, 9, (x / 40) % 2 ? 14 : -14);
        scene.add(l);
        lampLights.push(l);
      }
    }
    if (hostage) dynamic.remove(hostage.root);
    hostage = null;
    const rescue = game.level.areas.flatMap((a) => a.objectives).find((o) => o.kind === 'rescue');
    if (rescue) {
      hostage = buildContractor({ suit: '#8a7a68', vest: '#8a7a68', cap: '#3a2a20', mask: { pattern: 'plain', base: '#b08868', accent: '#b08868' } });
      hostage.root.position.set(rescue.x, 0, rescue.z);
      hostage.rifle.visible = hostage.pistol.visible = hostage.sniper.visible = hostage.muzzle.visible = false;
      hostage.target = rescue;
      dynamic.add(hostage.root);
    }
  }

  function applyTheme() {
    scene.fog.color.set(theme.fog);
    scene.fog.near = theme.fogNear;
    scene.fog.far = theme.fogFar;
    renderer.setClearColor(theme.fog);
    hemi.color.set(theme.hemiSky);
    hemi.groundColor.set(theme.hemiGround);
    hemi.intensity = theme.hemiK;
    sun.color.set(theme.sun);
    sun.intensity = theme.sunK;
    const zenith = new THREE.Color(theme.zenith);
    const horizon = new THREE.Color(theme.horizon);
    const pos = skyGeo.attributes.position;
    const col = skyGeo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = Math.max(0, pos.getY(i) / 400);
      tmpColor.copy(horizon).lerp(zenith, Math.pow(y, 0.55));
      col.setXYZ(i, tmpColor.r, tmpColor.g, tmpColor.b);
    }
    col.needsUpdate = true;
    snow.visible = !!theme.snow;
  }

  function placeModel(m, a, alpha, pitch, ease, t) {
    const p = blend(a, alpha);
    m.root.position.set(p.x, p.y, p.z);
    m.root.rotation.y = -p.yaw;
    poseActor(m, a, t, pitch);
    smoothPose(m, ease);
    for (const mat of m.materials) mat.emissive.setScalar(a.flash > 0 ? 0.5 : 0);
    return p;
  }

  function updateCharacters(game, alpha, ease, t) {
    let nBlobs = 0;
    const blobAt = (p, size) => {
      dummy.position.set(p.x, p.y + 0.02, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(size, 1, size);
      dummy.updateMatrix();
      blobs.setMatrixAt(nBlobs++, dummy.matrix);
    };
    for (const [c, m] of [[game.hatch, hatchModel], [game.cruz, cruzModel]]) {
      m.root.visible = !c.gone;
      const p = placeModel(m, c, alpha, c.aimPitch || 0, ease, t);
      showGun(m, c, c.sinceShot < 3);
      blobAt(p, 1.1);
    }
    const seen = new Set();
    for (const e of game.enemies) {
      seen.add(e);
      let m = enemyModels.get(e);
      if (!m) {
        m = buildEnemy(e.type, game.level.theme);
        enemyModels.set(e, m);
        dynamic.add(m.root);
      }
      if (e.dead) {
        // Topple over, then sink away
        const k = Math.min(1, e.deadT / 25);
        m.root.rotation.z = -k * Math.PI / 2;
        m.root.position.y = e.y - Math.max(0, (e.deadT - 60) / 30);
        continue;
      }
      const target = e.target;
      const pitch = target ? Math.atan2(target.y + 1 - (e.y + 1.4), Math.hypot(target.x - e.x, target.z - e.z)) : 0;
      const p = placeModel(m, e, alpha, pitch, ease, t);
      m.muzzle.visible = e.muzzle > 0;
      blobAt(p, e.r * 3);
    }
    for (const [e, m] of enemyModels) {
      if (!seen.has(e)) {
        dynamic.remove(m.root);
        enemyModels.delete(e);
      }
    }
    if (hostage) {
      hostage.root.visible = !hostage.target.done;
      hostage.anim = 'downed';
      poseActor(hostage, { vx: 0, vz: 0, anim: 'use', animT: 0, crouch: true }, t, 0);
      hostage.armL.rotation.z = hostage.armR.rotation.z = -0.4; // hands tied behind
    }
    blobs.count = nBlobs;
    blobs.instanceMatrix.needsUpdate = true;
  }

  function updateEffects(game, alpha, t, camPos) {
    // Tracers
    const tp = tracerGeo.attributes.position;
    const tc = tracerGeo.attributes.color;
    let n = 0;
    for (const tr of game.tracers) {
      if (n >= MAX_TRACERS) break;
      // Draw the back part of each bullet's path, fading as it ages
      const k = tr.life / 6;
      const from = { x: tr.to.x + (tr.from.x - tr.to.x) * k, y: tr.to.y + (tr.from.y - tr.to.y) * k, z: tr.to.z + (tr.from.z - tr.to.z) * k };
      tp.setXYZ(n * 2, from.x, from.y, from.z);
      tp.setXYZ(n * 2 + 1, tr.to.x, tr.to.y, tr.to.z);
      tmpColor.set(tr.hostile ? '#ff9a50' : '#fff0b0');
      tc.setXYZ(n * 2, tmpColor.r * 0.4, tmpColor.g * 0.4, tmpColor.b * 0.4);
      tc.setXYZ(n * 2 + 1, tmpColor.r, tmpColor.g, tmpColor.b);
      n++;
    }
    tracerGeo.setDrawRange(0, n * 2);
    tp.needsUpdate = tc.needsUpdate = true;

    // Snipers aiming paint a red line
    const lp = laserGeo.attributes.position;
    let nl = 0;
    for (const e of game.enemies) {
      if (e.dead || e.type !== 'sniper' || !e.aimT || !e.target || nl >= 20) continue;
      const a = eye(e);
      const b = eye(e.target);
      lp.setXYZ(nl * 2, a.x, a.y, a.z);
      lp.setXYZ(nl * 2 + 1, b.x, b.y - 0.3, b.z);
      nl++;
    }
    laserGeo.setDrawRange(0, nl * 2);
    lp.needsUpdate = true;

    // Particles
    const pp = partGeo.attributes.position;
    const pc = partGeo.attributes.color;
    let np = 0;
    for (const pt of game.particles) {
      if (np >= MAX_PARTICLES) break;
      const b = blend(pt, alpha);
      pp.setXYZ(np, b.x, b.y, b.z);
      tmpColor.set(pt.color).multiplyScalar(Math.min(1, pt.life / 15));
      pc.setXYZ(np, tmpColor.r, tmpColor.g, tmpColor.b);
      np++;
    }
    partGeo.setDrawRange(0, np);
    pp.needsUpdate = pc.needsUpdate = true;

    // Grenades and ammo
    while (grenadeMeshes.length < game.grenades.length) {
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a4a2a }));
      dynamic.add(g);
      grenadeMeshes.push(g);
    }
    grenadeMeshes.forEach((g, i) => {
      const gr = game.grenades[i];
      g.visible = !!gr;
      if (gr) {
        const b = blend(gr, alpha);
        g.position.set(b.x, b.y, b.z);
      }
    });
    while (pickupMeshes.length < game.pickups.length) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), new THREE.MeshLambertMaterial({ color: 0x4a5a2a, emissive: 0x202810 }));
      dynamic.add(m);
      pickupMeshes.push(m);
    }
    pickupMeshes.forEach((m, i) => {
      const k = game.pickups[i];
      m.visible = !!k;
      if (k) {
        m.position.set(k.x, k.y + 0.25 + Math.sin(t / 20 + i) * 0.06, k.z);
        m.rotation.y = t * 0.03;
      }
    });

    // Objective beams
    const marks = [];
    const area = game.level.areas[Math.min(game.checkpoint, game.level.areas.length - 1)];
    for (const o of area.objectives) if (!o.done) marks.push([o, '#ffc030']);
    const last = game.level.areas[game.level.areas.length - 1];
    if (last.extract && game.areas[game.level.areas.length - 1].cleared) marks.push([last.extract, '#40ff80']);
    while (beams.length < marks.length) beam('#ffffff');
    beams.forEach((b, i) => {
      b.visible = i < marks.length;
      if (b.visible) {
        b.position.set(marks[i][0].x, 0, marks[i][0].z);
        b.material.color.set(marks[i][1]);
        b.material.opacity = 0.18 + Math.sin(t / 15) * 0.06;
      }
    });

    // Snow
    if (snow.visible) {
      const sp = snowGeo.attributes.position;
      for (let i = 0; i < SNOW; i++) {
        const f = flakes[i];
        f[1] -= 0.04;
        if (f[1] < -2) f[1] += 25;
        sp.setXYZ(i, camPos.x + f[0] + Math.sin(t / 50 + i) * 0.3, camPos.y - 6 + f[1], camPos.z + f[2]);
      }
      sp.needsUpdate = true;
    }
  }

  return {
    camera,
    setGame,
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    /** view: { position, target, fov }; alpha: how far between the last step and the next. */
    render(game, view, t, alpha = 1, looks) {
      setGame(game, looks);
      const now = performance.now();
      const dt = Math.min(0.1, (now - (lastFrame ?? now)) / 1000) || 1 / 60;
      lastFrame = now;
      const ease = 1 - Math.exp(-20 * dt);
      camera.fov += (view.fov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
      camera.position.set(view.position.x, view.position.y, view.position.z);
      camera.lookAt(view.target.x, view.target.y, view.target.z);
      if (game.shakeT > 0) {
        const s = Math.min(0.15, game.shakeT * 0.01);
        camera.position.x += (Math.random() - 0.5) * s;
        camera.position.y += (Math.random() - 0.5) * s;
      }
      // Shadows follow the player
      const h = game.hatch;
      const d = new THREE.Vector3(...theme.sunDir).normalize();
      sun.target.position.set(h.x + 10, 0, h.z);
      sun.position.set(h.x + 10 + d.x * 80, d.y * 80, h.z + d.z * 80);
      sky.position.copy(camera.position);
      for (const a of game.level.areas) if (a.gate) world.gates.get(a.gate.id) && (world.gates.get(a.gate.id).visible = !a.gate.removed);
      updateCharacters(game, alpha, ease, t);
      updateEffects(game, alpha, t, camera.position);
      renderer.render(scene, camera);
    },
    /** World point → screen pixels (of the canvas), or null when behind the camera. */
    project(x, y, z, w, h) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      if (v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z < -1 };
    },
  };
}
