// Scroll-driven multi-splat system (standalone)
// - Renders only one splat at a time
// - FORM plateau 0.40 → 0.60, then reverse
// - Uniforms include all parameters, with u_noiseScale fixed at 0.88

import { WebGLRenderer, PerspectiveCamera, Scene, Clock } from 'three';
import { LumaSplatsThree, LumaSplatsSemantics } from '@lumaai/luma-web';

// ===== Canvas / Renderer =====
const canvas = document.getElementById('bg-splats');
const renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 1);

const scene = new Scene();
const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.x = 2;
camera.position.y = -2;
camera.position.z = 15;

const clock = new Clock();

// ===== Sections (hero + four bindable sections) =====
const sectionIds = ['sec-1', 'sec-2', 'sec-3', 'sec-4'];
const sections = sectionIds.map(id => document.getElementById(id));
const hero = document.getElementById('hero');

// ===== Splat sources in order =====
const sources = [
  'https://lumalabs.ai/capture/a7eb44c9-cba1-4fed-b0e2-26f6399549ba',
  'https://lumalabs.ai/capture/0180b1f3-d3ef-4020-820a-22a36d94cb52',
  'https://lumalabs.ai/capture/4f362242-ad43-4851-9b04-88adf71f24f5',
  'https://lumalabs.ai/capture/369f2055-ca06-498e-9c55-40110d332909'
];

// ===== Individual transformation parameters for each splat =====
const splatTransforms = [
  { position: [0, 0, 0], rotation: [0, 0, 0.2], scale: [1, 1, 1] }, // Splat 1
  { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, // Splat 2
  { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, // Splat 3
  { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }  // Splat 4
];

// ===== Animation params (full uniform list) =====
const BASE = {
  u_progress: 0.0,
  u_turbulenceStrength: 7.2,
  u_turbulenceScale: 0.03,
  u_noiseScale: 0.88,             // fixed across all states
  u_dispersionVolume: 12.4,
  u_splatSize: 0.1,
  u_splatOpacity: 1.6,
  u_colorFade: 0.10,
  u_blackSplatsPercent: 1.0,
  u_saturation: 0.0,
  u_brightness: 1.18,
  u_influence: 1.0,
  u_dragMin: 0.1,
  u_dragMax: 1.8
};

const PRESETS = {
  IDLE: { ...BASE, u_progress: 0.00, u_blackSplatsPercent: 1.00, u_saturation: 0.00, u_influence: 1.00, u_colorFade: 0.10 },
  APPEARING: { ...BASE, u_progress: 0.30, u_blackSplatsPercent: 0.99, u_saturation: 0.00, u_influence: 1.00, u_colorFade: 0.10 },
  CLOUD: { ...BASE, u_progress: 0.55, u_blackSplatsPercent: 0.66, u_saturation: 0.00, u_influence: 1.00, u_colorFade: 0.10 },
  FORM: { ...BASE, u_progress: 1.00, u_blackSplatsPercent: 0.00, u_saturation: 1.00, u_influence: 0.00, u_colorFade: 0.00 }
};

// ===== Easing / Lerp helpers =====
const easeInOutCubic = (x) => (x < 0.5) ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

function blendPresets(a, b, t) {
  const out = {};
  for (const k in a) out[k] = mix(a[k], b[k], t);
  return out;
}

// ===== Scroll mapping with FORM plateau 0.40–0.60 =====
const breakpoints = {
  idleEnd: 0.25,
  appearingEnd: 0.40,
  formReach: 0.55,
  formHoldEnd: 0.65
};

function sampleState(t) {
  t = clamp01(t);
  if (t <= breakpoints.idleEnd) {
    const local = clamp01(t / breakpoints.idleEnd);
    return blendPresets(PRESETS.IDLE, PRESETS.APPEARING, easeInOutCubic(local));
  }
  if (t <= breakpoints.appearingEnd) {
    const span = breakpoints.appearingEnd - breakpoints.idleEnd;
    const local = clamp01((t - breakpoints.idleEnd) / span);
    return blendPresets(PRESETS.APPEARING, PRESETS.CLOUD, easeInOutCubic(local));
  }
  if (t <= breakpoints.formReach) {
    const span = breakpoints.formReach - breakpoints.appearingEnd;
    const local = clamp01((t - breakpoints.appearingEnd) / span);
    return blendPresets(PRESETS.CLOUD, PRESETS.FORM, easeInOutCubic(local));
  }
  if (t <= breakpoints.formHoldEnd) {
    return { ...PRESETS.FORM };
  }
  // Reverse
  if (t <= 0.70) {
    const local = clamp01((t - breakpoints.formHoldEnd) / (0.10));
    return blendPresets(PRESETS.FORM, PRESETS.CLOUD, easeInOutCubic(local));
  }
  if (t <= 0.84) {
    const local = clamp01((t - 0.70) / (0.14));
    return blendPresets(PRESETS.CLOUD, PRESETS.APPEARING, easeInOutCubic(local));
  }
  const local = clamp01((t - 0.84) / (0.16));
  return blendPresets(PRESETS.APPEARING, PRESETS.IDLE, easeInOutCubic(local));
}

// ===== Build splats & shader hooks (ported from prototype) =====
function buildSplat(source, index) {
  const splat = new LumaSplatsThree({
    source,
    loadingAnimationEnabled: false
  });
  splat.semanticsMask = LumaSplatsSemantics.FOREGROUND;

  splat.onLoad = () => {
    // Apply individual transformations
    const transform = splatTransforms[index];
    splat.position.set(transform.position[0], transform.position[1], transform.position[2]);
    splat.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
    splat.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
  };

  return splat;
}

// ===== Create and preload all splats =====
const splats = sources.map((src, index) => buildSplat(src, index));
splats.forEach(s => s.visible = false);

let loadedCount = 0;
const allLoaded = new Promise(resolve => {
  splats.forEach(s => {
    const prev = s.onLoad;
    s.onLoad = () => {
      prev && prev();
      loadedCount++;
      if (loadedCount === splats.length) resolve();
    };
  });
});

// ===== Uniform update helper =====
function applyUniforms(splat, uniforms) {
  if (!splat?.material?.uniforms) return;
  const u = splat.material.uniforms;
  // always keep time updated
  if (u.u_time) u.u_time.value = clock.getElapsedTime();

  // set all known uniforms (noiseScale forced to 0.88)
  if (u.u_progress) u.u_progress.value = uniforms.u_progress;
  if (u.u_turbulenceStrength) u.u_turbulenceStrength.value = uniforms.u_turbulenceStrength;
  if (u.u_turbulenceScale) u.u_turbulenceScale.value = uniforms.u_turbulenceScale;
  if (u.u_noiseScale) u.u_noiseScale.value = 0.88;
  if (u.u_dispersionVolume) u.u_dispersionVolume.value = uniforms.u_dispersionVolume;
  if (u.u_splatSize) u.u_splatSize.value = uniforms.u_splatSize;
  if (u.u_splatOpacity) u.u_splatOpacity.value = uniforms.u_splatOpacity;
  if (u.u_colorFade) u.u_colorFade.value = uniforms.u_colorFade;
  if (u.u_blackSplatsPercent) u.u_blackSplatsPercent.value = uniforms.u_blackSplatsPercent;
  if (u.u_saturation) u.u_saturation.value = uniforms.u_saturation;
  if (u.u_brightness) u.u_brightness.value = uniforms.u_brightness;
  if (u.u_influence) u.u_influence.value = uniforms.u_influence;
  if (u.u_dragMin) u.u_dragMin.value = uniforms.u_dragMin;
  if (u.u_dragMax) u.u_dragMax.value = uniforms.u_dragMax;
}

// ===== Scene management (only one visible) =====
let activeIndex = -1;
function setActive(index) {
  if (index === activeIndex) return;
  if (activeIndex !== -1) {
    const prev = splats[activeIndex];
    prev.visible = false;
    scene.remove(prev);
  }
  activeIndex = index;
  const curr = splats[activeIndex];
  if (curr) {
    curr.visible = true;
    scene.add(curr);
  }
}

// ===== Compute local t in [0,1] for a section =====
function sectionProgress(el) {
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight;
  // map: t=0 when top aligns with top; t=0.5 when center aligns with center; t=1 when bottom aligns with top
  const raw = (vh - rect.top) / (vh + rect.height);
  return clamp01(raw);
}

// ===== Choose section closest to viewport center =====
function closestSectionIndex() {
  const centerY = window.innerHeight / 2;
  let best = -1;
  let bestDist = Infinity;
  sections.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const d = Math.abs(mid - centerY);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// ===== Resize handling =====
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);

// ===== Main loop & warmup =====
let warmedUp = false;
let warmFrames = 0;

(async function start() {
  // Add to scene for compilation, then remove after warmup
  splats.forEach(s => scene.add(s));
  await allLoaded;

  renderer.setAnimationLoop(() => {
    clock.getElapsedTime();
    // update times so programs stabilize
    splats.forEach(s => { if (s.material?.uniforms?.u_time) s.material.uniforms.u_time.value = clock.getElapsedTime(); });
    renderer.render(scene, camera);
    warmFrames++;
    if (warmFrames > 10 && !warmedUp) {
      warmedUp = true;
      // remove everything; start with none active (we might be on hero)
      splats.forEach(s => { s.visible = false; scene.remove(s); });
      loop();
      renderer.setAnimationLoop(null);
    }
  });
})();

function loop() {
  function frame() {
    // If we're still in hero (center is above section 1), render nothing
    const firstRect = sections[0].getBoundingClientRect();
    const inHero = firstRect.top > window.innerHeight / 2;
    if (inHero) {
      if (activeIndex !== -1) {
        const prev = splats[activeIndex];
        prev.visible = false;
        scene.remove(prev);
        activeIndex = -1;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
      return;
    }

    const idx = closestSectionIndex();
    setActive(idx);

    const t = sectionProgress(sections[idx]);
    const target = sampleState(t);
    const active = splats[activeIndex];
    if (active) applyUniforms(active, target);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ===== Debug helpers (optional) =====
window.splats = {
  setActive,
  sampleState,
  sectionProgress: (i) => sectionProgress(sections[i]),
  breakpoints,
  presets: PRESETS,
  dispose() {
    renderer.dispose();
    splats.forEach(s => s.dispose && s.dispose());
  }
};
