// Where the camera goes. In play it sits over Hatch's right shoulder exactly where the aim ray
// starts (game.aimPoint uses the same offsets), pulled in along the aim line when a wall is in
// the way so the crosshair never lies. Around that: a fly-in when a mission starts, a slow orbit
// on the title screen, a low shaky view when you're down, and a sweep when you extract.
import { eye } from './actors.js';
import { cameraOffset, CAMERA } from './config.js';
import { boxesOnRay } from './level.js';
import { clamp, rayBox } from './math.js';
import { blend } from './render3d.js';

const smooth = (k) => k * k * (3 - 2 * k);
const lerp3 = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** Smooth noise for camera shake: a few sines at unrelated rates. */
const wobble = (t, s) => Math.sin(t * 13.1 + s) * 0.5 + Math.sin(t * 23.7 + s * 2.3) * 0.3 + Math.sin(t * 41.3 + s * 4.1) * 0.2;

export function createDirector(settings) {
  let eyeY = null;
  let shakeLevel = 0;
  let lastView = null;

  /** Pulls a camera position in toward `at` so it doesn't end up inside a wall. */
  function unblock(level, at, pos) {
    const d = { x: pos.x - at.x, y: pos.y - at.y, z: pos.z - at.z };
    const len = Math.hypot(d.x, d.y, d.z) || 1;
    const u = { x: d.x / len, y: d.y / len, z: d.z / len };
    let t = len;
    for (const b of boxesOnRay(level, at, u, len)) {
      const hit = rayBox(at, u, b);
      if (hit < t) t = hit;
    }
    t = Math.max(1, t - 0.4);
    return { x: at.x + u.x * t, y: at.y + u.y * t, z: at.z + u.z * t };
  }

  /** Distance along -forward from the shoulder before the camera would enter something. */
  function clearance(level, from, back, f) {
    const d = { x: -f.x, y: -f.y, z: -f.z };
    let t = back;
    for (const b of boxesOnRay(level, from, d, back + 0.5)) {
      const hit = rayBox(from, d, b);
      if (hit < t) t = hit;
    }
    return Math.max(0.35, t - 0.25);
  }

  /** The normal over-the-shoulder view. pending: mouse turn not yet applied by the game. */
  function shoulder(game, alpha, pending, t) {
    const h = game.hatch;
    const p = blend(h, alpha);
    const yaw = h.aimYaw + pending.x;
    const pitch = clamp(h.aimPitch - pending.y, -1.1, 1.0);
    const k = h.aimK ?? 0;
    const off = cameraOffset(k);
    const targetEye = eye(h).y - h.y;
    eyeY = eyeY === null ? targetEye : eyeY + (targetEye - eyeY) * 0.18;
    const f = { x: Math.cos(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.sin(yaw) * Math.cos(pitch) };
    const r = { x: -Math.sin(yaw), z: Math.cos(yaw) };
    const side = h.camSide ?? off.right;
    const sh = { x: p.x + r.x * side, y: p.y + eyeY + CAMERA.up, z: p.z + r.z * side };
    const back = clearance(game.level, sh, off.back, f);
    // A gentle bob when running, none when aiming
    const speed = Math.hypot(h.vx, h.vz);
    const bob = (1 - k) * Math.min(1, speed / 8) * (h.sprint ? 0.05 : 0.02) * Math.sin(t * (h.sprint ? 13 : 9));
    const pos = { x: sh.x - f.x * back, y: sh.y - f.y * back + bob, z: sh.z - f.z * back };
    let fov = off.fov + settings.fov + (h.sprint ? 6 : 0);
    if (game.mode === 'snipe') fov = 14;
    return { position: pos, target: { x: pos.x + f.x * 20, y: pos.y + f.y * 20, z: pos.z + f.z * 20 }, fov, roll: 0, yaw, pitch };
  }

  /** Shake from explosions and hits, applied as a small turn of the view. */
  function shake(view, game, t) {
    shakeLevel = Math.max(shakeLevel * 0.9, (game.shakeT || 0) / 20);
    const s = shakeLevel * settings.shake * 0.035;
    if (s < 1e-4) return view;
    const dx = wobble(t, 0) * s;
    const dy = wobble(t, 7) * s;
    const tg = view.target;
    const d = Math.hypot(tg.x - view.position.x, tg.y - view.position.y, tg.z - view.position.z);
    return { ...view, target: { x: tg.x + dx * d * -Math.sin(view.yaw ?? 0), y: tg.y + dy * d, z: tg.z + dx * d * Math.cos(view.yaw ?? 0) }, roll: (view.roll || 0) + wobble(t, 3) * s * 0.5 };
  }

  return {
    reset() {
      eyeY = null;
      lastView = null;
    },

    /** Play: over the shoulder, with shake, and special framings for being down or boosting. */
    play(game, alpha, pending, t) {
      let view = shoulder(game, alpha, pending, t);
      const h = game.hatch;
      if (h.downed) {
        // Lower, tilted, swaying with the heartbeat
        view.position.y -= 0.3;
        view.roll = 0.12 + Math.sin(t * 1.3) * 0.04;
        view.fov += 4;
      }
      if (game.mode === 'boost') {
        // Side-on to watch the climb
        const B = game.boostArea.boost;
        const len = Math.hypot(B.landing.x - B.x, B.landing.z - B.z) || 1;
        const f = { x: (B.landing.x - B.x) / len, z: (B.landing.z - B.z) / len };
        const at = { x: B.x - f.x, y: 2.2, z: B.z - f.z };
        view = { position: { x: at.x - f.x * 4.5 - f.z * 6, y: 3.4, z: at.z - f.z * 4.5 + f.x * 6 }, target: at, fov: 55, roll: 0 };
      }
      view = shake(view, game, t);
      lastView = view;
      return view;
    },

    /** Mission start: down from high above the area onto Hatch's shoulder. k: 0..1 */
    intro(game, k, t) {
      const end = shoulder(game, 1, { x: 0, y: 0 }, t);
      const h = game.hatch;
      const a = smooth(Math.min(1, k));
      const start = { x: h.x + 26, y: 18, z: h.z + 22 };
      const mid = { x: h.x + 6, y: 4, z: h.z + 7 };
      const pos = a < 0.6 ? lerp3(start, mid, smooth(a / 0.6)) : lerp3(mid, end.position, smooth((a - 0.6) / 0.4));
      const lookAt = lerp3({ x: h.x, y: 1.4, z: h.z }, end.target, smooth(Math.max(0, (a - 0.55) / 0.45)));
      return { position: pos, target: lookAt, fov: 50 + (end.fov - 50) * a, roll: 0 };
    },

    /** Extraction: a slow arc round the two of them, watching the helicopter. */
    outro(game, k, t, heli = null) {
      const h = game.hatch;
      // Swing round on the open side of the area (the way they came in), never into the end wall
      const ang = Math.PI + 0.9 - k * 1.5;
      const r = 9 + k * 5;
      const look = heli ? lerp3({ x: h.x, y: 1.6, z: h.z }, heli, 0.5) : { x: h.x, y: 1.8 + k * 4, z: h.z };
      const want = { x: h.x + Math.cos(ang) * r, y: 2.2 + k * 4, z: h.z + Math.sin(ang) * r };
      const pos = unblock(game.level, { x: h.x, y: 1.8, z: h.z }, want);
      return { position: pos, target: look, fov: 52, roll: 0 };
    },

    /** Failure: rise above the fallen. */
    failed(game, k) {
      const h = game.hatch;
      const base = lastView?.position ?? { x: h.x - 3, y: 2, z: h.z };
      const top = { x: h.x - 1.5, y: 9, z: h.z + 1.5 };
      return { position: lerp3(base, top, smooth(Math.min(1, k))), target: { x: h.x, y: 0.5, z: h.z }, fov: 55, roll: 0 };
    },

    /** Title screen: a slow orbit round the action, framed to the right of the menu. */
    orbit(game, t, alpha) {
      const h = blend(game.hatch, alpha);
      const ang = t * 0.06 + 2.2;
      const r = 8.5;
      // Aim below them, so they stand in the upper half of the frame above the logo
      const target = { x: h.x + 1.5, y: 0.35, z: h.z };
      return { position: { x: target.x + Math.cos(ang) * r, y: 2.4 + Math.sin(t * 0.13) * 0.5, z: target.z + Math.sin(ang) * r }, target, fov: 46, roll: 0 };
    },
  };
}
