// The heads-up display, drawn on a 2D canvas over the 3D view every frame. Everything scales
// with the window. It reads as a hologram: cyan-teal light on smoked glass, thin lines, chamfered
// plates with bright corner brackets, scanlines and a soft glow. Layout: objectives and pay
// top-left; compass, heat meter and boss bar top centre; the pay feed top-right; your status and
// Cruz's card bottom-left; weapon bottom-right; the minimap top-right with the pay feed under
// it; prompts and subtitles bottom centre; the reticle
// in the middle between two arcs (your health on the left, the magazine on the right), with hit
// markers and damage arcs.
import { ENEMY_TYPES } from './actors.js';
import { AGGRO, HEALTH, PAL } from './config.js';
import { inArea } from './level.js';
import { distXZ } from './math.js';

const C = {
  white: '#eafcff',
  dim: 'rgba(214,246,252,0.6)',
  faint: 'rgba(160,236,248,0.22)',
  holo: '#54e8f2',
  holoDim: 'rgba(84,232,242,0.5)',
  holoFaint: 'rgba(84,232,242,0.16)',
  glass: 'rgba(2,16,22,0.6)',
  hatch: '#ffae3a',
  cruz: '#6aa8ff',
  red: '#ff4a3c',
  green: '#6cf0a0',
  gold: '#ffd25a',
  black: '#020a0d',
};
// The game's colours (config PAL) as the HUD draws them: pay and pickups glow in the HUD's cyan
const TONE = { [PAL.yellow]: C.holo, [PAL.white]: C.white, [PAL.blue]: C.cruz, [PAL.green]: C.green, [PAL.red]: C.red, [PAL.orange]: C.hatch, [PAL.grey]: C.dim };
const tone = (c) => TONE[c] || c;
const HEAD = "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif";
const BODY = "'Rajdhani', 'Barlow Condensed', 'Arial Narrow', sans-serif";

const fmtMoney = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function createHud(canvas, { project, settings }) {
  const ctx = canvas.getContext('2d');
  let W = 1;
  let H = 1;
  let S = 1; // scale
  let dpr = 1;
  const feed = []; // { text, color, t }
  const subs = []; // { who, text, color, t, life }
  const hits = []; // damage arcs: { ang, t }
  let killFlash = 0;
  let headFlash = false;
  let shownEarned = 0;
  let lastHitFrame = -1;
  let lastHp = null;
  let hurtPulse = 0;
  let aimK = 0; // eases toward 1 while aiming: the reticle arcs close in and brighten
  let inputDevice = 'keyboard';
  const notices = []; // screen popups, animated
  // Scanlines for the glass plates: one faint cyan line every three pixels
  const scan = (() => {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 3;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(84,232,242,0.07)';
    g.fillRect(0, 0, 1, 1);
    return ctx.createPattern(c, 'repeat');
  })();

  function resize(w, h) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = w;
    H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    S = Math.min(w / 1920, h / 1080) * 1.15;
    S = Math.max(0.62, S);
  }

  const font = (size, weight = 600, face = HEAD) => `${weight} ${Math.round(size * S)}px ${face}`;

  /** Text with a dark drop shadow, or with `glow` (a colour) a halo of light instead. */
  function text(str, x, y, { size = 20, weight = 600, color = C.white, align = 'left', base = 'alphabetic', face = HEAD, spacing = 0, shadow = true, glow = null, alpha = 1 } = {}) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = font(size, weight, face);
    ctx.textAlign = align;
    ctx.textBaseline = base;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * S}px`;
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = Math.min(10, size * 0.4) * S;
    } else if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = Math.min(4, size * 0.15) * S;
      ctx.shadowOffsetY = 1 * S;
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function measure(str, size, weight = 600, face = HEAD, spacing = 0) {
    ctx.save();
    ctx.font = font(size, weight, face);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * S}px`;
    const w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  /** A pane of smoked glass: chamfered corners, scanlines, a faint rim and two bright brackets. */
  function panel(x, y, w, h, { alpha = 1, accent = C.holo, cut = 10 } = {}) {
    const k = cut * S;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w - k, y);
    ctx.lineTo(x + w, y + k);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.lineTo(x, y + h - k);
    ctx.closePath();
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, 'rgba(2,16,22,0.64)');
    g.addColorStop(1, 'rgba(2,16,22,0.3)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.fillStyle = scan;
    ctx.fill();
    ctx.strokeStyle = C.holoFaint;
    ctx.lineWidth = 1 * S;
    ctx.stroke();
    const b = Math.min(14 * S, h * 0.4);
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 6 * S;
    ctx.lineWidth = 1.5 * S;
    ctx.beginPath();
    ctx.moveTo(x, y + b);
    ctx.lineTo(x, y);
    ctx.lineTo(x + b, y);
    ctx.moveTo(x + w, y + h - b);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - b, y + h);
    ctx.stroke();
    ctx.restore();
  }

  /** A horizontal hairline of light that fades out at both ends. */
  function hairline(x, y, w, color = C.holoDim, h = 1) {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, 'rgba(84,232,242,0)');
    g.addColorStop(0.15, color);
    g.addColorStop(0.85, color);
    g.addColorStop(1, 'rgba(84,232,242,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h * S);
  }

  function bar(x, y, w, h, k, color, { back = C.holoFaint, segments = 0, glow = true } = {}) {
    ctx.fillStyle = back;
    ctx.fillRect(x, y, w, h);
    ctx.save();
    if (glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 8 * S;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp01(k), h);
    ctx.restore();
    if (segments) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      for (let i = 1; i < segments; i++) ctx.fillRect(x + (w * i) / segments - S, y, 2 * S, h);
      ctx.restore();
    }
  }

  function keyCap(label, x, y, { size = 17, color = C.white, gamepad = false } = {}) {
    const w = Math.max(size * 1.5 * S, measure(label, size, 700, BODY) + 12 * S);
    const h = size * 1.45 * S;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * S;
    ctx.fillStyle = C.glass;
    ctx.beginPath();
    if (gamepad) ctx.arc(x + h / 2, y + h / 2, h / 2, 0, Math.PI * 2);
    else ctx.roundRect(x, y, w, h, 2 * S);
    ctx.fill();
    ctx.shadowColor = color;
    ctx.shadowBlur = 5 * S;
    ctx.stroke();
    ctx.restore();
    text(label, x + (gamepad ? h : w) / 2, y + h / 2 + 1 * S, { size, weight: 700, face: BODY, align: 'center', base: 'middle', color, shadow: false });
    return gamepad ? h : w;
  }

  // ------------------------------------------------------------ events

  function onEvent(type, data, game) {
    if (type === 'kill') {
      if (data.source === game.hatch) {
        killFlash = 14;
        headFlash = data.tag === 'HEADSHOT';
      }
      const who = data.source === game.cruz ? 'CRUZ' : data.source === game.hatch ? '' : '';
      const tag = data.tag && data.tag !== 'ARMOR' ? ` ${data.tag}` : '';
      feed.unshift({ text: `+${fmtMoney(data.pay)}${tag}`, sub: who, color: data.tag === 'HEADSHOT' ? C.gold : C.white, t: 0 });
      if (feed.length > 6) feed.pop();
    }
    if (type === 'areaCleared') feed.unshift({ text: '+$500 AREA SECURED', sub: '', color: C.green, t: 0 });
  }

  function say(who, line) {
    if (!settings.subtitles) return;
    subs.push({ who, text: line, color: who === 'CRUZ' ? C.cruz : who === 'HATCH' ? C.hatch : C.white, t: 0, life: 2.6 + line.length * 0.035 });
    if (subs.length > 2) subs.shift();
  }

  // ------------------------------------------------------------ the parts

  /** The arcs either side of the reticle: health on the left in five plates, rounds on the right. */
  function reticleArcs(h, g, dt) {
    aimK += ((h.aiming ? 1 : 0) - aimK) * Math.min(1, dt * 10);
    const cx = W / 2;
    const cy = H / 2;
    const R = (80 - 18 * aimK) * S;
    const span = 0.58;
    // t runs 0..1 from the bottom of an arc to its top; side -1 is the left arc
    const at = (side, t) => (side < 0 ? Math.PI - span + 2 * span * t : span - 2 * span * t);
    const seg = (side, r, t0, t1) => {
      const a = Math.min(at(side, t0), at(side, t1));
      const b = Math.max(at(side, t0), at(side, t1));
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.arc(cx, cy, r, a, b);
    };
    const stroke = (color, width, glow) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * S;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow * S;
      ctx.stroke();
    };
    const alpha = 0.5 + 0.45 * aimK;
    ctx.save();
    ctx.globalAlpha = alpha;
    // Guide lines just outside both arcs, with ticks at their ends
    ctx.beginPath();
    for (const side of [-1, 1]) {
      seg(side, R + 8 * S, 0, 1);
      for (const t of [0, 1]) {
        const a = at(side, t);
        ctx.moveTo(cx + Math.cos(a) * (R + 4 * S), cy + Math.sin(a) * (R + 4 * S));
        ctx.lineTo(cx + Math.cos(a) * (R + 12 * S), cy + Math.sin(a) * (R + 12 * S));
      }
    }
    stroke(C.holoDim, 1, 0);
    // Health
    const hp = clamp01(h.hp / h.maxHp);
    const hc = hp < 0.3 ? C.red : C.holo;
    const n = 5;
    const gap = 0.025;
    ctx.beginPath();
    for (let i = 0; i < n; i++) seg(-1, R, i / n + gap, (i + 1) / n - gap);
    stroke(C.holoFaint, 5, 0);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = clamp01(hp * n - i);
      const t0 = i / n + gap;
      const t1 = (i + 1) / n - gap;
      if (f > 0) seg(-1, R, t0, t0 + (t1 - t0) * f);
    }
    stroke(hc, 5, 8);
    // The magazine: a tick a round (a few rounds a tick for big drums), emptying from the top
    const def = g.def;
    const ticks = Math.min(def.mag, 36);
    const per = def.mag / ticks;
    const full = Math.ceil(g.ammo / per);
    const ac = g.ammo === 0 ? C.red : g.ammo <= def.mag * 0.25 ? C.hatch : C.holo;
    const tw = Math.min(4, ((2 * span * 80) / ticks) * 0.55);
    for (const filled of [false, true]) {
      ctx.beginPath();
      for (let i = 0; i < ticks; i++) {
        if (i < full !== filled) continue;
        const a = at(1, (i + 0.5) / ticks);
        ctx.moveTo(cx + Math.cos(a) * (R - 4 * S), cy + Math.sin(a) * (R - 4 * S));
        ctx.lineTo(cx + Math.cos(a) * (R + 3 * S), cy + Math.sin(a) * (R + 3 * S));
      }
      stroke(filled ? ac : C.holoFaint, tw, filled ? 6 : 0);
    }
    // Reloading sweeps the guide line in amber
    if (h.reloadT > 0) {
      ctx.beginPath();
      seg(1, R + 8 * S, 0, clamp01(1 - h.reloadT / def.reload));
      stroke(C.hatch, 2.5, 8);
    }
    // Small read-outs under the arcs: a cross for health, the round count for the magazine
    const la = at(-1, 0);
    const lx = cx + Math.cos(la) * (R + 18 * S);
    const ly = cy + Math.sin(la) * (R + 18 * S);
    ctx.fillStyle = hc;
    ctx.shadowColor = hc;
    ctx.shadowBlur = 6 * S;
    ctx.fillRect(lx - 1.5 * S, ly - 5 * S, 3 * S, 10 * S);
    ctx.fillRect(lx - 5 * S, ly - 1.5 * S, 10 * S, 3 * S);
    ctx.restore();
    const ra = at(1, 0);
    text(String(g.ammo), cx + Math.cos(ra) * (R + 20 * S), cy + Math.sin(ra) * (R + 20 * S), { size: 15, weight: 700, face: BODY, align: 'center', base: 'middle', color: ac, glow: ac, alpha });
  }

  function crosshair(game, view, dt) {
    const h = game.hatch;
    const cx = W / 2;
    const cy = H / 2;
    if (game.mode === 'snipe') {
      // Scope reticle: thin lines and mil dots; the round mask is in the post shader
      const r = Math.min(W, H) * 0.41;
      ctx.save();
      ctx.strokeStyle = 'rgba(10,10,10,0.9)';
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx - 8 * S, cy);
      ctx.moveTo(cx + 8 * S, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy - 8 * S);
      ctx.moveTo(cx, cy + 8 * S);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
      // Heavy posts on the outer half of three arms
      ctx.lineWidth = 5 * S;
      ctx.beginPath();
      for (const [a, b] of [[-r, -r * 0.5], [r * 0.5, r]]) {
        ctx.moveTo(cx + a, cy);
        ctx.lineTo(cx + b, cy);
      }
      ctx.moveTo(cx, cy + r * 0.5);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
      ctx.fillStyle = 'rgba(10,10,10,0.9)';
      for (let i = -4; i <= 4; i++) {
        if (!i) continue;
        ctx.beginPath();
        ctx.arc(cx + i * r * 0.1, cy, 2 * S, 0, Math.PI * 2);
        ctx.arc(cx, cy + i * r * 0.1, 2 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = C.red;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const g = h.guns.sniper;
      text(`${g.ammo} / ${g.reserve}`, cx + r * 0.62, cy + r * 0.62, { size: 22, face: BODY, weight: 700, color: C.white });
      text('CRUZ FIRES WITH YOU', cx, cy - r * 0.86, { size: 18, align: 'center', color: C.cruz, spacing: 3 });
    } else if (!h.sprint && !h.vault && !h.using && game.mode !== 'boost') {
      const g = h.guns[h.weapon];
      const def = g.def;
      const moving = Math.hypot(h.vx, h.vz) > 1;
      const spread = (h.aiming ? def.aimSpread || def.spread * 0.3 : def.spread) * (h.crouch ? 0.75 : 1) * (moving ? 1.35 : 1) + h.recoil * def.spread;
      const fovR = (view.fov * Math.PI) / 180;
      const gap = Math.max(5 * S, (Math.tan(spread) / Math.tan(fovR / 2)) * (H / 2)) + 3 * S;
      const len = 8 * S;
      const col = h.reloadT > 0 ? C.holoDim : C.white;
      // Three spread ticks (left, right, below) and a dot
      const lines = [[gap, 0, gap + len, 0], [-gap, 0, -gap - len, 0], [0, gap, 0, gap + len]];
      ctx.save();
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? col : 'rgba(0,10,14,0.5)';
        ctx.lineWidth = (pass ? 1.6 : 3.6) * S;
        if (pass) {
          ctx.shadowColor = C.holo;
          ctx.shadowBlur = 6 * S;
        }
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of lines) {
          ctx.moveTo(cx + x0, cy + y0);
          ctx.lineTo(cx + x1, cy + y1);
        }
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      reticleArcs(h, g, dt);
    } else aimK = 0;
    // Hit marker: white on a hit, red on a kill
    if (game.hitMarker > 0 || killFlash > 0) {
      const kill = killFlash > 0;
      const k = kill ? killFlash / 14 : game.hitMarker / 8;
      const r0 = (kill ? 10 : 8) * S;
      const r1 = r0 + (kill ? 11 : 8) * S;
      const col = kill ? (headFlash ? C.gold : C.red) : C.white;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.lineWidth = (kill ? 3 : 2) * S;
      ctx.strokeStyle = col;
      ctx.shadowColor = kill ? col : C.holo;
      ctx.shadowBlur = 8 * S;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        ctx.moveTo(cx + sx * r0, cy + sy * r0);
        ctx.lineTo(cx + sx * r1, cy + sy * r1);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (killFlash > 0) killFlash -= dt * 60;
  }

  function damageArcs(game, view, dt) {
    const h = game.hatch;
    if (h.hitFrom && h.hitFrom.frame !== lastHitFrame) {
      lastHitFrame = h.hitFrom.frame;
      hits.push({ x: h.hitFrom.x, z: h.hitFrom.z, t: 0 });
      if (hits.length > 6) hits.shift();
    }
    const cx = W / 2;
    const cy = H / 2;
    const R = 150 * S;
    for (const d of hits) {
      d.t += dt;
      const a = Math.max(0, 1 - d.t / 1.4);
      if (!a) continue;
      const rel = Math.atan2(d.z - h.z, d.x - h.x) - view.yaw;
      const ang = rel - Math.PI / 2;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 7 * S;
      ctx.shadowColor = C.red;
      ctx.shadowBlur = 14 * S;
      ctx.beginPath();
      ctx.arc(cx, cy, R, ang - 0.32, ang + 0.32);
      ctx.stroke();
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 9 * S, ang - 0.22, ang + 0.22);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = hits.length - 1; i >= 0; i--) if (hits[i].t > 1.4) hits.splice(i, 1);
  }

  /** A marker at a world point, clamped to the screen edge with an arrow when it's off-screen. */
  function marker(view, at, { label = '', color = C.holo, icon = 'diamond', dist = null, y = 2.2, progress = null } = {}) {
    const p = project(at.x, (at.y ?? 0) + y, at.z, W, H);
    const m = 60 * S;
    let x;
    let yy;
    let off = false;
    if (p && p.x > m && p.x < W - m && p.y > m && p.y < H - m) {
      x = p.x;
      yy = p.y;
    } else {
      // Off screen or behind: put it on an ellipse round the edge in its direction
      const rel = Math.atan2(at.z - view.position.z, at.x - view.position.x) - view.yaw;
      const sx = Math.sin(rel);
      const sy = -Math.cos(rel);
      x = W / 2 + sx * (W / 2 - m);
      yy = H / 2 + sy * (H / 2 - m);
      off = true;
    }
    ctx.save();
    ctx.translate(x, yy);
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 * S;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2 * S;
    const s = 9 * S;
    if (icon === 'diamond') {
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.lineTo(s, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.5 * S, 0, Math.PI * 2);
      ctx.fill();
    } else if (icon === 'cross') {
      ctx.fillRect(-s * 0.3, -s, s * 0.6, s * 2);
      ctx.fillRect(-s, -s * 0.3, s * 2, s * 0.6);
    } else if (icon === 'chevron') {
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, -s * 0.5);
      ctx.lineTo(0, s * 0.4);
      ctx.lineTo(s * 0.8, -s * 0.5);
      ctx.stroke();
    } else if (icon === 'heli') {
      ctx.beginPath();
      ctx.arc(0, 0, s, 0, Math.PI * 2);
      ctx.stroke();
      text('H', 0, 1 * S, { size: 16, weight: 700, align: 'center', base: 'middle', color, shadow: false });
    }
    // Brackets round the icon
    ctx.lineWidth = 1.2 * S;
    ctx.globalAlpha *= 0.6;
    const b = s * 1.7;
    const l = s * 0.6;
    ctx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(sx * b, sy * (b - l));
      ctx.lineTo(sx * b, sy * b);
      ctx.lineTo(sx * (b - l), sy * b);
    }
    ctx.stroke();
    ctx.globalAlpha /= 0.6;
    if (progress !== null) {
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.arc(0, 0, s * 2.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(progress));
      ctx.stroke();
    }
    ctx.restore();
    if (label) text(label, x, yy - 22 * S, { size: 15, align: 'center', color, glow: color, spacing: 2, weight: 700 });
    if (dist !== null && (off || dist > 6)) text(`${Math.round(dist)}m`, x, yy + 30 * S, { size: 14, align: 'center', color: C.dim, face: BODY, weight: 700 });
  }

  /** Where the contract wants you next: the place to take, the way into it, or the helicopter. */
  function waypoint(game) {
    const h = game.hatch;
    const level = game.level;
    const i = game.focusArea();
    if (i < 0) {
      const end = level.areas[level.areas.length - 1];
      return end.extract ? { at: end.extract, label: 'EXTRACT', color: C.green, icon: 'heli' } : null;
    }
    const area = level.areas[i];
    if (game.areas[i].triggered) return null;
    // Walled in: over the wall from the area before it
    const prev = level.areas[i - 1];
    if (prev?.boost && game.areas[prev.index].cleared && !inArea(area, h, 2)) return { at: prev.boost, label: 'LEG-UP', color: C.green, icon: 'diamond' };
    return { at: area.center, label: area.name, color: C.holo, icon: 'diamond' };
  }

  function worldMarkers(game, view) {
    const h = game.hatch;
    const i = game.focusArea();
    const area = i >= 0 ? game.level.areas[i] : null;
    const st = i >= 0 ? game.areas[i] : null;
    if (area && st.triggered) {
      for (const o of area.objectives) {
        if (o.done) continue;
        marker(view, o, { label: o.kind === 'plant' ? 'SET CHARGE' : 'FREE HOSTAGE', color: C.holo, dist: distXZ(h, o), progress: o.progress ? o.progress / 120 : null, y: 1.6 });
      }
    }
    const way = game.mode === 'complete' ? null : waypoint(game);
    if (way) marker(view, way.at, { label: way.label, color: way.color, icon: way.icon, dist: distXZ(h, way.at), y: way.icon === 'heli' ? 1 : 2.4 });
    if (area?.nest && st.triggered && game.mode === 'play' && game.enemiesIn(i).some((e) => e.tower)) marker(view, area.nest, { label: 'SYNC SHOT', color: C.cruz, dist: distXZ(h, area.nest), y: 0.6 });
    const c = game.cruz;
    if (!c.gone) {
      if (c.downed) {
        const left = c.bleed / HEALTH.bleedOut;
        marker(view, c, { label: `REVIVE CRUZ  ${Math.ceil(c.bleed / 60)}s`, color: C.red, icon: 'cross', dist: distXZ(h, c), y: 1.4, progress: c.reviving ? c.reviving / HEALTH.reviveTime : left });
      } else if (game.mode !== 'snipe') {
        const p = project(c.x, c.y + 2.05, c.z, W, H);
        if (p) {
          ctx.save();
          ctx.globalAlpha = 0.85;
          text('CRUZ', p.x, p.y - 8 * S, { size: 13, align: 'center', color: C.cruz, glow: C.cruz, weight: 700, spacing: 2 });
          ctx.fillStyle = C.cruz;
          ctx.shadowColor = C.cruz;
          ctx.shadowBlur = 6 * S;
          ctx.beginPath();
          ctx.moveTo(p.x - 5 * S, p.y - 3 * S);
          ctx.lineTo(p.x + 5 * S, p.y - 3 * S);
          ctx.lineTo(p.x, p.y + 3 * S);
          ctx.fill();
          ctx.restore();
        } else marker(view, c, { label: 'CRUZ', color: C.cruz, icon: 'chevron', y: 2 });
      }
    }
    // Grenades about to go off near you
    for (const g of game.grenades) {
      if (g.team === 'contractors' || distXZ(g, h) > 10) continue;
      const pulse = 0.6 + Math.sin(performance.now() / 70) * 0.4;
      ctx.save();
      ctx.globalAlpha = pulse;
      marker(view, g, { label: 'GRENADE', color: C.red, icon: 'diamond', y: 0.4 });
      ctx.restore();
    }
  }

  function popups(game, view) {
    // World popups ride on small lit plates with an edge in their colour
    for (const p of game.popups) {
      if (p.screen) continue;
      const pt = project(p.x, p.y, p.z, W, H);
      if (!pt) continue;
      const a = Math.min(1, p.t / 20);
      const col = tone(p.color);
      const size = p.text.startsWith('$') ? 18 : 15;
      const pw = measure(p.text, size, 700, BODY, 1.5) + 20 * S;
      const ph = size * 1.4 * S;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = C.glass;
      ctx.fillRect(pt.x - pw / 2, pt.y - ph / 2, pw, ph);
      ctx.fillStyle = scan;
      ctx.fillRect(pt.x - pw / 2, pt.y - ph / 2, pw, ph);
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 6 * S;
      ctx.fillRect(pt.x - pw / 2, pt.y - ph / 2, 2.5 * S, ph);
      ctx.fillRect(pt.x - pw / 2, pt.y + ph / 2 - 1 * S, pw * 0.35, 1 * S);
      ctx.restore();
      text(p.text, pt.x + 2 * S, pt.y + 1 * S, { size, weight: 700, face: BODY, align: 'center', base: 'middle', color: col, glow: col, alpha: a, spacing: 1.5 });
    }
    // Screen notices slide in under the compass and fade
    for (const p of game.popups) {
      if (!p.screen || p._noticed) continue;
      p._noticed = true;
      notices.push({ text: p.text, color: tone(p.color), t: 0 });
      if (notices.length > 3) notices.shift();
    }
    // Under the area title while it's showing, so the two never overlap
    let y = game.banner?.t > 0 ? H * 0.47 : H * 0.27;
    for (const n of notices) {
      const life = 3.2;
      const a = Math.min(1, n.t * 4) * Math.min(1, (life - n.t) * 2);
      if (a <= 0) continue;
      const slide = (1 - Math.min(1, n.t * 4)) * 30 * S;
      const w = measure(n.text, 24, 700, HEAD, 4) + 64 * S;
      panel(W / 2 - w / 2, y - 26 * S, w, 38 * S, { alpha: a, accent: n.color, cut: 8 });
      text(n.text, W / 2 + slide, y, { size: 24, weight: 700, align: 'center', color: n.color, glow: n.color, alpha: a, spacing: 4 });
      y += 48 * S;
    }
    void view;
  }

  function compass(game, view) {
    const cx = W / 2;
    const y = 30 * S;
    const w = 520 * S;
    const base = y + 11 * S;
    const yawDeg = ((view.yaw * 180) / Math.PI) % 360;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - w / 2, y - 18 * S, w, 44 * S);
    ctx.clip();
    hairline(cx - w / 2, base, w, C.holoDim);
    const pxPerDeg = w / 160;
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = -90; d <= 90; d += 5) {
      const deg = Math.round(yawDeg + d - ((yawDeg + d) % 5));
      const nd = ((deg % 360) + 360) % 360;
      const x = cx + (deg - yawDeg) * pxPerDeg;
      const edge = 1 - Math.abs(x - cx) / (w / 2);
      ctx.globalAlpha = Math.max(0, edge * 1.4);
      if (names[nd] !== undefined) text(names[nd], x, y + 4 * S, { size: nd % 90 ? 15 : 19, align: 'center', weight: 700, color: nd === 0 ? C.holo : C.white });
      else {
        const l = (nd % 15 ? 4 : 8) * S;
        ctx.fillStyle = C.holoDim;
        ctx.fillRect(x - 0.75 * S, base - l, 1.5 * S, l);
      }
    }
    ctx.globalAlpha = 1;
    // Bearings to things that matter
    const h = game.hatch;
    const bearing = (at, color) => {
      let d = (Math.atan2(at.z - h.z, at.x - h.x) * 180) / Math.PI - yawDeg;
      d = ((d + 540) % 360) - 180;
      const x = cx + Math.max(-78, Math.min(78, d)) * pxPerDeg;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6 * S;
      ctx.beginPath();
      ctx.moveTo(x, base + 3 * S);
      ctx.lineTo(x + 5 * S, base + 10 * S);
      ctx.lineTo(x - 5 * S, base + 10 * S);
      ctx.fill();
    };
    const i = game.focusArea();
    if (i >= 0 && game.areas[i].triggered) for (const o of game.level.areas[i].objectives) if (!o.done) bearing(o, C.holo);
    const way = waypoint(game);
    if (way) bearing(way.at, way.color);
    if (!game.cruz.gone) bearing(game.cruz, game.cruz.downed ? C.red : C.cruz);
    ctx.restore();
    // The heading notch
    ctx.save();
    ctx.fillStyle = C.holo;
    ctx.shadowColor = C.holo;
    ctx.shadowBlur = 6 * S;
    ctx.beginPath();
    ctx.moveTo(cx - 5 * S, y - 17 * S);
    ctx.lineTo(cx + 5 * S, y - 17 * S);
    ctx.lineTo(cx, y - 11 * S);
    ctx.fill();
    ctx.restore();
  }

  function heat(game) {
    const cx = W / 2;
    const y = 74 * S;
    const w = 300 * S;
    if (game.overkill) {
      const k = game.overkill.t / AGGRO.overkillFrames;
      const who = game.overkill.who === 'hatch' ? 'HATCH' : 'CRUZ';
      const col = game.overkill.who === 'hatch' ? C.hatch : C.cruz;
      const pulse = 0.75 + Math.sin(performance.now() / 90) * 0.25;
      text(`REDLINE  ·  ${who}`, cx, y + 4 * S, { size: 24, weight: 800, align: 'center', color: col, glow: col, spacing: 6, alpha: pulse });
      bar(cx - w / 2, y + 12 * S, w, 4 * S, k, col);
      text(game.overkill.who === 'hatch' ? 'YOU HIT HARDER AND TAKE LESS. CRUZ IS IGNORED.' : 'THEY ONLY SEE CRUZ. GO ROUND THEM.', cx, y + 34 * S, { size: 13, align: 'center', color: C.dim, spacing: 2 });
      return;
    }
    const k = game.aggro / AGGRO.max; // -1 cruz .. 1 hatch
    text('HEAT', cx, y - 5 * S, { size: 11, align: 'center', color: C.holoDim, spacing: 6, weight: 700, shadow: false });
    ctx.fillStyle = C.holoFaint;
    ctx.fillRect(cx - w / 2, y, w, 5 * S);
    ctx.fillStyle = C.holoDim;
    ctx.fillRect(cx - w / 2, y - 2 * S, 1 * S, 9 * S);
    ctx.fillRect(cx + w / 2 - 1 * S, y - 2 * S, 1 * S, 9 * S);
    ctx.save();
    ctx.shadowBlur = 8 * S;
    if (k > 0) {
      ctx.shadowColor = C.hatch;
      ctx.fillStyle = C.hatch;
      ctx.fillRect(cx, y, (w / 2) * k, 5 * S);
    } else if (k < 0) {
      ctx.shadowColor = C.cruz;
      ctx.fillStyle = C.cruz;
      ctx.fillRect(cx + (w / 2) * k, y, (-w / 2) * k, 5 * S);
    }
    ctx.restore();
    ctx.fillStyle = C.white;
    ctx.fillRect(cx - 1 * S, y - 3 * S, 2 * S, 11 * S);
    text('CRUZ', cx - w / 2 - 8 * S, y + 6 * S, { size: 13, align: 'right', color: C.cruz, weight: 700, spacing: 2 });
    text('HATCH', cx + w / 2 + 8 * S, y + 6 * S, { size: 13, align: 'left', color: C.hatch, weight: 700, spacing: 2 });
  }

  function bossBar(game) {
    if (!game.bossActive) return;
    const b = game.boss;
    const def = ENEMY_TYPES[b.type];
    const cx = W / 2;
    const y = 128 * S;
    const w = 560 * S;
    text(def.name, cx, y, { size: 22, weight: 800, align: 'center', color: C.white, glow: C.red, spacing: 8 });
    bar(cx - w / 2, y + 10 * S, w, 8 * S, b.hp / b.maxHp, C.red, { segments: 10, back: 'rgba(255,74,60,0.14)' });
    text('ARMORED FROM THE FRONT · FLANK HIM', cx, y + 38 * S, { size: 13, align: 'center', color: C.dim, spacing: 3 });
  }

  function objectives(game, progress, dt) {
    const x = 34 * S;
    const top = 28 * S;
    let y = 46 * S;
    const h = game.hatch;
    const i = game.focusArea();
    const area = i >= 0 ? game.level.areas[i] : null;
    const st = i >= 0 ? game.areas[i] : null;
    text(game.mission.name, x, y, { size: 14, weight: 700, color: C.holo, glow: C.holo, spacing: 5 });
    const taken = game.areas.filter((a) => a.cleared).length;
    text(`${taken} / ${game.areas.length} TAKEN`, x + 250 * S, y, { size: 12, weight: 700, color: C.holoDim, align: 'right', spacing: 2, shadow: false });
    y += 26 * S;
    text(area ? area.name : 'EXTRACTION', x, y, { size: 26, weight: 700, spacing: 2 });
    y += 10 * S;
    hairline(x - 14 * S, y, 280 * S, C.holoDim);
    y += 24 * S;
    const lines = [];
    if (!area) lines.push(['Get to the extraction point', game.mode === 'complete']);
    else if (!st.triggered) {
      const way = waypoint(game);
      lines.push([way?.label === 'LEG-UP' ? 'Leg-up over the wall' : `Reach ${area.name.replace('THE ', 'the ').toLowerCase()}`, false, way ? `${Math.round(distXZ(h, way.at))}m` : '']);
    } else {
      const alive = game.enemiesIn(i).length;
      lines.push([alive ? `Eliminate hostiles (${alive})` : 'Hold the area', false]);
      for (const o of area.objectives) lines.push([o.kind === 'plant' ? 'Set demolition charge' : 'Free the hostage', o.done]);
      if (area.nest && game.enemiesIn(i).some((e) => e.tower)) lines.push(['Sync shot the marksmen', false]);
      if (area.spec.boss) lines.push([`Neutralize ${ENEMY_TYPES[area.spec.boss].name.replace('THE ', 'the ').toLowerCase()}`, st.cleared]);
    }
    for (const [label, done, note] of lines) {
      // A diamond bullet: an outline while open, lit green when done
      const bx = x + 5 * S;
      const by = y - 5.5 * S;
      const r = 5 * S;
      ctx.save();
      ctx.strokeStyle = done ? C.green : C.holo;
      ctx.fillStyle = C.green;
      ctx.shadowColor = done ? C.green : C.holo;
      ctx.shadowBlur = 6 * S;
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.moveTo(bx, by - r);
      ctx.lineTo(bx + r, by);
      ctx.lineTo(bx, by + r);
      ctx.lineTo(bx - r, by);
      ctx.closePath();
      if (done) ctx.fill();
      else ctx.stroke();
      ctx.restore();
      text(label, x + 20 * S, y, { size: 17, weight: 600, face: BODY, color: done ? C.dim : C.white });
      if (note) text(note, x + 250 * S, y, { size: 15, weight: 700, face: BODY, color: C.holoDim, align: 'right' });
      y += 26 * S;
    }
    // Pay so far
    shownEarned += (game.earned - shownEarned) * Math.min(1, dt * 6);
    y += 8 * S;
    text('CONTRACT PAY', x, y, { size: 12, weight: 700, color: C.holoDim, spacing: 3, shadow: false });
    text(fmtMoney(shownEarned), x, y + 26 * S, { size: 26, weight: 700, face: BODY, color: C.white, glow: C.holo });
    // A thin rail of light down the left of the block
    const g = ctx.createLinearGradient(0, top, 0, y + 30 * S);
    g.addColorStop(0, C.holo);
    g.addColorStop(1, 'rgba(84,232,242,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 14 * S, top, 1.5 * S, y + 30 * S - top);
    void progress;
  }

  // ---- the minimap: the map round you, turned so you face up
  let mapImage = null;
  function mapFor(level) {
    if (mapImage?.level === level && mapImage.boxes === level.boxes) return mapImage;
    const b = level.bounds;
    const PX = 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.x1 - b.x0) * PX);
    c.height = Math.ceil((b.z1 - b.z0) * PX);
    const g = c.getContext('2d');
    const rect = (r, fill) => {
      g.fillStyle = fill;
      g.fillRect((r.x0 - b.x0) * PX, (r.z0 - b.z0) * PX, Math.max(1, (r.x1 - r.x0) * PX), Math.max(1, (r.z1 - r.z0) * PX));
    };
    for (const r of level.roads) rect(r, 'rgba(84,232,242,0.13)');
    for (const o of level.boxes) {
      if (o.kind === 'block' || o.kind === 'wall' || o.kind === 'boostwall' || o.kind === 'gate' || o.kind === 'rock') rect(o, o.kind === 'gate' ? 'rgba(255,74,60,0.8)' : 'rgba(84,232,242,0.42)');
      else if (o.kind === 'cover' || o.kind === 'tower' || o.kind === 'target') rect(o, 'rgba(84,232,242,0.22)');
      else if (o.kind === 'tree') rect({ x0: o.x0 - 0.8, x1: o.x1 + 0.8, z0: o.z0 - 0.8, z1: o.z1 + 0.8 }, 'rgba(108,240,160,0.25)');
    }
    mapImage = { level, boxes: level.boxes, canvas: c, PX };
    return mapImage;
  }

  const MAP_R = 92;
  function minimap(game, view) {
    const level = game.level;
    const m = mapFor(level);
    const h = game.hatch;
    const R = MAP_R * S;
    const cx = W - 34 * S - R;
    const cy = 30 * S + R;
    const k = R / 75; // pixels per metre: 75 m to the rim
    const yaw = view.yaw;
    const rot = -Math.PI / 2 - yaw;
    // Where a world point lands on the map
    const toMap = (p) => {
      const dx = (p.x - h.x) * k;
      const dz = (p.z - h.z) * k;
      return { x: cx + dx * Math.cos(rot) - dz * Math.sin(rot), y: cy + dx * Math.sin(rot) + dz * Math.cos(rot) };
    };
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(2,16,22,0.55)';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = scan;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(k / m.PX, k / m.PX);
    ctx.translate(-(h.x - level.bounds.x0) * m.PX, -(h.z - level.bounds.z0) * m.PX);
    ctx.drawImage(m.canvas, 0, 0);
    ctx.restore();
    // The places to take: outlines, lit when they're live, green when taken
    for (const a of level.areas) {
      const st = game.areas[a.index];
      const corners = [{ x: a.x0, z: a.z0 }, { x: a.x1, z: a.z0 }, { x: a.x1, z: a.z1 }, { x: a.x0, z: a.z1 }].map(toMap);
      ctx.beginPath();
      corners.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.strokeStyle = st.cleared ? 'rgba(108,240,160,0.5)' : st.triggered ? C.red : C.holoDim;
      ctx.lineWidth = (st.triggered && !st.cleared ? 2 : 1.2) * S;
      ctx.setLineDash(st.triggered ? [] : [4 * S, 3 * S]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Enemies who know you're there, and close enough to hear
    for (const e of game.enemies) {
      if (e.dead || e.alert === false || distXZ(e, h) > 80) continue;
      const p = toMap(e);
      ctx.fillStyle = C.red;
      ctx.shadowColor = C.red;
      ctx.shadowBlur = 5 * S;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (e.type === 'heavy' || ENEMY_TYPES[e.type].boss ? 3.6 : 2.6) * S, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (!game.cruz.gone) {
      const p = toMap(game.cruz);
      ctx.fillStyle = game.cruz.downed ? C.red : C.cruz;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 * S, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // The waypoint, held to the rim when it's further than the map shows
    const way = waypoint(game);
    if (way) {
      let p = toMap(way.at);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > R - 6 * S) p = { x: cx + ((p.x - cx) / d) * (R - 6 * S), y: cy + ((p.y - cy) / d) * (R - 6 * S) };
      ctx.save();
      ctx.fillStyle = way.color;
      ctx.shadowColor = way.color;
      ctx.shadowBlur = 8 * S;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5 * S);
      ctx.lineTo(p.x + 5 * S, p.y);
      ctx.lineTo(p.x, p.y + 5 * S);
      ctx.lineTo(p.x - 5 * S, p.y);
      ctx.fill();
      ctx.restore();
    }
    // Rim, ticks and you in the middle
    ctx.save();
    ctx.strokeStyle = C.holoDim;
    ctx.lineWidth = 1.5 * S;
    ctx.shadowColor = C.holo;
    ctx.shadowBlur = 6 * S;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1 * S;
    ctx.strokeStyle = C.holoFaint;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.white;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7 * S);
    ctx.lineTo(cx + 5 * S, cy + 5 * S);
    ctx.lineTo(cx, cy + 2.5 * S);
    ctx.lineTo(cx - 5 * S, cy + 5 * S);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // North on the rim (the compass's N)
    const na = -Math.PI / 2 - yaw;
    text('N', cx + Math.cos(na) * (R + 9 * S), cy + Math.sin(na) * (R + 9 * S), { size: 13, weight: 800, align: 'center', base: 'middle', color: C.holo, shadow: false });
  }

  function feedPanel(dt) {
    const x = W - 34 * S;
    let y = 30 * S + MAP_R * 2 * S + 44 * S;
    for (const f of feed) {
      f.t += dt;
      const a = Math.min(1, f.t * 6) * clamp01((4 - f.t) * 1.5);
      if (a <= 0) continue;
      const slide = (1 - Math.min(1, f.t * 6)) * 40 * S;
      const lit = f.color === C.white ? C.holo : f.color;
      text(f.text, x + slide, y, { size: 20, weight: 700, face: BODY, align: 'right', color: f.color, glow: lit, alpha: a, spacing: 1 });
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = lit;
      ctx.fillRect(x + 8 * S + slide, y - 15 * S, 2 * S, 16 * S);
      ctx.restore();
      y += 28 * S;
    }
    while (feed.length && feed[feed.length - 1].t > 4) feed.pop();
  }

  function status(game) {
    const h = game.hatch;
    const c = game.cruz;
    const x = 34 * S;
    const y = H - 150 * S;
    // Hatch
    const hp = h.hp / h.maxHp;
    panel(x - 12 * S, y - 30 * S, 330 * S, 66 * S, { accent: C.hatch });
    text('HATCH', x, y - 6 * S, { size: 20, weight: 700, color: C.hatch, glow: C.hatch, spacing: 3 });
    if (h.downed) text(`DOWN · ${Math.ceil(h.bleed / 60)}s`, x + 300 * S, y - 6 * S, { size: 18, weight: 700, color: C.red, align: 'right', face: BODY });
    const low = hp < 0.3 && !h.downed;
    const flash = low ? 0.6 + Math.sin(performance.now() / 120) * 0.4 : 1;
    bar(x, y + 6 * S, 300 * S, 10 * S, h.downed ? h.bleed / HEALTH.bleedOut : hp, h.downed ? C.red : low ? `rgba(255,74,60,${flash})` : C.holo, { segments: 5 });
    if (h.sinceHit > HEALTH.regenDelay && hp < 1 && !h.downed) text('RECOVERING', x + 300 * S, y - 6 * S, { size: 13, weight: 700, color: C.green, align: 'right', spacing: 2 });
    // Cruz
    const y2 = y + 58 * S;
    panel(x - 12 * S, y2 - 24 * S, 330 * S, 72 * S, { accent: C.cruz });
    text('CRUZ', x, y2, { size: 17, weight: 700, color: C.cruz, glow: C.cruz, spacing: 3 });
    const state = c.gone ? 'GONE' : c.downed ? `DOWN · ${Math.ceil(c.bleed / 60)}s` : h.downed ? 'COMING FOR YOU' : c.reloadT > 0 ? 'RELOADING' : c.target ? 'ENGAGING' : 'READY';
    text(state, x + 300 * S, y2, { size: 15, weight: 700, color: c.downed ? C.red : C.dim, align: 'right', face: BODY, spacing: 1 });
    bar(x, y2 + 8 * S, 300 * S, 5 * S, c.downed ? c.bleed / HEALTH.bleedOut : c.hp / c.maxHp, c.downed ? C.red : C.cruz);
    // Orders
    let ox = x;
    const oy = y2 + 22 * S;
    const pad = inputDevice === 'gamepad';
    for (const [order, key, padKey, label] of [['advance', 'Z', '↑', 'ADVANCE'], ['regroup', 'X', '←', 'REGROUP'], ['hold', 'V', '↓', 'HOLD']]) {
      const on = game.order === order;
      const kw = keyCap(pad ? padKey : key, ox, oy, { size: 12, color: on ? C.holo : C.dim, gamepad: false });
      text(label, ox + kw + 5 * S, oy + 13 * S, { size: 14, weight: 700, color: on ? C.white : C.dim, spacing: 1 });
      ox += kw + measure(label, 14, 700, HEAD, 1) + 18 * S;
    }
  }

  function weaponPanel(game) {
    const h = game.hatch;
    const g = h.guns[h.weapon];
    const x = W - 34 * S;
    const y = H - 70 * S;
    panel(W - 360 * S, y - 76 * S, 340 * S, 104 * S);
    const name = g.def.name;
    text(name, x, y - 52 * S, { size: 15, weight: 700, color: C.holo, glow: C.holo, align: 'right', spacing: 3 });
    const reserve = g.reserve === Infinity ? '∞' : g.reserve;
    const rw = measure(String(reserve), 24, 600, BODY);
    text(String(reserve), x, y, { size: 24, weight: 600, face: BODY, align: 'right', color: C.dim });
    text('/', x - rw - 8 * S, y, { size: 24, weight: 500, face: BODY, align: 'right', color: C.holoDim });
    const empty = g.ammo === 0;
    const ac = empty ? C.red : g.ammo <= g.def.mag * 0.25 ? C.hatch : C.white;
    text(String(g.ammo), x - rw - 22 * S, y + 2 * S, { size: 54, weight: 700, face: BODY, align: 'right', color: ac, glow: ac === C.white ? C.holo : ac });
    // Rounds in the magazine as ticks
    const n = g.def.mag;
    const tw = Math.min(6 * S, (300 * S) / n);
    ctx.save();
    ctx.fillStyle = C.holoFaint;
    for (let i = g.ammo; i < n; i++) ctx.fillRect(x - (i + 1) * tw, y + 12 * S, tw - 1.5 * S, 8 * S);
    ctx.fillStyle = C.holo;
    ctx.shadowColor = C.holo;
    ctx.shadowBlur = 5 * S;
    for (let i = 0; i < Math.min(g.ammo, n); i++) ctx.fillRect(x - (i + 1) * tw, y + 12 * S, tw - 1.5 * S, 8 * S);
    ctx.restore();
    // Grenades
    for (let i = 0; i < h.maxGrenades; i++) {
      const on = i < h.grenades;
      ctx.save();
      ctx.fillStyle = on ? C.holo : C.holoFaint;
      if (on) {
        ctx.shadowColor = C.holo;
        ctx.shadowBlur = 5 * S;
      }
      ctx.beginPath();
      ctx.ellipse(W - 340 * S + i * 18 * S, y - 56 * S, 5 * S, 6.5 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    text(inputDevice === 'gamepad' ? 'LB' : 'G', W - 340 * S + h.maxGrenades * 18 * S + 4 * S, y - 51 * S, { size: 12, color: C.dim, face: BODY, weight: 700 });
    if (h.reloadT > 0) text('RELOADING', x, y - 30 * S, { size: 13, weight: 700, color: C.hatch, glow: C.hatch, align: 'right', spacing: 3 });
    else if (empty && g.reserve === 0) text('NO AMMO', x, y - 30 * S, { size: 13, weight: 700, color: C.red, align: 'right', spacing: 3 });
  }

  function prompt(game) {
    const label = game.prompt;
    if (!label) return;
    const [keyPart, rest] = label.includes(':') ? label.split(':') : ['', label];
    const hold = keyPart.startsWith('HOLD');
    const pad = inputDevice === 'gamepad';
    const key = pad ? 'A' : 'E';
    const words = (rest || '').trim();
    const y = H * 0.68;
    const tw = measure(words, 22, 700, HEAD, 2);
    const kw = 34 * S;
    const total = kw + 12 * S + tw + (hold ? 70 * S : 0);
    let x = W / 2 - total / 2;
    panel(x - 24 * S, y - 22 * S, total + 48 * S, 44 * S, { cut: 8 });
    // Hold progress around the key
    const h = game.hatch;
    let k = 0;
    if (h.using?.kind === 'revive') k = (h.using.target.reviving || 0) / HEALTH.reviveTime;
    if (h.using?.kind === 'objective') k = (h.using.target.progress || 0) / 120;
    const kx = x + kw / 2;
    ctx.save();
    ctx.strokeStyle = C.holoDim;
    ctx.lineWidth = 2 * S;
    ctx.beginPath();
    ctx.arc(kx, y, 15 * S, 0, Math.PI * 2);
    ctx.stroke();
    if (k > 0) {
      ctx.strokeStyle = C.holo;
      ctx.shadowColor = C.holo;
      ctx.shadowBlur = 10 * S;
      ctx.lineWidth = 3 * S;
      ctx.beginPath();
      ctx.arc(kx, y, 15 * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp01(k));
      ctx.stroke();
    }
    ctx.restore();
    text(key, kx, y + 1 * S, { size: 18, weight: 800, align: 'center', base: 'middle', face: BODY, color: C.holo, glow: C.holo });
    x += kw + 12 * S;
    if (hold) {
      text('HOLD', x, y + 7 * S, { size: 16, weight: 700, color: C.holoDim, spacing: 2, shadow: false });
      x += 58 * S;
    }
    text(words, x, y + 8 * S, { size: 22, weight: 700, spacing: 2 });
  }

  function subtitles(dt) {
    let y = H - 110 * S;
    for (let i = subs.length - 1; i >= 0; i--) {
      const s = subs[i];
      s.t += dt;
      const a = Math.min(1, s.t * 5) * clamp01((s.life - s.t) * 3);
      if (a <= 0) continue;
      const line = `${s.who}:  ${s.text}`;
      const w = measure(line, 21, 600, BODY);
      ctx.save();
      ctx.globalAlpha = a * 0.7;
      ctx.fillStyle = 'rgba(2,12,16,0.85)';
      ctx.fillRect(W / 2 - w / 2 - 14 * S, y - 22 * S, w + 28 * S, 32 * S);
      ctx.restore();
      const nw = measure(`${s.who}:  `, 21, 700, BODY);
      text(`${s.who}:`, W / 2 - w / 2, y, { size: 21, weight: 700, face: BODY, color: s.color, alpha: a });
      text(s.text, W / 2 - w / 2 + nw, y, { size: 21, weight: 600, face: BODY, color: C.white, alpha: a });
      y -= 38 * S;
    }
    for (let i = subs.length - 1; i >= 0; i--) if (subs[i].t > subs[i].life) subs.splice(i, 1);
  }

  /** The cinematic area title: mission name small, area name large, letters spreading. */
  function banner(game) {
    const b = game.banner;
    if (!b || b.t <= 0) return;
    const age = 180 - b.t;
    const a = Math.min(1, age / 20) * Math.min(1, b.t / 30);
    const spread = 6 + Math.min(1, age / 180) * 6;
    const y = H * 0.36;
    text(b.sub, W / 2, y - 44 * S, { size: 18, weight: 700, align: 'center', color: C.holo, glow: C.holo, spacing: 10, alpha: a });
    text(b.text, W / 2, y + 10 * S, { size: 58, weight: 800, align: 'center', spacing: spread, alpha: a, glow: 'rgba(84,232,242,0.5)' });
    const lw = (220 + Math.min(1, age / 40) * 180) * S;
    ctx.save();
    ctx.globalAlpha = a;
    hairline(W / 2 - lw, y + 28 * S, lw * 2, C.holo, 1.5);
    ctx.restore();
  }

  /** Mission title over the opening fly-in, typed out line by line. */
  function introCard({ k, mission, index }) {
    const a = Math.min(1, k * 5) * Math.min(1, (1 - k) * 5);
    if (a <= 0) return;
    const x = 80 * S;
    const y = H * 0.72;
    const typed = (str, start) => str.slice(0, Math.max(0, Math.floor((k - start) * 60)));
    text(`CONTRACT 0${index + 1}`, x, y - 70 * S, { size: 16, weight: 700, color: C.holo, glow: C.holo, spacing: 8, alpha: a });
    text(mission.name, x, y, { size: 72, weight: 800, spacing: 6, alpha: a });
    text(typed(mission.place.toUpperCase(), 0.15), x, y + 36 * S, { size: 20, weight: 700, face: BODY, color: C.dim, spacing: 4, alpha: a });
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = C.holo;
    ctx.shadowColor = C.holo;
    ctx.shadowBlur = 8 * S;
    ctx.fillRect(x, y + 50 * S, 120 * S * Math.min(1, k * 3), 3 * S);
    ctx.restore();
  }

  function downed(game) {
    const h = game.hatch;
    if (!h.downed || h.gone) return;
    const pulse = 0.7 + Math.sin(performance.now() / 300) * 0.3;
    text("YOU'RE DOWN", W / 2, H * 0.3, { size: 44, weight: 800, align: 'center', color: C.red, glow: C.red, spacing: 10, alpha: pulse });
    const c = game.cruz;
    const line = c.downed ? 'CRUZ IS DOWN TOO' : h.reviving ? 'CRUZ IS PATCHING YOU UP' : 'CRUZ IS ON HIS WAY · KEEP SHOOTING';
    text(line, W / 2, H * 0.3 + 34 * S, { size: 18, weight: 700, align: 'center', color: C.white, spacing: 3 });
    bar(W / 2 - 160 * S, H * 0.3 + 50 * S, 320 * S, 5 * S, h.bleed / HEALTH.bleedOut, C.red, { back: 'rgba(255,74,60,0.14)' });
    if (h.reviving) bar(W / 2 - 160 * S, H * 0.3 + 60 * S, 320 * S, 5 * S, h.reviving / HEALTH.reviveTime, C.green);
  }

  function modeBadges(game) {
    if (game.mode === 'backToBack') {
      const k = 1 - game.modeT / 1200;
      text('SURROUNDED', W / 2, H * 0.2, { size: 30, weight: 800, align: 'center', color: C.hatch, glow: C.hatch, spacing: 10 });
      text('UNLIMITED AMMO · TIME SLOWED', W / 2, H * 0.2 + 26 * S, { size: 14, weight: 700, align: 'center', color: C.dim, spacing: 3 });
      bar(W / 2 - 150 * S, H * 0.2 + 38 * S, 300 * S, 4 * S, k, C.hatch);
    }
  }

  return {
    resize,
    onEvent,
    say,
    setDevice(d) {
      inputDevice = d;
    },
    /** Hurt feedback: 0..1 for the post shader (and the fallback overlay). */
    hurt(game, dt) {
      const h = game.hatch;
      if (lastHp !== null && h.hp < lastHp - 0.5) hurtPulse = Math.min(1, hurtPulse + (lastHp - h.hp) / 30);
      lastHp = h.hp;
      hurtPulse = Math.max(0, hurtPulse - dt * 1.5);
      const low = h.downed ? 0.9 : Math.max(0, 1 - h.hp / h.maxHp - 0.35) * 1.4;
      return Math.min(1, low + hurtPulse * 0.6);
    },
    clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    reset() {
      feed.length = 0;
      subs.length = 0;
      hits.length = 0;
      notices.length = 0;
      shownEarned = 0;
      lastHp = null;
      lastHitFrame = -1;
    },
    /** One frame of the HUD. */
    draw(game, view, { dt, progress, cinematic = false, intro = null }) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const n of notices) n.t += dt;
      if (cinematic) {
        if (intro) introCard(intro);
        else banner(game);
        subtitles(dt);
        return;
      }
      if (game.mode === 'complete' || game.mode === 'failed') {
        subtitles(dt);
        return;
      }
      damageArcs(game, view, dt);
      worldMarkers(game, view);
      popups(game, view);
      if (game.mode !== 'snipe') {
        compass(game, view);
        minimap(game, view);
        heat(game);
        bossBar(game);
        objectives(game, progress, dt);
        status(game);
        weaponPanel(game);
      }
      feedPanel(dt);
      crosshair(game, view, dt);
      prompt(game);
      banner(game);
      downed(game);
      modeBadges(game);
      subtitles(dt);
    },
  };
}
