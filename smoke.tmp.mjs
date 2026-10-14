import { createBot } from './src/bot.js';
import { Game } from './src/game.js';
for (const mi of [0, 1, 2]) {
  const bot = createBot();
  const g = new Game({ input: bot, missionIndex: mi });
  bot.attach(g);
  let f = 0, lastArea = -1, modes = new Set();
  const t0 = Date.now();
  while (f < 60 * 60 * 8 && g.mode !== 'complete' && g.mode !== 'failed') {
    for (const c of g.contractors) { if (!c.downed) c.hp = c.maxHp; }
    bot.update(); g.update(); f++;
    modes.add(g.mode);
    if (g.checkpoint !== lastArea) { lastArea = g.checkpoint; console.log(`  m${mi} t=${(f/60).toFixed(0)}s area ${g.checkpoint} ${g.level.areas[g.checkpoint].name} x=${g.hatch.x.toFixed(0)}`); }
  }
  const area = g.level.areas[g.checkpoint];
  console.log(`mission ${mi} ${g.mission.name}: ${g.mode} ${g.failReason||''} after ${(f/60).toFixed(0)}s, kills ${g.stats.kills}, coopSnipes ${g.stats.coopSnipes}, earned $${g.earned}, modes ${[...modes]}, hatch x=${g.hatch.x.toFixed(1)} z=${g.hatch.z.toFixed(1)}, alive enemies ${g.enemies.filter(e=>!e.dead).length}, wall ${Date.now()-t0}ms`);
  if (g.mode !== 'complete') console.log('   area state', JSON.stringify(g.areas[g.checkpoint]), 'objectives', JSON.stringify(area.objectives.map(o=>({k:o.kind,done:o.done,p:o.progress}))), 'enemies', g.enemies.filter(e=>!e.dead).map(e=>`${e.type}@${e.x.toFixed(0)},${e.z.toFixed(0)},${e.y.toFixed(0)}`).join(' '));
}
