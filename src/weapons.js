// Weapons. rate is frames between shots, spread is the cone (radians) shots scatter in, reload
// is frames. Enemy weapons are tuned for fairness rather than realism.
export const WEAPONS = {
  rifle: { name: 'ASSAULT RIFLE', mag: 30, reserve: 240, damage: 22, rate: 6, spread: 0.022, aimSpread: 0.006, auto: true, reload: 110, range: 140 },
  pistol: { name: 'SIDEARM', mag: 12, reserve: Infinity, damage: 30, rate: 11, spread: 0.018, aimSpread: 0.005, auto: false, reload: 75, range: 90 },
  sniper: { name: 'MARKSMAN RIFLE', mag: 5, reserve: 20, damage: 400, rate: 45, spread: 0.0008, aimSpread: 0, auto: false, reload: 130, range: 400 },
  grenade: { damage: 160, radius: 5.5, fuse: 150 },

  enemyRifle: { damage: 6, rate: 9, spread: 0.07, mag: 20, reload: 120, range: 60 },
  shotgun: { damage: 8, pellets: 7, rate: 55, spread: 0.13, mag: 6, reload: 140, range: 22 },
  enemySniper: { damage: 40, rate: 170, spread: 0.006, mag: 5, reload: 150, range: 140 },
  lmg: { damage: 5, rate: 5, spread: 0.09, mag: 60, reload: 180, range: 60 },
  minigun: { damage: 4, rate: 3, spread: 0.1, mag: 120, reload: 200, range: 60 },
};
