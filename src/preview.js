// The armory's turntable: one contractor under studio lights, slowly turning, so you can see a
// mask before you pay for it. Drawn by its own small GPU renderer.
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPerson, preloadPeople } from './gfx/characters.js';
import { createGPU } from './gfx/gpu.js';

export async function createPreview(canvas, backend = 'auto') {
  const renderer = await createGPU(canvas, { backend, antialias: true, share: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  await preloadPeople('desert');
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(5.6, 1.55, 1.1);
  camera.lookAt(0, 0.98, 0);
  const key = new THREE.DirectionalLight(0xfff0dc, 3);
  key.position.set(3, 4, 2);
  key.castShadow = true;
  const rim = new THREE.DirectionalLight(0x6fb0ff, 2.5);
  rim.position.set(-3, 2.5, -2.5);
  const fill = new THREE.DirectionalLight(0xffb070, 0.6);
  fill.position.set(1, 0.5, -3);
  scene.add(key, rim, fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#15171a', roughness: 0.6, metalness: 0.2 }));
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.36, 1.4, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(2, 1.2, 0.4) }));
  ring.position.y = 0.003;
  scene.add(ring);

  let person = null;
  let current = '';
  const pose = { x: 0, y: 0, z: 0, vx: 0, vz: 0, anim: 'idle', weapon: 'rifle', sinceShot: 999, yaw: 0, aimYaw: 0 };
  let last = performance.now();

  return {
    /** who: 'hatch' | 'cruz'; mask: { pattern, base, accent } */
    show(who, mask) {
      const k = `${who}|${JSON.stringify(mask)}`;
      if (k === current) return;
      current = k;
      if (person) {
        scene.remove(person.outer);
        for (const g of Object.values(person.guns)) scene.remove(g.group);
      }
      person = createPerson(who, { look: mask });
      scene.add(person.outer);
      for (const g of Object.values(person.guns)) scene.add(g.group);
    },
    render(t) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (person) {
        // A three-quarter view, turning slowly
        pose.yaw = pose.aimYaw = 0.75 + Math.sin(t * 0.35) * 0.55;
        person.outer.rotation.y = -pose.yaw;
        person.outer.updateMatrixWorld(true);
        person.animator.update(pose, dt, { time: t });
      }
      renderer.render(scene, camera);
    },
  };
}
