// Fixed Turbulent Point Field Effect - Proper timing handling
import { WebGLRenderer, PerspectiveCamera, Scene, Clock } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LumaSplatsThree, LumaSplatsSemantics } from '@lumaai/luma-web';

let canvas = document.querySelector('canvas');
let renderer = new WebGLRenderer({ canvas: canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x000000, 1); // Black background

let scene = new Scene();
let camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 2;

let controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

let clock = new Clock();

// Track loading state
let isShaderHooksReady = false;

// Create splats with custom shader hooks
let splat = new LumaSplatsThree({
  source: 'https://lumalabs.ai/capture/d80d4876-cf71-4b8a-8b5b-49ffac44cd4a',
  loadingAnimationEnabled: false
});

// Remove background by showing only foreground layer
splat.semanticsMask = LumaSplatsSemantics.FOREGROUND;

// Animation parameters
const animationParams = {
  progress: 0.0,
  turbulenceStrength: 1.0, // Overall effect multiplier
  turbulenceScale: 0.03,   // Legacy parameter
  noiseScale: 0.03,        // Noise detail/frequency
  dispersionVolume: 8.0,   // How far particles spread
  splatSize: 1.0,          // Splat size multiplier
  splatOpacity: 1.0,       // Splat opacity multiplier
  colorFade: 0.0,          // 0 = original colors, 1 = black
  blackSplatsPercent: 0.0, // 0 = no black splats, 1 = all black splats
  saturation: 1.0,         // 0 = grayscale, 1 = original, 2 = oversaturated
  brightness: 1.0,         // 0 = black, 1 = original, 2 = overbright
  animationSpeed: 0.001
};

// Set up shader hooks after splat loads
splat.onLoad = () => {
  console.log('✓ Splat loaded, setting up turbulent shader hooks...');

  splat.setShaderHooks({
    vertexShaderHooks: {
      additionalUniforms: {
        u_time: ['float', { value: 0.0 }],
        u_progress: ['float', { value: 0.0 }],
        u_turbulenceStrength: ['float', { value: animationParams.turbulenceStrength }],
        u_turbulenceScale: ['float', { value: animationParams.turbulenceScale }],
        u_noiseScale: ['float', { value: animationParams.noiseScale }],
        u_dispersionVolume: ['float', { value: animationParams.dispersionVolume }],
        u_splatSize: ['float', { value: animationParams.splatSize }],
        u_splatOpacity: ['float', { value: animationParams.splatOpacity }],
        u_colorFade: ['float', { value: animationParams.colorFade }],
        u_blackSplatsPercent: ['float', { value: animationParams.blackSplatsPercent }],
        u_saturation: ['float', { value: animationParams.saturation }],
        u_brightness: ['float', { value: animationParams.brightness }]
      },

      // Curl noise for swirling patterns
      additionalGlobals: /*glsl*/`
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
                }
                
                // RGB to HSV conversion
                vec3 rgb2hsv(vec3 c) {
                    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
                    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
                    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
                    float d = q.x - min(q.w, q.y);
                    float e = 1.0e-10;
                    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
                }
                
                // HSV to RGB conversion
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
                
                vec3 curlNoise(vec3 p, float time) {
                    float eps = 0.1;
                    float timeScale = time * 0.02; // Very slow movement
                    
                    vec3 p1 = p + vec3(timeScale);
                    vec3 p2 = p + vec3(0.0, eps, 0.0) + vec3(timeScale);
                    vec3 p3 = p + vec3(0.0, 0.0, eps) + vec3(timeScale);
                    
                    float n1 = noise(p1 * 2.0);
                    float n2 = noise(p2 * 2.0);
                    float n3 = noise(p3 * 2.0);
                    
                    // Calculate curl (rotation)
                    vec3 curl = vec3(
                        (noise(p + vec3(0.0, eps, 0.0) + vec3(timeScale)) - noise(p + vec3(0.0, -eps, 0.0) + vec3(timeScale))) / (2.0 * eps),
                        (noise(p + vec3(0.0, 0.0, eps) + vec3(timeScale)) - noise(p + vec3(0.0, 0.0, -eps) + vec3(timeScale))) / (2.0 * eps),
                        (noise(p + vec3(eps, 0.0, 0.0) + vec3(timeScale)) - noise(p + vec3(-eps, 0.0, 0.0) + vec3(timeScale))) / (2.0 * eps)
                    );
                    
                    return curl * 0.5; // Scale down for gentler movement
                }
            `,

      getSplatTransform: /*glsl*/`
                (vec3 position, uint layersBitmask) {
                    // Generate swirling curl noise displacement with separate noise scale
                    vec3 curlOffset = curlNoise(position * u_noiseScale, u_time) * u_dispersionVolume * u_turbulenceStrength;
                    
                    // Smoother interpolation with cubic easing
                    float easing = u_progress * u_progress * u_progress * (u_progress * (u_progress * 6.0 - 15.0) + 10.0);
                    vec3 finalOffset = curlOffset * (1.0 - easing);
                    
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
                    vec3 color = splatColor.rgb;
                    
                    // Apply brightness first
                    color *= u_brightness;
                    
                    // Apply saturation adjustment
                    vec3 hsv = rgb2hsv(color);
                    hsv.y *= u_saturation; // Multiply saturation
                    color = hsv2rgb(hsv);
                    
                    // Then apply global fade to black
                    vec3 fadedColor = mix(color, vec3(0.0, 0.0, 0.0), u_colorFade);
                    
                    // Finally selectively make some splats black based on position
                    float positionHash = fract(sin(dot(splatPosition.xy, vec2(12.9898, 78.233))) * 43758.5453);
                    float isBlackSplat = step(positionHash, u_blackSplatsPercent);
                    
                    // Mix between processed color and black based on selection
                    vec3 finalColor = mix(fadedColor, vec3(0.0, 0.0, 0.0), isBlackSplat);
                    
                    return vec4(finalColor, splatColor.a);
                }
            `,


    },

    fragmentShaderHooks: {
      additionalUniforms: {
        u_splatSize: ['float', { value: animationParams.splatSize }],
        u_splatOpacity: ['float', { value: animationParams.splatOpacity }]
      },

      getFragmentColor: /*glsl*/`
                (vec4 fragColor) {
                    // Apply opacity multiplier
                    return vec4(fragColor.rgb, fragColor.a * u_splatOpacity);
                }
            `
    }
  });

  // Mark shader hooks as ready
  isShaderHooksReady = true;
  console.log('✓ Shader hooks applied');

  // Create UI controls after shader hooks are ready
  setTimeout(() => {
    createUIControls();
  }, 1000);
};

scene.add(splat);

// Safe uniform update function
function updateUniforms() {
  if (!isShaderHooksReady) return;

  try {
    if (splat.material && splat.material.uniforms) {
      const uniforms = splat.material.uniforms;
      if (uniforms.u_progress) uniforms.u_progress.value = animationParams.progress;
      if (uniforms.u_turbulenceStrength) uniforms.u_turbulenceStrength.value = animationParams.turbulenceStrength;
      if (uniforms.u_turbulenceScale) uniforms.u_turbulenceScale.value = animationParams.turbulenceScale;
      if (uniforms.u_noiseScale) uniforms.u_noiseScale.value = animationParams.noiseScale;
      if (uniforms.u_dispersionVolume) uniforms.u_dispersionVolume.value = animationParams.dispersionVolume;
      if (uniforms.u_splatSize) uniforms.u_splatSize.value = animationParams.splatSize;
      if (uniforms.u_splatOpacity) uniforms.u_splatOpacity.value = animationParams.splatOpacity;
      if (uniforms.u_colorFade) uniforms.u_colorFade.value = animationParams.colorFade;
      if (uniforms.u_blackSplatsPercent) uniforms.u_blackSplatsPercent.value = animationParams.blackSplatsPercent;
      if (uniforms.u_saturation) uniforms.u_saturation.value = animationParams.saturation;
      if (uniforms.u_brightness) uniforms.u_brightness.value = animationParams.brightness;
    }
  } catch (error) {
    console.warn('Error updating uniforms:', error);
  }
}

// Safe time update function
function updateTime() {
  if (!isShaderHooksReady) return;

  try {
    if (splat.material && splat.material.uniforms && splat.material.uniforms.u_time) {
      splat.material.uniforms.u_time.value = clock.getElapsedTime();
    }
  } catch (error) {
    console.warn('Error updating time:', error);
  }
}



// UI Controls
function createUIControls() {
  // Create container
  const controlsContainer = document.createElement('div');
  controlsContainer.style.cssText = `
    position: fixed;
    top: 20px;
    left: 20px;
    background: rgba(0, 0, 0, 0.8);
    padding: 20px;
    border-radius: 10px;
    color: white;
font-family: Arial, sans-serif;
    z-index: 1000;
  `;

  // Dispersion slider
  const sliderContainer = document.createElement('div');
  sliderContainer.style.marginBottom = '15px';

  const sliderLabel = document.createElement('label');
  sliderLabel.textContent = 'Dispersion: ';
  sliderLabel.style.display = 'block';
  sliderLabel.style.marginBottom = '5px';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '0';
  slider.style.width = '200px';

  slider.addEventListener('input', (e) => {
    animationParams.progress = 1 - (e.target.value / 100); // Invert so 0 = gathered, 100 = dispersed
    updateUniforms();
  });

  sliderContainer.appendChild(sliderLabel);
  sliderContainer.appendChild(slider);

  // Splat Size slider
  const sizeSliderContainer = document.createElement('div');
  sizeSliderContainer.style.marginBottom = '15px';

  const sizeSliderLabel = document.createElement('label');
  sizeSliderLabel.textContent = 'Splat Size: ';
  sizeSliderLabel.style.display = 'block';
  sizeSliderLabel.style.marginBottom = '5px';

  const sizeSlider = document.createElement('input');
  sizeSlider.type = 'range';
  sizeSlider.min = '0.1';
  sizeSlider.max = '5.0';
  sizeSlider.step = '0.1';
  sizeSlider.value = animationParams.splatSize.toString();
  sizeSlider.style.width = '200px';

  sizeSlider.addEventListener('input', (e) => {
    animationParams.splatSize = parseFloat(e.target.value);
    updateUniforms();
    sizeSliderLabel.textContent = `Splat Size: ${animationParams.splatSize.toFixed(1)}`;
  });

  sizeSliderContainer.appendChild(sizeSliderLabel);
  sizeSliderContainer.appendChild(sizeSlider);

  // Splat Opacity slider
  const opacitySliderContainer = document.createElement('div');
  opacitySliderContainer.style.marginBottom = '15px';

  const opacitySliderLabel = document.createElement('label');
  opacitySliderLabel.textContent = 'Splat Opacity: ';
  opacitySliderLabel.style.display = 'block';
  opacitySliderLabel.style.marginBottom = '5px';

  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.min = '0.0';
  opacitySlider.max = '2.0';
  opacitySlider.step = '0.1';
  opacitySlider.value = animationParams.splatOpacity.toString();
  opacitySlider.style.width = '200px';

  opacitySlider.addEventListener('input', (e) => {
    animationParams.splatOpacity = parseFloat(e.target.value);
    updateUniforms();
    opacitySliderLabel.textContent = `Splat Opacity: ${animationParams.splatOpacity.toFixed(1)}`;
  });

  opacitySliderContainer.appendChild(opacitySliderLabel);
  opacitySliderContainer.appendChild(opacitySlider);
  // Noise Scale slider
  const noiseScaleContainer = document.createElement('div');
  noiseScaleContainer.style.marginBottom = '15px';

  const noiseScaleLabel = document.createElement('label');
  noiseScaleLabel.textContent = 'Noise Scale: ';
  noiseScaleLabel.style.display = 'block';
  noiseScaleLabel.style.marginBottom = '5px';

  const noiseScaleSlider = document.createElement('input');
  noiseScaleSlider.type = 'range';
  noiseScaleSlider.min = '0';
  noiseScaleSlider.max = '5';
  noiseScaleSlider.step = '0.01';
  noiseScaleSlider.value = animationParams.noiseScale.toString();
  noiseScaleSlider.style.width = '200px';

  noiseScaleSlider.addEventListener('input', (e) => {
    animationParams.noiseScale = parseFloat(e.target.value);
    updateUniforms();
    noiseScaleLabel.textContent = `Noise Scale: ${animationParams.noiseScale.toFixed(3)}`;
  });

  noiseScaleContainer.appendChild(noiseScaleLabel);
  noiseScaleContainer.appendChild(noiseScaleSlider);

  // Dispersion Volume slider
  const dispersionContainer = document.createElement('div');
  dispersionContainer.style.marginBottom = '15px';

  const dispersionLabel = document.createElement('label');
  dispersionLabel.textContent = 'Dispersion Volume: ';
  dispersionLabel.style.display = 'block';
  dispersionLabel.style.marginBottom = '5px';

  const dispersionSlider = document.createElement('input');
  dispersionSlider.type = 'range';
  dispersionSlider.min = '0.1';
  dispersionSlider.max = '20.0';
  dispersionSlider.step = '0.1';
  dispersionSlider.value = animationParams.dispersionVolume.toString();
  dispersionSlider.style.width = '200px';

  dispersionSlider.addEventListener('input', (e) => {
    animationParams.dispersionVolume = parseFloat(e.target.value);
    updateUniforms();
    dispersionLabel.textContent = `Dispersion Volume: ${animationParams.dispersionVolume.toFixed(1)}`;
  });

  dispersionContainer.appendChild(dispersionLabel);
  dispersionContainer.appendChild(dispersionSlider);

  // Turbulence Strength slider
  const strengthContainer = document.createElement('div');
  strengthContainer.style.marginBottom = '15px';

  const strengthLabel = document.createElement('label');
  strengthLabel.textContent = 'Turbulence Strength: ';
  strengthLabel.style.display = 'block';
  strengthLabel.style.marginBottom = '5px';

  const strengthSlider = document.createElement('input');
  strengthSlider.type = 'range';
  strengthSlider.min = '0.1';
  strengthSlider.max = '15.0';
  strengthSlider.step = '0.1';
  strengthSlider.value = animationParams.turbulenceStrength.toString();
  strengthSlider.style.width = '200px';

  strengthSlider.addEventListener('input', (e) => {
    animationParams.turbulenceStrength = parseFloat(e.target.value);
    updateUniforms();
    strengthLabel.textContent = `Turbulence Strength: ${animationParams.turbulenceStrength.toFixed(1)}`;
  });

  strengthContainer.appendChild(strengthLabel);
  strengthContainer.appendChild(strengthSlider);

  // Color Fade slider
  const colorFadeContainer = document.createElement('div');
  colorFadeContainer.style.marginBottom = '15px';

  const colorFadeLabel = document.createElement('label');
  colorFadeLabel.textContent = 'Fade to Black: ';
  colorFadeLabel.style.display = 'block';
  colorFadeLabel.style.marginBottom = '5px';

  const colorFadeSlider = document.createElement('input');
  colorFadeSlider.type = 'range';
  colorFadeSlider.min = '0';
  colorFadeSlider.max = '1';
  colorFadeSlider.step = '0.01';
  colorFadeSlider.value = animationParams.colorFade.toString();
  colorFadeSlider.style.width = '200px';

  colorFadeSlider.addEventListener('input', (e) => {
    animationParams.colorFade = parseFloat(e.target.value);
    updateUniforms();
    colorFadeLabel.textContent = `Fade to Black: ${(animationParams.colorFade * 100).toFixed(0)}%`;
  });

  colorFadeContainer.appendChild(colorFadeLabel);
  colorFadeContainer.appendChild(colorFadeSlider);

  // Black Splats Percentage slider
  const blackSplatsContainer = document.createElement('div');
  blackSplatsContainer.style.marginBottom = '15px';

  const blackSplatsLabel = document.createElement('label');
  blackSplatsLabel.textContent = 'Black Splats %: ';
  blackSplatsLabel.style.display = 'block';
  blackSplatsLabel.style.marginBottom = '5px';

  const blackSplatsSlider = document.createElement('input');
  blackSplatsSlider.type = 'range';
  blackSplatsSlider.min = '0';
  blackSplatsSlider.max = '1';
  blackSplatsSlider.step = '0.01';
  blackSplatsSlider.value = animationParams.blackSplatsPercent.toString();
  blackSplatsSlider.style.width = '200px';

  blackSplatsSlider.addEventListener('input', (e) => {
    animationParams.blackSplatsPercent = parseFloat(e.target.value);
    updateUniforms();
    blackSplatsLabel.textContent = `Black Splats %: ${(animationParams.blackSplatsPercent * 100).toFixed(0)}%`;
  });

  blackSplatsContainer.appendChild(blackSplatsLabel);
  blackSplatsContainer.appendChild(blackSplatsSlider);

  // Saturation slider
  const saturationContainer = document.createElement('div');
  saturationContainer.style.marginBottom = '15px';

  const saturationLabel = document.createElement('label');
  saturationLabel.textContent = 'Saturation: ';
  saturationLabel.style.display = 'block';
  saturationLabel.style.marginBottom = '5px';

  const saturationSlider = document.createElement('input');
  saturationSlider.type = 'range';
  saturationSlider.min = '0';
  saturationSlider.max = '3';
  saturationSlider.step = '0.01';
  saturationSlider.value = animationParams.saturation.toString();
  saturationSlider.style.width = '200px';

  saturationSlider.addEventListener('input', (e) => {
    animationParams.saturation = parseFloat(e.target.value);
    updateUniforms();
    saturationLabel.textContent = `Saturation: ${animationParams.saturation.toFixed(2)}`;
  });

  saturationContainer.appendChild(saturationLabel);
  saturationContainer.appendChild(saturationSlider);

  // Brightness slider
  const brightnessContainer = document.createElement('div');
  brightnessContainer.style.marginBottom = '15px';

  const brightnessLabel = document.createElement('label');
  brightnessLabel.textContent = 'Brightness: ';
  brightnessLabel.style.display = 'block';
  brightnessLabel.style.marginBottom = '5px';

  const brightnessSlider = document.createElement('input');
  brightnessSlider.type = 'range';
  brightnessSlider.min = '0';
  brightnessSlider.max = '3';
  brightnessSlider.step = '0.01';
  brightnessSlider.value = animationParams.brightness.toString();
  brightnessSlider.style.width = '200px';

  brightnessSlider.addEventListener('input', (e) => {
    animationParams.brightness = parseFloat(e.target.value);
    updateUniforms();
    brightnessLabel.textContent = `Brightness: ${animationParams.brightness.toFixed(2)}`;
  });

  brightnessContainer.appendChild(brightnessLabel);
  brightnessContainer.appendChild(brightnessSlider);

  const toggleContainer = document.createElement('div');

  controlsContainer.appendChild(sliderContainer);
  controlsContainer.appendChild(sizeSliderContainer);
  controlsContainer.appendChild(opacitySliderContainer);
  controlsContainer.appendChild(colorFadeContainer);
  controlsContainer.appendChild(blackSplatsContainer);
  controlsContainer.appendChild(saturationContainer);
  controlsContainer.appendChild(brightnessContainer);
  controlsContainer.appendChild(noiseScaleContainer);
  controlsContainer.appendChild(dispersionContainer);
  controlsContainer.appendChild(strengthContainer);
  controlsContainer.appendChild(toggleContainer);
  document.body.appendChild(controlsContainer);

  console.log('✓ UI Controls created');
}

// Manual controls for console access
const splatControls = {
  setTurbulence: (strength, scale) => {
    if (!isShaderHooksReady) return;
    animationParams.turbulenceStrength = strength || 1.0;
    animationParams.turbulenceScale = scale || 0.03;
    updateUniforms();
  },

  setNoiseScale: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.noiseScale = value || 0.03;
    updateUniforms();
  },

  setDispersionVolume: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.dispersionVolume = value || 8.0;
    updateUniforms();
  },

  setDispersion: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.progress = 1 - (value / 100); // 0-100 where 0 = gathered, 100 = dispersed
    updateUniforms();
  },

  setSplatSize: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.splatSize = value || 1.0;
    updateUniforms();
  },

  setSplatOpacity: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.splatOpacity = value || 1.0;
    updateUniforms();
  },

  setColorFade: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.colorFade = value || 0.0;
    updateUniforms();
  },

  setBlackSplatsPercent: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.blackSplatsPercent = value || 0.0;
    updateUniforms();
  },

  setSaturation: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.saturation = value || 1.0;
    updateUniforms();
  },

  setBrightness: (value) => {
    if (!isShaderHooksReady) return;
    animationParams.brightness = value || 1.0;
    updateUniforms();
  }
};

// Make controls available globally
window.splatControls = splatControls;
window.animationParams = animationParams;

// Render loop
renderer.setAnimationLoop(() => {
  updateTime(); // Safe time update
  controls.update();
  renderer.render(scene, camera);
});

// Console helpers
console.log('🎮 Controls available:');
console.log('  Use the UI sliders to control all parameters');
console.log('  window.splatControls.setTurbulence(strength, scale)');
console.log('  window.splatControls.setDispersion(0-100)');
console.log('  window.splatControls.setNoiseScale(0-5)');
console.log('  window.splatControls.setDispersionVolume(0.1-20.0)');
console.log('  window.splatControls.setSplatSize(0.1-5.0)');
console.log('  window.splatControls.setSplatOpacity(0.0-2.0)');
console.log('  window.splatControls.setColorFade(0.0-1.0)');
console.log('  window.splatControls.setBlackSplatsPercent(0.0-1.0)');
console.log('  window.splatControls.setSaturation(0.0-3.0)');
console.log('  window.splatControls.setBrightness(0.0-3.0)');
console.log('🔧 Try: splatControls.setSaturation(0.5)');
console.log('🔧 Try: splatControls.setBrightness(1.5)');
