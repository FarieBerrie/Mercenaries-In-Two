// Player settings, kept in the browser between sessions.
const KEY = 'mercenaries-in-two.settings';
const OLD_KEY = 'double-contract.settings'; // the game's name before, still read so old settings load

/**
 * Graphics presets: what the renderer trades for speed. pixelRatio caps the render resolution
 * against the screen's; shadows is the shadow map size and cascades how many slices cover the
 * view; ao is ambient occlusion ('half' or 'full' resolution); motionBlur is a sample count; aa
 * is 'fxaa' or 'smaa'; fx scales particle counts; detail scales scenery.
 */
export const QUALITY = {
  low: { label: 'LOW', pixelRatio: 0.75, shadows: 1024, cascades: 1, post: true, bloom: true, flare: false, ao: false, motionBlur: 0, aa: 'fxaa', fx: 0.5, detail: 0.5 },
  medium: { label: 'MEDIUM', pixelRatio: 1, shadows: 2048, cascades: 2, post: true, bloom: true, flare: true, ao: false, motionBlur: 0, aa: 'fxaa', fx: 0.8, detail: 0.75 },
  high: { label: 'HIGH', pixelRatio: 1.25, shadows: 2048, cascades: 3, post: true, bloom: true, flare: true, ao: 'half', motionBlur: 8, aa: 'smaa', fx: 1, detail: 1 },
  ultra: { label: 'ULTRA', pixelRatio: 2, shadows: 4096, cascades: 3, post: true, bloom: true, flare: true, ao: 'full', motionBlur: 12, aa: 'smaa', fx: 1.25, detail: 1.25 },
};

/** How hard the enemies hit. */
export const DIFFICULTY = {
  recruit: { label: 'RECRUIT', damage: 0.55 },
  contractor: { label: 'CONTRACTOR', damage: 1 },
  veteran: { label: 'VETERAN', damage: 1.4 },
};

export const DEFAULTS = {
  difficulty: 'contractor',
  quality: 'high',
  sensitivity: 1,
  aimSensitivity: 0.7,
  invertY: false,
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  shake: 1,
  subtitles: true,
  fov: 0, // degrees added to the default field of view
  backend: 'auto', // 'auto' (WebGPU where available) or 'webgl'
};

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(KEY) ?? storage?.getItem(OLD_KEY);
    const s = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    if (!QUALITY[s.quality]) s.quality = DEFAULTS.quality;
    if (!DIFFICULTY[s.difficulty]) s.difficulty = DEFAULTS.difficulty;
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* not saved */
  }
}
