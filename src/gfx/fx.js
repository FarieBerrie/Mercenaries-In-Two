// Effects, simulated and drawn on the GPU. Smoke, fire, sparks, dust, blood, debris and spent
// casings live in one pool of particles held in GPU buffers: the CPU only queues spawns, a
// compute pass copies them into a ring buffer, and a second compute pass moves every particle
// (gravity, buoyancy, drag, bouncing off the ground) each frame. They're drawn as instanced
// sprites with procedural shapes, additive for fire and sparks, blended for the rest. Weather
// (rain, snow, drifting dust) is computed entirely in the vertex shader round the camera. Tracers
// are ribbons, muzzle flashes light the scene for a frame, and bullet holes, scorch marks and
// blood stay on surfaces as decals.
import * as THREE from 'three/webgpu';
import {
  abs, atan, attributeArray, cameraPosition, clamp, cos, exp, float, Fn, hash, If, instancedArray, instanceIndex, length, max, mix, mod, mx_fractal_noise_float, mx_noise_float, select, sin, smoothstep, texture, time, uint, uniform, uv, varying, vec2, vec3, vec4,
} from 'three/tsl';
import { keepNormals } from './post.js';

const rand = (a, b) => a + Math.random() * (b - a);
export const KIND = { smoke: 0, fire: 1, spark: 2, dust: 3, blood: 4, debris: 5, flash: 6, casing: 7, steam: 8 };
const SPAWN_MAX = 1024;

/** Dust and debris colours per theme. */
const GROUND = {
  desert: { dust: [0.72, 0.6, 0.45], chip: [0.5, 0.42, 0.32] },
  port: { dust: [0.42, 0.42, 0.44], chip: [0.3, 0.3, 0.32] },
  snow: { dust: [0.92, 0.94, 0.97], chip: [0.8, 0.84, 0.9] },
};

// ------------------------------------------------------------------ the particle pool

/**
 * The particle pool. gpu: simulate with compute shaders (WebGPU); otherwise (WebGL 2, where
 * compute can't scatter writes) the same buffers are simulated on the CPU and uploaded.
 */
function createParticles(scene, capacity, gpu = true) {
  const N = capacity;
  const P = instancedArray(N, 'vec4'); // position, age
  const V = instancedArray(N, 'vec4'); // velocity, life
  const D = instancedArray(N, 'vec4'); // size start, size end, kind, seed
  const C = instancedArray(N, 'vec4'); // colour, opacity
  // Mark everything dead to start with (age > life)
  const pa = P.value.array;
  for (let i = 0; i < N; i++) pa[i * 4 + 3] = 1e9;
  const sP = attributeArray(SPAWN_MAX, 'vec4');
  const sV = attributeArray(SPAWN_MAX, 'vec4');
  const sD = attributeArray(SPAWN_MAX, 'vec4');
  const sC = attributeArray(SPAWN_MAX, 'vec4');
  const head = uniform(0, 'uint');
  const count = uniform(0, 'uint');
  const dtU = uniform(0);

  const emit = Fn(() => {
    If(instanceIndex.lessThan(count), () => {
      const slot = instanceIndex.add(head).mod(uint(N));
      P.element(slot).assign(sP.element(instanceIndex));
      V.element(slot).assign(sV.element(instanceIndex));
      D.element(slot).assign(sD.element(instanceIndex));
      C.element(slot).assign(sC.element(instanceIndex));
    });
  })().compute(SPAWN_MAX);

  const update = Fn(() => {
    const p = P.element(instanceIndex);
    const v = V.element(instanceIndex);
    const d = D.element(instanceIndex);
    If(p.w.lessThan(v.w), () => {
      const k = d.z;
      const dt = dtU;
      // gravity / buoyancy and drag per kind
      const isSmoke = k.equal(KIND.smoke).or(k.equal(KIND.steam));
      const isFire = k.equal(KIND.fire);
      const heavy = k.equal(KIND.spark).or(k.equal(KIND.debris)).or(k.equal(KIND.casing)).or(k.equal(KIND.blood));
      const g = select(heavy, float(-9.8), select(isSmoke, float(0.7), select(isFire, float(2.2), select(k.equal(KIND.dust), float(-0.25), float(0)))));
      const drag = select(isSmoke, float(1.4), select(isFire, float(2.4), select(k.equal(KIND.dust), float(1.8), select(k.equal(KIND.blood), float(0.6), float(0.25)))));
      const vel = v.xyz.add(vec3(0, g.mul(dt), 0)).mul(exp(drag.negate().mul(dt))).toVar();
      // Smoke drifts and curls a little
      const curl = vec3(mx_noise_float(p.xyz.mul(0.6).add(time.mul(0.3))), 0, mx_noise_float(p.xyz.mul(0.6).add(17).add(time.mul(0.3)))).mul(select(isSmoke, float(0.6), float(0)));
      vel.addAssign(curl.mul(dt));
      const pos = p.xyz.add(vel.mul(dt)).toVar();
      // Hit the ground: bounce (sparks, debris, casings) or stop (blood)
      If(pos.y.lessThan(0.02).and(heavy), () => {
        pos.y.assign(0.02);
        const stick = k.equal(KIND.blood);
        vel.assign(select(stick, vec3(0), vec3(vel.x.mul(0.55), abs(vel.y).mul(0.3), vel.z.mul(0.55))));
      });
      P.element(instanceIndex).assign(vec4(pos, p.w.add(dt)));
      V.element(instanceIndex).assign(vec4(vel, v.w));
    });
  })().compute(N);

  // Drawing: the same buffers through two sprite batches
  const makeSprite = (additive) => {
    const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const p = P.toAttribute();
    const v = V.toAttribute();
    const d = D.toAttribute();
    const c = C.toAttribute();
    // Computed per vertex and handed down: read directly in the pixel shader, the age
    // attribute comes through as zero
    const life = varying(clamp(p.w.div(max(v.w, 0.001)), 0, 1));
    const k = d.z;
    const addKind = k.equal(KIND.fire).or(k.equal(KIND.spark)).or(k.equal(KIND.flash));
    const alphaKind = k.equal(KIND.smoke).or(k.equal(KIND.dust)).or(k.equal(KIND.blood)).or(k.equal(KIND.debris)).or(k.equal(KIND.casing)).or(k.equal(KIND.steam));
    const mine = additive ? addKind : alphaKind;
    const alive = p.w.lessThan(v.w);
    const grow = select(k.equal(KIND.smoke).or(k.equal(KIND.dust)).or(k.equal(KIND.steam)), float(1).sub(float(1).sub(life).pow(2)), life);
    m.positionNode = p.xyz;
    m.scaleNode = select(mine.and(alive), mix(d.x, d.y, grow), float(0));
    m.rotationNode = d.w.mul(6.283).add(life.mul(d.w.sub(0.5)).mul(2));
    // Shape and colour per kind, as plain expressions (no branches): soft billows for smoke
    // and dust, a hot core for sparks, a star for muzzle flashes, chips for debris
    const st = uv().sub(0.5).mul(2);
    const r = length(st);
    const inv = (lo, hi, x) => float(1).sub(smoothstep(lo, hi, x));
    // Billows: fractal noise that churns as the particle ages breaks up the edge and the density
    const n = mx_fractal_noise_float(vec3(st.mul(1.7), d.w.mul(37).add(life.mul(0.9))), 3, 2.1, 0.55).mul(0.5).add(0.5).clamp(0, 1);
    const soft = inv(0.3, 1, r.add(float(0.5).sub(n).mul(0.7))).mul(float(0.45).add(n.mul(0.8)));
    const core = inv(0, 1, r).pow(3);
    const ang = atan(st.y, st.x);
    const star = inv(0, 1, r).mul(cos(ang.mul(5).add(d.w.mul(9))).mul(0.5).add(0.5).pow(4).mul(0.8)).add(inv(0, 0.45, r));
    const chip = inv(0.6, 0.9, r);
    const fade = float(1).sub(life);
    const thin = fade.pow(1.4).mul(smoothstep(0, 0.08, life));
    const isFire = k.equal(KIND.fire);
    const isSpark = k.equal(KIND.spark);
    const isFlash = k.equal(KIND.flash);
    const isChunk = k.equal(KIND.debris).or(k.equal(KIND.casing));
    const isBlood = k.equal(KIND.blood);
    const fireRGB = mix(vec3(5, 2.6, 0.9), vec3(1.4, 0.35, 0.06), life.pow(0.6)).mul(float(0.55).add(n.mul(0.9))).mul(c.rgb);
    // Lit from above, darker in the folds
    const smokeRGB = c.rgb.mul(float(0.55).add(n.mul(0.55)).add(st.y.mul(0.18)));
    m.colorNode = select(isFire, fireRGB, select(isSpark, vec3(8, 4.5, 1.6).mul(c.rgb), select(isFlash, vec3(10, 7, 3.5).mul(c.rgb), smokeRGB)));
    m.opacityNode = select(
      isFire,
      soft.mul(fade.pow(1.3)).mul(c.a),
      select(isSpark, core.mul(fade), select(isFlash, star.mul(fade.pow(2)), select(isChunk, chip.mul(fade.mul(4).min(1)), select(isBlood, soft.mul(1.2).min(1).mul(thin), soft.mul(thin)).mul(c.a)))),
    );
    m.mrtNode = keepNormals();
    const s = new THREE.Sprite(m);
    // Sprites share one geometry by default; each batch reads the buffers through its own
    s.geometry = s.geometry.clone();
    s.count = N;
    s.frustumCulled = false;
    s.renderOrder = additive ? 6 : 5;
    return s;
  };
  const alphaSprites = makeSprite(false);
  const addSprites = makeSprite(true);
  scene.add(alphaSprites, addSprites);

  const queue = [];
  let h = 0;

  /** The CPU version of emit + update, for WebGL 2. */
  function cpuStep(dt) {
    const ap = P.value.array;
    const av = V.value.array;
    const ad = D.value.array;
    const ac = C.value.array;
    for (const [kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a] of queue) {
      const i = h * 4;
      ap.set([x, y, z, 0], i);
      av.set([vx, vy, vz, life], i);
      ad.set([s0, s1, kind, Math.random()], i);
      ac.set([r, g, b, a], i);
      h = (h + 1) % N;
    }
    const spawned = queue.length > 0;
    queue.length = 0;
    let any = spawned;
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      if (ap[o + 3] >= av[o + 3]) continue;
      any = true;
      const k = ad[o + 2];
      const smoke = k === KIND.smoke || k === KIND.steam;
      const heavy = k === KIND.spark || k === KIND.debris || k === KIND.casing || k === KIND.blood;
      const g = heavy ? -9.8 : smoke ? 0.7 : k === KIND.fire ? 2.2 : k === KIND.dust ? -0.25 : 0;
      const drag = Math.exp(-(smoke ? 1.4 : k === KIND.fire ? 2.4 : k === KIND.dust ? 1.8 : k === KIND.blood ? 0.6 : 0.25) * dt);
      let vx = av[o] * drag;
      let vy = (av[o + 1] + g * dt) * drag;
      let vz = av[o + 2] * drag;
      if (smoke) {
        vx += Math.sin(ap[o + 1] * 1.7 + ad[o + 3] * 20) * 0.6 * dt;
        vz += Math.cos(ap[o + 1] * 1.3 + ad[o + 3] * 31) * 0.6 * dt;
      }
      let y = ap[o + 1] + vy * dt;
      if (y < 0.02 && heavy) {
        y = 0.02;
        if (k === KIND.blood) vx = vy = vz = 0;
        else {
          vx *= 0.55;
          vy = Math.abs(vy) * 0.3;
          vz *= 0.55;
        }
      }
      ap[o] += vx * dt;
      ap[o + 1] = y;
      ap[o + 2] += vz * dt;
      ap[o + 3] += dt;
      av[o] = vx;
      av[o + 1] = vy;
      av[o + 2] = vz;
    }
    if (any) for (const buf of [P, V, D, C]) buf.value.needsUpdate = true;
  }

  return {
    N,
    buffers: { P, V, D, C },
    spawn(kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1) {
      if (queue.length < SPAWN_MAX) queue.push([kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a]);
    },
    update(renderer, dt) {
      dtU.value = dt;
      if (!gpu) return cpuStep(dt);
      if (queue.length) {
        const ap = sP.value.array;
        const av = sV.value.array;
        const ad = sD.value.array;
        const ac = sC.value.array;
        queue.forEach(([kind, x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a], i) => {
          ap.set([x, y, z, 0], i * 4);
          av.set([vx, vy, vz, life], i * 4);
          ad.set([s0, s1, kind, Math.random()], i * 4);
          ac.set([r, g, b, a], i * 4);
        });
        for (const s of [sP, sV, sD, sC]) s.value.needsUpdate = true;
        head.value = h;
        count.value = queue.length;
        renderer.compute(emit);
        h = (h + queue.length) % N;
        queue.length = 0;
      }
      renderer.compute(update);
    },
    clear() {
      queue.length = 0;
      const arr = P.value.array;
      for (let i = 0; i < N; i++) arr[i * 4 + 3] = 1e9;
      P.value.needsUpdate = true;
    },
    dispose() {
      scene.remove(alphaSprites, addSprites);
    },
  };
}

// ------------------------------------------------------------------ weather

/** Rain, snow or dust filling a box round the camera, entirely in the vertex shader. */
function createWeather(kind, scene, quality) {
  const n = Math.round((kind === 'rain' ? 7000 : kind === 'snow' ? 6000 : 900) * (quality.fx ?? 1));
  const box = kind === 'rain' ? vec3(40, 22, 40) : kind === 'snow' ? vec3(44, 24, 44) : vec3(50, 12, 50);
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: kind === 'rain' ? THREE.AdditiveBlending : THREE.NormalBlending });
  const i = float(instanceIndex);
  const seed = vec3(hash(i), hash(i.add(1.7)), hash(i.add(3.1)));
  const fall = kind === 'rain' ? vec3(1.5, -16, 0.8) : kind === 'snow' ? vec3(0.5, -1.4, 0.3) : vec3(0.8, 0.05, 0.3);
  const sway = kind === 'snow' ? vec3(sin(time.mul(0.8).add(i)), 0, cos(time.mul(0.7).add(i.mul(1.3)))).mul(0.6) : vec3(0);
  const p = seed.mul(box).add(fall.mul(time).mul(float(0.8).add(seed.x.mul(0.4)))).add(sway);
  // Wrap into the box centred on the camera
  const origin = cameraPosition.sub(box.mul(vec3(0.5, 0.35, 0.5)));
  const local = mod(p.sub(origin), box);
  const at = origin.add(local);
  m.positionNode = at;
  // Fade out right at the lens, where a drop or flake would fill a big slice of the screen
  const near = kind === 'rain' ? smoothstep(1.2, 3.5, length(at.sub(cameraPosition))) : smoothstep(0.5, 1.6, length(at.sub(cameraPosition)));
  m.scaleNode = kind === 'rain' ? vec2(0.012, 0.55) : kind === 'snow' ? vec2(0.05).mul(float(0.6).add(seed.y)) : vec2(0.03);
  const st = uv().sub(0.5).mul(2);
  const r = length(st);
  if (kind === 'rain') {
    m.colorNode = vec3(0.55, 0.62, 0.75);
    m.opacityNode = float(1).sub(smoothstep(0, 1, abs(st.x))).mul(0.22).mul(near);
  } else if (kind === 'snow') {
    m.colorNode = vec3(0.95, 0.97, 1);
    m.opacityNode = float(1).sub(smoothstep(0.3, 1, r)).mul(0.85).mul(near);
  } else {
    m.colorNode = vec3(0.9, 0.78, 0.6);
    m.opacityNode = float(1).sub(smoothstep(0, 1, r)).mul(0.25).mul(near);
  }
  m.mrtNode = keepNormals();
  const s = new THREE.Sprite(m);
  s.count = n;
  s.frustumCulled = false;
  s.renderOrder = 7;
  scene.add(s);
  return s;
}

// ------------------------------------------------------------------ tracers

function createTracers(scene, max = 96) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 4 * 3);
  const uvs = new Float32Array(max * 4 * 2);
  const col = new Float32Array(max * 4 * 3);
  const idx = [];
  for (let i = 0; i < max; i++) {
    uvs.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true });
  const st = uv();
  // Hot along the middle, a bright head, fading toward the tail
  m.opacityNode = smoothstep(0, 0.5, st.y).mul(float(1).sub(smoothstep(0.5, 1, st.y))).mul(st.x.pow(0.7));
  m.mrtNode = keepNormals();
  const mesh = new THREE.Mesh(geo, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  scene.add(mesh);
  const live = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const side = new THREE.Vector3();
  const view = new THREE.Vector3();
  return {
    add(from, to, { hostile = false, heavy = false } = {}) {
      const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      if (live.length >= max) live.shift();
      live.push({ from: { ...from }, to: { ...to }, len, t: 0, speed: 380, streak: Math.min(len, heavy ? 9 : 6), width: heavy ? 0.03 : 0.018, color: hostile ? [7, 1.8, 0.8] : [7, 5, 2.2] });
    },
    update(dt, camera) {
      let n = 0;
      for (let i = live.length - 1; i >= 0; i--) {
        const tr = live[i];
        tr.t += dt * tr.speed;
        if (tr.t - tr.streak > tr.len) {
          live.splice(i, 1);
          continue;
        }
      }
      for (const tr of live) {
        if (n >= max) break;
        const k1 = Math.min(1, tr.t / tr.len);
        const k0 = Math.max(0, (tr.t - tr.streak) / tr.len);
        a.set(tr.from.x + (tr.to.x - tr.from.x) * k0, tr.from.y + (tr.to.y - tr.from.y) * k0, tr.from.z + (tr.to.z - tr.from.z) * k0);
        b.set(tr.from.x + (tr.to.x - tr.from.x) * k1, tr.from.y + (tr.to.y - tr.from.y) * k1, tr.from.z + (tr.to.z - tr.from.z) * k1);
        // Ribbon faces the camera: widen across the view direction
        view.copy(a).add(b).multiplyScalar(0.5).sub(camera.position);
        side.subVectors(b, a).cross(view).normalize();
        // Thicker further away so they stay visible
        const w = tr.width * Math.max(1, view.length() / 12);
        side.multiplyScalar(w);
        pos.set([a.x - side.x, a.y - side.y, a.z - side.z, b.x - side.x, b.y - side.y, b.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x + side.x, b.y + side.y, b.z + side.z], n * 12);
        for (let v = 0; v < 4; v++) col.set(tr.color, n * 12 + v * 3);
        n++;
      }
      geo.setDrawRange(0, n * 6);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
    clear() {
      live.length = 0;
    },
  };
}

// ------------------------------------------------------------------ decals

function decalTexture(kind) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  if (kind === 'hole') {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.18, 'rgba(10,8,6,1)');
    g.addColorStop(0.3, 'rgba(40,36,30,0.7)');
    g.addColorStop(1, 'rgba(40,36,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      ctx.strokeStyle = 'rgba(20,18,14,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(S / 2, S / 2);
      ctx.lineTo(S / 2 + Math.cos(a) * S * 0.35, S / 2 + Math.sin(a) * S * 0.35);
      ctx.stroke();
    }
  } else if (kind === 'scorch') {
    for (let i = 0; i < 30; i++) {
      const r = S * (0.15 + Math.random() * 0.3);
      const x = S / 2 + (Math.random() - 0.5) * S * 0.3;
      const y = S / 2 + (Math.random() - 0.5) * S * 0.3;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(8,6,5,0.35)');
      g.addColorStop(1, 'rgba(8,6,5,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
  } else {
    for (let i = 0; i < 24; i++) {
      const r = S * (0.08 + Math.random() * 0.22);
      const x = S / 2 + (Math.random() - 0.5) * S * 0.4;
      const y = S / 2 + (Math.random() - 0.5) * S * 0.4;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(70,4,2,0.9)');
      g.addColorStop(0.7, 'rgba(50,2,1,0.7)');
      g.addColorStop(1, 'rgba(40,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function createDecals(scene, kind, max) {
  const tex = decalTexture(kind);
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: kind === 'blood' ? 0.25 : 0.95, metalness: 0 });
  m.colorNode = texture(tex).rgb;
  m.opacityNode = texture(tex).a;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, m, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  scene.add(mesh);
  let next = 0;
  const grow = [];
  const d = new THREE.Object3D();
  const n = new THREE.Vector3();
  return {
    add(p, normal, size, growTo = 0) {
      n.set(normal.x, normal.y, normal.z).normalize();
      d.position.set(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01);
      d.lookAt(d.position.x + n.x, d.position.y + n.y, d.position.z + n.z);
      d.rotateZ(Math.random() * Math.PI * 2);
      d.scale.setScalar(size);
      d.updateMatrix();
      mesh.setMatrixAt(next, d.matrix);
      if (growTo) grow.push({ i: next, m: d.matrix.clone(), s: size, to: growTo });
      next = (next + 1) % max;
      mesh.count = Math.min(max, Math.max(mesh.count, next === 0 ? max : next));
      mesh.instanceMatrix.needsUpdate = true;
    },
    update(dt) {
      for (let k = grow.length - 1; k >= 0; k--) {
        const g = grow[k];
        g.s += (g.to - g.s) * Math.min(1, dt * 0.6);
        const sc = g.s / g.m.getMaxScaleOnAxis();
        const m2 = g.m.clone().scale(new THREE.Vector3(sc, sc, sc));
        mesh.setMatrixAt(g.i, m2);
        mesh.instanceMatrix.needsUpdate = true;
        if (Math.abs(g.to - g.s) < 0.01) grow.splice(k, 1);
      }
    },
    clear() {
      mesh.count = 0;
      next = 0;
      grow.length = 0;
    },
  };
}


// ------------------------------------------------------------------ the effects system

export function createFx(scene, renderer, quality) {
  let q = quality;
  const group = new THREE.Group();
  scene.add(group);
  const gpu = !!renderer.backend?.isWebGPUBackend;
  let particles = createParticles(group, Math.round(12000 * (q.fx ?? 1)), gpu);
  const tracers = createTracers(group);
  const holes = createDecals(group, 'hole', 220);
  const scorch = createDecals(group, 'scorch', 24);
  const blood = createDecals(group, 'blood', 40);
  let weather = null;
  let weatherKind = null;
  const burners = [];
  // Fires and smoke columns that belong to the level: they outlast a restart
  let ambient = { fires: [], smokes: [] };
  // Muzzle flash lights: a few, reused
  const lights = [0, 1, 2].map(() => {
    const l = new THREE.PointLight(0xffb060, 0, 9, 2);
    group.add(l);
    return { l, t: 0 };
  });
  let li = 0;
  let theme = 'desert';
  const gc = () => GROUND[theme] || GROUND.desert;

  const api = {
    get particles() {
      return particles;
    },
    setQuality(nq) {
      q = nq;
      particles.dispose();
      particles = createParticles(group, Math.round(12000 * (q.fx ?? 1)), gpu);
      if (weatherKind) api.setWeather(weatherKind);
    },
    clear() {
      particles.clear();
      tracers.clear();
      holes.clear();
      scorch.clear();
      blood.clear();
      burners.length = 0;
    },
    setTheme(t) {
      theme = t;
    },
    /** The level's own fires (burning barrels) and smoke columns beyond the walls. */
    setAmbient({ fires = [], smokes = [] } = {}) {
      ambient = { fires, smokes };
    },
    /** 'rain' | 'snow' | 'dust' | null */
    setWeather(kind) {
      if (weather) group.remove(weather);
      weather = kind ? createWeather(kind, group, q) : null;
      weatherKind = kind;
    },
    flashLight(at, k = 1, color = 0xffb060) {
      const s = lights[li++ % lights.length];
      s.l.position.set(at.x, at.y, at.z);
      s.l.color.setHex(color);
      s.l.intensity = 30 * k;
      s.l.distance = 9 * Math.sqrt(k);
      s.t = 0.06 * Math.sqrt(k);
    },
    muzzle(at, dir, { big = false, light = true } = {}) {
      const s = big ? 1.5 : 1;
      particles.spawn(KIND.flash, at.x + dir.x * 0.05, at.y + dir.y * 0.05, at.z + dir.z * 0.05, 0, 0, 0, 0.05, 0.35 * s, 0.45 * s, 1, 1, 1);
      particles.spawn(KIND.flash, at.x + dir.x * 0.18, at.y + dir.y * 0.18, at.z + dir.z * 0.18, dir.x * 3, dir.y * 3, dir.z * 3, 0.04, 0.22 * s, 0.3 * s, 1, 0.85, 0.7);
      for (let i = 0; i < 2; i++) particles.spawn(KIND.smoke, at.x, at.y, at.z, dir.x * 1.5 + rand(-0.3, 0.3), dir.y * 1.5 + rand(0, 0.4), dir.z * 1.5 + rand(-0.3, 0.3), rand(0.5, 0.9), 0.06, 0.35, 0.7, 0.7, 0.7, 0.25);
      if (light) api.flashLight(at, big ? 1.4 : 0.8);
    },
    casing(at, dir) {
      // Ejected to the right of the gun, tumbling
      const rx = -dir.z;
      const rz = dir.x;
      particles.spawn(KIND.casing, at.x - dir.x * 0.4, at.y, at.z - dir.z * 0.4, rx * rand(1.5, 2.5), rand(1.5, 2.6), rz * rand(1.5, 2.5), 1.4, 0.022, 0.022, 0.78, 0.6, 0.25);
    },
    impact(point, normal, kind, t) {
      if (t) theme = t;
      const n = normal || { x: 0, y: 1, z: 0 };
      const g = gc();
      if (kind === 'flesh') {
        for (let i = 0; i < 6; i++) particles.spawn(KIND.blood, point.x, point.y, point.z, rand(-1.5, 1.5), rand(-0.2, 1.8), rand(-1.5, 1.5), rand(0.3, 0.6), 0.08, 0.3, 0.35, 0.02, 0.01, 0.85);
        for (let i = 0; i < 5; i++) particles.spawn(KIND.blood, point.x, point.y, point.z, rand(-2.5, 2.5), rand(0, 2.5), rand(-2.5, 2.5), 1.2, 0.025, 0.02, 0.25, 0.01, 0.0, 1);
        return;
      }
      // Dust puff off the surface, chips, and sparks off hard things
      const metal = kind === 'box' && theme === 'port';
      for (let i = 0; i < 4; i++) particles.spawn(KIND.dust, point.x, point.y, point.z, n.x * rand(0.6, 1.6) + rand(-0.4, 0.4), n.y * rand(0.6, 1.6) + rand(0, 0.5), n.z * rand(0.6, 1.6) + rand(-0.4, 0.4), rand(0.6, 1.2), 0.08, rand(0.4, 0.8), ...g.dust, 0.55);
      for (let i = 0; i < 4; i++) particles.spawn(KIND.debris, point.x, point.y, point.z, n.x * rand(1, 3) + rand(-1, 1), n.y * rand(1, 3) + rand(0.5, 2), n.z * rand(1, 3) + rand(-1, 1), rand(0.6, 1.1), 0.03, 0.03, ...g.chip, 1);
      if (kind === 'box' || metal) for (let i = 0; i < (metal ? 6 : 2); i++) particles.spawn(KIND.spark, point.x, point.y, point.z, n.x * rand(2, 6) + rand(-2, 2), n.y * rand(2, 6) + rand(0, 2), n.z * rand(2, 6) + rand(-2, 2), rand(0.15, 0.35), 0.03, 0.02, 1, 0.9, 0.7);
      if (kind === 'box') holes.add(point, n, rand(0.07, 0.11));
      else if (Math.random() < 0.4) holes.add(point, n, rand(0.12, 0.18));
    },
    explosion(at, big = 1) {
      const g = gc();
      api.flashLight(at, 4 * big, 0xffa050);
      particles.spawn(KIND.flash, at.x, at.y + 0.3, at.z, 0, 0, 0, 0.12, 2.5 * big, 4 * big, 1, 1, 1);
      for (let i = 0; i < 16 * big; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(1.5, 5) * big;
        particles.spawn(KIND.fire, at.x, at.y + 0.3, at.z, Math.cos(a) * s, rand(1, 5) * big, Math.sin(a) * s, rand(0.35, 0.8), 0.6 * big, 1.6 * big, 1, 1, 1, 0.9);
      }
      for (let i = 0; i < 22 * big; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(0.5, 3.5) * big;
        const shade = rand(0.12, 0.3);
        particles.spawn(KIND.smoke, at.x + rand(-0.5, 0.5), at.y + rand(0.2, 1), at.z + rand(-0.5, 0.5), Math.cos(a) * s, rand(1, 4), Math.sin(a) * s, rand(3, 6), 0.8 * big, 4.2 * big, shade, shade * 0.95, shade * 0.9, 0.85);
      }
      for (let i = 0; i < 40 * big; i++) particles.spawn(KIND.spark, at.x, at.y + 0.3, at.z, rand(-12, 12), rand(3, 14), rand(-12, 12), rand(0.4, 1.2), 0.05, 0.03, 1, 0.8, 0.5);
      for (let i = 0; i < 18 * big; i++) particles.spawn(KIND.debris, at.x, at.y + 0.3, at.z, rand(-8, 8), rand(4, 11), rand(-8, 8), rand(1.2, 2.2), 0.08, 0.06, ...g.chip, 1);
      for (let i = 0; i < 10 * big; i++) particles.spawn(KIND.dust, at.x + rand(-1, 1), 0.2, at.z + rand(-1, 1), rand(-5, 5), rand(0.2, 1.5), rand(-5, 5), rand(1.5, 3), 1, 4 * big, ...g.dust, 0.6);
      scorch.add({ x: at.x, y: 0.02, z: at.z }, { x: 0, y: 1, z: 0 }, 3.5 * big);
    },
    burn(at, size = 1) {
      burners.push({ at: { ...at }, size, t: 0, life: 12 });
    },
    bloodPool(at) {
      blood.add({ x: at.x + rand(-0.3, 0.3), y: 0.02, z: at.z + rand(-0.3, 0.3) }, { x: 0, y: 1, z: 0 }, 0.3, rand(1.1, 1.8));
    },
    dust(at, t, amount = 1, spread = 0.3) {
      if (t) theme = t;
      const g = gc();
      const n = Math.max(1, Math.round(amount * 2));
      for (let i = 0; i < n; i++) particles.spawn(KIND.dust, at.x + rand(-spread, spread), 0.08, at.z + rand(-spread, spread), rand(-0.6, 0.6) * amount, rand(0.2, 0.8), rand(-0.6, 0.6) * amount, rand(0.8, 1.8), 0.15, 0.5 + amount * 0.6, ...g.dust, 0.45);
    },
    breath(at, dir) {
      particles.spawn(KIND.steam, at.x, at.y, at.z, dir.x * 0.6, 0.1, dir.z * 0.6, 1.2, 0.04, 0.25, 0.92, 0.94, 0.97, 0.35);
    },
    tracer(from, to, opts) {
      tracers.add(from, to, opts);
    },
    /** One of everything, out of sight, so their shaders compile during loading. */
    prewarm(camera) {
      const far = { x: camera.position.x, y: -60, z: camera.position.z };
      holes.add(far, { x: 0, y: 1, z: 0 }, 0.1);
      scorch.add(far, { x: 0, y: 1, z: 0 }, 0.1);
      blood.add(far, { x: 0, y: 1, z: 0 }, 0.1);
      tracers.add(far, { x: far.x + 1, y: far.y, z: far.z });
      tracers.update(0, camera);
      for (const k of Object.values(KIND)) particles.spawn(k, far.x, far.y, far.z, 0, 0, 0, 0.2, 0.1, 0.1, 1, 1, 1, 1);
      particles.update(renderer, 0.016);
      api.flashLight(far, 0.1);
    },
    update(dt, camera, t) {
      if (t) theme = t;
      // Lingering fires: flames and smoke for a while after something burns
      for (let i = burners.length - 1; i >= 0; i--) {
        const b = burners[i];
        b.t += dt;
        if (b.t > b.life) {
          burners.splice(i, 1);
          continue;
        }
        const k = 1 - b.t / b.life;
        if (Math.random() < 0.7 * k) particles.spawn(KIND.fire, b.at.x + rand(-0.4, 0.4) * b.size, b.at.y, b.at.z + rand(-0.4, 0.4) * b.size, rand(-0.2, 0.2), rand(0.8, 2), rand(-0.2, 0.2), rand(0.4, 0.8), 0.4 * b.size, 0.9 * b.size, 1, 1, 1, 0.8);
        if (Math.random() < 0.5) particles.spawn(KIND.smoke, b.at.x, b.at.y + 0.6, b.at.z, rand(-0.3, 0.3), rand(1, 2), rand(-0.3, 0.3), rand(3, 6), 0.6 * b.size, 3 * b.size, 0.12, 0.11, 0.1, 0.6);
      }
      // Burning barrels: tongues of flame, embers drifting up, a thread of smoke
      for (const f of ambient.fires) {
        const s = f.s;
        if (Math.random() < 22 * dt) particles.spawn(KIND.fire, f.x + rand(-0.18, 0.18) * s, f.y, f.z + rand(-0.18, 0.18) * s, rand(-0.15, 0.15), rand(0.6, 1.4), rand(-0.15, 0.15), rand(0.35, 0.7), 0.3 * s, 0.75 * s, 1, 1, 1, 0.85);
        if (Math.random() < 5 * dt) particles.spawn(KIND.fire, f.x, f.y + 0.3, f.z, rand(-0.5, 0.5), rand(1.5, 3), rand(-0.5, 0.5), rand(1.2, 2.2), 0.035, 0.02, 1, 0.8, 0.5, 1);
        if (Math.random() < 3 * dt) particles.spawn(KIND.smoke, f.x, f.y + 0.6, f.z, rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2), rand(3, 5), 0.4 * s, 2.2 * s, 0.1, 0.09, 0.08, 0.5);
      }
      // Smoke columns far off: big, slow, dark
      for (const c of ambient.smokes) {
        if (Math.random() < 2.5 * dt) {
          const shade = rand(0.1, 0.2);
          particles.spawn(KIND.smoke, c.x + rand(-1.5, 1.5), c.y, c.z + rand(-1.5, 1.5), rand(0.3, 0.9), rand(2.2, 3.4), rand(-0.3, 0.3), rand(14, 20), 4 * c.s, 16 * c.s, shade * 1.1, shade, shade * 0.9, 0.7);
        }
        if (Math.random() < 2 * dt) particles.spawn(KIND.fire, c.x + rand(-1, 1), c.y - 1, c.z + rand(-1, 1), 0, rand(1, 2), 0, rand(0.6, 1.2), 1.5 * c.s, 3 * c.s, 1, 1, 1, 0.6);
      }
      for (const s of lights) {
        s.t -= dt;
        if (s.t <= 0) s.l.intensity = 0;
      }
      particles.update(renderer, dt);
      tracers.update(dt, camera);
      blood.update(dt);
    },
  };
  return api;
}

