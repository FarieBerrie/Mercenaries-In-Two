// Effects lab: explosions, impacts and gunfire on an empty stage, for checking the GPU particles.
import { createStage } from './stage.js';
import { createFx } from '../src/gfx/fx.js';

const stage = await createStage();
const { scene, camera, renderer, q } = stage;
const fx = createFx(scene, renderer, { fx: 1 });
fx.setTheme(stage.themeName);
camera.position.set(0, 2.5, 12);
camera.lookAt(0, 1.5, 0);
let next = 0.5;
stage.onFrame = (dt, t) => {
  if (t > next) {
    next = t + Number(q.get('every') ?? 4);
    fx.explosion({ x: 0, y: 0.3, z: 0 }, 1);
    for (let i = 0; i < 6; i++) fx.impact({ x: -4 + i * 0.3, y: 1, z: 1 }, { x: 0, y: 0, z: 1 }, 'box', stage.themeName);
    fx.impact({ x: 4, y: 1.2, z: 0 }, null, 'flesh');
    fx.muzzle({ x: 3, y: 1.4, z: 2 }, { x: -1, y: 0, z: 0 }, { big: true });
    fx.tracer({ x: 6, y: 1.4, z: 2 }, { x: -20, y: 1.4, z: -5 });
    fx.burn({ x: 2, y: 0.2, z: -2 }, 1);
  }
  fx.update(dt, camera, stage.themeName);
};
window.fx = fx;
window.ready = true;
