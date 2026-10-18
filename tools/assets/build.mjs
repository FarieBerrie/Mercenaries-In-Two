// Builds public/assets/ from the downloaded sources. The conversion itself (FBX and TGA decoding,
// mesh simplification, texture resizing, glTF export) runs in headless Chrome, which has the
// loaders, a canvas and WebGPU; this script serves the files, collects what the page writes back
// and reports progress.
// usage: node tools/assets/build.mjs [task ...]   tasks: avatars anims textures skies props (default: all)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAll } from './fetch.mjs';
import * as MANIFEST from './manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'assets');
const CACHE = join(ROOT, '.asset-cache');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const MOUNTS = {
  '/cache/': CACHE,
  '/three/': join(ROOT, 'node_modules', 'three'),
  '/meshopt/': join(ROOT, 'node_modules', 'meshoptimizer'),
  '/tools/': join(ROOT, 'tools', 'assets'),
  '/out/': OUT,
};

const tasks = process.argv.slice(2);
await fetchAll();
mkdirSync(OUT, { recursive: true });

let written = 0;
let finished = null;
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/manifest.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ...MANIFEST, tasks }));
  }
  if (url === '/log' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      console.log(body);
      res.end();
    });
    return;
  }
  if (url === '/done' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.end();
      finished?.(body);
    });
    return;
  }
  const mount = Object.keys(MOUNTS).find((m) => url.startsWith(m));
  if (!mount) {
    res.writeHead(404);
    return res.end();
  }
  const file = join(MOUNTS[mount], normalize(url.slice(mount.length)));
  if (req.method === 'PUT' && mount === '/out/') {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.concat(chunks));
      written++;
      res.end();
    });
    return;
  }
  try {
    statSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = join(CACHE, 'chrome-profile');
const proc = spawn(chrome, ['--headless=new', '--enable-gpu', '--enable-unsafe-webgpu', '--use-angle=d3d11', '--no-first-run', `--user-data-dir=${profile}`, '--js-flags=--max-old-space-size=8192', `http://127.0.0.1:${port}/tools/convert.html`], { stdio: 'ignore' });

const result = await new Promise((r) => {
  finished = r;
  setTimeout(() => r('timeout'), 30 * 60 * 1000);
});
proc.kill();
server.close();
console.log(`${result} — wrote ${written} files to ${OUT}`);
process.exit(result === 'ok' ? 0 : 1);
