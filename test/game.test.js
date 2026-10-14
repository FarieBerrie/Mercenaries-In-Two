import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { chest, createEnemy, eye } from '../src/actors.js';
import { createBot } from '../src/bot.js';
import { AGGRO, HEALTH } from '../src/config.js';
import { Game } from '../src/game.js';
import { buildLevel, COVER_HEIGHT, groundHeight } from '../src/level.js';
import { MISSIONS } from '../src/missions.js';
import { buyMask, buyUpgrade, completeMission, createProgress, loadout, loadProgress, saveProgress } from '../src/progress.js';
import { openSpot, quietGame, seeded, step } from './helpers.js';

/** Puts an enemy at a spot, facing the contractors (−x), and makes it hold still. */
function placeEnemy(game, type, x, z, yaw = Math.PI) {
  const e = createEnemy(type, x, z);
  e.yaw = yaw;
  e.area = 0;
  e.fireCd = 1e9; // it won't shoot back unless a test wants it to
  game.enemies.push(e);
  return e;
}

/** Hatch at a spot with nothing in the way, aiming at a point. */
function stand(game, at, aimAt = null) {
  const h = game.hatch;
  h.x = at.x;
  h.z = at.z;
  h.y = 0;
  h.vx = h.vz = 0;
  if (aimAt) {
    const e = eye(h);
    h.aimYaw = Math.atan2(aimAt.z - e.z, aimAt.x - e.x);
    h.aimPitch = Math.atan2(aimAt.y - e.y, Math.hypot(aimAt.x - e.x, aimAt.z - e.z));
  }
  game.cruz.x = at.x - 3;
  game.cruz.z = at.z - 3;
  return h;
}

describe('levels', () => {
  test('are deterministic', () => {
    const a = buildLevel(0);
    const b = buildLevel(0);
    assert.deepEqual(a.boxes.map((x) => [x.x0, x.z0, x.y1]), b.boxes.map((x) => [x.x0, x.z0, x.y1]));
  });

  test('every mission has four areas, cover and somewhere for enemies to come from', () => {
    MISSIONS.forEach((m, i) => {
      const level = buildLevel(i);
      assert.equal(level.areas.length, 4);
      assert.ok(level.cover.length > 40, `${m.name}: ${level.cover.length} cover points`);
      for (const a of level.areas) assert.ok(a.spawns.length >= 8, `${a.name} has ${a.spawns.length} spawns`);
    });
  });

  test('cover points sit beside low boxes, on open ground', () => {
    const level = buildLevel(1);
    for (const p of level.cover) {
      assert.ok(p.box.y1 <= COVER_HEIGHT);
      assert.equal(groundHeight(level, p.x, p.z, 0.3), 0);
    }
  });
});

describe('moving', () => {
  test('walks, and sprints faster', () => {
    const run = (sprint) => {
      const { game, input } = quietGame();
      stand(game, openSpot(game, 0, 8));
      const x0 = game.hatch.x;
      input.hold('up');
      if (sprint) input.hold('sprint');
      step(game, input, 60);
      return game.hatch.x - x0;
    };
    assert.ok(run(false) > 4);
    assert.ok(run(true) > run(false) + 2);
  });

  test('crouching lowers you behind cover', () => {
    const { game, input } = quietGame();
    stand(game, openSpot(game));
    input.tap('crouch');
    step(game, input, 2);
    assert.ok(game.hatch.crouch);
    assert.ok(game.hatch.h < COVER_HEIGHT);
  });

  test('vaults over a crate', () => {
    const { game, input } = quietGame();
    const crate = game.level.boxes.find((b) => b.kind === 'cover' && b.y1 <= 1.2 && b.x1 - b.x0 < 1.5 && Math.abs(b.z0) < 15);
    const h = stand(game, { x: crate.x0 - 0.8, z: (crate.z0 + crate.z1) / 2 });
    h.aimYaw = 0;
    input.hold('up');
    step(game, input, 5);
    input.tap('vault');
    step(game, input, 30);
    assert.ok(h.x > crate.x1, `ended at ${h.x.toFixed(2)}, crate ends at ${crate.x1}`);
  });
});

describe('shooting', () => {
  test('a rifle burst kills a rifleman in the open', () => {
    const { game, input } = quietGame();
    const at = openSpot(game, 0, 9);
    const e = placeEnemy(game, 'rifleman', at.x + 8, at.z);
    stand(game, at, chest(e));
    seeded(1, () => {
      input.hold('fire');
      step(game, input, 90);
    });
    assert.ok(e.dead);
    assert.ok(game.earned >= 100);
  });

  test('cover stops bullets', () => {
    const { game, input } = quietGame();
    const box = game.level.boxes.find((b) => b.kind === 'cover' && b.y1 >= 1.1 && b.z1 - b.z0 >= 1 && Math.abs(b.z0) < 15);
    const z = (box.z0 + box.z1) / 2;
    const e = placeEnemy(game, 'rifleman', box.x1 + 0.6, z);
    e.crouch = true;
    e.h = 1.15;
    stand(game, { x: box.x0 - 8, z }, { x: e.x, y: 0.6, z });
    game.hatch.crouch = true;
    input.hold('fire');
    step(game, input, 60);
    assert.equal(e.hp, e.maxHp);
  });

  test('headshots and flanking do more damage', () => {
    const damage = (aimY, enemyYaw) => {
      const { game } = quietGame();
      const at = openSpot(game, 0, 9);
      const e = placeEnemy(game, 'rifleman', at.x + 8, at.z, enemyYaw);
      stand(game, at);
      game.hurt(e, 10, game.hatch, { x: e.x, y: e.y + aimY, z: e.z });
      return e.maxHp - e.hp;
    };
    const body = damage(1.0, Math.PI);
    assert.ok(damage(1.75, Math.PI) > body * 2, 'headshot');
    assert.ok(damage(1.0, 0) > body * 1.4, 'from behind');
  });

  test("heavies' armour stops shots from the front but not the back", () => {
    const hit = (yaw) => {
      const { game } = quietGame();
      const at = openSpot(game, 0, 9);
      const e = placeEnemy(game, 'heavy', at.x + 8, at.z, yaw);
      stand(game, at);
      game.hurt(e, 20, game.hatch, chest(e));
      return e.maxHp - e.hp;
    };
    assert.ok(hit(Math.PI) < 4, 'front');
    assert.ok(hit(0) > 30, 'back');
  });

  test('grenades hurt enemies, not your partner', () => {
    const { game } = quietGame();
    const at = openSpot(game, 0, 9);
    const e = placeEnemy(game, 'rifleman', at.x + 2, at.z);
    stand(game, at);
    game.cruz.x = at.x + 1;
    game.cruz.z = at.z + 1;
    game.explode({ x: at.x + 2, y: 0.5, z: at.z }, 160, { team: 'contractors', owner: game.hatch });
    assert.ok(e.dead);
    assert.equal(game.cruz.hp, game.cruz.maxHp);
  });
});

describe('aggro', () => {
  test("shooting draws the enemy's attention to the shooter", () => {
    const { game, input } = quietGame();
    const at = openSpot(game, 0, 9);
    placeEnemy(game, 'heavy', at.x + 20, at.z);
    stand(game, at, { x: at.x + 20, y: 1.2, z: at.z });
    input.hold('fire');
    step(game, input, 90);
    assert.ok(game.aggro > 20, `aggro ${game.aggro}`);
  });

  test('enemies mostly target whoever has the aggro', () => {
    const { game } = quietGame();
    const at = openSpot(game, 0, 9);
    const e = placeEnemy(game, 'rifleman', at.x + 10, at.z);
    stand(game, at);
    game.cruz.x = at.x;
    game.cruz.z = at.z + 2;
    game.aggro = 80;
    const picks = seeded(3, () => Array.from({ length: 200 }, () => game.pickTarget(e)));
    const onHatch = picks.filter((p) => p === game.hatch).length;
    assert.ok(onHatch > 160, `${onHatch} of 200`);
  });

  test('maxing the meter triggers Overkill: tougher, harder-hitting, and the partner is ignored', () => {
    const { game } = quietGame();
    const at = openSpot(game, 0, 9);
    const e = placeEnemy(game, 'rifleman', at.x + 10, at.z);
    stand(game, at);
    game.cruz.x = at.x;
    game.cruz.z = at.z + 2;
    game.addAggro(game.hatch, AGGRO.max);
    assert.equal(game.overkill.who, 'hatch');
    assert.ok(game.ghosted(game.cruz));
    const picks = seeded(4, () => Array.from({ length: 50 }, () => game.pickTarget(e)));
    assert.ok(picks.every((p) => p === game.hatch));
    const hp = game.hatch.hp;
    game.hurtContractor(game.hatch, 20, e);
    assert.equal(game.hatch.hp, hp - 10);
  });
});

describe('going down', () => {
  test('Hatch goes down, and Cruz comes to revive him', () => {
    const { game, input } = quietGame();
    stand(game, openSpot(game, 0, 6));
    game.hurtContractor(game.hatch, 500, null);
    assert.ok(game.hatch.downed);
    // Up within 8 seconds, with the revived share of his health (before it starts regenerating)
    seeded(5, () => {
      for (let i = 0; i < 60 * 8 && game.hatch.downed; i++) step(game, input, 1);
    });
    assert.ok(!game.hatch.downed, 'revived');
    assert.ok(Math.abs(game.hatch.hp - game.hatch.maxHp * HEALTH.revivedHealth) < 1);
  });

  test('Hatch revives Cruz by holding Use', () => {
    const { game, input } = quietGame();
    const at = openSpot(game, 0, 6);
    stand(game, at);
    game.cruz.x = at.x + 1;
    game.cruz.z = at.z;
    game.hurtContractor(game.cruz, 500, null);
    assert.equal(game.usable(game.hatch).kind, 'revive');
    step(game, input, HEALTH.reviveTime + 5, () => input.hold('use'));
    assert.ok(!game.cruz.downed);
  });

  test('both down, or bleeding out, fails the mission', () => {
    const { game } = quietGame();
    game.hurtContractor(game.hatch, 500, null);
    game.hurtContractor(game.cruz, 500, null);
    game.updateContractors();
    assert.equal(game.mode, 'failed');
    game.restart();
    assert.equal(game.mode, 'play');
    assert.equal(game.stats.restarts, 1);
  });
});

describe('the mission', () => {
  test('walking into an area brings its first wave', () => {
    const game = new Game({ input: { down: () => false, pressed: () => false, look: () => ({ x: 0, y: 0 }), moveVector: () => ({ x: 0, z: 0 }) } });
    game.hatch.x = game.level.areas[0].x0 + 6;
    game.update();
    assert.ok(game.areas[0].triggered);
    assert.equal(game.enemiesIn(0).length, 4);
  });

  test('clearing an area opens its gate and pays out', () => {
    const { game } = quietGame();
    const gate = game.level.areas[0].gate;
    assert.ok(game.level.boxes.includes(gate));
    game.areas[0].triggered = true;
    game.areas[0].wave = game.level.areas[0].spec.waves.length - 1;
    game.updateAreas();
    assert.ok(game.areas[0].cleared);
    assert.ok(!game.level.boxes.includes(gate));
    assert.ok(game.earned >= 500);
  });

  test('charges are set by holding Use, and the area stays shut until they are', () => {
    const { game, input } = quietGame();
    const area = game.level.areas[2];
    game.areas[2].triggered = true;
    game.areas[2].wave = area.spec.waves.length - 1;
    game.updateAreas();
    assert.ok(!game.areas[2].cleared, 'not with charges still to set');
    for (const o of area.objectives) {
      stand(game, { x: o.x, z: o.z });
      step(game, input, 125, () => input.hold('use'));
      input.release('use');
      assert.ok(o.done);
    }
    game.updateAreas();
    assert.ok(game.areas[2].cleared);
  });

  test('step-jump: Cruz boosts Hatch over the wall, then follows', () => {
    const { game, input } = quietGame();
    const area = game.level.areas[1];
    game.areas[1].cleared = true;
    stand(game, { x: area.boost.x, z: area.boost.z });
    assert.equal(game.usable(game.hatch).kind, 'boost');
    input.tap('use');
    step(game, input, 120);
    assert.equal(game.mode, 'play');
    assert.ok(game.hatch.x > area.x1 && game.cruz.x > area.x1);
  });

  test('co-op snipe: one shot from the nest drops two marksmen', () => {
    const game = new Game({ input: { down: () => false, pressed: () => false, look: () => ({ x: 0, y: 0 }), moveVector: () => ({ x: 0, z: 0 }) }, missionIndex: 1 });
    const area = game.level.areas[1];
    game.triggerArea(1);
    const towers = game.enemiesIn(1).filter((e) => e.tower);
    assert.equal(towers.length, 4);
    stand(game, { x: area.nest.x, z: area.nest.z });
    game.enterNest(area);
    game.hurt(towers[0], 400, game.hatch, chest(towers[0]));
    game.coopSnipe(towers[0]);
    assert.equal(towers.filter((t) => t.dead).length, 2);
    assert.equal(game.stats.coopSnipes, 1);
  });

  test('back-to-back: surrounded, slowed down, unlimited ammo', () => {
    const game = new Game({ input: { down: () => false, pressed: () => false, look: () => ({ x: 0, y: 0 }), moveVector: () => ({ x: 0, z: 0 }) }, missionIndex: 1 });
    game.triggerArea(3);
    assert.equal(game.mode, 'backToBack');
    assert.ok(game.timeScale < 1);
    assert.ok(game.enemiesIn(3).length >= 10);
    game.hatch.guns.rifle.ammo = 0;
    game.updateBackToBack();
    assert.ok(game.hatch.guns.rifle.ammo > 0);
  });

  test('reaching extraction with the last area clear completes the mission', () => {
    const { game } = quietGame();
    game.quiet = false;
    const last = game.level.areas.length - 1;
    game.areas[last].cleared = true;
    stand(game, game.level.areas[last].extract);
    game.updateAreas();
    assert.equal(game.mode, 'complete');
    assert.ok(game.earned >= MISSIONS[0].pay);
  });
});

describe('the armory', () => {
  test('upgrades cost money and change the loadout', () => {
    const p = createProgress();
    assert.equal(buyUpgrade(p, 'armor'), false, 'too poor');
    p.money = 10000;
    assert.ok(buyUpgrade(p, 'armor'));
    assert.ok(buyUpgrade(p, 'rifle-damage'));
    assert.equal(p.money, 10000 - 3000 - 2000);
    const l = loadout(p);
    assert.equal(l.maxHp, 125);
    assert.ok(l.rifle.damage > 25);
  });

  test('masks, mission unlocks and saves', () => {
    const p = createProgress();
    p.money = 600;
    assert.ok(buyMask(p, 'stripe'));
    assert.equal(buyMask(p, 'stripe'), false, 'already owned');
    completeMission(p, 0, 15000);
    assert.equal(p.unlocked, 2);
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    saveProgress(storage, p);
    assert.deepEqual(loadProgress(storage), p);
  });
});

describe('whole missions', () => {
  for (const [i, m] of MISSIONS.entries()) {
    test(`the autopilot can finish ${m.name}`, () => {
      // Kept topped up, so this checks every area, objective and set piece can be completed.
      const result = seeded(100 + i, () => {
        const bot = createBot();
        const game = new Game({ input: bot, missionIndex: i });
        bot.attach(game);
        for (let f = 0; f < 60 * 60 * 6 && game.mode !== 'complete'; f++) {
          for (const c of game.contractors) if (!c.downed) c.hp = c.maxHp;
          bot.update();
          game.update();
        }
        return game;
      });
      assert.equal(result.mode, 'complete', `stuck in ${result.level.areas[result.checkpoint].name}`);
    });
  }
});
