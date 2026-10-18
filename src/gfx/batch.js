// Collecting a map's static geometry for drawing. Batch gathers boxes, cylinders and shapes per
// material (tints ride in vertex colour) and merges them; Props places scanned props as
// instances. Both cut the map into square chunks so the parts out of view (and out of the
// shadow's reach) are skipped: one draw per material per chunk. Chunks are big, since on the CPU
// every draw call costs more than its triangles do on the GPU.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, float, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, texture, vec3 } from 'three/tsl';
import { WEATHER } from './materials.js';

const WHITE = new THREE.Color(1, 1, 1);
const _c = new THREE.Color();
const _v = new THREE.Vector3();
export const CHUNK = 250;
const chunkOf = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

/** Geometry gathered per material key, in world space, merged per chunk at the end. */
export class Batch {
  constructor() {
    this.parts = new Map();
  }

  add(key, geo, tint = WHITE) {
    const g = geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    // Everything indexed, so it all merges (and shared corners aren't stored three times)
    if (!g.index) g.setIndex(Array.from({ length: n }, (_, i) => i));
    const col = new Float32Array(n * 3);
    const c = tint.isColor ? tint : _c.set(tint);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
    return g;
  }

  /** Moves everything in another batch into this one, transformed by a matrix. */
  absorb(other, matrix) {
    for (const [key, geos] of other.parts) {
      if (!this.parts.has(key)) this.parts.set(key, []);
      for (const g of geos) this.parts.get(key).push(g.applyMatrix4(matrix));
    }
  }

  /** An axis-aligned box from corners, optionally turned (about its centre). */
  box(key, x0, x1, y0, y1, z0, z1, tint, { rx = 0, ry = 0, rz = 0 } = {}) {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return this.add(key, g, tint);
  }

  /** A vertical cylinder standing at (x, y, z). */
  cyl(key, x, y, z, h, r, tint, { sides = 12, rTop = r, rx = 0, rz = 0 } = {}) {
    const g = new THREE.CylinderGeometry(rTop, r, h, sides);
    g.translate(0, h / 2, 0);
    if (rx || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
    g.translate(x, y, z);
    return this.add(key, g, tint);
  }

  meshes(materials, { shadows = true, chunked = true } = {}) {
    const out = [];
    for (const [key, geos] of this.parts) {
      const mat = materials[key];
      if (!mat) continue;
      const groups = new Map();
      for (const g of geos) {
        let k = 'all';
        if (chunked) {
          g.computeBoundingBox();
          g.boundingBox.getCenter(_v);
          k = chunkOf(_v.x, _v.z);
        }
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(g);
      }
      for (const [k, list] of groups) {
        const mesh = new THREE.Mesh(mergeGeometries(list), mat);
        mesh.castShadow = shadows && key !== 'glow';
        mesh.receiveShadow = key !== 'glow';
        mesh.name = `${key}@${k}`;
        out.push(mesh);
      }
    }
    return out;
  }
}

/** Prop placements, drawn as instanced meshes per prop part (per chunk when there are many). */
export class Props {
  constructor() {
    this.byId = new Map();
  }

  place(id, x, y, z, { ry = 0, rx = 0, rz = 0, s = 1, sx = s, sy = s, sz = s, tint = null } = {}) {
    if (!this.byId.has(id)) this.byId.set(id, []);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    this.byId.get(id).push({ m, tint, chunk: chunkOf(x, z) });
  }

  build(scenes, { shadows = true, weather = null } = {}) {
    const group = new THREE.Group();
    for (const [id, all] of this.byId) {
      const scene = scenes[id];
      if (!scene) continue;
      scene.updateMatrixWorld(true);
      const groups = new Map();
      // One instanced mesh per part across the map: each draw costs more than its triangles do
      for (const p of all) {
        const k = 'all';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      }
      for (const list of groups.values()) {
        scene.traverse((o) => {
          if (!o.isMesh) return;
          const im = new THREE.InstancedMesh(o.geometry, propMaterial(o.material, weather), list.length);
          list.forEach(({ m }, i) => im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(m, o.matrixWorld)));
          if (list.some((p) => p.tint)) list.forEach(({ tint }, i) => im.setColorAt(i, tint ? _c.set(tint) : WHITE));
          im.castShadow = shadows;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          im.name = id;
          group.add(im);
        });
      }
    }
    return group;
  }
}

const propMats = new Map();
/** A prop's own material, with the theme's weather on it (wet in the rain, snow on top). */
export function propMaterial(src, weather) {
  const key = `${src.uuid}|${weather}`;
  if (propMats.has(key)) return propMats.get(key);
  const m = new THREE.MeshStandardNodeMaterial();
  const st = src.map ? texture(src.map) : null;
  let albedo = st ? st.rgb.mul(color(src.color)) : color(src.color);
  let rough = src.roughnessMap ? texture(src.roughnessMap).g.mul(src.roughness) : float(src.roughness);
  if (weather === 'wet') {
    albedo = albedo.mul(mix(float(1), float(0.6), WEATHER.wet));
    rough = rough.mul(mix(float(1), float(0.45), WEATHER.wet));
  }
  if (weather === 'snow') {
    // Snow settles on whatever faces up
    const k = smoothstep(0.55, 0.85, normalWorld.y.add(mx_noise_float(positionWorld.mul(3)).mul(0.2))).mul(WEATHER.snow);
    albedo = mix(albedo, vec3(0.9, 0.93, 0.97), k);
    rough = mix(rough, float(0.8), k);
  }
  m.colorNode = albedo;
  m.roughnessNode = rough;
  m.metalnessNode = src.metalnessMap ? texture(src.metalnessMap).b.mul(src.metalness) : float(src.metalness);
  if (src.normalMap) {
    m.normalMap = src.normalMap;
    m.normalScale = src.normalScale.clone();
  }
  if (src.aoMap) {
    m.aoMap = src.aoMap;
    m.aoMapIntensity = 1;
  }
  m.transparent = src.transparent;
  m.alphaTest = src.alphaTest || (src.alphaMap || src.transparent ? 0.5 : 0);
  if (src.alphaMap) m.alphaMap = src.alphaMap;
  if (src.map && (src.transparent || src.alphaTest)) m.opacityNode = st.a;
  m.side = src.side;
  propMats.set(key, m);
  return m;
}
