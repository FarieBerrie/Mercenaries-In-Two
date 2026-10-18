// Money, upgrades, unlocked missions and masks: the part of the game that carries between
// missions. Pure data and functions; main.js saves it in the browser.
import { HEALTH } from './config.js';
import { WEAPONS } from './weapons.js';

const SAVE_KEY = 'mercenaries-in-two.save';
const OLD_SAVE_KEY = 'double-contract.save'; // the game's name before, still read so old saves load

/** Upgrades for sale in the armory. Each level costs the next price in the list. */
export const SHOP = [
  { id: 'rifle-damage', name: 'RIFLE: HEAVY BARREL', desc: '+15% rifle damage', prices: [2000, 4000, 6500] },
  { id: 'rifle-mag', name: 'RIFLE: EXTENDED MAG', desc: '+10 rounds per magazine', prices: [1500, 3500] },
  { id: 'rifle-spread', name: 'RIFLE: STABILIZER', desc: '25% tighter spread', prices: [1500, 3500] },
  { id: 'pistol-damage', name: 'SIDEARM: MATCH ROUNDS', desc: '+25% sidearm damage', prices: [1000, 2500] },
  { id: 'armor', name: 'BODY ARMOR', desc: '+25 health for both of you', prices: [3000, 5000, 8000] },
  { id: 'grenades', name: 'GRENADE BELT', desc: '+1 grenade', prices: [1500, 3000] },
];

/** Mask designs (original patterns painted on a plain face plate). */
export const MASKS = [
  { id: 'plain', name: 'PLAIN', price: 0 },
  { id: 'stripe', name: 'RACING STRIPE', price: 500 },
  { id: 'split', name: 'SPLIT FACE', price: 750 },
  { id: 'chevron', name: 'CHEVRONS', price: 1000 },
  { id: 'hazard', name: 'HAZARD', price: 1200 },
  { id: 'teeth', name: 'GRIN', price: 1500 },
  { id: 'target', name: 'BULLSEYE', price: 2000 },
  { id: 'skull', name: 'CALAVERA', price: 2500 },
  { id: 'tribal', name: 'SERPENT', price: 3000 },
];
export const MASK_COLORS = ['#e8e4dc', '#2a2a2e', '#c03028', '#d8a020', '#3a6a3a', '#3060a0'];

export function createProgress() {
  return {
    money: 0,
    unlocked: 1, // missions available
    completed: [],
    upgrades: {},
    masks: ['plain'],
    hatch: { pattern: 'skull', base: '#e8e4dc', accent: '#2a2a2e' },
    cruz: { pattern: 'tribal', base: '#2a2a2e', accent: '#d8a020' },
  };
}

export const levelOf = (progress, id) => progress.upgrades[id] || 0;

/** The price of the next level of an upgrade, or null when it's maxed out. */
export function nextPrice(progress, id) {
  const item = SHOP.find((s) => s.id === id);
  return item.prices[levelOf(progress, id)] ?? null;
}

export function buyUpgrade(progress, id) {
  const price = nextPrice(progress, id);
  if (price === null || progress.money < price) return false;
  progress.money -= price;
  progress.upgrades[id] = levelOf(progress, id) + 1;
  return true;
}

export function buyMask(progress, id) {
  const mask = MASKS.find((m) => m.id === id);
  if (!mask || progress.masks.includes(id) || progress.money < mask.price) return false;
  progress.money -= mask.price;
  progress.masks.push(id);
  return true;
}

/** Weapons and health with upgrades applied, for both contractors. */
export function loadout(progress) {
  const lv = (id) => levelOf(progress, id);
  return {
    rifle: {
      ...WEAPONS.rifle,
      damage: WEAPONS.rifle.damage * (1 + 0.15 * lv('rifle-damage')),
      mag: WEAPONS.rifle.mag + 10 * lv('rifle-mag'),
      spread: WEAPONS.rifle.spread * 0.75 ** lv('rifle-spread'),
      aimSpread: WEAPONS.rifle.aimSpread * 0.75 ** lv('rifle-spread'),
    },
    pistol: { ...WEAPONS.pistol, damage: WEAPONS.pistol.damage * (1 + 0.25 * lv('pistol-damage')) },
    sniper: { ...WEAPONS.sniper },
    maxHp: HEALTH.max + 25 * lv('armor'),
    grenades: 3 + lv('grenades'),
  };
}

/** Pays out a finished mission and unlocks the next. */
export function completeMission(progress, missionIndex, earned) {
  progress.money += earned;
  if (!progress.completed.includes(missionIndex)) progress.completed.push(missionIndex);
  progress.unlocked = Math.max(progress.unlocked, missionIndex + 2);
}

export function loadProgress(storage) {
  try {
    const raw = storage?.getItem(SAVE_KEY) ?? storage?.getItem(OLD_SAVE_KEY);
    return raw ? { ...createProgress(), ...JSON.parse(raw) } : createProgress();
  } catch {
    return createProgress();
  }
}

export function saveProgress(storage, progress) {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(progress));
  } catch {
    /* not saved */
  }
}
