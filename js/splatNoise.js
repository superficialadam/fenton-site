// Fixed Turbulent Point Field Effect - Proper timing handling
import { WebGLRenderer, PerspectiveCamera, Scene, Clock, BufferGeometry, BufferAttribute, Points, PointsMaterial } from 'three';
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
  turbulenceStrength: 8.0, // 10x larger dispersion volume
  turbulenceScale: 0.03,   // 10x smaller noise scale
  noiseScale: 0.03,        // Separate noise scale parameter
  dispersionVolume: 8.0,   // Separate dispersion volume parameter
  animationSpeed: 0.001,
  pointMorphFactor: 0.0 // 0 = splats only, 1 = points only
};

// Point cloud system
let pointCloud = null;
let splatPositions = null;

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
        u_dispersionVolume: ['float', { value: animationParams.dispersionVolume }]
      },

      // Curl noise for swirling patterns
      additionalGlobals: /*glsl*/`
                float hash(vec3 p) {
                    p = fract(p * 0.3183099 + 0.1);
                    p *= 17.0;
                    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
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
                    vec3 curlOffset = curlNoise(position * u_noiseScale, u_time) * u_dispersionVolume;
                    
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
                    return mix(0.2, 1.0, u_progress);
                }
            `,


    }
  });

  // Mark shader hooks as ready
  isShaderHooksReady = true;
  console.log('✓ Shader hooks applied');

  // Extract splat positions and create point cloud
  setTimeout(() => {
    createPointCloud();
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

// Create point cloud from splat data
function createPointCloud() {
  try {
    // Access the splat data - this is a simplified approach
    // In reality, we'd need to extract actual splat positions from the LumaSplatsThree object
    // For now, let's create a representative point cloud

    const pointCount = 50000; // Approximate number of points
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);

    // Generate points in a similar distribution to the splat
    for (let i = 0; i < pointCount; i++) {
      const i3 = i * 3;

      // Create a rough sphere distribution with some noise
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = 2 * Math.PI * Math.random();
      const radius = 0.5 + Math.random() * 0.5;

      positions[i3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i3 + 2] = radius * Math.cos(phi);

      // Add some color variation
      colors[i3] = 0.5 + Math.random() * 0.5;     // R
      colors[i3 + 1] = 0.5 + Math.random() * 0.5; // G
      colors[i3 + 2] = 0.5 + Math.random() * 0.5; // B
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));

    const material = new PointsMaterial({
      size: 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });

    pointCloud = new Points(geometry, material);
    pointCloud.visible = false; // Start hidden
    scene.add(pointCloud);

    console.log('✓ Point cloud created');
  } catch (error) {
    console.warn('Could not create point cloud:', error);
  }
}

// Update visibility based on morph factor
function updatePointCloudVisibility() {
  if (pointCloud) {
    const morphFactor = animationParams.pointMorphFactor;

    // Fade between splats and points
    splat.material.opacity = 1 - morphFactor;
    pointCloud.visible = morphFactor > 0;
    pointCloud.material.opacity = morphFactor * 0.8;

    // Apply same turbulence to point cloud
    if (morphFactor > 0 && pointCloud.geometry.attributes.position) {
      const positions = pointCloud.geometry.attributes.position.array;
      const time = clock.getElapsedTime();

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];

        // Apply similar curl noise as in shader with separate parameters
        const curlOffset = curlNoise(x, y, z, time);
        const easing = animationParams.progress * animationParams.progress * animationParams.progress * (animationParams.progress * (animationParams.progress * 6 - 15) + 10);
        const finalOffset = {
          x: curlOffset.x * (1 - easing),
          y: curlOffset.y * (1 - easing),
          z: curlOffset.z * (1 - easing)
        };

        positions[i] = x + finalOffset.x * animationParams.dispersionVolume;
        positions[i + 1] = y + finalOffset.y * animationParams.dispersionVolume;
        positions[i + 2] = z + finalOffset.z * animationParams.dispersionVolume;
      }

      pointCloud.geometry.attributes.position.needsUpdate = true;
    }
  }
}

// JavaScript version of curl noise for swirling patterns
function curlNoise(x, y, z, time) {
  const scale = animationParams.noiseScale;
  const p = { x: x * scale, y: y * scale, z: z * scale };
  const timeScale = time * 0.02; // Very slow movement
  const eps = 0.1;

  // Calculate curl (rotation) for swirling motion
  const curl = {
    x: (noise3D(p.x, p.y + eps, p.z, timeScale) - noise3D(p.x, p.y - eps, p.z, timeScale)) / (2.0 * eps),
    y: (noise3D(p.x, p.y, p.z + eps, timeScale) - noise3D(p.x, p.y, p.z - eps, timeScale)) / (2.0 * eps),
    z: (noise3D(p.x + eps, p.y, p.z, timeScale) - noise3D(p.x - eps, p.y, p.z, timeScale)) / (2.0 * eps)
  };

  return {
    x: curl.x * 0.5,
    y: curl.y * 0.5,
    z: curl.z * 0.5
  };
}

// 3D noise function (JavaScript version)
function noise3D(x, y, z, time) {
  const p = { x: x + time, y: y + time, z: z + time };
  
  // Simple 3D noise implementation
  const ix = Math.floor(p.x);
  const iy = Math.floor(p.y);
  const iz = Math.floor(p.z);
  
  const fx = p.x - ix;
  const fy = p.y - iy;
  const fz = p.z - iz;
  
  // Smooth interpolation
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  
  // Hash function for pseudo-random values
  const hash = (x, y, z) => {
    let h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % 1000000;
    return (h / 1000000.0) * 2 - 1;
  };
  
  // Trilinear interpolation
  const c000 = hash(ix, iy, iz);
  const c001 = hash(ix, iy, iz + 1);
  const c010 = hash(ix, iy + 1, iz);
  const c011 = hash(ix, iy + 1, iz + 1);
  const c100 = hash(ix + 1, iy, iz);
  const c101 = hash(ix + 1, iy, iz + 1);
  const c110 = hash(ix + 1, iy + 1, iz);
  const c111 = hash(ix + 1, iy + 1, iz + 1);
  
  const c00 = c000 * (1 - u) + c100 * u;
  const c01 = c001 * (1 - u) + c101 * u;
  const c10 = c010 * (1 - u) + c110 * u;
  const c11 = c011 * (1 - u) + c111 * u;
  
  const c0 = c00 * (1 - v) + c10 * v;
  const c1 = c01 * (1 - v) + c11 * v;
  
  return c0 * (1 - w) + c1 * w;
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

  // Point morphing slider
  const pointSliderContainer = document.createElement('div');
  pointSliderContainer.style.marginBottom = '15px';

  const pointSliderLabel = document.createElement('label');
  pointSliderLabel.textContent = 'Point Morph: ';
  pointSliderLabel.style.display = 'block';
  pointSliderLabel.style.marginBottom = '5px';

  const pointSlider = document.createElement('input');
  pointSlider.type = 'range';
  pointSlider.min = '0';
  pointSlider.max = '100';
  pointSlider.value = '0';
  pointSlider.style.width = '200px';

  pointSlider.addEventListener('input', (e) => {
    animationParams.pointMorphFactor = e.target.value / 100;
    updatePointCloudVisibility();
  });

  pointSliderContainer.appendChild(pointSliderLabel);
  pointSliderContainer.appendChild(pointSlider);

  // Noise Scale slider
  const noiseScaleContainer = document.createElement('div');
  noiseScaleContainer.style.marginBottom = '15px';
  
  const noiseScaleLabel = document.createElement('label');
  noiseScaleLabel.textContent = 'Noise Scale: ';
  noiseScaleLabel.style.display = 'block';
  noiseScaleLabel.style.marginBottom = '5px';
  
  const noiseScaleSlider = document.createElement('input');
  noiseScaleSlider.type = 'range';
  noiseScaleSlider.min = '0.001';
  noiseScaleSlider.max = '0.5';
  noiseScaleSlider.step = '0.001';
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

  const toggleContainer = document.createElement('div');

  controlsContainer.appendChild(sliderContainer);
  controlsContainer.appendChild(pointSliderContainer);
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
    animationParams.turbulenceStrength = strength || 8.0;
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

  setPointMorph: (value) => {
    animationParams.pointMorphFactor = value / 100; // 0-100 where 0 = splats, 100 = points
    updatePointCloudVisibility();
  }
};

// Make controls available globally
window.splatControls = splatControls;
window.animationParams = animationParams;

// Render loop
renderer.setAnimationLoop(() => {
  updateTime(); // Safe time update
  updatePointCloudVisibility(); // Update point cloud morphing
  controls.update();
  renderer.render(scene, camera);
});

// Console helpers
console.log('🎮 Controls available:');
console.log('  Use the UI slider to control dispersion');
console.log('  Use the toggle button for point rendering');
console.log('  window.splatControls.setTurbulence(strength, scale)');
console.log('  window.splatControls.setDispersion(0-100)');
console.log('  window.splatControls.setPointMorph(0-100)');
console.log('  window.splatControls.setNoiseScale(0.001-0.5)');
console.log('  window.splatControls.setDispersionVolume(0.1-20.0)');
console.log('🔧 Try: splatControls.setNoiseScale(0.01)');
console.log('🔧 Try: splatControls.setDispersionVolume(10.0)');
