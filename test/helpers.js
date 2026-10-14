import { createRng } from '../src/rng.js';
import { Game } from '../src/game.js';
import { rebuildGrid } from '../src/level.js';

/**
 * Input a test can drive. Directions are relative to where Hatch aims: up = forward. look is
 * a per-frame turn (radians) that tests can set.
 */
export function scriptedInput() {
  const held = new Set();
  let pressed = new Set();
  const taps = new Set();
  let look = { x: 0, y: 0 };
  return {
    down: (a) => held.has(a),
    pressed: (a) => pressed.has(a),
    hold: (a) => held.add(a),
    release: (a) => held.delete(a),
    tap(a) {
      pressed.add(a);
      held.add(a);
      taps.add(a);
    },
    setLook(x, y = 0) {
      look = { x, y };
    },
    look: () => look,
    moveVector(aimYaw) {
      const fwd = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0);
      const right = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      const f = { x: Math.cos(aimYaw), z: Math.sin(aimYaw) };
      const r = { x: -Math.sin(aimYaw), z: Math.cos(aimYaw) };
      const x = f.x * fwd + r.x * right;
      const z = f.z * fwd + r.z * right;
      const len = Math.hypot(x, z) || 1;
      return { x: x / len, z: z / len };
    },
    endFrame() {
      pressed = new Set();
      for (const a of taps) held.delete(a);
      taps.clear();
      look = { x: 0, y: 0 };
    },
  };
}

/** A mission with no waves arriving on their own, so each test sets the scene. */
export function quietGame(missionIndex = 0, opts = {}) {
  const input = scriptedInput();
  const game = new Game({ input, missionIndex, ...opts });
  game.quiet = true;
  return { game, input };
}

export function step(game, input, frames = 1, each = null) {
  for (let i = 0; i < frames; i++) {
    each?.(i);
    game.update();
    input.endFrame?.();
  }
}

/** Runs fn with Math.random replaced by a seeded generator, so random AI choices repeat. */
export function seeded(seed, fn) {
  const random = Math.random;
  Math.random = createRng(seed).next;
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

/**
 * A clear range for a test: removes the cover and blocks from the first 40 m of an area and
 * returns a spot in the middle of it.
 */
export function openSpot(game, area = 0) {
  const a = game.level.areas[area];
  const x0 = a.x0 + 2;
  const x1 = a.x0 + 42;
  game.level.boxes = game.level.boxes.filter((b) => !((b.kind === 'cover' || b.kind === 'block' || b.kind === 'target') && b.x1 > x0 && b.x0 < x1));
  rebuildGrid(game.level);
  game.level.cover = game.level.cover.filter((p) => game.level.boxes.includes(p.box));
  return { x: a.x0 + 10, z: 0 };
}
