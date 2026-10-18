// Skies and the light they cast. Each mission has a real sky (a Poly Haven HDRI): its small HDR
// version lights the scene (image-based lighting and reflections) and tells us where the sun is,
// and a 6K image of it is the backdrop. Exponential height fog with in-scattering toward the sun
// sits between the two, the way engines of the era did it.
import * as THREE from 'three/webgpu';
import { asin, atan, cameraPosition, clamp, dot, exp, float, fog, Fn, max, mix, normalize, positionView, positionWorld, positionWorldDirection, pow, smoothstep, texture, uniform, vec2, vec3 } from 'three/tsl';
import { loadHDR, loadTexture } from './assets.js';

/**
 * Per theme. sun/sunK: sun colour and intensity; env: image-based light; sky: backdrop
 * brightness; fog: { color, sunColor, density, height (falloff per metre) }; exposure for the
 * tone curve; grade and bloom for post; bounce: warm fill from sunlit walls and ground (a
 * hemisphere light) so shade isn't left to the cold sky; dust: dirt worked into the
 * characters' trousers and boots; rim: rim light on characters; weather;
 * wet ground.
 */
export const THEMES = {
  // A hot afternoon over the pueblo: hard amber sun through dust, pale sky, cool teal shade
  desert: {
    sky: 1.0, sunK: 7.0, sun: '#ffdcaa', env: 0.7, exposure: 1.0,
    fog: { color: '#bfa784', sunColor: '#ffc480', density: 0.0038, height: 0.03 },
    bloom: { strength: 0.4, radius: 0.7, threshold: 1.0 },
    grade: { shadows: [0.97, 1.0, 1.04], highlights: [1.1, 1.0, 0.84], saturation: 0.9, contrast: 1.2, lift: [0.01, 0.012, 0.014], vignette: 0.5 },
    shafts: 0.9, shaftColor: '#ffb870',
    bounce: { sky: '#ffd2a0', ground: '#b4784a', k: 0.5 },
    dust: { color: '#8c7656', k: 0.65 },
    rim: 0.3, weather: 'dust', glare: 1.2, wet: 0,
  },
  // Night on the docks: sodium orange against cool moonlight, smoke hanging in the air
  port: {
    night: true, sky: 0.06, sunK: 0.4, sun: '#a8b8e0', env: 0.35, exposure: 1.25,
    fog: { color: '#1c1610', sunColor: '#3a2a18', density: 0.02, height: 0.03 },
    bloom: { strength: 0.65, radius: 0.7, threshold: 0.5 },
    grade: { shadows: [0.92, 1.0, 1.05], highlights: [1.18, 0.98, 0.75], saturation: 0.78, contrast: 1.22, lift: [0.02, 0.016, 0.012], vignette: 0.55 },
    shafts: 0,
    dust: { color: '#26221e', k: 0.55 },
    rim: 0.12, weather: 'rain', glare: 0, wet: 1,
  },
  // A grey mountain morning, the sun warm on the snow
  snow: {
    sky: 1.0, sunK: 2.6, sun: '#fff0dc', env: 1.0, exposure: 0.82,
    fog: { color: '#b4b8bc', sunColor: '#f0dcc0', density: 0.011, height: 0.035 },
    bloom: { strength: 0.3, radius: 0.6, threshold: 1.0 },
    grade: { shadows: [0.95, 1.0, 1.05], highlights: [1.08, 1.0, 0.9], saturation: 0.68, contrast: 1.16, lift: [0.025, 0.025, 0.028], vignette: 0.48 },
    shafts: 0.5, shaftColor: '#ffe0c0',
    dust: { color: '#dfe3e8', k: 0.5 },
    rim: 0.2, weather: 'snow', glare: 0.3, wet: 0,
  },
  menu: {
    sky: 1.0, sunK: 3.8, sun: '#ffc890', env: 0.8, exposure: 0.88,
    fog: { color: '#9c7a5a', sunColor: '#ffa860', density: 0.008, height: 0.03 },
    bloom: { strength: 0.5, radius: 0.7, threshold: 0.7 },
    grade: { shadows: [1.05, 0.98, 0.9], highlights: [1.12, 1.0, 0.8], saturation: 0.72, contrast: 1.18, lift: [0.035, 0.024, 0.012], vignette: 0.55 },
    shafts: 0.9, shaftColor: '#ffa860',
    bounce: { sky: '#ffc890', ground: '#9a6640', k: 0.4 },
    dust: { color: '#8c7656', k: 0.65 },
    rim: 0.35, weather: 'dust', glare: 1.2, wet: 0,
  },
};

/** Where the sun is in an equirectangular HDR: the direction of its brightest spot, and its colour. */
function findSun(tex) {
  const { data, width: W, height: H } = tex.image;
  const ch = data.length / (W * H);
  const f = data instanceof Uint16Array ? (i) => THREE.DataUtils.fromHalfFloat(data[i]) : (i) => data[i];
  let best = -1;
  let bi = 0;
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      const l = f(i) * 0.2126 + f(i + 1) * 0.7152 + f(i + 2) * 0.0722;
      if (l > best) {
        best = l;
        bi = y * W + x;
      }
    }
  }
  const x = bi % W;
  const y = Math.floor(bi / W);
  const elev = (0.5 - (y + 0.5) / H) * Math.PI;
  const az = ((x + 0.5) / W - 0.5) * Math.PI * 2;
  const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
  const i = bi * ch;
  const col = new THREE.Color(f(i), f(i + 1), f(i + 2));
  col.multiplyScalar(1 / (Math.max(col.r, col.g, col.b) || 1));
  return { dir, color: col, peak: best };
}

/** Shared uniforms: the sky, fog and materials read these, so a new theme is just new values. */
export const SKY = {
  // Where the light comes from (kept high enough to light the streets)...
  sunDir: uniform(new THREE.Vector3(0.4, 0.6, 0.3).normalize()),
  // ...and where the sun really is in the sky (its disc, the haze glow round it, glare, shafts)
  discDir: uniform(new THREE.Vector3(0.4, 0.6, 0.3).normalize()),
  sunColor: uniform(new THREE.Color(1, 1, 1)),
  skyK: uniform(1),
  fogColor: uniform(new THREE.Color('#c9b08c')),
  fogSun: uniform(new THREE.Color('#ffe2b0')),
  fogDensity: uniform(0.004),
  fogHeight: uniform(0.04),
  time: uniform(0),
};

/** The fog's colour looking along a direction: brighter and warmer toward the sun. */
const hazeColor = (dir) => mix(vec3(SKY.fogColor), vec3(SKY.fogSun), pow(max(dot(dir, SKY.discDir), 0), 5).mul(0.9));

/** Height fog: thick low down, thinning with altitude. */
const fogAmount = Fn(() => {
  const dist = positionView.z.negate().max(0);
  const thin = exp(positionWorld.y.max(0).mul(SKY.fogHeight).negate());
  return clamp(float(1).sub(exp(dist.mul(SKY.fogDensity).mul(thin).negate())), 0, 0.97);
});

export const fogNode = fog(hazeColor(normalize(positionWorld.sub(cameraPosition))), fogAmount());

/** The backdrop: the sky image mapped by direction, a hot sun disc, and haze toward the horizon. */
function skyNode(skyTex) {
  return Fn(() => {
    const d = normalize(positionWorldDirection);
    const u = atan(d.z, d.x).mul(1 / (Math.PI * 2)).add(0.5);
    // The image runs from the zenith (top) to 10° below the horizon (bottom)
    const elev = asin(clamp(d.y, -1, 1)).mul(180 / Math.PI);
    const v = float(1).sub(clamp(float(90).sub(elev).div(100), 0.001, 0.999));
    const sky = texture(skyTex, vec2(u, v)).rgb.mul(SKY.skyK);
    const s = dot(d, SKY.discDir);
    const disc = smoothstep(0.99985, 0.99993, s).mul(60).add(pow(max(s, 0), 900).mul(4));
    const col = sky.add(vec3(SKY.sunColor).mul(disc));
    // (smoothstep edges must rise, so the falling ramps are written as 1 - rising ones)
    const haze = float(1).sub(smoothstep(-2, 14, elev)).mul(0.85).add(float(1).sub(smoothstep(-10, -2, elev)).mul(0.15));
    return mix(col, hazeColor(d), clamp(haze, 0, 1));
  })();
}

/** Loads a theme's sky and lights the scene with it; aims and colours the sun and bounce lights. */
export async function applySky(scene, sun, themeName, bounce = null) {
  const theme = THEMES[themeName];
  const [env, skyTex] = await Promise.all([loadHDR(`sky/${themeName}/env.hdr`), loadTexture(`sky/${themeName}/sky.webp`, { srgb: true, repeat: false })]);
  skyTex.wrapS = THREE.RepeatWrapping;
  env.mapping = THREE.EquirectangularReflectionMapping;
  if (!env.userData.sun) env.userData.sun = findSun(env);
  const found = env.userData.sun;
  // Keep the sun high enough to light the level; a very low sun makes everything a silhouette
  const dir = found.dir.clone();
  if (dir.y < 0.3) {
    const h = Math.hypot(dir.x, dir.z) || 1;
    dir.set((dir.x / h) * 0.954, 0.3, (dir.z / h) * 0.954);
  }
  SKY.sunDir.value.copy(dir);
  SKY.discDir.value.copy(found.dir);
  SKY.sunColor.value.set(theme.sun).multiply(found.color);
  SKY.skyK.value = theme.sky;
  SKY.fogColor.value.set(theme.fog.color);
  SKY.fogSun.value.set(theme.fog.sunColor);
  SKY.fogDensity.value = theme.fog.density;
  SKY.fogHeight.value = theme.fog.height;
  scene.environment = env;
  scene.environmentIntensity = theme.env;
  scene.backgroundNode = skyNode(skyTex);
  scene.fogNode = fogNode;
  sun.color.copy(SKY.sunColor.value);
  sun.intensity = theme.sunK;
  if (bounce) {
    bounce.color.set(theme.bounce?.sky || '#ffffff');
    bounce.groundColor.set(theme.bounce?.ground || '#000000');
    bounce.intensity = theme.bounce?.k || 0;
  }
  return { theme, sunDir: dir, found };
}
