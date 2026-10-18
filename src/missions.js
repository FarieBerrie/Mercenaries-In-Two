// The contracts. Each mission is an open map (maps.js) with four places to take, spread across
// it: walk into one and its defenders come at you, wave after wave, the next when the last is
// nearly finished. Some places are walled or fenced in and only open up when the one before is
// done; the rest you can take in any order. Patrols walk the roads between them. Once every place
// is taken, get to the extraction point.
//
// Area options:
//   waves: [[type, count], ...] per wave
//   plant: n, charges to set on the n targets maps.js puts in the area
//   rescue: true, a hostage to free
//   boost: true, the area ends at a wall you need a step-jump to get over
//   snipe: true, the area opens with a co-op sniper nest and marksmen on far towers
//   backToBack: true, an ambush from all sides as soon as you walk in
//   boss: enemy type to fight in this area
//   extract: true, reach the extraction point once everything's clear to finish

export const MISSIONS = [
  {
    id: 'dust-devil',
    name: 'DUST DEVIL',
    place: 'Desert pueblo and compound',
    theme: 'desert',
    brief: 'A cartel warlord is shooting down relief flights from his walled compound past the pueblo. Take out his anti-air guns, then him.',
    pay: 5000,
    areas: [
      { name: 'THE VILLAGE', waves: [[['rifleman', 4]], [['rifleman', 3], ['shotgunner', 1]]] },
      { name: 'OUTER WALL', waves: [[['rifleman', 3], ['sniper', 1]]], boost: true },
      { name: 'THE COMPOUND', waves: [[['rifleman', 4], ['shotgunner', 2]], [['rifleman', 3], ['heavy', 1]]], plant: 2 },
      { name: 'LANDING ZONE', waves: [[['rifleman', 3]]], boss: 'warlord', extract: true },
    ],
  },
  {
    id: 'low-tide',
    name: 'LOW TIDE',
    place: 'Night port',
    theme: 'port',
    brief: "The cartel's man at the docks is holding an engineer in a warehouse. Get in quietly, get him out loudly.",
    pay: 7000,
    areas: [
      { name: 'CONTAINER YARD', waves: [[['rifleman', 5]], [['shotgunner', 2], ['rifleman', 2]]] },
      { name: 'THE GANTRIES', waves: [[['rifleman', 4]]], snipe: true },
      { name: 'WAREHOUSE', waves: [[['rifleman', 4], ['heavy', 1]], [['shotgunner', 3]]], rescue: true },
      { name: 'THE DOCKS', waves: [[['rifleman', 3]]], backToBack: true, boss: 'enforcer', extract: true },
    ],
  },
  {
    id: 'whiteout',
    name: 'WHITEOUT',
    place: 'Mountain base',
    theme: 'snow',
    brief: 'The cartel has taken a mountain radar station to guide its smuggling flights. Knock it out and bring down the man who runs it.',
    pay: 9000,
    areas: [
      { name: 'CHECKPOINT', waves: [[['rifleman', 5], ['sniper', 1]], [['rifleman', 3], ['shotgunner', 2]]] },
      { name: 'THE BUNKERS', waves: [[['heavy', 2], ['rifleman', 3]]], boost: true },
      { name: 'RADAR FIELD', waves: [[['rifleman', 4], ['shotgunner', 2], ['sniper', 1]]], plant: 2 },
      { name: 'THE SUMMIT', waves: [[['rifleman', 4]], [['rifleman', 3], ['shotgunner', 2]]], boss: 'warden', extract: true },
    ],
  },
];
