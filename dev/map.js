// Map plan: a mission's level drawn from above, for checking layouts. ?m=0|1|2&nav=1&path=x,z,x,z
import { buildLevel } from '../src/level.js';
import { findPath } from '../src/nav.js';

const q = new URLSearchParams(location.search);
const level = buildLevel(Number(q.get('m') || 0));
const { x0, x1, z0, z1 } = level.bounds;
const S = Number(q.get('s') || 3.4); // pixels per metre
const c = document.getElementById('c');
c.width = (x1 - x0) * S;
c.height = (z1 - z0) * S;
const g = c.getContext('2d');
const X = (x) => (x - x0) * S;
const Z = (z) => (z - z0) * S;
g.fillStyle = '#2a2620';
g.fillRect(0, 0, c.width, c.height);

if (q.get('nav')) {
  const nav = level.nav;
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let py = 0; py < c.height; py++) {
    for (let px = 0; px < c.width; px++) {
      const cx = Math.floor((px / S + x0 - nav.x0) / 0.5);
      const cz = Math.floor((py / S + z0 - nav.z0) / 0.5);
      if (nav.blocked[cz * nav.nx + cx]) {
        const i = (py * c.width + px) * 4;
        img.data[i] = 90;
        img.data[i + 1] = 30;
        img.data[i + 2] = 30;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

const roadColors = { road: '#6a5a44', street: '#5a5650', plaza: '#6e6a60', yard: '#4e4c48', quay: '#4a4c50' };
for (const r of level.roads) {
  g.fillStyle = roadColors[r.kind] || '#555';
  g.globalAlpha = 0.8;
  g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * S, (r.z1 - r.z0) * S);
}
g.globalAlpha = 1;
for (const y of level.yards) {
  g.strokeStyle = y.open ? '#9a8a5a' : '#4a4030';
  g.strokeRect(X(y.x0), Z(y.z0), (y.x1 - y.x0) * S, (y.z1 - y.z0) * S);
}
const colors = { block: '#c8b89a', wall: '#e8e0d0', gate: '#ff5040', boostwall: '#40c0ff', cover: '#8a9a5a', rock: '#7a6a5a', tree: '#3a8a3a', tower: '#d0a040', target: '#ff9020', pillar: '#aaa' };
for (const b of level.boxes) {
  g.fillStyle = colors[b.kind] || '#f0f';
  if (b.kind === 'block' && b.style === 'container') g.fillStyle = '#a05040';
  g.fillRect(X(b.x0), Z(b.z0), Math.max(1, (b.x1 - b.x0) * S), Math.max(1, (b.z1 - b.z0) * S));
}
for (const a of level.areas) {
  g.strokeStyle = '#40e0f0';
  g.lineWidth = 2;
  g.strokeRect(X(a.x0), Z(a.z0), (a.x1 - a.x0) * S, (a.z1 - a.z0) * S);
  g.setLineDash([4, 4]);
  g.strokeRect(X(a.x0 - a.triggerPad), Z(a.z0 - a.triggerPad), (a.x1 - a.x0 + 2 * a.triggerPad) * S, (a.z1 - a.z0 + 2 * a.triggerPad) * S);
  g.setLineDash([]);
  g.fillStyle = '#40e0f0';
  g.font = 'bold 16px monospace';
  g.fillText(`${a.index} ${a.name}`, X(a.x0) + 4, Z(a.z0) + 18);
  for (const s of a.spawns) g.fillRect(X(s.x) - 2, Z(s.z) - 2, 4, 4);
  g.fillStyle = '#60ff80';
  g.beginPath();
  g.arc(X(a.start.x), Z(a.start.z), 6, 0, 7);
  g.fill();
  for (const o of a.objectives) {
    g.fillStyle = '#ffd040';
    g.fillRect(X(o.x) - 4, Z(o.z) - 4, 8, 8);
  }
  if (a.extract) {
    g.strokeStyle = '#60ff80';
    g.beginPath();
    g.arc(X(a.extract.x), Z(a.extract.z), 4.2 * S, 0, 7);
    g.stroke();
  }
  if (a.boost) {
    g.fillStyle = '#40c0ff';
    g.fillRect(X(a.boost.x) - 4, Z(a.boost.z) - 4, 8, 8);
  }
  if (a.nest) {
    g.fillStyle = '#ff60ff';
    g.fillRect(X(a.nest.x) - 4, Z(a.nest.z) - 4, 8, 8);
  }
}
g.strokeStyle = '#ff60a0';
g.lineWidth = 2;
for (const p of level.patrols) {
  g.beginPath();
  p.route.forEach((pt, i) => (i ? g.lineTo(X(pt.x), Z(pt.z)) : g.moveTo(X(pt.x), Z(pt.z))));
  g.closePath();
  g.stroke();
}
g.fillStyle = '#ffffff';
g.beginPath();
g.arc(X(level.start.x), Z(level.start.z), 7, 0, 7);
g.fill();
// A path between two points, to check the routes the AI will take
const pq = q.get('path')?.split(',').map(Number);
if (pq) {
  const t = performance.now();
  const path = findPath(level, { x: pq[0], z: pq[1] }, { x: pq[2], z: pq[3] });
  console.log('path', path?.length, `${(performance.now() - t).toFixed(1)}ms`);
  g.strokeStyle = '#ffff00';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(X(pq[0]), Z(pq[1]));
  for (const p of path || []) g.lineTo(X(p.x), Z(p.z));
  g.stroke();
}
const kinds = {};
for (const b of level.boxes) kinds[`${b.kind}/${b.style}`] = (kinds[`${b.kind}/${b.style}`] || 0) + 1;
console.log(JSON.stringify(kinds));
window.ready = true;
