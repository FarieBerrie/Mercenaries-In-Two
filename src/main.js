// MERCENARIES IN TWO: boots the game and runs it. Holds the flow between screens (title, menus,
// loading, the mission intro, play, pause, extraction, results), steps the simulation at a fixed
// 60 Hz with the view blended in between, and feeds the renderer, HUD, audio and menus.
import { createAudio } from './audio.js';
import { createBarks } from './barks.js';
import { createBot } from './bot.js';
import { createDirector } from './camera.js';
import { STEP } from './config.js';
import { Game } from './game.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { completeMission, createProgress, loadProgress, saveProgress } from './progress.js';
import { onProgress } from './gfx/assets.js';
import { createRenderer, PROFILE, rememberPositions } from './render3d.js';
import { DIFFICULTY, loadSettings, QUALITY, saveSettings } from './settings.js';
import { createUI } from './ui.js';

const $ = (id) => document.getElementById(id);
const viewCanvas = $('view');
const hudCanvas = $('hud');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const settings = loadSettings();
const progress = loadProgress(globalThis.localStorage);
// The masks the two of them start out wearing are theirs to keep
for (const who of ['hatch', 'cruz']) if (!progress.masks.includes(progress[who].pattern)) progress.masks.push(progress[who].pattern);
const audio = createAudio(settings);
const input = createInput(viewCanvas, settings);
// The renderer needs the GPU set up first, so it's created in boot()
let renderer = null;
const director = createDirector(settings);
const hud = createHud(hudCanvas, { project: (...a) => renderer.project(...a), settings });
const barks = createBarks((who, line) => hud.say(who, line));

let state = 'boot'; // boot | title | menu | loading | intro | play | paused | outro | debrief | failing | failed
let stateT = 0;
let game = null; // the mission being played
let missionIndex = 0;
let demo = null; // { game, bot } playing behind the menus
let acc = 0;
let clock = 0;
let slowmo = { k: 1, until: 0 };
let flash = 0;
let fx = { redline: 0, slow: 0, desat: 0 };
let lastView = null;
let resumeAt = 0;
// For automated runs in the browser: an autopilot can play Hatch, and losing the mouse needn't pause
const debug = { autopilot: null, noPause: false, view: null, speed: 1, god: false };

// ------------------------------------------------------------ the armory turntable

const previewCanvas = document.createElement('canvas');
previewCanvas.id = 'preview';
let previewApi = null;
const preview = {
  attach(placeholder) {
    placeholder.replaceWith(previewCanvas);
    if (!previewApi) {
      import('./preview.js')
        .then(async ({ createPreview }) => {
          previewApi = await createPreview(previewCanvas, settings.backend);
          if (preview.pending) previewApi.show(...preview.pending);
        })
        .catch((e) => console.error('armory preview:', e));
    }
  },
  show(who, mask) {
    preview.pending = [who, mask];
    previewApi?.show(who, mask);
  },
};

// ------------------------------------------------------------ the app, as the menus see it

const looks = () => ({ hatch: progress.hatch, cruz: progress.cruz });

const app = {
  progress,
  settings,
  audio,
  preview,
  get game() {
    return game;
  },
  /** Which GPU and API we're drawing with, for the settings screen. */
  get gpu() {
    return renderer?.gpu;
  },
  menuActive: () => !['play', 'intro', 'outro', 'failing', 'loading'].includes(state),
  save: () => saveProgress(globalThis.localStorage, progress),

  startGame() {
    if (state !== 'title') return;
    audio.unlock();
    audio.setTheme('menu');
    audio.setMusic('menu');
    audio.ui('select');
    setState('menu');
    ui.show('main');
  },

  applySettings(key) {
    saveSettings(settings);
    if (key === 'quality') renderer.setQuality(QUALITY[settings.quality]);
    if (key === 'backend') setTimeout(() => location.reload(), 250);
    if (key === 'difficulty' && game) game.difficulty = DIFFICULTY[settings.difficulty].damage;
    if (['master', 'music', 'sfx'].includes(key)) audio.applyVolumes();
  },

  async deploy(i) {
    if (state === 'loading') return;
    missionIndex = i;
    input.lock(); // while we still have the click or key press that asked for it
    $('fade').classList.add('on');
    await sleep(600);
    setState('loading');
    ui.show('loading', i);
    $('fade').classList.remove('on');
    audio.setMusic('off');
    await nextFrame();
    await nextFrame();
    const t0 = performance.now();
    // The loading bar follows the files coming in
    const start = { done: null };
    const off = onProgress((done, total) => {
      start.done ??= done;
      const bar = document.querySelector('.loading .bar i');
      if (bar) bar.style.width = `${Math.round((80 * (done - start.done)) / Math.max(1, total - start.done))}%`;
    });
    game = new Game({ input, audio: gameAudio, missionIndex: i, progress, difficulty: DIFFICULTY[settings.difficulty].damage });
    game.on(onGameEvent);
    await renderer.setGame(game, looks());
    off();
    // Compile every shader now rather than mid-fight
    await renderer.warm(director.intro(game, 0, 0));
    const bar = document.querySelector('.loading .bar i');
    if (bar) bar.style.width = '100%';
    renderer.render(game, director.intro(game, 0, 0), 0, 1);
    hud.reset();
    director.reset();
    const wait = Math.max(0, 1800 - (performance.now() - t0));
    await sleep(wait);
    $('fade').classList.add('on');
    await sleep(600);
    ui.hide();
    audio.setTheme(game.level.theme);
    audio.setMusic('mission');
    audio.setIntensity(0);
    $('bars').classList.add('on');
    setState('intro');
    $('fade').classList.remove('on');
    audio.sfx('area');
  },

  resume() {
    if (state !== 'paused') return;
    ui.hide();
    input.lock();
    input.setEnabled(true);
    resumeAt = performance.now();
    setState('play');
  },

  restart() {
    game.restart();
    director.reset();
    hud.reset();
    resetFeedback();
    slowmo = { k: 1, until: 0 };
    $('bars').classList.remove('on');
    app.resume();
  },

  retry() {
    if (state !== 'failed') return;
    setState('paused');
    app.restart();
    audio.setMusic('mission');
  },

  abandon() {
    toMenu('contracts');
  },

  toMenu(screen) {
    toMenu(screen);
  },
};

const ui = createUI($('ui'), app);

/** Sounds from the game also cue dialogue. */
const gameAudio = {
  sfx(name, at) {
    audio.sfx(name, at);
    if (game) barks.sound(name, game, clock);
  },
};

function setState(s) {
  state = s;
  stateT = 0;
}

async function toMenu(screen = 'main') {
  $('fade').classList.add('on');
  await sleep(500);
  input.unlock();
  input.setEnabled(true);
  $('bars').classList.remove('on');
  game = null;
  audio.heli(null);
  audio.setDowned(false);
  audio.setMuffle(0);
  audio.setTheme('menu');
  audio.setMusic('menu');
  ensureDemo();
  setState('menu');
  ui.show('main');
  if (screen !== 'main') ui.go(screen);
  $('fade').classList.remove('on');
}

// ------------------------------------------------------------ game events

function onGameEvent(type, data) {
  hud.onEvent(type, data, game);
  barks.event(type, data, game, clock);
  if (type === 'kill') {
    if (data.enemy.type && ['warlord', 'enforcer', 'warden'].includes(data.enemy.type)) slowmo = { k: 0.25, until: clock + 1.6 };
    else if (data.source === game.hatch) audio.hit(true, data.tag === 'HEADSHOT');
  }
  if (type === 'areaCleared') slowmo = { k: 0.4, until: clock + 0.8 };
  if (type === 'explosion') {
    const d = Math.hypot(data.x - game.hatch.x, data.z - game.hatch.z);
    flash = Math.max(flash, 0.35 * Math.max(0, 1 - d / 25));
  }
  if (type === 'complete') {
    setState('outro');
    $('bars').classList.add('on');
    input.setEnabled(false);
  }
  if (type === 'failed') {
    setState('failing');
    input.setEnabled(false);
    audio.setMusic('down');
  }
}

/** Moments worth a line of dialogue that the game doesn't announce. */
let lastMode = 'play';
let lastGrenades = 0;
function watchMoments() {
  if (game.mode !== lastMode) {
    if (game.mode === 'snipe') barks.say('snipe', clock, { force: true });
    lastMode = game.mode;
  }
  if (game.grenades.length > lastGrenades) {
    const g = game.grenades[game.grenades.length - 1];
    if (g.team !== 'contractors' && Math.hypot(g.x - game.hatch.x, g.z - game.hatch.z) < 14) barks.say('grenade', clock, { force: true });
  }
  lastGrenades = game.grenades.length;
  for (const a of game.level.areas) {
    for (const o of a.objectives) {
      if (o.done && !o._said) {
        o._said = true;
        if (o.kind === 'rescue') barks.say('hostage', clock, { force: true });
      }
    }
  }
}

// ------------------------------------------------------------ the title-screen demo

function ensureDemo() {
  if (demo && demo.game.mode !== 'complete') return renderer.setGame(demo.game, looks(), { skyTheme: 'menu' });
  const bot = createBot();
  const g = new Game({ input: bot, missionIndex: 0, progress: createProgress() });
  bot.attach(g);
  demo = { game: g, bot };
  return renderer.setGame(g, looks(), { skyTheme: 'menu' });
}

function stepDemo() {
  const g = demo.game;
  rememberPositions(g);
  for (const c of g.contractors) if (!c.downed) c.hp = c.maxHp; // the demo never loses
  demo.bot.update();
  g.update();
  if (g.mode === 'failed') g.restart();
  if (g.mode === 'complete' && g.modeT > 240) {
    demo = null;
    ensureDemo();
  }
}

// ------------------------------------------------------------ the frame

function musicIntensity(g) {
  if (g.mode === 'backToBack' || g.bossActive) return 3;
  const alive = g.enemies.filter((e) => !e.dead).length;
  return alive >= 5 ? 2 : alive > 0 ? 1 : 0;
}

function feedback(g, dt) {
  const u = renderer.post.uniforms;
  const h = g.hatch;
  const damage = hud.hurt(g, dt);
  const smooth = (cur, target, rate) => cur + (target - cur) * Math.min(1, dt * rate);
  fx.redline = smooth(fx.redline, g.overkill ? (g.overkill.who === 'hatch' ? 0.9 : 0.45) * (0.75 + Math.sin(clock * 6) * 0.25) : 0, 6);
  fx.slow = smooth(fx.slow, g.timeScale < 1 || clock < slowmo.until ? 1 : 0, 5);
  fx.desat = smooth(fx.desat, h.downed ? 0.85 : state === 'failing' ? 1 : Math.max(0, 0.6 - h.hp / h.maxHp) * 0.8, 4);
  flash = Math.max(0, flash - dt * 1.6);
  u.damage.value = damage;
  u.redline.value = fx.redline;
  u.slowmo.value = fx.slow;
  u.desat.value = fx.desat;
  u.flash.value = flash;
  u.scope.value = g.mode === 'snipe' ? 1 : 0;
  if (!renderer.post.enabled) $('hurt').style.opacity = damage;
  audio.setMuffle(h.downed ? 0.75 : fx.slow * 0.35 + damage * 0.25);
  audio.setDowned(!!h.downed && !h.gone);
}

function resetFeedback() {
  const u = renderer.post.uniforms;
  for (const k of ['damage', 'redline', 'slowmo', 'desat', 'flash', 'scope']) u[k].value = 0;
  $('hurt').style.opacity = 0;
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  stateT += dt;
  input.poll(dt);
  hud.setDevice(input.device);
  if (app.menuActive()) ui.update(dt);

  if (state === 'title' || state === 'menu' || state === 'debrief' || state === 'failed' || state === 'paused') {
    if (state === 'paused' && game) {
      if (input.device === 'gamepad' && input.pressed('pause')) app.resume();
      input.endStep();
      return; // the last frame stays on screen behind the menu
    }
    if (!demo) return;
    if ((state === 'debrief' || state === 'failed') && game) {
      // Keep the finished mission on screen behind its results
      input.endStep();
      return;
    }
    acc += dt;
    while (acc >= STEP) {
      stepDemo();
      acc -= STEP;
    }
    resetFeedback();
    const view = director.orbit(demo.game, clock, acc / STEP);
    renderer.render(demo.game, view, clock, acc / STEP);
    audio.setListener(view.position.x, view.position.y, view.position.z, 0);
    hud.clear();
    if (state === 'menu' && ui.current === 'armory' && previewApi) previewApi.render(clock);
    input.endStep();
    return;
  }

  if (!game) return;

  if (state === 'intro') {
    const k = stateT / 4.2;
    const view = director.intro(game, k, clock);
    resetFeedback();
    renderer.render(game, view, clock, 1);
    hud.draw(game, view, { dt, progress, cinematic: true, intro: { k, mission: game.mission, index: missionIndex } });
    if (k >= 1 || (stateT > 0.8 && (input.pressed('fire') || input.pressed('use') || input.pressed('vault')))) {
      $('bars').classList.remove('on');
      input.look(); // drop any mouse movement from the fly-in
      setState('play');
      resumeAt = performance.now();
    }
    input.endStep();
    lastView = view;
    return;
  }

  // Lost the mouse (Esc, alt-tab): pause, unless playing on a gamepad
  if (state === 'play' && !input.locked && !debug.noPause && input.device !== 'gamepad' && performance.now() - resumeAt > 600) {
    pause();
    return;
  }
  if (state === 'play' && input.pressed('pause')) {
    pause();
    return;
  }

  // Step the game at 60 Hz; time slows for back-to-back, big kills, and failure
  const scale = (game.timeScale ?? 1) * (clock < slowmo.until ? slowmo.k : 1) * (state === 'failing' ? 0.35 : 1);
  acc += dt * scale * debug.speed;
  let steps = 0;
  const maxSteps = debug.speed > 1 ? 60 : 6;
  while (acc >= STEP && steps < maxSteps) {
    rememberPositions(game);
    const ts = performance.now();
    debug.autopilot?.update();
    if (debug.god) for (const c of game.contractors) if (!c.downed) c.hp = c.maxHp;
    game.update();
    if (PROFILE.on) PROFILE.sum.sim += performance.now() - ts;
    input.endStep();
    acc -= STEP;
    steps++;
  }
  if (steps === maxSteps) acc = 0;
  input.zoomed = game.hatch.aiming;
  const alpha = Math.min(1, acc / STEP);

  let view;
  if (state === 'outro') view = director.outro(game, Math.min(1, stateT / 10), clock, renderer.heliPosition);
  else if (state === 'failing') view = director.failed(game, stateT / 3);
  else view = debug.view ? debug.view(game, clock) : director.play(game, alpha, input.peekLook(), clock);
  lastView = view;

  feedback(game, dt);
  renderer.render(game, view, clock, alpha);
  const th = performance.now();
  hud.draw(game, view, { dt, progress, cinematic: state === 'outro' });
  if (PROFILE.on) PROFILE.sum.hud += performance.now() - th;
  audio.setListener(view.position.x, view.position.y, view.position.z, view.yaw ?? game.hatch.aimYaw);
  audio.setIntensity(musicIntensity(game));
  if (state === 'play') {
    audio.setMusic(game.hatch.downed ? 'down' : 'mission');
    watchMoments();
  }

  if (state === 'outro' && ((renderer.extracted && stateT > 4) || stateT > 16)) finishMission();
  if (state === 'failing' && stateT > 3) {
    setState('failed');
    input.unlock();
    input.setEnabled(true);
    ui.show('failed', game.failReason || 'CONTRACT FAILED');
  }
}

function pause() {
  setState('paused');
  input.unlock();
  input.setEnabled(true);
  audio.heli(null);
  ui.show('pause');
}

function finishMission() {
  const g = game;
  const r = { name: g.mission.name, pay: g.mission.pay, earned: g.earned, stats: g.stats };
  const s = g.stats;
  const accuracy = s.kills ? s.headshots / s.kills : 0;
  r.grade = s.downs === 0 && s.restarts === 0 && accuracy >= 0.25 ? 'S' : s.downs <= 1 && s.restarts === 0 ? 'A' : s.restarts <= 1 ? 'B' : 'C';
  completeMission(progress, missionIndex, g.earned);
  app.save();
  setState('debrief');
  input.unlock();
  input.setEnabled(true);
  $('bars').classList.remove('on');
  audio.setMusic('menu');
  ui.show('debrief', r);
}

// ------------------------------------------------------------ boot

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer?.resize(w, h);
  hud.resize(w, h);
}
window.addEventListener('resize', resize);
document.addEventListener('pointerlockchange', () => {
  if (!input.locked && state === 'play' && !debug.noPause && input.device !== 'gamepad' && performance.now() - resumeAt > 600) pause();
});
viewCanvas.addEventListener('click', () => {
  if (state === 'play' && !input.locked) input.lock();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'play') pause();
});

async function boot() {
  const bar = document.querySelector('.boot-bar i');
  bar.style.width = '8%';
  renderer = await createRenderer(
    viewCanvas,
    QUALITY[settings.quality],
    {
      footstep: (at, loud) => audio.footstep(at, loud),
      whiz: (side) => audio.whiz(side),
      impact: (at, kind) => audio.impact(at, kind),
      heli: (at) => audio.heli(at),
    },
    { backend: settings.backend },
  );
  resize();
  const off = onProgress((done, total) => (bar.style.width = `${10 + Math.round((70 * done) / Math.max(1, total))}%`));
  try {
    await Promise.all([renderer.prepare('menu'), Promise.race([document.fonts?.ready, sleep(1500)])]);
  } catch (e) {
    console.error(e);
  }
  off();
  bar.style.width = '85%';
  await nextFrame();
  await ensureDemo();
  for (let i = 0; i < 90; i++) stepDemo(); // let the demo get going before anyone sees it
  await renderer.warm(director.orbit(demo.game, 0, 1));
  renderer.render(demo.game, director.orbit(demo.game, 0, 1), 0, 1);
  bar.style.width = '100%';
  await sleep(350);
  setState('title');
  ui.show('title');
  $('boot').classList.add('done');
  $('fade').classList.remove('on');
  requestAnimationFrame(frame);
}

// A handle for automated testing in the browser console (development builds only)
if (import.meta.env?.DEV) window.__dc = {
  app,
  debug,
  ui,
  settings,
  createBot,
  get game() {
    return game;
  },
  get demo() {
    return demo;
  },
  get state() {
    return state;
  },
  get renderer() {
    return renderer;
  },
  get previewApi() {
    return previewApi;
  },
  pause: () => pause(),
  profile: PROFILE,
  /** Hands Hatch to the autopilot (for testing). */
  autopilot() {
    const bot = createBot();
    bot.attach(game);
    game.input = bot;
    debug.autopilot = bot;
    debug.noPause = true;
  },
};

boot();
