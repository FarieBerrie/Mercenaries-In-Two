// What the two contractors say to each other, as subtitles. Lines are picked by what just
// happened, with a cooldown so they don't talk over the fight. All dialogue is original.

const LINES = {
  area: [
    ['CRUZ', 'Contact front. Let\'s earn the money.'],
    ['CRUZ', 'Here they come. Stay on me.'],
    ['CRUZ', 'Eyes up. They know we\'re here.'],
    ['HATCH', 'Weapons free.'],
  ],
  clear: [
    ['CRUZ', 'Clear. Moving up.'],
    ['CRUZ', 'That\'s the last of them.'],
    ['HATCH', 'Area secure. Let\'s go.'],
    ['CRUZ', 'Quiet again. For now.'],
  ],
  headshot: [
    ['CRUZ', 'Clean shot.'],
    ['CRUZ', 'Nice. Right between the eyes.'],
    ['CRUZ', 'Show-off.'],
  ],
  cruzKill: [
    ['CRUZ', 'Got one.'],
    ['CRUZ', 'Target down.'],
    ['CRUZ', 'He\'s done.'],
  ],
  flank: [
    ['CRUZ', 'Hit him from the side. Good.'],
    ['HATCH', 'Got him from behind.'],
  ],
  redlineHatch: [
    ['CRUZ', 'They\'re all on you. I\'m going round!'],
    ['HATCH', 'Over here, you idiots!'],
  ],
  redlineCruz: [
    ['CRUZ', 'I\'ve got their attention. Flank them!'],
    ['CRUZ', 'They\'re on me. Go, go!'],
  ],
  hatchDown: [
    ['CRUZ', 'Hatch! Hang on, I\'m coming!'],
    ['CRUZ', 'Stay with me! On my way!'],
  ],
  cruzDown: [
    ['CRUZ', 'I\'m hit! Get over here!'],
    ['CRUZ', 'Hatch! Need a hand!'],
  ],
  revivedHatch: [
    ['CRUZ', 'Up you get. You owe me.'],
    ['CRUZ', 'Back on your feet. Don\'t do that again.'],
  ],
  revivedCruz: [
    ['CRUZ', 'Thanks, partner.'],
    ['CRUZ', 'Took your time.'],
  ],
  boss: [
    ['CRUZ', 'Big one. Front plate\'s solid. Hit him from the side!'],
    ['HATCH', 'Armour up front. Split up and flank him.'],
  ],
  bossDown: [
    ['CRUZ', 'That\'s the paycheck right there.'],
    ['HATCH', 'Target eliminated.'],
  ],
  charge: [
    ['HATCH', 'Charge set. Fire in the hole!'],
    ['CRUZ', 'Charge is live, get clear!'],
  ],
  hostage: [
    ['HATCH', 'Easy. We\'re here to get you out.'],
  ],
  extract: [
    ['CRUZ', 'Bird\'s inbound. Get to the pad!'],
    ['CRUZ', 'Ride\'s here. Let\'s get paid.'],
  ],
  complete: [
    ['CRUZ', 'Payday.'],
    ['CRUZ', 'Drinks are on you.'],
  ],
  boost: [
    ['CRUZ', 'Wall\'s too high. Give you a lift. Go!'],
  ],
  snipe: [
    ['CRUZ', 'Take your shot. I\'ll match it.'],
  ],
  b2b: [
    ['CRUZ', 'They\'re all around us! Cover my six, I\'ve got yours!'],
  ],
  grenade: [
    ['CRUZ', 'Grenade! Move!'],
  ],
};

export function createBarks(say) {
  let quietUntil = 0;
  const last = new Map();

  function speak(kind, now, { force = false, chance = 1 } = {}) {
    if (!force && (now < quietUntil || Math.random() > chance)) return;
    const pool = LINES[kind];
    if (!pool) return;
    // Don't say the same line twice in a row
    let i = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && i === last.get(kind)) i = (i + 1) % pool.length;
    last.set(kind, i);
    const [who, line] = pool[i];
    say(who, line);
    quietUntil = now + 3.5;
  }

  return {
    /** Reacts to a game event. now: seconds. */
    event(type, data, game, now) {
      if (type === 'kill') {
        if (['warlord', 'enforcer', 'warden'].includes(data.enemy.type)) speak('bossDown', now, { force: true });
        else if (data.source === game.cruz) speak('cruzKill', now, { chance: 0.25 });
        else if (data.tag === 'HEADSHOT') speak('headshot', now, { chance: 0.3 });
        else if (data.tag === 'FLANKED') speak('flank', now, { chance: 0.25 });
      }
      if (type === 'redline') speak(data === 'hatch' ? 'redlineHatch' : 'redlineCruz', now, { force: true });
      if (type === 'down') speak(data === game.hatch ? 'hatchDown' : 'cruzDown', now, { force: true });
      if (type === 'revive') speak(data === game.hatch ? 'revivedHatch' : 'revivedCruz', now, { force: true });
      if (type === 'areaCleared') {
        const area = game.level.areas[data];
        speak(area.extract ? 'extract' : 'clear', now, { force: true });
      }
      if (type === 'complete') speak('complete', now, { force: true });
    },
    /** Reacts to the game's sound cues, which mark moments the events don't. */
    sound(name, game, now) {
      if (name === 'area') {
        const area = game.level.areas[game.checkpoint];
        if (area.spec.backToBack) speak('b2b', now, { force: true });
        else if (area.spec.boss) setTimeout(() => speak('boss', performance.now() / 1000, { force: true }), 1500);
        else speak('area', now, { force: true });
      }
      if (name === 'plant') speak('charge', now, { force: true });
      if (name === 'boost') speak('boost', now, { force: true });
    },
    say: speak,
  };
}
