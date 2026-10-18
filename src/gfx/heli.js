// The extraction helicopter: a utility airframe in worn olive paint with a glass nose, an open
// cabin door, skids, a tail rotor, blinking nav lights, and main blades that blur into a disc.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, float, mix, mx_fractal_noise_float, positionLocal, smoothstep } from 'three/tsl';
import { glowMaterial } from './materials.js';
import { keepNormals } from './post.js';

function paint(c) {
  const m = new THREE.MeshStandardNodeMaterial();
  const wear = smoothstep(0.55, 0.8, mx_fractal_noise_float(positionLocal.mul(1.8), 3, 2, 0.5).mul(0.5).add(0.5));
  m.colorNode = mix(color(c), color('#6a6a5e'), wear.mul(0.35));
  m.roughnessNode = mix(float(0.62), float(0.45), wear);
  m.metalnessNode = float(0.15);
  return m;
}

export function buildHelicopter() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hull = paint('#3e4636');
  const dark = new THREE.MeshStandardNodeMaterial({ color: '#16181a', roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: '#0c1820', roughness: 0.05, metalness: 0.3 });
  // Fuselage: a rounded hull, nose, tail boom and fin
  const fus = new THREE.CapsuleGeometry(0.95, 3.2, 8, 16).rotateZ(Math.PI / 2).scale(1, 1, 0.95).translate(0, 1.6, 0);
  const nose = new THREE.SphereGeometry(0.9, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2).scale(1.3, 0.85, 0.9).translate(2.2, 1.45, 0);
  const boom = new THREE.CylinderGeometry(0.18, 0.42, 5, 12).rotateZ(Math.PI / 2).translate(-4.3, 2.0, 0);
  const fin = new THREE.BoxGeometry(1.0, 1.5, 0.1).translate(-6.6, 2.65, 0);
  fin.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0, 0.35, 0, 0));
  const stab = new THREE.BoxGeometry(0.7, 0.06, 1.8).translate(-6.1, 2.05, 0);
  const engine = new THREE.CapsuleGeometry(0.42, 1.4, 6, 12).rotateZ(Math.PI / 2).translate(-0.1, 2.75, 0);
  const hullGeo = mergeGeometries([fus, nose, boom, fin, stab, engine].map((g) => g.toNonIndexed()));
  const hullMesh = new THREE.Mesh(hullGeo, hull);
  hullMesh.castShadow = true;
  body.add(hullMesh);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.88, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.2).rotateZ(-Math.PI / 2 + 0.5).scale(1.25, 0.9, 0.92).translate(2.1, 1.75, 0), glass);
  body.add(canopy);
  // The open door: a dark cabin
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.25).translate(-0.1, 1.55, 0.96), new THREE.MeshBasicNodeMaterial({ color: '#050505', side: THREE.DoubleSide }));
  body.add(door);
  // Skids
  const skidParts = [];
  for (const z of [-1, 1]) {
    skidParts.push(new THREE.CylinderGeometry(0.06, 0.06, 4.4, 8).rotateZ(Math.PI / 2).translate(0.2, 0.12, z));
    for (const x of [-1, 1.3]) skidParts.push(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6).rotateX(z * 0.35).translate(x, 0.55, z * 0.86));
  }
  const skids = new THREE.Mesh(mergeGeometries(skidParts.map((g) => g.toNonIndexed())), dark);
  skids.castShadow = true;
  body.add(skids);
  // Rotors
  const rotor = new THREE.Group();
  rotor.position.set(-0.1, 3.15, 0);
  const blades = mergeGeometries([0, 1].map((i) => new THREE.BoxGeometry(10.8, 0.04, 0.34).rotateY((i * Math.PI) / 2).toNonIndexed()));
  rotor.add(new THREE.Mesh(blades, dark), new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 12), dark));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.4, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: '#0a0a0a', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }));
  disc.material.mrtNode = keepNormals();
  disc.position.y = 0.04;
  rotor.add(disc);
  body.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(-6.5, 2.6, 0.12);
  tail.add(new THREE.Mesh(mergeGeometries([0, 1].map((i) => new THREE.BoxGeometry(0.06, 1.3, 0.16).rotateX((i * Math.PI) / 2).toNonIndexed())), dark));
  body.add(tail);
  // Nav lights
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glowMaterial('#ff2020', 8));
  red.position.set(-6.8, 3.4, 0);
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMaterial('#ff2020', 6));
  port.position.set(0.4, 2.3, -0.97);
  const star = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMaterial('#20ff40', 6));
  star.position.set(0.4, 2.3, 0.97);
  body.add(red, port, star);
  return { root, rotor, tail, blink: red };
}
