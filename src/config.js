// Names shown in the game. Everything here is original.
export const GAME = {
  title: 'MERCENARIES IN TWO',
  tagline: 'TWO CONTRACTORS. ONE PAYCHECK.',
  player: 'HATCH',
  partner: 'CRUZ',
};

// The simulation runs at a fixed 60 steps a second. World units are metres; y is up, and +x is
// the compass's north on each mission's open map.
export const STEP = 1 / 60;

export const PHYS = {
  gravity: 25,
  maxFall: 30,
  walk: 5.2,
  sprint: 8.2,
  crouch: 2.4,
  downed: 1, // crawling
  accel: 45,
  friction: 40,
};

export const BODY = {
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.15,
  eye: 1.62,
  crouchEye: 0.98,
};

// Over-the-shoulder camera, shared by aiming (game.js) and drawing (main.js) so the crosshair
// lines up exactly with where shots go.
export const CAMERA = {
  back: 2.75, // metres behind the player: a close over-the-shoulder view
  right: 0.78, // over the right shoulder
  up: 0.16, // above eye level
  aimBack: 1.35, // closer in when aiming down sights
  aimRight: 0.62,
  fov: 60,
  aimFov: 38,
};

/**
 * The camera's offset from the eye for an aim blend k (0 = hip, 1 = down the sights), eased so
 * the zoom settles softly. The aim ray and the drawn camera both use this, so they always agree.
 */
export function cameraOffset(k) {
  const s = k * k * (3 - 2 * k);
  return {
    back: CAMERA.back + (CAMERA.aimBack - CAMERA.back) * s,
    right: CAMERA.right + (CAMERA.aimRight - CAMERA.right) * s,
    fov: CAMERA.fov + (CAMERA.aimFov - CAMERA.fov) * s,
  };
}

export const HEALTH = {
  max: 100, // + armour upgrades
  regenDelay: 240, // frames without damage before health comes back
  regenRate: 25, // per second
  bleedOut: 1800, // frames a downed contractor has before they're gone
  reviveTime: 150, // frames of holding Use to revive
  revivedHealth: 0.4,
};

export const AGGRO = {
  max: 100,
  perShot: 1.4,
  perHit: 2.5,
  decay: 6, // per second, toward 0, when nobody is shooting
  overkillFrames: 600,
};

export const PAL = {
  white: '#f4f4f0',
  black: '#0a0a0c',
  red: '#e03a2a',
  green: '#58d070',
  yellow: '#f8c030',
  blue: '#40a0ff',
  grey: '#9a9aa2',
  orange: '#ff8a30',
};
