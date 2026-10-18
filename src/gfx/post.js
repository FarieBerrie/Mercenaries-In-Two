// The camera: everything between the rendered scene and the screen, as one GPU pipeline.
//   1. The scene renders to HDR, writing its normals alongside.
//   2. Ground-truth ambient occlusion from that depth and those normals (High and Ultra), laid
//      over the image weighted toward the shadowed tones.
//   3. Light shafts: the sky round the sun, cut out by everything in front of it, smeared
//      toward the sun at quarter resolution (the crepuscular rays of the era's engines).
//   4. Camera motion blur (from depth and last frame's camera), bloom, and lens ghosts from
//      bright spots.
//   5. Hable's filmic tone curve (the Uncharted 2 operator that set the look of that console
//      generation), then FXAA or SMAA.
//   6. The grade: split toning, a hazy lifted black level, contrast, saturation, vignette,
//      chromatic fringing, film grain, sun glare, and the gameplay feedback (damage, Redline,
//      slow motion, flashes, the scope).
import * as THREE from 'three/webgpu';
import {
  cameraProjectionMatrixInverse, cameraWorldMatrix, clamp, convertToTexture, dot, exp, float, Fn, fract, getScreenPositionFromClip, getViewPosition, int, interleavedGradientNoise, length, Loop, max, min, mix, mrt, normalView, output, pass, rand, renderOutput, rtt, screenCoordinate, screenUV, select, smoothstep, step, uniform, vec2, vec3, vec4,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { lensflare } from 'three/addons/tsl/display/LensflareNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';

/** Hable's filmic curve, normalised so `white` maps to 1. */
const hable = Fn(([x]) => {
  const A = 0.15;
  const B = 0.5;
  const C = 0.1;
  const D = 0.2;
  const E = 0.02;
  const F = 0.3;
  return x.mul(x.mul(A).add(C * B)).add(D * E).div(x.mul(x.mul(A).add(B)).add(D * F)).sub(E / F);
});
const filmic = Fn(([c, exposure]) => {
  const W = 11.2;
  const white = hable(vec3(W));
  return hable(c.mul(exposure).mul(2)).div(white);
});

const luma = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * For see-through effects: their colour as usual, but leave the scene's normals (used for
 * ambient occlusion) alone. The normals target blends with each material's own blending, so a
 * zero-alpha write changes nothing.
 */
export const keepNormals = () => mrt({ output, normal: vec4(0, 0, 0, 0) });

export function createPost(renderer, scene, camera) {
  const U = {
    // gameplay feedback, driven from main.js
    damage: uniform(0),
    redline: uniform(0),
    slowmo: uniform(0),
    desat: uniform(0),
    flash: uniform(0),
    scope: uniform(0),
    // the look, per theme
    exposure: uniform(1),
    shadowsTint: uniform(new THREE.Vector3(1, 1, 1)),
    lift: uniform(new THREE.Vector3(0, 0, 0)),
    highlightsTint: uniform(new THREE.Vector3(1, 1, 1)),
    saturation: uniform(1),
    contrast: uniform(1.1),
    vignette: uniform(0.38),
    grain: uniform(0.045),
    aberration: uniform(0.0008),
    sharpen: uniform(0.25),
    blur: uniform(0.5),
    flare: uniform(0.35),
    // sun glare
    sunPos: uniform(new THREE.Vector2(-9, -9)),
    sunVis: uniform(0),
    // light shafts: how strong (per theme), the sun's colour, and how much of it is on screen
    shafts: uniform(0),
    shaftColor: uniform(new THREE.Color(1, 0.8, 0.55)),
    sunOn: uniform(0),
    time: uniform(0),
    aspect: uniform(16 / 9),
    prevViewProj: uniform(new THREE.Matrix4()),
  };
  const viewProj = new THREE.Matrix4();
  let first = true;
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  let q = null;
  let bloomNode = null;
  let aoNode = null;
  let enabled = true;

  function build(quality) {
    q = quality;
    enabled = q.post !== false;
    const scenePass = pass(scene, camera);
    let color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    if (q.ao) {
      // Occlusion from the scene pass's own depth and normals (no second pass over the scene),
      // laid over the image as games of the era did, weighted toward the shadowed tones so sunlit
      // surfaces keep their brightness
      scenePass.setMRT(mrt({ output, normal: normalView }).setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending)));
      aoNode = ao(depth, scenePass.getTextureNode('normal'), camera);
      aoNode.resolutionScale = q.ao === 'full' ? 1 : 0.5;
      aoNode.samples.value = q.ao === 'full' ? 16 : 10;
      aoNode.radius.value = 0.6;
      aoNode.distanceExponent.value = 1.4;
      aoNode.thickness.value = 1.2;
      aoNode.scale.value = 1.15;
      const occ = aoNode.getTextureNode();
      const lit = color;
      color = convertToTexture(
        Fn(() => {
          const c = lit.sample(screenUV);
          const shade = float(1).sub(smoothstep(0.3, 1.6, luma(c.rgb)).mul(0.55));
          return vec4(c.rgb.mul(mix(float(1), occ.sample(screenUV).r, shade.mul(0.95))), c.a);
        })(),
      );
    } else aoNode = null;

    if (q.shafts !== false) {
      // The sky near the sun (anything in front of it cuts it out), at quarter resolution...
      const sky = color;
      const source = rtt(
        Fn(() => {
          const st = screenUV;
          const open = step(0.99999, depth.sample(st).r);
          const near = exp(length(st.sub(U.sunPos).mul(vec2(U.aspect, 1))).mul(-4));
          return vec4(min(sky.sample(st).rgb, vec3(3)).mul(open).mul(near), 1);
        })(),
        null,
        null,
        { resolutionScale: 0.25 },
      );
      // ...smeared toward the sun: each pixel gathers what lies between it and the sun
      const N = 40;
      const rays = rtt(
        Fn(() => {
          const st = screenUV.toVar();
          const delta = st.sub(U.sunPos).mul(0.85 / N);
          st.subAssign(delta.mul(interleavedGradientNoise(screenCoordinate)));
          const acc = vec3(0).toVar();
          const w = float(1).toVar();
          Loop({ start: int(0), end: int(N), type: 'int', condition: '<' }, () => {
            acc.addAssign(source.sample(st).rgb.mul(w));
            w.mulAssign(0.955);
            st.subAssign(delta);
          });
          return vec4(acc.div(N), 1);
        })(),
        null,
        null,
        { resolutionScale: 0.5 },
      );
      const lit = color;
      color = convertToTexture(Fn(() => vec4(lit.sample(screenUV).rgb.add(rays.sample(screenUV).rgb.mul(vec3(U.shaftColor)).mul(U.shafts).mul(U.sunOn)), 1))());
    }

    // Camera motion blur: where each pixel's point in the world was on screen last frame. The
    // player's own body (close to the lens) stays sharp.
    const cameraVelocity = Fn(() => {
      const d = depth.sample(screenUV).r;
      const view = getViewPosition(screenUV, d, cameraProjectionMatrixInverse);
      const world = cameraWorldMatrix.mul(vec4(view, 1));
      const prev = getScreenPositionFromClip(U.prevViewProj.mul(world));
      const v = screenUV.sub(prev).mul(U.blur);
      const near = smoothstep(2.5, 5, view.z.negate());
      const len = length(v);
      return v.mul(near).mul(float(0.04).div(max(len, 0.04)));
    })();
    const blurred = q.motionBlur ? motionBlur(color, cameraVelocity, int(q.motionBlur)) : color;
    bloomNode = q.bloom ? bloom(color, 0.3, 0.5, 0.9) : null;
    let hdr = bloomNode ? blurred.add(bloomNode) : blurred;
    if (q.flare && bloomNode) {
      const ghosts = lensflare(bloomNode, { threshold: float(0.35), ghostAttenuationFactor: float(28), ghostSpacing: float(0.22), ghostTint: vec3(1.0, 0.82, 0.62) });
      hdr = hdr.add(ghosts.mul(U.flare));
    }

    // Tone curve to display range, then anti-aliasing on the final image
    const toned = Fn(() => vec4(filmic(max(hdr.rgb, vec3(0)), U.exposure), 1))();
    const ldr = renderOutput(toned, THREE.NoToneMapping, THREE.SRGBColorSpace);
    const aa = q.aa === 'smaa' ? smaa(ldr) : q.aa === 'fxaa' ? fxaa(ldr) : ldr;
    pipeline.outputNode = grade(convertToTexture(aa));
    pipeline.needsUpdate = true;
  }

  /** The grade and the screen effects, on the anti-aliased display image. */
  function grade(src) {
    return Fn(() => {
      const st = screenUV;
      const c = st.sub(0.5);
      const r2 = dot(c.mul(vec2(U.aspect, 1)), c.mul(vec2(U.aspect, 1)));
      // Chromatic fringing toward the edges (more when hurt or in slow motion)
      const off = c.mul(U.aberration.add(U.damage.mul(0.004)).add(U.slowmo.mul(0.002))).mul(r2.mul(3).add(1));
      const base = src.sample(st);
      let col = vec3(src.sample(st.add(off)).r, base.g, src.sample(st.sub(off)).b).toVar();
      // Sharpen: undo the softness of anti-aliasing
      const px = vec2(1).div(vec2(U.aspect.mul(1080), 1080));
      const nb = src.sample(st.add(vec2(px.x, 0))).rgb.add(src.sample(st.sub(vec2(px.x, 0))).rgb).add(src.sample(st.add(vec2(0, px.y))).rgb).add(src.sample(st.sub(vec2(0, px.y))).rgb);
      col.addAssign(col.sub(nb.mul(0.25)).mul(U.sharpen));
      col.assign(max(col, vec3(0)));
      // Sun glare: a soft halo where the sun is in view
      const sd = st.sub(U.sunPos).mul(vec2(U.aspect, 1));
      const glare = exp(length(sd).mul(-9)).mul(0.12).add(exp(length(sd).mul(-40)).mul(0.25));
      col.addAssign(vec3(1.0, 0.86, 0.66).mul(glare).mul(U.sunVis));
      // Split toning: cool shadows, warm highlights (per theme)
      const l = luma(col);
      col.assign(col.mul(mix(U.shadowsTint, U.highlightsTint, smoothstep(0.1, 0.75, l))));
      // Contrast around mid grey, then saturation
      col.assign(col.sub(0.45).mul(U.contrast).add(0.45));
      const l2 = luma(col);
      col.assign(mix(vec3(l2), col, U.saturation.mul(float(1).sub(U.desat))));
      // Haze: the darkest tones are lifted toward a tint, never quite black
      col.assign(col.add(U.lift.mul(float(1).sub(col))));
      // Slow motion: cool and crisp; Redline: hot at the edges
      col.assign(mix(col, col.mul(vec3(0.82, 0.95, 1.18)), U.slowmo));
      const edge = smoothstep(0.08, 0.55, r2);
      col.assign(mix(col, col.mul(vec3(1.3, 0.78, 0.55)), U.redline.mul(edge.mul(0.65).add(0.35))));
      // Hurt: blood creeps in from the edges
      col.assign(mix(col, vec3(0.3, 0, 0), clamp(U.damage, 0, 1).mul(smoothstep(0.18, 0.75, r2)).mul(0.8)));
      col.mulAssign(float(1).sub(U.vignette.mul(smoothstep(0.12, 0.95, r2))));
      col.addAssign(vec3(1, 0.9, 0.75).mul(U.flash));
      // Film grain, a little stronger in the shadows
      const g = rand(st.add(fract(U.time.mul(vec2(13.7, 7.3))))).sub(0.5);
      col.addAssign(g.mul(U.grain).mul(float(1.3).sub(luma(col))));
      // The scope: black outside a circle, darkening toward its rim
      const sr = length(c.mul(vec2(U.aspect, 1)));
      const scoped = col.mul(float(1).sub(smoothstep(0.41, 0.43, sr))).mul(float(1).sub(smoothstep(0.25, 0.42, sr).mul(0.4)));
      col.assign(select(U.scope.greaterThan(0.5), scoped, col));
      return vec4(clamp(col, 0, 1), 1);
    })();
  }

  return {
    uniforms: U,
    get enabled() {
      return enabled;
    },
    get ao() {
      return aoNode;
    },
    setQuality(quality) {
      build(quality);
    },
    setSize(w, h) {
      U.aspect.value = w / Math.max(1, h);
    },
    /** Theme look: { exposure, bloom: {strength,radius,threshold}, grade: {...} } */
    setLook(theme) {
      U.exposure.value = theme.exposure;
      const g = theme.grade;
      U.shadowsTint.value.set(...g.shadows);
      U.highlightsTint.value.set(...g.highlights);
      U.saturation.value = g.saturation;
      U.contrast.value = g.contrast;
      U.lift.value.set(...(g.lift || [0, 0, 0]));
      U.vignette.value = g.vignette ?? 0.38;
      U.shafts.value = theme.shafts ?? 0;
      U.shaftColor.value.set(theme.shaftColor || '#ffcf90');
      if (bloomNode) {
        bloomNode.strength.value = theme.bloom.strength;
        bloomNode.radius.value = theme.bloom.radius;
        bloomNode.threshold.value = theme.bloom.threshold;
      }
    },
    render() {
      if (first) {
        first = false;
        U.prevViewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      }
      pipeline.render();
      U.prevViewProj.value.copy(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    },
  };
}

