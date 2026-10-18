// People lab: the cast posed in every state, for checking animation, IK, masks and ragdolls.
// ?scene=lineup|walk|aim|reload|crouch|downed|die&theme=desert&hatch=<mask>&cruz=<mask>
import * as THREE from 'three/webgpu';
import { createStage } from './stage.js';
import { createPerson, preloadPeople } from '../src/gfx/characters.js';
import { Ragdoll, rememberJoints } from '../src/gfx/ragdoll.js';

const stage = await createStage();
const { scene, camera, q } = stage;
await preloadPeople(stage.themeName);
const mode = q.get('scene') || 'lineup';
const cast = (q.get('cast') || 'hatch,cruz,rifleman,shotgunner,heavy,hostage').split(',');
const people = [];
cast.forEach((c, i) => {
  const seeds = q.get('seeds')?.split(',').map(Number);
  const role = ['hatch', 'cruz', 'hostage'].includes(c) ? c : { enemy: c, theme: stage.themeName, seed: seeds ? seeds[i] : i };
  const look = c === 'hatch' ? { pattern: q.get('hatch') || 'skull', base: '#e8e4dc', accent: '#2a2a2e' } : c === 'cruz' ? { pattern: q.get('cruz') || 'tribal', base: '#2a2a2e', accent: '#d8a020' } : null;
  const p = createPerson(role, { look, camo: q.get('camo') === '0' ? null : undefined });
  scene.add(p.outer);
  for (const g of Object.values(p.guns)) scene.add(g.group);
  const x = (i - (cast.length - 1) / 2) * 1.3;
  const face = Number(q.get('face') ?? Math.PI / 2);
  const actor = { x, y: 0, z: 0, vx: 0, vz: 0, yaw: face, aimYaw: face, aimPitch: 0, anim: 'idle', weapon: c === 'hatch' || c === 'cruz' ? 'rifle' : 'main', sinceShot: 999, reloadT: 0, flash: 0, guns: { rifle: { def: { reload: 110 } } } };
  people.push({ p, actor, c, i, ragdoll: null });
});

const camYaw = Number(q.get('yaw') ?? 0);
const camD = Number(q.get('d') ?? 7);
const camY = Number(q.get('ty') ?? 1.1);
const tx = Number(q.get('tx') ?? 0);
camera.position.set(tx + Math.sin(camYaw) * camD, camY + Number(q.get('cy') ?? 0.4), Math.cos(camYaw) * camD);
camera.lookAt(tx, camY, 0);

stage.onFrame = (dt, t) => {
  const t0 = performance.now();
  for (const it of people) {
    const { p, actor: a } = it;
    a.anim = 'idle';
    a.vx = a.vz = 0;
    a.aiming = false;
    if (mode === 'walk' || mode === 'run' || mode === 'strafe' || mode === 'back') {
      const sp = mode === 'run' ? 5.2 : mode === 'walk' ? 1.6 : 2.5;
      const dir = mode === 'strafe' ? a.yaw + Math.PI / 2 : mode === 'back' ? a.yaw + Math.PI : a.yaw;
      a.vx = Math.cos(dir) * sp;
      a.vz = Math.sin(dir) * sp;
      a.anim = mode === 'run' ? 'run' : 'walk';
    }
    if (mode === 'sprint') {
      a.vx = Math.cos(a.yaw) * 8;
      a.vz = Math.sin(a.yaw) * 8;
      a.anim = 'sprint';
    }
    if (mode === 'aim' || mode === 'reload' || mode === 'fire') {
      a.aiming = true;
      a.anim = 'aim';
      a.aimPitch = Math.sin(t * 0.7) * 0.25 * (q.has('pitch') ? 0 : 1) + Number(q.get('pitch') || 0);
    }
    if (mode === 'fire') a.sinceShot = Math.floor((t * 60) % 6);
    if (mode === 'reload') a.reloadT = 110 - Math.floor(((t * 60) % 130) * (110 / 130));
    if (mode === 'crouch') {
      a.crouch = true;
      a.anim = 'crouch';
    }
    if (mode === 'crouchwalk') {
      a.crouch = true;
      a.anim = 'crouchWalk';
      a.vx = Math.cos(a.yaw) * 2.4;
      a.vz = Math.sin(a.yaw) * 2.4;
    }
    if (mode === 'downed') {
      a.downed = true;
      a.anim = 'downed';
    }
    if (mode === 'use') a.anim = 'use';
    p.outer.position.set(a.x, 0, a.z);
    p.outer.rotation.y = -a.yaw;
    p.state.flash = 0;
    if (mode === 'die' && t > 1.2 + it.i * 0.15 && !it.ragdoll) {
      rememberJoints(p.rig);
      it.ragdoll = new Ragdoll(p.rig, null, { impulse: { x: 0, y: 1, z: -4 }, at: new THREE.Vector3(a.x, 1.4, a.z) });
    }
    if (it.ragdoll) {
      it.ragdoll.step(dt);
      it.ragdoll.apply();
      continue;
    }
    p.animator.update(a, dt, { pitch: a.aimPitch, time: t, bound: it.c === 'hostage' && mode === 'lineup', unarmed: it.c === 'hostage' });
    rememberJoints(p.rig);
  }
  stage.cpu = (stage.cpu ?? 0) * 0.9 + (performance.now() - t0) * 0.1;
};
window.people = people;
window.ready = true;
