// The people: who is played by which model, what they wear, and how they're dressed on the GPU.
// The bodies are Microsoft's Rocketbox avatars (realistic, motion-capture rigged). Hatch and
// Cruz wear digital camouflage recoloured in the shader into each one's scheme (only the
// low-saturation fabric changes, never skin or patches) and painted hard-shell masks moulded to
// their own faces. The opposition is a drug cartel: gunmen in street clothes (work shirts,
// T-shirts, jackets, hoodies) with bandanas tied over their faces and ball caps, and enforcers in
// black tactical gear and helmets. Masks, bandanas and caps are all fitted to each face the
// same way: rays are cast at the head, and a shell is built a little out from where they land.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { color, dot, float, max, min, mix, modelPosition, mx_fractal_noise_float, normalView, positionViewDirection, positionWorld, pow, smoothstep, sqrt, texture, uniform, uv, vec3 } from 'three/tsl';
import { ENEMY_TYPES } from '../actors.js';
import { loadClips, loadGLB } from './assets.js';
import { Animator } from './animator.js';
import { makeGun, preloadGuns } from './guns.js';
import { Rig, UP, worldPos } from './rig.js';

/** Camouflage and uniform schemes: dark, mid, light (sRGB). */
export const CAMO = {
  hatch: ['#45472f', '#6c6a47', '#9a9171'],
  cruz: ['#34373c', '#53575d', '#80848a'],
  // The cartel's tactical men
  black: ['#141517', '#22252a', '#3a3e44'],
  khaki: ['#3a2c1c', '#6e5536', '#a38660'], // coyote tan
  snow: ['#8f969e', '#c0c6cd', '#eceef1'],
};

/** Who plays whom. avatar: model; hide: materials left off; camo: scheme; mask; guns. */
const ROLES = {
  hatch: { avatar: 'Military_Male_03', hide: ['helmet'], camo: 'hatch', mask: true, guns: { rifle: 'carbine', pistol: 'pistol', sniper: 'boltRifle' } },
  cruz: { avatar: 'Military_Male_01', hide: ['helmet', 'combat_knife'], camo: 'cruz', mask: true, guns: { rifle: 'carbineTan', pistol: 'pistol', sniper: 'boltRifle' } },
  hostage: { avatar: 'Construction_Male_02', hide: ['helmet'], camo: null, guns: {} },
};

// The cartel. Each entry is one look: avatar, bandana (pattern) and cap (colour), and for the
// tactical men a uniform scheme and helmet. Gunmen dress for the place: shirts and tees in the
// desert, dark clothes at night in the port, jackets and hoodies in the mountains.
const B = (bandana) => ({ bandana });
const GUNMEN = {
  desert: [
    { avatar: 'Delivery_Male_01', ...B('red') },
    { avatar: 'Male_Adult_09', ...B('skull'), cap: '#16171a' },
    { avatar: 'Male_Adult_11', cap: '#b9a682' },
    { avatar: 'Male_Adult_20', ...B('black') },
    { avatar: 'Male_Adult_12', ...B('olive'), cap: '#24395a' },
    { avatar: 'Male_Adult_06', ...B('navy'), cap: '#8e1c18' },
  ],
  port: [
    { avatar: 'Male_Adult_09', ...B('skull') },
    { avatar: 'Male_Adult_07', ...B('black'), cap: '#16171a' },
    { avatar: 'Male_Adult_18', ...B('skull') },
    { avatar: 'Male_Adult_10', ...B('navy'), cap: '#2a2c30' },
    { avatar: 'Male_Adult_12', ...B('red') },
  ],
  snow: [
    { avatar: 'Male_Adult_06', ...B('black'), cap: '#16171a' },
    { avatar: 'Male_Adult_10', ...B('skull') },
    { avatar: 'Male_Adult_12', ...B('olive'), cap: '#5a5040' },
    { avatar: 'Male_Adult_07', ...B('navy') },
    { avatar: 'Male_Adult_18', ...B('red') },
  ],
};
const SHOTGUNNERS = {
  desert: [{ avatar: 'Male_Adult_20', cap: '#2a2c30' }, { avatar: 'Delivery_Male_01', ...B('black'), cap: '#b9a682' }],
  port: [{ avatar: 'Male_Adult_07', ...B('red') }, { avatar: 'Male_Adult_18', ...B('black') }],
  snow: [{ avatar: 'Male_Adult_10', cap: '#16171a', ...B('black') }, { avatar: 'Male_Adult_06', ...B('skull') }],
};
const TACTICAL = {
  sniper: { avatar: 'Military_Male_05', camo: 'khaki', ...B('olive'), cap: '#5a5040' },
  heavy: { avatar: 'Military_Male_04', camo: 'black', helmet: true, ...B('skull') },
  warlord: { avatar: 'Military_Male_01', camo: 'khaki', cap: '#16171a' },
  enforcer: { avatar: 'Military_Male_04', camo: 'black', helmet: true, ...B('red') },
  warden: { avatar: 'Military_Male_03', camo: 'snow', helmet: true, ...B('skull') },
};
const ENEMY_GUN = { rifleman: 'ak', shotgunner: 'shotgunWood', sniper: 'boltRifle', heavy: 'rpk', warlord: 'goldAk', enforcer: 'shotgun', warden: 'rotary' };
const HEAVY = ['heavy', 'warlord', 'enforcer', 'warden'];

/** The looks an enemy type has in a theme (spawned enemies cycle through them). */
function enemyLooks(type, theme) {
  if (type === 'rifleman') return GUNMEN[theme] || GUNMEN.desert;
  if (type === 'shotgunner') return SHOTGUNNERS[theme] || SHOTGUNNERS.desert;
  return [TACTICAL[type] || TACTICAL.heavy];
}

/** How many looks an enemy type has (so the renderer can pool one person per look). */
export const enemyVariants = (type, theme) => enemyLooks(type, theme).length;

/** The role spec for an enemy. seed picks the look. */
function enemyRole(type, theme, seed) {
  const looks = enemyLooks(type, theme);
  const look = looks[seed % looks.length];
  const hide = [...(look.helmet ? [] : ['helmet']), 'combat_knife', 'pistol'];
  const scale = ENEMY_TYPES[type]?.size || 1;
  return { avatar: look.avatar, hide, camo: look.camo || null, bandana: look.bandana || null, cap: look.cap || null, scale: scale !== 1 ? scale : undefined, guns: { main: ENEMY_GUN[type] } };
}

// ------------------------------------------------------------------ materials

/** Shared across every person: rim light strength (per theme) and colour. */
export const PEOPLE = {
  rim: uniform(0.25),
  rimColor: uniform(new THREE.Color('#ffe8cc')),
  // The theme's dirt: kicked-up dust, wet grime or snow, worked into trousers and boots
  dust: uniform(new THREE.Color('#8c7656')),
  dustK: uniform(0.6),
};

/** Each person's hit flash, read per object as it's drawn. */
const flash = uniform(0).onObjectUpdate(({ object }) => object.userData.person?.flash ?? 0);

/** A soft rim light so people separate from the background, plus the red hit flash. */
const rimAndFlash = () => vec3(PEOPLE.rimColor).mul(pow(float(1).sub(max(dot(normalView, positionViewDirection), 0)), 3)).mul(PEOPLE.rim).add(vec3(0.9, 0.12, 0.05).mul(flash));

/**
 * A character material from a glTF one: the same maps, the camouflage recoloured in the shader,
 * a hit flash, and a soft rim light so people separate from the background.
 */
function personMaterial(src, camo) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.name = src.name;
  const st = uv();
  let albedo = src.map ? texture(src.map, st).rgb : color(src.color);
  if (camo) {
    // Uniforms, so every scheme shares one shader
    const [d, md, l] = CAMO[camo].map((hex) => uniform(new THREE.Color(hex)));
    const c = albedo;
    // Everything is repainted (fabric, webbing, flags and patches) except skin and leather: warm,
    // moderately saturated tones where red > green > blue (judged in a perceptual-ish space)
    const g = sqrt(max(c, vec3(0)));
    const mx = max(g.r, max(g.g, g.b));
    const mn = min(g.r, min(g.g, g.b));
    const sat = mx.sub(mn).div(max(mx, 0.001));
    const warm = smoothstep(-0.01, 0.02, g.r.sub(g.g)).mul(smoothstep(-0.01, 0.02, g.g.sub(g.b)));
    const hue = g.g.sub(g.b).div(max(g.r.sub(g.b), 0.001)); // 0 red .. 1 yellow
    const skinHue = smoothstep(0.12, 0.25, hue).mul(float(1).sub(smoothstep(0.75, 0.9, hue)));
    const skinSat = smoothstep(0.14, 0.24, sat).mul(float(1).sub(smoothstep(0.62, 0.78, sat)));
    const fabric = float(1).sub(warm.mul(skinHue).mul(skinSat));
    const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const t = smoothstep(0.025, 0.4, lum);
    const camoCol = mix(mix(vec3(d), vec3(md), smoothstep(0, 0.55, t)), vec3(l), smoothstep(0.55, 1, t));
    albedo = mix(c, camoCol, fabric);
  }
  // Field wear: mottled grime everywhere (in texture space, so it never swims as limbs move) and
  // the theme's dust caked up the legs, thickest on the boots
  const mottle = mx_fractal_noise_float(vec3(st.mul(36), 0), 3, 2, 0.5).mul(0.5).add(0.5);
  const height = positionWorld.y.sub(modelPosition.y);
  const low = float(1).sub(smoothstep(0.05, 0.8, height));
  const caked = low.mul(float(0.45).add(mottle.mul(0.55))).mul(PEOPLE.dustK);
  albedo = albedo.mul(mix(float(1), float(0.82), smoothstep(0.45, 0.8, mottle)));
  albedo = mix(albedo, vec3(PEOPLE.dust), caked.mul(0.75));
  m.colorNode = albedo;
  if (src.normalMap) {
    m.normalMap = src.normalMap;
    m.normalScale = src.normalScale.clone();
  }
  if (src.roughnessMap) {
    const arm = texture(src.roughnessMap, st);
    m.roughnessNode = mix(arm.g.mul(src.roughness ?? 1), float(0.95), caked);
    m.metalnessNode = arm.b.mul(src.metalness ?? 1);
  } else {
    m.roughnessNode = mix(float(src.roughness ?? 0.8), float(0.95), caked);
    m.metalness = src.metalness ?? 0;
  }
  m.emissiveNode = rimAndFlash();
  if (src.alphaTest > 0 && src.map) {
    // Hair cards: cut out by the map's alpha
    m.opacityNode = texture(src.map, st).a;
    m.alphaTest = src.alphaTest;
    m.side = THREE.DoubleSide;
  } else m.side = src.side;
  return m;
}

const materialCache = new Map();
function materialFor(avatar, src, camo) {
  const key = `${avatar}|${src.name}|${src.uuid}|${camo}`;
  if (!materialCache.has(key)) materialCache.set(key, personMaterial(src, camo));
  return materialCache.get(key);
}

// ------------------------------------------------------------------ masks

/**
 * A mask design, painted in the mask's own space (u across the face, v up; the eyes sit at about
 * (0.3, 0.4) and (0.7, 0.4) from the top). Called once in colour and once in grey for the relief,
 * so the paint stands slightly proud of the shell.
 */
function paintDesign(ctx, S, pattern, base, accent, bone) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  const mirror = (draw) => {
    draw(1);
    ctx.save();
    ctx.translate(S, 0);
    ctx.scale(-1, 1);
    draw(-1);
    ctx.restore();
  };
  if (pattern === 'stripe') ctx.fillRect(S * 0.43, 0, S * 0.14, S);
  if (pattern === 'split') ctx.fillRect(S / 2, 0, S / 2, S);
  if (pattern === 'chevron') {
    ctx.lineWidth = 30;
    for (const y of [S * 0.12, S * 0.3]) {
      ctx.beginPath();
      ctx.moveTo(S * 0.1, y);
      ctx.lineTo(S / 2, y + S * 0.16);
      ctx.lineTo(S * 0.9, y);
      ctx.stroke();
    }
  }
  if (pattern === 'teeth') {
    ctx.fillRect(S * 0.18, S * 0.66, S * 0.64, S * 0.2);
    ctx.fillStyle = bone;
    for (let i = 0; i < 9; i++) {
      const x = S * 0.2 + i * S * 0.067;
      ctx.beginPath();
      ctx.moveTo(x, S * 0.68);
      ctx.lineTo(x + S * 0.055, S * 0.68);
      ctx.lineTo(x + S * 0.027, S * 0.76 + (i % 2) * 10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, S * 0.85);
      ctx.lineTo(x + S * 0.055, S * 0.85);
      ctx.lineTo(x + S * 0.027, S * 0.77);
      ctx.fill();
    }
  }
  if (pattern === 'target') {
    ctx.lineWidth = 18;
    for (const r of [S * 0.09, S * 0.19, S * 0.29]) {
      ctx.beginPath();
      ctx.arc(S * 0.7, S * 0.38, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillRect(S * 0.7 - 9, 0, 18, S);
  }
  if (pattern === 'hazard') {
    // Warning stripes across the jaw under a ruled line
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, S * 0.62, S, S * 0.38);
    ctx.clip();
    for (let x = -S; x < S * 1.5; x += S * 0.14) {
      ctx.beginPath();
      ctx.moveTo(x, S);
      ctx.lineTo(x + S * 0.07, S);
      ctx.lineTo(x + S * 0.07 + S * 0.38, S * 0.62);
      ctx.lineTo(x + S * 0.38, S * 0.62);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillRect(0, S * 0.585, S, S * 0.018);
  }
  if (pattern === 'skull') {
    // A calavera: deep sockets, a notched nose, a stitched grin, petals on the brow
    mirror(() => {
      ctx.beginPath();
      ctx.ellipse(S * 0.3, S * 0.41, S * 0.16, S * 0.14, -0.15, 0, Math.PI * 2);
      ctx.fill();
      // Hollow cheeks
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(S * 0.08, S * 0.55);
      ctx.quadraticCurveTo(S * 0.22, S * 0.6, S * 0.3, S * 0.72);
      ctx.quadraticCurveTo(S * 0.14, S * 0.7, S * 0.06, S * 0.62);
      ctx.fill();
      ctx.globalAlpha = 1;
      // Brow scallops
      ctx.lineWidth = 7;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(S * (0.18 + i * 0.075), S * 0.225, S * 0.03, Math.PI, 0);
        ctx.stroke();
      }
    });
    // Nose: an upside-down heart
    ctx.beginPath();
    ctx.moveTo(S * 0.5, S * 0.52);
    ctx.bezierCurveTo(S * 0.44, S * 0.56, S * 0.43, S * 0.62, S * 0.47, S * 0.625);
    ctx.lineTo(S * 0.5, S * 0.6);
    ctx.lineTo(S * 0.53, S * 0.625);
    ctx.bezierCurveTo(S * 0.57, S * 0.62, S * 0.56, S * 0.56, S * 0.5, S * 0.52);
    ctx.fill();
    // The grin, stitched shut
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(S * 0.2, S * 0.74);
    ctx.quadraticCurveTo(S * 0.5, S * 0.8, S * 0.8, S * 0.74);
    ctx.stroke();
    ctx.lineWidth = 4;
    for (let i = 0; i <= 10; i++) {
      const x = S * (0.24 + i * 0.052);
      const y = S * (0.745 + 0.03 * Math.sin((i / 10) * Math.PI));
      ctx.beginPath();
      ctx.moveTo(x, y - S * 0.04);
      ctx.lineTo(x, y + S * 0.04);
      ctx.stroke();
    }
    // Petals round a dot in the middle of the brow
    ctx.save();
    ctx.translate(S * 0.5, S * 0.17);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.ellipse(0, S * 0.04, S * 0.016, S * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(0, 0, S * 0.014, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (pattern === 'tribal') {
    // A serpent design: blades sweeping up from the chin over each cheek, horns over the brow,
    // and a chain of diamonds down the middle
    mirror(() => {
      ctx.beginPath();
      ctx.moveTo(S * 0.5, S * 0.98);
      ctx.bezierCurveTo(S * 0.3, S * 0.9, S * 0.14, S * 0.74, S * 0.03, S * 0.46);
      ctx.bezierCurveTo(S * 0.12, S * 0.6, S * 0.22, S * 0.66, S * 0.3, S * 0.66);
      ctx.bezierCurveTo(S * 0.22, S * 0.72, S * 0.36, S * 0.82, S * 0.5, S * 0.84);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(S * 0.46, S * 0.3);
      ctx.bezierCurveTo(S * 0.34, S * 0.22, S * 0.2, S * 0.2, S * 0.06, S * 0.06);
      ctx.bezierCurveTo(S * 0.16, S * 0.2, S * 0.18, S * 0.28, S * 0.14, S * 0.3);
      ctx.bezierCurveTo(S * 0.26, S * 0.27, S * 0.36, S * 0.28, S * 0.46, S * 0.34);
      ctx.fill();
      // A fang under each eye
      ctx.beginPath();
      ctx.moveTo(S * 0.2, S * 0.5);
      ctx.lineTo(S * 0.3, S * 0.5);
      ctx.lineTo(S * 0.27, S * 0.6);
      ctx.fill();
    });
    for (let i = 0; i < 5; i++) {
      const y = S * (0.08 + i * 0.1);
      const r = S * (0.035 - i * 0.003);
      ctx.beginPath();
      ctx.moveTo(S * 0.5, y - r);
      ctx.lineTo(S * 0.5 + r * 0.7, y);
      ctx.lineTo(S * 0.5, y + r);
      ctx.lineTo(S * 0.5 - r * 0.7, y);
      ctx.fill();
    }
  }
}

/** The face-plate artwork and its relief: colour with honest wear, and a matching bump map. */
function maskTexture({ pattern, base, accent }, eyes) {
  const S = 512;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c;
  };
  const c = canvas();
  const ctx = c.getContext('2d');
  const h = canvas();
  const hx = h.getContext('2d');
  paintDesign(ctx, S, pattern, base, accent, '#efe9dc');
  paintDesign(hx, S, pattern, '#7a7a7a', '#8e8e8e', '#8e8e8e');
  hx.filter = 'blur(1.5px)';
  hx.drawImage(h, 0, 0);
  hx.filter = 'none';
  // Moulded shapes under the paint: a brow ridge, cheekbones, the bridge of the nose
  const swell = (x, y, rx, ry, k) => {
    const g = hx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, `rgba(255,255,255,${k})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    hx.fillStyle = g;
    hx.save();
    hx.translate(x, y);
    hx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    hx.translate(-x, -y);
    hx.fillRect(x - Math.max(rx, ry), y - Math.max(rx, ry), Math.max(rx, ry) * 2, Math.max(rx, ry) * 2);
    hx.restore();
  };
  for (const x of [0.3, 0.7]) {
    swell(S * x, S * 0.27, S * 0.17, S * 0.06, 0.22);
    swell(S * x, S * 0.58, S * 0.13, S * 0.08, 0.16);
  }
  swell(S * 0.5, S * 0.48, S * 0.05, S * 0.16, 0.2);
  // Dark paint round the eye openings, then wear: scratches, chips, grime
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (const x of [S * 0.3, S * 0.7]) {
    ctx.beginPath();
    ctx.ellipse(x, S * 0.4, S * 0.13, S * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  let seed = pattern.length * 97 + base.length * 13 + accent.charCodeAt(1);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 160; i++) {
    const light = rnd() >= 0.5;
    const a = 0.12 + rnd() * 0.3;
    const w = 0.6 + rnd() * 2;
    const x = rnd() * S;
    const y = rnd() * S;
    const dx = (rnd() - 0.5) * 60;
    const dy = (rnd() - 0.5) * 24;
    for (const [g, style] of [[ctx, `rgba(${light ? '235,230,220' : '25,22,18'},${a})`], [hx, `rgba(20,20,20,${a * 1.6})`]]) {
      g.strokeStyle = style;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + dx, y + dy);
      g.stroke();
    }
  }
  for (let i = 0; i < 40; i++) {
    const dark = rnd() < 0.6;
    const a = 0.4 + rnd() * 0.4;
    const args = [rnd() * S, rnd() * S, 2 + rnd() * 6, 1 + rnd() * 4, rnd() * 3, 0, Math.PI * 2];
    for (const [g, style] of [[ctx, `rgba(${dark ? '60,58,54' : '200,196,186'},${a})`], [hx, `rgba(30,30,30,${a})`]]) {
      g.fillStyle = style;
      g.beginPath();
      g.ellipse(...args);
      g.fill();
    }
  }
  // Grime settles low on the mask and in the paint's edges
  const g = ctx.createLinearGradient(0, S * 0.55, 0, S);
  g.addColorStop(0, 'rgba(50,40,30,0)');
  g.addColorStop(1, 'rgba(50,40,30,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  if (eyes) {
    // Eye openings: a dark painted surround, then cut through
    const ey = (1 - eyes.v) * S;
    for (const ex of [0.5 - eyes.u, 0.5 + eyes.u]) {
      ctx.fillStyle = 'rgba(10,10,12,0.85)';
      ctx.beginPath();
      ctx.ellipse(ex * S, ey, eyes.rx * S * 1.35, eyes.ry * S * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'destination-out';
    for (const ex of [0.5 - eyes.u, 0.5 + eyes.u]) {
      ctx.beginPath();
      ctx.ellipse(ex * S, ey, eyes.rx * S, eyes.ry * S, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const bump = new THREE.CanvasTexture(h);
  bump.anisotropy = 8;
  return { map: t, bump };
}

const maskGeoCache = new Map();

/**
 * Builds a face-conforming mask for a model (in the bind pose, at identity): rays from in front
 * of the face measure its depth, which is smoothed into a shell that clears every feature by at
 * least 8 mm, with openings for the eyes. Returns geometry in world (bind) space.
 */
function buildMaskGeometry(avatar, inner, rig) {
  if (maskGeoCache.has(avatar)) return maskGeoCache.get(avatar);
  const face = restMesh(inner, ['head']);
  if (!face) return null;
  const { center, eyeGap, fwd, right } = faceFrame(inner, rig);
  // Depth of the face along a grid in front of it (first surface each ray meets)
  const ray = new THREE.Raycaster();
  const N = 40;
  const W = 0.09; // half-width
  const top = 0.075; // above the eyes
  const bottom = 0.14; // below the eyes
  const ahead = 0.25;
  const raw = [];
  const back = fwd.clone().negate();
  // Rows run from the brow to the chin; each row spans exactly the outline's width there, so the
  // edge is a smooth curve
  const halfAt = (vy) => {
    const yn = vy < 0 ? -vy / bottom : vy / top;
    return vy < 0 ? W * (1 - 0.5 * Math.pow(yn, 2.4)) : W * (1 - 0.3 * Math.pow(yn, 3));
  };
  const rowY = (j) => top - ((top + bottom) * j) / N;
  const colX = (i, j) => halfAt(rowY(j)) * (-1 + (2 * i) / N);
  const at = (i, j) => center.clone().addScaledVector(right, colX(i, j)).addScaledVector(UP, rowY(j));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      ray.set(at(i, j).addScaledVector(fwd, ahead), back);
      const hit = ray.intersectObject(face, false)[0];
      raw.push(hit ? hit.distance : NaN);
    }
  }
  const S = N + 1;
  const idx = (i, j) => j * S + i;
  // Fill gaps by averaging neighbours, then smooth into a shell, then make sure the shell clears
  // every feature (nose, brows, glasses) by at least 8 mm
  let d = raw.map((x) => (Number.isFinite(x) ? x : ahead));
  const known = raw.map(Number.isFinite);
  for (let it = 0; it < 60; it++) {
    const n = d.slice();
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        if (known[idx(i, j)]) continue;
        let sum = 0;
        let cnt = 0;
        for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          if (a < 0 || b < 0 || a > N || b > N) continue;
          sum += d[idx(a, b)];
          cnt++;
        }
        n[idx(i, j)] = sum / cnt;
      }
    }
    d = n;
  }
  const blur = (src, passes) => {
    let a = src;
    for (let p = 0; p < passes; p++) {
      const n = a.slice();
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          let sum = 0;
          let w = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const a2 = i + di;
              const b2 = j + dj;
              if (a2 < 0 || b2 < 0 || a2 > N || b2 > N) continue;
              const k = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
              sum += a[idx(a2, b2)] * k;
              w += k;
            }
          }
          n[idx(i, j)] = sum / w;
        }
      }
      a = n;
    }
    return a;
  };
  let shell = blur(d, 10).map((x) => x - 0.013);
  shell = shell.map((x, k) => Math.min(x, d[k] - 0.008));
  shell = blur(shell, 2);
  shell = shell.map((x, k) => Math.min(x, d[k] - 0.006));
  // Front surface
  const verts = [];
  const uvs = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const p = at(i, j).addScaledVector(fwd, ahead - shell[idx(i, j)]);
      verts.push(p.x, p.y, p.z);
      uvs.push(0.5 - colX(i, j) / (2 * W), 1 - j / N);
    }
  }
  const index = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // Wound to face forward (the grid runs to the wearer's right, i.e. the viewer's left)
      const a = idx(i, j);
      const b = idx(i + 1, j);
      const c = idx(i, j + 1);
      const e = idx(i + 1, j + 1);
      index.push(a, b, c, b, e, c);
    }
  }
  const front = new THREE.BufferGeometry();
  front.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  front.setIndex(index);
  front.computeVertexNormals();
  // A back surface 5 mm in, and a rim joining the two round the edge, so the shell has thickness
  const fn = front.attributes.normal;
  const count = verts.length / 3;
  for (let k = 0; k < count; k++) {
    let nx = fn.getX(k);
    let ny = fn.getY(k);
    let nz = fn.getZ(k);
    if (nx * fwd.x + ny * fwd.y + nz * fwd.z < 0) [nx, ny, nz] = [-nx, -ny, -nz];
    verts.push(verts[k * 3] - nx * 0.005, verts[k * 3 + 1] - ny * 0.005, verts[k * 3 + 2] - nz * 0.005);
    uvs.push(uvs[k * 2], uvs[k * 2 + 1]);
  }
  const nf = index.length;
  for (let t = 0; t < nf; t += 3) index.push(index[t] + count, index[t + 2] + count, index[t + 1] + count);
  const ring = [];
  for (let i = 0; i <= N; i++) ring.push(idx(i, 0));
  for (let j = 1; j <= N; j++) ring.push(idx(N, j));
  for (let i = N - 1; i >= 0; i--) ring.push(idx(i, N));
  for (let j = N - 1; j >= 1; j--) ring.push(idx(0, j));
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r];
    const b = ring[(r + 1) % ring.length];
    index.push(a, a + count, b, b, a + count, b + count);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(index);
  out.computeVertexNormals();
  front.dispose();
  face.geometry.dispose();
  // Where the eye openings fall on the texture
  out.userData.eyes = { u: eyeGap / 2 / (2 * W), v: 1 - (top - 0.003) / (top + bottom), rx: 0.023 / (2 * W), ry: 0.0135 / (top + bottom) };
  maskGeoCache.set(avatar, out);
  return out;
}

const maskMaterials = new Map();
function maskMaterial(look, eyes) {
  const key = JSON.stringify([look, eyes]);
  if (!maskMaterials.has(key)) {
    const { map, bump } = maskTexture(look, eyes);
    const m = new THREE.MeshPhysicalNodeMaterial({ map, bumpMap: bump, bumpScale: 2.5, roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, alphaTest: 0.5 });
    maskMaterials.set(key, m);
  }
  return maskMaterials.get(key);
}

// ------------------------------------------------------------------ fitting things to faces

/**
 * Parts of a model (by material name) skinned into the rest pose in world space, as one mesh to
 * cast rays at. Call with the model at identity.
 */
function restMesh(inner, parts) {
  inner.updateMatrixWorld(true);
  const geos = [];
  const v = new THREE.Vector3();
  inner.traverse((o) => {
    if (!o.isSkinnedMesh || !parts.some((p) => o.material.name.toLowerCase().includes(p))) return;
    const geo = o.geometry;
    const pos = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      o.getVertexPosition(i, v);
      v.applyMatrix4(o.matrixWorld);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(geo.index);
    geos.push(g);
  });
  if (!geos.length) return null;
  const mesh = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Where the face is: between the eyes, which way it looks, and the head's vertical axis. */
function faceFrame(inner, rig, target = null) {
  const eyes = ['Bip01_LEye', 'Bip01_REye'].map((n) => inner.getObjectByName(n)).filter(Boolean);
  const fwd = rig.forward.clone();
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  let center;
  let eyeGap = 0.064;
  if (eyes.length === 2) {
    const a = worldPos(eyes[0]);
    const b = worldPos(eyes[1]);
    center = a.clone().add(b).multiplyScalar(0.5);
    eyeGap = a.distanceTo(b);
  } else center = worldPos(rig.head).addScaledVector(UP, 0.09).addScaledVector(fwd, 0.06);
  // The head's axis: halfway between the face and the back of the skull at eye height
  let axis = center.clone().addScaledVector(fwd, -0.09);
  if (target) {
    const ray = new THREE.Raycaster();
    ray.set(center.clone().addScaledVector(fwd, 0.3), fwd.clone().negate());
    const front = ray.intersectObject(target, false)[0];
    ray.set(center.clone().addScaledVector(fwd, -0.3), fwd);
    const back = ray.intersectObject(target, false)[0];
    if (front && back) axis = front.point.clone().add(back.point).multiplyScalar(0.5);
  }
  return { center, eyeGap, fwd, right, axis };
}

/** Fills the NaN cells of a grid from their neighbours. wrapI: the columns wrap round. */
function fillGrid(d, NI, NJ, fallback, wrapI = false) {
  const idx = (i, j) => j * (NI + 1) + i;
  const known = d.map(Number.isFinite);
  let g = d.map((x) => (Number.isFinite(x) ? x : fallback));
  for (let it = 0; it < 40; it++) {
    const n = g.slice();
    for (let j = 0; j <= NJ; j++) {
      for (let i = 0; i <= NI; i++) {
        if (known[idx(i, j)]) continue;
        let sum = 0;
        let cnt = 0;
        for (let [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
          if (wrapI) a = (a + NI + 1) % (NI + 1);
          if (a < 0 || b < 0 || a > NI || b > NJ) continue;
          sum += g[idx(a, b)];
          cnt++;
        }
        n[idx(i, j)] = sum / cnt;
      }
    }
    g = n;
  }
  return g;
}

function blurGrid(g, NI, NJ, passes, wrapI = false) {
  const idx = (i, j) => j * (NI + 1) + i;
  let a = g;
  for (let p = 0; p < passes; p++) {
    const n = a.slice();
    for (let j = 0; j <= NJ; j++) {
      for (let i = 0; i <= NI; i++) {
        let sum = 0;
        let w = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            let a2 = i + di;
            const b2 = j + dj;
            if (wrapI) a2 = (a2 + NI + 1) % (NI + 1);
            if (a2 < 0 || b2 < 0 || a2 > NI || b2 > NJ) continue;
            const k = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
            sum += a[idx(a2, b2)] * k;
            w += k;
          }
        }
        n[idx(i, j)] = sum / w;
      }
    }
    a = n;
  }
  return a;
}

/** A grid of points as an indexed mesh, with normals pointing away from the head's axis. */
function gridMesh(points, uvs, NI, NJ, axis) {
  const idx = (i, j) => j * (NI + 1) + i;
  const index = [];
  for (let j = 0; j < NJ; j++) {
    for (let i = 0; i < NI; i++) index.push(idx(i, j), idx(i + 1, j), idx(i, j + 1), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let k = 0; k < n.count; k++) {
    const rx = points[k * 3] - axis.x;
    const ry = points[k * 3 + 1] - axis.y;
    const rz = points[k * 3 + 2] - axis.z;
    if (n.getX(k) * rx + n.getY(k) * ry + n.getZ(k) * rz < 0) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
  }
  return g;
}

const bandanaGeoCache = new Map();

/**
 * A bandana tied over the lower face: it wraps round the head from the bridge of the nose down,
 * pulled taut across the nose and cheeks, hanging from the chin to a point at the front.
 */
function buildBandanaGeometry(avatar, inner, rig) {
  if (bandanaGeoCache.has(avatar)) return bandanaGeoCache.get(avatar);
  const target = restMesh(inner, ['head', 'body']);
  const head = restMesh(inner, ['head']);
  if (!target || !head) return null;
  const { center, fwd, right, axis } = faceFrame(inner, rig, head);
  const NI = 44;
  const NJ = 26;
  const TM = 1.95; // wraps ±112° round from the front
  const yTop = center.y - 0.024;
  const yBot = center.y - 0.205;
  const th = (i) => -TM + (2 * TM * i) / NI;
  const edge = (t) => yBot + 0.08 * Math.min(1, Math.abs(t) / TM) ** 0.85;
  const yAt = (i, j) => yTop + (edge(th(i)) - yTop) * (j / NJ);
  const dirOf = (t) => fwd.clone().multiplyScalar(Math.cos(t)).addScaledVector(right, Math.sin(t));
  const ray = new THREE.Raycaster();
  const R = 0.3;
  const raw = [];
  for (let j = 0; j <= NJ; j++) {
    for (let i = 0; i <= NI; i++) {
      const d = dirOf(th(i));
      ray.set(new THREE.Vector3(axis.x, yAt(i, j), axis.z).addScaledVector(d, R), d.clone().negate());
      const hit = ray.intersectObject(target, false)[0];
      raw.push(hit ? R - hit.distance : NaN);
    }
  }
  const idx = (i, j) => j * (NI + 1) + i;
  const face = fillGrid(raw, NI, NJ, 0.09);
  const r = face.map((x) => x + 0.007);
  // Taut across the face: the cloth can't dip into the hollows beside the nose...
  for (let j = 0; j <= NJ; j++) {
    for (let i = 1; i <= NI; i++) r[idx(i, j)] = Math.max(r[idx(i, j)], r[idx(i - 1, j)] - 0.005);
    for (let i = NI - 1; i >= 0; i--) r[idx(i, j)] = Math.max(r[idx(i, j)], r[idx(i + 1, j)] - 0.005);
  }
  // ...and below the nose and chin it hangs, falling inward slowly, never flaring out
  for (let i = 0; i <= NI; i++) {
    for (let j = 1; j <= NJ; j++) {
      const dy = yAt(i, j - 1) - yAt(i, j);
      const prev = r[idx(i, j - 1)];
      r[idx(i, j)] = Math.min(Math.max(r[idx(i, j)], prev - dy * 0.4), prev + 0.003);
    }
  }
  const shell = blurGrid(r, NI, NJ, 2).map((x, k) => Math.max(x, face[k] + 0.005));
  const points = [];
  const uvs = [];
  for (let j = 0; j <= NJ; j++) {
    for (let i = 0; i <= NI; i++) {
      const p = new THREE.Vector3(axis.x, yAt(i, j), axis.z).addScaledVector(dirOf(th(i)), shell[idx(i, j)]);
      points.push(p.x, p.y, p.z);
      uvs.push(i / NI, 1 - j / NJ);
    }
  }
  const g = gridMesh(points, uvs, NI, NJ, new THREE.Vector3(axis.x, center.y - 0.1, axis.z));
  target.geometry.dispose();
  head.geometry.dispose();
  bandanaGeoCache.set(avatar, g);
  return g;
}

const capGeoCache = new Map();

/** A ball cap: a crown shaped over the top of the head and a curved brim at the front. */
function buildCapGeometry(avatar, inner, rig) {
  if (capGeoCache.has(avatar)) return capGeoCache.get(avatar);
  const target = restMesh(inner, ['head']);
  if (!target) return null;
  const { center, fwd, right, axis } = faceFrame(inner, rig, target);
  const C = new THREE.Vector3(axis.x, center.y + 0.03, axis.z);
  const NI = 48;
  const NJ = 16;
  const th = (i) => -Math.PI + (2 * Math.PI * i) / NI;
  const horiz = (t) => fwd.clone().multiplyScalar(Math.cos(t)).addScaledVector(right, Math.sin(t));
  const dirOf = (t, p) => UP.clone().multiplyScalar(Math.cos(p)).addScaledVector(horiz(t), Math.sin(p));
  // The band sits just above the brows at the front, lower over the ears and at the back
  const cut = (t) => center.y + 0.012 + 0.04 * (Math.cos(t) * 0.5 + 0.5);
  const ray = new THREE.Raycaster();
  const R = 0.35;
  const cast = (t, p) => {
    const d = dirOf(t, p);
    ray.set(C.clone().addScaledVector(d, R), d.clone().negate());
    const hit = ray.intersectObject(target, false)[0];
    return hit ? R - hit.distance : NaN;
  };
  // How far down each column reaches before it meets the band
  const pEnd = [];
  for (let i = 0; i <= NI; i++) {
    const rh = cast(th(i), Math.PI / 2) || 0.1;
    pEnd.push(Math.acos(THREE.MathUtils.clamp((cut(th(i)) - C.y) / (rh + 0.012), -1, 1)));
  }
  const raw = [];
  for (let j = 0; j <= NJ; j++) for (let i = 0; i <= NI; i++) raw.push(cast(th(i), (pEnd[i] * j) / NJ));
  const head = fillGrid(raw, NI, NJ, 0.1, true);
  // A smooth crown over the hair, never inside the head
  const shell = blurGrid(head, NI, NJ, 3, true).map((x, k) => Math.max(x, head[k]) + 0.008);
  const idx = (i, j) => j * (NI + 1) + i;
  const at = (i, j) => C.clone().addScaledVector(dirOf(th(i), (pEnd[i] * j) / NJ), shell[idx(i, j)]);
  const points = [];
  const uvs = [];
  for (let j = 0; j <= NJ; j++) {
    for (let i = 0; i <= NI; i++) {
      const p = at(i, j);
      points.push(p.x, p.y, p.z);
      uvs.push((i / NI) * 0.98, 0.3 + 0.7 * (1 - j / NJ));
    }
  }
  const crown = gridMesh(points, uvs, NI, NJ, C);
  // The brim: from the front of the band, out and slightly down, curved across
  const bp = [];
  const bu = [];
  const cols = [];
  for (let i = 0; i <= NI; i++) if (Math.abs(th(i)) <= 0.9) cols.push(i);
  for (const [k, i] of cols.entries()) {
    const e = at(i, NJ);
    const h = horiz(th(i));
    // Longest at the front, rounding off toward the sides
    const len = 0.078 * Math.max(0, Math.cos(th(i) * 1.6)) ** 0.5;
    for (const [s, drop] of [[0, 0], [0.5, 0.008], [1, 0.024]]) {
      const p = e.clone().addScaledVector(h, len * s).addScaledVector(UP, -drop);
      bp.push(p.x, p.y, p.z);
      bu.push(k / (cols.length - 1), 0.02 + 0.2 * s);
    }
  }
  const bIndex = [];
  for (let k = 0; k < cols.length - 1; k++) {
    for (let s = 0; s < 2; s++) {
      const a = k * 3 + s;
      const b = (k + 1) * 3 + s;
      bIndex.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const brim = new THREE.BufferGeometry();
  brim.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  brim.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
  brim.setIndex(bIndex);
  brim.computeVertexNormals();
  const nb = brim.attributes.normal;
  for (let k = 0; k < nb.count; k++) if (nb.getY(k) < 0) nb.setXYZ(k, -nb.getX(k), -nb.getY(k), -nb.getZ(k));
  const g = mergeGeometries([crown, brim]);
  target.geometry.dispose();
  capGeoCache.set(avatar, g);
  return g;
}

/**
 * Bandana prints: paisley (red, navy, black), plain olive, or a printed skull jaw. u runs round
 * the head with the front at 0.5; v from the nose down.
 */
function bandanaTexture(style) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const base = { red: '#9c1e18', navy: '#1c2848', black: '#141416', olive: '#4c4e36', skull: '#0e0e10' }[style] || '#9c1e18';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  let seed = style.length * 131 + 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (style === 'red' || style === 'navy' || style === 'black') {
    // Paisley teardrops with dots, and a border of dots
    ctx.strokeStyle = ctx.fillStyle = 'rgba(240,236,226,0.85)';
    ctx.lineWidth = 2;
    for (let y = 18; y < H; y += 46) {
      for (let x = Math.round(y / 46) % 2 ? 0 : 23; x < W + 40; x += 46) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd() * 6.28);
        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.bezierCurveTo(12, -10, 12, 8, 0, 10);
        ctx.bezierCurveTo(-9, 8, -8, -4, 4, -2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(1, 3, 3, 0, 6.28);
        ctx.fill();
        ctx.restore();
        for (let k = 0; k < 3; k++) {
          ctx.beginPath();
          ctx.arc(x + 14 + rnd() * 10, y + 14 + rnd() * 10, 1.4, 0, 6.28);
          ctx.fill();
        }
      }
    }
    for (let x = 4; x < W; x += 9) {
      ctx.beginPath();
      ctx.arc(x, H - 6, 2, 0, 6.28);
      ctx.fill();
    }
  } else if (style === 'olive') {
    ctx.fillStyle = 'rgba(20,20,12,0.35)';
    for (let i = 0; i < 400; i++) ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  } else if (style === 'skull') {
    // A printed skull's lower half: nose cavity, cheekbones, two rows of teeth, the jaw
    const cx = W / 2;
    ctx.fillStyle = ctx.strokeStyle = '#e9e4d8';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx, H * 0.05);
    ctx.lineTo(cx - 14, H * 0.2);
    ctx.lineTo(cx, H * 0.24);
    ctx.lineTo(cx + 14, H * 0.2);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 6;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 30, H * 0.12);
      ctx.quadraticCurveTo(cx + s * 70, H * 0.2, cx + s * 66, H * 0.42);
      ctx.stroke();
    }
    for (let k = -4; k <= 4; k++) {
      const x = cx + k * 11;
      ctx.fillRect(x - 4.5, H * 0.33, 9, H * 0.13);
      ctx.fillRect(x - 4.5, H * 0.49, 9, H * 0.12);
    }
    ctx.beginPath();
    ctx.moveTo(cx - 66, H * 0.42);
    ctx.quadraticCurveTo(cx - 60, H * 0.82, cx, H * 0.86);
    ctx.quadraticCurveTo(cx + 60, H * 0.82, cx + 66, H * 0.42);
    ctx.stroke();
  }
  // Creases and wear
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.06 + rnd() * 0.1})`;
    ctx.lineWidth = 1 + rnd() * 3;
    const x = rnd() * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rnd() - 0.5) * 30, H);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Cap cloth: one colour, with the crown's panel seams and rows of stitching on the brim. */
function capTexture(hex) {
  const W = 512;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    const x = ((k + 0.5) / 6) * W * 0.98;
    ctx.beginPath();
    ctx.moveTo(x, H * 0.3);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let y = 8; y < H * 0.22; y += 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const wearMaterials = new Map();
/** Cloth headwear, lit like the people wearing it. */
function wearMaterial(key, make) {
  if (!wearMaterials.has(key)) {
    const m = new THREE.MeshStandardNodeMaterial({ map: make(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    m.emissiveNode = rimAndFlash();
    wearMaterials.set(key, m);
  }
  return wearMaterials.get(key);
}

// ------------------------------------------------------------------ loading

let clips = null;
const sceneCache = new Map();

/** Every avatar a theme's cast uses. */
function castOf(theme) {
  const looks = [...(GUNMEN[theme] || GUNMEN.desert), ...(SHOTGUNNERS[theme] || SHOTGUNNERS.desert), ...Object.values(TACTICAL)];
  return [...new Set([...Object.values(ROLES).map((r) => r.avatar), ...looks.map((l) => l.avatar)])];
}

/** Everything people need for a theme: models, clips and guns. */
export async function preloadPeople(theme) {
  const avatars = castOf(theme);
  const [c, ...glbs] = await Promise.all([loadClips(), ...avatars.map((a) => loadGLB(`characters/${a}.glb`)), preloadGuns()]);
  clips = c;
  avatars.forEach((a, i) => sceneCache.set(a, glbs[i].scene));
  return avatars.length;
}

/**
 * A person, ready to pose. role: 'hatch' | 'cruz' | 'hostage' | { enemy: type, theme, seed };
 * look: mask { pattern, base, accent } for the contractors.
 */
export function createPerson(role, { look = null, camo } = {}) {
  const spec = { ...(typeof role === 'string' ? ROLES[role] : enemyRole(role.enemy, role.theme, role.seed ?? 0)) };
  if (camo !== undefined) spec.camo = camo;
  const src = loadedScene(spec.avatar);
  const inner = cloneSkinned(src);
  const meshes = [];
  inner.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name.toLowerCase();
    // Hair cards go under a cap
    if (spec.hide.some((h) => name.includes(h)) || (spec.cap && name.includes('opacity'))) {
      o.visible = false;
      return;
    }
    o.material = materialFor(spec.avatar, o.material, spec.camo);
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // skinned bounds don't follow the pose
    meshes.push(o);
  });
  const rig = new Rig(inner, 'biped');
  const outer = new THREE.Group();
  outer.add(inner);
  // Masks are built at rest, then ride on the head bone
  if (spec.mask && look) {
    const g = buildMaskGeometry(spec.avatar, inner, rig);
    if (g) {
      const mask = new THREE.Mesh(g, maskMaterial(look, g.userData.eyes));
      mask.castShadow = true;
      rig.head.attach(mask);
      meshes.push(mask);
    }
  }
  // Bandanas and caps, likewise
  const wear = (geo, mat) => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    rig.head.attach(mesh);
    meshes.push(mesh);
  };
  if (spec.bandana) wear(buildBandanaGeometry(spec.avatar, inner, rig), wearMaterial(`bandana:${spec.bandana}`, () => bandanaTexture(spec.bandana)));
  if (spec.cap) wear(buildCapGeometry(spec.avatar, inner, rig), wearMaterial(`cap:${spec.cap}`, () => capTexture(spec.cap)));
  inner.rotation.y = rig.yawOffset;
  if (spec.scale) inner.scale.multiplyScalar(spec.scale);
  const guns = {};
  for (const [weapon, kind] of Object.entries(spec.guns)) guns[weapon] = makeGun(kind);
  const person = {
    role,
    spec,
    outer,
    inner,
    rig,
    guns,
    meshes,
    state: { flash: 0 },
    animator: null,
  };
  for (const m of meshes) m.userData.person = person.state;
  const gunFor = (a) => guns[a.weapon] || guns.main || null;
  person.animator = new Animator({ outer, inner, rig }, clips, { guns, gunFor, scale: spec.scale || 1 });
  return person;
}

function loadedScene(avatar) {
  const s = sceneCache.get(avatar);
  if (!s) throw new Error(`${avatar} not preloaded`);
  return s;
}

export { HEAVY };
