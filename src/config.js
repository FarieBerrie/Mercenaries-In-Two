// Names shown in the game. Everything here is original.
export const GAME = {
  title: 'DOUBLE CONTRACT',
  tagline: 'TWO CONTRACTORS. ONE PAYCHECK.',
  player: 'HATCH',
  partner: 'CRUZ',
};

// The simulation runs at a fixed 60 steps a second. World units are metres; +x runs forward
// through each mission, y is up.
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
  back: 3.4, // metres behind the player
  right: 0.65, // over the right shoulder
  up: 0.25, // above eye level
  aimBack: 1.5, // closer in when aiming down sights
  aimRight: 0.55,
  fov: 62,
  aimFov: 38,
};

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
