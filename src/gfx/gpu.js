// The graphics device. Everything is drawn by three.js's WebGPU renderer: WebGPU where the
// browser has it (Chrome, Edge), WebGL 2 otherwise, with the same shaders either way since all
// materials and effects are written in TSL (three.js's shading language). We ask for the
// high-performance adapter, and report which GPU and API we actually got so the settings screen
// can show it.
import * as THREE from 'three/webgpu';

/** What the renderer ended up running on. */
export const GPU = { api: 'none', vendor: '', architecture: '', description: '', webgl: '' };

let mainDevice = null;

/**
 * Creates and initialises a renderer on a canvas. backend: 'auto' (WebGPU when available) or
 * 'webgl'. share: draw with the main renderer's GPU device rather than opening another (opening
 * a second device while the game is drawing can take seconds).
 */
export async function createGPU(canvas, { backend = 'auto', antialias = false, share = false } = {}) {
  const forceWebGL = backend === 'webgl' || !('gpu' in navigator);
  const device = share && !forceWebGL && mainDevice ? mainDevice : undefined;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias, forceWebGL, powerPreference: 'high-performance', stencil: false, device });
  await renderer.init();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (share) return renderer;
  const b = renderer.backend;
  if (b.isWebGPUBackend) mainDevice = b.device;
  if (b.isWebGPUBackend) {
    GPU.api = 'WebGPU';
    const info = b.device?.adapterInfo || b.adapter?.info || {};
    GPU.vendor = info.vendor || '';
    GPU.architecture = info.architecture || '';
    GPU.description = info.description || '';
  } else {
    GPU.api = 'WebGL 2';
    const gl = b.gl;
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    GPU.webgl = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) || '';
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** A short description of the GPU for display, e.g. "WebGPU · NVIDIA (lovelace)". */
export function gpuLabel() {
  if (GPU.api === 'WebGPU') {
    const name = GPU.description || [GPU.vendor && GPU.vendor.toUpperCase(), GPU.architecture && `(${GPU.architecture})`].filter(Boolean).join(' ');
    return `WebGPU · ${name || 'GPU'}`;
  }
  const m = /ANGLE \([^,]*, ([^(]*?)(?: \(0x|Direct3D|,|\))/.exec(GPU.webgl);
  return `WebGL 2 · ${(m ? m[1] : GPU.webgl || 'GPU').trim()}`;
}
