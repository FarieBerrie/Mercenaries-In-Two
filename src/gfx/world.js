// The level's static world, dressed for its theme: a whole open map. The ground is three
// photo-scanned surfaces laid out by a painted mask (open ground, paving, roads); the buildings,
// walls and rocks come from structures.js; cover is scanned props fitted to each box; dressing.js
// adds the life and the country beyond the edges. Geometry is merged per material and props are
// instanced, chunk by chunk, so what's out of view costs nothing.
import * as THREE from 'three/webgpu';
import { color, float, normalMap, positionWorld, mx_noise_float, time, vec2 } from 'three/tsl';
import { createRng } from '../rng.js';
import { loadGLB, loadSurface } from './assets.js';
import { Batch, CHUNK, Props } from './batch.js';
import { dressBackdrop, dressMap } from './dressing.js';
import { buildGrass, buildPines } from './foliage.js';
import { groundMaterial, plainMaterial, rockMaterial, surfaceMaterial } from './materials.js';
import { buildStructures, snowCap } from './structures.js';
import { buildTerrain } from './terrain.js';
import { buildLitter, buildPalms, signMaterial } from './town.js';

/** Surfaces each theme needs. */
export const THEME_SURFACES = {
  desert: ['cobblestone_floor_08', 'stony_dirt_path', 'dense_sand', 'sandstone_cracks', 'white_stucco_02', 'red_plaster_weathered', 'blue_plaster_weathered', 'yellow_plaster_02', 'damaged_plaster', 'clay_roof_tiles_02', 'palm_tree_bark', 'worn_corrugated_iron', 'concrete_wall_008', 'weathered_planks', 'hessian_230', 'metal_plate', 'rusty_metal_02', 'rusty_metal_shutter'],
  port: ['asphalt_02', 'concrete_floor_worn_001', 'container_side', 'corrugated_iron_02', 'rusty_corrugated_iron', 'worn_corrugated_iron', 'rusty_metal_shutter', 'concrete_wall_008', 'weathered_planks', 'metal_plate', 'rusty_metal_02', 'hessian_230'],
  snow: ['snow_02', 'asphalt_snow', 'rock_face', 'concrete_wall_008', 'worn_corrugated_iron', 'container_side', 'weathered_planks', 'hessian_230', 'metal_plate', 'rusty_metal_02', 'rusty_metal_shutter'],
};

/** Props each theme places. */
export const THEME_PROPS = {
  desert: ['wooden_military_crate', 'old_military_crate', 'Barrel_01', 'Barrel_02', 'barrel_03', 'concrete_road_barrier_02', 'covered_car', 'metal_jerrycan', 'old_tyre', 'cardboard_box_01', 'exterior_aircon_unit', 'street_lamp_01', 'quiver_tree_02', 'dead_quiver_trunk', 'shrub_02', 'shrub_03', 'shrub_04', 'dry_branches_medium_01', 'namaqualand_boulder_02', 'namaqualand_boulder_03', 'propane_tank', 'ammo_box'],
  port: ['wooden_crate_01', 'wooden_crate_02', 'Barrel_01', 'Barrel_02', 'barrel_03', 'concrete_road_barrier', 'concrete_road_barrier_02', 'plastic_crate_01', 'industrial_pastic_container', 'cardboard_box_01', 'old_tyre', 'metal_trash_can', 'trashbag', 'fire_hydrant', 'utility_box_01', 'power_box_01', 'security_light', 'street_lamp_01', 'hand_truck', 'propane_tank', 'small_lpg_tank', 'lifebuoy', 'covered_car', 'exterior_aircon_unit'],
  snow: ['wooden_military_crate', 'old_military_crate', 'Barrel_01', 'barrel_03', 'concrete_road_barrier_02', 'boulder_01', 'namaqualand_boulder_02', 'rock_07', 'rock_09', 'metal_jerrycan_green', 'portable_generator', 'old_military_compressor', 'portable_searchlight', 'street_lamp_01', 'dead_tree_trunk', 'covered_car', 'ammo_box', 'exterior_aircon_unit'],
};

const TARPS = ['#e8f0c0', '#ffffff', '#c8dcf0', '#f8e8c8', '#e0e0e4'];
const AWNINGS = ['#a83a2a', '#d8c8a0', '#2a6a7a', '#c88a2a', '#5a6a3a', '#7a3a6a'];

// ------------------------------------------------------------------ materials per theme

/** The theme's surface materials, by key. S: loaded surfaces by id. */
function themeMaterials(theme, S) {
  const wet = theme === 'port';
  const snow = theme === 'snow' ? { set: S.snow_02 } : null;
  const M = {};
  const v = (m) => {
    m.vertexColors = true;
    return m;
  };
  if (theme === 'desert') {
    M.plaster_white = v(surfaceMaterial(S.white_stucco_02, { scale: 2.5, grime: 2.2, variation: 0.14 }));
    M.plaster_red = v(surfaceMaterial(S.red_plaster_weathered, { scale: 3, grime: 2.2, variation: 0.14 }));
    M.plaster_blue = v(surfaceMaterial(S.blue_plaster_weathered, { scale: 3, grime: 2.2, variation: 0.14 }));
    M.plaster_yellow = v(surfaceMaterial(S.yellow_plaster_02, { scale: 3, grime: 2.2, variation: 0.14 }));
    M.plaster_damaged = v(surfaceMaterial(S.damaged_plaster, { scale: 3, grime: 2.2, variation: 0.12 }));
    M.wall = M.plaster_white;
    M.roof_tiles = v(surfaceMaterial(S.clay_roof_tiles_02, { scale: 2, variation: 0.18 }));
    M.signs = signMaterial();
    M.rock = v(rockMaterial(S.sandstone_cracks, { scale: 5 }));
  } else if (theme === 'port') {
    M.wall = v(surfaceMaterial(S.corrugated_iron_02, { scale: 2.5, grime: 1.2, wet, blend: { set: S.rusty_corrugated_iron, scale: 2.5, amount: 0.35, noise: 0.15 } }));
  } else {
    M.wall = v(surfaceMaterial(S.concrete_wall_008, { scale: 3, grime: 1.4, snow }));
    M.rock = v(rockMaterial(S.rock_face, { scale: 6, snow: true }));
  }
  if (S.container_side) M.container = v(surfaceMaterial(S.container_side, { scale: 2.6, wet, snow, recolor: true, variation: 0.1 }));
  M.tin = v(surfaceMaterial(S.worn_corrugated_iron, { scale: 2.2, wet, snow, variation: 0.15 }));
  M.concrete = v(surfaceMaterial(S.concrete_wall_008, { scale: 2.5, grime: 0.8, wet, snow }));
  M.wood = v(surfaceMaterial(S.weathered_planks, { scale: 1.6, wet, snow, variation: 0.1 }));
  M.sack = v(surfaceMaterial(S.hessian_230, { scale: 0.7, wet, snow, variation: 0.1 }));
  M.metal = v(surfaceMaterial(S.rusty_metal_02, { scale: 1.5, wet, snow }));
  M.plate = v(surfaceMaterial(S.metal_plate, { scale: 1.2, wet, snow }));
  M.shutter = v(surfaceMaterial(S.rusty_metal_shutter, { scale: 2.2, wet, snow }));
  M.paint = v(plainMaterial('#ffffff', { roughness: 0.55, metalness: 0.1 }));
  M.rubber = v(plainMaterial('#ffffff', { roughness: 0.9 }));
  M.glass = v(plainMaterial('#ffffff', { roughness: 0.08, metalness: 0.4 }));
  M.dark = v(plainMaterial('#ffffff', { roughness: 0.95 }));
  M.fence = fenceMaterial();
  M.glow = (() => {
    const m = new THREE.MeshBasicNodeMaterial();
    m.vertexColors = true;
    m.colorNode = color('#ffffff').mul(theme === 'port' ? 6 : 4);
    return m;
  })();
  return M;
}

/** Chain-link: a diamond mesh of galvanised wire, cut out of the panel. */
function fenceMaterial() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.strokeStyle = '#d8dcdc';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, S / 2);
  g.lineTo(S / 2, 0);
  g.lineTo(S, S / 2);
  g.lineTo(S / 2, S);
  g.closePath();
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.MeshStandardNodeMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  m.vertexColors = true;
  return m;
}

// ------------------------------------------------------------------ the ground

/** Paints where the map is paved (green) and where its roads run (red), softened at the edges. */
function groundMask(level) {
  const b = level.bounds;
  const PX = 2;
  const W = Math.ceil((b.x1 - b.x0) * PX);
  const H = Math.ceil((b.z1 - b.z0) * PX);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  const rect = (r, col, grow = 0) => {
    g.fillStyle = col;
    g.fillRect((r.x0 - grow - b.x0) * PX, (r.z0 - grow - b.z0) * PX, (r.x1 - r.x0 + 2 * grow) * PX, (r.z1 - r.z0 + 2 * grow) * PX);
  };
  const theme = level.theme;
  for (const r of level.roads) {
    if (theme === 'desert') {
      if (r.kind === 'street' || r.kind === 'plaza') rect(r, 'rgb(0,255,0)', 0.6);
      else rect(r, 'rgb(255,0,0)', 0.4);
    } else if (theme === 'port') {
      if (r.kind === 'quay' || r.kind === 'yard') rect(r, 'rgb(0,255,0)');
      else rect(r, 'rgb(255,0,0)', 0.3);
    } else rect(r, 'rgb(255,0,0)', 0.5);
  }
  for (const y of level.yards) if (y.kind === 'courtyard' || y.kind === 'lot') rect(y, 'rgba(255,0,0,0.55)');
  for (const a of level.areas) {
    if (theme === 'port') rect(a, 'rgba(0,255,0,0.8)', 8);
    else if (theme === 'snow' && a.index >= 2) rect(a, 'rgba(0,255,0,0.6)');
    else if (theme === 'desert' && a.index >= 2) rect(a, 'rgba(255,0,0,0.45)');
  }
  // Soft edges, frayed further by noise in the shader
  const s = document.createElement('canvas');
  s.width = W;
  s.height = H;
  const sg = s.getContext('2d');
  sg.filter = 'blur(3px)';
  sg.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(s);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function buildGround(level, S) {
  const b = level.bounds;
  const theme = level.theme;
  const mask = groundMask(level);
  let layers;
  if (theme === 'desert') {
    layers = {
      base: { set: S.dense_sand, scale: 4, blend: { set: S.stony_dirt_path, scale: 3.4, amount: 0.38, noise: 0.05 } },
      paved: { set: S.cobblestone_floor_08, scale: 2.6, blend: { set: S.stony_dirt_path, scale: 3.2, amount: 0.55, noise: 0.05, soft: 0.16 } },
      road: { set: S.stony_dirt_path, scale: 3.4, tint: '#ecd4b2', blend: { set: S.dense_sand, scale: 4, amount: 0.45, noise: 0.07 } },
    };
  } else if (theme === 'port') {
    layers = {
      base: { set: S.asphalt_02, scale: 4, blend: { set: S.concrete_floor_worn_001, scale: 3, amount: 0.25, noise: 0.03 } },
      paved: { set: S.concrete_floor_worn_001, scale: 3, blend: { set: S.asphalt_02, scale: 4, amount: 0.2, noise: 0.04 } },
      road: { set: S.asphalt_02, scale: 3.5, tint: '#c8c8c8' },
    };
  } else {
    layers = {
      base: { set: S.snow_02, scale: 3, blend: { set: S.asphalt_snow, scale: 3, amount: 0.12, noise: 0.04 } },
      paved: { set: S.asphalt_snow, scale: 3, blend: { set: S.snow_02, scale: 3, amount: 0.45, noise: 0.05 } },
      road: { set: S.asphalt_snow, scale: 3 },
    };
  }
  const mat = groundMaterial(layers, mask, b, { wet: theme === 'port', snow: theme === 'snow' ? { set: S.snow_02, amount: 0.35 } : null, variation: theme === 'snow' ? 0.08 : 0.22 });
  // The port's land stops at the quay; elsewhere the ground runs out under the hills
  const [x0, x1, z0, z1] = theme === 'port' ? [b.x0 - 420, b.x1 + 0.8, b.z0 - 420, b.z1 + 0.8] : [b.x0 - 40, b.x1 + 40, b.z0 - 40, b.z1 + 40];
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const ground = new THREE.Mesh(geo, mat);
  ground.receiveShadow = true;
  ground.name = 'ground';
  return ground;
}

// ------------------------------------------------------------------ the builder

/**
 * Loads what a theme needs (surfaces and props). Call before buildWorld for that theme.
 */
export async function preloadWorld(theme) {
  const ids = THEME_SURFACES[theme];
  const props = THEME_PROPS[theme];
  const [surfaces, scenes] = await Promise.all([
    Promise.all(ids.map(async (id) => [id, await loadSurface(id)])),
    Promise.all(props.map(async (id) => [id, (await loadGLB(`props/${id}.glb`)).scene])),
  ]);
  return { surfaces: Object.fromEntries(surfaces), scenes: Object.fromEntries(scenes) };
}

/** Builds instanced plants a chunk at a time, so the forest out of view isn't drawn. */
function chunkedPlants(spots, build, { shadows = true } = {}) {
  const group = new THREE.Group();
  const byChunk = new Map();
  for (const s of spots) {
    const k = `${Math.floor(s.x / CHUNK)},${Math.floor(s.z / CHUNK)}`;
    if (!byChunk.has(k)) byChunk.set(k, []);
    byChunk.get(k).push(s);
  }
  for (const list of byChunk.values()) {
    const g = build(list);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = shadows;
    });
    group.add(g);
  }
  return group;
}

/**
 * Builds the world for a level. assets: from preloadWorld; opts: { detail, lit } (lit: night,
 * windows and lamps glow). Returns { group, gates, targets, pads, lamps, fires, smokes, height, update }.
 */
export function buildWorld(level, assets, { detail = 1, lit = false } = {}) {
  const { surfaces: S, scenes } = assets;
  const theme = level.theme;
  const rng = createRng(level.missionIndex * 31 + 5);
  const group = new THREE.Group();
  const B = new Batch();
  const back = new Batch(); // far scenery: no shadows
  const P = new Props();
  const PB = new Props(); // far props: no shadows
  const gates = new Map();
  const targets = [];
  const pads = [];
  const lamps = [];
  const blinkers = [];
  const spinners = [];
  const M = themeMaterials(theme, S);
  const ctx = { B, back, P, PB, rng, lamps, detail, lit, theme, M };

  group.add(buildGround(level, S));
  let height = () => 0;
  if (theme !== 'port') {
    const t = buildTerrain(level, S);
    group.add(t.mesh);
    height = t.height;
  }

  buildStructures(ctx, level, { group, gates, targets, blinkers, spinners });
  for (const b of level.boxes) if (b.kind === 'cover') coverProp(ctx, b);

  // ---- extraction pads
  for (const a of level.areas) {
    if (!a.extract) continue;
    const pad = new THREE.Mesh(new THREE.CircleGeometry(4.2, 48).rotateX(-Math.PI / 2), padMaterial());
    pad.position.set(a.extract.x, 0.02, a.extract.z);
    pad.receiveShadow = true;
    group.add(pad);
    const lights = new Batch();
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      lights.cyl('glow', a.extract.x + Math.cos(ang) * 4.4, 0, a.extract.z + Math.sin(ang) * 4.4, 0.12, 0.09, '#40ff80');
    }
    const lm = lights.meshes(M, { shadows: false, chunked: false })[0];
    lm.visible = false;
    group.add(lm);
    pads.push({ area: a.index, lights: lm, x: a.extract.x, z: a.extract.z });
  }

  // ---- the life of the place, and the country round it
  const spots = { palms: [], pines: [], grass: [], litter: [] };
  const { fires, smokes } = dressMap(ctx, level, spots);
  const inner = { palms: spots.palms.length, pines: spots.pines.length, grass: spots.grass.length };
  dressBackdrop(ctx, level, height, spots);

  // ---- water round the port
  if (theme === 'port') {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), waterMaterial());
    water.position.set((level.bounds.x0 + level.bounds.x1) / 2, -1.2, (level.bounds.z0 + level.bounds.z1) / 2);
    group.add(water);
  }

  for (const m of B.meshes(M)) group.add(m);
  for (const m of back.meshes(M, { shadows: false, chunked: false })) group.add(m);
  group.add(P.build(scenes, { weather: theme === 'port' ? 'wet' : theme === 'snow' ? 'snow' : null }));
  group.add(PB.build(scenes, { shadows: false, weather: theme === 'port' ? 'wet' : theme === 'snow' ? 'snow' : null }));
  // Mostly paper, cans and rags; the odd oil stain (more of them on the docks)
  const litter = buildLitter(rng, spots.litter, { kinds: theme === 'port' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 0, 2, 4, 9] });
  if (litter) group.add(litter);
  // Plants in the map cast shadows; the ones out on the hills don't need to
  const split = (list, n, build) => {
    if (n) group.add(chunkedPlants(list.slice(0, n), build));
    if (list.length > n) {
      const far = build(list.slice(n));
      far.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
      group.add(far);
    }
  };
  split(spots.pines, inner.pines, (l) => buildPines(l, { bark: null, snow: theme === 'snow' }));
  split(spots.grass, inner.grass, (l) => buildGrass(l));
  if (S.palm_tree_bark) split(spots.palms, inner.palms, (l) => buildPalms(l, S.palm_tree_bark));

  return {
    group,
    gates,
    targets,
    pads,
    lamps,
    fires,
    smokes,
    height,
    update(t, game) {
      for (const s of spinners) if (!s.stopped) s.pivot.rotation.y = t * s.rate;
      for (const b of blinkers) b.mesh.visible = Math.sin(t * b.rate * 60) > 0;
      for (const p of pads) p.lights.visible = !!game?.allClear && Math.sin(t * 6 + p.x) > -0.3;
    },
  };
}

// ------------------------------------------------------------------ cover

/** Fills a cover box with the real thing: crates, sandbags, barriers, cars, drums and the rest. */
function coverProp(ctx, b) {
  const { B, P, rng, theme } = ctx;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const lx = b.x1 - b.x0;
  const lz = b.z1 - b.z0;
  const h = b.y1;
  const along = lx >= lz;
  const barrel = () => (theme === 'desert' ? rng.pick(['Barrel_01', 'Barrel_02', 'barrel_03']) : theme === 'port' ? rng.pick(['Barrel_01', 'Barrel_02']) : rng.pick(['Barrel_01', 'barrel_03']));
  switch (b.style) {
    case 'crate':
      stack(ctx, b, theme === 'port' ? 'wooden_crate_02' : 'wooden_military_crate', theme === 'port' ? [0.53, 0.46, 1.16] : [1.24, 0.46, 0.52]);
      break;
    case 'sandbags':
      sandbags(ctx, b);
      break;
    case 'barrier': {
      const len = along ? lx : lz;
      const id = theme === 'port' && rng.chance(0.5) ? 'concrete_road_barrier' : 'concrete_road_barrier_02';
      const [mx, my, mz] = id === 'concrete_road_barrier' ? [1.54, 0.83, 0.64] : [1.56, 1.11, 0.44];
      const n = Math.max(1, Math.round(len / mx));
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (i + 0.5) * (len / n);
        P.place(id, along ? cx + t : cx, 0, along ? cz : cz + t, { ry: along ? 0 : Math.PI / 2, sx: len / n / mx, sy: h / my, sz: (along ? lz : lx) / mz });
      }
      snowCap(ctx, b.x0, b.x1, h, b.z0, b.z1);
      break;
    }
    case 'car':
      P.place('covered_car', cx, 0, cz, { ry: along ? Math.PI / 2 : 0, sx: (along ? lz : lx) / 1.78, sy: h / 1.39, sz: (along ? lx : lz) / 4.38, tint: rng.pick(TARPS) });
      snowCap(ctx, b.x0 + 0.4, b.x1 - 0.4, h, b.z0 + 0.3, b.z1 - 0.3);
      break;
    case 'drums':
      for (const [dx, dz] of [[-0.33, -0.33], [0.36, -0.3], [0.02, 0.36]]) {
        const id = barrel();
        const hh = id === 'barrel_03' ? 0.93 : 0.88;
        P.place(id, cx + dx, 0, cz + dz, { ry: rng.range(0, 6), s: (h / hh) * 0.98 });
      }
      snowCap(ctx, b.x0 + 0.2, b.x1 - 0.2, h, b.z0 + 0.2, b.z1 - 0.2);
      break;
    case 'pallets': {
      for (let y = 0; y < 0.42; y += 0.14) {
        B.box('wood', b.x0, b.x1, y, y + 0.03, b.z0, b.z1, '#c8a878');
        for (const z of [b.z0 + 0.06, cz, b.z1 - 0.06]) B.box('wood', b.x0, b.x1, y + 0.03, y + 0.12, z - 0.06, z + 0.06, '#a88858');
      }
      // One big load on the pallet, not a pile of small boxes
      const plastic = rng.chance(0.5);
      const id = plastic ? 'industrial_pastic_container' : 'wooden_crate_02';
      const [mx, my, mz] = plastic ? [0.48, 0.42, 0.63] : [0.53, 0.46, 1.16];
      P.place(id, cx, 0.42, cz, { ry: along ? Math.PI / 2 : 0, sx: ((along ? lz : lx) - 0.1) / mx, sy: (h - 0.42) / my, sz: ((along ? lx : lz) - 0.1) / mz });
      break;
    }
    case 'forklift':
      forklift(B, b);
      break;
    case 'rocks': {
      const ids = theme === 'snow' ? ['boulder_01', 'namaqualand_boulder_02'] : ['namaqualand_boulder_02', 'namaqualand_boulder_03'];
      const id = rng.pick(ids);
      const dims = { boulder_01: [1.26, 0.99, 1.81], namaqualand_boulder_02: [2.5, 0.86, 1.23], namaqualand_boulder_03: [1.6, 0.9, 1.5] }[id];
      const [mx, my, mz] = dims;
      const flip = along === mx > mz;
      P.place(id, cx, -0.05, cz, { ry: flip ? 0 : Math.PI / 2, sx: (flip ? lx : lz) / mx, sy: (h + 0.1) / my, sz: (flip ? lz : lx) / mz });
      break;
    }
    case 'adobe': {
      // A low yard wall of rendered mud brick, with a cap
      B.box('plaster_damaged', b.x0, b.x1, 0, h, b.z0, b.z1, '#e8d8c0');
      B.box('plaster_damaged', b.x0 - 0.05, b.x1 + 0.05, h, h + 0.08, b.z0 - 0.05, b.z1 + 0.05, '#d8c4a8');
      break;
    }
    case 'stall': {
      // A market stall: a trestle table of goods under a cloth awning on poles
      B.box('wood', b.x0, b.x1, 0.82, 0.9, b.z0, b.z1, '#9a7a58');
      for (const [x, z] of [[b.x0 + 0.1, b.z0 + 0.1], [b.x1 - 0.1, b.z0 + 0.1], [b.x0 + 0.1, b.z1 - 0.1], [b.x1 - 0.1, b.z1 - 0.1]]) B.box('wood', x - 0.04, x + 0.04, 0, 2.4, z - 0.04, z + 0.04, '#7a5a3a');
      const awn = new THREE.BoxGeometry(lx + 0.4, 0.03, lz + 0.6);
      awn.applyMatrix4(new THREE.Matrix4().makeRotationX(0.12));
      awn.translate(cx, 2.4, cz);
      B.add('sack', awn, rng.pick(AWNINGS));
      for (let x = b.x0 + 0.35; x < b.x1 - 0.2; x += 0.55) P.place(rng.chance(0.5) ? 'cardboard_box_01' : 'plastic_crate_01', x, 0.9, cz + rng.range(-0.3, 0.3), { ry: rng.range(0, 6), s: 0.7 });
      break;
    }
    case 'fountain': {
      // The plaza's fountain: a round basin, dark water, a column with a bowl
      const r = Math.min(lx, lz) / 2;
      B.cyl('plaster_white', cx, 0, cz, h, r, '#e8e0d0', { sides: 32 });
      B.cyl('glass', cx, h - 0.15, cz, 0.05, r - 0.25, '#20303a', { sides: 32 });
      B.cyl('plaster_white', cx, 0, cz, 2.2, 0.32, '#e8e0d0', { sides: 14 });
      B.cyl('plaster_white', cx, 2.2, cz, 0.3, 0.95, '#e8e0d0', { sides: 18, rTop: 1.05 });
      break;
    }
    case 'pump': {
      B.box('paint', b.x0, b.x1, 0, h, b.z0, b.z1, '#d83a2a');
      B.box('glass', b.x0 + 0.1, b.x1 - 0.1, h - 0.5, h - 0.15, b.z0 - 0.01, b.z1 + 0.01, '#202428');
      B.box('rubber', b.x1 - 0.05, b.x1 + 0.05, 0.4, h - 0.2, cz - 0.05, cz + 0.05, '#151515');
      break;
    }
    case 'bollard':
      B.cyl('paint', cx, 0, cz, h, Math.min(lx, lz) / 2, '#2a2a2c', { sides: 12, rTop: Math.min(lx, lz) / 2 + 0.06 });
      break;
    default:
      B.box('wood', b.x0, b.x1, 0, b.y1, b.z0, b.z1, '#ffffff');
  }
}

/** A sandbag wall filling a box. */
function sandbags(ctx, b) {
  const { B, rng } = ctx;
  const lx = b.x1 - b.x0;
  const lz = b.z1 - b.z0;
  const along = lx >= lz;
  const len = along ? lx : lz;
  const depth = along ? lz : lx;
  const n = Math.max(2, Math.round(len / 0.6));
  const step = len / n;
  const rows = Math.max(2, Math.round(b.y1 / 0.28));
  const rh = b.y1 / rows;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? step / 2 : 0;
    for (let i = 0; i < n - (r % 2); i++) {
      const t = -len / 2 + step / 2 + i * step + off;
      const bag = new THREE.SphereGeometry(0.5, 10, 6);
      bag.scale(along ? step * 1.02 : depth * 0.95, rh * 1.25, along ? depth * 0.95 : step * 1.02);
      const pos = bag.attributes.position;
      for (let k = 0; k < pos.count; k++) pos.setY(k, Math.max(-rh * 0.42, pos.getY(k)));
      bag.computeVertexNormals();
      bag.translate(along ? cx + t : cx, rh * (r + 0.5), along ? cz : cz + t);
      B.add('sack', bag, rng.pick(['#f4ead2', '#ffffff', '#e8dcc0']));
    }
  }
  snowCap(ctx, b.x0, b.x1, b.y1 - 0.05, b.z0, b.z1);
}

/** Fills a box with a prop, stacked in a grid, scaled to fit. size: the prop's [x, y, z]. */
function stack(ctx, b, id, size, { jitter = 0.03, tint = null } = {}) {
  const { P, rng } = ctx;
  const lx = b.x1 - b.x0;
  const lz = b.z1 - b.z0;
  const turn = lz > lx ? 0 : Math.PI / 2;
  // The prop's long side along the box's long side
  const [px, py, pz] = turn ? [size[2], size[1], size[0]] : size;
  const nx = Math.max(1, Math.round(lx / px));
  const nz = Math.max(1, Math.round(lz / pz));
  const base = b.y0 ?? 0;
  const ny = Math.max(1, Math.round((b.y1 - base) / py));
  const sx = lx / nx / px;
  const sz = lz / nz / pz;
  const sy = (b.y1 - base) / ny / py;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        if (iy > 0 && rng.chance(0.15)) continue;
        const x = b.x0 + (ix + 0.5) * (lx / nx) + rng.range(-jitter, jitter);
        const z = b.z0 + (iz + 0.5) * (lz / nz) + rng.range(-jitter, jitter);
        P.place(id, x, base + iy * py * sy, z, { ry: turn + rng.range(-0.04, 0.04) + (rng.chance(0.5) ? Math.PI : 0), s: 1, sx: (turn ? sz : sx) * 0.98, sy, sz: (turn ? sx : sz) * 0.98, tint });
      }
    }
  }
  snowCap(ctx, b.x0 + 0.1, b.x1 - 0.1, b.y1 - 0.06, b.z0 + 0.1, b.z1 - 0.1);
}

function forklift(B, b) {
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const h = b.y1;
  B.box('paint', cx - 0.9 + 0.2, cx + 0.9 + 0.2, 0.25, 1.05, b.z0, b.z1, '#d8a020'); // body
  B.box('paint', cx + 0.4, cx + 1.2, 0.25, 1.25, b.z0 + 0.1, b.z1 - 0.1, '#c89018'); // counterweight
  for (const z of [b.z0 + 0.1, b.z1 - 0.15]) B.box('metal', cx - 0.3, cx + 0.6, 1.05, 2.15, z, z + 0.05, '#2a2a2a');
  B.box('metal', cx - 0.35, cx + 0.65, 2.15, 2.21, b.z0 + 0.1, b.z1 - 0.1, '#2a2a2a'); // overhead guard
  B.box('metal', b.x0, b.x0 + 0.1, 0, h + 1.2, b.z0 + 0.25, b.z1 - 0.25, '#3a3a3a'); // mast
  for (const z of [cz - 0.4, cz + 0.25]) B.box('metal', b.x0 - 0.9, b.x0, 0.06, 0.12, z, z + 0.15, '#4a4a4a'); // forks
  for (const [wx, wz] of [[b.x0 + 0.5, b.z0], [b.x1 - 0.4, b.z0], [b.x0 + 0.5, b.z1], [b.x1 - 0.4, b.z1]]) B.cyl('rubber', wx, 0.28 - 0.14, wz - 0.14, 0.28, 0.28, '#181818', { rx: Math.PI / 2 });
  B.box('dark', cx - 0.1, cx + 0.3, 1.05, 1.3, cz - 0.25, cz + 0.25, '#202020'); // seat
}

/** The landing pad: a painted circle and an H, scuffed. */
function padMaterial() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(230,226,214,0.9)';
  ctx.lineWidth = 22;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230,226,214,0.9)';
  ctx.fillRect(S * 0.33, S * 0.27, S * 0.07, S * 0.46);
  ctx.fillRect(S * 0.6, S * 0.27, S * 0.07, S * 0.46);
  ctx.fillRect(S * 0.33, S * 0.465, S * 0.34, S * 0.07);
  // Scuffs
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, Math.random() * 14, Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardNodeMaterial({ map: t, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
}

/** Harbour water: dark, glossy, with slow swell and fine ripples (normals from noise, on the GPU). */
function waterMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const t = time;
  const eps = 0.15;
  const h = (q) => mx_noise_float(q.mul(0.08).add(vec2(t.mul(0.05), t.mul(0.03)))).mul(0.6).add(mx_noise_float(q.mul(0.6).add(vec2(t.mul(-0.2), t.mul(0.15)))).mul(0.12));
  const dx = h(p.add(vec2(eps, 0))).sub(h(p.sub(vec2(eps, 0))));
  const dz = h(p.add(vec2(0, eps))).sub(h(p.sub(vec2(0, eps))));
  m.colorNode = color('#04101a');
  m.roughnessNode = float(0.06);
  m.metalnessNode = float(0.1);
  // A tangent-space-like normal from the slopes, fed through the normal-map path
  const n = vec2(dx, dz).mul(-2.2).mul(0.5).add(0.5);
  m.normalNode = normalMap(color(n.x, n.y, 1).mul(1));
  return m;
}
