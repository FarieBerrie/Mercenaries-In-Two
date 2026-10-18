// Downloads every source asset listed in manifest.mjs into .asset-cache/ (skipping what's
// already there). usage: node tools/assets/fetch.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMATIONS, AVATARS, PROP_TEXTURES_ONLY, PROPS, ROCKETBOX, SKIES, TEXTURES } from './manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = join(ROOT, '.asset-cache');

async function get(url, file, { json = false } = {}) {
  if (existsSync(file)) return json ? JSON.parse(readFileSync(file, 'utf8')) : null;
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return json ? JSON.parse(buf.toString('utf8')) : null;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/** Runs jobs a few at a time. */
async function pool(jobs, n = 8) {
  let i = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < jobs.length) {
        const job = jobs[i++];
        await job();
        done++;
        if (done % 20 === 0) console.log(`  ${done}/${jobs.length}`);
      }
    }),
  );
}

const ph = (id) => get(`https://api.polyhaven.com/files/${id}`, join(CACHE, 'polyhaven', 'meta', `${id}.json`), { json: true });
const pickRes = (byRes, size) => byRes[`${Math.max(1, Math.round(size / 1024))}k`] || byRes['1k'];

export async function fetchAll() {
  const jobs = [];

  // Rocketbox: the repository tree tells us each avatar's texture files
  const tree = await get('https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1', join(CACHE, 'rocketbox', 'tree.json'), { json: true });
  for (const [name, a] of Object.entries(AVATARS)) {
    jobs.push(() => get(`${ROCKETBOX}/${a.src}/Export/${name}.fbx`, join(CACHE, 'rocketbox', name, `${name}.fbx`)));
    for (const t of tree.tree) {
      if (t.type === 'blob' && t.path.startsWith(`Assets/${a.src}/Textures/`)) {
        const file = t.path.split('/').pop();
        jobs.push(() => get(`${ROCKETBOX}/${a.src}/Textures/${file}`, join(CACHE, 'rocketbox', name, 'Textures', file)));
      }
    }
  }
  for (const [key, path] of Object.entries(ANIMATIONS)) jobs.push(() => get(`${ROCKETBOX}/Animations/${path}.max.fbx`, join(CACHE, 'rocketbox', 'anims', `${key}.fbx`)));

  // Poly Haven
  for (const [id, sizes] of Object.entries(TEXTURES)) {
    const meta = await ph(id);
    const [d, n, a] = sizes;
    jobs.push(() => get(pickRes(meta.Diffuse, d).jpg.url, join(CACHE, 'polyhaven', 'textures', id, 'diff.jpg')));
    jobs.push(() => get(pickRes(meta.nor_gl, n).jpg.url, join(CACHE, 'polyhaven', 'textures', id, 'nor.jpg')));
    jobs.push(() => get(pickRes(meta.arm, a).jpg.url, join(CACHE, 'polyhaven', 'textures', id, 'arm.jpg')));
  }
  for (const id of Object.values(SKIES)) {
    const meta = await ph(id);
    jobs.push(() => get(meta.hdri['1k'].hdr.url, join(CACHE, 'polyhaven', 'skies', id, 'env.hdr')));
    jobs.push(() => get(meta.tonemapped.url, join(CACHE, 'polyhaven', 'skies', id, 'sky.jpg')));
  }
  for (const id of [...Object.keys(PROPS), ...PROP_TEXTURES_ONLY]) {
    const meta = await ph(id);
    const g = meta.gltf['1k'].gltf;
    const dir = join(CACHE, 'polyhaven', 'props', id);
    const texOnly = PROP_TEXTURES_ONLY.includes(id);
    if (!texOnly) jobs.push(() => get(g.url, join(dir, `${id}.gltf`)));
    for (const [rel, f] of Object.entries(g.include)) {
      if (texOnly && rel.endsWith('.bin')) continue;
      jobs.push(() => get(f.url, join(dir, rel)));
    }
    // Leaf and needle cards keep their cut-out shape in a separate mask
    for (const [key, byRes] of Object.entries(meta)) {
      if (key.endsWith('_alpha') && byRes['1k']?.jpg) jobs.push(() => get(byRes['1k'].jpg.url, join(dir, 'textures', `${id}_${key}_1k.jpg`)));
    }
  }

  console.log(`fetching ${jobs.length} files into ${CACHE}`);
  await pool(jobs);
  console.log('sources ready');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await fetchAll();
