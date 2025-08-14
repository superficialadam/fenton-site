// Scroll-driven mu
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
camera.position.x = 3;
camera.position.y = -2.5;
camera.position.z = 6;

const clock = new Clock();

// ===== Sections (hero + four bindable sections) =====
const sectionIds = ['sec-1', 'sec-2', 'sec-3', 'sec-4'];
const sections = sectionIds.map(id => document.getElementById(id));
const hero = document.getElementById('hero');

// ===== Splat sources in order =====
const sources = [
  'https://lumalabs.ai/capture/369f2055-ca06-498e-9c55-40110d332909',
  'https://lumalabs.ai/capture/4da7cf32-865a-4515-8cb9-9dfc574c90c2',
  'https://lumalabs.ai/capture/0180b1f3-d3ef-4020-820a-22a36d94cb52',
  'https://lumalabs.ai/capture/a7eb44c9-cba1-4fed-b0e2-26f6399549ba'
];

// ===== Debug switch to toggle dispersion effect =====
const ENABLE_DISPERSION = true; // Set to false to disable dispersion for debugging

// ===== Scroll-driven rotation parameters =====
const ROTATION_CONFIG = {
  enabled: true,
  rotationsPerSection: -0.2, // Full rotations (360°) per section scroll
  easing: true // Apply easing to rotation
};

// ===== Individual transformation parameters for each splat =====
const splatTransforms = [
  { position: [1.3, -1.5, 3], rotation: [0.4, 0.5, -0.2], scale: [1, 1, 1] }, // Splat 1
  { position: [-.5, -1, 1], rotation: [0, 0.6, -0.1], scale: [1, 1, 1] }, // Splat 2
  { position: [1.6, -2.2, 3.5], rotation: [0.2, 0, -0.1], scale: [1, 1, 1] }, // Splat 3
  { position: [0.5, -1.5, 2], rotation: [0.2, -0.1, 0], scale: [1, 1, 1] }  // Splat 4
];

// ===== Animation params (full uniform list) =====
const BASE = {
  u_progress: 0.0,
  u_turbulenceStrength: 7.2,
  u_turbulenceScale: 0.03,
  u_noiseScale: 0.88,             // fixed across all states
  u_dispersionVolume: 12.4,
  u_splatSize: 1.0,
  u_splatOpacity: 1.0,
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
  formReach: 0.50,
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

    // Keep the shader hooks for turbulence and dispersion effects
    splat.setShaderHooks({
      vertexShaderHooks: {
        additionalUniforms: {
          u_time: ['float', { value: 0.0 }],
          u_progress: ['float', { value: 0.0 }],
          u_turbulenceStrength: ['float', { value: BASE.u_turbulenceStrength }],
          u_turbulenceScale: ['float', { value: BASE.u_turbulenceScale }],
          u_noiseScale: ['float', { value: BASE.u_noiseScale }],
          u_dispersionVolume: ['float', { value: BASE.u_dispersionVolume }],
          u_splatSize: ['float', { value: BASE.u_splatSize }],
          u_splatOpacity: ['float', { value: BASE.u_splatOpacity }],
          u_colorFade: ['float', { value: BASE.u_colorFade }],
          u_blackSplatsPercent: ['float', { value: BASE.u_blackSplatsPercent }],
          u_saturation: ['float', { value: BASE.u_saturation }],
          u_brightness: ['float', { value: BASE.u_brightness }],
          u_influence: ['float', { value: BASE.u_influence }],
          u_dragMin: ['float', { value: BASE.u_dragMin }],
          u_dragMax: ['float', { value: BASE.u_dragMax }]
        },

        // noise, color space helpers, curl noise, drag behavior
        additionalGlobals: /*glsl*/`
          float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }

          vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
          }

          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          float noise(vec3 x) {
            vec3 i = floor(x);
            vec3 f = fract(x);
            f = f * f * (3.0 - 2.0 * f);

            return mix(mix(mix(hash(i + vec3(0,0,0)),
                               hash(i + vec3(1,0,0)), f.x),
                           mix(hash(i + vec3(0,1,0)),
                               hash(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash(i + vec3(0,0,1)),
                               hash(i + vec3(1,0,1)), f.x),
                           mix(hash(i + vec3(0,1,1)),
                               hash(i + vec3(1,1,1)), f.x), f.y), f.z);
          }

          float splatRandom(vec3 position, float seed) {
            return fract(sin(dot(position.xyz + seed, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
          }

          float calculateDragFactor(vec3 position) {
            float splatDragRandom = splatRandom(position, 1.0);
            float dragAmount = mix(u_dragMin, u_dragMax, splatDragRandom);
            return u_influence / dragAmount;
          }

          vec3 curlNoise(vec3 p, float time) {
            float eps = 0.1;
            float timeScale = time * 0.02;
            float nx = (noise(p + vec3(0.0, eps, 0.0) + vec3(timeScale)) - noise(p + vec3(0.0, -eps, 0.0) + vec3(timeScale))) / (2.0 * eps);
            float ny = (noise(p + vec3(0.0, 0.0, eps) + vec3(timeScale)) - noise(p + vec3(0.0, 0.0, -eps) + vec3(timeScale))) / (2.0 * eps);
            float nz = (noise(p + vec3(eps, 0.0, 0.0) + vec3(timeScale)) - noise(p + vec3(-eps, 0.0, 0.0) + vec3(timeScale))) / (2.0 * eps);
            return vec3(nx, ny, nz) * 0.5;
          }
        `,

        getSplatTransform: /*glsl*/`
          (vec3 position, uint layersBitmask) {
            float dragFactor = calculateDragFactor(position);
            vec3 finalOffset = vec3(0.0);
            
            // Only apply dispersion if enabled
            if (${ENABLE_DISPERSION ? 'true' : 'false'}) {
              vec3 curlOffset = curlNoise(position * u_noiseScale, u_time) * u_dispersionVolume * u_turbulenceStrength;
              float easing = u_progress * u_progress * u_progress * (u_progress * (u_progress * 6.0 - 15.0) + 10.0);
              vec3 turbulentOffset = curlOffset * (1.0 - easing);
              finalOffset = turbulentOffset * clamp(dragFactor, 0.0, 1.0);
            }
            
            return mat4(
              1.0, 0.0, 0.0, 0.0,
              0.0, 1.0, 0.0, 0.0,
              0.0, 0.0, 1.0, 0.0,
              finalOffset.x, finalOffset.y, finalOffset.z, 1.0
            );
          }
        `,

        getSplatOpacity: /*glsl*/`
          (vec3 position, uint layersBitmask) {
            return mix(0.2, 1.0, u_progress) * u_splatOpacity;
          }
        `,

        getSplatColor: /*glsl*/`
          (vec4 splatColor, vec3 splatPosition, uint layersBitmask) {
            float dragFactor = calculateDragFactor(splatPosition);

            vec3 originalColor = splatColor.rgb;
            vec3 processedColor = originalColor;

            float effectiveBrightness = mix(1.0, u_brightness, clamp(dragFactor, 0.0, 1.0));
            processedColor *= effectiveBrightness;

            vec3 hsv = rgb2hsv(processedColor);
            float effectiveSaturation = mix(1.0, u_saturation, clamp(dragFactor, 0.0, 1.0));
            hsv.y *= effectiveSaturation;
            processedColor = hsv2rgb(hsv);

            float effectiveFade = u_colorFade * clamp(dragFactor, 0.0, 1.0);
            processedColor = mix(processedColor, vec3(0.0, 0.0, 0.0), effectiveFade);

            float positionHash = fract(sin(dot(splatPosition.xy, vec2(12.9898, 78.233))) * 43758.5453);
            float isBlackSplat = step(positionHash, u_blackSplatsPercent);

            vec3 finalColor = mix(processedColor, vec3(0.0, 0.0, 0.0), isBlackSplat);
            return vec4(finalColor, splatColor.a);
          }
        `
      },

      fragmentShaderHooks: {
        additionalUniforms: {
          u_splatSize: ['float', { value: BASE.u_splatSize }],
          u_splatOpacity: ['float', { value: BASE.u_splatOpacity }]
        },

        getFragmentColor: /*glsl*/`
          (vec4 fragColor) {
            return vec4(fragColor.rgb, fragColor.a * u_splatOpacity);
          }
        `
      }
    });
  };

  return splat;
}

// ===== Create and preload all splats =====
const splats = sources.map((src, index) => buildSplat(src, index));

// When dispersion is disabled, make all splats visible immediately for debugging
if (!ENABLE_DISPERSION) {
  splats.forEach(s => s.visible = true);
} else {
  splats.forEach(s => s.visible = false);
}

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
  if (u.u_progress) u.u_progress.value = ENABLE_DISPERSION ? uniforms.u_progress : 1.0; // Show formed state when dispersion is disabled
  if (u.u_turbulenceStrength) u.u_turbulenceStrength.value = uniforms.u_turbulenceStrength;
  if (u.u_turbulenceScale) u.u_turbulenceScale.value = uniforms.u_turbulenceScale;
  if (u.u_noiseScale) u.u_noiseScale.value = 0.88;
  if (u.u_dispersionVolume) u.u_dispersionVolume.value = uniforms.u_dispersionVolume;
  if (u.u_splatSize) u.u_splatSize.value = uniforms.u_splatSize;
  if (u.u_splatOpacity) u.u_splatOpacity.value = uniforms.u_splatOpacity;
  if (u.u_colorFade) u.u_colorFade.value = ENABLE_DISPERSION ? uniforms.u_colorFade : 0.0; // No color fade when dispersion is disabled
  if (u.u_blackSplatsPercent) u.u_blackSplatsPercent.value = ENABLE_DISPERSION ? uniforms.u_blackSplatsPercent : 0.0; // No black splats when dispersion is disabled
  if (u.u_saturation) u.u_saturation.value = ENABLE_DISPERSION ? uniforms.u_saturation : 1.0; // Full saturation when dispersion is disabled
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

// ===== Calculate Y rotation based on scroll progress =====
function calculateSplatRotation(t) {
  if (!ROTATION_CONFIG.enabled) return 0;

  const rawRotation = t * ROTATION_CONFIG.rotationsPerSection * Math.PI * 2; // Convert to radians

  if (ROTATION_CONFIG.easing) {
    // Apply easing to the rotation for smoother motion
    const easedT = easeInOutCubic(t);
    return easedT * ROTATION_CONFIG.rotationsPerSection * Math.PI * 2;
  }

  return rawRotation;
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
      // When dispersion is disabled, keep all splats visible for debugging
      if (!ENABLE_DISPERSION) {
        // Keep all splats visible and in the scene
        loop();
        renderer.setAnimationLoop(null);
      } else {
        // remove everything; start with none active (we might be on hero)
        splats.forEach(s => { s.visible = false; scene.remove(s); });
        loop();
        renderer.setAnimationLoop(null);
      }
    }
  });
})();

function loop() {
  function frame() {
    // If dispersion is disabled, show all splats for debugging
    if (!ENABLE_DISPERSION) {
      // Make all splats visible and apply default uniforms
      splats.forEach((splat, index) => {
        if (!splat.visible) {
          splat.visible = true;
          scene.add(splat);
        }
        // Apply default formed state uniforms
        const formedState = { ...PRESETS.FORM };
        applyUniforms(splat, formedState);

        // Apply rotation based on a simulated scroll progress for debug mode
        const debugT = (clock.getElapsedTime() * 0.1) % 1.0; // Slow continuous rotation for debug
        const rotationY = calculateSplatRotation(debugT);
        const baseTransform = splatTransforms[index];
        splat.rotation.set(
          baseTransform.rotation[0],
          baseTransform.rotation[1] + rotationY,
          baseTransform.rotation[2]
        );
      });
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
      return;
    }

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
    if (active) {
      applyUniforms(active, target);

      // Apply scroll-driven rotation
      const rotationY = calculateSplatRotation(t);
      const baseTransform = splatTransforms[activeIndex];
      active.rotation.set(
        baseTransform.rotation[0],
        baseTransform.rotation[1] + rotationY,
        baseTransform.rotation[2]
      );
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ===== Camera debug controls =====
function setupCameraDebugControls() {
  const inputs = {
    posX: document.getElementById('cam-pos-x'),
    posY: document.getElementById('cam-pos-y'),
    posZ: document.getElementById('cam-pos-z'),
    rotX: document.getElementById('cam-rot-x'),
    rotY: document.getElementById('cam-rot-y'),
    rotZ: document.getElementById('cam-rot-z'),
    fov: document.getElementById('cam-fov')
  };

  // Initialize input values from current camera state
  inputs.posX.value = camera.position.x;
  inputs.posY.value = camera.position.y;
  inputs.posZ.value = camera.position.z;
  inputs.rotX.value = camera.rotation.x;
  inputs.rotY.value = camera.rotation.y;
  inputs.rotZ.value = camera.rotation.z;
  inputs.fov.value = camera.fov;

  function updateCamera() {
    // Update position
    camera.position.x = parseFloat(inputs.posX.value) || 0;
    camera.position.y = parseFloat(inputs.posY.value) || 0;
    camera.position.z = parseFloat(inputs.posZ.value) || 15;

    // Update rotation
    camera.rotation.x = parseFloat(inputs.rotX.value) || 0;
    camera.rotation.y = parseFloat(inputs.rotY.value) || 0;
    camera.rotation.z = parseFloat(inputs.rotZ.value) || 0;

    // Update FOV
    camera.fov = parseFloat(inputs.fov.value) || 75;
    camera.updateProjectionMatrix();
  }

  // Add event listeners to all inputs
  Object.values(inputs).forEach(input => {
    input.addEventListener('input', updateCamera);
    input.addEventListener('change', updateCamera);
  });

  return { inputs, updateCamera };
}

// ===== Splat debug controls =====
function setupSplatDebugControls() {
  const splatInputs = [];

  // Create input references for each splat
  for (let i = 0; i < sources.length; i++) {
    splatInputs[i] = {
      posX: document.getElementById(`splat-${i}-pos-x`),
      posY: document.getElementById(`splat-${i}-pos-y`),
      posZ: document.getElementById(`splat-${i}-pos-z`),
      rotX: document.getElementById(`splat-${i}-rot-x`),
      rotY: document.getElementById(`splat-${i}-rot-y`),
      rotZ: document.getElementById(`splat-${i}-rot-z`)
    };
  }

  function updateSplatTransform(index) {
    const inputs = splatInputs[index];
    if (!inputs) return;

    // Update the splatTransforms array
    splatTransforms[index] = {
      position: [
        parseFloat(inputs.posX.value) || 0,
        parseFloat(inputs.posY.value) || 0,
        parseFloat(inputs.posZ.value) || 0
      ],
      rotation: [
        parseFloat(inputs.rotX.value) || 0,
        parseFloat(inputs.rotY.value) || 0,
        parseFloat(inputs.rotZ.value) || 0
      ],
      scale: [1, 1, 1] // Keep scale unchanged
    };

    // Apply transform to the splat if it's loaded
    const splat = splats[index];
    if (splat && splat.position) {
      const transform = splatTransforms[index];
      splat.position.set(transform.position[0], transform.position[1], transform.position[2]);
      // Don't set rotation here as it will be overridden by scroll-driven rotation
      // The base rotation will be used in the main loop
      splat.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
    }
  }

  function updateAllSplats() {
    for (let i = 0; i < sources.length; i++) {
      updateSplatTransform(i);
    }
  }

  // Add event listeners to all splat inputs
  splatInputs.forEach((inputs, index) => {
    Object.values(inputs).forEach(input => {
      if (input) {
        input.addEventListener('input', () => updateSplatTransform(index));
        input.addEventListener('change', () => updateSplatTransform(index));
      }
    });
  });

  return { splatInputs, updateSplatTransform, updateAllSplats };
}

// ===== Debug UI toggle functionality =====
function setupDebugToggle() {
  const toggleButton = document.getElementById('debug-toggle');
  const debugPanels = document.getElementById('debug-panels');
  let isVisible = true;

  function toggleDebugUI() {
    isVisible = !isVisible;
    if (isVisible) {
      debugPanels.classList.remove('hidden');
      toggleButton.textContent = 'Hide Debug UI';
    } else {
      debugPanels.classList.add('hidden');
      toggleButton.textContent = 'Show Debug UI';
    }
  }

  if (toggleButton) {
    toggleButton.addEventListener('click', toggleDebugUI);
  }

  return { toggleDebugUI, isVisible: () => isVisible };
}

// Initialize debug controls after DOM is ready
const cameraDebug = setupCameraDebugControls();
const splatDebug = setupSplatDebugControls();
const debugToggle = setupDebugToggle();

// ===== Debug helpers (optional) =====
window.splats = {
  setActive,
  sampleState,
  sectionProgress: (i) => sectionProgress(sections[i]),
  breakpoints,
  presets: PRESETS,
  camera,
  cameraDebug,
  splatDebug,
  debugToggle,
  splatTransforms,
  dispose() {
    renderer.dispose();
    splats.forEach(s => s.dispose && s.dispose());
  }
};
