// Procedural textures, painted on small canvases at load time. No image files.
import * as THREE from 'three';
import { createRng } from './rng.js';

let anisotropy = 1;
export function useAnisotropy(n) {
  anisotropy = n;
}

function texture(size, draw, { repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

function speckle(ctx, size, rng, colors, count, max = 3) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const s = rng.range(1, max);
    ctx.fillRect(rng.range(0, size), rng.range(0, size), s, s);
  }
}

/** Ground for each theme, tiled every 8 m. */
export function groundTexture(theme) {
  const rng = createRng(theme.length * 7);
  return texture(256, (ctx, s) => {
    if (theme === 'desert') {
      ctx.fillStyle = '#c8a878';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rng, ['#b89464', '#d8b88a', '#a88458', '#e0c498'], 2400);
      ctx.strokeStyle = 'rgba(120,90,50,0.25)';
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        let x = rng.range(0, s);
        ctx.moveTo(x, 0);
        for (let y = 0; y < s; y += 16) ctx.lineTo((x += rng.range(-6, 6)), y);
        ctx.stroke();
      }
    } else if (theme === 'port') {
      ctx.fillStyle = '#4a4c50';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rng, ['#3a3c40', '#5a5c60', '#44464a'], 2600, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i <= s; i += 64) {
        ctx.fillRect(i, 0, 2, s);
        ctx.fillRect(0, i, s, 2);
      }
      ctx.fillStyle = 'rgba(232,192,64,0.6)';
      ctx.fillRect(0, s / 2 - 3, s, 6);
      // Puddles catch the light
      ctx.fillStyle = 'rgba(140,160,190,0.18)';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(rng.range(0, s), rng.range(0, s), rng.range(10, 30), rng.range(6, 14), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#e8eef4';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rng, ['#d4dce6', '#f6f9fc', '#c8d2de'], 1800, 4);
      ctx.fillStyle = 'rgba(150,160,175,0.25)';
      for (let i = 0; i < 10; i++) ctx.fillRect(rng.range(0, s), rng.range(0, s), rng.range(20, 60), 2);
    }
  });
}

/** Walls of the big buildings: adobe, corrugated containers or bunker concrete. */
export function wallTexture(style) {
  const rng = createRng(style.length * 13);
  return texture(128, (ctx, s) => {
    if (style === 'house') {
      ctx.fillStyle = '#c89c6c';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rng, ['#b88c5c', '#d8ac7c', '#a87c4c'], 900);
      ctx.fillStyle = 'rgba(80,50,20,0.18)';
      ctx.fillRect(0, s - 10, s, 10);
    } else if (style === 'container') {
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += 8) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x, 0, 2, s);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.fillRect(x + 4, 0, 2, s);
      }
      speckle(ctx, s, rng, ['rgba(110,60,30,0.4)'], 120, 4); // rust
    } else if (style === 'bunker') {
      ctx.fillStyle = '#8a8c88';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rng, ['#7a7c78', '#9a9c98', '#6a6c68'], 1400);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < s; y += 32) ctx.fillRect(0, y, s, 2);
    } else if (style === 'gate') {
      ctx.fillStyle = '#5a5e64';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#c8a020';
      for (let i = -s; i < s * 2; i += 24) {
        ctx.beginPath();
        ctx.moveTo(i, s);
        ctx.lineTo(i + 12, s);
        ctx.lineTo(i + 12 + s * 0.3, s * 0.7);
        ctx.lineTo(i + s * 0.3, s * 0.7);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let x = 0; x < s; x += 16) ctx.fillRect(x, 0, 2, s * 0.7);
    } else {
      ctx.fillStyle = '#9a8a74';
      ctx.fillRect(0, 0, s, s);
      speckle(ctx, s, rng, ['#8a7a64', '#aa9a84'], 1000);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? 0 : 16; x < s; x += 32) ctx.fillRect(x, y, 31, 1);
    }
  });
}

/** Wooden crate boards. */
export function crateTexture() {
  const rng = createRng(5);
  return texture(64, (ctx, s) => {
    ctx.fillStyle = '#9a6a34';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 11) {
      ctx.fillStyle = rng.pick(['#8a5a28', '#a87840', '#946430']);
      ctx.fillRect(2, y + 1, s - 4, 9);
    }
    ctx.strokeStyle = '#5a3a18';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, s - 4, s - 4);
    ctx.beginPath();
    ctx.moveTo(4, 4);
    ctx.lineTo(s - 4, s - 4);
    ctx.stroke();
  });
}

export function sandbagTexture() {
  const rng = createRng(6);
  return texture(64, (ctx, s) => {
    ctx.fillStyle = '#a89870';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 16) {
      for (let x = (y / 16) % 2 ? -12 : 0; x < s; x += 24) {
        ctx.fillStyle = rng.pick(['#b8a880', '#988860', '#a89870']);
        ctx.beginPath();
        ctx.ellipse(x + 12, y + 8, 11, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

export function rockTexture() {
  const rng = createRng(7);
  return texture(64, (ctx, s) => {
    ctx.fillStyle = '#6a6e74';
    ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, rng, ['#5a5e64', '#7a7e84', '#8a8e94'], 600, 5);
    ctx.fillStyle = 'rgba(240,246,250,0.7)';
    ctx.fillRect(0, 0, s, 10);
  });
}

/** Soft round blob, for shadows under characters and glows. */
export function blobTexture() {
  return texture(
    32,
    (ctx) => {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
    },
    { repeat: false },
  );
}
