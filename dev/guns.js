// Guns lab: the weapons laid out side-on for checking the models. ?kinds=ak,rpk,goldAk
import { createStage } from './stage.js';
import { makeGun, preloadGuns } from '../src/gfx/guns.js';

const stage = await createStage();
const { scene, camera, q } = stage;
const kinds = (q.get('kinds') || 'ak,rpk,goldAk').split(',');
await preloadGuns(kinds);
kinds.forEach((k, i) => {
  const g = makeGun(k);
  g.group.position.set(0, 1.2 - i * 0.42, 0);
  g.group.rotation.y = Number(q.get('ry') ?? 0);
  scene.add(g.group);
});
camera.position.set(Number(q.get('x') ?? 0.15), Number(q.get('y') ?? 0.8), Number(q.get('z') ?? 1.9));
camera.lookAt(Number(q.get('x') ?? 0.15), 0.8, 0);
window.ready = true;
