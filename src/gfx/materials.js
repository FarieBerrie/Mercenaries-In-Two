// Surfaces, written as TSL node materials so all of it runs on the GPU. Level geometry is
// mapped in world space (box projection for walls and crates, top-down for the ground), so any
// size of box gets texels of the same size with no UVs to build. On top of the photo-scanned
// textures: large-scale colour variation so tiling never shows, grime gathered at the foot of
// walls, rain-wet ground with puddles, and snow settling on anything facing up.
import * as THREE from 'three/webgpu';
import {
  abs, clamp, color, dot, float, Fn, max, mix, mx_fractal_noise_float, mx_noise_float, normalize, normalMap, normalView, normalWorld, positionWorld, select, smoothstep, texture, uniform, uv, vec2, vec3,
} from 'three/tsl';

/** Global weather on surfaces: how wet everything is (0..1), and snow cover (0..1). */
export const WEATHER = { wet: uniform(0), snow: uniform(0), rain: uniform(0) };

/** World-space texture coordinates: the dominant axis of the surface normal picks the plane. */
export const boxUV = Fn(([scale]) => {
  const n = abs(normalWorld);
  const p = positionWorld;
  const uvY = p.xz;
  const uvX = vec2(p.z, p.y);
  const uvZ = vec2(p.x, p.y);
  return select(n.y.greaterThan(max(n.x, n.z)), uvY, select(n.x.greaterThan(n.z), uvX, uvZ)).div(scale);
});

/** Slow, soft colour variation across a surface, in world space (about 0.75..1.25). */
const macro = Fn(([scale, amount]) => {
  const n = mx_fractal_noise_float(positionWorld.xz.mul(scale), 3, 2.0, 0.5);
  return float(1).add(n.mul(amount));
});

/**
 * A photo-scanned surface as a material.
 *   set: { map, normal, arm } from loadSurface
 *   scale: metres per texture tile; mapping: 'box' (world, any face), 'ground' (world, top-down)
 *     or 'uv' (the mesh's own UVs, times `repeat`)
 *   tint: colour multiplier; variation: macro colour variation amount
 *   blend: { set, scale, amount, noise } a second surface mixed in by noise (sand into gravel,
 *     brick showing through plaster)
 *   grime: darkening toward the ground, up to `grime` metres
 *   wet: takes rain (puddles on flat ground, darker and glossier walls)
 *   snow: { set } snow settles on top faces
 */
export function surfaceMaterial(set, opts = {}) {
  const { scale = 2, mapping = 'box', repeat = [1, 1], tint = '#ffffff', variation = 0.18, blend = null, grime = 0, wet = false, snow = null, normalScale = 1, roughness = 1, metalness = null, recolor = false } = opts;
  const mat = new THREE.MeshStandardNodeMaterial();
  const coords = mapping === 'uv' ? uv().mul(vec2(...repeat)) : mapping === 'ground' ? positionWorld.xz.div(scale) : boxUV(float(scale));

  let albedo = texture(set.map, coords).rgb;
  let nrm = texture(set.normal, coords);
  let arm = texture(set.arm, coords);
  if (blend) {
    const bc = mapping === 'uv' ? coords.mul(blend.scale ?? 1) : mapping === 'ground' ? positionWorld.xz.div(blend.scale) : boxUV(float(blend.scale));
    const k = smoothstep(0.5 - (blend.soft ?? 0.15), 0.5 + (blend.soft ?? 0.15), mx_fractal_noise_float(positionWorld.mul(blend.noise ?? 0.08), 3, 2, 0.5).mul(0.5).add(0.5).add(blend.amount - 0.5));
    albedo = mix(albedo, texture(blend.set.map, bc).rgb, k);
    nrm = mix(nrm, texture(blend.set.normal, bc), k);
    arm = mix(arm, texture(blend.set.arm, bc), k);
  }
  // recolor: keep only the texture's shading, so a vertex tint gives the colour (painted containers)
  if (recolor) albedo = vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722)).mul(2.6));
  albedo = albedo.mul(color(tint)).mul(variation ? macro(float(0.035), float(variation)) : float(1));
  let rough = arm.g.mul(roughness);
  let ao = arm.r;
  if (grime) {
    const g = float(1).sub(smoothstep(0, grime, positionWorld.y));
    albedo = albedo.mul(mix(float(1), float(0.55), g.mul(0.8)));
  }

  let normalNode = normalMap(nrm, vec2(normalScale, normalScale));

  if (wet) {
    // Flat ground pools water in the low spots; everything is damp; walls streak
    const up = smoothstep(0.7, 0.95, normalWorld.y);
    const puddle = smoothstep(0.08, 0.22, mx_fractal_noise_float(positionWorld.xz.mul(0.09), 3, 2, 0.5).add(0.05)).mul(up);
    const damp = float(0.55).add(puddle.mul(0.45)).mul(WEATHER.wet);
    albedo = albedo.mul(mix(float(1), float(0.45), damp));
    rough = mix(rough, float(0.04), puddle.mul(WEATHER.wet)).mul(mix(float(1), float(0.55), damp));
    // Puddles are mirror-flat
    normalNode = normalize(mix(normalNode, normalView, puddle.mul(WEATHER.wet)));
  }
  if (snow) {
    const sc = positionWorld.xz.div(2.5);
    const n = mx_noise_float(positionWorld.mul(0.6)).mul(0.25);
    const k = smoothstep(0.55, 0.85, normalWorld.y.add(n)).mul(WEATHER.snow);
    albedo = mix(albedo, texture(snow.set.map, sc).rgb.mul(1.05), k);
    rough = mix(rough, texture(snow.set.arm, sc).g, k);
  }

  mat.colorNode = albedo;
  mat.normalNode = normalNode;
  mat.roughnessNode = clamp(rough, 0.02, 1);
  mat.metalnessNode = metalness === null ? arm.b : float(metalness);
  mat.aoNode = ao;
  return mat;
}

/** A plain painted or bare material without textures (small details). */
export function plainMaterial(c, { roughness = 0.7, metalness = 0, emissive = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ color: c, roughness, metalness });
  if (emissive) m.emissiveNode = color(emissive);
  return m;
}

/** Something that glows (lamps, LEDs): brighter than white so it blooms. */
export function glowMaterial(c, k = 4) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(c).mul(k);
  return m;
}


/**
 * The ground of an open map: three surfaces laid out by a painted mask over the map (red: roads,
 * green: paving), its edges frayed by noise so streets break up into dirt rather than ending in a
 * ruled line. layers: { base, paved, road }, each { set, scale, tint?, blend? (as surfaceMaterial) }.
 * rect: the area the mask covers.
 */
export function groundMaterial(layers, mask, rect, { wet = false, snow = null, variation = 0.22 } = {}) {
  const mat = new THREE.MeshStandardNodeMaterial();
  const p = positionWorld.xz;
  const sample = (L) => {
    const c = p.div(L.scale);
    let albedo = texture(L.set.map, c).rgb;
    let nrm = texture(L.set.normal, c);
    let arm = texture(L.set.arm, c);
    if (L.blend) {
      const bc = p.div(L.blend.scale);
      const k = smoothstep(0.5 - (L.blend.soft ?? 0.15), 0.5 + (L.blend.soft ?? 0.15), mx_fractal_noise_float(positionWorld.mul(L.blend.noise ?? 0.08), 3, 2, 0.5).mul(0.5).add(0.5).add(L.blend.amount - 0.5));
      albedo = mix(albedo, texture(L.blend.set.map, bc).rgb, k);
      nrm = mix(nrm, texture(L.blend.set.normal, bc), k);
      arm = mix(arm, texture(L.blend.set.arm, bc), k);
    }
    return { albedo: albedo.mul(color(L.tint || '#ffffff')), nrm, arm };
  };
  const base = sample(layers.base);
  const paved = sample(layers.paved);
  const road = sample(layers.road);
  const m = texture(mask, p.sub(vec2(rect.x0, rect.z0)).div(vec2(rect.x1 - rect.x0, rect.z1 - rect.z0)));
  const fray = mx_fractal_noise_float(positionWorld.mul(0.2), 3, 2, 0.5).mul(0.32);
  const kp = smoothstep(0.32, 0.68, m.g.add(fray));
  const kr = smoothstep(0.32, 0.68, m.r.add(fray.mul(0.7)));
  const lay = (a, b, c) => mix(mix(a, b, kp), c, kr);
  let albedo = lay(base.albedo, paved.albedo, road.albedo).mul(macro(float(0.03), float(variation)));
  const nrm = lay(base.nrm, paved.nrm, road.nrm);
  const arm = lay(base.arm, paved.arm, road.arm);
  let rough = arm.g;
  let normalNode = normalMap(nrm);
  if (wet) {
    const puddle = smoothstep(0.08, 0.22, mx_fractal_noise_float(positionWorld.xz.mul(0.09), 3, 2, 0.5).add(0.05));
    const damp = float(0.55).add(puddle.mul(0.45)).mul(WEATHER.wet);
    albedo = albedo.mul(mix(float(1), float(0.45), damp));
    rough = mix(rough, float(0.04), puddle.mul(WEATHER.wet)).mul(mix(float(1), float(0.55), damp));
    normalNode = normalize(mix(normalNode, normalView, puddle.mul(WEATHER.wet)));
  }
  if (snow) {
    // Snow lies everywhere but the roads people keep clear
    const sc = positionWorld.xz.div(2.5);
    const k = float(1).sub(kr.mul(0.75)).mul(WEATHER.snow).mul(smoothstep(-0.2, 0.3, mx_noise_float(positionWorld.mul(0.15))).mul(0.35).add(0.65));
    albedo = mix(albedo, texture(snow.set.map, sc).rgb.mul(1.04), k.mul(snow.amount ?? 0.6));
  }
  mat.colorNode = albedo;
  mat.normalNode = normalNode;
  mat.roughnessNode = clamp(rough, 0.02, 1);
  mat.metalnessNode = float(0);
  mat.aoNode = arm.r;
  return mat;
}

/** Rock with no UVs to stretch: a scanned surface projected from all three axes and blended. */
export function rockMaterial(set, { scale = 4, tint = '#ffffff', snow = null } = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const tri = (tex) =>
    Fn(() => {
      const n = abs(normalWorld);
      const w = n.mul(n).mul(n).mul(n);
      const ws = w.div(w.x.add(w.y).add(w.z));
      const q = positionWorld.div(scale);
      return texture(tex, q.zy).mul(ws.x).add(texture(tex, q.xz).mul(ws.y)).add(texture(tex, q.xy).mul(ws.z));
    })();
  let albedo = tri(set.map).rgb.mul(color(tint)).mul(macro(float(0.05), float(0.2)));
  const arm = tri(set.arm);
  if (snow) {
    const k = smoothstep(0.45, 0.8, normalWorld.y.add(mx_noise_float(positionWorld.mul(0.7)).mul(0.2))).mul(WEATHER.snow);
    albedo = mix(albedo, vec3(0.9, 0.93, 0.97), k);
  }
  m.colorNode = albedo;
  m.roughnessNode = arm.g;
  m.metalnessNode = float(0);
  m.aoNode = arm.r;
  return m;
}
