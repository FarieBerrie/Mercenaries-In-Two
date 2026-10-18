// The look of a Mexican town and a shanty dockside, built onto the level's boxes: painted
// plaster fronts with a darker band at the foot, arcades, deep windows with wooden shutters and
// iron grilles, balconies, hand-painted shop signs, clay-tile eaves on timber beams, rooftop
// water tanks, rebar and washing lines; power and phone wires strung across the street; palms;
// litter and stains over the ground; burning barrels; smoke columns rising beyond the walls.
// Everything stays within a hand's breadth of the walls below head height, so it never gets in
// the way of the fight.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, mx_noise_float, positionWorld, texture, uv, vertexColor } from 'three/tsl';
import { createRng } from '../rng.js';

/** Plaster colours: [material key, tint]. Tints near white keep the scanned colour. */
export const PLASTER = [
  ['plaster_white', '#f4ede2'],
  ['plaster_white', '#f6e0c8'],
  ['plaster_red', '#ffffff'],
  ['plaster_red', '#ffd2b8'],
  ['plaster_blue', '#ffffff'],
  ['plaster_blue', '#d8f0e0'],
  ['plaster_yellow', '#ffffff'],
  ['plaster_yellow', '#ffe0c0'],
  ['plaster_damaged', '#ffffff'],
  ['plaster_damaged', '#f0e0d0'],
];
/** The darker band painted along the foot of a wall. */
const BANDS = ['#7a2c1e', '#5a3a2a', '#2c4a5a', '#3a5a3a', '#8a5a2a', '#6a6460'];
const SHUTTERS = ['#3a6a7a', '#6a8a4a', '#8a3a2a', '#c8a050', '#5a4a3a', '#2a4a6a', '#a87a50'];
const LAUNDRY = ['#d8d0c0', '#8a2a2a', '#2a4a8a', '#e0c040', '#3a7a4a', '#f0f0ea', '#c86a30'];

// ------------------------------------------------------------------ painted textures

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function canvasTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Hand-painted shop signs, one per cell of a 2 × 4 atlas. Original words, no brands. */
const SIGNS = [
  ['ABARROTES', 'LA ESPERANZA', '#e8d8a0', '#8a2a1a'],
  ['REFRESCOS', 'Y BOTANAS', '#c83a2a', '#f4ead0'],
  ['TALLER', 'MECANICO', '#2a4a7a', '#f0e8d0'],
  ['FARMACIA', 'SAN JUDAS', '#3a7a4a', '#f4f0e0'],
  ['TORTILLERIA', 'DOÑA LUPE', '#f0c040', '#5a2a1a'],
  ['LLANTERA', '24 HORAS', '#1a1a1a', '#f0d040'],
  ['CERVEZA', 'FRIA', '#e8e0d0', '#2a5a8a'],
  ['MISCELANEA', 'EL GUERO', '#a83a6a', '#f8f0e0'],
];

let signTex = null;
function signAtlas() {
  if (signTex) return signTex;
  const CW = 512;
  const CH = 160;
  const [c, ctx] = canvas(CW * 2, CH * 4);
  const rng = createRng(77);
  SIGNS.forEach(([a, b, bg, fg], i) => {
    const x = (i % 2) * CW;
    const y = Math.floor(i / 2) * CH;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, CW, CH);
    // A painted border, then the lettering, slightly uneven like brushwork
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 10, y + 10, CW - 20, CH - 20);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = "800 64px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.save();
    ctx.translate(x + CW / 2, y + CH * 0.4);
    ctx.rotate((rng.next() - 0.5) * 0.03);
    ctx.fillText(a, 0, 0);
    ctx.restore();
    ctx.font = "700 34px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    ctx.fillText(b, x + CW / 2, y + CH * 0.76);
    // Sun-bleached and peeling
    for (let k = 0; k < 90; k++) {
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(255,250,235,0.25)' : 'rgba(40,30,20,0.18)';
      ctx.beginPath();
      ctx.ellipse(x + rng.next() * CW, y + rng.next() * CH, 2 + rng.next() * 16, 1 + rng.next() * 6, rng.next() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const g = ctx.createLinearGradient(0, y, 0, y + CH);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(40,24,10,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, CW, CH);
  });
  signTex = canvasTexture(c);
  return signTex;
}

/** Litter and stains for the ground: a 4 × 4 atlas with transparent backgrounds. */
let litterTex = null;
function litterAtlas() {
  if (litterTex) return litterTex;
  const S = 128;
  const [c, ctx] = canvas(S * 4, S * 4);
  const rng = createRng(31);
  const cell = (i, draw) => {
    ctx.save();
    ctx.translate((i % 4) * S + S / 2, Math.floor(i / 4) * S + S / 2);
    draw();
    ctx.restore();
  };
  const blob = (r, n, jitter) => {
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (1 - jitter / 2 + rng.next() * jitter);
      k ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  };
  // 0: crumpled paper
  cell(0, () => {
    ctx.fillStyle = '#e8e2d4';
    blob(34, 14, 0.6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(80,70,60,0.5)';
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo((rng.next() - 0.5) * 50, (rng.next() - 0.5) * 50);
      ctx.lineTo((rng.next() - 0.5) * 50, (rng.next() - 0.5) * 50);
      ctx.stroke();
    }
  });
  // 1: newspaper
  cell(1, () => {
    ctx.rotate(0.3);
    ctx.fillStyle = '#cfc8b8';
    ctx.fillRect(-46, -34, 92, 68);
    ctx.fillStyle = 'rgba(40,40,40,0.55)';
    for (let y = -26; y < 28; y += 6) ctx.fillRect(-40, y, 38 + rng.next() * 40, 2);
    ctx.fillRect(-40, -30, 70, 8);
  });
  // 2: flattened cardboard
  cell(2, () => {
    ctx.rotate(-0.4);
    ctx.fillStyle = '#9a7448';
    ctx.fillRect(-50, -36, 100, 72);
    ctx.strokeStyle = 'rgba(60,40,20,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-50, 0);
    ctx.lineTo(50, 0);
    ctx.stroke();
  });
  // 3, 4: plastic bags, white and blue
  for (const [i, col] of [[3, 'rgba(240,240,236,0.85)'], [4, 'rgba(60,110,200,0.8)']]) {
    cell(i, () => {
      ctx.fillStyle = col;
      blob(40, 18, 0.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        ctx.arc((rng.next() - 0.5) * 30, (rng.next() - 0.5) * 30, 6 + rng.next() * 10, 0, 2);
        ctx.stroke();
      }
    });
  }
  // 5, 6: cans, red and silver
  for (const [i, col] of [[5, '#b82a22'], [6, '#a8acb0']]) {
    cell(i, () => {
      ctx.rotate(rng.next() * 3);
      ctx.fillStyle = col;
      ctx.fillRect(-12, -22, 24, 44);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-6, -22, 4, 44);
      ctx.fillStyle = '#c8c8c8';
      ctx.fillRect(-12, -24, 24, 4);
    });
  }
  // 7, 8: bottles, green and brown
  for (const [i, col] of [[7, 'rgba(40,110,50,0.9)'], [8, 'rgba(110,60,20,0.9)']]) {
    cell(i, () => {
      ctx.rotate(rng.next() * 3);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(-11, -30, 22, 44, 6);
      ctx.fill();
      ctx.fillRect(-5, 12, 10, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(-6, -26, 3, 36);
    });
  }
  // 9: oil stain, 10: burnt patch
  cell(9, () => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60);
    g.addColorStop(0, 'rgba(10,8,6,0.85)');
    g.addColorStop(0.6, 'rgba(20,16,12,0.5)');
    g.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = g;
    blob(60, 20, 0.4);
    ctx.fill();
  });
  cell(10, () => {
    for (let k = 0; k < 12; k++) {
      const g = ctx.createRadialGradient((rng.next() - 0.5) * 50, (rng.next() - 0.5) * 50, 0, 0, 0, 62);
      g.addColorStop(0, 'rgba(15,12,10,0.5)');
      g.addColorStop(1, 'rgba(30,26,22,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-64, -64, 128, 128);
    }
    ctx.fillStyle = 'rgba(150,140,130,0.5)';
    for (let k = 0; k < 40; k++) ctx.fillRect((rng.next() - 0.5) * 70, (rng.next() - 0.5) * 70, 2, 2);
  });
  // 11: dry leaves
  cell(11, () => {
    for (let k = 0; k < 14; k++) {
      ctx.save();
      ctx.translate((rng.next() - 0.5) * 90, (rng.next() - 0.5) * 90);
      ctx.rotate(rng.next() * 6);
      ctx.fillStyle = rng.pick(['#8a6a3a', '#6a4a2a', '#a88a4a', '#5a4a2a']);
      ctx.beginPath();
      ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
  // 12: broken brick and plaster
  cell(12, () => {
    for (let k = 0; k < 10; k++) {
      ctx.save();
      ctx.translate((rng.next() - 0.5) * 80, (rng.next() - 0.5) * 80);
      ctx.rotate(rng.next() * 6);
      ctx.fillStyle = rng.pick(['#8a4a32', '#a85a3a', '#c8bca8', '#7a6a5a']);
      blob(5 + rng.next() * 10, 6, 0.6);
      ctx.fill();
      ctx.restore();
    }
  });
  // 13: bottle caps, butts and bits
  cell(13, () => {
    for (let k = 0; k < 30; k++) {
      ctx.fillStyle = rng.pick(['#e8e0d0', '#c8a040', '#a83020', '#d0d0d0', '#3a3a3a']);
      ctx.fillRect((rng.next() - 0.5) * 100, (rng.next() - 0.5) * 100, 3 + rng.next() * 4, 2 + rng.next() * 3);
    }
  });
  // 14: wood scraps
  cell(14, () => {
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate((rng.next() - 0.5) * 50, (rng.next() - 0.5) * 50);
      ctx.rotate(rng.next() * 3);
      ctx.fillStyle = rng.pick(['#7a5a3a', '#9a7a52', '#5a4028']);
      ctx.fillRect(-40, -5, 80, 10);
      ctx.restore();
    }
  });
  // 15: dark damp stain
  cell(15, () => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 62);
    g.addColorStop(0, 'rgba(30,22,14,0.45)');
    g.addColorStop(1, 'rgba(30,22,14,0)');
    ctx.fillStyle = g;
    blob(62, 24, 0.5);
    ctx.fill();
  });
  litterTex = canvasTexture(c);
  return litterTex;
}

/** A palm frond: a midrib with leaflets sweeping toward the tip. u runs base → tip. */
let frondTex = null;
function frondTexture() {
  if (frondTex) return frondTex;
  const [c, ctx] = canvas(512, 128);
  const rng = createRng(9);
  for (let i = 0; i < 70; i++) {
    const u = 0.06 + (i / 70) * 0.92;
    const x = u * 512;
    const len = 58 * Math.sin(Math.min(1, u * 1.15) * Math.PI) ** 0.6 + 6;
    for (const s of [-1, 1]) {
      const g = 90 + rng.next() * 60;
      ctx.strokeStyle = rng.chance(0.12) ? `rgb(${g + 40},${g + 20},${g * 0.4})` : `rgb(${g * 0.55},${g},${g * 0.4})`;
      ctx.lineWidth = 2.6 + rng.next() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, 64);
      ctx.quadraticCurveTo(x + len * 0.3, 64 + s * len * 0.5, x + len * 0.75, 64 + s * len);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#8a8a50';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 64);
  ctx.lineTo(500, 64);
  ctx.stroke();
  frondTex = canvasTexture(c);
  return frondTex;
}

// ------------------------------------------------------------------ geometry helpers

/**
 * A shape built in wall space (x from 0 to the wall's length, y up, +z out of the wall) placed on
 * a face of the box spanning x0..x1. out: which way the face looks (±1 in z).
 */
function onFace(geo, x0, x1, face, out, depth = 0) {
  if (out < 0) {
    // Half a turn keeps the faces facing out (a mirror would turn them inside out)
    geo.rotateY(Math.PI);
    geo.translate(x1, 0, face - depth);
  } else geo.translate(x0, 0, face + depth);
  return geo;
}

/** A sagging wire from a to b (catenary-ish), as a thin tube. */
export function wire(a, b, sag, r = 0.012) {
  const pts = [];
  for (let k = 0; k <= 14; k++) {
    const t = k / 14;
    pts.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, r, 3, false);
}

// ------------------------------------------------------------------ the pueblo

/**
 * The front of a pueblo building on one face of a level box. ctx: { B, rng, lamps, detail, lit }.
 * look: { key, tint, band } the building's plaster.
 */
export function puebloFacade(ctx, b, face, look) {
  const { B, rng, lamps, lit } = ctx;
  ctx.look = look;
  const out = face === b.z0 ? -1 : 1;
  const L = b.x1 - b.x0;
  const h = b.y1;
  const fz = face + out * 0.01;
  const zs = (a, c) => [Math.min(fz + out * a, fz + out * c), Math.max(fz + out * a, fz + out * c)];
  // The painted band along the foot, and a cornice under the roof line
  B.box(look.key, b.x0, b.x1, 0, 1.05, ...zs(-0.01, 0.03), look.band);
  B.box(look.key, b.x0 - 0.05, b.x1 + 0.05, h - 0.32, h - 0.12, ...zs(-0.01, 0.14), look.tint);

  // Ground floor: an arcade, a row of shops, or doors and barred windows
  const kind = L > 9 && rng.chance(0.3) ? 'arcade' : rng.chance(0.5) ? 'shops' : 'doors';
  if (kind === 'arcade') arcade(ctx, b, face, out, look);
  else {
    const bays = Math.max(2, Math.floor(L / 3.4));
    const bw = L / bays;
    for (let i = 0; i < bays; i++) {
      const cx = b.x0 + bw * (i + 0.5);
      const r = rng.next();
      if (kind === 'shops' && r < 0.55) {
        // A roll-up steel shutter, half open on a dark shop, with a painted sign above
        const w = Math.min(2.8, bw - 0.6);
        const open = rng.chance(0.4) ? rng.range(0.6, 1.4) : 0;
        B.box('dark', cx - w / 2, cx + w / 2, 0, 2.6, ...zs(0, 0.01), '#1a1612');
        B.box('shutter', cx - w / 2, cx + w / 2, open, 2.6, ...zs(0.01, 0.04), rng.pick(['#c8c0b0', '#a8b0b8', '#b89880']));
        surround(B, cx, 0, w, 2.6, zs, '#6a6460', 'metal');
        B.box('metal', cx - w / 2 - 0.08, cx + w / 2 + 0.08, 2.6, 2.85, ...zs(0, 0.16), '#6a6460'); // shutter box
        sign(ctx, cx, 3.0, face, out, Math.min(3.2, bw - 0.3));
      } else if (r < 0.8) {
        // A wooden door in a deep reveal, a lintel over it
        B.box('dark', cx - 0.65, cx + 0.65, 0, 2.35, ...zs(0, 0.01), '#140f0a');
        B.box('wood', cx - 0.6, cx + 0.6, 0, 2.3, ...zs(0.01, 0.05), rng.pick(SHUTTERS));
        surround(B, cx, 0, 1.3, 2.35, zs, look.band, look.key);
      } else window(ctx, cx, 1.0, face, out, { grille: true });
    }
  }

  // Upper floors: windows, some opening onto a balcony
  for (let y = 3.6; y < h - 1.6; y += 3.2) {
    const bays = Math.max(2, Math.floor(L / 3.2));
    const bw = L / bays;
    for (let i = 0; i < bays; i++) {
      if (rng.chance(0.12)) continue;
      const cx = b.x0 + bw * (i + 0.5);
      if (rng.chance(0.3)) balcony(ctx, cx, y - 0.3, face, out);
      else window(ctx, cx, y, face, out, { grille: rng.chance(0.25), boarded: rng.chance(0.12) });
      if (lit && rng.chance(0.25)) lamps.push({ x: cx, y: y + 0.8, z: face - out * 1.2, color: 0xffb060, k: 3, d: 6, cheap: true });
    }
  }

  // Drainpipes and conduit runs, a hanging lamp over a door
  for (let x = b.x0 + rng.range(1, 3); x < b.x1 - 1; x += rng.range(5, 10)) B.cyl('metal', x, 0.05, fz + out * 0.08, h - 0.4, 0.045, '#5a5048', { sides: 8 });
  if (rng.chance(0.5)) {
    const y = rng.range(3.3, 3.6);
    B.box('metal', b.x0 + 0.5, b.x1 - 0.5, y, y + 0.04, ...zs(0.02, 0.06), '#3a3a3a');
  }
}

/** A thick surround standing proud of the wall round an opening (w wide, h high, from y). */
function surround(B, cx, y, w, h, zs, tint, key) {
  const t = 0.14;
  B.box(key, cx - w / 2 - t, cx - w / 2, y, y + h + t, ...zs(0, 0.13), tint);
  B.box(key, cx + w / 2, cx + w / 2 + t, y, y + h + t, ...zs(0, 0.13), tint);
  B.box(key, cx - w / 2 - t, cx + w / 2 + t, y + h, y + h + t, ...zs(0, 0.13), tint);
}

/** A deep window: dark interior, glass, a timber frame, sill and lintel, shutters or a grille. */
function window(ctx, cx, y, face, out, { grille = false, boarded = false } = {}) {
  const { B, rng } = ctx;
  const fz = face + out * 0.01;
  const zs = (a, c) => [Math.min(fz + out * a, fz + out * c), Math.max(fz + out * a, fz + out * c)];
  const w = 0.95;
  const hh = 1.55;
  // The opening reads as deep: a dark interior flush with the wall, glazing and a frame just in
  // front of it, and a thick surround standing proud of the plaster
  B.box('dark', cx - w / 2, cx + w / 2, y, y + hh, ...zs(0, 0.01), '#120e0a');
  B.box('glass', cx - w / 2 + 0.06, cx + w / 2 - 0.06, y + 0.06, y + hh - 0.06, ...zs(0.01, 0.02), '#262626');
  B.box('wood', cx - 0.03, cx + 0.03, y, y + hh, ...zs(0.02, 0.05), '#4a3020');
  B.box('wood', cx - w / 2, cx + w / 2, y + hh * 0.62, y + hh * 0.62 + 0.05, ...zs(0.02, 0.05), '#4a3020');
  surround(B, cx, y, w, hh, zs, ctx.look?.band ?? '#d8c8b0', 'concrete');
  B.box('concrete', cx - w / 2 - 0.16, cx + w / 2 + 0.16, y - 0.16, y - 0.02, ...zs(0, 0.24), '#d8c8b0'); // sill
  if (boarded) {
    // Boarded up with planks nailed across
    for (let k = 0; k < 4; k++) B.box('wood', cx - w / 2 - 0.05, cx + w / 2 + 0.05, y + 0.18 + k * 0.38, y + 0.36 + k * 0.38, ...zs(0.14, 0.17), '#9a7a52', { rz: (rng.next() - 0.5) * 0.25 });
    return;
  }
  if (grille) {
    // Wrought-iron bars
    for (let x = cx - w / 2 + 0.08; x < cx + w / 2; x += 0.12) B.box('metal', x - 0.012, x + 0.012, y, y + hh, ...zs(0.15, 0.175), '#1c1a18');
    for (const yy of [y + 0.25, y + hh / 2, y + hh - 0.25]) B.box('metal', cx - w / 2 - 0.02, cx + w / 2 + 0.02, yy - 0.015, yy + 0.015, ...zs(0.15, 0.18), '#1c1a18');
  } else if (rng.chance(0.75)) {
    // Wooden shutters, one or both hanging open against the wall
    const col = rng.pick(SHUTTERS);
    for (const s of rng.chance(0.6) ? [-1, 1] : [rng.chance(0.5) ? -1 : 1]) B.box('wood', cx + s * (w / 2 + 0.16), cx + s * (w + 0.16), y - 0.02, y + hh + 0.02, ...zs(0.02, 0.06), col);
  }
}

/** A balcony: a French door, a slab on brackets, an iron railing. */
function balcony(ctx, cx, y, face, out) {
  const { B, rng } = ctx;
  const fz = face + out * 0.01;
  const zs = (a, c) => [Math.min(fz + out * a, fz + out * c), Math.max(fz + out * a, fz + out * c)];
  const w = 1.6;
  B.box('dark', cx - 0.55, cx + 0.55, y + 0.15, y + 2.4, ...zs(0, 0.01), '#120e0a');
  B.box('wood', cx - 0.5, cx - 0.04, y + 0.15, y + 2.3, ...zs(0.01, 0.05), rng.pick(SHUTTERS));
  surround(B, cx, y + 0.15, 1.1, 2.25, zs, ctx.look?.band ?? '#d8c8b0', 'concrete');
  B.box('concrete', cx - w / 2, cx + w / 2, y, y + 0.14, ...zs(0, 0.62), '#c8bca8');
  for (const s of [-1, 1]) B.box('concrete', cx + s * (w / 2 - 0.15) - 0.06, cx + s * (w / 2 - 0.15) + 0.06, y - 0.3, y, ...zs(0, 0.4), '#b8ac98');
  // Railing: posts, balusters and a top rail round three sides
  const rail = '#1c1a18';
  B.box('metal', cx - w / 2, cx + w / 2, y + 0.95, y + 0.99, ...zs(0.56, 0.6), rail);
  B.box('metal', cx - w / 2, cx + w / 2, y + 0.2, y + 0.23, ...zs(0.56, 0.6), rail);
  for (let x = cx - w / 2 + 0.05; x <= cx + w / 2; x += 0.11) B.box('metal', x - 0.01, x + 0.01, y + 0.14, y + 0.97, ...zs(0.565, 0.585), rail);
  for (const s of [-1, 1]) {
    B.box('metal', cx + s * w / 2 - 0.02, cx + s * w / 2 + 0.02, y + 0.95, y + 0.99, ...zs(0.02, 0.6), rail);
    for (let d = 0.12; d < 0.58; d += 0.11) B.box('metal', cx + s * w / 2 - 0.01, cx + s * w / 2 + 0.01, y + 0.14, y + 0.97, ...zs(d, d + 0.02), rail);
  }
  // Something hung over the rail: a blanket or a flag of washing
  if (rng.chance(0.4)) B.box('sack', cx - 0.5, cx + 0.3, y + 0.35, y + 0.98, ...zs(0.6, 0.63), rng.pick(LAUNDRY));
}

/** An arcade along the ground floor: a wall of round arches standing proud of the shaded front. */
function arcade(ctx, b, face, out, look) {
  const { B } = ctx;
  const L = b.x1 - b.x0;
  const n = Math.max(2, Math.round(L / 3.4));
  const bw = L / n;
  const spring = 2.3;
  const ow = bw - 0.55;
  const top = spring + ow / 2 + 0.45;
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L, top), new THREE.Vector2(0, top)]);
  const arch = (x) => {
    const p = new THREE.Path();
    p.moveTo(x - ow / 2, 0);
    p.lineTo(x + ow / 2, 0);
    p.lineTo(x + ow / 2, spring);
    p.absarc(x, spring, ow / 2, 0, Math.PI, false);
    p.lineTo(x - ow / 2, 0);
    return p;
  };
  for (let i = 0; i < n; i++) shape.holes.push(arch(bw * (i + 0.5)));
  const panel = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: false, curveSegments: 10 });
  B.add(look.key, onFace(panel, b.x0, b.x1, face, out, 0.0), look.tint);
  // The shaded walls inside each arch, darker than the sunlit front
  for (let i = 0; i < n; i++) {
    const s = new THREE.Shape(arch(bw * (i + 0.5)).getPoints(12));
    const g = new THREE.ShapeGeometry(s);
    B.add('dark', onFace(g, b.x0, b.x1, face, out, 0.015), '#3a3028');
    // A door or a shop window inside every other arch
    const cx = b.x0 + bw * (i + 0.5);
    const fz = face + out * 0.02;
    if (i % 2 === 0) B.box('wood', cx - 0.55, cx + 0.55, 0, 2.2, Math.min(fz, fz + out * 0.03), Math.max(fz, fz + out * 0.03), ctx.rng.pick(SHUTTERS));
    else B.box('dark', cx - 0.7, cx + 0.7, 0.8, 2.0, Math.min(fz, fz + out * 0.02), Math.max(fz, fz + out * 0.02), '#0e0c0a');
  }
}

/** A painted sign board over a shop, picked from the atlas. */
function sign(ctx, cx, y, face, out, w) {
  const { B, rng } = ctx;
  const i = Math.floor(rng.next() * SIGNS.length);
  const g = new THREE.PlaneGeometry(w, w * (160 / 512));
  const u0 = (i % 2) * 0.5;
  const v0 = 1 - (Math.floor(i / 2) + 1) * 0.25;
  const uvs = g.attributes.uv;
  for (let k = 0; k < uvs.count; k++) uvs.setXY(k, u0 + uvs.getX(k) * 0.5, v0 + uvs.getY(k) * 0.25);
  if (out < 0) g.rotateY(Math.PI);
  g.translate(cx, y, face + out * 0.03);
  B.add('signs', g, '#ffffff');
}

/**
 * The back of a pueblo building, looking into a courtyard: the painted band, a few plain windows
 * and a drainpipe. Cheaper than a street front, which nobody looks at from here.
 */
export function puebloBack(ctx, b, face, look) {
  const { B, rng } = ctx;
  ctx.look = look;
  const out = face === b.z0 ? -1 : 1;
  const L = b.x1 - b.x0;
  const h = b.y1;
  const fz = face + out * 0.01;
  const zs = (a, c) => [Math.min(fz + out * a, fz + out * c), Math.max(fz + out * a, fz + out * c)];
  B.box(look.key, b.x0, b.x1, 0, 1.05, ...zs(-0.01, 0.03), look.band);
  for (let y = 1.0; y < h - 1.4; y += 3.2) {
    const bays = Math.max(1, Math.floor(L / 4.5));
    for (let i = 0; i < bays; i++) {
      if (rng.chance(0.35)) continue;
      const cx = b.x0 + (L / bays) * (i + 0.5);
      B.box('dark', cx - 0.45, cx + 0.45, y, y + 1.3, ...zs(0, 0.01), '#120e0a');
      B.box('concrete', cx - 0.6, cx + 0.6, y - 0.12, y - 0.02, ...zs(0, 0.14), '#d8c8b0');
      if (rng.chance(0.4)) for (let x = cx - 0.38; x < cx + 0.4; x += 0.13) B.box('metal', x - 0.012, x + 0.012, y, y + 1.3, ...zs(0.05, 0.07), '#1c1a18');
    }
  }
  if (rng.chance(0.6)) B.cyl('metal', b.x0 + rng.range(0.6, L - 0.6), 0.05, fz + out * 0.08, h - 0.4, 0.045, '#5a5048', { sides: 6 });
}

/** The roof line: clay-tile eaves on timber beams, or a parapet; tanks, rebar, washing lines. */
export function puebloRoof(ctx, b, look, faces, { extras = true } = {}) {
  const { B, rng, detail } = ctx;
  const h = b.y1;
  for (const face of faces) {
    const out = face === b.z0 ? -1 : 1;
    if (rng.chance(0.6)) {
      // A tiled eave sloping out from the wall over beam ends
      const depth = 0.85;
      const slab = new THREE.BoxGeometry(b.x1 - b.x0 + 0.3, 0.07, depth + 0.3);
      slab.applyMatrix4(new THREE.Matrix4().makeRotationX(out * 0.38));
      slab.translate((b.x0 + b.x1) / 2, h + 0.05, face + out * (depth / 2 - 0.1));
      B.add('roof_tiles', slab, '#ffffff');
      for (let x = b.x0 + 0.3; x < b.x1; x += 0.65) B.box('wood', x - 0.06, x + 0.06, h - 0.32, h - 0.18, Math.min(face, face + out * 0.55), Math.max(face, face + out * 0.55), '#5a3a22');
    } else {
      // A flat roof's parapet with a tile coping
      B.box(look.key, b.x0, b.x1, h - 0.02, h + 0.55, Math.min(face, face - out * 0.25), Math.max(face, face - out * 0.25), look.tint);
      B.box('roof_tiles', b.x0 - 0.05, b.x1 + 0.05, h + 0.55, h + 0.62, Math.min(face + out * 0.06, face - out * 0.3), Math.max(face + out * 0.06, face - out * 0.3), '#ffffff');
    }
  }
  if (detail < 0.6 || !extras) return;
  const cz = (b.z0 + b.z1) / 2;
  // Black plastic water tanks on stands
  if (rng.chance(0.65)) {
    const x = rng.range(b.x0 + 1, b.x1 - 1);
    B.cyl('dark', x, h + 0.3, cz, 1.25, 0.55, '#141414', { sides: 16 });
    B.cyl('dark', x, h + 1.55, cz, 0.12, 0.35, '#1a1a1a', { sides: 14 });
    B.box('metal', x - 0.6, x + 0.6, h, h + 0.3, cz - 0.6, cz + 0.6, '#5a5048');
  }
  // Rebar left sticking up for the floor that was never built
  if (rng.chance(0.5)) {
    for (const [x, z] of [[b.x0 + 0.3, b.z0 + 0.3], [b.x1 - 0.3, b.z0 + 0.3], [b.x0 + 0.3, b.z1 - 0.3], [b.x1 - 0.3, b.z1 - 0.3]]) {
      for (let k = 0; k < 4; k++) B.cyl('metal', x + (k % 2) * 0.12, h, z + Math.floor(k / 2) * 0.12, rng.range(0.7, 1.4), 0.012, '#6a3a22', { sides: 4, rx: (rng.next() - 0.5) * 0.2, rz: (rng.next() - 0.5) * 0.2 });
    }
  }
  // A washing line strung between two posts
  if (rng.chance(0.45)) {
    const x0 = rng.range(b.x0 + 0.5, (b.x0 + b.x1) / 2);
    const x1 = Math.min(b.x1 - 0.5, x0 + rng.range(3, 6));
    for (const x of [x0, x1]) B.cyl('metal', x, h, cz, 1.8, 0.03, '#4a4a4a', { sides: 5 });
    B.add('rubber', wire(new THREE.Vector3(x0, h + 1.75, cz), new THREE.Vector3(x1, h + 1.75, cz), 0.15, 0.006), '#2a2a2a');
    for (let x = x0 + 0.4; x < x1 - 0.3; x += rng.range(0.6, 1.1)) {
      const t = (x - x0) / (x1 - x0);
      const y = h + 1.75 - Math.sin(t * Math.PI) * 0.15;
      B.box('sack', x - 0.25, x + 0.25, y - rng.range(0.4, 0.8), y, cz - 0.01, cz + 0.01, rng.pick(LAUNDRY));
    }
  }
}

/**
 * Litter and stains on the ground: one merged mesh of flat decals, at the spots given. kinds:
 * atlas cells to pick from.
 */
export function buildLitter(rng, spots, { kinds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] } = {}) {
  const geos = [];
  for (const { x, z } of spots) {
    const k = rng.pick(kinds);
    const stain = k === 9 || k === 10 || k === 15;
    const s = stain ? rng.range(0.6, 1.5) : k === 11 || k === 12 || k === 13 ? rng.range(0.5, 0.9) : rng.range(0.25, 0.55);
    const g = new THREE.PlaneGeometry(s, s).rotateX(-Math.PI / 2).rotateY(rng.range(0, Math.PI * 2));
    const u0 = (k % 4) / 4;
    const v0 = 1 - (Math.floor(k / 4) + 1) / 4;
    const uvs = g.attributes.uv;
    for (let j = 0; j < uvs.count; j++) uvs.setXY(j, u0 + uvs.getX(j) * 0.25, v0 + uvs.getY(j) * 0.25);
    g.translate(x, stain ? 0.008 : 0.012 + rng.next() * 0.004, z);
    geos.push(g);
  }
  if (!geos.length) return null;
  const m = new THREE.MeshStandardNodeMaterial({ transparent: false, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, roughness: 0.85 });
  const t = texture(litterAtlas(), uv());
  m.colorNode = t.rgb;
  m.opacityNode = t.a;
  const mesh = new THREE.Mesh(mergeGeometries(geos), m);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = 'litter';
  return mesh;
}

// ------------------------------------------------------------------ palms

/** One palm as geometry: a ringed, curving trunk, a crown of fronds, a skirt of dead ones. */
function palmGeometry(seed) {
  const rng = createRng(seed);
  const H = rng.range(6.5, 9.5);
  const lean = rng.range(0.04, 0.12);
  const la = rng.range(0, Math.PI * 2);
  const at = (t) => new THREE.Vector3(Math.cos(la) * lean * H * t ** 1.6, H * t, Math.sin(la) * lean * H * t ** 1.6);
  // Trunk: rings of vertices up the curve, swelling at each leaf scar
  const rings = 40;
  const sides = 10;
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = at(t);
    const r = (0.24 - 0.07 * t) * (1 + 0.06 * Math.abs(Math.sin(t * H * 4 * Math.PI)));
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      pos.push(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
      uvs.push(j / sides, (t * H) / 1.2);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();
  // Fronds: strips arcing out and drooping, folded slightly along the midrib
  const top = at(1);
  const fronds = [];
  const frond = (az, el, len, dead) => {
    const NS = 12;
    const p = [];
    const u = [];
    const col = [];
    const ix = [];
    const h = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-h.z, 0, h.x);
    const droop = dead ? 0.1 : rng.range(0.35, 0.6);
    const tint = dead ? [0.55, 0.42, 0.28] : [rng.range(0.85, 1.05), rng.range(0.9, 1.05), rng.range(0.8, 0.95)];
    for (let i = 0; i <= NS; i++) {
      const s = i / NS;
      const d = s * len;
      const c = top.clone().addScaledVector(h, d * Math.cos(el)).add(new THREE.Vector3(0, d * Math.sin(el) - droop * d * s * len * 0.35, 0));
      const w = 0.55 * Math.sin(Math.min(1, s * 1.2) * Math.PI) ** 0.5 + 0.05;
      for (const v of [-1, 0, 1]) {
        const q = c.clone().addScaledVector(side, v * w).add(new THREE.Vector3(0, -Math.abs(v) * w * 0.25, 0));
        p.push(q.x, q.y, q.z);
        u.push(s, 0.5 + v * 0.5);
        col.push(...tint);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let j = 0; j < 2; j++) {
        const a = i * 3 + j;
        ix.push(a, a + 3, a + 1, a + 3, a + 4, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    // Lit like a canopy: normals up and out
    const n = g.attributes.normal;
    for (let k = 0; k < n.count; k++) {
      const px = p[k * 3] - top.x;
      const pz = p[k * 3 + 2] - top.z;
      const l = Math.hypot(px, pz) || 1;
      const v = new THREE.Vector3(px / l, 0.9, pz / l).normalize();
      n.setXYZ(k, v.x, v.y, v.z);
    }
    fronds.push(g);
  };
  const live = 13 + Math.floor(rng.next() * 5);
  for (let i = 0; i < live; i++) {
    const t = i / live;
    frond(i * 2.39996 + rng.range(-0.2, 0.2), 0.75 - t * 1.05 + rng.range(-0.1, 0.1), rng.range(2.8, 3.8) * (1 - t * 0.2), false);
  }
  for (let i = 0; i < 6; i++) frond(i * 1.05 + rng.range(-0.3, 0.3), -1.25 + rng.range(-0.15, 0.1), rng.range(1.6, 2.3), true);
  return { trunk, fronds: mergeGeometries(fronds) };
}

/** Palms at the given spots: [{ x, y, z, s, r }]. bark: Poly Haven palm bark surface. */
let palmParts = null;
export function buildPalms(spots, bark) {
  const group = new THREE.Group();
  if (!spots.length) return group;
  // Shapes and materials are shared by every call (palms are built a chunk at a time)
  if (!palmParts || palmParts.bark !== bark) {
    const trunkMat = new THREE.MeshStandardNodeMaterial();
    const tb = texture(bark.map, uv().mul(1));
    trunkMat.colorNode = tb.rgb.mul(0.9);
    trunkMat.normalMap = bark.normal;
    trunkMat.roughness = 0.9;
    const frondMat = new THREE.MeshStandardNodeMaterial({ alphaTest: 0.45, side: THREE.DoubleSide });
    const ft = texture(frondTexture(), uv());
    frondMat.colorNode = ft.rgb.mul(vertexColor()).mul(float(0.85).add(mx_noise_float(positionWorld.mul(0.4)).mul(0.2)));
    frondMat.opacityNode = ft.a;
    frondMat.roughness = 0.75;
    palmParts = { bark, variants: palmParts?.variants || [palmGeometry(3), palmGeometry(7), palmGeometry(13)], trunkMat, frondMat };
  }
  const { variants, trunkMat, frondMat } = palmParts;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  variants.forEach((v, vi) => {
    const list = spots.filter((_, i) => i % variants.length === vi);
    if (!list.length) return;
    const trunk = new THREE.InstancedMesh(v.trunk, trunkMat, list.length);
    const fronds = new THREE.InstancedMesh(v.fronds, frondMat, list.length);
    list.forEach((s, i) => {
      m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.r ?? 0), new THREE.Vector3(s.s, s.s, s.s));
      trunk.setMatrixAt(i, m);
      fronds.setMatrixAt(i, m);
    });
    for (const im of [trunk, fronds]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
  });
  return group;
}

/** The sign atlas as a material (keyed 'signs' in the world's batch). */
export function signMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  m.colorNode = texture(signAtlas(), uv()).rgb.mul(vertexColor());
  m.vertexColors = true;
  return m;
}

