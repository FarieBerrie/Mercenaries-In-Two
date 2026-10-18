// Menus: title, main menu, contracts, briefing, armory, settings, controls, credits, pause,
// mission results and loading. Plain DOM over the 3D view. Every screen works with the mouse,
// the keyboard (arrows, Enter, Esc) and a gamepad (d-pad or stick, A, B).
import { MISSIONS } from './missions.js';
import { buyMask, buyUpgrade, levelOf, MASK_COLORS, MASKS, nextPrice, SHOP } from './progress.js';
import { DIFFICULTY, QUALITY } from './settings.js';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const ART = {
  desert: 'radial-gradient(ellipse at 70% 0%, rgba(255,170,70,0.55), transparent 60%), linear-gradient(180deg, transparent 50%, rgba(160,100,40,0.35))',
  port: 'radial-gradient(ellipse at 80% 10%, rgba(80,140,255,0.45), transparent 55%), radial-gradient(ellipse at 10% 100%, rgba(255,160,60,0.3), transparent 50%)',
  snow: 'radial-gradient(ellipse at 60% 0%, rgba(220,235,255,0.55), transparent 60%), linear-gradient(180deg, transparent 40%, rgba(140,170,210,0.3))',
};
const DETAILS = {
  desert: { time: '14:20 LOCAL', weather: 'CLEAR · 41°C · WIND 12 KM/H', insert: 'GROUND · SOUTH ROAD' },
  port: { time: '02:45 LOCAL', weather: 'RAIN · 9°C · VISIBILITY POOR', insert: 'BOAT · NORTH QUAY' },
  snow: { time: '07:10 LOCAL', weather: 'SNOW · −14°C · GUSTING 40 KM/H', insert: 'GROUND · SERVICE ROAD' },
};
const TIPS = [
  'Armoured enemies shrug off shots from the front. One of you draws their fire while the other goes round.',
  'Shooting builds HEAT. Whoever has more of it takes the fire, and the other one can move freely.',
  'Fill the HEAT meter all the way to trigger REDLINE: you hit harder and take less, and your partner is ignored.',
  'Order Cruz with Z (advance), X (regroup) and V (hold). Advancing while you hold their attention, he flanks.',
  'A downed partner bleeds out. Get to him and hold E. He will always come for you.',
  'Crouch behind low cover and press SPACE to vault over it.',
  'SYNC SHOT: from the sniper nest, your shot and Cruz\'s land together. Two marksmen, one trigger pull.',
  'Ammo crates drop from the fallen. Every cleared area resupplies you both.',
];
const SETTINGS = [
  { key: 'difficulty', label: 'DIFFICULTY', type: 'cycle', options: Object.keys(DIFFICULTY), format: (v) => DIFFICULTY[v].label },
  { key: 'quality', label: 'GRAPHICS QUALITY', type: 'cycle', options: Object.keys(QUALITY), format: (v) => QUALITY[v].label },
  { key: 'backend', label: 'RENDERER (RESTARTS)', type: 'cycle', options: ['auto', 'webgl'], format: (v) => (v === 'webgl' ? 'WEBGL 2' : 'WEBGPU') },
  { key: 'fov', label: 'FIELD OF VIEW', type: 'range', min: -10, max: 20, step: 2, format: (v) => `${62 + v}°` },
  { key: 'sensitivity', label: 'LOOK SENSITIVITY', type: 'range', min: 0.2, max: 3, step: 0.1, format: (v) => v.toFixed(1) },
  { key: 'aimSensitivity', label: 'AIMING SENSITIVITY', type: 'range', min: 0.2, max: 1.5, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'invertY', label: 'INVERT LOOK', type: 'toggle' },
  { key: 'master', label: 'MASTER VOLUME', type: 'range', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}` },
  { key: 'music', label: 'MUSIC', type: 'range', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}` },
  { key: 'sfx', label: 'EFFECTS', type: 'range', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}` },
  { key: 'shake', label: 'CAMERA SHAKE', type: 'range', min: 0, max: 1.5, step: 0.25, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'subtitles', label: 'SUBTITLES', type: 'toggle' },
];
const PATTERN_NAMES = Object.fromEntries(MASKS.map((m) => [m.id, m.name]));

export function createUI(root, app) {
  let screen = null; // { name, el, items, focus, back, onKey }
  const stack = [];
  let padPrev = {};
  let padRepeat = 0;
  let armoryTab = 'upgrades';
  let maskWho = 'hatch';

  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  function hints(list) {
    return `<div class="hints">${list.map(([k, l]) => `<span><span class="key">${k}</span>${l}</span>`).join('')}</div>`;
  }

  function toast(msg, bad = false) {
    const t = el(`<div class="toast${bad ? ' bad' : ''}">${msg}</div>`);
    screen?.el.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  function setFocus(i, sound = true) {
    if (!screen?.items.length) return;
    const n = screen.items.length;
    i = ((i % n) + n) % n;
    screen.items.forEach((it, k) => it.classList.toggle('focus', k === i));
    if (screen.focus !== i && sound) app.audio.ui('hover');
    screen.focus = i;
    screen.items[i].scrollIntoView?.({ block: 'nearest' });
  }

  function wire() {
    screen.items.forEach((it, i) => {
      it.addEventListener('mouseenter', () => setFocus(i));
      it.addEventListener('click', (e) => {
        e.stopPropagation();
        setFocus(i, false);
        activate();
      });
    });
    if (screen.items.length) setFocus(screen.focus ?? 0, false);
  }

  function activate() {
    const it = screen?.items[screen.focus];
    if (!it || it.classList.contains('disabled')) {
      app.audio.ui('deny');
      return;
    }
    it.dispatchEvent(new CustomEvent('activate'));
  }

  function mount(name, node, { items = '.item', back = null, keep = false, onKey = null, focus = 0 } = {}) {
    if (screen && !keep) {
      const old = screen.el;
      old.classList.add('out');
      setTimeout(() => old.remove(), 260);
    } else if (screen) screen.el.remove();
    root.appendChild(node);
    screen = { name, el: node, items: [...node.querySelectorAll(items)], focus, back, onKey };
    wire();
  }

  /** Opens a screen, remembering the one before so Back returns to it. */
  function go(name, data) {
    if (screen && screen.name !== name) stack.push({ name: screen.name, data: screen.data });
    show(name, data);
  }

  function back() {
    if (!screen?.back) return;
    app.audio.ui('back');
    screen.back();
  }

  function popBack() {
    const prev = stack.pop();
    if (prev) show(prev.name, prev.data);
  }

  // ------------------------------------------------------------ screens

  const screens = {
    title() {
      const node = el(`
        <div class="screen title-screen">
          <div class="logo">
            <div class="mark">MERCENARIES IN <em>TWO</em></div>
            <div class="tag">TWO CONTRACTORS · ONE PAYCHECK</div>
          </div>
          <div class="press">PRESS ANY KEY</div>
          <div class="legal">An original game. All characters, organisations and events are fictional.</div>
        </div>`);
      mount('title', node, { items: '.none' });
      node.addEventListener('click', () => app.startGame());
    },

    main() {
      const p = app.progress;
      const node = el(`
        <div class="screen shade-left">
          <div class="wrap">
            <div class="eyebrow">Private military contractors</div>
            <div class="title">Mercenaries<br/>In Two</div>
            <div class="rule"></div>
            <div class="menu">
              <button class="item" data-go="contracts">Contracts<small>Take a job. Get paid.</small></button>
              <button class="item" data-go="armory">Armory<small>Upgrades for the job, masks for the look.</small></button>
              <button class="item" data-go="settings">Settings<small>Graphics, controls and sound.</small></button>
              <button class="item" data-go="controls">Controls<small>Keyboard, mouse and gamepad.</small></button>
              <button class="item" data-go="credits">Credits</button>
            </div>
          </div>
          <div class="funds"><span>FUNDS</span><b>${money(p.money)}</b></div>
          ${hints([['↑↓', 'SELECT'], ['ENTER', 'CONFIRM']])}
        </div>`);
      stack.length = 0;
      mount('main', node, { back: () => show('title') });
      for (const it of screen.items) it.addEventListener('activate', () => (app.audio.ui('select'), go(it.dataset.go)));
    },

    contracts() {
      const p = app.progress;
      const node = el(`
        <div class="screen shade-full">
          <div class="wrap" style="bottom:auto">
            <div class="eyebrow">Available work</div>
            <div class="title">Contracts</div>
          </div>
          <div class="cards">
            ${MISSIONS.map((m, i) => {
              const locked = i >= p.unlocked;
              const done = p.completed.includes(i);
              return `<div class="card${locked ? ' locked' : ''}" style="--art:${ART[m.theme]}" data-i="${i}">
                <div class="num">CONTRACT 0${i + 1}</div>
                ${done ? '<div class="badge done">COMPLETED</div>' : locked ? '<div class="badge lock">LOCKED</div>' : ''}
                <h3>${m.name}</h3>
                <div class="place">${m.place}</div>
                <p>${locked ? 'Finish the previous contract to unlock this one.' : m.brief}</p>
                <div class="pay"><span>CONTRACT FEE</span><b>${money(m.pay)}</b></div>
              </div>`;
            }).join('')}
          </div>
          <div class="funds"><span>FUNDS</span><b>${money(p.money)}</b></div>
          ${hints([['←→', 'SELECT'], ['ENTER', 'BRIEFING'], ['ESC', 'BACK']])}
        </div>`);
      mount('contracts', node, { items: '.card', back: popBack, focus: Math.min(p.unlocked - 1, MISSIONS.length - 1) });
      for (const c of screen.items) {
        const i = Number(c.dataset.i);
        if (i >= p.unlocked) c.classList.add('disabled');
        c.addEventListener('activate', () => (app.audio.ui('select'), go('briefing', i)));
      }
      screen.onKey = (k) => {
        if (k === 'left') setFocus(screen.focus - 1);
        if (k === 'right') setFocus(screen.focus + 1);
      };
    },

    briefing(i) {
      const m = MISSIONS[i];
      const d = DETAILS[m.theme];
      const describe = (a) => {
        const bits = [];
        if (a.plant) bits.push(`set ${a.plant} charges`);
        if (a.rescue) bits.push('free the hostage');
        if (a.snipe) bits.push('sync shot from the nest');
        if (a.boost) bits.push('leg-up over the wall');
        if (a.backToBack) bits.push('expect to be surrounded');
        if (a.boss) bits.push('eliminate the target');
        if (a.extract) bits.push('extract');
        return bits.length ? bits.join(', ') : 'clear the area';
      };
      const node = el(`
        <div class="screen shade-full">
          <div class="brief-grid">
            <div>
              <div class="eyebrow">Contract 0${i + 1} · Briefing</div>
              <div class="title">${m.name}</div>
              <div class="sub">${m.place.toUpperCase()}</div>
              <div class="rule"></div>
              <div class="brief-text">${m.brief}</div>
              <dl class="intel">
                <dt>TIME</dt><dd>${d.time}</dd>
                <dt>CONDITIONS</dt><dd>${d.weather}</dd>
                <dt>INSERTION</dt><dd>${d.insert}</dd>
                <dt>FEE</dt><dd style="color:var(--gold)">${money(m.pay)} + FIELD BONUSES</dd>
              </dl>
              <div class="menu" style="margin-top:28px">
                <button class="item">Deploy<small>You and Cruz go in together.</small></button>
                <button class="item">Armory</button>
                <button class="item">Back</button>
              </div>
            </div>
            <ol class="route">
              ${m.areas.map((a) => `<li><b>${a.name}</b><span>${describe(a)}</span></li>`).join('')}
            </ol>
          </div>
          ${hints([['ENTER', 'CONFIRM'], ['ESC', 'BACK']])}
        </div>`);
      mount('briefing', node, { back: popBack });
      screen.data = i;
      const [deploy, armory, bk] = screen.items;
      deploy.addEventListener('activate', () => (app.audio.ui('select'), app.deploy(i)));
      armory.addEventListener('activate', () => (app.audio.ui('select'), go('armory')));
      bk.addEventListener('activate', back);
    },

    armory() {
      const p = app.progress;
      const node = el(`
        <div class="screen shade-full">
          <div class="armory">
            <div class="left">
              <div class="eyebrow">Spend it before it spends you</div>
              <div class="title">Armory</div>
              <div class="tabs"><div class="tab" data-tab="upgrades">UPGRADES</div><div class="tab" data-tab="masks">MASKS</div></div>
              <div class="body"></div>
            </div>
            <div class="right"><canvas id="preview"></canvas></div>
          </div>
          <div class="funds"><span>FUNDS</span><b>${money(p.money)}</b></div>
          ${hints([['Q / E', 'TAB'], ['ENTER', 'BUY / EQUIP'], ['ESC', 'BACK']])}
        </div>`);
      const body = node.querySelector('.body');
      const tabs = [...node.querySelectorAll('.tab')];
      const render = (focus = 0) => {
        tabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === armoryTab));
        node.querySelector('.funds b').textContent = money(p.money);
        if (armoryTab === 'upgrades') {
          body.innerHTML = SHOP.map((s) => {
            const lv = levelOf(p, s.id);
            const price = nextPrice(p, s.id);
            const priceHtml = price === null ? '<div class="price max">MAXED</div>' : `<div class="price${p.money < price ? ' cant' : ''}">${money(price)}</div>`;
            return `<div class="row" data-id="${s.id}"><div><h4>${s.name}</h4><p>${s.desc}</p><div class="pips">${s.prices.map((_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('')}</div></div>${priceHtml}</div>`;
          }).join('');
        } else {
          const look = p[maskWho];
          body.innerHTML = `
            <div class="who"><button data-who="hatch" class="${maskWho === 'hatch' ? 'on' : ''}">HATCH</button><button data-who="cruz" class="${maskWho === 'cruz' ? 'on' : ''}">CRUZ</button></div>
            ${MASKS.map((m) => {
              const owned = p.masks.includes(m.id);
              const on = look.pattern === m.id;
              return `<div class="row" data-mask="${m.id}"><div><h4>${m.name}${on ? ' <span style="color:var(--green);font-size:14px;letter-spacing:.3em">· EQUIPPED</span>' : ''}</h4></div>${owned ? `<div class="price max">${on ? '' : 'OWNED'}</div>` : `<div class="price${p.money < m.price ? ' cant' : ''}">${money(m.price)}</div>`}</div>`;
            }).join('')}
            <div class="label">BASE COLOUR</div>
            <div class="swatches" data-slot="base">${MASK_COLORS.map((c) => `<div class="swatch row-like${look.base === c ? ' on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div>
            <div class="label">ACCENT COLOUR</div>
            <div class="swatches" data-slot="accent">${MASK_COLORS.map((c) => `<div class="swatch row-like${look.accent === c ? ' on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('')}</div>`;
          for (const b of body.querySelectorAll('.who button')) {
            b.addEventListener('click', () => {
              maskWho = b.dataset.who;
              app.audio.ui('select');
              render(screen.focus);
            });
          }
        }
        screen.items = [...body.querySelectorAll('.row, .swatch')];
        wire();
        setFocus(Math.min(focus, screen.items.length - 1), false);
        for (const it of screen.items) {
          it.addEventListener('activate', () => {
            if (it.dataset.id) {
              if (buyUpgrade(p, it.dataset.id)) {
                app.audio.ui('buy');
                toast('PURCHASED');
                app.save();
              } else {
                app.audio.ui('deny');
                toast(nextPrice(p, it.dataset.id) === null ? 'ALREADY MAXED' : 'NOT ENOUGH FUNDS', true);
              }
            } else if (it.dataset.mask) {
              const id = it.dataset.mask;
              if (!p.masks.includes(id)) {
                if (!buyMask(p, id)) {
                  app.audio.ui('deny');
                  toast('NOT ENOUGH FUNDS', true);
                  return;
                }
                app.audio.ui('buy');
                toast('MASK UNLOCKED');
              } else app.audio.ui('select');
              p[maskWho] = { ...p[maskWho], pattern: id };
              app.save();
            } else if (it.dataset.c) {
              const slot = it.parentElement.dataset.slot;
              p[maskWho] = { ...p[maskWho], [slot]: it.dataset.c };
              app.audio.ui('select');
              app.save();
            }
            render(screen.focus);
          });
        }
        app.preview?.show(maskWho, p[maskWho]);
      };
      mount('armory', node, { items: '.none', back: popBack });
      app.preview?.attach(node.querySelector('#preview'));
      for (const t of tabs) {
        t.addEventListener('click', () => {
          armoryTab = t.dataset.tab;
          app.audio.ui('select');
          render(0);
        });
      }
      screen.onKey = (k) => {
        if (k === 'tabLeft' || k === 'tabRight') {
          armoryTab = armoryTab === 'upgrades' ? 'masks' : 'upgrades';
          app.audio.ui('select');
          render(0);
        }
        if (armoryTab === 'masks' && (k === 'left' || k === 'right')) {
          const it = screen.items[screen.focus];
          if (it?.classList.contains('swatch')) setFocus(screen.focus + (k === 'left' ? -1 : 1));
          else if (k === 'left' || k === 'right') {
            maskWho = maskWho === 'hatch' ? 'cruz' : 'hatch';
            app.audio.ui('select');
            render(screen.focus);
          }
        }
      };
      render(0);
    },

    settings() {
      const s = app.settings;
      const node = el(`
        <div class="screen shade-full">
          <div class="wrap" style="width:min(760px,90vw)">
            <div class="eyebrow">Options</div>
            <div class="title">Settings</div>
            <div class="rule"></div>
            <div class="settings">
              ${SETTINGS.map((d) => `<div class="setting" data-key="${d.key}"><label>${d.label}</label><div class="val"></div></div>`).join('')}
            </div>
            <div class="gpu-line">GPU · ${app.gpu ?? ''}</div>
          </div>
          ${hints([['↑↓', 'SELECT'], ['←→', 'CHANGE'], ['ESC', 'BACK']])}
        </div>`);
      mount('settings', node, { items: '.setting', back: popBack });
      const paint = () => {
        for (const row of screen.items) {
          const d = SETTINGS.find((x) => x.key === row.dataset.key);
          const v = s[d.key];
          const val = row.querySelector('.val');
          if (d.type === 'range') {
            const k = (v - d.min) / (d.max - d.min);
            val.innerHTML = `<div class="track"><i style="width:${k * 100}%"></i></div><span style="min-width:52px;text-align:right">${d.format(v)}</span>`;
          } else if (d.type === 'toggle') val.innerHTML = `<span class="arrow">‹</span><span>${v ? 'ON' : 'OFF'}</span><span class="arrow">›</span>`;
          else val.innerHTML = `<span class="arrow">‹</span><span>${d.format(v)}</span><span class="arrow">›</span>`;
        }
      };
      const change = (dir) => {
        const row = screen.items[screen.focus];
        const d = SETTINGS.find((x) => x.key === row.dataset.key);
        if (d.type === 'range') s[d.key] = Math.round(Math.min(d.max, Math.max(d.min, s[d.key] + d.step * dir)) * 1000) / 1000;
        else if (d.type === 'toggle') s[d.key] = !s[d.key];
        else {
          const i = d.options.indexOf(s[d.key]);
          s[d.key] = d.options[(i + dir + d.options.length) % d.options.length];
        }
        app.audio.ui('hover');
        app.applySettings(d.key);
        paint();
      };
      for (const row of screen.items) {
        row.addEventListener('activate', () => change(1));
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          change(-1);
        });
      }
      screen.onKey = (k) => {
        if (k === 'left') change(-1);
        if (k === 'right') change(1);
      };
      paint();
    },

    controls() {
      const rows = [
        ['Move', 'W A S D', 'Left stick'],
        ['Look / aim', 'Mouse', 'Right stick'],
        ['Fire', 'Left mouse', 'RT'],
        ['Aim down sights', 'Right mouse', 'LT'],
        ['Sprint', 'Shift', 'L3'],
        ['Crouch', 'C', 'B'],
        ['Vault over cover', 'Space', 'RB'],
        ['Reload', 'R', 'X'],
        ['Use · revive · objectives', 'E (hold)', 'A (hold)'],
        ['Grenade', 'G', 'LB'],
        ['Switch weapon', 'Q / wheel / 1 2', 'Y'],
        ['Order: advance', 'Z', 'D-pad up'],
        ['Order: regroup', 'X', 'D-pad left/right'],
        ['Order: hold position', 'V', 'D-pad down'],
        ['Pause', 'Esc / P', 'Start'],
      ];
      const node = el(`
        <div class="screen shade-full">
          <div class="wrap" style="width:min(820px,92vw)">
            <div class="eyebrow">How to play</div>
            <div class="title">Controls</div>
            <div class="rule"></div>
            <div class="controls">
              <div class="h">ACTION</div><div class="h">KEYBOARD & MOUSE</div><div class="h">GAMEPAD</div>
              ${rows.map(([a, k, g]) => `<div>${a}</div><div><span class="key">${k}</span></div><div style="color:var(--dim)">${g}</div>`).join('')}
            </div>
            <div class="menu" style="margin-top:20px"><button class="item">Back</button></div>
          </div>
        </div>`);
      mount('controls', node, { back: popBack });
      screen.items[0].addEventListener('activate', back);
    },

    credits() {
      const node = el(`
        <div class="screen shade-full">
          <div class="wrap">
            <div class="eyebrow">Credits</div>
            <div class="title">Mercenaries<br/>In Two</div>
            <div class="rule"></div>
            <div class="brief-text" style="font-size:18px">
              An original co-op shooter. Every character, organisation, mission, mask design, line of dialogue and piece of music is made for this game; nothing is taken from any other game or franchise.<br/><br/>
              Rendered on the GPU with three.js (WebGPU). People: Microsoft Rocketbox avatars and motion capture (MIT licence). Surfaces, skies and props: Poly Haven (CC0). Masks, guns, buildings, effects, sound and music are made in code for this game.
            </div>
            <div class="menu" style="margin-top:24px"><button class="item">Back</button></div>
          </div>
        </div>`);
      mount('credits', node, { back: popBack });
      screen.items[0].addEventListener('activate', back);
    },

    pause() {
      const g = app.game;
      const node = el(`
        <div class="screen shade-full">
          <div class="wrap">
            <div class="eyebrow">${g.mission.name} · ${g.level.areas[g.checkpoint].name}</div>
            <div class="title">Paused</div>
            <div class="rule"></div>
            <div class="menu">
              <button class="item" data-a="resume">Resume</button>
              <button class="item" data-a="restart">Restart checkpoint<small>Back to the start of this area.</small></button>
              <button class="item" data-a="settings">Settings</button>
              <button class="item" data-a="controls">Controls</button>
              <button class="item" data-a="abandon">Abandon contract<small>You keep nothing from this job.</small></button>
            </div>
          </div>
          ${hints([['ENTER', 'CONFIRM'], ['ESC', 'RESUME']])}
        </div>`);
      stack.length = 0;
      mount('pause', node, { back: () => app.resume() });
      for (const it of screen.items) {
        it.addEventListener('activate', () => {
          app.audio.ui('select');
          const a = it.dataset.a;
          if (a === 'resume') app.resume();
          else if (a === 'restart') app.restart();
          else if (a === 'abandon') app.abandon();
          else go(a);
        });
      }
    },

    debrief(r) {
      const rows = [
        ['Contract fee', money(r.pay)],
        ['Field bonuses', money(r.earned - r.pay)],
        ['Hostiles neutralised', r.stats.kills],
        ['Headshots', r.stats.headshots],
        ['Flanking kills', r.stats.flanks],
        ['Sync shots', r.stats.coopSnipes],
        ['Times down', r.stats.downs],
        ['Checkpoint restarts', r.stats.restarts],
      ];
      const node = el(`
        <div class="screen shade-full">
          <div class="results">
            <div class="eyebrow">${r.name} · Contract complete</div>
            <div class="big good">PAID IN FULL</div>
            <div class="ledger">
              ${rows.map(([a, b], k) => `<div style="animation-delay:${0.25 + k * 0.12}s"><span>${a}</span><b>${b}</b></div>`).join('')}
              <div class="total" style="animation-delay:${0.25 + rows.length * 0.12}s"><span>TOTAL EARNED</span><b>${money(r.earned)}</b></div>
            </div>
            <div class="label">RATING</div>
            <div class="grade">${r.grade}</div>
            <div class="menu">
              <button class="item">Continue</button>
              <button class="item">Armory</button>
            </div>
          </div>
        </div>`);
      stack.length = 0;
      mount('debrief', node, { back: null });
      screen.items[0].addEventListener('activate', () => (app.audio.ui('select'), app.toMenu('contracts')));
      screen.items[1].addEventListener('activate', () => (app.audio.ui('select'), app.toMenu('armory')));
    },

    failed(reason) {
      const node = el(`
        <div class="screen shade-full">
          <div class="results">
            <div class="eyebrow">Contract failed</div>
            <div class="big bad">${reason}</div>
            <div class="sub" style="margin-top:14px">Nobody gets paid for a body bag.</div>
            <div class="menu" style="margin-top:34px">
              <button class="item">Retry from checkpoint</button>
              <button class="item">Abandon contract</button>
            </div>
          </div>
        </div>`);
      stack.length = 0;
      mount('failed', node, { back: null });
      screen.items[0].addEventListener('activate', () => (app.audio.ui('select'), app.retry()));
      screen.items[1].addEventListener('activate', () => (app.audio.ui('select'), app.abandon()));
    },

    loading(i) {
      const m = MISSIONS[i];
      const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
      const node = el(`
        <div class="screen loading">
          <div class="eyebrow">Deploying · Contract 0${i + 1}</div>
          <div class="title">${m.name}</div>
          <div class="sub">${m.place.toUpperCase()} · ${DETAILS[m.theme].time}</div>
          <div class="bar"><i></i></div>
          <div class="tip"><b>INTEL</b>${tip}</div>
        </div>`);
      stack.length = 0;
      mount('loading', node, { items: '.none' });
    },
  };

  function show(name, data) {
    screens[name](data);
    if (screen) screen.data = data;
  }

  /** Keys from the keyboard or the gamepad, as menu verbs. */
  function key(k) {
    if (!screen) return;
    if (screen.name === 'title') {
      app.startGame();
      return;
    }
    if (k === 'back') return back();
    if (k === 'select') return activate();
    if (screen.onKey?.(k)) return;
    if (k === 'up') setFocus(screen.focus - 1);
    if (k === 'down') setFocus(screen.focus + 1);
  }

  window.addEventListener('keydown', (e) => {
    if (!screen || !app.menuActive()) return;
    const map = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Enter: 'select', Space: 'select', Escape: 'back', Backspace: 'back', KeyQ: 'tabLeft', KeyE: 'tabRight' };
    const k = map[e.code];
    if (screen.name === 'title') {
      if (!e.repeat) key('any');
      return;
    }
    if (!k) return;
    e.preventDefault();
    key(k);
  });

  return {
    show,
    go,
    get current() {
      return screen?.name ?? null;
    },
    hide() {
      if (!screen) return;
      const old = screen.el;
      old.classList.add('out');
      setTimeout(() => old.remove(), 260);
      screen = null;
    },
    /** Gamepad navigation, once a frame while a menu is up. */
    update(dt) {
      if (!screen) return;
      const pad = [...(navigator.getGamepads?.() || [])].find((p) => p && p.connected);
      if (!pad) return;
      const b = (i) => !!pad.buttons[i]?.pressed;
      const now = {
        up: b(12) || pad.axes[1] < -0.6,
        down: b(13) || pad.axes[1] > 0.6,
        left: b(14) || pad.axes[0] < -0.6,
        right: b(15) || pad.axes[0] > 0.6,
        select: b(0),
        back: b(1),
        tabLeft: b(4),
        tabRight: b(5),
        any: b(9) || b(0),
      };
      padRepeat -= dt;
      for (const [k, on] of Object.entries(now)) {
        const fresh = on && !padPrev[k];
        const repeat = on && padPrev[k] && padRepeat <= 0 && ['up', 'down', 'left', 'right'].includes(k);
        if (fresh || repeat) {
          if (screen.name === 'title' && k === 'any') key('any');
          else if (k !== 'any') key(k);
          padRepeat = fresh ? 0.4 : 0.12;
        }
      }
      padPrev = now;
    },
  };
}
