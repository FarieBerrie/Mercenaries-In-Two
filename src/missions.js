// The contracts. Each mission is a run of areas laid out along +x; each area is sealed at the
// far end until its enemies are dead and its objectives done. Waves spawn one after another,
// the next when the last is nearly finished.
//
// Area options:
//   waves: [[type, count], ...] per wave
//   plant: [[x, z], ...] places to set charges (positions relative to the area: x from its start)
//   rescue: [x, z] a hostage to free
//   boost: true, the area ends in a wall you need a step-jump to get over
//   snipe: true, the area opens with a co-op sniper nest and targets on the far towers
//   backToBack: true, an ambush from all sides as soon as you walk in
//   boss: enemy type to fight in this area
//   extract: true, reach the extraction point once the area is clear to finish

export const MISSIONS = [
  {
    id: 'dust-devil',
    name: 'DUST DEVIL',
    place: 'Desert compound',
    theme: 'desert',
    brief: 'A warlord is shooting down relief flights from a walled compound. Take out his anti-air guns, then him.',
    pay: 5000,
    areas: [
      { name: 'THE VILLAGE', length: 70, waves: [[['rifleman', 4]], [['rifleman', 3], ['shotgunner', 1]]] },
      { name: 'OUTER WALL', length: 60, waves: [[['rifleman', 3], ['sniper', 1]]], boost: true },
      { name: 'THE COMPOUND', length: 80, waves: [[['rifleman', 4], ['shotgunner', 2]], [['rifleman', 3], ['heavy', 1]]], plant: [[30, -12], [55, 12]] },
      { name: 'LANDING ZONE', length: 64, waves: [[['rifleman', 3]]], boss: 'warlord', extract: true },
    ],
  },
  {
    id: 'low-tide',
    name: 'LOW TIDE',
    place: 'Night port',
    theme: 'port',
    brief: 'A shipping magnate is holding an engineer in a dockside warehouse. Get in quietly, get him out loudly.',
    pay: 7000,
    areas: [
      { name: 'CONTAINER YARD', length: 80, waves: [[['rifleman', 5]], [['shotgunner', 2], ['rifleman', 2]]] },
      { name: 'THE GANTRIES', length: 70, waves: [[['rifleman', 4]]], snipe: true },
      { name: 'WAREHOUSE', length: 70, waves: [[['rifleman', 4], ['heavy', 1]], [['shotgunner', 3]]], rescue: [50, 0] },
      { name: 'THE DOCKS', length: 72, waves: [[['rifleman', 3]]], backToBack: true, boss: 'enforcer', extract: true },
    ],
  },
  {
    id: 'whiteout',
    name: 'WHITEOUT',
    place: 'Mountain base',
    theme: 'snow',
    brief: 'The radar on this mountain is guiding missiles. Knock it out and bring down the man who runs it.',
    pay: 9000,
    areas: [
      { name: 'CHECKPOINT', length: 70, waves: [[['rifleman', 5], ['sniper', 1]], [['rifleman', 3], ['shotgunner', 2]]] },
      { name: 'THE BUNKERS', length: 80, waves: [[['heavy', 2], ['rifleman', 3]]], boost: true },
      { name: 'RADAR FIELD', length: 70, waves: [[['rifleman', 4], ['shotgunner', 2], ['sniper', 1]]], plant: [[25, 10], [50, -10]] },
      { name: 'THE SUMMIT', length: 80, waves: [[['rifleman', 4]], [['rifleman', 3], ['shotgunner', 2]]], boss: 'warden', extract: true },
    ],
  },
];
